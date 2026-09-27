/* <ai-form-builder>
   CICOD-AI form builder for ECMS → Forms → Create Form. Two ways in:
     1. "Describe the form": plain-English description → field list.
     2. "Upload paper form (photo/PDF)": document intelligence reads a scanned paper form (OCR),
        and the printed labels and boxes become fields.
   The output is an editable field list (label, type, required, validation, options) with a live
   preview, plus smart validation suggestions (Nigerian phone format, NIN 11 digits, NUBAN 10 digits…).
   The component never creates the form. "Use these fields" hands everything to the host page.
   Attributes:
     max-description  maximum description length (default 1500, same as the Create Form screen)
   Events (bubbles):
     ai-form-apply   detail: { name, formType, description, fields:[{label,type,required,validation,options}] }
     ai-form-result  detail: gateway response
   Gateway:
     POST /ecms/form/draft      { description }            -> { model, confidence, name, formType, description, fields[], suggestions[] }
     POST /ecms/form/from-scan  { file: <upload id>, pages } -> { model, confidence, ocr:[{text,confidence}], name, formType, description, fields[], suggestions[] } */
(function () {
  const { request, feedback, esc } = window.AIGateway;

  const TYPES = ['Text', 'Long text', 'Number', 'Currency', 'Date', 'Dropdown', 'Radio', 'Checkbox', 'Phone', 'Email', 'NIN', 'File upload', 'Signature'];
  // Field dictionary: keyword → field. Validation that the CICOD-AI proposes separately (as a suggestion) is left empty here.
  const DICT = [
    { k: /\b(full )?name|applicant|officer'?s? name|name of officer/i, f: { label: 'Full name', type: 'Text', required: true, validation: 'Letters only, 3–80 characters' } },
    { k: /ippis|staff (id|number|no)|file number|psn/i, f: { label: 'IPPIS number', type: 'Text', required: true, validation: '' }, s: { text: 'IPPIS numbers are 6 or 7 digits. Reject letters and spaces.', validation: 'Digits only, 6–7 characters' } },
    { k: /e-?mail/i, f: { label: 'Email address', type: 'Email', required: true, validation: '' }, s: { text: 'Check the email format and block disposable domains.', validation: 'Valid email (name@domain)' } },
    { k: /phone|mobile|telephone|gsm/i, f: { label: 'Phone number', type: 'Phone', required: true, validation: '' }, s: { text: 'Nigerian mobile format: 11 digits starting 070, 080, 081, 090 or 091, or +234 followed by 10 digits.', validation: '^(0|\\+234)[789][01]\\d{8}$' } },
    { k: /\bnin\b|national identification/i, f: { label: 'NIN', type: 'NIN', required: true, validation: '' }, s: { text: 'The National Identification Number is exactly 11 digits. It can be verified with NIMC on submit.', validation: 'Exactly 11 digits · NIMC check' } },
    { k: /\bbvn\b/i, f: { label: 'BVN', type: 'Number', required: false, validation: '' }, s: { text: 'A Bank Verification Number is exactly 11 digits.', validation: 'Exactly 11 digits' } },
    { k: /date of birth|\bdob\b|\bage\b/i, f: { label: 'Date of birth', type: 'Date', required: true, validation: '' }, s: { text: 'Applicants for employment or grants should be 18 or older.', validation: 'Age ≥ 18 years' } },
    { k: /gender|\bsex\b/i, f: { label: 'Gender', type: 'Radio', required: true, validation: '', options: 'Male, Female' } },
    { k: /address/i, f: { label: 'Residential address', type: 'Long text', required: true, validation: '' } },
    { k: /state of origin|\bstate\b/i, f: { label: 'State of origin', type: 'Dropdown', required: true, validation: '', options: '36 states + FCT' } },
    { k: /\blga\b|local government/i, f: { label: 'LGA', type: 'Dropdown', required: true, validation: 'Filtered by State', options: '774 LGAs' } },
    { k: /department|directorate|\bunit\b/i, f: { label: 'Department', type: 'Dropdown', required: true, validation: '', options: 'From ECMS Departments' } },
    { k: /grade level|\bgl\b|\bgrade\b/i, f: { label: 'Grade level', type: 'Dropdown', required: true, validation: '', options: 'GL 01 – GL 17' } },
    { k: /leave/i, f: { label: 'Leave type', type: 'Dropdown', required: true, validation: '', options: 'Annual, Sick, Maternity, Study, Casual' } },
    { k: /start date|date of departure|from date|departure|leave/i, f: { label: 'Start date', type: 'Date', required: true, validation: '' } },
    { k: /end date|date of return|return|leave/i, f: { label: 'End date', type: 'Date', required: true, validation: '' }, s: { text: 'End date must be on or after the start date.', validation: 'On or after Start date' } },
    { k: /destination|travel|touring/i, f: { label: 'Destination', type: 'Text', required: true, validation: '' } },
    { k: /amount|cost|₦|\bfee\b|advance|naira/i, f: { label: 'Amount (₦)', type: 'Currency', required: true, validation: '' }, s: { text: 'Amounts must be positive. Show the amount in words automatically, as the paper form asks for it.', validation: '> 0 · amount in words auto-filled' } },
    { k: /bank|account/i, f: { label: 'Bank name', type: 'Dropdown', required: true, validation: '', options: 'CBN list of licensed banks' } },
    { k: /account (number|no)|bank|account/i, f: { label: 'Account number', type: 'Number', required: true, validation: '' }, s: { text: 'Nigerian account numbers (NUBAN) are 10 digits; the check digit can be validated against the bank.', validation: 'Exactly 10 digits · NUBAN check' } },
    { k: /vehicle|car\b/i, f: { label: 'Vehicle registration number', type: 'Text', required: true, validation: '' }, s: { text: 'Nigerian plates follow ABC-123DE.', validation: '^[A-Z]{3}-\\d{3}[A-Z]{2}$' } },
    { k: /complain|grievance/i, f: { label: 'Complaint category', type: 'Dropdown', required: true, validation: '', options: 'Delay, Staff conduct, Billing, Other' } },
    { k: /purpose|reason|description|details|comment|explain/i, f: { label: 'Purpose / details', type: 'Long text', required: true, validation: 'Max 1,000 characters' } },
    { k: /rating|satisf|feedback/i, f: { label: 'How satisfied are you?', type: 'Radio', required: false, validation: '', options: '1, 2, 3, 4, 5' } },
    { k: /attach|upload|document|passport|photo|receipt|evidence/i, f: { label: 'Supporting document', type: 'File upload', required: false, validation: 'PDF, JPG or PNG, max 2 MB' } },
    { k: /signature|\bsign/i, f: { label: 'Signature', type: 'Signature', required: true, validation: '' } },
    { k: /approv|hod|head of department|supervisor/i, f: { label: 'Approved by (HOD)', type: 'Text', required: false, validation: 'Filled by the approver in the workflow' } },
  ];

  function formTypeFor(t) {
    if (/inter[- ]?mda|other mdas?|between mdas/i.test(t)) return 'Inter MDA';
    if (/survey|capture|census|enumerat|data collection/i.test(t)) return 'Capture';
    if (/status (update|report)|progress report/i.test(t)) return 'Status';
    if (/public|citizen|applicant|external|customer|vendor|contractor|scholarship/i.test(t)) return 'External';
    return 'Internal';
  }

  function build(text, nameHint) {
    const fields = []; const suggestions = [];
    DICT.forEach(d => {
      if (!d.k.test(text) || fields.some(f => f.label === d.f.label)) return;
      fields.push({ ...d.f, options: d.f.options || '' });
      if (d.s) suggestions.push({ label: d.f.label, text: d.s.text, validation: d.s.validation });
    });
    if (!fields.length) fields.push({ label: 'Full name', type: 'Text', required: true, validation: '', options: '' }, { label: 'Email address', type: 'Email', required: true, validation: '', options: '' }, { label: 'Purpose / details', type: 'Long text', required: true, validation: '', options: '' });
    const formType = formTypeFor(text);
    const name = nameHint || (text.match(/^(?:a |an |the )?(.{3,60}?)(?: form)?(?:[:.,]| for | to | that | with |$)/i) || [, 'New form'])[1].replace(/\b(\w)(\w*)/g, (m, a, b) => /^(of|and|for|the|to)$/i.test(m) ? m.toLowerCase() : a.toUpperCase() + b);
    return { name: /form$/i.test(name) ? name : name + ' Form', formType, fields, suggestions,
      description: `${formType} form. Collects ${fields.slice(0, 5).map(f => f.label.toLowerCase()).join(', ')}${fields.length > 5 ? ` and ${fields.length - 5} more field${fields.length - 5 > 1 ? 's' : ''}` : ''}. Generated with CICOD-AI from ${nameHint ? 'a scanned paper form' : 'a description'} and reviewed by the form owner.` };
  }

  function mockDraft({ description = '' }) {
    const out = build(description);
    return { model: 'cicod-docgen-v2 (sovereign)', confidence: Math.min(0.94, 0.62 + out.fields.length * 0.03), ...out };
  }

  // Sample scanned form: modelled on the tenant's real "EXPENSE REQUEST" webform.
  const SAMPLE_OCR = [
    ['CICOD: EXPENSE REQUEST', 0.98], ['Name of Officer: ______________________', 0.97], ['IPPIS No: __________   Grade Level: ____', 0.93],
    ['Department / Unit: ______________________', 0.95], ['Purpose of Advance: ____________________', 0.91], ['Destination: ______________  Date of Departure: ___/___/____  Date of Return: ___/___/____', 0.86],
    ['Amount (₦): ___________  Amount in words: ___________________', 0.9], ['Phone No: ______________   NIN: ___________', 0.84], ['Bank Name: ____________  Account No: __________', 0.88],
    ['Signature of Officer: ________  Date: ________', 0.8], ['Approved by (HOD): ______________', 0.77],
  ];
  function mockScan({ file: fileName }) {
    const text = SAMPLE_OCR.map(l => l[0]).join('\n');
    const out = build(text, 'Expense Request');
    return { model: 'cicod-docintel-v1 (OCR + layout) → cicod-docgen-v2', confidence: 0.87, fileName, ocr: SAMPLE_OCR.map(([t, c]) => ({ text: t, confidence: c })), ...out };
  }

  const EXAMPLES = [
    'Staff leave application: name, IPPIS number, department, grade level, leave type, start and end date, phone number and relief officer signature',
    'Public scholarship application for citizens: full name, NIN, date of birth, gender, state of origin, LGA, email, phone, upload passport photo',
  ];

  class AIFormBuilder extends HTMLElement {
    connectedCallback() {
      this.max = +(this.getAttribute('max-description') || 1500);
      this.innerHTML = `<section class="aifb" aria-live="polite">
        <div class="aifb__head"><span class="aifb__title"><span class="ai-badge">CICOD-AI</span> Build this form with CICOD-AI</span><span class="ai-confidence">CICOD-AI Form Builder</span></div>
        <div class="aifb__tabs" role="tablist">
          <button class="aifb__tab aifb__tab--on" data-mode="describe" type="button">Describe the form</button>
          <button class="aifb__tab" data-mode="upload" type="button">Upload paper form (photo/PDF)</button>
        </div>
        <div class="aifb__body">
          <div data-pane="describe">
            <textarea class="g-textarea aifb__desc" rows="3" placeholder="e.g. Staff leave application: name, IPPIS number, department, leave type, start and end date, phone number"></textarea>
            <div class="aifb__row"><button class="g-btn g-btn--ai g-btn--sm" data-gen type="button">✦ Generate fields</button>
              <span class="aifb__muted">Examples:</span><button class="g-btn g-btn--ghost g-btn--sm" data-ex="0" type="button">Leave application</button><button class="g-btn g-btn--ghost g-btn--sm" data-ex="1" type="button">Scholarship (public)</button></div>
          </div>
          <div data-pane="upload" hidden>
            <label class="aifb__drop"><input type="file" accept="image/*,application/pdf" data-file hidden><span>⤒ Drop a photo or PDF of the paper form, or click to choose</span><span class="aifb__muted">JPG, PNG or PDF · up to 10 MB · processed in-country</span></label>
            <div class="aifb__row"><button class="g-btn g-btn--ai g-btn--sm" data-sample type="button">Use sample paper form</button><span class="aifb__muted">Expense Request form (scan)</span></div>
          </div>
          <div data-out></div>
        </div>
      </section>`;
      this.querySelectorAll('[data-mode]').forEach(b => b.addEventListener('click', () => {
        this.querySelectorAll('[data-mode]').forEach(x => x.classList.toggle('aifb__tab--on', x === b));
        this.querySelectorAll('[data-pane]').forEach(p => { p.hidden = p.dataset.pane !== b.dataset.mode; });
      }));
      this.querySelectorAll('[data-ex]').forEach(b => b.addEventListener('click', () => { this.querySelector('.aifb__desc').value = EXAMPLES[+b.dataset.ex]; }));
      this.querySelector('[data-gen]').addEventListener('click', () => this.describe());
      this.querySelector('[data-sample]').addEventListener('click', () => this.scan('CASH_ADVANCE_FORM_scan.jpg'));
      this.querySelector('[data-file]').addEventListener('change', e => { const f = e.target.files[0]; if (f) this.scan(f.name); });
    }

    loading(msg) {
      this.querySelector('[data-out]').innerHTML = `<div class="aifb__res"><p class="aifb__muted">${esc(msg)}</p><div class="ai-skeleton" style="width:60%"></div><div class="ai-skeleton" style="width:90%"></div><div class="ai-skeleton" style="width:80%"></div><div class="ai-skeleton" style="width:70%"></div></div>`;
    }

    async describe() {
      const description = this.querySelector('.aifb__desc').value.trim();
      if (description.length < 10) { this.querySelector('[data-out]').innerHTML = '<p class="aifb__muted">Describe who fills the form and what it must collect.</p>'; return; }
      this.loading('Designing fields…');
      const res = await request('/ecms/form/draft', { description }, { mock: mockDraft, feature: 'ecms.prompt-to-form' });
      this.show(res);
    }

    async scan(fileName) {
      this.loading(`Reading ${fileName}: OCR and layout analysis…`);
      const res = await request('/ecms/form/from-scan', { file: fileName, pages: 1 }, { mock: mockScan, feature: 'ecms.prompt-to-form.scan', delay: 1400 });
      this.show(res);
    }

    show(res) {
      this.res = res;
      this.fields = res.fields.map(f => ({ ...f }));
      this.meta = { name: res.name, formType: res.formType, description: res.description.slice(0, this.max) };
      this.edited = false;
      this.render();
      this.dispatchEvent(new CustomEvent('ai-form-result', { detail: res, bubbles: true }));
    }

    render() {
      const res = this.res;
      const ocr = res.ocr ? `<div class="aifb__ocr"><div class="aifb__paper" aria-label="Scanned paper form">${res.ocr.map((l, i) => `<div class="${i ? '' : 'aifb__paper-title'}">${esc(l.text)}</div>`).join('')}</div>
        <div class="aifb__ocr-lines"><h5>OCR preview · ${esc(res.fileName)}</h5><ul>${res.ocr.map(l => `<li><span class="aifb__conf ${l.confidence < 0.85 ? 'aifb__conf--low' : ''}">${Math.round(l.confidence * 100)}%</span>${esc(l.text.replace(/_+/g, '▢').replace(/(▢[\s/]*)+/g, '▢ '))}</li>`).join('')}</ul>
        <p class="aifb__muted">Lines under 85% are highlighted; check those labels.</p></div></div>` : '';
      const rows = this.fields.map((f, i) => `<tr data-i="${i}">
          <td><input class="g-input" data-k="label" value="${esc(f.label)}" aria-label="Label"></td>
          <td><select class="g-select" data-k="type" aria-label="Type">${TYPES.map(t => `<option${t === f.type ? ' selected' : ''}>${t}</option>`).join('')}</select></td>
          <td class="aifb__c"><input type="checkbox" data-k="required" ${f.required ? 'checked' : ''} aria-label="Required"></td>
          <td><input class="g-input" data-k="validation" value="${esc(f.validation)}" placeholder="—" aria-label="Validation"></td>
          <td><input class="g-input" data-k="options" value="${esc(f.options)}" placeholder="—" aria-label="Options"></td>
          <td><button class="g-btn g-btn--ghost g-btn--sm" data-del="${i}" type="button" aria-label="Remove field">×</button></td></tr>`).join('');
      const sugg = res.suggestions.filter(s => { const f = this.fields.find(x => x.label === s.label); return f && f.validation !== s.validation; });
      this.querySelector('[data-out]').innerHTML = `<div class="aifb__res">
        <div class="aifb__res-head"><b>${this.fields.length} fields · ${esc(this.meta.formType)} form</b><span class="ai-confidence">${Math.round(res.confidence * 100)}% · ${esc(res.model)}</span></div>
        ${ocr}
        <div class="aifb__meta"><label><span>Form name</span><input class="g-input" data-m="name" value="${esc(this.meta.name)}"></label>
          <label><span>Form type</span><select class="g-select" data-m="formType">${['Internal', 'External', 'Capture', 'Inter MDA', 'Status'].map(t => `<option${t === this.meta.formType ? ' selected' : ''}>${t}</option>`).join('')}</select></label></div>
        ${sugg.length ? `<div class="aifb__sugg"><h5>Smart validation suggestions (${sugg.length})</h5>${sugg.map(s => `<div class="aifb__sugg-row"><span><b>${esc(s.label)}:</b> ${esc(s.text)}</span><button class="g-btn g-btn--sm" data-sugg="${esc(s.label)}" type="button">Apply</button></div>`).join('')}<button class="g-btn g-btn--ghost g-btn--sm" data-sugg-all type="button">Apply all</button></div>` : '<p class="aifb__muted">All validation suggestions applied ✓</p>'}
        <div class="aifb__split">
          <div class="aifb__edit"><h5>Fields (edit before use)</h5>
            <div class="g-table-wrap"><table class="g-table aifb__table"><thead><tr><th>Label</th><th>Type</th><th>Req.</th><th>Validation</th><th>Options</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>
            <button class="g-btn g-btn--sm" data-add type="button" style="margin-top:8px">+ Add field</button></div>
          <div class="aifb__prev"><h5>Live preview</h5><div class="aifb__prev-card" data-preview></div></div>
        </div>
        <div class="aifb__row">
          <button class="g-btn g-btn--ai g-btn--sm" data-use type="button">Use these fields</button>
          <button class="g-btn g-btn--ghost g-btn--sm" data-discard type="button">Discard</button>
          <span class="aifb__muted aifb__mode">Suggestion only · nothing is created until you click Create</span>
        </div>
      </div>`;
      this.preview();
      const out = this.querySelector('[data-out]');
      out.querySelectorAll('tbody [data-k]').forEach(el => el.addEventListener(el.type === 'checkbox' || el.tagName === 'SELECT' ? 'change' : 'input', () => {
        const f = this.fields[+el.closest('tr').dataset.i];
        f[el.dataset.k] = el.type === 'checkbox' ? el.checked : el.value;
        this.edited = true; this.preview();
      }));
      out.querySelectorAll('[data-m]').forEach(el => el.addEventListener('input', () => { this.meta[el.dataset.m] = el.value; this.edited = true; this.preview(); }));
      out.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => { this.fields.splice(+b.dataset.del, 1); this.edited = true; this.render(); }));
      out.querySelector('[data-add]').addEventListener('click', () => { this.fields.push({ label: 'New field', type: 'Text', required: false, validation: '', options: '' }); this.edited = true; this.render(); });
      const applySugg = label => { const s = res.suggestions.find(x => x.label === label); const f = this.fields.find(x => x.label === label); if (s && f) { f.validation = s.validation; feedback(res.id, 'ecms.prompt-to-form', 'suggestion-accepted', { field: label }); } };
      out.querySelectorAll('[data-sugg]').forEach(b => b.addEventListener('click', () => { applySugg(b.dataset.sugg); this.render(); }));
      out.querySelector('[data-sugg-all]')?.addEventListener('click', () => { sugg.forEach(s => applySugg(s.label)); this.render(); });
      out.querySelector('[data-use]').addEventListener('click', e => {
        feedback(res.id, 'ecms.prompt-to-form', this.edited ? 'edited' : 'accepted', { fields: this.fields.length });
        this.dispatchEvent(new CustomEvent('ai-form-apply', { bubbles: true, detail: { ...this.meta, fields: this.fields.map(f => ({ ...f })) } }));
        e.target.textContent = 'Fields added to the form ✓';
      });
      out.querySelector('[data-discard]').addEventListener('click', () => { feedback(res.id, 'ecms.prompt-to-form', 'rejected'); out.innerHTML = ''; });
    }

    preview() {
      const input = f => {
        const ph = esc(f.validation || '');
        switch (f.type) {
          case 'Long text': return `<textarea class="g-textarea" rows="2" placeholder="${ph}" disabled></textarea>`;
          case 'Dropdown': return `<select class="g-select" disabled><option>${esc(f.options || 'Select')}</option></select>`;
          case 'Radio': case 'Checkbox': return `<div class="aifb__opts">${(f.options || 'Yes, No').split(',').map(o => `<label><input type="${f.type === 'Radio' ? 'radio' : 'checkbox'}" disabled> ${esc(o.trim())}</label>`).join('')}</div>`;
          case 'File upload': return `<div class="aifb__pfile">⤒ Upload · ${ph || 'any file'}</div>`;
          case 'Signature': return '<div class="aifb__psign">Sign here</div>';
          case 'Date': return '<input class="g-input" type="date" disabled>';
          case 'Currency': return `<input class="g-input" placeholder="₦ 0.00 ${ph ? '· ' + ph : ''}" disabled>`;
          case 'Phone': return `<input class="g-input" placeholder="${ph ? '080XXXXXXXX · validated' : '080XXXXXXXX'}" disabled>`;
          case 'NIN': return `<input class="g-input" placeholder="11-digit NIN${ph ? ' · validated' : ''}" disabled>`;
          default: return `<input class="g-input" placeholder="${ph}" disabled>`;
        }
      };
      const box = this.querySelector('[data-preview]');
      if (!box) return;
      box.innerHTML = `<div class="aifb__prev-title">${esc(this.meta.name)}</div><div class="aifb__muted">${esc(this.meta.formType)} form</div>` +
        this.fields.map(f => `<div class="aifb__pf"><span class="aifb__pl">${esc(f.label)}${f.required ? ' <i>*</i>' : ''}</span>${input(f)}</div>`).join('') +
        '<button class="g-btn g-btn--primary g-btn--sm" type="button" disabled>Submit</button>';
    }
  }

  customElements.define('ai-form-builder', AIFormBuilder);
})();
