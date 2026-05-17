// ─── Mastra in-process setup (v1.2 Phase 04) ─────────────────────────────────
//
// Pinned versions (do NOT bump without reading
// https://mastra.ai/guides/migrations/upgrade-to-v1/storage — PITFALLS #2/#3):
//
//   @mastra/core@1.35.0     (published 2026-05-15; clean upgrade from v0
//                             post-Tiktoken-per-instance OOM fix shipped
//                             in the Feb-2026 cycle. Plan PITFALLS #2/#3.)
//   @mastra/pg@1.11.0       (PostgresStore + PgVector adapter, same publish
//                             window as core 1.35.0)
//   @mastra/memory@1.18.2   (used only if/when we wire LLM thread memory)
//
// 2026-05-16 tear-out: the openai npm package was removed AND the
// internjobs-ai-proxy Worker was torn out. Embeddings and chat completions
// now POST directly to the Cloudflare Workers AI REST API (no proxy, no
// AI Gateway) via plain `fetch()` from embeddings.mjs and
// workflows/student-inbound.mjs. The Fly Node app holds a Workers-AI-
// scoped CF API token (CLOUDFLARE_AI_API_TOKEN) — one less moving part.
//
// Schema convention (PITFALLS #1, mandatory):
//   schemaName: 'mastra' for BOTH PostgresStore and PgVector. Never 'public'.
//   The 'mastra' schema is reserved in migration 0004; Mastra creates its
//   own tables under that schema on first init.
//
// Initialization strategy:
//   • initMastra(config) is called once at server boot from server.mjs,
//     AFTER createStore(config) so we share DATABASE_URL.
//   • If DATABASE_URL is missing (dev/test without DB), we return null
//     and the server logs a warning but does not crash. /healthz reports
//     mastraReady=false in that case.
//   • Mastra's PostgresStore is constructed but `init()` is lazy — the
//     first call to a memory/workflow API triggers schema creation.
//     This keeps the server boot path side-effect-free in tests.
//
// Why a plain object, not a workflow registry:
//   The Mastra `workflows` constructor option in 1.35.x expects Workflow
//   instances built via createWorkflow(). Our student-inbound workflow
//   (workflows/student-inbound.mjs) is a plain async function — it does
//   linear orchestration with no parallel/conditional steps, so the
//   createWorkflow() machinery would add complexity without value. We
//   instead expose runStudentInboundWorkflow() directly from the workflow
//   module and call it from the SMS handler. Mastra is still used for
//   storage (memory persistence) which is the real success criterion #2.
//
// Deviation from PLAN.md Step 3:
//   The plan's example imports from `@mastra/core/storage/postgres` and
//   `@mastra/core/vector/pg`. In @mastra/core@1.35.0, these adapters live
//   in the separate @mastra/pg package — we use that. The plan's
//   `mastra.workflows.triggerWorkflow(...)` API does not exist in 1.35.x;
//   the current API is `mastra.getWorkflow(id).createRun().then(r =>
//   r.start({ inputData }))`. Since we run the workflow body directly
//   (see runStudentInboundWorkflow), we don't need the trigger API.

import { Mastra } from "@mastra/core";
import { PostgresStore, PgVector } from "@mastra/pg";

let _mastra = null;
let _initAttempted = false;

export function initMastra(config) {
  if (_initAttempted) return _mastra;
  _initAttempted = true;

  const connectionString = config?.databaseUrl || process.env.DATABASE_URL || "";
  if (!connectionString) {
    console.warn(
      JSON.stringify({
        level: "warn",
        message: "mastra_init_skipped",
        reason: "no_database_url",
      }),
    );
    return null;
  }

  // ssl handling matches store.mjs: sslmode=disable -> false; otherwise
  // accept-any-cert (Neon serves a valid cert but the AWS RDS intermediate
  // is not in Node's default bundle for older deploys).
  const ssl = connectionString.includes("sslmode=disable")
    ? false
    : { rejectUnauthorized: false };

  try {
    _mastra = new Mastra({
      storage: new PostgresStore({
        id: "internjobs-mastra-store",
        connectionString,
        ssl,
        schemaName: "mastra",
      }),
      vectors: {
        internjobs_agent: new PgVector({
          id: "internjobs-mastra-vector",
          connectionString,
          ssl,
          schemaName: "mastra",
        }),
      },
      // observability/agents/workflows intentionally omitted — see header.
    });
    console.log(
      JSON.stringify({
        level: "info",
        message: "mastra_initialized",
        schema: "mastra",
        vectorIndex: "internjobs_agent",
      }),
    );
    return _mastra;
  } catch (err) {
    console.error(
      JSON.stringify({
        level: "error",
        message: "mastra_init_failed",
        error: err?.message ?? String(err),
      }),
    );
    _mastra = null;
    return null;
  }
}

export function getMastra() {
  if (!_mastra) throw new Error("Mastra not initialized");
  return _mastra;
}

export function isMastraReady() {
  return _mastra !== null;
}

// Test seam: lets the workflow smoke test reset state between runs.
export function __resetMastraForTests() {
  _mastra = null;
  _initAttempted = false;
}
