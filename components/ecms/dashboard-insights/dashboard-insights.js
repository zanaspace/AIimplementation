/* <ai-dashboard-insights source="#wf-dashboard" viewer-role="admin">
   CICOD-AI for the ECMS Workflow Dashboard, without covering the dashboard:
     1. One "✦ Insights" button (mount it next to General Filter). It opens a side panel with
        anomaly alerts, pinned notes and, for admins, a Data consistency check.
     2. A small "✦" button on each card marked [data-ai-explain] (placed in [data-ai-explain-slot]).
        It opens a floating popover with a plain-English explanation. The page layout never moves.
   It reads the figures the host already shows (data-queue rows, data-ai-data JSON on each card,
   data-ai-crosscheck JSON on the source). It never changes the dashboard figures.
   Attributes:
     source        CSS selector of the dashboard container
     viewer-role   "admin" shows the Data consistency section
   Events:
     ai-insight-result      detail: insights payload
     ai-insight-focus       detail: { insightId, queue }        host highlights that queue
     ai-insight-pin         detail: { metric, text }
     ai-consistency-action  detail: { check, action }           'acknowledged' | 'reconcile'
   Gateway:
     POST /ecms/dashboard/insights { status, queues[], crosscheck, role }
       -> { model, anomalies:[{id,severity,title,detail,queue}], consistency:[{id,title,detail,source}] }
     POST /ecms/dashboard/explain  { metric, data, queues[] } -> { model, confidence, narrative, facts[], queue? } */
(function () {
  const { request, feedback, esc } = window.AIGateway;
  const n = v => Number(v || 0).toLocaleString('en-GB');
  const pct = (a, b, d = 1) => (b ? ((a / b) * 100).toFixed(d) : '0') + '%';

  function mockInsights({ status, queues, crosscheck, role }) {
    const qs = queues.map(q => ({ ...q, total: q.open + q.progress + q.closed }));
    const sumOpen = qs.reduce((s, q) => s + q.open, 0);
    const anomalies = [];
    const stalled = qs.filter(q => q.closed / q.total < 0.005).sort((a, b) => b.open - a.open)[0];
    if (stalled) anomalies.push({ id: 'stalled', severity: 'bad', queue: stalled.name, title: `${stalled.name} is stalled`,
      detail: `${n(stalled.closed)} of ${n(stalled.total)} tasks closed (${pct(stalled.closed, stalled.total, 2)}). It holds ${pct(stalled.open, sumOpen, 0)} of open work in the top queues.` });
    const piling = qs.filter(q => q.closed && q.progress / q.closed > 3).sort((a, b) => b.progress / b.closed - a.progress / a.closed)[0];
    if (piling) anomalies.push({ id: 'piling', severity: 'warn', queue: piling.name, title: `${piling.name}: work piling up`,
      detail: `${n(piling.progress)} in progress but only ${n(piling.closed)} closed (${(piling.progress / piling.closed).toFixed(1)}×). Tasks are started faster than finished.` });
    const best = qs.slice().sort((a, b) => b.closed / b.total - a.closed / a.total)[0];
    if (best) anomalies.push({ id: 'best', severity: 'ok', queue: best.name, title: `${best.name} closes best`,
      detail: `${pct(best.closed, best.total)} of its tasks are closed, the highest of the top 5.` });
    if (status.new === 0 && status.total > 0) anomalies.push({ id: 'nonew', severity: 'warn', queue: null, title: 'No new tasks counted', detail: `New shows 0 while ${n(status.total)} tasks exist. Check the date range.` });

    const consistency = [];
    if (role === 'admin' && crosscheck) {
      if (crosscheck.allTasksOpen && crosscheck.allTasksOpen !== status.open) consistency.push({ id: 'open-count', source: 'Tasks → All Tasks',
        title: `Open: ${n(status.open)} here vs ${n(crosscheck.allTasksOpen)} in All Tasks`,
        detail: `The top queues alone hold ${n(sumOpen)} open tasks. This card seems to count only the selected date range (${crosscheck.range || 'Month'}), but it doesn't say so.` });
      if (crosscheck.utilClosed && crosscheck.utilClosed !== status.closed) consistency.push({ id: 'closed-count', source: 'Dashboard → Resource Utilization',
        title: `Closed: ${n(status.closed)} here vs ${n(crosscheck.utilClosed)} in Resource Utilization`,
        detail: `Resource Utilization reports ${n(crosscheck.utilClosed)} closed of ${n(crosscheck.utilOpened)} opened (${n(crosscheck.utilAssigned)} assigned). The two screens use different periods or filters.` });
    }
    return { model: 'cicod-insights-v1 (sovereign)', anomalies, consistency };
  }

  function mockExplain({ metric, data, queues }) {
    const qs = queues.map(q => ({ ...q, total: q.open + q.progress + q.closed }));
    const sumOpen = qs.reduce((s, q) => s + q.open, 0);
    if (metric === 'status') {
      const shown = data.open + data.progress + data.closed;
      return { model: 'cicod-insights-v1 (sovereign)', confidence: 0.86, queue: null,
        narrative: `This period counts ${n(shown)} tasks: ${n(data.open)} open, ${n(data.progress)} in progress and ${n(data.closed)} closed. Only ${pct(data.closed, shown, 0)} are closed. ${n(data.new)} new tasks arrived, out of ${n(data.total)} ever created.`,
        facts: [`Closed ÷ counted = ${pct(data.closed, shown)}`, `In progress ÷ open = ${pct(data.progress, data.open)}`, `Counted ÷ all created = ${pct(shown, data.total)}`] };
    }
    if (metric === 'summary') {
      const rows = data.map(r => ({ ...r, total: r.open + r.progress + r.closed }));
      const top = rows.slice().sort((a, b) => b.total - a.total)[0];
      const noClose = rows.filter(r => r.closed === 0).length;
      return { model: 'cicod-insights-v1 (sovereign)', confidence: 0.84, queue: null,
        narrative: `${top.name} is the busiest workflow (${n(top.total)} tasks, ${n(top.closed)} closed). ${noClose} of ${rows.length} workflows have closed nothing this period. Open work dominates almost every bar, so the gap is in closing, not intake.`,
        facts: [`Busiest: ${top.name} (${n(top.total)})`, `Workflows with 0 closed: ${noClose}/${rows.length}`, `Open in chart: ${n(rows.reduce((s, r) => s + r.open, 0))}`] };
    }
    const top = qs.slice().sort((a, b) => b.open - a.open)[0];
    return { model: 'cicod-insights-v1 (sovereign)', confidence: 0.88, queue: top.name,
      narrative: `${top.name} has ${n(top.open)} open tasks and only ${n(top.closed)} closed. That is ${pct(top.open, sumOpen, 0)} of all open work in the top 5 queues. Clearing it would move the dashboard most.`,
      facts: qs.map(q => `${q.name}: ${pct(q.closed, q.total)} closed`) };
  }

  class AIDashboardInsights extends HTMLElement {
    connectedCallback() {
      this.src = document.querySelector(this.getAttribute('source')) || document;
      this.role = this.getAttribute('viewer-role') || 'user';
      this.pins = [];
      this.innerHTML = `<button class="aidi-btn" type="button" data-open aria-expanded="false">✦ Insights <span class="aidi-btn__n" data-n>…</span></button>
        <aside class="aidi-panel" role="dialog" aria-label="CICOD-AI insights" hidden>
          <div class="aidi-panel__head"><span><span class="ai-badge">CICOD-AI</span> Insights</span><button class="aidi-x" type="button" data-close aria-label="Close">✕</button></div>
          <div class="aidi-panel__body" data-body><div class="ai-skeleton" style="width:80%"></div><div class="ai-skeleton" style="width:60%"></div></div>
        </aside>`;
      this.btn = this.querySelector('[data-open]'); this.panel = this.querySelector('.aidi-panel');
      this.btn.addEventListener('click', () => this.toggle());
      this.querySelector('[data-close]').addEventListener('click', () => this.toggle(false));
      document.addEventListener('keydown', e => { if (e.key === 'Escape') { this.toggle(false); this.closePop(); } });
      document.addEventListener('click', e => { if (this.pop && !this.pop.contains(e.target) && !e.target.closest('.aidi-explain-btn')) this.closePop(); });
      this.injectExplainButtons();
      this.load();
    }
    toggle(on = this.panel.hidden) { this.panel.hidden = !on; this.btn.setAttribute('aria-expanded', on); }

    readQueues() { return [...this.src.querySelectorAll('[data-queue][data-open]')].map(el => ({ name: el.dataset.queue, open: +el.dataset.open, progress: +el.dataset.progress, closed: +el.dataset.closed })); }
    readData(metric) { const el = this.src.querySelector(`[data-ai-explain="${metric}"]`); try { return JSON.parse(el?.dataset.aiData || 'null'); } catch (e) { return null; } }
    readCrosscheck() { try { return JSON.parse(this.src.dataset?.aiCrosscheck || 'null'); } catch (e) { return null; } }

    injectExplainButtons() {
      this.src.querySelectorAll('[data-ai-explain]').forEach(card => {
        const slot = card.querySelector('[data-ai-explain-slot]');
        if (!slot || slot.querySelector('button')) return;
        slot.innerHTML = `<button class="aidi-explain-btn" type="button" title="Explain with CICOD-AI" aria-label="Explain ${esc(card.dataset.aiExplain)} with CICOD-AI">✦</button>`;
        slot.querySelector('button').addEventListener('click', e => { e.stopPropagation(); this.explain(card, e.currentTarget); });
      });
    }

    async load() {
      const res = await request('/ecms/dashboard/insights', { status: this.readData('status') || {}, queues: this.readQueues(), crosscheck: this.readCrosscheck(), role: this.role }, { mock: mockInsights, feature: 'ecms.dashboard-insights' });
      this.result = res;
      const alerts = res.anomalies.filter(a => a.severity !== 'ok').length;
      this.querySelector('[data-n]').textContent = alerts + (res.consistency.length ? ' · ⚠' : '');
      this.btn.classList.toggle('aidi-btn--alert', res.anomalies.some(a => a.severity === 'bad') || res.consistency.length > 0);
      this.renderPanel();
      this.dispatchEvent(new CustomEvent('ai-insight-result', { detail: res, bubbles: true }));
    }

    renderPanel() {
      const res = this.result;
      const body = this.querySelector('[data-body]');
      body.innerHTML = `<div class="aidi-list">${res.anomalies.map(a => `<button class="aidi-card aidi-card--${esc(a.severity)}" type="button" data-insight="${esc(a.id)}" data-queue="${esc(a.queue || '')}">
          <b>${esc(a.title)}</b><span>${esc(a.detail)}</span>${a.queue ? `<em>Show ${esc(a.queue)} →</em>` : ''}</button>`).join('')}</div>
        ${res.consistency.length ? `<h5 class="aidi-h">⚠ Data consistency <span class="g-chip">Admins only</span></h5>${res.consistency.map(c => `<div class="aidi-cons" data-check="${esc(c.id)}"><b>${esc(c.title)}</b><p>${esc(c.detail)}</p><small>Compared with ${esc(c.source)}</small>
          <div class="aidi-row"><button class="g-btn g-btn--sm g-btn--ai" type="button" data-cons="reconcile">Open reconciliation</button><button class="g-btn g-btn--sm" type="button" data-cons="acknowledged">Known issue</button></div></div>`).join('')}` : ''}
        ${this.pins.length ? `<h5 class="aidi-h">📌 Pinned</h5>${this.pins.map(p => `<div class="aidi-pin">${esc(p)}</div>`).join('')}` : ''}
        <p class="aidi-foot">Figures come from this dashboard and the linked screens. <button class="aidi-link" type="button" data-dismiss>Not useful</button></p>`;
      body.querySelectorAll('[data-insight]').forEach(b => b.addEventListener('click', () => {
        body.querySelectorAll('.aidi-card--active').forEach(x => x.classList.remove('aidi-card--active')); b.classList.add('aidi-card--active');
        feedback(res.id, 'ecms.dashboard-insights', 'opened', { insight: b.dataset.insight });
        this.dispatchEvent(new CustomEvent('ai-insight-focus', { detail: { insightId: b.dataset.insight, queue: b.dataset.queue || null }, bubbles: true }));
      }));
      body.querySelectorAll('[data-cons]').forEach(b => b.addEventListener('click', () => {
        const item = b.closest('[data-check]'), action = b.dataset.cons;
        feedback(res.id, 'ecms.dashboard-insights', action, { check: item.dataset.check });
        item.querySelector('.aidi-row').innerHTML = `<span class="g-chip ${action === 'reconcile' ? 'g-chip--info' : ''}">${action === 'reconcile' ? 'Reconciliation opened ✓' : 'Marked as known'}</span>`;
        this.dispatchEvent(new CustomEvent('ai-consistency-action', { detail: { check: item.dataset.check, action }, bubbles: true }));
      }));
      body.querySelector('[data-dismiss]').addEventListener('click', e => { feedback(res.id, 'ecms.dashboard-insights', 'rejected'); e.target.textContent = 'Thanks, noted'; e.target.disabled = true; });
    }

    closePop() { if (this.pop) { this.pop.remove(); this.pop = null; } }
    place(pop, anchor) {
      const r = anchor.getBoundingClientRect(), w = Math.min(380, window.innerWidth - 24);
      pop.style.width = w + 'px';
      pop.style.left = Math.max(12, Math.min(r.right - w, window.innerWidth - w - 12)) + window.scrollX + 'px';
      pop.style.top = r.bottom + 8 + window.scrollY + 'px';
    }
    async explain(card, anchor) {
      const metric = card.dataset.aiExplain;
      if (this.pop && this.pop.dataset.metric === metric) return this.closePop();
      this.closePop();
      const pop = this.pop = document.createElement('div');
      pop.className = 'aidi-pop'; pop.dataset.metric = metric; pop.setAttribute('role', 'dialog');
      pop.innerHTML = '<div class="ai-skeleton" style="width:90%"></div><div class="ai-skeleton" style="width:70%"></div>';
      document.body.appendChild(pop); this.place(pop, anchor);
      const res = await request('/ecms/dashboard/explain', { metric, data: this.readData(metric), queues: this.readQueues() }, { mock: mockExplain, feature: 'ecms.dashboard-insights.explain' });
      if (this.pop !== pop) return;
      pop.innerHTML = `<div class="aidi-pop__head"><span class="ai-badge">CICOD-AI</span><span class="ai-confidence">${Math.round(res.confidence * 100)}%</span><button class="aidi-x" type="button" data-x="close" aria-label="Close">✕</button></div>
        <p class="aidi-pop__text" data-text>${esc(res.narrative)}</p>
        <ul class="aidi-pop__facts">${res.facts.map(f => `<li>${esc(f)}</li>`).join('')}</ul>
        <div class="aidi-row"><button class="g-btn g-btn--sm g-btn--ai" type="button" data-x="pin">📌 Pin</button>${res.queue ? `<button class="g-btn g-btn--sm" type="button" data-x="focus">Show ${esc(res.queue)}</button>` : ''}<button class="g-btn g-btn--sm g-btn--ghost" type="button" data-x="reject">Not useful</button></div>`;
      pop.querySelector('[data-x="close"]').addEventListener('click', () => this.closePop());
      pop.querySelector('[data-x="pin"]').addEventListener('click', e => {
        const text = pop.querySelector('[data-text]').textContent;
        feedback(res.id, 'ecms.dashboard-insights.explain', 'accepted', { metric });
        this.pins.unshift(text); this.renderPanel();
        e.target.textContent = 'Pinned ✓ (in Insights)'; e.target.disabled = true;
        this.dispatchEvent(new CustomEvent('ai-insight-pin', { detail: { metric, text }, bubbles: true }));
      });
      pop.querySelector('[data-x="focus"]')?.addEventListener('click', () => this.dispatchEvent(new CustomEvent('ai-insight-focus', { detail: { insightId: 'explain-' + metric, queue: res.queue }, bubbles: true })));
      pop.querySelector('[data-x="reject"]').addEventListener('click', () => { feedback(res.id, 'ecms.dashboard-insights.explain', 'rejected', { metric }); this.closePop(); });
    }
  }

  customElements.define('ai-dashboard-insights', AIDashboardInsights);
})();
