---
phase: 36-lakera-failopen-quarantine
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - apps/parrot/workers/durableObject/migrations.ts
  - apps/parrot/workers/db/schema.ts
  - apps/parrot/workers/durableObject/index.ts
  - apps/parrot/workers/lib/inbound-email.ts
  - apps/parrot/workers/index.ts
autonomous: true
skills: []
skills_mode: normal

verification:
  surface: backend_only
  frontend_impact: false
  required_steps:
    - unit_tests

must_haves:
  truths:
    - "Lakera hard-blocked inbound email is stored in the employee's Spam folder instead of being silently dropped"
    - "A sender an employee marks as trusted bypasses Lakera screening for that employee's future email only — not workspace-wide"
    - "POST /api/inbox/messages/:id/trust-sender records the sender as trusted for that employee and moves the message to Inbox"
    - "Trust sender moves ONLY the message it was invoked on — it does NOT bulk-move any other existing Spam mail from that sender (Outlook-accurate, 2026-07-16 decision). Other quarantined mail from the same sender is deliberately left in Spam, recoverable individually the same way or via the 30-day auto-purge (Plan 36-03)."
    - "GET /api/inbox/folder-counts includes an accurate spam count"
  artifacts:
    - path: apps/parrot/workers/durableObject/migrations.ts
      provides: "migration 10_trusted_senders creating the per-employee trusted_senders table"
    - path: apps/parrot/workers/db/schema.ts
      provides: "drizzle trustedSenders table definition"
    - path: apps/parrot/workers/durableObject/index.ts
      provides: "EmployeeMailboxDO.trustSender(), .isSenderTrusted(), .purgeExpiredSpam() methods"
    - path: apps/parrot/workers/lib/inbound-email.ts
      provides: "hard-block branch quarantines into Folders.SPAM (no more silent return); per-employee trust check short-circuits Lakera before it's called"
    - path: apps/parrot/workers/index.ts
      provides: "POST /api/inbox/messages/:id/trust-sender route (single-message scope only, by design); folder-counts response includes spam"
  key_links:
    - from: apps/parrot/workers/lib/inbound-email.ts
      to: apps/parrot/workers/durableObject/index.ts (EmployeeMailboxDO.createEmail)
      via: "mailboxStub.createEmail(targetFolder, ...) where targetFolder = Folders.SPAM on hard-block"
      pattern: "createEmail\\(targetFolder"
    - from: apps/parrot/workers/index.ts
      to: apps/parrot/workers/durableObject/index.ts (trustSender + moveEmail)
      via: "POST /api/inbox/messages/:id/trust-sender route handler"
      pattern: "trust-sender"
    - from: apps/parrot/workers/lib/inbound-email.ts
      to: apps/parrot/workers/durableObject/index.ts (isSenderTrusted)
      via: "per-employee trust check before screenMessage() is called"
      pattern: "isSenderTrusted\\("
---

<objective>
Replace the silent-drop hard-block branch in Parrot's inbound-email pipeline with a
quarantine-into-Spam branch, and add a per-employee "trusted sender" allowlist that lets
an employee recover a message AND stop future mail from that sender being screened at all.

This is the storage/backend half of Track 1 (the roadmap's "Spam/Junk folder + Outlook-style
Trust sender" scope, decided 2026-07-09). The `spam` folder already exists in the DO schema
(migration `1_initial_setup`) and `moveEmail()`/`getFolders()` already accept it generically —
this plan does NOT create the folder, it wires the two missing pieces: (1) the hard-block
branch writes into it instead of dropping, (2) a new per-employee `trusted_senders` table
(migration `10_trusted_senders`, per the locked per-employee scope decision — NOT the
workspace-wide `PARROT_FEATURE_FLAGS` KV `safety_skip_senders` mechanism, which stays
untouched) backs a "Trust sender" HTTP action.

Purpose: no more unrecoverable, invisible mail loss on a Lakera hard-block; per-mailbox trust
matches true Outlook "Trust sender" semantics (one employee unblocking a sender must not
affect any other employee).
Output: DO schema migration 10, three new EmployeeMailboxDO methods, the rewritten
inbound-email.ts hard-block branch, and two HTTP route changes.
</objective>

<coverage>
Requirement coverage this plan closes/touches (legend: ★★★ = fully addressed, ★★ = mostly,
★ = partial, [GAP] = not addressed):

  SAFETY-POLICY-01..03   ★★★   Task 2 — hard-block/soft-flag/fail-open policy BRANCHING is
                                 preserved exactly as-is; only the hard-block RESPONSE changes
                                 (silent drop -> quarantine into Spam).
  SAFETY-RESPONSE-02     ★★★   Task 2 — "no auto-reply on hard-block" is preserved verbatim;
                                 only the storage destination changes.
  SAFETY-SCOPE-01..02    ★★★   Task 1 + Task 2 — existing Mattermost-bypass and workspace-wide
                                 KV-allowlist bypass are untouched; new per-employee trust
                                 bypass is additive, not a replacement.
  SAFETY-LOG-01          ★★★   Task 2 — the safety_events POST to the student app is unchanged
                                 and still fires on every non-"passed" screen result.
  SAFETY-VIEW-01         ★★★   unchanged — /ops/safety reads the same safety_events table,
                                 unaffected by where the mail ends up being stored.

Track 1 product scope (Spam folder + Trust sender) has no dedicated REQUIREMENTS.md IDs of
its own yet (it's tracked via this plan's must_haves goal-backward truths instead — see
frontmatter above).
</coverage>

<execution_context>
@~/.claude/rrr/workflows/execute-plan.md
@~/.claude/rrr/templates/summary.md
</execution_context>

<context>
@.planning/milestones/v1.5/phases/36-lakera-failopen-quarantine/36-RESEARCH.md
@.planning/REQUIREMENTS.md
@apps/parrot/workers/lib/inbound-email.ts
@apps/parrot/workers/lib/safety.ts
@apps/parrot/workers/durableObject/migrations.ts
@apps/parrot/workers/db/schema.ts
@apps/parrot/workers/durableObject/index.ts
@apps/parrot/shared/folders.ts
@apps/parrot/workers/index.ts
@apps/parrot/workers/lib/mailbox.ts
</context>

<tasks>

<task type="auto">
  <name>Task 1: Migration 10 (trusted_senders) + drizzle schema + three new DO methods</name>
  <files>apps/parrot/workers/durableObject/migrations.ts, apps/parrot/workers/db/schema.ts, apps/parrot/workers/durableObject/index.ts</files>
  <action>
1. In `migrations.ts`, append a new entry to the `employeeMailboxMigrations` array (migrations
   1 through 9 already exist — this is migration 10, no name collision). Follow the exact
   comment-block style of migrations 8/9 (explain WHY, cite the 2026-07-09 per-employee
   Trust-sender decision):

   ```ts
   {
     // v1.5 Phase 36: per-employee Trust-sender allowlist.
     //
     // Locked decision (2026-07-09): trust-sender scope is PER-EMPLOYEE (true Outlook
     // semantics), NOT workspace-wide. This is a NEW table, separate from the existing
     // workspace-wide PARROT_FEATURE_FLAGS KV `safety_skip_senders` mechanism (which is
     // untouched by this migration) — one employee trusting a sender must not unblock
     // that sender for every other employee's mailbox.
     //
     // sender is the primary key (lowercased email) — INSERT OR IGNORE makes trustSender()
     // idempotent (re-trusting an already-trusted sender is a no-op, not an error).
     name: "10_trusted_senders",
     sql: `
       CREATE TABLE trusted_senders (
         sender TEXT PRIMARY KEY,
         trusted_at TEXT NOT NULL DEFAULT (datetime('now'))
       );
     `,
   },
   ```

2. In `db/schema.ts`, add a drizzle table definition mirroring the existing `folders`/`todos`
   tables' style:

   ```ts
   export const trustedSenders = sqliteTable("trusted_senders", {
     sender: text("sender").primaryKey(),
     trusted_at: text("trusted_at"),
   });
   ```

3. In `durableObject/index.ts`, add three new methods to the `EmployeeMailboxDO` class, placed
   near the other folder/email methods (after `moveEmail()`, ~line 528). Use raw
   `this.ctx.storage.sql.exec(...)` calls (matching the style of `markThreadRead()` at
   ~line 461) rather than drizzle's query builder for the INSERT/SELECT, since these are
   single-purpose lookups:

   ```ts
   /**
    * v1.5 Phase 36: record a sender as trusted for THIS employee only (per-employee
    * scope, 2026-07-09 decision). Idempotent — trusting an already-trusted sender
    * no-ops via INSERT OR IGNORE.
    */
   async trustSender(sender: string): Promise<void> {
     this.ctx.storage.sql.exec(
       `INSERT OR IGNORE INTO trusted_senders (sender) VALUES (?)`,
       sender.toLowerCase(),
     );
   }

   /**
    * v1.5 Phase 36: checked from inbound-email.ts BEFORE screenMessage() is called,
    * mirroring the existing PARROT_FEATURE_FLAGS `safety_skip_senders` short-circuit's
    * intent — a trusted sender's future mail should never hit the Lakera quota.
    */
   async isSenderTrusted(sender: string): Promise<boolean> {
     const rows = [
       ...this.ctx.storage.sql.exec(
         `SELECT 1 FROM trusted_senders WHERE sender = ? LIMIT 1`,
         sender.toLowerCase(),
       ),
     ];
     return rows.length > 0;
   }

   /**
    * v1.5 Phase 36: 30-day spam auto-purge (locked decision 2026-07-09). Called from
    * the Worker's scheduled() cron via workers/lib/spam-purge.ts (Plan 36-03). Reuses
    * the existing deleteEmail() method per-row rather than a bulk DELETE, so the same
    * cleanupTodosForEmail() bookkeeping deleteEmail() already does runs consistently
    * (a safe no-op for spam mail, since createEmail() only extracts todos when
    * folder === Folders.INBOX).
    *
    * NOTE: like the existing Trash hard-delete path (workers/index.ts DELETE route),
    * this does NOT clean up the email's R2 attachment blobs. That is a pre-existing
    * limitation shared with Trash hard-delete, not a new gap introduced here — see
    * 36-RESEARCH.md Risk 1.
    */
   async purgeExpiredSpam(cutoffIso: string): Promise<{ purged: number }> {
     const rows = [
       ...this.ctx.storage.sql.exec(
         `SELECT id FROM emails WHERE folder_id = 'spam' AND date < ?`,
         cutoffIso,
       ),
     ] as Array<{ id: string }>;
     for (const row of rows) {
       await this.deleteEmail(row.id);
     }
     return { purged: rows.length };
   }
   ```

   Confirm `deleteEmail()` (already in the file, ~line 469) is `private`/`async` and callable
   from another instance method (it is — plain class method, no visibility modifier).
  </action>
  <verify>
`cd apps/parrot && npm run typecheck` passes.
`cd apps/parrot && npm test` passes (no existing test regresses — this task adds no test
files itself; Plan 36-04 owns new test coverage).
Confirm migration idempotency by reading `applyMigrations()` in migrations.ts: it dedupes
via `SELECT 1 FROM d1_migrations WHERE name = ?` before running each migration, so migration
10 is automatically idempotent on redeploy, same as 1-9.
  </verify>
  <done>
Migration `10_trusted_senders` exists in `employeeMailboxMigrations`; `trustedSenders` drizzle
table exists in schema.ts; `EmployeeMailboxDO.trustSender()`, `.isSenderTrusted()`, and
`.purgeExpiredSpam()` compile and are callable via the typed `DurableObjectStub<EmployeeMailboxDO>`.
  </done>
</task>

<task type="auto">
  <name>Task 2: Wire inbound-email.ts — quarantine into Spam + per-employee trust short-circuit</name>
  <files>apps/parrot/workers/lib/inbound-email.ts</files>
  <action>
Two changes to the Lakera screening block (~lines 187-353), both preserving every existing
side effect (structured logging, the `safety_events` POST to the student app) unchanged:

NOTE (out of scope, checker-confirmed 2026-07-16): this file has a SECOND, pre-existing,
Lakera-unrelated silent drop at the `if (!employee) { ...; return; }` branch (~line 125-130,
"no employee matches recipients"). This phase does NOT touch that branch — only the Lakera
hard-block branch's silent-drop is in scope. Do not "fix" the no-employee-match branch as
part of this task; a future reader should not assume Phase 36 eliminated every silent drop
in this file, only the Lakera one.

1. **Per-employee trust check** — add this immediately after the existing workspace-wide KV
   `safety_skip_senders` block (after line ~217, before `if (!skipScreen && emailBody.length > 0)`).
   `mailboxStub` is already resolved at line 183, so no new DO lookup is needed:

   ```ts
   // v1.5 Phase 36: per-employee Trust-sender check (2026-07-09 decision). Runs
   // AFTER the workspace-wide KV skip-list (either one can short-circuit) and
   // BEFORE screenMessage() — a trusted sender's mail should never spend Lakera
   // quota, matching the existing skip-list's intent.
   if (!skipScreen && senderEmail) {
     const isTrusted = await (
       mailboxStub as unknown as {
         isSenderTrusted(sender: string): Promise<boolean>;
       }
     ).isSenderTrusted(senderEmail);
     if (isTrusted) skipScreen = true;
   }
   ```

2. **Quarantine instead of drop** — declare `let targetFolder: string = Folders.INBOX;` right
   before the `if (!skipScreen && emailBody.length > 0)` block (~line 219). Inside the
   `if (isHardBlock)` block (~line 290-305), DELETE the `return;` statement and instead set
   `targetFolder = Folders.SPAM;`. Update the comment above it from "Drop silently" to explain
   the new behavior:

   ```ts
   if (isHardBlock) {
     // SAFETY-RESPONSE-02: NO auto-reply on hard-block. Out-of-office
     // loop risk: if blocked email is from an automated sender, an
     // auto-reply triggers their auto-responder -> infinite loop.
     //
     // v1.5 Phase 36 (2026-07-09 decision): mail is now quarantined into the
     // Spam folder instead of dropped -- recoverable via the "Trust sender"
     // action or a manual move, no longer unrecoverable. Operator can also
     // still review /ops/safety for the audit trail.
     console.warn(
       JSON.stringify({
         level: "warn",
         event: "lakera_hard_block_email",
         employee_id: employee.id,
         reason: screenResult.reason,
         preview: emailBody.slice(0, 80),
       }),
     );
     targetFolder = Folders.SPAM;
   }
   // Soft-flag, fail-open, or trusted-sender skip: targetFolder stays Folders.INBOX.
   ```

   Finally, change the single `createEmail(...)` call at the bottom of the function
   (~line 334, currently `createEmail(Folders.INBOX, {...}, attachmentData)`) to
   `createEmail(targetFolder, {...}, attachmentData)`. Do not change anything else about that
   call — attachment persistence, threading fields, etc. are unaffected. `createEmail()` in the
   DO already gates todo-extraction on `folderId === Folders.INBOX`, so quarantined mail
   automatically skips the LLM todo-extraction pipeline with zero further change.
  </action>
  <verify>
`cd apps/parrot && npm run typecheck` passes.
Read the diff and confirm: (a) no `return;` remains inside the `if (isHardBlock)` block,
(b) exactly one `createEmail(...)` call remains in the file (the one at the bottom, now
parameterized by `targetFolder`), (c) the trust-sender check runs strictly before
`screenMessage(emailBody, env)` is invoked, (d) the `if (!employee)` branch (~line 125-130) is
untouched.
  </verify>
  <done>
Hard-blocked mail reaches `createEmail(Folders.SPAM, ...)` instead of being dropped.
Trusted-sender mail skips `screenMessage()` entirely (Lakera never called). Fail-open /
soft-flag / non-hard-block mail still reaches `createEmail(Folders.INBOX, ...)` exactly as
before this plan. The unrelated no-employee-match silent drop is left as-is.
  </done>
</task>

<task type="auto">
  <name>Task 3: HTTP routes — POST trust-sender + folder-counts spam</name>
  <files>apps/parrot/workers/index.ts</files>
  <action>
1. Add `POST /api/inbox/messages/:id/trust-sender`, gated by `requireEmployeeMailbox`, placed
   near the existing `PARROT-FOLDER-ACTIONS-01` move/delete routes (~line 460, right after the
   `DELETE /api/inbox/messages/:id` route). Mirror their error-handling style exactly:

   ```ts
   // v1.5 Phase 36 (2026-07-09 decision): "Trust sender" — Outlook-style per-employee
   // allowlist. Records the sender as trusted for THIS employee (not workspace-wide;
   // see the PARROT_FEATURE_FLAGS `safety_skip_senders` KV for the pre-existing
   // workspace-wide mechanism, which this does NOT touch) and moves the current
   // message out of Spam into Inbox in the same call.
   //
   // SCOPE NOTE (checker-flagged UX trap, 2026-07-16 decision): this moves ONLY the
   // message identified by :id. It deliberately does NOT bulk-move every other Spam
   // message from the same sender -- those are left in Spam to either be individually
   // recovered the same way or auto-purged after 30 days (Plan 36-03). Do NOT "fix"
   // this into a bulk move -- it is intentional, Outlook-accurate behavior, not an
   // oversight. (Plan 36-02's UI copy must reflect this too — see that plan.)
   app.post(
     "/api/inbox/messages/:id/trust-sender",
     requireEmployeeMailbox,
     async (c: AppContext) => {
       const id = c.req.param("id");
       if (!id) return c.json({ error: "Missing message id" }, 400);
       const stub = c.var.mailboxStub;
       const email = await stub.getEmail(id);
       if (!email) return c.json({ error: "Email not found" }, 404);
       const sender = (email.sender || "").toLowerCase();
       if (!sender) return c.json({ error: "Email has no sender" }, 400);
       await stub.trustSender(sender);
       const moved = await stub.moveEmail(id, Folders.INBOX);
       return c.json({ ok: true, id, sender, movedToInbox: moved });
     },
   );
   ```

2. Extend `GET /api/inbox/folder-counts` (~line 386-401): add a `stub.countEmails({ folder:
   "spam" })` call to the existing `Promise.all([...])` array and add the `spam` key to the
   destructuring + the returned JSON object, alongside the existing six (`inbox`, `sent`,
   `draft`, `archive`, `trash`, `starred`):

   ```ts
   const [inbox, sent, draft, archive, trash, starred, spam] = await Promise.all([
     stub.countEmails({ folder: "inbox" }),
     stub.countEmails({ folder: "sent" }),
     stub.countEmails({ folder: "draft" }),
     stub.countEmails({ folder: "archive" }),
     stub.countEmails({ folder: "trash" }),
     stub.countEmails({ starred: true }),
     stub.countEmails({ folder: "spam" }),
   ]);
   return c.json({ inbox, sent, draft, archive, trash, starred, spam });
   ```
  </action>
  <verify>
`cd apps/parrot && npm run typecheck` passes.
`cd apps/parrot && npm test` passes — the existing route smoke tests in
`workers/tests/routes/inbox-actions.test.ts` and `ops-safety.test.ts` must still pass
unmodified (this task does not touch test files; Plan 36-04 adds new coverage for the routes
added here).
  </verify>
  <done>
`POST /api/inbox/messages/:id/trust-sender` and the extended `GET /api/inbox/folder-counts`
(now including `spam`) are mounted on the Hono app and return well-formed JSON on success.
The trust-sender route's single-message scope is documented inline so it isn't later "fixed"
into an unintended bulk move.
  </done>
</task>

</tasks>

<verification>
Run in `apps/parrot/`:
```
npm run typecheck
npm test
npm run build
```
All three must pass with zero new failures. This plan touches no `.tsx` files and adds no new
UI surface — verification is compile + existing-test-suite green, not a visual check (the
Spam nav item + Trust-sender button ship in Plan 36-02, which depends on this plan and owns
the chrome/Playwright visual verification once the feature is actually visible).
</verification>

<success_criteria>
1. Migration 10 exists, is idempotent, and creates `trusted_senders(sender PK, trusted_at)`.
2. `EmployeeMailboxDO` has working `trustSender`, `isSenderTrusted`, `purgeExpiredSpam` methods.
3. `inbound-email.ts`'s hard-block branch quarantines into `Folders.SPAM` instead of returning
   early; a per-employee trusted sender's mail skips Lakera screening entirely.
4. `POST /api/inbox/messages/:id/trust-sender` and the spam-inclusive `GET
   /api/inbox/folder-counts` are live routes; the trust-sender route moves only the single
   targeted message, by design.
5. `npm run typecheck`, `npm test`, and `npm run build` all pass in `apps/parrot/`.
</success_criteria>

<output>
After completion, create `.planning/milestones/v1.5/phases/36-lakera-failopen-quarantine/36-01-quarantine-backend-SUMMARY.md`
</output>
