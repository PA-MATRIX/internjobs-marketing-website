# Domain Pitfalls: v1.3 Pilot Hardening

**Milestone:** v1.3 Pilot Hardening
**Researched:** 2026-05-19
**Scope:** PHASE14-RUNTIME, PARROT-AUTO-CLEAR, SAFETY-01, SEC-ROTATE, cross-item

---

## Critical Pitfalls

Mistakes that cause rewrites, data loss, or security incidents.

---

### PITFALL-14-01: `falkordb` npm crashes Workers at module init — already documented in code, but the fix path is non-obvious

**What goes wrong:** The `falkordb` npm package uses Node's `net` module and `BigInt` at import time. The Parrot Worker already handles this with a dynamic `import()` guarded by `loadFalkorDBCtor()` in `apps/parrot/workers/lib/graph.ts` (lines 53–98). The comment there is accurate. **The trap:** the dynamic import guard passes the import-time crash, but the `FalkorDB.connect()` call itself internally uses Node TCP socket patterns that also fail in the Workers runtime — so even after the import succeeds in a nodejs_compat environment, `connect()` may throw a second, different error. The guard logs `parrot_graph_falkordb_import_failed` for the import crash, but a runtime crash inside `connect()` after a successful import would fall through to `parrot_graph_client_connect_failed` and look identical from the outside — the `graph_ready=false` signal masks whether the problem is the import or the connection.

**Why it happens:** `cloudflare:sockets` requires the caller to use `connect()` from `cloudflare:sockets` directly — not Node's `net.createConnection`. The `falkordb` npm client uses Node's `net` module internally, so even with `nodejs_compat` flag it cannot reuse that socket in a CF Worker without a shim. This is a fundamental runtime incompatibility, not a configuration gap.

**Consequences:** If the chosen PHASE14-RUNTIME path is Workers RESP3 (option b), this means the Worker cannot call `falkordb` npm at all — you need a from-scratch RESP3 implementation using `cloudflare:sockets`. If the chosen path is Fly REST proxy (option a), the `falkordb` npm import guard in `graph.ts` becomes dead code that can be removed, but leaving it in creates a false impression that a future npm-based path is viable.

**Prevention:**
- Decide the activation path (REST proxy vs. RESP3) before writing any new graph code. Don't let ambiguity persist.
- If REST proxy: gut the dynamic import in `graph.ts`, replace with `fetch()` calls to `internjobs-graph-api.internal`. The existing function signatures (`recordTodoFact`, `getActiveTodos`, etc.) can stay — only the transport layer changes.
- If RESP3: write a minimal RESP3 client using `cloudflare:sockets` (`connect()` from `'cloudflare:sockets'`). Test with a plain Redis `PING` before touching Cypher. FalkorDB speaks Redis wire protocol, so a working Redis RESP3 client should work for `GRAPH.QUERY` too — verify this with a trivial query (`RETURN 1`) before porting the full Cypher statements.

**Detection:** `graphReady=false` in `/healthz` with log line `parrot_graph_falkordb_import_failed` OR `parrot_graph_client_connect_failed`. If both are absent and `graphReady` is still false, check for a silent connection timeout (see PITFALL-14-03).

---

### PITFALL-14-02: Fly `.internal` DNS is only reachable from within the same Fly org private network — CF Workers cannot reach it directly

**What goes wrong:** `internjobs-graph.internal:6379` is a Fly private DNS name, only resolvable inside `internjobs-sios-org`. A CF Worker calling this URL will get a DNS resolution failure, not a connection refused. The URL will be passed to either `fetch()` (REST path) or `cloudflare:sockets` `connect()` (RESP3 path) — both will fail silently at DNS with an opaque network error, which the fail-soft guard swallows as `graph_client_connect_failed`.

**For the Fly REST proxy path (option a):** The proxy app (`internjobs-graph-api`) must be deployed as a Fly app in `internjobs-sios-org` so it shares the private network with `internjobs-graph`. The Worker then calls the proxy via its **public** URL (e.g. `https://internjobs-graph-api.fly.dev/...`), NOT the `.internal` address. If the proxy is not given a public IP or a Fly Anycast address, the Worker has no path to it.

**For the Workers RESP3 path (option b):** The Worker cannot reach `.internal` at all. FalkorDB would need a public IP or a Cloudflare Tunnel (`cloudflared`) running on the `internjobs-graph` Fly machine that exposes port 6379 externally (with auth). Tunnel adds operational complexity and a second failure point.

**Recommendation (HIGH confidence):** Option (a) — the Fly REST proxy — is significantly simpler. The proxy speaks HTTP on its public endpoint; the Worker calls `fetch()`. The proxy app is small (10–20 LOC, any Hono or raw Fly Node app). The graph stays `.internal`-only (no public port on FalkorDB). Password auth is a header on the proxy, not exposed over the raw Redis wire protocol.

**Consequences if missed:** Both paths appear to fail with the same `graph_ready=false` signal, making it hard to distinguish "DNS can't resolve" from "connection refused" from "wrong auth." Add explicit error-type logging before merging the proxy or RESP3 implementation.

---

### PITFALL-14-03: `cloudflare:sockets` has no configurable timeout — a stalled TCP connection hangs the Worker

**What goes wrong:** The CF Workers TCP socket API (`cloudflare:sockets`) does not expose a `setTimeout` option (confirmed as a known open issue in the workerd repo: `#1018`). A FalkorDB connection that stalls at TCP handshake or mid-query (e.g., the Fly app is under memory pressure and pauses) will hang the Worker request indefinitely — or until the Worker's outer CPU time limit triggers.

**Why it matters for v1.3:** If the RESP3 path is chosen, every inbound student SMS and every Parrot request that reads graph context goes through a `cloudflare:sockets` connection. A single stalled FalkorDB connection can cascade across the Worker's 6-simultaneous-connection cap.

**Prevention:**
- Wrap every graph call with a `Promise.race([graphCall, timeout(3000)])` pattern. On timeout, log + return the fail-soft default. This is already the right pattern for the `getStudentSummary` pre-LLM injection; just make it explicit in the RESP3 implementation.
- The fail-soft posture already exists in both `graph.mjs` and `graph.ts` — but it only catches thrown errors, not hangs. A timeout race is additive to the existing guard.
- For the REST proxy path, `fetch()` is already covered by the Workers fetch timeout limits. This pitfall is specific to the RESP3/`cloudflare:sockets` path.

---

### PITFALL-14-04: The code in `apps/parrot/workers/lib/graph.ts` has never executed against a real FalkorDB instance — latent Cypher bugs are expected

**What goes wrong:** Phase 14 was "code shipped, runtime blocked." The Cypher queries in `graph.ts` were written in parallel with `graph.mjs` but the TypeScript version has never been executed against a live FalkorDB because the connection path doesn't exist yet. `graph.mjs` (student app) HAS been live-verified (`graphReady=true` in production per PROJECT.md), but `graph.ts` (Parrot Worker) has not.

**Known differences between the two implementations:**
- `graph.ts` uses a `Map<url, client>` keyed on `FALKORDB_URL` (Workers isolate-lifetime singleton); `graph.mjs` uses module-level `let` (Node process singleton). The Map-based approach is correct for Workers but has never been exercised under real concurrent requests.
- `graph.ts` uses a `probe` query before `recordTodoFact` to detect skipped (duplicate) todos (lines 379–410). This probe is an extra round-trip that `graph.mjs` does not have. Under concurrent extraction for the same employee (e.g., two emails arrive simultaneously), the probe may race and both proceed to MERGE — harmless (MERGE is idempotent) but the `skipped=true` notification-suppression signal will be wrong for one caller.
- `getActiveTodos` UNION query across three label types in `graph.mjs` vs. single-label MATCH in `graph.ts`. The UNION form in `graph.mjs` is more expensive; `graph.ts` simplified it. Verify FalkorDB's LIMIT semantics on the simpler form — specifically, does `ORDER BY urgency_score DESC LIMIT 20` work correctly when there are no `:Employee` nodes yet (empty result should be `[]`, not an error)?

**Prevention:** Before enabling PHASE14-RUNTIME in production, run a manual smoke test against the production FalkorDB instance (or a staging clone) that exercises: (1) `ensureParrotGraphSchema`, (2) `recordTodoFact` with a real email payload, (3) `getActiveTodos`, (4) `getEmployeeContext`. The student app's `graph.mjs` already confirms the FalkorDB instance works — the risk is in the untested TypeScript code path, not the DB.

---

### PITFALL-SEC-01: Rotating the Clerk Secret Key is zero-downtime; rotating JWT signing keys signs out all users — do NOT conflate them

**What goes wrong:** Clerk has three rotatable items: Publishable Key, Secret Key, and JWT Signing Keys. The MILESTONE-AUDIT's SEC-ROTATE item says "Clerk (both apps)" without specifying which keys. If a developer interprets "rotate Clerk" as "rotate the signing keys," every employee currently signed into workspace.internjobs.ai and every student at app.internjobs.ai is immediately signed out. For phone-OTP employees, re-authentication requires re-entering a phone OTP — not just a cookie refresh.

**Confirmed via Clerk docs (MEDIUM confidence):**
- Rotating the **Secret Key** is zero-downtime: Clerk supports multiple active Secret Keys on the same instance. The procedure is: create new key → deploy app with new key → verify → delete old key. No session impact.
- Rotating **JWT Signing Keys** invalidates ALL active sessions immediately. This is the nuclear option.
- The **Publishable Key** is effectively public (embedded in frontend JS); it does not gate sessions.

**For v1.3 SEC-ROTATE:** Rotate the Secret Key on both Clerk apps (student + employee) using the multi-key overlap procedure. Do NOT rotate JWT Signing Keys unless there is a known signing key compromise. Schedule the Secret Key rotation for a low-traffic window (nights/weekends) as a precaution, even though it should be session-safe, because a misconfigured redeploy that picks up the old key before the new one is propagated in Infisical will cause a transient auth failure.

**Mitigation (added from v1.2 learnings):** The v1.2 Clerk JWT claims incident (2026-05-19) was caused by code requiring `phone_number` in the JWT when only `sub` is guaranteed. During the key-rotation redeploy, watch for this pattern: if the redeployed code momentarily reads `null` for a claim it expects, it may 302 to sign-in, which looks identical to a signing-key invalidation. Distinguish these by checking Worker logs for `deriveEmployeeFromClaims` or equivalent claim-extraction errors vs. JWT signature verification errors.

---

### PITFALL-SEC-02: The broad CF API token was used to provision every v1.2 resource — rotating it during a deploy is a chicken-and-egg failure

**What goes wrong:** The broad-scope Cloudflare API token is used by `wrangler deploy`. If you rotate the token in Infisical and then attempt a `wrangler deploy` to push the new token value as a Worker secret, that deploy will fail because the `wrangler` process still has the old token (or has been given the new one via env before it's been propagated). The rotation deploy itself requires the token to be valid.

**Correct sequence for the broad CF API token:**
1. Generate the new token in the Cloudflare dashboard (same scopes as the old one).
2. Write the new token to Infisical under the same path (`/internjobs-ai`).
3. Update your LOCAL environment (the terminal session or CI that runs `wrangler`) with the new token.
4. Run `wrangler deploy` (or the `wrangler secret put` commands for other Worker secrets) using the new token from the local env.
5. Verify all Workers are healthy (`/healthz` green across the board).
6. Revoke the old token in the Cloudflare dashboard.

**The anti-pattern:** Writing new token to Infisical → expecting wrangler to auto-pull from Infisical → running wrangler. Wrangler does not pull from Infisical automatically. The token must be in the shell environment or `CLOUDFLARE_API_TOKEN` env var at the time wrangler runs.

**Additional risk:** The Cloudflare dashboard session cookie is separate from the API token. Do not confuse "I can log into the CF dashboard" with "my wrangler token is working." They are independent credential surfaces.

---

### PITFALL-SEC-03: Cloudflare Workers AI API token rotation causes in-flight `401` for the student Fly app — requires a redeploy window

**What goes wrong:** The student Fly app (`internjobs-ai-student-app`) calls Workers AI directly via REST (`api.cloudflare.com/.../ai/run/...`) with `CLOUDFLARE_AI_API_TOKEN` in the `Authorization` header. This token is set as a Fly secret. When you rotate it:

1. New token written to Infisical.
2. `fly secrets set CLOUDFLARE_AI_API_TOKEN=<new>` is run against the Fly app.
3. Fly immediately rolls the app (new machine boots with new secret).
4. Old machines (if any) drain. During the drain window, some requests may hit old machines that still have the old token.

**The actual risk is minimal for this app** because Fly secrets rotation triggers an immediate app restart (single machine for this app at pilot scale), so the window is short. **BUT:** if the CF AI API token is revoked in the CF dashboard BEFORE the Fly app has restarted with the new token, any in-flight LLM calls (the student SMS webhook path is async but the LLM call is synchronous within the turn) will get `401`. The agent turn fails; the student gets no reply. The fail-soft graph guard doesn't cover this — the LLM call does not have a fail-soft path (it IS the primary path, not a side-car).

**Correct sequence:**
1. Generate new CF AI API token (same Workers AI scope).
2. Write to Infisical.
3. `fly secrets set CLOUDFLARE_AI_API_TOKEN=<new>` → verify Fly restart completes and `/healthz` shows `workersAiReady: true`.
4. Verify one test SMS round-trips through the agent.
5. Only then revoke the old token in CF dashboard.

**There is no Cloudflare "grace period" for API tokens** — once revoked, all in-flight requests with the old token get `401` immediately. Do not skip step 4.

---

## Moderate Pitfalls

Mistakes that cause degraded UX, delays, or technical debt.

---

### PITFALL-AC-01: Race condition between fact close-out and todo extraction — a todo may auto-clear the moment it is created

**What goes wrong:** The PARROT-AUTO-CLEAR loop watches for `:Todo` nodes where `valid_to IS NULL` and the underlying fact's `valid_to` has been set. But consider this sequence:

1. Student sends a message at T. The agent workflow extracts a fact ("INTERESTED_IN: fintech") with `valid_to=null`.
2. The auto-clear cron fires at T+ε. It reads facts to find closed ones. The facts snapshot it reads was indexed at T-δ (before the write committed, or before the cron read the DB).
3. A new message arrives at T+2ε that changes the student's interest. The agent's `recordFact` call closes the old fact (`valid_to = T+2ε`) and writes a new one.
4. The auto-clear cron at T+3min reads the DB again, finds the `valid_to`-set fact from step 3, and auto-resolves the todo associated with the original T-message.
5. From Ridhi's perspective: she just saw the todo created (step 1), it auto-resolved (step 4) — it never appeared as actionable. **This looks like a bug even though the data is correct.**

**Root cause:** The auto-clear cron queries `valid_to IS NOT NULL` — it has no knowledge of how recently the fact was closed. A fact closed 30 seconds ago and a fact closed 30 days ago are treated identically.

**Mitigation:** Add a minimum-open-window guard: only auto-resolve todos where `fact.valid_to < NOW() - INTERVAL '5 minutes'` (or some grace period). A todo whose underlying fact was closed in the last 5 minutes is in an ambiguous state — let the cron on the next cycle handle it. This ensures the dashboard shows the todo as pending for at least one full polling cycle before auto-resolving.

**Data shape for undo:** The `:Todo` node already has `valid_from` and `valid_to` fields. For re-open support, add a `resolved_by` field (`'auto_clear'` vs. `'employee'`) and a `resolution_notes` optional field. Ridhi re-opening a todo should set `valid_to = null` and `resolved_by = null`. The API endpoint for this is a `POST /api/todos/{todoId}/reopen` that flips those two fields in the graph. The Dashboard UI shows a "Re-open" button on auto-resolved items.

---

### PITFALL-AC-02: PARROT-AUTO-CLEAR is blocked until PHASE14-RUNTIME — this ordering must be explicit in the roadmap

**What goes wrong:** PARROT-AUTO-CLEAR reads `valid_to` from `:Todo` nodes in the FalkorDB graph. If PHASE14-RUNTIME is not complete, the Parrot Worker has no path to FalkorDB and the auto-clear cron has nothing to read. If both items are scoped to the same v1.3 milestone but assigned to different phases without an explicit ordering constraint, a developer may start work on PARROT-AUTO-CLEAR first and then discover the dependency mid-phase.

**Prevention:** The v1.3 roadmap phases MUST show PARROT-AUTO-CLEAR as downstream of PHASE14-RUNTIME. In the RRR phase plan, PHASE14-RUNTIME is Phase 1, PARROT-AUTO-CLEAR is Phase 2. Do not allow parallel execution.

---

### PITFALL-AC-03: Cron frequency — 5 min gives 43K invocations/month for free; sub-1-min is expensive

**What goes wrong:** Workers cron invocations on the free plan are capped at 100K/month (paid plan: unlimited). A 1-minute cron fires 43,200 times/month — below the free cap but approaching it. A 30-second cron (2 per minute) would be 86,400/month — within free tier margin but with no headroom. More importantly, each cron invocation that hits the graph makes one `getActiveTodos` query per employee. At 50 employees × 20 todos each, that's a nontrivial read per invocation.

**Recommendation:** Start with a 5-minute cron. The dashboard will show todos as up to 5 minutes stale, which is acceptable for an internal ops tool. If pilot feedback indicates staleness is painful, the Parrot Worker can complement the cron with a webhook-triggered invalidation: whenever the email ingest or Mattermost bot writes a new todo to the graph, it fires a `POST /internal/invalidate-todos` to the Worker (with a secret header), which marks the employee's todo cache dirty and triggers an immediate refresh. This push-on-write pattern eliminates staleness without polling.

**Do not set the cron to 1 minute in the initial v1.3 implementation.** The behavioral difference at pilot scale (2–5 employees) is imperceptible and the operational risk is unnecessary.

---

### PITFALL-SAFETY-01: Lakera Guard latency is sub-50ms at p50 — but the screening must be synchronous before LLM call, which adds to the student SMS reply time

**What goes wrong:** Lakera (now Cisco AI Defense) advertises sub-50ms latency. The realistic p99 for cloud API calls is 200–500ms under normal load. The student SMS path is: Photon webhook → Fly app → (graph summary) → **Lakera screen** → LLM call → reply → Spectrum send. The Lakera screen sits on the critical path. An SMS reply that was previously completing in ~3–5 seconds now takes 3.5–5.5 seconds in the median case, and potentially 8+ seconds at p99 if Lakera is slow.

**SMS reply latency is already a product quality signal.** Students sending "whats the deadline for valon?" expect a near-instant reply. A perceptible pause increase may register as degraded product quality.

**Recommendation:** Instrument the Lakera call with a `Date.now()` wrapper and log the latency. If p99 consistently exceeds 500ms in the first week of v1.3, consider moving the screen to an async pre-validation path with a block-after mechanism: accept the message, begin the LLM turn, and if Lakera returns a flag BEFORE the LLM finishes (typical case given 50ms Lakera vs 2s+ LLM), abort the send. If Lakera flags AFTER the LLM completes, discard the prepared reply and send a neutral fallback. This adds complexity; start with synchronous and monitor.

**Timeout guard:** Set a hard 1-second timeout on the Lakera API call. On timeout: fail open (allow the message to proceed) and log `lakera_timeout`. Do not block the student turn on Lakera availability. This is consistent with the fail-soft posture already present in the graph layer.

---

### PITFALL-SAFETY-02: Lakera acquired by Cisco in May 2025 — the platform is now Cisco AI Defense; the API endpoint and keys may have changed

**What goes wrong:** Lakera was acquired by Cisco in May 2025 and folded into Cisco AI Defense. The `platform.lakera.ai` signup surface still appears to exist, but the enterprise product is now under Cisco's umbrella. There is LOW confidence that the pre-acquisition API contract (endpoint URL, auth header format, response schema) is unchanged post-acquisition.

**Prevention:** Before writing any Lakera integration code, go to `platform.lakera.ai`, sign up, and verify: (1) the API endpoint URL, (2) the authentication mechanism (Bearer token? header key?), (3) the response shape for a blocked prompt vs. a clean prompt. Write the integration against the documented current API, not the pre-acquisition API that may appear in 2024 blog posts and tutorials.

**Free tier:** Confirmed 10,000 API requests/month on the free Community plan. At 1,000 messages/day × 30 days = 30,000 messages/month, the pilot WILL exceed the free tier within the first month if you screen every inbound message. The $99/month paid plan is the likely tier. Verify current pricing at signup before committing to screening every message.

---

### PITFALL-SAFETY-03: False positive on "can I have your email" — operator needs an override path before Lakera is live

**What goes wrong:** Lakera screens for PII fishing (asking for personal information). Legitimate student messages like "can I get the hiring manager's email?" or "what's the recruiter's contact info?" are surface-identical to PII exfiltration attempts. Lakera's classifier may flag these. Without an operator override path, the student gets a neutral fallback response ("I can't help with that") on a valid question — a poor student experience that looks like a product bug.

**Prevention:** Do not apply Lakera screening to the ENTIRE message. Apply it to the LLM INPUT + the LLM OUTPUT. Screening the LLM output (the reply) catches prompt injection that successfully manipulated the agent. Screening the LLM input (system prompt + user message) catches injection attempts before they reach the model. The raw student message alone (without the system prompt context) is more likely to false-positive on innocent questions.

**Operator override path (minimum viable):** A per-employee or per-phone-number allowlist stored in CF KV (`PARROT_FEATURE_FLAGS` already exists). If a message is flagged, log it to `/ops/drafts` as `lakera_flagged` status (visible to the operator) rather than silently dropping it. The operator can then review and, if it was a false positive, whitelist the pattern. This creates an audit trail rather than a silent drop.

---

### PITFALL-SAFETY-04: Mattermost → Parrot Worker inbound path — decide whether Lakera screens it or not, and document the decision

**What goes wrong:** Mattermost chat messages flow from Mattermost → the Parrot Worker's OIDC/webhook path → `EmployeeMailboxDO` → `extractTodosFromEmail()` (which passes text to kimi-k2.6 via AI Gateway). This is an INTERNAL channel — messages come from workspace employees, not from students. Applying Lakera to employee-to-agent messages is a different risk profile than student SMS screening.

**Decision required (not a default):**
- Screening INTERNAL employee messages with Lakera: adds cost (counts toward the 10K/month free tier), adds latency to internal chat ingest, and flags legitimate employee messages about security topics as threats. Probably wrong.
- Screening only STUDENT SMS: correct risk profile, lower cost, simpler implementation.

**Prevention:** Explicitly scope `SAFETY-01` to the student SMS path only in the v1.3 requirements. If the Parrot agent becomes externally-facing (startup email replies, public chat), add Lakera screening for those channels as a separate requirement.

---

## Minor Pitfalls

---

### PITFALL-MISC-01: EmployeeMailboxDO in `apps/parrot` is the highest-churn file from v1.2 — read it carefully before adding auto-clear writes

**What goes wrong:** `apps/parrot/workers/durableObject/index.ts` was touched by Phases 10, 11, 12, and 13 (4 phases, 7 migrations, ~15 methods). The MILESTONE-AUDIT flagged it as the highest coupling point in v1.2. PARROT-AUTO-CLEAR will add another DO method (`resolveTodo`) and possibly a new migration. Adding code to a file that's already at this coupling point without reading the full current state first risks: (1) name collision with an existing method, (2) a migration number collision (currently migrations 1–7; next is migration 8), (3) breaking an existing alarm handler.

**Prevention:** Before writing PARROT-AUTO-CLEAR code, read the FULL `durableObject/index.ts` file. Map every alarm, every migration, every method. Plan the new `resolveTodo` method and the `auto_clear_cron` alarm trigger as explicit additions to the documented DO interface. Assign migration number 8 explicitly.

---

### PITFALL-MISC-02: `apps/parrot` wrangler build chain is broken — `virtual:react-router/server-build` build error blocks `--dry-run` but not actual deploys

**What goes wrong:** Per the MILESTONE-AUDIT, `wrangler deploy --dry-run` fails on `virtual:react-router/server-build`. Actual deploys from `apps/parrot` with proper vite preflight work. This is a pre-existing issue. However, SEC-ROTATE involves deploying new Worker secrets via `wrangler secret put` — this command does NOT require a dry-run and is unaffected. The risk is that someone runs `wrangler deploy --dry-run` as a validation step during SEC-ROTATE and panics when it fails.

**Prevention:** Document in the SEC-ROTATE phase plan that `--dry-run` is non-functional and that `wrangler secret put <KEY>` followed by a healthcheck is the correct rotation verification pattern.

---

### PITFALL-MISC-03: `apps/parrot` TypeScript error on `OnboardingWizard.tsx:140` (Uint8Array) is a v1.2 carry-over that will generate noise in v1.3 tsc output

**What goes wrong:** Pre-existing `Uint8Array<ArrayBufferLike>` TypeScript error doesn't block deploys but will appear in every `tsc --noEmit` run during v1.3 development. New engineers or automated checks that fail on any TypeScript error will be confused.

**Prevention:** Fix it in the first v1.3 commit as a zero-risk cosmetic cleanup. Cast to `Uint8Array` without the generic, or add a targeted `// @ts-expect-error` with a note. Do not ignore it across the whole file.

---

### PITFALL-MISC-04: Infisical write order for SEC-ROTATE — rollback if verification fails

**Correct sequence (all four credentials follow this pattern):**
1. Generate new credential in the issuing system (Clerk dashboard, CF dashboard).
2. Write new value to Infisical (path `/internjobs-ai`).
3. Update the running service (Fly: `fly secrets set`, Workers: `wrangler secret put`, local dev: `.env`).
4. Verify: call `/healthz` AND run one real workflow end-to-end.
5. Revoke old credential in issuing system.

**Rollback if step 4 fails:** The old credential is still valid (not yet revoked). Write the old value back to Infisical and re-deploy the service. The service recovers to the pre-rotation state. Only revoke the old credential after step 4 passes.

**What breaks if you skip the Infisical write:** The service works (you pushed via `fly secrets set` / `wrangler secret put` directly), but Infisical is now stale. The next deploy that pulls from Infisical will re-inject the old value and break the service. Infisical is the source of truth — always write there first.

---

## Phase-Specific Warnings

| Phase | Topic | Likely Pitfall | Mitigation |
|-------|-------|---------------|------------|
| PHASE14-RUNTIME | Transport path decision | Choosing RESP3 without knowing about `cloudflare:sockets` timeout gap (PITFALL-14-03) | Default to REST proxy; RESP3 only if REST adds too many moving parts |
| PHASE14-RUNTIME | DNS resolution | `.internal` names unreachable from Workers (PITFALL-14-02) | REST proxy gets a public Fly endpoint; Worker calls that |
| PHASE14-RUNTIME | Code quality | `graph.ts` has never run against live FalkorDB (PITFALL-14-04) | Manual smoke test before prod activation |
| PARROT-AUTO-CLEAR | Race condition | Fact closed in last <5min triggers immediate todo auto-clear (PITFALL-AC-01) | Minimum-open-window guard on auto-resolve query |
| PARROT-AUTO-CLEAR | Dependency | Can't proceed without PHASE14-RUNTIME (PITFALL-AC-02) | Explicit phase ordering in roadmap |
| SAFETY-01 | API state | Lakera now Cisco AI Defense; endpoint/pricing may differ (PITFALL-SAFETY-02) | Verify at signup before writing integration code |
| SAFETY-01 | Scope | Internal Mattermost messages should NOT be screened (PITFALL-SAFETY-04) | Scope requirement to student SMS path only |
| SEC-ROTATE | Clerk | Don't rotate JWT signing keys — rotate Secret Key only (PITFALL-SEC-01) | Read Clerk rotate-api-keys doc before touching anything |
| SEC-ROTATE | Ordering | Broad CF API token rotation requires local env update first (PITFALL-SEC-02) | Follow 5-step sequence; never auto-pull from Infisical into wrangler |
| SEC-ROTATE | CF AI token | Revoke old token ONLY after Fly restart + smoke verified (PITFALL-SEC-03) | Follow 5-step sequence; test one real SMS through agent |

---

## PROPOSED PROJECT.MD UPDATE: New Constraint

The following pitfall is severe enough to warrant a standing constraint in PROJECT.md:

```
- **Clerk key rotation**: Rotate the Secret Key using Clerk's multi-key overlap
  procedure (add new, deploy, verify, delete old). NEVER rotate JWT Signing Keys
  unless there is a confirmed signing key compromise — this signs out all users
  across both Clerk apps simultaneously. See PITFALL-SEC-01.
```

---

## Sources

- Cloudflare Workers TCP sockets docs: [https://developers.cloudflare.com/workers/runtime-apis/tcp-sockets/](https://developers.cloudflare.com/workers/runtime-apis/tcp-sockets/)
- CF workerd issue #1018 (socket timeout): [https://github.com/cloudflare/workerd/issues/1018](https://github.com/cloudflare/workerd/issues/1018)
- Clerk rotate API keys guide: [https://clerk.com/docs/guides/secure/rotate-api-keys](https://clerk.com/docs/guides/secure/rotate-api-keys)
- Lakera Guard platform / Cisco AI Defense: [https://platform.lakera.ai/pricing](https://platform.lakera.ai/pricing) (MEDIUM confidence — post-acquisition pricing/API may differ)
- Lakera 2026 review (appsecsanta): [https://appsecsanta.com/lakera](https://appsecsanta.com/lakera) (LOW confidence — third-party review)
- Lakera pricing guide (eesel.ai): [https://www.eesel.ai/blog/lakera-pricing](https://www.eesel.ai/blog/lakera-pricing) (LOW confidence — may be pre-acquisition)
- Project source: `apps/app/src/memory/graph.mjs` (live-verified `graphReady=true` in prod)
- Project source: `apps/parrot/workers/lib/graph.ts` (code-complete, never executed against FalkorDB)
- v1.2 MILESTONE-AUDIT.md (file churn hotspots, tech debt backlog)
- Memory: `feedback-clerk-jwt-claims.md` (only `sub` is guaranteed in Clerk session JWTs)
- Memory: `session-handoff-2026-05-19.md` (SEC-ROTATE backlog origin)
