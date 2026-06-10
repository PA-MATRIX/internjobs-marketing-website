---
phase: 29
plan: 01
subsystem: startup-mcp / telnyx-sms-adapter
tags: [telnyx-sms, mcp, ed25519, channel-adapter, voice-ai-prep, tcpa]
requires:
  - phase-28 (startup MCP core: search/execute/me/discover_actions)
  - phase-28.5-04 (Fly proxy `/v1/channel-links` UPSERT semantics)
  - phase-28.5-05 (work-email blocklist, now extracted to lib/workEmail.ts)
provides:
  - POST /webhooks/telnyx/sms inbound SMS webhook (STOP-first, sig-verify, intent-classified)
  - sendSms() / formatForSms() outbound + result-formatting utilities
  - resolveChannelLink() generic identity helper (telnyx-sms now; telnyx-voice in 29-02)
  - classifyIntent() regex + LLM-fallback intent classifier
  - show_candidate + register_startup MCP actions (handlers + Fly endpoints)
  - migration 0014 (last_touchbase_at column for Phase 29-03 cron)
  - workEmail.ts shared blocklist (Phase 28.5-05 → 29-01 DRY)
affects:
  - 29-02 (Voice AI Agent + R2 audit log) — imports resolveChannelLink, sendSms,
    register_startup action + admin loopback pattern
  - 29-03 (weekly cron + reply parser) — depends on last_touchbase_at column,
    classifyIntent regex fast-path for numeric replies, sendSms for cron
tech-stack:
  added:
    - "@cf/meta/llama-3.1-8b-instruct via env.AI binding (intent classification)"
  patterns:
    - "STOP handling BEFORE signature verify (TCPA priority over crypto)"
    - "Loopback /admin/startups/new from MCP action handler (voice-onboarding)"
    - "Telnyx webhook always returns 200 (avoid retry-storm) except 401 bad-sig"
    - "Two-layer intent classification: regex fast-path then LLM fallback"
key-files:
  created:
    - apps/startup/workers/lib/telnyx.ts
    - apps/startup/workers/lib/resolveChannelLink.ts
    - apps/startup/workers/lib/intent.ts
    - apps/startup/workers/lib/workEmail.ts
    - apps/startup/workers/routes/telnyx.ts
    - apps/startup/workers/routes/telnyx.test.ts
    - apps/app/db/migrations/0014_v1_4_telnyx_touchbase.sql
    - .planning/milestones/v1.4-pilot-readiness/phases/29-startup-telnyx-voice-sms/PHASE-29-DEFERRED-OPS.md
  modified:
    - apps/startup/workers/tools/execute.ts (added show_candidate + register_startup handlers)
    - apps/startup/workers/types.ts (added 8 optional Phase-29 env fields + AI binding type)
    - apps/startup/workers/app.ts (mounted telnyxRouter)
    - apps/startup/wrangler.jsonc (TELNYX_WEBHOOK_PUBLIC_KEY + VOICE_AGENT_TOKEN comment stubs + KV/R2 commented bindings)
    - apps/startup/workers/routes/webhooks.ts (re-export isPersonalEmail → isPersonalEmailDomain for shared blocklist)
    - infra/startup-api/src/index.mjs (3 new endpoints: channel-links/resolve, channel-links/:id/opt-out, startups/:id/candidates)
metrics:
  duration: "~90 min single-context execution"
  completed: "2026-05-25"
---

# Phase 29 Plan 01: Startup Telnyx SMS Adapter Summary

**One-liner:** Telnyx SMS inbound webhook with STOP-first TCPA compliance, Ed25519 signature verification (CF Workers `crypto.subtle.verify('Ed25519',...)`), regex + LLM intent classification, and two new MCP actions (`show_candidate`, `register_startup`) — all code-complete in ops-deferred mode pending Telnyx account/number/secret provisioning.

## What Shipped

Four commits on `rrr/v1.4/team-cms`:

| Commit | Type | Summary |
| --- | --- | --- |
| `50f9835` | docs | PHASE-29-DEFERRED-OPS.md backlog (11 entries: signup → smoke test → migration apply) |
| `5f76b1c` | feat | migration 0014 + show_candidate/register_startup handlers + 3 Fly endpoints |
| `587e5cf` | feat | SMS adapter — telnyx.ts + resolveChannelLink.ts + intent.ts + routes/telnyx.ts + wrangler.jsonc + app.ts mount |
| `15e0ad1` | test | 34-case unit suite (intent regex, STOP, Ed25519 round-trip, work-email rejection, formatForSms) |

## Architecture

```
POST /webhooks/telnyx/sms (Telnyx messaging profile → CF Worker)
    │
    ├─ 1. STOP handling (BEFORE sig verify, TCPA priority)
    │     ├─ resolveChannelLink → POST /v1/channel-links (UPSERT status=opted_out)
    │     ├─ sendSms("you're opted out. text 'start' anytime to re-subscribe.")
    │     └─ writeAuditLog (action='stop_opt_out')
    │
    ├─ 2. Ed25519 signature verify
    │     ├─ env.TELNYX_WEBHOOK_PUBLIC_KEY bound → crypto.subtle.verify('Ed25519',...)
    │     │     ├─ valid → continue
    │     │     └─ invalid → 401 {error:'invalid_signature'}
    │     └─ env.TELNYX_WEBHOOK_PUBLIC_KEY unbound → log warning + continue (DEFER-29-01-F)
    │
    ├─ 3. Parse event_type ('message.received' only; receipts silent 200)
    │
    ├─ 4. resolveChannelLink('telnyx-sms', from_phone) → StartupContext | null
    │     └─ null → sendSms(invite-prompt) + audit + return 200
    │
    ├─ 5. classifyIntent(body, env) → IntentResult | null
    │     ├─ regex fast-path: '1'..'9' → show_candidate, START/YES/y → opt_in_touchbase=true,
    │     │                   no/n → opt_in_touchbase=false
    │     └─ LLM fallback: env.AI.run('@cf/meta/llama-3.1-8b-instruct', {messages:[...], max_tokens:200})
    │           → null → sendSms(usage-hint) + audit + return 200
    │
    ├─ 6. Dispatch:
    │     ├─ intent.kind='search' → handleSearch({scope, query, limit:5}) → top-5 summaries
    │     └─ intent.kind='execute' → handleExecute({action, params, startup_id, member_id})
    │
    └─ 7. formatForSms(result) → sendSms(reply) + audit (action=intent.action) → return 200
```

Reverse direction (`register_startup` from Voice AI Phase 29-02):

```
handleRegisterStartup(args)
    │
    ├─ isPersonalEmailDomain(args.founder_email)? → return {ok:false, error:'personal_email_rejected'}
    │
    ├─ loopback POST https://mcp.internjobs.ai/admin/startups/new
    │     Authorization: Bearer env.STARTUP_MCP_ADMIN_SECRET
    │     → 409 → return {ok:false, error:'already_registered'}
    │     → 2xx → continue
    │
    └─ best-effort POST /v1/channel-links (channel_type=args.channel_type,
       channel_external_id=args.channel_external_id, opt_in_flags={weekly_touchbase:true},
       metadata={what_hiring_for,founder_name,registered_via})
       → return {ok:true, startup_id, agent_email, mcp_install_snippet}
```

## Decisions Made

### Decision 1: STOP handling runs BEFORE signature verification

**Choice:** Process STOP/UNSUBSCRIBE/CANCEL/END/QUIT keywords unconditionally on every payload — even on un-verified or forge-able requests — before invoking Ed25519 sig verify.

**Rationale:** TCPA exposure for failing to honor STOP is materially worse than the abuse surface of accepting a forged STOP. Worst case of a forged opt-out: a legitimate founder gets opted out and texts START to rejoin (cheap recovery). Worst case of refusing a real STOP because the signature happened to be malformed: TCPA fine + carrier delisting.

Alternative considered: verify sig first, then STOP. Rejected — order matters for legal compliance, not for code aesthetics.

### Decision 2: SMS webhook always returns 200 except on bad signature

**Choice:** All non-signature-failure error paths (invalid JSON, unknown phone, intent unparseable, handler exception) return HTTP 200 with `{ok:true}`.

**Rationale:** Telnyx retries non-2xx responses on a backoff queue. A single bad inbound that 500s gets retried 5-7 times over an hour, multiplying the failure. By returning 200 on everything except provably-tampered payloads (401), we keep Telnyx's queue empty.

The legitimate-user-facing failure mode (e.g. handler throws) is handled inside the route with a best-effort `sendSms("something went wrong. we've been notified.")` so the user gets a confirmation even when we couldn't process the intent.

### Decision 3: register_startup uses a loopback to /admin/startups/new

**Choice:** `handleRegisterStartup` POSTs to `https://mcp.internjobs.ai/admin/startups/new` (the Worker's own admin endpoint) with `Authorization: Bearer env.STARTUP_MCP_ADMIN_SECRET` rather than re-implementing startup creation in the action handler.

**Rationale:**
1. **Reuse of provisioning logic:** The admin endpoint already does Clerk invite + welcome email + agent_email provisioning + SMS install snippet. Re-implementing in execute.ts would drift over time.
2. **Admin secret never reaches Voice AI:** The Voice AI agent holds only its per-agent MCP token. The admin secret lives only in the Worker's env (TELNYX_VOICE_AGENT_TOKEN can't mint startups directly).
3. **Same response shape as 28-04:** Voice AI gets `{startup_id, agent_email, install_snippet}` — same as concierge onboarding — so SMS/voice response builders share the same formatForSms code path.

Drawback: ~50-100ms loopback latency (Worker calls itself through the public CF edge). Acceptable for an onboarding action where the founder is already on a voice call.

### Decision 4: Shared work-email blocklist via lib/workEmail.ts

**Choice:** Extract the 30-domain blocklist from `routes/webhooks.ts` (Phase 28.5-05 Clerk webhook) into `lib/workEmail.ts`. Both the webhook handler and the new `handleRegisterStartup` action import `isPersonalEmailDomain` from this shared module. The existing `isPersonalEmail` re-export in webhooks.ts keeps the 26-case webhooks.test.ts suite passing without modification.

**Rationale:** Same enforcement, two surfaces (Clerk signup, Voice AI register_startup). Drift would mean a founder rejected at signup who later gets through via voice intake (or vice versa).

v1.5 follow-up: externalize to Workers KV so ops can add domains without a code deploy (DEFER-28.5-05-C — already filed).

### Decision 5: Two-layer intent classifier (regex + LLM)

**Choice:** `classifyIntent` runs a sync regex pass first (`classifyIntentRegex`). Only if regex returns null does it call `env.AI.run('@cf/meta/llama-3.1-8b-instruct', ...)`.

**Rationale:**
- Numeric replies ("1", "2", "3") are the dominant inbound shape from Phase 29-03's weekly touchbase. Burning 200ms + ~50 neurons on an LLM call for those would be wasteful.
- STOP / START / YES / NO must respond identically every time. Letting an LLM classify them risks drift (an LLM occasionally maps "y" to "yes-question" or some other shape).
- LLM tail handles the long tail: "show me 3 candidates", "post a frontend role", etc. — natural language a founder might type.

`env.AI` is also nullable (test env, edge cases) — the classifier returns null gracefully and the route sends a usage hint reply.

### Decision 6: Migration 0014 ships but doesn't apply

**Choice:** Write the `0014_v1_4_telnyx_touchbase.sql` migration file with `ALTER TABLE startup_channel_links ADD COLUMN IF NOT EXISTS last_touchbase_at timestamptz` + partial composite index, but DO NOT run the `migrate.mjs` runner against Fly Postgres yet. The apply step is filed as **DEFER-29-01-K** in PHASE-29-DEFERRED-OPS.md.

**Rationale:** Migration apply is a separate ops step (`migrate.mjs` runs need Fly Postgres connection from a trusted host). Per the active session rule, defer-don't-pause. The 29-03 weekly cron query against `last_touchbase_at` won't run until that plan executes; meanwhile the column being missing causes no Worker-side failures (no code in Phase 29-01 reads or writes it).

## Verification

| Check | Result |
| --- | --- |
| `cd apps/startup && npx tsc --noEmit` | 0 errors |
| `npx tsx --test workers/routes/telnyx.test.ts` | 34/34 pass |
| `npx tsx --test workers/routes/webhooks.test.ts` | 26/26 pass (Phase 28.5-05 unchanged) |
| `npx tsx --test workers/lib/slug.test.ts` | 16/16 pass (Phase 28.5-04 unchanged) |
| `node --check infra/startup-api/src/index.mjs` | OK |
| `grep -c 'show_candidate\|register_startup' apps/startup/workers/tools/execute.ts` | 7 (handlers + ACTION_HANDLERS keys) |
| `grep 'last_touchbase_at' apps/app/db/migrations/0014_v1_4_telnyx_touchbase.sql` | 5 matches (column + index + cron-query docs) |
| `grep 'channel-links/resolve\|candidates.*position' infra/startup-api/src/index.mjs` | 4 matches |
| `grep 'TELNYX_WEBHOOK_PUBLIC_KEY' apps/startup/workers/types.ts` | 1 (declared optional) |
| `grep 'telnyxRouter' apps/startup/workers/app.ts` | 2 (import + mount) |
| `ls PHASE-29-DEFERRED-OPS.md` | exists with 11 entries (DEFER-29-01-A..K) |

## Test Coverage Highlights

**34 cases in `workers/routes/telnyx.test.ts`:**

- **intent regex (11):** Numeric replies `1` / `5` / `9` map to `show_candidate` position; `0` and `10` do NOT match (regex is `[1-9]` single-digit); `YES`/`y`/`no`/`START` map to `opt_in_touchbase` with correct flag; natural-language `"show me the top 3 candidates"` returns null (signals LLM fallthrough); empty/whitespace returns null.
- **STOP regex (10):** `STOP`/`stop`/`STOPALL`/`STOP ALL`/`unsubscribe`/`Cancel`/`End`/`Quit` all match. `stop being mean` and `stopwatch` do NOT match — critical TCPA false-positive guard.
- **Ed25519 verify (4):** Real keypair generated via `node:crypto.generateKeyPairSync('ed25519')`; signed message `${timestamp}|${rawBody}` verifies via the same `crypto.subtle.verify('Ed25519',...)` path the Worker uses. Tampered body → false; wrong public key → false; malformed base64 input → false (no throw).
- **work-email gate (5):** `gmail.com`/`yahoo.com`/`proton.me`/`gmx.de` reject; `acme.io` work-domain accept.
- **formatForSms (4):** `show_candidate` shape → `#N: name\nrole: title\nsummary`; `register_startup` ok=true → message starts with "registered!" and includes the agent_email; ok=false → message verbatim; array → numbered list.

## Deviations from Plan

### 1. (Rule 2 — Missing Critical) Shared work-email blocklist extracted to lib/workEmail.ts

The plan's Constraint #14 said "validate work-email domain against the same blocklist as the Phase 28.5 Clerk webhook (gmail, yahoo, etc.). Reuse the blocklist if practical — extract to lib if not already." The blocklist was inline in `routes/webhooks.ts`; I extracted to `lib/workEmail.ts` and made `routes/webhooks.ts` re-export `isPersonalEmail` as a thin wrapper so the existing 26-case webhooks.test.ts suite passes unchanged. This is the practical reuse path.

**Files affected (NOT in original frontmatter `files_modified`):**
- `apps/startup/workers/lib/workEmail.ts` — new shared module
- `apps/startup/workers/routes/webhooks.ts` — replaced inline BLOCKED_DOMAINS + isPersonalEmail with `isPersonalEmailDomain` import + re-export

### 2. (Rule 1 — Bug) STOP-path channel-link opt-out via POST upsert, not PATCH

The plan suggested `PATCH /v1/channel-links/${rowId}/opt-out` for STOP handling. The `rowId` isn't available — `resolveChannelLink` returns `{startup_id, member_id, startup_name}` but NOT the channel_link row id. Adding the row id to the resolve response would have inflated the API surface.

**Fix:** Use the existing `POST /v1/channel-links` UPSERT endpoint with `status: 'opted_out'` + `opt_in_flags: {}`. This is idempotent (the table's UNIQUE constraint on (startup_id, channel_type, channel_external_id) ensures we update the existing row in place) and doesn't require the row id. I still ADDED `PATCH /v1/channel-links/:id/opt-out` to the Fly proxy (it's useful for Voice AI / admin tooling later), but the STOP path uses the simpler upsert.

### 3. (Rule 1 — Bug) Test file fix — removed `createPublicKey(publicKey)` noop call

First test run failed 3/34 with `Invalid key object type public, expected private` from `createPublicKey(publicKey)` in the Ed25519 test helper. The line was a left-over "avoid unused-var" placeholder; removed it, all 34 pass.

### 4. (Plan-anticipated, Rule 4 pre-approved) Task 1 checkpoint:human-verify DEFERRED

Per the active session rule "don't wait on me — finish all the phases," the Telnyx account/number/secrets/portal-config checkpoint was wholesale deferred into `PHASE-29-DEFERRED-OPS.md` with 11 entries (DEFER-29-01-A through K). Migration 0014 apply was added as DEFER-29-01-K.

## Authentication Gates

None encountered during execution — Phase 29-01 is code-only. All authentication gates are filed in PHASE-29-DEFERRED-OPS.md for Raj to clear post-merge:

- Telnyx account login (DEFER-29-01-A)
- Telnyx API key + webhook public key generation (DEFER-29-01-E, F)
- `wrangler secret put` for 5 secrets (DEFER-29-01-E, F, G, H + 29-02's voice agent token)

## Next Phase Readiness

**Phase 29-02 (Voice AI Agent + R2 audit log):**
- Imports `resolveChannelLink` (telnyx-voice channel_type) ✓
- Imports `sendSms` for post-call confirmation SMS ✓
- Reuses `register_startup` MCP action as the Voice AI agent's onboarding tool ✓
- Needs new R2 binding `VOICE_AUDIT` — stub already commented in wrangler.jsonc ✓
- Needs `TELNYX_VOICE_AGENT_TOKEN` — already declared in types.ts + wrangler.jsonc ✓
- Needs `TELNYX_USE_MCP_INTEGRATION` flag — already declared ✓

**Phase 29-03 (weekly cron + reply parser + opt-in):**
- Needs `last_touchbase_at` column — migration 0014 added (apply DEFER-29-01-K) ✓
- Uses `classifyIntentRegex` for numeric-reply fast-path ✓
- Reuses `sendSms` + `formatForSms` for cron-fanout messages ✓
- Needs new KV binding `TOUCHBASE_CURSORS` — stub already commented in wrangler.jsonc ✓

No blockers for the parallel 29-02 + 29-03 wave.
