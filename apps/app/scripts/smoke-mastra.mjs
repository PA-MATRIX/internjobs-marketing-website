// ─── Phase 04 workflow smoke test ────────────────────────────────────────────
//
// Exercises the v1.2 Phase 04 contract end-to-end against a real Postgres
// (any branch with migrations 0001..0004 applied). Runs in two modes:
//
//   Default (no AI_WORKER_URL + AI_WORKER_SECRET set):
//     LLM_PROVIDER=stub + EMBED_PROVIDER=stub — workflow uses canned strings
//     for both embedding vectors and the draft body. No external calls.
//     This is the mode we run in CI / pre-deploy.
//
//   With AI_WORKER_URL + AI_WORKER_SECRET set:
//     Real Cloudflare Workers AI calls via the internjobs-ai-proxy Worker.
//     Used to validate the hot path before deploying. Not the default
//     (Workers AI has free-tier quotas but we still don't burn them in CI).
//
// Required env:
//   SMOKE_DATABASE_URL — separate from DATABASE_URL so the smoke test never
//     touches prod by accident. Point at a local Postgres or a Neon dev
//     branch. The schema must have migrations 0001..0004 applied.
//
// What it verifies:
//   1. writeInboundMessage inserts an inbound_messages row.
//   2. runStudentInboundWorkflow consumes the row.
//   3. A drafts row appears with status='pending_review' AND recipient_type
//      ='student' AND channel='sms'.
//   4. NO outbound was sent (no messaging_events row with direction=
//      'outbound' tied to this run).
//   5. inbound_messages.processed_at gets stamped.
//   6. agent_metadata.match_source is one of 'vector' / 'keyword' / 'none'.
//   7. (Bonus) With USE_VECTOR_MATCH=true + EMBED_PROVIDER=stub, vector path
//      is exercised — match_source='vector'.
//
// What it does NOT verify (deferred to Phase 06 canary):
//   • Real Workers AI token consumption stays under budget.
//   • 20-concurrent-inbound load profile (Mastra OOM check from PITFALLS #2).
//
// Run:
//   SMOKE_DATABASE_URL='postgres://postgres:test@localhost:55432/ijtest?sslmode=disable' \
//     node apps/app/scripts/smoke-mastra.mjs

import pg from "pg";
import { randomUUID } from "node:crypto";
import { writeStudentEmbedding, writeRoleEmbedding } from "../src/embeddings.mjs";
import { runStudentInboundWorkflow } from "../src/workflows/student-inbound.mjs";

const databaseUrl = process.env.SMOKE_DATABASE_URL || process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("SMOKE_DATABASE_URL (or DATABASE_URL) is required.");
  process.exit(1);
}

// Force stub mode unless the operator has set up the Workers AI proxy and
// explicitly opts in (both AI_WORKER_URL + AI_WORKER_SECRET present).
// This keeps the smoke suite hermetic by default.
if (!process.env.AI_WORKER_URL || !process.env.AI_WORKER_SECRET) {
  process.env.LLM_PROVIDER = "stub";
  process.env.EMBED_PROVIDER = "stub";
}

const { Pool } = pg;
const pool = new Pool({
  connectionString: databaseUrl,
  ssl: databaseUrl.includes("sslmode=disable") ? false : { rejectUnauthorized: false },
});

const SMOKE_TAG = `smoke-mastra-${randomUUID()}`; // tags rows for cleanup

let failures = 0;
function assert(cond, msg) {
  if (cond) {
    console.log("  ok  " + msg);
  } else {
    console.error("  FAIL " + msg);
    failures += 1;
  }
}

async function main() {
  console.log(`\n[smoke-mastra] starting with tag=${SMOKE_TAG}\n`);

  // ─── Seed: student + active role from a startup ────────────────────────────
  // Use the suffix-randomized clerk id so this stays unique even on a DB
  // that already has data from prior runs / other tests.
  const clerkUserId = `clerk-${SMOKE_TAG}`;
  const phoneNumber = `+1555${Math.floor(1000000 + Math.random() * 9000000)}`;

  const { rows: [student] } = await pool.query(
    `insert into students
       (clerk_user_id, email, name, linkedin_profile_url, status,
        channel_type, channel_address, channel_confirmed_at)
     values
       ($1, $2, 'Smoke Tester', '', 'channel_confirmed', 'sms', $3, now())
     returning *`,
    [clerkUserId, `${clerkUserId}@example.test`, phoneNumber],
  );
  console.log(`[smoke-mastra] seeded student id=${student.id} phone=${phoneNumber}`);

  // Profile context — drives the keyword match and feeds the embedding.
  await pool.query(
    `insert into student_profile_context
       (student_id, interests, projects, preferred_work, notes)
     values ($1, $2, $3, $4, $5)
     on conflict (student_id) do update set
       interests = excluded.interests,
       projects = excluded.projects,
       preferred_work = excluded.preferred_work,
       notes = excluded.notes`,
    [
      student.id,
      ["javascript", "react", "growth"],
      "Built a startup waitlist that hit 5k signups",
      "growth engineering",
      "remote preferred, open to NYC",
    ],
  );

  // Startup + active role.
  const { rows: [startup] } = await pool.query(
    `insert into startups (name, website, status)
     values ($1, $2, 'active') returning *`,
    [`Smoke Startup ${SMOKE_TAG}`, "https://example.test"],
  );
  const { rows: [role] } = await pool.query(
    `insert into roles
       (startup_id, title, description, requirements, status, location, comp_range)
     values ($1, 'Growth Engineer', 'Build growth tools in javascript and react.',
             'Strong react + growth engineering background.', 'active',
             'Remote / NYC', '120k-160k')
     returning *`,
    [startup.id],
  );
  console.log(`[smoke-mastra] seeded startup id=${startup.id} role id=${role.id}`);

  // ─── Scenario A: keyword match (USE_VECTOR_MATCH unset) ────────────────────
  console.log("\n[smoke-mastra] scenario A — keyword match");
  process.env.USE_VECTOR_MATCH = "false";
  await runOneScenario({ student, role, expectedMatchSource: "keyword", label: "A" });

  // ─── Scenario B: vector path on, but no student embedding → fallback ──────
  console.log("\n[smoke-mastra] scenario B — vector flag on, no embedding (fallback to keyword)");
  process.env.USE_VECTOR_MATCH = "true";
  await runOneScenario({ student, role, expectedMatchSource: "keyword", label: "B" });

  // ─── Scenario C: vector path with embeddings present ──────────────────────
  console.log("\n[smoke-mastra] scenario C — vector flag on, embeddings present");
  // Embed both student and role with the stub provider — same input yields
  // the same vector so the cosine query is deterministic.
  await writeStudentEmbedding(pool, student.id, "javascript react growth engineering");
  await writeRoleEmbedding(pool, role.id, "Growth Engineer javascript react growth engineering");
  await runOneScenario({ student, role, expectedMatchSource: "vector", label: "C" });

  // ─── Hard constraint check: NO outbound was sent during ANY scenario ─────
  const { rows: outboundRows } = await pool.query(
    `select count(*)::int as n from messaging_events
      where direction = 'outbound' and student_id = $1
        and event_type in ('sms_sent', 'welcome_message')
        and created_at > now() - interval '60 seconds'`,
    [student.id],
  );
  assert(outboundRows[0].n === 0, "no outbound messaging_events from Phase 04 code path");

  // ─── Cleanup ──────────────────────────────────────────────────────────────
  await pool.query(`delete from drafts where conversation_id in (select id from conversations where student_id=$1)`, [student.id]);
  await pool.query(`delete from conversations where student_id=$1`, [student.id]);
  await pool.query(`delete from inbound_messages where student_id=$1`, [student.id]);
  await pool.query(`delete from audit_events where student_id=$1`, [student.id]);
  await pool.query(`delete from student_profile_context where student_id=$1`, [student.id]);
  await pool.query(`delete from student_embeddings where student_id=$1`, [student.id]);
  await pool.query(`delete from role_embeddings where role_id=$1`, [role.id]);
  await pool.query(`delete from roles where id=$1`, [role.id]);
  await pool.query(`delete from startups where id=$1`, [startup.id]);
  await pool.query(`delete from students where id=$1`, [student.id]);

  console.log(`\n[smoke-mastra] done; failures=${failures}`);
  await pool.end();
  process.exit(failures === 0 ? 0 : 1);
}

async function runOneScenario({ student, role, expectedMatchSource, label }) {
  // 1. Simulate the Spectrum handler's writeInboundMessage call.
  const providerEventId = `smoke:${label}:${randomUUID()}`;
  const { rows: [inserted] } = await pool.query(
    `insert into inbound_messages
       (provider, provider_event_id, channel_type, channel_address,
        student_id, body, metadata)
     values ('spectrum', $1, 'sms', $2, $3,
             'Hey! I saw you posted a growth engineering role. Can you tell me more?', '{}'::jsonb)
     returning id`,
    [providerEventId, student.channel_address, student.id],
  );
  const messageId = inserted.id;

  // 2. Run the workflow.
  const result = await runStudentInboundWorkflow({ pool, messageId });

  // 3. Verify draft row.
  assert(result.draftId, `[${label}] draftId returned`);
  assert(result.conversationId, `[${label}] conversationId returned`);
  assert(
    result.matchSource === expectedMatchSource,
    `[${label}] match_source=${result.matchSource} (expected ${expectedMatchSource})`,
  );

  const { rows: [draft] } = await pool.query(
    `select id, status, recipient_type, channel, channel_address, body, agent_metadata
       from drafts where id=$1`,
    [result.draftId],
  );
  assert(draft.status === "pending_review", `[${label}] draft.status='pending_review'`);
  assert(draft.recipient_type === "student", `[${label}] draft.recipient_type='student'`);
  assert(draft.channel === "sms", `[${label}] draft.channel='sms'`);
  assert(draft.channel_address === student.channel_address, `[${label}] draft.channel_address matches`);
  assert(typeof draft.body === "string" && draft.body.length > 0, `[${label}] draft.body non-empty`);
  assert(
    draft.agent_metadata?.match_source === expectedMatchSource,
    `[${label}] agent_metadata.match_source=${draft.agent_metadata?.match_source}`,
  );

  // 4. inbound_messages row is marked processed.
  const { rows: [inb] } = await pool.query(
    `select processed_at from inbound_messages where id=$1`,
    [messageId],
  );
  assert(inb.processed_at !== null, `[${label}] inbound.processed_at stamped`);

  // 5. Workflow audit event recorded.
  const { rows: auditRows } = await pool.query(
    `select event_type from audit_events
      where student_id=$1 and event_type='student_inbound_drafted'
        and metadata->>'draftId' = $2
      limit 1`,
    [student.id, result.draftId],
  );
  assert(auditRows.length === 1, `[${label}] audit_events row 'student_inbound_drafted' written`);
}

main().catch(async (err) => {
  console.error("[smoke-mastra] crashed:", err?.stack || err);
  await pool.end().catch(() => {});
  process.exit(1);
});
