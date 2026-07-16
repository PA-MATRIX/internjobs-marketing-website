---
phase: 36-lakera-failopen-quarantine
plan: 04
type: execute
wave: 2
depends_on: ["36-01"]
files_modified:
  - apps/parrot/workers/tests/lib/safety.test.ts
  - apps/parrot/workers/tests/lib/inbound-email.test.ts
  - apps/parrot/workers/tests/routes/inbox-actions.test.ts
autonomous: true
skills:
  - projecta.testing-vitest-playwright
skills_mode: normal

verification:
  surface: backend_only
  frontend_impact: false
  required_steps:
    - unit_tests

must_haves:
  truths:
    - "A simulated Lakera 5xx, network error, timeout, or missing API key still delivers the message (fail-open) — asserted by a Worker-side (vitest) test, closing the gap the research flagged (safety.ts previously had zero test coverage)"
    - "A simulated flagged:true response still hard-blocks — quarantined into Spam, not delivered to Inbox — asserted against the ACTUAL inbound-email.ts branch this phase changed (previously zero coverage, the single biggest regression risk this phase introduces)"
    - "A per-employee trusted sender's mail never reaches the Lakera call at all"
    - "The new trust-sender route and the extended folder-counts route are mounted (route smoke, matching the existing not-404/not-500 pattern)"
  artifacts:
    - path: apps/parrot/workers/tests/lib/safety.test.ts
      provides: "vitest suite for screenMessage(): missing key / mocked 5xx / mocked network-throw / mocked AbortError timeout / flagged-true / flagged-false"
    - path: apps/parrot/workers/tests/lib/inbound-email.test.ts
      provides: "vitest suite for receiveEmail(): hard-block -> Folders.SPAM, fail-open -> Folders.INBOX, trusted-sender -> Lakera never called"
    - path: apps/parrot/workers/tests/routes/inbox-actions.test.ts
      provides: "extended smoke coverage for POST .../trust-sender and GET folder-counts"
  key_links: []
---

<objective>
Close the two test-coverage gaps 36-RESEARCH.md flagged as real risks (not polish):
`apps/parrot/workers/lib/safety.ts` had zero tests before this phase, and
`apps/parrot/workers/lib/inbound-email.ts`'s hard-block branch — the exact branch Plan 36-01
rewrote from "silently drop" to "quarantine into Spam" — also had zero tests. This plan is
also the test-level satisfaction of LAKERA-VERIFY-LIVE-03 (fail-open verification), which is
explicitly NOT a destructive prod test (the user previously declined rotating the real prod
Lakera key) — mocked fetch at the vitest layer is the accepted approach here, mirroring the
pattern already used in `apps/app/src/safety/screen.test.mjs`.

Purpose: prove fail-open still works and hard-block still fires, at the unit level, without
touching production secrets or traffic.
Output: two new vitest files + a small extension to the existing route smoke test.
</objective>

<execution_context>
@~/.claude/rrr/workflows/execute-plan.md
@~/.claude/rrr/templates/summary.md
</execution_context>

<context>
@.planning/milestones/v1.5/phases/36-lakera-failopen-quarantine/36-RESEARCH.md
@.planning/milestones/v1.5/phases/36-lakera-failopen-quarantine/36-01-quarantine-backend-SUMMARY.md
@apps/parrot/workers/lib/safety.ts
@apps/parrot/workers/lib/inbound-email.ts
@apps/app/src/safety/screen.test.mjs
@apps/parrot/workers/tests/routes/ops-safety.test.ts
@apps/parrot/workers/tests/routes/inbox-actions.test.ts
@apps/parrot/workers/tests/helpers.ts
</context>

<tasks>

<task type="auto">
  <name>Task 1: safety.ts fail-open + hard-block test suite (vitest, mocked fetch)</name>
  <files>apps/parrot/workers/tests/lib/safety.test.ts</files>
  <action>
Create `apps/parrot/workers/tests/lib/safety.test.ts`. Model the SCENARIO coverage on the
existing `apps/app/src/safety/screen.test.mjs` (VERIFY-03a/b/c), but use vitest's
`vi.stubGlobal("fetch", vi.fn(...))` — this repo's research explicitly notes this gives
cleaner coverage than the Node script's documented "endpoint captured at import time"
limitation. Import `screenMessage` from `../../lib/safety`. Build a minimal `Env` stub inline
per test (`{ LAKERA_GUARD_API_KEY: "test-key" } as Env`, or omit the key for the missing-key
case). Use `afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); })`.

Required cases (LAKERA-VERIFY-LIVE-03 fail-open + hard-block-still-fires):
1. **Missing API key** → `screenMessage(text, {} as Env)` resolves
   `{ action: "passed_lakera_unavailable", flagged: false }`; assert `fetch` was NEVER called
   (`vi.stubGlobal("fetch", vi.fn())` then `expect(fetchMock).not.toHaveBeenCalled()`).
2. **Mocked 5xx response** — `vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 500 })))`
   → fail-open (`action === "passed_lakera_unavailable"`, `flagged === false`).
3. **Mocked network throw** — `vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network down"); }))`
   → fail-open, AND assert `screenMessage` itself does not throw (wrap in `await expect(...).resolves.not.toThrow()`
   or equivalent try/catch with an explicit `threw` flag).
4. **Mocked timeout/AbortError** — `vi.stubGlobal("fetch", vi.fn(async () => { throw Object.assign(new Error("aborted"), { name: "AbortError" }); }))`
   → fail-open (exercises the `isTimeout` branch in `safety.ts`'s catch block without a real
   1-second wait).
5. **Mocked `{ flagged: true }` 200 response** → `{ flagged: true, action: "flagged", score: 1,
   reason: "lakera_flagged" }` — this is the exact classification the Plan 36-01 quarantine
   branch depends on (`isHardBlock = screenResult.flagged === true`).
6. **Mocked `{ flagged: false }` 200 response** → `{ flagged: false, action: "passed", score: 0,
   reason: null }`.
  </action>
  <verify>`cd apps/parrot && npm test` passes; all 6 cases green.</verify>
  <done>
`workers/tests/lib/safety.test.ts` exists and passes, closing the zero-coverage gap on
`safety.ts` and providing the test-level assertion for LAKERA-VERIFY-LIVE-03.
  </done>
</task>

<task type="auto">
  <name>Task 2: inbound-email.ts hard-block/quarantine + trust-sender branch test suite</name>
  <files>apps/parrot/workers/tests/lib/inbound-email.test.ts</files>
  <action>
Create `apps/parrot/workers/tests/lib/inbound-email.test.ts`. Import `receiveEmail` from
`../../lib/inbound-email` and `Folders` from `../../../shared/folders`. This test exercises
the exact branch Plan 36-01 changed — construct a raw MIME `event` and a fully-mocked `env`
(no real DO runtime, no real R2, no real fetch — pure unit test of the branching logic).

Building the fixture event:
```ts
function buildEvent(rawMime: string) {
  const bytes = new TextEncoder().encode(rawMime);
  return {
    raw: new Response(bytes).body as ReadableStream,
    rawSize: bytes.byteLength,
  };
}

const SAMPLE_MIME = [
  "From: sender@example.com",
  "To: employee@internjobs.ai",
  "Subject: Test",
  "Content-Type: text/plain",
  "",
  "This is a test email body.",
].join("\r\n");
```

Building the fixture env — keep attachment-free (no `parsed.attachments`) so the R2 `BUCKET`
stub can be a no-op:
```ts
function buildEnv(opts: {
  isTrusted?: boolean;
  createEmailSpy?: ReturnType<typeof vi.fn>;
}) {
  const createEmail = opts.createEmailSpy ?? vi.fn(async () => undefined);
  const isSenderTrusted = vi.fn(async () => opts.isTrusted ?? false);
  return {
    env: {
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
      PARROT_FEATURE_FLAGS: undefined, // no workspace-wide skip list — exercise the real path
      BUCKET: { put: vi.fn() },
      LAKERA_GUARD_API_KEY: "test-key",
      STUDENT_API_URL: undefined, // skip the safety_events POST branch, keep the test focused
      STUDENT_API_SECRET: undefined,
    },
    createEmail,
    isSenderTrusted,
  };
}
```

Required cases:
1. **Hard-block quarantines to Spam** — `vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ flagged: true }), { status: 200 })))`,
   `isTrusted: false`. Call `await receiveEmail(buildEvent(SAMPLE_MIME), env as any, mockCtx)`.
   Assert `createEmail` was called once with first argument `Folders.SPAM`.
2. **Fail-open delivers to Inbox** — `vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network down"); }))`.
   Assert `createEmail` was called with first argument `Folders.INBOX`.
3. **Trusted sender skips Lakera entirely** — `isTrusted: true`, `vi.stubGlobal("fetch", vi.fn())`
   (a spy that would fail the test if called). Assert `fetch` was NEVER called AND `createEmail`
   was called with `Folders.INBOX`.

Use the same `mockCtx` stub already defined in `workers/tests/helpers.ts` (`waitUntil: () => {}`).
Wrap each `vi.stubGlobal("fetch", ...)` with `afterEach(() => vi.unstubAllGlobals())`.
  </action>
  <verify>`cd apps/parrot && npm test` passes; all 3 cases green.</verify>
  <done>
`workers/tests/lib/inbound-email.test.ts` exists and passes, proving the exact branch this
phase changed (silent-drop → quarantine-into-Spam) behaves correctly, and that the new
per-employee trust check short-circuits Lakera before it's called.
  </done>
</task>

<task type="auto">
  <name>Task 3: extend inbox-actions.test.ts route smoke coverage</name>
  <files>apps/parrot/workers/tests/routes/inbox-actions.test.ts</files>
  <action>
Add two `it()` blocks to the existing `describe("inbox-actions route smoke", ...)` block,
matching its exact `not-404/not-500` assertion style and comment conventions (per the AUTH
NOTE documented in `helpers.ts` — the inner app's auth gate returns 401, which is expected
and NOT a failure here):

```ts
it("POST /api/inbox/messages/:id/trust-sender with dev headers returns not-404", async () => {
  const req = new Request(
    "https://parrot.example.com/api/inbox/messages/test-id/trust-sender",
    { method: "POST", headers: devHeaders },
  );
  const res = await app.fetch(req, minimalEnv as any, mockCtx);
  expect(res.status).not.toBe(404);
  expect(res.status).not.toBe(500);
});

it("GET /api/inbox/folder-counts with dev headers returns not-404 and not-500", async () => {
  const req = new Request("https://parrot.example.com/api/inbox/folder-counts", {
    headers: devHeaders,
  });
  const res = await app.fetch(req, minimalEnv as any, mockCtx);
  expect(res.status).not.toBe(404);
  expect(res.status).not.toBe(500);
});
```

Before adding the second block, grep the file (and `workers/tests/routes/` generally) for an
existing `folder-counts` smoke test to avoid a duplicate:
`grep -rn "folder-counts" apps/parrot/workers/tests/`. If one already exists elsewhere, skip
adding it here and only add the trust-sender case.
  </action>
  <verify>`cd apps/parrot && npm test` passes; both new assertions (or the trust-sender one, if folder-counts is already covered) pass.</verify>
  <done>The new route(s) added in Plan 36-01 have smoke coverage; existing assertions in the file are untouched.</done>
</task>

</tasks>

<verification>
Run in `apps/parrot/`:
```
npm run typecheck
npm test
```
All existing tests plus the new ones must pass. This plan adds no production code — pure test
authorship — so there is no build/runtime behavior change to verify beyond the test suite
itself passing green.
</verification>

<success_criteria>
1. `safety.ts` has vitest coverage for missing-key, 5xx, network-error, timeout, flagged-true,
   and flagged-false — satisfying LAKERA-VERIFY-LIVE-03 at test level.
2. `inbound-email.ts`'s hard-block branch (rewritten in Plan 36-01) has direct unit coverage
   proving quarantine-to-Spam, fail-open-to-Inbox, and trusted-sender-skips-Lakera.
3. The new trust-sender route and extended folder-counts route have smoke coverage.
4. `npm run typecheck` and `npm test` pass in `apps/parrot/`.
</success_criteria>

<output>
After completion, create `.planning/milestones/v1.5/phases/36-lakera-failopen-quarantine/36-04-safety-test-coverage-SUMMARY.md`
</output>
