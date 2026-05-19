// v1.2 Phase 10 Wave 1: Parrot internal employee workspace.
// Vite config mirrors apps/agentic-inbox/vite.config.ts — no Parrot-specific
// diffs yet. Future waves may add chat/meeting plugins here.

import { reactRouter } from "@react-router/dev/vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [
    cloudflare({ viteEnvironment: { name: "ssr" } }),
    tailwindcss(),
    reactRouter(),
    tsconfigPaths(),
  ],
});
