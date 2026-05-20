// Bridge listener — talks to BlueBubbles instead of spectrum-ts.
//
// Wire shape is unchanged from Phase 07: the bridge forwards inbound events
// to Fly's /webhooks/mac-bridge (HMAC-signed JSON envelope), and exposes a
// send() callable that the HTTP server invokes from POST /v1/send. The Fly
// side (apps/app/src/sms/mac-bridge.mjs) is wire-compatible with this and
// requires no changes.
//
// Native UX hooks (all best-effort, never block):
//   1. Inbound  → fireAndForget: markRead + selective tapback + sendTyping(on)
//   2. Outbound → sendTyping(off) + send(text)
//
// Typing-on is held until /v1/send is called (or 45s safety timeout), so the
// recipient sees a continuous "…" bubble across the LLM round-trip rather
// than two brief flashes.

import { createBlueBubblesClient } from "./bluebubbles-client.mjs";
import { signBody } from "./security.mjs";

// Active typing contexts keyed by chatGuid. The listener opens one on
// inbound and holds the typing bubble until /v1/send resolves it.
const pendingTyping = new Map(); // chatGuid -> { timeoutId, startedAt }

// In-memory cache of the latest chat context per address. Outbound /send
// uses this to find the chatGuid + last inbound message guid (so we can
// thread replies into the existing conversation rather than starting fresh).
// Keyed by the normalized address (phone or Apple ID). Process-local; a
// restart drops the cache and inbound traffic repopulates it.
const threadCache = new Map();
const reactedMessages = new Set();
// threadCache entry shape:
//   { chatGuid, address, lastMessageGuid, lastInboundAt }

const PHONE_RE = /(\+?\d{6,15})/;

export async function startListener({ config, log }) {
  const client = createBlueBubblesClient({
    baseUrl: config.bluebubblesUrl,
    password: config.bluebubblesPassword,
    log,
  });

  // NOTE 2026-05-18: REMOVED the startup health() probe. BlueBubbles' server
  // appears to enforce a single-session-per-password limit; a REST call
  // moments after the WS handshake disconnects the WS with Socket.IO "41".
  // Caught during Phase 07b smoke testing — the WS stays alive when we don't
  // race a REST call against it at startup. Outbound REST calls (send, react,
  // markRead, sendTyping) come after the WS is fully established AND don't
  // recur at the same rate, so they don't trigger the same race.
  //
  // If we ever need a health probe, run it AFTER seeing at least one "42[..."
  // event frame on the WS (proving the session is established) OR space REST
  // calls out by ~250ms after WS handshake.

  const unsubscribe = client.subscribe({
    onMessage: (payload) => handleInbound(payload, { client, config, log }).catch((err) => {
      log("error", "inbound_handler_failed", { error: err?.message || String(err) });
    }),
    // We don't act on the recipient's typing indicator; logging is enough.
    // (Could be useful for future "user is typing — pause LLM" UX.)
    onTyping: (p) => log("info", "remote_typing", { display: p?.display, chatGuid: p?.guid }),
  });

  log("info", "bluebubbles_listener_started", { url: config.bluebubblesUrl });

  // Cleanup on process exit so we don't leave the WS open.
  for (const sig of ["SIGINT", "SIGTERM"]) {
    process.once(sig, () => {
      try { unsubscribe(); } catch { /* ignore */ }
    });
  }

  return {
    /**
     * Outbound send. Called by the HTTP server on POST /v1/send.
     *
     * Looks up the cached chatGuid for `to` (populated on inbound), turns
     * off the held typing bubble, and POSTs to BlueBubbles. The reply lands
     * inside the existing iMessage thread because we send to the same
     * chatGuid the inbound came from.
     */
    async send({ to, text }) {
      const entry = threadCache.get(to);
      const chatGuid = entry?.chatGuid;

      // If we have a pending typing context, ensure the bubble was visible
      // long enough to render on iOS (fast LLM responses can outpace the
      // typing indicator's render frame and the user sees nothing).
      const pending = chatGuid ? pendingTyping.get(chatGuid) : null;
      if (pending) {
        const elapsed = Date.now() - pending.startedAt;
        if (elapsed < 1200) {
          await new Promise((r) => setTimeout(r, 1200 - elapsed));
        }
      }

      // Stop typing (best-effort, parallel with send).
      const stopTyping = chatGuid
        ? client.sendTyping(chatGuid, false).catch(() => null)
        : Promise.resolve(null);

      const sendP = client.send({ chatGuid, to, text });

      // Clear pending typing state regardless of stop-typing call result.
      if (chatGuid && pending) {
        clearTimeout(pending.timeoutId);
        pendingTyping.delete(chatGuid);
      }

      const [, result] = await Promise.all([stopTyping, sendP]);

      // Update threadCache with the resolved chatGuid (in case cold-start
      // resolved a new one) so subsequent sends thread correctly.
      if (result?.messageGuid) {
        const resolvedGuid = chatGuid || (await client._internal.resolveChatGuid(to));
        threadCache.set(to, {
          chatGuid: resolvedGuid,
          address: to,
          lastMessageGuid: result.messageGuid,
          lastInboundAt: entry?.lastInboundAt ?? null,
        });
      }

      return { id: result?.messageGuid || null, route: "bluebubbles" };
    },
  };
}

/**
 * Handle a single "new-message" payload from BlueBubbles' WebSocket.
 *
 * Payload shape (per MessageSerializer with includeChats:true):
 *   {
 *     guid: string,                  // message guid
 *     text: string,
 *     isFromMe: boolean,
 *     dateCreated: number,           // epoch ms
 *     handle: { address: string, ... } | null,
 *     chats: [{ guid: string, ... }],
 *     ...
 *   }
 */
async function handleInbound(message, { client, config, log }) {
  if (!message || typeof message !== "object") return;

  // Skip our own outbound messages — BlueBubbles emits new-message for both
  // sides of every conversation.
  if (message.isFromMe) {
    log("info", "skip_outbound_echo", { messageGuid: message.guid });
    return;
  }

  const messageGuid = String(message.guid || "");
  const text = String(message.text || "");
  const address = message.handle?.address ? String(message.handle.address) : "";
  const chatGuid = message.chats?.[0]?.guid ? String(message.chats[0].guid) : "";
  const phone = extractPhone(address) || extractPhone(chatGuid);
  const cacheKey = phone || address || chatGuid;
  const isFirstSeenThread = cacheKey ? !threadCache.has(cacheKey) : false;

  if (cacheKey) {
    threadCache.set(cacheKey, {
      chatGuid,
      address: phone || address,
      lastMessageGuid: messageGuid,
      lastInboundAt: Date.now(),
    });
  }

  // Native UX hooks — fire both in parallel. None of these are allowed
  // to throw out of this handler.
  if (chatGuid) {
    // 1) Read receipt.
    client.markRead(chatGuid).catch(() => {});

    // 2) Selective tapback. Heart the START-code onboarding text so the
    // first pairing action feels native, then keep later reactions sparse.
    const reaction = selectTapbackForInbound(text, { isFirstSeenThread });
    const reactionKey = `${chatGuid}:${messageGuid}:${reaction || ""}`;
    if (reaction && messageGuid && !reactedMessages.has(reactionKey)) {
      reactedMessages.add(reactionKey);
      client.sendReaction(chatGuid, messageGuid, reaction).catch((err) => {
        log("warn", "tapback_failed", {
          chatGuid,
          messageGuid,
          reaction,
          error: err?.message || String(err),
        });
      });
    }

    // 3) Typing indicator — held open until /v1/send is called.
    client.sendTyping(chatGuid, true).catch(() => {});
    const prior = pendingTyping.get(chatGuid);
    if (prior) clearTimeout(prior.timeoutId);
    const timeoutId = setTimeout(() => {
      // Safety: dismiss bubble if /v1/send never arrives.
      pendingTyping.delete(chatGuid);
      client.sendTyping(chatGuid, false).catch(() => {});
    }, 45_000);
    pendingTyping.set(chatGuid, { timeoutId, startedAt: Date.now() });
  }

  // Forward to Fly.
  const payload = {
    providerEventId: `mac:imessage:${messageGuid}`,
    platform: "imessage",
    from: phone || address || chatGuid,
    spaceId: chatGuid,
    messageId: messageGuid,
    text,
    ts: new Date(message.dateCreated || Date.now()).toISOString(),
  };

  const raw = JSON.stringify(payload);
  const sig = signBody(config.hmacSecret, raw);

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

  log("info", "inbound_forwarded", {
    phone, address, chatGuid, messageGuid,
  });
}

function extractPhone(s) {
  if (!s) return null;
  const m = String(s).match(PHONE_RE);
  return m ? m[1] : null;
}

function selectTapbackForInbound(text, { isFirstSeenThread = false } = {}) {
  const body = String(text || "").trim();
  const lower = body.toLowerCase();
  if (/\bSTART-[A-Z0-9]{6,8}\b/i.test(body)) return "love";
  if (isFirstSeenThread && /^(hi|hey|hello)\b/i.test(body) && body.length <= 40) return "like";
  if (/\b(thanks|thank you|got it|sounds good|perfect|awesome|cool)\b/i.test(lower)) return "like";
  if (/\b(lol|haha|lmao)\b/i.test(lower)) return "laugh";
  return null;
}
