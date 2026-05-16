# INTEG-01 — Two-Sided Smoke Test Runbook

**Milestone:** v1.2 — Two-Sided Agent MVP  
**Version:** 1  
**Scope:** Full end-to-end validation of Phases 01–05 in production.  
**SMS path:** Spectrum/Photon (the only active SMS path in v1.2; Telnyx is held for v1.3).  
**Prerequisite:** All 6 pre-flight items below must be green before executing Step 1.

---

## Section A — Pre-Flight Checklist

Complete every item before starting the 11-step smoke test. Each item
**[USER ACTION]** requires a verification step; record the result in
`integ-01-VERIFICATION.md`.

---

### Pre-Flight 1 — DNS proxy resolved (SEC-01)

**[USER ACTION]:** Log in to Cloudflare dashboard → DNS → verify that
`accounts.internjobs.ai` and `clerk.internjobs.ai` are both set to
**DNS only** (gray cloud icon, not orange proxied cloud). Then open an
incognito browser window and complete a full LinkedIn → Clerk sign-in flow
at `https://app.internjobs.ai`.

Expected: you land on `/pairing` (or `/pairing/confirmed` if already paired).
If you get a Cloudflare MITM error or infinite redirect, the DNS proxy is still on.

---

### Pre-Flight 2 — Clerk secret key rotated (SEC-ROTATE-01)

**[USER ACTION]:** Confirm that the `CLERK_SECRET_KEY` in Infisical
`prod` / `/internjobs-ai` is the fresh key issued after 2026-05-15. Then
verify it is live on Fly:

```bash
flyctl secrets list -a internjobs-ai-student-app | grep CLERK_SECRET_KEY
```

If the key is stale, rotate it now:

1. Clerk Dashboard → API Keys → Rotate secret key → copy new value.
2. In Infisical prod `/internjobs-ai`, update `CLERK_SECRET_KEY`.
3. Re-import to Fly:

```bash
flyctl secrets import -a internjobs-ai-student-app
```

---

### Pre-Flight 3 — All prod migrations applied

**[USER ACTION]:** SSH into the Fly app and query `schema_migrations`:

```bash
flyctl ssh console -a internjobs-ai-student-app -C \
  "node -e \"const {Pool}=require('pg');const p=new Pool({connectionString:process.env.DATABASE_URL});p.query('select version from schema_migrations order by applied_at').then(r=>{console.log(r.rows.map(x=>x.version).join('\\n'));p.end()})\""
```

Required rows (in any order):

```
0001_waitlist_foundation
0002_waitlist_threads_and_enrichment
0003_v1_2_startup_identity
0003b_email_inbound
0004_v1_2_mastra_agent_core
```

If any row is missing, run the missing migration file via
`apps/app/scripts/migrate.mjs` (or the Fly SSH equivalent) before
proceeding.

---

### Pre-Flight 4 — `/healthz` fully green

**[USER ACTION]:** From your workstation:

```bash
curl -s https://app.internjobs.ai/healthz | jq .
```

Expected output shape (all booleans `true`):

```json
{
  "ok": true,
  "service": "internjobs-app",
  "configured": {
    "clerk": true,
    "database": true,
    "photonNumber": true,
    "photonWebhook": true,
    "spectrumListener": true,
    "emailWorkerSecret": true,
    "cloudflareEmailReady": true
  },
  "mastraReady": true,
  "pgvectorReady": true,
  "openaiKeyPresent": true
}
```

Any `false` value indicates a missing secret. Fix before continuing:
`PHOTON_FROM_NUMBER`, `PHOTON_WEBHOOK_SECRET`, `EMAIL_WORKER_SECRET`,
`CLOUDFLARE_EMAIL_ACCOUNT_ID`, `CLOUDFLARE_EMAIL_API_TOKEN`,
`OPENAI_API_KEY` — all must be present in Fly secrets.

---

### Pre-Flight 5 — Operator account configured

**[USER ACTION]:**

1. Open Clerk Dashboard → Users → find your operator user.
2. Confirm `publicMetadata` contains `"userType": "operator"`. If not, edit
   the metadata directly in the Clerk Dashboard JSON editor and save.
3. Sign in to `https://app.internjobs.ai/ops/drafts` (non-incognito, operator
   session). Expected: HTTP 200, draft queue page loads. HTTP 403 means
   `userType` is not `"operator"` or the Clerk session is stale.

---

### Pre-Flight 6 — Test assets ready

**[USER ACTION]:** Have the following in hand before starting Step 1:

- **Real phone** with the test student's SIM inserted — you will text the
  Spectrum number from this phone.
- **Test startup email inbox** (Gmail or Outlook) that you control — you will
  receive a startup introduction email and reply from this address.
- **Spectrum number** from `/healthz` `photonNumber` config (also visible in
  the Spectrum dashboard). Write it down — you will text it in Steps 2, 3, 11.
- **Operator session** open in a second browser tab at
  `https://app.internjobs.ai/ops/drafts`.

---

## Section B — 11-Step Smoke Test

Execute steps in order. After each step, run the SQL snippet in Neon
(or via Fly SSH psql) and confirm the pass condition before proceeding
to the next step. Record results in `integ-01-VERIFICATION.md`.

> **SQL convention:** Replace `:cuid` with the Clerk user ID of the test
> student account (format: `user_XXXXXXXXXXXXXXXXXXXXXXXXXX`). Run all
> SQL against the production Neon database.

---

### Step 1 — Student signs in via LinkedIn → Spectrum pairing screen

**[USER ACTION]:** Open an incognito browser window and navigate to
`https://app.internjobs.ai`. Sign in with LinkedIn as the test student
account. After Clerk completes the OAuth callback you should land on
`/pairing` and see the Spectrum pairing screen with a 6-character pairing
code and the Spectrum phone number displayed.

Observable: Browser shows the pairing screen at `/pairing`. The page
displays a pairing code (8 hex characters) and instructions to text it
to the Spectrum number.

SQL verify:

```sql
SELECT id, status, channel_confirmed_at
  FROM students
 WHERE clerk_user_id = :'cuid';
```

Pass condition: Row exists, `channel_confirmed_at IS NULL` (pairing not
yet confirmed).

---

### Step 2 — Student texts pairing code → `channel_confirmed_at` set

**[USER ACTION]:** From the test phone, send the exact 8-character pairing
code shown on the `/pairing` screen to the Spectrum number as an SMS message.
Wait up to 30 seconds for the page to reflect confirmation (or refresh `/pairing`).

Observable: `/pairing` page changes to the "Messages Connected" confirmation
view. The test phone receives a welcome SMS from the Spectrum number.

SQL verify:

```sql
-- Student record shows channel_confirmed_at:
SELECT status, channel_confirmed_at, channel_address
  FROM students
 WHERE clerk_user_id = :'cuid';

-- Pairing code row shows confirmed_at:
SELECT code, status, confirmed_at
  FROM channel_pairing_codes
 WHERE student_id = (SELECT id FROM students WHERE clerk_user_id = :'cuid')
 ORDER BY created_at DESC
 LIMIT 1;
```

Pass condition: `students.channel_confirmed_at IS NOT NULL` and
`channel_pairing_codes.confirmed_at IS NOT NULL`.

---

### Step 3 — Student sends follow-up text → `inbound_messages` row created

**[USER ACTION]:** From the test phone, text the Spectrum number with the
exact message: `Hey what's next?`

Wait up to 10 seconds for the webhook to process (no UI confirmation for
this step).

Observable: No user-visible change. The message is silently recorded.

SQL verify:

```sql
SELECT id, provider, channel_type, body, processed_at, created_at
  FROM inbound_messages
 WHERE student_id = (SELECT id FROM students WHERE clerk_user_id = :'cuid')
 ORDER BY created_at DESC
 LIMIT 5;
```

Pass condition: At least one row with `provider = 'spectrum'` exists,
`body` contains `what's next` (case-insensitive), `processed_at` may be
null or set (the workflow sets it after consuming the message).

---

### Step 4 — Mastra workflow fires → student-side draft created

No user action required. Wait up to 60 seconds for the Mastra workflow
to fire and write a draft row.

If no draft appears after 60 seconds, check `audit_events` for a
`no_roles_to_match` event (meaning no startup has an active role yet):

```sql
SELECT event_type, metadata, created_at
  FROM audit_events
 ORDER BY created_at DESC
 LIMIT 10;
```

If `no_roles_to_match` appears, ensure at least one startup has a role
with `status = 'active'` before retrying.

SQL verify:

```sql
SELECT d.id, d.recipient_type, d.channel, d.status,
       left(d.body, 120) AS body_preview, d.created_at
  FROM drafts d
  JOIN conversations c ON d.conversation_id = c.id
 WHERE c.student_id = (SELECT id FROM students WHERE clerk_user_id = :'cuid')
   AND d.recipient_type = 'student'
 ORDER BY d.created_at DESC
 LIMIT 5;
```

Pass condition: At least one row with `recipient_type = 'student'` and
`status = 'pending_review'` exists.

---

### Step 5 — Operator sees student-side draft in queue

**[USER ACTION]:** Navigate to (or refresh) `https://app.internjobs.ai/ops/drafts`
in the operator browser tab.

Observable: The draft created in Step 4 is visible in the queue. It shows
the student name, startup name, role title, and a body preview. Click the
row to open the draft detail page.

Pass condition: Draft detail page loads showing full body, student context,
and role description. No SQL verification needed for this step — the visual
confirmation is sufficient.

---

### Step 6 — Operator approves student-side draft → SMS sent to test phone

**[USER ACTION]:** On the draft detail page opened in Step 5, click
**Approve**. Do NOT edit the body unless it is clearly incorrect.

Wait up to 10 seconds for the send to complete and the page to redirect
back to the draft queue with a green "Draft approved and sent" banner.

Observable: The test phone receives an SMS from the Spectrum number with
the agent-drafted introduction message (e.g., "Hey Alex, we found a
startup that might be a great fit — [Startup] is looking for a [Role]
intern. Want to hear more? Reply YES.").

SQL verify:

```sql
SELECT d.id, d.recipient_type, d.status, d.sent_at, d.provider_message_id,
       left(d.body, 120) AS body_preview
  FROM drafts d
  JOIN conversations c ON d.conversation_id = c.id
 WHERE c.student_id = (SELECT id FROM students WHERE clerk_user_id = :'cuid')
   AND d.recipient_type = 'student'
 ORDER BY d.created_at DESC
 LIMIT 3;
```

Pass condition: The approved draft has `status = 'sent'`, `sent_at IS NOT
NULL`, and `provider_message_id IS NOT NULL`.

---

### Step 7 — Agent creates startup-side draft

No user action required. Wait up to 60 seconds. The Mastra workflow
should also have written a startup-side draft when it processed Step 3's
inbound message.

SQL verify:

```sql
SELECT d.id, d.recipient_type, d.channel, d.status,
       left(d.body, 120) AS body_preview, d.created_at
  FROM drafts d
  JOIN conversations c ON d.conversation_id = c.id
 WHERE c.student_id = (SELECT id FROM students WHERE clerk_user_id = :'cuid')
   AND d.recipient_type = 'startup'
 ORDER BY d.created_at DESC
 LIMIT 3;
```

Pass condition: At least one row with `recipient_type = 'startup'`,
`channel = 'email'`, and `status = 'pending_review'` exists.

---

### Step 8 — Operator approves startup-side draft → email sent to test inbox

**[USER ACTION]:** Return to `https://app.internjobs.ai/ops/drafts` and
locate the startup-side draft (filter by "Startup" if needed). Click the
row, review the draft body, then click **Approve**.

Wait up to 15 seconds for the Cloudflare Email Service send call to complete.

Observable: The test startup email inbox (the Gmail/Outlook address from
Pre-Flight 6) receives an email **From:** `noreply@internjobs.ai` with a
**Reply-To** address in the format `conv_<conversation_id>@internjobs.ai`.
The email body introduces the student to the startup.

SQL verify:

```sql
SELECT d.id, d.recipient_type, d.status, d.sent_at, d.provider_message_id,
       left(d.body, 120) AS body_preview
  FROM drafts d
  JOIN conversations c ON d.conversation_id = c.id
 WHERE c.student_id = (SELECT id FROM students WHERE clerk_user_id = :'cuid')
   AND d.recipient_type = 'startup'
 ORDER BY d.created_at DESC
 LIMIT 3;
```

Pass condition: Startup-side draft has `status = 'sent'`, `sent_at IS NOT
NULL`, `provider_message_id IS NOT NULL`.

---

### Step 9 — Startup replies to email → `inbound_messages` row created

**[USER ACTION]:** In the test startup email inbox, find the email from
Step 8. Reply **to the Reply-To address** (the `conv_XXX@internjobs.ai`
address, NOT to `noreply@`). Use exactly this reply body:

```
Thanks — this sounds interesting. What's the student's availability?
```

Wait up to 30 seconds for the Cloudflare Email Routing → CF Worker →
`POST /webhooks/email` chain to deliver the inbound payload.

Observable: No immediate user-visible feedback. The reply is ingested
silently. Check the SQL below to confirm receipt.

SQL verify:

```sql
SELECT im.id, im.provider, im.channel_type, im.body, im.created_at,
       im.startup_id
  FROM inbound_messages im
  JOIN conversations c ON im.startup_id = c.startup_id
 WHERE c.student_id = (SELECT id FROM students WHERE clerk_user_id = :'cuid')
 ORDER BY im.created_at DESC
 LIMIT 5;
```

Pass condition: At least one row with `provider = 'email'` exists whose
`body` contains the startup's reply text.

---

### Step 10 — Mastra workflow fires → second student-side draft created

No user action required. Wait up to 60 seconds for the Mastra workflow
to fire on the startup's inbound email reply and create a second
student-side draft.

SQL verify:

```sql
SELECT d.id, d.recipient_type, d.status, d.created_at,
       left(d.body, 120) AS body_preview
  FROM drafts d
  JOIN conversations c ON d.conversation_id = c.id
 WHERE c.student_id = (SELECT id FROM students WHERE clerk_user_id = :'cuid')
   AND d.recipient_type = 'student'
 ORDER BY d.created_at ASC;
```

Pass condition: At least **2** rows with `recipient_type = 'student'`
exist; the newest has `status = 'pending_review'`.

---

### Step 11 — Operator approves second student draft → test phone receives second SMS

**[USER ACTION]:** Return to `https://app.internjobs.ai/ops/drafts` and
locate the second student-side draft (the one created in Step 10). Click
the row and click **Approve**.

Wait up to 10 seconds for the SMS to be sent.

Observable: The test phone receives a second SMS from the Spectrum number
containing the follow-up message based on the startup's availability
question (e.g., "Great news — [Startup] is interested! They'd like to
know your availability. When are you free for a quick call?").

SQL verify:

```sql
SELECT d.id, d.recipient_type, d.status, d.sent_at, d.provider_message_id,
       left(d.body, 120) AS body_preview
  FROM drafts d
  JOIN conversations c ON d.conversation_id = c.id
 WHERE c.student_id = (SELECT id FROM students WHERE clerk_user_id = :'cuid')
   AND d.recipient_type = 'student'
 ORDER BY d.created_at ASC;
```

Pass condition: At least **2** rows with `recipient_type = 'student'` and
`status = 'sent'` exist. Both have non-null `provider_message_id`.

---

## Section C — Full Conversation Audit Query

Run this query after Step 11 to produce the final transcript. Paste the
output into `integ-01-VERIFICATION.md`.

```sql
SELECT d.recipient_type,
       d.channel,
       d.status,
       d.sent_at,
       left(d.body, 80) AS body_preview,
       d.created_at
  FROM drafts d
  JOIN conversations c ON d.conversation_id = c.id
 WHERE c.student_id = (SELECT id FROM students WHERE clerk_user_id = :'cuid')
 ORDER BY d.created_at ASC;
```

**Expected:** 3 or more rows, all with `status = 'sent'`.

**Audit pass criterion:** No outbound message exists (no row with
`provider_message_id IS NOT NULL`) without a corresponding
`drafts.status = 'sent'`. Every draft that was sent has a non-null
`sent_at` and `provider_message_id`. Use this supplementary check to
confirm no orphan sends:

```sql
-- Must return 0 rows. Any row here is a send-without-status-transition bug.
SELECT id, recipient_type, channel, status, provider_message_id, sent_at
  FROM drafts d
  JOIN conversations c ON d.conversation_id = c.id
 WHERE c.student_id = (SELECT id FROM students WHERE clerk_user_id = :'cuid')
   AND provider_message_id IS NOT NULL
   AND status != 'sent';
```

Pass criterion: Zero rows returned.

---

## Live Step-State Endpoint

While executing Steps 3–11, you can poll the admin endpoint to see which
steps have flipped to green based on live Neon state:

```bash
curl -s "https://app.internjobs.ai/admin/integ-01-status?student_id=<UUID>" \
  -H "Cookie: <your-operator-session-cookie>" | jq .
```

Replace `<UUID>` with the `id` column from the `students` table (not the
Clerk user ID). Obtain it with:

```sql
SELECT id FROM students WHERE clerk_user_id = :'cuid';
```

Expected shape after all 11 steps pass:

```json
{
  "conversation_id": "...",
  "student_id": "...",
  "startup_id": "...",
  "all_passed": true,
  "steps": {
    "step3_spectrum_inbound": true,
    "step4_student_draft": true,
    "step6_student_sms_sent": true,
    "step7_startup_draft": true,
    "step8_startup_email_sent": true,
    "step9_email_inbound": true,
    "step10_student_draft_2": true,
    "step11_student_sms_sent_2": true
  },
  "inbound_rows": 2,
  "draft_rows": 3
}
```
