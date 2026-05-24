# Lakera Guard pricing — InternJobs.ai pilot

**Verified:** 2026-05-24
**Account:** platform.lakera.ai (Cisco AI Defense post-acquisition)
**Status:** Production key wired into student app (Fly machine
digest `64ee3c881fc8742c`) + Parrot Worker. User has independently
confirmed logs are visible in the Lakera dashboard.

## How this was verified

Direct probe from inside the running Fly app, against the production
`LAKERA_GUARD_API_KEY` already in Infisical
(`/internjobs-ai → LAKERA_GUARD_API_KEY`):

```bash
flyctl ssh console -a internjobs-ai-student-app
node -e "fetch('https://api.lakera.ai/v2/guard', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer ' + process.env.LAKERA_GUARD_API_KEY,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ messages: [{ role: 'user', content: '<test>' }] }),
}).then(r => r.json()).then(console.log)"
```

No fresh dashboard sign-up needed — the key from v1.3 still works.

## Verified v2 endpoint + schema

| Field | Value |
|---|---|
| URL | `https://api.lakera.ai/v2/guard` (unchanged from v1.3 default) |
| Method | `POST` |
| Auth | `Authorization: Bearer <LAKERA_GUARD_API_KEY>` (unchanged) |
| Body | `{ "messages": [{ "role": "user", "content": "<text>" }] }` |
| Response (benign) | `{ "flagged": false, "metadata": { "request_uuid": "..." } }` |
| Response (injection) | `{ "flagged": true,  "metadata": { "request_uuid": "..." } }` |

That is the **entire** response. No `results[]`, no `categories`, no
per-category numeric scores. The v1 shape
`{ results: [{ categories: { prompt_injection: <0-1> } }] }` is gone.

## Pilot volume estimate

| Channel | Monthly requests (est.) | Notes |
|---------|------------------------|-------|
| Student SMS (inbound) | ~15,000 | 500 students × 30 msg/student |
| Employee email (inbound) | ~15,000 | 50 employees × 10 emails/day × 30 days |
| **Total** | **~30,000** | Pilot target |

## Tier assessment — TBD (pending dashboard sign-in)

The v2 API does not expose tier or quota in its response, and the API
key alone does not give CLI access to billing data. The current
operational signal is positive — the user confirms logs are visible
in the dashboard and the production key works against live traffic.

**Action item:** Sign in to platform.lakera.ai (or the Cisco AI Defense
dashboard if Lakera redirects there) and capture:

- Tier name (Community / Pro / Cisco AI Defense Enterprise / other)
- Monthly request quota or per-request pricing
- Whether 30k/month fits inside the free tier or triggers paid usage

Then update this section with a `**Decision: <tier> is sufficient /
not sufficient.**` line. Until then this doc captures everything that
can be verified server-side; the user-side dashboard signal is
"present, working, logs visible."

## Critical bug discovered + fixed during verification — silent-fail in hard-block gate

The v2 schema drift (v1 `results[].categories.prompt_injection` numeric
score → v2 binary `flagged`) was silently breaking the production
hard-block gate. The parser would derive `score = 0` on every flagged
response (since the `categories` object no longer exists), and the
caller's `score >= 0.8` hard-block condition therefore never fired.

Net effect in production before today: Lakera correctly classified
injection attempts; we logged them as `flagged`; but they fell through
as soft-flag and reached the agent. The audit log was honest about
flagging but the policy enforcement was dead code.

**Fix (committed in 22-01):**

- `apps/app/src/safety/screen.mjs` + `apps/parrot/workers/lib/safety.ts`:
  parse v2 binary, map `flagged: true → score=1, reason="lakera_flagged"`
  and `flagged: false → score=0, reason=null`. Forward-compat branch
  retained for if Lakera re-introduces per-category numeric scores.
- `apps/app/src/server.mjs` (3 callsites) + `apps/parrot/workers/lib/
  inbound-email.ts`: hard-block gate now triggers on
  `flagged === true || score >= 0.8`. The OR preserves the original
  numeric threshold as a forward-compat shim.
- `apps/app/src/safety/screen.test.mjs`: VERIFY-01/02 assertions
  rewritten for the v2 binary shape; VERIFY-04 documents the
  parser-resilience contract for the legacy v1 shape.

This was a Rule 2 (critical-correctness) deviation from the original
22-01 plan scope, which was schema verification only.

## Known issues

- Tier and quota are not API-visible — see "Tier assessment" above.
- The v1.3 `project_id` body field is documented but not sent — v2
  doesn't require it and the live API accepts requests without it.

## Next review

- Tier confirmation pass once the dashboard sign-in happens.
- Re-verify if Cisco moves the endpoint to `api.defense.cisco.com` or
  similar (today, `api.lakera.ai/v2/guard` still works post-rebrand).
- Revisit at 10k MAU or if pilot volume exceeds the current 30k/month
  estimate.
