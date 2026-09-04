/* Tiny shared filter-persistence helper: window.pf.get/set — remembers each page's selected filters
 * (dashboard range, troubleshoot window/category/team, growth period, alerts tab, …) in localStorage
 * so a refresh keeps them. Namespaced under cons_flt_ and per-browser. JSON-encoded, fail-safe. */
(function(){
  "use strict";
  var NS = "cons_flt_";
  window.pf = {
    get: function(key, dflt){
      try { var v = localStorage.getItem(NS + key); return v == null ? dflt : JSON.parse(v); }
      catch(e){ return dflt; }
    },
    set: function(key, val){
      try { localStorage.setItem(NS + key, JSON.stringify(val)); } catch(e){}
    },
    del: function(key){ try { localStorage.removeItem(NS + key); } catch(e){} }
  };
})();
