# External Integrations

**Analysis Date:** 2026-05-24

## Architectural Context Loaded

- No `.planning/NORTH-STAR.md` found.
- Memory context: Parrot LLM calls route through CF AI Gateway (per-employee daily caps); student app stays on direct Workers AI REST — do NOT migrate as a side effect.
- Two Clerk apps locked: students = LinkedIn-only (`app.internjobs.ai`), employees = phone-OTP only (`workspace.internjobs.ai`). Never merge.
- Daily.co vanity domain (`meet.internjobs.ai`) deferred to v1.3; ships with default `internjobs.daily.co`.
- Seam pattern: Cognee v1.1, Telnyx v1.2 are placeholder rows, not active integrations.

---

## APIs & External Services

**Authentication:**
- Clerk (Student app) — LinkedIn-only OAuth for students at `app.internjobs.ai`
  - SDK/Client: `@clerk/backend@3.4.9` (Node), no React SDK in student app
  - Auth: `CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `CLERK_JWKS_URL`
  - JWKS verified in `apps/app/src/auth.mjs`
  - Only `sub` is guaranteed in JWT — do NOT require email/phone claims
- Clerk (Employee/Parrot app) — phone-OTP only at `workspace.internjobs.ai`
  - SDK/Client: `@clerk/backend@3.4.9`, `@clerk/clerk-react^5.61.6`, `@clerk/react-router^3.2.7`
  - Auth: `PARROT_CLERK_PUBLISHABLE_KEY`, `PARROT_CLERK_SECRET_KEY`, `PARROT_CLERK_JWKS_URL`
  - Separate Clerk instance — any signed-in user IS an employee by construction
  - Configured in `apps/parrot/workers/types.ts` and `apps/parrot/workers/app.ts`

**LLM / AI:**
- Cloudflare Workers AI — direct REST (student app only)
  - Endpoint: `https://api.cloudflare.com/client/v4/accounts/{id}/ai/run/...`
  - Auth: `CLOUDFLARE_AI_ACCOUNT_ID` + `CLOUDFLARE_AI_API_TOKEN`
  - Used in: `apps/app/src/workflows/student-inbound.mjs`, `apps/app/src/embeddings.mjs`
  - DO NOT route through AI Gateway (no per-user concept in student agent)
- Cloudflare AI Gateway — Parrot Worker only
  - Endpoint: `https://gateway.ai.cloudflare.com/v1/{ACCOUNT_ID}/{PARROT_AI_GATEWAY_ID}/workers-ai/{model}`
  - Auth: `CLOUDFLARE_AI_API_TOKEN`; per-employee quota via `cf-aig-metadata: {"user_id": "<clerk_user_id>"}`
  - Model: `@cf/moonshotai/kimi-k2.6` (configured as `KIMI_MODEL` var in `apps/parrot/wrangler.jsonc`)
  - Used in: `apps/parrot/workers/lib/ai.ts`
  - DO NOT use AI Gateway in student app — architectural separation is intentional

**Safety / Content Moderation:**
- Lakera Guard (now Cisco AI Defense) — pre-LLM prompt injection screen
  - Endpoint: `https://api.lakera.ai/v2/guard` (env-overridable via `LAKERA_GUARD_ENDPOINT`)
  - Auth: `LAKERA_GUARD_API_KEY`
  - Fail-open: 1s timeout; unavailability never blocks student SMS or employee LLM calls
  - Student app implementation: `apps/app/src/safety/screen.mjs`
  - Parrot Worker implementation: `apps/parrot/workers/lib/safety.ts`
  - Scope: student inbound SMS + employee email/chat agent. Mattermost internal channel is excluded.

**LinkedIn Enrichment:**
- Bright Data — LinkedIn profile scraping from public URL
  - Endpoint: `https://api.brightdata.com/datasets/v3/scrape`
  - Auth: `BRIGHTDATA_API_TOKEN`
  - Dataset ID: `gd_l1viktl72bvl7bjuj0` (env-overridable via `BRIGHTDATA_LINKEDIN_PROFILE_DATASET_ID`)
  - Fail-soft: returns `null` when token absent or scrape fails
  - Used in: `apps/app/src/onboarding/brightdata.mjs`

**SMS / iMessage:**
- BlueBubbles via mac-bridge (production active path)
  - Self-hosted Mac mini running BlueBubbles, fronted by Cloudflare Tunnel at `bridge.internjobs.ai`
  - Auth: shared HMAC-SHA256 `BRIDGE_HMAC_SECRET` (both inbound and outbound signed)
  - Inbound: mac-bridge POSTs to student app `/webhooks/mac-bridge`
  - Outbound: student app POSTs to `BRIDGE_URL/v1/send`
  - WebSocket bridge code: `apps/mac-bridge/src/server.mjs`; provider: `apps/app/src/sms/mac-bridge.mjs`
  - Agent iMessage number: `+14063210019`
- Photon/Spectrum (legacy — not active in production)
  - Auth: `PHOTON_API_TOKEN` / `SPECTRUM_API_TOKEN`, webhook verified via `PHOTON_WEBHOOK_SECRET`
  - Provider: `apps/app/src/sms/spectrum.mjs`
  - Controlled by `SMS_PROVIDER=spectrum` env var (production uses `mac-bridge`)

**Video Meetings:**
- Daily.co — per-employee video rooms
  - Endpoint: `https://api.daily.co/v1` (rooms, meeting-tokens)
  - Auth: `DAILY_API_KEY`
  - Per-employee room name: `parrot-<clerk_user_id>`; provisioned lazily by `EmployeeMailboxDO`
  - Default domain: `internjobs.daily.co` (custom `meet.internjobs.ai` deferred to v1.3)
  - Fail-soft: returns `null` when key absent — UI falls back to toast
  - Worker client: `apps/parrot/workers/lib/daily.ts`
  - React components: `apps/parrot/` uses `@daily-co/daily-js^0.87.0` + `@daily-co/daily-react^0.25.2`

**Error Tracking:**
- Sentry — error tracking in Parrot Worker
  - Auth: `SENTRY_DSN` (set via `wrangler secret put`)
  - Optional: Worker boots without it; errors fall back to `console.error`
  - Referenced in: `apps/parrot/workers/index.ts`, `apps/parrot/wrangler.jsonc`
  - Inline Sentry envelope pattern (no npm dependency in Worker)

**Email:**
- Cloudflare Email Routing — inbound email handling
  - `*@agent.internjobs.ai` catch-all routes to `internjobs-email-ingest` Worker (`apps/email-worker/`)
  - Employee mailboxes (`name@internjobs.ai`) provisioned at runtime by Parrot Worker
  - Configured in CF Dashboard (not in wrangler configs)
- Cloudflare Email Service (outbound transactional)
  - Auth: `CLOUDFLARE_EMAIL_ACCOUNT_ID` + `CLOUDFLARE_EMAIL_API_TOKEN`
  - Used in student app outbound (`apps/app/src/email/outbound.mjs`) and Parrot email sender (`apps/parrot/workers/lib/email-sender.ts`)
- Email Worker → Student App webhook
  - Worker signs payload with HMAC (`EMAIL_WORKER_SECRET`); POSTs to `https://app.internjobs.ai/webhooks/email`
  - Fallback: raw mail forwarded to `ops@internjobs.ai` if POST fails
  - Worker config: `apps/email-worker/wrangler.toml`

**Web Push Notifications:**
- VAPID (W3C Web Push standard) — browser push for Parrot employees
  - Public key (safe to commit): `BAXYWRDcWvhPxBBU3BYmv97yrSNk2B7soXoniQ5aWI_zn_HUAV7g0WsOO3Nk6VxIC2ioJqlFAEbpqP9OKm-4fQo`
  - Private key: `PUSH_VAPID_PRIVATE_KEY` (wrangler secret)
  - Implementation (no npm dep): `apps/parrot/workers/lib/vapid.ts`

---

## Data Storage

**Databases:**
- Fly Postgres 17 + pgvector (Student DB — primary app DB)
  - App: `internjobs-student-db` on Fly private network (`internjobs-student-db.internal:5432`)
  - Accessible only within Fly org private network
  - Connection: `DATABASE_URL` env var
  - Client: `pg^8.20.0` (direct) + `@mastra/pg@1.11.0` (Mastra PostgresStore + PgVector)
  - Schema migrations: `apps/app/db/migrations/` (raw SQL, applied via `apps/app/scripts/migrate.mjs`)
  - Mastra reserved schema: `mastra` (NOT `public`) — do not change
  - pgvector index: `internjobs_agent` in `mastra` schema
- Neon Postgres (Agentic Inbox — `apps/agentic-inbox/` only)
  - Client: `@neondatabase/serverless^1.1.0` (edge-compatible)
  - Note: student DB has migrated off Neon to Fly Postgres (Neon-exit 2026-05-21); Agentic Inbox still uses Neon
- Fly Postgres (Mattermost DB)
  - App: `internjobs-mattermost-db` on Fly private network
  - Used exclusively by Mattermost Team Edition
  - Secret: `MM_SQLSETTINGS_DATASOURCE` on the Mattermost app

**Graph Database:**
- FalkorDB (Redis-protocol graph)
  - Fly app: `internjobs-graph` at `internjobs-graph.internal:6379` (private network only, no public IP)
  - Auth: `REDIS_PASSWORD` (Fly secret)
  - Graph name: `internjobs` (single graph, label-namespaced between student and Parrot facts)
  - Student app labels: `:Student`, `:Role`, `:Startup`, `:Fact`
  - Parrot labels: `:Employee`, `:Todo`, `:Person`, `:Email`, `:ChatMsg`
  - Student app client: `falkordb@6.6.2` npm in `apps/app/src/memory/graph.mjs`
  - Parrot Worker: does NOT speak Redis directly — calls HTTP proxy instead
  - HTTP proxy: `infra/graph-api/` (Hono/Node on Fly at `internjobs-graph-api.fly.dev`)
    - Auth: shared Bearer `GRAPH_API_SECRET`
    - Parrot client: `apps/parrot/workers/lib/graph.ts`

**Cloudflare Durable Objects (SQLite):**
- Parrot Worker: `EmployeeMailboxDO` (per-employee mailbox + todos + push subscriptions) and `WorkspaceDO` (employee directory + OIDC bridge state)
  - Storage: DO SQLite (each DO has its own DB)
  - Schema: `apps/parrot/workers/durableObject/migrations.ts`, `apps/parrot/workers/db/schema.ts`
- Agentic Inbox: `MailboxDO`, `EmailAgent`, `EmailMCP`

**Cloudflare KV:**
- `PARROT_FEATURE_FLAGS` — global feature flag defaults (ID: `4f2791da98bf440895ab9bf9d10d38de`)
  - Per-employee overrides live in `EmployeeMailboxDO` SQLite `profile.feature_flags` column
  - Binding declared in `apps/parrot/wrangler.jsonc`

**File Storage:**
- Cloudflare R2 — private artifact store (student app)
  - Bucket: `internjobs-agent-store` (default; env-overridable via `R2_BUCKET`)
  - Auth: `R2_ACCESS_KEY_ID` + `R2_SECRET_ACCESS_KEY` (S3-compatible)
  - All sharing via signed URLs; bucket is PRIVATE
  - Client: `@aws-sdk/client-s3@3.1048.0` + `@aws-sdk/s3-request-presigner`
  - Implementation: `apps/app/src/storage/r2.mjs`
- Cloudflare R2 — email attachment store (Parrot Worker)
  - Bucket: `internjobs-parrot-attachments`
  - Binding: `BUCKET` (R2Bucket) in Parrot Worker
- Cloudflare R2 — Agentic Inbox attachments
  - Bucket: `internjobs-agentic-inbox`

**Caching:**
- None as a standalone service; module-level JS variables in Workers serve as warm-isolate caches (e.g., `graphReadyCache` with 30s TTL in `apps/parrot/workers/index.ts`)

---

## Authentication & Identity

**Auth Provider:**
- Clerk (two separate instances — never merge):
  1. Student app (`app.internjobs.ai`): LinkedIn OAuth only, `@clerk/backend` Node SDK, JWT verified via JWKS
  2. Parrot Worker (`workspace.internjobs.ai`): phone-OTP only, `@clerk/react-router` + `@clerk/backend`
- OIDC Bridge (Parrot → Mattermost SSO):
  - Parrot Worker acts as OIDC IdP for Mattermost
  - Endpoints: `/oidc/authorize`, `/oidc/token`, `/oidc/jwks`, `/oidc/userinfo`
  - Signing: RS256 private key (`OIDC_SIGNING_KEY`), public JWK (`OIDC_PUBLIC_JWK`)
  - Client credentials: `MATTERMOST_OIDC_CLIENT_ID` / `MATTERMOST_OIDC_CLIENT_SECRET`
  - State held in `WorkspaceDO` (`apps/parrot/workers/durableObject/workspace.ts`)
  - Routes: `apps/parrot/workers/routes/oidc.ts`

---

## Monitoring & Observability

**Error Tracking:**
- Sentry — Parrot Worker only (optional; `SENTRY_DSN` secret)
- Student app: no Sentry; uses structured JSON logging to stdout

**Logs:**
- All apps: structured JSON to stdout/stderr
  - Format: `{ level, message, ...fields }` via `JSON.stringify`
- Cloudflare Workers: built-in observability enabled (`"observability": {"enabled": true}` in wrangler configs)
- Wrangler tail: `npm run tail` in `apps/email-worker` and `apps/mattermost-proxy`

---

## CI/CD & Deployment

**Hosting:**
- Cloudflare Workers: Parrot, Agentic Inbox, Email Worker, Mattermost Proxy
- Cloudflare Pages: Marketing site (`internjobs-ai` project)
- Fly.io (`internjobs-sios-org`, `ord` region): Student app, Graph API, FalkorDB, Student Postgres, Mattermost, Mattermost Postgres

**CI Pipeline:**
- Not detected (no `.github/workflows/`, no CircleCI, no Buildkite config found)
- Manual deploy commands in `package.json` scripts: `deploy:pages`, `wrangler deploy`

---

## Webhooks & Callbacks

**Incoming (student app — `apps/app/src/server.mjs`):**
- `/webhooks/email` — inbound email from `internjobs-email-ingest` CF Worker; verified via HMAC (`EMAIL_WORKER_SECRET`)
- `/webhooks/mac-bridge` — iMessage inbound from mac-bridge; verified via HMAC-SHA256 (`BRIDGE_HMAC_SECRET`)
- `/webhooks/photon` — legacy Photon/Spectrum SMS inbound (still wired for old callbacks, not active production path)

**Incoming (Parrot Worker):**
- Email inbound via Cloudflare Email Routing `send_email` binding → `EmployeeMailboxDO`

**Outgoing (student app):**
- Cloudflare Workers AI REST: `https://api.cloudflare.com/client/v4/accounts/{id}/ai/run/...`
- Bright Data API: `https://api.brightdata.com/datasets/v3/scrape`
- Lakera Guard: `https://api.lakera.ai/v2/guard`
- Mac-bridge: `BRIDGE_URL/v1/send` (iMessage outbound)
- Graph API proxy: `https://internjobs-graph-api.fly.dev` (Cypher queries)

**Outgoing (Parrot Worker):**
- CF AI Gateway: `https://gateway.ai.cloudflare.com/v1/...` (LLM)
- Mattermost REST: `https://chat.internjobs.ai/api/v4/...` (bot token)
- Daily.co REST: `https://api.daily.co/v1` (room management)
- Lakera Guard: `https://api.lakera.ai/v2/guard`
- Graph API proxy: `https://internjobs-graph-api.fly.dev`
- Student app internal API: `https://app.internjobs.ai/internal/safety-events` (Bearer `STUDENT_API_SECRET`)

---

## Environment Configuration

**Required secrets (student app — production Fly):**
- `CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `CLERK_JWKS_URL`
- `DATABASE_URL`
- `BRIDGE_URL`, `BRIDGE_HMAC_SECRET`
- `FALKORDB_URL`
- `CLOUDFLARE_AI_ACCOUNT_ID`, `CLOUDFLARE_AI_API_TOKEN`
- `EMAIL_WORKER_SECRET`
- `INTERNAL_API_SECRET`
- `BRIGHTDATA_API_TOKEN`
- `LAKERA_GUARD_API_KEY`
- `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`

**Required secrets (Parrot Worker — `wrangler secret put`):**
- `PARROT_CLERK_PUBLISHABLE_KEY`, `PARROT_CLERK_SECRET_KEY`, `PARROT_CLERK_JWKS_URL`
- `CLOUDFLARE_AI_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `PARROT_AI_GATEWAY_ID`
- `GRAPH_API_SECRET`, `STUDENT_API_SECRET`
- `PUSH_VAPID_PRIVATE_KEY`
- `OIDC_SIGNING_KEY`, `OIDC_PUBLIC_JWK`
- `MATTERMOST_OIDC_CLIENT_ID`, `MATTERMOST_OIDC_CLIENT_SECRET`
- `MATTERMOST_BOT_TOKEN`
- `DAILY_API_KEY`
- `SENTRY_DSN` (optional)
- `LAKERA_GUARD_API_KEY`

**Secrets location:**
- All production secrets stored in Infisical org `2c12f042...`, project `26995afd...`, env `prod`, path `/internjobs-ai`
- Fly secrets set via `flyctl secrets set`
- CF Worker secrets set via `wrangler secret put`

---

*Integration audit: 2026-05-24*
