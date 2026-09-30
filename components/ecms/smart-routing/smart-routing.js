/* <ai-smart-routing trigger="#ai-route-btn" hidden>
   Inline Smart Intake & Routing for the ECMS Create Task screen (/ecms/tasks/new).
   Today the officer must pick Queue and Queue Type before the Form card loads. With this component
   the officer clicks "✦ Not sure? Describe it" on the Queue label row, describes the request in plain
   words, and CICOD-AI suggests the Queue, Queue Type, Priority and Assignee. Nothing changes until
   the officer clicks Apply. The host page then sets the selects and loads the queue's form with
   Title and Description pre-filled.
   Attributes:
     trigger   CSS selector of the ✦ link or button that opens and closes the box (the host places it).
               Its text switches to the value of its data-close-label (default "Close") while the box is open.
     hidden    start closed (recommended)
   Events (the host page owns the form):
     ai-route-apply   detail: { suggestionId, queue, queueType, priority, assignee, title, description }
                      (the host sends suggestionId back with the final values on Submit, as the learning signal)
     ai-route-reject  detail: { text }
   Gateway:
     POST /ecms/route-task { text, channel }
       -> { model, suggestions:{ queue, queueType, priority, assignee }  (each { value, confidence }),
            title, reasons[], duplicate:{ id, title, by, when } | null } */
(function () {
  const { request, feedback, esc } = window.AIGateway;
  const FEATURE = 'ecms.smart-routing';

  // Prototype-only rules. Queue and staff names come from the live govtest tenant. In production a
  // classifier trained on the tenant's past tasks makes these predictions.
  const RULES = [
    { k: /printer|laptop|network|internet|email|password|system|computer|wifi|scanner/i, queue: 'IT Support', type: 'Hardware & Network', assignee: 'Eyitayo Abidogun' },
    { k: /complain|delay|not delivered|refund|poor service|rude|third time/i, queue: 'Complaints', type: 'Application issue', assignee: 'Application Complaints Handlers' },
    { k: /order|deliver|supply|dispatch|fulfil|stationer/i, queue: 'Order Fulfilment', type: 'Delivery', assignee: 'Nathan Wilson' },
    { k: /repair|vehicle|car|brake|mechanic|hilux/i, queue: 'AUTO MOBILE REPAIR', type: 'REPAIR DEATAILS', assignee: 'TESTING ACCOUNT workgroup' },
    { k: /\bai\b|automat|process|digiti/i, queue: 'AI IMPLEMENTATION', type: 'PROCESS GATHERING', assignee: 'Chinwuba Okafor' },
  ];

  function mockRoute({ text }) {
    const rule = RULES.find(r => r.k.test(text)) || { queue: 'Correspondence', type: 'General enquiry', assignee: 'Ann Nya' };
    const known = RULES.includes(rule);
    const urgent = /urgent|asap|immediately|today|emergency|safety|fire|critical/i.test(text);
    const angry = /angry|unacceptable|third time|again|still/i.test(text);
    const conf = Math.min(0.96, (known ? 0.74 : 0.55) + (text.length > 50 ? 0.16 : 0.04));
    const first = text.split(/[.,;\n]/)[0].trim();
    return {
      model: 'cicod-router-v1 (sovereign)',
      title: first.length > 70 ? first.slice(0, 67) + '…' : first.charAt(0).toUpperCase() + first.slice(1),
      suggestions: {
        queue: { value: rule.queue, confidence: conf },
        queueType: { value: rule.type, confidence: conf - 0.05 },
        priority: { value: urgent ? 'High' : angry ? 'Medium' : 'Normal', confidence: urgent || angry ? 0.9 : 0.72 },
        assignee: { value: rule.assignee, confidence: conf - 0.1 },
      },
      reasons: [
        known ? `Words like these went to ${rule.queue} in ${Math.round(conf * 100)}% of similar past tasks.` : 'No close match with past tasks, so it was sent to Correspondence for triage.',
        urgent ? 'Mentions a deadline or safety term, so priority was raised.' : angry ? 'Reads as a repeat complaint, so priority was raised to Medium.' : 'No deadline or safety terms found.',
        `${rule.assignee} is on shift now and has the lowest open load in that queue.`,
      ],
      duplicate: /printer/i.test(text) ? { id: '#17572', title: 'Printer on 2nd floor not working', by: 'Ann Nya', when: '26/09/2026' } : null,
    };
  }

  const ROWS = [['queue', 'Queue'], ['queueType', 'Queue Type'], ['priority', 'Priority'], ['assignee', 'Assign to']];
  const EXAMPLES = [
    "Printer on 2nd floor not working, urgent for today's board meeting",
    'Third time complaining: my order was still not delivered',
    'Official Hilux FG 214 KJA needs brake repair',
  ];

  class AISmartRouting extends HTMLElement {
    connectedCallback() {
      this.trigger = document.querySelector(this.getAttribute('trigger'));
      this.innerHTML = `<div class="aisr" role="region" aria-label="Describe the request with CICOD-AI">
        <div class="aisr__top">
          <label class="aisr__label" for="aisr-text">Describe the request <small>✦ CICOD-AI</small></label>
          <textarea class="aisr__input" id="aisr-text" data-text placeholder="In your own words, e.g. &quot;Printer on 2nd floor not working, urgent for today's board meeting&quot;"></textarea>
          <p class="aisr__hint">CICOD-AI picks the queue, queue type, priority and assignee. You confirm before anything is filled in.</p>
          <div class="aisr__examples">${EXAMPLES.map(e => `<button class="aisr__example" data-example="${esc(e)}" type="button">${esc(e)}</button>`).join('')}</div>
        </div>
        <div class="aisr__result" data-result aria-live="polite"></div>
      </div>`;
      this.input = this.querySelector('[data-text]');
      let t;
      const box = this.querySelector('.aisr');
      const typed = () => box.classList.toggle('aisr--typed', this.input.value.trim().length > 0);
      this.input.addEventListener('input', () => { typed(); clearTimeout(t); t = setTimeout(() => this.analyse(), 700); });
      this.querySelectorAll('[data-example]').forEach(b => b.addEventListener('click', () => { this.input.value = b.dataset.example; typed(); this.analyse(); }));
      if (this.trigger) {
        this.openLabel = this.trigger.textContent;
        this.trigger.setAttribute('aria-controls', 'aisr-text');
        this.trigger.setAttribute('aria-expanded', String(!this.hidden));
        this.trigger.addEventListener('click', () => this.toggle());
      }
    }

    toggle(open = this.hidden) {
      this.hidden = !open;
      if (this.trigger) {
        this.trigger.setAttribute('aria-expanded', String(open));
        this.trigger.textContent = open ? (this.trigger.dataset.closeLabel || 'Close') : this.openLabel;
      }
      if (open) this.input.focus();
    }

    async analyse() {
      const text = this.input.value.trim();
      const out = this.querySelector('[data-result]');
      if (text.length < 12) { out.innerHTML = ''; return; }
      out.innerHTML = '<div class="ai-skeleton" style="width:75%"></div><div class="ai-skeleton" style="width:55%"></div><div class="ai-skeleton" style="width:65%"></div>';
      const res = await request('/ecms/route-task', { text, channel: 'ecms-create-task' }, { mock: mockRoute, feature: FEATURE });
      if (this.input.value.trim() !== text) return; // the officer kept typing; a newer request will render
      this.res = res;
      this.render();
    }

    render() {
      const r = this.res, s = r.suggestions;
      this.querySelector('[data-result]').innerHTML = `
        ${ROWS.map(([k, label]) => `<div class="aisr__row"><span class="aisr__key">${label}</span><span class="aisr__val" data-val="${k}">${esc(s[k].value)}</span>
          <span class="aisr__bar ${s[k].confidence < 0.8 ? 'aisr__bar--mid' : ''}" title="${Math.round(s[k].confidence * 100)}% confident"><i style="width:${Math.round(s[k].confidence * 100)}%"></i></span></div>`).join('')}
        ${r.duplicate ? `<div class="aisr__dup"><b>Possible duplicate:</b> ${esc(r.duplicate.id)} "${esc(r.duplicate.title)}", raised by ${esc(r.duplicate.by)} on ${esc(r.duplicate.when)}.</div>` : ''}
        <details class="aisr__why"><summary>Why these suggestions</summary><ul>${r.reasons.map(x => `<li>${esc(x)}</li>`).join('')}</ul></details>
        <div class="aisr__actions">
          <button class="g-btn g-btn--ai g-btn--sm" data-apply type="button">Apply to task</button>
          <button class="g-btn g-btn--sm" data-reject type="button">Not right</button>
          <span class="aisr__model">${esc(r.model)}</span>
        </div>`;
      this.querySelector('[data-apply]').addEventListener('click', () => this.apply());
      this.querySelector('[data-reject]').addEventListener('click', () => {
        feedback(r.id, FEATURE, 'rejected');
        this.dispatchEvent(new CustomEvent('ai-route-reject', { detail: { text: this.input.value }, bubbles: true }));
        this.querySelector('[data-result]').innerHTML = '<p class="aisr__hint">Thanks. Pick the queue yourself below, and your choice will help CICOD-AI learn.</p>';
      });
    }

    apply() {
      const r = this.res, s = r.suggestions;
      feedback(r.id, FEATURE, 'accepted');
      this.querySelectorAll('[data-val]').forEach(v => v.classList.add('aisr__val--applied'));
      this.querySelector('[data-apply]').outerHTML = '<span class="aisr__applied">Applied. Check the form on the right →</span>';
      this.dispatchEvent(new CustomEvent('ai-route-apply', { detail: {
        suggestionId: r.id, queue: s.queue.value, queueType: s.queueType.value, priority: s.priority.value, assignee: s.assignee.value,
        title: r.title, description: this.input.value.trim(),
      }, bubbles: true }));
    }
  }

  // Clear the box and close it, e.g. after the task is submitted and the officer starts another one.
  AISmartRouting.prototype.reset = function () {
    this.input.value = '';
    this.querySelector('.aisr').classList.remove('aisr--typed');
    this.querySelector('[data-result]').innerHTML = '';
    this.res = null;
    this.toggle(false);
  };

  customElements.define('ai-smart-routing', AISmartRouting);
})();
