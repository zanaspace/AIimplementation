/* <ai-maintenance-scheduler assets="#asset-table" horizon="30" high="0.5" medium="0.25">
   Predicts which assets are likely to fail within the chosen horizon, from their repair history
   and usage. It explains each prediction and drafts a preventive ECMS repair task for the right
   queue before the failure happens. Nothing is scheduled until a store officer confirms.
   Reads assets from <tr data-asset data-code="GEN-01"> rows (only the code is sent; history and
   usage come from IMS and ECMS on the server).
   Attributes:
     assets    CSS selector of the table whose rows carry data-asset + data-code
     horizon   forecast window in days: 30 | 60 | 90 (the user can change it)
     high      probability at or above which an asset is High risk (default 0.5)
     medium    probability at or above which an asset is Medium risk (default 0.25)
   Events (the host page does the actual scheduling):
     ai-maintenance-schedule  detail: { code, task:{ queue, queueType, title, description, priority, assignee, due } }
     ai-maintenance-dismiss   detail: { code, reason }
   Gateway:
     POST /ims/maintenance/forecast { assets:[code], horizonDays }
       -> { model, asOf, assets:[{ code, name, risk, level, failBy, serviceBy, driver, reasons[], history[],
            curve:[[day, p]], cost:{ preventive, breakdown, downtimeDays }, task:{…}, confidence }] } */
(function () {
  const { request, feedback, esc } = window.AIGateway;
  const FEATURE = 'ims.predictive-maintenance';
  const DAY = 86400000;

  // Prototype-only fleet model. In production each asset's Weibull shape (beta) and scale (eta)
  // are fitted from its category's repair history in ECMS, and usage comes from IMS meter readings.
  const FLEET = {
    'GEN-01': {
      name: 'Perkins 100kVA Generator', category: 'Power Equipment', where: 'HQ power house', unit: 'run-hours', perDay: 11, since: 460, beta: 2.4, eta: 520,
      driver: '460 run-hours since last service. Fuel-filter failures happen 480–540 h after service',
      reasons: ['3 fuel-filter failures in the last 12 months, each 480–540 run-hours after a service', 'Running about 11 h a day since the grid supply got worse in August', 'Oil sample from the last service flagged high soot'],
      history: [['2026-08-14', '#17391', 'Fuel filter blocked, generator shut down for 2 days'], ['2026-04-02', '#16904', 'Fuel filter and injector cleaned'], ['2025-11-20', '#16512', 'Fuel filter replaced after an unplanned stop']],
      cost: { preventive: 85000, breakdown: 620000, downtimeDays: 2 },
      task: { queue: 'Facility Management', queueType: 'Preventive maintenance', title: 'Preventive service: GEN-01 fuel filter and injector', priority: 'High', assignee: 'Engineers shift · Facility team' },
    },
    'VEH-FG-214': {
      name: 'Toyota Hilux (FG 214 KJA)', category: 'Vehicles', where: 'Fleet pool', unit: 'km', perDay: 140, since: 18200, beta: 3.1, eta: 21000,
      driver: '18,200 km on the current brake pads. They were replaced at 19–22k km each time before',
      reasons: ['Brake pads replaced 3 times, at 19,400, 21,800 and 20,600 km', 'Averaging 140 km a day on the Abuja–Kaduna route', 'Driver reported brake noise in a remark on task #17488'],
      history: [['2026-09-19', '#17488', 'Driver remark: squealing when braking'], ['2026-02-11', '#16788', 'Brake pads replaced (20,600 km)'], ['2025-06-03', '#16044', 'Brake pads and discs replaced (21,800 km)']],
      cost: { preventive: 120000, breakdown: 480000, downtimeDays: 5 },
      task: { queue: 'AUTO MOBILE REPAIR', queueType: 'REPAIR DETAILS', title: 'Preventive repair: FG 214 KJA brake pads', priority: 'High', assignee: 'Fleet officer · AUTO MOBILE REPAIR workgroup' },
    },
    '784783FS': {
      name: 'Floor Scrubber 100CL', category: 'Cleaning Equipment', where: 'Central Store', unit: 'days', perDay: 1, since: 165, beta: 2.0, eta: 210,
      driver: '165 days since the drive motor was serviced. The motor failed after 190 days last time',
      reasons: ['Drive motor failed 190 days after its last service in 2025', 'Used daily in the HQ lobby and corridors', 'Battery charge time up 35% (cleaner remark)'],
      history: [['2026-04-16', '#16921', 'Drive motor serviced'], ['2025-10-09', '#16430', 'Drive motor burnt out, replaced']],
      cost: { preventive: 45000, breakdown: 210000, downtimeDays: 10 },
      task: { queue: 'Facility Management', queueType: 'Preventive maintenance', title: 'Preventive service: Floor Scrubber 100CL drive motor', priority: 'Medium', assignee: 'Facility team' },
    },
    'AC-HQ-07': {
      name: 'Split AC 2HP (Director\'s office)', category: 'Refrigeration Equipment', where: 'HQ, 3rd floor', unit: 'days', perDay: 1, since: 300, beta: 3.0, eta: 365,
      driver: '300 days since the last gas top-up. This unit has needed one about every 12 months',
      reasons: ['Gas top-up needed 2 years in a row, about 360 days apart', 'Outdoor unit faces west. Afternoon load is high in the dry season', 'Dry season starts in about 6 weeks, when failures cluster'],
      history: [['2025-12-01', '#16560', 'Gas top-up and coil cleaning'], ['2024-12-06', '#15210', 'Gas top-up']],
      cost: { preventive: 35000, breakdown: 150000, downtimeDays: 4 },
      task: { queue: 'Facility Management', queueType: 'Preventive maintenance', title: 'Preventive service: AC-HQ-07 gas check before the dry season', priority: 'Medium', assignee: 'Facility team' },
    },
    'SAMSUNG01': {
      name: 'Lg Laptop', category: 'Personal Information Technology Device', where: 'Holding Areas → issued to ICT', unit: 'days', perDay: 1, since: 700, beta: 2.8, eta: 1250,
      driver: 'The battery is 700 days old. Batteries in this model degrade from about 1,000 days',
      reasons: ['Battery health reports 71% on the last ICT check', 'Batteries in this model are usually replaced at 1,000–1,300 days'],
      history: [['2024-10-29', 'Receipt', 'Received into Holding Areas (supplier NCC)']],
      cost: { preventive: 55000, breakdown: 90000, downtimeDays: 3 },
      task: { queue: 'IT Support', queueType: 'Hardware & Network', title: 'Replace battery: Lg Laptop (SAMSUNG01)', priority: 'Normal', assignee: 'Eyitayo Abidogun (IT Resource)' },
    },
    '8765065': {
      name: 'Solar Sheet', category: 'Power Equipment', where: 'HQ roof', unit: 'days', perDay: 1, since: 40, beta: 1.3, eta: 1400,
      driver: "40 days since cleaning. There's no failure history, and output is normal",
      reasons: ['No failures recorded', 'Output within 3% of the rated capacity on the last reading'],
      history: [['2026-08-19', '#17402', 'Panels cleaned']],
      cost: { preventive: 15000, breakdown: 60000, downtimeDays: 1 },
      task: { queue: 'Facility Management', queueType: 'Preventive maintenance', title: 'Clean and inspect: Solar Sheet array', priority: 'Low', assignee: 'Facility team' },
    },
  };

  // Probability of failing within h more units, given the asset has run t units since service.
  const condFail = (t, h, beta, eta) => 1 - Math.exp(-(Math.pow((t + h) / eta, beta) - Math.pow(t / eta, beta)));
  const addDays = (d, n) => new Date(d.getTime() + n * DAY);
  const fmt = d => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  const iso = d => d.toISOString().slice(0, 10);
  // A forecast is never certain, so the display is capped at 99%.
  const pct = p => Math.min(99, Math.round(p * 100));
  const naira = n => '₦' + n.toLocaleString('en-NG');

  function mockForecast({ assets, horizonDays, high, medium }) {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const out = assets.filter(c => FLEET[c]).map(code => {
      const a = FLEET[code];
      const units = d => d * a.perDay;
      const risk = condFail(a.since, units(horizonDays), a.beta, a.eta);
      // First day on which the probability of failure passes 50% (likely failure) and 20% (service by).
      let failDay = null, serviceDay = null;
      for (let d = 1; d <= 730; d++) {
        const p = condFail(a.since, units(d), a.beta, a.eta);
        if (serviceDay === null && p >= 0.2) serviceDay = d;
        if (p >= 0.5) { failDay = d; break; }
      }
      const curve = [];
      for (let d = 0; d <= 90; d += 3) curve.push([d, condFail(a.since, units(d), a.beta, a.eta)]);
      const level = risk >= high ? 'high' : risk >= medium ? 'med' : 'low';
      const serviceBy = addDays(today, Math.max(1, (serviceDay || 60) - 2));
      return {
        code, name: a.name, category: a.category, where: a.where, risk, level,
        failBy: failDay ? fmt(addDays(today, failDay)) : 'Beyond 2 years',
        serviceBy: fmt(serviceBy),
        driver: a.driver, reasons: a.reasons, history: a.history, curve, cost: a.cost,
        confidence: Math.min(0.93, 0.55 + a.history.length * 0.12),
        task: {
          ...a.task,
          due: iso(serviceBy),
          description: `CICOD-AI predicted a ${pct(risk)}% chance that ${a.name} (${code}) fails within ${horizonDays} days. ${a.driver}. Please service it by ${fmt(serviceBy)}. A preventive job costs about ${naira(a.cost.preventive)}; a breakdown would cost about ${naira(a.cost.breakdown)} plus ${a.cost.downtimeDays} day(s) of downtime.`,
        },
      };
    }).sort((x, y) => y.risk - x.risk);
    return { model: 'cicod-ims-maintenance-v1 (Weibull survival + LLM)', asOf: fmt(today), horizonDays, assets: out };
  }

  const LABEL = { high: 'High', med: 'Medium', low: 'Low' };

  function curveSvg(points, horizon) {
    const W = 300, H = 120, px = d => 28 + (d / 90) * (W - 36), py = p => H - 20 - p * (H - 30);
    const line = points.map(([d, p], i) => `${i ? 'L' : 'M'}${px(d).toFixed(1)},${py(p).toFixed(1)}`).join(' ');
    const area = `${line} L${px(90)},${py(0)} L${px(0)},${py(0)} Z`;
    return `<svg class="aipm__curve" viewBox="0 0 ${W} ${H}" role="img" aria-label="Chance of failure over the next 90 days">
      <rect class="aipm__curve-win" x="${px(0)}" y="${py(1)}" width="${px(horizon) - px(0)}" height="${py(0) - py(1)}"></rect>
      <path class="aipm__curve-area" d="${area}"></path><path class="aipm__curve-line" d="${line}"></path>
      <line class="aipm__curve-axis" x1="${px(0)}" y1="${py(0)}" x2="${px(90)}" y2="${py(0)}"></line>
      <line class="aipm__curve-axis" x1="${px(0)}" y1="${py(0)}" x2="${px(0)}" y2="${py(1)}"></line>
      <line class="aipm__curve-now" x1="${px(0)}" y1="${py(0.5)}" x2="${px(90)}" y2="${py(0.5)}"></line>
      <text class="aipm__curve-text" x="2" y="${py(1) + 4}">100%</text><text class="aipm__curve-text" x="6" y="${py(0.5) + 3}">50%</text><text class="aipm__curve-text" x="12" y="${py(0) + 3}">0</text>
      <text class="aipm__curve-text" x="${px(0)}" y="${H - 4}">today</text><text class="aipm__curve-text" x="${px(45) - 12}" y="${H - 4}">45 days</text><text class="aipm__curve-text" x="${px(90) - 40}" y="${H - 4}">90 days</text>
    </svg>`;
  }

  class AIMaintenanceScheduler extends HTMLElement {
    connectedCallback() {
      this.horizon = parseInt(this.getAttribute('horizon') || '30', 10);
      this.high = parseFloat(this.getAttribute('high') || '0.5');
      this.medium = parseFloat(this.getAttribute('medium') || '0.25');
      this.scheduled = new Set();
      this.dismissed = new Set();
      this.innerHTML = `<section class="aipm" aria-live="polite">
        <div class="aipm__head"><span class="aipm__title"><span class="ai-badge">CICOD-AI</span> Predictive maintenance</span>
          <span class="aipm__controls"><label for="aipm-h">Forecast window</label>
            <select class="g-select" id="aipm-h" data-horizon><option value="30">Next 30 days</option><option value="60">Next 60 days</option><option value="90">Next 90 days</option></select></span></div>
        <div data-content><div class="aipm__list"><div class="ai-skeleton" style="width:80%"></div><div class="ai-skeleton" style="width:65%"></div><div class="ai-skeleton" style="width:72%"></div></div></div>
      </section>`;
      const sel = this.querySelector('[data-horizon]');
      sel.value = String(this.horizon);
      sel.addEventListener('change', () => { this.horizon = parseInt(sel.value, 10); this.load(); });
      this.load();
    }

    codes() {
      const table = document.querySelector(this.getAttribute('assets'));
      return [...(table?.querySelectorAll('[data-asset]') || [])].map(r => r.dataset.code);
    }

    async load() {
      const c = this.querySelector('[data-content]');
      c.innerHTML = '<div class="aipm__list"><div class="ai-skeleton" style="width:80%"></div><div class="ai-skeleton" style="width:65%"></div><div class="ai-skeleton" style="width:72%"></div></div>';
      const res = await request('/ims/maintenance/forecast', { assets: this.codes(), horizonDays: this.horizon, high: this.high, medium: this.medium }, { mock: mockForecast, feature: FEATURE });
      this.res = res;
      this.render();
    }

    render() {
      const res = this.res;
      const visible = res.assets.filter(a => !this.dismissed.has(a.code));
      const n = lvl => visible.filter(a => a.level === lvl && !this.scheduled.has(a.code)).length;
      const avoid = visible.filter(a => a.level !== 'low' && !this.scheduled.has(a.code)).reduce((s, a) => s + (a.cost.breakdown - a.cost.preventive) * a.risk, 0);
      const rows = visible.map(a => `
        <div class="aipm__row aipm__row--${a.level}" data-code="${esc(a.code)}">
          <span class="aipm__asset"><b>${esc(a.name)}</b><span>${esc(a.code)} · ${esc(a.where)}</span></span>
          <span class="aipm__risk"><span class="aipm__risk-val">${pct(a.risk)}% · ${LABEL[a.level]}</span><span class="aipm__bar"><i style="width:${Math.max(3, pct(a.risk))}%"></i></span></span>
          <span class="aipm__driver">${esc(a.driver)}</span>
          <span class="aipm__row-actions">${this.scheduled.has(a.code) ? '<span class="aipm__scheduled">Scheduled ✓</span>' : `<button class="g-btn g-btn--sm" data-open="${esc(a.code)}" type="button">Why?</button>${a.level !== 'low' ? `<button class="g-btn g-btn--ai g-btn--sm" data-draft="${esc(a.code)}" type="button">Draft task</button>` : ''}`}</span>
        </div>`).join('');
      this.querySelector('[data-content]').innerHTML = `
        <div class="aipm__summary">
          <div class="aipm__stat aipm__stat--bad"><b>${n('high')}</b><span>High risk in ${res.horizonDays} days</span></div>
          <div class="aipm__stat aipm__stat--warn"><b>${n('med')}</b><span>Medium risk</span></div>
          <div class="aipm__stat aipm__stat--ok"><b>${this.scheduled.size}</b><span>Preventive tasks scheduled</span></div>
          <div class="aipm__stat"><b>${naira(Math.round(avoid / 1000) * 1000)}</b><span>Expected breakdown cost avoidable</span></div>
        </div>
        <div class="aipm__list">${rows || '<p class="aipm__driver">No assets to forecast.</p>'}</div>
        <div class="aipm__drawer" data-drawer hidden></div>
        <div class="aipm__actions">
          <button class="g-btn g-btn--ai g-btn--sm" data-bulk type="button" ${n('high') ? '' : 'disabled'}>Draft tasks for all High risk (${n('high')})</button>
          <span class="ai-confidence">as of ${esc(res.asOf)} · ${esc(res.model)}</span>
          <span class="aipm__mode">Officer confirms every task</span>
        </div>`;
      this.querySelectorAll('[data-open]').forEach(b => b.addEventListener('click', () => this.open(b.dataset.open, false)));
      this.querySelectorAll('[data-draft]').forEach(b => b.addEventListener('click', () => this.open(b.dataset.draft, true)));
      this.querySelector('[data-bulk]').addEventListener('click', () => this.bulk());
    }

    open(code, withTask) {
      const a = this.res.assets.find(x => x.code === code);
      const d = this.querySelector('[data-drawer]');
      d.hidden = false;
      d.innerHTML = `
        <div class="aipm__drawer-head"><div><h4>${esc(a.name)} · ${pct(a.risk)}% chance of failure in ${this.res.horizonDays} days</h4>
          <p>${esc(a.code)} · ${esc(a.category)} · likely failure around <b>${esc(a.failBy)}</b> · service by <b>${esc(a.serviceBy)}</b> · <span class="ai-confidence">confidence ${Math.round(a.confidence * 100)}%</span></p></div>
          <button class="g-btn g-btn--ghost g-btn--sm" data-close type="button" aria-label="Close">✕</button></div>
        <div class="aipm__grid">
          <div class="aipm__panel"><h5 class="aipm__h5">Chance of failure over time</h5>${curveSvg(a.curve, this.res.horizonDays)}
            <div class="aipm__legend">The shaded band is your forecast window. The dashed line marks 50%.</div></div>
          <div class="aipm__panel"><h5 class="aipm__h5">Why CICOD-AI thinks so</h5><ul class="aipm__why">${a.reasons.map(r => `<li>${esc(r)}</li>`).join('')}</ul>
            <h5 class="aipm__h5" style="margin-top:10px">Repair history (ECMS)</h5>
            <ul class="aipm__hist">${a.history.map(([dt, id, txt]) => `<li><time>${esc(dt)}</time><span><b>${esc(id)}</b> ${esc(txt)}</span></li>`).join('')}</ul></div>
          <div class="aipm__panel"><h5 class="aipm__h5">Cost of acting now vs waiting</h5>
            <div class="aipm__cost"><div class="aipm__cost-pre">Preventive now<b>${naira(a.cost.preventive)}</b></div><div class="aipm__cost-fail">If it breaks<b>${naira(a.cost.breakdown)}</b>+ ${a.cost.downtimeDays} day(s) down</div></div></div>
        </div>
        <div data-task-slot></div>`;
      d.querySelector('[data-close]').addEventListener('click', () => { d.hidden = true; });
      if (withTask || a.level !== 'low') this.renderTask(a, d.querySelector('[data-task-slot]'));
      d.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }

    renderTask(a, slot) {
      const t = a.task;
      slot.innerHTML = `<div class="aipm__task">
        <h5 class="aipm__h5"><span class="ai-badge">CICOD-AI</span> Drafted ECMS repair task</h5>
        <div class="aipm__task-grid">
          <div><span>Queue</span>${esc(t.queue)}</div><div><span>Queue type</span>${esc(t.queueType)}</div>
          <div><span>Priority</span>${esc(t.priority)}</div><div><span>Due</span>${esc(t.due)}</div>
          <div class="aipm__full"><span>Assign to</span>${esc(t.assignee)}</div>
          <div class="aipm__full"><span>Title</span>${esc(t.title)}</div>
        </div>
        <label class="g-label" for="aipm-desc-${esc(a.code)}">Description (edit before scheduling)</label>
        <textarea class="g-textarea" id="aipm-desc-${esc(a.code)}" data-desc>${esc(t.description)}</textarea>
        <div class="aipm__task-actions">
          <button class="g-btn g-btn--primary g-btn--sm" data-schedule type="button">Create task in ECMS</button>
          <button class="g-btn g-btn--sm" data-dismiss type="button">Not needed</button>
          <span class="ai-confidence">${t.queue === 'Facility Management' ? 'Queue "Facility Management" is suggested. Create it in ECMS if it doesn\'t exist.' : ''}</span>
        </div></div>`;
      slot.querySelector('[data-schedule]').addEventListener('click', () => {
        const task = { ...t, description: slot.querySelector('[data-desc]').value };
        this.schedule(a, task);
      });
      slot.querySelector('[data-dismiss]').addEventListener('click', () => {
        this.dismissed.add(a.code);
        feedback(this.res.id, FEATURE, 'dismissed', { code: a.code });
        this.dispatchEvent(new CustomEvent('ai-maintenance-dismiss', { detail: { code: a.code, reason: 'Officer marked not needed' }, bubbles: true }));
        this.render();
      });
    }

    schedule(a, task) {
      this.scheduled.add(a.code);
      feedback(this.res.id, FEATURE, 'scheduled', { code: a.code, edited: task.description !== a.task.description });
      this.dispatchEvent(new CustomEvent('ai-maintenance-schedule', { detail: { code: a.code, task }, bubbles: true }));
      this.render();
    }

    bulk() {
      const highs = this.res.assets.filter(a => a.level === 'high' && !this.scheduled.has(a.code) && !this.dismissed.has(a.code));
      if (!highs.length) return;
      const names = highs.map(a => `${a.name} (due ${a.task.due})`).join('\n');
      if (!window.confirm(`Create ${highs.length} preventive task(s) in ECMS?\n\n${names}`)) return;
      highs.forEach(a => this.schedule(a, a.task));
    }
  }

  customElements.define('ai-maintenance-scheduler', AIMaintenanceScheduler);
})();
