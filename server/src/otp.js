/* Email OTP for sign-in — same pattern as the dealers ops console.
 *  - dev/local (no SMTP configured): the code is logged to the server console and
 *    stored in login_otps (readable from logs or DB), and returned in the response
 *    so local sign-in works without a mail server.
 *  - prod (SMTP_* env set): the code is emailed via SMTP; never returned in the API.
 * Env: SMTP_HOST, SMTP_PORT (587), SMTP_SECURE (false), SMTP_USER, SMTP_PASS, SMTP_FROM
 */
const db = require('./db');
const CODE_TTL_MIN = 10;
const MAX_PER_10MIN = 5;

const smtpConfigured = () => !!process.env.SMTP_HOST;   // auth optional (local relays / Mailpit)
const gen = () => String(Math.floor(100000 + Math.random() * 900000));

async function requestOtp(email) {
  // basic rate limit
  const rl = await db.console.query(
    `SELECT count(*)::int c FROM login_otps WHERE email=$1 AND created_at > now()-interval '10 minutes'`, [email]);
  if (rl.rows[0].c >= MAX_PER_10MIN) return { error: 'Too many codes requested. Try again in a few minutes.' };

  const code = gen();
  await db.console.query(
    `INSERT INTO login_otps (email, code, expires_at) VALUES ($1,$2, now()+($3||' minutes')::interval)`,
    [email, code, CODE_TTL_MIN]);

  console.log(`[OTP] sign-in code for ${email}: ${code} (expires ${CODE_TTL_MIN}m)`);

  if (smtpConfigured()) {
    try { await sendMail(email, code); return { sent: true }; }
    // mail failure is NOT fatal: the code was generated + stored (and is in the server log),
    // so let the user proceed to the code screen — an admin can read the code out.
    catch (e) { console.error('[OTP] SMTP send failed:', e.message); return { sent: false, mailError: true }; }
  }
  // dev: expose the code so local sign-in works (read from logs/DB in real dev too)
  return { sent: false, dev: true, devCode: code };
}

async function verifyOtp(email, code) {
  const r = await db.console.query(
    `SELECT id FROM login_otps WHERE email=$1 AND code=$2 AND consumed=false AND expires_at>now()
     ORDER BY id DESC LIMIT 1`, [email, String(code).trim()]);
  if (!r.rowCount) return false;
  await db.console.query(`UPDATE login_otps SET consumed=true WHERE id=$1`, [r.rows[0].id]);
  return true;
}

async function sendMail(email, code) {
  // same shell as every other console mail (notify.shell = the Undertaking Consent System template)
  const notify = require('./notify');
  const text = `Your sign-in code is: ${code}\n\nIt is valid for ${CODE_TTL_MIN} minutes. Never share it.\nIf you did not request this, contact the Digital Operations team.`;
  const r = await notify.sendText([email], 'Salam Operations Console — sign-in code', text, { title: 'sign-in code' });
  if (!r.sent && r.error) throw new Error(r.error);
  if (!r.sent && r.dev) throw new Error('SMTP not configured');
}

module.exports = { requestOtp, verifyOtp, smtpConfigured, CODE_TTL_MIN };
