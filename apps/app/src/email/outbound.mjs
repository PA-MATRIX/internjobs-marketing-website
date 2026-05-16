// apps/app/src/email/outbound.mjs
//
// Thin wrapper around the Cloudflare Email Service REST API for v1.2
// startup-facing outbound transactional email. Phase 05 (APPROVE-02) is the
// call-site — operator approval gate triggers `sendStartupEmail()` via
// outbound.mjs. No retry/backoff here; the caller (server.mjs
// /ops/drafts/:id/approve) writes an audit_events 'draft_send_failed' row
// and leaves drafts.status='approved' so the operator can retry.
//
// Why Cloudflare Email Service (not Resend):
//   - internjobs.ai DNS is already on Cloudflare (hard constraint for CF
//     Email Sending — sending domain MUST be on Cloudflare DNS).
//   - CF Email Routing already handles inbound (Phase 03 EMAIL-01).
//     Using CF for outbound collapses one vendor.
//   - "Agent Mail" (Cloudflare's name) launched at Agents Week 2026,
//     public beta as of 2026-04-17.
//
// API contract (POST /client/v4/accounts/{account_id}/email/sending/send):
//   Required body: to, from, subject, AND at least one of html/text.
//   Success: 200 with { success: true, result: { delivered, permanent_bounces,
//     queued } }.
//   Error: { success: false, errors: [{ code, message }] } at any non-200.
//   Max message size 5 MiB. Error code 10004 = rate-limit (caller decides
//   on retry; we just surface the message).
//
// We deliberately use `fetch()` instead of an SDK — CF's REST surface is
// small enough that a dependency would be net negative.

const CF_API_BASE = "https://api.cloudflare.com/client/v4";

// Default sender. Configurable via the `from` arg per call. v1.2 always
// uses `noreply@internjobs.ai`; the override is here so a future per-tenant
// sender (e.g. `intros@internjobs.ai`) is a single call-site change.
const DEFAULT_FROM = "InternJobs.ai <noreply@internjobs.ai>";

/**
 * Send a transactional email to a startup via Cloudflare Email Service.
 *
 * @param {object} opts
 * @param {string | string[]} opts.to       - startup recipient email(s)
 * @param {string} opts.subject             - subject line
 * @param {string} opts.body                - plain-text body (mapped to CF's
 *                                            `text` field; v1.2 ships text-only,
 *                                            no separate HTML path)
 * @param {string} [opts.replyTo]           - optional; Phase 04 uses this for the
 *                                            conv_{conversation_id}@internjobs.ai
 *                                            reply-to pattern. Mapped to `reply_to`.
 * @param {string} opts.accountId           - Cloudflare account ID (config.cloudflareEmailAccountId)
 * @param {string} opts.apiToken            - Cloudflare API token, Account-scoped
 *                                            with "Email Sending" permission
 *                                            (config.cloudflareEmailApiToken)
 * @param {string|object} [opts.from]       - optional sender override. Either a
 *                                            string like '"Name" <addr@dom>' or
 *                                            an object {address, name}. Defaults
 *                                            to DEFAULT_FROM when not provided.
 * @returns {Promise<{providerMessageId: string, status: 'sent', metadata: object}>}
 *   CF doesn't return a per-recipient message id like Resend did. We
 *   synthesize providerMessageId as `cf-{first delivered or queued
 *   address}-{ms timestamp}` so drafts.provider_message_id stays unique and
 *   debuggable; the full CF result is preserved in metadata for audit.
 */
export async function sendStartupEmail({
  to,
  subject,
  body,
  replyTo,
  accountId,
  apiToken,
  from,
}) {
  if (!to) throw new Error("sendStartupEmail: to is required");
  if (!subject) throw new Error("sendStartupEmail: subject is required");
  if (typeof body !== "string") throw new Error("sendStartupEmail: body must be a string");
  if (!accountId) throw new Error("sendStartupEmail: accountId is required");
  if (!apiToken) throw new Error("sendStartupEmail: apiToken is required");

  // The CF "Onboard Domain" flow can require a verified sender. If the
  // caller didn't pass `from`, we use the default but log a single
  // warning line so an operator sees "you fell back to the default" in
  // Fly logs without surfacing secrets.
  let sender = from;
  if (!sender) {
    sender = DEFAULT_FROM;
    console.warn(
      JSON.stringify({
        level: "warn",
        message: "send_startup_email_default_from",
        from: DEFAULT_FROM,
      }),
    );
  }

  const payload = {
    to,
    from: sender,
    subject,
    text: body,
  };
  if (replyTo) payload.reply_to = replyTo;

  const url = `${CF_API_BASE}/accounts/${encodeURIComponent(accountId)}/email/sending/send`;

  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    // Network-level failure (DNS, TLS, socket). Surface as a thrown error
    // so the upstream /ops/drafts/:id/approve catch writes
    // 'draft_send_failed' and leaves status='approved' for retry.
    throw new Error(
      `Cloudflare Email Service send failed: network error: ${err?.message || String(err)}`,
    );
  }

  let parsed = null;
  try {
    parsed = await response.json();
  } catch (_) {
    // CF should always return JSON; treat non-JSON as a hard fail.
    throw new Error(
      `Cloudflare Email Service send failed: non-JSON response (status ${response.status})`,
    );
  }

  if (!response.ok || parsed?.success === false) {
    const firstError =
      Array.isArray(parsed?.errors) && parsed.errors[0]
        ? parsed.errors[0].message || JSON.stringify(parsed.errors[0])
        : `HTTP ${response.status}`;
    throw new Error(`Cloudflare Email Service send failed: ${firstError}`);
  }

  const result = parsed?.result || {};
  const delivered = Array.isArray(result.delivered) ? result.delivered : [];
  const queued = Array.isArray(result.queued) ? result.queued : [];
  const firstAddr = delivered[0] || queued[0] || "unknown";
  const providerMessageId = `cf-${firstAddr}-${Date.now()}`;

  return {
    providerMessageId,
    status: "sent",
    metadata: {
      delivered,
      queued,
      permanent_bounces: Array.isArray(result.permanent_bounces) ? result.permanent_bounces : [],
    },
  };
}
