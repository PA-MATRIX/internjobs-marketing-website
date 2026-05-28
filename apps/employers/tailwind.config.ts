import type { Config } from "tailwindcss";

// Brand v1.0 tokens mirrored from apps/marketing/tailwind.config.ts so the
// startups subdomain inherits the same lavender-anchor + ink-text + cobalt-
// accent surface. Color values resolve via CSS vars defined in src/styles.css
// (single source of truth).
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        lavender: "var(--lavender)",
        ink: "var(--ink)",
        lime: "var(--lime)",
        tangerine: "var(--tangerine)",
        cobalt: "var(--cobalt)",
        cream: "var(--cream)",
        // canvas remaps to lavender per BRAND-V1 lavender-anchor rule.
        canvas: "var(--lavender)",
      },
      borderRadius: {
        card: "var(--radius-card)",
        pill: "var(--radius-pill)",
        mark: "var(--radius-mark)",
      },
      fontSize: {
        display: [
          "clamp(72px, 8vw, 96px)",
          { lineHeight: "0.95", letterSpacing: "-0.04em", fontWeight: "900" },
        ],
        h1: [
          "clamp(36px, 4vw, 48px)",
          { lineHeight: "1.05", letterSpacing: "-0.025em", fontWeight: "800" },
        ],
        h2: [
          "clamp(24px, 2.5vw, 28px)",
          { lineHeight: "normal", letterSpacing: "-0.015em", fontWeight: "800" },
        ],
        h3: [
          "clamp(18px, 2vw, 20px)",
          { lineHeight: "normal", letterSpacing: "normal", fontWeight: "700" },
        ],
        label: [
          "clamp(10px, 1vw, 11px)",
          { lineHeight: "normal", letterSpacing: "0.1em", fontWeight: "600" },
        ],
      },
      fontFamily: {
        sans: [
          "Inter",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "sans-serif",
        ],
      },
    },
  },
  plugins: [],
} satisfies Config;
