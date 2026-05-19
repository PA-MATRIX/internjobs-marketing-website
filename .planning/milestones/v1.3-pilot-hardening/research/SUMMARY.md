# v1.3 Pilot Hardening — Research Summary

**Synthesized:** 2026-05-19
**Inputs:** STACK.md, FEATURES.md, ARCHITECTURE.md, PITFALLS.md
**Mode:** Milestone research (no project-level `/research/` — brownfield project)
**Overall confidence:** HIGH — all four dimensions grounded in live source code inspection and first-party docs

---

## 1. TL;DR — 7 Most Important Findings

1. **Fly REST proxy is the only viable FalkorDB bridge.** Workers RESP3 via `cloudflare:sockets` fails on two independent grounds: private IP blocking (`.internal` DNS is unreachable from Workers) and missing Cypher command support. This decision is closed. Ship `internjobs-graph-api` as a new Fly app (Hono/Node.js, `ord` region, `min_machines_running = 1` to stay warm).

2. **`graph.ts` has never executed against a real FalkorDB instance.** The Parrot Worker's full Cypher implementation was written in v1.2 but the transport was always broken. Treat this code as untested. A manual smoke test against production FalkorDB is required before enabling graph writes in the Worker.

3. **PARROT-AUTO-CLEAR has a hard dependency on PHASE14-RUNTIME.** This ordering must be explicit in the roadmap — these cannot run in parallel. The auto-clear cron also needs a minimum-open-window guard (5-minute grace period before resolving a newly-created todo) to prevent race-condition false clears.

4. **Lakera Guard is pre-LLM screening only; scope it to student SMS + email inbound.** Do NOT screen internal Mattermost messages from employees (wrong risk profile, wastes quota). Hard-block only on `prompt_injection` score ≥ 0.8. Every other flag is soft (logged, agent proceeds). Fail-open always — Lakera unavailability must never block student communication.

5. **Verify Lakera's current API before writing any code.** Cisco acquired Lakera in May 2025. The endpoint may have changed under the Cisco AI Defense rebrand. Sign up at `platform.lakera.ai` and confirm the current endpoint URL, auth format, and response schema before writing the integration. The Community free tier (10k/month) will be exhausted within the first month of pilot at 1k msgs/day.

6. **SEC-ROTATE covers 5 token families, not 4.** Clerk has two separate app instances (student + workspace). The `CLOUDFLARE_AI_API_TOKEN` is shared by both the Fly student app AND the Parrot Worker — rotate the student app first, verify `/healthz`, then update the Worker, then and only then revoke the old token. Rotating Clerk JWT Signing Keys is the nuclear option that signs out all users; rotate Secret Keys only.

7. **`EmployeeMailboxDO` is the highest-churn file in the codebase.** Read it completely before adding PARROT-AUTO-CLEAR's `resolveTodo` method. Migration number 8 is next. Add `resolution_source TEXT` column to the todos SQLite table and a `resolution_source: 'agent' | 'user' | null` field to the `TodoItem` interface.

---

## 2. Resolved Decisions

| Question | Verdict | Rationale |
|----------|---------|-----------|
| FalkorDB bridge: Fly REST proxy vs. Workers RESP3 client | **Fly REST proxy** (`internjobs-graph-api`, Hono/Node.js) | `cloudflare:sockets` blocks private IPs; RESP3 requires full custom frame parser + GRAPH.QUERY serializer; `falkordb` npm uses Node `net` module, crashes Workers at init regardless of `nodejs_compat`. Proxy keeps all Node-specific code on Fly where it works. |
| Runtime for graph proxy | **Node.js on Hono** (not Bun) | ARCHITECTURE.md recommends Node for consistency with `internjobs-ai-student-app`; STACK.md proposes Bun for image size. Node wins for operational consistency — same Docker pattern as the student app, no new runtime to support. |
| Graph proxy `min_machines_running` | **1 (always warm)** | Graph reads are on the Worker's critical path for dashboard loads. A cold FalkorDB connection (TCP + Redis auth handshake) on a cold Fly machine adds 500ms+ to operator dashboard load. |
| Lakera Guard: fail-open or fail-closed | **Fail-open** | Lakera downtime must not block student SMS. Log `lakera_unavailable` events. Revisit at 100+ active students. |
| Lakera Guard: which channels to screen | **Student SMS inbound + email inbound (unknown senders only)** | Mattermost messages are from known employees — wrong risk profile, unnecessary cost. Known startup senders skip the screen. |
| Auto-clear scheduler: CF Cron vs. DO alarm per employee | **CF Worker Cron Trigger, `*/5 * * * *`** | Pilot scale is 5-10 employees. Global scan is trivial. DO alarms per employee add bookkeeping complexity with no benefit at this scale. |
| Lakera Guard: shared npm module vs. two files | **Two files, same contract** — `apps/app/src/safety/screen.mjs` (Node) + `apps/parrot/workers/lib/safety.ts` (Worker) | ESM vs. TypeScript module system differences and different env injection paths make sharing fragile for a 30-line helper. |
| `SAFETY-01` scope: outbound agent message screening | **Deferred to v1.4** | System-prompt guardrails cover v1.3 scale. Outbound Lakera screening warranted only after a pilot startup reports harm. |
| SEC-ROTATE: which Clerk keys to rotate | **Secret Keys only** (both apps) | JWT Signing Key rotation signs out all users immediately. Secret Key rotation is zero-downtime via Clerk's multi-key overlap procedure. |
| Broad CF API token rotation approach | **Local env update first, then wrangler, then Infisical** | Wrangler does not auto-pull from Infisical. Token must be in the shell at time of wrangler invocation. |

---

## 3. How v1.3 Builds on the v1.2 Architecture

v1.2 left one structural gap: the Parrot Worker has full graph-aware code (`apps/parrot/workers/lib/graph.ts`) but no transport to reach FalkorDB. Everything else in v1.3 plugs into existing architecture without structural change.

**PHASE14-RUNTIME** introduces the only new deployable: `internjobs-graph-api`, a thin Fly app in `internjobs-sios-org`/`ord`. It sits between the Parrot Worker and FalkorDB, bridging the Worker's `fetch()` (HTTP) to the falkordb npm client (Redis wire protocol). The Worker's exported graph API (`recordTodoFact`, `getActiveTodos`, `getEmployeeContext`, etc.) stays identical — only the internal transport swaps from "try to import falkordb npm" to "POST to proxy." The student app's `graph.mjs` is unchanged — it already reaches FalkorDB directly on the Fly private network.

**PARROT-AUTO-CLEAR** adds a CF Worker Cron Trigger on the existing `internjobs-parrot` Worker plus a new `auto-clear.ts` module and a `resolveTodo` RPC method on `EmployeeMailboxDO`. No new deployable. The reconciliation loop is pure application code on top of the graph path that PHASE14-RUNTIME enables.

**SAFETY-01** inserts two `screenMessage()` calls into existing inbound handlers: one in `apps/app/src/webhooks/photon.mjs` (student SMS) and one in `apps/parrot/workers/lib/inbound-email.ts` (email ingest). No new deployable, no new infra — just a `fetch()` to `api.lakera.ai` before the LLM call at each site. The `/ops/safety` view is new UI within the existing Parrot Worker.

**SEC-ROTATE** is pure ops — token rotation across Clerk dashboards + Cloudflare dashboards + Infisical + redeploys. No code changes. Executes last so the definitive `/healthz` check is the green-board for the whole milestone.

---

## 4. New Requirements Discovered

These should land in REQUIREMENTS.md under v1.3 Active:

### PHASE14-RUNTIME
- `GET /healthz` on `internjobs-parrot` returns `"graph_ready": true` and `"graph_proxy_reachable": true` (two distinct fields to distinguish DB-down from proxy-down)
- `npm run smoke:parrot-graph` exits 0 with 6/6 invariants PASS
- A new inbound email triggers `extractTodosFromEmail`; log shows `{"event":"graph_context_injected","chars":>0}`
- `GRAPH_API_SECRET` and `GRAPH_API_URL` added to Infisical `/internjobs-ai` before first deploy; `FALKORDB_URL` and `FALKORDB_PASSWORD` removed from Parrot Worker env
- `internjobs-graph-api` fly.toml in `infra/graph-api/`; `min_machines_running = 1`
- Manual smoke test (4 operations: schema, record, query, context) passes against production FalkorDB before enabling in production

### PARROT-AUTO-CLEAR
- SQLite todos table: add `resolution_source TEXT` nullable column (migration 8 on `EmployeeMailboxDO`)
- `TodoItem` interface: add `resolution_source: 'agent' | 'user' | null`
- `GET /api/dashboard/todos?view=resolved` returns resolved todos with `resolution_source` and `resolved_at`
- `POST /api/dashboard/todos/:id/unresolve` (idempotent — sets `resolved_at = NULL`, `valid_to = NULL` in graph fail-soft)
- Auto-clear cron guards with `fact.valid_to < NOW() - INTERVAL '5 minutes'` (minimum-open-window race condition prevention)
- Auto-cleared todos animate out (CSS slide-up + fade, ~250ms) and appear in "Recently resolved" view with violet "Agent" pill + relative timestamp
- First auto-clear per session shows one-time toast; dismissed state persisted in localStorage per employee
- "Resolved" secondary nav item added to workspace dashboard
- Todo disappears from active list within 30 seconds of the triggering Mattermost reply

### SAFETY-01
- `POST /webhooks/photon`: `screenMessage()` called before any Mastra workflow step
- `receiveEmail()` in `inbound-email.ts`: `screenMessage()` called before `extractTodosFromText()`
- Mattermost ingest: NOT screened (internal channel, explicitly out of scope for v1.3)
- Hard-block rule: `prompt_injection` score ≥ 0.8, unconditional regardless of channel
- Soft-flag default: all other flags let message through, logged to `/ops/safety`
- Fail-open: Lakera timeout (>1s) or 5xx → `action = 'passed_lakera_unavailable'` log + message proceeds
- Student SMS hard-block response: "hey — couldn't process that one. try rephrasing?" (lowercase, no emojis, matches agent voice)
- Email hard-block: no auto-reply (out-of-office loop risk); logged in `/ops/safety` only
- `/ops/safety` route: flag log with channel, timestamp, human-readable reason label, 80-char truncated preview, last-4 sender identifier
- Red dot badge on safety nav item when any unreviewed flag exists within last 24h
- `LAKERA_GUARD_API_KEY` in Infisical at `/internjobs-ai`; not in any repo file or log
- `safety_events` in Neon (not per-employee DO SQLite) — operator view is cross-employee

### SEC-ROTATE
- Five token families rotated: Clerk student Secret Key, Clerk workspace Secret Key, CF Email API token, CF AI API token, CF broad-scope API token
- Rotation sequence per family: generate new → write Infisical → redeploy → verify `/healthz` green → revoke old
- `CLOUDFLARE_AI_API_TOKEN`: update student Fly app first (`workersAiReady: true`), then Parrot Worker, then revoke
- Clerk: Secret Keys only — never JWT Signing Keys
- Old tokens confirmed "Revoked" in Clerk + Cloudflare dashboards
- JWKS endpoint reachable post-rotation: `https://clerk.internjobs.ai/.well-known/jwks.json` returns valid JSON
- No error rate spike (≤ baseline) on either app in 15 minutes following rotation
- `GRAPH_API_SECRET` (new v1.3 credential) included in SEC-ROTATE scope — added to Infisical before first `internjobs-graph-api` deploy

---

## 5. Suggested Phase Breakdown

### Dependency Graph

```
Phase A: PHASE14-RUNTIME (graph proxy)
    │
    └──► Phase B: PARROT-AUTO-CLEAR (strictly blocked on A)

Phase C: SAFETY-01 (independent — can start in parallel once Lakera account provisioned)

Phase D: SEC-ROTATE (independent — run last for definitive green-board)
```

**Phase A — PHASE14-RUNTIME** (unblocks everything graph-related)

Deliver: `internjobs-graph-api` Fly app + `graph.ts` transport rewire.

Key tasks: (1) `infra/graph-api/` with `fly.toml`, `Dockerfile`, `src/index.mjs` (Hono/Node, `POST /query` + `GET /health`). (2) `GRAPH_API_SECRET` generated, written to Infisical, set on Worker + proxy. (3) `graph.ts`: remove dynamic falkordb import guard, replace with `fetch()` to `GRAPH_API_URL/query`. (4) `types.ts`: swap `FALKORDB_URL`/`FALKORDB_PASSWORD` for `GRAPH_API_URL`/`GRAPH_API_SECRET`. (5) Add `graph_proxy_reachable` to `/healthz`. (6) Manual smoke test: schema, recordTodoFact, getActiveTodos, getEmployeeContext — all shapes correct.

Ship gate: `graph_ready: true` + `graph_proxy_reachable: true` in production `/healthz`.

**Phase B — PARROT-AUTO-CLEAR** (after Phase A ships and is verified)

Deliver: cron-based todo auto-resolution + "Recently resolved" dashboard view.

Key tasks: (1) Add cron trigger to `wrangler.jsonc`: `"crons": ["*/5 * * * *"]`. (2) `scheduled` handler in `app.ts`. (3) New `workers/lib/auto-clear.ts` with minimum-open-window guard. (4) `resolveTodo(sourceId)` RPC on `EmployeeMailboxDO` (migration 8, `resolution_source TEXT` column). (5) `TodoItem` interface update. (6) Two new route handlers (`?view=resolved`, `/:id/unresolve`). (7) Frontend: "Resolved" nav, animate-out, badge, toast, undo. (8) Smoke test for cross-namespace Cypher query (`:Fact` → `:Todo` reconciliation).

Ship gate: reply to Mattermost thread → todo disappears within 5 minutes → visible in Resolved view with agent badge → Undo restores it.

**Phase C — SAFETY-01** (independent; start when Lakera account provisioned)

Deliver: pre-LLM screening on student SMS + email inbound, `/ops/safety` view.

Key tasks: (1) Sign up at `platform.lakera.ai` — confirm current API endpoint, auth format, response schema. (2) `LAKERA_GUARD_API_KEY` to Infisical + deployed to both surfaces. (3) `apps/app/src/safety/screen.mjs` (Node). (4) `apps/parrot/workers/lib/safety.ts` (Worker; 1s hard timeout, fail-open). (5) Insert calls in `photon.mjs` + `inbound-email.ts`. (6) `safety_events` table in Neon. (7) `/ops/safety` route + badge logic.

Ship gate: injection test SMS appears in `/ops/safety` as hard-blocked + student receives "hey — couldn't process that one" reply; benign SMS produces no log entry.

**Phase D — SEC-ROTATE** (last; no code changes)

Deliver: all five credential families rotated, old tokens revoked, `/healthz` green across all surfaces.

Order: Clerk student → Clerk workspace → CF Email → CF AI (student Fly first, then Worker) → CF broad-scope. Follow 5-step sequence for each: generate new → Infisical → redeploy → verify → revoke.

Ship gate: all `/healthz` green; old tokens "Revoked" in dashboards; no error rate spike for 15 minutes post-rotation.

---

## 6. Watch-For List — Top 5 Pitfalls

**1. Verify Lakera's current API before writing any code.** (PITFALL-SAFETY-02)
Cisco acquired Lakera in May 2025. The API endpoint, auth format, and response schema may have changed under the Cisco AI Defense rebrand. Blog posts and tutorials written before May 2025 may reference a deprecated API. Sign up and confirm before writing `screen.mjs` or `safety.ts`. Also confirm pricing — Community tier (10k/month) will be exhausted within the first pilot month at 1k msgs/day.

**2. Never revoke an old credential before the new one is live and verified.** (PITFALL-SEC-01, PITFALL-SEC-02, PITFALL-SEC-03)
Cloudflare has no grace period — a revoked token causes immediate 401s for all in-flight requests. The CF AI token is shared by both the Fly student app and the Parrot Worker; update and verify both before revoking. For the broad CF API token, update the local shell env first — Wrangler does not pull from Infisical automatically. Never batch-revoke multiple token families simultaneously.

**3. `graph.ts` has latent Cypher bugs — smoke test before enabling in production.** (PITFALL-14-04)
The Parrot Worker's graph code has never executed against a real FalkorDB. Known differences from the tested `graph.mjs`: Map-based client singleton (untested under concurrent requests), extra probe round-trip in `recordTodoFact`, simplified `getActiveTodos` LIMIT semantics. Run all four smoke test operations manually against production FalkorDB before routing real email traffic through the graph path.

**4. PARROT-AUTO-CLEAR needs a minimum-open-window guard.** (PITFALL-AC-01)
Without a grace period, the auto-clear cron can resolve a todo that was just created — the underlying fact may be superseded within minutes. Guard the reconciliation Cypher with `fact.valid_to < NOW() - INTERVAL '5 minutes'`. Without this, Ridhi sees todos flash and disappear before she can act — she will think the agent is broken.

**5. Read all of `EmployeeMailboxDO` before touching it.** (PITFALL-MISC-01)
Modified by 4 phases in v1.2 (phases 10, 11, 12, 13), 7 migrations, highest-coupling file in the codebase. PARROT-AUTO-CLEAR adds migration 8 and a `resolveTodo` RPC. A migration number collision or alarm handler name conflict corrupts DO state permanently — it does not reset on redeploy.

---

## 7. Proposed PROJECT.MD Updates

All "PROPOSED PROJECT.MD UPDATE" callouts from the four research docs, consolidated for a single-pass apply:

### Key Decisions — New Entries

| Decision | Rationale | Version |
|----------|-----------|---------|
| Fly REST proxy for FalkorDB bridge (PHASE14-RUNTIME) | The `falkordb` npm client crashes at module init on CF Workers runtime ("e.BigInt is not a function"). Workers RESP3 via `cloudflare:sockets` would require re-implementing RESP3 frame parsing + GRAPH.QUERY serialization. A thin Fly HTTP proxy (`internjobs-graph-api`) fronts FalkorDB with Bearer auth and lets the Worker use normal `fetch()`. The proxy runs in the same Fly org/region as FalkorDB (no latency penalty). Node.js on Fly runs the npm client without issue. | v1.3 |
| Lakera Guard fail-open policy (SAFETY-01) | If Lakera is unreachable, messages pass through with a `passed_lakera_unavailable` log entry. Fail-closed is deferred until pilot scale exceeds 100 active students. Fail-closed = Lakera downtime = SMS/email blackout, unacceptable for 5-10 startup pilot relationships. | v1.3 |
| PARROT-AUTO-CLEAR UX: animate-out, not silent delete | Todos auto-cleared by the agent animate out of the active list, appear in a "Recently resolved" view with "Resolved by agent" badge and timestamp, and support one-click undo. Silent delete rejected — Ridhi needs an audit trail and undo path to build trust in the agent before trusting disappearance = done. | v1.3 |
| SEC-ROTATE sequence: verify before revoking | Generate new → write Infisical → redeploy → verify `/healthz` green → only then revoke old. Cloudflare has no grace period on revoked tokens — a revoked CF AI token causes immediate 401s for in-flight student SMS turns. | v1.3 |

### Constraints — Add or Clarify

**Graph bridge pattern:**
> The Parrot Worker reaches FalkorDB exclusively via the `internjobs-graph-api` HTTP proxy (not via direct Redis/RESP3). The proxy is the only component that holds the `falkordb` npm client. Structural constraint: `cloudflare:sockets` TCP is stateless-per-request and cannot support the falkordb client's connection lifecycle. If future CF runtime versions support persistent TCP sockets with proper reconnect semantics, revisit.

**CLOUDFLARE_AI_API_TOKEN is shared:**
> The same Workers AI token (`CLOUDFLARE_AI_API_TOKEN`) is used by both the Fly student app (direct REST to `api.cloudflare.com`) and the Parrot Worker (via AI Gateway). Rotation must update the student app first, verify `/healthz` (`workersAiReady: true`), update the Worker, then revoke the old token.

**SEC-ROTATE covers 5 token families:**
> SEC-ROTATE covers 5 distinct tokens: Clerk student app Secret Key, Clerk workspace app Secret Key, CF Email API token, CF AI API token, CF broad-scope API token. The "4 credential families" shorthand in older planning docs is wrong — Clerk has two separate app instances.

**Clerk key rotation:**
> Rotate the Secret Key using Clerk's multi-key overlap procedure (add new → deploy → verify → delete old). NEVER rotate JWT Signing Keys unless there is a confirmed signing key compromise — this signs out all users across both Clerk apps simultaneously.

### ROADMAP.MD — Future Milestone Candidates

- **Outbound message safety screening** — Lakera Guard on agent output. Gate: first confirmed pilot startup report of an agent message that caused reputational harm.
- **Hard block escalation for SAFETY-01** — convert student SMS from soft-flag default to hard-block once 30 days of pilot data characterizes the false-positive rate.
- **Workers VPC revisit for graph bridge** — if Workers VPC reaches GA with viable pricing, the `internjobs-graph-api` Fly proxy may be retired in favor of a native CF service binding.

---

## 8. Open Questions to Resolve Before Pilot Launch

1. **Lakera API state post-Cisco acquisition.** Sign up at `platform.lakera.ai` before writing any integration code. Confirm the current endpoint URL, auth header format, response schema, and pricing. Pre-acquisition blog posts and tutorials are unreliable. High priority — gates all of Phase C.

2. **CF Email token inventory: two email tokens, which is live?** `workers/types.ts` declares `CLOUDFLARE_EMAIL_API_TOKEN` and `CLOUDFLARE_EMAIL_ROUTING_API_TOKEN` with different scopes. Before SEC-ROTATE: audit which one is in Infisical and which routes are live. Rotating the wrong one first can break the admin invite welcome email.

3. **Auto-clear Cypher cross-namespace query is untested.** The reconciliation loop queries `:Fact` nodes (student namespace) initiated from a Parrot Worker query (employee namespace) — different label namespaces, same physical FalkorDB. Write a targeted smoke test in Phase B that writes a `:Fact` with `valid_to` set then confirms the auto-clear marks the corresponding `:Todo`. Do not ship Phase B without this test passing.

4. **Lakera Guard latency on the student SMS critical path.** Instrument the call with `Date.now()` in Phase C. If p99 > 500ms consistently after the first week, move Lakera to a fire-and-forget pattern with a 200ms budget (accept that fast injections may slip through on high-latency Lakera days rather than penalize all students).

5. **`internjobs-graph-api` needs a health alert before pilot launch.** If the proxy goes down, the Parrot Worker's graph layer silently degrades (fail-soft, no crash). Add a Cloudflare Health Check or uptime alert on `https://internjobs-graph-api.fly.dev/health` so the operator knows when the proxy is down, not just when `graph_ready` is false.

---

## Sources

- Cloudflare Workers TCP Sockets — private IP restrictions: https://developers.cloudflare.com/workers/runtime-apis/tcp-sockets/
- Cloudflare Workers VPC — get started: https://developers.cloudflare.com/workers-vpc/get-started/
- CF workerd issue #1018 (socket timeout): https://github.com/cloudflare/workerd/issues/1018
- Lakera Guard API docs: https://docs.lakera.ai/docs/api/guard
- Lakera Guard pricing: https://platform.lakera.ai/pricing (MEDIUM confidence — post-acquisition)
- Clerk — Rotate API keys: https://clerk.com/docs/guides/secure/rotate-api-keys
- Infisical — Secret Rotation: https://infisical.com/docs/documentation/platform/secret-rotation/overview
- Hono — getting started: https://hono.dev/docs/getting-started/bun
- Live source: `apps/parrot/workers/lib/graph.ts` (code-complete, never executed against FalkorDB)
- Live source: `apps/app/src/memory/graph.mjs` (graphReady=true verified in production)
- v1.2 MILESTONE-AUDIT.md (file churn hotspots, EmployeeMailboxDO coupling)
