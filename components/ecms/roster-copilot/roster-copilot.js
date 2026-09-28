/* <ai-roster-copilot department="Customer Service">
   For departments that run shifts, CICOD-AI forecasts the hourly task volume for next week from
   past ticket volume, works out how many officers each hour needs, and generates a roster that
   covers the peaks. It respects leave and the maximum number of shifts per officer, and shares
   weekend shifts fairly. Coverage is compared with the current schedule. Officers can change any
   shift, and coverage is recalculated straight away. Nothing is applied until a supervisor clicks.
   Attributes:
     department   "Customer Service" | "IT Support" (the user can change it)
   Events (the host page saves the schedule):
     ai-roster-apply  detail: { department, weekOf, shifts:{code:hours}, rows:[{ name, days:[code×7] }], coverage }
   Gateway:
     POST /ecms/roster/generate { department, weekOf, maxShifts, includeEvents }
       -> { model, hours[], days[], need[7][h], forecast[7][h], officers:[{name, role, leave[]}],
            roster:[[code×7]], baseline:[[code×7]], reasons[], confidence } */
(function () {
  const { request, feedback, esc } = window.AIGateway;
  const FEATURE = 'ecms.roster-copilot';

  const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const HOURS = Array.from({ length: 13 }, (_, i) => 7 + i); // 07:00–19:59
  // Shift codes and the hours they cover (an hour counts if the shift covers at least 30 minutes of it).
  const SHIFTS = {
    M: { label: 'Early', time: '07:00–15:00', hours: [7, 8, 9, 10, 11, 12, 13, 14] },
    D: { label: 'Daily Shift', time: '09:30–16:30', hours: [9, 10, 11, 12, 13, 14, 15, 16] },
    L: { label: 'Late', time: '12:00–20:00', hours: [12, 13, 14, 15, 16, 17, 18, 19] },
  };
  const CYCLE = ['M', 'D', 'L', '-'];

  // Prototype-only department models. In production the hourly profile is learned from the
  // department's ECMS tasks (created time) over the last 12 weeks, and staff come from Resources.
  const DEPTS = {
    'Customer Service': {
      rate: 4, // tasks one officer handles per hour
      profile: { 7: 2, 8: 5, 9: 9, 10: 14, 11: 15, 12: 11, 13: 9, 14: 13, 15: 12, 16: 8, 17: 5, 18: 3, 19: 2 },
      dayFactor: [1.3, 1.0, 1.0, 0.95, 0.8, 0.35, 0],
      saturdayHours: [9, 10, 11, 12, 13, 14],
      event: { label: 'Payment gateway spike (Citizen Sentiment report)', days: [0, 1], factor: 1.25 },
      officers: [
        ['Benita Benita', 'Senior officer', [2]], ['Nathan Wilson', 'Officer', []], ['Damola Tunde', 'Officer', []], ['Rebecca Saku', 'Officer', []],
        ['Faith Egbe', 'Officer', [4]], ['Ayomide Olusanya', 'Officer', []], ['Oghenemarho Iyonu', 'Officer', []], ['Blessing Orewa', 'Officer', []],
      ],
    },
    'IT Support': {
      rate: 3,
      profile: { 7: 1, 8: 3, 9: 6, 10: 7, 11: 6, 12: 4, 13: 4, 14: 5, 15: 5, 16: 3, 17: 2, 18: 1, 19: 1 },
      dayFactor: [1.4, 1.1, 1.0, 1.0, 0.9, 0.2, 0],
      saturdayHours: [9, 10, 11, 12],
      event: { label: 'Laptop roll-out (20 × Lg Laptop PO)', days: [2, 3], factor: 1.4 },
      officers: [
        ['Eyitayo Abidogun', 'IT Resource', []], ['Damola Tunde', '1Gov Scanner', [0]], ['Chima Elefue', 'IT Resource', []], ['Olajide Durosinmi-Etti', 'IT Resource', []], ['Mercy Osoria', 'Support', []],
      ],
    },
  };

  const isOpen = (dept, d, h) => (d <= 4 ? true : d === 5 ? dept.saturdayHours.includes(h) : false);

  function forecast(dept, includeEvents) {
    return DAYS.map((_, d) => HOURS.map(h => {
      if (!isOpen(dept, d, h)) return 0;
      let v = dept.profile[h] * dept.dayFactor[d];
      if (d === 4 && h >= 14) v *= 0.75; // Friday afternoons are quieter
      if (includeEvents && dept.event.days.includes(d)) v *= dept.event.factor;
      return Math.round(v);
    }));
  }

  function staffedGrid(roster) {
    const grid = DAYS.map(() => HOURS.map(() => 0));
    roster.forEach(days => days.forEach((code, d) => {
      const s = SHIFTS[code]; if (!s) return;
      s.hours.forEach(h => { const i = HOURS.indexOf(h); if (i >= 0) grid[d][i]++; });
    }));
    return grid;
  }

  function coverageStats(need, roster) {
    const staffed = staffedGrid(roster);
    let open = 0, ok = 0, shortSlots = 0, shortHours = 0, over = 0;
    need.forEach((row, d) => row.forEach((n, i) => {
      if (!n) return;
      open++;
      const gap = staffed[d][i] - n;
      if (gap >= 0) ok++; else { shortSlots++; shortHours += -gap; }
      if (gap >= 2) over++;
    }));
    const shifts = roster.flat().filter(c => SHIFTS[c]).length;
    return { staffed, coverage: open ? ok / open : 1, shortSlots, shortHours, over, shifts, staffHours: shifts * 8 };
  }

  // Greedy optimiser: repeatedly add the (officer, day, shift) that covers the most unmet
  // officer-hours, preferring officers with fewer shifts and fewer weekend shifts.
  function optimise(need, officers, maxShifts) {
    const roster = officers.map(o => DAYS.map((_, d) => (o.leave.includes(d) ? 'LV' : '-')));
    for (let guard = 0; guard < 200; guard++) {
      const staffed = staffedGrid(roster);
      let best = null;
      officers.forEach((o, oi) => {
        const count = roster[oi].filter(c => SHIFTS[c]).length;
        if (count >= maxShifts) return;
        const weekend = SHIFTS[roster[oi][5]] ? 1 : 0;
        DAYS.forEach((_, d) => {
          if (roster[oi][d] !== '-') return;
          Object.entries(SHIFTS).forEach(([code, s]) => {
            let gain = 0;
            s.hours.forEach(h => { const i = HOURS.indexOf(h); if (i >= 0 && need[d][i] - staffed[d][i] > 0) gain++; });
            const score = gain * 10 - count - (d === 5 ? weekend * 5 : 0);
            if (gain > 0 && (!best || score > best.score)) best = { oi, d, code, score };
          });
        });
      });
      if (!best) break;
      roster[best.oi][best.d] = best.code;
    }
    // Clean-up pass: drop any shift that can be removed without leaving an hour short,
    // starting with officers who have the most shifts.
    const order = officers.map((_, oi) => oi).sort((a, b) => roster[b].filter(c => SHIFTS[c]).length - roster[a].filter(c => SHIFTS[c]).length);
    order.forEach(oi => DAYS.forEach((_, d) => {
      const code = roster[oi][d];
      if (!SHIFTS[code]) return;
      roster[oi][d] = '-';
      const staffed = staffedGrid(roster);
      const short = need[d].some((n, i) => n && staffed[d][i] < n);
      if (short) roster[oi][d] = code;
    }));
    return roster;
  }

  function mockRoster({ department, maxShifts, includeEvents }) {
    const dept = DEPTS[department];
    const fc = forecast(dept, includeEvents);
    const need = fc.map((row, d) => row.map((v, i) => (isOpen(dept, d, HOURS[i]) ? Math.max(1, Math.ceil(v / dept.rate)) : 0)));
    const officers = dept.officers.map(([name, role, leave]) => ({ name, role, leave }));
    // The current schedule: everyone on the Daily Shift, Monday to Friday.
    const baseline = officers.map(o => DAYS.map((_, d) => (o.leave.includes(d) ? 'LV' : d <= 4 ? 'D' : '-')));
    const roster = optimise(need, officers, maxShifts);

    const peak = need.flat().reduce((m, v) => Math.max(m, v), 0);
    const pd = need.findIndex(r => r.includes(peak));
    const ph = HOURS[need[pd].indexOf(peak)];
    const b = coverageStats(need, baseline);
    const leaveNotes = officers.filter(o => o.leave.length).map(o => `${o.name} is on leave on ${o.leave.map(d => DAYS[d]).join(', ')}, so that day is covered by others`);
    const reasons = [
      `Peak demand is ${DAYS[pd]} ${ph}:00, with about ${fc[pd][HOURS.indexOf(ph)]} tasks an hour. That needs ${peak} officers at ${dept.rate} tasks per officer per hour.`,
      `The current schedule puts everyone on the Daily Shift (09:30–16:30) from Monday to Friday. That leaves ${b.shortSlots} hour-slots short, including early mornings before 09:30, evenings after 16:30 and Saturday.`,
      'Early (07:00) and Late (to 20:00) shifts cover the start and end of the day. Staff move from quiet Friday afternoons to the Monday peak.',
      'Midday has spare officers because the 8-hour Early, Daily and Late shifts overlap from 12:00 to 15:00. Schedule lunch breaks in that window. Every shift is still needed for at least one hour.',
      ...leaveNotes,
      includeEvents ? `Includes a known event: ${dept.event.label} (+${Math.round((dept.event.factor - 1) * 100)}% on ${dept.event.days.map(d => DAYS[d]).join(' and ')}).` : 'Known events are not included in this forecast.',
    ];
    return { model: 'cicod-ecms-roster-v1 (seasonal forecast + shift optimiser)', department, rate: dept.rate, forecast: fc, need, officers, roster, baseline, reasons, confidence: 0.81 };
  }

  const nextMonday = () => { const d = new Date(); d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7)); return d; };

  class AIRosterCopilot extends HTMLElement {
    connectedCallback() {
      this.dept = this.getAttribute('department') || 'Customer Service';
      this.weekOf = nextMonday();
      this.innerHTML = `<section class="airo" aria-live="polite">
        <div class="airo__head"><span class="airo__title"><span class="ai-badge">CICOD-AI</span> Shift &amp; roster copilot</span><span class="ai-confidence" data-model></span></div>
        <div class="airo__controls">
          <label class="airo__ctl"><span class="g-label">Department</span><select class="g-select" data-dept>${Object.keys(DEPTS).map(d => `<option>${esc(d)}</option>`).join('')}</select></label>
          <label class="airo__ctl"><span class="g-label">Week of</span><input class="g-input" data-week value="${esc(this.weekOf.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }))}" readonly></label>
          <label class="airo__check"><input type="checkbox" data-max checked> Max 5 shifts per officer</label>
          <label class="airo__check"><input type="checkbox" data-events checked> Include known events</label>
          <button class="g-btn g-btn--ai g-btn--sm" data-run type="button">✦ Generate roster</button>
        </div>
        <div class="airo__body" data-body><p class="airo__empty">CICOD-AI will forecast next week's hourly task volume for the department from the last 12 weeks of ECMS tasks, then build a roster that covers it.</p></div>
        <div class="airo__actions" data-actions><span class="airo__mode">Supervisor approves before it's applied</span></div>
      </section>`;
      const sel = this.querySelector('[data-dept]'); sel.value = this.dept;
      sel.addEventListener('change', () => { this.dept = sel.value; if (this.res) this.run(); });
      ['[data-max]', '[data-events]'].forEach(s => this.querySelector(s).addEventListener('change', () => { if (this.res) this.run(); }));
      this.querySelector('[data-run]').addEventListener('click', () => this.run());
    }

    async run() {
      this.applied = false;
      this.edited = new Set();
      this.querySelector('[data-body]').innerHTML = '<div class="ai-skeleton" style="width:80%"></div><div class="ai-skeleton" style="width:95%;height:60px"></div><div class="ai-skeleton" style="width:70%"></div>';
      const payload = { department: this.dept, weekOf: this.weekOf.toISOString().slice(0, 10), maxShifts: this.querySelector('[data-max]').checked ? 5 : 6, includeEvents: this.querySelector('[data-events]').checked };
      this.res = await request('/ecms/roster/generate', payload, { mock: mockRoster, feature: FEATURE });
      this.roster = this.res.roster.map(r => [...r]);
      this.maxShifts = payload.maxShifts;
      this.querySelector('[data-model]').textContent = this.res.model;
      this.render();
    }

    heatmap(need, staffed) {
      const head = `<span></span>${HOURS.map(h => `<span class="airo__heat-hour">${String(h).padStart(2, '0')}</span>`).join('')}`;
      const rows = DAYS.map((d, di) => `<span class="airo__heat-label">${d}</span>${HOURS.map((h, i) => {
        const n = need[di][i];
        if (!n) return '<span class="airo__cell airo__cell--closed" title="Closed">·</span>';
        const s = staffed[di][i], gap = s - n;
        const cls = gap < 0 ? 'airo__cell--short' : gap >= 2 ? 'airo__cell--over' : 'airo__cell--ok';
        return `<span class="airo__cell ${cls}" title="${d} ${h}:00: ${s} on duty, ${n} needed">${gap < 0 ? gap : s}</span>`;
      }).join('')}`).join('');
      return `<div class="airo__heat-wrap"><div class="airo__heat" style="--h:${HOURS.length}">${head}${rows}</div></div>`;
    }

    render() {
      const r = this.res;
      const now = coverageStats(r.need, this.roster);
      const before = coverageStats(r.need, r.baseline);
      const pct = v => Math.round(v * 100) + '%';
      const rows = r.officers.map((o, oi) => {
        const n = this.roster[oi].filter(c => SHIFTS[c]).length;
        return `<tr><td class="airo__person"><b>${esc(o.name)}</b><span>${esc(o.role)}</span></td>
          ${this.roster[oi].map((c, d) => `<td><button class="airo__shift ${this.edited.has(`${oi}-${d}`) ? 'airo__shift--edited' : ''}" data-code="${c}" data-cell="${oi}-${d}" type="button" ${c === 'LV' ? 'disabled title="On leave"' : `title="${SHIFTS[c] ? `${SHIFTS[c].label} ${SHIFTS[c].time}` : 'Off'}. Click to change"`}>${c === 'LV' ? 'Leave' : c === '-' ? 'Off' : c}</button></td>`).join('')}
          <td><span class="airo__count ${n >= this.maxShifts ? 'airo__count--max' : ''}">${n}/${this.maxShifts}</span></td></tr>`;
      }).join('');

      this.querySelector('[data-body]').innerHTML = `
        <div class="airo__kpis">
          <div class="airo__kpi"><b><s>${pct(before.coverage)}</s>${pct(now.coverage)}</b><span>Hours fully staffed</span></div>
          <div class="airo__kpi"><b><s>${before.shortSlots}</s>${now.shortSlots}</b><span>Hour-slots understaffed</span></div>
          <div class="airo__kpi"><b><s>${before.staffHours}</s>${now.staffHours}</b><span>Staff-hours scheduled</span></div>
          <div class="airo__kpi"><b>${now.over}</b><span>Hour-slots with 2+ spare officers</span></div>
        </div>
        <p class="airo__summary">Struck-through figures are the current schedule (everyone on the Daily Shift, Mon–Fri).${this.edited.size ? ` You've changed ${this.edited.size} shift(s). Coverage has been recalculated.` : ''}</p>
        <h5 class="airo__h5"><span>Coverage next week: officers on duty against officers needed</span><span>forecast from ${r.rate} tasks per officer per hour</span></h5>
        ${this.heatmap(r.need, now.staffed)}
        <div class="airo__legend"><span><i style="background:var(--ok-bg)"></i>Covered (number on duty)</span><span><i style="background:var(--bad-bg)"></i>Short (officers missing)</span><span><i style="background:var(--info-bg)"></i>2+ spare</span><span>· closed</span></div>
        <h5 class="airo__h5"><span>Generated roster</span><span>M Early ${SHIFTS.M.time} · D Daily ${SHIFTS.D.time} · L Late ${SHIFTS.L.time}</span></h5>
        <div class="airo__roster-wrap"><table class="airo__roster"><thead><tr><th>Officer</th>${DAYS.map(d => `<th>${d}</th>`).join('')}<th>Shifts</th></tr></thead><tbody>${rows}</tbody></table></div>
        <h5 class="airo__h5">Why this roster</h5>
        <ul class="airo__why">${r.reasons.map(x => `<li>${esc(x)}</li>`).join('')}</ul>
        ${this.applied ? `<div class="airo__done">✓ Applied as a Resource Schedule for the week of ${esc(this.weekOf.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }))}. Officers are notified in InMail.</div>` : ''}`;

      this.querySelector('[data-actions]').innerHTML = `
        <button class="g-btn g-btn--primary g-btn--sm" data-apply type="button" ${this.applied ? 'disabled' : ''}>${this.applied ? 'Applied ✓' : 'Apply as Resource Schedule'}</button>
        <button class="g-btn g-btn--sm" data-reset type="button" ${this.edited.size ? '' : 'disabled'}>Undo my changes</button>
        <span class="ai-confidence">confidence ${Math.round(r.confidence * 100)}%</span>
        <span class="airo__mode">Supervisor approves before it's applied</span>`;

      this.querySelectorAll('[data-cell]').forEach(b => b.addEventListener('click', () => {
        const [oi, d] = b.dataset.cell.split('-').map(Number);
        const cur = this.roster[oi][d];
        this.roster[oi][d] = CYCLE[(CYCLE.indexOf(cur) + 1) % CYCLE.length];
        this.edited.add(`${oi}-${d}`);
        this.render();
      }));
      this.querySelector('[data-reset]').addEventListener('click', () => { this.roster = this.res.roster.map(x => [...x]); this.edited = new Set(); this.render(); });
      this.querySelector('[data-apply]').addEventListener('click', () => this.apply(now));
    }

    apply(stats) {
      this.applied = true;
      feedback(this.res.id, FEATURE, this.edited.size ? 'applied-with-edits' : 'applied', { edits: this.edited.size });
      this.dispatchEvent(new CustomEvent('ai-roster-apply', { detail: {
        department: this.res.department,
        weekOf: this.weekOf.toISOString().slice(0, 10),
        shifts: Object.fromEntries(Object.entries(SHIFTS).map(([k, s]) => [k, s.time])),
        rows: this.res.officers.map((o, oi) => ({ name: o.name, days: this.roster[oi] })),
        coverage: Math.round(stats.coverage * 100),
      }, bubbles: true }));
      this.render();
    }
  }

  customElements.define('ai-roster-copilot', AIRosterCopilot);
})();
