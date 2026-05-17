---
phase: 08-agentic-inbox-mcp
plan: 01
type: execute
wave: 2
depends_on: ["phase-07-self-hosted-imessage-bridge", "phase-03-startup-email-channel"]
files_modified:
  - apps/agentic-inbox/wrangler.jsonc
  - apps/agentic-inbox/package.json   # workspace registration
  - apps/email-worker/src/index.js     # remove AGENT_MAILBOXES branch (sunset)
  - apps/email-worker/wrangler.toml    # remove FLY_AGENT_MAIL_URL
  - apps/app/src/workflows/student-inbound.mjs  # optional MCP tool wiring (Wave 2b)
  - .planning/STATE.md
  - .planning/ROADMAP.md
new_files:
  - apps/agentic-inbox/**             # subtree from github.com/cloudflare/agentic-inbox
deprecates:
  - apps/app/db/migrations/0006_v1_2_agent_emails.sql  # supersede by agentic-inbox MailboxDO storage
  - "POST /webhooks/agent-mail (apps/app/src/server.mjs)"
  - "GET /admin/agent-mail/inbox (apps/app/src/server.mjs)"
  - "store.recordAgentEmail + store.listAgentEmails"
autonomous: false
verification:
  surface: backend_only
  frontend_impact: true   # agentic-inbox ships a React SPA under CF Access
  required_steps:
    - manual_end_to_end_smoke
    - cloudflare_access_dashboard_setup
must_haves:
  truths:
    - "agentic-inbox Worker deployed at agentic-inbox.internjobs.ai (or chosen custom domain) and resolves over HTTPS"
    - "CF Access policy gates the UI; unauthenticated visitors get redirected to the Access SSO"
    - "maya@agent.internjobs.ai inbound mail lands in the agentic-inbox MailboxDO (visible in the UI)"
    - "The /mcp endpoint on the agentic-inbox Worker responds to MCP protocol calls authenticated via CF Access service token"
    - "Mastra workflow on Fly can invoke the email-send MCP tool against agentic-inbox and produce an outbound message"
    - "Existing conv-{uuid}@agent.internjobs.ai pipeline (Phase 03) continues to work unchanged — no regression"
  artifacts:
    - path: "apps/agentic-inbox/"
      provides: "Cloudflare Worker (Hono + Durable Objects + R2 + Workers AI) deployed from monorepo"
    - path: "apps/agentic-inbox/wrangler.jsonc"
      provides: "DOMAINS, EMAIL_ADDRESSES, send_email binding, R2 bucket, DO migrations — all customized to internjobs.ai"
    - path: "Cloudflare dashboard"
      provides: "Zero Trust Access app with POLICY_AUD + TEAM_DOMAIN set as Worker secrets"
    - path: "Cloudflare dashboard"
      provides: "Email Routing rule for maya@agent.internjobs.ai → agentic-inbox Worker (specific-address route, not catch-all)"
  key_links:
    - from: "maya@ inbound email"
      to: "MailboxDO SQLite + R2 attachments"
      via: "CF Email Routing → agentic-inbox Worker"
    - from: "Mastra workflow on Fly"
      to: "agentic-inbox send_email tool"
      via: "MCP client → https://agentic-inbox.internjobs.ai/mcp (service token in CF Access)"
    - from: "operator browser"
      to: "agentic-inbox React UI"
      via: "CF Access SSO → Hono Worker → React SPA"
---

<objective>
Replace the home-rolled `/webhooks/agent-mail` + `agent_emails` storage from
earlier this session with Cloudflare's official agentic-inbox Worker, giving
the autonomous agent (and operators) a polished email surface with:

  • Native MCP server (read inbox, search, draft, send) for the Mastra
    workflow to call as a tool
  • Per-mailbox Durable Object (SQLite + R2 attachments) for full message
    persistence with threading
  • Built-in agent panel (Cloudflare Agents SDK + Workers AI) for operator
    oversight + draft-then-confirm review
  • CF Access SSO as the single trust boundary

Goal: make maya@agent.internjobs.ai the agent's identity inbox AND
future inboxes (agent-startup@, agent-billing@, etc.) trivially addable via
EMAIL_ADDRESSES env. The Fly app keeps the conv-{uuid}@ student-conversation
pipeline; agentic-inbox owns identity inboxes only.
</objective>

<execution_context>
@~/.claude/rrr/workflows/execute-plan.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/REQUIREMENTS.md
@apps/email-worker/src/index.js     # existing CF Email Routing handler
@apps/agentic-inbox/wrangler.jsonc  # vendored, untouched
@apps/agentic-inbox/README.md       # deploy steps from Cloudflare
</context>

<plan>

## Decision: coexistence vs replacement

The home-rolled `/webhooks/agent-mail` path SHIPPED earlier this turn (commit c715aa9) but is SUPERSEDED by this phase. agentic-inbox owns identity mailbox storage going forward. We RIP OUT the home-rolled path on deploy (not parallel-write) to avoid drift and keep one source of truth.

Cost: a single migration rollback of 0006_v1_2_agent_emails + small Fly code delete. The home-rolled path was up for < 1 hour and was never used in anger — no real data to migrate.

## Wave 2a — agentic-inbox deploy (Claude executes)

### Step 1: Customize apps/agentic-inbox/wrangler.jsonc
- `DOMAINS: "internjobs.ai"` (the apex; agent.internjobs.ai routes via Email Routing rules)
- `EMAIL_ADDRESSES: ["maya@agent.internjobs.ai"]` (Apple ID inbox; expand later)
- Custom R2 bucket name: `internjobs-agentic-inbox` (namespaced to avoid CF account collisions)
- Custom Worker name: `internjobs-agentic-inbox`
- DO classes (MailboxDO, EmailAgent, EmailMCP) — keep defaults

### Step 2: Provision R2 bucket
- `wrangler r2 bucket create internjobs-agentic-inbox`
- Update wrangler.jsonc r2_buckets binding to match

### Step 3: Register as monorepo workspace
- Verify `apps/*` glob in root package.json picks it up (already does)
- Run root `npm install` to hoist deps

### Step 4: Initial deploy (BLOCKED on Cloudflare Access)
- `cd apps/agentic-inbox && npm run deploy`
- Worker URL will be `https://internjobs-agentic-inbox.<user>.workers.dev`
- Step blocks because agentic-inbox fails closed without POLICY_AUD/TEAM_DOMAIN

### Step 5: Cloudflare Access setup (USER ACTION — interactive in Zero Trust dashboard)
- dash.cloudflare.com → Workers → internjobs-agentic-inbox → Settings → Domains & Routes → "One-click Cloudflare Access"
- Enable, modal shows `POLICY_AUD` and `TEAM_DOMAIN`
- User pastes both values back in chat (treated as compromised + saved to Infisical)
- `wrangler secret put POLICY_AUD` + `wrangler secret put TEAM_DOMAIN`
- Re-deploy worker

### Step 6: Custom hostname + Email Routing
- Add CNAME `agentic-inbox.internjobs.ai` → Worker (or use the workers.dev URL)
- CF Email Routing → agent.internjobs.ai → ADD specific-address rule:
    `maya@agent.internjobs.ai → Send to Worker → internjobs-agentic-inbox`
- This takes PRECEDENCE over the catch-all that routes to internjobs-email-ingest

### Step 7: Sunset home-rolled agent-mail path
- Roll back migration 0006 (`drop table agent_emails;`) — no production data
- Remove `recordAgentEmail` + `listAgentEmails` from store.mjs
- Remove `/webhooks/agent-mail` + `/admin/agent-mail/inbox` from server.mjs
- Remove AGENT_MAILBOXES branch from email-worker
- Re-deploy Fly + email-worker

### Step 8: Inbox smoke test
- Send a test email to `maya@agent.internjobs.ai`
- Verify it appears in agentic-inbox UI under that mailbox
- Verify the auto-draft reply appears in the agent panel

## Wave 2b — MCP tool wiring (Claude executes after Wave 2a verified)

### Step 9: Connect Mastra workflow to agentic-inbox MCP
- Generate a CF Access service token for the Mastra workflow
- Add to Infisical: `AGENTIC_INBOX_MCP_URL` + `AGENTIC_INBOX_SERVICE_TOKEN`
- New tool registration in `apps/app/src/workflows/student-inbound.mjs` (or a new email-side workflow)
- Tool surface: read_mail, search_mail, draft_reply, send_email (the 9 stock tools agentic-inbox provides)

### Step 10: First end-to-end agent-email autonomous send
- Trigger condition: TBD — most likely a student matched to a role where the workflow generates a startup-side email (currently the agent only handles student SMS)
- Acceptance: outbound email appears in agentic-inbox's "Sent" folder + lands in recipient inbox

## Out of scope for Phase 08

- Replace conv-{uuid}@ student-conversation pipeline with agentic-inbox (Phase 03 stays as-is)
- Migrate inbound_messages.email rows to agentic-inbox (no historical migration; new mail forward only)
- Custom Workers AI model selection — agentic-inbox ships `@cf/moonshotai/kimi-k2.5`, we accept default for v1.2

## Risks

- **CF Access setup is interactive** — can't be automated; depends on USER ACTION
- **One R2 bucket per Cloudflare account name collision** — using `internjobs-agentic-inbox` to avoid clash with example/template bucket
- **Email Routing precedence** — specific-address rules take precedence over catch-all; verify order in dashboard
- **agentic-inbox active development** — pinned compatibility_date `2025-11-28` in upstream; we keep their pin

</plan>

<commits>
(none yet — Wave 2a not started; this is a forward-looking plan)
</commits>
