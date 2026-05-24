import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Brand v1.0 tokens (reference CSS vars so a single source of truth)
        lavender: "var(--lavender)",
        ink: "var(--ink)",
        lime: "var(--lime)",
        tangerine: "var(--tangerine)",
        cobalt: "var(--cobalt)",
        cream: "var(--cream)",
        // Legacy tokens — retained until 22-04 surface audit replaces them
        canvas: "#FBF7EF",
        "ink-legacy": "#111111",
        "ink-secondary": "#555555",
        "accent-blue": "#111111",
        "accent-blue-hover": "#2A2A2A",
        electric: {
          blue: "#2F80FF",
          violet: "#8B5CF6",
          cyan: "#67E8F9",
          green: "#49D17D",
          amber: "#F9B24A",
        },
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
      boxShadow: {
        glow: "0 0 70px rgba(47, 128, 255, 0.24)",
        phone: "0 30px 90px rgba(0, 0, 0, 0.55), inset 0 0 0 1px rgba(255,255,255,0.08)",
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
