---
phase: 05-operator-approval-gate
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - apps/app/src/server.mjs
  - apps/app/src/views.mjs
  - apps/app/src/auth.mjs
  - apps/app/src/outbound.mjs
autonomous: false
verification:
  surface: ui_affecting
  frontend_impact: true
  required_steps:
    - unit_tests
    - chrome_visual_check

must_haves:
  truths:
    - "/ops/drafts returns 200 for operator (publicMetadata.userType==='operator'), 403 for student/startup tokens"
    - "Draft queue lists all pending drafts with student name, startup name, role, body preview, and age"
    - "Operator can approve-as-is, edit-then-approve, or reject with optional reason from /ops/drafts/:id"
    - "Approving a student draft sends via SmsProvider (Spectrum); approving a startup draft sends via outbound email provider"
    - "After successful send: drafts.status='sent', sent_at, provider_message_id are set"
    - "After send failure: drafts.status stays 'approved', audit_events row written with event_type='draft_send_failed', operator sees retry option"
    - "Rejected drafts appear at /ops/feedback with rejection_reason"
    - "No code path other than /ops/drafts/:id/approve calls SmsProvider.send or outboundEmail.send"
  artifacts:
    - path: "apps/app/src/server.mjs"
      provides: "requireOperatorAuth middleware + /ops/drafts, /ops/drafts/:id, /ops/drafts/:id/approve, /ops/drafts/:id/reject, /ops/drafts/:id/edit, /ops/feedback routes"
    - path: "apps/app/src/views.mjs"
      provides: "renderDraftQueue, renderDraftDetail, renderFeedbackLog render functions"
    - path: "apps/app/src/auth.mjs"
      provides: "requireOperatorAuth export (checks publicMetadata.userType==='operator' via Clerk Backend API)"
    - path: "apps/app/src/outbound.mjs"
      provides: "routeAndSend(draft) — sole function permitted to call SmsProvider.send or outboundEmail.send"
  key_links:
    - from: "apps/app/src/server.mjs POST /ops/drafts/:id/approve"
      to: "apps/app/src/outbound.mjs routeAndSend"
      via: "direct import call"
    - from: "apps/app/src/outbound.mjs"
      to: "SmsProvider.send (Phase 01) OR outboundEmail.send (Phase 03)"
      via: "draft.channel branch ('sms_spectrum' vs 'email')"
    - from: "requireOperatorAuth"
      to: "Clerk Backend API clerkClient.users.getUser(clerkUserId)"
      via: "publicMetadata.userType === 'operator' check — server-side only, never trust client token claims for this"
---

<objective>
Build the operator approval gate: a server-rendered dashboard under `/ops/` where a Clerk operator user reviews, edits, approves, or rejects agent-produced drafts before any outbound message is sent.

Purpose: This is the safety contract for v1.2. No student SMS and no startup email leaves the system without flipping through `drafts.status='approved'` first. The only code that calls `SmsProvider.send` or `outboundEmail.send` is the single `/ops/drafts/:id/approve` handler, enforced by code structure (no other call-sites).

Output:
- `requireOperatorAuth` middleware (Clerk publicMetadata check, middleware-level not in-handler)
- GET/POST routes for draft queue, draft detail, approve, reject, edit-approve, feedback log
- `outbound.mjs` — the sole send-routing module; no other module calls provider send methods
- Server-rendered HTML views following the existing `views.mjs` pattern (no new build, no SPA)
- Negative auth test: student/startup Clerk token → `/ops/drafts` → 403
</objective>

<execution_context>
@~/.claude/rrr/workflows/execute-plan.md
@~/.claude/rrr/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/milestones/v1.2-two-sided-agent-mvp/research/ARCHITECTURE.md
@.planning/milestones/v1.2-two-sided-agent-mvp/research/PITFALLS.md
@apps/app/src/server.mjs
@apps/app/src/views.mjs
@apps/app/src/auth.mjs
</context>

<tasks>

<task type="auto">
  <name>Task 1: requireOperatorAuth middleware + negative auth test</name>
  <files>
    apps/app/src/auth.mjs
    apps/app/src/server.mjs
  </files>
  <action>
    In `auth.mjs`, add and export `requireOperatorAuth(req, res, config)`:
    - Calls `getAuth(req, config)` to get the Clerk session.
    - If no session, redirects to sign-in URL (same as `requireAuth`).
    - If session exists, calls `clerkClient.users.getUser(auth.clerkUserId)` via the Clerk Backend API (import `createClerkClient` from `@clerk/backend`; use `config.clerk.secretKey`). Do NOT trust publicMetadata from the session token claims — always re-fetch from the Backend API to prevent client-side forgery (PITFALLS #13).
    - Checks `user.publicMetadata?.userType === 'operator'`. If not, calls `sendJson(res, 403, { error: 'forbidden' })` and returns null.
    - Returns the auth object on success.

    IMPORTANT: `publicMetadata.userType` MUST be set via the Clerk Backend API or Clerk Dashboard ONLY. The client cannot write `publicMetadata`. This middleware enforces that by reading it server-side via `clerkClient.users.getUser`. Do NOT read it from `auth.sessionClaims.publicMetadata` — those are embedded in the JWT at sign-in time and can be stale or absent.

    In `server.mjs`, add a thin route guard helper `requireOperatorAuth(req, res)` that wraps the imported function with the local `config` — mirror the existing `requireAuth` pattern.

    Wire `requireOperatorAuth` as the first guard on ALL `/ops/drafts*` and `/ops/feedback` routes (added in Task 2). The middleware check runs before any handler logic.

    Write a test file `apps/app/src/auth.test.mjs` with two negative cases using Node's built-in `node:test` and `assert`:
    - Student Clerk token (publicMetadata.userType='student') → `requireOperatorAuth` → expect 403 response.
    - Startup Clerk token (publicMetadata.userType='startup') → `requireOperatorAuth` → expect 403 response.
    Use a mock `clerkClient.users.getUser` that returns controlled publicMetadata objects. Do not make real Clerk API calls in tests.
  </action>
  <verify>node --test apps/app/src/auth.test.mjs passes; both negative cases assert 403</verify>
  <done>
    - `requireOperatorAuth` exported from auth.mjs; reads publicMetadata via Clerk Backend API only
    - Student token → 403, startup token → 403 (tests pass)
    - Operator token (publicMetadata.userType='operator') → returns auth object (no redirect/error)
  </done>
</task>

<task type="auto">
  <name>Task 2: Draft queue view + draft detail view (read-only HTML)</name>
  <files>
    apps/app/src/server.mjs
    apps/app/src/views.mjs
  </files>
  <action>
    Add to `views.mjs`:

    `renderDraftQueue({ drafts })` — server-rendered HTML table. Each row: recipient type badge (STUDENT / STARTUP), student name or "—", startup name or "—", role title or "—", first 120 chars of `body`, age since `created_at` (e.g. "14m ago"). Row links to `/ops/drafts/:id`. Show "No drafts pending review." when `drafts` is empty. Include a filter bar with links: All | Student | Startup (query param `?type=student|startup`). Paginate at 50 rows (LIMIT 50 OFFSET from query param `?page=N`). Show age prominently — use a colored badge when age > 2h (PITFALLS #11).

    `renderDraftDetail({ draft, conversation, priorMessages })` — full draft body in a `<pre>` block. Context panel: student name + profile summary, startup name, role title + requirements excerpt (first 300 chars), prior conversation turns from `priorMessages` (each: direction, body, sent_at). Three action sections:
    1. Approve as-is: `<form method="POST" action="/ops/drafts/:id/approve">` with a hidden `edited_body` set to `draft.body`. Single submit button "Approve".
    2. Edit then approve: `<form method="POST" action="/ops/drafts/:id/edit">` with a `<textarea name="edited_body">` pre-filled with `draft.body`. Submit button "Edit & Approve".
    3. Reject: `<form method="POST" action="/ops/drafts/:id/reject">` with an optional `<input name="rejection_reason">` (placeholder: "Optional reason..."). Submit button "Reject".

    Add to `server.mjs`:

    `GET /ops/drafts` — calls `requireOperatorAuth`; queries:
    ```sql
    SELECT d.id, d.recipient_type, d.channel, d.body, d.status, d.created_at,
           s.name AS student_name, st.name AS startup_name, r.title AS role_title
    FROM drafts d
    LEFT JOIN conversations c ON d.conversation_id = c.id
    LEFT JOIN students s ON c.student_id = s.id
    LEFT JOIN startups st ON c.startup_id = st.id
    LEFT JOIN roles r ON c.role_id = r.id
    WHERE d.status = 'pending'
    ORDER BY d.created_at ASC
    LIMIT 50 OFFSET $offset
    ```
    Applies `type` filter if query param present. Renders `renderDraftQueue`.

    `GET /ops/drafts/:id` — calls `requireOperatorAuth`; loads draft row + conversation (student, startup, role); loads prior `inbound_messages` rows for the conversation ordered by `created_at` (last 10). Renders `renderDraftDetail`. Returns 404 if draft not found or status !== 'pending'.
  </action>
  <verify>
    Start the app locally (`npm run dev` or `node apps/app/src/server.mjs`). As an operator Clerk user, GET /ops/drafts returns 200 HTML with the queue table. GET /ops/drafts/:id for a real pending draft row returns 200 HTML with context and all three action forms. As a non-operator Clerk user, both routes return 403.
  </verify>
  <done>
    - /ops/drafts lists all pending drafts; empty state shows correct message; age > 2h badge visible
    - /ops/drafts/:id shows full body, context, prior messages, and all three action forms
    - Both routes 403 for non-operator tokens
  </done>
</task>

<task type="auto">
  <name>Task 3: outbound.mjs send router + approve/reject/edit POST handlers</name>
  <files>
    apps/app/src/outbound.mjs
    apps/app/src/server.mjs
  </files>
  <action>
    Create `apps/app/src/outbound.mjs` — this is the SOLE module permitted to call `SmsProvider.send` or `outboundEmail.send`. No other file in the codebase may call either method directly; all outbound is routed through `routeAndSend`.

    ```js
    // outbound.mjs
    export async function routeAndSend(draft, { smsProvider, emailProvider, store, config }) {
      const body = draft.edited_body || draft.body;
      let providerId;
      if (draft.channel === 'sms_spectrum' || draft.channel === 'sms_telnyx') {
        const result = await smsProvider.send({ to: draft.channel_address, body });
        providerId = result.messageId;
      } else if (draft.channel === 'email') {
        const result = await emailProvider.send({ to: draft.channel_address, body });
        providerId = result.id;
      } else {
        throw new Error(`Unknown draft channel: ${draft.channel}`);
      }
      return providerId;
    }
    ```

    On success: caller updates `drafts.status='sent'`, `sent_at=now()`, `provider_message_id=providerId`.
    On throw: caller keeps `drafts.status='approved'` (NOT 'sent') and writes `audit_events` row `event_type='draft_send_failed'` with `metadata: { draftId, channel, error: err.message }`.

    Add POST handlers to `server.mjs`, each guarded by `requireOperatorAuth`:

    `POST /ops/drafts/:id/approve`:
    1. Load draft; verify status === 'pending'. 422 if not.
    2. Set `status='approved'`, `operator_id=auth.clerkUserId`, `reviewed_at=now()`. Write to DB.
    3. Call `routeAndSend(draft, ...)`.
    4. On success: set `status='sent'`, `sent_at`, `provider_message_id`. Redirect to `/ops/drafts?approved=1`.
    5. On send failure: write `audit_events` (`event_type='draft_send_failed'`). Re-render `/ops/drafts/:id` with an error banner "Send failed — draft is still approved. Try again." Status stays 'approved'.

    `POST /ops/drafts/:id/edit`:
    1. Read `edited_body` from form body. Validate non-empty (400 if blank).
    2. Set `status='approved'`, `edited_body`, `operator_id`, `reviewed_at`. Write to DB.
    3. Also write `draft_feedback` row: `feedback_type='edited'`, `original_body=draft.body`, `corrected_body=edited_body`, `operator_id`.
    4. Call `routeAndSend` with the updated draft (uses `edited_body`). Same success/failure handling as approve.

    `POST /ops/drafts/:id/reject`:
    1. Read optional `rejection_reason` from form body.
    2. Set `status='rejected'`, `operator_id`, `reviewed_at`, `operator_note=rejection_reason`. Write to DB.
    3. Write `draft_feedback` row: `feedback_type='rejected'`, `original_body=draft.body`, `reason=rejection_reason`, `operator_id`.
    4. Redirect to `/ops/drafts?rejected=1`.

    `GET /ops/feedback`:
    Guarded by `requireOperatorAuth`. Queries:
    ```sql
    SELECT df.id, df.feedback_type, df.original_body, df.corrected_body, df.reason,
           df.created_at, df.operator_id,
           d.recipient_type, d.channel,
           s.name AS student_name, st.name AS startup_name, r.title AS role_title
    FROM draft_feedback df
    JOIN drafts d ON df.draft_id = d.id
    LEFT JOIN conversations c ON d.conversation_id = c.id
    LEFT JOIN students s ON c.student_id = s.id
    LEFT JOIN startups st ON c.startup_id = st.id
    LEFT JOIN roles r ON c.role_id = r.id
    ORDER BY df.created_at DESC
    LIMIT 100
    ```
    Renders a simple read-only HTML table via `renderFeedbackLog({ rows })` added to `views.mjs`. No delete or edit UI.

    **[USER ACTION]** Set `publicMetadata.userType = 'operator'` on your own Clerk user before testing the approval flow:
    - Clerk Dashboard → https://dashboard.clerk.com → select "Internjobs.ai" app → Users → find your user → "Edit public metadata" → set `{ "userType": "operator" }` → Save.
    - This field is backend-write-only; clients cannot write `publicMetadata`. Do not expose any API endpoint that lets a user set their own `publicMetadata.userType`.
  </action>
  <verify>
    1. With a seeded pending draft row in Neon: POST /ops/drafts/:id/approve → draft.status becomes 'sent', sent_at and provider_message_id set in DB.
    2. POST /ops/drafts/:id/reject with reason → draft_feedback row written, draft.status='rejected'.
    3. POST /ops/drafts/:id/edit with new body → draft_feedback row has feedback_type='edited', draft.status='sent'.
    4. Simulate send failure (set smsProvider.send to throw) → draft.status stays 'approved', audit_events row written with event_type='draft_send_failed'.
    5. GET /ops/feedback → returns 200 with rejected/edited rows visible.
    6. Grep the codebase: `grep -rn "smsProvider\.send\|emailProvider\.send\|SmsProvider\.send\|outboundEmail\.send" apps/app/src/ --include="*.mjs"` — only outbound.mjs appears.
  </verify>
  <done>
    - Approve: draft flips to 'sent'; correct provider called based on draft.channel
    - Send failure: status stays 'approved'; audit_events row exists
    - Reject: draft_feedback row written; draft.status='rejected'
    - Edit-approve: draft_feedback row type='edited'; correct body sent
    - /ops/feedback shows feedback rows
    - grep confirms outbound.mjs is the only file calling provider send methods
  </done>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <what-built>
    Full operator approval gate:
    - requireOperatorAuth middleware (Clerk Backend API check, not JWT claim)
    - /ops/drafts queue with age badges, filter, pagination
    - /ops/drafts/:id detail with approve / edit / reject forms
    - /ops/drafts/:id/approve, /edit, /reject POST handlers
    - outbound.mjs as sole send-routing module
    - /ops/feedback read-only log
    - Negative auth tests passing (student/startup → 403)
  </what-built>
  <how-to-verify>
    1. Confirm negative auth test passes: `node --test apps/app/src/auth.test.mjs`
    2. Start the app locally. Sign in as your operator Clerk account (publicMetadata.userType='operator' set via dashboard — see [USER ACTION] in Task 3).
    3. Seed a pending draft row directly in Neon:
       ```sql
       INSERT INTO drafts (recipient_type, channel, channel_address, body, status)
       VALUES ('student', 'sms_spectrum', '+15555550100', 'Test draft body', 'pending');
       ```
    4. Visit http://localhost:PORT/ops/drafts — confirm draft appears in table with age, student/startup columns.
    5. Click into the draft. Confirm all three action forms render.
    6. Click Approve. Confirm redirect to queue, draft gone from pending list.
    7. Seed another draft. Use Edit & Approve with modified body. Confirm draft_feedback row in Neon.
    8. Seed another draft. Reject with reason. Visit /ops/feedback — confirm row with reason appears.
    9. Sign in as a student Clerk account. Visit /ops/drafts — confirm 403.
    10. Run grep: `grep -rn "smsProvider\.send\|emailProvider\.send" apps/app/src/ --include="*.mjs"` — only outbound.mjs.
  </how-to-verify>
  <resume-signal>Type "approved" when all 10 checks pass, or describe which check failed and what you observed.</resume-signal>
</task>

</tasks>

<verification>
Mapping to the 5 phase success criteria:

1. **SC1 — /ops/drafts lists pending drafts, auth = requireOperatorAuth checking publicMetadata.userType**
   Verified by: negative auth test in auth.test.mjs (student/startup → 403); manual check step 4 above; requireOperatorAuth calls Clerk Backend API (not JWT claims per PITFALLS #13).

2. **SC2 — Approve as-is, edit-then-approve, reject with optional reason**
   Verified by: manual checks 5–8 above; all three forms present on detail view; DB row inspection.

3. **SC3 — Approve sends correct channel, updates status='sent', sent_at, provider_message_id**
   Verified by: manual check step 6; Neon row inspection after approval; outbound.mjs branch on draft.channel.

4. **SC4 — Rejected drafts appear in /ops/feedback with rejection_reason**
   Verified by: manual check step 8; draft_feedback table query.

5. **SC5 — No code path sends without drafts.status='approved' first**
   Verified by: grep check in step 10 (only outbound.mjs has provider send calls); outbound.mjs is called only from the approve/edit POST handlers which first set status='approved'; code review confirms no direct smsProvider.send calls in webhooks or other handlers.

Send failure path: status stays 'approved' (not 'sent') + audit_events row written — verifiable by simulating a throw in outbound.mjs during local test.
</verification>

<success_criteria>
- `node --test apps/app/src/auth.test.mjs` passes with both negative cases (student → 403, startup → 403)
- Operator (publicMetadata.userType='operator') reaches /ops/drafts; non-operators get 403
- All three approval actions (approve, edit-approve, reject) update the correct DB columns
- `grep -rn "smsProvider\.send\|emailProvider\.send\|\.send(" apps/app/src/ --include="*.mjs" | grep -v outbound.mjs` returns no results for provider send calls
- /ops/feedback returns a readable table of rejected/edited drafts
- Send failure leaves draft at status='approved' and writes audit_events row
</success_criteria>

<output>
After completion, create `.planning/milestones/v1.2-two-sided-agent-mvp/phase-05-operator-approval-gate/05-01-SUMMARY.md`
</output>
