# Telnyx Voice AI Agent Configuration

> **Audience:** Ridhi (or whoever holds the Telnyx portal login).
> **When to use:** During DEFER-29-02-A — creating the Voice AI Agent in the
> Telnyx portal for the startup onboarding hotline.
> **Source of truth:** This document. Each step matches a field in the
> Telnyx portal (portal.telnyx.com → AI → Assistants → New Assistant).

This is the **copy-paste config** for the Voice AI Agent that fronts the
startup-side toll-free number. The agent greets callers, runs the 4-question
intake script, then calls the `register_startup` tool to mint a new startup
record + send the founder an SMS install snippet.

Code paths the agent calls into:
- `register_startup` tool → `apps/startup/workers/lib/voice-onboarding.ts`
  (loopback to `POST /admin/startups/new`)
- Post-call hook → `apps/startup/workers/routes/voice.ts`
  `POST /webhooks/telnyx/voice-postprocess` (stores transcript + recording
  to R2 bucket `internjobs-voice-audit`)
- Pre-call hook → `apps/startup/workers/routes/voice.ts`
  `POST /webhooks/telnyx/voice-init` (returns `{}` for pilot v1.4; the
  global `TELNYX_VOICE_AGENT_TOKEN` is the per-agent MCP Bearer)

---

## Step 1 — System Prompt

Paste the following into the **System Prompt** field in the portal:

```
You are the InternJobs startup hotline assistant. This call may be recorded
for service improvement — by continuing, the caller consents to recording.

Greet the caller warmly. Then ask each of the following questions one at a
time, waiting for their answer before proceeding:

1. What is the name of your company?
2. What is your name?
3. What is your work email address?
4. What kind of intern role are you looking to hire for?

After collecting all four answers, call the register_startup tool with:
  - company: [answer to Q1]
  - founder_name: [answer to Q2]
  - founder_email: [answer to Q3]
  - what_hiring_for: [answer to Q4]
  - channel_external_id: {{telnyx_end_user_target}}
  - channel_type: telnyx-voice

After the tool call succeeds, say: "Great — I've set up [company] on
InternJobs. You'll receive an SMS with your setup link shortly. Is there
anything else I can help you with?"

If the tool call returns already_registered=true, say: "Looks like you're
already in our system. I'll text you a fresh setup link right now."

If the tool call fails, say: "I wasn't able to complete the registration.
Our team will follow up with you shortly. Thanks for calling InternJobs!"

If the caller gives a personal email (gmail/yahoo/outlook/icloud/etc.),
politely ask for their work email instead: "We need your work email so we
can verify your company — could you share that instead of your personal
address?"

Keep responses brief. Do not improvise outside this flow.
```

---

## Step 2 — Greeting Text

Paste the following into the **Greeting** field in the portal:

```
Hey, thanks for calling InternJobs! This call may be recorded for service
improvement.
```

The opt-in disclosure ("this call may be recorded for service improvement")
is load-bearing for compliance with two-party recording-consent jurisdictions
(California, Florida, Illinois, Massachusetts, Pennsylvania, Washington, etc.)
— do NOT remove it from the greeting.

---

## Step 3 — Model Selection

| Model | Notes |
| --- | --- |
| **anthropic/claude-haiku-4-5** | **Recommended.** Fast, cheap, follows
  multi-turn instructions well. |
| moonshotai/Kimi-K2.5 | Alternative — lowest latency. Use if Anthropic Haiku
  is unavailable on your Telnyx plan tier. |
| openai/gpt-5-nano | Fallback only — has been observed to skip questions in
  multi-turn intake scripts. Avoid for pilot. |

---

## Step 4 — MCP Server Configuration (preferred path)

If the **MCP Servers** tab is visible in the Telnyx portal (depends on plan
tier — Telnyx Enterprise tier and above as of 2026-05):

| Field | Value |
| --- | --- |
| URL | `https://mcp.internjobs.ai/mcp` |
| Auth type | `Bearer` |
| Token | Paste `TELNYX_VOICE_AGENT_TOKEN` from Infisical `/internjobs-ai`
  env=`prod` (minted per DEFER-29-02-C) |

After saving, also set the Worker secret:

```bash
cd apps/startup && wrangler secret put TELNYX_USE_MCP_INTEGRATION
# value: true
```

---

## Step 4b — Webhook Tool Fallback (if MCP is plan-gated)

If the **MCP Servers** tab is **NOT** available on your Telnyx plan tier,
fall back to the webhook-tool protocol. Set the Worker secret:

```bash
cd apps/startup && wrangler secret put TELNYX_USE_MCP_INTEGRATION
# value: false  (or leave unbound — the voice-tool handler defaults to this path)
```

Then add **two webhook tools** in the portal:

### Webhook Tool 1 — register_startup

| Field | Value |
| --- | --- |
| Name | `register_startup` |
| URL | `https://mcp.internjobs.ai/webhooks/telnyx/voice-tool` |
| HTTP method | `POST` |
| Parameters | `company` (string), `founder_name` (string),
  `founder_email` (string), `what_hiring_for` (string),
  `channel_external_id` (string, value: `{{telnyx_end_user_target}}`),
  `channel_type` (string, value: `telnyx-voice`) |

### Webhook Tool 2 — show_candidate

| Field | Value |
| --- | --- |
| Name | `show_candidate` |
| URL | `https://mcp.internjobs.ai/webhooks/telnyx/voice-tool` |
| HTTP method | `POST` |
| Parameters | `position` (number, 1–9), `thread_id` (string, optional) |

The handler at `routes/voice.ts` voice-tool dispatches based on `tool_name`
in the request body, so both tools share the same URL.

---

## Step 5 — Dynamic Variables Webhook URL

Paste into the **Dynamic Variables Webhook URL** field:

```
https://mcp.internjobs.ai/webhooks/telnyx/voice-init
```

For pilot v1.4 this endpoint returns `{}` (no dynamic variables injected) —
the global Voice Agent Bearer from Step 4 / 4b is sufficient. v1.5 will mint
per-caller scoped tokens here.

---

## Step 6 — Post-Call Insights Webhook URL

Paste into the **Post-Call Insights Webhook URL** field:

```
https://mcp.internjobs.ai/webhooks/telnyx/voice-postprocess
```

This endpoint downloads the call recording + transcript and persists both to
the R2 bucket `internjobs-voice-audit` (created via DEFER-29-02-B). It also
detects abandoned/partial calls (transcript shorter than 50 characters) and
sends an SMS recovery prompt to the caller asking them to dial back.

**Field-name note:** The exact post-call payload schema is LOW confidence
in `29-RESEARCH.md`. The handler is coded defensively (optional chaining
across multiple shapes) and logs the FULL raw payload on every call. After
the first 5 successful calls in production, prune the raw-payload log and
tighten the field extraction.

---

## Step 7 — Phone Number Assignment

Assign the toll-free number stored as `STARTUP_TELNYX_NUMBER` in Infisical
`/internjobs-ai` env=`prod` (purchased in DEFER-29-01-B) to this Voice AI
agent. The same number is also assigned to the SMS messaging profile
(DEFER-29-01-D) — Telnyx routes voice calls to the AI agent and SMS messages
to the messaging profile webhook independently.

---

## Step 8 — Smoke Test (DEFER-29-02-F)

After saving the agent + assigning the phone number, call the toll-free
from a personal phone. Verify in this order:

1. **Greeting plays:** The AI greets with the opt-in disclosure from Step 2.
2. **Intake script:** AI asks the 4 questions sequentially.
3. **Registration:** After Q4, the AI calls `register_startup`.
4. **SMS arrives:** Within ~10 seconds of hangup, the calling phone receives
   the MCP install snippet SMS (delivered by `handleRegisterStartupFromVoice`
   → `sendSms`).
5. **Audit objects:** Run
   `wrangler r2 object list internjobs-voice-audit` and confirm:
   - `transcripts/<startup_id>/<call_control_id>.json`
   - `recordings/<startup_id>/<call_control_id>.mp3`
6. **Worker logs:** `wrangler tail` shows two POST requests:
   - `POST /webhooks/telnyx/voice-init` (before greeting)
   - `POST /webhooks/telnyx/voice-postprocess` (after hangup)

If the post-call payload field names don't match `extractTranscript` /
`extractRecordingUrl` in `routes/voice.ts` (signaled by empty transcripts in
R2 + missing mp3 files), inspect the raw-payload log from
`wrangler tail | grep startup_voice_postprocess_raw` and adjust the
optional-chaining fallback chain — the handler logs the full body explicitly
for this hotfix scenario.

---

## Reference: secret-binding checklist

Before going live, confirm:

- [ ] `TELNYX_API_KEY` (DEFER-29-01-E) — for outbound SMS confirmation
- [ ] `TELNYX_FROM_NUMBER` (DEFER-29-01-G) — toll-free E.164
- [ ] `TELNYX_MESSAGING_PROFILE_ID` (DEFER-29-01-H) — recommended for
  US deliverability
- [ ] `TELNYX_VOICE_AGENT_TOKEN` (DEFER-29-02-C) — Voice AI agent's MCP Bearer
- [ ] `TELNYX_USE_MCP_INTEGRATION` (DEFER-29-02-D) — `true` or `false`
- [ ] `STARTUP_MCP_ADMIN_SECRET` (already set in Phase 28) —
  used by `handleRegisterStartupFromVoice` to loopback into
  `POST /admin/startups/new`
- [ ] R2 bucket `internjobs-voice-audit` (DEFER-29-02-B) +
  `wrangler.jsonc` `r2_buckets` binding line uncommented
- [ ] Worker redeployed (DEFER-29-02-E) so all of the above are live

All secrets must also be mirrored to Infisical `/internjobs-ai` env=`prod`
per the `[[feedback-secrets-to-infisical]]` rule.
