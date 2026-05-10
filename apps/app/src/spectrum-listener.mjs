import { Spectrum } from "spectrum-ts";
import { imessage } from "spectrum-ts/providers/imessage";
import { createWelcomeText } from "./messaging.mjs";
import { eventIdFromPayload } from "./store.mjs";

export function startSpectrumWaitlistListener({ config, store }) {
  if (!config.enableSpectrumListener) return null;
  if (!config.photon.projectId || !config.photon.apiToken) {
    console.error(JSON.stringify({ level: "error", message: "spectrum_listener_missing_credentials" }));
    return null;
  }

  const runner = runSpectrumWaitlistListener({ config, store }).catch((error) => {
    console.error(JSON.stringify({ level: "error", message: "spectrum_listener_failed", error: error.message }));
  });

  return runner;
}

async function runSpectrumWaitlistListener({ config, store }) {
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
  const channelAddress = String(space.phone || message.sender?.id || space.id || "");
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

function getMessageText(message) {
  if (message.content?.type === "text") return String(message.content.text || "");
  return "";
}

function extractPairingCode(text) {
  const modern = String(text || "").match(/\b[A-F0-9]{8}\b/i)?.[0];
  if (modern) return modern.toUpperCase();
  return String(text || "").match(/\bIJ-[A-Z0-9]{6}\b/i)?.[0]?.toUpperCase() || "";
}
