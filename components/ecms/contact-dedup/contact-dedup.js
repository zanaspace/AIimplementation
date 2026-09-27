/* <ai-contact-insights source="#contacts-table" total="169">
   Contact data quality for the ECMS Contacts list:
     1. A "Duplicates & data quality" banner that counts likely duplicate groups, junk records
        and invalid fields across the whole tenant (not just the visible page).
     2. A merge-review drawer: records side by side, CICOD-AI-picked surviving values that the officer
        can change per field, then Merge or "Not duplicates".
     3. A contact 360 card when a row is clicked: requests, complaints, sentiment, last contact
        and an inferred lifecycle stage the officer can apply.
   Rows are read from the host table: <tr data-contact-id data-name data-email data-phone
   data-created data-stage>. Emails and phones arrive already masked; in production the gateway
   compares salted hashes of the full values. The component never edits the table itself.
   Attributes:
     source   CSS selector of the contacts table
     total    total contacts in the tenant (shown in the banner)
   Events:
     ai-contact-merge    detail: { survivorId, mergedIds[], values{} }  host merges the records
     ai-contact-archive  detail: { ids[] }                              host archives junk records
     ai-contact-fix      detail: { id, field, value, moveTo? }         host fixes one field
     ai-contact-stage    detail: { id, stage }                          host sets Lifecycle Stage
   Gateway:
     POST /ecms/contacts/quality { contacts[] } -> { model, groups:[{ id, confidence, reasons[], records[], survivor{} }],
                                                     junk:[{ id, name, reason }], invalid:[{ id, field, value, fix }] }
     POST /ecms/contacts/summary { id, name }   -> { model, requests, complaints, topic, lastContact, sentiment, stage, stageConfidence, summary } */
(function () {
  const { request, feedback, esc } = window.AIGateway;

  // Records on other pages of the tenant that the scan also covers (prototype data).
  const OTHER_PAGES = [
    { id: '142', name: 'Nathan Wilson', email: 'n***@gmail.com', phone: '+234•••5502', created: '14/03/2026', stage: 'N/A', tasks: 4 },
    { id: '133', name: 'Ayomide Olusanya', email: 'a***@cicod.com', phone: '+234•••3321', created: '02/02/2026', stage: 'N/A', tasks: 7 },
  ];
  const norm = s => s.toLowerCase().replace(/^(mr|mrs|ms|dr)\.?\s+/, '').replace(/\s+/g, ' ').trim();
  function lev(a, b) {
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return d[a.length][b.length];
  }
  const hash = s => [...String(s)].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0, 2166136261);
  const isJunkName = n => /[bcdfghjklmnpqrstvwxz]{5,}/i.test(n.replace(/\s/g, ' ')) || /\btest\b/i.test(n);
  const validPhone = p => p === 'N/A' || /^\+\d{3}•••\d{4}$/.test(p);

  function mockQuality({ contacts }) {
    const all = [...contacts, ...OTHER_PAGES.filter(o => !contacts.some(c => c.id === o.id))];
    const junk = all.filter(c => isJunkName(c.name)).map(c => ({ id: c.id, name: c.name,
      reason: /\btest\b/i.test(c.name) ? 'Test record created by the TESTING ACCOUNT user, with no linked tasks' : 'Name is random keyboard characters (no real syllables), no linked tasks' }));
    const junkIds = new Set(junk.map(j => j.id));
    const pool = all.filter(c => !junkIds.has(c.id));
    const seen = new Set(), groups = [];
    pool.forEach(a => {
      if (seen.has(a.id)) return;
      const members = [a];
      pool.forEach(b => {
        if (b.id === a.id || seen.has(b.id)) return;
        const d = lev(norm(a.name), norm(b.name));
        const sameSurname = norm(a.name).split(' ').pop() === norm(b.name).split(' ').pop();
        if ((d <= 2 && sameSurname) || (a.phone === b.phone && a.phone !== 'N/A' && d <= 4)) members.push(b);
      });
      if (members.length < 2) return;
      members.forEach(m => seen.add(m.id));
      const phones = new Set(members.map(m => m.phone)), emails = new Set(members.map(m => m.email));
      const names = members.map(m => m.name);
      const bestName = names.slice().sort((x, y) => y.length - x.length || names.filter(n => n === y).length - names.filter(n => n === x).length)[0];
      const oldest = members.slice().sort((x, y) => +x.id - +y.id)[0];
      const reasons = [];
      if (new Set(names.map(norm)).size > 1) reasons.push(`Names differ by ${Math.max(...members.map(m => lev(norm(m.name), norm(bestName))))} letter(s): ${[...new Set(names)].map(n => `"${n}"`).join(' vs ')}`);
      else reasons.push(`Identical name "${bestName}" on ${members.length} records`);
      if (phones.size === 1) reasons.push('Same phone number on every record');
      if (emails.size === 1) reasons.push('Same email address on every record');
      else reasons.push(`${emails.size} different email addresses; the most recent one is kept as primary and the others as secondary`);
      if (members.some(m => OTHER_PAGES.includes(m))) reasons.push('One record is on another page of the contact list');
      const confidence = Math.min(0.97, 0.6 + (phones.size === 1 ? 0.2 : 0) + (emails.size === 1 ? 0.1 : 0.03) + (members.length > 2 ? 0.05 : 0));
      const newest = members.slice().sort((x, y) => +y.id - +x.id)[0];
      groups.push({ id: 'g' + oldest.id, confidence, reasons, records: members.map(m => ({ ...m, tasks: m.tasks ?? hash(m.id) % 6 })),
        survivor: { id: oldest.id, name: bestName, email: newest.email, phone: [...phones].find(validPhone) || 'N/A', stage: 'N/A' } });
    });
    groups.sort((x, y) => y.records.length - x.records.length || y.confidence - x.confidence);
    const invalid = all.filter(c => !validPhone(c.phone)).map(c => ({ id: c.id, name: c.name, field: 'phone', value: c.phone,
      fix: /^[A-Za-z]+$/.test(c.phone) ? { value: 'N/A', moveTo: 'lastName', note: `"${c.phone}" looks like a surname typed into Phone. Move it to Last Name and clear Phone.` } : { value: 'N/A', note: 'Not a valid Nigerian number. Clear it and ask the contact to confirm.' } }));
    return { model: 'cicod-entity-resolver-v1 (sovereign)', groups, junk, invalid };
  }

  function mockSummary({ id, name, created }) {
    const h = hash(id + name);
    if (isJunkName(name)) return { model: 'cicod-summary-v1 (sovereign)', requests: 0, complaints: 0, topic: '–', lastContact: created, sentiment: 'none', stage: 'Test / junk', stageConfidence: 0.93,
      summary: `No requests, emails or portal visits are linked to "${name}". It was created on ${created} and never used, so it is most likely test data.` };
    const requests = 1 + (h % 7), complaints = Math.min(requests, (h >>> 3) % 3);
    const topics = ['delivery', 'billing', 'account access', 'document requests', 'IT support'];
    const topic = topics[(h >>> 5) % topics.length];
    const [cd, cm] = created.split('/').map(Number);
    const from = cm === 9 ? cd : 1;
    const day = Math.min(27, from + ((h >>> 7) % (28 - from)));
    const lastContact = `${String(day).padStart(2, '0')}/09/2026`;
    const since = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][cm - 1];
    const sentiment = complaints >= 2 ? 'negative' : complaints === 1 ? 'mixed' : 'positive';
    const stage = complaints >= 2 ? 'At risk' : requests >= 4 ? 'Customer' : requests >= 2 ? 'Prospect' : 'Lead';
    return { model: 'cicod-summary-v1 (sovereign)', requests, complaints, topic, lastContact, sentiment, stage, stageConfidence: 0.7 + ((h >>> 9) % 25) / 100,
      summary: `${requests} request${requests > 1 ? 's' : ''} since ${since}, ${complaints ? `${complaints} complaint${complaints > 1 ? 's' : ''} about ${topic}` : `mostly about ${topic}`}. Last contact ${lastContact.slice(0, 5)}, sentiment ${sentiment}.` };
  }

  class AIContactInsights extends HTMLElement {
    connectedCallback() {
      this.src = document.querySelector(this.getAttribute('source'));
      this.total = +(this.getAttribute('total') || 0);
      this.innerHTML = `<section class="aici" aria-live="polite">
        <div class="aici__banner" data-banner><span class="ai-badge">CICOD-AI</span><div class="aici__banner-text"><div class="ai-skeleton" style="width:260px;max-width:100%"></div></div></div>
        <div class="aici__360" data-360 hidden></div>
      </section>
      <div class="aici__backdrop" data-backdrop hidden></div>
      <aside class="aici__drawer" data-drawer hidden aria-label="Merge review"></aside>`;
      this.querySelector('[data-backdrop]').addEventListener('click', () => this.closeDrawer());
      if (this.src) this.src.addEventListener('click', e => { const tr = e.target.closest('tr[data-contact-id]'); if (tr && !tr.classList.contains('is-archived')) this.summarise(tr); });
      this.scan();
    }

    rows() {
      return [...(this.src?.querySelectorAll('tr[data-contact-id]') || [])].filter(tr => !tr.classList.contains('is-archived')).map(tr => ({
        id: tr.dataset.contactId, name: tr.dataset.name, email: tr.dataset.email, phone: tr.dataset.phone, created: tr.dataset.created, stage: tr.dataset.stage || 'N/A',
      }));
    }

    async scan() {
      const res = await request('/ecms/contacts/quality', { contacts: this.rows() }, { mock: mockQuality, feature: 'ecms.contact-dedup' });
      this.res = res;
      this.renderBanner();
    }

    renderBanner() {
      const { groups, junk, invalid } = this.res;
      const b = this.querySelector('[data-banner]');
      if (!groups.length && !junk.length && !invalid.length) { b.innerHTML = '<span class="ai-badge">CICOD-AI</span><div class="aici__banner-text"><b>No duplicates or junk records found.</b></div>'; return; }
      b.innerHTML = `<span class="ai-badge">CICOD-AI</span>
        <div class="aici__banner-text"><b>Duplicates &amp; data quality:</b> ${esc([
          groups.length && `${groups.length} likely duplicate group${groups.length === 1 ? '' : 's'}`,
          junk.length && `${junk.length} junk record${junk.length === 1 ? '' : 's'}`,
          invalid.length && `${invalid.length} invalid phone number${invalid.length === 1 ? '' : 's'}`,
        ].filter(Boolean).join(', '))}
          <span class="aici__muted">Scanned all ${esc(this.total || this.rows().length)} contacts · ${esc(this.res.model)}</span></div>
        <div class="aici__banner-actions">
          ${groups.length ? '<button class="g-btn g-btn--sm g-btn--ai" type="button" data-aici-review="dups">Review duplicates</button>' : ''}
          ${junk.length || invalid.length ? '<button class="g-btn g-btn--sm" type="button" data-aici-review="junk">Review junk</button>' : ''}
        </div>`;
      b.querySelectorAll('[data-aici-review]').forEach(x => x.addEventListener('click', () => this.openDrawer(x.dataset.aiciReview, 0)));
    }

    openDrawer(tab, gi) {
      this.tab = tab; this.gi = gi;
      const d = this.querySelector('[data-drawer]');
      d.hidden = false; this.querySelector('[data-backdrop]').hidden = false;
      tab === 'dups' ? this.renderGroup() : this.renderJunk();
    }
    closeDrawer() { this.querySelector('[data-drawer]').hidden = true; this.querySelector('[data-backdrop]').hidden = true; }

    drawerHead(title) {
      const { groups } = this.res;
      return `<div class="aici__dhead"><b>${esc(title)}</b><button class="g-btn g-btn--sm g-btn--ghost" type="button" data-close aria-label="Close">✕</button></div>
        <div class="aici__tabs">${groups.map((g, i) => `<button type="button" class="aici__tab ${this.tab === 'dups' && i === this.gi ? 'aici__tab--on' : ''}" data-tab="dups" data-gi="${i}">${esc(g.records[0].name.split(' ').pop())} (${g.records.length})</button>`).join('')}
          <button type="button" class="aici__tab ${this.tab === 'junk' ? 'aici__tab--on' : ''}" data-tab="junk">Junk &amp; invalid</button></div>`;
    }
    bindHead(d) {
      d.querySelector('[data-close]').addEventListener('click', () => this.closeDrawer());
      d.querySelectorAll('[data-tab]').forEach(t => t.addEventListener('click', () => this.openDrawer(t.dataset.tab, +(t.dataset.gi || 0))));
    }

    renderGroup() {
      const d = this.querySelector('[data-drawer]');
      const g = this.res.groups[this.gi];
      if (!g) return this.renderJunk();
      const FIELDS = [['name', 'Name'], ['email', 'Email'], ['phone', 'Phone'], ['created', 'Created'], ['tasks', 'Linked tasks']];
      this.pick = { ...g.survivor };
      const head = `<tr><th>Field</th>${g.records.map(r => `<th>#${esc(r.id)}${r.id === g.survivor.id ? ' <span class="g-chip g-chip--ok">keep</span>' : ''}</th>`).join('')}</tr>`;
      const body = FIELDS.map(([k, label]) => `<tr><td class="aici__fl">${label}</td>${g.records.map(r => {
        const pickable = ['name', 'email', 'phone'].includes(k);
        const on = pickable && this.pick[k] === r[k];
        return `<td class="${on ? 'aici__cell--on' : ''}">${pickable ? `<label class="aici__pick"><input type="radio" name="f-${k}" value="${esc(r[k])}" ${on ? 'checked' : ''}> ${esc(r[k])}</label>` : esc(r[k])}</td>`;
      }).join('')}</tr>`).join('');
      d.innerHTML = `${this.drawerHead('Merge review')}
        <div class="aici__dbody">
          <div class="aici__conf"><span class="ai-confidence">${Math.round(g.confidence * 100)}% likely the same person · ${esc(this.res.model)}</span></div>
          <ul class="aici__reasons">${g.reasons.map(r => `<li>${esc(r)}</li>`).join('')}</ul>
          <div class="g-table-wrap"><table class="g-table aici__cmp">${head}${body}</table></div>
          <div class="aici__survivor"><h5>Surviving record #${esc(g.survivor.id)}</h5><div data-surv></div>
            <p class="aici__muted">Tasks, notes and history from the other records move to #${esc(g.survivor.id)}. Merged records are archived, not deleted, and can be restored for 30 days.</p></div>
        </div>
        <div class="aici__dfoot">
          <button class="g-btn g-btn--ai" type="button" data-merge>Merge ${g.records.length} records into #${esc(g.survivor.id)}</button>
          <button class="g-btn" type="button" data-notdup>Not duplicates</button>
        </div>`;
      this.bindHead(d);
      const paint = () => { d.querySelector('[data-surv]').innerHTML = ['name', 'email', 'phone'].map(k => `<div class="aici__sv"><span>${k[0].toUpperCase() + k.slice(1)}</span><b>${esc(this.pick[k])}</b></div>`).join(''); };
      paint();
      d.querySelectorAll('input[type=radio]').forEach(r => r.addEventListener('change', () => {
        const k = r.name.slice(2); this.pick[k] = r.value; this.edited = true;
        d.querySelectorAll(`input[name="${r.name}"]`).forEach(x => x.closest('td').classList.toggle('aici__cell--on', x.checked));
        paint();
      }));
      d.querySelector('[data-merge]').addEventListener('click', () => {
        const mergedIds = g.records.map(r => r.id).filter(id => id !== g.survivor.id);
        feedback(this.res.id, 'ecms.contact-dedup', this.edited ? 'edited' : 'accepted', { group: g.id });
        this.dispatchEvent(new CustomEvent('ai-contact-merge', { detail: { survivorId: g.survivor.id, mergedIds, values: { ...this.pick } }, bubbles: true }));
        this.resolveGroup();
      });
      d.querySelector('[data-notdup]').addEventListener('click', () => { feedback(this.res.id, 'ecms.contact-dedup', 'rejected', { group: g.id }); this.resolveGroup(); });
    }
    resolveGroup() {
      this.res.groups.splice(this.gi, 1); this.edited = false;
      this.renderBanner();
      if (this.res.groups.length) { this.gi = 0; this.renderGroup(); } else this.openDrawer('junk', 0);
    }

    renderJunk() {
      const d = this.querySelector('[data-drawer]');
      const { junk, invalid } = this.res;
      this.tab = 'junk';
      d.innerHTML = `${this.drawerHead('Junk & invalid records')}
        <div class="aici__dbody">
          ${junk.length ? `<h5 class="aici__h5">Junk records</h5>${junk.map(j => `<label class="aici__junk"><input type="checkbox" value="${esc(j.id)}" checked><span><b>#${esc(j.id)} ${esc(j.name)}</b><br><span class="aici__muted">${esc(j.reason)}</span></span></label>`).join('')}` : ''}
          ${invalid.length ? `<h5 class="aici__h5">Invalid fields</h5>${invalid.map(v => `<div class="aici__junk" data-fix="${esc(v.id)}"><span><b>#${esc(v.id)} ${esc(v.name)}</b> · Phone: "${esc(v.value)}"<br><span class="aici__muted">${esc(v.fix.note)}</span></span><button class="g-btn g-btn--sm g-btn--ai" type="button">Apply fix</button></div>`).join('')}` : ''}
          ${!junk.length && !invalid.length ? '<p class="aici__muted">All clean. Nothing left to review.</p>' : ''}
        </div>
        <div class="aici__dfoot">
          ${junk.length ? '<button class="g-btn g-btn--ai" type="button" data-archive>Archive selected</button><button class="g-btn" type="button" data-keep>Keep all</button>' : '<button class="g-btn" type="button" data-close2>Done</button>'}
        </div>`;
      this.bindHead(d);
      d.querySelector('[data-close2]')?.addEventListener('click', () => this.closeDrawer());
      d.querySelector('[data-archive]')?.addEventListener('click', () => {
        const ids = [...d.querySelectorAll('.aici__junk input:checked')].map(x => x.value);
        if (!ids.length) return;
        feedback(this.res.id, 'ecms.contact-dedup', ids.length === junk.length ? 'accepted' : 'edited', { archived: ids });
        this.dispatchEvent(new CustomEvent('ai-contact-archive', { detail: { ids }, bubbles: true }));
        this.res.junk = junk.filter(j => !ids.includes(j.id)); this.renderBanner(); this.renderJunk();
      });
      d.querySelector('[data-keep]')?.addEventListener('click', () => { feedback(this.res.id, 'ecms.contact-dedup', 'rejected', { junk: junk.map(j => j.id) }); this.res.junk = []; this.renderBanner(); this.renderJunk(); });
      d.querySelectorAll('[data-fix] button').forEach(btn => btn.addEventListener('click', () => {
        const id = btn.closest('[data-fix]').dataset.fix;
        const v = invalid.find(x => x.id === id);
        feedback(this.res.id, 'ecms.contact-dedup', 'accepted', { fix: id });
        this.dispatchEvent(new CustomEvent('ai-contact-fix', { detail: { id, field: v.field, value: v.fix.value, moveTo: v.fix.moveTo, moved: v.value }, bubbles: true }));
        this.res.invalid = invalid.filter(x => x.id !== id); this.renderBanner(); this.renderJunk();
      }));
    }

    async summarise(tr) {
      const box = this.querySelector('[data-360]');
      box.hidden = false;
      box.innerHTML = '<div class="ai-skeleton" style="width:40%"></div><div class="ai-skeleton" style="width:85%"></div><div class="ai-skeleton" style="width:60%"></div>';
      const payload = { id: tr.dataset.contactId, name: tr.dataset.name, created: tr.dataset.created };
      const res = await request('/ecms/contacts/summary', payload, { mock: mockSummary, feature: 'ecms.contact-360' });
      const sentCls = { negative: 'g-chip--bad', mixed: 'g-chip--warn', positive: 'g-chip--ok' }[res.sentiment] || '';
      box.innerHTML = `<div class="aici__360-head"><b>Contact 360 · #${esc(payload.id)} ${esc(payload.name)}</b><span class="ai-confidence">${esc(res.model)}</span></div>
        <p class="aici__360-sum">${esc(res.summary)}</p>
        <div class="aici__stats">
          <div><span>Requests</span><b>${esc(res.requests)}</b></div>
          <div><span>Complaints</span><b>${esc(res.complaints)}</b></div>
          <div><span>Last contact</span><b>${esc(res.lastContact)}</b></div>
          <div><span>Sentiment</span><b><span class="g-chip ${sentCls}">${esc(res.sentiment)}</span></b></div>
        </div>
        <div class="aici__stage"><span>Inferred lifecycle stage: <b>${esc(res.stage)}</b> <span class="ai-confidence">${Math.round(res.stageConfidence * 100)}%</span> (currently ${esc(tr.dataset.stage || 'N/A')})</span>
          <span class="aici__stage-actions"><button class="g-btn g-btn--sm g-btn--ai" type="button" data-stage>Apply stage</button><button class="g-btn g-btn--sm" type="button" data-stage-no>Not right</button></span></div>`;
      box.querySelector('[data-stage]').addEventListener('click', e => {
        feedback(res.id, 'ecms.contact-360', 'accepted', { stage: res.stage });
        this.dispatchEvent(new CustomEvent('ai-contact-stage', { detail: { id: payload.id, stage: res.stage }, bubbles: true }));
        e.target.textContent = 'Applied ✓'; e.target.disabled = true;
      });
      box.querySelector('[data-stage-no]').addEventListener('click', () => { feedback(res.id, 'ecms.contact-360', 'rejected', { stage: res.stage }); box.hidden = true; });
    }
  }

  customElements.define('ai-contact-insights', AIContactInsights);
})();
