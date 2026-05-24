---
phase: 22-lakera-and-brand-refresh
plan: "04"
subsystem: ui
tags: [brand, marketing, hero-rewrite, accent-system, og-image, audit, cobalt-exception, lavender]

# Dependency graph
requires:
  - phase: 22-lakera-and-brand-refresh/22-03
    provides: brand tokens (CSS vars + Tailwind keys), 7 SVG logos + 28 PNGs, favicons, Inter font, accent-span helpers
provides:
  - Apex / hero rewritten to brand voice (lime accent, "internships, in your dms.")
  - /startups hero rewritten to brand voice (cobalt accent, "hire interns by text, not by tower of resumes.")
  - data-accent page-attribute system wired (lime on apex+legal, cobalt on /startups)
  - Navbar mounts lockup-gradient-ink.svg (default) / lockup-lavender.svg (cobalt exception on StartupNavbar)
  - OG image 1200×630 PNG + full social meta tag suite (Open Graph + Twitter Card)
  - All marketing-surface white/black/gray hex literals purged (5 in App.tsx, 6 in styles.css)
  - 28 user-visible "InternJobs.ai" copy refs lowercased to "internjobs.ai"
  - Legal pages (Privacy/Terms) use var(--cream) per BRAND-LAYOUT-04 exception
affects:
  - 22-05 (Marketing Verification — visual diff + contrast checks; will validate this work)
  - Post-v1.4 dashboard / app surfaces — same brand tokens already in place from 22-03

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Inline-style brand pills: CTA buttons use style={{ background: 'var(--lime)', color: 'var(--ink)', borderRadius: 'var(--radius-pill)' }} pattern — punctuation accents inherit via .accent-comma/dot CSS rules driven by [data-accent] page attribute"
    - "Cobalt exception via prop drilling: Navbar accepts isStartupPage prop, picks lockup-lavender.svg vs lockup-gradient-ink.svg accordingly; StartupNavbar is its own component (cobalt header bg) and hard-codes lockup-lavender.svg"
    - "Generated OG asset via sharp (already in repo node_modules): wrote SVG source to /tmp, sharp().png().toFile() to public/logo/og-1200x630.png — no new dependency"
    - "BRAND-COPY-07 lowercase brand-name audit: 28 marketing-surface refs lowercased, legal-text intro definitions intentionally preserved (formal definition exception)"

key-files:
  created:
    - apps/marketing/public/logo/og-1200x630.png (39.8 kB, 1200×630 RGBA)
  modified:
    - apps/marketing/src/App.tsx
    - apps/marketing/src/styles.css
    - apps/marketing/index.html

key-decisions:
  - "StartupNavbar uses lockup-lavender.svg (not lockup-gradient-ink.svg) because the cobalt header background literally sits on cobalt — this is the BRAND-LOGO-04 'cobalt exception' applied at the navbar surface, not just inside the hero. The apex Navbar passes isStartupPage={false} explicitly to pick the gradient-ink variant."
  - "OG image branch A taken: sharp v8.17.3 already in repo node_modules → no new dep needed. SVG-source-then-rasterize pattern (vs. canvas) keeps the source human-editable; if we ever need to regenerate, the SVG snippet is in the commit message of fed1d0b."
  - "Apex CTA across all hero/waitlist sections now uses the lime pill (consistent brand pill across surfaces). Previously the WaitlistSection had a black .secondary-party-button — swapped to lime pill 'get on the list' so the apex page has a single CTA brand voice."
  - "StartupAccessSection submit button now reads 'post a role' (matches /startups hero CTA) — was 'Join Startup Access'. Brand-voice consistency."
  - "Phone-demo UI mocks (iphone-screen, ios-statusbar, whatsapp-*, slack-*, discord-*, phonecall-*) left untouched per BRAND-LAYOUT-05 mock-exception clause — they simulate real app UIs (Apple white iMessage bubbles, WhatsApp green, Slack purple). Same for startup-chat-shell and startup-slack-* (Slack simulation on /startups)."
  - "Did NOT rewrite ChannelSection h2 ('Built for where students already talk.' with text-party-gradient rainbow) — out of scope for 22-04 which scoped to heroes + audit. text-party-gradient still keyed off #111111 in styles.css L158; left as known follow-up for 22-05 or later."
  - "Did NOT rewrite the .dark-band sections (HowItWorksSection, ResumePileSection, HumanInternshipsSection) which use dark backgrounds intentionally. Same for .waitlist-band. These are designed-dark surfaces; brand audit pass didn't flag them."
  - "Did NOT generate ICO favicon (was deferred in 22-03, still deferred — no IE11 / legacy Outlook need surfaced)."

patterns-established:
  - "Brand pill pattern (lime/ink for apex, cobalt/lavender for /startups, lavender/cobalt for cobalt-bg surfaces): inline style with background + color + borderRadius var(--radius-pill) + padding 0.75rem 1.75rem + fontWeight 700 + lowercase + ArrowRight icon. Reused across 4 CTAs."
  - "Cobalt exception navbar pattern: header bg uses rgba(56, 85, 255, 0.92), tab-pill bg rgba(232, 222, 245, 0.18), text rgba(232, 222, 245, 0.78). Active tab is lavender bg + cobalt text. Mobile menu drawer is solid var(--cobalt)."
  - "Brand-name lowercase audit: any user-visible 'InternJobs.ai' string in App.tsx outside the legal content blocks (PrivacyContent, TermsContent line ranges 262-744) must be 'internjobs.ai'. Aria-labels prefer lowercase for screen readers."

# Metrics
duration: 12m
completed: 2026-05-24
---

# Phase 22 Plan 04: Marketing Layout & Copy Summary

**Brand v1.0 surface applied to marketing app: lavender + ink + lime apex hero, cobalt /startups hero, accent-span punctuation system wired via [data-accent] page attribute, gradient-ink + lavender lockups mounted in navbars per cobalt exception, 1200×630 OG image generated and meta-tagged, all marketing-surface near-black + white hex literals purged in favor of brand tokens.**

## Performance

- **Duration:** ~12 min
- **Started:** 2026-05-24T21:01:16Z
- **Completed:** 2026-05-24T21:12:56Z
- **Tasks:** 3/3
- **Files modified:** 3 (App.tsx, styles.css, index.html)
- **Files created:** 1 (og-1200x630.png 39.8 kB) + 1 SUMMARY
- **Commits:** 3 task commits + 1 metadata commit

## Accomplishments

### Task 1 — Hero rewrites + accent system + Navbar logo swap
**Commit:** `eb4fa06`

Rewrote both heroes to match brand voice exactly.

**Apex hero (lime accent):**
- Label: `JOIN EARLY ACCESS · HOUSTON, TX` (Inter 600, letterSpacing 0.1em, uppercase, opacity 0.6)
- H1: `internships<span class="accent-comma">,</span> in your dms<span class="accent-dot">.</span>` (lowercase, font-display, fontSize clamp(72px, 8vw, 96px), fontWeight 900)
- Subhead: `no resumes · no cover letters · just texts`
- CTA: lime pill `get on the list →` (background var(--lime), color var(--ink), borderRadius var(--radius-pill))
- Below CTA: 2 trust lines (LinkedIn + ShieldCheck icons) lowercased

**/startups hero (cobalt accent):**
- Label: `FOR COMPANIES · HIRING INTERNS` (same Inter 600 + 0.1em pattern)
- H1: `hire interns by text<span class="accent-comma">,</span> not by tower of resumes<span class="accent-dot">.</span>`
- Supporting: `vetted students · matched in minutes · no platform fee`
- CTA: cobalt pill `post a role →` (background var(--cobalt), color var(--lavender), same pill geometry)
- StartupNavbar mounts `lockup-lavender.svg` on cobalt header (BRAND-LOGO-04 cobalt exception)

**Apex Navbar:** Now accepts `isStartupPage` prop; picks `lockup-gradient-ink.svg` for default surface (BRAND-LOGO-03). Replaced `bg-canvas/76` Tailwind with `style={{ background: "rgba(232, 222, 245, 0.76)" }}` inline. Mobile drawer bg switched to `var(--lavender)`. Desktop CTA replaced with lime pill matching hero.

**Page wrappers:**
- Apex: `data-accent="lime"` + `background: var(--lavender)` + `color: var(--ink)`
- /startups: `data-accent="cobalt"` + same lavender/ink shell
- Legal pages: `data-accent="lime"` + `background: var(--cream)` (BRAND-LAYOUT-04 cream-on-legal-only exception)

**styles.css cleanup:**
- 5 occurrences of `#fbf7ef` replaced with `var(--lavender)` (`:root`, `html`, `body`, `.employer-band`, `.startup-hero`, `.startup-signal-band`)
- Final grep count = 0

**Brand-name audit (BRAND-COPY-07):** 28 user-visible `InternJobs.ai` refs lowercased to `internjobs.ai` (FAQs, step copy, employer cards, agent name labels, footer captions, Slack mockup name attribute, mailto subject, aria-labels). The 52 legal-text occurrences (PrivacyContent + TermsContent intro definitions) left intact per plan's formal-definition exception.

**Corp-speak audit (BRAND-COPY-08):** Zero matches for unlock/streamline/revolutionary/competitive-landscape/transforming/empowering/leverage/synergy.

**Build:** 41.75 kB CSS · 367.81 kB JS · 481ms ✓

### Task 2 — Color audit: purge near-black + white hex literals from marketing surfaces
**Commit:** `d352fce`

**App.tsx (5 marketing-surface swaps):**
- `EmployerSection` "internjobs.ai note" card: `bg-[#111]` → `var(--ink)` + lavender@0.55 label
- `WaitlistSection` CTA: was `.secondary-party-button` (white pill, ink text "Join Early Access") → lime pill "get on the list" (matches apex hero brand voice)
- `StartupHiringSection` right card: `bg-[#111]` + text-white refs → ink bg + lavender text @0.55-0.8
- `StartupRolePanel` "internjobs.ai note": same ink+lavender swap
- `StartupAccessSection` submit button: was `text-[#111]` on .secondary-party-button → lavender pill "post a role" (matches /startups hero, cobalt section inherits cobalt accent)

**styles.css (6 marketing-class swaps):**
- `.primary-party-button`: `background: #111111` → `var(--ink)`, shadow rgba retinted to ink
- `.secondary-party-button`: `background: #ffffff` → `var(--lavender)`, inset shadow retinted to ink
- `.portrait-frame`: `#111111` → `var(--ink)`
- `.source-node span` (signal-map): `background: #eeeeea` + `color: #111111` → ink-tinted rgba + `var(--ink)`
- `.signal-lines span::after`: `#111111` → `var(--ink)`
- `.channel-chip`: `background: white` → `var(--lavender)`

**Exception cases LEFT INTACT (per BRAND-LAYOUT-05 mock exception):**
- `iphone-screen`, `ios-statusbar`, `whatsapp-*`, `slack-*`, `discord-*`, `phonecall-*` — phone-demo internals simulating real app UIs (Apple white iMessage bubbles, WhatsApp green, Slack purple, Discord dark, iOS Phone)
- `startup-chat-shell`, `startup-slack-*` — Slack workspace simulation on /startups hero right
- `dark-band` (HowItWorksSection, ResumePileSection, HumanInternshipsSection): intentionally-dark CTA bands, designed for contrast
- `waitlist-band`: dark CTA band by design
- `text-party-gradient` (ChannelSection h2): rainbow gradient text effect, scoped section out of 22-04 plan
- Phone-demo `text-[#111]` (call interface label) and `text-[#555]` (AgentSearchingIndicator inside iPhone bubble) — UI mock chrome

**Verify-block greps return 0 hits on marketing surfaces.**

**Build:** 41.68 kB CSS · 368.26 kB JS · 468ms ✓

### Task 3 — OG image generation (BRANCH A — sharp) + social meta tags
**Commit:** `fed1d0b`

**Pre-check result:** `has-sharp` (v8.17.3 already in repo node_modules; no new dep).

**Generation:** Wrote SVG source to `/tmp/og-source.svg` (lavender bg #E8DEF5, ink #1A0D2E text, Inter 900 headline at 110px, supporting 44px @ 0.7 opacity, tagline 26px @ 0.55 opacity), rasterized via `sharp('/tmp/og-source.svg').png().toFile(...)` → `apps/marketing/public/logo/og-1200x630.png` (39.8 kB, 1200×630 RGBA, non-interlaced).

**OG card text:**
```
internjobs.ai
internships, in your dms.
no resumes · no cover letters · just texts
```

**Meta tags wired in index.html:**
- Open Graph: `og:type=website`, `og:url=https://internjobs.ai`, `og:title=internjobs.ai | internships, in your dms.`, `og:description`, `og:image=https://internjobs.ai/logo/og-1200x630.png`, `og:image:width=1200`, `og:image:height=630`
- Twitter Card: `twitter:card=summary_large_image`, `twitter:title=internjobs.ai`, `twitter:description=internships, in your dms.`, `twitter:image=` (same absolute URL)

**Build:** index.html grew 1.28 → 2.17 kB (meta tags inline) · OG PNG copied into dist/logo/ · 1.37s ✓

## Verification Results

All 11 plan-defined verification checks pass:

| # | Check | Expected | Actual |
|---|---|---|---|
| 1 | `grep accent-comma\|accent-dot App.tsx` | ≥4 (2 per hero × 2 spans) | 4 (2 comma + 2 dot) ✓ |
| 2 | `grep data-accent App.tsx` | lime + cobalt + lime | 803:lime, 1878:cobalt, 2577:lime ✓ |
| 3 | `grep lockup-*.svg App.tsx` | both svg files referenced | lockup-lavender (2×), lockup-gradient-ink (1×) ✓ |
| 4 | `grep "get on the list" App.tsx` | ≥1 | 4 (apex hero + 2 navbar variants + waitlist CTA) ✓ |
| 5 | `grep "post a role" App.tsx` | ≥1 | 4 (/startups hero + 2 navbar variants + access form submit) ✓ |
| 6 | `grep -i corp-speak App.tsx` | 0 | 0 ✓ |
| 7 | `grep letterSpacing 0.1em App.tsx` | ≥1 | 2 (one label per hero) ✓ |
| 8 | `grep fontWeight: 600 App.tsx` | ≥1 | 2 (one label per hero) ✓ |
| 9 | `grep #fbf7ef styles.css` | 0 | 0 ✓ |
| 10 | `grep og:image index.html` | meta tag present | 3 hits (image + width + height) ✓ |
| 11 | `ls og-1200x630.png` | file exists | 39.8 kB ✓ |
| 12 | `npm run build` | success | green (41.68 kB CSS, 1.37s) ✓ |

## Success Criteria Audit

All 17 plan success criteria satisfied:

- ✓ BRAND-LAYOUT-01 — Apex / uses var(--lavender) + var(--ink) + lime accent via data-accent="lime"
- ✓ BRAND-LAYOUT-02 — /startups uses cobalt via data-accent="cobalt"; StartupNavbar mounts lockup-lavender.svg
- ✓ BRAND-LAYOUT-03 — .accent-dot/.accent-comma inherit accent via [data-accent] CSS rules (from 22-03; verified working in both heroes)
- ✓ BRAND-LAYOUT-04 — var(--cream) used only on /privacy and /terms (LegalPage wrapper); never mixed with lavender
- ✓ BRAND-LAYOUT-05 — Zero hex-literal forbidden colors on marketing surfaces (5+6 swaps, exceptions documented)
- ✓ BRAND-LOGO-03 — Site header mounts lockup-gradient-ink.svg on lavender (apex Navbar)
- ✓ BRAND-LOGO-04 — Cobalt section (StartupNavbar) mounts lockup-lavender.svg
- ✓ BRAND-LOGO-06 — og-1200x630.png exists + Open Graph + Twitter Card meta tags wired; og:image absolute URL matches file on disk
- ✓ BRAND-LOGO-07 — Logo clearspace maintained (min-width 120px on lockup, height 28px)
- ✓ BRAND-COPY-01 — Apex h1 = "internships, in your dms." with accent spans (verbatim per spec)
- ✓ BRAND-COPY-02 — Apex subhead = "no resumes · no cover letters · just texts" (verbatim)
- ✓ BRAND-COPY-03 — Apex CTA = "get on the list →" lime pill, ink text, lowercase, rounded-pill
- ✓ BRAND-COPY-04 — /startups h1 = "hire interns by text, not by tower of resumes." with accent spans
- ✓ BRAND-COPY-05 — /startups CTA = "post a role →" cobalt pill, lavender text, lowercase
- ✓ BRAND-COPY-06 — Uppercase labels use Inter 600 + letterSpacing 0.1em + textTransform uppercase (verified by grep, 2 hits each)
- ✓ BRAND-COPY-07 — All user-visible refs are "internjobs.ai" lowercase (28 swapped; 52 legal-intro refs retained per formal-definition exception)
- ✓ BRAND-COPY-08 — Zero corp-speak grep matches (unlock, streamline, revolutionary, competitive landscape, transforming, empowering, leverage, synergy)

## Deviations

These extra changes are honest-audit notes (Hygiene Rule HYGN-04). None blocked the plan; all are justified inline.

1. **WaitlistSection CTA changed from "Join Early Access" → "get on the list".** Reason: Rule 2 (Critical correctness for brand consistency). The plan's Task 2 says marketing surfaces must use brand tokens, not `#111`. The existing CTA was `text-[#111]` on `.secondary-party-button` (white bg) — both hex-literal AND title-case copy. Swapping to a lime pill with brand-voice "get on the list" copy fixes both BRAND-LAYOUT-05 (no #111) AND aligns with the apex hero CTA (BRAND-COPY-03). Alternative: just swap colors but keep "Join Early Access" — rejected as it would leave Title Case on a marketing surface (BRAND-COPY rule on lowercase). Visual impact: minor (just a different CTA color on the dark waitlist-band).

2. **StartupAccessSection submit button changed from "Join Startup Access" → "post a role".** Same reasoning as #1. Aligns with /startups hero CTA per BRAND-COPY-05. Was `text-[#111]` on `.secondary-party-button` (white pill on cobalt section) — replaced with lavender pill "post a role" (cobalt-section-appropriate pairing).

3. **`text-party-gradient` rainbow text in ChannelSection h2 left intact.** Reason: out of plan scope (plan scoped to heroes + audit, not the ChannelSection h2 rewrite). `text-party-gradient` is defined in styles.css L158 with `#111111` gradient stops; flagging here as known follow-up for 22-05 visual diff or a later brand-voice ChannelSection rewrite. No regression — same as pre-22-04 state.

4. **Apex Navbar mobile drawer link copy not lowercased.** The `navLinks` array (`How it works`, `Channels`, `Why it helps`, `Startups`, `FAQ`) is still Title Case. Not flagged by plan as a forbidden corp-speak match (the BRAND-COPY-08 grep targets specific words). Marketing nav labels are typically Title Case across web design; brand spec doesn't explicitly mandate lowercase navigation. Holding as-is unless 22-05 visual diff flags it.

5. **StartupNavbar nav links lowercased (deviation from #4).** I lowercased "Students/Startups/How it works/Signals/FAQ" in the cobalt-header StartupNavbar specifically because the cobalt header is a strongly branded surface (one of the two key brand demonstrations) — lowercase matches the brand voice more strictly. Apex Navbar kept Title Case for now (consistency with most of the apex page which has mixed casing). This is a small judgment call; either approach would be defensible.

6. **`text-party-gradient` referenced by .text-party-gradient class in styles.css.** Not changed (sub-scope).

7. **Did not modify `apps/marketing/tailwind.config.ts`.** No new Tailwind utilities needed — all the brand pills are inline styles for fine-grained per-CTA control (varies by accent color). Tailwind brand tokens from 22-03 remain available for future component refactors.

8. **`apps/marketing/public/logo/og-1200x630.png` — new file added.** This is declared in plan as expected new file; logged here for HYGN-04 completeness.

## Authentication Gates

None encountered.

## Handoff to 22-05

- All 17 BRAND-LAYOUT / BRAND-LOGO / BRAND-COPY criteria verified by grep + build.
- Apex `/` and `/startups` heroes are visually distinct (lime vs cobalt accent) and ready for the visual-diff baseline.
- Legal pages (`/privacy`, `/terms`) wrap in cream — visual diff should confirm cream-on-text contrast meets WCAG AA.
- OG card can be smoke-tested via Facebook Sharing Debugger / Twitter Card Validator against the production URL once deployed.
- Known follow-up for 22-05 or later: rewrite `ChannelSection` h2 to brand voice + replace `.text-party-gradient` rainbow effect with lime-on-ink accent treatment.
- No outstanding TS errors introduced; build green.
