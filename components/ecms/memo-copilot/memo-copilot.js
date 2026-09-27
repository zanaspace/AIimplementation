/* <ai-memo-copilot editor="#memo-body" from="Director (ICT)" mda="CICOD">
   A "Draft with CICOD-AI" side panel for the ECMS memo editor. It does three things:
     1. Drafts a Nigerian official executive memo (Ref No, Date, To/Through/From, SUBJECT, numbered
        paragraphs, Recommendation) from the officer's bullet points.            (E-M1)
     2. Rewrites any text the officer selects in the editor: Formal, Concise,
        For Hon. Minister, Fix grammar.                                          (E-M2)
     3. Suggests a classification (Official / Confidential / Secret) with a reason,
        re-checked as the officer writes.                                        (E-M7)
   It never edits the memo itself. The host page owns the editor and applies each change.
   Attributes:
     editor  CSS selector of the contenteditable memo body (required for rewrite + classify)
     from    default "From" line when the bullets don't give one
     mda     tenant short name used in the Ref No (default CICOD)
   Events (bubbles):
     ai-memo-insert             detail: { mode: 'insert'|'replace', html, memo }   host puts the draft in the editor
     ai-memo-replace-selection  detail: { range, original, text, style }          host swaps the selected text
     ai-memo-classify           detail: { level, reason }                         host sets Settings → Classification
   Gateway:
     POST /ecms/memo/draft    { bullets, from, mda }            -> { model, confidence, memo:{refNo,date,to,through,from,subject,paras[],recommendation,signoff}, notes[] }
     POST /ecms/memo/rewrite  { text, style }                   -> { model, text, changes[] }
     POST /ecms/memo/classify { text }                          -> { model, level, confidence, reason, signals[] } */
(function () {
  const { request, feedback, esc } = window.AIGateway;

  /* ---------- helpers ---------- */
  const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  function below1000(n) {
    const h = Math.floor(n / 100), r = n % 100;
    const rest = r < 20 ? ONES[r] : TENS[Math.floor(r / 10)] + (r % 10 ? '-' + ONES[r % 10] : '');
    return [h ? ONES[h] + ' Hundred' : '', rest].filter(Boolean).join(h && rest ? ' and ' : '');
  }
  function words(n) {
    n = Math.floor(n);
    if (!n) return 'Zero';
    const parts = [];
    [[1e9, 'Billion'], [1e6, 'Million'], [1e3, 'Thousand'], [1, '']].forEach(([d, label]) => {
      const q = Math.floor(n / d); n %= d;
      if (q) parts.push(below1000(q) + (label ? ' ' + label : ''));
    });
    return parts.join(', ');
  }
  const naira = n => '₦' + n.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const MULT = { k: 1e3, thousand: 1e3, m: 1e6, million: 1e6, bn: 1e9, billion: 1e9 };
  function parseAmount(text) {
    let m = text.match(/(?:₦|\bNGN\s?|\bN(?=\d))\s?(\d[\d,]*(?:\.\d+)?)\s*(k|m|million|thousand|bn|billion)?\b/i)
      || text.match(/\b(\d[\d,]*(?:\.\d+)?)\s?(k|m|million|thousand|bn|billion)\b(?:\s*naira)?/i)
      || text.match(/\b(\d[\d,]*(?:\.\d+)?)\s*naira\b/i);
    if (!m) return null;
    return parseFloat(m[1].replace(/,/g, '')) * (MULT[(m[2] || '').toLowerCase()] || 1);
  }
  const today = () => { const d = new Date(); return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`; };
  const sentence = s => { s = s.trim().replace(/\s+/g, ' '); if (!s) return s; s = s[0].toUpperCase() + s.slice(1); return /[.!?]$/.test(s) ? s : s + '.'; };
  const lowerFirst = s => s ? s[0].toLowerCase() + s.slice(1) : s;

  const DEPTS = [
    { k: /laptop|computer|ict|server|network|software|printer|internet|licen[cs]e|scanner/i, code: 'ICT', name: 'Information & Communication Technology', vote: 'Capital' },
    { k: /vehicle|repair|renovat|roof|building|generator|plumb|office space|furniture/i, code: 'WKS', name: 'Works & Maintenance', vote: 'Capital' },
    { k: /staff|leave|training|promotion|posting|workshop|capacity|recruit/i, code: 'HRM', name: 'Human Resource Management', vote: 'Overhead' },
    { k: /procure|supply|tender|stationer|store|stock/i, code: 'PRC', name: 'Procurement', vote: 'Overhead' },
    { k: /budget|fund|payment|allowance|imprest|refund|arrears/i, code: 'FIN', name: 'Finance & Accounts', vote: 'Overhead' },
  ];

  /* ---------- mocks (prototype only) ---------- */
  function mockDraft({ bullets = '', from, mda = 'CICOD' }) {
    const lines = bullets.split(/\n+/).map(l => l.replace(/^\s*[-*•·\d.)]+\s*/, '').trim()).filter(Boolean);
    const head = {}; const facts = [];
    lines.forEach(l => {
      const m = l.match(/^(to|through|thru|via|from|subject|subj|re)\s*[:\-–]\s*(.+)$/i);
      if (m) head[{ thru: 'through', via: 'through', subj: 'subject', re: 'subject' }[m[1].toLowerCase()] || m[1].toLowerCase()] = m[2].trim();
      else facts.push(l);
    });
    const all = lines.join(' ');
    const amount = parseAmount(all);
    const urgent = /urgent|asap|immediately|as a matter of urgency|deadline|before (?:the )?end/i.test(all);
    const dept = DEPTS.find(d => d.k.test(all)) || { code: 'ADM', name: 'General Services', vote: 'Overhead' };
    const to = head.to ? head.to.replace(/^(the\s+)?/i, 'The ') : 'The Permanent Secretary';
    const toShort = to.replace(/^The\s+/i, '');
    const through = head.through || (amount ? 'Director, Finance & Accounts' : '');
    const fromLine = head.from || from || `Director (${dept.name})`;
    const cleanFact = s => s.replace(/\b(urgent(ly)?|asap|pls|please)\b[,:]?\s*/gi, '').replace(/\s*,\s*$/, '').trim();
    const ask = cleanFact(facts[0] || head.subject || 'the attached request');
    const askNoAmount = ask.replace(/,?\s*(?:₦|\bN(?=\d)|NGN)\s?\d[\d,.]*\s*(k|m|million|thousand)?\b/i, '').replace(/,?\s*\b\d[\d,.]*\s?(k|m|million|thousand)\b/i, '').trim() || ask;
    const object = (() => { const o = lowerFirst(askNoAmount.replace(/^(request(ing)?|approval)\s+(for|of)\s+/i, '')); return /^\d/.test(o) ? 'the procurement of ' + o : o; })();
    const subject = (head.subject || ('Request for approval: ' + askNoAmount)).toUpperCase();
    const n = String(100 + (all.length * 7) % 900);
    const paras = [];
    paras.push(`I write to seek the kind approval of the ${toShort} for ${object}.`);
    const rest = facts.slice(1).map(cleanFact).filter(f => f && !/^(amount|cost|total)\s*[:\-]/i.test(f));
    if (rest.length) paras.push('By way of background, ' + rest.map((r, i) => i ? sentence(r) : lowerFirst(sentence(r))).join(' '));
    else paras.push(`The request is necessary to sustain the ${dept.name} Department's delivery of its mandate, and the existing arrangement can no longer meet operational needs.`);
    if (amount) {
      const bigTicket = amount > 5e6;
      paras.push(`The total cost is ${naira(amount)} (${words(amount)} Naira only). Funds are available under the ${new Date().getFullYear()} ${dept.vote} provision of the Department, subject to confirmation by the Director, Finance & Accounts.` +
        (bigTicket ? ' As the sum exceeds the approval threshold of the Accounting Officer, the request will be forwarded for consideration by the Ministerial Tenders Board.' : ''));
    }
    if (urgent) paras.push('Given the operational urgency, the approval is sought as a matter of priority.');
    const recommendation = `In view of the above, the ${toShort} may wish to kindly approve ${object}${amount ? ` at the total cost of ${naira(amount)} (${words(amount)} Naira only)` : ''}.`;
    const conf = Math.min(0.95, 0.66 + (head.to ? 0.08 : 0) + (head.subject ? 0.06 : 0) + (amount ? 0.07 : 0) + Math.min(facts.length, 4) * 0.02);
    const notes = [];
    if (!head.to) notes.push('No "To:" line found, so it is addressed to the Permanent Secretary. Change it if needed.');
    if (!head.through && amount) notes.push('An amount was given, so the memo goes Through the Director, Finance & Accounts (Financial Regulations 2009, ch. 6).');
    if (!amount) notes.push('No amount found. Add one (e.g. "₦450k") to generate the financial implication paragraph.');
    if (urgent) notes.push('"Urgent" detected: an urgency paragraph was added.');
    return {
      model: 'cicod-docgen-v2 (sovereign) + MDA memo template',
      confidence: conf,
      memo: { refNo: `${mda}/${dept.code}/MEM/${new Date().getFullYear()}/${n}`, date: today(), to, through, from: fromLine, subject, paras, recommendation, signoff: fromLine },
      notes,
    };
  }

  const STYLE_LABEL = { formal: 'Formal', concise: 'Concise', minister: 'For Hon. Minister', grammar: 'Fix grammar' };
  function fixGrammar(t) {
    const fixes = [[/\bi\b/g, 'I'], [/\balot\b/gi, 'a lot'], [/\brecieve/gi, 'receive'], [/\bseperate/gi, 'separate'], [/\boccured\b/gi, 'occurred'], [/\bcant\b/gi, "can't"], [/\bdont\b/gi, "don't"], [/\bwont\b/gi, "won't"], [/\bdoesnt\b/gi, "doesn't"],
      [/\b(laptops|computers|vehicles|staff|officers|printers)((?: in [\w ]{1,24}?)?) is\b/gi, '$1$2 are'], [/\b(it|this|that) are\b/gi, '$1 is'], [/\s+,/g, ','], [/ {2,}/g, ' '], [/\bpls\b/gi, 'please']];
    const changes = [];
    fixes.forEach(([re, rep]) => { if (re.test(t)) { changes.push(String(re).replace(/\\b|\/g?i?/g, '') + ' corrected'); t = t.replace(re, rep); } });
    t = t.trim().replace(/(^|[.!?]\s+)([a-z])/g, (m, p, c) => p + c.toUpperCase());
    if (!/[.!?]$/.test(t)) t += '.';
    return { text: t, changes: changes.length ? ['Spelling, agreement and capitalisation fixed'] : ['Capitalisation and punctuation checked'] };
  }
  function mockRewrite({ text = '', style = 'formal' }) {
    let t = fixGrammar(text).text;
    const changes = [];
    if (style === 'formal' || style === 'minister') {
      [[/\bplease be informed that\b/gi, ''], [/\basap\b/gi, 'as a matter of urgency'], [/\bneed\b/gi, 'require'], [/\bget\b/gi, 'obtain'], [/\bnew ones\b/gi, 'replacements'], [/\bvery old\b/gi, 'obsolete'],
        [/\bcan't\b/gi, 'cannot'], [/\bdon't\b/gi, 'do not'], [/\bwon't\b/gi, 'will not'], [/\bbecause\b/gi, 'as'], [/\bok\b/gi, 'satisfactory'], [/\bthanks\b/gi, 'Thank you'], [/\bbuy\b/gi, 'procure']]
        .forEach(([re, rep]) => { t = t.replace(re, rep); });
      t = t.replace(/\s{2,}/g, ' ').trim().replace(/^([a-z])/, c => c.toUpperCase());
      changes.push('Informal words replaced with executive register', 'Contractions expanded');
    }
    if (style === 'formal') t = 'Kindly note that ' + lowerFirst(t);
    if (style === 'minister') {
      t = 'Hon. Minister may wish to note that ' + lowerFirst(t.replace(/\bwe\b/gi, 'the Ministry').replace(/\bour\b/gi, "the Ministry's").replace(/\bI (write|wish|seek|am)\b/g, (m, v) => 'the undersigned ' + (v === 'am' ? 'is' : v + 's')).replace(/\bI\b/g, 'the undersigned'));
      changes.push('Addressed to the Hon. Minister in the third person', '"We/our" changed to "the Ministry"');
    }
    if (style === 'concise') {
      t = t.replace(/\b(kindly note that|please be informed that|it is pertinent to note that|in order to|at this point in time|due to the fact that|with regards? to)\b/gi, m => ({ 'in order to': 'to', 'at this point in time': 'now', 'due to the fact that': 'because', 'with regard to': 'on', 'with regards to': 'on' }[m.toLowerCase()] || ''))
        .replace(/\b(very|really|basically|actually|quite)\s+/gi, '').replace(/\b(asap|as a matter of urgency)\b/gi, 'urgently').replace(/\bwe (require|need)\b/gi, 'we need').replace(/\bnew ones\b/gi, 'replacements').replace(/\s{2,}/g, ' ').trim().replace(/^([a-z])/, c => c.toUpperCase());
      const cut = t.split(/(?<=[.!?])\s+/); if (cut.length > 2) t = cut.slice(0, 2).join(' ');
      changes.push(`Shortened from ${text.split(/\s+/).length} to ${t.split(/\s+/).length} words`, 'Filler phrases removed');
    }
    if (style === 'grammar') changes.push(...fixGrammar(text).changes);
    return { model: 'cicod-docgen-v2 (sovereign)', text: t, changes };
  }

  const CLASS_RULES = [
    { level: 'Secret', k: /national security|intelligence|military|armed forces|arms|insurgen|classified|counter[- ]terror|security operation|dss\b/i, why: 'mentions security or intelligence matters' },
    { level: 'Confidential', k: /salary|salaries|disciplinary|query issued|personnel file|medical|nin\b|bvn|petition|tender|bid evaluation|contract sum|investigation|promotion list|staff audit|dismiss/i, why: 'contains personnel, financial-award or personal-data details' },
  ];
  function mockClassify({ text = '' }) {
    for (const r of CLASS_RULES) {
      const hits = [...new Set((text.match(new RegExp(r.k.source, 'gi')) || []).map(s => s.toLowerCase()))];
      if (hits.length) return { model: 'cicod-classifier-v1 (sovereign)', level: r.level, confidence: Math.min(0.96, 0.78 + hits.length * 0.06), reason: `The memo ${r.why}: "${hits.slice(0, 3).join('", "')}".`, signals: hits };
    }
    return { model: 'cicod-classifier-v1 (sovereign)', level: 'Official', confidence: 0.88, reason: 'Routine administrative content. No personal data, security or procurement-evaluation terms found.', signals: [] };
  }

  /* ---------- rendering ---------- */
  function memoHtml(m) {
    const row = (k, v) => v ? `<tr><td class="aimc-m__k">${esc(k)}:</td><td>${esc(v)}</td></tr>` : '';
    return `<div class="aimc-m">
      <table class="aimc-m__head"><tbody>${row('Ref No', m.refNo)}${row('Date', m.date)}${row('To', m.to)}${row('Through', m.through)}${row('From', m.from)}</tbody></table>
      <p class="aimc-m__subject"><b><u>${esc(m.subject)}</u></b></p>
      <ol class="aimc-m__paras">${m.paras.map(p => `<li>${esc(p)}</li>`).join('')}<li><b>Recommendation:</b> ${esc(m.recommendation)}</li></ol>
      <p class="aimc-m__sign">(Signed)<br>${esc(m.signoff)}</p>
    </div>`;
  }

  const EXAMPLE = 'To: Permanent Secretary\nThrough: Director, Finance & Accounts\nSubject: Replacement of obsolete laptops in the ICT Unit\n- 3 laptops for ICT unit, ₦450k, urgent\n- current laptops are 7 years old and cannot run the CICOD desktop app\n- quotations received from 3 vendors on the approved list';
  const LEVEL_CHIP = { Official: 'g-chip--ok', Confidential: 'g-chip--warn', Secret: 'g-chip--bad' };

  class AIMemoCopilot extends HTMLElement {
    connectedCallback() {
      this.editor = document.querySelector(this.getAttribute('editor'));
      this.render();
      if (!this.editor) return;
      let t;
      this.editor.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => this.classify(), 900); });
      setTimeout(() => this.classify(), 600);
      document.addEventListener('selectionchange', () => this.onSelection());
      window.addEventListener('scroll', () => { const p = this.querySelector('[data-pop]'); if (p && !p.hidden && this.range) this.placePop(p); }, { passive: true });
    }

    render() {
      this.innerHTML = `<section class="aimc" aria-live="polite">
        <div class="aimc__head"><span class="aimc__title"><span class="ai-badge">CICOD-AI</span> Draft with CICOD-AI</span><span class="ai-confidence">Memo Copilot</span></div>
        <div class="aimc__class" data-class><span class="aimc__muted">Classification: checking the memo…</span></div>
        <div class="aimc__body">
          <label class="g-label" for="aimc-bullets">Your points (To, Through, subject, key facts, amount)</label>
          <textarea class="g-textarea aimc__bullets" id="aimc-bullets" rows="6" placeholder="To: Permanent Secretary&#10;Subject: …&#10;- 3 laptops for ICT, ₦450k, urgent"></textarea>
          <div class="aimc__row"><button class="g-btn g-btn--ai g-btn--sm" data-draft type="button">✦ Draft memo</button><button class="g-btn g-btn--ghost g-btn--sm" data-example type="button">Use example</button></div>
          <div data-out></div>
        </div>
        <div class="aimc__rw">
          <b>Rewrite</b><span class="aimc__muted" data-rw-hint>Select text in the memo to rewrite it.</span>
          <div class="aimc__rw-btns">${Object.entries(STYLE_LABEL).map(([k, v]) => `<button class="g-btn g-btn--sm" data-style="${k}" type="button" disabled>${v}</button>`).join('')}</div>
        </div>
        <div class="aimc__pop" data-pop hidden></div>
      </section>`;
      this.querySelector('[data-example]').addEventListener('click', () => { this.querySelector('.aimc__bullets').value = EXAMPLE; });
      this.querySelector('[data-draft]').addEventListener('click', () => this.draft());
      this.querySelectorAll('[data-style]').forEach(b => {
        b.addEventListener('mousedown', e => e.preventDefault());
        b.addEventListener('click', () => this.rewrite(b.dataset.style));
      });
    }

    /* ----- 1. draft from bullets ----- */
    async draft() {
      const bullets = this.querySelector('.aimc__bullets').value.trim();
      const out = this.querySelector('[data-out]');
      if (bullets.length < 8) { out.innerHTML = '<p class="aimc__muted">Type at least one point, for example "3 laptops for ICT, ₦450k, urgent".</p>'; return; }
      out.innerHTML = '<div class="aimc__result"><div class="ai-skeleton" style="width:55%"></div><div class="ai-skeleton" style="width:90%"></div><div class="ai-skeleton" style="width:80%"></div><div class="ai-skeleton" style="width:70%"></div></div>';
      const res = await request('/ecms/memo/draft', { bullets, from: this.getAttribute('from'), mda: this.getAttribute('mda') || 'CICOD' }, { mock: mockDraft, feature: 'ecms.memo-copilot.draft' });
      this.draftRes = res;
      out.innerHTML = `<div class="aimc__result">
        <div class="aimc__result-head"><b>Draft ready</b><span class="ai-confidence">${Math.round(res.confidence * 100)}% · ${esc(res.model)}</span></div>
        <div class="aimc__preview">${memoHtml(res.memo)}</div>
        ${res.notes.length ? `<ul class="aimc__notes">${res.notes.map(n => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
        <div class="aimc__row">
          <button class="g-btn g-btn--ai g-btn--sm" data-ins="replace" type="button">Replace memo body</button>
          <button class="g-btn g-btn--sm" data-ins="insert" type="button">Insert at end</button>
          <button class="g-btn g-btn--ghost g-btn--sm" data-discard type="button">Discard</button>
        </div>
        <p class="aimc__muted aimc__wm">Marked "CICOD-AI-generated" until you edit and publish.</p>
      </div>`;
      out.querySelectorAll('[data-ins]').forEach(b => b.addEventListener('click', () => {
        feedback(res.id, 'ecms.memo-copilot.draft', 'accepted', { mode: b.dataset.ins });
        this.dispatchEvent(new CustomEvent('ai-memo-insert', { detail: { mode: b.dataset.ins, html: memoHtml(res.memo), memo: res.memo }, bubbles: true }));
        out.querySelector('.aimc__result-head b').textContent = b.dataset.ins === 'replace' ? 'Placed in the editor ✓' : 'Inserted at the end ✓';
      }));
      out.querySelector('[data-discard]').addEventListener('click', () => { feedback(res.id, 'ecms.memo-copilot.draft', 'rejected'); out.innerHTML = ''; });
    }

    /* ----- 2. rewrite selection ----- */
    onSelection() {
      if (this.busy) return;
      const sel = document.getSelection();
      const inEditor = sel && sel.rangeCount && !sel.isCollapsed && this.editor.contains(sel.anchorNode) && this.editor.contains(sel.focusNode);
      const text = inEditor ? sel.toString().trim() : '';
      const btns = this.querySelectorAll('[data-style]');
      if (text.length > 3) {
        this.range = sel.getRangeAt(0).cloneRange();
        this.selText = text;
        btns.forEach(b => { b.disabled = false; });
        this.querySelector('[data-rw-hint]').textContent = `${text.split(/\s+/).length} words selected`;
        this.showPop('options');
      } else if (!this.popLocked) {
        if (!inEditor && this.contains(document.activeElement)) return;
        this.hidePop();
      }
    }

    placePop(pop) {
      let r = this.range.getBoundingClientRect();
      if (r.bottom > window.innerHeight - 40 || r.top < 0) {
        const node = this.range.startContainer.nodeType === 1 ? this.range.startContainer : this.range.startContainer.parentElement;
        node.scrollIntoView({ block: 'center' });
        r = this.range.getBoundingClientRect();
      }
      const w = Math.min(320, window.innerWidth - 16);
      pop.style.width = w + 'px';
      pop.style.left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8)) + 'px';
      const h = pop.offsetHeight;
      const below = r.bottom + 8;
      pop.style.top = Math.max(8, below + h > window.innerHeight - 8 ? r.top - h - 8 : below) + 'px';
    }

    showPop(kind, data) {
      const pop = this.querySelector('[data-pop]');
      if (kind === 'options') {
        pop.innerHTML = `<div class="aimc__pop-row"><span class="ai-badge">Rewrite</span>${Object.entries(STYLE_LABEL).map(([k, v]) => `<button class="g-btn g-btn--sm" data-pstyle="${k}" type="button">${v}</button>`).join('')}</div>`;
        pop.querySelectorAll('[data-pstyle]').forEach(b => {
          b.addEventListener('mousedown', e => e.preventDefault());
          b.addEventListener('click', () => this.rewrite(b.dataset.pstyle));
        });
      } else if (kind === 'loading') {
        pop.innerHTML = '<div class="ai-skeleton" style="width:90%"></div><div class="ai-skeleton" style="width:70%"></div>';
      } else if (kind === 'result') {
        const res = data;
        pop.innerHTML = `<div class="aimc__pop-head"><b>${esc(STYLE_LABEL[res.style])}</b><span class="ai-confidence">${esc(res.model)}</span></div>
          <p class="aimc__pop-old">${esc(this.selText)}</p>
          <p class="aimc__pop-new">${esc(res.text)}</p>
          <ul class="aimc__notes">${res.changes.map(c => `<li>${esc(c)}</li>`).join('')}</ul>
          <div class="aimc__row"><button class="g-btn g-btn--ai g-btn--sm" data-replace type="button">Replace</button><button class="g-btn g-btn--sm" data-cancel type="button">Cancel</button></div>`;
        pop.querySelector('[data-replace]').addEventListener('click', () => {
          feedback(res.id, 'ecms.memo-copilot.rewrite', 'accepted', { style: res.style });
          this.dispatchEvent(new CustomEvent('ai-memo-replace-selection', { detail: { range: this.range, original: this.selText, text: res.text, style: res.style }, bubbles: true }));
          this.popLocked = false; this.hidePop(); this.resetRw();
        });
        pop.querySelector('[data-cancel]').addEventListener('click', () => { feedback(res.id, 'ecms.memo-copilot.rewrite', 'rejected', { style: res.style }); this.popLocked = false; this.hidePop(); });
      }
      pop.hidden = false;
      this.placePop(pop);
    }

    hidePop() { if (this.popLocked) return; const p = this.querySelector('[data-pop]'); if (p) p.hidden = true; }
    resetRw() { this.querySelectorAll('[data-style]').forEach(b => { b.disabled = true; }); this.querySelector('[data-rw-hint]').textContent = 'Select text in the memo to rewrite it.'; }

    async rewrite(style) {
      if (!this.range || !this.selText) return;
      this.popLocked = true; this.busy = true;
      this.showPop('loading');
      const res = await request('/ecms/memo/rewrite', { text: this.selText, style }, { mock: mockRewrite, feature: 'ecms.memo-copilot.rewrite' });
      this.busy = false;
      this.showPop('result', { ...res, style });
    }

    /* ----- 3. classification ----- */
    async classify() {
      const text = this.editor.innerText || '';
      const box = this.querySelector('[data-class]');
      if (text.trim().length < 20) { box.innerHTML = '<span class="aimc__muted">Classification: start writing and CICOD-AI will suggest one.</span>'; return; }
      box.innerHTML = '<div class="ai-skeleton" style="width:70%;margin:0"></div>';
      const res = await request('/ecms/memo/classify', { text }, { mock: mockClassify, feature: 'ecms.memo-copilot.classify', delay: 500 });
      if (this.appliedLevel === res.level) { box.innerHTML = `<span class="g-chip ${LEVEL_CHIP[res.level]}">${esc(res.level)}</span><span class="aimc__muted">Applied ✓ · still matches the content</span>`; return; }
      box.innerHTML = `<div class="aimc__class-row"><span class="aimc__muted">Suggested</span><span class="g-chip ${LEVEL_CHIP[res.level]}">${esc(res.level)}</span><span class="ai-confidence">${Math.round(res.confidence * 100)}%</span>
          <button class="g-btn g-btn--sm" data-capply type="button">Apply</button><button class="g-btn g-btn--ghost g-btn--sm" data-cdismiss type="button">Dismiss</button></div>
        <p class="aimc__class-why">${esc(res.reason)}</p>`;
      box.querySelector('[data-capply]').addEventListener('click', () => {
        this.appliedLevel = res.level;
        feedback(res.id, 'ecms.memo-copilot.classify', 'accepted', { level: res.level });
        this.dispatchEvent(new CustomEvent('ai-memo-classify', { detail: { level: res.level, reason: res.reason }, bubbles: true }));
        box.innerHTML = `<span class="g-chip ${LEVEL_CHIP[res.level]}">${esc(res.level)}</span><span class="aimc__muted">Applied to memo Settings ✓</span>`;
      });
      box.querySelector('[data-cdismiss]').addEventListener('click', () => { feedback(res.id, 'ecms.memo-copilot.classify', 'rejected', { level: res.level }); box.innerHTML = '<span class="aimc__muted">Suggestion dismissed. It will check again as you write.</span>'; });
    }
  }

  customElements.define('ai-memo-copilot', AIMemoCopilot);
})();
