// workers/tests/routes/chat-channels.test.ts
// CHAT-HARD-02 (plan 31-06): Vitest smoke coverage for the channel, thread,
// post and search routes (Waves 1 + 3).
//
// AUTH NOTE (see workers/tests/helpers.ts): the inner `app` has no Clerk
// wrapper, so requireEmployeeMailbox returns 401 on every auth-gated route.
// These assertions verify each route is mounted and protected (401/403, never
// 404/500) — the happy path is covered by the lib-level mattermost-channels /
// mattermost-search-reactions unit tests and live UAT in 31-06.

import { describe, it, expect, vi, afterEach } from "vitest";
import { app } from "../../index";
import type { Env } from "../../types";

const mockEnv: Partial<Env> = {
	MATTERMOST_URL: "https://mattermost.example.com",
	MATTERMOST_BOT_TOKEN: "bot-token",
	MATTERMOST_ADMIN_TOKEN: "admin-token",
};

afterEach(() => vi.unstubAllGlobals());

describe("GET /api/chat/channels", () => {
	it("returns 401/403 without auth", async () => {
		const req = new Request("https://parrot.example.com/api/chat/channels");
		const res = await app.fetch(req, mockEnv as Env, {} as ExecutionContext);
		expect([401, 403]).toContain(res.status);
	});
});

describe("POST /api/chat/channels", () => {
	it("is protected by auth before body validation (not 404/500)", async () => {
		const req = new Request("https://parrot.example.com/api/chat/channels", {
			method: "POST",
		});
		const res = await app.fetch(req, mockEnv as Env, {} as ExecutionContext);
		// Auth middleware fires before body validation.
		expect([400, 401, 403]).toContain(res.status);
		expect(res.status).not.toBe(404);
		expect(res.status).not.toBe(500);
	});
});

describe("GET /api/chat/posts/:id/thread", () => {
	it("returns 401/403 without auth (route mounted, not 404)", async () => {
		const req = new Request(
			"https://parrot.example.com/api/chat/posts/fake-post-id/thread",
		);
		const res = await app.fetch(req, mockEnv as Env, {} as ExecutionContext);
		expect([401, 403]).toContain(res.status);
		expect(res.status).not.toBe(404);
	});
});

describe("POST /api/chat/search", () => {
	it("returns 401/403 without auth", async () => {
		const req = new Request("https://parrot.example.com/api/chat/search", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ terms: "hello", team_id: "t1" }),
		});
		const res = await app.fetch(req, mockEnv as Env, {} as ExecutionContext);
		expect([401, 403]).toContain(res.status);
	});
});
