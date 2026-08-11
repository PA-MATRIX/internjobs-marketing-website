// Phase 32: resolveClerkContact — canonical email/name from Clerk's Backend API.
//
// This backs the embed-token fix: phone-OTP accounts (and bootstrap operators
// with no directory row) reach the mint with employee.email degraded to a phone
// number or the Clerk user id, which Parrot cannot match. resolveClerkContact
// fetches the real address from Clerk. These tests pin the parsing + failure
// modes with a mocked fetch (same style as safety.test.ts).

import { describe, it, expect, vi, afterEach } from "vitest";
import { resolveClerkContact } from "../../lib/operator";
import type { Env } from "../../types";

const env = { PARROT_CLERK_SECRET_KEY: "sk_test_x" } as unknown as Env;

function mockFetchOnce(body: unknown, ok = true, status = 200) {
	vi.stubGlobal(
		"fetch",
		vi.fn(async () => ({
			ok,
			status,
			json: async () => body,
		})) as unknown as typeof fetch,
	);
}

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe("resolveClerkContact", () => {
	it("returns the PRIMARY email (not just the first) + assembled name", async () => {
		mockFetchOnce({
			first_name: "Nithin",
			last_name: "P",
			primary_email_address_id: "idn_primary",
			email_addresses: [
				{ id: "idn_other", email_address: "old@example.com" },
				{ id: "idn_primary", email_address: "Nithin@InternJobs.ai" },
			],
		});
		const r = await resolveClerkContact(env, "user_abc");
		expect(r.email).toBe("nithin@internjobs.ai"); // lowercased canonical
		expect(r.name).toBe("Nithin P");
	});

	it("falls back to the first address when no primary id matches", async () => {
		mockFetchOnce({
			email_addresses: [{ id: "idn_1", email_address: "solo@internjobs.ai" }],
		});
		const r = await resolveClerkContact(env, "user_solo");
		expect(r.email).toBe("solo@internjobs.ai");
	});

	it("returns null email when the user has no email addresses", async () => {
		mockFetchOnce({ first_name: "No", last_name: "Mail", email_addresses: [] });
		const r = await resolveClerkContact(env, "user_nomail");
		expect(r.email).toBeNull();
		expect(r.name).toBe("No Mail");
	});

	it("returns nulls (never throws) on a non-2xx Clerk response", async () => {
		mockFetchOnce({}, false, 404);
		const r = await resolveClerkContact(env, "user_missing");
		expect(r).toEqual({ email: null, name: null });
	});

	it("returns nulls without calling fetch when no secret key is configured", async () => {
		const spy = vi.fn();
		vi.stubGlobal("fetch", spy as unknown as typeof fetch);
		const r = await resolveClerkContact({} as Env, "user_x");
		expect(r).toEqual({ email: null, name: null });
		expect(spy).not.toHaveBeenCalled();
	});
});
