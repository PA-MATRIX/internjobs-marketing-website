import { createHmac, timingSafeEqual } from "node:crypto";
import { Spectrum } from "spectrum-ts";
import { imessage } from "spectrum-ts/providers/imessage";
import { eventIdFromPayload } from "../store.mjs";
import { createWelcomeText } from "../messaging.mjs";
import { runStudentInboundWorkflow } from "../workflows/student-inbound.mjs";

/**
 * SpectrumSmsProvider — the v1.2 sole implementation of SmsProvider.
 * Wraps the existing Spectrum/Photon path so server.mjs and spectrum-listener.mjs
 * only depend on the SmsProvider seam, not on Spectrum/Photon internals.
 */
export function createSpectrumSmsProvider(config) {
  const provider = {
    verifyWebhook(req, rawBody) {
      return verifyWebhook(req, rawBody, config);
    },
    parseInbound(payload) {
      return parseInbound(payload);
    },
    async sendSms(to, body) {
      return sendSms(to, body, config);
    },
    async listen({ store }) {
      return runSpectrumWaitlistListener({ config, store, smsProvider: provider });
    },
  };
  return provider;
}

function verifyWebhook(req, rawBody, config) {
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

function parseInbound(payload) {
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
      provider: "spectrum",
      receivedAt: new Date().toISOString(),
      channel: channelType,
      hasText: Boolean(text),
    },
  };
}

async function sendSms(to, body, config) {
  if (!config.photon.apiBaseUrl || !config.photon.apiToken || !to) {
    return {
      providerMessageId: null,
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
      to,
      text: body,
    }),
  });

  if (!response.ok) {
    return {
      providerMessageId: null,
      status: "provider_error",
      metadata: { status: response.status },
    };
  }

  const payload = await response.json().catch(() => ({}));
  const providerMessageId = payload.id || payload.messageId || null;
  return {
    providerMessageId,
    status: "sent",
    metadata: { providerMessageId },
  };
}

async function runSpectrumWaitlistListener({ config, store }) {
  if (!config.photon.projectId || !config.photon.apiToken) {
    console.error(JSON.stringify({ level: "error", message: "spectrum_listener_missing_credentials" }));
    return;
  }

  const app = await Spectrum({
    projectId: config.photon.projectId,
    projectSecret: config.photon.apiToken,
    providers: [imessage.config()],
  });

  console.log(JSON.stringify({ level: "info", message: "spectrum_listener_started" }));

  for await (const [space, message] of app.messages) {
    const inbound = parseSpectrumMessage(space, message);
    const confirmation = inbound.code ? await store.confirmPairingCode(inbound) : await store.recordInboundMessage(inbound);

    if (confirmation.student && confirmation.welcomeNeeded) {
      const welcome = await replyWithWelcome(space, message, confirmation.student);
      await store.markWelcomeSent(confirmation.student.id, welcome.status, welcome.metadata);
    }

    // v1.2 autonomy pivot: when an existing confirmed student texts in, write
    // an inbound_messages row + fire-and-forget the Mastra workflow. The
    // workflow drafts + autonomously sends the reply via outbound.mjs ->
    // smsProvider.sendSms (the Phase 01 seam). Mirrors /webhooks/photon.
    if (
      !confirmation.error &&
      confirmation.eventType === "student_reply" &&
      confirmation.student &&
      typeof store.writeInboundMessage === "function"
    ) {
      try {
        const messageId = await store.writeInboundMessage({
          provider: "spectrum",
          providerEventId: inbound.providerEventId,
          channelType: inbound.channelType,
          channelAddress: inbound.channelAddress,
          studentId: confirmation.student.id,
          body: inbound.text,
          metadata: inbound.metadata || {},
        });
        if (messageId && store?.pool) {
          runStudentInboundWorkflow({
            pool: store.pool,
            messageId,
            smsProvider,
            config,
          }).catch((err) => {
            console.error(JSON.stringify({
              level: "error",
              message: "student_inbound_workflow_failed",
              messageId,
              error: err?.message ?? String(err),
            }));
          });
        }
      } catch (err) {
        console.error(JSON.stringify({
          level: "error",
          message: "write_inbound_message_failed",
          error: err?.message ?? String(err),
        }));
      }
    }
  }
}

async function replyWithWelcome(space, message, student) {
  try {
    await space.responding(async () => {
      await message.reply(createWelcomeText(student));
    });
    return { status: "sent", metadata: { transport: "spectrum-ts" } };
  } catch (error) {
    return { status: "provider_error", metadata: { transport: "spectrum-ts", reason: "reply_failed" } };
  }
}

function parseSpectrumMessage(space, message) {
  const text = getMessageText(message);
  const channelAddress = extractPhoneFromSpace(space, message);
  const channelType = message.platform === "iMessage" ? "imessage" : String(message.platform || "sms").toLowerCase();

  return {
    providerEventId: eventIdFromPayload({ id: `spectrum:${message.platform}:${message.id}` }),
    text,
    code: extractPairingCode(text),
    channelType,
    channelAddress,
    metadata: {
      provider: "spectrum",
      receivedAt: new Date().toISOString(),
      channel: channelType,
      hasText: Boolean(text),
      spaceId: space.id,
    },
  };
}

// Photon/Spectrum iMessage encodes the participant phone in space.id as
// `<spaceType>;-;<phone>` (e.g. `any;-;+17133924287`). space.phone can be
// a literal phone OR a marker string like "shared" — only accept it when
// it actually looks like a phone. Otherwise fall back to spaceId parsing.
const PHONE_RE = /\+?\d{6,15}/;

function extractPhoneFromSpace(space, message) {
  if (space?.phone && PHONE_RE.test(String(space.phone))) {
    return String(space.phone);
  }
  if (message?.sender?.id && PHONE_RE.test(String(message.sender.id))) {
    return String(message.sender.id);
  }
  const spaceId = String(space?.id || "");
  const m = spaceId.match(/(\+\d{6,15})/);
  if (m) return m[1];
  return spaceId;
}

function getMessageText(message) {
  if (message.content?.type === "text") return String(message.content.text || "");
  return "";
}

function extractPairingCode(text) {
  const modern = String(text || "").match(/\b[A-F0-9]{8}\b/i)?.[0];
  if (modern) return modern.toUpperCase();
  return String(text || "").match(/\bIJ-[A-Z0-9]{6}\b/i)?.[0]?.toUpperCase() || "";
}

function normalizeChannel(value) {
  const normalized = String(value).toLowerCase();
  if (["imessage", "whatsapp", "slack", "discord", "phone"].includes(normalized)) return normalized;
  return "sms";
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
