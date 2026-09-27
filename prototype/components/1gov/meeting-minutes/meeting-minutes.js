/* <ai-meeting-minutes recording="rec-0927" meeting-title="Management meeting" room="Prince Room" date="27 Sep 2026"
                       duration="42 min" attendees="Prince Ekpenyong|Rebecca Saku|…" drive-path="General Documents/MINUTES_OF_MEETINGS">
   Turns a Conference recording into minutes, decisions, action items and a searchable transcript.
   The host sets the attributes when a recording is selected; setting `recording` (last) loads it.
   Nothing is saved or created until the user clicks "Save minutes to Drive" or "Create ECMS tasks".
   Attributes:
     recording   recording id (changing it reloads)
     meeting-title, room, date, duration   shown in the header and the minutes
     attendees   pipe-separated attendance list from Conference → Attendance (assignee choices)
     drive-path  folder the minutes are saved to (default General Documents/MINUTES_OF_MEETINGS)
   Events (bubbles):
     ai-minutes-result  detail: full response
     ai-minutes-save    detail: { path, fileName, text }            host saves the file to Drive
     ai-minutes-tasks   detail: { tasks:[{title,assignee,due,queue,source}] }  host creates ECMS tasks
     ai-minutes-seek    detail: { t }                               host seeks the player to t (seconds)
   Gateway: POST /conference/minutes
     { recordingId, title, room, date, attendees[] }
     -> { model, quality, speakers, summary, agenda:[{item,notes}], decisions:[{text,t}],
          actions:[{title,owner,due,queue,t,confidence}], transcript:[{t,speaker,text}] }
   (C5 recording search runs locally over the returned transcript; in production it calls
    POST /conference/search { recordingId, query } -> { hits:[{t,speaker,text,score}] }) */
(function () {
  const { request, feedback, esc } = window.AIGateway;

  const QUEUES = ['Correspondence', 'IT Support', 'Complaints', 'CICOD-AI IMPLEMENTATION', 'Order Fulfilment', 'Product development'];
  const fmt = t => `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;

  const DATA = {
    'rec-0927': {
      summary: 'The management meeting reviewed Q3 budget performance (71% of the ₦412m capital release spent), agreed a plan to clear the Complaints backlog, set the APER briefing for 3 October, and approved the replacement of the 2nd floor printer.',
      agenda: [
        { item: 'Q3 budget performance', notes: 'Rebecca Saku reported ₦412m released and 71% spent. ICT is at 84%. The 29% unspent balance is mostly the data centre UPS awaiting delivery.' },
        { item: 'Complaints backlog', notes: '7 open Complaints tasks, one on its third follow-up (#17569). Customer service will call each complainant within 48 hours.' },
        { item: '2026 APER exercise', notes: 'Forms are due on CICOD PMS by 31 October. HR will brief all officers on 3 October at 10:00 in Prince Room.' },
        { item: 'Any other business', notes: 'The 2nd floor printer (GT-IT-0112) is faulty again. ICT recommends replacement over repair.' },
      ],
      decisions: [
        { text: 'Administration to submit its Q3 capital spend and a variance note to Finance by Friday 2 October.', t: 402 },
        { text: 'All 7 open complaints to be contacted within 48 hours. The third follow-up (#17569) is escalated to the Director.', t: 1015 },
        { text: 'APER briefing holds on 3 October at 10:00 in Prince Room.', t: 1620 },
        { text: 'Replace printer GT-IT-0112 from Central Store stock instead of repairing it.', t: 2290 },
      ],
      actions: [
        { title: 'Submit Administration Q3 capital spend and variance note to Finance', owner: 'Prince Ekpenyong', due: '2026-10-02', queue: 'Correspondence', t: 402, confidence: 0.94 },
        { title: 'Call all 7 open complainants and log the outcome in ECMS', owner: 'Ann Nya', due: '2026-09-29', queue: 'Complaints', t: 1015, confidence: 0.91 },
        { title: 'Escalate complaint #17569 (third follow-up) to the Director', owner: 'Faith Egbe', due: '2026-09-28', queue: 'Complaints', t: 1068, confidence: 0.86 },
        { title: 'Send APER briefing invitation for 3 Oct, 10:00, Prince Room', owner: 'Ayomide Olusanya', due: '2026-09-30', queue: 'Correspondence', t: 1620, confidence: 0.9 },
        { title: 'Issue replacement printer for 2nd floor from Central Store', owner: 'Eyitayo Abidogun', due: '2026-10-01', queue: 'IT Support', t: 2290, confidence: 0.88 },
      ],
      transcript: [
        [15, 'Prince Ekpenyong', 'Good afternoon everyone. We have four items today: the Q3 budget, the complaints backlog, APER, and any other business.'],
        [128, 'Rebecca Saku', 'Q3 capital releases came to 412 million naira. We have spent 71 percent so far.'],
        [190, 'Chinwuba Okafor', 'ICT has spent 38 million of its 45 million release. The balance is for the data centre UPS.'],
        [265, 'Rebecca Saku', 'The 29 percent unspent is mostly the UPS. Delivery is expected in October.'],
        [402, 'Prince Ekpenyong', 'Administration will send its Q3 capital spend and a variance note to Finance by Friday. I will handle that.'],
        [610, 'Ayo Toriola', 'On the budget, the expense requests for the Kaduna workshop are already inside the recurrent line.'],
        [880, 'Ann Nya', 'Complaints has seven open tasks. One citizen has written three times about an order that was not delivered.'],
        [1015, 'Prince Ekpenyong', 'Ann, please call all seven complainants within 48 hours and log each outcome in ECMS.'],
        [1068, 'Faith Egbe', 'I will escalate the third follow-up, number 17569, to the Director today.'],
        [1440, 'Ayomide Olusanya', 'APER forms are due on CICOD PMS by the 31st of October.'],
        [1620, 'Prince Ekpenyong', 'Let us hold the APER briefing on the 3rd of October at 10 in Prince Room. Ayomide, please send the invitation.'],
        [2105, 'Eyitayo Abidogun', 'The 2nd floor printer is faulty again. Repair would cost more than a replacement from Central Store.'],
        [2290, 'Prince Ekpenyong', 'Then we replace it. Eyitayo, please issue one from Central Store this week.'],
        [2480, 'Rebecca Saku', 'I will share the final budget report on CICOD Drive after the meeting.'],
        [2515, 'Prince Ekpenyong', 'Thank you all. The meeting is adjourned.'],
      ],
    },
    'rec-0922': {
      summary: 'The CICOD-AI Implementation kick-off agreed to start with ECMS smart routing and the request finder, collect process documentation from each department through the CICOD-AI IMPLEMENTATION form, and review progress in two weeks.',
      agenda: [
        { item: 'Scope of phase 1', notes: 'Smart routing for ECMS tasks, the request finder, and InMail drafting.' },
        { item: 'Process gathering', notes: 'Each department submits its most frequent process through the CICOD-AI IMPLEMENTATION form.' },
      ],
      decisions: [
        { text: 'Phase 1 covers ECMS smart routing, the request finder and InMail drafting.', t: 540 },
        { text: 'Departments submit process documentation by 6 October.', t: 1210 },
      ],
      actions: [
        { title: 'Share the CICOD-AI IMPLEMENTATION form link with all Heads of Department', owner: 'Chinwuba Okafor', due: '2026-09-25', queue: 'CICOD-AI IMPLEMENTATION', t: 1210, confidence: 0.92 },
        { title: 'Export 12 months of ECMS task history for routing training', owner: 'Eyitayo Abidogun', due: '2026-09-30', queue: 'IT Support', t: 1502, confidence: 0.87 },
        { title: 'Book the two-week progress review in Prince Room', owner: 'Ayomide Olusanya', due: '2026-09-24', queue: 'Correspondence', t: 1980, confidence: 0.83 },
      ],
      transcript: [
        [20, 'Chinwuba Okafor', 'Welcome to the CICOD-AI Implementation kick-off.'],
        [540, 'Prince Ekpenyong', 'Phase 1 should be smart routing, the request finder and InMail drafting.'],
        [1210, 'Chinwuba Okafor', 'I will share the CICOD-AI IMPLEMENTATION form so every department sends its process documentation by the 6th of October.'],
        [1502, 'Eyitayo Abidogun', 'I can export twelve months of ECMS task history for the routing model.'],
        [1980, 'Ayomide Olusanya', 'I will book the progress review for two weeks from today.'],
      ],
    },
  };

  function generic({ title = 'Meeting', attendees = [] }) {
    const a = attendees.length ? attendees : ['Prince Ekpenyong', 'Ann Nya'];
    const topic = title.replace(/meeting|stand-up|review/gi, '').trim() || title;
    return {
      summary: `The ${title.toLowerCase()} discussed ${topic.toLowerCase()} progress, agreed next steps and set a follow-up date.`,
      agenda: [{ item: `${topic}: status`, notes: `${a[1] || a[0]} gave an update on ${topic.toLowerCase()}.` }, { item: 'Next steps', notes: 'Owners and dates were agreed for the open items.' }],
      decisions: [{ text: `Continue the ${topic.toLowerCase()} plan and review again in two weeks.`, t: 610 }],
      actions: a.slice(0, 3).map((p, i) => ({ title: [`Circulate the ${topic.toLowerCase()} update to all attendees`, `Prepare figures for the next ${topic.toLowerCase()} review`, 'Book the follow-up meeting'][i], owner: p, due: `2026-10-0${i + 2}`, queue: 'Correspondence', t: 600 + i * 300, confidence: 0.78 - i * 0.04 })),
      transcript: [[10, a[0], `Let's start the ${title.toLowerCase()}.`], [300, a[1] || a[0], `Here is the latest on ${topic.toLowerCase()}.`], [610, a[0], 'We continue with the plan and review in two weeks.'], [900, a[2] || a[0], 'I will book the follow-up meeting.']],
    };
  }

  function mockMinutes(p) {
    const d = DATA[p.recordingId] || generic(p);
    return {
      model: 'cicod-asr-v2 + cicod-minutes-v1 (sovereign)',
      quality: DATA[p.recordingId] ? 0.94 : 0.81,
      speakers: new Set(d.transcript.map(x => x[1])).size,
      ...d,
      transcript: d.transcript.map(([t, speaker, text]) => ({ t, speaker, text })),
    };
  }

  const SYN = { budget: 'budget|naira|million|spend|spent|release|capital|₦', printer: 'printer|toner|central store', complaint: 'complain|complainant|follow-up|citizen', aper: 'aper|appraisal|pms|briefing' };
  function searchRe(q) {
    const words = q.toLowerCase().split(/\s+/).filter(w => w.length > 2 && !/^(the|where|did|what|when|who|talk|talked|about|said|say|and|was)$/.test(w));
    if (!words.length) return null;
    const parts = words.map(w => { const k = Object.keys(SYN).find(s => w.startsWith(s) || s.startsWith(w)); return k ? SYN[k] : w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); });
    return new RegExp(`(${parts.join('|')})`, 'gi');
  }

  const TABS = [['minutes', 'Minutes'], ['decisions', 'Decisions'], ['actions', 'Action items'], ['transcript', 'Transcript']];

  class AIMeetingMinutes extends HTMLElement {
    static get observedAttributes() { return ['recording']; }
    connectedCallback() { this.tab = 'minutes'; this.renderEmpty(); if (this.getAttribute('recording')) this.load(); }
    attributeChangedCallback(n, o, v) { if (this.isConnected && v && o !== v) this.load(); }

    get attendees() { return (this.getAttribute('attendees') || '').split('|').filter(Boolean); }

    renderEmpty() {
      this.innerHTML = `<section class="aimm"><div class="aimm__head"><span class="aimm__title"><span class="ai-badge">CICOD-AI</span> Minutes of meeting</span></div>
        <div class="aimm__body"><p class="aimm__empty">Select a recording and click <b>CICOD-AI minutes</b>. You'll get the minutes, decisions, action items and a searchable transcript.</p></div></section>`;
    }

    async load() {
      const id = this.getAttribute('recording');
      this.tab = 'minutes';
      this.innerHTML = `<section class="aimm" aria-live="polite"><div class="aimm__head"><span class="aimm__title"><span class="ai-badge">CICOD-AI</span> ${esc(this.getAttribute('meeting-title') || 'Recording')}</span><span class="aimm__meta">Transcribing and summarising…</span></div>
        <div class="aimm__body"><div class="ai-skeleton" style="width:90%"></div><div class="ai-skeleton" style="width:70%"></div><div class="ai-skeleton" style="width:80%"></div><div class="ai-skeleton" style="width:60%"></div></div></section>`;
      const seq = (this.seq = (this.seq || 0) + 1);
      const res = await request('/conference/minutes', { recordingId: id, title: this.getAttribute('meeting-title'), room: this.getAttribute('room'), date: this.getAttribute('date'), attendees: this.attendees }, { mock: mockMinutes, feature: 'conference.minutes', delay: 1100 });
      if (seq !== this.seq) return;
      this.res = res;
      this.render();
      this.dispatchEvent(new CustomEvent('ai-minutes-result', { detail: res, bubbles: true }));
    }

    minutesText() {
      const r = this.res;
      return [`MINUTES OF THE ${String(this.getAttribute('meeting-title') || '').toUpperCase()}`, `${this.getAttribute('room')} · ${this.getAttribute('date')} · ${this.getAttribute('duration')}`, '',
        `Present: ${this.attendees.join(', ')}`, '', `Summary: ${r.summary}`, '',
        ...r.agenda.flatMap((a, i) => [`${i + 1}. ${a.item}`, `   ${a.notes}`]), '', 'Decisions:', ...r.decisions.map((d, i) => `   ${i + 1}. ${d.text}`), '',
        'Action items:', ...r.actions.map(a => `   • ${a.title} (${a.owner}, by ${a.due})`)].join('\n');
    }

    render() {
      const r = this.res;
      this.innerHTML = `<section class="aimm" aria-live="polite">
        <div class="aimm__head"><span class="aimm__title"><span class="ai-badge">CICOD-AI</span> ${esc(this.getAttribute('meeting-title'))}</span>
          <span class="aimm__meta">${esc(this.getAttribute('room'))} · ${esc(this.getAttribute('date'))} · ${esc(this.getAttribute('duration'))} · <span class="ai-confidence">transcript quality ${Math.round(r.quality * 100)}% · ${r.speakers} speakers · ${esc(r.model)}</span></span></div>
        <div class="aimm__tabs" role="tablist">${TABS.map(([k, l]) => `<button class="aimm__tab" role="tab" data-tab="${k}" aria-selected="${k === this.tab}" type="button">${l}${k === 'actions' ? ` <span class="aimm__count">${r.actions.length}</span>` : k === 'decisions' ? ` <span class="aimm__count">${r.decisions.length}</span>` : ''}</button>`).join('')}</div>
        <div class="aimm__body" data-pane></div>
        <div class="aimm__actions">
          <button class="g-btn g-btn--primary g-btn--sm" data-save type="button">Save minutes to Drive → ${esc(this.getAttribute('drive-path') || 'General Documents/MINUTES_OF_MEETINGS')}</button>
          <button class="g-btn g-btn--ai g-btn--sm" data-tasks type="button">Create ECMS tasks (${r.actions.length})</button>
          <button class="g-btn g-btn--sm" data-regen type="button">Regenerate</button>
          <button class="g-btn g-btn--sm" data-bad type="button">Not accurate</button>
        </div></section>`;
      this.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => { this.tab = b.dataset.tab; this.querySelectorAll('[data-tab]').forEach(x => x.setAttribute('aria-selected', String(x === b))); this.renderPane(); }));
      this.querySelector('[data-save]').addEventListener('click', e => this.save(e.target));
      this.querySelector('[data-tasks]').addEventListener('click', e => this.createTasks(e.target));
      this.querySelector('[data-regen]').addEventListener('click', () => { feedback(r.id, 'conference.minutes', 'regenerated'); this.load(); });
      this.querySelector('[data-bad]').addEventListener('click', e => { feedback(r.id, 'conference.minutes', 'rejected'); e.target.textContent = 'Thanks, flagged for review'; e.target.disabled = true; });
      this.renderPane();
    }

    renderPane() {
      const r = this.res, pane = this.querySelector('[data-pane]');
      const ts = t => `<button class="aimm__ts" data-seek="${t}" type="button">${fmt(t)}</button>`;
      if (this.tab === 'minutes') {
        pane.innerHTML = `<p class="aimm__summary">${esc(r.summary)}</p>
          <p class="aimm__present"><b>Present:</b> ${this.attendees.map(esc).join(', ')}</p>
          <ol class="aimm__agenda">${r.agenda.map(a => `<li><b>${esc(a.item)}</b><p>${esc(a.notes)}</p></li>`).join('')}</ol>
          <details class="aimm__edit"><summary>Edit before saving</summary><textarea class="g-textarea" data-text rows="10">${esc(this.edited || this.minutesText())}</textarea></details>`;
        pane.querySelector('[data-text]').addEventListener('input', e => { this.edited = e.target.value; });
      } else if (this.tab === 'decisions') {
        pane.innerHTML = `<ol class="aimm__list">${r.decisions.map(d => `<li>${ts(d.t)}<span>${esc(d.text)}</span></li>`).join('')}</ol>`;
      } else if (this.tab === 'actions') {
        const opts = (list, sel) => list.map(x => `<option ${x === sel ? 'selected' : ''}>${esc(x)}</option>`).join('');
        const people = [...new Set([...this.attendees, ...r.actions.map(a => a.owner)])];
        pane.innerHTML = `<p class="aimm__hint">Assignees come from the attendance list. Untick anything that shouldn't become a task.</p>
          <div class="aimm__acts">${r.actions.map((a, i) => `<div class="aimm__act" data-act="${i}">
            <label class="aimm__chk"><input type="checkbox" data-on checked aria-label="Include"></label>
            <div class="aimm__act-main"><input class="g-input" data-title value="${esc(a.title)}" aria-label="Task title">
              <div class="aimm__act-row"><select class="g-select" data-owner aria-label="Assignee">${opts(people, a.owner)}</select>
                <select class="g-select" data-queue aria-label="Queue">${opts(QUEUES, a.queue)}</select>
                <input class="g-input" type="date" data-due value="${esc(a.due)}" aria-label="Due date"></div>
              <small>Said at ${ts(a.t)} · <span class="ai-confidence">${Math.round(a.confidence * 100)}%</span></small></div></div>`).join('')}</div>`;
      } else {
        pane.innerHTML = `<div class="aimm__search"><input class="g-input" data-q placeholder='Search the recording, e.g. "where did we talk about the budget?"' aria-label="Search transcript"></div>
          <p class="aimm__hint" data-hits></p><ol class="aimm__tx" data-tx></ol>`;
        const q = pane.querySelector('[data-q]');
        q.value = this.query || '';
        q.addEventListener('input', () => { this.query = q.value; this.drawTranscript(); });
        this.drawTranscript();
      }
      pane.querySelectorAll('[data-seek]').forEach(b => b.addEventListener('click', () => this.seek(+b.dataset.seek)));
    }

    drawTranscript() {
      const re = this.query ? searchRe(this.query) : null;
      const lines = this.res.transcript.filter(l => !re || (re.lastIndex = 0, re.test(`${l.speaker} ${l.text}`)));
      const mark = s => { const e = esc(s); return re ? e.replace(re, '<mark>$1</mark>') : e; };
      this.querySelector('[data-hits]').textContent = re ? `${lines.length} moment${lines.length === 1 ? '' : 's'} match "${this.query}". Click a time to jump there.` : `${this.res.transcript.length} segments · click a time to jump there.`;
      const tx = this.querySelector('[data-tx]');
      tx.innerHTML = lines.map(l => `<li><button class="aimm__ts" data-seek="${l.t}" type="button">${fmt(l.t)}</button><div><b>${esc(l.speaker)}</b> ${mark(l.text)}</div></li>`).join('') || '<li class="aimm__empty">No matches.</li>';
      tx.querySelectorAll('[data-seek]').forEach(b => b.addEventListener('click', () => this.seek(+b.dataset.seek)));
    }

    seek(t) {
      if (this.query) feedback(this.res.id, 'conference.recording-search', 'jumped', { t });
      this.dispatchEvent(new CustomEvent('ai-minutes-seek', { detail: { t }, bubbles: true }));
    }

    save(btn) {
      const path = this.getAttribute('drive-path') || 'General Documents/MINUTES_OF_MEETINGS';
      const fileName = `${this.getAttribute('meeting-title')} ${this.getAttribute('date')}.docx`;
      feedback(this.res.id, 'conference.minutes', this.edited ? 'saved-edited' : 'saved');
      this.dispatchEvent(new CustomEvent('ai-minutes-save', { detail: { path, fileName, text: this.edited || this.minutesText() }, bubbles: true }));
      btn.textContent = `Saved to ${path} ✓`; btn.disabled = true;
    }

    createTasks(btn) {
      let tasks;
      if (this.tab === 'actions') {
        tasks = [...this.querySelectorAll('[data-act]')].filter(r => r.querySelector('[data-on]').checked).map(r => {
          const a = this.res.actions[+r.dataset.act];
          return { title: r.querySelector('[data-title]').value, assignee: r.querySelector('[data-owner]').value, queue: r.querySelector('[data-queue]').value, due: r.querySelector('[data-due]').value, source: `${this.getAttribute('meeting-title')} @ ${fmt(a.t)}` };
        });
      } else {
        tasks = this.res.actions.map(a => ({ title: a.title, assignee: a.owner, queue: a.queue, due: a.due, source: `${this.getAttribute('meeting-title')} @ ${fmt(a.t)}` }));
      }
      if (!tasks.length) return;
      const edited = this.tab === 'actions' && tasks.some((t, i) => this.res.actions[i] && t.title !== this.res.actions[i].title);
      feedback(this.res.id, 'conference.action-items', edited ? 'accepted-edited' : 'accepted', { count: tasks.length, of: this.res.actions.length });
      this.dispatchEvent(new CustomEvent('ai-minutes-tasks', { detail: { tasks }, bubbles: true }));
      btn.textContent = `${tasks.length} ECMS task${tasks.length > 1 ? 's' : ''} created ✓`; btn.disabled = true;
    }
  }

  customElements.define('ai-meeting-minutes', AIMeetingMinutes);
})();
