---
phase: 01-preflight-sms-abstraction
milestone: v1.2-two-sided-agent-mvp
type: execute
wave: 1
depends_on: []
autonomous: false

files_modified:
  - apps/app/src/sms/provider.mjs
  - apps/app/src/sms/spectrum.mjs
  - apps/app/src/messaging.mjs
  - apps/app/src/spectrum-listener.mjs
  - apps/app/src/server.mjs
  - apps/app/src/store.mjs
  - apps/app/src/config.mjs

must_haves:
  truths:
    - "Live LinkedIn → Clerk → app sign-in completes end-to-end in prod (no proxy intercept)"
    - "CLERK_SECRET_KEY is rotated; new key is live in Fly prod"
    - "All Photon SDK send + receive calls go through SmsProvider; no direct photon.apiBaseUrl fetch or spectrum-ts import remains in server.mjs or messaging.mjs"
    - "/healthz reports clerk/database/photonNumber/photonWebhook/spectrumListener all true"
    - "v1.1 pairing + threading flow works in prod without regression"
  artifacts:
    - path: "apps/app/src/sms/provider.mjs"
      provides: "SmsProvider interface contract — sendSms + inbound shape"
    - path: "apps/app/src/sms/spectrum.mjs"
      provides: "SpectrumSmsProvider — sole implementation of SmsProvider"
    - path: "apps/app/src/messaging.mjs"
      provides: "verifyWebhook + parseInboundMessage delegating to SmsProvider"
    - path: "apps/app/src/spectrum-listener.mjs"
      provides: "Spectrum listener using SpectrumSmsProvider.listen()"
    - path: "apps/app/src/server.mjs"
      provides: "Webhook route calling smsProvider.verifyWebhook + smsProvider.parseInbound"
  key_links:
    - from: "apps/app/src/server.mjs"
      to: "apps/app/src/sms/spectrum.mjs"
      via: "smsProvider instance constructed in server startup"
    - from: "apps/app/src/sms/spectrum.mjs"
      to: "apps/app/src/store.mjs"
      via: "confirmPairingCode / recordInboundMessage — interface unchanged"
---

# Phase 01: Pre-flight + SMS Provider Abstraction

Clear v1.1 carry-over blockers and wrap the Spectrum/Photon path behind a minimal
`SmsProvider` interface so v1.3+ can drop in a Telnyx adapter at the seam without
touching `server.mjs`, `store.mjs`, or any future call-site.

---

## Task 1 — [USER ACTION] Fix Cloudflare DNS proxy on Clerk subdomains

**Goal:** Unblock LinkedIn → Clerk OAuth for every user type in v1.2.

**Requirement:** SEC-01

**Action:** Log in to the Cloudflare dashboard for the `internjobs.ai` zone.

Dashboard URL: https://dash.cloudflare.com → DNS → Records

Find these two A/CNAME records and toggle proxy status from **Proxied (orange cloud)** to
**DNS only (gray cloud)** on each:

| Record | Current (broken) | Change to |
|--------|-----------------|-----------|
| `accounts.internjobs.ai` | Proxied | DNS only |
| `clerk.internjobs.ai` | Proxied | DNS only |

Save both changes. DNS propagates within 60 seconds for already-cached records.

**Verify:** Open a private/incognito browser window and complete a full LinkedIn →
Clerk → `app.internjobs.ai` sign-in against the production app. The OAuth round-trip
must complete without a TLS or redirect error. Success = land on `/pairing`.

---

## Task 2 — [USER ACTION] Rotate CLERK_SECRET_KEY and re-import to Fly

**Goal:** Eliminate the exposed key from conversation history before v1.2 widens its blast radius.

**Requirement:** SEC-ROTATE-01 (backlog hygiene)

**Step 1 — Rotate in Clerk Dashboard:**

URL: https://dashboard.clerk.com → `Internjobs.ai` (app `app_38BrRDRKnvbo7vlE2ZZtMc7hFPC`) → API Keys

Click "Rotate secret key". Copy the new `sk_live_...` value.

Do NOT paste the value into chat.

**Step 2 — Update Infisical:**

URL: https://app.infisical.com → org `2c12f042-e98f-4fb3-8b40-16aec29f9b91` → project `26995afd-9a6f-4690-912f-01cbcebb76d5` → env `prod` → path `/internjobs-ai`

Update `CLERK_SECRET_KEY` with the new value. Save.

**Step 3 — Re-import to Fly:**

```bash
infisical export \
  --projectId=26995afd-9a6f-4690-912f-01cbcebb76d5 \
  --env=prod \
  --path=/internjobs-ai \
  --format=dotenv | flyctl secrets import \
  --app internjobs-ai-student-app
```

Fly will trigger a rolling restart automatically.

**Verify:** After restart, `curl https://app.internjobs.ai/healthz` returns `"clerk": true`
and `"configured": { ... }` with no missing keys. Also verify `/config/status` returns
`{ "missing": [] }`.

---

## Task 3 — Define SmsProvider interface and create SpectrumSmsProvider

**Goal:** Establish the interface seam that Phases 04 and 05 will call; move all
Spectrum/Photon implementation details out of `messaging.mjs` and `spectrum-listener.mjs`.

**Files created:**
- `apps/app/src/sms/provider.mjs` — interface contract (JSDoc only, no runtime enforcement)
- `apps/app/src/sms/spectrum.mjs` — SpectrumSmsProvider implementation

**Interface contract in `apps/app/src/sms/provider.mjs`:**

```js
/**
 * SmsProvider interface.
 *
 * Every implementation must export a factory `createSmsProvider(config)`
 * that returns an object satisfying this shape.
 *
 * sendSms(to, body) → Promise<{ providerMessageId: string|null, status: 'sent'|'skipped'|'provider_error', metadata: object }>
 *
 * verifyWebhook(req, rawBody) → { ok: boolean, reason?: string, mode?: string }
 *   Validates inbound webhook authenticity. Returns { ok: true } if authentic.
 *
 * parseInbound(payload) → InboundMessage
 *   Normalizes a raw webhook payload to the shared inbound shape.
 *
 * listen({ store }) → Promise<void>  (optional — only for listener-based providers)
 *   Starts a long-running listener loop (Spectrum WebSocket model).
 *   Must call store.confirmPairingCode or store.recordInboundMessage per message.
 *
 * @typedef {Object} InboundMessage
 * @property {string} providerEventId
 * @property {string} text
 * @property {string} code
 * @property {string} channelType
 * @property {string} channelAddress
 * @property {{ provider: string, receivedAt: string, channel: string, hasText: boolean }} metadata
 */
```

**SpectrumSmsProvider in `apps/app/src/sms/spectrum.mjs`:**

Move the implementation verbatim from the existing modules, preserving all behavior:

- `verifyWebhook(req, rawBody)` — lifted from `verifyPhotonWebhook` in `messaging.mjs`
  (keep `x-internjobs-webhook-secret`, `x-photon-webhook-secret`, `x-spectrum-webhook-secret`
  header checks and HMAC path exactly as-is)
- `parseInbound(payload)` — lifted from `parseInboundMessage` in `messaging.mjs`
  (keep field aliases: `payload.text || payload.body || payload.message`, etc.)
  Set `metadata.provider = 'spectrum'` (was `'photon'` — this is the only value change,
  and is safe because the string is stored in `messaging_events.metadata` JSON, not
  in the `provider` column which stays `'photon'` for v1.2 DB compatibility — see store note below)
- `sendSms(to, body)` — lifted from `sendWelcomeMessage` in `messaging.mjs`, generalized:
  accepts `(to, body)` instead of `(student, config)`. Returns `{ providerMessageId, status, metadata }`.
  Uses `config.photon.apiBaseUrl`, `config.photon.apiToken`, `config.photon.fromNumber` (unchanged)
- `listen({ store })` — lifted from `runSpectrumWaitlistListener` in `spectrum-listener.mjs`
  (keep `Spectrum`, `imessage` imports; keep `parseSpectrumMessage` logic; keep `replyWithWelcome`)

Export: `export function createSpectrumSmsProvider(config) { return { verifyWebhook, parseInbound, sendSms, listen }; }`

**Store compatibility note:** `store.mjs` uses the string `'photon'` as the `provider` column
value in `messaging_events` INSERT queries. Do NOT change these strings in Task 3.
They are internal DB identifiers for the existing Spectrum/Photon provider, not the
interface name. They remain `'photon'` throughout v1.2 for zero-migration-needed stability.

---

## Task 4 — Wire SmsProvider into server.mjs and spectrum-listener.mjs; strip direct Photon calls

**Goal:** Replace all direct Photon/Spectrum SDK call-sites with calls through `smsProvider`.
After this task no direct `fetch(photon.apiBaseUrl)` call or `import { Spectrum }` remains
in `server.mjs` or `messaging.mjs`.

**Files modified:**
- `apps/app/src/server.mjs`
- `apps/app/src/messaging.mjs`
- `apps/app/src/spectrum-listener.mjs`

**Changes to `server.mjs`:**

1. Replace `import { parseInboundMessage, sendWelcomeMessage, verifyPhotonWebhook }` with
   `import { createSpectrumSmsProvider } from './sms/spectrum.mjs'`
2. After `const config = getConfig()`, add:
   `const smsProvider = createSpectrumSmsProvider(config)`
3. In the `/webhooks/photon` route:
   - Replace `verifyPhotonWebhook(req, rawBody, config)` → `smsProvider.verifyWebhook(req, rawBody)`
   - Replace `parseInboundMessage(payload)` → `smsProvider.parseInbound(payload)`
   - Replace `sendWelcomeMessage(confirmation.student, config)` →
     `smsProvider.sendSms(confirmation.student.channelAddress, createWelcomeText(confirmation.student))`
     (import `createWelcomeText` from `./messaging.mjs` — keep that export)
4. Pass `smsProvider` into `startSpectrumWaitlistListener`: change call to
   `startSpectrumWaitlistListener({ config, store, smsProvider })`

**Changes to `messaging.mjs`:**

- Remove `verifyPhotonWebhook`, `parseInboundMessage`, `sendWelcomeMessage` exports
  (they are now in `sms/spectrum.mjs`)
- Keep `createWelcomeText` export — still needed by `server.mjs` and `sms/spectrum.mjs`
- Keep the file; do not delete it (avoids cascading import changes)

**Changes to `spectrum-listener.mjs`:**

- Update `startSpectrumWaitlistListener` signature to accept `smsProvider` in options:
  `export function startSpectrumWaitlistListener({ config, store, smsProvider })`
- Replace internal Spectrum import + `runSpectrumWaitlistListener` body with:
  `if (smsProvider.listen) smsProvider.listen({ store })`
- The actual WebSocket loop implementation remains in `sms/spectrum.mjs`'s `listen()` method
- `createWelcomeText` import in this file can be removed (now inside `sms/spectrum.mjs`)

**Verify (local):**

```bash
cd apps/app && node --input-type=module <<'EOF'
import { createSpectrumSmsProvider } from './src/sms/spectrum.mjs';
import { getConfig } from './src/config.mjs';
const provider = createSpectrumSmsProvider(getConfig());
console.assert(typeof provider.verifyWebhook === 'function');
console.assert(typeof provider.parseInbound === 'function');
console.assert(typeof provider.sendSms === 'function');
console.log('provider shape ok');
EOF
```

Also verify no `photon.apiBaseUrl` fetch or `import { Spectrum }` remains in
`server.mjs` or `messaging.mjs`:

```bash
grep -n "apiBaseUrl\|from.*spectrum-ts\|verifyPhotonWebhook\|parseInboundMessage\|sendWelcomeMessage" \
  apps/app/src/server.mjs apps/app/src/messaging.mjs
# expect: no output
```

---

## Task 5 — [USER ACTION] Deploy and verify /healthz in prod

**Goal:** Confirm the refactored app is running in prod and all health checks still pass.

**Deploy:**

```bash
cd apps/app && fly deploy --app internjobs-ai-student-app
```

**Verify (run these manually):**

```bash
# All five health keys must be true
curl -s https://app.internjobs.ai/healthz | jq .

# Must return { "missing": [] }
curl -s https://app.internjobs.ai/config/status | jq .
```

Expected `/healthz` shape:
```json
{
  "ok": true,
  "service": "internjobs-app",
  "configured": {
    "clerk": true,
    "database": true,
    "photonNumber": true,
    "photonWebhook": true,
    "spectrumListener": true
  }
}
```

If `spectrumListener` is `false`: verify `ENABLE_SPECTRUM_LISTENER=true` is set in Infisical
and re-run `flyctl secrets import`.

---

## Verification against success criteria

| # | Criterion | How to verify |
|---|-----------|---------------|
| 1 | LinkedIn → Clerk → app sign-in completes end-to-end | Task 1 USER ACTION: incognito browser, complete full OAuth flow |
| 2 | All Spectrum/Photon calls go through SmsProvider | Task 4 grep: no `apiBaseUrl` fetch or `spectrum-ts` import in server.mjs or messaging.mjs |
| 3 | /healthz all five keys true after refactor | Task 5: `curl /healthz` shows all `true` |
| 4 | v1.1 waitlist + threading still works in prod | Task 5: text the pairing number with a fresh pairing code; confirm `channel_confirmed` update in Neon |

---

## Cross-phase contract (for Phases 04 and 05)

The `SmsProvider` interface exposed from `apps/app/src/sms/provider.mjs`:

**Outbound** (Phase 05 will call this in `APPROVE-02`):
```
smsProvider.sendSms(toPhoneE164, bodyText)
  → Promise<{ providerMessageId: string|null, status: 'sent'|'skipped'|'provider_error', metadata: object }>
```

**Inbound normalization shape** (Phase 04 agent trigger reads this):
```
{
  providerEventId: string,   // dedup key for messaging_events
  text: string,
  code: string,              // extracted pairing code or ''
  channelType: string,       // 'sms' | 'imessage' | ...
  channelAddress: string,    // normalized E.164
  metadata: {
    provider: string,        // 'spectrum' (interface name)
    receivedAt: string,      // ISO timestamp
    channel: string,
    hasText: boolean
  }
}
```

**Idempotency contract (unchanged from v1.1):** `store.confirmPairingCode` and
`store.recordInboundMessage` both deduplicate on `(provider='photon', provider_event_id)` in
`messaging_events`. This contract is intact — the DB column value remains `'photon'` in
v1.2 to avoid a migration.

---

## Commit convention

Follow existing repo style (`git log --oneline -5`):

```
feat: add SmsProvider interface and SpectrumSmsProvider implementation
refactor: route server.mjs webhook through SmsProvider
refactor: strip direct photon calls from messaging.mjs and spectrum-listener.mjs
```

One commit per logical change. Do not bundle the interface creation with the wiring.
