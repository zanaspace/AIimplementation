/* <ai-report-builder examples="Turnaround time by department for Q3|Top 5 assignees by closed tasks">
   "Ask for a report" on the ECMS Reports page. The user types the report they need in plain
   English. The CICOD-AI turns it into a structured query and shows what it understood as editable
   filter chips, then a chart, a table and a one-paragraph narrative. Changing a chip re-runs
   the query. The report is only saved, exported or scheduled when the user clicks.
   Attributes:
     examples   optional "|"-separated example prompts shown as chips
   Events:
     ai-report-result    detail: report payload (query, rows, narrative)
     ai-report-export    detail: { title, csv }                    the host can log the export
     ai-report-save      detail: { title, query }                  the host adds it to saved reports
     ai-report-schedule  detail: { title, query, cadence:'weekly' } the host creates the schedule
   Gateway: POST /ecms/reports/nl-query { prompt, overrides? }
     -> { model, confidence, title, query:{ metric, dimension, period, filters[], limit }, chips[],
          columns[], rows:[{ label, value, share }], unit, narrative } */
(function () {
  const { request, feedback, esc } = window.AIGateway;

  const CATS = {
    department: ['Administration', 'Billing Department', 'Business Analysis', 'Commercial', 'Customer Service', 'IT Infrastructure', 'Project Department', 'Anti-Corruption and Transparency Unit'],
    queue: ['Order Fulfilment', 'Complaints', 'TEST AUTOMATION', 'IT Support', 'Product development', 'CICOD-AI IMPLEMENTATION'],
    queueType: ['Delivery', 'Application issue', 'Billing dispute', 'Staff conduct', 'General enquiry', 'Hardware & Network'],
    assignee: ['Ann Nya', 'Ayomide Olusanya', 'Eyitayo Abidogun', 'Chinwuba Okafor', 'Nathan Wilson', 'Benita Benita', 'Damola Tunde', 'Udedibor Favour'],
    priority: ['Critical', 'High', 'Medium', 'Normal', 'Low'],
  };
  const DIM_LABEL = { department: 'Department', queue: 'Queue', queueType: 'Queue type', assignee: 'Assignee', priority: 'Priority' };
  const METRIC_LABEL = { turnaround: 'Avg turnaround (days)', count: 'Tasks created', open: 'Open tasks', closed: 'Closed tasks' };
  const PERIODS = ['Q1 2026', 'Q2 2026', 'Q3 2026', 'September 2026', 'This week', 'Last 90 days', 'All time'];
  const REAL_OPEN = { 'Order Fulfilment': 11003, Complaints: 2248, 'TEST AUTOMATION': 560, 'IT Support': 479, 'Product development': 165, 'CICOD-AI IMPLEMENTATION': 38 };
  const REAL_CLOSED = { 'Order Fulfilment': 2, Complaints: 25, 'TEST AUTOMATION': 25, 'IT Support': 33, 'Product development': 7, 'CICOD-AI IMPLEMENTATION': 3 };

  // FNV-1a with a final mix, so similar strings give well-spread values.
  const hash = s => {
    let h = 2166136261;
    for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
    h ^= h >>> 15; h = Math.imul(h, 2246822507); h ^= h >>> 13;
    return h >>> 0;
  };

  function parse(prompt) {
    const t = prompt.toLowerCase();
    const metric = /turnaround|tat|how long|resolution time|time to close/.test(t) ? 'turnaround' : /closed|resolved|completed/.test(t) ? 'closed' : /open|pending|backlog|outstanding/.test(t) ? 'open' : 'count';
    const dimension = /assignee|officer|staff|user|person|who/.test(t) ? 'assignee' : /queue type|type/.test(t) ? 'queueType' : /priority/.test(t) ? 'priority' : /queue/.test(t) ? 'queue' : /department|mda|unit/.test(t) ? 'department' : 'queue';
    const q = t.match(/\bq([1-4])\b/);
    const period = q ? `Q${q[1]} 2026` : /this month|september/.test(t) ? 'September 2026' : /this week|last 7/.test(t) ? 'This week' : /all time|ever/.test(t) ? 'All time' : 'Last 90 days';
    const filters = [];
    const queueHit = CATS.queue.find(x => t.includes(x.toLowerCase().replace(' fulfilment', '')) || (x === 'Complaints' && /complain/.test(t)));
    if (queueHit && dimension !== 'queue') filters.push({ key: 'queue', label: 'Queue', value: queueHit, options: CATS.queue });
    if (/open complaints|open tasks|\bopen\b/.test(t) && metric !== 'open') filters.push({ key: 'status', label: 'Status', value: 'Open', options: ['Open', 'In progress', 'Closed'] });
    const deptHit = CATS.department.find(x => t.includes(x.toLowerCase()));
    if (deptHit && dimension !== 'department') filters.push({ key: 'department', label: 'Department', value: deptHit, options: CATS.department });
    const top = t.match(/top\s*(\d+)/);
    return { metric, dimension, period, filters, limit: top ? Math.min(+top[1], 8) : null };
  }

  function mockReport({ prompt, overrides = {} }) {
    const query = parse(prompt);
    ['metric', 'dimension', 'period'].forEach(k => { if (overrides[k]) query[k] = overrides[k]; });
    if (overrides.limit !== undefined) query.limit = overrides.limit === 'All' ? null : +overrides.limit;
    query.filters = query.filters.filter(f => !(overrides.removed || []).includes(f.key)).map(f => (overrides[f.key] ? { ...f, value: overrides[f.key] } : f));
    const seed = hash(query.metric + query.dimension + query.period + query.filters.map(f => f.value).join());
    const periodScale = { 'This week': 0.06, 'September 2026': 0.25, 'Q1 2026': 0.7, 'Q2 2026': 0.8, 'Q3 2026': 0.9, 'Last 90 days': 0.9, 'All time': 1 }[query.period] || 1;
    const qf = query.filters.find(f => f.key === 'queue');
    const rs = CATS[query.dimension].map((_, i) => ((hash(seed + ':' + i) % 97) + 1) / 98);
    const wsum = rs.reduce((s, r) => s + r + 0.3, 0);
    // With a queue filter, split that queue's real total across the groups.
    const queueTotal = qf && query.metric !== 'turnaround' ? (query.metric === 'closed' ? REAL_CLOSED[qf.value] : query.metric === 'open' ? REAL_OPEN[qf.value] : (REAL_OPEN[qf.value] + REAL_CLOSED[qf.value]) * 1.1) * (query.period === 'All time' ? 1 : periodScale) : null;

    let rows = CATS[query.dimension].map((label, i) => {
      const r = rs[i];
      let value;
      if (queueTotal !== null) value = Math.max(1, Math.round((queueTotal * (r + 0.3)) / wsum));
      else if (query.metric === 'turnaround') value = +(1.5 + r * 12.5).toFixed(1);
      else if (query.dimension === 'queue' && query.metric === 'open') value = Math.round(REAL_OPEN[label] * (query.period === 'All time' ? 1 : periodScale));
      else if (query.dimension === 'queue' && query.metric === 'closed') value = Math.max(1, Math.round(REAL_CLOSED[label] * periodScale));
      else value = Math.max(1, Math.round((query.metric === 'closed' ? 4 + r * 36 : 12 + r * 380) * periodScale));
      return { label, value };
    }).sort((a, b) => b.value - a.value);
    if (query.limit) rows = rows.slice(0, query.limit);
    const total = rows.reduce((s, r) => s + r.value, 0);
    rows = rows.map(r => ({ ...r, share: query.metric === 'turnaround' ? null : Math.round((r.value / total) * 100) }));

    const unit = query.metric === 'turnaround' ? 'days' : 'tasks';
    const dimL = DIM_LABEL[query.dimension].toLowerCase();
    const filt = query.filters.length ? ` (${query.filters.map(f => `${f.label.toLowerCase()} ${f.value}`).join(', ')})` : '';
    const title = `${METRIC_LABEL[query.metric]} by ${dimL}, ${query.period}${filt}`;
    const first = rows[0], last = rows[rows.length - 1];
    const avg = query.metric === 'turnaround' ? (rows.reduce((s, r) => s + r.value, 0) / rows.length).toFixed(1) : null;
    const narrative = query.metric === 'turnaround'
      ? `${first.label} is the slowest ${dimL} at ${first.value} days on average, against ${last.value} days for ${last.label}, the fastest. The average across ${rows.length} ${dimL}s is ${avg} days. ${first.value > 2 * avg ? `${first.label} takes more than twice the average and is worth a closer look.` : 'The spread is moderate.'}`
      : `${first.label} leads with ${first.value.toLocaleString('en-GB')} ${unit}, ${first.share}% of the total ${total.toLocaleString('en-GB')}. ${rows.length > 1 ? `${rows[1].label} follows with ${rows[1].value.toLocaleString('en-GB')}.` : ''} ${first.share > 50 ? `One ${dimL} accounts for more than half, so the workload is concentrated.` : 'The work is spread across several ' + dimL + 's.'}`;

    const chips = [
      { key: 'metric', label: 'Measure', value: query.metric, display: METRIC_LABEL[query.metric], options: Object.keys(METRIC_LABEL).map(v => ({ v, t: METRIC_LABEL[v] })) },
      { key: 'dimension', label: 'Group by', value: query.dimension, display: DIM_LABEL[query.dimension], options: Object.keys(DIM_LABEL).map(v => ({ v, t: DIM_LABEL[v] })) },
      { key: 'period', label: 'Period', value: query.period, display: query.period, options: PERIODS.map(v => ({ v, t: v })) },
      ...query.filters.map(f => ({ key: f.key, label: f.label, value: f.value, display: f.value, removable: true, options: f.options.map(v => ({ v, t: v })) })),
      { key: 'limit', label: 'Show', value: query.limit ? String(query.limit) : 'All', display: query.limit ? `Top ${query.limit}` : 'All', options: ['All', '3', '5', '8'].map(v => ({ v, t: v === 'All' ? 'All' : `Top ${v}` })) },
    ];
    return { model: 'cicod-text2query-v1 (sovereign)', confidence: prompt.length > 25 ? 0.89 : 0.72, title, query, chips, columns: [DIM_LABEL[query.dimension], METRIC_LABEL[query.metric], 'Share'], rows, unit, narrative };
  }

  class AIReportBuilder extends HTMLElement {
    connectedCallback() {
      const ex = (this.getAttribute('examples') || 'Turnaround time by department for Q3|Open complaints by queue type this month|Top 5 assignees by closed tasks').split('|');
      this.overrides = {};
      this.innerHTML = `<section class="airb">
        <div class="airb__head"><span class="airb__title"><span class="ai-badge">CICOD-AI</span> Ask for a report</span><span class="ai-confidence">Reads task data you can already see</span></div>
        <form class="airb__ask" data-form>
          <input class="g-input" name="prompt" data-airb-input placeholder="e.g. Turnaround time by department for Q3" aria-label="Describe the report you need">
          <button class="g-btn g-btn--ai" type="submit" data-airb-run>✦ Build report</button>
        </form>
        <div class="airb__examples">${ex.map(e => `<button class="g-chip g-chip--ai airb__ex" type="button">${esc(e)}</button>`).join('')}</div>
        <div class="airb__out" aria-live="polite"></div>
      </section>`;
      this.input = this.querySelector('[data-airb-input]');
      this.out = this.querySelector('.airb__out');
      this.querySelector('[data-form]').addEventListener('submit', e => { e.preventDefault(); this.overrides = {}; this.run(); });
      this.querySelectorAll('.airb__ex').forEach(b => b.addEventListener('click', () => { this.input.value = b.textContent; this.overrides = {}; this.run(); }));
    }

    async run() {
      const prompt = this.input.value.trim();
      if (prompt.length < 6) { this.out.innerHTML = '<p class="airb__hint">Describe the report in a few words, for example what to measure, how to group it and for which period.</p>'; return; }
      this.out.innerHTML = '<div class="airb__card"><div class="ai-skeleton" style="width:55%"></div><div class="ai-skeleton" style="height:90px"></div><div class="ai-skeleton" style="width:80%"></div></div>';
      const res = await request('/ecms/reports/nl-query', { prompt, overrides: this.overrides }, { mock: mockReport, feature: 'ecms.nl-reports' });
      this.res = res;
      this.render(res);
      this.dispatchEvent(new CustomEvent('ai-report-result', { detail: res, bubbles: true }));
    }

    render(res) {
      const max = Math.max(...res.rows.map(r => r.value));
      const chips = res.chips.map(c => `<span class="airb__chip"><span class="airb__chip-k">${esc(c.label)}</span>
        <select data-chip="${esc(c.key)}" aria-label="${esc(c.label)}">${c.options.map(o => `<option value="${esc(o.v)}" ${o.v === c.value ? 'selected' : ''}>${esc(o.t)}</option>`).join('')}</select>
        ${c.removable ? `<button type="button" class="airb__chip-x" data-remove="${esc(c.key)}" aria-label="Remove ${esc(c.label)} filter">×</button>` : ''}</span>`).join('');
      const fmt = v => (res.unit === 'days' ? v.toFixed(1) : v.toLocaleString('en-GB'));
      this.out.innerHTML = `<div class="airb__card">
        <div class="airb__understood"><span class="airb__label">What CICOD-AI understood · edit any chip</span>
          <span class="ai-confidence">${Math.round(res.confidence * 100)}% · ${esc(res.model)}</span></div>
        <div class="airb__chips">${chips}</div>
        <h4 class="airb__rtitle">${esc(res.title)}</h4>
        <div class="airb__chart" role="img" aria-label="Bar chart of ${esc(res.title)}">${res.rows.map(r => `<div class="airb__row"><span class="airb__row-l">${esc(r.label)}</span><span class="airb__track"><i style="width:${Math.max(2, (r.value / max) * 100)}%"></i></span><span class="airb__row-v">${esc(fmt(r.value))}</span></div>`).join('')}</div>
        <p class="airb__narr">${esc(res.narrative)}</p>
        <div class="g-table-wrap"><table class="g-table airb__table"><thead><tr>${res.columns.map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead>
          <tbody>${res.rows.map(r => `<tr><td>${esc(r.label)}</td><td>${esc(fmt(r.value))}</td><td>${r.share === null ? '–' : esc(r.share) + '%'}</td></tr>`).join('')}</tbody></table></div>
        <div class="airb__actions">
          <button class="g-btn g-btn--sm" type="button" data-act="export">Export CSV</button>
          <button class="g-btn g-btn--sm g-btn--primary" type="button" data-act="save">Save report</button>
          <button class="g-btn g-btn--sm" type="button" data-act="schedule">Schedule weekly</button>
          <button class="g-btn g-btn--sm g-btn--ghost" type="button" data-act="reject">Not what I meant</button>
        </div></div>`;
      this.querySelectorAll('[data-chip]').forEach(s => s.addEventListener('change', () => {
        this.overrides[s.dataset.chip] = s.value;
        feedback(res.id, 'ecms.nl-reports', 'edited', { chip: s.dataset.chip });
        this.run();
      }));
      this.querySelectorAll('[data-remove]').forEach(b => b.addEventListener('click', () => {
        this.overrides.removed = [...(this.overrides.removed || []), b.dataset.remove];
        feedback(res.id, 'ecms.nl-reports', 'edited', { removed: b.dataset.remove });
        this.run();
      }));
      this.querySelectorAll('[data-act]').forEach(b => b.addEventListener('click', () => this.act(b.dataset.act, b)));
    }

    act(action, btn) {
      const res = this.res;
      if (action === 'reject') { feedback(res.id, 'ecms.nl-reports', 'rejected'); this.out.innerHTML = '<p class="airb__hint">Thanks. Try rephrasing, or change the chips above the chart next time.</p>'; this.input.focus(); return; }
      const detail = { title: res.title, query: res.query };
      if (action === 'export') {
        const csv = [res.columns.join(','), ...res.rows.map(r => `"${r.label.replace(/"/g, '""')}",${r.value},${r.share ?? ''}`)].join('\n');
        detail.csv = csv;
        try {
          const a = document.createElement('a');
          a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
          a.download = res.title.replace(/[^\w]+/g, '_').slice(0, 60) + '.csv';
          a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
        } catch (e) { /* the host still receives the CSV in the event */ }
      }
      if (action === 'schedule') detail.cadence = 'weekly';
      feedback(res.id, 'ecms.nl-reports', 'accepted', { action });
      btn.textContent = { export: 'Exported ✓', save: 'Saved ✓', schedule: 'Scheduled weekly ✓' }[action];
      btn.disabled = true;
      this.dispatchEvent(new CustomEvent(`ai-report-${action}`, { detail, bubbles: true }));
    }
  }

  customElements.define('ai-report-builder', AIReportBuilder);
})();
