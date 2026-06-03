# Parrot — InternJobs.ai internal employee workspace

Parrot is the single signed-in surface at `workspace.internjobs.ai` that
unifies **Inbox + Chat + Meetings** for the InternJobs internal team (~50–60
employees). Same way agentic-inbox is the email surface for the `maya@`
agent, Parrot is the email + chat + meetings surface for every InternJobs
employee.

- **Inbox** — per-employee `name@internjobs.ai` mailbox stored in a
  Cloudflare Durable Object (forked from the agentic-inbox `MailboxDO`
  pattern; see `workers/durableObject/`).
- **Chat** — self-hosted Mattermost Team Edition (deployed in Wave 2).
- **Meetings** — Daily.co flat-rate plan, embedded (Wave 3).

Auth runs through a **second Clerk instance**, kept SSO-isolated from
the student/startup Clerk that powers `app.internjobs.ai`. Employees
sign in at `accounts.workspace.internjobs.ai`; the worker verifies the
Clerk session JWT via `jose` + JWKS on every request.

## Status

**Wave 1 (this commit batch)**: scaffolding only — the worker, the
`EmployeeMailboxDO`, the three-pane React shell, and stubs for the
Mattermost / Daily.co / cross-pane endpoints. Reply/forward,
inbound apex mail routing, the Mattermost deploy, and the Daily.co
account live in subsequent waves. Full plan and per-wave breakdown
in [`.planning/milestones/v1.2-two-sided-agent-mvp/phase-10-parrot-employee-workspace/PLAN.md`](../../.planning/milestones/v1.2-two-sided-agent-mvp/phase-10-parrot-employee-workspace/PLAN.md).

## Local dev

```sh
cd apps/parrot
npm install --legacy-peer-deps
cp .dev.vars.example .dev.vars   # fill in PARROT_CLERK_* from Infisical
npm run dev
```

In dev mode, you can bypass Clerk with header injection so smoke tests
work without a real session:

```sh
curl -H "x-parrot-dev-employee: emp_demo" \
     -H "x-parrot-dev-email: demo@internjobs.ai" \
     -H "x-parrot-dev-name: Demo Employee" \
     http://localhost:5173/api/me
```

Production deploys require `PARROT_CLERK_PUBLISHABLE_KEY`,
`PARROT_CLERK_SECRET_KEY`, and `PARROT_CLERK_JWKS_URL` set via
`wrangler secret put`. Source values live in Infisical at
`/internjobs-ai/parrot/*`.

## Meetings (Daily.co theme)

The Daily.co Prebuilt is embedded in `app/components/MeetingsPane.tsx` as a
plain `<iframe src={roomUrl}>`. There is **no code path** for theming the
iframe — the code does not call `DailyIframe.createFrame()` and passes no
`theme` config. The `@daily-co/daily-js` package is present in dependencies
but is not used for the embed.

**The Campus Aurora palette must therefore be set in the
`console.daily.co` dashboard, not in this repo** (DAILY-THEME-01):

1. `console.daily.co` → "internjobs" domain → Rooms → Default room settings → Appearance
2. Accent color: `#7C3AED` (Campus Aurora violet)
3. Background color: `#FAFAFA`
4. Text/border palette: "slate" (or closest equivalent)
5. Save the domain-level defaults (applies to all rooms, including `parrot-*`)

These defaults propagate to every embedded room — no deploy is required and
no code change can override them.

## Testing

The Workspace Worker has a Vitest smoke-test suite that validates route
mounting, `/healthz` shape, and basic happy-path responses for each route file.

### Run locally

```sh
cd apps/parrot
npm install --legacy-peer-deps
npm test
```

Tests live in `apps/parrot/workers/tests/`. They run against the Hono `app`
object directly (no real Cloudflare runtime required) with external fetches
mocked via `vi.stubGlobal`. A small `cloudflare:workers` stub
(`workers/tests/__mocks__/cloudflare-workers.ts`, aliased in `vitest.config.ts`)
lets plain Node Vitest load the worker without `ERR_MODULE_NOT_FOUND`.

### Auth in tests

Tests use the inner Hono `app` (from `workers/index.ts`), not the outer
Clerk-wrapped entry point (`workers/app.ts`). Auth-gated routes therefore
return 401 by design — the smoke tests assert "route is mounted and not
crashing" rather than full end-to-end auth. The dev-bypass
(`X-Parrot-Dev-Employee`) also lives in the outer wrapper, so it does not
populate `c.var.employee` for these inner-app tests. The OIDC discovery
endpoint (`/oidc/.well-known/openid-configuration`) is public and returns 200.

### What is tested

| File | Coverage |
|------|----------|
| `workers/tests/healthz.test.ts` | WSTEST-01 — `/healthz` 6-key shape + ok=true/false logic |
| `workers/tests/routes/admin-employees.test.ts` | WSTEST-02 — admin route mount + auth gate |
| `workers/tests/routes/oidc.test.ts` | WSTEST-02 — OIDC discovery endpoint shape |
| `workers/tests/routes/ops-safety.test.ts` | WSTEST-02 — ops-safety route reaches handler |
| `workers/tests/routes/agent.test.ts` | WSTEST-02 — agent tools route returns array |
| `workers/tests/routes/reply-forward.test.ts` | WSTEST-02 — compose/reply input validation |

### CI

Tests run automatically on push to `rrr/v1.4/team-workspace-27` via
`.github/workflows/parrot-smoke.yml`.
