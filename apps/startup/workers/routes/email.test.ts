// apps/startup/workers/routes/email.test.ts
// v1.5 Phase 33-01 — unit tests for BOTH inbound-email entry points.
//
// Uses Node 22's built-in `node:test` runner (matches slug.test.ts +
// telnyx.test.ts + scheduled.test.ts pattern). Run with:
//   cd apps/startup && npx tsx --test workers/routes/email.test.ts
//
// Coverage:
//   • processInboundEmail() — the shared core. Happy path, unknown_slug,
//     resolve_failed (5xx + throw), parse_failed, insert_failed, duplicate.
//   • POST /internal/email/inbound (emailInternalRouter) — the HTTP handoff
//     from apps/email-worker. Auth (401), recipient validation (400), happy
//     path (200), unknown slug (404).
//   • handleInboundEmail() — the CF-native email() export. Regression coverage
//     for its setReject() semantics, which the Phase 33 refactor must not have
//     changed (invalid recipient / unknown slug reject; infra failures drop
//     silently).
//
// NO REAL NETWORK CALLS — globalThis.fetch is always stubbed and restored in a
// `finally` block.
//
// ── Scope note on the timeout test (read before trusting it) ─────────────────
// The "timeout sanity" test below asserts only THIS package's own two numbers
// (RESOLVE_TIMEOUT_MS === 4000, INSERT_TIMEOUT_MS === 5000). It is a cheap
// tripwire against an accidental local edit. It is NOT the cross-package
// latency invariant: it cannot see apps/email-worker's EMPLOYERS_HANDOFF_TIMEOUT_MS
// or OVERHEAD_BUDGET_MS, so this suite going green tells you NOTHING about
// whether the caller's outer ceiling is still correctly sized. That guarantee
// belongs to scripts/check-email-timeout-invariant.mjs (Plan 33-04), which reads
// the real constants out of both packages. Do not mistake this for that check.

import { strict as assert } from "node:assert";
import { test } from "node:test";

import PostalMime from "postal-mime";

import {
	INSERT_TIMEOUT_MS,
	RESOLVE_TIMEOUT_MS,
	emailInternalRouter,
	handleInboundEmail,
	processInboundEmail,
} from "./email";
import type { Env } from "../types";

// ── Workers-runtime shims ────────────────────────────────────────────────────
//
// crypto.subtle.timingSafeEqual is a Cloudflare Workers extension to WebCrypto;
// Node's webcrypto doesn't have it (node:crypto's timingSafeEqual is a different
// namespace). routes/email.ts::verifyEmailHandoffSecret uses it exactly the way
// routes/admin.ts::verifyAdminSecret does, so we provide an equivalent here.
type SubtleWithTimingSafeEqual = SubtleCrypto & {
	timingSafeEqual?: (a: ArrayBufferView, b: ArrayBufferView) => boolean;
};
const subtle = crypto.subtle as SubtleWithTimingSafeEqual;
if (typeof subtle.timingSafeEqual !== "function") {
	subtle.timingSafeEqual = (a: ArrayBufferView, b: ArrayBufferView): boolean => {
		const av = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
		const bv = new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
		if (av.byteLength !== bv.byteLength) return false;
		let diff = 0;
		for (let i = 0; i < av.byteLength; i++) diff |= av[i] ^ bv[i];
		return diff === 0;
	};
}

// ── Fixtures ─────────────────────────────────────────────────────────────────

const HANDOFF_SECRET = "handoff-secret-0123456789abcdef";
const TO_ADDRESS = "acme@employers.internjobs.ai";

const RAW_MIME = [
	"From: Jane Candidate <jane@example.com>",
	`To: ${TO_ADDRESS}`,
	"Subject: Re: your frontend internship",
	"Message-ID: <cand-msg-123@mail.example.com>",
	"In-Reply-To: <outbound-456@employers.internjobs.ai>",
	"Date: Mon, 13 Jul 2026 10:00:00 +0000",
	"Content-Type: text/plain; charset=utf-8",
	"",
	"hi — yes, still interested. portfolio: https://example.com/jane",
	"",
].join("\r\n");

function mimeBytes(text = RAW_MIME): ArrayBuffer {
	return new TextEncoder().encode(text).buffer as ArrayBuffer;
}

function makeEnv(overrides: Partial<Env> = {}): Env {
	return {
		STARTUP_API_URL: "https://api.example.test",
		STARTUP_API_SECRET: "test-api-secret",
		STARTUP_MCP_ADMIN_SECRET: "admin-secret",
		EMAIL_HANDOFF_SECRET: HANDOFF_SECRET,
		...overrides,
	} as Env;
}

interface StubCall {
	url: string;
	method: string;
	body?: string;
	auth?: string;
	signal?: unknown;
}

/**
 * Mock fetch — routes URL substrings to canned responses (or throws, when the
 * handler itself throws), and records every call including the AbortSignal the
 * call site passed.
 */
function makeFetchStub(handlers: Record<string, () => Response>): {
	fetch: typeof fetch;
	calls: StubCall[];
} {
	const calls: StubCall[] = [];
	const fakeFetch: typeof fetch = async (input, init) => {
		const url = typeof input === "string" ? input : (input as Request).url;
		calls.push({
			url,
			method: (init?.method ?? "GET").toUpperCase(),
			body: typeof init?.body === "string" ? init.body : undefined,
			auth: (init?.headers as Record<string, string> | undefined)?.["Authorization"],
			signal: init?.signal,
		});
		for (const [pattern, handler] of Object.entries(handlers)) {
			if (url.includes(pattern)) return handler();
		}
		return new Response("not_found", { status: 404 });
	};
	return { fetch: fakeFetch, calls };
}

const jsonRes = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});

/** Canned handler set for the fully-happy path. */
function happyHandlers(insert: unknown = { ok: true, id: "msg-row-1" }) {
	return {
		"/v1/channels/resolve": () =>
			jsonRes({ startup_id: "s-1", member_id: "m-1" }),
		"/v1/messages/inbound": () => jsonRes(insert),
	};
}

/** Run `fn` with globalThis.fetch stubbed; always restores the original. */
async function withFetch<T>(
	handlers: Record<string, () => Response>,
	fn: (calls: StubCall[]) => Promise<T>,
): Promise<T> {
	const originalFetch = globalThis.fetch;
	const { fetch: stubFetch, calls } = makeFetchStub(handlers);
	globalThis.fetch = stubFetch;
	try {
		return await fn(calls);
	} finally {
		globalThis.fetch = originalFetch;
	}
}

const resolveCalls = (calls: StubCall[]) =>
	calls.filter((c) => c.url.includes("/v1/channels/resolve"));
const insertCalls = (calls: StubCall[]) =>
	calls.filter((c) => c.url.includes("/v1/messages/inbound"));

// ═════════════════════════════════════════════════════════════════════════════
// processInboundEmail() — the shared core
// ═════════════════════════════════════════════════════════════════════════════

test("processInboundEmail: happy path resolves, parses, and inserts", async () => {
	await withFetch(happyHandlers(), async (calls) => {
		const result = await processInboundEmail({
			toAddress: TO_ADDRESS,
			fromAddressHeader: "jane@example.com",
			rawBytes: mimeBytes(),
			env: makeEnv(),
		});

		assert.equal(result.ok, true);
		assert.deepEqual(result, {
			ok: true,
			duplicate: false,
			id: "msg-row-1",
			startup_id: "s-1",
			member_id: "m-1",
		});

		// Resolve was called once, with the recipient url-encoded + the API bearer.
		assert.equal(resolveCalls(calls).length, 1);
		assert.ok(
			resolveCalls(calls)[0].url.includes(encodeURIComponent(TO_ADDRESS)),
			"resolve URL carries the recipient address",
		);
		assert.equal(resolveCalls(calls)[0].auth, "Bearer test-api-secret");

		// Insert was called once with the full inbound_messages payload.
		const insert = insertCalls(calls);
		assert.equal(insert.length, 1);
		assert.equal(insert[0].method, "POST");
		const body = JSON.parse(insert[0].body!) as Record<string, unknown>;
		assert.equal(body.provider, "cloudflare-email");
		assert.equal(body.channel_type, "email");
		assert.equal(body.direction, "inbound");
		assert.equal(body.channel_address, TO_ADDRESS);
		assert.equal(body.startup_id, "s-1");
		assert.equal(body.member_id, "m-1");
		assert.equal(body.from_address, "jane@example.com");
		assert.equal(body.subject, "Re: your frontend internship");
		assert.ok(
			(body.body_text as string).includes("still interested"),
			"parsed text body reaches the insert",
		);
		assert.equal(body.provider_event_id, "cand-msg-123@mail.example.com");

		// Threading metadata is extracted from the MIME headers.
		const metadata = body.metadata as Record<string, unknown>;
		assert.equal(metadata.message_id, "cand-msg-123@mail.example.com");
		assert.equal(metadata.in_reply_to, "outbound-456@employers.internjobs.ai");
		assert.equal(metadata.thread_anchor, "outbound-456@employers.internjobs.ai");
	});
});

test("processInboundEmail: unknown slug (resolve 404) → unknown_slug, no insert", async () => {
	await withFetch(
		{ "/v1/channels/resolve": () => jsonRes({ error: "not_found" }, 404) },
		async (calls) => {
			const result = await processInboundEmail({
				toAddress: "ghost@employers.internjobs.ai",
				fromAddressHeader: "jane@example.com",
				rawBytes: mimeBytes(),
				env: makeEnv(),
			});
			assert.deepEqual(result, { ok: false, reason: "unknown_slug" });
			assert.equal(insertCalls(calls).length, 0, "no insert on unknown slug");
		},
	);
});

test("processInboundEmail: resolve 500 → resolve_failed, no insert", async () => {
	await withFetch(
		{ "/v1/channels/resolve": () => new Response("boom", { status: 500 }) },
		async (calls) => {
			const result = await processInboundEmail({
				toAddress: TO_ADDRESS,
				fromAddressHeader: null,
				rawBytes: mimeBytes(),
				env: makeEnv(),
			});
			assert.deepEqual(result, { ok: false, reason: "resolve_failed" });
			assert.equal(insertCalls(calls).length, 0);
		},
	);
});

test("processInboundEmail: resolve fetch throws (network/timeout) → resolve_failed", async () => {
	await withFetch(
		{
			"/v1/channels/resolve": () => {
				throw new Error("The operation was aborted due to timeout");
			},
		},
		async (calls) => {
			const result = await processInboundEmail({
				toAddress: TO_ADDRESS,
				fromAddressHeader: null,
				rawBytes: mimeBytes(),
				env: makeEnv(),
			});
			assert.deepEqual(result, { ok: false, reason: "resolve_failed" });
			assert.equal(insertCalls(calls).length, 0);
		},
	);
});

test("processInboundEmail: postal-mime throws → parse_failed, no insert", async () => {
	// NOTE: postal-mime is extremely permissive — binary garbage, empty buffers
	// and plain non-email text all parse WITHOUT throwing (verified empirically
	// against postal-mime 2.7.x; see the companion test below). So the only
	// honest way to exercise the parse_failed branch is to make the parser
	// itself throw. That branch is therefore defensive: it guards against
	// unexpected internal parser errors, not against "malformed" input.
	const originalParse = PostalMime.prototype.parse;
	PostalMime.prototype.parse = async () => {
		throw new Error("simulated postal-mime internal failure");
	};
	try {
		await withFetch(happyHandlers(), async (calls) => {
			const result = await processInboundEmail({
				toAddress: TO_ADDRESS,
				fromAddressHeader: null,
				rawBytes: mimeBytes(),
				env: makeEnv(),
			});
			assert.deepEqual(result, { ok: false, reason: "parse_failed" });
			assert.equal(insertCalls(calls).length, 0, "no insert when parse fails");
		});
	} finally {
		PostalMime.prototype.parse = originalParse;
	}
});

test("processInboundEmail: binary-garbage bytes still parse (documents postal-mime's permissiveness)", async () => {
	// Pinning real behavior so a future reader doesn't assume garbage → 422.
	// Garbage yields an empty subject/body and is inserted as an empty message.
	const garbage = new Uint8Array([0x00, 0xff, 0xfe, 0x01, 0x80, 0x7f, 0xc0, 0xf5])
		.buffer as ArrayBuffer;
	await withFetch(happyHandlers(), async (calls) => {
		const result = await processInboundEmail({
			toAddress: TO_ADDRESS,
			fromAddressHeader: "jane@example.com",
			rawBytes: garbage,
			env: makeEnv(),
		});
		assert.equal(result.ok, true, "postal-mime does not throw on binary garbage");
		const body = JSON.parse(insertCalls(calls)[0].body!) as Record<string, unknown>;
		assert.equal(body.subject, "");
		// No Message-ID in garbage → dedupe key is null, from falls back to the header.
		assert.equal(body.provider_event_id, null);
		assert.equal(body.from_address, "jane@example.com");
	});
});

test("processInboundEmail: insert non-2xx → insert_failed", async () => {
	await withFetch(
		{
			"/v1/channels/resolve": () => jsonRes({ startup_id: "s-1", member_id: "m-1" }),
			"/v1/messages/inbound": () => new Response("db down", { status: 503 }),
		},
		async (calls) => {
			const result = await processInboundEmail({
				toAddress: TO_ADDRESS,
				fromAddressHeader: null,
				rawBytes: mimeBytes(),
				env: makeEnv(),
			});
			assert.deepEqual(result, { ok: false, reason: "insert_failed" });
			assert.equal(insertCalls(calls).length, 1, "insert was attempted");
		},
	);
});

test("processInboundEmail: insert fetch throws → insert_failed", async () => {
	await withFetch(
		{
			"/v1/channels/resolve": () => jsonRes({ startup_id: "s-1", member_id: "m-1" }),
			"/v1/messages/inbound": () => {
				throw new Error("The operation was aborted due to timeout");
			},
		},
		async () => {
			const result = await processInboundEmail({
				toAddress: TO_ADDRESS,
				fromAddressHeader: null,
				rawBytes: mimeBytes(),
				env: makeEnv(),
			});
			assert.deepEqual(result, { ok: false, reason: "insert_failed" });
		},
	);
});

test("processInboundEmail: duplicate insert → ok:true with duplicate:true", async () => {
	await withFetch(
		happyHandlers({ ok: true, duplicate: true, id: "existing-row-9" }),
		async () => {
			const result = await processInboundEmail({
				toAddress: TO_ADDRESS,
				fromAddressHeader: null,
				rawBytes: mimeBytes(),
				env: makeEnv(),
			});
			assert.deepEqual(result, {
				ok: true,
				duplicate: true,
				id: "existing-row-9",
				startup_id: "s-1",
				member_id: "m-1",
			});
		},
	);
});

test("processInboundEmail: trailing slash on STARTUP_API_URL is normalised", async () => {
	await withFetch(happyHandlers(), async (calls) => {
		await processInboundEmail({
			toAddress: TO_ADDRESS,
			fromAddressHeader: null,
			rawBytes: mimeBytes(),
			env: makeEnv({ STARTUP_API_URL: "https://api.example.test/" }),
		});
		assert.ok(!resolveCalls(calls)[0].url.includes("//v1/"), "no double slash");
	});
});

// ── Same-package timeout sanity check (NOT the cross-package invariant) ──────

test("timeout sanity (same-package only): RESOLVE=4000 + INSERT=5000, both passed as AbortSignals", async () => {
	// Tripwire against an accidental edit to THIS package's numbers. See the
	// scope note in this file's header: the cross-package inequality against
	// apps/email-worker's EMPLOYERS_HANDOFF_TIMEOUT_MS / OVERHEAD_BUDGET_MS is
	// verified ONLY by scripts/check-email-timeout-invariant.mjs (Plan 33-04),
	// which reads both packages' real constants. This assertion cannot see them.
	assert.equal(RESOLVE_TIMEOUT_MS, 4000);
	assert.equal(INSERT_TIMEOUT_MS, 5000);
	assert.equal(RESOLVE_TIMEOUT_MS + INSERT_TIMEOUT_MS, 9000, "inner latency sum");

	await withFetch(happyHandlers(), async (calls) => {
		await processInboundEmail({
			toAddress: TO_ADDRESS,
			fromAddressHeader: null,
			rawBytes: mimeBytes(),
			env: makeEnv(),
		});
		assert.ok(
			resolveCalls(calls)[0].signal instanceof AbortSignal,
			"resolve fetch was given an AbortSignal",
		);
		assert.ok(
			insertCalls(calls)[0].signal instanceof AbortSignal,
			"insert fetch was given an AbortSignal",
		);
	});
});

// ═════════════════════════════════════════════════════════════════════════════
// POST /internal/email/inbound — the HTTP handoff from apps/email-worker
// ═════════════════════════════════════════════════════════════════════════════
//
// The router is mounted at /internal in app.ts, so its own path is /email/inbound.

function handoffRequest(
	init: {
		secret?: string | null;
		to?: string;
		from?: string;
		body?: ArrayBuffer;
	} = {},
): Request {
	const headers = new Headers({
		"Content-Type": "message/rfc822",
		"X-Startup-To": init.to ?? TO_ADDRESS,
		"X-Startup-From": init.from ?? "jane@example.com",
	});
	if (init.secret !== null) {
		headers.set("Authorization", `Bearer ${init.secret ?? HANDOFF_SECRET}`);
	}
	return new Request("http://mcp.internjobs.ai/email/inbound", {
		method: "POST",
		headers,
		body: init.body ?? mimeBytes(),
	});
}

test("POST /email/inbound: missing Authorization → 401, zero downstream fetches", async () => {
	await withFetch(happyHandlers(), async (calls) => {
		const res = await emailInternalRouter.fetch(
			handoffRequest({ secret: null }),
			makeEnv(),
		);
		assert.equal(res.status, 401);
		assert.deepEqual(await res.json(), { error: "unauthorized" });
		assert.equal(calls.length, 0, "auth is checked before any downstream work");
	});
});

test("POST /email/inbound: wrong secret → 401, zero downstream fetches", async () => {
	await withFetch(happyHandlers(), async (calls) => {
		const res = await emailInternalRouter.fetch(
			handoffRequest({ secret: "not-the-right-secret-at-all-nope" }),
			makeEnv(),
		);
		assert.equal(res.status, 401);
		assert.equal(calls.length, 0);
	});
});

test("POST /email/inbound: secret unbound on the Worker → 401 (fail closed)", async () => {
	await withFetch(happyHandlers(), async (calls) => {
		const res = await emailInternalRouter.fetch(
			handoffRequest(),
			makeEnv({ EMAIL_HANDOFF_SECRET: undefined }),
		);
		assert.equal(res.status, 401, "no secret configured → reject, never accept");
		assert.equal(calls.length, 0);
	});
});

test("POST /email/inbound: valid secret + employers recipient → 200 {ok:true}", async () => {
	await withFetch(happyHandlers(), async (calls) => {
		const res = await emailInternalRouter.fetch(handoffRequest(), makeEnv());
		assert.equal(res.status, 200);
		assert.deepEqual(await res.json(), {
			ok: true,
			duplicate: false,
			id: "msg-row-1",
		});

		// Downstream calls used the X-Startup-To-derived address.
		assert.equal(resolveCalls(calls).length, 1);
		assert.ok(resolveCalls(calls)[0].url.includes(encodeURIComponent(TO_ADDRESS)));
		const body = JSON.parse(insertCalls(calls)[0].body!) as Record<string, unknown>;
		assert.equal(body.channel_address, TO_ADDRESS);
		assert.equal(body.startup_id, "s-1");
	});
});

test("POST /email/inbound: X-Startup-To is lowercased before resolution", async () => {
	await withFetch(happyHandlers(), async (calls) => {
		const res = await emailInternalRouter.fetch(
			handoffRequest({ to: "ACME@Employers.InternJobs.ai" }),
			makeEnv(),
		);
		assert.equal(res.status, 200);
		assert.ok(resolveCalls(calls)[0].url.includes(encodeURIComponent(TO_ADDRESS)));
	});
});

test("POST /email/inbound: non-employers recipient → 400, zero downstream fetches", async () => {
	await withFetch(happyHandlers(), async (calls) => {
		const res = await emailInternalRouter.fetch(
			handoffRequest({ to: "someone@gmail.com" }),
			makeEnv(),
		);
		assert.equal(res.status, 400);
		assert.deepEqual(await res.json(), { error: "invalid_recipient" });
		assert.equal(calls.length, 0);
	});
});

test("POST /email/inbound: missing X-Startup-To → 400", async () => {
	await withFetch(happyHandlers(), async (calls) => {
		const res = await emailInternalRouter.fetch(
			handoffRequest({ to: "" }),
			makeEnv(),
		);
		assert.equal(res.status, 400);
		assert.equal(calls.length, 0);
	});
});

test("POST /email/inbound: unknown slug → 404 {ok:false, reason:'unknown_slug'}", async () => {
	await withFetch(
		{ "/v1/channels/resolve": () => jsonRes({ error: "not_found" }, 404) },
		async (calls) => {
			const res = await emailInternalRouter.fetch(
				handoffRequest({ to: "ghost@employers.internjobs.ai" }),
				makeEnv(),
			);
			assert.equal(res.status, 404);
			assert.deepEqual(await res.json(), { ok: false, reason: "unknown_slug" });
			assert.equal(insertCalls(calls).length, 0);
		},
	);
});

test("POST /email/inbound: resolve infra failure → 502 (caller fails safe)", async () => {
	await withFetch(
		{ "/v1/channels/resolve": () => new Response("boom", { status: 500 }) },
		async () => {
			const res = await emailInternalRouter.fetch(handoffRequest(), makeEnv());
			assert.equal(res.status, 502);
			assert.deepEqual(await res.json(), { ok: false, reason: "resolve_failed" });
		},
	);
});

test("POST /email/inbound: insert infra failure → 502", async () => {
	await withFetch(
		{
			"/v1/channels/resolve": () => jsonRes({ startup_id: "s-1", member_id: "m-1" }),
			"/v1/messages/inbound": () => new Response("db down", { status: 503 }),
		},
		async () => {
			const res = await emailInternalRouter.fetch(handoffRequest(), makeEnv());
			assert.equal(res.status, 502);
			assert.deepEqual(await res.json(), { ok: false, reason: "insert_failed" });
		},
	);
});

test("POST /email/inbound: MIME parse failure → 422", async () => {
	const originalParse = PostalMime.prototype.parse;
	PostalMime.prototype.parse = async () => {
		throw new Error("simulated postal-mime internal failure");
	};
	try {
		await withFetch(happyHandlers(), async () => {
			const res = await emailInternalRouter.fetch(handoffRequest(), makeEnv());
			assert.equal(res.status, 422);
			assert.deepEqual(await res.json(), { ok: false, reason: "parse_failed" });
		});
	} finally {
		PostalMime.prototype.parse = originalParse;
	}
});

// ═════════════════════════════════════════════════════════════════════════════
// handleInboundEmail() — the CF-native email() export (regression coverage)
// ═════════════════════════════════════════════════════════════════════════════

interface EmailMessageMock {
	message: ForwardableEmailMessage;
	rejects: string[];
}

/** Minimal ForwardableEmailMessage stand-in; `raw` is a real ReadableStream. */
function makeEmailMessage(
	to: string,
	from = "jane@example.com",
	raw = RAW_MIME,
): EmailMessageMock {
	const rejects: string[] = [];
	const encoded = new TextEncoder().encode(raw);
	const headers = new Headers({
		"message-id": "<cand-msg-123@mail.example.com>",
		"in-reply-to": "<outbound-456@employers.internjobs.ai>",
	});
	const message = {
		to,
		from,
		raw: new Response(encoded).body as ReadableStream,
		rawSize: encoded.byteLength,
		headers,
		setReject: (reason: string) => {
			rejects.push(reason);
		},
		forward: async () => {},
		reply: async () => {},
	} as unknown as ForwardableEmailMessage;
	return { message, rejects };
}

const noopCtx = {
	waitUntil: () => {},
	passThroughOnException: () => {},
} as unknown as ExecutionContext;

test("handleInboundEmail: non-employers recipient → setReject('invalid recipient address'), no fetch", async () => {
	await withFetch(happyHandlers(), async (calls) => {
		const { message, rejects } = makeEmailMessage("someone@gmail.com");
		await handleInboundEmail(message, makeEnv(), noopCtx);
		assert.deepEqual(rejects, ["invalid recipient address"]);
		assert.equal(calls.length, 0);
	});
});

test("handleInboundEmail: unknown slug → setReject('startup not found')", async () => {
	await withFetch(
		{ "/v1/channels/resolve": () => jsonRes({ error: "not_found" }, 404) },
		async (calls) => {
			const { message, rejects } = makeEmailMessage("ghost@employers.internjobs.ai");
			await handleInboundEmail(message, makeEnv(), noopCtx);
			assert.deepEqual(rejects, ["startup not found"]);
			assert.equal(insertCalls(calls).length, 0);
		},
	);
});

test("handleInboundEmail: resolve infra failure → silent drop, NO setReject, no throw", async () => {
	await withFetch(
		{ "/v1/channels/resolve": () => new Response("boom", { status: 500 }) },
		async (calls) => {
			const { message, rejects } = makeEmailMessage(TO_ADDRESS);
			await handleInboundEmail(message, makeEnv(), noopCtx);
			assert.deepEqual(rejects, [], "infra failure must not bounce mail to the sender");
			assert.equal(insertCalls(calls).length, 0);
		},
	);
});

test("handleInboundEmail: insert infra failure → silent drop, NO setReject", async () => {
	await withFetch(
		{
			"/v1/channels/resolve": () => jsonRes({ startup_id: "s-1", member_id: "m-1" }),
			"/v1/messages/inbound": () => new Response("db down", { status: 503 }),
		},
		async (calls) => {
			const { message, rejects } = makeEmailMessage(TO_ADDRESS);
			await handleInboundEmail(message, makeEnv(), noopCtx);
			assert.deepEqual(rejects, []);
			assert.equal(insertCalls(calls).length, 1, "insert was attempted");
		},
	);
});

test("handleInboundEmail: happy path → no setReject, inbound_messages POSTed", async () => {
	await withFetch(happyHandlers(), async (calls) => {
		const { message, rejects } = makeEmailMessage(TO_ADDRESS);
		await handleInboundEmail(message, makeEnv(), noopCtx);
		assert.deepEqual(rejects, []);
		const insert = insertCalls(calls);
		assert.equal(insert.length, 1);
		const body = JSON.parse(insert[0].body!) as Record<string, unknown>;
		assert.equal(body.startup_id, "s-1");
		assert.equal(body.channel_address, TO_ADDRESS);
		assert.equal(body.subject, "Re: your frontend internship");
		assert.equal(body.from_address, "jane@example.com");
		// rawSize hint drained correctly → raw_size matches the fixture length.
		const metadata = body.metadata as Record<string, unknown>;
		assert.equal(metadata.raw_size, new TextEncoder().encode(RAW_MIME).byteLength);
	});
});

test("handleInboundEmail: uppercase recipient is lowercased, still routes", async () => {
	await withFetch(happyHandlers(), async (calls) => {
		const { message, rejects } = makeEmailMessage("ACME@EMPLOYERS.INTERNJOBS.AI");
		await handleInboundEmail(message, makeEnv(), noopCtx);
		assert.deepEqual(rejects, []);
		assert.ok(resolveCalls(calls)[0].url.includes(encodeURIComponent(TO_ADDRESS)));
	});
});
