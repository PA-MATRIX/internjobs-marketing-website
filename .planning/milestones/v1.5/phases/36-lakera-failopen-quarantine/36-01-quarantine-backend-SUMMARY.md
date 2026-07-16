---
phase: 36-lakera-failopen-quarantine
plan: "01"
subsystem: email-safety
tags: [lakera, safety, quarantine, spam, trust-sender, durable-objects, sqlite, cloudflare-workers, hono]

# Dependency graph
requires:
  - phase: 20 (SAFETY-01)
    provides: screenMessage() Lakera Guard pre-LLM screen + the hard-block/soft-flag/fail-open policy branching in inbound-email.ts
  - phase: 10 Wave 1
    provides: EmployeeMailboxDO + migration 1_initial_setup, which already seeded the `spam` folder row (is_deletable=0) that this plan is the first code to actually write to
provides:
  - DO migration 10_trusted_senders — per-employee allowlist table (sender TEXT PK, trusted_at TEXT DEFAULT datetime('now'))
  - EmployeeMailboxDO.trustSender() (INSERT OR IGNORE, idempotent), .isSenderTrusted() (pre-Lakera short-circuit), .purgeExpiredSpam(cutoffIso) (unwired until 36-03)
  - inbound-email.ts quarantine — Lakera hard-block now writes to Folders.SPAM via createEmail(targetFolder, ...) instead of `return`-ing (silent, unrecoverable drop)
  - inbound-email.ts per-employee trust short-circuit — isSenderTrusted() runs after the workspace-wide KV skip-list and before screenMessage()
  - POST /api/inbox/messages/:id/trust-sender (single-message scope by design) + GET /api/inbox/folder-counts now returns `spam`
affects:
  - 36-02 spam UI + Trust-sender button (consumes the trust-sender route + the spam folder-count; its UI copy must state single-message scope)
  - 36-03 spam auto-purge cron (must call the purgeExpiredSpam() method shipped here — currently defined but not yet called anywhere)
  - 36-04 safety test coverage (owns the first tests for the hard-block branch this plan rewrote — see Risks below)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Quarantine-not-drop: the hard-block branch mutates a `targetFolder` local and falls through to the single existing createEmail() call, rather than early-returning. One createEmail() call site remains, parameterized — no duplicated persistence path to drift."
    - "Todo/push suppression for spam is free, not coded: createEmail() already gates extractTodosFromEmail() and sendPushToSubscriptions() on `folderId === Folders.INBOX` (durableObject/index.ts:740,748), so quarantined mail skips the LLM pipeline and push with zero extra logic."
    - "Per-employee trust lives in the DO's own SQLite (strongly consistent, no KV propagation lag), deliberately separate from the workspace-wide PARROT_FEATURE_FLAGS KV `safety_skip_senders` list, which is untouched. Either can short-circuit; they are additive."
    - "Trust check placed before screenMessage() so a trusted sender's mail never spends Lakera quota — mirroring the existing KV skip-list's intent."

key-files:
  created: []
  modified:
    - apps/parrot/workers/durableObject/migrations.ts
    - apps/parrot/workers/db/schema.ts
    - apps/parrot/workers/durableObject/index.ts
    - apps/parrot/workers/lib/inbound-email.ts
    - apps/parrot/workers/index.ts

key-decisions:
  - "Trust-sender is PER-EMPLOYEE (new DO table, migration 10), not the workspace-wide KV list — Research Option B, per the locked 2026-07-09 decision. One employee trusting a sender cannot unblock that sender for anyone else's mailbox."
  - "Trust sender recovers ONLY the clicked message. Other Spam mail from the same sender is deliberately left in Spam (individually recoverable, or auto-purged at 30 days by 36-03). A SCOPE NOTE comment guards this inline so a future reader doesn't 'fix' it into a bulk move."
  - "No backfill of previously-dropped mail — it was never persisted (only an 80-char preview exists in the student-app's safety_events Postgres). Recovery is impossible by construction; this phase protects mail going forward only."
  - "The pre-existing, Lakera-unrelated `if (!employee)` silent drop (inbound-email.ts:125-130) is left untouched, per plan scope. Phase 36 did NOT eliminate every silent drop in this file — only the Lakera one."
  - "Every pre-existing side effect of the hard-block branch is preserved verbatim: no auto-reply (SAFETY-RESPONSE-02), the structured console.warn, and the ctx.waitUntil safety_events POST (SAFETY-LOG-01). Only the storage destination changed."

completed: 2026-07-16
---

# Phase 36 Plan 01: Quarantine Backend Summary

Lakera hard-blocked inbound email is now persisted to the employee's Spam folder instead of being silently, unrecoverably dropped, and a new per-employee `trusted_senders` DO table backs an Outlook-style Trust-sender action that short-circuits screening for that one mailbox.

## What Shipped

**Task 1 — migration 10 + schema + DO methods** (`30d96e9`)
- `10_trusted_senders` appended to `employeeMailboxMigrations` (1–9 existed; no collision). `sender TEXT PRIMARY KEY` makes `INSERT OR IGNORE` idempotent.
- `trustedSenders` drizzle table in `db/schema.ts`.
- `EmployeeMailboxDO.trustSender()`, `.isSenderTrusted()`, `.purgeExpiredSpam(cutoffIso)` added after `moveEmail()`, using `this.ctx.storage.sql.exec` (the established raw-SQL pattern in this DO).

**Task 2 — the actual fix** (`7cc9049`)
- Deleted the `return; // Drop silently` in the `if (isHardBlock)` branch; it now sets `targetFolder = Folders.SPAM`.
- The single `createEmail(...)` call is now `createEmail(targetFolder, ...)` — INBOX for every path that existed before (trusted skip, soft-flag, fail-open), SPAM only on hard-block.
- Per-employee trust check added after the KV skip-list, before `screenMessage()`. Reuses the `mailboxStub` already resolved at line 183 — no new DO lookup.

**Task 3 — HTTP surface** (`b386e93`)
- `POST /api/inbox/messages/:id/trust-sender` (gated by `requireEmployeeMailbox`): `trustSender(sender)` + `moveEmail(id, INBOX)`, returns `{ ok, id, sender, movedToInbox }`.
- `GET /api/inbox/folder-counts` now returns `spam` alongside the existing six.

## Verification (actual observed output)

Run in `apps/parrot/`:

| Command | Result |
| --- | --- |
| `npm run typecheck` | exit 0 |
| `npm test` | **77 passed** (16 files), exit 0 |
| `npm run build` | exit 0 |

**Baseline discrepancy — flagged, not papered over.** The execution brief stated "122 tests passed before this phase". The actual `apps/parrot` baseline is **77 tests / 16 files**, confirmed by stashing this plan's changes and re-running (`vitest run`) on the untouched tree. This plan adds no test files (36-04 owns new coverage), so 77 → 77 is the correct no-regression result. The 122 figure does not correspond to `apps/parrot`'s `npm test`; it likely counted another app's suite (e.g. the student app's `node --test`) or a stale number. Worth reconciling before 36-04 sets its own bar.

Plan-mandated diff assertions, all confirmed by re-reading the diff:
- (a) no `return;` remains inside the `if (isHardBlock)` block
- (b) exactly one `createEmail(...)` invocation remains (line 362, `createEmail(targetFolder`); the other hits are the type declaration + comments
- (c) `isSenderTrusted()` (line 228) runs strictly before `screenMessage(emailBody, env)` (line 239)
- (d) the `if (!employee)` branch (125-130) is byte-for-byte untouched

## Risks / Notes for Following Plans

1. **No test covers the branch this plan rewrote.** `inbound-email.ts` has zero test coverage today (36-RESEARCH Risk 6), so the green suite above proves compilation and no-regression — it does **not** prove the quarantine works. The hard-block→SPAM path and the trust short-circuit are verified by code reading only. **36-04 is load-bearing, not polish**, and the orchestrator's live boot-check after this wave is the first real signal.
2. **`purgeExpiredSpam()` is defined but called from nowhere.** Intentional — 36-03 wires it to the cron. Until then it is dead code (typecheck-clean, unexercised).
3. **One extra DO RPC per inbound email.** The trust check calls `isSenderTrusted()` for any email with a sender that isn't already KV-skipped — including emails with an empty body, which previously short-circuited before any RPC. Same-colo DO call, negligible, but it is a new per-email cost.
4. **Migration 10 self-applies safely.** `applyMigrations()` runs synchronously in the `EmployeeMailboxDO` constructor (index.ts:124-132) and dedupes on `d1_migrations.name`, so existing DOs create `trusted_senders` on their next instantiation before any method runs — `isSenderTrusted()` cannot hit "no such table". Verified by reading the constructor; not covered by a test.
5. **Orphaned-R2-attachment leak self-heals (unverified).** 36-RESEARCH Risk 1: attachments were written to R2 before the hard-block `return`, leaving orphans. Now that hard-blocked mail calls `createEmail()`, those attachment rows should be inserted and linked normally. Expected, not confirmed by a test.
6. **`purgeExpiredSpam()` does not clean up R2 blobs**, matching the existing Trash hard-delete limitation. Pre-existing gap, documented inline, not introduced here.
7. **`SYSTEM_FOLDER_IDS` in `shared/folders.ts` still excludes `spam`** (`Folders.SPAM` and the display name are present; the array is not). Nothing in this plan needed it, and it was left alone — but 36-02 should check its callers before adding the nav item.

## Deviations from Plan

None functionally — all three tasks were executed as written, including the plan's verbatim code snippets. Two documentation-only additions beyond the snippets:
- The migration-10 comment gained a "no collision / idempotent on redeploy" note mirroring migration 8's house style.
- The stale comment above `createEmail()` ("fires the todo hook when folder=Inbox") gained a line explaining `targetFolder`, since that comment would otherwise read as if INBOX were still hardcoded.

No files were touched outside the plan's declared `files_modified`. No CI workflow file, no root STATE/ROADMAP (team mode). The untracked `.planning/workstreams/team-workspace/PHASES-33-36-HANDOFF.md` was left unstaged.
