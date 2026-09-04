# Screenshots for the deck

Save each screenshot into **this folder** with the exact filename below, then re-run:

```bash
cd mvno-console/deck && python3 build_deck.py
```

Any slot with an image gets the real screenshot; any slot without keeps a styled placeholder.
You can do them in batches — re-running is always safe.

## How to capture (2 minutes of setup, big quality difference)

1. **Dark mode ON** (the ☾ toggle in the header) — the deck is near-black, so dark screenshots blend in.
2. **Browser zoom 100%**, window as wide as you can (the slot is 8.4in wide, landscape).
3. Use **Cmd+Shift+4 then Space** on macOS to grab a clean window without the desktop.
4. Prefer a **region capture of the content area** over a full-screen grab — no browser chrome,
   no bookmarks bar, no macOS menu bar. Tighter crop = bigger, more readable UI on the slide.
5. Pick a range with **real data** (7d or 30d) so nothing looks empty.

| Filename | Slide | What to capture |
|---|---|---|
| `03-dashboard-hero.png` | The solution | Dashboard, full page, 30d range — the "wow" shot |
| `06-upg-alert.png` | Proof · UPG | Alerts › Alert rules → open **UPG gateway zero-success watchdog** (rule detail + runbook) |
| `07-payment-stuck.png` | Proof · payments | Troubleshoot › **Payment stuck (unconfirmed)** tile selected, feed rows visible |
| `08-semati-correlation.png` | Proof · Semati | Alerts › an open Semati incident showing correlation / blast radius (History tab works too) |
| `09-osb-faults.png` | Proof · BSS | Troubleshoot › Activation → the **BSS READ-PATH · OSB SOAP FAULTS** panel |
| `12-login.png` | Secure access | The sign-in card (sign out first). Email step — or a 2-up with the code step |
| `13-dashboard-kpis.png` | Dashboard | Tight crop: KPI strip + journey-health tiles + NOC banner |
| `14-flow-tree.png` | Order flow | Dashboard › **Order status flow** — both New SIM and MNP lanes |
| `15-troubleshoot.png` | Troubleshoot | Error Control Board — category tiles + feed |
| `16-timeline.png` | Subscriber 360 | An expanded row timeline, or `#sub360` for a subscriber (**use a test number**) |
| `17-alerts.png` | Alerts | Alerts › Open alerts — or **Metric charts** showing the seasonal band (that one looks great) |
| `18-guided-response.png` | Guided response | An incident detail with the runbook steps + Notify on-call |
| `19-sla.png` | SLA | SLA page — service levels + vendor health board |
| `21-analytics.png` | Analytics | Analytics › a dense dashboard (Payments or Overview) |
| `22-growth.png` | Growth | Growth › sections ① Resellers and ② Campaigns |
| `23-mnp-donors.png` | MNP | Growth › **⑤ MNP port-ins by donor operator** |
| `24-dealers.png` | Dealers & QR | Dealers dashboard (or switch scope to QR partners) |
| `26-yusr.png` | Yusr | Yusr chat open with a real answer on screen |
| `28-topology.png` | Topology | Topology page, or `#apigw` hub map with the live status strip |
| `29-roles.png` | Security | Settings › **Roles & permissions** matrix (or the Audit log) |

## ⚠ Before you share the deck

Screenshots may contain **real customer data**. Either:

- capture while signed in as a role where **PII is masked** (anything except Super Admin / L3 Digital), or
- use a **test MSISDN** for the timeline / Yusr / Subscriber 360 shots, or
- blur the mobile numbers, names, emails and national IDs before sharing externally.

The 360, timeline and Yusr slots are the ones most likely to expose personal data — check those twice.
