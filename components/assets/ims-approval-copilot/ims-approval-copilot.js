/* <ai-asset-approval request="REQ-1234">
   Summarises an asset request or bulk dispatch for the approver.
   1. Checks current allocations for the user (does they already have one?).
   2. Checks stock levels and lead times.
   3. Highlights historical anomalies (e.g. asking for 3 laptops in 2 years).
   4. Makes a recommendation (Approve, Reject, or Modify).
*/
(function () {
  const { request, feedback, esc } = window.AIGateway;
  const FEATURE = 'assets.approval-copilot';

  // Mock data for requests
  const REQUESTS = {
    'REQ-8812': {
      type: 'requisition',
      user: 'Prince Ekpenyong',
      department: 'Administration',
      item: 'MacBook Pro 16" M3',
      reason: 'Needed for heavy video editing for internal comms',
      cost: '₦3,800,000'
    },
    'REQ-8813': {
      type: 'dispatch',
      branch: 'Kano Branch',
      item: 'A4 Paper (Reams)',
      quantity: 500,
      reason: 'Quarterly restocking'
    }
  };

  function mockApproval({ requestId }) {
    const req = REQUESTS[requestId];
    if (!req) return { model: 'cicod-assets-v1', error: 'Request not found' };

    let recommendation, decision, insights;

    if (req.type === 'requisition') {
      recommendation = 'Reject & Offer Standard Laptop';
      decision = 'bad';
      insights = [
        { label: 'Current Allocation', value: 'User currently holds a <b>Lenovo ThinkPad X1</b> assigned 14 months ago (Asset #LT-104).' },
        { label: 'Policy Check', value: 'Grade Level 8 does not automatically qualify for MacBook Pro devices without special project exemption.' },
        { label: 'Stock Status', value: '0 in stock. Lead time: 14 days.' }
      ];
    } else {
      recommendation = 'Modify Quantity to 100 Reams';
      decision = 'warn';
      insights = [
        { label: 'Consumption Anomaly', value: 'Requested <b>500 reams</b>. Average monthly consumption for Kano is <b>40 reams</b>. Request equals a 12-month supply.' },
        { label: 'Stock Impact', value: 'Approving 500 reams will drop Central Store stock to <b>150 reams</b>, triggering a critical reorder alert.' },
        { label: 'Recommendation', value: 'Approve 100 reams (2.5 months supply) to preserve central buffer stock.' }
      ];
    }

    return {
      model: 'cicod-assets-v1 (sovereign)',
      recommendation,
      decision,
      insights,
      confidence: 0.92
    };
  }

  class AIAssetApproval extends HTMLElement {
    static get observedAttributes() { return ['request']; }
    connectedCallback() { this.load(); }
    attributeChangedCallback(name, oldV, newV) { if (oldV !== newV) this.load(); }

    async load() {
      const requestId = this.getAttribute('request');
      if (!requestId) return;

      this.innerHTML = `<div class="ai-asset-approval"><div class="ai-skeleton" style="width:70%"></div><div class="ai-skeleton" style="width:100%;height:60px"></div></div>`;
      
      const res = await request('/assets/approval-copilot', { requestId }, { mock: mockApproval, feature: FEATURE, delay: 500 });
      this.res = res;
      this.render();
    }

    render() {
      const r = this.res;
      if (r.error) {
        this.innerHTML = `<div class="ai-asset-approval"><p class="ai-aa__empty">${esc(r.error)}</p></div>`;
        return;
      }

      const insightsHtml = r.insights.map(i => `
        <div class="ai-aa__insight">
          <div class="ai-aa__insight-label">${esc(i.label)}</div>
          <div class="ai-aa__insight-value">${i.value}</div>
        </div>
      `).join('');

      this.innerHTML = `
        <div class="ai-asset-approval" aria-live="polite">
          <div class="ai-aa__header">
            <span class="ai-aa__title"><span class="ai-badge">CICOD-AI</span> Asset Approval Copilot</span>
            <span class="ai-confidence">${Math.round(r.confidence * 100)}% confidence</span>
          </div>
          
          <div class="ai-aa__rec ai-aa__rec--${r.decision}">
            <div class="ai-aa__rec-title">AI Recommendation: ${esc(r.recommendation)}</div>
            <div class="ai-aa__actions">
              ${r.decision === 'warn' ? `<button class="g-btn g-btn--sm" data-action="modify" type="button">Modify Request</button>` : ''}
              <button class="g-btn g-btn--sm ${r.decision === 'ok' ? 'g-btn--primary' : ''}" data-action="approve" type="button">Approve</button>
              <button class="g-btn g-btn--sm ${r.decision === 'bad' ? 'g-btn--primary' : ''}" data-action="reject" type="button">Reject</button>
            </div>
          </div>

          <div class="ai-aa__insights">
            ${insightsHtml}
          </div>
          <div style="font-size:11px;color:var(--text-3);text-align:right">${esc(r.model)}</div>
        </div>
      `;

      this.querySelectorAll('button[data-action]').forEach(b => b.addEventListener('click', () => {
        const action = b.dataset.action;
        feedback(r.id, FEATURE, 'approver-action', { action });
        this.dispatchEvent(new CustomEvent('ai-asset-decision', { detail: { action }, bubbles: true }));
      }));
    }
  }

  customElements.define('ai-asset-approval', AIAssetApproval);
})();
