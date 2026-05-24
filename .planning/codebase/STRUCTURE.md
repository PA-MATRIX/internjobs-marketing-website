# Codebase Structure

**Analysis Date:** 2026-05-24

## Architectural Context Loaded

- Locked source: `.planning/PROJECT.md` — "Repo is a monorepo: `apps/marketing` (Cloudflare Pages), `apps/app` (Fly.io), `packages/shared` for contracts."
- Locked source: `.planning/ROADMAP.md` — `infra/graph-api/` is the Phase 18 Graph Bridge target location (Hono/Node Fly proxy).

---

## Directory Layout

```
internjobs-cms/                     # Monorepo root
├── apps/
│   ├── app/                        # Student app — Fly.io Node server
│   │   ├── db/
│   │   │   └── migrations/         # Postgres SQL migration files (0001–0010)
│   │   ├── scripts/                # Dev/smoke scripts
│   │   ├── src/
│   │   │   ├── server.mjs          # HTTP server entry point
│   │   │   ├── auth.mjs            # Clerk authenticateRequest() + dev paths
│   │   │   ├── config.mjs          # env config loader
│   │   │   ├── store.mjs           # Neon Postgres data access layer
│   │   │   ├── mastra.mjs          # Mastra agent init
│   │   │   ├── embeddings.mjs      # Workers AI bge-base-en-v1.5 embeddings
│   │   │   ├── outbound.mjs        # SMS/email autonomous send
│   │   │   ├── messaging.mjs       # Welcome text composer
│   │   │   ├── views.mjs           # Server-rendered HTML views
│   │   │   ├── http.mjs            # HTTP helpers (readBody, redirect, sendHtml)
│   │   │   ├── spectrum-listener.mjs # Photon/Spectrum webhook listener
│   │   │   ├── email/              # Inbound email handling (student side)
│   │   │   ├── memory/
│   │   │   │   └── graph.mjs       # FalkorDB Graphiti-style temporal facts
│   │   │   ├── onboarding/
│   │   │   │   ├── pairing.mjs     # QR/SMS pairing code generation + claim
│   │   │   │   └── brightdata.mjs  # LinkedIn enrichment (Bright Data)
│   │   │   ├── routes/
│   │   │   │   └── admin.mjs       # /ops/* admin route handlers
│   │   │   ├── safety/
│   │   │   │   └── screen.mjs      # Lakera Guard pre-LLM screen (Node runtime)
│   │   │   ├── sms/
│   │   │   │   ├── spectrum.mjs    # Photon/Spectrum SMS provider
│   │   │   │   └── mac-bridge.mjs  # BlueBubbles mac-bridge SMS provider
│   │   │   ├── storage/
│   │   │   │   └── r2.mjs          # R2 client (private bucket, signed URLs)
│   │   │   └── workflows/
│   │   │       ├── student-inbound.mjs  # Mastra agent loop (match→draft→send)
│   │   │       ├── reply-to.mjs         # Reply-To alias builder
│   │   │       └── reply-to.test.mjs    # Unit tests
│   │   └── test/                   # Test fixtures / smoke tests
│   │
│   ├── parrot/                     # Employee workspace — Cloudflare Worker + React Router SPA
│   │   ├── app/
│   │   │   ├── components/
│   │   │   │   └── crosspane/      # Cross-pane UI components
│   │   │   ├── lib/                # SPA-side utilities
│   │   │   └── routes/             # React Router v7 route components
│   │   │       ├── dashboard.tsx   # Cross-channel todo dashboard
│   │   │       ├── inbox.tsx       # Email inbox
│   │   │       ├── chat.tsx        # Mattermost iframe embed
│   │   │       ├── meetings.tsx    # Daily.co personal rooms
│   │   │       ├── phone.tsx       # SMS/phone tab
│   │   │       ├── sms.tsx         # SMS tab
│   │   │       ├── ops.safety.tsx  # Safety event audit view (v1.3)
│   │   │       ├── admin.tsx       # Operator admin panel
│   │   │       ├── admin.invite.tsx # Invite flow
│   │   │       └── login.tsx       # Clerk phone-OTP sign-in
│   │   ├── shared/
│   │   │   └── folders.ts          # Folders enum (shared worker ↔ SPA)
│   │   ├── workers/
│   │   │   ├── app.ts              # Hono root — Clerk JWT verification + SSR handler
│   │   │   ├── index.ts            # Hono API routes (/api/*)
│   │   │   ├── types.ts            # Env interface for all Worker bindings
│   │   │   ├── db/
│   │   │   │   └── schema.ts       # Drizzle SQLite schema (emails, todos, etc.)
│   │   │   ├── durableObject/
│   │   │   │   ├── index.ts        # EmployeeMailboxDO (per-employee SQLite)
│   │   │   │   ├── migrations.ts   # DO SQLite migrations runner
│   │   │   │   └── workspace.ts    # WorkspaceDO (singleton directory + OIDC)
│   │   │   ├── lib/
│   │   │   │   ├── ai.ts           # Workers AI via CF AI Gateway (kimi-k2.6)
│   │   │   │   ├── graph.ts        # FalkorDB via graph-api REST proxy
│   │   │   │   ├── inbound-email.ts # postal-mime MIME parsing + email ingestion
│   │   │   │   ├── safety.ts       # Lakera Guard pre-LLM screen (Worker runtime)
│   │   │   │   ├── mattermost.ts   # Mattermost REST API calls
│   │   │   │   ├── daily.ts        # Daily.co REST API (room management)
│   │   │   │   ├── mailbox.ts      # requireEmployeeMailbox middleware
│   │   │   │   ├── email-sender.ts # Cloudflare Email Service outbound
│   │   │   │   ├── email-helpers.ts # HTML ↔ text, stripHtml, generateMessageId
│   │   │   │   ├── email.ts        # Email threading helpers
│   │   │   │   ├── vapid.ts        # VAPID signing for Web Push
│   │   │   │   ├── auto-clear.ts   # Todo auto-resolution (Phase 19 cron)
│   │   │   │   ├── operator.ts     # isOperator() check against publicMetadata
│   │   │   │   ├── attachments.ts  # R2 attachment helpers
│   │   │   │   ├── schemas.ts      # Shared Zod/type schemas
│   │   │   │   └── clerk-admin.ts  # Clerk backend admin calls
│   │   │   ├── routes/
│   │   │   │   ├── admin-employees.ts  # /api/admin/employees (invite, list)
│   │   │   │   ├── agent.ts            # /api/inbox/agent/* (summarize, draft, chat)
│   │   │   │   ├── oidc.ts             # /oidc/* (Mattermost OIDC SSO bridge)
│   │   │   │   ├── ops-safety.ts       # /api/ops/safety (safety event log)
│   │   │   │   └── reply-forward.ts    # /api/inbox/send, reply, forward
│   │   │   └── mcp/                # (not present in parrot; lives in agentic-inbox)
│   │   ├── public/                 # Static assets
│   │   ├── scripts/                # Deploy / smoke scripts
│   │   └── build/                  # Compiled output (gitignored)
│   │
│   ├── agentic-inbox/              # Maya identity mailbox — Cloudflare Worker
│   │   ├── app/
│   │   │   ├── components/
│   │   │   │   └── email-panel/    # Email panel UI components
│   │   │   ├── hooks/              # React hooks
│   │   │   ├── lib/                # SPA-side utilities
│   │   │   ├── queries/            # Data fetching queries
│   │   │   ├── routes/             # React Router route components
│   │   │   ├── services/           # Service layer (SPA)
│   │   │   └── types/              # SPA-side TypeScript types
│   │   ├── shared/                 # Shared worker ↔ app types
│   │   ├── workers/
│   │   │   ├── app.ts              # Hono root
│   │   │   ├── index.ts            # API routes + email export
│   │   │   ├── types.ts            # Env interface
│   │   │   ├── email-sender.ts     # Outbound email
│   │   │   ├── agent/              # EmailAgent (Mastra onNewEmail dispatch)
│   │   │   ├── db/                 # Drizzle schema
│   │   │   ├── durableObject/      # MailboxDO (predecessor to EmployeeMailboxDO)
│   │   │   ├── lib/                # Shared worker utilities
│   │   │   ├── mcp/                # MCP server (Claude Desktop / external agents)
│   │   │   └── routes/             # CRUD route handlers
│   │   ├── public/
│   │   └── build/
│   │
│   ├── email-worker/               # Cloudflare Email Routing catch-all (thin)
│   │   └── src/
│   │       └── index.ts            # email export → Parrot DO routing
│   │
│   ├── mattermost-proxy/           # Cloudflare Worker — iframe header rewrite proxy
│   │   └── workers/
│   │       └── index.ts            # HTTP + WebSocket proxy to Mattermost Fly app
│   │
│   ├── mac-bridge/                 # Local Node process (Mac mini / HostMyApple)
│   │   ├── launchd/                # macOS launchd plist (daemon management)
│   │   └── src/
│   │       ├── server.mjs          # HTTP server (receives BlueBubbles webhooks)
│   │       ├── listener.mjs        # BlueBubbles event listener
│   │       ├── bluebubbles-client.mjs # BlueBubbles REST API client
│   │       ├── security.mjs        # Webhook signature validation
│   │       └── config.mjs          # Config loader
│   │
│   ├── marketing/                  # Public site — Cloudflare Pages (Vite)
│   │   ├── public/
│   │   │   └── images/             # Static images
│   │   ├── scripts/                # Build verification scripts
│   │   ├── src/
│   │   │   ├── components/         # React/HTML components
│   │   │   └── lib/                # Utility functions
│   │   └── dist/                   # Built output (gitignored, but present)
│   │
│   ├── parrot-mattermost/          # (scaffold / placeholder — not described in detail)
│   └── ai-worker/                  # (torn-out proxy Worker; retained as tombstone)
│       └── src/
│           └── index.ts            # Legacy Workers AI proxy (now unused; direct REST in apps/app)
│
├── packages/
│   └── shared/
│       └── src/                    # Shared TypeScript contracts (used by parrot + agentic-inbox)
│
├── infra/
│   ├── falkordb/                   # FalkorDB Fly app config (Dockerfile + entrypoint.sh)
│   ├── graph-api/                  # internjobs-graph-api Fly proxy (v1.3 Phase 18)
│   │   ├── src/
│   │   │   └── index.ts            # Hono app — Bearer auth + Cypher forwarding
│   │   └── smoke.mjs               # Smoke test (4 Cypher ops against production)
│   ├── mattermost-db/              # Mattermost Postgres on Fly (self-hosted)
│   ├── student-db/                 # Student DB Fly Postgres (post Neon-exit migration)
│   └── NEON-EXIT.md                # Neon-exit migration handoff doc
│
├── .planning/                      # RRR planning docs (not deployed)
│   ├── codebase/                   # Codebase analysis (this directory)
│   ├── milestones/                 # Per-milestone plans and archives
│   ├── debug/                      # Debugging session notes
│   └── artifacts/                  # Verification artifacts
│
├── package.json                    # Monorepo root (npm workspaces)
├── package-lock.json
└── README.md
```

---

## Directory Purposes

**`apps/app/`:**
- Purpose: Student-facing authenticated app (Node.js / Express-style HTTP server on Fly.io)
- Contains: All student flows — LinkedIn auth, SMS pairing, Mastra agent loop, FalkorDB graph memory, Neon Postgres queries, SMS providers, operator ops views
- Key files: `src/server.mjs` (entry), `src/workflows/student-inbound.mjs` (agent loop), `src/memory/graph.mjs` (FalkorDB), `db/migrations/` (Postgres SQL)

**`apps/parrot/`:**
- Purpose: Employee workspace app (Cloudflare Worker + React Router v7 SPA)
- Contains: Two interleaved subsystems — the Hono API Worker (`workers/`) and the React Router SPA (`app/`), built together and served from one Worker
- Key files: `workers/app.ts` (Worker root + Clerk auth), `workers/index.ts` (API routes), `workers/durableObject/index.ts` (EmployeeMailboxDO), `workers/durableObject/workspace.ts` (WorkspaceDO), `workers/lib/graph.ts` (FalkorDB proxy), `workers/lib/ai.ts` (CF AI Gateway)

**`apps/agentic-inbox/`:**
- Purpose: Maya identity mailbox — MCP-accessible email inbox with CF Access SSO
- Contains: Cloudflare Worker + React Router SPA (same structure as parrot), plus an MCP server layer (`workers/mcp/`) and an EmailAgent (`workers/agent/`)
- Key files: `workers/index.ts` (API + email export), `workers/durableObject/index.ts` (MailboxDO — the predecessor pattern Parrot forked from)

**`apps/email-worker/`:**
- Purpose: Thin Cloudflare Email Routing catch-all; routes inbound emails to `EmployeeMailboxDO` in the Parrot Worker
- Contains: Single `src/index.ts` — no business logic

**`apps/mattermost-proxy/`:**
- Purpose: iframe embedding proxy; strips `X-Frame-Options` + rewrites `CSP frame-ancestors` so Mattermost can be embedded in the Parrot workspace
- Contains: Single `workers/index.ts` — HTTP + WebSocket passthrough

**`apps/mac-bridge/`:**
- Purpose: Local bridge between BlueBubbles (iMessage on Mac mini) and the student app's SMS inbound endpoint; runs as a launchd daemon on the HostMyApple Mac mini
- Contains: 5 `.mjs` files + a launchd plist

**`apps/marketing/`:**
- Purpose: Public static site (`internjobs.ai`) deployed to Cloudflare Pages
- Contains: Vite + React components for `/`, `/startups`, `/privacy`, `/terms`

**`infra/graph-api/`:**
- Purpose: Hono/Node REST proxy fronting FalkorDB so Cloudflare Workers can reach it (Phase 18 target)
- Contains: `src/index.ts` (Hono app with Bearer auth), `smoke.mjs` (4-op verification script invokable via `npm run smoke:parrot-graph`)

**`infra/falkordb/`:**
- Purpose: Docker/Fly config for the FalkorDB graph DB Fly app (`internjobs-graph`)
- Contains: Dockerfile + entrypoint.sh (custom password-injection fix)

**`infra/student-db/`:**
- Purpose: Fly Postgres config for the student database (migrated off Neon via Neon-exit)
- Contains: Fly app configuration

**`infra/mattermost-db/`:**
- Purpose: Fly Postgres config for the Mattermost database (self-hosted)
- Contains: Fly app configuration

**`packages/shared/`:**
- Purpose: Shared TypeScript types and utilities consumed by both `apps/parrot` and `apps/agentic-inbox`
- Contains: `src/` — exported contracts (not application code)

---

## Key File Locations

**Entry Points:**
- `apps/app/src/server.mjs`: Student app HTTP server startup
- `apps/parrot/workers/app.ts`: Parrot Worker root (Clerk auth + SSR handler export)
- `apps/parrot/workers/index.ts`: Parrot Hono API routes (`/api/*`)
- `apps/agentic-inbox/workers/index.ts`: Agentic inbox Worker + email export
- `infra/graph-api/src/index.ts`: Graph API proxy Hono app

**Configuration:**
- `package.json` (root): npm workspace definitions + monorepo-level scripts
- `apps/parrot/workers/types.ts`: All Parrot Worker environment bindings (canonical reference for secrets + DO bindings)
- `apps/app/src/config.mjs`: Student app env config loader
- `infra/graph-api/smoke.mjs`: Graph proxy smoke test (invoked via `npm run smoke:parrot-graph`)

**Core Logic:**
- `apps/app/src/workflows/student-inbound.mjs`: Mastra agent loop (student SMS → match → draft → send)
- `apps/app/src/memory/graph.mjs`: Student-side FalkorDB Graphiti temporal facts
- `apps/parrot/workers/durableObject/index.ts`: EmployeeMailboxDO — core of the employee-side persistence layer
- `apps/parrot/workers/lib/graph.ts`: Parrot Worker FalkorDB access via REST proxy
- `apps/parrot/workers/lib/ai.ts`: Workers AI via CF AI Gateway (kimi-k2.6 todo extraction)
- `apps/parrot/workers/lib/safety.ts`: Lakera Guard (Worker runtime)
- `apps/app/src/safety/screen.mjs`: Lakera Guard (Node runtime — student app)

**Database:**
- `apps/app/db/migrations/`: Neon/Fly Postgres SQL migrations (numbered `0001_*` → `0010_*`)
- `apps/parrot/workers/db/schema.ts`: Drizzle SQLite schema for EmployeeMailboxDO
- `apps/parrot/workers/durableObject/migrations.ts`: DO SQLite migration runner

**Testing:**
- `apps/app/src/workflows/reply-to.test.mjs`: Unit tests for reply-to alias logic
- `apps/app/src/auth.test.mjs`: Auth helper unit tests
- `apps/app/test/`: Additional test fixtures
- `infra/graph-api/smoke.mjs`: Integration smoke test for graph proxy

---

## Naming Conventions

**Files:**
- Student app (`apps/app/src/`): `kebab-case.mjs` — all files use `.mjs` (ES modules, Node)
- Parrot Worker (`apps/parrot/workers/`): `kebab-case.ts` — TypeScript, Cloudflare Workers runtime
- Parrot SPA (`apps/parrot/app/routes/`): `kebab-case.tsx` for routes; `PascalCase.tsx` for components; nested routes use dot notation (`admin.invite.tsx`, `ops.safety.tsx`)
- DB migrations: `NNNN_descriptive_name.sql` (zero-padded 4-digit prefix, sequential)
- Agentic inbox follows the same `.ts`/`.tsx` pattern as parrot

**Directories:**
- `workers/` — Cloudflare Worker-specific code within a Worker app
- `app/` — React Router SPA code within a Worker app
- `shared/` — Code shared between the worker layer and the SPA layer within one app
- `lib/` — Utility/helper modules (not routes, not DO classes)
- `routes/` — HTTP route handlers (both Hono backend and React Router frontend)
- `durableObject/` — Durable Object class definitions + migrations

**Exports:**
- Each Cloudflare Worker app exports its DO classes from `workers/app.ts` (e.g., `export { EmployeeMailboxDO } from "./durableObject"`)
- `packages/shared/src/index.ts` is the barrel for the shared package

---

## Where to Add New Code

**New student-side feature (agent loop, SMS, Neon data):**
- Business logic: `apps/app/src/workflows/` or `apps/app/src/` (new `.mjs` module)
- Route handler: `apps/app/src/routes/` (new `.mjs` handler, registered in `server.mjs`)
- DB schema change: add `apps/app/db/migrations/NNNN_v1_X_description.sql`
- Tests: `apps/app/src/` or `apps/app/test/` as `*.test.mjs`

**New employee-side feature (Worker, DO, SPA route):**
- Worker API route: `apps/parrot/workers/routes/` (new `.ts` file), registered in `apps/parrot/workers/index.ts`
- Worker utility/lib: `apps/parrot/workers/lib/` (new `.ts` file)
- DO schema change: add a migration entry to `apps/parrot/workers/durableObject/migrations.ts`
- SPA route: `apps/parrot/app/routes/` (new `.tsx` file following React Router v7 conventions)
- SPA component: `apps/parrot/app/components/`

**New Durable Object method:**
- Add to `apps/parrot/workers/durableObject/index.ts` (EmployeeMailboxDO) or `workspace.ts` (WorkspaceDO)
- Add corresponding migration in `migrations.ts` if schema changes

**New infra service:**
- New Fly app: new directory under `infra/` (e.g., `infra/new-service/`)
- Follow the `infra/graph-api/` pattern: `src/index.ts` (Hono) + `smoke.mjs` + Fly `fly.toml`

**New shared type/utility:**
- `packages/shared/src/` — export from `index.ts`

**Utilities:**
- Student side: `apps/app/src/` top-level `.mjs` file (matches existing `http.mjs`, `views.mjs`, `store.mjs` pattern)
- Worker side: `apps/parrot/workers/lib/` `.ts` file

---

## Special Directories

**`.planning/`:**
- Purpose: RRR planning docs, milestone archives, debug notes, verification artifacts
- Generated: No (human + Claude authored)
- Committed: Yes

**`.wrangler/`:**
- Purpose: Wrangler CLI local state, dev DO SQLite state, cached builds
- Generated: Yes
- Committed: No (`.gitignore`d)

**`build/` (inside each Worker app):**
- Purpose: Compiled Worker + SPA output from Vite/React Router build
- Generated: Yes
- Committed: No

**`dist/` (inside `apps/marketing/`):**
- Purpose: Vite build output for Cloudflare Pages
- Generated: Yes
- Committed: Partially present (Pages deploy reads from this)

**`node_modules/`:**
- Purpose: npm dependencies
- Generated: Yes
- Committed: No

**`.claude/worktrees/`:**
- Purpose: Claude Code agent git worktrees for parallel agent execution
- Generated: Yes (by Claude Code)
- Committed: No

---

*Structure analysis: 2026-05-24*
