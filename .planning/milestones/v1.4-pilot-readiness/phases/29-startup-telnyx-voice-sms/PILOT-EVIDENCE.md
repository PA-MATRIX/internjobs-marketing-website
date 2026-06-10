# Phase 29 Pilot Evidence — STARTUP-MULTICHAN-02

**Status:** PENDING (run DEFER-29-03-E to complete)
**Requirement satisfied:** STARTUP-MULTICHAN-02 — first pilot startup end-to-end via Telnyx (voice intake + SMS touchbase + reply parser + opt-out).

This file is the human-execution checklist for the FIRST end-to-end pilot
verification run after all Phase 29 ops backlog items close. It cannot run
autonomously — it requires:

- A purchased toll-free Telnyx number (`DEFER-29-01-B`).
- BRN verification submitted (`DEFER-29-01-C`).
- Messaging profile + Voice AI Agent configured (`DEFER-29-01-D`, `DEFER-29-02-A`).
- Worker secrets bound + redeployed (`DEFER-29-01-I`, `DEFER-29-02-E`, `DEFER-29-03-C`).
- A real pilot founder willing to play the role of caller / texter.

Walk through each section in order; paste evidence into the code blocks as
the founder progresses. Final sign-off is the table at the bottom.

---

## Prerequisites checklist

- [ ] DEFER-29-01-A..K — all complete (Telnyx number, BRN, API key, webhook config, migration 0014 applied)
- [ ] DEFER-29-02-A..F — all complete (Voice AI agent, R2 bucket, TELNYX_VOICE_AGENT_TOKEN, redeploy, smoke test)
- [ ] DEFER-29-03-A..D — all complete (KV namespace TOUCHBASE_CURSORS, migration verified, redeploy, cron smoke test)

If any of these are not green, STOP and close them first — running the pilot
on a partial stack will produce false-negative evidence.

---

## 1. Voice Intake Onboarding (STARTUP-VOICE-01..02)

Founder action: Call `[STARTUP_TELNYX_NUMBER]` from a personal phone (the
number the founder texts/calls from will be recorded against the founder).

- [ ] AI greeted with the opt-in/recording disclosure from `docs/VOICE_AGENT_CONFIG.md`.
- [ ] AI asked the 4 intake questions in order (company name, founder name, work email, what hiring for).
- [ ] After Q4: `register_startup` tool call fired (visible in Telnyx portal AI assistant logs OR — webhook-tool fallback — `wrangler tail` shows `POST /webhooks/telnyx/voice-tool`).
- [ ] Row appeared in `startups` + `startup_members` tables:
  ```sql
  SELECT s.name, s.created_at, m.email, m.role
    FROM startups s
    JOIN startup_members m ON m.startup_id = s.id
   ORDER BY s.created_at DESC LIMIT 1;
  ```
  Expected: 1 row, founder email matches what was said on call, created_at within last minute.
- [ ] `startup_channel_links` row created with `channel_type='telnyx-voice'`:
  ```sql
  SELECT channel_type, channel_external_id, status, opt_in_flags
    FROM startup_channel_links
   WHERE startup_id = '<startup_id from above>';
  ```
  Expected: at least one row with `channel_type='telnyx-voice'`, `opt_in_flags->>'weekly_touchbase'='true'`.
- [ ] SMS received on the calling phone with MCP install snippet within 60s of call ending.
- [ ] Transcript + recording appeared in R2 bucket `internjobs-voice-audit`:
  ```bash
  wrangler r2 object list internjobs-voice-audit
  ```
  Expected: at least one object under `transcripts/<startup_id>/` and one under `recordings/<startup_id>/`.

**Evidence (paste DB output + SMS screenshot + R2 listing here):**
```
[paste here]
```

---

## 2. SMS Opt-In Confirmation (STARTUP-TELNYX-04, STARTUP-TOUCHBASE-01)

After the voice intake completes, the founder will receive the install-snippet
SMS. To test the opt-in re-confirmation flow:

- [ ] Founder replies `yes` to the same number → received `"you're in!"` confirmation SMS.
- [ ] `startup_channel_links` row for `channel_type='telnyx-sms'` (the SMS channel-link auto-inserted by `register_startup`) has `opt_in_flags->>'weekly_touchbase'='true'`:
  ```sql
  SELECT channel_type, opt_in_flags, status
    FROM startup_channel_links
   WHERE startup_id = '<startup_id>'
     AND channel_type = 'telnyx-sms';
  ```
- [ ] `wrangler tail` line shows `event:"touchbase_opt_in"` in the audit log.

**Evidence (paste SMS screenshot + DB output here):**
```
[paste here]
```

---

## 3. Weekly Touchbase Cron (STARTUP-TOUCHBASE-01..02)

To validate the weekly cron without waiting for Monday 14:00 UTC:

- [ ] Trigger cron manually via:
  ```bash
  cd apps/startup
  wrangler dev --test-scheduled
  # in a second terminal:
  curl 'http://localhost:8787/__scheduled?cron=0+14+*+*+1'
  ```
- [ ] Worker logs show `event:"startup_touchbase_cron_sent"` for the pilot startup.
- [ ] Pilot phone receives a touchbase SMS in the format:
  ```
  hey [founder_name] — N new intern candidate(s) this week for [startup_name].
  reply 1/2/3 to see a candidate, or 'stop' to opt out.
  1. [candidate_name] ([role_title])
  2. [candidate_name] ([role_title])
  3. [candidate_name] ([role_title])
  ```
  (or the `"no new candidates this week"` variant if the pilot startup has zero inbound candidates yet — that branch is also valid).
- [ ] KV cursor entry exists:
  ```bash
  wrangler kv key get --binding TOUCHBASE_CURSORS "touchbase:cursor:[+phone]"
  ```
  Expected: JSON array of `{thread_id, candidate_name, role_title}` matching the SMS order.
- [ ] `last_touchbase_at` column advanced on `startup_channel_links` row:
  ```sql
  SELECT channel_external_id, last_touchbase_at
    FROM startup_channel_links
   WHERE startup_id = '<startup_id>'
     AND channel_type = 'telnyx-sms';
  ```

**Evidence (paste SMS screenshot + DB output + KV cursor JSON here):**
```
[paste here]
```

---

## 4. Numeric Reply (STARTUP-TOUCHBASE-02)

Only meaningful if Section 3 produced a candidates-present touchbase SMS
(skip if the "no new candidates" branch fired).

- [ ] Pilot replies `1` (or `2` / `3`) → receives a candidate snapshot SMS with `#1: <candidate_name>` + role + summary.
- [ ] `wrangler tail` shows `event:"touchbase_show_candidate"` audit row with the resolved `thread_id` (visible by params_hash matching the cursor).

**Evidence:**
```
[paste here]
```

---

## 5. Natural-Language SMS Request (STARTUP-TELNYX-03..04)

To exercise the LLM fallback path:

- [ ] Pilot texts: `"show me the top 3 candidates for the frontend role"`.
- [ ] Receives a numbered list of candidates (up to 3) via SMS.
- [ ] `startup_action_log` row exists:
  ```sql
  SELECT channel, action, status, created_at
    FROM startup_action_log
   WHERE startup_id = '<startup_id>'
     AND channel = 'telnyx-sms'
   ORDER BY created_at DESC LIMIT 3;
  ```
  Expected: row with `action='search:candidates'`.

**Evidence:**
```
[paste here]
```

---

## 6. Opt-Out / STOP (STARTUP-TELNYX-05)

- [ ] Pilot texts `STOP` → receives the TCPA-compliant `"you're opted out. text 'start' anytime to re-subscribe."` reply.
- [ ] `startup_channel_links.status = 'opted_out'`:
  ```sql
  SELECT channel_type, status, opt_in_flags
    FROM startup_channel_links
   WHERE startup_id = '<startup_id>'
     AND channel_type = 'telnyx-sms';
  ```
  Expected: `status='opted_out'`, `opt_in_flags='{}'`.
- [ ] Subsequent manual cron trigger (Section 3 commands) skips this startup — Worker logs show `processed=0` (or no `event:"startup_touchbase_cron_sent"` line for this startup_id).

**Evidence:**
```
[paste here]
```

---

## 7. Re-Subscribe via START (STARTUP-TELNYX-06)

- [ ] Pilot texts `START` → receives confirmation that they're re-opted-in.
- [ ] `startup_channel_links.status` flips back to `'active'` (the START path re-upserts via `POST /v1/channel-links`).

**Evidence:**
```
[paste here]
```

---

## Sign-Off

| Criterion | Status | Evidence | Notes |
|-----------|--------|----------|-------|
| STARTUP-VOICE-01..02 (voice intake) | PENDING | — | Section 1 |
| STARTUP-TELNYX-03 (NL SMS request) | PENDING | — | Section 5 |
| STARTUP-TELNYX-04 (opt-in "yes") | PENDING | — | Section 2 |
| STARTUP-TELNYX-05 (STOP/TCPA) | PENDING | — | Section 6 |
| STARTUP-TELNYX-06 (START re-sub) | PENDING | — | Section 7 |
| STARTUP-TOUCHBASE-01 (weekly cron) | PENDING | — | Section 3 |
| STARTUP-TOUCHBASE-02 (numeric reply) | PENDING | — | Section 4 |
| STARTUP-MULTICHAN-02 (e2e pilot) | PENDING | — | All sections green |

Completed by: [fill in name]
Date: [fill in YYYY-MM-DD]
Pilot founder: [fill in name + company]

---

## Hotfix budget

If any section fails:
- 1–2 small fixes (typo in greeting, wrong webhook URL, missing secret): hotfix on `rrr/v1.4/team-cms`, redeploy, rerun affected section.
- Structural issue (wrong table schema, missing endpoint, broken sig verify): convert to a Phase 29.5 fix-up plan and re-run pilot after merge.

Goal: PILOT-EVIDENCE.md ships in the v1.4 release notes with the sign-off table fully PASS.
