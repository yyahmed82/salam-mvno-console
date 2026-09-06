# Business scope — Mobile team · Fixed team · both

_6 September 2026 · v2.0.0-alpha.11_

## The model
Every console user has two independent attributes:

| Axis | Answers | Stored | Edited in |
|---|---|---|---|
| **Roles** (one or more) | *What* may this person do — pages (views) and capabilities (unmask, export, ack, manage users…) | `console_users.roles` | Settings → Users, Roles & permissions matrix |
| **Business** (exactly one) | *On which side* — `mobile` (MVNO team) · `fixed` (Fixed team) · `both` | `console_users.business` (default `both`) | Settings → Users → BUSINESS control |

The two are combined **once, at session time** (`api.js` session middleware):

```
req.views = roles.scopeViews( effective(roles).views , business )
```

`scopeViews` removes the Fixed views (`fixed*`) for a Mobile-only user and the Mobile views
(`monitoring · dms · workbench · alerts · errors · analytics`) for a Fixed-only user. Shared views
(`dashboard` = Home, `explore` = Customer 360 and docs, `settings`, `users`) survive both scopes.
Super admins and the root tier are always `both` — a scope can never lock the operator out.

Because every gate in the system already reads `req.views` / `me.views`, one intersection is enough:

- **API** — every Fixed route is `requireView('fixed_*')`-gated, so a Mobile-only session gets 403 on `/api/fixed/*`. For a Fixed-only session the Mobile endpoints sit behind shared views, so `api.js` adds an **allow-list** (`FIXED_TEAM_ALLOW`): `/api/fixed/*` plus session, tickets, Yusr, settings, users, roles, audit, live stream. Anything else answers `403 Not available for the Fixed team`. A new Mobile endpoint is therefore closed for the Fixed team by default.
- **Navigation** (`ops.js applyScope`) — items whose view was stripped disappear; additionally the whole Mobile ▾ group is hidden for `fixed` and every Fixed item for `mobile`. An empty group hides itself (`navdrop.js`). `<html data-business>` is set for CSS hooks.
- **Router** (`router.js`) — each route is tagged Mobile / Fixed / shared; a deep link to the other side shows "Not part of your business" and never renders the page.
- **Home** (`landing.js`) — single-column for a single-business account; the other column is removed.
- **Customer 360** (`sub360.js`) — only the allowed side is looked up; the Services strip shows what that side holds.
- **Yusr** (`assist.js`) — receives `business`; a Fixed-team user typing a National ID / mobile is routed to the Fixed customer lookup, Mobile-only intents (SMS, payments, checkout, Mobile alerts) are declined with a scope note; a Mobile-team user never triggers a Fixed lookup, Fixed intents are declined.
- **Raise a ticket** (`tickets.js`) — a single-business user gets one tab pre-selected (no step 1); `both` chooses.
- **Guided tour** — steps are gated by views, so they follow the scope with no extra code.

## Data
`ALTER TABLE console_users ADD COLUMN IF NOT EXISTS business text NOT NULL DEFAULT 'both'` (self-seeded at boot).
Existing users start as `both` — nobody loses access on upgrade; admins narrow it per person.
`/api/me` returns `business` and `businessLabel`; `POST/PATCH /api/users` accept `business` (validated).

## Colours
Mobile = violet `#7c3aed`, Fixed = green `#0e9f5a` — used consistently in the ticket modal, the ticket board pill, the Business control and the Customer 360 services strip.
