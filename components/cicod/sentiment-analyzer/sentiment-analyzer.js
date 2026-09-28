/* <ai-sentiment-report period="week" queue="all">
   Reads every citizen submission (Paperless Service Portal "Engage Us", public webforms, feedback
   forms, email-to-task and WhatsApp), scores its sentiment, groups complaints into systemic issues,
   detects spikes, and writes the weekly Executive Sentiment Report with recommended actions.
   Attributes:
     period   week | last-week | 30   (the user can change it)
     queue    "all" or a public queue name (the user can change it)
   Events (the host page acts on them):
     ai-sentiment-task  detail: { theme, queue, queueType, priority, title, description }  create an ECMS task
     ai-sentiment-send  detail: { period, headline, summary, index }                       send the report by InMail
   Gateway:
     POST /portal/sentiment { period, queue }
       -> { model, total, index, prevIndex, split:{neg,neu,pos}, trend:[{label,neg,neu,pos}],
            headline, summary, issues:[{ theme, name, count, share, spike (× usual daily rate), queue, quotes[], action:{…} }], confidence } */
(function () {
  const { request, feedback, esc } = window.AIGateway;
  const FEATURE = 'portal.sentiment';

  // Prototype-only themes and sample wording. In production themes are discovered by clustering
  // submission embeddings each week, then named by an LLM; they aren't a fixed list.
  const THEMES = {
    payment: {
      name: 'Online payment gateway failing', queue: 'Bid Submission', tone: -0.75,
      texts: ['The payment page keeps failing after I enter my card details. Money was deducted but no receipt was issued.', 'Remita page timed out three times while paying the application fee.', 'I was debited twice for the same application fee and nobody has reversed it.', 'Dem don debit me but the payment no go through o. Please help.', 'Payment keeps showing "transaction failed" even though my bank says it went through.'],
      action: { queue: 'IT Support', queueType: 'Hardware & Network', priority: 'Critical', title: 'Investigate payment gateway failures and reverse double debits', description: 'Citizens report failed payments with money deducted and no receipt. Check the gateway logs since Tuesday, reconcile debits against receipts, and reverse duplicates. Publish a status notice on the portal.' },
    },
    silence: {
      name: 'No response after submitting', queue: 'Complaints', tone: -0.6,
      texts: ['I submitted my complaint two weeks ago and nobody has replied.', 'Still no update on my request. The portal says received and nothing else.', 'This is the third time I am following up on the same issue.', 'I was told I would be notified but I have heard nothing.'],
      action: { queue: 'Complaints', queueType: 'Application issue', priority: 'High', title: 'Clear public submissions with no response after 10 days', description: 'Work through Engage Us submissions older than 10 working days with no officer remark. Send each citizen a status update, even if the request is still being treated.' },
    },
    tracking: {
      name: 'Tracking ID not recognised', queue: 'Customer service', tone: -0.5,
      texts: ['The tracking ID I received by email says "not found" on Track Engagement.', 'I never got a tracking ID after submitting.', 'Track Engagement rejects my email address and tracking ID together.'],
      action: { queue: 'IT Support', queueType: 'Hardware & Network', priority: 'High', title: 'Fix Track Engagement lookups failing for valid tracking IDs', description: 'Citizens with valid tracking IDs get "not found". Check the ID format sent in the confirmation email against the lookup, and resend IDs that were never delivered.' },
    },
    upload: {
      name: 'Document upload errors', queue: 'Customer service', tone: -0.45,
      texts: ['The upload fails for any PDF above 2MB.', 'I cannot attach my CAC certificate. The page just spins.', 'Photo upload says "invalid format" for a normal JPG.'],
      action: { queue: 'IT Support', queueType: 'Hardware & Network', priority: 'Medium', title: 'Raise the portal upload limit and fix JPG validation', description: 'Uploads above 2MB and some JPG files are rejected. Raise the limit to 10MB and compress on the device, to match what citizens attach (scans of certificates and IDs).' },
    },
    impersonation: {
      name: 'People impersonating staff', queue: 'Fraud and Risk Management', tone: -0.8,
      texts: ['Someone called claiming to be your staff and asked me to pay to "fast-track" my request.', 'A man with a fake ID card said he works for the ministry and collected money from us.'],
      action: { queue: 'Fraud and Risk Management', queueType: 'General enquiry', priority: 'High', title: 'Publish a scam alert and promote Verify Staff', description: 'Citizens report people posing as staff and asking for payment. Publish an alert on the portal home page and in the confirmation email: we never ask for payment by phone. Link to Verify Staff.' },
    },
    enquiry: {
      name: 'General enquiries', queue: 'Correspondence', tone: 0, neutral: true,
      texts: ['How do I get a copy of my certificate?', 'What documents do I need for a bid submission?', 'Please what are your office hours on Friday?'],
    },
    praise: {
      name: 'Praise for fast, easy service', queue: 'Customer service', tone: 0.8,
      texts: ['Thank you, my request was treated in two days.', 'Very easy to use. Well done to the team.', 'The officer called me back the same day. Excellent service.', 'Good initiative. No need to come to the office any more.'],
    },
  };
  // Expected submissions per day, by theme. Payment failures surge in the last 5 days.
  const RATE = (theme, day) => ({
    payment: day <= 4 ? 7 : 0.5, enquiry: 1.2, silence: 2, tracking: 0.8, upload: 0.6, impersonation: day <= 9 ? 0.4 : 0.1, praise: 1.3,
  })[theme];

  // Seeded random numbers, so the prototype shows the same data on every load.
  function rng(seed) { return () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; }; }
  const DATA = (() => {
    const r = rng(20260928); const out = [];
    for (let day = 0; day < 30; day++) {
      for (const theme of Object.keys(THEMES)) {
        const n = Math.floor(RATE(theme, day) + r());
        for (let i = 0; i < n; i++) {
          const t = THEMES[theme];
          const s = t.tone + (r() - 0.5) * (t.neutral ? 0.3 : 0.5);
          out.push({ day, theme, queue: t.queue, text: t.texts[Math.floor(r() * t.texts.length)], sentiment: s, channel: ['Portal', 'Portal', 'Email', 'WhatsApp'][Math.floor(r() * 4)] });
        }
      }
    }
    return out;
  })();

  const cls = s => (s < -0.2 ? 'neg' : s > 0.2 ? 'pos' : 'neu');
  const RANGES = { week: [[0, 6], [7, 13]], 'last-week': [[7, 13], [14, 20]], 30: [[0, 29], null] };
  const LABEL = { week: 'this week', 'last-week': 'last week', 30: 'in the last 30 days' };

  function analyse(items) {
    const split = { neg: 0, neu: 0, pos: 0 };
    items.forEach(i => { split[cls(i.sentiment)]++; });
    const total = items.length || 1;
    return { split, total: items.length, index: Math.round((split.pos - split.neg) / total * 100) };
  }

  function mockSentiment({ period, queue }) {
    const [cur, prev] = RANGES[period] || RANGES.week;
    const pick = ([a, b]) => DATA.filter(d => d.day >= a && d.day <= b && (queue === 'all' || d.queue === queue));
    const items = pick(cur);
    const now = analyse(items);
    const before = prev ? analyse(pick(prev)) : null;

    const negatives = items.filter(i => cls(i.sentiment) === 'neg');
    const byTheme = {};
    items.forEach(i => { (byTheme[i.theme] = byTheme[i.theme] || []).push(i); });
    const span = cur[1] - cur[0] + 1;
    // Neutral enquiries count towards the sentiment split but aren't issues.
    const issues = Object.entries(byTheme).filter(([theme]) => !THEMES[theme].neutral).map(([theme, list]) => {
      const t = THEMES[theme];
      const neg = list.filter(i => cls(i.sentiment) === 'neg').length;
      // Spike: the daily rate in the last 3 days of the period against the daily rate in the 14 days
      // before the period. At least 4 recent submissions are needed, so small numbers don't count.
      const recentCount = list.filter(i => i.day <= cur[0] + 2).length;
      const baseFrom = cur[1] + 1, baseTo = Math.min(29, cur[1] + 14);
      const baseDays = Math.max(0, baseTo - baseFrom + 1);
      const baseCount = DATA.filter(d => d.theme === theme && d.day >= baseFrom && d.day <= baseTo && (queue === 'all' || d.queue === queue)).length;
      const ratio = baseDays && baseCount ? (recentCount / 3) / (baseCount / baseDays) : null;
      const spike = recentCount >= 4 && ratio !== null && ratio >= 2 ? Math.round(ratio) : null; // times the usual daily rate
      return {
        theme, name: t.name, positive: t.tone > 0, count: list.length,
        share: t.tone > 0 ? list.length / Math.max(1, items.length) : neg / Math.max(1, negatives.length),
        spike, queue: t.queue, // spike = multiple of the usual daily rate, or null
        channels: [...new Set(list.map(i => i.channel))].join(', '),
        quotes: [...new Set(list.map(i => i.text))].slice(0, 2),
        action: t.action || null,
      };
    }).sort((a, b) => (a.positive - b.positive) || b.share - a.share);

    const top = issues.find(i => !i.positive);
    const praise = issues.find(i => i.positive);
    const headline = top ? `${Math.round(top.share * 100)}% of complaints ${LABEL[period]} were about ${top.name.charAt(0).toLowerCase() + top.name.slice(1)}${top.spike ? `, running at ${top.spike}× the usual daily rate over the last 3 days` : ''}.` : 'No complaints in this period.';
    const summary = `${now.total} citizen submissions ${LABEL[period]}${queue === 'all' ? ' across all public queues' : ` in ${queue}`}. The sentiment index is ${now.index}${before ? ` (${now.index - before.index >= 0 ? 'up' : 'down'} ${Math.abs(now.index - before.index)} points on the previous period)` : ''}. ` +
      (top ? `The biggest systemic issue is "${top.name}", reported through ${top.channels}. ` : '') +
      (praise ? `${praise.count} citizens praised fast, easy service, so the portal itself is working where requests are treated.` : '');

    const days = span <= 7 ? span : 10;
    const step = Math.ceil(span / days);
    const trend = [];
    for (let k = days - 1; k >= 0; k--) {
      const a = cur[0] + k * step, b = Math.min(cur[1], a + step - 1);
      const t = analyse(items.filter(i => i.day >= a && i.day <= b));
      const d = new Date(); d.setDate(d.getDate() - a);
      trend.push({ label: step === 1 ? d.toLocaleDateString('en-GB', { weekday: 'short' }) : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }), ...t.split });
    }
    return {
      model: 'cicod-portal-sentiment-v1 (multilingual sentiment + clustering + LLM)', period, queue,
      total: now.total, index: now.index, prevIndex: before ? before.index : null, split: now.split,
      trend, headline, summary, issues, confidence: Math.min(0.9, 0.5 + now.total / 300),
    };
  }

  const QUEUES = ['all', 'Bid Submission', 'Complaints', 'Customer service', 'Fraud and Risk Management'];

  class AISentimentReport extends HTMLElement {
    connectedCallback() {
      this.period = this.getAttribute('period') || 'week';
      this.queue = this.getAttribute('queue') || 'all';
      this.created = new Set();
      this.innerHTML = `<section class="aisa" aria-live="polite">
        <div class="aisa__head"><span class="aisa__title"><span class="ai-badge">CICOD-AI</span> Executive sentiment report</span>
          <span class="aisa__filters">
            <select class="g-select" data-period aria-label="Period"><option value="week">This week</option><option value="last-week">Last week</option><option value="30">Last 30 days</option></select>
            <select class="g-select" data-queue aria-label="Queue">${QUEUES.map(q => `<option value="${esc(q)}">${q === 'all' ? 'All public queues' : esc(q)}</option>`).join('')}</select>
          </span></div>
        <div class="aisa__body" data-body></div>
        <div class="aisa__actions" data-actions></div>
      </section>`;
      const p = this.querySelector('[data-period]'), q = this.querySelector('[data-queue]');
      p.value = this.period; q.value = this.queue;
      p.addEventListener('change', () => { this.period = p.value; this.load(); });
      q.addEventListener('change', () => { this.queue = q.value; this.load(); });
      this.load();
    }

    async load() {
      this.querySelector('[data-body]').innerHTML = '<div class="ai-skeleton" style="width:70%;height:16px"></div><div class="ai-skeleton" style="width:95%"></div><div class="ai-skeleton" style="width:85%"></div><div class="ai-skeleton" style="width:60%"></div>';
      this.res = await request('/portal/sentiment', { period: this.period, queue: this.queue }, { mock: mockSentiment, feature: FEATURE });
      this.sent = false;
      this.render();
    }

    render() {
      const r = this.res;
      const pct = n => (r.total ? Math.round(n / r.total * 100) : 0);
      const delta = r.prevIndex === null ? '' : (() => { const d = r.index - r.prevIndex; return `<span class="aisa__delta ${d >= 0 ? 'aisa__delta--up' : 'aisa__delta--down'}">${d >= 0 ? '▲' : '▼'} ${Math.abs(d)}</span>`; })();
      const maxDay = Math.max(1, ...r.trend.map(t => t.neg + t.neu + t.pos));
      const trend = r.trend.map(t => { const h = v => (v / maxDay * 100).toFixed(1); return `<div class="aisa__trend-bar" title="${t.neg} negative, ${t.neu} neutral, ${t.pos} positive"><i class="aisa__neg" style="height:${h(t.neg)}%;background:var(--bad)"></i><i style="height:${h(t.neu)}%;background:var(--text-3)"></i><i style="height:${h(t.pos)}%;background:var(--ok)"></i></div>`; }).join('');
      const issues = r.issues.map(i => `
        <div class="aisa__issue ${i.positive ? 'aisa__issue--pos' : ''}" data-theme="${esc(i.theme)}">
          <div class="aisa__issue-top"><span><span class="aisa__issue-name">${esc(i.name)}</span>
            <span class="aisa__issue-meta">${i.count} submission${i.count === 1 ? '' : 's'} · ${esc(i.queue)} · ${esc(i.channels)}</span>
            ${i.spike ? `<span class="g-chip g-chip--bad" style="margin-top:4px">Spike: ${i.spike}× the usual rate in the last 3 days</span>` : ''}</span>
            <span class="aisa__share"><b>${Math.round(i.share * 100)}%</b><span>${i.positive ? 'of all submissions' : 'of complaints'}</span></span></div>
          <div class="aisa__bar"><i style="width:${Math.round(i.share * 100)}%"></i></div>
          <div class="aisa__issue-body">
            ${i.quotes.map(q => `<p class="aisa__quote">"${esc(q)}"</p>`).join('')}
            ${i.action ? `<div class="aisa__rec"><b>Recommended action:</b> ${esc(i.action.title)}. <span class="ai-confidence">→ ${esc(i.action.queue)} · ${esc(i.action.priority)}</span>
              <div class="aisa__rec-actions">${this.created.has(i.theme) ? '<span class="aisa__done">ECMS task created ✓</span>' : `<button class="g-btn g-btn--ai g-btn--sm" data-task="${esc(i.theme)}" type="button">Create ECMS task</button><button class="g-btn g-btn--sm" data-skip="${esc(i.theme)}" type="button">Not now</button>`}</div></div>` : ''}
          </div>
        </div>`).join('');

      this.querySelector('[data-body]').innerHTML = r.total ? `
        <p class="aisa__headline" data-headline>${esc(r.headline)}</p>
        <p class="aisa__summary">${esc(r.summary)}</p>
        <div class="aisa__kpis">
          <div class="aisa__kpi"><b>${r.total}</b><span>Citizen submissions</span></div>
          <div class="aisa__kpi"><b>${r.index}${delta}</b><span>Sentiment index (−100 to 100)</span></div>
          <div class="aisa__kpi"><b>${pct(r.split.neg)}%</b><span>Negative</span></div>
          <div class="aisa__kpi"><b>${r.issues.filter(i => i.spike && !i.positive).length}</b><span>Issues spiking</span></div>
        </div>
        <h5 class="aisa__h5">Sentiment split</h5>
        <div class="aisa__split" role="img" aria-label="${pct(r.split.neg)}% negative, ${pct(r.split.neu)}% neutral, ${pct(r.split.pos)}% positive"><i class="aisa__neg" style="width:${pct(r.split.neg)}%"></i><i class="aisa__neu" style="width:${pct(r.split.neu)}%"></i><i class="aisa__pos" style="width:${pct(r.split.pos)}%"></i></div>
        <div class="aisa__legend"><span style="--c:var(--bad)">Negative ${r.split.neg}</span><span style="--c:var(--text-3)">Neutral ${r.split.neu}</span><span style="--c:var(--ok)">Positive ${r.split.pos}</span></div>
        <h5 class="aisa__h5">Submissions over time</h5>
        <div class="aisa__trend" style="--n:${r.trend.length}">${trend}</div>
        <div class="aisa__trend-labels" style="--n:${r.trend.length}">${r.trend.map(t => `<span>${esc(t.label)}</span>`).join('')}</div>
        <h5 class="aisa__h5">Systemic issues, largest first</h5>
        ${issues}` : '<p class="aisa__summary">No submissions for this period and queue.</p>';

      this.querySelector('[data-actions]').innerHTML = `
        <button class="g-btn g-btn--primary g-btn--sm" data-send type="button" ${this.sent || !r.total ? 'disabled' : ''}>${this.sent ? 'Sent ✓' : 'Send report to Perm Sec'}</button>
        <span class="ai-confidence">confidence ${Math.round(r.confidence * 100)}% · ${esc(r.model)}</span>
        <span class="aisa__mode">Personal details are removed from quotes</span>`;

      this.querySelectorAll('[data-task]').forEach(b => b.addEventListener('click', () => {
        const i = r.issues.find(x => x.theme === b.dataset.task);
        this.created.add(i.theme);
        feedback(r.id, FEATURE, 'task-created', { theme: i.theme });
        this.dispatchEvent(new CustomEvent('ai-sentiment-task', { detail: { theme: i.theme, ...i.action, description: `${i.action.description} Evidence: ${i.count} citizen submissions ${LABEL[r.period]} (${Math.round(i.share * 100)}% of complaints).` }, bubbles: true }));
        this.render();
      }));
      this.querySelectorAll('[data-skip]').forEach(b => b.addEventListener('click', () => {
        feedback(r.id, FEATURE, 'action-skipped', { theme: b.dataset.skip });
        b.closest('.aisa__rec').remove();
      }));
      this.querySelector('[data-send]').addEventListener('click', () => {
        this.sent = true;
        feedback(r.id, FEATURE, 'report-sent');
        this.dispatchEvent(new CustomEvent('ai-sentiment-send', { detail: { period: r.period, headline: r.headline, summary: r.summary, index: r.index }, bubbles: true }));
        this.render();
      });
    }
  }

  customElements.define('ai-sentiment-report', AISentimentReport);
})();
