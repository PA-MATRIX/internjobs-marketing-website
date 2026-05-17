import { Spectrum, text } from "spectrum-ts";
import { imessage } from "spectrum-ts/providers/imessage";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { signBody } from "./security.mjs";

const execFileP = promisify(execFile);

// Pending "responding" contexts keyed by phone. The listener loop opens one
// per inbound and holds the typing bubble until /v1/send resolves it. Spans
// the async gap between Fly drafting the reply and the bridge sending it.
const pendingResponding = new Map(); // phone -> { resolve, startedAt }

// Mark a chat as read by activating Messages.app and "viewing" it via
// AppleScript. spectrum-ts local mode doesn't expose chats.markRead (that's
// a Photon SaaS feature); the native macOS path is to make Messages.app
// scroll the conversation, which triggers the IDS "read" notification IFF
// the user has "Send read receipts" enabled in Messages → Settings.
//
// Best-effort: failures are swallowed (Messages.app may be backgrounded,
// AppleScript dict may differ across macOS versions, recipient may not have
// read receipts enabled — none of those should break the workflow).
async function markChatViewedAS(phone) {
  // Constrain phone to digits + leading + so we don't shell-inject.
  if (!/^\+?\d{6,15}$/.test(String(phone))) return;
  const script = `
    tell application "Messages"
      try
        set theBuddy to first buddy of service 1 whose handle is "${phone}"
        set selected chat to chat 1 of (every chat whose participants contains theBuddy)
      on error
        return
      end try
    end tell
  `;
  try {
    await execFileP("osascript", ["-e", script], { timeout: 3000 });
  } catch {
    // swallow
  }
}

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

        // Native-UX hooks, fired immediately on inbound (best-effort, never
        // block the workflow). Three things:
        //   1. Tapback ack — react with 👀 so the user sees their message
        //      was received instantly, before the LLM reply arrives 5–15s
        //      later. Local mode may not support `react`; swallow + continue.
        //   2. Read receipt — programmatic "open" of the conversation in
        //      Messages.app via AppleScript triggers the IDS markRead
        //      notification (IFF the user has "Send read receipts" enabled
        //      in Messages → Settings → iMessage). spectrum-ts local doesn't
        //      expose markRead directly.
        //   3. Typing indicator — open a `space.responding()` context that
        //      holds the "…" bubble visible until /v1/send is called for
        //      this phone. Sentinel-Promise pattern bridges the async gap
        //      between this listener and the HTTP handler.
        try {
          if (typeof message.react === "function") {
            message.react("👀").catch(() => {});
          }
        } catch { /* swallow */ }

        if (phone) {
          markChatViewedAS(phone); // fire-and-forget
        }

        if (phone && typeof space?.responding === "function") {
          // Replace any prior pending context (new inbound supersedes old).
          const prior = pendingResponding.get(phone);
          if (prior) try { prior.resolve(); } catch {}
          let resolveFn;
          const sentinel = new Promise((r) => { resolveFn = r; });
          // Safety timeout — never hold the bubble open for more than 45s
          // even if Fly never POSTs /v1/send (workflow failure, network
          // partition, etc.). The bubble silently dismisses.
          const timeoutId = setTimeout(() => resolveFn(), 45_000);
          pendingResponding.set(phone, {
            resolve: () => { clearTimeout(timeoutId); resolveFn(); },
            startedAt: Date.now(),
          });
          space.responding(async () => { await sentinel; }).catch((err) => {
            log("warn", "responding_context_failed", { phone, error: err?.message || String(err) });
          });
        }

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
     * Send an outbound message. Always uses `space.send()` — spectrum-ts in
     * LOCAL mode does NOT support the `message.reply()` action (logs
     * "iMessage (local mode) does not support action 'reply'; skipping" and
     * silently drops the send). Cloud mode supports reply on the message
     * object, but we're local-only on this bridge.
     *
     * We prefer the cached space (preserves the existing iMessage thread —
     * Messages.app reuses the chat row in chat.db so the conversation reads
     * naturally on the recipient side). Falls back to opening a new chat
     * when we've never seen this phone before.
     */
    async send({ to, text: body }) {
      // If the listener opened a responding() context on inbound, it's still
      // holding the typing bubble open. Floor the bubble visible time at
      // ~1200ms so it actually renders on the recipient's iOS UI even when
      // the LLM reply comes back sub-second.
      const pending = pendingResponding.get(to);
      if (pending) {
        const elapsed = Date.now() - pending.startedAt;
        if (elapsed < 1200) await new Promise((r) => setTimeout(r, 1200 - elapsed));
      }

      const entry = threadCache.get(to);
      let result, route;
      if (entry?.space?.send) {
        // Send inside the listener's existing responding() context — the
        // typing bubble is still up here, so the message lands while bubble
        // is visible, then dismisses cleanly when we resolve the sentinel
        // below. No nested responding() needed; the listener's one covers us.
        result = await entry.space.send(text(body));
        route = "cached-space";
        if (result) entry.lastMessage = result;
        entry.updatedAt = Date.now();
      } else {
        // Cold path: never seen this phone, no listener responding() context.
        // Wrap our own responding() so the user sees a brief typing bubble
        // before the message lands.
        const space = await app.imessage.open({ phone: to });
        result = await space.responding(async () => space.send(text(body)));
        route = "open";
        threadCache.set(to, { space, lastMessage: result, updatedAt: Date.now() });
      }

      // Dismiss the listener's responding() context (closes typing bubble).
      if (pending) {
        pendingResponding.delete(to);
        try { pending.resolve(); } catch {}
      }

      return { id: result?.id || null, route };
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
