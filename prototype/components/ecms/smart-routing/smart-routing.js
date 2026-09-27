/* <ai-smart-routing source="#task-form" auto-threshold="0.9">
   Watches the task's title and description (and attachment names) and suggests Queue,
   Queue Type, Priority and Assignee. It never changes the form by itself: the officer
   accepts each suggestion or all of them together.
   Events:
     ai-route-apply  detail: { field, value }   the host page sets the field
     ai-route-result detail: suggestion payload
   Gateway: POST /ecms/route-task -> { suggestions:{queue,queueType,priority,assignee}, reasons[], similar[], duplicate? } */
(function () {
  const { request, feedback, esc } = window.AIGateway;

  // Prototype-only knowledge: queue names and staff are taken from the live cicod tenant.
  const RULES = [
    { k: /printer|laptop|network|internet|email|password|system|computer|wifi/i, queue: 'IT Support', type: 'Hardware & Network', assignee: 'Eyitayo Abidogun (IT Resource · Daily Shift)', alt: 'Damola Tunde' },
    { k: /complain|delay|not delivered|refund|poor service|angry|rude/i, queue: 'Complaints', type: 'Application issue', assignee: 'Application Complaints Handlers (workgroup)', alt: 'Adedero Cosmos' },
    { k: /order|deliver|supply|dispatch|fulfil/i, queue: 'Order Fulfilment', type: 'Delivery', assignee: 'Dispatch riders shift · Nathan Wilson', alt: 'Benita Benita' },
    { k: /repair|vehicle|car|auto|mechanic/i, queue: 'AUTO MOBILE REPAIR', type: 'REPAIR DETAILS', assignee: 'TESTING ACCOUNT workgroup', alt: 'Fleet officer' },
    { k: /ai|automat|process|digiti/i, queue: 'CICOD-AI IMPLEMENTATION', type: 'PROCESS GATHERING', assignee: 'Chinwuba Okafor', alt: 'api support' },
  ];

  function mockRoute({ title = '', description = '' }) {
    const text = `${title} ${description}`;
    const rule = RULES.find(r => r.k.test(text)) || { queue: 'Correspondence', type: 'General enquiry', assignee: 'Registry desk', alt: 'Ann Nya' };
    const urgent = /urgent|asap|immediately|today|emergency|safety|fire|critical/i.test(text);
    const angry = /angry|unacceptable|third time|again|still/i.test(text);
    const conf = Math.min(0.97, 0.62 + (text.length > 60 ? 0.2 : 0.05) + (RULES.includes(rule) ? 0.12 : 0));
    return {
      model: 'cicod-router-v1 (sovereign)',
      suggestions: {
        queue: { value: rule.queue, confidence: conf, alt: 'Correspondence' },
        queueType: { value: rule.type, confidence: conf - 0.06, alt: 'General enquiry' },
        priority: { value: urgent ? 'High' : angry ? 'Medium' : 'Normal', confidence: urgent ? 0.91 : 0.74, alt: urgent ? 'Critical' : 'Low' },
        assignee: { value: rule.assignee, confidence: conf - 0.12, alt: rule.alt },
      },
      reasons: [
        `Keywords match ${rule.queue} tasks (${Math.round(conf * 100)}% of similar past tasks went there)`,
        urgent ? 'The request mentions a deadline or safety terms, so priority was raised' : 'No deadline or safety terms found',
        angry ? 'Negative sentiment detected: repeat complaint' : 'Neutral sentiment',
        'Assignee is on shift now and has the lowest open load in that workgroup',
      ],
      similar: [
        { id: '#17569', title: `${rule.queue}: similar request`, outcome: 'Closed in 2d' },
        { id: '#17492', title: 'Linked request from same contact', outcome: 'In progress' },
      ],
      duplicate: /printer/i.test(text) ? { id: '#17572', title: 'Printer on 2nd floor not working', by: 'Ann Nya', when: '26/09/2026' } : null,
    };
  }

  const FIELDS = [['queue', 'Queue'], ['queueType', 'Queue type'], ['priority', 'Priority'], ['assignee', 'Assign to']];
  const barClass = c => (c >= 0.85 ? '' : c >= 0.7 ? 'aisr__bar--mid' : 'aisr__bar--low');

  class AISmartRouting extends HTMLElement {
    connectedCallback() {
      this.threshold = parseFloat(this.getAttribute('auto-threshold') || '0.9');
      this.source = document.querySelector(this.getAttribute('source'));
      this.renderEmpty();
      if (!this.source) return;
      let t;
      this.source.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => this.analyse(), 700); });
    }

    read() {
      const f = this.source;
      return {
        title: f.querySelector('[name=title]')?.value || '',
        description: f.querySelector('[name=description]')?.value || '',
        contact: f.querySelector('[name=contact]')?.value || '',
        channel: 'ecms-create-task',
      };
    }

    renderEmpty() {
      this.innerHTML = `<section class="aisr" aria-live="polite">
        <div class="aisr__head"><span class="aisr__title"><span class="ai-badge">CICOD-AI</span> Smart routing</span></div>
        <div class="aisr__body"><p class="aisr__empty">Start typing the request title or description. CICOD-AI will suggest the queue, queue type, priority and the best person to handle it.</p></div>
      </section>`;
    }

    renderLoading() {
      this.querySelector('.aisr__body').innerHTML = '<div class="ai-skeleton" style="width:80%"></div><div class="ai-skeleton" style="width:60%"></div><div class="ai-skeleton" style="width:70%"></div>';
    }

    async analyse() {
      const payload = this.read();
      if ((payload.title + payload.description).trim().length < 12) return this.renderEmpty();
      this.renderLoading();
      const res = await request('/ecms/route-task', payload, { mock: mockRoute, feature: 'ecms.smart-routing' });
      this.result = res;
      this.render(res);
      this.dispatchEvent(new CustomEvent('ai-route-result', { detail: res, bubbles: true }));
    }

    render(res) {
      const s = res.suggestions;
      const rows = FIELDS.map(([key, label]) => {
        const v = s[key];
        return `<div class="aisr__field" data-field="${key}">
          <span class="aisr__field-label">${label}</span>
          <span class="aisr__field-value">${esc(v.value)}<span class="aisr__field-alt">or ${esc(v.alt)}</span></span>
          <span class="aisr__conf"><span class="aisr__bar ${barClass(v.confidence)}"><i style="width:${Math.round(v.confidence * 100)}%"></i></span>
            <button class="g-btn g-btn--sm" data-apply="${key}" type="button">Use</button></span>
        </div>`;
      }).join('');
      const minConf = Math.min(...FIELDS.map(([k]) => s[k].confidence));
      const auto = minConf >= this.threshold;
      this.innerHTML = `<section class="aisr" aria-live="polite">
        <div class="aisr__head"><span class="aisr__title"><span class="ai-badge">CICOD-AI</span> Smart routing</span>
          <span class="ai-confidence">${auto ? 'high confidence' : 'review suggested'} · ${esc(res.model)}</span></div>
        <div class="aisr__body">
          ${rows}
          ${res.duplicate ? `<div class="aisr__dup"><b>Possible duplicate:</b> ${esc(res.duplicate.id)} "${esc(res.duplicate.title)}", raised by ${esc(res.duplicate.by)} on ${esc(res.duplicate.when)}. <a href="#" data-link-dup>Link instead of creating?</a></div>` : ''}
          <div class="aisr__why"><b>Why these suggestions</b><ul>${res.reasons.map(r => `<li>${esc(r)}</li>`).join('')}</ul></div>
          <div class="aisr__similar"><h5>Similar past tasks</h5>${res.similar.map(x => `<div class="aisr__sim"><span>${esc(x.id)} ${esc(x.title)}</span><span>${esc(x.outcome)}</span></div>`).join('')}</div>
        </div>
        <div class="aisr__actions">
          <button class="g-btn g-btn--ai g-btn--sm" data-apply-all type="button">Apply all</button>
          <button class="g-btn g-btn--sm" data-reject type="button">Not right</button>
          <span class="aisr__mode">Suggestion only · officer confirms</span>
        </div>
      </section>`;
      this.querySelectorAll('[data-apply]').forEach(b => b.addEventListener('click', () => this.apply(b.dataset.apply)));
      this.querySelector('[data-apply-all]').addEventListener('click', () => FIELDS.forEach(([k]) => this.apply(k)));
      this.querySelector('[data-reject]').addEventListener('click', () => { feedback(res.id, 'ecms.smart-routing', 'rejected'); this.renderEmpty(); });
      this.querySelector('[data-link-dup]')?.addEventListener('click', e => { e.preventDefault(); feedback(res.id, 'ecms.smart-routing', 'linked-duplicate'); e.target.textContent = 'Linked ✓'; });
    }

    apply(field) {
      const value = this.result.suggestions[field].value;
      this.querySelector(`[data-field="${field}"]`)?.classList.add('aisr__field--applied');
      feedback(this.result.id, 'ecms.smart-routing', 'accepted', { field });
      this.dispatchEvent(new CustomEvent('ai-route-apply', { detail: { field, value }, bubbles: true }));
    }
  }

  customElements.define('ai-smart-routing', AISmartRouting);
})();
