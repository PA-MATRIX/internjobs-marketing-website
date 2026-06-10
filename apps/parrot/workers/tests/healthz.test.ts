// workers/tests/healthz.test.ts
// WSTEST-01: /healthz response shape assertion.
//
// Verifies that GET /healthz:
//   1. Returns HTTP 200
//   2. Response JSON includes all required readiness keys
//   3. Shape is correct regardless of external service availability
//      (all mocked to fail → ok=false, but keys exist)
//
// We import the Hono `app` directly and call app.fetch() to exercise
// the full route layer without a real Cloudflare Worker runtime.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { app } from "../index";
import type { Env } from "../types";

// Minimal Env stub — only the keys /healthz actually reads.
const mockEnv: Partial<Env> = {
	MATTERMOST_URL: "https://mattermost.example.com",
	CLOUDFLARE_AI_API_TOKEN: undefined,
	CLOUDFLARE_ACCOUNT_ID: undefined,
	PARROT_AI_GATEWAY_ID: undefined,
	GRAPH_API_URL: undefined,
	GRAPH_API_SECRET: undefined,
};

describe("GET /healthz", () => {
	beforeEach(() => {
		// Mock all external fetch calls to fail (network error).
		// This puts healthz in the degraded path (ok=false) but all keys present.
		vi.stubGlobal(
			"fetch",
			vi.fn().mockRejectedValue(new Error("network mock")),
		);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("returns HTTP 200", async () => {
		const req = new Request("https://parrot.example.com/healthz");
		const res = await app.fetch(req, mockEnv as Env, {} as ExecutionContext);
		expect(res.status).toBe(200);
	});

	it("response JSON includes all required readiness keys", async () => {
		const req = new Request("https://parrot.example.com/healthz");
		const res = await app.fetch(req, mockEnv as Env, {} as ExecutionContext);
		const body = (await res.json()) as Record<string, unknown>;

		// WSTEST-01: all keys must be present for the shape contract.
		expect(body).toHaveProperty("ok");
		expect(body).toHaveProperty("mattermost_reachable");
		expect(body).toHaveProperty("ai_gateway_reachable");
		expect(body).toHaveProperty("graph_ready");
		expect(body).toHaveProperty("graph_proxy_reachable");
		expect(body).toHaveProperty("mailbox_count");

		// With all fetches failing, all booleans are false.
		expect(body.mattermost_reachable).toBe(false);
		expect(body.ai_gateway_reachable).toBe(false);
		expect(body.graph_ready).toBe(false);
		expect(body.graph_proxy_reachable).toBe(false);
		// mailbox_count is -1 (placeholder, WorkspaceDO count RPC not yet wired)
		expect(body.mailbox_count).toBe(-1);
	});

	it("returns ok=true when mattermost and ai_gateway are both reachable", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockImplementation((url: string) => {
				const u = String(url);
				if (u.includes("/api/v4/system/ping")) {
					return Promise.resolve(new Response("{}", { status: 200 }));
				}
				if (u.includes("gateway.ai.cloudflare.com")) {
					return Promise.resolve(new Response("{}", { status: 200 }));
				}
				// Graph proxy — fail (so graph keys stay false; ok still depends on mm+ai)
				return Promise.reject(new Error("graph unreachable"));
			}),
		);

		const env: Partial<Env> = {
			...mockEnv,
			CLOUDFLARE_AI_API_TOKEN: "tok",
			CLOUDFLARE_ACCOUNT_ID: "acc",
			PARROT_AI_GATEWAY_ID: "gw",
		};

		const req = new Request("https://parrot.example.com/healthz");
		const res = await app.fetch(req, env as Env, {} as ExecutionContext);
		const body = (await res.json()) as Record<string, unknown>;

		expect(body.mattermost_reachable).toBe(true);
		expect(body.ai_gateway_reachable).toBe(true);
		expect(body.ok).toBe(true);
	});
});
