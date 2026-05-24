# InternJobs.ai Brand V1 — Developer Reference

**Spec version:** v1.0 — 2026, Houston TX
**Source:** `~/Downloads/internjobs_brand_guidelines_1.pdf` (14 pages) + `~/Downloads/logo_pack/`
**Captured for repo:** 2026-05-24
**Scope:** v1.4 Phase 22 Group F — Marketing Brand Refresh

> One anchor, one ink, three accents. Lavender is the background. Ink is the only text color. Each section wears exactly one accent: lime (default/CTAs), tangerine (urgency), or cobalt (employers/trust).

---

## 1. Color Tokens (CSS variables)

Load as CSS variables. **Never** put hex literals in components.

```css
:root {
  --lavender:  #E8DEF5;  /* anchor — every surface */
  --ink:       #1A0D2E;  /* only text color */
  --lime:      #CAFF4D;  /* accent · default · CTAs · hero · waitlist · social */
  --tangerine: #FF7A3A;  /* accent · urgency · scarcity · deadlines */
  --cobalt:    #3855FF;  /* accent · employers · trust · data · press */
  --cream:     #FAF6EB;  /* escape from lavender · long-form (blog, legal) ONLY */
}
```

**Radii:**
```css
--radius-card: 18px;
--radius-pill: 999px;
--radius-mark: 8px;   /* 8–14px range; favicon corner radius */
```

### Hard rules (Five Non-Negotiables)

1. **Lavender is ALWAYS the background.** Never replace with white.
2. **ONE accent per section.** Never two accents next to each other.
3. **Ink is the ONLY text color.** Body, headlines, captions — all ink.
4. **Logo uses the full gradient (lime → tangerine → cobalt).** Never recolor.
5. **Cream `#FAF6EB` is the ONLY allowed escape from lavender.**

### Forbidden

- ❌ No white (pure or off-white)
- ❌ No pure black, no gray fills
- ❌ No mixing cream + lavender on the same surface
- ❌ No accent colors on cream backgrounds (gets muddy)
- ❌ No body text in an accent color
- ❌ No drop shadows / gradients / glows on anything except the logo mark

### Edge cases allowed

- Photography may contain colors outside the kit (photos are content, not surfaces)
- UI states (hover, focus, disabled) may use ink at 60/40/20% opacity
- Data viz inside a chart may use lime + tangerine + cobalt together (charts are the rare bend) — never on marketing surfaces

### Cobalt exception (logo only)

On a cobalt background, the gradient mark's right end (cobalt) disappears. Switch to `lockup-lavender.svg` / `mark-lavender.svg` (solid lavender stroke). Applies to: for-companies hero, cobalt CTA cards, employer email headers. For cobalt *pills* or accents *inside* a lavender layout, the gradient mark still works (mark isn't touching cobalt).

### Accessibility

- Ink `#1A0D2E` on lavender `#E8DEF5` clears **WCAG AAA** for body text
- Lime backgrounds need **ink** text — never white
- Cobalt and ink-dark backgrounds need **lavender** text — never gray
- Test contrast on every new section. Target: **AAA for body, AA for large display.**

---

## 2. Typography

One typeface — **Inter** — across all weights 400, 500, 600, 700, 800, 900. No fallback substitution in headlines.

```css
font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
```

### Type scale

| Role | Weight | Size | Tracking | Line-height | Case |
|---|---|---|---|---|---|
| Display | 900 | 72–96 px | -0.04 em | 0.95 | lowercase |
| H1 | 800 | 36–48 px | -0.025 em | 1.05 | lowercase |
| H2 | 800 | 24–28 px | -0.015 em | normal | lowercase |
| H3 | 700 | 18–20 px | normal | normal | lowercase |
| Body | 400 / 500 | 14–16 px | normal | 1.55 | sentence |
| Label / Caps | 600 | 10–11 px | 0.1 em | normal | UPPERCASE |

### Casing rules

- **Headlines are lowercase.** No exceptions.
- **Labels are UPPERCASE** with tracking 0.1em (e.g., `JOIN EARLY ACCESS · HOUSTON, TX`).
- Proper nouns get cased correctly inside body copy.
- **Brand name is always `internjobs.ai`** — lowercase, including the dot.

---

## 3. Logo Assets

Source: `~/Downloads/logo_pack/`. Commit to `apps/marketing/public/logo/`.

### SVG (7 variants — vector, prefer over PNG)

| File | Use when |
|---|---|
| `lockup-gradient-ink.svg` | **PRIMARY** · on lavender, lime, tangerine, white surfaces |
| `lockup-gradient-lavender.svg` | on ink (dark mode, dark hero) |
| `lockup-lavender.svg` | on cobalt and any saturated dark background (cobalt exception) |
| `lockup-ink.svg` | mono · print, fax, partner co-brands |
| `mark-gradient.svg` | mark only · primary · on lavender/ink/lime/tangerine/white |
| `mark-lavender.svg` | mark only · on cobalt + dark backgrounds |
| `mark-ink.svg` | mark only · mono · light backgrounds |

### PNG (28 variants — `png/` subdir)

- **Marks (2:1 aspect):** 256w / 512w / 1024w / 2048w
- **Lockups (7:1 aspect):** 512w / 1024w / 2048w / 4096w
- All transparent backgrounds

### Sizing & clearspace

- **Mark min:** 28px digital · 12mm print
- **Lockup min:** 120px digital · 40mm print
- **Clearspace:** equal to the mark's height around the entire logo. Nothing else inside that buffer.
- **Aspect:** mark 2:1, lockup 7:1. Never stretch/skew.

### Technical notes

- Gradient is a single linear gradient: lime `#CAFF4D` → tangerine `#FF7A3A` → cobalt `#3855FF`, left to right
- Stroke caps rounded; stroke width 6 in 64×32 viewBox (~9.4% of height)
- Wordmark is Inter Extra Bold (800) at -2% letter spacing, lowercase
- Don't recolor gradient stops, outline the mark, add shadows/glows, stretch, skew, or separate mark+wordmark (except at favicon sizes)

---

## 4. Section Playbook

Each marketing surface picks ONE accent and stays in its lane.

### Lime — hero / default / signup

- **Use on:** homepage hero, waitlist, social posts, paid ads, recruiter outreach, anything in the marketing funnel BEFORE someone commits
- **Mood:** "come in, this is going to be fun and fast"
- **Copy rules:**
  - lowercase headlines, no exceptions
  - punctuation accent (dot or comma) in lime — ONE accent shape per headline
  - CTAs are lime pills with ink text + `→` arrow, lowercase button copy
  - three-bullet supporting line, separated by middle dots (`·`)

**Example hero:**
> internjobs**,** in your dms**.**  *(comma in lime, dot in lime)*
> no resumes · no cover letters · just texts
> [get on the list →]  *(lime pill, ink text)*

### Tangerine — urgency

- **Use on:** application deadlines, cohort intakes, batch hires, "we only take X students per semester"
- **Mood:** real countdown only — don't manufacture urgency
- **Copy rules:**
  - Headlines reference time/movement: "moving fast", "closes friday", "last week"
  - Always include a number when possible: "847 spots", "3 days left", "12 of 50 filled"
  - CTAs use scarcity action verbs: "claim", "lock in", "grab"
  - Never combine tangerine + lime or cobalt on the same page

**Example:**
> your next internship is moving fast**.**
> 847 spots left · closes friday · spring intake
> [claim a spot →]  *(tangerine pill)*

### Cobalt — employers / trust

- **Use on:** /startups (for-companies) pages, data sections, press, trust signals
- **Mood:** definitive, opinionated, slightly sharp
- **Copy rules:**
  - Headlines lean on contrast — "X, not Y"
  - Supporting bullets emphasize quality, speed, zero friction: "vetted", "minutes", "no fee"
  - CTAs are cobalt pills with lavender text. Button copy stays lowercase.
  - Data viz on cobalt pages can use lime/tangerine inside charts only — never as section accents

**Example:**
> hire interns by text**,** not by tower of resumes**.**
> vetted students · matched in minutes · no platform fee
> [post a role →]  *(cobalt pill, lavender text)*

---

## 5. Voice & Copy

**We talk like texts, not like ads.**

| Principle | Rule |
|---|---|
| **DIRECT** | Say the thing in the fewest words. No setup, no hedging, no "in today's competitive landscape." |
| **LOWERCASE** | Headlines + body lowercase. Feels like a friend's message, not a brochure. Proper nouns + acronyms cased correctly. |
| **SPECIFIC** | Numbers over adjectives. "847 spots left" beats "limited availability." "matched in minutes" beats "fast turnaround." |
| **PLAYFUL, NOT SILLY** | Punch with wordplay (arcade × playground). No memes, no slang we don't own, no jokes that age in a week. |

### Say this · Don't say that

| ✅ Say | ❌ Don't say |
|---|---|
| internships, in your dms. | Unlock Your Career Potential Today |
| 847 spots left. closes friday. | Apply soon — spots are filling up |
| hire interns by text. | Streamline Your Talent Acquisition Pipeline |
| no resumes. no cover letters. just texts. | A revolutionary new way to connect with talent |
| get on the list → | Sign Up For Our Newsletter Today |

### Punctuation accents

The dot and the comma in headlines are colored in the section's accent — **implemented as inline `<span>` elements, NOT background images**:

```html
<h1>internjobs<span class="accent-comma">,</span> in your dms<span class="accent-dot">.</span></h1>
```

```css
.accent-dot, .accent-comma { color: var(--lime); }
[data-accent="tangerine"] .accent-dot { color: var(--tangerine); }
[data-accent="cobalt"]    .accent-dot { color: var(--cobalt); }
```

---

## 6. Handoff Checklist (developer)

- [ ] Tokens loaded as CSS variables (or design-system primitives) — **never hex literals in components**
- [ ] **One accent attribute per page-level layout** (`data-accent="lime|tangerine|cobalt"`). Components inherit; don't override.
- [ ] Inter loaded with all weights 400 → 900. **No fallback substitution allowed in headlines.**
- [ ] Contrast checked on every section before merge. **AAA for body, AA for large display.**
- [ ] Punctuation accents (lime/tangerine/cobalt dots and commas) implemented as inline spans, not images.
- [ ] No `#FFFFFF` / `white` / pure black / gray-fill anywhere in marketing styles.
- [ ] Logo respects clearspace (1× mark height) and minimum sizes (28px mark / 120px lockup).
- [ ] Favicon, Apple touch icon, OG image (1200×630) all derived from the logo pack.
- [ ] Default when in doubt: **lavender + ink + lime.**

---

## 7. Asset Inventory (logo_pack source)

Source on disk: `/Users/rajren/Downloads/logo_pack/` — copy to `apps/marketing/public/logo/` and `apps/marketing/public/og/`.

```
logo_pack/
├── README.md                        (one-page editor cheatsheet)
├── lockup-gradient-ink.svg          (PRIMARY)
├── lockup-gradient-lavender.svg
├── lockup-ink.svg
├── lockup-lavender.svg              (cobalt exception)
├── mark-gradient.svg
├── mark-ink.svg
├── mark-lavender.svg
└── png/                             (28 raster fallbacks)
    ├── lockup-gradient-ink_{512,1024,2048,4096}w.png
    ├── lockup-gradient-lavender_{512,1024,2048,4096}w.png
    ├── lockup-ink_{512,1024,2048,4096}w.png
    ├── lockup-lavender_{512,1024,2048,4096}w.png
    ├── mark-gradient_{256,512,1024,2048}w.png
    ├── mark-ink_{256,512,1024,2048}w.png
    └── mark-lavender_{256,512,1024,2048}w.png
```

---

*Questions → `brand@internjobs.ai`*
