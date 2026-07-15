// Phase 32 (32-02): CSP frame-src header integration test.
//
// Exercises the ACTUAL middleware in workers/app.ts (not a replica) by calling
// the worker's default export `fetch` against /api/health — a route that skips
// the Clerk auth middleware, so no JWKS/session is needed. This is a
// repeatable, offline proxy for the plan's manual `curl -sI` check.
//
// It also guards the "don't break Clerk" invariant at the header level: the
// policy must be frame-src ONLY, with NO restrictive default-src (a default-src
// is exactly what would block Clerk's inline scripts / embedded frames). The
// live browser sign-in remains the gold-standard check, but this pins the
// header shape so a future edit can't silently introduce a broader policy.

import { describe, it, expect } from "vitest";
import worker from "../app";
import type { Env } from "../types";

const baseEnv: Partial<Env> = {
	PARROT_EMBED_URL: "https://parrot.projecta.ai/embed",
};

function call(env: Partial<Env>) {
	const req = new Request("https://workspace.internjobs.ai/api/health");
	return worker.fetch(req, env as Env, {} as ExecutionContext);
}

describe("Content-Security-Policy frame-src header", () => {
	it("is present on a no-auth response and allows the Parrot origin", async () => {
		const res = await call(baseEnv);
		expect(res.status).toBe(200);
		expect(res.headers.get("content-security-policy")).toBe(
			"frame-src 'self' https://parrot.projecta.ai;",
		);
	});

	it("derives the frame origin from PARROT_EMBED_URL (single source of truth)", async () => {
		const res = await call({ PARROT_EMBED_URL: "https://staging.parrot.dev/embed?x=1" });
		expect(res.headers.get("content-security-policy")).toBe(
			"frame-src 'self' https://staging.parrot.dev;",
		);
	});

	it("falls back to the known-good default when PARROT_EMBED_URL is malformed", async () => {
		const res = await call({ PARROT_EMBED_URL: "not-a-url" });
		expect(res.headers.get("content-security-policy")).toBe(
			"frame-src 'self' https://parrot.projecta.ai;",
		);
	});

	it("sets NO restrictive default-src (would break Clerk inline scripts/frames)", async () => {
		const res = await call(baseEnv);
		const csp = res.headers.get("content-security-policy") ?? "";
		expect(csp).not.toContain("default-src");
		expect(csp).not.toContain("script-src");
	});
});
