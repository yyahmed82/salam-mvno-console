#!/usr/bin/env python3
"""
Salam Digital Console — WORKSHOP CERTIFICATES.

Generates a print-quality, vector A4-landscape certificate per attendee, plus a combined
print file and a verification register.

Two grades are issued automatically from the roster, so the certificate means something:

    CERTIFICATE OF COMPLETION   attended all required sessions AND scored >= the pass mark
    CERTIFICATE OF ATTENDANCE   attended the minimum sessions, assessment not passed / not sat

Every certificate carries a deterministic verification ID (and a QR code pointing at the
console) that is written to register.csv — so a certificate can be checked, not just believed.

INPUTS   attendees.csv          name,email,role,s1,s2,s3,s4,quiz_score,notes
         workshop.config.json   programme, signatories, thresholds, links

USAGE    pip install reportlab segno        # segno optional (QR); reportlab required
         python3 build_certificates.py
         python3 build_certificates.py --roster my.csv --date 2026-09-30

OUTPUT   certificates/<Name>.pdf            one per attendee
         certificates/ALL-certificates.pdf  everyone, for one print job
         certificates/register.csv          verification register (keep this)
"""
import os, csv, json, hashlib, argparse, datetime, io

from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.units import mm
from reportlab.lib.colors import Color, HexColor
from reportlab.pdfgen import canvas as rlcanvas
from reportlab.pdfbase import pdfmetrics

try:
    import segno
    HAVE_QR = True
except ImportError:
    HAVE_QR = False

HERE = os.path.dirname(os.path.abspath(__file__))
OUTDIR = os.path.join(HERE, "certificates")

# ── palette (matches the deck) ───────────────────────────────────────────────
GREEN = HexColor("#008A47")
GREEN_D = HexColor("#046A3B")
GREEN_L = HexColor("#B7E4CB")
GREEN_XL = HexColor("#ECFDF3")
INK = HexColor("#0F172A")
BODY = HexColor("#334155")
MUTED = HexColor("#64748B")
FAINT = HexColor("#94A3B8")
GOLD = HexColor("#9A7B26")
PAPER = HexColor("#FFFFFF")
WASH = HexColor("#FAFBFC")

PW, PH = landscape(A4)          # 841.89 x 595.28 pt

SER = "Times-Roman"
SERB = "Times-Bold"
SERI = "Times-Italic"
SAN = "Helvetica"
SANB = "Helvetica-Bold"


# ── small drawing helpers ────────────────────────────────────────────────────
def tracked(c, x, y, s, font, size, color, track=0.0, align="c"):
    """Draw text with letter-spacing. align: c=centre on x, l=left at x, r=right at x."""
    c.setFont(font, size)
    c.setFillColor(color)
    w = pdfmetrics.stringWidth(s, font, size) + track * max(0, len(s) - 1)
    sx = x - w / 2 if align == "c" else (x - w if align == "r" else x)
    if track == 0:
        c.drawString(sx, y, s)
    else:
        cur = sx
        for ch in s:
            c.drawString(cur, y, ch)
            cur += pdfmetrics.stringWidth(ch, font, size) + track
    return w


def centre(c, y, s, font, size, color, track=0.0):
    return tracked(c, PW / 2, y, s, font, size, color, track, "c")


def hrule(c, x1, x2, y, color, w=0.7):
    c.setStrokeColor(color); c.setLineWidth(w); c.line(x1, y, x2, y)


def wrap(s, font, size, maxw):
    words, lines, cur = s.split(), [], ""
    for w in words:
        t = (cur + " " + w).strip()
        if pdfmetrics.stringWidth(t, font, size) <= maxw:
            cur = t
        else:
            if cur: lines.append(cur)
            cur = w
    if cur: lines.append(cur)
    return lines


def border(c):
    """Double rule with corner ornaments — formal without being fussy."""
    c.setFillColor(PAPER); c.rect(0, 0, PW, PH, stroke=0, fill=1)
    # faint tint panel so the white name area reads as deliberate
    c.setFillColor(WASH); c.rect(0, 0, PW, PH, stroke=0, fill=1)
    c.setFillColor(PAPER); c.rect(30, 30, PW - 60, PH - 60, stroke=0, fill=1)

    c.setStrokeColor(GREEN); c.setLineWidth(2.4)
    c.rect(22, 22, PW - 44, PH - 44, stroke=1, fill=0)
    c.setStrokeColor(GREEN_L); c.setLineWidth(0.7)
    c.rect(29, 29, PW - 58, PH - 58, stroke=1, fill=0)

    # corner ornaments — short right-angle strokes inside the inner rule
    c.setStrokeColor(GREEN); c.setLineWidth(1.6)
    L, o = 26, 38
    for cx, cy, dx, dy in ((o, o, 1, 1), (PW - o, o, -1, 1),
                           (o, PH - o, 1, -1), (PW - o, PH - o, -1, -1)):
        c.line(cx, cy, cx + dx * L, cy)
        c.line(cx, cy, cx, cy + dy * L)


def seal(c, cx, cy, r, grade):
    """Embossed-look seal: two rings, radial ticks, stacked wordmark."""
    c.saveState()
    c.setFillColor(GREEN_XL); c.setStrokeColor(GREEN); c.setLineWidth(1.6)
    c.circle(cx, cy, r, stroke=1, fill=1)
    c.setStrokeColor(GREEN_L); c.setLineWidth(0.8)
    c.circle(cx, cy, r - 5.5, stroke=1, fill=0)
    # radial ticks around the outer ring
    import math
    c.setStrokeColor(GREEN_L); c.setLineWidth(0.6)
    for i in range(48):
        a = i * math.pi / 24
        c.line(cx + math.cos(a) * (r - 3.4), cy + math.sin(a) * (r - 3.4),
               cx + math.cos(a) * (r - 0.8), cy + math.sin(a) * (r - 0.8))
    tracked(c, cx, cy + 9, "SALAM", SANB, 8.5, GREEN, 1.6, "c")
    hrule(c, cx - 20, cx + 20, cy + 5, GREEN_L, 0.6)
    tracked(c, cx, cy - 5.5, "DIGITAL", SANB, 6.6, GREEN_D, 1.0, "c")
    tracked(c, cx, cy - 14, "CONSOLE", SANB, 6.6, GREEN_D, 1.0, "c")
    tracked(c, cx, cy - 23, grade, SANB, 5.0, GOLD, 0.9, "c")
    c.restoreState()


def qr_png(data, scale=6):
    if not HAVE_QR:
        return None
    buf = io.BytesIO()
    segno.make(data, error="m").save(buf, kind="png", scale=scale, border=0,
                                     dark="#008A47", light="#FFFFFF")
    buf.seek(0)
    return buf


# ── certificate ──────────────────────────────────────────────────────────────
def draw_certificate(c, cfg, a, issue_date):
    cert = cfg["certificate"]
    grade = a["grade"]                       # "COMPLETION" | "ATTENDANCE"
    is_completion = grade == "COMPLETION"

    border(c)

    # ── header ──
    centre(c, PH - 62, cfg["organisation"].upper(), SANB, 8.6, GREEN, 2.2)
    hrule(c, PW / 2 - 74, PW / 2 + 74, PH - 74, GREEN_L, 0.8)

    centre(c, PH - 118, "CERTIFICATE OF " + grade, SANB, 25, INK, 5.0)
    centre(c, PH - 136, cfg["cohort"], SAN, 8.6, FAINT, 2.0)

    # ── recipient ──
    centre(c, PH - 176, "This is to certify that", SERI, 12.5, MUTED)
    name = a["name"].strip()
    size = 34 if pdfmetrics.stringWidth(name, SERB, 34) < PW - 260 else 27
    centre(c, PH - 218, name, SERB, size, INK)
    hrule(c, PW / 2 - 175, PW / 2 + 175, PH - 231, GREEN, 1.1)
    if a.get("role"):
        centre(c, PH - 247, a["role"].upper(), SANB, 8.4, MUTED, 1.8)

    verb = ("has successfully completed the" if is_completion
            else "attended the")
    centre(c, PH - 276, verb, SERI, 12.5, MUTED)
    centre(c, PH - 300, cfg["programme"], SANB, 15.5, GREEN_D)

    detail = (f"a {cfg['hours_total']}-hour hands-on technical programme of 20 modules across 4 sessions, "
              f"covering platform architecture, incident triage, payment forensics, alerting and rule tuning, "
              f"conducted on live production data.")
    yy = PH - 320
    for ln in wrap(detail, SER, 10.2, PW - 300):
        centre(c, yy, ln, SER, 10.2, BODY); yy -= 13.5

    # ── session attendance strip ──
    sess = cfg["sessions"]
    bw, gap = 118, 12
    total_w = len(sess) * bw + (len(sess) - 1) * gap
    x = (PW - total_w) / 2
    top = 168
    for i, s in enumerate(sess):
        got = a["sessions"][i]
        bx = x + i * (bw + gap)
        c.setFillColor(GREEN_XL if got else HexColor("#F6F7F9"))
        c.setStrokeColor(GREEN_L if got else HexColor("#E2E8F0")); c.setLineWidth(0.8)
        c.roundRect(bx, top, bw, 40, 4, stroke=1, fill=1)
        tracked(c, bx + bw / 2, top + 26, f"{s['id']}  ·  {s['modules']}", SANB, 7.4,
                GREEN if got else FAINT, 1.0, "c")
        tracked(c, bx + bw / 2, top + 13.5, s["title"], SAN, 8.6,
                INK if got else FAINT, 0, "c")
        tracked(c, bx + bw - 9, top + 30.5, "✓" if got else "–", SANB, 9,
                GREEN if got else FAINT, 0, "r")
    tracked(c, PW / 2, top - 13, "SESSIONS ATTENDED", SANB, 6.8, FAINT, 1.6, "c")

    # assessment result
    if a["score"] is not None:
        txt = f"Assessment score  {a['score']}%"
        if is_completion: txt += f"   ·   pass mark {cfg['certificate']['completion_min_score']}%"
        tracked(c, PW / 2, top - 30, txt, SANB, 8.6,
                GREEN if is_completion else MUTED, 0.8, "c")

    # ── signatures ──
    sigs = [s for s in cfg["signatories"] if s.get("name") or s.get("title")]
    sy = 112
    sw = 190
    # kept right of centre so they can never collide with the verification block bottom-left
    slots = [PW / 2 - 105, PW / 2 + 115] if len(sigs) > 1 else [PW / 2 + 10]
    for sx, sg in zip(slots, sigs):
        hrule(c, sx, sx + sw, sy, HexColor("#CBD5E1"), 0.8)
        tracked(c, sx + sw / 2, sy - 13, sg.get("name") or " ", SANB, 9.5, INK, 0, "c")
        tracked(c, sx + sw / 2, sy - 25, sg.get("title", ""), SAN, 7.8, MUTED, 0.3, "c")

    # ── seal ──
    seal(c, PW - 112, 168, 40, grade)

    # ── date / place ──
    tracked(c, 62, 158, "ISSUED", SANB, 6.6, FAINT, 1.6, "l")
    tracked(c, 62, 144, issue_date.strftime("%d %B %Y"), SANB, 10, INK, 0, "l")
    tracked(c, 62, 131, cert["issue_place"], SAN, 7.8, MUTED, 0, "l")

    # ── verification (bottom-left, clear of the signature slots) ──
    qx, qy = 62, 44
    buf = qr_png(cfg.get("console_url", ""))
    if buf:
        from reportlab.lib.utils import ImageReader
        c.drawImage(ImageReader(buf), qx, qy, 44, 44, mask="auto")
        tx = qx + 54
    else:
        tx = qx
    tracked(c, tx, qy + 33, "CERTIFICATE ID", SANB, 6.6, FAINT, 1.6, "l")
    tracked(c, tx, qy + 19, a["cid"], "Courier-Bold", 10.5, GREEN_D, 0.6, "l")
    tracked(c, tx, qy + 6, cert["verify_note"], SAN, 6.4, FAINT, 0, "l")

    c.showPage()


# ── roster ───────────────────────────────────────────────────────────────────
def truthy(v):
    return str(v).strip().lower() in ("y", "yes", "1", "true", "x", "✓")


def cert_id(cfg, a):
    seed = f"{cfg['programme']}|{cfg['cohort']}|{a['name'].strip().lower()}|{a['email'].strip().lower()}"
    h = hashlib.sha256(seed.encode()).hexdigest().upper()
    yr = datetime.date.today().year
    return f"{cfg['certificate']['id_prefix']}-{yr}-{h[:4]}-{h[4:8]}"


def load_roster(path, cfg):
    cert = cfg["certificate"]
    out, skipped = [], []
    with open(path, newline="", encoding="utf-8-sig") as f:
        for row in csv.DictReader(f):
            if not (row.get("name") or "").strip():
                continue
            sessions = [truthy(row.get(f"s{i}", "")) for i in range(1, len(cfg["sessions"]) + 1)]
            n = sum(sessions)
            raw = (row.get("quiz_score") or "").strip()
            score = None
            if raw:
                try: score = int(round(float(raw.rstrip("%"))))
                except ValueError: score = None

            if n >= cert["completion_min_sessions"] and score is not None \
                    and score >= cert["completion_min_score"]:
                grade = "COMPLETION"
            elif n >= cert["attendance_min_sessions"]:
                grade = "ATTENDANCE"
            else:
                skipped.append((row["name"], f"only {n} session(s) — minimum is "
                                             f"{cert['attendance_min_sessions']}"))
                continue

            a = {"name": row["name"].strip(), "email": (row.get("email") or "").strip(),
                 "role": (row.get("role") or "").strip(), "sessions": sessions,
                 "n_sessions": n, "score": score, "grade": grade,
                 "notes": (row.get("notes") or "").strip()}
            a["cid"] = cert_id(cfg, a)
            out.append(a)
    return out, skipped


def safe(s):
    return "".join(ch if ch.isalnum() or ch in " -_" else "-" for ch in s).strip().replace(" ", "-")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--roster", default=os.path.join(HERE, "attendees.csv"))
    ap.add_argument("--config", default=os.path.join(HERE, "workshop.config.json"))
    ap.add_argument("--date", help="issue date YYYY-MM-DD (default: today)")
    ap.add_argument("--outdir", default=OUTDIR)
    args = ap.parse_args()

    cfg = json.load(open(args.config, encoding="utf-8"))
    issue = (datetime.date.fromisoformat(args.date) if args.date else datetime.date.today())
    people, skipped = load_roster(args.roster, cfg)
    if not people:
        raise SystemExit("no eligible attendees in " + args.roster)

    os.makedirs(args.outdir, exist_ok=True)

    # individual PDFs
    for a in people:
        p = os.path.join(args.outdir, f"{safe(a['name'])}.pdf")
        c = rlcanvas.Canvas(p, pagesize=(PW, PH))
        c.setTitle(f"{cfg['programme_short']} — {a['name']}")
        c.setAuthor(cfg["organisation"]); c.setSubject(f"Certificate of {a['grade'].title()}")
        draw_certificate(c, cfg, a, issue)
        c.save()

    # one combined file for printing
    allp = os.path.join(args.outdir, "ALL-certificates.pdf")
    c = rlcanvas.Canvas(allp, pagesize=(PW, PH))
    c.setTitle(f"{cfg['programme_short']} — all certificates")
    for a in people:
        draw_certificate(c, cfg, a, issue)
    c.save()

    # verification register
    reg = os.path.join(args.outdir, "register.csv")
    with open(reg, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["certificate_id", "name", "email", "role", "grade", "sessions_attended",
                    "score", "issued", "programme", "cohort", "notes"])
        for a in people:
            w.writerow([a["cid"], a["name"], a["email"], a["role"], a["grade"].title(),
                        a["n_sessions"], a["score"] if a["score"] is not None else "",
                        issue.isoformat(), cfg["programme"], cfg["cohort"], a["notes"]])

    comp = sum(1 for a in people if a["grade"] == "COMPLETION")
    print(f"✓ {args.outdir}")
    print(f"  {len(people)} certificates  ·  {comp} completion  ·  {len(people)-comp} attendance"
          f"  ·  QR: {'on' if HAVE_QR else 'off (pip install segno)'}")
    print(f"  combined: ALL-certificates.pdf   register: register.csv")
    for n, why in skipped:
        print(f"  – skipped {n}: {why}")


if __name__ == "__main__":
    main()
