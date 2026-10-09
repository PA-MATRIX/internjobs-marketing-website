# v1.5 Patches

Small work that belongs to v1.5 but ships after the milestone closed. Each patch has one plan in `patches/`, is approval-gated when it touches a live system, and moves PLANNED -> SHIPPED only after its readback is GREEN.

## v1.5.1 - Workspace deploy: restore Phase 36 quarantine

**Status:** PLANNED (2026-10-08)
**Plan:** `patches/v1.5.1-01-PLAN.md`
**Why:** Production `workspace.internjobs.ai` serves Phase 32 (Parrot embed) but not Phase 36 (Lakera Spam folder + "Trust sender"). Worker deploys are a full replace and Phase 32 was deployed from a branch without Phase 36 (see `.planning/workstreams/team-workspace/submissions/32.json`, "DEPLOY CONFLICT"). `main` at d1658aa contains both (PR #28).
**Scope:** build `main` d1658aa and `wrangler deploy` it to Worker `internjobs-parrot`. No route, DNS, secret, binding or Durable Object change beyond what the repo config already declares. Outside v1.6 repo-split scope; no v1.6 files are touched.
**Decision (Raj, 2026-10-08):** "I deploy via an approval-gated task." The executor prepares everything and STOPS for explicit approval immediately before `wrangler deploy`.

### Approval record

_(empty until the checkpoint: executor records approval, exact commit sha, live-config diff + dry-run summary, `--keep-vars` decision, local-build readback GREEN, and rollback version id here BEFORE deploying)_

**Rollback scope (pre-approved with the deploy approval):** one `wrangler rollback <recorded prior version id>`, once, only if the post-deploy boot-check fails (non-200, non-JSON, or 1101/1102). A RED readback after a healthy boot is reported, not rolled back. After any rollback the executor stops and reports.

### Data caveat

Mail Lakera-flagged since the Phase 32 deploy was most likely dropped (pre-Phase-36 behaviour) and is not recoverable. Mail quarantined between 2026-07-17 and the Phase 32 deploy should still be stored and should reappear once the Spam UI is back.

### Outcome

_(filled on completion: deployed version id, readback GREEN, boot-check, UAT status `human_needed` until Raj/Nithin confirm)_
