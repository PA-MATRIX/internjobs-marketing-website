# ATTACH-DOWN-01..03 — Workspace attachment download live verify record

**Plan:** 23-03
**Phase:** 23 — Workspace Pilot Closeouts (v1.4)
**Requirements:** ATTACH-DOWN-01, ATTACH-DOWN-02, ATTACH-DOWN-03
**Status:** PASSED (Chrome + all negatives) — Safari portion remains deferred (no Mac available). Verified 2026-05-28.
**Code status:** COMPLETE
**Code commits:** `f00e388` (route) + `cff5234` (UI wire) on `rrr/v1.4/team-workspace-23`
**Date:** 2026-05-26 (record opened)

## Summary

The code-side deliverable for ATTACH-DOWN-01..03 is shipped:

- The Workspace Worker now serves `GET /api/inbox/messages/:messageId/attachments/:attachmentId`
  via `handleAttachmentDownload` in `apps/parrot/workers/routes/attachments.ts`.
- The route is mounted in `apps/parrot/workers/index.ts` under the
  `requireEmployeeMailbox` middleware so every request is gated on a
  valid Clerk session.
- `EmailAttachmentList.tsx` chips now carry the `download={att.filename}`
  attribute, completing the wire so a Chrome/Safari click triggers a
  browser-native file save rather than navigation.

Live verification — actually clicking a chip in a deployed Workspace inbox
in both Chrome and Safari — is deferred to an operator window with prod
Cloudflare API token access. Same blocker as Plan 23-02
(SAFETY-VERIFY-LIVE-04): the `CLOUDFLARE_BROAD_API_TOKEN` in Infisical at
`/internjobs-ai/CLOUDFLARE_BROAD_API_TOKEN` is rejected by Cloudflare
(`code:1000 Invalid API Token`), and the current operator
(nithin@growthpods.io) lacks prod Cloudflare team membership to deploy.
This is an operator-credential gap, not a code defect.

## What was verified (code-side)

- [x] `apps/parrot/workers/routes/attachments.ts` exists and exports
  `handleAttachmentDownload(c: AppContext)`.
- [x] Route is mounted at
  `GET /api/inbox/messages/:messageId/attachments/:attachmentId` in
  `apps/parrot/workers/index.ts` under `requireEmployeeMailbox`
  (Clerk session required).
- [x] Ownership check via `stub.getEmail(messageId)` against the
  authenticated employee's own DO. Message not in their mailbox → 403
  (timing-safe; doesn't leak existence of messages in other DOs).
- [x] Attachment metadata not found within the email → 404.
- [x] R2 blob missing under the reconstructed key → 404.
- [x] R2 key matches `apps/parrot/workers/lib/inbound-email.ts:155`
  source-of-truth convention:
  `attachments/{clerk_user_id}/{messageId}/{attachmentId}/{filename}`.
  Implementation reads `clerk_user_id` (snake_case via unknown-cast) with
  fallback to `Employee.employeeId` (camelCase canonical Clerk user ID
  per `workers/lib/mailbox.ts`). Both resolve to the same string at
  runtime since DOs are keyed by Clerk user ID.
- [x] Response headers: `Content-Type` from attachment metadata
  (falls back to `application/octet-stream`); RFC-6266
  `Content-Disposition: attachment; filename="..."; filename*=UTF-8''...`
  for Chrome + Safari Save dialog compatibility; explicit `Content-Length`;
  `Cache-Control: private, max-age=3600`.
- [x] UI: `EmailAttachmentList.tsx` chip is an `<a href download
  target="_blank" rel="noopener noreferrer">` pointing at the route.
  No `fetch()`, no React Query — direct browser download.
- [x] `npx tsc --noEmit` clean in `apps/parrot` (zero new errors).

## What remains (operator verification — pending)

Required operator actions, in order. **Shared blocker with Plan 23-02 —
the deploy step is identical, so if 23-02 lands first, 23-03 ships
on the same deploy. See `apps/parrot/test/safety-email-verify.md`
section "What remains" for the verbatim deploy runbook (CF token
rotation scopes + `npm run deploy` invocation) — do not duplicate it
here.**

### 1. Deploy the Worker

Reuse the deploy step from `safety-email-verify.md` ("What remains"
steps 1 + 2). After `npm run deploy` reports a new version hash,
record it under `## Live verification results` below.

### 2. Sign in to workspace.internjobs.ai

Use a Clerk phone-OTP session for any seeded employee account that has
at least one email with one or more attachments already received in
their inbox.

If no inbox emails have attachments, send a test email with a PDF
attached from any external address to that employee's
`<name>@internjobs.ai` workspace alias. Wait for the inbound to land
(check via the existing /api/inbox/messages view).

### 3. Chrome browser test (ATTACH-DOWN-03 — Chrome)

1. Open the email containing an attachment.
2. Click an attachment chip in the panel below the email body.
3. Confirm: Chrome initiates a file download (DownloadShelf at bottom).
4. Confirm: downloaded filename matches the chip's filename label.
5. Confirm: opening the downloaded file produces the original content
   (PDF opens, image renders, no corruption).
6. PASS = all 4 confirmed.

### 4. Safari browser test (ATTACH-DOWN-03 — Safari)

1. Repeat steps 1-5 above in Safari (macOS or iPadOS).
2. Note: Safari shows a download notification in the toolbar rather
   than a bottom shelf — that still counts as PASS as long as the
   file lands in the Downloads folder and opens correctly.
3. PASS = all 4 confirmed.

### 5. Ownership negative test (ATTACH-DOWN-02 — 403)

From any logged-in session, copy a working attachment URL from the
network inspector — shape:

```
https://workspace.internjobs.ai/api/inbox/messages/<MESSAGE_UUID>/attachments/<ATT_UUID>
```

Then sign out and curl it without a session cookie OR sign in as a
different employee and curl with their session:

```bash
curl -I "https://workspace.internjobs.ai/api/inbox/messages/<MESSAGE_UUID>/attachments/<ATT_UUID>"
# unauthenticated → expect HTTP/2 401
# different employee → expect HTTP/2 403
```

PASS = 401 (no session) or 403 (wrong employee). FAIL = 200.

### 6. Missing attachment negative test (ATTACH-DOWN-02 — 404)

Take a working URL and replace the attachmentId with an all-zeros UUID:

```
https://workspace.internjobs.ai/api/inbox/messages/<REAL_MESSAGE_UUID>/attachments/00000000-0000-0000-0000-000000000000
```

While signed in as the message owner:

```bash
curl -i -H "Cookie: <session-cookie>" "<that URL>"
# expect HTTP/2 404
# expect body: {"error":"not_found"}
```

PASS = 404. FAIL = 200 or 500.

### 7. Append results

Add a `## Live verification results` section to this file with:

- Deploy timestamp + version hash
- Browser test row for Chrome (PASS/FAIL + screenshots if FAIL)
- Browser test row for Safari (PASS/FAIL + screenshots if FAIL)
- 403 negative test result
- 404 negative test result
- Filename / size of a sample successful download

Then change `Status:` at the top of this file to `PASSED` (or `FAILED`
with gap analysis).

## Live verification results

**Date:** 2026-05-28
**Operator:** Nithin (rentalaraj@gmail.com)
**Worker version hash:** `160c98aa-1af0-4973-b8f9-79a1385694cd`
**Deploy account:** prod CF `0fffd3dc637bdb26d4963df445a69fd3`
**Test recipient (Employee A):** `nithin.test@internjobs.ai` (employee_id `365d02c4-d71b-437b-b4b7-661a0853f5f8`, clerk user `user_3EJdXNOkv9YyzE8eBbSqIYZVK9Y`)
**2nd employee (Employee B):** `bee.test@internjobs.ai` (created for 403 test only)
**Sender:** `21bd1a12b4itb@gmail.com`
**Test message ID:** `a7eced3a-1bee-4d34-b05d-05f1c4dc6bdc` (delivered 2026-05-28 1:06:43 AM, `attachments=1`)
**Test attachment ID:** `640ad170-cc9d-4451-ab83-d366d0355fb0`

### Inbound delivery (tail evidence)

```
Email from:21bd1a12b4itb@gmail.com to:nithin.test@internjobs.ai size:98157
  (log) {"event":"lakera_latency_ms","ms":690,"channel":"email"}
  (log) Parrot inbound: routed to nithin.test@internjobs.ai
        (employee=365d02c4..., msg=a7eced3a..., attachments=1)
EmployeeMailboxDO.createEmail - Ok
```

R2 store + DO row created on first deploy of internjobs-parrot Worker; no backfill needed.

### Chrome positive (ATTACH-DOWN-03 Chrome)

Operator signed in to workspace.internjobs.ai as Employee A via Clerk phone-OTP. Opened "test attachment" email in inbox.

| Step | Result |
|------|--------|
| Inbox shows the message | PASS |
| Attachment chip renders below body | PASS |
| Click chip → Chrome initiates download | PASS |
| Downloaded filename matches chip label | PASS |
| Opening file produces original content | PASS |

**Chrome: PASSED**

### Safari (ATTACH-DOWN-03 Safari)

**DEFERRED** — operator has no Mac access. Code is identical to Chrome path (RFC-6266 Content-Disposition + `download` attribute on anchor). Safari verification can be picked up in a later operator window if/when Mac access becomes available; not a code defect.

### Negative tests (ATTACH-DOWN-02)

| Test | Method | Status | Response body |
|------|--------|--------|---------------|
| 401 no session | `curl -i` to attachment URL without cookie | `HTTP/1.1 401 Unauthorized` | `{"error":"unauthenticated"}` |
| 403 cross-user | Employee B signed in via Clerk OTP (spare phone 2), navigated to A's attachment URL in address bar | 403 status visible via browser response panel | `{"error":"forbidden"}` |
| 404 bogus attachmentId | Employee A's browser, address bar to same message ID + attachmentId `00000000-0000-0000-0000-000000000000` | 404 status visible via browser response panel | `{"error":"not_found"}` |

All 3 negative cases PASSED. Ownership enforcement (DO-internal stub.getEmail check at `attachments.ts`) verified end-to-end.

### Result

- ATTACH-DOWN-01 (route serves attachment): **PASSED** (Chrome download succeeded; R2 → response wire confirmed)
- ATTACH-DOWN-02 (auth + ownership negatives): **PASSED** (401 / 403 / 404 all returned correct status + body)
- ATTACH-DOWN-03 Chrome: **PASSED**
- ATTACH-DOWN-03 Safari: **DEFERRED** (no Mac; code path identical to Chrome)

## Notes

- The R2 bucket binding is `BUCKET` in `apps/parrot/wrangler.jsonc`
  (Cloudflare bucket `internjobs-parrot-attachments`). Attachments
  written by `inbound-email.ts` since v1.2 Phase 12-fix are addressable
  by the route immediately on first deploy — no backfill required.
- Email Routing → DO write happens synchronously inside `receiveEmail`,
  so any attachment visible in the React inbox is also fetchable from
  R2 (no eventual-consistency delay between the two).
- The `target="_blank"` on the chip means the download doesn't navigate
  away from the email view — important for the agent-assist workflow
  where the operator triages emails while attachments save in the
  background.
- This file will be appended-to (not rewritten) when verification runs —
  the "What was verified (code-side)" section above is permanent record.

## Cross-references

- `apps/parrot/test/safety-email-verify.md` — sibling deferred-verify
  record (23-02) with the same operator deploy blocker; shares the
  deploy runbook to avoid duplication.
- `.planning/milestones/v1.4-pilot-readiness/phases/23-workspace-pilot-closeouts/23-03-SUMMARY.md`
  — plan summary with status, commits, and forward path.
- `apps/parrot/workers/routes/attachments.ts` — the route implementation.
- `apps/parrot/workers/lib/inbound-email.ts:155` — R2 key convention
  source of truth (this verify file's R2 key reconstruction must match).
- `apps/parrot/app/components/EmailAttachmentList.tsx` — UI chip
  rendering with the `download` attribute that triggers the browser save.
- `apps/parrot/workers/lib/mailbox.ts` — `requireEmployeeMailbox`
  middleware that gates the route on a Clerk session.
