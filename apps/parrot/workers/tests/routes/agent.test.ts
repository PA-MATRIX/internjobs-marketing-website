// WSTEST-02: agent route smoke.
// GET /api/inbox/agent/tools — returns the agent tools catalog.
//
// Auth note: inner app, no Clerk wrapper → auth-gated routes return 401
// by design. Assertion is "not 404, not 500". See helpers.ts.
import { describe, it, expect, vi, afterEach } from "vitest";
import { app } from "../../index";
import { minimalEnv, devHeaders, mockCtx } from "../helpers";

afterEach(() => vi.restoreAllMocks());

describe("agent route smoke", () => {
	it("GET /api/inbox/agent/tools with dev employee returns not-404 and not-500", async () => {
		const req = new Request(
			"https://parrot.example.com/api/inbox/agent/tools",
			{
				headers: devHeaders,
			},
		);
		const res = await app.fetch(req, minimalEnv as any, mockCtx);
		// Route is mounted and responds — not 404, no crash.
		expect(res.status).not.toBe(404);
		expect(res.status).not.toBe(500);
		if (res.status === 200) {
			const body = (await res.json()) as Record<string, unknown>;
			expect(Array.isArray(body.tools)).toBe(true);
		}
	});
});
