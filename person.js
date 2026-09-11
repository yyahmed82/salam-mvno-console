/* person.js — ONE way to show a console user, on every screen (11 Sep 2026).
 *
 * WHY. Alerts grew a real owner card (avatar, name, e-mail, role · team, live workload). Everywhere else a
 * person was a bare login — "console", "a.pandey.tcs@salammobile.sa". The same human must look the same on
 * every screen, so the markup lives here and every page calls it. Styling reuses the existing .owner /
 * .oav / .oinfo classes, so a chip inherits light and dark automatically.
 *
 *   PERSON.chip(email, opts)     → the full card:  avatar · name · e-mail · role · team [· your extra lines]
 *   PERSON.inline(email)         → one line, for a dense table cell: avatar + name (e-mail in the tooltip)
 *   PERSON.name(email)           → the best display name known for that address
 *   PERSON.merge(map)            → feed in richer data a page already has (alerts owners, budget rows)
 *   PERSON.hydrate()             → fetch /api/people/directory once, so any page can name anyone
 *
 * opts: { o } a person object you already hold · { sub } extra HTML lines under the role line ·
 *        { kpis } array of {label,title} chips · { compact } no e-mail line · { note } right-hand note. */
(function () {
  "use strict";
  var DIR = {}, hydrated = null;
  var esc = function (s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;"); };
  var lc = function (e) { return String(e || "").toLowerCase().trim(); };

  function initials(name, email) {
    var n = (name || "").trim();
    if (n) return n.split(/\s+/).slice(0, 2).map(function (x) { return x[0]; }).join("").toUpperCase();
    var l = (email || "").split("@")[0];
    return l.split(/[._-]/).slice(0, 2).map(function (x) { return x[0] || ""; }).join("").toUpperCase() || "?";
  }
  function prettyName(o, email) {
    if (o && o.name) return o.name;
    var l = (email || "").split("@")[0];
    return l.split(/[._-]/).filter(Boolean).map(function (x) { return x[0].toUpperCase() + x.slice(1); }).join(" ");
  }
  function hue(str) { var h = 0, s = String(str); for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360; return h; }

  /* a machine, not a person — the agent services get a square badge, never a human avatar */
  function isService(e) { return /^salam-agent-|^service:|^console$/.test(String(e || "")); }
  var SERVICE_LABEL = { "salam-agent-incident": ["Incident agent", "diagnoses open incidents"],
    "salam-agent-log": ["Log agent", "reads the error log and reports"],
    "console": ["Console (unattributed)", "calls made before per-person metering, or by the app itself"] };

  function merge(map) { if (!map) return DIR; Object.keys(map).forEach(function (k) { var e = lc(k); DIR[e] = Object.assign({}, DIR[e] || {}, map[k] || {}); }); return DIR; }
  function get(email) { return DIR[lc(email)] || null; }
  function name(email) { return prettyName(get(email), email); }

  function hydrate() {
    if (hydrated) return hydrated;
    var base = (window.API_BASE == null ? "" : window.API_BASE);
    hydrated = fetch(base + "/api/people/directory", { headers: authHeaders() })
      .then(function (r) { return r.ok ? r.json() : { people: {} }; })
      .then(function (d) { merge(d.people || {}); return DIR; })
      .catch(function () { return DIR; });
    return hydrated;
  }
  function authHeaders() {
    var h = { "Content-Type": "application/json" };
    try { var t = localStorage.getItem("cons_token"); if (t) h.Authorization = "Bearer " + t; } catch (_) {}
    return h;
  }

  function kpiChips(list) {
    if (!list || !list.length) return "";
    return '<div class="oload">' + list.filter(Boolean).map(function (k) {
      return '<span class="olb"' + (k.title ? ' title="' + esc(k.title) + '"' : "") + '>' + esc(k.label) + "</span>";
    }).join("") + "</div>";
  }
  /* the standard workload chips, when the page has them (alerts owners, budget people) */
  function workload(o, durMin) {
    if (!o || o.acked_24h == null) return [];
    var d = durMin || function (m) { return m == null ? "—" : m < 60 ? m + " min" : Math.floor(m / 60) + " h " + (m % 60 ? String(m % 60) : "") ; };
    var out = [];
    if (o.open_held != null) out.push({ label: o.open_held + " open", title: "open incidents this person currently holds" });
    out.push({ label: o.acked_24h + " acked · 24h", title: "incidents acknowledged in the last 24 hours" });
    if (o.avg_ack_min_7d != null) out.push({ label: "avg " + d(o.avg_ack_min_7d), title: "average time-to-acknowledge over the last 7 days" + (o.acked_7d ? " (" + o.acked_7d + " incidents)" : "") });
    return out;
  }

  function chip(email, opts) {
    opts = opts || {};
    var e = lc(email), o = opts.o || DIR[e] || {};
    if (isService(e)) {
      var lbl = SERVICE_LABEL[e] || [email, "automated caller"];
      return '<div class="owner"><span class="oav oavsvc" title="' + esc(email) + '">⚙</span>' +
        '<div class="oinfo"><div class="oname">' + esc(lbl[0]) + '</div>' +
        '<div class="rl omail mono">' + esc(email) + "</div>" +
        '<div class="rl">' + esc(lbl[1]) + "</div>" +
        (opts.sub || "") + kpiChips(opts.kpis) + "</div></div>";
    }
    var dom = e.split("@")[1] || "";
    var roleLine = [o.role_label, o.team].filter(Boolean).join(" · ") || (dom ? dom.split(".")[0] : "");
    return '<div class="owner"><span class="oav" style="background:hsl(' + hue(e) + ' 55% 42%)" title="' + esc(e) + '">' + esc(initials(o.name, e)) + "</span>" +
      '<div class="oinfo"><div class="oname" title="' + esc(e) + '">' + esc(prettyName(o, e)) +
      (o.enabled === false ? ' <span class="rl" style="color:#dc2626">(blocked)</span>' : "") + "</div>" +
      (opts.compact ? "" : '<div class="rl omail">' + esc(e) + "</div>") +
      (roleLine ? '<div class="rl">' + esc(roleLine) + "</div>" : "") +
      (opts.sub || "") + kpiChips(opts.kpis) + "</div></div>";
  }

  /* one dense line — avatar + name, everything else in the tooltip */
  function inline(email, opts) {
    opts = opts || {};
    var e = lc(email), o = opts.o || DIR[e] || {};
    if (isService(e)) {
      var lbl = SERVICE_LABEL[e] || [email, "automated caller"];
      return '<span class="pin"><span class="oav xs oavsvc" title="' + esc(email) + '">⚙</span>' + esc(lbl[0]) + "</span>";
    }
    var tip = [prettyName(o, e), e, [o.role_label, o.team].filter(Boolean).join(" · ")].filter(Boolean).join("\n");
    return '<span class="pin" title="' + esc(tip) + '"><span class="oav xs" style="background:hsl(' + hue(e) + ' 55% 42%)">' + esc(initials(o.name, e)) + "</span>" + esc(prettyName(o, e)) + "</span>";
  }

  window.PERSON = { chip: chip, inline: inline, name: name, get: get, merge: merge, hydrate: hydrate,
    initials: initials, prettyName: prettyName, hue: hue, isService: isService, kpiChips: kpiChips, workload: workload, directory: function () { return DIR; } };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function () { setTimeout(hydrate, 300); });
  else setTimeout(hydrate, 300);
})();
