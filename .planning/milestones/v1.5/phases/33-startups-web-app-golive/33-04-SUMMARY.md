---
phase: 33-startups-web-app-golive
plan: 04
subsystem: inbound-email
tags: [cloudflare-workers, email-routing, ci, secrets, deploy, workerd, incident]
requires: ["33-01", "33-02"]
provides:
  - "scripts/check-email-timeout-invariant.mjs (cross-package CI guard)"
  - "email-timeout-invariant CI job"
  - "EMAIL_HANDOFF_SECRET provisioned in Infisical + bound to both Workers"
  - "internjobs-startup-mcp deployed with POST /internal/email/inbound"
  - "internjobs-email-ingest deployed with the employers dispatch branch"
  - "apps/email-worker/src/constants.js (entrypoint-safe constants module)"
  - "workerd entrypoint-shape regression guard test"
affects: ["33-05"]
tech-stack:
  added: []
  patterns:
    - "Cross-package invariant enforced by a dependency-free CI script that text-extracts both sides' real constants"
    - "Worker entrypoint modules may only have function/handler named exports; constants live in a sibling module"
key-files:
  created:
    - scripts/check-email-timeout-invariant.mjs
    - apps/email-worker/src/constants.js
  modified:
    - .github/workflows/ci.yml
    - apps/email-worker/src/index.js
    - apps/email-worker/src/index.test.js
decisions:
  - "Timeout constants moved OFF the Worker entrypoint into src/constants.js — workerd refuses to start a Worker whose entrypoint has a non-function named export"
  - "Rolled back prod immediately on discovering the outage rather than fixing forward under a live mail failure"
duration: ~35m
completed: 2026-07-13
---

# Phase 33 Plan 04: Deploy + Cross-Package Timeout Invariant Summary

Built the real cross-package latency-budget CI guard, provisioned `EMAIL_HANDOFF_SECRET`, and deployed both Workers — and in doing so **caught and fixed a total inbound-mail outage that Plan 33-02's code would have shipped**: numeric named exports on the Worker entrypoint make workerd refuse to start the entire script, which `wrangler deploy` accepts without complaint.

## What Shipped

### 1. `scripts/check-email-timeout-invariant.mjs` (the checker-flagged blocker, closed)

Dependency-free Node ESM (`node:fs` only). Text-extracts the **real** constants from both packages and asserts:

```
RESOLVE_TIMEOUT_MS + INSERT_TIMEOUT_MS + OVERHEAD_BUDGET_MS <= EMPLOYERS_HANDOFF_TIMEOUT_MS
4000 + 5000 + 5000 = 14000 <= 20000   (6000ms slack)
```

- Reads `RESOLVE_TIMEOUT_MS`/`INSERT_TIMEOUT_MS` from `apps/startup/workers/routes/email.ts` and `OVERHEAD_BUDGET_MS`/`EMPLOYERS_HANDOFF_TIMEOUT_MS` from `apps/email-worker/src/constants.js`. **No hardcoded duplicates.**
- **Fails closed.** A missing/renamed/un-exported/duplicated constant exits 1 naming the constant and file — never falls back to a default.
- Regex is anchored to a real `const` **declaration at line start**, not a loose `NAME = digits` match. This is load-bearing: *both* source files contain prose comments quoting these names next to numbers (e.g. `RESOLVE_TIMEOUT_MS (4000ms)`), so a loose regex could bind to a comment and read a number the code no longer uses — passing while the live constants violate the invariant.
- CWD-independent (paths resolved from `import.meta.url`).
- Wired as the always-run `email-timeout-invariant` CI job (no path gating; sub-second, zero deps).

**Fail-path demonstrated** (per the plan's `<done>` bar):

| Demo | Result |
|---|---|
| `EMPLOYERS_HANDOFF_TIMEOUT_MS` 20000 → 9000 | exit 1, `...14000 > EMPLOYERS_HANDOFF_TIMEOUT_MS(9000)`, both files named |
| `RESOLVE_TIMEOUT_MS` renamed | exit 1, fail-closed, no default assumed |
| Reverted | blob hashes byte-identical to baseline; check green |

The violation demo also proved the anchoring works: it reported `9000` while the file's own comment two lines above still said `20000`.

### 2. `EMAIL_HANDOFF_SECRET` provisioned

`openssl rand -hex 32` → Infisical (`/internjobs-ai`, env=prod) → verified round-trip by SHA-256 fingerprint → same Infisical-sourced value bound to **both** Workers (identical fingerprint confirmed before both `wrangler secret put` calls, so the handoff cannot 401 on a mismatch).

### 3. Both Workers deployed

| Worker | Version | State |
|---|---|---|
| `internjobs-startup-mcp` | `e8c5cab2` | 100%, `mcp.internjobs.ai` live |
| `internjobs-email-ingest` | `fd5d37c8` | 100%, boots clean |

### 4. Smoke test (synthetic, live)

| Case | Expected | Got |
|---|---|---|
| wrong secret | 401 | 401 PASS |
| real secret + unknown slug | 404 | 404 PASS |
| real secret + wrong domain | 400 | 400 PASS |
| missing auth header | 401 | 401 PASS |

The 404 is the load-bearing one: it proves auth **passed** with the Infisical value and the route proceeded to a real slug resolve against the Fly proxy.

CF Email Routing verified read-only: the zone-wide catch-all is **untouched**, still bound to `internjobs-email-ingest`; all specific-address rules (parrot, agentic-inbox, `raj@` forward) intact.

## Incident: total inbound-mail outage, caught and fixed

**Root cause.** Plan 33-02 declared the budget constants as `export const EMPLOYERS_HANDOFF_TIMEOUT_MS = 20000` / `export const OVERHEAD_BUDGET_MS = 5000` in `apps/email-worker/src/index.js` — the Worker **entrypoint** module. workerd requires every *named export of an entrypoint* to be a function/handler and refuses to instantiate the whole script otherwise:

```
Uncaught TypeError: Incorrect type for map entry 'EMPLOYERS_HANDOFF_TIMEOUT_MS':
the provided value is not of type 'function or ExportedHandler'.
The Workers runtime failed to start.
```

Because this Worker owns the zone-wide CF Email Routing catch-all, that is a **total inbound-mail outage** for `internjobs.ai` — `agent.internjobs.ai` conv-alias ingestion and the `rentalaraj@gmail.com` operator forward included — not a degraded mode.

**Why every existing gate missed it.** `node --check` passes (valid syntax). node:test passes (Node permits numeric named exports). The 21-test regression suite passes (it imports the module under Node). And **`wrangler deploy` ACCEPTS the upload** — it only fails at runtime instantiation. Tell-tale: the email-ingest deploy printed no `Worker Startup Time`, unlike startup-mcp.

**How it was caught.** A post-deploy health check booting the real workerd runtime locally (`wrangler dev`). The edge's HTTP 1101 was ambiguous — this Worker is email-only and has no `fetch()` handler, so it returns 1101 either way.

**Response.** Rolled `internjobs-email-ingest` back to last-known-good `5e241bdb` at 100% (~6 min exposure). Fortunately that version was minted by the `wrangler secret put` step minutes earlier, so it carried the **old working code + the new secret**.

**Fix.**
- New `apps/email-worker/src/constants.js` holds both constants; `index.js` imports them. The entrypoint now exports only functions + `default`.
- **Regression guard test** added: asserts every named export of the entrypoint is a `function`, naming any offending primitive. Verified it fails on reintroduction (`TEMP_BAD_EXPORT (number)` → rc=1), then reverted.
- Invariant script repointed at `src/constants.js`.

**Verified fixed.** Local workerd boots clean (`Ready on ...`, zero `Uncaught`). Live `wrangler tail` on the redeployed Worker now reports only `Handler does not export a fetch() function.` (correct for an email-only Worker) — the `Incorrect type for map entry` signature is **gone from production**.

## Pre-deploy Gate

| Check | Result |
|---|---|
| `apps/startup` typecheck | green |
| `apps/startup` tests | **103/103** |
| `apps/email-worker` `node --check` | green |
| `apps/email-worker` tests | **22/22** (21 + new workerd guard) |
| cross-package invariant | green |

## Deviations

Files touched beyond the plan's `files_modified` (`scripts/check-email-timeout-invariant.mjs`, `.github/workflows/ci.yml`):

- **`apps/email-worker/src/constants.js`** (new) — **Rule 3 (blocking)**. Task 3 (deploy) could not complete: the code from 33-02 cannot start under workerd. Constants moved off the entrypoint.
- **`apps/email-worker/src/index.js`** — **Rule 3 (blocking)**. Imports the constants instead of exporting numbers from the entrypoint.
- **`apps/email-worker/src/index.test.js`** — **Rule 2 (missing critical)**. Added the workerd entrypoint-shape guard so this outage class cannot recur, and repointed the constant imports.

Other deviations:

- **Infisical CLI syntax.** The plan's `infisical secrets set NAME "value"` is wrong for this CLI; the real form is `secrets set NAME=VALUE`. Used the correct form.
- **`infisical secrets get` fails OPEN.** For a missing key it returns **rc=0 with empty stdout**. The plan's smoke test pipes that straight into a `Bearer` header, so an absent secret would silently send `Bearer ` and yield a misleading **401 where 404 was expected** — masking a broken deploy as an auth failure. Added a hard length guard (`!= 64` → abort) to every read.
- **Invariant script reads `src/constants.js`,** not `src/index.js` as the plan specified — a direct consequence of the outage fix.
- Two extra smoke cases (wrong domain → 400, missing auth → 401) beyond the plan's two.

## Next Phase Readiness

Ready for **33-05** (real live-mail verification). The handoff contract is proven synthetically end-to-end; both Workers are live; the secret is shared and verified identical.

Flag for 33-05: the operator-forward fail-safe path has **not** been exercised against real mail since the redeploy. Its logic is covered by the 22-test suite, but 33-05's live test should confirm an unknown-slug `@employers.internjobs.ai` message actually lands in the operator inbox.
