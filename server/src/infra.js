/* infra.js — INFRASTRUCTURE (30 Sep 2026, alpha.120 — CIO requirement, plan: claude/INFRASTRUCTURE-SECTION-PLAN.md).
 *
 * Every server / node of the two HLDs (mvno-rodod-hld.html · fixed-diagrams/salam-fixed-digital-bss-hld.html) with its
 * physical inventory, a per-host health report in the healthcheck-mail shape, infra alerts separated Mobile / Fixed,
 * and the live map: the HLD cards painted with status, cpu / mem / disk and NIC throughput, the edges with the traffic
 * observed between the hosts behind them.
 *
 * NO NEW AGENT. Sources, each optional and env-gated, all READ-ONLY:
 *   local    the console box itself (/proc, df, ss) — always on
 *   ssh      hosts we can already log into (INFRA_SSH_USER / INFRA_SSH_KEY, falling back to API_LOG_USER / API_LOG_KEY —
 *            the key apiErrLogCollector uses) — inventory once a day, /proc metrics + `ss -tin` peers every tick
 *   ports    a TCP connect to every service port of every host (3 s) — reachability with no access at all
 *   node_exporter  http://host:9100/metrics when it answers (Fixed monitoring box today)
 *   instana  INSTANA_URL + INSTANA_TOKEN → host snapshots (inventory) and metrics for every host the agents see
 * The hosts and the map bindings are SEEDED FROM THE HLD FILES THEMSELVES (node ids, labels and the IPs printed on
 * the cards) so the diagram stays the single source of truth; a person can then edit segment, role, ports, ssh flag.
 *
 * Tables (unified_console): infra_hosts · infra_host_changes · infra_host_metrics · infra_flows · infra_map_nodes ·
 * infra_probes · infra_runs. Retention: metrics 30 d, flows 7 d, probes 30 d.
 * Env: INFRA_ENABLED (1) · INFRA_INTERVAL_SEC (60) · INFRA_INVENTORY_HOURS (24) · INFRA_SSH_USER/KEY/PORT · INFRA_SSH_HOSTS
 *      (comma list of IPs allowed for ssh; empty = every host flagged ssh in the table) · INFRA_PORT_TIMEOUT_MS (3000) ·
 *      INSTANA_URL · INSTANA_TOKEN · INFRA_HEALTH_EMAILS (per-segment digest on change) · thresholds INFRA_DISK_WARN/CRIT
 *      (80/90) INFRA_MEM_WARN/CRIT (85/95) INFRA_LOAD_WARN/CRIT (per core 1.5/2.5) INFRA_SWAP_WARN (50). */
'use strict';
const fs = require('fs'); const path = require('path'); const os = require('os'); const net = require('net'); const vm = require('vm');
const { execFile } = require('child_process');
const db = require('./db');
const C = () => db.console;
const log = (...a) => console.log(new Date().toISOString(), '[infra]', ...a);
const N = (v, d) => { const x = Number(v); return Number.isFinite(x) ? x : d; };
const CFG = () => ({
  enabled: process.env.INFRA_ENABLED !== '0',
  intervalSec: Math.max(30, N(process.env.INFRA_INTERVAL_SEC, 60)),
  inventoryHours: Math.max(1, N(process.env.INFRA_INVENTORY_HOURS, 24)),
  sshUser: process.env.INFRA_SSH_USER || process.env.API_LOG_USER || '',
  sshKey: process.env.INFRA_SSH_KEY || process.env.API_LOG_KEY || '',
  sshPort: N(process.env.INFRA_SSH_PORT, 22),
  sshHosts: String(process.env.INFRA_SSH_HOSTS || '').split(',').map(s => s.trim()).filter(Boolean),
  portTimeout: N(process.env.INFRA_PORT_TIMEOUT_MS, 3000),
  instanaUrl: String(process.env.INSTANA_URL || '').replace(/\/+$/, ''),
  instanaToken: process.env.INSTANA_TOKEN || '',
  mails: String(process.env.INFRA_HEALTH_EMAILS || '').split(/[,\s;]+/).filter(x => /@/.test(x)),
  th: { diskWarn: N(process.env.INFRA_DISK_WARN, 80), diskCrit: N(process.env.INFRA_DISK_CRIT, 90), memWarn: N(process.env.INFRA_MEM_WARN, 85), memCrit: N(process.env.INFRA_MEM_CRIT, 95),
        loadWarn: N(process.env.INFRA_LOAD_WARN, 1.5), loadCrit: N(process.env.INFRA_LOAD_CRIT, 2.5), swapWarn: N(process.env.INFRA_SWAP_WARN, 50), certWarn: 21, certCrit: 7 }
});

/* ------------------------------------------------------------------------------------------------------ schema */
async function ensureSchema() {
  const q = C(); if (!q) return;
  await q.query(`CREATE TABLE IF NOT EXISTS infra_hosts (
      id serial PRIMARY KEY, hostname text, ip text UNIQUE NOT NULL, ips text[] NOT NULL DEFAULT '{}', segment text NOT NULL DEFAULT 'shared',
      role text, label text, diagram text, node_id text, env text NOT NULL DEFAULT 'prod', owner_team text, notes text,
      ssh boolean NOT NULL DEFAULT false, node_exporter boolean NOT NULL DEFAULT false, instana_id text, service_ports int[] NOT NULL DEFAULT '{}',
      enabled boolean NOT NULL DEFAULT true, source text NOT NULL DEFAULT 'hld',
      inventory jsonb NOT NULL DEFAULT '{}', inventory_hash text, inventory_at timestamptz, last_seen timestamptz, last_metrics jsonb NOT NULL DEFAULT '{}',
      status text NOT NULL DEFAULT 'unknown', status_at timestamptz, reachable boolean, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now())`);
  await q.query(`ALTER TABLE infra_hosts ADD COLUMN IF NOT EXISTS ssh_via text`);      // jump host (passerelle) "user@ip" or "ip" — ProxyJump
  await q.query(`ALTER TABLE infra_hosts ADD COLUMN IF NOT EXISTS ssh_user text`);     // per-host user when it differs from INFRA_SSH_USER
  await q.query(`ALTER TABLE infra_hosts ADD COLUMN IF NOT EXISTS ports_learned boolean NOT NULL DEFAULT false`);
  await q.query(`CREATE TABLE IF NOT EXISTS infra_host_changes (id bigserial PRIMARY KEY, host_id int NOT NULL, at timestamptz NOT NULL DEFAULT now(), kind text NOT NULL, field text, before jsonb, after jsonb, note text)`);
  await q.query(`CREATE INDEX IF NOT EXISTS infra_host_changes_at ON infra_host_changes (at DESC)`);
  await q.query(`CREATE TABLE IF NOT EXISTS infra_host_metrics (host_id int NOT NULL, at timestamptz NOT NULL, cpu_pct real, load1 real, load5 real, load15 real, mem_pct real, swap_pct real,
      disk_pct real, disks jsonb, rx_bps real, tx_bps real, conns int, source text, PRIMARY KEY (host_id, at))`);
  await q.query(`CREATE INDEX IF NOT EXISTS infra_host_metrics_at ON infra_host_metrics (at DESC)`);
  await q.query(`CREATE TABLE IF NOT EXISTS infra_flows (id bigserial PRIMARY KEY, at timestamptz NOT NULL DEFAULT now(), src_host_id int, dst_host_id int, src_ip text, dst_ip text, dst_port int,
      conns int NOT NULL DEFAULT 0, bytes_per_s real, source text)`);
  await q.query(`CREATE INDEX IF NOT EXISTS infra_flows_at ON infra_flows (at DESC)`);
  await q.query(`CREATE TABLE IF NOT EXISTS infra_map_nodes (diagram text NOT NULL, node_id text NOT NULL, label text, layer text, host_ips text[] NOT NULL DEFAULT '{}', service_ports int[] NOT NULL DEFAULT '{}', external boolean NOT NULL DEFAULT false,
      updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (diagram, node_id))`);
  await q.query(`CREATE TABLE IF NOT EXISTS infra_probes (id bigserial PRIMARY KEY, host_id int NOT NULL, at timestamptz NOT NULL DEFAULT now(), probe text NOT NULL, level text NOT NULL, value text, threshold text, note text)`);
  await q.query(`CREATE INDEX IF NOT EXISTS infra_probes_host_at ON infra_probes (host_id, at DESC)`);
  await q.query(`CREATE TABLE IF NOT EXISTS infra_runs (id bigserial PRIMARY KEY, at timestamptz NOT NULL DEFAULT now(), ms int, hosts int, reachable int, by_source jsonb, errors jsonb, kind text)`);
}

/* ------------------------------------------------------------------------------------------------------ seed from the HLDs */
/* the HLD files live in STATIC_DIR (= /apps/unified/web on 152, the repo root locally) — never assume ../../ */
const STATIC_DIRS = [process.env.STATIC_DIR, path.join(__dirname, '..', '..', 'web'), path.join(__dirname, '..', '..')].filter(Boolean);
const findStatic = rel => { for (const d of STATIC_DIRS) { const f = path.join(d, rel); if (fs.existsSync(f)) return f; } return path.join(STATIC_DIRS[STATIC_DIRS.length - 1], rel); };
const DIAGRAMS = [
  { key: 'mvno', segment: 'mobile', get file() { return findStatic('mvno-rodod-hld.html'); }, title: 'MVNO · DMS + RODOD' },
  { key: 'fixed', segment: 'fixed', get file() { return findStatic(path.join('fixed-diagrams', 'salam-fixed-digital-bss-hld.html')); }, title: 'Fixed · Digital + BSS' }
];
const IPV4 = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
function readNodes(file) {
  let html; try { html = fs.readFileSync(file, 'utf8'); } catch (e) { log('HLD file not found:', file, '— set STATIC_DIR'); return { nodes: [], edges: [] }; }
  const grab = name => { const m = new RegExp(`const ${name}=(\\[[\\s\\S]*?\\n\\]);`).exec(html); if (!m) return []; try { return vm.runInNewContext('(' + m[1] + ')', {}, { timeout: 500 }); } catch (e) { log('seed parse', name, e.message); return []; } };
  return { nodes: grab('nodes'), edges: grab('edges') };
}
/* the cards print IPs in three shapes: full, "…136-139" ranges, and ".81/.82" shorthands relative to the last full IP */
function ipsOf(text) {
  const out = []; const s = String(text || '');
  let last = null;
  const tokens = s.split(/[\s·,()]+/);
  for (const t of tokens) {
    const full = t.match(/^(\d{1,3}\.\d{1,3}\.\d{1,3})\.(\d{1,3})(?:[-–](\d{1,3}))?(?::\d+)?$/);
    if (full) { const base = full[1]; const a = Number(full[2]); const b = full[3] ? Number(full[3]) : a; for (let i = a; i <= Math.min(b, a + 16); i++) out.push(`${base}.${i}`); last = base; continue; }
    const short = t.match(/^\.(\d{1,3})(?:\/\.(\d{1,3}))*$/);
    if (short && last) { for (const p of t.split('/')) { const n = p.replace(/^\./, ''); if (/^\d+$/.test(n)) out.push(`${last}.${n}`); } }
  }
  return [...new Set(out)].filter(ip => ip.split('.').every(o => Number(o) <= 255));
}
const PRIVATE = ip => /^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/.test(ip);
function roleOf(n) { const s = `${n.id} ${n.name} ${n.sub || ''}`.toLowerCase();
  if (/\bdb\b|database|mysql|maria|postgres|maxscale|cache|data store/.test(s)) return 'db';
  if (/monitor|grafana|ci\/cd|dns/.test(s)) return 'monitoring';
  if (/vpn|firewall|npact|netaxis|hlr|fnr|citc|np operators|network/.test(s)) return 'network';
  if (/osb|bss|3scale|adapter|fast data|in-house|api env|integration/.test(s)) return 'integration';
  if (/backend|app front|portal|site0|epurchase|app-p|app \/ api|storefront|magento|admin portal/.test(s)) return 'app';
  if (/load balancer|\blb\b|gateway|apigw|ingress|waf|entry|isp/.test(s)) return 'edge';
  return n.layer === 'partners' || n.layer === 'oss' ? 'partner' : (n.layer || 'other'); }
function portsOf(n, role) { const s = `${n.meta || ''} ${(n.chips || []).join(' ')} ${n.sub || ''}`; const ports = new Set(); const m = s.match(/:(\d{2,5})\b/g) || []; for (const x of m) ports.add(Number(x.slice(1)));
  if (!ports.size) { if (role === 'db') { if (/postgres/i.test(s + n.name)) ports.add(5432); else ports.add(3306); } else if (role === 'edge') { ports.add(443); ports.add(80); } else if (role === 'app' || role === 'integration') ports.add(443); }
  return [...ports].filter(p => p > 0 && p < 65536); }
async function seedFromDiagrams() {
  const q = C(); let hosts = 0, nodesN = 0;
  for (const d of DIAGRAMS) {
    const { nodes } = readNodes(d.file);
    for (const n of nodes) {
      const ips = ipsOf(`${n.meta || ''} ${(n.chips || []).join(' ')} ${n.sub || ''} ${n.desc || ''}`);
      const role = roleOf(n); const ports = portsOf(n, role);
      const external = !ips.length || ips.every(ip => !PRIVATE(ip)) && /partner|external|ops|citc|operators/i.test(`${n.layer} ${n.name}`);
      await q.query(`INSERT INTO infra_map_nodes (diagram, node_id, label, layer, host_ips, service_ports, external) VALUES ($1,$2,$3,$4,$5,$6,$7)
          ON CONFLICT (diagram, node_id) DO UPDATE SET label=EXCLUDED.label, layer=EXCLUDED.layer, host_ips=CASE WHEN infra_map_nodes.host_ips = '{}' THEN EXCLUDED.host_ips ELSE infra_map_nodes.host_ips END, updated_at=now()`,
        [d.key, n.id, n.name, n.layer || null, ips, ports, external]);
      nodesN++;
      const retired = /retired|cutover|old:|legacy/i.test(`${n.name} ${n.sub || ''} ${n.meta || ''}`);
      for (const ip of ips) {
        const r = await q.query(`INSERT INTO infra_hosts (ip, ips, segment, role, label, diagram, node_id, service_ports, source, hostname, enabled, notes) VALUES ($1, ARRAY[$1], $2, $3, $4, $5, $6, $7, 'hld', NULL, $8, $9)
            ON CONFLICT (ip) DO UPDATE SET label = coalesce(infra_hosts.label, EXCLUDED.label), diagram = coalesce(infra_hosts.diagram, EXCLUDED.diagram), node_id = coalesce(infra_hosts.node_id, EXCLUDED.node_id) RETURNING (xmax = 0) AS inserted`,
          [ip, d.segment, role, `${n.name}${ips.length > 1 ? ' · ' + ip.split('.').slice(-1)[0] : ''}`, d.key, n.id, ports, !retired, retired ? 'retired on the HLD — not probed' : null]);
        if (r.rows[0].inserted) hosts++;
      }
    }
  }
  /* the console box itself — always local */
  const self = firstLocalIp();
  if (self) await q.query(`INSERT INTO infra_hosts (ip, ips, segment, role, label, hostname, source, service_ports, ssh) VALUES ($1, ARRAY[$1], 'shared', 'monitoring', 'Operations Console (this box)', $2, 'local', ARRAY[4701], false) ON CONFLICT (ip) DO UPDATE SET hostname = EXCLUDED.hostname, source = 'local'`, [self, os.hostname()]);
  /* hosts already reachable by the log collectors are ssh-able with the same key */
  const known = [...String(process.env.API_LOG_HOSTS || '').split(','), ...String(process.env.FIXED_LOG_HOSTS || '').split(','), ...CFG().sshHosts].map(s => s.trim()).filter(Boolean);
  if (known.length) await q.query(`UPDATE infra_hosts SET ssh = true WHERE ip = ANY($1::text[])`, [known]);
  if (hosts || nodesN) log(`seed: ${nodesN} map node(s) · ${hosts} new host(s) from the HLDs`);
  return { hosts, nodes: nodesN };
}
function firstLocalIp() { for (const [, ifs] of Object.entries(os.networkInterfaces())) for (const i of ifs || []) if (i.family === 'IPv4' && !i.internal) return i.address; return null; }

/* ------------------------------------------------------------------------------------------------------ collectors */
const exec = (cmd, args, opts = {}) => new Promise((resolve, reject) => execFile(cmd, args, { timeout: opts.timeout || 12000, maxBuffer: 4 * 1024 * 1024, encoding: 'utf8' }, (err, out, errS) => err ? reject(new Error((String(errS || '') || err.message).trim().slice(0, 300))) : resolve(out)));
const shq = s => `'` + String(s).replace(/'/g, `'\\''`) + `'`;
function sshExec(host, remoteCmd, timeout) {
  const h = typeof host === 'string' ? { ip: host } : host; const c = CFG(); const user = h.ssh_user || c.sshUser;
  const args = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=5', '-o', 'StrictHostKeyChecking=accept-new', '-p', String(c.sshPort)];
  if (c.sshKey) args.push('-i', c.sshKey);
  if (h.ssh_via) {   // passerelle: ProxyCommand (not -J) so the jump hop gets the same key, port and BatchMode — -J would prompt for a password on the jump host
    const via = /@/.test(h.ssh_via) ? h.ssh_via : (user ? `${user}@${h.ssh_via}` : h.ssh_via);
    const pc = ['ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=5', '-o', 'StrictHostKeyChecking=accept-new', '-p', String(c.sshPort), c.sshKey ? `-i ${c.sshKey}` : '', '-W', '%h:%p', via].filter(Boolean).join(' ');
    args.push('-o', `ProxyCommand=${pc}`);
  }
  args.push(user ? `${user}@${h.ip}` : h.ip, remoteCmd);
  return exec('ssh', args, { timeout: timeout || 12000 });
}
/* one script for the metrics of a host — a few /proc reads, df, ss; the same text is parsed for local and ssh */
const METRICS_SH = `cat /proc/loadavg; echo @@MEM; cat /proc/meminfo | head -20; echo @@CPU; head -1 /proc/stat; echo @@NET; cat /proc/net/dev; echo @@DF; df -P -x tmpfs -x devtmpfs -x squashfs -x overlay 2>/dev/null; echo @@NPROC; nproc; echo @@SS; (ss -tn state established 2>/dev/null || netstat -tn 2>/dev/null) | awk 'NR>1{print $4, $5}' | head -3000`;
const INVENTORY_SH = `echo @@HOST; hostname; echo @@OS; (cat /etc/os-release 2>/dev/null | grep -E '^(PRETTY_NAME|ID|VERSION_ID)='); uname -r; echo @@VIRT; (systemd-detect-virt 2>/dev/null || echo unknown); echo @@CPU; lscpu 2>/dev/null | grep -E '^(Model name|CPU\\(s\\)|Thread|Core|Socket|Architecture|Hypervisor)'; echo @@MEM; grep -E '^(MemTotal|SwapTotal)' /proc/meminfo; echo @@DISK; lsblk -d -n -o NAME,SIZE,TYPE,MODEL 2>/dev/null; echo @@FS; df -P -x tmpfs -x devtmpfs -x squashfs -x overlay 2>/dev/null; echo @@NIC; ip -o -4 addr show 2>/dev/null | awk '{print $2, $4}'; echo @@BOOT; uptime -s 2>/dev/null; echo @@PORTS; (ss -ltnp 2>/dev/null || netstat -ltnp 2>/dev/null) | awk 'NR>1{print $4, $NF}' | head -200; echo @@UNITS; (systemctl list-units --type=service --state=running --no-pager --no-legend 2>/dev/null | awk '{print $1}' | head -80); echo @@PM2; (pm2 jlist 2>/dev/null | head -c 20000 || true); echo @@AGENTS; (pgrep -fl instana-agent >/dev/null && echo instana) ; (pgrep -fl node_exporter >/dev/null && echo node_exporter); echo @@NTP; (chronyc tracking 2>/dev/null | grep -i 'system time' || timedatectl show -p NTPSynchronized 2>/dev/null); echo @@END`;
const sections = out => { const o = {}; let k = 'head'; for (const line of String(out).split('\n')) { const m = /^@@(\w+)$/.exec(line.trim()); if (m) { k = m[1]; o[k] = []; continue; } (o[k] = o[k] || []).push(line); } return o; };
function parseMetrics(raw, prev) {
  const s = sections(raw);
  const la = (s.head || []).join(' ').trim().split(/\s+/); const load1 = N(la[0], null), load5 = N(la[1], null), load15 = N(la[2], null);
  const mem = {}; for (const l of s.MEM || []) { const m = /^(\w+):\s+(\d+)/.exec(l); if (m) mem[m[1]] = Number(m[2]); }
  const memPct = mem.MemTotal ? Math.round(1000 * (mem.MemTotal - (mem.MemAvailable != null ? mem.MemAvailable : (mem.MemFree || 0) + (mem.Buffers || 0) + (mem.Cached || 0))) / mem.MemTotal) / 10 : null;
  const swapPct = mem.SwapTotal ? Math.round(1000 * (mem.SwapTotal - (mem.SwapFree || 0)) / mem.SwapTotal) / 10 : (mem.SwapTotal === 0 ? 0 : null);
  const cpuL = (s.CPU || [])[0] || ''; const c = cpuL.trim().split(/\s+/).slice(1).map(Number); const cpu = c.length >= 4 ? { total: c.reduce((a, x) => a + x, 0), idle: c[3] + (c[4] || 0) } : null;
  let rx = 0, tx = 0; for (const l of s.NET || []) { const m = /^\s*(\S+):\s*(\d+)\s+\d+\s+\d+\s+\d+\s+\d+\s+\d+\s+\d+\s+\d+\s+(\d+)/.exec(l); if (m && m[1] !== 'lo') { rx += Number(m[2]); tx += Number(m[3]); } }
  const disks = []; for (const l of (s.DF || []).slice(1)) { const p = l.trim().split(/\s+/); if (p.length >= 6) { const pct = N(String(p[4]).replace('%', ''), null); if (pct != null && !/^\/(boot|snap|run|dev|sys|proc)/.test(p[5])) disks.push({ mount: p[5], pct, size_kb: N(p[1], null), used_kb: N(p[2], null) }); } }
  const nproc = N((s.NPROC || [])[0], null);
  const peers = {}; for (const l of s.SS || []) { const p = l.trim().split(/\s+/); if (p.length < 2) continue; const dst = p[1]; const m = /^(?:\[?([\d.]+)\]?):(\d+)$/.exec(dst); if (!m) continue; const k = m[1] + ':' + m[2]; peers[k] = (peers[k] || 0) + 1; }
  const now = Date.now(); const out = { load1, load5, load15, mem_pct: memPct, swap_pct: swapPct, disks, disk_pct: disks.length ? Math.max(...disks.map(d => d.pct)) : null, nproc, conns: Object.values(peers).reduce((a, x) => a + x, 0), peers, _raw: { cpu, rx, tx, at: now } };
  if (prev && prev._raw && cpu && prev._raw.cpu) { const dt = cpu.total - prev._raw.cpu.total; const di = cpu.idle - prev._raw.cpu.idle; if (dt > 0) out.cpu_pct = Math.round(1000 * (1 - di / dt)) / 10; }
  if (prev && prev._raw && prev._raw.at) { const sec = (now - prev._raw.at) / 1000; if (sec > 5) { out.rx_bps = Math.max(0, (rx - prev._raw.rx) / sec); out.tx_bps = Math.max(0, (tx - prev._raw.tx) / sec); } }
  return out;
}
function parseInventory(out) {
  const s = sections(out); const j = k => (s[k] || []).map(x => x.trim()).filter(Boolean);
  const cpu = {}; for (const l of j('CPU')) { const m = /^([^:]+):\s*(.+)$/.exec(l); if (m) cpu[m[1].trim()] = m[2].trim(); }
  const mem = {}; for (const l of j('MEM')) { const m = /^(\w+):\s+(\d+)/.exec(l); if (m) mem[m[1]] = Number(m[2]); }
  const osr = {}; for (const l of j('OS')) { const m = /^(\w+)=(.*)$/.exec(l); if (m) osr[m[1]] = m[2].replace(/^"|"$/g, ''); else if (/^\d/.test(l)) osr.kernel = l; }
  const fs_ = []; for (const l of j('FS').slice(1)) { const p = l.split(/\s+/); if (p.length >= 6 && !/^\/(boot|snap|run|dev|sys|proc)/.test(p[5])) fs_.push({ mount: p[5], dev: p[0], size_gb: Math.round(N(p[1], 0) / 1048576 * 10) / 10 }); }
  const listening = []; for (const l of j('PORTS')) { const m = /:(\d+)\s+(?:users:\(\("([^"]+)")?/.exec(l); if (m) listening.push({ port: Number(m[1]), proc: m[2] || null }); }
  const ports = [...new Map(listening.map(x => [x.port, x])).values()].sort((a, b) => a.port - b.port).slice(0, 60);
  let pm2 = []; try { const raw = j('PM2').join(''); if (raw.startsWith('[')) pm2 = JSON.parse(raw).map(p => ({ name: p.name, status: p.pm2_env && p.pm2_env.status, mem_mb: p.monit ? Math.round(p.monit.memory / 1048576) : null, restarts: p.pm2_env && p.pm2_env.restart_time })); } catch (_) {}
  return { hostname: j('HOST')[0] || null, os: osr.PRETTY_NAME || null, os_id: osr.ID || null, kernel: osr.kernel || null, virt: j('VIRT')[0] || null,
    cpu_model: cpu['Model name'] || null, cpus: N(cpu['CPU(s)'], null), threads_per_core: N(cpu['Thread(s) per core'], null), cores_per_socket: N(cpu['Core(s) per socket'], null), sockets: N(cpu['Socket(s)'], null), arch: cpu.Architecture || null, hypervisor: cpu['Hypervisor vendor'] || null,
    ram_mb: mem.MemTotal ? Math.round(mem.MemTotal / 1024) : null, swap_mb: mem.SwapTotal != null ? Math.round(mem.SwapTotal / 1024) : null,
    disks: j('DISK').map(l => { const p = l.split(/\s+/); return { dev: p[0], size: p[1], type: p[2], model: p.slice(3).join(' ') || null }; }),
    filesystems: fs_, nics: j('NIC').map(l => { const p = l.split(/\s+/); return { name: p[0], cidr: p[1] }; }), boot_at: j('BOOT')[0] || null,
    listening: ports, units: j('UNITS').slice(0, 80), pm2, agents: j('AGENTS'), ntp: j('NTP')[0] || null };
}
const hashOf = o => require('crypto').createHash('sha1').update(JSON.stringify(o)).digest('hex').slice(0, 16);
function tcpProbe(ip, port, timeout) {
  return new Promise(resolve => { const t0 = Date.now(); const s = new net.Socket(); let done = false; const fin = ok => { if (done) return; done = true; try { s.destroy(); } catch (_) {} resolve({ port, ok, ms: Date.now() - t0 }); };
    s.setTimeout(timeout); s.once('connect', () => fin(true)); s.once('timeout', () => fin(false)); s.once('error', () => fin(false)); try { s.connect(port, ip); } catch (_) { fin(false); } });
}
const httpGet = (url, headers, timeout) => new Promise((resolve, reject) => { const mod = url.startsWith('https') ? require('https') : require('http'); const req = mod.get(url, { headers: headers || {}, timeout }, res => { let body = ''; res.setEncoding('utf8'); res.on('data', d => { if (body.length < 4 * 1024 * 1024) body += d; }); res.on('end', () => resolve({ status: res.statusCode, body })); res.on('error', reject); }); req.on('timeout', () => { req.destroy(new Error('timeout')); }); req.on('error', reject); });
async function nodeExporter(ip) {
  try { const r = await httpGet(`http://${ip}:9100/metrics`, {}, 4000); if (r.status !== 200) return null; const txt = r.body;
    const g = name => { const m = new RegExp(`^${name}(?:\\{[^}]*\\})? (\\S+)`, 'm').exec(txt); return m ? Number(m[1]) : null; };
    const total = g('node_memory_MemTotal_bytes'), avail = g('node_memory_MemAvailable_bytes'); const swT = g('node_memory_SwapTotal_bytes'), swF = g('node_memory_SwapFree_bytes');
    const disks = []; for (const m of txt.matchAll(/^node_filesystem_size_bytes\{([^}]*)\} (\S+)$/gm)) { const mount = /mountpoint="([^"]+)"/.exec(m[1]); const fst = /fstype="([^"]+)"/.exec(m[1]); if (!mount || /tmpfs|overlay|squashfs/.test(fst ? fst[1] : '')) continue; const av = new RegExp(`^node_filesystem_avail_bytes\\{[^}]*mountpoint="${mount[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^}]*\\} (\\S+)$`, 'm').exec(txt); const size = Number(m[2]); if (av && size) disks.push({ mount: mount[1], pct: Math.round(1000 * (1 - Number(av[1]) / size)) / 10 }); }
    return { load1: g('node_load1'), load5: g('node_load5'), load15: g('node_load15'), mem_pct: total ? Math.round(1000 * (total - avail) / total) / 10 : null, swap_pct: swT ? Math.round(1000 * (swT - swF) / swT) / 10 : 0, disks, disk_pct: disks.length ? Math.max(...disks.map(d => d.pct)) : null, source: 'node_exporter' };
  } catch (_) { return null; }
}
async function instanaGet(p) { const c = CFG(); if (!c.instanaUrl || !c.instanaToken) return null; const r = await httpGet(c.instanaUrl + p, { authorization: 'apiToken ' + c.instanaToken, accept: 'application/json' }, 15000); if (r.status !== 200) throw new Error('HTTP ' + r.status); return JSON.parse(r.body); }
async function instanaHosts() {
  const list = await instanaGet('/api/infrastructure-monitoring/snapshots?plugin=host&size=500&windowSize=600000'); const items = (list && list.items) || []; const out = [];
  for (const it of items.slice(0, 300)) { try { const s = await instanaGet(`/api/infrastructure-monitoring/snapshots/${encodeURIComponent(it.snapshotId)}`); const d = (s && s.data) || {}; const ips = [].concat(d.ipAddresses || d.ips || [], d.ipAddress ? [d.ipAddress] : []).filter(x => /^\d+\.\d+\.\d+\.\d+$/.test(x));
      out.push({ snapshotId: it.snapshotId, hostname: d.hostname || it.label, ips, inventory: { hostname: d.hostname, os: d.osName ? `${d.osName} ${d.osVersion || ''}`.trim() : null, kernel: d.kernelVersion || null, cpus: d.cpuCount || d.cpu_count || null, cpu_model: d.cpuModel || null, ram_mb: d.memoryTotal ? Math.round(d.memoryTotal / 1048576) : null, virt: d.machineType || null, boot_at: d.bootTime ? new Date(d.bootTime).toISOString() : null, tags: d.tags || [], agents: ['instana'] } }); } catch (_) {} }
  return out;
}

/* ------------------------------------------------------------------------------------------------------ discovery
 * "We have access from 152 to all servers": try the console key on every enabled host that is not flagged ssh yet —
 * `ssh -o BatchMode=yes host true` (5 s) — and flag the ones that answer. Runs with every inventory cycle and on demand
 * (Sources › Discover SSH access). A host that refuses stays as it is; nothing else is attempted. */
async function discover({ all = false } = {}) {
  const c = CFG(); if (!(c.sshUser || c.sshKey) || !C()) return { tried: 0, found: 0, hosts: [], reason: 'ssh not configured (INFRA_SSH_USER / INFRA_SSH_KEY or API_LOG_USER / API_LOG_KEY)' };
  const self = firstLocalIp();
  const hosts = (await C().query(`SELECT id, ip, label, ssh, ssh_via, ssh_user FROM infra_hosts WHERE enabled AND source <> 'local' AND ip <> $1 ${all ? '' : 'AND NOT ssh'} ORDER BY id`, [self || ''])).rows;
  const found = [], refused = []; let idx = 0;
  const worker = async () => { while (idx < hosts.length) { const h = hosts[idx++]; try { const out = await sshExec(h, 'echo ok', 9000); if (/ok/.test(out)) { found.push(h); if (!h.ssh) await C().query(`UPDATE infra_hosts SET ssh = true, updated_at = now() WHERE id = $1`, [h.id]); } else refused.push({ ip: h.ip, why: 'no answer' }); } catch (e) { refused.push({ ip: h.ip, why: e.message.slice(0, 120) }); } } };
  await Promise.all(Array.from({ length: Math.min(8, hosts.length) }, worker));
  const newly = found.filter(h => !h.ssh);
  if (newly.length) { for (const h of newly) await C().query(`INSERT INTO infra_host_changes (host_id, kind, field, before, after, note) VALUES ($1,'discover','ssh','false','true','the console key answered — inventory and metrics from the next tick')`, [h.id]); log(`discover: ${newly.length} host(s) now reachable by ssh: ${newly.map(h => h.ip).join(', ')}`); }
  return { tried: hosts.length, found: found.length, newly: newly.length, hosts: found.map(h => ({ id: h.id, ip: h.ip, label: h.label })), refused };
}

/* ------------------------------------------------------------------------------------------------------ probes (the healthcheck shape) */
function probesFor(host, m, inv, ports, reach) {
  const th = CFG().th; const P = []; const add = (probe, level, value, threshold, note) => P.push({ probe, level, value: value == null ? null : String(value), threshold: threshold == null ? null : String(threshold), note: note || null });
  if (!reach.observable) { add('reachable', 'UNKNOWN', 'not probed', 'any source', 'no service port, no ssh, no exporter, no Instana for this host — set a service port or the ssh flag on the host page'); return P; }
  add('reachable', reach.any ? 'OK' : 'CRIT', reach.any ? 'yes' : 'no', 'any source', reach.any ? `via ${reach.sources.join(', ')}` : 'no source answered — ssh, ports, node exporter, instana');
  const shellOk = reach.sources.includes('ssh') || reach.sources.includes('local');
  for (const p of ports) add(`port:${p.port}`, p.ok ? 'OK' : (!shellOk && (host.role === 'edge' || host.role === 'db') ? 'CRIT' : 'WARN'), p.ok ? `open · ${p.ms} ms` : 'closed / filtered', 'open', p.ok ? null : (shellOk ? `port ${p.port} closed from the console box while the host answers by ssh — a guessed port, or a service listening on another one (Host settings)` : `service port ${p.port} does not answer from the console box`));
  if (m) {
    const cores = m.nproc || (inv && inv.cpus) || null;
    if (m.load15 != null && cores) { const pc = Math.round(100 * m.load15 / cores) / 100; add('load15_per_core', pc >= th.loadCrit ? 'CRIT' : pc >= th.loadWarn ? 'WARN' : 'OK', pc, `${th.loadWarn} / ${th.loadCrit}`, `load15 ${m.load15} on ${cores} cpu`); }
    if (m.mem_pct != null) add('memory_pct', m.mem_pct >= th.memCrit ? 'CRIT' : m.mem_pct >= th.memWarn ? 'WARN' : 'OK', m.mem_pct, `${th.memWarn} / ${th.memCrit}`, 'MemTotal − MemAvailable, the page cache is not "used"');
    if (m.swap_pct != null && m.swap_pct > 0) add('swap_pct', m.swap_pct >= th.swapWarn ? 'WARN' : 'OK', m.swap_pct, th.swapWarn, null);
    for (const d of m.disks || []) add(`disk:${d.mount}`, d.pct >= th.diskCrit ? 'CRIT' : d.pct >= th.diskWarn ? 'WARN' : 'OK', d.pct, `${th.diskWarn} / ${th.diskCrit}`, null);
  }
  if (inv) {
    if (inv.pm2 && inv.pm2.length) for (const p of inv.pm2) add(`pm2:${p.name}`, p.status === 'online' ? 'OK' : 'CRIT', p.status, 'online', p.restarts ? `${p.restarts} restart(s)` : null);
    if (inv.agents) add('instana_agent', inv.agents.includes('instana') ? 'OK' : 'WARN', inv.agents.includes('instana') ? 'running' : 'not seen', 'running', 'pgrep instana-agent');
    if (inv.ntp) add('ntp', /yes|true|System time\s*:\s*[-\d.]+ seconds (fast|slow)/i.test(inv.ntp) ? 'OK' : 'WARN', inv.ntp.slice(0, 60), 'synchronised', null);
  }
  return P;
}
const worst = levels => levels.includes('CRIT') ? 'CRIT' : levels.includes('WARN') ? 'WARN' : levels.includes('OK') ? 'OK' : 'UNKNOWN';

/* ------------------------------------------------------------------------------------------------------ the tick */
let busy = false; let lastRun = null; const prevMetrics = new Map(); let lastInventoryAt = 0; let lastInstanaAt = 0;
async function tick({ inventory = false, force = false } = {}) {
  if (busy || !C()) return { skipped: true }; busy = true; const t0 = Date.now(); const c = CFG();
  const errors = {}; const bySource = { local: 0, ssh: 0, ports: 0, node_exporter: 0, instana: 0 }; let reachableN = 0;
  try {
    await ensureSchema();
    const doInventory = inventory || force || Date.now() - lastInventoryAt > c.inventoryHours * 3600e3;
    if (doInventory) { try { const d = await discover(); if (d.tried) log(`discover: tried ${d.tried} host(s), ${d.found} answer by ssh`); } catch (e) { log('discover', e.message); } }
    const hosts = (await C().query(`SELECT * FROM infra_hosts WHERE enabled ORDER BY id`)).rows;
    const self = firstLocalIp();
    const ipToHost = new Map(); for (const h of hosts) for (const ip of h.ips || [h.ip]) ipToHost.set(ip, h.id);
    /* instana, once per inventory cycle: inventory for every host it knows (and new hosts it sees that the HLD does not) */
    let instana = null; if (doInventory && c.instanaUrl && c.instanaToken) { try { instana = await instanaHosts(); bySource.instana = instana.length; } catch (e) { errors.instana = e.message; } }
    const instanaByIp = new Map(); if (instana) for (const ih of instana) for (const ip of ih.ips) instanaByIp.set(ip, ih);
    const limit = 6; let idx = 0; const flowsRows = [];
    const worker = async () => { while (idx < hosts.length) { const h = hosts[idx++]; try { await one(h); } catch (e) { errors[h.ip] = e.message.slice(0, 160); } } };
    async function one(h) {
      const sources = []; let m = null, inv = null; const isLocal = h.ip === self || h.source === 'local';
      /* 1) metrics: local / ssh / node exporter */
      if (isLocal) { try { m = parseMetrics(await exec('bash', ['-c', METRICS_SH]), prevMetrics.get(h.id)); m.source = 'local'; sources.push('local'); bySource.local++; } catch (e) { errors[h.ip] = 'local: ' + e.message; } }
      else if (h.ssh && (c.sshUser || c.sshKey)) { try { m = parseMetrics(await sshExec(h, METRICS_SH), prevMetrics.get(h.id)); m.source = 'ssh'; sources.push('ssh'); bySource.ssh++; } catch (e) { errors[h.ip] = 'ssh: ' + e.message; } }
      if (!m) { const ne = await nodeExporter(h.ip); if (ne) { m = ne; sources.push('node_exporter'); bySource.node_exporter++; if (!h.node_exporter) await C().query(`UPDATE infra_hosts SET node_exporter = true WHERE id = $1`, [h.id]); } }
      if (m) prevMetrics.set(h.id, m);
      /* 2) ports — always, the cheapest truth */
      const portList = [...new Set([...(h.service_ports || []), ...(h.ssh ? [c.sshPort] : [])])].slice(0, 12);
      const ports = await Promise.all(portList.map(p => tcpProbe(h.ip, p, c.portTimeout))); if (ports.some(p => p.ok)) { sources.push('ports'); bySource.ports++; }
      /* 3) inventory: ssh/local daily, instana when it knows the host */
      if (doInventory) {
        try { if (isLocal) inv = parseInventory(await exec('bash', ['-c', INVENTORY_SH], { timeout: 20000 })); else if (h.ssh && (c.sshUser || c.sshKey) && sources.includes('ssh')) inv = parseInventory(await sshExec(h, INVENTORY_SH, 25000)); } catch (e) { errors[h.ip + ':inv'] = e.message.slice(0, 160); }
        const ih = instanaByIp.get(h.ip); if (ih) { inv = { ...(ih.inventory || {}), ...(inv || {}), agents: [...new Set([...(inv && inv.agents || []), 'instana'])] }; sources.push('instana'); if (!h.instana_id) await C().query(`UPDATE infra_hosts SET instana_id = $2 WHERE id = $1`, [h.id, ih.snapshotId]); }
        if (inv) { const hash = hashOf({ ...inv, listening: undefined, pm2: undefined, units: undefined, ntp: undefined, boot_at: undefined }); const before = h.inventory || {};
          if (h.inventory_hash && h.inventory_hash !== hash) { for (const k of ['os', 'kernel', 'cpus', 'cpu_model', 'ram_mb', 'swap_mb', 'disks', 'filesystems', 'nics', 'virt']) if (JSON.stringify(before[k]) !== JSON.stringify(inv[k])) await C().query(`INSERT INTO infra_host_changes (host_id, kind, field, before, after) VALUES ($1,'inventory',$2,$3,$4)`, [h.id, k, JSON.stringify(before[k] ?? null), JSON.stringify(inv[k] ?? null)]); }
          if (before.boot_at && inv.boot_at && before.boot_at !== inv.boot_at) await C().query(`INSERT INTO infra_host_changes (host_id, kind, field, before, after, note) VALUES ($1,'reboot','boot_at',$2,$3,'the host rebooted')`, [h.id, JSON.stringify(before.boot_at), JSON.stringify(inv.boot_at)]);
          if (before.listening && inv.listening) { const was = new Set(before.listening.map(x => x.port)), now = new Set(inv.listening.map(x => x.port)); const added = [...now].filter(p => !was.has(p)), gone = [...was].filter(p => !now.has(p)); if (added.length || gone.length) await C().query(`INSERT INTO infra_host_changes (host_id, kind, field, before, after) VALUES ($1,'listeners','ports',$2,$3)`, [h.id, JSON.stringify(gone), JSON.stringify(added)]); }
          await C().query(`UPDATE infra_hosts SET inventory = $2, inventory_hash = $3, inventory_at = now(), hostname = coalesce($4, hostname), updated_at = now() WHERE id = $1`, [h.id, JSON.stringify(inv), hash, inv.hostname || null]);
          /* the ports printed on the card are a guess; a host we can read tells us what it really serves — once, unless a person edited the ports */
          if (!h.ports_learned && inv.listening && inv.listening.length) { const KNOWN = [80, 443, 8080, 8443, 3000, 3306, 5432, 6379, 9340, 4700, 4701, 27017, 9100, 1521, 8000, 8081, 9000]; const real = inv.listening.map(x => x.port).filter(p => KNOWN.includes(p) || (p >= 3000 && p < 10000 && !/sshd|chronyd|dhclient|rpcbind|systemd/.test(String(inv.listening.find(x => x.port === p).proc || ''))));
            const learned = [...new Set(real)].slice(0, 8); if (learned.length) { await C().query(`UPDATE infra_hosts SET service_ports = $2, ports_learned = true WHERE id = $1`, [h.id, learned]); await C().query(`INSERT INTO infra_host_changes (host_id, kind, field, before, after, note) VALUES ($1,'ports','service_ports',$2,$3,'learned from the listening ports of the host')`, [h.id, JSON.stringify(h.service_ports), JSON.stringify(learned)]); h.service_ports = learned; } } }
      } else inv = h.inventory && Object.keys(h.inventory).length ? h.inventory : null;
      /* 4) flows from the peers seen by ss (ssh/local) */
      if (m && m.peers) for (const [k, n] of Object.entries(m.peers)) { const [dip, dport] = k.split(':'); if (dip === h.ip || dip === '127.0.0.1') continue; flowsRows.push([h.id, ipToHost.get(dip) || null, h.ip, dip, Number(dport), n, m.source]); }
      /* 5) probes + status */
      const observable = isLocal || portList.length > 0 || (h.ssh && (c.sshUser || c.sshKey)) || h.node_exporter || !!h.instana_id;
      const reach = { any: sources.length > 0, sources, observable }; if (reach.any) reachableN++;
      const P = probesFor(h, m, inv, ports, reach); const status = worst(P.map(p => p.level)).toLowerCase();
      for (const p of P) await C().query(`INSERT INTO infra_probes (host_id, probe, level, value, threshold, note) VALUES ($1,$2,$3,$4,$5,$6)`, [h.id, p.probe, p.level, p.value, p.threshold, p.note]);
      if (h.status !== status) await C().query(`INSERT INTO infra_host_changes (host_id, kind, field, before, after) VALUES ($1,'status','status',$2,$3)`, [h.id, JSON.stringify(h.status), JSON.stringify(status)]);
      if (m) await C().query(`INSERT INTO infra_host_metrics (host_id, at, cpu_pct, load1, load5, load15, mem_pct, swap_pct, disk_pct, disks, rx_bps, tx_bps, conns, source) VALUES ($1, date_trunc('minute', now()), $2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT (host_id, at) DO UPDATE SET cpu_pct=EXCLUDED.cpu_pct, mem_pct=EXCLUDED.mem_pct, rx_bps=EXCLUDED.rx_bps, tx_bps=EXCLUDED.tx_bps`,
        [h.id, m.cpu_pct ?? null, m.load1, m.load5, m.load15, m.mem_pct, m.swap_pct, m.disk_pct, JSON.stringify(m.disks || []), m.rx_bps ?? null, m.tx_bps ?? null, m.conns ?? null, m.source]);
      await C().query(`UPDATE infra_hosts SET status = $2, status_at = now(), reachable = $3, last_seen = CASE WHEN $3 THEN now() ELSE last_seen END, last_metrics = $4, updated_at = now() WHERE id = $1`,
        [h.id, status, observable ? reach.any : null, JSON.stringify({ ...(m || {}), _raw: undefined, peers: undefined, sources, ports, probes: P.filter(p => p.level !== 'OK').map(p => p.probe + ' ' + p.level), at: new Date().toISOString() })]);
    }
    await Promise.all(Array.from({ length: Math.min(limit, hosts.length) }, worker));
    if (flowsRows.length) { const vals = flowsRows.map((r, i) => `($${i * 7 + 1},$${i * 7 + 2},$${i * 7 + 3},$${i * 7 + 4},$${i * 7 + 5},$${i * 7 + 6},$${i * 7 + 7})`).join(','); await C().query(`INSERT INTO infra_flows (src_host_id, dst_host_id, src_ip, dst_ip, dst_port, conns, source) VALUES ${vals}`, flowsRows.flat()); }
    /* instana hosts the HLD does not know → new rows (segment shared, a person classifies) */
    if (instana) for (const ih of instana) { const ip = ih.ips.find(x => PRIVATE(x)) || ih.ips[0]; if (!ip || ipToHost.has(ip)) continue; await C().query(`INSERT INTO infra_hosts (ip, ips, segment, role, label, hostname, source, instana_id, inventory, inventory_hash, inventory_at) VALUES ($1,$2,'shared','other',$3,$3,'instana',$4,$5,$6,now()) ON CONFLICT (ip) DO NOTHING`, [ip, ih.ips, ih.hostname || ip, ih.snapshotId, JSON.stringify(ih.inventory), hashOf(ih.inventory)]); }
    if (doInventory) lastInventoryAt = Date.now();
    await C().query(`DELETE FROM infra_host_metrics WHERE at < now() - interval '30 days'`); await C().query(`DELETE FROM infra_flows WHERE at < now() - interval '7 days'`); await C().query(`DELETE FROM infra_probes WHERE at < now() - interval '30 days'`); await C().query(`DELETE FROM infra_runs WHERE at < now() - interval '30 days'`);
    lastRun = { at: new Date().toISOString(), ms: Date.now() - t0, hosts: hosts.length, reachable: reachableN, by_source: bySource, errors, inventory: doInventory };
    await C().query(`INSERT INTO infra_runs (ms, hosts, reachable, by_source, errors, kind) VALUES ($1,$2,$3,$4,$5,$6)`, [lastRun.ms, hosts.length, reachableN, JSON.stringify(bySource), JSON.stringify(errors), doInventory ? 'inventory' : 'metrics']);
    try { await mailDigest(); } catch (e) { log('digest', e.message); }
  } catch (e) { lastRun = { at: new Date().toISOString(), error: e.message }; log('tick failed', e.message); }
  finally { busy = false; }
  return lastRun;
}
/* the per-segment digest, in the healthcheck mail shape, on CHANGE of the segment's worst level (throttle kept in settings) */
async function mailDigest() {
  const c = CFG(); if (!c.mails.length) return;
  const settings = require('./settings'); const st = (await settings.getSetting('infra_digest')) || {};
  const rows = (await C().query(`SELECT h.id, h.label, h.ip, h.segment, h.status, h.last_metrics FROM infra_hosts h WHERE h.enabled ORDER BY h.segment, h.status, h.label`)).rows;
  for (const seg of ['mobile', 'fixed', 'shared']) {
    const hs = rows.filter(r => r.segment === seg); if (!hs.length) continue;
    const level = worst(hs.map(h => h.status.toUpperCase())); const key = seg; const prev = st[key] || {};
    if (prev.level === level && Date.now() - new Date(prev.at || 0).getTime() < 6 * 3600e3) continue;
    const notify = require('./notify'); const esc = notify.esc;
    const bad = hs.filter(h => h.status !== 'ok');
    const body = `<div style="font-size:13px;line-height:1.55">${hs.length} host(s) · ${hs.filter(h => h.status === 'ok').length} OK · ${hs.filter(h => h.status === 'warn').length} WARN · ${hs.filter(h => h.status === 'crit').length} CRIT · ${hs.filter(h => h.status === 'unknown').length} unknown</div>
      <table style="border-collapse:collapse;width:100%;margin-top:12px;font-size:12px"><tr style="color:#64748b;font-size:10.5px;letter-spacing:.05em"><th align="left">HOST</th><th align="left">IP</th><th align="left">LEVEL</th><th align="left">PROBES</th></tr>
      ${(bad.length ? bad : hs.slice(0, 20)).map(h => `<tr><td style="padding:4px 6px 4px 0;border-top:1px solid #e3e7e5">${esc(h.label || h.ip)}</td><td style="border-top:1px solid #e3e7e5;font-family:monospace">${esc(h.ip)}</td><td style="border-top:1px solid #e3e7e5;color:${h.status === 'crit' ? '#dc2626' : h.status === 'warn' ? '#d97706' : h.status === 'ok' ? '#0b3d2b' : '#64748b'};font-weight:700">${esc(h.status.toUpperCase())}</td><td style="border-top:1px solid #e3e7e5">${esc(((h.last_metrics || {}).probes || []).join(' · ') || '—')}</td></tr>`).join('')}</table>
      <div style="font-size:11px;color:#64748b;margin-top:8px">Operations Console › Infrastructure › Hosts. Sent on a change of the segment's level, at most every 6 h otherwise.</div>`;
    await notify.sendHtml(c.mails.map(email => ({ email })), `[Salam Ops] Infrastructure ${seg} — ${level}`, notify.shell({ title: `Infrastructure · ${seg} · ${level}`, badge: 'OPERATIONS CONSOLE · INFRASTRUCTURE', pill: level, pillColor: level === 'CRIT' ? '#dc2626' : level === 'WARN' ? '#d97706' : '#0b3d2b', bodyHtml: body }));
    st[key] = { level, at: new Date().toISOString() };
  }
  await settings.setSetting('infra_digest', st);
}

/* ------------------------------------------------------------------------------------------------------ reads */
async function overview() {
  const q = C(); await ensureSchema();
  const nodes = (await q.query(`SELECT diagram, node_id, label FROM infra_map_nodes ORDER BY diagram, label`)).rows;
  const hosts = (await q.query(`SELECT id, hostname, ip, ips, segment, role, label, diagram, node_id, ssh, ssh_via, ssh_user, node_exporter, instana_id, service_ports, enabled, source, status, status_at, reachable, last_seen, inventory_at, last_metrics,
      inventory->>'os' AS os, (inventory->>'cpus')::int AS cpus, (inventory->>'ram_mb')::int AS ram_mb, inventory->>'cpu_model' AS cpu_model, inventory->>'virt' AS virt, inventory->'agents' AS agents FROM infra_hosts ORDER BY segment, role, label`)).rows;
  const bySeg = {}; for (const h of hosts) { const s = bySeg[h.segment] = bySeg[h.segment] || { segment: h.segment, hosts: 0, ok: 0, warn: 0, crit: 0, unknown: 0, unreachable: 0, cpus: 0, ram_mb: 0 }; s.hosts++; s[h.status] = (s[h.status] || 0) + 1; if (h.reachable === false) s.unreachable++; s.cpus += h.cpus || 0; s.ram_mb += h.ram_mb || 0; }
  const runs = (await q.query(`SELECT at, ms, hosts, reachable, by_source, errors, kind FROM infra_runs ORDER BY at DESC LIMIT 10`)).rows;
  const changes = (await q.query(`SELECT c.*, h.label, h.ip, h.segment FROM infra_host_changes c JOIN infra_hosts h ON h.id = c.host_id ORDER BY c.at DESC LIMIT 30`)).rows;
  const c = CFG();
  return { hosts, nodes, by_segment: Object.values(bySeg), runs, last_run: runs[0] || lastRun, changes, running: busy, diagrams: DIAGRAMS.map(d => ({ key: d.key, title: d.title, segment: d.segment })),
    sources: { local: true, ssh: !!(c.sshUser || c.sshKey), ssh_user: c.sshUser || null, instana: !!(c.instanaUrl && c.instanaToken), instana_url: c.instanaUrl || null, mails: c.mails.length, interval_sec: c.intervalSec, inventory_hours: c.inventoryHours, thresholds: c.th } };
}
async function hostDetail(id) {
  const q = C(); const h = (await q.query(`SELECT * FROM infra_hosts WHERE id = $1`, [id])).rows[0]; if (!h) return null;
  const probes = (await q.query(`SELECT probe, level, value, threshold, note, at FROM infra_probes WHERE host_id = $1 AND at >= (SELECT max(at) FROM infra_probes WHERE host_id = $1) - interval '1 second' ORDER BY CASE level WHEN 'CRIT' THEN 0 WHEN 'WARN' THEN 1 ELSE 2 END, probe`, [id])).rows;
  const series = (await q.query(`SELECT at, cpu_pct, load1, load15, mem_pct, swap_pct, disk_pct, rx_bps, tx_bps, conns FROM infra_host_metrics WHERE host_id = $1 AND at >= now() - interval '24 hours' ORDER BY at`, [id])).rows;
  const history = (await q.query(`SELECT date_trunc('hour', at) AS h, count(*) FILTER (WHERE level='CRIT')::int crit, count(*) FILTER (WHERE level='WARN')::int warn FROM infra_probes WHERE host_id = $1 AND at >= now() - interval '7 days' GROUP BY 1 ORDER BY 1`, [id])).rows;
  const flows = (await q.query(`SELECT f.dst_ip, f.dst_port, d.label AS dst_label, d.id AS dst_id, sum(f.conns)::int conns, max(f.at) last_at FROM infra_flows f LEFT JOIN infra_hosts d ON d.id = f.dst_host_id WHERE f.src_host_id = $1 AND f.at >= now() - interval '15 minutes' GROUP BY 1,2,3,4 ORDER BY conns DESC LIMIT 40`, [id])).rows;
  const inbound = (await q.query(`SELECT f.src_ip, s.label AS src_label, s.id AS src_id, f.dst_port, sum(f.conns)::int conns FROM infra_flows f LEFT JOIN infra_hosts s ON s.id = f.src_host_id WHERE f.dst_host_id = $1 AND f.at >= now() - interval '15 minutes' GROUP BY 1,2,3,4 ORDER BY conns DESC LIMIT 40`, [id])).rows;
  const changes = (await q.query(`SELECT * FROM infra_host_changes WHERE host_id = $1 ORDER BY at DESC LIMIT 50`, [id])).rows;
  return { host: h, probes, series, history, flows, inbound, changes };
}
/* the live map: per node the worst status of its hosts + averaged bars; per edge the flows between the nodes' hosts */
async function mapData(diagram) {
  const q = C(); const d = DIAGRAMS.find(x => x.key === diagram) || DIAGRAMS[0];
  const nodes = (await q.query(`SELECT * FROM infra_map_nodes WHERE diagram = $1`, [d.key])).rows;
  const hosts = (await q.query(`SELECT id, ip, ips, label, status, reachable, last_metrics, segment, role FROM infra_hosts WHERE enabled`)).rows;
  const byIp = new Map(); for (const h of hosts) for (const ip of h.ips || [h.ip]) byIp.set(ip, h);
  const out = {}; const hostNode = new Map();
  for (const n of nodes) { const hs = n.host_ips.map(ip => byIp.get(ip)).filter(Boolean); for (const h of hs) hostNode.set(h.id, n.node_id);
    const ms = hs.map(h => h.last_metrics || {}); const avg = k => { const v = ms.map(m => m[k]).filter(x => x != null); return v.length ? Math.round(10 * v.reduce((a, x) => a + x, 0) / v.length) / 10 : null; }; const sum = k => ms.reduce((a, m) => a + (Number(m[k]) || 0), 0);
    out[n.node_id] = { label: n.label, external: n.external, hosts: hs.map(h => ({ id: h.id, ip: h.ip, label: h.label, status: h.status, reachable: h.reachable })), status: hs.length ? worst(hs.map(h => h.status.toUpperCase())).toLowerCase() : (n.external ? 'external' : 'unknown'), cpu: avg('cpu_pct'), mem: avg('mem_pct'), disk: avg('disk_pct'), rx_bps: sum('rx_bps'), tx_bps: sum('tx_bps'), conns: sum('conns') }; }
  const { edges } = readNodes(d.file);
  const fl = (await q.query(`SELECT src_host_id, dst_host_id, sum(conns)::int conns, max(at) last_at, count(DISTINCT at)::int samples FROM infra_flows WHERE at >= now() - interval '5 minutes' AND dst_host_id IS NOT NULL GROUP BY 1,2`)).rows;
  const pair = {}; for (const f of fl) { const a = hostNode.get(f.src_host_id), b = hostNode.get(f.dst_host_id); if (!a || !b || a === b) continue; const k = a + '|' + b; const p = pair[k] = pair[k] || { conns: 0, last_at: null }; p.conns += Math.round(f.conns / Math.max(1, f.samples)); if (!p.last_at || f.last_at > p.last_at) p.last_at = f.last_at; }
  const edgeOut = edges.map((e, i) => { const fwd = pair[e.f + '|' + e.t], rev = pair[e.t + '|' + e.f]; const conns = (fwd ? fwd.conns : 0) + (rev ? rev.conns : 0); const a = out[e.f], b = out[e.t];
    const observable = !!(a && b && a.hosts.length && b.hosts.length && (a.hosts.some(h => h.reachable) || b.hosts.some(h => h.reachable)));
    return { i, f: e.f, t: e.t, conns, state: conns > 0 ? 'live' : observable ? 'quiet' : 'unobserved', last_at: (fwd && fwd.last_at) || (rev && rev.last_at) || null }; });
  const unmapped = (await q.query(`SELECT dst_ip, count(DISTINCT src_host_id)::int sources, sum(conns)::int conns FROM infra_flows WHERE at >= now() - interval '15 minutes' AND dst_host_id IS NULL AND dst_ip <> '127.0.0.1' GROUP BY 1 ORDER BY conns DESC LIMIT 30`)).rows;
  return { diagram: d.key, title: d.title, at: new Date().toISOString(), nodes: out, edges: edgeOut, unmapped, last_run: lastRun };
}

/* ------------------------------------------------------------------------------------------------------ metrics for the alert engine */
async function metric(kind, segment) {
  const q = C(); if (!q) return [];
  const seg = segment === 'fixed' ? ['fixed'] : ['mobile', 'shared'];
  const r = (await q.query(`SELECT h.id, h.label, h.ip, h.status, h.reachable, h.last_metrics FROM infra_hosts h WHERE h.enabled AND h.segment = ANY($1::text[])`, [seg])).rows;
  if (!r.length) return [];
  const M = h => h.last_metrics || {};
  /* the impacted hosts go into the alert message (" · hosts: label ip (why) …") so the incident row, the mail and the
   * agent triage name the servers without opening anything — the full table is the incident's Evidence */
  const th = CFG().th;
  const hostsNote = list => { if (!list.length) return {}; const top = list.slice(0, 6).map(([h, why]) => `${h.label || h.ip} ${h.ip}${why ? ' (' + why + ')' : ''}`); return { note: `hosts: ${top.join(', ')}${list.length > 6 ? ` +${list.length - 6} more` : ''}` }; };
  const pctList = (field, warn) => r.filter(h => M(h)[field] != null && M(h)[field] >= warn).sort((a, b) => M(b)[field] - M(a)[field]).map(h => [h, `${M(h)[field]} %${field === 'disk_pct' && (M(h).disks || []).length ? ' ' + ((M(h).disks || []).reduce((a, d) => (d.pct > (a ? a.pct : -1) ? d : a), null) || {}).mount : ''}`]);
  switch (kind) {
    case 'hosts_down': { const L = r.filter(h => h.reachable === false).map(h => [h, 'no answer']); return [{ dim: hostsNote(L), value: L.length, sample: r.length }]; }
    case 'ports_down': { const L = r.map(h => [h, (M(h).ports || []).filter(p => !p.ok).map(p => p.port)]).filter(([, p]) => p.length).map(([h, p]) => [h, 'port ' + p.join('/')]); const n = L.reduce((a, [, why]) => a + why.split('/').length, 0); return [{ dim: hostsNote(L), value: n, sample: r.reduce((a, h) => a + ((M(h).ports || []).length), 0) }]; }
    case 'disk_pct_max': { const v = r.map(h => M(h).disk_pct).filter(x => x != null); return v.length ? [{ dim: hostsNote(pctList('disk_pct', th.diskWarn)), value: Math.max(...v), sample: v.length }] : []; }
    case 'mem_pct_max': { const v = r.map(h => M(h).mem_pct).filter(x => x != null); return v.length ? [{ dim: hostsNote(pctList('mem_pct', th.memWarn)), value: Math.max(...v), sample: v.length }] : []; }
    case 'load_per_core_max': { const L = r.map(h => [h, M(h).load15 != null && M(h).nproc ? Math.round(100 * M(h).load15 / M(h).nproc) / 100 : null]).filter(([, x]) => x != null); return L.length ? [{ dim: hostsNote(L.filter(([, x]) => x >= th.loadWarn).sort((a, b) => b[1] - a[1]).map(([h, x]) => [h, `${x} / core`])), value: Math.max(...L.map(([, x]) => x)), sample: L.length }] : []; }
    case 'hosts_crit': { const L = r.filter(h => h.status === 'crit').map(h => [h, ((M(h).probes || []).filter(p => /CRIT/.test(p)).map(p => p.replace(/ CRIT$/, '')).slice(0, 2).join(' ')) || 'crit']); return [{ dim: hostsNote(L), value: L.length, sample: r.length }]; }
    default: return [];
  }
}
/* the "Affected cases" twin — the hosts behind the number */
async function cases(kind, segment) {
  const q = C(); const seg = segment === 'fixed' ? ['fixed'] : ['mobile', 'shared'];
  const r = (await q.query(`SELECT h.id, h.label, h.ip, h.segment, h.role, h.status, h.reachable, h.last_metrics, h.status_at FROM infra_hosts h WHERE h.enabled AND h.segment = ANY($1::text[]) ORDER BY h.status, h.label`, [seg])).rows;
  const M = h => h.last_metrics || {};
  const pick = r.filter(h => kind === 'hosts_down' ? h.reachable === false : kind === 'ports_down' ? (M(h).ports || []).some(p => !p.ok) : kind === 'disk_pct_max' ? (M(h).disk_pct || 0) >= CFG().th.diskWarn : kind === 'mem_pct_max' ? (M(h).mem_pct || 0) >= CFG().th.memWarn : kind === 'load_per_core_max' ? (M(h).nproc && M(h).load15 / M(h).nproc >= CFG().th.loadWarn) : h.status === 'crit');
  return pick.map(h => ({ host: h.label, ip: h.ip, segment: h.segment, role: h.role, status: h.status, reachable: h.reachable, cpu_pct: M(h).cpu_pct, mem_pct: M(h).mem_pct, disk_pct: M(h).disk_pct, load15: M(h).load15, ports_down: (M(h).ports || []).filter(p => !p.ok).map(p => p.port).join(' '), probes: (M(h).probes || []).join(' · '), since: h.status_at, link: `#infra?host=${h.id}` }));
}

/* ------------------------------------------------------------------------------------------------------ routes + start */
function mount(app, { requireView, requireCap, audit }) {
  const gate = requireView('noc'); const manage = requireCap ? requireCap('manageSync') : (req, res, next) => next();
  app.get('/api/infra/overview', gate, async (req, res) => { try { res.json(await overview()); } catch (e) { res.status(500).json({ error: e.message }); } });
  app.get('/api/infra/hosts/:id', gate, async (req, res) => { try { const d = await hostDetail(Number(req.params.id)); if (!d) return res.status(404).json({ error: 'no such host' }); res.json(d); } catch (e) { res.status(500).json({ error: e.message }); } });
  app.put('/api/infra/hosts/:id', gate, manage, async (req, res) => { try {
      const b = req.body || {}; const id = Number(req.params.id); const before = (await C().query(`SELECT * FROM infra_hosts WHERE id=$1`, [id])).rows[0]; if (!before) return res.status(404).json({ error: 'no such host' });
      const seg = ['mobile', 'fixed', 'shared'].includes(b.segment) ? b.segment : before.segment; const ports = Array.isArray(b.service_ports) ? b.service_ports.map(Number).filter(p => p > 0 && p < 65536).slice(0, 12) : before.service_ports;
      const portsEdited = Array.isArray(b.service_ports) && JSON.stringify(ports) !== JSON.stringify(before.service_ports);
      const r = await C().query(`UPDATE infra_hosts SET segment=$2, role=coalesce($3, role), label=coalesce($4, label), owner_team=coalesce($5, owner_team), notes=coalesce($6, notes), ssh=coalesce($7, ssh), service_ports=$8, enabled=coalesce($9, enabled), ips=CASE WHEN $10::text[] IS NULL THEN ips ELSE $10 END,
          ssh_via = CASE WHEN $11::text IS NULL THEN ssh_via ELSE nullif($11, '') END, ssh_user = CASE WHEN $12::text IS NULL THEN ssh_user ELSE nullif($12, '') END, ports_learned = ports_learned OR $13, updated_at=now() WHERE id=$1 RETURNING *`,
        [id, seg, b.role || null, b.label || null, b.owner_team || null, b.notes != null ? String(b.notes).slice(0, 500) : null, typeof b.ssh === 'boolean' ? b.ssh : null, ports, typeof b.enabled === 'boolean' ? b.enabled : null, Array.isArray(b.ips) ? b.ips.filter(x => /^\d+\.\d+\.\d+\.\d+$/.test(x)) : null,
          b.ssh_via != null ? String(b.ssh_via).trim().slice(0, 80) : null, b.ssh_user != null ? String(b.ssh_user).trim().slice(0, 40) : null, portsEdited]);
      await C().query(`INSERT INTO infra_host_changes (host_id, kind, field, before, after, note) VALUES ($1,'edit','host',$2,$3,$4)`, [id, JSON.stringify({ segment: before.segment, role: before.role, ports: before.service_ports, ssh: before.ssh, enabled: before.enabled }), JSON.stringify({ segment: seg, role: r.rows[0].role, ports, ssh: r.rows[0].ssh, enabled: r.rows[0].enabled }), 'by ' + req.actor]);
      if (audit) audit(req, 'infra.host.edit', String(id), b).catch?.(() => {}); res.json(r.rows[0]);
    } catch (e) { res.status(400).json({ error: e.message }); } });
  app.post('/api/infra/hosts', gate, manage, async (req, res) => { try {
      const b = req.body || {}; if (!/^\d+\.\d+\.\d+\.\d+$/.test(String(b.ip || ''))) return res.status(400).json({ error: 'ip required' });
      const r = await C().query(`INSERT INTO infra_hosts (ip, ips, segment, role, label, source, service_ports, ssh, ssh_via, diagram, node_id) VALUES ($1, ARRAY[$1], $2, $3, $4, 'manual', $5, $6, $7, $8, $9) ON CONFLICT (ip) DO UPDATE SET label = EXCLUDED.label, ssh = EXCLUDED.ssh, ssh_via = coalesce(EXCLUDED.ssh_via, infra_hosts.ssh_via), enabled = true RETURNING *`,
        [b.ip, ['mobile', 'fixed', 'shared'].includes(b.segment) ? b.segment : 'shared', b.role || 'other', b.label || b.ip, Array.isArray(b.service_ports) ? b.service_ports.map(Number).filter(p => p > 0) : [], !!b.ssh, b.ssh_via ? String(b.ssh_via).trim().slice(0, 80) : null, b.diagram || null, b.node_id || null]);
      if (b.diagram && b.node_id) await C().query(`UPDATE infra_map_nodes SET host_ips = array_append(array_remove(host_ips, $3), $3), updated_at = now() WHERE diagram = $1 AND node_id = $2`, [b.diagram, b.node_id, b.ip]);
      if (audit) audit(req, 'infra.host.add', b.ip, b).catch?.(() => {}); res.json(r.rows[0]);
    } catch (e) { res.status(400).json({ error: e.message }); } });
  app.get('/api/infra/map', gate, async (req, res) => { try { res.json(await mapData(String(req.query.diagram || 'mvno'))); } catch (e) { res.status(500).json({ error: e.message }); } });
  app.put('/api/infra/map/:diagram/:node', gate, manage, async (req, res) => { try {
      const ips = Array.isArray((req.body || {}).host_ips) ? req.body.host_ips.filter(x => /^\d+\.\d+\.\d+\.\d+$/.test(x)) : [];
      const r = await C().query(`UPDATE infra_map_nodes SET host_ips = $3, updated_at = now() WHERE diagram = $1 AND node_id = $2 RETURNING *`, [req.params.diagram, req.params.node, ips]); if (!r.rowCount) return res.status(404).json({ error: 'no such node' });
      for (const ip of ips) await C().query(`INSERT INTO infra_hosts (ip, ips, segment, role, label, diagram, node_id, source) VALUES ($1, ARRAY[$1], $2, 'other', $3, $4, $5, 'manual') ON CONFLICT (ip) DO NOTHING`, [ip, req.params.diagram === 'fixed' ? 'fixed' : 'mobile', r.rows[0].label + ' · ' + ip.split('.').pop(), req.params.diagram, req.params.node]);
      if (audit) audit(req, 'infra.map.bind', req.params.node, { ips }).catch?.(() => {}); res.json(r.rows[0]);
    } catch (e) { res.status(400).json({ error: e.message }); } });
  app.get('/api/infra/changes', gate, async (req, res) => { try { res.json({ rows: (await C().query(`SELECT c.*, h.label, h.ip, h.segment FROM infra_host_changes c JOIN infra_hosts h ON h.id = c.host_id WHERE c.at >= now() - ($1||' days')::interval ORDER BY c.at DESC LIMIT 500`, [String(Math.min(90, Number(req.query.days) || 7))])).rows }); } catch (e) { res.status(500).json({ error: e.message }); } });
  app.post('/api/infra/run', gate, manage, async (req, res) => { try { if (busy) return res.json({ running: true }); const out = await tick({ inventory: !!(req.body || {}).inventory, force: !!(req.body || {}).inventory }); if (audit) audit(req, 'infra.run', null, { inventory: !!(req.body || {}).inventory }).catch?.(() => {}); res.json(out); } catch (e) { res.status(500).json({ error: e.message }); } });
  app.post('/api/infra/discover', gate, manage, async (req, res) => { try { const out = await discover({ all: !!(req.body || {}).all }); if (audit) audit(req, 'infra.discover', null, { tried: out.tried, found: out.found, newly: out.newly }).catch?.(() => {}); res.json(out); } catch (e) { res.status(500).json({ error: e.message }); } });
  app.post('/api/infra/seed', gate, manage, async (req, res) => { try { await ensureSchema(); res.json(await seedFromDiagrams()); } catch (e) { res.status(500).json({ error: e.message }); } });
}
function start() {
  const c = CFG(); if (!c.enabled || !C()) { log('disabled'); return; }
  setTimeout(async () => { try { await ensureSchema(); await seedFromDiagrams(); await tick({ inventory: true }); } catch (e) { log('boot', e.message); } setInterval(() => tick().catch(() => {}), c.intervalSec * 1000); }, 70000);
  log(`armed: every ${c.intervalSec} s · inventory every ${c.inventoryHours} h · ssh ${c.sshUser || c.sshKey ? 'on' : 'off'} · instana ${c.instanaUrl && c.instanaToken ? 'on' : 'off'}`);
}
module.exports = { ensureSchema, seedFromDiagrams, discover, tick, overview, hostDetail, mapData, metric, cases, mount, start, ipsOf, parseMetrics, parseInventory, DIAGRAMS };
