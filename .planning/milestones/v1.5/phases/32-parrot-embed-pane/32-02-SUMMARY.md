---
phase: 32-parrot-embed-pane
plan: "02"
subsystem: workspace-frontend
tags: [parrot, embed, iframe, postmessage, csp, telnyx, sip, react-router, webrtc]

# Dependency graph
requires:
  - phase: 32-01
    provides: POST /api/embed/parrot-token (mint endpoint) + Env.PARROT_EMBED_URL + Employee.phoneNumber
  - phase: 10/root-shell
    provides: root.tsx AppShell (the never-unmounting node), useCurrentEmployee(), WorkspaceShell
  - phase: 31/chat-pane
    provides: playChatChime AudioContext pattern + chat-unread-change CustomEvent pattern (both mirrored, not imported)
provides:
  - ParrotEmbedPane — root-mounted, never-unmounting Parrot iframe (token lifecycle + origin-checked postMessage bridge)
  - app/lib/parrot-embed.ts — pure, framework-free embed helpers (origin check, message parsers/builders, src builder)
  - api.mintParrotEmbedToken() + ParrotEmbedTokenResponse
  - CSP frame-src header on every Worker response (permits the embed)
  - PARROT_BADGE_CHANGE_EVENT / PARROT_DIAL_REQUEST_EVENT window-event contract for 32-03
affects:
  - 32-03 badge/dial wiring — WorkspaceShell listens for parrot-badge-change; a dispatcher fires parrot-dial-request (the listener already exists here)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Persistent, root-mounted iframe positioned over a [data-parrot-embed-slot] marker via getBoundingClientRect — survives client-side navigation (display:none, never unmount) without restructuring routes.ts into a nested layout"
    - "Token rotation WITHOUT src reload: src set once (srcSetRef guard); fresh tokens pushed via postMessage every ~90s to keep the Telnyx SIP registration alive"
    - "Origin-checked postMessage bridge — isTrustedParrotOrigin(event.origin) gates EVERY branch before event.data is touched; pure logic split into app/lib for node-Vitest testability"
    - "Minimal CSP: frame-src ONLY (no default-src/script-src) so the embed is permitted without risking Clerk inline scripts/frames"

key-files:
  created:
    - apps/parrot/app/lib/parrot-embed.ts
    - apps/parrot/app/components/ParrotEmbedPane.tsx
    - apps/parrot/workers/tests/lib/parrot-embed.test.ts
    - apps/parrot/workers/tests/csp-header.test.ts
  modified:
    - apps/parrot/app/lib/api.ts
    - apps/parrot/app/root.tsx
    - apps/parrot/app/routes/phone.tsx
    - apps/parrot/app/routes/sms.tsx
    - apps/parrot/workers/app.ts

key-decisions:
  - "Mount ParrotEmbedPane in root.tsx AppShell as a sibling of <Outlet/> (mirrors OnboardingWizard) — AppShell is the one node that survives client-side navigation; the iframe never unmounts, only display:none toggles. Restructuring routes.ts into a nested layout was explicitly out of scope (would touch 9 unrelated route files)"
  - "src is set exactly once (srcSetRef); refresh re-mints every ~90s and postMessages the new token — a src change would reload the iframe and drop the Telnyx SIP registration + kill inbound calls"
  - "iframe carries allow=\"microphone; autoplay\" — without it Telnyx WebRTC getUserMedia is denied and every call fails silently"
  - "CSP scoped to frame-src ONLY (derived from PARROT_EMBED_URL), registered before the Clerk middleware so it wraps every response; NO default-src, so Clerk is not at risk"
  - "Ringtone is a distinct looping two-tone (C5/E5 brr-brr) built on ChatPane's AudioContext pattern but NOT imported from it (playChatChime isn't exported) — audibly different from the chat chime"

patterns-established:
  - "Slot-position sync resilient to route code-splitting: rAF-poll for the slot (up to 30 frames) then attach a ResizeObserver + window resize/scroll listeners"
  - "CSP header proven via an integration test that calls the real worker.fetch on /api/health (no auth) and asserts frame-src present + NO default-src/script-src — a repeatable offline proxy for the manual curl + Clerk-console check"

# Metrics
duration: ~40min
completed: 2026-07-16
---

# Phase 32 Plan 02: Parrot Embed Pane Summary

Built the user-visible half of the Parrot embed: the persistent `<iframe>` an
employee sees on `/phone` and `/sms`, its token lifecycle, its origin-checked
postMessage bridge, and the CSP header that lets the browser embed it at all.
This consumes the mint endpoint 32-01 built. Frontend (`app/`) plus one
`frame-src` CSP header on the Worker.

## What Shipped

**Task 1 — pure helpers + 24 unit tests** (`2725392`)
- `app/lib/parrot-embed.ts`: framework-free (no React, no top-level `window`)
  so it runs under this repo's node-only Vitest. Exports `isTrustedParrotOrigin`,
  `parseParrotBadge`/`parseParrotIncomingCall`, `isParrotReadyMessage`/
  `isParrotCallEndedMessage`, `buildParrotDialMessage`/`buildParrotTokenMessage`/
  `buildParrotOpenContactMessage`, `buildEmbedSrc`, `PARROT_EMBED_ORIGIN`
  (`https://parrot.projecta.ai`), and the timing/event-name constants.
- `workers/tests/lib/parrot-embed.test.ts`: origin accept/reject (scheme,
  subdomain, trailing slash, unrelated), badge clamp-to-0/type-guard,
  incoming-call from-required + optional-name, ready/call-ended discrimination,
  builder shapes, and a JWT-token `buildEmbedSrc` round-trip preserving existing
  query params.

**Task 2 — ParrotEmbedPane + root mount + slot markers** (`496c742`)
- `app/components/ParrotEmbedPane.tsx` (no props; reads `useCurrentEmployee()` +
  `useLocation()`):
  - Gated on `!!me` (mirrors OnboardingWizard) — renders `null` when signed out,
    so there is no iframe in the DOM pre-auth.
  - `allow="microphone; autoplay"` on the iframe (non-negotiable for Telnyx).
  - `src` set ONCE via `buildEmbedSrc(embed_url, token)` (guarded by `srcSetRef`);
    a `setInterval` re-mints every `PARROT_TOKEN_REFRESH_MS` (90s, inside the 120s
    TTL) and `postMessage`s the fresh token to `contentWindow` targeting the exact
    `PARROT_EMBED_ORIGIN` — never touching `src`.
  - Visibility via `display` toggle (`/phone` or `/sms` → block, else none); the
    iframe is rendered unconditionally once `src` is set (NOT `{visible && …}`),
    so leaving and returning to the pane never remounts it.
  - Fixed-wrapper slot-position sync: measures `[data-parrot-embed-slot]` with
    `getBoundingClientRect()` and mirrors top/left/width/height; recomputes on
    route change, `resize`, `scroll` (capture), and a `ResizeObserver` on the slot,
    with a bounded rAF poll to handle the slot mounting a frame late (route code-split).
  - Inbound bridge: one `message` listener (`[]` deps) that checks
    `isTrustedParrotOrigin(event.origin)` FIRST and returns before touching
    `event.data`; then `parrot:ready` clears loading, `parrot:badge` dispatches
    `PARROT_BADGE_CHANGE_EVENT` (for 32-03), `parrot:incoming-call` sets state +
    plays a looping ringtone, `parrot:call-ended` clears + stops it.
  - Outbound `parrot-dial-request` listener built now (inert until 32-03 adds the
    dispatcher): forwards `parrot:dial` and `navigate("/phone")`.
  - Loading overlay (spinner) while `!ready`; a 12s timeout swaps it to a Retry
    button that re-mints WITHOUT changing `src`; incoming-call banner (top-right)
    that navigates to `/phone`.
- `app/lib/api.ts`: `ParrotEmbedTokenResponse` + `api.mintParrotEmbedToken()`
  (`POST /api/embed/parrot-token`).
- `app/root.tsx`: `<ParrotEmbedPane/>` mounted as a sibling of `<Outlet/>` in
  `AppShell`.
- `app/routes/phone.tsx` / `sms.tsx`: Coming-soon placeholder + speculative
  `@cloudflare/voice` notes replaced with a `[data-parrot-embed-slot]` marker.

**Task 3 — CSP frame-src header** (`087eb67`)
- `workers/app.ts`: first `app.use("*")` (before Clerk auth) sets
  `Content-Security-Policy: frame-src 'self' <origin>;` on every response,
  deriving `<origin>` from `env.PARROT_EMBED_URL` with a hardcoded fallback.
  No `default-src`/`script-src` — minimal by design. No new non-function named
  export added to the Worker entrypoint (avoids the workerd trap).
- `workers/tests/csp-header.test.ts`: integration test over the real
  `worker.fetch`.

## How the non-negotiables were verified

- **Never-unmount** — verified by design + build. The iframe lives in `AppShell`
  (root.tsx), a sibling of `<Outlet/>`; only the Outlet's content remounts on
  navigation, so the iframe node persists. It is rendered unconditionally once
  `src` is set and hidden with `display:none`, and `src` is write-once
  (`srcSetRef`). `useCurrentEmployee()` keeps its last successful `data` across
  transient refetch errors (React Query), so `!!me` does not flap the mount. The
  Playwright `src`-stability round trip (phone→inbox→phone) is the runtime proof
  and needs a signed-in session — see the block below.
- **`allow="microphone; autoplay"`** — present on the iframe; typechecks + builds.
- **CSP doesn't break Clerk** — the CSP is `frame-src` ONLY. The integration test
  asserts the header IS emitted (`frame-src 'self' https://parrot.projecta.ai;`),
  is derived from `PARROT_EMBED_URL`, falls back on malformed config, and contains
  NO `default-src`/`script-src` (the exact directives that would block Clerk's
  inline scripts/embedded frames). The live browser sign-in with a clean console
  is the mandated final check but is environmentally blocked — see below.

## Verification

- `npm test -- parrot-embed` → **24/24 pass**.
- `npm test -- csp-header` → **4/4 pass**.
- `npm test` (full suite) → **113/113 pass, 19 files, zero regressions** (up from
  89/89 at 32-01; +24 embed helper cases +4 CSP cases; the stderr lines in
  `chat-realtime` are that suite's expected fail-soft logging, not failures).
- `npm run typecheck` → **exit 0, zero TS errors**.
- `npm run build` → **succeeds** (client + SSR bundles emitted).

## Blocked / deferred verification (environmental, not implementation)

The plan's runtime steps that need a live signed-in session could NOT be run
locally, for reasons unrelated to this code:
- **Live Clerk sign-in + zero-CSP-console-violations** (Task 3 critical check)
  and **chrome_visual_check** of `/phone` `/sms` — the Parrot app runs against a
  PRODUCTION Clerk instance (`clerk.workspace.internjobs.ai`) whose keys are
  domain-locked; a real sign-in cannot complete on localhost. The CSP integration
  test above is the strongest offline proxy: it proves the header is present and
  is `frame-src`-only (no Clerk-breaking directive).
- **Playwright `src`-stability round trip** — requires the signed-in session
  above plus a reachable Parrot embed. Parrot's `internjobs` org is not yet
  provisioned (per the phase objective: a real call is a joint milestone), so the
  iframe would render Parrot's own "ask your admin" panel rather than a live
  dialer. The never-unmount guarantee is established by the architecture + the
  write-once `src` guard; a `data-testid="parrot-embed-iframe"` is in place for
  when a signed-in preview environment is available.

These are the same Clerk-domain-lock and Parrot-provisioning gates already noted
for this milestone; they are not uncertainties about the never-unmount or CSP
implementation, which are correct by construction and unit/integration-verified.

## Not deployed (per plan)

No `wrangler deploy`, no secrets touched. `PARROT_EMBED_URL` is an existing
wrangler var; `OIDC_SIGNING_KEY` was provisioned in 32-01.

## Deviations from Plan

- `apps/parrot/workers/tests/csp-header.test.ts` — extra file NOT in the plan's
  `files_modified`. Added to give the non-negotiable CSP requirement a repeatable
  automated check (header present, derived-from-env, no `default-src`), since the
  live browser sign-in regression is environmentally blocked. Strengthens
  verification; touches no product code.
- `apps/parrot/worker-configuration.d.ts` is regenerated by `cf-typegen` during
  `typecheck` but is gitignored — not part of any commit.

## Notes for the coordinator

- This worktree started at `13b0a5e` (behind `rrr/v1.5/team-workspace-32`). I
  fast-forwarded (linear, `13b0a5e` is an ancestor of `c790d29`) to `c790d29`
  (32-01 complete) to obtain the plan + mint endpoint, then committed the three
  task commits on top. Branch here is `worktree-agent-ac8eb1364302f0647`.
- `apps/parrot` is excluded from the root npm workspaces (`!apps/parrot`) and this
  fresh worktree had no `node_modules`; I created a directory junction from the
  worktree's `apps/parrot/node_modules` to the main checkout's (package.json is
  byte-identical between the two commit bases) so tests/build could run.
- 32-03 consumes two contracts already emitted here: `parrot-badge-change`
  (WorkspaceShell should listen, like `chat-unread-change`) and
  `parrot-dial-request` (a dispatcher fires it; the listener in ParrotEmbedPane
  already forwards `parrot:dial` + navigates). No edit to ParrotEmbedPane needed
  for the dial path.
---
