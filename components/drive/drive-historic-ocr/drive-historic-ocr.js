/* <ai-ocr-search folder="LANDS_FILE_JACKETS_2015-2020" min-confidence="0.75">
   Makes scanned file jackets in Drive → Historic Files searchable. It does three things:
     1. Reports the OCR status of every file in the open folder (Searchable / Processing / Needs review).
        The host page draws the status column from the ai-ocr-status event.
     2. Semantic search inside the scanned pages ("land allocation approval 2019 Kubwa"), with
        highlighted snippets, the matching page and a page thumbnail.
     3. An extracted-metadata panel (file reference no., dates, parties, subject, signatures detected).
        The records officer accepts, edits or rejects it. Nothing is written to the file by the component.
   Attributes:
     folder          name of the open Historic Files folder
     min-confidence  fields below this OCR confidence are marked "check" (default 0.75)
   Methods:
     inspect(fileId) open the metadata panel for a file (used by the host's row button)
   Events (bubbles):
     ai-ocr-status         detail: { files: [{ id, status, pages, confidence }] }
     ai-ocr-open           detail: { fileId, page }             host opens the viewer at that page
     ai-ocr-metadata-apply detail: { fileId, metadata }         host saves the metadata on the file
     ai-ocr-review         detail: { fileId, action: 'rejected' }  host sends it to manual indexing
   Gateway:
     POST /drive/ocr-status      { folder } -> { files: [{ id, status, pages, confidence }] }
     POST /drive/historic-search { query, folder } -> { understood:{topic[],year,place}, results:[{ fileId, name, page, pages, score, snippet, terms[], via[] }], skipped }
     POST /drive/ocr-extract     { fileId } -> { metadata:{ ref, subject, dates[], parties[], signatures[] }, fields:[{ key, label, value, confidence }] } */
(function () {
  const { request, feedback, esc } = window.AIGateway;

  // Prototype-only corpus: OCR text of scanned file jackets. Reference formats follow FCT/FCDA registry style.
  const JACKETS = [
    { id: 'hf1', name: 'FCDA_LA_KUB_2019_0347.pdf', ref: 'FCDA/LA/KUB/2019/0347', subject: 'Allocation of Plot 1142, Kubwa Extension II (Residential)', year: 2019, place: 'Kubwa', pages: 14, status: 'Searchable', conf: 0.96,
      dates: [['Application received', '04/02/2019'], ['Approval of allocation', '18/03/2019'], ['Offer letter issued', '25/03/2019']],
      parties: ['Applicant: Mrs. Hauwa Bello', 'Director, Land Administration (FCDA)', 'Lands Allocation Committee'],
      signatures: [{ page: 6, who: 'Director, Land Administration', kind: 'Signature + FCDA stamp' }, { page: 9, who: 'Applicant', kind: 'Signature (acceptance of offer)' }],
      text: [
        { p: 1, t: 'File jacket. Federal Capital Development Authority, Department of Land Administration. File No. FCDA/LA/KUB/2019/0347. Subject: application for allocation of residential plot, Kubwa Extension II.' },
        { p: 3, t: 'The applicant has paid the prescribed processing fee and the plot is free of encumbrance on the cadastral map of Kubwa Cadastral Zone 07-05.' },
        { p: 6, t: 'Approval: the Honourable Minister has approved the allocation of Plot 1142 Kubwa Extension II to Mrs. Hauwa Bello on 18 March 2019, subject to the payment of statutory rights.' },
        { p: 9, t: 'Acceptance of offer of statutory right of occupancy for Plot 1142 Kubwa, signed and returned by the allottee on 2 April 2019.' },
      ] },
    { id: 'hf2', name: 'MIN_LAC_2019_011_scan.pdf', ref: 'FCDA/LAC/MIN/2019/011', subject: 'Minutes of the Lands Allocation Committee meeting, 14 March 2019', year: 2019, place: 'Kubwa', pages: 22, status: 'Searchable', conf: 0.93,
      dates: [['Meeting date', '14/03/2019'], ['Minutes adopted', '28/03/2019']],
      parties: ['Chairman, Lands Allocation Committee', 'Secretary to the Committee', 'Director, Land Administration'],
      signatures: [{ page: 22, who: 'Chairman and Secretary', kind: '2 signatures' }],
      text: [
        { p: 2, t: 'Minutes of the 11th meeting of the Lands Allocation Committee held on 14 March 2019 in the Conference Room, FCDA Garki.' },
        { p: 7, t: 'Item 4: the Committee considered 38 applications for residential plots in Kubwa Extension II and recommended 21 for approval by the Honourable Minister.' },
        { p: 8, t: 'The Committee deferred allotment of plots on the Kubwa–Bwari corridor pending the road rehabilitation right-of-way survey.' },
      ] },
    { id: 'hf3', name: 'FCDA_LA_KUB_2019_0412.pdf', ref: 'FCDA/LA/KUB/2019/0412', subject: 'Application for change of land use, Plot 88 Kubwa (residential to commercial)', year: 2019, place: 'Kubwa', pages: 9, status: 'Searchable', conf: 0.91,
      dates: [['Application received', '10/06/2019'], ['Consent refused', '02/09/2019']],
      parties: ['Applicant: Tunde Okafor & Sons Ltd', 'Development Control Department'],
      signatures: [{ page: 7, who: 'Director, Development Control', kind: 'Signature' }],
      text: [
        { p: 1, t: 'Application for change of land use from residential to commercial in respect of Plot 88, Kubwa, dated 10 June 2019.' },
        { p: 7, t: 'Consent for change of use is not granted because the plot lies within a residential district under the Kubwa master plan.' },
      ] },
    { id: 'hf4', name: 'FMW_PRJ_2018_072_contract.pdf', ref: 'FMW/PRJ/2018/072', subject: 'Contract award: rehabilitation of Kubwa–Bwari road', year: 2018, place: 'Kubwa', pages: 31, status: 'Searchable', conf: 0.95,
      dates: [['Tender opened', '12/04/2018'], ['Contract awarded', '30/07/2018'], ['Completion due', '30/06/2019']],
      parties: ['Federal Ministry of Works', 'Contractor: Arewa Civil Works Ltd', 'Bureau of Public Procurement'],
      signatures: [{ page: 29, who: 'Permanent Secretary', kind: 'Signature + seal' }, { page: 30, who: 'Contractor director', kind: 'Signature' }],
      text: [
        { p: 3, t: 'Approval of the Federal Executive Council for the award of contract for the rehabilitation of the Kubwa–Bwari road at a sum of ₦2.4bn.' },
        { p: 12, t: 'The Bureau of Public Procurement issued a certificate of no objection on 20 July 2018.' },
      ] },
    { id: 'hf5', name: 'FCDA_LA_BWA_2017_0098.pdf', ref: 'FCDA/LA/BWA/2017/0098', subject: 'Revocation of Plot 56, Bwari (non-development)', year: 2017, place: 'Bwari', pages: 11, status: 'Needs review', conf: 0.64,
      dates: [['Notice of revocation', '0?/11/2017 (handwritten, unclear)'], ['Gazetted', '15/01/2018']],
      parties: ['Allottee: name illegible on p.2', 'Director, Land Administration'],
      signatures: [{ page: 4, who: 'Unclear (initials only)', kind: 'Initials, no stamp' }],
      text: [
        { p: 2, t: 'Notice of revocation of right of occupancy over Plot 56 Bwari for failure to develop the plot within two years of allocation.' },
        { p: 4, t: 'Handwritten minute: "HLA, please treat and advise on re-allocation." Initialled, date partly illegible.' },
      ] },
    { id: 'hf6', name: 'MFCT_EST_2016_118.pdf', ref: 'MFCT/EST/2016/118', subject: 'Allocation of staff quarters, Gwarinpa estate', year: 2016, place: 'Gwarinpa', pages: 17, status: 'Searchable', conf: 0.9,
      dates: [['Allocation approved', '09/08/2016']],
      parties: ['Estate Management Unit', 'Permanent Secretary, FCT'],
      signatures: [{ page: 5, who: 'Permanent Secretary', kind: 'Signature' }],
      text: [
        { p: 5, t: 'Approval is hereby conveyed for the allocation of 24 units of staff quarters in Gwarinpa estate to officers on grade level 08–14.' },
      ] },
    { id: 'hf7', name: 'FCDA_LA_KUB_2020_0021.pdf', ref: 'FCDA/LA/KUB/2020/0021', subject: 'Certificate of Occupancy processing, Plot 1142 Kubwa', year: 2020, place: 'Kubwa', pages: 8, status: 'Processing', conf: 0,
      dates: [['C of O requested', '14/01/2020']], parties: ['Mrs. Hauwa Bello', 'Deeds Registry'], signatures: [],
      text: [{ p: 2, t: 'Request for issuance of Certificate of Occupancy following allocation of Plot 1142 Kubwa approved in 2019.' }] },
    { id: 'hf8', name: 'REG_CORR_2015_JACKET_03.tif', ref: 'FCDA/REG/2015/003', subject: 'General correspondence, Registry (2015)', year: 2015, place: 'Garki', pages: 46, status: 'Searchable', conf: 0.88,
      dates: [['First letter', '06/01/2015'], ['Last letter', '21/12/2015']], parties: ['Registry, FCDA', 'Various MDAs'],
      signatures: [{ page: 1, who: 'Head of Registry', kind: 'Signature' }],
      text: [{ p: 18, t: 'Letter forwarding the land register extract for Garki District to the Surveyor-General for update.' }] },
  ];
  const byId = id => JACKETS.find(j => j.id === id);

  const SYN = {
    land: ['land', 'plot', 'parcel'], plot: ['plot', 'land', 'parcel'],
    allocation: ['allocation', 'allotment', 'allocated', 'allottee', 'allot'], allotment: ['allotment', 'allocation', 'allot'],
    approval: ['approval', 'approved', 'granted', 'consent'], approved: ['approved', 'approval', 'granted'],
    revocation: ['revocation', 'revoke', 'revoked'], contract: ['contract', 'award', 'tender'],
    minutes: ['minutes', 'meeting', 'committee'], meeting: ['meeting', 'minutes', 'committee'],
    quarters: ['quarters', 'housing', 'estate'], housing: ['housing', 'quarters', 'estate'],
    road: ['road', 'rehabilitation'], certificate: ['certificate', 'occupancy'],
  };
  const PLACES = ['kubwa', 'bwari', 'gwarinpa', 'garki', 'maitama'];
  const STOP = new Set(['the', 'and', 'for', 'of', 'in', 'on', 'to', 'a', 'an', 'with', 'about', 'file', 'files', 'find', 'show', 'me']);
  const escRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  function mockStatus({ ready = [] }) {
    return { model: 'cicod-docintel-v2 (sovereign)', files: JACKETS.map(j => ({ id: j.id, status: ready.includes(j.id) ? 'Searchable' : j.status, pages: j.pages, confidence: j.conf })) };
  }

  function mockSearch({ query = '', ready = [] }) {
    const words = query.toLowerCase().split(/[^a-z0-9]+/).filter(w => w && !STOP.has(w));
    const year = words.find(w => /^(19|20)\d\d$/.test(w));
    const place = words.find(w => PLACES.includes(w));
    const topic = words.filter(w => w !== year && w !== place);
    const pool = JACKETS.filter(j => j.status !== 'Processing' || ready.includes(j.id));
    const results = [];
    pool.forEach(j => {
      let best = null;
      j.text.forEach(pg => {
        const low = `${pg.t} ${j.subject}`.toLowerCase();
        const terms = [], via = [];
        let hit = 0;
        topic.forEach(w => {
          const exp = SYN[w] || [w];
          const m = exp.find(e => new RegExp(`\\b${escRe(e)}`, 'i').test(low));
          if (m) { hit++; terms.push(m); if (m !== w) via.push(`"${m}" matched "${w}"`); }
        });
        if (place && low.includes(place)) terms.push(place);
        const s = topic.length ? hit / topic.length : 0;
        if (!best || s > best.s) best = { s, pg, terms, via };
      });
      let score = best.s * 0.7 + (year ? (j.year === +year ? 0.18 : -0.15) : 0.1) + (place ? (j.place.toLowerCase() === place ? 0.12 : -0.2) : 0.05);
      if (!topic.length) score = (year && j.year === +year ? 0.5 : 0) + (place && j.place.toLowerCase() === place ? 0.4 : 0);
      if (j.status === 'Needs review') score -= 0.05;
      if (score >= 0.45) {
        const t = best.pg.t;
        const first = best.terms.length ? t.toLowerCase().indexOf(best.terms[0]) : 0;
        let start = Math.max(0, first - 60);
        if (start) { const sp = t.indexOf(' ', start); if (sp > -1 && sp < first) start = sp + 1; }
        const snippet = (start ? '…' : '') + t.slice(start, start + 190) + (start + 190 < t.length ? '…' : '');
        results.push({ fileId: j.id, name: j.name, ref: j.ref, subject: j.subject, page: best.pg.p, pages: j.pages, score: Math.min(0.98, score), snippet, terms: [...new Set(best.terms.concat(year ? [year] : []))], via: best.via, review: j.status === 'Needs review', conf: j.conf });
      }
    });
    results.sort((a, b) => b.score - a.score);
    const skipped = JACKETS.filter(j => j.status === 'Processing' && !ready.includes(j.id)).length;
    return { model: 'cicod-embed-v3 + reranker (sovereign)', understood: { topic, year: year || null, place: place ? place[0].toUpperCase() + place.slice(1) : null }, results: results.slice(0, 5), skipped };
  }

  function mockExtract({ fileId }) {
    const j = byId(fileId);
    const low = j.status === 'Needs review';
    const fields = [
      { key: 'ref', label: 'File reference no.', value: j.ref, confidence: low ? 0.81 : 0.97 },
      { key: 'subject', label: 'Subject', value: j.subject, confidence: low ? 0.78 : 0.94 },
      ...j.dates.map(([l, v], i) => ({ key: `date${i}`, label: l, value: v, confidence: /unclear|\?/.test(v) ? 0.41 : 0.9 })),
      ...j.parties.map((p, i) => ({ key: `party${i}`, label: i === 0 ? 'Parties' : '', value: p, confidence: /illegible/.test(p) ? 0.38 : 0.86 })),
    ];
    return { model: 'cicod-docintel-v2 (sovereign)', fileId, pages: j.pages, ocrConfidence: j.conf, fields, signatures: j.signatures,
      notes: low ? ['Page 2 and page 4 contain handwriting; OCR confidence is below the review threshold', 'No official stamp detected next to the signature on page 4'] : [`${j.pages} pages read; typed text with clear FCDA letterhead`] };
  }

  const EXAMPLES = ['land allocation approval 2019 Kubwa', 'revocation of plot Bwari', 'staff quarters Gwarinpa', 'road contract award 2018'];
  const pct = c => `${Math.round(c * 100)}%`;

  class AIOcrSearch extends HTMLElement {
    connectedCallback() {
      this.folder = this.getAttribute('folder') || '';
      this.minConf = parseFloat(this.getAttribute('min-confidence') || '0.75');
      this.ready = [];
      this.innerHTML = `<section class="aiocr" aria-live="polite">
        <div class="aiocr__head"><span class="aiocr__title"><span class="ai-badge">CICOD-AI</span> Search inside scanned files</span>
          <span class="ai-confidence" data-model>OCR index · ${esc(this.folder)}</span></div>
        <form class="aiocr__form" data-form>
          <input class="g-input aiocr__q" name="q" type="search" autocomplete="off" placeholder='Describe what you are looking for, e.g. "land allocation approval 2019 Kubwa"' aria-label="Semantic search in historic files">
          <button class="g-btn g-btn--ai" type="submit">Search</button>
        </form>
        <div class="aiocr__examples">Try: ${EXAMPLES.map(e => `<button class="g-chip aiocr__ex" type="button" data-ex="${esc(e)}">${esc(e)}</button>`).join('')}</div>
        <div class="aiocr__grid">
          <div class="aiocr__results" data-results><p class="aiocr__empty">Search by meaning, not just file name. CICOD-AI reads the scanned pages, so you can search for the words inside a file jacket.</p></div>
          <aside class="aiocr__meta" data-meta><p class="aiocr__empty">Select a result or a file's <b>✦ Metadata</b> button to see what CICOD-AI extracted from it.</p></aside>
        </div>
      </section>`;
      const input = this.querySelector('.aiocr__q');
      let t;
      input.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => this.search(input.value), 600); });
      this.querySelector('[data-form]').addEventListener('submit', e => { e.preventDefault(); clearTimeout(t); this.search(input.value); });
      this.querySelectorAll('[data-ex]').forEach(b => b.addEventListener('click', () => { input.value = b.dataset.ex; this.search(b.dataset.ex); }));
      this.loadStatus();
    }

    async loadStatus() {
      const res = await request('/drive/ocr-status', { folder: this.folder, ready: this.ready }, { mock: mockStatus, feature: 'drive.historic-ocr' });
      this.dispatchEvent(new CustomEvent('ai-ocr-status', { detail: { files: res.files }, bubbles: true }));
      // Prototype: the file still in the OCR queue finishes a few seconds later.
      const pending = res.files.filter(f => f.status === 'Processing' && !this.ready.includes(f.id));
      if (pending.length) setTimeout(() => { this.ready.push(...pending.map(f => f.id)); this.loadStatus(); }, 9000);
    }

    async search(query) {
      const q = (query || '').trim();
      const box = this.querySelector('[data-results]');
      if (q.length < 3) { box.innerHTML = '<p class="aiocr__empty">Type at least a few words.</p>'; return; }
      box.innerHTML = '<div class="ai-skeleton" style="width:55%"></div>' + '<div class="aiocr__skel"><div class="ai-skeleton aiocr__skel-thumb"></div><div style="flex:1"><div class="ai-skeleton" style="width:70%"></div><div class="ai-skeleton"></div><div class="ai-skeleton" style="width:85%"></div></div></div>'.repeat(2);
      const res = await request('/drive/historic-search', { query: q, folder: this.folder, ready: this.ready }, { mock: mockSearch, feature: 'drive.historic-ocr' });
      this.last = res;
      const u = res.understood;
      const chips = [
        u.topic.length ? `<span class="g-chip g-chip--ai">Topic: ${esc(u.topic.join(' '))}</span>` : '',
        u.year ? `<span class="g-chip g-chip--ai">Year: ${esc(u.year)}</span>` : '',
        u.place ? `<span class="g-chip g-chip--ai">Place: ${esc(u.place)}</span>` : '',
      ].join('');
      const hl = (text, terms) => {
        const safe = esc(text);
        const ws = terms.filter(w => /^\w+$/.test(w));
        return ws.length ? safe.replace(new RegExp(`\\b(${ws.map(escRe).join('|')})\\w*`, 'gi'), '<mark>$&</mark>') : safe;
      };
      const items = res.results.map((r, i) => `<article class="aiocr__result" data-i="${i}">
          <div class="aiocr__thumb" aria-hidden="true"><i></i><i></i><i class="aiocr__thumb-hit"></i><i></i><i></i><span>p.${esc(r.page)}</span></div>
          <div class="aiocr__rbody">
            <div class="aiocr__rtitle">${esc(r.name)}${r.review ? ' <span class="g-chip g-chip--warn">Needs review</span>' : ''}</div>
            <div class="aiocr__rsub">${esc(r.ref)} · page ${esc(r.page)} of ${esc(r.pages)} · match ${pct(r.score)}</div>
            <p class="aiocr__snip">${hl(r.snippet, r.terms)}</p>
            ${r.via.length ? `<div class="aiocr__via">Matched by meaning: ${esc(r.via.join(', '))}</div>` : ''}
            <div class="aiocr__ractions">
              <button class="g-btn g-btn--sm" type="button" data-open="${i}">Open at page ${esc(r.page)}</button>
              <button class="g-btn g-btn--sm g-btn--ai" type="button" data-meta-for="${esc(r.fileId)}">✦ Metadata</button>
              <button class="g-btn g-btn--sm g-btn--ghost" type="button" data-bad="${i}">Not relevant</button>
            </div>
          </div>
        </article>`).join('');
      box.innerHTML = `<div class="aiocr__understood"><span>CICOD-AI understood:</span>${chips || '<span class="g-chip">keywords only</span>'}<span class="ai-confidence">${esc(res.model)}</span></div>
        ${items || `<p class="aiocr__empty">No scanned page matches "${esc(q)}". Try fewer words, or a different year or place.</p>`}
        ${res.skipped ? `<p class="aiocr__note">${esc(res.skipped)} file is still being processed by OCR and is not searchable yet.</p>` : ''}`;
      box.querySelectorAll('[data-open]').forEach(b => b.addEventListener('click', () => {
        const r = res.results[+b.dataset.open];
        feedback(res.id, 'drive.historic-ocr', 'opened-result', { fileId: r.fileId, rank: +b.dataset.open + 1 });
        this.dispatchEvent(new CustomEvent('ai-ocr-open', { detail: { fileId: r.fileId, page: r.page }, bubbles: true }));
      }));
      box.querySelectorAll('[data-meta-for]').forEach(b => b.addEventListener('click', () => this.inspect(b.dataset.metaFor)));
      box.querySelectorAll('[data-bad]').forEach(b => b.addEventListener('click', () => {
        const r = res.results[+b.dataset.bad];
        feedback(res.id, 'drive.historic-ocr', 'irrelevant', { fileId: r.fileId });
        b.closest('.aiocr__result').classList.add('aiocr__result--dim');
        b.textContent = 'Marked not relevant';
        b.disabled = true;
      }));
      this.dispatchEvent(new CustomEvent('ai-ocr-results', { detail: res, bubbles: true }));
    }

    async inspect(fileId) {
      const panel = this.querySelector('[data-meta]');
      const j = byId(fileId);
      if (!j) return;
      if (j.status === 'Processing' && !this.ready.includes(fileId)) {
        panel.innerHTML = `<h4 class="aiocr__mh">${esc(j.name)}</h4><p class="aiocr__empty">OCR is still running on this file (${esc(j.pages)} pages). Metadata appears when it finishes.</p>`;
        return;
      }
      panel.innerHTML = '<div class="ai-skeleton" style="width:60%"></div>' + '<div class="ai-skeleton"></div>'.repeat(5);
      panel.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      const res = await request('/drive/ocr-extract', { fileId }, { mock: mockExtract, feature: 'drive.historic-ocr' });
      this.meta = res;
      this.renderMeta(false);
    }

    renderMeta(editing) {
      const res = this.meta;
      const j = byId(res.fileId);
      const panel = this.querySelector('[data-meta]');
      const flagged = res.fields.filter(f => f.confidence < this.minConf).length;
      const rows = res.fields.map((f, i) => `<div class="aiocr__field ${f.confidence < this.minConf ? 'aiocr__field--low' : ''}">
          <span class="aiocr__flabel">${esc(f.label)}</span>
          ${editing ? `<input class="g-input aiocr__finput" data-f="${i}" value="${esc(f.value)}" aria-label="${esc(f.label || 'Party')}">` : `<span class="aiocr__fval">${esc(f.value)}</span>`}
          <span class="aiocr__fconf">${f.confidence < this.minConf ? 'check · ' : ''}${pct(f.confidence)}</span>
        </div>`).join('');
      const sigs = res.signatures.length ? res.signatures.map(s => `<li>Page ${esc(s.page)}: ${esc(s.kind)} (${esc(s.who)})</li>`).join('') : '<li>None detected</li>';
      panel.innerHTML = `<h4 class="aiocr__mh">Extracted metadata</h4>
        <div class="aiocr__msub">${esc(j.name)} · ${esc(res.pages)} pages · OCR ${pct(res.ocrConfidence)}</div>
        ${flagged ? `<div class="aiocr__warn">${esc(flagged)} field${flagged > 1 ? 's' : ''} below ${pct(this.minConf)} confidence. Check them against the scan before accepting.</div>` : ''}
        <div class="aiocr__fields">${rows}</div>
        <div class="aiocr__sigs"><b>Signatures detected</b><ul>${sigs}</ul></div>
        <ul class="aiocr__notes">${res.notes.map(n => `<li>${esc(n)}</li>`).join('')}</ul>
        <div class="aiocr__mactions">
          ${editing ? '<button class="g-btn g-btn--primary g-btn--sm" type="button" data-save>Save edits</button>' : '<button class="g-btn g-btn--ai g-btn--sm" type="button" data-accept>Accept metadata</button><button class="g-btn g-btn--sm" type="button" data-edit>Edit</button>'}
          <button class="g-btn g-btn--sm" type="button" data-reject>Reject</button>
          <span class="ai-confidence">${esc(res.model)}</span>
        </div>`;
      panel.querySelector('[data-edit]')?.addEventListener('click', () => this.renderMeta(true));
      panel.querySelector('[data-accept]')?.addEventListener('click', () => this.accept(false));
      panel.querySelector('[data-save]')?.addEventListener('click', () => {
        panel.querySelectorAll('[data-f]').forEach(inp => { res.fields[+inp.dataset.f].value = inp.value; res.fields[+inp.dataset.f].confidence = 1; });
        this.accept(true);
      });
      panel.querySelector('[data-reject]').addEventListener('click', () => {
        feedback(res.id, 'drive.historic-ocr', 'rejected', { fileId: res.fileId });
        this.dispatchEvent(new CustomEvent('ai-ocr-review', { detail: { fileId: res.fileId, action: 'rejected' }, bubbles: true }));
        panel.innerHTML = `<p class="aiocr__empty">Metadata rejected. ${esc(j.name)} was sent to the Registry for manual indexing.</p>`;
      });
    }

    accept(edited) {
      const res = this.meta;
      const val = k => (res.fields.find(f => f.key === k) || {}).value;
      const metadata = {
        ref: val('ref'), subject: val('subject'),
        dates: res.fields.filter(f => f.key.startsWith('date')).map(f => `${f.label}: ${f.value}`),
        parties: res.fields.filter(f => f.key.startsWith('party')).map(f => f.value),
        signatures: res.signatures.length,
      };
      feedback(res.id, 'drive.historic-ocr', edited ? 'edited' : 'accepted', { fileId: res.fileId });
      this.dispatchEvent(new CustomEvent('ai-ocr-metadata-apply', { detail: { fileId: res.fileId, metadata }, bubbles: true }));
      const bar = this.querySelector('.aiocr__mactions');
      bar.innerHTML = `<span class="g-chip g-chip--ok">✓ Metadata saved to file${edited ? ' (with your edits)' : ''}</span>`;
    }
  }

  customElements.define('ai-ocr-search', AIOcrSearch);
})();
