/* <ai-doc-assistant file="Budget FMLD_1224_V 2.pdf" classification="Secret (S)" owner="Favour Ifeanacho" size="359.34 KB" tab="summary">
   Side panel for the Drive file viewer. It has three tabs:
     Summary     executive summary, key points, figures and dates, each with a page reference
     Ask         questions about the document; every answer cites the page(s) it came from
     Discussion  a comment thread on the file with CICOD-AI as a participant ("@CICOD-AI summarise this thread",
                 "Turn into task" on any comment)
   Secret and Top Secret files are only processed by the sovereign (on-premises) model, and the
   panel says so. The component never changes Drive data itself: the host page applies each outcome.
   Attributes:
     file, classification, owner, size   the file being viewed (change them to switch file)
     tab                                  summary | ask | discussion (initial tab)
   Events (bubbles):
     ai-doc-summary-save  detail: { file, summary }             host stores it in "Details and activity"
     ai-doc-comment       detail: { file, author, text, ai }    host appends it to the file's thread
     ai-doc-task          detail: { file, title, queue, assignee, due, fromComment }  host creates the ECMS task
   Gateway: POST /drive/doc-assist
     { action: "summarise" | "ask" | "thread-summary" | "comment-to-task", file, classification, question?, comments?, comment? }
     -> summarise:       { model, sovereign, summary, keyPoints[{text,page}], figures[{label,value,page}], dates[{label,date,page}], confidence }
     -> ask:             { model, sovereign, answer, citations[{page,quote}], confidence }
     -> thread-summary:  { model, sovereign, text, open[] }
     -> comment-to-task: { model, task:{ title, queue, assignee, due } } */
(function () {
  const { request, feedback, esc } = window.AIGateway;
  const FEATURE = 'drive.doc-assistant';

  // Prototype-only document text. File names, owners and classifications come from the live
  // cicod General Documents folder; the page contents are illustrative.
  const DOCS = {
    'Budget FMLD_1224_V 2.pdf': {
      unit: 'p.', pages: 14,
      summary: 'The Federal Ministry of Livestock Development (FMLD) 2025 budget proposal, version 2. It asks for ₦79.6bn in total, weighted towards capital projects for ranch and pasture development. It revises version 1 after the Budget Office ceiling letter.',
      passages: [
        { page: 2, text: 'Total 2025 budget proposal is ₦79.6bn: capital ₦48.2bn, overhead ₦21.6bn and personnel ₦9.8bn.' },
        { page: 3, text: 'Version 2 reduces the capital request by ₦6.4bn to stay within the Budget Office ceiling letter dated 30 September 2025.' },
        { page: 6, text: 'Pasture development and grazing reserve rehabilitation is allocated ₦18.5bn across 7 states, the largest single capital line.' },
        { page: 8, text: 'Veterinary services and vaccine procurement receive ₦6.1bn, including a cold-chain upgrade for 12 state laboratories.' },
        { page: 11, text: 'Personnel cost of ₦9.8bn covers 1,240 staff on the nominal roll; no new recruitment is planned in 2025.' },
        { page: 13, text: 'Submission to the Budget Office is due on 15 October 2025. The ministry will defend the proposal before the National Assembly committee on 12 November 2025.' },
        { page: 14, text: 'First quarter capital release is expected by 31 January 2026, subject to the Appropriation Act being signed.' },
      ],
      figures: [['Total proposal', '₦79.6bn', 2], ['Capital', '₦48.2bn', 2], ['Overhead', '₦21.6bn', 2], ['Personnel', '₦9.8bn', 11], ['Pasture development', '₦18.5bn', 6]],
      dates: [['Budget Office ceiling letter', '30 Sep 2025', 3], ['Submission to Budget Office', '15 Oct 2025', 13], ['NASS committee defence', '12 Nov 2025', 13], ['Q1 capital release', '31 Jan 2026', 14]],
      thread: [
        { author: 'Favour Ifeanacho', when: 'Sep 12, 2026 10:04 AM', text: 'The pasture development line on p.6 looks higher than last year. Can someone confirm the basis?' },
        { author: 'Ann Nya', when: 'Sep 12, 2026 11:30 AM', text: 'Please treat and circulate the revised figures to Director Finance by Friday.' },
        { author: 'Ruth Salau', when: 'Sep 13, 2026 9:15 AM', text: 'We still need the NASS-approved ceiling before we sign off version 2.' },
      ],
    },
    'CICOD Drive USER MANUAL.pptx': {
      unit: 'slide', pages: 42,
      summary: 'The official CICOD Drive user manual. It walks staff through uploading, classifying, sharing, signing and versioning files, and explains the approval log.',
      passages: [
        { page: 4, text: 'Use NEW then Upload File(s) to add documents. The maximum file size is 100 MB per file.' },
        { page: 9, text: 'Every file must have a classification: Official (O), Confidential (C), Secret (S) or Top Secret (TS). Use Edit Classification to change it.' },
        { page: 15, text: 'Share File lets you share with a user, a department or an MDA. Secret files require approval before they can be shared.' },
        { page: 22, text: 'Sign File adds an electronic signature. The signer must be on the approval chain for the document.' },
        { page: 27, text: 'Version History keeps every earlier version. You can restore a previous version at any time.' },
        { page: 35, text: 'Deleted files stay in Trash for 30 days before they are removed permanently.' },
      ],
      figures: [['Max upload size', '100 MB', 4], ['Classification levels', '4', 9], ['Trash retention', '30 days', 35]],
      dates: [['Manual published', '16 May 2024', 1]],
      thread: [
        { author: 'Ruth Salau', when: 'May 17, 2024 2:10 PM', text: 'Slide 15 should mention that Confidential files also need a reason when shared outside the department.' },
        { author: 'Ann Nya', when: 'May 20, 2024 9:00 AM', text: 'Can we update the screenshots to the new CICOD Drive app?' },
      ],
    },
    'CICOD_ECMS_WORKFLOW_PLANNING_TEMPLATE(2).xlsx': {
      unit: 'sheet', pages: 4,
      summary: 'A planning template that MDAs fill in before an ECMS workflow is configured. It captures queues, queue types, statuses, escalation rules and approvers.',
      passages: [
        { page: 1, text: 'Sheet "Queues" lists each queue with its queue type, owner department and default priority.' },
        { page: 2, text: 'Sheet "Statuses" defines the status flow. Each status needs an SLA in hours and a responsible role.' },
        { page: 3, text: 'Sheet "Escalation" sets escalation after 48 hours to the line manager, and after 96 hours to the head of department.' },
        { page: 4, text: 'Sheet "Approvals" lists approval levels. Requests above ₦200,000 need HOD approval.' },
      ],
      figures: [['First escalation', '48 hours', 3], ['Second escalation', '96 hours', 3], ['HOD approval threshold', '₦200,000', 4]],
      dates: [['Template version date', '5 Oct 2025', 1]],
      thread: [{ author: 'Favour Ifeanacho', when: 'Oct 5, 2025 10:20 PM', text: 'Please use this version for the CICOD-AI IMPLEMENTATION queue set-up.' }],
    },
    'Midas_Media_License_and_Usage_Guide.docx': {
      unit: 'p.', pages: 6,
      summary: 'A licence and usage guide for Midas Media content. It sets out what the ministry may publish, the attribution required and the licence term.',
      passages: [
        { page: 1, text: 'The licence runs for 12 months from 12 May 2026 and covers non-commercial enterprise publications.' },
        { page: 2, text: 'Every published image or clip must carry the credit line "© Midas Media, used under licence".' },
        { page: 3, text: 'Content may not be edited beyond cropping and resizing without written consent.' },
        { page: 5, text: 'Renewal notice must be given at least 30 days before the licence expires, so by 12 April 2027.' },
      ],
      figures: [['Licence term', '12 months', 1], ['Renewal notice', '30 days', 5]],
      dates: [['Licence start', '12 May 2026', 1], ['Renewal notice due', '12 Apr 2027', 5], ['Licence end', '11 May 2027', 1]],
      thread: [],
    },
  };

  const isSovereign = c => /secret/i.test(c || '');
  const modelFor = c => (isSovereign(c) ? 'cicod-llm-sovereign (on-prem)' : 'cicod-llm-v2 (cicod cloud)');
  const STOP = new Set('the a an of to in on for is are was were what when who how which does do did this that and or by with from it its be about any there much many'.split(' '));
  const words = s => String(s).toLowerCase().replace(/[^a-z0-9₦.\s]/g, ' ').split(/\s+/).filter(w => w.length > 2 && !STOP.has(w));

  function docFor(file) {
    if (DOCS[file]) return DOCS[file];
    const img = /\.(png|jpe?g)$/i.test(file);
    return {
      unit: 'p.', pages: img ? 1 : 12,
      summary: img ? `"${file}" is an image. OCR found no meaningful text, so only its details can be summarised.` : `"${file}" was indexed. It is a general reference document with no figures or deadlines relevant to the ministry.`,
      passages: img ? [] : [{ page: 1, text: `${file} is a general reference document held in General Documents.` }],
      figures: [], dates: [], thread: [],
    };
  }

  function mock(p) {
    const doc = docFor(p.file);
    const base = { model: modelFor(p.classification), sovereign: isSovereign(p.classification) };
    if (p.action === 'summarise') {
      return { ...base, summary: doc.summary, unit: doc.unit,
        keyPoints: doc.passages.slice(0, 5).map(x => ({ text: x.text, page: x.page })),
        figures: doc.figures.map(([label, value, page]) => ({ label, value, page })),
        dates: doc.dates.map(([label, date, page]) => ({ label, date, page })),
        confidence: doc.passages.length ? 0.9 : 0.55 };
    }
    if (p.action === 'ask') {
      const q = words(p.question);
      const scored = doc.passages.map(x => ({ ...x, score: q.filter(w => x.text.toLowerCase().includes(w)).length })).filter(x => x.score > 0).sort((a, b) => b.score - a.score).slice(0, 2);
      if (!scored.length) return { ...base, unit: doc.unit, answer: `I couldn't find this in "${p.file}". The document doesn't cover it, so I won't guess. Try asking about ${doc.figures[0] ? doc.figures[0][0].toLowerCase() : 'its contents'} or the key dates.`, citations: [], confidence: 0.3 };
      return { ...base, unit: doc.unit, answer: scored.map(x => x.text).join(' '), citations: scored.map(x => ({ page: x.page, quote: x.text.slice(0, 90) + (x.text.length > 90 ? '…' : '') })), confidence: Math.min(0.95, 0.62 + scored[0].score * 0.1) };
    }
    if (p.action === 'thread-summary') {
      const c = p.comments || [];
      const people = [...new Set(c.map(x => x.author))];
      const open = c.filter(x => /please|need|can someone|confirm|should|\?/i.test(x.text)).map(x => `${x.author}: ${x.text}`);
      return { ...base, text: c.length ? `${c.length} comments from ${people.join(', ')}. ${open.length} still need action; nobody has answered them in the thread yet.` : 'There are no comments on this file yet.', open };
    }
    if (p.action === 'comment-to-task') {
      const t = p.comment.text;
      const due = /friday/i.test(t) ? 'Fri 02 Oct 2026' : /today|urgent/i.test(t) ? 'Mon 28 Sep 2026' : 'Mon 05 Oct 2026';
      const queue = /budget|figure|ceiling|finance|₦/i.test(t) ? 'Correspondence' : /screenshot|app|system/i.test(t) ? 'IT Support' : 'Correspondence';
      const title = t.replace(/^please (treat and )?/i, '').replace(/\?$/, '').slice(0, 70);
      return { ...base, task: { title: `${title.charAt(0).toUpperCase()}${title.slice(1)} (${p.file})`, queue, assignee: p.comment.author === 'Ann Nya' ? 'Ruth Salau' : 'Ann Nya', due } };
    }
    return base;
  }

  const TABS = [['summary', 'Summary'], ['ask', 'Ask this document'], ['discussion', 'Discussion']];
  const loading = '<div class="ai-skeleton" style="width:90%"></div><div class="ai-skeleton" style="width:70%"></div><div class="ai-skeleton" style="width:80%"></div><div class="ai-skeleton" style="width:55%"></div>';

  class AIDocAssistant extends HTMLElement {
    static get observedAttributes() { return ['file', 'tab']; }
    connectedCallback() { this.ready = true; this.load(); }
    attributeChangedCallback() { if (this.ready) this.load(); }

    load() {
      this.file = this.getAttribute('file') || '';
      this.cls = this.getAttribute('classification') || 'Official (O)';
      this.tab = this.getAttribute('tab') || 'summary';
      this.doc = docFor(this.file);
      this.comments = this.doc.thread.map(c => ({ ...c }));
      this.summaryRes = null; this.answers = [];
      this.renderFrame();
    }

    renderFrame() {
      const sov = isSovereign(this.cls);
      this.innerHTML = `<section class="aida" aria-live="polite">
        <div class="aida__head">
          <div class="aida__file"><span class="aida__name">${esc(this.file || 'No file selected')}</span>
            <span class="aida__meta">${esc(this.getAttribute('owner') || '')} · ${esc(this.getAttribute('size') || '')} · <span class="g-chip ${sov ? 'g-chip--bad' : 'g-chip--ok'}">${esc(this.cls)}</span></span></div>
          ${sov ? '<div class="aida__sov">🔒 Processed on sovereign model only. Nothing leaves the secure enterprise data centre.</div>' : ''}
        </div>
        <div class="aida__tabs" role="tablist">${TABS.map(([k, l]) => `<button type="button" role="tab" class="aida__tab ${k === this.tab ? 'aida__tab--on' : ''}" data-tab="${k}">${k === 'discussion' ? l : '✦ ' + l}</button>`).join('')}</div>
        <div class="aida__body"></div>
      </section>`;
      this.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => { this.tab = b.dataset.tab; this.querySelectorAll('.aida__tab').forEach(x => x.classList.toggle('aida__tab--on', x === b)); this.renderTab(); }));
      this.renderTab();
    }

    body() { return this.querySelector('.aida__body'); }
    payload(extra) { return { file: this.file, classification: this.cls, ...extra }; }
    cite(p) { return `<span class="aida__cite">${esc(this.doc.unit)} ${esc(p)}</span>`; }

    renderTab() {
      if (this.tab === 'summary') return this.summaryRes ? this.renderSummary(this.summaryRes) : this.renderSummaryEmpty();
      if (this.tab === 'ask') return this.renderAsk();
      return this.renderDiscussion();
    }

    // ── Summary ──
    renderSummaryEmpty() {
      this.body().innerHTML = `<p class="aida__empty">Get an executive summary with key points, figures and dates. Each item shows the ${esc(this.doc.unit === 'p.' ? 'page' : this.doc.unit)} it came from (${this.doc.pages} in total).</p>
        <button class="g-btn g-btn--ai" type="button" data-aida-run>✦ Summarise</button>`;
      this.querySelector('[data-aida-run]').addEventListener('click', () => this.summarise());
    }

    async summarise() {
      this.body().innerHTML = loading;
      const res = await request('/drive/doc-assist', this.payload({ action: 'summarise' }), { mock, feature: FEATURE });
      this.summaryRes = res;
      if (this.tab === 'summary') this.renderSummary(res);
    }

    renderSummary(r) {
      this.body().innerHTML = `
        <div class="aida__row"><span class="ai-badge">Summary</span><span class="ai-confidence">${Math.round(r.confidence * 100)}% · ${esc(r.model)}</span></div>
        <p class="aida__summary">${esc(r.summary)}</p>
        ${r.keyPoints.length ? `<h5 class="aida__h">Key points</h5><ul class="aida__list">${r.keyPoints.map(k => `<li>${esc(k.text)} ${this.cite(k.page)}</li>`).join('')}</ul>` : ''}
        ${r.figures.length ? `<h5 class="aida__h">Figures</h5><div class="aida__grid">${r.figures.map(f => `<div class="aida__fig"><b>${esc(f.value)}</b><span>${esc(f.label)} ${this.cite(f.page)}</span></div>`).join('')}</div>` : ''}
        ${r.dates.length ? `<h5 class="aida__h">Dates</h5><div class="aida__dates">${r.dates.map(d => `<div class="aida__date"><b>${esc(d.date)}</b><span>${esc(d.label)} ${this.cite(d.page)}</span></div>`).join('')}</div>` : ''}
        <div class="aida__actions">
          <button class="g-btn g-btn--ai g-btn--sm" type="button" data-save>Save to file details</button>
          <button class="g-btn g-btn--sm" type="button" data-regen>Regenerate</button>
          <button class="g-btn g-btn--sm" type="button" data-bad>Not accurate</button>
          <span class="aida__mode">CICOD-AI summary · check against the source</span>
        </div>`;
      this.querySelector('[data-save]').addEventListener('click', e => {
        feedback(r.id, FEATURE, 'accepted', { file: this.file });
        e.target.textContent = 'Saved ✓'; e.target.disabled = true;
        this.dispatchEvent(new CustomEvent('ai-doc-summary-save', { detail: { file: this.file, summary: r.summary }, bubbles: true }));
      });
      this.querySelector('[data-regen]').addEventListener('click', () => { feedback(r.id, FEATURE, 'regenerated'); this.summarise(); });
      this.querySelector('[data-bad]').addEventListener('click', e => { feedback(r.id, FEATURE, 'rejected'); e.target.textContent = 'Thanks, flagged for review'; e.target.disabled = true; });
    }

    // ── Ask ──
    renderAsk() {
      const chips = this.doc.figures.slice(0, 2).map(f => `What is the ${f[0].toLowerCase()}?`).concat(this.doc.dates[0] ? [`When is the ${this.doc.dates[0][0].toLowerCase()}?`] : []);
      this.body().innerHTML = `
        <div class="aida__qa">${this.answers.map(a => this.answerHtml(a)).join('') || `<p class="aida__empty">Ask anything about this document. Answers only use its text, and cite the ${esc(this.doc.unit === 'p.' ? 'page' : this.doc.unit)} they came from.</p>`}</div>
        ${chips.length ? `<div class="aida__chips">${chips.map(c => `<button type="button" class="g-chip g-chip--ai aida__chip" data-q="${esc(c)}">${esc(c)}</button>`).join('')}</div>` : ''}
        <form class="aida__ask" data-ask-form>
          <input class="g-input" name="q" placeholder="e.g. How much is allocated to veterinary services?" aria-label="Ask this document">
          <button class="g-btn g-btn--ai" type="submit">Ask</button>
        </form>`;
      const form = this.querySelector('[data-ask-form]');
      const qa = this.querySelector('.aida__qa'); qa.scrollTop = qa.scrollHeight;
      form.addEventListener('submit', e => { e.preventDefault(); const q = form.q.value.trim(); if (q) this.ask(q); });
      this.querySelectorAll('[data-q]').forEach(b => b.addEventListener('click', () => this.ask(b.dataset.q)));
      this.bindAnswers();
    }

    answerHtml(a) {
      if (a.pending) return `<div class="aida__q">${esc(a.q)}</div><div class="aida__a">${loading}</div>`;
      return `<div class="aida__q">${esc(a.q)}</div>
        <div class="aida__a"><p>${esc(a.r.answer)}</p>
          ${a.r.citations.length ? `<div class="aida__sources">${a.r.citations.map(c => `<span class="aida__src">${this.cite(c.page)} "${esc(c.quote)}"</span>`).join('')}</div>` : ''}
          <div class="aida__row"><span class="ai-confidence">${Math.round(a.r.confidence * 100)}% · ${esc(a.r.model)}</span>
            <span class="aida__fb">${a.fb ? esc(a.fb) : `<button class="g-btn g-btn--ghost g-btn--sm" type="button" data-fb="${esc(a.r.id)}" data-v="helpful">Helpful</button><button class="g-btn g-btn--ghost g-btn--sm" type="button" data-fb="${esc(a.r.id)}" data-v="wrong">Wrong</button>`}</span></div>
        </div>`;
    }

    bindAnswers() {
      this.querySelectorAll('[data-fb]').forEach(b => b.addEventListener('click', () => {
        const a = this.answers.find(x => x.r && x.r.id === b.dataset.fb);
        feedback(a.r.id, FEATURE, b.dataset.v === 'helpful' ? 'accepted' : 'rejected');
        a.fb = b.dataset.v === 'helpful' ? 'Marked helpful ✓' : 'Flagged as wrong';
        if (this.tab === 'ask') this.renderAsk();
      }));
    }

    async ask(q) {
      const entry = { q, pending: true };
      this.answers.push(entry);
      this.renderAsk();
      entry.r = await request('/drive/doc-assist', this.payload({ action: 'ask', question: q }), { mock, feature: FEATURE });
      entry.pending = false;
      if (this.tab === 'ask') this.renderAsk();
    }

    // ── Discussion ──
    renderDiscussion() {
      this.body().innerHTML = `
        <div class="aida__thread">${this.comments.map((c, i) => `
          <div class="aida__cmt ${c.ai ? 'aida__cmt--ai' : ''}">
            <div class="aida__cmt-head"><span class="aida__av">${c.ai ? '✦' : esc(c.author.split(' ').map(w => w[0]).join('').slice(0, 2))}</span><b>${esc(c.author)}</b><span class="aida__when">${esc(c.when)}</span></div>
            <p>${esc(c.text)}</p>
            ${c.open ? `<ul class="aida__list">${c.open.map(o => `<li>${esc(o)}</li>`).join('')}</ul>` : ''}
            ${c.task ? `<div class="aida__task"><b>Proposed ECMS task</b><span>${esc(c.task.title)}</span><span>Queue: ${esc(c.task.queue)} · Assign to: ${esc(c.task.assignee)} · Due: ${esc(c.task.due)}</span>
                ${c.taskDone ? '<span class="aida__done">Task created ✓</span>' : `<span class="aida__task-actions"><button class="g-btn g-btn--ai g-btn--sm" type="button" data-create="${i}">Create task</button><button class="g-btn g-btn--sm" type="button" data-drop="${i}">Discard</button></span>`}</div>`
              : c.ai ? '' : c.taskPending ? '<div class="ai-skeleton" style="width:60%"></div>' : `<button class="g-btn g-btn--ghost g-btn--sm aida__totask" type="button" data-totask="${i}">✦ Turn into task</button>`}
          </div>`).join('') || '<p class="aida__empty">No comments yet. Start the discussion, or type "@CICOD-AI summarise this thread".</p>'}
        </div>
        <form class="aida__ask" data-cmt-form>
          <input class="g-input" name="c" placeholder='Comment, or "@CICOD-AI summarise this thread"' aria-label="Add a comment">
          <button class="g-btn g-btn--primary" type="submit">Post</button>
        </form>
        <div class="aida__chips"><button type="button" class="g-chip g-chip--ai aida__chip" data-ai-sum>@CICOD-AI summarise this thread</button></div>`;
      const form = this.querySelector('[data-cmt-form]');
      form.addEventListener('submit', e => { e.preventDefault(); const t = form.c.value.trim(); if (t) this.post(t); });
      const th = this.querySelector('.aida__thread'); th.scrollTop = th.scrollHeight;
      this.querySelector('[data-ai-sum]').addEventListener('click', () => this.post('@CICOD-AI summarise this thread'));
      this.querySelectorAll('[data-totask]').forEach(b => b.addEventListener('click', () => this.toTask(+b.dataset.totask)));
      this.querySelectorAll('[data-create]').forEach(b => b.addEventListener('click', () => {
        const c = this.comments[+b.dataset.create];
        c.taskDone = true;
        feedback(c.taskId, FEATURE, 'accepted', { kind: 'comment-to-task' });
        this.dispatchEvent(new CustomEvent('ai-doc-task', { detail: { file: this.file, ...c.task, fromComment: c.text }, bubbles: true }));
        this.renderDiscussion();
      }));
      this.querySelectorAll('[data-drop]').forEach(b => b.addEventListener('click', () => {
        const c = this.comments[+b.dataset.drop];
        feedback(c.taskId, FEATURE, 'rejected', { kind: 'comment-to-task' });
        delete c.task; this.renderDiscussion();
      }));
    }

    now() { return new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }); }

    async post(text) {
      const human = { author: 'Prince Ekpenyong', when: this.now(), text };
      this.comments.push(human);
      this.dispatchEvent(new CustomEvent('ai-doc-comment', { detail: { file: this.file, author: human.author, text, ai: false }, bubbles: true }));
      if (!/@ai\b/i.test(text)) return this.renderDiscussion();
      const placeholder = { author: 'CICOD CICOD-AI', ai: true, when: 'thinking…', text: '…' };
      this.comments.push(placeholder);
      this.renderDiscussion();
      const humans = this.comments.filter(c => !c.ai && !/@ai\b/i.test(c.text));
      let r;
      if (/summar/i.test(text)) {
        r = await request('/drive/doc-assist', this.payload({ action: 'thread-summary', comments: humans }), { mock, feature: FEATURE });
        Object.assign(placeholder, { when: this.now(), text: r.text, open: r.open });
      } else {
        const q = text.replace(/@ai\b/i, '').trim();
        r = await request('/drive/doc-assist', this.payload({ action: 'ask', question: q }), { mock, feature: FEATURE });
        Object.assign(placeholder, { when: this.now(), text: r.answer + (r.citations.length ? ` (${r.citations.map(c => `${this.doc.unit} ${c.page}`).join(', ')})` : '') });
      }
      placeholder.text += ` · ${r.model}`;
      this.dispatchEvent(new CustomEvent('ai-doc-comment', { detail: { file: this.file, author: 'CICOD CICOD-AI', text: placeholder.text, ai: true }, bubbles: true }));
      if (this.tab === 'discussion') this.renderDiscussion();
    }

    async toTask(i) {
      const c = this.comments[i];
      c.taskPending = true; this.renderDiscussion();
      const r = await request('/drive/doc-assist', this.payload({ action: 'comment-to-task', comment: c }), { mock, feature: FEATURE });
      c.taskPending = false; c.task = r.task; c.taskId = r.id;
      if (this.tab === 'discussion') this.renderDiscussion();
    }
  }

  customElements.define('ai-doc-assistant', AIDocAssistant);
})();
