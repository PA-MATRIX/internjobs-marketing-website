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

/** Default capability flags: all-on. Used both as POST defaults and as
 *  the merge base for GET / PATCH /:id/flags so the worker never returns
 *  a partial flag set even when KV has none of the keys yet. */
const DEFAULT_FLAGS = {
	email: true,
	chat: true,
	meetings: true,
	phone: true,
	sms: true,
	campaigns: true,
} as const;

const FeatureFlagsObject = z
	.object({
		email: z.boolean(),
		chat: z.boolean(),
		meetings: z.boolean(),
		phone: z.boolean(),
		sms: z.boolean(),
		campaigns: z.boolean(),
	})
	.partial();

const InviteSchema = z.object({
	name: z.string().min(1).max(200),
	personalEmail: z.string().email(),
	displayName: z.string().min(1).max(200).optional(),
	// Phase 16 additions — all optional for backward compat.
	firstName: z.string().min(1).max(100).optional(),
	lastName: z.string().min(0).max(100).optional(),
	phoneNumber: z
		.string()
		.regex(/^\+[1-9]\d{7,14}$/, "phoneNumber must be E.164")
		.optional(),
	featureFlags: FeatureFlagsObject.optional(),
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
	// Slug is ALWAYS derived from `name` so the workspace email stays
	// deterministic; firstName/lastName overrides only affect what we send
	// to Clerk as the user's display identity.
	const parsedName = parseAndSlugify(name);
	if (!parsedName.slug) {
		return c.json({ error: "invalid_name_slug" }, 400);
	}
	const firstName = parsed.data.firstName ?? parsedName.firstName;
	const lastName = parsed.data.lastName ?? parsedName.lastName;
	const workspaceEmail = `${parsedName.slug}@internjobs.ai`;
	const phoneNumber = parsed.data.phoneNumber;

	// Merge default-all-on flags with any override the operator sent.
	// `parsed.data.featureFlags` is a partial — spread last so the
	// operator's explicit overrides win.
	const flags = { ...DEFAULT_FLAGS, ...(parsed.data.featureFlags ?? {}) };

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

	// 1) Create Clerk user in the employee Clerk app.
	// When phoneNumber is supplied, the Clerk app is phone-OTP only —
	// createClerkUser sends `phone_number` (NOT `email_address`). When
	// phoneNumber is absent, we fall back to the email-OTP enrollment path
	// for backward compat with any caller that hasn't migrated.
	let clerkUserId: string;
	try {
		const clerkUser = await createClerkUser(c.env, {
			...(phoneNumber
				? { phoneNumber }
				: { emailAddress: workspaceEmail }),
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

	// (2026-05-19) No org-membership step — the employee Clerk app is
	// its own user pool; signed-in === employee.

	// 2) Persist row first (so a routing-rule failure doesn't leave us
	// with an orphan Clerk user we can't see in our directory).
	const employeeRow = await workspace.createEmployee({
		clerkUserId,
		workspaceEmail,
		personalEmail,
		displayName: parsed.data.displayName || name,
	});

	// 2b) Write capability flags to KV. Best-effort: if the KV binding
	// isn't present (e.g. local dev without PARROT_FEATURE_FLAGS), the
	// GET /:id/flags endpoint falls back to DEFAULT_FLAGS anyway. We
	// don't fail the invite over a missing KV binding.
	if (c.env.PARROT_FEATURE_FLAGS) {
		try {
			await c.env.PARROT_FEATURE_FLAGS.put(
				`employee:${clerkUserId}:flags`,
				JSON.stringify(flags),
			);
		} catch (e) {
			console.warn(
				`Feature flag KV write failed for ${clerkUserId}:`,
				(e as Error).message,
			);
		}
	}

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
	// Identity: prefer the signed-in operator's identity so the invite
	// reads as a personal note from (e.g.) Ridhi. Defaults exist so a
	// no-operator-context callsite still produces a valid email.
	const url = new URL(c.req.url);
	const signinUrl = `${url.protocol}//${url.host}/sign-in`;
	const inviter = c.var.employee;
	const inviterName = inviter?.displayName || "Ridhi";
	const inviterEmail = inviter?.email || "ridhi@internjobs.ai";
	let welcomeSent = false;
	let welcomeError: string | null = null;
	try {
		await sendWelcomeEmail(c.env, {
			to: personalEmail,
			employeeName: firstName || name,
			workspaceEmail,
			signinUrl,
			inviterName,
			inviterEmail,
			phoneNumber,
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
		feature_flags: flags,
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

// — Feature flags ————————————————————————————————————————————
//
// Route order matters: Hono dispatches `/:id/flags` AFTER `/:id` if the
// latter is registered first, because `:id` greedily matches everything
// up to the next slash. We register both flag routes here, BEFORE the
// DELETE "/:id" handler below, so "/abc123/flags" → flags handler (not
// the disable handler with id="abc123/flags").

adminEmployees.get("/:id/flags", async (c) => {
	const id = c.req.param("id");
	const workspace = getWorkspaceStub(c.env);
	const row = await workspace.getEmployeeById(id);
	if (!row) return c.json({ error: "not_found" }, 404);

	// When the KV binding isn't wired, return defaults so the frontend
	// can still render the toggle UI in dev / staging without bindings.
	if (!c.env.PARROT_FEATURE_FLAGS) {
		return c.json({ feature_flags: { ...DEFAULT_FLAGS } });
	}
	const stored = (await c.env.PARROT_FEATURE_FLAGS.get(
		`employee:${row.clerk_user_id}:flags`,
		{ type: "json" },
	)) as Record<string, boolean> | null;
	return c.json({
		feature_flags: { ...DEFAULT_FLAGS, ...(stored ?? {}) },
	});
});

adminEmployees.patch("/:id/flags", async (c) => {
	const id = c.req.param("id");
	const body = await c.req.json().catch(() => null);
	const FlagsBodySchema = z.object({
		featureFlags: FeatureFlagsObject,
	});
	const parsed = FlagsBodySchema.safeParse(body);
	if (!parsed.success) {
		return c.json(
			{ error: "invalid_body", details: parsed.error.flatten() },
			400,
		);
	}

	const workspace = getWorkspaceStub(c.env);
	const row = await workspace.getEmployeeById(id);
	if (!row) return c.json({ error: "not_found" }, 404);

	// Read-modify-write so a partial PATCH (e.g. just `{ chat: false }`)
	// doesn't clobber the other 5 toggles. Base is the default-all-on
	// shape; any KV value layers on top; the request body wins last.
	let existing: Record<string, boolean> = { ...DEFAULT_FLAGS };
	if (c.env.PARROT_FEATURE_FLAGS) {
		const stored = (await c.env.PARROT_FEATURE_FLAGS.get(
			`employee:${row.clerk_user_id}:flags`,
			{ type: "json" },
		)) as Record<string, boolean> | null;
		if (stored) existing = { ...existing, ...stored };
	}
	const merged = { ...existing, ...parsed.data.featureFlags };

	if (c.env.PARROT_FEATURE_FLAGS) {
		await c.env.PARROT_FEATURE_FLAGS.put(
			`employee:${row.clerk_user_id}:flags`,
			JSON.stringify(merged),
		);
	}
	return c.json({ ok: true, employee_id: id, feature_flags: merged });
});

// — Disable / Remove —————————————————————————————————————————

adminEmployees.delete("/:id", async (c) => {
	const id = c.req.param("id");
	const hardDelete = c.req.query("hard") === "1";
	const workspace = getWorkspaceStub(c.env);
	const row = await workspace.getEmployeeById(id);
	if (!row) return c.json({ error: "not_found" }, 404);
	if (!hardDelete && row.status === "disabled") {
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

	if (hardDelete) {
		if (c.env.PARROT_FEATURE_FLAGS) {
			try {
				await c.env.PARROT_FEATURE_FLAGS.delete(
					`employee:${row.clerk_user_id}:flags`,
				);
			} catch (e) {
				errors.push({ step: "flags_delete", message: (e as Error).message });
			}
		}
		const deleted = await workspace.deleteEmployee(id);
		return c.json({
			ok: deleted.deleted,
			status: deleted.deleted ? "deleted" : "not_found",
			employee_id: id,
			workspace_email: row.workspace_email,
			partial_errors: errors,
		});
	}

	const updated = await workspace.setEmployeeStatus(id, "disabled");
	return c.json({ ok: true, employee: updated, partial_errors: errors });
});

export { adminEmployees };
