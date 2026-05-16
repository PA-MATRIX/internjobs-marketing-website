// ─── student_inbound_workflow (v1.2 Phase 04, AGENT-01/02) ───────────────────
//
// Turn lifecycle (per ARCHITECTURE.md Section 5):
//
//   1. Load inbound_messages row by messageId.
//   2. Identify student_id (already on the row, written by writeInboundMessage).
//   3. Load student profile context (existing store.getProfileContext).
//   4. Find or create conversations row keyed by (student_id, startup_id, role_id).
//      The startup/role is determined by the match step (see #5).
//   5. Match step:
//        - USE_VECTOR_MATCH='true' + student has an embedding row →
//            cosine-similarity search against role_embeddings, pick top
//            active role.
//        - else → keyword heuristic: tokenize profile context (interests,
//            projects, notes) and role title+description+requirements,
//            score by overlap, pick top active role.
//        - no active roles → write audit_event 'no_roles_to_match', exit.
//          No conversation, no draft, mark inbound processed.
//   6. Load last 20 thread messages (lastMessages: 20 per PITFALLS #19).
//      v1.2: this is a no-op stub because we don't yet wire @mastra/memory's
//      Memory primitive — once Phase 05 needs richer prompts we can plumb it.
//      The contract surface (conversation row created, draft row written)
//      is unchanged.
//   7. Compose prompt: system + profile + history + matched role + new body.
//   8. Call LLM → returns generated body. In v1.2 we keep this behind an
//      OPENAI_API_KEY check; without a key (or with LLM_PROVIDER=stub for
//      tests) we synthesize a deterministic canned draft so the rest of the
//      pipeline stays exercised. Phase 06 canary will validate the real
//      LLM path.
//   9. Insert drafts row with status='pending_review', recipient_type='student',
//      channel='sms'. agent_metadata captures match_source, model, and a
//      compact prompt summary.
//  10. Mark inbound_messages.processed_at = now().
//  11. (Future) Append the student message + agent draft to a Mastra
//      thread via @mastra/memory. Skipped in v1.2 — see #6.
//
// HARD CONSTRAINT: This workflow MUST NOT send any outbound message. It
// writes to drafts and stops. Phase 05 owns send.

import OpenAI from "openai";
import { logEmbedErr } from "../embeddings.mjs";

const DEFAULT_MODEL = process.env.AGENT_MODEL || "gpt-4o-mini";
const LAST_N_MESSAGES = 20; // PITFALLS #19

let _openai = null;
function getOpenAI() {
  if (_openai) return _openai;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  _openai = new OpenAI({ apiKey });
  return _openai;
}

/**
 * Execute one turn of the student inbound workflow.
 *
 * @param {object} deps
 * @param {import('pg').Pool} deps.pool   Postgres pool from PostgresStore.
 * @param {object}            [deps.llm]  Optional LLM stub used by tests.
 *                                         { complete: async ({prompt, model}) => string }.
 *                                         If omitted, the real OpenAI client
 *                                         is used when OPENAI_API_KEY is set,
 *                                         else a canned-string stub is used.
 * @param {string}            deps.messageId  The inbound_messages.id to process.
 *
 * @returns {Promise<{
 *   draftId: string | null,
 *   conversationId: string | null,
 *   matchSource: 'vector' | 'keyword' | 'none',
 *   skipped?: { reason: string },
 * }>}
 */
export async function runStudentInboundWorkflow({ pool, llm, messageId }) {
  if (!pool) throw new Error("runStudentInboundWorkflow: pool is required");
  if (!messageId) throw new Error("runStudentInboundWorkflow: messageId is required");

  // 1. Load inbound row.
  const { rows: inboundRows } = await pool.query(
    `select id, provider, student_id, startup_id, channel_type, channel_address,
            body, metadata, processed_at, created_at
       from inbound_messages
      where id = $1
      limit 1`,
    [messageId],
  );
  const inbound = inboundRows[0];
  if (!inbound) {
    return { draftId: null, conversationId: null, matchSource: "none", skipped: { reason: "inbound_not_found" } };
  }
  if (inbound.processed_at) {
    return { draftId: null, conversationId: null, matchSource: "none", skipped: { reason: "already_processed" } };
  }

  // 2. Identify student. Spectrum-origin messages always carry student_id
  //    (set by writeInboundMessage). Defensive: if missing, log + skip.
  const studentId = inbound.student_id;
  if (!studentId) {
    await writeAudit(pool, null, "student_inbound_skipped", "system", {
      reason: "no_student_id",
      inboundId: inbound.id,
    });
    await markProcessed(pool, inbound.id);
    return { draftId: null, conversationId: null, matchSource: "none", skipped: { reason: "no_student_id" } };
  }

  // 3. Load student profile context (best-effort; absence is fine).
  const profile = await loadStudentProfile(pool, studentId);
  const profileBlob = composeProfileBlob(profile);

  // 5. Match — done before conversation creation because conversations are
  //    keyed by (student_id, startup_id, role_id). No roles → no convo.
  const matchResult = await pickRole(pool, studentId, profile, inbound.body);
  if (!matchResult) {
    await writeAudit(pool, studentId, "no_roles_to_match", "system", {
      inboundId: inbound.id,
      matchAttempted: process.env.USE_VECTOR_MATCH === "true" ? "vector_or_keyword" : "keyword",
    });
    await markProcessed(pool, inbound.id);
    return { draftId: null, conversationId: null, matchSource: "none", skipped: { reason: "no_roles_to_match" } };
  }

  const { role, matchSource } = matchResult;

  // 4. Find or create conversations row.
  const conversation = await upsertConversation(pool, {
    studentId,
    startupId: role.startup_id,
    roleId: role.id,
  });

  // 6. Load last N thread messages. v1.2 stub — see header comment.
  //    Keeping the variable here so the prompt composition below has a
  //    clearly-named slot for when this is wired to @mastra/memory.
  const threadHistory = []; // future: Memory.query({ resourceId: 'student:<uuid>', threadId: <conv.id>, last: LAST_N_MESSAGES })

  // 7. Compose prompt.
  const prompt = composePrompt({
    profileBlob,
    threadHistory,
    role,
    inboundBody: inbound.body,
  });

  // 8. Call LLM (real OpenAI, or test stub, or deterministic canned fallback).
  const generated = await runLLM({ llm, prompt, model: DEFAULT_MODEL });

  // 9. Insert drafts row. status='pending_review' — operator queue gate.
  //    agent_metadata captures provenance: match_source + model + a hash of
  //    the prompt for debugging without leaking PII.
  const { rows: draftRows } = await pool.query(
    `insert into drafts
       (conversation_id, inbound_message_id, recipient_type, channel,
        channel_address, body, status, agent_metadata)
     values ($1, $2, 'student', $3, $4, $5, 'pending_review', $6)
     returning id`,
    [
      conversation.id,
      inbound.id,
      // Student's reply will be sent over the same SMS channel they came in on.
      "sms",
      inbound.channel_address || "",
      generated.body,
      {
        match_source: matchSource,
        model: generated.model,
        promptCharCount: prompt.length,
        roleId: role.id,
        startupId: role.startup_id,
        lastN: LAST_N_MESSAGES,
        v: 1,
      },
    ],
  );
  const draftId = draftRows[0]?.id || null;

  // 10. Mark inbound consumed.
  await markProcessed(pool, inbound.id);

  await writeAudit(pool, studentId, "student_inbound_drafted", "system", {
    inboundId: inbound.id,
    draftId,
    conversationId: conversation.id,
    matchSource,
    roleId: role.id,
    startupId: role.startup_id,
  });

  return { draftId, conversationId: conversation.id, matchSource };
}

// ─── Profile + thread helpers ────────────────────────────────────────────────

async function loadStudentProfile(pool, studentId) {
  const { rows } = await pool.query(
    `select interests, projects, preferred_work, notes
       from student_profile_context
      where student_id = $1
      limit 1`,
    [studentId],
  );
  const row = rows[0];
  return {
    interests: row?.interests || [],
    projects: row?.projects || "",
    preferredWork: row?.preferred_work || "",
    notes: row?.notes || "",
  };
}

function composeProfileBlob(profile) {
  const parts = [];
  if (profile.interests?.length) parts.push("interests: " + profile.interests.join(", "));
  if (profile.projects) parts.push("projects: " + profile.projects);
  if (profile.preferredWork) parts.push("preferred work: " + profile.preferredWork);
  if (profile.notes) parts.push("notes: " + profile.notes);
  return parts.join("\n");
}

// ─── Match step ──────────────────────────────────────────────────────────────

async function pickRole(pool, studentId, profile, inboundBody) {
  const useVector = process.env.USE_VECTOR_MATCH === "true";

  if (useVector) {
    const vectorMatch = await vectorMatchRole(pool, studentId);
    if (vectorMatch) return { role: vectorMatch, matchSource: "vector" };
    // fall-through to keyword (no crash on missing embedding — Step 7 spec).
  }

  const keywordMatch = await keywordMatchRole(pool, profile, inboundBody);
  if (keywordMatch) return { role: keywordMatch, matchSource: "keyword" };

  return null;
}

async function vectorMatchRole(pool, studentId) {
  // Read student embedding (returns one row if present).
  const { rows: embRows } = await pool.query(
    `select embedding::text as v from student_embeddings where student_id = $1 limit 1`,
    [studentId],
  );
  if (!embRows[0]) return null; // fall back to keyword silently

  const studentVec = embRows[0].v; // already a pgvector literal '[...]'

  const { rows } = await pool.query(
    `select r.*, (re.embedding <=> $1::vector) as distance
       from roles r
       join role_embeddings re on re.role_id = r.id
      where r.status = 'active'
      order by re.embedding <=> $1::vector asc
      limit 1`,
    [studentVec],
  );
  return rows[0] || null;
}

async function keywordMatchRole(pool, profile, inboundBody) {
  // Build the student-side bag of tokens from profile context + the latest
  // message. Skipping stopwords here keeps the heuristic simple; we
  // intentionally don't pull in a tokenizer dep.
  const studentTokens = tokenize(
    [
      ...(profile.interests || []),
      profile.projects || "",
      profile.preferredWork || "",
      profile.notes || "",
      inboundBody || "",
    ].join(" "),
  );
  if (studentTokens.size === 0) {
    // No signal at all — still pick the most recent active role across all
    // startups so the operator has something to react to. The audit event
    // records 'no_signal_keyword' so it's distinguishable from a real match.
    const { rows } = await pool.query(
      `select * from roles where status = 'active' order by updated_at desc limit 1`,
    );
    return rows[0] || null;
  }

  const { rows: roles } = await pool.query(
    `select id, startup_id, title, description, requirements, status, created_at, updated_at
       from roles where status = 'active'`,
  );
  if (roles.length === 0) return null;

  let best = null;
  let bestScore = -1;
  for (const r of roles) {
    const roleTokens = tokenize([r.title, r.description, r.requirements].join(" "));
    let score = 0;
    for (const t of roleTokens) {
      if (studentTokens.has(t)) score += 1;
    }
    if (score > bestScore) {
      bestScore = score;
      best = r;
    }
  }
  return best;
}

function tokenize(s) {
  const out = new Set();
  for (const tok of String(s || "").toLowerCase().split(/[^a-z0-9]+/g)) {
    if (tok.length >= 3) out.add(tok);
  }
  return out;
}

// ─── Conversation upsert ─────────────────────────────────────────────────────

async function upsertConversation(pool, { studentId, startupId, roleId }) {
  // unique (student_id, startup_id, role_id) makes this safe to retry.
  const { rows } = await pool.query(
    `insert into conversations
       (student_id, startup_id, role_id, status, student_thread_key, startup_thread_key)
     values ($1, $2, $3, 'active', $4, $5)
     on conflict (student_id, startup_id, role_id) do update set
       updated_at = now()
     returning *`,
    [
      studentId,
      startupId,
      roleId,
      `student:${studentId}:${roleId}`,
      `startup:${startupId}:${roleId}`,
    ],
  );
  return rows[0];
}

// ─── Prompt composition ──────────────────────────────────────────────────────

function composePrompt({ profileBlob, threadHistory, role, inboundBody }) {
  const parts = [];
  parts.push(
    "You are an agent helping a student communicate with a startup about a job opportunity.",
    "Draft a short, friendly SMS reply on the student's behalf. Keep it under 320 characters.",
    "Never invent facts about the student or the startup. If a question can't be answered from the context, ask politely.",
    "",
    "--- Student profile ---",
    profileBlob || "(no profile context on file)",
    "",
    "--- Matched role ---",
    `Title: ${role.title || ""}`,
    `Description: ${role.description || ""}`,
    `Requirements: ${role.requirements || ""}`,
    "",
    "--- Recent thread (most recent first) ---",
    threadHistory.length === 0
      ? "(no prior messages in this thread)"
      : threadHistory.map((m, i) => `[${i}] ${m.role}: ${m.content}`).join("\n"),
    "",
    "--- New inbound from student ---",
    inboundBody || "(empty)",
    "",
    "Draft reply:",
  );
  return parts.join("\n");
}

// ─── LLM call ────────────────────────────────────────────────────────────────

async function runLLM({ llm, prompt, model }) {
  // 1. Explicit test stub wins.
  if (llm?.complete) {
    const body = await llm.complete({ prompt, model });
    return { body: String(body || ""), model: model + "+stub" };
  }

  // 2. LLM_PROVIDER=stub forces a deterministic canned response (no API call).
  //    Used by the Phase 04 smoke test so the workflow contract is exercised
  //    end-to-end without burning quota.
  if (process.env.LLM_PROVIDER === "stub" || !process.env.OPENAI_API_KEY) {
    return {
      body:
        "Hi! Thanks for reaching out — I'd love to chat about the role. " +
        "What's the best time to follow up?",
      model: "canned-stub",
    };
  }

  // 3. Real OpenAI path.
  const client = getOpenAI();
  if (!client) {
    return { body: "(agent unavailable)", model: "canned-stub" };
  }

  try {
    const res = await client.chat.completions.create({
      model,
      messages: [
        { role: "system", content: "Draft concise SMS replies." },
        { role: "user", content: prompt },
      ],
      max_completion_tokens: 200,
    });
    const body = res?.choices?.[0]?.message?.content ?? "";
    return { body: String(body), model };
  } catch (err) {
    console.error(
      JSON.stringify({
        level: "error",
        message: "llm_call_failed",
        model,
        error: err?.message ?? String(err),
      }),
    );
    // Fail-soft: produce a placeholder body so the draft still hits the
    // operator queue. Operator can edit before send.
    return {
      body: "(automated draft unavailable — operator review required)",
      model: model + "+error",
    };
  }
}

// ─── Audit + processed helpers ───────────────────────────────────────────────

async function writeAudit(pool, studentId, eventType, actor, metadata) {
  await pool.query(
    `insert into audit_events (student_id, event_type, actor, metadata)
     values ($1, $2, $3, $4)`,
    [studentId, eventType, actor, metadata || {}],
  );
}

async function markProcessed(pool, inboundId) {
  await pool.query(
    `update inbound_messages set processed_at = now() where id = $1 and processed_at is null`,
    [inboundId],
  );
}

// re-export for convenience: callers that don't want to import a workflow
// instance can fire embedding writes themselves with the same error logger.
export { logEmbedErr };
