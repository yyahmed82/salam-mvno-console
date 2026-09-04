#!/usr/bin/env node
/* SMTP end-to-end test for the Digital Console — run ON 152.
 *
 *   sudo su -
 *   cd /apps/console/server && set -a; . ../.env; set +a
 *   node /apps/console/server/test-smtp.cjs                        # dry run: transcript only, sends nothing
 *   node /apps/console/server/test-smtp.cjs --to you@salam.sa      # also sends a real message via nodemailer
 *   node /apps/console/server/test-smtp.cjs --from digital-noreply@salam.sa   # test a sender before
 *                                                                 # putting it in .env
 *
 * NOTE ON SENDERS: FortiMail validates the ENVELOPE SENDER, and it rejects at RCPT TO — so an
 * unauthorised sender looks like a recipient/relay problem. If infra authorises a specific address,
 * SMTP_FROM must use exactly that address or nothing changes.
 *
 * Two independent layers, because they fail differently:
 *   A. RAW SMTP conversation — every command labelled with ITS OWN response. Shows exactly which
 *      verb the relay rejects (this is where FortiMail returned 554 at RCPT TO, not at MAIL FROM).
 *   B. NODEMAILER using the app's real config — catches problems the raw test cannot see, e.g. a
 *      quoted SMTP_FROM, TLS options, or a display-name the relay rejects.
 *
 * Sends nothing unless --to is given. Safe to run during an incident.
 */
process.env.TZ = 'UTC';
const net = require('net');
const tls = require('tls');

const A = n => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : null; };
const HOST = A('--host') || process.env.SMTP_HOST;
const PORT = Number(A('--port') || process.env.SMTP_PORT || 25);
const TO   = A('--to');
// --from lets you PROVE a newly-authorised sender before committing it to .env.
// Order matters: test first, configure second. Editing .env on a promise costs a restart to undo.
const RAW_FROM = A('--from') || process.env.SMTP_FROM || 'Salam Digital Console <noreply@salam.sa>';
// Envelope sender = the bare address. A display name is header-only; putting it in MAIL FROM is
// invalid SMTP and some relays reject it — a subtle way to fail while "the address looks right".
const ENVELOPE = (RAW_FROM.match(/<([^>]+)>/) || [null, RAW_FROM.trim()])[1];

const C = { g: s => `\x1b[32m${s}\x1b[0m`, r: s => `\x1b[31m${s}\x1b[0m`, y: s => `\x1b[33m${s}\x1b[0m`,
            b: s => `\x1b[1m${s}\x1b[0m`, d: s => `\x1b[2m${s}\x1b[0m`, c: s => `\x1b[36m${s}\x1b[0m` };
const head = t => console.log('\n' + C.b(t) + '\n' + '─'.repeat(t.length));
let fails = 0;
const ok   = (l, d) => console.log(`  ${C.g('OK  ')} ${l}${d ? C.d('  — ' + d) : ''}`);
const bad  = (l, d) => { fails++; console.log(`  ${C.r('FAIL')} ${l}${d ? C.d('  — ' + d) : ''}`); };
const note = (l, d) => console.log(`  ${C.y('NOTE')} ${l}${d ? C.d('  — ' + d) : ''}`);

if (!HOST) { console.error('SMTP_HOST not set — source /apps/console/.env first.'); process.exit(2); }

/* Speak SMTP by hand so every response is attributed to the command that caused it.
 * (Getting this wrong once made a rejected RCPT look like an accepted one.) */
function talk(sock, steps) {
  return new Promise(resolve => {
    const log = [];
    let buf = '', i = -1, greeted = false, done = false;
    const finish = () => { if (done) return; done = true; try { sock.end(); } catch (e) {} resolve(log); };
    sock.setTimeout(15000);
    sock.on('timeout', () => { log.push({ cmd: i < 0 ? '(greeting)' : steps[i], resp: '(timeout)', code: 0 }); finish(); });
    sock.on('error', e => { log.push({ cmd: i < 0 ? '(connect)' : steps[i], resp: e.message, code: 0 }); finish(); });
    sock.on('close', finish);
    sock.on('data', d => {
      buf += d.toString();
      // An SMTP reply may span lines: continuations are "250-", the FINAL line is "250 " (space).
      // So: complete only when the last complete line starts with three digits AND a space.
      const lines = buf.split(/\r?\n/).filter(l => l.length);
      const last = lines[lines.length - 1];
      if (!last || !/^\d{3} /.test(last) || !/\r?\n$/.test(buf)) return;
      const resp = buf.trim(); buf = '';
      const code = Number((resp.match(/^(\d{3})/m) || [0, 0])[1]);
      log.push({ cmd: greeted ? steps[i] : '(server greeting)', resp, code });
      greeted = true;
      i++;
      if (i >= steps.length) return finish();
      sock.write(steps[i] + '\r\n');
    });
  });
}

const show = log => log.forEach(x => {
  const first = x.resp.split('\n')[0];
  const good = x.code >= 200 && x.code < 400;
  console.log(`  ${good ? C.g(String(x.code || '---')) : C.r(String(x.code || 'ERR'))}  ` +
              `${C.c((x.cmd || '').padEnd(34))} ${C.d(first)}`);
});

(async () => {
  console.log(`SMTP target ${C.b(HOST + ':' + PORT)}`);
  console.log(`SMTP_FROM   ${RAW_FROM}`);
  console.log(`envelope    ${C.b(ENVELOPE)} ${C.d('(display name is header-only, never in MAIL FROM)')}`);
  if (RAW_FROM !== RAW_FROM.trim() || /^["']|["']$/.test(RAW_FROM))
    note('SMTP_FROM still has surrounding quotes', 'loadEnv should strip them — check /apps/console/.env');

  head('0 · TCP reachability');
  const reach = await new Promise(res => {
    const t0 = Date.now(), s = net.connect({ host: HOST, port: PORT });
    s.setTimeout(6000);
    s.on('connect', () => { s.destroy(); res({ ok: true, ms: Date.now() - t0 }); });
    s.on('timeout', () => { s.destroy(); res({ ok: false, why: 'timeout (firewalled / no route)' }); });
    s.on('error', e => res({ ok: false, why: e.code || e.message }));
  });
  reach.ok ? ok(`${HOST}:${PORT} reachable`, reach.ms + 'ms')
           : bad(`${HOST}:${PORT} NOT reachable`, reach.why);
  if (!reach.ok) { console.log('\n' + C.r('Stop here — this is a network problem, not an SMTP one.')); process.exit(1); }

  head('1 · capabilities (EHLO)');
  let log = await talk(net.connect({ host: HOST, port: PORT }), ['EHLO console.salam.sa', 'QUIT']);
  show(log);
  const ehlo = (log.find(x => (x.cmd || '').startsWith('EHLO')) || {}).resp || '';
  const has = k => new RegExp('^250[ -]' + k, 'im').test(ehlo);
  console.log('');
  has('STARTTLS') ? ok('STARTTLS offered') : note('no STARTTLS', 'plain SMTP only — set SMTP_IGNORE_TLS=true');
  has('AUTH') ? note('AUTH offered', 'relay may expect credentials (SMTP_USER / SMTP_PASS)')
              : ok('no AUTH required', 'IP-based relay — the sender/recipient policy is what gates us');

  head('2 · envelope test — WHICH verb does the relay reject?');
  // NEVER default the recipient to the envelope sender: a no-reply address is send-only, so the
  // relay answers "550 5.1.1 User unknown" and the test looks broken when the relay is fine.
  const rcpt = TO || process.env.CONSOLE_ADMIN_USER || null;
  if (!rcpt) {
    note('no recipient to test', 'pass --to you@salam.sa (or set CONSOLE_ADMIN_USER) — '
      + 'testing RCPT TO against a no-reply sender always fails and tells you nothing');
    process.exit(fails ? 1 : 0);
  }
  console.log(C.d(`  recipient under test: ${rcpt}\n`));
  log = await talk(net.connect({ host: HOST, port: PORT }), [
    'EHLO console.salam.sa', `MAIL FROM:<${ENVELOPE}>`, `RCPT TO:<${rcpt}>`, 'RSET', 'QUIT']);
  show(log);
  const at = v => log.find(x => (x.cmd || '').toUpperCase().startsWith(v)) || {};
  const mf = at('MAIL FROM'), rc = at('RCPT TO');
  console.log('');
  mf.code === 250 ? ok('MAIL FROM accepted', ENVELOPE)
                  : bad('MAIL FROM rejected', `${mf.code} — the relay will not accept this SENDER`);
  if (rc.code === 250) ok('RCPT TO accepted', `${rcpt} — relay will carry mail for this recipient`);
  else {
    const line = String(rc.resp || '').split('\n')[0];
    bad('RCPT TO rejected', `${rc.code} ${line}`);
    // The enhanced status code says WHOSE fault it is. Conflating these sends you to the wrong team.
    const enh = (line.match(/\b(\d\.\d\.\d)\b/) || [])[1] || '';
    if (/^5\.1\./.test(enh))
      note('RECIPIENT does not exist', `"${rcpt}" is not a real mailbox. Nothing is wrong with the `
        + 'relay or the sender — retry with a real inbox: --to you@salam.sa');
    else if (/^5\.7\./.test(enh))
      note('POLICY refusal', 'the relay accepted the sender but will not RELAY for this host/sender. '
        + 'Infra must permit relay from this server IP and authorise the sender address. '
        + 'NOT a credentials or TLS problem.');
    else if (/^4\./.test(String(rc.code)))
      note('TEMPORARY failure', 'greylisting or a transient relay condition — retry in a few minutes.');
    else
      note('unclassified rejection', 'quote the full line above to infra.');
  }

  head('3 · the app\'s own mailer (nodemailer, real config)');
  let nodemailer;
  try { nodemailer = require('nodemailer'); }
  catch (e) { note('nodemailer not resolvable here', 'run from /apps/console/server'); process.exit(fails ? 1 : 0); }
  const t = nodemailer.createTransport({
    host: HOST, port: PORT,
    secure: process.env.SMTP_SECURE === 'true',
    ignoreTLS: process.env.SMTP_IGNORE_TLS === 'true',
    tls: process.env.SMTP_TLS_REJECT_UNAUTHORIZED === 'false' ? { rejectUnauthorized: false } : undefined,
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
    connectionTimeout: 15000, greetingTimeout: 10000
  });
  try { await t.verify(); ok('transport verified', 'same options the console uses at runtime'); }
  catch (e) { bad('transport verify failed', e.message); }

  if (!TO) {
    note('no message sent', 'add --to you@salam.sa to send a real test email');
  } else {
    try {
      const info = await t.sendMail({
        from: RAW_FROM, to: TO,
        subject: 'Salam Digital Console — SMTP test',
        text: `SMTP test from ${require('os').hostname()} via ${HOST}:${PORT} at ${new Date().toISOString()}.\n`
            + 'If you are reading this, console sign-in codes will deliver.'
      });
      ok('message accepted by the relay', info.messageId || '');
      console.log(C.d('    ' + (info.response || '')));
      note('accepted ≠ delivered', 'confirm it actually lands in the inbox — the relay may still drop or quarantine it');
    } catch (e) { bad('send failed', e.message); }
  }

  head('verdict');
  console.log(fails === 0
    ? C.g('  ✓ SMTP path is working from this host')
    : C.r(`  ✗ ${fails} problem(s) — see section 2 for which SMTP verb is refused`));
  console.log(C.d('  Reminder: OTP codes are ALWAYS written to the log, so sign-in works even with SMTP down:'));
  console.log(C.d('    grep "sign-in code" /apps/console/logs/console.out.log | tail -3\n'));
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('test aborted: ' + e.message); process.exit(2); });
