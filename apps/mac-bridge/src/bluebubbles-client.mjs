// Thin client around BlueBubbles' REST + Socket.IO APIs.
//
// BlueBubbles (https://bluebubbles.app) runs a local HTTP + Socket.IO server
// on the Mac mini that exposes Apple's Messages.app internals via a
// "Private API" helper. We use it for:
//
//   • Outbound text   POST /api/v1/message/text         { chatGuid, tempGuid, message, method }
//   • Typing on       POST /api/v1/chat/:guid/typing
//   • Typing off    DELETE /api/v1/chat/:guid/typing
//   • Reactions       POST /api/v1/message/react        { chatGuid, selectedMessageGuid, reaction, partIndex }
//   • Mark read       POST /api/v1/chat/:guid/read
//   • Health          GET  /api/v1/server/info
//
// Auth: BlueBubbles authenticates exclusively via query-string parameter
// (`?password=xxx`, also accepts `?guid=` / `?token=` as fallbacks). It does
// NOT inspect the Authorization header. We append `?password=` to every
// request URL.
//
// Inbound events are streamed over Socket.IO. The events we care about:
//   • "new-message"      — payload is a serialized Message (see below)
//   • "typing-indicator" — payload { display: boolean, guid: chatGuid }
//
// Reference (verified against BlueBubblesApp/bluebubbles-server@master):
//   routers: packages/server/src/server/api/http/api/v1/routers/*.ts
//   events:  packages/server/src/server/events.ts
//   serializer: packages/server/src/server/api/serializers/MessageSerializer.ts

import { Buffer } from "node:buffer";

/**
 * Create a BlueBubbles client.
 *
 * @param {object} opts
 * @param {string} opts.baseUrl       — e.g. "http://127.0.0.1:1234"
 * @param {string} opts.password      — BlueBubbles server password
 * @param {(level: string, msg: string, fields?: object) => void} [opts.log]
 * @returns {object}
 */
export function createBlueBubblesClient({ baseUrl, password, log = () => {} }) {
  if (!baseUrl) throw new Error("bluebubbles-client: baseUrl required");
  if (!password) throw new Error("bluebubbles-client: password required");

  const apiBase = `${stripTrailingSlash(baseUrl)}/api/v1`;
  const authQS = `password=${encodeURIComponent(password)}`;

  /** Build a fully-authenticated URL with the password query param appended. */
  function apiUrl(path, extraQuery = null) {
    const sep = path.includes("?") ? "&" : "?";
    let url = `${apiBase}${path}${sep}${authQS}`;
    if (extraQuery && typeof extraQuery === "object") {
      const qs = new URLSearchParams(extraQuery).toString();
      if (qs) url += `&${qs}`;
    }
    return url;
  }

  /** Wrapper around fetch with sensible defaults + structured error. */
  async function request(method, path, { body = null, timeoutMs = 10000 } = {}) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(apiUrl(path), {
        method,
        headers: body ? { "content-type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
        signal: ctrl.signal,
      });
      const text = await res.text();
      let parsed = null;
      try { parsed = text ? JSON.parse(text) : null; } catch { /* keep null */ }
      if (!res.ok) {
        const err = new Error(`bluebubbles ${method} ${path} failed: ${res.status}`);
        err.status = res.status;
        err.body = parsed ?? text;
        throw err;
      }
      return parsed;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Send a text message via BlueBubbles' Private API.
   *
   * Two modes:
   *   • `chatGuid` known (replying to an existing thread) — use it directly.
   *     This preserves iMessage thread continuity (the recipient sees the
   *     reply land in the existing conversation, not as a new chat).
   *   • `chatGuid` unknown (cold start) — BlueBubbles requires a chatGuid;
   *     we fall back to looking up / creating a chat by address. Practically
   *     we always have a chatGuid from a prior inbound for v1.2.
   *
   * @param {object} args
   * @param {string} [args.chatGuid] — preferred; iMessage chatGuid from inbound
   * @param {string} [args.to]       — phone number / Apple ID; used to look up chat if no chatGuid
   * @param {string} args.text
   * @returns {Promise<{ messageGuid: string | null, raw: object | null }>}
   */
  async function send({ chatGuid, to, text }) {
    if (!text || typeof text !== "string") {
      throw new Error("bluebubbles-client.send: text required");
    }
    let targetGuid = chatGuid;
    if (!targetGuid) {
      if (!to) throw new Error("bluebubbles-client.send: chatGuid or to required");
      targetGuid = await resolveChatGuid(to);
    }
    const tempGuid = `mac-bridge-${Date.now()}-${randomHex(8)}`;
    const body = {
      chatGuid: targetGuid,
      tempGuid,
      message: text,
      // "private-api" routes through the Mach-injected helper, which gives us
      // native iMessage UX (effects, replies, etc.). Falls back to AppleScript
      // automatically on BB's side if Private API isn't available.
      method: "private-api",
    };
    const result = await request("POST", "/message/text", { body });
    const messageGuid = result?.data?.guid || result?.data?.tempGuid || null;
    return { messageGuid, raw: result };
  }

  /**
   * Toggle typing indicator on a chat.
   *
   * BlueBubbles uses POST to start, DELETE to stop.
   */
  async function sendTyping(chatGuid, on) {
    if (!chatGuid) return null;
    const method = on ? "POST" : "DELETE";
    const path = `/chat/${encodeURIComponent(chatGuid)}/typing`;
    try {
      return await request(method, path, { timeoutMs: 5000 });
    } catch (err) {
      // Typing is best-effort UX; never let it surface to caller.
      log("warn", "bluebubbles_typing_failed", {
        chatGuid, on, error: err?.message || String(err),
      });
      return null;
    }
  }

  /**
   * Send a reaction (tapback) to a message.
   *
   * @param {string} chatGuid
   * @param {string} selectedMessageGuid — the GUID of the message we react TO
   * @param {string} reaction — one of: love, like, dislike, laugh, emphasize, question
   *                            (BlueBubbles also accepts the "-" prefixed forms
   *                            for removing a reaction, e.g. "-love")
   */
  async function sendReaction(chatGuid, selectedMessageGuid, reaction) {
    if (!chatGuid || !selectedMessageGuid || !reaction) return null;
    const body = {
      chatGuid,
      selectedMessageGuid,
      reaction,
      partIndex: 0,
    };
    try {
      return await request("POST", "/message/react", { body, timeoutMs: 5000 });
    } catch (err) {
      log("warn", "bluebubbles_reaction_failed", {
        chatGuid, selectedMessageGuid, reaction, error: err?.message || String(err),
      });
      return null;
    }
  }

  /**
   * Mark a chat as read. Triggers the standard iMessage read-receipt
   * notification on the sender's device (if they have read receipts enabled).
   */
  async function markRead(chatGuid) {
    if (!chatGuid) return null;
    const path = `/chat/${encodeURIComponent(chatGuid)}/read`;
    try {
      return await request("POST", path, { timeoutMs: 5000 });
    } catch (err) {
      log("warn", "bluebubbles_mark_read_failed", {
        chatGuid, error: err?.message || String(err),
      });
      return null;
    }
  }

  /** Health check — GET /api/v1/server/info. Returns true if reachable + 200. */
  async function health() {
    try {
      await request("GET", "/server/info", { timeoutMs: 3000 });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Resolve a chatGuid for an outbound address. Used when we need to send
   * to a recipient we've never received from (so threadCache miss).
   *
   * BlueBubbles' chatGuid format is `iMessage;-;+15551234567` for 1:1 chats
   * with iMessage service. We construct the candidate; BlueBubbles will
   * either find the existing chat or create one on first /message/text call.
   */
  async function resolveChatGuid(address) {
    const trimmed = String(address).trim();
    // BlueBubbles chatGuid convention for 1:1 iMessage chats.
    // For SMS-relayed traffic from a non-iMessage handle the convention is
    // `SMS;-;+15551234567` but we default to iMessage and let BB error if
    // wrong; the user can then re-send.
    return `iMessage;-;${trimmed}`;
  }

  /**
   * Subscribe to BlueBubbles' Socket.IO event stream.
   *
   * We speak the Engine.IO 4 + Socket.IO 4 wire protocol directly over a raw
   * WebSocket (no socket.io-client dep). The protocol is:
   *
   *   Server → "0{handshake-json}"        — Engine.IO OPEN, gives us sid + pingInterval
   *   Server → "40{namespace,sid}"        — Socket.IO CONNECT ack
   *   Server → "2"                        — Engine.IO PING
   *   Client → "3"                        — Engine.IO PONG
   *   Server → "42[\"event\",payload]"    — Socket.IO event message
   *
   * We respond to PINGs and decode "42…" frames into onMessage / onTyping
   * callbacks. Auto-reconnect with exponential backoff (1s → 30s cap) on
   * any disconnect.
   *
   * @param {object} handlers
   * @param {(payload: object) => void} [handlers.onMessage] — "new-message" payload
   * @param {(payload: { display: boolean, guid: string }) => void} [handlers.onTyping]
   * @returns {() => void} unsubscribe function
   */
  function subscribe({ onMessage = null, onTyping = null } = {}) {
    let stopped = false;
    let ws = null;
    let pingTimer = null;
    let reconnectTimer = null;
    let backoffMs = 1000;

    // Lazy import: we want bluebubbles-client.mjs to load cleanly even if
    // `ws` isn't installed yet (e.g. running --check on a fresh checkout).
    let WebSocketCtor = null;

    async function ensureWs() {
      if (WebSocketCtor) return WebSocketCtor;
      const mod = await import("ws");
      WebSocketCtor = mod.WebSocket || mod.default;
      return WebSocketCtor;
    }

    function clearPingTimer() {
      if (pingTimer) { clearInterval(pingTimer); pingTimer = null; }
    }

    function scheduleReconnect() {
      if (stopped) return;
      const delay = backoffMs;
      backoffMs = Math.min(backoffMs * 2, 30_000);
      log("info", "bluebubbles_ws_reconnect_scheduled", { delayMs: delay });
      reconnectTimer = setTimeout(() => { connect().catch(() => {}); }, delay);
    }

    async function connect() {
      if (stopped) return;
      const WS = await ensureWs();
      const wsBase = baseUrl.replace(/^http/, "ws");
      // Socket.IO 4 / Engine.IO 4 handshake URL. The path defaults to
      // /socket.io/ on the BlueBubbles server.
      const url = `${stripTrailingSlash(wsBase)}/socket.io/?EIO=4&transport=websocket&${authQS}`;

      log("info", "bluebubbles_ws_connecting", { url: redactPwd(url) });
      ws = new WS(url);

      ws.on("open", () => {
        log("info", "bluebubbles_ws_open");
        // Socket.IO CONNECT to default namespace. Some servers auto-CONNECT
        // on EIO=4, but sending an explicit "40" is harmless and ensures we
        // join the default ns.
        try { ws.send("40"); } catch { /* ignore */ }
      });

      ws.on("message", (raw) => {
        const data = typeof raw === "string" ? raw : Buffer.isBuffer(raw) ? raw.toString("utf8") : String(raw);
        handleFrame(data);
      });

      ws.on("close", (code, reason) => {
        log("warn", "bluebubbles_ws_closed", { code, reason: reason?.toString?.() || "" });
        clearPingTimer();
        ws = null;
        scheduleReconnect();
      });

      ws.on("error", (err) => {
        log("warn", "bluebubbles_ws_error", { error: err?.message || String(err) });
        // The "close" event will follow; reconnect there.
      });
    }

    function handleFrame(frame) {
      if (!frame || frame.length === 0) return;
      // Engine.IO packet type is the first char.
      //   "0" OPEN, "1" CLOSE, "2" PING, "3" PONG, "4" MESSAGE
      const type = frame[0];

      if (type === "0") {
        // OPEN — parse handshake JSON to extract pingInterval.
        try {
          const handshake = JSON.parse(frame.slice(1));
          // Reset backoff on a successful handshake.
          backoffMs = 1000;
          // Heartbeat: respond to server PINGs. Some servers also expect the
          // client to send PINGs at pingInterval; we play both safe by
          // replying to "2" with "3" (below) AND polling at pingInterval/2.
          const interval = Math.max(5000, Math.floor((handshake?.pingInterval || 25000) / 2));
          clearPingTimer();
          pingTimer = setInterval(() => {
            try { ws?.send("3"); } catch { /* swallow */ }
          }, interval);
        } catch {
          // Malformed handshake — let the connection fail naturally.
        }
        return;
      }

      if (type === "2") {
        // PING → PONG
        try { ws?.send("3"); } catch { /* swallow */ }
        return;
      }

      if (type === "4") {
        // Socket.IO MESSAGE. Sub-type at index 1:
        //   "0" CONNECT, "1" DISCONNECT, "2" EVENT, "3" ACK, "4" CONNECT_ERROR
        const sub = frame[1];
        if (sub === "2") {
          // EVENT — frame is "42[\"event-name\",payload]" or
          // "42/ns,[\"event-name\",payload]". Find the JSON-array start.
          const jsonStart = frame.indexOf("[");
          if (jsonStart < 0) return;
          try {
            const arr = JSON.parse(frame.slice(jsonStart));
            if (!Array.isArray(arr) || arr.length === 0) return;
            const eventName = arr[0];
            const payload = arr[1];
            dispatchEvent(eventName, payload);
          } catch (err) {
            log("warn", "bluebubbles_ws_event_parse_failed", {
              error: err?.message || String(err),
            });
          }
        }
      }
    }

    function dispatchEvent(eventName, payload) {
      if (eventName === "new-message" && typeof onMessage === "function") {
        try { onMessage(payload); }
        catch (err) {
          log("error", "bluebubbles_ws_onMessage_threw", {
            error: err?.message || String(err),
          });
        }
        return;
      }
      if (eventName === "typing-indicator" && typeof onTyping === "function") {
        try { onTyping(payload); }
        catch (err) {
          log("error", "bluebubbles_ws_onTyping_threw", {
            error: err?.message || String(err),
          });
        }
        return;
      }
      // Other events (chat-read-status-changed, updated-message, etc.) are
      // ignored for v1.2. Log at debug level only.
    }

    // Kick off the initial connection.
    connect().catch((err) => {
      log("error", "bluebubbles_ws_initial_connect_failed", {
        error: err?.message || String(err),
      });
      scheduleReconnect();
    });

    // Unsubscribe fn.
    return function unsubscribe() {
      stopped = true;
      clearPingTimer();
      if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
      if (ws) {
        try { ws.close(); } catch { /* ignore */ }
        ws = null;
      }
    };
  }

  return {
    send,
    sendTyping,
    sendReaction,
    markRead,
    subscribe,
    health,
    // Exposed for tests / introspection. Not part of the stable surface.
    _internal: { apiBase, resolveChatGuid },
  };
}

function stripTrailingSlash(s) {
  return String(s).replace(/\/+$/, "");
}

function randomHex(n) {
  let out = "";
  while (out.length < n) {
    out += Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, "0");
  }
  return out.slice(0, n);
}

function redactPwd(url) {
  return String(url).replace(/password=[^&]+/, "password=***");
}
