// Phase 32 (32-02): unit tests for the pure Parrot embed postMessage helpers.
//
// The source lives under app/lib/parrot-embed.ts (imported below via a
// relative path that crosses out of workers/tests/lib/) but is deliberately
// framework-free so it runs unmodified under this repo's node-only Vitest
// config (vitest.config.ts: environment "node", no jsdom).
//
// The origin-check cases directly satisfy the phase's non-negotiable
// requirement: "a postMessage from any origin OTHER than the configured
// Parrot origin is ignored, never acted on." Origin gating is pure logic and
// so is proven here without a browser.

import { describe, it, expect } from "vitest";
import {
	PARROT_EMBED_ORIGIN,
	isTrustedParrotOrigin,
	isParrotReadyMessage,
	isParrotCallEndedMessage,
	parseParrotBadge,
	parseParrotIncomingCall,
	buildParrotDialMessage,
	buildParrotTokenMessage,
	buildParrotOpenContactMessage,
	buildEmbedSrc,
} from "../../../app/lib/parrot-embed";

describe("isTrustedParrotOrigin", () => {
	it("accepts the exact configured origin", () => {
		expect(isTrustedParrotOrigin(PARROT_EMBED_ORIGIN)).toBe(true);
		expect(isTrustedParrotOrigin("https://parrot.projecta.ai")).toBe(true);
	});

	it("rejects a different scheme (http vs https)", () => {
		expect(isTrustedParrotOrigin("http://parrot.projecta.ai")).toBe(false);
	});

	it("rejects a different subdomain", () => {
		expect(isTrustedParrotOrigin("https://evil.projecta.ai")).toBe(false);
		expect(isTrustedParrotOrigin("https://parrot.evil.ai")).toBe(false);
	});

	it("rejects a trailing slash (origin strings never carry a path)", () => {
		expect(isTrustedParrotOrigin("https://parrot.projecta.ai/")).toBe(false);
	});

	it("rejects an unrelated origin entirely", () => {
		expect(isTrustedParrotOrigin("https://example.com")).toBe(false);
		expect(isTrustedParrotOrigin("")).toBe(false);
		expect(isTrustedParrotOrigin("null")).toBe(false);
	});

	it("honours an explicit expected-origin override", () => {
		expect(
			isTrustedParrotOrigin("https://staging.parrot.dev", "https://staging.parrot.dev"),
		).toBe(true);
		expect(
			isTrustedParrotOrigin("https://parrot.projecta.ai", "https://staging.parrot.dev"),
		).toBe(false);
	});
});

describe("parseParrotBadge", () => {
	it("parses a valid badge payload", () => {
		expect(
			parseParrotBadge({ type: "parrot:badge", calls: 3, messages: 1 }),
		).toEqual({ calls: 3, messages: 1 });
	});

	it("returns null for the wrong type", () => {
		expect(parseParrotBadge({ type: "parrot:ready", calls: 3 })).toBeNull();
	});

	it("returns null for non-object input (never throws)", () => {
		expect(parseParrotBadge(null)).toBeNull();
		expect(parseParrotBadge(undefined)).toBeNull();
		expect(parseParrotBadge("parrot:badge")).toBeNull();
		expect(parseParrotBadge(42)).toBeNull();
	});

	it("clamps missing / non-numeric fields to 0", () => {
		expect(parseParrotBadge({ type: "parrot:badge" })).toEqual({
			calls: 0,
			messages: 0,
		});
		expect(
			parseParrotBadge({ type: "parrot:badge", calls: "5", messages: null }),
		).toEqual({ calls: 0, messages: 0 });
		expect(
			parseParrotBadge({ type: "parrot:badge", calls: NaN, messages: Infinity }),
		).toEqual({ calls: 0, messages: 0 });
	});

	it("clamps negative numbers to 0", () => {
		expect(
			parseParrotBadge({ type: "parrot:badge", calls: -3, messages: -1 }),
		).toEqual({ calls: 0, messages: 0 });
	});
});

describe("parseParrotIncomingCall", () => {
	it("requires a non-empty from", () => {
		expect(
			parseParrotIncomingCall({ type: "parrot:incoming-call", from: "+15551234567" }),
		).toEqual({ from: "+15551234567", name: undefined });
	});

	it("returns null for missing / blank from", () => {
		expect(parseParrotIncomingCall({ type: "parrot:incoming-call" })).toBeNull();
		expect(
			parseParrotIncomingCall({ type: "parrot:incoming-call", from: "" }),
		).toBeNull();
		expect(
			parseParrotIncomingCall({ type: "parrot:incoming-call", from: "   " }),
		).toBeNull();
		expect(
			parseParrotIncomingCall({ type: "parrot:incoming-call", from: 12345 }),
		).toBeNull();
	});

	it("passes an optional name through when present", () => {
		expect(
			parseParrotIncomingCall({
				type: "parrot:incoming-call",
				from: "+15551234567",
				name: "Ada Lovelace",
			}),
		).toEqual({ from: "+15551234567", name: "Ada Lovelace" });
	});

	it("returns undefined name when absent or non-string", () => {
		expect(
			parseParrotIncomingCall({
				type: "parrot:incoming-call",
				from: "+1",
				name: 99,
			}),
		).toEqual({ from: "+1", name: undefined });
	});

	it("returns null for the wrong type or non-object", () => {
		expect(
			parseParrotIncomingCall({ type: "parrot:badge", from: "+1" }),
		).toBeNull();
		expect(parseParrotIncomingCall(null)).toBeNull();
	});
});

describe("isParrotReadyMessage / isParrotCallEndedMessage", () => {
	it("discriminates parrot:ready", () => {
		expect(isParrotReadyMessage({ type: "parrot:ready" })).toBe(true);
		expect(isParrotReadyMessage({ type: "parrot:call-ended" })).toBe(false);
		expect(isParrotReadyMessage(null)).toBe(false);
		expect(isParrotReadyMessage("parrot:ready")).toBe(false);
	});

	it("discriminates parrot:call-ended", () => {
		expect(isParrotCallEndedMessage({ type: "parrot:call-ended" })).toBe(true);
		expect(isParrotCallEndedMessage({ type: "parrot:ready" })).toBe(false);
		expect(isParrotCallEndedMessage(undefined)).toBe(false);
	});
});

describe("outbound message builders", () => {
	it("buildParrotDialMessage", () => {
		expect(buildParrotDialMessage("+15551234567")).toEqual({
			type: "parrot:dial",
			number: "+15551234567",
		});
	});

	it("buildParrotTokenMessage", () => {
		expect(buildParrotTokenMessage("jwt.abc.def")).toEqual({
			type: "parrot:token",
			token: "jwt.abc.def",
		});
	});

	it("buildParrotOpenContactMessage", () => {
		expect(buildParrotOpenContactMessage("contact-123")).toEqual({
			type: "parrot:open-contact",
			id: "contact-123",
		});
	});
});

describe("buildEmbedSrc", () => {
	it("appends token as a query param", () => {
		const src = buildEmbedSrc("https://parrot.projecta.ai/embed", "abc123");
		expect(new URL(src).searchParams.get("token")).toBe("abc123");
	});

	it("does not clobber an existing query string", () => {
		const src = buildEmbedSrc(
			"https://parrot.projecta.ai/embed?tenant=internjobs&mode=pane",
			"abc123",
		);
		const url = new URL(src);
		expect(url.searchParams.get("tenant")).toBe("internjobs");
		expect(url.searchParams.get("mode")).toBe("pane");
		expect(url.searchParams.get("token")).toBe("abc123");
	});

	it("round-trips a JWT-shaped token (dots, hyphens, underscores) intact", () => {
		const jwt =
			"eyJhbGci.eyJzdWIiOiJ1c2VyLTEyMyJ9.s0me-Sig_natur3-w1th_chars";
		const src = buildEmbedSrc("https://parrot.projecta.ai/embed", jwt);
		expect(new URL(src).searchParams.get("token")).toBe(jwt);
	});
});
