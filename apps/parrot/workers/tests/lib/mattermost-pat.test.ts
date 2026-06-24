// Phase 31 Wave 0 (plan 31-01): per-employee Mattermost PAT helpers.
//
// Covers:
//   - mintMmUserToken: POSTs to /api/v4/users/{id}/tokens, returns token / null
//   - mmFetchAsUser: uses the stored PAT; on 401 re-mints, persists, and retries
//   - mmFetchAsUser: returns 503 chat_not_provisioned when no token is stored

import { describe, it, expect, vi, afterEach } from "vitest";
import { mintMmUserToken, mmFetchAsUser } from "../../lib/mattermost";

const MM_URL = "https://mm.example.com";

afterEach(() => vi.unstubAllGlobals());

describe("mintMmUserToken", () => {
	it("returns the token when MM allows PAT minting", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(
				new Response(JSON.stringify({ token: "pat_abc" }), { status: 201 }),
			),
		);
		const token = await mintMmUserToken(MM_URL, "admin-token", "user1");
		expect(token).toBe("pat_abc");
	});

	it("returns null when MM has PAT minting disabled (501)", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(
				new Response(
					JSON.stringify({
						id: "api.user.create_user_access_token.disabled.app_error",
					}),
					{ status: 501 },
				),
			),
		);
		const token = await mintMmUserToken(MM_URL, "admin-token", "user1");
		expect(token).toBeNull();
	});
});

describe("mmFetchAsUser", () => {
	it("returns 503 chat_not_provisioned when no PAT is stored", async () => {
		const result = await mmFetchAsUser(
			MM_URL,
			"admin-token",
			"/api/v4/posts",
			{ method: "POST", body: "{}" },
			async () => null,
			async () => {},
		);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.status).toBe(503);
			expect(result.data).toEqual({ error: "chat_not_provisioned" });
		}
	});

	it("uses the stored PAT and returns data on success", async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			new Response(JSON.stringify({ id: "post1" }), { status: 201 }),
		);
		vi.stubGlobal("fetch", fetchMock);

		const result = await mmFetchAsUser<{ id: string }>(
			MM_URL,
			"admin-token",
			"/api/v4/posts",
			{ method: "POST", body: "{}" },
			async () => ({ mmUserId: "user1", token: "pat_old" }),
			async () => {},
		);

		expect(result.ok).toBe(true);
		if (result.ok) expect(result.data.id).toBe("post1");
		// Auth header carried the stored PAT.
		const firstInit = fetchMock.mock.calls[0][1];
		expect(firstInit.headers.Authorization).toBe("Bearer pat_old");
	});

	it("on 401 re-mints the PAT, persists it, and retries with the new token", async () => {
		const calls: string[] = [];
		const fetchMock = vi.fn().mockImplementation((url: string, init: any) => {
			const u = String(url);
			// PAT mint endpoint
			if (u.includes("/tokens")) {
				return Promise.resolve(
					new Response(JSON.stringify({ token: "pat_new" }), { status: 201 }),
				);
			}
			// First posts call: stale token → 401. Second: new token → success.
			const auth = init.headers.Authorization;
			calls.push(auth);
			if (auth === "Bearer pat_old") {
				return Promise.resolve(new Response("{}", { status: 401 }));
			}
			return Promise.resolve(
				new Response(JSON.stringify({ id: "post2" }), { status: 201 }),
			);
		});
		vi.stubGlobal("fetch", fetchMock);

		const setToken = vi.fn(async () => {});
		const result = await mmFetchAsUser<{ id: string }>(
			MM_URL,
			"admin-token",
			"/api/v4/posts",
			{ method: "POST", body: "{}" },
			async () => ({ mmUserId: "user1", token: "pat_old" }),
			setToken,
		);

		expect(result.ok).toBe(true);
		if (result.ok) expect(result.data.id).toBe("post2");
		// Persisted the freshly minted PAT.
		expect(setToken).toHaveBeenCalledWith("user1", "pat_new");
		// Retried with the new token after the 401.
		expect(calls).toEqual(["Bearer pat_old", "Bearer pat_new"]);
	});
});
