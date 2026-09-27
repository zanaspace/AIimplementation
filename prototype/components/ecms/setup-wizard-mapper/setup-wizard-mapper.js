/* <ai-org-mapper tenant-roles="192">
   CICOD-AI mapper for ECMS → Settings → Setup Wizard. The admin uploads any nominal roll, staff list
   or org chart (Excel/CSV/PDF), however messy. The mapper:
     - maps the file's columns to CICOD fields (Full name, IPPIS, Role, Department, Grade level, Line manager)
     - normalises department spellings ("Fin & Accts", "FINANCE AND ACCOUNTS" → Finance & Accounts)
     - clusters duplicate roles across the roll AND the tenant's existing 192 roles
       (e.g. the "Assistant Director Accounts Admin" variants) and proposes merges
     - infers each person's line manager (from a "Reports To" column, or from grade level within the department)
     - gives a confidence per row, so the admin can Import the good rows and Fix the rest.
   Nothing is written until the admin clicks Import; the host page performs the import.
   Attributes:
     tenant-roles   current number of roles in the tenant (default 192)
   Events (bubbles):
     ai-org-import  detail: { departments[], roles[], merges[], users[], counts }
     ai-org-result  detail: gateway response
   Gateway: POST /ecms/setup/map-org { fileName, rows[][] (header first), tenant:{ roles[], departments[] } }
     -> { model, columns:[{source,sample,field,confidence}], departments:[{name,variants[],existing}],
          clusters:[{canonical,members:[{name,source}],confidence}], users:[{name,ippis,department,role,gl,manager,managerSource,confidence}], counts } */
(function () {
  const { request, feedback, esc } = window.AIGateway;

  // Prototype-only tenant knowledge: role names as they appear in cicod ECMS → Roles.
  const TENANT_ROLES = ['Admin Officer', 'Assistant Chief Manager', 'Assistant Chief Program Analyst', 'Assistant Chief Store Officer', 'Assistant Director Accounts Admin',
    'Assistant Director Accounts Admin./Fiscal & Financial Reporting', 'Assistant Director Asset Management', 'Assistant Director Budgets', 'Assistant Director Central Pay Office',
    'Assistant Director Checking', 'Assistant Director Recurrent Expenditure', 'Assistant Director Revenue', 'Assistant Director Service Delivery', 'Assistant Director Technical',
    'Assistant Director, Rehabilitation Services', 'Assistant Director, Special', 'Assistant Director, Special Needs', 'Assistant Director, Technical Support',
    'Assistant Director, Technical Support Services', 'Assistant Director, Vocational'];
  const TENANT_CLUSTERS = [
    { canonical: 'Assistant Director Accounts Admin', members: ['Assistant Director Accounts Admin', 'Assistant Director Accounts Admin./Fiscal & Financial Reporting'] },
    { canonical: 'Assistant Director, Technical Support Services', members: ['Assistant Director Technical', 'Assistant Director, Technical Support', 'Assistant Director, Technical Support Services'] },
    { canonical: 'Assistant Director, Special Needs', members: ['Assistant Director, Special', 'Assistant Director, Special Needs'] },
    { canonical: 'Admin Officer', members: ['Admin Officer'] },
    { canonical: 'Assistant Chief Program Analyst', members: ['Assistant Chief Program Analyst'] },
    { canonical: 'Assistant Chief Store Officer', members: ['Assistant Chief Store Officer'] },
  ];
  const DEPTS = [
    { name: 'Finance & Accounts', k: /fin|acct|account/i, existing: true },
    { name: 'Human Resource Management', k: /\bhr\b|human|admin|personnel/i, existing: false },
    { name: 'IT Support', k: /i\.?\s?c\.?\s?t|information|\bit\b|technology/i, existing: true },
    { name: 'Stores & Supplies', k: /store|suppl/i, existing: false },
    { name: 'Procurement', k: /procure/i, existing: false },
    { name: 'Works & Maintenance', k: /works|mainten/i, existing: false },
  ];
  const COLS = [
    { k: /^(s\/?n|sn|no\.?|#)$/i, field: 'Ignore (row number)', c: 0.99 },
    { k: /name/i, field: 'User · Full name', c: 0.97 },
    { k: /ippis|staff ?(no|id|number)|psn|file ?no/i, field: 'User · Staff ID (IPPIS)', c: 0.95 },
    { k: /desig|rank|post|role|position|title|cadre/i, field: 'Role', c: 0.9 },
    { k: /dept|department|unit|directorate|division/i, field: 'Department', c: 0.93 },
    { k: /^gl$|grade|level|salary/i, field: 'User · Grade level', c: 0.88 },
    { k: /report|supervisor|line ?manager|manager/i, field: 'User · Line manager', c: 0.91 },
    { k: /mail/i, field: 'User · Email', c: 0.96 },
    { k: /phone|gsm|mobile/i, field: 'User · Phone (redacted in CICOD-AI)', c: 0.94 },
  ];
  const FIELDS = [...new Set(COLS.map(c => c.field)), 'Ignore'];

  const SAMPLE = `S/N,Staff Name,IPPIS,Desig.,Dept/Unit,GL,Reports To
1,OKONKWO Adaeze N., 218734,Asst. Dir. Accounts (Admin),Fin & Accts,15,
2,Musa Ibrahim,219011,Assistant Director Accounts Admin./Fiscal & Financial Reporting,FINANCE AND ACCOUNTS,15,Okonkwo Adaeze
3,Bello Tunde,220145,Admin. Officer,Admin & HR,08,
4,Nkechi Eze,220388,Administrative Officer II,Admin/HR,08,Bello Tunde
5,Yusuf Garba,221002,Asst Director Technical Support Services,ICT Unit,15,
6,Funmi Adebayo,221117,"Assistant Director, Technical Support",I.C.T,14,
7,CHIDI Obi,222310,Chief Store Officer,Stores,13,
8,Aisha Lawal,222455,Asst. Chief Store Officer,STORES & SUPPLIES,12,Chidi Obi
9,Emeka Nwosu,223001,Director Finance,Finance & Accounts,17,
10,Hauwa Sani,223190,Programme Analyst,ICT,10,
11,Ibrahim Danladi,223344,Asst. Chief Programme Analyst,I.C.T Unit,12,
12,Grace Okoro,223344,Director (Admin & HR),Human Resources,17,`;

  /* ---------- helpers ---------- */
  function parseCsv(text) {
    return text.trim().split(/\r?\n/).filter(l => l.trim()).map(line => {
      const out = []; let cur = ''; let q = false;
      for (const ch of line) { if (ch === '"') q = !q; else if ((ch === ',' || ch === '\t') && !q) { out.push(cur.trim()); cur = ''; } else cur += ch; }
      out.push(cur.trim()); return out;
    });
  }
  const ABBR = [[/\basst\.?\b/gi, 'Assistant'], [/\bdir\.?\b/gi, 'Director'], [/\badmin\.(?=\s|$)/gi, 'Admin'], [/\badministrative\b/gi, 'Admin'], [/\bprogramme\b/gi, 'Program'], [/\bacct?s\b/gi, 'Accounts'], [/\bmgr\b/gi, 'Manager'], [/\bchf\b/gi, 'Chief']];
  const expand = s => ABBR.reduce((t, [re, r]) => t.replace(re, r), s);
  const tokens = s => expand(s).toLowerCase().replace(/\b(i{1,3}|iv)\b/g, '').replace(/[^a-z&\s]/g, ' ').split(/\s+/).filter(w => w && !/^(of|the|and|&)$/.test(w));
  const RANK = ['assistant', 'deputy', 'chief', 'principal', 'senior', 'director'];
  const jaccard = (a, b) => { const A = new Set(tokens(a)), B = new Set(tokens(b)); if (RANK.some(w => A.has(w) !== B.has(w))) return 0; const i = [...A].filter(x => B.has(x)).length; return i / (A.size + B.size - i || 1); };
  const cleanRole = s => expand(s).replace(/\(([^)]+)\)/g, '$1').replace(/\s+(I{1,3}|IV)$/i, '').replace(/\s{2,}/g, ' ').trim();
  const cleanName = s => {
    const parts = s.replace(/\s+/g, ' ').trim().split(' ');
    const titled = parts.map(p => p.length > 2 && p === p.toUpperCase() ? p[0] + p.slice(1).toLowerCase() : p);
    if (parts[0] === parts[0].toUpperCase() && parts[0].length > 2 && parts.length > 2) titled.push(titled.shift()); // "OKONKWO Adaeze" → "Adaeze Okonkwo"
    return titled.join(' ');
  };

  function mockMap({ rows = [] }) {
    const [header = [], ...data] = rows;
    const columns = header.map((h, i) => {
      const c = COLS.find(x => x.k.test(h.trim()));
      return { source: h, sample: (data[0] || [])[i] || '', field: c ? c.field : 'Ignore', confidence: c ? c.c : 0.4 };
    });
    const col = f => columns.findIndex(c => c.field === f);
    const iName = col('User · Full name'), iId = col('User · Staff ID (IPPIS)'), iRole = col('Role'), iDept = col('Department'), iGl = col('User · Grade level'), iMgr = col('User · Line manager');
    const get = (r, i) => (i >= 0 ? (r[i] || '').trim() : '');

    // Departments
    const deptMap = {}; const departments = [];
    data.forEach(r => {
      const raw = get(r, iDept); if (!raw) return;
      const d = DEPTS.find(x => x.k.test(raw)) || { name: raw.replace(/\b\w/g, c => c.toUpperCase()), existing: false };
      deptMap[raw] = d.name;
      let entry = departments.find(x => x.name === d.name);
      if (!entry) departments.push(entry = { name: d.name, variants: [], existing: !!d.existing, confidence: DEPTS.includes(d) ? 0.92 : 0.6 });
      if (!entry.variants.includes(raw)) entry.variants.push(raw);
    });

    // Role clusters: start from the tenant's own duplicate clusters, then attach the roll's titles
    const clusters = TENANT_CLUSTERS.map(c => ({ canonical: c.canonical, members: c.members.map(m => ({ name: m, source: 'tenant' })), confidence: 0.9 }));
    const roleMap = {};
    data.forEach(r => {
      const raw = get(r, iRole); if (!raw) return;
      const cleaned = cleanRole(raw);
      let best = null, score = 0;
      clusters.forEach(c => c.members.forEach(m => { const s = jaccard(cleaned, m.name); if (s > score) { score = s; best = c; } }));
      if (!best || score < 0.6) {
        const t = TENANT_ROLES.map(n => [n, jaccard(cleaned, n)]).sort((a, b) => b[1] - a[1])[0];
        if (t && t[1] >= 0.75) { best = { canonical: t[0], members: [{ name: t[0], source: 'tenant' }], confidence: t[1] }; clusters.push(best); score = t[1]; }
        else { best = clusters.find(c => c.canonical === cleaned) || null; if (!best) { best = { canonical: cleaned, members: [], confidence: 0.7, isNew: true }; clusters.push(best); } score = 0.7; }
      }
      if (!best.members.some(m => m.name === raw)) best.members.push({ name: raw, source: 'roll' });
      roleMap[raw] = { role: best.canonical, confidence: Math.max(0.55, Math.min(0.97, score + 0.2)), isNew: !!best.isNew };
    });
    const shown = clusters.filter(c => c.members.length > 1);

    // Users + line managers
    const users = data.map(r => ({
      name: cleanName(get(r, iName)), rawName: get(r, iName), ippis: get(r, iId).replace(/\s/g, ''),
      department: deptMap[get(r, iDept)] || '(unmapped)', rawDept: get(r, iDept),
      role: (roleMap[get(r, iRole)] || {}).role || '(no role)', rawRole: get(r, iRole), roleConf: (roleMap[get(r, iRole)] || {}).confidence || 0.3,
      gl: parseInt(get(r, iGl), 10) || null, given: get(r, iMgr),
    }));
    const ids = {}; users.forEach(u => { if (u.ippis) ids[u.ippis] = (ids[u.ippis] || 0) + 1; });
    users.forEach(u => {
      const issues = [];
      if (u.given) {
        const m = users.find(x => x !== u && jaccard(x.name, u.given) >= 0.5);
        u.manager = m ? m.name : u.given; u.managerSource = m ? 'from "Reports To"' : '"Reports To" name not found in roll'; u.mgrConf = m ? 0.95 : 0.5;
      } else {
        const higher = users.filter(x => x !== u && x.department === u.department && x.gl && u.gl && x.gl > u.gl).sort((a, b) => a.gl - b.gl);
        if (higher.length) {
          const tie = higher.filter(x => x.gl === higher[0].gl).length > 1;
          u.manager = higher[0].name; u.managerSource = `inferred: next grade up in ${u.department} (GL ${String(higher[0].gl).padStart(2, '0')})`; u.mgrConf = tie ? 0.62 : 0.84;
        } else { u.manager = '—'; u.managerSource = `most senior in ${u.department}: head of department`; u.mgrConf = u.gl >= 15 ? 0.85 : 0.55; }
      }
      if (u.ippis && ids[u.ippis] > 1) issues.push(`IPPIS ${u.ippis} appears ${ids[u.ippis]} times`);
      if (!/^\d{6,7}$/.test(u.ippis)) issues.push('IPPIS should be 6–7 digits');
      if (u.department === '(unmapped)') issues.push('No department');
      if (u.mgrConf < 0.7) issues.push('Line manager uncertain');
      if (u.roleConf < 0.7) issues.push('Role match uncertain');
      u.issues = issues;
      u.confidence = Math.min(u.roleConf, u.mgrConf, issues.some(i => /IPPIS/.test(i)) ? 0.5 : 1, u.department === '(unmapped)' ? 0.4 : 0.95);
    });

    const tenantMerged = shown.reduce((n, c) => n + Math.max(0, c.members.filter(m => m.source === 'tenant').length - 1), 0);
    const newRoles = [...new Set(Object.values(roleMap).filter(r => r.isNew).map(r => r.role))];
    return {
      model: 'cicod-orgmap-v1 (fuzzy match + LLM normalisation)',
      columns, departments, clusters: shown, users,
      counts: {
        rows: data.length,
        deptBefore: new Set(data.map(r => get(r, iDept)).filter(Boolean)).size, deptAfter: departments.length,
        roleBefore: new Set(data.map(r => get(r, iRole)).filter(Boolean)).size, roleAfter: new Set(Object.values(roleMap).map(r => r.role)).size,
        managersGiven: users.filter(u => u.given).length, managersInferred: users.filter(u => !u.given && u.manager !== '—').length,
        tenantMerged, newRoles: newRoles.length, newRoleNames: newRoles,
      },
    };
  }

  const pct = c => Math.round(c * 100) + '%';
  const barClass = c => (c >= 0.85 ? '' : c >= 0.7 ? 'aiom__bar--mid' : 'aiom__bar--low');

  class AIOrgMapper extends HTMLElement {
    connectedCallback() {
      this.tenantRoles = +(this.getAttribute('tenant-roles') || 192);
      this.innerHTML = `<section class="aiom" aria-live="polite">
        <div class="aiom__head"><span class="aiom__title"><span class="ai-badge">CICOD-AI</span> Import with CICOD-AI mapper</span><span class="ai-confidence">Nominal roll · staff list · org chart</span></div>
        <div class="aiom__body">
          <label class="aiom__drop"><input type="file" accept=".csv,.txt,.xlsx,.xls,.pdf" data-file hidden><span>⤒ Drop a nominal roll (Excel, CSV or PDF) or click to choose</span><span class="aiom__muted">Any column names or order. Messy spellings are fine.</span></label>
          <div class="aiom__row"><button class="g-btn g-btn--ai g-btn--sm" data-sample type="button">Use sample nominal roll</button><span class="aiom__muted">Nominal_Roll_Sept2026.xlsx · 12 staff</span></div>
          <div data-src hidden>
            <label class="g-label" for="aiom-csv">File contents (you can edit this to test)</label>
            <textarea class="g-textarea aiom__csv" id="aiom-csv" rows="8" spellcheck="false"></textarea>
            <div class="aiom__row"><button class="g-btn g-btn--ai g-btn--sm" data-run type="button">✦ Map to CICOD</button><span class="aiom__muted" data-fname></span></div>
          </div>
          <div data-out></div>
        </div>
      </section>`;
      this.querySelector('[data-sample]').addEventListener('click', () => this.load('Nominal_Roll_Sept2026.xlsx', SAMPLE, true));
      this.querySelector('[data-file]').addEventListener('change', e => {
        const f = e.target.files[0]; if (!f) return;
        if (/\.(csv|txt)$/i.test(f.name)) { const r = new FileReader(); r.onload = () => this.load(f.name, String(r.result), true); r.readAsText(f); }
        else this.load(f.name + ' (prototype reads the sample instead)', SAMPLE, true);
      });
      this.querySelector('[data-run]').addEventListener('click', () => this.run());
    }

    load(name, text, auto) {
      this.fileName = name;
      this.querySelector('[data-src]').hidden = false;
      this.querySelector('.aiom__csv').value = text;
      this.querySelector('[data-fname]').textContent = name;
      if (auto) this.run();
    }

    async run() {
      const rows = parseCsv(this.querySelector('.aiom__csv').value);
      const out = this.querySelector('[data-out]');
      if (rows.length < 2) { out.innerHTML = '<p class="aiom__muted">The file needs a header row and at least one staff row.</p>'; return; }
      out.innerHTML = '<div class="aiom__res"><p class="aiom__muted">Reading columns, normalising departments and roles, inferring line managers…</p><div class="ai-skeleton" style="width:50%"></div><div class="ai-skeleton" style="width:95%;height:40px"></div><div class="ai-skeleton" style="width:80%"></div><div class="ai-skeleton" style="width:65%"></div></div>';
      const res = await request('/ecms/setup/map-org', { fileName: this.fileName, rows, tenant: { roles: this.tenantRoles } }, { mock: mockMap, feature: 'ecms.setup-wizard-mapper', delay: 1300 });
      this.res = res; this.onlyFix = false;
      res.clusters.forEach(c => { c.merge = true; });
      this.render();
      this.dispatchEvent(new CustomEvent('ai-org-result', { detail: res, bubbles: true }));
    }

    render() {
      const r = this.res, k = r.counts;
      const needFix = r.users.filter(u => u.confidence < 0.8 && !u.fixed);
      const tenantAfter = this.tenantRoles - r.clusters.filter(c => c.merge).reduce((n, c) => n + Math.max(0, c.members.filter(m => m.source === 'tenant').length - 1), 0);
      const users = r.users.map((u, i) => ({ u, i })).filter(({ u }) => !this.onlyFix || (u.confidence < 0.8 && !u.fixed));
      const allRoles = [...new Set([...r.clusters.map(c => c.canonical), ...r.users.map(u => u.role)])];
      this.querySelector('[data-out]').innerHTML = `<div class="aiom__res">
        <div class="aiom__res-head"><b>Mapping ready · ${esc(this.fileName)}</b><span class="ai-confidence">${esc(r.model)}</span></div>
        <div class="aiom__counts">
          <div><b>${k.rows}</b><span>staff rows</span></div>
          <div><b>${k.deptBefore} → ${k.deptAfter}</b><span>departments (spellings → normalised)</span></div>
          <div><b>${k.roleBefore} → ${k.roleAfter}</b><span>role titles in file → CICOD roles</span></div>
          <div><b>${this.tenantRoles} → ${tenantAfter}</b><span>tenant roles after merges · +${k.newRoles} new from file</span></div>
          <div><b>${k.managersGiven} + ${k.managersInferred}</b><span>line managers given + inferred</span></div>
        </div>

        <h5>1 · Column mapping</h5>
        <div class="g-table-wrap"><table class="g-table aiom__table"><thead><tr><th>Column in file</th><th>Sample value</th><th>CICOD field</th><th>Confidence</th></tr></thead><tbody>
          ${r.columns.map((c, i) => `<tr><td><b>${esc(c.source)}</b></td><td class="aiom__muted">${esc(c.sample) || '—'}</td><td><select class="g-select" data-col="${i}">${FIELDS.map(f => `<option${f === c.field ? ' selected' : ''}>${esc(f)}</option>`).join('')}</select></td><td>${this.bar(c.confidence)}</td></tr>`).join('')}
        </tbody></table></div>

        <div class="aiom__two">
          <div><h5>2 · Departments normalised</h5><ul class="aiom__list">${r.departments.map(d => `<li><b>${esc(d.name)}</b> <span class="g-chip ${d.existing ? 'g-chip--ok' : 'g-chip--ai'}">${d.existing ? 'existing' : 'new'}</span><div class="aiom__variants">${d.variants.map(v => `<span>${esc(v)}</span>`).join('')}</div></li>`).join('')}</ul></div>
          <div><h5>3 · Duplicate role clusters (${r.clusters.length})</h5><ul class="aiom__list">${r.clusters.map((c, i) => `<li><label class="aiom__merge"><input type="checkbox" data-merge="${i}" ${c.merge ? 'checked' : ''}> Merge into <b>${esc(c.canonical)}</b></label>
            <div class="aiom__variants">${c.members.map(m => `<span class="${m.source === 'tenant' ? 'aiom__v--tenant' : ''}" title="${m.source === 'tenant' ? 'Existing tenant role' : 'From this file'}">${esc(m.name)}</span>`).join('')}</div></li>`).join('')}</ul>
            <p class="aiom__muted">Grey = already a role in this tenant · white = from the file. Users on merged roles keep their permissions.</p></div>
        </div>

        <h5>4 · Users, roles and line managers <button class="g-btn g-btn--ghost g-btn--sm" data-only-fix type="button">${this.onlyFix ? 'Show all rows' : `Show ${needFix.length} rows to fix`}</button></h5>
        <div class="g-table-wrap"><table class="g-table aiom__table aiom__users"><thead><tr><th>Name</th><th>IPPIS</th><th>Department</th><th>Role</th><th>GL</th><th>Line manager</th><th>Confidence</th><th></th></tr></thead><tbody>
          ${users.map(({ u, i }) => this.userRow(u, i, allRoles)).join('')}
        </tbody></table></div>

        <div class="aiom__row aiom__actions">
          <button class="g-btn g-btn--ai g-btn--sm" data-import type="button">Import ${r.users.length - needFix.length} ready rows</button>
          <button class="g-btn g-btn--sm" data-fixall type="button" ${needFix.length ? '' : 'disabled'}>Fix ${needFix.length} rows</button>
          <button class="g-btn g-btn--ghost g-btn--sm" data-discard type="button">Discard</button>
          <span class="aiom__muted aiom__mode">Rows under 80% are held back until fixed</span>
        </div>
      </div>`;
      this.wire(allRoles);
    }

    bar(c) { return `<span class="aiom__conf"><span class="aiom__bar ${barClass(c)}"><i style="width:${Math.round(c * 100)}%"></i></span>${pct(c)}</span>`; }

    userRow(u, i, roles) {
      const ok = u.confidence >= 0.8 || u.fixed;
      if (this.editing === i) {
        const names = ['—', ...this.res.users.filter(x => x !== u).map(x => x.name)];
        return `<tr class="aiom__editing" data-u="${i}"><td><b>${esc(u.name)}</b></td><td><input class="g-input" data-ed="ippis" value="${esc(u.ippis)}"></td>
          <td>${esc(u.department)}</td><td><select class="g-select" data-ed="role">${roles.map(r => `<option${r === u.role ? ' selected' : ''}>${esc(r)}</option>`).join('')}</select></td><td>${u.gl ?? '—'}</td>
          <td><select class="g-select" data-ed="manager">${names.map(n => `<option${n === u.manager ? ' selected' : ''}>${esc(n)}</option>`).join('')}</select></td>
          <td colspan="2"><button class="g-btn g-btn--primary g-btn--sm" data-save="${i}" type="button">Save</button></td></tr>`;
      }
      return `<tr data-u="${i}" class="${ok ? '' : 'aiom__low'}">
        <td><b>${esc(u.name)}</b>${u.rawName !== u.name ? `<div class="aiom__raw">${esc(u.rawName)}</div>` : ''}</td>
        <td>${esc(u.ippis)}</td>
        <td>${esc(u.department)}${u.rawDept !== u.department ? `<div class="aiom__raw">${esc(u.rawDept)}</div>` : ''}</td>
        <td>${esc(u.role)}${u.rawRole !== u.role ? `<div class="aiom__raw">${esc(u.rawRole)}</div>` : ''}</td>
        <td>${u.gl ? String(u.gl).padStart(2, '0') : '—'}</td>
        <td>${esc(u.manager)}<div class="aiom__raw">${esc(u.managerSource)}</div></td>
        <td>${this.bar(u.fixed ? 1 : u.confidence)}${u.issues.length && !u.fixed ? `<div class="aiom__issues">${u.issues.map(x => esc(x)).join('<br>')}</div>` : ''}</td>
        <td>${u.fixed ? '<span class="g-chip g-chip--ok">Fixed</span>' : ok ? '<span class="g-chip g-chip--ok">Ready</span>' : `<button class="g-btn g-btn--sm" data-fix="${i}" type="button">Fix</button>`}</td></tr>`;
    }

    wire() {
      const r = this.res;
      const q = s => this.querySelectorAll(s);
      q('[data-col]').forEach(s => s.addEventListener('change', () => { r.columns[+s.dataset.col].field = s.value; feedback(r.id, 'ecms.setup-wizard-mapper', 'column-edited', { column: r.columns[+s.dataset.col].source }); }));
      q('[data-merge]').forEach(c => c.addEventListener('change', () => { r.clusters[+c.dataset.merge].merge = c.checked; feedback(r.id, 'ecms.setup-wizard-mapper', c.checked ? 'merge-accepted' : 'merge-rejected'); this.render(); }));
      q('[data-fix]').forEach(b => b.addEventListener('click', () => { this.editing = +b.dataset.fix; this.render(); }));
      q('[data-save]').forEach(b => b.addEventListener('click', () => {
        const u = r.users[+b.dataset.save], row = b.closest('tr');
        u.ippis = row.querySelector('[data-ed=ippis]').value.trim(); u.role = row.querySelector('[data-ed=role]').value; u.manager = row.querySelector('[data-ed=manager]').value;
        u.managerSource = 'set by admin'; u.fixed = true; this.editing = null;
        feedback(r.id, 'ecms.setup-wizard-mapper', 'row-fixed', { row: +b.dataset.save });
        this.render();
      }));
      this.querySelector('[data-only-fix]').addEventListener('click', () => { this.onlyFix = !this.onlyFix; this.render(); });
      this.querySelector('[data-fixall]').addEventListener('click', () => { const first = r.users.findIndex(u => u.confidence < 0.8 && !u.fixed); if (first >= 0) { this.onlyFix = true; this.editing = first; this.render(); } });
      this.querySelector('[data-discard]').addEventListener('click', () => { feedback(r.id, 'ecms.setup-wizard-mapper', 'rejected'); this.querySelector('[data-out]').innerHTML = ''; });
      this.querySelector('[data-import]').addEventListener('click', e => {
        const ready = r.users.filter(u => u.confidence >= 0.8 || u.fixed);
        const merges = r.clusters.filter(c => c.merge).map(c => ({ into: c.canonical, from: c.members.map(m => m.name).filter(n => n !== c.canonical) }));
        const tenantAfter = this.tenantRoles - r.clusters.filter(c => c.merge).reduce((n, c) => n + Math.max(0, c.members.filter(m => m.source === 'tenant').length - 1), 0);
        feedback(r.id, 'ecms.setup-wizard-mapper', 'accepted', { imported: ready.length, heldBack: r.users.length - ready.length });
        this.dispatchEvent(new CustomEvent('ai-org-import', { bubbles: true, detail: {
          departments: r.departments.map(d => ({ name: d.name, existing: d.existing })),
          roles: [...new Set(ready.map(u => u.role))], merges,
          users: ready.map(u => ({ name: u.name, ippis: u.ippis, department: u.department, role: u.role, gradeLevel: u.gl, lineManager: u.manager })),
          counts: { users: ready.length, heldBack: r.users.length - ready.length, departments: r.departments.length, newDepartments: r.departments.filter(d => !d.existing).length, rolesBefore: this.tenantRoles, rolesAfter: tenantAfter, merges: merges.length },
        } }));
        e.target.textContent = `Imported ${ready.length} ✓`; e.target.disabled = true;
      });
    }
  }

  customElements.define('ai-org-mapper', AIOrgMapper);
})();
