/* <ai-variance-explainer table="#stk-table" bulk-max-risk="low">
   Reads every stock count on the Stock Taking Mang. table that is awaiting approval and explains its
   variance from movement history. For each count it rebuilds the reconciliation
   (opening + received − issued − transferred ± returns = expected, compared with counted), gives a probable
   cause, flags suspicious patterns (the same counter with repeated small losses at the same store, or duplicate
   open counts) and recommends Approve, Reject or Request recount. It never approves anything itself.
   The host table marks each row with <tr data-id data-store data-cat data-asset data-code data-new data-prev
   data-by data-date> and gives it one empty cell with [data-aisv-risk], where the component puts its risk badge.
   Attributes:
     table          CSS selector of the host <table>
     bulk-max-risk  highest risk that bulk approval may include (default "low"; only fully explained rows)
   Events:
     ai-variance-result    detail: gateway response (all rows)
     ai-variance-decision  detail: { id, decision: 'approve'|'reject'|'recount', recommended, followedAI }
     ai-variance-bulk      detail: { ids: [...], decision: 'approve' }  the host approves only these rows
   Gateway: POST /ims/explain-variance
     { rows: [{ id, store, category, asset, code, newQty, prevQty, countedBy, date }] }
     -> { model, results: [{ id, risk:'low'|'medium'|'high', score, confidence, recommendation, reason,
          reconciliation:{ opening, received, issued, transferred, returns, expected, counted, unexplained, valueAtRisk },
          cause, patterns[], evidence[], explained }] } */
(function () {
  const { request, feedback, esc } = window.AIGateway;
  const FEATURE = 'ims.stock-variance';

  // Prototype-only movement ledger since the last approved count, keyed by asset code | store.
  // Codes, stores and staff are taken from the live cicod tenant; movement IDs are illustrative.
  const LEDGER = {
    '567890|Secondary Store': { lastCount: '18/09/2026', opening: 1, received: 0, issued: 0, transferred: 0, returns: 0, unit: 180000,
      evidence: ['Bin card 567890 · Secondary Store: no movement since the count on 18/09/2026'] },
    '5826|Stationary': { lastCount: '16/09/2026', opening: 23, received: 0, issued: 15, transferred: 4, returns: 0, unit: 350,
      evidence: ['Reserved & Pickup RSV-2209, RSV-2214, RSV-2231: 15 books issued to Admin Department', 'Stock Transfer TRF-0917: 4 books to Central Store on 20/09/2026'] },
    'BM7383|Market Square': { lastCount: '15/09/2026', opening: 20, received: 0, issued: 0, transferred: 0, returns: 0, unit: 450,
      evidence: ['Bin card BM7383 · Market Square: no movement since 15/09/2026'] },
    'BS456|Market Square': { lastCount: '15/09/2026', opening: 15, received: 0, issued: 0, transferred: 0, returns: 0, unit: 400,
      evidence: ['Bin card BS456 · Market Square: no movement since 15/09/2026'] },
    'STA4-80|Central Store': { lastCount: '01/09/2026', opening: 50, received: 0, issued: 4, transferred: 0, returns: 0, unit: 6500, unposted: 'RSV-2240',
      evidence: ['Reserved & Pickup RSV-2240: 4 reams approved on 24/09/2026, picked up, not yet posted to the bin card'] },
    'GBB01|Kano store': { lastCount: '17/09/2026', opening: 8, received: 0, issued: 0, transferred: 0, returns: 0, unit: 420000,
      evidence: ['Bin card GBB01 · Kano store: no issue, transfer or return since 17/09/2026', 'No Returns or Update Asset Status (Damaged) entry for this asset'] },
    'SAMSUNG01|Holding Areas': { lastCount: '22/09/2026', opening: 11, received: 1, issued: 0, transferred: 0, returns: 0, unit: 150000, pendingReceipt: true,
      evidence: ['Received Asset History: 1 × Lg Laptop from NCC on 25/09/2026 01:38, Awaiting Approval (not yet on the bin card)'] },
  };

  // Earlier approved counts that showed a loss, keyed by counter | store (last 8 weeks).
  const HISTORY = {
    'Chima Elefue|Kano store': [
      { date: '03/09/2026', asset: 'Asus Laptop', loss: 1 },
      { date: '10/09/2026', asset: 'HP ProBook 450', loss: 1 },
      { date: '17/09/2026', asset: 'Asus Laptop', loss: 1 },
    ],
    'Adeola Adesina|Stationary': [{ date: '09/09/2026', asset: '2A Excersise Book', loss: 2 }],
  };

  const naira = n => '₦' + Math.round(n).toLocaleString('en-NG');
  const num = v => (v === '' || v === '--' || v == null || isNaN(Number(v)) ? null : Number(v));

  function explainRow(row, all) {
    const key = `${row.code}|${row.store}`;
    const L = LEDGER[key] || { lastCount: 'last approved count', opening: num(row.prevQty) ?? 0, received: 0, issued: 0, transferred: 0, returns: 0, unit: 5000, evidence: ['No movement found on the bin card for this asset and store'] };
    const expected = L.opening + L.received - L.issued - L.transferred + L.returns;
    const counted = num(row.newQty);
    const unexplained = counted == null ? null : counted - expected;
    const valueAtRisk = unexplained == null ? L.opening * L.unit : Math.abs(unexplained) * L.unit;
    const patterns = [];
    const evidence = L.evidence.slice();

    // Duplicate open counts for the same asset and store
    const dups = all.filter(o => o.id !== row.id && o.code === row.code && o.store === row.store);
    const newer = dups.find(o => o.date > row.date);
    dups.forEach(o => patterns.push(`Duplicate open count: ${o.id} for the same item and store, by ${o.countedBy} on ${o.date.slice(0, 10)}`));

    // Repeated small losses by the same counter at the same store
    const hist = HISTORY[`${row.countedBy}|${row.store}`] || [];
    const isLoss = unexplained != null && unexplained < 0;
    if (hist.length >= 2 && isLoss) {
      patterns.push(`${row.countedBy} has recorded a small loss at ${row.store} in ${hist.length} of the last 4 weekly counts (${hist.map(h => `${h.date}: −${h.loss} ${h.asset}`).join('; ')}). With this count, that is ${hist.reduce((s, h) => s + h.loss, 0) + Math.abs(unexplained)} units lost with no issue or damage record.`);
      patterns.push('The same officer both counted and created the record. No second counter was present.');
    } else if (hist.length === 1 && isLoss) {
      patterns.push(`Watch: ${row.countedBy} also recorded a ${hist[0].loss}-unit loss of ${hist[0].asset} at ${row.store} on ${hist[0].date}.`);
    }

    let risk, recommendation, reason, cause, confidence;
    if (counted == null) {
      risk = 'medium'; recommendation = 'reject'; confidence = 0.9;
      cause = `New Quantity was not captured ("--"), so the system compared an empty count with the previous quantity of ${row.prevQty}. The bin card shows no movement, so ${expected} unit${expected === 1 ? '' : 's'} should still be on hand.`;
      reason = newer ? `Reject: this count is incomplete and is superseded by ${newer.id}.` : 'Reject and recount: no quantity was entered, so the variance is not real.';
    } else if (unexplained === 0) {
      risk = 'low'; recommendation = 'approve'; confidence = 0.94;
      const d = Math.abs(num(row.newQty) - num(row.prevQty));
      cause = d === 0 ? 'The count matches the bin card exactly. There is no variance to explain.'
        : L.unposted ? `The ${d}-unit difference is fully explained: pickup ${L.unposted} was approved and collected but not yet posted to the bin card, so Previous Quantity is stale.`
        : L.pendingReceipt ? `The ${d}-unit gain is fully explained by a receipt that is still awaiting approval. It was counted physically but is not on the bin card yet.`
        : `The ${d}-unit difference is fully explained by recorded movements since ${L.lastCount}.`;
      reason = 'Approve: the counted quantity equals the expected quantity from movement history.';
    } else if (patterns.some(p => /small loss at/.test(p))) {
      risk = 'high'; recommendation = 'recount'; confidence = 0.86;
      cause = `${Math.abs(unexplained)} unit${Math.abs(unexplained) === 1 ? '' : 's'} (${naira(valueAtRisk)}) cannot be explained by any issue, transfer, return or damage record since ${L.lastCount}.`;
      reason = 'Do not approve. Ask for an independent recount by a different officer and refer to the Store Manager.';
    } else {
      const explainedUnits = Math.abs(num(row.prevQty) - counted) - Math.abs(unexplained);
      risk = valueAtRisk >= 50000 ? 'high' : 'medium'; recommendation = 'recount'; confidence = 0.81;
      cause = `${explainedUnits} of the ${Math.abs(num(row.prevQty) - counted)}-unit variance is explained by recorded movements. The remaining ${Math.abs(unexplained)} unit${Math.abs(unexplained) === 1 ? '' : 's'} (${naira(valueAtRisk)}) ${unexplained < 0 ? 'is missing' : 'is extra'} with no record.`;
      reason = valueAtRisk < 5000 ? `Request a recount of the ${Math.abs(unexplained)} unaccounted units. If it is confirmed, the value is below the ₦5,000 write-off limit.` : 'Request a recount before approval.';
    }
    if (newer && recommendation !== 'reject') { recommendation = 'reject'; reason = `Reject: superseded by the newer count ${newer.id}.`; }
    const score = { low: 0.12, medium: 0.55, high: 0.88 }[risk] + (patterns.length ? 0.05 : 0);
    return {
      id: row.id, risk, score: Math.min(0.99, score), confidence, recommendation, reason, cause, patterns, evidence,
      explained: risk === 'low' && unexplained === 0 && !dups.length,
      reconciliation: { lastCount: L.lastCount, opening: L.opening, received: L.received, issued: L.issued, transferred: L.transferred, returns: L.returns, expected, counted, unexplained, valueAtRisk },
    };
  }

  function mock({ rows }) {
    return { model: 'cicod-recon-v1 + anomaly model (sovereign)', results: rows.map(r => explainRow(r, rows)) };
  }

  const RISK_LABEL = { low: 'Low risk', medium: 'Review', high: 'High risk' };
  const RISK_CHIP = { low: 'g-chip--ok', medium: 'g-chip--warn', high: 'g-chip--bad' };
  const DECISION_LABEL = { approve: 'Approve', reject: 'Reject', recount: 'Request recount' };
  const RANK = { low: 0, medium: 1, high: 2 };

  class AIVarianceExplainer extends HTMLElement {
    connectedCallback() {
      this.table = document.querySelector(this.getAttribute('table'));
      this.maxRisk = this.getAttribute('bulk-max-risk') || 'low';
      this.decided = new Set();
      this.innerHTML = `<section class="aisv" aria-live="polite"><div class="aisv__bar"></div></section>
        <div class="aisv__backdrop" hidden></div>
        <aside class="aisv__drawer" role="dialog" aria-label="CICOD-AI variance explanation" hidden></aside>`;
      this.bar = this.querySelector('.aisv__bar');
      this.drawer = this.querySelector('.aisv__drawer');
      this.backdrop = this.querySelector('.aisv__backdrop');
      this.backdrop.addEventListener('click', () => this.close());
      document.addEventListener('keydown', e => { if (e.key === 'Escape') this.close(); });
      if (this.table) this.analyse();
    }

    readRows() {
      return [...this.table.querySelectorAll('tbody tr[data-id]')].filter(tr => !this.decided.has(tr.dataset.id)).map(tr => ({
        id: tr.dataset.id, store: tr.dataset.store, category: tr.dataset.cat, asset: tr.dataset.asset, code: tr.dataset.code,
        newQty: tr.dataset.new, prevQty: tr.dataset.prev, countedBy: tr.dataset.by, date: tr.dataset.date,
      }));
    }

    cell(id) { return this.table.querySelector(`tr[data-id="${CSS.escape(id)}"] [data-aisv-risk]`); }

    async analyse() {
      const rows = this.readRows();
      this.rows = Object.fromEntries(rows.map(r => [r.id, r]));
      this.bar.innerHTML = `<span class="aisv__title"><span class="ai-badge">CICOD-AI</span> Variance check</span><div class="aisv__load"><div class="ai-skeleton" style="width:70%"></div><div class="ai-skeleton" style="width:45%"></div></div>`;
      rows.forEach(r => { const c = this.cell(r.id); if (c) c.innerHTML = '<div class="ai-skeleton aisv__skel"></div>'; });
      const res = await request('/ims/explain-variance', { rows }, { mock, feature: FEATURE });
      this.res = res;
      this.byId = Object.fromEntries(res.results.map(x => [x.id, x]));
      res.results.forEach(x => this.renderBadge(x));
      this.renderBar();
      this.dispatchEvent(new CustomEvent('ai-variance-result', { detail: res, bubbles: true }));
    }

    renderBadge(x) {
      const c = this.cell(x.id);
      if (!c) return;
      c.innerHTML = `<button type="button" class="aisv__badge aisv__badge--${x.risk}" data-aisv-explain="${esc(x.id)}" title="Explain this variance">
        <span class="aisv__dot"></span>${esc(RISK_LABEL[x.risk])}<span class="aisv__why">Explain</span></button>`;
      c.querySelector('button').addEventListener('click', () => this.open(x.id));
    }

    bulkIds() {
      return this.res.results.filter(x => !this.decided.has(x.id) && x.explained && RANK[x.risk] <= RANK[this.maxRisk]).map(x => x.id);
    }

    renderBar() {
      const open = this.res.results.filter(x => !this.decided.has(x.id));
      const n = k => open.filter(x => x.risk === k).length;
      const ids = this.bulkIds();
      this.bar.innerHTML = `<span class="aisv__title"><span class="ai-badge">CICOD-AI</span> Variance check</span>
        <span class="aisv__summary">${open.length} count${open.length === 1 ? '' : 's'} awaiting approval: <b class="aisv__n aisv__n--low">${n('low')} explained, low risk</b> · <b class="aisv__n aisv__n--medium">${n('medium')} need review</b> · <b class="aisv__n aisv__n--high">${n('high')} high risk</b></span>
        <span class="aisv__bar-actions">
          <button type="button" class="g-btn g-btn--ai g-btn--sm" data-aisv-bulk ${ids.length ? '' : 'disabled'}>Approve ${ids.length} explained low-risk</button>
          ${this.lastBulk ? `<span class="aisv__note aisv__ok">${this.lastBulk} approved in bulk ✓</span>` : ''}
          <span class="aisv__note">Rows with a review or high-risk flag are never bulk-approved · ${esc(this.res.model)}</span>
        </span>`;
      this.bar.querySelector('[data-aisv-bulk]').addEventListener('click', () => {
        const list = this.bulkIds();
        if (!list.length) return;
        list.forEach(id => this.decided.add(id));
        feedback(this.res.id, FEATURE, 'bulk-approved', { ids: list });
        this.dispatchEvent(new CustomEvent('ai-variance-bulk', { detail: { ids: list, decision: 'approve' }, bubbles: true }));
        list.forEach(id => this.markDone(id, 'approve'));
        this.lastBulk = list.length;
        this.renderBar();
      });
    }

    open(id) {
      const x = this.byId[id], r = this.rows[id], k = x.reconciliation;
      const sign = v => (v > 0 ? '+' + v : String(v));
      const line = (label, v, op, cls = '') => `<div class="aisv__rline ${cls}"><span>${label}</span><span>${op}${esc(v)}</span></div>`;
      const decided = this.decided.has(id);
      this.drawer.innerHTML = `
        <div class="aisv__dhead"><span class="aisv__title"><span class="ai-badge">CICOD-AI</span> Variance explanation</span>
          <button type="button" class="g-btn g-btn--ghost g-btn--sm" data-aisv-close aria-label="Close">✕</button></div>
        <div class="aisv__dbody">
          <div class="aisv__item"><b>${esc(r.asset)}</b> · ${esc(r.code)}<br>${esc(r.store)} · ${esc(r.category)}<br><span>Counted by ${esc(r.countedBy)} on ${esc(r.date.slice(0, 16))} · ${esc(id)}</span></div>
          <div class="aisv__risk"><span class="g-chip ${RISK_CHIP[x.risk]}">${esc(RISK_LABEL[x.risk])} · ${Math.round(x.score * 100)}</span>
            <span class="ai-confidence">confidence ${Math.round(x.confidence * 100)}% · ${esc(this.res.model)}</span></div>
          <h5 class="aisv__h">Movement reconciliation since ${esc(k.lastCount)}</h5>
          <div class="aisv__recon">
            ${line('Opening (last approved count)', k.opening, '')}
            ${line('Received', k.received, '+ ')}
            ${line('Issued (Reserved &amp; Pickup)', k.issued, '− ')}
            ${line('Transferred out', k.transferred, '− ')}
            ${line('Returns', k.returns, '± ')}
            ${line('Expected on hand', k.expected, '= ', 'aisv__rline--total')}
            ${line('Counted', k.counted == null ? 'not entered' : k.counted, '')}
            ${line('Unexplained difference', k.unexplained == null ? 'n/a' : sign(k.unexplained) + (k.unexplained ? ` (${naira(k.valueAtRisk)})` : ''), '', k.unexplained ? 'aisv__rline--bad' : 'aisv__rline--ok')}
          </div>
          <h5 class="aisv__h">Probable cause</h5><p class="aisv__p">${esc(x.cause)}</p>
          <h5 class="aisv__h">Suspicious patterns</h5>
          ${x.patterns.length ? `<ul class="aisv__pat">${x.patterns.map(p => `<li>${esc(p)}</li>`).join('')}</ul>` : '<p class="aisv__p aisv__muted">None found for this counter, store or item.</p>'}
          <h5 class="aisv__h">Evidence checked</h5><ul class="aisv__ev">${x.evidence.map(e => `<li>${esc(e)}</li>`).join('')}</ul>
          <div class="aisv__rec aisv__rec--${x.risk}"><b>CICOD-AI recommends: ${esc(DECISION_LABEL[x.recommendation])}</b>${esc(x.reason)}</div>
        </div>
        <div class="aisv__dact">
          ${decided ? '<span class="aisv__note">Decision recorded ✓</span>' : ['approve', 'reject', 'recount'].map(d => `<button type="button" class="g-btn g-btn--sm ${d === x.recommendation ? 'g-btn--ai' : ''}" data-aisv-decide="${d}">${DECISION_LABEL[d]}${d === x.recommendation ? ' (CICOD-AI)' : ''}</button>`).join('')}
          <button type="button" class="g-btn g-btn--ghost g-btn--sm" data-aisv-bad>Explanation is wrong</button>
        </div>`;
      this.drawer.querySelector('[data-aisv-close]').addEventListener('click', () => this.close());
      this.drawer.querySelectorAll('[data-aisv-decide]').forEach(b => b.addEventListener('click', () => this.decide(id, b.dataset.aisvDecide)));
      this.drawer.querySelector('[data-aisv-bad]').addEventListener('click', e => { feedback(this.res.id, FEATURE, 'rejected', { row: id }); e.target.textContent = 'Thanks, flagged for review'; e.target.disabled = true; });
      this.drawer.hidden = false; this.backdrop.hidden = false;
      this.drawer.querySelector('[data-aisv-close]').focus();
    }

    close() { if (this.drawer) { this.drawer.hidden = true; this.backdrop.hidden = true; } }

    decide(id, decision) {
      const x = this.byId[id];
      const followedAI = decision === x.recommendation;
      this.decided.add(id);
      feedback(this.res.id, FEATURE, followedAI ? 'accepted' : 'overridden', { row: id, decision, recommended: x.recommendation });
      this.dispatchEvent(new CustomEvent('ai-variance-decision', { detail: { id, decision, recommended: x.recommendation, followedAI }, bubbles: true }));
      this.markDone(id, decision);
      this.renderBar();
      this.close();
    }

    markDone(id, decision) {
      const c = this.cell(id);
      if (c) c.innerHTML = `<span class="aisv__done">${esc(DECISION_LABEL[decision])} ✓</span>`;
    }
  }

  customElements.define('ai-variance-explainer', AIVarianceExplainer);
})();
