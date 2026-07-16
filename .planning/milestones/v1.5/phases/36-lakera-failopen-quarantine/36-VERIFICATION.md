---
phase: 36-lakera-failopen-quarantine
verified: 2026-07-16T19:08:49Z
status: human_needed
score: 8/8 automated must-haves verified; live deploy + boot-check DONE 2026-07-17; 1 item (a real flagged email landing in Spam) still open
live_progress_2026_07_17:
  deployed: "internjobs-parrot version 3347a2c7 — deployed and boot-checked live (/api/health 200 x3, real JSON, no workerd 1101/1102 boot-error signature; the entrypoint-export trap did NOT fire). /api/inbox/messages?folder=spam returns 401 (routed, auth-gated) not 500. wrangler.jsonc cron unchanged (single */5)."
  migration_10_applied: "CONFIRMED. Operator (Nithin) signed in and the email pane loaded normally. applyMigrations() runs synchronously in the EmployeeMailboxDO constructor, so a faulty migration 10 would have errored the mailbox instead of rendering it. This closes the migration-self-application half of human item 1."
  spam_ui_renders: "CONFIRMED. Operator saw the Spam folder in the email sidebar — the first time this UI has rendered anywhere (npm run dev cannot boot locally). This closes the sidebar half of human item 2."
  still_open: "No Lakera-flagged email has arrived since deploy, so the actual SQLite write with folder_id='spam', the badge increment, the quarantined-body render inside EmailIframe, the Trust sender click-path, and the toast copy remain unobserved in production. Closing these requires an end-to-end injection email from a non-member, non-trusted sender."
human_verification:
  - test: "Send a Lakera-flagged (prompt-injection) inbound email from a NON-member, NON-trusted external sender to a real employee mailbox"
    expected: "Message appears in the Spam folder (not dropped) and the Spam sidebar count increments"
    status_2026_07_17: "STILL OPEN — deploy + migration 10 + sidebar render are confirmed live, but no flagged mail has arrived yet, so the quarantine WRITE itself is still unobserved in production."
    why_human: "The DO is fully mocked in every automated test (36-01 Risk 1, 36-04 Risk 1). No test writes to a real SQLite-backed EmployeeMailboxDO, so migration 10 self-application and the actual SQLite INSERT into emails with folder_id=spam are unproven by the suite -- only by static code reading of the constructor applyMigrations() call and the createEmail() call site."
  - test: "Load /inbox?folder=spam in a real browser against a deployed Worker, click a quarantined message, click Trust sender, and read the resulting toast"
    expected: "Spam folder renders in the sidebar with a ShieldAlert icon and count badge; the quarantined email body renders safely inside the sandboxed EmailIframe; clicking Trust sender moves that one message to Inbox and shows the exact toast copy about scope"
    why_human: "npm run dev fails to boot locally (pre-existing, unrelated to this phase -- reproduced independently below), and Clerk prod keys are domain-locked, so no human or browser has ever rendered this UI. Verified by typecheck + production build + code reading only."
    status_2026_07_17: "PARTIALLY CLOSED — the Spam sidebar item is confirmed rendering live (operator, 2026-07-17). The rest of this path (clicking a quarantined message, the EmailIframe body render, Trust sender + its confirm dialog, and the toast copy) is still unobserved because there is no quarantined mail to click yet. Blocked on the same end-to-end injection email as item 1."
---

# Phase 36: Lakera safety quarantine + fail-open confirm -- Verification Report

**Phase Goal:** Replace Lakera's silent-drop of flagged inbound email with a visible, recoverable Spam/Junk folder plus an Outlook-style "Trust sender" allowlist (Track 1), plus test-level fail-open verification and a non-fabricated Lakera tier hand-off (Track 2).

**Verified:** 2026-07-16
**Status:** human_needed
**Re-verification:** No -- initial verification

## Architectural Context Loaded

- No .planning/NORTH-STAR.md found in this repo.
- No root AGENTS.md / CLAUDE.md found.
- .planning/ROADMAP.md Phase 36 entry (quoted above) is the operative spec, dated "scope decided 2026-07-09."
- User memory phase-36-lakera-quarantine-spec.md (7 days old, flagged stale by its own system reminder) describes the initial framing of "Trust sender" as reusing the workspace-wide safety_skip_senders KV key (Option A). 36-RESEARCH.md (2026-07-16, this phase) explicitly re-opened this as an unresolved question ("the 2026-07-09 decision says 'Outlook-style' but doesn't pin down per-employee vs workspace-wide") and recommended Option B (new per-employee DO table) for semantic correctness. 36-01 implemented Option B and documented it as the locked decision. This verifier's own task brief independently confirms Option B (per-employee DO table, NOT KV repurposing) is the expected/correct answer -- so this is treated as a resolved ADQ, not a live architectural conflict. No gap.
- No other locked memory files touch email safety, Spam folders, or trust-sender scope.

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Lakera-flagged inbound email is quarantined into Spam, not dropped | VERIFIED | `inbound-email.ts:290-303` -- no `return;` remains in the `if (isHardBlock)` block; it sets `targetFolder = Folders.SPAM` and falls through to the single `createEmail(targetFolder, ...)` call at line ~362. Independently mutation-tested (see below). |
| 2 | Spam folder is visible and reachable in the Workspace email pane | VERIFIED | `inbox.tsx:19-28` FOLDERS set includes `spam`; `EmailSecondaryNav` renders a `ShieldAlert` nav item with `count={counts?.spam}` (`inbox.tsx:83-91`); `GET /api/inbox/folder-counts` returns `spam` (`workers/index.ts:394-403`). |
| 3 | Trust sender recovers the clicked message and its copy does not imply bulk recovery | VERIFIED | `EmailPanel.tsx:160-163` (`isSpamFolder` gate, `handleTrustSender` calling `api.trustSender`); `POST /api/inbox/messages/:id/trust-sender` (`workers/index.ts:502-516`) calls `trustSender(sender)` then `moveEmail(id, Folders.INBOX)`; toast copy at `InboxPane.tsx:204` reads verbatim "Moved to Inbox -- future mail from this sender skips Spam. Other Spam from them is unaffected." -- explicitly negates bulk recovery. |
| 4 | Trust is per-employee, not a workspace-wide KV repurposing, and short-circuits screening | VERIFIED | Migration `10_trusted_senders` creates a DO-local SQLite table (`migrations.ts:354-361`); `EmployeeMailboxDO.trustSender()` / `.isSenderTrusted()` use `this.ctx.storage.sql.exec` (`durableObject/index.ts:535-556`), fully separate from `PARROT_FEATURE_FLAGS` KV `safety_skip_senders`, which is untouched. `inbound-email.ts:219-227` calls `isSenderTrusted()` before `screenMessage()` is invoked (line 239). |
| 5 | 30-day spam auto-purge is genuinely wired into the existing cron, no new trigger, fails safe | VERIFIED | `app.ts:371` `ctx.waitUntil(runSpamPurge(env))` inside the existing `scheduled()` handler; `wrangler.jsonc:249` cron trigger unchanged (`["*/5 * * * *"]`) -- confirmed via `git diff --stat` across the full phase commit range (b3582bc..804dc22) showing zero changes to `wrangler.jsonc`. `spam-purge.ts:32` `RETENTION_DAYS = 30`; throttle explicitly guards `elapsed >= 0` (`spam-purge.ts:56`) so a future-dated or corrupt KV timestamp falls through to a sweep rather than wedging shut permanently. |
| 6 | Fail-open tests exist and assert the correct contract; Lakera tier item is a real open hand-off, not fabricated | VERIFIED | `safety.test.ts` (7 tests) and `inbound-email.test.ts` (7 tests) cover missing-key, 5xx, network-throw, AbortError-timeout, all fail open to `flagged:false` / `Folders.INBOX`; `flagged:true` still hard-blocks into `Folders.SPAM`. `infra/LAKERA-PRICING.md` records LAKERA-V2-03 as "STILL PENDING ... handed off to Raj," no tier or price value invented. |
| 7 | Phase constraints held: no CI file changes, no backfill, no destructive or live Lakera test | VERIFIED | `git diff --stat` across the full phase commit range touches 26 files, none under `.github/` or `apps/app/`; no `wrangler.jsonc` diff; no test calls the live api.lakera.ai endpoint (only asserts a mocked-fetch URL string); no code path attempts to recover or backfill pre-phase-dropped mail (explicitly declined in 36-01 key-decisions). |
| 8 | `workers/app.ts` (workerd entrypoint) has no non-function top-level exports | VERIFIED | `grep -nE "^export (const|let|var|function|class) "` on `app.ts` returns nothing; only exports are the two DO class re-exports and `export default {...}` (functions only). `npx wrangler deploy --dry-run` (this verifier's own run, not trusted from SUMMARY) succeeded and printed the full binding table with no bundling or resolution errors. |

**Score:** 8/8 observable truths verified against actual code, not SUMMARY claims.

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `apps/parrot/workers/lib/inbound-email.ts` | Hard-block writes to Spam, `if (!employee)` untouched | VERIFIED | No `return;` in hard-block branch; `if (!employee)` branch byte-identical (still a plain console.log + return, out of Lakera scope). |
| `apps/parrot/workers/durableObject/migrations.ts` | Migration `10_trusted_senders` | VERIFIED | `migrations.ts:354-361`, `CREATE TABLE trusted_senders (sender TEXT PRIMARY KEY, trusted_at TEXT NOT NULL DEFAULT (datetime('now')))`. No collision with migrations 1-9. |
| `apps/parrot/workers/durableObject/index.ts` | `trustSender` / `isSenderTrusted` / `purgeExpiredSpam` DO methods | VERIFIED | Lines 535-582, raw-SQL pattern matching the DO's existing house style. |
| `apps/parrot/workers/db/schema.ts` | `trustedSenders` Drizzle table | VERIFIED | Lines 72-75. |
| `apps/parrot/workers/index.ts` | `POST /trust-sender` route + `spam` in folder-counts | VERIFIED | Lines 394-403 (folder-counts), 502-516 (trust-sender route), gated by `requireEmployeeMailbox`. |
| `apps/parrot/app/routes/inbox.tsx` | `spam` in FOLDERS allowlist + sidebar nav item | VERIFIED | Line 28 (`FOLDERS` set), lines 83-91 (`SecondaryNavItem`). |
| `apps/parrot/app/components/EmailPanel.tsx` | Spam-only Trust-sender button | VERIFIED | Lines 160-163 (`isSpamFolder`, `handleTrustSender`), 293-301 (conditional `ShieldCheck` button). |
| `apps/parrot/app/components/InboxPane.tsx` | Scope-accurate toast, no Undo | VERIFIED | Lines 190-205; verbatim copy matches spec, no undo callback passed for the `trusted` action branch. |
| `apps/parrot/app/lib/api.ts` | `trustSender()` client helper + `FolderCounts.spam` | VERIFIED | Lines 135-145 (`FolderCounts.spam`), 195-203 (`trustSender`). |
| `apps/parrot/workers/lib/spam-purge.ts` | `runSpamPurge()` orchestration, 30d retention, fail-safe throttle | VERIFIED | Full file read; `elapsed >= 0` guard present (line 56); constants live off the entrypoint (lines 32-34). |
| `apps/parrot/workers/app.ts` | `scheduled()` calls `runSpamPurge`, no new top-level export | VERIFIED | Line 371; grep for non-function top-level exports returns nothing. |
| `apps/parrot/wrangler.jsonc` | Unchanged cron trigger | VERIFIED | `git diff --stat` across full phase range: zero changes to this file. |
| `apps/parrot/workers/tests/lib/safety.test.ts` | Fail-open + classification coverage | VERIFIED | 7 tests; independently re-run, all pass; contract read directly from `safety.ts` matches test assertions. |
| `apps/parrot/workers/tests/lib/inbound-email.test.ts` | Hard-block / fail-open / trust-check coverage | VERIFIED | 7 tests; independently re-run, all pass. This verifier independently reverted `targetFolder = Folders.SPAM` back to the pre-36-01 `return;` and re-ran the suite -- 3 tests failed as claimed, then the file was restored (see Anti-Regression Check below). |
| `apps/parrot/workers/tests/lib/spam-purge.test.ts` | Cron wiring + throttle + fail-safe coverage | VERIFIED | 13 tests; part of the 106-test suite that passed on independent re-run. |
| `infra/LAKERA-PRICING.md` | Non-fabricated Raj hand-off + CI-wiring decision | VERIFIED | "STILL PENDING as of 2026-07-16 -- handed off to Raj" with no tier value invented; CI-wiring decision documents that the new Worker-side tests run in CI today (`ci.yml`'s `parrot` job `npm test` step) and that `screen.test.mjs` remains a documented, un-CI-wired gap by explicit 2026-07-16 decision. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| `inbound-email.ts` hard-block branch | `EmployeeMailboxDO.createEmail(Folders.SPAM, ...)` | Direct call, single call site | WIRED | Confirmed by reading + mutation test. |
| `inbound-email.ts` trust check | `EmployeeMailboxDO.isSenderTrusted()` | RPC before `screenMessage()` | WIRED | Line ordering confirmed (228 before 239); test proves Lakera is never called for a trusted sender. |
| `EmailPanel.tsx` Trust-sender button | `POST /api/inbox/messages/:id/trust-sender` | `api.trustSender(id)` | WIRED | Route shape (`{ok,id,sender,movedToInbox}`) matches client type exactly. |
| `app.ts scheduled()` | `EmployeeMailboxDO.purgeExpiredSpam()` | `runSpamPurge(env)`, per-employee fan-out | WIRED | Confirmed by reading `spam-purge.ts` end-to-end; 36-03's own wiring test executes the real `scheduled()` export and asserts the mocked spy is called once per employee (re-confirmed by this verifier's independent test run, not just SUMMARY claim). |
| `inbox.tsx` sidebar | `GET /api/inbox/folder-counts` (spam field) | `useQuery(["parrot","inbox","folder-counts"])` | WIRED | `counts?.spam` read at the Spam `SecondaryNavItem`; route returns `spam` in the JSON payload. |
| DO constructor | Migration 10 self-application | `applyMigrations()` in `EmployeeMailboxDO` constructor | WIRED by code reading, NOT by a real-DO test | `applyMigrations()` runs synchronously in the constructor and dedupes via `d1_migrations.name`, deterministic, unconditional, no feature flag gates it. High confidence but genuinely untested against a real SQLite-backed DO (see Human Verification). |

### Requirements Coverage

No REQUIREMENTS.md rows found scoped explicitly to Phase 36 by phase-number tag (checked `.planning/REQUIREMENTS.md`); ROADMAP.md is the operative spec and every clause of its Phase 36 entry (Track 1 Spam and Trust-sender, Track 2 fail-open plus tier hand-off) is covered by the truths table above.

### Anti-Regression Check (this verifier's own mutation test)

To avoid trusting SUMMARY claims about mutation-testing, this verifier independently:
1. Reverted `apps/parrot/workers/lib/inbound-email.ts`'s `targetFolder = Folders.SPAM;` back to `return;` (the exact pre-36-01 silent-drop bug).
2. Re-ran `npx vitest run workers/tests/lib/inbound-email.test.ts`.
3. Result: 3 of 7 tests failed (`quarantines flagged mail into Spam...`, `persists the full flagged message payload...`, `still screens when the sender is NOT trusted`), exactly matching the 36-04 SUMMARY's claimed mutation result.
4. Restored the file; `git diff --stat` confirmed clean.

This independently proves the test suite is load-bearing, not a tautology.

### Anti-Patterns Found

No TODO/FIXME/placeholder/"not implemented" patterns found in any of the 8 production files this phase modified. No empty handlers, no stub returns. `EmailIframe.tsx` diff is empty (confirmed via `git diff --stat`), the DOMPurify and sandboxed rendering path was correctly left untouched rather than a new render path being introduced for Spam.

### Security Pass (gstack Pass 1, CRITICAL)

Reviewed the phase-modified files (`inbound-email.ts`, `durableObject/index.ts`, `workers/index.ts`, `spam-purge.ts`, `app.ts`, the four frontend files) against the five Pass 1 categories:

- SQL and Data Safety: All new DO SQL uses parameterized `sql.exec(query, ...params)` calls (`trustSender`, `isSenderTrusted`, `purgeExpiredSpam` all bind params, no string interpolation of user input into SQL). No finding.
- Race Conditions and Concurrency: `trustSender()` uses `INSERT OR IGNORE` on a PRIMARY KEY column, idempotent, no TOCTOU. `spam-purge.ts`'s throttle is explicitly documented as "best-effort, not a lock" but purges are idempotent deletes, so a race duplicates no harm (36-03 SUMMARY Risk 5, confirmed accurate). No finding requiring a fix.
- LLM Output Trust Boundary: N/A, no LLM output is written to DB or used to construct URLs in this phase's diff.
- Shell Injection: N/A, no subprocess/eval/exec touched.
- Enum and Value Completeness: `Folders.SPAM` added to `targetFolder` local (a string, not a strict enum); `moveEmail()` / `getFolders()` already validate generically against the `folders` table per 36-RESEARCH, so no allowlist needed updating. `SYSTEM_FOLDER_IDS` still excludes `spam` but has zero callers repo-wide (independently confirmed via grep, only the definition site), dead code, no behavioral gap.

Security Pass: No Pass 1 issues found in phase-modified files.

### Human Verification Required

1. Live boot-check against a real DO. No automated test in this phase, or any prior phase, exercises a real `EmployeeMailboxDO`; every test mocks `createEmail` / `isSenderTrusted` / `purgeExpiredSpam` as spies. Migration 10's self-application and the actual SQLite INSERT into `emails` with `folder_id='spam'` are proven only by static code reading of `applyMigrations()` (deterministic, unconditional, low risk) and `wrangler deploy --dry-run` (bundle and binding validation only, does not instantiate a DO). A post-deploy check that a real hard-blocked email lands in a real employee's Spam folder is the first genuine proof.
2. Visual and UX verification. `npm run dev` fails to boot locally; this verifier independently reproduced the exact 7 esbuild errors ("No matching export ... react-router-dom to react-router") reported in the 36-02 SUMMARY, confirming this is pre-existing and unrelated to this phase's changes (production `npm run build` succeeds cleanly, confirmed independently). No human or browser has ever rendered the Spam folder, the Trust-sender button, or the toast. This needs an operator UAT pass against the deployed Worker.

### Gaps Summary

No code-level gaps were found. Every must-have this verifier checked, the quarantine branch, Spam folder visibility, Trust-sender wiring and copy, per-employee trust storage, cron wiring with no new trigger and a fail-safe throttle, fail-open test coverage, the non-destructive and non-fabricated Track 2 handling, and the workerd entrypoint constraint, is genuinely implemented and matches the SUMMARYs' claims when checked directly against the source (not merely trusted). Independent re-runs of `npm run typecheck`, `npm test` (106/106), `npm run build`, and `npx wrangler deploy --dry-run` all succeeded, and this verifier's own mutation test reproduced the claimed regression-detection result.

The phase's own executors were honest about two structural blind spots that remain genuinely unproven by any test in the repository: (1) the DO is fully mocked everywhere, so the storage layer and migration self-application have never run against a real SQLite-backed Durable Object; (2) the local dev server cannot boot (a pre-existing, unrelated issue), so the Spam UI has never been seen rendering by a human or browser. Neither of these is a code gap; they are coverage-depth limitations that only a live deploy plus operator UAT can close, which is exactly why this phase is marked human_needed rather than passed.

---

_Verified: 2026-07-16T19:08:49Z_
_Verifier: Claude (rrr-verifier)_
