/* <ai-invoice-capture history-days="90">
   Reads a supplier invoice, delivery note or waybill in Receive Asset. It extracts the supplier,
   invoice number and line items (asset, qty, unit price), then runs a three-way match:
   request/PO qty vs invoiced qty vs qty counted at the dock. It also flags unit prices that are
   far from the historical price and invoices that look like one already in Payables.
   It never writes to the Receive form itself: the store officer presses "Pre-fill receipt".
   Attributes:
     history-days     how far back to look for price history and duplicates (default 90)
     outlier-pct      % above the historical unit price that counts as an outlier (default 15)
   Events:
     ai-invoice-result   detail: extraction + match payload
     ai-invoice-prefill  detail: { supplier, invoiceNo, requestRef, store, lines:[{code, asset, category, qty, unitPrice}] }
     ai-invoice-hold     detail: { invoiceNo, reasons[] }   the host routes it to I&QA review
   Gateway: POST /ims/invoice-capture
     { fileName, sample, dockQty:{ [code]: n }, historyDays, outlierPct }
     -> { model, confidence, doc:{type, supplier, invoiceNo, date, requestRef, store},
          lines:[{code, asset, category, qty, unitPrice, total, poQty, dockQty, histPrice, status}],
          flags:[{kind:'qty'|'price'|'duplicate', level:'warn'|'bad', text}] } */
(function () {
  const { request, feedback, esc } = window.AIGateway;

  // Prototype-only: three documents a Holding Areas store officer might receive. Codes, assets,
  // supplier (NCC) and historical prices come from the cicod Payables table.
  const SAMPLES = {
    'ncc-invoice': {
      fileName: 'NCC_Invoice_INV-2026-0417.pdf', type: 'Supplier invoice', supplier: 'NCC', invoiceNo: 'INV-2026-0417', date: '2026-09-26',
      requestRef: 'REQ-ICT-0912 (ECMS #17602)', store: 'Holding Areas',
      lines: [{ code: 'SAMSUNG01', asset: 'Lg Laptop', category: 'Personal Information Technology Device', qty: 5, unitPrice: 150000, poQty: 5, dock: 5 }],
    },
    'ncc-waybill': {
      fileName: 'NCC_Waybill_WB-7781_scan.jpg', type: 'Waybill + invoice (scanned)', supplier: 'NCC', invoiceNo: 'INV-2026-0431', date: '2026-09-27',
      requestRef: 'REQ-ICT-0918 (ECMS #17611)', store: 'Holding Areas',
      lines: [
        { code: 'SAMSUNG01', asset: 'Lg Laptop', category: 'Personal Information Technology Device', qty: 6, unitPrice: 185000, poQty: 5, dock: 5 },
        { code: '567895', asset: 'Samsung Ss', category: 'Personal Information Technology Device', qty: 2, unitPrice: 2000, poQty: 2, dock: 2 },
      ],
    },
    'ncc-duplicate': {
      fileName: 'NCC_Invoice_INV-2026-0398_resent.pdf', type: 'Supplier invoice', supplier: 'NCC', invoiceNo: 'INV-2026-0398', date: '2026-09-23',
      requestRef: 'REQ-ICT-0901 (ECMS #17540)', store: 'Holding Areas',
      lines: [{ code: 'SAMSUNG01', asset: 'Lg Laptop', category: 'Personal Information Technology Device', qty: 5, unitPrice: 150000, poQty: 5, dock: 5 }],
    },
  };
  // Median unit price over the last 90 days of Payables for each asset code.
  const HIST = { SAMSUNG01: { price: 150000, n: 4 }, '567895': { price: 2000, n: 1 } };
  // Already in Payables (Reference ID 1790160613560, Lg Laptop 5 × ₦150,000, received 2026-09-23).
  const PAID = [{ ref: '1790160613560', supplier: 'NCC', code: 'SAMSUNG01', total: 750000, date: '2026-09-23', invoiceNo: 'INV-2026-0398' }];

  const naira = n => '₦' + Number(n).toLocaleString('en-NG');

  function mock({ sample, dockQty = {}, outlierPct = 15 }) {
    const s = SAMPLES[sample] || SAMPLES['ncc-invoice'];
    const flags = [];
    const lines = s.lines.map(l => {
      const dock = Number.isFinite(dockQty[l.code]) ? dockQty[l.code] : l.dock;
      const hist = HIST[l.code];
      const diffPct = hist ? Math.round(((l.unitPrice - hist.price) / hist.price) * 100) : 0;
      const qtyOk = l.qty === l.poQty && dock === l.qty;
      if (l.qty !== l.poQty) flags.push({ kind: 'qty', level: 'bad', text: `${l.asset} (${l.code}): invoiced ${l.qty}, but the request approved ${l.poQty}. Pay for ${Math.min(l.poQty, dock)} only, or ask NCC for a credit note.` });
      if (dock !== l.qty) flags.push({ kind: 'qty', level: 'bad', text: `${l.asset} (${l.code}): ${dock} counted at the dock vs ${l.qty} on the invoice. Shortfall of ${l.qty - dock}.` });
      if (hist && diffPct > outlierPct) flags.push({ kind: 'price', level: 'warn', text: `${l.asset} unit price ${naira(l.unitPrice)} is ${diffPct}% above the 90-day median of ${naira(hist.price)} (${hist.n} past receipts from NCC). Confirm the price with procurement before costing.` });
      return { code: l.code, asset: l.asset, category: l.category, qty: l.qty, unitPrice: l.unitPrice, total: l.qty * l.unitPrice, poQty: l.poQty, dockQty: dock, histPrice: hist ? hist.price : null, diffPct, status: qtyOk ? 'match' : 'mismatch' };
    });
    const total = lines.reduce((a, l) => a + l.total, 0);
    const dup = PAID.find(p => p.invoiceNo === s.invoiceNo || (p.supplier === s.supplier && p.total === total && p.code === lines[0].code && p.date === s.date));
    if (dup) flags.push({ kind: 'duplicate', level: 'bad', text: `Looks like a duplicate of Payables Reference ${dup.ref}: same supplier (${dup.supplier}), same asset, same total ${naira(dup.total)}, received ${dup.date}. Do not receive again.` });
    return {
      model: 'cicod-docintel-v2 + match rules (sovereign)',
      confidence: sample === 'ncc-waybill' ? 0.81 : 0.95,
      doc: { type: s.type, fileName: s.fileName, supplier: s.supplier, invoiceNo: s.invoiceNo, date: s.date, requestRef: s.requestRef, store: s.store, total },
      lines, flags,
    };
  }

  class AIInvoiceCapture extends HTMLElement {
    connectedCallback() {
      this.historyDays = parseInt(this.getAttribute('history-days') || '90', 10);
      this.outlierPct = parseFloat(this.getAttribute('outlier-pct') || '15');
      this.renderEmpty();
    }

    shell(body, actions = '', meta = '') {
      return `<section class="aiic" aria-live="polite">
        <div class="aiic__head"><span class="aiic__title"><span class="ai-badge">CICOD-AI</span> Invoice capture &amp; 3-way match</span>${meta}</div>
        <div class="aiic__body">${body}</div>${actions ? `<div class="aiic__actions">${actions}</div>` : ''}
      </section>`;
    }

    renderEmpty() {
      this.innerHTML = this.shell(`
        <div class="aiic__drop"><b>Upload invoice / waybill</b><span>PDF, JPG or PNG. Scans and phone photos work.</span></div>
        <p class="aiic__hint">Prototype: pick a sample document.</p>
        <div class="aiic__samples">
          <button class="g-btn g-btn--sm" type="button" data-sample="ncc-invoice">NCC invoice · 5 Lg Laptops</button>
          <button class="g-btn g-btn--sm" type="button" data-sample="ncc-waybill">NCC waybill scan · 2 lines</button>
          <button class="g-btn g-btn--sm" type="button" data-sample="ncc-duplicate">NCC invoice (re-sent)</button>
        </div>`);
      this.querySelectorAll('[data-sample]').forEach(b => b.addEventListener('click', () => { this.dockQty = {}; this.analyse(b.dataset.sample); }));
    }

    renderLoading(name) {
      this.innerHTML = this.shell(`<p class="aiic__hint">Reading ${esc(name)}…</p><div class="ai-skeleton" style="width:70%"></div><div class="ai-skeleton" style="width:90%"></div><div class="ai-skeleton" style="width:55%"></div><div class="ai-skeleton" style="width:80%"></div>`);
    }

    async analyse(sample) {
      this.sample = sample;
      this.renderLoading(SAMPLES[sample].fileName);
      const payload = { fileName: SAMPLES[sample].fileName, sample, dockQty: this.dockQty || {}, historyDays: this.historyDays, outlierPct: this.outlierPct };
      const res = await request('/ims/invoice-capture', payload, { mock, feature: 'ims.invoice-capture' });
      this.result = res;
      this.render(res);
      this.dispatchEvent(new CustomEvent('ai-invoice-result', { detail: res, bubbles: true }));
    }

    render(res) {
      const d = res.doc;
      const blocking = res.flags.some(f => f.level === 'bad');
      const head = [['Supplier', d.supplier], ['Invoice no.', d.invoiceNo], ['Invoice date', d.date], ['Request / PO', d.requestRef], ['Deliver to', d.store], ['Invoice total', naira(d.total)]]
        .map(([k, v]) => `<div class="aiic__kv"><span>${k}</span><b>${esc(v)}</b></div>`).join('');
      const lines = res.lines.map(l => `<div class="aiic__line ${l.status === 'mismatch' ? 'aiic__line--bad' : ''}">
          <div class="aiic__line-name"><b>${esc(l.asset)}</b><span>${esc(l.code)} · ${esc(l.category)}</span></div>
          <div class="aiic__match">
            <div class="aiic__cell"><span>Request</span><b>${esc(l.poQty)}</b></div>
            <div class="aiic__cell ${l.qty !== l.poQty ? 'aiic__cell--bad' : ''}"><span>Invoice</span><b>${esc(l.qty)}</b></div>
            <div class="aiic__cell ${l.dockQty !== l.qty ? 'aiic__cell--bad' : ''}"><span>Counted</span><input class="g-input aiic__dock" type="number" min="0" value="${esc(l.dockQty)}" data-dock="${esc(l.code)}" aria-label="Quantity counted at the dock for ${esc(l.asset)}"></div>
            <div class="aiic__cell ${l.diffPct > this.outlierPct ? 'aiic__cell--warn' : ''}"><span>Unit price</span><b>${esc(naira(l.unitPrice))}</b>${l.histPrice ? `<i>median ${esc(naira(l.histPrice))}</i>` : ''}</div>
          </div>
          <span class="g-chip ${l.status === 'match' ? 'g-chip--ok' : 'g-chip--bad'}">${l.status === 'match' ? '3-way match ✓' : 'Mismatch'}</span>
        </div>`).join('');
      const flags = res.flags.length
        ? res.flags.map(f => `<div class="aiic__flag aiic__flag--${f.level}"><b>${f.kind === 'qty' ? 'Quantity' : f.kind === 'price' ? 'Price outlier' : 'Duplicate invoice'}</b> ${esc(f.text)}</div>`).join('')
        : '<div class="aiic__flag aiic__flag--ok"><b>All checks passed</b> Quantities agree across request, invoice and dock count. The unit price is within the normal range, and no similar invoice exists in Payables.</div>';
      const meta = `<span class="ai-confidence">${Math.round(res.confidence * 100)}% · ${esc(res.model)}</span>`;
      this.innerHTML = this.shell(`
        <div class="aiic__file"><span class="aiic__thumb" aria-hidden="true"></span><div><b>${esc(d.fileName)}</b><span>${esc(d.type)} · fields read by OCR</span></div></div>
        <div class="aiic__kvs">${head}</div>
        <h5 class="aiic__h">Line items · three-way match</h5>${lines}
        <p class="aiic__hint">Change a "Counted" figure to re-run the match.</p>
        <h5 class="aiic__h">Checks</h5>${flags}`,
        `<button class="g-btn g-btn--ai g-btn--sm" type="button" data-prefill ${res.flags.some(f => f.kind === 'duplicate') ? 'disabled' : ''}>Pre-fill receipt</button>
         ${blocking ? '<button class="g-btn g-btn--sm" type="button" data-hold>Hold for I&amp;QA review</button>' : ''}
         <button class="g-btn g-btn--sm" type="button" data-reject>Wrong document</button>
         <span class="aiic__mode">Store officer confirms · nothing is saved yet</span>`, meta);

      this.querySelectorAll('[data-dock]').forEach(inp => inp.addEventListener('change', () => {
        const v = parseInt(inp.value, 10) || 0;
        if (this.busy || (this.dockQty || {})[inp.dataset.dock] === v) return;
        this.dockQty = { ...(this.dockQty || {}), [inp.dataset.dock]: v };
        feedback(res.id, 'ims.invoice-capture', 'edited', { field: 'dockQty' });
        this.busy = true;
        // Defer the re-render so it never replaces the input while its own blur/change is running.
        setTimeout(() => this.analyse(this.sample).finally(() => { this.busy = false; }), 0);
      }));
      this.querySelector('[data-prefill]').addEventListener('click', () => this.prefill());
      this.querySelector('[data-hold]')?.addEventListener('click', e => {
        feedback(res.id, 'ims.invoice-capture', 'held');
        this.dispatchEvent(new CustomEvent('ai-invoice-hold', { detail: { invoiceNo: d.invoiceNo, reasons: res.flags.map(f => f.text) }, bubbles: true }));
        e.target.textContent = 'Sent to I&QA ✓'; e.target.disabled = true;
      });
      this.querySelector('[data-reject]').addEventListener('click', () => { feedback(res.id, 'ims.invoice-capture', 'rejected'); this.renderEmpty(); });
    }

    prefill() {
      const r = this.result;
      // Pre-fill the counted quantity, never more than the request approved.
      const lines = r.lines.map(l => ({ code: l.code, asset: l.asset, category: l.category, qty: Math.min(l.dockQty, l.poQty), unitPrice: l.unitPrice }));
      feedback(r.id, 'ims.invoice-capture', 'accepted', { flags: r.flags.length });
      this.dispatchEvent(new CustomEvent('ai-invoice-prefill', { detail: { supplier: r.doc.supplier, invoiceNo: r.doc.invoiceNo, requestRef: r.doc.requestRef, store: r.doc.store, lines }, bubbles: true }));
      const b = this.querySelector('[data-prefill]'); b.textContent = 'Receipt pre-filled ✓'; b.disabled = true;
    }
  }

  customElements.define('ai-invoice-capture', AIInvoiceCapture);
})();
