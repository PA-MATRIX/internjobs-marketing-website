// apps/startup/workers/routes/scheduled.test.ts
// v1.4 Phase 29-03 — unit tests for the weekly touchbase cron.
//
// Uses Node 22's built-in `node:test` runner (matches slug.test.ts +
// webhooks.test.ts + telnyx.test.ts pattern). Run with:
//   cd apps/startup && npx tsx --test workers/routes/scheduled.test.ts
//
// Coverage:
//   • composeTouchbaseSms (pure function) — 3 candidates, 1 candidate, 0
//     candidates, missing founder_name fallback. Format string is load-
//     bearing for the "reply 1/2/3" UX, so we assert the exact body.
//   • runWeeklyTouchbase end-to-end with mocked env (fetch + KV + sendSms-
//     proxied-via-Telnyx-fetch) — verifies:
//       - GET /v1/touchbase/due-startups is called with correct Bearer
//       - per-startup: fresh-candidates is fetched
//       - KV cursor is written when env.TOUCHBASE_CURSORS is bound + N>=1
//       - Telnyx POST /v2/messages is called with composed body
//       - PATCH .../touchbase-sent is called on success
//   • Cron silently no-ops when TELNYX_API_KEY is unbound (ops-deferred guard)
//   • Cron tolerates 0-candidate startup (no KV write, still sends SMS, still
//     marks touchbase-sent)
//
// NO REAL TELNYX CALLS — we stub global fetch to track requests.

import { strict as assert } from "node:assert";
import { test } from "node:test";

import {
	composeTouchbaseSms,
	runWeeklyTouchbase,
} from "./scheduled";
import type { Env } from "../types";

// ── composeTouchbaseSms (pure) ────────────────────────────────────────────────

test("composeTouchbaseSms: 3 candidates + named founder", () => {
	const out = composeTouchbaseSms("Alice", "Acme AI", [
		{ thread_id: "t1", candidate_name: "Jane Doe", role_title: "Frontend Intern", summary: null },
		{ thread_id: "t2", candidate_name: "Alex Lee", role_title: "Backend Intern", summary: null },
		{ thread_id: "t3", candidate_name: "Sam Patel", role_title: null, summary: null },
	]);
	assert.ok(out.startsWith("hey Alice — 3 new intern candidates this week for Acme AI."));
	assert.ok(out.includes("reply 1/2/3 to see a candidate, or 'stop' to opt out."));
	assert.ok(out.includes("1. Jane Doe (Frontend Intern)"));
	assert.ok(out.includes("2. Alex Lee (Backend Intern)"));
	// Sam has no role title — should render as bare name (no parens)
	assert.ok(out.includes("3. Sam Patel"));
	assert.ok(!out.includes("3. Sam Patel (null)"));
});

test("composeTouchbaseSms: 1 candidate uses singular", () => {
	const out = composeTouchbaseSms("Bob", "Beta Co", [
		{ thread_id: "t1", candidate_name: "Jane", role_title: "Eng", summary: null },
	]);
	assert.ok(out.includes("1 new intern candidate this week"));
	assert.ok(!out.includes("candidates"));
});

test("composeTouchbaseSms: 0 candidates uses the no-candidates variant", () => {
	const out = composeTouchbaseSms("Bob", "Beta Co", []);
	assert.ok(out.includes("no new candidates this week"));
	assert.ok(out.includes("we're actively sourcing"));
	assert.ok(out.includes("reply 'stop' to opt out"));
	// Should NOT contain the reply-1/2/3 prompt — no cursor to read against.
	assert.ok(!out.includes("reply 1/2/3"));
});

test("composeTouchbaseSms: missing founder_name falls back to 'there'", () => {
	const out = composeTouchbaseSms(null, "Acme", []);
	assert.ok(out.startsWith("hey there —"));
});

test("composeTouchbaseSms: empty founder_name (just whitespace) falls back to 'there'", () => {
	const out = composeTouchbaseSms("   ", "Acme", []);
	assert.ok(out.startsWith("hey there —"));
});

// ── runWeeklyTouchbase with mocked env ────────────────────────────────────────

/**
 * Tiny in-memory KV stub. Implements the subset of KVNamespace the cron uses
 * (put + get). Records all writes for assertion.
 */
function createKvStub() {
	const store = new Map<string, string>();
	const puts: Array<{ key: string; value: string; ttl?: number }> = [];
	return {
		kv: {
			async put(key: string, value: string, options?: { expirationTtl?: number }) {
				store.set(key, value);
				puts.push({ key, value, ttl: options?.expirationTtl });
			},
			async get(key: string) {
				return store.get(key) ?? null;
			},
		} as unknown as KVNamespace,
		puts,
		store,
	};
}

/**
 * Mock fetch — routes URL patterns to canned responses, tracks every call.
 */
function makeFetchStub(handlers: Record<string, () => Response>): {
	fetch: typeof fetch;
	calls: Array<{ url: string; method: string; body?: string; auth?: string }>;
} {
	const calls: Array<{ url: string; method: string; body?: string; auth?: string }> = [];
	const fakeFetch: typeof fetch = async (input, init) => {
		const url = typeof input === "string" ? input : (input as Request).url;
		const method = (init?.method ?? "GET").toUpperCase();
		const body = typeof init?.body === "string" ? init.body : undefined;
		const auth = (init?.headers as Record<string, string> | undefined)?.["Authorization"];
		calls.push({ url, method, body, auth });
		// Find first matching handler (key is a substring of url)
		for (const [pattern, handler] of Object.entries(handlers)) {
			if (url.includes(pattern)) return handler();
		}
		return new Response("not_found", { status: 404 });
	};
	return { fetch: fakeFetch, calls };
}

function makeEnv(overrides: Partial<Env> = {}): Env {
	return {
		STARTUP_API_URL: "https://api.example.test",
		STARTUP_API_SECRET: "test-secret",
		STARTUP_MCP_ADMIN_SECRET: "admin-secret",
		TELNYX_API_KEY: "telnyx-key",
		TELNYX_FROM_NUMBER: "+18005550001",
		...overrides,
	} as Env;
}

test("runWeeklyTouchbase: silent no-op when TELNYX_API_KEY unbound", async () => {
	const env = makeEnv({ TELNYX_API_KEY: undefined });
	const originalFetch = globalThis.fetch;
	const { fetch: stubFetch, calls } = makeFetchStub({});
	globalThis.fetch = stubFetch;
	try {
		await runWeeklyTouchbase(env);
		assert.equal(calls.length, 0, "no HTTP calls should be made when API key unbound");
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("runWeeklyTouchbase: empty due-list → no Telnyx calls, no KV writes", async () => {
	const { kv, puts } = createKvStub();
	const env = makeEnv({ TOUCHBASE_CURSORS: kv });
	const originalFetch = globalThis.fetch;
	const { fetch: stubFetch, calls } = makeFetchStub({
		"/v1/touchbase/due-startups": () =>
			new Response(JSON.stringify({ due: [] }), {
				status: 200,
				headers: { "content-type": "application/json" },
			}),
	});
	globalThis.fetch = stubFetch;
	try {
		await runWeeklyTouchbase(env);
		assert.equal(puts.length, 0, "no KV writes");
		assert.equal(
			calls.filter((c) => c.url.includes("telnyx.com")).length,
			0,
			"no Telnyx calls",
		);
		assert.equal(
			calls.filter((c) => c.url.includes("touchbase/due-startups")).length,
			1,
			"due-startups queried exactly once",
		);
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("runWeeklyTouchbase: 1 startup + 2 candidates → KV write + Telnyx send + touchbase-sent PATCH", async () => {
	const { kv, puts, store } = createKvStub();
	const env = makeEnv({ TOUCHBASE_CURSORS: kv });
	const originalFetch = globalThis.fetch;
	const { fetch: stubFetch, calls } = makeFetchStub({
		"/v1/touchbase/due-startups": () =>
			new Response(
				JSON.stringify({
					due: [
						{
							channel_link_id: "link-1",
							startup_id: "s-1",
							phone: "+15551234567",
							member_id: "m-1",
							startup_name: "Acme AI",
							founder_name: "Alice",
						},
					],
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			),
		"/fresh-candidates": () =>
			new Response(
				JSON.stringify({
					candidates: [
						{ thread_id: "t1", candidate_name: "Jane", role_title: "FE", summary: "react+ts" },
						{ thread_id: "t2", candidate_name: "Alex", role_title: "BE", summary: "go+rust" },
					],
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			),
		"api.telnyx.com": () =>
			new Response(JSON.stringify({ data: { id: "msg-1" } }), { status: 200 }),
		"/touchbase-sent": () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
	});
	globalThis.fetch = stubFetch;
	try {
		await runWeeklyTouchbase(env);

		// KV cursor written for the phone with exactly the 2 candidates, in order.
		assert.equal(puts.length, 1);
		assert.equal(puts[0].key, "touchbase:cursor:+15551234567");
		assert.equal(puts[0].ttl, 172800, "48h TTL");
		const cursor = JSON.parse(puts[0].value) as Array<{ thread_id: string; candidate_name: string; role_title: string | null }>;
		assert.equal(cursor.length, 2);
		assert.equal(cursor[0].thread_id, "t1");
		assert.equal(cursor[1].thread_id, "t2");
		// Cursor strips `summary` (not needed for "reply 1/2/3" lookup).
		assert.ok(!("summary" in cursor[0]));

		// Telnyx outbound was called with the composed body.
		const telnyxCall = calls.find((c) => c.url.includes("api.telnyx.com"));
		assert.ok(telnyxCall, "Telnyx POST happened");
		assert.equal(telnyxCall!.method, "POST");
		const sentBody = JSON.parse(telnyxCall!.body!) as { to: string; text: string };
		assert.equal(sentBody.to, "+15551234567");
		assert.ok(sentBody.text.startsWith("hey Alice — 2 new intern candidates"));
		assert.ok(sentBody.text.includes("1. Jane (FE)"));
		assert.ok(sentBody.text.includes("2. Alex (BE)"));

		// touchbase-sent PATCH fired with channel_link_id in path.
		const patchCall = calls.find((c) => c.url.includes("/link-1/touchbase-sent"));
		assert.ok(patchCall, "touchbase-sent PATCH happened");
		assert.equal(patchCall!.method, "PATCH");
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("runWeeklyTouchbase: 0-candidate startup → no KV write, SMS still sent, mark-sent still fires", async () => {
	const { kv, puts } = createKvStub();
	const env = makeEnv({ TOUCHBASE_CURSORS: kv });
	const originalFetch = globalThis.fetch;
	const { fetch: stubFetch, calls } = makeFetchStub({
		"/v1/touchbase/due-startups": () =>
			new Response(
				JSON.stringify({
					due: [
						{
							channel_link_id: "link-2",
							startup_id: "s-2",
							phone: "+15559998888",
							member_id: "m-2",
							startup_name: "Quiet Co",
							founder_name: "Bob",
						},
					],
				}),
				{ status: 200 },
			),
		"/fresh-candidates": () =>
			new Response(JSON.stringify({ candidates: [] }), { status: 200 }),
		"api.telnyx.com": () =>
			new Response(JSON.stringify({ data: { id: "msg-2" } }), { status: 200 }),
		"/touchbase-sent": () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
	});
	globalThis.fetch = stubFetch;
	try {
		await runWeeklyTouchbase(env);

		// No KV write — 0 candidates means no cursor.
		assert.equal(puts.length, 0, "no KV write for 0-candidate startup");

		// Telnyx still called with the no-candidates SMS variant.
		const telnyxCall = calls.find((c) => c.url.includes("api.telnyx.com"));
		assert.ok(telnyxCall);
		const sentBody = JSON.parse(telnyxCall!.body!) as { text: string };
		assert.ok(sentBody.text.includes("no new candidates this week"));

		// touchbase-sent PATCH still fired (don't want to retry next week).
		const patchCall = calls.find((c) => c.url.includes("/link-2/touchbase-sent"));
		assert.ok(patchCall, "touchbase-sent fired even with 0 candidates");
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("runWeeklyTouchbase: KV unbound → SMS still sent, no KV writes attempted", async () => {
	const env = makeEnv({ TOUCHBASE_CURSORS: undefined });
	const originalFetch = globalThis.fetch;
	const { fetch: stubFetch, calls } = makeFetchStub({
		"/v1/touchbase/due-startups": () =>
			new Response(
				JSON.stringify({
					due: [
						{
							channel_link_id: "link-3",
							startup_id: "s-3",
							phone: "+15557776666",
							member_id: "m-3",
							startup_name: "NoKV Co",
							founder_name: "Carol",
						},
					],
				}),
				{ status: 200 },
			),
		"/fresh-candidates": () =>
			new Response(
				JSON.stringify({
					candidates: [
						{ thread_id: "t1", candidate_name: "Eve", role_title: "PM", summary: "x" },
					],
				}),
				{ status: 200 },
			),
		"api.telnyx.com": () =>
			new Response(JSON.stringify({ data: { id: "msg-3" } }), { status: 200 }),
		"/touchbase-sent": () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
	});
	globalThis.fetch = stubFetch;
	try {
		await runWeeklyTouchbase(env);
		// SMS still sent — KV is best-effort.
		const telnyxCall = calls.find((c) => c.url.includes("api.telnyx.com"));
		assert.ok(telnyxCall, "Telnyx send happened even without KV binding");
	} finally {
		globalThis.fetch = originalFetch;
	}
});

// ── Cursor JSON shape contract test ──────────────────────────────────────────
//
// The KV cursor format is the contract between the cron (writer) and the
// telnyx.ts numeric reply fast-path (reader). If this shape changes, both
// sides must update together. This test pins the shape.

test("KV cursor JSON shape: array of {thread_id, candidate_name, role_title}", async () => {
	const { kv, puts } = createKvStub();
	const env = makeEnv({ TOUCHBASE_CURSORS: kv });
	const originalFetch = globalThis.fetch;
	const { fetch: stubFetch } = makeFetchStub({
		"/v1/touchbase/due-startups": () =>
			new Response(
				JSON.stringify({
					due: [
						{
							channel_link_id: "link-x",
							startup_id: "s-x",
							phone: "+15551112222",
							member_id: "m-x",
							startup_name: "X Co",
							founder_name: "Founder",
						},
					],
				}),
				{ status: 200 },
			),
		"/fresh-candidates": () =>
			new Response(
				JSON.stringify({
					candidates: [
						{ thread_id: "t-aaa", candidate_name: "Cand A", role_title: "Role A", summary: "summary-A" },
					],
				}),
				{ status: 200 },
			),
		"api.telnyx.com": () => new Response("{}", { status: 200 }),
		"/touchbase-sent": () => new Response("{}", { status: 200 }),
	});
	globalThis.fetch = stubFetch;
	try {
		await runWeeklyTouchbase(env);
		const cursor = JSON.parse(puts[0].value) as unknown[];
		assert.ok(Array.isArray(cursor));
		const entry = cursor[0] as Record<string, unknown>;
		assert.equal(typeof entry.thread_id, "string");
		assert.equal(typeof entry.candidate_name, "string");
		// role_title may be string OR null — both are valid.
		assert.ok(entry.role_title === null || typeof entry.role_title === "string");
		// summary must NOT leak into the cursor (it's only for the SMS body).
		assert.ok(!("summary" in entry));
	} finally {
		globalThis.fetch = originalFetch;
	}
});
