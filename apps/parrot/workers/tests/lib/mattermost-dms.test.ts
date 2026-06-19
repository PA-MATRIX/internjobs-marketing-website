// Phase 31 Wave 2 (plan 31-03): DM + group DM helpers.
//
// Covers the new mattermost.ts helpers added for DMs:
//   - createMmDirectChannel  → POST /api/v4/channels/direct
//   - createMmGroupChannel   → POST /api/v4/channels/group
//   - getMmMyDirectChannels  → GET /api/v4/users/me/channels (filter D + G)
//
// These take a bearer token directly (the Worker routes pass the employee PAT
// via mmFetchAsUser). We assert the HTTP method, path, body shape, the D/G
// filter, and success/failure mapping for each.

import { describe, it, expect, vi, afterEach } from "vitest";
import {
	createMmDirectChannel,
	createMmGroupChannel,
	getMmMyDirectChannels,
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

describe("createMmDirectChannel", () => {
	it("POSTs the two user ids to /api/v4/channels/direct", async () => {
		const mock = stubFetch(
			() =>
				new Response(JSON.stringify({ id: "dm1", type: "D", name: "a__b" }), {
					status: 201,
				}),
		);
		const ch = await createMmDirectChannel(MM_URL, "tok", ["a", "b"]);
		expect(ch?.id).toBe("dm1");
		expect(ch?.type).toBe("D");
		const [url, init] = mock.mock.calls[0];
		expect(String(url)).toContain("/api/v4/channels/direct");
		expect(init.method).toBe("POST");
		expect(JSON.parse(init.body)).toEqual(["a", "b"]);
	});

	it("returns null on failure", async () => {
		stubFetch(() => new Response("{}", { status: 400 }));
		expect(await createMmDirectChannel(MM_URL, "tok", ["a", "b"])).toBeNull();
	});

	it("is idempotent — returns the existing channel (MM 201/200 with same id)", async () => {
		stubFetch(
			() =>
				new Response(JSON.stringify({ id: "dm-existing", type: "D" }), {
					status: 200,
				}),
		);
		const ch = await createMmDirectChannel(MM_URL, "tok", ["a", "b"]);
		expect(ch?.id).toBe("dm-existing");
	});
});

describe("createMmGroupChannel", () => {
	it("POSTs the id array to /api/v4/channels/group", async () => {
		const mock = stubFetch(
			() =>
				new Response(JSON.stringify({ id: "g1", type: "G" }), { status: 201 }),
		);
		const ch = await createMmGroupChannel(MM_URL, "tok", ["a", "b", "c"]);
		expect(ch?.id).toBe("g1");
		expect(ch?.type).toBe("G");
		const [url, init] = mock.mock.calls[0];
		expect(String(url)).toContain("/api/v4/channels/group");
		expect(init.method).toBe("POST");
		expect(JSON.parse(init.body)).toEqual(["a", "b", "c"]);
	});

	it("returns null on failure", async () => {
		stubFetch(() => new Response("{}", { status: 400 }));
		expect(await createMmGroupChannel(MM_URL, "tok", ["a", "b", "c"])).toBeNull();
	});
});

describe("getMmMyDirectChannels", () => {
	it("GETs /api/v4/users/me/channels and filters to type D + G", async () => {
		const mock = stubFetch(
			() =>
				new Response(
					JSON.stringify([
						{ id: "ch-public", type: "O" },
						{ id: "ch-private", type: "P" },
						{ id: "dm1", type: "D", name: "a__b" },
						{ id: "g1", type: "G" },
					]),
					{ status: 200 },
				),
		);
		const dms = await getMmMyDirectChannels(MM_URL, "user-pat");
		expect(dms.map((c) => c.id)).toEqual(["dm1", "g1"]);
		const [url, init] = mock.mock.calls[0];
		expect(String(url)).toContain("/api/v4/users/me/channels");
		expect(init.headers.Authorization).toBe("Bearer user-pat");
	});

	it("returns [] on failure", async () => {
		stubFetch(() => new Response("{}", { status: 401 }));
		expect(await getMmMyDirectChannels(MM_URL, "tok")).toEqual([]);
	});

	it("returns [] when no DM channels exist", async () => {
		stubFetch(
			() =>
				new Response(JSON.stringify([{ id: "ch-public", type: "O" }]), {
					status: 200,
				}),
		);
		expect(await getMmMyDirectChannels(MM_URL, "tok")).toEqual([]);
	});
});
