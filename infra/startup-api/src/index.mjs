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
//   GET   /v1/startups/:id/stats   — active role count + 7-day action count
//                                    (added in 28-03 for me() tool)
//   POST  /v1/roles                — insert a role + store pgvector embedding
//   POST  /v1/messages             — insert an outbound_messages row (channel='mcp')
//   POST  /v1/channel-links        — UPSERT a startup_channel_links row
//                                    (ON CONFLICT DO UPDATE — opt_in_flags +
//                                    updated_at advance on re-POST)
//   POST  /v1/action-log           — insert a startup_action_log row
//   POST  /v1/search/candidates    — pgvector cosine similarity search
//   POST  /v1/search/:scope        — structured search (scope ∈
//                                    {roles, threads, messages, members,
//                                    startups}; added in 28-03)
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

// ── POST /v1/startups/identity-by-clerk-id ───────────────────────────────────
// Body: { clerk_user_id: string }
// Returns: { startup_id, member_id, startup_name, role } or 404 not_found.
//
// Added in 28.5-02 to support the apps/startups CF Pages Function identity
// resolution path. The Pages Function forwards a Clerk session JWT as
// X-Clerk-Token, and 28.5-03 will add JWKS verification on the Fly side
// that calls this endpoint after extracting `sub` from the verified JWT.
//
// Why a dedicated endpoint instead of overloading /v1/startups/token: the
// MCP path is keyed on `mcp_token_hash` (the MCP install token), while the
// web path is keyed on `clerk_user_id` set during signup (28.5-05 webhook).
// Two distinct lookups, two distinct routes — explicit > clever.
app.post("/v1/startups/identity-by-clerk-id", async (c) => {
  const pool = getPool();
  if (!pool) return c.json({ error: "no_database" }, 503);
  let body;
  try { body = await c.req.json(); } catch { return c.json({ error: "invalid_json" }, 400); }
  const { clerk_user_id } = body ?? {};
  if (!clerk_user_id || typeof clerk_user_id !== "string") {
    return c.json({ error: "clerk_user_id_required" }, 400);
  }
  try {
    const { rows } = await pool.query(
      `SELECT s.id AS startup_id, sm.id AS member_id,
              s.name AS startup_name, sm.role
         FROM startup_members sm
         JOIN startups s ON s.id = sm.startup_id
        WHERE sm.clerk_user_id = $1
          AND s.status IN ('active', 'onboarding')
        ORDER BY sm.created_at ASC
        LIMIT 1`,
      [clerk_user_id],
    );
    if (!rows[0]) return c.json({ error: "not_found" }, 404);
    return c.json(rows[0]);
  } catch (err) {
    console.error(JSON.stringify({
      level: "error",
      event: "startup_api_identity_lookup_failed",
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

// ── GET /v1/startups/:id/stats ───────────────────────────────────────────────
// Snapshot stats for the me() MCP tool: active_role_count + actions_last_7d.
// Wired by apps/startup/workers/tools/me.ts. Bearer-authed; no body.
app.get("/v1/startups/:id/stats", async (c) => {
  const pool = getPool();
  if (!pool) return c.json({ error: "no_database" }, 503);
  const startupId = c.req.param("id");
  try {
    const { rows: [stats] } = await pool.query(
      `SELECT
         (SELECT count(*)::int FROM roles
            WHERE startup_id = $1 AND status = 'active') AS active_role_count,
         (SELECT count(*)::int FROM startup_action_log
            WHERE startup_id = $1
              AND created_at > now() - interval '7 days') AS actions_last_7d,
         (SELECT max(created_at) FROM startup_action_log
            WHERE startup_id = $1) AS last_action_at`,
      [startupId],
    );
    return c.json({
      startup_id: startupId,
      active_role_count: stats?.active_role_count ?? 0,
      actions_last_7d: stats?.actions_last_7d ?? 0,
      last_action_at: stats?.last_action_at ?? null,
    });
  } catch (err) {
    return c.json({ error: "stats_failed", detail: err?.message }, 500);
  }
});

// ── POST /v1/search/:scope ───────────────────────────────────────────────────
// Structured search for the non-candidates scopes (roles | threads | messages |
// members | startups). Wired by apps/startup/workers/tools/search.ts. The
// `candidates` scope still goes through POST /v1/search/candidates (pgvector).
//
// Body: { startup_id, query, filters?, limit? } — startup_id is ALWAYS the
// caller's auth-resolved id; the Worker enforces that. Each scope adds
// WHERE startup_id = $auth at SQL so cross-startup leaks are impossible.
//
// Result envelope: { results: [{id, summary, score, ...extras}], total_returned }
//
// `score` is 1.0 for structured hits (no relevance ranking — just SQL match).
// The Worker's handleSearch() copies this verbatim into the MCP envelope.
const STRUCTURED_SCOPES = new Set([
  "roles",
  "threads",
  "messages",
  "members",
  "startups",
]);

app.post("/v1/search/:scope", async (c) => {
  const pool = getPool();
  if (!pool) return c.json({ error: "no_database" }, 503);
  const scope = c.req.param("scope");
  if (!STRUCTURED_SCOPES.has(scope)) {
    return c.json({
      error: "invalid_scope",
      detail: `scope must be one of: ${[...STRUCTURED_SCOPES].join(", ")} (candidates uses /v1/search/candidates)`,
    }, 400);
  }
  let body;
  try { body = await c.req.json(); } catch { return c.json({ error: "invalid_json" }, 400); }
  const { startup_id, query, limit = 10 } = body ?? {};
  if (!startup_id) return c.json({ error: "startup_id_required" }, 400);
  const q = typeof query === "string" ? query : "";
  const like = `%${q.replace(/[%_]/g, (m) => `\\${m}`)}%`; // escape LIKE metacharacters
  const maxLimit = Math.min(Math.max(1, Number(limit) || 10), 20);

  try {
    let rows = [];
    if (scope === "roles") {
      const result = await pool.query(
        `SELECT
           id::text                          AS id,
           title                             AS summary,
           1.0::float8                       AS score,
           status,
           description,
           location,
           comp_range,
           created_at
         FROM roles
         WHERE startup_id = $1
           AND ($2 = '' OR title ILIKE $3 OR description ILIKE $3 OR requirements ILIKE $3)
         ORDER BY created_at DESC
         LIMIT $4`,
        [startup_id, q, like, maxLimit],
      );
      rows = result.rows;
    } else if (scope === "threads") {
      // A "thread" here is a unique student×startup conversation surface.
      // We aggregate inbound_messages by student_id (no first-class thread_id
      // column — see 28-01 schema notes). Each result row is one student's
      // engagement with this startup; the id is the student_id (resolvable
      // via search('candidates') for full details).
      const result = await pool.query(
        `SELECT
           s.id::text                        AS id,
           COALESCE(s.name, s.email, 'unknown') AS summary,
           1.0::float8                       AS score,
           s.email,
           s.linkedin_profile_url            AS linkedin,
           max(im.created_at)                AS last_inbound_at,
           count(im.id)::int                 AS message_count,
           max(im.startup_mark)              AS startup_mark
         FROM inbound_messages im
         JOIN students s ON s.id = im.student_id
         WHERE im.startup_id = $1
           AND ($2 = '' OR s.name ILIKE $3 OR s.email ILIKE $3 OR im.body ILIKE $3)
         GROUP BY s.id, s.name, s.email, s.linkedin_profile_url
         ORDER BY max(im.created_at) DESC
         LIMIT $4`,
        [startup_id, q, like, maxLimit],
      );
      rows = result.rows;
    } else if (scope === "messages") {
      const result = await pool.query(
        `SELECT
           id::text                          AS id,
           CASE
             WHEN length(content) > 120
             THEN substring(content, 1, 117) || '...'
             ELSE content
           END                               AS summary,
           1.0::float8                       AS score,
           channel,
           direction,
           thread_id,
           delivery_status,
           created_at
         FROM outbound_messages
         WHERE startup_id = $1
           AND ($2 = '' OR content ILIKE $3)
         ORDER BY created_at DESC
         LIMIT $4`,
        [startup_id, q, like, maxLimit],
      );
      rows = result.rows;
    } else if (scope === "members") {
      const result = await pool.query(
        `SELECT
           id::text                          AS id,
           COALESCE(name, email)             AS summary,
           1.0::float8                       AS score,
           role,
           email,
           created_at
         FROM startup_members
         WHERE startup_id = $1
           AND ($2 = '' OR name ILIKE $3 OR email ILIKE $3)
         ORDER BY created_at ASC
         LIMIT $4`,
        [startup_id, q, like, maxLimit],
      );
      rows = result.rows;
    } else if (scope === "startups") {
      // Caller can ONLY see their own startup record. The id filter is
      // hardcoded to startup_id — query string is ignored for matching but
      // included in response for shape consistency.
      const result = await pool.query(
        `SELECT
           id::text                          AS id,
           name                              AS summary,
           1.0::float8                       AS score,
           domain,
           website,
           status,
           created_at,
           updated_at
         FROM startups
         WHERE id = $1
         LIMIT 1`,
        [startup_id],
      );
      rows = result.rows;
    }
    return c.json({ results: rows, total_returned: rows.length });
  } catch (err) {
    console.warn(JSON.stringify({
      level: "warn",
      event: "startup_api_structured_search_failed",
      scope,
      error: err?.message,
    }));
    return c.json({ error: "search_failed", detail: err?.message }, 500);
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

// ── v1.4 Phase 28.5 Plan 04 — per-startup agent email endpoints ──────────────
//
// Five endpoints land in this block:
//   • GET   /v1/startups/check-slug?agent_email=<addr>  — slug-uniqueness probe
//   • PATCH /v1/startups/:id/agent-email                — write agent_email column
//   • GET   /v1/channels/resolve?email=<addr>           — recipient → startup_id
//   • POST  /v1/messages/inbound                        — write inbound_messages row
//   • (existing) POST /v1/channel-links — reused by the admin endpoint to insert
//                                          the channel_type='email' row
//
// All five sit behind the same Authorization: Bearer STARTUP_API_SECRET gate
// from the /v1/* middleware at the top of this file.

// ── GET /v1/startups/check-slug ──────────────────────────────────────────────
// Query: ?agent_email=<addr>
// Returns 200 { exists: true, startup_id } if the address is already in use;
// returns 404 { error: "not_found" } if it's free.
// Used by apps/startup/workers/lib/slug.ts::reserveUniqueSlug to advance
// through "-1", "-2", … on collision.
app.get("/v1/startups/check-slug", async (c) => {
  const pool = getPool();
  if (!pool) return c.json({ error: "no_database" }, 503);
  const agentEmail = c.req.query("agent_email");
  if (!agentEmail) return c.json({ error: "agent_email_required" }, 400);
  try {
    const { rows } = await pool.query(
      `SELECT id FROM startups WHERE lower(agent_email) = lower($1) LIMIT 1`,
      [agentEmail],
    );
    if (rows.length === 0) return c.json({ error: "not_found" }, 404);
    return c.json({ exists: true, startup_id: rows[0].id });
  } catch (err) {
    return c.json({ error: "lookup_failed", detail: err?.message }, 500);
  }
});

// ── PATCH /v1/startups/:id/agent-email ───────────────────────────────────────
// Body: { agent_email: string }
// Sets startups.agent_email. Returns 200 { ok, agent_email } on success,
// 404 if the startup doesn't exist, 409 if the agent_email collides (UNIQUE
// constraint trip — this can happen if a parallel onboarding raced past
// check-slug; caller should re-run with a fresh slug).
app.patch("/v1/startups/:id/agent-email", async (c) => {
  const pool = getPool();
  if (!pool) return c.json({ error: "no_database" }, 503);
  const startupId = c.req.param("id");
  let body;
  try { body = await c.req.json(); } catch { return c.json({ error: "invalid_json" }, 400); }
  const { agent_email } = body ?? {};
  if (!agent_email || typeof agent_email !== "string") {
    return c.json({ error: "agent_email_required" }, 400);
  }
  try {
    const { rowCount } = await pool.query(
      `UPDATE startups SET agent_email = $1 WHERE id = $2 AND status IN ('active', 'onboarding')`,
      [agent_email, startupId],
    );
    if (!rowCount) return c.json({ error: "startup_not_found" }, 404);
    return c.json({ ok: true, agent_email });
  } catch (err) {
    // 23505 = unique_violation (Postgres) — surface as 409 so caller can
    // re-mint a slug rather than logging a generic 500.
    if (err?.code === "23505") {
      return c.json({ error: "agent_email_conflict", detail: err?.message }, 409);
    }
    return c.json({ error: "update_failed", detail: err?.message }, 500);
  }
});

// ── GET /v1/channels/resolve ─────────────────────────────────────────────────
// Query: ?email=<addr>
// Returns 200 { startup_id, member_id } if a startup_channel_links row exists
// with channel_type='email' and channel_external_id matching (case-insensitive).
// Returns 404 if no row matches.
// Used by the catch-all email handler in apps/startup/workers/routes/email.ts
// to route inbound mail to the correct startup.
app.get("/v1/channels/resolve", async (c) => {
  const pool = getPool();
  if (!pool) return c.json({ error: "no_database" }, 503);
  const email = c.req.query("email");
  if (!email) return c.json({ error: "email_required" }, 400);
  try {
    const { rows } = await pool.query(
      `SELECT startup_id, member_id
         FROM startup_channel_links
        WHERE channel_type = 'email'
          AND lower(channel_external_id) = lower($1)
          AND status = 'active'
        LIMIT 1`,
      [email],
    );
    if (rows.length === 0) return c.json({ error: "not_found" }, 404);
    return c.json({
      startup_id: rows[0].startup_id,
      member_id: rows[0].member_id,
    });
  } catch (err) {
    return c.json({ error: "lookup_failed", detail: err?.message }, 500);
  }
});

// ── v1.4 Phase 29-01 — Telnyx SMS adapter endpoints ──────────────────────────
//
// Three endpoints land here:
//   • GET   /v1/channel-links/resolve            — phone (or other external_id) → (startup_id, member_id)
//   • PATCH /v1/channel-links/:id/opt-out        — STOP handling for TCPA compliance
//   • GET   /v1/startups/:id/candidates          — position-indexed candidate lookup
//                                                   for the show_candidate MCP action
//
// All sit behind the same Authorization: Bearer STARTUP_API_SECRET gate.

// ── GET /v1/channel-links/resolve ────────────────────────────────────────────
// Query: ?channel_type=<type>&external_id=<value>
// Returns 200 { startup_id, member_id, startup_name } on hit, 404 on miss.
// Used by apps/startup/workers/lib/resolveChannelLink.ts to map an inbound
// SMS sender phone → owning startup. Generic across channel types so the
// same helper covers telnyx-voice in Phase 29-02.
app.get("/v1/channel-links/resolve", async (c) => {
  const pool = getPool();
  if (!pool) return c.json({ error: "no_database" }, 503);
  const channelType = c.req.query("channel_type");
  const externalId = c.req.query("external_id");
  if (!channelType || !externalId) {
    return c.json({ error: "channel_type_and_external_id_required" }, 400);
  }
  try {
    const { rows } = await pool.query(
      `SELECT cl.startup_id, cl.member_id, s.name AS startup_name
         FROM startup_channel_links cl
         JOIN startups s ON s.id = cl.startup_id
        WHERE cl.channel_type = $1
          AND cl.channel_external_id = $2
          AND cl.status = 'active'
        LIMIT 1`,
      [channelType, externalId],
    );
    if (rows.length === 0) return c.json({ error: "not_found" }, 404);
    return c.json({
      startup_id: rows[0].startup_id,
      member_id: rows[0].member_id,
      startup_name: rows[0].startup_name,
    });
  } catch (err) {
    return c.json({ error: "lookup_failed", detail: err?.message }, 500);
  }
});

// ── PATCH /v1/channel-links/:id/opt-out ──────────────────────────────────────
// TCPA-compliant unconditional opt-out. Sets:
//   status = 'opted_out'
//   opt_in_flags = '{}'::jsonb
// Used by routes/telnyx.ts when an inbound message matches STOP / UNSUBSCRIBE /
// CANCEL / END / QUIT. Body is empty (the path id is the load-bearing input).
// Returns 200 { ok: true } even if the row was already opted out (idempotent).
app.patch("/v1/channel-links/:id/opt-out", async (c) => {
  const pool = getPool();
  if (!pool) return c.json({ error: "no_database" }, 503);
  const linkId = c.req.param("id");
  try {
    const { rowCount } = await pool.query(
      `UPDATE startup_channel_links
          SET status = 'opted_out',
              opt_in_flags = '{}'::jsonb,
              updated_at = now()
        WHERE id = $1`,
      [linkId],
    );
    if (!rowCount) return c.json({ error: "channel_link_not_found" }, 404);
    return c.json({ ok: true });
  } catch (err) {
    return c.json({ error: "opt_out_failed", detail: err?.message }, 500);
  }
});

// ── GET /v1/startups/:id/candidates ──────────────────────────────────────────
// Query: ?position=<1..9>
// Returns the Nth most-recent candidate (unique student × startup pair) for
// this startup. position=1 → most recent inbound; position=9 → 9th-most-recent.
// Mirrors the existing /v1/search/:scope `threads` scope ordering (max
// inbound_messages.created_at DESC per student) but exposes a single row by
// 1-indexed position for the show_candidate MCP action.
//
// Returns 200 { candidate_name, role_title, application_summary, thread_id }
// or 404 if fewer than `position` candidates exist for this startup.
app.get("/v1/startups/:id/candidates", async (c) => {
  const pool = getPool();
  if (!pool) return c.json({ error: "no_database" }, 503);
  const startupId = c.req.param("id");
  const positionRaw = c.req.query("position");
  const position = parseInt(positionRaw ?? "1", 10);
  if (!Number.isFinite(position) || position < 1 || position > 9) {
    return c.json({ error: "position_must_be_1_to_9" }, 400);
  }
  const offset = position - 1;
  try {
    // One row per student-startup pair; latest inbound determines ordering.
    // student_threads → role_id linkage gives us the role.title (best-effort —
    // some candidates may not have an attached role yet, in which case role_title
    // returns null).
    const { rows } = await pool.query(
      `SELECT
         COALESCE(s.name, s.email, 'unknown')         AS candidate_name,
         (
           SELECT r.title FROM student_threads st
            JOIN roles r ON r.id = st.role_id
            WHERE st.student_id = im_agg.student_id
              AND st.startup_id = $1
            ORDER BY st.created_at DESC
            LIMIT 1
         )                                            AS role_title,
         (
           SELECT CASE
                    WHEN length(im.body) > 140
                    THEN substring(im.body, 1, 137) || '...'
                    ELSE im.body
                  END
             FROM inbound_messages im
            WHERE im.student_id = im_agg.student_id
              AND im.startup_id = $1
            ORDER BY im.created_at DESC
            LIMIT 1
         )                                            AS application_summary,
         im_agg.student_id::text                      AS thread_id
       FROM (
         SELECT im.student_id, max(im.created_at) AS last_at
           FROM inbound_messages im
          WHERE im.startup_id = $1
            AND im.student_id IS NOT NULL
          GROUP BY im.student_id
          ORDER BY max(im.created_at) DESC
          OFFSET $2
          LIMIT 1
       ) im_agg
       JOIN students s ON s.id = im_agg.student_id`,
      [startupId, offset],
    );
    if (rows.length === 0) return c.json({ error: "not_found" }, 404);
    return c.json(rows[0]);
  } catch (err) {
    console.warn(JSON.stringify({
      level: "warn",
      event: "startup_api_candidates_lookup_failed",
      error: err?.message,
    }));
    return c.json({ error: "lookup_failed", detail: err?.message }, 500);
  }
});

// ── v1.4 Phase 29-03 — Weekly touchbase cron endpoints ───────────────────────
//
// Three endpoints land here:
//   • GET   /v1/touchbase/due-startups               — list startups eligible
//     for this week's touchbase SMS (cron pre-pass, paged 100 at a time).
//   • PATCH /v1/channel-links/:id/touchbase-sent     — mark the row's
//     `last_touchbase_at = NOW()` after the cron successfully dispatched SMS.
//   • GET   /v1/startups/:startup_id/fresh-candidates — up to 3 of the most
//     recent active candidate threads for the cron's per-startup SMS body.
//   • PATCH /v1/channel-links/:id/opt-in-touchbase   — flip
//     `opt_in_flags.weekly_touchbase = true` when founder replies "yes" to
//     the post-voice-onboarding opt-in prompt.
//
// All sit behind the same Authorization: Bearer STARTUP_API_SECRET gate as
// the rest of /v1/*. Cron-side caller is the CF Worker scheduled() handler.

// ── GET /v1/touchbase/due-startups ───────────────────────────────────────────
// Returns startups that need a touchbase SMS this week (or initially).
// Eligibility filter:
//   - channel_type = 'telnyx-sms'
//   - status = 'active'                       (opted-out rows excluded)
//   - opt_in_flags->>'weekly_touchbase' = 'true'
//   - last_touchbase_at IS NULL OR < NOW() - 7d
// Sorted by last_touchbase_at ASC NULLS FIRST (oldest/never-touched first).
// Hard cap of 100 per cron run — pilot volume is well below this, but the
// cap protects the Worker from runaway loops if backfill day arrives.
app.get("/v1/touchbase/due-startups", async (c) => {
  const pool = getPool();
  if (!pool) return c.json({ error: "no_database" }, 503);
  try {
    const { rows } = await pool.query(
      `SELECT
         cl.id::text                        AS channel_link_id,
         cl.startup_id::text                AS startup_id,
         cl.channel_external_id             AS phone,
         cl.member_id::text                 AS member_id,
         s.name                             AS startup_name,
         m.name                             AS founder_name
       FROM startup_channel_links cl
       JOIN startups s        ON s.id = cl.startup_id
       LEFT JOIN startup_members m ON m.id = cl.member_id
       WHERE cl.channel_type = 'telnyx-sms'
         AND cl.status = 'active'
         AND (cl.opt_in_flags->>'weekly_touchbase')::boolean = true
         AND (cl.last_touchbase_at IS NULL
              OR cl.last_touchbase_at < NOW() - INTERVAL '7 days')
       ORDER BY cl.last_touchbase_at ASC NULLS FIRST
       LIMIT 100`,
    );
    return c.json({ due: rows });
  } catch (err) {
    console.warn(JSON.stringify({
      level: "warn",
      event: "startup_api_touchbase_due_failed",
      error: err?.message,
    }));
    return c.json({ error: "query_failed", detail: err?.message }, 500);
  }
});

// ── PATCH /v1/channel-links/:id/touchbase-sent ───────────────────────────────
// Marks the channel-link row's last_touchbase_at to NOW(). Called by the
// scheduled() handler after a touchbase SMS was successfully dispatched.
// Idempotent: subsequent PATCHes update updated_at + last_touchbase_at again.
app.patch("/v1/channel-links/:id/touchbase-sent", async (c) => {
  const pool = getPool();
  if (!pool) return c.json({ error: "no_database" }, 503);
  const linkId = c.req.param("id");
  try {
    const { rowCount } = await pool.query(
      `UPDATE startup_channel_links
          SET last_touchbase_at = NOW(),
              updated_at = NOW()
        WHERE id = $1`,
      [linkId],
    );
    if (!rowCount) return c.json({ error: "channel_link_not_found" }, 404);
    return c.json({ ok: true });
  } catch (err) {
    return c.json({ error: "update_failed", detail: err?.message }, 500);
  }
});

// ── PATCH /v1/channel-links/:id/opt-in-touchbase ─────────────────────────────
// Body: { opt_in?: boolean } — default true.
// Merges {"weekly_touchbase": <opt_in>} into opt_in_flags via jsonb || .
// Used by the "yes" fast-path in routes/telnyx.ts after voice onboarding.
app.patch("/v1/channel-links/:id/opt-in-touchbase", async (c) => {
  const pool = getPool();
  if (!pool) return c.json({ error: "no_database" }, 503);
  const linkId = c.req.param("id");
  let body = {};
  try { body = await c.req.json(); } catch { /* empty body is fine */ }
  const optIn = body?.opt_in === false ? false : true;
  try {
    const { rowCount } = await pool.query(
      `UPDATE startup_channel_links
          SET opt_in_flags = COALESCE(opt_in_flags, '{}'::jsonb)
                             || jsonb_build_object('weekly_touchbase', $2::boolean),
              updated_at = NOW()
        WHERE id = $1`,
      [linkId, optIn],
    );
    if (!rowCount) return c.json({ error: "channel_link_not_found" }, 404);
    return c.json({ ok: true, weekly_touchbase: optIn });
  } catch (err) {
    return c.json({ error: "opt_in_failed", detail: err?.message }, 500);
  }
});

// ── GET /v1/startups/:startup_id/fresh-candidates ────────────────────────────
// Up to 3 of the most recent inbound candidate threads for this startup,
// used by the weekly cron to compose the touchbase SMS body ("3 new this
// week — reply 1/2/3"). Identical row shape to the show_candidate response
// but returns an ARRAY (caller maps positions 1..N).
//
// Returns { candidates: [{ thread_id, candidate_name, role_title, summary }] }.
// Returns { candidates: [] } if the startup has no recent candidates — caller
// (scheduled() handler) sends the "no new candidates this week" variant.
app.get("/v1/startups/:startup_id/fresh-candidates", async (c) => {
  const pool = getPool();
  if (!pool) return c.json({ error: "no_database" }, 503);
  const startupId = c.req.param("startup_id");
  try {
    const { rows } = await pool.query(
      `SELECT
         im_agg.student_id::text              AS thread_id,
         COALESCE(s.name, s.email, 'unknown') AS candidate_name,
         (
           SELECT r.title FROM student_threads st
             JOIN roles r ON r.id = st.role_id
            WHERE st.student_id = im_agg.student_id
              AND st.startup_id = $1
            ORDER BY st.created_at DESC
            LIMIT 1
         )                                    AS role_title,
         (
           SELECT CASE
                    WHEN length(im.body) > 100
                    THEN substring(im.body, 1, 97) || '...'
                    ELSE im.body
                  END
             FROM inbound_messages im
            WHERE im.student_id = im_agg.student_id
              AND im.startup_id = $1
            ORDER BY im.created_at DESC
            LIMIT 1
         )                                    AS summary
       FROM (
         SELECT im.student_id, max(im.created_at) AS last_at
           FROM inbound_messages im
          WHERE im.startup_id = $1
            AND im.student_id IS NOT NULL
          GROUP BY im.student_id
          ORDER BY max(im.created_at) DESC
          LIMIT 3
       ) im_agg
       JOIN students s ON s.id = im_agg.student_id
       ORDER BY im_agg.last_at DESC`,
      [startupId],
    );
    return c.json({ candidates: rows });
  } catch (err) {
    console.warn(JSON.stringify({
      level: "warn",
      event: "startup_api_fresh_candidates_failed",
      error: err?.message,
    }));
    return c.json({ error: "lookup_failed", detail: err?.message }, 500);
  }
});

// ── POST /v1/messages/inbound ────────────────────────────────────────────────
// Body: { provider, provider_event_id?, channel_type, channel_address,
//         startup_id, member_id?, direction?, from_address?, subject?, body,
//         body_text?, body_html?, metadata? }
//
// Inserts an inbound_messages row. Mirrors the schema from migration 0003b
// (provider/channel_type/channel_address/startup_id/student_id/direction/body
// /metadata). The optional from_address + subject + body_text + body_html
// fields are stuffed into metadata for v1.4 since the canonical schema only
// has a single body column (the threading code in v1.5 can promote them to
// first-class columns via a follow-up migration).
//
// Idempotency: when provider_event_id is supplied (RFC Message-ID for
// 'cloudflare-email'), the partial UNIQUE index on
// (provider, provider_event_id) WHERE provider_event_id IS NOT NULL
// dedupes resends. ON CONFLICT DO NOTHING returns 200 on dupe so the
// caller doesn't see noise on retries.
app.post("/v1/messages/inbound", async (c) => {
  const pool = getPool();
  if (!pool) return c.json({ error: "no_database" }, 503);
  let body;
  try { body = await c.req.json(); } catch { return c.json({ error: "invalid_json" }, 400); }
  const {
    provider,
    provider_event_id,
    channel_type,
    channel_address,
    startup_id,
    direction = "inbound",
    from_address,
    subject,
    body: messageBody,
    body_text,
    body_html,
    metadata = {},
  } = body ?? {};
  if (!provider || !channel_type || !startup_id || messageBody == null) {
    return c.json({
      error: "provider_channel_type_startup_id_body_required",
    }, 400);
  }
  // Fold from/subject/text/html into metadata so we can persist them
  // without a schema change.
  const fullMetadata = {
    ...metadata,
    from_address: from_address ?? null,
    subject: subject ?? null,
    body_text: body_text ?? null,
    body_html: body_html ?? null,
  };
  try {
    const { rows } = await pool.query(
      `INSERT INTO inbound_messages
         (provider, provider_event_id, channel_type, channel_address,
          startup_id, direction, body, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
       ON CONFLICT (provider, provider_event_id)
         WHERE provider_event_id IS NOT NULL DO NOTHING
       RETURNING id, created_at`,
      [
        provider,
        provider_event_id ?? null,
        channel_type,
        channel_address ?? null,
        startup_id,
        direction,
        messageBody,
        JSON.stringify(fullMetadata),
      ],
    );
    if (rows.length === 0) {
      // ON CONFLICT path — duplicate provider_event_id. Return ok with a
      // duplicate flag so the caller knows it's a no-op resend.
      return c.json({ ok: true, duplicate: true });
    }
    return c.json({ ok: true, id: rows[0].id, created_at: rows[0].created_at });
  } catch (err) {
    return c.json({ error: "insert_failed", detail: err?.message }, 500);
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
