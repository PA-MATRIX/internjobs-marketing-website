import { Spectrum, text } from "spectrum-ts";
import { imessage } from "spectrum-ts/providers/imessage";
import { signBody } from "./security.mjs";

// In-memory cache of the latest inbound (space, message) per phone number.
// Outbound /send looks up here so we reply on the existing thread (preserves
// iMessage chat continuity + lets us use message.reply / space.responding).
// Process-local: a bridge restart drops the cache, but inbound traffic
// repopulates it within seconds in practice.
const PHONE_RE = /(\+\d{6,15})/;
const threadCache = new Map(); // phone -> { space, lastMessage, updatedAt }

export async function startLocalListener({ config, log }) {
  const app = await Spectrum({
    providers: [imessage.config({ local: true })],
  });
  log("info", "spectrum_local_listener_started");

  // Fire-and-forget — runs for the lifetime of the process.
  (async () => {
    for await (const [space, message] of app.messages) {
      try {
        const phone = extractPhone(space, message);
        if (phone) {
          threadCache.set(phone, { space, lastMessage: message, updatedAt: Date.now() });
        }

        const platform = String(message.platform || "iMessage").toLowerCase();
        const body = getText(message);
        const payload = {
          providerEventId: `mac:${message.platform}:${message.id}`,
          platform,
          from: phone || space.id,
          spaceId: space.id,
          messageId: message.id,
          text: body,
          ts: new Date().toISOString(),
        };

        const raw = JSON.stringify(payload);
        const sig = signBody(config.hmacSecret, raw);

        // Best-effort forward to Fly. Don't crash the listener if Fly is down —
        // log and continue. Fly will get the next message; this one is lost.
        // (Inbound retry queue is a v1.2.1 concern, not v1.2.)
        fetch(config.outboundWebhookUrl, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-bridge-signature": `sha256=${sig}`,
          },
          body: raw,
        }).catch((err) => {
          log("error", "outbound_webhook_failed", { error: err?.message || String(err) });
        });

        log("info", "inbound_forwarded", { phone, platform, messageId: message.id });
      } catch (err) {
        log("error", "inbound_handler_failed", { error: err?.message || String(err) });
      }
    }
  })().catch((err) => {
    log("error", "listener_loop_died", { error: err?.message || String(err) });
    process.exit(1); // launchd will restart
  });

  return {
    /**
     * Send an outbound message. We prefer replying on the existing thread when
     * we have a cached space (preserves iMessage continuity and works for
     * group chats). When the phone is new, we fall back to opening a fresh
     * chat — spectrum-ts in local mode hands this off to Messages.app.
     */
    async send({ to, text: body }) {
      const entry = threadCache.get(to);
      if (entry?.lastMessage?.reply) {
        const result = await entry.space.responding(async () => {
          return entry.lastMessage.reply(text(body));
        });
        return { id: result?.id || null, route: "reply" };
      }
      // Cold path: no cached thread. Open a fresh iMessage chat.
      const space = await app.imessage.open({ phone: to });
      const result = await space.responding(async () => {
        return space.send(text(body));
      });
      threadCache.set(to, { space, lastMessage: result, updatedAt: Date.now() });
      return { id: result?.id || null, route: "open" };
    },
  };
}

function extractPhone(space, message) {
  if (space?.phone && /\+?\d{6,15}/.test(String(space.phone))) return String(space.phone);
  if (message?.sender?.id && /\+?\d{6,15}/.test(String(message.sender.id))) return String(message.sender.id);
  const m = String(space?.id || "").match(PHONE_RE);
  return m ? m[1] : null;
}

function getText(message) {
  if (message.content?.type === "text") return String(message.content.text || "");
  return "";
}
