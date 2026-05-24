# Technology Stack

**Analysis Date:** 2026-05-24

## Architectural Context Loaded

- No `.planning/NORTH-STAR.md` found.
- Memory context loaded from session: two Clerk apps locked (students = LinkedIn-only, employees = phone-OTP only); LLM for Parrot routes via CF AI Gateway, student app uses direct Workers AI REST — do NOT merge.

---

## Languages

**Primary:**
- TypeScript 5.8 — Parrot CF Worker (`apps/parrot/`) and Agentic Inbox CF Worker (`apps/agentic-inbox/`)
- JavaScript (ESM, `.mjs`) — Student app Node server (`apps/app/src/`), email worker (`apps/email-worker/`), infra graph-api (`infra/graph-api/`)

**Secondary:**
- TypeScript 5.6 — Marketing site (`apps/marketing/`)
- SQL — Postgres migrations (`apps/app/db/migrations/*.sql`)

## Runtime

**Student App (apps/app):**
- Node.js 22 (minimum) — runs on Fly.io, deployed as `internjobs-ai-student-app`
- Entry: `apps/app/src/server.mjs`

**Parrot Worker (apps/parrot):**
- Cloudflare Workers runtime (`compatibility_date: 2025-11-28`, `nodejs_compat` flag)
- Entry: `apps/parrot/workers/app.ts`
- Deployed as: `internjobs-parrot` at `workspace.internjobs.ai`

**Agentic Inbox Worker (apps/agentic-inbox):**
- Cloudflare Workers runtime (same compat date, `nodejs_compat` flag)
- Entry: `apps/agentic-inbox/workers/app.ts`
- Deployed as: `internjobs-agentic-inbox`

**Email Worker (apps/email-worker):**
- Cloudflare Workers runtime
- Entry: `apps/email-worker/src/index.js`
- Deployed as: `internjobs-email-ingest`

**Mattermost Proxy (apps/mattermost-proxy):**
- Cloudflare Workers runtime
- Deployed as: `internjobs-mattermost-proxy` at `chat.internjobs.ai`

**Graph API (infra/graph-api):**
- Node.js — Hono REST server proxying FalkorDB
- Deployed on Fly.io as `internjobs-graph-api`

**Mac Bridge (apps/mac-bridge):**
- Node.js 22 — WebSocket bridge for BlueBubbles iMessage
- Entry: `apps/mac-bridge/src/server.mjs`

**Package Manager:**
- npm (workspaces)
- Lockfile: `package-lock.json` present at repo root

## Frameworks

**Student App — HTTP server:**
- Plain Node.js `http.createServer` — no Express/Hono; custom routing in `apps/app/src/server.mjs`

**Parrot + Agentic Inbox — Router:**
- Hono `^4.7.11` — used inside the CF Worker for route handling

**Parrot + Agentic Inbox — Frontend:**
- React 19 with React Router 7 (`react-router ^7.5.3`)
- Rich text: Tiptap 3.20.2 (all extensions pinned via `overrides`)
- Icons: `@phosphor-icons/react`, `lucide-react`
- Animation: Vanta + Three.js (`apps/parrot`), `canvas-confetti`

**Marketing Site:**
- React 18 + Vite (no framework router)
- Framer Motion `^12.23.12` for animations

**Agent Framework:**
- Mastra `@mastra/core@1.35.0` + `@mastra/pg@1.11.0` + `@mastra/memory@1.18.2` — student app only (`apps/app/`)
- Agentic Inbox uses the Cloudflare `agents` SDK (`agents ^0.7.6`) + Vercel AI SDK (`ai ^6.0.116`, `@ai-sdk/react`)

**Build / Dev:**
- Vite 6 (Parrot, Agentic Inbox) with `@cloudflare/vite-plugin`
- Vite 8 (Marketing)
- Wrangler 4 — CF Worker deployment for all CF apps
- `@react-router/dev` — build tooling for Parrot and Agentic Inbox

**Type Checking:**
- TypeScript 5.8 (`apps/parrot`, `apps/agentic-inbox`)
- TypeScript 5.6 (`apps/marketing`)

## Key Dependencies

**Critical:**
- `@clerk/backend@3.4.9` — auth for student app (Node) and Parrot Worker
- `@clerk/react-router^3.2.7` / `@clerk/clerk-react^5.61.6` — auth UI for Parrot Worker
- `@mastra/core@1.35.0` — agent orchestration + storage (student app); pinned; do NOT bump without reading migration guide
- `falkordb@6.6.2` — Redis-wire-protocol graph DB client (student app and graph-api proxy)
- `drizzle-orm^0.45.1` — ORM for Parrot Worker's DO SQLite + Neon Postgres (Agentic Inbox)
- `hono^4.7.11` — API routing in CF Workers (Parrot, Agentic Inbox, graph-api)
- `pg^8.20.0` — Postgres client for student app (Fly Postgres via `DATABASE_URL`)
- `@neondatabase/serverless^1.1.0` — Neon serverless driver (Agentic Inbox)
- `@aws-sdk/client-s3@3.1048.0` + `@aws-sdk/s3-request-presigner` — R2 S3-compatible storage (student app)
- `zod^3.25.76` — runtime schema validation (Parrot, Agentic Inbox)
- `jose^6.2.1` — JWT verification and OIDC signing (Parrot)
- `postal-mime^2.6.1` — inbound email parsing (Parrot, Agentic Inbox)
- `@daily-co/daily-js^0.87.0` + `@daily-co/daily-react^0.25.2` — video meetings (Parrot)
- `react-router^7.5.3` — routing for Parrot + Agentic Inbox React apps

**Infrastructure:**
- `spectrum-ts^1.5.0` — legacy Photon/Spectrum SMS provider (student app, mostly superseded by mac-bridge)
- `qrcode^1.5.4` — QR code generation for student onboarding (student app)
- `ws^8.18.0` — WebSocket server for mac-bridge
- `workers-ai-provider^3.1.2` — Agentic Inbox Workers AI provider for Vercel AI SDK
- `@cloudflare/ai-chat^0.1.8` + `@cloudflare/kumo^1.13.0` — Agentic Inbox upstream components

## Configuration

**Environment:**
- Student app: reads from `process.env` in `apps/app/src/config.mjs`
- Parrot Worker: declared in `apps/parrot/wrangler.jsonc` `[vars]`; secrets via `wrangler secret put`
- All secrets stored in Infisical org `26995afd...`, env `prod`, path `/internjobs-ai`

**Key env vars (student app):**
- `DATABASE_URL` — Fly internal Postgres (`internjobs-student-db.internal:5432`)
- `CLERK_PUBLISHABLE_KEY` / `CLERK_SECRET_KEY` / `CLERK_JWKS_URL` — student Clerk app
- `FALKORDB_URL` — Redis URL for FalkorDB (student app direct client)
- `CLOUDFLARE_AI_ACCOUNT_ID` + `CLOUDFLARE_AI_API_TOKEN` — direct Workers AI REST
- `R2_ACCOUNT_ID` + `R2_ACCESS_KEY_ID` + `R2_SECRET_ACCESS_KEY` — R2 artifact store
- `BRIDGE_URL` / `BRIDGE_HMAC_SECRET` — mac-bridge iMessage connection
- `BRIGHTDATA_API_TOKEN` — LinkedIn profile enrichment
- `LAKERA_GUARD_API_KEY` — pre-LLM safety screening
- `INTERNAL_API_SECRET` — shared Bearer secret for Parrot→student `/internal/*` API
- `EMAIL_WORKER_SECRET` — HMAC secret shared with CF email worker
- `SMS_PROVIDER` — `mac-bridge` (production) or `spectrum` (legacy/tests)
- `AGENT_NUMBER` — iMessage number students text (`+14063210019` production)

**Key env vars (Parrot Worker secrets):**
- `PARROT_CLERK_PUBLISHABLE_KEY` / `PARROT_CLERK_SECRET_KEY` / `PARROT_CLERK_JWKS_URL` — employee Clerk app
- `CLOUDFLARE_AI_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` + `PARROT_AI_GATEWAY_ID` — AI Gateway
- `MATTERMOST_BOT_TOKEN` — Mattermost REST API polling
- `DAILY_API_KEY` — Daily.co room provisioning
- `PUSH_VAPID_PRIVATE_KEY` — Web Push VAPID signing key
- `SENTRY_DSN` — Sentry error tracking (optional)
- `GRAPH_API_SECRET` — Bearer secret for graph-api proxy
- `STUDENT_API_SECRET` — Bearer secret for student app internal API
- `LAKERA_GUARD_API_KEY` — pre-LLM safety screening (also Parrot Worker)

**Build:**
- Parrot: `apps/parrot/vite.config.ts`, `apps/parrot/react-router.config.ts`, `apps/parrot/wrangler.jsonc`
- Marketing: `apps/marketing/` Vite config (no separate wrangler route config)
- Student app: `apps/app/package.json` `scripts.build` runs `node scripts/verify-app.mjs` (smoke, not a compile step)

## Platform Requirements

**Development:**
- Node.js 22+
- Wrangler 4 for CF Worker local dev (`wrangler dev`)
- Infisical CLI for secrets pull

**Production:**
- Student app: Fly.io (`ord` region), 512MB shared-cpu-1x, `internjobs-ai-student-app`
- Parrot Worker: Cloudflare Workers at `workspace.internjobs.ai`
- Marketing: Cloudflare Pages (`internjobs-ai` project, `dist/` output)
- Agentic Inbox: Cloudflare Workers (no custom domain, worker dev URL)
- Graph API: Fly.io (`ord`), 256MB shared-cpu-1x, always-warm (`auto_stop=off`)
- FalkorDB: Fly.io (`ord`), 1GB, 10GB volume, private network only
- Student Postgres: Fly.io (`internjobs-student-db`), 1GB RAM, 3GB volume, internal only
- Mattermost: Fly.io (`internjobs-mattermost`), 1GB RAM, 1GB volume, public HTTPS on `:8065`
- Mattermost Postgres: Fly.io (`internjobs-mattermost-db`), internal only

---

*Stack analysis: 2026-05-24*
