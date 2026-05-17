// apps/app/src/outbound.mjs
//
// v1.2 — unified outbound channel router for agent-drafted messages.
//
// AUTONOMY PIVOT (2026-05-17): this module is the channel router (SMS via
// SmsProvider, email via sendStartupEmail). It is callable from anywhere —
// typically from Mastra workflows (autonomous send) and from the
// /ops/drafts/:id/flag rate-limit retry path (operator-initiated). The
// prior "no auto-send" structural invariant — where outbound.mjs was the
// SOLE call site, invoked only from /ops/drafts/:id/approve — is GONE.
// The agent now sends autonomously on both student SMS and startup email
// sides; /ops/drafts is a read-only audit log; operators flag bad messages
// for prompt-tuning review (not pre-send approval).
//
// HISTORICAL: the structural "no auto-send" invariant lived here from
// Phase 05 (2026-05-15..16) through 2026-05-17. Rationale for pivot:
// turn-by-turn operator approval latency made conversational UX
// impossibly slow (not really conversational at all). Risk is acknowledged
// (the agent can say bad things) and is mitigated by:
//   - System-prompt-level safety guardrails (AGENT_SAFETY_GUARDRAILS in
//     student-inbound.mjs).
//   - Lakera Guard pre-LLM screening (v1.3, SAFETY-01).
//   - Operator flag-for-review post-hoc via POST /ops/drafts/:id/flag.
//
// The `sendStartupEmail` import is intentionally OWNED here so callers
// don't need a direct line to the email provider. The Mastra workflow
// passes `routeAndSend` a `smsProvider` (the Phase 01 abstraction) and a
// `config`; this module constructs the email call from
// config.cloudflareEmailAccountId and config.cloudflareEmailApiToken
// (Cloudflare Email Service, the "Agent Mail" product launched at Agents
// Week 2026 — public beta 2026-04-17).
//
// Send-failure semantics:
//   - On thrown error: caller (typically the Mastra workflow) catches,
//     writes an audit_events row event_type='auto_send_failed', and flips
//     drafts.status='failed'. No automatic retry in v1.2 (v1.3 candidate).
//   - On success: caller flips status='sent', sets sent_at and
//     provider_message_id.
//
// Channel routing:
//   - 'sms' / 'sms_spectrum' / 'sms_telnyx' → smsProvider.sendSms
//     (Phase 01 abstraction; current backend is Spectrum)
//   - 'email'                                → sendStartupEmail
//     (Phase 03 wrapper around Cloudflare Email Service)
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
    // 'approved' for retry once the CF Email Service creds are set. The
    // smoke suite never reaches this branch because OUTBOUND_DRY_RUN=true
    // short-circuits above.
    const accountId = config?.cloudflareEmailAccountId;
    const apiToken = config?.cloudflareEmailApiToken;
    if (!accountId || !apiToken) {
      throw new Error(
        "routeAndSend: cloudflare email service credentials missing — set CLOUDFLARE_EMAIL_ACCOUNT_ID and CLOUDFLARE_EMAIL_API_TOKEN to send email drafts",
      );
    }
    // v1.2 EMAIL-03 (scope-add 2026-05-16, subdomain update same-day):
    // per-conversation Reply-To alias. The Phase 04 workflow that drafts
    // startup-recipient emails stamps
    // `agent_metadata.reply_to = conv-{conversation_id}@agent.internjobs.ai`
    // on the draft row; we pass it through here so the CF Email Service
    // payload sets `reply_to` and the startup's reply comes back to the
    // catch-all Worker bound to the `agent.internjobs.ai` subdomain
    // tagged with its conversation_id. Null/missing → CF omits reply_to
    // and the inbound path falls back to the From-address lookup (legacy
    // behavior preserved).
    const replyTo = draft?.agent_metadata?.reply_to || null;
    const result = await sendStartupEmail({
      to,
      subject: "InternJobs.ai — message about your role",
      body,
      replyTo,
      accountId,
      apiToken,
    });
    return result?.providerMessageId ?? null;
  }

  throw new Error(`routeAndSend: unknown channel "${draft.channel}"`);
}
