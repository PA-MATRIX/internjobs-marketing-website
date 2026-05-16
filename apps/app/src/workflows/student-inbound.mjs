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
//   8. Call LLM → returns generated body. In v1.2 (post 2026-05-16 swap)
//      this is a POST to the internjobs-ai-proxy Worker (/chat) using the
//      Workers AI binding. Without AI_WORKER_URL + AI_WORKER_SECRET (or
//      with LLM_PROVIDER=stub for tests) we synthesize a deterministic
//      canned draft so the rest of the pipeline stays exercised. Phase 06
//      canary validates the real LLM path.
//   9. Insert drafts row with status='pending_review', recipient_type='student',
//      channel='sms'. agent_metadata captures match_source, model, and a
//      compact prompt summary.
//  10. Mark inbound_messages.processed_at = now().
//  11. (Future) Append the student message + agent draft to a Mastra
//      thread via @mastra/memory. Skipped in v1.2 — see #6.
//
// HARD CONSTRAINT: This workflow MUST NOT send any outbound message. It
// writes to drafts and stops. Phase 05 owns send.

import { logEmbedErr } from "../embeddings.mjs";
import { buildConversationReplyTo } from "./reply-to.mjs";

// v1.2 2026-05-16 swap: chat completion now goes through the
// internjobs-ai-proxy Worker (Cloudflare Workers AI binding). The Node
// app never sees a CF API token; auth is the shared AI_WORKER_SECRET.
//
// Default model identifier flows through to drafts.agent_metadata.model.
// The proxy Worker pins the actual CF model name (@cf/meta/llama-3.1-8b-
// instruct); AGENT_MODEL is kept as a label override for traceability.
const DEFAULT_MODEL = process.env.AGENT_MODEL || "@cf/meta/llama-3.1-8b-instruct";
const LAST_N_MESSAGES = 20; // PITFALLS #19

/**
 * Execute one turn of the student inbound workflow.
 *
 * @param {object} deps
 * @param {import('pg').Pool} deps.pool   Postgres pool from PostgresStore.
 * @param {object}            [deps.llm]  Optional LLM stub used by tests.
 *                                         { complete: async ({prompt, model}) => string }.
 *                                         If omitted, the internjobs-ai-proxy
 *                                         Worker is called when AI_WORKER_URL
 *                                         + AI_WORKER_SECRET are set, else a
 *                                         canned-string stub is used.
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

  // 8. Call LLM (proxy Worker → Workers AI, test stub, or canned fallback).
  const generated = await runLLM({ llm, prompt, model: DEFAULT_MODEL });

  // 9. Insert drafts row. status='pending_review' — operator queue gate.
  //    agent_metadata captures provenance: match_source + model + a hash of
  //    the prompt for debugging without leaking PII.
  //
  // v1.2 EMAIL-03 (scope-add 2026-05-16): buildDraftAgentMetadata stamps
  // `reply_to = conv-{conversation_id}@internjobs.ai` whenever the draft
  // is for a startup recipient (so the CF Email Service payload carries
  // a per-conversation Reply-To and the inbound catch-all Worker can
  // route replies deterministically). This workflow only emits
  // recipient_type='student', so the stamp is a no-op for these rows —
  // the helper exists so future startup-drafting workflows pick up the
  // behavior for free.
  const recipientType = "student";
  const channel = "sms";
  const agentMetadata = buildDraftAgentMetadata({
    recipientType,
    conversationId: conversation.id,
    matchSource,
    model: generated.model,
    prompt,
    roleId: role.id,
    startupId: role.startup_id,
  });
  const { rows: draftRows } = await pool.query(
    `insert into drafts
       (conversation_id, inbound_message_id, recipient_type, channel,
        channel_address, body, status, agent_metadata)
     values ($1, $2, $3, $4, $5, $6, 'pending_review', $7)
     returning id`,
    [
      conversation.id,
      inbound.id,
      recipientType,
      channel,
      inbound.channel_address || "",
      generated.body,
      agentMetadata,
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

  // 2. Canned-stub mode (used by the Phase 04 smoke test). Active when:
  //    - LLM_PROVIDER=stub is set explicitly, OR
  //    - AI_WORKER_URL / AI_WORKER_SECRET are missing (no live proxy).
  //    This preserves the dev/test contract from the OpenAI era so nothing
  //    in the smoke suite needs a network egress.
  const aiUrl = process.env.AI_WORKER_URL;
  const aiSecret = process.env.AI_WORKER_SECRET;
  if (process.env.LLM_PROVIDER === "stub" || !aiUrl || !aiSecret) {
    return {
      body:
        "Hi! Thanks for reaching out — I'd love to chat about the role. " +
        "What's the best time to follow up?",
      model: "canned-stub",
    };
  }

  // 3. Real path: POST to the internjobs-ai-proxy Worker (Workers AI binding).
  //    Default provider name `workers-ai-proxy` is the swap-mode marker.
  try {
    const res = await fetch(`${aiUrl.replace(/\/$/, "")}/chat`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-ai-worker-secret": aiSecret,
      },
      body: JSON.stringify({
        messages: [
          { role: "system", content: "Draft concise SMS replies." },
          { role: "user", content: prompt },
        ],
        max_tokens: 200,
        temperature: 0.7,
      }),
    });
    if (!res.ok) {
      console.error(
        JSON.stringify({
          level: "error",
          message: "llm_call_non_2xx",
          status: res.status,
          model,
        }),
      );
      return {
        body: "(automated draft unavailable — operator review required)",
        model: model + "+error",
      };
    }
    const json = await res.json().catch(() => null);
    const body = typeof json?.response === "string" ? json.response : "";
    // Surface the actual model the proxy used (it may pin a newer version
    // than the env-provided label).
    return { body, model: json?.model || model };
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

// v1.2 EMAIL-03: shared metadata blob builder. Stamps `reply_to` whenever
// the draft is for a startup recipient, so any future workflow that emits
// recipient_type='startup' drafts gets the per-conversation Reply-To path
// for free. For student drafts the `reply_to` key is omitted to keep
// agent_metadata blobs lean.
export function buildDraftAgentMetadata({
  recipientType,
  conversationId,
  matchSource,
  model,
  prompt,
  roleId,
  startupId,
}) {
  const meta = {
    match_source: matchSource,
    model,
    promptCharCount: typeof prompt === "string" ? prompt.length : 0,
    roleId,
    startupId,
    lastN: LAST_N_MESSAGES,
    v: 1,
  };
  if (recipientType === "startup" && conversationId) {
    // Literal prefix `conv-` (single hyphen separator) + full UUID with
    // hyphens. Lowercased. Parsed by apps/email-worker/src/index.js on
    // inbound replies.
    const replyTo = buildConversationReplyTo(conversationId);
    if (replyTo) meta.reply_to = replyTo;
  }
  return meta;
}

// re-export for convenience: callers that don't want to import a workflow
// instance can fire embedding writes themselves with the same error logger.
export { logEmbedErr };
