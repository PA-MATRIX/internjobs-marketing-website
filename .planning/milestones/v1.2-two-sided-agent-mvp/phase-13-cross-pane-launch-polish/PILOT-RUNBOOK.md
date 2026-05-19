# Parrot Pilot Runbook

This runbook is the canonical checklist for taking the Parrot workspace
(`workspace.internjobs.ai`) from "code-complete on main" to "first pilot
employee onboarded." It is also the rollback / on-call reference for the
launch window.

Last reviewed: 2026-05-19 (Phase 13 Wave 3 ship).

---

## 1. Pre-flight checklist

All items below must be GREEN before inviting the first pilot user.
Treat any RED as a launch blocker.

### 1.1 Secrets (`wrangler secret put` on `internjobs-parrot`)

| Secret | Source | Notes |
| --- | --- | --- |
| `PARROT_CLERK_SECRET_KEY` | Clerk employee app (clerk.workspace.internjobs.ai) → API keys | Phase 10 |
| `CLOUDFLARE_AI_API_TOKEN` | Cloudflare dash → API Tokens (Workers AI scope) | Phase 12 |
| `CLOUDFLARE_ACCOUNT_ID` | `0fffd3dc637bdb26d4963df445a69fd3` | Phase 12 |
| `PARROT_AI_GATEWAY_ID` | Cloudflare dash → AI → AI Gateway → slug | Phase 12 — create gateway `internjobs-parrot` with 200 req/day/user cap |
| `MATTERMOST_BOT_TOKEN` | Mattermost admin → bot accounts → System Admin role | Phase 12 |
| `PUSH_VAPID_PRIVATE_KEY` | `npx web-push generate-vapid-keys --json` → privateKey | Phase 13 Wave 1 — PKCS#8 PEM |
| `SENTRY_DSN` | sentry.io → New Project (Cloudflare Workers) → DSN | Phase 13 Wave 3 — OPTIONAL; Worker falls back to console.error |

### 1.2 `wrangler.jsonc` vars (already committed)

| Var | Value | Source |
| --- | --- | --- |
| `MATTERMOST_URL` | `https://internjobs-mattermost.fly.dev` | Phase 10 |
| `KIMI_MODEL` | `@cf/moonshotai/kimi-k2.6` | Phase 12 |
| `PUSH_VAPID_PUBLIC_KEY` | Paste from `web-push generate-vapid-keys` publicKey | Phase 13 Wave 1 |

### 1.3 KV namespace (Phase 13 Wave 3)

```bash
wrangler kv namespace create PARROT_FEATURE_FLAGS --name internjobs-parrot
# Copy the printed `id` into apps/parrot/wrangler.jsonc → kv_namespaces[0].id
# and (for dev) preview_id. The id is NOT a secret — safe to commit.
wrangler deploy
```

### 1.4 Service Worker (Phase 13 Wave 1)

The service worker is served from `apps/parrot/public/sw.js`. Confirm
it deploys with the bundle:

```bash
curl -s https://workspace.internjobs.ai/sw.js | head -1
# Expect: a JS file header, NOT a 404 HTML page.
```

### 1.5 `GET /healthz` (Phase 13 Wave 3)

The single canonical liveness probe. All three fields must be true on
healthy infra (`mailbox_count: -1` is expected pre-v1.3):

```bash
curl -s https://workspace.internjobs.ai/healthz | jq '.'
# {
#   "mattermost_reachable": true,
#   "ai_gateway_reachable": true,
#   "mailbox_count": -1
# }
```

If `mattermost_reachable` is false: Fly app health-check Mattermost.
If `ai_gateway_reachable` is false: check AI Gateway slug + token + account id.

### 1.6 Infisical persistence (cross-cutting)

Every secret in 1.1 must ALSO be stored in Infisical
`/internjobs-ai` path so we can re-bootstrap a Worker without sifting
through chat history. See memory/infisical-project.md for the org/project
IDs.

---

## 2. Feature flag KV setup

The `PARROT_FEATURE_FLAGS` KV namespace holds the GLOBAL DEFAULTS only.
Per-employee overrides live in the EmployeeMailboxDO's
`profile.feature_flags` TEXT (JSON) column — written via SQL or a
future admin endpoint.

### 2.1 Set the global defaults (recommended initial state)

```bash
wrangler kv key put "global_defaults" \
  '{"cross_pane":true,"push":true,"onboarding_wizard":true}' \
  --namespace-id <PARROT_FEATURE_FLAGS_ID>
```

If the key is unset, `getFeatureFlags()` falls back to the same
default-all-on map — KV is for OVERRIDES, not initialization.

### 2.2 Disable a feature globally (kill switch)

```bash
# Example: disable cross-pane actions for everyone during incident response
wrangler kv key put "global_defaults" \
  '{"cross_pane":false,"push":true,"onboarding_wizard":true}' \
  --namespace-id <PARROT_FEATURE_FLAGS_ID>
```

The change propagates within ~60s (KV edge cache TTL). Crucially:
**no Worker redeploy required**. This is the primary rollback lever.

### 2.3 Override flags for a specific employee

Per-employee overrides are stored in the DO, not in KV. To override
flags for one user, either:

**Option A — Direct DO SQL (operator console — future v1.3):**

```sql
UPDATE profile SET feature_flags = '{"cross_pane":false}' WHERE id = 1;
```

**Option B — Coming in v1.3:** a `POST /api/admin/employees/:id/flags`
endpoint that operators can hit. Not built in v1.2.

For pilot, prefer global flag overrides (2.2) — per-employee surgery
during an incident is more risky than killing the feature for all.

### 2.4 Available flags (Phase 13)

| Flag | Default | Effect when `false` |
| --- | --- | --- |
| `cross_pane` | `true` | EmailToChat / ChatToEmail / StartMeeting buttons hidden or disabled |
| `push` | `true` | OnboardingWizard skips step 2; no new push subscriptions registered |
| `onboarding_wizard` | `true` | Wizard does not render even if `onboarded_at` is null |

---

## 3. Smoke test sequence

Run in order against `https://workspace.internjobs.ai` (production)
OR `http://localhost:8787` (wrangler dev). All endpoints require the
`X-Parrot-Dev-Employee` header in dev, or a real Clerk session cookie
in production. All `/api/dev/smoke/*` endpoints are PARROT_DEV_MODE-gated
and return 403 in production — run them locally before deploy.

### 3.1 Push subscriptions + notifications (Phase 13 Wave 1)

```bash
curl -s -X POST http://localhost:8787/api/dev/smoke/push \
  -H "X-Parrot-Dev-Employee: dev@internjobs.ai" | jq '.pass'
# Expect: true
```

### 3.2 Cross-pane actions (Phase 13 Wave 2)

```bash
curl -s -X POST http://localhost:8787/api/dev/smoke/crosspane \
  -H "X-Parrot-Dev-Employee: dev@internjobs.ai" | jq '.pass'
# Expect: true
```

### 3.3 Onboarding + feature flags (Phase 13 Wave 3)

```bash
curl -s -X POST http://localhost:8787/api/dev/smoke/onboarding \
  -H "X-Parrot-Dev-Employee: dev@internjobs.ai" | jq '.pass'
# Expect: true
```

### 3.4 Dashboard mothership agent (Phase 12)

```bash
curl -s -X POST http://localhost:8787/api/dev/smoke/seed-email \
  -H "X-Parrot-Dev-Employee: dev@internjobs.ai" | jq '.pass'
# Expect: true (requires CLOUDFLARE_AI_API_TOKEN + PARROT_AI_GATEWAY_ID set)

curl -s -X POST http://localhost:8787/api/dev/smoke/ranking \
  -H "X-Parrot-Dev-Employee: dev@internjobs.ai" | jq '.pass'
# Expect: true
```

### 3.5 Production health (post-deploy)

```bash
curl -s https://workspace.internjobs.ai/healthz | jq '.'
# Expect: { mattermost_reachable: true, ai_gateway_reachable: true, mailbox_count: -1 }
```

---

## 4. Day-1 rollout protocol

### 4.1 Who to onboard first

Onboard in this order, one user at a time, with at least 24h between
each:

1. **Day 1: yourself (raj)** — full path: sign in → wizard → real email
   triage → real chat message. You're catching the bugs the test suite
   missed.
2. **Day 2-3: ridhi@internjobs.ai (CEO)** — second human in the system.
   Watch for race conditions on the Mattermost team-membership flow
   (two users on the same Mattermost server is the first real test of
   the OIDC bridge under concurrent registration).
3. **Day 4+: external pilots** — only after the first two users have
   used the system for 24h each without operator intervention.

### 4.2 Onboarding sequence (per employee)

1. **Admin (you):** invite the user in Clerk Workspace dashboard
   (clerk.workspace.internjobs.ai → Users → Invite by phone). Set
   `publicMetadata.role: "operator"` if they should see /admin/*.
2. **Employee:** signs in to `https://workspace.internjobs.ai` via
   phone OTP. Lands on the workspace shell.
3. **Onboarding wizard appears automatically** (`onboarded_at IS NULL`).
4. **Employee completes the wizard:**
   - Step 1: confirms display name (pre-filled from Clerk).
   - Step 2: opts into browser push (optional — they can decline).
   - Step 3: clicks Finish. The Mattermost bot will auto-register
     them on its next poll cycle (≤2 min).
5. **Verify in Mattermost admin panel:** the employee appears in the
   Members list within ~2 min of clicking Finish.
6. **Verify operator-visible audit:** check the EmployeeMailboxDO's
   profile row (via `wrangler tail` + a manual SELECT) — `onboarded_at`
   should be a non-null ISO timestamp.

### 4.3 Day-1 telemetry watchpoints

For the first 24h, monitor:

- `console.error` and `console.warn` in `wrangler tail --name internjobs-parrot`
  — Sentry will catch unhandled errors, but the SW push fan-out and
  Mattermost poll failures log via console (intentional — they're
  expected to fail-soft).
- The `/api/notifications` count for the pilot user — should be ≤ 10/day
  during the first day (we're probably over-pushing if it's higher).
- AI Gateway daily quota — 200 req/day/user, watch for capping. If you
  see `ai_gateway_quota_exceeded` in `audit_events`, the per-user cap
  is being hit by a single Phase 12 alarm cycle and we need to relax it.

---

## 5. Rollback procedure

The Parrot architecture deliberately makes EVERY pane independently
disable-able via feature flags. There should never be a need to roll
back the entire Worker — instead, kill the offending feature.

### 5.1 Disable a single pane (preferred — no redeploy)

```bash
# Kill cross-pane (EmailToChat, ChatToEmail, StartMeeting)
wrangler kv key put "global_defaults" \
  '{"cross_pane":false,"push":true,"onboarding_wizard":true}' \
  --namespace-id <PARROT_FEATURE_FLAGS_ID>

# Kill push (stops new subscriptions; existing subscriptions still
# receive — there is no way to invalidate them server-side in v1.2)
wrangler kv key put "global_defaults" \
  '{"cross_pane":true,"push":false,"onboarding_wizard":true}' \
  --namespace-id <PARROT_FEATURE_FLAGS_ID>

# Hide the onboarding wizard (e.g. during onboarding flow incident)
wrangler kv key put "global_defaults" \
  '{"cross_pane":true,"push":true,"onboarding_wizard":false}' \
  --namespace-id <PARROT_FEATURE_FLAGS_ID>
```

Effective in ≤60s (KV edge propagation).

### 5.2 Worker rollback (last resort)

```bash
wrangler deployments list --name internjobs-parrot
# Pick the previous SHIPPED deployment id (NOT a draft).
wrangler rollback <deployment-id> --name internjobs-parrot
```

Caveats:

- **DO migrations are forward-only.** A Worker rollback DOES NOT
  un-apply migrations. If you roll back to a Worker version that
  predates migration 5_onboarding_flags, the `profile.onboarded_at`
  column still exists in the DO storage — the older Worker code just
  won't read it. This is safe.
- **KV state survives Worker rollbacks** — your feature flag overrides
  remain in effect.
- **DO storage survives Worker rollbacks** — emails, todos, profiles,
  notifications all persist.

### 5.3 Emergency DNS bypass

If the Worker is utterly broken and a rollback doesn't fix it, you can
point `workspace.internjobs.ai` at a static maintenance page hosted on
Cloudflare Pages:

1. Cloudflare dash → DNS → `internjobs.ai` zone.
2. Find the CNAME for `workspace` (currently points at the Worker via
   `workspace.internjobs.ai` Custom Domain).
3. Edit to point at `internjobs-maintenance.pages.dev` (or any Pages
   project serving a "Parrot is down for maintenance" page).
4. Wait 5-10 minutes for propagation.

Reverse by editing the CNAME back. The Worker remains deployed; only
the DNS routing changes.

### 5.4 Database state surgery

If a single employee's mailbox state is corrupted (e.g., bad
feature_flags JSON, stuck Mattermost bot user_id):

```bash
# Find the DO for that employee:
wrangler durable-objects list --name internjobs-parrot

# Connect via wrangler tail and inspect via a /admin/* endpoint
# (v1.3 will add a proper admin console).
```

In v1.2 there is no remote SQL surface on the DO storage — direct
SQL surgery is not possible without a wrangler dev session against
production storage, which is intentionally not exposed. Plan around
this: if a single user's state is broken, kill the feature flag for
them OR drop and recreate their EmployeeMailboxDO instance (which
loses their notification history but rehydrates from Clerk).

---

## 6. On-call escalation

### 6.1 Primary contact

- **Raj (rentalaraj@gmail.com)** — Worker code, infra, DO storage, KV,
  Sentry config, deploy access, Clerk admin.

### 6.2 Service ownership

| Service | Owner | Dash link |
| --- | --- | --- |
| Cloudflare Worker `internjobs-parrot` | Raj | dash.cloudflare.com → Workers |
| Cloudflare AI Gateway `internjobs-parrot` | Raj | dash.cloudflare.com → AI → AI Gateway |
| Cloudflare Email Routing (workspace.internjobs.ai apex routing) | Raj | dash.cloudflare.com → Email |
| Mattermost (Fly app `internjobs-mattermost`) | Raj | fly.io/apps/internjobs-mattermost |
| Clerk Workspace app (clerk.workspace.internjobs.ai) | Raj | dashboard.clerk.com |
| FalkorDB graph (Fly app `internjobs-graph`) | Raj | fly.io/apps/internjobs-graph — only relevant if the student app is also degraded |
| Sentry project (Parrot) | Raj | sentry.io |

### 6.3 Severity ladder

- **SEV-1 — workspace inaccessible:** `/healthz` returns 5xx, OR
  `workspace.internjobs.ai` returns 5xx for all users.
  → Triage path: check Cloudflare Worker status, then KV edge, then
  Custom Domain DNS. If all clean, redeploy or roll back.
- **SEV-2 — single feature broken for all users:** cross-pane buttons
  don't work, push doesn't fire, wizard shows but doesn't complete.
  → Triage: kill the feature flag (Section 5.1) while investigating.
- **SEV-3 — single user affected:** one employee's mailbox is wedged.
  → Triage: kill flags for them only, OR rebuild their DO.

### 6.4 Comms

For SEV-1/SEV-2 affecting pilot users: post a status message to the
team Mattermost channel `#parrot-launch` within 15 minutes of
acknowledgement. Include: what's broken, what's not affected, ETA.

---

## 7. Out of scope (for v1.2 pilot)

These are documented here so they don't surprise anyone during launch:

- **Daily.co video meetings** (Phase 11) — DEFERRED. The Start Meeting
  button records pilot demand via the notifications table; clicking it
  shows a "coming soon" toast.
- **RFC 8291 push body encryption** — push payloads are UNENCRYPTED
  JSON in v1.2. Titles/bodies don't carry PII so this is acceptable
  for pilot. Encryption will be added in v1.3.
- **Telnyx phone/SMS integration** — placeholder routes only (Phase 12).
- **Real admin console** — flag overrides + DO surgery require
  wrangler CLI access in v1.2. A `/admin/*` UI lands in v1.3.

---

## Change log

- 2026-05-19 — Initial runbook written for Phase 13 Wave 3 ship
  (commit: TBD on landing). Covers feature-flag-driven rollback,
  /healthz, Sentry-or-equivalent error tracking, and the onboarding
  wizard.
