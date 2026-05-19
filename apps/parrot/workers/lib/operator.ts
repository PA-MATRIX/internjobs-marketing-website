// v1.2 Phase 10 Wave 2b (revised 2026-05-19): operator-role gate.
//
// Two paths to operator (any of these is sufficient):
//   1. Clerk publicMetadata.role is one of: operator, admin, ceo
//      — assigned via Clerk dashboard or the /api/admin/employees
//      provisioning route.
//   2. Email in the PARROT_OPERATOR_EMAILS comma-separated allowlist
//      (bootstrap path — the very first operator needs to exist before
//      we have a UI to grant a role).
//
// No Organizations involved. The employee Clerk app is a dedicated
// instance — every signed-in user is some flavour of employee already.

import { createMiddleware } from "hono/factory";
import type { ParrotContext } from "./mailbox";
import type { Env, Employee } from "../types";

const OPERATOR_ROLES = new Set(["operator", "admin", "ceo"]);

export function isOperator(
	env: Env,
	employee: Pick<Employee, "email" | "publicMetadata">,
): boolean {
	const role = String(employee.publicMetadata?.role || "").toLowerCase();
	if (OPERATOR_ROLES.has(role)) return true;
	const allowlist = (env.PARROT_OPERATOR_EMAILS || "")
		.split(",")
		.map((e) => e.trim().toLowerCase())
		.filter(Boolean);
	if (allowlist.includes(String(employee.email).toLowerCase())) return true;
	return false;
}

export const requireOperator = createMiddleware<ParrotContext>(
	async (c, next) => {
		const employee = c.var.employee;
		if (!employee) {
			return c.json({ error: "unauthenticated" }, 401);
		}
		if (!isOperator(c.env, employee)) {
			return c.json({ error: "forbidden_operator_only" }, 403);
		}
		await next();
	},
);
