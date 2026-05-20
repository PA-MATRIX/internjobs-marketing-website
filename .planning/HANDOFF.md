# InternJobs.ai — Session Handoff (for Codex continuation)

**Date:** 2026-05-20
**Paused at:** Debugging the Chat-tab OIDC iframe bug (see §3.1 — root cause identified, fix not yet applied)
**Branch:** `main` — all work committed locally, **NOT pushed** to origin (181+ commits ahead)

---

## 1. Where things stand

**v1.3 Pilot Hardening** — code-complete + deployed to production. 4 phases:
- Phase 18 Graph Bridge Runtime — ✅ live + verified (5/5 smoke)
- Phase 19 Todo Auto-Resolution — ✅ live (cron inert until a `closeTodoFact` writer exists — v1.3.1 candidate)
- Phase 20 Pre-LLM Safety Screening — ✅ code live; Lakera key in Infisical; injection/benign/fail-open tests NOT yet run
- Phase 21 Credential Rotation — ⏭️ SKIPPED per user (sole user, not needed now). RUNBOOK exists at `.planning/milestones/v1.3-pilot-hardening/phases/21-credential-rotation/RUNBOOK.md`

**v1.3.1 patch** (in progress, mostly deployed):
- Backfilled the agentic-inbox fork — compose/reply/forward now work (were HTTP 501 stubs)
- Lifted agentic-inbox agent features into Parrot — AgentPanel, MCPPanel, EmailPanel, ai.ts, agent-tools.ts, agent routes
- `chat.internjobs.ai` CSP-rewriting proxy — embeds Mattermost in an iframe
- Mattermost white-labeled — SiteName "Parrot", custom brand text, hidden edition badge/logo/footer via proxy CSS injection
- Seamless Clerk SSO for Chat — auto-trigger OIDC (⚠️ **BROKEN — see §3.1**)

---

## 2. Production surfaces (all live)

| Surface | URL | Notes |
|---------|-----|-------|
| Student app | `app.internjobs.ai` | Fly `internjobs-ai-student-app`. `/healthz` 200. |
| Parrot Workspace | `workspace.internjobs.ai` | CF Worker `internjobs-parrot`. Latest version `656375a2`. Clerk phone-OTP auth. |
| Graph proxy | `internjobs-graph-api.fly.dev` | Fly `internjobs-graph-api` (NEW in v1.3). Fronts FalkorDB. `/health` 200. |
| FalkorDB | `internjobs-graph.internal:6379` | Fly `internjobs-graph`. Internal-only. |
| Mattermost | `internjobs-mattermost.fly.dev` | Fly `internjobs-mattermost`, machine `6e820d55b13648`. v11.6.2. |
| Mattermost proxy | `chat.internjobs.ai` | CF Worker `internjobs-mattermost-proxy`. Latest `c4b2c333` (+ `f7e4272` whitelabel). CSP rewrite + HTML CSS injection. |

**Tooling auth state:** `flyctl` ✓ (rraj@growthpods.io), `wrangler` ✓ (rentalaraj@gmail.com, acct `0fffd3dc637bdb26d4963df445a69fd3`), `infisical` ✓ (Projecta org, project `26995afd-9a6f-4690-912f-01cbcebb76d5`, env `prod`, path `/internjobs-ai`), `psql` ✓.

**Secrets added to Infisical this session:** `LAKERA_GUARD_API_KEY`, `NEON_DATABASE_URL`, `GRAPH_API_SECRET`, `GRAPH_API_URL`. The `GRAPH_API_SECRET` value is also cached at `/tmp/internjobs-graph-api-secret.txt` (this session only).

---

## 3. OPEN BUGS / NEXT STEPS

### 3.1 🔴 BLOCKER — Chat tab renders Parrot dashboard inside the iframe (not Mattermost)

**Symptom:** Open `workspace.internjobs.ai` → click Chat. The iframe shows a *nested copy of the Parrot Workspace dashboard* (double sidebar) instead of the Mattermost chat UI.

**Root cause (confirmed via browser_evaluate):**
- iframe `src` attribute = `https://chat.internjobs.ai/oauth/gitlab/login` (correct)
- iframe's *actual current URL* = `https://workspace.internjobs.ai/dashboard` (WRONG)

So the OIDC flow runs: iframe → `chat.internjobs.ai/oauth/gitlab/login` → Mattermost 302 → `workspace.internjobs.ai/oidc/authorize?...` → and then instead of `/oidc/authorize` issuing an OAuth code and 302-ing back to `chat.internjobs.ai/signup/gitlab/complete`, the iframe ends up at `workspace.internjobs.ai/dashboard`.

**Hypotheses to investigate (in `apps/parrot/workers/routes/oidc.ts`):**
1. The `/oidc/authorize` handler, when it finds a valid Clerk session, may be falling through to the SPA catch-all (`app.all("*")` in `workers/app.ts`) instead of returning the 302-with-code. Check whether `/oidc/authorize` actually returns a `Response` with the code redirect, or whether it `next()`s and React Router renders `/dashboard`.
2. The Clerk session cookie may not be *readable* by `/oidc/authorize` when the request originates inside the iframe (third-party-cookie context). If `extractClerkSessionToken` returns null, the handler redirects to `/sign-in` → which (already signed in) bounces to `/dashboard` → and that renders in the iframe.
3. Possible cookie `SameSite` issue: the iframe is `workspace.internjobs.ai` embedding `chat.internjobs.ai` → when the OIDC hop lands back on `workspace.internjobs.ai/oidc/authorize`, the request is a *sub-frame navigation*; `SameSite=Lax` Clerk cookies are NOT sent on cross-site sub-frame navigations. This is the most likely culprit.

**Recommended first move:** Reproduce in a browser with devtools → Network tab → watch the redirect chain from `chat.internjobs.ai/oauth/gitlab/login`. See exactly which hop drops the session. If it's the SameSite cookie issue, options:
- Have `/oidc/authorize` accept the Clerk session via a mechanism that survives sub-frame context (e.g., the Clerk handshake, or a short-lived token minted by the parent frame and passed via postMessage / URL param)
- OR open Chat in a way that's not a cross-site iframe sub-frame for the OIDC hop (e.g., the OIDC `/authorize` hop happens top-level via a popup, then the iframe just loads the authenticated Mattermost)

**Files in play:**
- `apps/parrot/workers/routes/oidc.ts` — the OIDC bridge (`/authorize`, `/token`, `/userinfo`)
- `apps/parrot/workers/app.ts` — middleware + `app.all("*")` SPA catch-all (lines ~156–288)
- `apps/parrot/app/routes/chat.tsx` — sets iframe src to `${MATTERMOST_URL}/oauth/gitlab/login`
- `apps/parrot/app/components/ChatPane.tsx` — renders the iframe (sandbox attrs here)

### 3.2 🟡 Phase 20 Lakera — verification tests not run

`safety_events` Neon table is live (migration 0009 applied). Lakera key deployed to Parrot Worker + student Fly app. KV `safety_skip_senders` = `sarah@acme.test`. **Still TODO:** run the 3 verification tests — injection SMS → hard-block + canned reply; benign SMS → no log; simulated Lakera 5xx → `passed_lakera_unavailable` + message proceeds. ⚠️ Also verify the `safety_events.action` CHECK constraint values (`passed`/`flagged`/`blocked`/`passed_lakera_unavailable`) match what the helper code actually writes — there was a naming drift risk (`hard_blocked` vs `blocked`).

### 3.3 🟡 Phase 19 auto-clear cron is INERT

Cron `*/5 * * * *` runs but nothing writes `:Todo.valid_to`, so it finds nothing. Needs a `closeTodoFact(thread_id, resolution_text)` helper (~50 LOC) invoked from the Mastra workflow when the agent acknowledges resolution. Tracked in `.planning/ROADMAP.md` v1.3.1 Candidates.

### 3.4 🟡 v1.3.1 agent-lift — deployed but UNTESTED

Agent features (AgentPanel, MCPPanel, summarize/draft/translate, 11 MCP tools) deployed in Parrot version `656375a2` but not exercised in-browser. Test plan in `.planning/milestones/v1.3-pilot-hardening/phases/19-todo-auto-resolution/V1_3_1-AGENT-LIFT-REPORT.md` (steps 1–14).

### 3.5 🟢 Minor — not blocking
- Attachment download endpoint (`GET /api/inbox/messages/:id/attachments/:id`) not lifted — metadata renders, download 404s (~15 LOC).
- Save-as-Draft button deferred.
- `chat.internjobs.ai` console: CF Insights beacon blocked by CSP (harmless); `/api/v4/brand/image` 404 (we set brand *text* not *image* — `MATTERMOST_ADMIN_PASSWORD` in Infisical was blank, couldn't upload a logo).
- DAILY-THEME-01 (Campus Aurora theme) reverted earlier — see ROADMAP v1.3.1 candidates for 3 safe retry paths.

### 3.6 ✅ Student QR identity invariant fixed

Latest patch: QR / START-code creation now requires a stored LinkedIn profile URL. Phone claims are immutable for that LinkedIn identity: if a student already has a confirmed phone, a different inbound phone is rejected and audited instead of replacing `students.channel_address`. If the LinkedIn URL changes for the same Clerk user, the student is reset to `linkedin_connected`, confirmed channel fields are cleared, and active pairing codes are expired so the new LinkedIn identity can pair cleanly.

Follow-up patch: first-contact prompts now always carry `first_name`, `full_name`, and the stored LinkedIn URL. The agent is required to include the first name in the first sentence when available. It only references school/current role/skills when structured `linkedin_profiles` enrichment has actually returned those fields; otherwise it uses the URL as identity context and does not invent profile details.

Enrichment follow-up: `/onboard/start` and the START-code webhook now call Bright Data using the stored LinkedIn URL (`datasets/v3/scrape`, profile dataset `gd_l1viktl72bvl7bjuj0`). No email lookup is part of the student enrichment flow. The START-code first-contact path waits for this enrichment before writing the inbound row and triggering the workflow, so the first SMS has the best available LinkedIn context.

Deployment note: `BRIGHTDATA_API_TOKEN` is set in Infisical and Fly. `/healthz` reports `configured.brightdata`.

Verified with:
- `npm run build` in `apps/app`
- `npm run test:auth` in `apps/app`

---

## 4. Key context Codex needs

- **Two Clerk apps**: students = LinkedIn-only @ `app.internjobs.ai`; employees = phone-OTP-only @ `workspace.internjobs.ai`. Separate instances, no shared pool. Clerk session JWT only guarantees `sub`.
- **Parrot acts as an OIDC provider** for Mattermost. Mattermost uses its "GitLab" OAuth slot (Team Edition has no generic OIDC slot) pointed at Parrot's `/oidc/*`. Client id `mm-adf4e352b196b075`. The registered redirect URI is the Worker secret `MATTERMOST_OIDC_REDIRECT_URI` = `https://chat.internjobs.ai/signup/gitlab/complete` (updated this session).
- **Mattermost config is env-var-driven** (`MM_*` Fly secrets). `flyctl secrets set` WITHOUT `--stage` to apply immediately; `--stage` only stages. SiteURL is now `https://chat.internjobs.ai`.
- **FalkorDB Cypher dialect**: use `timestamp()` (ms epoch), NOT `datetime()`/`duration()` — FalkorDB doesn't implement those.
- **One Neon database** (`neondb`) for everything; safety_events lives there. Per-employee mailbox data is in `EmployeeMailboxDO` SQLite (8 migrations, latest `8_resolution_source`).
- `apps/agentic-inbox/` is the DONOR repo (Maya's single-tenant MCP mailbox) — left untouched; Parrot lifts code FROM it. A proper `packages/inbox-core/` shared-package extraction is deferred to v1.4.

---

## 5. Commit log (this session, newest first, all local on `main`)

```
f7e4272 feat(v1.3.1): white-label CSS injection in Mattermost proxy
3791513 test(parrot-agent-lift): dev-only smoke endpoint for agent routes
d501897 feat(parrot-agent-lift): MCPPanel tools listing inside Agent panel
389935a feat(parrot-agent-lift): real AgentPanel — quick actions + chat
f4be90c feat(parrot-agent-lift): email viewer — EmailIframe + EmailPanel
c1da1fa feat(parrot-agent-lift): worker-side AI helpers, agent tools, agent routes
8a82cdb feat(v1.3.1): seamless Clerk SSO for Chat — auto-trigger OIDC flow
6ff46f8 docs(v1.3.1): backfill report + plan summaries
0808631 feat(v1.3.1): wire Compose/Reply/Forward UI into Parrot InboxPane
e1468ec feat(v1.3.1): add chat.internjobs.ai CSP-rewriting proxy
52ad5fc feat(v1.3.1): rewrite reply/forward route handlers
a77ec48 feat(v1.3.1): lift attachments/schemas/email-sender from agentic-inbox
3f9acb5 docs(v1.3): log DAILY-THEME-01 as v1.3.1 candidate
4b17483 revert(meetings): roll back Daily.co theme refactor
2475829 fix(meetings): remove DailyProvider wrapper - double iframe
c933fc1 feat(meetings): apply Campus Aurora theme to Daily.co Prebuilt
1d13b1d fix(18): allow public access to /healthz
cdbc8ab fix(19): use FalkorDB timestamp() instead of datetime()
3331e73 docs(v1.3): SHIP-READY.md + phase 21 RUNBOOK
d03ff15 feat(19-03): Resolved view + animate-out + Undo
218d879 feat(19-02): Resolved + Undo routes + smoke invariant
6415650 feat(19-01): migration 8 + cron auto-clear backend
1664d67 feat(18-03): graph_proxy_reachable + smoke runner
30ca491 feat(20-03): safety_events table + /ops/safety view
3449299 feat(18-02): rewire Parrot graph.ts to HTTP proxy transport
6f33854 feat(20-02): Lakera screen gate into SMS + email
fd24477 feat(20-01): Lakera Guard pre-LLM screen helpers
be38369 feat(18-01): scaffold internjobs-graph-api Fly proxy
+ docs commits (roadmap, plans) 63e8d48 8bdbf26 2d0acda 65105e5
```

---

## 6. Immediate next step for Codex

**Fix §3.1 first** — it's the only thing blocking Chat from working at all. Start by reproducing the redirect chain in browser devtools (Network tab, "Preserve log", click Chat) and identifying which hop loses the Clerk session. Strongly suspect `SameSite` cookie behavior on the cross-site sub-frame OIDC hop. Once Chat loads Mattermost, run §3.4 (agent features) and §3.2 (Lakera tests).
