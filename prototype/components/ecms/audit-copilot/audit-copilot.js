/* <ai-audit-copilot source="#audit-table" work-hours="08:00-18:00">
   Two CICOD-AI surfaces for ECMS Reports → Audit Log:
     1. "Ask the audit log": a plain-English question box. The answer cites the log rows it is
        based on, and the host highlights those rows in the table.
     2. An anomaly panel: repeat approvals by the same user, activity outside working hours,
        and a new IP address for a privileged user. Each has "Mark reviewed" / "Open investigation".
   Rows are read from the host table: <tr data-row data-time data-user data-role data-ip data-ip-id
   data-feature data-action data-desc>. IPs arrive masked; data-ip-id is a gateway pseudonym so the
   CICOD-AI can tell addresses apart without seeing them. The component never edits the log.
   Attributes:
     source       CSS selector of the audit log table
     work-hours   working hours used for off-hours detection (default 08:00-18:00)
   Events:
     ai-audit-cite     detail: { rows[] }                        host highlights the cited rows
     ai-audit-anomaly  detail: { id, action, rows[], title }     action: 'reviewed' | 'investigate'
     ai-audit-answer   detail: answer payload
   Gateway:
     POST /ecms/audit/ask       { question, rows[] } -> { model, confidence, answer, rows[], query }
     POST /ecms/audit/anomalies { rows[], workHours, history{} }
       -> { model, anomalies:[{ id, severity, kind, title, detail, rows[] }] } */
(function () {
  const { request, feedback, esc } = window.AIGateway;

  // 30-day IP history per user, as the gateway would hold it (pseudonymous IDs only).
  const KNOWN_IPS = { 'Ann Nya': ['ip-a'], 'Ayomide Olusanya': ['ip-b'], 'api support': ['ip-c'] };
  const hhmm = r => r.time.split(' ')[1] || '00:00';
  const taskId = r => (r.desc.match(/\b(1\d{4})\b/) || [])[1];
  const isApproval = r => /approve/i.test(r.action);
  const list = xs => (xs.length > 1 ? xs.slice(0, -1).join(', ') + ' and ' + xs[xs.length - 1] : xs[0] || '');

  function offHours(rows, wh) {
    const [s, e] = wh.split('-');
    return rows.filter(r => hhmm(r) < s || hhmm(r) >= e);
  }

  function mockAnomalies({ rows, workHours }) {
    const anomalies = [];
    const byKey = {};
    rows.filter(isApproval).forEach(r => { const k = r.user + '|' + taskId(r); (byKey[k] = byKey[k] || []).push(r); });
    const dupByUser = {};
    Object.values(byKey).filter(g => g.length > 1).forEach(g => { (dupByUser[g[0].user] = dupByUser[g[0].user] || []).push(g); });
    Object.entries(dupByUser).forEach(([user, groups]) => {
      const ids = groups.map(g => taskId(g[0]));
      const first = ids.includes('16363') ? '16363' : ids[0];
      const others = ids.filter(i => i !== first);
      const times = groups.flat().map(hhmm).sort();
      anomalies.push({ id: 'dup-' + user, severity: 'bad', kind: 'Repeat approval', rows: groups.flat().map(r => r.row),
        title: `Duplicate approval of ${first}${others.length ? ` (and ${others.length} more)` : ''} by ${user}`,
        detail: `${user} approved task${ids.length > 1 ? 's' : ''} ${list(ids)} twice each between ${times[0]} and ${times[times.length - 1]} on ${groups[0][0].time.split(' ')[0]}. A second approval by the same person should not be possible; it may be a double submit or a replayed request.` });
    });
    const off = offHours(rows, workHours);
    const offByUser = {};
    off.forEach(r => (offByUser[r.user] = offByUser[r.user] || []).push(r));
    Object.entries(offByUser).forEach(([user, rs]) => {
      const appr = rs.filter(isApproval).length;
      const t = rs.map(hhmm).sort();
      anomalies.push({ id: 'off-' + user, severity: appr ? 'warn' : 'info', kind: 'Off-hours activity', rows: rs.map(r => r.row),
        title: `${rs.length} action${rs.length > 1 ? 's' : ''} by ${user} outside working hours`,
        detail: `Between ${t[0]} and ${t[t.length - 1]}, outside ${workHours}${appr ? `, including ${appr} approval${appr > 1 ? 's' : ''}` : ''}. ${user} usually works within office hours.` });
    });
    const seenNew = {};
    rows.forEach(r => { if (!(KNOWN_IPS[r.user] || []).includes(r.ipId)) (seenNew[r.user + '|' + r.ipId] = seenNew[r.user + '|' + r.ipId] || []).push(r); });
    Object.values(seenNew).forEach(rs => {
      const r = rs[0];
      const appr = rs.filter(isApproval).length;
      const privileged = /admin/i.test(r.role);
      anomalies.push({ id: 'ip-' + r.user + r.ipId, severity: privileged ? 'bad' : 'warn', kind: 'New IP address', rows: rs.map(x => x.row),
        title: `New IP for ${privileged ? r.role.toLowerCase() + ' ' : ''}${r.user}`,
        detail: `${r.ip} was first seen on ${r.time.split(' ')[0]} and has not been used by ${r.user} in the last 30 days. ${rs.length} action${rs.length > 1 ? 's' : ''} came from it${appr ? `, including ${appr} approval${appr > 1 ? 's' : ''}` : ''}.` });
    });
    const order = { bad: 0, warn: 1, info: 2 };
    anomalies.sort((a, b) => order[a.severity] - order[b.severity]);
    return { model: 'cicod-audit-anomaly-v1 (sovereign)', anomalies };
  }

  function mockAsk({ question, rows, workHours }) {
    const q = question.toLowerCase();
    const wantApproval = /approv/.test(q);
    const users = [...new Set(rows.map(r => r.user))];
    const user = users.find(u => q.includes(u.toLowerCase()) || q.includes(u.toLowerCase().split(' ')[0]));
    const id = (q.match(/\b(1\d{4})\b/) || [])[1];
    let hits, answer, query;
    const fmt = r => `${r.user} at ${hhmm(r)}`;
    if (id) {
      hits = rows.filter(r => taskId(r) === id && (!wantApproval || isApproval(r)));
      query = `description contains ${id}${wantApproval ? ' AND action = Approve' : ''}`;
      if (!hits.length) answer = `No entries mention task ${id} in the loaded log.`;
      else {
        const byUser = {};
        hits.forEach(r => (byUser[r.user] = byUser[r.user] || []).push(r));
        const parts = Object.entries(byUser).map(([u, rs]) => `${rs.length > 1 ? (rs.length === 2 ? 'twice' : rs.length + ' times') : 'once'} by ${u} (${rs.map(hhmm).join(', ')})`);
        const dup = Object.entries(byUser).find(([, rs]) => rs.length > 1);
        answer = `Task ${id} was ${wantApproval ? 'approved' : 'acted on'} ${hits.length} time${hits.length > 1 ? 's' : ''} on ${hits[0].time.split(' ')[0]}: ${list(parts)}.${dup ? ` The two entries by ${dup[0]} are ${Math.abs(parseInt(hhmm(dup[1][0]).slice(3)) - parseInt(hhmm(dup[1][1]).slice(3)))} minute(s) apart, which looks like a double submission.` : ''}`;
      }
    } else if (/off.?hours|after hours|out of hours|night|late|weekend/.test(q)) {
      hits = offHours(rows, workHours).filter(r => (!wantApproval || isApproval(r)) && (!user || r.user === user));
      query = `time NOT BETWEEN ${workHours}${wantApproval ? ' AND action = Approve' : ''}${user ? ` AND user = ${user}` : ''}`;
      answer = hits.length ? `${hits.length} ${wantApproval ? 'approval' : 'action'}${hits.length > 1 ? 's' : ''} happened outside ${workHours} this week: ${list(Object.entries(hits.reduce((m, r) => ((m[r.user] = (m[r.user] || 0) + 1), m), {})).map(([u, c]) => `${c} by ${u}`))}. The latest was ${fmt(hits.slice().sort((a, b) => hhmm(b).localeCompare(hhmm(a)))[0])}.` : `No ${wantApproval ? 'approvals' : 'actions'} happened outside ${workHours} in the loaded log.`;
    } else if (/\bip\b|address|device|location/.test(q)) {
      hits = rows.filter(r => !user || r.user === user);
      const ips = {}, perUser = {};
      hits.forEach(r => { const k = `${r.ip} (address ${r.ipId.replace("ip-", "").toUpperCase()})`; (ips[k] = ips[k] || new Set()).add(r.user); (perUser[r.user] = perUser[r.user] || new Set()).add(r.ipId); });
      const multi = Object.entries(perUser).filter(([, s]) => s.size > 1).map(([u]) => u);
      query = `GROUP BY ip_address${user ? ` WHERE user = ${user}` : ''}`;
      answer = `${Object.keys(ips).length} distinct IP address${Object.keys(ips).length === 1 ? '' : 'es'} appear (last octet masked): ${list(Object.entries(ips).map(([ip, us]) => `${ip} used by ${[...us].join(', ')}`))}. ${multi.length ? `${list(multi)} used more than one address.` : 'Each user used a single address.'}`;
    } else if (user) {
      hits = rows.filter(r => r.user === user && (!wantApproval || isApproval(r)));
      const acts = hits.reduce((m, r) => ((m[r.action.replace(/ with ID.*| Task.*/i, '')] = (m[r.action.replace(/ with ID.*| Task.*/i, '')] || 0) + 1), m), {});
      query = `user = ${user}${wantApproval ? ' AND action = Approve' : ''}`;
      answer = `${user} has ${hits.length} entr${hits.length === 1 ? 'y' : 'ies'} in the loaded log: ${list(Object.entries(acts).map(([a, c]) => `${c} × ${a}`))}.`;
    } else {
      const words = q.split(/\W+/).filter(w => w.length > 3 && !/^(show|which|what|this|week|were|with|from|that|there|have|task|tasks|entries|audit|done)$/.test(w));
      hits = rows.filter(r => words.some(w => `${r.feature} ${r.action} ${r.desc}`.toLowerCase().includes(w)));
      query = `text search: ${words.join(', ') || '(none)'}`;
      answer = hits.length ? `${hits.length} entr${hits.length === 1 ? 'y matches' : 'ies match'} "${words.join(' ')}". The most recent is ${hits[0].action} by ${fmt(hits[0])}.` : 'I could not find matching entries. Try a task ID, a user name, "off-hours" or "IP".';
    }
    return { model: 'cicod-audit-qa-v1 (sovereign)', confidence: hits.length ? 0.9 : 0.6, answer, rows: hits.map(r => r.row), query };
  }

  class AIAuditCopilot extends HTMLElement {
    connectedCallback() {
      this.src = document.querySelector(this.getAttribute('source'));
      this.wh = this.getAttribute('work-hours') || '08:00-18:00';
      this.innerHTML = `<section class="aiac">
        <div class="aiac__ask">
          <div class="aiac__head"><span class="aiac__title"><span class="ai-badge">CICOD-AI</span> Ask the audit log</span><span class="ai-confidence">Answers cite log rows</span></div>
          <form class="aiac__form" data-form><input class="g-input" data-aiac-input placeholder="e.g. Who approved task 16363?" aria-label="Ask a question about the audit log"><button class="g-btn g-btn--ai" type="submit" data-aiac-ask>Ask</button></form>
          <div class="aiac__examples">${['Who approved task 16363?', 'Show off-hours approvals this week', 'Which IP addresses did Ann Nya use?'].map(x => `<button type="button" class="g-chip g-chip--ai aiac__ex">${esc(x)}</button>`).join('')}</div>
          <div class="aiac__answer" data-answer aria-live="polite"></div>
        </div>
        <div class="aiac__anom">
          <div class="aiac__head"><span class="aiac__title"><span class="ai-badge">CICOD-AI</span> Anomalies</span><span class="ai-confidence" data-anom-meta>scanning…</span></div>
          <div class="aiac__anom-list" data-anoms><div class="ai-skeleton" style="width:80%"></div><div class="ai-skeleton" style="width:65%"></div><div class="ai-skeleton" style="width:72%"></div></div>
        </div>
      </section>`;
      this.input = this.querySelector('[data-aiac-input]');
      this.querySelector('[data-form]').addEventListener('submit', e => { e.preventDefault(); this.ask(); });
      this.querySelectorAll('.aiac__ex').forEach(b => b.addEventListener('click', () => { this.input.value = b.textContent; this.ask(); }));
      this.scan();
    }

    rows() {
      return [...(this.src?.querySelectorAll('tr[data-row]') || [])].map(tr => ({ row: tr.dataset.row, time: tr.dataset.time, user: tr.dataset.user, role: tr.dataset.role || '', ip: tr.dataset.ip, ipId: tr.dataset.ipId, feature: tr.dataset.feature, action: tr.dataset.action, desc: tr.dataset.desc }));
    }
    cite(rows) { this.dispatchEvent(new CustomEvent('ai-audit-cite', { detail: { rows }, bubbles: true })); }

    async ask() {
      const question = this.input.value.trim();
      const box = this.querySelector('[data-answer]');
      if (question.length < 4) { box.innerHTML = '<p class="aiac__muted">Ask about a task ID, a user, off-hours activity or IP addresses.</p>'; return; }
      box.innerHTML = '<div class="ai-skeleton" style="width:90%"></div><div class="ai-skeleton" style="width:70%"></div>';
      const res = await request('/ecms/audit/ask', { question, rows: this.rows(), workHours: this.wh }, { mock: mockAsk, feature: 'ecms.audit-copilot.ask' });
      box.innerHTML = `<div class="aiac__card">
        <p class="aiac__text">${esc(res.answer)}</p>
        <div class="aiac__meta"><span class="g-chip">${res.rows.length} cited row${res.rows.length === 1 ? '' : 's'} highlighted</span><span class="ai-confidence">${Math.round(res.confidence * 100)}% · ${esc(res.model)}</span></div>
        <details class="aiac__q"><summary>How CICOD-AI read your question</summary><code>${esc(res.query)}</code></details>
        <div class="aiac__actions"><button class="g-btn g-btn--sm g-btn--ai" type="button" data-a="ok">Helpful</button><button class="g-btn g-btn--sm" type="button" data-a="no">Not right</button><button class="g-btn g-btn--sm g-btn--ghost" type="button" data-a="clear">Clear highlight</button></div>
      </div>`;
      this.cite(res.rows);
      this.dispatchEvent(new CustomEvent('ai-audit-answer', { detail: res, bubbles: true }));
      box.querySelector('[data-a="ok"]').addEventListener('click', e => { feedback(res.id, 'ecms.audit-copilot.ask', 'accepted'); e.target.textContent = 'Thanks ✓'; e.target.disabled = true; });
      box.querySelector('[data-a="no"]').addEventListener('click', () => { feedback(res.id, 'ecms.audit-copilot.ask', 'rejected'); this.cite([]); box.innerHTML = '<p class="aiac__muted">Noted. Try naming the task ID or user.</p>'; });
      box.querySelector('[data-a="clear"]').addEventListener('click', () => this.cite([]));
    }

    async scan() {
      const res = await request('/ecms/audit/anomalies', { rows: this.rows(), workHours: this.wh }, { mock: mockAnomalies, feature: 'ecms.audit-copilot.anomalies' });
      this.anom = res;
      this.querySelector('[data-anom-meta]').textContent = `${res.anomalies.length} open · ${res.model}`;
      this.querySelector('[data-anoms]').innerHTML = res.anomalies.map(a => `<div class="aiac__item aiac__item--${esc(a.severity)}" data-anom="${esc(a.id)}">
          <button type="button" class="aiac__item-title" data-show><span class="g-chip">${esc(a.kind)}</span> ${esc(a.title)}</button>
          <p>${esc(a.detail)}</p>
          <div class="aiac__item-actions"><button class="g-btn g-btn--sm" type="button" data-act="reviewed">Mark reviewed</button><button class="g-btn g-btn--sm g-btn--ai" type="button" data-act="investigate">Open investigation</button><span class="aiac__muted">${a.rows.length} rows</span></div>
        </div>`).join('') || '<p class="aiac__muted">No anomalies in the loaded log.</p>';
      this.querySelectorAll('[data-anom]').forEach(el => {
        const a = res.anomalies.find(x => x.id === el.dataset.anom);
        el.querySelector('[data-show]').addEventListener('click', () => this.cite(a.rows));
        el.querySelectorAll('[data-act]').forEach(b => b.addEventListener('click', () => {
          const action = b.dataset.act;
          feedback(res.id, 'ecms.audit-copilot.anomalies', action === 'reviewed' ? 'dismissed' : 'accepted', { anomaly: a.id });
          el.classList.add('aiac__item--done');
          el.querySelector('.aiac__item-actions').innerHTML = `<span class="g-chip ${action === 'investigate' ? 'g-chip--info' : 'g-chip--ok'}">${action === 'investigate' ? 'Investigation opened' : 'Reviewed'}</span>`;
          this.dispatchEvent(new CustomEvent('ai-audit-anomaly', { detail: { id: a.id, action, rows: a.rows, title: a.title }, bubbles: true }));
        }));
      });
    }
  }

  customElements.define('ai-audit-copilot', AIAuditCopilot);
})();
