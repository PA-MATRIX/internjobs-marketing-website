# Phase 03 — Startup Email Channel (Inbound + Outbound)

**Requirements:** EMAIL-01, EMAIL-02
**Depends on:** Phase 02 (startups table, startup_members.email)
**Output contracts for Phase 04:** `inbound_messages` rows with `provider='email'`; `sendStartupEmail()` in `apps/app/src/email/outbound.mjs`

---

## Pre-conditions (confirm before starting)

- [ ] Phase 02 complete: `startups` and `startup_members` tables exist in Neon prod.
- [ ] `startup_members.email` column is populated (email is the sender-lookup key for inbound).
- [ ] Resend account confirmed as the outbound provider (research recommends Resend; confirm before EMAIL-02 tasks).

---

## Part A — EMAIL-01: Inbound (CF Worker + Fly ingest endpoint)

### Task 1 — Create Cloudflare Email Worker

**Files:** `apps/email-worker/package.json`, `apps/email-worker/wrangler.toml`, `apps/email-worker/src/index.js`

**Action:**

Create `apps/email-worker/` as a standalone Cloudflare Worker project.

`wrangler.toml`:
```toml
name = "internjobs-email-ingest"
main = "src/index.js"
compatibility_date = "2026-05-16"

[vars]
FLY_INGEST_URL = "https://app.internjobs.ai/webhooks/email"

# EMAIL_WORKER_SECRET is set as an encrypted secret via `wrangler secret put`
# — never in wrangler.toml
```

`src/index.js` — Email event handler:

```js
export default {
  async email(message, env, ctx) {
    const from = message.from;
    const to = message.to;
    const subject = message.headers.get("subject") ?? "";

    // Read plain-text body (strip HTML if necessary)
    let body = "";
    try {
      const raw = new Response(message.raw);
      // Use PostalMime or manual MIME parse to extract text/plain part.
      // Minimum viable: read raw body and strip HTML tags.
      body = await raw.text();
    } catch (_) {
      body = "(body parse failed)";
    }

    const payload = JSON.stringify({ from, to, subject, body, ts: Date.now() });

    // HMAC-sign the payload using the shared secret
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(env.EMAIL_WORKER_SECRET),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
    const sigHex = Array.from(new Uint8Array(sig))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    // Best-effort POST to Fly app; on failure forward to operator inbox
    // (PITFALLS #7: Email Routing drops silently if Worker throws — catch all)
    try {
      const res = await fetch(env.FLY_INGEST_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-email-worker-secret": env.EMAIL_WORKER_SECRET,
          "x-email-hmac-sha256": sigHex,
        },
        body: payload,
      });
      if (!res.ok) {
        // Forward raw email to operator as fallback visibility (PITFALLS #7)
        await message.forward("ops@internjobs.ai");
      }
    } catch (_) {
      // Never throw — Email Routing drops the email if the Worker throws
      await message.forward("ops@internjobs.ai");
    }
  },
};
```

Notes:
- `EMAIL_WORKER_SECRET` is a 32-byte random hex string. Set via `wrangler secret put EMAIL_WORKER_SECRET` — NOT in wrangler.toml.
- The fallback `message.forward("ops@internjobs.ai")` ensures the operator sees the email even if Fly is down (PITFALLS #7 mitigation: best-effort POST + operator-inbox fallback; Cloudflare Queues is deferred to v1.3 to keep scope tight).
- Use `message.from` (parsed `From:` header), not the envelope sender, to avoid SPF rewrite confusion (PITFALLS #9).
- v1.2 address: `startups@internjobs.ai`. Catch-all (`*@internjobs.ai`) is optional for v1.2 — confirm with INTEG-01: the round-trip reply uses `conv_{conversation_id}@internjobs.ai` as Reply-To (Phase 04 wires this); the Worker must handle both the initial `startups@internjobs.ai` and the reply-to pattern. Use a CF Email Routing catch-all rule so both work.

**[USER ACTION — must happen before deploying this Worker]:**
1. Log into Cloudflare Dashboard → Email → Email Routing → enable on `internjobs.ai` zone.
2. Create routing rule: catch-all `*@internjobs.ai` → Send to Worker → `internjobs-email-ingest`.
3. (Or two rules: `startups@internjobs.ai` + `conv_*@internjobs.ai` — catch-all is simpler.)
4. Generate `EMAIL_WORKER_SECRET`: `openssl rand -hex 32`
5. Store the secret in two places:
   - Cloudflare Worker: `cd apps/email-worker && npx wrangler secret put EMAIL_WORKER_SECRET`
   - Infisical prod `/internjobs-ai`: key `EMAIL_WORKER_SECRET`, value = same hex string.

**Verify:**
```bash
cd apps/email-worker && npx wrangler deploy
# Then send a test email to startups@internjobs.ai and confirm Worker logs in:
# npx wrangler tail internjobs-email-ingest
```

**Done:** Worker is deployed; `wrangler tail` shows the email event and the POST attempt to `FLY_INGEST_URL`. No thrown exceptions.

---

### Task 2 — Fly ingest endpoint + audit_events logging

**Files:**
- `apps/app/src/server.mjs` (add `POST /webhooks/email` route)
- `apps/app/src/config.mjs` (add `emailWorkerSecret` to config + healthz)
- `apps/app/src/store.mjs` (add `recordEmailInbound` function)

**Action:**

**config.mjs** — add email worker secret and outbound key fields:
```js
emailWorkerSecret: env.EMAIL_WORKER_SECRET || "",
resendApiKey: env.RESEND_API_KEY || "",
```

Update `getMissingProviderConfig` to include both keys as warnings (not hard blocks in Phase 03; they will be hard blocks in Phase 05 when sends are needed).

**store.mjs** — add `recordEmailInbound(event)`:
```js
async recordEmailInbound({ from, to, subject, body }) {
  // 1. Write inbound_messages row (provider='email', channel_type='email')
  // 2. Lookup startup_id by matching from against startup_members.email (case-insensitive)
  //    If no match: startup_id = null, log unmatched_startup_email
  // 3. Write audit_events row: event_type='startup_email_received', metadata includes from/subject
  // Returns the inserted inbound_messages row id
}
```

Schema note: `inbound_messages` table is created in migration `0003_v1_2_two_sided_agent.sql` (Phase 02 or early Phase 04). If that migration has not run yet when Phase 03 executes, add the `inbound_messages` table creation to a new migration `0003b_email_inbound.sql`:
```sql
create table if not exists inbound_messages (
  id               uuid primary key default gen_random_uuid(),
  provider         text not null,
  provider_event_id text,
  channel_type     text not null,
  channel_address  text,
  student_id       uuid references students(id) on delete set null,
  startup_id       uuid references startups(id) on delete set null,
  direction        text not null default 'inbound',
  body             text not null default '',
  metadata         jsonb not null default '{}'::jsonb,
  processed_at     timestamptz,
  created_at       timestamptz not null default now()
);
create unique index if not exists inbound_messages_provider_event_uidx
  on inbound_messages(provider, provider_event_id)
  where provider_event_id is not null;
create index if not exists inbound_messages_unprocessed_idx
  on inbound_messages(created_at) where processed_at is null;
```

**server.mjs** — add `POST /webhooks/email`:
```js
if (req.method === "POST" && url.pathname === "/webhooks/email") {
  // 1. Verify x-email-worker-secret header using crypto.timingSafeEqual
  //    (compare Buffer.from(header) vs Buffer.from(config.emailWorkerSecret))
  // 2. On mismatch: sendJson(res, 401, { error: 'unauthorized' }); return
  // 3. Parse JSON body: { from, to, subject, body, ts }
  // 4. Call store.recordEmailInbound({ from, to, subject, body })
  // 5. sendJson(res, 200, { ok: true })
  // Never throw — Worker fallback-forwards on 5xx
}
```

HMAC verification: use Node `crypto.timingSafeEqual` on the `x-email-hmac-sha256` header for constant-time comparison to prevent timing attacks. The `x-email-worker-secret` header provides a second fast-fail check before the HMAC computation.

**healthz update:**
```js
emailWorkerSecret: Boolean(config.emailWorkerSecret),
resendApiKey: Boolean(config.resendApiKey),  // false until EMAIL-02 secrets land
```

**[USER ACTION]:**
After coding is complete and before testing:
- Add `EMAIL_WORKER_SECRET` to Infisical prod `/internjobs-ai` (already done in Task 1 Step 5).
- Re-run: `infisical run -- flyctl secrets import` to inject into Fly.

**Verify:**
```bash
# After flyctl deploy:
curl https://app.internjobs.ai/healthz
# Expected: "emailWorkerSecret": true (resendApiKey will be false until Task 4)

# Manual end-to-end test:
# Send email to startups@internjobs.ai from any address.
# Check Neon: SELECT * FROM audit_events WHERE event_type='startup_email_received' ORDER BY created_at DESC LIMIT 1;
# Check Neon: SELECT * FROM inbound_messages WHERE provider='email' ORDER BY created_at DESC LIMIT 1;
```

**Done:**
- `POST /webhooks/email` returns 200 for valid HMAC, 401 for invalid.
- Each inbound email produces one `inbound_messages` row and one `audit_events` row with `event_type='startup_email_received'`.
- `/healthz` shows `emailWorkerSecret: true`.

---

## Part B — EMAIL-02: Outbound (Resend + SPF/DKIM + outbound module)

### Task 3 — Outbound email module (thin wrapper)

**Files:** `apps/app/src/email/outbound.mjs`

**Action:**

Create `apps/app/src/email/outbound.mjs` as the single call-site for all startup-facing outbound email. Phase 05 (APPROVE-02) calls `sendStartupEmail()` — this is the only function it should need.

```js
// apps/app/src/email/outbound.mjs
// Thin wrapper around Resend. Phase 05 calls sendStartupEmail() directly.
// Mirror pattern: single implementation, loose interface — same philosophy as SmsProvider (SMS-01).

import { Resend } from "resend";

let _client = null;

function getClient(apiKey) {
  if (!_client) _client = new Resend(apiKey);
  return _client;
}

/**
 * Send a transactional email to a startup.
 * @param {object} opts
 * @param {string} opts.to           — startup recipient email
 * @param {string} opts.subject      — email subject line
 * @param {string} opts.body         — plain-text body (Resend also accepts html)
 * @param {string} opts.replyTo      — optional; used for conversation-keyed reply-to (Phase 04)
 * @param {string} opts.apiKey       — RESEND_API_KEY from config
 * @returns {Promise<{ id: string }>} — Resend message ID
 */
export async function sendStartupEmail({ to, subject, body, replyTo, apiKey }) {
  const resend = getClient(apiKey);
  const { data, error } = await resend.emails.send({
    from: "InternJobs.ai <noreply@internjobs.ai>",
    to,
    subject,
    text: body,
    ...(replyTo ? { replyTo } : {}),
  });
  if (error) throw new Error(`Resend send failed: ${error.message}`);
  return { id: data.id };
}
```

Dependencies: add `resend` to `apps/app/package.json`.

```bash
cd apps/app && npm install resend
```

**Verify:**
```bash
# Unit test (dry-run with invalid key returns expected error shape):
node -e "
import('./src/email/outbound.mjs').then(({ sendStartupEmail }) =>
  sendStartupEmail({ to: 'test@example.com', subject: 'test', body: 'hello', apiKey: 'invalid' })
    .catch(e => console.log('expected error:', e.message))
)"
```

**Done:** `apps/app/src/email/outbound.mjs` exports `sendStartupEmail`. Module imports without error. `resend` is in `package.json`.

---

### Task 4 — Resend domain verification + deliverability smoke test

**Files:** _(no code changes — this is DNS + provider configuration + a manual test send)_

**Action:**

This task is primarily **[USER ACTIONS]**. All steps listed below are required before the smoke test can run.

**[USER ACTION — Resend domain setup]:**
1. Sign up / log in at resend.com with `rentalaraj@gmail.com`.
2. Add domain `internjobs.ai` in Resend Dashboard → Domains → Add Domain.
3. Resend will provide:
   - SPF record: `TXT` on `internjobs.ai` — `v=spf1 include:amazonses.com ~all` (or Resend-specific include; copy exactly from dashboard).
   - DKIM record: `TXT` or `CNAME` on a Resend-provided subdomain like `resend._domainkey.internjobs.ai`.
   - (Optional) DMARC: `TXT` on `_dmarc.internjobs.ai`.
4. Add all DNS records in Cloudflare DNS for `internjobs.ai`.
5. In Resend Dashboard, click "Verify DNS" — wait for all three records to show green.

**[USER ACTION — API key + Fly secret]:**
6. In Resend Dashboard → API Keys → Create API key (name: `internjobs-fly-prod`, permissions: sending only).
7. Add to Infisical prod `/internjobs-ai`: key `RESEND_API_KEY`, value = key from step 6.
8. Re-run: `infisical run -- flyctl secrets import` then `flyctl deploy`.

**SPF note (PITFALLS #8/#9):** CF Email Routing MX records and the Resend SPF/DKIM records coexist on the same domain. CF Email Routing owns the `MX` record for inbound; Resend owns the `SPF include` + DKIM CNAME for outbound. These do not conflict.

**Smoke test — after DNS verification passes and Fly secrets are updated:**

```bash
# 1. Confirm healthz shows both keys true
curl https://app.internjobs.ai/healthz
# Expected: "emailWorkerSecret": true, "resendApiKey": true

# 2. Send a test email using the outbound module directly
node -e "
process.env.RESEND_API_KEY = '<paste key>';
import('./apps/app/src/email/outbound.mjs').then(({ sendStartupEmail }) =>
  sendStartupEmail({
    to: 'rentalaraj@gmail.com',
    subject: 'InternJobs.ai outbound smoke test',
    body: 'If you received this, outbound email works.',
    apiKey: process.env.RESEND_API_KEY
  }).then(r => console.log('sent:', r.id))
)"

# 3. Repeat with an Outlook address to verify cross-provider deliverability.
#    (Use a throwaway Outlook account or ask a colleague.)
```

**Verify:**
- Test email arrives in Gmail inbox (not spam). DKIM/SPF pass visible in email headers: `Authentication-Results: dkim=pass; spf=pass`.
- Test email arrives in Outlook inbox (not spam).
- Resend Dashboard shows both sends as `delivered`.

**Done (SUCCESS CRITERION 3):** Outbound email from `noreply@internjobs.ai` delivered to Gmail and Outlook, both showing DKIM/SPF pass in headers.

---

## Verification — Success Criteria Mapping

| # | Success Criterion | How to Verify |
|---|-------------------|---------------|
| 1 | Email to startup-facing address received by CF Worker, forwarded HMAC-signed to `/webhooks/email` | Send email to `startups@internjobs.ai`; check `wrangler tail` shows POST attempt; check Fly logs show 200 response |
| 2 | Inbound receipt logged in `audit_events` with `event_type='startup_email_received'` | `SELECT * FROM audit_events WHERE event_type='startup_email_received' LIMIT 1;` returns a row |
| 3 | SPF + DKIM verified; test outbound from `noreply@internjobs.ai` delivers to Gmail + Outlook | Email headers show `dkim=pass; spf=pass`; not in spam; Resend shows `delivered` |
| 4 | `/healthz` reports `emailWorkerSecret: true` and `resendApiKey: true` | `curl https://app.internjobs.ai/healthz` → both keys true |

---

## Scope boundary notes

- **Startup sender lookup** (matching inbound `from` to `startup_members.email`) is wired in Task 2. Unknown senders log `'unmatched_startup_email'` and do not fail — they are observable. Manual resolution is acceptable for v1.2.
- **Reply-To conversation addressing** (`conv_{conversation_id}@internjobs.ai`) is wired in Phase 04 when `conversations` rows exist. The Worker's catch-all routing rule handles these addresses without a Phase 03 code change.
- **Cloudflare Queues** for durable buffering (PITFALLS #7 full mitigation) is deferred to v1.3. The v1.2 mitigation is: operator-inbox forward on POST failure, which provides visibility without data loss.
- **`inbound_messages` table**: if Phase 02 migration `0003_v1_2_two_sided_agent.sql` already created this table, skip the `0003b` migration in Task 2. Check `\d inbound_messages` in Neon first.
