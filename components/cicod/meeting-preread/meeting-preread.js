/* <ai-meeting-preread source="#schedule-form" lead-hours="24">
   When a meeting is being scheduled, CICOD-AI reads the title, agenda and attendees, searches
   Drive, ECMS, InMail and earlier meeting minutes for relevant recent context, and drafts a
   "Pre-Read Brief". The brief is sent by InMail before the meeting (24 hours by default).
   Each attendee only receives items they are allowed to open: restricted items are left out
   of their copy, and the organiser is told.
   Reads from inputs inside `source`: [name=title], [name=start] (datetime-local),
   [name=agenda] (one item per line), and checkboxes [name=attendee] (value = full name).
   Attributes:
     source      CSS selector of the Schedule Meeting form
     lead-hours  how long before the start the brief is sent (default 24)
   Events (the host page does the sending):
     ai-preread-schedule  detail: { sendAt, recipients[], subject, brief, sources[], perAttendee[] }
   Gateway:
     POST /conference/preread { title, start, agenda[], attendees[] }
       -> { model, sources:[{ id, app, name, why, classification, allowed[] | "all" }],
            brief:{ purpose, agenda[], background[{text, cite}], actions[{text, owner, due, status, cite}], decisions[] },
            perAttendee:[{ name, prepare[], hidden }], confidence } */
(function () {
  const { request, feedback, esc } = window.AIGateway;
  const FEATURE = 'conference.preread';

  // Prototype-only context library. In production this is the permission-trimmed unified index
  // (Drive, ECMS tasks and memos, InMail circulars, Conference minutes).
  const SECRET_BUDGET = ['Prince Ekpenyong', 'Favour Ifeanacho', 'Rebecca Saku'];
  const PROCUREMENT = ['Prince Ekpenyong', 'Adeola Adesina', 'Mercy Osoria'];
  const TOPICS = [
    {
      match: /budget|finance|capital|q3|q4|spend|release/i,
      sources: [
        { id: 'D-FMLD', app: 'Drive', name: 'Budget FMLD_1224_V 2.pdf', why: 'Latest budget performance file, uploaded 11 Sep 2026', classification: 'Secret (S)', allowed: SECRET_BUDGET },
        { id: 'M-2031', app: 'ECMS', name: 'Memo: Q3 capital release utilisation', why: 'Director of Finance memo, published 20 Sep 2026', classification: 'Official (O)', allowed: 'all' },
      ],
      background: [['Q3 capital release was ₦412m, of which 71% has been spent. The remaining 29% must be committed by 15 December.', 'M-2031'], ['The detailed budget performance by programme is in the budget file. It is classified Secret, so only authorised attendees receive it.', 'D-FMLD']],
      decisions: ['Agree which programmes receive the unspent 29% of the Q3 release'],
      prepare: { 'Favour Ifeanacho': 'Bring the programme-by-programme spend from the budget file', 'Rebecca Saku': 'Confirm which commitments can be raised before 15 December' },
    },
    {
      match: /complain|backlog|customer|service|queue|citizen/i,
      sources: [
        { id: 'Q-CMP', app: 'ECMS', name: 'Complaints queue: 2,248 open, 25 closed', why: 'Live figures from the Workflow Dashboard', classification: 'Official (O)', allowed: 'all' },
        { id: 'Q-ORD', app: 'ECMS', name: 'Order Fulfilment queue: 11,003 open, 2 closed', why: 'Top queue by open tasks', classification: 'Official (O)', allowed: 'all' },
      ],
      background: [['Complaints has 2,248 open tasks and only 25 closed. Order Fulfilment has 11,003 open and 2 closed. Together they hold most of the open work in ECMS.', 'Q-CMP'], ['Resource utilisation shows 0%, with 644 tasks assigned, so the backlog isn\'t being worked.', 'Q-ORD']],
      decisions: ['Approve the backlog plan: smart routing plus a weekly clearance target per unit'],
      prepare: { 'Ann Nya': 'Bring the number of complaints older than 30 days by unit', 'Eyitayo Abidogun': 'Confirm the IT capacity for the backlog clearance' },
    },
    {
      match: /procure|purchase|laptop|vendor|supplier|tender|asset/i,
      sources: [
        { id: 'PO-DRAFT', app: 'Assets', name: 'Draft PO: 20 × Lg Laptop, Holding Areas', why: 'Raised 28 Sep 2026. CICOD-AI recommended NCC (score 92)', classification: 'Official (O)', allowed: 'all' },
        { id: 'V-SAHEL', app: 'Assets', name: 'Supplier flag: Sahel Logistics split invoices', why: '3 invoices on 2 Sep, each just under the ₦500,000 approval limit', classification: 'Confidential (C)', allowed: PROCUREMENT },
      ],
      background: [['A purchase order for 20 laptops is drafted. The supplier scorer recommends NCC (92/100, on time on all 5 deliveries).', 'PO-DRAFT'], ['A split-invoice pattern was flagged for one supplier. Details go only to procurement attendees.', 'V-SAHEL']],
      decisions: ['Approve the laptop purchase order and the supplier', 'Decide whether to refer the split-invoice flag to internal audit'],
      prepare: { 'Adeola Adesina': 'Bring the supplier scores and the PO value against the approval limit', 'Mercy Osoria': 'Confirm Holding Areas can receive 20 laptops in October' },
    },
    {
      // "performance" on its own is too broad (e.g. "budget performance"), so only HR terms match.
      match: /\baper\b|apprais|\bpms\b|performance review|staff review|\bhr\b/i,
      sources: [
        { id: 'C-APER', app: 'InMail', name: 'Circular: 2026 APER exercise', why: 'HR circular. Forms are due on PMS by 31 October', classification: 'Official (O)', allowed: 'all' },
      ],
      background: [['The 2026 APER forms are due on PMS by 31 October. HR will brief all officers on 3 October at 10:00 in Prince Room.', 'C-APER']],
      decisions: ['Confirm every unit head has set departmental goals on PMS before the APER briefing'],
      prepare: { 'Ayomide Olusanya': 'Confirm the APER briefing invitation has gone out' },
    },
    {
      match: /\bai\b|cicod-ai|digiti|automat|ecms|workflow/i,
      sources: [
        { id: 'MIN-0922', app: 'Minutes', name: 'Minutes: CICOD-AI Implementation kick-off (22 Sep)', why: 'Previous meeting on this topic', classification: 'Official (O)', allowed: 'all' },
        { id: 'D-AIDOC', app: 'Drive', name: 'AI_Augmentation_Opportunities.md', why: 'Module-by-module AI plan', classification: 'Official (O)', allowed: 'all' },
      ],
      background: [['The kick-off agreed to start with ECMS: smart routing, task briefs and the memo copilot, in suggestion mode for 4 weeks.', 'MIN-0922'], ['The AI plan lists the Phase 1 components and the KPIs to baseline before the pilot.', 'D-AIDOC']],
      decisions: ['Pick the pilot department for Phase 1'],
      prepare: { 'Eyitayo Abidogun': 'Bring the AI Gateway hosting plan (sovereign model)' },
    },
  ];
  // Open action items from the last meeting with these attendees (from AI Minutes of Meeting).
  const CARRY = [
    { text: 'Send the APER briefing invitation for 3 Oct, 10:00, Prince Room', owner: 'Ayomide Olusanya', due: '2026-09-30', status: 'open', cite: 'MIN-0927' },
    { text: 'Replace the 2nd floor printer', owner: 'Eyitayo Abidogun', due: '2026-10-02', status: 'in progress', cite: 'Task #17572' },
    { text: 'Circulate the Q3 budget performance summary', owner: 'Favour Ifeanacho', due: '2026-09-25', status: 'open', cite: 'MIN-0927' },
  ];
  const MINUTES_SRC = { id: 'MIN-0927', app: 'Minutes', name: 'Minutes: Management meeting (27 Sep)', why: 'Last meeting with most of these attendees. 3 action items still open', classification: 'Official (O)', allowed: 'all' };

  const canOpen = (src, name) => src.allowed === 'all' || src.allowed.includes(name);
  const initials = n => n.split(/\s+/).map(p => p[0]).slice(0, 2).join('').toUpperCase();
  const fmtDT = d => d.toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

  function mockPreread({ title, agenda, attendees, start }) {
    const text = `${title} ${agenda.join(' ')}`;
    let topics = TOPICS.filter(t => t.match.test(text));
    if (!topics.length) topics = [TOPICS[1]];
    const sources = [MINUTES_SRC, ...topics.flatMap(t => t.sources)];
    const today = new Date().toISOString().slice(0, 10);
    const actions = CARRY.filter(a => attendees.includes(a.owner)).map(a => ({ ...a, overdue: a.status !== 'done' && a.due < today }));
    const brief = {
      purpose: `${title || 'This meeting'}: to review the latest position and agree the decisions listed below.`,
      agenda: agenda.length ? agenda : ['Review of action items from the last meeting', ...topics.map(t => t.decisions[0]), 'Any other business'],
      background: topics.flatMap(t => t.background.map(([txt, cite]) => ({ text: txt, cite }))),
      actions,
      decisions: topics.flatMap(t => t.decisions),
    };
    const perAttendee = attendees.map(name => {
      const prepare = topics.map(t => t.prepare[name]).filter(Boolean);
      actions.filter(a => a.owner === name).forEach(a => prepare.push(`Update on your action: "${a.text}" (due ${a.due}${a.overdue ? ', overdue' : ''})`));
      const hidden = sources.filter(s => !canOpen(s, name)).length;
      return { name, prepare: prepare.length ? prepare : ['Read the background section. Nothing specific to prepare.'], hidden };
    });
    return { model: 'cicod-conference-preread-v1 (hybrid search + LLM)', sources, brief, perAttendee, confidence: 0.82, start };
  }

  class AIMeetingPreread extends HTMLElement {
    connectedCallback() {
      this.form = document.querySelector(this.getAttribute('source'));
      this.lead = parseFloat(this.getAttribute('lead-hours') || '24');
      this.tab = 'brief';
      this.innerHTML = `<section class="aipr" aria-live="polite">
        <div class="aipr__head"><span class="aipr__title"><span class="ai-badge">CICOD-AI</span> Pre-read brief</span><span class="ai-confidence" data-model></span></div>
        <div class="aipr__body" data-body><p class="aipr__empty">Add a title, an agenda and attendees. CICOD-AI will gather the context from Drive, ECMS, InMail and earlier minutes, and draft a brief to send ${this.lead} hours before the meeting.</p></div>
        <div class="aipr__actions" data-actions><button class="g-btn g-btn--ai g-btn--sm" data-run type="button">✦ Prepare pre-read</button><span class="aipr__mode">Organiser reviews before sending</span></div>
      </section>`;
      this.querySelector('[data-run]').addEventListener('click', () => this.run());
    }

    read() {
      const f = this.form;
      const v = n => f?.querySelector(`[name=${n}]`)?.value || '';
      return {
        title: v('title'),
        start: v('start'),
        agenda: v('agenda').split('\n').map(s => s.trim()).filter(Boolean),
        attendees: [...(f?.querySelectorAll('[name=attendee]:checked') || [])].map(c => c.value),
      };
    }

    async run() {
      this.scheduled = null;
      this.editedHtml = null;
      const body = this.querySelector('[data-body]');
      body.innerHTML = '<div class="ai-skeleton" style="width:75%"></div><div class="ai-skeleton" style="width:90%"></div><div class="ai-skeleton" style="width:60%"></div><div class="ai-skeleton" style="width:82%"></div>';
      const payload = this.read();
      const res = await request('/conference/preread', payload, { mock: mockPreread, feature: FEATURE });
      this.res = res;
      this.included = new Set(res.sources.map(s => s.id));
      this.payload = payload;
      this.render();
    }

    sendAt() {
      const start = this.payload.start ? new Date(this.payload.start) : null;
      if (!start || isNaN(start)) return { label: 'as soon as the meeting is saved', date: null };
      const at = new Date(start.getTime() - this.lead * 3600000);
      if (at < new Date()) return { label: `now (the meeting is less than ${this.lead} hours away)`, date: new Date() };
      return { label: fmtDT(at), date: at };
    }

    render() {
      const { res, payload } = this;
      this.querySelector('[data-model]').textContent = res.model;
      const b = res.brief;
      const cite = id => (this.included.has(id) || id.startsWith('Task') ? `<span class="aipr__cite">[${esc(id)}]</span>` : '');
      const bg = b.background.filter(x => this.included.has(x.cite));
      const briefHtml = `
        <div class="aipr__brief" data-brief>
          <h4 contenteditable="true">Pre-read: ${esc(payload.title || 'Meeting')}</h4>
          <div class="aipr__brief-meta">${payload.start ? esc(fmtDT(new Date(payload.start))) : 'Date to be set'} · ${payload.attendees.length} attendee(s) · prepared by CICOD-AI, reviewed by the organiser</div>
          <h6>Purpose</h6><p contenteditable="true" style="margin:0">${esc(b.purpose)}</p>
          <h6>Agenda</h6><ol contenteditable="true">${b.agenda.map(a => `<li>${esc(a)}</li>`).join('')}</ol>
          <h6>Background</h6><ul contenteditable="true">${bg.map(x => `<li>${esc(x.text)} ${cite(x.cite)}</li>`).join('') || '<li>No background sources selected.</li>'}</ul>
          ${b.actions.length ? `<h6>Open action items from the last meeting</h6><ul>${b.actions.map(a => `<li>${esc(a.text)}: <b>${esc(a.owner)}</b>, due ${esc(a.due)} ${a.overdue ? '<span class="aipr__overdue">(overdue)</span>' : `(${esc(a.status)})`} ${cite(a.cite)}</li>`).join('')}</ul>` : ''}
          <h6>Decisions needed</h6><ul contenteditable="true">${b.decisions.map(d => `<li>${esc(d)}</li>`).join('')}</ul>
          <h6>Attached</h6><ul>${res.sources.filter(s => this.included.has(s.id)).map(s => `<li>${esc(s.name)} <span class="aipr__cite">[${esc(s.id)}]</span>${s.allowed !== 'all' ? ` · ${esc(s.classification)}, only for ${s.allowed.filter(n => payload.attendees.includes(n)).length} attendee(s)` : ''}</li>`).join('')}</ul>
        </div>`;

      const srcHtml = res.sources.map(s => {
        const blocked = s.allowed === 'all' ? [] : payload.attendees.filter(n => !s.allowed.includes(n));
        return `<label class="aipr__src"><input type="checkbox" data-src="${esc(s.id)}" ${this.included.has(s.id) ? 'checked' : ''}>
          <span class="aipr__src-app">${esc(s.app)}</span>
          <span class="aipr__src-name">${esc(s.name)} <span class="aipr__cite">[${esc(s.id)}]</span><span class="aipr__src-why">${esc(s.why)} · ${esc(s.classification)}</span>
          ${blocked.length ? `<span class="aipr__src-lock">🔒 Left out for ${blocked.length} attendee(s) who can't open it: ${esc(blocked.join(', '))}</span>` : ''}</span></label>`;
      }).join('');

      const peopleHtml = res.perAttendee.map(p => {
        const hidden = res.sources.filter(s => this.included.has(s.id) && !canOpen(s, p.name)).length;
        return `<div class="aipr__person"><span class="aipr__avatar">${esc(initials(p.name))}</span><div><b>${esc(p.name)}</b>
          ${p.prepare.map(x => `<span>• ${esc(x)}</span><br>`).join('')}${hidden ? `<span class="aipr__hidden">${hidden} restricted item(s) left out of this attendee's copy</span>` : ''}</div></div>`;
      }).join('');

      const send = this.sendAt();
      this.querySelector('[data-body]').innerHTML = `
        <div class="aipr__tabs" role="tablist">
          ${[['brief', 'Brief'], ['sources', `Sources (${this.included.size}/${res.sources.length})`], ['people', 'Per attendee']].map(([k, l]) => `<button class="aipr__tab" role="tab" aria-selected="${this.tab === k}" data-tab="${k}" type="button">${l}</button>`).join('')}
        </div>
        <div class="aipr__pane" data-pane="brief" ${this.tab === 'brief' ? '' : 'hidden'}>${this.editedHtml || briefHtml}</div>
        <div class="aipr__pane" data-pane="sources" ${this.tab === 'sources' ? '' : 'hidden'}><h5 class="aipr__h5">Found in Drive, ECMS, InMail and minutes. Untick to leave out.</h5>${srcHtml}</div>
        <div class="aipr__pane" data-pane="people" ${this.tab === 'people' ? '' : 'hidden'}><h5 class="aipr__h5">What each attendee should prepare</h5>${peopleHtml}</div>
        <div class="aipr__send"><div><b>Send by InMail</b>${esc(send.label)}</div><div><b>To</b>${payload.attendees.length} attendee(s), each copy trimmed to what they may open</div></div>
        ${this.scheduled ? `<div class="aipr__done">✓ Pre-read scheduled for ${esc(send.label)} to ${payload.attendees.length} attendees. You can edit it until then in Invites History.</div>` : ''}`;

      this.querySelector('[data-actions]').innerHTML = `
        <button class="g-btn g-btn--primary g-btn--sm" data-schedule type="button" ${this.scheduled || !payload.attendees.length ? 'disabled' : ''}>${this.scheduled ? 'Scheduled ✓' : 'Schedule pre-read'}</button>
        <button class="g-btn g-btn--sm" data-run type="button">✦ Regenerate</button>
        <span class="aipr__mode">Organiser reviews before sending</span>`;

      this.querySelectorAll('[data-tab]').forEach(t => t.addEventListener('click', () => { this.saveEdits(); this.tab = t.dataset.tab; this.render(); }));
      this.querySelectorAll('[data-src]').forEach(c => c.addEventListener('change', () => {
        c.checked ? this.included.add(c.dataset.src) : this.included.delete(c.dataset.src);
        this.editedHtml = null; // the brief is rebuilt from the new set of sources
        feedback(res.id, FEATURE, c.checked ? 'source-included' : 'source-excluded', { source: c.dataset.src });
        this.render();
      }));
      this.querySelector('[data-run]').addEventListener('click', () => this.run());
      this.querySelector('[data-schedule]').addEventListener('click', () => this.schedule());
    }

    saveEdits() {
      // Keep the organiser's edits when switching tabs.
      const el = this.querySelector('[data-brief]');
      if (el) this.editedHtml = el.outerHTML;
    }

    schedule() {
      this.saveEdits();
      const { res, payload } = this;
      const send = this.sendAt();
      const brief = this.querySelector('[data-brief]')?.innerText || '';
      const detail = {
        sendAt: send.date ? send.date.toISOString() : null,
        recipients: payload.attendees,
        subject: `Pre-read: ${payload.title || 'Meeting'}`,
        brief,
        sources: res.sources.filter(s => this.included.has(s.id)).map(s => ({ id: s.id, name: s.name, allowed: s.allowed })),
        perAttendee: res.perAttendee.map(p => ({ name: p.name, prepare: p.prepare, withheld: res.sources.filter(s => this.included.has(s.id) && !canOpen(s, p.name)).map(s => s.id) })),
      };
      this.scheduled = detail;
      feedback(res.id, FEATURE, 'scheduled', { recipients: payload.attendees.length, sources: this.included.size });
      this.dispatchEvent(new CustomEvent('ai-preread-schedule', { detail, bubbles: true }));
      this.render();
    }
  }

  customElements.define('ai-meeting-preread', AIMeetingPreread);
})();
