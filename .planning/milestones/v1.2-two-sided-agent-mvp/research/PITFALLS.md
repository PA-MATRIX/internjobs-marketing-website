# v1.2 Pitfalls — Two-Sided Agent MVP

**Milestone:** v1.2 Two-Sided Agent MVP
**Researched:** 2026-05-15
**Inherits from:** `.planning/research/` (project-level), `.planning/milestones/v1.1-seamless-waitlist/MILESTONE-AUDIT.md`

---

## Pitfall Index

1. [Mastra schema auto-init collides with application tables](#1-mastra-schema-auto-init-collision)
2. [Mastra observational memory OOM under concurrent threads](#2-mastra-observational-memory-oom)
3. [Mastra v0-to-v1 migration gap: metadata column type change mid-milestone](#3-mastra-storage-migration-breakage)
4. [Cross-provider SMS duplicate: Spectrum delivers a webhook for a Telnyx-migrated thread](#4-cross-provider-sms-duplicate)
5. [Student texts the wrong number after migration SMS](#5-student-texts-wrong-number-post-migration)
6. [Same phone number verified on both Telnyx and Spectrum due to migration glitch](#6-dual-verification-same-phone)
7. [Cloudflare Email Worker silently drops on inbound email if Mastra ingest is down](#7-email-worker-drops-on-mastra-down)
8. [Cloudflare Email Routing cannot send outbound — architecture assumption failure](#8-email-routing-outbound-assumption)
9. [SPF/DKIM failure on forwarded startup email causes Mastra ingest to receive spam-flagged content](#9-spf-dkim-forward-reputation)
10. [pgvector HNSW index missing at launch — sequential scans at 10k rows](#10-pgvector-no-index-at-launch)
11. [Operator approval queue unbounded — drafts age indefinitely, no SLO](#11-operator-queue-no-slo)
12. [Startup user reaching student-only routes via Clerk session without server-side role check](#12-cross-role-authorization-leak)
13. [Operator user type modeled as application-layer flag, not Clerk organization role](#13-operator-as-app-flag)
14. [Startup email triggers agent draft; student replies via SMS through operator gate; latency breaks startup expectation](#14-latency-breaks-startup-ux)
15. [Agent infers and stores PII from unstructured email content — TCPA/CAN-SPAM surface](#15-agent-inferred-pii-compliance)
16. [Cloudflare DNS proxy on `accounts.internjobs.ai` still blocking Clerk OAuth round-trip before v1.2 execution](#16-clerk-dns-proxy-carryover)
17. [CLERK_SECRET_KEY in conversation history — second identity breach vector in v1.2](#17-clerk-secret-key-rotation)
18. [pgvector embedding dimension locked at table creation — model upgrade requires full re-index](#18-pgvector-dimension-lock)
19. [Mastra thread memory grows unbounded — no TTL or summarization threshold configured](#19-mastra-thread-memory-unbounded)

---

## 1. Mastra Schema Auto-Init Collision

**Failure mode:** Mastra calls `init()` automatically on first storage operation and creates seven tables in the `public` schema: `mastra_threads`, `mastra_messages`, `mastra_workflow_snapshot`, `mastra_evals`, `mastra_traces`, `mastra_scorers`, `mastra_resources`. If your application already has any table starting with `mastra_` (e.g., `student_threads` has a conceptual sibling), or if Neon applies migrations that touch names in the `public` schema that Mastra also wants, Mastra's `init()` silently skips creation (table exists) or — depending on version — throws a column mismatch error that surfaces as a 500 on the first agent call. Observable as: app starts fine, first `agent.generate()` call returns an unhandled promise rejection referencing a column or table constraint.

**Likelihood:** Medium. The specific table names (`mastra_threads`, `mastra_messages`) do not collide with the existing schema (`students`, `pairing_codes`, `student_threads`, `profile_enrichment_jobs`). But `student_threads` (yours) vs `mastra_threads` (Mastra's) are conceptually easy to confuse in queries, and if a future migration writer types the wrong table name the silent data-routing error will be hard to diagnose.

**Blast radius:** Production-wide. First agent operation in prod fails for all users.

**Mitigation:** Configure Mastra with `schemaName: 'mastra'` (a dedicated Postgres schema, not the `public` schema). Add this as an explicit config line before any agent initialization. Add a migration that creates the `mastra` schema (`CREATE SCHEMA IF NOT EXISTS mastra`) before deploying Mastra. Document in migration comments that `mastra.*` tables are Mastra-owned — do not touch manually.

**Where this lives:** v1.2 architectural decision. Must be set before the first Mastra integration phase.

---

## 2. Mastra Observational Memory OOM Under Concurrent Threads

**Failure mode:** A confirmed bug (fixed in a recent Mastra changelog, ~Feb 2026) caused the Tiktoken encoder to be allocated per-OM instance rather than shared. The heap cost was 80–120 MB per instance. At low concurrency this is invisible; at moderate concurrency (10+ simultaneous agent invocations) the Fly.io app process OOMs and restarts mid-request. The fix is present in current Mastra, but: (a) the project has not yet pinned a Mastra version, (b) a new `savePerStep` + observational memory interaction that causes message duplication is a separate known conflict that must be explicitly disabled.

**Likelihood:** Medium-high if Mastra is installed without pinning to a post-fix version. Low if pinned correctly.

**Blast radius:** Production-wide. Process restart drops in-flight agent operations; message queue corrupts if the draft-write was partially committed.

**Mitigation:** Pin `@mastra/core` to the version where the OOM fix shipped (verify in changelog: the fix appears in the Feb 2026 changelog cycle). Explicitly set `savePerStep: false` when observational memory is enabled — do not rely on Mastra's auto-disable. Add Fly.io memory metric alerting to catch heap growth before OOM. Run a load spike test (20 concurrent inbound webhooks) before declaring the integration stable.

**Where this lives:** v1.2 requirement. Add to AGENT-01 acceptance criteria: "Pin Mastra version; validate no OOM at 20 concurrent threads."

---

## 3. Mastra Storage Migration Breakage Mid-Milestone

**Failure mode:** Mastra's v1 storage release changed the `metadata` column in `mastra_threads` and `snapshot` column in `mastra_workflow_snapshot` from `TEXT` to `JSONB`. If the project upgrades Mastra minor version mid-milestone without running their migration guide, the `init()` call silently works (tables exist) but subsequent queries using Postgres JSON operators fail because the column is still `TEXT`. Observable as: agent reads succeed but writes with structured metadata throw `invalid input syntax for type json`. If running on Neon's autoscaling free tier, there is no `ALTER COLUMN` privilege upgrade path without a brief compute-active window.

**Likelihood:** Low (only triggers on a Mastra minor/major version bump mid-milestone). Becomes medium if the team upgrades dependencies during v1.2 execution.

**Blast radius:** Cohort-wide (all threads created before the column migration are corrupted for JSON queries; new threads work). Recovery requires an `ALTER TABLE mastra_threads ALTER COLUMN metadata TYPE JSONB USING metadata::jsonb` migration, which requires a compute-active Neon instance.

**Mitigation:** Lock Mastra version at project start. Only upgrade Mastra as a deliberate, tested step with a corresponding migration. Read Mastra's upgrade guide before any version bump — their storage migration guide is published at `mastra.ai/guides/migrations/upgrade-to-v1/storage`.

**Where this lives:** v1.2 requirement. Document in migration conventions: "Mastra version is pinned; upgrades require explicit migration review."

---

## 4. Cross-Provider SMS Duplicate: Spectrum Delivers Webhook for Telnyx-Migrated Thread

**Failure mode:** Student A is verified on Spectrum. The migration SMS is sent and Student A texts the new Telnyx number. Their thread is now "on Telnyx" in your routing table. But Spectrum's webhook delivery is not instantaneous — a queued or delayed Spectrum webhook arrives after the migration. Your webhook handler sees a message from Student A's phone number with a Spectrum `provider_event_id`, looks up the routing table, finds the thread is Telnyx-owned, and either (a) creates a second message record attached to the wrong provider context, or (b) throws an error because the routing constraint rejects a Spectrum event for a Telnyx thread. Observable as: duplicate messages in operator dashboard, or a 500 on Spectrum webhook that Spectrum retries — compounding the duplicates.

**Likelihood:** Medium. Spectrum's webhook retry behavior is not documented with a precise delay ceiling, but typical carrier-grade SMS platforms retry for up to 24 hours.

**Blast radius:** Cohort of students in the migration window. Could corrupt operator drafts for those students.

**Mitigation:** (1) The `student_threads` routing table must include a `provider` column (`spectrum` | `telnyx`) and an `active` flag. (2) Inbound webhook handlers must deduplicate on `provider_event_id` as already implemented (the `messaging_events` idempotency pattern from v1.1). (3) Spectrum webhook handler must: check if the phone's active provider is now `telnyx`; if so, log the event as `migrated_duplicate` and return 200 (not a retry-triggering 5xx). (4) Do not delete Spectrum thread records during migration — soft-retire them with `status='migrated'`.

**Where this lives:** v1.2 architectural decision. Must be baked into the provider-routing layer before migration SMS is sent.

---

## 5. Student Texts the Wrong Number After Migration

**Failure mode:** Migration SMS tells Student A "text us at the new number." Student A has the old Spectrum number saved in contacts. They ignore the migration SMS and continue texting the old number. Two scenarios: (a) Spectrum is still running (correct in v1.2 — it runs in parallel), so the message is received and routed correctly, but now Student A is confirmed on Telnyx in the routing table while actively using Spectrum. The student gets out-of-sync message history. (b) If Spectrum is eventually sunset, Student A's texts vanish with no error (the carrier drops them silently).

**Likelihood:** High for at least a subset of students (muscle memory with saved contacts is strong).

**Blast radius:** Single user per incident, but multiplies with cohort size.

**Mitigation:** (1) v1.2 keeps Spectrum live in parallel — this is already in the plan (correct). Do not sunset Spectrum in v1.2. (2) If a student on a Telnyx thread sends to the Spectrum number, the Spectrum webhook handler should detect the mismatch (phone is active on Telnyx) and send a gentle redirect reply: "Hey — we moved! Text us at [new number] from now on." (3) Track `texts_to_deprecated_number` as a metric. If >5% of migrated students are still texting Spectrum at 30 days, delay any future Spectrum sunset.

**Where this lives:** v1.2 requirement. Add redirect-reply logic to Spectrum webhook handler as part of the migration phase.

---

## 6. Dual Verification — Same Phone on Both Telnyx and Spectrum

**Failure mode:** A race condition during migration or a student who texts both numbers before migration is complete results in two `confirmed` pairing entries in different `student_threads` rows for the same phone number — one with `provider=spectrum`, one with `provider=telnyx`. Subsequent inbound messages match two threads. The agent generates two separate draft contexts. The operator sees duplicate drafts for the same student. If both are approved, the student receives two messages.

**Likelihood:** Low (requires a specific timing window) but catastrophic when it occurs.

**Blast radius:** Single student, but the operator trust in the draft system is damaged.

**Mitigation:** (1) Add a database-level unique constraint on `(normalized_phone, status='confirmed')` across providers — exactly one confirmed thread per phone number allowed at any time. (2) The migration flow must atomically: mark old Spectrum thread as `status='migrating'`, create Telnyx thread as `status='pending'`, and only flip Telnyx to `confirmed` after the student's first Telnyx text is received. (3) If a pairing attempt arrives for a phone that already has a confirmed Spectrum thread and the student is in the Telnyx migration window, return a deterministic winner (Telnyx takes precedence, log the conflict).

**Where this lives:** v1.2 requirement. Implement as a migration-atomic database transaction in the provider-routing layer.

---

## 7. Email Worker Drops Inbound Email When Mastra Ingest Is Down

**Failure mode:** A startup sends an email to `hello@internjobs.ai`. Cloudflare's Email Worker receives it, attempts a POST to the Mastra ingest endpoint on Fly.io. Fly has a cold-start delay, or the app is deploying, or a process restart is in progress. The Worker POST times out or returns a 5xx. Cloudflare's Email Routing behavior when a Worker throws: **the email is dropped**. It does not queue for retry. The startup's email is silently lost. The startup never gets a response and assumes the product is broken.

**Likelihood:** Medium. Fly.io cold starts are real; deploys cause brief downtime; the Mastra process restarts from Pitfall 2 make this worse.

**Blast radius:** Single email per incident. But a lost email from a prospective startup partner is a high-severity product failure in MVP context.

**Mitigation:** (1) The Email Worker must not POST synchronously to Fly. Instead, it should write the raw email (headers + body) to a durable queue — Cloudflare Queues is the natural choice (Email Worker can enqueue without a second HTTP call). The Fly app then consumes from the queue, with retries. (2) If Cloudflare Queues adds complexity, the minimum viable alternative is: Worker forwards the email to a verified destination address (the operator inbox) as a fallback, while also attempting the Fly POST. The operator sees the email even if the ingest fails. (3) Add a Worker-level try/catch that sends a `email.reject` with a human-readable bounce only if you are sure the email is invalid — never reject a valid startup email.

**Where this lives:** v1.2 architectural decision. The queue-or-fallback pattern must be designed before EMAIL-01 is implemented.

---

## 8. Cloudflare Email Routing Cannot Send Outbound

**Failure mode:** The team assumes Cloudflare Email Routing handles both inbound routing and outbound sending (since it owns the `internjobs.ai` domain MX records). It does not. Email Routing is inbound-only. Outbound sending requires either (a) Cloudflare Email Service (private beta → paid product, requires separate setup) or (b) a third-party transactional email provider (Resend, Postmark, SendGrid) configured with appropriate SPF/DKIM records for `internjobs.ai`. If outbound is not planned at the start of v1.2, the operator approval gate will have no send path — the operator approves a draft and nothing happens.

**Likelihood:** High as an assumption failure if outbound is not explicitly designed.

**Blast radius:** Production-wide. The entire `startup email send` leg of INTEG-01 cannot function.

**Mitigation:** Decide outbound provider in v1.2 Phase 1. Options in priority order: (1) Resend + their Neon/Fly-friendly Node.js SDK — straightforward, well-documented, suitable for MVP scale; (2) Postmark — strong deliverability reputation; (3) Cloudflare Email Service if it exits beta and is generally available. Whichever is chosen: add SPF include record for that provider to `internjobs.ai` DNS; configure DKIM; test outbound deliverability against a Gmail/Outlook address before connecting to the approval gate.

**Where this lives:** v1.2 architectural decision. Must be resolved before EMAIL-01 is scoped.

---

## 9. SPF/DKIM Failure on Forwarded Startup Email Degrades Mastra Ingest Quality

**Failure mode:** A startup sends email from `founder@their-startup.com`. Cloudflare Email Routing forwards it to the Mastra ingest endpoint (or a forwarding address). During forwarding, Cloudflare rewrites the envelope sender (Sender Rewriting Scheme) to `internjobs.ai`, which means the original SPF record for `their-startup.com` no longer authorizes the sending server. If the Mastra ingest endpoint or any intermediate relay re-checks SPF, the forwarded message may be flagged or rejected. More practically: the raw email handed to the Worker has authentication headers that report SPF=fail for the original domain. If Mastra or your parsing logic trusts those headers to identify the sender, it may misidentify or reject legitimate startup emails.

**Likelihood:** Low (the Worker receives the email before any re-check), but the downstream reputation concern is real for outbound replies.

**Blast radius:** Single sender per incident.

**Mitigation:** (1) In the Email Worker, extract sender identity from the `From:` header, not from SPF-validated envelope sender — these diverge after forwarding. (2) Do not forward raw emails through intermediate relays that will re-run SPF checks. (3) For outbound replies, ensure your transactional email provider (Pitfall 8) has a properly configured DKIM record for `internjobs.ai` — replies from `hello@internjobs.ai` need to be independently authenticated, not relying on the original sender's reputation.

**Where this lives:** Tracked risk. Low immediate danger; design the email parsing layer to use `From:` header identity.

---

## 10. pgvector — No Index at Launch, Sequential Scans at 10k Rows

**Failure mode:** The `pgvector` column is created and embeddings are inserted, but no index (`HNSW` or `IVFFlat`) is created at migration time. At low row counts (< 1k) sequential scan is fast enough to hide the problem. At 10k conversation embeddings, sequential scan latency is ~36ms per query. At 50k rows it becomes unacceptable. The team may not notice until the matching quality sprint, by which point re-indexing requires a compute-active Neon instance and a maintenance window. Observable as: `EXPLAIN ANALYZE` on a similarity query shows `Seq Scan` with no index use.

**Likelihood:** High. Index creation is not automatic; it is a separate `CREATE INDEX` step that is easy to defer.

**Blast radius:** Production-wide on matching quality. Not a data loss event, but matching latency spikes degrade the agent's response time.

**Mitigation:** Create the HNSW index in the migration that adds the vector column — do not defer. Recommended: `CREATE INDEX CONCURRENTLY ON student_embeddings USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64)`. Use HNSW (not IVFFlat) because: (a) IVFFlat requires knowing the number of lists at index creation time (requires data volume estimate), (b) HNSW has better recall at low-to-mid scale, and (c) Neon's 30x faster HNSW build makes the build cost low. Set `hnsw.ef_search = 40` at query time for the MVP recall/speed tradeoff.

**Where this lives:** v1.2 requirement. AGENT-03 acceptance criteria must include "HNSW index present in migration, not created post-hoc."

---

## 11. Operator Approval Queue — No SLO, Drafts Age Indefinitely

**Failure mode:** The agent produces a draft. The operator is asleep, traveling, or simply behind. The draft sits in the queue for 12 hours. The startup emailed 12 hours ago and interprets the silence as the product not working. Meanwhile the student-side draft for a follow-up may depend on the startup's reply — which hasn't been sent. The queue length grows. There is no expiry, no notification to the operator, and no escalation path. In extreme cases (operator illness), drafts age for days. If the operator then bulk-approves stale drafts, students receive a burst of messages that appear context-free.

**Likelihood:** High. Single operator is a single point of failure by design in v1.2.

**Blast radius:** Cohort-wide when the operator is unavailable. Startup churn risk.

**Mitigation:** (1) Define an explicit SLO: operator reviews drafts within N hours (suggest 4 business hours for MVP). (2) Build operator notification: email or SMS alert when a draft has been pending > X hours (configurable, suggest 2 hours). (3) Add a draft expiry: if a draft is not actioned in 24 hours, mark it `expired` and notify the operator — do not auto-send. (4) Add a draft age column (`drafted_at`) to the approval dashboard so the operator sees staleness at a glance. (5) Document the on-call rotation expectation in the operator runbook even if the "rotation" is one person.

**Where this lives:** v1.2 requirement. APPROVE-01 must include draft-age visibility and notification. The SLO is a tracked risk until a second operator exists.

---

## 12. Startup User Reaching Student-Only Routes — Cross-Role Authorization Leak

**Failure mode:** Clerk issues a session token for a startup user. The startup user navigates directly to `/api/students/:id/profile` or any route gated only on "authenticated Clerk user." If the server-side route handler checks `auth().userId` (truthy) but does not check the user's role (student vs. startup vs. operator), the startup user can read student profiles. Observable in development by: sign in as a startup account, hit a student-facing API route, observe 200 with student data.

**Likelihood:** High during early v1.2 development if routes are built incrementally and role checks are added "later."

**Blast radius:** Single student data exposed per request, but the exposure class is privacy-critical (LinkedIn profile, phone number, conversation history).

**Mitigation:** (1) Establish a role-check middleware that runs before all route handlers — not inside individual handlers. (2) Use Clerk's permission-based authorization rather than role-name checks: define permissions (`student:read`, `startup:read`, `operator:read`) and check the specific permission on every route. (3) Add a route matrix to the test plan: for each route, list which roles may call it and add a negative test (startup token → student route → expect 403). (4) Run this test matrix before any route is merged, not as a pre-launch sweep.

**Where this lives:** v1.2 requirement. Must be designed at project start for v1.2, not bolted on at the end. Add to STARTUP-01 and ROLE-01 acceptance criteria.

---

## 13. Operator User Type Modeled as Application-Level Flag, Not Clerk Org Role

**Failure mode:** The operator user is implemented as a database flag (`users.role = 'operator'`) checked after Clerk authentication succeeds. An attacker who can modify their own database record (via a SQL injection, IDOR on a user-update route, or a misconfigured admin API) can escalate to operator. More likely: a developer testing locally sets their account to `operator` in the dev database and forgets that the prod database uses a different mechanism. The operator dashboard is then reachable by non-operators in prod.

**Likelihood:** Low (SQL injection is unlikely with parameterized queries), but the architectural smell is real at MVP scale.

**Blast radius:** If exploited: production-wide (operator can approve/send any message to any student).

**Mitigation:** Model the operator as a Clerk Organization membership with a restricted role, or at minimum use Clerk's `publicMetadata.role = 'operator'` (set via Clerk Dashboard or backend-only API, not writable by the user). The backend must validate `session.user.publicMetadata.role` server-side on every operator route, not trust a database column that a client API could influence. Restrict the `publicMetadata.role` write path to a Clerk backend API call only (not exposed to the client).

**Where this lives:** v1.2 architectural decision. Decide before APPROVE-01 is implemented.

---

## 14. Latency Between Startup Email and Student SMS Reply Breaks Startup UX Expectation

**Failure mode:** A startup sends an email to a student at 10am. The intended path is: email → Worker → Mastra ingest → agent draft → operator review → operator approves → Telnyx SMS sent → student replies via SMS → Worker/webhook → agent draft → operator review → operator approves → email sent to startup. Total round-trip latency is 2× operator review time + agent processing time. At a 4-hour operator SLO, the startup's email gets a "reply" 8–12 hours later. Startups accustomed to email expect replies in minutes to hours, not a day. The startup emails again ("did you get my message?"), generating a second agent draft before the first is actioned. The operator now has two drafts for the same thread in an ambiguous order.

**Likelihood:** High. This is the fundamental UX tension in the human-in-the-loop model.

**Blast radius:** Startup churn risk. Every startup interaction in v1.2 is affected.

**Mitigation:** (1) Send an automatic acknowledgment email to the startup on inbound receipt — "We received your message and will route it to the student. You'll hear back within [N] hours." This is a Worker-level action, no operator required. (2) Define and communicate the operator SLO explicitly in startup onboarding ("expect N business hours"). (3) Add deduplication logic: if a second inbound from the same startup arrives for the same thread before the first draft is actioned, attach it to the existing pending draft rather than creating a new one. (4) Surface "startup is waiting" age prominently in the operator dashboard.

**Where this lives:** v1.2 requirement. The auto-acknowledgment is a must-have; the SLO communication belongs in STARTUP-02. Deduplication belongs in AGENT-01.

---

## 15. Agent Stores Inferred PII from Unstructured Startup Email — TCPA/CAN-SPAM Surface

**Failure mode:** A startup email contains unstructured information: "We're looking for someone in NYC interested in fintech — saw you went to NYU." Mastra's agent reads this, infers student attributes (location preference, university, interest area), and stores these inferences in pgvector embeddings or Mastra thread memory. These inferred attributes were never explicitly provided by the student and were not covered by the student's consent at pairing time. Under TCPA (as extended to AI agents by the FCC in 2025), the consent required for AI-assisted communications must be explicit and specific. Storing inferred PII derived from a third party's communication about a student — without that student's review — creates a new, unconsented data category. The existing `consents` table and audit trail do not cover this flow.

**Likelihood:** Medium. This data flow is new in v1.2 and was not contemplated in the v1.0 consent design.

**Blast radius:** Regulatory, not per-user. If this is audited, the finding would apply to all students whose threads contain agent-inferred attributes derived from startup emails.

**Mitigation:** (1) The agent must not store startup-inferred attributes about a student as first-class profile data — only store them in ephemeral thread context for the current conversation. (2) If matching quality requires persistent cross-conversation inference, add an explicit consent prompt to students: "Can we use information from startup outreach to improve your matches?" (3) Document the data flow in the privacy runbook: startup email → agent inference → operator-reviewed draft. The inference is transient; only the draft text persists. (4) Add a field to the `consents` table for `agent_inference_consent` before writing any persistent inferred attributes. (5) In v1.2, err on the side of not persisting inferences — the operator sees the full draft before any student data is sent.

**Where this lives:** v1.2 requirement. Consent schema must be updated before AGENT-01 is built.

---

## 16. Cloudflare DNS Proxy Still Blocking Clerk OAuth — Carryover from v1.1

**Failure mode:** `accounts.internjobs.ai` and `clerk.internjobs.ai` have Cloudflare proxy (orange cloud) enabled. Clerk requires these records to be DNS-only (gray cloud). With proxy enabled, Clerk's OAuth redirect loop breaks silently for new users: the LinkedIn OAuth flow completes, Clerk attempts to redirect back to `accounts.internjobs.ai`, Cloudflare intercepts the TLS handshake, Clerk's certificate validation fails, and the user sees a generic error. The v1.1 audit flagged this as unresolved. v1.2 adds startup and operator users — both flows also require Clerk. If this is not fixed before v1.2 execution, zero new users can complete sign-up.

**Likelihood:** High (the bug is known and has not been fixed).

**Blast radius:** Production-wide. No new user (student, startup, operator) can authenticate.

**Mitigation:** Fix this before writing a single line of v1.2 code. Steps: Cloudflare DNS dashboard → locate `accounts.internjobs.ai` and `clerk.internjobs.ai` → toggle proxy to "DNS only" → verify Clerk OAuth round-trip with a real LinkedIn account. This should take 15 minutes. It is the prerequisite for all of v1.2.

**Where this lives:** v1.2 requirement. Gate milestone execution on this fix. It is not optional.

---

## 17. CLERK_SECRET_KEY in Conversation History — Rotation Pending

**Failure mode:** The `CLERK_SECRET_KEY` for the production Clerk app was pasted in chat on 2026-05-15 and is in conversation history. The v1.1 audit recorded this as "accepted residual risk." v1.2 increases the blast radius: the same key now controls startup and operator user identity, not just student waitlist access. If the key is compromised, an attacker can impersonate any user type, including the operator who can approve outbound messages to students.

**Likelihood:** Low (requires access to the specific conversation history). Risk is elevated in v1.2 because the key's scope widens.

**Blast radius:** Production-wide. Key compromise means impersonation of any user type including operator approval actions.

**Mitigation:** Rotate `CLERK_SECRET_KEY` before v1.2 execution. Steps: Clerk Dashboard → API Keys → rotate secret key → update Infisical `prod`/`/internjobs-ai` → re-import to Fly via `flyctl secrets import`. The rotation takes 10 minutes. The v1.1 risk acceptance was reasonable for a waitlist; it is not acceptable for a two-sided platform with an operator approval gate.

**Where this lives:** v1.2 requirement. Must be completed in Phase 1 of v1.2 alongside the DNS proxy fix.

---

## 18. pgvector Embedding Dimension Locked at Table Creation — Model Upgrade Requires Re-Index

**Failure mode:** The vector column is created with a fixed dimension (e.g., `vector(1536)` for OpenAI `text-embedding-ada-002`, or `vector(3072)` for `text-embedding-3-large`). If the team upgrades the embedding model mid-milestone or post-launch, the column dimension does not match the new model's output. Every insert throws a dimension mismatch error. Re-indexing requires: `ALTER TABLE ... DROP COLUMN embedding`, `ALTER TABLE ... ADD COLUMN embedding vector(NEW_DIM)`, re-embed all existing records (API cost + time), rebuild HNSW index. At 10k records, this is feasible but disruptive. The risk is picking the wrong dimension at launch and needing to migrate mid-MVP.

**Likelihood:** Low (if you pick the model first and create the column to match). Medium if the model selection is deferred or defaults to a placeholder.

**Blast radius:** Production-wide when triggered; data migration required.

**Mitigation:** (1) Decide the embedding model before writing the migration. Recommendation for MVP: OpenAI `text-embedding-3-small` at `vector(1536)` — lower cost than `3-large`, good recall at MVP scale, and the dimension is stable. (2) Document the chosen model and dimension in the migration comment. (3) If there is any uncertainty about the model, store the model name alongside each embedding row so re-embedding can be targeted at only the records using the old model.

**Where this lives:** v1.2 architectural decision. Finalize before AGENT-03 migration is written.

---

## 19. Mastra Thread Memory Grows Unbounded — No TTL or Summarization Threshold

**Failure mode:** Mastra threads are append-only by default. Every message in a student-startup conversation is added to the thread. After 50–100 messages, the thread context window fed to the LLM on each agent invocation approaches the model's context limit. The LLM either (a) truncates silently, losing early context, or (b) the token count exceeds the model's limit and the agent call fails with a context-length error. Observable as: agent responses become less coherent over long-running conversations, or agent calls start failing for students with many messages.

**Likelihood:** Medium at MVP scale (student conversations are unlikely to hit 100 messages in v1.2). High in v1.3+ if not addressed.

**Blast radius:** Single student (the one with the long thread) initially. Grows as student tenure increases.

**Mitigation:** (1) Configure Mastra's `lastMessages` parameter to limit the context window to the N most recent messages (suggest N=20 for MVP). (2) Enable Mastra's `summarizeConversation` option or implement a background job that summarizes threads older than 30 days into a compressed representation stored in pgvector. (3) The pgvector semantic memory (AGENT-03) is specifically designed to handle long-term recall without inflating thread context — ensure this is wired before thread length becomes a problem. (4) Add a `thread_message_count` metric to monitor for threads approaching the context limit.

**Where this lives:** v1.2 architectural decision. Configure at AGENT-02 implementation time. Defer summarization background job to v1.3 if thread lengths stay short, but document the trigger threshold.

---

## Top 5 Pitfalls to Mitigate in v1.2 Sequencing

These five determine phase ordering. They must be resolved before the phases that depend on them.

**1. Pitfall 16 — Clerk DNS Proxy (Carryover)**
Fix first, before any v1.2 execution. No new user type can be tested without it. Prerequisite for STARTUP-01, APPROVE-01, and all identity testing.

**2. Pitfall 17 — CLERK_SECRET_KEY Rotation**
Fix alongside the DNS proxy fix (same Phase 1 session). The key's blast radius widens in v1.2 from student-only to all three user types including the operator approval gate.

**3. Pitfall 8 — Outbound Email Architecture**
Must be decided before EMAIL-01 is scoped. Cloudflare Email Routing cannot send — if the team assumes it can, the entire outbound leg of INTEG-01 is undeliverable. Architectural decision required in Phase 1.

**4. Pitfall 1 — Mastra Schema Isolation**
Must be configured before the first Mastra integration phase. If deployed without `schemaName: 'mastra'`, table naming confusion is hard to retrofit. One config line, zero cost, infinite diagnostic value.

**5. Pitfall 12 — Cross-Role Authorization**
The route authorization model (who can call what) must be designed before startup and operator routes are built, not reviewed after. Retrofitting permission checks across 20 routes is expensive; building them in from route one is free.

---

## Suggested Project Updates

### REQUIREMENTS.md Updates
- Add to v1.2 Active: "SEC-01: Clerk DNS proxy on `accounts.internjobs.ai` and `clerk.internjobs.ai` must be set to DNS-only before any v1.2 phase begins."
- Add to v1.2 Active: "SEC-02: `CLERK_SECRET_KEY` rotated and re-imported to Fly before v1.2 Phase 1 completes."
- Add to v1.2 Active: "CONSENT-01: `consents` table extended with `agent_inference_consent` field before AGENT-01 ships."
- Add to Future Backlog: "OPS-05: Thread summarization background job for Mastra threads exceeding 50 messages — defer to v1.3."

### ROADMAP.md Updates
- Note for v1.2 Phase 1: "Phase 1 must include DNS proxy fix, CLERK_SECRET_KEY rotation, and outbound email provider decision before any feature phases begin."
- Suggest future milestone: "v1.3 Thread Health" — covers Mastra thread summarization, Spectrum sunset, Telnyx voice, and provider activation runbooks for Cognee/Sprite/BrightData.

### Constraints Additions for PROJECT.md
- "Mastra schema must use `schemaName: 'mastra'` — never the `public` schema."
- "Outbound email requires a transactional email provider (Resend or Postmark) in addition to Cloudflare Email Routing, which is inbound-only."
- "Operator role must be modeled as Clerk `publicMetadata.role` (backend-write-only), not a database flag."
