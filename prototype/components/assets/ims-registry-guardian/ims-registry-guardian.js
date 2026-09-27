/* <ai-registry-guardian source="#reg-kpis" repos-source="#reg-repos [data-repo]" cats-source="#reg-cats [data-cat]" store="Central Store">
   Checks the Asset Registry for figures that cannot be true, finds duplicate or junk master data
   (Units of Measure, Asset Types) and forecasts reorder points for the top consumables.
   It never changes the registry itself: the store officer raises a data fix, approves a merge
   or sets a reorder alert, and the host page applies it.
   Attributes:
     source        container whose [data-kpi][data-value] cards hold the KPI figures
     repos-source  selector for the repositories listed in the "Asset value by repository" chart
     cats-source   selector for the categories listed in "Assets by category"
     store         default store for the reorder forecast
   Methods:
     focusCheck(kpi)  opens the KPI checks tab and highlights the check for that card
   Events:
     ai-registry-result  detail: { checks[], master[] }             host shows warning badges
     ai-kpi-flag         detail: { kpi, action:'raise'|'dismiss', ticket? }
     ai-master-merge     detail: { id, kind, action, canonical, members[] }
     ai-reorder-apply    detail: { asset, store, reorderPoint, reorderQty, reorderDate }
   Gateway:
     POST /ims/registry-check   { kpis:{…}, repositoriesListed, categoriesListed, uom[], assetTypes[] }
       -> { model, checks:[{ id, severity, title, observed, expected, why, cause, fix, confidence }], passed[], master:[{ id, kind, title, members[], action, canonical, options[], impact, confidence }] }
     POST /ims/reorder-forecast { store, leadDays, serviceLevel }
       -> { model, store, items:[{ asset, uom, onHand, dailyUse, reorderPoint, reorderQty, reorderDate, daysLeft, currentMin, confidence }] } */
(function () {
  const { request, feedback, esc } = window.AIGateway;

  const fmt = n => Number(n).toLocaleString('en-NG');
  const naira = n => (n >= 1e9 ? `₦${(n / 1e9).toFixed(2)}bn` : n >= 1e6 ? `₦${(n / 1e6).toFixed(1)}m` : `₦${fmt(Math.round(n))}`);
  const TODAY = new Date('2026-09-27T00:00:00');
  const addDays = d => { const x = new Date(TODAY); x.setDate(x.getDate() + d); return x.toISOString().slice(0, 10); };

  // Prototype-only master data: taken from Settings → Manage UOM and Asset Type on the cicod tenant.
  const UOM = [
    { name: 'ream@unit', desc: 'ream@unit', by: 'Faith Egbe', at: '2026-09-15' },
    { name: 'Reams 2', desc: 'unit', by: 'Faith Egbe', at: '2026-09-15' },
    { name: 'Reams 1', desc: 'unit', by: 'Faith Egbe', at: '2026-09-15' },
    { name: '', desc: '', by: 'Faith Egbe', at: '2026-09-15' },
    { name: 'Reams', desc: '', by: 'Adeola Adesina', at: '2026-08-12' },
    { name: 'Kilogram', desc: '', by: 'Oghenemarho Iyonu', at: '2026-07-22' },
    { name: 'Millimeter', desc: 'MM', by: 'Adeola Adesina', at: '2026-07-22' },
    { name: 'Gram', desc: '', by: 'Adeola Adesina', at: '2026-07-22' },
    { name: 'Count', desc: 'Measured by individual item count.', by: 'Chima Elefue', at: '2026-02-16' },
  ];
  const TYPES = [
    { name: 'Testt', desc: '', by: 'Oghenemarho Iyonu', at: '2026-09-24' },
    { name: 'Intagible', desc: 'Asset stationaries', by: 'Faith Egbe', at: '2026-09-16' },
    { name: 'testing', desc: 'teting sheet', by: 'Faith Egbe', at: '2026-09-16' },
    { name: 'Inventory', desc: 'For Inventories', by: 'Chima Elefue', at: '2026-07-27' },
    { name: 'Current', desc: 'Current', by: 'Olajide Durosinmi-Etti', at: '2026-07-26' },
  ];
  const TYPOS = { intagible: 'Intangible', inventry: 'Inventory', stationaries: 'Stationery' };

  function mockCheck(p) {
    const k = p.kpis;
    const checks = [];
    if (k.avgCost > k.totalValue) {
      checks.push({
        id: 'avgCost', severity: 'high', confidence: 0.94,
        title: 'Average asset cost is higher than the total asset value',
        observed: `${naira(k.avgCost)} average vs ${naira(k.totalValue)} total`,
        expected: `No more than ${naira(k.totalValue)}. Spread over ${k.totalAssets} assets it would be about ${naira(k.totalValue / k.totalAssets)}.`,
        why: 'An average can never be larger than the total it is taken from, so at least one of the two cards is wrong.',
        cause: 'Likely cause: the average is taken over the unit-cost field of each asset record without weighting by quantity. Items received by the lot carry the whole lot price in the unit-cost field, which inflates the average.',
        fix: 'Compute average cost as total value ÷ quantity on hand, and reject a unit cost that is more than 5× the last 3 receipts for the same asset code.',
      });
    }
    if (k.available > k.totalAssets * 10) {
      const ratio = Math.round(k.available / k.totalAssets);
      checks.push({
        id: 'available', severity: 'high', confidence: 0.9,
        title: 'Available assets is far larger than total assets',
        observed: `${fmt(k.available)} available vs ${fmt(k.totalAssets)} total (${fmt(ratio)}×)`,
        expected: `Available should be no more than total assets (${fmt(k.totalAssets)}) unless both count the same unit.`,
        why: 'The two cards count different things: Total assets counts asset records, while Available adds up quantities.',
        cause: 'Likely cause: quantity unit mismatch. Consumables are stored in their smallest unit (sheets, grams, millimetres; Manage UOM has Gram, Millimeter and Kilogram), so 1 ream of A4 adds 500 and a cable roll adds its length in mm.',
        fix: 'Convert every quantity to the asset\'s stock UOM before summing, and label the card "units available" if it is meant to be a quantity.',
      });
    }
    const statusSum = k.reserved + k.issued + k.returned + k.damaged + k.obsolete + k.awaitingPutaway + k.pendingInspection;
    if (statusSum > k.totalAssets) {
      checks.push({
        id: 'awaitingPutaway', severity: 'medium', confidence: 0.82,
        title: 'Status cards add up to more than the total',
        observed: `Reserved + Issued + Returned + Damaged + Obsolete + Awaiting put away + Pending inspection = ${fmt(statusSum)}`,
        expected: `At most ${fmt(k.totalAssets)} if each card counts assets`,
        why: `Awaiting put away (${fmt(k.awaitingPutaway)}) alone is ${Math.round(k.awaitingPutaway / k.totalAssets)}× the asset count.`,
        cause: 'Likely cause: status cards count received quantities (lines on Received Asset History), while Total assets counts distinct asset codes.',
        fix: 'Show both "assets" and "units" on each status card, taken from the same query as Total assets.',
      });
    }
    if (p.repositoriesListed > k.repositories) {
      checks.push({
        id: 'repositories', severity: 'medium', confidence: 0.88,
        title: 'Total repositories disagrees with the chart below it',
        observed: `Card says ${k.repositories}; "Asset value by repository" lists ${p.repositoriesListed}`,
        expected: `${p.repositoriesListed} (the chart and the card should use the same filter)`,
        why: 'The card probably counts repository types (Store, Warehouse), not individual stores.',
        cause: 'Likely cause: the card groups by Location Type instead of by repository ID.',
        fix: 'Count distinct repository IDs under the current filters.',
      });
    }
    const passed = [];
    if (p.categoriesListed === k.categories) passed.push(`Total categories (${k.categories}) matches the ${p.categoriesListed} categories in the chart`);
    if (k.damaged + k.obsolete <= k.totalAssets) passed.push('Damaged + Obsolete is within the asset count');
    passed.push('Total asset value is within opening stock value (₦1.98bn) + received value (₦186.4m)');

    // Master data: cluster names that mean the same unit, then look for typos and test records.
    const key = n => n.toLowerCase().replace(/[^a-z]/g, '').replace(/unit$/, '').replace(/s$/, '');
    const groups = {};
    p.uom.filter(u => u.name).forEach(u => { (groups[key(u.name)] = groups[key(u.name)] || []).push(u); });
    const master = [];
    Object.entries(groups).filter(([, g]) => g.length > 1).forEach(([k2, g]) => {
      const base = k2.charAt(0).toUpperCase() + k2.slice(1);
      master.push({
        id: `uom-${k2}`, kind: 'Unit of Measure', action: 'Merge', confidence: 0.95,
        title: `${g.length} units of measure all mean "${base}"`,
        members: g.map(u => `${u.name} · ${u.by} · ${u.at}`), names: g.map(u => u.name),
        canonical: base, options: [base, ...g.map(u => u.name)],
        impact: `Assets that use ${g.map(u => u.name).filter(n => n !== base).join(', ')} are re-pointed to the kept unit. Quantities do not change: all of them are 1 ream (500 sheets).`,
      });
    });
    const blank = p.uom.filter(u => !u.name);
    if (blank.length) master.push({
      id: 'uom-blank', kind: 'Unit of Measure', action: 'Archive', confidence: 0.97,
      title: `${blank.length} unit of measure with no name`, members: blank.map(u => `(blank) · ${u.by} · ${u.at}`), names: [''],
      impact: 'It shows as "--" in dropdowns. Archive it so nobody picks it; no assets use it yet.',
    });
    p.assetTypes.forEach(t => {
      const fix = TYPOS[t.name.toLowerCase()];
      if (fix) master.push({
        id: `type-${t.name.toLowerCase()}`, kind: 'Asset Type', action: 'Rename', confidence: 0.91,
        title: `"${t.name}" looks like a misspelling of "${fix}"`, members: [`${t.name} · "${t.desc || '--'}" · ${t.by} · ${t.at}`], names: [t.name],
        canonical: fix, options: [fix, t.name],
        impact: `The description "${t.desc}" also contradicts the name. Check that it is not meant to be a Stationery category.`,
      });
    });
    const tests = p.assetTypes.filter(t => /^(test|tets)/i.test(t.name) || /test|teting/i.test(t.desc));
    if (tests.length) master.push({
      id: 'type-test', kind: 'Asset Type', action: 'Archive', confidence: 0.86,
      title: `${tests.length} test records in live asset types`, members: tests.map(t => `${t.name} · "${t.desc || '--'}" · ${t.by} · ${t.at}`), names: tests.map(t => t.name),
      impact: `Settings lists ${p.assetTypes.length} asset types but the registry card shows ${k.assetTypes}. Archiving test records makes them agree.`,
    });

    return { model: 'cicod-dq-rules-v2 + llm-explain (sovereign)', checks, passed, master };
  }

  // Prototype-only consumption history per store (daily issues over the last 90 days).
  const ITEMS = [
    { asset: '40 Leaves Exercise Book', uom: 'Count', use: 14, sd: 5, onHand: 420, min: 50 },
    { asset: 'A4 Paper 80gsm', uom: 'Reams', use: 6, sd: 2.5, onHand: 96, min: 20 },
    { asset: '2A Excersise Book', uom: 'Count', use: 3, sd: 1.5, onHand: 23, min: 10 },
    { asset: 'Malt', uom: 'Count', use: 2.2, sd: 1, onHand: 20, min: 10 },
    { asset: 'Soda Water', uom: 'Count', use: 1.6, sd: 0.8, onHand: 15, min: 10 },
  ];
  const STORE_MIX = {
    'Central Store': { f: 1, bev: 1 }, 'Stationary Store': { f: 0.8, bev: 0 }, 'Kano store': { f: 0.5, bev: 0.6 }, 'Market Square': { f: 0.3, bev: 1.8 },
  };

  function mockForecast({ store, leadDays, serviceLevel }) {
    const mix = STORE_MIX[store] || STORE_MIX['Central Store'];
    const z = serviceLevel >= 99 ? 2.33 : serviceLevel >= 95 ? 1.65 : 1.28;
    const items = ITEMS.map(it => {
      const bev = /Malt|Soda/.test(it.asset);
      const f = bev ? mix.bev : mix.f;
      if (!f) return null;
      const use = +(it.use * f).toFixed(1);
      const onHand = Math.round(it.onHand * (bev ? 1 : Math.max(0.4, f)));
      const safety = Math.ceil(z * it.sd * f * Math.sqrt(leadDays));
      const reorderPoint = Math.ceil(use * leadDays) + safety;
      const daysLeft = Math.floor((onHand - reorderPoint) / use);
      return {
        asset: it.asset, uom: it.uom, onHand, dailyUse: use, reorderPoint, safety,
        reorderQty: Math.ceil(use * 30), daysLeft, reorderDate: daysLeft <= 0 ? 'Now' : addDays(daysLeft),
        currentMin: it.min, confidence: +(0.9 - it.sd / it.use / 4).toFixed(2),
      };
    }).filter(Boolean).sort((a, b) => a.daysLeft - b.daysLeft);
    return { model: 'cicod-forecast-ets-v1', store, leadDays, serviceLevel, items };
  }

  const SEV = { high: 'g-chip--bad', medium: 'g-chip--warn', low: 'g-chip--info' };

  class AIRegistryGuardian extends HTMLElement {
    connectedCallback() {
      this.tab = 'kpi';
      this.store = this.getAttribute('store') || 'Central Store';
      this.lead = 14; this.level = 95;
      this.done = {};
      this.innerHTML = `<section class="airg" aria-live="polite">
        <div class="airg__head"><span class="airg__title"><span class="ai-badge">CICOD-AI</span> Registry guardian</span>
          <span class="ai-confidence" data-airg-model>not run yet</span></div>
        <div class="airg__tabs" role="tablist">
          <button type="button" role="tab" data-airg-tab="kpi" class="airg__tab airg__tab--on">KPI checks <b data-airg-n="kpi"></b></button>
          <button type="button" role="tab" data-airg-tab="master" class="airg__tab">Master data <b data-airg-n="master"></b></button>
          <button type="button" role="tab" data-airg-tab="forecast" class="airg__tab">Reorder forecast</button>
        </div>
        <div class="airg__body" data-airg-body>
          <p class="airg__empty">Scan the registry to check the KPI cards for values that cannot be true, find duplicate units and asset types, and forecast when the top consumables need reordering.</p>
          <button class="g-btn g-btn--ai" type="button" data-airg-scan>✦ Scan registry</button>
        </div>
      </section>`;
      this.body = this.querySelector('[data-airg-body]');
      this.querySelector('[data-airg-scan]').addEventListener('click', () => this.scan());
      this.querySelectorAll('[data-airg-tab]').forEach(b => b.addEventListener('click', () => this.show(b.dataset.airgTab)));
    }

    read() {
      const src = document.querySelector(this.getAttribute('source'));
      const kpis = {};
      src?.querySelectorAll('[data-kpi]').forEach(el => { kpis[el.dataset.kpi] = parseFloat(el.dataset.value); });
      return {
        kpis,
        repositoriesListed: document.querySelectorAll(this.getAttribute('repos-source')).length,
        categoriesListed: document.querySelectorAll(this.getAttribute('cats-source')).length,
        uom: UOM, assetTypes: TYPES,
      };
    }

    skeleton() { return '<div class="ai-skeleton" style="width:85%"></div><div class="ai-skeleton" style="width:60%"></div><div class="ai-skeleton" style="width:75%"></div><div class="ai-skeleton" style="width:50%"></div>'; }

    async scan() {
      this.body.innerHTML = this.skeleton();
      this.res = await request('/ims/registry-check', this.read(), { mock: mockCheck, feature: 'ims.registry-guardian' });
      this.querySelector('[data-airg-model]').textContent = this.res.model;
      this.querySelector('[data-airg-n="kpi"]').textContent = this.res.checks.length;
      this.querySelector('[data-airg-n="master"]').textContent = this.res.master.length;
      this.dispatchEvent(new CustomEvent('ai-registry-result', { detail: { checks: this.res.checks, master: this.res.master }, bubbles: true }));
      this.show(this.tab);
    }

    show(tab) {
      this.tab = tab;
      this.querySelectorAll('[data-airg-tab]').forEach(b => b.classList.toggle('airg__tab--on', b.dataset.airgTab === tab));
      if (!this.res) return;
      if (tab === 'kpi') this.renderChecks();
      else if (tab === 'master') this.renderMaster();
      else this.renderForecast();
    }

    focusCheck(kpi) {
      if (!this.res) return;
      this.show('kpi');
      const el = this.querySelector(`[data-airg-check="${kpi}"]`);
      if (!el) return;
      el.classList.remove('airg__card--focus'); void el.offsetWidth; el.classList.add('airg__card--focus');
      el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }

    renderChecks() {
      const r = this.res;
      this.body.innerHTML = `${r.checks.map(c => `<article class="airg__card" data-airg-check="${esc(c.id)}">
          <div class="airg__card-head"><span class="g-chip ${SEV[c.severity]}">${esc(c.severity)}</span><b>${esc(c.title)}</b>
            <span class="ai-confidence">${Math.round(c.confidence * 100)}% sure</span></div>
          <dl class="airg__dl"><dt>Shown</dt><dd>${esc(c.observed)}</dd><dt>Expected</dt><dd>${esc(c.expected)}</dd></dl>
          <p class="airg__why">${esc(c.why)}</p>
          <p class="airg__cause"><b>Root cause.</b> ${esc(c.cause)}</p>
          <p class="airg__fix"><b>Suggested fix.</b> ${esc(c.fix)}</p>
          <div class="airg__row-actions">${this.done[c.id] ? `<span class="airg__done">${esc(this.done[c.id])}</span>` : `
            <button class="g-btn g-btn--ai g-btn--sm" type="button" data-airg-raise="${esc(c.id)}">Raise data fix</button>
            <button class="g-btn g-btn--sm" type="button" data-airg-dismiss="${esc(c.id)}">Not an issue</button>`}</div>
        </article>`).join('') || '<p class="airg__empty">No impossible values found.</p>'}
        <div class="airg__passed"><h5>Checks that passed</h5><ul>${r.passed.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>`;
      this.body.querySelectorAll('[data-airg-raise]').forEach(b => b.addEventListener('click', () => {
        const id = b.dataset.airgRaise; const ticket = `#${17600 + Object.keys(this.done).length + 1}`;
        this.done[id] = `Data fix raised as ECMS task ${ticket} (IT Support) ✓`;
        feedback(r.id, 'ims.registry-guardian', 'accepted', { kpi: id });
        this.dispatchEvent(new CustomEvent('ai-kpi-flag', { detail: { kpi: id, action: 'raise', ticket }, bubbles: true }));
        this.renderChecks();
      }));
      this.body.querySelectorAll('[data-airg-dismiss]').forEach(b => b.addEventListener('click', () => {
        const id = b.dataset.airgDismiss;
        this.done[id] = 'Marked as not an issue. The rule will learn from this.';
        feedback(r.id, 'ims.registry-guardian', 'rejected', { kpi: id });
        this.dispatchEvent(new CustomEvent('ai-kpi-flag', { detail: { kpi: id, action: 'dismiss' }, bubbles: true }));
        this.renderChecks();
      }));
    }

    renderMaster() {
      const r = this.res;
      this.body.innerHTML = r.master.map(m => `<article class="airg__card" data-airg-m="${esc(m.id)}">
          <div class="airg__card-head"><span class="g-chip g-chip--ai">${esc(m.kind)}</span><b>${esc(m.title)}</b>
            <span class="ai-confidence">${Math.round(m.confidence * 100)}% sure</span></div>
          <ul class="airg__members">${m.members.map(x => `<li>${esc(x)}</li>`).join('')}</ul>
          <p class="airg__why">${esc(m.impact)}</p>
          <div class="airg__row-actions">${this.done[m.id] ? `<span class="airg__done">${esc(this.done[m.id])}</span>` : `
            ${m.options ? `<label class="airg__keep">${m.action === 'Rename' ? 'Rename to' : 'Keep'} <select class="g-select" data-airg-canon>${[...new Set(m.options)].map(o => `<option>${esc(o)}</option>`).join('')}</select></label>` : ''}
            <button class="g-btn g-btn--ai g-btn--sm" type="button" data-airg-merge>${esc(m.action)}</button>
            <button class="g-btn g-btn--sm" type="button" data-airg-keep>Keep separate</button>`}</div>
        </article>`).join('') || '<p class="airg__empty">No duplicates found.</p>';
      this.body.querySelectorAll('[data-airg-m]').forEach(card => {
        const m = r.master.find(x => x.id === card.dataset.airgM);
        card.querySelector('[data-airg-merge]')?.addEventListener('click', () => {
          const canonical = card.querySelector('[data-airg-canon]')?.value || '';
          const edited = m.canonical && canonical !== m.canonical;
          this.done[m.id] = `${m.action} queued${canonical ? ` → "${canonical}"` : ''} ✓ (needs admin approval in Settings)`;
          feedback(r.id, 'ims.registry-guardian', edited ? 'edited' : 'accepted', { proposal: m.id, canonical });
          this.dispatchEvent(new CustomEvent('ai-master-merge', { detail: { id: m.id, kind: m.kind, action: m.action, canonical, members: m.names }, bubbles: true }));
          this.renderMaster();
        });
        card.querySelector('[data-airg-keep]')?.addEventListener('click', () => {
          this.done[m.id] = 'Kept separate. This pair will not be suggested again.';
          feedback(r.id, 'ims.registry-guardian', 'rejected', { proposal: m.id });
          this.renderMaster();
        });
      });
    }

    async renderForecast() {
      const stores = Object.keys(STORE_MIX);
      this.body.innerHTML = `<div class="airg__controls">
          <label>Store <select class="g-select" data-airg-store>${stores.map(s => `<option ${s === this.store ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select></label>
          <label>Supplier lead time (days) <input class="g-input" type="number" min="1" max="90" value="${this.lead}" data-airg-lead></label>
          <label>Service level <select class="g-select" data-airg-level>${[90, 95, 99].map(v => `<option value="${v}" ${v === this.level ? 'selected' : ''}>${v}%</option>`).join('')}</select></label>
        </div><div data-airg-fc>${this.skeleton()}</div>`;
      const rerun = () => { this.store = this.body.querySelector('[data-airg-store]').value; this.lead = Math.max(1, parseInt(this.body.querySelector('[data-airg-lead]').value, 10) || 14); this.level = parseInt(this.body.querySelector('[data-airg-level]').value, 10); this.loadForecast(); };
      this.body.querySelector('[data-airg-store]').addEventListener('change', rerun);
      this.body.querySelector('[data-airg-level]').addEventListener('change', rerun);
      let t; this.body.querySelector('[data-airg-lead]').addEventListener('input', () => { clearTimeout(t); t = setTimeout(rerun, 600); });
      this.loadForecast();
    }

    async loadForecast() {
      const box = this.body.querySelector('[data-airg-fc]');
      if (!box) return;
      box.innerHTML = this.skeleton();
      const f = await request('/ims/reorder-forecast', { store: this.store, leadDays: this.lead, serviceLevel: this.level }, { mock: mockForecast, feature: 'ims.reorder-forecast' });
      if (this.tab !== 'forecast' || !this.body.contains(box)) return;
      box.innerHTML = `<p class="airg__note">${esc(f.store)} · ${f.leadDays}-day lead time · ${f.serviceLevel}% service level · <span class="ai-confidence">${esc(f.model)}</span></p>
        ${f.items.map((it, i) => {
          const key = `fc-${f.store}-${it.asset}`;
          const urgent = it.daysLeft <= 7;
          return `<article class="airg__fc ${urgent ? 'airg__fc--urgent' : ''}" data-airg-i="${i}">
            <div class="airg__fc-name"><b>${esc(it.asset)}</b><span>${fmt(it.onHand)} ${esc(it.uom)} on hand · uses ~${esc(it.dailyUse)}/day</span></div>
            <div class="airg__fc-num"><span>Reorder point</span><input class="g-input" type="number" value="${it.reorderPoint}" data-airg-rop aria-label="Reorder point for ${esc(it.asset)}"><small>today: fixed min ${it.currentMin}</small></div>
            <div class="airg__fc-num"><span>Reorder by</span><b class="${urgent ? 'airg__bad' : ''}">${esc(it.reorderDate)}</b><small>${it.daysLeft <= 0 ? 'below reorder point' : `in ${it.daysLeft} days`}</small></div>
            <div class="airg__fc-num"><span>Order qty</span><b>${fmt(it.reorderQty)}</b><small>30 days cover</small></div>
            <div class="airg__row-actions">${this.done[key] ? `<span class="airg__done">${esc(this.done[key])}</span>` : `
              <button class="g-btn g-btn--ai g-btn--sm" type="button" data-airg-set>Set reorder alert</button>
              <button class="g-btn g-btn--sm" type="button" data-airg-skip>Dismiss</button>`}</div>
          </article>`;
        }).join('')}
        <p class="airg__note">Reorder point = daily use × lead time + safety stock. It replaces the fixed "Minimum Stock" email alert.</p>`;
      box.querySelectorAll('[data-airg-i]').forEach(row => {
        const it = f.items[+row.dataset.airgI];
        const key = `fc-${f.store}-${it.asset}`;
        row.querySelector('[data-airg-set]')?.addEventListener('click', () => {
          const rop = parseInt(row.querySelector('[data-airg-rop]').value, 10) || it.reorderPoint;
          this.done[key] = `Reorder alert set at ${rop} ✓`;
          feedback(f.id, 'ims.reorder-forecast', rop === it.reorderPoint ? 'accepted' : 'edited', { asset: it.asset, reorderPoint: rop });
          this.dispatchEvent(new CustomEvent('ai-reorder-apply', { detail: { asset: it.asset, store: f.store, reorderPoint: rop, reorderQty: it.reorderQty, reorderDate: it.reorderDate }, bubbles: true }));
          this.loadForecast();
        });
        row.querySelector('[data-airg-skip]')?.addEventListener('click', () => {
          this.done[key] = 'Dismissed';
          feedback(f.id, 'ims.reorder-forecast', 'rejected', { asset: it.asset });
          this.loadForecast();
        });
      });
    }
  }

  customElements.define('ai-registry-guardian', AIRegistryGuardian);
})();
