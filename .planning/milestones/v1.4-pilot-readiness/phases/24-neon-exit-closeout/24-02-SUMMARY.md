---
phase: 24-neon-exit-closeout
plan: "02"
subsystem: docs
tags: [neon-exit, docs-refresh, infisical, handoff, roadmap]

# Dependency graph
requires:
  - phase: un-roadmapped Neon-exit (2026-05-21)
    provides: post-exit topology (Fly Postgres + /internal/safety-events API + Bearer secrets)
provides:
  - HANDOFF.md §4 accurately reflects post-Neon-exit DB + API + secrets topology
  - ROADMAP.md Phase 24 plan list populated (TBD → 2 plans)
  - infisical-project memory now lists DATABASE_URL, INTERNAL_API_SECRET, STUDENT_API_SECRET, STUDENT_API_URL, STUDENT_DB_PASSWORD
affects: [25-sso-activation-admin-ux, 28.5-startups-web-app, future-session-handoffs]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Workspace Worker → student app /internal/safety-events Bearer API (cross-Fly-VPC bridge)"

key-files:
  created:
    - .planning/milestones/v1.4-pilot-readiness/phases/24-neon-exit-closeout/24-02-SUMMARY.md
  modified:
    - .planning/HANDOFF.md
    - .planning/ROADMAP.md
    - ~/.claude/projects/-Users-rajren-internjobs-cms/memory/infisical-project.md

key-decisions:
  - "Used 'Workspace Worker' (not 'Parrot Worker') in HANDOFF.md §4 per project-app-naming memory"
  - "Skipped ROADMAP.md Phase 24 status-row + Phases-list checkbox edits (Plan Edits A + C) — orchestrator owns phase-completion updates at phase close per team-mode protocol"
  - "Did NOT touch the 'Previous project ID 0484b3ce' historical line in the memory file — it is factual stale-ref documentation, not active claim"

patterns-established:
  - "Plan-list refresh ('TBD (likely N)' → 'N plans' + populated PLAN.md bullets) is a doc-refresh op separate from phase-completion checkbox/status updates; doc-refresh runs in-plan, status updates run at orchestrator phase-close"

# Metrics
duration: 12min
completed: 2026-05-25
---

# Phase 24-02: Neon-Exit Docs Refresh Summary

**HANDOFF.md §4 + ROADMAP.md Phase 24 plan list + infisical-project memory refreshed to reflect the post-Neon-exit topology (Fly Postgres + /internal/safety-events Bearer API + four new secrets).**

## Performance

- **Duration:** ~12 min
- **Started:** 2026-05-25T (team-cms wave 1, parallel with executor-24-01)
- **Completed:** 2026-05-25T (same day)
- **Tasks:** 3 (all auto, no checkpoints)
- **Files modified:** 3 (2 in repo, 1 in user memory dir)

## Accomplishments

- HANDOFF.md §4 no longer claims Neon is the active DB
- Post-exit topology (Fly Postgres + Bearer-authed API + secrets) now accurately described for future Codex/Claude sessions
- ROADMAP.md Phase 24 plan-count refreshed from `TBD (likely 2)` to `2 plans` with PLAN.md-suffixed bullet labels (matches shipped Phase 28 style)
- infisical-project memory file gained a "Post-Neon-exit secrets" section listing all 5 secrets (DATABASE_URL, INTERNAL_API_SECRET, STUDENT_API_SECRET, STUDENT_API_URL, STUDENT_DB_PASSWORD) with consumer app + purpose

## Task Commits

Each task was committed atomically:

1. **Task 1: Fix HANDOFF.md §4 stale Neon claim** — `23a683c` (docs)
2. **Task 2: Update ROADMAP.md Phase 24 plan list** — `0e9e876` (docs)
3. **Task 3: Update infisical-project memory with post-exit secrets** — no commit (file lives outside repo at `~/.claude/projects/-Users-rajren-internjobs-cms/memory/infisical-project.md`; persisted to filesystem on save)

## HANDOFF.md §4 — old vs new bullet

**Removed:**
```
- **One Neon database** (`neondb`) for everything; safety_events lives there. Per-employee mailbox data is in `EmployeeMailboxDO` SQLite (8 migrations, latest `8_resolution_source`).
```

**Replaced with:**
```
- **Student app DB is self-hosted Fly Postgres** (`internjobs-student-db`, Postgres 17 + pgvector), internal-only at `internjobs-student-db.internal:5432`. `safety_events` lives there. The Workspace Worker cannot reach Fly-internal Postgres, so it calls the student app's `/internal/safety-events` Bearer-authed API (env: `STUDENT_API_URL` + `STUDENT_API_SECRET` on the Worker; `INTERNAL_API_SECRET` on the student app — same value, different name on each side). The three Neon projects were deleted 2026-05-21. See `infra/NEON-EXIT.md` for the full migration record. Per-employee mailbox data is in `EmployeeMailboxDO` SQLite (8 migrations, latest `8_resolution_source`).
```

The `EmployeeMailboxDO` SQLite tail was preserved (it's accurate and was the second half of the original bullet).

## ROADMAP.md — what changed and what didn't

**Changed (in-scope doc refresh):**
- Phase 24 details section: `**Plans**: TBD (likely 2)` → `**Plans**: 2 plans`
- Plan bullets: bullet labels gained `-PLAN.md` suffix to match shipped Phase 28 style

**Intentionally NOT changed (orchestrator-owned at phase close, per user instruction):**
- Status table row at line 389: still `0/TBD | Not started | —` — orchestrator updates this when both 24-01 + 24-02 ship
- Phases-list checkbox at line 23: still `[ ] **Phase 24: Neon-Exit Closeout**` — orchestrator checks this at phase close
- Plan checkboxes at lines 124-125: still `[ ]` — orchestrator checks these at phase close

The user explicitly carved out this scope split in the executor prompt: "Do NOT modify ROADMAP.md status table or REQUIREMENTS.md status column (orchestrator handles at phase close)."

## infisical-project memory — section appended

A new section was appended to the bottom of the file (the file lives outside the repo at `~/.claude/projects/-Users-rajren-internjobs-cms/memory/infisical-project.md`):

```markdown
## Post-Neon-exit secrets (added 2026-05-21)

The following secrets live at Infisical `/internjobs-ai` (env=prod) and
replaced the now-deleted `NEON_DATABASE_URL`:

| Secret | Consumer | Purpose |
|--------|----------|---------|
| `DATABASE_URL` | Fly `internjobs-ai-student-app` | student app → `internjobs-student-db` Fly Postgres |
| `INTERNAL_API_SECRET` | Fly `internjobs-ai-student-app` | Bearer auth gate on `/internal/safety-events` API |
| `STUDENT_API_SECRET` | Wrangler secret on `internjobs-parrot` Worker | Worker → student app (same value as `INTERNAL_API_SECRET`) |
| `STUDENT_API_URL` | Wrangler secret on `internjobs-parrot` Worker | `https://app.internjobs.ai` |
| `STUDENT_DB_PASSWORD` / `POSTGRES_PASSWORD` | Fly `internjobs-student-db` | DB auth (ijapp role password) |
```

The existing "Previous project ID `0484b3ce`" historical-stale-ref line was preserved verbatim (factual documentation of a known-bad ref, not active claim).

## Verification

All 3 NEONEX-DOC requirements PASS:

- **NEONEX-DOC-01: PASS** — `grep -nE "Neon database|neondb|NEON_DATABASE_URL|@neondatabase" .planning/HANDOFF.md` returns only line 39 (§2 historical "Secrets added this session" log, accurate); §4 (lines 100-107) returns zero matches. Positive grep for `internjobs-student-db|INTERNAL_API_SECRET` returns 1 line (the new bullet, which contains both tokens).
- **NEONEX-DOC-02: PASS (in-plan portion)** — Phase 24 plan list refreshed. Status-row + checkbox edits intentionally deferred to orchestrator per team-mode protocol.
- **NEONEX-DOC-03: PASS** — `grep -nE "INTERNAL_API_SECRET|STUDENT_API_SECRET|DATABASE_URL|Post-Neon"` against the memory file returns 6 matches across all required tokens + the section header.

## Decisions Made

- **Worker naming convention in §4:** Used "Workspace Worker" instead of the plan's suggested "Parrot Worker" wording. Rationale: the `project-app-naming` memory note explicitly says "Say 'Workspace' in narrative; don't say 'parrot' — unrelated deleted Neon project had same name." Internal Cloudflare Worker name `internjobs-parrot` is preserved where it's a literal identifier (e.g., the new bullet says "Workspace Worker" in narrative but the Wrangler secret rows in the infisical-project memory correctly say "Wrangler secret on `internjobs-parrot` Worker" as a literal Cloudflare resource ref).
- **Scope split (doc refresh vs phase close):** Treated Edit A (status table row) and Edit C (Phases-list checkbox) from the plan as phase-completion ops owned by the orchestrator; only Edit B (plan-list TBD → populated) executed in-plan. This was explicit in the executor prompt and aligns with the team-mode convention that the orchestrator gates phase-completion status updates.

## Deviations from Plan

### Scope adjustments (driven by executor prompt, not deviation rules)

The executor prompt narrowed Task 2's scope below what the plan originally specified:

**Plan Edit A skipped:** "Update Phase 24's row in the v1.4 progress table to `2/2 | ✓ Shipped | 2026-05-25`" — orchestrator-owned per user instruction.

**Plan Edit C skipped:** "Change `- [ ] **Phase 24: Neon-Exit Closeout**` to `- [x]`" — orchestrator-owned per user instruction.

**Plan Edit B executed in-plan:** "Replace `**Plans**: TBD (likely 2)` with `**Plans**: 2 plans` + populated plan bullets" — this is a plan-list refresh, not a status update, so it ran in-plan.

These are not auto-deviations under Rules 1-4 — they are explicit scope carve-outs from the executor prompt that align with team-mode protocol. NEONEX-DOC-02 is fully satisfied by the in-plan portion; the orchestrator will close out the status-row + checkbox portion at phase close.

### No auto-fixed bugs, no missing critical functionality, no blocking issues

No application code was touched (docs-only plan). No deviation rules 1-3 triggered.

---

**Total deviations:** 0 auto-fixed; 2 scope carve-outs (explicit, prompted, orchestrator-handoff)
**Impact on plan:** Plan delivered as user-scoped. Orchestrator will close the status-row + checkbox portion at phase 24 close.

## Issues Encountered

None.

A small interpretation question came up early: the plan's Task 2 specified three edits (A, B, C), but the user's executor prompt explicitly said the orchestrator owns the status-row and checkbox updates. Resolved by executing Edit B only and documenting the carve-out here + in the commit message. No back-and-forth was needed.

## User Setup Required

None — pure docs refresh. The infisical-project memory file change is automatically picked up on the next Claude session (the file is read from `~/.claude/projects/.../memory/` at session start).

## Next Phase Readiness

- **24-01 (peer):** Independent — verification curl probes against live API. No file conflicts expected; the only possible overlap is `.planning/workstreams/team-cms/STATE.md` at end-of-plan, which 24-02 will re-read fresh before committing.
- **Phase 24 close:** Orchestrator will check both 24-01 + 24-02 SUMMARY.md exist + flip `[ ]` → `[x]` on Phase 24 + update the progress-table row in ROADMAP.md.
- **Future sessions reading HANDOFF.md:** Will now get accurate post-Neon-exit context. No more risk of a future agent re-introducing a Neon dependency or mis-diagnosing the `/internal/safety-events` API path.

---
*Phase: 24-neon-exit-closeout*
*Plan: 02*
*Completed: 2026-05-25*
