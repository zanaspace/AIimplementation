/* Explainer-page behaviour: the "Show CICOD-AI placement" toggle, the theme toggle,
   and a small audit console that shows the gateway calls a component makes. */
(function () {
  const root = document.documentElement;

  document.querySelectorAll('[data-toggle-spots]').forEach(cb => {
    const target = document.querySelector(cb.dataset.toggleSpots) || document.body;
    const apply = () => target.classList.toggle('show-spots', cb.checked);
    cb.addEventListener('change', apply); apply();
  });

  document.querySelectorAll('[data-toggle-theme]').forEach(btn => {
    btn.addEventListener('click', () => {
      const dark = root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
      root.dataset.theme = dark ? 'light' : 'dark';
      try { localStorage.setItem('cicod-ai-theme', root.dataset.theme); } catch (e) {}
    });
  });
  try { const t = localStorage.getItem('cicod-ai-theme'); if (t) root.dataset.theme = t; } catch (e) {}

  const log = document.querySelector('[data-audit-log]');
  if (log) {
    window.addEventListener('ai:audit', e => {
      const d = e.detail;
      const line = document.createElement('div');
      line.textContent = `${d.at.slice(11, 19)}  ${d.phase.padEnd(8)} ${d.feature}${d.action ? '  → ' + d.action : ''}`;
      log.prepend(line);
      while (log.children.length > 8) log.lastChild.remove();
    });
  }
})();
