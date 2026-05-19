# Roadmap: InternJobs.ai

**Status:** 📋 Between Milestones

## Completed Milestones

- ✅ **v1.0 Waitlist Identity and Messaging Foundation** — Phases 01–06 (shipped 2026-05-09)
  - Archive: `.planning/milestones/v1.0-waitlist-app/`
- ✅ **v1.1 Seamless Waitlist and Student Threading** — Phase 01 (shipped 2026-05-15)
  - Archive: `.planning/milestones/v1.1-seamless-waitlist/`
- ✅ **v1.2 Two-Sided Agent MVP** — Phases 01–17 (shipped 2026-05-19)
  - Archive: `.planning/milestones/v1.2-two-sided-agent-mvp/`
  - 178 commits, +71,340 net LOC, 16/17 phases fully shipped, 1 phase (14) code-shipped runtime-blocked on infra bridge

## Next Milestone

*Not yet defined. Run `/rrr:discuss-milestone` to start planning.*

## Phases

*No active phases. Create a new milestone first.*

---

## v1.3 Candidates (deferred from v1.2)

Carry-over backlog from `.planning/milestones/v1.2-two-sided-agent-mvp/MILESTONE-AUDIT.md`:

- **Phase 14 Runtime Activation** — Fly REST proxy in front of FalkorDB (`internjobs-graph-api`) OR Workers-native RESP3 client via cloudflare:sockets. Makes Phase 14's shipped graph helper actually function in production.
- **SAFETY-01** — Lakera Guard pre-LLM screening (needs Lakera signup)
- **TELNYX-ADAPT-01 / TELNYX-MIGRATE-01 / SUNSET-01** — Telnyx SMS adapter migration (A2P 10DLC registration takes weeks)
- **STORAGE-02** — Email + MMS attachment ingest
- **STORAGE-03** — Permanent short links via mapping bucket + redirector Worker
- **EMAIL-04** — Per-startup vanity addresses (`acme@internjobs.ai`)
- **DAILY-VANITY-01** — Custom Daily.co subdomain `meet.internjobs.ai`
- **COGNEE-ACTIVATE-01** — Activate Cognee placeholders (needs legal approval)
- **ENRICH-ACTIVATE-01** — Activate Sprite.dev + Bright Data placeholders (needs legal approval)
- **VOICE-01** — Voice channel (gated on >10% inbound asks)
- **SLACK-01** — Slack integration for startups (gated on first 5–10 startups)
- **STARTUP-SMS-01** — Second SMS number for startup-side messaging
- **FEEDBACK-LOOP-01** — Automated draft feedback loop
- **THREAD-SUMMARY-01** — Background summarizer for long Mastra threads
- **CONSENT-INFER-01** — `agent_inference_consent` on the consents table
- **MULTI-MEMBER-01** — Multi-member startup invites
- **PARROT-AUTO-CLEAR** — Phase 14-dependent todo auto-resolution via Graphiti `valid_to` close-out
- **3× SEC-ROTATE** — Clerk + CF Email + CF AI + broad CF API tokens

---

**Next Steps:**
1. `/rrr:discuss-milestone` — thinking partner, figure out what to build
2. `/rrr:new-milestone` — update PROJECT.md with goals
3. `/rrr:define-requirements` — scope the work
4. `/rrr:create-roadmap` — plan how to build it
