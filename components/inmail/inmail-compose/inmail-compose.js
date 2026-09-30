/* <ai-mail-assist mode="inbox|thread|compose">
   Smart compose and summaries for CICOD InMail. One element, three placements:
     mode="inbox"   source="#list"    "Summarise unread" in the inbox header: one line per unread
                                      message, with what it asks of you and by when.
     mode="thread"  source="#thread"  "Summarise" on an open thread: TL;DR, decisions, asks, deadline.
     mode="compose" form="#compose"   "Draft from notes" with a tone selector. For a Circular it also
                                      suggests the audience (departments, grade levels) and writes a
                                      plain-language summary. It adds a pre-send check to the form's
                                      [data-send] button (e.g. Secret content + external recipient).
   The component never edits the message itself: the host applies inserts and fixes.
   Attributes: mode, source (inbox/thread), form (compose), sender, mda
   Host markup it reads:
     inbox   rows [data-msg] with data-id, data-from, data-subject, data-snippet, data-unread="true"
     thread  [data-thread-msg] with data-from, data-date and the body as text; [data-thread-subject]
     compose [name=type] (Message|Circular), [name=to], [name=cc], [name=subject], [name=body],
             [name=classification], [data-attachments] (count), [name=audience] (circular)
   Events (bubbles):
     ai-mail-open    { id }                                      host opens that message
     ai-mail-reply   { subject, notes }                          host starts a reply with these notes
     ai-mail-insert  { subject, body, audience[], summary }      host puts the draft into Compose
     ai-mail-fix     { field, value }                            host applies a pre-send fix
     ai-mail-send    { overridden, issues[] }                    host sends the message
   Gateway:
     POST /inmail/summarise   { scope:"unread"|"thread", messages:[{id,from,subject,body,date}] }
                              -> { model, tldr, points[], asks:[{who,what,due}], items:[{id,line,action,due}] }
     POST /inmail/draft       { type, notes, tone, to, sender, mda }
                              -> { model, subject, body, audience?:{departments[],grades[],why}, summary? }
     POST /inmail/presend-check { to[], cc[], subject, body, classification, attachments, type, audience }
                              -> { model, ok, issues:[{severity,code,text,fix?:{field,value,label}}] } */
(function () {
  const { request, feedback, esc } = window.AIGateway;

  const INTERNAL = /@cicod\.com$/i;
  const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
  const STRIP = /^(remind|tell|inform) (all )?(staff|officers) (that |about |of )?/i;
  const splitNotes = n => n.split(/\n|;|•|(?:^|\s)-\s/).map(s => s.trim().replace(/\.$/, '')).filter(s => s.length > 2);

  // ---------- summaries ----------
  function lineFor(m) {
    const t = `${m.subject} ${m.body}`;
    const due = (t.match(/\b(by|before|on|due)\s+(\d{1,2}:\d{2}(?: today)?|(?:mon|tues|wednes|thurs|fri|satur|sun)day|\d{1,2}(?:st|nd|rd|th)? \w{3,9}|tomorrow|today|friday)/i) || [])[2];
    const action = /please|kindly|request|need|required|must|approve|submit|confirm|review|send/i.test(t);
    return { id: m.id, from: m.from, line: m.summary || m.snippet || m.subject, action, due: due ? cap(due) : null };
  }

  function mockSummarise({ scope, messages = [] }) {
    if (scope === 'unread') {
      // Group repeats (same sender + subject) and mark obvious test mail, so real asks stand out.
      const groups = [];
      messages.forEach(m => { const k = `${m.from}|${m.subject}`.toLowerCase(); const g = groups.find(x => x.k === k); if (g) { g.n++; } else groups.push({ k, m, n: 1 }); });
      const items = groups.map(({ m, n }) => {
        const it = lineFor(m);
        it.test = /^(re: )?(test|testing)\b/i.test(m.subject) && !it.due;
        if (it.test) { it.action = false; it.line = `Looks like a test message ("${m.subject}")`; }
        if (n > 1) it.line += ` · ${n} copies`;
        return it;
      }).sort((a, b) => (b.action - a.action) || (a.test - b.test) || (!!b.due - !!a.due));
      const actions = items.filter(i => i.action).length, tests = items.filter(i => i.test).length, dupes = messages.length - groups.length;
      return { model: 'cicod-summarise-v1 (sovereign)', tldr: `${messages.length} unread. ${actions ? `${actions} need${actions === 1 ? 's' : ''} something from you${items.find(i => i.due) ? `, the first by ${items.find(i => i.due).due}` : ''}.` : 'Nothing needs action.'}${tests ? ` ${tests} look like test mail` : ''}${dupes ? ` and ${dupes} are repeats` : ''}${tests || dupes ? '.' : ''}`, items };
    }
    const all = messages.map(m => m.body).join(' ');
    const people = [...new Set(messages.map(m => m.from))];
    const figures = [...new Set(all.match(/₦[\d,.]+\s?(?:m|bn|million|billion)?|\d{1,3}%/gi) || [])].slice(0, 4);
    const deadline = (all.match(/\b(?:by|before)\s+((?:mon|tues|wednes|thurs|fri)day(?:\s\d{1,2}\s\w+)?|\d{1,2}\s\w+)/i) || [])[1];
    const asks = messages.filter(m => /please|kindly|can you|could you|need|send/i.test(m.body)).map(m => {
      const s = m.body.split(/(?<=[.?!])\s+/).find(x => /please|kindly|can you|could you|need|send/i.test(x)) || m.body;
      return { who: m.from, what: s.replace(/^.*?\b(please|kindly)\s+/i, '').replace(/[.?]$/, ''), due: deadline || null };
    });
    return {
      model: 'cicod-summarise-v1 (sovereign)',
      tldr: `${people.length} people, ${messages.length} messages. ${messages[0] ? messages[0].body.split(/(?<=[.?!])\s/)[0] : ''} ${deadline ? `Inputs are due by ${deadline}.` : ''}`.trim(),
      points: [
        figures.length ? `Figures mentioned: ${figures.join(', ')}` : 'No figures mentioned',
        messages.length > 1 ? `Latest reply from ${messages[messages.length - 1].from}: "${messages[messages.length - 1].body.split(/(?<=[.?!])\s/)[0]}"` : 'Single message, no replies yet',
        `Participants: ${people.join(', ')}`,
      ],
      asks,
    };
  }

  // ---------- drafting ----------
  const DEPTS = ['Administration', 'Finance & Accounts', 'Human Resources', 'ICT', 'Procurement', 'Legal Services', 'Planning, Research & Statistics', 'Internal Audit'];
  function audienceFor(notes) {
    const n = notes.toLowerCase();
    let departments = [], grades = 'GL 01–17 (all staff)', why = 'The notes apply to every officer.';
    if (/aper|appraisal|all staff|every officer|resumption|working hours|downtime|maintenance/.test(n)) { departments = DEPTS.slice(); why = 'APER, working hours and system notices apply to every department.'; }
    if (/budget|expenditure|revenue|payment|retire/.test(n)) { departments = ['Finance & Accounts', 'Internal Audit', 'Planning, Research & Statistics']; why = 'Budget and payment notes are for the finance, audit and planning units.'; grades = 'GL 08 and above'; }
    if (/ict|system|password|email|CICOD Drive|laptop/.test(n) && !departments.length) { departments = DEPTS.slice(); why = 'System changes affect all users.'; }
    if (/procure|tender|bid|contract/.test(n)) { departments = ['Procurement', 'Legal Services', 'Finance & Accounts']; why = 'Procurement notes go to procurement, legal and finance.'; grades = 'GL 10 and above'; }
    if (/supervisor|countersign|head of|director/.test(n)) grades = /aper|appraisal/.test(n) ? 'GL 07–17 (appraisees), GL 12+ (countersigning officers)' : 'GL 12 and above (supervisors)';
    if (!departments.length) { departments = ['Administration']; why = 'No department named in the notes, so only your own department is suggested.'; }
    return { departments, grades, why };
  }

  const OPEN = {
    formal: 'I write to', concise: '', warm: 'I hope this message finds you well. I am writing to', minister: 'I respectfully write to',
  };
  function mockDraft({ type = 'Message', notes = '', tone = 'formal', to = '', current = '', sender = 'Prince Ekpenyong', mda = 'CICOD' }) {
    const pts = splitNotes(notes);
    const first = pts[0] || 'the matter below';
    const subjectBase = first.replace(/^(remind (all )?staff (that |about )?|tell|inform (all )?staff (that )?|ask|request)\s*/i, '');
    const subject = current || cap(subjectBase.length > 60 ? subjectBase.slice(0, 60).replace(/\s\S*$/, '') : subjectBase);
    const date = '27 September 2026';
    if (type === 'Circular') {
      const aud = audienceFor(notes);
      const body = [`CIRCULAR NO. GT/HR/C/2026/014`, `Date: ${date}`, '', `To: All Heads of Department (${aud.grades})`, '', `SUBJECT: ${subject.toUpperCase()}`, '',
        tone === 'minister' ? `By the directive of the Honourable Minister, I am to inform all officers as follows:` : `I am directed to inform all officers as follows:`,
        ...pts.map((p, i) => `${i + 1}. ${cap(p.replace(STRIP, ''))}.`), '',
        `${pts.length + 1}. Heads of Department are to bring the content of this circular to the attention of all officers under them.`, '',
        tone === 'warm' ? 'Thank you for your usual cooperation.' : 'Please ensure strict compliance.', '', sender, `For: Permanent Secretary, ${mda}`].join('\n');
      const summary = `What this means for you: ${pts.map(p => cap(p.replace(STRIP, ''))).join('. ')}.`;
      return { model: 'cicod-writer-v1 (sovereign) · MDA circular template', subject, body, audience: aud, summary };
    }
    const salutation = tone === 'minister' ? 'Honourable Minister,' : tone === 'concise' ? `Dear ${to ? to.split('@')[0].replace(/[._]/g, ' ') : 'Colleague'},` : 'Dear Sir/Madam,';
    const opener = OPEN[tone] ?? OPEN.formal;
    const lines = tone === 'concise'
      ? [salutation, '', ...pts.map(p => `• ${cap(p)}.`), '', 'Thanks,', sender]
      : [`Ref: GT/ADM/2026/0927/03`, `Date: ${date}`, '', salutation, '', `SUBJECT: ${subject.toUpperCase()}`, '',
        `${opener} ${first.charAt(0).toLowerCase() + first.slice(1)}.`, ...pts.slice(1).map(p => `${cap(p)}.`), '',
        tone === 'minister' ? 'Please accept, Honourable Minister, the assurances of my highest regards.' : tone === 'warm' ? 'Thank you for your support. I look forward to hearing from you.' : 'Please accept the assurances of my highest regards.', '',
        sender, `For: Permanent Secretary, ${mda}`];
    return { model: 'cicod-writer-v1 (sovereign) · MDA letter template', subject, body: lines.join('\n') };
  }

  // ---------- pre-send ----------
  function mockCheck({ to = [], cc = [], subject = '', body = '', classification = 'Restricted', attachments = 0, type = 'Message', audience = '' }) {
    const issues = [];
    const external = [...to, ...cc].filter(a => a && /@/.test(a) && !INTERNAL.test(a));
    const secret = classification === 'Secret' || /\bsecret\b|classified|security vote|not for circulation/i.test(body);
    if (secret && external.length) issues.push({ severity: 'high', code: 'secret-external', text: `Contains Secret content and an external recipient (${external.join(', ')}). Secret mail may only go to @cicod.com addresses.`, fix: { field: 'to', value: to.filter(a => INTERNAL.test(a)).join(', '), label: 'Remove external recipients' } });
    else if (external.length) issues.push({ severity: 'medium', code: 'external', text: `${external.length} recipient${external.length > 1 ? 's are' : ' is'} outside CICOD (${external.join(', ')}). Check before sending.` });
    if (secret && classification !== 'Secret') issues.push({ severity: 'medium', code: 'classification', text: `The body reads as Secret but the classification is ${classification}.`, fix: { field: 'classification', value: 'Secret', label: 'Set to Secret' } });
    if (/\battach(ed|ment)?\b/i.test(body) && !+attachments) issues.push({ severity: 'medium', code: 'no-attachment', text: 'The message mentions an attachment, but nothing is attached.' });
    if (!subject.trim()) issues.push({ severity: 'low', code: 'no-subject', text: 'Subject is empty.', fix: { field: 'subject', value: cap((body.split('\n').find(l => /^SUBJECT:/i.test(l)) || '').replace(/^SUBJECT:\s*/i, '').toLowerCase()) || cap(body.trim().split(/\s+/).slice(0, 7).join(' ').replace(/[.,;:]$/, '')) || 'Update', label: 'Use suggested subject' } });
    const pii = body.match(/\b\d{11}\b|\b0[789][01]\d{8}\b/);
    if (pii) issues.push({ severity: 'medium', code: 'pii', text: 'Contains what looks like a NIN or phone number. Remove it unless the recipient needs it.', fix: { field: 'body', value: body.replace(/\b\d{11}\b|\b0[789][01]\d{8}\b/g, '[redacted]'), label: 'Redact it' } });
    if (type === 'Circular' && !audience.trim()) issues.push({ severity: 'medium', code: 'no-audience', text: 'No audience selected for this circular.' });
    return { model: 'cicod-dlp-v1 (rules + classifier)', ok: !issues.length, issues };
  }

  const TONES = [['formal', 'Formal'], ['concise', 'Concise'], ['warm', 'Warm'], ['minister', 'For Hon. Minister']];
  const SEV = { high: 'g-chip--bad', medium: 'g-chip--warn', low: 'g-chip--info' };
  const skel = '<div class="ai-skeleton" style="width:85%"></div><div class="ai-skeleton" style="width:65%"></div><div class="ai-skeleton" style="width:75%"></div>';

  class AIMailAssist extends HTMLElement {
    connectedCallback() {
      this.mode = this.getAttribute('mode') || 'compose';
      if (this.mode === 'inbox') this.renderInbox();
      else if (this.mode === 'thread') this.renderThread();
      else this.renderCompose();
    }
    emit(name, detail) { this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true })); }
    rate(res, feature) {
      return `<div class="aima__rate"><span class="ai-confidence">${esc(res.model)}</span><button class="g-btn g-btn--sm" data-rate="helpful" type="button">Helpful</button><button class="g-btn g-btn--sm" data-rate="not-helpful" type="button">Not helpful</button></div>`;
    }
    wireRate(root, res, feature) {
      root.querySelectorAll('[data-rate]').forEach(b => b.addEventListener('click', () => { feedback(res.id, feature, b.dataset.rate); root.querySelectorAll('[data-rate]').forEach(x => { x.disabled = true; }); b.textContent += ' ✓'; }));
    }

    // ---------- inbox ----------
    renderInbox() {
      this.innerHTML = `<div class="aima aima--inline"><button class="g-btn g-btn--sm g-btn--ai" data-go type="button">✦ Summarise unread</button><div class="aima__pop" data-out hidden></div></div>`;
      this.querySelector('[data-go]').addEventListener('click', () => this.summariseUnread());
    }
    async summariseUnread() {
      const out = this.querySelector('[data-out]');
      out.hidden = false; out.innerHTML = skel;
      const src = document.querySelector(this.getAttribute('source'));
      const messages = src ? [...src.querySelectorAll('[data-msg][data-unread="true"]')].map(r => ({ id: r.dataset.id, from: r.dataset.from, subject: r.dataset.subject, body: r.dataset.snippet, summary: r.dataset.summary })) : [];
      const res = await request('/inmail/summarise', { scope: 'unread', messages }, { mock: mockSummarise, feature: 'inmail.summarise-unread' });
      out.innerHTML = `<div class="aima__pop-head"><b><span class="ai-badge">CICOD-AI</span> ${esc(res.tldr)}</b><button class="g-btn g-btn--sm g-btn--ghost" data-x type="button" aria-label="Close">✕</button></div>
        <ul class="aima__items">${res.items.map(i => `<li><div class="aima__i-main"><b>${esc(i.from)}</b>${i.action ? '<span class="g-chip g-chip--warn">Action</span>' : '<span class="g-chip">FYI</span>'}${i.due ? `<span class="g-chip g-chip--info">By ${esc(i.due)}</span>` : ''}<p>${esc(i.line)}</p></div><button class="g-btn g-btn--sm" data-open="${esc(i.id)}" type="button">Open</button></li>`).join('')}</ul>
        ${this.rate(res)}`;
      out.querySelector('[data-x]').addEventListener('click', () => { out.hidden = true; });
      out.querySelectorAll('[data-open]').forEach(b => b.addEventListener('click', () => { feedback(res.id, 'inmail.summarise-unread', 'opened', { msg: b.dataset.open }); this.emit('ai-mail-open', { id: b.dataset.open }); }));
      this.wireRate(out, res, 'inmail.summarise-unread');
    }

    // ---------- thread ----------
    renderThread() {
      this.innerHTML = `<div class="aima aima--inline"><button class="g-btn g-btn--sm g-btn--ai" data-go type="button">✦ Summarise</button></div><div class="aima__tl" data-out hidden></div>`;
      this.querySelector('[data-go]').addEventListener('click', () => this.summariseThread());
    }
    reset() { const o = this.querySelector('[data-out]'); if (o) { o.hidden = true; o.innerHTML = ''; } }
    async summariseThread() {
      const out = this.querySelector('[data-out]');
      out.hidden = false; out.innerHTML = skel;
      const src = document.querySelector(this.getAttribute('source'));
      const subject = src?.querySelector('[data-thread-subject]')?.textContent.trim() || '';
      const messages = src ? [...src.querySelectorAll('[data-thread-msg]')].map((m, i) => ({ id: String(i), from: m.dataset.from, date: m.dataset.date, body: m.querySelector('[data-body]')?.textContent.trim() || '' })) : [];
      const res = await request('/inmail/summarise', { scope: 'thread', subject, messages }, { mock: mockSummarise, feature: 'inmail.summarise-thread' });
      out.innerHTML = `<div class="aima__tl-head"><span class="ai-badge">TL;DR</span><button class="g-btn g-btn--sm g-btn--ghost" data-x type="button" aria-label="Close">✕</button></div>
        <p class="aima__tldr">${esc(res.tldr)}</p>
        <ul class="aima__points">${res.points.map(p => `<li>${esc(p)}</li>`).join('')}</ul>
        ${res.asks.length ? `<h5 class="aima__h">Asked of you</h5><ul class="aima__points">${res.asks.map(a => `<li><b>${esc(a.who)}:</b> ${esc(a.what)}${a.due ? ` <span class="g-chip g-chip--info">by ${esc(a.due)}</span>` : ''}</li>`).join('')}</ul>` : ''}
        <div class="aima__row"><button class="g-btn g-btn--sm" data-reply type="button">Draft a reply from this</button></div>
        ${this.rate(res)}`;
      out.querySelector('[data-x]').addEventListener('click', () => { out.hidden = true; });
      out.querySelector('[data-reply]').addEventListener('click', () => {
        feedback(res.id, 'inmail.summarise-thread', 'draft-reply');
        this.emit('ai-mail-reply', { subject: /^re:/i.test(subject) ? subject : `RE: ${subject}`, notes: res.asks.map(a => `confirm we will ${a.what.replace(/^(can|could) you\s+/i, '')}`).concat(['inputs from Administration will be ready by Thursday']).join('\n') });
      });
      this.wireRate(out, res, 'inmail.summarise-thread');
    }

    // ---------- compose ----------
    get form() { return document.querySelector(this.getAttribute('form')); }
    val(name) { return this.form?.querySelector(`[name="${name}"]`)?.value || ''; }

    renderCompose() {
      this.innerHTML = `<section class="aima aima--panel" aria-live="polite">
        <div class="aima__head"><span class="aima__title"><span class="ai-badge">CICOD-AI</span> Draft from notes</span><span class="aima__type" data-type></span></div>
        <div class="aima__body">
          <label class="g-label" for="aima-notes">Your notes (bullets are fine)</label>
          <textarea class="g-textarea" id="aima-notes" data-notes rows="4" placeholder="e.g. remind all staff APER forms due 31 Oct on PMS; supervisors countersign by 7 Nov; training 3 Oct 10am Prince Room"></textarea>
          <div class="aima__row"><label class="aima__tone"><span class="g-label">Tone</span><select class="g-select" data-tone>${TONES.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></label>
            <button class="g-btn g-btn--ai" data-draft type="button">Draft</button></div>
          <div data-out></div>
          <div data-check></div>
        </div></section>`;
      const syncType = () => { this.draftRes = null; this.querySelector('[data-out]').innerHTML = ''; this.querySelector('[data-check]').innerHTML = ''; this.querySelector('[data-type]').textContent = this.val('type') === 'Circular' ? 'Circular · MDA template' : 'Message · official letter'; };
      syncType();
      this.form?.querySelector('[name=type]')?.addEventListener('change', syncType);
      this.form?.addEventListener('ai-type-change', syncType);
      this.syncType = syncType;
      this.querySelector('[data-draft]').addEventListener('click', () => this.draft());
      this.querySelector('[data-tone]').addEventListener('change', () => { if (this.draftRes) this.draft(); });
      this.form?.querySelectorAll('[data-send]').forEach(b => b.addEventListener('click', e => { e.preventDefault(); this.check(); }));
    }

    setNotes(text) { this.querySelector('[data-notes]').value = text; this.syncType?.(); this.draft(); }

    async draft() {
      const notes = this.querySelector('[data-notes]').value.trim();
      const out = this.querySelector('[data-out]');
      if (notes.length < 8) { out.innerHTML = '<p class="aima__hint">Write a few words or bullet points first.</p>'; return; }
      out.innerHTML = skel;
      const payload = { type: this.val('type') || 'Message', notes, tone: this.querySelector('[data-tone]').value, to: this.val('to'), current: this.val('subject'), sender: this.getAttribute('sender') || 'Prince Ekpenyong', mda: this.getAttribute('mda') || 'CICOD' };
      const res = await request('/inmail/draft', payload, { mock: mockDraft, feature: 'inmail.draft' });
      this.draftRes = res;
      const aud = res.audience;
      out.innerHTML = `<div class="aima__draft">
          <div class="aima__d-sub"><span class="g-label">Subject</span><b>${esc(res.subject)}</b></div>
          <pre class="aima__d-body">${esc(res.body)}</pre>
          ${aud ? `<div class="aima__aud"><h5 class="aima__h">Suggested audience</h5>
            <div class="aima__chips">${aud.departments.map(d => `<label class="aima__chip"><input type="checkbox" data-dept value="${esc(d)}" checked> ${esc(d)}</label>`).join('')}</div>
            <p class="aima__hint"><b>Grade levels:</b> ${esc(aud.grades)}. ${esc(aud.why)}</p></div>
            <div class="aima__plain"><h5 class="aima__h">Plain-language summary</h5><p>${esc(res.summary)}</p></div>` : ''}
          <div class="aima__row"><button class="g-btn g-btn--sm g-btn--primary" data-insert type="button">Insert into ${aud ? 'circular' : 'message'}</button>
            <button class="g-btn g-btn--sm" data-regen type="button">Regenerate</button><button class="g-btn g-btn--sm" data-discard type="button">Discard</button>
            <span class="ai-confidence aima__model">${esc(res.model)}</span></div></div>`;
      out.querySelector('[data-insert]').addEventListener('click', () => {
        const audience = [...out.querySelectorAll('[data-dept]:checked')].map(c => c.value);
        feedback(res.id, 'inmail.draft', 'accepted', { tone: payload.tone, type: payload.type, audienceKept: audience.length });
        this.emit('ai-mail-insert', { subject: res.subject, body: res.body, audience, grades: aud?.grades || '', summary: res.summary || '' });
        out.innerHTML = '<p class="aima__ok">Draft inserted. Edit it as you like, then Send. The pre-send check runs automatically.</p>';
      });
      out.querySelector('[data-regen]').addEventListener('click', () => { feedback(res.id, 'inmail.draft', 'regenerated'); this.draft(); });
      out.querySelector('[data-discard]').addEventListener('click', () => { feedback(res.id, 'inmail.draft', 'rejected'); out.innerHTML = ''; });
    }

    async check() {
      const box = this.querySelector('[data-check]');
      box.innerHTML = `<h5 class="aima__h">Pre-send check</h5>${skel}`;
      const list = s => s.split(/[,;]\s*/).map(x => x.trim()).filter(Boolean);
      const payload = { to: list(this.val('to')), cc: list(this.val('cc')), subject: this.val('subject'), body: this.val('body'), classification: this.val('classification') || 'Restricted', attachments: +(this.form?.querySelector('[data-attachments]')?.dataset.attachments || 0), type: this.val('type'), audience: this.val('audience') };
      const res = await request('/inmail/presend-check', payload, { mock: mockCheck, feature: 'inmail.presend-check' });
      if (res.ok) {
        box.innerHTML = '<p class="aima__ok">Pre-send check passed. Sending…</p>';
        feedback(res.id, 'inmail.presend-check', 'passed');
        this.emit('ai-mail-send', { overridden: false, issues: [] });
        return;
      }
      box.innerHTML = `<div class="aima__check"><h5 class="aima__h">Pre-send check · ${res.issues.length} issue${res.issues.length > 1 ? 's' : ''}</h5>
        <ul class="aima__issues">${res.issues.map((i, n) => `<li><span class="g-chip ${SEV[i.severity]}">${esc(i.severity)}</span><span class="aima__issue-text">${esc(i.text)}</span>${i.fix ? `<button class="g-btn g-btn--sm" data-fix="${n}" type="button">${esc(i.fix.label)}</button>` : ''}</li>`).join('')}</ul>
        <div class="aima__row"><button class="g-btn g-btn--sm g-btn--primary" data-recheck type="button">Check again</button><button class="g-btn g-btn--sm" data-override type="button">Send anyway</button><span class="ai-confidence aima__model">${esc(res.model)}</span></div></div>`;
      box.querySelectorAll('[data-fix]').forEach(b => b.addEventListener('click', () => {
        const i = res.issues[+b.dataset.fix];
        feedback(res.id, 'inmail.presend-check', 'fixed', { code: i.code });
        this.emit('ai-mail-fix', i.fix);
        b.textContent = 'Fixed ✓'; b.disabled = true;
      }));
      box.querySelector('[data-recheck]').addEventListener('click', () => this.check());
      box.querySelector('[data-override]').addEventListener('click', () => {
        const high = res.issues.some(i => i.severity === 'high');
        feedback(res.id, 'inmail.presend-check', high ? 'override-blocked' : 'overridden', { codes: res.issues.map(i => i.code) });
        if (high) { box.querySelector('[data-override]').outerHTML = '<span class="g-chip g-chip--bad">Blocked: fix the high-severity issue first</span>'; return; }
        this.emit('ai-mail-send', { overridden: true, issues: res.issues.map(i => i.code) });
        box.innerHTML = '<p class="aima__ok">Sent with warnings. The override is recorded in the audit log.</p>';
      });
    }
  }

  customElements.define('ai-mail-assist', AIMailAssist);
})();
