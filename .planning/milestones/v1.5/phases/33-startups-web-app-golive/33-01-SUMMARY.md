---
phase: 33-startups-web-app-golive
plan: 01
subsystem: startup-worker-inbound-email
tags: [cloudflare-workers, hono, email-routing, postal-mime, inbound-messages, latency-budget]
requires: [28.5-04-startup-agent-email, 29-startup-telnyx-voice-sms]
provides:
  - "POST /internal/email/inbound on internjobs-startup-mcp (Bearer-gated HTTP handoff endpoint)"
  - "processInboundEmail() shared core — one implementation of employers-mail routing"
  - "RESOLVE_TIMEOUT_MS=4000 / INSERT_TIMEOUT_MS=5000 exported constants (inner half of the Phase 33 latency budget)"
affects: [33-02-email-worker-dispatch, 33-04-secrets-and-ci-invariant, 33-05-live-verification]
tech-stack:
  added: []
  patterns:
    - "Two entry points (CF email() export + HTTP route) sharing one never-throwing tagged-result core"
    - "Tagged failure reasons mapped to distinct HTTP statuses so the caller can fail safe"
    - "Timeout constants exported for cross-package CI assertion rather than duplicated as literals"
key-files:
  created:
    - apps/startup/workers/routes/email.test.ts
  modified:
    - apps/startup/workers/routes/email.ts
    - apps/startup/workers/app.ts
    - apps/startup/workers/types.ts
    - apps/startup/wrangler.jsonc
decisions:
  - "Threading headers are now read from the postal-mime parse result rather than CF's message.headers map — the HTTP path never sees CF's map, and both read the same MIME source"
  - "parse_failed is a defensive branch, not an input-validation branch: postal-mime 2.7.x does not throw on binary garbage, empty buffers, or non-email text (verified empirically)"
duration: ~50m
completed: 2026-07-14
---

# Phase 33 Plan 01: Inbound-Email HTTP Handoff Endpoint Summary

**Date:** 2026-07-14
**Branch:** `rrr/v1.5/team-workspace-33`
**Status:** Code complete, typecheck + tests green. NOT deployed (deployment is Wave 2).

Gave the startup Worker (`internjobs-startup-mcp`, `mcp.internjobs.ai`) an HTTP entry point
that `apps/email-worker` can hand inbound `@employers.internjobs.ai` mail off to, and
collapsed the pre-existing CF-native `email()` handler and the new route onto a single
shared `processInboundEmail()` core — so there is exactly one implementation of "route an
employers.internjobs.ai email to the right startup."

## What shipped

**1. `processInboundEmail()` — the shared core** (`apps/startup/workers/routes/email.ts`)

Extraction of the old `handleInboundEmail` body, parameterized on `{toAddress,
fromAddressHeader, rawBytes, env}` instead of a `ForwardableEmailMessage`. Does
resolve slug → `(startup_id, member_id)` via the Fly proxy's `/v1/channels/resolve` →
parse MIME with postal-mime → extract In-Reply-To/References/Message-ID → insert an
`inbound_messages` row via `/v1/messages/inbound`.

Never throws. Every failure is a tagged result — `unknown_slug` | `resolve_failed` |
`parse_failed` | `insert_failed` — so each caller picks its own failure semantics. Every
pre-existing `console.log`/`console.error` structured-log `event` name is preserved.

**2. `POST /internal/email/inbound` — the new primary path**

New `emailInternalRouter` (Hono sub-router), mounted at `/internal` in `app.ts`. Gated by
`Authorization: Bearer <EMAIL_HANDOFF_SECRET>` using the same constant-time
`crypto.subtle.timingSafeEqual` pattern `admin.ts::verifyAdminSecret` uses (deliberately a
local copy, not a cross-route import). Implements the Plan 33-02 contract exactly:

| Case | Status |
| --- | --- |
| success | `200 {ok:true, duplicate, id}` |
| invalid recipient | `400` |
| bad/missing/unbound secret | `401` |
| unknown slug | `404 {ok:false, reason:"unknown_slug"}` |
| MIME parse failure | `422` |
| resolve/insert infra failure | `502` |

Distinct statuses are the point: the caller (email-worker) can tell "this slug doesn't
exist" apart from "our backend is down" and fail safe to the operator fallback inbox on
any non-2xx.

**3. `handleInboundEmail()` — now a thin wrapper, behavior unchanged**

Still validates the recipient shape (that check is specific to CF's envelope, so it stays
outside the core), drains `message.raw`, calls the core, and maps back to the **exact**
pre-refactor behavior: `setReject("invalid recipient address")`, `setReject("startup not
found")` on unknown slug, and silent-drop-with-log (NO `setReject`) on infra/parse failure.
Retained as the defensive/future-proof direct-routing path — CF never invokes it today
because the zone's single Email Routing catch-all belongs to `apps/email-worker`.

**4. Latency budget — this plan's half**

`RESOLVE_TIMEOUT_MS = 4000` and `INSERT_TIMEOUT_MS = 5000` are exported named constants
(down from the inherited 8000/10000, which summed to 18s). Inner sum: **9000ms**. Both
call sites carry the budget comment pointing at the CI script that actually enforces the
cross-package inequality. Exported — not literals — precisely so Plan 33-04's
`scripts/check-email-timeout-invariant.mjs` can read the real values.

**5. Config/type plumbing**

`types.ts` gains `EMAIL_HANDOFF_SECRET?: string` (optional at type level, matching every
other `wrangler secret put` field — the route is the source of truth for "missing → 401").
`wrangler.jsonc` documents the secret in its secrets block (no value committed).

## Verification

- `cd apps/startup && npm run typecheck` — **clean, zero errors.**
- `cd apps/startup && npm test` — **103 tests, 103 pass, 0 fail** (28 new in
  `email.test.ts`; 75 pre-existing slug/telnyx/scheduled tests still green).
- No real network calls: `globalThis.fetch` is stubbed and restored in a `finally` in
  every test.
- Nothing deployed. No `wrangler deploy`, no `wrangler secret put`, no live API calls.

New test coverage (`email.test.ts`, 28 tests):
- `processInboundEmail()`: happy path (asserts the full `inbound_messages` payload +
  threading metadata), unknown_slug, resolve_failed (5xx **and** thrown/aborted fetch),
  parse_failed, insert_failed (non-2xx **and** throw), duplicate, URL normalisation.
- `POST /internal/email/inbound`: 401 for missing / wrong / **unbound** secret (each
  asserting zero downstream fetches — auth precedes all work), 400 for non-employers and
  missing recipient, 200 happy path, recipient lowercasing, 404, 422, 502.
- `handleInboundEmail()`: **regression coverage that did not exist before** — the
  setReject semantics the refactor had to preserve.
- Same-package timeout tripwire: `RESOLVE_TIMEOUT_MS === 4000`, `INSERT_TIMEOUT_MS === 5000`,
  and both fetch call sites receive an `AbortSignal`.

## Deviations from plan

**1. [Rule 1 — plan's test spec contradicted reality] `parse_failed` cannot be triggered by
"malformed bytes."**

The plan specified constructing "genuinely malformed bytes, e.g. a truncated/binary-garbage
buffer" to exercise the `parse_failed` branch. Probed postal-mime 2.7.x empirically first:
it **never throws** — binary garbage, empty buffers, plain non-email text, even `null` and
numbers all parse successfully into an email with `undefined` subject/body. So the
as-written test was impossible.

Fixed by (a) exercising the branch via a scoped `PostalMime.prototype.parse` stub that
throws (restored in `finally`) — which is what the branch actually guards: unexpected
internal parser errors, and (b) adding a companion test that pins the *real* behavior
(garbage bytes → parse succeeds → inserted as an empty message), so a future reader doesn't
wrongly assume garbage yields a 422. The code's `parse_failed` branch and its 422 mapping
are unchanged; only the honest description of what they defend against changed. Documented
in the test file's header and in the frontmatter decisions.

**2. [Extraction consequence] Threading headers now come from the parsed MIME, not CF's
`message.headers`.**

The old code read `in-reply-to` / `references` / `message-id` off CF's `message.headers`
map. The shared core cannot: the HTTP handoff carries the raw MIME body plus To/From, not
CF's header map. The core now reads the same headers out of the postal-mime parse result
(with a `parsed.headers` array fallback). Same source data (the message's own MIME
headers), same extracted values — asserted in the happy-path tests for both entry points.

**3. Test file shims `crypto.subtle.timingSafeEqual`.**

That's a Cloudflare Workers extension to WebCrypto; Node's `crypto.subtle` doesn't have it
(`node:crypto`'s `timingSafeEqual` is a different namespace), so the auth tests would have
thrown a TypeError. The test file installs an equivalent constant-time compare if the
method is absent. Worker source is untouched.

**No STATE.md update:** this repo has no `.planning/STATE.md` (never had one); nothing to
update.

## Notes for the rest of the phase

- **The blocker this plan addresses is only half-closed.** `4000 + 5000 = 9000ms` is this
  package's contribution. The spurious-duplicate-forward defect is FULLY closed only once
  Plan 33-04's `scripts/check-email-timeout-invariant.mjs` exists and passes, asserting
  `RESOLVE + INSERT + OVERHEAD_BUDGET_MS <= EMPLOYERS_HANDOFF_TIMEOUT_MS` against both
  packages' real source. This plan's timeout test is a same-package tripwire and must not
  be mistaken for that guard — the test file says so in its header.
- **Plan 33-02** must POST to `https://mcp.internjobs.ai/internal/email/inbound` with
  `Authorization: Bearer <EMAIL_HANDOFF_SECRET>`, `X-Startup-To`, `X-Startup-From`, and the
  raw MIME as the octet body (not JSON-wrapped), and treat any non-2xx/timeout/throw as
  fail-safe-forward. That is exactly what shipped here.
- **Plan 33-04** must provision `EMAIL_HANDOFF_SECRET` with the **same value on both
  Workers** (`internjobs-startup-mcp` and `internjobs-email-ingest`). Until it is set on
  this Worker, the endpoint fails closed with 401 — which is tested.

## Commits

- `630c6c8` — `feat(33-01): extract shared inbound-email core + add POST /internal/email/inbound`
- `15e4701` — `test(33-01): cover both inbound-email entry points (28 new tests)`
