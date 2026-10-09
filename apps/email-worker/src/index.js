// apps/email-worker/src/index.js
//
// Cloudflare Email Worker — the ZONE-WIDE inbound mail catch-all for
// `internjobs.ai`.
//
// Routing topology (verified via the CF API during Phase 33, 2026-07):
// Cloudflare Email Routing has exactly ONE zone-wide catch-all rule for the
// internjobs.ai zone (matchers:[{type:"all"}]), bound to THIS Worker. A
// second, independent catch-all scoped to a single subdomain is NOT
// configurable — the dashboard's per-subdomain dropdown is a filtered VIEW of
// this one rule. So ALL mail for the zone that isn't claimed by a
// specific-address CF rule (e.g. raj@internjobs.ai → a personal inbox, which
// bypasses this Worker entirely) arrives here, and THIS FILE is what decides
// what happens to it. (An earlier version of this comment claimed the Worker
// was bound only to an `agent.internjobs.ai` catch-all and that "apex mail
// NEVER reaches this Worker" — that was never true; do not reintroduce it.)
//
// Dispatch branches in email() below, in order:
//   1. conv-<uuid>@agent.internjobs.ai — student conversation alias. Parse a
//      minimal envelope (from / to / subject / body), HMAC-SHA256 sign it with
//      EMAIL_WORKER_SECRET, and POST it to FLY_INGEST_URL (the Fly app's
//      /webhooks/email endpoint), which verifies the HMAC, dedupes, and
//      inserts an inbound_messages row. Pre-Phase-33 behavior, unchanged.
//   2. *@employers.internjobs.ai — v1.5 Phase 33. Hand the RAW MIME bytes off
//      over HTTPS to STARTUP_EMAIL_HANDOFF_URL (apps/startup's
//      POST /internal/email/inbound), authenticated with the shared
//      EMAIL_HANDOFF_SECRET. This Worker stays schema-agnostic on purpose: it
//      knows nothing about startup slugs or Postgres, it just dispatches. Any
//      failure (unconfigured, network error, timeout, or non-2xx — including
//      the startup Worker's 404 for an unknown slug) falls through to (3).
//   3. Everything else (agent.internjobs.ai non-conv addresses, apex addresses
//      without their own specific-address rule, and employers handoff
//      failures) → message.forward(operatorFallback).
//
// The operator forward is the universal safety net: on EVERY failure path,
// mail reaches a human rather than being dropped — PITFALLS #7: CF Email
// Routing drops the message silently if the Worker throws, so we MUST catch
// everything.
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

// v1.5 Phase 33: startup/employer inbound mail. Any local-part on this
// subdomain (`<slug>@employers.internjobs.ai`) is handed off to the startup
// Worker, which owns slug resolution + MIME parsing + the DB insert.
const EMPLOYERS_DOMAIN_SUFFIX = "@employers.internjobs.ai";

// Phase 33 latency budget: this outer timeout wraps a handoff whose receiving
// end (apps/startup's processInboundEmail) makes two SEQUENTIAL upstream
// fetches timed at RESOLVE_TIMEOUT_MS (4000ms) + INSERT_TIMEOUT_MS (5000ms) =
// 9000ms max. That 9000ms is NOT the whole story: the outer POST this timeout
// wraps also pays for TLS/connection setup + transmission of the raw MIME body,
// and postal-mime parsing CPU that runs BETWEEN the two inner fetches on the
// receiving end (budgeted in neither inner timeout). OVERHEAD_BUDGET_MS below
// covers that non-fetch time. The full invariant this pair must satisfy is:
//   RESOLVE_TIMEOUT_MS + INSERT_TIMEOUT_MS + OVERHEAD_BUDGET_MS <= EMPLOYERS_HANDOFF_TIMEOUT_MS
// i.e. 4000 + 5000 + 5000 = 14000 <= 20000 (6000ms real slack). This is
// enforced in CI by scripts/check-email-timeout-invariant.mjs (Plan 33-04),
// which reads the real constants from src/constants.js and apps/startup's
// email.ts — NOT by this comment, and NOT by either package's own
// self-referential unit test. If you change any of these three numbers, the CI
// script (not a human re-reading this comment) is what will catch a resulting
// violation. Wall-clock time spent awaiting fetch() is not CPU-billed on
// Workers, so keeping this ceiling generous costs nothing.
//
// ⚠️ These two constants are IMPORTED, not declared here, and must STAY that
// way. This file is the Worker ENTRYPOINT: workerd requires every named export
// of an entrypoint module to be a function/handler, so `export const FOO = 5000`
// here makes the runtime refuse to start the ENTIRE script ("Incorrect type for
// map entry ... not of type 'function or ExportedHandler'") — a total inbound-
// mail outage for the whole zone. `wrangler deploy` ACCEPTS such a script; it
// only fails at instantiation. See src/constants.js for the full story.
import { OVERHEAD_BUDGET_MS, EMPLOYERS_HANDOFF_TIMEOUT_MS } from "./constants.js";

/**
 * Hand raw inbound mail off to the startup Worker's internal endpoint.
 *
 * Returns `true` ONLY when the startup Worker accepted the message (2xx).
 * Returns `false` on every other outcome — unconfigured binding, unreadable
 * raw body, network error, timeout, or non-2xx (including the 404 the startup
 * Worker returns for an unknown/unresolvable slug). A `false` return means the
 * caller MUST fall through to the operator forward: an employers.internjobs.ai
 * email is never silently dropped.
 *
 * @param {EmailMessage} message
 * @param {string} toAddress normalized recipient (lowercased, de-bracketed)
 * @param {string} fromAddress
 * @param {{ STARTUP_EMAIL_HANDOFF_URL?: string, EMAIL_HANDOFF_SECRET?: string }} env
 * @returns {Promise<boolean>} true = handled by the startup Worker
 */
export async function dispatchToEmployersHandoff(message, toAddress, fromAddress, env) {
  if (!env.STARTUP_EMAIL_HANDOFF_URL || !env.EMAIL_HANDOFF_SECRET) {
    console.log(
      JSON.stringify({
        level: "warn",
        message: "employers_handoff_unconfigured",
        to: toAddress,
      }),
    );
    return false;
  }

  // Raw MIME bytes, NOT JSON — preserves postal-mime-compatible bytes on the
  // receiving end without a lossy text round-trip.
  let rawBuf;
  try {
    rawBuf = await new Response(message.raw).arrayBuffer();
  } catch (err) {
    console.log(
      JSON.stringify({
        level: "error",
        message: "employers_handoff_raw_read_failed",
        error: String(err?.message ?? err),
        to: toAddress,
      }),
    );
    return false;
  }

  try {
    const res = await fetch(env.STARTUP_EMAIL_HANDOFF_URL, {
      method: "POST",
      headers: {
        "content-type": "message/rfc822",
        authorization: `Bearer ${env.EMAIL_HANDOFF_SECRET}`,
        "x-startup-to": toAddress,
        "x-startup-from": fromAddress ?? "",
      },
      body: rawBuf,
      signal: AbortSignal.timeout(EMPLOYERS_HANDOFF_TIMEOUT_MS),
    });
    if (!res.ok) {
      console.log(
        JSON.stringify({
          level: "warn",
          message: "employers_handoff_non_2xx",
          status: res.status,
          to: toAddress,
        }),
      );
      return false;
    }
    return true;
  } catch (err) {
    console.log(
      JSON.stringify({
        level: "warn",
        message: "employers_handoff_fetch_failed",
        error: String(err?.message ?? err),
        to: toAddress,
      }),
    );
    return false;
  }
}

// Note (2026-05-17): a previous iteration had an AGENT_MAILBOXES branch here
// that forwarded agent-mac@ to a Fly /webhooks/agent-mail route. That path
// was sunset in favor of the agentic-inbox Worker (Phase 08). For dedicated
// agent identity mailboxes, configure CF Email Routing in the dashboard with
// SPECIFIC-ADDRESS rules pointing directly at the agentic-inbox Worker; this
// Worker stays scoped to student conversation aliases only.

export default {
  /**
   * @param {EmailMessage} message
   * @param {{
   *   EMAIL_WORKER_SECRET: string,
   *   FLY_INGEST_URL: string,
   *   STARTUP_EMAIL_HANDOFF_URL?: string,
   *   EMAIL_HANDOFF_SECRET?: string,
   * }} env
   * @param {ExecutionContext} ctx
   */
  async email(message, env, ctx) {
    // v1.5 33-08: operator fallback address, configurable via env
    // (OPERATOR_FALLBACK_EMAIL), defaulting to the hardcoded OPERATOR_FALLBACK.
    // Declared BEFORE the try so it is in scope for the outer catch's forward —
    // the universal safety net — even when an early line inside try throws.
    // Cloudflare Email Routing only delivers to a VERIFIED destination address.
    const operatorFallback =
      (env.OPERATOR_FALLBACK_EMAIL || "").trim() || OPERATOR_FALLBACK;
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

      // Non-conv path: the mail is not a `conv-<uuid>` alias. It is either
      // employers.internjobs.ai mail (branch 2 — dispatch to the startup
      // Worker), or anything else (branch 3 — forward to the operator
      // fallback so a human sees it, then exit; plus a best-effort HMAC audit
      // ping so the Fly app can record visibility, whose failure is non-fatal
      // because the forward is what matters).
      if (!conversationId) {
        // v1.5 Phase 33: employers.internjobs.ai dispatch — try the startup
        // Worker handoff first; only fall through to the generic operator
        // forward below if the handoff fails for any reason (unconfigured,
        // network error, timeout, or non-2xx — including a 404 "unknown slug"
        // from the startup Worker). This keeps the fail-safe guarantee: an
        // employers.internjobs.ai email NEVER silently disappears.
        const bracketedTo = to.match(/<([^>]+)>/);
        const candidateTo = (bracketedTo?.[1] ?? to).trim().toLowerCase();
        if (candidateTo.endsWith(EMPLOYERS_DOMAIN_SUFFIX)) {
          const handled = await dispatchToEmployersHandoff(message, candidateTo, from, env);
          if (handled) return; // success — do not also forward to the operator inbox
          // else: fall through to the existing forward + audit-ping block below
        }

        try {
          await message.forward(operatorFallback);
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
          await message.forward(operatorFallback);
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
        await message.forward(operatorFallback);
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
