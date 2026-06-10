// apps/startup/workers/lib/slug.test.ts
// v1.4 Phase 28.5 STARTUP-AGENT-EMAIL-01 — unit tests for slug.ts.
//
// Uses Node 22's built-in `node:test` runner (no vitest/jest dep needed
// for apps/startup, which is a Worker-only project without a test
// framework yet). Run with:
//   cd apps/startup && node --test --import tsx workers/lib/slug.test.ts
// or just:
//   cd apps/startup && node --test workers/lib/slug.test.ts  (if tsx is global)
//
// Coverage:
//   • mintSlug: deterministic, lowercase, alphanumeric-only, length cap, trim.
//   • reserveUniqueSlug: 404 path (free), 200 path (collision, advance to -1, -2),
//     max-attempts exhaustion, non-2xx error path, empty-base guard.

import { strict as assert } from "node:assert";
import { test } from "node:test";

import {
	MAX_RESERVE_ATTEMPTS,
	MAX_SLUG_LEN,
	mintSlug,
	reserveUniqueSlug,
} from "./slug";

// ── mintSlug ────────────────────────────────────────────────────────────────

test("mintSlug: simple two-word company name", () => {
	assert.equal(mintSlug("Acme Corp"), "acme-corp");
});

test("mintSlug: collapses multiple whitespace runs into single hyphen", () => {
	assert.equal(mintSlug("  hello   world  "), "hello-world");
});

test("mintSlug: strips punctuation and special chars", () => {
	assert.equal(mintSlug("Acme, Inc."), "acme-inc");
	assert.equal(mintSlug("Foo & Bar!"), "foo-bar");
	assert.equal(mintSlug("Foo+Bar/Baz"), "foo-bar-baz");
});

test("mintSlug: caps length at MAX_SLUG_LEN (30)", () => {
	const result = mintSlug("A".repeat(50));
	assert.equal(result.length, MAX_SLUG_LEN);
	assert.equal(result, "a".repeat(MAX_SLUG_LEN));
});

test("mintSlug: deterministic — same input → same output", () => {
	assert.equal(mintSlug("Quantum AI Labs"), mintSlug("Quantum AI Labs"));
	assert.equal(mintSlug("Quantum AI Labs"), "quantum-ai-labs");
});

test("mintSlug: handles unicode by stripping it (alphanumeric-only)", () => {
	// Smart quotes, em-dashes, accents → all get hyphenated.
	assert.equal(mintSlug("Café — Société"), "caf-soci-t");
});

test("mintSlug: empty / all-non-alphanumeric input returns empty string", () => {
	assert.equal(mintSlug(""), "");
	assert.equal(mintSlug("!!! ??? ..."), "");
	assert.equal(mintSlug("   "), "");
});

test("mintSlug: numeric-only input is kept", () => {
	assert.equal(mintSlug("1234"), "1234");
	assert.equal(mintSlug("3M Co"), "3m-co");
});

test("mintSlug: length cap doesn't leave dangling hyphen", () => {
	// 30-char company name where the slice would end on a hyphen.
	// "aaaaaaaaaa-bbbbbbbbbb-ccccccccc-end" — after slice(0,30), the last
	// char might be a hyphen depending on word lengths. Verify trim runs
	// AFTER slice.
	const input = "aaaaaaaaaa bbbbbbbbbb ccccccccc-end"; // 35 chars
	const result = mintSlug(input);
	assert.ok(result.length <= MAX_SLUG_LEN, `slug length ${result.length} > ${MAX_SLUG_LEN}`);
	assert.ok(!result.endsWith("-"), `slug "${result}" ends with hyphen`);
});

// ── reserveUniqueSlug ────────────────────────────────────────────────────────

test("reserveUniqueSlug: returns base on first 404", async () => {
	const calls: string[] = [];
	const originalFetch = globalThis.fetch;
	globalThis.fetch = (async (url: string | URL) => {
		const u = String(url);
		calls.push(u);
		return new Response(null, { status: 404 });
	}) as typeof fetch;

	try {
		const result = await reserveUniqueSlug("acme", "https://api.example.com", "secret");
		assert.equal(result, "acme");
		assert.equal(calls.length, 1);
		assert.ok(calls[0].includes("agent_email=acme%40employers.internjobs.ai"));
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("reserveUniqueSlug: advances to -1 then -2 on consecutive collisions", async () => {
	const requested: string[] = [];
	const originalFetch = globalThis.fetch;
	let calls = 0;
	globalThis.fetch = (async (url: string | URL) => {
		calls++;
		const u = String(url);
		const m = u.match(/agent_email=([^&]+)/);
		if (m) requested.push(decodeURIComponent(m[1]));
		// First two attempts collide (200), third is free (404).
		if (calls <= 2) return new Response(null, { status: 200 });
		return new Response(null, { status: 404 });
	}) as typeof fetch;

	try {
		const result = await reserveUniqueSlug("acme", "https://api.example.com", "secret");
		assert.equal(result, "acme-2");
		assert.equal(calls, 3);
		assert.deepEqual(requested, [
			"acme@employers.internjobs.ai",
			"acme-1@employers.internjobs.ai",
			"acme-2@employers.internjobs.ai",
		]);
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("reserveUniqueSlug: throws after MAX_RESERVE_ATTEMPTS exhausted", async () => {
	const originalFetch = globalThis.fetch;
	let calls = 0;
	globalThis.fetch = (async () => {
		calls++;
		return new Response(null, { status: 200 }); // every slug taken
	}) as typeof fetch;

	try {
		await assert.rejects(
			() => reserveUniqueSlug("acme", "https://api.example.com", "secret"),
			/could not reserve a free slug.*after 10 attempts/,
		);
		assert.equal(calls, MAX_RESERVE_ATTEMPTS);
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("reserveUniqueSlug: throws on non-2xx, non-404 response", async () => {
	const originalFetch = globalThis.fetch;
	globalThis.fetch = (async () =>
		new Response("upstream broken", { status: 500 })) as typeof fetch;

	try {
		await assert.rejects(
			() => reserveUniqueSlug("acme", "https://api.example.com", "secret"),
			/Fly proxy returned 500/,
		);
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("reserveUniqueSlug: throws on empty base", async () => {
	await assert.rejects(
		() => reserveUniqueSlug("", "https://api.example.com", "secret"),
		/base slug is empty/,
	);
	await assert.rejects(
		() => reserveUniqueSlug("---", "https://api.example.com", "secret"),
		/base slug is empty after trim/,
	);
});

test("reserveUniqueSlug: includes Bearer header and times out gracefully", async () => {
	let lastInit: RequestInit | undefined;
	const originalFetch = globalThis.fetch;
	globalThis.fetch = (async (_url: string | URL, init?: RequestInit) => {
		lastInit = init;
		return new Response(null, { status: 404 });
	}) as typeof fetch;

	try {
		await reserveUniqueSlug("acme", "https://api.example.com/", "secret-abc");
		assert.ok(lastInit?.headers, "fetch called without headers");
		const headers = lastInit!.headers as Record<string, string>;
		assert.equal(headers.Authorization, "Bearer secret-abc");
		assert.ok(lastInit!.signal, "no AbortSignal attached (timeout missing)");
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("reserveUniqueSlug: long base + collision keeps candidate within MAX_SLUG_LEN", async () => {
	const longBase = "a".repeat(MAX_SLUG_LEN); // 30 chars
	const originalFetch = globalThis.fetch;
	const requested: string[] = [];
	let calls = 0;
	globalThis.fetch = (async (url: string | URL) => {
		calls++;
		const m = String(url).match(/agent_email=([^&]+)/);
		if (m) {
			const decoded = decodeURIComponent(m[1]);
			const localPart = decoded.split("@")[0];
			requested.push(localPart);
		}
		// Force a collision on the first attempt (length 30 base), then accept the -1 variant.
		if (calls === 1) return new Response(null, { status: 200 });
		return new Response(null, { status: 404 });
	}) as typeof fetch;

	try {
		const result = await reserveUniqueSlug(longBase, "https://api.example.com", "secret");
		assert.ok(result.length <= MAX_SLUG_LEN, `candidate length ${result.length} > ${MAX_SLUG_LEN}`);
		assert.ok(result.endsWith("-1"), `expected suffix -1, got ${result}`);
		for (const localPart of requested) {
			assert.ok(
				localPart.length <= MAX_SLUG_LEN,
				`localPart "${localPart}" exceeds MAX_SLUG_LEN`,
			);
		}
	} finally {
		globalThis.fetch = originalFetch;
	}
});
