// workers/tests/__mocks__/cloudflare-workers.ts
// Stub for the `cloudflare:workers` built-in module.
//
// Plain Node Vitest cannot resolve `cloudflare:workers` — it's a Cloudflare
// runtime built-in with no npm equivalent. Without this stub, importing
// `{ app }` from `workers/index.ts` throws ERR_MODULE_NOT_FOUND before any
// test runs, killing the entire WSTEST suite.
//
// This file is aliased to `cloudflare:workers` in vitest.config.ts.
// It exports only the symbols actually imported as VALUES (not type-only)
// by the worker code:
//   - DurableObject: base class extended by WorkspaceDO and EmployeeMailboxDO.
//
// Confirmed via source read (27-02 execution):
//   - workers/durableObject/workspace.ts  → import { DurableObject } from "cloudflare:workers"
//   - workers/durableObject/index.ts      → import { DurableObject } from "cloudflare:workers"
// Both use DurableObject ONLY as a base class (value import via `extends`).
//
// DurableObjectState, DurableObjectNamespace, etc. are only used as TypeScript
// types (never imported as values), so they do not need stub entries.

export class DurableObject {
	// Minimal stub. The constructor signature mirrors the real CF DO base class.
	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	constructor(_state?: unknown, _env?: unknown) {}
}
