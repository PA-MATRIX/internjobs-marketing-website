// ─── Embedding hooks (v1.2 Phase 04, AGENT-03 — 2026-05-16 Workers AI direct) ─
//
// Locked model + dimension (matches migration 0005 student_embeddings and
// role_embeddings vector(768) shape). Per PITFALLS #18.
//
//   provider:  Cloudflare Workers AI (DIRECT REST — no proxy Worker)
//   model:     @cf/baai/bge-base-en-v1.5
//   dimension: 768
//   transport: HTTPS fetch to api.cloudflare.com/client/v4/accounts/{id}/ai/run/...
//              with Authorization: Bearer {CLOUDFLARE_AI_API_TOKEN}.
//
// 2026-05-16 tear-out: The Fly Node app no longer goes through a proxy
// Worker. The user provided a CF API token scoped for Workers AI direct
// access, so we call the REST API straight from Node. One less moving part.
// AI Gateway can be added later by changing the URL (gateway:{id} prefix)
// without touching this code's call shape.
//
// Background-only contract: callers MUST fire embedding writes WITHOUT
// awaiting (`.catch(logErr)`), not inline. A failing CF call must NOT
// block a profile save or role create. See store.mjs saveProfileContext
// and server.mjs roles handlers.
//
// Test seam:
//   • If CLOUDFLARE_AI_ACCOUNT_ID or CLOUDFLARE_AI_API_TOKEN is missing,
//     openaiEmbed returns null (no throw). writeStudentEmbedding /
//     writeRoleEmbedding silently no-op when given a null vector. This
//     lets dev/test runs proceed without secrets — same fail-soft posture
//     as the prior OpenAI / proxy-Worker paths.
//   • For deterministic testing, set EMBED_PROVIDER=stub. The stub returns
//     a 768-dim float array seeded by a hash of the input — same input
//     always yields the same vector, different inputs yield different
//     vectors. Used by the Phase 04 smoke test.
//
// Naming: the exported function is still called `openaiEmbed` for
// import-site back-compat (workflows + hooks). It now talks to Workers AI
// directly, not OpenAI and not the proxy Worker. Renaming the symbol is
// a future hygiene pass.

import { createHash } from "node:crypto";

const EMBED_MODEL = "@cf/baai/bge-base-en-v1.5";
const EMBED_DIM = 768;

export async function openaiEmbed(text) {
  if (process.env.EMBED_PROVIDER === "stub") return stubEmbed(text);

  const accountId = process.env.CLOUDFLARE_AI_ACCOUNT_ID;
  const apiToken = process.env.CLOUDFLARE_AI_API_TOKEN;
  if (!accountId || !apiToken) return null;

  const trimmed = String(text || "").slice(0, 8000);
  if (!trimmed.trim()) return null;

  try {
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${EMBED_MODEL}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ text: trimmed }),
      },
    );
    if (!res.ok) {
      console.error(
        JSON.stringify({
          level: "error",
          message: "workers_ai_embed_non_2xx",
          status: res.status,
        }),
      );
      return null;
    }
    const json = await res.json().catch(() => null);
    // Workers AI envelope: { result: { data: [[...768 floats]], shape, pooling }, success, errors }
    if (json?.success === false) {
      console.error(
        JSON.stringify({
          level: "error",
          message: "workers_ai_embed_unsuccessful",
          errors: json?.errors || null,
        }),
      );
      return null;
    }
    const vec = Array.isArray(json?.result?.data) ? json.result.data[0] : null;
    if (!Array.isArray(vec) || vec.length !== EMBED_DIM) {
      console.error(
        JSON.stringify({
          level: "error",
          message: "workers_ai_embed_bad_shape",
          got: vec?.length ?? null,
          expected: EMBED_DIM,
        }),
      );
      return null;
    }
    return vec;
  } catch (err) {
    console.error(
      JSON.stringify({
        level: "error",
        message: "workers_ai_embed_failed",
        error: err?.message ?? String(err),
      }),
    );
    return null;
  }
}

export async function writeStudentEmbedding(pool, studentId, text) {
  const vec = await openaiEmbed(text);
  if (!vec) return { written: false, reason: "no_vector" };
  const literal = toPgVectorLiteral(vec);
  await pool.query(
    `insert into student_embeddings (student_id, embedding, model, updated_at)
     values ($1, $2::vector, $3, now())
     on conflict (student_id) do update set
       embedding  = excluded.embedding,
       model      = excluded.model,
       updated_at = excluded.updated_at`,
    [studentId, literal, EMBED_MODEL],
  );
  return { written: true };
}

export async function writeRoleEmbedding(pool, roleId, text) {
  const vec = await openaiEmbed(text);
  if (!vec) return { written: false, reason: "no_vector" };
  const literal = toPgVectorLiteral(vec);
  await pool.query(
    `insert into role_embeddings (role_id, embedding, model, updated_at)
     values ($1, $2::vector, $3, now())
     on conflict (role_id) do update set
       embedding  = excluded.embedding,
       model      = excluded.model,
       updated_at = excluded.updated_at`,
    [roleId, literal, EMBED_MODEL],
  );
  return { written: true };
}

// Log helper used by background hooks. Kept tiny so it can be passed to
// .catch() without allocating a closure per call.
export function logEmbedErr(err) {
  console.error(
    JSON.stringify({
      level: "error",
      message: "embedding_background_failed",
      error: err?.message ?? String(err),
    }),
  );
}

// pgvector accepts text input of the form '[0.1,0.2,...]' cast to ::vector.
// Using a parameterized literal is safer + faster than building a string with
// template interpolation, and avoids float precision drift from JSON.stringify.
function toPgVectorLiteral(vec) {
  return "[" + vec.map((v) => Number(v).toString()).join(",") + "]";
}

// Deterministic stub vector for tests. Hashes the input with sha-256, then
// expands the 32 hash bytes into 768 normalized floats. Same input → same
// vector (idempotent); different inputs → different vectors (discriminative).
function stubEmbed(text) {
  const seed = createHash("sha256").update(String(text || "")).digest();
  const out = new Array(EMBED_DIM);
  for (let i = 0; i < EMBED_DIM; i += 1) {
    const byte = seed[i % seed.length];
    // Scale byte (0..255) to roughly [-1, 1], with a per-index jitter so the
    // resulting vector has variation across all 768 slots, not just 32.
    out[i] = ((byte + i * 7) % 256) / 127.5 - 1;
  }
  return out;
}
