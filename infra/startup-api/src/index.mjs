// infra/startup-api/src/index.mjs
//
// v1.4 Phase 28 STARTUP-MCP-01..10 + STARTUP-ADMIN-01..02 + STARTUP-CHANNEL-01
//
// internjobs-startup-api — narrow Hono/Node REST proxy for the startup-mcp
// Cloudflare Worker and admin endpoint. Bridges the CF Worker runtime
// (HTTP-only, no private TCP) to the Fly Postgres instance
// (internjobs-student-db). Mirrors the internjobs-graph-api pattern from
// v1.3 Phase 18.
//
// API surface (minimal by design):
//   POST  /v1/startups/token       — lookup startup context by mcp_token_hash
//   POST  /v1/startups             — create startup + member + issue MCP token
//   PATCH /v1/startups/:id/token   — rotate MCP token (returns new plaintext)
//   POST  /v1/roles                — insert a role + store pgvector embedding
//   POST  /v1/messages             — insert an outbound_messages row (channel='mcp')
//   POST  /v1/channel-links        — UPSERT a startup_channel_links row
//                                    (ON CONFLICT DO UPDATE — opt_in_flags +
//                                    updated_at advance on re-POST)
//   POST  /v1/action-log           — insert a startup_action_log row
//   POST  /v1/search/candidates    — pgvector cosine similarity search
//   PATCH /v1/roles/:id            — update role fields (ownership-checked)
//   PATCH /v1/threads/:id/mark     — set inbound_messages.startup_mark
//                                    (ownership-checked)
//   GET   /health                  — liveness probe
//
// Auth: Authorization: Bearer <STARTUP_API_SECRET> (shared secret, constant-
// time compare via node:crypto timingSafeEqual). Never store plaintext MCP
// install tokens — they go through hash-then-store here.
//
// Env vars (set via flyctl secrets set + Infisical /internjobs-ai):
//   STARTUP_API_SECRET   — shared Bearer token for this proxy (32-byte hex)
//   DATABASE_URL         — Fly Postgres connection string (same as student app)
//   PORT                 — default 3000 (set in fly.toml [env])
//
// Schema adaptation notes (DEVIATIONS from PLAN.md, see SUMMARY):
//   • startup_members has clerk_user_id (NOT NULL UNIQUE) and no `phone`/
//     `status` columns. /v1/startups synthesizes a placeholder clerk_user_id
//     so concierge onboarding (Ridhi) can issue tokens BEFORE the founder
//     completes Clerk org provisioning. When the founder eventually links
//     their Clerk identity, the row is UPDATEd to flip clerk_user_id.
//   • The roles table has no `embedding` column — embeddings live in the
//     separate role_embeddings table (vector(768), bge-base-en-v1.5). The
//     /v1/roles endpoint UPSERTs role_embeddings keyed by role_id.
//   • The students table has no first_name/last_name/major/graduation_year.
//     /v1/search/candidates returns `name` (and email/linkedin) as summary.
//   • Embeddings are pgvector vector(768); the float32[] body must contain
//     exactly 768 elements.

import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { timingSafeEqual, createHash, randomBytes } from "node:crypto";
import pg from "pg";

const { Pool } = pg;

// ── DB connection ─────────────────────────────────────────────────────────────

let _pool = null;

function getPool() {
  if (!process.env.DATABASE_URL) return null;
  if (_pool) return _pool;
  const url = process.env.DATABASE_URL;
  _pool = new Pool({
    connectionString: url,
    max: 5,
    // Fly internal Postgres is plaintext on .internal; expose `sslmode=disable`
    // in the URL when running inside Fly. Outside Fly (e.g. via flyctl proxy)
    // psql/pg handle the sslmode= URL parameter natively.
    ssl: url.includes("sslmode=disable") ? false : { rejectUnauthorized: false },
  });
  _pool.on("error", (err) => {
    console.warn(JSON.stringify({
      level: "warn",
      event: "startup_api_pool_error",
      error: err?.message ?? String(err),
    }));
  });
  return _pool;
}

// ── Auth helper ───────────────────────────────────────────────────────────────

function verifyBearer(req) {
  const secret = process.env.STARTUP_API_SECRET;
  if (!secret) return false; // no secret configured = deny all
  const auth = req.headers.get("authorization") ?? "";
  if (!auth.toLowerCase().startsWith("bearer ")) return false;
  const provided = auth.slice(7).trim();
  // Constant-time compare to prevent timing attacks. Equal-length check is
  // explicit and first, so timingSafeEqual never sees mismatched buffers.
  if (provided.length !== secret.length) return false;
  try {
    return timingSafeEqual(Buffer.from(provided), Buffer.from(secret));
  } catch {
    return false;
  }
}

// ── Token helpers ─────────────────────────────────────────────────────────────

function hashToken(rawToken) {
  return createHash("sha256").update(rawToken, "utf8").digest("hex");
}

function generateToken() {
  return randomBytes(32).toString("hex"); // 64 hex chars — plaintext install token
}

function synthClerkUserId() {
  // Concierge-onboarding placeholder. When the founder eventually goes
  // through workspace.internjobs.ai Clerk sign-in, the row is UPDATEd
  // to flip clerk_user_id to the real `user_*` id.
  return `concierge:${randomBytes(16).toString("hex")}`;
}

// ── pgvector helper ───────────────────────────────────────────────────────────

function toVectorLiteral(arr) {
  // pgvector accepts both `[1,2,3]` JSON-style and `'[1,2,3]'::vector` cast.
  // We pass as text and cast in the SQL with `::vector` so node-postgres
  // doesn't need a custom type parser.
  return `[${arr.map((n) => Number(n)).join(",")}]`;
}

// ── Hono app ──────────────────────────────────────────────────────────────────

const app = new Hono();

// Auth middleware (applied to all /v1/* routes)
app.use("/v1/*", async (c, next) => {
  if (!verifyBearer(c.req.raw)) return c.json({ error: "unauthorized" }, 401);
  return next();
});

// ── GET /health ──────────────────────────────────────────────────────────────
app.get("/health", async (c) => {
  const pool = getPool();
  if (!pool) return c.json({ ok: false, reason: "no_database_url" }, 503);
  try {
    await pool.query("SELECT 1");
    return c.json({ ok: true });
  } catch (err) {
    return c.json({ ok: false, reason: "db_unreachable", error: err?.message }, 503);
  }
});

// ── POST /v1/startups/token ──────────────────────────────────────────────────
// Body: { token_hash: string (sha-256 hex of raw bearer) }
// Returns: { startup_id, member_id, startup_name } or 404 token_not_found
app.post("/v1/startups/token", async (c) => {
  const pool = getPool();
  if (!pool) return c.json({ error: "no_database" }, 503);
  let body;
  try { body = await c.req.json(); } catch { return c.json({ error: "invalid_json" }, 400); }
  const { token_hash } = body ?? {};
  if (!token_hash || typeof token_hash !== "string") {
    return c.json({ error: "token_hash_required" }, 400);
  }
  try {
    const { rows } = await pool.query(
      `SELECT s.id AS startup_id, sm.id AS member_id, s.name AS startup_name
         FROM startups s
         LEFT JOIN startup_members sm
           ON sm.startup_id = s.id AND sm.role = 'founder'
        WHERE s.mcp_token_hash = $1
          AND s.status IN ('active', 'onboarding')
        ORDER BY sm.created_at ASC
        LIMIT 1`,
      [token_hash],
    );
    if (!rows[0]) return c.json({ error: "token_not_found" }, 404);
    return c.json(rows[0]);
  } catch (err) {
    console.error(JSON.stringify({
      level: "error",
      event: "startup_api_token_lookup_failed",
      error: err?.message,
    }));
    return c.json({ error: "query_failed" }, 500);
  }
});

// ── POST /v1/startups ────────────────────────────────────────────────────────
// Body: { company: string, founder_email: string, founder_name?: string,
//         founder_phone?: string (ignored — schema has no phone column) }
// Returns: { startup_id, member_id, token } — token is plaintext, returned ONCE.
//          409 if a startup_members row with this founder_email already exists.
//
// Dedupe (added 28-04): `startup_members.email` has no DB UNIQUE constraint
// (multi-member startups can share a contact email), so we do an app-layer
// pre-check on the FOUNDER role only — Ridhi shouldn't be able to mint a
// second token for the same founder email. The pre-check + INSERT are NOT
// atomic; in the unlikely concurrent-call case a duplicate row could slip
// through. Acceptable for the concierge-only onboarding flow (one operator,
// no automation). A v1.5 hardening pass should add a UNIQUE partial index
// on startup_members(email) WHERE role = 'founder'.
app.post("/v1/startups", async (c) => {
  const pool = getPool();
  if (!pool) return c.json({ error: "no_database" }, 503);
  let body;
  try { body = await c.req.json(); } catch { return c.json({ error: "invalid_json" }, 400); }
  const { company, founder_email, founder_name } = body ?? {};
  if (!company || !founder_email) {
    return c.json({ error: "company_and_founder_email_required" }, 400);
  }
  // App-layer dedupe: reject if a founder member with this email already exists.
  try {
    const { rows } = await pool.query(
      `SELECT 1 FROM startup_members
         WHERE lower(email) = lower($1) AND role = 'founder'
         LIMIT 1`,
      [founder_email],
    );
    if (rows.length > 0) {
      return c.json({ error: "founder_email_already_registered" }, 409);
    }
  } catch (err) {
    console.error(JSON.stringify({
      level: "error",
      event: "startup_api_dedupe_check_failed",
      error: err?.message,
    }));
    // Fall through — if the pre-check errors, let the INSERT attempt proceed.
    // The transactional INSERT below will report its own failure.
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const rawToken = generateToken();
    const tokenHash = hashToken(rawToken);
    const { rows: [startup] } = await client.query(
      `INSERT INTO startups (name, status, mcp_token_hash, mcp_token_issued_at)
       VALUES ($1, 'active', $2, now())
       RETURNING id`,
      [company, tokenHash],
    );
    const placeholderClerkUserId = synthClerkUserId();
    const { rows: [member] } = await client.query(
      `INSERT INTO startup_members (startup_id, clerk_user_id, role, email, name)
       VALUES ($1, $2, 'founder', $3, $4)
       RETURNING id`,
      [startup.id, placeholderClerkUserId, founder_email, founder_name ?? null],
    );
    // Insert MCP channel link for this startup. ON CONFLICT DO NOTHING is
    // safe here because this is a fresh INSERT path; the /v1/channel-links
    // endpoint uses DO UPDATE for re-POST re-registration semantics.
    await client.query(
      `INSERT INTO startup_channel_links
         (startup_id, member_id, channel_type, channel_external_id, status)
       VALUES ($1, $2, 'mcp', $3, 'active')
       ON CONFLICT (startup_id, channel_type, channel_external_id) DO NOTHING`,
      [startup.id, member.id, startup.id],
    );
    await client.query("COMMIT");
    return c.json({
      startup_id: startup.id,
      member_id: member.id,
      token: rawToken,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(JSON.stringify({
      level: "error",
      event: "startup_api_create_failed",
      error: err?.message,
    }));
    return c.json({ error: "create_failed", detail: err?.message }, 500);
  } finally {
    client.release();
  }
});

// ── PATCH /v1/startups/:id/token ─────────────────────────────────────────────
// Rotate the MCP token. Returns { token } plaintext ONCE.
app.patch("/v1/startups/:id/token", async (c) => {
  const pool = getPool();
  if (!pool) return c.json({ error: "no_database" }, 503);
  const startupId = c.req.param("id");
  const rawToken = generateToken();
  const tokenHash = hashToken(rawToken);
  try {
    const { rowCount } = await pool.query(
      `UPDATE startups
          SET mcp_token_hash = $1,
              mcp_token_rotated_at = now()
        WHERE id = $2
          AND status IN ('active', 'onboarding')`,
      [tokenHash, startupId],
    );
    if (!rowCount) return c.json({ error: "startup_not_found" }, 404);
    return c.json({ token: rawToken });
  } catch (err) {
    return c.json({ error: "rotate_failed", detail: err?.message }, 500);
  }
});

// ── POST /v1/roles ───────────────────────────────────────────────────────────
// Body: { startup_id, title, description, requirements?, location?, comp_range?, embedding?: float32[768] }
// Returns: { id, title, status, created_at } and (best-effort) writes pgvector
// to role_embeddings.
app.post("/v1/roles", async (c) => {
  const pool = getPool();
  if (!pool) return c.json({ error: "no_database" }, 503);
  let body;
  try { body = await c.req.json(); } catch { return c.json({ error: "invalid_json" }, 400); }
  const {
    startup_id,
    title,
    description,
    requirements = "",
    location,
    comp_range,
    embedding,
  } = body ?? {};
  if (!startup_id || !title || !description) {
    return c.json({ error: "startup_id_title_description_required" }, 400);
  }
  try {
    const { rows: [role] } = await pool.query(
      `INSERT INTO roles (startup_id, title, description, requirements, location, comp_range)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, title, status, created_at`,
      [startup_id, title, description, requirements, location ?? null, comp_range ?? null],
    );
    if (embedding && Array.isArray(embedding) && embedding.length > 0) {
      await pool
        .query(
          `INSERT INTO role_embeddings (role_id, embedding, model)
             VALUES ($1, $2::vector, $3)
           ON CONFLICT (role_id) DO UPDATE
             SET embedding = EXCLUDED.embedding,
                 updated_at = now()`,
          [role.id, toVectorLiteral(embedding), "@cf/baai/bge-base-en-v1.5"],
        )
        .catch((err) => {
          // Embedding is best-effort — log and continue. The role row itself
          // is the load-bearing artifact; embedding can be backfilled later.
          console.warn(JSON.stringify({
            level: "warn",
            event: "startup_api_embedding_upsert_failed",
            role_id: role.id,
            error: err?.message,
          }));
        });
    }
    return c.json(role);
  } catch (err) {
    return c.json({ error: "insert_failed", detail: err?.message }, 500);
  }
});

// ── POST /v1/messages ────────────────────────────────────────────────────────
// Body: { thread_id, startup_id, content, channel?, direction?, member_id? }
// Inserts an outbound_messages row. channel defaults to 'mcp'.
app.post("/v1/messages", async (c) => {
  const pool = getPool();
  if (!pool) return c.json({ error: "no_database" }, 503);
  let body;
  try { body = await c.req.json(); } catch { return c.json({ error: "invalid_json" }, 400); }
  const {
    thread_id,
    startup_id,
    content,
    channel = "mcp",
    direction = "outbound",
    member_id,
  } = body ?? {};
  if (!thread_id || !startup_id || !content) {
    return c.json({ error: "thread_id_startup_id_content_required" }, 400);
  }
  try {
    const { rows: [msg] } = await pool.query(
      `INSERT INTO outbound_messages
         (thread_id, startup_id, member_id, content, channel, direction)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, created_at`,
      [thread_id, startup_id, member_id ?? null, content, channel, direction],
    );
    return c.json(msg);
  } catch (err) {
    return c.json({ error: "insert_failed", detail: err?.message }, 500);
  }
});

// ── POST /v1/channel-links ───────────────────────────────────────────────────
// UPSERT a startup_channel_links row. ON CONFLICT DO UPDATE — opt_in_flags
// and metadata are overwritten on re-POST; updated_at advances. THIS IS THE
// LOAD-BEARING SEMANTIC — must_haves §B2 (re-POST with different
// opt_in_flags makes second value stick).
app.post("/v1/channel-links", async (c) => {
  const pool = getPool();
  if (!pool) return c.json({ error: "no_database" }, 503);
  let body;
  try { body = await c.req.json(); } catch { return c.json({ error: "invalid_json" }, 400); }
  const {
    startup_id,
    member_id,
    channel_type,
    channel_external_id,
    opt_in_flags,
    metadata,
    status,
  } = body ?? {};
  if (!startup_id || !channel_type || !channel_external_id) {
    return c.json({ error: "startup_id_channel_type_external_id_required" }, 400);
  }
  try {
    await pool.query(
      `INSERT INTO startup_channel_links
         (startup_id, member_id, channel_type, channel_external_id, status, opt_in_flags, metadata)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb)
       ON CONFLICT (startup_id, channel_type, channel_external_id)
       DO UPDATE SET
         updated_at   = now(),
         opt_in_flags = EXCLUDED.opt_in_flags,
         metadata     = EXCLUDED.metadata,
         status       = COALESCE(EXCLUDED.status, startup_channel_links.status),
         member_id    = COALESCE(EXCLUDED.member_id, startup_channel_links.member_id)`,
      [
        startup_id,
        member_id ?? null,
        channel_type,
        channel_external_id,
        status ?? "active",
        JSON.stringify(opt_in_flags ?? {}),
        JSON.stringify(metadata ?? {}),
      ],
    );
    return c.json({ ok: true });
  } catch (err) {
    return c.json({ error: "upsert_failed", detail: err?.message }, 500);
  }
});

// ── POST /v1/action-log ──────────────────────────────────────────────────────
// Body: { startup_id, channel, action, status, member_id?, params_hash?,
//         error_code?, latency_ms?, ip_hash?, user_agent? }
app.post("/v1/action-log", async (c) => {
  const pool = getPool();
  if (!pool) return c.json({ error: "no_database" }, 503);
  let body;
  try { body = await c.req.json(); } catch { return c.json({ error: "invalid_json" }, 400); }
  const {
    member_id,
    startup_id,
    channel,
    action,
    params_hash,
    status,
    error_code,
    latency_ms,
    ip_hash,
    user_agent,
  } = body ?? {};
  if (!startup_id || !channel || !action || !status) {
    return c.json({ error: "startup_id_channel_action_status_required" }, 400);
  }
  try {
    await pool.query(
      `INSERT INTO startup_action_log
         (member_id, startup_id, channel, action, params_hash, status, error_code, latency_ms, ip_hash, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        member_id ?? null,
        startup_id,
        channel,
        action,
        params_hash ?? null,
        status,
        error_code ?? null,
        latency_ms ?? null,
        ip_hash ?? null,
        user_agent ?? null,
      ],
    );
    return c.json({ ok: true });
  } catch (err) {
    return c.json({ error: "insert_failed", detail: err?.message }, 500);
  }
});

// ── POST /v1/search/candidates ───────────────────────────────────────────────
// pgvector cosine similarity search over students who have engaged this
// startup (via inbound_messages.startup_id) plus their student_embeddings.
//
// Body: { startup_id, embedding: float32[768], filters?: {role_id?, status?},
//         limit?: number, threshold?: number }
// Returns: { results: [{id, summary, email, linkedin, score}], total_returned, threshold }
//
// Schema notes:
//   • Students don't have first_name/last_name/major/grad_year columns; we
//     return `name` (nullable). For students without `name`, fall back to
//     email or 'unknown'.
//   • The plan referenced student_profile_embeddings — that table doesn't
//     exist; we use student_embeddings (PK on student_id, vector(768)).
//   • Ownership boundary: only students this startup has previously received
//     inbound_messages from are eligible (the candidates already in the
//     funnel). Cross-startup PII leak is impossible.
app.post("/v1/search/candidates", async (c) => {
  const pool = getPool();
  if (!pool) return c.json({ error: "no_database" }, 503);
  let body;
  try { body = await c.req.json(); } catch { return c.json({ error: "invalid_json" }, 400); }
  const { startup_id, embedding, filters = {}, limit = 10, threshold } = body ?? {};
  if (!startup_id || !embedding || !Array.isArray(embedding)) {
    return c.json({ error: "startup_id_and_embedding_required" }, 400);
  }
  if (embedding.length !== 768) {
    return c.json({
      error: "embedding_dim_mismatch",
      detail: `expected 768 (bge-base-en-v1.5), got ${embedding.length}`,
    }, 400);
  }
  const maxLimit = Math.min(Math.max(1, Number(limit) || 10), 20);
  const vec = toVectorLiteral(embedding);
  try {
    const { rows } = await pool.query(
      `SELECT
         s.id,
         COALESCE(s.name, s.email, 'unknown') AS summary,
         s.email,
         s.linkedin_profile_url AS linkedin,
         s.status,
         ROUND((1 - (se.embedding <=> $1::vector))::numeric, 3) AS score
       FROM students s
       JOIN student_embeddings se ON se.student_id = s.id
       WHERE EXISTS (
         SELECT 1 FROM inbound_messages im
          WHERE im.student_id = s.id
            AND im.startup_id = $2
       )
         AND ($3::text IS NULL OR s.status = $3)
         AND ($4::float8 IS NULL OR (1 - (se.embedding <=> $1::vector)) >= $4::float8)
       ORDER BY se.embedding <=> $1::vector ASC
       LIMIT $5`,
      [
        vec,
        startup_id,
        filters?.status ?? null,
        threshold ?? null,
        maxLimit,
      ],
    );
    return c.json({
      results: rows,
      total_returned: rows.length,
      threshold: threshold ?? null,
    });
  } catch (err) {
    console.warn(JSON.stringify({
      level: "warn",
      event: "startup_api_search_failed",
      error: err?.message,
    }));
    return c.json({ error: "search_failed", detail: err?.message }, 500);
  }
});

// ── PATCH /v1/roles/:id ──────────────────────────────────────────────────────
// Update role fields. Body: { startup_id, patch: { ...allowed fields } }.
// Ownership check: WHERE id = $1 AND startup_id = $2.
app.patch("/v1/roles/:id", async (c) => {
  const pool = getPool();
  if (!pool) return c.json({ error: "no_database" }, 503);
  const roleId = c.req.param("id");
  let body;
  try { body = await c.req.json(); } catch { return c.json({ error: "invalid_json" }, 400); }
  const { startup_id, patch } = body ?? {};
  if (!startup_id || !patch || typeof patch !== "object") {
    return c.json({ error: "startup_id_and_patch_required" }, 400);
  }
  const allowed = ["title", "description", "requirements", "status", "location", "comp_range"];
  const sets = [];
  const vals = [roleId, startup_id];
  for (const k of allowed) {
    if (k in patch) {
      vals.push(patch[k]);
      sets.push(`${k} = $${vals.length}`);
    }
  }
  if (sets.length === 0) return c.json({ error: "no_valid_patch_fields" }, 400);
  // Always advance updated_at on a successful patch.
  sets.push(`updated_at = now()`);
  try {
    const { rowCount } = await pool.query(
      `UPDATE roles SET ${sets.join(", ")}
        WHERE id = $1 AND startup_id = $2`,
      vals,
    );
    if (!rowCount) return c.json({ error: "role_not_found_or_not_owned" }, 404);
    return c.json({ ok: true });
  } catch (err) {
    return c.json({ error: "update_failed", detail: err?.message }, 500);
  }
});

// ── PATCH /v1/threads/:id/mark ───────────────────────────────────────────────
// Set inbound_messages.startup_mark for all rows in a thread, scoped to the
// owning startup. Body: { startup_id, mark: 'interested'|'not_interested'|
// 'shortlisted'|'rejected' }.
//
// Implementation note: `thread_id` on inbound_messages is not a first-class
// column (the schema models threading via student_threads.thread_key and the
// inbound_messages.metadata jsonb). For Phase 28 we accept the URL path
// segment as the metadata->>'thread_id' lookup AND as a fallback id match,
// so callers can pass either a generated thread uuid or a student_threads.id.
// In practice the startup-mcp Worker will resolve the right thread id via
// search() before calling this endpoint.
app.patch("/v1/threads/:id/mark", async (c) => {
  const pool = getPool();
  if (!pool) return c.json({ error: "no_database" }, 503);
  const threadId = c.req.param("id");
  let body;
  try { body = await c.req.json(); } catch { return c.json({ error: "invalid_json" }, 400); }
  const { startup_id, mark } = body ?? {};
  if (!startup_id || !mark) return c.json({ error: "startup_id_and_mark_required" }, 400);
  const valid = ["interested", "not_interested", "shortlisted", "rejected"];
  if (!valid.includes(mark)) return c.json({ error: "invalid_mark_value" }, 400);
  try {
    const { rowCount } = await pool.query(
      `UPDATE inbound_messages
          SET startup_mark = $1
        WHERE startup_id = $2
          AND (
            id::text       = $3
            OR (metadata ->> 'thread_id') = $3
            OR (metadata ->> 'student_thread_id') = $3
          )`,
      [mark, startup_id, threadId],
    );
    // rowCount=0 is acceptable (no messages yet in thread) — return ok with count
    return c.json({ ok: true, updated: rowCount ?? 0 });
  } catch (err) {
    return c.json({ error: "mark_failed", detail: err?.message }, 500);
  }
});

// ── Start ─────────────────────────────────────────────────────────────────────

const port = parseInt(process.env.PORT ?? "3000", 10);
serve({ fetch: app.fetch, port }, () => {
  console.log(JSON.stringify({
    level: "info",
    event: "startup_api_started",
    port,
    database_url_set: Boolean(process.env.DATABASE_URL),
    startup_api_secret_set: Boolean(process.env.STARTUP_API_SECRET),
  }));
});
