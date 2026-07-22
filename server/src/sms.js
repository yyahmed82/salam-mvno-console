/* SMS via Unifonic REST (el.cloud.unifonic.com/rest/SMS/messages).
 * Credentials come from ENV (secret — never store the AppSid in the DB/UI):
 *   SMS_URL, SMS_APPSID, SMS_SENDER (default 'Salam'), SMS_TO (default recipients, comma-separated)
 * The enable toggle / recipient list / min-severity live in the chatops config (UI-editable).
 * Recipients must be international, no '+', e.g. 966535713989. */
const smsConfigured = () => !!(process.env.SMS_URL && process.env.SMS_APPSID);

async function sendSms(body, opts = {}) {
  const url = process.env.SMS_URL, appsid = process.env.SMS_APPSID, sender = process.env.SMS_SENDER || 'Salam';
  const to = String(opts.to || process.env.SMS_TO || '').split(/[,\s]+/).map(s => s.trim().replace(/^\+/, '')).filter(Boolean);
  if (!url || !appsid) return { sent: false, reason: 'SMS not configured (SMS_URL / SMS_APPSID env missing)' };
  if (!to.length) return { sent: false, reason: 'no SMS recipients' };
  if (typeof fetch !== 'function') return { sent: false, reason: 'global fetch unavailable (needs Node 18+)' };
  const text = String(body || '').slice(0, 600);
  const results = [];
  for (const rcpt of to) {
    const params = new URLSearchParams({ AppSid: appsid, SenderID: sender, Body: text, Recipient: rcpt });
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: params.toString() });
      const t = await r.text().catch(() => '');
      results.push({ to: rcpt, ok: r.ok, status: r.status, body: t.slice(0, 160) });
    } catch (e) { results.push({ to: rcpt, ok: false, error: e.message }); }
  }
  return { sent: results.some(x => x.ok), results };
}

module.exports = { sendSms, smsConfigured };
