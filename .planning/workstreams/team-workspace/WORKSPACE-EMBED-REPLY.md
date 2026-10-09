# Workspace → Parrot — Reply to your handoff (embed, Phase 32 / W1)

> **From:** Workspace (Nithin). **To:** Parrot team.
> **Re:** your `WORKSPACE-HANDOFF.md` reply on the signed embed-JWT (option B).
> Thanks — this closed all five items cleanly. Below: your 4 asks answered, then 2 questions back, then a flow confirmation.

## Your 4 asks — answered

**1. JWKS URI — confirmed correct + publicly reachable ✅**
`https://workspace.internjobs.ai/oidc/jwks` is correct. It's live (HTTP 200), served by a Cloudflare Worker — **public, no IP allowlist**, reachable from Fly. It's the same RS256 JWKS our Mattermost OIDC bridge already publishes; Parrot is just a second consumer of it.
- **Key rotation:** we'll publish the new `kid` in the JWKS **before** we start signing with it (overlap window), so in-flight tokens keep verifying — as you asked.

**2. Staging/preview origins for `frame-ancestors`**
For v1 we only have **production** `https://workspace.internjobs.ai`. We have **no separate staging/preview origin** right now. If we add one we'll send it (you said it's a no-deploy config change on your side). So for now: just the one origin.

**3. `sub` + `email` always populated — guaranteed ✅**
Every embed token we mint will always carry:
- `sub` — the employee's **Clerk user id**, stable per employee across logins (never changes for a given person).
- `email` — the employee's provisioned Workspace address (the same one you'll have them under). Lowercased, canonical.
- `name` (fresh each load), `phone` (display-only, per your note), and `role` (see below).
We never mint a token missing `sub` or `email`.

**4. The three iframe requirements — acknowledged, building accordingly ✅**
- (2.1) The `<iframe>` will carry `allow="microphone; autoplay"`.
- (2.2) The iframe **stays mounted** — hidden with `display:none` on navigation, **never unmounted** — so the SIP registration isn't dropped.
- (2.3) `parrot:dial` = **pre-fill only**; the user clicks "Call" once inside the pane. No auto-dial expectation.

## Token details we'll sign (so we're aligned)
- `iss`: **`https://workspace.internjobs.ai`** — please confirm this is the exact `iss` string you're configured to expect (you reject on `iss` mismatch).
- `aud`: `parrot-embed`
- `exp`: ~120 s; `jti`: included (replay guard); alg **RS256**, `kid` from our JWKS.
- `role`: `"admin"` for Workspace operators, else `"employee"` (see next section).
- Embed URL we'll load: `https://parrot.projecta.ai/embed?token=<JWT>`.

## 2 questions back to you

**A. Initial admin provisioning — how do our admins get into the `internjobs` org the first time?**
You said (1.5) there's **no JIT provisioning** — an unknown `sub`/`email` gets the "ask your admin" 403. But our admins have to get in *somehow* first. How do you want that seeded?
- Option (a): we send you a **list of admin emails**, you seed them into the org as `role: admin`.
- Option (b): you expose a **provisioning API/endpoint** we call.
Our "admins" = whoever our existing operator gate (`isOperator`) flags — today that's Ridhi plus anyone with the Clerk `operator`/`admin`/`ceo` role or on our operator allowlist. We can hand you that list whenever — just tell us the format.

**B. Telnyx numbers — provisioned on your side, right?**
Confirming: the employee dialer numbers (the number a user calls *from*) are **Telnyx numbers provisioned on Parrot's side**, which admins assign from within your admin UI — **we don't supply Telnyx numbers**. (Flagging because we have separate, unrelated Telnyx work on the startup side; want to be sure there's no crossed wires.)

## Flow confirmation (please sanity-check)
1. Parrot seeds the `internjobs` org (one-time, your side).
2. Our **admins** are provisioned first → their token carries `role: admin` → they land in your **admin interface**.
3. Those admins **add employees + assign each a Telnyx number** in your admin UI.
4. Only then does that employee's embed session work; before that they see "ask your admin" (403), not an error.
Is that exactly right?

## Noted
Your Socket.IO handshake-auth item (§5) — understood as **pre-existing + your v2 hardening**, not a blocker for this integration. On the record, thanks for flagging.

---
**Bottom line on our side:** JWKS is already live, the mint reuses our existing RS256 signing key, and we're building the pane + JWT mint + postMessage bridge now. The only things gating a first *live-call* demo are your two provisioning answers above + you having our admins seeded.
