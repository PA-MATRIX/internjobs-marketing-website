# Roadmap: InternJobs.ai

**Status:** 📋 Between milestones — v1.1 shipped, v1.2 not yet planned

## Completed Milestones

- ✅ **v1.0 Waitlist Identity and Messaging Foundation** — Phases 1-6 (shipped 2026-05-09)
  - Archive: `.planning/milestones/v1.0-waitlist-app/`
- ✅ **v1.1 Seamless Waitlist and Student Threading** — Phase 7 (shipped 2026-05-15)
  - Archive: `.planning/milestones/v1.1-seamless-waitlist/`

## Next Milestone

**v1.2 — Two-Sided Agent MVP**

Stand up a Mastra-powered agent that drafts both sides of the student↔startup conversation, with startups onboarded as a first-class user type and email as their primary channel — every outbound message human-approved. See `.planning/PROJECT.md` (`### Active`) for v1.2 requirement set.

Rough phase shape (will be refined by `/rrr:create-roadmap`):

1. Telnyx student-SMS integration (parallel with Spectrum, soft cutover)
2. Startup auth + onboarding + roles data model
3. Cloudflare Email Routing inbound pipeline for startups
4. Mastra agent core — workflows, thread memory, pgvector memory
5. Approval/safety gate UI (operator dashboard for draft review)
6. Two-sided integration + smoke test

## Phases

*No active phases. Run `/rrr:define-requirements` to scope v1.2, then `/rrr:create-roadmap` to break it into phases.*

---

**Next Steps:**

1. Resolve carry-over from v1.1: Cloudflare DNS proxy on `accounts.internjobs.ai` + `clerk.internjobs.ai` should be DNS-only; run live LinkedIn → Clerk → app sign-in smoke test against prod.
2. `/rrr:define-requirements` — formalize the v1.2 requirement set already drafted in `PROJECT.md` `### Active`.
3. `/rrr:create-roadmap` — break v1.2 into phases (~6 phases per scoping).
4. `/rrr:plan-phase` — plan and execute phase-by-phase.
