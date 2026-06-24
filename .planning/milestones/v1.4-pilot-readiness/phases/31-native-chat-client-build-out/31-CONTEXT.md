# Phase 31: Native Chat Client Build-Out - Context

**Gathered:** 2026-06-19
**Status:** Ready for planning

<domain>
## Phase Boundary

Turn the shipped channel-only ChatPane (bot-proxied Mattermost, town-square/off-topic only) into a **full native in-app chat client** used entirely inside the Workspace tab: channels + threads, DMs + group DMs, files, search, reactions, @mentions, and real-time delivery. Rendered via Mattermost's REST + WebSocket API; **Mattermost self-hosted on Fly stays the source of truth** — only the UI renderer + per-employee auth change. Native is forced (MM Team Edition unlicensed; OIDC/SSO is paid Enterprise — see `mm-oidc-sso-blocked-by-license`).

Delivered across Waves 0–5: **0)** per-employee MM personal access tokens (architectural unlock — proxy AS the user, not the parrot bot) → **1)** channels + threads → **2)** DMs + group DMs → **3)** files/search/reactions/@mentions → **4)** WebSocket real-time + notifications → **5)** hardening + UAT. The native-chat provisioning foundation (auto-create MM accounts at invite + `/api/chat/*` bootstrap + ChatPane reason codes, prod Worker `8e998c22`) is cherry-picked onto this branch as the Wave 0 base.

**Out of scope** (impossible natively, do NOT build): native mobile/desktop apps (official MM clients only); background push when the Workspace tab is closed (substituted by email notifications for offline mentions).
</domain>

<decisions>
## Implementation Decisions

### UI / Layout & Navigation
- **Reuse the Workspace SecondaryNav rail.** Channels + DMs render as nav items in the existing Workspace secondary-nav (the same rail pattern as the email folders list), not a bespoke Slack-style sidebar. The message view fills the remaining content area. Keeps the chat client visually consistent with the rest of the Workspace shell.
- **Threads open in a right-side thread panel.** Clicking a message's reply count slides open a panel on the right showing the thread; the main channel message list stays visible behind/beside it. (Not inline-expand, not modal.)

### UX / Notifications
- **Offline email notification triggers on @mentions + DMs** — email the employee when they are @mentioned OR receive a direct/group DM while the Workspace tab is closed/offline. Not "all unread" (too noisy), not "@mentions only" (DMs matter too).
- This email path is the deliberate substitute for background push (which is out of scope natively).

### Behavior / Presence
- **Presence (online/offline dot) + typing indicators.** No read receipts (avoids social pressure + extra state). Matches Slack/MM defaults.

### Composer / Files / Search
- **Full composer:** MM-native markdown formatting (bold/italic/lists/code blocks), emoji picker, file/image attach (drag-drop + paste), and @mention autocomplete.
- **Global search bar** at the top of the chat area, searching across all the employee's channels + DMs. Results show channel + author + snippet; clicking jumps to the message in context. (Not per-channel-only.)

### Permissions
- **Channel creation:** anyone can create **public** channels; **private** channels are **admin-only** (a guardrail around private spaces).
- **DM scope:** an employee can DM **anyone in the org** (direct or group DM). Not team-scoped.

### Claude's Discretion
- Exact in-app unread UX styling: badge on the Chat app-nav item, per-channel unread dots/bold, optional toast + sound — pick sensible defaults (badge + unread dots assumed; mention badges distinct from plain-unread).
- Thread panel width, message grouping (consecutive messages from same author), timestamp density, date dividers.
- Loading skeletons, empty states (new employee with only town-square; no DMs yet; zero search results), and error/reconnect states for the WebSocket.
- Reaction picker UX and how the emoji picker is surfaced.
- All technical/architecture choices are explicitly deferred to research + planning (see below) — not decided here.
</decisions>

<specifics>
## Specific Ideas

- Reference feel: Slack/Mattermost-class behavior (threads in a right panel, presence + typing, global search, @mention autocomplete) but **wrapped in the existing Workspace shell** (SecondaryNav rail for channels/DMs) rather than importing Slack's chrome wholesale.
- Identity: after Wave 0, human messages must be authored as the **real MM user**, dropping the `parrot_author_*` props reliance for human messages (the bot may still be kept for system/agent messages — see open decision).
</specifics>

<deferred>
## Deferred Ideas / Decided-Out

- **Read receipts** — explicitly declined for v1 (social pressure + state cost). Revisit only if employees ask.
- **Native mobile/desktop apps** — out of scope (roadmap): reachable only via the official MM clients (SSO/iframe), which the license block rules out.
- **Background push (tab closed)** — out of scope (roadmap): substituted by the @mentions + DMs email path.

## Open Technical Decisions (for rrr-phase-researcher / rrr-planner — NOT user-facing)
- Per-user MM token storage: Workers KV vs Durable Object vs Clerk `privateMetadata` vs encrypted SQLite column.
- Hybrid authorship: keep the `parrot` bot for system/agent messages while humans post under their own token?
- WebSocket path: browser → MM directly vs Worker-proxied Cloudflare WebSocket (auth + CORS + token-exposure implications).
- Multipart file upload through the Worker proxy (`/api/v4/files` → attach `file_ids`).
- Fly secret hygiene in Wave 5 (`MM_SERVICESETTINGS_ENABLEUSERACCESSTOKENS=true`, unset stray `ENABLEPERSONALACCESSTOKENS`).
</deferred>

---

*Phase: 31-native-chat-client-build-out*
*Context gathered: 2026-06-19*
