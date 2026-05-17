---
phase: 07b-bluebubbles-native-ux
plan: 01
type: execute
wave: 1
depends_on: ["phase-07-self-hosted-imessage-bridge"]
files_modified:
  - apps/mac-bridge/package.json
  - apps/mac-bridge/src/listener.mjs
  - apps/mac-bridge/src/server.mjs
  - apps/mac-bridge/src/config.mjs
  - apps/mac-bridge/setup.sh
  - apps/mac-bridge/launchd/ai.internjobs.mac-bridge.plist
  - infra/astrolabe/macmini.swift   # NEW
new_files:
  - apps/mac-bridge/src/bluebubbles-client.mjs
deprecates:
  - "spectrum-ts local mode in mac-bridge"
  - "@reboot crontab persistence (replaced by Astrolabe LaunchDaemon)"
autonomous: false
verification:
  surface: backend_only
  frontend_impact: false
  required_steps:
    - manual_end_to_end_smoke
    - bluebubbles_server_installation
must_haves:
  truths:
    - "BlueBubbles server installed + running on the Mac mini (LaunchDaemon-managed)"
    - "apps/mac-bridge talks to BlueBubbles' Hono REST API instead of spectrum-ts local mode"
    - "Inbound: BlueBubbles WebSocket → bridge → Fly /webhooks/mac-bridge (unchanged wire shape)"
    - "Outbound: bridge → BlueBubbles POST /api/v1/message/text"
    - "Typing indicator (BlueBubbles `typing-indicator` API) shows on recipient's iOS during LLM call"
    - "Read receipts fire automatically via BlueBubbles' read-receipt handling (no AppleScript hacks)"
    - "Tapbacks via BlueBubbles `reaction` API (👀 ack on inbound)"
    - "End-to-end round-trip preserves all v1 functionality: SMS_PROVIDER=mac-bridge still routes correctly, Fly /webhooks/mac-bridge HMAC unchanged, /v1/send semantics unchanged"
    - "Astrolabe-managed LaunchDaemon survives reboots (replaces @reboot crontab hack)"
  artifacts:
    - path: "apps/mac-bridge/src/bluebubbles-client.mjs"
      provides: "Thin TypeScript client for BlueBubbles' REST + WebSocket APIs (subscribe, send, react, typing, markRead)"
    - path: "apps/mac-bridge/src/listener.mjs"
      provides: "Rewritten listener using BlueBubbles WebSocket; native UX hooks replace spectrum-ts limitations"
    - path: "infra/astrolabe/macmini.swift"
      provides: "Declarative Mac mini config: LaunchDaemon for mac-bridge + cloudflared + BlueBubbles, Homebrew, env"
  key_links:
    - from: "iMessage to +14063210019"
      to: "Messages.app on Mac → BlueBubbles server"
      via: "Apple's IMCore (BlueBubbles helper has the bridge)"
    - from: "BlueBubbles server"
      to: "apps/mac-bridge"
      via: "WebSocket subscription on new-message + typing events"
    - from: "Fly POST /v1/send"
      to: "Recipient iMessage"
      via: "bridge → BlueBubbles REST → IMCore → Apple IDS"
---

<objective>
Replace spectrum-ts local mode with BlueBubbles to achieve full native iMessage UX (typing bubbles, tapbacks, read receipts, unsend, edit) on our self-hosted Mac mini — features spectrum-ts LOCAL mode does not support and Photon's `advanced-imessage-kit` requires their paid hosted daemon for.

Stays at $73/mo total infra cost (BlueBubbles is MIT/free, runs on the same Mac mini). Closes the UX-parity gap with Photon Business / Standout without subscribing to their managed services.

Bonus: adopt Astrolabe to declare the Mac mini's config as code, replacing the @reboot crontab hack from Phase 07.
</objective>

<execution_context>
@~/.claude/rrr/workflows/execute-plan.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/milestones/v1.2-two-sided-agent-mvp/phase-07-self-hosted-imessage-bridge/PLAN.md
@apps/mac-bridge/src/listener.mjs
@apps/mac-bridge/src/server.mjs
@apps/mac-bridge/src/config.mjs
External:
  https://github.com/bluebubbles/bluebubbles-server   # Swift server binary
  https://docs.bluebubbles.app/private-api/installation  # Private API (for typing/react/markRead)
  https://github.com/photon-hq/Astrolabe              # macOS declarative config
</context>

<plan>

## Wave 1 — BlueBubbles server install (Claude+user, ~30 min)

### Step 1: Install BlueBubbles Server
- Download BlueBubbles-Server-macOS-x.y.z.dmg from official GitHub releases
- Install on the Mac mini via NoMachine (drag to Applications)
- First-run setup: grant Full Disk Access + Automation permissions in System Settings → Privacy & Security
  - Full Disk Access: required to read chat.db
  - Automation → System Events: required for sending messages via Messages.app
  - Accessibility: required for the Private API helper (typing/react/markRead)
- Optional but required for native UX: install BlueBubbles' Private API helper (a Mach injection into Messages.app — REVERSIBLE, no kernel extension)

### Step 2: Configure BlueBubbles for our use case
- Authentication: use a long bearer token (BlueBubbles supports password auth out of the box; bearer-style works fine)
- Listen address: 127.0.0.1:1234 (bound to localhost; Cloudflare Tunnel exposes selectively)
- Enable Private API features in BlueBubbles settings: send-with-effects, typing indicators, read receipts, reactions
- HTTP API base URL: http://127.0.0.1:1234/api/v1

### Step 3: Rewrite apps/mac-bridge
- New `apps/mac-bridge/src/bluebubbles-client.mjs` — thin client wrapping BlueBubbles' REST + WebSocket APIs:
  - `connect()` — WebSocket subscription
  - `send({ to, text })` — POST /api/v1/message/text
  - `sendTyping(to, on)` — POST /api/v1/chat/:guid/typing
  - `sendReaction(to, msgGuid, reaction)` — POST /api/v1/message/react
  - `markRead(chatGuid)` — POST /api/v1/chat/:guid/markRead
- Rewrite `listener.mjs` to subscribe to BlueBubbles' WebSocket new-message event, forward to Fly as today
- Rewrite `server.mjs` POST /v1/send to call bluebubbles-client.send() with typing-bracketing:
  - On inbound: react("👀") + markRead(chatGuid) + sendTyping(true)
  - On outbound: sendTyping(false) + send(text)
- Drop spectrum-ts dep entirely; new dep: just node:fetch + ws

### Step 4: SMS provider seam stays the same
- /webhooks/mac-bridge on Fly is unchanged (HMAC, payload shape)
- MacBridgeSmsProvider unchanged
- Only the BRIDGE-internal implementation changes; SMS_PROVIDER=mac-bridge keeps working

### Step 5: End-to-end smoke test
- User texts +14063210019 → expect to SEE typing bubble + read receipt + agent reply
- Visual confirmation from user replaces the chat.db SQL inspection of Phase 07

## Wave 2 — Astrolabe Mac mini config (Claude, ~half day)

### Step 6: Replace @reboot crontab with Astrolabe-managed LaunchDaemon
- `infra/astrolabe/macmini.swift` declares: LaunchDaemons for mac-bridge + cloudflared + BlueBubbles, Homebrew deps, env file mounts, log rotation
- `astrolabe apply` on the Mac brings the machine into compliance
- Survives Mac re-provisioning (HostMyApple support wipe-and-reinstall) without manual reconfig

## Risks

- **BlueBubbles Private API helper requires Messages.app injection** — Apple may break this on a future macOS update. Mitigation: pin macOS version, monitor BlueBubbles release notes, keep spectrum-ts fallback path commented out for rapid revert.
- **First-run permissions are interactive** — TCC prompts (Full Disk Access, Accessibility, Automation) require GUI clicks via NoMachine. Can't automate.
- **BlueBubbles is open-source but smaller than Photon** — less polished, occasionally rough edges. Acceptable for v1.2 launch; revisit if reliability becomes an issue.

## Omnichannel patterns lifted from Photon (for reference + future use)

The repo survey surfaced several Photon patterns worth absorbing into our internal abstractions even though we're not adopting their hosted SDK. Wave 1 keeps these implicit; explicit codification deferred to Phase 10 (multi-channel agent) when we add WhatsApp/Telegram:

- **Space abstraction** (spectrum-ts pattern): every platform exposes a `Space` with the same methods — `send`, `react`, `responding`, `markRead`. Mastra workflows pass `space` objects, never platform-specific transport details. Our `MacBridgeSmsProvider` already does this informally via the `SmsProvider` seam (`apps/app/src/sms/provider.mjs`); Phase 10 will generalize to `MessageChannel` covering iMessage + email + future WhatsApp/Telegram.
- **`message.reply()` thread continuity** (Photon cloud only): platform-specific quoted-reply rendering. BlueBubbles supports this natively. Worth using for our agent so replies thread inline rather than appearing as standalone messages — improves UX on group/multi-turn conversations.
- **`uri` deep-link builder** (`@photon-ai/uri`): unified deep-link generator across iMessage / SMS / WhatsApp / Telegram. Captured separately in Phase 09 QR onboarding plan.
- **`mcp` server pattern** (Photon's `mcp` repo, 67 iMessage tools): expose channel actions as MCP tools so external agents (Claude/Cursor/Codex) can drive them uniformly. Aligned with Phase 08 Wave 2b agentic-inbox MCP wiring — extend the same pattern to iMessage in Phase 10.
- **`webhook` HMAC envelope** (Photon's `webhook` repo): same `x-bridge-signature: sha256=<hex>` shape we already use. Validates our home-rolled approach matches Photon's design — no rework needed.
- **`Astrolabe` declarative macOS config**: adopted in Wave 2 of this phase.

What we are NOT lifting:
- spectrum-ts cloud SDK (would route through Photon's gRPC gateway — defeats self-hosting goal)
- advanced-imessage-kit (requires Photon's paid daemon)
- vercel-chat-adapter-imessage (Vercel Chat SDK is a different ecosystem from Mastra)
- hermes-agent's Python skill-creation loop (interesting but architecturally distant from our TypeScript + Mastra stack)

</plan>

<commits>
(none yet — Wave 1 not started; this is a forward-looking plan)
</commits>
