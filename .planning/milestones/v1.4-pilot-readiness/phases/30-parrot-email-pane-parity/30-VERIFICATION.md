---
phase: 30-parrot-email-pane-parity
verified: 2026-06-18
status: passed
score: 17/17 automated must-haves + 6/6 browser UAT verified
---

# Phase 30: Parrot Email-Pane Parity — Verification Report

**Status:** `passed` — all 17 code-side must-haves verified AND all 6 browser UAT checks passed by the operator on 2026-06-18 against the deployed branch (Worker Version `680fd480-a009-4530-b5ec-879150ba966b` on `workspace.internjobs.ai`). 6/6: star persistence, cross-folder Starred view, Archive+Undo, two-stage Delete, Agent|MCP tabs, on-demand feed cross-email correctness.

> **Post-UAT UI refinements (landed + operator-verified 2026-06-18, Worker `32e7e24d-29c8-4d3f-a3dd-e88a451b0420`):** six follow-up tweaks requested by the operator after the 6/6 UAT, each deployed and visually verified before the next. See "Post-UAT UI refinements" section below. PR drafted after all six landed.

**Gates:** `npm test` → **13/13 passed** (7 files; 3 new inbox-actions smoke tests + 10 prior). `npm run typecheck` (tsc -b) → **exit 0**.

## Must-haves checked against code

| # | Criterion | Evidence | Verdict |
|---|-----------|----------|---------|
| 1 | DO `getEmails`/`countEmails` honor a `starred` filter | `GetEmailsOptions.starred?` (durableObject/index.ts:70); options at :345; `WHERE starred=1` applied | ✓ |
| 2 | `POST /api/inbox/messages/:id/move` | index.ts:397 → `stub.moveEmail` | ✓ |
| 3 | Two-stage `DELETE /api/inbox/messages/:id` | index.ts:416 — `folder_id === Folders.TRASH` → `deleteEmail` `{hardDeleted:true}` (:425-427) else move to Trash `{movedToTrash:true}` (:431) | ✓ |
| 4 | `folder=starred` passthrough in list GET | index.ts:343 → `getEmails({starred:true})` + `countEmails({starred:true})` | ✓ |
| 5 | Star PATCH route not duplicated (Phase 27) | `patchMessage` present (api.ts:162); no second PATCH added | ✓ |
| 6 | Client `moveMessage` + `deleteMessage` helpers | api.ts:168, :175 | ✓ |
| 7 | EmailPanel Archive + Delete buttons + `onActioned` | EmailPanel.tsx:60 (`onActioned`), :108 `handleArchive`, :116 `handleDelete` (branches on `result.movedToTrash`) | ✓ |
| 8 | EmailPanel star button still present | star control intact (Phase 27 wiring untouched) | ✓ |
| 9 | InboxPane clear-selection + `invalidate(["parrot","inbox"])` | `handleActioned` + prefix invalidation (cascades to folder + message subkeys) | ✓ |
| 10 | InboxPane toast + Undo | `ToastState` (:38), `showToast(message, undoFn)` 4s auto-dismiss (:111) | ✓ |
| 11 | `folderTitle` "starred" → "Starred" | InboxPane.tsx:53-54 | ✓ |
| 12 | `inbox.tsx` "starred" in FOLDERS set | inbox.tsx:22 | ✓ |
| 13 | `inbox.tsx` Starred sidebar nav item (in Folders list) | inbox.tsx:68-70 (`/inbox?folder=starred`, label "Starred", Star icon) | ✓ |
| 14 | AgentPanel Agent \| MCP segmented tabs | AgentPanel.tsx header tab pair; `tab` state drives MCPPanel render | ✓ |
| 15 | On-demand feed: `FeedEntry` w/ `emailId` captured at creation | AgentPanel.tsx:72 interface; `pushFeedEntry` appends in onSuccess of summary/draft/extract/translate/chat (:231-321) | ✓ |
| 16 | Per-entry Draft reply uses `entry.emailId` not live prop | `ActivityFeedRow` owns mutation `api.agentDraftReply(entry.emailId, undefined, true)` (:151) | ✓ |
| 17 | Scope guard: no inbound pipeline / no auto-trigger | feed appends only in user-triggered mutation onSuccess; the `useEffect`s are scroll/focus/reset/initialAction(user-clicked) only — no agent call on email arrival | ✓ |

## Human-verification checklist (operator window)
Run when an operator session with valid Clerk prod auth is available:
1. Open an email → click Star; reload → star persists; "Starred" sidebar entry lists it across folders.
2. Archive an email → it leaves the list, "Archived — Undo" toast appears, Undo restores it.
3. Delete from Inbox → moves to Trash (Undo works); Delete again from Trash → permanent (no Undo).
4. AgentPanel: Agent | MCP tabs switch; MCP tab shows the tool catalog.
5. Trigger Summarize/Draft on email A → feed entry appears; navigate to email B → click email A's feed "Draft reply" → draft is for A, not B.

## Post-UAT UI refinements (2026-06-18)

Operator-requested follow-ups after the 6/6 UAT. Each was implemented on
`rrr/v1.4/team-workspace-30`, typecheck (`tsc -b` exit 0) + `npm test`
(13/13) re-run, deployed, and visually verified by the operator before the
next one. Final deployed Worker: `32e7e24d-29c8-4d3f-a3dd-e88a451b0420`.

| Commit | Change | Verified |
|--------|--------|----------|
| `d70270e` | Starred folder nav icon: drop `text-amber-400` so it matches the other folder icons | ✓ |
| `82cf4ad` | Email toolbar: Reply/Forward/Archive/Delete → icon-only with title+aria-label tooltips; three inline AI buttons + the list-header Agent toggle replaced by a single "Agent" button in the email toolbar that opens the right panel; Archive button becomes "Unarchive" (→ Inbox) when viewing the Archive folder | ✓ |
| `e1fd002` | Clicking a Drafts row opens the draft in the ComposePane editor ("Edit draft", new `draft` mode) instead of the read-only viewer; sends threaded when `in_reply_to` present, then removes the draft from Drafts | ✓ |
| `2b0b85b` | Per-folder count badges via new `GET /api/inbox/folder-counts` (total per folder, wired into `SecondaryNavItem`); mark-read on open (EmailPanel PATCHes `read=true` so the unread/bold styling clears) | ✓ |

Known follow-up (out of scope, not blocking): editing a draft and closing
without sending does not persist the edits back to the draft — there is no
update-draft endpoint yet.

## Notes
- Star toggle + `PATCH /api/inbox/messages/:id` were already shipped on `main` by Phase 27; Phase 30 did not re-implement them.
- Multi-channel shell (Dashboard/Email/Chat/Meetings/Phone/SMS, Clerk, brand) untouched.
