/* base.js — ONE source of truth for the console's URL prefix. Loaded before every other script.
 *
 * The console is served under a path prefix by nginx (/digital-console/, /unified-console/, …) or at
 * the root when run locally (http://localhost:4700/). Every script used to hard-code "/digital-console";
 * that broke the moment a second deployment (unified-console) appeared. Now:
 *
 *   window.CONSOLE_BASE  → "/unified-console" | "/digital-console" | ""   (the first path segment that
 *                          ends in "-console"; anything else → "" = root)
 *   window.API_BASE      → same as CONSOLE_BASE, except "http://localhost:4700" when index.html is
 *                          opened from disk (file://) so the API can still be reached.
 *
 * Nothing else in the frontend may mention a deployment name. Server-side, the equivalent is the
 * CONSOLE_PUBLIC_URL env (used in e-mails). */
(function(){
  "use strict";
  var seg = (location.pathname || "/").split("/")[1] || "";
  var base = /-console$/.test(seg) ? "/" + seg : "";
  var localPort = (window.CONSOLE_LOCAL_PORT || 4700);
  window.CONSOLE_BASE = base;
  window.API_BASE = (location.protocol === "file:") ? "http://localhost:" + localPort : base;
  window.CONSOLE_NAME = seg || "console";
})();
