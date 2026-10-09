# Workspace → Parrot — Round 3: GO LIVE + admin seed list

> **From:** Workspace (Nithin). **To:** Parrot team.
> **Re:** your Round-2 reply (2026-07-17) — `iss`, admin seeding, Telnyx BYO, Safari.
> **TL;DR:** JWKS confirmed, **please turn the embed on**. Admin seed list below. Telnyx correction understood and accepted — it's ours, and it's the one thing not ready yet (details below, but it does **not** block the demo).

---

## 1. GO LIVE — please set your `EMBED_*` config

`EMBED_JWKS_URI` = **`https://workspace.internjobs.ai/oidc/jwks`** — **confirmed correct, live, and publicly reachable** (HTTP 200, no IP allowlist, served from Cloudflare's edge, reachable from Fly).

You said the embed route is deployed but **dark** until we confirm. **This is that confirmation — please turn it on.** Nothing else is pending from us for a first load.

- **Key rotation:** we'll publish the new `kid` in the JWKS *before* signing with it (overlap window), as you asked.

## 2. Admin seed list (§7.2)

Seed these two into the `internjobs` org. Both are **canonical, lowercase workspace addresses — byte-identical to the `email` claim** our tokens carry:

| Display name | Email (exactly as it appears in the `email` claim) |
|---|---|
| Ridhi | `ridhi@internjobs.ai` |
| Nithin | `nithin@internjobs.ai` |

Understood that seeding only makes the user *exist*, and that the **`role` claim in our token decides admin vs employee on every load** — our operator gate stays the source of truth. That's exactly the behaviour we want.

## 3. Telnyx — correction accepted, and our honest status (§7.3)

Thanks for the explicit correction; we had built our understanding on the earlier answer, so this is genuinely useful to have straightened out **before** we went looking for numbers on your side.

**Understood: Parrot is BYO-Telnyx per org.** We connect our own Telnyx account (API key → Admin → Integrations → Telnyx), our numbers sync in, and our admins assign them to employees. No per-number cost or headcount question on your side.

**Our status, plainly: we do not have the Telnyx account yet.** It's in procurement on our side (account + numbers + API key), and toll-free verification (BRN) is a multi-day external wait we haven't started. So there will be a window where our people are in Parrot but **not yet dialable**.

**This does not block anything from you.** Our read of your §7.4 is that steps 1–2 (org + admin seeding) are all we need from you, and steps 3–5 (connect Telnyx, assign numbers) are ours and self-serve whenever our account lands. We're happy for admins/employees to see "Not connected" in the dialer in the meantime — a clear not-set-up-yet state is exactly what we want over silent undialability.

**Please still turn the embed on now.** We want to validate silent auth, the admin interface, the employee pane, and the postMessage bridge **without** waiting on Telnyx.

## 4. Token shape — confirmed against your verifier

- **`iss`: `https://workspace.internjobs.ai` — no trailing slash.** Verified: our issuer is a pinned constant, and our live OIDC discovery reports exactly this string. No proxy or normalisation adds a slash.
- **`aud`: `parrot-embed`** ✅
- **`exp`: ~120 s**, RS256, `kid` from our JWKS ✅
- **`jti`: fresh `crypto.randomUUID()` on every mint** — including our ~90 s pre-expiry refresh, so your **single-use** enforcement will never see a replay from us. ✅
- **`sub` + `email` always populated** — guaranteed. `sub` is the employee's stable Clerk user id (never changes for a person); `email` is the canonical lowercased workspace address. Our mint **throws rather than emitting a token missing either**, so it fails closed by construction. ✅
- **`role`**: `"admin"` for anyone our operator gate flags, else `"employee"` — evaluated per mint, so it tracks role changes without a redeploy.
- **`name`** fresh per load; **`phone`** sent for display only (noted that you don't persist it and that it doesn't make a user dialable).

## 5. `frame-ancestors` (§1.4)

**Production only, for now: `https://workspace.internjobs.ai`.** We have no staging/preview origin. If we add one we'll send it — noted that it's a no-deploy config change on your side.

## 6. The three iframe requirements (§2) — all built

- **2.1** `allow="microphone; autoplay"` — on the iframe. ✅
- **2.2** **Never unmounted.** The iframe is mounted once at our app root (sibling of the router outlet) and hidden with `display:none` on navigation — it is deliberately *not* a child of any route component, precisely so React can't unmount it and drop your SIP registration. Token refresh happens via `postMessage`, never by touching `src`. ✅
- **2.3** `parrot:dial` is **pre-fill only** — the user clicks Call inside your pane. No auto-dial expectation. ✅

Origin is checked on every inbound message (we only accept `https://parrot.projecta.ai`).

## 7. Safari (§7.5) — good find, and a straight answer

That's a genuinely useful catch, and we've noted the general lesson (a redirect in HTTP middleware is invisible to any client-side fix).

**Straight answer: we can't test Safari today either — our team is Windows-only.** We'd rather tell you that than let you assume it's covered. What we can say:

- We have been loading the pane in **Chrome Incognito**, which blocks third-party cookies — your stated strong proxy. It loads fine.
- **Our side shouldn't be structurally exposed:** Workspace is the *parent* frame, not embedded, so our Clerk cookie handshake never runs in a third-party context. The cookie-free bearer approach in your `/embed` is what protects the inner frame — which is why option B was the right call, as you say.
- We'll get a real Safari check via an iOS device / a Mac we have access to, and report back. Not treating it as resolved until we do.

## 8. Noted

Your Socket.IO handshake item (§5) — understood as **pre-existing and your v2 hardening**, not introduced by the embed and not a blocker. On the record, thanks for flagging it rather than letting us find it.

---

## What we need from you

1. **Turn the embed on** (set `EMBED_*` — JWKS URI confirmed in §1). ← the only thing blocking a first working demo
2. **Seed the two admins** in §2.

Everything else on our side is built and deployed. Once you flip it on, we'll load the pane and report back immediately.
