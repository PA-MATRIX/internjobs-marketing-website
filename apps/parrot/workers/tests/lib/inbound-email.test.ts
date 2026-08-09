// v1.5 Phase 36 (plan 36-04): first test coverage for workers/lib/inbound-email.ts.
//
// Why this file exists: 36-01 rewrote the Lakera hard-block branch from "silently
// drop" (a bare `return`) to "quarantine into Folders.SPAM", and its own SUMMARY
// reported that branch was "verified by code reading alone" — zero tests. This is
// the single biggest regression risk the phase introduces, in both directions:
//   - if fail-open broke, ALL inbound mail would stop during a Lakera outage;
//   - if the quarantine branch broke, flagged mail would be dropped or delivered.
//
// These are pure unit tests of the branching logic: no real DO runtime, no real R2,
// no real network. STUDENT_API_URL/SECRET are left undefined so the safety_events
// ctx.waitUntil POST branch is skipped — that keeps the fetch spy counting ONLY
// Lakera calls, which is what the trusted-sender assertion depends on.

import { describe, it, expect, vi, afterEach } from "vitest";
import { receiveEmail } from "../../lib/inbound-email";
import { Folders } from "../../../shared/folders";
import { mockCtx } from "../helpers";

const SAMPLE_MIME = [
	"From: sender@example.com",
	"To: employee@internjobs.ai",
	"Subject: Test",
	"Content-Type: text/plain",
	"",
	"This is a test email body.",
].join("\r\n");

/** Build the { raw, rawSize } shape Cloudflare Email Routing hands the Worker. */
function buildEvent(rawMime: string) {
	const bytes = new TextEncoder().encode(rawMime);
	return {
		raw: new Response(bytes).body as ReadableStream,
		rawSize: bytes.byteLength,
	};
}

/**
 * Fully-mocked Env. Attachment-free MIME above means BUCKET is never touched.
 * PARROT_FEATURE_FLAGS is undefined on purpose: the workspace-wide KV skip-list
 * must NOT short-circuit, so the real trust-check → screen path is exercised.
 */
function buildEnv(opts: { isTrusted?: boolean }) {
	// Variadic unknown[] signature so the recorded mock.calls stay indexable —
	// receiveEmail calls this via an `as unknown as {...}` RPC cast, so the spy
	// itself carries no argument types.
	const createEmail = vi.fn(async (..._args: unknown[]): Promise<unknown> => undefined);
	const isSenderTrusted = vi.fn(async (_sender: string) => opts.isTrusted ?? false);
	const env = {
		WORKSPACE: {
			idFromName: () => "workspace-id",
			get: () => ({
				getEmployeeByWorkspaceEmail: async () => ({
					id: "emp-1",
					clerk_user_id: "clerk-1",
					workspace_email: "employee@internjobs.ai",
					display_name: "Test Employee",
					status: "active",
				}),
			}),
		},
		EMPLOYEE_MAILBOX: {
			idFromName: (name: string) => name,
			get: () => ({ createEmail, isSenderTrusted }),
		},
		PARROT_FEATURE_FLAGS: undefined,
		BUCKET: { put: vi.fn() },
		LAKERA_GUARD_API_KEY: "test-key",
		STUDENT_API_URL: undefined,
		STUDENT_API_SECRET: undefined,
	};
	return { env, createEmail, isSenderTrusted };
}

type CreateEmailSpy = ReturnType<typeof buildEnv>["createEmail"];

/** Folder argument createEmail() was actually called with. */
function folderArg(createEmail: CreateEmailSpy): unknown {
	return createEmail.mock.calls[0]?.[0];
}

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe("receiveEmail — Lakera hard-block quarantine (Phase 36 core fix)", () => {
	it("quarantines flagged mail into Spam instead of dropping it", async () => {
		const fetchMock = vi.fn(
			async () =>
				new Response(JSON.stringify({ flagged: true }), {
					status: 200,
					headers: { "Content-Type": "application/json" },
				}),
		);
		vi.stubGlobal("fetch", fetchMock);
		const { env, createEmail } = buildEnv({ isTrusted: false });

		await receiveEmail(buildEvent(SAMPLE_MIME), env as any, mockCtx);

		// The regression this phase exists to prevent: pre-36-01 this branch
		// `return`ed before createEmail(), losing the mail unrecoverably.
		// Persisted at all == not dropped. Persisted to SPAM == quarantined.
		expect(createEmail).toHaveBeenCalledTimes(1);
		expect(folderArg(createEmail)).toBe(Folders.SPAM);
		// Lakera really was consulted (guards against a false pass where the
		// screen was skipped and SPAM came from somewhere else).
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("persists the full flagged message payload, not a stub", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(
				async () =>
					new Response(JSON.stringify({ flagged: true }), {
						status: 200,
						headers: { "Content-Type": "application/json" },
					}),
			),
		);
		const { env, createEmail } = buildEnv({ isTrusted: false });

		await receiveEmail(buildEvent(SAMPLE_MIME), env as any, mockCtx);

		const email = createEmail.mock.calls[0]?.[1] as Record<string, unknown>;
		expect(email.subject).toBe("Test");
		expect(email.sender).toBe("sender@example.com");
		expect(email.body).toContain("This is a test email body.");
		// Recoverable means the operator/employee can actually read it in Spam.
	});
});

describe("receiveEmail — fail-open (LAKERA-VERIFY-LIVE-03)", () => {
	it("delivers to Inbox when the Lakera call throws (network error)", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => {
				throw new Error("network down");
			}),
		);
		const { env, createEmail } = buildEnv({ isTrusted: false });

		await receiveEmail(buildEvent(SAMPLE_MIME), env as any, mockCtx);

		// A Lakera outage must never stop mail — and must never quarantine it either.
		expect(createEmail).toHaveBeenCalledTimes(1);
		expect(folderArg(createEmail)).toBe(Folders.INBOX);
	});

	it("delivers to Inbox when Lakera returns 5xx", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response("", { status: 500 })),
		);
		const { env, createEmail } = buildEnv({ isTrusted: false });

		await receiveEmail(buildEvent(SAMPLE_MIME), env as any, mockCtx);

		expect(createEmail).toHaveBeenCalledTimes(1);
		expect(folderArg(createEmail)).toBe(Folders.INBOX);
	});

	it("delivers to Inbox when Lakera passes the message", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(
				async () =>
					new Response(JSON.stringify({ flagged: false }), {
						status: 200,
						headers: { "Content-Type": "application/json" },
					}),
			),
		);
		const { env, createEmail } = buildEnv({ isTrusted: false });

		await receiveEmail(buildEvent(SAMPLE_MIME), env as any, mockCtx);

		expect(createEmail).toHaveBeenCalledTimes(1);
		expect(folderArg(createEmail)).toBe(Folders.INBOX);
	});
});

describe("receiveEmail — per-employee trusted sender (Phase 36)", () => {
	it("never calls Lakera for a trusted sender and delivers to Inbox", async () => {
		// A spy that would fail the test if the screen ran anyway.
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);
		const { env, createEmail, isSenderTrusted } = buildEnv({ isTrusted: true });

		await receiveEmail(buildEvent(SAMPLE_MIME), env as any, mockCtx);

		// Trust check must short-circuit BEFORE screenMessage() so a trusted
		// sender's mail never spends Lakera quota (36-01's stated intent).
		expect(isSenderTrusted).toHaveBeenCalledWith("sender@example.com");
		expect(fetchMock).not.toHaveBeenCalled();
		expect(createEmail).toHaveBeenCalledTimes(1);
		expect(folderArg(createEmail)).toBe(Folders.INBOX);
	});

	it("still screens when the sender is NOT trusted", async () => {
		const fetchMock = vi.fn(
			async () =>
				new Response(JSON.stringify({ flagged: true }), {
					status: 200,
					headers: { "Content-Type": "application/json" },
				}),
		);
		vi.stubGlobal("fetch", fetchMock);
		const { env, createEmail } = buildEnv({ isTrusted: false });

		await receiveEmail(buildEvent(SAMPLE_MIME), env as any, mockCtx);

		// Paired with the test above: proves the trust flag is what drives the
		// skip, not an unconditional short-circuit.
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(folderArg(createEmail)).toBe(Folders.SPAM);
	});
});
