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

  /* Embedded atlases (Fixed › Diagrams, MVNO › BSS Topology Atlas) carry their own palette and listen
   * for {theme} over postMessage, so flipping the console reskins them without reloading the iframe
   * and losing the pan/zoom position (11 Sep 2026). */
  function paintFrames(t){
    document.querySelectorAll('iframe').forEach(f => { try { f.contentWindow.postMessage({ theme: t }, '*'); } catch (e) {} });
  }
  document.addEventListener('themechange', e => paintFrames((e.detail && e.detail.theme) || current()));
  document.addEventListener('DOMContentLoaded', () => setTimeout(() => paintFrames(current()), 400));

  // sync the button label to the theme the head-script already applied (no dispatch/flash)
  apply(current(), false);
  const btn = document.getElementById('themeToggle');
  if (btn) btn.addEventListener('click', () => apply(root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark', true));
})();
