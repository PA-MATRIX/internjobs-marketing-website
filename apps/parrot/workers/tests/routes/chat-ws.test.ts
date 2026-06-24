// workers/tests/routes/chat-ws.test.ts
// CHAT-HARD-02 (plan 31-06): Vitest smoke coverage for the WebSocket upgrade
// route (Wave 4, plan 31-05).
//
// We cannot exercise a real WebSocket upgrade in the Node/Vitest environment
// (no WebSocketPair). Two layers cover the route:
//
//   1. The HANDLER branches (426 on non-WS request, 503 chat_not_provisioned
//      when the employee lacks a PAT) are unit-tested directly against
//      handleChatWebSocket in workers/tests/lib/chat-realtime.test.ts.
//
//   2. THIS file asserts the route-level contract through the inner Hono `app`:
//      requireEmployeeMailbox fires before the WS check, so an unauthenticated
//      request returns 401/403, and the route is mounted (never 404).
//
// A genuine WS upgrade with valid auth is verified via live employee UAT in
// 31-06 (the Cloudflare Workers runtime WS bridge cannot run in Vitest).

import { describe, it, expect, vi, afterEach } from "vitest";
import { app } from "../../index";
import type { Env } from "../../types";

const mockEnv: Partial<Env> = {
	MATTERMOST_URL: "https://mattermost.example.com",
	MATTERMOST_BOT_TOKEN: "bot-token",
};

afterEach(() => vi.unstubAllGlobals());

describe("GET /api/chat/ws", () => {
	it("returns 401/403 without auth (requireEmployeeMailbox fires before WS check)", async () => {
		const req = new Request("https://parrot.example.com/api/chat/ws");
		const res = await app.fetch(req, mockEnv as Env, {} as ExecutionContext);
		expect([401, 403]).toContain(res.status);
	});

	it("route is mounted (not 404)", async () => {
		const req = new Request("https://parrot.example.com/api/chat/ws");
		const res = await app.fetch(req, mockEnv as Env, {} as ExecutionContext);
		expect(res.status).not.toBe(404);
	});

	it("does not crash on a WebSocket upgrade header without auth (not 500)", async () => {
		// Even with the upgrade header, auth fires first — the handler's 426/503
		// branches (covered in chat-realtime.test.ts) are never reached here.
		const req = new Request("https://parrot.example.com/api/chat/ws", {
			headers: { upgrade: "websocket" },
		});
		const res = await app.fetch(req, mockEnv as Env, {} as ExecutionContext);
		expect([401, 403]).toContain(res.status);
		expect(res.status).not.toBe(500);
	});
});
