// apps/email-worker/src/index.js
//
// Cloudflare Email Worker — inbound mail ingest for the agent subdomain
// `*@agent.internjobs.ai`.
//
// Subdomain isolation (2026-05-16): the Worker is bound via CF Email Routing
// to the `agent.internjobs.ai` subdomain catch-all (NOT the apex). The apex
// `internjobs.ai` is reserved for human email (raj@, support@, etc.) and is
// forwarded by a separate apex catch-all rule to the operator's personal
// inbox (rentalaraj@gmail.com) — those emails NEVER reach this Worker. Hard
// cut-over: if a startup strips the subdomain in their reply, the message
// lands in the human inbox, NOT here. We do NOT accept apex `conv-*@`
// addresses as a transitional fallback.
//
// Flow:
//   1. Cloudflare Email Routing catch-all rule (set in CF Dashboard) routes
//      any address @agent.internjobs.ai to this Worker.
//   2. If the To: header matches `conv-<uuid>@agent.internjobs.ai`, we
//      extract the conversation_id; otherwise we treat it as a non-conv
//      subdomain email and forward to the operator fallback.
//   3. We parse a minimal envelope (from / to / subject / body) and
//      HMAC-SHA256 sign the JSON payload using EMAIL_WORKER_SECRET (Worker
//      secret).
//   4. We POST the signed payload to FLY_INGEST_URL (the Fly app's
//      /webhooks/email endpoint). The Fly app verifies the HMAC, dedupes,
//      inserts a row into inbound_messages, and logs an audit_events row.
//   5. If the POST fails (non-2xx or thrown error), we fall back to
//      `message.forward(OPERATOR_FALLBACK)` so the operator inbox always
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

// Operator fallback inbox. MUST be a verified Destination Address in
// Cloudflare Email Routing → Destination Addresses; otherwise
// `message.forward()` silently fails and we lose visibility.
const OPERATOR_FALLBACK = "rentalaraj@gmail.com";

// v1.2 EMAIL-03 (scope-add 2026-05-16, subdomain update same-day):
// per-conversation Reply-To aliases. Outbound startup emails set
// `Reply-To: conv-{conversation_id}@agent.internjobs.ai`. The catch-all
// rule on the `agent.internjobs.ai` subdomain routes every
// `*@agent.internjobs.ai` to this Worker, so we extract the UUID from
// the `To:` header and ship it to /webhooks/email in the JSON payload.
// Fly side validates and writes it into
// `inbound_messages.metadata.conversation_id`. Apex addresses
// (`@internjobs.ai`) are intentionally NOT matched — the apex is for
// human email and is routed elsewhere by CF.
const CONV_ALIAS_REGEX = /^conv-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})@agent\.internjobs\.ai$/i;

// Note (2026-05-17): a previous iteration had an AGENT_MAILBOXES branch here
// that forwarded agent-mac@ to a Fly /webhooks/agent-mail route. That path
// was sunset in favor of the agentic-inbox Worker (Phase 08). For dedicated
// agent identity mailboxes, configure CF Email Routing in the dashboard with
// SPECIFIC-ADDRESS rules pointing directly at the agentic-inbox Worker; this
// Worker stays scoped to student conversation aliases only.

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

      // EMAIL-03: parse the per-conversation alias if present. The `to`
      // header may be `"Name" <addr@dom>` or plain `addr@dom`; we accept
      // either by extracting the angle-bracket form when present.
      let conversationId = null;
      try {
        const bracketed = to.match(/<([^>]+)>/);
        const candidate = (bracketed?.[1] ?? to).trim().toLowerCase();
        const match = candidate.match(CONV_ALIAS_REGEX);
        if (match) conversationId = match[1].toLowerCase();
      } catch (_) {
        conversationId = null;
      }

      // Subdomain non-conv path: an email arrived at the agent subdomain
      // but the local-part isn't a `conv-<uuid>` alias (e.g.
      // `someone@agent.internjobs.ai`, `info@agent.internjobs.ai`). We do
      // NOT process it as an agent message — forward to the operator
      // fallback so the human sees it, then exit. Best-effort audit log
      // via HMAC POST so the Fly app can record visibility, but a failure
      // here is non-fatal because the forward is what matters.
      if (!conversationId) {
        try {
          await message.forward(OPERATOR_FALLBACK);
        } catch (forwardErr) {
          console.log(
            JSON.stringify({
              level: "error",
              message: "non_conv_subdomain_forward_failed",
              error: String(forwardErr?.message ?? forwardErr),
              from,
              to,
            }),
          );
        }
        // Best-effort audit ping — don't block / don't retry.
        try {
          const auditPayload = JSON.stringify({
            event_type: "non_conv_subdomain_email",
            from,
            to,
            subject,
            ts: Date.now(),
          });
          const encoder = new TextEncoder();
          const key = await crypto.subtle.importKey(
            "raw",
            encoder.encode(env.EMAIL_WORKER_SECRET ?? ""),
            { name: "HMAC", hash: "SHA-256" },
            false,
            ["sign"],
          );
          const sigBuf = await crypto.subtle.sign(
            "HMAC",
            key,
            encoder.encode(auditPayload),
          );
          const sigHex = bufferToHex(sigBuf);
          // Fire-and-forget; we don't await the network response result
          // semantically — we still await so the Worker doesn't terminate
          // before the request leaves, but we ignore non-2xx.
          await fetch(env.FLY_INGEST_URL, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-email-worker-secret": env.EMAIL_WORKER_SECRET ?? "",
              "x-email-hmac-sha256": sigHex,
              "x-email-audit-only": "1",
            },
            body: auditPayload,
          }).catch(() => {
            /* swallow — audit is best-effort */
          });
        } catch (_) {
          /* swallow — audit is best-effort */
        }
        return;
      }

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

      const payload = JSON.stringify({
        from,
        to,
        subject,
        body,
        ts: Date.now(),
        conversation_id: conversationId,
      });

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
