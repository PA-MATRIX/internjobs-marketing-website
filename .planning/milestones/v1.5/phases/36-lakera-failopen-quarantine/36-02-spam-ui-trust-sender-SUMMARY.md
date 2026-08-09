---
phase: 36-lakera-failopen-quarantine
plan: "02"
subsystem: email-safety
tags: [lakera, safety, quarantine, spam, trust-sender, react, react-router, tanstack-query, lucide, ui]

# Dependency graph
requires:
  - phase: 36-01
    provides: POST /api/inbox/messages/:id/trust-sender + `spam` in GET /api/inbox/folder-counts + the quarantine writes that put mail in Folders.SPAM in the first place
  - phase: 10 Wave 2b
    provides: the /inbox route, EmailSecondaryNav + SecondaryNavItem, InboxPane/EmailPanel, and the EmailIframe (DOMPurify + sandboxed iframe) body renderer reused unchanged here
provides:
  - Spam sidebar nav item (ShieldAlert icon + live counts?.spam badge), wired identically to the six existing folders
  - "spam" in the inbox route's FOLDERS allowlist — /inbox?folder=spam is now reachable instead of silently falling back to the inbox
  - api.trustSender(id) client helper + FolderCounts.spam field
  - Spam-only "Trust sender" (ShieldCheck) action on the email reader toolbar
  - folderTitle("spam") -> "Spam" and the "trusted" toast branch (scope-accurate copy, no Undo)
affects:
  - 36-03 spam auto-purge cron (the 30-day purge this UI's toast copy promises — "auto-purges at 30 days" is only true once 36-03 wires purgeExpiredSpam())
  - operator UAT (first end-to-end confirmation against a REAL Lakera hard-block is deferred here — see Risks)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Folder-conditional toolbar actions: `folder === \"spam\"` gates the Trust-sender button the same way `folder === \"archive\"` already gates the Archive/Unarchive icon swap. No new conditional-render mechanism."
    - "Spam rendering is safe for free, not by new code: EmailPanel's body renderer is folder-agnostic and already routes HTML through EmailIframe (DOMPurify + sandboxed opaque-origin iframe). Quarantined mail inherits it with zero changes — deliberately no new render path, since a bespoke one for hostile content would be the single most dangerous thing this plan could add."
    - "Toast copy treated as a load-bearing artifact, not a string: the single-message scope of trust-sender is invisible in the UI, so the copy is the ONLY thing telling the user their other Spam did not move. Guarded by a comment in InboxPane + a SCOPE NOTE on api.trustSender."

key-files:
  created: []
  modified:
    - apps/parrot/app/lib/api.ts
    - apps/parrot/app/routes/inbox.tsx
    - apps/parrot/app/components/EmailPanel.tsx
    - apps/parrot/app/components/InboxPane.tsx

key-decisions:
  - "Toast copy: \"Moved to Inbox — future mail from this sender skips Spam. Other Spam from them is unaffected.\" — states what moved (this one message), what changes going forward (screening bypass), and explicitly negates the bulk-recovery implication. Per the locked 2026-07-16 decision that trust-sender recovers ONLY the clicked message, matching Outlook."
  - "No Undo on the trusted toast. Trusting writes a persistent per-employee allowlist row; a 4-second toast should not silently reverse a durable security-relevant grant. Reuses the existing no-undo pattern from the hard-delete branch."
  - "Spam placed between Trash and Starred in the sidebar — both Spam and Trash are recoverable holding areas rather than folders you file mail into."
  - "ShieldAlert (nav) / ShieldCheck (action) confirmed to exist in the pinned lucide-react@^1.16.0 by grepping the shipped .d.ts before importing, per the plan's caution about the unusually low pin. No fallback to AlertTriangle/Ban was needed."
  - "SYSTEM_FOLDER_IDS in shared/folders.ts still excludes `spam` and was left alone (36-01 Risk 7). Verified it has ZERO callers repo-wide — it is dead code, so adding `spam` would change no behavior. Not this plan's scope to delete it."

completed: 2026-07-17
---

# Phase 36 Plan 02: Spam UI + Trust Sender Summary

The Spam folder that 36-01 started writing to is now visible, reachable, and readable in the Workspace sidebar, with an Outlook-style Spam-only "Trust sender" button whose confirmation copy is honest about recovering exactly one message.

## What Shipped

**Task 1 — client helper + counts field** (`a13be3a`)
- `FolderCounts.spam` added, so the sidebar badge has a typed field to read.
- `api.trustSender(id)` → `POST /api/inbox/messages/:id/trust-sender`, returning `{ ok, id, sender, movedToInbox }` — verified against the actual 36-01 handler (`workers/index.ts:502-516`), not just the plan snippet. Shapes match.
- A SCOPE NOTE comment guards the single-message design against a well-meaning future "fix" into a bulk move.

**Task 2 — the folder becomes reachable** (`753c8bb`)
- `"spam"` added to the `FOLDERS` allowlist. This was the actual bug: `normalizeFolder()` silently fell back to `"inbox"`, so `/inbox?folder=spam` was unreachable **even though the backend was already quarantining mail into it**.
- Spam `SecondaryNavItem` with `ShieldAlert` + `count={counts?.spam}`, wired identically to the existing six folders (same `["parrot","inbox","folder-counts"]` query, so it invalidates with every move/send/delete for free).

**Task 3 — Trust sender + toast** (`21a5d24`)
- `EmailPanel`: `handleTrustSender()` mirrors `handleArchive()`'s shape; `isSpamFolder` gates a `ShieldCheck` button so it appears **only** in Spam.
- `InboxPane`: `folderTitle("spam") -> "Spam"`; a `"trusted"` branch clears the selection, invalidates `["parrot","inbox"]`, and toasts with no Undo.
- Both `onActioned` / `handleActioned` union types widened to include `"trusted"`.

## The Toast Copy (quoted verbatim, per the success criteria)

> **"Moved to Inbox — future mail from this sender skips Spam. Other Spam from them is unaffected."**

Checked against the copy requirement:
- **What happened:** "Moved to Inbox" — the one clicked message. ✓
- **What changes going forward:** "future mail from this sender skips Spam". ✓
- **What did NOT happen:** "Other Spam from them is unaffected" — explicitly negates the bulk-recovery implication rather than merely omitting it. ✓

This matters because the scope is otherwise *invisible*: the user clicks a button labelled "Trust sender" (sender-level language) and gets a message-level action. Without that third clause, a user with 5 quarantined emails from one sender would reasonably expect all 5 back, see 1, and go hunting. The copy is the only thing preventing that.

## Verification (actual observed output)

Run in `apps/parrot/`:

| Command | Result |
| --- | --- |
| `npm run typecheck` | exit 0 |
| `npm test` | **106 passed** (19 files), exit 0 |
| `npm run build` | exit 0 |

**Baseline: 106 tests / 19 files, measured on the untouched tree before any edit — unchanged at 106 after.** This plan adds no test files (its four files have no dedicated component tests today, and 36-04 owns safety coverage), so 106 → 106 is the correct no-regression result. This confirms the execution brief's 106 figure and supersedes the stale "122" (36-01 independently measured 77 at its own start; the suite has since grown via 36-01/36-03/36-04).

**A methodology note worth keeping:** my first typecheck used `npm run typecheck | tail -6; echo $?`, which reports **tail's** exit code — always 0. That is a false green that would pass any TS error straight through. All results above were re-run redirecting to a file and capturing the real exit code. Worth avoiding in future plans given this repo's history of typecheck-only catches.

Plan `key_links` assertions, confirmed by grep against the final tree:
- `api\.trustSender\(` → `EmailPanel.tsx:162` ✓
- `counts\?\.spam` → `inbox.tsx:93` ✓
- `folder === "spam"` gate → `EmailPanel.tsx:160` (`isSpamFolder`), used at `:293` ✓
- `git diff --stat` touches exactly the 4 declared `files_modified` — no scope drift ✓
- `EmailIframe.tsx` diff is **empty** — the safe render path is untouched and inherited ✓

## Risks / Notes for Following Plans

1. **The `chrome_visual_check` step could NOT be run — and this is pre-existing, not caused by this plan.** `npm run dev` fails to boot with 5 esbuild `No matching export ... react-router-dom → react-router` errors (a stale hoisted transitive package; `react-router-dom` is imported nowhere in `apps/parrot` and is not a declared dependency of parrot or the root). **Proven pre-existing:** I reverted `apps/parrot/app/` to the pre-plan commit `b476d67` in the real tree and reproduced the identical 5 errors with zero of my changes present, then restored. The production `npm run build` — which is what actually ships — succeeds. Local visual verify was independently already blocked by domain-locked Clerk prod keys. **So the UI in this plan has been verified by typecheck + build + code reading only; no human or browser has seen it render.** The orchestrator's post-deploy boot-check is the first real signal.
2. **Nobody has seen a populated Spam folder.** No seeded spam exists locally (a real hard-block needs a live Lakera call or a hand-inserted DO row), so the empty state, the populated list, the Trust-sender click path, and the toast are all **unexercised at runtime**. Combined with 36-01 Risk 1 (the quarantine branch itself has no test), the full chain hard-block → SPAM → visible row → Trust sender → Inbox is verified end-to-end by **nothing but code reading**. Worth an explicit operator UAT pass, not a glance.
3. **The toast promises a 30-day auto-purge that does not exist yet.** "Other Spam from them is unaffected" is true today; the "auto-purges at 30 days" rationale behind it is only true once **36-03** wires `purgeExpiredSpam()` to the cron. If 36-03 slips, quarantined mail accumulates forever and the UX story ("leave it, it cleans itself up") quietly becomes false. The copy itself doesn't state a number, so no user-visible lie — but the design depends on 36-03 landing.
4. **`counts.spam` is a total, not an unread count.** Consistent with every other folder badge here (they all use `countEmails({folder})`), so this is house style, not a defect — but the Spam badge will show a number even when everything in it has been read, unlike a mail client's usual bold-unread convention.
5. **No confirmation dialog on Trust sender.** One click permanently allowlists a sender for that employee and there is no Undo (deliberate — see key-decisions). A misclick on the wrong message is a durable, silent grant that bypasses Lakera for that sender forever, with no UI anywhere to review or revoke the allowlist. The `trusted_senders` table is currently write-only from the user's perspective. A future plan may want a "Trusted senders" settings list; flagging rather than scope-creeping it here.
6. **`SYSTEM_FOLDER_IDS` still excludes `spam`** (36-01 Risk 7). Checked as instructed: it has **zero callers repo-wide**, so it is inert dead code and adding `spam` would change no behavior. Left untouched.

## Deviations from Plan

None functionally — all three tasks executed as written, including the plan's suggested toast wording (it satisfied the copy requirement as-is, so it was adopted rather than reworded).

Additions beyond the plan's snippets, all documentation-only:
- Expanded the SCOPE NOTE comments on `api.trustSender` and the `"trusted"` toast branch to state *why* the copy is worded as it is, so the next reader doesn't shorten it to "Sender trusted" and silently reintroduce the bulk-recovery implication.
- Brief comments on the `FOLDERS` allowlist entry and the Spam nav item explaining the fallback trap and the Trash-adjacency choice.

No files touched outside the plan's declared `files_modified` (`git diff --stat` confirms exactly 4). No branch changes, no deploy, no root STATE/ROADMAP (team mode). The untracked `.planning/workstreams/team-workspace/PHASES-33-36-HANDOFF.md` was left unstaged throughout. A temporary git worktree created while investigating the dev-server failure was removed and pruned.
