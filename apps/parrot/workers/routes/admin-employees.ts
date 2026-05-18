// v1.2 Phase 10 Wave 2b: /api/admin/employees — invite / list / disable.
//
// End-to-end flow for an invite:
//   1) Operator POSTs { name, personalEmail } with their Clerk session.
//   2) We derive workspaceEmail = slugify(name) + "@internjobs.ai".
//   3) Create a Clerk user with that email + parsed first/last name.
//   4) Add a CF Email Routing rule forwarding that address to the
//      Parrot Worker (apps/parrot — handler in workers/app.ts:email()).
//   5) Send a welcome email to personalEmail via the SendEmail binding
//      (with REST API fallback) explaining the new workspace login.
//   6) Persist the row in WorkspaceDO so /api/admin/employees GET can
//      list it and the OIDC bridge can resolve workspaceEmail → user.
//
// Failure modes & rollback:
//   - If Clerk user creation fails → return 4xx, no state changed.
//   - If routing rule creation fails AFTER Clerk user creation → we
//     persist the row anyway with status="invited" (the operator can
//     retry the routing rule by re-inviting later, OR we add a
//     re-provision endpoint in v1.3). The Clerk user is the source of
//     identity truth; orphan rules are easier to clean up than orphan
//     users.
//   - If welcome-email send fails → log + persist the employee anyway.
//     The operator sees a 200 with `welcome_email_sent: false` and can
//     forward the workspace email manually.

import { Hono } from "hono";
import { z } from "zod";
import type { ParrotContext } from "../lib/mailbox";
import { requireOperator } from "../lib/operator";
import {
	createClerkUser,
	createOrgMembership,
	parseAndSlugify,
	ClerkApiError,
	disableClerkUser,
} from "../lib/clerk-admin";
import {
	createEmailRoutingRule,
	disableEmailRoutingRule,
	sendWelcomeEmail,
} from "../lib/email";
import { getWorkspaceStub } from "../durableObject/workspace";

const adminEmployees = new Hono<ParrotContext>();

const InviteSchema = z.object({
	name: z.string().min(1).max(200),
	personalEmail: z.string().email(),
	displayName: z.string().min(1).max(200).optional(),
});

adminEmployees.use("*", requireOperator);

// — Create —————————————————————————————————————————————————

adminEmployees.post("/", async (c) => {
	const body = await c.req.json().catch(() => null);
	const parsed = InviteSchema.safeParse(body);
	if (!parsed.success) {
		return c.json({ error: "invalid_body", details: parsed.error.flatten() }, 400);
	}
	const { name, personalEmail } = parsed.data;
	const { firstName, lastName, slug } = parseAndSlugify(name);
	if (!slug) {
		return c.json({ error: "invalid_name_slug" }, 400);
	}
	const workspaceEmail = `${slug}@internjobs.ai`;

	const workspace = getWorkspaceStub(c.env);

	// Dedupe: refuse to overwrite an existing workspace email.
	const existing = await workspace.getEmployeeByWorkspaceEmail(workspaceEmail);
	if (existing) {
		return c.json(
			{
				error: "workspace_email_taken",
				workspace_email: workspaceEmail,
				existing_employee_id: existing.id,
			},
			409,
		);
	}

	// 1) Create Clerk user in the student production Clerk app.
	let clerkUserId: string;
	try {
		const clerkUser = await createClerkUser(c.env, {
			emailAddress: workspaceEmail,
			firstName: firstName || name,
			lastName,
			publicMetadata: { role: "employee" },
		});
		clerkUserId = clerkUser.id;
	} catch (e) {
		if (e instanceof ClerkApiError) {
			return c.json(
				{ error: "clerk_create_failed", status: e.status, message: e.message },
				502,
			);
		}
		throw e;
	}

	// 1b) Add the new user to the InternJobs Team organization so they
	// can pass the org-membership gate on workspace.internjobs.ai.
	// Soft-fail — we report the error but don't undo the Clerk user.
	// Re-provisioning the org membership is a one-API-call recovery
	// from the dashboard or a future re-invite endpoint.
	let orgMembershipId: string | null = null;
	let orgMembershipError: string | null = null;
	try {
		const { id } = await createOrgMembership(c.env, {
			userId: clerkUserId,
			role: "org:member",
		});
		orgMembershipId = id;
	} catch (e) {
		orgMembershipError = (e as Error).message;
		console.warn(
			`Org membership creation failed for ${clerkUserId}:`,
			orgMembershipError,
		);
	}

	// 2) Persist row first (so a routing-rule failure doesn't leave us
	// with an orphan Clerk user we can't see in our directory).
	const employeeRow = await workspace.createEmployee({
		clerkUserId,
		workspaceEmail,
		personalEmail,
		displayName: parsed.data.displayName || name,
	});

	// 3) Add Email Routing rule. Soft-fail — we report it but don't
	// undo the Clerk user; operator can retry separately.
	let routingRuleId: string | null = null;
	let routingError: string | null = null;
	try {
		const { id } = await createEmailRoutingRule(c.env, workspaceEmail);
		routingRuleId = id;
	} catch (e) {
		routingError = (e as Error).message;
		console.warn(
			`Routing rule creation failed for ${workspaceEmail}:`,
			routingError,
		);
	}

	// 4) Send welcome email. Also soft-fail.
	const url = new URL(c.req.url);
	const signinUrl = `${url.protocol}//${url.host}/sign-in`;
	let welcomeSent = false;
	let welcomeError: string | null = null;
	try {
		await sendWelcomeEmail(c.env, {
			to: personalEmail,
			employeeName: firstName || name,
			workspaceEmail,
			signinUrl,
		});
		welcomeSent = true;
	} catch (e) {
		welcomeError = (e as Error).message;
		console.warn(
			`Welcome email send failed for ${personalEmail}:`,
			welcomeError,
		);
	}

	return c.json({
		employee: {
			id: employeeRow.id,
			clerk_user_id: employeeRow.clerk_user_id,
			workspace_email: employeeRow.workspace_email,
			personal_email: employeeRow.personal_email,
			display_name: employeeRow.display_name,
			status: employeeRow.status,
			created_at: employeeRow.created_at,
		},
		org_membership_id: orgMembershipId,
		org_membership_error: orgMembershipError,
		routing_rule_id: routingRuleId,
		routing_error: routingError,
		welcome_email_sent: welcomeSent,
		welcome_error: welcomeError,
	}, 201);
});

// — List —————————————————————————————————————————————————

adminEmployees.get("/", async (c) => {
	const workspace = getWorkspaceStub(c.env);
	const rows = await workspace.listEmployees();
	return c.json({
		employees: rows.map((r) => ({
			id: r.id,
			clerk_user_id: r.clerk_user_id,
			workspace_email: r.workspace_email,
			personal_email: r.personal_email,
			display_name: r.display_name,
			status: r.status,
			created_at: r.created_at,
		})),
	});
});

// — Disable ————————————————————————————————————————————————

adminEmployees.delete("/:id", async (c) => {
	const id = c.req.param("id");
	const workspace = getWorkspaceStub(c.env);
	const row = await workspace.getEmployeeById(id);
	if (!row) return c.json({ error: "not_found" }, 404);
	if (row.status === "disabled") {
		return c.json({ ok: true, status: "already_disabled" });
	}

	const errors: { step: string; message: string }[] = [];

	try {
		await disableClerkUser(c.env, row.clerk_user_id);
	} catch (e) {
		errors.push({ step: "clerk_lock", message: (e as Error).message });
	}

	// We don't store the routing rule id (yet) so disabling the rule
	// requires a list+match by destination. Punt for now — operator can
	// disable it from the CF dashboard. This is the documented v1.3
	// extension point.
	void disableEmailRoutingRule;

	const updated = await workspace.setEmployeeStatus(id, "disabled");
	return c.json({ ok: true, employee: updated, partial_errors: errors });
});

export { adminEmployees };
