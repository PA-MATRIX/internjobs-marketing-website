// apps/app/src/workflows/reply-to.mjs
//
// v1.2 EMAIL-03 (scope-add 2026-05-16) — per-conversation email aliases.
// Subdomain isolation update 2026-05-16: agent email aliases live on the
// dedicated `agent.internjobs.ai` subdomain (NOT the apex). CF Email Routing
// supports subdomains as of Oct 2025; the apex (`internjobs.ai`) stays
// reserved for human/employee email (e.g. `raj@`, `support@`) so a startup
// reply to a typo'd apex address never accidentally hits the Worker.
//
// Goal: replace the fragile From-address lookup as the PRIMARY inbound
// startup identification path. Outbound startup emails set
//   Reply-To: conv-{conversation_id}@agent.internjobs.ai
// The CF Email Routing catch-all on `agent.internjobs.ai` routes every
// `*@agent.internjobs.ai` to the Worker, which parses the `conv-{uuid}`
// prefix and passes the UUID through to the Fly app's /webhooks/email
// handler. The Fly handler validates the UUID and writes it into
// `inbound_messages.metadata.conversation_id`, so the Phase 04 Mastra
// workflow can load the conversation deterministically instead of falling
// back to a From: ⇒ startup_member lookup.
//
// Apex behavior (intentional cut-over, not a fallback): emails to
// `*@internjobs.ai` (apex) are forwarded by CF Email Routing to a human
// inbox (rentalaraj@gmail.com); they do NOT reach the Worker. A startup
// that strips the subdomain in their reply (e.g. `conv-<uuid>@internjobs.ai`)
// will land in the human inbox and the operator handles it manually.
//
// Format: literal prefix `conv-` (single hyphen) + full UUID v4 with
// hyphens, on the `agent.internjobs.ai` subdomain. Lowercased to match
// RFC 5321 address-folding behavior.

const CONV_ALIAS_REGEX = /^conv-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})@agent\.internjobs\.ai$/i;
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Build the per-conversation Reply-To alias for a given conversation_id.
 * Returns null on invalid input — callers should fall back to the default
 * sender / no Reply-To rather than crash. The alias is on the
 * `agent.internjobs.ai` subdomain (NOT the apex), so a stripped-subdomain
 * reply lands in a human inbox instead of the Worker.
 *
 * @param {string} conversationId  UUID v4 with hyphens.
 * @returns {string | null}
 */
export function buildConversationReplyTo(conversationId) {
  if (!conversationId || typeof conversationId !== "string") return null;
  const trimmed = conversationId.trim().toLowerCase();
  if (!UUID_REGEX.test(trimmed)) return null;
  return `conv-${trimmed}@agent.internjobs.ai`;
}

/**
 * Parse an inbound `To:` header. Returns the conversation UUID if the
 * address matches `conv-{uuid}@agent.internjobs.ai`, else null. Apex
 * addresses (`@internjobs.ai`) are intentionally rejected — the apex is
 * for human email, not agent routing. Lowercased before matching; callers
 * should not normalize first.
 *
 * @param {string} toHeader  Raw `To:` header value or normalized address.
 * @returns {string | null}
 */
export function parseConversationReplyTo(toHeader) {
  if (!toHeader || typeof toHeader !== "string") return null;
  // Headers may arrive as `"Name" <addr@dom>` or plain `addr@dom`. We
  // accept either by extracting the angle-bracket form when present.
  const bracketed = toHeader.match(/<([^>]+)>/);
  const candidate = (bracketed?.[1] ?? toHeader).trim().toLowerCase();
  const m = candidate.match(CONV_ALIAS_REGEX);
  return m ? m[1].toLowerCase() : null;
}

/**
 * Validate a UUID v4-ish string (8-4-4-4-12 hex with hyphens). Returns
 * the lowercased UUID on success, null otherwise. Used by /webhooks/email
 * before writing the conversation_id into metadata so a malformed Worker
 * payload doesn't poison the Phase 04 lookup.
 *
 * @param {string} uuid
 * @returns {string | null}
 */
export function validateConversationUuid(uuid) {
  if (!uuid || typeof uuid !== "string") return null;
  const trimmed = uuid.trim().toLowerCase();
  return UUID_REGEX.test(trimmed) ? trimmed : null;
}
