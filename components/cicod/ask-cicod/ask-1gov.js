/* <ai-ask-cicod clearance="Confidential" user="Prince E." department="Administration">
   A global "Ask CICOD" command palette for the top bar of every app (Ctrl+K / Cmd+K).
   One box does three jobs:
     1. Search and answer: plain-English questions across Drive, ECMS, InMail and IMS. The answer
        cites its sources and results are trimmed to what the user may see ("2 results hidden").
     2. Commands: "create a task for IT support about the printer" returns an action preview.
        Nothing happens until the user presses Confirm.
     3. Help: "how do I…" answers from the CICOD Help Centre and the CICOD Drive User Manual, with an
        escalation to Report an Issue (pre-filled) when the answer doesn't help.
   Attributes:
     clearance   highest classification the user may open: Public | Restricted | Confidential | Secret
     user        display name, used in command previews
     department  default department for commands
   Events (bubbles):
     ai-ask-result   detail: the full response
     ai-ask-open     detail: { result }            host opens the cited item in its app
     ai-ask-command  detail: { intent, fields }    host executes the confirmed action
     ai-ask-escalate detail: { subject, description }  host opens Report an Issue pre-filled
   Gateway: POST /search/ask
     { query, clearance, user, department, app:"workspace" }
     -> { model, mode:"search"|"command"|"help", answer?, citations:[n], results:[{id,app,type,title,path,classification,snippet}],
          hidden:{count,level}, command?:{intent,label,fields:{…},confidence}, help?:{title,steps[],source} } */
(function () {
  const { request, feedback, esc } = window.AIGateway;

  const LEVELS = ['Public', 'Restricted', 'Confidential', 'Secret', 'Top Secret'];
  const lvl = c => Math.max(0, LEVELS.indexOf(c));

  // Prototype index: a slice of what the unified index (2.2) would hold for cicod.
  const INDEX = [
    { id: 'd1', app: 'Drive', type: 'File', title: 'Procurement Policy 2025 (Revised).pdf', path: 'General Documents / Policies', classification: 'Restricted', updated: '14 Mar 2026', kw: 'procurement policy 2025 tender quotation purchase threshold board', snippet: 'Section 4.2: purchases above ₦5,000,000 need Tenders Board approval. Below that, three quotations and the Accounting Officer\'s approval are enough.' },
    { id: 'd2', app: 'Drive', type: 'File', title: 'Procurement committee minutes, 11 Sep 2026.docx', path: 'General Documents / MINUTES_OF_MEETINGS', classification: 'Confidential', updated: '12 Sep 2026', kw: 'procurement committee minutes policy threshold meeting', snippet: 'The committee adopted the revised 2025 procurement policy thresholds from 1 October 2026.' },
    { id: 's1', app: 'Drive', type: 'File', title: 'Data centre expansion: bid evaluation report.pdf', path: 'Departments / Procurement', classification: 'Secret', kw: 'procurement tender bid evaluation contract award policy 2025' },
    { id: 's2', app: 'InMail', type: 'Circular', title: 'Draft circular: procurement audit findings', path: 'Circular / Draft circulars', classification: 'Secret', kw: 'procurement audit findings circular policy' },
    { id: 'e1', app: 'ECMS', type: 'Task', title: '#17572 Printer on 2nd floor not working', path: 'IT Support · Hardware & Network · Open · High', classification: 'Restricted', updated: '26 Sep 2026', kw: 'printer 2nd floor it support not working hardware', snippet: 'Raised by Ann Nya on 26/09/2026. Assigned to Eyitayo Abidogun. SLA ends today 18:00.' },
    { id: 'e2', app: 'ECMS', type: 'Task', title: '#17569 Order not delivered, third complaint', path: 'Complaints · Application issue · Open', classification: 'Restricted', updated: '25 Sep 2026', kw: 'complaint complaints order delivered kano third', snippet: 'Citizen in Kano says a paid order is still not delivered. Third follow-up.' },
    { id: 'e3', app: 'ECMS', type: 'Report', title: 'Status Dashboard: Complaints queue', path: 'ECMS → Dashboard → Status Dashboard', classification: 'Restricted', updated: 'live', kw: 'complaints open how many count kano queue status', snippet: 'Complaints: 7 open tasks, 0 in progress. 2 of the 7 are tagged Kano (#17569, #17544).' },
    { id: 'm1', app: 'InMail', type: 'Circular', title: 'Circular: Resumption of 2026 APER exercise', path: 'Circular / All Circulars · Office of the Permanent Secretary', classification: 'Public', updated: '27 Sep 2026', kw: 'aper appraisal circular pms deadline performance', snippet: 'All officers must complete their 2026 APER forms on CICOD PMS by 31 October 2026.' },
    { id: 'm2', app: 'InMail', type: 'Circular', title: 'Circular: Revised official working hours', path: 'Circular / All Circulars · Human Resources', classification: 'Public', updated: '2 Sep 2026', kw: 'working hours circular resumption time close', snippet: 'Official hours are 8:00 to 16:00, Monday to Friday, from 1 September 2026.' },
    { id: 'i1', app: 'IMS', type: 'Asset', title: 'HP LaserJet Pro M404 · GT-IT-0112', path: 'Assets → Asset Registry · Admin block, 2nd floor', classification: 'Restricted', updated: '26 Sep 2026', kw: 'printer hp laserjet asset toner 2nd floor', snippet: 'Status: Faulty since 26 Sep. Central Store holds 2 compatible toner cartridges.' },
    { id: 'i2', app: 'IMS', type: 'Asset', title: 'Dell Latitude 5440 laptops', path: 'Assets → Bin Card View', classification: 'Restricted', updated: '24 Sep 2026', kw: 'laptop laptops stock dell central store kano store how many', snippet: 'Central Store: 12 in stock. Kano store: 3 in stock. Reorder point: 5.' },
    { id: 's3', app: 'IMS', type: 'Asset', title: 'Restricted equipment register · Kano store', path: 'Assets → Asset Registry', classification: 'Secret', kw: 'kano store stock register equipment laptop' },
  ];

  const HELP = [
    { k: /share|collaborat/i, title: 'Share a file on CICOD Drive', source: 'CICOD Drive User Manual.pdf, section 5 "Sharing and Collaboration", p. 14', steps: ['Open CICOD Drive and find the file in My Documents.', 'Click the ⋮ menu on the file row and choose Share.', 'Search for the colleague or department, then pick Viewer or Editor.', 'The file appears in their "Shared with me" panel until they accept it.'] },
    { k: /upload|add (a )?file/i, title: 'Upload a document to CICOD Drive', source: 'CICOD Drive User Manual.pdf, section 3 "Uploading Files", p. 8', steps: ['In CICOD Drive, click NEW → Upload.', 'Pick the file and choose its classification level (Public to Secret).', 'Choose the destination folder, e.g. General Documents or your department.', 'Click Upload. Files over 50 MB are uploaded in the background.'] },
    { k: /memo/i, title: 'Create and send a memo', source: 'CICOD Help Centre → ECMS → "Create a memo"', steps: ['Go to CICOD ECMS → Memos → Create Memo.', 'Fill in To, Through, Subject and the body.', 'Add attachments, then click Submit for review or Send.', 'Track it in Memos & Drafts.'] },
    { k: /approv/i, title: 'Approve or reject a task', source: 'CICOD Help Centre → ECMS → "Task Approvals"', steps: ['Go to CICOD ECMS → Tasks → Task Approvals.', 'Open the request and read the form and attachments.', 'Click Approve or Reject and add a comment. Rejections need a reason.'] },
    { k: /password|reset|otp|log ?in/i, title: 'Reset your password or OTP device', source: 'CICOD Help Centre → Account → "Sign-in problems"', steps: ['On the sign-in page, click Forgot password.', 'Enter your official email and follow the link sent to it.', 'If OTP codes fail, ask your tenant administrator to reset your OTP device.'] },
    { k: /meeting|conference|room/i, title: 'Schedule a meeting in Conference', source: 'CICOD Help Centre → Conference → "Schedule a meeting"', steps: ['Open Conference → Room(s) and pick your room.', 'Click Schedule Meeting, set the date, time and invitees.', 'Invitees get an InMail invite. Attendance is recorded automatically.'] },
  ];

  const QUEUES = [
    [/printer|laptop|network|internet|computer|password|system|email|scanner/i, 'IT Support', 'Hardware & Network'],
    [/complain|refund|not delivered|poor service/i, 'Complaints', 'Application issue'],
    [/order|deliver|dispatch|supply/i, 'Order Fulfilment', 'Delivery'],
    [/vehicle|car|repair|mechanic/i, 'AUTO MOBILE REPAIR', 'REPAIR DETAILS'],
    [/\bai\b|automat|process/i, 'CICOD-AI IMPLEMENTATION', 'PROCESS GATHERING'],
  ];
  const STOP = new Set('the a an of for to in on at is are was were me my i we our and or what where which who how find show get about with from all any do does this that 2026 please can you'.split(' '));

  function commandFor(q, { user, department }) {
    if (/\b(create|raise|log|open|start|new|make)\b.*\b(task|ticket|request)\b/i.test(q)) {
      const hit = QUEUES.find(([re]) => re.test(q)) || [null, 'Correspondence', 'General enquiry'];
      const about = (q.match(/\b(?:about|regarding|for|on)\s+(?:the\s+)?(.+)$/i) || [])[1] || q;
      const cleanAbout = about.replace(/^(it support|complaints|order fulfilment)\s+(about|regarding)\s+/i, '').replace(/^the\s+/i, '');
      const title = cleanAbout.charAt(0).toUpperCase() + cleanAbout.slice(1);
      const urgent = /urgent|asap|today|now/i.test(q);
      return { intent: 'ecms.createTask', label: 'Create ECMS task', confidence: hit[0] ? 0.91 : 0.64,
        fields: { Queue: hit[1], 'Queue type': hit[2], Title: title.length > 70 ? title.slice(0, 70) + '…' : title, Priority: urgent ? 'High' : 'Normal', 'Raised by': `${user} · ${department}` },
        note: /printer/i.test(q) ? 'A similar open task exists: #17572 "Printer on 2nd floor not working". Confirm only if this is a different printer.' : '' };
    }
    if (/\b(schedule|book|set up)\b.*\bmeeting\b/i.test(q)) {
      const when = (q.match(/\b(tomorrow|today|monday|tuesday|wednesday|thursday|friday)\b(?:\s+at\s+[\w:]+)?/i) || ['tomorrow'])[0];
      const who = (q.match(/\bwith\s+(.+?)(?:\s+(?:tomorrow|today|on|at)\b|$)/i) || [])[1] || 'Management team';
      return { intent: 'conference.schedule', label: 'Schedule meeting', confidence: 0.86, fields: { Room: 'Prince Room', When: when, Invitees: who, Duration: '45 min' }, note: '' };
    }
    return null;
  }

  function mockAsk({ query = '', clearance = 'Confidential', user = 'User', department = 'Administration' }) {
    const q = query.trim();
    const cmd = commandFor(q, { user, department });
    if (cmd) return { model: 'cicod-agent-v1 (tool-calling, sovereign)', mode: 'command', command: cmd, results: [], hidden: { count: 0 } };

    if (/^(how (do|can|to|should)|where (do|can) i|help)/i.test(q)) {
      const h = HELP.find(x => x.k.test(q));
      if (h) return { model: 'cicod-rag-v1 (help centre index)', mode: 'help', help: h, results: [], hidden: { count: 0 } };
      return { model: 'cicod-rag-v1 (help centre index)', mode: 'help', help: null, results: [], hidden: { count: 0 } };
    }

    const terms = q.toLowerCase().split(/[^a-z0-9]+/).filter(t => t.length > 1 && !STOP.has(t));
    const scored = INDEX.map(d => {
      const hay = `${d.title} ${d.kw}`.toLowerCase();
      const s = terms.reduce((n, t) => n + (hay.includes(t) ? (d.title.toLowerCase().includes(t) ? 2 : 1) : 0), 0);
      return { d, s };
    }).filter(x => x.s > 0).sort((a, b) => b.s - a.s);
    const visible = scored.filter(x => lvl(x.d.classification) <= lvl(clearance)).slice(0, 5).map(x => x.d);
    const hiddenDocs = scored.filter(x => lvl(x.d.classification) > lvl(clearance));
    const hiddenLevel = hiddenDocs.length ? hiddenDocs.map(x => x.d.classification).sort((a, b) => lvl(b) - lvl(a))[0] : null;

    let answer = '';
    const top = visible[0];
    if (!top) answer = `Nothing you can open matches "${q}". Try other words, or ask "how do I…" for help articles.`;
    else if (/how many|count|number of/i.test(q)) answer = `${top.snippet} [1]`;
    else answer = `${top.snippet} [1]` + (visible[1] && visible[1].snippet ? ` ${visible[1].snippet} [2]` : '');

    return {
      model: 'cicod-rag-v1 (sovereign) · unified index',
      mode: 'search',
      answer,
      results: visible.map(({ kw, ...d }) => d),
      hidden: { count: hiddenDocs.length, level: hiddenLevel },
    };
  }

  const EXAMPLES = ['find the 2025 procurement policy', 'how many complaints are open in Kano?', 'create a task for IT support about the printer on the 2nd floor', 'how do I share a file on CICOD Drive?', 'laptops in stock at Central Store'];
  const CLASS_CHIP = { Public: 'g-chip--ok', Restricted: 'g-chip--info', Confidential: 'g-chip--warn', Secret: 'g-chip--bad' };

  class AIAskCICOD extends HTMLElement {
    connectedCallback() {
      this.clearance = this.getAttribute('clearance') || 'Restricted';
      this.innerHTML = `<button class="aiak__trigger" type="button" data-trigger aria-haspopup="dialog">
          <span class="ai-badge">CICOD-AI</span><span class="aiak__trigger-text">Ask CICOD or search…</span><kbd class="aiak__kbd">Ctrl K</kbd></button>
        <div class="aiak__overlay" data-overlay hidden>
          <div class="aiak" role="dialog" aria-modal="true" aria-label="Ask CICOD">
            <div class="aiak__bar"><span class="ai-badge">Ask CICOD</span>
              <input class="aiak__input" data-q type="text" placeholder="Search, ask a question or give a command" aria-label="Ask CICOD" autocomplete="off">
              <button class="g-btn g-btn--sm g-btn--ghost" data-close type="button" aria-label="Close">Esc</button></div>
            <div class="aiak__body" data-body aria-live="polite"></div>
            <div class="aiak__foot"><span>Searching Drive, ECMS, InMail and Assets as <b>${esc(this.getAttribute('user') || 'you')}</b> · clearance <b>${esc(this.clearance)}</b></span><span>Enter to ask · Esc to close</span></div>
          </div>
        </div>`;
      this.overlay = this.querySelector('[data-overlay]');
      this.input = this.querySelector('[data-q]');
      this.querySelector('[data-trigger]').addEventListener('click', () => this.open());
      this.querySelector('[data-close]').addEventListener('click', () => this.close());
      this.overlay.addEventListener('click', e => { if (e.target === this.overlay) this.close(); });
      let t;
      this.input.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => this.ask(), 650); });
      this.input.addEventListener('keydown', e => { if (e.key === 'Enter') { clearTimeout(t); this.ask(); } });
      document.addEventListener('keydown', e => {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); this.overlay.hidden ? this.open() : this.close(); }
        else if (e.key === 'Escape' && !this.overlay.hidden) this.close();
      });
      this.renderEmpty();
    }

    open(text) {
      this.overlay.hidden = false;
      if (typeof text === 'string') { this.input.value = text; this.ask(); }
      setTimeout(() => this.input.focus(), 0);
    }
    close() { this.overlay.hidden = true; }

    renderEmpty() {
      this.querySelector('[data-body]').innerHTML = `<p class="aiak__hint">Try one of these:</p>
        <div class="aiak__examples">${EXAMPLES.map(x => `<button class="g-chip aiak__ex" type="button" data-ex="${esc(x)}">${esc(x)}</button>`).join('')}</div>`;
      this.querySelectorAll('[data-ex]').forEach(b => b.addEventListener('click', () => { this.input.value = b.dataset.ex; this.ask(); }));
    }

    async ask() {
      const query = this.input.value.trim();
      if (query.length < 3) return this.renderEmpty();
      const body = this.querySelector('[data-body]');
      body.innerHTML = '<div class="ai-skeleton" style="width:85%"></div><div class="ai-skeleton" style="width:65%"></div><div class="ai-skeleton" style="width:75%"></div>';
      const seq = (this.seq = (this.seq || 0) + 1);
      const res = await request('/search/ask', { query, clearance: this.clearance, user: this.getAttribute('user') || '', department: this.getAttribute('department') || '', app: 'workspace' }, { mock: mockAsk, feature: 'workspace.ask-cicod' });
      if (seq !== this.seq) return;
      this.result = res;
      if (res.mode === 'command') this.renderCommand(res);
      else if (res.mode === 'help') this.renderHelp(res, query);
      else this.renderSearch(res);
      this.dispatchEvent(new CustomEvent('ai-ask-result', { detail: res, bubbles: true }));
    }

    rateRow(res) {
      return `<div class="aiak__rate"><span class="ai-confidence">${esc(res.model)}</span>
        <button class="g-btn g-btn--sm" data-rate="helpful" type="button">Helpful</button>
        <button class="g-btn g-btn--sm" data-rate="not-helpful" type="button">Not helpful</button></div>`;
    }
    wireRate(res) {
      this.querySelectorAll('[data-rate]').forEach(b => b.addEventListener('click', () => {
        feedback(res.id, 'workspace.ask-cicod', b.dataset.rate);
        b.parentElement.querySelectorAll('[data-rate]').forEach(x => { x.disabled = true; });
        b.textContent += ' ✓';
      }));
    }

    renderSearch(res) {
      const answer = esc(res.answer).replace(/\[(\d)\]/g, '<sup class="aiak__cite">[$1]</sup>');
      const rows = res.results.map((r, i) => `<li class="aiak__res">
          <span class="aiak__num">${i + 1}</span>
          <div class="aiak__res-main"><div class="aiak__res-line"><span class="g-chip">${esc(r.app)} · ${esc(r.type)}</span><span class="g-chip ${CLASS_CHIP[r.classification] || ''}">${esc(r.classification)}</span></div>
            <b>${esc(r.title)}</b><small>${esc(r.path)}${r.updated ? ' · updated ' + esc(r.updated) : ''}</small></div>
          <button class="g-btn g-btn--sm" data-open="${i}" type="button">Open</button></li>`).join('');
      const hidden = res.hidden.count ? `<div class="aiak__hidden">🔒 ${res.hidden.count} result${res.hidden.count > 1 ? 's' : ''} hidden: classified ${esc(res.hidden.level)}, you lack access. Ask the document owner or your Head of Unit if you need them.</div>` : '';
      this.querySelector('[data-body]').innerHTML = `<div class="aiak__answer"><h5>Answer</h5><p>${answer}</p></div>
        ${rows ? `<h5 class="aiak__h">Sources</h5><ol class="aiak__list">${rows}</ol>` : ''}${hidden}${this.rateRow(res)}`;
      this.querySelectorAll('[data-open]').forEach(b => b.addEventListener('click', () => {
        const result = res.results[+b.dataset.open];
        feedback(res.id, 'workspace.ask-cicod', 'opened-result', { result: result.id, rank: +b.dataset.open + 1 });
        this.dispatchEvent(new CustomEvent('ai-ask-open', { detail: { result }, bubbles: true }));
        this.close();
      }));
      this.wireRate(res);
    }

    renderCommand(res) {
      const c = res.command;
      const fields = Object.entries(c.fields).map(([k, v]) => `<label class="aiak__field"><span class="g-label">${esc(k)}</span><input class="g-input" data-field="${esc(k)}" value="${esc(v)}"></label>`).join('');
      this.querySelector('[data-body]').innerHTML = `<div class="aiak__cmd"><div class="aiak__cmd-head"><b>Action preview: ${esc(c.label)}</b><span class="ai-confidence">${Math.round(c.confidence * 100)}% sure · ${esc(res.model)}</span></div>
          <p class="aiak__hint">Nothing has been created yet. Check the fields, edit them if needed, then confirm.</p>
          <div class="aiak__fields">${fields}</div>
          ${c.note ? `<div class="aiak__warn">${esc(c.note)}</div>` : ''}
          <div class="aiak__cmd-actions"><button class="g-btn g-btn--primary g-btn--sm" data-confirm type="button">Confirm</button>
            <button class="g-btn g-btn--sm" data-cancel type="button">Cancel</button></div></div>`;
      this.querySelector('[data-confirm]').addEventListener('click', () => {
        const edited = {};
        this.querySelectorAll('[data-field]').forEach(i => { edited[i.dataset.field] = i.value; });
        const changed = Object.keys(edited).filter(k => edited[k] !== c.fields[k]);
        feedback(res.id, 'workspace.ask-cicod', changed.length ? 'confirmed-edited' : 'confirmed', { intent: c.intent, changed });
        this.dispatchEvent(new CustomEvent('ai-ask-command', { detail: { intent: c.intent, fields: edited }, bubbles: true }));
        this.querySelector('[data-body]').innerHTML = `<div class="aiak__done">✓ ${esc(c.label)} sent. You can close this window.</div>`;
      });
      this.querySelector('[data-cancel]').addEventListener('click', () => { feedback(res.id, 'workspace.ask-cicod', 'cancelled', { intent: c.intent }); this.renderEmpty(); });
    }

    renderHelp(res, query) {
      const h = res.help;
      const body = this.querySelector('[data-body]');
      if (!h) {
        body.innerHTML = `<div class="aiak__answer"><h5>Help</h5><p>I couldn't find a Help Centre article for "${esc(query)}".</p></div>
          <div class="aiak__cmd-actions"><button class="g-btn g-btn--sm g-btn--primary" data-escalate type="button">Report an Issue (pre-filled)</button></div>`;
      } else {
        body.innerHTML = `<div class="aiak__answer"><h5>How to: ${esc(h.title)}</h5><ol class="aiak__steps">${h.steps.map(s => `<li>${esc(s)}</li>`).join('')}</ol>
          <p class="aiak__src">Source: ${esc(h.source)}</p></div>
          ${this.rateRow(res)}
          <p class="aiak__hint">Still stuck? <button class="g-btn g-btn--sm" data-escalate type="button">Report an Issue (pre-filled)</button></p>`;
        this.wireRate(res);
      }
      body.querySelector('[data-escalate]').addEventListener('click', () => {
        feedback(res.id, 'workspace.ask-cicod', 'escalated');
        this.dispatchEvent(new CustomEvent('ai-ask-escalate', { detail: { subject: `Help needed: ${query}`, description: `I asked Ask CICOD "${query}"${h ? ` and followed "${h.title}" (${h.source})` : ''}, but I still need help. Page: Workspace → Home.` }, bubbles: true }));
        this.close();
      });
    }
  }

  customElements.define('ai-ask-cicod', AIAskCICOD);
})();
