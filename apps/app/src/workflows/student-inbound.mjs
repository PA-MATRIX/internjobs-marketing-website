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
//      The system prompt includes baseline safety guardrails (no legal/
//      financial promises, no PII about other parties, polite refusal of
//      illegal asks). v1.3 will add Lakera Guard pre-LLM screening.
//   8. Call LLM → returns generated body. In v1.2 (post 2026-05-16
//      tear-out) this is a direct POST to the Cloudflare Workers AI REST
//      API. Without CLOUDFLARE_AI_ACCOUNT_ID + CLOUDFLARE_AI_API_TOKEN
//      (or with LLM_PROVIDER=stub for tests) we synthesize a deterministic
//      canned draft so the rest of the pipeline stays exercised.
//   9. Insert drafts row with status='sent' (or 'failed'), recipient_type='student',
//      channel='sms'. agent_metadata captures match_source, model, and a
//      compact prompt summary. Autonomy pivot (2026-05-17): drafts go
//      straight to 'sent' after the autonomous send succeeds; the prior
//      'pending_review' default is gone.
//  10. Autonomously send via outbound.routeAndSend(). Wrap in try/catch so
//      a send failure does not crash the workflow. On success: flip status
//      to 'sent', set sent_at + provider_message_id. On failure: flip to
//      'failed', write audit_events 'auto_send_failed' with the error.
//  11. Mark inbound_messages.processed_at = now().
//
// HISTORICAL NOTE (2026-05-17 pivot): this workflow USED to write
// status='pending_review' and stop — a human operator approved each draft
// via /ops/drafts before send. That gate is gone. The agent now sends
// autonomously on both student SMS and (future) startup email sides.
// /ops/drafts is now a read-only audit log; operators can flag bad
// messages post-hoc for prompt-tuning review. Rationale: turn-by-turn
// approval latency made conversational UX impossibly slow.

import { logEmbedErr } from "../embeddings.mjs";
import { buildConversationReplyTo } from "./reply-to.mjs";
import { routeAndSend } from "../outbound.mjs";
import { getStudentSummary, recordFact, PREDICATES } from "../memory/graph.mjs";

// v1.2 2026-05-16 tear-out: chat completion now goes DIRECTLY to the
// Cloudflare Workers AI REST API (no proxy Worker, no AI Gateway). The
// Fly Node app holds a CLOUDFLARE_AI_API_TOKEN scoped for Workers AI.
//
// 2026-05-17 voice-upgrade (AGENT-VOICE): model bumped from Llama 3.1 8B
// to Llama 3.3 70B fp8-fast for conversational quality. fp8-fast is the
// cost-optimized 70B variant on Workers AI (8-bit quantized, fast-path
// inference). Live-probed reachable on this account 2026-05-17 against
// account 0fffd3dc637bdb26d4963df445a69fd3. If fp8-fast ever drops off
// the catalog for this account, fall back to @cf/meta/llama-3.1-70b-instruct
// (also live-probed reachable 2026-05-17). The non-fast `llama-3.3-70b-instruct`
// returned "No route for that URI" on this account so it is NOT a fallback.
// Embedding model stays @cf/baai/bge-base-en-v1.5 (768-dim) — pgvector tables
// are locked at vector(768) by migration 0005.
//
// Default model identifier flows through to drafts.agent_metadata.model.
// AGENT_MODEL is kept as an env override for traceability / future model
// swaps without code changes.
const DEFAULT_MODEL = process.env.AGENT_MODEL || "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const LAST_N_MESSAGES = 20; // PITFALLS #19

/**
 * Execute one turn of the student inbound workflow.
 *
 * @param {object} deps
 * @param {import('pg').Pool} deps.pool   Postgres pool from PostgresStore.
 * @param {object}            [deps.llm]  Optional LLM stub used by tests.
 *                                         { complete: async ({prompt, model}) => string }.
 *                                         If omitted, Workers AI REST is
 *                                         called when CLOUDFLARE_AI_ACCOUNT_ID
 *                                         + CLOUDFLARE_AI_API_TOKEN are set,
 *                                         else a canned-string stub is used.
 * @param {string}            deps.messageId  The inbound_messages.id to process.
 * @param {object}            [deps.smsProvider]  Phase 01 SMS provider (e.g.
 *                                                Spectrum) used for autonomous
 *                                                send. When omitted the
 *                                                workflow still drafts but
 *                                                marks the draft 'failed' with
 *                                                event_type='auto_send_failed'
 *                                                + reason='no_sms_provider'.
 * @param {object}            [deps.config]     App config blob for outbound
 *                                                routing (Spectrum + CF Email
 *                                                Service creds + outboundDryRun
 *                                                flag for the smoke suite).
 *
 * @returns {Promise<{
 *   draftId: string | null,
 *   conversationId: string | null,
 *   matchSource: 'vector' | 'keyword' | 'none',
 *   sent?: boolean,
 *   skipped?: { reason: string },
 * }>}
 */
export async function runStudentInboundWorkflow({ pool, llm, messageId, smsProvider, config, sender }) {
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
  //    Also pulls students.name + the latest profile_snapshots.display_name
  //    + the stored LinkedIn URL so the first-contact prompt can address
  //    the candidate by name and carry the identity URL even before
  //    provider enrichment finishes.
  const profile = await loadStudentProfile(pool, studentId);
  const profileBlob = composeProfileBlob(profile);

  // 3b. v1.2 MEMORY-01: graph-memory recall. Pull a per-student summary
  //     from the self-hosted FalkorDB instance (cross-conversation, multi-
  //     day recall). Fail-soft: if FALKORDB_URL is unset or the DB is
  //     down, getStudentSummary returns an empty string and the prompt
  //     omits the WHAT YOU REMEMBER section entirely. The agent then
  //     operates in degraded mode (no cross-conversation recall) but the
  //     turn still completes. This is the recall that makes lines like
  //     "hey raj. been a minute — how'd the valon thing land?" possible.
  let graphSummary = "";
  try {
    graphSummary = await getStudentSummary(studentId);
  } catch (err) {
    console.error(
      JSON.stringify({
        level: "error",
        message: "graph_summary_failed",
        studentId,
        error: err?.message ?? String(err),
      }),
    );
  }

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

  // 6b. v1.2 Phase 09 — first-contact detection. Zero prior sent drafts on
  //     this conversation = the agent hasn't replied yet, so this turn is
  //     the FIRST contact. We route the prompt through composeFirstContactPrompt
  //     which prepends first-message instructions and embeds the structured
  //     LinkedIn block from linkedin_profiles when available. If enrichment
  //     has not finished yet, the prompt still carries the stored LinkedIn
  //     URL and explicitly tells the model not to invent details.
  const priorOutbound = await countPriorOutbound(pool, conversation.id);
  const isFirstContact = priorOutbound === 0;
  const linkedinBlock = composeLinkedInBlock(profile.linkedin);

  // 7. Compose prompt.
  const prompt = isFirstContact
    ? composeFirstContactPrompt({
        profileBlob,
        linkedinBlock,
        role,
        inboundBody: inbound.body,
      })
    : composePrompt({
        profileBlob,
        graphSummary,
        threadHistory,
        role,
        inboundBody: inbound.body,
      });

  // 8. Call LLM (proxy Worker → Workers AI, test stub, or canned fallback).
  const generated = await runLLM({ llm, prompt, model: DEFAULT_MODEL });

  // 9. Insert drafts row. Autonomy pivot (2026-05-17): rows are written
  //    directly with status='sent' after the autonomous send succeeds
  //    (or 'failed' if it threw). To avoid two writes for the happy path
  //    we INSERT with the transient 'sending' status, then UPDATE to
  //    'sent'/'failed' after routeAndSend resolves. The 'sending' state is
  //    sub-second under normal latency; operators viewing /ops/drafts mid-
  //    flight see it as a status badge ("in-flight"). Rows that get stuck
  //    in 'sending' (process crash between INSERT and UPDATE) are a
  //    self-evident audit signal.
  //
  //    agent_metadata captures provenance: match_source + model + a hash of
  //    the prompt for debugging without leaking PII.
  //
  // v1.2 EMAIL-03 (scope-add 2026-05-16, subdomain update same-day):
  // buildDraftAgentMetadata stamps
  // `reply_to = conv-{conversation_id}@agent.internjobs.ai` whenever the
  // draft is for a startup recipient (so the CF Email Service payload
  // carries a per-conversation Reply-To and the inbound catch-all Worker
  // bound to the `agent.internjobs.ai` subdomain can route replies
  // deterministically). This workflow only emits recipient_type='student',
  // so the stamp is a no-op for these rows — the helper exists so future
  // startup-drafting workflows pick up the behavior for free.
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
  // v1.2 Phase 09: stamp first-contact + LinkedIn-presence flags so /ops/drafts
  // can show a "first contact" badge and ops can audit whether the LinkedIn
  // enrichment landed in time for the first message.
  agentMetadata.first_contact = isFirstContact;
  agentMetadata.linkedin_present = Boolean(profile.linkedin);
  const channelAddress = inbound.channel_address || "";
  const { rows: draftRows } = await pool.query(
    `insert into drafts
       (conversation_id, inbound_message_id, recipient_type, channel,
        channel_address, body, status, agent_metadata)
     values ($1, $2, $3, $4, $5, $6, 'sending', $7)
     returning id`,
    [
      conversation.id,
      inbound.id,
      recipientType,
      channel,
      channelAddress,
      generated.body,
      agentMetadata,
    ],
  );
  const draftId = draftRows[0]?.id || null;

  await writeAudit(pool, studentId, "student_inbound_drafted", "system", {
    inboundId: inbound.id,
    draftId,
    conversationId: conversation.id,
    matchSource,
    roleId: role.id,
    startupId: role.startup_id,
  });

  // 10. Autonomously send. Wrap in try/catch — a send failure flips the
  //     draft to 'failed' and writes an audit_events row, but never crashes
  //     the workflow. (Auto-retry is v1.3.)
  //
  //     When `sender` is provided (e.g. by the spectrum listener supplying
  //     a callback that uses message.reply(text(...)) inside
  //     space.responding(...)), we use IT for the actual send instead of
  //     the routeAndSend → phantom REST path. The sender returns a
  //     providerMessageId string (or null). This is the canonical path
  //     for iMessage on spectrum-ts: blue bubble, typing indicator,
  //     read receipts.
  let sent = false;
  try {
    let providerMessageId = null;
    if (typeof sender === "function") {
      providerMessageId = await sender(generated.body, {
        draftId,
        channel,
        channelAddress,
      });
    } else {
      const sendDraft = {
        id: draftId,
        channel,
        channel_address: channelAddress,
        body: generated.body,
        agent_metadata: agentMetadata,
      };
      providerMessageId = await routeAndSend(sendDraft, {
        smsProvider,
        config: config || {},
      });
    }
    await pool.query(
      `update drafts
          set status = 'sent',
              sent_at = now(),
              provider_message_id = $2,
              updated_at = now()
        where id = $1`,
      [draftId, providerMessageId],
    );
    sent = true;
    await writeAudit(pool, studentId, "student_inbound_auto_sent", "agent", {
      draftId,
      conversationId: conversation.id,
      providerMessageId: providerMessageId || null,
      channel,
    });
  } catch (sendErr) {
    const errMsg = sendErr?.message || String(sendErr);
    await pool.query(
      `update drafts
          set status = 'failed',
              updated_at = now(),
              agent_metadata = coalesce(agent_metadata, '{}'::jsonb)
                                || jsonb_build_object('send_error', $2::text)
        where id = $1`,
      [draftId, errMsg.slice(0, 500)],
    );
    await writeAudit(pool, studentId, "auto_send_failed", "agent", {
      draftId,
      conversationId: conversation.id,
      channel,
      error: errMsg.slice(0, 500),
    });
    // Log but don't rethrow — fire-and-forget caller in server.mjs would
    // log a workflow_failed too, which is noisier than necessary for the
    // expected "send threw, draft is marked failed" path.
    console.error(
      JSON.stringify({
        level: "error",
        message: "student_inbound_auto_send_failed",
        draftId,
        conversationId: conversation.id,
        error: errMsg,
      }),
    );
  }

  // 11. Mark inbound consumed.
  await markProcessed(pool, inbound.id);

  // 12. v1.2 MEMORY-01: post-reply fact extraction (fire-and-forget).
  //     After we've committed the workflow's user-visible outcome (draft +
  //     send + mark processed), kick off a background extraction LLM call
  //     that pulls structured facts from this turn and writes them to the
  //     graph. The agent's NEXT turn (this conversation or a different
  //     one days later) reads these via getStudentSummary in step 3b above.
  //
  //     Fire-and-forget by design: graph writes must NEVER block the
  //     user-visible turn. A timeout, parse error, or DB-down condition
  //     here is silently logged and dropped. The agent already responded;
  //     we're just enriching memory for future turns.
  if (inbound.body) {
    recordTurnFacts({
      studentId,
      inboundBody: inbound.body,
      agentReply: generated.body,
      sourceMessageId: inbound.id,
      model: DEFAULT_MODEL,
    }).catch((err) => {
      console.error(
        JSON.stringify({
          level: "error",
          message: "graph_record_turn_failed",
          studentId,
          messageId: inbound.id,
          error: err?.message ?? String(err),
        }),
      );
    });
  }

  return { draftId, conversationId: conversation.id, matchSource, sent };
}

// ─── Post-reply fact extraction (MEMORY-01) ─────────────────────────────────

/**
 * Extract facts from a completed turn and persist to the graph.
 *
 * Calls Workers AI 70B with a tight JSON-only extraction prompt, parses
 * the response, and writes each fact via recordFact (which handles
 * temporal close-out for single-valued predicates internally).
 *
 * All failures are caught and logged; this function never throws.
 * Intended call surface: fire-and-forget at the end of the workflow.
 */
async function recordTurnFacts({ studentId, inboundBody, agentReply, sourceMessageId, model }) {
  // Skip extraction when Workers AI isn't configured — recordFact is fine
  // with zero calls; an empty graph is the same as no MEMORY-01 surface.
  const accountId = process.env.CLOUDFLARE_AI_ACCOUNT_ID;
  const apiToken = process.env.CLOUDFLARE_AI_API_TOKEN;
  if (!accountId || !apiToken) return;

  const extractionPrompt = buildFactExtractionPrompt({ inboundBody, agentReply });
  let factsRaw = null;
  try {
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${model}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          messages: [
            {
              role: "system",
              content:
                "You extract structured facts from a chat turn. Output VALID JSON only — no prose, no markdown fences. Output strictly an array, even if empty.",
            },
            { role: "user", content: extractionPrompt },
          ],
          // Low temperature: extraction should be deterministic. 256 tokens
          // is plenty for up to 5 short facts (avg ~30 tokens each).
          max_tokens: 400,
          temperature: 0.1,
        }),
      },
    );
    if (!res.ok) return;
    const json = await res.json().catch(() => null);
    factsRaw = typeof json?.result?.response === "string" ? json.result.response : null;
  } catch (_err) {
    return;
  }

  const facts = parseFactsJson(factsRaw);
  if (!facts || facts.length === 0) return;

  // Persist each fact. recordFact is fail-soft (returns null if FalkorDB
  // is unreachable) so we don't need a per-call try/catch wrapper.
  for (const f of facts.slice(0, 5)) {
    await recordFact({
      subjectId: studentId,
      subjectType: "Student",
      predicate: f.predicate,
      objectValue: f.object,
      confidence: typeof f.confidence === "number" ? f.confidence : 0.7,
      sourceMessageId,
    });
  }
}

function buildFactExtractionPrompt({ inboundBody, agentReply }) {
  // Recognized predicates mirror graph.mjs PREDICATES. Listed verbatim so
  // the LLM stays on the canonical vocabulary; free-text predicates fall
  // through to OTHER via normalizePredicate, but the prompt steers toward
  // the canonical set for queryability.
  const predicates = [
    PREDICATES.INTERESTED_IN, // multi-valued — accumulates
    PREDICATES.STUDIES_AT, // single-valued — close-out on change
    PREDICATES.SKILLS_IN, // multi-valued
    PREDICATES.PREFERS, // single-valued
    PREDICATES.MENTIONED, // multi-valued (roles/companies brought up)
    PREDICATES.STATUS, // single-valued (e.g. "actively looking")
    PREDICATES.OTHER,
  ].join(", ");
  return [
    "Extract up to 5 facts about the USER (not the agent) from the conversation turn below.",
    "Each fact: { predicate, object, confidence }.",
    `predicate is one of: ${predicates}.`,
    "object is a short string (max 80 chars).",
    "confidence is a number 0..1 reflecting how strongly the turn supports the fact.",
    "Skip pleasantries. Skip facts about the agent. Skip facts already obvious from prior context.",
    "Output JSON array. Empty array if no clear facts.",
    "",
    "User said:",
    String(inboundBody || "").slice(0, 1500),
    "",
    "Agent said:",
    String(agentReply || "").slice(0, 1500),
    "",
    "JSON:",
  ].join("\n");
}

function parseFactsJson(raw) {
  if (!raw || typeof raw !== "string") return null;
  // The model sometimes prefixes/suffixes the JSON with stray prose despite
  // instructions. Find the first `[` and last `]` and slice — best-effort.
  let s = raw.trim();
  const open = s.indexOf("[");
  const close = s.lastIndexOf("]");
  if (open === -1 || close === -1 || close < open) return null;
  s = s.slice(open, close + 1);
  try {
    const arr = JSON.parse(s);
    if (!Array.isArray(arr)) return null;
    return arr.filter(
      (item) =>
        item &&
        typeof item === "object" &&
        typeof item.predicate === "string" &&
        typeof item.object === "string" &&
        item.object.length > 0,
    );
  } catch (_) {
    return null;
  }
}

// ─── Profile + thread helpers ────────────────────────────────────────────────

async function loadStudentProfile(pool, studentId) {
  // student_profile_context: interests / projects / preferred work / notes.
  const { rows } = await pool.query(
    `select interests, projects, preferred_work, notes
       from student_profile_context
      where student_id = $1
      limit 1`,
    [studentId],
  );
  const row = rows[0];

  // students.name (post-Clerk-OAuth) + most-recent profile_snapshots.display_name
  // (LinkedIn-provided). Either may be empty; both may be empty. We pick the
  // most informative non-empty value, normalize it, then derive a first name
  // for voice use ("hey raj" vs "hi there"). The first name is intentionally
  // best-effort: a candidate with only "Raj P." in their LinkedIn display
  // name is addressed as "raj"; if both columns are empty we fall back to
  // null and the prompt instructs the agent to omit the name.
  const { rows: nameRows } = await pool.query(
    `select s.name as student_name,
            s.linkedin_profile_url as student_linkedin_url,
            ps.display_name as snapshot_name
       from students s
       left join lateral (
         select display_name
           from profile_snapshots
          where student_id = s.id
          order by collected_at desc
          limit 1
       ) ps on true
      where s.id = $1
      limit 1`,
    [studentId],
  );
  const nameRow = nameRows[0] || {};
  const fullName = pickName(nameRow.student_name, nameRow.snapshot_name);
  const firstName = deriveFirstName(fullName);
  const linkedinProfileUrl = String(nameRow.student_linkedin_url || "").trim();

  // v1.2 Phase 09: Bright Data-enriched LinkedIn fields. May be null on
  // enrichment failure. composeProfileBlob handles null gracefully — the
  // prompt just omits structured LinkedIn fields.
  let linkedin = null;
  try {
    const { rows: liRows } = await pool.query(
      `select linkedin_url, linkedin_id, headline, summary,
              current_company, current_title, schools, experiences, skills
         from linkedin_profiles
        where student_id = $1
        limit 1`,
      [studentId],
    );
    linkedin = liRows[0] || null;
  } catch (err) {
    // Table absent (e.g. migration 0007 not yet applied in this env) is a
    // soft fail — degrade to the non-LinkedIn prompt without crashing.
    if (err?.code !== "42P01") {
      console.error(
        JSON.stringify({
          level: "error",
          message: "load_linkedin_profile_failed",
          studentId,
          error: err?.message ?? String(err),
        }),
      );
    }
  }
  if (!linkedin && linkedinProfileUrl) {
    linkedin = {
      linkedin_url: linkedinProfileUrl,
      linkedin_id: "",
      headline: "",
      summary: "",
      current_company: "",
      current_title: "",
      schools: [],
      experiences: [],
      skills: [],
    };
  }

  return {
    fullName,
    firstName,
    linkedinProfileUrl,
    interests: row?.interests || [],
    projects: row?.projects || "",
    preferredWork: row?.preferred_work || "",
    notes: row?.notes || "",
    linkedin,
  };
}

function pickName(...candidates) {
  for (const c of candidates) {
    const v = typeof c === "string" ? c.trim() : "";
    if (v) return v;
  }
  return "";
}

function deriveFirstName(fullName) {
  if (!fullName) return "";
  // First whitespace-delimited token. Strip trailing punctuation (period,
  // comma) so "Raj." becomes "Raj". Case-preserve — the system prompt
  // tells the LLM to lowercase it in output anyway.
  const tok = String(fullName).trim().split(/\s+/)[0] || "";
  return tok.replace(/[.,;:!?'"]+$/g, "");
}

function composeProfileBlob(profile) {
  const parts = [];
  // The agent uses firstName (sparingly) per the voice rules; fullName is
  // there for cases where the agent needs to reference the candidate
  // formally (rare on SMS).
  if (profile.firstName) parts.push("first_name: " + profile.firstName);
  if (profile.fullName && profile.fullName !== profile.firstName) {
    parts.push("full_name: " + profile.fullName);
  }
  if (profile.linkedinProfileUrl) parts.push("linkedin_url: " + profile.linkedinProfileUrl);
  if (profile.interests?.length) parts.push("interests: " + profile.interests.join(", "));
  if (profile.projects) parts.push("projects: " + profile.projects);
  if (profile.preferredWork) parts.push("preferred work: " + profile.preferredWork);
  if (profile.notes) parts.push("notes: " + profile.notes);
  return parts.join("\n");
}

// v1.2 Phase 09 — render the LinkedIn-enriched fields as a structured block
// the model can quote from. This is the core Standout-style payoff: by the
// time the agent's first message goes out, the prompt already names the
// candidate's school, current role, and a few skills, so the opening line
// is contextual instead of "what do you study?".
//
// Kept separate from composeProfileBlob because (a) it has a strict "DO NOT
// ASK FOR THIS" framing that doesn't apply to the student-typed
// student_profile_context fields, and (b) callers may want to omit on
// later turns once the conversation has its own context.
export function composeLinkedInBlock(linkedin) {
  if (!linkedin) return "";
  const lines = ["student LinkedIn context (already pulled — DO NOT ask for it):"];
  if (linkedin.linkedin_url) lines.push(`  url: ${linkedin.linkedin_url}`);
  if (linkedin.headline) lines.push(`  headline: ${linkedin.headline}`);

  const schools = Array.isArray(linkedin.schools) ? linkedin.schools : [];
  if (schools.length) {
    const top = schools[0] || {};
    const ed = [top.school, top.degree, top.fieldOfStudy].filter(Boolean).join(", ");
    if (ed) {
      const year = top.endYear ? ` (${top.endYear})` : "";
      lines.push(`  school: ${ed}${year}`);
    }
  }

  const cur = [linkedin.current_title, linkedin.current_company].filter(Boolean).join(" at ");
  if (cur) lines.push(`  current: ${cur}`);

  const experiences = Array.isArray(linkedin.experiences) ? linkedin.experiences : [];
  const recent = experiences.slice(0, 3).map((e) => {
    const role = [e.title, e.company].filter(Boolean).join(" at ");
    const dates = [e.startsAt, e.endsAt].filter(Boolean).join("–");
    return role + (dates ? ` (${dates})` : "");
  }).filter(Boolean);
  if (recent.length) lines.push(`  recent: ${recent.join("; ")}`);

  const skills = Array.isArray(linkedin.skills) ? linkedin.skills.slice(0, 7).filter(Boolean) : [];
  if (skills.length) lines.push(`  skills: ${skills.join(", ")}`);

  return lines.join("\n");
}

// First-contact detection. Cheap heuristic: count prior outbound drafts
// against this conversation. Zero outbound = the agent hasn't replied yet,
// so this turn is the FIRST contact. The first-contact branch:
//   - prepends a "this is the first message" framing to the system prompt
//   - tells the model to open with something specific from the LinkedIn
//     block (a school, a past role, a skill) — no "what do you study?"
//
// We deliberately count drafts (not inbound_messages) because a student
// may have texted multiple times before any agent reply lands.
async function countPriorOutbound(pool, conversationId) {
  if (!pool || !conversationId) return 0;
  const { rows } = await pool.query(
    `select count(*)::int as n from drafts where conversation_id = $1 and status = 'sent'`,
    [conversationId],
  );
  return rows[0]?.n || 0;
}

// Compose the first-contact prompt. Called by composePrompt's first-turn
// branch. Returns a string slotted into the user-role message of the LLM
// call (the system message stays AGENT_SYSTEM_PROMPT — voice + safety).
//
// Exported so unit tests + future startup-side workflows can reuse the
// shape without duplicating the structure.
export function composeFirstContactPrompt({ profileBlob, linkedinBlock, role, inboundBody }) {
  const hasLinkedInDetails = hasDetailedLinkedInBlock(linkedinBlock);
  const parts = [
    "--- First contact ---",
    "This is the FIRST iMessage from a new student. They just paired their phone via the QR/sms deep-link onboarding flow.",
    "The first sentence must include first_name if first_name is present in the student profile.",
    hasLinkedInDetails
      ? "Open warmly and reference something SPECIFIC from their LinkedIn (school, a past role, a skill)."
      : "LinkedIn enrichment has not returned structured details yet. Do NOT invent a school, employer, role, or skill from the URL alone.",
    hasLinkedInDetails
      ? "Do NOT ask what they're studying or where they work — you already know. Do NOT ask for their resume."
      : "Use the stored LinkedIn URL only as identity context. Ask one concrete next question tied to the matched role, not a generic profile question.",
    "",
  ];
  if (linkedinBlock) {
    parts.push(linkedinBlock, "");
  }
  parts.push(
    "--- Student profile (self-reported, may be empty on first contact) ---",
    profileBlob || "(no profile context yet)",
    "",
    "--- Matched role ---",
    `Title: ${role.title || ""}`,
    `Description: ${role.description || ""}`,
    `Requirements: ${role.requirements || ""}`,
    "",
    "--- New inbound from student ---",
    inboundBody || "(empty)",
    "",
    hasLinkedInDetails
      ? "Reply in the voice defined in the system message. This is your FIRST message to them, so the opener must include their first name if available and name a school, role, or skill from their LinkedIn. Warm openers like \"fair.\", \"ok.\", \"ah, got it.\" are fine — but do not use banned chatbot tells (\"sure!\", \"absolutely!\", \"great question!\", etc.). Output only the SMS body."
      : "Reply in the voice defined in the system message. This is your FIRST message to them, so the opener must include their first name if available. Do not claim LinkedIn details you do not have yet. Output only the SMS body.",
  );
  return parts.join("\n");
}

function hasDetailedLinkedInBlock(linkedinBlock) {
  return /\n\s+(headline|school|current|recent|skills):\s+\S/i.test(String(linkedinBlock || ""));
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

// ─── Agent voice (2026-05-17 AGENT-VOICE) ────────────────────────────────────
//
// The agent has a distinct conversational voice tuned from few-shot exemplars
// of a competitor's recruiting-agent SMS thread. Goal: candidates feel they're
// texting a sharp human recruiter, not an autoresponder. Combined with the
// 2026-05-17 autonomy pivot (no operator approval gate pre-send), this voice
// is what the candidate experiences directly.
//
// Style rules in one line: lowercase except proper nouns, short bursts,
// hyphen-break " - " for adjacent clauses, no emojis, direct, push back when
// the candidate is wrong, first-person, never call self an AI/bot/assistant.
export const AGENT_VOICE = [
  "VOICE & STYLE:",
  "- All lowercase except proper nouns (people, companies, products, schools). Never start a sentence with a capital unless it's a proper noun.",
  "- Match length to depth. A casual one-liner gets a one-liner. A technical or layered question gets a properly structured answer — break into mental sections (\"ok, here's how i'd think about it:\" or \"layer 1: ... layer 2: ...\") when that helps. The 320-char SMS cap is enforced separately and only applies to SMS.",
  "- Break adjacent clauses with \" - \" (space-hyphen-space) instead of em-dashes or periods.",
  "- No emojis. No exclamation points except sparingly for genuine emphasis (\"crush the interview\").",
  "- Direct, confident. Push back politely when the candidate misremembers or contradicts you (\"right - I never said you'd get an email from me\").",
  "- First person (\"I\"). You have a personality and memory. NEVER refer to yourself as an AI, model, assistant, bot, chatbot, or any synonym.",
  "- Use the candidate's first name sparingly (max once per turn).",
  "- Specific over generic. Name the actual role, company, school. Never \"various roles\" or \"great opportunities\".",
  "- When asked for something out of scope (send email, edit a calendar, do something you can't): be honest. \"I can't do X, but I can do Y.\"",
  "- Offer concrete next steps (\"want me to pull the brief?\", \"want me to lay it out?\"). Don't end with a vague \"let me know\".",
  "- Remember context across the thread. If the candidate mentioned a company or constraint earlier, reference it later.",
  "- Banned chatbot tells — do NOT open with any of these: \"sure!\", \"absolutely!\", \"great question!\", \"of course!\", \"happy to help!\", \"i'd be glad to\". They read as autoresponder.",
  "- Warm openers ARE allowed and encouraged when they fit: \"fair.\", \"ok.\", \"ah, got it.\", \"good one.\", \"right —\", \"fair point.\" These acknowledge the human on the other end without sounding like a script.",
  "- When you decline or push back, name the boundary as structural — not as a judgment of the person. Phrases to use: \"not a judgment call on my part\", \"hard line i can't cross\", \"i hear the logic, but\", \"i respect you for trying\". The decline still has to be clear; warmth comes from the hedge, not from softening the no.",
  "- When the user has clearly invested effort or asked a sharp question, name it specifically before continuing. \"you walked through X\" or \"you nailed Y\" — concrete, not generic.",
].join("\n");

// 3-5 of the strongest exemplars from the competitor reference, formatted as
// User / Agent pairs. These steer the model toward the desired register
// more reliably than rules alone — especially the pushback exemplar (the
// "right - I never said..." line) which encodes confident correction.
export const AGENT_VOICE_EXEMPLARS = [
  "EXAMPLES OF THE TONE WE WANT:",
  "",
  "User: \"You confirmed in one chat so that's ok\"",
  "Agent: \"ha, caught me. fair. doesn't change the rule going forward but yeah, I named it.\"",
  "",
  "User: \"Hi are you able to send email to me\"",
  "Agent: \"yeah, I've got your email on file. what do you want me to send over?\"",
  "",
  "User: \"details about the role\"",
  "Agent: \"straight answer: I can't fire off emails from this thread. I work over text. what I can do right now is drop the full brief in here - role, team, why it's open, comp, process. want me to lay it out?\"",
  "",
  "User: \"I didn't get any email\"",
  "Agent: \"right - I never said you'd get an email from me. I don't send email. you won't get one from this thread.\"",
  "",
  "User: \"hi\"",
  "Agent: \"hey - been a minute. how'd the last role land?\"",
  "",
  // 6th exemplar: long-form, structured. Teaches the model that depth +
  // mental sections IS in voice — not a violation of the burst rule.
  "User: \"what would the under-the-hood architecture for a recruiting agent look like? walk me through the layers.\"",
  "Agent: \"ok, cto hat on. building a recruiting agent platform from scratch.",
  "",
  "layer 1: the reasoning core",
  "single LLM call per turn, one massive system prompt with identity, voice rules, tool catalog, and dynamically injected candidate context. model reasons, decides to call tools or respond, loops until done.",
  "",
  "layer 2: context assembly",
  "every inbound triggers a context build — profile from postgres, active matches, last N messages, session summaries, journey state. templated into the system prompt before the LLM sees it.",
  "",
  "layer 3: tool layer",
  "typed function definitions — profile, matching, communication, lifecycle, memory, escalation. each one strict input validation + WHEN-to-use guidance.",
  "",
  "want me to go deeper on any layer? system prompt design and the matching pipeline are usually where it gets interesting.\"",
].join("\n");

// Baseline safety guardrails injected into every system prompt. v1.2
// autonomy pivot (2026-05-17): with no operator approval gate pre-send,
// these prompt-level rules are the FIRST line of defense. v1.3 will add
// Lakera Guard pre-LLM screening on inbound content for prompt-injection.
// Operators can flag any sent message via /ops/drafts/:id/flag for
// prompt-tuning review post-hoc.
export const AGENT_SAFETY_GUARDRAILS = [
  "SAFETY:",
  "- Do not make legal, financial, or medical promises on the startup's behalf.",
  "- Do not commit the startup to compensation, hiring decisions, equity, or contract terms.",
  "- Do not share personal information about other students or other startups.",
  "- Do not invent facts about the student, startup, or role beyond the provided context.",
  "- If asked to do something illegal, deceptive, or that violates a person's privacy, refuse politely and end with a neutral message.",
  "- If you're unsure how to answer, ask the student a clarifying question rather than guessing.",
].join("\n");

// Composed system message: persona + voice + exemplars + safety. Exported so
// runLLM and any future call site (e.g. a future startup-email-drafting
// workflow) share the same prompt frame.
export const AGENT_SYSTEM_PROMPT = [
  "You're a recruiting agent at InternJobs.ai. You text students about specific internship roles you have for them. You have a strong, distinct voice.",
  "",
  AGENT_VOICE,
  "",
  AGENT_VOICE_EXEMPLARS,
  "",
  AGENT_SAFETY_GUARDRAILS,
  "",
  "Keep replies under 320 characters when over SMS.",
].join("\n");

function composePrompt({
  profileBlob,
  graphSummary,
  threadHistory,
  role,
  inboundBody,
  journeyState,
  missingFields = [],
}) {
  // The persona + voice + safety live in AGENT_SYSTEM_PROMPT (system role).
  // This prompt carries only the per-turn dynamic context (profile, thread
  // history, matched role, new inbound). Keeping them separate lets the 70B
  // model treat the system content as instructions and the user content as
  // data, which gives noticeably tighter style adherence than mashing them.
  const parts = [];
  // v1.2 MEMORY-01: WHAT YOU REMEMBER block sits FIRST. The 70B model
  // weights early instruction more heavily than late, and cross-conversation
  // recall is the highest-value context the agent has (a student profile
  // is static, but graph facts capture lived conversational context like
  // "mentioned the Acme intro is pending"). Omitted when empty so a
  // first-turn candidate doesn't see a useless empty section.
  if (graphSummary && graphSummary.trim().length > 0) {
    parts.push(
      "--- What you remember about this user ---",
      graphSummary.trim(),
      "",
    );
  }
  parts.push(
    "--- Student profile ---",
    profileBlob || "(no profile context on file)",
    "",
  );

  // v1.2 AGENT-WARMTH: journey-state block. The model uses this to pitch
  // the opener correctly — a "first contact" turn is different from "role
  // surfaced, awaiting response" or "offer stage". Compute inline from
  // existing inputs when the caller doesn't pass one (back-compat).
  const computedJourneyState = journeyState || (
    threadHistory.length === 0
      ? "first contact"
      : role && role.title
        ? `role surfaced (${role.title}), awaiting response`
        : "mid-conversation, no role surfaced yet"
  );
  parts.push(
    "--- Journey state ---",
    computedJourneyState,
    "",
  );

  // v1.2 AGENT-WARMTH: missing-profile-fields block. Lets the agent
  // naturally probe for the next-most-useful field instead of asking
  // generically. Only injected when non-empty — silence beats noise.
  // TODO(upstream): the caller of composePrompt() should compute
  // missingFields by diffing the canonical student profile against the
  // blob shape produced by composeProfileBlob() — keys are first_name,
  // interests, projects, preferred work, notes (plus LinkedIn-derived
  // fields like school / current role on first contact). For now we
  // fall back to a cheap heuristic on the blob string so something
  // useful surfaces even when callers don't supply the param.
  let missing = Array.isArray(missingFields) ? missingFields.slice() : [];
  if (missing.length === 0 && typeof profileBlob === "string") {
    const present = new Set();
    for (const line of profileBlob.split("\n")) {
      const m = line.match(/^\s*([a-z_ ]+?)\s*:/i);
      if (m) present.add(m[1].trim().toLowerCase());
    }
    const candidates = ["interests", "projects", "preferred work", "notes"];
    for (const k of candidates) if (!present.has(k)) missing.push(k);
  }
  if (missing.length > 0) {
    parts.push(
      "--- What's missing from this candidate's profile ---",
      missing.map((f) => `- ${f}`).join("\n"),
      "(probe naturally for one of these if it fits the turn — don't run a checklist)",
      "",
    );
  }

  parts.push(
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
    "Reply in the voice defined in the system message. Warm openers like \"fair.\", \"ok.\", \"ah, got it.\" are fine — but do not use banned chatbot tells (\"sure!\", \"absolutely!\", \"great question!\", etc.). Output only the SMS body.",
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
  //    - CLOUDFLARE_AI_ACCOUNT_ID / CLOUDFLARE_AI_API_TOKEN are missing.
  //    This preserves the dev/test contract from the OpenAI era so nothing
  //    in the smoke suite needs a network egress.
  const accountId = process.env.CLOUDFLARE_AI_ACCOUNT_ID;
  const apiToken = process.env.CLOUDFLARE_AI_API_TOKEN;
  if (process.env.LLM_PROVIDER === "stub" || !accountId || !apiToken) {
    return {
      body:
        "Hi! Thanks for reaching out — I'd love to chat about the role. " +
        "What's the best time to follow up?",
      model: "canned-stub",
    };
  }

  // 3. Real path: POST directly to Cloudflare Workers AI REST API.
  //    No proxy Worker, no AI Gateway. The token is scoped for Workers AI
  //    direct (`Workers AI Read` perm). AI Gateway can be added later by
  //    prefixing the URL with `/v1/{account_id}/{gateway_id}/workers-ai`
  //    without touching the response-shape parsing here.
  //
  // 2026-05-17 AGENT-VOICE: model is Llama 3.3 70B fp8-fast (see DEFAULT_MODEL
  // comment block). max_tokens raised 512 → 800 — 70B with rich context can
  // generate slightly longer outputs, but conversational SMS targets 1-3
  // sentences so 800 is a safety ceiling not a target. temperature lowered
  // 0.7 → 0.5 for tighter style adherence (the voice rules are precise).
  // System message uses AGENT_SYSTEM_PROMPT (persona + voice + exemplars +
  // safety) — the per-turn dynamic context (profile / thread / role / inbound)
  // is in the user message via composePrompt.
  try {
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${model}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          messages: [
            { role: "system", content: AGENT_SYSTEM_PROMPT },
            { role: "user", content: prompt },
          ],
          max_tokens: 800,
          temperature: 0.5,
        }),
      },
    );
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
    // Workers AI envelope: { result: { response: "<text>" }, success, errors }
    if (json?.success === false) {
      console.error(
        JSON.stringify({
          level: "error",
          message: "llm_call_unsuccessful",
          errors: json?.errors || null,
          model,
        }),
      );
      return {
        body: "(automated draft unavailable — operator review required)",
        model: model + "+error",
      };
    }
    const body = typeof json?.result?.response === "string" ? json.result.response : "";
    return { body, model };
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
    // hyphens, on the `agent.internjobs.ai` subdomain. Lowercased. Parsed
    // by apps/email-worker/src/index.js on inbound replies.
    const replyTo = buildConversationReplyTo(conversationId);
    if (replyTo) meta.reply_to = replyTo;
  }
  return meta;
}

// re-export for convenience: callers that don't want to import a workflow
// instance can fire embedding writes themselves with the same error logger.
export { logEmbedErr };
