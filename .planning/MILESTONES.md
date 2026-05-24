# Project Milestones: InternJobs.ai

## v1.3 Pilot Hardening (Shipped: 2026-05-19, partial)

**Delivered:** 3 of 4 planned phases shipped; 1 explicitly skipped; 1 large un-roadmapped initiative also landed.

**Phases shipped:**
- **Phase 18 — Graph Bridge Runtime**: `internjobs-graph-api` Fly proxy + Workspace Worker `graph.ts` rewire from direct FalkorDB to HTTP transport. Workspace `/healthz` reports `graph_proxy_reachable: true`.
- **Phase 19 — Todo Auto-Resolution**: DO migration 8 + `auto-clear.ts` cron + Resolved view + Undo + animate-out. **Caveat:** cron runs but finds nothing — `closeTodoFact` writer not built; carried to v1.4 A1.
- **Phase 20 — Pre-LLM Safety Screening**: Lakera screen helpers (Node + Worker) + insertion in student SMS + Workspace email + Neon migration 0009 `safety_events` + `/ops/safety` view. **Caveat:** 3 verification tests not yet run; carried to v1.4 A2.
- **Phase 21 — Credential Rotation: SKIPPED** at user direction (sole user, not needed yet). RUNBOOK preserved.

**Un-roadmapped (shipped 2026-05-21): Neon-exit**
- Mattermost DB → self-hosted Fly Postgres `internjobs-mattermost-db`
- Student app DB → self-hosted Fly Postgres `internjobs-student-db` (pgvector + HNSW preserved)
- All 3 Neon projects deleted (`noisy-rain-23196137`, `flat-scene-36951468`, `soft-dust-92209989`)
- Workspace Worker decoupled from Postgres via student-app `/internal/safety-events` Bearer API

**v1.3.1 partial-ships:** Workspace agent-lift (AgentPanel, MCPPanel, EmailPanel, agent-tools), chat/email native Workspace surfaces, Mattermost white-label proxy, LinkedIn URL invariant + Bright Data enrichment

**Stats:**
- 12 commits for v1.3 phases 18–20 + 5 commits for Neon-exit + ~10 commits for v1.3.1 partials
- Calendar: 2026-05-19 → 2026-05-24

**Archive:** `.planning/milestones/v1.3-pilot-hardening/`

---

## v1.2 Two-Sided Agent MVP (Shipped: 2026-05-19)

**Delivered:** Two-sided messaging product (students ↔ startups via Mastra agent) PLUS Parrot internal employee workspace at workspace.internjobs.ai with email/chat/meetings/dashboard panes, kimi-k2.6-powered cross-channel todo extraction via Cloudflare AI Gateway, Daily.co video integration, per-employee push notifications, and admin invite UX with capability toggles.

**Phases completed:** 01–17 (16 fully shipped + 1 code-shipped-runtime-blocked = Phase 14 FalkorDB graph)

**Key accomplishments:**

- **Parrot Workspace** live at workspace.internjobs.ai with Slack-style UI, phone-OTP auth via dedicated Clerk app, three-tab Meetings pane, notification drawer + service worker push, first-login OnboardingWizard.
- **Dashboard Mothership Agent** extracts cross-channel todos from inbound email + Mattermost chat using kimi-k2.6 via Cloudflare AI Gateway with per-employee daily caps + prompt caching (live-verified: $0.002237 per email, 520 tokens output).
- **Self-hosted iMessage Bridge** (Phase 07/07b) on HostMyApple Mac mini + BlueBubbles + Cloudflare Tunnel — drops Photon cost $250→$73/mo with native iMessage UX.
- **agentic-inbox MCP Worker** at agent.internjobs.ai serves Maya's identity mailbox with MCP server + R2 attachments + CF Access SSO.
- **LinkedIn Enrichment + QR Onboarding** with Bright Data + Standout-style flow.
- **Daily.co Integration** with per-employee always-on personal rooms + ephemeral StartMeeting CTA.
- **Mattermost OIDC SSO** bridge via Parrot's `/oidc/*` endpoints.
- **Admin invite UX** (Phase 16) for Ridhi with capability toggles + phone-OTP + warm welcome email.

**Stats:**

- 178 commits since v1.1
- +75,022 / −3,682 lines (net +71,340)
- 17 phases, 27+ plans
- Fix-to-feature ratio: 15.7% (healthy)
- Calendar: 2026-05-15 → 2026-05-19 (4 days)
- 13 production Worker deploys for `internjobs-parrot` this milestone

**Infrastructure provisioned:**
- Cloudflare AI Gateway `internjobs-parrot` (500 req/h sliding window + per-user metadata)
- CF KV namespace `PARROT_FEATURE_FLAGS`
- Workers: `internjobs-parrot`, `internjobs-agentic-inbox`, `internjobs-email-ingest`
- Fly apps: `internjobs-graph` (FalkorDB), `internjobs-mattermost`, `internjobs-ai-student-app`
- Daily.co account at `internjobs.daily.co`
- VAPID P-256 keypair (Web Push)
- Mattermost team `internjobs` + bot `parrot` + admin `raj@internjobs.ai`
- Ridhi provisioned in WorkspaceDO

**Git range:** `7de995f` (v1.1 archive) → tagged `v1.2`

**What's next:** See `.planning/ROADMAP.md` v1.3 Candidates list.

---

## v1.1 Seamless Waitlist and Student Threading (Shipped: 2026-05-15)

**Delivered:** Students sign in with LinkedIn, land directly on QR/SMS pairing, verify with an 8-character code via the shared Spectrum number, and have all follow-up texts routed back to their thread — with durable handoff placeholders for Cognee graph memory and Sprite/Bright Data enrichment.

**Phases completed:** 01 (1 plan)
**Archive:** `.planning/milestones/v1.1-seamless-waitlist/`

---

## v1.0 Waitlist Identity and Messaging Foundation (Shipped: 2026-05-09)

**Delivered:** Public marketing site + LinkedIn-first Clerk auth + Neon schema for waitlist + Photon/Spectrum SMS pairing + welcome message + LinkedIn ingestion + ops health.

**Phases completed:** 01–06 (15 plans)
**Archive:** `.planning/milestones/v1.0-waitlist-app/`

---
