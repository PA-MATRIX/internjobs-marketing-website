# Phase 36: Lakera safety quarantine + fail-open confirm — Research

**Researched:** 2026-07-16
**Domain:** Cloudflare Worker email pipeline (Hono + Durable Object SQLite) + React Router email pane
**Confidence:** HIGH (all findings are direct file reads of production code, no speculation)

## Summary

The "silently dropped, unrecoverable" premise from the roadmap is **verified true** —
`receiveEmail()` in `apps/parrot/workers/lib/inbound-email.ts` hits `return;` on hard-block
(line 304) *before* `EmployeeMailboxDO.createEmail()` is ever called. The email is parsed,
screened, logged to console + best-effort POSTed to `safety_events` in the student-app
Postgres (for the `/ops/safety` audit view), but the message body/attachments are **never
persisted anywhere in Parrot's storage** — not in the DO's SQLite `emails` table, not in R2.
There is no backfill possible for anything already dropped.

The good news for Track 1: the storage and UI seams for a spam folder are **90% already
built and just unwired**. The DO schema seeds a `spam` folder row in migration `1_initial_setup`
(`is_deletable=0`, alongside inbox/sent/draft/trash/archive), `shared/folders.ts` already
defines `Folders.SPAM = "spam"` and a display name for it, and the existing `moveEmail()` /
`getFolders()` DO methods validate against the `folders` table generically — they already
accept `"spam"` as a target with zero code changes. What's missing is (a) wiring the
hard-block branch in `inbound-email.ts` to call `createEmail(Folders.SPAM, ...)` instead of
`return`, (b) adding "Spam" to the hardcoded `FOLDERS` set + sidebar nav in
`apps/parrot/app/routes/inbox.tsx`, and (c) adding `spam` to the `/api/inbox/folder-counts`
response. Rendering is already XSS-safe: email bodies render through `EmailIframe.tsx`
(DOMPurify + opaque-origin sandboxed iframe), which a spam folder reuses unchanged.

Trust-sender allowlisting has a **partial existing mechanism** to build on: a KV-backed,
workspace-wide (not per-employee) skip list already exists — `PARROT_FEATURE_FLAGS` KV,
key `safety_skip_senders`, comma-separated emails, checked in `inbound-email.ts:208-217`
*before* Lakera is even called. Today it's populated manually via `wrangler kv:key put`.
The "Trust sender" button needs a new authenticated API route that reads-modifies-writes
this same KV key (or a new per-employee equivalent — open decision below).

**Primary recommendation:** Change the hard-block branch to quarantine into the existing
`spam` folder (reuse, don't rebuild, the folder/move/render machinery), and add a `POST
/api/inbox/messages/:id/trust-sender` route that appends the sender to the KV allowlist and
moves the message out of Spam into Inbox — mirroring the existing `STAR-API-01` /
`PARROT-FOLDER-ACTIONS-01` route patterns exactly.

## Verified Current Behaviour (with citations)

### A1–A2. Silent-drop premise — CONFIRMED, mail is not persisted anywhere

`apps/parrot/workers/lib/inbound-email.ts:290-305`:
```ts
if (isHardBlock) {
  // SAFETY-RESPONSE-02: NO auto-reply on hard-block. ...
  console.warn(JSON.stringify({ level: "warn", event: "lakera_hard_block_email", ... }));
  return; // Drop silently — no createEmail(), no todo extraction, no auto-reply
}
```
- Before this `return`, the code has already: parsed the MIME (`PostalMime`), resolved the
  employee, and (if attachments exist) **already written attachment blobs to R2** at
  `attachments/${employee.clerk_user_id}/${messageId}/${attId}/${filename}` (lines 147-169) —
  this happens *before* the screen call (line 221), so on hard-block **orphaned R2 objects
  can exist with no DB row ever pointing at them** (a leak/retention issue, see Risks).
- The email body/subject/sender itself is **never written** to the DO's `emails` table — no
  `createEmail()` call happens, so there is nothing to recover from Parrot's own storage.
  The only trace is: (1) console log, (2) a best-effort `safety_events` POST to the
  student-app's Postgres, which stores `preview: emailBody.slice(0, 80)` (an 80-char
  truncated preview) plus `sender_last4`, `reason`, `score`, `source_id` — NOT the full body,
  NOT attachments (`inbound-email.ts:260-274`).
- **Verdict for the planner:** there is no way to "restore" already-dropped mail from before
  this phase ships — only the 80-char preview + metadata exists in `safety_events`
  (a different Postgres DB, reached via `/internal/safety-events`). Full-body backfill is
  impossible. This must be an explicit open decision (see below), not silently assumed away.

### A2 (worker handler). No `setReject()` — plain `return`

Parrot's `email()` Worker export isn't in `inbound-email.ts` itself; `receiveEmail()` is the
handler body invoked from `apps/parrot/workers/app.ts`'s `export default { email(...) }`
(confirmed `app.ts:323` has `export default {`). No `message.setReject()` is called anywhere
in this file — CF Email Routing sees the email as accepted (200 OK-equivalent), so senders
never get an SMTP-level bounce. This is intentional and orthogonal to Track 1 (no evidence
it needs to change).

### A3. Sender bypass (SAFETY-SCOPE-01/02)

`inbound-email.ts:204-217`: reads `env.PARROT_FEATURE_FLAGS` KV key `safety_skip_senders`
(comma-separated emails, lower-cased comparison against `senderEmail`). This is a **single
workspace-wide KV value**, not per-employee, not a DB table. Populated manually via:
```
wrangler kv:key put --binding=PARROT_FEATURE_FLAGS safety_skip_senders "a@x.com,b@y.com"
```
KV binding declared: `apps/parrot/wrangler.jsonc:186-188` (`"binding": "PARROT_FEATURE_FLAGS"`),
typed in `apps/parrot/workers/types.ts:50,141` (`PARROT_FEATURE_FLAGS?: KVNamespace`).
Mattermost inbound bypasses screening entirely by architecture (polled via DO alarm, never
routed through `screenMessage` at all) — `inbound-email.ts:83-85`.

### A4. Fail-open path — confirmed identical contract, both runtimes

Both `apps/parrot/workers/lib/safety.ts` (Worker/TS) and `apps/app/src/safety/screen.mjs`
(Node/Fly, student SMS) share the exact same contract, independently implemented (not a
shared module — comment explicitly notes this to avoid runtime-coupling):
- Missing API key → immediate `{ flagged: false, action: "passed_lakera_unavailable" }`,
  no network call (`safety.ts:69-73`, `screen.mjs:51-54`).
- Non-2xx response → fail-open, same shape (`safety.ts:91-94`, `screen.mjs:72-76`).
- Unparseable JSON body → fail-open (`safety.ts:104-106`, `screen.mjs:86-89`).
- `AbortController` with `TIMEOUT_MS = 1000` (hard 1s), any thrown error (timeout or network)
  → fail-open in a `catch` block, never rethrown (`safety.ts:138-150`, `screen.mjs:122-133`).
- **The function contract is "never throws."** This is the property the fail-open tests
  must assert.

## Storage + UI Seams (what a Spam/Junk folder plugs into)

### B5. Where inbound email lives — schema, already has a `spam` folder

DO: `EmployeeMailboxDO`, defined in `apps/parrot/workers/durableObject/index.ts` (1989
lines), migrations in `apps/parrot/workers/durableObject/migrations.ts`.

Migration `1_initial_setup` (`migrations.ts:61-116`) seeds:
```sql
CREATE TABLE folders (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, is_deletable INTEGER NOT NULL DEFAULT 1);
INSERT INTO folders (id, name, is_deletable) VALUES
  ('inbox', 'Inbox', 0), ('sent', 'Sent', 0), ('draft', 'Drafts', 0),
  ('trash', 'Trash', 0), ('archive', 'Archive', 0), ('spam', 'Spam', 0);

CREATE TABLE emails (
  id TEXT PRIMARY KEY, folder_id TEXT NOT NULL, subject TEXT, sender TEXT,
  recipient TEXT, cc TEXT, bcc TEXT, date TEXT, read INTEGER DEFAULT 0,
  starred INTEGER DEFAULT 0, body TEXT, in_reply_to TEXT, email_references TEXT,
  thread_id TEXT, message_id TEXT, raw_headers TEXT,
  FOREIGN KEY(folder_id) REFERENCES folders(id) ON DELETE CASCADE
);
CREATE TABLE attachments (id TEXT PRIMARY KEY, email_id TEXT NOT NULL, filename TEXT NOT NULL,
  mimetype TEXT NOT NULL, size INTEGER NOT NULL, content_id TEXT, disposition TEXT, ...);
```
So `spam` is a first-class, non-deletable system folder **that has existed in the schema
since v1.2 Phase 10 Wave 1 and has simply never been written to or surfaced.** No new
migration is needed to add the folder itself.

Migration numbering: 9 migrations exist today (`1_initial_setup` … `9_last_seen`,
`migrations.ts` — confirmed via `grep -n "name: \""`). If Track 1/2 need a new table (e.g. a
per-employee trust-sender allowlist), the next migration is **`10_<name>`**.

`shared/folders.ts` (`apps/parrot/shared/folders.ts`) already exports:
```ts
export const Folders = { INBOX:"inbox", SENT:"sent", DRAFT:"draft", ARCHIVE:"archive", TRASH:"trash", SPAM:"spam" } as const;
export const SYSTEM_FOLDER_IDS = [INBOX, SENT, DRAFT, ARCHIVE, TRASH]; // ⚠ SPAM excluded
export const FOLDER_DISPLAY_NAMES = { ...spam: "Spam" }; // ⚠ SPAM IS present here
```
`SYSTEM_FOLDER_IDS` deliberately excludes `spam` — worth checking any callers of that const
(none of significance found in this pass) but it's a signal the folder was scaffolded then
intentionally left unwired pending a product decision — exactly what Phase 36 now makes.

### B6. Email pane UI — sidebar nav is a hardcoded folder list, does NOT include spam

`apps/parrot/app/routes/inbox.tsx:19-25`:
```ts
const FOLDERS = new Set(["inbox", "sent", "draft", "archive", "trash", "starred"]);
```
The `EmailSecondaryNav` component (`inbox.tsx:33-107`) renders one `SecondaryNavItem` per
folder, each with an icon + a `count` prop sourced from `GET /api/inbox/folder-counts`
(`inbox.tsx:38-39`, react-query key `["parrot","inbox","folder-counts"]`). **No Spam item
exists in the nav today.** Adding one is: (1) add `"spam"` to `FOLDERS`, (2) add a
`SecondaryNavItem` with `href="/inbox?folder=spam"`, an icon (lucide has no dedicated "spam"
icon in this codebase's palette — `AlertTriangle`/`ShieldAlert`/`Ban` are reasonable choices
already used elsewhere in the app, confirm via `lucide-react` imports already present), (3)
extend the `folder-counts` route.

`GET /api/inbox/messages?folder=X` (`apps/parrot/workers/index.ts:355-367`) already handles
arbitrary folder query params generically — no code change needed there to *list* spam mail,
it Just Works once mail exists in that folder.

`GET /api/inbox/folder-counts` (`workers/index.ts:387-399`) is hardcoded to
`Promise.all([inbox, sent, draft, archive, trash, starred])` — **spam count is NOT included**
and must be added (both server route + the `EmailSecondaryNav` count prop wiring).

`EmailPanel.tsx` — the message detail view — takes a `folder` prop (`components/EmailPanel.tsx:51-54`)
already used to flip the Archive button to "Unarchive" when `folder === "archive"`
(`EmailPanel.tsx:135-146`). The same pattern is the natural home for a "Not spam" /
"Trust sender" button when `folder === "spam"`.

Rendering: `apps/parrot/app/components/EmailIframe.tsx` sandboxes email HTML in an
opaque-origin iframe and runs it through **DOMPurify** before injection
(`EmailIframe.tsx:12,25,27,69`). A spam folder reuses this component unmodified — **no new
XSS surface**, this was already the safe design for untrusted (cold-sender) mail.

### B7. Star/move API — the pattern to mirror for "Trust sender"

Existing mutation routes in `apps/parrot/workers/index.ts`, all gated by
`requireEmployeeMailbox` (per-employee scoping enforced at the DO-stub level):

- `PATCH /api/inbox/messages/:id` — **STAR-API-01**, body `{ starred?, read? }`
  (`index.ts:414-443`), backed by `EmployeeMailboxDO.updateEmail()`.
- `POST /api/inbox/messages/:id/move` — **PARROT-FOLDER-ACTIONS-01**, body `{ folder }`
  (`index.ts:444-459`), backed by `EmployeeMailboxDO.moveEmail(id, folderId)`.
- `DELETE /api/inbox/messages/:id` — two-stage delete (moves to Trash first call, hard-deletes
  on second call from Trash) (`index.ts:460+`).

`moveEmail()` (`durableObject/index.ts:503-527`) resolves the target folder generically
against the `folders` table by id-or-name (`or(eq(folders.id, folderId), eq(folders.name, folderId))`)
and returns `false` only if the folder doesn't exist or the email id doesn't exist. **It
already accepts `"spam"` as a valid move target with zero code changes** — confirmed by
reading the seeded folders table. So `POST /api/inbox/messages/:id/move {"folder":"inbox"}`
already works today as the mechanism for a manual "move out of spam" / "not spam" action —
Track 1 mainly needs the UI button + (for "Trust sender" specifically) the allowlist side
effect, not new move plumbing.

## Trust-Sender Allowlist — Recommended Approach

### C8–C9. Where it lives, and is it reachable at screen time

Two viable options, both technically reachable from `screenMessage()`'s call site
(`inbound-email.ts:219-221`, which runs *before* the KV skip-check even happens — actually
the skip-check runs *before* `screenMessage` is called at all, lines 208-217, so an allowlist
check is naturally a pre-Lakera short-circuit exactly like today's `safety_skip_senders`):

**Option A — extend the existing KV skip-list (workspace-wide).**
Reuse `PARROT_FEATURE_FLAGS` KV, key `safety_skip_senders`. "Trust sender" appends the
sender's email to the comma-separated value via a new authenticated route. Pros: zero new
storage, zero new migration, identical read path already proven in prod. Cons: **not
per-employee** — trusting a sender from one employee's spam folder whitelists them for
*every* employee's mailbox, which may not match an "Outlook-style" per-mailbox trust model
the user has in mind, and KV writes are eventually-consistent (~60s propagation) so a
"Trust sender" click won't retroactively affect email that's mid-flight to a *different*
Cloudflare PoP, though it's fine for future emails to that recipient.

**Option B — new per-employee table on `EmployeeMailboxDO` (migration 10).**
E.g. `CREATE TABLE trusted_senders (sender TEXT PRIMARY KEY, trusted_at TEXT NOT NULL DEFAULT (datetime('now')))`.
Checked from `inbound-email.ts` via a new DO RPC method (`mailboxStub.isSenderTrusted(email)`)
called before/alongside the existing KV skip-check. Pros: matches "Outlook-style, per-mailbox"
semantics precisely, DO SQLite reads are strongly consistent (no propagation lag), fits the
existing migration pattern exactly (mirrors `todos`/`notifications` tables). Cons: one new
migration + one new DO method + the inbound-email handler needs to resolve the target
`mailboxStub` (it already does, at `inbound-email.ts:183-185`, so this is just moving the
check to after that line) — moderately more code than Option A but not large.

**This research recommends Option B** (per-employee) as the better fit for "Outlook-style
Trust sender" semantics, but **this is an open decision for the planner/user** since Option A
is far cheaper and the CONTEXT.md scope note only says "Outlook-style" without specifying
per-employee vs workspace-wide — flag explicitly.

Either option's check must run **before** the Lakera call (mirroring the existing
`skipScreen` gate at `inbound-email.ts:219`) so a trusted sender's future mail never even
hits the Lakera quota, consistent with the existing `safety_skip_senders` mechanism's intent.

## Fail-Open Tests — Recommended Approach

### D10. Existing test patterns

**Node side** (`apps/app/src/safety/screen.test.mjs`, run via `node --test`): uses
`node:test` + `node:assert/strict`, no mocking library — fail-open is tested by (a) passing
an empty API key (`VERIFY-03a`), (b) pointing `LAKERA_GUARD_ENDPOINT` env at a dead host
(`VERIFY-03b`, imperfect — the module captures the endpoint at import time so this doesn't
fully exercise re-import, documented as a known limitation in the file itself), (c) asserting
`screenMessage` never throws on malformed input (`VERIFY-03c`). Live-API tests (`VERIFY-01/02`)
are gated behind `if (LAKERA_KEY)` and skipped in CI.

**Worker side** (`apps/parrot/workers/lib/safety.ts`): **no test file exists today** —
`apps/parrot/workers/tests/` only has `healthz.test.ts` and `routes/ops-safety.test.ts`
(a route-mount smoke test, not a Lakera-logic test) — confirmed via directory listing. This
is a real gap for LAKERA-VERIFY-LIVE-03 "at test level" — a new
`apps/parrot/workers/tests/lib/safety.test.ts` (vitest) needs to be created. Vitest supports
`vi.stubGlobal("fetch", ...)` / `vi.fn()` mocking cleanly (unlike the Node script's awkward
env-var-at-import-time workaround), so the Worker-side test can properly mock a 5xx response
and a timeout via a controllable mock `fetch`, giving cleaner coverage than the Node
equivalent. Recommend testing: missing key (no fetch call), mocked 500 response, mocked
network-throw, mocked `AbortError`, and — for the hard-block gate itself — a
`inbound-email.test.ts` asserting `flagged:true` still hard-blocks (into Spam, post-Track-1)
while `passed_lakera_unavailable` proceeds to `createEmail(Folders.INBOX, ...)` normally.
No such `inbound-email.ts` test file exists today either — also a gap to fill in this phase
since Track 1 changes that exact branch.

### D11. Submission gate commands

From `apps/parrot/package.json`:
```
npm run typecheck   # wrangler types && react-router typegen && tsc -b
npm run test        # vitest run
```
Student-app (Node) side fail-open tests run via `node --test apps/app/src/safety/screen.test.mjs`
(no vitest in that app per the file's own header comment). Neither test file was found wired
into a root-level CI script in this pass — not verified whether root `package.json` / a
GitHub Actions workflow chains these; **flag as unverified**, recommend the planner confirm
via the standard RRR submission gate script (`scripts/submit-phase.mjs`) rather than assuming.

## Risks / Gotchas

1. **Orphaned R2 attachments on hard-block (pre-existing bug, adjacent to this phase).**
   `inbound-email.ts:147-169` writes attachments to R2 *before* the Lakera screen call
   (line 221). On hard-block, those R2 objects are never referenced by any DB row (since
   `createEmail()` is skipped) — a storage leak today. If Track 1 starts persisting spam mail
   via `createEmail(Folders.SPAM, ...)`, this actually **self-heals** (the attachment rows
   will now be inserted and linked normally), but the planner should note this as a
   side-effect worth confirming, not assume it "just works" without a test.

2. **Storing attacker-controlled content is the entire point of a quarantine folder — this
   is expected, not a new risk, PROVIDED rendering stays inside `EmailIframe.tsx`'s existing
   DOMPurify + opaque-origin sandbox.** Do not add any alternate rendering path (e.g. a
   plain-text preview using `dangerouslySetInnerHTML` directly) for the Spam list view.

3. **`safety_events` lives in a different database** (student-app Postgres, Fly-hosted,
   reached only via `/internal/safety-events` Bearer-token API — `env.STUDENT_API_URL` /
   `env.STUDENT_API_SECRET`, `inbound-email.ts:252-285`). The quarantine folder (Parrot DO
   SQLite) and the audit log (student-app Postgres) are and will remain **two separate
   stores with no foreign key between them** beyond the shared `source_id` (Message-ID).
   Track 1 does not need to unify them, but the planner should not assume `/ops/safety` will
   show a "view in Spam folder" link without adding one explicitly (cross-store, cross-app —
   nontrivial, likely out of scope for this phase; flag as open question, not silently build).

4. **KV eventual consistency** if Option A (workspace-wide allowlist) is chosen for
   trust-sender — writes can take up to ~60s to propagate globally; do not promise
   instant effect in the UI copy.

5. **`workerd` entrypoint constraint** (repo has hit this before per user memory): Parrot's
   Worker default export is `apps/parrot/workers/app.ts:323 export default { ... }` — any new
   route/handler must be added as a plain function property on this object or mounted through
   the existing Hono `app` instance (`workers/index.ts`), not as a new top-level export. No
   currently-broken instance of this found in the files read, but flag as a known trap the
   planner's tasks should avoid re-triggering (do not add e.g. a second `export const email = ...`
   or a class-based `WorkerEntrypoint` alongside the existing default export without checking
   compatibility first).

6. **No existing tests cover `inbound-email.ts`'s hard-block branch at all.** This phase
   changes that exact branch (return → createEmail-into-Spam), so a regression here is
   invisible to the current test suite. New tests are not optional polish — they're the only
   thing standing between this phase and a silent gate-passing regression.

7. **LAKERA-VERIFY-LIVE-03 must NOT be a destructive prod test** (explicit prior decision —
   do not rotate the real `LAKERA_GUARD_API_KEY` to an invalid value in prod Infisical/CF).
   Test-level (vitest/node:test with mocked fetch or dead-endpoint env var) is the only
   accepted approach, matching the pattern already used in `screen.test.mjs`.

8. **Tier/quota confirmation (LAKERA-V2-03) is account-gated to Raj's dashboard access** —
   cannot be executed by the implementing agent. Plan it as a hand-off checklist item
   referencing `infra/LAKERA-PRICING.md`, not a task with a completion action.

## Existing Partial Work Toward This Phase

- `spam` folder: fully scaffolded in schema + shared constants, unwired in UI/hard-block path
  (detailed above) — this is the single biggest accelerant for Track 1.
- `safety_skip_senders` KV allowlist: functionally an MVP-grade sender-trust mechanism,
  currently manual-only (no UI, no per-employee scope) — natural (if imperfect) base for
  "Trust sender" if Option A is chosen.
- `PARROT-FOLDER-ACTIONS-01` (move/archive/delete) and `STAR-API-01` (star/read toggle):
  shipped, tested-in-spirit (via UI, not via dedicated unit tests found), and directly
  reusable/mirrorable for the new Spam-folder actions.
- `infra/LAKERA-PRICING.md` referenced by LAKERA-V2-03 but not read in this pass — confirm
  its current content/status before writing the hand-off checklist (not verified here).
- No existing UI mockup, route stub, or migration draft found for "Trust sender" or a Spam
  nav item — Track 1 is genuinely greenfield on the wiring, not just finishing something
  half-built in the UI layer (only the storage layer is half-built).

## Open Questions for the Planner

1. **Per-employee vs workspace-wide trust-sender allowlist** (Option A vs B above) — the
   2026-07-09 decision says "Outlook-style" but doesn't pin this down. Recommend Option B
   (per-employee DO table, migration `10_trusted_senders`) for semantic correctness, but
   confirm with the user/CONTEXT.md before committing — this changes the migration count and
   route shape materially.
2. **Retention of already-dropped mail (pre-Phase-36)** — confirmed impossible to recover
   more than an 80-char preview from `safety_events`. Does the user want anything done with
   that historical preview data (e.g. surfaced as a one-time notice), or is it accepted as
   permanently lost and this phase only protects mail *going forward*? Recommend the latter
   (simpler, matches "quarantine going forward" framing) but must be an explicit decision.
3. **Spam folder retention/auto-purge policy** — Trash apparently has manual two-stage
   delete; does Spam need a TTL auto-purge (e.g. 30 days) like typical mail clients, or does
   it behave like Archive (indefinite retention)? Not found in existing code — new decision.
4. **Icon choice for the Spam nav item** — no existing "spam" icon convention in the
   `lucide-react` imports already used in `inbox.tsx`; planner should pick one during task
   breakdown (e.g. `ShieldAlert` or `AlertTriangle`), not a research blocker.
5. **Root-level CI wiring for the two safety test files** — not verified whether
   `screen.test.mjs` (Node) and any new `apps/parrot/workers/tests/lib/safety.test.ts`
   (vitest) both actually run in the submission gate today. Confirm via
   `scripts/submit-phase.mjs` / existing GitHub Actions config before assuming test-writing
   alone satisfies LAKERA-VERIFY-LIVE-03's "test level" bar.

## Sources

### Primary (HIGH confidence — direct file reads, this repo, this session)
- `apps/parrot/workers/lib/inbound-email.ts` (full file, 359 lines)
- `apps/parrot/workers/lib/safety.ts` (full file, 152 lines)
- `apps/app/src/safety/screen.mjs` (full file, 135 lines)
- `apps/app/src/safety/screen.test.mjs` (full file, 165 lines)
- `apps/parrot/workers/durableObject/migrations.ts` (migrations 1–9, names + migration 1 SQL in full)
- `apps/parrot/shared/folders.ts` (full file, 39 lines)
- `apps/parrot/workers/index.ts` (routes: messages, folder-counts, star PATCH, move POST, folders GET — lines ~340-560)
- `apps/parrot/workers/durableObject/index.ts` (moveEmail, getFolders, createEmail — lines ~495-660)
- `apps/parrot/app/routes/inbox.tsx` (FOLDERS set, EmailSecondaryNav — lines 1-121)
- `apps/parrot/app/components/EmailPanel.tsx` (folder prop, archive/unarchive pattern)
- `apps/parrot/app/components/EmailIframe.tsx` (DOMPurify sandboxing — grep-confirmed)
- `apps/parrot/workers/tests/helpers.ts`, `apps/parrot/workers/tests/routes/ops-safety.test.ts`
- `apps/parrot/workers/types.ts` (KV binding type), `apps/parrot/wrangler.jsonc` (KV binding declaration)
- `apps/parrot/package.json` (scripts: typecheck, test)
- `apps/parrot/test/safety-email-verify.md` (SAFETY-VERIFY-LIVE-04 record, confirms silent hard-block live in prod with real evidence, 2026-05-28)

### Not verified in this pass (flagged, do not assume)
- `infra/LAKERA-PRICING.md` content/status (referenced but not read)
- Root-level CI/gate wiring for `screen.test.mjs` and Worker-side vitest suite
- Any `WorkerEntrypoint`/export-shape constraints beyond the single `export default {}` seen
  in `apps/parrot/workers/app.ts:323` (file not read in full — only grepped)

## Metadata

**Confidence breakdown:**
- Current silent-drop behaviour: HIGH — read the exact code path end to end, cross-checked
  against a real live-verification record (`safety-email-verify.md`) from 2026-05-28.
- Storage/UI seams: HIGH — schema, folder constants, routes, and DO methods all read directly.
- Trust-sender recommendation: MEDIUM — the mechanism (KV vs new table) is verified to exist/
  be buildable, but the per-employee-vs-workspace-wide choice is a genuine open product
  decision, not something the code resolves.
- Fail-open test pattern: HIGH for the Node side (existing file read in full); MEDIUM for the
  Worker side (no existing test to read, recommendation based on vitest's known mocking
  capabilities plus the existing Node pattern as a model).

**Research date:** 2026-07-16
**Valid until:** ~30 days (stable internal codebase, not a fast-moving external dependency;
re-verify if Lakera's v2 API schema changes or if another phase touches
`inbound-email.ts`/`migrations.ts` in the interim).
