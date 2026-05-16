// apps/ai-worker/src/index.js
//
// Cloudflare Worker — Workers AI proxy for the Fly Node app.
//
// Flow:
//   1. Fly app POSTs JSON to https://internjobs-ai-proxy.<acct>.workers.dev/embed
//      or /chat with header `x-ai-worker-secret: <shared secret>`.
//   2. We constant-time compare the secret against env.AI_WORKER_SECRET
//      (Worker secret) and reject on mismatch.
//   3. We call env.AI.run(...) using the native Workers AI binding — no CF
//      API token is needed on the Node side.
//   4. We optionally pass `{ gateway: { id: 'internjobs-ai' } }` so that if
//      an AI Gateway by that name exists, the call is routed through it for
//      caching + analytics. If the gateway doesn't exist, the call still
//      succeeds (best-effort routing).
//
// Endpoints:
//   POST /embed  → { text: string }  → { embedding: number[768], model }
//                  Model: @cf/baai/bge-base-en-v1.5 (768-dim).
//   POST /chat   → { messages, max_tokens?, temperature? }
//                  → { response: string, model }
//                  Model: @cf/meta/llama-3.1-8b-instruct.
//
// Why Workers AI binding (not AI Gateway REST):
//   - Zero new user-managed CF API tokens (the binding is intrinsic to the
//     Worker — wrangler OAuth is enough to deploy).
//   - Native Worker AI runtime is the fastest path (no extra hop).
//   - AI Gateway routing is still available via the `gateway` option below
//     when/if the operator creates the "internjobs-ai" gateway in CF.

const EMBED_MODEL = "@cf/baai/bge-base-en-v1.5";
const CHAT_MODEL = "@cf/meta/llama-3.1-8b-instruct";
const GATEWAY_ID = "internjobs-ai";

export default {
  /**
   * @param {Request} request
   * @param {{ AI: any, AI_WORKER_SECRET: string }} env
   * @param {ExecutionContext} ctx
   */
  async fetch(request, env, ctx) {
    try {
      if (request.method !== "POST") {
        return json({ error: "method_not_allowed" }, 405);
      }
      const contentType = request.headers.get("content-type") || "";
      if (!contentType.toLowerCase().includes("application/json")) {
        return json({ error: "unsupported_media_type" }, 415);
      }

      const presentedSecret = request.headers.get("x-ai-worker-secret") || "";
      if (!constantTimeEqual(presentedSecret, env.AI_WORKER_SECRET || "")) {
        return json({ error: "unauthorized" }, 401);
      }

      let payload;
      try {
        payload = await request.json();
      } catch (_) {
        return json({ error: "invalid_json" }, 400);
      }

      const url = new URL(request.url);
      if (url.pathname === "/embed") {
        return handleEmbed(payload, env);
      }
      if (url.pathname === "/chat") {
        return handleChat(payload, env);
      }
      return json({ error: "not_found" }, 404);
    } catch (outerErr) {
      console.log(
        JSON.stringify({
          level: "error",
          message: "ai_worker_unhandled",
          error: String(outerErr?.message ?? outerErr),
        }),
      );
      return json({ error: "internal_error" }, 500);
    }
  },
};

async function handleEmbed(payload, env) {
  const text = typeof payload?.text === "string" ? payload.text : "";
  if (!text.trim()) {
    return json({ error: "missing_text" }, 400);
  }
  try {
    // Workers AI returns { shape: [1, 768], data: [[...]], pooling: 'mean' }.
    // We extract data[0] as the 768-dim vector.
    const res = await runWithGateway(env, EMBED_MODEL, { text });
    const vec = Array.isArray(res?.data) ? res.data[0] : null;
    if (!Array.isArray(vec) || vec.length !== 768) {
      return json(
        {
          error: "bad_embedding_shape",
          got: Array.isArray(vec) ? vec.length : null,
          expected: 768,
        },
        502,
      );
    }
    return json({ embedding: vec, model: EMBED_MODEL }, 200);
  } catch (err) {
    console.log(
      JSON.stringify({
        level: "error",
        message: "workers_ai_embed_failed",
        error: String(err?.message ?? err),
      }),
    );
    return json({ error: "workers_ai_failed", detail: String(err?.message ?? err) }, 502);
  }
}

async function handleChat(payload, env) {
  const messages = Array.isArray(payload?.messages) ? payload.messages : null;
  if (!messages || messages.length === 0) {
    return json({ error: "missing_messages" }, 400);
  }
  const maxTokens = Number.isFinite(payload?.max_tokens) ? payload.max_tokens : 512;
  const temperature = Number.isFinite(payload?.temperature) ? payload.temperature : 0.7;

  try {
    const res = await runWithGateway(env, CHAT_MODEL, {
      messages,
      max_tokens: maxTokens,
      temperature,
    });
    // Workers AI returns { response: string, ... } for instruct models.
    const text = typeof res?.response === "string" ? res.response : "";
    return json({ response: text, model: CHAT_MODEL }, 200);
  } catch (err) {
    console.log(
      JSON.stringify({
        level: "error",
        message: "workers_ai_chat_failed",
        error: String(err?.message ?? err),
      }),
    );
    return json({ error: "workers_ai_failed", detail: String(err?.message ?? err) }, 502);
  }
}

// Best-effort gateway routing: try with `{ gateway: { id } }` first; if that
// fails because the named gateway doesn't exist in the CF account, retry
// without the gateway option. For any other error, surface it to the caller.
//
// Cloudflare error shapes we treat as "gateway missing":
//   • Error code 2001 with message "Please configure AI Gateway in the
//     Cloudflare dashboard" — returned when the gateway id is not found.
//   • Text containing "gateway not found" / "no such gateway" / "gateway
//     does not exist" — defensive against alternate phrasings.
async function runWithGateway(env, model, input) {
  try {
    return await env.AI.run(model, input, { gateway: { id: GATEWAY_ID } });
  } catch (err) {
    const raw = String(err?.message ?? err);
    const msg = raw.toLowerCase();
    const isMissingGateway =
      msg.includes('"code":2001') ||
      msg.includes("configure ai gateway") ||
      (msg.includes("gateway") &&
        (msg.includes("not found") ||
          msg.includes("no such") ||
          msg.includes("does not exist")));
    if (isMissingGateway) {
      return await env.AI.run(model, input);
    }
    throw err;
  }
}

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

// Constant-time string equality. Workers don't have Node's
// crypto.timingSafeEqual, so we hand-roll it. Length mismatch returns false
// after looping over the longer string to keep the timing equal-ish.
function constantTimeEqual(a, b) {
  const aStr = String(a || "");
  const bStr = String(b || "");
  const len = Math.max(aStr.length, bStr.length);
  let diff = aStr.length === bStr.length ? 0 : 1;
  for (let i = 0; i < len; i += 1) {
    const ca = i < aStr.length ? aStr.charCodeAt(i) : 0;
    const cb = i < bStr.length ? bStr.charCodeAt(i) : 0;
    diff |= ca ^ cb;
  }
  return diff === 0;
}
