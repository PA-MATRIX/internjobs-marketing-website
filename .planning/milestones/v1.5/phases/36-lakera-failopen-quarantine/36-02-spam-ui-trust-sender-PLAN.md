---
phase: 36-lakera-failopen-quarantine
plan: 02
type: execute
wave: 2
depends_on: ["36-01"]
files_modified:
  - apps/parrot/app/routes/inbox.tsx
  - apps/parrot/app/components/EmailPanel.tsx
  - apps/parrot/app/components/InboxPane.tsx
  - apps/parrot/app/lib/api.ts
autonomous: true
skills:
  - projecta.testing-vitest-playwright
  - projecta.visual-proof
  - anthropic.webapp-testing
skills_mode: normal

verification:
  surface: ui_affecting
  frontend_impact: true
  required_steps:
    - unit_tests
    - playwright
    - chrome_visual_check

must_haves:
  truths:
    - "Employee sees a 'Spam' item in the email sidebar nav with an accurate count badge"
    - "Employee can open the Spam folder and read a quarantined message using the same safe iframe renderer (EmailIframe/DOMPurify) as every other folder — no new rendering path"
    - "Employee can click 'Trust sender' on a spam message; the message moves to Inbox and a confirmation toast appears"
    - "The 'Trust sender' button is only shown when viewing the Spam folder — it does not appear on Inbox/Archive/etc."
  artifacts:
    - path: apps/parrot/app/routes/inbox.tsx
      provides: "\"spam\" added to the FOLDERS set + a Spam SecondaryNavItem wired to counts.spam"
    - path: apps/parrot/app/lib/api.ts
      provides: "api.trustSender() client helper + FolderCounts.spam field"
    - path: apps/parrot/app/components/EmailPanel.tsx
      provides: "\"Trust sender\" action button rendered only when folder === \"spam\""
    - path: apps/parrot/app/components/InboxPane.tsx
      provides: "folderTitle(\"spam\") -> \"Spam\"; handleActioned(\"trusted\") toast + query invalidation"
  key_links:
    - from: apps/parrot/app/components/EmailPanel.tsx
      to: apps/parrot/app/lib/api.ts (trustSender)
      via: "handleTrustSender() onClick calling api.trustSender(emailId), then onActioned?.(\"trusted\")"
      pattern: "api\\.trustSender\\("
    - from: apps/parrot/app/routes/inbox.tsx
      to: apps/parrot/app/lib/api.ts (getFolderCounts)
      via: "counts?.spam badge prop on the Spam SecondaryNavItem"
      pattern: "counts\\?\\.spam"
---

<objective>
Make the Spam folder + "Trust sender" action actually visible and clickable in the Workspace
email pane. Plan 36-01 already wired the storage/backend (quarantine-on-hard-block, per-employee
trust table, the two HTTP routes); this plan is purely the client wiring — no new backend logic.

Purpose: turn Track 1's storage-layer work into the actual product behavior the roadmap
promises — a visible, recoverable Spam folder with an Outlook-style Trust-sender button.
Output: a "Spam" sidebar item with a live count badge, and a folder-conditional "Trust sender"
button on the email reader.
</objective>

<execution_context>
@~/.claude/rrr/workflows/execute-plan.md
@~/.claude/rrr/templates/summary.md
</execution_context>

<context>
@.planning/milestones/v1.5/phases/36-lakera-failopen-quarantine/36-RESEARCH.md
@.planning/milestones/v1.5/phases/36-lakera-failopen-quarantine/36-01-quarantine-backend-SUMMARY.md
@apps/parrot/app/routes/inbox.tsx
@apps/parrot/app/components/EmailPanel.tsx
@apps/parrot/app/components/InboxPane.tsx
@apps/parrot/app/lib/api.ts
@apps/parrot/app/components/EmailIframe.tsx
</context>

<tasks>

<task type="auto">
  <name>Task 1: api.ts client helper + FolderCounts.spam</name>
  <files>apps/parrot/app/lib/api.ts</files>
  <action>
1. Add `spam: number;` to the `FolderCounts` interface (~line 135-142), alongside the existing
   `inbox`/`sent`/`draft`/`archive`/`trash`/`starred` fields.

2. Add a `trustSender` helper to the `api` object, placed near `moveMessage`/`deleteMessage`
   (~line 187-202), matching their JSDoc-comment + return-type style exactly:

   ```ts
   // v1.5 Phase 36 (2026-07-09 decision): "Trust sender" — records the sender as
   // trusted for this employee only and moves the message out of Spam into Inbox.
   trustSender: (id: string) =>
     request<{ ok: boolean; id: string; sender: string; movedToInbox: boolean }>(
       `/api/inbox/messages/${encodeURIComponent(id)}/trust-sender`,
       { method: "POST" },
     ),
   ```
  </action>
  <verify>`cd apps/parrot && npm run typecheck` passes.</verify>
  <done>`api.trustSender` and `FolderCounts.spam` compile and are exported from `~/lib/api`.</done>
</task>

<task type="auto">
  <name>Task 2: Spam sidebar nav item + folder allowlist</name>
  <files>apps/parrot/app/routes/inbox.tsx</files>
  <action>
1. Add `"spam"` to the `FOLDERS` Set (~line 18-25) so `normalizeFolder()` accepts
   `?folder=spam` instead of falling back to `"inbox"`.

2. Before adding the icon import, run a quick check on which alert-style icon names this
   exact pinned `lucide-react` version exports (the repo pins an unusually low
   `lucide-react@^1.16.0`):
   ```
   grep -rn "from \"lucide-react\"" apps/parrot/app | grep -iE "alert|shield|ban"
   ```
   Prefer `ShieldAlert` if it resolves cleanly at typecheck time; fall back to `AlertTriangle`
   or `Ban` (whichever the grep shows is already used/available elsewhere in this codebase's
   `lucide-react` imports) if `ShieldAlert` doesn't exist in this pinned version. Add the
   chosen icon to the existing `lucide-react` import block (~line 3-11).

3. Add a new `SecondaryNavItem` in `EmailSecondaryNav` (~line 42-89), placed after the Trash
   item and before Starred (spam and trash are both "recoverable holding areas", grouping them
   together reads naturally):

   ```tsx
   <SecondaryNavItem
     href="/inbox?folder=spam"
     active={activeFolder === "spam"}
     label="Spam"
     icon={<ShieldAlert size={15} />}
     count={counts?.spam}
   />
   ```
  </action>
  <verify>
`cd apps/parrot && npm run typecheck` passes.
`cd apps/parrot && npm run build` succeeds.
  </verify>
  <done>
Navigating to `/inbox?folder=spam` renders `InboxPane` with `folder="spam"`; the Spam nav
item shows a numeric badge sourced from `folder-counts.spam` and highlights as active.
  </done>
</task>

<task type="auto">
  <name>Task 3: EmailPanel "Trust sender" action + InboxPane title/toast wiring</name>
  <files>apps/parrot/app/components/EmailPanel.tsx, apps/parrot/app/components/InboxPane.tsx</files>
  <action>
**EmailPanel.tsx:**
1. Widen the `onActioned` prop type (~line 65-67) to include `"trusted"`:
   `(action: "archived" | "unarchived" | "deleted" | "moved-to-trash" | "trusted") => void`.
2. Add a `handleTrustSender()` function mirroring `handleArchive()`'s shape (~line 136-144):
   ```ts
   async function handleTrustSender() {
     await api.trustSender(emailId);
     onActioned?.("trusted");
   }
   ```
3. In the action toolbar (~line 237-297), render a "Trust sender" button ONLY when
   `folder === "spam"` (same conditional-render pattern as the Archive/Unarchive icon swap),
   using a distinct icon (e.g. `ShieldCheck` from `lucide-react` — verify it resolves at
   typecheck against the pinned version same as Task 2) so it's visually distinguishable from
   the existing Reply/Forward/Archive/Delete icons:
   ```tsx
   {folder === "spam" && (
     <button
       type="button"
       onClick={handleTrustSender}
       title="Trust sender"
       aria-label="Trust sender"
       className="inline-flex items-center justify-center rounded-md border border-emerald-200 bg-white p-2 text-emerald-700 hover:bg-emerald-50"
     >
       <ShieldCheck size={15} />
     </button>
   )}
   ```

**InboxPane.tsx:**
4. Add a `case "spam": return "Spam";` branch to `folderTitle()` (~line 43-58).
5. Extend `handleActioned()` (~line 156-187) with a `"trusted"` branch. Clear selection and
   invalidate `["parrot", "inbox"]` queries the same way the other branches do, then show a
   toast with NO undo function (trusting a sender is not meant to be reversible from this
   toast — same no-undo pattern already used for the hard-deleted case):
   ```ts
   } else if (action === "trusted") {
     showToast("Sender trusted — moved to Inbox");
   } else {
     // hard-deleted: no undo possible
     showToast("Deleted permanently");
   }
   ```
   (Widen the `handleActioned` parameter type to match EmailPanel's widened `onActioned` type.)
  </action>
  <verify>
`cd apps/parrot && npm run typecheck` passes.
`cd apps/parrot && npm test` passes (no existing test regresses; neither file has dedicated
component tests today, so this is typecheck + the chrome_visual_check below).
  </verify>
  <done>
Clicking "Trust sender" on a Spam-folder message calls `api.trustSender`, the inbox list
query invalidates, the confirmation toast appears with no Undo action, and the button is
absent when `folder !== "spam"`.
  </done>
</task>

</tasks>

<verification>
Run in `apps/parrot/`:
```
npm run typecheck
npm test
npm run build
```

**Visual verification (chrome_visual_check):** there is no live seeded Spam mail available
locally (a real Lakera hard-block requires either a live API call or manually inserting a
DO row — out of scope for this plan; do not fabricate seed scripts beyond a quick manual
DB insert if one is convenient). Verify what IS verifiable without seed data:
1. Run `npm run dev`, sign in via the existing dev-bypass / Clerk flow.
2. Navigate to `/inbox` — confirm the "Spam" sidebar item renders with a `0` (or whatever
   real) badge, no console errors, no layout regression to the other folder items.
3. Click into `/inbox?folder=spam` — confirm the empty-state renders cleanly (no crash), the
   page title/active-state highlight correctly say "Spam".
4. If a spam-folder row CAN be produced cheaply (e.g. by hand-inserting a test row into the
   local dev DO's `emails` table with `folder_id='spam'`), additionally confirm: the message
   opens via `EmailIframe` (sandboxed, no raw HTML in the DOM), and the "Trust sender" button
   is visible and clickable, moving the message to Inbox with a toast.
5. Full end-to-end confirmation against a REAL Lakera hard-block is deferred to operator UAT
   post-deploy (same pattern as Phase 23's attachment-download "tested in Chrome + Safari,
   deferred to operator" note) — do not block this plan's completion on producing one.
</verification>

<success_criteria>
1. `/inbox?folder=spam` is reachable and renders without error, empty or populated.
2. The Spam sidebar item shows a live count from `GET /api/inbox/folder-counts`.
3. "Trust sender" appears only in the Spam folder's EmailPanel toolbar and, on click, moves
   the message to Inbox and shows a toast.
4. `npm run typecheck`, `npm test`, and `npm run build` all pass in `apps/parrot/`.
</success_criteria>

<output>
After completion, create `.planning/milestones/v1.5/phases/36-lakera-failopen-quarantine/36-02-spam-ui-trust-sender-SUMMARY.md`
</output>
