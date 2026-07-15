---
phase: 32-parrot-embed-pane
plan: "03"
subsystem: workspace-frontend
tags: [parrot, embed, nav-badge, custom-event, dial, postmessage, react-router, ssr-safe]

# Dependency graph
requires:
  - phase: 32-02
    provides: ParrotEmbedPane (root-mounted iframe), parseParrotBadge, PARROT_BADGE_CHANGE_EVENT / PARROT_DIAL_REQUEST_EVENT window-event contract, the (previously inert) parrot-dial-request listener
  - phase: 31/chat-pane
    provides: chat-unread-change CustomEvent + rose-pill nav-badge pattern in WorkspaceShell (mirrored, not imported)
provides:
  - Combined Phone/SMS nav badge in WorkspaceShell — renders the ONE parrot:badge count set per-icon (calls on Phone, messages on SMS), clearing on 0/0
  - requestParrotDial(number) — SSR-safe dispatcher for the parrot-dial-request CustomEvent, the tested other half of the Workspace→Parrot dial contract
affects:
  - "A FUTURE plan that introduces a phone-number-bearing UI surface (e.g. a contact card with a Dial affordance) can call requestParrotDial(number) directly — no changes to ParrotEmbedPane needed; the full path (dispatch → forward → parrot:dial postMessage → navigate /phone) is already wired and tested"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Combined badge system rendered per-icon: one parrotBadge {calls, messages} state drives two independent nav badges (Phone=calls, SMS=messages), computed via a single badgeCount/badgeTitle switch that reuses the exact chat-unread rose-pill markup"
    - "Injectable dispatchEvent seam: requestParrotDial(number, target=window) keeps the REAL CustomEvent dispatch path unit-testable under the node-only Vitest env (no window / no jsdom) while staying SSR-safe (default target resolves to undefined off-DOM)"

key-files:
  created:
    - .planning/milestones/v1.5/phases/32-parrot-embed-pane/32-03-SUMMARY.md
  modified:
    - apps/parrot/app/components/WorkspaceShell.tsx
    - apps/parrot/app/lib/parrot-embed.ts
    - apps/parrot/workers/tests/lib/parrot-embed.test.ts

key-decisions:
  - "Combined-badge interpretation: the nav has SEPARATE Phone and SMS icons (not a single unified Parrot icon), so the contract's 'ONE combined nav badge' is rendered as one badge SYSTEM with per-icon counts — calls on Phone, messages on SMS. This is the least-ambiguous mapping to the two-icon reality and matches the existing per-icon chat badge."
  - "Reused (did not redefine) 32-02's contract: parrot-badge-change (PARROT_BADGE_CHANGE_EVENT) and parrot-dial-request (PARROT_DIAL_REQUEST_EVENT). WorkspaceShell listens for the former; requestParrotDial dispatches the latter into ParrotEmbedPane's already-built listener."
  - "requestParrotDial takes an injectable dispatchEvent target (default window) instead of hard-coding window.dispatchEvent — this is the plan-sanctioned test seam that lets the real CustomEvent path be asserted in the node-only Vitest file without adding jsdom, and makes the SSR no-op explicit."
  - "SCOPE BOUNDARY (deliberate, not a gap): no in-app caller of requestParrotDial exists, because Workspace has no UI surface that displays another person's raw phone number to attach a Dial button to (Chat is keyed on Mattermost users by email, no phone field synced; the Admin directory shows capability flags, not numbers). Adding such a surface is its own data-plumbing plan, out of scope for a thin-embed phase. This plan ships the generic, fully-tested dispatch contract — ready for the first real caller — rather than a placeholder button that dials nothing real."

patterns-established:
  - "Per-icon combined badge: single count-source state → badgeCount/showBadge/badgeTitle switch → one reused rose-pill markup, so adding a third badged icon later is a one-line switch extension"
  - "Node-Vitest-testable browser dispatcher via an injectable EventTarget seam + a real `new EventTarget()` round-trip test (Node 24 provides CustomEvent/EventTarget globally) — proves the actual event name + detail payload without a browser"

duration: ~1h
completed: 2026-07-16
---

# Phase 32 Plan 03: Combined Nav Badge + Outbound Dial Dispatcher Summary

Closes the two halves of the Parrot embed postMessage contract that live OUTSIDE the pane itself (`WORKSPACE-HANDOFF.md` §4): the Parrot→Workspace nav badge and the Workspace→Parrot dial-request dispatcher. Both reuse 32-02's already-established CustomEvent contract rather than redefining it.

## What Shipped

**Task 1 — Combined Phone/SMS nav badge (`WorkspaceShell.tsx`).** New `parrotBadge {calls, messages}` state fed by a `window` listener for the `parrot-badge-change` CustomEvent that `ParrotEmbedPane` (32-02) already dispatches from `parrot:badge` postMessages — the exact mirror of the existing `chat-unread-change` badge. The nav has separate Phone and SMS icons, so the one combined badge system renders per-icon: the call count on Phone, the message count on SMS. Both are gated on `!active` (hidden while viewing that pane) and clear when Parrot reports `0/0`. A single `badgeCount`/`showBadge`/`badgeTitle` switch reuses the exact rose-pill markup, `9+` cap, and accessible `title` tooltip (`"Phone (2 missed)"` / `"SMS (3 unread)"`) already used by the chat badge — no visual/markup divergence.

**Task 2 — `requestParrotDial(number)` dispatcher + tests (`parrot-embed.ts`, `parrot-embed.test.ts`).** A generic, SSR-safe function that dispatches the `parrot-dial-request` CustomEvent (`detail.number`) which `ParrotEmbedPane`'s existing (32-02) listener forwards to Parrot as a `parrot:dial` postMessage (pre-fill only, per contract §2.3). It takes an injectable `dispatchEvent` target (default `window`) so its real CustomEvent construction is exercised under the repo's node-only Vitest env without adding jsdom. Four new tests cover: correct event name + `detail.number`, verbatim number pass-through, SSR no-op (never throws with no window), and a real `EventTarget` round-trip.

## Verification

- `npx vitest run parrot-embed` — 28 tests pass (24 existing + 4 new dial tests).
- `npx vitest run` (full suite) — **121 tests pass across 20 files, zero regressions.**
- `npm run typecheck` (`wrangler types` + `react-router typegen` + `tsc -b`) — **exit 0, zero TS errors.**
- `npm run build` (react-router / vite client + SSR) — **exit 0, built cleanly.**

## Not Run In This Sandbox (deferred verification)

The plan lists `playwright` and `chrome_visual_check` steps for the badge dispatch/clear flow and an icon-rail screenshot. **Neither could run here:** the repo has no Playwright harness (no `playwright.config.*`, no `e2e/` dir, no playwright dep) and this sandbox has no browser. The badge render logic is a direct structural clone of the already-shipped, visually-verified chat badge (same markup, same `!active` gating, same rose pill), and the dispatcher's full event path is proven by the `EventTarget` round-trip unit test. Recommend a coordinator/operator visual pass: dispatch `new CustomEvent("parrot-badge-change", {detail:{calls:2, messages:0}})` on `/inbox`, confirm the Phone icon shows "2" and SMS shows none, then `{calls:0, messages:0}` clears both.

## Deviations from Plan

**Followed the plan's explicit "don't invent a Dial button" scope boundary.** Per the plan's SCOPE NOTE and Task 2's `<done>`, no in-app caller of `requestParrotDial` was created. Workspace currently has no UI surface displaying another person's raw phone number (Chat is keyed on Mattermost users by email with no phone field; the Admin directory shows capability flags, not numbers), so there is nothing to wire a real Dial button onto. Building such a surface is its own data-plumbing plan, out of scope for a thin-embed phase. This plan therefore ships the generic, fully-tested dispatch contract — ready for the first real caller — instead of a placeholder button that dials nothing. This is the intended boundary, not a missed requirement.

**Combined-badge interpretation documented (per Task 1 instruction).** "Render the ONE combined nav badge" was interpreted as one badge *system* rendered per-icon (calls→Phone, messages→SMS), because the nav exposes two separate icons rather than a single unified Parrot icon — the least-ambiguous mapping and consistent with the existing per-icon chat badge.

No auto-fixes (Rules 1–3) were required; the prior waves' contract was clean and directly consumable.

## Files-Modified Audit

`git diff --cached` for the code commits contained exactly the three files declared in the plan frontmatter (`WorkspaceShell.tsx`, `parrot-embed.ts`, `parrot-embed.test.ts`) — no drift. (`worker-configuration.d.ts` is regenerated by `wrangler types` during typecheck but is gitignored and was not committed.)

## For the Next Plan / Coordinator

- The Workspace→Parrot dial path is complete and callable: any future phone-number-bearing surface calls `requestParrotDial(number)` from `~/lib/parrot-embed` — no ParrotEmbedPane changes needed.
- Phase 32 (embed pane) is now functionally complete across waves 1–3: mint endpoint (32-01), persistent pane + postMessage bridge (32-02), nav badge + dial dispatcher (32-03).
