import { createHmac, timingSafeEqual } from "node:crypto";
import { eventIdFromPayload } from "../store.mjs";

/**
 * MacBridgeSmsProvider — talks to a self-hosted mac-bridge service
 * (apps/mac-bridge) over an HMAC-authenticated HTTP transport. The bridge
 * runs spectrum-ts in local mode on a Mac mini, so iMessage + SMS-forwarding
 * traffic both arrive uniformly through Messages.app.
 *
 * Wire shape:
 *   • Inbound: bridge POSTs to /webhooks/mac-bridge on Fly with
 *     x-bridge-signature: sha256=<hex> over the raw body.
 *   • Outbound: Fly POSTs { to, text } to <bridgeUrl>/v1/send with the
 *     same header. Bridge replies { ok, id, route }.
 *
 * Both directions share BRIDGE_HMAC_SECRET.
 */
export function createMacBridgeSmsProvider(config) {
  return {
    verifyWebhook(req, rawBody) {
      return verifyBridgeSignature(req, rawBody, config);
    },
    parseInbound(payload) {
      return parseBridgeInbound(payload);
    },
    async sendSms(to, body) {
      return sendViaBridge(to, body, config);
    },
    // listen() is a no-op for mac-bridge: the bridge pushes inbound events
    // to /webhooks/mac-bridge. No long-running connection from Fly to bridge.
    async listen() {},
  };
}

function verifyBridgeSignature(req, rawBody, config) {
  const secret = config.macBridge?.hmacSecret;
  if (!secret) return { ok: false, reason: "bridge_secret_missing" };

  const header = req.headers["x-bridge-signature"];
  if (typeof header !== "string") return { ok: false, reason: "missing_signature" };

  const provided = header.replace(/^sha256=/, "");
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return { ok: false, reason: "bad_signature_length" };
  return timingSafeEqual(a, b)
    ? { ok: true, mode: "hmac-sha256" }
    : { ok: false, reason: "invalid_signature" };
}

function parseBridgeInbound(payload) {
  const text = String(payload.text || "");
  const from = String(payload.from || "");
  const platformRaw = String(payload.platform || "imessage").toLowerCase();
  const channelType = platformRaw === "sms" ? "sms" : "imessage";

  return {
    providerEventId: String(payload.providerEventId || eventIdFromPayload(payload)),
    text,
    code: extractPairingCode(text),
    channelType,
    channelAddress: from,
    metadata: {
      provider: "mac-bridge",
      receivedAt: new Date().toISOString(),
      channel: channelType,
      hasText: Boolean(text),
      spaceId: payload.spaceId,
      messageId: payload.messageId,
    },
  };
}

async function sendViaBridge(to, body, config) {
  if (!config.macBridge?.url || !config.macBridge?.hmacSecret || !to) {
    return {
      providerMessageId: null,
      status: "skipped_configuration_missing",
      metadata: { reason: "mac_bridge_not_configured" },
    };
  }

  const raw = JSON.stringify({ to, text: body });
  const signature = createHmac("sha256", config.macBridge.hmacSecret).update(raw).digest("hex");

  try {
    const response = await fetch(new URL("/v1/send", config.macBridge.url), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-bridge-signature": `sha256=${signature}`,
      },
      body: raw,
    });

    if (!response.ok) {
      return {
        providerMessageId: null,
        status: "provider_error",
        metadata: { status: response.status },
      };
    }

    const json = await response.json().catch(() => ({}));
    return {
      providerMessageId: json.id || null,
      status: "sent",
      metadata: { providerMessageId: json.id || null, route: json.route },
    };
  } catch (err) {
    return {
      providerMessageId: null,
      status: "provider_error",
      metadata: { error: err?.message || String(err) },
    };
  }
}

function extractPairingCode(text) {
  const start = String(text || "").match(/\bSTART-[A-Z0-9]{6,8}\b/i)?.[0];
  if (start) return start.toUpperCase();
  const modern = String(text || "").match(/\b[A-F0-9]{8}\b/i)?.[0];
  if (modern) return modern.toUpperCase();
  return String(text || "").match(/\bIJ-[A-Z0-9]{6}\b/i)?.[0]?.toUpperCase() || "";
}
