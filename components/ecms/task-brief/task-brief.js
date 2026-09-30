/* <ai-task-brief source="#task-src" viewer="Ann Nya" mode="brief|reply">
   One element, three placements in ECMS Tasks:
     mode="brief"                   Task brief card, first block of the task's Overview tab: a 5-line
                                    summary, the current blocker, what is needed from the viewer, and a
                                    "Next best action" chip.
     mode="brief" variant="preview" Compact popover opened by the ✦ next to a Task ID on All Tasks.
                                    "Open task" and a next-action button both emit ai-brief-open (the second carries the action).
     mode="reply"                   "Suggest reply" bar on top of the Add comment box. Drafts a comment in
                                    the chosen tone (formal / citizen-friendly / brief). It never posts:
                                    the host inserts the text when the officer accepts.
   Attributes:
     source  CSS selector of an element holding <script type="application/json" data-task> with the task
             exactly as ECMS shows it (see TASK SHAPE). The host re-renders it when the task changes.
     viewer  Name of the signed-in officer, so the brief can say what is needed from *you*.
     intent  (reply mode) CSS selector of the comment textarea; text already typed there is used.
   TASK SHAPE (fields from the live task page; any may be missing for a row seen only in All Tasks):
     { taskId, title, status, priority, queue, queueType, channel, description, createdBy, created,
       assignee, assignedBy, assignedOn, cc[], progress[], approval:{group,level,role,alternate,state},
       comments:[{author,when,text}], history:[{author,when,text}],
       attachments:[{name,classification,by,when}] }
   Events:
     ai-task-action  detail: { action:'draft', label, to, intent }  host opens Add comment with a draft
     ai-reply-insert detail: { text, tone }                         host puts the draft in the comment box
     ai-brief-open   detail: { taskId, action? }                    (preview) host opens the task; with action it also starts that follow-up
     ai-brief-result detail: brief payload
   Gateway:
     POST /ecms/task-brief    TASK + { viewer }            -> { model, confidence, lines[5], blocker, neededFromYou, nextAction }
     POST /ecms/suggest-reply TASK + { viewer, tone, intent, to } -> { model, confidence, text, basedOn[] } */
(function () {
  const { request, feedback, esc, reveal } = window.AIGateway;

  const clip = (s, n) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s; };
  const first = name => String(name || '').split(/[\s@.]/)[0];
  const known = v => v && !/^(n\/a|none|—|-)$/i.test(String(v).trim());
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  const TODAY = new Date(2026, 8, 28);
  const age = d => { const m = String(d || '').match(/(\d{2})\/(\d{2})\/(\d{4})/); if (!m) return null; return Math.max(0, Math.round((TODAY - new Date(+m[3], m[2] - 1, +m[1])) / 864e5)); };
  const lvl = ap => ap.level && ap.level !== 'approval' ? ap.level + ' approval' : 'approval';
  const days = n => n === 0 ? 'today' : n === 1 ? '1 day ago' : `${n} days ago`;

  // One reading of the task, shared by the brief and the reply so they always agree.
  function analyse(p) {
    const viewer = p.viewer || '';
    const comments = p.comments || [], history = p.history || [], atts = p.attachments || [];
    const assigned = known(p.assignee);
    const ap = p.approval && /pending/i.test(p.approval.state || '') ? p.approval : null;
    const isMe = n => n && viewer && String(n).toLowerCase().includes(first(viewer).toLowerCase());
    const role = isMe(p.assignee) ? 'assignee' : (isMe(p.assignedBy) || isMe(p.createdBy)) ? 'owner' : (p.cc || []).some(isMe) ? 'cc' : 'other';
    const events = [...history, ...comments];
    const last = events.slice().sort((a, b) => stamp(b.when) - stamp(a.when))[0];
    const lastComment = comments[comments.length - 1];
    return { viewer, comments, history, atts, assigned, ap, role, last, lastComment, openedDays: age(p.created) };
  }
  function stamp(w) {
    const m = String(w || '').match(/(\d{2})\/(\d{2})\/(\d{4})(?:\s*-\s*(\d{1,2}):(\d{2})\s*(am|pm))?/i);
    if (!m) return 0;
    let h = +(m[4] || 0); if (m[6] && /pm/i.test(m[6]) && h < 12) h += 12; if (m[6] && /am/i.test(m[6]) && h === 12) h = 0;
    return new Date(+m[3], m[2] - 1, +m[1], h, +(m[5] || 0)).getTime();
  }

  function mockBrief(p) {
    const a = analyse(p);
    const step = (p.progress || []).findIndex(s => s.toLowerCase() === String(p.status).toLowerCase());
    const lines = [
      `Request: ${p.createdBy || 'The requester'} opened this${p.created ? ' on ' + p.created : ''}${p.channel ? ' via ' + p.channel : ''}${p.description ? `: "${clip(p.description, 120)}"` : `: "${clip(p.title, 80)}"`}`,
      `Progress: status is ${p.status || 'unknown'}${step >= 0 ? ` (step ${step + 1} of ${p.progress.length})` : ''}${p.queue ? ` in ${p.queue}${p.queueType ? ' → ' + p.queueType : ''}` : ''}. ${a.assigned ? `Assigned to ${p.assignee}${known(p.assignedBy) ? ' by ' + p.assignedBy : ''}${known(p.assignedOn) ? ' on ' + p.assignedOn.split(' ')[0] : ''}.` : 'Not assigned to anyone yet.'}`,
      a.atts.length ? `Attachments (${a.atts.length}): ${a.atts.map(x => `${x.name}${x.classification ? ' [' + x.classification + ']' : ''}`).join(', ')}` : (p.attachments ? 'Attachments: none.' : 'Attachments: not loaded for this task.'),
      p.comments ? `Activity: ${plural(a.comments.length, 'comment')}${a.lastComment ? ` (latest from ${a.lastComment.author}: "${clip(a.lastComment.text, 60)}")` : ''} and ${plural(a.history.length, 'status update')}. ${a.last ? `Last update ${a.last.when} by ${a.last.author}.` : ''}`
        : `Activity: opened ${a.openedDays == null ? '' : days(a.openedDays)}${known(p.assignedOn) ? `, assigned ${p.assignedOn}` : ''}. Comments are not loaded for this task.`,
      `Priority is ${p.priority || 'Normal'}. ${a.openedDays == null ? '' : `Open for ${a.openedDays === 0 ? 'less than a day' : plural(a.openedDays, 'day')}.`} No deadline is stated.`,
    ];

    let blocker, needed, nextAction;
    if (a.ap) {
      blocker = `Waiting for ${a.ap.level && a.ap.level !== 'approval' ? a.ap.level + ' approval' : 'approval'}${a.ap.group ? ` in "${a.ap.group}"` : ''} from the ${a.ap.role || 'approver'}${known(a.ap.alternate) ? ` (alternate: ${a.ap.alternate})` : ''}. The status can't change until it is approved.`;
      if (!a.assigned) blocker += ' It is also not assigned to anyone yet.';
      needed = a.role === 'owner' ? `You raised or assigned this task. Ask the ${a.ap.role || 'approver'} to approve it${known(a.ap.alternate) ? `, or ask ${a.ap.alternate} as the alternate` : ''}.`
        : a.role === 'assignee' ? 'You are assigned, but nothing can move until the approval is done.'
        : `Nothing from you unless you are the ${a.ap.role || 'approver'}.`;
      nextAction = { action: 'draft', label: `Nudge the ${a.ap.role || 'approver'} to approve`, to: a.ap.role || 'Approver', intent: 'approval' };
    } else if (!a.assigned) {
      blocker = `Not assigned to anyone yet. It has been waiting since ${p.created || 'it was opened'}.`;
      needed = a.role === 'owner' ? 'Assign it to a user or workgroup so someone picks it up.' : 'Nothing from you. The queue owner needs to assign it.';
      nextAction = { action: 'assign', label: 'Assign to a user or workgroup' };
    } else if (!a.comments.length && step <= 0) {
      blocker = `Not started. No comments since ${p.assignee} was assigned${known(p.assignedOn) ? ' on ' + p.assignedOn.split(' ')[0] : ''}.`;
      needed = a.role === 'assignee' ? 'Add the first update and move the status on.' : `Nothing from you. Waiting for ${p.assignee} to start.`;
      nextAction = { action: 'draft', label: `Ask ${first(p.assignee)} for an update`, to: p.assignee, intent: 'update' };
    } else {
      const since = a.last ? a.last.when : p.assignedOn;
      blocker = `No blocker recorded. ${p.status} with ${p.assignee}${since ? ' since ' + since : ''}.`;
      needed = a.role === 'assignee' ? 'Update the status or add a comment when you have progress.'
        : a.role === 'owner' ? `Nothing pending from you. ${p.assignee} has it.` : 'You are not on this task. No action required.';
      nextAction = { action: 'draft', label: `Ask ${first(p.assignee)} for an update`, to: p.assignee, intent: 'update' };
    }
    const signals = a.comments.length + a.history.length + a.atts.length + (p.description ? 1 : 0);
    return { model: 'cicod-summariser-v1 (sovereign)', confidence: Math.min(0.95, 0.66 + signals * 0.04), lines, blocker, neededFromYou: needed, nextAction, sources: signals };
  }

  function mockReply(p) {
    const a = analyse(p);
    const to = p.to || p.createdBy || 'Colleague';
    const toName = /officer|admin|approver/i.test(to) ? `${to}` : first(to);
    const intent = clip(p.intent, 220);
    const extra = intent ? ` ${intent.replace(/\.?$/, '.')}` : '';
    const sign = p.viewer || 'ECMS Officer';
    const since = p.created ? ` since ${p.created.split(' ')[0]}` : '';
    let formal, citizen, brief;
    if (a.ap) {
      formal = `This task has been awaiting ${lvl(a.ap)}${a.ap.group ? ` (${a.ap.group})` : ''}${since}, and its status cannot change until it is approved. Kindly review and approve it, or let me know if anything else is needed.`;
      citizen = `Your request "${p.title}" is waiting for approval from the ${a.ap.role || 'approving officer'}. Once it is approved, work can continue.`;
      brief = `@${toName} #${p.taskId} is pending ${lvl(a.ap)}${since}. Please approve or advise.`;
    } else {
      formal = `Kindly share an update on this task. It is currently ${p.status}${a.last ? `, and the last update was on ${a.last.when}` : ''}. Please add a comment with progress and the expected completion date.`;
      citizen = `Your request "${p.title}" is currently ${p.status} and is being handled by ${p.assignee || 'our team'}.`;
      brief = `@${toName} update on #${p.taskId}, please? Status is ${p.status}${a.last ? ', last update ' + a.last.when : ''}.`;
    }
    const text = p.tone === 'citizen'
      ? `Hello ${first(p.createdBy) || 'there'},\n\nThank you for your patience. ${citizen}${extra}\n\nWe will update you as soon as there is progress.\n\n${sign}`
      : p.tone === 'brief' ? `${brief}${extra}`
      : `Dear ${toName},\n\nRE: TASK #${p.taskId}: ${String(p.title || '').toUpperCase()}\n\n${formal}${extra}\n\nKind regards,\n${sign}`;
    return {
      model: 'cicod-writer-v1 (sovereign)', confidence: intent ? 0.9 : 0.84, text,
      basedOn: [`Task #${p.taskId} history, approval and comments`, 'Tone guide: ' + ({ formal: 'enterprise correspondence', citizen: 'plain-language citizen reply', brief: 'internal one-liner' }[p.tone] || 'enterprise correspondence')],
    };
  }

  class AITaskBrief extends HTMLElement {
    connectedCallback() {
      this.mode = this.getAttribute('mode') || 'brief';
      this.viewer = this.getAttribute('viewer') || '';
      if (this.mode === 'reply') this.renderReplyIdle(); else this.loadBrief();
    }

    read() {
      const s = document.querySelector(this.getAttribute('source'));
      const j = s && s.querySelector('script[type="application/json"][data-task]');
      let t = {};
      try { t = j ? JSON.parse(j.textContent) : {}; } catch (e) { t = {}; }
      return { ...t, viewer: this.viewer };
    }

    /* ---------- Brief mode ---------- */
    async loadBrief() {
      const preview = this.getAttribute('variant') === 'preview';
      this.innerHTML = `<section class="aitb${preview ? ' aitb--preview' : ''}" aria-live="polite">
        <div class="aitb__head"><span class="aitb__title"><span class="ai-badge">CICOD-AI</span> ${preview ? 'Brief' : 'Task brief'}</span><span class="ai-confidence">reading task…</span></div>
        <div class="aitb__body"><div class="ai-skeleton" style="width:92%"></div><div class="ai-skeleton" style="width:80%"></div><div class="ai-skeleton" style="width:86%"></div><div class="ai-skeleton" style="width:64%"></div><div class="ai-skeleton" style="width:72%"></div></div>
      </section>`;
      const res = await request('/ecms/task-brief', this.read(), { mock: mockBrief, feature: 'ecms.task-brief' });
      this.result = res;
      if (preview) this.renderPreview(res); else this.renderBrief(res);
      this.dispatchEvent(new CustomEvent('ai-brief-result', { detail: res, bubbles: true }));
    }

    body(res) {
      return `<ol class="aitb__lines">${res.lines.map(l => `<li>${esc(l)}</li>`).join('')}</ol>
        <div class="aitb__grid">
          <div class="aitb__box aitb__box--block"><b>Current blocker</b>${esc(res.blocker)}</div>
          <div class="aitb__box aitb__box--you"><b>What's needed from you</b>${esc(res.neededFromYou)}</div>
        </div>`;
    }

    renderBrief(res) {
      const na = res.nextAction;
      this.innerHTML = `<section class="aitb" aria-live="polite">
        <div class="aitb__head"><span class="aitb__title"><span class="ai-badge">CICOD-AI</span> Task brief</span>
          <span class="ai-confidence">${Math.round(res.confidence * 100)}% · ${esc(res.model)}</span></div>
        <div class="aitb__body">${this.body(res)}
          <div class="aitb__next"><span class="aitb__next-label">Next best action</span>
            <button class="aitb__chip" type="button" data-next>✦ ${esc(na.label)}</button>
            <span class="aitb__next-hint">${na.action === 'draft' ? 'drafts a comment for you to check and post' : 'opens Reassign'}</span></div>
        </div>
        <div class="aitb__actions">
          <button class="g-btn g-btn--sm" data-useful type="button">Useful</button>
          <button class="g-btn g-btn--sm" data-wrong type="button">Not right</button>
          <button class="g-btn g-btn--sm g-btn--ghost" data-refresh type="button">↻ Refresh brief</button>
          <span class="aitb__mode">Summary only · check the task before you act</span>
        </div>
      </section>`;
      this.querySelector('[data-next]').addEventListener('click', () => {
        feedback(res.id, 'ecms.task-brief', 'accepted-next-action', { action: na.action });
        this.dispatchEvent(new CustomEvent('ai-task-action', { detail: na, bubbles: true }));
      });
      this.querySelector('[data-useful]').addEventListener('click', e => { feedback(res.id, 'ecms.task-brief', 'useful'); e.currentTarget.textContent = 'Thanks ✓'; });
      this.querySelector('[data-wrong]').addEventListener('click', e => { feedback(res.id, 'ecms.task-brief', 'rejected'); e.currentTarget.textContent = 'Flagged for review'; });
      this.querySelector('[data-refresh]').addEventListener('click', () => this.loadBrief());
    }

    renderPreview(res) {
      const id = this.read().taskId;
      this.innerHTML = `<section class="aitb aitb--preview" aria-live="polite">
        <div class="aitb__head"><span class="aitb__title"><span class="ai-badge">CICOD-AI</span> Brief · #${esc(id)}</span>
          <span class="ai-confidence">${Math.round(res.confidence * 100)}%</span></div>
        <div class="aitb__body">${this.body(res)}</div>
        <div class="aitb__actions">
          <button class="g-btn g-btn--ai g-btn--sm" data-act type="button">✦ ${esc(res.nextAction.label)}</button>
          <button class="g-btn g-btn--sm" data-open type="button">Open task →</button>
        </div>
      </section>`;
      // Open task: go to the task. Next action: go to the task AND start the follow-up there.
      const open = (action, kind) => {
        feedback(res.id, 'ecms.task-brief', kind, { taskId: id, action: action && action.action });
        this.dispatchEvent(new CustomEvent('ai-brief-open', { detail: { taskId: id, action }, bubbles: true }));
      };
      this.querySelector('[data-open]').addEventListener('click', () => open(null, 'preview-open'));
      this.querySelector('[data-act]').addEventListener('click', () => open(res.nextAction, 'preview-next-action'));
    }

    /** Called by the host after it changes the task (e.g. a new comment). */
    refresh() { if (this.mode === 'brief') this.loadBrief(); }

    /* ---------- Reply mode ---------- */
    renderReplyIdle() {
      this.innerHTML = `<section class="aitb aitb--reply">
        <div class="aitb__bar">
          <span class="aitb__title"><span class="ai-badge">CICOD-AI</span> Suggest reply</span>
          <label class="aitb__tone"><span>Tone</span>
            <select class="g-select" data-tone aria-label="Reply tone">
              <option value="formal">Formal</option><option value="citizen">Citizen-friendly</option><option value="brief">Brief</option>
            </select></label>
          <button class="g-btn g-btn--ai g-btn--sm" data-suggest type="button">✦ Suggest reply</button>
        </div>
        <div class="aitb__draft" data-draft hidden></div>
      </section>`;
      this.querySelector('[data-suggest]').addEventListener('click', () => this.suggest());
      this.querySelector('[data-tone]').addEventListener('change', () => { if (this.reply) this.suggest(); });
    }

    /** to: who the comment is addressed to (from the next best action). */
    async suggest(to) {
      if (to !== undefined) this.to = to;
      const tone = this.querySelector('[data-tone]').value;
      const intentEl = document.querySelector(this.getAttribute('intent'));
      const box = this.querySelector('[data-draft]');
      box.hidden = false;
      box.innerHTML = '<div class="ai-skeleton" style="width:40%"></div><div class="ai-skeleton" style="width:95%"></div><div class="ai-skeleton" style="width:88%"></div><div class="ai-skeleton" style="width:60%"></div>';
      const res = await request('/ecms/suggest-reply', { ...this.read(), tone, intent: intentEl?.value || '', to: this.to }, { mock: mockReply, feature: 'ecms.suggest-reply' });
      this.reply = { ...res, tone };
      box.innerHTML = `<div class="aitb__draft-head"><span>Draft · ${esc({ formal: 'Formal', citizen: 'Citizen-friendly', brief: 'Brief' }[tone])}</span><span class="ai-confidence">${Math.round(res.confidence * 100)}% · ${esc(res.model)}</span></div>
        <pre class="aitb__draft-text" data-text></pre>
        <div class="aitb__based">Based on: ${res.basedOn.map(esc).join(' · ')}</div>
        <div class="aitb__draft-actions">
          <button class="g-btn g-btn--ai g-btn--sm" data-insert type="button">Insert into comment</button>
          <button class="g-btn g-btn--sm" data-regen type="button">Regenerate</button>
          <button class="g-btn g-btn--sm g-btn--ghost" data-discard type="button">Discard</button>
        </div>`;
      reveal(box.querySelector('[data-text]'), res.text);
      box.querySelector('[data-insert]').addEventListener('click', () => {
        feedback(res.id, 'ecms.suggest-reply', 'accepted', { tone });
        this.dispatchEvent(new CustomEvent('ai-reply-insert', { detail: { text: res.text, tone }, bubbles: true }));
        box.innerHTML = '<div class="aitb__inserted">✓ Draft inserted into the comment box. Edit it there before you post.</div>';
        this.reply = null;
      });
      box.querySelector('[data-regen]').addEventListener('click', () => { feedback(res.id, 'ecms.suggest-reply', 'regenerated'); this.suggest(); });
      box.querySelector('[data-discard]').addEventListener('click', () => { feedback(res.id, 'ecms.suggest-reply', 'rejected'); box.hidden = true; box.innerHTML = ''; this.reply = null; });
    }
  }

  customElements.define('ai-task-brief', AITaskBrief);
})();
