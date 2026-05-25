# Phase 28: Startup MCP Server + Channel-Adapter Core — Research

**Researched:** 2026-05-24
**Domain:** MCP protocol, Cloudflare Workers McpAgent/createMcpHandler, per-startup bearer auth, pgvector hybrid search, channel-adapter schema
**Confidence:** HIGH on library choice + protocol spec; MEDIUM on Stainless discover_actions shape; HIGH on auth + SQL patterns

---

## Summary

Phase 28 ships a new `apps/startup-mcp/` Cloudflare Worker at `mcp.internjobs.ai`. The right library choice is `createMcpHandler` from the `agents` package (same package already in `apps/agentic-inbox/`) — stateless, no DO required for a 4-tool surface, fresh server per request eliminates cross-client leaks (critical security note from SDK 1.26.0). The existing `apps/agentic-inbox/workers/mcp/index.ts` + `app.ts` mounting pattern is the exact template to mirror — including `McpAgent`-via-Hono and `EmailMCP.serve("/mcp", { binding })`. Auth is `Authorization: Bearer <token>` header only (not URL path); CF Workers has `crypto.subtle.timingSafeEqual` for constant-time comparison. Token stored hashed (SHA-256) in `startups` table. Streamable HTTP is the current MCP transport standard (SSE deprecated March 2025). For `discover_actions`, implement it as a standard MCP tool (not a protocol feature) returning an array of `{name, description, inputSchema, examples}` objects — Stainless' `list_api_endpoints` shape is the training-data match.

**Primary recommendation:** Use `createMcpHandler` (stateless, simpler) for Phase 28's 4-tool surface. Wrap it in a Hono app that validates the `Authorization: Bearer` header before calling the handler — put auth in Hono middleware, pass startup context via `authContext.props`. Use the identical Hono mounting pattern from `apps/agentic-inbox/workers/app.ts`.

---

## Library Choice (MCP on CF Workers)

### Decision: `createMcpHandler` from `agents` package

| Option | Verdict | Reason |
|--------|---------|--------|
| `createMcpHandler` from `agents` | **USE THIS** | Stateless, no DO, fresh per request (eliminates cross-client leaks), simpler wrangler, already in agentic-inbox |
| `McpAgent` from `agents` | Skip for Phase 28 | Needs DO binding + migrations; worth it only if per-session state is needed (it isn't for startup-mcp) |
| `workers-mcp` (Cloudflare's own) | Skip | Older, pre-`agents` SDK; less maintained, different API surface |
| Raw `@modelcontextprotocol/sdk` server | Skip | More boilerplate; `agents` wraps this correctly already |

**Package:** `agents` (already in monorepo via `apps/agentic-inbox`)
**Also required:** `@modelcontextprotocol/sdk` (peer dep, already present)
**Also required:** `zod` (already in monorepo via `apps/parrot`)

```bash
# In apps/startup-mcp — these are already in the monorepo root package-lock.json
npm install agents @modelcontextprotocol/sdk zod hono
```

**Critical security note (SDK 1.26.0+):** Create a **new** `McpServer` per request, not a module-level singleton. Shared instances across requests cause cross-client data leaks. The `createMcpHandler` approach enforces this naturally when you do `createMcpHandler(createServer())` inside the fetch handler.

**Source:** [Cloudflare Agents docs — createMcpHandler API](https://developers.cloudflare.com/agents/api-reference/mcp-handler-api/) | [Build a Remote MCP server](https://developers.cloudflare.com/agents/guides/remote-mcp-server/)

---

## Server Scaffold Pattern

This is the `apps/startup-mcp/workers/server.ts` starting point (~75 LOC). It mirrors `apps/agentic-inbox/workers/mcp/index.ts` and `app.ts` patterns exactly.

```typescript
// apps/startup-mcp/workers/server.ts
// Startup MCP Server — 4-tool surface (me, discover_actions, search, execute)
// Auth: per-startup Bearer token, validated before McpServer is created.
// Transport: Streamable HTTP (current MCP standard as of March 2025; SSE deprecated).

import { createMcpHandler, getMcpAuthContext } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Env } from "./types";
import type { StartupContext } from "./types";
import { handleMe } from "./tools/me";
import { handleDiscoverActions } from "./tools/discover-actions";
import { handleSearch } from "./tools/search";
import { handleExecute } from "./tools/execute";

/** Wrap a plain result as MCP tool output. */
export function mcpText(result: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
}

/** Wrap an error as MCP tool output (isError signals tool-level failure, NOT protocol error). */
export function mcpError(message: string, code?: string) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify({ error: message, code }) }],
    isError: true as const,
  };
}

/** Create a fresh McpServer for each request (required by SDK 1.26.0+ to prevent cross-client leaks). */
export function createStartupMcpServer() {
  const server = new McpServer({
    name: "internjobs-startup",
    version: "1.0.0",
  });

  // ── me ────────────────────────────────────────────────────────────────────
  server.tool(
    "me",
    "Returns the authenticated startup's identity: name, member info, active role count, and recent activity summary.",
    {},
    async () => {
      const ctx = getMcpAuthContext<StartupContext>();
      if (!ctx) return mcpError("not authenticated");
      return mcpText(await handleMe(ctx.props));
    },
  );

  // ── discover_actions ──────────────────────────────────────────────────────
  server.tool(
    "discover_actions",
    "Lists all available write actions with their JSON input schemas and descriptions. Call this before execute() to understand what actions are available and what parameters they require.",
    {},
    async () => {
      return mcpText(handleDiscoverActions());
    },
  );

  // ── search ────────────────────────────────────────────────────────────────
  server.tool(
    "search",
    "Semantic + structured search. scope must be one of: roles | candidates | threads | messages | members | startups. Returns a list of {id, summary, score} objects. Use IDs to fetch full records via execute().",
    {
      scope: z.enum(["roles", "candidates", "threads", "messages", "members", "startups"]).describe("What to search"),
      query: z.string().describe("Natural language search query"),
      filters: z.record(z.unknown()).optional().describe("Structured filters e.g. {role_id: 'uuid', status: 'active'}"),
      limit: z.number().int().min(1).max(20).default(10).describe("Max results (1–20, default 10)"),
    },
    async ({ scope, query, filters, limit }) => {
      const ctx = getMcpAuthContext<StartupContext>();
      if (!ctx) return mcpError("not authenticated");
      return mcpText(await handleSearch({ startup_id: ctx.props.startup_id, scope, query, filters, limit }));
    },
  );

  // ── execute ───────────────────────────────────────────────────────────────
  server.tool(
    "execute",
    "Execute a write action. action must be one of: post_role | reply_to_candidate | update_role | archive_role | mark_candidate. Call discover_actions() first to see parameter schemas.",
    {
      action: z.enum(["post_role", "reply_to_candidate", "update_role", "archive_role", "mark_candidate"]).describe("Action to execute"),
      params: z.record(z.unknown()).describe("Action-specific parameters (see discover_actions for schemas)"),
    },
    async ({ action, params }) => {
      const ctx = getMcpAuthContext<StartupContext>();
      if (!ctx) return mcpError("not authenticated");
      return mcpText(await handleExecute({ startup_id: ctx.props.startup_id, member_id: ctx.props.member_id, action, params, env: ctx.props.env }));
    },
  );

  return server;
}
```

**Hono mounting in `apps/startup-mcp/workers/app.ts`:**

```typescript
import { Hono } from "hono";
import { cors } from "hono/cors";
import { createMcpHandler } from "agents/mcp";
import { createStartupMcpServer } from "./server";
import { validateBearerToken } from "./lib/auth";
import type { Env } from "./types";

const app = new Hono<{ Bindings: Env }>();

// CORS: MCP clients are desktop apps, not browsers — CORS is for Cursor's browser-based webview.
app.use("/mcp", cors({ origin: "*", allowMethods: ["GET", "POST", "OPTIONS"] }));
app.use("/mcp/*", cors({ origin: "*", allowMethods: ["GET", "POST", "OPTIONS"] }));

// Auth middleware — runs before createMcpHandler.
app.use("/mcp", async (c, next) => {
  const token = c.req.header("Authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return c.json({ error: "missing_bearer_token" }, 401);
  const ctx = await validateBearerToken(token, c.env);
  if (!ctx) return c.json({ error: "invalid_token" }, 401);
  c.set("startupCtx", ctx);
  return next();
});
app.use("/mcp/*", async (c, next) => {
  // Same middleware — Streamable HTTP may POST to /mcp/messages or similar subpaths.
  const token = c.req.header("Authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return c.json({ error: "missing_bearer_token" }, 401);
  const ctx = await validateBearerToken(token, c.env);
  if (!ctx) return c.json({ error: "invalid_token" }, 401);
  c.set("startupCtx", ctx);
  return next();
});

// MCP handler — new server per request, auth context injected via props.
const mcpHandler = (env: Env, startupCtx: StartupContext) =>
  createMcpHandler(createStartupMcpServer(), {
    authContext: { props: { ...startupCtx, env } },
  });

app.all("/mcp", async (c) => {
  const startupCtx = c.get("startupCtx");
  return mcpHandler(c.env, startupCtx)(c.req.raw, c.env, c.executionCtx as ExecutionContext);
});
app.all("/mcp/*", async (c) => {
  const startupCtx = c.get("startupCtx");
  return mcpHandler(c.env, startupCtx)(c.req.raw, c.env, c.executionCtx as ExecutionContext);
});

export default { fetch: app.fetch };
```

**Why `/mcp` AND `/mcp/*`:** Streamable HTTP uses `POST /mcp` for request/response. Some clients post to `/mcp/messages` or similar subpaths. The agentic-inbox pattern mounts both — mirror it exactly.

---

## Auth Pattern (Per-Startup Bearer Token)

### Token placement

**Use `Authorization: Bearer <token>` header — NOT a URL path segment.**

The MCP spec and all current clients (Claude Code, Claude Desktop, Cursor, Cline, ChatGPT) support the `Authorization: Bearer` header for HTTP transport. Placing the token in the URL path (`mcp.internjobs.ai/{token}/mcp`) is tempting for SMS install-snippet simplicity but creates serious problems:
- Token leaks in access logs, Cloudflare analytics, referrer headers
- MCP spec (2025-06-18) does not define URL-path-token routing — clients won't know to send it
- Claude Code install command with a header token: `claude mcp add --transport http internjobs https://mcp.internjobs.ai/mcp --header "Authorization: Bearer {token}"` — this is the correct install snippet format

**Install snippets to SMS to founders:**
```bash
# Claude Code / Claude Desktop
claude mcp add --transport http internjobs https://mcp.internjobs.ai/mcp --header "Authorization: Bearer {TOKEN}"

# Cursor / Cline — .mcp.json format
{
  "mcpServers": {
    "internjobs": {
      "type": "http",
      "url": "https://mcp.internjobs.ai/mcp",
      "headers": { "Authorization": "Bearer {TOKEN}" }
    }
  }
}

# ChatGPT (GPT-5 MCP) — uses the same Streamable HTTP format
# Point to https://mcp.internjobs.ai/mcp with Authorization header via GPT custom actions or MCP connector UI
```

### Token storage (hashed)

Add columns to `startups` table in migration `0011_v1_4_startup_mcp.sql`:

```sql
ALTER TABLE startups
  ADD COLUMN mcp_token_hash  text unique,   -- SHA-256 hex of the raw token; never store plaintext
  ADD COLUMN mcp_token_issued_at timestamptz,
  ADD COLUMN mcp_token_rotated_at timestamptz;
```

Token issuance flow:
1. Generate 32 random bytes → hex string (64 chars) — this is the install token
2. `crypto.subtle.digest("SHA-256", token_bytes)` → hex → store as `mcp_token_hash`
3. Return raw token once (SMS to founder); never log it

### Constant-time comparison in CF Workers

The student app uses `timingSafeEqual` from `node:crypto` (Node runtime). The CF Worker runtime has `crypto.subtle.timingSafeEqual` instead. Use this pattern:

```typescript
// apps/startup-mcp/workers/lib/auth.ts
async function safeTokenEqual(candidate: string, stored: string): Promise<boolean> {
  const enc = new TextEncoder();
  const a = enc.encode(candidate);
  const b = enc.encode(stored);
  // Don't early-return on length mismatch — compare against itself to maintain constant time.
  const lengthsMatch = a.byteLength === b.byteLength;
  return lengthsMatch
    ? crypto.subtle.timingSafeEqual(a, b)
    : !crypto.subtle.timingSafeEqual(a, a);
}

export async function validateBearerToken(rawToken: string, env: Env): Promise<StartupContext | null> {
  // Hash the incoming token and look up in DB.
  const hash = await hashToken(rawToken);           // SHA-256 hex
  const row = await lookupByTokenHash(hash, env);   // SELECT startup + member WHERE mcp_token_hash = $1
  if (!row) return null;
  // Double-check hash match with constant-time compare (defense in depth).
  const match = await safeTokenEqual(hash, row.mcp_token_hash);
  if (!match) return null;
  return { startup_id: row.startup_id, member_id: row.member_id, startup_name: row.startup_name };
}
```

Source: [CF Workers timingSafeEqual docs](https://developers.cloudflare.com/workers/examples/protect-against-timing-attacks/)

### Rate limiting (per-token)

Use CF Workers **Rate Limiting API** (built-in, no KV needed, free tier: 1M requests/month):

```typescript
// In wrangler.jsonc:
// "rate_limiting": [{ "binding": "STARTUP_RATE_LIMIT", "namespace_id": "1" }]

// In auth middleware:
const { success } = await env.STARTUP_RATE_LIMIT.limit({ key: startup_id });
if (!success) return c.json({ error: "rate_limit_exceeded" }, 429);
```

Alternatively: CF Workers KV sliding-window counter (more code, less preferred):
- Key: `rl:${token_hash}:${Math.floor(Date.now() / 60000)}` (per-minute bucket)
- Value: atomic increment via KV `{ expirationTtl: 120 }` (2-minute TTL for cleanup)

Recommendation: Use CF Rate Limiting API (native, zero extra cost, no KV reads). Set 100 req/min per startup_id. If Rate Limiting API is not yet in the project's account, use KV with minute-bucket sliding window as fallback.

---

## Action Enum + Per-Action Authz Pattern + Schema Validation

### Schema validation library

**Use Zod** (`zod^3.25.76` already in `apps/parrot` and `apps/agentic-inbox`). Zod runs cleanly on CF Workers runtime. Do NOT use AJV (heavy, requires additional JSON Schema compile step). Zod schemas double as TypeScript types.

### Action handler pattern

```typescript
// apps/startup-mcp/workers/tools/execute.ts
import { z } from "zod";
import { mcpError } from "../server";
import { writeAuditLog } from "../lib/audit";

// ── Action schemas ────────────────────────────────────────────────────────────
const POST_ROLE_SCHEMA = z.object({
  title: z.string().min(1).max(200),
  description: z.string().min(1),
  requirements: z.string().optional().default(""),
  location: z.string().optional(),
  comp_range: z.string().optional(),
});

const REPLY_TO_CANDIDATE_SCHEMA = z.object({
  thread_id: z.string().uuid(),
  message: z.string().min(1).max(2000),
});

const UPDATE_ROLE_SCHEMA = z.object({
  role_id: z.string().uuid(),
  patch: z.object({
    title: z.string().optional(),
    description: z.string().optional(),
    status: z.enum(["active", "paused", "filled"]).optional(),
    location: z.string().optional(),
    comp_range: z.string().optional(),
  }),
});

const ARCHIVE_ROLE_SCHEMA = z.object({
  role_id: z.string().uuid(),
});

const MARK_CANDIDATE_SCHEMA = z.object({
  thread_id: z.string().uuid(),
  mark: z.enum(["interested", "not_interested", "shortlisted", "rejected"]),
});

// ── Action dispatch table ─────────────────────────────────────────────────────
const ACTION_HANDLERS = {
  post_role:          { schema: POST_ROLE_SCHEMA,          handler: handlePostRole,         required_role: null },
  reply_to_candidate: { schema: REPLY_TO_CANDIDATE_SCHEMA, handler: handleReplyToCandidate, required_role: null },
  update_role:        { schema: UPDATE_ROLE_SCHEMA,         handler: handleUpdateRole,       required_role: null },
  archive_role:       { schema: ARCHIVE_ROLE_SCHEMA,        handler: handleArchiveRole,      required_role: null },
  mark_candidate:     { schema: MARK_CANDIDATE_SCHEMA,      handler: handleMarkCandidate,    required_role: null },
} as const;

export async function handleExecute({ startup_id, member_id, action, params, env }) {
  const entry = ACTION_HANDLERS[action];
  // 1. Schema validation (Zod parse — rejects unknown fields too)
  const parsed = entry.schema.safeParse(params);
  if (!parsed.success) {
    return { ok: false, error: "invalid_params", details: parsed.error.flatten() };
  }
  // 2. Ownership authz — all actions scoped to startup_id from the auth token
  // (cross-startup leak is impossible because startup_id comes from the validated token,
  // not from the params. Handlers receive startup_id explicitly, never trust params.startup_id.)
  const t0 = Date.now();
  let status: "ok" | "error" = "ok";
  let result;
  try {
    result = await entry.handler({ startup_id, member_id, params: parsed.data, env });
    return { ok: true, data: result };
  } catch (err) {
    status = "error";
    throw err;
  } finally {
    // 3. Audit log — written regardless of success/failure
    await writeAuditLog({ member_id, startup_id, channel: "mcp", action, params_hash: hashParams(params), status, latency_ms: Date.now() - t0 });
  }
}
```

### Post-role handler example

```typescript
async function handlePostRole({ startup_id, member_id, params, env }) {
  // 1. Insert role row
  const { rows } = await env.DB.query(
    `INSERT INTO roles (startup_id, title, description, requirements, location, comp_range)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, title, status, created_at`,
    [startup_id, params.title, params.description, params.requirements, params.location, params.comp_range]
  );
  const role = rows[0];
  // 2. Semantic index role description via Workers AI embeddings → pgvector
  // (same embeddings.mjs pattern from apps/app/src/embeddings.mjs, ported to Worker)
  const embedding = await embedText(params.description + " " + params.requirements, env);
  await env.DB.query(
    `UPDATE roles SET embedding = $1 WHERE id = $2`,
    [JSON.stringify(embedding), role.id]
  );
  return { role_id: role.id, title: role.title, status: role.status, created_at: role.created_at };
}
```

### Audit log fields (from good audit systems)

```
startup_action_log(
  id            uuid primary key default gen_random_uuid(),
  member_id     uuid not null references startup_members(id),
  startup_id    uuid not null references startups(id),
  channel       text not null,          -- 'mcp' | 'telnyx-sms' | 'telnyx-voice' | 'slack' | 'email'
  action        text not null,          -- action enum value
  params_hash   text,                   -- SHA-256 of JSON.stringify(params) — for audit, not replay
  status        text not null,          -- 'ok' | 'error'
  error_code    text,                   -- if status='error'
  latency_ms    int,
  ip_hash       text,                   -- optional: hashed request IP for fraud detection
  user_agent    text,                   -- optional: MCP client identifier
  created_at    timestamptz not null default now()
)
```

---

## search(scope, ...) Pattern (pgvector + Filters + Pagination)

### Hybrid query pattern

```sql
-- Example: search candidates for a startup with optional role_id filter
SELECT
  s.id,
  s.first_name || ' ' || s.last_name AS summary,
  s.major, s.graduation_year,
  sm.embedding <=> $1::vector AS score   -- cosine similarity (lower = more similar; negate for ranking)
FROM students s
JOIN student_threads st ON st.student_id = s.id
JOIN inbound_messages im ON im.thread_id = st.id
LEFT JOIN (
  SELECT student_id, embedding
  FROM student_profile_embeddings
) sm ON sm.student_id = s.id
WHERE
  im.startup_id = $2                      -- ownership boundary (always filter by startup_id)
  AND ($3::uuid IS NULL OR im.role_id = $3)  -- optional role_id filter
  AND ($4::text IS NULL OR s.status = $4)    -- optional status filter
ORDER BY sm.embedding <=> $1::vector        -- cosine distance ASC = most similar first
LIMIT $5;                                   -- max 20 for MCP output size
```

For structured-only queries (no semantic content), use a threshold-only filter:
```sql
WHERE sm.embedding <=> $1::vector < 0.7   -- similarity threshold (tune empirically)
```

### Key decisions

- **Return IDs + summaries, NOT full records.** MCP tool output has a 25k token default cap in Claude Code; full records for 10+ candidates blow past it. Summaries with IDs let the LLM follow up with a specific execute() for the full record.
- **Limit 1–20, default 10.** Matches agentic-inbox's `list_emails` default. MCP clients warn at 10k tokens; 10 summaries is safe.
- **Pagination via cursor, not offset.** Offset pagination with ORDER BY embedding distance is inconsistent when vectors change. Use `LIMIT + created_at < $cursor` for stable pagination.
- **Score field in result:** Include `score: 1 - cosine_distance` (0–1, 1=perfect match) so LLMs can reason about relevance.

### Result envelope

```json
{
  "scope": "candidates",
  "query": "frontend interns with React experience",
  "filters": { "role_id": "..." },
  "results": [
    { "id": "uuid", "summary": "Priya K. — CS junior, React + TypeScript, GPA 3.8", "score": 0.91 },
    { "id": "uuid", "summary": "Marcus W. — Design + frontend, Figma + Next.js", "score": 0.84 }
  ],
  "total_returned": 2,
  "next_cursor": null
}
```

Source: [pgvector filtered semantic search pattern (Timescale/Medium)](https://medium.com/timescale/implementing-filtered-semantic-search-using-pgvector-and-javascript-7c6eb4894c36)

---

## Custom Domain Wiring (`mcp.internjobs.ai`)

### wrangler.jsonc pattern

Mirror the parrot worker's custom domain pattern exactly (already established in `apps/parrot/wrangler.jsonc`):

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "internjobs-startup-mcp",
  "compatibility_date": "2025-11-28",
  "compatibility_flags": ["nodejs_compat"],
  "main": "./workers/app.ts",
  "observability": { "enabled": true },
  "routes": [
    {
      "pattern": "mcp.internjobs.ai",
      "custom_domain": true
    }
  ],
  "vars": {
    "STUDENT_API_URL": "https://app.internjobs.ai"
  }
  // Secrets (set via `wrangler secret put`):
  //   STARTUP_MCP_ADMIN_SECRET  — Ridhi's admin endpoint auth (long random string)
  //   STUDENT_API_SECRET        — Bearer secret for student app /internal/* (same as Parrot's)
  //   TELNYX_API_KEY            — Phase 29 only; add then
}
```

**Custom domain vs. Workers route:** Use `"custom_domain": true` (not a plain route). This is what the parrot worker uses at `workspace.internjobs.ai` and it auto-provisions the SSL cert + DNS record via Cloudflare. No separate DNS record creation needed. The internjobs.ai zone is already on Cloudflare (marketing + parrot + mattermost-proxy are all there).

**HTTPS-only:** Cloudflare enforces HTTPS on custom domains by default. No extra configuration needed.

**CORS:** MCP desktop clients (Claude Desktop, Cursor) don't send browser CORS preflight. Cursor's webview might. Add permissive CORS for `/mcp` and `/mcp/*` in Hono middleware (see scaffold above).

Source: [CF Workers Custom Domains docs](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)

---

## startup_channel_links + startup_action_log SQL Migrations

**Migration file:** `apps/app/db/migrations/0011_v1_4_startup_mcp.sql`

```sql
-- migration: 0011_v1_4_startup_mcp
-- description: MCP token, channel-adapter, and action audit schema for Phase 28

-- ─── MCP token columns on startups ───────────────────────────────────────────

ALTER TABLE startups
  ADD COLUMN IF NOT EXISTS mcp_token_hash     text unique,
  ADD COLUMN IF NOT EXISTS mcp_token_issued_at  timestamptz,
  ADD COLUMN IF NOT EXISTS mcp_token_rotated_at timestamptz;

CREATE INDEX IF NOT EXISTS startups_mcp_token_hash_idx ON startups(mcp_token_hash)
  WHERE mcp_token_hash IS NOT NULL;

-- ─── Channel links (adapter table for future Phase 29 + v1.5 channels) ────────

CREATE TABLE IF NOT EXISTS startup_channel_links (
  id                 uuid primary key default gen_random_uuid(),
  startup_id         uuid not null references startups(id) on delete cascade,
  member_id          uuid references startup_members(id) on delete set null,
  -- channel_type values: 'mcp' | 'telnyx-sms' | 'telnyx-voice' | 'slack' | 'discord' | 'teams' | 'email'
  channel_type       text not null,
  -- channel_external_id: for mcp = startup_id (one row per startup);
  -- for telnyx-sms = E.164 phone number; for slack = workspace_id:channel_id
  channel_external_id text not null,
  status             text not null default 'active',  -- 'active' | 'paused' | 'opted_out'
  opt_in_flags       jsonb not null default '{}',     -- e.g. {"weekly_touchbase": true}
  metadata           jsonb not null default '{}',     -- channel-specific extras (e.g. slack workspace name)
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  -- one link per (startup, channel_type, external_id) — prevents duplicates on reconnect
  UNIQUE (startup_id, channel_type, channel_external_id)
);

CREATE INDEX IF NOT EXISTS startup_channel_links_startup_idx
  ON startup_channel_links(startup_id);

CREATE INDEX IF NOT EXISTS startup_channel_links_lookup_idx
  ON startup_channel_links(channel_type, channel_external_id)
  WHERE status = 'active';

-- ─── Action audit log ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS startup_action_log (
  id            uuid primary key default gen_random_uuid(),
  member_id     uuid references startup_members(id) on delete set null,
  startup_id    uuid not null references startups(id) on delete cascade,
  channel       text not null,          -- 'mcp' | 'telnyx-sms' | 'telnyx-voice' | 'slack' | ...
  action        text not null,          -- action enum: 'post_role' | 'reply_to_candidate' | ...
  params_hash   text,                   -- SHA-256 hex of JSON.stringify(params) for audit trail
  status        text not null,          -- 'ok' | 'error'
  error_code    text,                   -- populated when status='error'
  latency_ms    int,
  ip_hash       text,                   -- SHA-256 of request IP (for rate-abuse investigation)
  user_agent    text,                   -- MCP client user-agent string
  created_at    timestamptz not null default now()
);

CREATE INDEX IF NOT EXISTS startup_action_log_startup_idx
  ON startup_action_log(startup_id, created_at DESC);

CREATE INDEX IF NOT EXISTS startup_action_log_member_idx
  ON startup_action_log(member_id, created_at DESC);
```

### Identity resolution pattern (for Phase 29 Telnyx adapter)

```sql
-- Given (channel_type='telnyx-sms', channel_external_id='+15551234567'), resolve startup + member
SELECT
  scl.startup_id,
  scl.member_id,
  s.name AS startup_name,
  sm.name AS member_name
FROM startup_channel_links scl
JOIN startups s ON s.id = scl.startup_id
LEFT JOIN startup_members sm ON sm.id = scl.member_id
WHERE scl.channel_type = $1
  AND scl.channel_external_id = $2
  AND scl.status = 'active'
LIMIT 1;
```

**Race-condition safety:** The `UNIQUE (startup_id, channel_type, channel_external_id)` constraint makes `INSERT ... ON CONFLICT DO NOTHING` safe for concurrent channel registrations. No application-layer lock needed.

---

## Stainless `discover_actions` JSON Shape to Mirror

Stainless' `list_api_endpoints` tool (used internally by their dynamic-tools mode) returns endpoint entries. The documented shape from their changelog is sparse but the LLM training distribution matches this format:

```json
[
  {
    "name": "post_role",
    "description": "Create a new internship role for your startup. The role will be semantically indexed for candidate matching.",
    "input_schema": {
      "type": "object",
      "properties": {
        "title":        { "type": "string", "description": "Role title, e.g. 'Frontend Engineering Intern'" },
        "description":  { "type": "string", "description": "Full role description and what the intern will work on" },
        "requirements": { "type": "string", "description": "Skills and qualifications required" },
        "location":     { "type": "string", "description": "Location or 'Remote'" },
        "comp_range":   { "type": "string", "description": "Compensation e.g. '$20–25/hr'" }
      },
      "required": ["title", "description"]
    },
    "examples": [
      { "title": "Frontend Engineering Intern", "description": "Build the core product UI using React and TypeScript", "requirements": "React, TypeScript, 1+ year experience", "location": "San Francisco or Remote" }
    ],
    "error_codes": [
      { "code": "invalid_params", "description": "Missing required field or type mismatch" },
      { "code": "startup_not_active", "description": "Your startup account is paused" }
    ]
  }
]
```

**Confidence:** MEDIUM — Stainless does not publish the exact wire format of `list_api_endpoints` output. The shape above is reconstructed from: (a) their changelog description ("discovers available endpoints with optional filtering by search query"), (b) Anthropic/OpenAI MCP training data conventions, and (c) the MCP tool definition spec's `inputSchema` field format. The LLM (Claude, GPT-5) will be able to use this regardless of exact field names because it understands JSON Schema natively — but mirroring the `input_schema` (snake_case) rather than `inputSchema` (camelCase) field name is the Stainless convention and matches their OpenAPI-derived output.

**`discover_actions` implementation:**

```typescript
// apps/startup-mcp/workers/tools/discover-actions.ts
export function handleDiscoverActions() {
  return [
    {
      name: "post_role",
      description: "Create a new internship role for your startup. Semantically indexed for candidate matching.",
      input_schema: {
        type: "object",
        properties: {
          title:       { type: "string", description: "Role title" },
          description: { type: "string", description: "Full role description" },
          requirements:{ type: "string", description: "Required skills/qualifications" },
          location:    { type: "string", description: "Location or 'Remote'" },
          comp_range:  { type: "string", description: "Compensation range e.g. '$20–25/hr'" },
        },
        required: ["title", "description"],
      },
      examples: [{ title: "Frontend Engineering Intern", description: "Build core product UI", location: "Remote" }],
    },
    {
      name: "reply_to_candidate",
      description: "Send a reply to a candidate in an existing conversation thread. Channel-agnostic: the message routes via the same channel the candidate used.",
      input_schema: {
        type: "object",
        properties: {
          thread_id: { type: "string", format: "uuid", description: "Thread ID from search('threads') or search('candidates')" },
          message:   { type: "string", description: "Your reply message (max 2000 chars)" },
        },
        required: ["thread_id", "message"],
      },
    },
    {
      name: "update_role",
      description: "Update an existing role's fields.",
      input_schema: {
        type: "object",
        properties: {
          role_id: { type: "string", format: "uuid" },
          patch: {
            type: "object",
            properties: {
              title:       { type: "string" },
              description: { type: "string" },
              status:      { type: "string", enum: ["active", "paused", "filled"] },
              location:    { type: "string" },
              comp_range:  { type: "string" },
            },
          },
        },
        required: ["role_id", "patch"],
      },
    },
    {
      name: "archive_role",
      description: "Archive a role (sets status to 'filled'). Candidates stop being matched to this role.",
      input_schema: {
        type: "object",
        properties: { role_id: { type: "string", format: "uuid" } },
        required: ["role_id"],
      },
    },
    {
      name: "mark_candidate",
      description: "Mark your interest level on a candidate thread.",
      input_schema: {
        type: "object",
        properties: {
          thread_id: { type: "string", format: "uuid" },
          mark: { type: "string", enum: ["interested", "not_interested", "shortlisted", "rejected"] },
        },
        required: ["thread_id", "mark"],
      },
    },
  ];
}
```

---

## MCP Client Quirks (Claude Desktop / Cursor / ChatGPT / Cline)

**Source:** [Claude Code MCP docs](https://code.claude.com/docs/en/mcp) (fetched 2026-05-24, authoritative)

### Claude Code / Claude Desktop

- Install command: `claude mcp add --transport http internjobs https://mcp.internjobs.ai/mcp --header "Authorization: Bearer {TOKEN}"`
- Stores in `~/.claude.json` under the project's path (local scope by default)
- The name `workspace` is **reserved** — do not use `internjobs` → `workspace` as an alias. Use `internjobs` as the server name.
- Tool output warning at 10k tokens, hard cap at 25k tokens (`MAX_MCP_OUTPUT_TOKENS`). Keep search results under 5k tokens (10 summaries is safe).
- **Tool Search (default on):** Claude Code defers loading tool schemas until needed. Server-level instructions (in `McpServer` `instructions` field) are key for routing. Add instructions like: `"internjobs — startup hiring tools. Use these to post roles, search candidates, and reply to candidates."` Keep under 2KB.
- **Dynamic tool updates:** Claude Code supports `list_changed` notifications — MCP server can push tool catalog changes without client restart.
- Streamable HTTP transport (`type: "http"` in `.mcp.json`) is the recommended path; SSE is deprecated.
- **Reconnect:** Claude Code auto-retries HTTP servers with exponential backoff (5 attempts, starts at 1s, doubles). Don't return 5xx during auth check — return 401 so the client fails fast (no retries on 401).

### Cursor

- `.mcp.json` format: `{ "mcpServers": { "internjobs": { "type": "http", "url": "...", "headers": { "Authorization": "Bearer {TOKEN}" } } } }`
- Uses `streamable-http` as an alias for `http` type (from Claude Code docs — same MCP JSON standard)
- Cursor displays tool names in a sidebar; keep names short and lowercase with underscores (`post_role` not `PostRole`)
- Tool output rendered as plain text in Cursor's chat; JSON is shown as code blocks. Return clean JSON, not HTML.

### ChatGPT (GPT-5)

- ChatGPT supports MCP via its "connector" feature (late 2025 rollout). Uses the same Streamable HTTP transport.
- ChatGPT's MCP UI requires the server to respond to `/.well-known/oauth-authorization-server` (it probes this on connect). Return a simple 404 or a response indicating no OAuth — ChatGPT falls back to header-auth when this endpoint returns 4xx.
- Alternatively: return a minimal OAuth metadata JSON that points nowhere, which tells ChatGPT "server has no OAuth" and it uses the configured headers.

### Cline (VSCode)

- Same `.mcp.json` format as Cursor
- Cline displays tool output inline in the chat. Markdown in the JSON string values IS rendered (Cline parses markdown inside tool result text).

### Common quirks across all clients

- **Tool name conflicts:** If a client has multiple MCP servers loaded, tool names must be globally unique or the client will prompt for disambiguation. Names like `search`, `execute`, `me` are generic — consider if the client has other servers with similar names. The `discover_actions` name is distinctive and unlikely to clash.
- **Schema validation by client:** Some clients (Claude Code) validate tool input against the declared Zod/JSON schema before sending. Others (ChatGPT) pass whatever the LLM inferred. Always validate server-side with Zod — don't trust client-side schema enforcement.
- **`isError: true` behavior:** Claude Code displays tool errors differently from successful results (shows a red/warning badge). Return `isError: true` for actual failures, not for "no results found" (which should be `{ results: [], total_returned: 0 }`).
- **Output format:** All clients render tool output as the text content of the MCP response. Plain JSON is universally compatible. Markdown in the string is rendered by Cline and Claude Desktop but treated as raw text by Cursor's inline display.

---

## Pitfalls to Avoid (CF Workers + MCP + Stainless Gotchas)

### Pitfall 1: Shared McpServer instance across requests
**What goes wrong:** Cross-client data leaks — one startup sees another's data mid-stream.
**Root cause:** Module-level `const server = new McpServer(...)` is shared across all Worker invocations in the same isolate.
**Fix:** Always `createStartupMcpServer()` inside the fetch handler or `createMcpHandler(createStartupMcpServer(), ...)`. Confirmed by SDK 1.26.0 security note.
**Warning sign:** Data shows up in wrong client's tool call; subtle and hard to reproduce.

### Pitfall 2: Token in URL path instead of Authorization header
**What goes wrong:** Token leaks in Cloudflare access logs, referrer headers, browser history if a client renders the URL. All current MCP clients (Claude Code, Cursor, ChatGPT) support `Authorization: Bearer` via header — use it.
**Root cause:** Confusing "install snippet simplicity" with "security correctness."
**Fix:** Use `--header "Authorization: Bearer {TOKEN}"` in the install snippet. Use Hono middleware to extract and validate the header.

### Pitfall 3: SSE transport (deprecated)
**What goes wrong:** SSE was deprecated in March 2025 by the MCP spec. Claude Code still supports it but shows it as "legacy." Future MCP client versions will drop SSE support.
**Fix:** Mount Streamable HTTP (`/mcp` + `/mcp/*`) only. The `createMcpHandler` function handles Streamable HTTP automatically. If a client specifically needs SSE (unlikely for Phase 28), add `serveSSE()` but don't default to it.

### Pitfall 4: Request body size limit (CF Workers: 100MB default)
**What goes wrong:** MCP JSON-RPC requests are tiny (< 1KB), so this isn't an issue in practice. However, if `execute('post_role', ...)` params include a large `description` (> 100KB), it hits Workers request limits.
**Fix:** Add Zod max-length validators on all text fields (`z.string().max(10000)`). The role description limit of 10k chars (≈ 10KB uncompressed) is well within CF Workers limits.

### Pitfall 5: SSE timeout on long-running execute() calls
**What goes wrong:** CF Workers have a 30-second CPU time limit and a 30-second wall-clock limit per request (subrequest timeout). A `execute('reply_to_candidate', ...)` that calls the student app's `/internal/*` API, embeds text, and writes to Postgres can hit 10–15 seconds total. If SSE is used, the stream may be cut before the response.
**Fix:** Use Streamable HTTP (not SSE). Streamable HTTP is request/response, not a long-lived stream — no timeout issue. Keep execute handlers under 10s by making internal calls parallel where possible.

### Pitfall 6: `execute()` with free-form action string (security)
**What goes wrong:** If `action` is `z.string()` instead of `z.enum([...])`, an attacker can pass arbitrary action names that bypass the dispatch table, potentially triggering unintended code paths or revealing error messages.
**Fix:** Use `z.enum(["post_role", "reply_to_candidate", ...])` — Zod will reject unknown action names before any dispatch happens. This is locked in the requirements (action ENUM).

### Pitfall 7: Cross-startup data leak via params.startup_id
**What goes wrong:** If an execute handler trusts `params.startup_id` from the request instead of `startup_id` from the auth token, an attacker with a valid token can post roles to another startup.
**Fix:** Every handler receives `startup_id` as a first-class argument from the auth context (`ctx.props.startup_id`), never from params. Zod schemas for all action params must NOT include a `startup_id` field — reject it if present.

### Pitfall 8: ChatGPT OAuth probe (401 vs 200 for /.well-known)
**What goes wrong:** ChatGPT's MCP connector probes `/.well-known/oauth-authorization-server` on connect. If your Worker returns 500 (unhandled route), ChatGPT may refuse to connect.
**Fix:** Add a route that returns 404 or a minimal `{ "issuer": "https://mcp.internjobs.ai", "error": "no_oauth" }` response. This tells ChatGPT the server doesn't support OAuth and it uses the configured header auth instead.

### Pitfall 9: Per-token rate limit vs per-startup rate limit
**What goes wrong:** One startup can provision multiple tokens (e.g., via rotation during a bug). If you rate-limit by token hash, old-token retries and new-token calls are counted separately, effectively doubling the limit during rotation.
**Fix:** Rate-limit by `startup_id` (from the validated auth context), not by `token_hash`. The `startup_id` is stable across token rotations.

### Pitfall 10: Tool name `me` conflicting with JavaScript reserved-ish names
**What goes wrong:** Not a runtime issue, but some TypeScript dispatch tables or switch statements may trip on `case "me":` if `action` type is inferred as string. Not a real issue with Zod enum, but worth noting.
**Fix:** The action enum starts at `post_role` (not `me`). The `me`, `discover_actions`, `search`, and `execute` are MCP tool names, not action enum values — keep them separate.

---

## Open Questions

### OQ-1: Does createMcpHandler support `instructions` field for Tool Search?

Claude Code's Tool Search feature uses per-server `instructions` to know when to search for tools. The `McpServer` constructor from `@modelcontextprotocol/sdk` has an `instructions` field in some versions but it's not confirmed whether `createMcpHandler` passes it through to the client during capability negotiation.

- What we know: The `McpServer` object has a `server.server.serverInfo` object where `instructions` may live.
- What's unclear: Whether `createMcpHandler` exposes an `instructions` parameter in its options.
- Recommendation: Add `instructions` to the `McpServer` constructor (`new McpServer({ name: "internjobs-startup", version: "1.0.0", instructions: "..." })`) and test whether Claude Code picks it up.

### OQ-2: How does the student app DB connection work from the startup-mcp Worker?

The startup-mcp Worker is a CF Worker and cannot directly connect to the Fly Postgres (`internjobs-student-db.internal:5432`). The established pattern (from Parrot Worker) is to call the student app's `/internal/*` Bearer API for reads and writes.

- What we know: `STUDENT_API_URL = "https://app.internjobs.ai"` + `STUDENT_API_SECRET` pattern is used in Parrot Worker for `safety_events` writes.
- What's unclear: The `/internal/*` API doesn't yet have endpoints for `startups`, `roles`, `startup_channel_links`, or `startup_action_log`. These need to be added to `apps/app/src/server.mjs` as part of Phase 28.
- Recommendation: Phase 28 plan 28-01 must include adding `/internal/startups/*` endpoints to the student app, mirroring the `/internal/safety-events` pattern. The startup-mcp Worker then calls these via Bearer auth. This is the only way CF Workers can write to Fly Postgres without a VPC (Workers VPC is v1.5 candidate).

### OQ-3: Embedding model for role semantic indexing

The student app uses `bge-base-en-v1.5` via Workers AI for pgvector embeddings (`apps/app/src/embeddings.mjs`). The startup-mcp Worker needs to embed role descriptions to power `search('candidates')`.

- What we know: Workers AI binding can be added to `apps/startup-mcp/wrangler.jsonc`.
- What's unclear: Whether to embed in the startup-mcp Worker directly (needs `ai` binding) or call the student app's `/internal/embed` endpoint (cleaner, one embedding source of truth).
- Recommendation: Add `/internal/embed` endpoint to student app and call it from startup-mcp Worker. Keeps the vector model source-of-truth in one place. If latency is unacceptable, add the `ai` binding to startup-mcp directly.

### OQ-4: Stainless exact `discover_actions` wire format

Stainless does not publish the wire format of `list_api_endpoints` output. The shape in this research is reconstructed from context.

- What we know: The Stainless pattern returns endpoint entries with name, description, and schema. The `input_schema` field (snake_case) matches their OpenAPI-derived convention.
- Recommendation: The reconstructed shape is close enough — LLMs don't require exact format matching, only semantic completeness. Implement as documented and iterate based on pilot founder feedback.

---

## Sources

### Primary (HIGH confidence)
- [Cloudflare Agents docs — createMcpHandler API](https://developers.cloudflare.com/agents/api-reference/mcp-handler-api/) — createMcpHandler signature, auth context, security note
- [Cloudflare Agents docs — Transport](https://developers.cloudflare.com/agents/model-context-protocol/transport/) — SSE deprecated, Streamable HTTP is current standard
- [MCP spec schema 2025-06-18](https://modelcontextprotocol.io/specification/2025-06-18/schema) — Tool definition, InitializeResult, CallToolResult, error envelopes
- [Claude Code MCP docs](https://code.claude.com/docs/en/mcp) — install commands, .mcp.json format, tool output limits, reserved names, SSE deprecated warning
- [CF Workers timingSafeEqual](https://developers.cloudflare.com/workers/examples/protect-against-timing-attacks/) — constant-time comparison pattern
- [CF Workers Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/) — `custom_domain: true` wrangler.jsonc pattern
- `apps/agentic-inbox/workers/mcp/index.ts` + `app.ts` — live McpAgent + createMcpHandler mounting pattern in this repo
- `apps/agentic-inbox/wrangler.jsonc` — EMAIL_MCP DO binding + migration tag pattern
- `apps/app/src/server.mjs` + `safeStringEqual` — Bearer auth + constant-time comparison pattern (Node runtime)
- `apps/app/db/migrations/0003_v1_2_startup_identity.sql` — existing startups/startup_members/roles schema

### Secondary (MEDIUM confidence)
- [pgvector filtered semantic search (Timescale)](https://medium.com/timescale/implementing-filtered-semantic-search-using-pgvector-and-javascript-7c6eb4894c36) — hybrid SQL query pattern
- [Stainless MCP dynamic tools changelog](https://www.stainless.com/changelog/mcp-dynamic-tools) — discover_actions / list_api_endpoints pattern (high-level only; exact wire format not published)
- [MCP Auth — bearer auth docs](https://mcp-auth.dev/docs/configure-server/bearer-auth) — custom verifier pattern

### Tertiary (LOW confidence)
- Stainless `list_api_endpoints` JSON shape — reconstructed from changelog description + MCP spec training data conventions; not directly documented by Stainless

---

## Metadata

**Confidence breakdown:**
- Library choice (createMcpHandler): HIGH — verified against live agentic-inbox code + CF docs
- Auth pattern (Bearer header, hashed storage, timingSafeEqual): HIGH — CF Workers docs + student app precedent
- MCP protocol (tool definition, error envelope, handshake): HIGH — official spec 2025-06-18
- discover_actions JSON shape: MEDIUM — Stainless shape reconstructed
- pgvector hybrid search SQL: MEDIUM — Timescale article + existing embeddings.mjs precedent
- Client quirks (Claude Code, Cursor): HIGH — official Claude Code docs fetched live
- ChatGPT MCP behavior: MEDIUM — from blog posts + ChatGPT MCP announcement; not first-party docs
- Channel-adapter SQL: HIGH — straightforward Postgres + based on existing schema patterns

**Research date:** 2026-05-24
**Valid until:** 2026-07-15 (MCP spec and Cloudflare Agents SDK move fast; re-verify transport recommendations and client install formats before Phase 28 execution if delayed beyond mid-July 2026)
