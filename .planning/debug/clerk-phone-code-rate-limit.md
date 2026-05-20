# Debug: Clerk phone-code request throttle

## Status

MITIGATED in production code.

## Symptom

The employee sign-in screen can show Clerk's phone verification throttle:

`Too many verification code requests. Please wait at least 30 seconds to receive your code before trying again.`

## Root Cause

This is Clerk's provider-side anti-spam throttle. Parrot cannot safely remove that server-side protection from application code.

The previous stock Clerk widget made it easy for a user to trigger multiple code sends while waiting, which made the throttle look like a login failure.

## Fix

`apps/parrot/app/routes/login.tsx` now renders a custom phone-code flow backed by Clerk's `useSignIn` API. Clerk remains the auth provider; Parrot only controls the UI around Clerk.

The custom flow:

- accepts US phone numbers with or without `+1`
- sends the code through Clerk
- verifies the code through Clerk
- sets the Clerk session through `setActive`
- stores a local 35-second resend cooldown per phone number to prevent repeated code requests

The login copy now explicitly says the phone verification is Clerk-backed so the native UI is not mistaken for removing Clerk.

## Verification

- Browser check on `https://workspace.internjobs.ai/sign-in?redirect_url=%2Fchat` showed the custom phone-code form.
- Repo search confirms Clerk is still mounted through `ClerkProvider`, worker auth still verifies Clerk JWTs, and protected APIs still depend on the authenticated Clerk employee context.

## Clerk CLI Check

Checked Clerk CLI access with `clerk whoami`; authenticated as `rraj@growthpods.io`.

Production app inspected:

- application: `Internjobs Workspace`
- production instance: `ins_3DvFMadizDiF09mVBG31rgw74Eu`
- domain publishable key maps to `clerk.workspace.internjobs.ai`

Ridhi lookup results:

- phone lookup for `[redacted verified phone]` returns one user, `Ridhi Rentala`
- phone is the primary identifier
- phone verification status is `verified`
- user is not banned
- user is not locked
- `verification_attempts_remaining` is 5
- public metadata includes `role: ceo`, `title: CEO`, `workspace_email: ridhi@internjobs.ai`
- email lookup initially returned no Clerk email identifier in this employee app

## Admin Email Add

Updated Clerk production config to permit email identifiers and email-code sign-in while keeping phone-code sign-in enabled.

Attached `ridhi@internjobs.ai` to the existing Ridhi Clerk user, not a duplicate user:

- user id: `user_3DvOELvczcR9tk0rAC5b4FjgUbQ`
- primary verified email id: `idn_3DyDhPSH4yfsvHaa1VWueOfZNjd`
- primary phone remains: `[redacted verified phone]`
- public metadata remains `role: ceo`, which the Parrot operator gate treats as admin-capable

Updated `apps/parrot/app/routes/login.tsx` so the sign-in form accepts either:

- a phone number such as `[redacted local phone]` / `[redacted verified phone]`
- a workspace email such as `ridhi@internjobs.ai`

The code flow still uses Clerk `useSignIn`, selects `phone_code` or `email_code` based on the identifier, and keeps the resend cooldown.

Deployed Parrot worker version `009fa4dc-448c-4df6-81e7-717f103b205a`.

## Session Durability Follow-up

GSD verification showed the browser could have an active Clerk client session while Parrot API calls still returned `401` if the `__session` cookie was not present yet. Clerk CLI confirmed Ridhi had active sessions, and a freshly minted Clerk session token succeeded against `GET /api/me`.

Patch:

- `apps/parrot/app/lib/api.ts` now attaches a fresh Clerk bearer token from `window.Clerk.session.getToken()` to Parrot API calls when available.
- Parrot already accepted `Authorization: Bearer <Clerk JWT>` in `workers/app.ts`, so the server auth path did not need a protocol change.
- Direct app API fetches in admin, dashboard, safety, shell safety badge, and chat membership now use the token-aware `apiFetch` helper.

Privacy/UI patch:

- Login placeholder no longer contains Ridhi's real phone number.
- Login code-sent text says `your phone number` for phone OTP instead of echoing the number.
- The left-rail user menu no longer displays phone identifiers; it shows workspace email when available or `Workspace account`.

Deployed Parrot worker version `f9146b4f-aae8-42a5-aa1b-710df9a5608a`.

GSD verification after deploy:

- `/chat` loaded as Ridhi with admin/safety links visible.
- Clerk client session active and both `__session` and scoped session cookies present after reload.
- User menu page source contained `Ridhi Rentala`, `ridhi@internjobs.ai`, and `Operator`.
- User menu page source did not contain `[redacted verified phone]` or `[redacted local phone]`.
- `GET /api/me` with a fresh Clerk bearer token returned `ridhi@internjobs.ai`, `Ridhi Rentala`, and role `operator`.

Instance config:

- `auth_phone.used_for_sign_in: true`
- `auth_phone.sign_in_strategies: ["phone_code"]`
- `auth_email.used_for_sign_in: true`
- `auth_email.sign_in_strategies: ["email_code"]`
- allowlist and blocklist are empty

Conclusion: Clerk user/config now support both phone OTP and email-code sign-in for Ridhi. If SMS still does not arrive, use `ridhi@internjobs.ai` as the sign-in identifier to receive an email code.
