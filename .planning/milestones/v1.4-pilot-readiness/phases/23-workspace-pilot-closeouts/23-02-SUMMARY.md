---
phase: "23"
plan: "02"
subsystem: "workspace"
tags: ["safety", "lakera", "prompt-injection", "safety-events", "source-id", "email-channel", "deferred-verify"]
requires:
  - "v1.4 Phase 22-01 (Lakera v2 binary-flag parser fix in apps/parrot/workers/lib/safety.ts)"
  - "v1.4 Phase 22-02 (VERIFY-LIVE-01..03 validated parser on student SMS path)"
provides:
  - "source_id field on every email-path safety_events row (RFC-5322 Message-ID or local UUID fallback)"
  - "apps/parrot/test/safety-email-verify.md — deferred-verify evidence record with operator runbook"
affects:
  - "Workspace /ops/safety dashboard — email rows now carry traceable source_id"
  - "Future incident response — can now correlate a flagged email row back to the inbound MIME message-id"
tech-stack:
  added: []
  patterns:
    - "Deferred-verify evidence pattern: code ships in one commit, live-test record opens in a second commit with a pending-operator runbook (mirrors 22-02's LAKERA-VERIFY-LIVE.md structure)"
key-files:
  created:
    - "apps/parrot/test/safety-email-verify.md"
  modified:
    - "apps/parrot/workers/lib/inbound-email.ts"
decisions:
  - "source_id value chosen as `originalMessageId ?? messageId` — RFC-5322 Message-ID preferred so safety_events rows can be cross-referenced against the inbound MIME envelope; falls back to the locally-generated UUID when the inbound email is missing a Message-ID header (rare but possible)."
  - "Live verification deferred (not failed) — operator (nithin@growthpods.io) lacks prod Cloudflare API token access, and the Infisical-stored CLOUDFLARE_BROAD_API_TOKEN is rejected by Cloudflare's /user/tokens/verify endpoint as invalid. Rotation + deploy + 4-email test runbook captured inline in the evidence file for the next operator window. Not a code defect."
  - "Hard-block gate (`flagged === true || score >= 0.8`) NOT changed — Phase 22-01 fixed it and Phase 22-02 validated it live on the student SMS path. 23-02 treats it as a sealed dependency."
metrics:
  duration: "~30 min code-side (audit + edit + tsc + commit) + ~15 min docs (evidence file + summary). Live test deferred."
  completed: "2026-05-26"
---

# Phase 23 Plan 02: SAFETY-VERIFY-LIVE-04 — Workspace Email Injection — Summary

**One-liner:** Adds `source_id` to email-path safety_events rows so every Lakera hard-block is traceable to the inbound MIME message-id; live injection test deferred to an operator window with prod Cloudflare deploy access.

## Status: CODE COMPLETE / LIVE VERIFY DEFERRED

The code change for SAFETY-VERIFY-LIVE-04 is shipped. The live evidence portion is parked on operator credentials, not on a code gap.

## What Shipped

### Commits

| Task | Description | Commit |
|------|-------------|--------|
| 1 | Add `source_id: originalMessageId ?? messageId` to safety_events POST payload in apps/parrot/workers/lib/inbound-email.ts | `c7973ca` |
| 3 | Open apps/parrot/test/safety-email-verify.md as deferred-verify record with operator runbook | `9ec84db` |

### Code change (Task 1)

`apps/parrot/workers/lib/inbound-email.ts:273` now reads:

```typescript
source_id: originalMessageId ?? messageId,
```

inside the `ctx.waitUntil(fetch(STUDENT_API_URL/internal/safety-events))` POST body. `originalMessageId` comes from `parsed.messageId` via `extractMsgId()` at line 179; `messageId` is the locally-generated UUID for the inbound DO write. The fallback chain ensures every blocked email produces a non-null source_id even when the inbound MIME lacks a Message-ID header.

The hard-block gate (`apps/parrot/workers/lib/inbound-email.ts:228`) is unchanged:

```typescript
const isHardBlock = screenResult.flagged === true || injectionScore >= 0.8;
```

This is the 22-01 fix, validated live on the student SMS path in 22-02. 23-02 treats it as a sealed dependency.

## Verification (code-side)

| Step | Result |
|------|--------|
| `grep -n "source_id" apps/parrot/workers/lib/inbound-email.ts` | Line 273 present (payload), line 272 comment |
| `cd apps/parrot && npx tsc --noEmit` | Clean (zero new errors) |
| Hard-block gate untouched | Confirmed at line 228 |
| Auto-reply path silent on hard-block (SAFETY-RESPONSE-02) | Confirmed at line 290 — no `createEmail` on the `isHardBlock` branch |
| Lakera v2 parser unchanged | `apps/parrot/workers/lib/safety.ts` not modified |

## Requirements Closed

- **SAFETY-VERIFY-LIVE-04 (partial — code-side)** — `source_id` now populated on every email-path safety_events row. The live-verification half (4 emails + safety_events SQL check + Sent-folder check) remains open pending operator credential window.

## Deferred Work

The Task 2 live-test checkpoint paused on a credential gap, not a code gap:

1. **`CLOUDFLARE_BROAD_API_TOKEN` rotation.** The token at Infisical path `/internjobs-ai/CLOUDFLARE_BROAD_API_TOKEN` is rejected by Cloudflare's `/user/tokens/verify` endpoint (`code:1000 Invalid API Token`). Scope list for the replacement is captured in the evidence file.
2. **`apps/parrot` wrangler deploy.** Cannot run until #1 lands (or until an operator with prod CF membership runs it from their own machine).
3. **4-email live test** (3 prompt-injection variants from 22-02's test set + 1 benign control from a non-allowlisted external sender to a monitored Workspace inbox).
4. **safety_events SQL verification** (3 rows with action=blocked, channel=email, populated source_id; 0 rows from the benign send; zero auto-replies in Sent folder).
5. **Append results** to `apps/parrot/test/safety-email-verify.md` under a new `## Live verification results` section.

Full step-by-step runbook (commands + scopes + queries) lives at `apps/parrot/test/safety-email-verify.md` "What remains" section so the next operator can resume without re-deriving context.

## Files Modified (drift check)

`git diff --cached --name-only` across both commits matched the plan's `files_modified` frontmatter exactly:

- `apps/parrot/workers/lib/inbound-email.ts` (declared — Task 1)
- `apps/parrot/test/safety-email-verify.md` (declared — Task 3)

No extras. No drift.

## Deviations from Plan

- **Task 2 live-test checkpoint:** Paused as deferred-verify rather than executed. User-confirmed in the checkpoint reply — operator lacks prod Cloudflare API token access and the Infisical-stored token is invalid. Recorded as a deferral, not a failure. All Task 2 runbook content was preserved verbatim into the evidence file so no execution context is lost.
- **No SUMMARY one-liner inflation:** Status field reads "CODE COMPLETE / LIVE VERIFY DEFERRED" not "PASS" — accuracy over closure-rate.

## Next Operator Step

Open `apps/parrot/test/safety-email-verify.md` and start at the "What remains" section: rotate the Infisical token, run `wrangler deploy`, send the 4 test emails, run the SQL check, and append results. The evidence file is structured for in-place append (not rewrite).
