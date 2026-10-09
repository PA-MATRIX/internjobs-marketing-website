// apps/email-worker/src/constants.js
// v1.5 Phase 33 Plan 04 — inbound-email latency budget constants.
//
// ── WHY THESE LIVE HERE AND NOT IN index.js ─────────────────────────────────
//
// They were originally declared as `export const` in src/index.js (Plan 33-02).
// That is NOT deployable. src/index.js is the Worker ENTRYPOINT module, and the
// Workers runtime requires every NAMED export of an entrypoint to be a handler
// — a function, an ExportedHandler, or a WorkerEntrypoint/DurableObject class.
// A named export whose value is a plain number makes workerd refuse to
// instantiate the ENTIRE script:
//
//   Uncaught TypeError: Incorrect type for map entry
//   'EMPLOYERS_HANDOFF_TIMEOUT_MS': the provided value is not of type
//   'function or ExportedHandler'.
//   The Workers runtime failed to start.
//
// This is a TOTAL outage, not a degraded mode: internjobs-email-ingest is the
// zone-wide CF Email Routing catch-all, so a script that cannot start means ALL
// inbound mail for internjobs.ai fails — including agent.internjobs.ai
// conversation-alias ingestion and the operator forward. Note that neither
// `node --check`, nor node:test (which imports the module under Node, where a
// numeric named export is perfectly legal), nor `wrangler deploy` itself catch
// this — the deploy is ACCEPTED and only fails at runtime instantiation. It was
// caught by booting the real workerd runtime locally (`wrangler dev`).
//
// Constants therefore live in this NON-entrypoint module, which has no such
// restriction. index.js imports them; the entrypoint's only named export is the
// dispatchToEmployersHandoff function (functions are permitted) plus `default`.
//
// Guard: src/index.test.js asserts every named export of index.js is a function,
// which fails loudly if a primitive is ever exported from the entrypoint again.
//
// ── THE LATENCY BUDGET ──────────────────────────────────────────────────────
//
// EMPLOYERS_HANDOFF_TIMEOUT_MS is the OUTER timeout wrapping the raw-MIME POST
// to apps/startup's POST /internal/email/inbound. The receiving end makes two
// SEQUENTIAL upstream fetches (RESOLVE_TIMEOUT_MS=4000 + INSERT_TIMEOUT_MS=5000,
// declared in apps/startup/workers/routes/email.ts). The outer POST ALSO pays
// for TLS/connection setup, transmission of the raw MIME body, and postal-mime
// parsing CPU that runs BETWEEN the two inner fetches — time budgeted by neither
// inner timeout. OVERHEAD_BUDGET_MS covers that non-fetch time.
//
// Invariant (enforced in CI by scripts/check-email-timeout-invariant.mjs, which
// reads the REAL numbers from this file AND apps/startup's email.ts — NOT by
// this comment, and NOT by either package's own self-referential unit test):
//
//   RESOLVE_TIMEOUT_MS + INSERT_TIMEOUT_MS + OVERHEAD_BUDGET_MS
//     <= EMPLOYERS_HANDOFF_TIMEOUT_MS
//   i.e. 4000 + 5000 + 5000 = 14000 <= 20000  (6000ms real slack)
//
// If the inner sum could exceed the outer ceiling, a slow-but-SUCCESSFUL insert
// would be misclassified as a failure by the caller, which then fails safe and
// ALSO forwards the mail to the operator inbox — a spurious duplicate.
//
// Wall-clock time awaiting fetch() is not CPU-billed on Workers, so keeping this
// ceiling generous costs nothing.

export const OVERHEAD_BUDGET_MS = 5000;
export const EMPLOYERS_HANDOFF_TIMEOUT_MS = 20000;
