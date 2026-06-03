// workers/tests/helpers.ts
// Test helpers shared across route smoke tests.
//
// AUTH NOTE: These tests import `{ app }` from `workers/index.ts`, which is
// the inner Hono app. The Clerk authentication middleware — AND the
// X-Parrot-Dev-Employee dev-bypass — both live in the OUTER wrapper
// (`workers/app.ts`, the default export). The inner `app` never populates
// `c.var.employee`, so the `requireEmployeeMailbox` middleware in
// workers/lib/mailbox.ts short-circuits with 401 on every auth-gated route.
//
// This is intentional and correct for a smoke baseline. The assertions
// throughout use `!== 404 && !== 500` (i.e. "route is mounted and not
// crashing") rather than asserting 200. Sending dev headers does NOT change
// the outcome here because the dev-bypass lives in the outer wrapper we are
// deliberately skipping — the headers are included only to document intent
// and to keep the tests forward-compatible if a future enhancement injects
// a mock `employee` into Hono context.
//
// Routes that are genuinely public (no auth) — e.g. /healthz, /oidc/... —
// will return 200 as expected.

import type { Env } from "../types";

/** Minimal Env stub for tests that don't hit real external services. */
export const minimalEnv: Partial<Env> = {
	MATTERMOST_URL: "https://mattermost.example.com",
	MATTERMOST_BOT_TOKEN: undefined,
	DAILY_API_KEY: undefined,
	GRAPH_API_URL: undefined,
	GRAPH_API_SECRET: undefined,
	PARROT_DEV_MODE: "1", // enables X-Parrot-Dev-Employee bypass in the OUTER wrapper (not the inner app)
};

export const devHeaders = {
	"X-Parrot-Dev-Employee": "test-emp-123",
	"X-Parrot-Dev-Email": "test@internjobs.ai",
	"X-Parrot-Dev-Name": "Test Employee",
};

/** Stub ExecutionContext. */
export const mockCtx = {
	waitUntil: () => {},
	passThroughOnException: () => {},
} as unknown as ExecutionContext;
