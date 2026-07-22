# Feature parity — Salam Dealers Ops Console vs. MVNO Digital Console

Comparison of every feature in the **Salam Dealers Operations Console** (source: the
"Salam Operations Console" deck + live screenshots) against our **MVNO Digital Console**.

**Legend:** ✅ present · ⚠️ partial · ❌ not yet · 🚫 intentionally excluded (maps/geo, per request)

_Last updated: 2026-07-10_

---

## 1 · Secure access & governance
| Feature | Dealers Ops | Digital Console | Notes |
|---|:--:|:--:|---|
| Email sign-in (work email) | ✅ | ✅ | |
| Email **OTP** code | ✅ | ✅ | dev: code from logs/DB & on-screen; prod: SMTP |
| Domain restriction @salam.sa / @salammobile.sa | ✅ | ✅ | validated client + server |
| Login gate (redirect if not signed in) | ✅ | ✅ | |
| Role-based access | ✅ 5 roles (Super Admin, Admin, Dealers, QR, Report) | ✅ 5 roles (Super Admin, Admin, Report, Errors, Events) | role *names* differ by design |
| Least-privilege / role-scoped views | ✅ | ✅ | nav tabs hide by role |
| PII masked by default | ✅ | ✅ | everywhere |
| PII unmask — Super Admin only, live-fetched | ✅ | ✅ | audited, never stored |
| Team tags (BSS / OSS / Digital / Sales Ops) | ✅ | ✅ | on rules, errors, roles |
| User & role management UI | ✅ | ✅ | Settings → Users |
| Audit log | ⚠️ | ✅ | we log logins, unmask, rule/sync/user changes |

## 2 · Understand the journeys
| Feature | Dealers Ops | Digital Console | Notes |
|---|:--:|:--:|---|
| Journeys Explorer (step-by-step, plain language) | ✅ | ✅ | 24 journeys vs 5 dealer/QR |
| Success path / failure mode toggle | ✅ | ✅ | |
| Interactive click / filter / step | ✅ | ✅ | + category / billing / access filters |
| Sample request & response per API | ✅ | ✅ | 171 endpoints |
| "According to response → next step" | ✅ | ⚠️ | in official API-doc panel, not every step |
| Log signature to search raw logs | ✅ | ✅ | shown per endpoint |
| Journey Player (forward/back, auto-play) | ✅ | ✅ | |
| Glowing cursor showing txn position | ✅ | ⚠️ | active-step highlight, no animated cursor |
| Fiber vs 5G correct calls | ✅ | ✅ | all MVNO flows (eSIM/MNP/POSA/visitor/…) |
| Official API documentation embedded | ⚠️ | ✅ | we parse the Slate API reference |
| Integrations & Workers catalogue | ❌ | ✅ | 32 integrations · 43 workers · 22 queues |

## 3 · Troubleshoot fast
| Feature | Dealers Ops | Digital Console | Notes |
|---|:--:|:--:|---|
| Error Control Board (live feed) | ✅ | ✅ | |
| KPI tiles per category (open vs total) | ✅ | ✅ | 7 categories by owner team |
| Filter by team / category / time | ✅ | ✅ | |
| Filter by channel | ✅ | ⚠️ | platform-based, not full channel model |
| Search by ODB / ICCID / order number | ✅ | ✅ | + mobile / national ID |
| Troubleshoot detail — expand row | ✅ | ✅ | transaction drawer |
| Failed step + request/response + history | ✅ | ✅ | **end-to-end timeline** across all systems |
| PII unmask in detail (live) | ✅ | ✅ | Super Admin |
| Jump to exact dealer / QR involved | ✅ | ⚠️ | resolves order/timeline; no dealer profile page |

## 4 · 360° live dashboards
| Feature | Dealers Ops | Digital Console | Notes |
|---|:--:|:--:|---|
| Dealers dashboard (attempts/completed/conversion/active/stalled) | ✅ | ❌ | **planned next** |
| Orders over time · top dealers · plan mix | ✅ | ❌ | planned |
| Integration health (Nafath / Manafith) | ✅ | ⚠️ | we have Nafath/Semati/eligibility fail metrics + alerts, no dashboard tiles |
| QR partners dashboard + per-QR leaderboard | ✅ | ❌ | planned |
| Consent tracking per QR partner | ✅ | 🚫 | tied to QR map/consent model |
| Export to CSV / JSON | ✅ | ❌ | planned |
| Slice by outcome / plan / role / region | ✅ | ⚠️ | some metric dimensions (platform/vendor) |

## 5 · Self-serve alerts & governance
| Feature | Dealers Ops | Digital Console | Notes |
|---|:--:|:--:|---|
| Alert rules list (metric+operator+threshold+window) | ✅ | ✅ | 17 built-in rules |
| Priority / severity + owner team | ✅ | ✅ | P1–P3, team |
| Toggle rule on/off | ✅ | ✅ | |
| Tune threshold / window | ✅ | ⚠️ | via API/edit; inline edit UI minimal |
| **Add new rule** (full modal) | ✅ | ❌ | we expose built-ins; add-rule UI planned |
| "Test now" a rule | ✅ | ❌ | planned |
| Active hours (KSA) on a rule | ✅ | ✅ | enforced by runner |
| 7-day alert history | ✅ | ✅ | History tab |
| Per-rule history | ✅ | ⚠️ | global history; per-rule filter planned |
| Scheduled evaluation | ✅ every 30 min | ✅ | configurable interval |
| **Manual vs live/auto sync** (enable/disable) | ⚠️ | ✅ | Manual · Auto-Replay · Auto-Live |
| Metric time-series charts w/ thresholds | ⚠️ | ✅ | sparklines + breach markers |
| Live simulation over historical data | ❌ | ✅ | virtual-clock replay |

## 6 · The flows (payments / provisioning)
| Feature | Dealers Ops | Digital Console | Notes |
|---|:--:|:--:|---|
| System topology — clickable node map | ✅ | ✅ | 43 nodes / 56 flows |
| Filter by flow type | ✅ | ✅ | 9 flow types |
| Node inspect (role, endpoint, flows) | ✅ | ✅ | |
| Payments journey player | ✅ | ✅ | payment backbone journey |
| Payments flow analysis (whole canvas) | ✅ | ⚠️ | covered by topology |
| Payment rails visualized | ✅ Moyasar/SADAD | ✅ | HyperPay/Tap/Tamara/SalamPay + SADAD-style |
| Export map to PDF | ✅ | ❌ | planned |

## 7 · Experience
| Feature | Dealers Ops | Digital Console | Notes |
|---|:--:|:--:|---|
| **Guided / quick tour** (replayable from "?" menu) | ✅ | ❌ | **your example — planned next** |
| Light / dark theme | ✅ auto by time | ✅ | auto-by-time + manual toggle, all pages |
| On-brand Salam logo | ✅ | ✅ | colored on light, white on dark |
| Responsive desktop → mobile drawer | ✅ | ⚠️ | responsive layout; no dedicated mobile drawer |
| BETA / branding chrome | ✅ | ✅ | |

---

## Summary — gaps closed 2026-07-10 ✅
1. **Guided / quick tour** ("?" walkthrough with spotlight) — ✅ done
2. **Dealers dashboard** (attempts/completed/conversion/active/stalled, orders-over-time, top dealers, plan mix) — ✅ done
3. **QR / partners dashboard** (QR-POSA KPIs, partner KPIs, source leaderboard, plan mix) — ✅ done (QR consent-map still 🚫 excluded)
4. **Add-new-rule modal + "Test now"** on alerts — ✅ done
5. **Export CSV / JSON** on dashboards & error board — ✅ done (PDF export still ❌)
6. **Integration-health tiles** (Nafath / Semati / Manafith / Activation) — ✅ done (in Dealers dashboard)
7. **Dedicated mobile drawer** (hamburger nav) — ✅ done
8. **Settings change log** (PaperTrail versions feed) — ✅ done (new)

### Added 2026-07-10 (beyond Dealers Ops) — **Grafana-style Analytics** ✅
- New **Analytics** tab: editable chart panels over a safe whitelisted query engine (6 datasets:
  payments, onboarding, activation, nafath, delivery, change_plan).
- **Viz types**: line (multi-series), bar, stat (big number), table — dependency-free SVG.
- **Editable online**: per-panel editor (dataset, metric, viz, time-bucket, group-by, filters) with
  live preview; add / remove / resize panels; **Save** custom dashboards to the console DB.
- **Filters**: global time-range (1h–30d) + dashboard variable dropdowns (plan, platform, vendor,
  status, sim type, new/MNP) applied across panels, plus per-panel dataset-specific filters.
- **Preset dashboards** mirroring Grafana: Payments (UPG success rate, over-time, by vendor, recent),
  Activation Trends (New SIM vs MNP hourly/daily), Onboarding & Orders, Integration Health.

### Still open
- **PDF export** of the topology map — ❌
- **Animated journey cursor** & per-step "next action" on every step — ⚠️
- Per-QR consent map — 🚫 (excluded by request)

## Where the Digital Console goes beyond Dealers Ops
- **Full MVNO journey coverage** (24 journeys incl. onboarding, recharge, plan change, SIM replacement, termination, Saleor, visitor/Hajj, DataSIM) vs 5 dealer/QR journeys.
- **Integrations & Workers catalogue** (32 integrations, 43 Sidekiq workers, 22 queues, 15 webhooks).
- **Embedded official API documentation** (parsed from the Slate reference) with curl + error codes.
- **Metric time-series charts** with rule thresholds and breach markers.
- **Manual / Auto-Replay / Auto-Live sync modes** and **live simulation** over the restored prod replica.
- **End-to-end transaction timeline** assembled across payments, activation, Nafath, eligibility, delivery, plan-change.
- **Audit log** of sensitive actions.
