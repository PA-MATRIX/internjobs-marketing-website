# Phase 29: Startup Telnyx SMS + Voice AI + Voice-Based Onboarding — Research

**Researched:** 2026-05-25
**Domain:** Telnyx SMS, Telnyx Voice AI Agent, Cloudflare Workers cron, R2 audit logging
**Confidence:** MEDIUM (Telnyx portal/API config details LOW — confirmed features exist but full
schema requires portal access; SMS webhook/outbound shapes HIGH from official docs)

---

## Executive Summary

Phase 29 is shippable in ≤3 plans on a "code-ready, ops-deferred" basis. Telnyx toll-free
SMS is a real, distinct pathway from A2P 10DLC — no 4-week carrier queue, though it now
requires a BRN (EIN for US corps) submitted in the Telnyx portal for verification (1-2 week
processing, not blocking the pilot). Telnyx Voice AI natively supports MCP server
integrations as of 2025 — the agent can call `mcp.internjobs.ai/mcp` directly with a Bearer
token; no custom voice code required in our Worker. SMS inbound webhook shape is fully
documented (Ed25519 signed, `data.payload.from.phone_number` + `data.payload.text`).
Outbound SMS is a single `POST /v2/messages` call. CF Worker cron (`[triggers].crons`) is
standard. The Voice AI MCP auth model uses a global per-agent token stored as a Telnyx
integration secret; per-call token injection is possible via the dynamic-variables webhook
but requires a pre-call lookup roundtrip. CHANNELS.md already has the adapter sketches —
execution is code completion, not architecture invention.

**Primary recommendation:** Ship 29-01 (SMS adapter + identity resolution) as pure code,
29-02 (Voice AI Agent + R2 audit log) as code + portal config stubs, 29-03 (weekly cron
+ reply parser + E2E) as code. All three gate-block on DEFERRED-OPS entries for the actual
Telnyx number, Voice AI agent creation, and toll-free verification submission.

---

## Hard Problem 1 — Telnyx Number Provisioning + SMS Inbound/Outbound

### Toll-free vs. 10DLC
**Confirmed:** Toll-free (800/888/877/866/855/844/833) and 10DLC are separate carrier
pathways. Toll-free skips The Campaign Registry entirely.

**Caveat (2026):** As of February 17, 2026 Telnyx requires three new fields on all
toll-free verification submissions:
- `businessRegistrationNumber` (e.g., EIN "12-3456789" for US)
- `businessRegistrationType` (e.g., `EIN`)
- `businessRegistrationCountry` (e.g., `US`)

Processing time is 1-2 weeks, but the number can send/receive SMS immediately after
purchase — verification controls deliverability thresholds, not activation. For a pilot
sending low volume, this is acceptable. **Confidence: HIGH**

### SMS inbound webhook payload
Full verified payload structure:

```json
{
  "data": {
    "event_type": "message.received",
    "id": "<event-uuid>",
    "occurred_at": "2024-01-15T20:16:07.588+00:00",
    "payload": {
      "direction": "inbound",
      "from": { "phone_number": "+13125550001", "carrier": "T-Mobile USA", "line_type": "long_code" },
      "to": [{ "phone_number": "+18005551234", "status": "webhook_delivered" }],
      "text": "show me frontend candidates",
      "id": "<message-uuid>",
      "type": "SMS",
      "parts": 1,
      "received_at": "2024-01-15T20:16:07.503+00:00",
      "media": [],
      "messaging_profile_id": "<profile-uuid>"
    },
    "record_type": "event"
  },
  "meta": { "attempt": 1 }
}
```

Access pattern in Worker: `payload.data.payload.from.phone_number` and
`payload.data.payload.text`. **Confidence: HIGH**

### Signature verification
- Header: `telnyx-signature-ed25519` (Base64-encoded Ed25519 signature)
- Header: `telnyx-timestamp` (Unix timestamp)
- Signed string: `{timestamp}|{raw_json_body}`
- Verify with Telnyx public key (retrieved from portal; stored as `TELNYX_WEBHOOK_PUBLIC_KEY` env var)
- **Confidence: HIGH**

### Outbound SMS REST call
```typescript
POST https://api.telnyx.com/v2/messages
Authorization: Bearer ${TELNYX_API_KEY}
Content-Type: application/json

{ "from": "+18005551234", "to": "+13125550001", "text": "...", "messaging_profile_id": "..." }
```
Rate limit response: HTTP 429 with `retry-after` header. No documented hard cap for
toll-free at pilot volume. SMS max is 1600 chars per segment; multi-part auto-segmented.
MMS supported by adding `media_urls` array. **Confidence: HIGH**

### Pricing (US toll-free, 2026)
- Inbound: ~$0.0055/message part + carrier fee
- Outbound: ~$0.0055/message part + carrier fee
- Number rental: not published on pricing page; likely $2–5/mo (confirm at purchase).
- **Confidence: MEDIUM** (inbound/outbound from official pricing page; number rental LOW)

### Identity resolution for unknown numbers
**Recommendation:** Option (b) — trigger voice-intake onboarding prompt, do not reject silently.

Logic:
1. Resolve `(telnyx-sms, from_phone)` via `startup_channel_links` — if found, dispatch normally.
2. If not found: check if a `register_startup` conversation is in-flight for this phone
   (a `pending_voice_onboarding` keyed on phone in KV or a DB row). If yes, route to
   onboarding continuation.
3. If neither: reply "Hi! To connect your startup, call [number] and we'll get you set up
   in 30 seconds. Or reply INVITE to get an onboarding link." Do not call `register_startup`
   from SMS alone — voice intake is the designed path.
4. "STOP" unconditionally opts out and must be handled before any other logic.

Rationale: silent reject leaks no info but loses interested founders; invite-code gating
adds friction at pilot scale where all founders are known to Ridhi anyway.

---

## Hard Problem 2 — Telnyx Voice AI Agent + MCP Integration

### MCP integration: confirmed supported
Telnyx AI Agents (voice + other channels) support native MCP server integration. Announced
in 2025 release notes; actively promoted with Epic/EHR healthcare case study in 2026.

**Configuration path:** Mission Control Portal → AI Assistants → [assistant] → MCP Servers tab
→ Add MCP Server → provide URL + auth. If URL must be kept private, store it as a Telnyx
"integration secret" (Telnyx-side env var substitution). **Confidence: HIGH (feature exists);
MEDIUM (exact portal fields — requires account to confirm schema)**

**Auth model:** A global per-agent Bearer token, stored as an integration secret in Telnyx.
For our voice intake onboarding, this is a single `TELNYX_VOICE_AGENT_TOKEN` — a dedicated
MCP install token minted for the Voice AI agent with a `telnyx-voice` channel link to
`startup_id=NULL` (or a sentinel "onboarding" startup). After `register_startup` runs and
a new startup row exists, the agent's follow-up calls use the newly issued per-startup token.

Per-call token injection (i.e., lookup caller's phone → find their MCP token → inject into
the MCP call) is possible via the `dynamic_variables_webhook_url` pre-call hook: Telnyx
POSTs caller info before the call starts, our Worker responds within 1s with
`{"dynamic_variables": {"mcp_token": "<their-token>"}}`, and the agent uses
`{{mcp_token}}` in its Bearer header. This is the correct path for the "returning founder"
case. **Confidence: MEDIUM**

### Fallback if MCP is unavailable per-account
Telnyx also supports "webhook tools" — the AI agent calls a defined HTTP endpoint with
structured args. The tool definition uses a JSON Schema for parameters; the AI decides when
to invoke it based on the conversation. Async webhook tools (2025) return a fast 200 ACK
then push result back. This is equivalent to MCP tool calls but without the MCP discovery
layer. If MCP integration requires a higher Telnyx plan tier, webhook tools are the
drop-in fallback — our endpoint contract is the same (`POST /webhooks/telnyx/voice-tool` →
same `handleExecute` dispatcher).

### Voice AI configuration (portal-driven, not code)
- **No-code assistant builder** at `portal.telnyx.com/#/ai/assistants`
- Key fields: system prompt (with `{{variable}}` substitution), greeting text, model
  selection, TTS/STT providers, built-in tools (Hangup, Webhook, Transfer)
- **Conversation script format:** linear prompt scaffolding. Pattern from Telnyx's own docs:
  explicitly script each turn ("Ask the founder for their company name. Wait for the
  answer. Then ask for the founder's name..."). Do NOT rely on implicit LLM sequencing —
  Telnyx recommends explicit gating per-question to prevent tool calls firing too early.
- **Model recommendation:** `anthropic/claude-haiku-4-5` (native, no separate API key
  needed). Alternatively `moonshotai/Kimi-K2.5` for lowest latency. **Confidence: HIGH**
- **Dynamic variables available in prompts:**
  - `{{telnyx_end_user_target}}` — caller's phone number (critical for registration)
  - `{{telnyx_current_time}}`, `{{call_control_id}}`
  - Custom vars injectable via `dynamic_variables_webhook_url` pre-call hook

### Voice AI latency
- Sub-200ms round-trip (Telnyx's co-located GPU + telephony infra, private IP backbone)
- <1s end-to-end from caller finishes speaking to first TTS audio byte
- 99.999% uptime SLA on voice infrastructure
- Tolerable for natural conversation. **Confidence: HIGH** (from official product page)

### Call recording + transcript
- Transcript playback via Telnyx Mission Control Portal dashboard (confirmed)
- Post-call webhook delivery via "AI Assistant post-call insights webhook" (confirmed
  released, webhook fires on call end with call metadata)
- Recording/transcript push to R2: Telnyx sends to our Worker endpoint via the post-call
  webhook; our Worker then `env.R2.put(key, body)`. No direct Telnyx → R2 upload.
  Pipeline: Telnyx POST call-end event → Worker `/webhooks/telnyx/voice-postprocess` →
  parse recording URL + transcript → fetch recording bytes → `env.R2.put(...)`.
- **Exact post-call webhook payload schema: LOW confidence** — release note confirmed
  it exists but full field list requires portal testing. Plan for: `call_control_id`,
  `duration`, `transcript` (text), possibly `recording_url`.

---

## Hard Problem 3 — Weekly Text Touchbase Cron

### CF Workers cron syntax
In `wrangler.jsonc` (not wrangler.toml — this repo uses .jsonc):
```json
"triggers": {
  "crons": ["0 14 * * 1"]
}
```
`0 14 * * 1` = Monday 14:00 UTC = Monday 9:00 AM ET (EST; 10:00 AM EDT in summer —
consider `0 13 * * 1` for EDT, or accept a 1-hour seasonal drift for v1.4).

Handler export: `scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext)`.
Test locally: `wrangler dev --test-scheduled` → `GET /__scheduled`. **Confidence: HIGH**

### Opt-in storage
Extend `startup_channel_links` with an `opt_in_flags` JSONB column (migration 0014):
```sql
ALTER TABLE startup_channel_links ADD COLUMN opt_in_flags jsonb DEFAULT '{}' NOT NULL;
-- opt_in_flags = {"weekly_touchbase": true}
```
Alternatively add a `weekly_touchbase_opt_in boolean DEFAULT false` to `startup_members`
or a dedicated `startup_touchbase_preferences` table. The JSONB approach on
`startup_channel_links` is simplest and keeps opt-in tied to the channel. **Recommendation:
add `opt_in_flags JSONB` to `startup_channel_links`; index on
`(channel_type, (opt_in_flags->>'weekly_touchbase'))` for cron query.**

Opt-in trigger: after the voice onboarding call ends, send SMS "Reply YES to get weekly
candidate updates." Reply "yes"/"y" → update `opt_in_flags.weekly_touchbase = true`.
Also need `last_touchbase_at TIMESTAMPTZ` column on `startup_channel_links` (or a
separate `startup_touchbase_log` table).

### State for "reply 1/2/3"
Store a per-phone-per-touchbase cursor in a short-lived KV entry:
```
key: `touchbase:cursor:${phone}` (TTL: 48h)
value: JSON array of candidate UUIDs in display order
```
Reply "1" → fetch `cursor[0]` candidate UUID → call `handleSearch` / `handleGetCandidate`.
This avoids DB state for a transient interaction. If KV is not available, a `touchbase_cursor`
JSON column on a `touchbase_sends` table works but adds DB writes per send.

### Reply parsing
Two-layer approach:
1. **Strict regex first:** `/^\s*([1-9])\s*$/` → `show_candidate(position-1)`. Respond
   immediately without LLM call.
2. **"STOP" / "UNSUBSCRIBE":** case-insensitive exact match before any other logic.
   Set `opt_in_flags.weekly_touchbase = false`, reply "You've been unsubscribed. Reply
   START to re-subscribe." Log to `startup_touchbase_opt_out_log`.
3. **Fall-through:** everything else → intent classifier (`classifyIntent`) → normal
   dispatch. If classifier returns nothing → "Didn't catch that — reply 1, 2, or 3 to
   see a candidate."

SMS compliance: STOP handling is mandatory for US toll-free. Must be processed before
any other logic branch. **Confidence: HIGH**

---

## Hard Problem 4 — Voice Intake Onboarding Flow

### Conversation script format
Telnyx Voice AI uses an explicit linear system prompt — not a state machine, not a separate
SDK. Best practice from Telnyx's own documentation:

```
You are the InternJobs startup hotline assistant. This call may be recorded for service
improvement.

Greet the caller warmly. Then ask each of the following questions one at a time, waiting
for their answer before proceeding:

1. What is the name of your company?
2. What is your name?
3. What is your work email address?
4. What kind of intern role are you looking to hire for?

After collecting all four answers, call the register_startup tool with:
  - company_name: [answer to Q1]
  - founder_name: [answer to Q2]
  - work_email: [answer to Q3]
  - role_description: [answer to Q4]
  - phone_number: {{telnyx_end_user_target}}

After the tool call succeeds, say: "Great! I've registered [company_name] on InterJobs.
You'll receive an SMS with your setup link shortly. Is there anything else I can help you with?"

If the tool call fails, say: "I wasn't able to complete the registration. I'll have our
team follow up with you. Thanks for calling!"

Keep answers brief. Do not improvise outside this flow.
```

**Opt-in disclosure:** The phrase "This call may be recorded for service improvement" is
in the greeting text field (separate from the system prompt in Telnyx's UI), so it's
spoken as the very first sentence before any interaction. **Confidence: MEDIUM** (pattern
confirmed by Telnyx docs guidance; exact greeting field placement requires portal testing)

### Partial/abandoned calls
Telnyx retains call state server-side. If caller hangs up mid-flow, the post-call webhook
fires with whatever `call_control_id` partial transcript exists. Worker receives it,
parses partial fields, and stores to R2 as a `pending_voice_onboarding` record. No
automatic retry on the Telnyx side — our Worker can optionally send an SMS to the calling
number: "Looks like we got cut off. Call back to finish your InterJobs registration."
This requires `telnyx_end_user_target` in the post-call payload (confirmed available).

### Confirmation: SMS vs email
Send to BOTH:
1. SMS to calling phone number: "Your InterJobs account is ready! Install link: [URL]"
   (use same `sendSms` utility from Phase 28 SMS adapter)
2. Email to work email collected during call: same welcome email as Phase 28.5 admin
   onboarding path — `welcome@startups.internjobs.ai` → invite link + MCP snippet

This matches Phase 28-04's `createStartup()` behavior exactly. The Voice AI tool call
`register_startup` hits the same `POST /admin/startups/new` endpoint (with a dedicated
`voice-intake` auth path or by reusing `STARTUP_MCP_ADMIN_SECRET`).

### Recording → R2 pipeline
```
call ends
  → Telnyx fires post-call webhook → Worker /webhooks/telnyx/voice-postprocess
  → parse: { call_control_id, transcript, recording_url, caller_phone }
  → fetch(recording_url)  [Telnyx presigned URL, expires ~24h]
  → env.R2.put(`recordings/${startup_id}/${call_control_id}.mp3`, audioBytes)
  → env.R2.put(`transcripts/${startup_id}/${call_control_id}.json`, { transcript, metadata })
  → insert startup_action_log row: { action: 'voice_call', channel: 'telnyx-voice', ... }
```
R2 bucket: `internjobs-voice-audit` (new; declare in wrangler.jsonc). **Confidence: MEDIUM**
(pipeline shape confirmed; exact recording_url field name in post-call payload is LOW —
needs portal verification)

---

## Recommended Plan Breakdown (3 Plans)

### Plan 29-01: SMS Adapter + Identity Resolution (STARTUP-TELNYX-01..06)
**Ships (code-only, ops-deferred):**
- `apps/startup/workers/routes/telnyx.ts` — inbound SMS webhook handler (from CHANNELS.md
  sketch, fleshed out with signature verification, STOP handling, unknown-number response)
- `apps/startup/workers/lib/telnyx.ts` — `sendSms()` utility (already exists per wrangler.jsonc
  `TELNYX_API_KEY` / `TELNYX_FROM_NUMBER` — confirm file exists or create)
- Ed25519 signature verification middleware for Telnyx webhook
- Intent classifier integration (reuse Phase 28's `classifyIntent`, add `show_candidate` +
  `register_startup` to the action enum)
- Migration 0014: `opt_in_flags JSONB` + `last_touchbase_at` columns on `startup_channel_links`
- DEFERRED-OPS: Telnyx signup, toll-free number purchase, API key generation, messaging
  profile creation, webhook URL config in Telnyx portal, toll-free verification submission
  (BRN fields)

**Env vars added:**
- `TELNYX_WEBHOOK_PUBLIC_KEY` (Ed25519 public key for signature verification)

**Dependency:** Phase 28 core handlers. No new DB tables needed beyond 0014 columns.

### Plan 29-02: Voice AI Agent + R2 Audit Log (STARTUP-VOICE-01..04)
**Ships (code + portal config stubs):**
- `apps/startup/workers/routes/telnyx-voice.ts` — two handlers:
  - `POST /webhooks/telnyx/voice-init` — dynamic variables pre-call hook; resolves
    caller phone → returns `{dynamic_variables: {mcp_token: "..."}}` within 1s
  - `POST /webhooks/telnyx/voice-postprocess` — post-call insights webhook; fetches
    recording, stores to R2, inserts audit log row
- R2 bucket `internjobs-voice-audit` declared in wrangler.jsonc
- `apps/startup/workers/lib/voice-onboarding.ts` — `handleRegisterStartupFromVoice()`
  thin wrapper that calls `createStartup()` + `sendSms()` confirmation + sends welcome email
- `docs/VOICE_AGENT_CONFIG.md` — copy-paste Telnyx portal config for:
  the system prompt (with opt-in disclosure + 4-question script), model selection, MCP server
  URL/auth, dynamic_variables_webhook_url, post-call webhook URL, phone number assignment
- DEFERRED-OPS: actual Voice AI agent creation in Telnyx portal, phone number assignment
  to agent, R2 bucket creation (`wrangler r2 bucket create internjobs-voice-audit`)

**Env vars added:**
- `TELNYX_VOICE_AGENT_TOKEN` (Bearer token for the Voice AI agent's MCP calls)
- `R2` binding: `internjobs-voice-audit`

### Plan 29-03: Weekly Cron + Reply Parser + E2E (STARTUP-TOUCHBASE-01..02 + STARTUP-MULTICHAN-01..02)
**Ships:**
- `apps/startup/workers/routes/scheduled.ts` — `scheduled()` export; queries opted-in
  startups with `last_touchbase_at < now - 7d`; fetches fresh candidate counts per startup;
  sends touchbase SMS via `sendSms()`; writes KV cursor; updates `last_touchbase_at`
- `triggers.crons: ["0 14 * * 1"]` in wrangler.jsonc
- Reply parsing expansion in `telnyx.ts`: numeric regex fast-path → cursor lookup →
  `handleGetCandidate`; STOP handling already in 29-01
- KV namespace `TOUCHBASE_CURSORS` bound in wrangler.jsonc (TTL-managed entries)
- `CHANNELS.md` update: Telnyx SMS and Voice AI adapter sections marked as live (not planned)
- Playwright E2E test: simulated inbound SMS → intent classifier → mock MCP execute → reply

**Env vars added:**
- KV binding: `TOUCHBASE_CURSORS`

**Dependency order:** 29-01 → 29-02 → 29-03 (each builds on prior; 29-02 can start in
parallel after 29-01 DB migration is applied)

---

## Operational Checkpoints (DEFERRED-OPS — user performs post-code-ship)

1. **Telnyx account signup** — portal.telnyx.com; add payment method
2. **Toll-free number purchase** — search 800/888 prefix, buy one; note E.164 value for
   `TELNYX_FROM_NUMBER` / `STARTUP_TELNYX_NUMBER` Infisical secrets
3. **Toll-free verification submission** — submit BRN (EIN), `businessRegistrationType=EIN`,
   `businessRegistrationCountry=US`; 1-2 week processing
4. **Messaging profile creation** — create profile in Telnyx portal; assign toll-free
   number; set inbound webhook URL to `https://mcp.internjobs.ai/webhooks/telnyx/sms`
5. **API key generation** — portal → API Keys → generate; store as `TELNYX_API_KEY` in
   Infisical `/internjobs-ai`
6. **Webhook public key** — portal → Messaging → Webhooks → copy Ed25519 public key;
   store as `TELNYX_WEBHOOK_PUBLIC_KEY`
7. **Voice AI agent creation** — portal → AI Assistants → New; paste config from
   `docs/VOICE_AGENT_CONFIG.md`; set MCP server URL to `https://mcp.internjobs.ai/mcp`
   with `TELNYX_VOICE_AGENT_TOKEN` as integration secret; set dynamic vars webhook URL;
   set post-call webhook URL; assign toll-free number to agent
8. **R2 bucket creation** — `wrangler r2 bucket create internjobs-voice-audit`
9. **Secrets to Infisical** — `TELNYX_API_KEY`, `TELNYX_FROM_NUMBER`, `TELNYX_WEBHOOK_PUBLIC_KEY`,
   `TELNYX_VOICE_AGENT_TOKEN`, `STARTUP_TELNYX_NUMBER` under `/internjobs-ai env=prod`
10. **DNS for voice webhook** (optional) — `mcp.internjobs.ai` already exists (Phase 28
    custom domain); no new DNS entry needed unless a dedicated `voice.internjobs.ai` is
    wanted. Recommend reusing `mcp.internjobs.ai` sub-paths for simplicity.

---

## Open Risks / Unknowns

1. **Toll-free BRN verification timeline.** The number works for SMS immediately but
   carrier deliverability may be throttled until verification clears (~1-2 weeks). Pilot
   can proceed at low volume; do not blast 1000+ messages before verification.
   **Mitigation:** submit BRN at number purchase time, not after launch.

2. **Telnyx MCP integration plan tier.** The MCP server tab may only be available on
   higher-tier Telnyx accounts (not confirmed). Webhook tools are the functional fallback
   (same contract, slightly more boilerplate in tool definition). Plan 29-02 should code
   both paths behind a feature flag (`TELNYX_USE_MCP_INTEGRATION=true/false`).

3. **Post-call webhook payload schema.** Recording URL field name not confirmed from
   official docs — only that "transcript playback" and a "post-call insights webhook" exist.
   `recording_url` is the assumed field name; could be `recording`, `media_url`, etc.
   **Mitigation:** log the full raw payload on first call; adjust field path in a hotfix.

4. **Dynamic variables pre-call hook latency.** Must respond within 1s to inject the
   per-caller MCP token. The hook queries `startup_channel_links` via the Fly proxy —
   typical cold path is 200-400ms. Acceptable, but the Fly proxy must be warm. Add a
   keepalive cron or accept ~600ms on cold start.

5. **`show_candidate` and `register_startup` not in Phase 28 action enum.** Phase 28
   ships `post_role, reply_to_candidate, update_role, archive_role, mark_candidate`.
   Phase 29-01 must add `show_candidate` and `register_startup` to the enum and their
   handlers. Coordinate with Phase 28 core to avoid enum fragmentation.

6. **Monday 9am ET seasonal drift.** `0 14 * * 1` = EST. In EDT (March-November), this
   fires at 10am ET. Either accept the drift for v1.4, or use `0 13 * * 1` for EDT and
   note it in comments. Per-startup timezone scheduling is v1.5.

---

## Sources

### HIGH confidence
- [Telnyx inbound webhook payload](https://developers.telnyx.com/docs/messaging/messages/receiving-webhooks) — full JSON schema confirmed
- [Telnyx toll-free verification](https://developers.telnyx.com/docs/messaging/toll-free-verification) — BRN fields, timeline
- [Telnyx send message API](https://developers.telnyx.com/docs/messaging/messages/send-message?lang=node) — outbound REST shape
- [Telnyx dynamic variables](https://developers.telnyx.com/docs/inference/ai-assistants/dynamic-variables) — pre-call webhook format, variable list
- [Telnyx Voice AI latency](https://telnyx.com/products/voice-ai-agents) — <200ms RTT, 99.999% uptime
- [Telnyx no-code Voice AI quickstart](https://developers.telnyx.com/docs/inference/ai-assistants/no-code-voice-assistant) — portal config steps
- [Cloudflare Workers cron triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/) — wrangler syntax confirmed
- [CHANNELS.md](apps/startup/CHANNELS.md) — existing adapter architecture + code sketches

### MEDIUM confidence
- [Telnyx MCP for AI Agents release note](https://telnyx.com/release-notes/mcp-servers-ai-agents) — MCP integration confirmed; portal config steps described at high level
- [Telnyx MCP for Voice AI release note](https://telnyx.com/release-notes/model-context-protocol-ai-voice) — 404 on direct fetch; feature confirmed via search results
- [Telnyx SMS pricing](https://telnyx.com/pricing/messaging) — $0.0055/part toll-free inbound+outbound confirmed
- [Telnyx Voice AI platform guide](https://telnyx.com/resources/voice-AI-agent-platform) — 404 on direct fetch; latency/config details from WebSearch cross-reference
- [Async webhook tools](https://telnyx.com/release-notes/async-webhook-tools-ai-assistants) — confirmed exists; full schema not retrieved

### LOW confidence (flag for portal validation)
- Post-call webhook exact payload field names (recording URL field name)
- Voice AI agent MCP integration available on all plan tiers vs. premium-only
- Toll-free number monthly rental cost
