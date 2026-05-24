---
phase: 22-lakera-and-brand-refresh
plan: "03"
subsystem: ui
tags: [brand, css-tokens, tailwind, logo, favicon, inter, marketing]

# Dependency graph
requires:
  - phase: 22-lakera-and-brand-refresh/22-02
    provides: brand spec (BRAND-V1.md) captured & verified
provides:
  - 6 brand color CSS variables in :root (lavender, ink, lime, tangerine, cobalt, cream)
  - 3 radii tokens (--radius-card 18px, --radius-pill 999px, --radius-mark 8px)
  - Tailwind color keys pointing to var(--X) (single source of truth)
  - Tailwind borderRadius keys (card/pill/mark)
  - Tailwind fontSize scale (display/h1/h2/h3/label)
  - .accent-dot / .accent-comma helpers with data-accent overrides
  - 7 SVG logo variants in apps/marketing/public/logo/
  - 28 PNG raster fallbacks in apps/marketing/public/logo/png/
  - Favicon (32/64) + apple-touch-icon (180) → mark-gradient_256w.png
  - Safari mask-icon → mark-ink.svg #1A0D2E
  - Brand-voice <title> + meta description + theme-color #E8DEF5
affects:
  - 22-04 (Marketing Layout & Copy — uses tokens, mounts lockup-gradient-ink.svg in Navbar)
  - 22-05 (Marketing Verification — visual diff & contrast checks)

# Tech tracking
tech-stack:
  added:
    - "@types/react ^18.3.28 (devDep — was declared but not installed; tsc -b was failing pre-changes)"
    - "@types/react-dom ^18.3.7 (devDep — same reason)"
  patterns:
    - "CSS-vars-as-source-of-truth: Tailwind color/radius keys reference var(--X) so a single :root edit propagates to all Tailwind utilities"
    - "Section accent via data attribute: [data-accent='tangerine'] .accent-dot { color: var(--tangerine) } — components declare accent at layout level, leaves inherit"
    - "Multi-size raster favicon with single source PNG: 256w mark-gradient PNG used for 32/64/180 sizes (browsers downscale)"

key-files:
  created:
    - apps/marketing/public/logo/lockup-gradient-ink.svg (PRIMARY logo)
    - apps/marketing/public/logo/lockup-gradient-lavender.svg
    - apps/marketing/public/logo/lockup-ink.svg
    - apps/marketing/public/logo/lockup-lavender.svg (cobalt exception)
    - apps/marketing/public/logo/mark-gradient.svg
    - apps/marketing/public/logo/mark-ink.svg
    - apps/marketing/public/logo/mark-lavender.svg
    - apps/marketing/public/logo/png/ (28 raster files, mark + lockup variants)
  modified:
    - apps/marketing/src/styles.css (+18 token lines in :root, +16 accent-span lines)
    - apps/marketing/tailwind.config.ts (+44 lines: brand colors, radii, fontSize scale)
    - apps/marketing/index.html (favicon/touch-icon/mask-icon links, title, meta description, theme-color)

key-decisions:
  - "Renamed legacy tailwind 'ink: #111111' to 'ink-legacy' so 'ink' resolves to var(--ink)=#1A0D2E (the canonical brand value). Plan's must_haves.truths required Tailwind keys reference var(--X); the alternative of leaving ink=#111111 would have violated BRAND-TOKENS-01."
  - "Kept legacy CSS rules using #fbf7ef intact (page-shell, html, body) — full background swap to var(--lavender) is deferred to 22-04 surface audit per plan rationale."
  - "Did NOT generate a true .ico file (BRAND-LOGO-05 mentions ICO with 16/32/64 sizes OR PNG; PNG approach chosen for simplicity and equally broad compat). Plan's files_modified listed apps/marketing/public/favicon.ico but Task 3 Part B's primary path was PNG — no .ico was created."
  - "Kept old apps/marketing/public/favicon.svg on disk (no longer referenced; harmless dead file). Removal can happen in 22-04 cleanup if desired."

patterns-established:
  - "Brand tokens live in styles.css :root and are referenced via Tailwind keys — components MUST use Tailwind utilities (bg-lavender, text-ink, rounded-pill) rather than inline hex values. 22-04 will audit & swap all hard-coded hex."
  - "Inter font weights 400-900 loaded via single Google Fonts URL in <head>. Self-hosting deferred (no measurable LCP benefit yet)."
  - "Multi-colorway logo set (gradient/ink/lavender) lets components pick by background — see BRAND-V1 §3 picker table."

# Metrics
duration: 3m
completed: 2026-05-24
---

# Phase 22 Plan 03: Brand Foundation Summary

**Brand v1.0 primitives installed: 6 CSS color vars, 3 radii tokens, Tailwind extended with brand keys + type scale, 35 logo assets in place, favicon swapped to mark-gradient.**

## Performance

- **Duration:** ~3 min
- **Started:** 2026-05-24T20:41:49Z
- **Completed:** 2026-05-24T20:44:43Z
- **Tasks:** 3/3
- **Files modified:** 3 (styles.css, tailwind.config.ts, index.html) + 1 lockfile (side-effect)
- **Files created:** 35 logo assets + 1 SUMMARY

## Accomplishments

### Task 1 — Brand tokens in CSS + Tailwind config
**Commit:** `1748800`

Added the v1.0 color and radii primitives at the top of `apps/marketing/src/styles.css` `:root`:

```css
--lavender:  #E8DEF5;  --ink:       #1A0D2E;
--lime:      #CAFF4D;  --tangerine: #FF7A3A;
--cobalt:    #3855FF;  --cream:     #FAF6EB;
--radius-card: 18px; --radius-pill: 999px; --radius-mark: 8px;
```

Extended `tailwind.config.ts` so `bg-lavender`, `text-ink`, `rounded-pill`, `text-display`, etc. all resolve to the CSS vars. The font-size scale (display/h1/h2/h3/label) ships responsive `clamp()` values, tracking, and weight per BRAND-V1 §2.

Added `.accent-dot` / `.accent-comma` helpers with `[data-accent="tangerine|cobalt"]` overrides so headlines can render colored punctuation as inline `<span>` elements (BRAND-V1 §5).

### Task 2 — Logo pack copied
**Commit:** `62accc7`

Copied bit-for-bit from `~/Downloads/logo_pack/`:
- 7 SVG variants → `apps/marketing/public/logo/`
- 28 PNG raster fallbacks → `apps/marketing/public/logo/png/`

ViewBox inspection confirmed BRAND-LOGO-07 compliance:
- Mark SVGs: `viewBox="0 0 64 32"` → 2:1 aspect (canonical)
- Lockup SVGs: `viewBox="0 0 280 40"` → 7:1 aspect (canonical)

### Task 3 — Favicon, apple-touch-icon, title, meta
**Commit:** `250d03b`

`apps/marketing/index.html` updates:
- Removed `<link rel="icon" href="/favicon.svg">` (legacy)
- Added 32px + 64px PNG icon links → `/logo/png/mark-gradient_256w.png`
- Added 180px apple-touch-icon → same source PNG
- Added Safari mask-icon → `/logo/mark-ink.svg` with color `#1A0D2E`
- Added `<meta name="theme-color" content="#E8DEF5">` (mobile chrome bar matches lavender anchor)
- Updated `<title>` to `internjobs.ai | internships, in your dms.`
- Updated meta description to brand voice copy
- Inter font link verified — already loaded weights 400-900

Build verified after every task: `dist/index.html` 1.28 kB · `dist/assets/index-h94mNizD.css` 42.21 kB · build time ~580 ms.

## Verification Results

| # | Check | Result |
|---|---|---|
| 1 | `grep --lavender styles.css` | ✓ line 7 |
| 2 | `grep --radius-pill styles.css` | ✓ line 16 (999px) |
| 3 | `grep accent-dot styles.css` | ✓ lines 1169/1174/1179 |
| 4 | `grep lavender tailwind.config.ts` | ✓ line 9 (var ref) |
| 5 | `ls public/logo/*.svg \| wc -l` | ✓ 7 |
| 6 | `ls public/logo/png/*.png \| wc -l` | ✓ 28 |
| 7 | `grep apple-touch-icon index.html` | ✓ 180x180 link |
| 8 | `cd apps/marketing && npm run build` | ✓ green |

All 8 plan-defined verification checks pass.

## Success Criteria Audit

- ✓ BRAND-TOKENS-01 — 6 color vars in :root
- ✓ BRAND-TOKENS-02 — 3 radii tokens in :root
- ✓ BRAND-TYPE-01 — Inter weights 400-900 loaded
- ✓ BRAND-TYPE-02 — Type scale in tailwind.config.ts
- ✓ BRAND-LOGO-01 — 7 SVG variants placed
- ✓ BRAND-LOGO-02 — 28 PNG variants placed
- ✓ BRAND-LOGO-05 — Favicon + apple-touch + Safari mask-icon configured
- ✓ BRAND-LOGO-07 — ViewBox values verified (mark 2:1, lockup 7:1)

## Deviations

These extra/different file changes are honest-audit notes (Hygiene Rule HYGN-04). None blocked the plan; all are justified inline.

1. **`package-lock.json`** — not in plan's `files_modified`. Reason: Rule 3 (Blocking). `cd apps/marketing && npm run build` failed pre-change because `@types/react` and `@types/react-dom` were declared in `apps/marketing/package.json` devDependencies but absent from `node_modules`. Reproduced on a stash of my changes (same error), confirming pre-existing breakage. Ran `npm install --workspace @internjobs/marketing` to materialize them; lockfile got side-effect updates for the 68 newly resolved packages. Without this, the plan's verification step ("Build succeeds") would have failed.

2. **`apps/marketing/public/favicon.ico` declared in frontmatter but NOT created.** Reason: Task 3 Part B's primary recommended path was multi-size PNG `<link>` tags pointing to `/logo/png/mark-gradient_256w.png` (browsers downscale the 256w PNG to 16/32/64 sizes). The ICO file is only a fallback "if a true favicon.ico is needed for legacy support" — modern browsers do not need it, and Task 3 says the SVG-fallback alternative is acceptable. Chose the simpler PNG-only path; no .ico generated. If IE11 / legacy Outlook support is required later, run `npx png-to-ico` against the 256w PNG and add a `<link rel="icon" href="/favicon.ico">` entry.

3. **Tailwind `ink: "#111111"` renamed to `ink-legacy`.** Reason: Rule 2 (Critical correctness). Plan's `must_haves.truths` requires "Tailwind color config extended with lavender, ink, lime, tangerine, cobalt, cream keys pointing to var(--X) references" — meaning the brand `ink` MUST resolve to `var(--ink)` = `#1A0D2E`. The pre-existing `ink: "#111111"` directly contradicted this. Renaming the old value preserves any escape hatch needed during the 22-04 audit while making the brand value canonical. ~30 existing `text-ink` usages in App.tsx will now render at `#1A0D2E` (slightly darker purple-tinted ink vs neutral `#111`) — the visual shift is small and aligns with the brand spec's "ink is the ONLY text color" rule.

4. **Legacy `apps/marketing/public/favicon.svg` left on disk.** Reason: No longer referenced from `index.html` (the `<link>` was removed). Harmless dead file; deferred for 22-04 cleanup pass.

5. **Legacy `#fbf7ef` background values in `:root`/`html`/`body` left unchanged.** Reason: Plan Task 1 explicitly says "Do NOT change these to `background: var(--lavender)` yet — leave existing background values in place for now. ONLY add the CSS var declarations at the top of :root. The existing bg color (#fbf7ef) is close to lavender but is the old cream-ish value; it will be replaced in plan 22-04." Following the plan rationale exactly.

## Handoff to 22-04

- `lockup-gradient-ink.svg` is at `apps/marketing/public/logo/lockup-gradient-ink.svg` — ready for the Navbar `<img>` swap (BRAND-LOGO-03/04 per Task 1 Step D of 22-04).
- All `bg-lavender`, `text-ink`, `bg-lime`, `bg-tangerine`, `bg-cobalt`, `rounded-card`, `rounded-pill`, `text-display`, `text-h1` etc. Tailwind utilities are now available.
- Existing `text-ink` usages already render the brand ink color. The full surface audit (replace `bg-canvas` → `bg-lavender`, kill remaining hex literals, remove `bg-white` / `bg-black` violations) is 22-04's job.
- 22-04 contrast/visual diff checks (BRAND-A11Y-01) will catch any places where the slightly darker ink causes regressions.

## Authentication Gates

None encountered.
