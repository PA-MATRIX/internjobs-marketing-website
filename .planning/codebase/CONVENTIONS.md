# Coding Conventions

**Analysis Date:** 2026-05-24

## Architectural Context Loaded

- No `.planning/NORTH-STAR.md` found in repo root.
- No `CLAUDE.md` or `AGENTS.md` at repo root.
- No locked sources that constrain coding convention choices were identified.

---

## Naming Patterns

**Files:**
- Node.js/Fly app modules: `kebab-case.mjs` (e.g., `auth.mjs`, `http.mjs`, `store.mjs`, `student-inbound.mjs`)
- Cloudflare Worker modules (TypeScript): `kebab-case.ts` (e.g., `mailbox.ts`, `inbound-email.ts`, `agent-tools.ts`)
- React Router route files: `kebab-case.tsx` (e.g., `admin.invite.tsx`, `ops.safety.tsx`, `email-list.tsx`)
- React components: `PascalCase.tsx` (e.g., `EmailPanel.tsx`, `Sidebar.tsx`)
- Test files: co-located with source, suffix `.test.mjs` (e.g., `auth.test.mjs`, `r2.test.mjs`, `reply-to.test.mjs`)
- Script/smoke files: `kebab-case.mjs` in `scripts/` directories (e.g., `smoke-ops.mjs`, `verify-app.mjs`)

**Functions:**
- camelCase for all exported functions: `requireOperatorAuth`, `buildConversationReplyTo`, `getR2Client`, `screenMessage`
- Factory functions prefix with `create`: `createStore`, `createSpectrumSmsProvider`, `createMacBridgeSmsProvider`
- Boolean-returning functions prefix with `has`/`is`: `hasLinkedInProfileUrl`, `isMastraReady`, `isOperator`
- Private/module-internal functions use same camelCase but are not exported; test-seam resets prefix with `_reset` (e.g., `_resetClerkClientForTest`, `__resetR2ClientForTest`)

**Variables:**
- camelCase for all locals and module-level vars
- Module-level singletons use `_` prefix: `_clerkClient`, `_graphReadyCacheValue`, `_graphReadyCacheAt`
- Constants using `_` prefix for module-private cache timestamps: `_graphReadyCacheAt`, `_screenMs`
- Env objects passed as `env` parameter, process.env accessed in config factory only

**Types (TypeScript):**
- Interfaces for data shapes: `EmailMetadata`, `EmailFull`, `AttachmentInfo`, `ScreenResult`, `Employee`, `Env`
- `type` aliases for union types and context shapes: `ParrotContext`, `AppContext`, `MailboxContext`
- Zod schemas named with `Schema` suffix: `SendEmailRequestSchema`, `RecipientFieldSchema`, `CreateMailboxBody` (some without suffix — inconsistent)

**Constants:**
- `UPPER_SNAKE_CASE` for module-level timing constants: `GRAPH_READY_TTL_MS`, `TIMEOUT_MS`, `FIND_CLOSED_TODOS_CYPHER`

## Code Style

**Formatting:**
- No root-level Prettier or ESLint config detected.
- TypeScript apps (`apps/parrot`, `apps/agentic-inbox`) use `tsconfig.json` with strict mode via Cloudflare's `@cloudflare/workers-types`.
- Node app (`apps/app`) uses plain `.mjs` (no TypeScript, no formatter config).
- Indentation: 2 spaces throughout (both `.mjs` and `.ts` files).
- String quotes: double-quotes in `.mjs` files; mix of double and template literals in `.ts`.

**Linting:**
- No root `.eslintrc` or `biome.json` detected.
- TypeScript compilation (`tsc -b`) serves as the primary type-checker in `apps/parrot` and `apps/agentic-inbox` via `npm run typecheck`.
- Node app uses `node --check src/index.js` in `apps/email-worker`.

## Import Organization

**Order (`.mjs` Node modules):**
1. Node built-ins using `node:` prefix: `import { createServer } from "node:http"`, `import { createHmac } from "node:crypto"`, `import test from "node:test"`, `import assert from "node:assert/strict"`
2. Third-party npm packages
3. Local relative imports using `.mjs` extension

**Order (TypeScript Worker modules):**
1. Third-party packages (`hono`, `zod`, `jose`, etc.)
2. Local relative imports using no extension or `.js` extension (resolved by TypeScript)

**Path Aliases:**
- None detected. All imports are relative paths.
- Monorepo shared package `@internjobs/shared` at `packages/shared/src/index.ts` — used via npm workspaces.

**Module Extension:**
- Always include `.mjs` extension in Node app imports: `import { signValue } from "./http.mjs"`
- TypeScript files omit extension in imports (standard TS practice)

## Error Handling

**Patterns (Node app):**
- Functions that must never throw document this explicitly in a block comment and return a sentinel (e.g., `null`, `false`, `{ flagged: false, action: 'passed_lakera_unavailable', ... }`):
  ```js
  // All failures are caught and logged; this function never throws.
  ```
- Top-level async failures use `.catch()` chained on fire-and-forget calls:
  ```js
  ensureGraphSchema().catch((err) => {
    console.warn(JSON.stringify({ level: "warn", message: "graph_schema_bootstrap_failed", error: err?.message ?? String(err) }));
  });
  ```
- Workflow functions wrap outbound calls in explicit try/catch with structured log emission on failure, then return partial success rather than throwing.
- Guard clauses throw `Error` synchronously for programming errors (missing required arguments): `if (!pool) throw new Error("runStudentInboundWorkflow: pool is required")`

**Patterns (Hono Worker routes):**
- Return `c.json({ error: "snake_case_error_code" }, STATUS_CODE)` for all API errors
- Common error codes use snake_case strings: `"unauthenticated"`, `"forbidden_operator_only"`, `"employee_disabled"`, `"missing_required_claims"`

**Pattern (test seam resets):**
- Singleton modules export a `__resetXxxForTest()` function prefixed with double underscore, used only in test files to clear module-level state between test cases.

## Logging

**Format:** Structured JSON emitted to `console.log` / `console.warn` / `console.error`. Never plain string messages.

**Schema:**
```js
console.log(JSON.stringify({
  level: "info",   // "debug" | "info" | "warn" | "error"
  event: "snake_case_event_name",
  // + arbitrary context fields
}));
```

**When to log:**
- `console.warn` + `JSON.stringify` for non-fatal degraded states (e.g., graph schema bootstrap failed, Lakera 5xx)
- `console.error` + `JSON.stringify` for caught errors in workflow paths
- `console.log` + `JSON.stringify` for operational events (send success, latency measurements, safety screen results)
- Never `console.log` a plain string in production paths

**Event naming:** `snake_case` string: `"graph_schema_bootstrap_failed"`, `"lakera_latency_ms"`, `"safety_events_write_failed"`

## Comments

**When to Comment:**
- File-level block comment is mandatory: version tag + phase ref + what the module does.
  ```js
  // apps/app/src/workflows/reply-to.mjs
  //
  // v1.2 EMAIL-03 — per-conversation email aliases.
  ```
- Section dividers use Unicode box characters: `// ─── Section Name ────────────────────────────────────────────────────────────`
- Inline comments document "why" and edge-case contracts (PITFALLS references, auth loop explanations).
- Commented-out code kept with an explanation comment when the removal is part of an intentional architectural pivot:
  ```js
  // import { routeAndSend } from "./outbound.mjs";
  // routeAndSend was previously imported here for /ops/drafts/:id/approve path;
  // after the 2026-05-17 autonomy pivot the approve/edit/reject routes are gone.
  ```

**JSDoc/TSDoc:**
- JSDoc `/** */` style used for key exported TypeScript functions in Worker libs (e.g., `requireEmployeeMailbox`, `screenMessage`)
- Node `.mjs` modules use inline `//` comments above exports, not JSDoc

## Function Design

**Size:** Server route handler functions tend to be large (server.mjs is 2006 lines, workflows/student-inbound.mjs is 1716 lines). Behavior is extracted into named sub-functions within the same file rather than further split across files.

**Parameters:**
- Config is always a single `config` object parameter (from `getConfig()`)
- Env bindings in Workers passed as the `env` Cloudflare parameter
- Factory pattern: `createXxx(config)` returns a store/client/provider object with method functions

**Return Values:**
- Functions that can fail return `null` (not throw) when the failure is expected (e.g., `getR2Client({})` → `null`, `buildConversationReplyTo("")` → `null`)
- Functions that are fail-safe return a structured result object: `{ flagged, action, reason, score, raw }`
- Async functions always `await`; no `.then()` chains except on fire-and-forget `.catch()` handlers

## Module Design

**Exports:**
- Named exports only — no default exports in `.mjs` Node modules
- Default exports used in React Router route files (`.tsx`) and config files (`routes.ts`)
- Shared type definitions exported from `types.ts` in Worker directories

**Barrel Files:**
- `packages/shared/src/index.ts` serves as the barrel for the shared package
- No barrel `index.ts` files within individual app directories — imports go directly to the source file

**Singleton Pattern:**
- Module-level `let _singleton = null` with a `get_Xxx(env)` factory that lazily initializes and caches:
  ```js
  let _clerkClient = null;
  function getClerkClient(config) {
    if (_clerkClient) return _clerkClient;
    _clerkClient = createClerkClient({ ... });
    return _clerkClient;
  }
  ```
- Always paired with a `__resetXxxForTest()` export when the singleton is tested

---

*Convention analysis: 2026-05-24*
