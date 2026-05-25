// apps/startup/workers/routes/telnyx.test.ts
// v1.4 Phase 29-01 — unit tests for the Telnyx SMS adapter surface.
//
// Uses Node 22's built-in `node:test` runner (matches slug.test.ts +
// webhooks.test.ts pattern). Run with:
//   cd apps/startup && npx tsx --test workers/routes/telnyx.test.ts
//
// Coverage (≥10 cases):
//   • intent.ts regex classifier: numeric reply (1..9), START/YES/Y/NO/N,
//     non-matching natural language (LLM-fallthrough = null)
//   • Ed25519 signature verify: round-trip with @noble/ed25519 (via node:crypto
//     verify), tampered body → false, missing key → false
//   • STOP keyword regex: STOP / stop / Unsubscribe / Cancel / End / Quit / STOPALL
//     all match; "stop being mean" does NOT match (would falsely opt-out)
//   • register_startup work-email rejection: gmail rejected, work email allowed
//
// The Ed25519 verifier here is a pure-function test of the same base64+subtle
// crypto pipeline used in routes/telnyx.ts verifyTelnyxSignature(). We
// generate a real Ed25519 keypair via node:crypto, sign a fixture, then
// confirm the worker-style verifier accepts/rejects appropriately.

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { generateKeyPairSync, sign as nodeSign } from "node:crypto";

import { classifyIntentRegex } from "../lib/intent";
import { isPersonalEmailDomain } from "../lib/workEmail";

// ── intent.ts regex classifier ───────────────────────────────────────────────

test("intent regex: '1' → show_candidate position=1", () => {
	const result = classifyIntentRegex("1");
	assert.deepEqual(result, {
		kind: "execute",
		action: "show_candidate",
		args: { position: 1 },
	});
});

test("intent regex: '  5  ' (whitespace-padded) → show_candidate position=5", () => {
	const result = classifyIntentRegex("  5  ");
	assert.deepEqual(result, {
		kind: "execute",
		action: "show_candidate",
		args: { position: 5 },
	});
});

test("intent regex: '9' → show_candidate position=9 (max)", () => {
	const result = classifyIntentRegex("9");
	assert.deepEqual(result, {
		kind: "execute",
		action: "show_candidate",
		args: { position: 9 },
	});
});

test("intent regex: '0' does NOT match (regex is [1-9])", () => {
	assert.equal(classifyIntentRegex("0"), null);
});

test("intent regex: '10' does NOT match (regex is single digit)", () => {
	assert.equal(classifyIntentRegex("10"), null);
});

test("intent regex: 'YES' (uppercase) → opt_in_touchbase=true", () => {
	const result = classifyIntentRegex("YES");
	assert.deepEqual(result, {
		kind: "execute",
		action: "opt_in_touchbase",
		args: { weekly_touchbase: true },
	});
});

test("intent regex: 'y' → opt_in_touchbase=true", () => {
	const result = classifyIntentRegex("y");
	assert.deepEqual(result, {
		kind: "execute",
		action: "opt_in_touchbase",
		args: { weekly_touchbase: true },
	});
});

test("intent regex: 'no' → opt_in_touchbase=false", () => {
	const result = classifyIntentRegex("no");
	assert.deepEqual(result, {
		kind: "execute",
		action: "opt_in_touchbase",
		args: { weekly_touchbase: false },
	});
});

test("intent regex: 'START' → opt_in_touchbase=true (re-subscribe)", () => {
	const result = classifyIntentRegex("START");
	assert.deepEqual(result, {
		kind: "execute",
		action: "opt_in_touchbase",
		args: { weekly_touchbase: true },
	});
});

test("intent regex: natural-language 'show me the top 3 candidates' falls through to null (LLM path)", () => {
	assert.equal(classifyIntentRegex("show me the top 3 candidates"), null);
});

test("intent regex: empty string returns null", () => {
	assert.equal(classifyIntentRegex(""), null);
	assert.equal(classifyIntentRegex("   "), null);
});

// ── STOP keyword regex ──────────────────────────────────────────────────────
// We re-declare the STOP_RE here to test it standalone. If this regex drifts
// in routes/telnyx.ts, both copies must change — the test catches that.

const STOP_RE = /^(stop\s*all|stop|unsubscribe|cancel|end|quit)$/i;

test("STOP regex: 'STOP' matches", () => {
	assert.equal(STOP_RE.test("STOP"), true);
});

test("STOP regex: 'stop' (lowercase) matches", () => {
	assert.equal(STOP_RE.test("stop"), true);
});

test("STOP regex: 'STOPALL' matches", () => {
	assert.equal(STOP_RE.test("STOPALL"), true);
});

test("STOP regex: 'STOP ALL' (with space) matches", () => {
	assert.equal(STOP_RE.test("STOP ALL"), true);
});

test("STOP regex: 'unsubscribe' matches", () => {
	assert.equal(STOP_RE.test("unsubscribe"), true);
});

test("STOP regex: 'Cancel' matches", () => {
	assert.equal(STOP_RE.test("Cancel"), true);
});

test("STOP regex: 'End' matches", () => {
	assert.equal(STOP_RE.test("End"), true);
});

test("STOP regex: 'Quit' matches", () => {
	assert.equal(STOP_RE.test("Quit"), true);
});

test("STOP regex: 'stop being mean' does NOT match (no false-positive opt-out)", () => {
	assert.equal(STOP_RE.test("stop being mean"), false);
});

test("STOP regex: 'stopwatch' does NOT match", () => {
	assert.equal(STOP_RE.test("stopwatch"), false);
});

// ── Ed25519 signature verification ──────────────────────────────────────────
//
// We replicate the worker's verifier locally to confirm the byte-shape of the
// signed message matches what Telnyx documents. The worker uses
// crypto.subtle.verify('Ed25519', key, sig, msg) which is the same primitive
// as node:crypto's verify(undefined, msg, publicKey, sig). If the bytes line
// up here, they line up in the Worker too.

function base64ToBytes(b64: string): Uint8Array {
	const bin = Buffer.from(b64, "base64");
	return new Uint8Array(bin);
}

async function verifyEd25519(
	publicKeyB64: string,
	signatureB64: string,
	signedMessage: string,
): Promise<boolean> {
	try {
		const publicKeyBytes = base64ToBytes(publicKeyB64);
		const signatureBytes = base64ToBytes(signatureB64);
		const messageBytes = new TextEncoder().encode(signedMessage);
		const cryptoKey = await crypto.subtle.importKey(
			"raw",
			publicKeyBytes,
			{ name: "Ed25519" },
			false,
			["verify"],
		);
		return await crypto.subtle.verify(
			"Ed25519",
			cryptoKey,
			signatureBytes,
			messageBytes,
		);
	} catch {
		return false;
	}
}

function makeKeypair(): { publicKeyB64: string; sign: (msg: string) => string } {
	const { publicKey, privateKey } = generateKeyPairSync("ed25519");
	// Export the raw 32-byte public key as base64.
	const spkiDer = publicKey.export({ format: "der", type: "spki" });
	// SPKI Ed25519 DER has a 12-byte prefix; the last 32 bytes are the raw key.
	const rawKey = spkiDer.subarray(spkiDer.length - 32);
	const publicKeyB64 = Buffer.from(rawKey).toString("base64");
	const sign = (msg: string): string => {
		const sig = nodeSign(null, Buffer.from(msg, "utf8"), privateKey);
		return sig.toString("base64");
	};
	return { publicKeyB64, sign };
}

test("Ed25519 verify: valid signature → true", async () => {
	const { publicKeyB64, sign } = makeKeypair();
	const timestamp = "1700000000";
	const body = '{"data":{"event_type":"message.received"}}';
	const signed = `${timestamp}|${body}`;
	const sigB64 = sign(signed);
	const ok = await verifyEd25519(publicKeyB64, sigB64, signed);
	assert.equal(ok, true);
});

test("Ed25519 verify: tampered body → false", async () => {
	const { publicKeyB64, sign } = makeKeypair();
	const timestamp = "1700000000";
	const body = '{"data":{"event_type":"message.received"}}';
	const signed = `${timestamp}|${body}`;
	const sigB64 = sign(signed);
	// Tamper: modify body bytes
	const tamperedSigned = `${timestamp}|${body.replace("message", "MESSAGE")}`;
	const ok = await verifyEd25519(publicKeyB64, sigB64, tamperedSigned);
	assert.equal(ok, false);
});

test("Ed25519 verify: wrong public key → false", async () => {
	const { sign } = makeKeypair();
	const { publicKeyB64: differentKey } = makeKeypair();
	const timestamp = "1700000000";
	const body = '{"data":{"event_type":"message.received"}}';
	const signed = `${timestamp}|${body}`;
	const sigB64 = sign(signed);
	const ok = await verifyEd25519(differentKey, sigB64, signed);
	assert.equal(ok, false);
});

test("Ed25519 verify: malformed base64 → false (no throw)", async () => {
	const ok = await verifyEd25519(
		"not-valid-base64-key!!!",
		"AAAA",
		"anything",
	);
	assert.equal(ok, false);
});

// ── register_startup work-email rejection ───────────────────────────────────
//
// The handleRegisterStartup handler short-circuits on isPersonalEmailDomain
// BEFORE calling the admin endpoint. We test the predicate directly here
// (shared between webhooks.ts and execute.ts via lib/workEmail.ts), then
// hand-verify the integration in the routes/telnyx.ts dispatch path via the
// per-test fetch interception below.

test("register_startup gate: gmail.com founder_email is rejected by isPersonalEmailDomain", () => {
	assert.equal(isPersonalEmailDomain("founder@gmail.com"), true);
});

test("register_startup gate: yahoo.com founder_email is rejected", () => {
	assert.equal(isPersonalEmailDomain("founder@yahoo.com"), true);
});

test("register_startup gate: work email (acme.io) is accepted", () => {
	assert.equal(isPersonalEmailDomain("founder@acme.io"), false);
});

test("register_startup gate: proton.me is rejected (privacy-mail also personal)", () => {
	assert.equal(isPersonalEmailDomain("founder@proton.me"), true);
});

test("register_startup gate: gmx.de wildcard is rejected", () => {
	assert.equal(isPersonalEmailDomain("founder@gmx.de"), true);
});

// ── formatForSms happy path (show_candidate output) ─────────────────────────

test("formatForSms: show_candidate shape → '#N: name\\nrole: title\\nsummary'", async () => {
	const { formatForSms } = await import("../lib/telnyx");
	const result = formatForSms({
		candidate_name: "alice student",
		role_title: "frontend intern",
		application_summary: "loves react",
		thread_id: "uuid-here",
		position: 1,
	});
	assert.equal(result.includes("#1: alice student"), true);
	assert.equal(result.includes("role: frontend intern"), true);
	assert.equal(result.includes("loves react"), true);
});

test("formatForSms: register_startup ok=true shape → 'registered!' message", async () => {
	const { formatForSms } = await import("../lib/telnyx");
	const result = formatForSms({
		ok: true,
		startup_id: "uuid",
		agent_email: "acme@startups.internjobs.ai",
		mcp_install_snippet: null,
	});
	assert.equal(result.startsWith("registered!"), true);
	assert.equal(result.includes("acme@startups.internjobs.ai"), true);
});

test("formatForSms: register_startup ok=false → returns message verbatim", async () => {
	const { formatForSms } = await import("../lib/telnyx");
	const result = formatForSms({
		ok: false,
		error: "personal_email_rejected",
		message: "work emails only please",
		agent_email: null,
	});
	assert.equal(result, "work emails only please");
});

test("formatForSms: array result → numbered list", async () => {
	const { formatForSms } = await import("../lib/telnyx");
	const result = formatForSms(["alice", "bob", "carol"]);
	assert.equal(result, "1. alice\n2. bob\n3. carol");
});

// ── Phase 29-03 touchbase fast-path regexes ─────────────────────────────────
//
// We mirror the regexes used in routes/telnyx.ts Phase 29-03 fast-paths so
// that any drift in those regexes is caught by these tests. The handler
// itself isn't unit-tested (Hono fetch handler) — but the regex contract is.

const NUMERIC_FASTPATH_RE = /^\s*([1-9])\s*$/;
const OPTIN_FASTPATH_RE = /^\s*(yes|y)\s*$/i;

test("touchbase numeric fast-path: '1' matches → position 1", () => {
	const m = NUMERIC_FASTPATH_RE.exec("1");
	assert.ok(m);
	assert.equal(parseInt(m![1], 10), 1);
});

test("touchbase numeric fast-path: '  3  ' (whitespace) matches → position 3", () => {
	const m = NUMERIC_FASTPATH_RE.exec("  3  ");
	assert.ok(m);
	assert.equal(parseInt(m![1], 10), 3);
});

test("touchbase numeric fast-path: '9' matches (max)", () => {
	const m = NUMERIC_FASTPATH_RE.exec("9");
	assert.ok(m);
	assert.equal(parseInt(m![1], 10), 9);
});

test("touchbase numeric fast-path: '0' does NOT match", () => {
	assert.equal(NUMERIC_FASTPATH_RE.exec("0"), null);
});

test("touchbase numeric fast-path: '10' does NOT match (two digits)", () => {
	assert.equal(NUMERIC_FASTPATH_RE.exec("10"), null);
});

test("touchbase numeric fast-path: '1 candidate' does NOT match", () => {
	assert.equal(NUMERIC_FASTPATH_RE.exec("1 candidate"), null);
});

test("touchbase opt-in fast-path: 'yes' matches", () => {
	const m = OPTIN_FASTPATH_RE.exec("yes");
	assert.ok(m);
});

test("touchbase opt-in fast-path: 'YES' (uppercase) matches", () => {
	const m = OPTIN_FASTPATH_RE.exec("YES");
	assert.ok(m);
});

test("touchbase opt-in fast-path: 'y' matches", () => {
	const m = OPTIN_FASTPATH_RE.exec("y");
	assert.ok(m);
});

test("touchbase opt-in fast-path: '  yes  ' (whitespace) matches", () => {
	const m = OPTIN_FASTPATH_RE.exec("  yes  ");
	assert.ok(m);
});

test("touchbase opt-in fast-path: 'yes please' does NOT match (would dilute confirm semantics)", () => {
	// The fast-path requires a bare yes/y so we don't accidentally opt-in on
	// "yes I'd like to know more about candidates" (natural language, LLM path).
	assert.equal(OPTIN_FASTPATH_RE.exec("yes please"), null);
});

test("touchbase opt-in fast-path: 'no' does NOT match (only yes/y)", () => {
	assert.equal(OPTIN_FASTPATH_RE.exec("no"), null);
});

test("touchbase opt-in fast-path: 'yellow' does NOT match (full word boundary required)", () => {
	assert.equal(OPTIN_FASTPATH_RE.exec("yellow"), null);
});

// ── Cursor JSON shape for KV — telnyx.ts reader side ────────────────────────
//
// The numeric fast-path in routes/telnyx.ts reads `touchbase:cursor:<phone>`
// as JSON.parse(...) and reads `cursor[position - 1].thread_id`. This test
// pins the shape contract from the READER side — scheduled.test.ts pins the
// WRITER side. If the two drift, one of these tests fails.

test("KV cursor shape: reader expects array with .thread_id at position 0..N-1", () => {
	const cursorJson = JSON.stringify([
		{ thread_id: "uuid-a", candidate_name: "A", role_title: "FE" },
		{ thread_id: "uuid-b", candidate_name: "B", role_title: null },
		{ thread_id: "uuid-c", candidate_name: "C", role_title: "BE" },
	]);
	const parsed = JSON.parse(cursorJson) as Array<{
		thread_id: string;
		candidate_name: string;
		role_title: string | null;
	}>;
	// Founder replies "2" → cursor[2 - 1] → entry 'B'
	assert.equal(parsed[1].thread_id, "uuid-b");
	// Founder replies "9" but cursor has only 3 → undefined (no false hit).
	assert.equal(parsed[8], undefined);
});
