/* CICOD CICOD-AI Gateway client, shared by every CICOD-AI component.
   - In production, set window.cicod_ai = { baseUrl: '/ai', token: <CICOD session token> }
     before this script loads. Components then call the real gateway.
   - In the prototype (no baseUrl), each call resolves the component's `mock` function
     after a realistic delay, so every demo works offline.
   Every call emits an `ai:audit` event, which the platform's audit log listens for. */
(function () {
  const cfg = window.cicod_ai || {};
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  let seq = 0;

  function audit(entry) {
    window.dispatchEvent(new CustomEvent('ai:audit', { detail: { at: new Date().toISOString(), ...entry } }));
  }

  /**
   * request(endpoint, payload, { mock, delay, feature })
   * endpoint : gateway route, e.g. '/ecms/route-task'
   * payload  : JSON body. The gateway applies classification policy + PII redaction server-side.
   * mock     : (payload) => response. Used only when no baseUrl is configured.
   */
  async function request(endpoint, payload, opts = {}) {
    const id = `ai-${Date.now().toString(36)}-${++seq}`;
    const feature = opts.feature || endpoint;
    audit({ id, feature, endpoint, phase: 'request' });
    let result;
    if (cfg.baseUrl) {
      const res = await fetch(cfg.baseUrl + endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.token || ''}`, 'X-CICOD-AI-Feature': feature },
        credentials: 'include',
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`CICOD-AI gateway ${res.status}`);
      result = await res.json();
    } else {
      await sleep(opts.delay ?? 700 + Math.random() * 600);
      result = typeof opts.mock === 'function' ? opts.mock(payload) : opts.mock;
    }
    audit({ id, feature, endpoint, phase: 'response', model: result && result.model });
    return { id, ...result };
  }

  /** Record the user's decision on a suggestion. This is the quality and training signal. */
  function feedback(suggestionId, feature, action, extra = {}) {
    audit({ id: suggestionId, feature, phase: 'feedback', action, ...extra });
    if (cfg.baseUrl) {
      fetch(cfg.baseUrl + '/feedback', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.token || ''}` }, credentials: 'include', body: JSON.stringify({ suggestionId, feature, action, ...extra }) }).catch(() => {});
    }
  }

  /** Typewriter reveal for generated text (respects reduced motion). */
  async function reveal(el, text, speed = 8) {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { el.textContent = text; return; }
    el.textContent = '';
    for (let i = 0; i < text.length; i += 3) { el.textContent = text.slice(0, i + 3); await sleep(speed); }
  }

  /** Escape any text before it goes into innerHTML (CICOD-AI output is never trusted as HTML). */
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  window.AIGateway = { request, feedback, reveal, esc, sleep };
})();
