// infra/graph-api/src/index.mjs
//
// internjobs-graph-api — thin Hono/Node REST proxy for FalkorDB.
//
// Bridges the Parrot Worker (Cloudflare, HTTP-only) to the private FalkorDB
// instance (internjobs-graph.internal:6379, Redis wire protocol). The Worker
// cannot reach FalkorDB directly — `cloudflare:sockets` blocks private IPs and
// the `falkordb` npm client crashes at init on the Workers runtime. This app
// runs on Fly (Node.js, same private network as internjobs-graph) and holds the
// falkordb npm client. The Worker calls this via HTTPS fetch().
//
// API surface (minimal by design):
//   POST /query       — execute a Cypher query, return {data, stats}
//   POST /close-todo  — set :Todo.valid_to = timestamp() for one source_id (v1.4 Phase 23-01)
//   GET  /health      — liveness probe (also probes FalkorDB with RETURN 1)
//
// Auth: Authorization: Bearer <GRAPH_API_SECRET> (shared secret, constant-time
// compare). CF Access is overkill for a Worker-to-Fly internal service call.
//
// Fail-soft posture: /health returns ok:false (not 5xx) when FalkorDB is down
// so the Parrot Worker's healthz can distinguish proxy-down from db-down.
// /query returns 503 JSON when FalkorDB is unreachable.
//
// Connection singleton: one FalkorDB client per process (module-level), lazy-
// connected on first query. Same pattern as graph.mjs. Reconnects on error.
//
// Env vars (set via flyctl secrets set + Infisical /internjobs-ai):
//   GRAPH_API_SECRET  — shared Bearer token (32-byte hex, generated with openssl)
//   FALKORDB_URL      — redis://default:<pw>@internjobs-graph.internal:6379
//   PORT              — default 3000 (set in fly.toml [env])

import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { FalkorDB } from "falkordb";
import { timingSafeEqual } from "node:crypto";

const GRAPH_NAME = "internjobs";

// ── Connection singleton ─────────────────────────────────────────────────────

let _client = null;
let _clientPromise = null;
let _connectFailedLogged = false;

async function getClient() {
  const url = process.env.FALKORDB_URL;
  if (!url) return null;
  if (_client) return _client;
  if (_clientPromise) return _clientPromise;

  _clientPromise = FalkorDB.connect({ url })
    .then((client) => {
      _client = client;
      _clientPromise = null;
      _connectFailedLogged = false;
      client.on?.("error", (err) => {
        if (!_connectFailedLogged) {
          console.warn(JSON.stringify({
            level: "warn",
            event: "graph_api_client_error",
            error: err?.message ?? String(err),
          }));
          _connectFailedLogged = true;
        }
        _client = null;
        _clientPromise = null;
      });
      return client;
    })
    .catch((err) => {
      if (!_connectFailedLogged) {
        console.warn(JSON.stringify({
          level: "warn",
          event: "graph_api_connect_failed",
          error: err?.message ?? String(err),
        }));
        _connectFailedLogged = true;
      }
      _clientPromise = null;
      return null;
    });

  return _clientPromise;
}

// ── Auth helper ──────────────────────────────────────────────────────────────

function verifyBearer(req) {
  const secret = process.env.GRAPH_API_SECRET;
  if (!secret) return false; // no secret configured = deny all
  const auth = req.headers.get("authorization") ?? "";
  if (!auth.toLowerCase().startsWith("bearer ")) return false;
  const provided = auth.slice(7).trim();
  // Constant-time compare to prevent timing attacks on the shared secret.
  // timingSafeEqual requires equal-length buffers, so the length check is
  // explicit AND first (before allocating any compare buffers).
  if (provided.length !== secret.length) return false;
  try {
    return timingSafeEqual(Buffer.from(provided), Buffer.from(secret));
  } catch {
    return false;
  }
}

// ── Hono app ─────────────────────────────────────────────────────────────────

const app = new Hono();

// GET /health — liveness probe. Returns ok:true only when FalkorDB is reachable.
// The Parrot Worker's healthz checks BOTH graph_ready (FalkorDB ping via student
// app) AND graph_proxy_reachable (this endpoint). Keeping them separate means
// the Parrot Worker can distinguish proxy-down from db-down.
app.get("/health", async (c) => {
  const client = await getClient();
  if (!client) {
    return c.json({ ok: false, reason: "falkordb_unreachable" }, 503);
  }
  try {
    await client.selectGraph(GRAPH_NAME).query("RETURN 1");
    return c.json({ ok: true });
  } catch (err) {
    return c.json({ ok: false, reason: "falkordb_query_failed", error: err?.message }, 503);
  }
});

// POST /query — execute a Cypher query. Body: { cypher: string, params?: object }.
// Returns: { data: unknown[], stats: object }.
// The Worker's graph.ts is the only caller; it passes the same cypher + params
// it would have passed to the falkordb client directly.
app.post("/query", async (c) => {
  if (!verifyBearer(c.req.raw)) {
    return c.json({ error: "unauthorized" }, 401);
  }

  let body;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid_json" }, 400);
  }

  const { cypher, params } = body ?? {};
  if (!cypher || typeof cypher !== "string") {
    return c.json({ error: "cypher_required" }, 400);
  }

  const client = await getClient();
  if (!client) {
    return c.json({ error: "falkordb_unreachable" }, 503);
  }

  try {
    const res = await client.selectGraph(GRAPH_NAME).query(cypher, {
      params: params ?? {},
    });
    // Pass data + stats through verbatim. The Worker's graph.ts parses the
    // same shape it would receive from a direct falkordb client call.
    return c.json({ data: res?.data ?? [], stats: res?.stats ?? {} });
  } catch (err) {
    console.warn(JSON.stringify({
      level: "warn",
      event: "graph_api_query_failed",
      error: err?.message ?? String(err),
    }));
    return c.json({ error: "query_failed", detail: err?.message }, 500);
  }
});

// POST /close-todo — Phase 23-01 (CLOSETODO-01..04).
// Sets :Todo.valid_to = timestamp() for the :Todo node(s) matching
// (source_id=$thread_id, employee_id=$employee_id, valid_to IS NULL).
// The runAutoClear cron in apps/parrot/workers/lib/auto-clear.ts picks
// these up within 10 minutes (5-min grace window + up to 5-min cron interval)
// and calls EmployeeMailboxDO.resolveTodo() to flip the SQLite row.
//
// Body: { thread_id: string, employee_id: string, resolution_text?: string }
// Returns: { ok: true, closed_count: number } on success
//
// Multi-row note: if multiple :Todo nodes share the same (source_id, employee_id)
// — possible on re-extraction runs — SET updates all of them. That's correct
// behavior; all todos from the same source resolve together.
app.post("/close-todo", async (c) => {
  if (!verifyBearer(c.req.raw)) {
    return c.json({ error: "unauthorized" }, 401);
  }

  let body;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid_json" }, 400);
  }

  const { thread_id, employee_id, resolution_text } = body ?? {};
  if (!thread_id || typeof thread_id !== "string" || !employee_id || typeof employee_id !== "string") {
    return c.json({ error: "thread_id_and_employee_id_required" }, 400);
  }

  const client = await getClient();
  if (!client) {
    return c.json({ error: "falkordb_unreachable" }, 503);
  }

  try {
    const res = await client.selectGraph(GRAPH_NAME).query(
      `MATCH (t:Todo)
       WHERE t.source_id = $thread_id AND t.employee_id = $employee_id AND t.valid_to IS NULL
       SET t.valid_to = timestamp()
       RETURN count(t) AS closed_count`,
      { params: { thread_id, employee_id } },
    );
    const rows = res?.data ?? [];
    const row = rows[0];
    let closedCount = 0;
    if (row) {
      const raw = Array.isArray(row)
        ? row[0]
        : row.closed_count ?? row["count(t)"];
      const n = Number(raw);
      if (Number.isFinite(n)) closedCount = n;
    }
    return c.json({ ok: true, closed_count: closedCount });
  } catch (err) {
    console.warn(JSON.stringify({
      level: "warn",
      event: "graph_api_close_todo_failed",
      thread_id,
      employee_id,
      resolution_text_present: Boolean(resolution_text),
      error: err?.message ?? String(err),
    }));
    return c.json({ error: "close_failed", detail: err?.message }, 500);
  }
});

// ── Start ────────────────────────────────────────────────────────────────────

const port = parseInt(process.env.PORT ?? "3000", 10);
serve({ fetch: app.fetch, port }, () => {
  console.log(JSON.stringify({
    level: "info",
    event: "graph_api_started",
    port,
    falkordb_url_set: Boolean(process.env.FALKORDB_URL),
    graph_api_secret_set: Boolean(process.env.GRAPH_API_SECRET),
  }));
});
