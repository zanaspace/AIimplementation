/* <ai-goal-alignment source="#goal-form" dept-goals="#dept-goals" department="Administration" period="Q4 2026">
   Checks an employee's draft goals against the departmental goals before they're submitted:
     1. Links each personal goal to the departmental goal(s) it supports, with an alignment score.
     2. Scores each goal on SMART (Specific, Measurable, Achievable, Relevant, Time-bound)
        and proposes a rewrite that fixes the gaps while keeping the employee's intent.
     3. Shows coverage of every departmental goal and proposes a goal for any that no one covers.
     4. Checks that weights total 100% and match the department's priorities.
   Reads departmental goals from <li data-dept-goal data-id="DG1" data-weight="30">text</li>
   and personal goals from [data-goal] rows holding textarea[name=goal] and input[name=weight].
   Attributes:
     source       CSS selector of the form that holds the personal goals
     dept-goals   CSS selector of the list of departmental goals
     department   department name, sent to the gateway
     period       review period, e.g. "Q4 2026"
   Events (the host page applies every change):
     ai-goal-rewrite  detail: { index, text }            replace goal text
     ai-goal-link     detail: { index, deptGoalIds[] }    record the alignment link on the goal
     ai-goal-add      detail: { text, weight, deptGoalId, takeFrom }  add a goal; takeFrom is the index of
                      the unaligned goal whose weight should shrink to keep the total at 100% (or null)
   Gateway:
     POST /pms/goal-alignment { department, period, deptGoals:[{id,text,weight}], goals:[{index,text,weight}] }
       -> { model, overall, goals:[{index, links:[{id,score}], smart:{S,M,A,R,T}, issues[], rewrite, confidence}],
            coverage:[{id, covered, score}], suggestions:[{deptGoalId, text, weight}], weight:{total, note} } */
(function () {
  const { request, feedback, esc } = window.AIGateway;
  const FEATURE = 'pms.goal-alignment';

  // Prototype-only: concept vocabulary used to match goals to departmental goals.
  // The production model uses embeddings, so it matches meaning rather than keywords.
  const CONCEPTS = {
    digitise: /digiti|ecms|workflow|automat|paperless|process|online|system|scan/i,
    turnaround: /turnaround|response|sla|48|hours|faster|quick|delay|days|speed/i,
    backlog: /backlog|order|fulfil|clear|open task|pending/i,
    people: /aper|appraisal|pms|staff|train|capacity|skill|learn|course/i,
    cost: /stationer|cost|spend|budget|save|procure|expens|waste|paper/i,
    service: /complain|customer|citizen|service|feedback|satisf/i,
  };
  const conceptsOf = t => Object.keys(CONCEPTS).filter(k => CONCEPTS[k].test(t));

  const TIME = /\b(by|before|within|end of|until)\b|\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b|\bq[1-4]\b|\b\d{1,2}\/\d{1,2}\b|\bweek|month|quarter|20\d\d\b/i;
  const NUMBER = /\d|%|percent|half|double/i;
  const VAGUE = /^(improve|work on|help|support|be better|try|do more|increase)\b/i;

  // Rewrite templates per concept. {n} is replaced with a number the employee wrote, if any.
  const TEMPLATES = {
    digitise: 'Move {n} of the department\'s internal processes onto ECMS workflows by 15 December 2026, each with at least 20 tasks completed through the workflow',
    turnaround: 'Reduce the average turnaround on Administration requests to under {n} hours by 31 December 2026, measured on the ECMS Workflow Dashboard',
    backlog: 'Close {n} of the open tasks assigned to Administration in the Order Fulfilment queue by 31 December 2026, tracked weekly in All Tasks',
    people: 'Ensure {n} of officers in my unit complete their APER on PMS by 31 October 2026, with a briefing session held by 3 October',
    cost: 'Cut stationery spend for the unit by {n} against Q3 2026 by 31 December 2026, measured from Assets issuance records',
    service: 'Resolve {n} of citizen complaints routed to Administration within 5 working days in Q4 2026, measured from the Complaints queue',
  };
  const DEFAULT_N = { digitise: '4', turnaround: '48', backlog: '1,500', people: '100%', cost: '15%', service: '90%' };

  function numberFrom(text, concept) {
    const m = text.match(/(\d[\d,]*(?:\.\d+)?\s*%?)/);
    if (!m) return DEFAULT_N[concept];
    const n = m[1].trim();
    if (concept === 'turnaround') return n.replace('%', '');
    return n;
  }

  function mockAlign({ deptGoals, goals }) {
    const dgConcepts = deptGoals.map(d => ({ ...d, concepts: conceptsOf(d.text) }));
    const coverage = Object.fromEntries(deptGoals.map(d => [d.id, 0]));

    const results = goals.filter(g => g.text.trim()).map(g => {
      const gc = conceptsOf(g.text);
      const links = dgConcepts
        .map(d => {
          const shared = d.concepts.filter(c => gc.includes(c)).length;
          return { id: d.id, score: shared ? Math.min(0.96, 0.58 + shared * 0.2 + (g.text.length > 50 ? 0.08 : 0)) : 0 };
        })
        .filter(l => l.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 2);
      links.forEach(l => { coverage[l.id] = Math.max(coverage[l.id], l.score); });

      const smart = {
        S: g.text.trim().split(/\s+/).length >= 7 && !VAGUE.test(g.text.trim()),
        M: NUMBER.test(g.text),
        A: !/\b(all|every|zero|100%)\b.*\b(week|tomorrow|today)\b/i.test(g.text),
        R: links.length > 0,
        T: TIME.test(g.text),
      };
      const issues = [];
      if (!smart.S) issues.push('Too general. Say exactly what will be delivered.');
      if (!smart.M) issues.push('No measure. Add a number, percentage or count.');
      if (!smart.A) issues.push('Target looks unrealistic for the time allowed.');
      if (!smart.R) issues.push('Doesn\'t support any departmental goal. Link it or replace it.');
      if (!smart.T) issues.push('No deadline. Add a date inside the review period.');

      const lead = gc[0] || (links[0] && dgConcepts.find(d => d.id === links[0].id).concepts[0]);
      const needsRewrite = issues.length > 0 && lead;
      return {
        index: g.index,
        text: g.text,
        links,
        smart,
        issues,
        rewrite: needsRewrite ? TEMPLATES[lead].replace('{n}', numberFrom(g.text, lead)) : null,
        rewriteLinks: needsRewrite ? (links.length ? links.map(l => l.id) : dgConcepts.filter(d => d.concepts.includes(lead)).map(d => d.id).slice(0, 1)) : links.map(l => l.id),
        confidence: links[0] ? links[0].score : 0.4,
      };
    });

    const cov = deptGoals.map(d => ({ id: d.id, text: d.text, weight: d.weight, covered: coverage[d.id] > 0, score: coverage[d.id] }));
    const suggestions = cov.filter(c => !c.covered).slice(0, 2).map(c => {
      const concept = dgConcepts.find(d => d.id === c.id).concepts[0] || 'digitise';
      return { deptGoalId: c.id, text: TEMPLATES[concept].replace('{n}', DEFAULT_N[concept]), weight: Math.max(10, Math.round(c.weight / 2 / 5) * 5) };
    });

    // The weight for a new goal comes from the heaviest goal that supports no departmental goal.
    const donor = results.filter(r => !r.links.length)
      .map(r => ({ index: r.index, weight: parseFloat(goals.find(g => g.index === r.index).weight) || 0 }))
      .sort((a, b) => b.weight - a.weight)[0];
    suggestions.forEach((s, i) => { s.takeFrom = i === 0 && donor ? donor.index : null; });

    const total = goals.reduce((s, g) => s + (parseFloat(g.weight) || 0), 0);
    const smartAvg = results.length ? results.reduce((s, r) => s + Object.values(r.smart).filter(Boolean).length / 5, 0) / results.length : 0;
    const covAvg = cov.reduce((s, c) => s + (c.covered ? c.weight : 0), 0) / cov.reduce((s, c) => s + c.weight, 0);
    const overall = Math.round((smartAvg * 0.5 + covAvg * 0.5) * 100);

    const heavyUnlinked = results.filter(r => !r.links.length && (parseFloat(goals.find(g => g.index === r.index).weight) || 0) >= 20);
    let note = total === 100 ? 'Weights total 100%.' : `Weights total ${total}%. They must equal 100%.`;
    if (heavyUnlinked.length) note += ` ${heavyUnlinked.length} goal(s) with 20% or more weight don't support any departmental goal. Consider moving that weight to a linked goal.`;

    return { model: 'cicod-pms-align-v1 (sovereign)', overall, goals: results, coverage: cov, suggestions, weight: { total, note } };
  }

  const LETTERS = [['S', 'Specific'], ['M', 'Measurable'], ['A', 'Achievable'], ['R', 'Relevant'], ['T', 'Time-bound']];
  const ringColour = p => (p >= 75 ? 'var(--ok)' : p >= 50 ? 'var(--warn)' : 'var(--bad)');

  class AIGoalAlignment extends HTMLElement {
    connectedCallback() {
      this.source = document.querySelector(this.getAttribute('source'));
      this.deptList = document.querySelector(this.getAttribute('dept-goals'));
      this.renderIdle();
      if (this.source) {
        let t;
        this.source.addEventListener('input', () => {
          if (!this.result) return; // only re-check automatically after the first check
          clearTimeout(t); t = setTimeout(() => this.check(), 900);
        });
      }
    }

    read() {
      const deptGoals = [...(this.deptList?.querySelectorAll('[data-dept-goal]') || [])].map(li => ({
        id: li.dataset.id, weight: parseFloat(li.dataset.weight) || 0, text: li.querySelector('[data-text]')?.textContent.trim() || li.textContent.trim(),
      }));
      const goals = [...(this.source?.querySelectorAll('[data-goal]') || [])].map((row, i) => ({
        index: Number(row.dataset.index ?? i),
        text: row.querySelector('[name=goal]')?.value || '',
        weight: row.querySelector('[name=weight]')?.value || '0',
      }));
      return { department: this.getAttribute('department') || '', period: this.getAttribute('period') || '', deptGoals, goals };
    }

    shell(inner, actions = '') {
      return `<section class="aiga" aria-live="polite">
        <div class="aiga__head"><span class="aiga__title"><span class="ai-badge">CICOD-AI</span> Goal alignment</span>
          <span class="ai-confidence">${esc(this.getAttribute('period') || '')}</span></div>
        <div class="aiga__body">${inner}</div>
        <div class="aiga__actions">${actions}<span class="aiga__mode">Suggestions only · you decide</span></div>
      </section>`;
    }

    renderIdle() {
      this.innerHTML = this.shell(
        `<p class="aiga__empty">Checks your draft goals against the ${esc(this.getAttribute('department') || 'departmental')} goals. It links each one, scores it on SMART, and suggests fixes and any goals you're missing.</p>`,
        '<button class="g-btn g-btn--ai g-btn--sm" data-check type="button">✦ Check alignment</button>');
      this.querySelector('[data-check]').addEventListener('click', () => this.check());
    }

    async check() {
      const body = this.querySelector('.aiga__body');
      if (body) body.innerHTML = '<div class="ai-skeleton" style="width:70%"></div><div class="ai-skeleton" style="width:90%"></div><div class="ai-skeleton" style="width:55%"></div><div class="ai-skeleton" style="width:80%"></div>';
      const res = await request('/pms/goal-alignment', this.read(), { mock: mockAlign, feature: FEATURE });
      this.result = res;
      this.render(res);
    }

    render(res) {
      const dgName = id => res.coverage.find(c => c.id === id)?.text || id;
      const goalsHtml = res.goals.length ? res.goals.map(g => `
        <div class="aiga__goal" data-g="${g.index}">
          <div class="aiga__goal-top"><span class="aiga__goal-name">Goal ${g.index + 1}: ${esc(g.text.length > 90 ? g.text.slice(0, 90) + '…' : g.text)}</span>
            ${g.links.length ? `<span class="ai-confidence">${Math.round(g.links[0].score * 100)}% aligned</span>` : '<span class="g-chip g-chip--bad">Not aligned</span>'}</div>
          <div class="aiga__links">${g.links.map(l => `<span class="g-chip g-chip--ai" title="${esc(dgName(l.id))}">Supports ${esc(l.id)}</span>`).join('')}</div>
          <div class="aiga__smart" aria-label="SMART check">${LETTERS.map(([k, n]) => `<span class="aiga__letter ${g.smart[k] ? '' : 'aiga__letter--miss'}" title="${n}: ${g.smart[k] ? 'met' : 'missing'}">${k}</span>`).join('')}</div>
          ${g.issues.length ? `<ul class="aiga__issues">${g.issues.map(i => `<li>${esc(i)}</li>`).join('')}</ul>` : '<div class="aiga__done">Meets all five SMART checks.</div>'}
          ${g.rewrite ? `<div class="aiga__rewrite"><b>Suggested rewrite</b><span class="aiga__rewrite-text">${esc(g.rewrite)}</span>
            <div class="aiga__row-actions"><button class="g-btn g-btn--ai g-btn--sm" data-use="${g.index}" type="button">Use rewrite</button><button class="g-btn g-btn--sm" data-keep="${g.index}" type="button">Keep mine</button></div></div>`
          : g.links.length ? `<div class="aiga__row-actions" style="margin-top:6px"><button class="g-btn g-btn--sm" data-link="${g.index}" type="button">Record link to ${esc(g.links.map(l => l.id).join(', '))}</button></div>` : ''}
        </div>`).join('') : '<p class="aiga__empty">Add at least one goal to check.</p>';

      const covHtml = res.coverage.map(c => `
        <div class="aiga__cov-row ${c.covered ? '' : 'aiga__cov-row--gap'}">
          <span class="aiga__cov-id">${esc(c.id)}</span>
          <span class="aiga__cov-name">${esc(c.text)}<div class="aiga__cov-bar"><i style="width:${Math.round((c.covered ? c.score : 0.04) * 100)}%"></i></div></span>
          ${c.covered ? '<span class="g-chip g-chip--ok">Covered</span>' : '<span class="g-chip g-chip--bad">Gap</span>'}
        </div>`).join('');

      const sugHtml = res.suggestions.map((s, i) => `
        <div class="aiga__suggest"><p><b>No goal supports ${esc(s.deptGoalId)}.</b> Suggested goal (${s.weight}% weight):<br>${esc(s.text)}</p>
          <button class="g-btn g-btn--ai g-btn--sm" data-add="${i}" type="button">Add this goal</button></div>`).join('');

      const p = res.overall;
      this.innerHTML = this.shell(`
        <div class="aiga__score">
          <div class="aiga__ring" style="--aiga-p:${p};--aiga-c:${ringColour(p)}"><span>${p}</span></div>
          <p><b>Alignment score ${p}/100.</b> ${res.coverage.filter(c => c.covered).length} of ${res.coverage.length} departmental goals are covered, and ${res.goals.filter(g => !g.issues.length).length} of ${res.goals.length} goals meet all SMART checks.<br><span class="ai-confidence">${esc(res.model)}</span></p>
        </div>
        <h5 class="aiga__h5">Your goals</h5>${goalsHtml}
        <h5 class="aiga__h5">Departmental goal coverage</h5><div class="aiga__cov">${covHtml}</div>
        ${sugHtml}
        <div class="aiga__weight">${esc(res.weight.note)}</div>`,
        '<button class="g-btn g-btn--ai g-btn--sm" data-check type="button">✦ Re-check</button><button class="g-btn g-btn--sm" data-reject type="button">Not helpful</button>');

      this.querySelector('[data-check]').addEventListener('click', () => this.check());
      this.querySelector('[data-reject]').addEventListener('click', () => feedback(res.id, FEATURE, 'rejected'));
      this.querySelectorAll('[data-use]').forEach(b => b.addEventListener('click', () => {
        const g = res.goals.find(x => x.index === Number(b.dataset.use));
        feedback(res.id, FEATURE, 'accepted-rewrite', { index: g.index });
        this.emit('ai-goal-rewrite', { index: g.index, text: g.rewrite });
        this.emit('ai-goal-link', { index: g.index, deptGoalIds: g.rewriteLinks });
        b.closest('.aiga__rewrite').innerHTML = '<span class="aiga__done">Rewrite applied ✓. Re-checking…</span>';
      }));
      this.querySelectorAll('[data-keep]').forEach(b => b.addEventListener('click', () => {
        feedback(res.id, FEATURE, 'kept-original', { index: Number(b.dataset.keep) });
        b.closest('.aiga__rewrite').remove();
      }));
      this.querySelectorAll('[data-link]').forEach(b => b.addEventListener('click', () => {
        const g = res.goals.find(x => x.index === Number(b.dataset.link));
        feedback(res.id, FEATURE, 'accepted-link', { index: g.index });
        this.emit('ai-goal-link', { index: g.index, deptGoalIds: g.links.map(l => l.id) });
        b.outerHTML = '<span class="aiga__done">Link recorded ✓</span>';
      }));
      this.querySelectorAll('[data-add]').forEach(b => b.addEventListener('click', () => {
        const s = res.suggestions[Number(b.dataset.add)];
        feedback(res.id, FEATURE, 'accepted-new-goal', { deptGoalId: s.deptGoalId });
        this.emit('ai-goal-add', s);
        b.closest('.aiga__suggest').innerHTML = `<span class="aiga__done">Goal added for ${esc(s.deptGoalId)} ✓. Re-checking…</span>`;
      }));
    }

    emit(name, detail) { this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true })); }
  }

  customElements.define('ai-goal-alignment', AIGoalAlignment);
})();
