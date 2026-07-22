/* Local mock of the Semati (TCC) endpoint — for TESTING the synthetic canary safely.
 *
 * Never point the canary at the real https://semati.tcc-ict.com for testing: that sends real
 * traffic to TCC prod and a bad auth/body would trigger a FALSE page. Point it here instead.
 *
 * Run on the host:   node tools/semati-mock.js         (defaults to port 8799)
 *                    PORT=8799 node tools/semati-mock.js
 *
 * Health endpoints (what the canary probes) — any method:
 *   /login, /verify, or any other non-control path
 *     UP   → HTTP 200 {"status":"COMPLETED","responseCode":"200","responseMessage":"ok"}
 *     DOWN → HTTP 200 {"status":"failed","responseCode":"715","responseMessage":"Service is not available"}
 *            (matches real Semati: 200 envelope with 715 inside — the canary classifies by body)
 *
 * Control (flip state from another terminal):
 *   curl http://localhost:8799/_mock/down     → simulate the outage (INC0012977 signature)
 *   curl http://localhost:8799/_mock/up       → recover
 *   curl http://localhost:8799/_mock/flap     → intermittent: ~50% of probes fail (tests flapping/streak)
 *   curl http://localhost:8799/_mock/status   → current state
 */
'use strict';
const http = require('http');
const PORT = Number(process.env.PORT || 8799);

let mode = 'up';   // 'up' | 'down' | 'flap'

function bodyFor(down) {
  return down
    ? JSON.stringify({ status: 'failed', responseCode: '715', responseMessage: 'Service is not available' })
    : JSON.stringify({ status: 'COMPLETED', responseCode: '200', responseMessage: 'ok' });
}

const server = http.createServer((req, res) => {
  const url = (req.url || '/').split('?')[0];
  const ts = new Date().toISOString();

  if (url.startsWith('/_mock/')) {
    const cmd = url.slice('/_mock/'.length);
    if (cmd === 'up' || cmd === 'down' || cmd === 'flap') { mode = cmd; console.log(`[MOCK] ${ts} state → ${mode}`); }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ mode }));
  }

  // drain the request body (the canary may POST something) then respond
  req.on('data', () => {});
  req.on('end', () => {
    const down = mode === 'down' || (mode === 'flap' && Math.random() < 0.5);
    console.log(`[MOCK] ${ts} ${req.method} ${url} → ${down ? '715 SERVICE NOT AVAILABLE' : '200 ok'} (mode=${mode})`);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(bodyFor(down));
  });
});

server.listen(PORT, () => {
  console.log(`[MOCK] Semati mock listening on http://0.0.0.0:${PORT}  (state: ${mode})`);
  console.log(`[MOCK] flip with:  curl http://localhost:${PORT}/_mock/down   |   /_mock/up   |   /_mock/flap`);
});
