# Phase 33-07 — Live founder-onboarding verification (EVIDENCE)

**Verified:** 2026-07-15 (live production, `employers.internjobs.ai`)
**Test subject:** startup "Phase33 Test Co", founder `nithin@growthpods.io`, agent email `phase33-test-co@employers.internjobs.ai`.

Depends on **33-06** (auth-bypass fix + guarded lazy-link) — landed + verified. The two dashboard-data bugs found during this verification (Bug A, Bug B) were fixed in commit `d02da80` and are included below.

## Success criteria — result

| # | Must-have | Result | Proof |
|---|-----------|--------|-------|
| 1 | Founder signs up (work email, passwordless) and reaches `/dashboard` | ✅ | Signed up via email + 6-digit code (no password, no phone); landed on the "phase33 test co" dashboard |
| 2 | Dashboard shows startup name + role count | ✅ | Header "phase33 test co"; "open roles: 0"; status "ready" |
| 3 | Dashboard shows the **agent email** | ✅ (after **Bug B** fix) | "your agent" card shows `phase33-test-co@employers.internjobs.ai` |
| 4 | `clerk_user_id` flipped `concierge:%` → real `user_…` **exactly once** | ✅ | DB: **1** row on `user_3GV1fqJyjgNfGw504Gft6I1SCGN`, **0** leftover `concierge:%` rows for this email |
| 5 | Second sign-in / reload is idempotent (no re-flip, no re-link) | ✅ | Hard-refresh resolved cleanly; row stayed the single `user_…` id |
| 6 | Takeover guard holds live | ✅ | 33-06 smoke: `POST /v1/startups/link-clerk-id` for an already-linked row → `404 no_linkable_member_found` |
| 7 | Unauthenticated / forged requests → 401 in production | ✅ | forged JWT `/api/me` → 401; no-auth `/api/search/candidates`, `/api/touchbase/due-startups`, `/api/me` → 401; SPA root → 200 |

## Bugs found during live verification (fixed — commit `d02da80`)

**Bug B (agent email display) — persistent, fixed.** `handleGetMe` reads `agent_email` from `GET /v1/startups/:id/stats`, whose SELECT never included the column (migration 0013's `startups.agent_email`), so the card always read "pending". Added `(SELECT agent_email FROM startups WHERE id=$1)` to the stats query. Live proof: stats API now returns `"agent_email":"phase33-test-co@employers.internjobs.ai"`; dashboard renders it.

**Bug A (first-load lazy-link race) — cosmetic/self-healing, fixed.** On the single load where the `concierge:%`→`user_` flip occurs, the dashboard's concurrent `/me`+`/roles`+`/threads` race: one wins the link, the others' `link-clerk-id` 404s (no `concierge:%` row left) and `resolveIdentity` returned the stale 404. Fixed to **re-resolve by the verified `clerk_user_id`** after a lost link — succeeds if a sibling just linked us, still 404s on a genuine no-member case. Takeover guard + fail-closed unchanged. New unit test; auth suite 11→**12/12** green.
- **Live repro limitation (stated honestly):** Bug A's race cannot be re-triggered for this founder because the row is already linked; a fresh repro would need a brand-new signup. Covered by the unit test (`Bug A race: … re-resolve … and succeed`) and by no regression in the live auth-bypass checks after redeploy.

## Deploys
- Fly proxy `internjobs-startup-api` redeployed (Bug B).
- Pages `internjobs-employers` redeployed (Bug A); auth bypasses re-confirmed 401 post-deploy.

## Status
33-07 **COMPLETE**. Remaining for Phase 33: **33-05** (live inbound-email sorter tests).
