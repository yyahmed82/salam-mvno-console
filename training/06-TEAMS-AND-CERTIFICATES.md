# Teams setup & certificates — organiser runbook

Two jobs: **set the programme up in Teams before Session 1**, and **issue certificates after the
last one**. Both read from the same file, `workshop.config.json` — edit that, never the slides.

---

## 1 · Teams setup (30 minutes, once)

### Create the team and channel

1. Teams → **Join or create a team** → *Create team* → *From scratch* → **Private**.
   Name it exactly as in the config: `Salam Digital Console — Ops`.
2. Add a channel: **`Training & Enablement`** (Standard). Description:
   > Salam MVNO Digital Console operations workshop — sessions, recordings, labs and Q&A.
3. Add every attendee as a **Member**. Add yourself and the L2 leads as **Owners**.

### Set up the recurring session

4. Calendar → **New meeting** → *Make it recurring*. One recurring series for the whole
   programme — attendees keep one link, not four.
5. Meeting options:

   | Option | Set to | Why |
   |---|---|---|
   | Who can bypass the lobby | People in my organisation | No lobby friction, no outsiders |
   | Who can present | Specific people (you + co-facilitator) | Nobody screen-shares by accident mid-demo |
   | Allow mic / camera for attendees | On | They must be able to interrupt |
   | Record automatically | On | You will forget otherwise |
   | Meeting chat | On, during and after | Q&A record |

6. **Channel-post the meeting** so it lands in `Training & Enablement`, not just inboxes.

### Pin the resources

7. In the channel, add tabs: **Files** (upload the deck, lab guide, scenarios, cheat-sheet),
   and a **Website** tab pointing at the console URL.
8. Pin one post at the top of the channel with all five links.

### Collect the links

Copy each link into `workshop.config.json`:

| Config key | Where to get it |
|---|---|
| `teams.session_join_url` | Calendar → the recurring meeting → *Copy link* |
| `teams.channel_url` | Channel → ⋯ → **Get link to channel** |
| `teams.group_chat_url` | Chat → the group → ⋯ → *Copy link* (optional) |
| `teams.recordings_url` | Files tab → `Recordings` folder → **Copy link** (set to *People in your org*) |
| `teams.files_url` | Files tab → **Open in SharePoint** → copy the folder link |

Then rebuild — the links and their QR codes appear on the *Where everything lives* slide:

```bash
cd mvno-console/training && python3 build_workshop.py
```

> Any link left as `PASTE_…` renders as *"link to be added before session 1"* rather than breaking
> the slide. Safe to build early — but don't present it that way.

### Attendance

Teams gives you the register for free, and it's what the certificates are built from:

> During the meeting → **People** → ⋯ → **Download attendance list** (CSV).

Do this **before you end each meeting** — after it ends, the download disappears from the
meeting window and you have to dig it out of the Teams admin centre. Save each one as
`attendance-S1.csv` … `attendance-S4.csv`.

---

## 2 · Certificates (15 minutes, after the last session)

### Fill the roster

Edit `attendees.csv` — one row per person:

```csv
name,email,role,s1,s2,s3,s4,quiz_score,notes
Mohammed Al-Otaibi,m.alotaibi@salam.sa,L1 Support,Y,Y,Y,Y,88,
Sara Khan,s.khan@salam.sa,L2 Digital,Y,Y,Y,N,74,missed session 4
```

- `s1`–`s4` — `Y`/`N` (also accepts `yes`, `1`, `x`, `✓`). Take these from the Teams attendance CSVs.
- `quiz_score` — percentage, from the Kahoot final leaderboard or the written quiz in `04-QUIZZES.md`.
  Leave blank if they didn't sit it.
- Use each person's **name as they want it printed**. It appears in 34pt on the certificate.

### Generate

```bash
pip install reportlab segno          # segno is optional — it draws the QR code
cd mvno-console/training
python3 build_certificates.py                       # issued today
python3 build_certificates.py --date 2026-09-30     # or a specific issue date
```

Output lands in `certificates/`:

| File | Use |
|---|---|
| `<Name>.pdf` | Email to that person — one page, A4 landscape, vector (prints crisply at any size) |
| `ALL-certificates.pdf` | One print job for the whole cohort |
| `register.csv` | **Keep this.** The issue register — what makes a certificate verifiable |

### The two grades

The script decides the grade from the roster, so the certificate means something:

| Grade | Requires | Reads |
|---|---|---|
| **Completion** | all 4 sessions **and** score ≥ 70% | *"has successfully completed the…"* |
| **Attendance** | at least 3 sessions | *"attended the…"* |
| *(none)* | fewer than 3 sessions | Skipped, and printed in the console output so you can see who |

Thresholds live in `workshop.config.json` → `certificate`. Change them there if the cohort
warrants it — but change them *before* you issue, not after someone complains.

### Signatures

`workshop.config.json` → `signatories` — up to two. Leave a `name` blank to print the title with an
empty rule above it for a wet signature. For a digital signature, sign `ALL-certificates.pdf` in
Adobe Acrobat after generating.

### Verification IDs

Each ID — e.g. `SDC-2026-56F3-0B9F` — is a deterministic hash of programme + cohort + name + email.
Two consequences worth knowing:

- **Re-running the script gives the same person the same ID.** Safe to regenerate after fixing a typo
  elsewhere in the row.
- **Changing someone's name or email changes their ID.** If you correct a spelling after issuing,
  re-issue and keep both rows in the register with a note.

When someone asks whether a certificate is real, look up the ID in `register.csv`. That's the whole
verification story — no service to run, no link to keep alive.

---

## 3 · Sending them

Attach the individual PDF and the person's own line from the register. Suggested note:

> Attached is your certificate for the Salam MVNO Digital Console Operations Workshop.
>
> **Grade:** Certificate of Completion · **Sessions:** 4 of 4 · **Assessment:** 88%
> **Certificate ID:** SDC-2026-56F3-0B9F
>
> The console is at *(link)*, the channel stays open for questions, and the L1 cheat-sheet is
> pinned in Files. If a number ever looks wrong to you, say so in the channel — that's how the
> last three defects were found.

Post the cohort summary in the channel too — *"12 attended, 9 completion, 3 attendance"*. People
who got attendance-only can see the re-sit route without being singled out.

---

## Checklist

**Before Session 1**

- [ ] Team + `Training & Enablement` channel created, everyone added
- [ ] Recurring meeting created and channel-posted, options set, auto-record on
- [ ] Files tab loaded: deck, lab guide, scenarios, cheat-sheet
- [ ] All five links pasted into `workshop.config.json`, deck rebuilt
- [ ] Accounts created and verified per `05-USER-SETUP-RUNBOOK.md` §3

**Each session**

- [ ] Download the attendance CSV **before ending the meeting**
- [ ] Record the Kahoot round scores
- [ ] Post the recording link in-channel

**After the last session**

- [ ] `attendees.csv` completed from the attendance CSVs + final leaderboard
- [ ] `python3 build_certificates.py` run, output reviewed
- [ ] `register.csv` filed with Digital & MVNO Operations
- [ ] Certificates emailed, cohort summary posted in-channel
