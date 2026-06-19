# Phase 30: Parrot Email-Pane Parity - Context

**Gathered:** 2026-06-17
**Status:** Ready for planning

<domain>
## Phase Boundary

Bring the Parrot Workspace **email pane** up to agentic-inbox feature parity, without regressing Parrot's branded multi-channel shell (no Kumo skin, no email-only layout). Four tracks:

1. **Email actions** — enable the Star toggle (currently disabled "coming soon"), add Archive + Delete, add a cross-folder Starred view. The DurableObject already has `updateEmail(id,{starred})`, `moveEmail(id,folderId)`, and `deleteEmail(id)`; this track is HTTP routes + `app/lib/api.ts` client helpers + EmailPanel/InboxPane/inbox.tsx UI wiring.
2. **Agent | MCP tabs** — promote AgentPanel's existing `chat | tools` toggle into a proper segmented **Agent | MCP** tab control; the MCP tab surfaces the existing tool catalog (MCPPanel). No new MCP transport/server in this phase.
3. **Agent activity feed (on-demand)** — a feed that logs agent activity and offers a one-click "Draft reply" per email. NOT an inbound auto-draft pipeline (see Decisions).
4. **Keep the multi-channel shell intact** — Dashboard/Email/Chat/Meetings/Phone/SMS rail, Clerk auth, InternJobs brand all unchanged.

Out of scope: full auto-draft-on-inbound, inline reading-pane composer, any Kumo/email-only re-skin (see Deferred).
</domain>

<decisions>
## Implementation Decisions

### Behavior — Auto-draft / agent feed
- **On-demand only.** Do NOT call the LLM automatically on every inbound email. The inbound path keeps its current todo-extraction behavior — this phase does NOT reverse that design.
- The "agent feed" logs agent *activity* (drafts the user triggers, summaries, extracted todos/actions) plus a one-click **Draft reply** affordance per email.
- Because there's no per-inbound LLM call, there is no new per-inbound cost and no new prompt-injection surface beyond what the existing on-demand agent endpoints already handle (`blocked` path stays as-is).

### Behavior — Delete (two-stage)
- Delete from Inbox / Sent / Drafts / Archive → **move to Trash** (recoverable) via `moveEmail(id, 'trash')`.
- Delete while the message is **already in Trash** → **permanent hard-delete** via `deleteEmail(id)`.
- Archive → `moveEmail(id, 'archive')`.

### UX — Action feedback (close + toast + Undo)
- After Archive/Delete of the currently-open email: return to the message list, refresh it, and show a brief toast (e.g. "Archived — Undo").
- **Undo** reverses the last action (move the message back to its previous folder; for a Trash hard-delete there is no undo — only the move-to-Trash step is undoable).
- List + folder counts update without a full page reload (React Query invalidation).

### UI — Starred view placement
- Add **"Starred"** as an entry **inside the existing Folders list** in the email sidebar (alongside Inbox/Sent/Drafts/Archive/Trash), not a separate top-level section.
- Starred is a cross-folder view (messages where `starred = 1`, any folder), so the list query needs a starred filter (the DO `getEmails` currently filters by folder only).

### UI — Agent | MCP tabs
- Two real segmented tabs in the AgentPanel header: **Agent** (the existing chat + quick-actions) and **MCP** (the existing MCPPanel tool catalog). Rename the current "Tools" affordance to "MCP".

### Claude's Discretion
- Toast/notification component choice and exact copy/timing.
- Whether manual star also fires the existing `starred_email` notification or is a pure flag (lean: pure flag on manual star; the notification stays reserved for inbound starred email).
- Exact icons, spacing, and where the agent-feed surface renders within the existing AgentPanel/Inbox layout.
- Optimistic-update vs refetch strategy for star/move/delete.
</decisions>

<specifics>
## Specific Ideas

- Reference is the upstream agentic-inbox demo (`https://github.com/cloudflare/agentic-inbox/raw/main/demo_app.png`) — adopt its email-pane *affordances* (star, archive/delete toolbar, Agent|MCP tabs, agent feed) but NOT its Cloudflare-Kumo visual skin.
- The Star button already exists in `EmailPanel.tsx` but is hardcoded `disabled` with title "Star (coming soon)" + a `TODO PARROT-STAR-API` comment — this phase wires it.
- Phase 27 already scoped `STAR-API-01` (`PATCH /api/inbox/messages/:id`) as the star endpoint seam — reuse that shape.
</specifics>

<deferred>
## Deferred Ideas

- **Full auto-draft on inbound** — generate + save a draft reply for every new inbound email, with a live "Created draft reply to…" feed. Backend-heavy (inbound pipeline + per-inbound LLM cost + injection safety); its own future phase.
- **Inline reading-pane composer** — the agentic-inbox demo drafts/sends inline in the reading pane; Parrot keeps its separate ComposePane modal for now.
- **Public MCP server endpoint (/mcp transport)** — already deferred in MCPPanel pending the multi-employee auth review; the MCP tab only surfaces the in-app tool catalog.
</deferred>

---

*Phase: 30-parrot-email-pane-parity*
*Context gathered: 2026-06-17*
