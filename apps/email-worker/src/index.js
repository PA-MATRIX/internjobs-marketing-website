// apps/email-worker/src/index.js
//
// Cloudflare Email Worker — inbound mail ingest for *@internjobs.ai.
//
// Flow:
//   1. Cloudflare Email Routing catch-all rule (set in CF Dashboard) routes any
//      address @internjobs.ai to this Worker.
//   2. We parse a minimal envelope (from / to / subject / body) and HMAC-SHA256
//      sign the JSON payload using EMAIL_WORKER_SECRET (Worker secret).
//   3. We POST the signed payload to FLY_INGEST_URL (the Fly app's
//      /webhooks/email endpoint). The Fly app verifies the HMAC, dedupes,
//      inserts a row into inbound_messages, and logs an audit_events row.
//   4. If the POST fails (non-2xx or thrown error), we fall back to
//      `message.forward("ops@internjobs.ai")` so the operator inbox always
//      has visibility — PITFALLS #7: CF Email Routing drops the message
//      silently if the Worker throws, so we MUST catch everything.
//
// Notes:
//   - We use Web Crypto (`crypto.subtle`), NOT Node `crypto` — Workers don't
//     have Node's crypto module. The Fly side uses `crypto.timingSafeEqual`
//     on the same hex string and the two agree.
//   - We use `message.from` (the parsed From: header), NOT envelope sender
//     (PITFALLS #9): SPF rewriting via forwarders mangles envelope-from
//     while the header From: is the real human address.
//   - Cloudflare Queues for durable buffering is deferred to v1.3 to keep
//     v1.2 scope tight. The v1.2 mitigation for transient Fly outages is
//     the operator-inbox forward below, which gives visibility without
//     data loss. TODO(v1.3): replace operator-forward with a CF Queue +
//     retry consumer for fully durable delivery.

const OPERATOR_FALLBACK = "ops@internjobs.ai";

export default {
  /**
   * @param {EmailMessage} message
   * @param {{ EMAIL_WORKER_SECRET: string, FLY_INGEST_URL: string }} env
   * @param {ExecutionContext} ctx
   */
  async email(message, env, ctx) {
    try {
      const from = message.from ?? "";
      const to = message.to ?? "";
      const subject = message.headers.get("subject") ?? "";

      // Read the raw RFC 5322 message body. v1.2 minimum-viable: hand the raw
      // text to the Fly app, which can MIME-parse or treat as opaque. Cap at
      // 1 MB to avoid pathological abuse — anything bigger is suspect for
      // v1.2's transactional volume.
      let body = "";
      try {
        const raw = new Response(message.raw);
        body = await raw.text();
        if (body.length > 1_000_000) body = body.slice(0, 1_000_000);
      } catch (_) {
        body = "(body parse failed)";
      }

      const payload = JSON.stringify({ from, to, subject, body, ts: Date.now() });

      // HMAC-SHA256 sign the payload with the shared secret.
      const encoder = new TextEncoder();
      const key = await crypto.subtle.importKey(
        "raw",
        encoder.encode(env.EMAIL_WORKER_SECRET ?? ""),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"],
      );
      const sigBuf = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
      const sigHex = bufferToHex(sigBuf);

      // Best-effort POST to the Fly app. On any failure → operator fallback.
      let postOk = false;
      try {
        const res = await fetch(env.FLY_INGEST_URL, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-email-worker-secret": env.EMAIL_WORKER_SECRET ?? "",
            "x-email-hmac-sha256": sigHex,
          },
          body: payload,
        });
        postOk = res.ok;
        if (!postOk) {
          console.log(
            JSON.stringify({
              level: "warn",
              message: "fly_ingest_non_2xx",
              status: res.status,
              from,
              to,
            }),
          );
        }
      } catch (err) {
        console.log(
          JSON.stringify({
            level: "warn",
            message: "fly_ingest_fetch_failed",
            error: String(err?.message ?? err),
            from,
            to,
          }),
        );
      }

      if (!postOk) {
        // Forward the raw inbound mail to the operator inbox so the message
        // is never silently lost. Phase-04 will pick up replay from the
        // operator side until the Fly ingest is healthy.
        try {
          await message.forward(OPERATOR_FALLBACK);
        } catch (forwardErr) {
          console.log(
            JSON.stringify({
              level: "error",
              message: "fallback_forward_failed",
              error: String(forwardErr?.message ?? forwardErr),
            }),
          );
        }
      }
    } catch (outerErr) {
      // Final safety net: never let the Worker throw. CF Email Routing
      // silently drops the message if `email()` throws (PITFALLS #7).
      console.log(
        JSON.stringify({
          level: "error",
          message: "email_worker_unhandled",
          error: String(outerErr?.message ?? outerErr),
        }),
      );
      try {
        await message.forward(OPERATOR_FALLBACK);
      } catch (_) {
        /* swallow — last resort, nothing more we can do */
      }
    }
  },
};

function bufferToHex(buf) {
  const bytes = new Uint8Array(buf);
  let out = "";
  for (let i = 0; i < bytes.length; i += 1) {
    out += bytes[i].toString(16).padStart(2, "0");
  }
  return out;
}
