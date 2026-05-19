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
