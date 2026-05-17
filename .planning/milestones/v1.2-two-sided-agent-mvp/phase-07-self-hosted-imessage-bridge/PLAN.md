---
phase: 07-self-hosted-imessage-bridge
plan: 01
type: execute
wave: 1
depends_on: ["phase-01-preflight-sms-abstraction"]
files_modified:
  - apps/mac-bridge/package.json
  - apps/mac-bridge/src/config.mjs
  - apps/mac-bridge/src/security.mjs
  - apps/mac-bridge/src/listener.mjs
  - apps/mac-bridge/src/server.mjs
  - apps/mac-bridge/setup.sh
  - apps/mac-bridge/launchd/ai.internjobs.mac-bridge.plist
  - apps/mac-bridge/.env.example
  - apps/app/src/sms/mac-bridge.mjs
  - apps/app/src/config.mjs
  - apps/app/src/server.mjs
  - .gitignore
autonomous: false
verification:
  surface: backend_only
  frontend_impact: false
  required_steps:
    - unit_tests
    - manual_end_to_end_smoke
must_haves:
  truths:
    - "https://bridge.internjobs.ai/health returns 200 OK from anywhere on the public internet"
    - "POST /v1/send with a valid HMAC-SHA256 signature is accepted; bad signatures return 401"
    - "POST /webhooks/mac-bridge on the Fly app accepts signed payloads and writes inbound_messages rows when the channel_address matches a confirmed student"
    - "SMS_PROVIDER=mac-bridge on Fly routes outbound through the Mac (spectrum-ts cloud falls back if unset)"
    - "Mac-side bridge + cloudflared restart on @reboot cron (launchd bootstrap failed over SSH — known macOS quirk; documented)"
  artifacts:
    - path: "apps/mac-bridge/src/server.mjs"
      provides: "HTTP server on 127.0.0.1:8787 with /v1/send + /health"
    - path: "apps/mac-bridge/src/listener.mjs"
      provides: "spectrum-ts local-mode listener; forwards inbound iMessage events to Fly via HMAC POST"
    - path: "apps/app/src/sms/mac-bridge.mjs"
      provides: "MacBridgeSmsProvider implementing the SmsProvider seam (verifyWebhook, parseInbound, sendSms)"
    - path: "apps/app/src/server.mjs (route)"
      provides: "POST /webhooks/mac-bridge mirroring /webhooks/photon"
  key_links:
    - from: "iMessage to the agent number"
      to: "Messages.app on the Mac mini"
      via: "Apple IDS registration on the agent Apple ID (Phase 07 hand-off depends on Phase 09 user action)"
    - from: "spectrum-ts local listener (Mac)"
      to: "Fly /webhooks/mac-bridge"
      via: "HMAC-SHA256 over JSON, BRIDGE_HMAC_SECRET shared with the Fly app"
    - from: "Mastra workflow on Fly"
      to: "iMessage delivered by Mac"
      via: "macBridgeProvider.sendSms → POST https://bridge.internjobs.ai/v1/send → CF Tunnel → spectrum-ts.message.reply"
---

<objective>
Replace the Photon-cloud iMessage dependency with self-hosted infrastructure
that we fully own, eliminating the $250/mo/line Photon Business price tag and
the shared-identity routing of Photon's hobby tier.

Stack: dedicated Mac mini at HostMyApple ($64.99/mo) running spectrum-ts in
LOCAL mode (`@photon-ai/imessage-kit` via Messages.app on macOS 26+), a
Cloudflare Tunnel exposing the bridge on bridge.internjobs.ai, and a
MacBridgeSmsProvider on Fly implementing the existing SmsProvider seam.

Total recurring infra cost: $73/mo (Mac mini + US Mobile $10 unlimited
talk+text SIM) versus Photon Business $250/mo for the same architecture.
</objective>

<execution_context>
@~/.claude/rrr/workflows/execute-plan.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/REQUIREMENTS.md
@apps/app/src/sms/spectrum.mjs       # existing reference SmsProvider impl
@apps/app/src/sms/provider.mjs       # SmsProvider JSDoc contract
</context>

<plan>

## Architecture

```
Student iPhone                                            internjobs.ai infra
─────────────                                             ──────────────────
                                                          ┌────────────────────┐
[iMessage / SMS] ──→ Apple IDS ──→ Mac mini             │ Fly: app.internjobs│
                                   (Messages.app)        │       .ai          │
                                       │                 │                    │
                                       ▼                 │  /webhooks/        │
                                  spectrum-ts            │     mac-bridge ◄───┼── HMAC POST
                                  (local mode)           │                    │
                                       │                 │  /v1/send via ◄────┼── HMAC POST
                                       ▼                 │   bridge.internjobs│   from workflow
                                  apps/mac-bridge        │   .ai → CF Tunnel  │
                                  (Node 22 + http)       │                    │
                                       │                 └────────────────────┘
                                       ▼
                              cloudflared (launchd)
                                       │
                                       ▼
                              CF Tunnel (4 conn)
                                       │
                                       ▼
                              bridge.internjobs.ai
                                  (public HTTPS)
```

## Steps

### Step 1: Mac mini provisioning (USER ACTION — done 2026-05-17)
- Rent Mac mini M1 8GB at HostMyApple ($64.99/mo)
- NoMachine GUI access verified
- Order US Mobile $10/mo unlimited-talk-text SIM (USER ACTION — not yet ordered)

### Step 2: Mac bootstrap (Claude — done)
- SSH key + passwordless sudo for `raj` (corrected from `Raj` in welcome email — macOS lowercases short usernames)
- Xcode CLT + Homebrew + Node 22 + cloudflared + jq + git
- ~/.zshenv configured for non-interactive SSH PATH

### Step 3: apps/mac-bridge skeleton (Claude — done, commit 61e9707)
- package.json: `spectrum-ts@^1.9.1` (pulls `@photon-ai/imessage-kit@3.0.0` transitively)
- src/config.mjs: BRIDGE_PORT, BRIDGE_HOST, BRIDGE_HMAC_SECRET, BRIDGE_OUTBOUND_WEBHOOK_URL
- src/security.mjs: HMAC sign + constant-time verify
- src/listener.mjs: spectrum-ts local Spectrum with `imessage.config({ local: true })`; threadCache Map<phone, {space, lastMessage}>; outbound prefers message.reply on the cached thread
- src/server.mjs: Node http with /health + /v1/send
- launchd/ai.internjobs.mac-bridge.plist + setup.sh (later superseded by @reboot crontab — see Step 6)

### Step 4: Cloudflare Tunnel (Claude — done)
- New tunnel `internjobs-bridge` UUID 99bd2070-ca4b-4084-9f0f-9798b6cb9c6a
- DNS bridge.internjobs.ai → CNAME → 99bd2070...cfargotunnel.com
- 4 edge connections active

### Step 5: Fly-side wiring (Claude — done, commit d89fe4a)
- MacBridgeSmsProvider in apps/app/src/sms/mac-bridge.mjs
- POST /webhooks/mac-bridge mirroring /webhooks/photon (HMAC verify, pairing-code path, fire-and-forget workflow)
- SMS_PROVIDER env selector (`spectrum` | `mac-bridge`); default stays `spectrum` until Apple ID activation (Phase 09)
- Fly secrets: BRIDGE_URL + BRIDGE_HMAC_SECRET deployed

### Step 6: Persistence — @reboot crontab (Claude — done)
- ~/bin/start-mac-bridge.sh + ~/bin/start-cloudflared.sh wrappers
- crontab `@reboot` entries (launchd `gui/uid` + `user/uid` bootstrap both failed over SSH with macOS 26.3; cron is the documented workaround)

### Step 7: End-to-end verify (Claude — done)
- curl /health through CF Tunnel → 200 OK
- /v1/send with bad sig → 401
- /webhooks/mac-bridge synthetic signed payload → 200 (eventType=unmatched_inbound — fake number not a real student)

### Step 8: Activation hand-off (depends on Phase 09)
- After agent Apple ID is signed into Messages.app on the Mac, flip Fly env: SMS_PROVIDER=mac-bridge
- Real iMessage round-trip via the bridge will land an inbound_messages row provider='mac-bridge'

</plan>

<commits>
- 61e9707 — Add apps/mac-bridge skeleton for self-hosted iMessage
- d89fe4a — Add MacBridgeSmsProvider + /webhooks/mac-bridge route
- d5f3eb1 — mac-bridge: use Node --env-file for .env loading
</commits>
