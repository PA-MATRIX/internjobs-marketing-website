// WSTEST-04: inbox-actions route smoke.
// POST /api/inbox/messages/:id/move — route mounted, not 404/500.
// DELETE /api/inbox/messages/:id — route mounted, not 404/500.
// GET /api/inbox/messages?folder=starred — route mounted, not 500.
//
// Auth note: inner app, no Clerk wrapper → auth-gated routes return 401
// by design. Assertion is "not 404, not 500". See helpers.ts.
import { describe, it, expect } from "vitest";
import { app } from "../../index";
import { minimalEnv, devHeaders, mockCtx } from "../helpers";

describe("inbox-actions route smoke", () => {
	it("POST /api/inbox/messages/:id/move with dev headers returns not-404", async () => {
		const req = new Request(
			"https://parrot.example.com/api/inbox/messages/test-id/move",
			{
				method: "POST",
				headers: { ...devHeaders, "Content-Type": "application/json" },
				body: JSON.stringify({ folder: "archive" }),
			},
		);
		const res = await app.fetch(req, minimalEnv as any, mockCtx);
		expect(res.status).not.toBe(404);
		expect(res.status).not.toBe(500);
	});

	it("DELETE /api/inbox/messages/:id with dev headers returns not-404", async () => {
		const req = new Request(
			"https://parrot.example.com/api/inbox/messages/test-id",
			{
				method: "DELETE",
				headers: devHeaders,
			},
		);
		const res = await app.fetch(req, minimalEnv as any, mockCtx);
		expect(res.status).not.toBe(404);
		expect(res.status).not.toBe(500);
	});

	it("GET /api/inbox/messages?folder=starred with dev headers returns not-500", async () => {
		const req = new Request(
			"https://parrot.example.com/api/inbox/messages?folder=starred",
			{
				method: "GET",
				headers: devHeaders,
			},
		);
		const res = await app.fetch(req, minimalEnv as any, mockCtx);
		// Auth gate → 401 is expected (not 404, not 500).
		expect(res.status).not.toBe(404);
		expect(res.status).not.toBe(500);
	});
});
