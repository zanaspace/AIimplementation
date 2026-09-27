/* <ai-daily-brief feed="#db-feed" user="Prince" now="2026-09-27T14:10">
   Turns the Workspace Home greeting ("You have 0 approvals, 0 tasks and 0 new files awaiting you")
   into a ranked briefing. It reads the user's open approvals, tasks, shared files, meetings and
   InMail notifications, ranks them by SLA risk, sender seniority and consequence, and writes
   meeting prep for the next meeting. It never acts by itself: every item has Open / Snooze, and
   the new card order for "Needs you today" is only applied when the user accepts it.
   Attributes:
     feed   CSS selector of a <script type="application/json"> holding the items (host-owned data)
     user   first name used in the greeting
     now    ISO time used for SLA maths (defaults to the current time)
   Events (bubbles):
     ai-brief-result  detail: the full brief payload
     ai-brief-open    detail: { item }                       host navigates to the item
     ai-brief-snooze  detail: { item, until }                host hides it until that time
     ai-brief-reorder detail: { order:[{ card, rank, badge }] }  host re-orders the Needs-you-today cards
   Gateway: POST /workspace/daily-brief
     { user, now, focus:"balanced"|"sla"|"meetings", snoozed:[id], variant, items:[{id,kind,title,app,slaHours,seniority,consequence,…}] }
     -> { model, headline, stats:{approvals,tasks,files,breaches}, priorities:[{id,rank,risk,why,due,…}],
          later:{count,text}, meetingPrep:{title,time,points[],file?}, order:[{card,rank,badge}], factors[] } */
(function () {
  const { request, feedback, esc } = window.AIGateway;

  const CARD_FOR = { approval: 'approvals', task: 'tasks', workflow: 'workflows' };
  const KIND_LABEL = { approval: 'Approval', task: 'Task', file: 'File', meeting: 'Meeting', mail: 'InMail', workflow: 'Workflow' };

  function riskOf(h) { return h <= 1 ? 'breach' : h <= 6 ? 'at-risk' : 'ok'; }
  function dueText(h) {
    if (h < 0) return `overdue by ${Math.round(-h)} h`;
    if (h < 1) return `SLA in ${Math.max(5, Math.round(h * 60))} min`;
    if (h < 24) return `SLA in ${Math.round(h)} h`;
    return `due in ${Math.round(h / 24)} day${Math.round(h / 24) > 1 ? 's' : ''}`;
  }

  function score(it, focus) {
    const h = it.slaHours ?? 999;
    let sla = h <= 0 ? 100 : h <= 6 ? 90 - h * 6 : 50 / (1 + h / 24);
    if (focus === 'sla') sla *= 2;
    let s = sla + (it.seniority || 1) * 4 + (it.consequence || 1) * 6;
    if (it.kind === 'meeting') s += focus === 'meetings' ? 120 : 0;
    if (it.kind === 'file' && it.neededFor) s += focus === 'meetings' ? 60 : 25;
    return Math.round(s);
  }

  // Prototype-only ranking + wording. In production this is the SLA-risk model (E-T3) plus an LLM summary.
  function mockBrief({ user, focus, snoozed = [], variant = 0, items = [] }) {
    const open = items.filter(i => !snoozed.includes(i.id));
    const ranked = open.filter(i => !i.grouped).map(i => ({ ...i, score: score(i, focus) })).sort((a, b) => b.score - a.score);
    const breaches = open.filter(i => i.kind === 'approval' && i.slaHours <= 6);
    const count = k => items.filter(i => i.kind === k).reduce((n, i) => n + (i.count || 1), 0);
    const meeting = open.find(i => i.kind === 'meeting');
    const needFile = open.find(i => i.kind === 'file' && i.neededFor);
    const grouped = open.filter(i => i.grouped);

    const reason = it => {
      const bits = [];
      if (it.kind !== 'meeting' && it.slaHours <= 1) bits.push(`breaches SLA at ${it.dueAt}`);
      else if (it.kind !== 'meeting' && it.slaHours <= 6) bits.push(`SLA ends ${it.dueAt} today`);
      if (it.seniority >= 4) bits.push(`from ${it.from} (grade level ${it.seniority >= 5 ? '17' : '15'}+)`);
      if (it.consequence >= 3) bits.push(it.consequenceText || 'high consequence if missed');
      if (it.kind === 'meeting') bits.push(`you chair it; ${it.attendees} attendees; prep notes ready`);
      if (it.neededFor) bits.push(`needed for ${it.neededFor}`);
      if (!bits.length) bits.push(it.note || 'no deadline pressure today');
      return bits.join(' · ');
    };

    const top = ranked.slice(0, 5).map((it, i) => ({
      id: it.id, rank: i + 1, kind: it.kind, title: it.title, app: it.app, from: it.from,
      risk: it.kind === 'meeting' ? 'at-risk' : riskOf(it.slaHours ?? 999), due: it.kind === 'meeting' ? `starts ${it.dueAt}` : dueText(it.slaHours ?? 999),
      why: reason(it), score: it.score,
    }));
    const rest = ranked.slice(5).length + grouped.reduce((n, g) => n + (g.count || 1), 0);

    const openers = [
      `${breaches.length} approval${breaches.length === 1 ? '' : 's'} breach SLA today`,
      `Start with the ${breaches.length} approval${breaches.length === 1 ? '' : 's'} that breach SLA today`,
      `Two things can't wait: ${breaches.length} approval${breaches.length === 1 ? '' : 's'} near SLA breach`,
    ];
    let headline = breaches.length ? openers[variant % openers.length] : 'Nothing breaches SLA today';
    if (meeting && needFile) headline += `, and your ${meeting.dueAt} ${meeting.short} needs "${needFile.title}", which you haven't accepted yet.`;
    else if (meeting) headline += `. Your ${meeting.dueAt} ${meeting.short} has a prepared brief.`;
    else headline += '.';
    if (focus === 'meetings' && meeting) headline = `Your ${meeting.dueAt} ${meeting.short} is next. Accept the budget report and read the 3 prep points first. ${breaches.length} approvals still breach SLA today.`;

    // Needs-you-today card order, highest-ranked card first
    const cardRank = {};
    top.forEach(p => { const c = CARD_FOR[p.kind]; if (c && !(c in cardRank)) cardRank[c] = Object.keys(cardRank).length + 1; });
    ['approvals', 'tasks', 'workflows'].forEach(c => { if (!(c in cardRank)) cardRank[c] = Object.keys(cardRank).length + 1; });
    const dueToday = k => open.filter(i => i.kind === k && (i.slaHours ?? 999) <= 12).length;
    const badges = {
      approvals: breaches.length ? `${breaches.length} breach SLA today` : `${dueToday('approval')} due today`,
      tasks: dueToday('task') ? `${dueToday('task')} due today` : 'none due today',
      workflows: 'no deadlines today',
    };
    const order = Object.entries(cardRank).sort((a, b) => a[1] - b[1]).map(([card, rank]) => ({ card, rank, badge: `P${rank} · ${badges[card]}` }));

    return {
      model: 'cicod-brief-v1 (sovereign) + sla-risk-v2',
      greeting: `Good afternoon, ${user}`,
      headline,
      stats: { approvals: count('approval'), tasks: count('task'), files: count('file'), breaches: breaches.length },
      priorities: top,
      later: { count: rest, text: rest ? `${rest} other item${rest > 1 ? 's' : ''} can wait: nothing else is due before tomorrow midday.` : '' },
      meetingPrep: meeting ? {
        id: meeting.id, title: meeting.title, time: meeting.dueAt, room: meeting.room,
        points: meeting.prep, file: needFile ? needFile.title : null,
      } : null,
      order,
      factors: [
        { name: 'SLA risk', weight: focus === 'sla' ? '55%' : '40%', text: 'Hours left before the ECMS SLA ends, from the task and approval timers.' },
        { name: 'Sender seniority', weight: '20%', text: 'Grade level of the requester from ECMS Users & Roles. Permanent Secretary items rank up.' },
        { name: 'Consequence', weight: '25%', text: 'Repeat complaints, payments and anything blocking a meeting you chair.' },
        { name: 'Meetings', weight: focus === 'meetings' ? 'boosted' : 'next 2 h only', text: 'Meetings starting soon and the files they need.' },
      ],
    };
  }

  const RISK = { breach: ['g-chip--bad', 'Breach risk'], 'at-risk': ['g-chip--warn', 'Today'], ok: ['g-chip--ok', 'On track'] };

  class AIDailyBrief extends HTMLElement {
    connectedCallback() {
      this.user = this.getAttribute('user') || 'there';
      this.focus = 'balanced';
      this.snoozed = [];
      this.variant = 0;
      this.innerHTML = `<section class="aidb" aria-live="polite">
        <div class="aidb__top">
          <div><h2 class="aidb__hello">Good afternoon, <span>${esc(this.user)}</span></h2>
            <p class="aidb__sub" data-sub>Preparing your brief…</p></div>
          <div class="aidb__tools">
            <label class="aidb__focus"><span class="g-label">Rank by</span>
              <select class="g-select" data-focus><option value="balanced">Balanced</option><option value="sla">SLA risk first</option><option value="meetings">Meetings first</option></select></label>
            <button class="g-btn g-btn--sm" data-regen type="button">↻ Regenerate</button>
            <button class="g-btn g-btn--sm" data-why type="button" aria-expanded="false">Why this order?</button>
          </div>
        </div>
        <div class="aidb__body" data-body></div>
      </section>`;
      this.querySelector('[data-focus]').addEventListener('change', e => { this.focus = e.target.value; this.run(); });
      this.querySelector('[data-regen]').addEventListener('click', () => { this.variant++; feedback(this.result?.id, 'workspace.daily-brief', 'regenerated'); this.run(); });
      this.querySelector('[data-why]').addEventListener('click', e => {
        const w = this.querySelector('[data-whybox]'); if (!w) return;
        const open = w.hidden; w.hidden = !open; e.target.setAttribute('aria-expanded', String(open));
        if (open) feedback(this.result?.id, 'workspace.daily-brief', 'viewed-explanation');
      });
      this.run();
    }

    items() {
      const el = document.querySelector(this.getAttribute('feed'));
      try { return el ? JSON.parse(el.textContent) : []; } catch (e) { return []; }
    }

    async run() {
      const body = this.querySelector('[data-body]');
      body.innerHTML = '<div class="ai-skeleton" style="width:90%"></div><div class="ai-skeleton" style="width:75%"></div><div class="ai-skeleton" style="width:82%"></div><div class="ai-skeleton" style="width:60%"></div>';
      const payload = { user: this.user, now: this.getAttribute('now') || new Date().toISOString(), focus: this.focus, snoozed: this.snoozed, variant: this.variant, items: this.items() };
      const res = await request('/workspace/daily-brief', payload, { mock: mockBrief, feature: 'workspace.daily-brief' });
      this.result = res;
      this.render(res);
      this.dispatchEvent(new CustomEvent('ai-brief-result', { detail: res, bubbles: true }));
    }

    render(res) {
      const s = res.stats;
      this.querySelector('[data-sub]').innerHTML = `You have <b>${s.approvals} approvals</b>, <b>${s.tasks} tasks</b> and <b>${s.files} new files</b> awaiting you.`;
      const rows = res.priorities.map(p => {
        const [cls, lbl] = p.kind === 'meeting' ? ['g-chip--info', 'Soon'] : RISK[p.risk];
        return `<li class="aidb__item" data-id="${esc(p.id)}">
          <span class="aidb__rank">${p.rank}</span>
          <div class="aidb__main">
            <div class="aidb__line"><span class="aidb__kind">${esc(KIND_LABEL[p.kind] || p.kind)} · ${esc(p.app)}</span><span class="g-chip ${cls}">${lbl} · ${esc(p.due)}</span></div>
            <div class="aidb__title">${esc(p.title)}</div>
            <div class="aidb__why">${esc(p.why)}</div>
          </div>
          <div class="aidb__acts"><button class="g-btn g-btn--sm g-btn--primary" data-open="${esc(p.id)}" type="button">Open</button>
            <button class="g-btn g-btn--sm" data-snooze="${esc(p.id)}" type="button">Snooze</button></div>
        </li>`;
      }).join('');
      const m = res.meetingPrep;
      const prep = m ? `<div class="aidb__prep"><h5>Meeting prep · ${esc(m.time)} · ${esc(m.room)}</h5>
          <b>${esc(m.title)}</b><ul>${m.points.map(x => `<li>${esc(x)}</li>`).join('')}</ul>
          ${m.file ? `<p class="aidb__prep-file">Needs: <b>${esc(m.file)}</b>, still awaiting your acceptance on CICOD Drive.</p>` : ''}</div>` : '';
      const orderTxt = res.order.map(o => ({ approvals: 'Pending Approvals', tasks: 'Tasks Assigned To Me', workflows: 'My Workflows' }[o.card])).join(' → ');
      this.querySelector('[data-body]').innerHTML = `
        <p class="aidb__headline"><span class="ai-badge">CICOD-AI brief</span> ${esc(res.headline)}</p>
        <div class="aidb__grid">
          <ol class="aidb__list">${rows}</ol>
          ${prep}
        </div>
        ${res.later.text ? `<p class="aidb__later">${esc(res.later.text)}</p>` : ''}
        <div class="aidb__whybox" data-whybox hidden><b>How this order was worked out</b>
          <ul>${res.factors.map(f => `<li><b>${esc(f.name)} (${esc(f.weight)})</b>: ${esc(f.text)}</li>`).join('')}</ul>
          <span class="aidb__scores">Scores: ${res.priorities.map(p => `#${p.rank} ${p.score}`).join(' · ')}</span></div>
        <div class="aidb__actions">
          <button class="g-btn g-btn--ai g-btn--sm" data-apply type="button">Apply order to Needs you today</button>
          <button class="g-btn g-btn--sm" data-reject type="button">Not useful</button>
          <span class="aidb__mode"><span class="ai-confidence">${esc(res.model)}</span> · Suggested order: ${esc(orderTxt)}</span>
        </div>`;
      const whyBtn = this.querySelector('[data-why]'); whyBtn.setAttribute('aria-expanded', 'false');
      this.querySelectorAll('[data-open]').forEach(b => b.addEventListener('click', () => this.open(b.dataset.open)));
      this.querySelectorAll('[data-snooze]').forEach(b => b.addEventListener('click', () => this.snooze(b.dataset.snooze)));
      this.querySelector('[data-apply]').addEventListener('click', e => {
        feedback(res.id, 'workspace.daily-brief', 'accepted-order', { order: res.order.map(o => o.card) });
        this.dispatchEvent(new CustomEvent('ai-brief-reorder', { detail: { order: res.order }, bubbles: true }));
        e.target.textContent = 'Order applied ✓';
      });
      this.querySelector('[data-reject]').addEventListener('click', e => { feedback(res.id, 'workspace.daily-brief', 'rejected'); e.target.textContent = 'Thanks, noted'; e.target.disabled = true; });
    }

    open(id) {
      const item = this.items().find(i => i.id === id);
      feedback(this.result.id, 'workspace.daily-brief', 'opened', { item: id });
      this.dispatchEvent(new CustomEvent('ai-brief-open', { detail: { item }, bubbles: true }));
    }

    snooze(id) {
      const item = this.items().find(i => i.id === id);
      this.snoozed.push(id);
      feedback(this.result.id, 'workspace.daily-brief', 'snoozed', { item: id });
      this.dispatchEvent(new CustomEvent('ai-brief-snooze', { detail: { item, until: '16:00 today' }, bubbles: true }));
      this.run();
    }
  }

  customElements.define('ai-daily-brief', AIDailyBrief);
})();
