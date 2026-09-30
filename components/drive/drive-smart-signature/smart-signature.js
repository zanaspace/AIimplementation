class AISmartSignature extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.shadowRoot.innerHTML = `
      <style>
        @import "../../../shared/tokens.css";
        @import "smart-signature.css";
        :host { display: block; }
      </style>
      <div class="sig-panel">
        <div class="sig-panel__header">
          <span class="ai-badge">CICOD-AI</span>
          <h3>Smart Signature Setup</h3>
        </div>
        
        <div class="sig-panel__section">
          <div class="sig-panel__label">Detected Signatories (2)</div>
          <div id="signers-list">
            <div class="sig-signer" style="opacity:0.5">Scanning document...</div>
          </div>
        </div>

        <div class="sig-panel__section">
          <div class="sig-panel__label">Signer's Brief</div>
          <div class="sig-brief" id="brief-content">
            Analyzing obligations and commitments...
          </div>
        </div>

        <div class="sig-actions">
          <button class="g-btn g-btn--primary" id="btn-place" disabled>Auto-Place Fields</button>
          <button class="g-btn" disabled>Edit Routing</button>
        </div>
      </div>
    `;
  }

  connectedCallback() {
    setTimeout(() => this.simulateAnalysis(), 1500);
  }

  simulateAnalysis() {
    const signersList = this.shadowRoot.getElementById('signers-list');
    const briefContent = this.shadowRoot.getElementById('brief-content');
    const btnPlace = this.shadowRoot.getElementById('btn-place');

    signersList.innerHTML = `
      <div class="sig-signer">
        <div class="sig-signer__info">
          <span class="sig-signer__name">Prince Ekpenyong</span>
          <span class="sig-signer__role">Director, Administration</span>
        </div>
        <span class="g-chip g-chip--ok">Matched</span>
      </div>
      <div class="sig-signer">
        <div class="sig-signer__info">
          <span class="sig-signer__name">Praise</span>
          <span class="sig-signer__role">Head of Finance</span>
        </div>
        <span class="g-chip g-chip--ok">Matched</span>
      </div>
    `;

    briefContent.innerHTML = `
      This document requires authorization for:
      <ul>
        <li><b>Service Agreement terms</b> with external vendor.</li>
        <li>Approval of attached project schedules and delivery dates.</li>
        <li>Standard confidentiality clauses apply.</li>
      </ul>
    `;

    btnPlace.disabled = false;
    btnPlace.addEventListener('click', () => {
      btnPlace.textContent = 'Fields Placed';
      btnPlace.classList.add('g-btn--ok');
      btnPlace.disabled = true;
      
      // Dispatch event for the host page to show the boxes on the document
      this.dispatchEvent(new CustomEvent('fields-placed', { bubbles: true, composed: true }));
    });
  }
}

customElements.define('ai-smart-signature', AISmartSignature);
