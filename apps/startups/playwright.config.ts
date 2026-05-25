// apps/startups/playwright.config.ts
// v1.4 Phase 28.5 Plan 05 STARTUP-WEB-AUTH-04 — Playwright config for the
// founder-flow E2E suite at apps/startups/e2e/.
//
// Targets:
//   • Default: production at https://startups.internjobs.ai (override via
//     TEST_BASE_URL env var for staging / wrangler-pages-dev / Vite dev).
//   • Auth-required tests are gated on PLAYWRIGHT_CLERK_TEST_TOKEN — when
//     unset, those tests are `test.skip`'d (see founder-flow.spec.ts).
//
// Run:
//   cd apps/startups && npx playwright test --reporter=line

import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
	testDir: "./e2e",
	timeout: 30_000,
	expect: { timeout: 8_000 },
	fullyParallel: true,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 1 : 0,
	workers: process.env.CI ? 2 : undefined,
	reporter: process.env.CI ? "github" : "line",
	use: {
		baseURL: process.env.TEST_BASE_URL ?? "https://startups.internjobs.ai",
		headless: true,
		trace: "retain-on-failure",
		screenshot: "only-on-failure",
	},
	projects: [
		{
			name: "chromium",
			use: { ...devices["Desktop Chrome"] },
		},
	],
});
