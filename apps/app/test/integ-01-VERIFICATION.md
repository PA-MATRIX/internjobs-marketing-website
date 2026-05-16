# INTEG-01 — Verification Record

> Fill in every field as you execute the runbook. This document is the
> audit artifact that closes the v1.2 acceptance gate.

---

## Header

| Field | Value |
|---|---|
| Date executed | _YYYY-MM-DD_ |
| Operator | _your name_ |
| Test student Clerk user ID | `user_` |
| Test startup email address | |
| Spectrum number (from /healthz) | |

---

## Pre-Flight Results

Paste `/healthz` JSON output below the table.

| # | Item | Result |
|---|---|---|
| PF-1 | DNS proxy gray-cloud on `accounts.internjobs.ai` + `clerk.internjobs.ai`; LinkedIn → Clerk sign-in succeeds from incognito | [ ] Pass / [ ] Fail |
| PF-2 | `CLERK_SECRET_KEY` is the rotated key; `flyctl secrets list` confirms it is live | [ ] Pass / [ ] Fail |
| PF-3 | All 5 migration versions present in `schema_migrations` | [ ] Pass / [ ] Fail |
| PF-4 | `/healthz` returns all `true`; see paste below | [ ] Pass / [ ] Fail |
| PF-5 | Operator `publicMetadata.userType = "operator"`; `/ops/drafts` loads 200 | [ ] Pass / [ ] Fail |
| PF-6 | Test phone, test startup inbox, and Spectrum number all in hand | [ ] Pass / [ ] Fail |

**`/healthz` output:**

```json
<paste output of: curl -s https://app.internjobs.ai/healthz | jq .>
```

---

## Step Results

| Step | User action summary | Expected outcome | Result | Neon evidence |
|---|---|---|---|---|
| 1 | LinkedIn sign-in → `/pairing` screen | Row in `students`, `channel_confirmed_at IS NULL` | [ ] Pass / [ ] Fail | `<paste SQL row>` |
| 2 | Text pairing code to Spectrum number | `students.channel_confirmed_at` set; welcome SMS received | [ ] Pass / [ ] Fail | `<paste SQL rows>` |
| 3 | Text `Hey what's next?` to Spectrum number | `inbound_messages` row, `provider='spectrum'` | [ ] Pass / [ ] Fail | `<paste SQL row>` |
| 4 | Wait ≤60 s for Mastra workflow | `drafts` row, `recipient_type='student'`, `status='pending_review'` | [ ] Pass / [ ] Fail | `<paste SQL row>` |
| 5 | Operator views `/ops/drafts` | Student draft visible in queue | [ ] Pass / [ ] Fail | _(visual — no SQL)_ |
| 6 | Operator approves student draft | Test phone receives SMS; `drafts.status='sent'`, `provider_message_id` non-null | [ ] Pass / [ ] Fail | `<paste SQL row>` |
| 7 | Wait ≤60 s for Mastra workflow | `drafts` row, `recipient_type='startup'`, `channel='email'`, `status='pending_review'` | [ ] Pass / [ ] Fail | `<paste SQL row>` |
| 8 | Operator approves startup draft | Test inbox receives email from `noreply@internjobs.ai`; `drafts.status='sent'` | [ ] Pass / [ ] Fail | `<paste SQL row>` |
| 9 | Startup replies to email Reply-To address | `inbound_messages` row, `provider='email'` | [ ] Pass / [ ] Fail | `<paste SQL row>` |
| 10 | Wait ≤60 s for Mastra workflow | Second `drafts` row, `recipient_type='student'`, `status='pending_review'` | [ ] Pass / [ ] Fail | `<paste SQL row>` |
| 11 | Operator approves second student draft | Test phone receives second SMS; 2× `status='sent'` rows | [ ] Pass / [ ] Fail | `<paste SQL rows>` |

---

## Full Conversation Audit Query Output

```
<paste output of the Section C audit query from the runbook>
```

**Zero-row orphan check output** (must be empty):

```
<paste output of the orphan-send check query>
```

---

## Admin Endpoint Output

```json
<paste output of: curl -s "https://app.internjobs.ai/admin/integ-01-status?student_id=<UUID>" | jq .>
```

Expected: `"all_passed": true` and all 8 step booleans `true`.

---

## Outcome

| | |
|---|---|
| **All 11 steps passed — INTEG-01 COMPLETE** | [ ] Yes / [ ] No |

### Failure Table (fill only if any step failed)

| Step | Failure description | SQL returned | Expected | Root cause | Fix applied |
|---|---|---|---|---|---|
| | | | | | |

---

_This record was filed by the operator above as the acceptance artifact for
InternJobs.ai v1.2 — Two-Sided Agent MVP milestone._
