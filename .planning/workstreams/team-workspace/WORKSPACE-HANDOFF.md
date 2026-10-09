# Parrot ⇄ Workspace Embed — Reply & Handoff (Parrot → Nithin)

> **From:** Parrot team. **To:** Workspace team (Nithin).
> **Re:** `PARROT-EMBED-CONTRACT.md` (Phase 32 / W1) — signed embed-JWT (option **B**).
> **Status:** answers below are decided and locked on our side. Three items marked
> **needs-from-you** are the only things blocking a first working demo.

This doc closes out your §5 open items, then flags three things the contract does
not mention that will silently break the integration **on Workspace's side** if not
handled. It ends with the message contract as we're implementing it, so you can diff
it against §3.

---

## 1. Answers to your five open items (contract §5)

### 1.1 — Do you key the tenant user on `sub`, `phone`, or `email`?

**We key on `sub`**, stored in a new `users.workspace_sub` column (unique).

The wrinkle: we can't know a `sub` before we first see it. So **on first sight we
link by `email`** (case-insensitive) to the matching user already provisioned in the
`internjobs` tenant, and stamp `workspace_sub` onto that row. Every subsequent load
matches on `sub` directly.

**What we need from you:** guarantee that **both `sub` and `email` are always
populated** on every token. `sub` must be stable per employee across logins; `email`
must be the same address we'll have provisioned the user under.

`name` and `phone` are read fresh from the claim on every load to keep our display
copy current. **Note:** `phone` is used for display only — in v1 it is **not persisted
server-side**. Parrot's phone-number storage is reserved for Telnyx-provisioned dialer
numbers (the number a user calls *from*), which is a separate assignment step (see 1.5),
not a contact field. So a `phone` claim will show in the sidebar footer but does not by
itself make the user dialable.

### 1.2 — RS256-via-JWKS OK, or do you need a static key / HS256?

**RS256-via-JWKS — yes, exactly as proposed.** No shared secret. We fetch and cache
your JWKS and match on `kid`.

- **JWKS URI we're configured to fetch:** `EMBED_JWKS_URI` — currently set to
  `https://workspace.internjobs.ai/oidc/jwks` (the URL from §2 of your contract).
  **needs-from-you:** confirm this is the correct, publicly reachable JWKS endpoint,
  or send the corrected URL and we'll repoint the one env var.
- Our servers run on Fly.io, so the endpoint must be reachable from the public
  internet (no IP allowlist).
- Please **rotate keys with an overlap window** — publish the new `kid` in the JWKS
  before you start signing with it, so in-flight tokens still verify.

We reject a token if: signature invalid, `aud !== "parrot-embed"`, `iss` mismatch,
or `exp` past (we allow ≤60 s clock skew, per your §2). `jti` is honored as a replay
guard when present.

### 1.3 — Final embed URL for `PARROT_EMBED_URL`

`https://parrot.projecta.ai/embed?token=<JWT>`

That is the value for your `PARROT_EMBED_URL` config. The token is the short-lived
(~120 s) RS256 JWT; we mint our own in-memory session from it on load.

### 1.4 — Additional origins for `frame-ancestors`

Today we're configured for `https://workspace.internjobs.ai`. **needs-from-you:**
send the full staging/preview origin list.

On our side this is a **single space-separated env var** (`EMBED_FRAME_ANCESTORS`),
so adding origins later is a config change with **no code deploy**. Send them whenever
you have them; they don't block the first demo against production Workspace.

### 1.5 — Does the admin interface need tenant setup done first?

**Yes — and this is the most important item in this reply.**

In Parrot, **creating a user does not make them able to call.** Creating the user row
and assigning a number are two separate steps: a user must be given SIP credentials, a
Telnyx connection, and a phone number before they can place or receive a single call.
An auto-created user would land in the app **silently undialable**, which is a worse
experience than a clear "not set up yet" message.

Therefore, **an unknown `sub`/`email` is rejected with a 403 and a "your Parrot
account isn't set up yet — ask your admin" panel. No just-in-time provisioning.**

**Required setup ordering:**

1. **Parrot** creates and seeds the `internjobs` org (one-time, on our side).
2. **Workspace's admin-role users are provisioned into it first.** They arrive with
   `role: "admin"` and land in the Parrot admin interface.
3. **Those admins add employees and assign each a number.** Only after an employee has
   been added *and* given a number will that employee's embed session work.

So: admins first, then admins onboard + number their employees, then employee embeds
go live. An employee who loads the embed before step 3 gets the "ask your admin" panel,
not an error.

---

## 2. Three things the contract omits (Workspace's action items)

These are not in `PARROT-EMBED-CONTRACT.md` and are **on Workspace's side**. Each will
fail *silently* — no error banner — so they're easy to miss until a user reports "calls
don't work."

### 2.1 — The `<iframe>` must carry `allow="microphone; autoplay"`

```html
<iframe src="https://parrot.projecta.ai/embed?token=<JWT>"
        allow="microphone; autoplay"></iframe>
```

- **Without `microphone`:** the Telnyx WebRTC SDK's `getUserMedia` call is denied by
  the browser's permissions policy. **Every call fails with no visible error** — the
  dial just does nothing.
- **Without `autoplay`:** remote call audio and the ringtone may be blocked from
  playing. The call may connect but the user hears nothing.

### 2.2 — The iframe must stay mounted (never unmount on navigation)

Hide the Parrot pane with `display:none` when the user navigates away — **never
unmount it.**

Parrot's inbound-call path is a **Telnyx SIP registration held live by the browser
SDK inside the iframe.** Unmounting the iframe (e.g. React unmounting the component on
route change) **drops that registration.** The consequences until the iframe reloads
and re-registers:

- No inbound ring.
- No `parrot:incoming-call` event (so no ringtone/banner on your side).
- No badge updates.

Keep it mounted, toggle visibility only.

### 2.3 — `parrot:dial` cannot reliably auto-dial

When you send `parrot:dial`, we **switch to the Dialer and pre-fill the number**, but
**v1 does not auto-place the call.** The user must click "Call" once inside the Parrot
pane.

Why: the triggering click happened in the **parent** frame, so the iframe has no
**user activation** of its own. Browsers require a user gesture *inside the frame* to
grant/confirm microphone access and start media — a programmatic dial from a parent-frame
click may be blocked. Rather than have it work in some browsers and silently fail in
others, v1 is deterministic: pre-fill + one in-pane click.

(This mirrors existing Parrot behavior — the dialer's pre-fill-from-query-param path
pre-fills but does not auto-dial.)

---

## 3. What each side owns (mirror of contract §4)

| Parrot builds | Workspace builds |
|---|---|
| `/embed` trimmed route (Email Inbox nav, Emails tab, Sign Out removed) with admin/employee interface selection by `role` | The single "Parrot" pane + `<iframe>` (with `allow="microphone; autoplay"`, kept mounted) |
| JWT verification against your JWKS (RS256, `aud`/`iss`/`exp` checks, `jti` replay guard) | The 120 s RS256 JWT mint (with `role` from your operator gate) + JWKS publishing / key rotation |
| Cookie-free in-memory session minted from the verified token | Fresh-token handoff before expiry on long sessions (optional in v1) |
| `parrot:ready` / `parrot:badge` / `parrot:incoming-call` / `parrot:call-ended` emitters | Combined nav badge render, incoming-call ringtone, chat "Copy / Dial" affordance emitting `parrot:dial` |
| Honoring `parrot:dial` (pre-fill) and `parrot:open-contact` | Origin check on every received message |
| CSP `frame-ancestors` header, no `X-Frame-Options` | The staging/preview origin list to add to `frame-ancestors` |

---

## 4. `postMessage` event contract (as we're implementing it)

Every message uses `window.postMessage` with an **origin check on both ends**:
Parrot → Workspace targets `https://workspace.internjobs.ai`; Workspace → Parrot
targets `https://parrot.projecta.ai`. We verify `event.origin` before acting on any
inbound message.

### Parrot → Workspace

| Message | When we fire it | You do |
|---|---|---|
| `{ type: "parrot:ready" }` | embed authed + rendered | hide loading state |
| `{ type: "parrot:badge", calls: number, messages: number }` | on load + whenever unread/missed counts change | render the one combined badge; send `0/0` to clear |
| `{ type: "parrot:incoming-call", from: string, name?: string }` | inbound call ringing (SIP INVITE hits the browser SDK) | play ringtone + show incoming-call banner |
| `{ type: "parrot:call-ended" }` | call answered / declined / ended | stop ringtone/banner |

### Workspace → Parrot

| Message | When you send it | We do |
|---|---|---|
| `{ type: "parrot:dial", number: string }` | user hits Dial on a number shared elsewhere in Workspace | switch to Dialer, pre-fill `number` (E.164) — **one in-pane click needed to place the call** (see 2.3) |
| `{ type: "parrot:open-contact", id: string }` | (optional v1) open a contact | open that contact |
| `{ type: "parrot:token", token: string }` | (optional) token refresh before expiry | swap in the new session token |

---

## 5. Security posture note for v1 (on the record)

One pre-existing item you should know about, since we're exposing this surface to a
partner: **Parrot's Socket.IO real-time handshake is currently unauthenticated.** The
client emits `join {userId}` and the server joins that room on trust — so anyone who can
guess a `userId` could subscribe to that user's call/message events.

This is **pre-existing** — the embed does not introduce or worsen it. We're treating
handshake authentication (derive `userId` server-side from the same bearer) as a **v2
hardening item, not a blocker** for this integration. Flagging it here so it's on the
record and not a surprise later.

---

## 6. What we need back from you (summary)

1. **Confirm the JWKS URI** — is `https://workspace.internjobs.ai/oidc/jwks` correct
   and publicly reachable? (1.2)
2. **Staging/preview origins** for `frame-ancestors`, whenever you have them — no code
   deploy on our side to add them. (1.4)
3. **Guarantee `sub` + `email` always populated** on every token. (1.1)
4. Acknowledge the three iframe requirements in §2 (`allow` attr, stay-mounted,
   no-auto-dial).

Everything else is decided on our side and building now.
