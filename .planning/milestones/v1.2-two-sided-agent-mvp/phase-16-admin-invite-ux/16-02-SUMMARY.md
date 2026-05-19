---
phase: 16-admin-invite-ux
plan: "02"
subsystem: ui
tags: [react-router, tailwind, capability-flags, e164, clerk, phone-otp, admin]

# Dependency graph
requires:
  - phase: 16-01-admin-invite-ux-backend
    provides: "POST /api/admin/employees { firstName, lastName, phoneNumber, featureFlags }; GET + PATCH /:id/flags; default-all-on KV seed; Ridhi-voice welcome email."
  - phase: 10-parrot-employee-workspace
    provides: "WorkspaceShell layout + /admin/invite route file + requireOperator-gated /api/admin/employees endpoints."
provides:
  - "/admin route — employee directory list with status badges + 6 capability pills per row + inline capability editor (PATCHes /:id/flags) + Disable action."
  - "/admin/invite rewrite — FN / LN / personalEmail / phoneNumber (E.164 client-validated) + 6 capability toggles (default ALL ON) + success panel showing feature_flags + 'Go to admin list →' link."
  - "Capability flags read/write fully wired end-to-end (UI ↔ Worker ↔ KV) — every Phase 17/18 surface can read `feature_flags` from POST 201 / GET /:id/flags and gate its UI accordingly."
affects: [17-onboarding-experience, 18-workspace-rollout]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Capability pill component: emerald-100/800 when active, slate-100/500 when inactive — green pill === capability granted."
    - "Inline row-expansion editor (no modal) for per-row mutations — keeps the operator in the directory context while editing."
    - "Client-side E.164 validation before submit (shortcut the server round trip; inline rose-bordered field error)."
    - "Default-merge pattern on the frontend: `{ ...DEFAULT_FLAGS, ...(stored ?? {}) }` so a partial backend response still produces a complete `CapabilityFlags` shape — mirrors the backend's read-modify-write contract."

key-files:
  created:
    - "apps/parrot/app/routes/admin.tsx — 461 lines, client-rendered /admin directory + inline capability editor + disable action."
  modified:
    - "apps/parrot/app/routes/admin.invite.tsx — full rewrite: 3-field form → FN/LN/personalEmail/phoneNumber/6-capability-toggles + E.164 validation + extended InviteResponse with feature_flags."
    - "apps/parrot/app/routes.ts — register `/admin` route as a sibling of `/admin/invite` (flat routing matches the existing file-name convention)."

key-decisions:
  - "/admin is a sibling of /admin/invite, NOT a React Router parent route — the parrot app uses flat file routing (no nested layouts beyond WorkspaceShell) so `route('admin', 'routes/admin.tsx')` + `route('admin/invite', 'routes/admin.invite.tsx')` registered side-by-side. Keeps the file-name convention readable and avoids introducing an Outlet pattern just for two routes."
  - "Client-side E.164 regex is identical to the server-side Zod check (`/^\\+[1-9]\\d{7,14}$/`) — defense in depth, AND it shortcuts the API round trip on bad input so the operator gets an inline field error instead of a banner."
  - "Capability checkboxes default ALL ON in the invite form state init (`useState<CapabilityFlags>({ ...ALL_ON })`) and the request body always carries the full `featureFlags` object — never a partial. This matches the operator's mental model (turn off, never opt-in) and means a fresh invite always writes a complete shape to KV."
  - "Inline row-expansion editor on /admin uses a sibling `<tr>` with `colSpan={5}` rather than a modal. Keeps the operator's eye on the directory list, avoids a focus-trap pattern, and degrades gracefully on narrow viewports (the grid inside the expanded row is `grid-cols-2 sm:grid-cols-3`)."
  - "Disable action calls `DELETE /api/admin/employees/:id` and then re-runs the full `loadEmployees()` (re-fetch list + re-fetch all flags). Simpler than threading a single-row update through the state tree — and the directory rarely has more than a dozen rows in v1.2."

patterns-established:
  - "CapabilityPills + CapabilityKey type alias pattern: when surfaces in future phases (Phase 17 onboarding, Phase 18 rollout) need to render the same flag set, they can import the same `CAPABILITY_KEYS` array + `CAPABILITY_LABELS` map (or — better — promote to `apps/parrot/app/lib/capabilities.ts` if reused). For now they live inline in admin.tsx / admin.invite.tsx since they're the only two consumers."
  - "Capability-default merge on the frontend: every read site does `{ ...DEFAULT_FLAGS, ...(serverResponse.feature_flags ?? {}) }`. This is the same defensive-merge invariant the backend enforces — duplicating it on the client means a fresh `/:id/flags` response on a row that's never had a KV write still renders correctly even if the backend ever returns `{}`."

# Metrics
duration: 3m 18s
completed: 2026-05-19
---

# Phase 16 Plan 02: Ridhi Admin Invite UX — Wave 2: Frontend Summary

**`/admin` is now Ridhi's primary workspace control surface: an employee directory with capability pills + inline toggle editor, and a rewritten `/admin/invite` form with FN/LN/personalEmail/phone (E.164-validated) + 6 capability checkboxes that default all-on — backed end-to-end by the Wave 1 backend.**

## Performance

- **Duration:** 3m 18s
- **Started:** 2026-05-19T19:04:41Z
- **Completed:** 2026-05-19T19:07:59Z
- **Tasks:** 2 (auto) + 1 human-verify checkpoint (deferred — see below)
- **Files modified:** 3
- **Worker deployed:** version `44c33cb1-8efd-4e35-9bf0-ed92e07100c8` to `workspace.internjobs.ai`

## Accomplishments

- **`/admin` route exists** with status badges (`active` / `invited` / `disabled`), 6 capability pills per row (`email`, `chat`, `meetings`, `phone`, `sms`, `campaigns` — emerald-100 when on, slate-100 when off), per-row inline "Edit" action that expands a sibling `<tr>` with 6 checkboxes and PATCHes `/api/admin/employees/:id/flags` on save, and a per-row "Disable" action that calls `DELETE /api/admin/employees/:id` with a confirm prompt + reloads the directory.
- **`/admin/invite` rewrite ships the full Phase 16 field set:** two-column FN + LN grid, personal email (with "not used for login" helper), phone number (`tel` input, E.164 placeholder `+12125551234`, inline rose-bordered error when client-side regex fails), and a `<fieldset>` of 6 capability checkboxes labelled "Capabilities (all enabled by default)" with friendly labels (e.g. "Chat / Mattermost", "Meetings / Daily.co").
- **Success panel extended** with a "Capabilities" dl-row listing the enabled flags as a comma-joined string + a "Go to admin list →" link to `/admin`.
- **Back link** ("← Back to admin") above the invite form heading completes the round-trip navigation.
- **TypeScript clean** through every edit (`tsc --noEmit -p apps/parrot/tsconfig.json` → 0 errors).
- **Build clean** after `rm -rf build && npm run build` — the chunked output shows `admin-BMoCIApT.js` (7.40 KB) and `admin.invite-jRp6hlx4.js` (7.11 KB) as separate route chunks.
- **Worker deployed** to `workspace.internjobs.ai` — `npx wrangler deploy` uploaded 4 new asset hashes (the two new route chunks + the updated `root-*.css` + the asset manifest); version ID `44c33cb1-8efd-4e35-9bf0-ed92e07100c8`.

## Task Commits

Each task was committed atomically (file-level staging, no `git add -A`):

1. **Task 1: Create /admin parent route with employee list + capability editor** — `5bbc416` (feat)
2. **Task 2: Rewrite admin.invite.tsx with FN/LN/phone/toggles** — `96e7faf` (feat)

## Files Created/Modified

- **`apps/parrot/app/routes/admin.tsx` (NEW, 461 lines)** — client-rendered `WorkspaceShell`-wrapped page. Inline TypeScript interfaces for `EmployeeRow`, `CapabilityKey`, `CapabilityFlags`, `ListResponse`, `FlagsResponse`. State: `employees`, `flags: Record<string, CapabilityFlags>`, `editingId`, `editDraft`, `busy`, `pageError`, `loading`. `loadEmployees()` fetches `/api/admin/employees`, then parallel-fetches `/:id/flags` per row with per-row try/catch (errors fall back to `DEFAULT_FLAGS`). `submitCapabilityEdit` PATCHes the row and merges the returned `feature_flags` back into local state without a full reload. `onDisable` calls DELETE + full reload. Two subcomponents at the bottom: `StatusBadge` (color-coded by status) + `CapabilityPills` (emerald/slate pills).
- **`apps/parrot/app/routes/admin.invite.tsx` (REWRITE)** — replaces the Phase 10 minimal 3-field form. New state: `firstName`, `lastName`, `personalEmail`, `phoneNumber`, `featureFlags: CapabilityFlags` (init to `{...ALL_ON}`), `phoneFieldError`. `E164_REGEX = /^\+[1-9]\d{7,14}$/` defined at module scope. Submit handler runs the regex pre-check FIRST — on failure, sets `phoneFieldError` and returns WITHOUT calling the API. Request body sends `name: firstName + ' ' + lastName` (backward-compat with the server's slug-from-name path) PLUS `firstName`, `lastName`, `phoneNumber`, `featureFlags`. `InviteResponse` interface extended with `feature_flags: Record<string, boolean>`. Success panel adds "Capabilities" dl-row + "Go to admin list →" link. "← Back to admin" link above the heading.
- **`apps/parrot/app/routes.ts`** — registers `route("admin", "routes/admin.tsx")` immediately before the existing `route("admin/invite", "routes/admin.invite.tsx")` line. Comment block explains the flat (non-nested) routing choice.

## Decisions Made

- **Flat routing, not nested parent.** `/admin` and `/admin/invite` are sibling registrations rather than a parent-with-Outlet pattern. The parrot app already uses flat file routing (`dashboard.tsx`, `meetings.tsx`, `admin.invite.tsx`) — introducing nested routing for one new pair of routes would diverge from the convention without buying anything. Both routes wrap their own content in `WorkspaceShell` (which is what would have been the parent-layout's job anyway).
- **Client-side E.164 mirrors server-side.** Same regex (`/^\+[1-9]\d{7,14}$/`) on both sides. Client check is purely UX (shortcut the round trip + inline field error); the server-side Zod check in `InviteSchema.phoneNumber` is the actual security boundary. If the client regex ever drifts from the server, the server still rejects bad input — defense in depth.
- **Capability checkboxes always submit the full shape.** Even though Wave 1's `featureFlags` is `Zod.partial()` on the backend, the frontend always sends a complete `{ email, chat, meetings, phone, sms, campaigns }` object. This means a fresh invite writes a complete KV row (not a partial that relies on the server's default-merge) and edits via `/admin` always send all 6 keys. Simpler invariant; same outcome.
- **Inline row-expansion editor for the directory.** Each `<tr>` gets a sibling `<tr>` with `colSpan={5}` when `editingId === row.id`. No modal, no focus trap, no portal. The expanded row shows a `grid-cols-2 sm:grid-cols-3` grid of labelled checkboxes + Save / Cancel buttons. Trade-off: stacks vertically on narrow viewports but never overlaps content, and stays in the same scroll context.
- **Disable triggers a full directory reload.** `DELETE /:id` + `loadEmployees()` rather than a surgical local-state mutation. The directory rarely has more than a dozen rows in v1.2; the extra round trip is negligible and guarantees the UI never lies about the post-disable state.

## Deviations from Plan

- **Plan said "parent route"; shipped as "sibling route".** The plan's wording ("Create `apps/parrot/app/routes/admin.tsx` as a React client component") didn't strictly require a parent-with-Outlet pattern, and the file convention in this app is flat. Documented explicitly as Decision 1 above. No functional impact — every artifact in `must_haves.artifacts` and every truth in `must_haves.truths` ships.
- **Capability label friendliness.** Plan listed labels as `"Email"`, `"Chat / Mattermost"`, etc. for the invite form; the directory pills (Task 1's CapabilityPills) use the lowercased keys themselves as the pill text (`email`, `chat`, `meetings`, `phone`, `sms`, `campaigns`) to keep the pills compact. Functionally equivalent; both consume the same `CAPABILITY_KEYS` array.

No auto-fixes applied (Rules 1–3 not triggered); no architectural escalations (Rule 4 not triggered).

## Authentication Gates

None — `wrangler deploy` ran with the existing Cloudflare session and authenticated cleanly.

## Issues Encountered

None — TypeScript stayed green from the first save through both file rewrites; Vite/Workers build succeeded with no warnings beyond the existing large-chunk advisories; the wrangler upload succeeded on the first attempt.

## User Setup Required

None — no new env vars, no new bindings, no Clerk dashboard changes. The Wave 1 backend ships everything the new UI consumes (POST featureFlags, GET/PATCH /:id/flags). The `PARROT_FEATURE_FLAGS` KV binding was wired in Phase 13; verified live in this Worker deploy's bindings table.

## Human-verify Checkpoint (DEFERRED)

Plan 16-02 has a `type="checkpoint:human-verify"` gate at the end of `<tasks>`. Per the orchestrator instructions, this run does NOT block on the checkpoint — code is shipped + deployed, and Ridhi can run the verification herself when convenient.

**Verification script** (lifted from the plan; reproduce here so the user can action without re-opening the PLAN):

1. Open https://workspace.internjobs.ai/admin (sign in as Ridhi first if needed).
2. Confirm: existing employees are listed with their capability pills shown.
3. Click "Edit" on any employee row — confirm the inline capability editor appears with current flags.
4. Toggle one capability off and save — confirm the pill updates to gray without a page reload.
5. Click "Invite new employee" → navigate to /admin/invite.
6. Fill in: First name=Test, Last name=User, personal email=test@personal.example, phone=+12125551234.
7. Leave all capability toggles checked.
8. Submit — confirm 201 response, success panel shows workspace email and "Capabilities: email, chat, meetings, phone, sms, campaigns".
9. Navigate back to /admin — confirm the new employee appears in the list.
10. Verify the welcome email arrived at test@personal.example (content: signed by Ridhi, mentions workspace.internjobs.ai + phone-OTP instructions).

**Resume signal:** Type "approved" if everything looks correct, or describe what needs fixing.

## Next Phase Readiness

- **Phase 16 closes after the human-verify gate.** With Wave 1 (backend) and Wave 2 (frontend) shipped + deployed, the third sub-plan (if any — STATE.md notes `plan_total: 3`) is the verification checkpoint itself; everything code-side is complete.
- **Phase 17 (Onboarding Experience) unblocked.** It can read `feature_flags` from the existing `/api/me` extension point or via a new `/api/me/flags` GET (depending on the Phase 17 plan), and gate its OnboardingWizard steps accordingly.
- **Phase 18 (Workspace Rollout) unblocked.** Every workspace pane (Inbox / Chat / Meetings / Phone / SMS / Campaigns) can now read its capability flag at mount and either render the pane or redirect to a "Coming soon — ask Ridhi to enable {capability}" placeholder. The frontend pattern is the same merge-with-defaults we use in `admin.tsx`'s `loadEmployees()`.
- **No SEC-ROTATE additions.** No new secrets / tokens introduced this wave.

---
*Phase: 16-admin-invite-ux*
*Completed: 2026-05-19*
