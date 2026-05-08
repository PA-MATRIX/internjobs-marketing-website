import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        canvas: "#FBF7EF",
        ink: "#111111",
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
