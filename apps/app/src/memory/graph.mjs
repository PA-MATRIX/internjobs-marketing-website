// apps/app/src/memory/graph.mjs
//
// v1.2 MEMORY-01: self-hosted graph memory for the agent.
//
// Backed by FalkorDB (Redis-protocol graph DB) running as a separate Fly
// app (`internjobs-graph`) on the org's private network. We talk to it via
// the official `falkordb` npm client which speaks the Redis wire protocol
// + Cypher (GRAPH.QUERY).
//
// Design: a thin Node implementation of the Graphiti temporal-fact pattern.
// Every fact is a node :Fact with a deterministic id, attached to a subject
// node (:Student | :Role | :Startup) via a -[:HAS_FACT]-> edge. A fact has:
//   - predicate (string)            INTERESTED_IN, STUDIES_AT, PREFERS, ...
//   - object_value (string)         the right-hand-side as text
//   - confidence (float 0..1)
//   - source_message_id (uuid)      the inbound message that spawned this fact
//   - valid_from (ISO timestamp)
//   - valid_to (ISO or null)        null = currently active
//
// The CRITICAL invariant: when a new fact is recorded for the same
// (subject, predicate), any currently-active conflicting fact has its
// valid_to set to now() in the SAME transaction. This is the temporal
// close-out that makes "I never said that" pushback honest — the graph
// always knows which facts were live as of any timestamp.
//
// Fail-soft posture: if FALKORDB_URL is unset or the connection fails,
// every exported function returns a safe default (null / empty / "") and
// logs a one-line warning. The agent workflow must keep working when the
// graph DB is down (degraded UX: no cross-conversation recall, but the
// turn still completes and the candidate gets a reply).

import { createHash } from "node:crypto";
import { FalkorDB } from "falkordb";

// Module-level singleton client. Lazy: first getGraphClient() call
// connects; subsequent calls reuse. Reset to null on a connection error
// so the next call retries (avoids cold-stuck state after a transient
// network blip).
let _clientPromise = null;
let _clientInstance = null;
let _connectFailedLogged = false;

// FalkorDB graph name. Single graph for the v1.2 MEMORY-01 surface —
// students, roles, startups, and the facts that connect them all live in
// one graph. If we later need tenant isolation (e.g. per-startup graphs)
// we can derive a graph name from the subject's owning tenant — the call
// surface here doesn't change.
const GRAPH_NAME = "internjobs";

// Cap getStudentSummary output to a reasonable injection size. The
// /webhooks/photon handler appends this to the system prompt, so a runaway
// fact set must not blow the LLM context. 1200 chars is generous —
// student profile blob + role blob already cost ~600 chars together; we
// stay under 320-char SMS-output instructions comfortably with this cap.
const SUMMARY_CHAR_BUDGET = 1200;

// ─── Connection ─────────────────────────────────────────────────────────────

/**
 * Lazily returns a connected FalkorDB client, or null if FALKORDB_URL is
 * unset or the connection failed. Never throws. Safe to call from any
 * code path including the hot HTTP path.
 *
 * @returns {Promise<import('falkordb').FalkorDB | null>}
 */
export async function getGraphClient() {
  const url = process.env.FALKORDB_URL;
  if (!url) return null;

  if (_clientInstance) return _clientInstance;

  if (!_clientPromise) {
    // The npm client expects a falkor[s]:// or redis[s]:// URL. Internally
    // it normalizes to the node-redis URL parser; both schemes resolve to
    // the same TCP target. We accept both (our Infisical-stored value is
    // `redis://default:<pw>@internjobs-graph.internal:6379` which works).
    _clientPromise = FalkorDB.connect({ url })
      .then((client) => {
        _clientInstance = client;
        // Reset the "logged once" guard so a future drop+reconnect logs once.
        _connectFailedLogged = false;
        // Wire an error handler so a runtime disconnect doesn't crash Node
        // (default EventEmitter behavior on unhandled 'error' is to throw).
        // We log and null out the singleton so the next call retries.
        client.on?.("error", (err) => {
          if (!_connectFailedLogged) {
            console.warn(
              JSON.stringify({
                level: "warn",
                message: "graph_client_runtime_error",
                error: err?.message ?? String(err),
              }),
            );
            _connectFailedLogged = true;
          }
          // Schedule cleanup of the singleton after the next tick so the
          // current call (if any) finishes propagating.
          _clientInstance = null;
          _clientPromise = null;
        });
        return client;
      })
      .catch((err) => {
        if (!_connectFailedLogged) {
          console.warn(
            JSON.stringify({
              level: "warn",
              message: "graph_client_connect_failed",
              error: err?.message ?? String(err),
            }),
          );
          _connectFailedLogged = true;
        }
        _clientPromise = null;
        return null;
      });
  }
  return _clientPromise;
}

/**
 * Closes the singleton client. Intended for tests + clean shutdown.
 */
export async function closeGraphClient() {
  const c = _clientInstance;
  _clientInstance = null;
  _clientPromise = null;
  _connectFailedLogged = false;
  if (c && typeof c.close === "function") {
    try {
      await c.close();
    } catch (_) {
      // Best-effort close; swallow.
    }
  }
}

function getGraph(client) {
  return client.selectGraph(GRAPH_NAME);
}

// ─── Schema bootstrap ───────────────────────────────────────────────────────

/**
 * Creates indexes (and unique constraints where applicable). Idempotent —
 * "already exists" errors are swallowed. Safe to call on every app boot.
 *
 * Returns true on success, false on any failure (caller already logs).
 *
 * @returns {Promise<boolean>}
 */
export async function ensureGraphSchema() {
  const client = await getGraphClient();
  if (!client) return false;
  const graph = getGraph(client);

  // Indexes are issued as CREATE INDEX Cypher. FalkorDB swallows duplicates
  // as a normal "index already exists" Cypher error — we still catch
  // defensively. Per-label range index on the canonical id property gives
  // O(log n) lookups during recordFact / getActiveFacts.
  const stmts = [
    "CREATE INDEX FOR (n:Student) ON (n.id)",
    "CREATE INDEX FOR (n:Role) ON (n.id)",
    "CREATE INDEX FOR (n:Startup) ON (n.id)",
    "CREATE INDEX FOR (n:Topic) ON (n.name)",
    "CREATE INDEX FOR (n:Fact) ON (n.id)",
    // Composite-ish: querying active facts filters on subject + predicate +
    // valid_to. A single-property index on Fact.predicate accelerates the
    // most common scan path (getActiveFacts with a predicates filter).
    "CREATE INDEX FOR (n:Fact) ON (n.predicate)",
  ];

  let ok = true;
  for (const stmt of stmts) {
    try {
      await graph.query(stmt);
    } catch (err) {
      // "already indexed" / "Attribute 'id' is already indexed" is benign.
      const msg = (err?.message || "").toLowerCase();
      if (msg.includes("already indexed") || msg.includes("already exists")) continue;
      console.warn(
        JSON.stringify({
          level: "warn",
          message: "graph_index_create_failed",
          stmt,
          error: err?.message ?? String(err),
        }),
      );
      ok = false;
    }
  }
  return ok;
}

// ─── Fact API ────────────────────────────────────────────────────────────────

/**
 * Recognized predicates. Free-text predicates are allowed (the extraction
 * LLM may emit something not on this list) but we lowercase + slug them so
 * the graph stays queryable. Keeping a canonical list here in the module
 * documents the v1.2 vocabulary; the agent prompt references the same set.
 */
export const PREDICATES = Object.freeze({
  INTERESTED_IN: "INTERESTED_IN",
  STUDIES_AT: "STUDIES_AT",
  SKILLS_IN: "SKILLS_IN",
  PREFERS: "PREFERS",
  MENTIONED: "MENTIONED",
  STATUS: "STATUS",
  OTHER: "OTHER",
});

function normalizePredicate(p) {
  if (!p || typeof p !== "string") return PREDICATES.OTHER;
  const up = p.toUpperCase().replace(/[^A-Z0-9_]/g, "_");
  return up || PREDICATES.OTHER;
}

// Predicates whose semantics are SINGLE-VALUED: a student is at ONE school
// (at a time), has ONE current status, has ONE current set of preferences.
// New writes for these predicates close out prior conflicting values
// (Graphiti-style temporal close-out: valid_to = now() on the old fact).
//
// Predicates whose semantics are MULTI-VALUED: a student can be interested
// in many topics simultaneously, can have many skills, can mention many
// roles across turns. New writes for these predicates do NOT close prior
// values; the graph accumulates. (A future fact can still be closed
// explicitly — e.g. an extraction emits a "NOT interested in X anymore"
// signal — but that's a v1.3 surface.)
//
// PREDICATES.OTHER falls through as multi-valued (additive) — agents may
// emit "OTHER" for anything novel and accumulating is the safer default
// than mass-closing on a label collision.
const SINGLE_VALUED_PREDICATES = new Set([
  PREDICATES.STUDIES_AT,
  PREDICATES.STATUS,
  PREDICATES.PREFERS,
]);

function isSingleValuedPredicate(pred) {
  return SINGLE_VALUED_PREDICATES.has(pred);
}

function factHash({ subjectId, predicate, objectValue, sourceMessageId }) {
  // sha256 → first 32 hex chars (128 bits, plenty for a per-subject fact
  // dedup keyspace). Object value is stringified so a {type,id} blob
  // serializes to the same bytes for the same logical object.
  const ov = typeof objectValue === "string" ? objectValue : JSON.stringify(objectValue);
  return createHash("sha256")
    .update(`${subjectId}|${predicate}|${ov}|${sourceMessageId || ""}`)
    .digest("hex")
    .slice(0, 32);
}

/**
 * Records a fact. If a currently-active fact exists for the same
 * (subject, predicate) AND has a different object value, that prior fact's
 * valid_to is set to now() in the same query — the temporal close-out.
 *
 * Idempotency: a fact with the SAME (subject, predicate, object, sourceMessageId)
 * dedups to a no-op (the deterministic id collides → MERGE matches the
 * existing node). Re-running an extraction over the same turn is safe.
 *
 * @param {object} args
 * @param {string} args.subjectId       Logical id of the subject node.
 * @param {string} args.subjectType     'Student' | 'Role' | 'Startup'.
 * @param {string} args.predicate       Free-text or PREDICATES key.
 * @param {string|object} args.objectValue
 *                                       Text, or {type,id} for entity link.
 * @param {number} [args.confidence]    0..1. Default 0.7.
 * @param {string} [args.sourceMessageId] inbound_messages.id (uuid).
 * @param {string} [args.validFrom]     ISO string. Default now().
 * @param {string|null} [args.validTo]  ISO string or null. Default null (open).
 *
 * @returns {Promise<{factId: string, closedCount: number} | null>}
 *   Returns null on a fail-soft graph-unavailable path; otherwise the new
 *   fact id and how many prior conflicting facts were closed.
 */
export async function recordFact(args) {
  const {
    subjectId,
    subjectType,
    predicate: rawPredicate,
    objectValue,
    confidence = 0.7,
    sourceMessageId = null,
    validFrom = null,
    validTo = null,
  } = args || {};

  if (!subjectId || !subjectType) return null;
  if (objectValue === undefined || objectValue === null) return null;

  const client = await getGraphClient();
  if (!client) return null;
  const graph = getGraph(client);

  const predicate = normalizePredicate(rawPredicate);
  const objText = typeof objectValue === "string" ? objectValue : JSON.stringify(objectValue);
  const factId = factHash({ subjectId, predicate, objectValue, sourceMessageId });
  const nowIso = new Date().toISOString();
  const validFromIso = validFrom || nowIso;

  // Validate subjectType against the small whitelist. Cypher labels can't
  // be parameterized, so we MUST validate before string-interpolating.
  const subjLabel = ({ Student: "Student", Role: "Role", Startup: "Startup" })[subjectType];
  if (!subjLabel) return null;

  // Two-step Cypher, in two queries (FalkorDB does not support
  // multi-statement transactions over GRAPH.QUERY, but each individual
  // query IS atomic). The risk window between step 1 and step 2 is a
  // few ms; if the process crashes mid-flight, the worst case is an
  // un-closed prior fact + new fact both live — getActiveFacts then
  // returns both for the same predicate, which is detectable and
  // recoverable (a future repair job could pick the higher-confidence
  // or newer-validFrom row). Acceptable for v1.2.
  //
  // Step 1: for SINGLE-VALUED predicates only, close any active conflicting
  // facts (same subject + predicate, valid_to IS NULL, object text differs).
  // We DO NOT close on an exact dup (same object) — that's just a
  // re-record at a later time. For multi-valued predicates (INTERESTED_IN,
  // SKILLS_IN, MENTIONED, OTHER) the graph accumulates additively.
  let closedCount = 0;
  if (isSingleValuedPredicate(predicate)) {
    try {
      const closeRes = await graph.query(
        `MATCH (s:${subjLabel} {id: $sid})-[:HAS_FACT]->(f:Fact)
         WHERE f.predicate = $pred AND f.valid_to IS NULL AND f.object_value <> $obj
         SET f.valid_to = $now
         RETURN count(f) AS closed`,
        {
          params: {
            sid: subjectId,
            pred: predicate,
            obj: objText,
            now: nowIso,
          },
        },
      );
      // FalkorDB Cypher returns rows as arrays of column values.
      const row = closeRes?.data?.[0];
      if (row) closedCount = Number(Array.isArray(row) ? row[0] : row.closed ?? row[0]) || 0;
    } catch (err) {
      console.warn(
        JSON.stringify({
          level: "warn",
          message: "graph_recordfact_close_failed",
          subjectId,
          predicate,
          error: err?.message ?? String(err),
        }),
      );
      // Fall through — we'd rather insert the new fact than leave the graph empty.
    }
  }

  // Step 2: MERGE the subject + MERGE the fact (idempotent on factId).
  try {
    await graph.query(
      `MERGE (s:${subjLabel} {id: $sid})
       MERGE (f:Fact {id: $fid})
         ON CREATE SET
           f.predicate = $pred,
           f.object_value = $obj,
           f.confidence = $conf,
           f.source_message_id = $msg,
           f.valid_from = $vf,
           f.valid_to = $vt,
           f.created_at = $now
       MERGE (s)-[:HAS_FACT]->(f)
       RETURN f.id`,
      {
        params: {
          sid: subjectId,
          fid: factId,
          pred: predicate,
          obj: objText,
          conf: Number.isFinite(confidence) ? confidence : 0.7,
          msg: sourceMessageId || "",
          vf: validFromIso,
          vt: validTo,
          now: nowIso,
        },
      },
    );
  } catch (err) {
    console.warn(
      JSON.stringify({
        level: "warn",
        message: "graph_recordfact_insert_failed",
        subjectId,
        predicate,
        error: err?.message ?? String(err),
      }),
    );
    return null;
  }

  return { factId, closedCount };
}

/**
 * Returns currently-active facts for a subject (valid_to IS NULL).
 *
 * @param {string} subjectId
 * @param {object} [options]
 * @param {string[]} [options.predicates] Filter to these predicates only.
 * @param {number} [options.minConfidence] Minimum confidence (default 0).
 * @param {number} [options.limit] Default 50.
 *
 * @returns {Promise<Array<{
 *   factId: string, predicate: string, objectValue: string,
 *   confidence: number, sourceMessageId: string, validFrom: string,
 * }>>}
 */
export async function getActiveFacts(subjectId, options = {}) {
  if (!subjectId) return [];
  const client = await getGraphClient();
  if (!client) return [];
  const graph = getGraph(client);

  const { predicates, minConfidence = 0, limit = 50 } = options;

  // We don't know the subject's label up front — query across all three
  // possible labels with a UNION. (FalkorDB supports UNION; OPTIONAL
  // MATCH on multiple labels is less efficient.) The Fact node has the
  // canonical id so we always return it via f.id.
  //
  // Cypher labels can't be parameterized so the predicate filter goes
  // through a list comparison (CONTAINS on a string-encoded array would
  // be flaky; we use IN with a list parameter).
  const wherePred = predicates && predicates.length > 0
    ? "AND f.predicate IN $preds"
    : "";

  const sql =
    `MATCH (s:Student {id: $sid})-[:HAS_FACT]->(f:Fact)
     WHERE f.valid_to IS NULL AND f.confidence >= $minC ${wherePred}
     RETURN f.id, f.predicate, f.object_value, f.confidence,
            f.source_message_id, f.valid_from
     ORDER BY f.valid_from DESC
     LIMIT $lim
     UNION
     MATCH (s:Role {id: $sid})-[:HAS_FACT]->(f:Fact)
     WHERE f.valid_to IS NULL AND f.confidence >= $minC ${wherePred}
     RETURN f.id, f.predicate, f.object_value, f.confidence,
            f.source_message_id, f.valid_from
     ORDER BY f.valid_from DESC
     LIMIT $lim
     UNION
     MATCH (s:Startup {id: $sid})-[:HAS_FACT]->(f:Fact)
     WHERE f.valid_to IS NULL AND f.confidence >= $minC ${wherePred}
     RETURN f.id, f.predicate, f.object_value, f.confidence,
            f.source_message_id, f.valid_from
     ORDER BY f.valid_from DESC
     LIMIT $lim`;

  try {
    const res = await graph.query(sql, {
      params: {
        sid: subjectId,
        minC: Number.isFinite(minConfidence) ? minConfidence : 0,
        lim: Math.min(Math.max(1, limit), 200),
        preds: predicates && predicates.length > 0 ? predicates.map(normalizePredicate) : [],
      },
    });
    const rows = res?.data || [];
    return rows.map((r) => {
      // Each row is either an array (FalkorDB default shape) or an object
      // keyed by RETURN column name. Handle both for resilience.
      const arr = Array.isArray(r) ? r : [r["f.id"], r["f.predicate"], r["f.object_value"], r["f.confidence"], r["f.source_message_id"], r["f.valid_from"]];
      return {
        factId: arr[0],
        predicate: arr[1],
        objectValue: arr[2],
        confidence: Number(arr[3]) || 0,
        sourceMessageId: arr[4] || "",
        validFrom: arr[5] || "",
      };
    });
  } catch (err) {
    console.warn(
      JSON.stringify({
        level: "warn",
        message: "graph_get_active_facts_failed",
        subjectId,
        error: err?.message ?? String(err),
      }),
    );
    return [];
  }
}

/**
 * Returns the top-K active facts most semantically relevant to `query` for
 * the given subject. v1.2 implementation: pull active facts and score by
 * token overlap with the query (keyword scoring). v1.3 candidate:
 * embed the query via Workers AI and cosine-rank fact summaries.
 *
 * @param {string} subjectId
 * @param {string} query
 * @param {object} [options]
 * @param {number} [options.k] default 5
 * @returns {Promise<Array<object>>}  active-fact rows, scored + sorted
 */
export async function recallHistory(subjectId, query, options = {}) {
  if (!subjectId || !query) return [];
  const { k = 5 } = options;
  const facts = await getActiveFacts(subjectId, { limit: 100 });
  if (facts.length === 0) return [];

  const qTokens = tokenize(query);
  if (qTokens.size === 0) return facts.slice(0, k);

  const scored = facts.map((f) => {
    const text = `${f.predicate} ${f.objectValue}`;
    const tTokens = tokenize(text);
    let score = 0;
    for (const tok of tTokens) {
      if (qTokens.has(tok)) score += 1;
    }
    // Weight by confidence so a 0.4 fact tied with a 0.9 fact loses.
    return { ...f, score: score * 100 + Math.round((f.confidence || 0) * 10) };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, k);
}

function tokenize(s) {
  const out = new Set();
  for (const tok of String(s || "").toLowerCase().split(/[^a-z0-9]+/g)) {
    if (tok.length >= 3) out.add(tok);
  }
  return out;
}

// ─── Summary for prompt injection ───────────────────────────────────────────

/**
 * Builds a compact, human-readable summary of everything in the graph about
 * a student, suitable for injection into the agent's system prompt.
 *
 * Output is one short paragraph, lowercased to match the agent voice.
 * Empty string when the student has no facts (the workflow detects empty
 * and omits the prompt section entirely so the LLM doesn't see a useless
 * "WHAT YOU REMEMBER: (nothing)" header).
 *
 * @param {string} studentId
 * @returns {Promise<string>}
 */
export async function getStudentSummary(studentId) {
  if (!studentId) return "";
  const facts = await getActiveFacts(studentId, { limit: 50 });
  if (facts.length === 0) return "";

  // Group facts by predicate so we get one compact line per category.
  const byPred = new Map();
  for (const f of facts) {
    if (!byPred.has(f.predicate)) byPred.set(f.predicate, []);
    byPred.get(f.predicate).push(f);
  }

  const order = [
    PREDICATES.STUDIES_AT,
    PREDICATES.INTERESTED_IN,
    PREDICATES.SKILLS_IN,
    PREDICATES.PREFERS,
    PREDICATES.MENTIONED,
    PREDICATES.STATUS,
    PREDICATES.OTHER,
  ];

  const lines = [];
  for (const pred of order) {
    const group = byPred.get(pred);
    if (!group || group.length === 0) continue;
    // Dedup object values + sort by confidence desc for stability.
    const seen = new Set();
    const objects = [];
    for (const f of group.sort((a, b) => (b.confidence || 0) - (a.confidence || 0))) {
      const v = (f.objectValue || "").trim();
      if (!v || seen.has(v.toLowerCase())) continue;
      seen.add(v.toLowerCase());
      objects.push(v);
      if (objects.length >= 5) break;
    }
    if (objects.length === 0) continue;
    lines.push(`${labelForPredicate(pred)}: ${objects.join(", ")}.`);
  }

  // Anything not in `order` falls through to a generic tail line.
  for (const [pred, group] of byPred.entries()) {
    if (order.includes(pred)) continue;
    const objects = group.slice(0, 3).map((f) => (f.objectValue || "").trim()).filter(Boolean);
    if (objects.length === 0) continue;
    lines.push(`${labelForPredicate(pred)}: ${objects.join(", ")}.`);
  }

  // Append a "last active" line from the freshest valid_from across all
  // facts so the agent can naturally reference recency ("been a minute").
  let latest = "";
  for (const f of facts) {
    if (!f.validFrom) continue;
    if (!latest || f.validFrom > latest) latest = f.validFrom;
  }
  if (latest) {
    lines.push(`last active: ${formatTimestamp(latest)}.`);
  }

  let summary = lines.join(" ");
  if (summary.length > SUMMARY_CHAR_BUDGET) {
    summary = summary.slice(0, SUMMARY_CHAR_BUDGET - 1) + "…";
  }
  return summary;
}

function labelForPredicate(pred) {
  switch (pred) {
    case PREDICATES.STUDIES_AT: return "studies at";
    case PREDICATES.INTERESTED_IN: return "interested in";
    case PREDICATES.SKILLS_IN: return "skills";
    case PREDICATES.PREFERS: return "prefers";
    case PREDICATES.MENTIONED: return "mentioned";
    case PREDICATES.STATUS: return "status";
    case PREDICATES.OTHER: return "other";
    default: return pred.toLowerCase().replace(/_/g, " ");
  }
}

function formatTimestamp(iso) {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    // YYYY-MM-DD HH:MM (UTC) — readable, no timezone noise for an
    // SMS-channel agent whose users are mixed-tz.
    const yyyy = d.getUTCFullYear();
    const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(d.getUTCDate()).padStart(2, "0");
    const hh = String(d.getUTCHours()).padStart(2, "0");
    const mi = String(d.getUTCMinutes()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
  } catch (_) {
    return iso;
  }
}

// ─── Health check ───────────────────────────────────────────────────────────

/**
 * Cheap PING-style readiness probe. Used by /healthz with a 30s cache so
 * we don't spam the graph DB. Returns true iff a client can be obtained
 * AND a trivial query round-trips successfully. Never throws.
 *
 * @returns {Promise<boolean>}
 */
export async function pingGraph() {
  const client = await getGraphClient();
  if (!client) return false;
  try {
    // FalkorDB graph.query of a no-op `RETURN 1` exercises the full
    // command pipeline. Slightly heavier than a Redis PING but proves the
    // graph module is loaded, not just that Redis is up.
    const res = await getGraph(client).query("RETURN 1");
    return Boolean(res);
  } catch (err) {
    console.warn(
      JSON.stringify({
        level: "warn",
        message: "graph_ping_failed",
        error: err?.message ?? String(err),
      }),
    );
    return false;
  }
}
