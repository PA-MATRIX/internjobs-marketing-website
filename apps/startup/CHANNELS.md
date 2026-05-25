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

**identity resolution:** clerk #3 session cookie (work-email-only signup at `startups.internjobs.ai`) → server reads `clerk_user_id` from the session → looks up `startup_members` by `clerk_user_id` → resolves `(startup_id, member_id)`. clerk handles auth; the resolver is a single sql lookup. no channel link needed (the clerk user id is the key).

**dispatch:** web ui form submit → next.js server action → calls the SAME `handlePostRole` / `handleSearch` / `handleReplyToCandidate` functions used by mcp. zero core-logic duplication.

**registration:** the 28.5 extended admin endpoint composes `createStartup()` (from 28-04) + `mintClerkInvite(member_id)` + `reserveAgentEmailSlug(startup_id)` + a welcome email. founder gets the clerk invite + agent slug + mcp install snippet in one shot — they choose web OR mcp (or both — same `startup_id`).

---

## phase 29 — telnyx sms adapter (planned)

**channel_type:** `telnyx-sms`

**registration:** during 28-04 admin onboarding, also insert a `(telnyx-sms, founder_phone)` row into `startup_channel_links`. enables inbound sms identity from day one.

**inbound handler sketch:**

```typescript
// apps/startup/workers/routes/telnyx.ts
import { Hono } from "hono";
import { resolveChannelLink } from "../lib/resolveChannelLink";
import { classifyIntent } from "../lib/intent";
import { handleSearch, handleExecute } from "../tools/execute";
import { sendSms } from "../lib/telnyx";

export const telnyxRouter = new Hono<{ Bindings: Env }>();

telnyxRouter.post("/webhooks/telnyx/sms", async (c) => {
  // Telnyx webhook signature verification omitted for brevity
  const payload = await c.req.json();
  const fromPhone = payload.data?.payload?.from?.phone_number;   // e.g. '+15551234567'
  const body = payload.data?.payload?.text;

  // 1. identity resolution
  const ctx = await resolveChannelLink(c.env, "telnyx-sms", fromPhone);
  if (!ctx) {
    // unknown phone — politely no-op (don't leak whether the number is known)
    return c.json({ ok: true });
  }

  // 2. intent classification (text → action_name + args)
  // e.g. "post a frontend intern role" → {action: "post_role", args: {title: "Frontend Intern", ...}}
  // built on a small llm call w/ a fixed action enum + few-shot examples
  const intent = await classifyIntent(body, c.env);
  if (!intent) {
    await sendSms(c.env, fromPhone, "didn't catch that. try: 'post a frontend intern role' or 'search candidates with react experience'.");
    return c.json({ ok: true });
  }

  // 3. dispatch — same core handler the mcp execute() tool calls
  const result = intent.kind === "search"
    ? await handleSearch(c.env, ctx, intent.scope, intent.query)
    : await handleExecute(c.env, ctx, intent.action, intent.args);

  // 4. format result for sms (truncated, no markdown)
  const replyText = formatForSms(result);

  // 5. outbound reply (also via telnyx-sms — same channel)
  await sendSms(c.env, fromPhone, replyText);

  return c.json({ ok: true });
});
```

**outbound reply:**

```typescript
export async function sendSms(env: Env, to: string, text: string): Promise<void> {
  await fetch("https://api.telnyx.com/v2/messages", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${env.TELNYX_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: env.TELNYX_FROM_NUMBER,
      to,
      text,
      ...(env.TELNYX_MESSAGING_PROFILE_ID && { messaging_profile_id: env.TELNYX_MESSAGING_PROFILE_ID }),
    }),
  });
}
```

**why this is ~50 LOC and not 500:** the resolver, the handlers, the audit log, and the database — all reused. the adapter is just inbound webhook → resolve → intent → dispatch → outbound reply.

---

## phase 29 — telnyx voice ai adapter (planned)

**channel_type:** `telnyx-voice` (same identity model, different ingress)

telnyx voice ai is configurable to call any http endpoint as a tool. point it at `https://mcp.internjobs.ai/mcp` with a per-agent bearer token — telnyx handles tts/stt/intent/prompt; we expose exactly what mcp already exposes.

**configuration sketch (telnyx portal, not code):**

```yaml
voice_agent:
  greeting: "thanks for calling internjobs. what role are you hiring for?"
  tools:
    - name: internjobs_mcp
      type: http
      url: https://mcp.internjobs.ai/mcp
      auth:
        type: bearer
        token: ${TELNYX_VOICE_AGENT_TOKEN}    # per-startup mcp install token
      tool_definition_source: discover_actions
```

**registration:** during voice-intake onboarding (phase 29), insert a `(telnyx-voice, +caller_phone)` link AND issue a per-call install token. caller's first call provisions everything; subsequent calls resolve via the link.

**zero custom voice code in our codebase.** telnyx is the entire ingress.

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

**ingress:** cloudflare email routing catch-all on `startups.internjobs.ai` → worker inbound webhook → resolves by `from_address`. existing student-side reply-to alias system already proves the email-as-intent pattern; the adapter just plugs it into the startup core.

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
