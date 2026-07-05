# Parrot Embed Spec — SMS/phone pane (Phase 32 / W1)

> **Terminology:** *Workspace* = our app at `workspace.internjobs.ai` (code lives in `apps/parrot/`
> — legacy dir name; the product is **Workspace**). **Parrot** = the *separate* dialer / phone+SMS
> product (built by our own developer) that provisions an **internjobs tenant** we embed. We do NOT
> build a dialer — the SMS/phone pane is a thin, authenticated **embed** of Parrot, matching the
> WORKSPACE-TRUE-INTEGRATION pattern (Mail→Agent-Inbox, Chat→Mattermost, **SMS/phone→Parrot**).

## Goal

Render Parrot's internjobs tenant as the SMS + phone panes inside Workspace — one embedded surface,
seamless SSO, no rebuilt dialer UX. Since the Parrot developer is ours, framing + auth are things we
coordinate directly (framing already confirmed OK).

## Architecture

`<iframe>` embed. Parrot serves the internjobs tenant; Workspace hosts it in the SMS/phone pane. The
employee is silently authenticated via our existing Workspace **OIDC bridge** (the same `/oidc/*`
provider Mattermost already uses — Parrot becomes a second OIDC client).

```
Workspace pane  ──iframe src──▶  https://<parrot-tenant>/embed
     ▲                                   │
     │ postMessage (badges, deep-links)  │ OIDC redirect (silent; already logged into Workspace)
     └───────────────────────────────────┘
```

## What Parrot provides (their dev = ours)

1. **Framing** — `Content-Security-Policy: frame-ancestors https://workspace.internjobs.ai` on the
   embed route (add staging/preview origins as needed). No `X-Frame-Options: DENY`. ✅ confirmed doable.
2. **Embeddable route** — a chromeless/"embed" view of the internjobs tenant (ideally without Parrot's
   own top-level nav/login chrome, so it reads as a native pane). URL → `PARROT_EMBED_URL`.
3. **OIDC login** — Parrot registers as an OIDC **client** of the Workspace bridge:
   - issuer/authorize/token/userinfo = Workspace `/oidc/*`
   - `client_id` + `client_secret` (we mint), `redirect_uri` = Parrot's callback
   - identity = OIDC `sub` (the internjobs employee); Parrot maps `sub` → its tenant user.
   - *Fallback if OIDC is heavy:* a short-lived signed embed JWT we mint and pass in the iframe URL,
     which Parrot verifies against a shared key.
4. **Cross-origin session** — iframe cookies set `SameSite=None; Secure` (+ `Partitioned`/CHIPS so
   modern third-party-cookie blocking doesn't break the session); or token-based session (no 3p cookie).
5. **postMessage events (optional, v1-nice-to-have)** — origin-checked messages:
   - Parrot → Workspace: `{type:'parrot:unread', count}`, `{type:'parrot:ringing', from}`, `{type:'parrot:call-ended'}`
   - Workspace → Parrot: `{type:'parrot:dial', number}`, `{type:'parrot:open-contact', id}`

## What Workspace builds (our side — small, integration-only)

1. SMS + phone panes render the Parrot `<iframe>` (replace any placeholder/built UI). No dialer UX.
2. Add `frame-src https://<parrot-domain>` to the Workspace CSP so the browser permits the embed.
3. Extend the existing `/oidc/*` bridge to register **Parrot** as a second client (mirror the Mattermost
   client setup).
4. `postMessage` handler: badge missed-call/unread counts into Workspace nav; deep-link `dial`/`open-contact`.
5. Config → Infisical (`prod` / `/internjobs-ai`): `PARROT_EMBED_URL`, `PARROT_OIDC_CLIENT_ID/SECRET`
   (or the embed-JWT signing key). No secrets in repo/chat.

## Security

- Origin-check every `postMessage` (both directions) against the known Parrot/Workspace origins.
- Scope the OIDC client narrowly; rotate the client secret via Infisical.
- Per-employee identity is the OIDC `sub`; Parrot must isolate the internjobs tenant.

## Confirm with the Parrot developer before Phase 32 build

1. Is there (or can they add) a **chromeless embed route** for the internjobs tenant?
2. **OIDC client** against our Workspace bridge, or the **signed-embed-JWT** fallback?
3. Which **events** does v1 need (unread/missed-call badge? incoming-call ring? click-to-dial from Workspace)?
