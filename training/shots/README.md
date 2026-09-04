# Screenshots for the training deck

Save PNGs here with these exact names, then rebuild:

```bash
cd mvno-console/training && python3 build_training_deck.py
```

Only 4 are needed — the training deck is mostly diagrams and tables by design (attendees are
looking at the *live* console, not at pictures of it).

| Filename | Slide | Capture |
|---|---|---|
| `d1-dashboard.png` | Day 1 · Dashboard | Dashboard, 7d range, KPI strip + journey health + NOC banner visible |
| `d2-troubleshoot.png` | Day 2 · Troubleshoot | Error Control Board with category tiles and a few feed rows |
| `d2-alerts.png` | Day 2 · Alerts | **Metric charts** view showing the seasonal band (more instructive than the alert list) |
| `d3-analytics.png` | Day 3 · Analytics | A dense preset dashboard — Payments or Overview |

**Capture in LIGHT mode** for this deck (the ☾ toggle) — the slides are white, so light screenshots sit
better than dark ones. This is the opposite of the promo deck.

⚠ **Check for PII before sharing.** Capture as a masked role (anything except Super Admin / L3
Digital), or blur mobile numbers, names and national IDs.
