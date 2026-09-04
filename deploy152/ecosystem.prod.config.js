/* PM2 config for the Salam Digital Console on 152.
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
  PORT: '4600',
  STATIC_DIR: path.join(APP_DIR, 'web'),
  NODE_ENV: 'production',
  /* MUST be UTC. The app stores created_at as `timestamp WITHOUT time zone` holding UTC, and
   * node-pg parses that type in the PROCESS's local timezone. Server 152 runs Asia/Riyadh, so
   * without this every timestamp read back was shifted 3h earlier — making live data look ~3h
   * stale, "today" windows return nothing, and the dashboard show zeros. Do not remove. */
  TZ: 'UTC'
}, loadEnv(path.join(APP_DIR, '.env')));

module.exports = {
  apps: [{
    name: 'salam-console',
    cwd: path.join(APP_DIR, 'server'),
    script: 'src/boot.js',
    env,
    max_restarts: 10,
    restart_delay: 5000,
    kill_timeout: 8000,
    out_file: path.join(APP_DIR, 'logs/console.out.log'),
    error_file: path.join(APP_DIR, 'logs/console.err.log'),
    merge_logs: true,
    time: true
  }]
};
