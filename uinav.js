/* Shared navigation config — tab order + visibility for the Analytics dashboards
 * nav and the Troubleshoot error tiles. Fetched once from /api/ui-nav, shared via
 * window.UI_NAV; both boards re-render on the 'uinavchange' event. Super-admins edit
 * it in Settings → Navigation; everyone else just reads the shared layout. */
(function(){
  "use strict";
  const API=(location.protocol==="file:")?"http://localhost:4600":"";
  window.UI_NAV = window.UI_NAV || {};
  let p=null;
  window.loadUiNav=function(force){
    if(p && !force) return p;
    p = fetch(API+"/api/ui-nav",{headers:{"Content-Type":"application/json"}})
      .then(r=>r.ok?r.json():{})
      .then(cfg=>{ window.UI_NAV = cfg||{}; document.dispatchEvent(new CustomEvent("uinavchange")); return window.UI_NAV; })
      .catch(()=>{ document.dispatchEvent(new CustomEvent("uinavchange")); return window.UI_NAV; });
    return p;
  };
  // helper for the settings editor: normalised accessor
  window.uiNav=function(){ const n=window.UI_NAV||{}; return {
    analytics:{ catOrder:(n.analytics&&n.analytics.catOrder)||[], catHidden:(n.analytics&&n.analytics.catHidden)||[], dashHidden:(n.analytics&&n.analytics.dashHidden)||[], dashOrder:(n.analytics&&n.analytics.dashOrder)||{} },
    errors:{ order:(n.errors&&n.errors.order)||[], hidden:(n.errors&&n.errors.hidden)||[] }
  };};
  window.loadUiNav();  // kick off immediately
})();
