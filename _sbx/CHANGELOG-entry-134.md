## 2.0.0-alpha.134 — 2026-10-01

- Infrastructure incidents (`infra_*` / `fixed_infra_*`) no longer drive the business boards: Executive Dashboard "Are we OK right now?" / outage register / radar (`execBrief.js`, `execRadar.js`), Mobile and Fixed executive strips (`mvnoExec.js`, `fixedExec.js`), the NOC wall open counts and headline (`/api/noc`) and the Home "needs attention" list (`/api/alerts?scope=app`) all filter with `segment.appOnly()`. Infra alerts stay exactly where they are under Infrastructure › Alerts (Mobile infra / Fixed infra), in mails, ChatOps and the agents.

