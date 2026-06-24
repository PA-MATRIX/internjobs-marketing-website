// Phase 31 Wave 3 (plan 31-04): search + reaction helpers.
//
// Covers the new mattermost.ts helpers added for rich content:
//   - searchMmPosts       → POST /api/v4/teams/{teamId}/posts/search
//   - addMmReaction       → POST /api/v4/reactions
//   - removeMmReaction    → DELETE /api/v4/users/{u}/posts/{p}/reactions/{e}
//   - getMmPostReactions  → GET  /api/v4/posts/{postId}/reactions
//
// These take a bearer token directly (the Worker routes pass the employee PAT
// via mmFetchAsUser / chatUserProxy). We assert the HTTP method, path, body
// shape, and the success/failure mapping for each.

import { describe, it, expect, vi, afterEach } from "vitest";
import {
	addMmReaction,
	getMmPostReactions,
	removeMmReaction,
	searchMmPosts,
} from "../../lib/mattermost";

const MM_URL = "https://mm.example.com";

afterEach(() => vi.unstubAllGlobals());

function stubFetch(impl: (url: string, init: any) => Response) {
	const mock = vi.fn().mockImplementation((url: string, init: any) =>
		Promise.resolve(impl(String(url), init)),
	);
	vi.stubGlobal("fetch", mock);
	return mock;
}

describe("searchMmPosts", () => {
	it("POSTs terms to the team search endpoint and returns the post list", async () => {
		const mock = stubFetch(
			() =>
				new Response(
					JSON.stringify({ order: ["p1"], posts: { p1: { id: "p1" } } }),
					{ status: 200 },
				),
		);
		const res = await searchMmPosts(MM_URL, "tok", "team1", "deadline");
		expect(res?.order).toEqual(["p1"]);
		const [url, init] = mock.mock.calls[0];
		expect(String(url)).toContain("/api/v4/teams/team1/posts/search");
		expect(init.method).toBe("POST");
		expect(JSON.parse(init.body)).toEqual({
			terms: "deadline",
			is_or_search: false,
		});
	});

	it("passes is_or_search=true when requested", async () => {
		const mock = stubFetch(
			() => new Response(JSON.stringify({ order: [], posts: {} }), { status: 200 }),
		);
		await searchMmPosts(MM_URL, "tok", "team1", "a b", true);
		const init = mock.mock.calls[0][1];
		expect(JSON.parse(init.body).is_or_search).toBe(true);
	});

	it("returns null on failure", async () => {
		stubFetch(() => new Response("{}", { status: 500 }));
		expect(await searchMmPosts(MM_URL, "tok", "team1", "x")).toBeNull();
	});
});

describe("addMmReaction", () => {
	it("POSTs the reaction payload to /api/v4/reactions", async () => {
		const mock = stubFetch(
			() =>
				new Response(
					JSON.stringify({ user_id: "u1", post_id: "p1", emoji_name: "thumbsup" }),
					{ status: 201 },
				),
		);
		const ok = await addMmReaction(MM_URL, "tok", "u1", "p1", "thumbsup");
		expect(ok).toBe(true);
		const [url, init] = mock.mock.calls[0];
		expect(String(url)).toContain("/api/v4/reactions");
		expect(init.method).toBe("POST");
		expect(JSON.parse(init.body)).toEqual({
			user_id: "u1",
			post_id: "p1",
			emoji_name: "thumbsup",
			create_at: 0,
		});
	});

	it("returns false on failure", async () => {
		stubFetch(() => new Response("{}", { status: 403 }));
		expect(await addMmReaction(MM_URL, "tok", "u1", "p1", "heart")).toBe(false);
	});
});

describe("removeMmReaction", () => {
	it("DELETEs the user/post/emoji reaction path", async () => {
		const mock = stubFetch(() => new Response("{}", { status: 200 }));
		const ok = await removeMmReaction(MM_URL, "tok", "u1", "p1", "thumbsup");
		expect(ok).toBe(true);
		const [url, init] = mock.mock.calls[0];
		expect(String(url)).toContain(
			"/api/v4/users/u1/posts/p1/reactions/thumbsup",
		);
		expect(init.method).toBe("DELETE");
	});

	it("returns false on failure", async () => {
		stubFetch(() => new Response("{}", { status: 404 }));
		expect(await removeMmReaction(MM_URL, "tok", "u1", "p1", "heart")).toBe(false);
	});
});

describe("getMmPostReactions", () => {
	it("GETs the post reactions and returns the array", async () => {
		const mock = stubFetch(
			() =>
				new Response(
					JSON.stringify([
						{ user_id: "u1", post_id: "p1", emoji_name: "thumbsup" },
					]),
					{ status: 200 },
				),
		);
		const res = await getMmPostReactions(MM_URL, "tok", "p1");
		expect(res?.length).toBe(1);
		expect(res?.[0].emoji_name).toBe("thumbsup");
		const [url] = mock.mock.calls[0];
		expect(String(url)).toContain("/api/v4/posts/p1/reactions");
	});

	it("returns [] when MM returns no body", async () => {
		stubFetch(() => new Response("null", { status: 200 }));
		expect(await getMmPostReactions(MM_URL, "tok", "p1")).toEqual([]);
	});

	it("returns null on failure", async () => {
		stubFetch(() => new Response("{}", { status: 500 }));
		expect(await getMmPostReactions(MM_URL, "tok", "p1")).toBeNull();
	});
});
