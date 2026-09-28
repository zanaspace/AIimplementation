# 1Gov CICOD-AI Implementation Guide

This guide explains how to take the components in this folder into the real 1Gov products: **ECMS first, then the rest of the suite**. Each component's `index.html` shows where it sits on the screen, how it works and what it delivers. This guide covers what those pages share: architecture, the gateway contract, integration pattern, rollout, testing and governance.

---

## 1. Folder structure

```
AI Implementation/
├── index.html                  hub: every component, filterable by phase
├── IMPLEMENTATION_GUIDE.md     this file
├── shared/
│   ├── tokens.css              1Gov design tokens (light/dark) + primitives (.g-btn, .g-chip, .ai-badge…)
│   ├── shell.css / shell.js    replica of the 1Gov app chrome, used by the demos only
│   ├── doc.css / doc.js        explainer-page layout, placement toggle, audit console (demos only)
│   ├── ai-gateway.js           THE client every component uses: request / feedback / esc / reveal
│   └── registry.js             catalogue of components (slug, code, phase, screen, tag)
├── components/
│   ├── ecms/<feature>/         index.html (demo + docs) · <feature>.css · <feature>.js
│   ├── drive/ assets/ inmail/  Drive, Assets (IMS) and InMail features
│   └── cicod/<feature>/        Workspace, Conference, Portal, PMS and cross-app features
└── _tools/check.cjs            headless render check (console errors + mobile overflow + screenshot)
```

**What ships to production:** only `shared/tokens.css` (or a mapping onto the product's existing tokens), `shared/ai-gateway.js`, and each feature's `<feature>.css` and `<feature>.js`. The `index.html` pages, `shell.*` and `doc.*` are for documentation and demos.

---

## 2. Component contract (same for all 28)

| Aspect | Rule |
|---|---|
| Format | A standard **Web Component** (custom element, e.g. `<ai-task-brief>`) with no framework dependency. It works in the current React/Next.js front ends and in legacy pages. |
| Styling | One CSS file per component. Every class has a unique prefix (`aisr-`, `aitb-`…). Only design tokens (`var(--…)`) are used, so the product theme and dark mode apply automatically. |
| Inputs | HTML attributes (e.g. `source="#task-form"`, `task-id="17572"`, `auto-threshold="0.9"`). |
| Outputs | `CustomEvent`s that bubble (e.g. `ai-route-apply`, `ai-reply-insert`). **The host page always owns the data.** A component never saves, routes, approves or sends by itself. |
| CICOD-AI calls | Only through `AIGateway.request(endpoint, payload, {feature})`. No component talks to a model directly. |
| Feedback | Every suggestion shows accept / edit / reject, which calls `AIGateway.feedback()`. This is the quality KPI and the retraining signal. |
| Safety | All CICOD-AI text is escaped (`AIGateway.esc`). It's never injected as HTML. Anything that changes state needs a human click. |
| Accessibility | `aria-live="polite"` on result regions, keyboard reachable controls, and `prefers-reduced-motion` respected. |

### Mounting in React / Next.js (ECMS)
```tsx
// app/ai/AiSmartRouting.tsx
'use client';
import { useEffect, useRef } from 'react';
import '@/ai/components/smart-routing.css';

export function AiSmartRouting({ onApply }: { onApply: (f: string, v: string) => void }) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    import('@/ai/shared/ai-gateway.js').then(() => import('@/ai/components/smart-routing.js'));
    const el = ref.current!;
    const h = (e: any) => onApply(e.detail.field, e.detail.value);
    el.addEventListener('ai-route-apply', h);
    return () => el.removeEventListener('ai-route-apply', h);
  }, [onApply]);
  return <ai-smart-routing ref={ref} source="#task-form" auto-threshold="0.9" />;
}
```
Before loading the gateway script, set `window.ONEGOV_AI = { baseUrl: '/ai', token: session.token }`. The 1Gov session token that already authorises the apps (`?authorize=…`) is reused. There's no new login.

---

## 3. The 1Gov CICOD-AI Gateway (backend)

A single service behind the existing nginx, e.g. `https://<tenant>.convergenceondemand.com/ai/*`.

```
Client component ──► /ai/<route> ──► AuthN (1Gov token) ──► Policy engine ──► PII redaction ──► Model router ──► Model / tool
                                         │                    │ tenant flags         │                  │ sovereign LLM (Secret/PII)
                                         │                    │ classification       │                  │ optional cloud LLM (Official/Public)
                                         ▼                    ▼                      ▼                  │ OCR / ASR / ML models
                                     Audit log  ◄───────────── every request, response, model, user decision
```

### Responsibilities
1. **Authentication and authorisation.** Validate the 1Gov token. Load the user's role, department, workgroups and Drive ACLs.
2. **Policy.** Check the feature flag (`ai.<app>.<feature>`), tenant quotas and data classification. Drive already labels files Official (O) / Secret (S). Secret and Top Secret, and anything with personal data, may only go to **models hosted inside the Galaxy Backbone data centre**.
3. **PII redaction** (NIN, BVN, phone, email, staff ID, blood group) before any non-sovereign call. Tokens are put back into the response only for authorised viewers.
4. **Model routing.** Small, fast classifiers for routing, SLA and anomaly work. An LLM for drafting, summarising and explaining. OCR/layout models for documents. ASR for meetings.
5. **Retrieval.** A permission-trimmed unified index (vector + keyword) over Drive, memos, tasks, InMail and transcripts. Results the user can't open are never returned. The count of hidden items may be shown.
6. **Audit.** Write to the existing audit logs: feature, user, IP, input hash, model, output hash, and the user's decision.
7. **Evaluation hooks.** Log samples to labelled evaluation sets. Report acceptance rate per feature.

### Endpoint catalogue

| Component | Endpoint | Model / technique | Key data dependencies |
|---|---|---|---|
| Smart Intake & Routing | `POST /ecms/route-task` | Tenant text classifier + LLM fallback + load-aware assignee scorer | Historical tasks, queues, resources, shifts |
| Task Brief & Reply | `POST /ecms/task-brief`, `/ecms/draft-reply` | LLM over timeline + attachment OCR | Task remarks, attachments |
| SLA Risk | `POST /ecms/sla-risk` | Gradient-boosted survival model | Status transition timestamps, SLA config |
| Approval Copilot | `POST /ecms/approval-digest` | Rules + RAG on policy docs + LLM rationale | Approval levels, thresholds, POLICY_DOCUMENTS |
| Email-to-Task | `POST /ecms/email-triage` | Classifier + extraction + OCR | Email Integration mailboxes, contacts |
| Memo Copilot | `POST /ecms/memo/draft`, `/ecms/memo/rewrite`, `/ecms/memo/classify` | LLM + MDA templates + sensitivity classifier | Memo templates, style guide |
| Minute Summary | `POST /ecms/memo/minutes` | LLM extraction | Minute chain |
| Prompt-to-Workflow | `POST /ecms/workflow/generate` | LLM with JSON schema of the ECMS workflow model + validator | Roles, departments, queues |
| CICOD-AI Form Builder | `POST /ecms/form/generate` | LLM + OCR for paper forms | Field type catalogue |
| Setup Wizard Mapper | `POST /ecms/setup/map` | Extraction + fuzzy matching + LLM normalisation | Uploaded nominal roll, existing roles |
| Dashboard Insights | `POST /ecms/insights` | Aggregates + anomaly detection + LLM narrative | Dashboard queries |
| Ask for a Report | `POST /ecms/report/nl` | Text-to-query (whitelisted schema) + chart spec | Reporting views |
| Contact Dedup | `POST /ecms/contacts/dedupe` | Blocking + fuzzy matching + LLM judge | Contacts, tasks per contact |
| Audit Copilot | `POST /ecms/audit/ask`, `/ecms/audit/anomalies` | Text-to-query + rules + isolation forest | Audit log |
| Smart Dispatch | `POST /ecms/dispatch/rebalance` | Assignment optimisation (ILP / greedy) | Resources, shifts, schedules, open tasks |
| Daily Brief | `POST /workspace/brief` | Aggregation + ranking + LLM | Tasks, approvals, InMail, Drive, calendar |
| Ask 1Gov | `POST /search/ask` | Hybrid retrieval + LLM with citations + tool-calling | Unified index |
| Request Finder | `POST /forms/match`, `/forms/autofill` | Embedding match + OCR extraction + image quality check | Form catalogue |
| InMail Assist | `POST /mail/draft`, `/mail/summarise`, `/mail/precheck` | LLM + DLP rules | Mail threads, directory |
| Document Assistant | `POST /drive/summarise`, `/drive/ask` | OCR + RAG with page citations | Drive files + ACL + classification |
| Smart Upload | `POST /drive/classify` | Sensitivity classifier + PII detector + folder recommender | Folder tree, retention rules |
| Historic OCR Search | `POST /drive/ocr`, `/drive/search` | OCR pipeline + hybrid search | Historic Files |
| Meeting Minutes | `POST /conference/minutes` | ASR + diarisation + LLM | Recordings, attendance |
| Invoice Capture | `POST /ims/invoice/extract`, `/ims/invoice/match` | OCR + key-value + 3-way match + outlier stats | Requests/POs, receipts, price history |
| Variance Explainer | `POST /ims/stock/variance` | Movement reconciliation + anomaly model | Receipts, issues, transfers, returns |
| Registry Guardian | `POST /ims/registry/check`, `/ims/forecast` | Validation rules + clustering + time-series forecast | Registry KPIs, master data, consumption |
| Citizen Assistant | `POST /portal/chat`, `/portal/track` | LLM with tool-calls to public webform APIs + MT | Public queues, task status (citizen-safe fields) |
| Appraisal Copilot | `POST /pms/kpi`, `/pms/evidence` | LLM + cross-app retrieval | ECMS/Drive activity per staff |

Every endpoint returns `{ id, model, …result }` and accepts the feedback call `POST /feedback { suggestionId, feature, action, field? }`.

---

## 4. Rollout plan: ECMS first, then 1Gov

### Wave 0 (weeks 0–4): Foundations
- Deploy the CICOD-AI Gateway: auth, policy, redaction, audit and feedback.
- Provision a sovereign LLM + OCR in the GBB data centre. Set up the optional cloud route for Official data, if policy allows.
- Data hygiene sprint, which the CICOD-AI itself speeds up: remove test and junk tasks and contacts, and normalise roles, UOM and asset types. Components involved: Contact Dedup, Setup Wizard Mapper, Registry Guardian.
- Export about 16k historical tasks and label an evaluation set of 500 tasks.

### Wave 1 (weeks 4–12): ECMS "assist"
| Order | Component | Why first |
|---|---|---|
| 1 | Smart Intake & Routing (suggestion mode) | Directly attacks the 11,003-task Order Fulfilment backlog |
| 2 | Task Brief & Suggested Reply | Quick win; every officer benefits on day one |
| 3 | Memo Copilot + Minute Summary | High visibility with senior officers |
| 4 | Dashboard Insights + Ask for a Report | Leadership value; exposes data issues early |
| 5 | Email-to-Task | Feeds routing from a new channel |
| 6 | Audit Copilot + Contact Dedup | Governance and data quality |

### Wave 2 (months 3–6): ECMS "automate" + 1Gov "assist"
- ECMS: SLA Risk & Escalation, Approval Copilot, Prompt-to-Workflow, CICOD-AI Form Builder, Setup Wizard Mapper, Smart Dispatch. Auto-routing is enabled only for queues with 90% or higher acceptance.
- 1Gov: Daily Brief, Document Assistant, Historic OCR, Request Finder, InMail Assist, Registry Guardian.

### Wave 3 (months 6–12): 1Gov "automate"
- Ask 1Gov (cross-app), Smart Upload classification, Meeting Minutes, Invoice Capture, Variance Explainer, Citizen Assistant, Appraisal Copilot (once PMS access is sorted out).

---

## 5. Integration checklist per component

1. Copy `<feature>.css` and `<feature>.js` into the product's `ai/components/` folder.
2. Map `tokens.css` variables onto the product's theme, if its variable names differ.
3. Place the element at the mount point shown in the component's demo (`data-ai-spot` marks it).
4. Wire the component's events to the page's state and actions (see the "Mount" snippet on each demo page).
5. Implement the gateway endpoint to match the demo's **API contract** exactly. The mock inside `<feature>.js` is the reference for the response shape.
6. Add the feature flag `ai.<app>.<feature>`, off by default, to tenant settings.
7. Add audit event types to the app's audit log.
8. Run the evaluation set. Ship to a pilot department in suggestion mode.
9. Track acceptance rate, time saved and error reports weekly. Widen the rollout only once the target is met.

---

## 6. Testing and evaluation

| Layer | How |
|---|---|
| UI | `node _tools/check.cjs <page> [type-selector] [text] [click-selector] [--mobile]` checks for no console errors and no horizontal overflow at 390px, and saves a screenshot. Add Playwright flows to `QATestingApp` for each component. |
| Contract | JSON-schema tests. The gateway response must match the shape each component's mock returns. |
| Model quality | Per-feature labelled sets. Routing: top-1 accuracy per queue. Summaries: faithfulness spot checks (claims supported by the source). Extraction: field-level precision and recall. Anomalies: precision at k. |
| Safety | Red-team prompts (prompt injection inside documents and emails). Classification-leak tests: a Secret document must never reach the cloud route. PII redaction tests. |
| Business | Before/after baselines: time to assignment, SLA compliance, memo drafting time, backlog size, utilisation (currently 0%). |

---

## 7. Governance

- **NDPA 2023**: a data protection impact assessment per feature, purpose limitation, retention of prompts and outputs according to the records policy, and handling of citizens' rights.
- **Human in the loop**: routing, approvals, classification, signing and sending always need a human click, until a feature has proven its accuracy and the tenant explicitly enables automation.
- **Transparency**: the ✦ CICOD-AI badge on every CICOD-AI surface, "why" explanations, citations, and "CICOD-AI-drafted" watermarks on memos and letters until a human edits them.
- **Model register**: a list of each model, its version, hosting location (sovereign or cloud), permitted data classes, evaluation scores and owner.
- **Kill switch**: per tenant and per feature, in Settings.

---

## 8. Known platform issues to fix alongside (from the live walkthrough)
These affect CICOD-AI features directly:
- The dashboards report different counts: 161 vs 15,395 open tasks, and 0% utilisation. Dashboard Insights will surface this, but the source queries need fixing.
- The "All Tasks" tab shows "No data found" although the header counts 15,883 tasks. The routing and SLA features need a reliable task list API.
- Deep links to ECMS routes return 502, and the legacy `/wfm` and `/cde` URLs revoke the session. CICOD-AI deep links in citations and notifications need stable routes.
- Conference Recordings returns 500. Meeting Minutes depends on it.
- PMS is unauthorised for Product Manager users. Appraisal Copilot is blocked until that's fixed.
- IMS Asset Registry KPIs are inconsistent (average cost is higher than the total value). Registry Guardian flags this, but the aggregation needs fixing.
