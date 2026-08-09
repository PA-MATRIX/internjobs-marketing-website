// v1.5 Phase 36 Plan 03: 30-day spam auto-purge cron.
//
// Covers:
//   - runSpamPurge: first run sweeps every employee with a ~30d cutoff + records last-run
//   - runSpamPurge: throttle gate holds within 24h, releases after 24h
//   - runSpamPurge: throttle FAILS SAFE (sweeps) on every unusable-gate path —
//     KV absent, KV get() rejecting, unparseable value, future-dated value
//   - runSpamPurge: fail-soft — one employee's DO failure doesn't stop the sweep or throw
//   - runSpamPurge: fail-soft — listEmployees failure doesn't throw
//   - app.ts scheduled(): actually CALLS runSpamPurge (36-01 shipped purgeExpiredSpam as
//     dead code; the wiring is this plan's whole point, so it is asserted end-to-end here
//     rather than trusted to a grep)
//
// This repo has no harness for a real EmployeeMailboxDO/SQLite, so env is a hand-built
// fake in the style of chat-realtime.test.ts.

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { runSpamPurge } from "../../lib/spam-purge";
import worker from "../../app";
import type { Env } from "../../types";

beforeEach(() => {
	// The module logs structured JSON on every sweep; keep the suite output readable.
	vi.spyOn(console, "log").mockImplementation(() => {});
	vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => vi.restoreAllMocks());

const DAY_MS = 24 * 60 * 60 * 1000;

function buildEnv(overrides: {
	employees?: Array<{ clerk_user_id: string }>;
	purgeImpl?: (cutoff: string) => Promise<{ purged: number }>;
	listImpl?: () => Promise<Array<{ clerk_user_id: string }>>;
	kv?: Map<string, string>;
	kvGetImpl?: (key: string) => Promise<string | null>;
	noKv?: boolean;
} = {}) {
	const kv = overrides.kv ?? new Map<string, string>();
	const employees = overrides.employees ?? [
		{ clerk_user_id: "emp-1" },
		{ clerk_user_id: "emp-2" },
	];
	const purgeSpy = vi.fn(overrides.purgeImpl ?? (async () => ({ purged: 0 })));
	const listSpy = vi.fn(overrides.listImpl ?? (async () => employees));

	const flags = {
		get: vi.fn(
			overrides.kvGetImpl ?? ((key: string) => Promise.resolve(kv.get(key) ?? null)),
		),
		put: vi.fn((key: string, value: string) => {
			kv.set(key, value);
			return Promise.resolve();
		}),
	};

	const env = {
		...(overrides.noKv ? {} : { PARROT_FEATURE_FLAGS: flags }),
		WORKSPACE: {
			idFromName: () => "workspace-id",
			get: () => ({ listEmployees: listSpy }),
		},
		EMPLOYEE_MAILBOX: {
			idFromName: (name: string) => name,
			get: (id: string) => ({
				purgeExpiredSpam: (cutoff: string) => purgeSpy(cutoff),
			}),
		},
	} as unknown as Env;

	return { env, purgeSpy, listSpy, kv, flags };
}

describe("runSpamPurge", () => {
	it("first run: sweeps all employees and records the last-run timestamp", async () => {
		const { env, purgeSpy, kv } = buildEnv();

		await runSpamPurge(env);

		expect(purgeSpy).toHaveBeenCalledTimes(2);
		expect(kv.get("spam_purge_last_run")).toBeTruthy();
	});

	it("honours the locked 30-day retention window in the cutoff it passes", async () => {
		const { env, purgeSpy } = buildEnv();

		await runSpamPurge(env);

		const cutoffArg = purgeSpy.mock.calls[0][0] as string;
		const daysAgo = (Date.now() - Date.parse(cutoffArg)) / DAY_MS;
		expect(daysAgo).toBeGreaterThan(29);
		expect(daysAgo).toBeLessThan(31);
		// Every employee must be swept against the SAME cutoff.
		expect(purgeSpy.mock.calls[1][0]).toBe(cutoffArg);
	});

	it("throttle gate: a second run within 24h does not re-sweep", async () => {
		const kv = new Map([["spam_purge_last_run", new Date().toISOString()]]);
		const { env, purgeSpy } = buildEnv({ kv });

		await runSpamPurge(env);

		expect(purgeSpy).not.toHaveBeenCalled();
	});

	it("throttle gate: releases once the last run is older than 24h", async () => {
		const kv = new Map([
			["spam_purge_last_run", new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString()],
		]);
		const { env, purgeSpy, kv: store } = buildEnv({ kv });

		await runSpamPurge(env);

		expect(purgeSpy).toHaveBeenCalledTimes(2);
		// Last-run stamp is refreshed, re-arming the gate.
		const stamp = store.get("spam_purge_last_run") as string;
		expect(Date.now() - Date.parse(stamp)).toBeLessThan(DAY_MS);
	});

	// The throttle must never be the reason spam lives forever. Each of these is a way
	// the gate can fail to produce a usable answer; all must fall through to a sweep.
	describe("throttle fails safe (purges rather than never firing)", () => {
		it("sweeps when the KV binding is absent entirely", async () => {
			const { env, purgeSpy } = buildEnv({ noKv: true });

			await runSpamPurge(env);

			expect(purgeSpy).toHaveBeenCalledTimes(2);
		});

		it("sweeps when the KV read rejects", async () => {
			const { env, purgeSpy } = buildEnv({
				kvGetImpl: () => Promise.reject(new Error("KV unavailable")),
			});

			await expect(runSpamPurge(env)).resolves.toBeUndefined();
			expect(purgeSpy).toHaveBeenCalledTimes(2);
		});

		it("sweeps when the stored timestamp is unparseable garbage", async () => {
			const kv = new Map([["spam_purge_last_run", "not-a-date"]]);
			const { env, purgeSpy } = buildEnv({ kv });

			await runSpamPurge(env);

			expect(purgeSpy).toHaveBeenCalledTimes(2);
		});

		it("sweeps when the stored timestamp is in the future (clock skew must not wedge the gate shut forever)", async () => {
			const kv = new Map([
				["spam_purge_last_run", new Date(Date.now() + 90 * DAY_MS).toISOString()],
			]);
			const { env, purgeSpy } = buildEnv({ kv });

			await runSpamPurge(env);

			expect(purgeSpy).toHaveBeenCalledTimes(2);
		});

		it("does not throw when the last-run write fails, so the next tick just sweeps again", async () => {
			const { env, flags, purgeSpy } = buildEnv();
			flags.put.mockRejectedValueOnce(new Error("KV write failed"));

			await expect(runSpamPurge(env)).resolves.toBeUndefined();
			expect(purgeSpy).toHaveBeenCalledTimes(2);
		});
	});

	describe("fail-soft", () => {
		it("one employee's rejection does not stop the sweep or throw", async () => {
			let calls = 0;
			const { env, purgeSpy } = buildEnv({
				purgeImpl: async () => {
					calls += 1;
					if (calls === 1) throw new Error("DO unavailable");
					return { purged: 3 };
				},
			});

			await expect(runSpamPurge(env)).resolves.toBeUndefined();
			expect(purgeSpy).toHaveBeenCalledTimes(2);
		});

		it("a listEmployees failure is swallowed, not thrown", async () => {
			const { env, purgeSpy } = buildEnv({
				listImpl: async () => {
					throw new Error("WorkspaceDO unavailable");
				},
			});

			await expect(runSpamPurge(env)).resolves.toBeUndefined();
			expect(purgeSpy).not.toHaveBeenCalled();
		});

		it("an empty workspace is a no-op, not a crash", async () => {
			const { env, purgeSpy, kv } = buildEnv({ employees: [] });

			await expect(runSpamPurge(env)).resolves.toBeUndefined();
			expect(purgeSpy).not.toHaveBeenCalled();
			expect(kv.get("spam_purge_last_run")).toBeTruthy();
		});
	});
});

// Regression guard for this plan's core purpose: 36-01 shipped purgeExpiredSpam() as
// dead code. If someone ever drops the ctx.waitUntil(runSpamPurge(env)) line from
// scheduled(), the retention policy silently stops running with every other test green.
describe("app.ts scheduled() cron wiring", () => {
	it("reaches purgeExpiredSpam through the real scheduled() handler", async () => {
		const { env, purgeSpy } = buildEnv();
		const pending: Promise<unknown>[] = [];
		const ctx = {
			waitUntil: (p: Promise<unknown>) => pending.push(p),
			passThroughOnException: () => {},
		} as unknown as ExecutionContext;

		await worker.scheduled({} as ScheduledEvent, env, ctx);
		await Promise.all(pending);

		// runAutoClear also rides this handler; it self-skips here (no GRAPH_API_URL).
		expect(purgeSpy).toHaveBeenCalledTimes(2);
	});
});
