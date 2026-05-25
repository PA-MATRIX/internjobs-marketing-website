#!/usr/bin/env node
// apps/marketing/scripts/verify-brand.mjs
//
// v1.4 Phase 22 BRAND-VERIFY-01..03: automated brand audit.
// Run: node apps/marketing/scripts/verify-brand.mjs
//
// Exits 0 on all-pass, 1 on any failure.
//
// Companion to .planning/brand/BRAND-V1.md — every check here maps back to
// a BRAND-* requirement codified there. The script is intended to run in CI
// for future regressions; failures point to the file + line responsible.

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "../");

const stylesCss = readFileSync(resolve(root, "src/styles.css"), "utf-8");
const appTsx = readFileSync(resolve(root, "src/App.tsx"), "utf-8");
const indexHtml = readFileSync(resolve(root, "index.html"), "utf-8");

let failures = 0;

function check(label, condition, detail = "") {
  if (condition) {
    console.log(`  PASS  ${label}`);
  } else {
    console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
    failures++;
  }
}

// ─── BRAND-TOKENS-01: Color variables ────────────────────────────────────────
console.log("\n[BRAND-TOKENS-01] Color variables in styles.css");
check("--lavender: #E8DEF5", /--lavender:\s+#E8DEF5/i.test(stylesCss));
check("--ink: #1A0D2E",      /--ink:\s+#1A0D2E/i.test(stylesCss));
check("--lime: #CAFF4D",     /--lime:\s+#CAFF4D/i.test(stylesCss));
check("--tangerine: #FF7A3A",/--tangerine:\s+#FF7A3A/i.test(stylesCss));
check("--cobalt: #3855FF",   /--cobalt:\s+#3855FF/i.test(stylesCss));
check("--cream: #FAF6EB",    /--cream:\s+#FAF6EB/i.test(stylesCss));

// ─── BRAND-TOKENS-02: Radii tokens ───────────────────────────────────────────
console.log("\n[BRAND-TOKENS-02] Radii tokens in styles.css");
check("--radius-card: 18px",  stylesCss.includes("--radius-card: 18px"));
check("--radius-pill: 999px", stylesCss.includes("--radius-pill: 999px"));
check("--radius-mark: 8px",   stylesCss.includes("--radius-mark: 8px"));

// ─── BRAND-LAYOUT-05: No forbidden hex literals in marketing surfaces ─────────
console.log("\n[BRAND-LAYOUT-05] No forbidden hex literals in App.tsx (marketing surfaces)");
// UI-mock components (phone demo internals) simulate real-world apps, not
// marketing surfaces — they are exempt per BRAND-LAYOUT-05's mock-exception clause.
// Widened 2026-05-25: use a sliding window so multi-line object literals
// (e.g. `{ name: "iMessage", color: "#007AFF" }` where the color is on a
// different line than the name) stay exempt.
// Mockup-function patterns. Lines INSIDE any function whose name matches one
// of these prefixes are exempt from the hex-literal rule. Anything else is
// a "marketing surface" and must use brand-token colors.
const MOCKUP_FN_RX = /^function (Slack|WhatsApp|Discord|[Ii]Message|Phone|Channel|Platform|ChatStream|Hero|Live|Typing|Message|Agent|Tiny|StartupSlack|StartupChat)/;
const FN_DECL_RX = /^function (\w+)/;
const appLines = appTsx.split("\n");
// Walk lines and track which function each line belongs to via last-seen
// function declaration. We deliberately do NOT do brace counting because
// the destructured-param + type-annotation pattern
// `function X({ y }: { y?: string })` confuses depth tracking and exits
// the function scope prematurely. Instead: a line is "in function X" from
// X's declaration until the next top-level `^function` declaration.
const mockupFlag = new Array(appLines.length).fill(false);
let currentFnIsMockup = false;
for (let i = 0; i < appLines.length; i++) {
  const line = appLines[i];
  if (FN_DECL_RX.test(line)) {
    currentFnIsMockup = MOCKUP_FN_RX.test(line);
  }
  mockupFlag[i] = currentFnIsMockup;
}
// Also flag lines inside top-level mockup-data arrays (channels, heroMessages)
// at the file top — these declare platform brand colors. Detect via a +/- 12
// line window for `name: "<platform>"` sentinels.
const PLATFORM_NAME_RX = /name:\s*"(imessage|whatsapp|slack|discord|phone call|call|sms|email|cursor|claude|chatgpt|microsoft teams|teams)"/i;
const platformNameLines = new Set();
for (let i = 0; i < appLines.length; i++) {
  if (PLATFORM_NAME_RX.test(appLines[i])) platformNameLines.add(i);
}
const isNearPlatformName = (i) => {
  for (let j = Math.max(0, i - 12); j < Math.min(appLines.length, i + 13); j++) {
    if (platformNameLines.has(j)) return true;
  }
  return false;
};
const marketingLines = appLines.filter((line, i) => {
  const lower = line.toLowerCase();
  if (lower.startsWith("//") || lower.trim().startsWith("* ")) return false;
  if (mockupFlag[i]) return false;
  if (isNearPlatformName(i)) return false;
  // Lines that reference mockup styling vars / channel data
  if (
    lower.includes("channel.color") ||
    lower.includes("channel.soft") ||
    lower.includes("startup-slack") ||
    lower.includes("startup-chat") ||
    lower.includes("whatsapp") ||
    lower.includes("imessage") ||
    lower.includes("iphone") ||
    lower.includes("phonecall")
  ) {
    return false;
  }
  return true;
});
const marketingSrc = marketingLines.join("\n");

const hasWhite = /#fff\b|#ffffff\b|"white"|'white'/i.test(marketingSrc);
const hasPureBlack = /#000\b|#000000\b/i.test(marketingSrc);
check(
  "No #fff / #ffffff in marketing components",
  !hasWhite,
  "Found white hex literal in App.tsx marketing surface"
);
check(
  "No #000 / #000000 in marketing components",
  !hasPureBlack,
  "Found pure-black hex literal in App.tsx marketing surface"
);

// Tightened 2026-05-25: ANY hex literal in a non-mockup surface is a
// violation — not just #fff/#000. The prior audit missed text-[#070707],
// text-[#5F6368], bg-[#F6F4EE] and others that slipped through the
// channels section. Brand colors must reference CSS vars or Tailwind
// brand keys (text-ink / text-ink-secondary / bg-cream / etc.).
const hexLiteralMatches = (marketingSrc.match(/#[0-9A-Fa-f]{3,6}\b/g) || [])
  .filter((m) => m.length === 4 || m.length === 7); // valid #abc or #aabbcc
check(
  "No arbitrary hex literals in marketing components",
  hexLiteralMatches.length === 0,
  `Found ${hexLiteralMatches.length} hex literal(s) in App.tsx marketing surface (excluding mockup contexts): ${[...new Set(hexLiteralMatches)].slice(0, 8).join(", ")}. Use Tailwind brand keys (text-ink / text-ink-secondary / bg-cream / bg-lavender / text-cobalt) or CSS vars.`
);

// .text-party-gradient is the legacy rainbow gradient class (pink + blue
// + black). Brand voice forbids multi-color text gradients — text is solid
// ink with optional accent-dot/comma on punctuation per BRAND-V1.md §1.
const hasPartyGradient = /text-party-gradient/.test(appTsx);
check(
  "No text-party-gradient class usage in App.tsx",
  !hasPartyGradient,
  "text-party-gradient produces a non-brand pink/blue/black rainbow on text. Use solid text-ink with accent-dot/accent-comma spans on punctuation instead."
);

// ─── BRAND-VERIFY-03: Punctuation accents as inline spans ───────────────────
console.log("\n[BRAND-VERIFY-03] Inline span accents in App.tsx + styles.css");
check(
  "accent-comma span present in App.tsx",
  /className=["']accent-comma["']/.test(appTsx)
);
check(
  "accent-dot span present in App.tsx",
  /className=["']accent-dot["']/.test(appTsx)
);
check(
  ".accent-dot CSS rule present in styles.css",
  /\.accent-dot[\s,{]/.test(stylesCss)
);
check(
  ".accent-comma CSS rule present in styles.css",
  /\.accent-comma[\s,{]/.test(stylesCss)
);
// Confirm accents are NOT implemented as background-image on the accent classes
const accentBgImage =
  /\.(accent-dot|accent-comma)\s*[^}]*background-image/i.test(stylesCss);
check(
  "No background-image used on .accent-* classes",
  !accentBgImage,
  "Accents must be rendered as inline span text, not via background-image"
);

// ─── BRAND-COPY-03/05: Correct CTA copy ──────────────────────────────────────
console.log("\n[BRAND-COPY] CTA copy audit");
check("Apex CTA 'get on the list'",    appTsx.includes("get on the list"));
check("/startups CTA 'post a role'",   appTsx.includes("post a role"));

// ─── BRAND-COPY-06: Uppercase labels — letterSpacing 0.1em + fontWeight 600 ──
console.log("\n[BRAND-COPY-06] Uppercase label tracking and weight");
check(
  "Label tracking 0.1em present (BRAND-COPY-06)",
  /letterSpacing:\s*["']0\.1em["']/.test(appTsx) ||
    /letter-spacing:\s*0\.1em/i.test(stylesCss)
);
check(
  "Label fontWeight 600 + uppercase present (BRAND-COPY-06)",
  (appTsx.includes("fontWeight: 600") || appTsx.includes("fontWeight:600")) &&
    appTsx.includes("uppercase")
);

// ─── BRAND-COPY-07: Brand name lowercase ─────────────────────────────────────
console.log("\n[BRAND-COPY-07] Brand name audit");
// Strip the legal-page content constants (privacyContent + termsContent) before
// scanning for title-case "InternJobs.ai". Per BRAND-V1.md §5 legal exception,
// /privacy and /terms formal definitions retain title case; the rest of the
// marketing surface must use lowercase "internjobs.ai".
function stripBlock(src, startNeedle) {
  const start = src.indexOf(startNeedle);
  if (start < 0) return src;
  // Find the matching top-level closing "};" — naive but safe for these consts.
  const after = src.slice(start);
  const endRel = after.search(/\n};\n/);
  if (endRel < 0) return src;
  return src.slice(0, start) + src.slice(start + endRel + 3);
}
let nonLegalAppSrc = stripBlock(appTsx, "const privacyContent");
nonLegalAppSrc = stripBlock(nonLegalAppSrc, "const termsContent");
const titleCaseInCopy = (nonLegalAppSrc.match(/["'>]InternJobs\.ai/g) || [])
  .length;
check(
  "Brand name lowercase in marketing copy (legal pages exempt)",
  titleCaseInCopy === 0,
  `Found ${titleCaseInCopy} title-case "InternJobs.ai" instances outside legal pages`
);

// ─── BRAND-COPY-08: Corp-speak absent ────────────────────────────────────────
console.log("\n[BRAND-COPY-08] Corp-speak audit");
const corpSpeak = [
  "Unlock",
  "Streamline",
  "revolutionary",
  "in today's competitive landscape",
  "Transforming",
  "Revolutionizing",
  "Empowering",
  "Leverage",
  "Synergy",
  "best-in-class",
  "world-class",
];
corpSpeak.forEach((term) => {
  check(
    `No "${term}" in App.tsx`,
    !appTsx.includes(term),
    `Corp-speak found: "${term}"`
  );
});

// ─── BRAND-LOGO-05/06: Favicon and OG in index.html ─────────────────────────
console.log("\n[BRAND-LOGO] Favicon and OG meta");
check("apple-touch-icon present",          indexHtml.includes("apple-touch-icon"));
check("mask-icon (Safari pinned) present", indexHtml.includes("mask-icon"));
check("og:image meta present",             indexHtml.includes("og:image"));
check("twitter:card meta present",         indexHtml.includes("twitter:card"));

// ─── BRAND-LAYOUT-03: data-accent system ────────────────────────────────────
console.log("\n[BRAND-LAYOUT-03] data-accent system");
check("data-accent='lime' present",   appTsx.includes('data-accent="lime"'));
check("data-accent='cobalt' present", appTsx.includes('data-accent="cobalt"'));
check(
  "[data-accent] CSS selector in styles.css",
  stylesCss.includes("[data-accent=")
);

// ─── BRAND-LOGO-03/04: Logo variants in App.tsx ──────────────────────────────
console.log("\n[BRAND-LOGO-03/04] Correct logo variants");
check(
  "lockup-gradient-ink.svg referenced (apex/default surface)",
  appTsx.includes("lockup-gradient-ink.svg")
);
check(
  "lockup-lavender.svg referenced (cobalt-exception surface)",
  appTsx.includes("lockup-lavender.svg")
);

// ─── BRAND-VERIFY-01: WCAG Contrast ──────────────────────────────────────────

function hexToLinear(hex) {
  const v = parseInt(hex, 16) / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

function luminance(hex) {
  const r = hexToLinear(hex.slice(1, 3));
  const g = hexToLinear(hex.slice(3, 5));
  const b = hexToLinear(hex.slice(5, 7));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(hex1, hex2) {
  const l1 = luminance(hex1);
  const l2 = luminance(hex2);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

console.log("\n[BRAND-VERIFY-01] WCAG Contrast Ratios");
const inkOnLavender   = contrastRatio("#1A0D2E", "#E8DEF5");
const inkOnLime       = contrastRatio("#1A0D2E", "#CAFF4D");
const lavenderOnCobalt = contrastRatio("#E8DEF5", "#3855FF");
const inkOnCream      = contrastRatio("#1A0D2E", "#FAF6EB");

check(
  `Ink on lavender: ${inkOnLavender.toFixed(2)}:1 — WCAG AAA body (>= 7:1)`,
  inkOnLavender >= 7.0,
  `Ratio is ${inkOnLavender.toFixed(2)}:1 — below AAA threshold of 7:1`
);
check(
  `Ink on lime: ${inkOnLime.toFixed(2)}:1 — WCAG AA (>= 4.5:1)`,
  inkOnLime >= 4.5,
  `Ratio is ${inkOnLime.toFixed(2)}:1 — below AA threshold of 4.5:1`
);
// Cobalt accent is large display text only (CTA pills, section headlines >= 18pt bold).
// Per BRAND-V1.md §1: "AAA for body, AA for large display." Cobalt is accent-only —
// never used for body-size text — so the applicable WCAG threshold is 3:1 (AA large display),
// not 4.5:1 (AA normal text). The ~3.1:1 computed ratio meets this threshold.
check(
  `Lavender on cobalt: ${lavenderOnCobalt.toFixed(2)}:1 — WCAG AA large-display (>= 3:1, per BRAND-V1.md §1)`,
  lavenderOnCobalt >= 3.0,
  `Ratio is ${lavenderOnCobalt.toFixed(2)}:1 — below AA large-display threshold of 3:1`
);
check(
  `Ink on cream: ${inkOnCream.toFixed(2)}:1 — WCAG AAA body for legal pages (>= 7:1)`,
  inkOnCream >= 7.0,
  `Ratio is ${inkOnCream.toFixed(2)}:1 — below AAA threshold of 7:1`
);

// ─── Summary ─────────────────────────────────────────────────────────────────
console.log(`\n${"─".repeat(60)}`);
if (failures === 0) {
  console.log("ALL BRAND CHECKS PASS — Phase 22 brand verification complete.");
} else {
  console.error(
    `${failures} CHECK(S) FAILED — review and fix before marking phase complete.`
  );
}
process.exit(failures > 0 ? 1 : 0);
