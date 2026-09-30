/* <ai-request-finder catalog="#rq-cards" user="Prince Ekpenyong" department="Administration">
   A "Describe what you need" box above the Request Forms cards. It ranks the
   forms the user's role can raise and pulls field values out of the sentence
   ("expense request to Kaduna, ₦185,000, next week for 4 days").
   Attributes:
     catalog     (finder) selector of the element holding the cards; each card has data-form,
                 data-desc, data-queue and data-fields="FIELD A|FIELD B"
     user, department   the signed-in user's profile, used for name/department fields
   Events (bubbles):
     ai-request-match  detail: { query, matches[] }
     ai-request-open   detail: { form, fields:{label:value}, confidence }   host opens the form pre-filled
   Gateway:
     POST /forms/find      { query, user, department, forms:[{name,desc,queue,fields[]}] }
                           -> { model, matches:[{form,score,why,fields:{…}}] } */
(function () {
  const { request, feedback, esc } = window.AIGateway;

  // ---------- finder mock ----------
  const KEYS = {
    'EXPENSE REQUEST': /tour|trip|travel|advance|cash purchase|expense|imprest|per diem|journey|estacode|allowance|kaduna|kano|lagos|abuja/gi,
    'DATA CAPTURE': /id card|staff card|data capture|bio ?data|blood group|staff number|capture|photo|passport|identity card|record/gi,
    'PAY IN FORM': /pay ?-?in|paid|payment|teller|remit|deposit|rrr|refund|lodge/gi,
    'PARTICIPANT EVALUATION': /evaluat|training|workshop|course|seminar|participant|feedback|rate the/gi,
    'CICOD-AI IMPLEMENTATION': /automat|\bai\b|digiti|process|workflow|manual process/gi,
    'CICOD-AI IMPLEMENTATION (Copy)': /automat|\bai\b/gi,
    'FORM CREATION': /new form|create (a )?form|form creation|design a form/gi,
    'TEST AUTOMATION 186589319760': /test script|automated test|regression/gi,
    'Testing Internal Form - Request': /test form|testing/gi,
  };
  const CITIES = ['Kaduna', 'Kano', 'Lagos', 'Abuja', 'Port Harcourt', 'Enugu', 'Ibadan', 'Jos', 'Maiduguri', 'Sokoto', 'Calabar', 'Benin', 'Owerri', 'Ilorin'];
  const BANKS = ['Zenith Bank', 'Access Bank', 'First Bank', 'GTBank', 'UBA', 'Remita', 'CBN TSA'];
  const fmtN = n => '₦' + Math.round(n).toLocaleString('en-NG');
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); };
  const TODAY = '2026-09-27';

  function amountIn(q) {
    for (const m of q.matchAll(/(?:₦|ngn|naira)?\s?(\d[\d,]*(?:\.\d+)?)\s?(k|m|million|thousand)?\b/gi)) {
      let n = parseFloat(m[1].replace(/,/g, ''));
      if (n < 100 && !m[2]) continue;
      if (/^(k|thousand)$/i.test(m[2] || '')) n *= 1e3;
      if (/^(m|million)$/i.test(m[2] || '')) n *= 1e6;
      return fmtN(n);
    }
    return null;
  }

  function extract(form, q, { user, department }) {
    const [first, ...rest] = (user || '').split(' ');
    const city = CITIES.find(c => new RegExp(`\\b${c}\\b`, 'i').test(q));
    const days = +(q.match(/(\d+)\s*(?:days?|nights?)/i) || [])[1] || null;
    const start = /next week/i.test(q) ? '2026-10-05' : /tomorrow/i.test(q) ? addDays(TODAY, 1) : /monday/i.test(q) ? '2026-09-28' : null;
    const f = {};
    if (form.startsWith('EXPENSE REQUEST')) {
      f['Full name'] = user; f['Department'] = department;
      f['Advance type'] = /cash purchase|buy|purchase of|expense/i.test(q) ? 'Cash Purchase' : 'Expense Request';
      if (city) f['Destination'] = city;
      const purpose = (q.match(/\bfor (?:a |an |the )?((?:workshop|meeting|training|conference|inspection|monitoring|audit|seminar)[^,.]*)/i) || [])[1];
      if (purpose) f['Purpose'] = purpose.charAt(0).toUpperCase() + purpose.slice(1);
      if (start) f['Departure date'] = start;
      if (start && days) f['Return date'] = addDays(start, days);
      const a = amountIn(q); if (a) f['Amount requested (₦)'] = a;
    } else if (form === 'PAY IN FORM') {
      f['Full name'] = user; f['Department'] = department;
      const a = amountIn(q); if (a) f['Amount (₦)'] = a;
      const bank = BANKS.find(b => new RegExp(b.split(' ')[0], 'i').test(q)); if (bank) f['Bank'] = bank;
      const p = (q.match(/\bfor (.+)$/i) || [])[1]; if (p) f['Purpose of payment'] = p;
    } else if (form === 'PARTICIPANT EVALUATION') {
      f['Participant name'] = user;
      const t = (q.match(/\b(?:on|for|of) (?:the |a |an )?((?:[\w-]+ ){0,4}?(?:training|workshop|course|seminar))/i) || [])[1]; if (t) f['Training / programme'] = t.charAt(0).toUpperCase() + t.slice(1);
    } else if (form === 'DATA CAPTURE') {
      f['NAME(SURNAME FIRST)'] = [rest.join(' '), first].filter(Boolean).join(' ').toUpperCase();
      f['DEPARTMENT'] = department;
    } else if (form.startsWith('CICOD-AI IMPLEMENTATION')) {
      f['First Name'] = first; f['Last Name'] = rest.join(' ');
      f['WHAT PROCESS DO YOU WANT TO AUTOMATE'] = q;
    }
    return f;
  }

  function mockFind({ query = '', user, department, forms = [] }) {
    const q = query.trim();
    const scored = forms.map(fm => {
      const re = KEYS[fm.name];
      const hits = re ? (q.match(re) || []).map(x => x.toLowerCase()) : [];
      const descHit = fm.desc && q.split(/\s+/).some(w => w.length > 4 && fm.desc.toLowerCase().includes(w.toLowerCase())) ? 1 : 0;
      return { fm, hits: [...new Set(hits)], s: new Set(hits).size * 2 + descHit };
    }).filter(x => x.s > 0).sort((a, b) => b.s - a.s);
    const best = scored[0]?.s || 1;
    const matches = scored.slice(0, 3).map((x, i) => {
      const fields = extract(x.fm.name, q, { user, department });
      const score = Math.min(0.97, 0.55 + 0.4 * (x.s / Math.max(best, 4)) - i * 0.08);
      return { form: x.fm.name, queue: x.fm.queue, score, why: x.hits.length ? `Matched "${x.hits.slice(0, 3).join('", "')}" in your request` : 'Words in your request match this form\'s description', fields, filled: Object.keys(fields).length, total: x.fm.fields.length };
    });
    return { model: 'cicod-formfinder-v1 (embeddings + extractor)', matches };
  }

  const bar = c => `<span class="airf__bar ${c >= 0.85 ? '' : c >= 0.7 ? 'airf__bar--mid' : 'airf__bar--low'}"><i style="width:${Math.round(c * 100)}%"></i></span>`;
  const EXAMPLES = ['I need an expense request for a trip to Kaduna next week for 4 days, ₦185,000, for a monitoring workshop', 'Update my staff ID data and blood group', 'I paid ₦25,000 at Zenith Bank for my ID card replacement', 'Give feedback on the records management training'];

  class AIRequestFinder extends HTMLElement {
    connectedCallback() {
      this.profile = { user: this.getAttribute('user') || 'Prince Ekpenyong', department: this.getAttribute('department') || 'Administration' };
      this.renderFinder();
    }

    // ---------- finder ----------
    renderFinder() {
      this.innerHTML = `<section class="airf" aria-live="polite">
        <div class="airf__head"><span class="airf__title"><span class="ai-badge">CICOD-AI</span> Describe what you need</span><span class="airf__hint">CICOD-AI will automatically find the correct form for your request and pre-fill its fields for you.</span></div>
        <div class="airf__body">
          <div class="airf__ask"><textarea class="g-textarea airf__q" data-q rows="2" placeholder="e.g. I need an expense request for a trip to Kaduna next week"></textarea>
            <button class="g-btn g-btn--ai" data-find type="button">Find form</button></div>
          <div class="airf__examples">${EXAMPLES.map(x => `<button class="g-chip airf__ex" type="button" data-ex="${esc(x)}">${esc(x.length > 60 ? x.slice(0, 58) + '…' : x)}</button>`).join('')}</div>
          <div data-out></div>
        </div></section>`;
      const q = this.querySelector('[data-q]');
      let t;
      q.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => this.find(), 700); });
      this.querySelector('[data-find]').addEventListener('click', () => { clearTimeout(t); this.find(); });
      this.querySelectorAll('[data-ex]').forEach(b => b.addEventListener('click', () => { q.value = b.dataset.ex; this.find(); }));
    }

    catalog() {
      const root = document.querySelector(this.getAttribute('catalog'));
      return root ? [...root.querySelectorAll('[data-form]')].map(c => ({ name: c.dataset.form, desc: c.dataset.desc || '', queue: c.dataset.queue || '', fields: (c.dataset.fields || '').split('|').filter(Boolean) })) : [];
    }

    async find() {
      const query = this.querySelector('[data-q]').value.trim();
      const out = this.querySelector('[data-out]');
      if (query.length < 8) { out.innerHTML = ''; return; }
      out.innerHTML = '<div class="ai-skeleton" style="width:80%"></div><div class="ai-skeleton" style="width:65%"></div><div class="ai-skeleton" style="width:72%"></div>';
      const seq = (this.seq = (this.seq || 0) + 1);
      const res = await request('/forms/find', { query, ...this.profile, forms: this.catalog() }, { mock: mockFind, feature: 'workspace.request-finder' });
      if (seq !== this.seq) return;
      this.result = res;
      this.dispatchEvent(new CustomEvent('ai-request-match', { detail: { query, matches: res.matches }, bubbles: true }));
      if (!res.matches.length) { out.innerHTML = `<p class="airf__empty">No form your role can raise matches that. Try other words, or use Search request forms below.</p>`; return; }
      out.innerHTML = `<ol class="airf__list">${res.matches.map((m, i) => `<li class="airf__match ${i === 0 ? 'airf__match--top' : ''}">
          <div class="airf__m-main"><div class="airf__m-line"><b>${esc(m.form)}</b>${i === 0 ? '<span class="g-chip g-chip--ai">Best match</span>' : ''}</div>
            <small>${esc(m.why)} · Queue ${esc(m.queue)}</small>
            ${m.filled ? `<div class="airf__pre">${Object.entries(m.fields).map(([k, v]) => `<span class="airf__kv"><i>${esc(k)}</i>${esc(v)}</span>`).join('')}</div>` : ''}
            <small>${m.filled} of ${m.total} fields can be pre-filled</small></div>
          <div class="airf__m-side">${bar(m.score)}<span class="ai-confidence">${Math.round(m.score * 100)}%</span>
            <button class="g-btn g-btn--sm ${i === 0 ? 'g-btn--primary' : ''}" data-pick="${i}" type="button">Open pre-filled</button></div>
        </li>`).join('')}</ol>
        <div class="airf__actions"><button class="g-btn g-btn--sm" data-none type="button">None of these</button><span class="airf__mode"><span class="ai-confidence">${esc(res.model)}</span> · you review every field before Submit</span></div>`;
      out.querySelectorAll('[data-pick]').forEach(b => b.addEventListener('click', () => {
        const m = res.matches[+b.dataset.pick];
        feedback(res.id, 'workspace.request-finder', 'accepted', { form: m.form, rank: +b.dataset.pick + 1 });
        this.dispatchEvent(new CustomEvent('ai-request-open', { detail: { form: m.form, fields: m.fields, confidence: m.score }, bubbles: true }));
      }));
      out.querySelector('[data-none]').addEventListener('click', e => { feedback(res.id, 'workspace.request-finder', 'rejected'); e.target.textContent = 'Thanks, noted'; e.target.disabled = true; });
    }
  }

  customElements.define('ai-request-finder', AIRequestFinder);
})();
