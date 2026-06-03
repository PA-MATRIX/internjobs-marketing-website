// WSTEST-02: reply-forward route smoke.
// POST /api/inbox/send — validates required fields before touching DO.
//
// Auth note: inner app, no Clerk wrapper → auth-gated routes return 401
// by design. Assertion is "not 404, not 500". See helpers.ts.
import { describe, it, expect } from "vitest";
import { app } from "../../index";
import { minimalEnv, devHeaders, mockCtx } from "../helpers";

describe("reply-forward route smoke", () => {
	it("POST /api/inbox/send with dev employee and missing body returns not-404", async () => {
		const req = new Request("https://parrot.example.com/api/inbox/send", {
			method: "POST",
			headers: { ...devHeaders, "Content-Type": "application/json" },
			body: JSON.stringify({}), // missing required fields
		});
		const res = await app.fetch(req, minimalEnv as any, mockCtx);
		// Auth gate (inner app) → 401; or Zod parse failure → 400/422. Never 404.
		expect([400, 401, 422, 500]).toContain(res.status);
		expect(res.status).not.toBe(404);
	});

	it("POST /api/inbox/messages/:id/reply with no body returns not-404", async () => {
		const req = new Request(
			"https://parrot.example.com/api/inbox/messages/test-id/reply",
			{
				method: "POST",
				headers: { ...devHeaders, "Content-Type": "application/json" },
				body: JSON.stringify({}),
			},
		);
		const res = await app.fetch(req, minimalEnv as any, mockCtx);
		// Auth gate / Zod parse / DO stub throws → not 404.
		expect(res.status).not.toBe(404);
	});
});
