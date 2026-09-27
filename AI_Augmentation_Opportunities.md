# 1Gov Cloud: AI Augmentation Opportunities (Module by Module)

**Environment explored:** `https://govtest.convergenceondemand.com`, tenant **govtest**. We logged in as the `target3` account from `.env`, whose role is Product Manager / User. Login required email OTP 2FA.
**Date of walkthrough:** 27 Sep 2026
**Method:**
- A live, read-only crawl with Playwright. We opened every sidebar menu and sub-page we could reach in each app, plus the main "create" screens. Nothing was submitted, edited or deleted.
- We saved about 115 screen captures. 27 key ones are in `./screenshots/`.
- We cross-checked what we saw against the existing internal notes: `newFeatures.md` and `competitive_analysis/.../NEWFEATURES/AI.md`.

---

## 0. Executive summary

1Gov Cloud is already a broad suite:
- **Workspace portal**
- **ECMS**: workflow, tasks, memos, forms, contacts, resources, reports
- **InMail**: mail, circulars, broadcasts
- **Conference**
- **Drive**: classified document store with e-signature and version history
- **Assets / IMS**: inventory, stores, stock-taking, payables
- **PMS**: performance management
- **Paperless Service Portal**: the citizen-facing side

The data these modules generate is exactly what modern AI works best on:
- free-text requests and complaints
- memos and minutes
- scanned documents
- approval chains
- task histories
- stock movements
- audit trails

What the live system showed:

| Signal observed in the live tenant | What it tells us | AI lever |
|---|---|---|
| **16,102 tasks created; All Tasks shows 15,395 open vs 488 in progress.** The Workflow Dashboard cards show 161 open / 26 in progress / 14 closed. | A huge untriaged backlog, and dashboard numbers that disagree with each other | Auto-triage, SLA-risk prediction, backlog clean-up agent |
| **Order Fulfilment queue: 11,003 open, 1 in progress, 2 closed.** Complaints: 2,248 open / 25 closed. | Queues don't get worked; routing and assignment are the bottleneck | Smart routing and assignment; duplicate/spam detection |
| **Resource Utilization: 0 % average; 644 tasks assigned, 15,945 opened, 157 closed** | Utilization isn't measured or isn't happening | Workload balancing, skills-based assignment |
| **290 workflows** (286 active); **35 / 110 / 11 workgroups**; **192 roles**; **100 users** | Heavy configuration; many look like test or duplicate setups (e.g. "REPAIR DEATAILS", "Testiing") | Prompt-to-workflow, config linting, duplicate detection |
| **Drive holds mixed-classification files** (Official (O), Secret (S)) with Sign, Version History and Classification actions | Rich document corpus with security labels | Classification suggestion, OCR, summarization, RAG, all classification-aware |
| **Asset Registry shows "Average asset cost ₦5.40bn" > "Total asset value ₦1.11bn"; "25,160,250 available assets" vs "38 total assets"** | Data-quality errors are visible on the KPI screen | Anomaly and data-quality AI |
| **Stock-taking variances waiting for manual approval; payables with I&QA/Store/Costing sign-offs** | Multi-step manual checks | Variance explanation, fraud/outlier flags, invoice OCR |
| **Webforms such as "DATA CAPTURE" (NTA) ask for name, staff no., blood group and signature, "MUST BE ON WHITE BACKGROUND"; "AI IMPLEMENTATION" asks users to upload process documentation** | Forms are typed in by hand from paper/ID documents | OCR autofill, document-to-form, photo quality checks |
| **Paperless Service Portal: Engage Us (about 30 queues), Track Engagement, Verify Staff** | Citizens must pick the right queue themselves | Citizen assistant that picks the queue, fills the form and answers status questions |

**Top 10 recommendations, ranked by value ÷ effort:**
1. **ECMS Smart Intake and Routing**: classify, prioritise and route every new request/task to the right queue, queue type and assignee.
2. **Document Intelligence (OCR + extraction)** in Drive, ECMS attachments, Forms and IMS receipts.
3. **Memo Copilot**: draft, rewrite, summarise minutes and track action items in the memo editor.
4. **Task/Case Summary and "Next best action"** on every task: a one-paragraph brief, SLA risk and a suggested reply.
5. **Ask-1Gov (RAG search)** across Drive, memos, tasks and InMail, filtered by the user's permissions and the document's classification.
6. **Prompt-to-Workflow / Prompt-to-Form** in Create Workflow, Create Form and the Setup Wizard.
7. **Approval Copilot**: a pre-digested approval pack and risk flags in Task Approvals, Asset Approval Levels and Drive Approval Log.
8. **Asset/IMS anomaly detection and demand forecasting**: stock-take variance, reorder points, fraud flags on payables.
9. **Citizen Assistant** on the Paperless Service Portal: conversational intake plus tracking, available on WhatsApp, USSD and web.
10. **Meeting Intelligence** in Conference: transcription, minutes, and action items pushed into ECMS tasks.

---

## 1. Platform map (what exists today)

| App | URL root | Sub-modules found |
|---|---|---|
| **Workspace (Home)** | `/admin/tenant` | Home (Needs You Today: My Workflows, Tasks Assigned, Pending Approvals; GovMail notifications; Drive "Shared with me"; Recent documents; app launcher), Calendar, Request (20 request forms, cards/table, Share), Inter-MDA, Administration (Profile, Change Password), Mobile apps (Gov OTP, Gov Drive, 1Gov Mobile, Gov Conference *coming soon*), 1Gov Desktop |
| **ECMS** | `/ecms` | Overview; **Dashboard** (Workflow, Status, Resource Utilization); **Requests** (Internal/External); **Tasks** (Create Task, All Tasks with tabs Assigned to me / by me / Created by me / CC'd / Inactive; Task Approvals with Approval Request/History, Bulk Action); **Memos** (Create Memo rich editor with Save/Publish/Preview/Settings; All Memos, My Drafts, Draft Reviews); **Workflows** (Create Workflow wizard: Process → Form → Escalation → Approval; My Workflows; Queues; Queue Types; Statuses); **Workgroups**; **Forms** (Create Form: Internal / External / Capture / Inter MDA / Status; All Forms; Form Analytics); **Contacts** (169 contacts, lifecycle stage); **Users** (Departments, Roles, Users, Export); **Resources** (All, Type, Level, Shift, Schedule); **Reports** (filtered reports, Audit Log); **Settings** (Asset Approval Role/Region/Level/Group, Asset Thresholds/Flags, Manage Call Drivers, Email Integration, Setup Wizard, Task Routing); Quick Actions; Start Tour |
| **InMail** | `/govmail` | Inbox (Primary / Notification), Sent, Drafts, **Circular** (All / Draft circulars), **Broadcast**, Flagged, Starred, Compose (Message vs Circular), Search |
| **Conference** | `/conferencing` | Rooms (Create Room: name, URL, access code, mute on join, moderator, chat/webcam/mic controls), Schedule Meeting, Manage room, Start meeting, **Recordings**, Invites History, Attendance |
| **Drive** | `/govdrive` | My Documents (NEW: Upload / Create Folder), Collaborations, Departments, Historic Files, General Documents (MEMOS, MINUTES_OF_MEETINGS, POLICY_DOCUMENTS folders), Application Documents (ECMS, WFM), Recent, Starred, Trash (30-day), **Audit Log**, **Approval Log**. File actions: Open, Download, Get Link, Copy, **Edit Classification**, Share, View Access, **Sign File**, **Version History**, Move, Star, Details & activity |
| **Assets (IMS)** | `/ims` | Asset Registry (KPI cards, value by repository, by category), Dashboard (received/issuance reports, top-10 requested/purchased), Asset (Categories, Manage/All, Receive, Reserved & Pickup, **Stock Taking** with variance approval, Stock Taking Reason, Stock Transfer, Bin Card, Update Status), Supplier, Returns (to store / to supplier), Approval, Repository, Manage Users, Settings (Source Type, Dimension, Asset Type, Location Type, UOM, Item Status + Rules, Audit, **Email Alert** (min-stock, reorder…), Approval Level, **Payables**) |
| **PMS** | `/pms` | Not reachable with this account: "Unauthorized", then it hangs on "securely connecting you with PMS…" |
| **Paperless Service Portal** | `/selfservice` | Engage Us (≈30 public queues: Complaints, Bid Submission, Fraud & Risk, Marine Casualty, Adult Care, Construction…), Track Engagement (email + Tracking ID), Verify Staff (surname + staff ID) |
| **Public webforms** | `/webform/<name>` | e.g. AI IMPLEMENTATION (process gathering + file upload), DATA CAPTURE (NTA staff data + signature), PAY IN FORM, PARTICIPANT/FACILITATOR EVALUATION, CASH PURCHASE/TOURING ADVANCE |

---

## 2. Cross-cutting AI foundation (build once, use everywhere)

Build the per-module features in section 3 on a shared foundation. That way every module doesn't need its own AI integration.

### 2.1 1Gov AI Gateway (service layer)
- **One internal API** (`/ai/*`) that every app calls: `summarize`, `classify`, `extract`, `draft`, `embed`, `ask`, `transcribe`, `translate`.
- **Sovereignty first.** The platform is branded "Sovereign instance · hosted by Galaxy Backbone", so the gateway must be able to route to:
  - (a) **self-hosted open-weight models** inside the GBB data centre, for *Secret / Confidential* data and anything with personal data;
  - (b) optional **external frontier models** (via an approved, contractually no-training endpoint) for *Official / Public* data, only if policy allows.
  - The routing decision is driven by the **document classification label that Drive already stores** (Official (O), Secret (S), …) and by tenant policy.
- **Prompt and response logging** into the existing Audit Log pattern (ECMS Audit Log, Drive Audit Log, IMS Audit): who asked, what was sent, which model, the output, and whether a human accepted or edited it.
- **PII redaction** before any external call (NIN, BVN, phone, email, staff ID, blood group). Required by NDPA 2023.
- **Cost and quota controls** per tenant/MDA.

### 2.2 Unified index (search and RAG backbone)
- Build a vector + keyword index over Drive files, memos, task titles/remarks, InMail messages/circulars, form submissions and conference transcripts.
- **Permission-trimmed at query time.** Reuse Drive "View Access", ECMS workgroup/role membership and classification. The AI must never surface a document the user couldn't open themselves.
- Incremental ingestion driven by the events that already exist (upload, publish memo, add remark, task closed).

### 2.3 Document Intelligence pipeline (OCR)
- OCR + layout + key-value extraction for PDFs, images and scans. This matches the `newFeatures.md` note "OCR to optimize AI".
- Outputs are searchable PDF text, extracted fields (JSON), detected document type, language, signatures/stamps present, and quality flags.
- It feeds Drive search, form autofill, IMS receipt/invoice capture and Historic Files digitisation.

### 2.4 Event and automation bus
- AI actions are published as **suggestions** (never silent changes) that users accept, edit or reject: suggested queue, suggested assignee, suggested classification, draft reply.
- Acceptance rates are tracked per feature. That becomes the quality KPI and the training signal.

### 2.5 Guardrails and governance
- Human-in-the-loop by default for anything that changes state: approve, route, classify, sign, send.
- Show the evidence: every AI answer cites its source documents/tasks with deep links.
- Model evaluation sets per feature (e.g. 500 labelled historical tasks for routing accuracy).
- An "AI-generated" watermark on drafts in memos, InMail and circulars until a human edits and publishes.
- Tenant-level on/off switches per feature, in ECMS **Settings**.

---

## 3. Module-by-module AI opportunities

For each item: **What**, then **Where in the UI** (exact screen), **How** (technique/data), **Value/KPI**, **Priority** (P1 = next 90 days, P2 = 3–6 months, P3 = 6–12 months) and **Effort** (S/M/L).

---

### 3.1 Workspace Home (`/admin/tenant`)

Today the home page shows "Needs You Today" counters (My Workflows, Tasks Assigned To Me, Pending Approvals), GovMail notifications, Drive files pending acceptance, recent documents and the app launcher.

| # | Opportunity | Where | How | Value / KPI | Pri | Effort |
|---|---|---|---|---|---|---|
| H1 | **AI Daily Brief** ("Good afternoon, Prince…" becomes a real briefing): *"3 approvals are close to SLA breach; memo X was minuted to you; 2 files await acceptance; your 10:00 meeting has a prepared brief."* | Top greeting card | Aggregates tasks, approvals, InMail and Drive events, then an LLM summary with ranked priorities | Time-to-first-action; fewer missed SLAs | P1 | S |
| H2 | **Universal "Ask 1Gov" bar**: natural-language search and commands across all apps (*"find the 2025 procurement policy"*, *"how many complaints are open in Kano?"*, *"create a task for IT support about the printer"*) | Header, all apps | RAG over the unified index + tool-calling into ECMS/Drive/IMS APIs | Search success rate; clicks saved | P1 | M |
| H3 | **Smart prioritisation of "Needs You Today"**, ordered by urgency, SLA risk, sender seniority and consequence | Needs You Today panel | SLA-risk model (see E-T3) + role hierarchy | % of SLA-critical items actioned first | P2 | S |
| H4 | **Personalised app launcher / next step** ("You usually raise a Cash Advance request at month end") | Open an App section | Usage pattern mining | Adoption | P3 | S |
| H5 | **Help Centre copilot**: answers "how do I…" from the 1Gov Help Centre, the GovDrive User Manual (present in General Documents) and Start Tour content, replacing the form-based "Report an Issue" as the first step | Report an Issue / Help Centre links | RAG on help content; escalates to a support ticket with an auto-filled description and screenshot | Support ticket deflection % | P1 | S |
| H6 | **Calendar intelligence** (Calendar page currently renders empty): auto-schedule meetings across participants, detect clashes, suggest times | Calendar | Calendar + Conference data; scheduling assistant | Scheduling time | P3 | M |

---

### 3.2 Request forms (`/admin/tenant/request`, `/ecms/request`, `/webform/*`)

Today there are 20 internal request forms with queue and queue-type binding (e.g. *AI IMPLEMENTATION → PROCESS GATHERING*), Share links, and card/table views.

| # | Opportunity | Where | How | Value / KPI | Pri | Effort |
|---|---|---|---|---|---|---|
| R1 | **"Describe your need" request finder**: the user types *"I need a touring advance for a trip to Kaduna"* and the system opens *CASH PURCHASE/TOURING ADVANCE FORM* pre-filled | Request Forms page, above the cards | Semantic match of intent to form descriptions + extraction into form fields | Wrong-form submissions ↓; completion time ↓ | P1 | S |
| R2 | **Document-to-form autofill**: upload an ID, staff card, invoice or letter and the fields fill themselves (Name, Staff Number, Department, Blood Group…) | Any webform with an upload / "Add File" | Document Intelligence pipeline (2.3) | Typing time ↓ 60–80 %; data errors ↓ | P1 | M |
| R3 | **Photo and signature quality checks**: DATA CAPTURE says "MUST BE ON WHITE BACKGROUND". AI checks background, face presence, blur and signature validity before submit | DATA CAPTURE form, photo/signature fields | Vision model / classical CV | Rejected submissions ↓ | P2 | S |
| R4 | **Smart validation and explanations**: catch inconsistent answers (e.g. amount vs purpose, dates in the past) and explain in plain English | All forms | Rules + LLM explanation | Back-and-forth clarifications ↓ | P2 | S |
| R5 | **Process-documentation analyser** for the AI IMPLEMENTATION form: uploaded process docs are parsed into steps, roles, decisions and a **draft workflow** (links to E-W1) | AI IMPLEMENTATION form → Process Gathering queue | Document → BPMN-like JSON → ECMS workflow draft | Workflow set-up time ↓ from days to minutes | P1 | M |
| R6 | **Duplicate request detection** ("You submitted a similar request on 11 Sep, ID #17492") | On submit | Embedding similarity on recent submissions by the same contact | Duplicate tasks ↓ | P2 | S |
| R7 | **Multilingual forms**: auto-translate forms and responses (English ↔ Hausa, Yoruba, Igbo, Pidgin) | Public webforms | MT model | Citizen reach | P3 | M |

---

### 3.3 ECMS: Dashboards (`/ecms/dashboard/*`)

Today:
- **Workflow Dashboard**: task status cards, a per-queue stacked bar chart, Top Queues and Workflow Summary.
- **Status Dashboard**: pick queue / queue type / date range.
- **Resource Utilization**: organisation and per-department utilization with Download Report.

| # | Opportunity | Where | How | Value / KPI | Pri | Effort |
|---|---|---|---|---|---|---|
| E-D1 | **Narrative insights ("Explain this dashboard")**: *"Order Fulfilment has 11,003 open tasks and only 2 closed in the period. It holds 68 % of all open work. 94 % of those tasks have no assignee."* | Button on each dashboard card/chart | LLM over the aggregates behind the charts; each figure is a link | Management reads insights instead of raw charts | P1 | S |
| E-D2 | **Anomaly alerts**: sudden spikes (e.g. complaints about a location), stalled queues, a department with 0 closures | Dashboard + Daily Brief + InMail notification | Time-series anomaly detection per queue/department | Mean time to detect issues | P2 | M |
| E-D3 | **Backlog forecasting and "what-if" staffing**: *"At current closure rates the Complaints backlog clears in 312 days; adding 3 resources brings it to 41 days"* | Resource Utilization | Queue-theory / regression on task inflow and outflow | Planning quality | P2 | M |
| E-D4 | **Data-consistency checker**: the header cards (161 open) disagree with All Tasks (15,395 open), and utilization shows 0 % while 644 tasks are assigned. An automated check flags such inconsistencies to admins | Admin-only banner | Rule + LLM reconciliation job | Trust in dashboards | P1 | S |
| E-D5 | **Natural-language reporting** (Reports page currently shows "No filters set"): *"Show me turnaround time by department for Q3 as a bar chart, export to Excel"* | Reports | Text-to-query over the reporting schema with guard-rails; chart generation | Report creation time ↓; no need for analysts | P1 | M |
| E-D6 | **Executive auto-reports**: weekly PDF or InMail circular to Perm Sec / DG with KPIs, risks and recommendations | Reports → schedule | Scheduled generation via the AI Gateway | Leadership visibility | P2 | S |

---

### 3.4 ECMS: Tasks and Task Approvals (`/ecms/tasks`, `/ecms/tasks/new`, `/ecms/tasks/approvals`)

Today:
- **Create Task**: pick queue and queue type, then fill the workflow form.
- **All Tasks**: tabs, filters and custom views. Columns: Task ID, Title, Priority, Queue, Status, Assigned To, Awaiting Approval, Approval Status.
- **Task Approvals**: Approval Level/Type, Approver Role, Alternate Approver, Bulk Action.
- The Audit Log shows remarks, task linking and approvals.

| # | Opportunity | Where | How | Value / KPI | Pri | Effort |
|---|---|---|---|---|---|---|
| E-T1 | **Smart Intake and Routing** *(flagship)*: for every incoming task (form, email integration, portal, InMail), predict **Queue, Queue Type, Priority and Assignee/Workgroup**, with a confidence score. High confidence routes itself; low confidence goes to a triage inbox | Create Task (pre-select queue/type), email-to-task, Settings → **Task Routing** | Classifier trained on 16k historical tasks (title, description, contact, attachments) + an LLM fallback for zero-shot on new queues; assignee choice by skills, shift, schedule and current load (from Resources) | Mis-routed tasks ↓; time-to-assignment ↓; the "Order Fulfilment 11k open" backlog starts moving | P1 | M |
| E-T2 | **Task Brief**: a 5-line AI summary at the top of each task (request, history of remarks, attachments, current blocker, what's needed from *you*) | Task detail header | LLM over the task timeline + attachment OCR | Handling time per task ↓ 30–50 % | P1 | S |
| E-T3 | **SLA-breach prediction and smart escalation**: predict which tasks will breach (matches `newFeatures.md` "escalation process on ECMS"). Escalate early to the line manager or alternate approver *with a reason* | All Tasks (risk column), Workflow → **Escalation** step | Survival/GBM model on stage durations; explainable features | SLA compliance %; escalations that land | P1 | M |
| E-T4 | **Suggested reply and remark drafting**: draft the next remark or citizen-facing response in the MDA's tone; one-click insert | Task remarks / reply box | LLM + templates + retrieval of similar resolved tasks | Response time ↓; consistency ↑ | P1 | S |
| E-T5 | **Similar-case and precedent finder**: *"12 similar complaints resolved; typical fix: …"* | Task side panel | Embedding search on closed tasks | First-contact resolution ↑ | P2 | S |
| E-T6 | **Duplicate/spam and test-data detection**: merge duplicates, auto-close junk (the tenant contains many "TEST AUTOMATION…" and gibberish records) | All Tasks, Bulk Action | Similarity + heuristics + LLM judge | Clean backlog | P1 | S |
| E-T7 | **Approval Copilot**: the approver sees a digest (what, amount, policy compliance, prior approvals, anomalies, recommended decision + reason) and can approve in bulk with confidence | Task Approvals, Bulk Action | Retrieve the policy docs (Drive POLICY_DOCUMENTS folder) + rule checks + LLM rationale | Approval cycle time ↓; approval quality ↑ | P1 | M |
| E-T8 | **Auto-linking of related tasks** (Audit Log shows manual "Link Task" actions) | Task detail | Similarity + shared contact/asset/reference IDs | Fewer orphan tasks | P2 | S |
| E-T9 | **Sentiment and urgency detection** on external requests/complaints (angry, safety-critical, VIP, media risk) | Task list badge | Sentiment/urgency classifier | Critical cases seen first | P2 | S |
| E-T10 | **Voice-to-task** (mobile/field): speak a request and a structured task is created | 1Gov Mobile | Speech-to-text + extraction | Field adoption | P3 | M |

---

### 3.5 ECMS: Memos (`/ecms/memos`, `/ecms/memos/new`)

Today there's a rich-text memo editor (font, size, zoom) with Save, Publish, Preview and Settings. Tabs are All Memos, My Drafts and **Draft Reviews**. Memos replace paper file jackets and minuting (the business case's "vanishing file jacket").

| # | Opportunity | Where | How | Value / KPI | Pri | Effort |
|---|---|---|---|---|---|---|
| E-M1 | **Memo Copilot: draft from bullets**. *"Request approval for 3 laptops for ICT, ₦450k, urgent"* becomes a properly formatted civil-service memo (Ref, Date, To/Through/From, Subject, Body, Recommendation) | Create Memo editor, "✨ Draft" button | LLM + MDA memo templates + style guide (Civil Service Rules, Financial Regulations references) | Drafting time ↓ 70 % | P1 | S |
| E-M2 | **Rewrite / tone / length / grammar** (formal, concise, "for Hon. Minister") | Editor toolbar | LLM | Quality and consistency | P1 | S |
| E-M3 | **Minute summariser**: a long file with many minutes becomes a summary: *"Director approved subject to budget; DFA queried amount on 12/09; pending HOD response"* | Memo view / Draft Reviews | LLM over the minute chain | Senior officer read time ↓ | P1 | S |
| E-M4 | **Action-item extraction to ECMS tasks**: "Please treat", "for your action by Friday" become tasks with an assignee and due date | Memo publish / minute | Extraction + E-T1 routing | Decisions become tracked work (business case goal) | P1 | M |
| E-M5 | **Reviewer assistant (Draft Reviews)**: highlights policy conflicts, missing attachments, wrong addressee hierarchy, figures that don't match the attached budget | Draft Reviews | Rules + RAG on Financial Regulations / policies | Fewer returned drafts | P2 | M |
| E-M6 | **Smart routing of memos** ("Through" chain suggestion based on subject and amount thresholds) | Memo Settings | Role hierarchy + thresholds + learned patterns | Correct approval chain first time | P2 | S |
| E-M7 | **Classification suggestion** (Official / Confidential / Secret) as you write | Memo Settings | Sensitive-content classifier | Mis-classification ↓ | P2 | S |
| E-M8 | **Auto-translate / plain-language version** for public circulation | Publish | LLM | Accessibility | P3 | S |

---

### 3.6 ECMS: Workflows, Queues, Workgroups, Forms builder

Today:
- **Create Workflow** has 4 steps: Process (queue, queue type, single-user flag) → Form → Escalation → Approval, with a Help Guide.
- **My Workflows**: 290 workflows, with Queues, Queue Types and Statuses.
- **Workgroups**: 35–110.
- **Create Form**: Internal/External/Capture/Inter MDA/Status, banner and description.
- **Form Analytics**.
- **Setup Wizard**: import departments, roles, users and workflows from a config sheet; map roles.

| # | Opportunity | Where | How | Value / KPI | Pri | Effort |
|---|---|---|---|---|---|---|
| E-W1 | **Prompt-to-Workflow**: *"Vehicle repair request: requester → fleet officer inspection → HOD approval if > ₦200k → procurement → close, escalate after 48h"* generates the queue, queue type, statuses, form fields, escalation timers and approval levels as an editable draft | Create Workflow, step 1 ("Describe your process") | LLM with a JSON schema that matches the ECMS workflow model; validation against existing roles/departments | Workflow build time ↓ from days to minutes | P1 | M |
| E-W2 | **Prompt-to-Form / AI form builder** (matches `newFeatures.md` "current form builder to optimize with AI"). Describe the form or **upload a paper form photo/PDF** and get fields, types, validations and required flags | Create Form | LLM + Document Intelligence (paper form → digital form) | Digitising paper forms at scale | P1 | M |
| E-W3 | **Workflow linting and optimisation**: detect dead statuses, loops, missing escalation, approvals with no active approver, duplicates (e.g. "AI IMPLEMENTATION" vs "(Copy)"), suspended flows still receiving tasks | My Workflows | Graph analysis + LLM explanation | Config quality | P2 | S |
| E-W4 | **Process mining**: learn from task histories where time is lost (e.g. the stage where Complaints wait longest) and recommend changes | Workflow Summary | Process-mining algorithms on status transitions | Turnaround time ↓ | P2 | L |
| E-W5 | **Setup Wizard AI mapper**: upload *any* org chart / staff list / nominal roll (Excel, PDF) and it maps to Departments, Roles, Users and line managers. It deduplicates the 192 roles (e.g. merges "Assistant Director Accounts Admin" variants) | Settings → Setup Wizard, "Map Roles" | Extraction + fuzzy matching + LLM normalisation | Onboarding a new MDA in hours, not weeks | P1 | M |
| E-W6 | **Form Analytics insights**: drop-off fields, confusing questions, suggested simplifications, sentiment of free-text answers | Form Analytics | Funnel analytics + LLM | Completion rate ↑ | P2 | S |
| E-W7 | **Workgroup recommender**: suggest members from skills, department and past participation | Workgroups → Create | Graph/embedding similarity | Faster setup | P3 | S |

---

### 3.7 ECMS: Contacts (CRM/KYC)

Today there are 169 contacts (ID, name, email, phone, lifecycle stage mostly N/A). Contacts are matched to requests.

| # | Opportunity | Where | How | Value / KPI | Pri | Effort |
|---|---|---|---|---|---|---|
| E-C1 | **Contact dedup and entity resolution** (e.g. "Eyitay Abidogun" #175 vs "Eyitayo Abidogun" #165/#168) | Contacts list, on create | Fuzzy name/email/phone matching + LLM judge | Single citizen view | P1 | S |
| E-C2 | **Data-quality clean-up** (junk records like "ewdrftgyh drftgy", invalid phone formats) | Contacts | Validators + anomaly scoring | Clean CRM | P1 | S |
| E-C3 | **Auto-enrichment and lifecycle stage inference** from interaction history (Lifecycle Stage is N/A everywhere) | Contact detail | Rules + LLM over the contact's tasks | Segmentation, reporting | P2 | S |
| E-C4 | **Contact 360 summary**: *"5 requests since July, 2 complaints about delivery, last contact 22/09, sentiment negative"* | Contact detail header | LLM summary | Better service conversations | P2 | S |
| E-C5 | **KYC document extraction** (NIN, CAC, TIN, BVN letters) into contact fields, with checks against validation services | Add Contact / attachments | Document Intelligence + external verification APIs | Onboarding speed, fraud ↓ | P2 | M |

---

### 3.8 ECMS: Users, Roles, Departments, Resources (Type, Level, Shift, Schedule)

Today: 100 users (many "Never logged on"), 192 roles, 8 resources, 17 resource types/levels, shifts and schedules (e.g. "Daily Shift 9:30–4:30", "Dispatch riders shift").

| # | Opportunity | Where | How | Value / KPI | Pri | Effort |
|---|---|---|---|---|---|---|
| E-U1 | **Access-risk and dormant-account analysis**: flag users never logged in, super-admins without recent activity, unusual IP/time logins (Audit Log has IPs) | Users, Audit Log | Anomaly detection on login and audit events | Security posture | P1 | S |
| E-U2 | **Role rationalisation**: cluster 192 roles by permissions and name similarity and propose a clean role catalogue | Roles | Clustering + LLM | Admin simplicity | P2 | S |
| E-U3 | **Skills-based smart dispatch** (already noted as "AI-powered Smart Dispatch" in `usecases/js/data.js`): assign by resource type, level, shift, schedule, location and live load | Resources + Task Routing | Optimisation/assignment algorithm + ML ETA | Utilisation ↑ (currently 0 %) | P1 | M |
| E-U4 | **Shift and schedule optimiser**: propose rosters that meet predicted demand; flag odd entries (e.g. shift "dame 9:30 AM – 4:45 AM", "SIWES 5:00–6:15 AM") | Resource Shift / Schedule | Forecast + constraint solver; validation rules | Coverage vs demand | P2 | M |
| E-U5 | **Access-review copilot** for periodic recertification: *"these 14 users have Asset approval rights but no asset tasks in 6 months"* | Users / Roles | Usage analytics + LLM | Compliance | P3 | S |

---

### 3.9 ECMS: Reports and Audit Log

Today Reports needs filters ("No filters set"). The **Audit Log** records Date, User, IP, Feature, Action and Description (e.g. Link Task, Add Remark, Approve Task), with Download.

| # | Opportunity | Where | How | Value / KPI | Pri | Effort |
|---|---|---|---|---|---|---|
| E-A1 | **Ask the Audit Log**: *"Who approved task 16363 and did they approve it twice?"* The log actually shows ID 16363 approved twice by the same user on 26/09 | Audit Log | Text-to-query + LLM narrative | Audit investigation time ↓ | P1 | S |
| E-A2 | **Audit anomaly detection**: repeated approvals, approvals outside working hours, self-approval, bulk actions, IP changes | Audit Log + alert | Rules + unsupervised anomaly model | Fraud/abuse detection | P1 | M |
| E-A3 | **Auditor pack generator**: for a date range or case, a compiled PDF of the chronology, approvals, documents and exceptions | Audit Log → Download | Retrieval + templated generation | External audit readiness | P2 | S |
| E-A4 | **NL report builder** (see E-D5) | Reports | | | P1 | M |

---

### 3.10 ECMS: Settings (Asset approvals, Thresholds, Call Drivers, Email Integration, Task Routing)

| # | Opportunity | Where | How | Value / KPI | Pri | Effort |
|---|---|---|---|---|---|---|
| E-S1 | **AI Email-to-Task**: incoming mail on integrated accounts is classified, the request extracted, attachments OCR'd, a contact matched and the task routed (E-T1) | Email Integration | IMAP ingest + AI Gateway | Manual email triage removed | P1 | M |
| E-S2 | **Call-driver auto-tagging**: infer the call driver/reason code from the request text (Manage Call Drivers list) | Manage Call Drivers + tasks | Classifier | Clean root-cause reporting | P2 | S |
| E-S3 | **Learned routing rules**: propose Task Routing rules from historical assignments ("90 % of 'printer' tasks go to IT Support → Hardware") | Task Routing | Rule mining | Faster config | P2 | S |
| E-S4 | **Threshold recommendations** for asset approvals, based on value distribution and risk | Asset Thresholds / Flags | Statistics + risk model | Right-sized controls | P3 | S |
| E-S5 | **Input-sanitisation monitor**: a record named `<SCRIPT>ALERT(1)</SCRIPT>` exists in Call Drivers. An AI/security scanner flags injection-like content across config tables | Settings tables | Pattern + LLM classifier | Security hygiene | P1 | S |

---

### 3.11 InMail (`/govmail`)

Today: Inbox (Primary / Notification), Sent, Drafts, **Circulars** (All/Draft), **Broadcast**, Flagged, Starred, Search, and Compose (Message vs Circular).

| # | Opportunity | Where | How | Value / KPI | Pri | Effort |
|---|---|---|---|---|---|---|
| M1 | **Smart compose and reply**: draft official letters/replies from bullet points; tone control; follows the MDA letterhead format | Compose | LLM + templates | Writing time ↓ | P1 | S |
| M2 | **Thread and inbox summarisation**: "Summarise unread" or a TL;DR for long threads | Inbox | LLM | Reading time ↓ | P1 | S |
| M3 | **Priority inbox and auto-labelling** (action required / FYI / circular / approval) | Primary vs Notification tabs | Classifier | Focus | P2 | S |
| M4 | **Email to ECMS task/memo in one click** with the fields pre-filled | Message actions | Extraction + E-T1 | Nothing falls through | P1 | S |
| M5 | **Circular generator and audience targeting**: draft a circular, suggest recipients (departments/grade levels), produce a plain-language summary and a read-receipt analysis | Circular / Broadcast | LLM + directory data | Communication reach | P2 | S |
| M6 | **Phishing / data-leak guard**: warn before sending Secret content externally or to wrong recipients; detect phishing in inbound mail | Compose / Inbox | Classifier + DLP rules | Security | P2 | M |
| M7 | **Semantic mail search** ("the circular about leave allowance last year") | Search Mail | Unified index | Retrieval success | P2 | S |

---

### 3.12 Conference (`/conferencing`)

Today: Rooms (create with access code, mute, moderator and chat/webcam/mic controls), Schedule Meeting, Start meeting, **Recordings** (returned *500 Server Error* during the test), Invites History, **Attendance**.

| # | Opportunity | Where | How | Value / KPI | Pri | Effort |
|---|---|---|---|---|---|---|
| C1 | **Live transcription and captions** (English plus Nigerian languages) | In-meeting | Streaming ASR (self-hosted for sovereignty) | Accessibility, record-keeping | P2 | M |
| C2 | **AI Minutes of Meeting**: summary, decisions and action items, saved automatically to Drive → *MINUTES_OF_MEETINGS* (a folder that already exists) | After meeting / Recordings | ASR + LLM + Drive API | Minutes ready in minutes, not days | P1 | M |
| C3 | **Action items to ECMS tasks** with assignees from the attendance list | Post-meeting | Extraction + E-T1 | Decisions tracked | P1 | S |
| C4 | **Pre-meeting brief**: agenda + relevant docs/tasks for each attendee | Schedule Meeting / invite | RAG | Better meetings | P2 | S |
| C5 | **Recording search** ("where did the DG talk about the budget?") | Recordings | Transcript index with timestamps | Findability | P2 | S |
| C6 | **Attendance analytics** (late joins, no-shows, speaking time) | Attendance | Analytics | Governance | P3 | S |
| C7 | **Smart scheduling** across calendars | Schedule Meeting | Scheduling assistant | Time saved | P3 | M |

---

### 3.13 Drive (`/govdrive`)

Today: My Documents, Collaborations, Departments, **Historic Files**, General Documents, Application Documents, Recent, Starred, Trash, **Audit Log**, **Approval Log**. Files carry a **Classification** (Official (O), Secret (S)…). Actions include Sign File, Version History, View Access, Share and Edit Classification.

| # | Opportunity | Where | How | Value / KPI | Pri | Effort |
|---|---|---|---|---|---|---|
| D1 | **"Summarise this document"** (PDF/DOCX/PPTX/XLSX): executive summary, key points, figures, dates (Phase 1 in the internal AI.md) | File viewer / row menu → "Summarise" | Text extraction/OCR + LLM | Reading time ↓ | P1 | S |
| D2 | **Chat with document / folder** (Q&A with citations), e.g. ask questions of "Budget FMLD_1224_V 2.pdf" | File viewer, folder view | RAG, permission and classification aware | Knowledge access | P1 | M |
| D3 | **OCR + searchable text for scans**, especially **Historic Files** (legacy file jackets) | Upload pipeline, Historic Files | Document Intelligence | Historic archive becomes searchable | P1 | M |
| D4 | **Auto-classification suggestion** (Official / Confidential / Secret / Top Secret) + PII detection before sharing | Upload, Edit Classification, Share | Sensitive-content classifier | Mis-classification and leakage ↓ | P1 | M |
| D5 | **Auto-filing and metadata tagging**: suggest folder, department, document type, tags, retention period (fills the "no custom metadata" gap noted in `All.md`) | Upload | Classifier + extraction | Findability; records compliance | P2 | M |
| D6 | **Semantic search** across My Documents, Departments, General, Application and Historic | Search files | Unified index | Search success | P1 | M |
| D7 | **Version-diff explainer**: "What changed between v3 and v4?" in plain English, with risk highlights for contracts | Version History | Diff + LLM | Review time ↓ | P2 | S |
| D8 | **Smart e-signature**: auto-detect signature/initial/date fields and reuse templates; check that the signer matches the approval chain | Sign File | Layout detection + rules | Signing set-up time ↓ | P2 | M |
| D9 | **Contract/clause intelligence (ClauseGuard)**: missing clauses, deviations from template, renewal-date alerts, NDPA 2023 checks | Documents tagged as contracts | LLM + clause library | Legal risk ↓ | P3 | L |
| D10 | **Anomalous access detection** (mass downloads, off-hours Secret file access, unusual sharing) | Audit Log | UEBA-style anomaly model | Insider-threat detection | P2 | M |
| D11 | **Duplicate / near-duplicate files and storage clean-up** | Drive-wide | Hashing + embeddings | Storage cost ↓ | P3 | S |
| D12 | **Translation of documents** (keeps the layout) | File viewer | MT | Inter-MDA and public use | P3 | M |
| D13 | **Remarks and conversation on documents, with AI** (from `newFeatures.md`): comment threads on a file with an AI participant that answers, summarises the discussion, and turns comments into tasks | File viewer / Collaborations | RAG + E-T1 | Collaboration without email ping-pong | P2 | M |

---

### 3.14 Assets / IMS (`/ims`)

Today:
- **Asset Registry** KPIs: total assets, value, repositories, categories, available/reserved/issued/returned/damaged/obsolete, awaiting put-away, pending inspection.
- **Dashboard**: received/issuance reports, top-10 requested/purchased.
- **Receive**: with I&QA comment and put-away.
- **Reserved & Pickup**: linked to ECMS task IDs.
- **Stock Taking**: previous vs new quantity, variance, approve/reject, bulk upload.
- **Stock Transfer**, **Returns**, **Bin Card**, **Payables**: supplier, I&QA/Store/Costing sign-offs, unit price.
- **Email Alerts**: min stock, reorder, awaiting I&QA….

| # | Opportunity | Where | How | Value / KPI | Pri | Effort |
|---|---|---|---|---|---|---|
| A1 | **KPI and data-quality guardian**: flag impossible values on the Registry. *Average asset cost ₦5.40bn > total value ₦1.11bn; "25,160,250 available" vs 38 assets; Stock-Taking Reason purpose "undefined"* | Asset Registry, settings tables | Validation rules + anomaly detection + LLM explanation | Trustworthy asset figures for audit | P1 | S |
| A2 | **Invoice / delivery-note / waybill OCR in Receive Asset**: extract supplier, items, qty, unit price, then match against the PO/request (three-way match) and pre-fill the receipt and payables | Receive Asset, Payables | Document Intelligence + matching | Data entry ↓; payment errors ↓ | P1 | M |
| A3 | **Stock-take variance explainer and fraud flags**: explain each variance using transfers, issues and returns history; flag suspicious patterns (repeated small losses, same user, same store) | Stock Taking Mang. (approve/reject) | Reconciliation + anomaly model + LLM narrative | Shrinkage ↓; faster approvals | P1 | M |
| A4 | **Demand forecasting and reorder recommendations**: predict consumption per store/category (e.g. stationery, beverages) and propose reorder points instead of fixed "minimum stock" alerts | Email Alert (Minimum Stock / Reorder), Dashboard | Time-series forecasting | Stock-outs and over-stock ↓ | P2 | M |
| A5 | **Photo-based asset capture and condition check**: snap a photo, and the category, model and serial (OCR) are detected along with damage status | Create asset, Update Asset Status, Returns | Vision model + OCR | Registration speed; condition accuracy | P2 | M |
| A6 | **Smart categorisation and UOM normalisation** (e.g. "Reams / Reams 1 / Reams 2 / ream@unit" duplicates; "Intagible", "Testt" asset types) | Settings: UOM, Asset Type, Category | Clustering + LLM normalisation | Clean master data | P1 | S |
| A7 | **Payables anomaly detection**: price outliers vs history/market, split purchases below approval thresholds, duplicate invoices | Payables | Statistics + rules + LLM | Procurement fraud ↓ | P1 | M |
| A8 | **Put-away optimisation**: suggest the bin/locator using capacity (the UI already shows "Kubwa Sub-Store Locator B-01-02-02 at 91 % capacity") | Receive → Put away | Optimisation | Warehouse efficiency | P3 | M |
| A9 | **Natural-language asset queries**: *"How many laptops are issued to Admin and older than 4 years?"* | Registry search / Ask-1Gov | Text-to-query | Self-service reporting | P2 | S |
| A10 | **Predictive maintenance / lifecycle** for equipment (power, cleaning equipment), recommending repair vs replace | Asset detail | Usage + age + failure history model | Asset uptime; budget planning | P3 | L |

---

### 3.15 PMS: Performance Management (`/pms`)

We couldn't access PMS during the test: it showed "Unauthorized" and then hung on "securely connecting…". These are the usual PMS opportunities, to confirm once we have access.

| # | Opportunity | How | Pri |
|---|---|---|---|
| P1 | **SMART-goal / KPI writer**: turn a vague objective into measurable KPIs aligned to MDA mandate | LLM with KPI library | P2 |
| P2 | **Evidence-based appraisal drafts**: pull completed ECMS tasks, memos, closed tickets and approvals as evidence for each KPI, and draft the self-appraisal | Cross-app retrieval | P2 |
| P3 | **Bias and consistency checks** on supervisor ratings (grade inflation, outliers between departments) | Statistics + LLM flags | P3 |
| P4 | **Training recommendations** from performance gaps (links to "Test your knowledge" portals) | Recommender | P3 |
| P5 | **Performance dashboards narrative** for HR and leadership | LLM over aggregates | P3 |

---

### 3.16 Paperless Service Portal (`/selfservice`) and Inter-MDA

Today: **Engage Us** (≈30 public queues, 2 pages, e.g. Complaints (7), Product development (13), Bid Submission, Fraud and Risk Management, Marine Casualty & Incident Investigation), **Track Engagement** (email + Tracking ID), **Verify Staff** (surname + staff ID). The Inter-MDA page in Workspace rendered empty.

| # | Opportunity | Where | How | Value / KPI | Pri | Effort |
|---|---|---|---|---|---|---|
| S1 | **Citizen Assistant (chat)**: *"I want to report a marine accident"* leads to the right queue and a conversational form fill with document upload + OCR, then a Tracking ID. Available on the web, WhatsApp and USSD/SMS fallback | Portal home, Engage Us | LLM + tool calls into the public webform APIs + E-T1 routing | Citizens don't need to know the MDA's internal queue names; completion ↑ | P1 | M |
| S2 | **Status-in-plain-language**: Track Engagement returns *"Your complaint is with the Customer Service unit. An officer added a note on 24 Sep asking for your receipt. Please upload it here."* | Track Engagement | LLM over the task timeline (citizen-safe fields only) | Follow-up calls/visits ↓ | P1 | S |
| S3 | **FAQ / policy answers** before a ticket is raised (deflection) | Portal | RAG over published policies and FAQs | Ticket volume ↓ | P2 | S |
| S4 | **Fraud and impersonation checks**: Verify Staff + detection of scam patterns reported by citizens; ID photo liveness check | Verify Staff | Rules + vision | Public trust | P3 | M |
| S5 | **Inter-MDA smart referral**: the AI detects a request that belongs to another MDA and proposes a referral with a summary (a big win for the "Engage other MDAs on 1Gov" banner) | Inter-MDA, task routing | Cross-tenant classification with consent | Mis-directed requests ↓ | P2 | M |
| S6 | **Voice and local languages** for accessibility | Portal / WhatsApp | ASR + TTS + MT | Inclusion | P3 | M |

---

### 3.17 Mobile apps, Desktop and support

| # | Opportunity | Where | Pri |
|---|---|---|---|
| X1 | **1Gov Mobile "Approve by voice/summary"**: read the AI approval digest, then approve/reject with a reason, from the phone | 1Gov Mobile | P2 |
| X2 | **Camera-scan to Drive with OCR** (Gov Drive mobile) | Gov Drive app | P1 |
| X3 | **Gov OTP risk-based authentication**: challenge only on unusual login context (device, IP, time), cutting OTP friction | Gov OTP / login | P3 |
| X4 | **Support triage AI**: the "Report an Issue" form auto-attaches context (page, error, browser) and classifies severity; known issues answered right away | Support webform | P1 |

---

## 4. Suggested delivery roadmap

### Phase 1 (0–90 days): "Assist" (low risk, high visibility)
1. AI Gateway + audit logging + PII redaction (2.1, 2.5)
2. Document Intelligence v1: OCR + summary in Drive (**D1, D3**), memo/attachment summaries
3. **Memo Copilot** (E-M1, E-M2, E-M3)
4. **Task Brief + suggested replies** (E-T2, E-T4)
5. **Smart Intake and Routing v1** in suggestion mode (E-T1) + Email-to-Task (E-S1)
6. **Dashboard narratives + data-consistency checks** (E-D1, E-D4, A1)
7. **Help/Support copilot** (H5, X4)
8. Data hygiene sprint using AI: contacts dedup (E-C1/C2), IMS master-data normalisation (A6), config linting (E-W3), security scan (E-S5)

### Phase 2 (3–6 months): "Automate"
- Ask-1Gov RAG search across apps (H2, D2, D6, M7)
- Prompt-to-Workflow / Prompt-to-Form / Setup Wizard AI mapper (E-W1, E-W2, E-W5)
- SLA-breach prediction and smart escalation (E-T3)
- Approval Copilot (E-T7) + audit anomaly detection (E-A2)
- IMS invoice OCR + three-way match, variance explainer, payables anomalies (A2, A3, A7)
- AI Minutes of Meeting (C2, C3)
- Citizen Assistant + plain-language tracking (S1, S2)
- Auto-classification and PII detection in Drive (D4)

### Phase 3 (6–12 months): "Optimise"
- Process mining (E-W4), backlog forecasting (E-D3), shift optimiser (E-U4)
- Demand forecasting (A4), predictive maintenance (A10)
- ClauseGuard contract intelligence (D9)
- PMS copilot (P1–P5), Inter-MDA smart referral (S5)
- Multilingual voice (S6, C1)

---

## 5. Reference architecture

```
 ┌──────────── 1Gov apps (Workspace, ECMS, InMail, Conference, Drive, IMS, PMS, Portal) ────────────┐
 │  UI: "✨" buttons, side panels, Ask-1Gov bar, suggestion chips (accept / edit / reject)           │
 └──────────────────────────────┬────────────────────────────────────────────────────────────────────┘
                                │ REST / events
                  ┌─────────────▼──────────────┐
                  │       1Gov AI Gateway      │  authN (existing token) · policy engine (classification,
                  │  summarize|classify|extract│  tenant, feature flags) · PII redaction · rate/cost limits
                  │  draft|ask|embed|transcribe│  · prompt/response audit log · evaluation hooks
                  └───┬───────────┬────────────┘
         ┌────────────┘           └──────────────┐
 ┌───────▼────────┐      ┌────────────────┐   ┌──▼─────────────────────┐
 │ Sovereign LLM  │      │ Doc Intelligence│   │ Unified Index           │
 │ (self-hosted,  │      │ OCR · layout ·  │   │ vector + keyword,       │
 │ GBB DC) for    │      │ key-value · sig │   │ permission-trimmed      │
 │ Secret/PII     │      │ & stamp detect  │   │ (Drive ACL, workgroups, │
 ├────────────────┤      └────────────────┘   │ classification labels)  │
 │ Optional cloud │                           └─────────────────────────┘
 │ model (Official│      ┌────────────────┐   ┌─────────────────────────┐
 │ /Public only)  │      │ ML models:     │   │ Event bus: task created,│
 └────────────────┘      │ routing, SLA,  │   │ file uploaded, memo     │
                         │ anomaly, fcst  │   │ published, meeting ended│
                         └────────────────┘   └─────────────────────────┘
```

**Data already available to train and evaluate on:** about 16k historical tasks with queue/type/status/assignee, the audit logs (ECMS, Drive, IMS), 290 workflow definitions, form submissions, IMS receipt/transfer/stock-take history, and Drive documents with classification labels.

---

## 6. KPIs to track (per feature)

| Area | KPI | Baseline seen / to measure |
|---|---|---|
| Routing | % tasks auto-routed correctly; time to first assignment | Order Fulfilment: 11,003 open vs 1 in progress |
| SLA | % tasks closed within SLA; escalations raised before breach | Closed tasks: 14 (dashboard card) / 157 (utilization page) |
| Productivity | Avg handling time per task; memos drafted per officer per day | Measure pre-launch |
| Utilisation | Avg resource utilisation | **0 %** today |
| Documents | % of Drive/Historic files that are text-searchable; search success rate | Measure pre-launch |
| Data quality | # KPI inconsistencies; duplicate contacts; duplicate master-data entries | Several found (sections 3.3, 3.7, 3.14) |
| Citizen | Portal completion rate; follow-up enquiries per ticket; CSAT | Measure pre-launch |
| AI quality | Suggestion acceptance rate; edit distance on drafts; hallucination reports | New |
| Cost | AI cost per task/document; % handled by sovereign vs cloud model | New |

---

## 7. Risks and controls

| Risk | Control |
|---|---|
| Classified/Secret data leaving the sovereign boundary | Classification-driven model routing; self-hosted models for S/TS; no external calls without policy approval |
| Wrong AI decision on approvals/routing | Suggestion-only mode first; confidence thresholds; human sign-off on state changes; full audit trail |
| Hallucinated facts in memos, answers or citizen replies | RAG with mandatory citations; "AI-generated" label until edited; blocked phrases for commitments/legal promises |
| Privacy (NDPA 2023) for citizen data (NIN, blood group, signatures) | PII redaction, purpose limitation, retention rules, DPIA per feature |
| Bias in routing, appraisal or fraud models | Fairness checks per department/region; explainable features; periodic review |
| Adoption resistance | Start with "assist" features that save time for officers (memo drafting, summaries), then automation |
| Poor data quality undermining models | Phase-1 AI-driven data-hygiene sprint (contacts, master data, test records) |

---

## 8. Issues observed during the walkthrough (non-AI, for the QA backlog)

These came up while crawling. They're worth fixing before or alongside the AI work, because several affect data the AI would use.

1. **1Gov Desktop** (`/admin/tenant/desktop`) returns **502 Bad Gateway** (`screenshots/ws_desktop.png`).
2. **Deep links to ECMS routes** (e.g. `/ecms/overview` opened directly) return **502 Bad Gateway**. The app only works when entered via the `?authorize=` link.
3. Opening the legacy **`/wfm`** or **`/cde`** URLs **ends the whole session** (it redirects to the `www.convergenceondemand.com` login, and the token is revoked).
4. **Conference → Recordings** returns **500 Server Error**.
5. **PMS**: "Unauthorized", then it hangs on "securely connecting you with PMS…" for this account (`screenshots/pms2.png`).
6. **Calendar** and **Inter-MDA** pages render empty (no content, no empty state).
7. The **Home app launcher tiles** (ECMS/InMail/Conference/Drive/Assets/PMS) disappeared later in the same session; only "Open ECMS" remained.
8. **The dashboards disagree with each other.** Workflow Dashboard shows 161 open / 26 in progress / 14 closed. All Tasks shows 15,395 open / 488 in progress. Resource Utilization shows 157 closed and 0 % utilisation.
9. **All Tasks → "All Tasks" tab shows "No data found"** despite the header saying 15,883 total tasks.
10. **IMS Asset Registry KPIs are inconsistent**: average cost (₦5.40bn) is higher than total value (₦1.11bn), and 25,160,250 "available" is against 38 total assets. The page is also marked "COMING SOON".
11. **Stock Taking Reason** "Purpose" shows the literal value `undefined`.
12. **A Call Drivers entry named `<SCRIPT>ALERT(1)</SCRIPT>`** exists. It is rendered as text (good), but it confirms there's no input sanitisation or validation on config names.
13. **Odd shift data** (e.g. "dame 9:30 AM – 4:45 AM", "SIWES 5:00 AM – 6:15 AM") suggests there's no validation that end time > start time.
14. **Drive → Approval Log**: "You don't have access to the approval log", shown as a page rather than hidden from the menu for users without access.

---

## 9. Alignment with existing internal notes

| Internal note | Covered by |
|---|---|
| `newFeatures.md`: "escalation process on ECMS" | E-T3, E-W1 (escalation step), E-D2 |
| `newFeatures.md`: "document assistants" | D1, D2, D13, E-M1–M5 |
| `newFeatures.md`: "current form builder to optimise with AI" | E-W2, E-W6, R1–R4 |
| `newFeatures.md`: "remarks and conversation on document" | D13, E-T4 |
| `newFeatures.md`: "OCR to optimise AI" | 2.3, D3, R2, A2, E-C5 |
| `competitive_analysis/.../NEWFEATURES/AI.md` pillars (ECMS Vision, Docket Copilot, SmartRoute, ClauseGuard, Prompt-to-Process) | ECMS Vision = 2.3/D3/A2; Docket Copilot = D1/D2/E-M3; SmartRoute = E-T1/E-S1; ClauseGuard = D9; Prompt-to-Process = E-W1/E-W2 |
| `usecases/js/data.js`: "AI-powered Smart Dispatch" | E-U3 |

**What this document adds beyond those notes:**
- AI for **IMS/Assets** (A1–A10), **Conference** (C1–C7), **InMail/Circulars** (M1–M7), the **Citizen Portal** (S1–S6), **Audit/Security** (E-A1–A3, E-U1, D10) and **data-quality clean-up** of the live tenant.
- A **sovereign, classification-aware AI gateway** design.

---

## Appendix A: Evidence screenshots (`./screenshots/`)

| File | Shows |
|---|---|
| `ECMS_Workflow_Dashboard.png` | Task status cards, queue backlog (Order Fulfilment 11,006) |
| `ECMS_Resource_Utilization.png` | 0 % utilisation, per-department table |
| `ECMS_All_Tasks.png`, `ECMS_Task_Approvals.png` | Task list and approval queue columns |
| `ECMS_Create_Memo.png` | Memo editor (target for Memo Copilot) |
| `ECMS_Create_Workflow.png`, `ECMS_Create_Form.png`, `ECMS_Setup_Wizard.png` | Builders (target for Prompt-to-Workflow/Form) |
| `ECMS_Workgroups.png`, `ECMS_Contacts.png`, `ECMS_Audit_Log.png` | Config, CRM, audit data |
| `ws_request.png`, `webform_ai_implementation.png`, `webform_data_capture.png` | Request forms / public webforms |
| `Drive_General_Documents.png`, `drive_row_menu.png` | Classified files and file actions (Sign, Version History, Classification) |
| `Assets_Asset_Registry.png`, `Assets_Dashboard.png`, `Assets_Stock_Taking_Mang_.png`, `Assets_Received_Asset_History.png`, `Assets_Payables.png` | IMS KPIs, variances, receipts, payables |
| `Conference_landing.png`, `conf_create2.png` | Rooms and room creation |
| `inmail_compose2.png` | InMail compose (Message / Circular) |
| `self_Engage_Us.png` | Citizen portal queues |
| `pms2.png`, `ws_desktop.png` | PMS access issue, Desktop 502 |

## Appendix B: Limits of this walkthrough
- The walkthrough was **read-only**, done with a **Product Manager / "User" role** account. Admin-only screens, PMS, the Drive Approval Log and task detail views (the task lists returned no rows for this role) weren't fully visible. A pass with an admin account is recommended to confirm the task-detail, memo-detail and PMS opportunities.
- We didn't submit any forms, create any records or change any data.
