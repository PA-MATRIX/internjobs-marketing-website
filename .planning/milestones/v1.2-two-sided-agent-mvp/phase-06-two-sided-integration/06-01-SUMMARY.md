---
phase: "06-two-sided-integration"
plan: "01"
subsystem: "integration-test"
tags: ["smoke-test", "runbook", "admin-endpoint", "read-only", "spectrum"]
completed_at: "2026-05-16"
outcome: "code-complete"
steps_passed: "0/11"
steps_note: "Code artifacts shipped. Steps 1–11 are USER actions in production — not yet executed."
requires:
  - "01-preflight-sms-abstraction"
  - "02-startup-identity-roles"
  - "03-startup-email-channel"
  - "04-mastra-agent-core"
  - "05-operator-approval-gate"
provides:
  - "INTEG-01 operator runbook (6 pre-flight + 11 smoke steps + audit query)"
  - "INTEG-01 VERIFICATION.md fillable skeleton"
  - "GET /admin/integ-01-status read-only endpoint behind requireOperatorAuth"
affects:
  - "v1.2 milestone acceptance (VERIFICATION.md must be completed in prod)"
tech-stack:
  added: []
  patterns:
    - "Route handler extracted to apps/app/src/routes/admin.mjs (first file in that new directory)"
    - "Parallel pool.query Promise.all pattern for step-state derivation"
key-files:
  created:
    - "apps/app/test/integ-01-runbook.md"
    - "apps/app/test/integ-01-VERIFICATION.md"
    - "apps/app/src/routes/admin.mjs"
  modified:
    - "apps/app/src/server.mjs"
decisions:
  - "Spectrum/Photon is the ONLY active SMS path — all 11 runbook steps use Spectrum; Telnyx held for v1.3"
  - "Admin handler extracted to routes/admin.mjs module rather than inlined in the 1000-line server.mjs"
  - "Admin route uses store.pool directly (passed via closure from server.mjs), not a separate pool import"
  - "status endpoint uses ?student_id=UUID filter; falls back to most-recent conversation globally"
metrics:
  duration: "~20 minutes"
---

# Phase 06 Plan 01: Two-Sided Integration Smoke Test — Summary

**One-liner:** INTEG-01 runbook + VERIFICATION skeleton + read-only `/admin/integ-01-status` endpoint shipped; user runs 11 prod steps to close v1.2.

---

## What Shipped

Three code artifacts for Phase 06:

### 1. `apps/app/test/integ-01-runbook.md`

Operator runbook with:
- **6 pre-flight items** — DNS proxy gray-cloud, Clerk key rotation, all 5
  migrations applied (`0001`–`0004`), `/healthz` fully green, operator
  `publicMetadata.userType='operator'` set, test assets (phone + inbox)
  in hand.
- **11-step smoke test** — each step has `[USER ACTION]` where human input
  is required, an observable outcome, a parameterized Neon SQL snippet, and
  a single-sentence pass condition. SMS path is Spectrum/Photon throughout
  (Telnyx is out of scope for v1.2).
- **Section C** — full conversation audit query joining `drafts →
  conversations → students` in chronological order, plus a zero-row orphan
  check query (any draft with `provider_message_id IS NOT NULL` but
  `status != 'sent'` is a bug).

### 2. `apps/app/test/integ-01-VERIFICATION.md`

Fillable skeleton with:
- Header fields (date, operator, test student Clerk user ID, test startup email,
  Spectrum number).
- 6 pre-flight checkboxes + `/healthz` paste block.
- 11-row step table (Step | User action summary | Expected outcome | Result
  Pass/Fail | Neon evidence paste).
- Audit query paste block + zero-row orphan check paste block.
- Admin endpoint JSON paste block.
- Final outcome checkbox + failure table for any step that failed.

### 3. `apps/app/src/routes/admin.mjs` + server.mjs mount

`handleInteg01Status` is a read-only handler:
- Accepts `?student_id=UUID`; falls back to globally most-recent conversation.
- Runs two parallel `pool.query` calls (inbound_messages + drafts).
- Derives 8 boolean step states; `all_passed` is `&&` of all 8.
- No mutations. Safe on empty DB — returns all `false`.
- Mounted in `server.mjs` at `GET /admin/integ-01-status` behind
  `requireOperatorAuth`.

---

## Step-State Logic

| Key | Derivation |
|---|---|
| `step3_spectrum_inbound` | `inbound_messages` where `provider='spectrum'` >= 1 |
| `step4_student_draft` | `drafts` where `recipient_type='student'` >= 1 |
| `step6_student_sms_sent` | student drafts where `status='sent'` >= 1 |
| `step7_startup_draft` | `drafts` where `recipient_type='startup'` >= 1 |
| `step8_startup_email_sent` | startup drafts where `status='sent'` >= 1 |
| `step9_email_inbound` | `inbound_messages` where `provider='email'` >= 1 |
| `step10_student_draft_2` | student drafts >= 2 |
| `step11_student_sms_sent_2` | student sent drafts >= 2 |

---

## Sample Admin Endpoint Response (empty DB)

```json
{
  "conversation_id": null,
  "student_id": null,
  "startup_id": null,
  "all_passed": false,
  "steps": {
    "step3_spectrum_inbound": false,
    "step4_student_draft": false,
    "step6_student_sms_sent": false,
    "step7_startup_draft": false,
    "step8_startup_email_sent": false,
    "step9_email_inbound": false,
    "step10_student_draft_2": false,
    "step11_student_sms_sent_2": false
  },
  "inbound_rows": 0,
  "draft_rows": 0,
  "status": "no_conversation"
}
```

---

## Verification Results

| Task | Status | Notes |
|---|---|---|
| `node -c apps/app/src/routes/admin.mjs` | PASS | Syntax OK |
| `node -c apps/app/src/server.mjs` | PASS | Syntax OK |
| `npm run build:app` | PASS | `internjobs-app: waitlist smoke checks passed` |
| `import('./src/routes/admin.mjs')` | PASS | Exports `handleInteg01Status` |
| 11-step prod smoke test | NOT RUN | User action required in production |

---

## Commits

| Hash | Message |
|---|---|
| `9f84368` | `docs(06-01): add INTEG-01 operator runbook for two-sided smoke test` |
| `e1c21e9` | `feat(06-01): add INTEG-01 VERIFICATION skeleton and GET /admin/integ-01-status` |

---

## Deviations from Plan

**1. No Express Router — inline Node http dispatch used instead**

- Plan task 2 described an Express `Router` and `app.use('/admin', ...)`.
  The existing server.mjs uses Node's `createServer` with a manual
  if/else dispatch — there is no Express in this codebase.
- Fix applied: handler extracted to `routes/admin.mjs` as a plain exported
  async function; mounted inline in server.mjs via the same `if
  (req.method === 'GET' && url.pathname === ...)` pattern used by all other routes.
  Auth guard (`requireOperatorAuth`) applied before calling the handler.

**2. No `req.pool` middleware pattern**

- Plan mentioned `req.pool`. Node's `createServer` has no middleware
  `req.pool` convention. The pool lives on `store.pool` (the PostgresStore instance).
- Fix applied: `handleInteg01Status` receives `pool` explicitly via the
  `{ url, pool }` options argument passed by server.mjs at call site.

**3. Migration version names corrected**

- Plan's pre-flight step referenced `0003_v1_2_two_sided_agent`. The actual
  migration is `0004_v1_2_mastra_agent_core`. Runbook uses the correct
  actual version names from `db/migrations/`.

---

## Next Phase Readiness

Phase 06 is code-complete. The VERIFICATION.md artifact will be closed
when the operator (user) runs the 11 steps against production and fills
in the results. Once `all_passed: true` is confirmed on
`GET /admin/integ-01-status`, v1.2 milestone is DONE.

See USER ACTION items below.
