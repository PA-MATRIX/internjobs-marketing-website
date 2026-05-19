---
phase: 16-admin-invite-ux
plan: "01"
subsystem: api
tags: [clerk, phone-otp, hono, cloudflare-workers, kv, email, feature-flags]

# Dependency graph
requires:
  - phase: 10-parrot-employee-workspace
    provides: "POST /api/admin/employees scaffolding, Clerk helper, sendWelcomeEmail, WorkspaceDO directory"
  - phase: 13-realtime-push-and-flags
    provides: "PARROT_FEATURE_FLAGS KV binding + getFeatureFlags fallback contract"
provides:
  - "createClerkUser extended with optional phoneNumber → phone-OTP enrollment (no email_address sent)"
  - "POST /api/admin/employees accepts firstName / lastName / phoneNumber (E.164) / featureFlags — all optional, backward compatible"
  - "GET /api/admin/employees/:id/flags — returns default-merged-with-KV capability flags"
  - "PATCH /api/admin/employees/:id/flags — read-modify-write merge so partial PATCH is safe"
  - "Welcome email rewritten in Ridhi's voice (mission narrative + phone-OTP instructions) with operator-personalized From"
  - "Capability flag defaults (email/chat/meetings/phone/sms/campaigns = true) seeded into KV on invite"
affects: [16-02-admin-invite-ux-frontend, 17-onboarding-experience, 18-workspace-rollout]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Phone-OTP Clerk enrollment via phone_number identifier (sibling to existing email-OTP path)"
    - "Read-modify-write KV merge for partial-PATCH flag updates (no clobber of unsent keys)"
    - "Hono route order: /:id/flags BEFORE /:id to dodge colon-segment greediness"
    - "Operator-personalized From + signature (c.var.employee.email → email From)"

key-files:
  created: []
  modified:
    - "apps/parrot/workers/lib/clerk-admin.ts — phoneNumber + E.164 validation + phone_numbers[] in ClerkUser"
    - "apps/parrot/workers/lib/email.ts — Ridhi-voice copy, inviterName/inviterEmail/phoneNumber inputs, personalized From"
    - "apps/parrot/workers/routes/admin-employees.ts — InviteSchema extension, KV write, GET + PATCH /:id/flags"

key-decisions:
  - "Phone-OTP path mutually exclusive with email-OTP — never send both identifiers to the same Clerk POST body (Parrot workspace Clerk app is phone-only)"
  - "E.164 validated in BOTH the route (Zod) AND the helper (runtime regex) — defense in depth so any direct call to createClerkUser stays safe"
  - "Default flags all-on; PATCH does read-modify-write so partial body never clobbers unsent toggles"
  - "When phoneNumber omitted, welcome email retains legacy email-OTP narrative — preserves backward compat for any existing /api/admin/employees POST caller"
  - "KV write is best-effort (try/catch + console.warn) — a missing KV binding never blocks the invite; GET /:id/flags falls back to DEFAULT_FLAGS"

patterns-established:
  - "Two-stage validation for E.164: Zod regex at API boundary, second regex check inside helper — keeps helper safe even when called from a future route that forgets the schema"
  - "Hono route registration order: specific colon-suffixed segments (`/:id/flags`) MUST precede the bare `/:id` handler, otherwise the bare handler swallows the prefix"
  - "From-identity derivation from operator session (c.var.employee.email) → personalized invite emails (Ridhi, not noreply@)"

# Metrics
duration: 3m 37s
completed: 2026-05-19
---

# Phase 16 Plan 01: Ridhi Admin Invite UX — Wave 1: Backend Summary

**Parrot worker backend now supports phone-OTP employee invites with 6 capability toggles (default all-on) persisted to KV on invite, and a welcome email signed by the operator with phone-OTP login instructions.**

## Performance

- **Duration:** 3m 37s
- **Started:** 2026-05-19T18:57:28Z
- **Completed:** 2026-05-19T19:01:05Z
- **Tasks:** 3
- **Files modified:** 3

## Accomplishments
- `createClerkUser` accepts optional `phoneNumber` (E.164-validated); when present, the Clerk POST body uses `phone_number: [phoneNumber]` and omits `email_address` entirely — matches the Parrot Clerk app's phone-OTP-only configuration.
- `POST /api/admin/employees` accepts `firstName`, `lastName`, `phoneNumber`, and `featureFlags` (all optional) — legacy callers that POST only `{ name, personalEmail }` continue to receive 201 with default-all-on flags.
- New `GET /api/admin/employees/:id/flags` and `PATCH /api/admin/employees/:id/flags` endpoints, backed by KV key `employee:{clerk_user_id}:flags`. PATCH uses read-modify-write so a partial body like `{ chat: false }` only flips chat — the other 5 toggles stay intact.
- Welcome email rewritten with Ridhi's voice (mission narrative + first-person signature) and operator-personalized From (`c.var.employee.email` falls back to `ridhi@internjobs.ai`). Phone-OTP login copy when `phoneNumber` is set; legacy email-OTP copy when absent.
- TypeScript clean (`tsc --noEmit -p apps/parrot/tsconfig.json` → 0 errors); Vite build clean.

## Task Commits

Each task was committed atomically:

1. **Task 1: Extend clerk-admin.ts with phone-OTP Clerk user creation** — `975210b` (feat)
2. **Task 2: Rewrite welcome email with Ridhi's voice + phone-OTP login instructions** — `a1fc21e` (feat)
3. **Task 3: Extend POST /api/admin/employees + add PATCH /:id/flags** — `8e69250` (feat)

## Files Created/Modified
- `apps/parrot/workers/lib/clerk-admin.ts` — `ClerkUserCreateInput.emailAddress` made optional; `phoneNumber` field added; E.164 regex (`/^\+[1-9]\d{7,14}$/`) enforced inside the helper; `ClerkUser.phone_numbers[]` added; identifier selection is mutually exclusive (phone OR email, never both).
- `apps/parrot/workers/lib/email.ts` — `WelcomeEmailInput` gains `inviterName`, `inviterEmail`, `phoneNumber` (all optional); From address pulled from `inviterEmail`; subject now "You're joining InternJobs — here's how to get in"; HTML + text bodies rewritten with mission narrative and phone-OTP login copy.
- `apps/parrot/workers/routes/admin-employees.ts` — `InviteSchema` extended with optional firstName/lastName/phoneNumber/featureFlags; `DEFAULT_FLAGS` constant + shared `FeatureFlagsObject` Zod partial; POST writes flags to KV after `createEmployee`; welcome email call site derives operator identity from `c.var.employee`; new GET + PATCH `/:id/flags` registered BEFORE DELETE `/:id` to avoid Hono colon-segment greediness; 201 response now includes `feature_flags`.

## Decisions Made
- **Phone-OTP path is mutually exclusive with email-OTP in the Clerk POST body.** The Parrot Clerk app at clerk.workspace.internjobs.ai is phone-OTP only (per memory `project-auth-architecture.md`); sending both identifiers would either be rejected by Clerk or silently ignore the phone. Identifier selection in `createClerkUser` is a single `?:` ternary that spreads exactly one identifier into the body.
- **E.164 validated in BOTH the route schema AND the helper.** Zod regex at the API boundary (`InviteSchema.phoneNumber`); second regex check inside `createClerkUser`. Defense in depth — any future call site that bypasses the schema (e.g. a script, a future route) still gets validated phone numbers.
- **Default flags all-on; PATCH does read-modify-write.** Operator sends a partial body, we layer it onto the existing KV value (or defaults), persist the merged result. This means `PATCH { featureFlags: { chat: false } }` flips only chat — never accidentally turns off the other 5. KV writes are best-effort (try/catch + console.warn) so a transient KV failure doesn't block the invite.
- **Operator identity flows through the welcome email.** `c.var.employee.email` becomes the `From` address; `c.var.employee.displayName` becomes the signature. Falls back to `ridhi@internjobs.ai` / "Ridhi" when the operator context is missing (e.g. a hypothetical service-account caller without an `employee` var). This means invitees see the invite as a personal note from Ridhi, not a system notification.
- **Route order is load-bearing.** GET + PATCH `/:id/flags` MUST be registered before DELETE `/:id` because Hono's `:id` pattern greedily matches everything up to the next slash. Without the ordering, a request to `/abc/flags` would match `DELETE /:id` with `id = "abc/flags"` and return `not_found`. A comment in the file flags this so future edits don't reorder routes naively.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None — the type checker stayed green through every edit; build succeeded on the first attempt; no Clerk SDK or wrangler config changes needed.

## User Setup Required
None — no new env vars, no new bindings, no dashboard configuration. The `PARROT_FEATURE_FLAGS` KV binding was already wired in Phase 13. The new `/:id/flags` routes degrade gracefully when the binding is absent (return defaults).

## Next Phase Readiness
- **16-02 (Wave 2: Frontend) unblocked.** The frontend can now POST `{ name, personalEmail, firstName, lastName, phoneNumber, featureFlags }` to create a phone-OTP employee, and GET/PATCH `/:id/flags` to render and edit the capability toggle UI.
- **Deploy step deferred.** Plan SC mentions "Worker deploys without error" — build is clean (`npm run build` succeeded); the production deploy via `npx wrangler deploy` was NOT executed in this autonomous run since prod deploys are operator-gated. Build artifacts are ready; deploy is a one-shot `npx wrangler deploy --env=production` from `apps/parrot/`.
- **Smoke-test curl deferred.** Verification section's `curl -s -X POST https://workspace.internjobs.ai/api/admin/employees` smoke depends on a deployed Worker + a valid `__session` cookie; both are outside the autonomous loop. Manual smoke is recommended post-deploy.

---
*Phase: 16-admin-invite-ux*
*Completed: 2026-05-19*
