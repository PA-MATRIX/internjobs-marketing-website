---
schema_version: 1
phase: "25-sso-activation-admin-ux"
plan: "25-02"
subsystem: "workspace-admin-ui"
tags: ["brand-refit", "admin-ux", "css-tokens", "tailwind-v4", "inter-font"]
status: "code-complete / browser-verify-deferred"
completed: "2026-05-26"
duration: "5m"
requires:
  - "v1.2 Phase 16 (admin.tsx + admin.invite.tsx + admin-employees.ts already built)"
  - "v1.4 BRAND-V1.md spec (color tokens, typography, voice rules)"
provides:
  - "Brand CSS variables in apps/parrot/app/index.css (:root with 6 colors + 2 radii)"
  - "Inter font @import in apps/parrot/app/index.css"
  - "Brand-token-driven /admin page (lavender bg, cream data table, ink text, cobalt CTA, lime active pills)"
  - "Brand-token-driven /admin/invite page (lavender bg, cream form card, ink labels, cobalt submit button)"
  - "Pre-existing React Fragment key warning fix in admin.tsx"
affects:
  - "Phase 26+ (any future workspace surface inherits these tokens via index.css)"
tech_stack:
  added: []
  patterns:
    - "CSS custom properties in :root for design tokens"
    - "Tailwind v4 arbitrary value syntax [color:var(--token)] and [background:var(--token)]"
    - "color-mix(in srgb, var(--ink) 60%, transparent) for opacity-modulated text"
    - "Inline style={{ background: 'var(--lavender)' }} where Tailwind arbitrary value not appropriate"
    - "React Fragment with explicit key for sibling rows inside .map()"
key_files:
  created: []
  modified:
    - "apps/parrot/app/index.css"
    - "apps/parrot/app/routes/admin.tsx"
    - "apps/parrot/app/routes/admin.invite.tsx"
decisions:
  - "Cream (#FAF6EB) is used for the admin data table AND the invite form card. BRAND-V1 §1 Hard Rule #5 permits cream as the only escape from lavender; the rule mentions long-form blog/legal — admin dense data + multi-field forms are interpreted as similar dense surfaces benefiting from a warmer secondary surface. No white anywhere."
  - "UI-state colors preserved: StatusBadge keeps emerald/amber/slate (success/pending/disabled), Disable button keeps rose (destructive action), error banner keeps rose, success banner keeps emerald. Per BRAND-V1 edge-case rule (UI states allowed outside the kit)."
  - "Inter font loaded via Google Fonts @import (not self-hosted) — matches marketing app convention. If marketing later self-hosts, parrot should mirror in a follow-up."
  - "Browser visual verification DEFERRED to operator window (same pattern as Phase 23 ATTACH-DOWN visual proof) — code-complete ships now, screenshot capture follows separately."
---

# Phase 25 Plan 02: Admin UX Brand Refit Summary

## One-liner

Refit /admin + /admin/invite from v1.2 slate/emerald Tailwind classes to v1.4 brand CSS variables (lavender/ink/cobalt/lime/cream) + Inter font + Fragment key fix; build passes, browser verify deferred to operator.

## What Shipped

### 1. apps/parrot/app/index.css — Brand token foundation

Added two new top-of-file declarations:

- Google Fonts `@import url("https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap")` — Inter weights 400/500/600/700 (BRAND-V1 §2 typography spec)
- `:root` block declaring all 6 brand color tokens (`--lavender #E8DEF5`, `--ink #1A0D2E`, `--lime #CAFF4D`, `--tangerine #FF7A3A`, `--cobalt #3855FF`, `--cream #FAF6EB`) + 2 radius tokens (`--radius-card: 18px`, `--radius-pill: 999px`) per BRAND-V1 §1
- `body` rule updated to prepend `"Inter"` to the existing fallback chain

Preserved: existing `@import "tailwindcss"`, existing `.ProseMirror` list styles.

### 2. apps/parrot/app/routes/admin.tsx — Employee directory brand refit

Structural surface substitutions on every branded surface:

| Surface | Before | After |
|---|---|---|
| Page outer container | (no bg) | `style={{ background: 'var(--lavender)' }}` |
| Data table card | `bg-white` | `style={{ background: 'var(--cream)' }}` |
| Table card border | `border-slate-200` | `border-[var(--ink)]/10` |
| Table header row | `bg-slate-50 border-slate-200` | `style={{ background: 'var(--lavender)' }} border-[var(--ink)]/10` |
| Table header cells text | `text-slate-500` | `[color:color-mix(in_srgb,var(--ink)_60%,transparent)]` |
| Table divider | `divide-slate-100` | `divide-[var(--ink)]/10` |
| Edit-mode expanded row | `bg-slate-50` | `style={{ background: 'var(--lavender)' }}` |
| h2 headline | "Employee directory" `text-slate-900` | "employee directory" `[color:var(--ink)]` (lowercased) |
| Description paragraph | `text-slate-600` | `[color:color-mix(in_srgb,var(--ink)_60%,transparent)]` |
| Primary text in table cells | `text-slate-900` | `[color:var(--ink)]` |
| Mono font workspace-email text | `text-slate-600` | `[color:color-mix(in_srgb,var(--ink)_60%,transparent)]` |
| "Add employee" CTA | `bg-slate-900 text-white hover:bg-slate-800` | "add employee" `[background:var(--cobalt)] text-white hover:[background:color-mix(in_srgb,var(--cobalt)_80%,black)]` |
| Edit button | `border-slate-200 bg-white text-slate-700` | `border-[var(--ink)]/20 [background:var(--cream)] [color:var(--ink)]` |
| Cancel button | `border-slate-200 bg-white text-slate-700` | `border-[var(--ink)]/20 [background:var(--cream)] [color:var(--ink)]` |
| Save capabilities button | `bg-slate-900 text-white` | `[background:var(--cobalt)] text-white` |
| Capability checkboxes | `border-slate-200 bg-white hover:bg-slate-50` | `border-[var(--ink)]/15 [background:var(--cream)] hover:[background:color-mix(in_srgb,var(--lavender)_50%,var(--cream))]` |
| Active capability pill | `bg-emerald-100 text-emerald-800` | `[background:var(--lime)] [color:var(--ink)]` |
| Inactive capability pill | `bg-slate-100 text-slate-500` | `[background:color-mix(in_srgb,var(--ink)_8%,transparent)] [color:color-mix(in_srgb,var(--ink)_50%,transparent)]` |
| WorkspaceShell title prop | "Admin" | "admin" (lowercased) |

Preserved UI-state colors (per BRAND-V1 edge-case rule):
- `StatusBadge`: emerald (active) / amber (invited) / slate (disabled)
- Disable button: rose (destructive action)
- Error banner: rose

**Fragment key bug fix:** Hoisted `key={row.id}` onto an explicit `<Fragment key={row.id}>` wrapper around each pair of `<tr>` elements returned from `employees.map()`. Added `Fragment` to the React imports. Removed the now-redundant inner keys (`key={row.id}` on main row and `key={\`${row.id}-edit\`}` on the expanded edit row). This silences the React "Each child in a list should have a unique key prop" warning while preserving correct row identity across re-renders.

### 3. apps/parrot/app/routes/admin.invite.tsx — Invite form brand refit

Structural surface substitutions:

| Surface | Before | After |
|---|---|---|
| Page outer container | (no bg) | `style={{ background: 'var(--lavender)' }}` |
| Form card | `border-slate-200 bg-white` | `border-[var(--ink)]/10` + `style={{ background: 'var(--cream)' }}` |
| Back link | `text-slate-500 hover:text-slate-900` | `[color:color-mix(in_srgb,var(--ink)_50%,transparent)] hover:[color:var(--ink)]` |
| h2 headline | "Add employee" | "add employee" `[color:var(--ink)]` |
| Form description | `text-slate-600` | `[color:color-mix(in_srgb,var(--ink)_60%,transparent)]` |
| Form labels (4) | `text-slate-700` | `[color:var(--ink)]` |
| Form input borders | `border-slate-300` | `border-[var(--ink)]/30` |
| Form input focus rings | `focus:ring-slate-900/20` | `focus:ring-[var(--ink)]/20` |
| Input hint text | `text-slate-500` | `[color:color-mix(in_srgb,var(--ink)_50%,transparent)]` |
| Capabilities fieldset | `border-slate-200` | `border-[var(--ink)]/10` |
| Fieldset legend | `text-slate-700` | `[color:var(--ink)]` |
| Capability checkbox cards | `border-slate-200 bg-white hover:bg-slate-50` | `border-[var(--ink)]/15 [background:var(--cream)] hover:[background:color-mix(in_srgb,var(--lavender)_50%,var(--cream))]` |
| Checkbox input border | `border-slate-300` | `border-[var(--ink)]/30` |
| Checkbox label text | `text-slate-700` | `[color:var(--ink)]` |
| Submit button | `bg-slate-900 text-white hover:bg-slate-800` | `[background:var(--cobalt)] text-white hover:[background:color-mix(in_srgb,var(--cobalt)_80%,black)]` |
| WorkspaceShell title prop | "Add employee" | "add employee" |

Preserved UI-state colors:
- Phone field error border: rose
- Phone error text: rose
- Error banner: rose
- Success banner: emerald (including success banner field labels in `text-emerald-700`)

## Verification

### Grep audits (run in apps/parrot/app)

```
$ grep -rnE "bg-white|#[0-9a-fA-F]{3,8}" routes/admin*
(zero matches)

$ grep -rnE "text-slate-|bg-emerald-100 text-emerald-800" routes/admin*
routes/admin.tsx:450:  ? "bg-emerald-100 text-emerald-800"
routes/admin.tsx:453:    : "bg-slate-100 text-slate-500";
```

The two remaining matches are inside `StatusBadge` — explicitly preserved per the plan as UI-state edge case (success / disabled badge colors).

### Build

```
$ cd apps/parrot && npm run build
✓ built in 11.83s (client)
✓ built in 9.13s (server)
```

Both client and server bundles produced cleanly. CSS bundle: 42.60 kB (gzip 8.18 kB). Admin route chunks: `admin-BHAIu8Nx.js` (8.36 kB), `admin.invite-BXAM3ml9.js` (7.56 kB).

### Typecheck

`npx tsc --noEmit` from `apps/parrot/` returned zero errors.

## Browser visual verify — DEFERRED

Browser visual verification is **deferred** to a separate operator window, matching the Phase 23 ATTACH-DOWN visual proof pattern. The code is complete and the build proves zero TypeScript/CSS errors. The operator should:

1. `cd apps/parrot && npm run dev` (or deploy to dev wrangler env)
2. Open `/admin` — confirm lavender page background, cream data table card, lime-on-ink active capability pills, cobalt "add employee" CTA, ink headline reading "employee directory" (lowercase)
3. Click "Edit" on a row — confirm the expanded row shows lavender background with cream-tinted checkbox cards and a cobalt "Save capabilities" button
4. Open `/admin/invite` — confirm lavender page, cream form card, ink labels, cobalt "Send invite" button, headline "add employee" (lowercase)
5. Capture screenshots and attach as a `25-02-VISUAL-VERIFY.md` follow-up record

This deferral is intentional and consistent with team-workspace's established cadence (Phase 23 ATTACH-DOWN browser verify was also deferred while code shipped).

## Deviations

None — plan executed exactly as written, including the explicit Fragment key fix instruction in Task 2 and the cream-surface guidance for form card in Task 3. No additional files were touched outside the plan's `files_modified` frontmatter (`apps/parrot/app/index.css`, `apps/parrot/app/routes/admin.tsx`, `apps/parrot/app/routes/admin.invite.tsx`).

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| 1 | `eb303e9` | feat(25-02): declare brand CSS variables + Inter font in index.css |
| 2 | `5042bc9` | feat(25-02): brand-refit admin.tsx with v1.4 tokens + Fragment key fix |
| 3 | `f97373d` | feat(25-02): brand-refit admin.invite.tsx with v1.4 tokens |

All commits on branch `rrr/v1.4/team-workspace-25`. Atomic per task. Stage-individual-files discipline observed (no `git add .` or `git add -A`).

## Reqs Closed

- **ADMIN-UX-01** (employee directory with capability pills): brand-refitted; functional code unchanged from v1.2 Phase 16
- **ADMIN-UX-02** (PATCH capability toggle): brand-refitted; `patchFlags()` → `apiFetch` wire unchanged
- **ADMIN-UX-03** (invite form + POST /api/admin/employees): brand-refitted; `submitInvite()` → `apiFetch` wire unchanged
- **ADMIN-UX-04** (welcome email): no-op — already sent by backend `sendWelcomeEmail` in admin-employees.ts; success banner unchanged

## Next Phase Readiness

- Other workspace routes (`dashboard.tsx`, `meetings.tsx`, `chat.tsx`, `inbox.tsx`, `login.tsx`, etc.) still use the old slate/emerald Tailwind palette. They were OUT OF SCOPE for plan 25-02 (admin-only refit). A follow-up plan could extend the brand token refit workspace-wide if pilot feedback warrants.
- The `WorkspaceShell` component itself was not refitted — `title="admin"` is passed lowercase, but the shell's internal styling is still slate-era. If the shell's header bar appears off-brand in the visual verify, a small follow-up to refit `WorkspaceShell.tsx` would be quick.
- Browser visual verify follow-up should produce screenshots to attach against `ADMIN-UX-01..03`.
