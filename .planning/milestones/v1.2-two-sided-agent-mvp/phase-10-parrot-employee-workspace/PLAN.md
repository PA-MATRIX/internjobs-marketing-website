---
phase: 10-parrot-employee-workspace
plan: 01
type: execute
wave: 1
depends_on: ["phase-08-agentic-inbox-mcp"]
files_modified: []
new_files:
  - apps/parrot/**                                   # new Cloudflare Worker (employee workspace)
  - apps/parrot-mattermost/**                        # self-hosted Mattermost on Fly (or chosen alternative)
  - apps/parrot/wrangler.jsonc
  - apps/parrot/workers/app.ts
  - apps/parrot/app/**                               # React UI: inbox + chat + video panes
  - apps/email-worker/src/index.js                   # extend to route *@internjobs.ai apex → Parrot
  - apps/app/src/config.mjs                          # add parrot.* config block
  - .planning/STATE.md
  - .planning/ROADMAP.md
autonomous: false
verification:
  surface: backend_and_frontend
  frontend_impact: true
  required_steps:
    - manual_end_to_end_smoke
    - new_clerk_instance_provisioned
    - daily_co_account_provisioned
    - mattermost_or_alternative_deployed
must_haves:
  truths:
    - "workspace.internjobs.ai resolves to the Parrot Worker, gated by a SEPARATE Clerk instance (employee identities, not student/startup)"
    - "Each employee gets a name@internjobs.ai mailbox, auto-provisioned on first login, stored in a per-mailbox Durable Object (same shape as agentic-inbox MailboxDO)"
    - "Parrot UI unifies email inbox + chat (Mattermost-class) + video conferencing (Daily.co) in a single signed-in surface"
    - "Chat: self-hosted Mattermost (or chosen alternative) reachable inside Parrot via embedded panel OR rebuilt-from-scratch chat surface; same Clerk session as the workspace"
    - "Video/audio: Daily.co embedded — 'Start meeting' button in chat + meeting invites in email + auto-attach Daily room URL to calendar events"
    - "Cross-channel actions: drag email-thread participants into a Daily room; chat-message → 'attach as email'; meeting recap → email or chat summary"
    - "Existing v1.2 stack (student app at app.internjobs.ai, agent at agent.internjobs.ai, maya@ inbox) is unaffected — Parrot is purely additive on apex internjobs.ai email"
  artifacts:
    - path: "apps/parrot/"
      provides: "Cloudflare Worker hosting workspace.internjobs.ai — React SPA + REST/WebSocket API + per-mailbox MailboxDO"
    - path: "apps/parrot-mattermost/fly.toml (or replacement decision doc)"
      provides: "Self-hosted chat infrastructure for Parrot — initial pick: Mattermost Team Edition (MIT, free, mature). Alternative considered: Zulip, Rocket.Chat, custom build."
    - path: "Cloudflare Email Routing rules"
      provides: "*@internjobs.ai apex catch-all that recognizes employee addresses and routes to Parrot; non-employee apex mail continues to operator-fallback"
    - path: "Daily.co account + REST API token"
      provides: "Programmatic room creation + meeting tokens for embedded video; per-employee rooms named e.g. /workspace/{employee_slug}"
    - path: "New Clerk instance"
      provides: "Internal-employee directory + auth, sso-isolated from the existing student/startup Clerk"
  key_links:
    - from: "Employee → workspace.internjobs.ai"
      to: "Clerk SSO → Parrot dashboard"
      via: "OIDC handshake on Parrot Worker (reuses apps/app authenticateRequest pattern)"
    - from: "External sender → name@internjobs.ai"
      to: "Employee's Parrot inbox"
      via: "CF Email Routing (apex catch-all) → email-worker recognizes employee address → POST to Parrot /api/inbox/ingest with HMAC → MailboxDO write"
    - from: "Chat message in Parrot"
      to: "Mattermost server"
      via: "WebSocket bridge (Mattermost client SDK or self-built thin chat) over shared Clerk JWT"
    - from: "'Start Meeting' button in chat or email"
      to: "Live Daily.co room embedded in Parrot UI"
      via: "POST Daily.co /rooms → return URL → render in iframe; meeting token issued per-employee"
---

<objective>
Stand up Parrot — the InternJobs.ai internal employee workspace. A single signed-in surface at workspace.internjobs.ai that unifies email, team chat, and video/audio meetings for ~50–60 interns, so all internal collaboration lives in one place instead of jumping between Gmail + Slack + Zoom.

Reuses the agentic-inbox MailboxDO pattern for email (proven in Phase 08) and adds two new layers: Mattermost-class self-hosted chat + Daily.co embedded video. New Clerk instance keeps internal-employee identities isolated from the student/startup Clerk that powers app.internjobs.ai.

Strategic angle: same way Chert is "iMessage infrastructure as a product," Parrot becomes "internal workspace as a product" — InternJobs uses it first, can be sold/spun later.
</objective>

<execution_context>
@~/.claude/rrr/workflows/execute-plan.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/REQUIREMENTS.md
@.planning/milestones/v1.2-two-sided-agent-mvp/phase-08-agentic-inbox-mcp/PLAN.md
@apps/agentic-inbox/wrangler.jsonc                  # MailboxDO pattern we'll reuse
@apps/agentic-inbox/workers/durableObject/index.ts  # DO storage shape we'll fork
@apps/email-worker/src/index.js                     # apex catch-all routing we'll extend
External:
  https://docs.daily.co/reference                   # Daily.co REST + JS SDK
  https://docs.mattermost.com/install/install-docker.html
  https://clerk.com/docs/quickstarts/setup-clerk    # second Clerk instance setup
</context>

<plan>

## Strategic decisions to surface BEFORE execution

### Decision A: Chat — Mattermost vs Zulip vs custom-built

| | Mattermost | Zulip | Custom (Hono + WS + PG) |
|---|---|---|---|
| License | MIT (Team Ed.) | Apache 2.0 | ours |
| Mature | Very (10y+) | Very | n/a |
| Self-host on Fly | Yes (Docker) | Yes (Docker) | Native (we own the deploy) |
| RAM @ 60 users | ~1GB | ~512MB | ~100MB |
| Threading | Yes | Best-in-class (topic-based) | TBD |
| Voice/video built in | Hooks (Daily plugin exists) | Plugin available | We bolt on Daily |
| Customization | Plugin SDK | Plugin SDK | Full control |
| Integration with Daily.co | Mattermost has an official Daily.co plugin ✓ | Manual | Manual |
| Effort to embed in Parrot | iframe + SSO bridge | iframe + SSO bridge | We build the UI ourselves |

**Recommend: Mattermost Team Edition.** Daily.co already has an official Mattermost plugin. Saves us building the chat surface. Self-host on Fly (~$15/mo). Embed in Parrot via iframe with shared Clerk SSO (Mattermost supports OIDC via Enterprise; for Team Edition we use header-based SSO behind a Cloudflare Access policy that asserts the Clerk identity).

Alternative IF we want full control + lighter footprint: custom-built minimal chat (Hono + WebSocket + Postgres) — ~1 week to build to feature parity for a 60-person team. Smaller blast radius, no plugin ecosystem, but ours.

### Decision B: Daily.co pricing

Daily.co usage-based pricing (~$0.99/participant-hour for B2B) at heavy usage (50 employees × 2hr/day × 22 days = ~2,200 person-hours/mo) = **~$2,180/mo**. That's expensive for an internal tool.

Options:
1. **Daily.co flat-rate plan** — starts around $100/mo for small teams; check current pricing at execution time
2. **Jitsi self-hosted** — free, runs on Fly (~$30/mo for a beefy machine). Less polished UI than Daily but functional.
3. **Daily.co usage-based + cap** — set per-meeting limits, audit dashboard. ~$300–500/mo realistic for our team size if we cap meeting hours.

**Recommend: Daily.co flat-rate first** if their pricing fits, else **Jitsi self-hosted**. Don't deploy usage-based without spending caps.

### Decision C: Name

User said "Parrot" — keeping. Sub-modules naming:
- **Parrot** = the umbrella workspace app at workspace.internjobs.ai
- **Parrot Inbox** = email module
- **Parrot Squawk** = chat module (or just "Chat" — keep it boring)
- **Parrot Roost** = video module (or just "Meetings")

Pure cosmetics; finalize when we hit the UI step.

### Decision D: One unified app vs three embedded

Per user: "the same workspace inbox can have other things integrated as well?" — yes. **Build ONE Parrot Worker** that hosts:
- React SPA with three panes: Inbox / Chat / Meetings
- Server-side: per-mailbox DO (email), Mattermost iframe proxy with SSO header injection, Daily.co room provisioning via REST

vs three separate apps with iframes — rejected because the cross-pane interactions (chat → start meeting → email recap) are the whole value.

## Wave 1 — Foundation (Claude executes, ~1 day)

### Step 1: Provision Clerk instance #2 (USER ACTION)
- Create a new Clerk application "InternJobs Workspace" in dashboard
- Configure custom domain: `accounts.workspace.internjobs.ai` + `clerk.workspace.internjobs.ai`
- Restrict signups to `@internjobs.ai` email domain
- Enable Magic Link + Google OAuth (no LinkedIn for internal)
- Store Clerk publishable + secret keys in Infisical: `PARROT_CLERK_PUBLISHABLE_KEY`, `PARROT_CLERK_SECRET_KEY`

### Step 2: Apex CF Email Routing reshape (Claude)
- Current state: `*@internjobs.ai` forwards to rentalaraj@gmail.com
- New state: route specific employee addresses (`name@internjobs.ai`) to Parrot Worker; everything else still forwards to operator
- Implementation: Cloudflare Email Routing supports specific-address rules with higher priority than the catch-all. Add per-employee rules OR (cleaner) a separate Worker that classifies addresses against a Postgres `employees` table.

### Step 3: apps/parrot scaffolding (Claude)
- New Cloudflare Worker, structurally similar to agentic-inbox
- Hono + React Router + Durable Objects (per-mailbox)
- `EMPLOYEE_MAILBOX` DO class (forked from agentic-inbox's MailboxDO with auth changes — Clerk JWT verification per employee instead of CF Access per-mailbox-shared)
- R2 bucket: `internjobs-parrot-attachments`
- Workers AI binding for optional draft-assistance later

### Step 4: Per-employee mailbox auto-provision (Claude)
- On first Clerk login, server-side: create MailboxDO instance keyed by employee's clerk_user_id + name@internjobs.ai
- Add to email-worker's known-employee list so inbound mail routes correctly

## Wave 2 — Mattermost integration (Claude executes, ~1 day)

### Step 5: Deploy Mattermost Team Edition on Fly
- New Fly app `internjobs-mattermost`
- Postgres backend (reuse Neon or a separate Mattermost-only Neon DB)
- Bound to mattermost.internjobs.ai (internal-only; not exposed publicly)
- Cloudflare Tunnel from the Fly machine if we want it reachable from Parrot Worker
- LDAP/SAML SSO via Clerk JWT bridge (Team Edition: header-based via reverse proxy)

### Step 6: Install Daily.co plugin in Mattermost
- Official plugin: https://github.com/dailyco/mattermost-plugin-daily
- Adds /daily slash command + start-meeting button in channels
- Connects to our Daily.co account via API token

### Step 7: Embed Mattermost in Parrot UI
- iframe `https://internjobs-mattermost.fly.dev` in the Chat pane of Parrot
- SSO bridge: Parrot Worker injects `X-Clerk-User-Id` header into Mattermost requests via a Hono middleware
- Mattermost trusts the header because access is gated by Cloudflare Access in front of the iframe (only authenticated Parrot users see it)

## Wave 3 — Daily.co integration (Claude executes, ~half day)

### Step 8: Daily.co account + REST API (USER ACTION + Claude)
- USER: sign up at daily.co, pick flat-rate plan (or Jitsi-fallback decision)
- USER: paste DAILY_API_KEY into chat → I save to Infisical as `PARROT_DAILY_API_KEY`
- Claude: Parrot Worker adds `/api/meetings/create` → POST Daily.co `/rooms` → return URL + meeting token
- Claude: per-employee room presets (always-on personal rooms vs scheduled rooms)

### Step 9: Daily.co JS SDK embed in Parrot
- React component `<DailyEmbed />` mounts the Daily Prebuilt UI
- "Start Meeting" CTAs in Inbox (attach to email reply) + Chat (start in channel) + Meetings tab (scheduled rooms)

## Wave 4 — Cross-channel actions (Claude executes, ~half day)

### Step 10: Email ↔ Chat ↔ Meeting interactions
- Email thread: button "Move to chat" → creates Mattermost channel with participants + first message = email subject + body
- Chat message: button "Email this thread" → opens Inbox compose with thread serialized as quote
- Meeting recap: end-of-meeting prompt → "Post summary to chat?" or "Email summary?"

### Step 11: Notifications
- Unified Parrot notification pane: new email + new chat mention + scheduled-meeting-starting-now
- Browser push via Service Worker + Web Push (Cloudflare native)

## Wave 5 — Polish + launch (Claude + user, ~half day)

### Step 12: Onboarding flow
- First-login wizard: pick `name@internjobs.ai` alias, add to chat default channels, set up profile
- Calendar import (optional Google Calendar OAuth)

### Step 13: Internal deploy
- Roll out to a 3-employee pilot first (raj + 2 trusted interns)
- Hammer for a day, fix top 3 bugs
- Broaden to all 50–60 employees

## Out of scope for Phase 10

- Mobile native apps (web is enough for v1)
- Federation with other workspaces
- AI-assisted draft generation (could be added later via Mastra workflow → Parrot REST)
- Phone/SMS in Parrot (separate phase if needed)
- Calendar app (Google Calendar via OIDC is enough)
- Document collaboration (Google Drive via OIDC is enough)

## Risks

- **Daily.co cost** at heavy usage — capping is non-optional. Pricing decision blocks Step 8.
- **Mattermost iframe + Clerk SSO** can be fiddly; have a fallback plan to build minimal native chat if Mattermost SSO doesn't cleanly slot in
- **CF Email Routing rule limits** — Cloudflare has a per-zone routing rule cap (~200 rules). For 50–60 employees we're well under, but for "InternJobs as a Service" growth, need a worker-routed approach instead of per-address rules
- **Two Clerk instances on one domain** — Clerk's docs cover this but custom-domain cross-instance SSO needs careful subdomain isolation (`clerk.internjobs.ai` vs `clerk.workspace.internjobs.ai`)
- **No native PWA = sub-optimal mobile UX** — accept for v1; mobile is v1.3

## Cost summary (recurring monthly, at 60 employees)

| Component | Cost |
|---|---|
| Cloudflare (Worker + Email Routing + R2 + Tunnel) | $5–15 |
| Fly: Mattermost + Postgres | $20–40 |
| Daily.co flat-rate (TBD pricing) | $100–500 |
| Clerk (second instance, B2B tier) | $25 + per-MAU |
| Domains / DNS | $0 (already own internjobs.ai) |
| **Total** | **~$150–600/mo** |

Compare to commercial: Slack ($7.25/user × 60 = $435) + Zoom ($15/user × 60 = $900) + Microsoft 365 = ~$1,500+/mo. Parrot is cheaper AND ours.

</plan>

<commits>
(none yet — forward-looking plan)
</commits>
