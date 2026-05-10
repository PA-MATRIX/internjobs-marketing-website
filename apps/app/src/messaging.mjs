import { createHmac, timingSafeEqual } from "node:crypto";
import { eventIdFromPayload } from "./store.mjs";

export function verifyPhotonWebhook(req, rawBody, config) {
  if (!config.photon.webhookSecret) return { ok: false, reason: "webhook_secret_missing" };

  const sharedSecret = req.headers["x-internjobs-webhook-secret"] || req.headers["x-photon-webhook-secret"] || req.headers["x-spectrum-webhook-secret"];
  if (typeof sharedSecret === "string" && safeEqual(sharedSecret, config.photon.webhookSecret)) return { ok: true, mode: "shared-secret" };

  const signature = req.headers["x-photon-signature"] || req.headers["x-spectrum-signature"];
  if (typeof signature === "string") {
    const expected = createHmac("sha256", config.photon.webhookSecret).update(rawBody).digest("hex");
    if (safeEqual(signature.replace(/^sha256=/, ""), expected)) return { ok: true, mode: "hmac-sha256" };
  }

  return { ok: false, reason: "invalid_signature" };
}

export function parseInboundMessage(payload) {
  const text = String(payload.text || payload.body || payload.message || "");
  const code = String(payload.code || extractPairingCode(text) || "").toUpperCase();
  const channelAddress = String(payload.from || payload.phone || payload.sender || payload.user?.phone || "");
  const channelType = normalizeChannel(payload.channel || payload.type || "sms");

  return {
    providerEventId: eventIdFromPayload(payload),
    text,
    code,
    channelType,
    channelAddress,
    metadata: {
      provider: "photon",
      receivedAt: new Date().toISOString(),
      channel: channelType,
      hasText: Boolean(text),
    },
  };
}

export function createWelcomeText(student) {
  return `Hey ${firstName(student.name) || "there"} - you're in. Welcome to InternJobs.ai. We'll text when something actually fits.`;
}

export async function sendWelcomeMessage(student, config) {
  const message = createWelcomeText(student);

  if (!config.photon.apiBaseUrl || !config.photon.apiToken || !student.channelAddress) {
    return {
      status: "skipped_configuration_missing",
      metadata: { reason: "photon_outbound_not_configured" },
    };
  }

  const response = await fetch(new URL("/messages", config.photon.apiBaseUrl), {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.photon.apiToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      from: config.photon.fromNumber,
      to: student.channelAddress,
      text: message,
    }),
  });

  if (!response.ok) {
    return {
      status: "provider_error",
      metadata: { status: response.status },
    };
  }

  const payload = await response.json().catch(() => ({}));
  return {
    status: "sent",
    metadata: { providerMessageId: payload.id || payload.messageId || null },
  };
}

function extractPairingCode(text) {
  const modern = text.match(/\b[A-F0-9]{8}\b/i)?.[0];
  if (modern) return modern;
  return text.match(/\bIJ-[A-Z0-9]{6}\b/i)?.[0] || "";
}

function normalizeChannel(value) {
  const normalized = String(value).toLowerCase();
  if (["imessage", "whatsapp", "slack", "discord", "phone"].includes(normalized)) return normalized;
  return "sms";
}

function firstName(name) {
  return String(name || "").trim().split(/\s+/)[0] || "";
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
