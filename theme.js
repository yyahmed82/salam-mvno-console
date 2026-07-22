/* Light / dark theme: persisted, auto-by-time default, header toggle.
 * Dispatches a 'themechange' event so SVG-bearing views re-render. */
(function(){
  "use strict";
  const KEY = 'cons_theme';
  const root = document.documentElement;
  const autoTheme = () => { const h = new Date().getHours(); return (h >= 19 || h < 6) ? 'dark' : 'light'; };
  const current = () => root.getAttribute('data-theme') || localStorage.getItem(KEY) || autoTheme();

  function apply(t, dispatch){
    root.setAttribute('data-theme', t);
    localStorage.setItem(KEY, t);
    const btn = document.getElementById('themeToggle');
    if (btn){ btn.textContent = t === 'dark' ? '☀' : '☾'; btn.title = t === 'dark' ? 'Switch to light' : 'Switch to dark'; }
    if (dispatch !== false) document.dispatchEvent(new CustomEvent('themechange', { detail: { theme: t } }));
  }

  // sync the button label to the theme the head-script already applied (no dispatch/flash)
  apply(current(), false);
  const btn = document.getElementById('themeToggle');
  if (btn) btn.addEventListener('click', () => apply(root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark', true));
})();
