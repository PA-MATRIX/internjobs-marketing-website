// WSTEST-02: admin-employees route smoke.
// GET /api/admin/employees/list — requires operator role; without it returns 403.
// Tests the route is mounted and auth middleware fires.
//
// Auth note: tests use the inner `app` (no Clerk wrapper). Auth-gated routes
// return 401 by design in this harness. The assertion is "route is mounted,
// not 404, not 500" — see workers/tests/helpers.ts for full explanation.
import { describe, it, expect, vi, afterEach } from "vitest";
import { app } from "../../index";
import { minimalEnv, devHeaders, mockCtx } from "../helpers";

afterEach(() => vi.restoreAllMocks());

describe("admin-employees route smoke", () => {
	it("GET /api/admin/employees/list returns 401 without dev headers", async () => {
		const req = new Request(
			"https://parrot.example.com/api/admin/employees/list",
		);
		const res = await app.fetch(
			req,
			{ ...minimalEnv, PARROT_DEV_MODE: undefined } as any,
			mockCtx,
		);
		// No Clerk session, no dev header → 401 (requireEmployeeMailbox) or
		// 302 redirect to /sign-in.
		expect([401, 302]).toContain(res.status);
	});

	it("GET /api/admin/employees/list with dev employee headers reaches the route (not 404/500)", async () => {
		// The inner app has no Clerk wrapper / dev-bypass, so c.var.employee is
		// unset and requireEmployeeMailbox returns 401. Either way: not 404
		// (route exists) and not 500 (no crash).
		const req = new Request(
			"https://parrot.example.com/api/admin/employees/list",
			{
				headers: devHeaders,
			},
		);
		// Stub WorkspaceDO-bound fetch for the operator check (listEmployees returns []).
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(new Response("[]", { status: 200 })),
		);
		const res = await app.fetch(req, minimalEnv as any, mockCtx);
		// Not 404 (route is mounted) and not 500 (no unhandled crash).
		expect(res.status).not.toBe(404);
		expect(res.status).not.toBe(500);
	});
});
