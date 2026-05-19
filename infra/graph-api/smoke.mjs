#!/usr/bin/env node
// infra/graph-api/smoke.mjs
//
// Manual smoke test for the internjobs-graph-api proxy + FalkorDB.
//
// Exercises the 4 operations required by Phase 18 success criteria:
//   1. ensureParrotGraphSchema  — schema/index creation (idempotent)
//   2. recordTodoFact           — :Employee + :Todo + edges write
//   3. getActiveTodos           — read back the todo
//   4. getEmployeeContext       — prose context block for LLM injection
//
// The test writes to a SMOKE-TEST employee id so real employee data is
// never polluted. The :Employee and :Todo nodes it creates are left in the
// graph (MERGE is idempotent; re-running is a no-op after the first run).
//
// Usage:
//   GRAPH_API_URL=https://internjobs-graph-api.fly.dev \
//   GRAPH_API_SECRET=<secret> \
//   node infra/graph-api/smoke.mjs
//
// Exit 0 = all PASS. Exit 1 = any FAIL.

const GRAPH_API_URL = process.env.GRAPH_API_URL?.replace(/\/$/, "");
const GRAPH_API_SECRET = process.env.GRAPH_API_SECRET;

if (!GRAPH_API_URL || !GRAPH_API_SECRET) {
  console.error("ERROR: GRAPH_API_URL and GRAPH_API_SECRET must be set.");
  console.error(
    "  GRAPH_API_URL=https://internjobs-graph-api.fly.dev GRAPH_API_SECRET=<secret> node infra/graph-api/smoke.mjs",
  );
  process.exit(1);
}

const SMOKE_EMPLOYEE_ID = "smoke-test-employee-001";
const SMOKE_SOURCE_ID = `smoke-test-source-${Date.now()}`;

let passed = 0;
let failed = 0;

async function query(cypher, params = {}) {
  const res = await fetch(`${GRAPH_API_URL}/query`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${GRAPH_API_SECRET}`,
    },
    body: JSON.stringify({ cypher, params }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status}: ${text}`);
  }
  return res.json();
}

function pass(name) {
  console.log(`  PASS  ${name}`);
  passed++;
}

function fail(name, err) {
  console.error(`  FAIL  ${name}: ${err?.message ?? String(err)}`);
  failed++;
}

// ─── Test 1: ensureParrotGraphSchema (idempotent index creation) ─────────────
console.log(
  "\n[1/4] ensureParrotGraphSchema — create :Employee, :Todo, :Person indexes",
);
try {
  const stmts = [
    "CREATE INDEX FOR (n:Employee) ON (n.id)",
    "CREATE INDEX FOR (n:Todo) ON (n.id)",
    "CREATE INDEX FOR (n:Todo) ON (n.employee_id)",
    "CREATE INDEX FOR (n:Todo) ON (n.urgency_score)",
    "CREATE INDEX FOR (n:Person) ON (n.name)",
  ];
  let anyFailed = false;
  for (const cypher of stmts) {
    try {
      await query(cypher);
    } catch (err) {
      // "already indexed" / "already exists" is expected on re-runs
      const msg = err?.message?.toLowerCase() ?? "";
      if (
        !msg.includes("already indexed") &&
        !msg.includes("already exists") &&
        !msg.includes("attribute") // FalkorDB sometimes reports "Attribute 'x' already indexed"
      ) {
        console.error(`    index stmt failed: ${cypher}\n    ${err.message}`);
        anyFailed = true;
      }
    }
  }
  if (anyFailed) throw new Error("one or more index creates failed (non-duplicate)");
  pass("ensureParrotGraphSchema");
} catch (err) {
  fail("ensureParrotGraphSchema", err);
}

// ─── Test 2: recordTodoFact — write :Employee + :Todo + :Email + edges ───────
console.log(
  "\n[2/4] recordTodoFact — MERGE :Employee + :Todo + :Email nodes",
);
let todoId;
try {
  // Deterministic todoId from SHA-256 — matches the formula in graph.ts
  // todoHash() (Worker side uses WebCrypto; both produce the same hex prefix).
  const { createHash } = await import("node:crypto");
  todoId = createHash("sha256")
    .update(`${SMOKE_EMPLOYEE_ID}|${SMOKE_SOURCE_ID}`)
    .digest("hex")
    .slice(0, 32);

  const nowIso = new Date().toISOString();

  // Step 1: MERGE Employee + Todo + HAS_TODO edge
  await query(
    `MERGE (e:Employee {id: $eid})
     MERGE (t:Todo {id: $tid})
       ON CREATE SET
         t.employee_id = $eid,
         t.title = $title,
         t.preview = $preview,
         t.urgency_score = $urgency,
         t.deadline_at = $deadline,
         t.is_mention = $isMention,
         t.source_channel = $channel,
         t.source_id = $sid,
         t.valid_from = $now,
         t.valid_to = null
     MERGE (e)-[:HAS_TODO]->(t)
     RETURN t.id`,
    {
      eid: SMOKE_EMPLOYEE_ID,
      tid: todoId,
      title: "Smoke test: reply to investor email",
      preview: "Phase 18 smoke test record — safe to leave in graph",
      urgency: 75,
      deadline: null,
      isMention: false,
      channel: "email",
      sid: SMOKE_SOURCE_ID,
      now: nowIso,
    },
  );

  // Step 2: MERGE Email source node + FROM_EMAIL edge
  await query(
    `MERGE (t:Todo {id: $tid})
     MERGE (s:Email {id: $sid})
     MERGE (t)-[:FROM_EMAIL]->(s)`,
    { tid: todoId, sid: SMOKE_SOURCE_ID },
  );

  // Step 3: Probe confirms the node exists
  const probe = await query(
    "MATCH (t:Todo {id: $tid}) RETURN count(t) AS c",
    { tid: todoId },
  );
  const row = probe?.data?.[0];
  const c = Number(
    Array.isArray(row) ? row[0] : row?.c ?? row?.["count(t)"],
  );
  if (!Number.isFinite(c) || c === 0) {
    throw new Error(`Todo node not found after MERGE (count=${c})`);
  }

  pass("recordTodoFact");
} catch (err) {
  fail("recordTodoFact", err);
}

// ─── Test 3: getActiveTodos — read back the todo we just wrote ───────────────
console.log("\n[3/4] getActiveTodos — read active todos for smoke employee");
try {
  const res = await query(
    `MATCH (e:Employee {id: $eid})-[:HAS_TODO]->(t:Todo)
     WHERE t.valid_to IS NULL
     RETURN t.title, t.urgency_score, t.deadline_at, t.is_mention,
            t.source_channel, t.source_id, t.valid_from
     ORDER BY t.urgency_score DESC
     LIMIT 20`,
    { eid: SMOKE_EMPLOYEE_ID },
  );
  const rows = res?.data ?? [];
  if (rows.length === 0)
    throw new Error("No active todos returned for smoke employee");

  // Find the row we just wrote (by source_id which is unique per smoke run)
  const found = rows.find((r) => {
    const arr = Array.isArray(r) ? r : Object.values(r);
    return String(arr[5] ?? "") === SMOKE_SOURCE_ID; // source_id is column 5
  });
  if (!found)
    throw new Error(
      `Our smoke todo (source_id=${SMOKE_SOURCE_ID}) not in active results. Rows returned: ${rows.length}`,
    );

  pass("getActiveTodos");
} catch (err) {
  fail("getActiveTodos", err);
}

// ─── Test 4: getEmployeeContext — prose summary for LLM injection ────────────
console.log("\n[4/4] getEmployeeContext — prose context block");
try {
  // Reproduce the core of getEmployeeContext locally: fetch todos +
  // collaborators, confirm the context block is non-empty.
  const todosRes = await query(
    `MATCH (e:Employee {id: $eid})-[:HAS_TODO]->(t:Todo)
     WHERE t.valid_to IS NULL
     RETURN t.title, t.urgency_score, t.deadline_at, t.is_mention,
            t.source_channel, t.source_id, t.valid_from
     ORDER BY t.urgency_score DESC
     LIMIT 20`,
    { eid: SMOKE_EMPLOYEE_ID },
  );
  const todos = todosRes?.data ?? [];

  await query(
    `MATCH (e:Employee {id: $eid})-[:HAS_TODO]->(:Todo)-[:MENTIONS]->(p:Person)
     RETURN p.name, count(*) AS c
     ORDER BY c DESC
     LIMIT 5`,
    { eid: SMOKE_EMPLOYEE_ID },
  );

  // Build a simple context block (mirrors graph.ts getEmployeeContext logic)
  if (todos.length === 0)
    throw new Error("No todos for context block — empty employee");

  const lines = ["<employee_context>", "Open todos (most urgent first):"];
  for (const r of todos.slice(0, 3)) {
    const arr = Array.isArray(r) ? r : Object.values(r);
    const title = String(arr[0] ?? "");
    const urgency = Number(arr[1]) || 0;
    lines.push(`- [urgency ${urgency}] ${title}`);
  }
  lines.push("</employee_context>");

  const contextBlock = lines.join("\n");
  if (contextBlock.length < 40)
    throw new Error(
      `Context block suspiciously short: ${contextBlock.length} chars`,
    );

  console.log(`    Context block (${contextBlock.length} chars):`);
  console.log(
    contextBlock
      .split("\n")
      .map((l) => `    ${l}`)
      .join("\n"),
  );

  pass("getEmployeeContext");
} catch (err) {
  fail("getEmployeeContext", err);
}

// ─── Test 5 (v1.3 Phase 19 Plan 02): auto_clear_valid_to_resolves_todo ──────
//
// Cross-namespace invariant: seed a :Todo node with valid_to set 10 minutes
// in the past, then confirm the grace-period Cypher used by
// workers/lib/auto-clear.ts (`WHERE valid_to < datetime() - duration({minutes: 5})`)
// returns that node as a closed-todo candidate.
//
// This is the one untested code path from research SUMMARY.md §8 open
// question 3: Cypher :Todo nodes (Parrot label namespace) queried against
// valid_to. The earlier tests prove the namespace exists with HAS_TODO
// edges; this test proves the auto-clear reconciliation loop actually
// finds closed todos via the grace-period predicate.
//
// Cleanup: deletes its test :Todo node at the end (MATCH ... DELETE).
//
// AUTO-CLEAR-VERIFY-01, AUTO-CLEAR-VERIFY-02
console.log(
  "\n[5/5] auto_clear_valid_to_resolves_todo — :Todo with valid_to 10m ago appears in closed-todos query",
);
const AUTO_CLEAR_TEST_ID = `smoke-auto-clear-${Date.now()}`;
const AUTO_CLEAR_TEST_SOURCE = `smoke-auto-clear-source-${Date.now()}`;
try {
  // Seed a :Todo node whose valid_to is 10 minutes in the past (well past
  // the 5-minute grace window). Use a UNIQUE id so concurrent smoke runs
  // don't collide.
  const tenMinAgoIso = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  await query(
    `MERGE (t:Todo {id: $tid})
       ON CREATE SET
         t.employee_id = $eid,
         t.source_id = $sid,
         t.source_channel = 'email',
         t.title = 'Smoke: auto-clear invariant',
         t.urgency_score = 50,
         t.is_mention = false,
         t.valid_from = $tenMinAgo,
         t.valid_to = $tenMinAgo
     RETURN t.id`,
    {
      tid: AUTO_CLEAR_TEST_ID,
      eid: SMOKE_EMPLOYEE_ID,
      sid: AUTO_CLEAR_TEST_SOURCE,
      tenMinAgo: tenMinAgoIso,
    },
  );

  // Now run the EXACT Cypher that workers/lib/auto-clear.ts uses
  // (FIND_CLOSED_TODOS_CYPHER). The seeded todo must appear in the result
  // set — if it doesn't, the grace-period predicate is broken and the
  // production cron would never auto-clear anything.
  const res = await query(
    `MATCH (t:Todo)
     WHERE t.valid_to IS NOT NULL
       AND t.valid_to < datetime() - duration({minutes: 5})
     RETURN t.source_id AS source_id,
            t.employee_id AS employee_id,
            t.valid_to AS valid_to
     LIMIT 100`,
  );
  const rows = res?.data ?? [];
  // Find OUR seeded row by source_id (some prior smoke runs may have left
  // other expired :Todo nodes; we only care that ours shows up).
  const found = rows.find((r) => {
    const arr = Array.isArray(r) ? r : Object.values(r);
    return String(arr[0] ?? "") === AUTO_CLEAR_TEST_SOURCE;
  });
  if (!found) {
    throw new Error(
      `expected 1 closed todo with source_id=${AUTO_CLEAR_TEST_SOURCE}, got ${rows.length} total rows (none matching). Grace-period Cypher may be broken.`,
    );
  }

  pass("auto_clear_valid_to_resolves_todo");
} catch (err) {
  fail("auto_clear_valid_to_resolves_todo", err);
} finally {
  // Cleanup: best-effort DELETE the test node so the graph stays tidy.
  // Wrapped in try/catch — if DELETE fails (e.g., proxy down), surface a
  // warning but don't flip the test result.
  try {
    await query(`MATCH (t:Todo {id: $tid}) DELETE t`, { tid: AUTO_CLEAR_TEST_ID });
  } catch (cleanupErr) {
    console.warn(
      `  WARN  auto_clear cleanup failed (graph node ${AUTO_CLEAR_TEST_ID} may persist): ${cleanupErr?.message ?? cleanupErr}`,
    );
  }
}

// ─── Results ─────────────────────────────────────────────────────────────────
const total = passed + failed;
console.log(`\n${"─".repeat(50)}`);
console.log(`Smoke test results: ${passed}/${total} PASS, ${failed}/${total} FAIL`);
if (failed > 0) {
  console.error(
    "SMOKE TEST FAILED — do not enable graph writes in production until all invariants pass.",
  );
  process.exit(1);
} else {
  console.log(
    "SMOKE TEST PASSED — graph proxy + FalkorDB Cypher + auto-clear invariant verified against production.",
  );
  process.exit(0);
}
