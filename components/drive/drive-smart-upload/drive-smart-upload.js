/* <ai-smart-upload owner="Prince Ekpenyong" sovereign-levels="Secret,Top Secret">
   Sits inside the Drive "Upload File(s)" dialog. Once a file is selected it reads the file and
   suggests the classification level (Official / Confidential / Secret / Top Secret) with the
   reason, detects personal data (NIN, BVN, phone numbers) and offers to redact it before
   sharing, and proposes the destination folder, document type, tags and retention period.
   The officer accepts or edits every value. The component never writes to Drive itself.
   Attributes:
     owner             name shown as the uploader in the result summary
     sovereign-levels  comma list of levels that must be processed on the sovereign model only
   Events:
     ai-upload-result  detail: the gateway response (after analysis)
     ai-upload-accept  detail: { name, size, classification, folder, docType, tags[], retention,
                                 redact, piiTotal, edited[] }   the host page files the document
   Gateway: POST /drive/classify-upload
     { name, size, mime, textSample } ->
     { model, sovereign, classification:{value,confidence,alt,reasons[]},
       pii:{ total, items:[{type,count,where,example}] },
       filing:{ folder:{value,confidence}, docType, tags[], retention, department } } */
(function () {
  const { request, feedback, esc } = window.AIGateway;

  const LEVELS = ['Official (O)', 'Confidential (C)', 'Secret (S)', 'Top Secret (TS)'];
  const FOLDERS = [
    'My Documents',
    'General Documents / MEMOS',
    'General Documents / MINUTES_OF_MEETINGS',
    'General Documents / POLICY_DOCUMENTS',
    'Departments / Finance & Accounts / BUDGET_2027',
    'Departments / Human Resources / NOMINAL_ROLL',
    'Departments / Legal Services / CONTRACTS',
    'Departments / Office of the Perm Sec / SECURITY',
  ];
  const DOC_TYPES = ['Memo', 'Budget proposal', 'Staff list / nominal roll', 'Minutes of meeting', 'Policy / circular', 'Contract / agreement', 'Security report', 'General correspondence'];
  const RETENTION = ['1 year, then destroy', '3 years, then review', '7 years after financial year end', '6 years after staff exit, then destroy', 'Permanent (transfer to National Archives after 25 years)', '7 years after contract expiry'];

  // Prototype-only sample files, standing in for the browser's file picker.
  const SAMPLES = {
    budget: { name: 'Memo_FY2027_Budget_Proposal_ICT.docx', size: '412.8 KB', kind: 'Word document · 6 pages', text: 'RESTRICTED. Request for approval of a ₦48,600,000 capital provision for ICT infrastructure in the FY2027 budget. Not for circulation before FEC approval. From: Director, Finance & Accounts. Through: Permanent Secretary.' },
    staff: { name: 'Staff_Nominal_Roll_HQ_Sept2026.xlsx', size: '1.84 MB', kind: 'Excel workbook · 3 sheets · 214 rows', text: 'Nominal roll: Staff No, Surname, First Name, NIN, BVN, Phone, Grade Level, Step, Department, Date of First Appointment.' },
    minutes: { name: 'Minutes_Management_Meeting_18Sep2026.docx', size: '88.3 KB', kind: 'Word document · 4 pages', text: 'Minutes of the Management Meeting held on 18 September 2026. Present: Director Admin, Director Finance, Head ICT. Agenda: ECMS rollout, CICOD-AI Implementation queue, office maintenance. Action items.' },
  };

  // Rules the mock uses to react to whatever file name or sample the user picks.
  const RULES = [
    { k: /security|intelligence|defen[cs]e|classified|cabinet|threat/i, level: 3, conf: 0.84, folder: 7, type: 'Security report', retention: 4, tags: ['security', 'restricted-distribution'], dept: 'Office of the Perm Sec',
      reasons: ['Security and intelligence terms found in the title and body', 'Similar files in the SECURITY folder are all Top Secret (TS)'] },
    { k: /budget|appropriation|capital provision|expenditure|finance|fmld/i, level: 2, conf: 0.9, folder: 4, type: 'Budget proposal', retention: 2, tags: ['budget', 'FY2027', 'finance'], dept: 'Finance & Accounts',
      reasons: ['Marked "RESTRICTED" and "Not for circulation before FEC approval"', 'Contains unapproved budget figures (₦48.6m capital provision)', 'Budget FMLD_1224_V 2.pdf, the closest match in Drive, is Secret (S)'] },
    { k: /staff|nominal|payroll|personnel|pension|\bhr\b|nin|bvn/i, level: 1, conf: 0.88, folder: 5, type: 'Staff list / nominal roll', retention: 3, tags: ['nominal-roll', 'HR', 'personal-data'], dept: 'Human Resources', pii: true,
      reasons: ['Personal data of named staff (NIN, BVN, phone numbers)', 'NDPA 2023 requires access to be limited to HR and line managers', 'No state-security content, so Secret is not needed'] },
    { k: /contract|agreement|licen[cs]e|mou|vendor/i, level: 1, conf: 0.8, folder: 6, type: 'Contract / agreement', retention: 5, tags: ['contract', 'legal'], dept: 'Legal Services',
      reasons: ['Commercial terms and signatures of a third party', 'Contracts in Legal Services are Confidential (C) by default'] },
    { k: /minutes|meeting|\bmom\b/i, level: 0, conf: 0.86, folder: 2, type: 'Minutes of meeting', retention: 4, tags: ['minutes', 'management-meeting', 'Sep-2026'], dept: 'Admin & Human Resources',
      reasons: ['Routine management meeting with no financial figures or personal data', 'Matches the CICOD default for MINUTES_OF_MEETINGS: Official (O)'] },
    { k: /policy|circular|guideline|manual|handbook|sop/i, level: 0, conf: 0.83, folder: 3, type: 'Policy / circular', retention: 4, tags: ['policy', 'reference'], dept: 'Reform Coordination',
      reasons: ['Guidance intended for all staff', 'Similar files in POLICY_DOCUMENTS are Official (O)'] },
    { k: /memo/i, level: 0, conf: 0.72, folder: 1, type: 'Memo', retention: 1, tags: ['memo'], dept: 'Admin & Human Resources',
      reasons: ['Internal memo with no sensitive terms found', 'Most memos in MEMOS are Official (O)'] },
  ];

  function hash(s) { let h = 7; for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 997; return h; }

  function mockClassify({ name = '', size = '', textSample = '' }) {
    const text = `${name} ${textSample}`;
    const r = RULES.find(x => x.k.test(text)) || { level: 0, conf: 0.66, folder: 0, type: 'General correspondence', retention: 0, tags: ['general'], dept: 'Not detected',
      reasons: ['No classification markings, figures or personal data found', 'Defaulting to the tenant minimum: Official (O)'] };
    const h = hash(name);
    const items = [];
    if (r.pii || /nin|bvn|staff|payroll|nominal/i.test(text)) {
      const rows = /Nominal_Roll_HQ/.test(name) ? 214 : 40 + (h % 160);
      items.push({ type: 'NIN (National Identification Number)', count: rows - 3, where: 'Sheet "HQ Staff", column D', example: '•••••••4821' });
      items.push({ type: 'Phone number', count: rows - 11, where: 'Sheet "HQ Staff", column F', example: '0803•••••17' });
      items.push({ type: 'BVN (Bank Verification Number)', count: Math.round(rows * 0.06) || 3, where: 'Sheet "Payroll link", column C', example: '22•••••••09' });
    } else if (/budget|memo|contract/i.test(text)) {
      items.push({ type: 'Phone number', count: 1, where: /budget/i.test(text) ? 'Page 6, contact block of the signatory' : 'Signature block', example: '0706•••••52' });
    }
    const level = LEVELS[r.level];
    const sovereign = r.level >= 2;
    return {
      model: sovereign ? 'cicod-sensitive-v1 (sovereign)' : 'cicod-docclass-v2',
      sovereign,
      classification: { value: level, confidence: r.conf, alt: LEVELS[Math.min(3, r.level + 1)], reasons: r.reasons },
      pii: { total: items.reduce((a, b) => a + b.count, 0), items },
      filing: { folder: { value: FOLDERS[r.folder], confidence: r.conf - 0.05 }, docType: r.type, tags: r.tags, retention: RETENTION[r.retention], department: r.dept },
    };
  }

  const opts = (list, sel) => list.map(v => `<option${v === sel ? ' selected' : ''}>${esc(v)}</option>`).join('');
  const levelIdx = v => LEVELS.indexOf(v);

  class AISmartUpload extends HTMLElement {
    connectedCallback() {
      this.owner = this.getAttribute('owner') || 'You';
      this.sovereignLevels = (this.getAttribute('sovereign-levels') || 'Secret,Top Secret').split(',').map(s => s.trim());
      this.renderPick();
    }

    renderPick() {
      this.innerHTML = `<section class="aisu" aria-live="polite">
        <div class="aisu__drop">
          <div class="aisu__drop-icon" aria-hidden="true">⬆</div>
          <b>Drag and drop files here, or choose a file</b>
          <span>Prototype: pick one of these sample files instead of your computer.</span>
          <div class="aisu__samples">
            <button class="g-btn g-btn--sm" type="button" data-sample="budget">Budget memo (.docx)</button>
            <button class="g-btn g-btn--sm" type="button" data-sample="staff">Staff list with NINs (.xlsx)</button>
            <button class="g-btn g-btn--sm" type="button" data-sample="minutes">Meeting minutes (.docx)</button>
          </div>
          <form class="aisu__custom" data-custom>
            <label class="g-label" for="aisu-name">Or type any file name to simulate</label>
            <div class="aisu__custom-row"><input class="g-input" id="aisu-name" name="name" placeholder="e.g. Vendor_Service_Agreement_2026.pdf">
            <button class="g-btn g-btn--sm" type="submit">Select</button></div>
          </form>
        </div>
      </section>`;
      this.querySelectorAll('[data-sample]').forEach(b => b.addEventListener('click', () => this.analyse(SAMPLES[b.dataset.sample])));
      this.querySelector('[data-custom]').addEventListener('submit', e => {
        e.preventDefault();
        const name = e.target.name.value.trim();
        if (!name) return;
        this.analyse({ name, size: `${(hash(name) % 900 + 60).toFixed(1)} KB`, kind: 'Selected file', text: '' });
      });
    }

    async analyse(file) {
      this.file = file;
      this.innerHTML = `<section class="aisu" aria-live="polite">
        ${this.fileCard(file)}
        <div class="aisu__head"><span class="aisu__title"><span class="ai-badge">CICOD-AI</span> Reading the file…</span></div>
        <div class="aisu__body"><p class="aisu__step">Extracting text, checking classification markings and scanning for personal data</p>
          <div class="ai-skeleton" style="width:70%"></div><div class="ai-skeleton" style="width:90%"></div><div class="ai-skeleton" style="width:55%"></div><div class="ai-skeleton" style="width:80%"></div></div>
      </section>`;
      const res = await request('/drive/classify-upload', { name: file.name, size: file.size, mime: file.kind, textSample: file.text }, { mock: mockClassify, feature: 'drive.smart-upload' });
      this.result = res;
      this.render(res);
      this.dispatchEvent(new CustomEvent('ai-upload-result', { detail: res, bubbles: true }));
    }

    fileCard(f) {
      return `<div class="aisu__file"><span class="aisu__file-icon" aria-hidden="true">${esc((f.name.split('.').pop() || 'file').slice(0, 4).toUpperCase())}</span>
        <span class="aisu__file-meta"><b>${esc(f.name)}</b><span>${esc(f.kind)} · ${esc(f.size)}</span></span></div>`;
    }

    render(res) {
      const c = res.classification, p = res.pii, f = res.filing;
      const sov = res.sovereign || this.sovereignLevels.some(l => c.value.startsWith(l));
      const levelCls = ['ok', 'info', 'warn', 'bad'][levelIdx(c.value)] || 'ok';
      const piiHtml = p.items.length
        ? `<ul class="aisu__pii">${p.items.map(i => `<li><span class="aisu__pii-count">${i.count}</span><span><b>${esc(i.type)}</b><small>${esc(i.where)} · e.g. ${esc(i.example)}</small></span></li>`).join('')}</ul>
           <label class="aisu__check"><input type="checkbox" name="redact" ${p.total > 5 ? 'checked' : ''}> Redact before sharing <small>A masked copy is used whenever this file is shared or sent through InMail</small></label>`
        : '<p class="aisu__none">No NIN, BVN or phone numbers found.</p>';
      this.innerHTML = `<section class="aisu" aria-live="polite">
        ${this.fileCard(this.file)}
        <div class="aisu__head"><span class="aisu__title"><span class="ai-badge">CICOD-AI</span> Suggested classification &amp; filing</span>
          <span class="ai-confidence">${Math.round(c.confidence * 100)}% · ${esc(res.model)}</span></div>
        ${sov ? '<div class="aisu__sov">Processed on sovereign model only. The file did not leave the CICOD data centre.</div>' : ''}
        <form class="aisu__body" data-form>
          <div class="aisu__block">
            <div class="aisu__block-head"><h5>Classification</h5><span class="g-chip g-chip--${levelCls}">${esc(c.value)}</span></div>
            <ul class="aisu__why">${c.reasons.map(r => `<li>${esc(r)}</li>`).join('')}</ul>
            <label class="g-label" for="aisu-level">Classification level</label>
            <select class="g-select" id="aisu-level" name="classification">${opts(LEVELS, c.value)}</select>
            <p class="aisu__warn" data-downgrade hidden>This is lower than suggested while personal data is present. Your reason will be recorded in the Drive Audit Log.</p>
          </div>
          <div class="aisu__block">
            <div class="aisu__block-head"><h5>Personal data</h5><span class="g-chip ${p.total ? 'g-chip--warn' : 'g-chip--ok'}">${p.total ? `${p.total} ${p.total === 1 ? 'item' : 'items'} found` : 'None found'}</span></div>
            ${piiHtml}
          </div>
          <div class="aisu__block">
            <div class="aisu__block-head"><h5>Filing</h5><span class="ai-confidence">folder ${Math.round(f.folder.confidence * 100)}%</span></div>
            <div class="aisu__grid">
              <div class="aisu__full"><label class="g-label" for="aisu-folder">Destination folder</label><select class="g-select" id="aisu-folder" name="folder">${opts(FOLDERS, f.folder.value)}</select></div>
              <div><label class="g-label" for="aisu-type">Document type</label><select class="g-select" id="aisu-type" name="docType">${opts(DOC_TYPES, f.docType)}</select></div>
              <div><label class="g-label" for="aisu-ret">Retention period</label><select class="g-select" id="aisu-ret" name="retention">${opts(RETENTION, f.retention)}</select></div>
              <div class="aisu__full"><label class="g-label" for="aisu-tags">Tags (comma separated)</label><input class="g-input" id="aisu-tags" name="tags" value="${esc(f.tags.join(', '))}"></div>
            </div>
            <p class="aisu__dept">Owning department detected: <b>${esc(f.department)}</b></p>
          </div>
        </form>
        <div class="aisu__actions">
          <button class="g-btn g-btn--ai g-btn--sm" type="button" data-accept>Accept &amp; upload</button>
          <button class="g-btn g-btn--sm" type="button" data-reject>Not right, choose myself</button>
          <button class="g-btn g-btn--ghost g-btn--sm" type="button" data-cancel>Cancel</button>
          <span class="aisu__mode">Suggestion only · you confirm</span>
        </div>
      </section>`;
      const form = this.querySelector('[data-form]');
      const warn = this.querySelector('[data-downgrade]');
      form.classification.addEventListener('change', () => {
        warn.hidden = !(p.total > 0 && levelIdx(form.classification.value) < levelIdx(c.value));
      });
      this.querySelector('[data-accept]').addEventListener('click', () => this.accept(form));
      this.querySelector('[data-reject]').addEventListener('click', () => {
        feedback(res.id, 'drive.smart-upload', 'rejected');
        this.querySelector('.aisu__head .aisu__title').innerHTML = 'Choose the classification and folder yourself';
        this.querySelector('.aisu__sov')?.remove();
        this.querySelectorAll('.aisu__why, .aisu__dept').forEach(n => n.remove());
        this.querySelector('[data-reject]').remove();
        this.querySelector('[data-accept]').textContent = 'Upload';
      });
      this.querySelector('[data-cancel]').addEventListener('click', () => { feedback(res.id, 'drive.smart-upload', 'cancelled'); this.renderPick(); });
    }

    accept(form) {
      const res = this.result;
      const v = {
        classification: form.classification.value,
        folder: form.folder.value,
        docType: form.docType.value,
        retention: form.retention.value,
        tags: form.tags.value.split(',').map(t => t.trim()).filter(Boolean),
      };
      const s = { classification: res.classification.value, folder: res.filing.folder.value, docType: res.filing.docType, retention: res.filing.retention, tags: res.filing.tags };
      const edited = Object.keys(v).filter(k => JSON.stringify(v[k]) !== JSON.stringify(s[k]));
      const redact = !!form.redact?.checked;
      feedback(res.id, 'drive.smart-upload', edited.length ? 'edited' : 'accepted', { edited, redact });
      this.dispatchEvent(new CustomEvent('ai-upload-accept', { bubbles: true, detail: { name: this.file.name, size: this.file.size, ...v, redact, piiTotal: res.pii.total, edited } }));
      this.innerHTML = `<section class="aisu" aria-live="polite">${this.fileCard(this.file)}
        <div class="aisu__done"><p><b>✓ Uploaded by ${esc(this.owner)}</b> to <i>${esc(v.folder)}</i> as <b>${esc(v.classification)}</b>${redact ? ', with a redacted share copy' : ''}.</p>
        ${edited.length ? `<span>You changed: ${esc(edited.join(', '))}. This helps the model learn.</span>` : '<span>All suggestions accepted.</span>'}</div>
        <div class="aisu__actions"><button class="g-btn g-btn--sm" type="button" data-again>Upload another file</button></div></section>`;
      this.querySelector('[data-again]').addEventListener('click', () => this.renderPick());
    }
  }

  customElements.define('ai-smart-upload', AISmartUpload);
})();
