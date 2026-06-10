# channels — adapter architecture for the startup mcp server

> *v1.4 Phase 28 STARTUP-CHANNEL-02. living doc — every new channel adapter appends here.*

every startup channel (mcp, web, sms, voice, email, slack/discord/teams...) resolves
identity to a `(startup_id, member_id)` pair, then dispatches into the same core action
handlers. the channel surface is interchangeable; the business logic isn't.

this doc shows the pattern and sketches the three not-yet-built adapters that prove it.

---

## overview — the resolver + dispatcher pattern

```
+---------------------------+
|  channel surface          |   <-- new for every channel (web, sms, voice, slack...)
|  (http handler / webhook) |
+------------+--------------+
             |
             v
+---------------------------+
|  identity resolver        |   <-- shared. reads startup_channel_links.
|  (channel_type, ext_id)   |       returns (startup_id, member_id).
|     -> (startup, member)  |
+------------+--------------+
             |
             v
+---------------------------+
|  intent classifier        |   <-- optional. text/voice channels parse
|  (text -> action)         |       natural language; mcp gets explicit
|                           |       action_name from the LLM.
+------------+--------------+
             |
             v
+---------------------------+
|  core action handlers     |   <-- shared. handlePostRole, handleSearch,
|  (handlePostRole, ...)    |       handleReplyToCandidate, etc.
|  audit log writes here    |       (writes to startup_action_log).
+---------------------------+
```

### the shared table — `startup_channel_links`

migration 0011 (28-01). every (channel_type, channel_external_id) is unique.

| column | example | notes |
|---|---|---|
| `id` | uuid | pk |
| `startup_id` | uuid | fk |
| `member_id` | uuid | fk (which member sends from this channel) |
| `channel_type` | `'mcp'`, `'telnyx-sms'`, `'web'`, `'slack'`, `'discord'`, `'teams'`, `'email'` | enum-as-text |
| `channel_external_id` | `'sha256(token)'`, `'+18005551234'`, `'T0123:C9876'` | unique per type |
| `created_at` | timestamptz | |

the UNIQUE constraint on `(channel_type, channel_external_id)` is the keystone of
the cross-startup isolation guarantee. resolver lookups are constant-time; no
fuzzy matching; one row → one startup.

### the isolation guarantee

every core action handler receives `startup_id` from the **resolved context**,
NEVER from the channel payload. cross-startup leaks would require breaking BOTH:
1. the resolver (lookup misses or returns wrong row)
2. the handler (accept `startup_id` from request body)

since every payload schema (zod / json validation) strips `startup_id` and every
sql write includes `WHERE startup_id = $resolved`, both layers must fail for a
leak to happen. see 28-03 SUMMARY § "TWO-LAYER defense" for the mcp implementation.

---

## phase 28 — mcp channel (live)

**channel_type:** `mcp`

**identity resolution:** the worker auth middleware sha-256s the incoming `Authorization: Bearer <token>` and posts the hash to the fly proxy at `/v1/startups/token`. the proxy looks up `startups.mcp_token_hash`, joins to `startup_channel_links` where `channel_type='mcp' AND channel_external_id=<hash>`, returns `{startup_id, member_id, startup_name}`.

**dispatch:** mcp `tools/call execute({action, ...args})` → zod-validates the args → calls `handlePostRole` / `handleReplyToCandidate` / etc. directly. no nl intent classifier needed; the llm client picks the action name.

**registration:** `POST /admin/startups/new` (28-04) inserts the startup + the founder member + a `mcp` channel link in one transaction. token is plaintext exactly once.

---

## phase 28.5 — web channel (planned)

**channel_type:** `web`

**identity resolution:** clerk #3 session cookie (work-email-only signup at `employers.internjobs.ai`) → server reads `clerk_user_id` from the session → looks up `startup_members` by `clerk_user_id` → resolves `(startup_id, member_id)`. clerk handles auth; the resolver is a single sql lookup. no channel link needed (the clerk user id is the key).

**dispatch:** web ui form submit → next.js server action → calls the SAME `handlePostRole` / `handleSearch` / `handleReplyToCandidate` functions used by mcp. zero core-logic duplication.

**registration:** the 28.5 extended admin endpoint composes `createStartup()` (from 28-04) + `mintClerkInvite(member_id)` + `reserveAgentEmailSlug(startup_id)` + a welcome email. founder gets the clerk invite + agent slug + mcp install snippet in one shot — they choose web OR mcp (or both — same `startup_id`).

---

## phase 29 — telnyx sms adapter (live — phase 29-01 + 29-03)

**channel_type:** `telnyx-sms`

**registration:** during 28-04 admin onboarding, an SMS channel-link row is upserted alongside the mcp link (one row per (channel_type, channel_external_id) pair). voice-intake onboarding (29-02) also inserts a `(telnyx-sms, +caller_phone)` link with `opt_in_flags.weekly_touchbase=true`.

**code:**
- `apps/startup/workers/routes/telnyx.ts` — full inbound webhook with load-bearing ordering:
  1. **STOP keyword** (BEFORE sig verify, TCPA-compliant unconditional opt-out) — `isStopKeyword(body)` matches `STOP/STOPALL/UNSUBSCRIBE/CANCEL/END/QUIT`.
  2. **Ed25519 signature verify** via `crypto.subtle` (skipped with warning if `TELNYX_WEBHOOK_PUBLIC_KEY` unbound — Phase 29-01 ops-deferred guard).
  3. **`message.received` event gate** — delivery receipts silent-200.
  4. **Identity resolution** via `resolveChannelLink(env, 'telnyx-sms', from_phone)` → invite-prompt on miss.
  5. **Touchbase numeric fast-path** (Phase 29-03) — `"1"/"2"/"3"` → `env.TOUCHBASE_CURSORS.get(\`touchbase:cursor:\${phone}\`)` → `handleExecute({action: 'show_candidate', params: { position, thread_id }})`.
  6. **Touchbase opt-in fast-path** (Phase 29-03) — `"yes"/"y"` → `PATCH /v1/channel-links/:id/opt-in-touchbase`.
  7. **`classifyIntent(body, env)`** (regex fast-path → Workers AI LLM fallback for natural language).
  8. **Dispatch** to `handleSearch` or `handleExecute`.
  9. **`formatForSms(result) + sendSms(env, from_phone, reply)`**.
- `apps/startup/workers/lib/telnyx.ts` — `sendSms()` + `formatForSms()` with special-cased shapes for `show_candidate` / `register_startup`. Ops-deferred guards on every Telnyx secret.
- `apps/startup/workers/lib/intent.ts` — 2-layer classifier (regex fast-path for numeric / START / YES / Y / NO / N + Workers AI LLM fallback for natural language).
- `apps/startup/workers/routes/scheduled.ts` — weekly touchbase cron (Phase 29-03; `0 14 * * 1` Monday 14:00 UTC). Queries `/v1/touchbase/due-startups`, sends touchbase SMS with 3 fresh candidates, writes 48h KV cursor at `touchbase:cursor:<phone>` so reply 1/2/3 maps back to a candidate.
- `apps/startup/workers/lib/resolveChannelLink.ts` — generic identity helper, returns `StartupContext { startup_id, member_id, startup_name, channel_link_id? }`.

**why this is ~50 LOC of adapter and not 500:** the resolver, the handlers, the audit log, and the database — all reused from the mcp channel. the sms adapter just wires inbound webhook → resolve → fast-paths → intent → dispatch → outbound reply.

---

## phase 29 — telnyx voice ai adapter (live — phase 29-02)

**channel_type:** `telnyx-voice` (same identity model, different ingress)

**code:**
- `apps/startup/workers/routes/voice.ts` — three webhook endpoints called by the Telnyx Voice AI Agent during a call:
  - `POST /webhooks/telnyx/voice-init` — pre-call dynamic-variables hook (returns per-call agent context).
  - `POST /webhooks/telnyx/voice-postprocess` — post-call insights hook (writes transcript + recording to R2 `internjobs-voice-audit`).
  - `POST /webhooks/telnyx/voice-tool` — webhook-tool fallback for `register_startup` + `show_candidate` when `TELNYX_USE_MCP_INTEGRATION != 'true'` (plan-gated MCP tab in Telnyx portal).
- `apps/startup/workers/lib/voice-onboarding.ts` — shared helper that mints a startup row + sends the install-snippet SMS after a successful voice intake.
- `docs/VOICE_AGENT_CONFIG.md` — Telnyx portal config (system prompt, greeting, model, tools, webhooks) — paste into portal for the zero-code Voice AI agent setup.

**TELNYX_USE_MCP_INTEGRATION:** `'true'` = the Voice AI agent's MCP Server tab points at `https://mcp.internjobs.ai/mcp` with `TELNYX_VOICE_AGENT_TOKEN` as Bearer; `'false'` (or unbound) = webhook-tool fallback via `/webhooks/telnyx/voice-tool`. See `PHASE-29-DEFERRED-OPS.md` DEFER-29-02-A for the portal config workflow.

**registration:** the Voice AI agent's last-question tool call (`register_startup`) loopbacks to `POST /admin/startups/new` with the founder's company, name, work-email, and the calling phone as `channel_external_id`. Returns a fresh per-startup install token + an SMS install snippet — delivered to the caller via `sendSms` before the call hangs up.

---

## v1.5 — slack adapter (deferred)

**channel_type:** `slack`

**why deferred:** slack marketplace approval is multi-week; per-pilot oauth still adds bolt/refresh complexity. claude/chatgpt mcp support means tech founders can bridge to slack via anthropic's `slack-mcp-plugin` today with zero work on our side. pilot signal will drive prioritization.

**inbound handler sketch:**

```typescript
// apps/startup/workers/routes/slack.ts
import { Hono } from "hono";

export const slackRouter = new Hono<{ Bindings: Env }>();

slackRouter.post("/webhooks/slack/events", async (c) => {
  const payload = await c.req.json();

  // Slack url_verification handshake
  if (payload.type === "url_verification") {
    return c.text(payload.challenge);
  }

  const event = payload.event;
  if (event?.type !== "message" && event?.type !== "app_mention") {
    return c.json({ ok: true });
  }

  // identity = workspace_id:channel_id (one slack workspace per startup;
  //            multiple channels can resolve to the same startup)
  const externalId = `${payload.team_id}:${event.channel}`;
  const ctx = await resolveChannelLink(c.env, "slack", externalId);
  if (!ctx) return c.json({ ok: true });   // workspace not onboarded

  const intent = await classifyIntent(event.text, c.env);
  if (!intent) return c.json({ ok: true });

  const result = intent.kind === "search"
    ? await handleSearch(c.env, ctx, intent.scope, intent.query)
    : await handleExecute(c.env, ctx, intent.action, intent.args);

  // outbound — post back to the same channel
  await postSlackMessage(c.env, ctx.startup_id, event.channel, formatForSlack(result));
  return c.json({ ok: true });
});
```

**registration:** add a `/slack/install` oauth dance → on completion, insert `(slack, workspace_id:channel_id)` link. shipped behind a per-pilot install (no marketplace listing for v1).

---

## v1.5 — discord + teams adapters

same pattern as slack. `channel_external_id` differs:

- **discord**: `guild_id:channel_id`
- **teams**: `tenant_id:team_id:channel_id`

each is ~30–50 loc of adapter code on top of the shared resolver + dispatcher.

---

## v1.5 — email-initiated channel

**channel_type:** `email`

**ingress:** cloudflare email routing catch-all on `employers.internjobs.ai` → worker inbound webhook → resolves by `from_address`. existing student-side reply-to alias system already proves the email-as-intent pattern; the adapter just plugs it into the startup core.

**why deferred:** ridhi-mediated email handoff covers the gap. founders who want mcp will install mcp; founders who want web will use 28.5; founders who want a phone call get telnyx voice in phase 29.

---

## summary — when to add a new adapter

1. is there a new ingress surface (slack, discord, fax, ...) that founders use?
2. does identity for it map cleanly to `(channel_type, channel_external_id)`?
3. can the surface dispatch to existing core handlers (`handlePostRole`, `handleSearch`, `handleReplyToCandidate`, `handleUpdateRole`, `handleArchiveRole`, `handleMarkCandidate`)?

if yes to all three: it's ~30–100 loc on top of the resolver + dispatcher. no
core changes. add a row to this doc. done.

if the new channel introduces a fundamentally different identity model (e.g.
oauth scoped to a third-party tenant), revisit `startup_channel_links` — but
the cross-startup isolation invariant must survive any schema change.
