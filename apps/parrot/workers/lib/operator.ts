// v1.2 Phase 10 Wave 2b (revised 2026-05-18): operator-role gate.
//
// Primary gate: the session JWT's active-org role is `org:admin`. That's
// the role Clerk hands to whoever created the InternJobs Team org and
// to anyone explicitly promoted to admin via the Clerk dashboard.
//
// Fallback (kept for bootstrap and emergency access while org membership
// is still being rolled out): PARROT_OPERATOR_EMAILS comma-separated
// allowlist. Documented as deprecated in workers/types.ts.
//
// Note: by the time this middleware runs, workers/app.ts has already
// enforced that the session carries the InternJobs Team org as active.
// So `c.var.employee.orgRole` reflects that org specifically.

import { createMiddleware } from "hono/factory";
import type { ParrotContext } from "./mailbox";
import type { Env, Employee } from "../types";

export function isOperator(
	env: Env,
	employee: Pick<Employee, "email" | "orgRole" | "publicMetadata">,
): boolean {
	if (employee.orgRole === "org:admin") return true;
	// Legacy compatibility — publicMetadata.role set via the Clerk
	// dashboard before Organizations existed.
	if (employee.publicMetadata?.role === "operator") return true;
	const allowlist = (env.PARROT_OPERATOR_EMAILS || "")
		.split(",")
		.map((e) => e.trim().toLowerCase())
		.filter(Boolean);
	if (allowlist.includes(employee.email.toLowerCase())) return true;
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
