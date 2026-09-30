/* <ai-email-triage inbox="#inbox-data" mailbox="registry@cicod.example">
   The "Triage inbox" for ECMS Email Integration. Every incoming email on a connected mailbox is
   classified (task / FYI / spam / duplicate). For each one it extracts the requester, subject, a
   request summary and the OCR text of attachments, matches an ECMS contact and suggests a queue and
   priority. The officer edits the title or queue, then clicks Create task or Discard. A paste box
   lets anyone analyse a sample email live.
   The component never creates tasks itself: the host creates them from the events.
   Attributes:
     inbox    CSS selector of a <script type="application/json"> holding the incoming emails:
              [{ id, mailbox, from, fromName, subject, body, received, attachments:[{ name, ocr? }] }]
     mailbox  Label used for pasted samples.
   Events:
     ai-email-create-task  detail: { emailId, mailbox, fields:{ title, description, queue, priority, contact }, linkTo? }
                           The host may set detail.taskId synchronously; the card then shows it.
     ai-email-discard      detail: { emailId, category }
   Gateway: POST /ecms/email-triage { emails:[…] }
     -> { model, results:[{ id, category, confidence, reason, requester, subject, summary,
                            attachments:[{ name, ocr }], contact:{ id, name } | null, queue, priority, duplicateOf? }] } */
(function () {
  const { request, feedback, esc } = window.AIGateway;
  const clip = (s, n) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s; };

  // Prototype-only knowledge from the cicod tenant: contact records (Contacts #170–176) and open tasks.
  const CONTACTS = [
    { id: 176, name: 'Rebecca Saku' }, { id: 175, name: 'Eyitayo Abidogun' }, { id: 172, name: 'Ayomide Olusanya' },
    { id: 171, name: 'Faith Egbe' }, { id: 170, name: 'Ayo Toriola' },
  ];
  const OPEN_TASKS = [
    { id: '17572', title: 'Printer on 2nd floor not working', k: /printer.*(2nd|second) floor|room 214/i },
    { id: '17578', title: 'Refund for undelivered order OF-2231', k: /OF-?2231/i },
  ];
  const RULES = [
    { k: /printer|scanner|photocopier|laptop|wi-?fi|network|internet|password|computer|outlook|email not/i, queue: 'IT Support' },
    { k: /complain|refund|not delivered|poor service|rude|delay/i, queue: 'Complaints' },
    { k: /order|deliver|supply|cartons|reams|requisition|stock/i, queue: 'Order Fulfilment' },
    { k: /vehicle|brake|repair|mechanic|service due|tyre/i, queue: 'AUTO MOBILE REPAIR' },
    { k: /\bai\b|automat|digitis|process mapping/i, queue: 'CICOD-AI IMPLEMENTATION' },
  ];

  // Very small parser so a pasted raw email ("From: … / Subject: … / Attachment: …") becomes an email object.
  function parsePasted(text) {
    const lines = String(text).split(/\r?\n/);
    const head = k => { const l = lines.find(x => new RegExp(`^${k}\\s*:`, 'i').test(x)); return l ? l.replace(/^[^:]+:\s*/, '').trim() : ''; };
    const fromRaw = head('From');
    const fromName = fromRaw.replace(/<[^>]*>/, '').replace(/"/g, '').trim();
    const att = head('Attachments?') || head('Attachment');
    const body = lines.filter(x => !/^(from|to|cc|subject|date|attachments?)\s*:/i.test(x)).join('\n').trim();
    return { id: 'paste-' + Date.now().toString(36), mailbox: 'pasted sample', from: fromRaw, fromName, subject: head('Subject'), body, received: 'just now',
      attachments: att ? att.split(/[,;]/).map(s => ({ name: s.trim() })).filter(a => a.name) : [] };
  }

  function ocrFor(a) {
    if (a.ocr) return a.ocr;
    if (/invoice|inv/i.test(a.name)) return 'INVOICE · Total ₦' + (120000 + a.name.length * 3100).toLocaleString('en-NG') + ' · Payment terms 30 days';
    if (/requisition|req/i.test(a.name)) return 'STORE REQUISITION · Item / Qty / Store fields detected';
    if (/\.(png|jpe?g)$/i.test(a.name)) return 'Image: text detected in photo (' + a.name.replace(/\.[^.]+$/, '').replace(/[_-]/g, ' ') + ')';
    return 'Document text extracted (' + a.name + ')';
  }

  function classify(e) {
    const text = `${e.subject} ${e.body}`;
    const requester = e.fromName || (e.body.match(/(?:regards|thanks|sincerely)[,\s]*\n?\s*([A-Z][a-z]+ [A-Z][a-z]+)/i) || [])[1] || 'Unknown sender';
    const contact = CONTACTS.find(c => new RegExp(c.name.replace(' ', '\\s+'), 'i').test(`${requester} ${e.body}`)) || null;
    const dup = OPEN_TASKS.find(t => t.k.test(text));
    const rule = RULES.find(r => r.k.test(text));
    const urgent = /urgent|asap|immediately|today|emergency|still/i.test(text);
    let category, reason, conf;
    if (/lottery|you have won|winner|claim your|bitcoin|crypto|prize|investment opportunity|click here to/i.test(text)) { category = 'spam'; reason = 'Prize or payment bait, and the sender domain is not on the tenant allow-list'; conf = 0.97; }
    else if (dup) { category = 'duplicate'; reason = `Same request as open task #${dup.id} "${dup.title}"`; conf = 0.9; }
    else if (/circular|newsletter|for your information|\bfyi\b|no action (is )?required|out of office|automatic reply|unsubscribe/i.test(text)) { category = 'fyi'; reason = 'Informational: no request or question addressed to the MDA'; conf = 0.88; }
    else { category = 'task'; reason = rule ? `Contains a request that matches ${rule.queue} tasks` : 'Contains a request or question that needs a reply'; conf = rule ? 0.9 : 0.72; }
    const sentences = e.body.replace(/\s+/g, ' ').replace(/^(dear \w+|good (morning|afternoon|evening)|hello|hi)[,.!]?\s*/i, '')
      .split(/(?<=[.!?])\s+/).filter(s => s.length > 12 && !/^(regards|thanks|sincerely)/i.test(s));
    return {
      id: e.id, category, confidence: conf, reason, requester, contact,
      subject: e.subject || clip(sentences[0], 60) || '(no subject)',
      summary: (clip(sentences.slice(0, 2).join(' '), 200) || clip(e.body, 200)).replace(/^./, ch => ch.toUpperCase()),
      attachments: (e.attachments || []).map(a => ({ name: a.name, ocr: ocrFor(a) })),
      queue: category === 'task' ? (rule ? rule.queue : 'Correspondence') : dup ? (rule ? rule.queue : 'Correspondence') : '—',
      priority: urgent ? 'High' : 'Normal',
      duplicateOf: dup ? dup.id : null,
    };
  }

  const mockTriage = ({ emails }) => ({ model: 'cicod-mail-triage-v1 (sovereign)', results: emails.map(classify) });

  const CAT = { task: ['ok', 'Task'], fyi: ['info', 'FYI'], spam: ['bad', 'Spam'], duplicate: ['warn', 'Duplicate'] };
  const QUEUES = ['IT Support', 'Complaints', 'Order Fulfilment', 'AUTO MOBILE REPAIR', 'CICOD-AI IMPLEMENTATION', 'Correspondence', 'TEST AUTOMATION', 'Product development'];

  class AIEmailTriage extends HTMLElement {
    connectedCallback() {
      const src = document.querySelector(this.getAttribute('inbox'));
      this.emails = src ? JSON.parse(src.textContent) : [];
      this.results = {}; this.filter = 'all';
      this.innerHTML = `
        <button class="g-btn g-btn--sm" type="button" data-open-modal style="color: var(--ai-600); border-color: var(--ai-200); background: var(--ai-50);">✦ Triage Inbox</button>
        <div class="aiet-modal" style="display: none;">
          <div class="aiet-modal__box">
            <section class="aiet" style="max-height: none;">
              <div class="aiet__head" style="display:flex; justify-content:space-between; align-items:center;">
                <div><span class="aiet__title"><span class="ai-badge">CICOD-AI</span> Triage inbox</span><span class="ai-confidence" data-model>classifying…</span></div>
                <button type="button" class="aiet-modal__close" data-close-modal title="Close">✕</button>
              </div>
              <div class="aiet__filters" data-filters></div>
              <div class="aiet__list" data-list></div>
            </section>
          </div>
        </div>`;
      
      const modal = this.querySelector('.aiet-modal');
      this.querySelector('[data-open-modal]').addEventListener('click', () => {
        modal.style.display = 'flex';
        if (!this.hasClassified) {
          this.hasClassified = true;
          this.classifyAll();
        }
      });
      this.querySelector('[data-close-modal]').addEventListener('click', () => {
        modal.style.display = 'none';
      });

      this.renderList();
    }

    async classifyAll() {
      const res = await request('/ecms/email-triage', { emails: this.emails }, { mock: mockTriage, feature: 'ecms.email-triage' });
      res.results.forEach(r => { this.results[r.id] = { ...r, reqId: res.id }; });
      this.querySelector('[data-model]').textContent = `${res.model} · ${res.results.length} emails`;
      this.renderList();
    }

    async analysePaste(force) {
      const text = this.querySelector('[data-paste]').value;
      if (text.trim().length < (force ? 5 : 25)) return;
      const email = parsePasted(text);
      if (this.pasteId) { this.emails = this.emails.filter(e => e.id !== this.pasteId); delete this.results[this.pasteId]; }
      this.pasteId = email.id;
      this.emails.unshift(email);
      this.filter = 'all';
      this.renderList();
      const res = await request('/ecms/email-triage', { emails: [email] }, { mock: mockTriage, feature: 'ecms.email-triage' });
      if (this.pasteId !== email.id) return;
      this.results[email.id] = { ...res.results[0], reqId: res.id };
      this.renderList();
    }

    renderList() {
      const counts = { all: this.emails.length, task: 0, fyi: 0, spam: 0, duplicate: 0 };
      this.emails.forEach(e => { const r = this.results[e.id]; if (r) counts[r.category]++; });
      this.querySelector('[data-filters]').innerHTML = ['all', 'task', 'fyi', 'duplicate', 'spam'].map(k =>
        `<button type="button" class="aiet__filter ${this.filter === k ? 'is-on' : ''}" data-f="${k}">${k === 'all' ? 'All' : CAT[k][1]} <span>${counts[k]}</span></button>`).join('');
      this.querySelectorAll('[data-f]').forEach(b => b.addEventListener('click', () => { this.filter = b.dataset.f; this.renderList(); }));
      const list = this.querySelector('[data-list]');
      list.innerHTML = this.emails.filter(e => this.filter === 'all' || this.results[e.id]?.category === this.filter).map(e => this.card(e)).join('') || '<p class="aiet__empty">No emails in this view.</p>';
      list.querySelectorAll('[data-card]').forEach(c => this.wire(c));
    }

    card(e) {
      const r = this.results[e.id];
      const top = `<div class="aiet__mail"><div class="aiet__from"><b>${esc(e.fromName || e.from || 'Unknown sender')}</b><span>${esc(e.mailbox)} · ${esc(e.received)}</span></div><div class="aiet__subj">${esc(e.subject || '(no subject)')}</div></div>`;
      if (!r) return `<article class="aiet__card" data-id="${esc(e.id)}">${top}<div class="ai-skeleton" style="width:30%"></div><div class="ai-skeleton" style="width:90%"></div><div class="ai-skeleton" style="width:70%"></div></article>`;
      if (r.done) return `<article class="aiet__card aiet__card--done" data-id="${esc(e.id)}">${top}<p class="aiet__done">${esc(r.done)}</p></article>`;
      const [tone, label] = CAT[r.category];
      const recommendCreate = r.category === 'task';
      const qOpts = QUEUES.map(q => `<option ${q === r.queue ? 'selected' : ''}>${esc(q)}</option>`).join('');
      return `<article class="aiet__card" data-card data-id="${esc(e.id)}">
        ${top}
        <div class="aiet__cls"><span class="g-chip g-chip--${tone}">${label}</span><span class="aiet__reason">${esc(r.reason)}</span><span class="ai-confidence">${Math.round(r.confidence * 100)}%</span></div>
        <dl class="aiet__fields">
          <dt>Requester</dt><dd>${esc(r.requester)}</dd>
          <dt>Matched contact</dt><dd>${r.contact ? `${esc(r.contact.name)} <span class="g-chip">Contact #${esc(r.contact.id)}</span>` : '<span class="aiet__muted">No match. A new contact will be created</span>'}</dd>
          <dt>Summary</dt><dd>${esc(r.summary)}</dd>
          <dt>Attachments</dt><dd>${r.attachments.length ? r.attachments.map(a => `<div class="aiet__att"><b>📎 ${esc(a.name)}</b><span>OCR: ${esc(a.ocr)}</span></div>`).join('') : '<span class="aiet__muted">None</span>'}</dd>
        </dl>
        ${r.category === 'spam' || r.category === 'fyi' ? '' : `<div class="aiet__edit">
          <label><span class="g-label">Task title</span><input class="g-input" data-title value="${esc(r.subject)}"></label>
          <label><span class="g-label">Suggested queue</span><select class="g-select" data-queue>${qOpts}</select></label>
          <label><span class="g-label">Priority</span><select class="g-select" data-priority>${['Normal', 'Low', 'Medium', 'High', 'Critical'].map(p => `<option ${p === r.priority ? 'selected' : ''}>${p}</option>`).join('')}</select></label>
        </div>`}
        <div class="aiet__actions">
          ${r.category === 'duplicate' ? `<button class="g-btn g-btn--ai g-btn--sm" data-link type="button">Add to #${esc(r.duplicateOf)}</button>` : ''}
          ${r.category === 'spam' || r.category === 'fyi' ? '' : `<button class="g-btn ${recommendCreate ? 'g-btn--ai' : ''} g-btn--sm" data-create type="button">Create task</button>`}
          <button class="g-btn ${recommendCreate || r.category === 'duplicate' ? '' : 'g-btn--ai'} g-btn--sm" data-discard type="button">${r.category === 'fyi' ? 'Mark as read' : 'Discard'}</button>
          ${r.category === 'spam' || r.category === 'fyi' ? `<button class="g-btn g-btn--sm g-btn--ghost" data-override type="button">Not ${r.category === 'spam' ? 'spam' : 'FYI'}: make it a task</button>` : ''}
        </div>
      </article>`;
    }

    wire(c) {
      const id = c.dataset.id; const r = this.results[id]; const e = this.emails.find(x => x.id === id);
      const fields = () => ({
        title: c.querySelector('[data-title]')?.value || r.subject,
        description: `${r.summary}\n\nFrom email: ${e.fromName || e.from} · ${e.received}`,
        queue: c.querySelector('[data-queue]')?.value || 'Correspondence',
        priority: c.querySelector('[data-priority]')?.value || 'Normal',
        contact: r.contact ? r.contact.name : r.requester,
      });
      const create = (linkTo) => {
        const f = fields();
        const edited = f.title !== r.subject || (r.queue !== '—' && f.queue !== r.queue);
        feedback(r.reqId, 'ecms.email-triage', linkTo ? 'linked-duplicate' : edited ? 'accepted-edited' : 'accepted', { emailId: id, category: r.category, queue: f.queue });
        const detail = { emailId: id, mailbox: e.mailbox, fields: f, linkTo: linkTo || null };
        this.dispatchEvent(new CustomEvent('ai-email-create-task', { detail, bubbles: true }));
        r.done = linkTo ? `✓ Added to task #${linkTo} as a remark, with attachments` : `✓ Task ${detail.taskId ? '#' + detail.taskId + ' ' : ''}created in ${f.queue} (${f.priority})`;
        this.renderList();
      };
      c.querySelector('[data-create]')?.addEventListener('click', () => create());
      c.querySelector('[data-link]')?.addEventListener('click', () => create(r.duplicateOf));
      c.querySelector('[data-discard]').addEventListener('click', () => {
        feedback(r.reqId, 'ecms.email-triage', r.category === 'task' ? 'rejected' : 'accepted', { emailId: id, category: r.category, action: 'discard' });
        this.dispatchEvent(new CustomEvent('ai-email-discard', { detail: { emailId: id, category: r.category }, bubbles: true }));
        r.done = r.category === 'fyi' ? '✓ Marked as read and filed' : '✓ Discarded';
        this.renderList();
      });
      c.querySelector('[data-override]')?.addEventListener('click', () => {
        feedback(r.reqId, 'ecms.email-triage', 'overridden', { emailId: id, from: r.category, to: 'task' });
        r.category = 'task'; r.reason = 'Changed to Task by the officer'; r.queue = 'Correspondence';
        this.renderList();
      });
    }
  }

  customElements.define('ai-email-triage', AIEmailTriage);
})();
