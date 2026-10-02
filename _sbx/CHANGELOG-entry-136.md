## 2.0.0-alpha.136 — 2026-10-02

- Alerts (Mobile, Fixed, Infrastructure): the live refresh no longer closes what you are reading. The open Details / Guide rows keep their DOM (moved under the fresh list, listeners and loaded evidence intact) and the scroll position is restored, so an incident drawer survives the periodic re-render; only an incident that left the list (resolved and filtered out) disappears.

