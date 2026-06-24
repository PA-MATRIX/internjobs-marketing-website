# Phase 31 — Post-UAT Gap Fixes Summary

**Date:** 2026-06-23
**Branch:** `rrr/v1.4/team-workspace-31`
**Status:** Shipped to production and human-verified (live UAT by operator).

After the Phase 31 native-chat build-out and its earlier `31-gap` batch, a round of
operator UAT surfaced a set of polish/usability gaps in chat + notifications. All were
fixed, deployed to production (Cloudflare Worker `internjobs-parrot`), and verified live
by the operator. Final deployed Worker version: `9cc1ab03`.

## Fixes shipped

1. **Chat sound + vibration** — chime (single tone normal, two-tone on @mention) + device
   vibration on incoming messages from others, with a 🔊/🔇 mute toggle in the chat header
   (persisted in `localStorage`). Fires for any channel/DM you're a member of.

2. **"Attach to Email" → "Open in Inbox"** — the cross-pane handoff now actually opens the
   Inbox composer pre-filled (subject + quoted blockquote body) instead of only routing to
   `/inbox`. (`ComposePane.tsx`, `InboxPane.tsx`.)

3. **Pinned-message recolor + collapse** — pinned bar, pin badge, and pin toggle recolored
   from amber to the chat accent (sky); pinned bar collapses to 3 with a "Load more (N)" /
   "Show less" toggle so many pins no longer swamp the feed.

4. **Notification deep-linking (all types)** — clicking a notification opens the exact
   target, not just the pane:
   - chat mention → opens the channel + scrolls to / flashes the message
   - starred email → opens that email in the reader (`/inbox?message=<id>`)
   - urgent todo → opens its source email or source chat channel + message
   - Worker stamps each notification `url`; `ChatPane` watches the router location for
     `?channel=&post=` (works even when already on /chat); inbox reads `?message=`.

5. **Context-aware header search** — on the Email pane the global search now searches
   **emails** (new `GET /api/inbox/search` backing onto the DO's `searchEmails`), with an
   email-styled dropdown that opens the email on click; on Chat (and elsewhere) it searches
   chat as before. Placeholder switches accordingly.

6. **Notification dismiss / Clear all** — clicking a notification now discards it from the
   drawer; the header button is "Clear all" (empties the drawer). Backed by a new
   `DELETE /api/notifications` (optional `ids`) + DO `clearNotifications()`.

7. **Channel/DM name in mention titles** — mention notification titles now read
   `Mention in Chat (#channel)`, `Mention in Chat (DM from <name>)`, or
   `Mention in Chat (group DM from <name>)`. New `getMmChannel` + `mmChannelLabel` helpers.

8. **Real-time bell notifications** — the bell was previously fed only by the ~60s
   background poll (lagging behind the live chime). It now rides the same WebSocket: the
   client creates the notification instantly off the MM `posted` event (authoritative
   `mentions` / `channel_type` / `sender_name`) via `POST /api/chat/notify`, and the poll
   remains a backstop, deduped on the post-scoped `url` so there are no doubles. This also
   adds DM bell notifications (previously absent — the bot poll can't see DM channels).

## Known limitation (carried, not a regression)

- Offline DM notifications still won't bell/email — the background poll runs as a bot that
  can't enumerate DM channels. DMs bell in real-time while online; channel mentions keep
  their offline push/email path.

## Verification

- `tsc -b` clean; `vitest run` 77/77 pass; `react-router build` clean.
- Operator verified each fix live in production after deploy. Final Worker: `9cc1ab03`.

## Files touched (this batch)

- `apps/parrot/app/components/ChatPane.tsx`
- `apps/parrot/app/components/WorkspaceShell.tsx`
- `apps/parrot/app/components/InboxPane.tsx`
- `apps/parrot/app/components/ComposePane.tsx`
- `apps/parrot/app/lib/api.ts`
- `apps/parrot/workers/index.ts`
- `apps/parrot/workers/durableObject/index.ts`
- `apps/parrot/workers/lib/mattermost.ts`
- `apps/parrot/wrangler.jsonc` (WS upstream override — `MATTERMOST_WS_URL`)
