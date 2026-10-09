---
phase: 32-parrot-embed-pane
plan: "01"
subsystem: workspace-worker
tags: [jwt, jose, rs256, oidc, embed, parrot, cloudflare-workers, identity]

# Dependency graph
requires:
  - phase: 10/oidc-bridge
    provides: OIDC_SIGNING_KEY (RS256 PKCS8) + OIDC_PUBLIC_JWK + /oidc/jwks + signIdToken pattern
  - phase: 10/operator-gate
    provides: isOperator()/hasOperatorAccess() — the single operator-role source
provides:
  - mintEmbedToken() — pure RS256 embed-JWT signer (aud=parrot-embed, exp~120s, sub+email always present)
  - POST /api/embed/parrot-token — authenticated Worker route that wires employee identity + isOperator into a signed token
  - Env.PARROT_EMBED_URL (wrangler var) + Employee.phoneNumber (surfaced from Clerk claims)
affects:
  - 32-02 the iframe pane itself (fetches this endpoint, loads PARROT_EMBED_URL?token=<JWT>)
  - 32-03 badges/root wiring

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Reuse the existing OIDC_SIGNING_KEY / OIDC_PUBLIC_JWK pair (same key /oidc/jwks publishes) for a second token type — no new key to provision or rotate"
    - "Pure jose SignJWT signer module (no Hono/DO coupling) → directly unit-testable with real generated keypairs"
    - "Server-only claim sourcing: sub/email/role from c.var.employee + isOperator, never request body/query"

key-files:
  created:
    - apps/parrot/workers/lib/embed-jwt.ts
    - apps/parrot/workers/tests/lib/embed-jwt.test.ts
    - apps/parrot/workers/tests/routes/embed-token.test.ts
  modified:
    - apps/parrot/workers/index.ts
    - apps/parrot/workers/types.ts
    - apps/parrot/workers/app.ts
    - apps/parrot/wrangler.jsonc

key-decisions:
  - "Reuse OIDC_SIGNING_KEY rather than mint a second key — Parrot is already configured to fetch https://workspace.internjobs.ai/oidc/jwks; a second key would silently fail verification on Parrot's side"
  - "mintEmbedToken fails closed by throwing (not emitting a malformed token) on missing key or empty sub/email — the defense-in-depth backstop for Parrot's unconditional sub+email contract"
  - "role is derived ONLY from the existing isOperator() gate (admin vs employee); no second admin allowlist invented"
  - "PARROT_EMBED_URL is a wrangler var (not a secret) — only the short-lived token in the query string is sensitive; it is Omitted from CfEnvBase AND redeclared on Env to avoid the wrangler-types literal-type collision"

patterns-established:
  - "Embed-JWT round-trip is unit-verified against a createLocalJWKSet built in the exact shape /oidc/jwks serves — the closest a unit test gets to 'verifies against our own live JWKS' without a network call"
  - "Negative-key test proves the signature is meaningful (token does NOT verify against an unrelated keypair)"

# Metrics
duration: ~25min
completed: 2026-07-15
---

# Phase 32 Plan 01: Parrot Embed-JWT Mint Endpoint Summary

Built the Workspace half of the Phase-32 embed handshake: a signed short-lived
JWT the browser passes to `https://parrot.projecta.ai/embed?token=<JWT>`. This
is pure backend (the Workspace Worker in `apps/parrot/workers/`) — no UI — so it
was built, unit-tested, and verified in complete isolation from the 32-02 pane
work that depends on it.

## What Shipped

**Task 1 — `mintEmbedToken()` signer + real-crypto tests** (`4b6cf92`)
- `apps/parrot/workers/lib/embed-jwt.ts`: a pure module (no Hono, no DO) exporting
  `mintEmbedToken`, `EMBED_TOKEN_AUDIENCE` (`"parrot-embed"`), `EMBED_TOKEN_TTL_SECONDS` (`120`).
  It mirrors `signIdToken` in `workers/routes/oidc.ts` exactly: `importPKCS8(env.OIDC_SIGNING_KEY, "RS256")`
  + `jose.SignJWT`, with `kid` resolved from `OIDC_PUBLIC_JWK` so `/oidc/jwks` lookups match.
- Claims minted: `iss` (supplied issuer), `aud:"parrot-embed"`, `sub`, `email` (trimmed+lowercased),
  `name`, `phone` (only when present), `role`, `iat`, `exp = iat + 120`, `jti` (random UUID).
- Fails closed by throwing on: missing `OIDC_SIGNING_KEY`, empty `sub`, empty `email`.

**Task 2 — route + wiring + smoke test** (`207c8ea`)
- `POST /api/embed/parrot-token` in `workers/index.ts`, gated by `requireEmployeeMailbox`.
  `sub`/`email`/`name`/`phone`/`role` are read ONLY from `c.var.employee` (+ `hasOperatorAccess`);
  nothing is taken from the request body or query. Returns `{ token, expires_in, embed_url, role }`.
  Fails closed with `503 embed_not_configured` when `OIDC_SIGNING_KEY` is absent; `500` on mint error.
- `Env.PARROT_EMBED_URL` added (and Omitted from `CfEnvBase` to dodge the `wrangler types`
  literal-vs-`string` collision, following the `GRAPH_API_URL`/`STUDENT_API_URL` pattern).
- `Employee.phoneNumber` added; `app.ts::deriveEmployeeFromClaims` now attaches the
  `phoneNumber` it already computed but previously discarded.
- `wrangler.jsonc` carries the default `PARROT_EMBED_URL: "https://parrot.projecta.ai/embed"`.

## Security invariants (held, not weakened)
- `sub`/`email`/`role` come solely from the server-side authenticated session + `isOperator()`.
  A caller cannot mint a token for another user or self-escalate to `role:"admin"`.
- Signs with the existing `OIDC_SIGNING_KEY` and `kid` from `OIDC_PUBLIC_JWK` — no second key.
- `sub`+`email` are structurally guaranteed non-empty (mint throws; route only passes
  `employee.employeeId`/`employee.email`, both non-empty by the `Employee` contract).

## Verification (real crypto, not mocked)
- `npm test -- embed-jwt` → **11/11 pass**. Tests generate a throwaway RS256 keypair, feed the
  PKCS8 private half as `OIDC_SIGNING_KEY` and the public JWK (with a `kid`) as `OIDC_PUBLIC_JWK`,
  then verify minted tokens via `jose.jwtVerify` against a `createLocalJWKSet({keys:[jwk]})` in the
  exact shape `/oidc/jwks` serves. Covers: round-trip claim equality (email lowercased), `exp-iat===120`,
  `aud`/`iss`, `jti` uniqueness across two mints, `role` passthrough (admin + employee), throws on
  missing key / empty sub / empty email, phone-omission, and — the negative test — verify FAILS against
  an unrelated keypair (proving the signature is meaningful, not a false-positive round-trip).
- `npm test -- embed-token` → **1/1 pass** (route mounted, not 404).
- `npm test` (full suite) → **89/89 pass, 18 files, zero regressions**.
- `npm run typecheck` → **exit 0, zero TS errors**. The run regenerated `worker-configuration.d.ts`
  (gitignored) via `cf-typegen`; `PARROT_EMBED_URL` appears there as a literal but the `CfEnvBase`
  Omit + `Env` redeclaration keeps it a clean `string` with no collision.

Not deployed (per plan): no `wrangler deploy`, no secrets touched. The live-JWKS round trip
(Parrot fetching our real `/oidc/jwks` and accepting the token) is 32-02's manual/chrome step.

## Deviations from Plan
None — plan executed exactly as written. One extra (non-required) test case was added
(`omits phone claim when phone is not provided`) alongside the 10 mandated cases; still within
the plan's `embed-jwt.test.ts` artifact. `apps/parrot/worker-configuration.d.ts` is regenerated
by `cf-typegen` during typecheck but is gitignored, so it is not part of the commit.

## Notes for the coordinator
- This worktree started at `13b0a5e` (2 doc commits behind `rrr/v1.5/team-workspace-32`);
  I fast-forwarded to `05e3ac8` (docs-only, linear) to obtain the plan, then committed the two
  task commits on top. Branch here is `worktree-agent-a2bcf843ba0173bc1`.
- `apps/parrot` is excluded from the root npm workspaces (`!apps/parrot`), so its `node_modules`
  had to be installed locally (`npm install` in `apps/parrot`) before tests could run.
