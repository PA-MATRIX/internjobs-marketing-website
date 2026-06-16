// WSTEST-02: ops-safety route smoke.
// GET /api/ops/safety/unreviewed-count — auth required (dev bypass usable).
//
// Auth note: inner app, no Clerk wrapper → auth-gated routes return 401
// by design. Assertion is "not 404, not 500". See helpers.ts.
import { describe, it, expect, vi, afterEach } from "vitest";
import { app } from "../../index";
import { minimalEnv, devHeaders, mockCtx } from "../helpers";

afterEach(() => vi.restoreAllMocks());

describe("ops-safety route smoke", () => {
	it("GET /api/ops/safety/unreviewed-count with dev employee returns not-404 and not-500", async () => {
		// The route calls stub.getUnreviewedCount() on the mailbox DO.
		// In the inner app, requireEmployeeMailbox fires first (no employee in
		// context) → 401. Either way: route is mounted (not 404), no unhandled
		// crash (not 500).
		const req = new Request(
			"https://parrot.example.com/api/ops/safety/unreviewed-count",
			{
				headers: devHeaders,
			},
		);
		const res = await app.fetch(req, minimalEnv as any, mockCtx);
		// Either 200 (count=0 on error path) or 401 (auth gate) — never 404/500.
		expect(res.status).not.toBe(404);
		expect(res.status).not.toBe(500);
		// The route should not crash — any defined status is acceptable here.
		expect(typeof res.status).toBe("number");
	});
});
