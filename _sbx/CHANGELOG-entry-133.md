## 2.0.0-alpha.133 — 2026-10-01

- DMS release diff: `--fetch` no longer reports "cannot list" when the remote glob is empty (remote listing exits 0); a flat baseline pulled as `<service-dir>__<jar>` pairs with `<service-dir>/<jar>` snapshots; an empty snapshot aborts instead of marking every service "retired". First real run (30 Sep baseline vs 1 Oct): UIL rebuilt on 136/137 (FreelanceCertificate on the Optiva AccountDetail, price-plan option value fix, version still 1.3.6, seven copies per node); wallet 0.0.8 scheduler classes exist only in the node-136 jar; callback service is three different builds across four nodes — `DMS-RELEASE-2026-10-01-UIL.md`.
- DMS ▸ Explore › System: the wallet-jobs journey corrected from "unlocked ×4" to "node 136 build only" (proved by the jar diff); `DMS-CODE-G-ADMIN.md` finding 1 corrected.

