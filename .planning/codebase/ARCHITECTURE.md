# Architecture

**Analysis Date:** 2026-05-24

## Architectural Context Loaded

- Locked source: `.planning/PROJECT.md` — "Auth: two Clerk apps, not one — Students=LinkedIn-only at app.internjobs.ai, Employees=phone-OTP-only at workspace.internjobs.ai. Don't merge them."
- Locked source: `.planning/ROADMAP.md` — "Phase 18: Graph Bridge Runtime — Workers RESP3 path was researched and ruled out — `cloudflare:sockets` blocks private IPs and no Cypher lib runs in Workers today." (REST proxy via `infra/graph-api/` is the chosen path)
- Locked source: memory `project-llm-via-ai-gateway.md` — "Parrot LLM calls route through CF AI Gateway for per-employee daily caps; student app stays on direct REST. Don't migrate as side effect."
- Locked source: memory `project-auth-architecture.md` — Two separate Clerk instances; no shared user pool; no organization-membership gate needed.

---

## Pattern Overview

**Overall:** Hybrid monorepo — multiple independently-deployed services sharing a common repo and a `packages/shared` contract layer.

**Key Characteristics:**
- Three distinct runtime environments in one repo: Cloudflare Workers (edge), Fly.io Node (server), Cloudflare Pages (static)
- Two fully-separated user planes: students (`app.internjobs.ai`) and employees/startups (`workspace.internjobs.ai`), each with a dedicated Clerk instance
- Durable Objects (per-entity SQLite-in-edge) for employee mailboxes, todos, and workspace directory — not a centralized database for the employee plane
- Fail-soft posture everywhere: every external integration (graph, Lakera, push, LLM) is wrapped with a fail-open path so a downstream outage never crashes the core agent loop
- Agent-first autonomy: the student agent drafts AND sends without human pre-approval (v1.2 pivot); `/ops/drafts` is a read-only audit trail

---

## Layers

**Marketing Layer:**
- Purpose: Public static site (no auth, no server)
- Location: `apps/marketing/`
- Contains: Vite + React/HTML, static assets, Cloudflare Pages deployment config
- Depends on: None (standalone)
- Used by: Public users at `internjobs.ai`

**Student App Layer (Fly.io / Node):**
- Purpose: LinkedIn-auth student onboarding, SMS pairing, Mastra agent loop, graph memory, FalkorDB
- Location: `apps/app/`
- Contains: `src/server.mjs` (HTTP server entry), `src/workflows/` (Mastra agent), `src/memory/graph.mjs` (FalkorDB Graphiti-style temporal facts), `src/sms/` (SMS providers), `src/safety/screen.mjs` (Lakera Guard, Node runtime), `src/routes/`, `src/email/`, `db/migrations/` (Postgres SQL migrations)
- Depends on: Clerk (LinkedIn OAuth), Neon Postgres (student DB), FalkorDB (`internjobs-graph` Fly app), Mastra, Cloudflare Workers AI (direct REST), Spectrum/BlueBubbles SMS
- Used by: Students at `app.internjobs.ai`

**Parrot Worker Layer (Cloudflare Worker):**
- Purpose: Employee workspace — email inbox, cross-channel todo extraction, AI Gateway LLM, Mattermost integration, Daily.co meetings, OIDC SSO bridge
- Location: `apps/parrot/`
- Contains:
  - `workers/index.ts` — Hono API routes entry
  - `workers/app.ts` — Hono root with Clerk JWT verification (phone-OTP employee Clerk instance)
  - `workers/types.ts` — `Env` interface for all Worker bindings and secrets
  - `workers/durableObject/index.ts` — `EmployeeMailboxDO` (per-employee SQLite via Drizzle)
  - `workers/durableObject/workspace.ts` — `WorkspaceDO` (singleton, employee directory + OIDC code/token tables)
  - `workers/durableObject/migrations.ts` — DO SQLite migrations (8 migrations through v1.2)
  - `workers/lib/` — `ai.ts` (Workers AI via CF AI Gateway), `graph.ts` (FalkorDB proxy calls), `inbound-email.ts` (postal-mime MIME parsing), `mattermost.ts`, `daily.ts`, `safety.ts` (Lakera Guard, Worker runtime), `mailbox.ts`, `email-sender.ts`, `vapid.ts`, `auto-clear.ts`
  - `workers/routes/` — `admin-employees.ts`, `agent.ts`, `oidc.ts`, `ops-safety.ts`, `reply-forward.ts`
  - `workers/db/schema.ts` — Drizzle SQLite schema (folders, emails, attachments, todos, push_subscriptions)
  - `app/` — React Router v7 SPA (employee UI, SSR via the same Worker)
  - `app/routes/` — `dashboard.tsx`, `inbox.tsx`, `chat.tsx`, `meetings.tsx`, `phone.tsx`, `sms.tsx`, `ops.safety.tsx`, `admin.tsx`, `admin.invite.tsx`, `login.tsx`
  - `shared/` — `Folders` enum shared between worker and app layers within this app
- Depends on: Clerk employee app (JWKS at `clerk.workspace.internjobs.ai`), `EmployeeMailboxDO`, `WorkspaceDO`, R2 bucket, `internjobs-graph-api` Fly proxy (v1.3 Phase 18), Mattermost REST API, Daily.co REST API, CF AI Gateway → kimi-k2.6
- Used by: Employees/startups at `workspace.internjobs.ai`

**Agentic Inbox Worker Layer (Cloudflare Worker):**
- Purpose: Maya identity mailbox — inbound email to MCP server, R2 attachments, CF Access SSO, search/threading
- Location: `apps/agentic-inbox/`
- Contains:
  - `workers/index.ts` — Hono API + email export entry
  - `workers/app.ts` — root Hono app
  - `workers/durableObject/index.ts` — `MailboxDO` (per-mailbox SQLite, predecessor pattern to `EmployeeMailboxDO`)
  - `workers/agent/` — EmailAgent with Mastra-style onNewEmail dispatch
  - `workers/mcp/` — MCP server for Claude Desktop / external agent access
  - `workers/routes/` — mailbox CRUD routes
  - `app/routes/` — `home.tsx`, `mailbox.tsx`, `mailbox-index.tsx`, `email-list.tsx`, `search-results.tsx`, `settings.tsx`
- Depends on: CF Access (SSO), R2 attachments, Cloudflare Email Routing
- Used by: Agent-to-agent mailbox at `agent.internjobs.ai`

**Email Worker (Cloudflare Worker):**
- Purpose: Cloudflare Email Routing catch-all receiver — routes inbound startup emails into the Parrot EmployeeMailboxDO
- Location: `apps/email-worker/`
- Contains: `src/index.ts` — thin email export handler
- Depends on: Parrot Worker (via DO binding or Service Binding)
- Used by: Cloudflare Email Routing for `*@agent.internjobs.ai`

**Mattermost Proxy Worker (Cloudflare Worker):**
- Purpose: Reverse proxy for chat.internjobs.ai → Mattermost Fly app; strips iframe-blocking headers (`X-Frame-Options`, `CSP frame-ancestors`) so Mattermost can be embedded inside the Parrot Workspace UI
- Location: `apps/mattermost-proxy/`
- Contains: `workers/index.ts` — HTTP + WebSocket upgrade proxy
- Depends on: `MATTERMOST_ORIGIN` (Fly Mattermost), `ALLOWED_PARENT` (workspace.internjobs.ai)
- Used by: `chat.internjobs.ai`

**Mac Bridge (Local Node process):**
- Purpose: BlueBubbles iMessage bridge — receives SMS/iMessage events from the self-hosted Mac mini (HostMyApple) via Cloudflare Tunnel and forwards to the student app's inbound SMS endpoint
- Location: `apps/mac-bridge/`
- Contains: `src/server.mjs`, `src/listener.mjs`, `src/bluebubbles-client.mjs`, `src/security.mjs`, `src/config.mjs`, `launchd/` (macOS launch daemon plist)
- Depends on: BlueBubbles REST API, Cloudflare Tunnel, student app `/sms/inbound` webhook
- Used by: Student SMS inbound pipeline

**Graph API Proxy (Fly.io / Node + Hono):**
- Purpose: Thin HTTP REST proxy fronting FalkorDB so the Cloudflare Parrot Worker can reach it (Workers cannot open RESP3/Redis sockets to private Fly IPs)
- Location: `infra/graph-api/`
- Contains: `src/index.ts` (Hono app), `smoke.mjs` (smoke test script)
- Depends on: FalkorDB at `internjobs-graph.internal:6379` (Fly private network), `GRAPH_API_SECRET` Bearer auth
- Used by: Parrot Worker `workers/lib/graph.ts` (v1.3 Phase 18)

**Shared Package:**
- Purpose: Shared TypeScript contracts and utilities used by multiple apps
- Location: `packages/shared/src/`
- Depends on: Nothing external
- Used by: `apps/parrot`, `apps/agentic-inbox`

---

## Data Flow

**Student Inbound SMS Flow:**

1. Student texts the Spectrum/BlueBubbles number
2. Mac Bridge (`apps/mac-bridge`) receives the iMessage event via BlueBubbles webhook and forwards to student app `/sms/inbound`
3. Student app `src/server.mjs` receives the POST, looks up the verified student via normalized phone routing
4. `src/safety/screen.mjs` — Lakera Guard pre-LLM screen (v1.3 Phase 20); fail-open
5. `src/workflows/student-inbound.mjs` — Mastra agent loop:
   - Load student profile from Neon Postgres
   - `getStudentSummary()` — inject FalkorDB graph context (temporal facts) as first block of prompt
   - Vector match against `role_embeddings` (pgvector, bge-base-en-v1.5, 768-dim)
   - Call Cloudflare Workers AI directly (`@cf/meta/llama-3.3-70b-instruct-fp8-fast`, direct REST)
   - Fire-and-forget post-reply fact extraction → FalkorDB (`recordFact()`)
6. `src/outbound.mjs` — autonomous send (no human approval gate); routes back via SMS provider

**Employee Inbound Email Flow:**

1. Startup email arrives at `*@agent.internjobs.ai`
2. Cloudflare Email Routing → `apps/email-worker` Worker email export
3. `apps/parrot/workers/lib/inbound-email.ts` — postal-mime parsing, resolves recipient via `WorkspaceDO.getEmployeeByWorkspaceEmail()`
4. `workers/lib/safety.ts` — Lakera Guard pre-LLM screen (v1.3 Phase 20); fail-open
5. `EmployeeMailboxDO.createEmail()` — store in DO SQLite (Inbox folder), fire-and-forget todo extraction
6. `workers/lib/ai.ts` — `extractTodosFromEmail()` via CF AI Gateway → kimi-k2.6 (per-employee daily cap enforcement)
7. Graph context injected: `getEmployeeContext()` → `infra/graph-api` Fly proxy → FalkorDB
8. `recordTodoFact()` — write :Todo node into FalkorDB with sha256-deduplication

**Employee Mattermost Poll Flow:**

1. `EmployeeMailboxDO` sets a Durable Object alarm (scheduled)
2. Alarm fires: DO polls Mattermost REST API for new posts (`getMmPostsSince()`)
3. New posts → `extractTodosFromText()` via CF AI Gateway → kimi-k2.6
4. Todos written to DO SQLite + FalkorDB graph (same dedup pattern)
5. Web Push VAPID notification sent to subscribed employee browsers

**State Management:**
- Student side: Neon Postgres (system of record) + FalkorDB (temporal graph facts) + Mastra thread memory
- Employee side: `EmployeeMailboxDO` SQLite per employee (emails, todos, push subscriptions) + `WorkspaceDO` SQLite singleton (employee directory, OIDC codes/tokens) + FalkorDB (Parrot label namespace: :Employee, :Todo, :Person, :Email, :ChatMsg)
- Graph isolation: student labels and Parrot labels coexist in the same FalkorDB instance (`internjobs` graph name) but NEVER overlap on nodes or edges — isolation is by Cypher label namespace, not by separate graph

---

## Key Abstractions

**EmployeeMailboxDO:**
- Purpose: Per-employee persistent SQLite store at the edge. Keyed by Clerk user ID (not email). Holds emails, folders, attachments, todos, push subscriptions. Runs Durable Object alarm loop for Mattermost polling.
- Examples: `apps/parrot/workers/durableObject/index.ts`
- Pattern: Cloudflare Durable Object with Drizzle ORM over SQLite-in-DO. Schema applied via internal migration runner (`applyMigrations()`).

**WorkspaceDO:**
- Purpose: Singleton DO (one instance, pinned via `idFromName("workspace")`) for cross-employee state — employee directory and OIDC auth codes/tokens for Mattermost SSO bridge.
- Examples: `apps/parrot/workers/durableObject/workspace.ts`
- Pattern: Cloudflare Durable Object with raw SQLite (not Drizzle). One instance across all employees.

**SmsProvider Interface:**
- Purpose: Seam between the student agent loop and the actual SMS transport. Lets Telnyx swap in as a drop-in adapter without touching call-sites.
- Examples: `apps/app/src/sms/` (spectrum.mjs, mac-bridge.mjs)
- Pattern: Interface + factory pattern. `SMS_PROVIDER=mac-bridge` (production) or `spectrum` (legacy/test).

**Graph Memory (Graphiti-style):**
- Purpose: Temporal fact store for cross-conversation recall. Facts have `valid_from` / `valid_to`; a new conflicting fact closes out the prior one in the same transaction.
- Examples: `apps/app/src/memory/graph.mjs` (student, Node/Fly), `apps/parrot/workers/lib/graph.ts` (employee, Worker via REST proxy)
- Pattern: FalkorDB Cypher + temporal fact model. sha256-based deduplication prevents duplicate facts on replay. Fail-soft everywhere.

**Fail-Soft Wrappers:**
- Purpose: Every integration (graph, Lakera, push notifications, AI Gateway, Daily.co) returns a safe default on error and logs a structured one-line JSON warning. The agent turn always completes.
- Examples: `workers/lib/graph.ts` `getEmployeeContext()`, `workers/lib/safety.ts` `screenMessage()`, `workers/lib/daily.ts`
- Pattern: try/catch returning null/[]/false + `console.warn(JSON.stringify({ level: "warn", message: "...", error: ... }))`

---

## Entry Points

**Student App (`apps/app`):**
- Location: `apps/app/src/server.mjs`
- Triggers: Fly.io process startup (`node src/server.mjs`)
- Responsibilities: HTTP server setup, Clerk auth middleware, SMS webhook receiver, Mastra init, FalkorDB schema bootstrap, Spectrum/mac-bridge listener startup, all student route handlers, `/healthz`

**Parrot Worker (`apps/parrot`):**
- Location: `apps/parrot/workers/app.ts` (exports root Hono handler + DO classes)
- Triggers: Cloudflare Worker fetch event + email export + DO alarm
- Responsibilities: Clerk JWT verification (employee Clerk app, phone-OTP), route dispatch to `workers/index.ts` Hono API, React Router SSR for the SPA, inbound email handling via `inbound-email.ts`, DO export for `EmployeeMailboxDO` + `WorkspaceDO`

**Agentic Inbox Worker (`apps/agentic-inbox`):**
- Location: `apps/agentic-inbox/workers/index.ts`
- Triggers: Cloudflare Worker fetch event + email export
- Responsibilities: CF Access SSO, mailbox CRUD, MCP server, EmailAgent dispatch

**Graph API Proxy (`infra/graph-api`):**
- Location: `infra/graph-api/src/index.ts`
- Triggers: Fly.io process (Node + Hono)
- Responsibilities: Bearer auth verification (`GRAPH_API_SECRET`), Cypher query forwarding to FalkorDB at `internjobs-graph.internal:6379`, `/health` endpoint

**Marketing Site (`apps/marketing`):**
- Location: `apps/marketing/src/` (Vite entry)
- Triggers: Cloudflare Pages build/deploy
- Responsibilities: Static marketing pages (`/`, `/startups`, `/privacy`, `/terms`), deploy verification script

---

## Error Handling

**Strategy:** Fail-soft / fail-open at every integration boundary. Errors are logged as structured JSON; the agent loop never throws to the user.

**Patterns:**
- Graph unavailable → return null/[] → agent prompt skips graph-context block → turn completes with degraded recall
- Lakera Guard unavailable (timeout >1s or 5xx) → `action: 'passed_lakera_unavailable'` → message proceeds to agent (fail-open; logged to `/ops/safety`)
- AI Gateway error → caught in `ai.ts` → todo extraction skipped → DO createEmail still completes
- Daily.co API error → `createRoom()` returns null → UI shows "not configured" toast

---

## Cross-Cutting Concerns

**Logging:** Structured one-line JSON (`console.log(JSON.stringify({ level, message, ...fields }))`). No sensitive data (PII, tokens) in logs. Sentry DSN optional in Parrot Worker (`SENTRY_DSN`).

**Validation:** Input validation is per-route (Hono middleware + inline checks). No centralized validation layer.

**Authentication:**
- Students: `@clerk/backend authenticateRequest()` against `clerk.app.internjobs.ai` JWKS. Handles `__clerk_handshake` URL param for cross-subdomain redirect.
- Employees: `jose.createRemoteJWKSet()` against `PARROT_CLERK_JWKS_URL` (`clerk.workspace.internjobs.ai`). Cached JWKS resolver. `Authorization: Bearer` header OR `__session` cookie.
- Agentic Inbox: Cloudflare Access (SSO, not Clerk).
- Graph API Proxy: Shared Bearer secret (`GRAPH_API_SECRET`).
- Internal Student API: Shared Bearer secret (`STUDENT_API_SECRET` / `INTERNAL_API_SECRET`).

**Secrets Management:** All secrets in Infisical (project `26995afd`, env `prod`, path `/internjobs-ai`). Worker secrets via `wrangler secret put`. Fly app secrets via `flyctl secrets set`. Never committed to repo.

---

*Architecture analysis: 2026-05-24*
