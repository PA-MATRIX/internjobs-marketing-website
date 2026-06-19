---
phase: 30-parrot-email-pane-parity
plan: "04"
subsystem: ui
tags: [react, react-query, parrot, agent, activity-feed]

# Dependency graph
requires:
  - phase: 30-02
    provides: AgentPanel Agent | MCP segmented tabs; the Agent tab body where the feed renders
provides:
  - On-demand session-scoped agent activity feed inside the Agent tab of AgentPanel
  - Per-entry one-click "Draft reply" affordance targeting the email the entry was created for
affects: [parrot-agent, email-pane, agent-feed-future-inbound]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Per-row useMutation closing over captured entry.emailId (stale-prop bug structurally impossible)"
    - "Session-scoped feed state with prepend-newest-first via pushFeedEntry helper"

key-files:
  created: []
  modified:
    - apps/parrot/app/components/AgentPanel.tsx

key-decisions:
  - "Feed is on-demand only — entries appended solely in user-triggered mutation onSuccess; no inbound pipeline, no mount/emailId auto-trigger"
  - "Split into ActivityFeed + ActivityFeedRow so each row owns a mutation closing over entry.emailId rather than a shared mutation over the live prop"

patterns-established:
  - "ActivityFeedRow: each entry captures emailId at creation time so navigating to a different email cannot draft for the wrong message"

# Metrics
duration: ~10min
completed: 2026-06-18
---

# Phase 30 Plan 04: Agent Activity Feed Summary

**Session-scoped on-demand agent activity feed inside the Agent tab, with a per-entry one-click "Draft reply" button that always targets the originating email via captured entry.emailId.**

## Performance

- **Duration:** ~10 min
- **Started:** 2026-06-17 (continued 2026-06-18)
- **Completed:** 2026-06-18
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments
- Added `FeedEntry` type capturing `emailId` at entry-creation time
- Added `feedEntries` session state plus a `pushFeedEntry` helper (prepend newest-first)
- Wired feed-entry appends into the onSuccess of all five user-triggered mutations (summarize, extract, translate, draft, chat)
- Added `ActivityFeed` + `ActivityFeedRow` sub-components; each row owns its own `useMutation` closing over `entry.emailId`, so the per-entry "Draft reply" button (`api.agentDraftReply(entry.emailId, undefined, true)`) always targets the email the entry was created for
- Rendered the feed above the quick-action bar inside the Agent tab only (not the MCP tab)

## Task Commits

Each task was committed atomically:

1. **Task 1: Add session-scoped activity feed to the Agent tab body** - `1aa06af` (feat)

**Plan metadata:** see final `docs(30-04)` commit.

## Files Created/Modified
- `apps/parrot/app/components/AgentPanel.tsx` - Added FeedEntry type, feedEntries state, pushFeedEntry helper, feed-entry appends in all mutation onSuccess callbacks, ActivityFeed + ActivityFeedRow components, and the feed render slot in the Agent tab body

## Decisions Made
- **On-demand only (CONTEXT.md Decision 1):** Feed entries are appended exclusively in the onSuccess of user-triggered mutations. No inbound pipeline, no per-inbound LLM call, no useEffect auto-triggering an agent call on mount or emailId change was added.
- **Per-row mutation over captured emailId:** Followed the plan's ActivityFeed + ActivityFeedRow split so each row's `useMutation` closes over `entry.emailId` independently, making the stale-emailId bug structurally impossible (rather than sharing one mutation over the live prop).
- **translateMut onSuccess label:** Used React Query's second onSuccess argument (`variables`, i.e. `lang`) to label the translate feed entry, since `lang` is the mutation arg, not an in-scope variable.

## Deviations from Plan

None - plan executed exactly as written. (The plan snippet referenced `lang` in `translateMut` onSuccess; this is the React Query mutation variable, surfaced via the standard `onSuccess(data, variables)` signature — a faithful implementation of the snippet's intent, not a deviation.)

## Issues Encountered
None. Typecheck (`npm run typecheck` in `apps/parrot`) passed clean (exit 0, no TS errors).

Note: an unrelated uncommitted change in `apps/parrot/app/lib/api.ts` (PARROT-FOLDER-ACTIONS-01 `moveMessage`/`deleteMessage`, from another track) was present in the working tree and was intentionally left untouched and unstaged. Only `AgentPanel.tsx` was staged for the Task 1 commit.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Track 3 (agent activity feed) is complete. The Agent tab shows a session-scoped feed with a one-click "Draft reply" affordance that always targets the originating email.
- The multi-channel shell and Agent | MCP tabs (30-02) remain intact.
- Feed is session-scoped only (resets on component unmount); a future phase could add the deferred inbound auto-draft pipeline (CONTEXT.md Deferred) if desired — explicitly out of scope here.

---
*Phase: 30-parrot-email-pane-parity*
*Completed: 2026-06-18*
