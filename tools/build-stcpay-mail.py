#!/usr/bin/env python3
"""Business-owner mail for the STC Pay / HyperPay window. Usage: python3 tools/build-stcpay-mail.py docs/stcpay-report.json docs/mails/STC-Pay-HyperPay-window-report.html"""
import json, sys, datetime as dt
from collections import defaultdict
src = sys.argv[1] if len(sys.argv) > 1 else 'docs/stcpay-report.json'
out = sys.argv[2] if len(sys.argv) > 2 else 'docs/mails/STC-Pay-HyperPay-window-report.html'
J = json.load(open(src))
def ksa(iso): return (dt.datetime.fromisoformat(iso.replace('Z', '+00:00')) + dt.timedelta(hours=3)).strftime('%A %d %B %Y %H:%M') + ' KSA'
FROM, TO = ksa(J['window']['from']), ksa(J['window']['to'])
hp = [d for d in J['daily'] if d['vendor'] == 'hyperpay']
att = sum(d['stc_attempts'] for d in hp); ok = sum(d['stc_ok'] for d in hp); fail = sum(d['stc_fail'] for d in hp)
amt = sum(float(d['stc_fail_amount'] or 0) for d in hp)
cust = J['recovered']['failed_customers']; rec = J['recovered']['later_paid_other_rail']; lost = cust - rec
other = [r for r in J['rails'] if 'stc' not in r['rail'] and r['ok'] + r['fail'] > 0]
o_ok = sum(r['ok'] for r in other); o_f = sum(r['fail'] for r in other)
top = J['reasons'][0]
peak = max(hp, key=lambda d: d['stc_fail'])
plat = {p['platform']: p['attempts'] for p in J['byPlatform']}
purp = J['byPurpose']
retry3 = sum(x['customers'] for x in J['retries'] if x['tries'] >= 3)
base = defaultdict(lambda: [0, 0, 0])
for x in J['baseline_before']:
    b = base[x['vendor']]; b[0] += x['attempts']; b[1] += x['ok']; b[2] += x['fail']
upg = base['salam']; upg_rate = upg[2] / (upg[1] + upg[2]) if upg[1] + upg[2] else 0
n = lambda v: f'{v:,.0f}'
pct = lambda a, b: f'{(a / b * 100 if b else 0):.1f}%'
G = '#0b3d2b'; A = '#0e9f5a'; R = '#b42318'
days_html = ''.join(f"<tr><td style='padding:6px 10px;border-bottom:1px solid #e3e7e5'>{dt.date.fromisoformat(d['day']).strftime('%a %d %b')}</td><td style='padding:6px 10px;border-bottom:1px solid #e3e7e5;text-align:right'>{n(d['stc_attempts'])}</td><td style='padding:6px 10px;border-bottom:1px solid #e3e7e5;text-align:right;color:{R};font-weight:700'>{n(d['stc_fail'])}</td><td style='padding:6px 10px;border-bottom:1px solid #e3e7e5;text-align:right'>{pct(d['stc_fail'], d['stc_ok'] + d['stc_fail'])}</td><td style='padding:6px 10px;border-bottom:1px solid #e3e7e5;text-align:right'>{n(d['stc_fail_customers'])}</td><td style='padding:6px 10px;border-bottom:1px solid #e3e7e5;text-align:right'>{n(float(d['stc_fail_amount'] or 0))}</td></tr>" for d in hp)
purp_html = ''.join(f"<tr><td style='padding:6px 10px;border-bottom:1px solid #e3e7e5'>{p['purpose']}</td><td style='padding:6px 10px;border-bottom:1px solid #e3e7e5;text-align:right'>{n(p['attempts'])}</td><td style='padding:6px 10px;border-bottom:1px solid #e3e7e5;text-align:right'>{n(float(p['fail_amount'] or 0))}</td></tr>" for p in purp)
subject = f'STC Pay unavailable on HyperPay, {dt.date.fromisoformat(hp[0]["day"]).strftime("%d")}–{dt.date.fromisoformat(hp[-1]["day"]).strftime("%d %b %Y")} — {n(att)} failed attempts, {n(cust)} customers, full case list attached'
def box(title, body, bg='#f7faf8'):
    return f"<table role='presentation' width='100%' cellpadding='0' cellspacing='0' style='border-collapse:collapse;margin:14px 0'><tr><td style='background:{G};color:#fff;padding:11px 16px;border-radius:10px 10px 0 0;font-weight:700;font-size:13px;letter-spacing:.04em'>{title}</td></tr><tr><td style='border:1px solid #e3e7e5;border-top:0;border-radius:0 0 10px 10px;padding:14px 16px;background:{bg}'>{body}</td></tr></table>"
def kpi(v, l, c=G):
    return f"<td style='padding:6px'><div style='border:1px solid #e3e7e5;border-radius:10px;padding:12px 10px;text-align:center;background:#fff'><div style='font-size:22px;font-weight:800;color:{c}'>{v}</div><div style='font-size:12px;color:#5b6b64'>{l}</div></div></td>"
th = lambda t, right=False: f"<th style='text-align:{'right' if right else 'left'};padding:7px 10px;background:#eef3f0;border-bottom:2px solid #cfd8d3;font-size:12px'>{t}</th>"
html = f"""<!DOCTYPE html><html><head><meta charset="utf-8"><title>{subject}</title></head>
<body style="margin:0;padding:0;background:#ffffff;font-family:-apple-system,'Segoe UI',Arial,sans-serif;font-size:14px;line-height:1.6;color:#20302a"><div style="max-width:860px;margin:0 auto;padding:8px 4px">
<p><b>Subject:</b> {subject}</p>
<p>Dear [Business owner],</p>
<p>As agreed, here is the complete picture of the STC Pay failures during the period when <b>UPG and Tap were switched off and HyperPay was our only customer payment gateway</b> — from <b>{FROM}</b> to <b>{TO}</b>, when we re-enabled UPG to stop the customer impact and the call-centre complaints. The attached workbook <b>STC-Pay-HyperPay-window-2026-09.xlsx</b> contains every single case (masked mobile, date/time, amount, purpose, HyperPay reference and result code), a daily failure chart, the hourly profile and the 7-day baseline before the change. All figures come from the production payments data.</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse"><tr>{kpi(n(att), 'STC Pay attempts', R)}{kpi(pct(fail, ok + fail), 'declined (0 successful)', R)}{kpi(n(cust), 'distinct customers affected')}{kpi('SAR ' + n(amt), 'attempted and declined')}</tr></table>
{box('WHAT HAPPENED', f"From the moment HyperPay became the only gateway, <b>every STC Pay payment was declined</b>: {n(att)} attempts, {n(ok)} successes. HyperPay returned result code <b>{top['code']} — “{top['reason']}”</b> on {n(top['n'])} of them ({pct(top['n'], fail)}): the request was rejected at the acquirer/connector configuration <b>before the customer ever saw the STC Pay OTP screen</b>, so from the customer's side the wallet simply “did not work”. The other HyperPay rails were healthy in the same window (mada / Visa / Mastercard: {n(o_ok)} successful payments, {pct(o_f, o_ok + o_f)} declined — ordinary customer declines, not a zero-success failure), which confirms the problem was specific to the STC Pay integration on HyperPay and not to HyperPay as a whole. The peak was <b>{dt.date.fromisoformat(peak['day']).strftime('%A %d %B')}</b> with {n(peak['stc_fail'])} declined attempts from {n(peak['stc_fail_customers'])} customers.")}
{box('CUSTOMER IMPACT', f"<b>{n(cust)} customers</b> tried to pay with STC Pay and were declined; <b>{n(retry3)}</b> of them retried three times or more (customers averaged {att / cust:.1f} attempts each), which is what drove the call-centre load. <b>{n(rec)} customers ({pct(rec, cust)})</b> eventually paid with another method (mada, card or UPG after the re-enable). <b>{n(lost)} customers ({pct(lost, cust)})</b> have no successful payment on record after their failure — this is the group we recommend Marketing / Care reach out to. By platform: Android {n(plat.get('android', 0))}, Web {n(plat.get('web', 0))}, iOS {n(plat.get('ios', 0))} attempts. Recharge was by far the most affected purpose.", '#fff7f5')}
<p style="font-weight:800;font-size:13px;letter-spacing:.05em;color:{G};margin:18px 0 6px">DAILY VIEW (KSA days)</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:13px"><tr>{th('Day')}{th('STC Pay attempts', 1)}{th('Declined', 1)}{th('Fail rate', 1)}{th('Customers', 1)}{th('Amount (SAR)', 1)}</tr>{days_html}
<tr><td style='padding:7px 10px;font-weight:700'>Total</td><td style='padding:7px 10px;text-align:right;font-weight:700'>{n(att)}</td><td style='padding:7px 10px;text-align:right;font-weight:700;color:{R}'>{n(fail)}</td><td style='padding:7px 10px;text-align:right;font-weight:700'>{pct(fail, ok + fail)}</td><td style='padding:7px 10px;text-align:right;font-weight:700'>{n(cust)} distinct</td><td style='padding:7px 10px;text-align:right;font-weight:700'>{n(amt)}</td></tr></table>
<p style="font-size:12px;color:#5b6b64;margin:4px 0 0">3 Sep counts from 16:27 KSA; 10 Sep counts until 18:10 KSA. “Customers” per day are distinct within that day; the total is distinct over the whole window.</p>
<p style="font-weight:800;font-size:13px;letter-spacing:.05em;color:{G};margin:18px 0 6px">BY PAYMENT PURPOSE</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:13px"><tr>{th('Purpose')}{th('Declined attempts', 1)}{th('Amount attempted (SAR)', 1)}</tr>{purp_html}</table>
{box('BASELINE BEFORE THE CHANGE', f"In the 7 days before the cutover (27 Aug → 3 Sep 16:27 KSA) UPG processed {n(upg[0])} payments with {n(upg[1])} successes and a {upg_rate * 100:.1f}% decline rate — ordinary customer declines (insufficient balance, wrong OTP), not a gateway fault. HyperPay carried very little customer traffic before 3 Sep (a few hundred payments on 31 Aug), so the STC Pay rail on HyperPay had not been exercised at production volume before the switch.")}
{box('ACTIONS TAKEN AND NEXT STEPS', f"<b>Done:</b> UPG re-enabled on {TO}, restoring STC Pay for customers through UPG; HyperPay kept for cards. <b>Open with HyperPay:</b> root cause and fix of the STC Pay connector configuration (result code {top['code']}), with a written confirmation and a controlled test before STC Pay is ever routed to HyperPay again. <b>Proposed:</b> (1) targeted communication / recharge offer to the {n(lost)} customers not recovered; (2) a per-rail payment alert on the Operations Console — any rail with a high attempt volume and zero successes over 15 minutes pages Digital Operations, so a silent failure of this kind is caught within minutes rather than through call-centre volume; (3) any future gateway switch to run as a phased ramp (5% → 25% → 100%) with per-rail success checks at each step.")}
<p>The Cases sheet in the workbook lists all {n(att)} attempts individually; full customer identifiers can be provided on request through the Operations Console. I remain available to walk through the numbers.</p>
<p>Best regards,<br><b>Yosri A. Yahmed</b><br>Head of Digital Operations, Salam</p>
<p style="font-size:11px;color:#8a9691;margin-top:20px">Source: Salam selfcare payments (production replica), extracted {ksa(J['generated_at'])} by the Operations Console. Attachment: STC-Pay-HyperPay-window-2026-09.xlsx (Summary · Daily with chart · Hourly · Cases · Baseline · Method).</p>
</div></body></html>"""
open(out, 'w').write(html); print('wrote', out, '| subject:', subject)
