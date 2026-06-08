# Phase 25: SSO Activation + Admin UX — DRAFT PR

Branch: `rrr/v1.4/team-workspace-25` (per-phase off `main`)
Team: `team-workspace`
Milestone: v1.4 Pilot Readiness

---

## Summary

Phase 25 of v1.4 (Pilot Readiness). Activates the Mattermost OIDC SSO bridge
(code shipped in v1.2; this is the mmctl config step), brand-refits the
existing v1.2 admin UX with v1.4 brand tokens, and drops the orphan
`@neondatabase/serverless` dependency from `apps/parrot/package.json`.

**Goal:** Workspace SSO is single-sign-on for employees (no separate
Mattermost password); Ridhi can manage employee capabilities through the
brand-correct `/admin` frontend; the orphan Neon dep is removed.

**Code paths:** `apps/parrot/` (the Workspace Worker; verbal/written
reference is "Workspace"). The `parrot` directory predates a now-deleted
Neon project of the same name — see `MEMORY.md` `project-app-naming`.

## Plans

| # | Plan | Wave | Autonomous | Requirements | Status |
|---|------|------|------------|--------------|--------|
| 25-01 | mmctl SSO runbook + activation script | 1 | no (deferred) | MMSSO-01, MMSSO-03 | Code complete; live activation needs operator window |
| 25-02 | Brand-refit `/admin` + `/admin/invite` with v1.4 tokens | 1 | yes | ADMIN-UX-01..04 | Ready to execute |
| 25-03 | Drop `@neondatabase/serverless` from package.json | 1 | yes | NEONEX-DEP-01 | Ready to execute |

All 3 plans Wave 1 — fully parallel (no file overlap).

## Success criteria (from ROADMAP.md)

1. User signing into `chat.internjobs.ai` clicks "GitLab" button →
   bounces through Workspace OIDC → lands signed in to Mattermost in <5s
2. New employee (invited via admin UX) auto-provisions a Mattermost user
   on first OIDC sign-in
3. Ridhi can open `/admin`, see employees with capability toggles
   (email/chat/meetings/phone/sms/campaigns), and edit them post-invite
4. Invite form creates Clerk phone-OTP user + CF Email Routing rule +
   WorkspaceDO row + sends personalized welcome email from Ridhi
5. `@neondatabase/serverless` removed from `apps/parrot/package.json`;
   `npm run build` still passes

## Dependencies + heads-up

- **Phase 23 code does NOT need to be merged first** — Phase 25's code
  scope (mmctl config, admin UI brand refit, dep cleanup) is orthogonal
  to Phase 23 (closeTodoFact, Lakera, attachments, UAT). Per-phase
  branches off `main`; coordinator handles merge order independently.
- **Admin UX is already built** (v1.2 Phase 16): `admin.tsx` +
  `admin.invite.tsx` + `admin-employees.ts` are all fully functional.
  Phase 25 scope is a BRAND REFIT (CSS tokens, no logic changes) — not
  a build from scratch. Plus one pre-existing React Fragment key bug
  fix in `employees.map()`.
- **MMSSO-03 is native Mattermost behavior** — when `/oidc/userinfo`
  returns the correct claims (`sub`, `email`, `email_verified`, `name`,
  `given_name`, `family_name`, `preferred_username`, `username`,
  `login`, `id`), Mattermost auto-provisions users. Verified the
  endpoint already returns all 10 claims (oidc.ts:524-537). Zero code
  change required — runbook documents this so it isn't accidentally
  "fixed."
- **MMSSO-02 is operator-deferred** — live SSO test requires `mmctl`
  authenticated against the `chat.internjobs.ai` admin account + Fly
  machine restart. Plan 25-01 ships the runbook + one-liner; live
  execution waits for an operator window. `deferred_to_operator: true`
  flag is set in plan frontmatter so the verifier classifies the
  outcome as `deferred_to_operator` (not `gap_found`).
- **Brand tokens** — Plan 25-02 uses `var(--lavender)`,
  `var(--ink)`, `var(--cobalt)`, `var(--cream)` per
  `.planning/brand/BRAND-V1.md`. BRAND-V1.md Hard Rule #1 forbids
  `bg-white` surfaces; cream is the only escape from lavender. The
  Workspace app's `apps/parrot/app/index.css` will gain the brand
  CSS variables (currently only `apps/marketing/src/styles.css` has
  them) so the admin UI can render correctly without depending on
  marketing's CSS.
- **Naming reminder:** code says `parrot`, narrative says `Workspace`.

## Test plan

- [ ] `cd apps/parrot && npm run build` — Workspace Worker + frontend
      build passes after brand refit + dep removal
- [ ] `cd apps/parrot && grep -r "@neondatabase" workers/` returns zero
      results (already-verified pre-execution; re-verify post-25-03)
- [ ] 25-02: brand grep audit — `cd apps/parrot/app && grep -rE
      "bg-white|text-slate-|bg-emerald-|text-emerald-" routes/admin*`
      returns zero hits
- [ ] 25-02: visual verify in Chrome: `/admin` renders with lavender
      background, ink text, cream data-table card, cobalt CTA buttons,
      lime active-state capability pills; `/admin/invite` mirrors the
      same brand surface
- [ ] 25-02: React DevTools / browser console — no
      "Each child in a list should have a unique key" warning on
      `/admin` (Fragment key fix verified)
- [ ] 25-01: runbook + mmctl script exist at `apps/parrot/test/`;
      mmctl one-liner is operator-runnable as-is
- [ ] 25-01: operator window (deferred) — run mmctl one-liner, restart
      Mattermost Fly machine, click "GitLab" on chat.internjobs.ai,
      confirm SSO bounce + auto-provision <5s
- [ ] `rrr-verifier` agent VERIFICATION.md status: `passed` (or
      `human_needed` with explicit MMSSO-02 deferral)

## RRR workflow

```bash
# 1. Plan-phase already ran (this branch). Plans live in
#    .planning/milestones/v1.4-pilot-readiness/phases/25-sso-activation-admin-ux/

# 2. Execute all 3 plans (Wave 1 parallel)
/rrr:execute-phase 25 --team team-workspace

# 3. When complete, submit for coordinator integration review
/rrr:submit-phase 25 --team team-workspace
```

The `--team team-workspace` flag is **required** — without it, RRR
mutates the root `.planning/STATE.md` which is coordinator-owned in
team mode. With it, RRR writes to
`.planning/workstreams/team-workspace/STATE.md` and your work doesn't
collide with team-cms's work on `main`.

## Phase 23 + 22 + ongoing context

Read before executing if you haven't:

- `.planning/STATE.md` — current coordinator state (READ ONLY in team mode)
- `.planning/ROADMAP.md` — Phase 25 entry (line ~131) for full spec
- `.planning/REQUIREMENTS.md` — req IDs MMSSO-01..03, ADMIN-UX-01..04,
  NEONEX-DEP-01
- `.planning/brand/BRAND-V1.md` — brand spec (Hard Rules + token CSS)
- `apps/parrot/workers/routes/oidc.ts` — v1.2 OIDC bridge code already
  shipped; Phase 25 activates it via mmctl config

## Coordinator (Raj) handles

- Final merge to `main` after `/rrr:submit-phase`
- ROADMAP.md + REQUIREMENTS.md status updates
- Cross-team dependency tracking
- Phase 25 → 26 → 27 sequential team-workspace ordering

🤖 Generated with [Claude Code](https://claude.com/claude-code)
