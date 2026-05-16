/**
 * SmsProvider interface.
 *
 * Every implementation must export a factory `createSmsProvider(config)`
 * that returns an object satisfying this shape. The interface is the only
 * thing v1.2 call-sites (server.mjs, spectrum-listener.mjs) should depend on;
 * v1.3 will add a TelnyxSmsProvider implementation behind the same shape.
 *
 * sendSms(to, body)
 *   → Promise<{
 *       providerMessageId: string|null,
 *       status: 'sent'|'skipped_configuration_missing'|'provider_error',
 *       metadata: object
 *     }>
 *   Sends an outbound SMS-like message. Returns a normalized result.
 *
 * verifyWebhook(req, rawBody)
 *   → { ok: boolean, reason?: string, mode?: string }
 *   Validates inbound webhook authenticity. Returns { ok: true } if authentic.
 *
 * parseInbound(payload)
 *   → InboundMessage
 *   Normalizes a raw webhook payload to the shared inbound shape.
 *
 * listen({ store })
 *   → Promise<void>   (optional — only for listener-based providers)
 *   Starts a long-running listener loop (Spectrum WebSocket model).
 *   Implementations must call store.confirmPairingCode or
 *   store.recordInboundMessage per inbound message.
 *
 * @typedef {Object} InboundMessage
 * @property {string} providerEventId
 * @property {string} text
 * @property {string} code
 * @property {string} channelType
 * @property {string} channelAddress
 * @property {{ provider: string, receivedAt: string, channel: string, hasText: boolean }} metadata
 */

export {};
