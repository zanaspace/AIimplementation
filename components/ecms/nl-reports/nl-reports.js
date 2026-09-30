/* CICOD-AI for ECMS → Reports (live flow: Set Filters → "Generate Report" dialog → Apply → Tasks table).
   Two small elements, neither of which covers the page:

   <ai-report-ask queues="…|…" users="…|…">
     A one-line "✦ Describe the report" bar at the top of the Generate Report dialog. The officer types
     e.g. "open billing complaints this month created by Chinwuba". CICOD-AI fills the dialog's own
     filters (Queue, Queue Type, Status, Priority, Task State, Date Range, Created By, Assigned By,
     Assigned To). Nothing runs until the officer clicks the dialog's Apply.
     Events: ai-report-filters  detail: { filters:{queue,queueType,status,priority,taskState,from,to,createdBy,assignedBy,assignedTo}, understood:[text] }

   <ai-report-summary source="#report-rows">
     A small "✦ Summarise" button next to Download on the Tasks card. It reads the rows shown
     ([data-row] with data-status, data-type, data-created-by, data-assigned) and opens a popover
     with a short summary. Events: ai-report-summary-pin detail: { text }

   Gateway: POST /ecms/reports/nl-filters { prompt, options } -> { filters, understood[], confidence }
            POST /ecms/reports/summarise  { rows[] }          -> { narrative, facts[] } */
(function () {
  const { request, feedback, esc } = window.AIGateway;

  const QTYPES = { Complaints: ['Account set up complaints', 'Application issue', 'Billing Issue', 'complaint', 'Delivery Complaint', 'Game', 'Link Complaint', 'Main', 'Mobile App', 'NBILLING', 'Order complaints', 'Personnel Complaint', 'Product and Service Complaint', 'Seizures Complaints', 'TAX REVIEW', 'TESTING'] };
  const pad = x => String(x).padStart(2, '0');
  const dmy = d => `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
  const today = () => new Date(2026, 8, 29);

  function mockFilters({ prompt, options }) {
    const t = ' ' + prompt.toLowerCase() + ' ';
    const f = {}; const u = [];
    const queue = options.queues.slice().sort((a, b) => b.length - a.length).find(q => t.includes(' ' + q.toLowerCase())) || (/complain/.test(t) ? 'Complaints' : null);
    if (queue) { f.queue = queue; u.push(`Queue: ${queue}`); }
    const types = QTYPES[f.queue] || [];
    const type = types.slice().sort((a, b) => b.length - a.length).find(x => t.includes(x.toLowerCase()) && x.toLowerCase() !== 'complaint') || (/billing/.test(t) && types.includes('Billing Issue') ? 'Billing Issue' : null);
    if (type) { f.queueType = type; u.push(`Queue type: ${type}`); }
    const status = /\bresolved\b|\bclosed\b|done/.test(t) ? 'resolved' : /\bopen\b|pending|outstanding|unresolved/.test(t) ? 'open' : null;
    if (status) { f.status = status; u.push(`Status: ${status}`); }
    const pr = t.match(/\b(high|medium|low)\b(?: priority)?/); if (pr && /priority|urgent|high|low|medium/.test(t)) { f.priority = pr[1][0].toUpperCase() + pr[1].slice(1); u.push(`Priority: ${f.priority}`); }
    const st = t.match(/\b(active|inactive|suspended)\b/); if (st) { f.taskState = st[1][0].toUpperCase() + st[1].slice(1); u.push(`Task state: ${f.taskState}`); }
    const now = today();
    let from = null, to = null;
    if (/this month/.test(t)) { from = new Date(now.getFullYear(), now.getMonth(), 1); to = now; }
    else if (/last month/.test(t)) { from = new Date(now.getFullYear(), now.getMonth() - 1, 1); to = new Date(now.getFullYear(), now.getMonth(), 0); }
    else if (/this week|last 7 days/.test(t)) { from = new Date(now - 6 * 864e5); to = now; }
    else if (/today/.test(t)) { from = to = now; }
    else { const m = t.match(/since (\d{1,2})(?:st|nd|rd|th)? ?(sep|sept|september)/); if (m) { from = new Date(2026, 8, +m[1]); to = now; } }
    if (from) { f.from = dmy(from); f.to = dmy(to); u.push(`Date range: ${f.from} – ${f.to}`); }
    const who = (re, key, label) => { const m = t.match(re); if (!m) return; const name = options.users.find(n => n.toLowerCase().split(' ').some(p => p.length > 2 && m[1].includes(p.toLowerCase()))); if (name) { f[key] = name; u.push(`${label}: ${name}`); } };
    who(/created by ([a-z .]+?)(?= assigned| with| in | for |$| this| last| since)/, 'createdBy', 'Created by');
    who(/assigned by ([a-z .]+?)(?= created| with| in | for |$| this| last| since)/, 'assignedBy', 'Assigned by');
    who(/assigned to ([a-z .]+?)(?= created| with| in | for |$| this| last| since)/, 'assignedTo', 'Assigned to');
    return { model: 'cicod-text2filter-v1 (sovereign)', confidence: u.length >= 2 ? 0.9 : u.length ? 0.76 : 0.4, filters: f, understood: u };
  }

  function mockSummary({ rows }) {
    const count = (k) => rows.reduce((m, r) => (m[r[k]] = (m[r[k]] || 0) + 1, m), {});
    const by = o => Object.entries(o).sort((a, b) => b[1] - a[1]);
    const st = count('status'), ty = by(count('type')), cr = by(count('createdBy'));
    const unassigned = rows.filter(r => !r.assigned).length;
    const n = rows.length;
    return { model: 'cicod-insights-v1 (sovereign)', confidence: 0.87,
      narrative: `${n} tasks shown: ${st.open || 0} open and ${st.resolved || 0} resolved. ${ty[0] ? `${ty[0][0]} is the main type (${ty[0][1]} of ${n}).` : ''} ${unassigned} of ${n} have never been assigned, so they may be waiting with no owner. ${cr[0] ? `${cr[0][0]} raised the most (${cr[0][1]}).` : ''}`.replace(/\s+/g, ' ').trim(),
      facts: [`Not assigned: ${unassigned} of ${n}`, ...ty.slice(0, 3).map(([k, v]) => `${k}: ${v}`), ...cr.slice(0, 2).map(([k, v]) => `Created by ${k}: ${v}`)] };
  }

  class AIReportAsk extends HTMLElement {
    connectedCallback() {
      const ex = (this.getAttribute('examples') || 'Open billing complaints this month|Resolved complaints created by Chinwuba|High priority open tasks this week').split('|');
      this.innerHTML = `<div class="airp">
        <form class="airp__bar" data-form><span class="ai-badge">CICOD-AI</span><input data-in placeholder="Describe the report, e.g. open billing complaints this month" aria-label="Describe the report you need"><button class="g-btn g-btn--ai g-btn--sm" type="submit">✦ Fill filters</button></form>
        <div class="airp__ex">${ex.map(e => `<button type="button" class="airp__chip">${esc(e)}</button>`).join('')}</div>
        <div class="airp__out" data-out aria-live="polite"></div></div>`;
      this.input = this.querySelector('[data-in]');
      this.querySelector('[data-form]').addEventListener('submit', e => { e.preventDefault(); this.run(); });
      this.querySelectorAll('.airp__chip').forEach(b => b.addEventListener('click', () => { this.input.value = b.textContent; this.run(); }));
    }
    focus() { this.input.focus(); }
    async run() {
      const prompt = this.input.value.trim(), out = this.querySelector('[data-out]');
      if (prompt.length < 5) { out.textContent = 'Say what to include, e.g. queue, status and period.'; return; }
      out.innerHTML = '<div class="ai-skeleton" style="width:70%"></div>';
      const options = { queues: (this.getAttribute('queues') || '').split('|').filter(Boolean), users: (this.getAttribute('users') || '').split('|').filter(Boolean) };
      const res = await request('/ecms/reports/nl-filters', { prompt, options }, { mock: mockFilters, feature: 'ecms.nl-reports' });
      this.res = res;
      if (!res.understood.length) { out.innerHTML = '<span class="airp__warn">I couldn\'t match that to the filters below. Try naming a queue, status or period.</span>'; return; }
      out.innerHTML = `<span>✓ Filled ${res.understood.length} filter${res.understood.length === 1 ? '' : 's'}: ${res.understood.map(esc).join(' · ')}. Check them, then click <b>Apply</b>.</span> <button type="button" class="airp__link" data-wrong>Not right</button>`;
      out.querySelector('[data-wrong]').addEventListener('click', () => { feedback(res.id, 'ecms.nl-reports', 'rejected'); out.textContent = 'Thanks. Adjust the filters below by hand.'; });
      this.dispatchEvent(new CustomEvent('ai-report-filters', { detail: { filters: res.filters, understood: res.understood, id: res.id }, bubbles: true }));
    }
  }

  class AIReportSummary extends HTMLElement {
    connectedCallback() {
      this.innerHTML = '<button class="airp-sum" type="button" title="Summarise with CICOD-AI">✦ Summarise</button>';
      this.querySelector('button').addEventListener('click', e => { e.stopPropagation(); this.pop ? this.close() : this.open(); });
      document.addEventListener('click', e => { if (this.pop && !this.pop.contains(e.target)) this.close(); });
      document.addEventListener('keydown', e => { if (e.key === 'Escape') this.close(); });
    }
    close() { if (this.pop) { this.pop.remove(); this.pop = null; } }
    async open() {
      const src = document.querySelector(this.getAttribute('source'));
      const rows = [...(src ? src.querySelectorAll('[data-row]') : [])].map(r => ({ status: r.dataset.status, type: r.dataset.type, createdBy: r.dataset.createdBy || 'N/A', assigned: r.dataset.assigned === 'yes' }));
      const pop = this.pop = document.createElement('div'); pop.className = 'airp-pop'; pop.setAttribute('role', 'dialog');
      const b = this.querySelector('button').getBoundingClientRect(), w = Math.min(380, innerWidth - 24);
      Object.assign(pop.style, { width: w + 'px', left: Math.max(12, Math.min(b.right - w, innerWidth - w - 12)) + scrollX + 'px', top: b.bottom + 8 + scrollY + 'px' });
      pop.innerHTML = '<div class="ai-skeleton" style="width:90%"></div><div class="ai-skeleton" style="width:65%"></div>';
      document.body.appendChild(pop);
      if (!rows.length) { pop.innerHTML = '<p class="airp-pop__text">No rows to summarise. Apply filters first.</p>'; return; }
      const res = await request('/ecms/reports/summarise', { rows }, { mock: mockSummary, feature: 'ecms.nl-reports.summary' });
      if (this.pop !== pop) return;
      pop.innerHTML = `<div class="airp-pop__head"><span class="ai-badge">CICOD-AI</span><span class="ai-confidence">${Math.round(res.confidence * 100)}% · ${rows.length} rows on this page</span></div>
        <p class="airp-pop__text">${esc(res.narrative)}</p><ul class="airp-pop__facts">${res.facts.map(f => `<li>${esc(f)}</li>`).join('')}</ul>
        <div class="airp-pop__row"><button class="g-btn g-btn--sm g-btn--ai" type="button" data-copy>Copy</button><button class="g-btn g-btn--sm g-btn--ghost" type="button" data-no>Not useful</button></div>`;
      pop.querySelector('[data-copy]').addEventListener('click', async e => { try { await navigator.clipboard.writeText(res.narrative); } catch (err) { /* clipboard may be blocked */ } feedback(res.id, 'ecms.nl-reports.summary', 'accepted'); e.target.textContent = 'Copied ✓'; });
      pop.querySelector('[data-no]').addEventListener('click', () => { feedback(res.id, 'ecms.nl-reports.summary', 'rejected'); this.close(); });
    }
  }

  customElements.define('ai-report-ask', AIReportAsk);
  customElements.define('ai-report-summary', AIReportSummary);
})();
