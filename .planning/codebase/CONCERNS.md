# Codebase Concerns

**Analysis Date:** 2026-05-24

## Architectural Context Loaded

- Locked source: `.planning/milestones/v1.2-two-sided-agent-mvp/ROADMAP.md` — "Phase 14 FalkorDB runtime activation (Fly REST proxy OR Workers RESP3 client)" — Phase 14 code shipped but architecture-blocked; the Fly REST proxy resolution is the v1.3 plan (not a gap).
- Locked source: `.planning/REQUIREMENTS.md` — SEC-ROTATE-CLERK-01..02, SEC-ROTATE-EMAIL-01..02, SEC-ROTATE-AI-01..02, SEC-ROTATE-BROAD-01 — pending, Phase 21 ops-only task.
- Locked source: `.planning/SCOPE_CACHE.md` — Cognee, Sprite.dev, Bright Data activation explicitly legal-gated; placeholder rows intentional, not gaps.
- Locked source: `.planning/STATE.md` — "Phase 19 cron is wired but inert until a closeTodoFact helper writes valid_to (recommend v1.3.1 patch ~50 LOC)" — known, tracked.

---

## Tech Debt

**Phase 14 FalkorDB — Parrot graph layer code-shipped but architecturally unreachable:**
- Issue: `apps/parrot/workers/lib/graph.ts` Cypher code routes through the `internjobs-graph-api` HTTP proxy, but that proxy was not deployed until v1.3 Phase 18. The Parrot Worker's graph Cypher calls have never executed against live FalkorDB. Code is instrumented but unverified.
- Files: `apps/parrot/workers/lib/graph.ts`, `apps/parrot/workers/durableObject/index.ts` (lines ~925, ~1116 — graph wiring)
- Impact: All graph-backed features degrade to fail-soft (no recall, no active-todo graph sync). The auto-clear cron fires every 5 minutes and finds nothing because nothing writes `:Todo.valid_to`.
- Fix approach: Phase 18 deploys `internjobs-graph-api` Fly proxy; Phase 19 adds `closeTodoFact` helper (~50 LOC) invoked from the Mastra workflow. GRAPH-VERIFY-01 manual smoke required post-deploy.

**Auto-clear cron wired but inert — `closeTodoFact` missing:**
- Issue: The scheduled cron at `*/5 * * * *` calls `runAutoClear` which queries the graph for `:Todo` nodes where `valid_to` is set. No code path currently writes `valid_to`, so the cron always finds zero items to clear.
- Files: `apps/parrot/workers/lib/auto-clear.ts`, `apps/parrot/workers/app.ts` (line ~364)
- Impact: Todos accumulate indefinitely on the Dashboard; the "Parrot auto-resolved" flow never fires. Pilot employee trust concern.
- Fix approach: Add `closeTodoFact(thread_id, resolution_text)` called from the Mastra workflow reply-send path. Tracked as v1.3.1 candidate.

**Star-toggle API unwired in EmailPanel:**
- Issue: The star icon in the Parrot inbox email panel renders a visible toggle button but it is explicitly marked as not wired.
- Files: `apps/parrot/app/components/EmailPanel.tsx` (lines 23, 132)
- Impact: UI affordance exists with no backend. Clicking the star does nothing.
- Fix approach: Wire `PATCH /api/inbox/messages/:id` (route already exists in `apps/parrot/workers/index.ts`); tracked as `PARROT-STAR-API` TODO.

**Deprecated `formatQuotedDate` utility duplicated across three apps:**
- Issue: Three files expose a `@deprecated` re-export of `formatQuotedDate` pointing callers to `shared/dates`. The originals remain because callers haven't been migrated.
- Files: `apps/agentic-inbox/app/lib/utils.ts` (line 21), `apps/agentic-inbox/workers/lib/email-helpers.ts` (line 194), `apps/parrot/workers/lib/email-helpers.ts` (line 188)
- Impact: Cosmetic. No correctness risk, but drift accumulates if shared/dates evolves.
- Fix approach: Grep for import sites, redirect to `packages/shared/src/dates`, delete re-exports.

**Stale block comment in Parrot worker (pre-Wave-3 start-meeting):**
- Issue: `apps/parrot/workers/index.ts` lines ~595-598 contain a comment about a pre-Wave-3 start-meeting pattern that no longer applies.
- Files: `apps/parrot/workers/index.ts`
- Impact: Cosmetic only.

**Phases 01–10 v1.2 have no VERIFICATION.md artifacts:**
- Issue: Phases 11–13 have RRR audit artifacts; Phases 01–10 relied on informal STATE.md decision logs. Behavior is captured but not in the standard format.
- Files: `.planning/milestones/v1.2-two-sided-agent-mvp/` (missing per-phase VERIFICATION.md files)
- Impact: Process debt. Auditors must reconstruct verification state from STATE.md logs.

---

## Known Bugs

**AI body verifier returns empty string on failure:**
- Symptoms: If the AI cleanup call throws, `verifyAndCleanDraftBody()` catches and returns `""`. Callers may then save or send a blank draft.
- Files: `apps/agentic-inbox/workers/lib/ai.ts` (line 186)
- Trigger: Any AI timeout, network error, or malformed response during the verifier step.
- Workaround: Callers log the error; no explicit guard against persisting the empty string.

**agentic-inbox mailbox delete does not clean up DO data or R2 blobs:**
- Symptoms: Deleting a mailbox removes the primary R2 key but leaves the Durable Object data and per-attachment R2 blobs orphaned.
- Files: `apps/agentic-inbox/workers/index.ts` (line 139) — the TODO is in the code comment.
- Trigger: Any mailbox delete operation.
- Workaround: Manual cleanup required.

**`EmailPanel` email fetch swallows errors silently:**
- Symptoms: On missing `recipient`/`subject`, the panel attempts a fresh `getEmail()` fetch inside `catch {}` — empty catch block means failures are invisible.
- Files: `apps/agentic-inbox/app/components/EmailPanel.tsx` (line 114)
- Trigger: Emails ingested with incomplete headers (e.g., malformed inbound from external sender).

**INTEG-01 11-step two-sided smoke has never run against production:**
- Symptoms: The student SMS → agent → startup email → agent → student SMS full round-trip has never been executed end-to-end in production by a human operator.
- Files: `.planning/milestones/v1.2-two-sided-agent-mvp/USER-ACTIONS.md` (Section E), `.planning/milestones/v1.2-two-sided-agent-mvp/LIVE-VERIFICATION.md` (line 119)
- Trigger: Any regression in the autonomous reply path.
- Workaround: None — this is a pending operator user-action gate.

---

## Security Considerations

**SEC-ROTATE: 5 credentials shared in chat history, not yet rotated:**
- Risk: The following tokens were pasted in chat sessions and are live in Infisical `prod`/`/internjobs-ai` but have not been rotated: `CLERK_SECRET_KEY` (student app, 2026-05-15), `CLERK_SECRET_KEY` (workspace app, same era), `CLOUDFLARE_EMAIL_API_TOKEN` (2026-05-16), `CLOUDFLARE_AI_API_TOKEN` (2026-05-16), broad-scope CF API token (2026-05-19).
- Files: `.planning/REQUIREMENTS.md` (SEC-ROTATE-CLERK-01, SEC-ROTATE-EMAIL-01, SEC-ROTATE-AI-01, SEC-ROTATE-BROAD-01)
- Current mitigation: Tokens are in Infisical, not hardcoded in source. Clerk multi-key overlap procedure documented.
- Recommendations: Execute Phase 21 rotation runbook (`.planning/milestones/v1.3-pilot-hardening/SHIP-READY.md`). Rotate in order: Clerk student → Clerk workspace → CF Email → CF AI → broad CF. Do NOT rotate Clerk JWT Signing Keys unless confirmed compromise.

**Lakera Guard API schema unverified post-Cisco acquisition:**
- Risk: `apps/parrot/workers/lib/safety.ts` line 17 notes the v2 schema is "assumed — verify post-Cisco-acquisition before runtime use." The Lakera endpoint and response shape may have changed at `platform.lakera.ai`.
- Files: `apps/parrot/workers/lib/safety.ts`
- Current mitigation: `LAKERA_GUARD_API_KEY` not yet provisioned in production, so the guard fails-open (passes all traffic through). No production LLM calls are being screened.
- Recommendations: Sign up for Lakera (Cisco AI Defense), verify endpoint at `platform.lakera.ai`, confirm v2 response schema before setting `LAKERA_GUARD_API_KEY` in Infisical.

**Mattermost proxy strips iframe-blocking headers globally (not just for known origin):**
- Risk: The mattermost-proxy Worker at `apps/mattermost-proxy/workers/index.ts` deletes `X-Frame-Options` and rewrites `Content-Security-Policy frame-ancestors` for ALL responses. CORS is correctly scoped to `ALLOWED_PARENT` only, but the frame-ancestors rewrite applies unconditionally.
- Files: `apps/mattermost-proxy/workers/index.ts`
- Current mitigation: `ALLOWED_PARENT` env var gates CORS credentials. The iframe framing exposure is limited to the subdomain scope (`.internjobs.ai`).
- Recommendations: Consider conditionally rewriting CSP only when the `Referer` or `Sec-Fetch-Site` indicates the request comes from `workspace.internjobs.ai`.

**Autonomous email send without human approval:**
- Risk: The 2026-05-17 autonomy pivot removed the operator approval gate. The Mastra workflow now auto-sends agent responses to real startup contacts. A misfire sends an unreviewed email.
- Files: `apps/app/src/workflows/` (student inbound Mastra workflow), `apps/parrot/workers/routes/agent.ts`
- Current mitigation: System-prompt guardrails + Lakera Guard (when activated) + ops audit log at `/ops/feedback`. Flag-for-review is post-hoc.
- Recommendations: Activate Lakera Guard (SAFETY-01) before scaling beyond 5–10 pilot startups.

---

## Performance Bottlenecks

**Parrot Dashboard polls every 10s via `setInterval`:**
- Problem: `apps/parrot/app/routes/dashboard.tsx` uses a polling loop (interval documented in comments as "fast enough that an agent-cleared todo" propagates quickly) rather than WebSocket or SSE push.
- Files: `apps/parrot/app/routes/dashboard.tsx` (lines ~179, ~260)
- Cause: Architectural choice to avoid SSE complexity in the MVP phase.
- Improvement path: Replace with a `/api/dashboard/todos/stream` SSE endpoint backed by the Durable Object alarm; eliminates N × 10s polling lag and reduces Worker invocations under load.

**kimi-k2.6 reasoning model — `max_tokens` tuning required per query type:**
- Problem: The Phase 12 dashboard agent uses `kimi-k2.6` via AI Gateway. The model's thinking budget and output token size were a known pain point (caused a parsing bug in v1.2 where `max_tokens` was too small for the reasoning model).
- Files: `apps/parrot/workers/lib/ai.ts`, `apps/parrot/workers/durableObject/index.ts`
- Cause: Reasoning models emit `<thinking>` blocks before answer; callers must strip or the downstream JSON parse fails.
- Improvement path: Audit all kimi call sites for `max_tokens` adequacy; add a response-shape normalizer that strips thinking blocks before JSON parse.

---

## Fragile Areas

**Durable Object method calls cast with `as unknown as` / `as any`:**
- Files: `apps/agentic-inbox/workers/index.ts` (lines 151, 156, 157, 183, 261, 306, 389), `apps/agentic-inbox/workers/lib/tools.ts` (lines 101, 409, 487), `apps/agentic-inbox/workers/routes/reply-forward.ts` (lines 50, 140)
- Why fragile: Durable Object RPC methods added after the generated type snapshot are called via runtime casts. If the DO method signature changes, TypeScript won't catch the mismatch — a runtime 500 is the first signal.
- Safe modification: Regenerate `worker-configuration.d.ts` after any DO method addition; add the new method to the local stub interface type (`MailboxSearchStub`, `RateLimitStub`, `MailboxThreadReaderStub`).
- Test coverage: No unit tests for DO method calls; only integration-level smoke covers them.

**FalkorDB graph Cypher untested in production:**
- Files: `apps/parrot/workers/lib/graph.ts` (829 LOC), `infra/graph-api/src/`
- Why fragile: All four graph operations (`ensureParrotGraphSchema`, `recordTodoFact`, `getActiveTodos`, `getEmployeeContext`) have been written but never executed against the live FalkorDB instance from the Parrot Worker context. FalkorDB Cypher semantics differ subtly from Neo4j — shape assumptions may fail at runtime.
- Safe modification: Run GRAPH-VERIFY-01 smoke test (`infra/graph-api/smoke.mjs`) against production before any graph-dependent feature goes live.

**Mac bridge depends on running BlueBubbles process on a specific Mac mini:**
- Files: `apps/mac-bridge/src/server.mjs`, `apps/mac-bridge/src/listener.mjs`, `apps/mac-bridge/src/bluebubbles-client.mjs`
- Why fragile: The iMessage bridge requires a specific physical Mac mini running BlueBubbles with SIP disabled, reachable via Cloudflare Tunnel. Any reboot, OS update, or network interruption breaks the iMessage channel silently.
- Safe modification: Monitor the `/healthz` endpoint; add an alerting path for when the bridge stops reporting.
- Test coverage: No automated tests; the 4.1s round-trip was manually verified once.

**Parrot `WorkspaceShell` service-worker registration — silent fail:**
- Files: `apps/parrot/app/components/WorkspaceShell.tsx` (line 80)
- Why fragile: SW registration errors are caught and logged as `console.warn` only. If Web Push breaks (VAPID key rotation, SW update), employees lose push notifications with no UI feedback.
- Safe modification: Expose SW registration status in the `OnboardingWizard` UI; propagate errors to the notification drawer.

---

## Scaling Limits

**Durable Object per-mailbox storage (SQLite):**
- Current capacity: Each `MailboxDO` / `EmployeeMailboxDO` stores emails in Durable Object SQLite (128 MB limit per DO namespace in Cloudflare).
- Limit: At high email volume, individual mailbox DOs approach the 128 MB limit; no eviction or archival strategy is implemented.
- Scaling path: STORAGE-02 (attachment ingest to R2, with DO storing only metadata) partially addresses this; full blob externalisation needed for long-lived pilot accounts.

**AI Gateway per-employee daily cap is soft:**
- Current capacity: Parrot Worker routes LLM calls through Cloudflare AI Gateway with per-employee daily caps (cost tracking confirmed). Cap enforcement is gateway-side; no circuit breaker in the Worker itself.
- Limit: If AI Gateway cap logic changes or is bypassed (direct API call), cost controls disappear.
- Scaling path: Add a Worker-side `DAILY_LLM_TOKENS_USED` counter in the Durable Object alongside the gateway cap.

---

## Dependencies at Risk

**`falkordb` npm client incompatible with CF Workers runtime:**
- Risk: The `falkordb` npm package uses Node.js-specific APIs (`e.BigInt is not a function` failure) that cannot run in the Cloudflare Workers V8 isolate. The v1.2 Phase 14 work removed the direct dependency; all Cypher goes through the `internjobs-graph-api` Fly HTTP proxy.
- Impact: Any attempt to re-introduce `falkordb` as a direct Worker dependency will reproduce the runtime failure.
- Migration plan: Stay on the HTTP proxy pattern established in Phase 18. If lower latency is needed, evaluate a RESP3 WebSocket client over `cloudflare:sockets`.

**`@mastra/core` — early-stage OSS, fast-changing API:**
- Risk: Mastra is a pre-1.0 framework. API surface changes between minor versions could require workflow rewrites.
- Impact: `apps/app/src/workflows/` and agent orchestration.
- Migration plan: Pin exact versions; watch Mastra changelog before any upgrade.

---

## Missing Critical Features

**STORAGE-02: R2 attachment ingest not implemented for Parrot:**
- Problem: Inbound emails with attachments to the Parrot workspace are accepted but attachment blob ingest to R2 is not wired end-to-end. The `agentic-inbox` app has attachment storage; Parrot does not fully mirror this.
- Files: `apps/parrot/workers/lib/inbound-email.ts` (line 134 — R2 key pattern defined, but full pipeline incomplete), `apps/parrot/workers/lib/attachments.ts`
- Blocks: Employees cannot download or forward inbound attachments received in the workspace inbox.

**STORAGE-03: Permanent short links not implemented:**
- Problem: No URL shortener or stable link generation for email/attachment references. Deferred to pilot patches.
- Blocks: Deep-linked email references in agent replies may break if the underlying DO ID changes.

**Telnyx SMS / Phone adapter — placeholder routes only:**
- Problem: `apps/parrot/app/routes/sms.tsx` and `apps/parrot/app/routes/phone.tsx` render "Coming soon — Telnyx via Cloudflare Agents SDK" cards. A2P 10DLC registration takes weeks and is gated on regulatory approval.
- Files: `apps/parrot/app/routes/sms.tsx`, `apps/parrot/app/routes/phone.tsx`, `apps/parrot/app/routes.ts` (lines 18, 38)
- Blocks: Employees cannot use the workspace SMS/phone panes.

---

## Test Coverage Gaps

**No tests for Parrot Worker routes, DO methods, or graph layer:**
- What's not tested: All of `apps/parrot/workers/` — routes, Durable Object, graph Cypher, email send, safety screen, daily.co integration, push notifications.
- Files: `apps/parrot/workers/` (zero `.test.ts` files)
- Risk: Regressions in any Worker route, DO migration, or graph Cypher are only caught by manual smoke test or production error.
- Priority: High — this is the core employee-facing product.

**No tests for agentic-inbox Worker or DO:**
- What's not tested: `apps/agentic-inbox/workers/` — DO email storage, agent loop, MCP server, reply/forward routes, rate limit checks.
- Files: `apps/agentic-inbox/workers/` (zero `.test.ts` files)
- Risk: Email delivery bugs, rate limit bypasses, and agent tool failures are silent until production failure.
- Priority: High.

**Student app has 4 test files covering only auth, reply-to, R2, and safety screen:**
- What's not tested: Mastra workflow orchestration, graph memory (FalkorDB), LinkedIn enrichment, embedding generation, webhook idempotency logic.
- Files: `apps/app/src/auth.test.mjs`, `apps/app/src/workflows/reply-to.test.mjs`, `apps/app/src/storage/r2.test.mjs`, `apps/app/src/safety/screen.test.mjs`
- Risk: Agent workflow regressions are invisible; the iMessage bridge round-trip has no regression coverage.
- Priority: Medium.

**Cognee + Sprite.dev / Bright Data placeholder rows have no activation tests:**
- What's not tested: When legal approval arrives, the activation path for Cognee graph (`student_threads`) and enrichment (`profile_enrichment_jobs`) has no test coverage to confirm the seam wiring works.
- Files: `apps/app/src/` (placeholder table rows in student DB)
- Risk: Activation could silently fail or write to wrong table columns.
- Priority: Low (legal-gated; intentional per `.planning/SCOPE_CACHE.md`).

---

*Concerns audit: 2026-05-24*
