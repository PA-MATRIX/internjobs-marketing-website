---
phase: 30-parrot-email-pane-parity
plan: "02"
subsystem: ui
tags: [react, parrot, agent-panel, mcp, tabs, tailwind]

# Dependency graph
requires:
  - phase: 30-parrot-email-pane-parity
    provides: AgentPanel with single Tools toggle and MCPPanel tool catalog
provides:
  - AgentPanel header upgraded to a two-tab segmented control (Agent | MCP)
  - Both Agent (chat/quick-actions) and MCP (tool catalog) modes are simultaneously discoverable
affects: [parrot-email-pane, agentic-inbox-parity]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Segmented tab control via two adjacent buttons with stitched borders (rounded-l border / rounded-r border-t/r/b), active state highlighted indigo"

key-files:
  created: []
  modified:
    - apps/parrot/app/components/AgentPanel.tsx

key-decisions:
  - "Kept existing useState<'chat'|'tools'> tab state unchanged; only the header rendering and labels changed (chat→Agent, tools→MCP)"

patterns-established:
  - "Segmented tab pair: left button rounded-l + full border, right button rounded-r + border-t/r/b to share the seam"

# Metrics
duration: 6min
completed: 2026-06-18
---

# Phase 30 Plan 02: Agent | MCP Segmented Tabs Summary

**AgentPanel header upgraded from a single "Tools" toggle into a proper two-tab segmented control labeled "Agent" and "MCP", making both modes discoverable at once.**

## Performance

- **Duration:** ~6 min
- **Started:** 2026-06-18
- **Completed:** 2026-06-18
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments
- Replaced the single "Tools" toggle button with a two-button segmented tab pair in the AgentPanel header
- Left tab "Agent" (Sparkles icon, `rounded-l border`) drives `setTab("chat")` and shows the chat + quick-actions body
- Right tab "MCP" (Wrench icon, `rounded-r border-t/r/b`) drives `setTab("tools")` and shows the MCPPanel tool catalog
- Active tab is visually distinguished with indigo background/border; inactive is white/slate with hover
- "Tools" label removed from the header; MCPPanel content and the `tab === "tools"` render conditional left untouched

## Task Commits

Each task was committed atomically:

1. **Task 1: Replace single Tools toggle with Agent | MCP segmented tab control** - `af909ea` (feat)

**Plan metadata:** (this commit) (docs: complete plan)

## Files Created/Modified
- `apps/parrot/app/components/AgentPanel.tsx` - Header right-side section now renders two segmented tab buttons (Agent, MCP) plus the close button; tab state and body conditional unchanged

## Decisions Made
- Preserved the existing `useState<"chat" | "tools">("chat")` state and the `tab === "tools"` body conditional; this is a header/label refactor only, no behavior or transport change (per plan constraints).

## Deviations from Plan
None - plan executed exactly as written.

## Issues Encountered
None. `npm run typecheck` in `apps/parrot` passed (exit 0, no TS errors). Note: the typecheck script also regenerates wrangler runtime types as part of its run — expected output, not an error.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- AgentPanel now matches the agentic-inbox reference Agent|MCP header layout.
- UI-only change; no migrations, env, or transport changes.
- Visual confirmation (two tabs render, active highlight, content switches correctly) is recommended during phase verification / submit-phase.

---
*Phase: 30-parrot-email-pane-parity*
*Completed: 2026-06-18*
