/* <ai-workflow-builder>
   "Describe your process" box above the ECMS Create Workflow wizard. The officer writes the
   process in plain English and gets an editable draft that matches the ECMS workflow model:
   queue, queue type, statuses (shown as a flow), form fields, escalation timers and approval
   levels with amount thresholds. The draft is checked against the tenant (lint): stages with no
   escalation, approver roles with no active users, workflows that already exist.
   The component never saves a workflow. "Apply to wizard" hands the draft to the host page,
   which fills the Process / Form / Escalation / Approval tabs for the officer to review.
   Attributes:
     queues   optional comma-separated list of existing queue names (defaults to cicod queues)
   Events (bubbles):
     ai-workflow-apply   detail: { draft }   host fills the wizard tabs
     ai-workflow-result  detail: gateway response
   Gateway: POST /ecms/workflow/draft { prompt, tenantQueues[] }
     -> { model, confidence, draft:{ name, queue, queueIsNew, queueType, singleUser, statuses:[{name,role,escalation}],
          fields:[{label,type,required,options?}], escalation:[{status,after,to,level}], approvals:[{level,role,condition}] },
          lint:[{level:'bad'|'warn'|'info', text}] } */
(function () {
  const { request, feedback, esc } = window.AIGateway;

  // Prototype-only tenant knowledge, taken from the cicod tenant (My Workflows, Roles, Users).
  const QUEUES = [
    { k: /vehicle|car|fleet|auto|mechanic/i, name: 'AUTO MOBILE REPAIR', existing: 'AUTO MOBILE REPAIR · REPAIR DEATAILS (22/09/2026, TESTING ACCOUNT)' },
    { k: /laptop|printer|computer|network|ict|it support|password|email/i, name: 'IT Support', existing: 'IT Support · Hardware & Network' },
    { k: /complain|grievance|petition/i, name: 'Complaints', existing: 'Complaints · Application issue' },
    { k: /order|dispatch|deliver|fulfil/i, name: 'Order Fulfilment', existing: 'Order Fulfilment · Delivery' },
    { k: /ai |automation|process gathering/i, name: 'CICOD-AI IMPLEMENTATION', existing: 'CICOD-AI IMPLEMENTATION · PROCESS GATHERING (11/09/2026, Chinwuba Okafor)' },
  ];
  const ACTIVE_USERS = { 'Fleet Officer': 0, 'HOD Works': 2, 'Head of Department': 3, 'Head, Procurement': 1, 'Director, Finance & Accounts': 1, 'Permanent Secretary': 1, 'Store Officer': 3, 'IT Resource': 2, 'Complaints Handler': 4, 'Internal Auditor': 0, 'Legal Adviser': 0, 'Director': 4, 'Inspection Officer': 1, 'Dispatch Officer': 2, 'Director, Human Resource Management': 1 };

  const MULT = { k: 1e3, m: 1e6, million: 1e6, thousand: 1e3 };
  const amountIn = s => { const m = s.match(/(?:₦|\bN(?=\d)|NGN\s?)?\s?(\d[\d,]*(?:\.\d+)?)\s*(k|m|million|thousand)\b|(?:₦|\bN(?=\d)|NGN\s?)(\d[\d,]*)/i); if (!m) return null; return m[3] ? +m[3].replace(/,/g, '') : parseFloat(m[1].replace(/,/g, '')) * (MULT[m[2].toLowerCase()] || 1); };
  const naira = n => '₦' + n.toLocaleString('en-NG');
  const title = s => s.replace(/\b\w/g, c => c.toUpperCase());

  function roleFor(chunk, vehicle) {
    if (/\bDFA\b|finance|accounts/i.test(chunk)) return 'Director, Finance & Accounts';
    if (/perm(anent)? sec|\bPS\b/i.test(chunk)) return 'Permanent Secretary';
    if (/\bHOD\b|head of department/i.test(chunk)) return vehicle ? 'HOD Works' : 'Head of Department';
    if (/fleet/i.test(chunk)) return 'Fleet Officer';
    if (/procure|purchas|\bLPO\b/i.test(chunk)) return 'Head, Procurement';
    if (/audit/i.test(chunk)) return 'Internal Auditor';
    if (/legal/i.test(chunk)) return 'Legal Adviser';
    if (/\bHR\b|human resource|personnel/i.test(chunk)) return 'Director, Human Resource Management';
    if (/store/i.test(chunk)) return 'Store Officer';
    if (/\bIT\b|technician|ict/i.test(chunk)) return 'IT Resource';
    if (/director/i.test(chunk)) return 'Director';
    return null;
  }

  function mockDraft({ prompt = '' }) {
    const text = prompt.trim();
    const vehicle = /vehicle|car|fleet|auto|mechanic/i.test(text);
    const nameMatch = text.match(/^([^:→\n]{3,60}):/);
    const name = (nameMatch ? nameMatch[1] : text.split(/[\s,.]+/).slice(0, 3).join(' ')).trim();
    const q = QUEUES.find(x => x.k.test(text));
    const body = nameMatch ? text.slice(nameMatch[0].length) : text;
    const chunks = body.split(/→|->|=>|\bthen\b|;|\n|,(?![\d])/i).map(s => s.trim()).filter(Boolean);
    const statuses = [{ name: 'OPEN', role: 'Requester', escalation: null }];
    const approvals = []; let escHours = null; let escTarget = null; const lint = [];
    chunks.forEach(c => {
      const h = c.match(/escalat\w*[^\d]*(\d+)\s*(h|hrs?|hours?|d|days?)\b/i) || c.match(/(\d+)\s*(h|hrs?|hours?)\b.*escalat/i);
      if (/escalat/i.test(c)) { if (h) escHours = /^d/i.test(h[2]) ? +h[1] * 24 : +h[1]; escTarget = (c.match(/escalate (?!after|at|in|if|when|to|all)(\w+)/i) || [])[1]; return; }
      if (/^(requester|request|submit|raise|staff (submits|raises)|user)/i.test(c)) return;
      if (/\b(close|closed|complete|completed|done|end)\b/i.test(c) && c.split(/\s+/).length <= 3) return;
      let stage;
      if (/inspect|verif|assess/i.test(c)) stage = { name: 'Inspection', role: roleFor(c, vehicle) || (vehicle ? 'Fleet Officer' : 'Inspection Officer') };
      else if (/approv/i.test(c)) {
        const role = roleFor(c, vehicle) || 'Director';
        const amt = amountIn(c);
        const cond = amt ? (/(<|below|under|less)/i.test(c) ? `amount ≤ ${naira(amt)}` : `amount > ${naira(amt)}`) : 'all requests';
        stage = { name: `${role.replace(/^Director, Finance & Accounts$/, 'DFA').replace(/^Head of Department$/, 'HOD')} Approval`, role, condition: cond, amount: amt };
        approvals.push({ level: approvals.length + 1, role, condition: cond });
      } else if (/procure|purchas|\bLPO\b|quotation/i.test(c)) stage = { name: 'Procurement', role: 'Head, Procurement' };
      else if (/\bpay|payment|disburs/i.test(c)) stage = { name: 'Payment', role: 'Director, Finance & Accounts' };
      else if (/repair|fix|work(s)? done|maintenance/i.test(c)) stage = { name: 'Repair In Progress', role: vehicle ? 'Fleet Officer' : 'IT Resource' };
      else if (/dispatch|deliver/i.test(c)) stage = { name: 'Dispatch', role: 'Dispatch Officer' };
      else if (/review|check|audit/i.test(c)) stage = { name: c.split(/\s+/).length <= 3 ? title(c.replace(/\b(by|the|a)\b/gi, ' ').replace(/[^\w &]/g, '').replace(/\s+/g, ' ').trim()) : (/audit/i.test(c) ? 'Audit Review' : 'Review'), role: roleFor(c, vehicle) || 'Director' };
      else if (c.split(/\s+/).length <= 5) stage = { name: title(c.replace(/[^\w &]/g, '').trim()), role: roleFor(c, vehicle) || 'Director' };
      if (stage && !statuses.some(s => s.name === stage.name)) statuses.push({ ...stage, escalation: null });
    });
    statuses.push({ name: 'CLOSED', role: '—', escalation: null });
    if (!/\bclose|complete|end\b/i.test(text)) lint.push({ level: 'info', text: 'No end step was described, so a CLOSED status was added.' });

    const escalation = [];
    statuses.slice(1, -1).forEach(s => {
      const applies = escHours && (!escTarget || new RegExp(escTarget, 'i').test(s.name));
      if (applies) {
        s.escalation = escHours;
        const l1 = /^Director|Permanent Secretary/.test(s.role) ? 'Permanent Secretary' : 'Director (line manager of ' + s.role + ')';
        escalation.push({ status: s.name, after: `${escHours}h`, to: l1, level: 1 });
        escalation.push({ status: s.name, after: `${escHours * 2}h`, to: l1 === 'Permanent Secretary' ? "Hon. Minister's office (notify)" : 'Permanent Secretary', level: 2 });
      }
    });
    const noEsc = statuses.slice(1, -1).filter(s => !s.escalation).map(s => s.name);
    if (noEsc.length) lint.push({ level: 'warn', text: `No escalation timer on: ${noEsc.join(', ')}. Tasks can wait there indefinitely. ${escHours ? '' : 'Add e.g. "escalate after 48h".'}` });
    [...new Set(statuses.map(s => s.role))].forEach(r => { if (ACTIVE_USERS[r] === 0) lint.push({ level: 'bad', text: `Role "${r}" has no active users in this tenant. Tasks at that stage would never be picked up. Assign a user or choose another role.` }); });
    const gated = approvals.find(a => /^amount >/.test(a.condition));
    if (gated) lint.push({ level: 'info', text: `Requests at or below ${gated.condition.replace('amount > ', '')} skip "${gated.role}" approval and move straight to the next stage.` });
    if (q) lint.push({ level: 'info', text: `A similar workflow already exists: ${q.existing}. Consider reusing it instead of creating a duplicate.` });
    if (statuses.length <= 2) lint.push({ level: 'warn', text: 'No stages were recognised. Describe the steps with arrows, e.g. "request → inspection → HOD approval → close".' });

    const fields = [
      { label: 'Requester name', type: 'Text', required: true },
      { label: 'Department', type: 'Dropdown', required: true, options: 'From ECMS Departments' },
    ];
    if (vehicle) fields.push({ label: 'Vehicle registration number', type: 'Text', required: true, validation: 'Format ABC-123DE' }, { label: 'Make / model', type: 'Text', required: true }, { label: 'Odometer (km)', type: 'Number', required: false }, { label: 'Fault category', type: 'Dropdown', required: true, options: 'Engine, Brakes, Electrical, Tyres, Body work, Other' });
    if (/laptop|printer|computer|ict|it /i.test(text)) fields.push({ label: 'Asset tag', type: 'Text', required: true, validation: 'Matches Asset Registry' }, { label: 'Device type', type: 'Dropdown', required: true, options: 'Laptop, Desktop, Printer, Network, Other' });
    if (/leave/i.test(text)) fields.push({ label: 'Leave type', type: 'Dropdown', required: true, options: 'Annual, Sick, Maternity, Study, Casual' }, { label: 'Start date', type: 'Date', required: true }, { label: 'End date', type: 'Date', required: true, validation: 'After start date' }, { label: 'Relief officer', type: 'User picker', required: false });
    if (/complain/i.test(text)) fields.push({ label: 'Complaint category', type: 'Dropdown', required: true, options: 'Delay, Staff conduct, Billing, Other' }, { label: 'Location', type: 'Text', required: false });
    fields.push({ label: 'Description of request', type: 'Long text', required: true });
    if (approvals.some(a => a.amount) || amountIn(text)) fields.push({ label: 'Estimated cost (₦)', type: 'Currency', required: true, validation: 'Drives approval thresholds' });
    if (statuses.some(s => s.name === 'Procurement')) fields.push({ label: 'Vendor quotations', type: 'File upload', required: false, validation: 'Up to 3 files' });
    fields.push({ label: 'Supporting documents', type: 'File upload', required: false });

    const recognised = statuses.length - 2;
    return {
      model: 'cicod-workflow-gen-v1 (schema-constrained)',
      confidence: Math.min(0.93, 0.55 + recognised * 0.07 + (escHours ? 0.05 : 0) + (approvals.length ? 0.05 : 0)),
      draft: {
        name, queue: q ? q.name : name.toUpperCase(), queueIsNew: !q,
        queueType: (vehicle ? 'VEHICLE REPAIR REQUEST' : name.toUpperCase()).slice(0, 40), singleUser: false,
        statuses, fields, escalation, approvals: approvals.length ? approvals : [{ level: 1, role: 'Head of Department', condition: 'all requests (default)' }],
      },
      lint,
    };
  }

  const EXAMPLES = {
    'Vehicle repair': 'Vehicle repair request: requester → fleet officer inspection → HOD approval if > ₦200k → procurement → close, escalate after 48h',
    'Laptop request': 'New laptop request: staff submits → IT technician inspection → director approval → DFA approval above ₦1,500,000 → procurement → close',
    'Complaint': 'Customer complaint: log complaint → review by complaints handler → legal review → close, escalate review after 24h',
  };
  const LINT_CHIP = { bad: 'g-chip--bad', warn: 'g-chip--warn', info: 'g-chip--info' };
  const LINT_LABEL = { bad: 'Blocker', warn: 'Warning', info: 'Note' };

  class AIWorkflowBuilder extends HTMLElement {
    connectedCallback() {
      this.innerHTML = `<section class="aiwb" aria-live="polite">
        <div class="aiwb__head"><span class="aiwb__title"><span class="ai-badge">CICOD-AI</span> Describe your process</span><span class="ai-confidence">Prompt-to-Workflow</span></div>
        <div class="aiwb__body">
          <textarea class="g-textarea aiwb__prompt" rows="3" placeholder="e.g. Vehicle repair request: requester → fleet officer inspection → HOD approval if > ₦200k → procurement → close, escalate after 48h"></textarea>
          <div class="aiwb__row">
            <button class="g-btn g-btn--ai g-btn--sm" data-gen type="button">✦ Generate draft</button>
            <span class="aiwb__muted">Examples:</span>${Object.keys(EXAMPLES).map(k => `<button class="g-btn g-btn--ghost g-btn--sm" data-ex="${esc(k)}" type="button">${esc(k)}</button>`).join('')}
          </div>
          <div data-out></div>
        </div>
      </section>`;
      this.querySelectorAll('[data-ex]').forEach(b => b.addEventListener('click', () => { this.querySelector('.aiwb__prompt').value = EXAMPLES[b.dataset.ex]; }));
      this.querySelector('[data-gen]').addEventListener('click', () => this.generate());
    }

    async generate() {
      const prompt = this.querySelector('.aiwb__prompt').value.trim();
      const out = this.querySelector('[data-out]');
      if (prompt.length < 15) { out.innerHTML = '<p class="aiwb__muted">Describe the steps, who does each one, any amount thresholds and escalation times.</p>'; return; }
      out.innerHTML = '<div class="aiwb__res"><div class="ai-skeleton" style="width:40%"></div><div class="ai-skeleton" style="width:95%;height:34px"></div><div class="ai-skeleton" style="width:70%"></div><div class="ai-skeleton" style="width:60%"></div></div>';
      const res = await request('/ecms/workflow/draft', { prompt, tenantQueues: QUEUES.map(q => q.name) }, { mock: mockDraft, feature: 'ecms.prompt-to-workflow' });
      this.res = res;
      this.render();
      this.dispatchEvent(new CustomEvent('ai-workflow-result', { detail: res, bubbles: true }));
    }

    render() {
      const { draft: d, lint } = this.res;
      const out = this.querySelector('[data-out]');
      const flow = d.statuses.map((s, i) => `<div class="aiwb__node ${i === 0 || i === d.statuses.length - 1 ? 'aiwb__node--end' : ''}">
          <b>${esc(s.name)}</b><span>${esc(s.role)}</span>${ACTIVE_USERS[s.role] === 0 ? '<span class="g-chip g-chip--bad">0 active users</span>' : ''}${s.condition && !/^all requests/.test(s.condition) ? `<span class="aiwb__cond">if ${esc(s.condition)}</span>` : ''}${s.escalation ? `<span class="g-chip g-chip--ai">⏱ ${s.escalation}h / ${s.escalation * 2}h</span>` : (i && i < d.statuses.length - 1 ? '<span class="g-chip g-chip--warn">no escalation</span>' : '')}
        </div>${i < d.statuses.length - 1 ? '<span class="aiwb__arrow" aria-hidden="true">→</span>' : ''}`).join('');
      out.innerHTML = `<div class="aiwb__res">
        <div class="aiwb__res-head"><b>Draft workflow</b><span class="ai-confidence">${Math.round(this.res.confidence * 100)}% · ${esc(this.res.model)}</span></div>
        <div class="aiwb__kv">
          <label><span>Queue</span><input class="g-input" data-e="queue" value="${esc(d.queue)}"><em class="g-chip ${d.queueIsNew ? 'g-chip--ai' : 'g-chip--ok'}">${d.queueIsNew ? 'new queue' : 'existing queue'}</em></label>
          <label><span>Queue type</span><input class="g-input" data-e="queueType" value="${esc(d.queueType)}"><em class="g-chip g-chip--ai">new queue type</em></label>
        </div>
        <h5>Status flow (${d.statuses.length} statuses) <button class="g-btn g-btn--ghost g-btn--sm" data-edit-st type="button">Edit statuses</button></h5>
        <div class="aiwb__flow">${flow}</div>
        <div class="aiwb__st-edit" data-st-edit hidden><input class="g-input" data-st-input value="${esc(d.statuses.map(s => s.name).join(', '))}"><button class="g-btn g-btn--sm" data-st-save type="button">Update</button></div>
        <div class="aiwb__cols">
          <div><h5>Form fields (${d.fields.length})</h5><ul class="aiwb__list">${d.fields.map(f => `<li><b>${esc(f.label)}</b> · ${esc(f.type)}${f.required ? ' · required' : ''}</li>`).join('')}</ul></div>
          <div><h5>Escalation</h5>${d.escalation.length ? `<ul class="aiwb__list">${d.escalation.map(e => `<li>${esc(e.status)}: after <b>${esc(e.after)}</b> → ${esc(e.to)}</li>`).join('')}</ul>` : '<p class="aiwb__muted">None described</p>'}</div>
          <div><h5>Approval levels</h5><ul class="aiwb__list">${d.approvals.map(a => `<li>Level ${a.level}: <b>${esc(a.role)}</b> · ${esc(a.condition)}</li>`).join('')}</ul></div>
        </div>
        <h5>Checks against this tenant</h5>
        <ul class="aiwb__lint">${lint.map(l => `<li><span class="g-chip ${LINT_CHIP[l.level]}">${LINT_LABEL[l.level]}</span><span>${esc(l.text)}</span></li>`).join('') || '<li><span class="g-chip g-chip--ok">OK</span><span>No problems found</span></li>'}</ul>
        <div class="aiwb__row">
          <button class="g-btn g-btn--ai g-btn--sm" data-apply type="button">Apply to wizard</button>
          <button class="g-btn g-btn--sm" data-regen type="button">Regenerate</button>
          <button class="g-btn g-btn--ghost g-btn--sm" data-discard type="button">Discard</button>
          <span class="aiwb__muted aiwb__mode">Draft only · nothing is saved until you click Create in the wizard</span>
        </div>
      </div>`;
      out.querySelectorAll('[data-e]').forEach(inp => inp.addEventListener('input', () => { d[inp.dataset.e] = inp.value; this.edited = true; }));
      out.querySelector('[data-edit-st]').addEventListener('click', () => { out.querySelector('[data-st-edit]').hidden = false; });
      out.querySelector('[data-st-save]').addEventListener('click', () => {
        const names = out.querySelector('[data-st-input]').value.split(',').map(s => s.trim()).filter(Boolean);
        d.statuses = names.map(n => d.statuses.find(s => s.name.toLowerCase() === n.toLowerCase()) || { name: n, role: 'Director', escalation: null });
        this.edited = true; this.render();
      });
      out.querySelector('[data-apply]').addEventListener('click', e => {
        feedback(this.res.id, 'ecms.prompt-to-workflow', this.edited ? 'edited' : 'accepted');
        this.dispatchEvent(new CustomEvent('ai-workflow-apply', { detail: { draft: d }, bubbles: true }));
        e.target.textContent = 'Applied to wizard ✓';
      });
      out.querySelector('[data-regen]').addEventListener('click', () => { feedback(this.res.id, 'ecms.prompt-to-workflow', 'regenerated'); this.generate(); });
      out.querySelector('[data-discard]').addEventListener('click', () => { feedback(this.res.id, 'ecms.prompt-to-workflow', 'rejected'); out.innerHTML = ''; });
    }
  }

  customElements.define('ai-workflow-builder', AIWorkflowBuilder);
})();
