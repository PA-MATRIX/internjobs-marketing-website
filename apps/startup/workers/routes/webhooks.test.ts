// apps/startup/workers/routes/webhooks.test.ts
// v1.4 Phase 28.5 Plan 05 — unit tests for webhooks.ts.
//
// Uses Node 22's built-in `node:test` runner (matches slug.test.ts pattern;
// no vitest dep needed for apps/startup). Run with:
//   cd apps/startup && node --test --import tsx workers/routes/webhooks.test.ts
//
// Coverage:
//   • isPersonalEmail: blocked domains, work domains, uppercase, subdomain
//     ambiguity, gmx.* family, empty/malformed input.
//   • extractPrimaryEmail: primary_email_address_id lookup, fallback to
//     email_addresses[0], empty list, no primary_id.
//   • handleClerkWebhook integration: missing secret → 503, wrong signature
//     → 400, valid signature + non-user.created → 200 no-op, valid signature
//     + user.created with work email → 200 no DELETE, valid signature +
//     user.created with personal email → DELETE fired + 200.
//
// Svix fixtures are generated inline via the svix lib (Webhook.sign()) so
// we don't have to vendor real Clerk dashboard payloads. The signature
// algorithm is what svix.Webhook.verify() validates, so the fixture is
// real even though the JSON body is contrived.

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { Webhook } from "svix";

import {
	extractPrimaryEmail,
	handleClerkWebhook,
	isPersonalEmail,
} from "./webhooks";
import type { Env } from "../types";

// ── isPersonalEmail ──────────────────────────────────────────────────────────

test("isPersonalEmail: gmail.com is blocked", () => {
	assert.equal(isPersonalEmail("alice@gmail.com"), true);
});

test("isPersonalEmail: yahoo.com is blocked", () => {
	assert.equal(isPersonalEmail("alice@yahoo.com"), true);
});

test("isPersonalEmail: hotmail.com is blocked", () => {
	assert.equal(isPersonalEmail("alice@hotmail.com"), true);
});

test("isPersonalEmail: outlook.com is blocked", () => {
	assert.equal(isPersonalEmail("alice@outlook.com"), true);
});

test("isPersonalEmail: icloud.com is blocked", () => {
	assert.equal(isPersonalEmail("alice@icloud.com"), true);
});

test("isPersonalEmail: proton.me is blocked", () => {
	assert.equal(isPersonalEmail("alice@proton.me"), true);
});

test("isPersonalEmail: acme.io (work domain) is allowed", () => {
	assert.equal(isPersonalEmail("founder@acme.io"), false);
});

test("isPersonalEmail: stripe.com (work domain) is allowed", () => {
	assert.equal(isPersonalEmail("ceo@stripe.com"), false);
});

test("isPersonalEmail: uppercase domain still blocked (case-insensitive)", () => {
	assert.equal(isPersonalEmail("alice@GMAIL.COM"), true);
});

test("isPersonalEmail: gmx.de (German GMX) is blocked", () => {
	assert.equal(isPersonalEmail("alice@gmx.de"), true);
});

test("isPersonalEmail: gmx.com is blocked", () => {
	assert.equal(isPersonalEmail("alice@gmx.com"), true);
});

test("isPersonalEmail: subdomain like alice@mail.acme.com is allowed (subdomain != blocked exact)", () => {
	// Subdomains of work domains are still work — we only match exact domain.
	// This also means alice@mail.gmail.com would NOT be blocked, which is
	// fine — gmail doesn't actually issue subdomains to users.
	assert.equal(isPersonalEmail("alice@mail.acme.com"), false);
});

test("isPersonalEmail: malformed input (no @) returns false", () => {
	assert.equal(isPersonalEmail("notanemail"), false);
});

test("isPersonalEmail: empty string returns false", () => {
	assert.equal(isPersonalEmail(""), false);
});

test("isPersonalEmail: trailing whitespace on domain is trimmed", () => {
	assert.equal(isPersonalEmail("alice@gmail.com  "), true);
});

// ── extractPrimaryEmail ──────────────────────────────────────────────────────

test("extractPrimaryEmail: uses primary_email_address_id when present", () => {
	const email = extractPrimaryEmail({
		type: "user.created",
		data: {
			id: "user_123",
			primary_email_address_id: "email_b",
			email_addresses: [
				{ id: "email_a", email_address: "first@example.com" },
				{ id: "email_b", email_address: "primary@example.com" },
			],
		},
	});
	assert.equal(email, "primary@example.com");
});

test("extractPrimaryEmail: falls back to email_addresses[0] when no primary_id", () => {
	const email = extractPrimaryEmail({
		type: "user.created",
		data: {
			id: "user_123",
			email_addresses: [{ email_address: "only@example.com" }],
		},
	});
	assert.equal(email, "only@example.com");
});

test("extractPrimaryEmail: returns null when email_addresses is empty", () => {
	const email = extractPrimaryEmail({
		type: "user.created",
		data: { id: "user_123", email_addresses: [] },
	});
	assert.equal(email, null);
});

test("extractPrimaryEmail: returns null when data is missing", () => {
	const email = extractPrimaryEmail({ type: "user.created" });
	assert.equal(email, null);
});

// ── handleClerkWebhook integration ───────────────────────────────────────────

const TEST_SECRET = "whsec_TestSecretForUnitTestsOnly1234567890==";

function makeEnv(overrides: Partial<Env> = {}): Env {
	return {
		STARTUP_API_URL: "https://test.invalid",
		STARTUP_API_SECRET: "test-api-secret",
		STARTUP_MCP_ADMIN_SECRET: "test-admin-secret",
		STARTUPS_CLERK_SECRET_KEY: "sk_test_clerk_key",
		STARTUPS_CLERK_WEBHOOK_SECRET: TEST_SECRET,
		...overrides,
	} as Env;
}

function signFixture(secret: string, body: string) {
	const wh = new Webhook(secret);
	const msgId = `msg_${Date.now()}_${Math.random().toString(36).slice(2)}`;
	const timestamp = new Date();
	const signature = wh.sign(msgId, timestamp, body);
	return {
		"svix-id": msgId,
		"svix-timestamp": Math.floor(timestamp.getTime() / 1000).toString(),
		"svix-signature": signature,
	};
}

test("handleClerkWebhook: missing webhook secret returns 503", async () => {
	const env = makeEnv({ STARTUPS_CLERK_WEBHOOK_SECRET: undefined });
	const req = new Request("https://mcp.internjobs.ai/webhooks/clerk", {
		method: "POST",
		body: "{}",
		headers: { "Content-Type": "application/json" },
	});
	const res = await handleClerkWebhook(req, env);
	assert.equal(res.status, 503);
});

test("handleClerkWebhook: wrong/missing signature returns 400", async () => {
	const env = makeEnv();
	const req = new Request("https://mcp.internjobs.ai/webhooks/clerk", {
		method: "POST",
		body: JSON.stringify({ type: "user.created" }),
		headers: { "Content-Type": "application/json" },
	});
	const res = await handleClerkWebhook(req, env);
	assert.equal(res.status, 400);
});

test("handleClerkWebhook: valid signature + non-user.created event returns 200 no-op", async () => {
	const env = makeEnv();
	const body = JSON.stringify({ type: "user.updated", data: { id: "user_x" } });
	const headers = signFixture(TEST_SECRET, body);
	const req = new Request("https://mcp.internjobs.ai/webhooks/clerk", {
		method: "POST",
		body,
		headers: { "Content-Type": "application/json", ...headers },
	});
	const res = await handleClerkWebhook(req, env);
	assert.equal(res.status, 200);
});

test("handleClerkWebhook: valid signature + user.created with work email does NOT call DELETE", async () => {
	let deleteCalled = false;
	const originalFetch = globalThis.fetch;
	globalThis.fetch = (async (input: unknown) => {
		const url = typeof input === "string" ? input : (input as Request).url;
		if (url.includes("api.clerk.com/v1/users/")) deleteCalled = true;
		return new Response("{}", { status: 200 });
	}) as typeof fetch;

	try {
		const env = makeEnv();
		const body = JSON.stringify({
			type: "user.created",
			data: {
				id: "user_work",
				email_addresses: [{ email_address: "founder@acme.io" }],
			},
		});
		const headers = signFixture(TEST_SECRET, body);
		const req = new Request("https://mcp.internjobs.ai/webhooks/clerk", {
			method: "POST",
			body,
			headers: { "Content-Type": "application/json", ...headers },
		});
		const res = await handleClerkWebhook(req, env);
		assert.equal(res.status, 200);
		assert.equal(deleteCalled, false, "DELETE must not be called for work email");
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("handleClerkWebhook: valid signature + user.created with personal email CALLS DELETE", async () => {
	let deleteCalledWith = "";
	let deleteAuthHeader = "";
	const originalFetch = globalThis.fetch;
	globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
		const url = typeof input === "string" ? input : (input as Request).url;
		if (url.includes("api.clerk.com/v1/users/")) {
			deleteCalledWith = url;
			deleteAuthHeader =
				(init?.headers as Record<string, string>)?.["Authorization"] ?? "";
		}
		return new Response("{}", { status: 200 });
	}) as typeof fetch;

	try {
		const env = makeEnv();
		const body = JSON.stringify({
			type: "user.created",
			data: {
				id: "user_personal",
				email_addresses: [{ email_address: "alice@gmail.com" }],
			},
		});
		const headers = signFixture(TEST_SECRET, body);
		const req = new Request("https://mcp.internjobs.ai/webhooks/clerk", {
			method: "POST",
			body,
			headers: { "Content-Type": "application/json", ...headers },
		});
		const res = await handleClerkWebhook(req, env);
		assert.equal(res.status, 200);
		assert.match(deleteCalledWith, /api\.clerk\.com\/v1\/users\/user_personal/);
		assert.match(deleteAuthHeader, /^Bearer sk_test_clerk_key$/);
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("handleClerkWebhook: user.created with empty email_addresses returns 200 without DELETE (OAuth race guard)", async () => {
	let deleteCalled = false;
	const originalFetch = globalThis.fetch;
	globalThis.fetch = (async (input: unknown) => {
		const url = typeof input === "string" ? input : (input as Request).url;
		if (url.includes("api.clerk.com/v1/users/")) deleteCalled = true;
		return new Response("{}", { status: 200 });
	}) as typeof fetch;

	try {
		const env = makeEnv();
		const body = JSON.stringify({
			type: "user.created",
			data: { id: "user_no_email", email_addresses: [] },
		});
		const headers = signFixture(TEST_SECRET, body);
		const req = new Request("https://mcp.internjobs.ai/webhooks/clerk", {
			method: "POST",
			body,
			headers: { "Content-Type": "application/json", ...headers },
		});
		const res = await handleClerkWebhook(req, env);
		assert.equal(res.status, 200);
		assert.equal(deleteCalled, false, "must not DELETE when email missing");
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("handleClerkWebhook: tampered body with valid signature header returns 400", async () => {
	const env = makeEnv();
	const realBody = JSON.stringify({
		type: "user.created",
		data: { id: "user_x" },
	});
	const headers = signFixture(TEST_SECRET, realBody);
	const tamperedBody = JSON.stringify({
		type: "user.created",
		data: { id: "user_y" },
	});
	const req = new Request("https://mcp.internjobs.ai/webhooks/clerk", {
		method: "POST",
		body: tamperedBody,
		headers: { "Content-Type": "application/json", ...headers },
	});
	const res = await handleClerkWebhook(req, env);
	assert.equal(res.status, 400);
});
