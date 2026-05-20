// v1.2 Phase 10 Wave 2b (revised 2026-05-19): operator-role gate.
//
// Three paths to operator (any of these is sufficient):
//   1. Clerk publicMetadata.role is one of: operator, admin, ceo
//      — assigned via Clerk dashboard. If the session JWT omits metadata,
//      we read it from Clerk's Backend API by user id.
//   2. Email in the PARROT_OPERATOR_EMAILS comma-separated allowlist
//      (bootstrap path — the very first operator needs to exist before
//      we have a UI to grant a role).
//   3. Ridhi's founder workspace email is a production bootstrap account.
//
// No Organizations involved. The employee Clerk app is a dedicated
// instance — every signed-in user is some flavour of employee already.

import { createMiddleware } from "hono/factory";
import type { ParrotContext } from "./mailbox";
import type { Env, Employee } from "../types";

const OPERATOR_ROLES = new Set(["operator", "admin", "ceo"]);
const BOOTSTRAP_OPERATOR_EMAILS = new Set(["ridhi@internjobs.ai"]);
const CLERK_ROLE_CACHE_TTL_MS = 5 * 60 * 1000;
const clerkRoleCache = new Map<string, { role: string | null; expiresAt: number }>();

function roleFromMetadata(metadata: unknown): string | null {
	if (!metadata || typeof metadata !== "object") return null;
	const role = (metadata as Record<string, unknown>).role;
	return typeof role === "string" ? role.toLowerCase() : null;
}

async function lookupClerkRole(
	env: Env,
	employeeId: string,
): Promise<string | null> {
	const cached = clerkRoleCache.get(employeeId);
	if (cached && cached.expiresAt > Date.now()) return cached.role;
	const secretKey = env.PARROT_CLERK_SECRET_KEY;
	if (!secretKey) return null;

	try {
		const res = await fetch(
			`https://api.clerk.com/v1/users/${encodeURIComponent(employeeId)}`,
			{ headers: { Authorization: `Bearer ${secretKey}` } },
		);
		if (!res.ok) {
			console.warn("operator_clerk_lookup_failed", res.status);
			return null;
		}
		const body = (await res.json().catch(() => null)) as
			| { public_metadata?: unknown; publicMetadata?: unknown }
			| null;
		const role =
			roleFromMetadata(body?.public_metadata) ??
			roleFromMetadata(body?.publicMetadata);
		clerkRoleCache.set(employeeId, {
			role,
			expiresAt: Date.now() + CLERK_ROLE_CACHE_TTL_MS,
		});
		return role;
	} catch (e) {
		console.warn("operator_clerk_lookup_failed", (e as Error).message);
		return null;
	}
}

export async function isOperator(
	env: Env,
	employee: Pick<Employee, "employeeId" | "email" | "publicMetadata">,
): Promise<boolean> {
	const role = roleFromMetadata(employee.publicMetadata);
	if (role && OPERATOR_ROLES.has(role)) return true;
	const allowlist = (env.PARROT_OPERATOR_EMAILS || "")
		.split(",")
		.map((e) => e.trim().toLowerCase())
		.filter(Boolean);
	const email = String(employee.email).toLowerCase();
	if (allowlist.includes(email)) return true;
	if (BOOTSTRAP_OPERATOR_EMAILS.has(email)) return true;
	const clerkRole = await lookupClerkRole(env, employee.employeeId);
	if (clerkRole && OPERATOR_ROLES.has(clerkRole)) return true;
	return false;
}

export const requireOperator = createMiddleware<ParrotContext>(
	async (c, next) => {
		const employee = c.var.employee;
		if (!employee) {
			return c.json({ error: "unauthenticated" }, 401);
		}
		if (!(await isOperator(c.env, employee))) {
			return c.json({ error: "forbidden_operator_only" }, 403);
		}
		await next();
	},
);
