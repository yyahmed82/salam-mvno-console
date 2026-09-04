/* BACKFILL api_failure_samples from the ROTATED api_logger file on the API hosts.
 *
 *   cd /apps/console/server && set -a; . ../.env; set +a
 *   node src/apiSampleBackfill.js                 # dry run: counts only, writes nothing
 *   node src/apiSampleBackfill.js --write          # insert what it found
 *   node src/apiSampleBackfill.js --write --file /www/.../api_logger.production.log
 *
 * WHY THIS EXISTS
 * The samples panel shows failing request/response bodies from api_failure_samples, which the
 * collector fills GOING FORWARD. Rotation on 17/18 is brutal — one generation, ~2 rotations a
 * day (observed 26 Aug: live 1.7G since 12:01, .1 2.5G rotated at 12:01) — so anything older
 * than the current file is minutes from being lost forever. This recovers the ONE rotated
 * generation that still exists, which in practice means "this morning's incident".
 *
 * WHAT IT CAN AND CANNOT RECOVER — stated plainly:
 *   • CAN: calls whose line carries "http_status": 4xx/5xx — this is the whole 1500/OSB family,
 *     timeouts and 5xx, i.e. every technical failure worth a sample.
 *   • CANNOT: business failures returned with HTTP 200 and an error responseCode. Grep cannot
 *     express "code not in the success set" without reading every line (2.5 GB per host), and
 *     transferring that is not worth it. Those are captured going forward by the collector,
 *     which parses every line anyway.
 *
 * PROD SAFETY: grep runs ON the API host (only matching lines cross the wire), one host at a
 * time, hard cap on transferred bytes, inserts in small batches. Rows NEWER than the oldest
 * stored sample are skipped, so re-running can never duplicate what the collector already has.
 */
'use strict';

const { execFile } = require('child_process');
const db = require('./db');
const col = require('./apiLogCollector');

const arg = (f, d) => { const i = process.argv.indexOf(f); return i >= 0 ? process.argv[i + 1] : d; };
const WRITE = process.argv.includes('--write');
const MAXMB = Math.max(1, Number(arg('--max-mb', 400)));
const CFGV = col.CFG();
const FILE = arg('--file', CFGV.path + '.1');           // the rotated generation by default
const shq = s => `'` + String(s).replace(/'/g, `'\\''`) + `'`;

function ssh(host, cmd, maxBuffer) {
  const a = ['-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=no', '-o', 'ConnectTimeout=10'];
  if (CFGV.key) a.push('-i', CFGV.key);
  a.push(`${CFGV.user}@${host}`, cmd);
  return new Promise((res, rej) => execFile('ssh', a, { maxBuffer, encoding: 'utf8' },
    (e, out) => e ? rej(e) : res(out)));
}

(async () => {
  if (!CFGV.hosts.length) { console.error('API_LOG_HOSTS not set'); process.exit(1); }
  console.log(`Backfill api_failure_samples from ${FILE}`);
  console.log(`hosts: ${CFGV.hosts.join(', ')} · ${WRITE ? 'WRITE' : 'DRY RUN (add --write to insert)'} · cap ${MAXMB}MB/host\n`);

  // never insert into the range the collector already covers
  let floor = null;
  try {
    const r = await db.console.query(`SELECT min(ts) lo, count(*)::int n FROM api_failure_samples`);
    floor = r.rows[0].lo;
    console.log(`existing samples: ${r.rows[0].n} · oldest ${floor ? new Date(floor).toISOString() : '(none)'}\n`);
  } catch (e) { console.log('api_failure_samples not created yet — it will be created on write\n'); }

  let grand = 0;
  for (const host of CFGV.hosts) {
    process.stdout.write(`  ${host}: grepping… `);
    let out = '';
    try {
      out = await ssh(host,
        `grep -E '"http_status": *[45][0-9][0-9]' ${shq(FILE)} | tail -c ${MAXMB * 1024 * 1024}`,
        (MAXMB + 32) * 1024 * 1024);
    } catch (e) {
      console.log(`ERROR ${String(e.message || e).slice(0, 120)}`);
      continue;
    }
    const lines = out.split('\n').filter(s => s.trim());
    console.log(`${lines.length} candidate line(s)`);

    const rows = [];
    for (const line of lines) {
      const ev = col.parseLine(line.trim(), CFGV);       // same parser as the live collector
      if (!ev || !ev._sample) continue;
      if (floor && new Date(ev.ts) >= new Date(floor)) continue;   // collector already has it
      rows.push(ev);
    }
    console.log(`    parsed & in range: ${rows.length}`);
    grand += rows.length;
    if (!WRITE || !rows.length) continue;

    for (let i = 0; i < rows.length; i += 50) {
      const chunk = rows.slice(i, i + 50);
      const params = [];
      const values = chunk.map(ev => { const s = ev._sample;
        for (const v of [ev.ts, host, ev.path, ev.transaction_id, s.trace_id, ev.response_code,
          s.http_status, ev.response_message, ev.duration_ms, s.platform, s.app_version,
          s.request_body, s.response_body]) params.push(v);
        const n = params.length;
        return `(${Array.from({ length: 13 }, (_, j) => '$' + (n - 12 + j)).join(',')})`;
      }).join(',');
      await db.console.query(
        `INSERT INTO api_failure_samples (ts, host, path, transaction_id, trace_id, response_code,
           http_status, response_message, duration_ms, platform, app_version, request_body, response_body)
         VALUES ${values}`, params);
      process.stdout.write(`\r    inserted ${Math.min(i + 50, rows.length)}/${rows.length}   `);
    }
    console.log('');
  }

  console.log(`\n${WRITE ? 'inserted' : 'would insert'}: ${grand} failure sample(s)`);
  if (!WRITE) console.log('re-run with --write to persist.');
  console.log('note: business failures returned with HTTP 200 are NOT in this backfill (see header).');
  process.exit(0);
})().catch(e => { console.error('BACKFILL FAILED:', e.message); process.exit(1); });
