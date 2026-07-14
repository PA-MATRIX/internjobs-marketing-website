---
phase: 33-startups-web-app-golive
plan: 06
subsystem: employers-auth
tags: [security, clerk, jwt, jwks, jose, cloudflare-pages-functions, fly, auth-bypass, account-takeover, deploy]
requires: ["28.5-02", "28.5-03"]
provides:
  - "verifyClerkToken() — RS256/JWKS cryptographic Clerk session verification in the employers Pages Function"
  - "getVerifiedClerkEmail() — Clerk Backend API verified-email-only lookup"
  - "resolveIdentity() lazy-link fallback (replaces the deleted 28.5-05 webhook)"
  - "empty PASSTHROUGH_ALLOWLIST + mandatory auth gate closing the unauthenticated catch-all"
  - "POST /v1/startups/link-clerk-id — guarded concierge:%-only lazy-link endpoint (Fly)"
  - "11 real-keypair auth-boundary unit tests + 3 live Fly smoke cases"
affects: ["33-07"]
tech-stack:
  added:
    - "jose@^6.2.1 (apps/employers dependency)"
    - "tsx@^4.22.4 (apps/employers devDependency)"
  patterns:
    - "Clerk JWT verified at the Pages Function boundary (createRemoteJWKSet + jwtVerify({issuer}), module-cached) — mirrors apps/parrot/workers/routes/oidc.ts; fails closed on any throw"
    - "Account-takeover guard enforced in SQL, not app logic: UPDATE ... WHERE clerk_user_id LIKE 'concierge:%' can never re-point an already-linked user_... row"
    - "Auth boundary proven live in prod (forged + unauthenticated curls returning 401), not just merged"
key-files:
  created:
    - "apps/employers/functions/api/[[path]].test.ts"
  modified:
    - "apps/employers/functions/api/[[path]].ts"
    - "infra/startup-api/src/index.mjs"
    - "infra/startup-api/smoke.mjs"
    - "apps/employers/package.json"
    - "apps/employers/.env.example"
decisions:
  - "JWT verification lives in the Pages Function, not Fly — it already holds the raw token and CF Workers has WebCrypto+fetch for jose with zero extra runtime deps; moving it to Fly would duplicate secrets for no benefit"
  - "The unauthenticated catch-all bypass (clerkToken could be null and still forward on the shared secret) was closed in the same wave — shipping the JWT fix while leaving an EASIER bypass live would be a partial fix"
  - "npm test uses direct tsx file-exec, not `tsx --test` — node's test-file glob treats the literal [[path]] brackets as a character-class and silently runs 0 tests"
duration: ~95m
completed: 2026-07-14
---

# Phase 33 Plan 06: Security-Critical Auth Fix Summary

Closed a **live authentication-bypass vulnerability** on a public production endpoint (`employers.internjobs.ai/api/*`) together with the founder-onboarding "account not linked" bug — fixing the second without the first would have created an account-takeover primitive. Cryptographic Clerk JWT verification (RS256/JWKS) is now live on **every** `/api/*` path, a guarded lazy-link completes founder onboarding, and both defects plus a second (easier) unauthenticated bypass are proven closed against production, not just merged.

## What Shipped

### 1. Pages Function — real JWT verification replacing `decodeJwtSub()` (`apps/employers/functions/api/[[path]].ts`)

- **Deleted `decodeJwtSub()`** — a base64 payload decode with NO signature check. Any caller could forge a JWT with an arbitrary `sub`, POST it to `/api/me`, and receive that founder's real startup identity.
- **`verifyClerkToken(jwt, env)`** — `jose` `createRemoteJWKSet` + `jwtVerify({ issuer })`, JWKS cached at module scope (keyed by URL). Returns the verified `sub`, or `null` on **any** failure (bad signature, expired `exp`, not-yet-valid `nbf`, wrong issuer, malformed token, or missing env). **Fails closed** — every throw path returns `null` → 401, never allow-through. Mirrors `apps/parrot/workers/routes/oidc.ts::verifyClerkSession`.
- **`getVerifiedClerkEmail(sub, env)`** — hand-rolled Clerk Backend API fetch (`GET /v1/users/{sub}`, no SDK, mirrors `clerk-admin.ts`). Returns the primary email only if `verification.status === 'verified'`, else `null`. Called only from the lazy-link branch → zero added latency on the hot path.
- **`resolveIdentity()`** — verifies the JWT first; on a 404 from `identity-by-clerk-id`, resolves the verified email and fires exactly one lazy-link round-trip. Any link failure (guard tripped / no match / bad JSON) surfaces the **original 404** — a guard rejection is never treated as a bypass or silent success.
- **Second bypass closed:** the router's catch-all fallback previously forwarded to Fly with `clerkToken` possibly `null`, authenticated only by the shared `STARTUP_API_SECRET` — an anonymous caller could reach `POST /v1/search/candidates`, `PATCH /v1/roles/:id`, etc. The router now requires a verified session (`missing_clerk_token`/`invalid_clerk_token` → 401) **before** any forward, and `handlePassThrough` is gated by an explicit, currently-**EMPTY** `PASSTHROUGH_ALLOWLIST` (`new Set([])`); the dead `clerkToken`/`X-Clerk-Token` plumbing was dropped.

### 2. Fly — guarded lazy-link endpoint (`infra/startup-api/src/index.mjs`)

- **`POST /v1/startups/link-clerk-id`** — flips a `concierge:<hex>` placeholder to the real Clerk id for the row matching by caller-verified email. The load-bearing guard is the SQL itself:
  ```
  UPDATE startup_members SET clerk_user_id = $1, updated_at = now()
   WHERE id = ( SELECT id FROM startup_members
                 WHERE lower(email) = lower($2)
                   AND clerk_user_id LIKE 'concierge:%'
                 ORDER BY created_at ASC LIMIT 1 )
  ```
  An already-linked (`user_...`) row is **architecturally unable** to be re-pointed, even by a different verified session presenting a matching email. Rejects a placeholder incoming id; `23505` → 409; no-match → 404 (email-existence is intentionally not leaked).
- Corrected **both** stale comments (`identity-by-clerk-id` doc + `synthClerkUserId()`) that claimed the deleted 28.5-05 webhook performs linking; added the endpoint to the file-header API surface list.

### 3. Tests + live proof

- **`apps/employers/functions/api/[[path]].test.ts`** — 11 `node:test` (via `tsx`) cases, **all using real `jose` generated RSA keypairs — no mocked crypto**: forged-signature/expired/wrong-issuer → 401 with zero Fly forwards; genuine session resolves with zero Clerk Backend API calls; lazy-link on first sign-in; idempotent second sign-in; guard-tripped 404; missing-auth 401; unauthenticated + forged-token non-mapped path → 401 with zero forwards; cross-startup `startup_id` spoof proving the server-resolved `startup_id` wins.
- **`infra/startup-api/smoke.mjs`** — added `[10]` happy-path flip, `[10b]` post-link resolve, `[10c]` live takeover-guard rejection.

## Verification (all green)

| Check | Result |
|---|---|
| 11 unit tests (`npm test`, real keypairs) | **11/11 pass**, exit 0 |
| Live Fly smoke (incl. 3 new link-clerk-id cases) | **16/16 PASS, 0 FAIL** |
| `[10c]` live account-takeover guard (same email, new id) | **404 `no_linkable_member_found`** |
| Playwright unauthenticated subset (prod) | 2 passed, 1 skipped, 0 failed |
| PROOF 1 — forged JWT `/api/me` (prod) | **HTTP 401** `{"error":"identity_lookup_failed","detail":"invalid_clerk_token"}` |
| PROOF 2 — no-auth `/api/search/candidates` (prod) | **HTTP 401** `{"error":"missing_clerk_token"}` |
| SPA root serves + Function boots | root 200 text/html; `/api/me` no-auth → 401 |

## Deploy

- Pages secrets `STARTUPS_CLERK_JWKS_URL`, `STARTUPS_CLERK_ISSUER`, `STARTUPS_CLERK_SECRET_KEY` uploaded to `internjobs-employers` (production) via `wrangler pages secret put`, `CLOUDFLARE_ACCOUNT_ID=0fffd3dc…` inlined on every command.
- `internjobs-employers` Pages deployed (`✨ Compiled Worker successfully` — the Functions bundle was accepted by workerd, not merely uploaded).
- `internjobs-startup-api` Fly deployed; both machines reached good state; `/health` → 200.

## Deviations from Plan

- **`package-lock.json` (root)** — modified as an unavoidable side-effect of `npm install` adding `jose` (Task 2) and `tsx` (Task 3). Not in the plan's `files_modified`; committed alongside the deps that required it. (Rule 3 — blocking.)
- **`VITE_CLERK_PUBLISHABLE_KEY` exported for the build** — the plan's deploy line ran `npm run build` without it, but `src/main.tsx` renders `ClerkProvider publishableKey=""` when it's absent, which would have shipped a broken sign-in to the live go-live site. Sourced it from Infisical `STARTUPS_NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` (guarded `pk_*`) and exported it for `vite build` per the `.env.example` convention; verified the key is baked into the bundle. No file change — deploy-time only. (Rule 3 — blocking.)
- **`npm test` script uses direct `tsx` file execution**, not the plan's `tsx --test "…[[path]]…"`. Node's test-file glob interprets the literal `[[path]]` brackets as a character-class and silently ran **0 tests** (a green-but-empty hazard). Direct execution runs all 11 and still exits non-zero on failure (both verified). (Rule 3 — blocking.)
- **Worktree base alignment (environment):** this worktree was created on a fresh branch at `main`, not on `rrr/v1.5/team-workspace-33` as briefed. Since the branch had zero unique commits and the three code files this plan edits were byte-identical between `main` and `team-workspace-33` (plan `depends_on: []`), the branch was reset to the intended base so the phase-33 directory/plan/prior SUMMARYs were present. Task commits stack cleanly on top for the coordinator to reconcile.

## Notes for 33-07 / coordinator

- No `STATE.md` exists in this `.planning/` layout (it uses `config.json` / `HANDOFF.md`), so no STATE.md update was made.
- The three `STARTUPS_CLERK_*` values are now bound to the `internjobs-employers` Pages project (production) and must remain set — the Pages Function fails closed (401) without them.
