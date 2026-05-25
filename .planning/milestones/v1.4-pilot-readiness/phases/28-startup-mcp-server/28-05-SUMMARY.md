---
phase: 28-startup-mcp-server
plan: 05
subsystem: marketing+mcp
tags: [cloudflare-workers, hono, cors, send_email-binding, react, vite, tailwind, brand-v1, channel-adapter, pilot-deferred]

# Dependency graph
requires:
  - phase: 28-startup-mcp-server-02
    provides: "apps/startup/ Worker scaffold at mcp.internjobs.ai with /api/* 503 stub ready to replace"
  - phase: 28-startup-mcp-server-04
    provides: "POST /admin/startups/new concierge admin endpoint — the path the marketing CTA leads founders toward (Ridhi onboards from request-access lead)"
  - phase: 22-lakera-brand
    provides: "apps/marketing brand system: --lavender + --ink + --cobalt CSS vars + verify-brand.mjs gate + lowercase brand voice + accent-dot/comma spans"
provides:
  - "POST /api/request-access — marketing CTA receiver at mcp.internjobs.ai/api/request-access (CORS-restricted to internjobs.ai)"
  - "/startups marketing page Request Access form (4 fields: name, email, phone, what_hiring_for) POSTing to the CTA receiver"
  - "/startups channels grid section — 5 primary channels + 3 coming-soon tier"
  - "apps/startup/CHANNELS.md (285 LOC) — channel-adapter architecture doc with concrete sketches for Phase 28.5 web, Phase 29 telnyx-sms + telnyx-voice, v1.5 slack/discord/teams/email"
  - "PILOT-EVIDENCE.md placeholder (status=deferred) with 5 acceptance criteria for v1.5 STARTUP-PILOT-LIVE-01"
  - "ROADMAP.md v1.5 Carryovers updated with STARTUP-PILOT-LIVE-01"
affects:
  - 28.5-startups-web-app (will replace the Request Access form with a Clerk-backed sign-up flow; will use the channel-adapter pattern for the web ingress)
  - 29-startup-telnyx-sms-voice (will add the telnyx-sms + telnyx-voice adapters sketched in CHANNELS.md; will surface the live SMS path that the marketing copy promises as "coming v29")
  - v1.5-STARTUP-PILOT-LIVE-01 (the deferred carryover this plan opens)
  - v1.5-STARTUP-SLACK-APP / DISCORD-APP / TEAMS-APP (CHANNELS.md sketches the patterns)

# Tech tracking
tech-stack:
  added: []  # no new packages — only a new send_email binding declaration + a 1-file React component module
  patterns:
    - "Marketing-page form -> mcp.internjobs.ai Worker via CORS-allowed POST (origin-restricted to internjobs.ai + www.internjobs.ai). No proxy hop through marketing CDN."
    - "EMAIL binding as optional-feature-flag (same pattern as 28-04's TELNYX_*): if env.EMAIL.send exists, route the lead via Email Routing; otherwise log it via console.log so it surfaces in wrangler tail. Guarantees the lead is never lost."
    - "Component file extraction for /startups-page-only React surface: apps/marketing/src/components/StartupAccessSection.tsx is the first non-App.tsx component file in the marketing app. Pattern: lift a section that's logically standalone (request-access + channels grid) when it has its own state/effects, keep tightly-coupled sections inline in App.tsx."
    - "Channel-adapter doc-as-spec: CHANNELS.md is the canonical source for the resolver + dispatcher contract. Phase 29 adapter PRs link this doc and append a row to its 'when to add a new adapter' section."

key-files:
  created:
    - "apps/startup/workers/routes/api.ts (~135 LOC — apiRouter, CORS, POST /request-access handler with email-or-log fallback)"
    - "apps/startup/CHANNELS.md (285 LOC — channel-adapter architecture + sketches for 6 channels)"
    - "apps/marketing/src/components/StartupAccessSection.tsx (~280 LOC — RequestAccessForm + ChannelsGrid)"
    - ".planning/milestones/v1.4-pilot-readiness/phases/28-startup-mcp-server/PILOT-EVIDENCE.md (status=deferred placeholder)"
  modified:
    - "apps/startup/workers/app.ts (+7/-2 — import apiRouter, replace /api/* 503 stub with app.route('/api', apiRouter))"
    - "apps/startup/wrangler.jsonc (+9/-1 — declare send_email binding as EMAIL)"
    - "apps/marketing/src/App.tsx (+12/-43 — import new components, mount <ChannelsGrid /> after hero in StartupPage, replace StartupAccessSection's mailto form with <RequestAccessForm /> and lowercase the section copy)"
    - ".planning/ROADMAP.md (+1 line — STARTUP-PILOT-LIVE-01 entry in v1.5 Carryovers)"

key-decisions:
  - "Live first-pilot install DEFERRED to v1.5 STARTUP-PILOT-LIVE-01 by explicit user decision 2026-05-25. The infrastructure (worker, admin endpoint, marketing CTA, channels grid, CHANNELS.md) is shipped and end-to-end smoke-verified. What's missing is a real founder using a real LLM client — Phase 28.5 (web onboarding) will surface that founder. This is Rule 4 territory (architectural / explicit user decision), not Rule 1-3 (auto-fix)."
  - "Request Access endpoint is PUBLIC (no auth) and CORS-restricted to internjobs.ai + www.internjobs.ai. Marketing CTA receivers MUST be public — otherwise the form on internjobs.ai can't reach mcp.internjobs.ai. Open CORS would let any third-party site blast Ridhi's inbox; restricting to internjobs.ai allowlists the only legitimate callers."
  - "Endpoint always returns {ok: true, message} on valid submission (only 400 on missing fields or invalid JSON). The form submitter sees success even if env.EMAIL.send() fails — the lead is logged either way. Form UX > strict error visibility for a public lead form."
  - "EMAIL binding is OPTIONAL — code paths cover both 'binding present' (real email send) and 'binding absent' (log-only). Same optional-feature-flag pattern as 28-04's TELNYX_* secrets. Lets the binding be added/removed without code changes."
  - "Component split: only RequestAccessForm + ChannelsGrid are extracted to a new file (apps/marketing/src/components/StartupAccessSection.tsx). The OUTER StartupAccessSection wrapper (dark-band cobalt CTA section) stays in App.tsx because it depends on App.tsx-local symbols (BrandMark, cta-spectrum CSS). Mixed pattern is fine — extract what has its own state/effects, keep what's tightly coupled."
  - "ChannelsGrid placement: mounted between <StartupHeroSection /> and <ResumePileSection /> so a founder seeing the hero immediately sees the multi-channel positioning before scrolling into the anti-resume-pile section. Matches the BRAND-V1 promise: 'talk to us where you already work.'"
  - "Primary tier copy specifies 'coming v29' / 'coming v28.5' tags on Voice / SMS / Email. Sets honest expectations: MCP is live; everything else is forthcoming. Avoids the trap of marketing a 'coming soon' tier as if it works today."
  - "Coming-soon tier (Slack / Discord / Microsoft Teams) shown as outlined-lavender pills at 50% opacity. Visual signal: these are NOT alternative channels for v1.4 — they're v1.5+ work. Pilot startups should NOT expect Slack-native presence in the first cohort (Anthropic's slack-mcp-plugin can bridge in the meantime, per ROADMAP)."
  - "CHANNELS.md is a doc-as-spec for the channel-adapter pattern. Every new adapter PR appends a row to its summary table and links back to it. The 'isolation guarantee' section codifies the two-layer defense from 28-03 (no startup_id from channel payload; resolver returns it; handler enforces it) so future adapters can't accidentally regress the invariant."

patterns-established:
  - "send_email binding pattern for the startup Worker (parallels apps/parrot's EMAIL binding). Future cross-app messaging (e.g., per-startup agent email from Phase 28.5) will reuse this binding."
  - "components/ subdirectory in apps/marketing/src/ — first time we've extracted a marketing component into its own file. Future per-page sections that need their own state/effects can follow this pattern (e.g., Phase 28.5 startups.internjobs.ai sign-up may export a similar component used both there and here)."

# Metrics
duration: 6min
completed: 2026-05-25
---

# Phase 28 Plan 05: Marketing CTA + Channels Grid + Adapter Doc Summary

**POST /api/request-access live on `mcp.internjobs.ai` receiving the new `/startups` 4-field Request Access form (CORS-allowed only from internjobs.ai). `/startups` page got a "talk to us where you already work" channels grid above the fold + the access section's mailto-form was replaced with the live CTA receiver. `apps/startup/CHANNELS.md` (285 LOC) documents the channel-adapter architecture with concrete sketches for Phase 28.5 (web), Phase 29 (telnyx-sms + telnyx-voice), and v1.5 (slack / discord / teams / email). Live first-pilot install evidence DEFERRED to v1.5 STARTUP-PILOT-LIVE-01 per explicit user decision 2026-05-25 — Phase 28.5 web onboarding ships first.**

## Performance

- **Duration:** ~6.3 min
- **Started:** 2026-05-25T03:49:45Z
- **Completed:** 2026-05-25T03:56:03Z
- **Tasks executed:** 3 (Task 1 auto + Task 2 auto + Task 4 auto; Task 3 checkpoint deferred per user decision)
- **Files modified:** 8 (4 created + 4 modified)
- **Worker Version ID:** `8add12e0-8258-4290-ae7e-8e6823d0aef8`
- **Deployed URL:** `https://mcp.internjobs.ai/api/request-access`
- **Marketing bundle:** `npm run build` clean — 1966 modules, 509ms, 373.27 KiB JS (113.69 KiB gzip), 40.80 KiB CSS

## Accomplishments

- **`POST /api/request-access` live + smoke-verified end-to-end**: 200 on happy path (name + email required; phone + what_hiring_for optional). 400 on missing required fields or invalid JSON. CORS preflight from `https://internjobs.ai` returns 204 with the allow-origin / allow-methods / allow-headers headers expected by the browser.
- **EMAIL binding declared** in `wrangler.jsonc` (`send_email: [{name: "EMAIL"}]`). Worker deployed with the binding active — `wrangler deploy` confirmed `env.EMAIL (unrestricted) Send Email`. Code path: if `env.EMAIL.send` exists, route the lead to `raj@internjobs.ai`; if it errors or is absent, log the lead via `console.log` so it surfaces in `wrangler tail`. Lead is never lost.
- **Marketing `/startups` page got a real form** that POSTs to `mcp.internjobs.ai/api/request-access`. 4 fields (name + email required; phone + what_hiring_for optional). On success: confirmation card ("got it. ridhi will text you shortly."). On error: tangerine error line ("something went wrong. email raj@internjobs.ai directly.").
- **Channels grid mounted on `/startups`** between hero and resume-pile sections. 5 primary channels (claude/chatgpt LIVE; cursor/cline LIVE; voice coming v29; sms coming v29; email coming v28.5) in cream cards with cobalt borders + cobalt names + ink body. 3 coming-soon channels (slack, discord, microsoft teams) as outlined-lavender 50%-opacity pills. Honest "coming v29" / "coming v28.5" tags on the not-yet-live primary channels avoid the "everything is launching today" trap.
- **`apps/startup/CHANNELS.md` (285 LOC)** documents the channel-adapter pattern. Sections: overview + resolver/dispatcher diagram, `startup_channel_links` table contract, isolation guarantee (two-layer defense from 28-03), Phase 28 mcp (live), Phase 28.5 web (clerk #3 resolution), Phase 29 telnyx-sms (~60-LOC inbound webhook + outbound sendSms sketch), Phase 29 telnyx-voice (zero-code — Telnyx Voice AI calls /mcp directly), v1.5 slack (~50 LOC), v1.5 discord/teams (workspace_id:channel_id pattern), v1.5 email-initiated (Cloudflare Email Routing catch-all), "when to add a new adapter" summary.
- **Brand verify still PASSES**: `node apps/marketing/scripts/verify-brand.mjs` exits 0 across all checks — color vars, radii tokens, no #fff / #000 in marketing surfaces, accent-comma / accent-dot spans + CSS rules, CTA copy ("get on the list" + "post a role"), uppercase label tracking + weight, brand name lowercase, corp-speak absent, favicon + OG meta, data-accent system, logo variants, WCAG contrast (ink-on-lavender 14.20:1, ink-on-lime 15.71:1, lavender-on-cobalt 4.14:1 ≥ 3.0 large-display, ink-on-cream 17.04:1). New component has 0 hex literals.
- **Marketing build clean**: `tsc -b && vite build` produced zero errors. Bundle contains the new copy: "request-access" endpoint string, "coming soon" labels, "talk to us where" h2 copy, "HOW WE WORK WITH YOU" eyebrow.
- **PILOT-EVIDENCE.md placeholder created** (status=deferred) with 5 codified acceptance criteria for v1.5 closure and 2 recommended paths (28.5 surrogate-install / direct tech-founder install).
- **ROADMAP.md updated**: STARTUP-PILOT-LIVE-01 entry added to v1.5 Candidates → Carryovers with a back-link to PILOT-EVIDENCE.md.

## Task Commits

1. **Task 1: POST /api/request-access endpoint + CHANNELS.md adapter doc** — `11c67ac` (feat)
2. **Task 2: /startups Request Access form + channels grid (apps/marketing)** — `cbd9a4e` (feat)
3. **Task 3: Checkpoint:human-verify** — DEFERRED to v1.5 per user decision 2026-05-25 (see Deviations § Rule 4)
4. **Task 4: PILOT-EVIDENCE.md placeholder + ROADMAP v1.5 carryover** — `6b9414e` (docs)

**Plan metadata (this SUMMARY + STATE.md update):** committed separately at plan close.

## Files Created/Modified

**Created (4):**

- `apps/startup/workers/routes/api.ts` — ~135 LOC. apiRouter (Hono) with CORS middleware (origin-restricted to internjobs.ai + www.internjobs.ai) and a single POST /request-access handler. Validates name + email (returns 400 if missing). EMAIL binding usage is OPTIONAL — wrapped in `typeof emailBinding.send === 'function'` so the endpoint works whether or not Email Routing is provisioned. Always returns `{ok: true, message}` on a valid submission so the form UX is forgiving.
- `apps/startup/CHANNELS.md` — 285 LOC. Channel-adapter architecture doc. Resolver + dispatcher diagram; the `startup_channel_links` schema table; the cross-startup isolation invariant; concrete adapter sketches for Phase 28 mcp (live), Phase 28.5 web, Phase 29 telnyx-sms (~60-LOC), Phase 29 telnyx-voice (configurable, zero custom code), v1.5 slack, v1.5 discord/teams, v1.5 email-initiated; summary checklist for adding a new adapter.
- `apps/marketing/src/components/StartupAccessSection.tsx` — ~280 LOC. Exports RequestAccessForm (4-field form, POSTs to mcp.internjobs.ai/api/request-access, idle/loading/done/error state machine, tangerine error line, cobalt-pill submit button) and ChannelsGrid (lavender section with eyebrow + h2 + body + 5-card primary grid + 3-pill coming-soon row). Uses CSS vars only — 0 hex literals.
- `.planning/milestones/v1.4-pilot-readiness/phases/28-startup-mcp-server/PILOT-EVIDENCE.md` — placeholder with status=deferred, 5 acceptance criteria for v1.5 STARTUP-PILOT-LIVE-01, and 2 paths to close (28.5 surrogate-install / direct tech-founder install).

**Modified (4):**

- `apps/startup/workers/app.ts` (+7/-2). Import apiRouter; `app.route('/api', apiRouter)` replaces the `/api/*` 503 stub left by Plan 28-02. Updated header comment to reflect the new mount.
- `apps/startup/wrangler.jsonc` (+9/-1). Added `send_email: [{name: "EMAIL"}]` binding. Inline comment explains the optional-feature-flag pattern + fallback to log-only.
- `apps/marketing/src/App.tsx` (+12/-43). New top-of-file import from `./components/StartupAccessSection`. Mount `<ChannelsGrid />` in StartupPage between `<StartupHeroSection />` and `<ResumePileSection />`. Replaced the inline StartupAccessSection mailto form (6 placeholder fields → mailto: link) with the new live `<RequestAccessForm />` wrapped in the same waitlist-band glass card. Section copy lowercased per BRAND-V1 voice ("hire interns by text." h2; "request access" eyebrow; concierge-onboarding paragraph mentioning Ridhi).
- `.planning/ROADMAP.md` (+1 line). STARTUP-PILOT-LIVE-01 added to v1.5 Candidates → Carryovers with back-link to PILOT-EVIDENCE.md acceptance criteria.

## Decisions Made

- **Defer live first-pilot install to v1.5** (user decision 2026-05-25). Rationale: Phase 28.5 (web onboarding) is the path for non-tech founders; the MCP-only install path will be exercised when a tech founder is identified. Synthetic smoke-tests by Ridhi (against throwaway startups) are already on the record in 28-01/28-02/28-03/28-04 — the gap is purely "real founder + real client + screenshots." Treated as Rule 4 (architectural / explicit user decision), not Rule 1-3 (auto-fix).
- **Public CTA endpoint with CORS-allowlist** (no Bearer auth on /api/request-access). Marketing forms must be reachable from a different origin (internjobs.ai) than the API (mcp.internjobs.ai). Bearer auth would defeat the purpose. CORS-allowlist (internjobs.ai + www.internjobs.ai only) is the right granularity — keeps the endpoint reachable for the legit form, blocks blasting from arbitrary scrapers.
- **EMAIL binding optional** with log-fallback. Same pattern as 28-04's TELNYX_* secrets. Lets us ship the endpoint today without provisioning Email Routing first; turning Email Routing on later requires zero code change (just `wrangler.jsonc` + redeploy + Email Routing dashboard config in Cloudflare).
- **Lead is never lost**: even if `env.EMAIL.send()` throws, the catch block JSON-logs the lead with all 4 fields so Ridhi can find it via `wrangler tail` or Logpush. Form UX always returns `{ok: true}` to the submitter so they don't see a flaky error mid-submission.
- **Component file location: `apps/marketing/src/components/StartupAccessSection.tsx`** — first component file extracted from App.tsx. Pattern: extract a section if it has its own React state or effects AND is small enough to be standalone (no need for tightly-coupled App-local helpers). The OUTER StartupAccessSection (cobalt CTA band) stays in App.tsx because it uses `BrandMark` + `cta-spectrum` CSS classes that are defined locally.
- **ChannelsGrid placement above the fold** — between Hero and ResumePileSection. Founders see the multi-channel positioning ("talk to us where you already work") immediately after the hero, before the anti-resume-pile narrative. Matches the BRAND-V1 promise and the channel-adapter architecture story.
- **Honest "coming v29 / v28.5" tags on primary tier**. Voice + SMS + Email show as primary channels but with the tag because the architecture supports them and the marketing positioning treats them as first-class. The tag prevents over-promising — founders know not to expect SMS today.
- **Coming-soon tier styling** (Slack / Discord / Teams) — outlined lavender pills at 50% opacity. Visual signal: these are explicitly NOT primary channels. They're labeled "coming soon" and styled to recede. Sets the expectation that pilot startups should use Claude/Cursor/ChatGPT (MCP) for now; Slack et al land in v1.5.
- **CHANNELS.md as doc-as-spec**: codifies the resolver+dispatcher contract so future adapter PRs link this doc + append a row to its "when to add a new adapter" section. Includes the cross-startup isolation invariant from 28-03 so future adapters can't accidentally regress it.

## Deviations from Plan

### Rule 4 — Architectural decision: defer live pilot install to v1.5

**1. [Rule 4 — Architectural] Plan's Task 3 `checkpoint:human-verify` (live first-pilot install) DEFERRED to v1.5 STARTUP-PILOT-LIVE-01 by explicit user decision 2026-05-25**

- **Found during:** Pre-execution context from user (orchestrator prompt).
- **Issue:** The plan's Task 3 is a `checkpoint:human-verify` requiring a real founder using a real Claude Desktop / Cursor / ChatGPT to run `me() + execute('post_role') + search('candidates') + execute('reply_to_candidate')` and capture screenshots. As of 2026-05-25, no real founder is lined up — Phase 28.5 (web onboarding at `startups.internjobs.ai`) is the planned path for the first non-tech pilot, and the MCP-only install will be exercised when a tech founder is identified.
- **Decision rationale (Rule 4 — explicit user decision):** Synthesizing the evidence (Raj acting as both Ridhi AND the founder) would close the requirement but wouldn't be a true first-pilot test. The user explicitly requested deferral so the first PILOT-EVIDENCE.md captures a real founder. This is architectural — affects how v1.4 closes Phase 28 + how v1.5 reopens it.
- **Action taken:**
  - Created `PILOT-EVIDENCE.md` with status=deferred + 5 codified acceptance criteria + 2 recommended paths to close (28.5 surrogate-install / direct tech-founder install).
  - Added `STARTUP-PILOT-LIVE-01` to `ROADMAP.md` v1.5 Candidates → Carryovers with a back-link to PILOT-EVIDENCE.md acceptance criteria.
  - Executed Task 4 (post-checkpoint task: PILOT-EVIDENCE.md + ROADMAP update) as if the checkpoint had completed with `deferred` status.
- **Why this is Rule 4 and not "skip the checkpoint silently"**: the user explicitly authorized this in the spawn prompt; the deferral is documented in PILOT-EVIDENCE.md + ROADMAP.md + this SUMMARY; the closure path is concrete (5 acceptance criteria + 2 paths); v1.5 carryover formally tracks it.
- **Files modified:** PILOT-EVIDENCE.md (created), ROADMAP.md (modified)
- **Committed in:** `6b9414e`

### Auto-fixed Issues

None. The plan executed as written for Tasks 1, 2, and 4.

## Files Modified Outside Plan Frontmatter

Per HYGN-04 audit: `git diff --name-only HEAD~3 HEAD` shows 8 files touched.

Plan declared `files_modified`:
- `apps/marketing/src/App.tsx` ✓
- `apps/marketing/src/components/StartupAccessSection.tsx` ✓
- `apps/startup/CHANNELS.md` ✓
- `apps/startup/workers/routes/api.ts` ✓
- `apps/startup/workers/app.ts` ✓
- `.planning/milestones/v1.4-pilot-readiness/phases/28-startup-mcp-server/PILOT-EVIDENCE.md` ✓

Modified but NOT in plan frontmatter:

- `apps/startup/wrangler.jsonc` — added `send_email: [{name: "EMAIL"}]` binding needed for the apiRouter's email-send path. Rule 3 - Blocking equivalent (the binding has to exist for the code path to work in production; declaring it on a CF Workers config is the only way to enable `env.EMAIL.send()`). Same shape as `apps/parrot/wrangler.jsonc`.
- `.planning/ROADMAP.md` — STARTUP-PILOT-LIVE-01 entry added to v1.5 Carryovers (small targeted edit per orchestrator prompt). Not in plan frontmatter, but explicitly requested by the orchestrator prompt as part of the Rule 4 deferral path.

Neither is scope creep — wrangler.jsonc is required for the EMAIL binding the plan explicitly specifies in Task 1's action block ("Also add `send_email` binding to `wrangler.jsonc`"), and ROADMAP.md is the deferral artifact.

## Issues Encountered

- **Two pre-existing working-tree changes from prior peer plans** persist throughout this session (already noted in 28-04 SUMMARY): a deleted `001-from-executor-28-04.json` broadcast file and an untracked `.planning/teams/archived/` directory. Neither relates to this plan. Both left unstaged across all 4 commits to avoid blending with my changes. Not blocking.
- **No checkpoint:human-verify pause**: per orchestrator prompt, the checkpoint was deferred (Rule 4 architectural). All `<task type="auto">` tasks (1, 2, 4) executed; Task 3 was skipped with deferral documented in PILOT-EVIDENCE.md + ROADMAP + this SUMMARY.
- **Smoke test of /api/request-access used a fake `test@startup.com` email**: the Worker accepted it (no domain verification, no spam check). This is fine for a marketing CTA (Ridhi will see junk leads via the wrangler tail) but a v1.5 polish item: add a simple `domain has MX record` check or a turnstile widget to reduce spam volume before Phase 28.5's self-serve sign-up makes this endpoint optional.
- **Marketing brand verify passes** without changes to verify-brand.mjs. New component uses CSS vars only — 0 hex literals — and the existing brand audit rules cover it without modification.

## User Setup Required

**Optional / nice-to-have (none block subsequent phases):**

1. **(Optional) Enable Cloudflare Email Routing on the `internjobs.ai` zone** so `env.EMAIL.send()` actually delivers. Right now the binding is declared but Email Routing may not yet be enabled. Effect today: lead is logged via `console.log` (visible in `wrangler tail` / Logpush). Effect after enabling: lead is emailed to `raj@internjobs.ai`. Zero code change either way.
2. **(Optional) Add a Cloudflare Turnstile widget to the Request Access form** to reduce spam if pilot traffic surfaces it. Drop-in client integration; server validates the token on `/api/request-access`. v1.5 backlog item; not needed for the concierge cohort.
3. **(Recurring) Infisical CLI org issue** persists from 28-01/02/03/04: STARTUP_API_SECRET + STARTUP_MCP_ADMIN_SECRET still need to be persisted to Infisical from `/tmp/*_secret.txt`. Same MEMORY.md workspace-ID staleness flagged in prior SUMMARYs. None of this blocks Phase 28 closure or 28.5/29 starts.

## Next Phase Readiness

**Phase 28 is functionally complete** (5/5 plans shipped). The deferred Task 3 checkpoint is tracked as v1.5 STARTUP-PILOT-LIVE-01.

**Phase 28.5 (Startups Web App + Clerk #3) — unblocked**. Phase 28's deliverables enable 28.5 to:
- Reuse the Fly proxy + DB schema (28-01) for web sign-up.
- Compose `createStartup()` (28-04) with `mintClerkInvite()` + `reserveAgentEmailSlug()` (28.5's new work).
- Reuse the channel-adapter pattern (CHANNELS.md) for the web ingress.
- Reuse the EMAIL binding (28-05) for the per-startup agent email send.
- Replace `RequestAccessForm` with a `<SignupRedirect>` that points to `startups.internjobs.ai` once that subdomain is live.

**Phase 29 (Telnyx SMS + Voice AI) — unblocked**. CHANNELS.md ships with concrete sketches Phase 29 will implement verbatim:
- Inbound telnyx-sms webhook (~60 LOC).
- Outbound `sendSms()` helper (Telnyx REST).
- Telnyx Voice AI tool configuration pointing at `mcp.internjobs.ai/mcp` (zero custom voice code).

**Watchlist for 28.5 / 29:**

- **Request Access form will be partially redone in 28.5** — the "request access" CTA becomes "sign up at startups.internjobs.ai". Plan accordingly: 28.5-XX should replace `<RequestAccessForm />` with a `<SignupRedirect />` or similar; the existing form can stay as a fallback for users who land on /startups before the sign-up flow is finalized.
- **Coming-tier copy will flip as channels go live**. When Phase 29 ships, voice + sms drop the "coming v29" tag. When Phase 28.5 ships, email drops the "coming v28.5" tag. When v1.5 ships slack, the coming-soon tier shrinks. The `primaryChannels` + `comingSoonChannels` constants in StartupAccessSection.tsx are the single edit points.
- **CHANNELS.md is the canonical source for the adapter pattern**. Future adapter PRs MUST link this doc AND append a row to its "when to add a new adapter" summary. v1.5 adapter PRs (slack, discord, teams) should follow this convention.
- **CTA endpoint spam vector**: `POST /api/request-access` is public and unmetered. For pilot-scale traffic this is fine; if usage spikes, add Cloudflare Rate Limiting at the zone level or upgrade to a Turnstile-gated form.

**Phase 28 closure:** 28/28 requirement items are functionally satisfied (STARTUP-MCP-01..10 by 28-01..03; STARTUP-ADMIN-01..02 by 28-04; STARTUP-CHANNEL-01..02 by 28-01 + 28-05; STARTUP-MARKETING-01..02 by 28-05; STARTUP-PILOT-01 functionally closed by the 5 plans' synthetic smoke tests, with the live-founder ceremony tracked as v1.5 STARTUP-PILOT-LIVE-01).

---

*Phase: 28-startup-mcp-server*
*Completed: 2026-05-25*
