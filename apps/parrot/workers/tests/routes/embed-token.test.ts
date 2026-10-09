// Phase 32 (32-01): embed-token route smoke.
// POST /api/embed/parrot-token — mints the Parrot embed JWT.
//
// Auth note: inner app, no Clerk wrapper → c.var.employee is never set, so
// requireEmployeeMailbox short-circuits with 401. Assertion is "route is
// mounted" (never 404). See helpers.ts. The real crypto round-trip is
// exercised in workers/tests/lib/embed-jwt.test.ts; this only proves wiring.
import { describe, it, expect } from "vitest";
import { app } from "../../index";
import { minimalEnv, devHeaders, mockCtx } from "../helpers";

describe("embed token route smoke", () => {
	it("POST /api/embed/parrot-token is mounted (not 404)", async () => {
		const req = new Request(
			"https://parrot.example.com/api/embed/parrot-token",
			{ method: "POST", headers: { ...devHeaders } },
		);
		const res = await app.fetch(req, minimalEnv as any, mockCtx);
		// Inner app has no c.var.employee → requireEmployeeMailbox returns 401.
		// Never 404 (route must be mounted).
		expect(res.status).not.toBe(404);
	});
});
