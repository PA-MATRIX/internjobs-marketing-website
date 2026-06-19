// Phase 31 gap-fix (#18): unit tests for matchesMention — the pure mention
// detector that backs offline @mention/DM email. The original bug: only the
// human display name was matched, so the @username that Mattermost autocomplete
// inserts ("@john.doe") was missed and no offline email ever fired.

import { describe, it, expect } from "vitest";
import { matchesMention } from "../../lib/mattermost";

describe("matchesMention", () => {
	it("matches the MM @username (the autocomplete form)", () => {
		expect(
			matchesMention("hey @john.doe can you review this?", ["john.doe", "John Doe"]),
		).toBe(true);
	});

	it("matches the @displayName form too", () => {
		expect(matchesMention("ping @John Doe please", ["john.doe", "John Doe"])).toBe(
			true,
		);
	});

	it("respects word boundaries — @john does NOT match @johnny", () => {
		expect(matchesMention("welcome @johnny to the team", ["john"])).toBe(false);
	});

	it("respects word boundaries — @john.doe does NOT match @john.doe2", () => {
		expect(matchesMention("cc @john.doe2", ["john.doe"])).toBe(false);
	});

	it("matches a username followed by punctuation", () => {
		expect(matchesMention("thanks @john.doe!", ["john.doe"])).toBe(true);
		expect(matchesMention("@john.doe, see above", ["john.doe"])).toBe(true);
	});

	it("matches at end of string", () => {
		expect(matchesMention("over to you @john.doe", ["john.doe"])).toBe(true);
	});

	it("returns false for empty / missing message", () => {
		expect(matchesMention("", ["john.doe"])).toBe(false);
	});

	it("ignores null/undefined/blank tokens without throwing", () => {
		expect(matchesMention("hi @john.doe", [null, undefined, "", "john.doe"])).toBe(
			true,
		);
		expect(matchesMention("no mention here", [null, undefined, ""])).toBe(false);
	});

	it("does not match a bare token without the leading @", () => {
		expect(matchesMention("john.doe wrote the spec", ["john.doe"])).toBe(false);
	});

	it("finds a later occurrence when an earlier near-match fails the boundary", () => {
		// "@johnny" fails the boundary, but the real "@john " later should match.
		expect(matchesMention("@johnny and also @john here", ["john"])).toBe(true);
	});
});
