# CST Escalations — Engagement Runbook

**Owner:** Yosri A. Yahmed — Head of Digital Operations, Salam Telecom (Riyadh)
**Scope:** Salam ⇄ CST (هيئة الاتصالات والفضاء والتقنية) complaint-escalation integration, its defects, and the analytical position built on top of it.
**Runbook date:** 2026-09-16 · **Data horizon:** 1 Jul 2026 → 8 Sep 2026
**Classification:** Internal / restricted. Contains customer-level references — do not paste into external tools or share outside Salam.

> **How to use this file in a new Claude project.** Drop it in as `CLAUDE.md` or attach it as project knowledge. It is written so a fresh session can resume without re-deriving anything: §1–§3 are the fixed facts, §4–§9 are the workstreams with their state, §10 has the verified numbers to quote, §11 has the traps that cost time, §13 has ready-to-paste prompts. Re-verify anything in §10 against live data before putting it in front of the regulator — the figures are snapshots, not live.

---

## 1. Systems inventory

Every command and query below must state its target explicitly. These are the only hosts in scope.

| What | Where | Notes |
|---|---|---|
| Remedy AR System DB | **Server `172.30.1.14` (port 1433), database `ARSystem`** — Microsoft SQL Server | All CST ticket data lives here. Read-only for this work. |
| CST integration view | `ARSystem.dbo.ITC_CITC_MOH` | `UNION ALL` of `HPD_Help_Desk` (incidents) + `WOI_WorkOrder` (work orders), both filtered `Trouble_Ticket_Types = N'CTT'`, keyed `SRID AS Service_RequestID`. |
| Fixed view from DBA team | `ARSystem.dbo.ITC_CITC_MOH_NEW` / `_now` | The de-duplicated rebuild. See §5. |
| Code mapping table | `ARSystem.dbo.CITC_SDM_CODE_MAPPING` | Source of the duplicate tier-triples that caused the HTTP 500. |
| Legacy .NET service | **Server 98**, IIS, `SwaggerApps.dll` | No maintained source. What exists was reverse-engineered from IL into `Reverse-Engineered/source/SwaggerApps/`. `SalamSwaggerApps.Controllers.SalamAPIController.cs` (73 KB) is the one that matters. |
| Java replacement | **Server 98**, `127.0.0.1:8082` | `cst-escalations-hybrid.jar`. Source in `cst-hybrid-java/src/com/salam/cst/`. |
| CST endpoints | `https://itc-tt-view.itc.sa/` | Five POST endpoints per spec **CITC006001 v6.2** (PDF in `Reverse-Engineered/`). |
| Oracle EBPROD | — | **Not** where CST data lives. Running T-SQL there returns ORA-06550 / ORA-00922 / ORA-00900. This mistake was made once; don't repeat it. |

**Remedy status codes** (`Status` column on both forms):
`0 New · 1 Assigned · 2 In Progress · 3 Pending · 4 Resolved · 5 Closed · 6 Cancelled`

**Column names that bite** (verified against this environment):
- `HPD_Help_Desk` → `Incident_Number`, `SRID`, `Status`, `Categorization_Tier_1..3`, `Trouble_Ticket_Types`, `Submit_Date`
- `WOI_WorkOrder` → **`Work_Order_ID`** (underscore between Work and Order — *not* `WorkOrder_ID`), `SRID`, `Status`, `Categorization_Tier_1..3`, `Trouble_Ticket_Types`, `Submit_Date`

**The single join key for everything:**
```
REQ (رقم الشكوى لدى مقدم الخدمة, from CST) = SRID (Remedy) = ITC_CITC_MOH.Service_RequestID
```

---

## 2. People and forums

| Name | Role | Channel |
|---|---|---|
| **Atif K ElEissawi** (عاطف العيساوي) | Salam IT — peer, co-owner of the CST position | Email; admin of the WhatsApp group |
| **Ali Alokasi** | Salam **RA** (Regulatory Affairs) — CST liaison | WhatsApp group; sends the escalated-complaint exports |
| Ahmad M Seifan, Yasmin K Abdelhalim | Salam IT — cc on the position thread | Email |
| Abdul Haque | Counterpart on the WO-vs-INC escalation thread | Email |
| Firas F. Hammad | **CST side** — sent the approved 6 Sep 2026 meeting minutes | External |
| DBA team | Owns `ITC_CITC_MOH` and the mapping table | Email |

**"Ops task force" WhatsApp group — treat as semi-external.** Members include vendor/third-party participants (`~IWC (Jason)`, `FengFangwei`, `YuLin`, `+86…` numbers) alongside Salam staff. Nothing with customer-level data, and nothing with the internal accountability findings, goes in that group. Evidence files go to Ali + Atif directly.

### Communication rules — these are hard constraints

1. **Email to other teams (DBA, vendors, anyone outside the immediate IT circle): findings and the ask only.** Never share our solution, our plan, our scripts, or our SQL. State what is broken, what evidence shows it, and what we need from them. Nothing else. *(This was explicit user feedback after a first draft over-shared a fix.)*
2. **Internal IT peers (Atif, Ahmad, Yasmin) and RA:** full position, numbers, and plan are fine.
3. **National ID numbers masked to last 4 digits** in every shared output (`****9872`). Customer names and phone numbers are excluded entirely from the full-list workbook.
4. **Never send the raw Excel evidence file to CST.** Extract only what serves the response.
5. **Emails and reports in Arabic, RTL.** The WhatsApp group speaks English — match the channel.

---

## 3. The narrative in six sentences

CST escalates complaints to Salam; Salam's records live in Remedy; the two are joined on `REQ = SRID`. The integration was returning HTTP 500 on some complaints — a genuine IT defect, root-caused and fixed (§5). Separately, CST's 6 Sep 2026 minutes told Salam to remediate observations "within the specified periods," which created pressure to accept blame and commit to aggressive SLAs. The analysis (§10) proves **every single escalated complaint has a real internal ticket** — so nothing was lost by the systems — and that the actual failure sits in **Contact Centre closure practice** (cancellation requests closed as "customer unreachable") and in **network/field response time**, not in IT. That reframing, plus a measured time-lag distribution, is what lets Salam negotiate realistic, category-split commitments instead of one blanket SLA. IT's own contribution is honest and documented: it found and fixed the 500, and it built the traceability layer the whole position rests on.

---

## 4. Workstream A — Java replacement cutover on server 98

**State: prepared, gated, NOT executed.** The documented 3 a.m. IIS cutover was verified as never having run.

Scripts in `Reverse-Engineered/cst-hybrid-java/ops/` (PowerShell 5.1 on server 98):

| Script | Purpose |
|---|---|
| `PREFLIGHT-CHECKS.ps1` | Gate. Must pass before anything else. |
| `CUTOVER-3AM.ps1` | Canary switch to the Java upstream. |
| `WIDEN-AFTER-CANARY.ps1` | Widen traffic after the canary holds. |
| `IIS-ROLLBACK.ps1` | Abort path. |
| `TEST-500-via-java.ps1` | Reproduce the 500 through the Java path. |
| `CUTOVER-PACKAGE-mailsafe.txt` | Mail-safe bundle of the above. |

**Constraint carried through all of them:** every HTTP call uses `Invoke-WebRequest -UseBasicParsing` with certificate-validation bypass, because server 98 runs PowerShell 5.1.

Supporting docs: `CUTOVER-RUNBOOK.md`, `CUTOVER-3AM-STEPS.md`, `INCIDENT-RUNBOOK.md`, `SERVER98-3SCALE-TEST-RUNBOOK.md`, `DEPLOY-QP-STEPS.txt`.

---

## 5. Workstream B — the HTTP 500, root cause and fix

**Symptom.** `GetSPComplaintsData` returned HTTP 500 for specific complaints — reproduced on `REQ000003020009` / service `FTTH11073707`.

**Root cause.** SQL Server **Msg 512** — a scalar subquery returning more than one row. `CITC_SDM_CODE_MAPPING` held **duplicated tier-triples** (Tier 1 / Tier 2 / Tier 3 combinations), so the correlated lookup inside the view returned multiple rows for those categories and the view blew up for exactly those complaint categories and no others.

**Fix.** A `ROW_NUMBER() … WHERE rn = 1` CTE that collapses the duplicates. Built and validated by the DBA team in `ITC_CITC_MOH_NEW`.

**Deploying the fix — the trap.** The swap appeared not to take effect. Diagnosis: the `sp_rename` statements were **pending, uncommitted GUI changes in DBeaver** (asterisks `*` in the tab titles) — they were never executed. Verify with `sys.objects`: if `ITC_CITC_MOH` still carries its original `object_id` and `_now` still exists, nothing ran.

**`COUNT(*)` succeeding on the broken view is a red herring** — SQL Server does not evaluate the scalar subqueries for a count, so the view looks healthy until you select the actual columns.

SQL assets in `cst-hybrid-java/sql/`:
`diagnose-GetSPComplaintsData-500.sql` · `fix-dedupe-CITC_SDM_CODE_MAPPING.sql` *(internal only — never shared with the DBA team)* · `validate-ITC_CITC_MOH_now.sql` · `swap-ITC_CITC_MOH.sql` · `ALTER-ITC_CITC_MOH-only.sql` · `check-ticket-not-found.sql` · `find-ticket-in-base-tables.sql`

Email sent to the DBA team: `EMAIL-DBA-CITC-mapping-dedupe.html` — findings and the urgent ask, no SQL attached, per §2 rule 1.

---

## 6. Workstream C — who owns the REQ ⇄ INC mapping

**Answer: Remedy does, through `SRID`. Neither CST nor the legacy .NET project performs the mapping.**

The .NET service reads `ITC_CITC_MOH`, which already carries `Service_RequestID` sourced from `SRID` on both underlying forms. There is no translation table, no lookup service, no mapping logic in `SalamAPIController`. Any claim that "the integration lost the link" is false — the link is a column.

---

## 7. Workstream D — WO vs INC escalation (thread GR0000486042)

**Question.** Should work orders (WO) be exposed to CST alongside incidents (INC)?

- **Scenario 1** — route WOs through the middle layer. **Blocked.** The block is an *application-level* `"Not a Complaint"` gate, one of the six mandated failure messages in CITC006001 v6.2 — not a view filter. No amount of view surgery avoids it; it would require development in the legacy .NET service that has no maintained source.
- **Scenario 2** — keep INC as the single escalation object. **Chosen.** No development, no CST-facing risk, transparent to the regulator.

**The residual risk and its answer.** L1 may raise tickets for Terminated / Pending / Cancelled accounts. Handled by call-centre alignment plus alerts on those account states — IT offers support for the check. This was the core of the reply to Abdul Haque.

Artefacts: `CST-WO-Escalation-Analysis.md` · `REPLY-Scenario2-CST-escalation.html` · `REPLY2-AbdulHaque-Scenario2-confirm.html` · `check-WO-escalation-readiness.sql`

---

## 8. Workstream E — complaint analytics and reporting

Two datasets, two different things. Do not mix them.

### Dataset 1 — the July "accepted complaints" sample (235)
CST report «عينات الشكاوى المقبولة – يوليو 2026م». Carries the causing-party field `الاسم (المسبب للشكوى)`. This is the dataset that was **fully correlated with Remedy** — the 100 % traceability proof lives here.

Internal classification rule used:
- `IT` ⇐ cause = `عدم قيام مقدم الخدمة بتنفيذ طلب الشاكي وإلغاء (الرقم/الخدمة)` → 53 complaints
- `NET` ⇐ everything else → 182 complaints
- **Any network issue is not IT** — this was an explicit instruction and it holds throughout.

### Dataset 2 — the complete escalated list (1 631)
Export «تقرير الشكاوي المصعدة الشامل» from RA, 1 Jul → 8 Sep 2026, 31 columns, richer: region/city, complaint status, current stage, closure reason and date, escalation reason, escalation description, count of statement requests (`عدد طلبات الإفادة`). **No causing-party column**, so the classification is derived from `نوع شكوي رئيسي` instead:

| Main complaint type | Domain | Code | In IT scope? |
|---|---|---|---|
| تدني مستوى خدمة أو انقطاعها | الشبكة والعمليات الميدانية | `NET` | No |
| إلغاء أو تعليق (رقم - خدمة) | مركز الاتصال والعمليات | `CC` | No |
| فواتير والتزامات مالية | الفوترة والتحصيل | `BIL` | **Yes** |
| عدم تفعيل خدمة او تطبيق مزاياها | التفعيل والتزويد | `PRV` | **Yes** |
| تأسيس (رقم - خدمة) دون طلب المستخدم | المبيعات والتأسيس | `SAL` | No |
| نقل رقم أو عدم نقل رقم من مشغل لآخر | نقل الأرقام | `MNP` | **Yes** |

**IT scope = BIL + PRV + MNP only.** The rule is deliberately derived from CST's own field with no re-interpretation, so the classification is auditable by both sides.

### The Python pipeline

Rebuild it in the new project if reports are needed again. All scripts lived in a single working directory alongside the source files.

| Script | Produces |
|---|---|
| `analyze.py` | `data.json` — 235-row aggregates + daily calendar |
| `it53.py` | `it53.json` — the 53 IT tickets + an outcome classifier over the الافادة free text |
| `full_analyze.py` | `full1631.json` + `recs1631.json` — the complete-list aggregates and per-row records |
| `charts.py` | Hand-built inline-SVG chart library (see §11) |
| `build_report.py` / `build_it53_report.py` / `build_corr_report.py` / `build_full_report.py` / `build_1631.py` / `build_cio.py` | RTL HTML reports |
| `topdf*.py` | Playwright/Chromium `page.pdf()` → A4 PDF |
| `*_xlsx.py` | openpyxl workbooks |
| `gen_sql_1631.py` | The Remedy correlation SQL (§9) |

**The canonical outcome classifier** (applied to `الافادة الاساسية لمقدم الخدمة`, used consistently across all reports — reuse it verbatim so numbers stay comparable):

```python
def norm(t): return re.sub(r'\s+',' ',str(t or '')).strip()

def outcome(t):
    t = norm(t)
    pend = ('جاري' in t) or ('تمديد المهلة' in t)
    canc = any(k in t for k in ('تم الغاء','تم إلغاء','الخدمة ملغاة','تم الالغاء',
                                'الموافقة على إلغاء','بالغاء الخدمة','تم اغلاق'))
    comp = any(k in t for k in ('تسوية','تعويض','دون احتساب','اعفاء','إعفاء'))
    if pend and not canc: return 'قيد المعالجة / طلب تمديد المهلة'
    if canc and comp:     return 'أُلغيت الخدمة مع تسوية مالية'
    if canc:              return 'أُلغيت الخدمة بعد التصعيد'
    if comp:              return 'تسوية مالية دون تأكيد الإلغاء'
    return 'غير محدد في الإفادة'
```

Classify from the **full** statement text, not a truncated copy — truncating to 900 chars silently changed two rows and moved the contradiction count from 18 to 16.

---

## 9. Workstream F — the Remedy correlation SQL

**File:** `cst-hybrid-java/sql/map-1631-CST-to-remedy.sql` (~210 KB, 1 907 lines)
**Run on: server `172.30.1.14`, database `ARSystem`. Read-only — no DML against production tables.**

**Structure:** loads all 1 631 complaints into `#cst` (chunked `INSERT … VALUES`, 200 rows per statement) → verifies column names → collects matching tickets into `#tk` → eight result sets.

| # | Query | What it settles |
|---|---|---|
| 1 | Coverage | How many complaints have a real INC / WO; **must show 0 with no record** and 0 non-CTT |
| 2 | Exception list | The complaints with no internal record at all — expected empty |
| 3 | Coverage by domain | Per-domain INC/WO counts |
| 4 | Closure outcome by domain | Tier 1 × Tier 3 |
| 5 | **Unreachable by domain** | The decisive indicator — closure practice vs technical fault |
| 6 | Ticket status by domain | Remedy status distribution |
| 7 | Ticket-creation → escalation lag | The numeric basis for the SLA discussion |
| 8 | Detailed export | One row per complaint — paste into Excel, this is the evidence file |

### Running it — DBeaver

1. Connection selector at the top must read `ARSystem` / `dbo@ARSystem`.
2. **File → Open File** — do not copy-paste the script.
3. **Alt + X** (Execute script). **Never Ctrl + Enter** — that runs one statement, and `#cst` / `#tk` will not exist for the rest.
4. Do not split the run across tabs or reconnect mid-way: the temp tables are session-scoped.
5. Watch the first two results — "عدد الشكاوى المحمّلة" must be **1631**, then the column-name check.

### Four defects fixed in this file — keep them fixed in any regenerated version

| Symptom | Cause | Fix |
|---|---|---|
| `Msg 156: Incorrect syntax near 'INTO'` | DBeaver split the `SELECT … INTO #tk` statement at the `INTO` line | Use `CREATE TABLE #tk (...)` + `INSERT INTO #tk … SELECT`. Never `SELECT … INTO` in a script meant for DBeaver. |
| `Msg 207: Invalid column name 'WorkOrder_ID'` | Wrong column name | `Work_Order_ID` |
| Everything pastes as one line | LF-only line endings, collapsed by the macOS clipboard | Write the file **CRLF**, UTF-8 **with BOM** |
| Text reordered on paste | Arabic in `/* comments */` triggered bidi reordering | **Comments ASCII/English only.** Arabic stays in `N'…'` literals and `[column aliases]`, where it is safe and keeps the output readable. |

A defensive `INFORMATION_SCHEMA.COLUMNS` check sits between steps 1 and 2 so a column-name drift shows up as a result set instead of a failed run.

Earlier equivalents, same shape: `map-53-IT-to-remedy.sql`, `map-all-235-to-remedy.sql`.

---

## 10. Verified findings — the numbers to quote

> Snapshots. Re-run §9 before putting any of this in front of CST.

### 10.1 The July sample (235) — correlated with Remedy

| Finding | Figure |
|---|---|
| Complaints with a real INC in Remedy, all flagged `CTT` | **235 / 235 — 100 %** |
| Complaints with no internal record | **0** |
| Work orders | 98, across 70 complaints — **all network side, 0 for IT** |
| Split | NET 182 (77 %) · IT 53 (23 %) |
| **`Unreachable` closures** | **IT 25 (47 %)** vs **NET 1 (0.5 %)** |
| `Retention` path | IT 33 (62 %) vs NET 11 (6 %) |
| **Own statement to CST contradicts the "unreachable" closure** | **18 of those 25** — service later cancelled or invoice settled |
| IT ticket status | Closed 47 · Assigned 6 |
| NET ticket status | Closed 142 · Cancelled 34 · Assigned 6 |
| NET Tier 3 | Link down 93 · Internet slowness 25 · No browsing 15 · Frequent disconnections 15 |
| Ticket → escalation lag | 0-5 d: 50 · 6-15 d: 128 (54 %) · 16-30 d: 24 · 31-60 d: 15 · >60 d: 18 → **79 % escalated after day 5** |

**The argument this supports:** the intake, ticket creation and CST integration all worked. `Unreachable` at 47 % in one category and 0.5 % in the other is a closure *practice*, not a system fault — and 18 cases where our own statement to the regulator contradicts our internal closure is the most exposed item in the file. Remediation is procedural; it needs no development.

### 10.2 The complete list (1 631) — 1 Jul → 8 Sep 2026

| Domain | Count | Share |
|---|---|---|
| الشبكة والعمليات الميدانية (`NET`) | 948 | 58.1 % |
| مركز الاتصال والعمليات (`CC`) | 272 | 16.7 % |
| الفوترة والتحصيل (`BIL`) | 208 | 12.8 % |
| التفعيل والتزويد (`PRV`) | 145 | 8.9 % |
| المبيعات والتأسيس (`SAL`) | 51 | 3.1 % |
| نقل الأرقام (`MNP`) | 7 | 0.4 % |
| **IT scope = BIL + PRV + MNP** | **360** | **22 %** |

| Dimension | Figures |
|---|---|
| **Escalation reason** | **5-day breach 872 (53.5 %)** · dissatisfaction with the outcome 759 (46.5 %) |
| Status | Closed 1 286 (79 %) · **still open 345 (21 %)** |
| Closure lag (escalation → closure, closed only) | 0-5 d: 512 (39.8 %) · 6-15 d: 598 (46.5 %) · 16-30 d: 148 (11.5 %) · 31-60 d: 28 (2.2 %) · >60 d: 0 |
| Average / median closure | 9.0 days / 7 days |
| Median by domain | NET 7 · CC 6 · IT 7 |
| Top sub-types | انقطاع الخدمة 493 · تدني مستوى الخدمة 455 · عدم تنفيذ طلب الإلغاء 247 · خطأ في احتساب الفاتورة 128 · عدم تفعيل خدمة 99 |
| Regions | Riyadh 715 · Eastern 366 · Makkah 277 → **83 % in three regions** |
| Statement requests | 675 complaints (41 %) had at least one |
| Service / subscription | Fixed 1 604 · mobile 26 — internet 1 602 · voice 28 — postpaid 1 428 · prepaid 203 |
| Daily average | 23.3 complaints/day over 70 days |

**The three strongest new arguments:**
1. **53 % of escalations are a five-day-deadline breach, not a bad resolution.** The highest-leverage, lowest-cost commitment is a fixed internal-intervention date, not a shorter final resolution SLA.
2. **345 complaints are still open** at CST — the only cohort whose outcome can still be changed. Daily follow-up, before they turn into adjudication decisions against Salam.
3. **Never commit to one SLA across categories.** Cancellations are a desk action (0 field work orders); network faults are governed by site-access time (98 WOs on 70 complaints in the sample). One blanket period will be measured against us in the category whose clock we do not control.

**Caveat that must travel with the 1 631 report:** the 100 %-traceability / zero-IT-failure claim is proven on the 235 sample only. It is not yet proven on the full list — that is what §9 exists to settle.

---

## 11. Toolchain and traps

### Arabic RTL PDF generation
Pipeline: hand-built inline SVG charts → RTL HTML → Playwright/Chromium `page.pdf()`. Fonts: Noto Sans Arabic / Noto Kufi Arabic / Noto Naskh Arabic, installed via apt.

| Trap | Fix |
|---|---|
| Chart labels mirrored | Every `<svg>` needs `style="direction:ltr"`, or RTL flips `text-anchor` |
| Every paragraph clipped | A single element wider than the printable box widens the layout box. A4 at 12 mm margins = **703 px usable** — keep charts ≤ 655 px |
| `.kpi` numbers collapsing | `.kpi .n` and `.kpi .l` need `display:block` |
| Latin text scrambled inside RTL table cells | `unicode-bidi:isolate` |
| Arabic broken inside `<code>` | Don't set a monospace font on Arabic — let it inherit |
| Tables overrunning the footer | `@page{margin:12mm 12mm 20mm 12mm}` **in the CSS** — `pg.pdf(margin=…)` is ignored when the stylesheet declares `@page{margin:0}`. Plus `.tb tr{break-inside:avoid}` |
| Half-empty pages | `break-inside:avoid` on a block that doesn't fit pushes the whole thing over. Wrap heading+table+note in one `.keep` div and drop `page-break-before` where the section can flow |
| `الحالات الـ18` renders as `الحالات18الـ` | Arabic definite article glued to a Latin-digit number. Rephrase — `(18 حالة)` or spell the number out |
| openpyxl `StyleProxy` unhashable | Don't read a font back off a cell and reuse it; build a fresh `Font()` |

Palette (dataviz skill, light): `#2a78d6` · `#eb6834` · `#1baf7a` · `#eda100`

`charts.py` exposes: `donut` · `legend` · `hbar_rtl` · `grouped_bar` · `vbar` · `line` · `line_lab` (labelled x-axis, for multi-month series) · `_nice`.

### DBeaver
- `SELECT REPLACE(OBJECT_DEFINITION(...))` **only prints** the script — it does not execute it. Copy the output into an editor and run it.
- The grid truncates long text: use **Shift + Enter** to open the value viewer.
- `GO` breaks Ctrl+Enter; use **Alt + X** to run a whole file.
- Asterisks in tab titles mean **pending, unexecuted** GUI changes. Renames that "didn't reflect" were sitting there unrun.

### WhatsApp Arabic formatting
- Latin words inside Arabic lines reorder on paste. Isolate each Latin run with RLM (`U+200F`) on both sides, and end every line with an RLM to anchor punctuation.
- Prefer Arabic terms where possible (`ريميدي` instead of `Remedy`) — fewer isolation points, fewer failures.
- Copy from the `.txt` file, never retype from the screen: the control characters are invisible and get lost.
- Helper used: `wa_fix.py` — regex-isolate Latin runs, append RLM per line.

---

## 12. Deliverables produced

All under `~/Documents/Claude/Projects/CST Escalations/` on the MacBook.

**Reports (Arabic, A4 PDF)**
- `موجز-تنفيذي-CIO-شكاوى-الهيئة-يوليو-2026.pdf` — one page, CIO-ready
- `تقرير-الأدلة-الكامل-ربط-235-شكوى-بـRemedy-يوليو-2026.pdf` — 8 pages, the evidence file
- `تحليل-الشكاوى-المصعدة-الكامل-يوليو-سبتمبر-2026.pdf` — 9 pages, the full 1 631
- `تقرير-تحليل-شكاوى-CST-يوليو-2026.pdf` — the original monthly classification report
- `تقرير-شكاوى-تقنية-المعلومات-وربطها-بـRemedy-يوليو-2026.pdf` · `تقرير-الربط-الكامل-مع-Remedy-يوليو-2026.pdf`

**Workbooks**
- `ملف-الأدلة-ربط-235-شكوى-بسجلات-Remedy-يوليو-2026.xlsx` — 6 sheets, the 18 contradictions flagged
- `ورقة-تصنيف-الشكاوى-المصعدة-1631-يوليو-سبتمبر-2026.xlsx` — 6 sheets incl. open-only and IT-scope tabs
- `بيانات-الشكاوى-مصنفة-يوليو-2026.xlsx` · `ربط-الشكاوى-53-بـRemedy-مكتمل-يوليو-2026.xlsx` · `ورقة-ربط-شكاوى-تقنية-المعلومات-بـRemedy-يوليو-2026.xlsx`

**Correspondence**
- `REPLY-Atif-CST-Minutes-Position.html` — the IT position: peer tone, for RA first and as CIO proof
- `REPLY-Scenario2-CST-escalation.html` · `REPLY2-AbdulHaque-Scenario2-confirm.html`
- `Reverse-Engineered/EMAIL-DBA-CITC-mapping-dedupe.html`
- `WhatsApp-Group-Ops-task-force.txt` (safe, no attachments) · `WhatsApp-Ali-Atif-DIRECT.txt` (full, 3 attachments)

**SQL** — `Reverse-Engineered/cst-hybrid-java/sql/` (see §5 and §9)
**Ops** — `Reverse-Engineered/cst-hybrid-java/ops/` (see §4)

---

## 13. Open items

| # | Item | Notes |
|---|---|---|
| 1 | **Run `map-1631-CST-to-remedy.sql`** and fold the output into the full-list report | Until then the 100 %-traceability claim covers only the 235 sample |
| 2 | Email the findings to Atif and the IT team | Draft the mail once #1 lands |
| 3 | IIS canary cutover on server 98 | Prepared and gated, never executed (§4) |
| 4 | Java **5-day rule is inverted** | Confirmed bug, unfixed |
| 5 | Multi-row REQ **last-row/first-row parity bug** | Confirmed bug, unfixed |
| 6 | Clarify the 34 `Cancelled` network tickets | Needs an internal answer before it is shown to CST — "cancelled complaint" reads as neglect to a regulator |
| 7 | The 6 Sep minutes (.docx) were never available in-session | The reply references "الملاحظات والمدد الواردة في المحضر" generically. Map each observation to an evidence item once the document is in hand |

---

## 14. Ready-to-use prompts for the new project

**Resume the correlation**
> Here is the output of `map-1631-CST-to-remedy.sql` run on server 172.30.1.14 / database ARSystem. Fold queries 1, 3, 5 and 7 into the full-list Arabic report as a new "المطابقة مع Remedy" section, then rebuild the PDF. Keep the existing chart style and the 655 px width limit.

**Rebuild a report from a new CST export**
> New escalated-complaint export attached. Re-run the classification in §8 of the runbook (domain from `نوع شكوي رئيسي`, IT scope = BIL + PRV + MNP), regenerate the Arabic PDF and the 6-sheet workbook, and tell me what moved versus the last period.

**Regenerate the correlation SQL for a new period**
> Generate the Remedy correlation SQL for the attached complaint list, following §9: `CREATE TABLE` + `INSERT` (never `SELECT … INTO`), `Work_Order_ID` with the underscore, CRLF line endings, UTF-8 BOM, ASCII-only comments, Arabic only in `N'…'` literals and `[aliases]`. Target server 172.30.1.14, database ARSystem, read-only.

**Draft external correspondence**
> Draft an email to <team>. Findings and the ask only — no solution, no plan, no scripts, no SQL attachments. Arabic, RTL, HTML, well presented. IDs masked to the last 4 digits.

**Draft internal correspondence**
> Draft the IT position for Atif — peer tone, not reporting upward. Purpose: arm RA with numbers for the CST response, and serve as proof to the CIO. Include the decisive contrast, the contradiction count, and the three SLA arguments. Arabic, RTL, HTML.

---

*Restricted — Salam Telecom, Digital Operations. Figures are snapshots as at 8 Sep 2026; re-verify against live data before any regulatory submission.*
