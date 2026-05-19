# Stack Research: v1.3 Pilot Hardening

**Project:** InternJobs.ai
**Milestone:** v1.3 Pilot Hardening
**Researched:** 2026-05-19
**Mode:** Milestone (incremental — builds on v1.2 shipped stack)
**Overall confidence:** HIGH for (a) and (b); HIGH for (c) API shape, MEDIUM for (c) pricing post-Cisco; HIGH for (d)

---

## Research Scope

Four v1.3 items only. Existing stack (Fly.io, Neon, Mastra, Cloudflare Workers, FalkorDB, pgvector, Workers AI) is established and not re-researched.

---

## (a) PHASE14-RUNTIME — FalkorDB Bridge Path

### Verdict: Use the Fly REST Proxy. Workers RESP3 client path is blocked at the network layer.

**The core constraint:** `cloudflare:sockets` TCP connections to private/internal IPs are explicitly blocked by the Cloudflare runtime. Official Cloudflare Workers docs state:

> "Disallowed addresses include Cloudflare IPs, localhost, and private network IPs."

`internjobs-graph.internal:6379` is a Fly internal address (`.internal` is Fly's WireGuard-private DNS zone). A Worker cannot reach it via `cloudflare:sockets` regardless of which Redis client library is used.

**Workers VPC as an alternative:** Cloudflare launched Workers VPC (beta as of research date) which wraps a `cloudflared` tunnel to expose private services to Workers via `env.VPC_SERVICE.fetch()` (HTTP only, not TCP sockets). It is free during beta but requires:
- Running a `cloudflared` tunnel agent on Fly or alongside it
- HTTP fetch semantics only — meaning FalkorDB's Redis/RESP3 wire protocol is still unreachable via this path. Workers VPC exposes HTTP services, not raw TCP.

**Redis-on-Workers library (`redis-on-workers` v0.4.2, Feb 2026):** This package does use `cloudflare:sockets` for TCP, and it works for standard Redis commands (`GET`, `SET`, `DEL`, etc.). However:
1. Private IPs are still blocked regardless of the client library — the constraint is at the socket layer below the library.
2. FalkorDB's `GRAPH.QUERY` is a custom module command. `redis-on-workers` shows no FalkorDB/RedisGraph Cypher support in its documentation. The existing `apps/app/src/memory/graph.mjs` uses the `falkordb` npm client (`falkordb@6.6.2`) which wraps the `redis` package with module-aware command handling. A bare RESP3 client that only knows core Redis commands cannot execute Cypher queries.

**Conclusion:** The Workers RESP3 client path fails on two independent grounds — private IP blocking and missing Cypher command support. The Fly REST proxy wins by default and by design.

### Fly REST Proxy SKU

**Recommended:** Hono on Bun, single-file, deployed as a new Fly app `internjobs-graph-api`.

**Why Hono on Bun over alternatives:**

| Option | Cold-start image | Notes |
|--------|-----------------|-------|
| Node + Fastify | ~200MB | Larger image, slower start, unnecessary for a 4-route proxy |
| Node + Hono | ~180MB | Still Node overhead |
| Bun + Hono | ~80MB | Bun runtime is ~3× smaller image, sub-10ms startup, natively handles TypeScript |
| Repurpose `internjobs-graph` app | N/A | The graph app runs FalkorDB itself — no spare HTTP port, no application runtime |

Hono targets Web Standards fetch API — same interface as the Parrot Worker uses, making the call site code identical on both sides.

**Minimal Dockerfile pattern:**

```dockerfile
FROM oven/bun:1.1-alpine AS base
WORKDIR /app
COPY package.json bun.lockb ./
RUN bun install --frozen-lockfile --production
COPY . .
EXPOSE 8080
CMD ["bun", "run", "src/index.ts"]
```

`oven/bun:1.1-alpine` is the canonical slim image. Multi-stage not needed for a proxy this small.

**fly.toml minimum config:**

```toml
app = "internjobs-graph-api"
primary_region = "ord"          # co-locate with internjobs-graph in ord

[build]
  dockerfile = "Dockerfile"

[env]
  PORT = "8080"

[http_service]
  internal_port = 8080
  force_https = true
  auto_stop_machines = "stop"
  auto_start_machines = true
  min_machines_running = 0      # stop when idle, saves cost

[[vm]]
  size = "shared-cpu-1x"
  memory = "256mb"
```

**Route surface (minimal):**

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/graph/query` | Execute a Cypher query against FalkorDB |
| `GET` | `/healthz` | Liveness check |

The Worker sends `Authorization: Bearer GRAPH_API_SECRET` (shared secret, stored in Infisical at `/internjobs-ai/GRAPH_API_SECRET`). No JWT needed — internal service, never public-facing (Cloudflare Access or no public route on fly.toml).

**No new npm packages on the Worker side.** The Parrot Worker already has `fetch`. The proxy introduces:

| Package | Where | Version | Purpose |
|---------|-------|---------|---------|
| `hono` | `internjobs-graph-api` | `^4.3.0` | HTTP framework |
| `falkordb` | `internjobs-graph-api` | `6.6.2` (pin to match `apps/app`) | FalkorDB client |

The existing `graph.mjs` logic can be copied to the proxy's handler layer verbatim (same Cypher queries, same `getStudentSummary` / `extractFacts` shape) or exposed as a shared module from `packages/shared`.

---

## (b) PARROT-AUTO-CLEAR

No new stack additions needed beyond PHASE14-RUNTIME being unblocked.

The Dashboard mothership (existing `internjobs-parrot` Worker) already holds the `todo` data model in WorkspaceDO. The auto-clear logic is pure application code: poll or subscribe to Graphiti `valid_to` close-outs from the graph proxy, then call `WorkspaceDO.resolveTodo(todoId)`.

**Pattern:** The Parrot Worker calls `GET /graph/todos/closed?since={timestamp}` on the proxy (add this route) → iterates over returned fact IDs → marks matching todos resolved in WorkspaceDO. A Durable Object alarm is the right scheduler — no external cron needed.

No new library pins required.

---

## (c) SAFETY-01 — Lakera Guard

### API Shape (HIGH confidence)

No official npm package exists. Integration is raw `fetch`. Official JS example from Lakera docs:

```typescript
const LAKERA_GUARD_API_KEY = process.env.LAKERA_GUARD_API_KEY;

async function screen(messages: { role: string; content: string }[]): Promise<boolean> {
  const res = await fetch("https://api.lakera.ai/v2/guard", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${LAKERA_GUARD_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messages,
      project_id: process.env.LAKERA_PROJECT_ID,
    }),
  });
  const data = await res.json() as { flagged: boolean };
  return data.flagged;
}
```

**Request shape:**
```json
{
  "messages": [
    { "role": "system", "content": "..." },
    { "role": "user",   "content": "<inbound message>" }
  ],
  "project_id": "project-XXXXXXXXXXX"
}
```

**Response shape:**
```json
{ "flagged": true, "metadata": { "request_uuid": "..." } }
```

With `breakdown: true` added to the request body, the response includes per-detector detail (prompt injection score, PII detection, etc.).

### Latency (HIGH confidence)

Sub-50ms p50 per Lakera's published spec. The latency scales with content length but Lakera applies smart chunking and parallelization with a hard latency cap. For typical SMS messages (< 200 chars) and short Parrot chat turns (< 500 chars) expect 20–40ms. This is within the budget for a pre-LLM guard call.

**Total turn budget impact:** Adds ~30ms to each inbound turn. Given the 70B model call is ~800–1200ms, this is a 2–4% increase — acceptable.

### Placement

Two callsites:

1. **Mastra student SMS workflow** (`apps/app` on Fly) — call `screen()` before passing message to the Mastra agent. Fail-open with logging if Guard returns an error (network unreachable, rate limited), to avoid blocking the SMS pipeline.
2. **Parrot Worker** (`internjobs-parrot` CF Worker) — call `screen()` before passing inbound message to the kimi-k2.6 Dashboard agent. Same fail-open posture.

Workers already use `fetch` natively. No change to the Worker runtime — this is a single `await fetch(...)` added to the inbound message handler.

### Pricing (MEDIUM confidence — post-Cisco acquisition, pricing page behind login)

| Plan | Cost | API calls/month | Notes |
|------|------|-----------------|-------|
| Community (free) | $0 | 10,000 | No credit card required |
| Pro | Contact sales | High volume | Dedicated email support, advanced detectors |
| Enterprise | Custom | Unlimited | SLA, SIEM integration |

**For the 5-10 pilot volume (~1,000 msgs/day = ~30,000/month):** The free Community tier at 10,000/month is likely insufficient for production pilot load. The Pro tier pricing is opaque post-Cisco acquisition — contact required.

**Pragmatic approach:** Start with free tier during v1.3 development and early pilot (first 2-3 weeks). If daily volume exceeds ~300 messages, initiate Pro contact. The fail-open posture means Guard degradation never blocks the product.

**Cisco acquisition note (May 2025):** Lakera Guard remains available as a standalone API. The Cisco AI Defense rebrand is underway but the `api.lakera.ai` endpoint and API key format are unchanged as of research date. Watch for endpoint deprecation notices.

### New secrets to add to Infisical

| Secret name | Path | Value source |
|-------------|------|--------------|
| `LAKERA_GUARD_API_KEY` | `/internjobs-ai` | Lakera dashboard → API keys |
| `LAKERA_PROJECT_ID` | `/internjobs-ai` | Lakera dashboard → project ID |

### No npm package — by design

The absence of an official SDK is actually favorable: zero dependency surface, no version pinning churn, and both the Fly Node runtime (Mastra) and the CF Worker runtime (Parrot) can call `fetch` identically. Write a shared `guard.ts` utility in `packages/shared/src/guard.ts` with the typed wrapper above, export it, import it in both callsites.

---

## (d) SEC-ROTATE — Credential Rotation

### Infisical Rotation (HIGH confidence)

Infisical's built-in Secret Rotation feature (available on all plans) supports two patterns:

- **Dual-phase rotation** (recommended): new credential overlaps with old for a window before old is revoked. Zero-downtime.
- **Single-phase rotation**: old credential invalidated immediately on rotation. Risky for live services.

For v1.3's four credential families, use the **manual dual-phase pattern** (Infisical's automation is primarily for database credentials and OAuth apps it manages directly — Clerk and Cloudflare tokens require the manual dual-phase approach below).

### Rotation Order — Safe Sequence

The critical risk is the Cloudflare AI API token: if the Worker loses its AI token while in-flight, it self-destructs. The safe sequence avoids any overlap between "token revoked" and "Worker not yet redeployed."

**Safe rotation order:**

```
1. Clerk students app (app_38BrRDRKnvbo7vlE2ZZtMc7hFPC)
   — Clerk supports multiple simultaneous active secret keys
   — Add new key → update CLERK_SECRET_KEY in Infisical → redeploy apps/app → verify /healthz → delete old key
   — Risk: none (overlap period has both keys valid)

2. Clerk workspace app (employees, workspace.internjobs.ai)
   — Same procedure as step 1 on the second Clerk app
   — Separate Clerk app, separate key rotation, no cross-contamination

3. Cloudflare Email API token
   — CF supports multiple simultaneous API tokens
   — Create new token with same Email Routing + Email Workers scopes → update Infisical → redeploy internjobs-email-ingest Worker → verify → revoke old token
   — Risk: brief window where both tokens exist; CF Email Routing is additive so both work concurrently

4. Cloudflare AI API token
   — HIGHEST RISK. This token is used by the Fly Mastra app (direct REST to api.cloudflare.com) for LLM + embeddings
   — DO NOT revoke old token until Fly app is redeployed and /healthz shows workersAiReady=true
   — Procedure: create new token (Workers AI scope on account_id) → update CLOUDFLARE_AI_API_TOKEN in Infisical → fly deploy internjobs-ai-student-app → verify workersAiReady=true → revoke old token
   — Self-destruct prevention: the Fly app reads the env var at startup, not per-request. A clean fly deploy with the new token value is atomic — old processes drain, new processes start with new token.

5. Broad-scope Cloudflare API token
   — Used by Infisical sync, Wrangler deploys, and any automation
   — Rotate LAST — this token is used to deploy Workers. If you revoke it before finishing steps 3+4, you lose the ability to push emergency fixes.
   — Procedure: create new token → update in Infisical AND any local .env / CI secrets → verify wrangler can deploy (test deploy internjobs-parrot) → revoke old token
```

### Infisical CLI pattern for secret update

```bash
# Install CLI if not present
brew install infisical/get-cli/infisical

# Authenticate
infisical login

# Update a single secret in prod
infisical secrets set CLERK_SECRET_KEY=sk_live_NEWVALUE \
  --projectId 26995afd-9a6f-4690-912f-01cbcebb76d5 \
  --env prod \
  --path /internjobs-ai

# Verify
infisical secrets get CLERK_SECRET_KEY \
  --projectId 26995afd-9a6f-4690-912f-01cbcebb76d5 \
  --env prod \
  --path /internjobs-ai
```

Infisical does NOT have built-in automation for Clerk or raw CF API tokens — those are manually issued through their respective dashboards and then stored in Infisical. Infisical is the update target, not the rotation initiator.

### Post-rotation verification checklist

| Service | Healthz key | Expected |
|---------|-------------|---------|
| `internjobs-ai-student-app` | `/healthz` → `clerk`, `workersAiReady` | `true` |
| `internjobs-parrot` Worker | `wrangler tail` or CF dashboard live logs | No 401s in first 5 requests |
| `internjobs-email-ingest` Worker | Send a test email to a catch-all address | Message appears in Mattermost |
| `internjobs-graph-api` (new) | `/healthz` | `{"ok": true}` |

---

## New Dependencies Summary

| Package | Version | Where | Purpose | Confidence |
|---------|---------|-------|---------|------------|
| `hono` | `^4.3.0` | `internjobs-graph-api` (new Fly app) | HTTP framework for graph proxy | HIGH |
| `falkordb` | `6.6.2` (pin) | `internjobs-graph-api` | FalkorDB client (matches `apps/app`) | HIGH |
| `oven/bun:1.1-alpine` | Docker base | `internjobs-graph-api` | Minimal Bun runtime | HIGH |
| _(no package)_ | — | `packages/shared/src/guard.ts` | Lakera Guard fetch wrapper | HIGH |

Zero new npm dependencies on the Parrot Worker or `apps/app` for SAFETY-01 — it is a pure `fetch` call.

---

## Architecture Impact

```
BEFORE (v1.2):
  Parrot Worker ──✗──→ internjobs-graph.internal:6379 (unreachable)

AFTER (v1.3):
  Parrot Worker ──fetch──→ internjobs-graph-api (Fly, Hono/Bun)
                                │
                          falkordb client
                                │
                        internjobs-graph.internal:6379 (FalkorDB)

SAFETY (both callsites):
  inbound SMS  ──fetch──→ api.lakera.ai/v2/guard ──(flagged?)──→ drop/log
  Parrot chat  ──fetch──→ api.lakera.ai/v2/guard ──(flagged?)──→ drop/log
```

The graph proxy is the only new deployable. Everything else is config or in-process code.

---

## Gaps and Open Questions

1. **Lakera Pro pricing** — Community tier (10k/month) likely insufficient at pilot scale (30k/month). Initiate Pro inquiry at pilot launch or when daily volume exceeds 300 messages. Flag for v1.3 execution planning.

2. **Workers VPC for future graph features** — Workers VPC (currently free beta) could eventually let the Parrot Worker reach the graph proxy without a Fly HTTP hop. Worth revisiting at GA when pricing is known. For now the Hono proxy is the correct path and can be retired if Workers VPC + HTTP service binding becomes viable.

3. **Cisco/Lakera API continuity** — `api.lakera.ai` endpoint unchanged as of 2026-05-19 but the Cisco rebrand is active. Set a calendar reminder at v1.4 kickoff to check for endpoint deprecation notices.

4. **`GRAPH_API_SECRET` rotation** — The new shared secret between the Parrot Worker and `internjobs-graph-api` should be included in the SEC-ROTATE procedure. Add it to the Infisical path before first deploy.

---

## Sources

- [Cloudflare Workers TCP Sockets — private IP restrictions](https://developers.cloudflare.com/workers/runtime-apis/tcp-sockets/)
- [Cloudflare Workers VPC — get started](https://developers.cloudflare.com/workers-vpc/get-started/)
- [redis-on-workers v0.4.2 (GitHub)](https://github.com/kane50613/redis-on-workers)
- [ioredis Cloudflare Workers TCP connector issue #1814](https://github.com/redis/ioredis/issues/1814)
- [Lakera Guard API — Guard endpoint](https://docs.lakera.ai/docs/api/guard)
- [Lakera Guard — Quickstart](https://docs.lakera.ai/docs/quickstart)
- [Lakera Guard pricing — Community 10k/month free](https://platform.lakera.ai/pricing)
- [Clerk — Rotate API keys (zero downtime)](https://clerk.com/docs/guides/secure/rotate-api-keys)
- [Infisical — Secret Rotation overview](https://infisical.com/docs/documentation/platform/secret-rotation/overview)
- [Hono on Bun — getting started](https://hono.dev/docs/getting-started/bun)
- [Fly.io + Bun blog post](https://fly.io/blog/flydotio-heart-bun/)
