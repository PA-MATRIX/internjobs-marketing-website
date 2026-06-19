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

		// Phase 31 Wave 4 (plan 31-05, CHAT-RT-04): record activity for offline
		// detection. Fire-and-forget — do NOT await; this must never add latency
		// to the request or fail it. The DO alarm reads last_seen_at to decide
		// whether to send the offline @mention/DM email.
		try {
			c.executionCtx.waitUntil(
				stub.touchLastSeen().catch((err) => {
					console.warn("touchLastSeen failed (non-fatal)", err);
				}),
			);
		} catch {
			// c.executionCtx is unavailable in some test/runtime contexts —
			// touch is best-effort, so swallow and continue.
		}

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
