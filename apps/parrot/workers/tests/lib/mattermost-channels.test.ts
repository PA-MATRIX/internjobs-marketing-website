// Phase 31 Wave 1 (plan 31-02): channel CRUD + thread op helpers.
//
// Covers the new mattermost.ts helpers added for channels + threads:
//   - createMmChannel / joinMmChannel
//   - editMmPost / deleteMmPost / pinMmPost
//   - getMmPostThread / getMmPost / getMmTeamPublicChannels
//
// These take a bearer token directly (callers pass the employee PAT via
// mmFetchAsUser at the route layer). We assert the HTTP method, path, and
// success/failure mapping for each.

import { describe, it, expect, vi, afterEach } from "vitest";
import {
	createMmChannel,
	deleteMmPost,
	editMmPost,
	getMmPost,
	getMmPostThread,
	getMmTeamPublicChannels,
	joinMmChannel,
	pinMmPost,
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

describe("createMmChannel", () => {
	it("POSTs to /api/v4/channels and returns the channel", async () => {
		const mock = stubFetch(
			() => new Response(JSON.stringify({ id: "ch1", name: "test" }), { status: 201 }),
		);
		const ch = await createMmChannel(MM_URL, "tok", "team1", "test", "Test", "O");
		expect(ch?.id).toBe("ch1");
		const [url, init] = mock.mock.calls[0];
		expect(String(url)).toContain("/api/v4/channels");
		expect(init.method).toBe("POST");
		const sent = JSON.parse(init.body);
		expect(sent).toMatchObject({ team_id: "team1", name: "test", type: "O" });
	});

	it("returns null on failure", async () => {
		stubFetch(() => new Response("{}", { status: 400 }));
		const ch = await createMmChannel(MM_URL, "tok", "team1", "x", "X", "P");
		expect(ch).toBeNull();
	});
});

describe("joinMmChannel", () => {
	it("returns true on 201", async () => {
		const mock = stubFetch(() => new Response("{}", { status: 201 }));
		const ok = await joinMmChannel(MM_URL, "tok", "ch1", "user1");
		expect(ok).toBe(true);
		const [url, init] = mock.mock.calls[0];
		expect(String(url)).toContain("/api/v4/channels/ch1/members");
		expect(init.method).toBe("POST");
		expect(JSON.parse(init.body)).toEqual({ user_id: "user1" });
	});

	it("treats 400 (already a member) as success", async () => {
		stubFetch(() => new Response("{}", { status: 400 }));
		expect(await joinMmChannel(MM_URL, "tok", "ch1", "user1")).toBe(true);
	});

	it("returns false on other errors", async () => {
		stubFetch(() => new Response("{}", { status: 403 }));
		expect(await joinMmChannel(MM_URL, "tok", "ch1", "user1")).toBe(false);
	});
});

describe("editMmPost", () => {
	it("PUTs /api/v4/posts/{id} with the new message", async () => {
		const mock = stubFetch(
			() => new Response(JSON.stringify({ id: "p1", message: "edited" }), { status: 200 }),
		);
		const post = await editMmPost(MM_URL, "tok", "p1", "edited");
		expect(post?.message).toBe("edited");
		const [url, init] = mock.mock.calls[0];
		expect(String(url)).toContain("/api/v4/posts/p1");
		expect(init.method).toBe("PUT");
		expect(JSON.parse(init.body)).toEqual({ id: "p1", message: "edited" });
	});
});

describe("deleteMmPost", () => {
	it("DELETEs and returns true on success", async () => {
		const mock = stubFetch(() => new Response("{}", { status: 200 }));
		expect(await deleteMmPost(MM_URL, "tok", "p1")).toBe(true);
		expect(mock.mock.calls[0][1].method).toBe("DELETE");
	});

	it("returns false on failure", async () => {
		stubFetch(() => new Response("{}", { status: 403 }));
		expect(await deleteMmPost(MM_URL, "tok", "p1")).toBe(false);
	});
});

describe("pinMmPost", () => {
	it("POSTs /api/v4/posts/{id}/pin", async () => {
		const mock = stubFetch(() => new Response("{}", { status: 200 }));
		expect(await pinMmPost(MM_URL, "tok", "p1")).toBe(true);
		const [url, init] = mock.mock.calls[0];
		expect(String(url)).toContain("/api/v4/posts/p1/pin");
		expect(init.method).toBe("POST");
	});
});

describe("getMmPostThread", () => {
	it("GETs the thread post list", async () => {
		const mock = stubFetch(
			() =>
				new Response(
					JSON.stringify({ order: ["p1", "p2"], posts: { p1: {}, p2: {} } }),
					{ status: 200 },
				),
		);
		const list = await getMmPostThread(MM_URL, "tok", "p1");
		expect(list?.order).toEqual(["p1", "p2"]);
		expect(String(mock.mock.calls[0][0])).toContain("/api/v4/posts/p1/thread");
	});

	it("returns null on failure", async () => {
		stubFetch(() => new Response("{}", { status: 404 }));
		expect(await getMmPostThread(MM_URL, "tok", "p1")).toBeNull();
	});
});

describe("getMmPost", () => {
	it("GETs a single post", async () => {
		stubFetch(
			() => new Response(JSON.stringify({ id: "p1", user_id: "u1" }), { status: 200 }),
		);
		const post = await getMmPost(MM_URL, "tok", "p1");
		expect(post?.user_id).toBe("u1");
	});
});

describe("getMmTeamPublicChannels", () => {
	it("GETs the team channels page with the user PAT", async () => {
		const mock = stubFetch(
			() => new Response(JSON.stringify([{ id: "ch1" }, { id: "ch2" }]), { status: 200 }),
		);
		const channels = await getMmTeamPublicChannels(MM_URL, "user-pat", "team1");
		expect(channels.map((c) => c.id)).toEqual(["ch1", "ch2"]);
		const [url, init] = mock.mock.calls[0];
		expect(String(url)).toContain("/api/v4/teams/team1/channels");
		expect(init.headers.Authorization).toBe("Bearer user-pat");
	});

	it("returns [] on failure", async () => {
		stubFetch(() => new Response("{}", { status: 502 }));
		expect(await getMmTeamPublicChannels(MM_URL, "tok", "team1")).toEqual([]);
	});
});
