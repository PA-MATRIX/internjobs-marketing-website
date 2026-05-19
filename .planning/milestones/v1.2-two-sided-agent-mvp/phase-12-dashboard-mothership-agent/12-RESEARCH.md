# Phase 12: Dashboard Mothership Agent — Research

**Researched:** 2026-05-18
**Domain:** Cloudflare Durable Objects (alarm-driven agent), Workers AI (LLM extraction), Mattermost REST API (chat ingest), React Router 7 (UI), lucide-react (nav icons)
**Confidence:** HIGH (codebase verified by direct read; external APIs verified via WebFetch/WebSearch)

---

## Summary

Phase 12 builds the per-employee LLM agent that monitors Email (EmployeeMailboxDO) and Chat (Mattermost REST API), extracts cross-channel todos, ranks them, and surfaces them on the Dashboard pane. It also adds Phone and SMS placeholder nav icons with route stubs documenting the future Cloudflare voice architecture.

The recommended approach: extend `EmployeeMailboxDO` with a `todos` table (no new DO class needed), drive periodic Mattermost polling via a **Durable Object alarm** that self-reschedules every 2 minutes, trigger email-ingest inline at `createEmail()` call time, and use `@cf/moonshotai/kimi-k2.6` with `response_format` JSON schema mode for structured todo extraction. The Dashboard pane fetches todos from a new `GET /api/dashboard/todos` Hono route and renders a ranked card list with per-source icons.

A `DashboardDO` would add operational complexity without any benefit at v1.2 scale (single-digit employees). Extending `EmployeeMailboxDO` keeps the proven pattern: one DO per employee, keyed by `clerk_user_id`, Drizzle ORM over durable SQLite.

**Primary recommendation:** Extend `EmployeeMailboxDO` with a `todos` table + DO alarm for Mattermost polling. Use kimi-k2.6 for structured extraction. Split into three waves: storage+nav, ingest+extraction, ranking+UI.

---

## Architecture Decisions

### Q1: Storage — where do todos live?

**Decision: Extend `EmployeeMailboxDO` with a `todos` table.**

Rationale:
- EmployeeMailboxDO is already keyed by `clerk_user_id` and follows the per-employee scoping rule. No cross-employee leakage by construction (same guarantee the inbox has today).
- Avoids a new DO class with a new wrangler `migrations` tag, new binding, new RPC surface, and new middleware.
- The DO alarm needed for Mattermost polling lives in the same DO that owns the todos — no cross-DO calls required.
- A `DashboardDO` would only make sense if todos needed workspace-wide aggregation (e.g., "all todos for all employees" dashboard for an operator). Phase 12 scope is strictly per-employee.

Schema addition (new migration `3_todos_table`):
```sql
CREATE TABLE todos (
  id TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL,
  source_channel TEXT NOT NULL CHECK (source_channel IN ('email','chat','phone','sms','meeting')),
  source_id TEXT NOT NULL,
  title TEXT NOT NULL,
  preview TEXT,
  urgency_score INTEGER NOT NULL DEFAULT 50,  -- 0-100 LLM-assigned
  deadline_at TEXT,                           -- ISO-8601 or null
  mentioned_actors TEXT,                      -- JSON array of strings
  is_mention INTEGER NOT NULL DEFAULT 0,      -- 1 if @-mentioned
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at TEXT,
  INDEX idx_todos_urgency ON todos(resolved_at, urgency_score DESC),
  INDEX idx_todos_source ON todos(source_channel, source_id)
);
```

Neon is ruled out for todos. The existing codebase has no Neon dependency in the Parrot worker. Adding a Neon connection would require a new secret, cold-start latency for the TCP pool, and cross-region round-trips. DO SQLite is collocated with the compute.

### Q2: Ingestion pattern

**Decision: Dual-trigger hybrid.**

1. **Email ingest** — inline, synchronous at `EmployeeMailboxDO.createEmail()` call time. When an inbound email is stored (Inbox folder), immediately call `extractTodosFromEmail(email)` and insert any extracted todos. This is already the right call site: `createEmail()` is the single choke-point for all inbound mail. No webhook registration needed.

2. **Chat ingest** — **Durable Object alarm**, self-rescheduling, 2-minute interval. The alarm calls `GET /api/v4/users/me/posts?since=<last_poll_ms>` on the Mattermost REST API (or iterates channels via `GET /api/v4/channels?...` then `GET /api/v4/channels/{id}/posts?since=...`). Posts newer than `last_mm_poll_at` are extracted. `last_mm_poll_at` is stored in DO storage (a single `kv` row).

DO alarm pattern (verified via Cloudflare docs):
```typescript
// In EmployeeMailboxDO constructor:
async initAlarm() {
  const existing = await this.ctx.storage.getAlarm();
  if (!existing) {
    await this.ctx.storage.setAlarm(Date.now() + 2 * 60 * 1000);
  }
}

async alarm() {
  await this.pollMattermostNewPosts();
  // Self-reschedule unconditionally
  await this.ctx.storage.setAlarm(Date.now() + 2 * 60 * 1000);
}
```

The alarm is initialized on first `upsertProfile()` call (first login). It runs forever after. No wrangler cron trigger needed.

**Mattermost outgoing webhooks ruled out**: Outgoing webhooks only fire in **public channels** and require a trigger word. They cannot observe all channels (private channels, DMs). The bot REST API polling approach supports all channel types including private channels and DMs if the bot account has System Admin access.

**Mattermost WebSocket ruled out for v1.2**: The Cloudflare Worker (Hono) does not maintain a persistent outbound WebSocket connection — it is request-driven. A WebSocket listener would require a separate long-lived Cloudflare Durable Object to hold the connection, which is additional complexity with no benefit over 2-minute polling for v1.2 scale.

### Q3: Todo extraction — model, schema, single vs batched

**Decision: One LLM call per inbound event. Use `@cf/moonshotai/kimi-k2.6`.**

Rationale for kimi-k2.6:
- **Confirmed available** on Workers AI as of 2026-04-20 (Day 0 launch with Moonshot AI).
- Model ID: `@cf/moonshotai/kimi-k2.6`
- Supports `response_format` JSON schema mode (verified via official docs) — gives deterministic structured output without regex parsing.
- 262k context window handles long email threads easily.
- $0.95 input / $4.00 output per million tokens. A todo extraction prompt is ~300 tokens input + ~100 tokens output = ~$0.00049 per email. Negligible at v1.2 employee headcount.
- Function calling / tool calling supported (useful if Phase 13 wants the agent to act, not just observe).

Fallback model: `@cf/meta/llama-3.3-70b-instruct-fp8-fast` is already in production for the student SMS agent. It is cheaper ($0.29/$2.25) but does NOT have documented `response_format` JSON schema support. Use as a fallback if kimi-k2.6 is unavailable/errors.

**JSON schema for extracted todos** (the `response_format` target):
```json
{
  "type": "object",
  "properties": {
    "todos": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["title", "urgency_score", "is_mention"],
        "properties": {
          "title": { "type": "string", "maxLength": 120 },
          "preview": { "type": "string", "maxLength": 300 },
          "urgency_score": { "type": "integer", "minimum": 0, "maximum": 100 },
          "deadline_at": { "type": ["string", "null"] },
          "mentioned_actors": { "type": "array", "items": { "type": "string" } },
          "is_mention": { "type": "boolean" }
        }
      }
    }
  }
}
```

Empty array `{ "todos": [] }` is a valid response (message requires no action). Parse defensively.

**Batching**: Not needed for v1.2. The alarm fires every 2 minutes; at most a handful of Mattermost posts accumulate. Email arrives one at a time via the `createEmail()` trigger. Batch when employee count justifies it (future).

### Q4: Ranking

**Decision: Hybrid urgency ranking — LLM urgency_score × recency × mention boost.**

Concrete formula (integer arithmetic, no float ops):
```
rank = (urgency_score * 2)
     + (is_mention ? 30 : 0)
     + (deadline_at IS NOT NULL AND deadline_at < now + 24h ? 40 : 0)
     + (deadline_at IS NOT NULL AND deadline_at < now + 1h ? 20 : 0)
     - floor(hours_since_created / 6)   -- recency decay, max -40 over first 24h
```

The LLM assigns `urgency_score` 0–100 based on language cues ("urgent", "ASAP", "blocking", "please reply by", etc.). @mention boost and deadline detection are deterministic so they can't hallucinate. Recency decay prevents very old unresolved todos from dominating.

Ranking is computed at read time (single SQL `ORDER BY` expression) or stored as a `rank` column recomputed on each poll cycle. Storing the rank allows indexing; recalculating at read time is simpler and fine at v1.2 scale.

SQL `ORDER BY` at read time is the right choice for v1.2 (avoids stale rank columns). The query:
```sql
SELECT * FROM todos
WHERE resolved_at IS NULL
ORDER BY
  (urgency_score * 2)
  + (CASE WHEN is_mention = 1 THEN 30 ELSE 0 END)
  + (CASE WHEN deadline_at IS NOT NULL AND deadline_at < datetime('now', '+24 hours') THEN 40 ELSE 0 END)
  - (CAST((julianday('now') - julianday(created_at)) * 24 / 6 AS INTEGER))
  DESC
LIMIT 50;
```

### Q5: Mattermost ingest — auth and poll mechanism

**Decision: Mattermost Bot Account with System Admin access, REST API polling.**

- Create a bot account via Mattermost System Console > Integrations > Bot Accounts.
- Grant "System Admin" role so the bot can read private channels and DMs.
- Generate a **personal access token** (does not expire). Store in Infisical at `/internjobs-ai/MATTERMOST_BOT_TOKEN`.
- Add `MATTERMOST_BOT_TOKEN` to `wrangler.jsonc` secrets and `Env` type.

API endpoints used:
- `GET {MATTERMOST_URL}/api/v4/users/me/channel_members` — list channels the bot is a member of (or use system-level channels list for System Admin bots).
- `GET {MATTERMOST_URL}/api/v4/channels/{channel_id}/posts?since={unix_ms}` — posts since last poll timestamp. `since` is Unix milliseconds.

**Known issue**: Mattermost GitHub issue #13846 documents that the `since` parameter can miss some posts in edge cases during high-write moments. Mitigation: store `last_poll_at - 5000ms` (5 second overlap) to guarantee no gaps. Duplicate detection uses `source_id` unique constraint (the post ID) on the `todos` table — INSERT OR IGNORE.

Per-employee scoping: The bot account is workspace-wide, but each `EmployeeMailboxDO` only ingests messages **mentioning that employee** or **in channels that employee is a member of**. Map `clerk_user_id` → Mattermost `user_id` via the Mattermost API (cache in DO storage after first resolution). Use `GET /api/v4/users?in_channel={id}` to check membership, or more simply: poll `GET /api/v4/users/{employee_mm_id}/posts?since=...` which returns only posts where the employee was mentioned or replied to.

**OPEN RISK**: Mapping `clerk_user_id` → Mattermost `user_id` requires a lookup by email. The Mattermost API supports `GET /api/v4/users/email/{email}` to resolve user by workspace email. This lookup can be done once at alarm init and cached in DO storage. But it requires the employee to have already logged into Mattermost (so their MM account exists). For employees who haven't SSO'd into MM yet, the polling step gracefully skips with no error.

### Q6: Dashboard UI

**Decision: Ranked card list with source-channel icon badge. Click-through via route navigation.**

The `dashboard.tsx` route already has the secondary nav structure (All todos / Mentions / Today / This week). Wire the "All todos" view to a loader that calls `GET /api/dashboard/todos`.

Card anatomy per todo:
```
[ Source icon ] [ Title (truncated to 2 lines) ]
                [ Preview snippet (1 line, muted) ]
                [ Age badge ] [ Urgency dot (color-coded) ] [ Deadline chip if present ]
```

Source icons (lucide-react, already installed):
- Email: `<Mail />` (violet)
- Chat: `<MessageSquare />` (sky)
- Phone: `<Phone />` — placeholder, no real data yet
- SMS: `<MessageCircle />` — placeholder
- Meeting: `<Video />` (amber) — placeholder

Click-through:
- Email todo: navigate to `/inbox?message={source_id}` — the InboxPane will need a query param handler to auto-open the message.
- Chat todo: navigate to `/chat` — Mattermost iframe scroll-to-post is a future enhancement (Mattermost deeplinks require a separate MM-side implementation).

Views ("All todos / Mentions / Today / This week") are filtered in the Hono route via query param `?view=mentions|today|week|all`. The SQL WHERE clause adds filters:
- `mentions`: `is_mention = 1`
- `today`: `created_at >= datetime('now', 'start of day')`
- `week`: `created_at >= datetime('now', '-7 days')`

### Q7: Phone/SMS route stubs

**Decision: Routes at `/phone` and `/sms` (not `/dial`).**

Rationale: `/phone` and `/sms` are the most literal/expected paths. `/dial` implies an active call UI which is not the deferred vision (the vision is inbound/outbound SMS and voice call management, not just a dialer).

Nav icons:
```typescript
import { Phone, MessageCircle } from "lucide-react";
// Phone → /phone
// MessageCircle → /sms
```

Both `lucide-react` icons are already available (the package is installed). No new dependency needed.

Placeholder route content: An empty state card with:
- Icon at 48px
- Heading: "Phone" / "SMS"
- Body: "Coming soon — Telnyx via Cloudflare Agents SDK"
- Source comment block documenting the future implementation (see architecture section below).

**Future Telnyx architecture to document in stub comments** (do NOT install in Phase 12):

Verified from Cloudflare official docs (2026-05-18):
- Package: `@cloudflare/voice` (separate from `agents` package, install both)
- Package: `agents` (base Agent class)
- Pattern: `withVoice(Agent)` mixin (confirmed name from docs)
- Available built-in STT: `WorkersAIFluxSTT`, `WorkersAINova3STT`, `WorkersAITTS`
- Third-party STT/TTS packages (official): `@cloudflare/voice-deepgram`, `@cloudflare/voice-elevenlabs`, `@cloudflare/voice-twilio`
- **CONFIRMED: No `@telnyx/voice-cloudflare` package exists.** The original phase definition mentioned it but it does not appear in Cloudflare's official voice provider list. Twilio (`@cloudflare/voice-twilio`) is the telephony provider documented.
- LLM integration: Vercel `ai` SDK `streamText` + `workers-ai-provider` (or `env.AI.run()` directly)
- Handler: `onTurn(transcript, context)` confirmed as the lifecycle method name

The stub comment should say: "Future: install `@cloudflare/voice` + `agents`, extend Agent with `withVoice(Agent)` mixin, use `@cloudflare/voice-twilio` for SIP/telephony OR evaluate Telnyx once a `@cloudflare/voice-telnyx` package ships."

### Q8: Wave structure

**Recommended 3-wave split:**

**Wave 1 — Foundation (storage + nav icons + UI scaffold)**
- Add migration `3_todos_table` to `employeeMailboxMigrations`
- Add Phone + SMS to `NAV` array in WorkspaceShell.tsx
- Add `/phone` and `/sms` route stubs with placeholder UI + future-architecture comments
- Add `Env` extension: `MATTERMOST_BOT_TOKEN?: string`, `AI: Fetcher` (Workers AI binding)
- Wire `wrangler.jsonc`: add `ai` binding + `MATTERMOST_BOT_TOKEN` secret declaration
- Add `GET /api/dashboard/todos` Hono route (returns empty array until Wave 2 populates)
- Wire `dashboard.tsx` loader to call the new route; render real card list (even if empty)

**Wave 2 — Ingest + LLM extraction**
- Implement `extractTodosFromEmail()` in EmployeeMailboxDO, call from `createEmail()` for Inbox folder
- Implement `alarm()` handler in EmployeeMailboxDO for Mattermost polling
- Call `initAlarm()` from `upsertProfile()` (first login triggers the polling cycle)
- Implement `pollMattermostNewPosts()`: resolve MM user ID, GET posts since last_poll_at, call `extractTodosFromChat()` per post batch
- Implement `extractTodosFromChat()` with kimi-k2.6 JSON schema extraction
- Store `last_mm_poll_at` in DO storage
- Integration smoke test: seed an email with "Please reply by EOD" subject, verify a todo row appears

**Wave 3 — Ranking + cross-channel polish**
- Implement `ORDER BY rank` SQL in `getTodos(view)` method
- Wire secondary-nav views (Mentions / Today / This week) to `?view=` query param
- Add source-channel icon badge to todo cards
- Add click-through navigation (Email click → `/inbox?message={id}`)
- Stale todo cleanup: mark todos `resolved_at = now` when the source email is moved to Trash/Sent
- Regression smoke test: verify kimi-k2.6 extraction + ranking on multi-channel seed data

### Q9: Failure modes

**LLM down or errors:**
- Extraction wrapped in try/catch. On error, log and skip (no todo written). Email is still stored; the inbox is not blocked.
- Alarm continues to self-reschedule even if extraction errors. Retry on next cycle.
- No "partial writes" risk: todos are inserted individually after validation.

**Mattermost unreachable:**
- `pollMattermostNewPosts()` catches fetch errors, logs them, and returns without updating `last_mm_poll_at` so the next alarm retries the same window.
- If MATTERMOST_BOT_TOKEN is not set, `pollMattermostNewPosts()` short-circuits gracefully.

**Stale todos cleanup:**
- When an email is moved to Trash or Archived, mark its todos `resolved_at = now()` in a `cleanupTodosForEmail(emailId)` call from `deleteEmail()` / `updateEmail()`.
- Chat todos have no automatic cleanup trigger in Phase 12. They decay in ranking via the recency decay formula. Manual "mark done" button is a Wave 3 nice-to-have.

**Alarm retry behavior:**
- Cloudflare guarantees at-least-once execution with 6 retries on exponential backoff starting at 2 seconds. The alarm handler is idempotent (INSERT OR IGNORE on `source_id`).

### Q10: Testing smoke test approach

**Approach: Dev-mode seed + real LLM call + manual assertion (no golden-set automation in Phase 12).**

- The existing dev auth bypass (`X-Parrot-Dev-Employee` header) means local smoke tests don't need real Clerk JWTs.
- POST a crafted email to `EmployeeMailboxDO.createEmail()` with subject "Can you review this by Friday?" and verify a `todos` row appears via `GET /api/dashboard/todos`.
- Trigger `alarm()` manually via `wrangler dev --test-scheduled` (Workers supports this via `/__scheduled` endpoint) to test Mattermost polling without waiting 2 minutes.
- Use `wrangler dev` local with `MATTERMOST_BOT_TOKEN` pointing at the staging Mattermost instance (`internjobs-mattermost.fly.dev`).
- Do NOT mock kimi-k2.6 in Phase 12. Real LLM calls during smoke testing are cheap (~$0.001/run) and more valuable than mocked assertions.

---

## Phase 12 Wave Breakdown (Final)

| Wave | What ships | Key files touched |
|------|-----------|-------------------|
| 12.1 | todos migration, Phone+SMS nav icons+stubs, empty dashboard API+UI, AI+BOT_TOKEN bindings | `durableObject/migrations.ts`, `WorkspaceShell.tsx`, `routes.ts`, `routes/phone.tsx` (new), `routes/sms.tsx` (new), `workers/index.ts`, `wrangler.jsonc`, `workers/types.ts`, `app/routes/dashboard.tsx` |
| 12.2 | Email ingest trigger, DO alarm init, Mattermost poller, kimi-k2.6 extraction | `durableObject/index.ts`, `workers/lib/ai.ts` (replace stub), new `workers/lib/mattermost.ts` |
| 12.3 | SQL ranking, view filters, click-through, stale cleanup | `durableObject/index.ts`, `app/routes/dashboard.tsx`, new `app/components/TodoCard.tsx` |

---

## must_haves Draft

These are goal-backward truth statements for PLAN.md frontmatter:

```yaml
must_haves:
  - id: DASHBOARD-AGENT-01
    statement: >
      The EmployeeMailboxDO has a `todos` table. When an inbound email
      arrives in the Inbox folder, the DO synchronously calls kimi-k2.6
      to extract todos and inserts them. The alarm runs every 2 minutes,
      polls Mattermost for new posts mentioning the employee, and inserts
      extracted todos.
    verification: >
      POST a seed email with "Please reply by Friday" to the local DO.
      GET /api/dashboard/todos returns at least one todo row with
      source_channel = 'email'.

  - id: DASHBOARD-AGENT-02
    statement: >
      GET /api/dashboard/todos returns todos ordered by the hybrid rank
      formula (urgency_score * 2 + mention_boost + deadline_boost -
      recency_decay), filtered by `resolved_at IS NULL`, scoped to the
      signed-in employee's DO only.
    verification: >
      Seed two todos: one with urgency_score=80, one with urgency_score=20
      and is_mention=1. The urgency=80 todo ranks first.

  - id: DASHBOARD-UI-01
    statement: >
      The /dashboard route renders a card list of todos from
      GET /api/dashboard/todos. Each card shows a source-channel icon
      (Mail/MessageSquare/etc.), title, preview, and age badge. Clicking
      an email-source todo navigates to /inbox?message={id}.
    verification: >
      With a seeded todo, /dashboard shows at least one card. Card has a
      mail icon. Clicking it changes the URL to /inbox?message=...

  - id: DASHBOARD-NAV-01
    statement: >
      WorkspaceShell.tsx NAV array includes Phone (lucide Phone icon,
      href=/phone) and SMS (lucide MessageCircle icon, href=/sms). Both
      routes render a placeholder card with "Coming soon — Telnyx via
      Cloudflare Agents SDK" copy and a source comment documenting the
      future @cloudflare/voice + withVoice(Agent) implementation.
    verification: >
      Navigate to /phone and /sms. Both render without errors. WorkspaceShell
      icon rail shows Phone and SMS icons alongside Dashboard/Email/Chat/Meetings.
```

---

## Open Risks

### RISK-01: Mattermost bot user_id → clerk_user_id mapping
- **What we know**: Mattermost identifies users by an opaque MM `user_id`. The OIDC bridge in WorkspaceDO maps `clerk_user_id` to workspace email at SSO time, but it does NOT store the MM `user_id`.
- **What's unclear**: The `/api/v4/users/email/{email}` endpoint resolves by email to get the MM user_id. This works if the employee has already SSO'd into Mattermost. First-time employees who haven't opened MM yet won't have an account and the lookup returns 404.
- **Recommendation**: In `initAlarm()`, attempt the email→MM_user_id lookup. If it fails (404), store a sentinel `mm_user_id = null` and skip Mattermost polling until the user logs into MM. Retry on each alarm cycle.

### RISK-02: kimi-k2.6 cost at scale
- **What we know**: $0.95/$4.00 per million tokens. Per-event extraction is ~$0.001.
- **What's unclear**: If an employee gets 100+ emails per day, cost could reach $0.10/day/employee. Negligible for v1.2 (single-digit employees) but worth noting for v1.3+ with many employees.
- **Recommendation**: No action in Phase 12. Add a `?max_per_hour=20` guard before the LLM call if spam arrives.

### RISK-03: wrangler.jsonc `ai` binding requires Workers AI paid plan
- **What we know**: The student app already uses Workers AI via direct REST (no binding). The Parrot worker currently has NO `ai` binding in `wrangler.jsonc`.
- **What's unclear**: The direct REST approach (using `CLOUDFLARE_AI_API_TOKEN` from Infisical) is already proven. The `ai` binding is more ergonomic but requires declaring it in `wrangler.jsonc`.
- **Recommendation**: Use the existing `CLOUDFLARE_AI_API_TOKEN` direct REST pattern (same as `apps/app/src/workflows/student-inbound.mjs`) for Wave 12.2 rather than adding a new binding. This avoids a wrangler.jsonc change and is already proven in production. The `ai` binding can be added in a future wave if needed.

### RISK-04: Telnyx package does not exist
- **What we know**: `@telnyx/voice-cloudflare` does NOT exist as a Cloudflare-official package. The Cloudflare voice docs list `@cloudflare/voice-twilio` for telephony. Deepgram and ElevenLabs have official packages.
- **Recommendation**: The Phone/SMS route stubs should NOT reference `@telnyx/voice-cloudflare`. Instead, they should say: "Future: `@cloudflare/voice` + `withVoice(Agent)` mixin, telephony via `@cloudflare/voice-twilio` OR Telnyx once an official package ships." This is honest and doesn't lock a non-existent package name into the codebase.

### RISK-05: DO alarm minimum interval
- **What we know**: Cloudflare docs do not specify a minimum alarm interval. The 2-minute interval chosen here is above any practical platform minimum.
- **What's unclear**: Whether extremely frequent alarms (sub-30s) would be rate-limited.
- **Recommendation**: 2-minute interval is conservative and well-supported.

### RISK-06: Mattermost posts `since` parameter edge case
- **What we know**: GitHub issue mattermost/mattermost#13846 confirms the `since` parameter can miss posts under high write load.
- **Recommendation**: Subtract 5000ms from `last_mm_poll_at` when building the `since` query. Use `source_id` unique constraint on `todos` table for deduplication. INSERT OR IGNORE.

---

## Standard Stack

### Core (verified)
| Library/Tool | Version/ID | Purpose | How Used |
|---|---|---|---|
| `@cf/moonshotai/kimi-k2.6` | 2026-04-20 launch | LLM todo extraction | Called via Workers AI REST (existing pattern from student app) with `response_format` JSON schema |
| Cloudflare DO Alarm | Platform built-in | Periodic Mattermost polling | `setAlarm()` / `alarm()` handler in EmployeeMailboxDO |
| Mattermost REST API v4 | v4 (stable) | Chat ingest | `GET /api/v4/channels/{id}/posts?since={ms}` with Bearer token |
| `lucide-react` | already installed | Nav icons (Phone, MessageCircle) | Import `Phone`, `MessageCircle` from existing installed package |
| `drizzle-orm/durable-sqlite` | already installed | todos table ORM | Extend existing schema.ts |
| `hono` | already installed | New dashboard API route | `GET /api/dashboard/todos` |

### Confirmed NOT needed in Phase 12
| Package | Reason |
|---|---|
| `@cloudflare/voice` | Deferred. Document in stub comments only. |
| `agents` | Deferred. Document in stub comments only. |
| `@cloudflare/voice-twilio` / Telnyx | Deferred. No Telnyx CF package exists. |
| DashboardDO (new DO class) | Unnecessary. EmployeeMailboxDO extension is correct. |
| Neon | No Neon dependency exists in Parrot worker today. DO SQLite is correct. |

---

## Code Examples

### DO Alarm self-reschedule pattern (Cloudflare official docs verified)
```typescript
// In EmployeeMailboxDO:

async initAlarm() {
  const existing = await this.ctx.storage.getAlarm();
  if (!existing) {
    await this.ctx.storage.setAlarm(Date.now() + 2 * 60 * 1000);
  }
}

async alarm() {
  try {
    await this.pollMattermostNewPosts();
  } catch (err) {
    console.error("Parrot alarm: Mattermost poll failed", err);
  } finally {
    // Always reschedule — even on error
    await this.ctx.storage.setAlarm(Date.now() + 2 * 60 * 1000);
  }
}
```

### kimi-k2.6 extraction via Workers AI REST (existing direct-REST pattern)
```typescript
// Source: apps/app/src/workflows/student-inbound.mjs pattern adapted for TS
async function extractTodosFromText(
  text: string,
  env: Env,
): Promise<ExtractedTodo[]> {
  const resp = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/ai/run/@cf/moonshotai/kimi-k2.6`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.CLOUDFLARE_AI_API_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messages: [
          {
            role: "system",
            content: `Extract action items from the following message. 
Return ONLY valid JSON matching the schema. Return {"todos":[]} if none.`,
          },
          { role: "user", content: text.slice(0, 8000) },
        ],
        response_format: {
          type: "json_schema",
          json_schema: TODO_EXTRACTION_SCHEMA,
        },
        max_tokens: 512,
      }),
    },
  );
  if (!resp.ok) throw new Error(`AI REST ${resp.status}`);
  const data = (await resp.json()) as { result: { response: string } };
  const parsed = JSON.parse(data.result.response);
  return parsed.todos ?? [];
}
```

### Mattermost post fetch (verified API shape)
```typescript
async function getMattermostPostsSince(
  mattermostUrl: string,
  botToken: string,
  channelId: string,
  sinceMs: number,
): Promise<MattermostPost[]> {
  const url = `${mattermostUrl}/api/v4/channels/${channelId}/posts?since=${sinceMs - 5000}`;
  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${botToken}` },
  });
  if (!resp.ok) return [];
  const data = await resp.json() as { posts: Record<string, MattermostPost> };
  return Object.values(data.posts ?? {});
}
```

### WorkspaceShell.tsx NAV extension
```typescript
import {
  LayoutDashboard, Mail, MessageSquare, Video,
  Phone, MessageCircle,  // ADD
} from "lucide-react";

const NAV: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", Icon: LayoutDashboard },
  { href: "/inbox",     label: "Email",     Icon: Mail },
  { href: "/chat",      label: "Chat",      Icon: MessageSquare },
  { href: "/meetings",  label: "Meetings",  Icon: Video },
  { href: "/phone",     label: "Phone",     Icon: Phone },      // ADD
  { href: "/sms",       label: "SMS",       Icon: MessageCircle }, // ADD
];
```

---

## Sources

### Primary (HIGH confidence — direct code read or Cloudflare official docs)
- `/Users/rajren/internjobs-cms/apps/parrot/workers/durableObject/index.ts` — EmployeeMailboxDO full source, migration runner, schema
- `/Users/rajren/internjobs-cms/apps/parrot/workers/durableObject/migrations.ts` — migration table + existing migrations (2 applied)
- `/Users/rajren/internjobs-cms/apps/parrot/workers/db/schema.ts` — existing Drizzle schema (emails/attachments/folders)
- `/Users/rajren/internjobs-cms/apps/parrot/app/components/WorkspaceShell.tsx` — NAV array, current icons, shell layout
- `/Users/rajren/internjobs-cms/apps/parrot/app/routes/dashboard.tsx` — stub with secondary nav already wired
- `/Users/rajren/internjobs-cms/apps/parrot/workers/index.ts` — Hono routes pattern
- `/Users/rajren/internjobs-cms/apps/parrot/wrangler.jsonc` — MATTERMOST_URL var confirmed, no ai binding yet
- `/Users/rajren/internjobs-cms/apps/parrot/workers/types.ts` — Env interface (where MATTERMOST_BOT_TOKEN will be added)
- [Cloudflare DO Alarms docs](https://developers.cloudflare.com/durable-objects/api/alarms/) — setAlarm/getAlarm/deleteAlarm API, self-reschedule pattern, at-least-once guarantee
- [kimi-k2.6 Workers AI docs](https://developers.cloudflare.com/workers-ai/models/kimi-k2.6/) — model ID `@cf/moonshotai/kimi-k2.6`, response_format support, 262k context, pricing
- [Cloudflare Voice Agent docs](https://developers.cloudflare.com/agents/api-reference/voice/) — `@cloudflare/voice` package name confirmed, `withVoice(Agent)` mixin confirmed, available providers confirmed (Twilio YES, Telnyx NOT listed)
- [Cloudflare Build a Voice Agent guide](https://developers.cloudflare.com/agents/guides/build-a-voice-agent/) — `onTurn(transcript, context)` lifecycle method confirmed, WorkersAIFluxSTT/TTS confirmed

### Secondary (MEDIUM confidence — official Mattermost developer docs via WebFetch/WebSearch)
- [Mattermost Bot Accounts docs](https://developers.mattermost.com/integrate/reference/bot-accounts/) — bot creation, System Admin permission for private channel access, Bearer token auth
- [Mattermost Outgoing Webhooks](https://developers.mattermost.com/integrate/webhooks/outgoing/) — confirmed: public channels only, trigger-word based. Rules out webhook approach for full channel coverage.
- Mattermost GET /channels/{id}/posts?since= — `since` is Unix milliseconds, confirmed via forum + GitHub API reference

### Tertiary (LOW confidence — verified by cross-reference but worth flagging)
- [GitHub mattermost/mattermost#13846](https://github.com/mattermost/mattermost/issues/13846) — `since` param can miss posts under high load. Mitigation documented above.
- llama-3.3-70b-instruct-fp8-fast fallback: confirmed available but `response_format` JSON schema NOT documented for this model.

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all verified via direct code read + Cloudflare official docs
- Architecture (storage, alarm, ingest): HIGH — DO alarm pattern verified via official docs; EmployeeMailboxDO extension is the only sound approach given existing code structure
- Mattermost ingest: MEDIUM — API shape verified; bot account permission model verified; `since` edge case documented
- Ranking formula: MEDIUM — the SQL is sound; LLM urgency scoring quality depends on prompt engineering (unknowable until tested)
- Voice stub architecture: HIGH for package names (@cloudflare/voice, withVoice, agents); LOW for Telnyx specifically (no dedicated CF package confirmed)

**Research date:** 2026-05-18
**Valid until:** 2026-06-18 (kimi-k2.6 is new; Cloudflare voice SDK is evolving — re-verify if >30 days pass before Phase 12 starts)
