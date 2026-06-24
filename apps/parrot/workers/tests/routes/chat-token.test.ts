// workers/tests/routes/chat-token.test.ts
// CHAT-HARD-02 (plan 31-06): Vitest smoke coverage for Wave 0 token routes.
//
// Wave 0 (plan 31-01) provisions a per-employee Mattermost personal access
// token (PAT) so the Worker proxies AS the employee instead of the parrot bot.
// The operator-gated backfill endpoint mints PATs for existing employees, and
// every /api/chat/* posting route resolves the employee's PAT before calling MM.
//
// AUTH NOTE (see workers/tests/helpers.ts): these tests import the INNER Hono
// `app` from workers/index.ts. The Clerk wrapper + dev-bypass live in the OUTER
// wrapper (workers/app.ts), so c.var.employee is never populated and
// requireEmployeeMailbox short-circuits with 401 on every auth-gated route.
// The contract asserted here is "route is mounted, auth fires, no crash"
// (not 404, not 500) — the full happy-path is covered by the lib-level unit
// tests (workers/tests/lib/mattermost-pat.test.ts) and live UAT in 31-06.

import { describe, it, expect, vi, afterEach } from "vitest";
import { app } from "../../index";
import type { Env } from "../../types";

const mockEnv: Partial<Env> = {
	MATTERMOST_URL: "https://mattermost.example.com",
	MATTERMOST_BOT_TOKEN: "bot-token",
	MATTERMOST_ADMIN_TOKEN: "admin-token",
};

afterEach(() => vi.unstubAllGlobals());

describe("POST /api/admin/chat/backfill-tokens", () => {
	it("returns 401/403 without a Clerk session (operator gate fires)", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockRejectedValue(new Error("not called in unit test")),
		);
		const req = new Request(
			"https://parrot.example.com/api/admin/chat/backfill-tokens",
			{ method: "POST" },
		);
		const res = await app.fetch(req, mockEnv as Env, {} as ExecutionContext);
		// requireEmployeeMailbox returns 401 (no employee), or the operator gate
		// returns 403 — either way the route is protected.
		expect([401, 403]).toContain(res.status);
	});

	it("route is mounted (not 404) and does not crash (not 500)", async () => {
		const req = new Request(
			"https://parrot.example.com/api/admin/chat/backfill-tokens",
			{ method: "POST" },
		);
		const res = await app.fetch(req, mockEnv as Env, {} as ExecutionContext);
		expect(res.status).not.toBe(404);
		expect(res.status).not.toBe(500);
	});
});

describe("POST /api/chat/posts (per-employee PAT proxy)", () => {
	it("returns 401/403 without auth before any MM call", async () => {
		const req = new Request("https://parrot.example.com/api/chat/posts", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ channel_id: "chan1", message: "hello" }),
		});
		const res = await app.fetch(req, mockEnv as Env, {} as ExecutionContext);
		expect([401, 403]).toContain(res.status);
	});
});

describe("GET /api/chat/bootstrap", () => {
	it("returns 401/403 without auth (route mounted, not 404)", async () => {
		const req = new Request("https://parrot.example.com/api/chat/bootstrap");
		const res = await app.fetch(req, mockEnv as Env, {} as ExecutionContext);
		expect([401, 403]).toContain(res.status);
		expect(res.status).not.toBe(404);
	});
});
