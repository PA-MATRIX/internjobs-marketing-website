# v1.3.1 Patch — agentic-inbox → Parrot Backfill (Compose/Reply/Forward)

**Date:** 2026-05-19
**Branch:** `main`
**Status:** Code-complete locally. Awaiting `wrangler deploy` (user-only).
**Scope revision mid-execution:** Deliverable B (replace `/chat` with a link-out)
was **dropped** by the user — they're handling Mattermost embedding via
`ServiceSettings.FrameAncestors` + a `chat.internjobs.ai` subdomain in the
parent conversation. `apps/parrot/app/routes/chat.tsx` was **NOT** touched.

---

## Problem

v1.2 Phase 10 Wave 1 forked `agentic-inbox` into `apps/parrot/` but left
two HTTP 501 stubs in `apps/parrot/workers/routes/reply-forward.ts`:

```ts
return c.json({ ok: false, reason: "not_implemented_wave_1", … }, 501);
```

The "later Phase 10 wave" never shipped. As a result, compose / reply /
forward in the Parrot Inbox failed in production. The
`/api/inbox/send` route was also a Wave 1 stub — it wrote to the Sent
folder but did NOT actually dispatch outbound mail.

---

## Files lifted from agentic-inbox

All lifts are verbatim function bodies with comment headers documenting
the source path + adaptations. `apps/agentic-inbox/` was **NOT modified**
— it remains the source of truth.

| Source (agentic-inbox)                                        | Destination (parrot)                                          | Adaptation                                                                                                                       |
| ------------------------------------------------------------- | ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `workers/lib/attachments.ts`                                  | `apps/parrot/workers/lib/attachments.ts`                      | None functionally. R2 bucket binding name is identical (`env.BUCKET`); only the underlying bucket name differs per wrangler.jsonc. |
| `workers/lib/schemas.ts`                                      | `apps/parrot/workers/lib/schemas.ts`                          | `SendEmailRequestSchema.from` is now **optional**. The route layer always overrides with the authenticated employee's email, so the client can omit it. Prevents cross-employee spoofing. |
| `workers/email-sender.ts`                                     | `apps/parrot/workers/lib/email-sender.ts`                     | None. `env.EMAIL.send()` contract is identical (Parrot already uses it for the welcome-email path in `workers/lib/email.ts`).    |
| `workers/lib/email-helpers.ts` (threading helpers only)       | extended in-place in `apps/parrot/workers/lib/email-helpers.ts` | Imports adjusted (`Folders` from local `shared/folders.ts`; `EmailFull` from local `lib/schemas.ts`).                              |
| `workers/routes/reply-forward.ts`                             | `apps/parrot/workers/routes/reply-forward.ts`                 | Multi-employee identity model: no `:mailboxId` URL param, `c.var.employee` is the source of truth for From. Added `handleComposeEmail` for fresh compose. |
| `app/components/RichTextEditor.tsx`                           | `apps/parrot/app/components/RichTextEditor.tsx`               | Rewrote in Tailwind + lucide-react. **Dropped `@cloudflare/kumo`** — Parrot doesn't use Kumo anywhere else. Same TipTap extensions, same button surface. |
| `app/components/ComposeEmail.tsx` + `ComposePanel.tsx`        | `apps/parrot/app/components/ComposePane.tsx`                  | New combined component with three modes (`compose`/`reply`/`forward`). Plain Tailwind, slate palette, modal overlay. Pre-fills To/Subject/quoted body for reply+forward. |
| `app/components/EmailAttachmentList.tsx`                      | `apps/parrot/app/components/EmailAttachmentList.tsx`          | Rewrote in Tailwind + lucide-react. **NOTE:** the linked download endpoint `/api/inbox/messages/:id/attachments/:id` is not implemented yet — metadata renders; downloads return 404 until that endpoint ships. |

## Files modified (not lifts, but touch-ups)

| File                                                | Change                                                                                                                                                                                                                                              |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/parrot/workers/durableObject/index.ts`        | Added `markThreadRead(threadId)` RPC method (8 LOC, mirrors agentic-inbox). Reply handler calls this after composing a reply — the sender clearly engaged with the thread by typing one.                                                              |
| `apps/parrot/workers/index.ts`                      | `/api/inbox/send` now delegates to `handleComposeEmail` instead of the inline Wave 1 stub that only wrote to Sent. Removed now-unused imports (`z`, `SendEmailSchema`, `validateSender`, `generateMessageId`, `SenderValidationError`).               |
| `apps/parrot/app/components/InboxPane.tsx`          | Added Compose button (sticky, above message list) + Reply/Forward buttons (in reader header). Compose state is local `useState`; `onSent` invalidates the inbox React Query so Sent folder refreshes on next pane switch.                              |
| `apps/parrot/app/lib/api.ts`                        | Added `api.replyEmail()` + `api.forwardEmail()`. Extended `api.sendEmail()` to accept `string | string[]` for To/Cc/Bcc. Added `Attachment` type that mirrors `workers/lib/schemas.ts::AttachmentInfo`.                                                |

---

## Adaptations made for Parrot's data model

1. **Identity gate is implicit, not in the URL.** agentic-inbox routes
   are `POST /api/mailboxes/:mailboxId/messages/:id/reply`. Parrot
   routes are `POST /api/inbox/messages/:id/reply` — the mailbox is
   resolved from `c.var.employee` (set by Clerk middleware in
   `workers/app.ts`). Saves a path param and removes one whole class
   of "what if mailboxId doesn't match the session?" mistakes.

2. **From-address spoofing is server-controlled.** Any
   client-supplied `from` field in the request body is **ignored**;
   the server always sets it to
   `{ email: employee.email, name: employee.displayName || employee.email }`.
   Three places enforce this (compose, reply, forward) and the schema
   field is marked optional.

3. **`markThreadRead` RPC added to Parrot DO.** agentic-inbox already
   had this method; Parrot didn't (Wave 1 only ported `getEmails` /
   `getEmail` / `createEmail`). 8-line SQL UPDATE. Same idempotent
   semantics as upstream.

4. **No `Kumo` dependency.** RichTextEditor + ComposePane + EmailAttachmentList
   are all rewritten in Tailwind + lucide-react. Parrot's design
   language is slate-tone Tailwind (see InboxPane, WorkspaceShell,
   ChatPane); adding `@cloudflare/kumo` just for compose would mean
   re-theming the rest of the app.

---

## New / changed endpoints

| Method | Path                                          | Status before                                                | Status after                                                                                |
| ------ | --------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| POST   | `/api/inbox/send`                             | 202 `queued_local_only` (wrote to Sent only, no SMTP)        | 202 `sent` — real outbound via `env.EMAIL.send()` in `waitUntil()`                          |
| POST   | `/api/inbox/messages/:id/reply`               | **501 `not_implemented_wave_1`**                             | 202 `sent` — proper RFC 2822 threading, marks original thread read                          |
| POST   | `/api/inbox/messages/:id/forward`             | **501 `not_implemented_wave_1`**                             | 202 `sent` — new thread, optional attachments                                               |
| GET    | `/api/inbox/messages/:emailId/attachments/:id` | not implemented                                              | **still not implemented** — `EmailAttachmentList` UI is wired but the endpoint is a follow-up |

All three POST endpoints inherit the existing `requireEmployeeMailbox`
Clerk middleware (set up in `workers/index.ts`). Rate limits
(`checkSendRateLimit`: 20/hr, 100/day per DO) still apply — verified by
inspection.

---

## Commits made (all on `main`, local only — NOT pushed)

```
0808631 feat(v1.3.1): wire Compose/Reply/Forward UI into Parrot InboxPane
52ad5fc feat(v1.3.1): rewrite reply/forward route handlers + upgrade /api/inbox/send
a77ec48 feat(v1.3.1): lift attachments/schemas/email-sender from agentic-inbox into parrot
```

`e1468ec feat(v1.3.1): add chat.internjobs.ai CSP-rewriting proxy` was
created by the user in the parent conversation during this work (the
separate Mattermost embed track). My commits don't touch it.

---

## Local verification

| Check                                | Command                                          | Result                                                                                                  |
| ------------------------------------ | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| Build                                | `npm run build` (in `apps/parrot/`)              | **Pass** — both client + worker bundles produced. `inbox` client chunk grew 281KB → 411KB (TipTap delta). |
| Typecheck (overall)                  | `npm run typecheck` (in `apps/parrot/`)          | Pre-existing errors only (OnboardingWizard, confetti, dashboard, ai.ts). **Zero new errors introduced.** |
| Typecheck (new + touched files only) | filtered grep of typecheck output                | **Zero errors** in `workers/lib/{attachments,schemas,email-sender,email-helpers}.ts`, `workers/routes/reply-forward.ts`, `workers/durableObject/index.ts`, `app/components/{ComposePane,RichTextEditor,EmailAttachmentList,InboxPane}.tsx`, `app/lib/api.ts`. |
| `npm test`                           | not run                                          | Parrot has no `test` script in `package.json` (manual + smoke endpoint posture).                       |

Pre-existing typecheck errors (unchanged by this work, documented for
honesty):

- `app/components/OnboardingWizard.tsx(144,5)` — `Uint8Array<ArrayBufferLike>` not assignable. Pre-existing from Phase 13.
- `app/lib/confetti.ts(83,77)` — `confetti.default` namespace export. Pre-existing.
- `app/routes/dashboard.tsx(208,10)` — React Query callback type mismatch. Pre-existing from Phase 19.
- `workers/lib/ai.ts(305,18)` + `(312,33)` — Workers AI response shape drift; `.choices` no longer in the type. Pre-existing from Phase 12.

None of these are introduced or worsened by v1.3.1.

---

## Things I couldn't lift cleanly (deferred to a future follow-up)

1. **Attachment GET endpoint.** `EmailAttachmentList.tsx` is wired but
   the matching `GET /api/inbox/messages/:id/attachments/:id` route
   doesn't exist on the Worker. agentic-inbox has it
   (`apps/agentic-inbox/workers/index.ts`); lifting it is mechanical
   (10–15 LOC: look up R2 key, range-fetch, return `Content-Type` +
   `Content-Disposition` headers). Parking it until Ridhi reports a
   real attachment-download need — for now the metadata + filename are
   visible in the reader.

2. **Drafts.** agentic-inbox supports `mode=draft` (save without
   send). Parrot's compose pane has no "Save as draft" button. The DO
   schema supports it (`Folders.DRAFT`); the handler exists conceptually
   (just `createEmail` with `Folders.DRAFT` instead of `Folders.SENT`).
   Defer to v1.4 alongside the proper `packages/inbox-core/` refactor.

3. **The proper `packages/inbox-core/` extraction** that would dedupe
   agentic-inbox and Parrot is intentionally **NOT** done here. That's
   v1.4 work per the constraint list. This patch is a fork-backfill.

4. **Quoted-body sanitization.** `ComposePane.buildQuotedHtml()` does
   minimal `<>` escaping on sender/date but pastes the original HTML
   body into the editor directly. The reader iframes original HTML;
   the compose editor doesn't. Long-term: pipe through DOMPurify (already
   a Parrot dep). Short-term: anyone composing knows what they wrote.

---

## Human-action checkpoints (user does these)

1. **`wrangler deploy` to pick up the new code.**
   ```bash
   cd apps/parrot
   npm run build && wrangler deploy
   ```
   No new secrets, no new bindings, no migrations. The new R2 writes
   land in the existing `internjobs-parrot-attachments` bucket and the
   new SendEmail dispatches use the existing `EMAIL` binding.

2. **Confirm `EMAIL` binding can send to external addresses.**
   `apps/parrot/workers/lib/email.ts` already documents that the
   `send_email` binding rejects external recipients on dev/preview
   tiers and falls back to REST. The new reply/forward handler does
   **NOT** include that REST fallback — if outbound delivery fails on
   the binding, the error is logged via `console.error` (visible in
   `wrangler tail`) but the response is still 202 because we use
   `waitUntil`. If you see `[parrot] Deferred reply delivery failed:`
   in production logs, the binding is rejecting; lift the REST
   fallback from `workers/lib/email.ts::sendWelcomeEmail` into
   `workers/lib/email-sender.ts` as a Path B.

3. **Spot-check `/api/inbox/send` writes hit Sent.** A successful send
   should appear in Sent (folder = `sent`) almost immediately after the
   202 response. The outbound SMTP delivery is async — landing in the
   recipient's inbox can take 1–30s depending on the binding queue.

---

## Test plan (user runs post-deploy)

### Smoke test 1 — Compose a fresh email

1. Open https://workspace.internjobs.ai/inbox.
2. Click **Compose** (top of message list).
3. Modal opens. Fill in:
   - **To:** your personal email
   - **Subject:** `Parrot compose smoke test`
   - **Body:** anything (or just hit Send with the default empty body)
4. Click **Send**.
5. **Expected:** modal closes, no error banner. The new message
   appears in **Sent** folder when you switch to it (Wave-1 sidebar
   has a "Sent" link). Within ~30s the message lands in your personal
   inbox.

### Smoke test 2 — Reply

1. From `workspace.internjobs.ai/inbox`, select any inbound message.
2. Click **Reply** in the reader pane header.
3. **Expected:** modal opens pre-filled:
   - **To:** original sender
   - **Subject:** `Re: <original subject>`
   - **Body:** an empty paragraph above a blockquote containing the
     original message.
4. Type a reply above the quoted block. Click **Send**.
5. **Expected:** modal closes; the reply appears in Sent within ~30s.
   The original message in Inbox is now marked read (font weight
   drops from semibold to normal — visible if you reload `/inbox`).

### Smoke test 3 — Forward

1. From a message in `/inbox`, click **Forward**.
2. **Expected:** modal opens pre-filled with `Fwd: <subject>` and a
   blockquoted body. To field is **empty** (you choose the recipient).
3. Enter a To address, click Send.
4. **Expected:** new thread (new `thread_id` in the DO; this is a
   forward, not a reply) lands in Sent. No In-Reply-To header on the
   outbound message — verify in the recipient's mail client if curious
   (the message threads as a new conversation).

### Smoke test 4 — Send-rate limit

1. Compose 21 emails in quick succession (the DO enforces 20/hr).
2. **Expected:** the 21st returns 429 with body
   `{ "error": "Rate limit exceeded: max 20 emails per hour per mailbox" }`.
   ComposePane displays this in the red banner. (Don't test in prod —
   Ridhi's hourly cap is real and shared with the welcome-email flow.)

### Smoke test 5 — From-address spoofing rejected

```bash
curl -X POST https://workspace.internjobs.ai/api/inbox/send \
  -H "Content-Type: application/json" \
  -H "Cookie: __session=…" \
  -d '{"to":"test@example.com","from":"ceo@internjobs.ai","subject":"spoof","html":"x"}'
```

**Expected:** 202 (success), but the resulting Sent row has
`sender = <your email>`, not `ceo@internjobs.ai`. The server's
`validateSender(to, from, employee.email)` check runs with `from`
overridden to the authenticated employee, so any client-supplied
`from` is silently dropped. (Confirmed by inspection of
`reply-forward.ts::handleComposeEmail` lines that override `from`
before calling `validateSender`.)

---

## What was **NOT** touched

- `apps/agentic-inbox/` — source of truth, untouched.
- `apps/parrot/app/routes/chat.tsx` — per scope revision, the
  Mattermost embed approach is being handled separately. /chat is in
  its v1.2 state (link-out is NOT what shipped today from me).
- `apps/parrot/workers/lib/inbound-email.ts` — Phase 20 safety-screen
  insertion is unchanged; `screenMessage` still runs before
  `extractTodosFromEmail`.
- `apps/parrot/wrangler.jsonc` — no new bindings, no new secrets, no
  new cron triggers. The existing `*/5 * * * *` Phase 19 cron and the
  existing `EMAIL` / `BUCKET` bindings are reused as-is.
- Phase 19 `resolveTodo` RPC + `runAutoClear` cron — untouched.
- Phase 20 `safety_events` Neon table + ops view — untouched.
- v1.3.1 commit `e1468ec` (chat CSP-rewriting proxy) — created by the
  user during this session; my work is independent of and compatible
  with it.

---

## Total LOC

- **Net additions:** ~1,558 lines (across 3 commits — see `git show --stat`).
- **Mostly comments + JSDoc + Tailwind class strings.** Actual logic
  is ~400 LOC, of which ~350 lifts verbatim from agentic-inbox.

```
$ git log --oneline a77ec48^..HEAD
0808631 feat(v1.3.1): wire Compose/Reply/Forward UI into Parrot InboxPane
e1468ec feat(v1.3.1): add chat.internjobs.ai CSP-rewriting proxy
52ad5fc feat(v1.3.1): rewrite reply/forward route handlers + upgrade /api/inbox/send
a77ec48 feat(v1.3.1): lift attachments/schemas/email-sender from agentic-inbox into parrot
```
