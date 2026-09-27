/* <ai-task-brief source="#task-detail" viewer="Prince Ekpenyong" mode="brief|reply">
   One element, two placements on the ECMS task detail page:
     mode="brief"  A Brief card at the top of the task: a 5-line summary of the timeline, the
                   current blocker, what is needed from the viewer, and a "Next best action" chip.
     mode="reply"  A "Suggest reply" bar above the remark box. It drafts a remark or citizen reply
                   in the chosen tone (formal / citizen-friendly / brief). It never writes into the
                   textarea itself: the host page inserts the text when the officer accepts.
   Attributes:
     source  CSS selector of the task container. It holds [data-task-field] header values and
             [data-entry] timeline items (data-author, data-when, data-kind, data-ocr, text).
     viewer  Name of the signed-in officer, so the brief can say what is needed from *you*.
     mode    brief (default) | reply
     intent  (reply mode) CSS selector of the remark textarea; any text already typed there is
             used as the officer's intent for the draft.
   Events:
     ai-task-action  detail: { action, label, status?, remark? }   host applies the next best action
     ai-reply-insert detail: { text, tone }                        host puts the draft in the remark box
     ai-brief-result detail: brief payload
   Gateway:
     POST /ecms/task-brief    { taskId, title, status, viewer, timeline[] }
       -> { model, confidence, lines[5], blocker, neededFromYou, nextAction:{action,label,status?,remark?} }
     POST /ecms/suggest-reply { taskId, tone, intent, requester, timeline[] }
       -> { model, confidence, text, basedOn[] } */
(function () {
  const { request, feedback, esc, reveal } = window.AIGateway;

  const clip = (s, n) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s; };
  const first = name => String(name || '').split(' ')[0];

  // Shared reading of the timeline, used by both mocks so the brief and the reply always agree.
  function analyse(p) {
    const t = p.timeline || [];
    const viewer = p.viewer || '';
    const vFirst = first(viewer);
    const opening = t[0] || { author: 'Requester', text: p.title };
    const requester = opening.author;
    const atts = t.filter(e => e.kind === 'attachment');
    const remarks = t.filter(e => e.kind === 'remark');
    const byViewer = t.filter(e => e.author === viewer);
    const lastViewer = byViewer[byViewer.length - 1];
    const approvedByYou = lastViewer && /\bapprove(d)?\b|go ahead|granted/i.test(lastViewer.text) && !/not approve|decline|reject/i.test(lastViewer.text);
    const askEntry = [...t].reverse().find(e => e.author !== viewer && new RegExp(vFirst, 'i').test(e.text) && /approv|confirm|sign|review|minute/i.test(e.text));
    const blockEntry = [...t].reverse().find(e => /not in stock|out of stock|waiting|pending|awaiting|blocked|needs? (your )?approval|on hold/i.test(e.text));
    const deadline = (t.map(e => e.text).join(' ').match(/\b(by|before|for) (monday|tuesday|wednesday|thursday|friday|tomorrow|today|\d{1,2}\/\d{1,2}(\/\d{2,4})?)[^.]*/i) || [])[0];
    const assigneeRemark = [...remarks].reverse().find(e => e.author !== requester && e.author !== viewer);
    const lastEntry = t[t.length - 1] || opening;
    return { t, viewer, requester, opening, atts, remarks, lastViewer, approvedByYou, askEntry, blockEntry, deadline, assigneeRemark, lastEntry };
  }

  function mockBrief(p) {
    const a = analyse(p);
    const ocr = a.atts.filter(x => x.ocr).map(x => `${x.text} ("${clip(x.ocr, 60)}")`);
    const lines = [
      `Request: ${a.requester} reported "${clip(a.opening.text, 120)}"`,
      a.assigneeRemark ? `Progress: ${a.assigneeRemark.author} said "${clip(a.assigneeRemark.text, 110)}"` : 'Progress: no one has commented on the task yet.',
      a.atts.length ? `Attachments (${a.atts.length}): ${ocr.length ? ocr.join('; ') : a.atts.map(x => x.text).join(', ')}` : 'Attachments: none.',
      `Activity: ${a.remarks.length} remarks and ${a.atts.length} files. Last update ${a.lastEntry.when} by ${a.lastEntry.author}.`,
      a.deadline ? `Deadline mentioned: "${clip(a.deadline, 70)}". Priority is ${p.priority || 'Normal'}.` : `No deadline stated. Priority is ${p.priority || 'Normal'}.`,
    ];
    let blocker, needed, nextAction;
    if (a.approvedByYou) {
      blocker = 'Your approval is recorded. The task now waits on the physical transfer of the part.';
      needed = 'Nothing is pending from you. Keep the requester informed of the new date.';
      nextAction = { action: 'reply', label: `Send ${first(a.requester)} an ETA update`, status: 'In Progress' };
    } else if (a.askEntry) {
      blocker = a.blockEntry ? clip(a.blockEntry.text, 140) : 'Waiting for your decision.';
      const transfer = /transfer/i.test(a.askEntry.text);
      needed = `${a.askEntry.author} asked for your ${transfer ? 'approval of the stock transfer' : 'decision'} on ${a.askEntry.when}: "${clip(a.askEntry.text, 110)}"`;
      nextAction = transfer
        ? { action: 'approve', label: 'Approve Kano store transfer', status: 'Awaiting Delivery', remark: 'Approved: transfer 1 fuser unit (HP 4250) from Kano store to Central Store for this task.' }
        : { action: 'approve', label: 'Record your approval', status: 'In Progress', remark: 'Approved. Please proceed.' };
    } else if (a.blockEntry) {
      blocker = clip(a.blockEntry.text, 140);
      needed = 'You are CC\'d only. No action is required from you.';
      nextAction = { action: 'nudge', label: `Nudge ${first(a.blockEntry.author)} for an update`, status: p.status };
    } else {
      blocker = 'No blocker found in the timeline.';
      needed = 'No action is required from you.';
      nextAction = { action: 'close', label: 'Close task as resolved', status: 'Closed' };
    }
    const confidence = Math.min(0.95, 0.7 + a.t.length * 0.03);
    return { model: 'cicod-summariser-v1 (sovereign)', confidence, lines, blocker, neededFromYou: needed, nextAction, sources: a.t.length };
  }

  function mockReply(p) {
    const a = analyse(p);
    const name = first(a.requester);
    const intent = clip(p.intent, 220);
    const partLate = /not in stock|kano/i.test(a.t.map(e => e.text).join(' '));
    const status = a.approvedByYou
      ? 'the replacement fuser unit has been approved for transfer from Kano store and is expected at Central Store within 2 working days'
      : partLate ? 'the printer needs a replacement fuser unit, which is not in stock at Central Store; a transfer from Kano store is awaiting approval' : 'your request is being worked on by the IT Support team';
    const extra = intent ? ` ${intent.replace(/\.?$/, '.')}` : '';
    const sign = p.viewer || 'ECMS Officer';
    let text;
    if (p.tone === 'citizen') {
      text = `Hello ${name},\n\nThank you for your patience. Here is where things stand: ${status}.${extra} In the meantime, you can send documents for Monday's board meeting to the 3rd floor printer (Room 305).\n\nWe will update you as soon as it is fixed.\n\n${sign}`;
    } else if (p.tone === 'brief') {
      text = `Update on #${p.taskId}: ${status}.${extra} Use the 3rd floor printer (Room 305) until then.`;
    } else {
      text = `Dear ${name},\n\nRE: TASK #${p.taskId}: ${String(p.title || '').toUpperCase()}\n\nI write to inform you that ${status}.${extra} Kindly use the 3rd floor printer (Room 305) for the board papers in the interim.\n\nPlease accept our apologies for the inconvenience.\n\n${sign}\nHead, Admin & Supplies`;
    }
    return {
      model: 'cicod-writer-v1 (sovereign)',
      confidence: intent ? 0.9 : 0.84,
      text,
      basedOn: ['#17492 "Printer jam, 1st floor" (closed in 3d): reply template', 'Tone guide: ' + ({ formal: 'enterprise correspondence', citizen: 'Plain-language citizen reply', brief: 'Internal one-liner' }[p.tone] || 'enterprise correspondence')],
    };
  }

  class AITaskBrief extends HTMLElement {
    connectedCallback() {
      this.mode = this.getAttribute('mode') || 'brief';
      this.viewer = this.getAttribute('viewer') || '';
      this.source = document.querySelector(this.getAttribute('source'));
      if (this.mode === 'reply') this.renderReplyIdle(); else this.loadBrief();
    }

    read() {
      const s = this.source;
      const field = k => s?.querySelector(`[data-task-field="${k}"]`)?.textContent.trim() || '';
      const timeline = s ? [...s.querySelectorAll('[data-entry]')].map(e => ({
        author: e.dataset.author, when: e.dataset.when, kind: e.dataset.kind || 'remark', ocr: e.dataset.ocr || '',
        text: (e.querySelector('[data-entry-text]') || e).textContent.trim(),
      })) : [];
      return { taskId: field('id').replace('#', ''), title: field('title'), status: field('status'), priority: field('priority'), viewer: this.viewer, timeline };
    }

    /* ---------- Brief mode ---------- */
    async loadBrief() {
      this.innerHTML = `<section class="aitb" aria-live="polite">
        <div class="aitb__head"><span class="aitb__title"><span class="ai-badge">CICOD-AI</span> Task brief</span><span class="ai-confidence">reading timeline…</span></div>
        <div class="aitb__body"><div class="ai-skeleton" style="width:92%"></div><div class="ai-skeleton" style="width:80%"></div><div class="ai-skeleton" style="width:86%"></div><div class="ai-skeleton" style="width:64%"></div><div class="ai-skeleton" style="width:72%"></div></div>
      </section>`;
      const res = await request('/ecms/task-brief', this.read(), { mock: mockBrief, feature: 'ecms.task-brief' });
      this.result = res;
      this.renderBrief(res);
      this.dispatchEvent(new CustomEvent('ai-brief-result', { detail: res, bubbles: true }));
    }

    renderBrief(res) {
      const na = res.nextAction;
      this.innerHTML = `<section class="aitb" aria-live="polite">
        <div class="aitb__head"><span class="aitb__title"><span class="ai-badge">CICOD-AI</span> Task brief</span>
          <span class="ai-confidence">${Math.round(res.confidence * 100)}% · ${esc(res.model)} · ${esc(res.sources)} timeline items</span></div>
        <div class="aitb__body">
          <ol class="aitb__lines">${res.lines.map(l => `<li>${esc(l)}</li>`).join('')}</ol>
          <div class="aitb__grid">
            <div class="aitb__box aitb__box--block"><b>Current blocker</b>${esc(res.blocker)}</div>
            <div class="aitb__box aitb__box--you"><b>What's needed from you</b>${esc(res.neededFromYou)}</div>
          </div>
          <div class="aitb__next"><span class="aitb__next-label">Next best action</span>
            <button class="aitb__chip" type="button" data-next>✦ ${esc(na.label)}</button>
            ${na.status ? `<span class="aitb__next-hint">moves status to ${esc(na.status)}</span>` : ''}</div>
        </div>
        <div class="aitb__actions">
          <button class="g-btn g-btn--sm" data-useful type="button">Useful</button>
          <button class="g-btn g-btn--sm" data-wrong type="button">Not right</button>
          <button class="g-btn g-btn--sm g-btn--ghost" data-refresh type="button">↻ Refresh brief</button>
          <span class="aitb__mode">Summary only · check the timeline before you act</span>
        </div>
      </section>`;
      this.querySelector('[data-next]').addEventListener('click', e => {
        feedback(res.id, 'ecms.task-brief', 'accepted-next-action', { action: na.action });
        e.currentTarget.classList.add('aitb__chip--done'); e.currentTarget.textContent = '✓ ' + na.label;
        e.currentTarget.disabled = true;
        this.dispatchEvent(new CustomEvent('ai-task-action', { detail: na, bubbles: true }));
      });
      this.querySelector('[data-useful]').addEventListener('click', e => { feedback(res.id, 'ecms.task-brief', 'useful'); e.currentTarget.textContent = 'Thanks ✓'; });
      this.querySelector('[data-wrong]').addEventListener('click', e => { feedback(res.id, 'ecms.task-brief', 'rejected'); e.currentTarget.textContent = 'Flagged for review'; });
      this.querySelector('[data-refresh]').addEventListener('click', () => this.loadBrief());
    }

    /** Called by the host after it changes the timeline (e.g. a new remark). */
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

    async suggest() {
      const tone = this.querySelector('[data-tone]').value;
      const intentEl = document.querySelector(this.getAttribute('intent'));
      const box = this.querySelector('[data-draft]');
      box.hidden = false;
      box.innerHTML = '<div class="ai-skeleton" style="width:40%"></div><div class="ai-skeleton" style="width:95%"></div><div class="ai-skeleton" style="width:88%"></div><div class="ai-skeleton" style="width:60%"></div>';
      const base = this.read();
      const requester = base.timeline[0]?.author || '';
      const res = await request('/ecms/suggest-reply', { ...base, tone, intent: intentEl?.value || '', requester }, { mock: mockReply, feature: 'ecms.suggest-reply' });
      this.reply = { ...res, tone };
      box.innerHTML = `<div class="aitb__draft-head"><span>Draft · ${esc({ formal: 'Formal', citizen: 'Citizen-friendly', brief: 'Brief' }[tone])}</span><span class="ai-confidence">${Math.round(res.confidence * 100)}% · ${esc(res.model)}</span></div>
        <pre class="aitb__draft-text" data-text></pre>
        <div class="aitb__based">Based on: ${res.basedOn.map(esc).join(' · ')}</div>
        <div class="aitb__draft-actions">
          <button class="g-btn g-btn--ai g-btn--sm" data-insert type="button">Insert into remark</button>
          <button class="g-btn g-btn--sm" data-regen type="button">Regenerate</button>
          <button class="g-btn g-btn--sm g-btn--ghost" data-discard type="button">Discard</button>
        </div>`;
      reveal(box.querySelector('[data-text]'), res.text);
      box.querySelector('[data-insert]').addEventListener('click', () => {
        feedback(res.id, 'ecms.suggest-reply', 'accepted', { tone });
        this.dispatchEvent(new CustomEvent('ai-reply-insert', { detail: { text: res.text, tone }, bubbles: true }));
        box.innerHTML = '<div class="aitb__inserted">✓ Draft inserted into the remark box. Edit it there before you post.</div>';
        this.reply = null;
      });
      box.querySelector('[data-regen]').addEventListener('click', () => { feedback(res.id, 'ecms.suggest-reply', 'regenerated'); this.suggest(); });
      box.querySelector('[data-discard]').addEventListener('click', () => { feedback(res.id, 'ecms.suggest-reply', 'rejected'); box.hidden = true; box.innerHTML = ''; this.reply = null; });
    }
  }

  customElements.define('ai-task-brief', AITaskBrief);
})();
