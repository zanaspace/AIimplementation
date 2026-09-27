/* <ai-approval-copilot table="#appr-table" mode="digest|bulk" approver-limit="500000">
   Helps the approver in Task Approvals.
     mode="digest"  A digest of the selected approval: what is requested, the amount, a policy check
                    against Financial Regulations thresholds, prior approvals, anomalies, and a
                    recommended decision with rationale and a cited policy document from Drive
                    (General Documents → POLICY_DOCUMENTS). Opens when a row is clicked.
     mode="bulk"    "Safe bulk approve": pre-selects only the low-risk items and explains why each
                    other item was left out. The approver still clicks Approve.
   The component never changes an approval by itself; the host applies decisions from the events.
   Attributes:
     table           CSS selector of the approvals table. Rows are tbody tr[data-id] with data-title,
                     data-kind (asset|cash|stationery|repair), data-amount, data-requester, data-dept,
                     data-budget, data-prior, data-unretired, data-split, data-unit-price, data-avg-price,
                     data-attachments.
     approver-limit  The signed-in approver's limit in naira (from Settings → Asset Thresholds).
   Events:
     ai-approval-open       detail: { id }                                     host highlights the row
     ai-approval-preselect  detail: { ids: [id] }                              host ticks the checkboxes
     ai-approval-decision   detail: { ids: [id], decision, comment, followedAI }  host records the decision
   Gateway:
     POST /ecms/approval-digest { request:{…row}, approverLimit }
       -> { model, confidence, requested, amount, checks:[{ rule, status:'ok'|'warn'|'fail', detail }],
            prior, anomalies[], recommendation:{ decision, label, rationale }, citations:[{ doc, section }] }
     POST /ecms/approval-bulk-screen { requests:[…rows], approverLimit }
       -> { model, include:[{ id, reason }], exclude:[{ id, reason }] } */
(function () {
  const { request, feedback, esc } = window.AIGateway;
  const naira = n => '₦' + Math.round(n).toLocaleString('en-NG');

  const DOCS = {
    limits: { doc: 'POLICY_DOCUMENTS / Financial Regulations (tenant copy)', section: 'Approval limits by officer' },
    advance: { doc: 'POLICY_DOCUMENTS / Financial Regulations (tenant copy)', section: 'Cash advances: retire before a new advance' },
    split: { doc: 'POLICY_DOCUMENTS / Financial Regulations (tenant copy)', section: 'Splitting of purchases to avoid approval limits' },
    stores: { doc: 'POLICY_DOCUMENTS / Stores & Asset Management Procedure', section: 'Requisition of consumables' },
  };

  // Prototype-only rules. Real thresholds come from ECMS Settings → Asset Thresholds and the policy text via retrieval.
  function mockDigest({ request: r, approverLimit, all = [] }) {
    const amt = +r.amount; const checks = []; const anomalies = []; const cites = [DOCS.limits];
    const within = amt <= approverLimit;
    checks.push({ rule: 'Approval limit', status: within ? 'ok' : 'fail', detail: within ? `${naira(amt)} is within your ${naira(approverLimit)} limit as Head of Department` : `${naira(amt)} is above your ${naira(approverLimit)} limit. It needs a Director (up to ₦2,500,000)` });
    const budget = +r.budget;
    checks.push({ rule: 'Budget line', status: amt <= budget ? 'ok' : 'fail', detail: `${naira(budget)} left on the ${r.dept} budget line${amt <= budget ? '' : '. Not enough to cover this request'}` });
    if (r.kind === 'cash') {
      cites.push(DOCS.advance);
      const un = +r.unretired || 0;
      checks.push({ rule: 'Previous advance retired', status: un ? 'fail' : 'ok', detail: un ? `${r.requester} has an unretired advance of ${naira(un)} from ${r.unretiredDate}` : 'No outstanding advance for this officer' });
      if (un) anomalies.push(`Unretired advance of ${naira(un)} (${r.unretiredDate})`);
    }
    if (r.split) {
      cites.push(DOCS.split);
      const other = all.find(x => x.id === r.split);
      const combined = amt + (other ? +other.amount : 0);
      checks.push({ rule: 'Split purchase', status: 'fail', detail: `Same vendor (${r.vendor}) as #${r.split} raised ${r.splitGap}. Together: ${naira(combined)}, above your limit` });
      anomalies.push(`Possible split purchase with #${r.split} (combined ${naira(combined)})`);
    }
    if (r.unitPrice && r.avgPrice) {
      const diff = (r.unitPrice - r.avgPrice) / r.avgPrice;
      const st = diff > 0.15 ? 'fail' : diff > 0.05 ? 'warn' : 'ok';
      checks.push({ rule: 'Price against Asset Registry', status: st, detail: `${naira(r.unitPrice)} per unit vs ${naira(r.avgPrice)} average paid in the last 12 months (${diff >= 0 ? '+' : ''}${Math.round(diff * 100)}%)` });
      if (st !== 'ok') anomalies.push(`Unit price ${Math.round(diff * 100)}% above the registry average`);
    }
    if (r.kind === 'stationery') cites.push(DOCS.stores);
    const att = +r.attachments || 0;
    checks.push({ rule: 'Supporting documents', status: att ? 'ok' : 'warn', detail: att ? `${att} attached (${r.attachNames})` : 'No quotation or invoice attached' });
    if (!att) anomalies.push('No quotation attached');

    const fails = checks.filter(c => c.status === 'fail'); const warns = checks.filter(c => c.status === 'warn');
    let rec;
    if (r.split) rec = { decision: 'Returned', label: 'Return to requester', rationale: `Return both chair requests and ask for one combined requisition. Split across two tasks, the purchase avoids the approval limit, which Financial Regulations do not allow.` };
    else if (r.kind === 'cash' && +r.unretired) rec = { decision: 'Returned', label: 'Return to requester', rationale: `Return until ${r.requester.split(' ')[0]} retires the ${naira(+r.unretired)} advance from ${r.unretiredDate}. A new advance cannot be granted while one is outstanding.` };
    else if (!within) rec = { decision: 'Forwarded', label: 'Recommend & forward to Director', rationale: `The request looks valid${warns.length ? ', with minor flags' : ''}, but ${naira(amt)} is above your limit. Add your recommendation and forward it to the Director for final approval.` };
    else if (warns.length) rec = { decision: 'Approved', label: 'Approve with comment', rationale: `Within limit and budget. ${warns.map(w => w.detail).join('. ')}. Approve, and ask for the document to be attached before payment.` };
    else rec = { decision: 'Approved', label: 'Approve', rationale: `Within your limit and the ${r.dept} budget, supporting documents attached, and consistent with prior approvals (${r.prior}). No anomalies found.` };
    const risk = fails.length ? 'high' : warns.length ? 'medium' : 'low';
    return {
      model: 'cicod-approvals-v1 (sovereign) + rules',
      confidence: fails.length ? 0.93 : warns.length ? 0.78 : 0.9,
      risk, requested: `${r.title}. Raised by ${r.requester} (${r.dept}).`, amount: amt, checks, prior: r.prior, anomalies,
      recommendation: rec, citations: cites,
    };
  }

  function mockBulk({ requests, approverLimit }) {
    const include = []; const exclude = [];
    requests.forEach(r => {
      const d = mockDigest({ request: r, approverLimit, all: requests });
      if (d.risk === 'low' && d.recommendation.decision === 'Approved') include.push({ id: r.id, title: r.title, reason: `${naira(r.amount)}, within limit and budget, documents attached, no anomalies` });
      else exclude.push({ id: r.id, title: r.title, reason: d.checks.find(c => c.status === 'fail')?.detail || d.anomalies[0] || d.checks.find(c => c.status !== 'ok')?.detail || 'Needs a closer look' });
    });
    return { model: 'cicod-approvals-v1 (sovereign) + rules', include, exclude };
  }

  const STATUS_ICON = { ok: '✓', warn: '!', fail: '✕' };

  class AIApprovalCopilot extends HTMLElement {
    connectedCallback() {
      this.mode = this.getAttribute('mode') || 'digest';
      this.table = document.querySelector(this.getAttribute('table'));
      this.limit = parseFloat(this.getAttribute('approver-limit') || '500000');
      if (this.mode === 'bulk') return this.renderBulkIdle();
      this.renderEmpty();
      this.table?.addEventListener('click', e => {
        if (e.target.closest('input, button, a, label')) return;
        const tr = e.target.closest('tbody tr[data-id]');
        if (tr && !tr.dataset.decided) this.open(tr.dataset.id);
      });
    }

    readRow(tr) {
      const d = tr.dataset;
      return { id: d.id, title: d.title, kind: d.kind, amount: +d.amount, requester: d.requester, dept: d.dept, budget: +d.budget, prior: d.prior || 'No prior approvals',
        unretired: +d.unretired || 0, unretiredDate: d.unretiredDate || '', split: d.split || '', splitGap: d.splitGap || '', vendor: d.vendor || '',
        unitPrice: +d.unitPrice || 0, avgPrice: +d.avgPrice || 0, attachments: +d.attachments || 0, attachNames: d.attachNames || '' };
    }
    pending() { return this.table ? [...this.table.querySelectorAll('tbody tr[data-id]')].filter(tr => !tr.dataset.decided).map(tr => this.readRow(tr)) : []; }

    /* ---------- Digest ---------- */
    renderEmpty() {
      this.innerHTML = `<section class="aiac"><div class="aiac__head"><span class="aiac__title"><span class="ai-badge">CICOD-AI</span> Approval digest</span></div>
        <div class="aiac__body"><p class="aiac__empty">Click an approval row to see what is requested, the policy check, anomalies and a recommended decision.</p></div></section>`;
    }

    async open(id) {
      const tr = this.table.querySelector(`tbody tr[data-id="${id}"]`);
      if (!tr) return;
      this.dispatchEvent(new CustomEvent('ai-approval-open', { detail: { id }, bubbles: true }));
      const r = this.readRow(tr);
      this.innerHTML = `<section class="aiac" aria-live="polite"><div class="aiac__head"><span class="aiac__title"><span class="ai-badge">CICOD-AI</span> Approval digest · #${esc(id)}</span><span class="ai-confidence">checking policy…</span></div>
        <div class="aiac__body"><div class="ai-skeleton" style="width:85%"></div><div class="ai-skeleton" style="width:40%;height:20px"></div><div class="ai-skeleton" style="width:92%"></div><div class="ai-skeleton" style="width:78%"></div><div class="ai-skeleton" style="width:88%"></div></div></section>`;
      const res = await request('/ecms/approval-digest', { request: r, approverLimit: this.limit, all: this.pending() }, { mock: mockDigest, feature: 'ecms.approval-copilot' });
      this.renderDigest(r, res);
    }

    renderDigest(r, res) {
      const rec = res.recommendation;
      const tone = { low: 'ok', medium: 'warn', high: 'bad' }[res.risk];
      this.innerHTML = `<section class="aiac" aria-live="polite">
        <div class="aiac__head"><span class="aiac__title"><span class="ai-badge">CICOD-AI</span> Approval digest · #${esc(r.id)}</span>
          <span class="ai-confidence">${Math.round(res.confidence * 100)}% · ${esc(res.model)}</span></div>
        <div class="aiac__body">
          <div class="aiac__what"><b>What is requested</b>${esc(res.requested)}</div>
          <div class="aiac__amt"><span>${esc(naira(res.amount))}</span><span class="g-chip g-chip--${tone}">${esc(res.risk)} risk</span></div>
          <h5 class="aiac__h">Policy check</h5>
          <ul class="aiac__checks">${res.checks.map(c => `<li class="aiac__check aiac__check--${c.status}"><span class="aiac__ico">${STATUS_ICON[c.status]}</span><span><b>${esc(c.rule)}</b>${esc(c.detail)}</span></li>`).join('')}</ul>
          <h5 class="aiac__h">Prior approvals</h5><p class="aiac__p">${esc(res.prior)}</p>
          <h5 class="aiac__h">Anomalies</h5>${res.anomalies.length ? `<ul class="aiac__anoms">${res.anomalies.map(a => `<li>${esc(a)}</li>`).join('')}</ul>` : '<p class="aiac__p">None found.</p>'}
          <div class="aiac__rec"><div class="aiac__rec-top"><span>Recommended</span><b>${esc(rec.label)}</b></div><p>${esc(rec.rationale)}</p>
            <div class="aiac__cite">${res.citations.map(c => `<span>📄 ${esc(c.doc)} · <i>${esc(c.section)}</i></span>`).join('')}</div></div>
          <label class="g-label" for="aiac-comment">Approver comment (edit before you submit)</label>
          <textarea class="g-textarea aiac__comment" id="aiac-comment" data-comment></textarea>
        </div>
        <div class="aiac__actions">
          <button class="g-btn g-btn--ai g-btn--sm" data-decide="${esc(rec.decision)}" data-ai type="button">${esc(rec.label)}</button>
          ${['Approved', 'Returned', 'Rejected'].filter(d => d !== rec.decision).map(d => `<button class="g-btn g-btn--sm" data-decide="${d}" type="button">${{ Approved: 'Approve', Returned: 'Return', Rejected: 'Reject' }[d]}</button>`).join('')}
          <span class="aiac__mode">Advice only · you decide</span>
        </div></section>`;
      this.querySelector('[data-comment]').value = rec.rationale;
      this.querySelectorAll('[data-decide]').forEach(b => b.addEventListener('click', () => {
        const followedAI = b.hasAttribute('data-ai');
        const decision = b.dataset.decide;
        const comment = this.querySelector('[data-comment]').value;
        feedback(res.id, 'ecms.approval-copilot', followedAI ? 'accepted' : 'overridden', { id: r.id, decision });
        this.dispatchEvent(new CustomEvent('ai-approval-decision', { detail: { ids: [r.id], decision, comment, followedAI }, bubbles: true }));
        this.innerHTML = `<section class="aiac"><div class="aiac__head"><span class="aiac__title"><span class="ai-badge">CICOD-AI</span> Approval digest</span></div>
          <div class="aiac__body"><p class="aiac__done">✓ #${esc(r.id)} ${esc(decision.toLowerCase())}. ${followedAI ? 'You followed the recommendation.' : 'You overrode the recommendation; this is logged to improve the model.'}</p><p class="aiac__empty">Click the next row to continue.</p></div></section>`;
      }));
    }

    /* ---------- Safe bulk approve ---------- */
    renderBulkIdle() {
      this.innerHTML = `<button class="g-btn g-btn--ai g-btn--sm" data-screen type="button">✦ Safe bulk approve</button><div class="aiac__bulk" data-panel hidden></div>`;
      this.querySelector('[data-screen]').addEventListener('click', () => this.screen());
    }

    async screen() {
      const panel = this.querySelector('[data-panel]');
      panel.hidden = false;
      panel.innerHTML = '<div class="ai-skeleton" style="width:50%"></div><div class="ai-skeleton" style="width:90%"></div><div class="ai-skeleton" style="width:80%"></div>';
      const reqs = this.pending();
      const res = await request('/ecms/approval-bulk-screen', { requests: reqs, approverLimit: this.limit }, { mock: mockBulk, feature: 'ecms.approval-bulk' });
      this.bulk = res;
      this.dispatchEvent(new CustomEvent('ai-approval-preselect', { detail: { ids: res.include.map(x => x.id) }, bubbles: true }));
      panel.innerHTML = `<div class="aiac__bulk-head"><b>CICOD-AI pre-selected ${res.include.length} of ${reqs.length} pending approvals as low risk</b><span class="ai-confidence">${esc(res.model)}</span></div>
        <div class="aiac__bulk-cols">
          <div><h5 class="aiac__h aiac__h--ok">Selected (${res.include.length})</h5><ul class="aiac__bl">${res.include.map(x => `<li><b>#${esc(x.id)}</b> ${esc(x.title)}<small>${esc(x.reason)}</small></li>`).join('') || '<li>None</li>'}</ul></div>
          <div><h5 class="aiac__h aiac__h--bad">Left out (${res.exclude.length})</h5><ul class="aiac__bl">${res.exclude.map(x => `<li><b>#${esc(x.id)}</b> ${esc(x.title)}<small>${esc(x.reason)}</small></li>`).join('') || '<li>None</li>'}</ul></div>
        </div>
        <div class="aiac__actions aiac__actions--flat">
          <button class="g-btn g-btn--primary g-btn--sm" data-approve type="button" ${res.include.length ? '' : 'disabled'}>Approve ${res.include.length} selected</button>
          <button class="g-btn g-btn--sm" data-cancel type="button">Clear selection</button>
          <span class="aiac__mode">You can untick any item before approving</span>
        </div>`;
      panel.querySelector('[data-approve]').addEventListener('click', () => {
        const ids = [...document.querySelectorAll(`${this.getAttribute('table')} tbody input[type=checkbox]:checked`)].map(c => c.closest('tr').dataset.id);
        const aiIds = res.include.map(x => x.id);
        const followedAI = ids.length === aiIds.length && ids.every(i => aiIds.includes(i));
        feedback(res.id, 'ecms.approval-bulk', followedAI ? 'accepted' : 'accepted-edited', { count: ids.length });
        this.dispatchEvent(new CustomEvent('ai-approval-decision', { detail: { ids, decision: 'Approved', comment: 'Bulk approved: low risk, within limit and budget (CICOD-AI screened).', followedAI }, bubbles: true }));
        panel.innerHTML = `<p class="aiac__done">✓ ${ids.length} approvals submitted. ${res.exclude.length} left for individual review.</p>`;
      });
      panel.querySelector('[data-cancel]').addEventListener('click', () => {
        feedback(res.id, 'ecms.approval-bulk', 'rejected');
        this.dispatchEvent(new CustomEvent('ai-approval-preselect', { detail: { ids: [] }, bubbles: true }));
        panel.hidden = true; panel.innerHTML = '';
      });
    }
  }

  customElements.define('ai-approval-copilot', AIApprovalCopilot);
})();
