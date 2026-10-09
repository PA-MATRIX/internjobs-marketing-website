---
phase: v1.5/33-startups-web-app-golive
verified: 2026-10-08
commit: 1ecddd9 (origin/integration/v1.5, detached checkout)
status: human_needed
score: 6/7 must-haves verified (1 partial, needs human/online confirmation)
---

# v1.5 Phase 33 verification (read-only)

## Architectural context loaded
No `.planning/NORTH-STAR.md` in the v1.5 checkout. The only locked decision that touches this phase is commit `67f69e0` (2026-05-27, "Option A"), which uses Clerk Restrictions/blocklist instead of a `user.created` webhook. It is quoted in the 33-03 plan and SUMMARY.

## Goal (ROADMAP v1.5 Phase 33)
Execute PHASE-28.5-DEFERRED-OPS: DNS, Email Routing verification, STARTUPS_CLERK_* in Infisical, Clerk webhook. Bring the Startups web app live (`employers.internjobs.ai` per PR #24) plus per-startup agent email.
The ROADMAP text still says `startups.internjobs.ai`, so the rename is not reflected there.

## Must-haves
| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Web app live at employers.internjobs.ai (DNS + serving) | VERIFIED | `dig +short employers.internjobs.ai` returns 104.21.46.13 and 172.67.222.61 (Cloudflare). HTTPS HEAD returns `HTTP/2 200` text/html (2026-10-08). `startups.internjobs.ai` has no DNS record and no MX, which is consistent with the rename. Code is in `apps/employers` (Pages function `functions/api/[[path]].ts`, `e2e/founder-flow.spec.ts`). |
| 2 | Per-startup agent email `<slug>@employers.internjobs.ai` delivers into the pipeline, and unknown slugs fail safe | VERIFIED (code + tests offline; live per evidence) | Code: `apps/startup/workers/routes/email.ts` (`POST /internal/email/inbound`), `apps/email-worker/src/index.js` (employers dispatch branch, operator fallback). Offline reruns: `apps/email-worker` `node --test` gave 23/23 pass. `node scripts/check-email-timeout-invariant.mjs` gave OK (4000+5000+5000=14000 <= 20000). Live: `33-05-EVIDENCE.md` records 3 real emails (slug delivered to `inbound_messages`; unknown slug forwarded intact to the operator; conv-alias regression-free). |
| 3 | Shared EMAIL_HANDOFF_SECRET and STARTUPS_CLERK_* provisioned and bound | PARTIAL (claim-backed only) | 33-04 SUMMARY: EMAIL_HANDOFF_SECRET in Infisical and bound to both Workers, and the 404 smoke proves auth passes. 33-06 SUMMARY: three STARTUPS_CLERK_* bound to the Pages project. The `wrangler.jsonc` public JWKS/issuer vars point at `clerk.employers.internjobs.ai`. Presence in Infisical cannot be checked offline. No secret values were read or printed. |
| 4 | Work-email-only signup (personal domains blocked at Clerk) | PARTIAL | `scripts/33-clerk-restrictions-config.mjs` is present. 33-03 SUMMARY records 3 flags true and 35 identifiers, `--verify-only` FULLY CONFIGURED (live). The 33-05 truth "gmail sign-up rejected at the form" has no live proof in `33-05-EVIDENCE.md`, which covers email tests only. Only the config read-back exists. |
| 5 | Clerk webhook (ROADMAP goal item) | INTENTIONAL DEVIATION (not a gap) | Per `67f69e0`, the webhook was deliberately replaced by Restrictions (33-03) plus guarded lazy-link (33-06). The ROADMAP wording is stale. |
| 6 | Auth boundary is sound: forged/unauthenticated requests get 401, with an account-takeover guard | VERIFIED | 33-06 added `verifyClerkToken` (jose/JWKS) and an empty `PASSTHROUGH_ALLOWLIST`. 33-07-EVIDENCE rows 6 and 7 record forged JWT and no-auth requests returning 401 in prod. Unit suite is 12/12 per the evidence (not rerun: `node_modules` is absent in the checkout, and I installed nothing). |
| 7 | Founder onboarding works end-to-end (signup, dashboard, agent email, single `concierge:%` to `user_` flip, idempotent) | VERIFIED per evidence | 33-07-EVIDENCE rows 1-5 are all pass. Bug A and Bug B were fixed in `d02da80` and re-deployed. DB readbacks are quoted. |

## Missing-SUMMARY finding
`33-05` and `33-07` have no `*-SUMMARY.md`. For `33-07` this is a documentation gap and not a goal gap. For `33-05`, the file `33-05-EVIDENCE.md` is the plan's closing evidence, but it does not meet the plan's contract.
- Both are `autonomous: false` live checkpoint plans, and their EVIDENCE files hold the pass/fail tables and DB/curl proof.
- The 33-05 PLAN names its output `EVIDENCE.md`. The file written is `33-05-EVIDENCE.md`.
- The 33-05 PLAN lists 5 truths, and the evidence covers only 3 of them. Missing: personal-email sign-up rejected (truth 3) and a work-domain sign-up reaching /dashboard (truth 4). Truth 4 is covered indirectly by 33-07 rows 1-2.
- The 33-05 evidence cites "33-08" (`OPERATOR_FALLBACK_EMAIL`). No such plan exists. The env var is present in code (`apps/email-worker/src/index.js:209`), but the change is undocumented as a plan.
- 33-07-EVIDENCE still says "Remaining: 33-05" and is stale against 33-05-EVIDENCE, which says all plans are complete.
- The TDD rule (RED before GREEN in the SUMMARY) cannot be checked for 33-05 and 33-07. Those two plans have no SUMMARY. Among the 5 existing SUMMARYs the standalone word "RED" appears 0 times. 33-02 and 33-04 record mutant/fail-path demonstrations, but there is no explicit RED log. This is a process finding.
- `submissions/33.json` claims `phases_completed: ["33"]` and `ready_for_integration: true`, which is consistent with the evidence. Its `files_touched` includes both EVIDENCE files.
- ROADMAP (checkout) still shows Phase 33 as `[ ]` and with the old hostname. That is a documentation drift to fix at merge.

Verdict on missing SUMMARY: not a goal blocker. It is a documentation and process gap, and recommend backfilling a `33-05-SUMMARY.md` and `33-07-SUMMARY.md` (or accepting EVIDENCE as the record).

## Not verifiable offline
- Infisical presence of the secrets, and the Pages/Worker secret bindings.
- Live Clerk restriction state (needs the secret key). No live gmail sign-up rejection proof exists.
- That the CF Email Routing catch-all still targets `internjobs-email-ingest`. Evidence is dated 2026-07-15 and not re-sent today.
- The Fly-proxy `agent_email` stats fix (Bug B) live state.
- `apps/employers` `npm test` (12/12 claimed): not run, as the checkout has no `node_modules`.
- Whether `OPERATOR_FALLBACK_EMAIL=nithin@growthpods.io` is the intended long-term operator. The evidence itself flags this for Raj.

## Gaps summary (human_needed)
1. No live proof that a personal-email (gmail) sign-up is rejected at the form (config read-back only).
2. 33-05/33-07 SUMMARY files absent, 33-05 evidence is incomplete versus its plan, and the "33-08" reference is dangling.
3. ROADMAP/PROJECT still mention `startups.internjobs.ai` and an unchecked Phase 33.
