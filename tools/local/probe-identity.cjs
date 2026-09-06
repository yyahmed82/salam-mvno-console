#!/usr/bin/env node
/* IDENTITY PROBE — one National ID, every source the console has, so we can see WHY Yusr / Customer 360
 * disagree with the apps. Read-only, through the tunnel, masked output (last digits only).
 *   node tools/local/probe-identity.cjs 2392697450 [--raw]
 * Prints: (1) MVNO replica: onboarding attempts, app account line(s), activation rows
 *         (2) nexus: workflows linked to the NID + the DISTINCT BSS endpoints those journeys called
 *         (3) the latest response of every subscription/account/customer-shaped endpoint (the fixed inventory shape)
 *         (4) sda_ops read model rows for those workflows */
const fs = require('fs'), path = require('path');
const root = path.resolve(__dirname, '..', '..');
const env = {};
for (const l of fs.readFileSync(path.join(root, '.env.local'), 'utf8').split('\n')) {
  const m = /^([A-Z_]+)=(.*)$/.exec(l.trim()); if (!m) continue;
  let v = m[2]; if ((v.startsWith("'") && v.endsWith("'")) || (v.startsWith('"') && v.endsWith('"'))) v = v.slice(1, -1);
  env[m[1]] = v;
}
const args = process.argv.slice(2); const RAW = args.includes('--raw'); const INV = args.includes('--inv'); const nid = args.find(a => /^\d{10}$/.test(a));
if (!nid) { console.error('usage: node tools/local/probe-identity.cjs <national id> [--raw]'); process.exit(2); }
const { Client } = require(path.join(root, 'server', 'node_modules', 'pg'));
const tail = (v, n) => v == null ? null : (RAW ? String(v) : '…' + String(v).slice(-n));
const mask = s => RAW ? s : String(s).replace(/\b(\d{4,})\b/g, (m) => m.length > 6 ? '…' + m.slice(-4) : m);
async function open(k) {
  let url = env[k]; if (!url) return null;
  let schema = null; try { const u = new URL(url); schema = u.searchParams.get('schema'); for (const x of ['schema', 'connection_limit', 'pool_timeout']) u.searchParams.delete(x); url = u.toString(); } catch (_) {}
  const c = new Client({ connectionString: url, application_name: 'salam_unified_probe', statement_timeout: 60000 });
  await c.connect(); if (schema) await c.query(`SET search_path TO ${schema.replace(/[^a-zA-Z0-9_]/g, '')}, public`);
  await c.query('BEGIN READ ONLY'); return c;
}
const H = t => console.log('\n=== ' + t + ' ===');
const safe = async (fn) => { try { await fn(); } catch (e) { console.log('  ERROR:', e.message); } };
(async () => {
  // 1. MVNO replica
  const src = INV ? null : await open('SOURCE_DATABASE_URL');
  if (src) {
    H('MVNO replica · onboarding_orders (journey ATTEMPTS, not subscriptions)');
    const o = await src.query(`SELECT id::text, created_at, mobile_number, mnp_number, plan_id, aasm_state AS state, status, activated FROM onboarding_orders WHERE nationality_id_number=$1 ORDER BY created_at DESC`, [nid]).catch(e => ({ rows: [], err: e.message })); if (o.err) console.log('  ERROR:', o.err);
    console.table(o.rows.map(r => ({ created: String(r.created_at).slice(0, 10), contact: tail(r.mobile_number, 4), mnp: tail(r.mnp_number, 4), plan: r.plan_id, state: r.state, status: r.status, activated: r.activated })));
    H('MVNO replica · users (app account — registering REQUIRES an active Salam line)');
    const u = await src.query(`SELECT mobile_number, current_sign_in_at, created_at FROM users WHERE nationality_id_number=$1 ORDER BY current_sign_in_at DESC NULLS LAST`, [nid]).catch(e => ({ rows: [], err: e.message })); if (u.err) console.log('  ERROR:', u.err);
    console.table(u.rows.map(r => ({ service_line: tail(r.mobile_number, 4), last_sign_in: r.current_sign_in_at, since: String(r.created_at).slice(0, 10) })));
    H('MVNO replica · activation_logs msisdns for those orders');
    const a = await src.query(`SELECT DISTINCT msisdn, max(created_at) last FROM activation_logs WHERE onboarding_order_id = ANY($1::uuid[]) AND msisdn IS NOT NULL AND msisdn<>'' GROUP BY msisdn`, [o.rows.map(r => r.id)]).catch(e => ({ rows: [], err: e.message }));
    console.table(a.rows.map(r => ({ msisdn: tail(r.msisdn, 4), last: r.last }))); if (a.err) console.log('  (', a.err, ')');
    await src.query('ROLLBACK'); await src.end();
  }
  // 2/3. nexus
  const nx = await open('NEXUS_DATABASE_URL');
  let wf = [];
  if (nx) {
    H('nexus · workflow_states whose context carries this NID (24 months)');
    const pat = '"(?:certNbr|nationalId|idNumber|nid|nationalID|identificationNumber|customerId)"\\s*:\\s*"' + nid + '"';
    const w = await nx.query(`SELECT id::text AS id, updated_at, (to_jsonb(w) - 'context' - 'id') AS meta FROM workflow_states w WHERE updated_at > now() - interval '24 months' AND context::text ~ $1 ORDER BY updated_at DESC LIMIT 60`, [pat]).catch(e => ({ rows: [], err: e.message })); if (w.err) console.log('  ERROR:', w.err);
    wf = w.rows; if (!INV) console.table(wf.map(r => { const m = r.meta || {}; const o = { id: r.id.slice(0, 8) }; for (const k of Object.keys(m)) if (!/context|payload|response/i.test(k) && typeof m[k] !== 'object') o[k] = String(m[k]).slice(0, 28); return o; }));
    if (wf.length) {
      if (!INV) H('nexus · DISTINCT endpoints those journeys called (what the app asks BSS)');
      const ep = await nx.query(`SELECT endpoint, method, count(*)::int n, max(created_at) last FROM api_logs WHERE workflow_state_id = ANY($1::text[]) GROUP BY 1,2 ORDER BY 1`, [wf.map(r => r.id)]).catch(e => ({ rows: [], err: e.message }));
      if (!INV) console.table(ep.rows.map(r => ({ endpoint: r.endpoint, method: r.method, calls: r.n, last: String(r.last).slice(0, 16) }))); if (ep.err) console.log('  (', ep.err, ')');
      H('nexus · latest payload/response of subscription / account / customer / service shaped endpoints (THE fixed inventory shape)');
      const inv = await nx.query(`SELECT DISTINCT ON (endpoint) endpoint, method, status, created_at, payload::text p, response::text r FROM api_logs WHERE workflow_state_id = ANY($1::text[]) AND endpoint ~* '(qrysubslist|salamqueryacct|salamchecknid|qryacctowefee|qryacct|subscri|account|customer|list-subscriptions)' ORDER BY endpoint, created_at DESC`, [wf.map(r => r.id)]).catch(e => ({ rows: [], err: e.message }));
      for (const r of inv.rows) {
        console.log(`\n--- ${r.method || ''} ${r.endpoint}  status=${r.status}  at=${String(r.created_at).slice(0, 19)}`);
        console.log('  payload : ' + mask(String(r.p || '').slice(0, 600)));
        console.log('  response: ' + mask(String(r.r || '').slice(0, RAW ? 6000 : 3500)));
      }
      if (inv.err) console.log('  (', inv.err, ')');
      // service numbers seen anywhere in the contexts
      const ctx = await nx.query(`SELECT context::text c FROM workflow_states WHERE id = ANY($1::text[])`, [wf.map(r => r.id)]).catch(() => ({ rows: [] }));
      const keys = {};
      for (const row of ctx.rows) for (const m of String(row.c).matchAll(/"(serviceNo|serviceNumber|accountNo|accountNumber|accountId|custCode|customerCode|customerId|subscriberId|acctNbr|servNbr|orderNbr|orderNumber)"\s*:\s*"?([A-Za-z0-9_-]{4,})"?/g)) (keys[m[1]] = keys[m[1]] || new Set()).add(m[2]);
      H('nexus · identifier keys found in those contexts (name → distinct values, masked)');
      for (const [k, v] of Object.entries(keys)) console.log('  ' + k.padEnd(16) + [...v].slice(0, 8).map(x => tail(x, 4)).join(', ') + (v.size > 8 ? ` … (${v.size})` : ''));
    }
    await nx.query('ROLLBACK'); await nx.end();
  }
  // 4. sda_ops read model
  const ops = INV ? null : await open('OPS_DATABASE_URL');
  if (ops && wf.length) {
    H('sda_ops.public · order_attempts for those workflows');
    const r = await ops.query(`SELECT id, workflow, channel, outcome, step_reached, plan, service_no, cust_code, customer_id, order_number, started_at FROM order_attempts WHERE id = ANY($1::text[]) ORDER BY started_at DESC`, [wf.map(x => x.id)]).catch(e => ({ rows: [], err: e.message })); if (r.err) console.log('  ERROR:', r.err);
    console.table(r.rows.map(x => ({ id: x.id.slice(0, 8), workflow: x.workflow, channel: x.channel, outcome: x.outcome, step: x.step_reached, plan: x.plan, service_no: tail(x.service_no, 6), cust_code: tail(x.cust_code, 4), customer_id: tail(x.customer_id, 4), order: tail(x.order_number, 6), started: String(x.started_at).slice(0, 10) })));
    await ops.query('ROLLBACK'); await ops.end();
  }
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
