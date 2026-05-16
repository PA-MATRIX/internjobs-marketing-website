---
phase: 06-two-sided-integration
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - apps/app/src/routes/admin.mjs
  - apps/app/test/integ-01-runbook.md
  - apps/app/test/integ-01-VERIFICATION.md
autonomous: false
verification:
  surface: backend_only
  frontend_impact: false
  required_steps:
    - unit_tests
must_haves:
  truths:
    - "All 11 INTEG-01 steps execute in production without manual DB intervention"
    - "Each step produces the expected Neon row(s), confirmed by SQL snapshot"
    - "No outbound message is sent without a corresponding drafts.status='sent' transition"
    - "Test transcript and Neon snapshots are recorded in VERIFICATION.md"
  artifacts:
    - path: "apps/app/test/integ-01-runbook.md"
      provides: "Step-by-step operator guide with exact SQL verify snippet per step"
    - path: "apps/app/test/integ-01-VERIFICATION.md"
      provides: "Fillable transcript — 11 checkboxes + paste-the-result fields"
    - path: "apps/app/src/routes/admin.mjs"
      provides: "GET /admin/integ-01-status behind requireOperatorAuth"
  key_links:
    - from: "Spectrum inbound webhook"
      to: "inbound_messages row (provider='spectrum')"
      via: "POST /webhooks/spectrum → recordInboundMessage"
    - from: "inbound_messages row"
      to: "drafts row (status='pending')"
      via: "mastra.workflows.triggerWorkflow"
    - from: "drafts approval"
      to: "drafts.status='sent' + outbound send"
      via: "POST /ops/drafts/:id/approve"
    - from: "startup email reply"
      to: "inbound_messages row (provider='email')"
      via: "CF Worker → POST /webhooks/email"
---

<objective>
Execute the full INTEG-01 two-sided smoke test in production and record the outcome.

Purpose: Validate that Phases 01–05 wire together end-to-end. This phase is a test protocol plus one small read-only admin endpoint. It also closes the v1.0/v1.1 audit gap — VERIFICATION.md is the artifact that was missing.

Output: runbook + VERIFICATION.md skeleton + /admin/integ-01-status endpoint + a completed VERIFICATION.md.
</objective>

<execution_context>
@~/.claude/rrr/workflows/execute-plan.md
@~/.claude/rrr/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/REQUIREMENTS.md
@.planning/milestones/v1.2-two-sided-agent-mvp/research/FEATURES.md
@.planning/milestones/v1.2-two-sided-agent-mvp/research/ARCHITECTURE.md
@.planning/milestones/v1.2-two-sided-agent-mvp/research/PITFALLS.md
</context>

<tasks>

<task type="auto">
  <name>Task 1: Write integ-01-runbook.md</name>
  <files>apps/app/test/integ-01-runbook.md</files>
  <action>
Create apps/app/test/ if it does not exist. Write apps/app/test/integ-01-runbook.md.

IMPORTANT CONSTRAINT: Telnyx is NOT active in v1.2. All SMS references use Spectrum/Photon. Step 1 says "Spectrum pairing screen," not Telnyx.

The file must have two sections:

**Section A — PRE-FLIGHT CHECKLIST**

Six items, each marked `**[USER ACTION]**` with exact verification instructions:

1. DNS proxy resolved (SEC-01) — `accounts.internjobs.ai` and `clerk.internjobs.ai` are DNS-only (gray cloud) in Cloudflare. Verify by completing a real LinkedIn → Clerk sign-in at `https://app.internjobs.ai` from incognito.
2. Clerk key rotated (SEC-ROTATE-01) — Fresh `CLERK_SECRET_KEY` in Infisical `prod`/`/internjobs-ai`, re-imported to Fly via `flyctl secrets import -a internjobs-ai-student-app`.
3. All prod migrations applied — Query `schema_migrations` via Fly SSH; must include `0001_waitlist_foundation`, `0002_waitlist_threads_and_enrichment`, `0003_v1_2_two_sided_agent`.
4. /healthz fully green — `curl -s https://app.internjobs.ai/healthz | jq .` — all keys `true`; expected: `clerk`, `database`, `photonNumber`, `photonWebhook`, `spectrumListener`, `emailWorkerSecret`, `resendApiKey`.
5. Operator account configured — `publicMetadata.userType = 'operator'` set in Clerk Dashboard. `/ops/drafts` loads as operator (200, not 403).
6. Test assets ready — Real phone for Spectrum SMS. Gmail/Outlook inbox for startup role.

**Section B — 11-STEP SMOKE TEST**

Each step follows this exact template:
```
### Step N — [title]

**[USER ACTION]**: [exact instruction if human action required; omit line if no user action]

Observable: [what the user sees or receives]

SQL verify (replace :cuid with your Clerk user ID):
[parameterized SQL snippet querying the relevant table(s)]

Pass condition: [what must be true in the query result]
```

The 11 steps map to FEATURES.md INTEG-01 as follows (adapted for Spectrum, not Telnyx):

- Step 1: Student signs in via LinkedIn → lands on Spectrum pairing screen at /pairing. SQL: `SELECT id, channel_confirmed_at FROM students WHERE clerk_user_id = :'cuid'`. Pass: row exists, `channel_confirmed_at IS NULL`.

- Step 2: Student texts the exact pairing message to Spectrum number → `channel_confirmed_at` is set. SQL: `SELECT channel_confirmed_at FROM students WHERE clerk_user_id = :'cuid'` + `SELECT confirmed_at FROM pairing_codes WHERE student_id = (SELECT id FROM students WHERE clerk_user_id = :'cuid')`. Pass: both non-null.

- Step 3: Student texts `Hey what's next?` to Spectrum number → `inbound_messages` row created. SQL: `SELECT provider, body, processed_at FROM inbound_messages WHERE student_id = (SELECT id FROM students WHERE clerk_user_id = :'cuid') ORDER BY created_at DESC LIMIT 3`. Pass: row with `provider = 'spectrum'`.

- Step 4: Mastra workflow fires (wait up to 60 s) → `drafts` row with `recipient_type = 'student'`, `status = 'pending'`. SQL: select from `drafts` joined through `conversations` on student_id. Note: if no row after 60 s, check `audit_events` for `no_roles_to_match` — a startup with an active role must exist.

- Step 5: `**[USER ACTION]**` — Operator logs into `/ops/drafts` and sees the draft. Pass: dashboard loads, draft visible (no SQL needed).

- Step 6: `**[USER ACTION]**` — Operator approves the student-side draft. Observable: test phone receives SMS. SQL: `SELECT status, sent_at, provider_message_id FROM drafts WHERE ... AND recipient_type = 'student' ORDER BY created_at DESC LIMIT 3`. Pass: `status = 'sent'`, `provider_message_id` non-null.

- Step 7: Agent creates startup-side draft (wait up to 60 s) → `drafts` row with `recipient_type = 'startup'`, `channel = 'email'`, `status = 'pending'`. SQL: same drafts query filtered to `recipient_type = 'startup'`.

- Step 8: `**[USER ACTION]**` — Operator approves the startup-side draft. Observable: startup test inbox receives email from `noreply@internjobs.ai`; Reply-To is `conv_<conversation_id>@internjobs.ai`. SQL: `SELECT status, sent_at, provider_message_id FROM drafts WHERE ... AND recipient_type = 'startup' ORDER BY created_at DESC LIMIT 3`. Pass: `status = 'sent'`.

- Step 9: `**[USER ACTION]**` — Startup replies to the email with `Thanks — this sounds interesting. What's the student's availability?`. SQL: `SELECT provider, channel_type, body FROM inbound_messages WHERE startup_id IN (SELECT startup_id FROM conversations WHERE student_id = ...) ORDER BY created_at DESC LIMIT 3`. Pass: row with `provider = 'email'`.

- Step 10: Mastra workflow fires (wait up to 60 s) → second `drafts` row for `recipient_type = 'student'`, `status = 'pending'`. SQL: select student drafts ordered by created_at, expect count >= 2.

- Step 11: `**[USER ACTION]**` — Operator approves the second student draft. Observable: test phone receives a second SMS. SQL: count of student drafts with `status = 'sent'` must be >= 2.

**Section C — FULL CONVERSATION AUDIT QUERY**

```sql
SELECT d.recipient_type, d.channel, d.status, d.sent_at,
       left(d.body, 80) AS body_preview, d.created_at
FROM drafts d
JOIN conversations c ON d.conversation_id = c.id
WHERE c.student_id = (SELECT id FROM students WHERE clerk_user_id = :'cuid')
ORDER BY d.created_at ASC;
```
Expected: 3+ rows, all `status = 'sent'`. Paste output into VERIFICATION.md.
  </action>
  <verify>
    ls -la apps/app/test/integ-01-runbook.md
  </verify>
  <done>apps/app/test/integ-01-runbook.md exists with pre-flight checklist (6 items), all 11 steps (each with [USER ACTION] where applicable, observable outcome, SQL snippet, pass condition), and the full conversation audit query.</done>
</task>

<task type="auto">
  <name>Task 2: Write VERIFICATION.md skeleton and add GET /admin/integ-01-status</name>
  <files>
    apps/app/test/integ-01-VERIFICATION.md
    apps/app/src/routes/admin.mjs
  </files>
  <action>
**File 1 — apps/app/test/integ-01-VERIFICATION.md**

Write a fillable skeleton with:
- Header fields: Date executed, Operator, Test student Clerk user ID, Test startup email, Spectrum number.
- Pre-flight section: 6 checkboxes matching the runbook + a paste block for /healthz output.
- Step results table: 11 rows, columns Pass / Fail / Neon evidence.
- Paste block for the Full Conversation Audit Query output.
- Outcome section: checkbox for "All 11 steps passed — INTEG-01 COMPLETE" and a failure table (Step / Failure / Root cause / Fix applied).

**File 2 — apps/app/src/routes/admin.mjs**

Read the file first — it may already exist. If it does, add the new route. If not, create it.

Export a default Express Router. Register one route:

`GET /integ-01-status` — read-only, no auth check inside the handler (requireOperatorAuth is applied in server.mjs at mount time).

Handler logic:
1. Read optional `?student_id=UUID` from query params.
2. Query `conversations` for the most recent row matching student_id (or globally most recent if omitted).
3. If no conversation found, return `{ status: 'no_conversation', steps: {} }`.
4. Run two parallel queries: `inbound_messages` (all rows for student_id or startup_id in conversation), `drafts` (all rows for conversation_id).
5. Derive boolean step states from the data:
   - `step3_spectrum_inbound`: inbound_messages count with provider='spectrum' >= 1
   - `step4_student_draft`: drafts with recipient_type='student' >= 1
   - `step6_student_sms_sent`: drafts with recipient_type='student' AND status='sent' >= 1
   - `step7_startup_draft`: drafts with recipient_type='startup' >= 1
   - `step8_startup_email_sent`: drafts with recipient_type='startup' AND status='sent' >= 1
   - `step9_email_inbound`: inbound_messages count with provider='email' >= 1
   - `step10_student_draft_2`: drafts with recipient_type='student' >= 2
   - `step11_student_sms_sent_2`: drafts with recipient_type='student' AND status='sent' >= 2
6. Return JSON: `{ conversation_id, student_id, startup_id, all_passed: boolean, steps, inbound_rows: N, draft_rows: N }`.

Pool is available as `req.pool` (attached by existing middleware in server.mjs).

In server.mjs, register:
```js
import adminRouter from './routes/admin.mjs';
// after existing middleware, beside /ops routes:
app.use('/admin', requireOperatorAuth, adminRouter);
```
  </action>
  <verify>
    ls -la apps/app/test/integ-01-VERIFICATION.md apps/app/src/routes/admin.mjs
    node --input-type=module --eval "import('./apps/app/src/routes/admin.mjs').then(()=>console.log('syntax ok')).catch(e=>console.error(e.message))"
  </verify>
  <done>VERIFICATION.md skeleton exists with 11 step rows and paste-the-result fields. admin.mjs exports a Router with GET /integ-01-status — read-only, no mutations, derives step states from Neon rows. Registered in server.mjs under requireOperatorAuth.</done>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <what-built>
    Pre-flight checklist + 11-step runbook with SQL snippets (integ-01-runbook.md), fillable VERIFICATION.md skeleton, and GET /admin/integ-01-status endpoint behind requireOperatorAuth.
  </what-built>
  <how-to-verify>
    1. Complete all 6 pre-flight items before running Step 1.
    2. Execute Steps 1–11 in order. After each step, run the SQL snippet and confirm the pass condition.
    3. Fill in the step table in integ-01-VERIFICATION.md (pass/fail + Neon evidence) as you go.
    4. After Step 3+, check https://app.internjobs.ai/admin/integ-01-status for live step state (should show each step flipping to true as you progress).
    5. After Step 11, run the Full Conversation Audit Query and paste the output into VERIFICATION.md.
    6. Confirm no draft row has status != 'sent' without a draft_feedback rejection row.
  </how-to-verify>
  <resume-signal>
    Type "INTEG-01 PASS" when all 11 steps are green and VERIFICATION.md is filled.
    Type "INTEG-01 FAIL: step N — [description]" if any step failed, including what the SQL returned vs. the pass condition.
  </resume-signal>
</task>

</tasks>

<verification>
Phase 06 is complete when:
- All 11 INTEG-01 steps pass in production.
- No draft has status != 'sent' without a corresponding draft_feedback rejection (confirmed by the audit query).
- integ-01-VERIFICATION.md is complete: all 11 checkboxes ticked, audit query output pasted.
- GET /admin/integ-01-status returns { all_passed: true } for the test conversation.
</verification>

<success_criteria>
1. 11-step smoke test executes end-to-end: student Spectrum inbound → agent draft → operator approve → startup email → startup reply (CF Email Routing → Worker → Mastra ingest) → agent draft → operator approve → student Spectrum SMS.
2. Each step has a Neon row to prove it; no manual DB intervention required.
3. Every sent outbound message has a corresponding drafts.status='sent' transition.
4. integ-01-VERIFICATION.md is filed with Neon snapshots — closes the v1.0/v1.1 audit gap.
</success_criteria>

<output>
After completion, create `.planning/milestones/v1.2-two-sided-agent-mvp/phase-06-two-sided-integration/06-01-SUMMARY.md` with:
- Frontmatter: phase, plan, completed_at, outcome (pass/fail), steps_passed (N/11)
- Table of 11 steps with actual Neon row counts
- Link to apps/app/test/integ-01-VERIFICATION.md
- Any failures encountered and how they were resolved
</output>
