/* <ai-sla-risk table="#tasks-table" drawer="#sla-drawer" horizon-hours="48">
   Scores every task row in All Tasks for the chance it will breach its SLA, shows a risk badge in
   the "Breach risk" column, offers "Sort by risk", and opens a drawer with the reasons and an
   "Escalate now" proposal (line manager or alternate approver, with a drafted note).
   The component only renders into slots the host gives it ([data-sla-slot] cells and the drawer
   element). It never edits task data: the host applies sorting and escalations from the events.
   Attributes:
     table          CSS selector of the task table. Rows are tbody tr[data-task] with data-stage-hours,
                    data-median-hours, data-sla-hours, data-load, data-approval-days, data-priority,
                    data-assignee, data-line-manager, data-alt-approver, data-title.
     drawer         CSS selector of an empty element the drawer is rendered into.
     horizon-hours  "Likely to breach" window used in the summary (default 48).
   Events:
     ai-sla-sort      detail: { byRisk: boolean, order: [taskId] }   host reorders the rows
     ai-sla-escalate  detail: { taskId, to, name, note }             host records the escalation
     ai-sla-result    detail: scoring payload
   Gateway: POST /ecms/sla-risk { tasks:[{ id, stageHours, medianHours, slaHours, load, approvalDays, priority }] }
     -> { model, scores:[{ id, risk, level, hoursLeft, features:[{ label, value, baseline, weight }],
                           escalation:{ recommended, options:[{ to, name, role, note }] } }] } */
(function () {
  const { request, feedback, esc } = window.AIGateway;
  const sig = x => 1 / (1 + Math.exp(-x));

  // Prototype-only model: a logistic score over the same explainable features a survival/GBM model would use.
  function mockScore({ tasks }) {
    return {
      model: 'cicod-sla-gbm-v1 (sovereign)',
      scores: tasks.map(t => {
        const ratio = t.stageHours / Math.max(1, t.medianHours);
        const used = t.stageHours / Math.max(1, t.slaHours);
        const pr = { Critical: 0.9, High: 0.6, Medium: 0.2, Normal: 0, Low: -0.3 }[t.priority] || 0;
        const z = 1.3 * (ratio - 1) + 0.012 * t.load + 0.9 * t.approvalDays + 1.6 * used + pr - 2.6;
        const risk = Math.max(0.03, Math.min(0.98, sig(z)));
        const level = risk >= 0.7 ? 'high' : risk >= 0.4 ? 'medium' : 'low';
        const hoursLeft = Math.round(t.slaHours - t.stageHours);
        const features = [
          { label: 'Time in current stage', phrase: 'time in the current stage', value: `${t.stageHours} h`, baseline: `median ${t.medianHours} h for ${t.queue}`, weight: Math.min(1, Math.max(0, (ratio - 1) / 4)) },
          { label: 'Assignee open load', phrase: "the assignee's open load", value: `${t.load} open tasks`, baseline: 'team median 22', weight: Math.min(1, t.load / 150) },
          { label: 'Approval pending', phrase: 'the pending approval', value: t.approvalDays ? `${t.approvalDays} day${t.approvalDays > 1 ? 's' : ''} with approver` : 'none', baseline: 'median 0.5 day', weight: Math.min(1, t.approvalDays / 3) },
          { label: 'SLA used', phrase: 'SLA time already used', value: `${Math.round(used * 100)}%`, baseline: `${t.slaHours} h SLA · ${t.priority}`, weight: Math.min(1, used) },
        ].sort((a, b) => b.weight - a.weight);
        const why = features[0].phrase;
        const late = hoursLeft < 0 ? `is already ${-hoursLeft} h past its ${t.slaHours} h SLA` : `will breach its ${t.slaHours} h SLA in about ${hoursLeft} h`;
        const note = (to, name) => `Dear ${name.split(' ')[0]},\n\nTask #${t.id} "${t.title}" ${late}. The main driver is ${why} (${features[0].value} against ${features[0].baseline}).${t.approvalDays ? ` An approval has been pending for ${t.approvalDays} day(s).` : ''}\n\n${to === 'alternate approver' ? 'As alternate approver, kindly review and approve or return the request today so the task can move.' : `Kindly reassign or support ${t.assignee}, who currently holds ${t.load} open tasks.`}\n\nEscalated via ECMS (CICOD-AI SLA risk ${Math.round(risk * 100)}%).`;
        const options = [{ to: 'line manager', name: t.lineManager, role: `Line manager of ${t.assignee}`, note: note('line manager', t.lineManager) }];
        if (t.altApprover) options.push({ to: 'alternate approver', name: t.altApprover, role: 'Alternate approver on this workflow', note: note('alternate approver', t.altApprover) });
        const recommended = t.approvalDays >= 1 && t.altApprover ? 'alternate approver' : 'line manager';
        return { id: t.id, risk, level, hoursLeft, features, escalation: { recommended, options } };
      }),
    };
  }

  const LEVEL = { high: ['bad', 'High'], medium: ['warn', 'Medium'], low: ['ok', 'Low'] };

  class AISlaRisk extends HTMLElement {
    connectedCallback() {
      this.table = document.querySelector(this.getAttribute('table'));
      this.drawer = document.querySelector(this.getAttribute('drawer'));
      this.horizon = parseFloat(this.getAttribute('horizon-hours') || '48');
      this.byRisk = false;
      this.done = new Set();
      this.innerHTML = `<div class="aisl__bar"><span class="ai-badge">CICOD-AI</span><span class="aisl__sum" data-sum><span class="ai-skeleton" style="width:220px;display:inline-block;margin:0"></span></span>
        <button class="g-btn g-btn--sm" data-sort type="button" disabled>⇅ Sort by risk</button></div>`;
      this.querySelector('[data-sort]').addEventListener('click', () => this.sort());
      this.slots().forEach(s => { s.innerHTML = '<span class="ai-skeleton" style="width:64px;margin:2px 0"></span>'; });
      this.score();
    }

    rows() { return this.table ? [...this.table.querySelectorAll('tbody tr[data-task]')] : []; }
    slots() { return this.rows().map(r => r.querySelector('[data-sla-slot]')).filter(Boolean); }

    read() {
      return this.rows().map(r => {
        const d = r.dataset;
        return { id: d.task, title: d.title, queue: d.queue, priority: d.priority, assignee: d.assignee, lineManager: d.lineManager, altApprover: d.altApprover || '',
          stageHours: +d.stageHours, medianHours: +d.medianHours, slaHours: +d.slaHours, load: +d.load, approvalDays: +d.approvalDays || 0 };
      });
    }

    async score() {
      this.tasks = this.read();
      const res = await request('/ecms/sla-risk', { tasks: this.tasks }, { mock: mockScore, feature: 'ecms.sla-risk' });
      this.result = res;
      this.byId = Object.fromEntries(res.scores.map(s => [s.id, s]));
      this.renderBadges();
      const soon = res.scores.filter(s => s.level === 'high' && s.hoursLeft <= this.horizon).length;
      const med = res.scores.filter(s => s.level === 'medium').length;
      this.querySelector('[data-sum]').innerHTML = `<b>${soon} task${soon === 1 ? '' : 's'}</b> likely to breach in the next ${this.horizon} h · ${med} at medium risk <span class="ai-confidence">${esc(res.model)}</span>`;
      this.querySelector('[data-sort]').disabled = false;
      this.renderDrawerIdle();
      this.dispatchEvent(new CustomEvent('ai-sla-result', { detail: res, bubbles: true }));
    }

    renderBadges() {
      this.rows().forEach(r => {
        const slot = r.querySelector('[data-sla-slot]'); const s = this.byId[r.dataset.task];
        if (!slot || !s) return;
        if (this.done.has(s.id)) { slot.innerHTML = '<span class="aisl__badge aisl__badge--done">✓ Escalated</span>'; return; }
        const [tone, label] = LEVEL[s.level];
        slot.innerHTML = `<button type="button" class="aisl__badge aisl__badge--${tone}" data-open="${esc(s.id)}" title="Why?">${label} · ${Math.round(s.risk * 100)}%</button>
          <span class="aisl__left">${s.hoursLeft < 0 ? `${-s.hoursLeft} h over` : `${s.hoursLeft} h left`}</span>`;
        slot.querySelector('[data-open]').addEventListener('click', () => this.open(s.id));
      });
    }

    sort() {
      this.byRisk = !this.byRisk;
      const ids = this.tasks.map(t => t.id);
      const order = this.byRisk ? [...ids].sort((a, b) => this.byId[b].risk - this.byId[a].risk) : ids;
      const btn = this.querySelector('[data-sort]');
      btn.textContent = this.byRisk ? '✓ Sorted by risk' : '⇅ Sort by risk';
      btn.classList.toggle('g-btn--ai', this.byRisk);
      feedback(this.result.id, 'ecms.sla-risk', this.byRisk ? 'sorted-by-risk' : 'sort-cleared');
      this.dispatchEvent(new CustomEvent('ai-sla-sort', { detail: { byRisk: this.byRisk, order }, bubbles: true }));
    }

    renderDrawerIdle() {
      if (!this.drawer) return;
      this.drawer.hidden = true;
      this.drawer.innerHTML = '';
    }

    async open(id) {
      if (!this.drawer) return;
      const s = this.byId[id]; const t = this.tasks.find(x => x.id === id);
      this.drawer.hidden = false;
      this.drawer.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      this.drawer.innerHTML = `<div class="aisl__drawer"><div class="aisl__dh"><b>#${esc(id)}</b><button class="g-btn g-btn--sm g-btn--ghost" data-close type="button" aria-label="Close">✕</button></div>
        <div class="aisl__db"><div class="ai-skeleton" style="width:70%"></div><div class="ai-skeleton" style="width:90%"></div><div class="ai-skeleton" style="width:80%"></div><div class="ai-skeleton" style="width:60%"></div></div></div>`;
      this.drawer.querySelector('[data-close]').addEventListener('click', () => this.renderDrawerIdle());
      // The drawer asks the gateway for a fresh explanation (the list score may be a few minutes old).
      const res = await request('/ecms/sla-risk', { tasks: [t], explain: true }, { mock: mockScore, feature: 'ecms.sla-escalation', delay: 500 });
      const d = res.scores[0];
      const [tone, label] = LEVEL[d.level];
      const rec = d.escalation.options.find(o => o.to === d.escalation.recommended) || d.escalation.options[0];
      this.drawer.innerHTML = `<div class="aisl__drawer" role="dialog" aria-label="Breach risk for task ${esc(id)}">
        <div class="aisl__dh"><div><div class="aisl__dh-id">#${esc(id)} · ${esc(t.queue)}</div><b>${esc(t.title)}</b></div><button class="g-btn g-btn--sm g-btn--ghost" data-close type="button" aria-label="Close">✕</button></div>
        <div class="aisl__db">
          <div class="aisl__score"><span class="aisl__badge aisl__badge--${tone}">${label} risk · ${Math.round(d.risk * 100)}%</span>
            <span>${d.hoursLeft < 0 ? `${-d.hoursLeft} h past SLA` : `breach expected in ~${d.hoursLeft} h`}</span></div>
          <h5 class="aisl__h">Why this task is at risk</h5>
          ${d.features.map(f => `<div class="aisl__feat"><div class="aisl__feat-top"><span>${esc(f.label)}</span><b>${esc(f.value)}</b></div>
            <div class="aisl__meter"><i style="width:${Math.round(f.weight * 100)}%"></i></div><div class="aisl__feat-base">${esc(f.baseline)}</div></div>`).join('')}
          <h5 class="aisl__h">Escalate now</h5>
          <div class="aisl__opts">${d.escalation.options.map(o => `<label class="aisl__opt"><input type="radio" name="aisl-to-${esc(id)}" value="${esc(o.to)}" ${o === rec ? 'checked' : ''}>
            <span><b>${esc(o.name)}</b> · ${esc(o.to)}${o === rec ? ' <span class="g-chip g-chip--ai">recommended</span>' : ''}<small>${esc(o.role)}</small></span></label>`).join('')}</div>
          <label class="g-label" for="aisl-note">Escalation note (edit before sending)</label>
          <textarea class="g-textarea aisl__note" id="aisl-note" data-note></textarea>
          <div class="ai-confidence">${esc(res.model)} · features from stage history, Resources load and approvals</div>
        </div>
        <div class="aisl__actions">
          <button class="g-btn g-btn--ai g-btn--sm" data-escalate type="button">Escalate now</button>
          <button class="g-btn g-btn--sm" data-snooze type="button">Remind me in 24 h</button>
          <button class="g-btn g-btn--sm g-btn--ghost" data-reject type="button">Not a risk</button>
        </div></div>`;
      const note = this.drawer.querySelector('[data-note]');
      const current = () => d.escalation.options.find(o => o.to === this.drawer.querySelector('input[type=radio]:checked').value);
      note.value = rec.note;
      this.drawer.querySelectorAll('input[type=radio]').forEach(r => r.addEventListener('change', () => { note.value = current().note; }));
      this.drawer.querySelector('[data-close]').addEventListener('click', () => this.renderDrawerIdle());
      this.drawer.querySelector('[data-escalate]').addEventListener('click', () => {
        const o = current();
        const edited = note.value.trim() !== o.note.trim();
        feedback(res.id, 'ecms.sla-escalation', edited ? 'accepted-edited' : 'accepted', { taskId: id, to: o.to });
        this.done.add(id); this.renderBadges(); this.renderDrawerIdle();
        this.dispatchEvent(new CustomEvent('ai-sla-escalate', { detail: { taskId: id, to: o.to, name: o.name, note: note.value }, bubbles: true }));
      });
      this.drawer.querySelector('[data-snooze]').addEventListener('click', () => { feedback(res.id, 'ecms.sla-escalation', 'snoozed', { taskId: id }); this.renderDrawerIdle(); });
      this.drawer.querySelector('[data-reject]').addEventListener('click', () => { feedback(res.id, 'ecms.sla-escalation', 'rejected', { taskId: id }); this.renderDrawerIdle(); });
    }
  }

  customElements.define('ai-sla-risk', AISlaRisk);
})();
