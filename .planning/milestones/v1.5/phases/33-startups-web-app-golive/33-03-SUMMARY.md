---
phase: 33-startups-web-app-golive
plan: 03
subsystem: auth
tags: [clerk, restrictions, blocklist, work-email, ops-script, node-esm]
requires:
  - "Phase 28.5-05 / 29-01 (apps/startup/workers/lib/workEmail.ts BLOCKED_DOMAINS — the canonical code-side list this mirrors)"
  - "Commit 67f69e0 (2026-05-27, 'User pivoted to Option A') — the decision to use Clerk's native Restrictions instead of a user.created webhook"
provides:
  - "scripts/33-clerk-restrictions-config.mjs — idempotent Clerk Restrictions apply + read-only --verify-only health check"
  - "LIVE: employers Clerk app (ins_3EE0Dfy…) configured with blocklist + block_disposable_email_domains + block_email_subaddresses, and all 35 personal-email identifiers"
  - "Evidence artifact for STARTUPS-EMPLOYERS-WORK-EMAIL-01"
  - "The correct read-back endpoint for Clerk restriction flags (FAPI /v1/environment — NOT the Backend API)"
affects:
  - "Plan 33-05 (live sign-up-form verification — builds on this being already-applied; MUST NOT use GET /v1/instance/restrictions, see Deviation 1)"
  - "Any future change to apps/startup/workers/lib/workEmail.ts BLOCKED_DOMAINS (must be mirrored into the script)"
tech-stack:
  added: []
  patterns:
    - "Config-not-code enforcement: personal-email rejection happens at Clerk's sign-up form, so there is no orphan account and no window where a blocked user holds a valid session"
    - "Split-plane Clerk verification: writes via Backend API + secret key; flag read-back via Frontend API /v1/environment + publishable key (the Backend API has no GET for restrictions)"
    - "Idempotent ops script: diff-then-create, duplicates treated as success, safe to re-run; --verify-only doubles as a CI/ops health check with a 0/1 exit code"
key-files:
  created:
    - scripts/33-clerk-restrictions-config.mjs
  modified: []
key-decisions:
  - "Read restriction flags from the Frontend API /v1/environment — the Backend API GET /v1/instance/restrictions does not exist (405, PATCH-only)"
  - "Enumerate 9 gmx.* TLDs to approximate the code-side startsWith('gmx.') wildcard — Clerk's blocklist accepts only literal identifiers"
  - "process.exitCode, never process.exit(), in fetch-based Node scripts on Windows (libuv assertion with an in-flight socket)"
patterns-established:
  - "Mirror-warning comment on any duplicated domain/config list, naming the source-of-truth file"
duration: ~35min
completed: 2026-07-14
---

# Phase 33 Plan 03: Clerk Restrictions Configuration Summary

**Personal-email signups are now rejected by Clerk itself at the sign-up form on the employers app — 3 restriction flags true and all 35 blocklist identifiers live — applied and read-back-verified by a reusable idempotent ops script.**

## Performance

- **Duration:** ~35 min (Task 1 build + live read-only verification; Task 2 applied by operator)
- **Tasks:** 2/2
- **Files created:** 1

## Live End State (verified by read-back, not assumed from a 200)

Instance `ins_3EE0Dfymg1UUPmZeEKywfw98JkB` — Frontend API host `clerk.employers.internjobs.ai`.

| Item | State |
| --- | --- |
| `blocklist` | `true` |
| `block_disposable_email_domains` | `true` (Clerk's own curated, auto-updating disposable list) |
| `block_email_subaddresses` | `true` (blocks `joe+foo@gmail.com` gaming) |
| Blocklist identifiers | **35 / 35 target domains present** |

Task 2 apply totals: `35 target domains | created: 9 | already present: 26 | failed: 0`, then `--verify-only` → `FULLY CONFIGURED (0 missing)`, exit 0.

**Notable finding:** the `67f69e0` config **survived the `startups` → `employers` rename** — same underlying Clerk instance. Before the apply, all 3 flags were already `true` and all 26 `workEmail.ts` domains were already blocklisted. The only real gap was the 9 `gmx.*` TLDs, which that earlier config never enumerated. The idempotency requirement is exactly what made this safe to re-run and cheap to discover.

## What Shipped

**`scripts/33-clerk-restrictions-config.mjs`** — plain Node ESM, zero new deps, native `fetch` + `AbortSignal.timeout(10000)` on every call.

- **Secret:** `process.env.STARTUPS_CLERK_SECRET_KEY` first (so it composes with `infisical run --projectId 26995afd-… --env prod --path /internjobs-ai --`), else shells out to `infisical secrets get`. Fails fast (exit 2) if neither yields a value. **Never printed**, and the Infisical stderr is deliberately swallowed rather than echoed.
- **Apply mode (default, idempotent):** `PATCH /v1/instance/restrictions` with the 3 flags, then paginated `GET /v1/blocklist_identifiers` → diff → `POST` only the missing ones. Existing identifiers are matched case-insensitively on the domain portion. A `409`/`422`/"already exists" response is treated as **success, not failure**. Prints a per-domain summary table + totals; non-zero exit only if a domain failed for a reason other than already-existing.
- **`--verify-only` mode:** read-only. GETs current state, reports flags + which target domains are present/missing, exit `0` fully configured / `1` anything missing — so it doubles as a CI/ops health check.

Domain list: the **26 domains mirrored exactly** from `apps/startup/workers/lib/workEmail.ts` `BLOCKED_DOMAINS` (verified by a programmatic diff of both files — 26/26 match, zero drift, no guessing) **plus 9 `gmx.*` TLDs** = 35 identifiers.

## Deviations from Plan

### 1. [Rule 1 — Bug in the plan's API contract] `GET /v1/instance/restrictions` does not exist

**This is the most important thing in this document.**

The plan (and its `must_haves.key_links`) specified `GET /v1/instance/restrictions` for the verify path. **That endpoint returns HTTP 405 — it is PATCH-only.** Clerk's Backend API exposes **no GET for instance restriction flags at all**; `GET /v1/instance` returns only `{id, object, environment_type, allowed_origins}`, with no restrictions.

The flags **are** readable, but only from the instance's **Frontend API**:

```
GET https://clerk.employers.internjobs.ai/v1/environment?__clerk_api_version=2021-02-05&_clerk_js_version=5.0.0
  -> user_settings.restrictions.<flag>.enabled : boolean
```

Public, unauthenticated, read-only. The FAPI host is base64-encoded inside the publishable key (`pk_live_<base64("<host>$")>`), so the script decodes it from `STARTUPS_NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` rather than hardcoding it.

So the script is **split-plane**: writes go to the Backend API with the secret key; flag read-back goes to the FAPI with the publishable key; blocklist identifiers use the Backend API for both read and write. Apply mode re-reads the flags from the FAPI *after* the PATCH rather than trusting the PATCH response body.

> **⚠️ Plan 33-05, read this.** Your "verified live" step would otherwise have rested on an endpoint that 405s — it would have failed, or worse, been coded to swallow the failure and report a false pass. Use the FAPI `/v1/environment` read (or just invoke `node scripts/33-clerk-restrictions-config.mjs --verify-only`, which is exactly this check with a 0/1 exit code).

- **Found during:** Task 1 (first live `--verify-only` run, which died on the 405)
- **Verification:** probed `/instance`, `/instance/restrictions`, `/blocklist_identifiers` and the FAPI environment endpoint directly; only the FAPI returns the flags
- **Committed in:** `458535a`

### 2. [Rule 1 — Bug] `process.exit()` → `process.exitCode` (libuv assertion on Windows)

Calling `process.exit(code)` while a `fetch` socket is still closing trips `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), file src\win\async.c, line 76` and returns **exit 127** instead of the intended code — which would silently poison any CI gate keying on the exit status. Switched to setting `process.exitCode` and letting the event loop drain; `assertOk()` now **throws** (caught by `main().catch`) instead of hard-exiting mid-request.

- **Found during:** Task 1 (first live run crashed with 127)
- **Committed in:** `458535a`

---

**Total deviations:** 2 auto-fixed (2 × Rule 1 — bug). Both were necessary for the script to function at all; no scope creep. Only `scripts/33-clerk-restrictions-config.mjs` was touched (matches plan frontmatter `files_modified` exactly — no drift).

## The `gmx.*` Nuance (maintenance hazard — read before editing either list)

`workEmail.ts` matches gmx **generically**: `domain === "gmx" || domain.startsWith("gmx.")` — every gmx country TLD, forever. **Clerk's blocklist accepts only literal identifiers; there is no TLD wildcard.** This is the one place the two lists genuinely cannot be expressed the same way.

The script therefore **enumerates 9 common TLDs** — `gmx.com, gmx.de, gmx.net, gmx.at, gmx.ch, gmx.co.uk, gmx.us, gmx.fr, gmx.es` — to *approximate* the code-side match. An exotic gmx TLD (say `gmx.hu`) would pass Clerk's sign-up form but is **still caught by the Worker-side `isPersonalEmailDomain()`** on the Voice AI `register_startup` path. Defense-in-depth holds; the Clerk-side approximation is the deliberately-accepted gap.

**Mirror rule (a comment to this effect is in the script):** if you add or remove a domain in `apps/startup/workers/lib/workEmail.ts` `BLOCKED_DOMAINS`, **you must mirror it into `scripts/33-clerk-restrictions-config.mjs`** and re-run the script. The two lists drift silently otherwise — nothing enforces this at build time today.

## Issues Encountered

Both live blockers (the 405 and the libuv crash) are written up under Deviations. Nothing else; the paginated blocklist GET, the diff, and the duplicate-tolerant POST all behaved as designed on the real API.

## Next Phase Readiness

- **33-05 can proceed.** The Clerk-side work-email gate is live and read-back-verified. `STARTUPS-EMPLOYERS-WORK-EMAIL-01` evidence is the apply + `--verify-only` transcripts above. **Use the FAPI read (or `--verify-only`), not `GET /v1/instance/restrictions`.**
- **Re-running is free.** `node scripts/33-clerk-restrictions-config.mjs --verify-only` is read-only and exits 0/1 — safe to wire into ops/CI as a drift alarm.
- **Open (low): no build-time guard** ties the script's domain list to `workEmail.ts`. A cross-package invariant check (in the spirit of 33-04's `check-email-timeout-invariant.mjs`) would close the drift hazard permanently. Not blocking.
- **No `STATE.md` update:** this repo's `.planning/` is in team mode (`team-mode.json`, no `STATE.md` anywhere) — consistent with 33-01/33-02.

---
*Phase: 33-startups-web-app-golive*
*Completed: 2026-07-14*
