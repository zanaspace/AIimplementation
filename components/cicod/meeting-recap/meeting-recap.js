/* <ai-meeting-recap meeting="mgmt" viewer="Prince Ekpenyong">
   An on-demand recap of the earlier meetings in a series, opened from the ✦ Recap button on a
   meeting (in Rooms, in Invites History, or in the side drawer during the meeting):
     1. "Since last time": a short summary of the most recent meeting in the series.
     2. Action items across the series, with their live ECMS task status (not what the minutes said),
        how many meetings each has appeared in, and a flag for items carried forward without closing.
     3. A decisions log, and a warning when a decision already made is being discussed again.
     4. "My items" for the viewer.
   The series comes from the meeting's repeat setting, or else from past meetings with a similar
   title, the same room and mostly the same attendees. The viewer can include or exclude meetings.
   Only minutes the viewer may see are used, and restricted items are left out.
   Attributes (both observed, so the host can switch them):
     meeting   id of the meeting whose series to recap
     viewer    full name of the person viewing (from the session in production)
   Events (the host page acts on them):
     ai-recap-task    detail: { text, owner, due, meeting }       create an ECMS task for an untracked item
     ai-recap-agenda  detail: { text, owner }                     add a carried-forward item to the next agenda
   Gateway:
     POST /conference/recap { meetingId, viewer, include[] }
       -> { model, series:{ name, detectedBy, recurrence }, occurrences:[{ id, date, title, minutes, match, confidence, included, access }],
            sinceLast:{ date, text }, items:[{ text, owner, raised, mentions, task:{id,status}|null, due, carried, overdue }],
            decisions:[{ date, text }], relitigated[], hidden, confidence } */
(function () {
  const { request, feedback, esc } = window.AIGateway;
  const FEATURE = 'conference.recap';

  // Prototype-only series data. In production occurrences come from Conference, minutes from
  // AI Minutes of Meeting, and task status live from ECMS.
  const ALL = ['Prince Ekpenyong', 'Favour Ifeanacho', 'Rebecca Saku', 'Adeola Adesina', 'Ayomide Olusanya', 'Ann Nya', 'Eyitayo Abidogun'];
  const without = (...n) => ALL.filter(a => !n.includes(a));
  const SERIES = {
    mgmt: {
      name: 'Weekly Management Meeting', room: 'Prince Room', recurrence: 'Weekly', detectedBy: 'repeat setting',
      occurrences: [
        { id: 'o1', date: '2026-09-06', title: 'Weekly Management Meeting', minutes: true, match: 'recurrence', confidence: 1, attendees: without('Eyitayo Abidogun') },
        { id: 'o2', date: '2026-09-13', title: 'Weekly Management Meeting', minutes: true, match: 'recurrence', confidence: 1, attendees: ALL },
        { id: 'x1', date: '2026-09-15', title: 'Management meeting with vendors', minutes: true, match: 'similar title, different room (Board Room)', confidence: 0.46, attendees: ['Prince Ekpenyong', 'Adeola Adesina'], optional: true },
        { id: 'o3', date: '2026-09-20', title: 'Weekly Management Meeting', minutes: false, match: 'recurrence', confidence: 1, attendees: ALL },
        { id: 'o4', date: '2026-09-27', title: 'Weekly Management Meeting', minutes: true, match: 'recurrence', confidence: 1, attendees: ALL },
      ],
      items: [
        { text: 'Circulate the Q3 budget performance summary', owner: 'Favour Ifeanacho', raised: 'o1', seen: ['o1', 'o2', 'o4'], task: null, due: '2026-09-25' },
        { text: 'Replace the 2nd floor printer', owner: 'Eyitayo Abidogun', raised: 'o2', seen: ['o2', 'o4'], task: { id: '#17572', status: 'In progress' }, due: '2026-10-02' },
        { text: 'Service the GEN-01 generator before month end', owner: 'Adeola Adesina', raised: 'o2', seen: ['o2', 'o4'], task: { id: '#17601', status: 'Open' }, due: '2026-09-30' },
        { text: 'Clear complaints older than 30 days', owner: 'Ann Nya', raised: 'o1', seen: ['o1', 'o2'], task: { id: '#17480', status: 'Closed' }, due: '2026-09-26' },
        { text: 'Send the APER briefing invitation for 3 Oct, 10:00, Prince Room', owner: 'Ayomide Olusanya', raised: 'o4', seen: ['o4'], task: { id: '#17603', status: 'Open' }, due: '2026-09-30' },
        { text: 'Complete the disciplinary review for the Stores case', owner: 'Rebecca Saku', raised: 'o2', seen: ['o2', 'o4'], task: null, due: '2026-10-09', allowed: ['Prince Ekpenyong', 'Rebecca Saku'] },
        { text: 'Request revised quotes from NCC and Abuja Tech Hub', owner: 'Adeola Adesina', raised: 'x1', seen: ['x1'], task: null, due: '2026-09-22' },
      ],
      decisions: [
        { occ: 'o1', text: 'Approved the purchase of 20 laptops for ICT, subject to budget', topic: 'laptops' },
        { occ: 'o1', text: 'Complaints older than 30 days to be cleared before the next quarter' },
        { occ: 'o2', text: 'Printer replacement approved (₦450,000, IT Support)' },
        { occ: 'o2', text: 'Stores disciplinary case referred to HR', allowed: ['Prince Ekpenyong', 'Rebecca Saku'] },
        { occ: 'x1', text: 'Shortlisted NCC and Abuja Tech Hub for IT supplies' },
        { occ: 'o4', text: 'APER briefing fixed for 3 Oct, 10:00, Prince Room' },
        { occ: 'o4', text: 'Laptop purchase: agreed to proceed with NCC', topic: 'laptops' },
      ],
      since: {
        o4: 'The 27 Sep meeting reviewed Q3 budget performance (71% of the ₦412m release spent), set the APER briefing for 3 October, and agreed to buy the laptops from NCC. That purchase was already approved on 6 Sep. The printer and generator items are still open from 13 Sep.',
        o2: 'The 13 Sep meeting approved the printer replacement, referred a Stores matter to HR and reviewed progress on the complaints backlog.',
        o1: 'The 6 Sep meeting approved 20 laptops for ICT and set a target to clear complaints older than 30 days.',
      },
    },
    standup: {
      name: 'Complaints backlog stand-up', room: 'Prince Room', recurrence: null, detectedBy: 'similar title, same room and 3 of 3 attendees (no repeat setting)',
      occurrences: [
        { id: 's1', date: '2026-09-04', title: 'Complaints backlog stand-up', minutes: true, match: 'title + attendees', confidence: 0.88, attendees: ALL },
        { id: 's2', date: '2026-09-11', title: 'Complaints stand-up', minutes: true, match: 'title + attendees', confidence: 0.81, attendees: ALL },
        { id: 's3', date: '2026-09-18', title: 'Complaints backlog stand-up', minutes: true, match: 'title + attendees', confidence: 0.9, attendees: ALL },
      ],
      items: [
        { text: 'Route new complaints through the Smart Routing pilot', owner: 'Ann Nya', raised: 's1', seen: ['s1', 's2', 's3'], task: { id: '#17590', status: 'In progress' }, due: '2026-09-30' },
        { text: 'Call back citizens waiting more than 10 days', owner: 'Rebecca Saku', raised: 's2', seen: ['s2', 's3'], task: { id: '#17512', status: 'Closed' }, due: '2026-09-17' },
        { text: 'Publish a payment-gateway status notice on the portal', owner: 'Eyitayo Abidogun', raised: 's3', seen: ['s3'], task: null, due: '2026-09-21' },
      ],
      decisions: [
        { occ: 's1', text: 'Weekly clearance target of 150 complaints per unit' },
        { occ: 's3', text: 'Payment-gateway complaints go straight to IT Support' },
      ],
      since: { s3: 'The 18 Sep stand-up noted payment-gateway complaints rising and sent them straight to IT Support. The call-back exercise was completed.' },
    },
    proc: {
      name: 'Procurement committee', room: 'Board Room', recurrence: null, detectedBy: 'no earlier meetings found',
      occurrences: [{ id: 'p1', date: '2026-09-11', title: 'Procurement committee', minutes: true, match: 'this meeting', confidence: 1, attendees: ALL }],
      items: [{ text: 'Check the Sahel Logistics invoices against the approval limit', owner: 'Adeola Adesina', raised: 'p1', seen: ['p1'], task: null, due: '2026-09-25' }],
      decisions: [{ occ: 'p1', text: 'Laptop PO to go to open quotation' }],
      since: { p1: 'The procurement committee sent the laptop PO to open quotation and asked for a check of one supplier\'s invoices.' },
    },
  };

  const fmt = iso => new Date(iso + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  const allowedFor = (x, viewer) => !x.allowed || x.allowed.includes(viewer);

  function mockRecap({ meetingId, viewer, include }) {
    const s = SERIES[meetingId];
    const today = new Date().toISOString().slice(0, 10);
    const occurrences = s.occurrences.map(o => {
      const access = o.attendees.includes(viewer);
      const included = access && o.minutes && (include ? include.includes(o.id) : !o.optional);
      return { id: o.id, date: o.date, title: o.title, minutes: o.minutes, match: o.match, confidence: o.confidence, optional: !!o.optional, access, included };
    });
    const on = new Set(occurrences.filter(o => o.included).map(o => o.id));
    let hidden = 0;
    const items = s.items.filter(i => on.has(i.raised)).filter(i => { if (allowedFor(i, viewer)) return true; hidden++; return false; }).map(i => {
      const mentions = i.seen.filter(id => on.has(id));
      const status = i.task ? i.task.status : 'Not tracked';
      const closed = status === 'Closed';
      return { text: i.text, owner: i.owner, raised: s.occurrences.find(o => o.id === i.raised).date, mentions: mentions.map(id => s.occurrences.find(o => o.id === id).date), task: i.task, status, due: i.due, carried: mentions.length >= 2 && !closed, overdue: !closed && i.due < today };
    }).sort((a, b) => (b.carried - a.carried) || (b.overdue - a.overdue) || (a.status === 'Closed') - (b.status === 'Closed'));
    const decisions = s.decisions.filter(d => on.has(d.occ)).filter(d => { if (allowedFor(d, viewer)) return true; hidden++; return false; })
      .map(d => ({ date: s.occurrences.find(o => o.id === d.occ).date, text: d.text, topic: d.topic }));
    const byTopic = {};
    decisions.filter(d => d.topic).forEach(d => { (byTopic[d.topic] = byTopic[d.topic] || []).push(d); });
    const relitigated = Object.values(byTopic).filter(list => list.length > 1).map(list => `The ${fmt(list[0].date)} meeting already decided: "${list[0].text}". It came back on ${list.slice(1).map(d => fmt(d.date)).join(', ')}. Confirm it's settled so it isn't discussed again.`);
    const last = [...occurrences].reverse().find(o => o.included);
    const skipped = occurrences.filter(o => !o.minutes).map(o => fmt(o.date));
    return {
      model: 'cicod-conference-recap-v1 (minutes retrieval + live ECMS status + LLM)',
      series: { name: s.name, room: s.room, recurrence: s.recurrence, detectedBy: s.detectedBy },
      occurrences,
      sinceLast: last ? { date: last.date, text: s.since[last.id] || '' } : null,
      noMinutes: skipped,
      items, decisions, relitigated, hidden,
      confidence: s.recurrence ? 0.9 : 0.78,
    };
  }

  class AIMeetingRecap extends HTMLElement {
    static get observedAttributes() { return ['meeting', 'viewer']; }
    connectedCallback() { this.tab = 'recap'; this.connected = true; this.load(); }
    attributeChangedCallback(name, oldV, newV) {
      if (!this.connected || oldV === newV) return;
      if (name === 'meeting') { this.include = null; this.tab = 'recap'; }
      this.load();
    }

    async load() {
      this.done = this.done || new Set();
      this.innerHTML = `<section class="aimr" aria-live="polite"><div class="aimr__head"><span class="aimr__title"><span class="ai-badge">CICOD-AI</span> Meeting recap</span></div>
        <div class="aimr__body"><div class="ai-skeleton" style="width:70%"></div><div class="ai-skeleton" style="width:90%"></div><div class="ai-skeleton" style="width:60%"></div></div></section>`;
      const payload = { meetingId: this.getAttribute('meeting') || 'mgmt', viewer: this.getAttribute('viewer') || '', include: this.include || null };
      this.res = await request('/conference/recap', payload, { mock: mockRecap, feature: FEATURE, delay: this.res ? 400 : undefined });
      this.render();
    }

    render() {
      const r = this.res;
      const viewer = this.getAttribute('viewer') || '';
      const included = r.occurrences.filter(o => o.included);
      const carried = r.items.filter(i => i.carried).length;
      const open = r.items.filter(i => i.status !== 'Closed').length;
      const mine = r.items.filter(i => i.owner === viewer);
      const statusChip = i => `<span class="g-chip ${i.status === 'Closed' ? 'g-chip--ok' : i.status === 'Not tracked' ? 'g-chip--warn' : 'g-chip--info'}">${i.task ? `${esc(i.task.id)} · ` : ''}${esc(i.status)}</span>`;
      const itemHtml = i => {
        const key = i.text;
        return `<div class="aimr__item ${i.carried ? 'aimr__item--carried' : ''}">
          <div class="aimr__item-top"><span class="aimr__item-text">${esc(i.text)}</span>
            <span class="aimr__chips">${statusChip(i)}${i.carried ? `<span class="g-chip g-chip--bad">Carried ×${i.mentions.length}</span>` : ''}${i.overdue ? '<span class="g-chip g-chip--bad">Overdue</span>' : ''}</span></div>
          <div class="aimr__item-meta"><b>${esc(i.owner)}</b> · raised ${esc(fmt(i.raised))} · due ${esc(fmt(i.due))}</div>
          <div class="aimr__trail" aria-label="Meetings where this came up">${included.map(o => `<span class="aimr__dot ${i.mentions.includes(o.date) ? 'aimr__dot--on' : ''}">${esc(fmt(o.date))}</span>`).join('')}</div>
          ${i.status !== 'Closed' ? `<div class="aimr__item-actions">${this.done.has('agenda:' + key) ? '<span class="aimr__done">On next agenda ✓</span>' : `<button class="g-btn g-btn--sm" data-agenda="${esc(key)}" type="button">Add to next agenda</button>`}
            ${!i.task ? (this.done.has('task:' + key) ? '<span class="aimr__done">ECMS task created ✓</span>' : `<button class="g-btn g-btn--ai g-btn--sm" data-task="${esc(key)}" type="button">Create ECMS task</button>`) : ''}</div>` : ''}
        </div>`;
      };

      const recap = `
        <div class="aimr__stats">
          <div class="aimr__stat"><b>${included.length}</b><span>Meetings recapped</span></div>
          <div class="aimr__stat"><b>${open}</b><span>Open action items</span></div>
          <div class="aimr__stat ${carried ? 'aimr__stat--bad' : 'aimr__stat--ok'}"><b>${carried}</b><span>Carried forward</span></div>
          <div class="aimr__stat"><b>${r.decisions.length}</b><span>Decisions</span></div>
        </div>
        ${r.sinceLast ? `<h5 class="aimr__h5">Since last time (${esc(fmt(r.sinceLast.date))})</h5><p class="aimr__since">${esc(r.sinceLast.text)} <span class="aimr__cite">[Minutes ${esc(fmt(r.sinceLast.date))}]</span></p>` : '<p class="aimr__empty">No minutes available for this series yet.</p>'}
        ${r.noMinutes.length ? `<p class="aimr__empty" style="margin-top:8px">No minutes were recorded for ${esc(r.noMinutes.join(', '))}, so ${r.noMinutes.length === 1 ? 'that meeting is' : 'those meetings are'} not in the recap.</p>` : ''}
        ${r.relitigated.map(t => `<div class="aimr__relit">⚠ ${esc(t)}</div>`).join('')}
        ${carried ? `<h5 class="aimr__h5">Carried forward without closing</h5>${r.items.filter(i => i.carried).map(itemHtml).join('')}` : ''}
        <h5 class="aimr__h5">My items (${esc(viewer)})</h5>${mine.length ? mine.map(itemHtml).join('') : '<p class="aimr__empty">You have no action items in this series.</p>'}`;

      const items = r.items.length ? r.items.map(itemHtml).join('') : '<p class="aimr__empty">No action items in the selected meetings.</p>';
      const decisions = r.decisions.length ? r.decisions.map(d => `<div class="aimr__dec"><time>${esc(fmt(d.date))}</time><span>${esc(d.text)}</span></div>`).join('') + r.relitigated.map(t => `<div class="aimr__relit">⚠ ${esc(t)}</div>`).join('') : '<p class="aimr__empty">No decisions recorded.</p>';
      const series = r.occurrences.map(o => `<label class="aimr__occ"><input type="checkbox" data-occ="${esc(o.id)}" ${o.included ? 'checked' : ''} ${!o.access || !o.minutes ? 'disabled' : ''}>
          <span><b>${esc(o.title)}</b> · ${esc(fmt(o.date))}<small>${!o.minutes ? 'No minutes recorded' : !o.access ? 'You weren\'t invited, and its minutes aren\'t shared with you' : `Matched by ${esc(o.match)}`}</small></span>
          <span class="ai-confidence">${o.optional ? `possible match ${Math.round(o.confidence * 100)}%` : `${Math.round(o.confidence * 100)}%`}</span></label>`).join('');

      const tabs = [['recap', 'Recap'], ['items', `Action items (${r.items.length})`], ['decisions', 'Decisions'], ['series', `Meetings (${included.length}/${r.occurrences.length})`]];
      this.innerHTML = `<section class="aimr" aria-live="polite">
        <div class="aimr__head"><span class="aimr__title"><span class="ai-badge">CICOD-AI</span> Recap: ${esc(r.series.name)}
          <span class="aimr__series">${r.series.recurrence ? `${esc(r.series.recurrence)} · ` : ''}${esc(r.series.room)} · series found by ${esc(r.series.detectedBy)}</span></span>
          <span class="ai-confidence">confidence ${Math.round(r.confidence * 100)}%</span></div>
        <div class="aimr__body">
          <div class="aimr__tabs" role="tablist">${tabs.map(([k, l]) => `<button class="aimr__tab" role="tab" aria-selected="${this.tab === k}" data-tab="${k}" type="button">${l}</button>`).join('')}</div>
          <div class="aimr__pane" ${this.tab === 'recap' ? '' : 'hidden'}>${recap}</div>
          <div class="aimr__pane" ${this.tab === 'items' ? '' : 'hidden'}><h5 class="aimr__h5">All action items, with live ECMS status</h5>${items}</div>
          <div class="aimr__pane" ${this.tab === 'decisions' ? '' : 'hidden'}><h5 class="aimr__h5">Decisions log</h5>${decisions}</div>
          <div class="aimr__pane" ${this.tab === 'series' ? '' : 'hidden'}><h5 class="aimr__h5">Meetings in this series. Untick one to leave it out</h5>${series}</div>
          ${r.hidden ? `<p class="aimr__hidden">🔒 ${r.hidden} restricted item(s) from these minutes are not shown to you.</p>` : ''}
        </div>
        <div class="aimr__actions"><button class="g-btn g-btn--sm" data-refresh type="button">✦ Refresh</button><span class="ai-confidence">${esc(r.model)}</span><span class="aimr__mode">Every point links to its minutes</span></div>
      </section>`;

      this.querySelectorAll('[data-tab]').forEach(t => t.addEventListener('click', () => { this.tab = t.dataset.tab; this.render(); }));
      this.querySelector('[data-refresh]').addEventListener('click', () => this.load());
      this.querySelectorAll('[data-occ]').forEach(c => c.addEventListener('change', () => {
        this.include = [...this.querySelectorAll('[data-occ]:checked')].map(x => x.dataset.occ);
        feedback(r.id, FEATURE, c.checked ? 'occurrence-included' : 'occurrence-excluded', { occurrence: c.dataset.occ });
        this.load();
      }));
      this.querySelectorAll('[data-agenda]').forEach(b => b.addEventListener('click', () => {
        const i = r.items.find(x => x.text === b.dataset.agenda);
        this.done.add('agenda:' + i.text);
        feedback(r.id, FEATURE, 'added-to-agenda');
        this.dispatchEvent(new CustomEvent('ai-recap-agenda', { detail: { text: i.text, owner: i.owner }, bubbles: true }));
        this.render();
      }));
      this.querySelectorAll('[data-task]').forEach(b => b.addEventListener('click', () => {
        const i = r.items.find(x => x.text === b.dataset.task);
        this.done.add('task:' + i.text);
        feedback(r.id, FEATURE, 'task-created');
        this.dispatchEvent(new CustomEvent('ai-recap-task', { detail: { text: i.text, owner: i.owner, due: i.due, meeting: r.series.name }, bubbles: true }));
        this.render();
      }));
    }
  }

  customElements.define('ai-meeting-recap', AIMeetingRecap);
})();
