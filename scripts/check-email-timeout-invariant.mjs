#!/usr/bin/env node
// scripts/check-email-timeout-invariant.mjs
// v1.5 Phase 33 Plan 04 — cross-package inbound-email latency invariant.
//
// ── What this guards ─────────────────────────────────────────────────────────
//
// The inbound-email path spans TWO packages that deploy as TWO separate Workers:
//
//   apps/email-worker  (internjobs-email-ingest)  — owns the zone-wide CF Email
//     Routing catch-all. For @employers.internjobs.ai mail it POSTs the raw MIME
//     to the startup Worker, wrapped in an OUTER timeout:
//       EMPLOYERS_HANDOFF_TIMEOUT_MS
//
//   apps/startup       (internjobs-startup-mcp)   — receives that POST and makes
//     two SEQUENTIAL upstream fetches, each with its own INNER timeout:
//       RESOLVE_TIMEOUT_MS  then  INSERT_TIMEOUT_MS
//     plus non-fetch time the inner timeouts do NOT cover (TLS setup, raw-MIME
//     transmission, postal-mime parsing CPU between the two fetches). That
//     uncovered time is budgeted by OVERHEAD_BUDGET_MS.
//
// The invariant:
//
//   RESOLVE_TIMEOUT_MS + INSERT_TIMEOUT_MS + OVERHEAD_BUDGET_MS
//     <= EMPLOYERS_HANDOFF_TIMEOUT_MS
//
// Why it matters: if the inner sum could EXCEED the outer handoff timeout, a
// slow-but-SUCCESSFUL insert would be misclassified as a failure by the caller.
// email-worker fails safe on any non-2xx/timeout by ALSO forwarding the mail to
// the operator inbox — so the founder's message would land in the DB *and* get
// forwarded: a spurious duplicate that no single-package test can catch.
//
// ── Why this check lives here, and not in either package's test suite ────────
//
// Each package's own unit tests can only assert its OWN constants against
// hardcoded numbers — self-referential, and structurally incapable of failing
// when the OTHER package's numbers move. The two packages also run in separate
// CI jobs and share no import path (one is TS, one is plain ESM JS). This script
// is the only thing in the pipeline that reads BOTH sides' real source and
// checks them against each other.
//
// Zero npm dependencies (node:fs only). Never executes or type-checks the files
// it reads — it extracts the constants as text, which is why it can read a .ts
// file with plain `node` and no tsx/compilation step.
//
// Run: node scripts/check-email-timeout-invariant.mjs

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Paths are resolved relative to THIS FILE, not the CWD, so the script behaves
// identically from the repo root, from a package dir, or from a CI runner.
const STARTUP_EMAIL_TS = "apps/startup/workers/routes/email.ts";
const EMAIL_WORKER_JS = "apps/email-worker/src/index.js";

/**
 * Read a source file, failing loudly if it is missing or moved.
 * @param {string} relPath repo-relative path, used verbatim in error messages
 * @returns {string} file contents
 */
function readSource(relPath) {
	const abs = fileURLToPath(new URL(`../${relPath}`, import.meta.url));
	try {
		return readFileSync(abs, "utf8");
	} catch (err) {
		fail(
			`Could not read ${relPath} (resolved to ${abs}).\n` +
				`  ${err?.message ?? String(err)}\n` +
				`  This script hardcodes the two source paths that own the inbound-email\n` +
				`  latency budget. If the file legitimately moved, update the path at the\n` +
				`  top of scripts/check-email-timeout-invariant.mjs.`,
		);
	}
}

/**
 * Extract a numeric timeout constant from source text.
 *
 * The regex is deliberately anchored to a real DECLARATION at line start
 * (optionally `export`-prefixed, optionally `: number`-annotated):
 *
 *   export const RESOLVE_TIMEOUT_MS = 4000;
 *   const OVERHEAD_BUDGET_MS = 5000;
 *
 * It is NOT a loose `NAME = digits` match, and that is load-bearing. BOTH source
 * files carry prose comments that mention these constant names next to their
 * numbers (e.g. "RESOLVE_TIMEOUT_MS (4000ms)" and the written-out invariant
 * "... + OVERHEAD_BUDGET_MS <= EMPLOYERS_HANDOFF_TIMEOUT_MS"). A loose regex
 * could bind to a comment and read a number that the CODE no longer uses — i.e.
 * pass while the real constants violate the invariant. Requiring the `const`
 * keyword at line start makes a comment line (which begins with `//`) unmatchable.
 *
 * Fails closed on BOTH no-match (renamed/removed/un-exported constant) and
 * multi-match (ambiguous duplicate declarations — we must not silently pick one).
 *
 * @param {string} source file contents
 * @param {string} name constant identifier
 * @param {string} relPath repo-relative path, for the error message
 * @returns {number} the declared value
 */
function extractConst(source, name, relPath) {
	const re = new RegExp(
		`^[ \\t]*(?:export[ \\t]+)?const[ \\t]+${name}\\b[ \\t]*(?::[ \\t]*number)?[ \\t]*=[ \\t]*(\\d+)`,
		"gm",
	);
	const matches = [...source.matchAll(re)];

	if (matches.length === 0) {
		fail(
			`Could not find the constant ${name} in ${relPath}.\n` +
				`  Expected a declaration of the form:  export const ${name} = <number>;\n` +
				`  It was renamed, removed, un-exported, or given a non-literal value.\n` +
				`\n` +
				`  This check FAILS CLOSED on purpose: it will never assume a default for a\n` +
				`  constant it cannot actually read. Silently passing here would let the\n` +
				`  inbound-email latency budget drift unchecked, which is the exact bug this\n` +
				`  script exists to prevent. Restore the constant, or update this script to\n` +
				`  read its new name/location.`,
		);
	}

	if (matches.length > 1) {
		fail(
			`Found ${matches.length} declarations of ${name} in ${relPath}; expected exactly 1.\n` +
				`  Values seen: ${matches.map((m) => m[1]).join(", ")}\n` +
				`  Refusing to guess which one is live. Remove the duplicate declaration.`,
		);
	}

	return Number(matches[0][1]);
}

/** Print a failure banner and exit non-zero. */
function fail(message) {
	console.error("\nFAIL: email timeout invariant check\n");
	console.error(message);
	console.error("");
	process.exit(1);
}

// ── read both packages' REAL constants ───────────────────────────────────────

const startupSrc = readSource(STARTUP_EMAIL_TS);
const workerSrc = readSource(EMAIL_WORKER_JS);

const RESOLVE_TIMEOUT_MS = extractConst(startupSrc, "RESOLVE_TIMEOUT_MS", STARTUP_EMAIL_TS);
const INSERT_TIMEOUT_MS = extractConst(startupSrc, "INSERT_TIMEOUT_MS", STARTUP_EMAIL_TS);
const OVERHEAD_BUDGET_MS = extractConst(workerSrc, "OVERHEAD_BUDGET_MS", EMAIL_WORKER_JS);
const EMPLOYERS_HANDOFF_TIMEOUT_MS = extractConst(
	workerSrc,
	"EMPLOYERS_HANDOFF_TIMEOUT_MS",
	EMAIL_WORKER_JS,
);

// ── assert the invariant ─────────────────────────────────────────────────────

const innerSum = RESOLVE_TIMEOUT_MS + INSERT_TIMEOUT_MS;
const totalBudget = innerSum + OVERHEAD_BUDGET_MS;

const terms =
	`RESOLVE_TIMEOUT_MS(${RESOLVE_TIMEOUT_MS}) + ` +
	`INSERT_TIMEOUT_MS(${INSERT_TIMEOUT_MS}) + ` +
	`OVERHEAD_BUDGET_MS(${OVERHEAD_BUDGET_MS}) = ${totalBudget}`;

if (totalBudget > EMPLOYERS_HANDOFF_TIMEOUT_MS) {
	fail(
		`${terms} > EMPLOYERS_HANDOFF_TIMEOUT_MS(${EMPLOYERS_HANDOFF_TIMEOUT_MS}).\n` +
			`\n` +
			`  The inbound-email inner budget now EXCEEDS the outer handoff timeout by ` +
			`${totalBudget - EMPLOYERS_HANDOFF_TIMEOUT_MS}ms.\n` +
			`  Consequence if shipped: a slow-but-successful insert gets misclassified as a\n` +
			`  failure by apps/email-worker, which then fails safe and ALSO forwards the mail\n` +
			`  to the operator inbox — the founder's message is stored AND forwarded (a\n` +
			`  spurious duplicate).\n` +
			`\n` +
			`  Reconcile ONE of these two files so the inequality holds again:\n` +
			`    ${EMAIL_WORKER_JS}\n` +
			`        EMPLOYERS_HANDOFF_TIMEOUT_MS = ${EMPLOYERS_HANDOFF_TIMEOUT_MS}  (raise it, and/or lower OVERHEAD_BUDGET_MS = ${OVERHEAD_BUDGET_MS})\n` +
			`    ${STARTUP_EMAIL_TS}\n` +
			`        RESOLVE_TIMEOUT_MS = ${RESOLVE_TIMEOUT_MS}, INSERT_TIMEOUT_MS = ${INSERT_TIMEOUT_MS}  (lower one or both)\n` +
			`\n` +
			`  Required: RESOLVE + INSERT + OVERHEAD <= EMPLOYERS_HANDOFF_TIMEOUT_MS`,
	);
}

console.log(
	`OK: ${terms} <= EMPLOYERS_HANDOFF_TIMEOUT_MS(${EMPLOYERS_HANDOFF_TIMEOUT_MS})` +
		`  [${EMPLOYERS_HANDOFF_TIMEOUT_MS - totalBudget}ms slack]`,
);
console.log(
	`     read from ${STARTUP_EMAIL_TS} + ${EMAIL_WORKER_JS} (no hardcoded duplicates)`,
);
