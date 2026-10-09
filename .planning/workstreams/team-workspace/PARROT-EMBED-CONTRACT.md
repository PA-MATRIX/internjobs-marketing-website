# Parrot ⇄ Workspace Embed Contract (Phase 32 / W1)

> **Audience:** the Parrot developer. **Owner:** Workspace team (Nithin).
> **Status:** proposed — review before implementation on either side.
> **Auth decision:** signed embed-JWT (option **B**). No OIDC. See
> `PARROT-EMBED-SPEC.md` for the higher-level architecture.

**Terminology:** *Workspace* = our app at `https://workspace.internjobs.ai`
(code in `apps/parrot/`). *Parrot* = your dialer / phone+SMS product at
`https://parrot.projecta.ai`. Workspace embeds Parrot's **internjobs tenant**
as a single "Parrot" pane via `<iframe>`; the employee is already signed into
Workspace and is silently authenticated into Parrot via a short-lived signed
token (no second login).

This doc defines the **things we need from you**, plus the message contract both
sides implement.

---

## 1. Trimmed "embed" route (Parrot builds)

We need a chromeless embed view of the internjobs tenant at a stable URL —
call it `https://parrot.projecta.ai/embed` (final URL → our `PARROT_EMBED_URL`
config). It renders the **same UI as the normal Parrot app** (per the reference
screenshot) with exactly these differences, because those surfaces already live
elsewhere in Workspace:

| Area | Element | In embed? |
|------|---------|-----------|
| Left sidebar | Dialer, Campaigns, All Contacts, Groups, SMS Inbox, Comm Logs, My Stats, Practice | ✅ keep |
| Left sidebar | **Email Inbox** | ❌ **hide** (email lives in Workspace's own header) |
| Center | Dialpad + "Ready" status | ✅ keep |
| Right pane | **Calls**, **Messages** tabs | ✅ keep |
| Right pane | **Emails** tab | ❌ **hide** |
| Sidebar bottom | User details — **name + phone number** | ✅ keep |
| Sidebar bottom | **Sign Out** button | ❌ **hide** (session is owned by Workspace) |

Everything else stays visually identical to the current app.

### Two interfaces: admin vs employee

Parrot already has a separate **admin** interface and **employee** interface.
The embed must render the right one based on the `role` claim in the token
(§2): `role: "admin"` → Parrot admin interface; `role: "employee"` → the
employee dialer view. **The same 3 trims above apply to both interfaces.**
(Workspace's admins are the same people who add employees — see §2.)

### Framing headers (required)

The embed route **must** allow being framed by Workspace:

- `Content-Security-Policy: frame-ancestors https://workspace.internjobs.ai`
  (add staging/preview origins on request — we'll send the list).
- **Do NOT** send `X-Frame-Options: DENY` (or `SAMEORIGIN`) on the embed route.
- Any cookies Parrot sets inside the iframe must be
  `SameSite=None; Secure` (ideally `Partitioned`/CHIPS) — otherwise modern
  third-party-cookie blocking will drop them. (Simplest is to avoid relying on
  cookies at all and hold the session from the JWT below in memory.)

---

## 2. Auth — signed embed-JWT (RS256)

No OIDC. On each embed load, Workspace mints a **short-lived RS256 JWT** and
passes it to the iframe. Parrot verifies the signature with **our public key**,
reads the claims, maps the employee to their internjobs-tenant user, and
establishes its own in-iframe session. Because the token is signed with a
private key only Workspace holds, Parrot can trust it without a login round-trip.

### Delivery

Workspace loads the iframe as:

```
https://parrot.projecta.ai/embed?token=<JWT>
```

- The token is **short-lived (≈120 s)** — it authenticates the initial load
  only; Parrot mints its own session from it.
- Before expiry on long sessions, Workspace can hand Parrot a fresh token via
  `postMessage` `{ type: "parrot:token", token }` (see §3). v1 may ignore this
  and simply reload with a new token.

### JWT shape

```jsonc
// Header
{ "alg": "RS256", "typ": "JWT", "kid": "<key id>" }

// Claims
{
  "iss":   "https://workspace.internjobs.ai",
  "aud":   "parrot-embed",
  "sub":   "<stable employee id>",     // unique per employee, stable across logins
  "email": "<employee workspace email>",
  "name":  "<display name>",
  "phone": "<employee phone, E.164 e.g. +14125574819>",
  "role":  "admin" | "employee",       // which Parrot interface to render
  "iat":   1710000000,
  "exp":   1710000120,                 // iat + 120s
  "jti":   "<random>"                  // optional replay guard
}
```

- **Map the tenant user by `sub`** (preferred — stable), falling back to `phone`
  or `email` if your tenant keys on those. Tell us which you key on and we'll
  guarantee it's populated.
- **`role`** decides admin vs employee interface (§1). `admin` = a Workspace
  operator (the small set of people who can add employees); everyone else is
  `employee`. Workspace is the source of truth for this — trust the claim.
- Reject a token if: signature invalid, `aud !== "parrot-embed"`,
  `iss` mismatch, or `exp` is past (allow ≤60 s clock skew).

### Key exchange (nothing secret leaves Workspace)

- Workspace signs with an **RS256 private key we hold**.
- You verify with the **matching public key**, available two ways — pick one:
  1. **JWKS URL** (recommended): fetch + cache
     `https://workspace.internjobs.ai/oidc/jwks`, match on `kid`.
  2. **Static public key**: we hand you the PEM/JWK out-of-band.
- No shared secret to store. (If you can only do HS256, tell us — we'll agree a
  shared secret via Infisical instead, but RS256 is preferred so only Workspace
  can mint tokens.)

---

## 3. `postMessage` event contract (both sides build)

All messages are `window.postMessage` with an **origin check on both ends**:
- Parrot → Workspace: target origin `https://workspace.internjobs.ai`.
- Workspace → Parrot: target origin `https://parrot.projecta.ai`.
- Every received message must verify `event.origin` before acting.

### Parrot → Workspace

| Message | When | Workspace does |
|---------|------|----------------|
| `{ type: "parrot:ready" }` | embed authed + rendered | hides loading state |
| `{ type: "parrot:badge", calls: number, messages: number }` | on load + whenever unread/missed counts change | renders **one** combined badge on the single Parrot nav icon — number + tiny call/message glyphs (e.g. `2☎ 1✉`). Send `0/0` to clear. |
| `{ type: "parrot:incoming-call", from: string, name?: string }` | inbound call ringing | plays a ringtone + shows an incoming-call banner |
| `{ type: "parrot:call-ended" }` | call answered/declined/ended | stops the ringtone/banner |

### Workspace → Parrot

| Message | When | Parrot does |
|---------|------|-------------|
| `{ type: "parrot:dial", number: string }` | user hits **Dial** on a phone number shared elsewhere in Workspace (e.g. in chat) | switch to Dialer, pre-fill + dial `number` (E.164) |
| `{ type: "parrot:open-contact", id: string }` | (optional v1) open a contact | open that contact |
| `{ type: "parrot:token", token: string }` | (optional) token refresh before expiry | swap in the new session token |

### Notes

- **Combined badge:** there is a **single** "Parrot" icon in Workspace (we're
  merging today's separate Phone + SMS icons). So `parrot:badge` carries both
  counts and we render them together.
- **Ringtone:** Workspace plays the ring on `parrot:incoming-call`. Apple's
  default ringtone is proprietary, so we'll use a close royalty-free equivalent —
  no action needed from you beyond firing the event promptly.
- **Click-to-dial:** the Copy/Dial menu on a shared contact lives in Workspace;
  "Dial" focuses the Parrot pane and sends `parrot:dial`. You only need to honor
  `parrot:dial`.

---

## 4. What each side owns

**Parrot dev builds:** the `/embed` trimmed route (§1) with admin/employee
interface selection by `role`, framing headers, JWT verification (§2), and the
`postMessage` handlers marked "Parrot does" (§3).

**Workspace builds:** the single Parrot pane + iframe, the JWT mint (with the
`role` claim from our operator gate) + key publishing (§2), the combined nav
badge, incoming-call ringtone, and the chat "Copy / Dial" affordance that emits
`parrot:dial` (§3).

## 5. Open items to confirm back to us

1. Do you key the tenant user on `sub`, `phone`, or `email`? (We'll guarantee it.)
2. RS256-via-JWKS OK, or do you need a static key / HS256?
3. Final embed URL for `PARROT_EMBED_URL`.
4. Any additional origins (staging/preview) to add to `frame-ancestors`.
5. Does the admin interface need any employees/tenant set-up done first (i.e.
   should the Workspace admins land in Parrot admin before employees are
   onboarded)? If so, describe the ordering.
