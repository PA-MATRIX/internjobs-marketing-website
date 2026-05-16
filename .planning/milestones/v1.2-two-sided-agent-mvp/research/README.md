# v1.2 Research — Scope Note

**Generated:** 2026-05-15

The FEATURES.md, ARCHITECTURE.md, and PITFALLS.md documents in this folder were produced under an earlier v1.2 scope that included **Telnyx student SMS in parallel with Spectrum**.

**That scope was revised on 2026-05-15.** v1.2 now:

- Keeps Spectrum/Photon as the only active student SMS path.
- Ships an `SmsProvider` interface seam (`SMS-01`) so v1.3+ can drop in a Telnyx adapter without touching call-sites.
- **Does not** provision Telnyx, register A2P 10DLC, or build a soft-cutover state machine.

## How to read the research

- Treat any Telnyx-specific recommendation, schema delta, or pitfall as **v1.3 carry-over notes** unless it's part of the abstraction surface.
- The pieces still in v1.2 scope:
  - **FEATURES.md**: STARTUP-*, ROLE-*, EMAIL-*, AGENT-*, APPROVE-*, INTEG-* requirements; the Mastra/pgvector data-model deltas; the operator approval UX.
  - **ARCHITECTURE.md**: Mastra-in-process topology; `inbound_messages` normalization; Cloudflare Email Routing → Worker → Mastra ingest; single-Clerk-app multi-strategy plan; operator dashboard under `/ops/`; the four v1.1 anti-extension flags in `store.mjs`.
  - **PITFALLS.md**: Mastra maturity / OOM bug / `schemaName` config; pgvector HNSW index advice; Cloudflare Email Routing being inbound-only; the v1.1 carryover items (DNS proxy + `CLERK_SECRET_KEY`); operator queue latency; agent-inferred PII consent surface.
- The pieces now **out of v1.2 scope** (kept for v1.3 reference):
  - Telnyx provisioning, Node SDK, Ed25519 webhook verification.
  - A2P 10DLC campaign registration timeline.
  - Soft cutover state machine + one-time migration SMS.
  - Cross-provider duplicate detection / `provider_event_id` rework.
  - `students.sms_provider` column → not needed in v1.2 since there's only one provider. (Add when Telnyx adapter lands.)

## Decision trail

User direction on 2026-05-15: *"I want to go back to photon codes spectrum. ... we'll go with the photon ... the spectrum. and we can keep Telnyx as in the future, not right now. We can still wire it in, but not at this point."* — confirmed via AskUserQuestion as **provider abstraction only** (no Telnyx stub in v1.2).

The earlier MILESTONE-CONTEXT.md (now consumed) framed Telnyx as the Phase 1 of v1.2. That framing is obsolete; this README supersedes it.

---

A focused STACK.md was not produced — the original stack research call was cancelled when the scope revision came in. Mastra + pgvector + Cloudflare Email Routing + Resend stack picks are already captured concretely inside ARCHITECTURE.md and PITFALLS.md, which is sufficient input for `/rrr:define-requirements`.
