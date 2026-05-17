// apps/app/scripts/smoke-graph.mjs
//
// v1.2 MEMORY-01 smoke test for the graph memory module.
//
// What this asserts:
//   1. ensureGraphSchema() runs without throwing (idempotent).
//   2. Writing 5 facts about a fake student → getActiveFacts returns 5.
//   3. Writing a CONFLICTING fact (same predicate, different object) for
//      one of those facts → the OLD fact's valid_to becomes non-null AND
//      it disappears from getActiveFacts; the NEW fact is active. This is
//      the Graphiti-style temporal close-out invariant that makes "I
//      never said that" pushback work.
//   4. getStudentSummary returns a non-empty string suitable for prompt
//      injection. Printed to stdout so the operator can sanity-check the
//      voice.
//   5. recallHistory("python") puts python-flavored facts at the top.
//   6. Cleanup: all test facts get deleted so re-runs are idempotent.
//
// Connection:
//   - Uses SMOKE_FALKORDB_URL if set, else FALKORDB_URL. Both must point at
//     a FalkorDB instance. Production runs use a Fly proxy
//     (`flyctl proxy 6380:6379 -a internjobs-graph` then
//     SMOKE_FALKORDB_URL=redis://default:$FALKORDB_PASSWORD@127.0.0.1:6380).
//   - If NEITHER is set, the smoke is a NO-OP that prints a clear "skipped"
//     line and exits 0. This matches the build:app / smoke:ops contract:
//     graph DB unavailability NEVER fails a smoke run; it's an opt-in test.

import {
  ensureGraphSchema,
  recordFact,
  getActiveFacts,
  getStudentSummary,
  recallHistory,
  pingGraph,
  closeGraphClient,
  getGraphClient,
} from "../src/memory/graph.mjs";

// Honor SMOKE_FALKORDB_URL → if set, propagate to FALKORDB_URL so the
// module picks it up.
if (process.env.SMOKE_FALKORDB_URL && !process.env.FALKORDB_URL) {
  process.env.FALKORDB_URL = process.env.SMOKE_FALKORDB_URL;
}

if (!process.env.FALKORDB_URL) {
  console.log(
    JSON.stringify({
      level: "info",
      message: "smoke_graph_skipped",
      reason: "no_FALKORDB_URL_env",
      note: "set SMOKE_FALKORDB_URL=redis://default:<pw>@host:port to run",
    }),
  );
  process.exit(0);
}

// Stable test ids so a partial-failure run can be re-run cleanly.
const STUDENT_ID = `smoke-graph-student-${process.env.SMOKE_SUFFIX || "fixed"}`;
const FAKE_MSG_ID = "smoke-msg-00000000-0000-0000-0000-000000000001";

function assert(cond, msg) {
  if (!cond) {
    console.error(`assertion failed: ${msg}`);
    process.exit(1);
  }
}

async function cleanup() {
  // Delete all :Fact nodes attached to our smoke student + the student
  // node itself. Doing this through a raw Cypher query keeps cleanup
  // simple — we don't expose a deleteAllFor() in the module API.
  const client = await getGraphClient();
  if (!client) return;
  try {
    const graph = client.selectGraph("internjobs");
    await graph.query(
      `MATCH (s:Student {id: $sid})-[:HAS_FACT]->(f:Fact)
       DETACH DELETE f`,
      { params: { sid: STUDENT_ID } },
    );
    await graph.query(
      `MATCH (s:Student {id: $sid}) DETACH DELETE s`,
      { params: { sid: STUDENT_ID } },
    );
  } catch (err) {
    console.warn(`smoke_graph_cleanup_failed: ${err?.message ?? String(err)}`);
  }
}

async function run() {
  console.log("smoke_graph_start");

  // Pre-clean in case a prior partial run left rows.
  await cleanup();

  // 0. ping
  const reachable = await pingGraph();
  assert(reachable, "pingGraph returned false; cannot reach FalkorDB");
  console.log("  step_0_ping: ok");

  // 1. schema
  const ok = await ensureGraphSchema();
  assert(ok, "ensureGraphSchema returned false");
  console.log("  step_1_schema: ok");

  // 2. write 5 facts
  const seedFacts = [
    { predicate: "STUDIES_AT", object: "NYU" },
    { predicate: "INTERESTED_IN", object: "backend python" },
    { predicate: "INTERESTED_IN", object: "typescript" },
    { predicate: "PREFERS", object: "small startup, remote or NYC" },
    { predicate: "MENTIONED", object: "Acme Backend Python Intern role - intro pending operator" },
  ];
  for (const f of seedFacts) {
    const r = await recordFact({
      subjectId: STUDENT_ID,
      subjectType: "Student",
      predicate: f.predicate,
      objectValue: f.object,
      confidence: 0.9,
      sourceMessageId: FAKE_MSG_ID,
    });
    assert(r && r.factId, `recordFact returned null for ${JSON.stringify(f)}`);
  }
  const after5 = await getActiveFacts(STUDENT_ID);
  assert(after5.length === 5, `expected 5 active facts, got ${after5.length}`);
  console.log(`  step_2_seed_facts: ok (${after5.length} active)`);

  // 3. write conflicting fact: STUDIES_AT changes from NYU → Columbia
  //    Old NYU fact must be closed; only the Columbia fact remains for
  //    that predicate. Other 4 facts unchanged.
  const conflict = await recordFact({
    subjectId: STUDENT_ID,
    subjectType: "Student",
    predicate: "STUDIES_AT",
    objectValue: "Columbia",
    confidence: 0.95,
    sourceMessageId: FAKE_MSG_ID + "-2",
  });
  assert(conflict && conflict.factId, "conflict recordFact returned null");
  assert(conflict.closedCount === 1, `expected 1 closed prior fact, got ${conflict.closedCount}`);

  const afterConflict = await getActiveFacts(STUDENT_ID);
  assert(afterConflict.length === 5, `expected 5 active after conflict (4 untouched + 1 new), got ${afterConflict.length}`);
  const studiesAt = afterConflict.filter((f) => f.predicate === "STUDIES_AT");
  assert(studiesAt.length === 1, `expected exactly 1 active STUDIES_AT, got ${studiesAt.length}`);
  assert(studiesAt[0].objectValue === "Columbia", `expected Columbia, got ${studiesAt[0].objectValue}`);
  console.log("  step_3_conflict_closeout: ok (NYU closed, Columbia active)");

  // 4. summary
  const summary = await getStudentSummary(STUDENT_ID);
  assert(typeof summary === "string" && summary.length > 0, "empty summary");
  // Must mention Columbia (the active STUDIES_AT) and NOT mention NYU.
  assert(summary.includes("Columbia"), `summary missing Columbia: ${summary}`);
  assert(!summary.includes("NYU"), `summary should not mention closed NYU: ${summary}`);
  console.log("  step_4_summary: ok");
  console.log(`    SAMPLE SUMMARY: ${summary}`);

  // 5. recall
  const recalled = await recallHistory(STUDENT_ID, "python");
  assert(recalled.length > 0, "recallHistory returned no rows");
  assert(
    recalled[0].objectValue.toLowerCase().includes("python"),
    `recallHistory top result is not python-flavored: ${recalled[0].objectValue}`,
  );
  console.log(`  step_5_recall: ok (top: "${recalled[0].objectValue}")`);

  // 6. cleanup
  await cleanup();
  const afterCleanup = await getActiveFacts(STUDENT_ID);
  assert(afterCleanup.length === 0, `expected 0 facts after cleanup, got ${afterCleanup.length}`);
  console.log("  step_6_cleanup: ok");

  console.log("smoke_graph_pass");
}

run()
  .then(async () => {
    await closeGraphClient();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error("smoke_graph_fail:", err?.stack || err?.message || String(err));
    await cleanup().catch(() => {});
    await closeGraphClient().catch(() => {});
    process.exit(1);
  });
