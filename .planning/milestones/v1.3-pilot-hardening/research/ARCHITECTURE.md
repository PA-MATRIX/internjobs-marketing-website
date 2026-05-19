# v1.3 Architecture: Delta Changes on v1.2

**Milestone:** v1.3 Pilot Hardening
**Date:** 2026-05-19
**Type:** Milestone Research — Architecture dimension
**Confidence:** HIGH (all findings derive from live source code inspection)

---

## 1. PHASE14-RUNTIME: Parrot Worker → FalkorDB Bridge

### Current State (v1.2, code-shipped-runtime-blocked)

`apps/parrot/workers/lib/graph.ts` already has the full Cypher API wired. The
`getGraphClient()` function performs a **dynamic import** of the `falkordb` npm
package inside an async wrapper precisely because the package fails at module
init on the Workers runtime with:

```
Uncaught TypeError: e.BigInt is not a function
```

This is documented in the source at line 51–67 of `graph.ts`. The dynamic
import catches that crash and returns `null`, leaving `graph_ready=false` in
`/healthz`. The `FALKORDB_URL` secret is declared in `wrangler.jsonc` and typed
in `workers/types.ts` but the Worker can never actually use it — the falkordb
npm client uses Node TCP sockets and BigInt which the Workers runtime does not
support.

The `internjobs-graph` Fly app has **no HTTP service** — only a Redis/6379 port
that is strictly internal to the `internjobs-sios-org` private network
(`internjobs-graph.internal:6379`). This is by design (from `infra/falkordb/fly.toml`):
there is no `[http_service]` block and no public IP.

### Chosen Path: Fly REST Proxy (`internjobs-graph-api`)

**Recommendation: thin Fly HTTP proxy, not a Workers RESP3 client.**

Rationale for rejecting Workers RESP3:
- The Redis wire protocol (RESP3) requires a persistent TCP connection. CF
  `cloudflare:sockets` supports one-shot TCP sockets per request, not
  persistent connections with reconnect logic. The `falkordb` npm client's
  connection management (singleton, reconnect on error, pipelining) cannot be
  replicated cleanly in the Workers stateless execution model.
- RESP3 over `cloudflare:sockets` would require writing a custom
  RESP3 frame parser + a Cypher-over-RESP3 serializer — essentially
  re-implementing the falkordb client in a runtime that doesn't support it.
- FalkorDB uses `GRAPH.QUERY` which is a custom Redis command. The raw RESP3
  response carries nested multi-bulk arrays (column names + rows). Parsing this
  correctly is non-trivial and untested.
- The existing `graph.ts` code in the Worker already has full Cypher logic; the
  ONLY missing piece is a transport that actually works. HTTP is the correct
  transport for a Worker.

Rationale for Fly REST proxy:
- `fetch()` in a Worker works perfectly to reach any HTTPS URL. The proxy runs
  in the same Fly org (`internjobs-sios-org`) and speaks HTTP internally.
- The proxy holds the `falkordb` npm client — running in Node.js on Fly where
  it works without issue. The proxy is a pass-through; it does not contain
  business logic.
- No new vendor dependency. No CF Tunnel to manage. No public FalkorDB port.

### Architecture Delta: `internjobs-graph-api` Fly App

**New app:** `internjobs-graph-api` in `internjobs-sios-org`, region `ord`
(co-located with `internjobs-graph` and `internjobs-ai-student-app` for low latency).

**Topology:**

```
Parrot Worker (CF)
    |
    | HTTPS POST /query
    | Authorization: Bearer GRAPH_API_SECRET
    v
internjobs-graph-api (Fly, ord)    <-- NEW
    |
    | redis://default:<pw>@internjobs-graph.internal:6379
    | (Fly internal network, no public exposure)
    v
internjobs-graph (Fly, ord)        <-- existing, unchanged
  FalkorDB on port 6379
```

**Auth model:** shared secret between Worker and proxy. The Worker sends:

```
Authorization: Bearer <GRAPH_API_SECRET>
```

`GRAPH_API_SECRET` is a random 32-byte hex token generated at setup time.
Stored in Infisical at `/internjobs-ai/GRAPH_API_SECRET`. Set on both:
- `internjobs-graph-api` via `flyctl secrets set GRAPH_API_SECRET=...`
- `internjobs-parrot` Worker via `wrangler secret put GRAPH_API_SECRET`

**Why not Cloudflare Access instead of shared secret?**
CF Access requires a CF Zero Trust plan and adding the proxy's public URL to an
Access policy. Shared secret is simpler, auditable, and rotation fits the
existing SEC-ROTATE pattern. The proxy is not a user-facing surface — it is
only called by the Worker. A scoped shared secret is the right tool here.

**Why not Fly internal-only + Fly Tunnel?**
`internjobs-graph-api` needs to be reachable from *outside* Fly (from CF
Workers). A Fly-internal-only app would require a Cloudflare Tunnel or WireGuard
to reach it, which adds operational overhead. Exposing `graph-api` as a
public-HTTPS Fly app with Bearer auth is simpler and matches how
`internjobs-mattermost` is already exposed publicly.

**API surface (minimal):**

```
POST /query
  Authorization: Bearer <secret>
  Content-Type: application/json
  Body: { "cypher": "...", "params": { ... } }
  → { "data": [...], "stats": {...} }

GET /health
  → { "ok": true }
```

No other endpoints needed. The Worker's `graph.ts` module is the only caller.

**Worker-side change:** Replace the dynamic `falkordb` import path in
`workers/lib/graph.ts` with an HTTP fetch helper. The exported API surface
(`getGraphClient`, `recordTodoFact`, `getActiveTodos`, `pingParrotGraph`, etc.)
stays identical — callers see no change. The internal transport switches from
"try to connect via npm client" to "POST to proxy".

**Env var change for Worker (`wrangler.jsonc` + `types.ts`):**
- Remove: `FALKORDB_URL`, `FALKORDB_PASSWORD` (Worker no longer speaks Redis directly)
- Add: `GRAPH_API_URL` (e.g. `https://internjobs-graph-api.fly.dev`)
- Add: `GRAPH_API_SECRET` (Bearer token, set via `wrangler secret put`)

**Student app:** No change. `apps/app/src/memory/graph.mjs` continues to use
the `falkordb` npm client directly via `redis://default:<pw>@internjobs-graph.internal:6379`
(Node.js on Fly, same private network — this path already works and is in production).

**`internjobs-graph-api` implementation notes:**
- Hono on Node.js (consistent with `internjobs-ai-student-app` patterns)
- Single route: `POST /query`
- Validates Bearer token (constant-time compare)
- Creates a single FalkorDB client singleton (same lazy-connect pattern as `graph.mjs`)
- Passes `cypher` + `params` to `client.selectGraph("internjobs").query(cypher, { params })`
- Returns `{ data: res.data, stats: res.stats }` — no transformation
- `GET /health` probes FalkorDB with `RETURN 1`
- Fly `[http_service]` on port 3000; `force_https = true`
- `min_machines_running = 1` (always warm; the Worker cannot afford a cold-start
  FalkorDB connect on the critical path of an employee dashboard load)

**New Fly app `fly.toml`:**

```toml
app = "internjobs-graph-api"
primary_region = "ord"

[build]
  dockerfile = "Dockerfile"

[env]
  NODE_ENV = "production"
  PORT = "3000"

[http_service]
  internal_port = 3000
  force_https = true
  auto_stop_machines = "off"    # keep warm; cold starts hurt Worker latency
  min_machines_running = 1

[[vm]]
  memory = "256mb"
  cpu_kind = "shared"
  cpus = 1
```

**Infisical secrets to add:**
- `/internjobs-ai/GRAPH_API_SECRET` — shared Bearer token
- `/internjobs-ai/GRAPH_API_URL` — `https://internjobs-graph-api.fly.dev`
  (also set in `wrangler.jsonc` vars or via `wrangler secret put`)

---

## 2. PARROT-AUTO-CLEAR: Todo Auto-Resolution Scheduler

### Dependency

PARROT-AUTO-CLEAR is strictly sequenced after PHASE14-RUNTIME. The
reconciliation loop must be able to call Cypher on FalkorDB to (a) scan
`:Todo` nodes with `valid_to IS NULL` and (b) set `valid_to = now()` when the
underlying student-app `:Fact` has been closed out. This requires an active
`GRAPH_API_URL` path.

### Scheduler Options Analysis

**Option (a): CF Worker Cron Trigger on `internjobs-parrot`**

Cron triggers run a named scheduled handler on a fixed schedule (e.g.
`"*/5 * * * *"`). The Worker can call `GRAPH_API_URL/query` the same way the
request path does — no new primitives.

Pros: zero new infrastructure, managed by Cloudflare, deploys with the Worker.
Cons: runs for ALL employees globally — the reconciliation loop must batch
by employee (query all `:Employee` nodes, walk their `:HAS_TODO` edges). At
pilot scale (5-10 employees) this is trivial. At 1000 employees it becomes a
long cron run; but that is a v1.5+ problem.

**Option (b): Durable Object alarm per-employee**

Each `EmployeeMailboxDO` instance can schedule an alarm. The alarm handler runs
in the DO context and can call the graph API. This would give per-employee
reconciliation cadence with no global scan.

Cons: alarms require non-trivial bookkeeping (each DO must self-reschedule;
missed alarms on evicted DOs can leave stale todos for hours). The
`EmployeeMailboxDO` already calls `recordTodoFact()` fire-and-forget — adding
alarm-based reconciliation couples the DO to the graph layer more tightly than
is warranted at pilot scale. Alarm-per-employee only has a meaningful advantage
at thousands of employees where the global scan becomes expensive.

**Option (c): Fly cron on `internjobs-ai-student-app`**

The student app is the only Fly process that currently has a long-lived Node
process suitable for running a timer. However, the auto-clear loop is
**Parrot-side** state (employee `:Todo` nodes in FalkorDB), not student-side.
Coupling the reconciliation loop to the student app creates a cross-ownership
dependency: a student app deploy or restart would pause employee todo clearing.

**Option (d): Attach to the Dashboard Mothership tick**

The Dashboard Mothership runs on the `EmployeeMailboxDO` alarm path (Option b
variant) — it polls Mattermost and extracts todos when the alarm fires. Piggybacking
reconciliation here is tempting but creates a conceptual tangle: the mothership
is an ingest path, not a reconciliation path. Mixing them complicates future
separation when the two need different schedules.

### Recommendation: Option (a) — CF Worker Cron Trigger

**Rationale:** Pilot scale is 5-10 employees. A 5-minute cron on the Worker is
the lowest-friction path that matches how CF Workers typically handle periodic
background work. It has no new infrastructure, deploys atomically with the
Worker, and the reconciliation logic is a single `graph.ts` function call.

If the pilot grows to hundreds of employees and the global scan becomes a
bottleneck, migrate to Option (b) at that point — the reconciliation Cypher is
already written.

### Architecture Delta: Auto-Clear Cron

**`wrangler.jsonc` addition:**

```jsonc
"triggers": {
  "crons": ["*/5 * * * *"]
}
```

**Worker `app.ts` addition:**

```typescript
export default {
  fetch: app.fetch,
  async email(...) { ... },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runAutoClear(env));
  }
};
```

**New function `workers/lib/auto-clear.ts`:**

The reconciliation logic lives here, separate from `graph.ts` (which is a
low-level Cypher helper). The auto-clear module:

1. Calls `GRAPH_API_URL/query` with a Cypher that finds all `:Todo` nodes
   where `valid_to IS NULL` and `source_channel = 'email'` or `'chat'`.
2. For each todo, checks whether its backing fact in the student-app namespace
   has been closed out. **Practically:** the student-app `:Fact` close-out
   happens via `recordFact()` in `graph.mjs` when a conflicting new fact is
   written — this sets `valid_to` on the old fact. The auto-clear loop queries:

   ```cypher
   MATCH (f:Fact {source_message_id: $sourceId})
   WHERE f.valid_to IS NOT NULL
   RETURN f.valid_to
   ```

   If the `:Fact` has a `valid_to`, the corresponding `:Todo` is resolved.

3. Sets `valid_to = now()` on the resolved `:Todo` and writes the same
   resolved status to the `EmployeeMailboxDO` via its `resolveTodo(sourceId)`
   RPC (so the Dashboard UI reflects the change without a page reload).

**Step 3 requires `EmployeeMailboxDO` to expose a `resolveTodo(sourceId)` RPC.**
This is a new DO method — small addition to `durableObject/index.ts`.

**Cron timing:** 5-minute interval. Fast enough for pilot UX (a closed-out
fact is cleared from the dashboard within 5 minutes), low enough not to
hammer FalkorDB at idle (each run is one Cypher scan + N update queries for
however many todos closed since the last run).

---

## 3. SAFETY-01: Lakera Guard Insertion Points

### Context

The system has two distinct agent surfaces that process untrusted inbound text
before sending it to an LLM:

1. **Fly Node / Mastra workflow** (`apps/app/src/`) — student SMS inbound via
   Photon/Spectrum webhook (`/webhooks/photon`). LLM is `@cf/meta/llama-3.3-70b-instruct-fp8-fast`
   via Workers AI direct REST (`CLOUDFLARE_AI_API_TOKEN`). The student's raw SMS
   text reaches the agent as part of the `messages` array.

2. **Parrot Worker** (`apps/parrot/workers/`) — employee-facing. Inbound
   sources: Mattermost messages (polled via `EmployeeMailboxDO` alarm),
   inbound email (via the `email()` handler in `app.ts`), and the Dashboard
   Mothership extraction path. LLM is `kimi-k2.6` via Cloudflare AI Gateway.

### Lakera Guard API

Lakera Guard is a REST API. POST `https://api.lakera.ai/v1/prompt_injection`
with `{ "input": "<text to screen>" }` and `Authorization: Bearer <LAKERA_API_KEY>`.
Returns `{ "results": [{ "categories": { "prompt_injection": bool, ... } }] }`.

It is purely a screening HTTP call — no SDK, no framework coupling, no
runtime-specific dependencies. It works from both Node.js and CF Workers via
`fetch()`.

### Unified Module Strategy: Two Implementations, Same Contract

**Do NOT share a single `safety/screen.mjs` between Fly and Worker.** The module
systems differ (ESM `.mjs` on Node vs TypeScript with `nodejs_compat` on the
Worker), and the Infisical/env injection path differs (Fly reads from process.env,
Worker reads from the `Env` binding object passed through Hono context). Sharing
a module requires a build step or symlink that adds fragility for a 30-line helper.

Instead: two files, identical contract, copy-pasted logic (3 lines of fetch):

- `apps/app/src/safety/screen.mjs` — Node, reads `process.env.LAKERA_API_KEY`
- `apps/parrot/workers/lib/safety.ts` — Worker TypeScript, accepts `env.LAKERA_API_KEY`

The function signature is the same in both:

```typescript
async function screenMessage(text: string, apiKey: string): Promise<{
  blocked: boolean;
  reason?: string;
}>;
```

Returns `{ blocked: true, reason: "prompt_injection" }` or `{ blocked: false }`.
Never throws — network errors and non-2xx responses degrade to `{ blocked: false }`
with a warning log. Safety screening must not prevent the agent from responding
when Lakera is temporarily unreachable (fail-open is the correct posture for a
pilot where Lakera is a new dependency).

### Insertion Points

**Mastra workflow (Fly Node):**

The insertion point is `apps/app/src/webhooks/photon.mjs` (or wherever the
Spectrum/Photon webhook handler calls into the Mastra workflow). The raw
student SMS `body` arrives before `runAgent()` or the equivalent Mastra step.
Screen it there:

```
inbound SMS body
    → screenMessage(body, LAKERA_API_KEY)     ← NEW
    → [blocked] → log + reply "i didn't understand that, can you say it differently?"
    → [pass]    → getStudentSummary() + buildPrompt() + callWorkersAI()
```

**Do NOT put it inside a Mastra tool call.** The tool call is too late — by the
time the first tool runs, the full user message is already in the LLM's context
window. Screen before the message reaches the agent step.

**Parrot Worker:**

There are two inbound paths that produce untrusted text for the Dashboard
Mothership:

1. **Email ingest:** `workers/lib/inbound-email.ts` → `receiveEmail()` →
   `extractTodosFromText()` in `workers/lib/ai.ts`. Screen the email body
   inside `receiveEmail()` before calling `extractTodosFromText()`.

2. **Mattermost ingest:** `EmployeeMailboxDO` alarm handler polls Mattermost
   posts and feeds them to `extractTodosFromText()`. Screen post bodies before
   that call.

```
email body / Mattermost post body
    → screenMessage(body, env.LAKERA_API_KEY)     ← NEW
    → [blocked] → log warning; skip todo extraction for this message
    → [pass]    → extractTodosFromText(body, env)
```

The Parrot LLM path (kimi-k2.6 extracting todos from the email/chat text) is
a **data extraction call**, not a conversational one — prompt injection risk is
lower than on the student SMS path. Nevertheless, screen it: a malicious sender
could craft an email designed to pollute the todo list or extract system-prompt
content via the `getEmployeeContext` block.

**NOT at the HTTP webhook level.** The Parrot Worker does not have a dedicated
"Mattermost webhook inbound" endpoint today (it polls, via alarm). The email
handler (`email()` in `app.ts`) is the closest thing to a webhook. Screen at
the point of extraction, not at the transport layer — this keeps the safety
check co-located with the LLM call it protects.

### Env var additions

- **Fly student app:** `LAKERA_API_KEY` — Infisical `/internjobs-ai/LAKERA_API_KEY`,
  set via Fly secrets (`flyctl secrets set LAKERA_API_KEY=...`)
- **Parrot Worker:** `LAKERA_API_KEY` — same Infisical path, set via
  `wrangler secret put LAKERA_API_KEY`
- **Infisical:** Single source: `/internjobs-ai/LAKERA_API_KEY`

Both apps share the same Lakera project/API key (one Lakera account for pilot
scale). If per-surface rate limits become a concern in v1.4, split into two keys.

---

## 4. SEC-ROTATE: Credential Dependency Graph

### Complete Token Inventory

```
Token                          | Consumes                        | Used By
-------------------------------|----------------------------------|-----------------------------------
CLERK_SECRET_KEY               | Student Clerk app (app_38B...)  | apps/app (Fly Node) — @clerk/backend
                               |                                  | SDK.authenticateRequest()
CLERK_PUBLISHABLE_KEY          | Student Clerk app               | apps/app (Fly Node, browser)
                               |                                  | apps/marketing (browser)
PARROT_CLERK_SECRET_KEY        | Employee Clerk app              | apps/parrot Worker — wrangler secret;
                               |                                  | also clerk-admin.ts for invite flow
PARROT_CLERK_JWKS_URL          | Employee Clerk app JWKS         | apps/parrot Worker — jose jwtVerify
PARROT_CLERK_PUBLISHABLE_KEY   | Employee Clerk app              | apps/parrot Worker — browser Clerk init
CLOUDFLARE_AI_API_TOKEN        | Workers AI (account-scoped)     | apps/app (Fly Node) — direct REST to
                               |                                  | api.cloudflare.com/.../ai/run/...
                               |                                  | apps/parrot Worker — AI Gateway fetch
                               |                                  | (both use this same token)
CLOUDFLARE_EMAIL_API_TOKEN     | CF Email Service REST API       | apps/parrot Worker — workers/lib/email.ts
                               |                                  | (outbound agent email via CF Email Service)
CLOUDFLARE_EMAIL_ROUTING_API_TOKEN | CF Email Routing rules API  | apps/parrot Worker — worker/lib/* for
                               |                                  | provisioning per-employee email routing
                               |                                  | rules at invite time
Broad CF API token             | All CF zones/accounts           | Used during wrangler deploy by CLI
                               |                                  | (NOT a runtime Worker secret)
FALKORDB_URL (encodes password)| FalkorDB Redis auth             | apps/app (Fly Node) — graph.mjs connect
                               |                                  | (After PHASE14-RUNTIME ships: also
                               |                                  |  internjobs-graph-api Fly app)
GRAPH_API_SECRET               | internjobs-graph-api proxy auth | apps/parrot Worker — NEW in v1.3
                               |                                  | internjobs-graph-api Fly app
LAKERA_API_KEY                 | Lakera Guard API                | apps/app (Fly Node) — NEW in v1.3
                               |                                  | apps/parrot Worker — NEW in v1.3
MATTERMOST_BOT_TOKEN           | Mattermost REST API             | apps/parrot Worker — lib/mattermost.ts
DAILY_API_KEY                  | Daily.co REST API               | apps/parrot Worker — lib/daily.ts
OIDC_SIGNING_KEY               | OIDC id_token signing (RS256)   | apps/parrot Worker — routes/oidc.ts
PUSH_VAPID_PRIVATE_KEY         | Web Push VAPID signing          | apps/parrot Worker — lib/vapid.ts
SENTRY_DSN                     | Sentry ingestion                | apps/parrot Worker — index.ts
```

### Rotation Order for SEC-ROTATE (four primary targets)

**Constraint:** The `CLOUDFLARE_AI_API_TOKEN` is shared between the student Fly
app (direct REST to Workers AI) and the Parrot Worker (via AI Gateway). This
is the key ordering constraint — if you rotate this token and update the
Parrot Worker first but not the student app, student SMS responses will fail
silently. Conversely, update the student app first and deploy before rotating
the Worker.

**Safe rotation order:**

```
Step 1: Generate new tokens (offline, nothing deployed yet)
  - New CLERK_SECRET_KEY + CLERK_PUBLISHABLE_KEY (student Clerk app)
  - New PARROT_CLERK_SECRET_KEY + PARROT_CLERK_PUBLISHABLE_KEY + new PARROT_CLERK_JWKS_URL
    (the JWKS URL only changes if you rotate the Clerk app's signing key, not
     normally — confirm in Clerk dashboard)
  - New CLOUDFLARE_AI_API_TOKEN (scoped to Workers AI only, accounts:read + ai:write)
  - New CLOUDFLARE_EMAIL_API_TOKEN (scoped to Email Service: accounts:email:write)

Step 2: Update student Fly app first
  - flyctl secrets set CLERK_SECRET_KEY=<new> CLOUDFLARE_AI_API_TOKEN=<new>
  - Fly re-deploys apps/app automatically on secret update
  - Verify /healthz: { workersAiReady: true, clerkReady: true }

Step 3: Update Parrot Worker
  - wrangler secret put PARROT_CLERK_SECRET_KEY (new value)
  - wrangler secret put CLOUDFLARE_AI_API_TOKEN (same new value as Step 2)
  - wrangler secret put CLOUDFLARE_EMAIL_API_TOKEN (new value)
  - wrangler deploy (or wait for next scheduled deploy — secrets take effect on
    next Worker cold start, which happens within minutes under normal load)
  - Verify /healthz: { ai_gateway_reachable: true, mattermost_reachable: true }

Step 4: Revoke old tokens
  - In Cloudflare dashboard, revoke the old Workers AI token
  - In Cloudflare dashboard, revoke the old Email API token
  - In Clerk dashboard, invalidate old secret keys
  - DO NOT revoke until /healthz is green across both surfaces

Step 5: Broad CF API token (developer CLI token)
  - This is NOT a runtime secret — it is used only for wrangler deploy and
    flyctl operations from the developer machine.
  - It is NOT stored in any Worker or Fly app's runtime environment.
  - Rotate via Cloudflare dashboard: create a new scoped token
    (Workers Scripts: Edit, R2: Edit, Email Routing: Edit, KV Namespace: Edit)
    and update the local ~/.config/wrangler/config.json or
    CLOUDFLARE_API_TOKEN env var in the CI/deployment environment.
  - This rotation is entirely offline from the running services — no deploy
    needed, no /healthz impact.
```

**The "Worker losing its own auth" trap:**

The concern is: if you rotate `CLOUDFLARE_AI_API_TOKEN` (which the Parrot
Worker uses to call the AI Gateway for kimi-k2.6) but the old token is revoked
before the new secret propagates to the Worker, the Dashboard Mothership stops
extracting todos. Mitigation: Step 4 (revoke old tokens) happens AFTER Step 3
deploy + /healthz green. The old token remains valid for a 5-minute overlap window.

`PARROT_CLERK_SECRET_KEY` is used only for JWT verification (JWKS-based via
`jose`) and for the `/api/admin/invite` Clerk Backend API call. Rotating it
does not affect existing sessions (which are validated against the JWKS, not
the secret key directly). Sessions stay valid through rotation.

### What to Update in Infisical After Rotation

Every rotated secret must be updated in Infisical at
`project 26995afd, env prod, path /internjobs-ai` before running `wrangler secret put`
or `flyctl secrets set`. Infisical is the source of truth; the deployment
commands read from it.

---

## Component Summary: v1.3 Delta

| Component | v1.2 State | v1.3 Delta |
|-----------|-----------|------------|
| `apps/parrot/workers/lib/graph.ts` | Dynamic import, always returns null in prod | Replace with HTTP fetch to `GRAPH_API_URL` |
| `apps/parrot/workers/types.ts` | `FALKORDB_URL`, `FALKORDB_PASSWORD` | Replace with `GRAPH_API_URL`, `GRAPH_API_SECRET` |
| `apps/parrot/wrangler.jsonc` | No cron trigger | Add `"triggers": { "crons": ["*/5 * * * *"] }` |
| `apps/parrot/workers/app.ts` | `fetch` + `email` handlers | Add `scheduled` handler calling `runAutoClear` |
| `apps/parrot/workers/lib/auto-clear.ts` | Does not exist | New: cron reconciliation logic |
| `apps/parrot/workers/lib/safety.ts` | Does not exist | New: Lakera Guard screen helper |
| `apps/parrot/workers/lib/inbound-email.ts` | No safety gate | Add `screenMessage()` before `extractTodosFromText()` |
| `apps/parrot/workers/durableObject/index.ts` | No `resolveTodo` RPC | Add `resolveTodo(sourceId: string)` method |
| `apps/app/src/safety/screen.mjs` | Does not exist | New: Lakera Guard screen helper (Node) |
| `apps/app/src/webhooks/photon.mjs` (or equivalent) | No safety gate | Add `screenMessage()` before agent call |
| `internjobs-graph-api` Fly app | Does not exist | New: thin REST proxy for FalkorDB |
| `infra/graph-api/` (new dir) | Does not exist | New: `fly.toml` + `Dockerfile` + `src/index.mjs` |

---

## Phase Boundaries (for Roadmap)

Given the dependency chain, clean phase cuts are:

**Phase A — PHASE14-RUNTIME:** Ship `internjobs-graph-api` Fly app +
update `graph.ts` transport. Verify `/healthz` shows `graph_ready: true` on
the Parrot Worker. No cron yet — manually verify graph reads/writes via the
smoke script pointed at the proxy. This phase unblocks everything else that
touches the graph.

**Phase B — PARROT-AUTO-CLEAR:** After Phase A is live. Add cron trigger +
`auto-clear.ts` + `resolveTodo` DO RPC. This is graph-dependent and DO-dependent
but has no bearing on safety.

**Phase C — SAFETY-01:** Independent of graph. Can run in parallel with
Phase A/B. Requires only Lakera signup (get API key) + 30 lines of code in
two places. Lowest-effort phase. Can ship first if the Lakera account is
provisioned before the graph proxy is complete.

**Phase D — SEC-ROTATE:** Independent of code changes. Pure ops: generate new
tokens, deploy in order, verify, revoke old. Should happen last so that the
final `/healthz` check is the definitive green-board for v1.3.

---

## PROPOSED PROJECT.MD UPDATES

**PROPOSED PROJECT.MD UPDATE (Constraints section):**

> **Graph bridge pattern:** The Parrot Worker reaches FalkorDB exclusively via
> the `internjobs-graph-api` HTTP proxy (not via direct Redis/RESP3). The proxy
> is the only component that holds the `falkordb` npm client. This is a
> structural constraint: `cloudflare:sockets` TCP is stateless-per-request and
> cannot support the falkordb client's connection lifecycle. If future CF runtime
> versions support persistent TCP sockets with proper reconnect semantics, this
> constraint should be revisited.

**PROPOSED PROJECT.MD UPDATE (Key Decisions):**

> | Fly REST proxy for FalkorDB bridge (v1.3 PHASE14-RUNTIME) | The `falkordb` npm client crashes at module init on CF Workers runtime ("e.BigInt is not a function"). Workers RESP3 via `cloudflare:sockets` would require re-implementing RESP3 frame parsing + GRAPH.QUERY serialization. A thin Fly HTTP proxy (`internjobs-graph-api`) fronts FalkorDB with Bearer auth and lets the Worker use normal `fetch()`. The proxy runs in the same Fly org/region as FalkorDB (no latency penalty). Node.js on Fly runs the npm client without issue. | v1.3 |

**PROPOSED PROJECT.MD UPDATE (Key Decisions):**

> | Fail-open for Lakera Guard (v1.3 SAFETY-01) | Lakera Guard is pre-LLM screening for prompt injection. Network errors from Lakera degrade to `{ blocked: false }` with a warning log — the agent responds normally. Fail-closed would mean Lakera downtime = SMS/email blackout, which is unacceptable for a pilot with 5-10 startup relationships in-flight. | v1.3 |

**PROPOSED PROJECT.MD UPDATE (Constraints section):**

> **CLOUDFLARE_AI_API_TOKEN is shared:** The same Workers AI token is used by
> both the Fly student app (direct REST to `api.cloudflare.com`) and the
> Parrot Worker (via AI Gateway). Rotation of this token must update the
> student app first, then the Worker, then revoke the old token. See
> `.planning/milestones/v1.3-pilot-hardening/research/ARCHITECTURE.md`
> for the safe rotation order.

---

## Open Questions

1. **Lakera Guard latency:** Lakera adds a synchronous round-trip before the
   LLM call on the student SMS path. If Lakera's P99 exceeds ~500ms, it will
   noticeably slow the first-response feel of student conversations. Measure
   this in Phase C smoke tests; if latency is high, move Lakera to
   fire-and-forget with a 200ms budget and log-only on timeout (accept that
   very fast prompt injections may slip through on high-latency Lakera days).

2. **`internjobs-graph-api` is a new SPOF:** If the proxy goes down, the
   Parrot Worker's graph layer goes silent (fail-soft, so no crash, but todos
   stop accumulating in the graph). Consider adding a CF Health Check alert
   on `https://internjobs-graph-api.fly.dev/health` before pilot launch.

3. **Auto-clear Cypher cross-namespace query:** The reconciliation loop needs
   to check `:Fact` nodes (student namespace) from a query initiated by the
   Parrot Worker (employee namespace). These are different label namespaces
   in the same physical graph. The query is valid Cypher but untested at this
   writing — include a smoke test in Phase B that writes a `:Fact` with
   `valid_to` set and confirms the auto-clear marks the corresponding `:Todo`.

4. **`CLOUDFLARE_EMAIL_ROUTING_API_TOKEN` vs `CLOUDFLARE_EMAIL_API_TOKEN`:**
   The `Env` type in `workers/types.ts` declares two separate email-related
   tokens with different scopes. Verify which one is actually stored in
   Infisical and which routes are live before rotation — rotating the wrong
   one first could break the admin invite welcome email.
