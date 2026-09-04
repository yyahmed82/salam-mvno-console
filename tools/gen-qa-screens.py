#!/usr/bin/env python3
"""Generate the Quick-Actions phone-screen artwork for the App-screens-flow panel.

WHY GENERATED, NOT FIGMA: the earlier journeys' backgrounds (pp_/ap_/cp_/ns_/mnp_/rc_) were
never Figma exports either — they are 420x840 mockups drawn to one visual system and saved in
assets/screens/. The Figma MCP needs edit access this account does not have, and the panel only
needs a recognisable screen, not a pixel-perfect one. Every file this script writes can later be
REPLACED file-for-file by a real Figma export with zero code change — the panel loads by name.

STYLE = the real web app (my.salammobile.sa screenshots, 24 Aug 2026): white content on a
dark-green header bar, rounded light-grey inputs, pill-shaped Salam-green CTAs; error/pending
states are the dark modal screens with the red X / amber clock the app actually shows.

Usage:  python3 tools/gen-qa-screens.py          # writes assets/screens/<journey>_<step>.png
Idempotent — reruns overwrite.
"""
import os
import cairosvg

OUT = os.path.join(os.path.dirname(__file__), '..', 'assets', 'screens')
W, H = 420, 840
GREEN = '#0e9f5a'; DARK = '#0b3b2e'; INK = '#11241d'; MUTED = '#5f6f69'
LINE = '#e5eae7'; FIELD = '#f4f6f5'; NAVY = '#0f1a24'; RED = '#e5484d'; AMBER = '#d97706'

def esc(s): return s.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')

def statusbar(dark=False):
    c = '#ffffff' if dark else INK
    return (f'<text x="34" y="46" font-size="17" font-weight="700" fill="{c}" '
            f'font-family="Helvetica">9:41</text>'
            f'<rect x="{W-70}" y="32" width="34" height="16" rx="4" fill="none" stroke="{c}" stroke-width="2"/>'
            f'<rect x="{W-67}" y="35" width="24" height="10" rx="2" fill="{c}"/>')

def header(title):
    return (f'<rect x="0" y="0" width="{W}" height="120" fill="{DARK}"/>'
            + statusbar(dark=True) +
            f'<text x="34" y="97" font-size="24" fill="#ffffff" font-family="Helvetica">‹</text>'
            f'<text x="60" y="95" font-size="20" font-weight="700" fill="#ffffff" font-family="Helvetica">{esc(title)}</text>')

def field(y, label, filled=None, w=W-68):
    v = filled or label
    col = INK if filled else '#9aa7a1'
    return (f'<rect x="34" y="{y}" width="{w}" height="62" rx="12" fill="{FIELD}" stroke="{LINE}"/>'
            f'<text x="52" y="{y+38}" font-size="16" fill="{col}" font-family="Helvetica">{esc(v)}</text>')

def cta(y, label, enabled=True, w=W-120):
    x = (W - w) / 2
    fill = GREEN if enabled else '#9db4aa'
    return (f'<rect x="{x}" y="{y}" width="{w}" height="58" rx="29" fill="{fill}"/>'
            f'<text x="{W/2}" y="{y+37}" font-size="17" font-weight="700" fill="#ffffff" '
            f'text-anchor="middle" font-family="Helvetica">{esc(label)}</text>')

def option_row(y, label):
    return (f'<rect x="34" y="{y}" width="{W-68}" height="64" rx="12" fill="#ffffff" stroke="{LINE}"/>'
            f'<circle cx="62" cy="{y+32}" r="11" fill="#e8f5ee"/>'
            f'<text x="88" y="{y+39}" font-size="16" font-weight="700" fill="{INK}" font-family="Helvetica">{esc(label)}</text>'
            f'<text x="{W-52}" y="{y+39}" font-size="16" fill="{GREEN}" font-family="Helvetica">›</text>')

def success(title, sub):
    return (f'<rect width="{W}" height="{H}" fill="#ffffff"/>' + header('') +
            f'<circle cx="{W/2}" cy="360" r="64" fill="{GREEN}"/>'
            f'<path d="M {W/2-26} 360 l 18 18 l 36 -38" stroke="#ffffff" stroke-width="10" fill="none" stroke-linecap="round" stroke-linejoin="round"/>'
            f'<text x="{W/2}" y="480" font-size="22" font-weight="700" fill="{INK}" text-anchor="middle" font-family="Helvetica">{esc(title)}</text>'
            f'<text x="{W/2}" y="512" font-size="14" fill="{MUTED}" text-anchor="middle" font-family="Helvetica">{esc(sub)}</text>'
            + cta(600, 'Done'))

def fail(title, sub, sub2, amber=False, head='Payment'):
    icon = (f'<circle cx="{W/2}" cy="330" r="56" fill="{AMBER}"/>'
            f'<circle cx="{W/2}" cy="330" r="24" fill="none" stroke="#ffffff" stroke-width="6"/>'
            f'<path d="M {W/2} 318 v 12 l 9 9" stroke="#ffffff" stroke-width="6" fill="none" stroke-linecap="round"/>') if amber else (
            f'<circle cx="{W/2}" cy="330" r="56" fill="{RED}"/>'
            f'<path d="M {W/2-20} 310 l 40 40 M {W/2+20} 310 l -40 40" stroke="#ffffff" stroke-width="10" stroke-linecap="round"/>')
    return (f'<rect width="{W}" height="{H}" fill="{NAVY}"/>' + statusbar(dark=True) +
            f'<text x="34" y="97" font-size="24" fill="#ffffff" font-family="Helvetica">‹</text>'
            f'<text x="60" y="95" font-size="20" font-weight="700" fill="#ffffff" font-family="Helvetica">{esc(head)}</text>'
            + icon +
            f'<text x="{W/2}" y="440" font-size="22" font-weight="700" fill="#ffffff" text-anchor="middle" font-family="Helvetica">{esc(title)}</text>'
            f'<text x="{W/2}" y="474" font-size="14" fill="#b9c6c0" text-anchor="middle" font-family="Helvetica">{esc(sub)}</text>'
            f'<text x="{W/2}" y="496" font-size="14" fill="#b9c6c0" text-anchor="middle" font-family="Helvetica">{esc(sub2)}</text>'
            + cta(600, 'Try again'))

def payment_page(title):
    return (f'<rect width="{W}" height="{H}" fill="#ffffff"/>' + header(title) +
            field(170, 'Card number', '4XXX XXXX XXXX 1234') +
            field(250, 'Expiry', '12/28', w=(W-84)/2) +
            f'<rect x="{34+(W-84)/2+16}" y="250" width="{(W-84)/2}" height="62" rx="12" fill="{FIELD}" stroke="{LINE}"/>'
            f'<text x="{52+(W-84)/2+16}" y="288" font-size="16" fill="{INK}" font-family="Helvetica">CVV  •••</text>'
            f'<text x="34" y="370" font-size="14" fill="{MUTED}" font-family="Helvetica">Or pay with</text>'
            + ''.join(f'<rect x="{34+i*92}" y="390" width="80" height="44" rx="8" fill="#ffffff" stroke="{LINE}"/>'
                      f'<text x="{74+i*92}" y="418" font-size="13" font-weight="700" fill="{INK}" text-anchor="middle" font-family="Helvetica">{t}</text>'
                      for i, t in enumerate(['mada', 'VISA', 'Pay', 'stc'])) +
            cta(600, 'Pay now'))

SCREENS = {
  # ── Request a SIM swap ─────────────────────────────────────────────────────
  'sim_swap_start': (
    f'<rect width="{W}" height="{H}" fill="#ffffff"/>' + header('Request a new SIM or eSIM') +
    f'<text x="34" y="165" font-size="14" fill="{MUTED}" font-family="Helvetica">Lost or damaged your SIM? Get a replacement</text>'
    f'<text x="34" y="186" font-size="14" fill="{MUTED}" font-family="Helvetica">instantly and activate it online.</text>'
    + option_row(220, 'Get a new Physical SIM') + option_row(300, 'Get an eSIM')),
  'sim_swap_pay': payment_page('Complete payment'),
  'sim_swap_paid': success('Payment received', 'Replacement fee paid — 28.75 SAR'),
  'sim_swap_done': success('Swap completed', 'Your new SIM is ready to use'),
  'sim_swap_left': fail('Payment not completed', 'The customer left this screen before', 'submitting — the gateway never answered', amber=True),
  'sim_swap_declined': fail('Payment declined', 'Your bank did not approve this payment.', 'No amount has been taken.'),
  # ── Renew your plan ────────────────────────────────────────────────────────
  'renewal_start': (
    f'<rect width="{W}" height="{H}" fill="#ffffff"/>' + header('Renew your plan') +
    f'<rect x="34" y="170" width="{W-68}" height="150" rx="14" fill="{FIELD}" stroke="{LINE}"/>'
    f'<text x="52" y="205" font-size="17" font-weight="700" fill="{INK}" font-family="Helvetica">Salam 150 · monthly</text>'
    f'<text x="52" y="232" font-size="14" fill="{MUTED}" font-family="Helvetica">Unlimited calls · 100 GB data</text>'
    f'<text x="52" y="292" font-size="22" font-weight="700" fill="{GREEN}" font-family="Helvetica">172.50 SAR</text>'
    f'<text x="150" y="292" font-size="12" fill="{MUTED}" font-family="Helvetica">VAT included</text>'
    + cta(600, 'Renew now')),
  'renewal_pay': payment_page('Complete payment'),
  'renewal_paid': success('Payment received', 'Renewal fee paid'),
  'renewal_done': success('Plan renewed', 'Your plan is active for another month'),
  'renewal_left': fail('Payment not completed', 'The customer left this screen before', 'submitting — the gateway never answered', amber=True),
  'renewal_declined': fail('Payment declined', 'Your bank did not approve this payment.', 'No amount has been taken.'),
  # ── Activate SIM ───────────────────────────────────────────────────────────
  'activate_sim_start': (
    f'<rect width="{W}" height="{H}" fill="#ffffff"/>' + header('Activate SIM card') +
    f'<text x="34" y="170" font-size="14" fill="{MUTED}" font-family="Helvetica">Enter your details to activate the SIM you</text>'
    f'<text x="34" y="191" font-size="14" fill="{MUTED}" font-family="Helvetica">purchased.</text>'
    + field(220, 'ID / Iqama number') + field(300, 'SIM serial (ICCID)') + cta(600, 'Activate')),
  'activate_sim_done': success('SIM activated', 'Your line is now active'),
  # ── Register to app ────────────────────────────────────────────────────────
  'register_start': (
    f'<rect width="{W}" height="{H}" fill="#ffffff"/>' + header('Register to App') +
    field(180, 'Mobile number', '05X XXX XXXX') + field(260, 'ID / Iqama number') +
    f'<text x="34" y="380" font-size="14" fill="{MUTED}" font-family="Helvetica">We will send a verification code by SMS</text>'
    + cta(600, 'Continue')),
  'register_done': success('Account created', 'Welcome to Salam'),
  # ── Recharge number (guest) ────────────────────────────────────────────────
  'recharge_guest_start': (
    f'<rect width="{W}" height="{H}" fill="#ffffff"/>' + header('Recharge number') +
    f'<text x="34" y="165" font-size="14" fill="{MUTED}" font-family="Helvetica">Enter the mobile number you want to recharge</text>'
    + field(190, 'Mobile number', '0535XXXXXX') +
    ''.join(f'<rect x="{34+(i%3)*118}" y="{280+(i//3)*74}" width="106" height="58" rx="10" fill="#ffffff" stroke="{GREEN if v=="30" else LINE}"/>'
            f'<text x="{87+(i%3)*118}" y="{316+(i//3)*74}" font-size="16" font-weight="700" fill="{INK}" text-anchor="middle" font-family="Helvetica">{v} SAR</text>'
            for i, v in enumerate(['20', '30', '50', '100', '200', '300'])) +
    cta(600, 'Continue')),
  'recharge_guest_pay': payment_page('Total amount to pay'),
  'recharge_guest_done': success('Recharge successful', '30 SAR credited to the line'),
  'recharge_guest_left': fail('Payment not completed', 'The customer left this screen before', 'submitting — the gateway never answered', amber=True),
  'recharge_guest_declined': fail('Payment declined', 'Your bank did not approve this payment.', 'No amount has been taken.'),
  # ── Pay your invoice (guest) ───────────────────────────────────────────────
  'invoice_guest_start': (
    f'<rect width="{W}" height="{H}" fill="#ffffff"/>' + header('Pay your invoice') +
    f'<text x="34" y="165" font-size="14" fill="{MUTED}" font-family="Helvetica">Enter the mobile number and the National ID or</text>'
    f'<text x="34" y="186" font-size="14" fill="{MUTED}" font-family="Helvetica">IQAMA ID number associated with the account.</text>'
    + field(215, 'Mobile number', '0510XXXXXX') + field(295, 'National ID / Iqama') + cta(600, 'Continue')),
  'invoice_guest_pay': payment_page('Total amount to pay'),
  'invoice_guest_done': success('Invoice paid', 'Receipt sent by SMS'),
  'invoice_guest_left': fail('Payment not completed', 'The customer left this screen before', 'submitting — the gateway never answered', amber=True),
  'invoice_guest_declined': fail('Payment declined', 'Your bank did not approve this payment.', 'No amount has been taken.'),
  # ── Track purchase ─────────────────────────────────────────────────────────
  'track_start': (
    f'<rect width="{W}" height="{H}" fill="#ffffff"/>' + header('Track purchase') +
    f'<text x="34" y="165" font-size="14" fill="{MUTED}" font-family="Helvetica">Enter your ID number to track your orders</text>'
    + field(195, 'ID Number') + cta(600, 'Continue')),
  'track_out': (
    f'<rect width="{W}" height="{H}" fill="#ffffff"/>' + header('Order status') +
    ''.join(f'<circle cx="60" cy="{200+i*90}" r="14" fill="{GREEN if i<3 else "#d5ddd9"}"/>'
            + (f'<path d="M 53 {200+i*90} l 5 5 l 10 -11" stroke="#ffffff" stroke-width="3.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>' if i < 3 else '')
            + (f'<rect x="58" y="{216+i*90}" width="4" height="58" fill="{GREEN if i<2 else LINE}"/>' if i < 3 else '')
            + f'<text x="92" y="{196+i*90}" font-size="16" font-weight="700" fill="{INK}" font-family="Helvetica">{t}</text>'
            f'<text x="92" y="{218+i*90}" font-size="13" fill="{MUTED}" font-family="Helvetica">{s}</text>'
            for i, (t, s) in enumerate([('Order received', '#uv3wcjbx'),
                                        ('Assigned to driver', 'Tracking #2032392015985'),
                                        ('On the way', 'Reached destination warehouse'),
                                        ('Delivered', '')]))),
  'track_done': (
    f'<rect width="{W}" height="{H}" fill="#ffffff"/>' + header('Order status') +
    ''.join(f'<circle cx="60" cy="{200+i*90}" r="14" fill="{GREEN}"/>'
            f'<path d="M 53 {200+i*90} l 5 5 l 10 -11" stroke="#ffffff" stroke-width="3.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>'
            + (f'<rect x="58" y="{216+i*90}" width="4" height="58" fill="{GREEN}"/>' if i < 3 else '')
            + f'<text x="92" y="{196+i*90}" font-size="16" font-weight="700" fill="{INK}" font-family="Helvetica">{t}</text>'
            f'<text x="92" y="{218+i*90}" font-size="13" fill="{MUTED}" font-family="Helvetica">{s}</text>'
            for i, (t, s) in enumerate([('Order received', '#uv3wcjbx'),
                                        ('Assigned to driver', 'Tracking #2032392015985'),
                                        ('On the way', 'Reached destination warehouse'),
                                        ('Delivered', '7:07 PM · 23/4/2024')]))),
}

"""Error-state screens for the ONBOARDING lanes (New SIM = ns_, MNP = mnp_): the same six
failure families the server now reports as errSteps. Same visual system; the eligibility and
delivery ones are white informational screens (the app really shows those inline), the identity/
payment/activation ones are the dark modal the app uses for hard failures."""
def elig_reject():
    return (f'<rect width="{W}" height="{H}" fill="#ffffff"/>' + header('Eligibility') +
        f'<circle cx="{W/2}" cy="330" r="56" fill="{RED}"/>'
        f'<path d="M {W/2-20} 310 l 40 40 M {W/2+20} 310 l -40 40" stroke="#ffffff" stroke-width="10" stroke-linecap="round"/>'
        f'<text x="{W/2}" y="440" font-size="22" font-weight="700" fill="{INK}" text-anchor="middle" font-family="Helvetica">You are not eligible</text>'
        f'<text x="{W/2}" y="474" font-size="14" fill="{MUTED}" text-anchor="middle" font-family="Helvetica">Your ID did not pass the eligibility check.</text>'
        f'<text x="{W/2}" y="496" font-size="14" fill="{MUTED}" text-anchor="middle" font-family="Helvetica">Lines allowed may be used up.</text>'
        + cta(600, 'Back to home'))
def nafath_fail():
    return fail('Nafath verification failed', 'The identity request expired or was', 'rejected. Please try again.', head='Verify your identity')
def activation_fail():
    return fail('Activation failed', 'We could not activate your SIM.', 'Our team is looking into it.', head='Activation')
def delivery_problem():
    return (f'<rect width="{W}" height="{H}" fill="#ffffff"/>' + header('Order status') +
        ''.join(f'<circle cx="60" cy="{200+i*90}" r="14" fill="{GREEN if i<2 else RED if i==2 else "#d5ddd9"}"/>'
            + (f'<path d="M 53 {200+i*90} l 5 5 l 10 -11" stroke="#ffffff" stroke-width="3.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>' if i < 2 else
               (f'<path d="M {60-5} {200+i*90-5} l 10 10 M {60+5} {200+i*90-5} l -10 10" stroke="#ffffff" stroke-width="3.5" stroke-linecap="round"/>' if i == 2 else ''))
            + (f'<rect x="58" y="{216+i*90}" width="4" height="58" fill="{GREEN if i<1 else LINE}"/>' if i < 3 else '')
            + f'<text x="92" y="{196+i*90}" font-size="16" font-weight="700" fill="{INK if i<3 else MUTED}" font-family="Helvetica">{t}</text>'
            f'<text x="92" y="{218+i*90}" font-size="13" fill="{RED if i==2 else MUTED}" font-family="Helvetica">{s}</text>'
            for i, (t, s) in enumerate([('Order received', '#q8jadnxj'),
                                        ('Assigned to driver', 'Tracking #2032392015985'),
                                        ('Delivery problem', 'Returned to warehouse — contact support'),
                                        ('Delivered', '')])))
for p in ('ns', 'mnp'):
    SCREENS[f'{p}_err_elig'] = elig_reject()
    SCREENS[f'{p}_err_nafath'] = nafath_fail()
    SCREENS[f'{p}_err_pay_left'] = fail('Payment not completed', 'The customer left this screen before', 'submitting — the gateway never answered', amber=True)
    SCREENS[f'{p}_err_pay_declined'] = fail('Payment declined', 'Your bank did not approve this payment.', 'No amount has been taken.')
    SCREENS[f'{p}_err_activation'] = activation_fail()
    SCREENS[f'{p}_err_delivery'] = delivery_problem()

def pre_elig_browse():
    plan = lambda y, name, price: (
        f'<rect x="34" y="{y}" width="{W-68}" height="150" rx="14" fill="#ffffff" stroke="{GREEN}"/>'
        f'<text x="52" y="{y+34}" font-size="16" font-weight="700" fill="{INK}" font-family="Helvetica">{name}</text>'
        f'<text x="52" y="{y+72}" font-size="24" font-weight="700" fill="{INK}" font-family="Helvetica">{price}</text>'
        f'<text x="150" y="{y+72}" font-size="12" fill="{MUTED}" font-family="Helvetica">28 Days · VAT inclusive</text>'
        f'<rect x="{W-180}" y="{y+96}" width="130" height="40" rx="20" fill="{GREEN}"/>'
        f'<text x="{W-115}" y="{y+122}" font-size="14" font-weight="700" fill="#ffffff" text-anchor="middle" font-family="Helvetica">Buy now</text>')
    return (f'<rect width="{W}" height="{H}" fill="#ffffff"/>' + header('Packages') +
        f'<text x="34" y="165" font-size="14" fill="{MUTED}" font-family="Helvetica">Offers for you — customer browsed and left here</text>'
        + plan(190, 'SIMPAL Flex 34', '39.1') + plan(360, 'Solo 74', '85.68')
        + f'<rect x="34" y="540" width="{W-68}" height="46" rx="10" fill="#fdf3dc"/>'
        f'<text x="{W/2}" y="569" font-size="13" font-weight="700" fill="#92400e" text-anchor="middle" font-family="Helvetica">Journey ended before the ID form — no check ran</text>')

for p in ('ns', 'mnp'):
    SCREENS[f'{p}_err_pre_elig'] = pre_elig_browse()

def main():
    os.makedirs(OUT, exist_ok=True)
    for name, body in SCREENS.items():
        svg = (f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" '
               f'viewBox="0 0 {W} {H}">{body}</svg>')
        path = os.path.join(OUT, name + '.png')
        cairosvg.svg2png(bytestring=svg.encode(), write_to=path, output_width=W, output_height=H)
        print('wrote', os.path.relpath(path, os.path.join(OUT, '..', '..')))
    print(f'\n{len(SCREENS)} screens. Replace any file with a real Figma export of the same name.')

if __name__ == '__main__':
    main()
