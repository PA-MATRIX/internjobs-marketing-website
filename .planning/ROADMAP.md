# Roadmap: InternJobs.ai

**Status:** 🚧 v1.2 — Two-Sided Agent MVP (active)

## Milestones

- ✅ **v1.0 Waitlist Identity and Messaging Foundation** — Phases 01–06 (shipped 2026-05-09)
  - Archive: `.planning/milestones/v1.0-waitlist-app/`
- ✅ **v1.1 Seamless Waitlist and Student Threading** — Phase 01 (shipped 2026-05-15)
  - Archive: `.planning/milestones/v1.1-seamless-waitlist/`
- 🚧 **v1.2 Two-Sided Agent MVP** — Phases 01–06 (active)
  - Workspace: `.planning/milestones/v1.2-two-sided-agent-mvp/`

## v1.2 Overview

Stand up a Mastra-powered agent that drafts AND autonomously sends both sides of the student↔startup conversation, with startups onboarded as a first-class user type and email as their primary channel. Student SMS stays on the existing Spectrum/Photon path; v1.2 only ships an `SmsProvider` interface seam so v1.3+ can swap in Telnyx without touching call-sites.

**Autonomy pivot (2026-05-17):** the v1.2 plan originally had a human-in-the-loop operator approval gate. That gate was removed because turn-by-turn approval latency made conversational UX impossibly slow. The agent now sends autonomously; `/ops/drafts` is a read-only audit log + flag-for-review surface. Safety posture: system-prompt-level guardrails today, Lakera Guard pre-LLM screening in v1.3 (SAFETY-01).

**Phase numbering convention:** v1.2 restarts at Phase 01 (per existing v1.0/v1.1 pattern). Each milestone has its own phase sequence under its workspace directory.

## Phases (v1.2)

- [ ] **Phase 01: Pre-flight + SMS Provider Abstraction** — Clear v1.1 carry-over blockers; wrap Spectrum/Photon behind a swappable `SmsProvider` interface.
- [ ] **Phase 02: Startup Identity, Consent & Roles** — Email-first Clerk auth for startups; profile + consent capture; roles CRUD.
- [ ] **Phase 03: Startup Email Channel (Inbound + Outbound)** — CF Email Routing → Worker → Mastra ingest; Resend (or equivalent) for outbound with SPF + DKIM.
- [ ] **Phase 04: Mastra Agent Core** — Workflow that drafts (never sends); thread memory in dedicated `mastra` schema; pgvector with HNSW index.
- [ ] **Phase 05: Operator Audit Log (was: Approval Gate)** — `/ops/drafts` is a read-only audit log of every autonomous-agent send; operators flag bad messages post-hoc for prompt-tuning review (no pre-send approval after the 2026-05-17 autonomy pivot).
- [ ] **Phase 06: Two-Sided Integration Smoke Test** — All 11 INTEG-01 steps pass end-to-end in production.
- [x] **Phase 07: Self-Hosted iMessage Bridge** — Replace Photon-cloud iMessage with Mac mini + spectrum-ts local + Cloudflare Tunnel; MacBridgeSmsProvider on Fly behind the existing SmsProvider seam. Cost drop $250→$73/mo. (Added 2026-05-17.)
- [x] **Phase 08: Agentic Inbox + MCP** — `internjobs-agentic-inbox` Worker live at agent.internjobs.ai (Mailbox DO + Email MCP + send_email binding + R2 + AI). CF Email Routing for maya@agent.internjobs.ai → Worker. Sunsets the earlier /webhooks/agent-mail. Shipped 2026-05-17.
- [x] **Phase 07b: BlueBubbles + SIP-off Mac Bridge** — Native iMessage UX on HostMyApple Mac mini with BlueBubbles + Private API helper. Tapback + read receipt + held typing bubble across LLM round-trip. Full round-trip 4.1s. Shipped 2026-05-18.
- [x] **Phase 09: LinkedIn Enrichment + QR Onboarding** — Standout-style flow: LinkedIn OAuth → Proxycurl/Cognee enrichment → QR-code phone pairing. Shipped 2026-05-18.
- [x] **Phase 10: Parrot — Internal Employee Workspace (Wave 1+2+2b)** — `workspace.internjobs.ai` live with phone-OTP auth, Slack-style dual-rail UI (Dashboard / Email / Chat / Meetings), Mattermost-embedded Chat, embedded Clerk SignIn, UserMenu with sign-out, CF Email Routing per employee. Two separate production Clerk apps (student + employee) instead of the originally-planned shared instance. Shipped 2026-05-19. (Waves 3, 4, 5 split into Phase 11, 12, 13 below.)
- [ ] **Phase 11: Daily.co Integration (was Parrot Wave 3)** — Daily.co account + REST + JS SDK embed in Parrot's Meetings pane. Per-employee always-on personal rooms. "Start meeting" CTAs from Inbox + Chat. (Split from Phase 10 on 2026-05-19.)
- [x] **Phase 12: Dashboard Mothership Agent (was Parrot Wave 4)** — Per-employee LLM agent (kimi-k2.6 via Cloudflare AI Gateway with per-employee daily caps) monitoring Email + Chat, extracting cross-channel todos via DO alarm-driven Mattermost polling + fire-and-forget email hook, ranking them with a hybrid urgency formula, and surfacing them on the Parrot Dashboard pane. Phone + SMS placeholder nav icons + route stubs (seams, not integrations) also ship here. Storage is `EmployeeMailboxDO` extended with a `todos` table — no new DO class, no Mastra in Parrot. Shipped 2026-05-19 (10 commits 5fe02a9..f7d4be6; 3 waves: 12-01 foundation + 12-02 ingest/extraction + 12-03 UI/ranking; verifier `human_needed` for live AI Gateway + browser checks; 1 advisory fixed inline as `f7d4be6`).
- [ ] **Phase 13: Cross-pane Actions + Launch Polish (was Parrot Wave 5)** — Email↔Chat↔Meeting cross-pane actions, unified notification pane, browser push, first-login wizard, pilot rollout. (Split from Phase 10.)

## Phase Details

### Phase 01: Pre-flight + SMS Provider Abstraction

**Goal:** Clear the v1.1 carry-over blockers and seal the Spectrum/Photon SMS path behind an `SmsProvider` interface so v1.3+ can swap in Telnyx (or any other adapter) without touching call-sites.

**Depends on:** Nothing (first phase of v1.2)

**Requirements:** SEC-01, SMS-01

**Success Criteria** (what must be TRUE):
1. Live LinkedIn → Clerk → app sign-in completes end-to-end against prod Clerk (`accounts.internjobs.ai` and `clerk.internjobs.ai` are DNS-only, not proxied).
2. All Spectrum/Photon send + receive calls in `apps/app` go through an `SmsProvider` interface — no direct Photon SDK calls remain in route handlers or workflows.
3. `/healthz` continues to report `clerk/database/photonNumber/photonWebhook/spectrumListener` all `true` after the refactor.
4. v1.1 waitlist + threading flow (WAIT-01..03, THREAD-01) continues to work unchanged in prod — no regression.

**Plans:** TBD (refined during `/rrr:plan-phase 1`)

### Phase 02: Startup Identity, Consent & Roles

**Goal:** Startups can sign up, profile themselves, grant `messaging_on_behalf` consent, and manage their roles — without LinkedIn being required.

**Depends on:** Phase 01

**Requirements:** STARTUP-01, STARTUP-02, ROLE-01

**Success Criteria** (what must be TRUE):
1. A new startup founder can sign in via email/password, Google, or Microsoft through Clerk (LinkedIn-required is OFF for the startup landing) and lands on a startup dashboard.
2. Startup onboarding captures company profile + `messaging_on_behalf` consent, creating rows in `startups`, `startup_members`, and `startup_consents`.
3. Middleware blocks startup users from accessing agent features (e.g., role creation, draft routes) until `messaging_on_behalf` consent is granted.
4. Startup founder can create, view, edit, and pause roles (title, description, requirements, status, location, comp_range) from the dashboard. Pause sets `status='paused'` (no hard delete).

**Plans:** TBD

### Phase 03: Startup Email Channel (Inbound + Outbound)

**Goal:** Email is the startup channel — both directions are working before the agent core depends on them.

**Depends on:** Phase 02

**Requirements:** EMAIL-01, EMAIL-02

**Success Criteria** (what must be TRUE):
1. Email sent to startup-facing `internjobs.ai` address is received by a Cloudflare Worker via CF Email Routing, then forwarded (HMAC-signed) to a `/webhooks/email` ingest endpoint on the Fly app.
2. Inbound email receipt is logged in `audit_events` with `event_type='startup_email_received'`.
3. An outbound transactional email provider (Resend candidate) is configured with verified SPF + DKIM on `internjobs.ai`, and a test outbound email from `noreply@internjobs.ai` (or equivalent) delivers successfully to a Gmail and an Outlook inbox.
4. `/healthz` reports `emailWorkerSecret` and outbound-provider-key status keys both `true`.
5. Per-conversation Reply-To aliases (`conv-{id}@internjobs.ai`) parsed by Worker on inbound; deterministic thread routing (the UUID is shipped in the JSON payload and written into `inbound_messages.metadata.conversation_id`). EMAIL-03 scope-add 2026-05-16.

**Plans:** TBD

### Phase 04: Mastra Agent Core

**Goal:** The agent reads inbound (SMS or email), matches a student to a role, and writes a draft — never sends. Memory is persistent and isolated from application tables.

**Depends on:** Phase 03

**Requirements:** AGENT-01, AGENT-02, AGENT-03

**Success Criteria** (what must be TRUE):
1. A student inbound SMS (via the Phase 01 `SmsProvider`) triggers a Mastra workflow that reads the student's profile context, matches against active `roles`, and writes a `drafts` row with `status='pending_review'`. No outbound is sent at this phase.
2. Mastra thread memory persists in a dedicated `mastra` Postgres schema (`schemaName: 'mastra'`, never `public`) and is queryable by `student_id` and `startup_id` keys.
3. `vector` extension + HNSW index exist on Neon (created in the migration, not deferred); embeddings are written for student profiles and roles on save/update.
4. Toggling `USE_VECTOR_MATCH` flips the match step between keyword and cosine similarity without errors; missing-embedding fallback to keyword works.
5. R2 storage scaffold ready (private bucket + signed URL client at `apps/app/src/storage/r2.mjs`); no attachment ingestion (deferred to v1.3 STORAGE-02). STORAGE-01 scope-add 2026-05-16.

**Plans:** TBD

### Phase 05: Operator Audit Log (was: Approval Gate)

**Goal:** `/ops/drafts` is the read-only audit log of every autonomous-agent message. The 2026-05-17 pivot removed the pre-send approval gate; operators flag bad messages post-hoc for prompt-tuning review.

**Depends on:** Phase 04

**Requirements:** OPS-01, OPS-02

**Success Criteria** (what must be TRUE):
1. `/ops/drafts` lists every agent draft (regardless of status: sent / failed / sending / flagged + legacy pre-pivot rows) with conversation context (student, startup, role, prior turns), ordered newest-first. Auth is `requireOperatorAuth` middleware checking Clerk `publicMetadata.userType === 'operator'` (not a DB flag).
2. Detail view (`GET /ops/drafts/:id`) is read-only — no approve/edit/reject forms. It shows the sent body, provider_message_id, send-error blob if the row is in `'failed'`, and a "Flag for review" form (`POST /ops/drafts/:id/flag`).
3. The Mastra workflow autonomously sends agent responses on both student SMS and (future) startup email channels: INSERT with `status='sending'`, route to `outbound.routeAndSend`, then UPDATE to `'sent'` (with `sent_at` + `provider_message_id`) on success or `'failed'` on send error (with `audit_events` row `event_type='auto_send_failed'`). Send failures do not crash the workflow.
4. Flagged drafts appear in `/ops/feedback` (filtered to `feedback_type='flagged'`), readable by the human prompt-tuner.
5. The deprecated pre-pivot endpoints (`POST /ops/drafts/:id/{approve,edit,reject}`) return 410 Gone with `reason='approval_gate_removed_2026_05_17'`.

**Plans:** TBD

### Phase 06: Two-Sided Integration Smoke Test

**Goal:** All 11 steps of INTEG-01 pass end-to-end in production without manual DB intervention.

**Depends on:** Phase 05

**Requirements:** INTEG-01

**Success Criteria** (what must be TRUE):
1. The 11-step smoke test from `.planning/milestones/v1.2-two-sided-agent-mvp/research/FEATURES.md` INTEG-01 executes end-to-end in production: student inbound (Spectrum) → agent draft → operator approve → startup email → startup reply → agent draft → operator approve → student SMS.
2. Each step produces the expected Neon row(s); no manual DB intervention is required at any step.
3. No outbound message is observed without a corresponding `drafts.status='sent'` transition.
4. Test transcript + Neon row snapshots are recorded in `VERIFICATION.md` for the phase (closes the v1.1 audit gap that no RRR verification artifacts existed for v1.0/v1.1 phases).

**Plans:** TBD

### Phase 07: Self-Hosted iMessage Bridge

**Goal:** Run iMessage on dedicated infrastructure we own (Mac mini + spectrum-ts local mode + Cloudflare Tunnel), eliminating Photon's $250/mo/line Business pricing and replacing it with $73/mo of fully-owned compute + a US Mobile SIM.

**Depends on:** Phase 01 (SmsProvider seam — MacBridgeSmsProvider implements the same interface)

**Requirements:** SMS-01 (new SmsProvider impl), v1.2 cost/sovereignty scope-add

**Success Criteria** (what must be TRUE):
1. `https://bridge.internjobs.ai/health` is reachable from anywhere on the public internet and returns 200 OK.
2. Outbound iMessage routes through the Mac mini when `SMS_PROVIDER=mac-bridge` on Fly; spectrum-ts cloud remains the default until the agent Apple ID is activated (Phase 09 user action).
3. `/webhooks/mac-bridge` enforces HMAC-SHA256 over `BRIDGE_HMAC_SECRET`; signed payloads land an `inbound_messages` row when the channel_address matches a confirmed student.
4. The Mac bridge + cloudflared survive a host restart (`@reboot` crontab; launchd was not viable over SSH on macOS 26.3 — documented constraint).
5. End-to-end smoke test: Mac → CF Tunnel → bridge URL → /v1/send returns 200 with valid HMAC, 401 with bad sig.

**Plans:** `.planning/milestones/v1.2-two-sided-agent-mvp/phase-07-self-hosted-imessage-bridge/PLAN.md`

**Status:** Code-complete (commits `61e9707` + `d89fe4a` + `d5f3eb1`). Real iMessage round-trip blocked on Phase 09 user actions (Apple ID + US Mobile SIM activation).

### Phase 08: Agentic Inbox + MCP

**Goal:** Deploy Cloudflare's `agentic-inbox` Worker as the agent's identity-mailbox surface, with a per-mailbox Durable Object, R2 attachment storage, CF Access SSO gate, and a built-in MCP server the Mastra workflow consumes for read/draft/send tools. Establishes the agent's omnichannel reach (iMessage via Phase 07, email via this phase).

**Depends on:** Phase 03 (existing CF Email Routing for `agent.internjobs.ai`), Phase 07 (Mac bridge for the matching iMessage identity)

**Requirements:** EMAIL-AGENT-01 (new), v1.2 omnichannel scope-add

**Success Criteria** (what must be TRUE):
1. `agentic-inbox` Worker deployed at a custom domain under our control, gated by CF Access.
2. `agent-mac@agent.internjobs.ai` inbound mail lands in the `MailboxDO` and is visible in the UI.
3. The Worker's `/mcp` endpoint responds to MCP protocol calls authenticated via CF Access service token.
4. The Mastra workflow on Fly can invoke the MCP `send_email` tool against agentic-inbox and produce an outbound message.
5. Existing `conv-{uuid}@agent.internjobs.ai` student-conversation pipeline (Phase 03) continues to work unchanged — no regression.
6. Home-rolled `/webhooks/agent-mail` + `agent_emails` table (migration `0006`) are sunset cleanly; agentic-inbox owns identity mailbox storage going forward.

**Plans:** `.planning/milestones/v1.2-two-sided-agent-mvp/phase-08-agentic-inbox-mcp/PLAN.md`

**Status:** Plan written. Wave 2a (deploy + CF Access setup) and Wave 2b (MCP tool wiring) not started. Blocked on user CF Access configuration in the Cloudflare Zero Trust dashboard (one-click Access on the Worker → paste POLICY_AUD + TEAM_DOMAIN back).

### Phase 10: Parrot — Internal Employee Workspace

**Goal:** Single signed-in workspace at workspace.internjobs.ai unifying email + chat + video for ~50-60 InternJobs employees/interns. Reuses agentic-inbox MailboxDO pattern (per-employee mailboxes), embeds Mattermost Team Edition (self-hosted Fly, official Daily.co plugin) and Daily.co flat-rate plan. New Clerk instance isolates internal directory from student/startup. Cross-pane actions: chat → meeting, email → chat, meeting recap → email. Strategic positioning: same way Chert is "iMessage infra as product," Parrot is "internal workspace as product" — InternJobs eats own dogfood first, spin out later.

**Depends on:** Phase 08 (agentic-inbox MailboxDO pattern)

**Requirements:** WORKSPACE-01 (new), v1.2 scope-add

**Success Criteria** (what must be TRUE):
1. workspace.internjobs.ai resolves to Parrot Worker, gated by second Clerk instance (employees only).
2. Each employee has name@internjobs.ai auto-provisioned on first login, stored in per-mailbox Durable Object.
3. Mattermost Team Edition self-hosted, embedded in Parrot UI Chat pane, SSO-bridged via Clerk JWT.
4. Daily.co (flat-rate plan) embedded in Meetings pane; "Start Meeting" CTAs in Inbox + Chat.
5. Cross-pane: chat → email this thread; email → move to chat channel; meeting → auto-summary to chat or email.
6. Existing v1.2 surfaces (app.internjobs.ai, agent.internjobs.ai, maya@) unaffected.

**Plans:** `.planning/milestones/v1.2-two-sided-agent-mvp/phase-10-parrot-employee-workspace/PLAN.md`

**Status:** Plan written + user decisions locked (Mattermost, Daily.co flat-rate, plain submodule names). Awaiting execution-start signal. Independent of Phase 07b SIP-off — can run in parallel.

### Phase 12: Dashboard Mothership Agent

**Goal:** Per-employee LLM agent monitoring Email + Chat, extracting cross-channel todos, ranking them by urgency × recency × mention boost, and surfacing them on the Parrot Dashboard pane. Also adds Phone + SMS placeholder nav icons + route stubs (seams documenting the future @cloudflare/voice + Telnyx direction — NOT integrations).

**Depends on:** Phase 10 (Parrot Worker + EmployeeMailboxDO + Mattermost)

**Architecture decisions locked (do not re-litigate):**
- Storage: `EmployeeMailboxDO` extended with `todos` table (migration `3_todos_table`). No new DashboardDO. No Mastra in the Parrot Worker.
- Email ingest: fire-and-forget hook (`void this.extractTodosFromEmail(...)`) inside `createEmail()` when folder = Inbox. Never blocks email storage; extraction failures don't propagate to caller.
- Chat ingest: DO alarm self-rescheduling at 2-minute intervals via `ctx.storage.setAlarm()`.
- LLM: `@cf/moonshotai/kimi-k2.6` via **Cloudflare AI Gateway** (`gateway.ai.cloudflare.com/v1/{account}/{PARROT_AI_GATEWAY_ID}/workers-ai/...`) — NOT direct Workers AI REST. Per-employee daily caps via `cf-aig-metadata: {"user_id": clerk_user_id}` header; prompt caching via `cf-aig-cache-ttl` (3600 email, 1800 chat). Account `0fffd3dc637bdb26d4963df445a69fd3`. Fail-soft (returns [] on error; 429 logs `audit_events.event_type='ai_gateway_quota_exceeded'`). **Contrast:** student app at apps/app/ still uses direct REST — no migration as side-effect of Phase 12. *(Decided 2026-05-19; see memory `project-llm-via-ai-gateway.md`.)*
- Mattermost: bot account REST polling, `GET /api/v4/channels/{id}/posts?since={ms-5000}`. INSERT OR IGNORE deduplication on `source_id`.
- Ranking: hybrid SQL `ORDER BY` at read time — `(urgency_score*2) + mention_boost + deadline_boost - recency_decay`.
- Phone/SMS: lucide `Phone` + `MessageCircle` icons in WorkspaceShell NAV; route stubs at `/phone` + `/sms` with source comments documenting future `@cloudflare/voice` + `withVoice(Agent)` + Twilio/Telnyx direction.
- NOT installed: `@cloudflare/voice`, `agents`, any telephony npm package.

**Success Criteria** (what must be TRUE):
1. Inbound Inbox email triggers todo extraction; todos appear in `GET /api/dashboard/todos`.
2. DO alarm fires every 2 minutes and polls Mattermost for chat todos.
3. `/dashboard` renders ranked todo cards with source icon, click-through to `/inbox?message=`.
4. `/phone` and `/sms` routes render placeholder UI with seam comments.
5. WorkspaceShell icon rail shows Phone + SMS between Meetings and admin section.
6. Smoke test (`POST /api/dev/smoke/seed-email`) returns `pass: true` with real AI credentials.
7. Ranking regression (`POST /api/dev/smoke/ranking`) returns `pass: true`.
8. Existing panes (Inbox/Chat/Meetings) unaffected.

**Plans:** 3 plans, 3 waves
- [ ] 12-01-PLAN.md — Foundation: todos migration + AI helper + GET /api/dashboard/todos + Phone/SMS nav seams
- [ ] 12-02-PLAN.md — Ingest + LLM extraction: email hook + DO alarm + Mattermost poller + smoke test
- [ ] 12-03-PLAN.md — UI + ranking: TodoCard component + dashboard loader + view filters + click-through + ranking regression

### Phase 13: Cross-pane Actions + Launch Polish

**Goal:** Email↔Chat↔Meeting cross-pane actions, unified notification pane, browser push notifications, first-login wizard, and pilot rollout readiness for Parrot.

**Depends on:** Phase 12 (EmployeeMailboxDO with todos table + Mattermost helpers + AI Gateway helper)

**Architecture decisions locked:**
- No new LLM call sites. Push VAPID signing uses `crypto.subtle` (Workers built-in) — no `web-push` npm package.
- `StartMeeting` CTA is a UI seam: shows "Meetings coming soon" toast + writes audit notification row. Daily.co NOT called (deferred to Phase 11).
- Push subscriptions + notifications stored in EmployeeMailboxDO via migration `4_notifications_push`. No new DO class.
- Feature flags: KV namespace `PARROT_FEATURE_FLAGS` holds global defaults (JSON); per-employee overrides stored in `feature_flags` column added by migration `5_onboarding_flags`. Merged at read time — employee wins.
- Service worker at `/sw.js` is push-only: handles `push` + `notificationclick` events, DOES NOT intercept fetch (no asset cache conflict with React Router/Vite).
- Sentry: inline `reportToSentry()` helper (no `@sentry/cloudflare` npm dep in Wave 1) wired into Hono's `app.onError`.
- NOT installed: `@daily-co/*`, `@cloudflare/voice`, `agents`, `@telnyx/*`, `web-push`.

**Success Criteria** (what must be TRUE):
1. Bell icon in WorkspaceShell topbar shows unread count badge; notification drawer lists recent events (urgent todos, starred emails, @mentions) with read/unread state.
2. Browser push fires when urgency_score >= 70, starred inbound email arrives, or @mention detected in Mattermost poll.
3. Service worker at /sw.js registered by WorkspaceShell, handles push + notificationclick, does NOT cache any static assets.
4. EmailToChat: creates Mattermost channel from email participants + seeds with email body; navigates to /chat.
5. ChatToEmail: opens compose draft modal pre-filled with quoted chat post body.
6. StartMeeting: shows "Meetings coming soon" toast; writes audit notification row; no Daily.co call under any code path.
7. First-login wizard (3-step modal) shown when onboarded_at IS NULL; re-shown on every visit until complete; skippable per visit.
8. GET /healthz returns { mattermost_reachable: bool, ai_gateway_reachable: bool, mailbox_count: number }.
9. All five smoke endpoints return pass: true (push, crosspane, onboarding, seed-email, ranking).
10. PILOT-RUNBOOK.md exists in the phase directory.

**Plans:** 3 plans, 3 waves (sequential)
- [ ] 13-01-PLAN.md — Notifications + push: migration 4, push VAPID DO methods, /api/push/subscribe, /api/notifications, sw.js, notification drawer in WorkspaceShell
- [ ] 13-02-PLAN.md — Cross-pane actions: emailToChat + chatToEmail DO methods, replace three 501 stubs, finish three crosspane UI components
- [ ] 13-03-PLAN.md — First-login wizard + pilot readiness: migration 5, OnboardingWizard, feature flags KV, /healthz, Sentry, PILOT-RUNBOOK.md

## Progress

**Execution order:** 01 → 02 → 03 → 04 → 05 → 06 (sequential; each phase depends on the prior)

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 01. Pre-flight + SMS Abstraction | v1.2 | 0/TBD | Not started | — |
| 02. Startup Identity, Consent & Roles | v1.2 | 0/TBD | Not started | — |
| 03. Startup Email Channel | v1.2 | 0/TBD | Not started | — |
| 04. Mastra Agent Core | v1.2 | 0/TBD | Not started | — |
| 05. Operator Audit Log (was: Approval Gate) | v1.2 | 0/TBD | Not started | — |
| 06. Two-Sided Integration Smoke Test | v1.2 | 0/TBD | Not started | — |
| 12. Dashboard Mothership Agent | v1.2 | 3/3 | Shipped (browser/AI gateway verify pending user) | 2026-05-19 |
| 13. Cross-pane Actions + Launch Polish | v1.2 | 0/3 | Planning complete | — |

## v1.3 Candidates

Named candidates carried over from v1.2 Out of Scope + milestone research. Not in active scope.

See REQUIREMENTS.md "Future Milestones → v1.3 Candidates" — TELNYX-ADAPT-01, TELNYX-MIGRATE-01, SUNSET-01, COGNEE-ACTIVATE-01, ENRICH-ACTIVATE-01, VOICE-01, SLACK-01, STARTUP-SMS-01, FEEDBACK-LOOP-01, THREAD-SUMMARY-01, CONSENT-INFER-01, MULTI-MEMBER-01.

---

*Roadmap created: 2026-05-16. v1.2 = 6 phases, 13 requirements, 100% coverage. Last updated 2026-05-19 — Phase 13 planning complete: 3 plans in 3 sequential waves (notifications+push / cross-pane actions / wizard+pilot). Phase 12 LLM transport pivot 2026-05-19: switched from Workers AI direct REST → Cloudflare AI Gateway for per-employee daily usage caps + prompt caching (see memory `project-llm-via-ai-gateway.md`). Email ingest also corrected to fire-and-forget. EmployeeMailboxDO extension (not DashboardDO), CF Agents SDK deferred to v1.3.*
