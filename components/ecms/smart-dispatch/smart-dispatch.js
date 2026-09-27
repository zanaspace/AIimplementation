/* <ai-smart-dispatch source="#resource-table" shifts="#shift-table" target-util="0.85">
   Workload balancing for ECMS Resources → All Resources:
     1. A workload panel: open tasks per resource as bars, with utilisation against the capacity
        of each resource's shift.
     2. A "Rebalance" proposal: move N tasks from X to Y, with the reason (shared skill, shift,
        schedule, suspension). Each move is accepted or skipped on its own.
     3. A "Shift validation" card that flags invalid or odd shifts with a suggested fix.
   Reads resources from <tr data-resource data-name data-dept data-status data-open data-shift
   data-skills="a|b"> and shifts from <tr data-shift-name data-start data-end data-status>.
   The component never moves tasks itself: the host applies each accepted move.
   Attributes:
     source       CSS selector of the resources table
     shifts       CSS selector of the shifts table
     target-util  utilisation the rebalance aims for (default 0.85)
   Events:
     ai-dispatch-result  detail: rebalance payload
     ai-dispatch-move    detail: { moveId, from, to, count, skill }   host reassigns the tasks
     ai-shift-fix        detail: { name, start, end }                 host updates the shift
   Gateway:
     POST /ecms/resources/rebalance { resources[], shifts[], targetUtil }
       -> { model, capacityPerHour, moves:[{ id, from, to, count, skill, reason, confidence }], unplaced[] }
     POST /ecms/resources/validate-shifts { shifts[] }
       -> { model, issues:[{ name, severity, problem, fix:{ start, end } | null }] } */
(function () {
  const { request, feedback, esc } = window.AIGateway;
  const PER_HOUR = 6; // open tasks a resource can carry per shift hour (tenant setting)

  const toMin = t => { const m = t.match(/(\d+):(\d+)(?::\d+)?\s*(AM|PM)/i); if (!m) return 0; let h = +m[1] % 12; if (/pm/i.test(m[3])) h += 12; return h * 60 + +m[2]; };
  const fmt = min => { const h = Math.floor(min / 60) % 24, m = min % 60; return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`; };
  const dur = (s, e) => { const d = toMin(e) - toMin(s); return d; };
  const hrs = min => `${Math.floor(min / 60)} h${min % 60 ? ` ${min % 60} min` : ''}`;

  function capacity(r, shifts) {
    const sh = shifts.find(s => s.name === r.shift);
    const d = sh ? dur(sh.start, sh.end) : 420;
    return Math.round((d > 0 ? d : 420) / 60 * PER_HOUR);
  }

  function mockRebalance({ resources, shifts, targetUtil }) {
    const rs = resources.map(r => ({ ...r, cap: capacity(r, shifts), load: r.open }));
    const active = rs.filter(r => r.status === 'active');
    const sources = [...rs.filter(r => r.status !== 'active' && r.load > 0), ...rs.filter(r => r.status === 'active' && r.load > r.cap).sort((a, b) => b.load / b.cap - a.load / a.cap)];
    const moves = [], unplaced = [];
    let n = 0;
    sources.forEach(src => {
      let excess = src.status !== 'active' ? src.load : Math.ceil(src.load - src.cap * targetUtil);
      const cands = active.filter(t => t !== src && t.skills.some(s => src.skills.includes(s)));
      while (excess > 0) {
        const t = cands.map(c => ({ c, spare: Math.floor(c.cap * targetUtil - c.load) })).filter(x => x.spare > 0).sort((a, b) => a.c.load / a.c.cap - b.c.load / b.c.cap)[0];
        if (!t) break;
        const count = Math.min(excess, t.spare);
        const skill = t.c.skills.find(s => src.skills.includes(s));
        const sh = shifts.find(s => s.name === t.c.shift);
        const before = Math.round((t.c.load / t.c.cap) * 100);
        t.c.load += count; src.load -= count; excess -= count;
        moves.push({ id: 'm' + (++n), from: src.name, to: t.c.name, count, skill, confidence: src.status !== 'active' ? 0.93 : 0.84,
          reason: `${src.status !== 'active' ? `${src.name} is suspended, so these tasks have no active owner. ` : `${src.name} is at ${Math.round(((src.load + count) / src.cap) * 100)}% of shift capacity. `}${t.c.name} shares the "${skill}" skill, is on ${t.c.shift}${sh ? ` (${sh.start}–${sh.end})` : ''} and is at ${before}% utilisation.` });
      }
      if (excess > 0) unplaced.push({ from: src.name, count: excess, skills: src.skills });
    });
    return { model: 'cicod-dispatch-optimiser-v1 (sovereign)', capacityPerHour: PER_HOUR, moves, unplaced };
  }

  function mockValidate({ shifts }) {
    const issues = [];
    shifts.filter(s => s.status === 'ACTIVE').forEach(s => {
      const st = toMin(s.start), en = toMin(s.end), d = en - st;
      if (d < 0 && !/night|overnight/i.test(s.name)) {
        const fixEnd = en + 720;
        issues.push({ name: s.name, severity: 'bad', problem: `Ends before it starts (${s.start} → ${s.end}), so any resource on it gets zero working time.${fixEnd > st ? ` ${s.end.replace('AM', 'PM')} gives a normal ${hrs(fixEnd - st)} day.` : ''}`, fix: fixEnd > st ? { start: s.start, end: fmt(fixEnd) } : null });
      } else if (d > 0 && d < 150 && st < 7 * 60) {
        issues.push({ name: s.name, severity: 'warn', problem: `Only ${hrs(d)} long and starts at ${s.start}, before office hours. Nobody can complete a task in that window; for SIWES interns, standard office hours are more likely.`, fix: { start: '8:00 AM', end: '4:00 PM' } });
      } else if (st === 0 && d > 0) {
        issues.push({ name: s.name, severity: 'warn', problem: `Runs from midnight to ${s.end}. The IT Manager Schedule uses it on Mon, Wed and Fri during the day, so ${fmt(st + 720)}–${fmt(en + 720)} is more likely.`, fix: { start: fmt(st + 720), end: fmt(en + 720) } });
      } else if (d > 600) {
        issues.push({ name: s.name, severity: 'info', problem: `${hrs(d)} long, over the 10-hour limit. Check the overtime policy or split it into two shifts.`, fix: null });
      }
    });
    return { model: 'cicod-shift-validator-v1 (rules + LLM)', issues };
  }

  class AISmartDispatch extends HTMLElement {
    connectedCallback() {
      this.src = document.querySelector(this.getAttribute('source'));
      this.shiftSrc = document.querySelector(this.getAttribute('shifts'));
      this.target = parseFloat(this.getAttribute('target-util') || '0.85');
      this.innerHTML = `<section class="aisd">
        <div class="aisd__panel">
          <div class="aisd__head"><span class="aisd__title"><span class="ai-badge">CICOD-AI</span> Workload</span><button class="g-btn g-btn--sm g-btn--ai" type="button" data-aisd-rebalance>✦ Rebalance</button></div>
          <div class="aisd__body"><div data-bars></div><div data-moves aria-live="polite"></div></div>
        </div>
        <div class="aisd__panel">
          <div class="aisd__head"><span class="aisd__title"><span class="ai-badge">CICOD-AI</span> Shift validation</span><span class="ai-confidence" data-shift-meta>checking…</span></div>
          <div class="aisd__body" data-shifts aria-live="polite"><div class="ai-skeleton" style="width:80%"></div><div class="ai-skeleton" style="width:60%"></div></div>
        </div>
      </section>`;
      this.renderBars();
      this.querySelector('[data-aisd-rebalance]').addEventListener('click', () => this.rebalance());
      this.validate();
    }

    resources() {
      return [...(this.src?.querySelectorAll('tr[data-resource]') || [])].map(tr => ({ id: tr.dataset.resource, name: tr.dataset.name, dept: tr.dataset.dept, status: tr.dataset.status, open: +tr.dataset.open, shift: tr.dataset.shift, skills: (tr.dataset.skills || '').split('|').filter(Boolean) }));
    }
    shifts() {
      return [...(this.shiftSrc?.querySelectorAll('tr[data-shift-name]') || [])].map(tr => ({ name: tr.dataset.shiftName, start: tr.dataset.start, end: tr.dataset.end, status: tr.dataset.status }));
    }

    renderBars() {
      const shifts = this.shifts();
      const rs = this.resources().map(r => ({ ...r, cap: capacity(r, shifts) })).sort((a, b) => b.open - a.open);
      const total = rs.reduce((s, r) => s + r.open, 0), cap = rs.filter(r => r.status === 'active').reduce((s, r) => s + r.cap, 0);
      this.querySelector('[data-bars]').innerHTML = `<p class="aisd__sum">${total} open tasks across ${rs.length} resources · average utilisation <b>${Math.round((total / cap) * 100)}%</b> of shift capacity (${PER_HOUR} open tasks per shift hour)</p>
        ${rs.map(r => { const u = r.open / r.cap; return `<div class="aisd__bar" data-res="${esc(r.name)}">
          <span class="aisd__bar-name">${esc(r.name)}${r.status !== 'active' ? ' <span class="g-chip g-chip--bad">suspended</span>' : ''}</span>
          <span class="aisd__track"><i class="${u > 1 || r.status !== 'active' ? 'aisd--over' : u > this.target ? 'aisd--high' : ''}" style="width:${Math.min(100, u * 100)}%"></i><b style="left:${this.target * 100}%" aria-hidden="true"></b></span>
          <span class="aisd__bar-v">${esc(r.open)} · ${Math.round(u * 100)}%</span></div>`; }).join('')}`;
    }

    async rebalance() {
      const box = this.querySelector('[data-moves]');
      box.innerHTML = '<div class="ai-skeleton" style="width:90%"></div><div class="ai-skeleton" style="width:75%"></div><div class="ai-skeleton" style="width:82%"></div>';
      const res = await request('/ecms/resources/rebalance', { resources: this.resources(), shifts: this.shifts(), targetUtil: this.target }, { mock: mockRebalance, feature: 'ecms.smart-dispatch' });
      this.res = res;
      this.dispatchEvent(new CustomEvent('ai-dispatch-result', { detail: res, bubbles: true }));
      if (!res.moves.length) { box.innerHTML = '<p class="aisd__muted">Workload is already balanced within the target. No moves proposed.</p>'; return; }
      box.innerHTML = `<div class="aisd__prop"><div class="aisd__prop-head"><b>Rebalance proposal · ${res.moves.length} moves, ${res.moves.reduce((s, m) => s + m.count, 0)} tasks</b><span class="ai-confidence">${esc(res.model)}</span></div>
        ${res.moves.map(m => `<div class="aisd__move" data-move="${esc(m.id)}">
          <div class="aisd__move-main"><b>Move ${esc(m.count)} task${m.count > 1 ? 's' : ''}</b> from ${esc(m.from)} → <b>${esc(m.to)}</b> <span class="ai-confidence">${Math.round(m.confidence * 100)}%</span><p>${esc(m.reason)}</p></div>
          <div class="aisd__move-act"><button class="g-btn g-btn--sm g-btn--ai" type="button" data-accept>Accept</button><button class="g-btn g-btn--sm" type="button" data-skip>Skip</button></div></div>`).join('')}
        ${res.unplaced.map(u => `<div class="aisd__unplaced">⚠ ${esc(u.count)} of ${esc(u.from)}'s tasks cannot be placed: no other active resource with ${esc(u.skills.join(' / '))} skills has room. Consider adding a resource to that workgroup.</div>`).join('')}
        <div class="aisd__prop-foot"><button class="g-btn g-btn--sm g-btn--primary" type="button" data-accept-all>Accept all</button><span class="aisd__muted">Each move reassigns the oldest open tasks first. Nothing changes until you accept.</span></div></div>`;
      box.querySelectorAll('[data-move]').forEach(el => {
        const m = res.moves.find(x => x.id === el.dataset.move);
        el.querySelector('[data-accept]').addEventListener('click', () => this.accept(m, el));
        el.querySelector('[data-skip]').addEventListener('click', () => { feedback(res.id, 'ecms.smart-dispatch', 'rejected', { move: m.id }); el.classList.add('aisd__move--done'); el.querySelector('.aisd__move-act').innerHTML = '<span class="g-chip">Skipped</span>'; });
      });
      box.querySelector('[data-accept-all]').addEventListener('click', () => box.querySelectorAll('[data-move]:not(.aisd__move--done)').forEach(el => this.accept(res.moves.find(x => x.id === el.dataset.move), el)));
    }

    accept(m, el) {
      if (el.classList.contains('aisd__move--done')) return;
      feedback(this.res.id, 'ecms.smart-dispatch', 'accepted', { move: m.id });
      el.classList.add('aisd__move--done');
      el.querySelector('.aisd__move-act').innerHTML = '<span class="g-chip g-chip--ok">Reassigned ✓</span>';
      this.dispatchEvent(new CustomEvent('ai-dispatch-move', { detail: { moveId: m.id, from: m.from, to: m.to, count: m.count, skill: m.skill }, bubbles: true }));
      this.renderBars(); // re-read the host's updated counts
    }

    async validate() {
      const res = await request('/ecms/resources/validate-shifts', { shifts: this.shifts() }, { mock: mockValidate, feature: 'ecms.smart-dispatch.shifts' });
      const box = this.querySelector('[data-shifts]');
      this.querySelector('[data-shift-meta]').textContent = `${res.issues.length} issue${res.issues.length === 1 ? '' : 's'} · ${res.model}`;
      const sh = this.shifts();
      box.innerHTML = res.issues.map((i, k) => { const s = sh.find(x => x.name === i.name) || {}; return `<div class="aisd__issue aisd__issue--${esc(i.severity)}" data-issue="${k}">
          <div class="aisd__issue-top"><b>${esc(i.name)}</b><span class="aisd__muted">${esc(s.start)} – ${esc(s.end)}</span></div>
          <p>${esc(i.problem)}</p>
          ${i.fix ? `<div class="aisd__fix">Suggested: <b>${esc(i.fix.start)} – ${esc(i.fix.end)}</b></div>` : ''}
          <div class="aisd__issue-act">${i.fix ? '<button class="g-btn g-btn--sm g-btn--ai" type="button" data-fix>Apply fix</button>' : '<button class="g-btn g-btn--sm" type="button" data-ok>Acknowledge</button>'}<button class="g-btn g-btn--sm g-btn--ghost" type="button" data-keep>Keep as is</button></div>
        </div>`; }).join('') || '<p class="aisd__muted">All active shifts look valid.</p>';
      box.querySelectorAll('[data-issue]').forEach(el => {
        const i = res.issues[+el.dataset.issue];
        const done = (label, cls) => { el.classList.add('aisd__issue--done'); el.querySelector('.aisd__issue-act').innerHTML = `<span class="g-chip ${cls}">${label}</span>`; };
        el.querySelector('[data-fix]')?.addEventListener('click', () => {
          feedback(res.id, 'ecms.smart-dispatch.shifts', 'accepted', { shift: i.name });
          this.dispatchEvent(new CustomEvent('ai-shift-fix', { detail: { name: i.name, start: i.fix.start, end: i.fix.end }, bubbles: true }));
          done('Fixed ✓', 'g-chip--ok'); this.renderBars();
        });
        el.querySelector('[data-ok]')?.addEventListener('click', () => { feedback(res.id, 'ecms.smart-dispatch.shifts', 'acknowledged', { shift: i.name }); done('Acknowledged', ''); });
        el.querySelector('[data-keep]').addEventListener('click', () => { feedback(res.id, 'ecms.smart-dispatch.shifts', 'rejected', { shift: i.name }); done('Kept as is', ''); });
      });
    }
  }

  customElements.define('ai-smart-dispatch', AISmartDispatch);
})();
