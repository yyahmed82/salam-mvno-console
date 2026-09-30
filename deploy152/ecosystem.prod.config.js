/* PM2 config for the Salam Unified Console on 152 (also usable for the frozen digital-console line).
 * Name/port come from .env: PM2_NAME (default salam-unified), PORT (default 4701 — 4700 is salam-undertaking on 152).
 * Loads /apps/console/.env into the process env (PM2 has no native env_file support),
 * then runs server/src/boot.js (self-seeds DB schema + rules, then serves on PORT).
 * Start:  cd /apps/console && pm2 start ecosystem.prod.config.js && pm2 save
 */
const fs = require('fs');
const path = require('path');

function loadEnv(file) {
  const out = {};
  try {
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const i = t.indexOf('=');
      if (i > 0) {
        let v = t.slice(i + 1).trim();
        // strip surrounding quotes: values containing spaces or < > MUST be quoted in .env or
        // `set -a; . .env` breaks in bash (e.g. SMTP_FROM=Name <a@b> → "syntax error near
        // unexpected token newline", because < is read as input redirection).
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
          v = v.slice(1, -1);
        }
        out[t.slice(0, i)] = v;
      }
    }
  } catch (e) { console.error(`WARN: could not read ${file}: ${e.message}`); }
  return out;
}

const APP_DIR = path.resolve(__dirname);
const env = Object.assign({
  PORT: '4701',
  STATIC_DIR: path.join(APP_DIR, 'web'),
  NODE_ENV: 'production',
  /* MUST be UTC. The app stores created_at as `timestamp WITHOUT time zone` holding UTC, and
   * node-pg parses that type in the PROCESS's local timezone. Server 152 runs Asia/Riyadh, so
   * without this every timestamp read back was shifted 3h earlier — making live data look ~3h
   * stale, "today" windows return nothing, and the dashboard show zeros. Do not remove. */
  TZ: 'UTC'
}, loadEnv(path.join(APP_DIR, '.env')));

/* Memory guard rails (26 Sep 2026 — a day of "Box memory 95–98 %" healthchecks on 152, a box shared with production):
 * OFF unless set in .env, so nothing changes until the real consumers are known (the healthcheck mail now names them).
 *   PM2_MAX_MEM=1800M        → PM2 restarts the console when its RSS passes it (a leak restarts, prod is never OOM-killed for it)
 *   PM2_AGENT_MAX_MEM=1200M  → the same for each agent process
 *   NODE_HEAP_MB=1536 / AGENT_HEAP_MB=1024 → V8 old-space ceiling (--max-old-space-size); GC works harder before a restart */
const guard = (maxKey, heapKey) => Object.assign({},
  env[maxKey] ? { max_memory_restart: env[maxKey] } : {},
  env[heapKey] ? { node_args: '--max-old-space-size=' + String(env[heapKey]).replace(/\D/g, '') } : {});

/* Agent DB footprint (30 Sep 2026 — "Console DB — console connections 28" WARN after the reboot): the agents load db.js
 * too and used to open the console's full pools (source 8 + console 4 + ops 3 each). They run one tick at a time — two
 * connections per pool is plenty. Override with AGENT_SOURCE_POOL_MAX / AGENT_CONSOLE_POOL_MAX in .env. */
const agentEnv = Object.assign({}, env, {
  SOURCE_POOL_MAX: env.AGENT_SOURCE_POOL_MAX || '2', CONSOLE_POOL_MAX: env.AGENT_CONSOLE_POOL_MAX || '2',
  OPS_POOL_MAX: env.AGENT_OPS_POOL_MAX || '1', OPS_BETA_POOL_MAX: '1',
  PG_APP_NAME: (env.PG_APP_NAME || 'salam_unified') + '_agent'
});

module.exports = {
  apps: [{
    name: env.PM2_NAME || 'salam-unified',
    cwd: path.join(APP_DIR, 'server'),
    script: 'src/boot.js',
    env,
    ...guard('PM2_MAX_MEM', 'NODE_HEAP_MB'),
    max_restarts: 10,
    restart_delay: 5000,
    kill_timeout: 8000,
    out_file: path.join(APP_DIR, 'logs/console.out.log'),
    error_file: path.join(APP_DIR, 'logs/console.err.log'),
    merge_logs: true,
    time: true
  },
  /* AI agents (10 Sep 2026) — separate processes, same .env and modules; a crash or a slow model never touches the
   * console. Disable with AGENT_LOG_ENABLED=0 / AGENT_INCIDENT_ENABLED=0 (the process idles instead of exiting). */
  {
    name: (env.PM2_NAME || 'salam-unified').replace(/-unified$|$/, '') + '-agent-log',
    cwd: path.join(APP_DIR, 'server'),
    script: 'src/agentLog.js',
    env: agentEnv,
    ...guard('PM2_AGENT_MAX_MEM', 'AGENT_HEAP_MB'),
    max_restarts: 10,
    restart_delay: 15000,
    kill_timeout: 8000,
    out_file: path.join(APP_DIR, 'logs/agent-log.out.log'),
    error_file: path.join(APP_DIR, 'logs/agent-log.err.log'),
    merge_logs: true,
    time: true
  },
  {
    name: (env.PM2_NAME || 'salam-unified').replace(/-unified$|$/, '') + '-agent-incident',
    cwd: path.join(APP_DIR, 'server'),
    script: 'src/agentIncident.js',
    env: agentEnv,
    ...guard('PM2_AGENT_MAX_MEM', 'AGENT_HEAP_MB'),
    max_restarts: 10,
    restart_delay: 15000,
    kill_timeout: 8000,
    out_file: path.join(APP_DIR, 'logs/agent-incident.out.log'),
    error_file: path.join(APP_DIR, 'logs/agent-incident.err.log'),
    merge_logs: true,
    time: true
  }]
};
