/* <ai-citizen-assistant queues="#queue-list" mda="CICOD" open>
   A chat assistant for the Paperless Service Portal (bottom-right launcher + panel).
   Three modes:
     Start a request   The citizen describes the problem in their own words. The assistant picks
                       the Engage Us queue, pulls out what it can (date, place, vessel, receipt no.),
                       asks only for the missing fields, one at a time, accepts document uploads
                       (simulated OCR), shows a review card and returns a Tracking ID on Submit.
     Track my request  Takes a Tracking ID and explains the status in plain language (S2).
     Ask a question    Answers from published FAQs and the service charter before a ticket is raised (S3).
   Language selector: English, Hausa, Yoruba, Igbo, Pidgin. The prototype replies in English and
   shows one translated sample (Pidgin); production uses the sovereign translation model.
   Attributes:
     queues   selector of the Engage Us list; each queue has data-queue="<name>"
     mda      organisation name shown in replies
     open     start with the panel open
   Events (bubbles):
     ai-citizen-queue   { queue, confidence }                     host highlights the queue
     ai-citizen-submit  { trackingId, queue, fields, attachments } host creates the engagement
     ai-citizen-track   { trackingId, status, queue }              host shows the status
   Gateway: POST /portal/assist
     { mode:"intake"|"track"|"faq", lang, message, state, queues[], upload?:{name,size} }
     -> { model, reply, state, card?:{type:"queue"|"review"|"status"|"faq",…}, chips?:[text], done? } */
(function () {
  const { request, feedback, esc } = window.AIGateway;

  const LANGS = [['en', 'English'], ['ha', 'Hausa'], ['yo', 'Yorùbá'], ['ig', 'Igbo'], ['pcm', 'Pidgin']];
  const GREET = {
    en: 'Hello! I can help you send a request to the right office, track a request, or answer a question. Tell me what happened, in your own words.',
    pcm: 'How far! I fit help you send your matter go the correct office, check where your request reach, or answer your question. Tell me wetin happen, for your own words.',
  };

  const FIELDS = {
    fullName: { label: 'Full name', ask: 'What is your full name?' },
    email: { label: 'Email', ask: 'What email address should we send your Tracking ID to?', valid: v => /\S+@\S+\.\S+/.test(v), bad: 'That doesn\'t look like an email address. Please check it, for example ada.obi@example.com.' },
    incidentDate: { label: 'Date of incident', ask: 'When did it happen? (for example "yesterday" or "24 Sep")' },
    location: { label: 'Location', ask: 'Where did it happen? (for example "Apapa jetty, Lagos")' },
    vessel: { label: 'Vessel name', ask: 'What is the name of the boat or ship?' },
    injuries: { label: 'Injuries', ask: 'Was anyone hurt? (yes or no, and how many)' },
    reference: { label: 'Receipt / order no.', ask: 'Do you have a receipt or order number? Type it, or upload the receipt with 📎.' },
    siteAddress: { label: 'Site address', ask: 'What is the address of the site?' },
    whoClaimed: { label: 'Person involved', ask: 'What name did the person give, and what did they ask you for?' },
    tenderRef: { label: 'Tender reference', ask: 'What is the tender reference number?' },
    company: { label: 'Company name', ask: 'What is the name of your company?' },
  };

  const QUEUE_RULES = [
    { re: /boat|ship|vessel|jetty|capsiz|marine|sea|lagoon|ferry|collision at|sank|sink/i, queue: 'Marine Casualty & Incident Investigation', need: ['incidentDate', 'location', 'vessel', 'injuries', 'fullName', 'email'] },
    { re: /fraud|scam|impersonat|fake (staff|officer)|claim(ed|ing) to be|bribe|asked me to pay/i, queue: 'Fraud and Risk Management', need: ['whoClaimed', 'incidentDate', 'fullName', 'email'] },
    { re: /tender|bid|procurement|contract/i, queue: 'Bid Submission', need: ['company', 'tenderRef', 'email'] },
    { re: /building|construction|road|bridge|site|collapse|crack/i, queue: 'Construction', need: ['siteAddress', 'fullName', 'email'] },
    { re: /elderly|old people|care home|carer|aged/i, queue: 'Adult Care', need: ['location', 'fullName', 'email'] },
    { re: /complain|not delivered|delay|refund|poor service|rude|overcharg|never (came|arrived)|still waiting/i, queue: 'Complaints', need: ['reference', 'fullName', 'email'] },
    { re: /suggest|idea|improve|feature|app|website/i, queue: 'Product development', need: ['fullName', 'email'] },
    { re: /letter|correspondence|write to|petition/i, queue: 'Correspondence', need: ['fullName', 'email'] },
  ];

  const FAQ = [
    { re: /how long|when will|how many days|timeline/i, a: 'Most requests are assigned to an officer within 1 working day and resolved within 10 working days. Marine incident reports are acknowledged within 24 hours.', src: 'CICOD Service Charter, section 3 "Our response times"' },
    { re: /document|what do i need|requirement|bring/i, a: 'For complaints: your receipt or order number. For marine incidents: photos, the vessel name and any witness contacts. For bids: your CAC certificate and the tender reference.', src: 'Paperless Service Portal FAQ, "What should I attach?"' },
    { re: /open|hours|office|visit|address/i, a: 'You don\'t need to visit. Everything can be done on this portal, any time. Offices are open 8:00 to 16:00, Monday to Friday, for anyone who needs help in person.', src: 'CICOD Service Charter, section 1' },
    { re: /verify|real staff|is .* a staff|genuine/i, a: 'Use Verify Staff on this page. Enter the person\'s surname and staff ID. CICOD staff will never ask you to pay money into a personal account.', src: 'Paperless Service Portal FAQ, "Verify a staff member"' },
    { re: /cost|fee|pay|charge/i, a: 'Submitting a request on this portal is free. Official fees are only paid through Remita, never in cash.', src: 'CICOD Service Charter, section 5 "Fees"' },
  ];

  const PLACES = ['Apapa', 'Tin Can', 'Lekki', 'Badagry', 'Ikorodu', 'Warri', 'Onne', 'Calabar', 'Port Harcourt', 'Lagos', 'Kano', 'Abuja', 'Kaduna', 'Ibadan', 'Epe', 'Makoko'];
  const CANON = ['CICOD test', 'admin portal', 'Adult Care', 'Bid Submission', 'Complaints', 'Construction', 'Correspondence', 'Customer service', 'Enterprise', 'Escalation', 'Fraud and Risk Management', 'Marine Casualty & Incident Investigation', 'Product development'];

  function extract(text, fields = {}) {
    const f = { ...fields };
    const t = text;
    if (!f.incidentDate) { const d = t.match(/\b(yesterday|today|last night|this morning|(?:on )?\d{1,2}(?:st|nd|rd|th)? (?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*)\b/i); if (d) f.incidentDate = /yesterday|last night/i.test(d[1]) ? '26 Sep 2026' : /today|this morning/i.test(d[1]) ? '27 Sep 2026' : d[1].replace(/^on /i, '') + ' 2026'; }
    if (!f.location) { const p = PLACES.find(x => new RegExp(`\\b${x}\\b`, 'i').test(t)); if (p) { const m = t.match(new RegExp(`\\b${p}(?:\\s(?:jetty|port|terminal|beach|lagoon|road|market))?`, 'i')); f.location = m ? m[0].replace(/\b\w/g, c => c.toUpperCase()) : p; } }
    if (!f.vessel) { const v = t.match(/\b(?:MV|mv|M\/V|boat called|ship called|vessel)\s+["']?([A-Z][\w-]+(?:\s[A-Z][\w-]+)?)/); if (v) f.vessel = /^m\/?v/i.test(v[0]) ? `MV ${v[1]}` : v[1]; }
    if (!f.injuries) { if (/no one|nobody|nobody was|no injur|not hurt/i.test(t)) f.injuries = 'No'; else { const i = t.match(/\b(\d+|one|two|three|four|five|several)\s+(?:people\s+|persons?\s+|passengers?\s+)?(?:were\s+|was\s+)?(injured|hurt|missing|died)/i); if (i) f.injuries = `Yes: ${i[1]} ${i[2]}`; } }
    if (!f.reference) { const r = t.match(/\b(RC-?\d{4,}|order\s*(?:no\.?|number|#)?\s*[:#]?\s*\w*\d{3,}\w*)/i); if (r) f.reference = r[1].toUpperCase(); }
    if (!f.email) { const e = t.match(/\S+@\S+\.\S+/); if (e) f.email = e[0]; }
    if (!f.fullName) { const n = t.match(/\bmy name is ([A-Z][a-z]+(?: [A-Z][a-z]+)+)/); if (n) f.fullName = n[1]; }
    return f;
  }

  function trackingId(seed) {
    let h = 0; for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    return `GT-2026-0927-${String(1000 + (h % 9000))}`;
  }

  const KNOWN = {
    'GT-2026-0918-1123': { queue: 'Complaints', status: 'Waiting for you', plain: 'Your complaint is with the Customer Service unit. An officer added a note on 24 Sep asking for your receipt. Please upload it here and the officer will continue.', steps: [['Received', '18 Sep'], ['Assigned to Customer Service', '19 Sep'], ['Officer asked for your receipt', '24 Sep']], action: 'upload' },
    'GT-2026-0902-4410': { queue: 'Marine Casualty & Incident Investigation', status: 'Closed', plain: 'Your marine incident report was investigated and closed on 20 Sep. The findings letter was sent to your email. Reply here within 14 days if you disagree.', steps: [['Received', '2 Sep'], ['Investigator assigned', '3 Sep'], ['Site visit at Apapa jetty', '9 Sep'], ['Closed with findings', '20 Sep']] },
  };

  function mockAssist({ mode, lang, message = '', state = {}, upload, submitted = [] }) {
    const model = 'cicod-citizen-v1 (sovereign) · translation: ' + (lang === 'en' ? 'none' : 'cicod-mt-ng');
    const s = JSON.parse(JSON.stringify(state || {}));
    s.fields = s.fields || {};
    s.attachments = s.attachments || [];
    const pcm = lang === 'pcm';

    if (upload && s.trackId) {
      const isReceipt = /receipt|invoice|order/i.test(upload.name);
      s.attachments.push(upload.name);
      return { model, reply: `Thank you. I've added ${upload.name} to ${s.trackId}${isReceipt ? ' (I read receipt no. RC-20931, ₦12,500, dated 20 Sep 2026)' : ''}. The officer has been notified and your request moves back to "In progress".`, state: s, chips: [] };
    }
    if (upload && !s.queue && mode === 'intake') {
      s.attachments.push(upload.name);
      return { model, reply: `Thanks, I've attached ${upload.name}. Now tell me what happened, in your own words.`, state: s, chips: [] };
    }

    if (mode === 'faq') {
      const f = FAQ.find(x => x.re.test(message));
      if (!f) return { model, reply: 'I don\'t have a published answer for that yet. I can send your question to Customer service, and an officer will reply by email.', card: null, chips: ['Send it to Customer service', 'Start a request'], state: s };
      return { model, reply: f.a, card: { type: 'faq', src: f.src }, chips: ['That answered it', 'Start a request'], state: s };
    }

    if (mode === 'track') {
      const id = (message.match(/GT-\d{4}-\d{4}-\d{4}/i) || [])[0]?.toUpperCase();
      if (!id) return { model, reply: 'Please type your Tracking ID. It looks like GT-2026-0918-1123 and is in the email we sent you.', state: s, chips: ['GT-2026-0918-1123'] };
      const mine = submitted.find(x => x.trackingId === id);
      const k = KNOWN[id] || (mine ? { queue: mine.queue, status: 'Received', plain: `We received your request today and sent it to the ${mine.queue} desk. An officer is usually assigned within 1 working day. You'll get an email when that happens.`, steps: [['Received', 'Today']] } : { queue: 'Customer service', status: 'In progress', plain: 'Your request is with the Customer service unit and an officer is working on it. There is nothing you need to do right now.', steps: [['Received', '—'], ['Assigned', '—']] });
      return { model, reply: k.plain, card: { type: 'status', id, ...k }, chips: k.action === 'upload' ? ['📎 Upload receipt'] : ['Start a new request'], state: { ...s, trackId: id } };
    }

    // ---------- intake ----------
    if (upload) {
      const isReceipt = /receipt|invoice|order/i.test(upload.name);
      s.attachments.push(upload.name);
      if (isReceipt && !s.fields.reference) s.fields.reference = 'RC-20931';
      const read = isReceipt ? ` I read receipt no. RC-20931, ₦12,500, dated 20 Sep 2026.` : /\.(jpe?g|png|heic)$/i.test(upload.name) ? ' The photo is clear and has been attached.' : ' It has been attached.';
      return next(s, `Got it: ${upload.name}.${read}`, model, pcm);
    }

    if (!s.queue) {
      if (/^(how|what|when|where|can i|do i)\b.*\?$/i.test(message.trim()) && FAQ.some(x => x.re.test(message))) {
        const f = FAQ.find(x => x.re.test(message));
        return { model, reply: f.a, card: { type: 'faq', src: f.src }, chips: ['That answered it', 'Start a request'], state: s };
      }
      const rule = QUEUE_RULES.find(r => r.re.test(message)) || { queue: 'Customer service', need: ['fullName', 'email'] };
      const conf = QUEUE_RULES.includes(rule) ? Math.min(0.96, 0.78 + (message.length > 60 ? 0.12 : 0.04)) : 0.58;
      s.queue = rule.queue; s.need = rule.need; s.conf = conf; s.description = message;
      s.fields = extract(message, s.fields);
      const got = Object.keys(s.fields).filter(k => FIELDS[k]).map(k => `${FIELDS[k].label.toLowerCase()} (${s.fields[k]})`);
      const intro = pcm
        ? `E be like say this matter na for the **${rule.queue}** desk. I don send am there.${got.length ? ` I don already get: ${got.join(', ')}.` : ''}`
        : `This sounds like a matter for the **${rule.queue}** desk, so I'll send it there.${got.length ? ` I already have: ${got.join(', ')}.` : ''}`;
      const out = next(s, intro, model, pcm);
      out.card = { type: 'queue', queue: rule.queue, confidence: conf };
      return out;
    }

    // answering the pending question
    if (s.asked) {
      const def = FIELDS[s.asked];
      let v = message.trim();
      if (s.asked === 'reference' && /^(no|none|i don'?t|nope)/i.test(v)) v = 'Not available';
      if (s.asked === 'injuries' && /^no\b|nobody|no one/i.test(v)) v = 'No';
      if (s.asked === 'incidentDate') v = extract(v).incidentDate || v;
      if (def.valid && !def.valid(v)) return { model, reply: def.bad, state: s, chips: [] };
      s.fields[s.asked] = v;
      s.fields = extract(message, s.fields);
    }
    return next(s, 'Thank you.', model, pcm);
  }

  function next(s, prefix, model, pcm) {
    const missing = (s.need || []).filter(k => !s.fields[k]);
    if (missing.length) {
      s.asked = missing[0]; s.step = 'collect';
      return { model, reply: `${prefix} ${FIELDS[s.asked].ask}`, state: s, chips: s.asked === 'injuries' ? ['No one was hurt', 'Yes'] : s.asked === 'reference' ? ["I don't have one"] : [] };
    }
    s.asked = null; s.step = 'review';
    return { model, reply: `${prefix} ${pcm ? 'Everything don complete. Check am well, then press Submit.' : 'That\'s everything I need. Please check the details below, then press Submit.'}`, state: s, card: { type: 'review' }, chips: [] };
  }

  const bold = s => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');

  class AICitizenAssistant extends HTMLElement {
    connectedCallback() {
      this.lang = 'en'; this.mode = 'intake'; this.state = {}; this.submitted = [];
      this.innerHTML = `<button class="aica__launch" type="button" data-launch aria-expanded="false" aria-controls="aica-panel"><span class="aica__launch-dot">✦</span><span>Need help? Chat with us</span></button>
        <section class="aica" id="aica-panel" data-panel hidden aria-label="${esc(this.getAttribute('mda') || 'CICOD')} assistant">
          <header class="aica__head"><div><b>${esc(this.getAttribute('mda') || 'CICOD')} Assistant</b><small>CICOD-AI assistant · an officer reviews every request</small></div>
            <select class="aica__lang" data-lang aria-label="Language">${LANGS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>
            <button class="aica__x" data-close type="button" aria-label="Close chat">✕</button></header>
          <nav class="aica__modes" role="tablist">
            <button type="button" role="tab" data-mode="intake" aria-selected="true">Start a request</button>
            <button type="button" role="tab" data-mode="track" aria-selected="false">Track my request</button>
            <button type="button" role="tab" data-mode="faq" aria-selected="false">Ask a question</button></nav>
          <div class="aica__log" data-log aria-live="polite"></div>
          <div class="aica__chips" data-chips></div>
          <form class="aica__composer" data-form>
            <label class="aica__attach" title="Upload a document or photo">📎<input type="file" data-file hidden></label>
            <input class="aica__input" data-input type="text" placeholder="Type your message…" aria-label="Message" autocomplete="off">
            <button class="g-btn g-btn--primary aica__send" type="submit">Send</button>
          </form>
        </section>`;
      this.panel = this.querySelector('[data-panel]');
      this.log = this.querySelector('[data-log]');
      this.querySelector('[data-launch]').addEventListener('click', () => this.toggle(true));
      this.querySelector('[data-close]').addEventListener('click', () => this.toggle(false));
      this.querySelector('[data-lang]').addEventListener('change', e => { this.lang = e.target.value; this.reset(); });
      this.querySelectorAll('[data-mode]').forEach(b => b.addEventListener('click', () => this.setMode(b.dataset.mode)));
      this.querySelector('[data-form]').addEventListener('submit', e => { e.preventDefault(); const i = this.querySelector('[data-input]'); const v = i.value.trim(); if (v) { i.value = ''; this.send(v); } });
      this.querySelector('[data-file]').addEventListener('change', e => { const f = e.target.files[0]; if (f) this.send(null, { name: f.name, size: f.size }); e.target.value = ''; });
      this.reset();
      if (this.hasAttribute('open')) this.toggle(true);
    }

    toggle(open) {
      this.panel.hidden = !open;
      this.querySelector('[data-launch]').setAttribute('aria-expanded', String(open));
      this.classList.toggle('aica--open', open);
      if (open) setTimeout(() => this.querySelector('[data-input]').focus({ preventScroll: true }), 0);
    }

    setMode(mode) {
      this.mode = mode;
      this.querySelectorAll('[data-mode]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.mode === mode)));
      this.reset();
    }

    open(mode) { this.toggle(true); if (mode && mode !== this.mode) this.setMode(mode); }

    reset() {
      this.state = {};
      this.log.innerHTML = '';
      const note = this.lang !== 'en' && this.lang !== 'pcm' ? `<p class="aica__note">${esc(LANGS.find(l => l[0] === this.lang)[1])}: replies are translated by the sovereign translation model in production. This prototype shows English, with Pidgin as the translated sample.</p>` : '';
      const intro = this.mode === 'track' ? 'Type your Tracking ID and I\'ll explain where your request is, in plain language.'
        : this.mode === 'faq' ? 'Ask me anything about our services. I answer from the published FAQ and service charter.'
        : (GREET[this.lang] || GREET.en);
      this.bot(intro);
      if (note) this.log.insertAdjacentHTML('beforeend', note);
      this.chips(this.mode === 'track' ? ['GT-2026-0918-1123'] : this.mode === 'faq' ? ['How long does it take?', 'What documents do I need?'] : ['A boat capsized at Apapa jetty yesterday', 'My order was never delivered', 'Someone claimed to be your staff and asked me to pay']);
    }

    bot(text, html = '') { this.log.insertAdjacentHTML('beforeend', `<div class="aica__msg aica__msg--bot"><span class="aica__who">✦</span><div><p>${bold(text)}</p>${html}</div></div>`); this.log.scrollTop = this.log.scrollHeight; }
    user(text) { this.log.insertAdjacentHTML('beforeend', `<div class="aica__msg aica__msg--me"><p>${esc(text)}</p></div>`); this.log.scrollTop = this.log.scrollHeight; }

    chips(list = []) {
      const c = this.querySelector('[data-chips]');
      c.innerHTML = list.map(x => `<button class="aica__chip" type="button" data-chip="${esc(x)}">${esc(x)}</button>`).join('');
      c.querySelectorAll('[data-chip]').forEach(b => b.addEventListener('click', () => {
        const v = b.dataset.chip;
        if (v === 'Start a request' || v === 'Start a new request') return this.setMode('intake');
        if (v === 'That answered it') { feedback(this.last?.id, 'portal.citizen-assistant', 'faq-deflected'); this.bot('Glad that helped. You can close this chat, or ask something else.'); return this.chips([]); }
        if (v === '📎 Upload receipt') return this.querySelector('[data-file]').click();
        this.send(v);
      }));
    }

    async send(text, upload) {
      if (text) this.user(text); else this.user(`📎 ${upload.name}`);
      this.chips([]);
      this.log.insertAdjacentHTML('beforeend', '<div class="aica__msg aica__msg--bot" data-typing><span class="aica__who">✦</span><div class="aica__typing"><div class="ai-skeleton" style="width:160px"></div><div class="ai-skeleton" style="width:110px"></div></div></div>');
      this.log.scrollTop = this.log.scrollHeight;
      const res = await request('/portal/assist', { mode: this.mode, lang: this.lang, message: text || '', state: this.state, upload, submitted: this.submitted, queues: this.queueNames() }, { mock: mockAssist, feature: 'portal.citizen-assistant', delay: 650 });
      this.log.querySelector('[data-typing]')?.remove();
      this.last = res;
      this.state = res.state || {};
      this.bot(res.reply, this.cardHtml(res));
      this.wireCard(res);
      this.chips(res.chips || []);
      if (res.card?.type === 'queue') this.dispatchEvent(new CustomEvent('ai-citizen-queue', { detail: { queue: res.card.queue, confidence: res.card.confidence }, bubbles: true }));
      if (res.card?.type === 'status') this.dispatchEvent(new CustomEvent('ai-citizen-track', { detail: { trackingId: res.card.id, status: res.card.status, queue: res.card.queue }, bubbles: true }));
    }

    queueNames() {
      const root = document.querySelector(this.getAttribute('queues'));
      return root ? [...root.querySelectorAll('[data-queue]')].map(q => q.dataset.queue) : CANON;
    }

    cardHtml(res) {
      const c = res.card; if (!c) return '';
      if (c.type === 'queue') {
        return `<div class="aica__card"><span class="g-label">Sending to</span><div class="aica__qrow"><b>${esc(c.queue)}</b><span class="ai-confidence">${Math.round(c.confidence * 100)}% sure</span></div>
          <label class="aica__change">Not right? <select data-requeue aria-label="Change queue">${this.queueNames().map(q => `<option ${q === c.queue ? 'selected' : ''}>${esc(q)}</option>`).join('')}</select></label></div>`;
      }
      if (c.type === 'review') {
        const f = this.state.fields || {};
        const rows = Object.keys(f).filter(k => FIELDS[k]).map(k => `<div class="aica__kv"><span>${esc(FIELDS[k].label)}</span><b>${esc(f[k])}</b></div>`).join('');
        return `<div class="aica__card aica__card--review"><div class="aica__kv"><span>Desk</span><b>${esc(this.state.queue)}</b></div>
          <div class="aica__kv"><span>What happened</span><b>${esc(this.state.description)}</b></div>${rows}
          ${this.state.attachments?.length ? `<div class="aica__kv"><span>Attachments</span><b>${this.state.attachments.map(esc).join(', ')}</b></div>` : ''}
          <label class="aica__consent"><input type="checkbox" data-consent> I consent to the collection, use, processing and storage of my personal data for the purpose of delivering the requested CICOD service(s).</label>
          <div class="aica__row"><button class="g-btn g-btn--primary g-btn--sm" data-submit type="button" disabled>Submit</button><button class="g-btn g-btn--sm" data-edit type="button">Change something</button></div></div>`;
      }
      if (c.type === 'status') {
        return `<div class="aica__card"><div class="aica__qrow"><b>${esc(c.id)}</b><span class="g-chip ${c.status === 'Closed' ? 'g-chip--ok' : c.status === 'Waiting for you' ? 'g-chip--warn' : 'g-chip--info'}">${esc(c.status)}</span></div>
          <small class="aica__muted">${esc(c.queue)}</small><ol class="aica__steps">${c.steps.map(([s, d]) => `<li><span>${esc(s)}</span><small>${esc(d)}</small></li>`).join('')}</ol></div>`;
      }
      if (c.type === 'faq') return `<p class="aica__src">Source: ${esc(c.src)}</p>`;
      return '';
    }

    wireCard(res) {
      const card = this.log.lastElementChild;
      card.querySelector('[data-requeue]')?.addEventListener('change', e => {
        const old = this.state.queue; this.state.queue = e.target.value;
        feedback(res.id, 'portal.citizen-assistant', 'queue-changed', { from: old, to: e.target.value });
        this.dispatchEvent(new CustomEvent('ai-citizen-queue', { detail: { queue: e.target.value, confidence: 1 }, bubbles: true }));
      });
      const consent = card.querySelector('[data-consent]');
      consent?.addEventListener('change', () => { card.querySelector('[data-submit]').disabled = !consent.checked; });
      card.querySelector('[data-submit]')?.addEventListener('click', e => {
        const id = trackingId(JSON.stringify(this.state) + Date.now());
        const detail = { trackingId: id, queue: this.state.queue, fields: { ...this.state.fields, description: this.state.description }, attachments: this.state.attachments || [] };
        this.submitted.push(detail);
        feedback(res.id, 'portal.citizen-assistant', 'submitted', { queue: this.state.queue, turns: this.log.querySelectorAll('.aica__msg--me').length });
        this.dispatchEvent(new CustomEvent('ai-citizen-submit', { detail, bubbles: true }));
        e.target.closest('.aica__row').innerHTML = '<span class="g-chip g-chip--ok">Submitted</span>';
        this.bot(this.lang === 'pcm' ? `E don enter! Your Tracking ID na **${id}**. We don send am to your email too.` : `Done. Your Tracking ID is **${id}**. We've also emailed it to ${this.state.fields.email || 'you'}. Use "Track my request" any time to see where it is.`);
        this.state = {};
        this.chips(['Start a new request']);
      });
      card.querySelector('[data-edit]')?.addEventListener('click', () => {
        feedback(res.id, 'portal.citizen-assistant', 'edited');
        const keys = this.state.need || [];
        this.bot(`Which detail would you like to change? ${keys.map(k => FIELDS[k].label).join(', ')}.`);
        this.chips(keys.map(k => `Change ${FIELDS[k].label.toLowerCase()}`));
        this.querySelectorAll('[data-chip]').forEach(b => b.addEventListener('click', ev => {
          ev.stopImmediatePropagation();
          const k = keys.find(x => `Change ${FIELDS[x].label.toLowerCase()}` === b.dataset.chip);
          if (!k) return;
          delete this.state.fields[k]; this.state.asked = k;
          this.user(b.dataset.chip); this.bot(FIELDS[k].ask); this.chips([]);
        }, true));
      });
    }
  }

  customElements.define('ai-citizen-assistant', AICitizenAssistant);
})();
