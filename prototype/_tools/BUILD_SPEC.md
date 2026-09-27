# Build spec for CICOD-AI components (for all builders)

Root: `C:\Users\CI-STAFF\Documents\CICOD TEST\CICOD-AI Implementation\prototype\`

## Read first (mandatory)
1. `components/ecms/smart-routing/index.html`, `smart-routing.css`, `smart-routing.js`. This is the **reference implementation**. Copy its structure, section order, tone and level of detail exactly.
2. `shared/tokens.css`: use only these CSS variables and primitives (`.g-btn`, `.g-btn--ai`, `.g-btn--primary`, `.g-input`, `.g-select`, `.g-textarea`, `.g-label`, `.g-card`, `.g-chip*`, `.g-table`, `.g-table-wrap`, `.ai-badge`, `.ai-skeleton`, `.ai-confidence`). Never hard-code colours in component CSS; use `var(--…)`.
3. `shared/shell.js`: the app chrome. Use `<div id="screen" class="shell" data-app="<app>" data-active="<nav item>"><div class="shell__content">…</div></div>`. Valid `data-app` values are workspace, ecms, inmail, drive, ims, conference, pms and portal. `data-active` must exactly match a nav label in shell.js NAV (read the file).
4. `shared/ai-gateway.js`: always call `AIGateway.request(endpoint, payload, { mock, feature })`, `AIGateway.feedback(id, feature, action)` and `AIGateway.esc()`. **Escape all dynamic text** with `esc()` before it goes into innerHTML.
5. `shared/registry.js`: your component's slug, title, code, screen and tag. Use exactly these values.
6. `shared/doc.css`: the explainer-page classes (doc__hero, doc__section, doc__where, doc__flow/doc__step, doc__benefits/doc__benefit, doc__cols, doc__panel, doc__code, doc__list, doc__audit).
7. `../AI_Augmentation_Opportunities.md`: the analysis. Find your component's codes (e.g. E-T2) for the what, where and why.
8. Live data from the real tenant, for realistic mock screens: `C:\Users\CI-STAFF\AppData\Local\Temp\claude\C--Users-CI-STAFF-Documents-CICOD-TEST\99b672f7-7e17-4f19-8172-821be667abfa\scratchpad\explore\crawl.json` and `pass2.json`. They hold page text, buttons, inputs, labels and table headers for every screen. Screenshots are in `...\scratchpad\explore\pages\*.png` and `CICOD-AI Implementation\screenshots\*.png`. Use the Read tool to view a screenshot of the screen you're replicating. **Do not copy emails or phone numbers into mocks.** Staff first names/surnames already visible in the analysis doc are fine.

## For each component, create exactly 3 files
`components/<group>/<slug>/index.html`, `components/<group>/<slug>/<slug>.css`, `components/<group>/<slug>/<slug>.js`

### `<slug>.js`
- Wrap it in an IIFE and define **one custom element** (the tag in registry.js, e.g. `<ai-task-brief>`), using light DOM like the reference.
- Configure it through attributes. Report outcomes through `CustomEvent`s (bubbles: true), named `ai-<something>`. The host page applies changes; the component never changes host data directly.
- Include a realistic `mock(payload)` that produces **input-dependent** output, not just a fixed string, wherever the user can type or choose something. Use real 1Gov names: queues (Order Fulfilment, Complaints, IT Support, TEST AUTOMATION, Product development, CICOD-AI IMPLEMENTATION), departments, stores (Central Store, Kano store, Holding Areas, Secondary Store), and figures from crawl.json.
- Show loading states with `.ai-skeleton`. The CICOD-AI output must always offer accept/edit/reject (or equivalent) and call `feedback()`. Show the model name and confidence where it makes sense.
- Put a header comment in the same style as the reference: purpose, attributes, events, and the gateway endpoint with its request/response shape.

### `<slug>.css`
- Styles for the component only. Every class carries a unique short prefix (e.g. `aitb-` for task-brief). Target the custom-element tag with `display:block`.
- It must work at 390px width, with no horizontal overflow; wrap or stack as needed.

### `index.html`
Same skeleton as the reference:
- `<title>`: two to four words, no colon.
- Link `../../../shared/tokens.css`, `shell.css`, `doc.css` and the component CSS. Page-only mock-screen CSS goes in a `<style>` block with its own prefix.
- **Hero**: badge `"<GROUP> · <code> · Priority/Phase n"`, h1 = registry title, a paragraph explaining the feature, and chips (Screen, Component tag, Endpoint). Toolbar has the placement toggle (`data-toggle-spots="#screen"`, checked) and the theme button.
- **Section 1, "Where it goes: live demo"**: a faithful copy of the real 1Gov screen inside the shell. Use the real labels, buttons and table columns from crawl.json, and 5–10 realistic rows where the screen has a table. Wrap every CICOD-AI surface in `data-ai-spot="CICOD-AI · <short label>"`. It can have more than one spot (e.g. a column badge plus a drawer). Tell the reader exactly what to type or click. Then add a `doc__where` grid (Primary placement with the real route, Also appears in, Trigger, Who sees it) and `<div class="doc__audit" data-audit-log></div>`.
- **Section 2, "How it works"**: 5–6 `doc__step`s covering data captured, gateway protection (PII redaction, classification routing, sovereign model), the model or technique, output, and human confirmation with the feedback loop.
- **Section 3, "Benefits to this feature"**: 4–5 `doc__benefit`s with KPI numbers. Where possible, use the real baselines from the tenant or the analysis doc, and say they are targets where they are.
- **Section 4, "How to implement it"**: two columns. Left: a mount snippet (`doc__code`) plus build steps. Right: the API contract (`doc__code`) plus Controls (feature flag `ai.<group>.<camelSlug>`, thresholds, audit, permission trimming).
- Scripts at the end, in this order: `../../../shared/shell.js`, `ai-gateway.js`, `doc.js`, then `<slug>.js`, then a small inline host-wiring script that listens for the component's events and updates the mock screen visibly.
- Breadcrumb: `<a href="../../../index.html">CICOD-AI Components</a> / <Group> / <Module>`.

## Quality bar
- Plain vanilla JS (no frameworks, no build step, no external scripts). Must work over `file://`.
- The interaction must work end to end: type or click, see a skeleton, see the CICOD-AI result, accept it, and see the mock screen change.
- Write in plain English with specific, concrete wording, like the reference.

## Verify every page before you finish
Run from the prototype folder (Bash):
```
cd "/c/Users/CI-STAFF/Documents/CICOD TEST/CICOD-AI Implementation/prototype"
SHOT_DIR="C:/Users/CI-STAFF/AppData/Local/Temp/claude/C--Users-CI-STAFF-Documents-CICOD-TEST/99b672f7-7e17-4f19-8172-821be667abfa/scratchpad" node _tools/check.cjs components/<group>/<slug>/index.html "<css selector to type into or ->" "<text>" "<css selector to click>"
node _tools/check.cjs components/<group>/<slug>/index.html --mobile
```
It prints `{errs, horizontalOverflow, shot}`. Errors must be `[]` and overflow must be `false` at both sizes. Open the screenshot with Read and check that it looks right. Fix any problems before finishing.

Do NOT edit anything in `shared/` or other builders' component folders. If you think a shared change is needed, say so in your final report instead.
Final report: list the files created, the verification results for each page, and any caveats (under 200 words).
