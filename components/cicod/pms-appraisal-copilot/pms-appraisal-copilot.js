/* <ai-appraisal-copilot source="#appraisal-form" period="2026 Mid-Year Review" staff="Prince Ekpenyong">
   Helps staff and supervisors with the appraisal form in three ways:
     1. Write SMART KPI: turns a vague objective into a measurable KPI (target, weight, data source).
     2. Draft from evidence: pulls completed ECMS tasks, memos and closed tickets for one KPI and
        drafts the self-appraisal comment with numbered citations.
     3. Supervisor consistency hint: compares each self-rating with the strength of the evidence.
   It reads the host form (rows marked [data-kpi-row] with fields kpi, target, weight, rating, comment)
   but never changes it. The host page applies every accepted suggestion.
   Attributes:
     source  CSS selector of the appraisal form
     period  appraisal period label, sent to the gateway
     staff   appraisee name, used for evidence retrieval (permission-trimmed server-side)
   Events (bubbles):
     ai-kpi-apply          detail: { kpi, target, weight, source }         host adds a KPI row
     ai-appraisal-draft    detail: { kpiId, comment, citations[] }        host fills that row's comment
     ai-consistency-result detail: { hints:[{ kpiId, level, message }] }  host marks rows for the supervisor
   Gateway:
     POST /pms/smart-kpi        { objective, role, department }
       -> { model, kpi, target, weight, source, smart:{S,M,A,R,T}, confidence }
     POST /pms/appraisal-draft  { kpiId, kpi, target, staff, period }
       -> { model, evidence:[{ ref, app, title, date, outcome }], comment, achieved, confidence }
     POST /pms/consistency      { rows:[{ kpiId, kpi, rating }], staff, period }
       -> { model, hints:[{ kpiId, level:'ok'|'warn'|'bad', message }] } */
(function () {
  const { request, feedback, esc } = window.AIGateway;

  // Prototype-only knowledge: queues, stores and staff names come from the live cicod tenant.
  const KPI_RULES = [
    { k: /customer|complain|citizen|service|feedback|satisf/i, area: 'complaints', target: '90% within 5 days',
      kpi: 'Resolve 90% of tasks in the Complaints queue within 5 working days',
      measure: 'ECMS Status Dashboard: Complaints queue, closed within SLA ÷ total closed',
      base: 'Baseline: Complaints tasks currently wait weeks for first assignment', weight: 25 },
    { k: /order|deliver|backlog|fulfil|dispatch/i, area: 'orders', target: 'Under 5,000 open',
      kpi: 'Cut the Order Fulfilment open backlog from 11,003 to under 5,000 tasks',
      measure: 'ECMS All Tasks: Order Fulfilment, status Open, counted on the last day of each month',
      base: 'Baseline: 11,003 open and 1 in progress on 27 Sep 2026', weight: 30 },
    { k: /memo|document|file|record|digiti|paper|archive/i, area: 'records', target: '2,000 files',
      kpi: 'Digitise and classify 2,000 historic file jackets in CICOD Drive Historic Files',
      measure: 'CICOD Drive: files in Historic Files with OCR status "Searchable" and a classification set',
      base: 'Baseline: Historic Files shows 0 files today', weight: 20 },
    { k: /asset|store|stock|inventory|procure/i, area: 'assets', target: 'Variance under 2%',
      kpi: 'Complete a monthly stock-take for every store with variance under 2%',
      measure: 'Asset Mgmt → Stock Taking Mang.: approved counts per store, absolute variance ÷ previous quantity',
      base: 'Baseline: 5 stock-takes awaiting approval, one with a variance of 21 of 23', weight: 20 },
    { k: /train|learn|skill|capacity|staff develop/i, area: 'training', target: '40 officers, 80% pass',
      kpi: 'Train 40 officers on 1CICOD ECMS and Drive, with 80% passing the post-training quiz',
      measure: 'Training attendance register (Drive) and quiz results; attendance from Conference',
      base: 'Baseline: no tracked training in the period', weight: 15 },
    { k: /ai|automat|process|workflow|efficien/i, area: 'process', target: '6 live workflows',
      kpi: 'Document and launch 6 department workflows in ECMS, each live with at least 20 tasks',
      measure: 'ECMS My Workflows: status Active + task count per workflow',
      base: 'Baseline: CICOD-AI IMPLEMENTATION queue in Process Gathering stage', weight: 20 },
  ];

  const MONTHS = /(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*/i;
  const quarter = /\bq([1-4])\b/i;
  const QEND = { 1: '31 Mar 2027', 2: '30 Jun 2027', 3: '30 Sep 2027', 4: '31 Dec 2026' };

  function deadlineFrom(text) {
    const q = text.match(quarter);
    if (q) return QEND[q[1]];
    const m = text.match(MONTHS);
    if (m) { const name = m[1][0].toUpperCase() + m[1].slice(1, 3).toLowerCase(); return `end of ${name} ${/jan|feb|mar|apr|may|jun|jul|aug|sep/i.test(name) ? 2027 : 2026}`; }
    return '31 Dec 2026';
  }

  function mockSmart({ objective = '' }) {
    const rule = KPI_RULES.find(r => r.k.test(objective));
    const when = deadlineFrom(objective);
    const pct = objective.match(/(\d{1,3})\s?%/);
    const num = objective.match(/\b(\d{2,6})\b/);
    let kpi, measure, base, weight, conf, target = '3 milestones';
    if (rule) {
      kpi = rule.kpi; target = rule.target; measure = rule.measure; base = rule.base; weight = rule.weight; conf = 0.86;
      if (pct && /\d+%/.test(kpi)) { kpi = kpi.replace(/\d+%/, `${pct[1]}%`); target = target.replace(/\d+%/, `${pct[1]}%`); }
      else if (num && rule.area === 'records') { const n = Number(num[1]).toLocaleString('en-NG'); kpi = kpi.replace('2,000', n); target = `${n} files`; }
    } else {
      const clean = objective.trim().replace(/[.\s]+$/, '');
      kpi = `Deliver "${clean}" as 3 dated milestones, each signed off by the supervisor`;
      measure = 'Milestone sign-off recorded as a closed ECMS task in the CICOD-AI IMPLEMENTATION or department queue';
      base = 'No existing data source matched. Agree the baseline with your supervisor';
      weight = 10; conf = 0.61;
    }
    kpi += ` by ${when}`;
    return {
      model: 'cicod-kpi-writer-v1 (sovereign)',
      confidence: conf,
      kpi, target, weight, source: measure,
      smart: {
        Specific: rule ? `Names one queue, store or folder instead of "${objective.trim().slice(0, 40)}"` : 'Split into named milestones',
        Measurable: measure,
        Achievable: base,
        Relevant: 'Linked to the department mandate and the CICOD digitisation goal',
        'Time-bound': `Due ${when}, reviewed at the mid-year check-in`,
      },
    };
  }

  const EVIDENCE = {
    complaints: [
      { ref: 'ECMS #17569', app: 'ECMS task', title: 'Complaint: delayed delivery, Kano', date: '12/09/2026', outcome: 'Closed in 2 days' },
      { ref: 'ECMS #17492', app: 'ECMS task', title: 'Complaint: wrong item supplied', date: '03/09/2026', outcome: 'Closed in 4 days' },
      { ref: 'MEMO/ADM/114', app: 'Memo', title: 'Proposal: complaints escalation after 48h', date: '28/08/2026', outcome: 'Approved by Director' },
    ],
    orders: [
      { ref: 'ECMS bulk #BA-221', app: 'ECMS bulk action', title: '412 Order Fulfilment tasks reassigned', date: '15/09/2026', outcome: 'Completed' },
      { ref: 'ECMS #17510', app: 'ECMS task', title: 'Dispatch riders shift roster', date: '09/09/2026', outcome: 'Closed' },
    ],
    records: [
      { ref: 'Drive: POLICY_DOCUMENTS', app: 'CICOD Drive', title: '46 policy files re-classified', date: '20/09/2026', outcome: 'Activity log' },
      { ref: 'MEMO/REG/087', app: 'Memo', title: 'Request: scanner for registry', date: '02/09/2026', outcome: 'Approved' },
    ],
    assets: [
      { ref: 'Stock take #ST-5826', app: 'Asset Mgmt', title: 'Stationary store count, 2A Excersise Book', date: '23/09/2026', outcome: 'Awaiting Approval' },
      { ref: 'ECMS #17533', app: 'ECMS task', title: 'Market Square monthly count', date: '22/09/2026', outcome: 'Closed' },
    ],
    training: [
      { ref: 'Conference room "ECMS training 2"', app: 'Conference', title: '18 attendees recorded', date: '10/09/2026', outcome: 'Recording saved' },
    ],
    process: [
      { ref: 'ECMS #17588', app: 'ECMS task', title: 'CICOD-AI IMPLEMENTATION: process gathering, Registry', date: '18/09/2026', outcome: 'Closed' },
      { ref: 'ECMS #17590', app: 'ECMS task', title: 'Vehicle repair workflow draft', date: '21/09/2026', outcome: 'Closed' },
      { ref: 'Support ticket #T-3302', app: 'Help Centre', title: 'Workflow escalation timer fixed', date: '24/09/2026', outcome: 'Resolved' },
    ],
  };

  function areaOf(text) { const r = KPI_RULES.find(x => x.k.test(text)); return r ? r.area : null; }

  function mockDraft({ kpiId, kpi = '', target = '' }) {
    const area = areaOf(kpi);
    const ev = area ? EVIDENCE[area] : [];
    const achieved = ev.length >= 3 ? 'Met' : ev.length === 2 ? 'Partly met' : ev.length === 1 ? 'Early progress' : 'No evidence found';
    const cite = ev.map((e, i) => `${e.title} (${e.outcome.toLowerCase()}) [${i + 1}]`);
    const comment = ev.length
      ? `Against the target "${target || kpi}", I ${ev.length >= 3 ? 'delivered' : 'made progress on'} this objective in the period: ${cite.join('; ')}. ${ev.length >= 3 ? 'I believe the target has been met.' : 'Further work is planned for the next quarter to reach the full target.'}`
      : 'No completed ECMS tasks, memos or tickets in this period matched this KPI. Add your own comment or attach evidence.';
    return { model: 'cicod-rag-v2 (sovereign)', kpiId, evidence: ev, comment, achieved, confidence: ev.length ? 0.7 + ev.length * 0.07 : 0.4 };
  }

  function mockConsistency({ rows = [] }) {
    return {
      model: 'cicod-consistency-v1',
      hints: rows.map(r => {
        const n = (EVIDENCE[areaOf(r.kpi)] || []).length;
        const rating = Number(r.rating) || 0;
        const support = n >= 3 ? 5 : n === 2 ? 4 : n === 1 ? 3 : 2;
        if (!rating) return { kpiId: r.kpiId, level: 'warn', message: 'No self-rating yet' };
        if (rating - support >= 2) return { kpiId: r.kpiId, level: 'bad', message: `Rated ${rating}/5 but only ${n} evidence item${n === 1 ? '' : 's'} found (supports about ${support}/5). Ask for more evidence before agreeing.` };
        if (rating - support === 1) return { kpiId: r.kpiId, level: 'warn', message: `Rated ${rating}/5; ${n} evidence item${n === 1 ? '' : 's'} suggest ${support}/5. Worth a conversation.` };
        if (support - rating >= 2) return { kpiId: r.kpiId, level: 'warn', message: `Rated ${rating}/5 but evidence (${n} items) suggests ${support}/5. The appraisee may be under-rating.` };
        return { kpiId: r.kpiId, level: 'ok', message: `Rating ${rating}/5 is consistent with ${n} evidence item${n === 1 ? '' : 's'}.` };
      }),
    };
  }

  const pct = c => `${Math.round(c * 100)}%`;
  const skeleton = '<div class="ai-skeleton" style="width:85%"></div><div class="ai-skeleton" style="width:65%"></div><div class="ai-skeleton" style="width:75%"></div>';

  class AIAppraisalCopilot extends HTMLElement {
    connectedCallback() {
      this.source = document.querySelector(this.getAttribute('source'));
      this.period = this.getAttribute('period') || '';
      this.staff = this.getAttribute('staff') || '';
      this.innerHTML = `<section class="aiap" aria-live="polite">
        <div class="aiap__head"><span class="aiap__title"><span class="ai-badge">CICOD-AI</span> Appraisal copilot</span><span class="ai-confidence">${esc(this.period)}</span></div>
        <div class="aiap__tabs" role="tablist">
          <button class="aiap__tab aiap__tab--on" data-tab="smart" type="button">SMART KPI</button>
          <button class="aiap__tab" data-tab="draft" type="button">Draft from evidence</button>
          <button class="aiap__tab" data-tab="check" type="button">Supervisor check</button>
        </div>
        <div class="aiap__pane" data-pane="smart">
          <label class="g-label" for="aiap-objective">Your objective, in your own words</label>
          <textarea class="g-textarea aiap__obj" id="aiap-objective" placeholder="e.g. improve customer service, or clear the order backlog by March"></textarea>
          <button class="g-btn g-btn--ai g-btn--sm aiap__go" data-aiap-smart type="button">✦ Write SMART KPI</button>
          <div class="aiap__out" data-out="smart"></div>
        </div>
        <div class="aiap__pane" data-pane="draft" hidden>
          <label class="g-label" for="aiap-kpi">KPI to draft a comment for</label>
          <select class="g-select" id="aiap-kpi"></select>
          <button class="g-btn g-btn--ai g-btn--sm aiap__go" data-aiap-draft type="button">✦ Draft from evidence</button>
          <div class="aiap__out" data-out="draft"></div>
        </div>
        <div class="aiap__pane" data-pane="check" hidden>
          <p class="aiap__hint">For the supervisor: compares each self-rating with the evidence found in ECMS, Drive, InMail and Asset Mgmt for ${esc(this.staff || 'the appraisee')}.</p>
          <button class="g-btn g-btn--ai g-btn--sm aiap__go" data-aiap-check type="button">✦ Check rating consistency</button>
          <div class="aiap__out" data-out="check"></div>
        </div>
        <div class="aiap__foot">Suggestion only · you confirm every change</div>
      </section>`;
      this.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => this.tab(b.dataset.tab)));
      this.querySelector('[data-aiap-smart]').addEventListener('click', () => this.smart());
      this.querySelector('[data-aiap-draft]').addEventListener('click', () => this.draft());
      this.querySelector('[data-aiap-check]').addEventListener('click', () => this.check());
      this.fillKpis();
      this.source?.addEventListener('input', () => this.fillKpis());
      new MutationObserver(() => this.fillKpis()).observe(this.source || this, { childList: true, subtree: true });
    }

    tab(name) {
      this.querySelectorAll('[data-tab]').forEach(b => b.classList.toggle('aiap__tab--on', b.dataset.tab === name));
      this.querySelectorAll('[data-pane]').forEach(p => { p.hidden = p.dataset.pane !== name; });
      if (name === 'draft') this.fillKpis();
    }

    rows() {
      if (!this.source) return [];
      return [...this.source.querySelectorAll('[data-kpi-row]')].map(r => ({
        kpiId: r.dataset.kpiId,
        kpi: r.querySelector('[name=kpi]')?.value || '',
        target: r.querySelector('[name=target]')?.value || '',
        weight: r.querySelector('[name=weight]')?.value || '',
        rating: r.querySelector('[name=rating]')?.value || '',
      }));
    }

    fillKpis() {
      const sel = this.querySelector('#aiap-kpi');
      if (!sel) return;
      const cur = sel.value;
      const opts = this.rows().map(r => `<option value="${esc(r.kpiId)}">${esc(r.kpi.slice(0, 70) || 'Untitled KPI')}</option>`).join('');
      if (sel.dataset.sig === opts) return;
      sel.dataset.sig = opts; sel.innerHTML = opts; if (cur) sel.value = cur;
    }

    async smart() {
      const objective = this.querySelector('#aiap-objective').value.trim();
      const out = this.querySelector('[data-out="smart"]');
      if (objective.length < 6) { out.innerHTML = '<p class="aiap__hint">Type at least a few words about what you want to achieve.</p>'; return; }
      out.innerHTML = skeleton;
      const res = await request('/pms/smart-kpi', { objective, role: 'Officer', department: 'Administration' }, { mock: mockSmart, feature: 'cicod.pms-appraisal-copilot.smart-kpi' });
      this.smartRes = res;
      out.innerHTML = `<div class="aiap__card">
        <div class="aiap__kpi">${esc(res.kpi)}</div>
        <div class="aiap__meta"><span class="g-chip">Target: ${esc(res.target)}</span><span class="g-chip">Suggested weight: ${esc(res.weight)}%</span><span class="ai-confidence">${esc(res.model)} · ${pct(res.confidence)}</span></div>
        <dl class="aiap__smart">${Object.entries(res.smart).map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>
        <label class="g-label" for="aiap-kpi-edit">Edit before adding</label>
        <textarea class="g-textarea aiap__edit" id="aiap-kpi-edit">${esc(res.kpi)}</textarea>
        <div class="aiap__actions">
          <button class="g-btn g-btn--primary g-btn--sm" data-add-kpi type="button">Add to my KPIs</button>
          <button class="g-btn g-btn--sm" data-reject-kpi type="button">Not right</button>
        </div></div>`;
      out.querySelector('[data-add-kpi]').addEventListener('click', e => {
        const kpi = out.querySelector('#aiap-kpi-edit').value.trim();
        const edited = kpi !== res.kpi;
        feedback(res.id, 'cicod.pms-appraisal-copilot', edited ? 'edited' : 'accepted', { step: 'smart-kpi' });
        this.dispatchEvent(new CustomEvent('ai-kpi-apply', { detail: { kpi, target: res.target, weight: res.weight, source: res.source }, bubbles: true }));
        e.target.textContent = 'Added ✓'; e.target.disabled = true;
      });
      out.querySelector('[data-reject-kpi]').addEventListener('click', () => { feedback(res.id, 'cicod.pms-appraisal-copilot', 'rejected', { step: 'smart-kpi' }); out.innerHTML = ''; });
    }

    async draft() {
      const id = this.querySelector('#aiap-kpi').value;
      const row = this.rows().find(r => r.kpiId === id);
      const out = this.querySelector('[data-out="draft"]');
      if (!row) return;
      out.innerHTML = skeleton;
      const res = await request('/pms/appraisal-draft', { kpiId: row.kpiId, kpi: row.kpi, target: row.target, staff: this.staff, period: this.period }, { mock: mockDraft, feature: 'cicod.pms-appraisal-copilot.draft' });
      const ev = res.evidence.map((e, i) => `<li><span class="aiap__cite">[${i + 1}]</span><span><b>${esc(e.ref)}</b> · ${esc(e.app)}<br>${esc(e.title)} · ${esc(e.date)} · <i>${esc(e.outcome)}</i></span></li>`).join('');
      out.innerHTML = `<div class="aiap__card">
        <div class="aiap__meta"><span class="g-chip ${res.evidence.length >= 3 ? 'g-chip--ok' : res.evidence.length ? 'g-chip--warn' : 'g-chip--bad'}">${esc(res.achieved)}</span><span class="ai-confidence">${esc(res.model)} · ${pct(res.confidence)}</span></div>
        ${ev ? `<h5 class="aiap__h5">Evidence found (${res.evidence.length})</h5><ol class="aiap__ev">${ev}</ol>` : ''}
        <label class="g-label" for="aiap-draft-edit">Draft self-appraisal comment</label>
        <textarea class="g-textarea aiap__edit" id="aiap-draft-edit">${esc(res.comment)}</textarea>
        <div class="aiap__actions">
          <button class="g-btn g-btn--primary g-btn--sm" data-use-draft type="button">Use in form</button>
          <button class="g-btn g-btn--sm" data-reject-draft type="button">Discard</button>
        </div></div>`;
      out.querySelector('[data-use-draft]').addEventListener('click', e => {
        const comment = out.querySelector('#aiap-draft-edit').value;
        feedback(res.id, 'cicod.pms-appraisal-copilot', comment !== res.comment ? 'edited' : 'accepted', { step: 'draft' });
        this.dispatchEvent(new CustomEvent('ai-appraisal-draft', { detail: { kpiId: row.kpiId, comment, citations: res.evidence.map(x => x.ref) }, bubbles: true }));
        e.target.textContent = 'Inserted ✓'; e.target.disabled = true;
      });
      out.querySelector('[data-reject-draft]').addEventListener('click', () => { feedback(res.id, 'cicod.pms-appraisal-copilot', 'rejected', { step: 'draft' }); out.innerHTML = ''; });
    }

    async check() {
      const out = this.querySelector('[data-out="check"]');
      const rows = this.rows();
      out.innerHTML = skeleton;
      const res = await request('/pms/consistency', { rows, staff: this.staff, period: this.period }, { mock: mockConsistency, feature: 'cicod.pms-appraisal-copilot.consistency' });
      const name = id => (rows.find(r => r.kpiId === id)?.kpi || '').slice(0, 60);
      out.innerHTML = `<div class="aiap__card">
        <div class="aiap__meta"><span class="ai-confidence">${esc(res.model)}</span></div>
        ${res.hints.map(h => `<div class="aiap__hintrow aiap__hintrow--${esc(h.level)}"><b>${esc(name(h.kpiId))}</b>${esc(h.message)}</div>`).join('')}
        <div class="aiap__actions">
          <button class="g-btn g-btn--sm" data-ack type="button">Noted</button>
          <button class="g-btn g-btn--sm" data-dismiss type="button">Not helpful</button>
        </div></div>`;
      this.dispatchEvent(new CustomEvent('ai-consistency-result', { detail: { hints: res.hints }, bubbles: true }));
      out.querySelector('[data-ack]').addEventListener('click', e => { feedback(res.id, 'cicod.pms-appraisal-copilot', 'accepted', { step: 'consistency' }); e.target.textContent = 'Noted ✓'; });
      out.querySelector('[data-dismiss]').addEventListener('click', () => { feedback(res.id, 'cicod.pms-appraisal-copilot', 'rejected', { step: 'consistency' }); out.innerHTML = ''; });
    }
  }

  customElements.define('ai-appraisal-copilot', AIAppraisalCopilot);
})();
