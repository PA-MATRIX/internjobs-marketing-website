// apps/app/src/email/outbound.mjs
//
// Thin wrapper around the Resend Node SDK for v1.2 startup-facing outbound
// transactional email. Phase 05 (APPROVE-02) is the call-site — operator
// approval gate triggers `sendStartupEmail()` directly. No retry/backoff
// here; Resend handles transient failures, and the caller decides whether
// to surface a failure to the operator.
//
// Mirrors the SmsProvider seam philosophy (SMS-01): single implementation
// for v1.2, loose interface so a swap to Postmark / SES / etc. is a
// drop-in module replacement, not a rewrite of call sites.

import { Resend } from "resend";

// Module-scoped client cache keyed by apiKey. Caching by key (not just a
// single _client) handles the (rare) case of rotated keys mid-process and
// keeps a separate client per credential — no cross-tenant key bleed.
const _clients = new Map();

function getClient(apiKey) {
  if (!apiKey) throw new Error("sendStartupEmail: apiKey is required");
  let client = _clients.get(apiKey);
  if (!client) {
    client = new Resend(apiKey);
    _clients.set(apiKey, client);
  }
  return client;
}

/**
 * Send a transactional email to a startup.
 *
 * @param {object} opts
 * @param {string | string[]} opts.to  - startup recipient email(s)
 * @param {string} opts.subject        - subject line
 * @param {string} opts.body           - plain-text body (Resend also accepts html;
 *                                       v1.2 ships text-only)
 * @param {string} [opts.replyTo]      - optional; Phase 04 uses this for the
 *                                       conv_{conversation_id}@internjobs.ai
 *                                       reply-to pattern
 * @param {string} opts.apiKey         - Resend API key (config.resendApiKey)
 * @returns {Promise<{ id: string }>}  - Resend message id
 */
export async function sendStartupEmail({ to, subject, body, replyTo, apiKey }) {
  if (!to) throw new Error("sendStartupEmail: to is required");
  if (!subject) throw new Error("sendStartupEmail: subject is required");
  if (typeof body !== "string") throw new Error("sendStartupEmail: body must be a string");

  const resend = getClient(apiKey);

  const params = {
    from: "InternJobs.ai <noreply@internjobs.ai>",
    to,
    subject,
    text: body,
  };
  if (replyTo) params.replyTo = replyTo;

  const { data, error } = await resend.emails.send(params);
  if (error) {
    const message = typeof error === "string" ? error : error.message || JSON.stringify(error);
    throw new Error(`Resend send failed: ${message}`);
  }
  return { id: data?.id ?? "" };
}
