# Phase 28.5 — Deferred Ops Checklist

**Created:** 2026-05-25 (during 28.5-01 execution)
**Owner:** raj@internjobs.ai
**Defer reason:** User instructed "don't wait on me — finish all the phases" (2026-05-25 session). All
`checkpoint:human-verify` tasks in Phase 28.5 plans that require Cloudflare / Clerk / DNS dashboard
operations are captured here instead of pausing the executor mid-phase. Each entry is a self-contained
to-do with exact acceptance criteria and a list of downstream tests/code paths that remain blocked
until the entry is checked off.

This file is the v1.5 (or pre-pilot-cutover) ops backlog for Phase 28.5. It is **not** a code artifact
and is **not** owned by any automated test — flip the checkboxes manually as each step is completed.

---

## From plan 28.5-01 (Clerk app #3 + DNS + Email Routing bootstrap)

The auto portion of 28.5-01 (apps/startup/wrangler.jsonc stubs) shipped on 2026-05-25
(commit `879c9a9`). The 7-step external-dashboard checkpoint below is deferred.

### DEFER-28.5-01-A — Clerk app #3 secrets to Infisical + wrangler

Status: **Partially done.** User has already created Clerk app #3 in the dashboard and saved
`STARTUPS_NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `STARTUPS_CLERK_SECRET_KEY`, `STARTUPS_CLERK_ISSUER`,
`STARTUPS_CLERK_JWKS_URL` to Infisical `/internjobs-ai` env=`prod` (confirmed in execute-plan
context 2026-05-25). The `wrangler secret put` step into the startup Worker is **not yet done**.

Remaining action:

1. Pull the secret key value from Infisical and pipe it into the startup Worker:
   ```bash
   STARTUPS_CLERK_SECRET_KEY=$(infisical secrets get STARTUPS_CLERK_SECRET_KEY \
     --projectId 26995afd... --env prod --path /internjobs-ai --plain) \
     wrangler secret put STARTUPS_CLERK_SECRET_KEY --config apps/startup/wrangler.jsonc <<<"$STARTUPS_CLERK_SECRET_KEY"
   ```
   (or copy-paste from Infisical UI into `wrangler secret put` interactive prompt)
2. Optionally also set `STARTUPS_CLERK_ISSUER` and `STARTUPS_CLERK_JWKS_URL` via `wrangler secret put`
   if you prefer them as secrets over the empty-string defaults in `wrangler.jsonc`. They're public
   Clerk endpoints, so plain vars are fine too — keep them as vars unless you have a reason not to.

Acceptance:
- `wrangler secret list --config apps/startup/wrangler.jsonc` shows `STARTUPS_CLERK_SECRET_KEY`.
- The 4 keys are also queryable from Infisical at `/internjobs-ai` env=`prod`.

Blocks: 28.5-04 (webhook handler deploy will fail without `STARTUPS_CLERK_SECRET_KEY` bound).

### DEFER-28.5-01-B — Clerk frontend-api custom domain CNAME

Action:
1. Clerk Dashboard → "InternJobs Startups" app → Domains → Add domain: `startups.internjobs.ai`.
2. Copy the CNAME target Clerk shows (typically `frontend-api.clerk.services` or app-specific subdomain).
3. Cloudflare DNS for `internjobs.ai` zone → Add record:
   - Type: CNAME
   - Name: `clerk.startups.internjobs.ai`
   - Target: [whatever Clerk gave you in step 2]
   - Proxy status: **DNS only** (gray cloud, NOT proxied — Clerk handles its own TLS)
4. Wait for Clerk dashboard to show domain as "Verified" (usually < 5 min).

Acceptance:
- `dig CNAME clerk.startups.internjobs.ai +short` returns the Clerk target.
- Clerk dashboard shows the domain verified.

Blocks: 28.5-02 (Vite scaffold can technically deploy without this, but signed-in flows won't work
end-to-end until Clerk recognizes the domain).

### DEFER-28.5-01-C — CF Pages project create + custom domain

Action:
1. Run:
   ```bash
   wrangler pages project create internjobs-startups --production-branch main
   ```
2. Cloudflare Dashboard → Workers & Pages → `internjobs-startups` → Custom Domains → Add:
   `startups.internjobs.ai`. Cloudflare will auto-create the CNAME and provision a managed TLS cert.
3. Verify TLS:
   ```bash
   curl -I https://startups.internjobs.ai
   ```
   Any HTTP status (e.g. 404 pre-deploy) is fine — the TLS handshake must succeed without warnings.

Acceptance:
- `wrangler pages project list` shows `internjobs-startups`.
- `curl -I https://startups.internjobs.ai` returns a valid TLS handshake (status code irrelevant).

Blocks: 28.5-02 deploy step (the `wrangler pages deploy` invocation needs the project to exist).

### DEFER-28.5-01-D — CF Email Routing domain verify + SPF/DKIM/DMARC

Action:
1. Cloudflare Dashboard → `internjobs.ai` zone → Email → Email Routing → "Add address or domain"
   → add domain: `startups.internjobs.ai`.
2. Follow the DNS checklist that appears:
   - SPF: Cloudflare auto-adds a TXT record on `startups.internjobs.ai` like
     `v=spf1 include:_spf.mx.cloudflare.net ~all`. Confirm it appears in the zone.
   - DKIM: Add the 2 CNAME records Cloudflare shows (each one points to a CF signing host).
   - DMARC: Manually add a TXT record:
     - Name: `_dmarc.startups.internjobs.ai`
     - Value: `v=DMARC1; p=none; rua=mailto:dmarc@startups.internjobs.ai`
3. Wait for all green checkmarks on the CF Email Routing DNS checklist (typically < 10 min).

Acceptance:
- CF Email Routing dashboard shows `startups.internjobs.ai` as "Verified".
- `dig TXT _dmarc.startups.internjobs.ai +short` returns the DMARC string above.

Blocks: 28.5-04 per-startup agent email delivery (without verified domain + DKIM, mail to/from
`*.startups.internjobs.ai` won't pass receiver-side checks and per-founder agent emails fail).

### DEFER-28.5-01-E — Email Routing catch-all → internjobs-startups Worker

Defer until 28.5-04 deploys the Worker.

Action (post-28.5-04):
1. Cloudflare Dashboard → Email → Email Routing → catch-all rule for `startups.internjobs.ai`
   → "Send to a Worker" → select `internjobs-startups`.

Acceptance:
- Sending a test email to `anything@startups.internjobs.ai` reaches the Worker (verify via
  `wrangler tail` on `internjobs-startups`).

Blocks: per-startup agent inbound email path (the whole point of this phase's email infrastructure).

### DEFER-28.5-01-F — Clerk webhook signing secret

Defer until 28.5-05 deploys the `/webhooks/clerk` endpoint to `mcp.internjobs.ai`.

Action (post-28.5-05):
1. Clerk Dashboard → "InternJobs Startups" → Webhooks → "Add endpoint":
   - URL: `https://mcp.internjobs.ai/webhooks/clerk`
   - Events: `user.created` (and optionally `user.updated`, `user.deleted` if 28.5-05 handles them)
2. Copy the signing secret Clerk displays.
3. Save it to Infisical: `/internjobs-ai` env=`prod` key `STARTUPS_CLERK_WEBHOOK_SECRET`.
4. Pipe into the startup Worker:
   ```bash
   wrangler secret put STARTUPS_CLERK_WEBHOOK_SECRET --config apps/startup/wrangler.jsonc
   ```

Acceptance:
- Sending a test webhook from the Clerk dashboard "Send test event" button hits
  `mcp.internjobs.ai/webhooks/clerk` and the handler verifies the signature successfully (200).

Blocks: 28.5-05 webhook end-to-end test.

### DEFER-28.5-01-G — DNS propagation final check

Action (after A-F above):
```bash
dig CNAME clerk.startups.internjobs.ai +short
dig CNAME startups.internjobs.ai +short
dig TXT _dmarc.startups.internjobs.ai +short
dig TXT startups.internjobs.ai +short    # SPF record
```
All four must return non-empty answers. Or run each through https://dnschecker.org.

Acceptance:
- All 4 `dig` commands above return non-empty, sensible answers.

Blocks: nothing directly — this is a sanity check before declaring 28.5 ready for pilot.

---

## How this list closes

When all DEFER-28.5-01-A through G entries are checked off (and any future entries added by later
28.5 plan executions), this file is appended with a "Closed" stamp and the items roll into the
v1.5 phase backlog as completed-pre-cutover line items. Until then, the orchestrator should treat
Phase 28.5 as "code-complete, ops-incomplete" when computing pilot-readiness.

---

## Future additions (placeholder)

Subsequent 28.5-0[2-5] plan executions in this session may append more deferred entries below.
Maintain the same `DEFER-28.5-0N-X` ID format so a single grep can surface every deferred entry.
