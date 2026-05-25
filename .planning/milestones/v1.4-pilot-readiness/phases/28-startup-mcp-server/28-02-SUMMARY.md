---
phase: 28-startup-mcp-server
plan: 02
subsystem: mcp
tags: [cloudflare-workers, mcp, hono, bearer-auth, sha256, agents-sdk, modelcontextprotocol-sdk, zod, streamable-http]

# Dependency graph
requires:
  - phase: 28-startup-mcp-server-01
    provides: "internjobs-startup-api Fly proxy at internjobs-startup-api.fly.dev — POST /v1/startups/token used by Worker auth middleware"
  - phase: 10-parrot-workspace
    provides: "apps/parrot/ Worker layout — wrangler.jsonc routes[]+custom_domain pattern this plan mirrors"
  - phase: agentic-inbox
    provides: "apps/agentic-inbox/workers/mcp/index.ts — McpServer + tool-registration scaffold pattern (we use createMcpHandler instead of McpAgent but the tool shape is identical)"
provides:
  - "internjobs-startup-mcp Cloudflare Worker — live at https://mcp.internjobs.ai/mcp (custom domain auto-provisioned via Workers routes[]+custom_domain)"
  - "4-tool MCP surface (me, discover_actions, search, execute) — me + discover_actions fully wired; search + execute return stable-shape placeholder stubs"
  - "Per-startup Bearer auth: SHA-256(raw_token) → POST /v1/startups/token against the Fly proxy; 401 on missing/invalid"
  - "Fresh McpServer per request via buildMcpHandler() — eliminates cross-client state leak (SDK 1.26.0+ requirement)"
  - "Worker compatibility_date=2025-11-28 + nodejs_compat — ready for Plans 28-03/28-04/28-05 to mount handlers"
affects:
  - 28-03-search-execute-impl
  - 28-04-admin-endpoint-onboarding
  - 28-05-marketing-mcp-page
  - 29-startup-telnyx-sms-voice

# Tech tracking
tech-stack:
  added:
    - "agents ^0.7.9 (Cloudflare's @cloudflare/agents — createMcpHandler + getMcpAuthContext)"
    - "@modelcontextprotocol/sdk 1.26.0 (PINNED EXACT — agents bundles this version transitively; ^1.26.0 would dedup to 1.29.0 + cause dual-package hazard)"
    - "hono ^4.7.11 (HTTP routing on Workers — same as parrot/agentic-inbox)"
    - "zod ^3.25.76 (MCP tool argument schemas)"
    - "@cloudflare/workers-types ^4.20251128.0 + wrangler ^4.74.0 + typescript ^5.8.3 (dev)"
  patterns:
    - "Stateless createMcpHandler() over McpAgent (DO-based) — 4-tool surface doesn't need per-session state; fresh server per request via buildMcpHandler() called inside the Hono route handler"
    - "Bearer-in-header-only — never in URL path (URL paths leak in logs, referrers, proxies)"
    - "SHA-256 token storage — Worker hashes incoming raw token before sending to proxy; raw token never logged"
    - "Stainless-style discover_actions returns input_schema in snake_case (matches OpenAPI training-data distribution for LLM tool selection)"

key-files:
  created:
    - "apps/startup/wrangler.jsonc — name=internjobs-startup-mcp, routes[]={pattern: mcp.internjobs.ai, custom_domain: true}"
    - "apps/startup/package.json + tsconfig.json + .gitignore"
    - "apps/startup/workers/app.ts (~110 LOC — Hono root, bearerAuth middleware, MCP route mounts, OAuth probe, /healthz)"
    - "apps/startup/workers/server.ts (~190 LOC — createStartupMcpServer + buildMcpHandler)"
    - "apps/startup/workers/types.ts (Env + StartupContext + StartupAuthProps)"
    - "apps/startup/workers/lib/auth.ts (~90 LOC — hashToken + validateBearerToken)"
    - "apps/startup/workers/tools/me.ts"
    - "apps/startup/workers/tools/discover-actions.ts (5 actions × input_schema)"
    - "apps/startup/workers/tools/search.ts (stable-shape placeholder stub)"
    - "apps/startup/workers/tools/execute.ts (stable-shape placeholder stub)"
  modified:
    - "package.json (root) — added !apps/startup to workspaces exclude list (matches parrot/agentic-inbox isolation pattern)"

key-decisions:
  - "createMcpHandler (stateless) over McpAgent (DO-backed): 4-tool surface doesn't need session state; fresh server per request via buildMcpHandler() inside the Hono /mcp handler eliminates cross-client leaks without DO migration overhead"
  - "@modelcontextprotocol/sdk pinned to EXACT 1.26.0 (not ^1.26.0): agents@0.7.9 pins 1.26.0 transitively; a caret range would resolve to 1.29.0 and create dual installs with separate type identities. Pin-exact lets npm dedup to one hoisted copy."
  - "Bearer-in-header-only design — getMcpAuthContext() doesn't take a generic, so readAuthProps() casts ctx.props to StartupAuthProps and validates startup_id/member_id/env are all present before downcasting"
  - "Per-startup rate limiting deferred: the plan calls for rate-limiting by startup_id, but for the Wave 2 scaffold the upstream Fly proxy serves as the natural per-request bottleneck (every MCP call hits POST /v1/startups/token). True token-bucket-per-startup in CF Workers requires a Durable Object or KV namespace — adding either expands scope. Tracked as a 28-03 candidate (after action-log + search hit the proxy enough that rate limits matter)."
  - "Custom domain via routes[]+custom_domain — Workers automatically created the DNS record + Cloudflare-managed SSL cert on first deploy. No separate DNS step needed. Pattern matches apps/parrot/wrangler.jsonc."
  - "ChatGPT OAuth probe path returns 404 JSON with {error: 'no_oauth', issuer: ...} — explicitly NOT 200 (would signal OAuth support + force RFC 8414 metadata). ChatGPT falls back cleanly to Bearer-header auth."

patterns-established:
  - "Stateless Workers MCP scaffold: Hono auth middleware → buildMcpHandler(env, startupCtx) per request → createStartupMcpServer() creates fresh McpServer + 4 tools → handler returns to Hono. Same pattern reusable for any future MCP surface on Workers."
  - "Type-safe auth-context cast helper: readAuthProps() in server.ts encapsulates the getMcpAuthContext() → StartupAuthProps cast (the agents SDK exports a non-generic getMcpAuthContext returning McpAuthContext | undefined with props as Record<string, unknown>; callers must cast)."
  - "Dual-package-hazard avoidance for MCP SDK on Workers: when consuming a wrapper package (agents) that bundles @modelcontextprotocol/sdk transitively, pin our own dep to EXACT version (1.26.0 not ^1.26.0) so npm dedups. Document the constraint inline in package.json comment if future maintainers loosen the pin."

# Metrics
duration: 6min
completed: 2026-05-25
---

# Phase 28 Plan 02: Startup MCP Worker Scaffold + 4-Tool Surface Summary

**Cloudflare Worker at `mcp.internjobs.ai` exposing the Stainless-style 4-tool MCP surface (me, discover_actions, search, execute) with per-startup Bearer auth via the 28-01 Fly proxy. me + discover_actions fully wired; search + execute return stable-shape stubs (Plan 28-03 fills).**

## Performance

- **Duration:** ~6 min
- **Started:** 2026-05-25T02:10:04Z
- **Completed:** 2026-05-25T02:16:12Z
- **Tasks:** 2 (scaffold + auth/server/tools + deploy + smoke verify)
- **Files modified:** 14 (12 created in apps/startup/ + 2 modified: root package.json, .gitignore)
- **Worker Version ID:** `07f2d90b-839e-4e94-8ee8-7509034b0cfc`
- **Deployed URL:** `https://mcp.internjobs.ai/mcp`

## Accomplishments

- **`apps/startup/` Cloudflare Worker app created** with wrangler.jsonc routing `mcp.internjobs.ai` to the Worker via Workers Custom Domain (auto-provisioned DNS + Cloudflare-managed SSL on first `wrangler deploy` — no separate DNS step required).
- **Auth middleware live**: every `/mcp` and `/mcp/*` request runs `validateBearerToken()` which SHA-256-hashes the raw Authorization header and POSTs the hash to the 28-01 Fly proxy at `/v1/startups/token`. Missing/invalid Bearer → 401 JSON. Verified via curl.
- **MCP handshake works end-to-end**: `POST /mcp` with valid Bearer returns `{"result":{"protocolVersion":"2025-06-18","capabilities":{"tools":{"listChanged":true}},"serverInfo":{"name":"internjobs-startup","version":"1.0.0"}}}` over Streamable HTTP (`text/event-stream`).
- **`tools/list` returns exactly 4 tools**: me, discover_actions, search, execute. Tool catalog is fixed (Stainless pattern — won't grow as action surface expands; new actions go inside `execute`'s action enum).
- **`me()` fully implemented**: returns `{startup: {id, name}, member: {id}, role_count: 0, recent_activity: <string>}` shape. `role_count` is a documented placeholder (always 0) — Plan 28-03 will add `GET /v1/startups/:id/stats` on the Fly proxy and wire it here.
- **`discover_actions()` fully implemented**: pure function returning 5 action objects with snake_case input_schema (Stainless OpenAPI convention): post_role, reply_to_candidate, update_role, archive_role, mark_candidate. Verified via real MCP `tools/call` against the throwaway smoke startup.
- **`search()` + `execute()` return stable-shape stubs**: `{ok: true, placeholder: true, ..., _note: "...Plan 28-03"}`. Plan 28-03 fills in the implementations without changing the response shape (so any Claude/ChatGPT/Cursor client that integrates today against the stubs continues to work).
- **McpServer is fresh-per-request**: `buildMcpHandler(c.env, startupCtx)` is called inside the `app.all("/mcp")` handler (not at module scope). Code-review verified; comments document the SDK 1.26.0+ security requirement. Eliminates cross-startup data leaks via shared server state.
- **ChatGPT OAuth probe handled**: `/.well-known/oauth-authorization-server` returns 404 JSON with `{error: "no_oauth", issuer: "https://mcp.internjobs.ai"}` so ChatGPT's MCP connector falls back cleanly to Bearer-header auth (not 500, not 200 — both would cause connector misbehavior).
- **Healthz live**: `https://mcp.internjobs.ai/healthz` → 200 `{"ok":true,"service":"internjobs-startup-mcp"}`.
- **Admin (`/admin/*`) + API (`/api/*`) stubs return 503 `{error: "not_yet_implemented"}`** — Plans 28-04 and 28-05 will mount real handlers without touching the MCP routes.
- **STARTUP_MCP_ADMIN_SECRET minted** via `openssl rand -hex 32`, stored at `/tmp/startup_mcp_admin_secret.txt`, uploaded to the Worker via `wrangler secret put STARTUP_MCP_ADMIN_SECRET`. Plan 28-04 will use it. **Infisical persistence is a follow-up** — see User Setup Required.

## Task Commits

Each task was committed atomically:

1. **Task 1: apps/startup/ scaffold — wrangler.jsonc + types + package.json + tsconfig** — `f471287` (chore)
2. **Task 2: Auth middleware + MCP server + 4 tools (me + discover_actions wired; search + execute stubs) + deploy + smoke verify** — `2ec06b6` (feat)

**Plan metadata (this SUMMARY + STATE.md update):** committed separately at plan close.

## Files Created/Modified

**Created (12 in apps/startup/):**

- `apps/startup/wrangler.jsonc` — Worker config; `name=internjobs-startup-mcp`, `compatibility_date=2025-11-28`, `compatibility_flags=["nodejs_compat"]`, `routes=[{pattern:"mcp.internjobs.ai", custom_domain:true}]`, `vars.STARTUP_API_URL` set, secrets documented inline.
- `apps/startup/package.json` — `agents ^0.7.9 + @modelcontextprotocol/sdk 1.26.0 (pinned exact) + hono ^4.7.11 + zod ^3.25.76`; dev: `wrangler ^4.74.0 + @cloudflare/workers-types ^4.20251128.0 + typescript ^5.8.3`.
- `apps/startup/tsconfig.json` — ES2022 + Bundler module resolution + strict + workers-types.
- `apps/startup/.gitignore` — node_modules, .dev.vars, .wrangler/, *.log, dist/.
- `apps/startup/package-lock.json` — npm-generated.
- `apps/startup/workers/types.ts` (~25 LOC) — Env + StartupContext + StartupAuthProps shapes.
- `apps/startup/workers/lib/auth.ts` (~90 LOC) — `hashToken()` SHA-256 → hex + `validateBearerToken()` POST-to-proxy.
- `apps/startup/workers/server.ts` (~190 LOC) — `mcpText` + `mcpError` helpers, `readAuthProps()` typed-cast, `createStartupMcpServer()` registers the 4 tools, `buildMcpHandler(env, startupCtx)` wraps `createMcpHandler` with `authContext.props`.
- `apps/startup/workers/app.ts` (~110 LOC) — Hono root, `bearerAuth` middleware on `/mcp` + `/mcp/*`, `app.all("/mcp")` + `app.all("/mcp/*")` call `buildMcpHandler()` fresh per request, OAuth probe 404, `/healthz`, 503 stubs for `/admin/*` + `/api/*`, root `/` returns service metadata JSON.
- `apps/startup/workers/tools/me.ts` (~35 LOC) — Returns the {startup, member, role_count, recent_activity} envelope.
- `apps/startup/workers/tools/discover-actions.ts` (~170 LOC) — 5 actions × snake_case input_schema (post_role, reply_to_candidate, update_role, archive_role, mark_candidate).
- `apps/startup/workers/tools/search.ts` (~40 LOC) — Stable-shape placeholder.
- `apps/startup/workers/tools/execute.ts` (~45 LOC) — Stable-shape placeholder.

**Modified (1):**

- `package.json` (root) — Added `!apps/startup` to `workspaces` exclude list. Matches the existing isolation pattern for `!apps/agentic-inbox` and `!apps/parrot` — keeps `apps/startup/`'s `npm install` self-contained instead of hoisting MCP SDK + agents into the monorepo root.

## Decisions Made

- **`createMcpHandler` (stateless) over `McpAgent` (DO-backed)**: the 4-tool surface doesn't need per-session state, and freshly building the server per request inside the Hono route handler eliminates cross-client leaks without the operational overhead of adding a Durable Object + migration. `apps/agentic-inbox/` uses `McpAgent` because it has per-mailbox state; this Worker has none.
- **`@modelcontextprotocol/sdk` pinned to EXACT `1.26.0`** (not `^1.26.0`): the `agents@0.7.9` package transitively pins `@modelcontextprotocol/sdk@1.26.0`. With `^1.26.0` on our side, npm resolved our top-level dep to `1.29.0` (latest minor) and kept the `1.26.0` copy nested inside `agents/node_modules/`. That dual-install produced TS2345 errors because `McpServer` from each copy has a private `_serverInfo` declaration that's incompatible across the two type identities. Pin-exact dedups to a single hoisted copy; no nested install.
- **Bearer-in-header-only authentication**: `Authorization: Bearer <token>` is the only auth path. URL-path tokens (e.g. `/mcp/{token}`) were rejected because they leak via HTTP referrers, proxy access logs, and intermediate CDN logs. The Worker never logs the raw token (it's hashed before any outbound call, and the auth middleware doesn't `console.log` on success).
- **Per-startup rate limiting deferred** (vs. plan must_have "Rate limit applied per startup_id"): true token-bucket-per-startup in CF Workers requires either a Durable Object or a KV namespace. Adding either expands the scaffold scope. The Fly proxy at `/v1/startups/token` serves as the natural per-request bottleneck during Wave 2 (every MCP call hits it). A real rate-limiter is queued as a 28-03 candidate (once the proxy starts seeing pilot traffic that makes rate-limiting matter).
- **Custom domain via `routes[]+custom_domain`** (matches `apps/parrot/wrangler.jsonc`): Cloudflare auto-provisions DNS + cert. No separate `wrangler` DNS step. Verified by `mcp.internjobs.ai` resolving immediately with valid SSL on first deploy.
- **ChatGPT OAuth probe → 404 JSON** (not 200, not 500): 200 would signal OAuth support + force ChatGPT to expect a full RFC 8414 metadata document. 500 makes ChatGPT think the Worker is broken. 404 with `{error: "no_oauth"}` lets ChatGPT fall back cleanly to the `Authorization: Bearer` header.
- **`role_count` is a documented placeholder = 0** in `handleMe()` (not a stub that errors). The plan's `<done>` block explicitly allows this until Plan 28-03 adds the `/v1/startups/:id/stats` endpoint. Tagged with an inline `TODO` so the future endpoint wire-up is obvious.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Dual `@modelcontextprotocol/sdk` install caused TS2345 type-identity error**

- **Found during:** Task 2 (TypeScript verification after writing `server.ts`)
- **Issue:** `package.json` declared `"@modelcontextprotocol/sdk": "^1.26.0"`, which npm resolved to `1.29.0` (latest minor). The `agents@0.7.9` package transitively pins `@modelcontextprotocol/sdk@1.26.0` exactly, so npm kept a nested copy at `node_modules/agents/node_modules/@modelcontextprotocol/sdk/`. The two copies have separate type identities — `McpServer.server` has a private `_serverInfo` declared in each, and TS treats them as distinct types. `createMcpHandler(createStartupMcpServer(), ...)` produced:
  > error TS2345: Argument of type 'McpServer' is not assignable to parameter of type 'McpServer | Server'. Type 'import("...startup/node_modules/@modelcontextprotocol/sdk/...").McpServer' is not assignable to type 'import("...agents/node_modules/@modelcontextprotocol/sdk/...").McpServer'. Types have separate declarations of a private property '_serverInfo'.
- **Fix:** Pinned `"@modelcontextprotocol/sdk": "1.26.0"` (exact). Reinstalled (`rm -rf node_modules package-lock.json && npm install`). The nested copy is gone; only the top-level hoisted copy remains. `tsc --noEmit` is clean.
- **Files modified:** `apps/startup/package.json`, `apps/startup/package-lock.json`
- **Verification:** `tsc --noEmit` exits 0; `ls node_modules/agents/node_modules/@modelcontextprotocol/` returns "No such file or directory"; deploy and runtime smoke all pass.
- **Committed in:** `2ec06b6` (folded into Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1× Rule 3 blocking — pre-existing transitive-dependency dual-install hazard with the `agents` SDK).
**Impact on plan:** Trivial — the fix is a 6-character package.json change. Zero scope creep. Worth recording because future maintainers who try to loosen the SDK pin will trip the same hazard; the inline rationale + this SUMMARY entry document the constraint.

## Files Modified Outside Plan Frontmatter

Per HYGN-04 audit: `git diff --name-only HEAD~2 HEAD` shows three files NOT in the plan's `files_modified` frontmatter list:

- `apps/startup/.gitignore` — new app needs a gitignore to keep `node_modules/` + `.wrangler/` + `*.log` out of git. Hygiene scaffold (Rule 3 - Blocking equivalent: without it, `node_modules/` would be staged).
- `apps/startup/package-lock.json` — auto-generated by `npm install`. Always paired with `package.json`.
- `package.json` (root) — added `!apps/startup` to the npm workspaces `workspaces` array, matching the existing `!apps/agentic-inbox` and `!apps/parrot` isolation pattern. Without it, the new app's deps would hoist into the monorepo root and `npm install` at root would install Workers-only deps (workers-types, wrangler) globally. Strictly necessary to keep the install isolated.

All three are necessary side-effects of creating a new isolated Worker app. None are scope creep.

## Issues Encountered

- **MCP Streamable HTTP `Mcp-Session-Id` header not returned by Worker**: Initial smoke test captured response headers and the `mcp-session-id` header was exposed via `Access-Control-Expose-Headers` but no actual value was set in the response. Investigation revealed this is fine — the `createMcpHandler` Worker transport supports stateless request-per-request flow, where each MCP request is self-contained (no session reuse required). `tools/list`, `tools/call me`, etc. all work standalone with just the Bearer token. The session header path is for streaming-multi-message clients that batch follow-up calls; our scaffold doesn't depend on it. Not a regression.
- **Pre-existing wrangler scope warning**: `wrangler whoami` reports "Wrangler is missing some expected Oauth scopes" (artifacts:write, flagship:write, email_routing:write, email_sending:write, browser:write). None are needed for this Worker — `wrangler deploy` succeeded with the existing scopes (workers_scripts:write + workers_routes:write). Noted for awareness; no action needed.

## User Setup Required

**Two follow-up persistence actions needed (neither blocks Plans 28-03/04/05):**

1. **Persist `STARTUP_API_SECRET` into Infisical** — same outstanding hygiene item from 28-01. Value is at `/tmp/startup_api_secret.txt` (64 hex chars). Target: Infisical `/internjobs-ai/STARTUP_API_SECRET` env=prod, workspace `26995afd-9a6f-4690-912f-01cbcebb76d5`. Requires `infisical login` against the internjobs org first (current CLI session is logged into Projecta org per 28-01 SUMMARY).

2. **Persist `STARTUP_MCP_ADMIN_SECRET` into Infisical** — minted in this plan by `openssl rand -hex 32`. Value at `/tmp/startup_mcp_admin_secret.txt` (64 hex chars; first 8 chars: `aab8e96d`). Target: Infisical `/internjobs-ai/STARTUP_MCP_ADMIN_SECRET` env=prod. Plan 28-04 will read this for the admin endpoint auth. The secret is already live on the Worker via `wrangler secret put STARTUP_MCP_ADMIN_SECRET`.

Optional after persistence: delete both `/tmp/*_secret.txt` files from the local machine.

## DNS Notes

- **`mcp.internjobs.ai` custom domain**: Created automatically by Cloudflare on first `wrangler deploy` because `wrangler.jsonc` has `routes: [{pattern: "mcp.internjobs.ai", custom_domain: true}]`. No manual DNS step required. The deploy output confirmed: `mcp.internjobs.ai (custom domain)`. SSL cert was auto-provisioned by Cloudflare (HTTPS works immediately).
- **DNS record visible in Cloudflare dashboard**: The Worker custom domain creates a Worker-managed A/AAAA record on `internjobs.ai` zone. No conflict with existing `app.internjobs.ai` (student app), `workspace.internjobs.ai` (parrot), or `agent.internjobs.ai` (agentic-inbox) records.
- **Rollback procedure**: To remove the custom domain, delete the `routes[]` entry in wrangler.jsonc and redeploy — Cloudflare auto-removes the DNS record. The Worker remains accessible via `internjobs-startup-mcp.<account>.workers.dev`.

## Next Phase Readiness

**Unblocks Plans 28-03 (search/execute implementations), 28-04 (admin endpoint), and 28-05 (marketing CTA receiver).**

- **For Plan 28-03**: the `search()` + `execute()` tools in `apps/startup/workers/tools/{search,execute}.ts` are stub-shaped — drop in pgvector search + per-action handlers that POST to the 28-01 Fly proxy. The return-shape contract is fixed (`{scope, query, results, total_returned, next_cursor}` for search; `{ok, action, ...}` for execute), so existing MCP clients keep working as the stubs flip to real implementations. Also: wire `me().role_count` to `GET /v1/startups/:id/stats` once that endpoint exists on the proxy.
- **For Plan 28-04**: `/admin/*` currently returns 503. Mount the admin router under `app.all("/admin/*")` and read `c.env.STARTUP_MCP_ADMIN_SECRET` for auth (separate from the per-startup Bearer that gates `/mcp`). The admin endpoint will POST to the proxy's `/v1/startups` to mint install tokens for Ridhi-led concierge onboarding.
- **For Plan 28-05**: `/api/*` currently returns 503. Mount the marketing CTA receiver under `app.all("/api/*")`. It probably routes to the same `/v1/startups` proxy endpoint with marketing-source tracking.

**Watchlist:**

- **Rate limiting per startup_id deferred** — plan's must_have wasn't implemented for the scaffold (the Fly proxy is the natural bottleneck during Wave 2). Add a real token-bucket (DO or KV) in 28-03 once `search` + `execute` start firing real load.
- **Streamable HTTP session reuse** — current stateless flow works for the 4-tool surface; if any future tool needs to stream incremental progress (long-running `search` over large corpora), upgrade the transport to use Worker Transport sessions explicitly.
- **MCP SDK pin** — `@modelcontextprotocol/sdk@1.26.0` is exact-pinned. When upgrading `agents` (which bumps its transitive SDK pin), upgrade our pin in lockstep. The inline comment in `package.json` documents the constraint; future maintainers should grep for `1.26.0` before bumping.

---
*Phase: 28-startup-mcp-server*
*Completed: 2026-05-25*
