/* <ai-dashboard-insights source="#wf-dashboard" viewer-role="admin">
   Adds three CICOD-AI surfaces to the ECMS Workflow Dashboard:
     1. An Insights strip at the top with anomaly alerts (stalled queues, work piling up).
     2. An "✦ Explain" button on each card or chart that marks itself with data-ai-explain.
        The button goes into [data-ai-explain-slot] and the narrative into [data-ai-explain-out].
     3. An admin-only "Data consistency" warning when the dashboard disagrees with other screens.
   It reads the figures the host already shows (data-queue rows, data-ai-data JSON on each card,
   data-ai-crosscheck JSON on the source). It never changes the dashboard figures itself.
   Attributes:
     source        CSS selector of the dashboard container
     viewer-role   "admin" shows the Data consistency warning; anything else hides it
   Events:
     ai-insight-result      detail: insights payload
     ai-insight-focus       detail: { insightId, queue }        the host highlights that queue
     ai-insight-pin         detail: { metric, text }            the host pins the narrative
     ai-consistency-action  detail: { check, action }           action: 'acknowledged' | 'reconcile'
   Gateway:
     POST /ecms/dashboard/insights { status, queues[], crosscheck, role }
       -> { model, anomalies:[{id,severity,title,detail,queue}], consistency:[{id,title,detail,source}] }
     POST /ecms/dashboard/explain  { metric, data, queues[] }
       -> { model, confidence, narrative, facts[], queue? } */
(function () {
  const { request, feedback, esc } = window.AIGateway;
  const n = v => Number(v || 0).toLocaleString('en-GB');
  const pct = (a, b, d = 1) => (b ? ((a / b) * 100).toFixed(d) : '0') + '%';

  function mockInsights({ status, queues, crosscheck, role }) {
    const withTotals = queues.map(q => ({ ...q, total: q.open + q.progress + q.closed }));
    const sumOpen = withTotals.reduce((s, q) => s + q.open, 0);
    const anomalies = [];

    const stalled = withTotals.filter(q => q.closed / q.total < 0.005).sort((a, b) => b.open - a.open)[0];
    if (stalled) anomalies.push({ id: 'stalled', severity: 'bad', queue: stalled.name,
      title: `${stalled.name} is stalled`,
      detail: `It holds ${pct(stalled.open, sumOpen, 0)} of open work in the top queues, but only ${n(stalled.closed)} of ${n(stalled.total)} tasks are closed (${pct(stalled.closed, stalled.total, 2)}) and ${n(stalled.progress)} is in progress.` });

    const piling = withTotals.filter(q => q.closed && q.progress / q.closed > 3).sort((a, b) => b.progress / b.closed - a.progress / a.closed)[0];
    if (piling) anomalies.push({ id: 'piling', severity: 'warn', queue: piling.name,
      title: `${piling.name}: work piling up in progress`,
      detail: `${n(piling.progress)} tasks are in progress but only ${n(piling.closed)} are closed (${(piling.progress / piling.closed).toFixed(1)}× more). Officers are starting tasks faster than they finish them.` });

    const best = withTotals.slice().sort((a, b) => b.closed / b.total - a.closed / a.total)[0];
    if (best) anomalies.push({ id: 'best', severity: 'ok', queue: best.name,
      title: `${best.name} has the best closure rate`,
      detail: `${pct(best.closed, best.total)} of its tasks are closed, the highest of the top 5 queues. Its routing and staffing could be copied to the slower queues.` });

    if (status.new === 0 && status.total > 0) anomalies.push({ id: 'nonew', severity: 'warn', queue: null,
      title: 'No new tasks counted',
      detail: `The New card shows 0 while ${n(status.total)} tasks have been created in total. Either intake has stopped or the card's filter excludes the latest tasks.` });

    const consistency = [];
    if (role === 'admin' && crosscheck) {
      if (crosscheck.allTasksOpen && crosscheck.allTasksOpen !== status.open) consistency.push({ id: 'open-count', source: 'Tasks → All Tasks',
        title: `Open tasks: ${n(status.open)} here vs ${n(crosscheck.allTasksOpen)} in All Tasks`,
        detail: `All Tasks shows ${Math.round(crosscheck.allTasksOpen / Math.max(status.open, 1))}× more open tasks than this card, and the top queues alone hold ${n(sumOpen)} open. The card appears to count only the workflows in General Filter.` });
      if (crosscheck.utilAvg === 0 && crosscheck.utilAssigned > 0) consistency.push({ id: 'util-zero', source: 'Dashboard → Resource Utilization',
        title: `Utilisation 0% while ${n(crosscheck.utilAssigned)} tasks are assigned`,
        detail: `Resource Utilization reports 0% average utilisation, yet ${n(crosscheck.utilAssigned)} tasks are assigned and ${n(crosscheck.utilOpened)} opened. The utilisation job is probably not reading assignments.` });
    }
    return { model: 'cicod-insights-v1 (sovereign)', anomalies, consistency };
  }

  function mockExplain({ metric, data, queues }) {
    const qs = queues.map(q => ({ ...q, total: q.open + q.progress + q.closed }));
    const sumOpen = qs.reduce((s, q) => s + q.open, 0);
    if (metric === 'status') {
      const shown = data.open + data.progress + data.closed;
      return { model: 'cicod-insights-v1 (sovereign)', confidence: 0.86, queue: null,
        narrative: `Of ${n(data.total)} tasks ever created, this card counts ${n(shown)}: ${n(data.open)} open, ${n(data.progress)} in progress and ${n(data.closed)} closed. Only ${pct(data.closed, shown, 0)} of the counted tasks are closed, and no new tasks arrived in the period. The card covers just ${pct(shown, data.total)} of all tasks, so read it together with All Tasks.`,
        facts: [`Closed ÷ counted = ${pct(data.closed, shown)}`, `In progress ÷ open = ${pct(data.progress, data.open)}`, `Counted ÷ all created = ${pct(shown, data.total)}`] };
    }
    if (metric === 'summary') {
      const rows = data.map(r => ({ ...r, total: r.open + r.progress + r.closed }));
      const top = rows.slice().sort((a, b) => b.total - a.total)[0];
      const noClose = rows.filter(r => r.closed === 0).length;
      return { model: 'cicod-insights-v1 (sovereign)', confidence: 0.82, queue: null,
        narrative: `${top.name} is the busiest workflow with ${n(top.total)} tasks, ${pct(top.open, top.total, 0)} of them still open. ${noClose} of ${rows.length} workflows have closed nothing yet. Open work (green) dominates almost every bar, which points to a closure problem rather than an intake problem.`,
        facts: [`Busiest: ${top.name} (${n(top.total)})`, `Workflows with 0 closed: ${noClose}/${rows.length}`, `Total open in chart: ${n(rows.reduce((s, r) => s + r.open, 0))}`] };
    }
    const top = qs.slice().sort((a, b) => b.open - a.open)[0];
    return { model: 'cicod-insights-v1 (sovereign)', confidence: 0.88, queue: top.name,
      narrative: `${top.name} has ${n(top.open)} open tasks and only ${n(top.closed)} closed. It holds ${pct(top.open, sumOpen, 0)} of all open work in the top 5 queues. Complaints comes next with ${n(qs.find(q => q.name === 'Complaints')?.open || 0)} open. Clearing ${top.name} is the single change that would move the dashboard most.`,
      facts: qs.map(q => `${q.name}: ${pct(q.closed, q.total)} closed`) };
  }

  class AIDashboardInsights extends HTMLElement {
    connectedCallback() {
      this.src = document.querySelector(this.getAttribute('source')) || document;
      this.role = this.getAttribute('viewer-role') || 'user';
      this.injectExplainButtons();
      this.renderLoading();
      this.load();
    }

    readQueues() {
      return [...this.src.querySelectorAll('[data-queue]')].map(el => ({
        name: el.dataset.queue, open: +el.dataset.open, progress: +el.dataset.progress, closed: +el.dataset.closed,
      }));
    }
    readData(metric) {
      const el = this.src.querySelector(`[data-ai-explain="${metric}"]`);
      try { return JSON.parse(el?.dataset.aiData || 'null'); } catch (e) { return null; }
    }

    injectExplainButtons() {
      this.src.querySelectorAll('[data-ai-explain]').forEach(card => {
        const slot = card.querySelector('[data-ai-explain-slot]');
        if (!slot || slot.querySelector('button')) return;
        slot.innerHTML = `<button class="g-btn g-btn--sm aidi-explain-btn" type="button" data-aidi-explain="${esc(card.dataset.aiExplain)}">✦ Explain</button>`;
        slot.querySelector('button').addEventListener('click', () => this.explain(card));
      });
    }

    renderLoading() {
      this.innerHTML = `<section class="aidi" aria-live="polite">
        <div class="aidi__head"><span class="aidi__title"><span class="ai-badge">CICOD-AI</span> Insights</span><span class="ai-confidence">analysing dashboard…</span></div>
        <div class="aidi__body"><div class="ai-skeleton" style="width:70%"></div><div class="ai-skeleton" style="width:55%"></div><div class="ai-skeleton" style="width:62%"></div></div>
      </section>`;
    }

    async load() {
      const payload = { status: this.readData('status') || {}, queues: this.readQueues(), crosscheck: this.readCrosscheck(), role: this.role };
      const res = await request('/ecms/dashboard/insights', payload, { mock: mockInsights, feature: 'ecms.dashboard-insights' });
      this.result = res;
      this.render(res);
      this.dispatchEvent(new CustomEvent('ai-insight-result', { detail: res, bubbles: true }));
    }
    readCrosscheck() { try { return JSON.parse(this.src.dataset?.aiCrosscheck || 'null'); } catch (e) { return null; } }

    render(res) {
      const cards = res.anomalies.map(a => `<button class="aidi__card aidi__card--${esc(a.severity)}" type="button" data-insight="${esc(a.id)}" data-queue="${esc(a.queue || '')}">
          <span class="aidi__card-title">${esc(a.title)}</span><span class="aidi__card-detail">${esc(a.detail)}</span>
          ${a.queue ? `<span class="aidi__card-link">Show ${esc(a.queue)} ↓</span>` : ''}</button>`).join('');
      const cons = res.consistency.length ? `<div class="aidi__cons" role="alert">
          <div class="aidi__cons-head"><b>⚠ Data consistency</b><span class="g-chip">Admins only</span></div>
          ${res.consistency.map(c => `<div class="aidi__cons-item" data-check="${esc(c.id)}">
            <div><b>${esc(c.title)}</b><p>${esc(c.detail)}</p><span class="aidi__cons-src">Compared with ${esc(c.source)}</span></div>
            <div class="aidi__cons-actions"><button class="g-btn g-btn--sm g-btn--ai" type="button" data-cons="reconcile">Open reconciliation</button><button class="g-btn g-btn--sm" type="button" data-cons="acknowledged">Known issue</button></div>
          </div>`).join('')}</div>` : '';
      this.innerHTML = `<section class="aidi" aria-live="polite">
        <div class="aidi__head"><span class="aidi__title"><span class="ai-badge">CICOD-AI</span> Insights · ${res.anomalies.length} alerts</span>
          <span class="ai-confidence">${esc(res.model)}</span></div>
        <div class="aidi__body">
          <div class="aidi__cards">${cards}</div>
          ${cons}
        </div>
        <div class="aidi__foot"><span>Click an alert to highlight the queue. Figures come from this dashboard and the linked screens.</span>
          <button class="g-btn g-btn--sm g-btn--ghost" type="button" data-dismiss>Not useful</button></div>
      </section>`;
      this.querySelectorAll('[data-insight]').forEach(b => b.addEventListener('click', () => {
        this.querySelectorAll('.aidi__card--active').forEach(x => x.classList.remove('aidi__card--active'));
        b.classList.add('aidi__card--active');
        feedback(res.id, 'ecms.dashboard-insights', 'opened', { insight: b.dataset.insight });
        this.dispatchEvent(new CustomEvent('ai-insight-focus', { detail: { insightId: b.dataset.insight, queue: b.dataset.queue || null }, bubbles: true }));
      }));
      this.querySelectorAll('[data-cons]').forEach(b => b.addEventListener('click', () => {
        const item = b.closest('[data-check]');
        const action = b.dataset.cons;
        feedback(res.id, 'ecms.dashboard-insights', action, { check: item.dataset.check });
        item.querySelector('.aidi__cons-actions').innerHTML = `<span class="g-chip ${action === 'reconcile' ? 'g-chip--info' : ''}">${action === 'reconcile' ? 'Reconciliation opened ✓' : 'Marked as known'}</span>`;
        this.dispatchEvent(new CustomEvent('ai-consistency-action', { detail: { check: item.dataset.check, action }, bubbles: true }));
      }));
      this.querySelector('[data-dismiss]').addEventListener('click', e => { feedback(res.id, 'ecms.dashboard-insights', 'rejected'); e.target.textContent = 'Thanks, noted'; e.target.disabled = true; });
    }

    async explain(card) {
      const metric = card.dataset.aiExplain;
      const out = card.querySelector('[data-ai-explain-out]');
      if (!out) return;
      out.innerHTML = `<div class="aidi-x"><div class="ai-skeleton" style="width:90%"></div><div class="ai-skeleton" style="width:75%"></div><div class="ai-skeleton" style="width:60%"></div></div>`;
      const res = await request('/ecms/dashboard/explain', { metric, data: this.readData(metric), queues: this.readQueues() }, { mock: mockExplain, feature: 'ecms.dashboard-insights.explain' });
      out.innerHTML = `<div class="aidi-x" aria-live="polite">
        <div class="aidi-x__head"><span class="ai-badge">CICOD-AI explanation</span><span class="ai-confidence">${Math.round(res.confidence * 100)}% · ${esc(res.model)}</span></div>
        <p class="aidi-x__text" data-text>${esc(res.narrative)}</p>
        <ul class="aidi-x__facts">${res.facts.map(f => `<li>${esc(f)}</li>`).join('')}</ul>
        <div class="aidi-x__actions">
          <button class="g-btn g-btn--sm g-btn--ai" type="button" data-x="pin">Pin to dashboard</button>
          <button class="g-btn g-btn--sm" type="button" data-x="edit">Edit</button>
          ${res.queue ? `<button class="g-btn g-btn--sm" type="button" data-x="focus">Show ${esc(res.queue)}</button>` : ''}
          <button class="g-btn g-btn--sm g-btn--ghost" type="button" data-x="reject">Not useful</button>
        </div></div>`;
      const text = out.querySelector('[data-text]');
      out.querySelector('[data-x="pin"]').addEventListener('click', e => {
        feedback(res.id, 'ecms.dashboard-insights.explain', text.isContentEditable ? 'edited' : 'accepted', { metric });
        text.contentEditable = 'false';
        e.target.textContent = 'Pinned ✓'; e.target.disabled = true;
        this.dispatchEvent(new CustomEvent('ai-insight-pin', { detail: { metric, text: text.textContent }, bubbles: true }));
      });
      out.querySelector('[data-x="edit"]').addEventListener('click', () => { text.contentEditable = 'true'; text.focus(); });
      out.querySelector('[data-x="focus"]')?.addEventListener('click', () => this.dispatchEvent(new CustomEvent('ai-insight-focus', { detail: { insightId: 'explain-' + metric, queue: res.queue }, bubbles: true })));
      out.querySelector('[data-x="reject"]').addEventListener('click', () => { feedback(res.id, 'ecms.dashboard-insights.explain', 'rejected', { metric }); out.innerHTML = ''; });
    }
  }

  customElements.define('ai-dashboard-insights', AIDashboardInsights);
})();
