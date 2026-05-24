# Testing Patterns

**Analysis Date:** 2026-05-24

## Architectural Context Loaded

- No `.planning/NORTH-STAR.md` or locked memory files that constrain testing approach were found.
- No AGENTS.md or CLAUDE.md at repo root.

---

## Test Framework

**Runner:**
- Node.js built-in test runner (`node:test`) — no Jest, Vitest, or Mocha
- No test framework config file (no `jest.config.*`, no `vitest.config.*`)
- Available in Node >= 22, which is the required engine across all Node apps

**Assertion Library:**
- `node:assert/strict` — strict equality mode by default

**Run Commands:**
```bash
# Run auth tests (apps/app)
npm --workspace @internjobs/app run test:auth
# Equivalent: node --test apps/app/src/auth.test.mjs

# Run individual test files directly
node --test apps/app/src/auth.test.mjs
node --test apps/app/src/workflows/reply-to.test.mjs
node --test apps/app/src/storage/r2.test.mjs
node --test apps/app/src/safety/screen.test.mjs

# Integration smoke (requires live server)
npm --workspace @internjobs/app run smoke:ops
npm --workspace @internjobs/app run smoke:graph
node infra/graph-api/smoke.mjs
```

## Test File Organization

**Location:**
- Co-located with source files in the same directory
- Named `<module>.test.mjs` immediately next to `<module>.mjs`

**Naming:**
- Pattern: `<source-file-stem>.test.mjs`
- Examples:
  - `apps/app/src/auth.mjs` → `apps/app/src/auth.test.mjs`
  - `apps/app/src/workflows/reply-to.mjs` → `apps/app/src/workflows/reply-to.test.mjs`
  - `apps/app/src/storage/r2.mjs` → `apps/app/src/storage/r2.test.mjs`
  - `apps/app/src/safety/screen.mjs` → `apps/app/src/safety/screen.test.mjs`

**Structure:**
```
apps/app/src/
├── auth.mjs
├── auth.test.mjs          ← co-located
├── workflows/
│   ├── reply-to.mjs
│   └── reply-to.test.mjs  ← co-located
├── storage/
│   ├── r2.mjs
│   └── r2.test.mjs        ← co-located
└── safety/
    ├── screen.mjs
    └── screen.test.mjs    ← co-located
```

## Test Structure

**Suite Organization:**
```js
// File-level comment block with version, phase ref, and what's covered
// apps/app/src/storage/r2.test.mjs
//
// v1.2 STORAGE-01 — smoke unit tests for the R2 scaffold.
//
// What's covered:
//   1. getR2Client() returns null when ANY of the four envs is missing.
//   2. getR2Client() returns a non-null client when all four envs are set.

import { test } from "node:test";
import assert from "node:assert/strict";
import { functionUnderTest, __resetSingletonForTest } from "./module.mjs";

// Shared test fixtures defined as module-level constants
const STUB_ENV = {
  R2_ACCOUNT_ID: "stub-acct",
  R2_ACCESS_KEY_ID: "stub-key-id",
  // ...
};

test("descriptive label: scenario → expected outcome", () => {
  __resetSingletonForTest();
  const result = functionUnderTest(input);
  assert.equal(result, expected, "optional failure message");
});
```

**Patterns:**
- Each test is a standalone `test()` call — no `describe` nesting
- Test name format: `"functionName: scenario → expected"` (e.g., `"getR2Client returns null when no envs set"`, `"requireOperatorAuth: dev session with userType=student → 403"`)
- Section comments used to group related tests: `// ─── Key helper tests ─────────────────────`
- Singleton reset before each test that uses a singleton: `__resetSingletonForTest()` called at start of each test body
- Async tests use `async () => {}` arrow function

## Mocking

**Framework:** No external mocking library. Hand-rolled mock objects.

**Patterns:**

```js
// Mock response object — captures writes for assertion
function mockRes() {
  const captured = { status: null, body: null, headers: {} };
  return {
    captured,
    writeHead(status, headers) {
      captured.status = status;
      Object.assign(captured.headers, headers);
    },
    setHeader(name, value) { captured.headers[name] = value; },
    end(body) { captured.body = body; },
  };
}

// Mock request object — sets headers/cookies manually
function mockReqWithDevCookie(claims) {
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const signed = signValue(payload, config.appSessionSecret);
  return {
    headers: {
      cookie: `internjobs_dev_session=${encodeURIComponent(signed)}`,
    },
  };
}

// Mock Clerk client — injects userType for Backend API path
function mockClerkClient(userType) {
  return {
    users: {
      async getUser(_userId) {
        return { id: "user_xxx", public_metadata: { userType } };
      },
    },
  };
}

// Spy pattern — records whether a method was invoked
let getUserCalled = false;
const spyClient = {
  users: {
    async getUser(_userId) {
      getUserCalled = true;
      return { public_metadata: { userType: "student" } };
    },
  },
};
assert.equal(getUserCalled, false, "dev sessions must NOT call Clerk Backend API");
```

**What to Mock:**
- External HTTP clients (Clerk Backend API, Lakera API) — inject mock client objects via function parameters
- Node `http.ServerResponse` / `http.IncomingMessage` — hand-rolled `mockRes()` / `mockReq()` objects
- R2 client environment variables — pass stub `STUB_ENV` objects directly to `getR2Client()`

**What NOT to Mock:**
- The module under test itself
- Pure utility functions (`signValue`, `parseConversationReplyTo`, `sanitize`) — these are tested directly with real inputs, no mocks needed
- Live API calls for `VERIFY-01`/`VERIFY-02` tests — these are conditionally skipped unless real credentials are in env

## Fixtures and Factories

**Test Data:**
```js
// Shared constant env stubs for storage tests
const STUB_ENV = {
  R2_ACCOUNT_ID: "stub-acct-1234567890",
  R2_ACCESS_KEY_ID: "stub-key-id",
  R2_SECRET_ACCESS_KEY: "stub-secret",
  R2_BUCKET: "internjobs-agent-store-test",
};

// Config stubs for auth tests
const config = {
  appUrl: "http://localhost:3000",
  appSessionSecret: "test-secret",
  enableDevAuth: true,
  isProduction: false,
  clerk: {
    secretKey: "sk_test_xxx",
    backendApiUrl: "https://api.clerk.com",
    signInUrl: "",
    jwksUrl: "",
  },
};

// UUID fixture for email alias tests
const UUID = "abcdef12-3456-7890-abcd-ef1234567890";
```

**Location:**
- Fixtures defined inline at the top of each test file as module-level `const`
- No shared fixture files or factories across test files

## Coverage

**Requirements:** None enforced. No coverage tooling configured.

**View Coverage:**
```bash
# No coverage command available; coverage is not measured
```

## Test Types

**Unit Tests (primary):**
- Location: co-located `.test.mjs` files in `apps/app/src/`
- Scope: single function or module in isolation
- Dependencies mocked via hand-rolled objects or stub envs
- Must be "NO database, NO network — pure unit smoke" (documented in `r2.test.mjs`)
- Run with: `node --test <path-to-test.mjs>`

**Integration / Smoke Tests (secondary):**
- Location: `apps/app/scripts/smoke-*.mjs`, `apps/parrot/scripts/smoke-parrot-graph.mjs`, `infra/graph-api/smoke.mjs`
- Scope: full HTTP request lifecycle against a live server or live external service
- `verify-app.mjs`: spins up the server in-process, fires real HTTP requests, asserts HTML/JSON responses
- `smoke-ops.mjs`: exercises the `/ops/*` operator endpoints with a dev session cookie
- `smoke-graph.mjs`, `smoke-parrot-graph.mjs`: exercise FalkorDB graph queries end-to-end
- Run via `npm run smoke:ops`, `npm run smoke:graph` in the relevant workspace

**Live API Tests (conditional):**
- Live Lakera Guard API tests (`VERIFY-01`, `VERIFY-02`) live inside `screen.test.mjs`
- Guarded by `if (process.env.LAKERA_GUARD_API_KEY)` — skip gracefully when key is absent
- Pattern for conditional live tests:
  ```js
  const LAKERA_KEY = process.env.LAKERA_GUARD_API_KEY;

  if (LAKERA_KEY) {
    test("VERIFY-01: injection flagged by Lakera (live API)", async () => { /* ... */ });
  } else {
    test("VERIFY-01/02: SKIPPED — set LAKERA_GUARD_API_KEY to run live API tests", () => {
      console.log("Skipping live Lakera tests — LAKERA_GUARD_API_KEY not set");
    });
  }
  ```

**E2E Tests:**
- Not used. `.playwright-mcp` directory exists at root but no Playwright test files found in `apps/`.

## Common Patterns

**Async Testing:**
```js
test("requireOperatorAuth: dev session with userType=student → 403", async () => {
  const req = mockReqWithDevCookie({ sub: "dev_student_x", userType: "student" });
  const res = mockRes();

  const auth = await requireOperatorAuth(req, res, config);
  assert.equal(auth, null, "requireOperatorAuth should return null for non-operator");
  assert.equal(res.captured.status, 403, "should be rejected with 403");
  const body = JSON.parse(res.captured.body);
  assert.equal(body.error, "forbidden");
  assert.equal(body.reason, "not_operator");
});
```

**Error Testing (throws):**
```js
test("sanitize: rejects empty, dot, dotdot", () => {
  assert.throws(() => sanitize(""), /invalid filename/);
  assert.throws(() => sanitize("   "), /invalid filename/);
  assert.throws(() => sanitize("."), /invalid filename/);
});

test("studentKey: throws on missing studentId", () => {
  assert.throws(() => studentKey("", "x.txt"), /studentId is required/);
});
```

**Null-return Testing (no throw):**
```js
test("buildConversationReplyTo: rejects malformed", () => {
  assert.equal(buildConversationReplyTo(""), null);
  assert.equal(buildConversationReplyTo(null), null);
  assert.equal(buildConversationReplyTo(undefined), null);
  assert.equal(buildConversationReplyTo("not-a-uuid"), null);
});
```

**Never-throws Contract Testing:**
```js
test("VERIFY-03c: screenMessage never throws regardless of input", async () => {
  let threw = false;
  try {
    await screenMessage(null, undefined);
  } catch {
    threw = true;
  }
  assert.equal(threw, false, "screenMessage must never throw on null/undefined inputs");
});
```

**Singleton Reset Pattern:**
```js
test("getR2Client singleton: second call returns same instance", () => {
  __resetR2ClientForTest();  // always reset before test that checks singleton behavior
  const a = getR2Client(STUB_ENV);
  const b = getR2Client(STUB_ENV);
  assert.equal(a, b, "singleton");
});
```

## Gaps

- No TypeScript/Worker test files found (no tests for `apps/parrot/workers/`, `apps/agentic-inbox/workers/`)
- No test runner integration in root `package.json` (no `npm test` command at workspace root)
- Coverage tooling absent
- No tests for React components (no React Testing Library or similar)

---

*Testing analysis: 2026-05-24*
