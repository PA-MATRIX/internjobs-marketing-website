# Phase 02: Startup Identity, Consent & Roles

**Milestone:** v1.2 — Two-Sided Agent MVP
**Phase:** 02 of 06
**Depends on:** Phase 01 (DNS proxy fixed, CLERK_SECRET_KEY rotated, SmsProvider seam landed)
**Requirements:** STARTUP-01, STARTUP-02, ROLE-01
**Pitfalls in scope:** #12 cross-role auth leak, #13 operator-as-app-flag

---

## Success Criteria (must be TRUE at phase end)

1. A new startup founder signs in via email/password, Google, or Microsoft through the existing Clerk app (`app_38BrRDRKnvbo7vlE2ZZtMc7hFPC`) and lands on `/startup/dashboard`. LinkedIn sign-in is available but not required on the startup landing.
2. Startup onboarding captures company name, website, and `messaging_on_behalf` consent, creating rows in `startups`, `startup_members`, and `startup_consents`.
3. Middleware (`requireStartupAuth`) blocks access to startup agent-adjacent routes (`/startup/roles/new`, `/startup/roles/:id/edit`, `/startup/drafts/*`) when `startup_consents` has no `messaging_on_behalf` row for the startup, returning a redirect to `/startup/onboarding`.
4. Startup founder can create, view, edit, and pause roles (title, description, requirements, status, location, comp_range). Pause sets `status='paused'`; no hard delete exists.

---

## Cross-Phase Contracts (consumed by Phases 04 and 05)

The tables created here are the schema foundation for the agent and operator phases. Do not deviate from the column names below; Phases 04 and 05 query them directly.

- `startups.id`, `startups.name`, `startups.status` — agent uses `status='active'` filter
- `roles.startup_id`, `roles.title`, `roles.description`, `roles.requirements`, `roles.status` — agent drafts against `status='active'` roles
- `startup_consents.startup_id`, `startup_consents.consent_type='messaging_on_behalf'` — operator gate reads this before surfacing drafts

---

## Tasks

### Task 1 — Neon migration: startup identity + roles schema

**Goal:** Create the four new tables and indexes that all subsequent tasks depend on. Apply against the prod Neon database.

**Files:**
- `apps/app/db/migrations/0003_v1_2_startup_identity.sql` (new)

**Concrete change:**

Create the file with the following SQL, exactly:

```sql
-- migration: 0003_v1_2_startup_identity
-- description: startup identity, consent, and roles schema for v1.2

-- ─── Startup identity ────────────────────────────────────────────────────────

create table if not exists startups (
  id           uuid primary key default gen_random_uuid(),
  clerk_org_id text unique,
  name         text not null,
  domain       text,
  website      text,
  status       text not null default 'onboarding',  -- 'onboarding' | 'active' | 'paused'
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table if not exists startup_members (
  id            uuid primary key default gen_random_uuid(),
  startup_id    uuid not null references startups(id) on delete cascade,
  clerk_user_id text not null unique,
  role          text not null default 'founder',  -- 'founder' | 'member'
  email         text not null,
  name          text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists startup_members_startup_idx
  on startup_members(startup_id);

create index if not exists startup_members_clerk_user_id_idx
  on startup_members(clerk_user_id);

-- ─── Consent ─────────────────────────────────────────────────────────────────

create table if not exists startup_consents (
  id                      uuid primary key default gen_random_uuid(),
  startup_id              uuid not null references startups(id) on delete cascade,
  consent_type            text not null,  -- 'messaging_on_behalf'
  granted                 boolean not null,
  granted_by_clerk_user_id text not null,
  created_at              timestamptz not null default now(),
  unique (startup_id, consent_type)
);

-- ─── Roles catalog ───────────────────────────────────────────────────────────

create table if not exists roles (
  id           uuid primary key default gen_random_uuid(),
  startup_id   uuid not null references startups(id) on delete cascade,
  title        text not null,
  description  text not null default '',
  requirements text not null default '',
  status       text not null default 'active',  -- 'active' | 'paused' | 'filled'
  location     text,
  comp_range   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists roles_startup_status_idx
  on roles(startup_id, status);

-- ─── Schema migration record ─────────────────────────────────────────────────

insert into schema_migrations (version) values ('0003_v1_2_startup_identity')
  on conflict do nothing;
```

Apply with: `psql $DATABASE_URL -f apps/app/db/migrations/0003_v1_2_startup_identity.sql`

**Verify:** `psql $DATABASE_URL -c "\dt startups startup_members startup_consents roles"` lists all four tables. `psql $DATABASE_URL -c "\di startup_members_clerk_user_id_idx roles_startup_status_idx"` shows both indexes. `psql $DATABASE_URL -c "select version from schema_migrations where version='0003_v1_2_startup_identity'"` returns one row.

---

### Task 2 — Clerk dashboard: enable non-LinkedIn auth strategies

**Goal:** The existing Clerk app must allow email/password, Google OAuth, and Microsoft OAuth so startup founders can sign in without LinkedIn.

**[USER ACTION]** — Cannot be automated. Steps:

1. Sign in to the Clerk Dashboard at [https://dashboard.clerk.com](https://dashboard.clerk.com) using `rraj@growthpods.io`.
2. Select the **Internjobs.ai** application (`app_38BrRDRKnvbo7vlE2ZZtMc7hFPC`).
3. Navigate to **User & Authentication → Email, Phone, Username**.
   - Enable **Email address** (required field: ON).
   - Enable **Password** authentication: ON.
4. Navigate to **User & Authentication → Social Connections**.
   - Enable **Google** OAuth: ON.
   - Enable **Microsoft** OAuth: ON.
   - Leave **LinkedIn** enabled (do not disable — student flow depends on it).
5. Navigate to **User & Authentication → Restrictions** — confirm "Require LinkedIn to sign in" is NOT enabled (it should not exist as a toggle; this step confirms the sign-in page will present all enabled strategies).

**Verify:** Open the Clerk-hosted sign-in URL (from `config.clerk.signInUrl`) in an incognito window. Confirm you see Google, Microsoft, and email/password options alongside LinkedIn. Do not complete a sign-in yet.

---

### Task 3 — Auth middleware: `requireStartupAuth` and Clerk `userType` wiring

**Goal:** Add `requireStartupAuth` middleware in `auth.mjs` and the `/auth/callback` routing logic that sets `publicMetadata.userType` via the Clerk Backend API. Per PITFALLS #12, authorization must be middleware-level with a negative test, not inside individual handlers. Per PITFALLS #13, `userType` is set via Clerk Backend API only — never from a client-writable database column.

**Files:**
- `apps/app/src/auth.mjs` (modify)
- `apps/app/src/config.mjs` (modify — add `clerk.secretKey` and `clerk.backendApiUrl`)
- `apps/app/src/server.mjs` (modify — update `/auth/callback` to set userType; add startup sign-in URL helper)

**Concrete changes:**

In `config.mjs`, add to the config object alongside existing `clerk.*` fields:
```js
secretKey: env("CLERK_SECRET_KEY", ""),
backendApiUrl: env("CLERK_BACKEND_API_URL", "https://api.clerk.com"),
```

In `auth.mjs`, add after the existing `requireAuth` pattern:

```js
// Returns the normalized auth object only if publicMetadata.userType === 'startup'.
// If authenticated but wrong type, sends 403. If unauthenticated, redirects to sign-in.
export async function requireStartupAuth(req, res, config) {
  const auth = await getAuth(req, config);
  if (!auth?.clerkUserId) {
    redirect(res, getStartupSignInUrl(config));
    return null;
  }
  if (auth.userType !== 'startup') {
    sendJson(res, 403, { error: 'forbidden', reason: 'not_startup' });
    return null;
  }
  return auth;
}

export function getStartupSignInUrl(config) {
  if (config.clerk.signInUrl) {
    const url = new URL(config.clerk.signInUrl, config.appUrl);
    url.searchParams.set('redirect_url', `${config.appUrl}/auth/callback`);
    url.searchParams.set('after_sign_in_url', `${config.appUrl}/startup/onboarding`);
    return url.toString();
  }
  if (config.enableDevAuth) return '/dev/sign-in';
  return '#configuration-needed';
}
```

In `normalizeClaims` (already in `auth.mjs`), add `userType` extraction:
```js
userType: claims.publicMetadata?.userType || claims.userType || '',
```

In `server.mjs`, update the `/auth/callback` handler to detect the sign-in provider and set `publicMetadata.userType` via the Clerk Backend API if it is not already set:

```js
if (req.method === 'GET' && url.pathname === '/auth/callback') {
  const auth = await getAuth(req, config);
  if (!auth?.clerkUserId) {
    redirect(res, getSignInUrl(config));
    return;
  }

  // Set userType only if not already set (idempotent).
  if (!auth.userType && config.clerk.secretKey) {
    const inferredType = auth.provider === 'linkedin' ? 'student' : null;
    // 'startup' type is set after onboarding form submission, not at callback.
    // At callback we only set 'student' for LinkedIn users.
    if (inferredType) {
      await fetch(
        `${config.clerk.backendApiUrl}/v1/users/${auth.clerkUserId}`,
        {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${config.clerk.secretKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ public_metadata: { userType: inferredType } }),
        },
      );
    }
    // Non-LinkedIn sign-in with no userType: route to startup onboarding.
    if (!inferredType) {
      redirect(res, '/startup/onboarding');
      return;
    }
  }

  // Existing students land on /pairing; startups on /startup/dashboard.
  if (auth.userType === 'startup') {
    redirect(res, '/startup/dashboard');
    return;
  }
  redirect(res, '/pairing');
  return;
}
```

In `server.mjs`, update `requireAuth` (the existing function at bottom of file) to remain unchanged (student routes continue using it). Startup routes use the new `requireStartupAuth` imported from `auth.mjs`.

**Negative test to include in manual verification:** Sign in with a startup Clerk session, then `curl -b <startup_cookie> https://app.internjobs.ai/pairing` — must return 302 redirect to sign-in (not 200, not student data). Confirm startup token hitting `/profile` returns 403 or redirect, not student profile HTML.

**Verify:** Dev-mode smoke: set `x-clerk-user-id: test_startup_001` header with no `userType` in claims — `requireStartupAuth` must return 403. Set `userType: 'startup'` in claims — `requireStartupAuth` must return the auth object.

---

### Task 4 — Startup onboarding routes and views

**Goal:** Three startup-facing routes in `server.mjs` and corresponding server-rendered HTML in `views.mjs`. Follows the existing `renderLayout` / `sendHtml` pattern from the student flow. These routes write `startups`, `startup_members`, and `startup_consents` rows.

**Files:**
- `apps/app/src/server.mjs` (modify — add startup routes)
- `apps/app/src/views.mjs` (modify — add startup view functions)
- `apps/app/src/store.mjs` (modify — add startup store methods to `PostgresStore`)

**Concrete changes:**

**`store.mjs` — add to `PostgresStore`:**

```js
// Upsert startup member and parent startup on first sign-in.
async getStartupByClerkUserId(clerkUserId) {
  const { rows } = await this.pool.query(
    `select s.*, sm.role as member_role, sm.id as member_id
     from startups s
     join startup_members sm on sm.startup_id = s.id
     where sm.clerk_user_id = $1 limit 1`,
    [clerkUserId],
  );
  return rows[0] || null;
}

async createStartupWithFounder({ clerkUserId, name, website, email, founderName }) {
  const client = await this.pool.connect();
  try {
    await client.query('begin');
    const { rows: [startup] } = await client.query(
      `insert into startups (name, website, status)
       values ($1, $2, 'onboarding')
       returning *`,
      [name, website || null],
    );
    await client.query(
      `insert into startup_members (startup_id, clerk_user_id, role, email, name)
       values ($1, $2, 'founder', $3, $4)
       on conflict (clerk_user_id) do nothing`,
      [startup.id, clerkUserId, email, founderName || null],
    );
    await client.query('commit');
    return startup;
  } catch (err) {
    await client.query('rollback');
    throw err;
  } finally {
    client.release();
  }
}

async recordStartupConsent({ startupId, consentType, granted, grantedByClerkUserId }) {
  await this.pool.query(
    `insert into startup_consents (startup_id, consent_type, granted, granted_by_clerk_user_id)
     values ($1, $2, $3, $4)
     on conflict (startup_id, consent_type) do update set granted = $3`,
    [startupId, consentType, granted, grantedByClerkUserId],
  );
}

async hasStartupConsent(startupId, consentType) {
  const { rows } = await this.pool.query(
    `select id from startup_consents
     where startup_id = $1 and consent_type = $2 and granted = true limit 1`,
    [startupId, consentType],
  );
  return rows.length > 0;
}

async activateStartup(startupId) {
  await this.pool.query(
    `update startups set status = 'active', updated_at = now() where id = $1`,
    [startupId],
  );
}
```

**`views.mjs` — add:**

```js
export function renderStartupSignIn(config) {
  const signInUrl = getStartupSignInUrl(config);
  return `
    <section class="hero-grid">
      <div>
        <p class="eyebrow">Startup access</p>
        <h1>Reach students through natural messages.</h1>
        <p class="lede">Sign in with email, Google, or Microsoft to set up your company profile and start posting roles.</p>
        <div class="actions">
          <a class="button primary" href="${escapeHtml(signInUrl)}">Get started</a>
        </div>
      </div>
    </section>`;
}

export function renderStartupOnboarding({ auth, startup }) {
  const name = escapeHtml(startup?.name || '');
  const website = escapeHtml(startup?.website || '');
  return `
    <section class="panel narrow">
      <p class="eyebrow">Company profile</p>
      <h1>Tell us about your startup.</h1>
      <form method="POST" action="/startup/onboarding">
        <label>Company name <input name="name" required value="${name}" /></label>
        <label>Website (optional) <input name="website" type="url" value="${website}" /></label>
        <label class="checkbox-row">
          <input type="checkbox" name="consent_messaging" value="1" required />
          I agree that InternJobs.ai will draft messages to students on behalf of my company.
          A human operator reviews every message before it is sent.
        </label>
        <button type="submit" class="button primary">Save and continue</button>
      </form>
    </section>`;
}

export function renderStartupDashboard({ startup, roles }) {
  const rows = roles.map(r => `
    <tr>
      <td>${escapeHtml(r.title)}</td>
      <td>${escapeHtml(r.status)}</td>
      <td>${new Date(r.created_at).toLocaleDateString()}</td>
      <td>
        <a href="/startup/roles/${escapeHtml(r.id)}/edit">Edit</a>
        ${r.status !== 'paused' ? `<form method="POST" action="/startup/roles/${escapeHtml(r.id)}/pause" style="display:inline"><button type="submit">Pause</button></form>` : ''}
      </td>
    </tr>`).join('');
  return `
    <section class="panel">
      <p class="eyebrow">Dashboard</p>
      <h1>${escapeHtml(startup.name)}</h1>
      <p><a class="button primary" href="/startup/roles/new">+ Add role</a></p>
      ${roles.length
        ? `<table><thead><tr><th>Title</th><th>Status</th><th>Created</th><th></th></tr></thead><tbody>${rows}</tbody></table>`
        : '<p class="lede">No roles yet. Add your first role to get started.</p>'}
    </section>`;
}
```

**`server.mjs` — add these route blocks** (before the final 404 handler):

```js
// ─── Startup sign-in landing ─────────────────────────────────────────────────
if (req.method === 'GET' && url.pathname === '/startup') {
  sendHtml(res, 200, renderLayout({ title: 'Startup Access', config, auth: null,
    body: renderStartupSignIn(config) }));
  return;
}

// ─── Startup onboarding ──────────────────────────────────────────────────────
if (req.method === 'GET' && url.pathname === '/startup/onboarding') {
  const auth = await requireStartupAuthOrRedirect(req, res, config);
  if (!auth) return;
  const existing = await store.getStartupByClerkUserId(auth.clerkUserId);
  if (existing?.status === 'active') { redirect(res, '/startup/dashboard'); return; }
  sendHtml(res, 200, renderLayout({ title: 'Company Profile', config, auth,
    body: renderStartupOnboarding({ auth, startup: existing }) }));
  return;
}

if (req.method === 'POST' && url.pathname === '/startup/onboarding') {
  const auth = await requireStartupAuthOrRedirect(req, res, config);
  if (!auth) return;
  const form = await readForm(req);
  if (!form.name || !form.consent_messaging) {
    redirect(res, '/startup/onboarding'); return;
  }
  const startup = await store.createStartupWithFounder({
    clerkUserId: auth.clerkUserId,
    name: String(form.name).slice(0, 200),
    website: String(form.website || '').slice(0, 500),
    email: auth.email,
    founderName: auth.name,
  });
  await store.recordStartupConsent({
    startupId: startup.id,
    consentType: 'messaging_on_behalf',
    granted: true,
    grantedByClerkUserId: auth.clerkUserId,
  });
  // Set userType='startup' in Clerk publicMetadata now that onboarding is complete.
  if (config.clerk.secretKey) {
    await fetch(`${config.clerk.backendApiUrl}/v1/users/${auth.clerkUserId}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${config.clerk.secretKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ public_metadata: { userType: 'startup' } }),
    });
  }
  await store.activateStartup(startup.id);
  redirect(res, '/startup/dashboard');
  return;
}

// ─── Startup dashboard ───────────────────────────────────────────────────────
if (req.method === 'GET' && url.pathname === '/startup/dashboard') {
  const auth = await requireStartupAuth(req, res, config);
  if (!auth) return;
  const startup = await store.getStartupByClerkUserId(auth.clerkUserId);
  if (!startup || startup.status === 'onboarding') { redirect(res, '/startup/onboarding'); return; }
  const hasConsent = await store.hasStartupConsent(startup.id, 'messaging_on_behalf');
  if (!hasConsent) { redirect(res, '/startup/onboarding'); return; }
  const roles = await store.getRolesByStartup(startup.id);
  sendHtml(res, 200, renderLayout({ title: startup.name, config, auth,
    body: renderStartupDashboard({ startup, roles }) }));
  return;
}
```

Note: `requireStartupAuthOrRedirect` is a local helper in `server.mjs` that calls `requireStartupAuth` but redirects to `/startup` (the sign-in page) instead of returning 403 for GET flows. Add it alongside the existing `requireAuth` helper at the bottom of the file.

**Verify:** `curl -s http://localhost:3000/startup` returns HTML containing "Startup Access". After signing in as a non-LinkedIn user in dev mode, `POST /startup/onboarding` with valid form data creates `startups`, `startup_members`, and `startup_consents` rows — verify with `psql $DATABASE_URL -c "select id, name, status from startups"`.

---

### Task 5 — Roles CRUD routes and views

**Goal:** Four routes for create/read/edit/pause of roles. Consent gate enforced: accessing any roles route without `messaging_on_behalf` consent redirects to `/startup/onboarding`. No hard delete — pause sets `status='paused'`.

**Files:**
- `apps/app/src/server.mjs` (modify — add roles routes)
- `apps/app/src/views.mjs` (modify — add role form/detail views)
- `apps/app/src/store.mjs` (modify — add roles store methods)

**Concrete changes:**

**`store.mjs` — add to `PostgresStore`:**

```js
async getRolesByStartup(startupId) {
  const { rows } = await this.pool.query(
    `select * from roles where startup_id = $1 order by created_at desc`,
    [startupId],
  );
  return rows;
}

async getRoleById(roleId, startupId) {
  const { rows } = await this.pool.query(
    `select * from roles where id = $1 and startup_id = $2 limit 1`,
    [roleId, startupId],
  );
  return rows[0] || null;
}

async createRole({ startupId, title, description, requirements, location, compRange }) {
  const { rows } = await this.pool.query(
    `insert into roles (startup_id, title, description, requirements, location, comp_range, status)
     values ($1, $2, $3, $4, $5, $6, 'active') returning *`,
    [startupId, title, description || '', requirements || '', location || null, compRange || null],
  );
  return rows[0];
}

async updateRole(roleId, startupId, { title, description, requirements, location, compRange }) {
  const { rows } = await this.pool.query(
    `update roles set title=$3, description=$4, requirements=$5, location=$6, comp_range=$7,
     updated_at=now()
     where id=$1 and startup_id=$2 returning *`,
    [roleId, startupId, title, description || '', requirements || '', location || null, compRange || null],
  );
  return rows[0] || null;
}

async pauseRole(roleId, startupId) {
  await this.pool.query(
    `update roles set status='paused', updated_at=now() where id=$1 and startup_id=$2`,
    [roleId, startupId],
  );
}
```

**`views.mjs` — add:**

```js
export function renderRoleForm({ role, action }) {
  const v = (field) => escapeHtml(role?.[field] || '');
  return `
    <section class="panel narrow">
      <p class="eyebrow">Role</p>
      <h1>${role?.id ? 'Edit role' : 'New role'}</h1>
      <form method="POST" action="${escapeHtml(action)}">
        <label>Title * <input name="title" required value="${v('title')}" /></label>
        <label>Description * <textarea name="description" required rows="4">${v('description')}</textarea></label>
        <label>Requirements * <textarea name="requirements" required rows="4"
          placeholder="e.g. Python, React, 10hr/week commitment">${v('requirements')}</textarea></label>
        <label>Location <select name="location">
          <option value="">— optional —</option>
          ${['Remote','Onsite','Hybrid'].map(o =>
            `<option value="${o.toLowerCase()}" ${role?.location === o.toLowerCase() ? 'selected' : ''}>${o}</option>`
          ).join('')}
        </select></label>
        <label>Comp range <input name="comp_range" value="${v('comp_range')}" placeholder="e.g. $20-$25/hr" /></label>
        <button type="submit" class="button primary">Save</button>
        <a href="/startup/dashboard">Cancel</a>
      </form>
    </section>`;
}
```

**`server.mjs` — add roles route blocks** (before the final 404 handler):

```js
// Helper: require startup auth + active consent. Used by all roles routes.
async function requireStartupWithConsent(req, res) {
  const auth = await requireStartupAuth(req, res, config);
  if (!auth) return null;
  const startup = await store.getStartupByClerkUserId(auth.clerkUserId);
  if (!startup) { redirect(res, '/startup/onboarding'); return null; }
  const hasConsent = await store.hasStartupConsent(startup.id, 'messaging_on_behalf');
  if (!hasConsent) { redirect(res, '/startup/onboarding'); return null; }
  return { auth, startup };
}

// GET /startup/roles/new
if (req.method === 'GET' && url.pathname === '/startup/roles/new') {
  const ctx = await requireStartupWithConsent(req, res);
  if (!ctx) return;
  sendHtml(res, 200, renderLayout({ title: 'New Role', config, auth: ctx.auth,
    body: renderRoleForm({ role: null, action: '/startup/roles' }) }));
  return;
}

// POST /startup/roles
if (req.method === 'POST' && url.pathname === '/startup/roles') {
  const ctx = await requireStartupWithConsent(req, res);
  if (!ctx) return;
  const form = await readForm(req);
  if (!form.title || !form.description || !form.requirements) {
    redirect(res, '/startup/roles/new'); return;
  }
  await store.createRole({
    startupId: ctx.startup.id,
    title: String(form.title).slice(0, 200),
    description: String(form.description).slice(0, 4000),
    requirements: String(form.requirements).slice(0, 4000),
    location: String(form.location || '').slice(0, 100),
    compRange: String(form.comp_range || '').slice(0, 100),
  });
  redirect(res, '/startup/dashboard');
  return;
}

// GET /startup/roles/:id/edit
if (req.method === 'GET' && /^\/startup\/roles\/[^/]+\/edit$/.test(url.pathname)) {
  const ctx = await requireStartupWithConsent(req, res);
  if (!ctx) return;
  const roleId = url.pathname.split('/')[3];
  const role = await store.getRoleById(roleId, ctx.startup.id);
  if (!role) { sendJson(res, 404, { error: 'not_found' }); return; }
  sendHtml(res, 200, renderLayout({ title: 'Edit Role', config, auth: ctx.auth,
    body: renderRoleForm({ role, action: `/startup/roles/${roleId}` }) }));
  return;
}

// POST /startup/roles/:id
if (req.method === 'POST' && /^\/startup\/roles\/[^/]+$/.test(url.pathname)) {
  const ctx = await requireStartupWithConsent(req, res);
  if (!ctx) return;
  const roleId = url.pathname.split('/')[3];
  const form = await readForm(req);
  if (!form.title || !form.description || !form.requirements) {
    redirect(res, `/startup/roles/${roleId}/edit`); return;
  }
  await store.updateRole(roleId, ctx.startup.id, {
    title: String(form.title).slice(0, 200),
    description: String(form.description).slice(0, 4000),
    requirements: String(form.requirements).slice(0, 4000),
    location: String(form.location || '').slice(0, 100),
    compRange: String(form.comp_range || '').slice(0, 100),
  });
  redirect(res, '/startup/dashboard');
  return;
}

// POST /startup/roles/:id/pause
if (req.method === 'POST' && /^\/startup\/roles\/[^/]+\/pause$/.test(url.pathname)) {
  const ctx = await requireStartupWithConsent(req, res);
  if (!ctx) return;
  const roleId = url.pathname.split('/')[3];
  await store.pauseRole(roleId, ctx.startup.id);
  redirect(res, '/startup/dashboard');
  return;
}
```

**Verify:**
- `GET /startup/roles/new` without consent (no `startup_consents` row) redirects to `/startup/onboarding`.
- `POST /startup/roles` with valid form creates a row in `roles` with `status='active'`.
- `POST /startup/roles/:id/pause` sets `status='paused'` — confirm with `psql $DATABASE_URL -c "select id, title, status from roles"`.
- Attempting `DELETE` on a role (any method) returns 404 — no delete route exists.

---

## Verification

Map to the four success criteria:

**SC-1 — Startup sign-in via email/Google/Microsoft, lands on dashboard:**
1. Navigate to `https://app.internjobs.ai/startup` — see the startup landing with "Get started" button.
2. Click "Get started" — Clerk sign-in page shows Google, Microsoft, and email/password options alongside LinkedIn.
3. Sign in with a Google account (not the LinkedIn-linked account) — lands on `/startup/onboarding`.
4. Complete the onboarding form — lands on `/startup/dashboard` showing the company name.
5. Confirm `psql $DATABASE_URL -c "select clerk_user_id, role from startup_members"` returns the new founder row.

**SC-2 — Onboarding creates rows in startups, startup_members, startup_consents:**
- After step 4 above: `psql $DATABASE_URL -c "select name, status from startups"` shows `status='active'`.
- `psql $DATABASE_URL -c "select consent_type, granted from startup_consents"` shows `consent_type='messaging_on_behalf', granted=true`.

**SC-3 — Middleware blocks agent routes without consent:**
1. In a fresh DB (or after deleting the consent row), sign in as startup.
2. `GET /startup/roles/new` — must redirect to `/startup/onboarding`, not render the form.
3. Confirm in server logs: no `startup_consents` row found → redirect.
4. Sign in as a student account (LinkedIn). `GET /startup/dashboard` — must return 403 (`not_startup`), not the startup dashboard HTML.

**SC-4 — Roles CRUD works end-to-end:**
1. From `/startup/dashboard`, click "+ Add role". Fill in Title, Description, Requirements. Save.
2. Role appears in the dashboard table with `status='active'`.
3. Click "Edit" — form pre-filled. Change title. Save. Confirm updated title in dashboard.
4. Click "Pause" — role row updates to `status='paused'`. Confirm with `psql $DATABASE_URL -c "select title, status from roles"`.
5. No "Delete" button exists in the UI.

---

## Cross-Phase Notes

- The `startup_consents` check in `requireStartupWithConsent` is the same gate Phase 05 (`requireOperatorAuth`) will reference. Phase 05 should reuse the store method `hasStartupConsent` rather than duplicating the query.
- Phase 04 (agent) reads `roles where status='active'` and `startups where status='active'`. These rows must exist before the agent smoke test.
- The `CLERK_SECRET_KEY` env var (`config.clerk.secretKey`) is used in Tasks 3 and 4 to set `publicMetadata.userType` via the Clerk Backend API. This must be present in Infisical `prod`/`/internjobs-ai` before deploying.
