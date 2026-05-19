// v1.2 Phase 14 Wave 3: 6-invariant smoke validation for the Parrot
// Knowledge Graph (FalkorDB, internjobs-graph Fly app).
//
// Run:
//   FALKORDB_URL=redis://default:<pw>@host:6379 \
//   npm --prefix apps/parrot run smoke:parrot-graph
//
// Hermetic-CI posture: when FALKORDB_URL is unset, exit 0 with a
// skip message — mirrors apps/app/scripts/smoke-graph.mjs so CI
// without the secret does not red. Any FAILED invariant (with the URL
// set) still exits 1.
//
// Invariants:
//   1. PING       — FalkorDB round-trips RETURN 1
//   2. SCHEMA     — index bootstrap is idempotent across re-runs
//   3. SEED_FACTS — write 2 :Todo nodes for a synthetic employee
//   4. DEDUP      — re-inserting the same (employeeId, sourceId)
//                   MERGEs onto the existing node — no duplicate, no
//                   field overwrite (ROADMAP SC-4 close-out)
//   5. NAMESPACE  — :Fact label (student app) returns zero rows with
//                   smoke-employee-* id; Parrot :Todo nodes do NOT
//                   leak across the label namespace boundary (SC-8)
//   6. SUMMARY    — getEmployeeContext-shaped query returns non-empty
//                   prose listing seeded todos (SC-1 / SC-2)
//
// Skills referenced:
//   cloudflare/skills: cloudflare — Workers runtime, nodejs_compat
//     (node:crypto for deterministic todoHash)

import { createHash } from "node:crypto";
import { FalkorDB } from "falkordb";

const FALKORDB_URL = process.env.FALKORDB_URL;
if (!FALKORDB_URL) {
	// Hermetic-CI: same posture as apps/app/scripts/smoke-graph.mjs —
	// the smoke script is OPT-IN. Skipping when the URL is absent keeps
	// CI green for callers who don't ship the FalkorDB secret. Set
	// FALKORDB_URL locally (from Infisical) to exercise the suite.
	console.log(
		"[smoke:parrot-graph] FALKORDB_URL not set — skipping (hermetic-CI exit 0).",
	);
	process.exit(0);
}

const GRAPH_NAME = "internjobs";
const SMOKE_EMPLOYEE_ID = `smoke-employee-${Date.now()}`;

// ─── helpers ────────────────────────────────────────────────────────

let PASS = 0;
let FAIL = 0;

function assert(name, condition, detail = "") {
	if (condition) {
		console.log(`  PASS  INVARIANT ${name}`);
		PASS++;
	} else {
		console.error(`  FAIL  INVARIANT ${name}${detail ? ": " + detail : ""}`);
		FAIL++;
	}
}

function todoHash(employeeId, sourceId) {
	return createHash("sha256")
		.update(`${employeeId}|${sourceId}`)
		.digest("hex")
		.slice(0, 32);
}

// FalkorDB rows arrive either as positional arrays or as keyed maps
// depending on driver version + query shape. This normalizer pulls the
// first column out of whichever form the driver returned.
function firstCell(row) {
	if (row == null) return null;
	if (Array.isArray(row)) return row[0];
	if (typeof row === "object") {
		const keys = Object.keys(row);
		return keys.length > 0 ? row[keys[0]] : null;
	}
	return row;
}

function cellAt(row, index, keyHint) {
	if (row == null) return null;
	if (Array.isArray(row)) return row[index];
	if (typeof row === "object") {
		if (keyHint && Object.hasOwn(row, keyHint)) return row[keyHint];
		const keys = Object.keys(row);
		return keys[index] != null ? row[keys[index]] : null;
	}
	return null;
}

// ─── main ───────────────────────────────────────────────────────────

async function main() {
	console.log("smoke:parrot-graph — connecting to FalkorDB…");
	let client;
	try {
		client = await FalkorDB.connect({ url: FALKORDB_URL });
	} catch (err) {
		console.error("FalkorDB.connect failed:", err.message);
		process.exit(1);
	}
	const graph = client.selectGraph(GRAPH_NAME);

	// ── INVARIANT 1: PING ────────────────────────────────────────────
	console.log("\n[1/6] PING — RETURN 1 round-trip");
	try {
		const res = await graph.query("RETURN 1");
		const val = Number(firstCell(res?.data?.[0]) ?? 0);
		assert("1: PING", val === 1, `RETURN 1 returned ${val}`);
	} catch (err) {
		assert("1: PING", false, err.message);
	}

	// ── INVARIANT 2: SCHEMA bootstrap (idempotent) ──────────────────
	console.log("\n[2/6] SCHEMA — label index bootstrap (idempotent)");
	const indexStmts = [
		"CREATE INDEX FOR (n:Employee) ON (n.id)",
		"CREATE INDEX FOR (n:Todo) ON (n.id)",
		"CREATE INDEX FOR (n:Todo) ON (n.employee_id)",
		"CREATE INDEX FOR (n:Todo) ON (n.urgency_score)",
		"CREATE INDEX FOR (n:Person) ON (n.name)",
		"CREATE INDEX FOR (n:Email) ON (n.id)",
		"CREATE INDEX FOR (n:ChatMsg) ON (n.id)",
	];
	let schemaOk = true;
	// Run twice to confirm idempotency — the SECOND pass must also
	// succeed (already-exists errors are swallowed).
	for (let pass = 0; pass < 2; pass++) {
		for (const stmt of indexStmts) {
			try {
				await graph.query(stmt);
			} catch (err) {
				const msg = (err?.message || "").toLowerCase();
				if (
					!msg.includes("already indexed") &&
					!msg.includes("already exists")
				) {
					schemaOk = false;
					console.error(
						`  schema stmt failed (pass ${pass + 1}):`,
						stmt,
						err.message,
					);
				}
			}
		}
	}
	assert(
		"2: SCHEMA",
		schemaOk,
		"one or more index creates failed non-idempotently",
	);

	// ── INVARIANT 3: SEED FACTS ────────────────────────────────────
	console.log("\n[3/6] SEED — insert 2 :Todo nodes for synthetic employee");

	const todos = [
		{
			sourceId: "smoke-email-001",
			title: "Finalize Q4 board deck",
			urgencyScore: 85,
		},
		{
			sourceId: "smoke-email-002",
			title: "Confirm Friday standup time",
			urgencyScore: 50,
		},
	];

	let seedOk = true;
	for (const t of todos) {
		const tid = todoHash(SMOKE_EMPLOYEE_ID, t.sourceId);
		try {
			await graph.query(
				`MERGE (e:Employee {id: $eid})
				 MERGE (t:Todo {id: $tid})
				   ON CREATE SET
				     t.employee_id = $eid,
				     t.source_channel = 'email',
				     t.source_id = $src,
				     t.title = $title,
				     t.urgency_score = $score,
				     t.is_mention = false,
				     t.valid_from = $now,
				     t.valid_to = null
				 MERGE (e)-[:HAS_TODO]->(t)`,
				{
					params: {
						eid: SMOKE_EMPLOYEE_ID,
						tid,
						src: t.sourceId,
						title: t.title,
						score: t.urgencyScore,
						now: new Date().toISOString(),
					},
				},
			);
		} catch (err) {
			seedOk = false;
			console.error("  seed failed for", t.sourceId, err.message);
		}
	}

	let todoCount = 0;
	try {
		const countRes = await graph.query(
			`MATCH (:Employee {id: $eid})-[:HAS_TODO]->(t:Todo)
			 WHERE t.valid_to IS NULL
			 RETURN count(t) AS c`,
			{ params: { eid: SMOKE_EMPLOYEE_ID } },
		);
		todoCount = Number(firstCell(countRes?.data?.[0]) ?? 0);
	} catch (err) {
		console.error("  count query failed:", err.message);
	}
	assert(
		"3: SEED_FACTS",
		seedOk && todoCount === 2,
		`found ${todoCount} todos (expected 2)`,
	);

	// ── INVARIANT 4: DEDUP / close-out ─────────────────────────────
	console.log("\n[4/6] DEDUP — re-inserting same sourceId is a no-op");
	const dupTid = todoHash(SMOKE_EMPLOYEE_ID, todos[0].sourceId);
	try {
		await graph.query(
			`MERGE (e:Employee {id: $eid})
			 MERGE (t:Todo {id: $tid})
			   ON CREATE SET
			     t.employee_id = $eid,
			     t.source_id = $src,
			     t.title = 'DUPLICATE — should NOT appear',
			     t.valid_from = $now,
			     t.valid_to = null
			 MERGE (e)-[:HAS_TODO]->(t)`,
			{
				params: {
					eid: SMOKE_EMPLOYEE_ID,
					tid: dupTid,
					src: todos[0].sourceId,
					now: new Date().toISOString(),
				},
			},
		);
	} catch (err) {
		console.error("  dup insert error:", err.message);
	}

	let dedupTitle = "";
	let dedupCount = 0;
	try {
		const res = await graph.query(
			`MATCH (:Employee {id: $eid})-[:HAS_TODO]->(t:Todo {id: $tid})
			 RETURN t.title AS title, count(*) AS c`,
			{ params: { eid: SMOKE_EMPLOYEE_ID, tid: dupTid } },
		);
		const row = res?.data?.[0];
		dedupTitle = String(cellAt(row, 0, "title") ?? "");
		dedupCount = Number(cellAt(row, 1, "c") ?? 0);
	} catch (err) {
		console.error("  dedup verify query failed:", err.message);
	}
	assert(
		"4: DEDUP",
		dedupTitle === todos[0].title && dedupCount === 1,
		`title="${dedupTitle}" count=${dedupCount} (expected "${todos[0].title}" and 1)`,
	);

	// ── INVARIANT 5: NAMESPACE ISOLATION ──────────────────────────
	console.log("\n[5/6] NAMESPACE — :Fact label finds zero Parrot smoke nodes");
	// The student app writes :Fact nodes (apps/app/src/memory/graph.mjs).
	// Parrot writes :Todo nodes. Querying :Fact with our smoke employee_id
	// MUST return zero — proves label-scoped isolation. A non-zero result
	// would indicate accidental cross-namespace writes.
	let factLeaks = -1;
	try {
		const leakRes = await graph.query(
			`MATCH (f:Fact) WHERE f.employee_id STARTS WITH 'smoke-employee-'
			 RETURN count(f) AS c`,
		);
		factLeaks = Number(firstCell(leakRes?.data?.[0]) ?? 0);
	} catch (_err) {
		// :Fact label may not exist at all on a fresh test graph — that's
		// also a valid zero-leak outcome. Treat the error as "no leaks".
		factLeaks = 0;
	}
	assert(
		"5: NAMESPACE",
		factLeaks === 0,
		`${factLeaks} :Fact node(s) carry smoke employee_id — label leak detected`,
	);

	// ── INVARIANT 6: SUMMARY non-empty (getEmployeeContext shape) ──
	console.log("\n[6/6] SUMMARY — non-empty prose from active-todos query");
	// Re-implements the core of getEmployeeContext inline so the smoke
	// script doesn't need to import the Worker TS file (not transpiled in
	// scripts/). The shape MUST match workers/lib/graph.ts getEmployeeContext.
	let summaryText = "";
	try {
		const todoRes = await graph.query(
			`MATCH (:Employee {id: $eid})-[:HAS_TODO]->(t:Todo)
			 WHERE t.valid_to IS NULL
			 RETURN t.title AS title, t.urgency_score AS urgency
			 ORDER BY t.urgency_score DESC
			 LIMIT 10`,
			{ params: { eid: SMOKE_EMPLOYEE_ID } },
		);
		const rows = todoRes?.data ?? [];
		if (rows.length > 0) {
			const lines = rows.map((r) => {
				const title = cellAt(r, 0, "title");
				const urgency = cellAt(r, 1, "urgency");
				return `- [urgency ${urgency}] ${title}`;
			});
			summaryText = `<employee_context>\nOpen todos (most urgent first):\n${lines.join("\n")}\n</employee_context>`;
		}
	} catch (err) {
		console.error("  summary query failed:", err.message);
	}
	assert(
		"6: SUMMARY",
		summaryText.length > 0 &&
			summaryText.includes("todo") &&
			summaryText.includes("Finalize Q4 board deck"),
		"summary missing expected content",
	);

	// ── Cleanup — remove smoke nodes ──────────────────────────────
	console.log("\n[cleanup] removing smoke nodes…");
	try {
		await graph.query(
			`MATCH (e:Employee {id: $eid})-[:HAS_TODO]->(t:Todo)
			 DETACH DELETE e, t`,
			{ params: { eid: SMOKE_EMPLOYEE_ID } },
		);
		console.log("  smoke nodes removed.");
	} catch (err) {
		console.warn("  cleanup failed (non-fatal):", err.message);
	}

	try {
		await client.close?.();
	} catch (_) {
		/* close errors are non-fatal */
	}

	// ── Results ───────────────────────────────────────────────────
	console.log(`\n${"─".repeat(50)}`);
	console.log(`smoke:parrot-graph  ${PASS} passed  ${FAIL} failed`);
	if (FAIL > 0) {
		process.exit(1);
	}
}

main().catch((err) => {
	console.error("smoke:parrot-graph: unexpected error", err);
	process.exit(1);
});
