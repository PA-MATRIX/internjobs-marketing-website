// apps/app/src/outbound.mjs
//
// v1.2 Phase 05 — the SOLE module permitted to invoke provider send
// methods (smsProvider.sendSms, sendStartupEmail).
//
// HARD CONSTRAINT (verified at deploy time by grep):
//   No other file under apps/app/src/ may call smsProvider.sendSms or
//   sendStartupEmail directly. The one pre-existing exception is the
//   v1.1 pairing-welcome SMS path in server.mjs (auto-send on
//   pairing_confirmed + welcomeNeeded) — that pre-dates the draft queue
//   and is NOT an agent-drafted message. "No auto-send" applies
//   specifically to drafts table rows.
//
// The `sendStartupEmail` import is intentionally OWNED here so server.mjs
// has no direct line to Resend. The /ops/drafts/:id/approve handler
// passes `routeAndSend` a `smsProvider` (the same Phase 01 abstraction
// the welcome path uses) and a config; this module constructs the email
// provider internally from config.resendApiKey.
//
// Send-failure semantics (see Phase 05 PLAN.md success criteria):
//   - On thrown error: caller (server.mjs /ops/drafts/:id/approve) catches,
//     writes an audit_events row event_type='draft_send_failed', and leaves
//     drafts.status='approved' so the operator can retry. No automatic
//     retry in v1.2.
//   - On success: caller flips status='sent', sets sent_at and
//     provider_message_id.
//
// Channel routing:
//   - 'sms' / 'sms_spectrum' / 'sms_telnyx' → smsProvider.sendSms
//     (Phase 01 abstraction; current backend is Spectrum)
//   - 'email'                                → sendStartupEmail
//     (Phase 03 wrapper around Resend)
//   - anything else                          → throw (unknown channel)

import { sendStartupEmail } from "./email/outbound.mjs";

/**
 * Route a draft to the correct outbound provider and return the provider
 * message id on success. Throws on failure.
 *
 * @param {object} draft   Draft row. Required fields: channel, channel_address, body.
 *                          Optional: edited_body (used when operator edited).
 * @param {object} deps    { smsProvider, config }
 * @returns {Promise<string|null>}  Provider message id (may be null for
 *                                   skipped_configuration_missing).
 */
export async function routeAndSend(draft, { smsProvider, config }) {
  if (!draft) throw new Error("routeAndSend: draft is required");
  const body = draft.edited_body || draft.body || "";
  const to = draft.channel_address || draft.channelAddress || "";
  const channel = String(draft.channel || "").toLowerCase();

  // Dry-run short-circuit — used by the smoke suite. When OUTBOUND_DRY_RUN=true
  // the providers are not invoked at all, so the test asserts the
  // approve → 'sent' transition without spinning up real SMS/email.
  if (config?.outboundDryRun) {
    return `dryrun-${channel}-${Date.now()}`;
  }

  if (channel === "sms" || channel === "sms_spectrum" || channel === "sms_telnyx") {
    if (!smsProvider?.sendSms) throw new Error("routeAndSend: smsProvider.sendSms not available");
    const result = await smsProvider.sendSms(to, body);
    // Phase 01 contract: { providerMessageId, status, metadata }.
    if (result?.status === "provider_error") {
      throw new Error(`sms_provider_error: ${JSON.stringify(result.metadata || {})}`);
    }
    return result?.providerMessageId ?? null;
  }

  if (channel === "email") {
    // Email config is missing → fail loudly. The operator sees the
    // 'draft_send_failed' audit row and an error banner; status stays
    // 'approved' for retry once RESEND_API_KEY is set. The smoke suite
    // never reaches this branch because OUTBOUND_DRY_RUN=true short-circuits
    // above.
    const apiKey = config?.resendApiKey;
    if (!apiKey) throw new Error("routeAndSend: resendApiKey missing — set RESEND_API_KEY to send email drafts");
    const result = await sendStartupEmail({
      to,
      subject: "InternJobs.ai — message about your role",
      body,
      apiKey,
    });
    return result?.id ?? null;
  }

  throw new Error(`routeAndSend: unknown channel "${draft.channel}"`);
}
