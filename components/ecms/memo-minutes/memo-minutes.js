/* <ai-minute-summary source="#minutes" subject="…" ref="CICOD/WKS/MEM/2026/118">
   Reads the minute chain on a memo and gives a senior officer the file at a glance:
   current status, decisions, open queries and who is holding the file (E-M3). It also pulls
   out the action items ("pls treat", "for your action by Friday", "within 48 hours"), each with
   an assignee and due date, and a "Create ECMS task" button (E-M4).
   The component never changes the file. The host creates the tasks.
   Attributes:
     source   CSS selector of the minute list. Each minute is an element with [data-minute],
              data-by (role), data-name, data-to (role) and data-date (dd/mm/yyyy); its text is the minute
     subject  memo subject, used in task titles
     ref      memo Ref No, attached to every task
   Events (bubbles):
     ai-minute-create-task  detail: { title, assignee, due, queue, queueType, ref, fromMinute }
     ai-minute-summary      detail: summary payload
   Gateway: POST /ecms/memo/summarise-minutes
     { ref, subject, minutes:[{by,to,date,text}] }
     -> { model, confidence, status, holder:{role,since,days}, decisions[], queries[{text,by,to,date,open}], amounts[],
          actions:[{title,assignee,due,dueSource,fromMinute,done,doneNote}] } */
(function () {
  const { request, feedback, esc } = window.AIGateway;

  const DAY = 864e5;
  const parseDate = s => { const [d, m, y] = String(s).split(/[/\s]/); return new Date(+y, +m - 1, +d); };
  const fmt = d => `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
  const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const addWorkingDays = (d, n) => { const x = new Date(d); while (n > 0) { x.setDate(x.getDate() + 1); if (x.getDay() % 6) n--; } return x; };
  const short = role => role.replace(/^Director, Finance & Accounts$/, 'DFA').replace(/^Permanent Secretary$/, 'Perm Sec').replace(/^Director, /, 'Dir. ').replace(/^Head, /, 'Head ');

  // Common executive shorthand → role names used in the minute headers
  const ALIAS = [[/\bDFA\b/i, 'Director, Finance & Accounts'], [/\bPerm(anent)? Sec(retary)?\b|\bPS\b/i, 'Permanent Secretary'], [/\bDir(ector)?\.? ?GS\b|\bDirector,? General Services\b/i, 'Director, General Services'],
    [/\bHead,? Procurement\b|\bHOP\b/i, 'Head, Procurement'], [/\bHead,? Works\b|\bHOD Works\b/i, 'Head, Works & Maintenance'], [/\bDHRM\b|\bDirector,? HR\b/i, 'Director, Human Resource Management']];
  const roleIn = s => { const a = ALIAS.find(([re]) => re.test(s)); return a ? a[1] : null; };

  const ACTION = /\b(pls|please|kindly)\s+(treat|submit|confirm|provide|issue|ensure|clarify|forward|prepare|arrange|advise)|\bfor (your )?(action|necessary action|urgent attention)\b|\bto ensure\b|\bwithin \d+\s*(hours|hrs|days)\b|\bby (monday|tuesday|wednesday|thursday|friday|\d{1,2}\/\d{1,2})\b|^\s*(issue|submit|prepare|forward|arrange)\b/i;
  const QUERY = /\?|\bclarify\b|\bquer(y|ied)\b|\bexplain\b|\bjustify\b|\bappears (high|low|excessive)\b|\bdifference\b/i;
  const DECISION = /\b(approved|not approved|recommended for approval|declined|rejected|kiv|keep in view)\b[^.]*/i;

  function dueFor(sentence, base) {
    let m = sentence.match(/\bwithin (\d+)\s*(hours|hrs|days)\b/i);
    if (m) { const days = /day/i.test(m[2]) ? +m[1] : Math.ceil(+m[1] / 24); return { due: new Date(base.getTime() + days * DAY), src: `"within ${m[1]} ${m[2]}"` }; }
    m = sentence.match(/\bby (monday|tuesday|wednesday|thursday|friday)\b/i);
    if (m) { const want = WEEKDAYS.indexOf(m[1].toLowerCase()); const d = new Date(base); do { d.setDate(d.getDate() + 1); } while (d.getDay() !== want); return { due: d, src: `"by ${m[1]}"` }; }
    m = sentence.match(/\bby (\d{1,2})\/(\d{1,2})\b/);
    if (m) return { due: new Date(base.getFullYear(), +m[2] - 1, +m[1]), src: `"by ${m[1]}/${m[2]}"` };
    if (/rainy season|end of (the )?month/i.test(sentence)) { const d = new Date(base.getFullYear(), base.getMonth() + 1, 0); return { due: d, src: 'end of month (inferred)' }; }
    return { due: addWorkingDays(base, 3), src: 'no date given · 3 working days suggested' };
  }

  function cleanTitle(s, subject) {
    let t = s.replace(/^[A-Z][\w .,&]*?:\s*/, '').replace(/\b(pls|please|kindly)\s+/gi, '').replace(/\bfor (your )?(action|necessary action|urgent attention)( by \w+)?\b[.,]?/gi, '').replace(/\s+/g, ' ').trim();
    if (/^treat\.?$/i.test(t) || !t) t = `Treat memo: ${subject}`;
    t = t.replace(/^[a-z]/, c => c.toUpperCase()).replace(/[.\s]+$/, '');
    return t.length > 110 ? t.slice(0, 107) + '…' : t;
  }

  const INFO_REQ = /\b(treat|confirm|clarify|provide|advise|explain|justify)\b/i;
  const DONE_WORDS = /\b(completed|issued|raised|done|submitted|attached|delivered|paid|signed|confirmed|available)\b/i;
  const lowerFirst = s => s ? s[0].toLowerCase() + s.slice(1) : s;

  function mockSummarise({ minutes = [], subject = 'this memo' }) {
    const now = new Date();
    const actions = []; const queries = []; const decisions = []; const amounts = [];
    minutes.forEach((mn, i) => {
      const base = parseDate(mn.date);
      (mn.text.match(/₦\s?\d[\d,.]*\d(\s*(m|k|million))?/gi) || []).forEach(a => {
        const value = a.trim();
        if (!amounts.some(x => x.value === value)) amounts.push({ value, by: mn.by, date: mn.date, compare: /compared with|paid for/i.test(mn.text.split(value)[0].slice(-40)) });
      });
      const d = mn.text.match(DECISION);
      if (d) decisions.push({ role: mn.by, text: `${short(mn.by)}: ${d[0].trim().replace(/\.$/, '')}`, raw: d[0].trim().replace(/\.$/, ''), date: mn.date });
      const sentences = mn.text.split(/(?<=[.!?])\s+/).filter(Boolean);
      if (QUERY.test(mn.text) && !d) {
        const answered = minutes.slice(i + 1).find(x => x.to === mn.by) || minutes.slice(i + 1).find(x => x.by === mn.to);
        queries.push({ text: `${short(mn.by)} queried: ${sentences.find(s => QUERY.test(s)) || sentences[0]}`, date: mn.date, open: !answered, answer: answered ? `${short(answered.by)} replied ${answered.date}` : '' });
      }
      for (let s = 0; s < sentences.length; s++) {
        let text = sentences[s];
        if (!ACTION.test(text)) continue;
        // "Head Procurement: for your action by Friday." + "Issue the LPO…" → one action
        if (/^Treat memo:/.test(cleanTitle(text, subject)) && sentences[s + 1] && !/pls treat|please treat/i.test(text)) { text = text + ' ' + sentences[++s]; }
        const assignee = (/^([A-Z][\w .,&]*?):/.test(text) && roleIn(text.split(':')[0])) || (/\b(\w[\w ,&]*?) to ensure\b/i.test(text) && roleIn(text.match(/\b(\w[\w ,&]*?) to ensure\b/i)[1])) || mn.to;
        const { due, src } = dueFor(text, base);
        const title = cleanTitle(text.replace(/^[^:]{2,40}:\s*for (your )?(action|necessary action)( by \w+)?\.?\s*/i, ''), subject);
        const replies = minutes.slice(i + 1).filter(x => x.by === assignee);
        const isInfo = INFO_REQ.test(text) && !/\b(issue|ensure|submit)\b/i.test(text);
        const completes = x => DONE_WORDS.test(x.text.replace(/\b(can|to|will|should|must|may) be \w+/gi, ''));
        const doneBy = isInfo ? (minutes.slice(i + 1).find(x => x.to === mn.by) || replies[0]) : replies.find(completes);
        const state = doneBy ? 'done' : replies.length ? 'progress' : 'open';
        actions.push({ title, assignee, due: iso(due), dueLabel: fmt(due), dueSource: src, overdue: state !== 'done' && due < now, fromMinute: `${short(mn.by)}, ${mn.date}`,
          done: state === 'done', state, doneNote: doneBy ? `${short(doneBy.by)} minuted on ${doneBy.date}` : replies.length ? `${short(assignee)} minuted ${replies[replies.length - 1].date} but it is not complete` : '' });
      }
    });
    const last = minutes[minutes.length - 1] || { to: 'Registry', date: fmt(now), by: '' };
    const since = parseDate(last.date);
    const days = Math.max(0, Math.round((now - since) / DAY));
    const openActs = actions.filter(a => !a.done);
    const openQs = queries.filter(q => q.open);
    const lastDec = decisions[decisions.length - 1];
    const waiting = [...openActs].reverse().find(a => a.assignee === last.to) || openActs[openActs.length - 1];
    const status = (lastDec ? `${lastDec.role} ${lowerFirst(lastDec.raw)} on ${lastDec.date}. ` : 'No decision recorded yet. ') +
      (waiting ? `The file is waiting on ${waiting.assignee} to ${lowerFirst(waiting.title.replace(/^Treat memo:.*/, 'treat the memo'))}${waiting.overdue ? ` (overdue since ${waiting.dueLabel})` : ` (due ${waiting.dueLabel})`}. ` : '') +
      `${openActs.length} of ${actions.length} actions open; ${openQs.length} open quer${openQs.length === 1 ? 'y' : 'ies'}.`;
    return {
      model: 'cicod-docgen-v2 (sovereign)',
      confidence: Math.min(0.94, 0.7 + minutes.length * 0.025),
      status,
      holder: { role: last.to, since: last.date, days, from: last.by },
      decisions, queries, amounts, actions,
      openQueries: openQs.length,
    };
  }


  class AIMinuteSummary extends HTMLElement {
    connectedCallback() {
      this.src = document.querySelector(this.getAttribute('source'));
      this.innerHTML = `<section class="aims" aria-live="polite">
        <div class="aims__head"><span class="aims__title"><span class="ai-badge">CICOD-AI</span> File summary</span>
          <span class="aims__head-r"><span class="ai-confidence" data-model></span><button class="g-btn g-btn--sm" data-refresh type="button">Re-summarise</button></span></div>
        <div class="aims__body" data-body></div>
      </section>`;
      this.querySelector('[data-refresh]').addEventListener('click', () => this.run());
      if (this.src) new MutationObserver(() => this.stale()).observe(this.src, { childList: true });
      this.run();
    }

    read() {
      return [...(this.src ? this.src.querySelectorAll('[data-minute]') : [])].map(el => ({
        by: el.dataset.by, name: el.dataset.name || '', to: el.dataset.to, date: el.dataset.date,
        text: (el.querySelector('[data-minute-text]') || el).textContent.trim(),
      }));
    }

    stale() {
      const b = this.querySelector('[data-stale]');
      if (b) return;
      this.querySelector('[data-body]').insertAdjacentHTML('afterbegin', '<div class="aims__stale" data-stale>A new minute was added. Click <b>Re-summarise</b> to update.</div>');
    }

    async run() {
      const body = this.querySelector('[data-body]');
      body.innerHTML = '<div class="ai-skeleton" style="width:85%"></div><div class="ai-skeleton" style="width:65%"></div><div class="ai-skeleton" style="width:75%"></div><div class="ai-skeleton" style="width:50%"></div>';
      const minutes = this.read();
      const res = await request('/ecms/memo/summarise-minutes', { ref: this.getAttribute('ref'), subject: this.getAttribute('subject'), minutes }, { mock: mockSummarise, feature: 'ecms.memo-minutes' });
      this.res = res;
      this.render(res, minutes.length);
      this.dispatchEvent(new CustomEvent('ai-minute-summary', { detail: res, bubbles: true }));
    }

    render(res, n) {
      this.querySelector('[data-model]').textContent = `${n} minutes · ${Math.round(res.confidence * 100)}% · ${res.model}`;
      const h = res.holder;
      const acts = res.actions.map((a, i) => `<li class="aims__act ${a.done ? 'aims__act--done' : ''}" data-act="${i}">
          <div class="aims__act-main"><span class="aims__act-title">${esc(a.title)}</span>
            <span class="aims__act-meta">From minute: ${esc(a.fromMinute)} · due ${esc(a.dueSource)}${a.overdue ? ' · <span class="g-chip g-chip--bad">Overdue</span>' : ''}${a.state === 'done' ? ` · <span class="g-chip g-chip--ok">Done: ${esc(a.doneNote)}</span>` : a.state === 'progress' ? ` · <span class="g-chip g-chip--info">In progress: ${esc(a.doneNote)}</span>` : ''}</span></div>
          <div class="aims__act-ctl">
            <label class="aims__mini"><span>Assignee</span><input class="g-input" data-f="assignee" value="${esc(a.assignee)}"></label>
            <label class="aims__mini aims__mini--date"><span>Due</span><input class="g-input" type="date" data-f="due" value="${esc(a.due)}"></label>
            <button class="g-btn ${a.done ? '' : 'g-btn--ai'} g-btn--sm" data-create="${i}" type="button">${a.done ? 'Create anyway' : 'Create ECMS task'}</button>
          </div></li>`).join('');
      this.querySelector('[data-body]').innerHTML = `
        <div class="aims__status"><b>Status</b><p>${esc(res.status)}</p></div>
        <div class="aims__grid">
          <div class="aims__cell"><h5>Who holds the file</h5><p class="aims__holder">${esc(h.role)}</p><p class="aims__sub">Since ${esc(h.since)} (${h.days} day${h.days === 1 ? '' : 's'}), sent by ${esc(short(h.from))}</p></div>
          <div class="aims__cell"><h5>Decisions</h5>${res.decisions.length ? `<ul>${res.decisions.map(d => `<li>${esc(d.text)} <span class="aims__sub">${esc(d.date)}</span></li>`).join('')}</ul>` : '<p class="aims__sub">None yet</p>'}</div>
          <div class="aims__cell"><h5>Queries (${res.openQueries} open)</h5>${res.queries.length ? `<ul>${res.queries.map(q => `<li>${esc(q.text)} <span class="g-chip ${q.open ? 'g-chip--warn' : 'g-chip--ok'}">${q.open ? 'Open' : 'Answered: ' + esc(q.answer)}</span></li>`).join('')}</ul>` : '<p class="aims__sub">No queries raised</p>'}</div>
          ${res.amounts.length ? `<div class="aims__cell"><h5>Amount trail</h5><p>${res.amounts.filter(a => !a.compare).map(a => `<span class="aims__amt">${esc(a.value)}</span> <span class="aims__sub">${esc(short(a.by))}, ${esc(a.date)}</span>`).join(' → ')}</p>${res.amounts.some(a => a.compare) ? `<p class="aims__sub">Compared against: ${res.amounts.filter(a => a.compare).map(a => esc(a.value) + ' (' + esc(short(a.by)) + ')').join(', ')}</p>` : ''}</div>` : ''}
        </div>
        <div class="aims__acts"><h5>Action items (${res.actions.filter(a => !a.done).length} open of ${res.actions.length})</h5><ul>${acts || '<li class="aims__sub">No action items found.</li>'}</ul></div>
        <div class="aims__actions">
          <button class="g-btn g-btn--ai g-btn--sm" data-accept type="button">Summary is right</button>
          <button class="g-btn g-btn--sm" data-reject type="button">Not accurate</button>
          <span class="aims__mode">CICOD-AI summary · always read the minutes before deciding</span>
        </div>`;
      this.querySelectorAll('[data-create]').forEach(b => b.addEventListener('click', () => this.create(+b.dataset.create, b)));
      this.querySelector('[data-accept]').addEventListener('click', e => { feedback(res.id, 'ecms.memo-minutes', 'accepted'); e.target.textContent = 'Thanks ✓'; });
      this.querySelector('[data-reject]').addEventListener('click', e => { feedback(res.id, 'ecms.memo-minutes', 'rejected'); e.target.textContent = 'Flagged for review'; });
    }

    create(i, btn) {
      const a = this.res.actions[i];
      const row = this.querySelector(`[data-act="${i}"]`);
      const assignee = row.querySelector('[data-f=assignee]').value.trim() || a.assignee;
      const due = row.querySelector('[data-f=due]').value || a.due;
      const edited = assignee !== a.assignee || due !== a.due;
      feedback(this.res.id, 'ecms.memo-minutes', edited ? 'edited' : 'accepted', { action: i });
      this.dispatchEvent(new CustomEvent('ai-minute-create-task', { bubbles: true, detail: {
        title: a.title, assignee, due, queue: 'Correspondence', queueType: 'Memo action', ref: this.getAttribute('ref'), fromMinute: a.fromMinute } }));
      btn.disabled = true; btn.textContent = 'Task created ✓';
      row.classList.add('aims__act--created');
    }
  }

  customElements.define('ai-minute-summary', AIMinuteSummary);
})();
