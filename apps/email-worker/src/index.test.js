// apps/email-worker/src/index.test.js
//
// v1.5 Phase 33-02 — the FIRST test coverage this Worker has ever had.
//
// This Worker is the zone-wide Cloudflare Email Routing catch-all for
// internjobs.ai: every inbound message for the zone that isn't claimed by a
// specific-address CF rule passes through email() in ./index.js. It carries
// LIVE mail. So the point of this suite is not just the new Phase-33
// employers dispatch branch — it is the REGRESSION SUITE for the two
// pre-existing paths (conv-alias ingestion + the generic operator forward),
// so this Worker can be redeployed without crossing fingers.
//
// Plain ESM JS with zero runtime dependencies, so no tsx/vitest is needed:
//   cd apps/email-worker && npm test        # -> node --test src/*.test.js
//
// NO REAL NETWORK: globalThis.fetch is stubbed per test and restored in a
// finally block (same discipline as apps/startup/workers/routes/scheduled.test.ts).

import { strict as assert } from "node:assert";
import { test } from "node:test";

import * as entrypoint from "./index.js";
import worker, { dispatchToEmployersHandoff } from "./index.js";
// The latency-budget constants live in a NON-entrypoint module on purpose: a
// numeric named export on index.js makes workerd refuse to start the whole
// Worker. See src/constants.js and the entrypoint-export guard test below.
import { EMPLOYERS_HANDOFF_TIMEOUT_MS, OVERHEAD_BUDGET_MS } from "./constants.js";

// Must match the constants in index.js (intentionally re-stated here rather
// than imported, so a silent change to either is caught by these tests).
const OPERATOR_FALLBACK = "rentalaraj@gmail.com";
const FLY_INGEST_URL = "https://app.internjobs.ai/webhooks/email";
const HANDOFF_URL = "https://mcp.internjobs.ai/internal/email/inbound";
const HANDOFF_SECRET = "test-handoff-secret";

const RAW_MIME = [
	"From: Founder <founder@acme.example>",
	"To: acme@employers.internjobs.ai",
	"Subject: Re: your intern candidates",
	"",
	"Sounds good — let's set up a call.",
].join("\r\n");

// ── helpers ──────────────────────────────────────────────────────────────────

/**
 * Build a fake CF EmailMessage. `forwards` collects every message.forward()
 * call so tests can assert the operator-fallback safety net fired (or didn't).
 */
function makeMessage({
	to,
	from = "founder@acme.example",
	subject = "Re: your intern candidates",
	rawText = RAW_MIME,
	headersGetThrows = false,
	forwardThrows = false,
} = {}) {
	const forwards = [];
	const headers = headersGetThrows
		? {
				get() {
					throw new Error("simulated headers failure");
				},
			}
		: new Map([["subject", subject]]);
	return {
		to,
		from,
		headers,
		// A CF EmailMessage exposes `raw` as a ReadableStream — same here, so
		// the single-read semantics the Worker has to live with are real.
		raw: new Response(rawText).body,
		forwards,
		async forward(addr) {
			forwards.push(addr);
			if (forwardThrows) throw new Error("simulated forward failure");
		},
	};
}

function makeEnv(overrides = {}) {
	return {
		EMAIL_WORKER_SECRET: "test-worker-secret",
		FLY_INGEST_URL,
		STARTUP_EMAIL_HANDOFF_URL: HANDOFF_URL,
		EMAIL_HANDOFF_SECRET: HANDOFF_SECRET,
		...overrides,
	};
}

/**
 * Stub globalThis.fetch. `handler(url, init)` returns a Response (or throws to
 * simulate a network error). Every call is recorded for assertions.
 */
function installFetchMock(handler) {
	const calls = [];
	const original = globalThis.fetch;
	globalThis.fetch = async (url, init) => {
		calls.push({ url: String(url), init: init ?? {} });
		return handler(String(url), init ?? {});
	};
	return {
		calls,
		callsTo: (url) => calls.filter((c) => c.url === url),
		restore: () => {
			globalThis.fetch = original;
		},
	};
}

/** Case-insensitive header lookup on a fetch init's plain-object headers. */
function header(init, name) {
	const entries = Object.entries(init.headers ?? {});
	const hit = entries.find(([k]) => k.toLowerCase() === name.toLowerCase());
	return hit?.[1];
}

const ok = (status = 200) => new Response(null, { status });

// ═════════════════════════════════════════════════════════════════════════════
// NEW: employers.internjobs.ai dispatch branch (Phase 33)
// ═════════════════════════════════════════════════════════════════════════════

test("employers: successful handoff (200) dispatches and does NOT forward to the operator", async () => {
	const mock = installFetchMock((url) => {
		assert.equal(url, HANDOFF_URL, "the only fetch should be the handoff");
		return ok(200);
	});
	try {
		const message = makeMessage({ to: "acme@employers.internjobs.ai" });
		await worker.email(message, makeEnv(), {});

		// Fail-safe inverse: on success the mail must NOT also land in the
		// operator inbox (that would be a spurious duplicate forward).
		assert.deepEqual(message.forwards, [], "operator forward must not fire on success");

		// Exactly one fetch total — proves we returned before the generic
		// branch's best-effort FLY_INGEST_URL audit ping.
		assert.equal(mock.calls.length, 1);
		const { url, init } = mock.calls[0];
		assert.equal(url, HANDOFF_URL);
		assert.equal(init.method, "POST");
		assert.equal(header(init, "authorization"), `Bearer ${HANDOFF_SECRET}`);
		assert.equal(header(init, "content-type"), "message/rfc822");
		assert.equal(header(init, "x-startup-to"), "acme@employers.internjobs.ai");
		assert.equal(header(init, "x-startup-from"), "founder@acme.example");

		// Body is the RAW MIME bytes (ArrayBuffer), not a lossy JSON envelope —
		// this is the contract apps/startup's postal-mime parser depends on.
		assert.ok(init.body instanceof ArrayBuffer, "body must be an ArrayBuffer of raw MIME");
		assert.equal(new TextDecoder().decode(init.body), RAW_MIME);
	} finally {
		mock.restore();
	}
});

test("employers: bracketed 'Name <addr>' recipient form still dispatches with the bare address", async () => {
	const mock = installFetchMock(() => ok(200));
	try {
		const message = makeMessage({ to: '"Acme Co" <acme@employers.internjobs.ai>' });
		await worker.email(message, makeEnv(), {});

		assert.deepEqual(message.forwards, []);
		assert.equal(mock.callsTo(HANDOFF_URL).length, 1);
		assert.equal(
			header(mock.calls[0].init, "x-startup-to"),
			"acme@employers.internjobs.ai",
			"angle brackets + display name must be stripped before handoff",
		);
	} finally {
		mock.restore();
	}
});

test("employers: uppercase recipient is normalized to lowercase before dispatch", async () => {
	const mock = installFetchMock(() => ok(200));
	try {
		const message = makeMessage({ to: "ACME@Employers.InternJobs.ai" });
		await worker.email(message, makeEnv(), {});

		assert.deepEqual(message.forwards, []);
		assert.equal(header(mock.calls[0].init, "x-startup-to"), "acme@employers.internjobs.ai");
	} finally {
		mock.restore();
	}
});

test("employers: 404 unknown slug FAILS SAFE to the operator forward (never dropped)", async () => {
	const mock = installFetchMock((url) => (url === HANDOFF_URL ? ok(404) : ok(200)));
	try {
		const message = makeMessage({ to: "nobody@employers.internjobs.ai" });
		await worker.email(message, makeEnv(), {});

		assert.deepEqual(
			message.forwards,
			[OPERATOR_FALLBACK],
			"an unresolvable employers slug must still reach a human",
		);
		assert.equal(mock.callsTo(HANDOFF_URL).length, 1, "handoff was attempted once");
	} finally {
		mock.restore();
	}
});

test("33-08: OPERATOR_FALLBACK_EMAIL env overrides the fallback target; unset keeps the default", async () => {
	// Configured: fail-safe forward goes to the configured operator, not the default.
	let mock = installFetchMock((url) => (url === HANDOFF_URL ? ok(404) : ok(200)));
	try {
		const message = makeMessage({ to: "nobody@employers.internjobs.ai" });
		await worker.email(message, makeEnv({ OPERATOR_FALLBACK_EMAIL: "ops@growthpods.io" }), {});
		assert.deepEqual(message.forwards, ["ops@growthpods.io"], "override must be honored");
	} finally {
		mock.restore();
	}
	// Empty/whitespace override falls back to the hardcoded default (no accidental blank forward).
	mock = installFetchMock((url) => (url === HANDOFF_URL ? ok(404) : ok(200)));
	try {
		const message = makeMessage({ to: "nobody@employers.internjobs.ai" });
		await worker.email(message, makeEnv({ OPERATOR_FALLBACK_EMAIL: "   " }), {});
		assert.deepEqual(message.forwards, [OPERATOR_FALLBACK], "blank override must not blank the forward");
	} finally {
		mock.restore();
	}
});

test("employers: 500 from the startup Worker FAILS SAFE to the operator forward", async () => {
	const mock = installFetchMock((url) => (url === HANDOFF_URL ? ok(500) : ok(200)));
	try {
		const message = makeMessage({ to: "acme@employers.internjobs.ai" });
		await worker.email(message, makeEnv(), {});
		assert.deepEqual(message.forwards, [OPERATOR_FALLBACK]);
	} finally {
		mock.restore();
	}
});

test("employers: network error / timeout FAILS SAFE to the operator forward", async () => {
	const mock = installFetchMock((url) => {
		if (url === HANDOFF_URL) throw new Error("The operation was aborted due to timeout");
		return ok(200);
	});
	try {
		const message = makeMessage({ to: "acme@employers.internjobs.ai" });
		await worker.email(message, makeEnv(), {});
		assert.deepEqual(message.forwards, [OPERATOR_FALLBACK]);
	} finally {
		mock.restore();
	}
});

test("employers: unconfigured STARTUP_EMAIL_HANDOFF_URL short-circuits before any handoff fetch", async () => {
	const mock = installFetchMock(() => ok(200));
	try {
		const message = makeMessage({ to: "acme@employers.internjobs.ai" });
		await worker.email(message, makeEnv({ STARTUP_EMAIL_HANDOFF_URL: undefined }), {});

		assert.deepEqual(message.forwards, [OPERATOR_FALLBACK], "must fall back to the operator");
		assert.equal(
			mock.callsTo(HANDOFF_URL).length,
			0,
			"the unconfigured guard must short-circuit before any handoff network call",
		);
		// NOTE: total fetch count is not asserted to be 0 — falling through to
		// branch 3 legitimately fires the pre-existing best-effort audit ping to
		// FLY_INGEST_URL. What matters is that NO handoff was attempted.
	} finally {
		mock.restore();
	}
});

test("employers: unconfigured EMAIL_HANDOFF_SECRET short-circuits before any handoff fetch", async () => {
	const mock = installFetchMock(() => ok(200));
	try {
		const message = makeMessage({ to: "acme@employers.internjobs.ai" });
		await worker.email(message, makeEnv({ EMAIL_HANDOFF_SECRET: undefined }), {});

		assert.deepEqual(message.forwards, [OPERATOR_FALLBACK]);
		assert.equal(mock.callsTo(HANDOFF_URL).length, 0);
	} finally {
		mock.restore();
	}
});

test("employers: dispatchToEmployersHandoff returns false (not throws) on every failure mode", async () => {
	// Direct-unit coverage of the helper's contract: the caller's fail-safe
	// fallthrough depends on `false`, never an exception.
	const cases = [
		{ name: "unconfigured", env: makeEnv({ EMAIL_HANDOFF_SECRET: undefined }), handler: () => ok(200) },
		{ name: "non-2xx", env: makeEnv(), handler: () => ok(503) },
		{
			name: "throws",
			env: makeEnv(),
			handler: () => {
				throw new Error("boom");
			},
		},
	];
	for (const c of cases) {
		const mock = installFetchMock(c.handler);
		try {
			const message = makeMessage({ to: "acme@employers.internjobs.ai" });
			const result = await dispatchToEmployersHandoff(
				message,
				"acme@employers.internjobs.ai",
				"founder@acme.example",
				c.env,
			);
			assert.equal(result, false, `${c.name}: must return false`);
		} finally {
			mock.restore();
		}
	}
});

// ── Timeout sanity check — SAME-PACKAGE ONLY ─────────────────────────────────
// This is a cheap tripwire against an accidental edit to THIS package's own two
// numbers. It is explicitly NOT the cross-package latency invariant: it cannot
// see apps/startup's RESOLVE_TIMEOUT_MS / INSERT_TIMEOUT_MS, so this suite going
// green tells you NOTHING about whether the other package's inner timeouts are
// still correctly sized against this outer ceiling. That guarantee is enforced
// by scripts/check-email-timeout-invariant.mjs (Plan 33-04), which reads both
// packages' real constants. Do not mistake this test for that check.
test("timeout sanity (same-package only): exported budget constants are unchanged", () => {
	assert.equal(EMPLOYERS_HANDOFF_TIMEOUT_MS, 20000, "outer handoff ceiling");
	assert.equal(OVERHEAD_BUDGET_MS, 5000, "non-fetch overhead budget (TLS + body transfer + MIME parse CPU)");
});

test("timeout sanity (same-package only): handoff fetch is given an AbortSignal", async () => {
	const mock = installFetchMock(() => ok(200));
	try {
		const message = makeMessage({ to: "acme@employers.internjobs.ai" });
		await worker.email(message, makeEnv(), {});
		const { init } = mock.callsTo(HANDOFF_URL)[0];
		assert.ok(init.signal instanceof AbortSignal, "handoff must be timeout-bounded");
	} finally {
		mock.restore();
	}
});

// ═════════════════════════════════════════════════════════════════════════════
// REGRESSION: conv-alias path (agent.internjobs.ai) — MUST be unchanged
// ═════════════════════════════════════════════════════════════════════════════

const CONV_UUID = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";
const CONV_TO = `conv-${CONV_UUID}@agent.internjobs.ai`;

test("regression: conv-alias success POSTs the HMAC-signed payload to FLY_INGEST_URL and does not forward", async () => {
	const mock = installFetchMock((url) => {
		assert.equal(url, FLY_INGEST_URL);
		return ok(200);
	});
	try {
		const message = makeMessage({ to: CONV_TO });
		await worker.email(message, makeEnv(), {});

		assert.deepEqual(message.forwards, [], "successful ingest must not forward");
		assert.equal(mock.callsTo(FLY_INGEST_URL).length, 1);
		assert.equal(
			mock.callsTo(HANDOFF_URL).length,
			0,
			"Phase 33 must NOT divert conv-alias mail to the employers handoff",
		);

		const { init } = mock.calls[0];
		assert.equal(init.method, "POST");
		assert.equal(header(init, "content-type"), "application/json");
		assert.ok(header(init, "x-email-hmac-sha256"), "HMAC signature header still present");
		assert.equal(header(init, "x-email-worker-secret"), "test-worker-secret");

		const body = JSON.parse(init.body);
		assert.equal(body.conversation_id, CONV_UUID);
		assert.equal(body.from, "founder@acme.example");
		assert.equal(body.to, CONV_TO);
		assert.ok(body.body.includes("let's set up a call"), "raw mail text is carried through");
	} finally {
		mock.restore();
	}
});

test("regression: conv-alias with bracketed recipient still extracts the conversation id", async () => {
	const mock = installFetchMock(() => ok(200));
	try {
		const message = makeMessage({ to: `"Acme" <${CONV_TO.toUpperCase()}>` });
		await worker.email(message, makeEnv(), {});

		assert.deepEqual(message.forwards, []);
		const body = JSON.parse(mock.callsTo(FLY_INGEST_URL)[0].init.body);
		assert.equal(body.conversation_id, CONV_UUID, "uuid is lowercased");
	} finally {
		mock.restore();
	}
});

test("regression: conv-alias ingest failure (non-2xx) still forwards to the operator", async () => {
	const mock = installFetchMock(() => ok(502));
	try {
		const message = makeMessage({ to: CONV_TO });
		await worker.email(message, makeEnv(), {});
		assert.deepEqual(message.forwards, [OPERATOR_FALLBACK]);
	} finally {
		mock.restore();
	}
});

test("regression: conv-alias ingest failure (network error) still forwards to the operator", async () => {
	const mock = installFetchMock(() => {
		throw new Error("fly is down");
	});
	try {
		const message = makeMessage({ to: CONV_TO });
		await worker.email(message, makeEnv(), {});
		assert.deepEqual(message.forwards, [OPERATOR_FALLBACK]);
		assert.equal(mock.callsTo(HANDOFF_URL).length, 0);
	} finally {
		mock.restore();
	}
});

// ═════════════════════════════════════════════════════════════════════════════
// REGRESSION: generic non-conv / apex operator-forward path — MUST be unchanged
// ═════════════════════════════════════════════════════════════════════════════

test("regression: apex address (randomthing@internjobs.ai) forwards to the operator, no employers handoff", async () => {
	const mock = installFetchMock(() => ok(200));
	try {
		// env is FULLY configured for the handoff — proving the suffix gate, not
		// a missing binding, is what keeps apex mail out of the startup pipeline.
		const message = makeMessage({ to: "randomthing@internjobs.ai" });
		await worker.email(message, makeEnv(), {});

		assert.deepEqual(message.forwards, [OPERATOR_FALLBACK]);
		assert.equal(mock.callsTo(HANDOFF_URL).length, 0, "apex mail must never hit the handoff");
	} finally {
		mock.restore();
	}
});

test("regression: agent subdomain non-conv address forwards to the operator, no employers handoff", async () => {
	const mock = installFetchMock(() => ok(200));
	try {
		const message = makeMessage({ to: "someone@agent.internjobs.ai" });
		await worker.email(message, makeEnv(), {});

		assert.deepEqual(message.forwards, [OPERATOR_FALLBACK]);
		assert.equal(mock.callsTo(HANDOFF_URL).length, 0);
		// The pre-existing best-effort audit ping to FLY_INGEST_URL still fires.
		assert.equal(mock.callsTo(FLY_INGEST_URL).length, 1, "audit ping preserved");
		assert.equal(header(mock.callsTo(FLY_INGEST_URL)[0].init, "x-email-audit-only"), "1");
	} finally {
		mock.restore();
	}
});

test("regression: a near-miss conv alias (bad uuid) is not treated as a conversation", async () => {
	const mock = installFetchMock(() => ok(200));
	try {
		const message = makeMessage({ to: "conv-not-a-uuid@agent.internjobs.ai" });
		await worker.email(message, makeEnv(), {});
		assert.deepEqual(message.forwards, [OPERATOR_FALLBACK]);
		assert.equal(mock.callsTo(HANDOFF_URL).length, 0);
	} finally {
		mock.restore();
	}
});

test("regression: a conv alias on the WRONG domain is not ingested (apex conv-* is not accepted)", async () => {
	const mock = installFetchMock(() => ok(200));
	try {
		const message = makeMessage({ to: `conv-${CONV_UUID}@internjobs.ai` });
		await worker.email(message, makeEnv(), {});
		assert.deepEqual(
			message.forwards,
			[OPERATOR_FALLBACK],
			"apex conv-* was never accepted as a transitional fallback — keep it that way",
		);
	} finally {
		mock.restore();
	}
});

// ═════════════════════════════════════════════════════════════════════════════
// REGRESSION: outer safety net — the single most load-bearing guarantee here.
// CF Email Routing DROPS the message silently if email() throws (PITFALLS #7).
// ═════════════════════════════════════════════════════════════════════════════

test("regression: an unexpected internal throw never escapes email() and still forwards", async () => {
	const mock = installFetchMock(() => ok(200));
	try {
		const message = makeMessage({
			to: "acme@employers.internjobs.ai",
			headersGetThrows: true,
		});

		await assert.doesNotReject(
			() => worker.email(message, makeEnv(), {}),
			"email() must NEVER throw — CF silently drops the message if it does",
		);
		assert.deepEqual(
			message.forwards,
			[OPERATOR_FALLBACK],
			"the outer catch must still hand the mail to a human",
		);
	} finally {
		mock.restore();
	}
});

test("regression: even a FAILING operator forward does not make email() throw", async () => {
	const mock = installFetchMock(() => ok(200));
	try {
		const message = makeMessage({
			to: "randomthing@internjobs.ai",
			forwardThrows: true,
		});
		await assert.doesNotReject(() => worker.email(message, makeEnv(), {}));
		assert.deepEqual(message.forwards, [OPERATOR_FALLBACK], "forward was attempted");
	} finally {
		mock.restore();
	}
});

// ── workerd entrypoint-shape guard (Phase 33 Plan 04) ────────────────────────
//
// REGRESSION GUARD for a real production outage caused during 33-04.
//
// src/index.js is the Worker ENTRYPOINT. The Workers runtime requires every
// NAMED export of an entrypoint module to be a handler — a function,
// ExportedHandler, or WorkerEntrypoint/DurableObject class. Plan 33-02 declared
// `export const EMPLOYERS_HANDOFF_TIMEOUT_MS = 20000` (a NUMBER) here, and
// workerd responded by refusing to instantiate the entire script:
//
//   Uncaught TypeError: Incorrect type for map entry
//   'EMPLOYERS_HANDOFF_TIMEOUT_MS': the provided value is not of type
//   'function or ExportedHandler'.  The Workers runtime failed to start.
//
// Because this Worker owns the zone-wide CF Email Routing catch-all, that is a
// TOTAL inbound-mail outage for internjobs.ai — conv-alias ingestion and the
// operator forward included.
//
// Nothing else in the pipeline catches it: `node --check` passes (valid syntax),
// node:test passes (Node allows numeric named exports), and `wrangler deploy`
// ACCEPTS the upload — it only explodes at runtime instantiation. Hence this
// test, which encodes the runtime's actual constraint.
test("workerd guard: every named export of the entrypoint is a function (no primitives)", () => {
	const offenders = Object.entries(entrypoint)
		.filter(([name]) => name !== "default")
		.filter(([, value]) => typeof value !== "function")
		.map(([name, value]) => `${name} (${typeof value})`);

	assert.deepEqual(
		offenders,
		[],
		"src/index.js is the Worker entrypoint: workerd requires every named export to be a " +
			"function/handler and will REFUSE TO START the whole Worker otherwise (total inbound-mail " +
			"outage for the zone). Move non-function values (constants, config objects) into a " +
			"non-entrypoint module such as src/constants.js and import them here instead. " +
			"Offending export(s): " +
			(offenders.join(", ") || "none"),
	);

	// The default export must still be the email handler.
	assert.equal(typeof entrypoint.default?.email, "function", "default export must expose email()");
});
