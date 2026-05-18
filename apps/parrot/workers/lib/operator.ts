// v1.2 Phase 10 Wave 2b: operator-role gate.
//
// Two paths to operator:
//   (a) Clerk publicMetadata.role === "operator" (preferred long-term;
//       set once via the Clerk dashboard for each admin).
//   (b) Email match against the comma-separated PARROT_OPERATOR_EMAILS
//       allowlist (bootstrap path — the very first operator needs to
//       exist before we have a UI to grant the role).
//
// The middleware always requires that the request already passed Clerk
// auth (so `c.var.employee` is set). It's mounted on every
// /api/admin/* route in workers/index.ts.

import { createMiddleware } from "hono/factory";
import type { ParrotContext } from "./mailbox";
import type { Env } from "../types";
import type { JWTPayload } from "jose";

export function isOperator(
	env: Env,
	email: string,
	publicMetadata?: Record<string, unknown> | null,
): boolean {
	if (publicMetadata?.role === "operator") return true;
	const allowlist = (env.PARROT_OPERATOR_EMAILS || "")
		.split(",")
		.map((e) => e.trim().toLowerCase())
		.filter(Boolean);
	if (allowlist.includes(email.toLowerCase())) return true;
	return false;
}

/**
 * Extract Clerk publicMetadata off the verified JWT claims. Returns
 * `null` if no metadata is in the token (which is the default unless
 * the JWT template explicitly includes `public_metadata`).
 */
export function extractPublicMetadata(
	claims: JWTPayload,
): Record<string, unknown> | null {
	const c = claims as Record<string, unknown>;
	const meta = c.public_metadata ?? c.publicMetadata;
	if (meta && typeof meta === "object") {
		return meta as Record<string, unknown>;
	}
	return null;
}

export const requireOperator = createMiddleware<ParrotContext>(
	async (c, next) => {
		const employee = c.var.employee;
		if (!employee) {
			return c.json({ error: "unauthenticated" }, 401);
		}
		// `publicMetadata` is stashed onto `employee` by the Clerk
		// middleware in workers/app.ts (when present). We treat absence
		// as "no role" and fall back to the email allowlist.
		const meta = (
			employee as unknown as {
				publicMetadata?: Record<string, unknown>;
			}
		).publicMetadata;
		if (!isOperator(c.env, employee.email, meta)) {
			return c.json({ error: "forbidden_operator_only" }, 403);
		}
		await next();
	},
);
