# Phase 33-05 — Live inbound-email sorter verification (EVIDENCE)

**Verified:** 2026-07-15 (live production). Sorter Worker `internjobs-email-ingest` (zone-wide CF Email Routing catch-all), startup Worker `internjobs-startup-mcp`, Fly proxy `internjobs-startup-api`.

**Setup:** provisioned startup "Phase33 Test Co" (`phase33-test-co@employers.internjobs.ai`); operator fallback set to `nithin@growthpods.io` (verified CF destination) via `OPERATOR_FALLBACK_EMAIL` (33-08). Baseline `inbound_messages` = 184.

## Three live emails (sent from a personal gmail) — all `- Ok` in the sorter log (email() never threw → nothing silently dropped)

| # | To | Sorter branch (from live `wrangler tail`) | Result |
|---|----|-------------------------------------------|--------|
| 1 | `phase33-test-co@employers.internjobs.ai` | employers handoff → startup Worker (2xx, no warning) | ✅ row in `inbound_messages`: `channel_type=email`, `direction=inbound`, startup "Phase33 Test Co", body `"hi, interested in the role — test 1"` |
| 2 | `nobody-xyz-999@employers.internjobs.ai` (unknown slug) | `employers_handoff_non_2xx status:404` → operator forward | ✅ **arrived complete + intact** in `nithin@growthpods.io` inbox — the critical fail-safe (`message.raw` drained before `forward()`; only the real CF runtime can prove the forward still works) |
| 3 | `conv-11111111-…@agent.internjobs.ai` | conv-alias branch → Fly `/webhooks/email` (no employers-handoff, no failure) | ✅ regression: pre-existing conv-alias ingestion unbroken by the Phase-33 redeploys |

## Conclusions
- Per-startup agent email (`<slug>@employers.internjobs.ai`) delivers inbound candidate mail into `inbound_messages` end-to-end.
- The single-zone-catch-all constraint is correctly handled: employers mail is dispatched to the startup pipeline; unknown slugs fail safe to a human; agent conv-aliases still ingest — no branch regressed.
- The "never silently dropped" guarantee is proven on the real runtime, not just in unit mocks.

**Note (operator address):** `OPERATOR_FALLBACK_EMAIL` now routes zone-wide operator/misc fallback mail to `nithin@growthpods.io` instead of `rentalaraj@gmail.com`. Reversible by unsetting the var. Raj to confirm the intended long-term operator.

## Status
33-05 **COMPLETE**. All Phase 33 plans (33-01…33-07) done + verified live.
