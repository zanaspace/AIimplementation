/* <ai-vendor-scorer source="#po-form" vendors="#vendor-table">
   Scores every supplier's reliability for the purchase order being raised, using their
   delivery record in IMS: on-time delivery, quantity accepted by I&QA, invoice-to-agreed price
   match, price against other suppliers, and experience in the PO's asset category. The officer
   can change the weights. The component recommends a supplier and writes a justification,
   but the officer chooses.
   Reads the PO from inputs named category, asset, qty and needBy inside `source`.
   Reads suppliers from <tr data-vendor="NCC"> rows inside `vendors`.
   Attributes:
     source    CSS selector of the purchase-order form
     vendors   CSS selector of the suppliers table
   Events (the host page applies every change):
     ai-vendor-scores  detail: { scores:[{ vendor, score, flags[] }] }         show scores in the table
     ai-vendor-select  detail: { vendor, score, justification }               set the PO supplier
   Gateway:
     POST /ims/vendors/score { po:{category, asset, qty, needBy}, vendors:[name], weights:{…} }
       -> { model, vendors:[{ vendor, score, metrics:{onTime, qty, invoice, price, experience},
            avgDaysLate, deliveries, flags[], reasons[], ledger[] }], recommendation:{ vendor, text }, confidence } */
(function () {
  const { request, feedback, esc } = window.AIGateway;
  const FEATURE = 'ims.vendor-scorer';

  const METRICS = [
    ['onTime', 'On-time delivery', 30],
    ['qty', 'Quantity accepted (I&QA)', 25],
    ['invoice', 'Invoice matches agreed price', 20],
    ['price', 'Price vs other suppliers', 15],
    ['experience', 'Experience in this category', 10],
  ];

  // Prototype-only delivery ledger. In production this comes from Receive Asset, Payables
  // (Qty. Supplied / Approved / Rejected, Unit of Price) and the PO's promised date.
  // Row: [reference, category, asset, promised, delivered, qtyOrdered, qtyAccepted, agreedUnit, invoicedUnit, invoiceTotal?]
  const IT = 'Personal Information Technology Device', ST = 'Stationaries', PW = 'Power Equipment';
  const LEDGER = {
    'NCC': [
      ['1790291686099', IT, 'Lg Laptop', '2026-09-20', '2026-09-22', 5, 5, 150000, 150000],
      ['1790291680412', IT, 'Samsung Ss', '2026-07-10', '2026-07-09', 10, 10, 2000, 2000],
      ['1790291671130', IT, 'Keyboard', '2026-05-02', '2026-05-02', 30, 29, 6500, 6500],
      ['1790291665021', IT, 'Mouse', '2026-03-15', '2026-03-14', 30, 30, 4000, 4000],
      ['1790291660370', IT, 'Charger', '2026-01-20', '2026-01-21', 12, 12, 18000, 18500],
    ],
    'Abuja Tech Hub Supplies': [
      ['ATH-2026-118', IT, 'Lg Laptop', '2026-08-01', '2026-08-19', 8, 7, 132000, 139000],
      ['ATH-2026-097', IT, 'Laptop Bag', '2026-06-10', '2026-06-28', 20, 18, 9000, 9000],
      ['ATH-2026-071', IT, 'Mouse', '2026-04-05', '2026-04-05', 25, 25, 3500, 3800],
      ['ATH-2026-044', IT, 'Keyboard', '2026-02-12', '2026-03-02', 25, 22, 5800, 6200],
    ],
    'Kano Stationers Ltd': [
      ['KSL-5821', ST, '40 Leaves Exercise Book', '2026-09-10', '2026-09-10', 200, 200, 350, 350],
      ['KSL-5790', ST, 'A4 Paper (ream)', '2026-08-01', '2026-08-02', 150, 150, 6500, 6500],
      ['KSL-5744', ST, 'A4 Paper (ream)', '2026-06-03', '2026-06-03', 150, 148, 6400, 6400],
    ],
    'Greenfield Power Solutions': [
      ['GPS-0931', PW, 'Solar Sheet', '2026-07-20', '2026-07-25', 4, 4, 50000, 50000],
      ['GPS-0902', PW, 'Inverter Battery', '2026-05-11', '2026-05-12', 6, 6, 210000, 210000],
      ['GPS-0877', IT, 'UPS 1.5kVA', '2026-03-01', '2026-03-04', 10, 10, 95000, 95000],
    ],
    'Sahel Logistics & Supplies': [
      ['SLS-441', IT, 'Lg Laptop', '2026-09-02', '2026-09-06', 3, 3, 165000, 165000, 495000],
      ['SLS-442', IT, 'Lg Laptop', '2026-09-02', '2026-09-06', 3, 3, 165000, 165000, 495000],
      ['SLS-443', IT, 'Lg Laptop', '2026-09-02', '2026-09-06', 3, 2, 160000, 160000, 480000],
      ['SLS-398', ST, 'A4 Paper (ream)', '2026-06-20', '2026-06-30', 100, 88, 6900, 7200],
    ],
  };
  const APPROVAL_THRESHOLD = 500000; // illustrative: HOD approval limit per invoice
  const GRACE_DAYS = 2;              // deliveries up to 2 days after the promised date count as on time
  const NO_HISTORY_FACTOR = 0.8;     // less evidence for a supplier new to the category, so its score is discounted

  const days = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000);
  const naira = n => '₦' + Math.round(n).toLocaleString('en-NG');
  const clamp = v => Math.max(0, Math.min(1, v));

  function mockScore({ po, vendors, weights }) {
    // Median unit price per asset across all suppliers, for the price metric.
    const byAsset = {};
    Object.values(LEDGER).flat().forEach(r => { (byAsset[r[2]] = byAsset[r[2]] || []).push(r[7]); });
    const median = a => { const v = [...byAsset[a]].sort((x, y) => x - y); return v[Math.floor(v.length / 2)]; };
    const wSum = Object.values(weights).reduce((s, w) => s + w, 0) || 1;

    const out = vendors.filter(v => LEDGER[v]).map(vendor => {
      const rows = LEDGER[vendor];
      const late = rows.map(r => days(r[3], r[4]));
      const onTime = rows.filter((r, i) => late[i] <= GRACE_DAYS).length / rows.length;
      const lateOnes = late.filter(d => d > GRACE_DAYS);
      const avgDaysLate = lateOnes.reduce((s, d) => s + d, 0) / Math.max(1, lateOnes.length);
      const qty = rows.reduce((s, r) => s + r[6], 0) / rows.reduce((s, r) => s + r[5], 0);
      const invoiceOk = rows.filter(r => Math.abs(r[8] - r[7]) / r[7] <= 0.01).length / rows.length;
      const ratio = rows.reduce((s, r) => s + r[7] / median(r[2]), 0) / rows.length;
      const price = clamp(1 - (ratio - 0.85) * 2); // 15% under median or cheaper scores 1
      const inCat = rows.filter(r => r[1] === po.category).length;
      const experience = clamp(inCat / 4);
      const metrics = { onTime, qty, invoice: invoiceOk, price, experience };
      let score = Math.round(METRICS.reduce((s, [k]) => s + metrics[k] * weights[k], 0) / wSum * 100 * (inCat ? 1 : NO_HISTORY_FACTOR));

      const flags = []; const reasons = [];
      if (onTime < 0.7) flags.push(['bad', 'Often late']);
      if (qty < 0.95) flags.push(['warn', 'Short deliveries']);
      if (invoiceOk < 0.8) flags.push(['warn', 'Invoice mismatches']);
      if (ratio > 1.1) flags.push(['warn', 'Price above median']);
      if (!inCat) flags.push(['info', 'No history in this category']);
      // Invoices on the same day, each just under the approval threshold, suggest a split order.
      const sameDay = rows.filter(r => r[9] && r[9] < APPROVAL_THRESHOLD && r[9] >= APPROVAL_THRESHOLD * 0.9);
      const split = sameDay.length >= 2 && new Set(sameDay.map(r => r[3])).size === 1;
      if (split) { flags.push(['bad', 'Possible split invoices']); score = Math.max(0, score - 15); }

      reasons.push(`${Math.round(onTime * 100)}% of ${rows.length} deliveries arrived within ${GRACE_DAYS} days of the promised date${lateOnes.length ? `; late ones averaged ${Math.round(avgDaysLate)} days late` : ''}.`);
      reasons.push(`I&QA accepted ${Math.round(qty * 100)}% of the quantity supplied.`);
      reasons.push(`${Math.round(invoiceOk * 100)}% of invoices matched the agreed unit price.`);
      reasons.push(`Prices average ${Math.round((ratio - 1) * 100) >= 0 ? '+' : ''}${Math.round((ratio - 1) * 100)}% against the median of all suppliers for the same items.`);
      reasons.push(inCat ? `${inCat} past deliver${inCat === 1 ? 'y' : 'ies'} in ${po.category}.` : `No past deliveries in ${po.category}, so there's less evidence for this order and the score is reduced by ${Math.round((1 - NO_HISTORY_FACTOR) * 100)}%.`);
      if (split) reasons.push(`${sameDay.length} invoices dated ${sameDay[0][3]} of ${sameDay.map(r => naira(r[9])).join(', ')}. Each is just under the ${naira(APPROVAL_THRESHOLD)} approval limit, which looks like one order split to avoid approval. Refer to the Head of Procurement.`);

      return {
        vendor, score, metrics, avgDaysLate, deliveries: rows.length, inCategory: inCat, flags, reasons,
        confidence: Math.min(0.92, 0.45 + rows.length * 0.08 + inCat * 0.05),
        ledger: rows.slice(0, 4).map(r => ({ ref: r[0], asset: r[2], promised: r[3], delivered: r[4], late: days(r[3], r[4]), qty: `${r[6]}/${r[5]}`, price: r[8] === r[7] ? naira(r[8]) : `${naira(r[8])} (agreed ${naira(r[7])})` })),
      };
    }).sort((a, b) => b.score - a.score);

    const eligible = out.filter(v => v.inCategory > 0 && !v.flags.some(f => f[1] === 'Possible split invoices'));
    const best = eligible[0] || out[0];
    // Compare against the next supplier that has actually delivered in this category.
    const runner = out.find(v => v !== best && v.inCategory > 0) || out.find(v => v !== best);
    const need = po.needBy ? days(new Date().toISOString().slice(0, 10), po.needBy) : null;
    const text = best ? `${best.vendor} is the most reliable supplier for ${po.qty || 'this'} × ${po.asset || 'item'} (${po.category}), with a score of ${best.score}/100 from ${best.deliveries} deliveries. ` +
      `${best.metrics.onTime >= 0.8 ? 'It delivers on time and ' : ''}${best.metrics.invoice >= 0.8 ? 'its invoices match the agreed price. ' : 'Check invoice prices on receipt. '}` +
      (runner ? `${runner.vendor} scores ${runner.score}${runner.metrics.price > best.metrics.price ? ' and is cheaper, but ' + (runner.metrics.onTime < 0.7 ? 'it is often late' : 'its record is weaker') : ''}.` : '') +
      (need !== null && need < 14 && best.avgDaysLate > 2 ? ` The order is needed in ${need} days, so ask ${best.vendor} to confirm the delivery date in writing.` : '') : 'No supplier has a delivery record yet.';

    return { model: 'cicod-ims-vendor-v1 (scoring rules + LLM summary)', vendors: out, recommendation: best ? { vendor: best.vendor, text } : null, confidence: best ? best.confidence : 0 };
  }

  const scoreClass = s => (s >= 75 ? '' : s >= 55 ? 'aivs__score--mid' : 'aivs__score--low');
  const chip = ([kind, label]) => `<span class="g-chip g-chip--${kind}">${esc(label)}</span>`;

  class AIVendorScorer extends HTMLElement {
    connectedCallback() {
      this.form = document.querySelector(this.getAttribute('source'));
      this.table = document.querySelector(this.getAttribute('vendors'));
      this.weights = Object.fromEntries(METRICS.map(([k, , w]) => [k, w]));
      this.open = null;
      this.innerHTML = `<section class="aivs" aria-live="polite">
        <div class="aivs__head"><span class="aivs__title"><span class="ai-badge">CICOD-AI</span> Supplier reliability</span><span class="ai-confidence" data-model></span></div>
        <div class="aivs__body" data-body><p class="aivs__empty">Fill in the purchase order and CICOD-AI will score each supplier's delivery record for it.</p></div>
        <div class="aivs__actions"><button class="g-btn g-btn--ai g-btn--sm" data-run type="button">✦ Score suppliers</button><span class="aivs__mode">Recommendation only · officer chooses</span></div>
      </section>`;
      this.querySelector('[data-run]').addEventListener('click', () => this.run());
      let t;
      // Re-score only when a field that affects the score changes (not the supplier or justification).
      this.form?.addEventListener('change', e => {
        if (!this.res || !['category', 'asset', 'qty', 'needBy'].includes(e.target.name)) return;
        clearTimeout(t); t = setTimeout(() => this.run(), 300);
      });
    }

    po() {
      const v = n => this.form?.querySelector(`[name=${n}]`)?.value || '';
      return { category: v('category'), asset: v('asset'), qty: v('qty'), needBy: v('needBy') };
    }

    async run() {
      const body = this.querySelector('[data-body]');
      body.innerHTML = '<div class="ai-skeleton" style="width:85%"></div><div class="ai-skeleton" style="width:60%"></div><div class="ai-skeleton" style="width:75%"></div><div class="ai-skeleton" style="width:50%"></div>';
      const vendors = [...(this.table?.querySelectorAll('[data-vendor]') || [])].map(r => r.dataset.vendor);
      const res = await request('/ims/vendors/score', { po: this.po(), vendors, weights: this.weights }, { mock: mockScore, feature: FEATURE, delay: this.res ? 350 : undefined });
      this.res = res;
      this.render();
      this.dispatchEvent(new CustomEvent('ai-vendor-scores', { detail: { scores: res.vendors.map(v => ({ vendor: v.vendor, score: v.score, flags: v.flags.map(f => f[1]) })) }, bubbles: true }));
    }

    render() {
      const res = this.res;
      this.querySelector('[data-model]').textContent = res.model;
      const rec = res.recommendation;
      const list = res.vendors.map(v => `
        <div class="aivs__vendor" data-v="${esc(v.vendor)}">
          <button class="aivs__vendor-btn" data-toggle="${esc(v.vendor)}" type="button" aria-expanded="${this.open === v.vendor}">
            <span class="aivs__score ${scoreClass(v.score)}">${v.score}</span>
            <span class="aivs__vname">${esc(v.vendor)}<span class="aivs__vsub">${v.deliveries} deliveries · ${v.inCategory} in this category · confidence ${Math.round(v.confidence * 100)}%</span></span>
            <span class="aivs__flags">${v.flags.map(chip).join('')}</span>
          </button>
          <div class="aivs__detail" ${this.open === v.vendor ? '' : 'hidden'}>
            <div class="aivs__metrics">${METRICS.map(([k, label]) => `<div class="aivs__metric"><span>${label}</span><span class="aivs__metric-bar"><i style="width:${Math.round(v.metrics[k] * 100)}%"></i></span><span class="aivs__metric-val">${Math.round(v.metrics[k] * 100)}%</span></div>`).join('')}</div>
            <ul class="aivs__why">${v.reasons.map(r => `<li>${esc(r)}</li>`).join('')}</ul>
            <div class="aivs__ledger g-table-wrap"><table class="g-table"><thead><tr><th>Reference</th><th>Asset</th><th>Promised</th><th>Delivered</th><th>Qty accepted</th><th>Invoiced unit</th></tr></thead><tbody>
              ${v.ledger.map(l => `<tr><td>${esc(l.ref)}</td><td>${esc(l.asset)}</td><td>${esc(l.promised)}</td><td class="${l.late > 0 ? 'aivs__late' : ''}">${esc(l.delivered)}${l.late > 0 ? ` (+${l.late}d)` : ''}</td><td>${esc(l.qty)}</td><td>${esc(l.price)}</td></tr>`).join('')}
            </tbody></table></div>
            <div style="margin-top:8px"><button class="g-btn g-btn--sm" data-pick="${esc(v.vendor)}" type="button">Choose ${esc(v.vendor)}</button></div>
          </div>
        </div>`).join('');

      this.querySelector('[data-body]').innerHTML = `
        ${rec ? `<div class="aivs__rec"><div class="aivs__rec-top"><span class="aivs__rec-name">Recommended: ${esc(rec.vendor)}</span><span class="ai-confidence">confidence ${Math.round(res.confidence * 100)}%</span></div>
          <p data-rec-text>${esc(rec.text)}</p>
          <button class="g-btn g-btn--ai g-btn--sm" data-pick="${esc(rec.vendor)}" type="button">Use ${esc(rec.vendor)} on this PO</button></div>` : ''}
        <h5 class="aivs__h5">All suppliers, ranked. Click one to see the evidence.</h5>
        ${list}
        <details class="aivs__weights" ${this.weightsOpen ? 'open' : ''}><summary>Adjust what matters for this order</summary>
          ${METRICS.map(([k, label]) => `<div class="aivs__w"><label for="aivs-w-${k}">${label}</label><input id="aivs-w-${k}" type="range" min="0" max="50" step="5" value="${this.weights[k]}" data-w="${k}"><output>${this.weights[k]}</output></div>`).join('')}
        </details>`;

      this.querySelectorAll('[data-toggle]').forEach(b => b.addEventListener('click', () => {
        this.open = this.open === b.dataset.toggle ? null : b.dataset.toggle;
        this.render();
      }));
      this.querySelectorAll('[data-pick]').forEach(b => b.addEventListener('click', () => this.pick(b.dataset.pick)));
      const det = this.querySelector('.aivs__weights');
      det.addEventListener('toggle', () => { this.weightsOpen = det.open; });
      let t;
      this.querySelectorAll('[data-w]').forEach(r => r.addEventListener('input', () => {
        this.weights[r.dataset.w] = Number(r.value);
        r.nextElementSibling.textContent = r.value;
        clearTimeout(t); t = setTimeout(() => this.run(), 350);
      }));
    }

    pick(vendor) {
      const v = this.res.vendors.find(x => x.vendor === vendor);
      const rec = this.res.recommendation;
      const followed = rec && rec.vendor === vendor;
      const justification = followed ? rec.text : `${vendor} chosen by the officer (score ${v.score}/100). CICOD-AI recommended ${rec ? rec.vendor : 'none'}. Reason for choosing differently: `;
      feedback(this.res.id, FEATURE, followed ? 'accepted' : 'overridden', { vendor });
      this.dispatchEvent(new CustomEvent('ai-vendor-select', { detail: { vendor, score: v.score, justification, followed }, bubbles: true }));
    }
  }

  customElements.define('ai-vendor-scorer', AIVendorScorer);
})();
