---
phase: 36-lakera-failopen-quarantine
plan: 03
type: execute
wave: 2
depends_on: ["36-01"]
files_modified:
  - apps/parrot/workers/lib/spam-purge.ts
  - apps/parrot/workers/app.ts
  - apps/parrot/workers/tests/lib/spam-purge.test.ts
autonomous: true
skills:
  - projecta.testing-vitest-playwright
skills_mode: normal
coverage_diagram_not_applicable: true
coverage_diagram_skip_reason: "30-day spam auto-purge has no assigned REQUIREMENTS.md ID — it implements the 2026-07-09 retention decision directly. Coverage is tracked via this plan's must_haves goal-backward truths instead (see below)."

verification:
  surface: backend_only
  frontend_impact: false
  required_steps:
    - unit_tests

must_haves:
  truths:
    - "Spam mail older than 30 days is deleted automatically with no operator/manual action required"
    - "The purge runs on the EXISTING Worker cron trigger (*/5 * * * *) — no new wrangler.jsonc trigger is added"
    - "A full purge sweep runs at most once per ~24h, not on every 5-minute cron tick, so pilot-scale (~50 employee) DO fan-out isn't hammered 288x/day"
    - "A single employee's purge failure does not stop the sweep for other employees (fail-soft, matching the existing auto-clear cron's contract)"
  artifacts:
    - path: apps/parrot/workers/lib/spam-purge.ts
      provides: "runSpamPurge(env) — 24h throttle gate + per-employee fan-out calling EmployeeMailboxDO.purgeExpiredSpam(cutoffIso)"
    - path: apps/parrot/workers/app.ts
      provides: "scheduled() handler additionally calls ctx.waitUntil(runSpamPurge(env))"
    - path: apps/parrot/workers/tests/lib/spam-purge.test.ts
      provides: "vitest coverage of the throttle gate + fan-out + fail-soft behavior with mocked WorkspaceDO/EmployeeMailboxDO/KV"
  key_links:
    - from: apps/parrot/workers/app.ts (scheduled)
      to: apps/parrot/workers/lib/spam-purge.ts (runSpamPurge)
      via: "ctx.waitUntil(runSpamPurge(env)) alongside the existing ctx.waitUntil(runAutoClear(env))"
      pattern: "runSpamPurge\\(env\\)"
    - from: apps/parrot/workers/lib/spam-purge.ts
      to: apps/parrot/workers/durableObject/index.ts (purgeExpiredSpam)
      via: "per-employee EMPLOYEE_MAILBOX stub RPC, one call per row from WorkspaceDO.listEmployees()"
      pattern: "purgeExpiredSpam\\("
---

<objective>
Implement the locked 30-day spam retention policy (2026-07-09 decision) as a cron-driven
purge, hooked into the SAME Worker `scheduled()` handler that already runs the Phase 19
auto-clear cron — no new `wrangler.jsonc` trigger.

Purpose: quarantined spam mail must not accumulate forever; auto-purge after 30 days keeps
storage bounded without requiring the operator to remember to clean it up.
Output: `workers/lib/spam-purge.ts` (new orchestration module) wired into the existing
`*/5 * * * *` cron, plus test coverage.
</objective>

<execution_context>
@~/.claude/rrr/workflows/execute-plan.md
@~/.claude/rrr/templates/summary.md
</execution_context>

<context>
@.planning/milestones/v1.5/phases/36-lakera-failopen-quarantine/36-RESEARCH.md
@.planning/milestones/v1.5/phases/36-lakera-failopen-quarantine/36-01-quarantine-backend-SUMMARY.md
@apps/parrot/workers/lib/auto-clear.ts
@apps/parrot/workers/app.ts
@apps/parrot/workers/durableObject/workspace.ts
@apps/parrot/workers/tests/helpers.ts
</context>

<tasks>

<task type="auto">
  <name>Task 1: runSpamPurge orchestration module</name>
  <files>apps/parrot/workers/lib/spam-purge.ts</files>
  <action>
Create `apps/parrot/workers/lib/spam-purge.ts`. Model the header comment, fail-soft contract,
and structured-logging style directly on `apps/parrot/workers/lib/auto-clear.ts` (never
throws; per-item try/catch; JSON-structured `console.log`/`console.warn`).

```ts
// v1.5 Phase 36: 30-day spam auto-purge (locked decision 2026-07-09).
//
// Scheduler: reuses the EXISTING CF Worker Cron Trigger (*/5 * * * *) declared in
// wrangler.jsonc for the Phase 19 auto-clear cron — no new trigger is added. Called
// from app.ts's scheduled() handler via ctx.waitUntil(), alongside runAutoClear(env).
//
// Throttle: the cron fires every 5 minutes, but a full sweep only needs to run about
// once a day. A KV-backed last-run timestamp (reusing the existing PARROT_FEATURE_FLAGS
// binding, key "spam_purge_last_run" -- distinct from the "safety_skip_senders" key it
// already holds) gates the sweep so pilot-scale (~50 employee) fan-out isn't repeated
// 288x/day. If the KV binding is ever absent, the sweep runs on every tick rather than
// never purging -- never-purge is the worse failure mode.
//
// Fail-soft contract: NEVER throws. Mirrors auto-clear.ts's per-item try/catch -- one
// employee's DO failing must not stop the sweep for the rest.

import type { Env } from "../types";

const RETENTION_DAYS = 30;
const PURGE_INTERVAL_MS = 24 * 60 * 60 * 1000; // ~once/day
const LAST_RUN_KV_KEY = "spam_purge_last_run";

interface EmployeeRow {
  clerk_user_id: string;
}

export async function runSpamPurge(env: Env): Promise<void> {
  // Throttle gate.
  if (env.PARROT_FEATURE_FLAGS) {
    const lastRun = await env.PARROT_FEATURE_FLAGS.get(LAST_RUN_KV_KEY).catch(() => null);
    if (lastRun) {
      const elapsed = Date.now() - Date.parse(lastRun);
      if (Number.isFinite(elapsed) && elapsed < PURGE_INTERVAL_MS) {
        return; // Ran recently -- skip this tick.
      }
    }
  }

  if (!env.WORKSPACE || !env.EMPLOYEE_MAILBOX) {
    console.warn(
      JSON.stringify({ level: "warn", event: "spam_purge_skip", reason: "WORKSPACE or EMPLOYEE_MAILBOX binding missing" }),
    );
    return;
  }

  let employees: EmployeeRow[];
  try {
    const workspaceStub = env.WORKSPACE.get(env.WORKSPACE.idFromName("workspace"));
    employees = (await (
      workspaceStub as unknown as { listEmployees(): Promise<EmployeeRow[]> }
    ).listEmployees()) as EmployeeRow[];
  } catch (err) {
    console.warn(
      JSON.stringify({
        level: "warn",
        event: "spam_purge_list_employees_failed",
        error: (err as Error | null)?.message ?? String(err),
      }),
    );
    return;
  }

  const cutoffIso = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();

  for (const employee of employees) {
    try {
      const mailboxStub = env.EMPLOYEE_MAILBOX.get(
        env.EMPLOYEE_MAILBOX.idFromName(employee.clerk_user_id),
      );
      const result = await (
        mailboxStub as unknown as {
          purgeExpiredSpam(cutoffIso: string): Promise<{ purged: number }>;
        }
      ).purgeExpiredSpam(cutoffIso);
      if (result.purged > 0) {
        console.log(
          JSON.stringify({
            level: "info",
            event: "spam_purge_employee",
            employee_id: employee.clerk_user_id,
            purged: result.purged,
          }),
        );
      }
    } catch (err) {
      // Fail-soft per-employee: log and continue, matching auto-clear.ts's contract.
      console.warn(
        JSON.stringify({
          level: "warn",
          event: "spam_purge_employee_failed",
          employee_id: employee.clerk_user_id,
          error: (err as Error | null)?.message ?? String(err),
        }),
      );
    }
  }

  if (env.PARROT_FEATURE_FLAGS) {
    await env.PARROT_FEATURE_FLAGS.put(LAST_RUN_KV_KEY, new Date().toISOString()).catch(
      (err) => {
        console.warn(
          JSON.stringify({
            level: "warn",
            event: "spam_purge_last_run_write_failed",
            error: (err as Error | null)?.message ?? String(err),
          }),
        );
      },
    );
  }
}
```
  </action>
  <verify>`cd apps/parrot && npm run typecheck` passes.</verify>
  <done>`runSpamPurge` compiles, is exported, and never throws (all failure paths are caught internally).</done>
</task>

<task type="auto">
  <name>Task 2: Wire into the existing scheduled() cron handler</name>
  <files>apps/parrot/workers/app.ts</files>
  <action>
1. Add `import { runSpamPurge } from "./lib/spam-purge";` next to the existing
   `import { runAutoClear } from "./lib/auto-clear";` (~line 321).
2. Inside the `scheduled()` handler (~line 359-365), add a second `ctx.waitUntil(...)` call
   next to the existing one:
   ```ts
   async scheduled(
     _event: ScheduledEvent,
     env: Env,
     ctx: ExecutionContext,
   ): Promise<void> {
     ctx.waitUntil(runAutoClear(env));
     // v1.5 Phase 36: 30-day spam auto-purge, reusing this same */5 * * * * trigger
     // (2026-07-09 decision: no new wrangler.jsonc cron trigger). Internally throttled
     // to ~once/day via KV -- see spam-purge.ts.
     ctx.waitUntil(runSpamPurge(env));
   },
   ```
   Do not modify `wrangler.jsonc` — the existing `triggers.crons: ["*/5 * * * *"]` is reused
   as-is, confirming the locked decision to not invent a new trigger.
  </action>
  <verify>
`cd apps/parrot && npm run typecheck` passes.
`cd apps/parrot && npm test` passes.
`grep -n "triggers" apps/parrot/wrangler.jsonc` still shows only the one pre-existing cron
entry (no new trigger added).
  </verify>
  <done>The `scheduled()` export fires both `runAutoClear` and `runSpamPurge` on every cron tick.</done>
</task>

<task type="auto">
  <name>Task 3: vitest coverage for the throttle gate + fan-out + fail-soft behavior</name>
  <files>apps/parrot/workers/tests/lib/spam-purge.test.ts</files>
  <action>
Create `apps/parrot/workers/tests/lib/spam-purge.test.ts`. This repo has NO harness for
instantiating a real `EmployeeMailboxDO`/SQLite (route smoke tests and `auto-clear.ts`'s own
usage both avoid it) — do not attempt to build one. Build a fake `env` object with plain
mocked methods instead, matching the style of `chat-realtime.test.ts` / other
`workers/tests/lib/*.test.ts` files (check one for the exact `vi.fn()` idiom used in this repo
before writing).

Structure:
```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { runSpamPurge } from "../../lib/spam-purge";

afterEach(() => vi.restoreAllMocks());

function buildEnv(overrides: {
  employees?: Array<{ clerk_user_id: string }>;
  purgeImpl?: (cutoff: string) => Promise<{ purged: number }>;
  kv?: Map<string, string>;
}) {
  const kv = overrides.kv ?? new Map<string, string>();
  const employees = overrides.employees ?? [{ clerk_user_id: "emp-1" }, { clerk_user_id: "emp-2" }];
  const purgeSpy = vi.fn(overrides.purgeImpl ?? (async () => ({ purged: 0 })));
  const env = {
    PARROT_FEATURE_FLAGS: {
      get: (key: string) => Promise.resolve(kv.get(key) ?? null),
      put: (key: string, value: string) => {
        kv.set(key, value);
        return Promise.resolve();
      },
    },
    WORKSPACE: {
      idFromName: () => "workspace-id",
      get: () => ({ listEmployees: async () => employees }),
    },
    EMPLOYEE_MAILBOX: {
      idFromName: (name: string) => name,
      get: (id: string) => ({ purgeExpiredSpam: (cutoff: string) => purgeSpy(cutoff) }),
    },
  };
  return { env, purgeSpy, kv };
}

describe("runSpamPurge", () => {
  it("first run: sweeps all employees and records the last-run timestamp", async () => {
    const { env, purgeSpy, kv } = buildEnv({});
    await runSpamPurge(env as any);
    expect(purgeSpy).toHaveBeenCalledTimes(2);
    // Cutoff should be ~30 days in the past.
    const cutoffArg = purgeSpy.mock.calls[0][0] as string;
    const daysAgo = (Date.now() - Date.parse(cutoffArg)) / (24 * 60 * 60 * 1000);
    expect(daysAgo).toBeGreaterThan(29);
    expect(daysAgo).toBeLessThan(31);
    expect(kv.get("spam_purge_last_run")).toBeTruthy();
  });

  it("throttle gate: a second run within 24h does not re-sweep", async () => {
    const kv = new Map([["spam_purge_last_run", new Date().toISOString()]]);
    const { env, purgeSpy } = buildEnv({ kv });
    await runSpamPurge(env as any);
    expect(purgeSpy).not.toHaveBeenCalled();
  });

  it("fail-soft: one employee's rejection does not stop the sweep or throw", async () => {
    let calls = 0;
    const { env, purgeSpy } = buildEnv({
      purgeImpl: async () => {
        calls += 1;
        if (calls === 1) throw new Error("DO unavailable");
        return { purged: 3 };
      },
    });
    await expect(runSpamPurge(env as any)).resolves.toBeUndefined();
    expect(purgeSpy).toHaveBeenCalledTimes(2);
  });
});
```

Adjust the exact env-stub shape only if `runSpamPurge`'s real signature (from Task 1) diverges
in a way that breaks these mocks (e.g. binding names) — keep the three behaviors under test
identical: first-run sweeps + records, second-run-within-24h skips, one-failure-doesn't-stop-
the-rest.
  </action>
  <verify>`cd apps/parrot && npm test` passes; all three cases green.</verify>
  <done>
`workers/tests/lib/spam-purge.test.ts` exists and covers: first-run-sweeps-and-records,
throttle-gate-holds-within-24h, and fail-soft-continues-past-one-employee-failure.
  </done>
</task>

</tasks>

<verification>
Run in `apps/parrot/`:
```
npm run typecheck
npm test
```
Confirm no `wrangler.jsonc` diff (the cron trigger is reused, not duplicated).
</verification>

<success_criteria>
1. `runSpamPurge(env)` exists, never throws, and purges spam mail older than 30 days per
   employee via `EmployeeMailboxDO.purgeExpiredSpam`.
2. The sweep is throttled to ~once/24h via a KV last-run timestamp.
3. `scheduled()` in `app.ts` invokes `runSpamPurge` alongside the existing `runAutoClear`, on
   the same pre-existing cron trigger.
4. `npm run typecheck` and `npm test` pass in `apps/parrot/`.
</success_criteria>

<output>
After completion, create `.planning/milestones/v1.5/phases/36-lakera-failopen-quarantine/36-03-spam-auto-purge-cron-SUMMARY.md`
</output>
