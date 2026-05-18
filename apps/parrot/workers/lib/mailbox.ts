// v1.2 Phase 10 Wave 1: Parrot mailbox middleware.
//
// Differences vs apps/agentic-inbox/workers/lib/mailbox.ts:
//   - The DO instance is keyed by employee.employeeId (stable Clerk
//     user ID) instead of the mailbox email address. This means
//     renaming someone's @internjobs.ai alias doesn't strand their DO.
//   - The middleware READS the authenticated employee out of context
//     (set by the Clerk middleware in workers/app.ts) instead of
//     parsing a path parameter. There is no concept of "look up someone
//     else's mailbox" in Parrot — each employee only ever talks to
//     their own EmployeeMailboxDO.

import { createMiddleware } from "hono/factory";
import type { EmployeeMailboxDO } from "../durableObject";
import type { Employee, Env } from "../types";

export type ParrotContext = {
	Bindings: Env;
	Variables: {
		employee: Employee;
		mailboxStub: DurableObjectStub<EmployeeMailboxDO>;
	};
};

/**
 * Resolve a DO stub for the authenticated employee. The Clerk middleware
 * in workers/app.ts MUST have already populated `c.var.employee`.
 */
export const requireEmployeeMailbox = createMiddleware<ParrotContext>(
	async (c, next) => {
		const employee = c.var.employee;
		if (!employee) {
			return c.json({ error: "unauthenticated" }, 401);
		}

		const ns = c.env.EMPLOYEE_MAILBOX;
		const id = ns.idFromName(employee.employeeId);
		const stub = ns.get(id);

		c.set("mailboxStub", stub);
		await next();
	},
);

export function getMailboxStub(
	env: Env,
	employeeId: string,
): DurableObjectStub<EmployeeMailboxDO> {
	const ns = env.EMPLOYEE_MAILBOX;
	const id = ns.idFromName(employeeId);
	return ns.get(id);
}
