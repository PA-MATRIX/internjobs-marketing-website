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

// Phase 32: resolve an employee's canonical email + display name from Clerk's
// Backend API. Needed for the Parrot embed token: Parrot links a user by the
// `email` claim on first sight (WORKSPACE-EMBED-REPLY §7.2), but the Clerk
// SESSION JWT is minimal — for phone-OTP accounts it carries no email claim,
// and a bootstrap operator may have no workspace-directory row to enrich from,
// so `employee.email` degrades to the phone number or the Clerk user id. That
// is not an address Parrot can match. Clerk (the identity source of truth) has
// the real email on the user record, so we fetch it by user id. Cached like the
// role lookup; only called when the session-derived email isn't a real address.
const CLERK_CONTACT_CACHE_TTL_MS = 5 * 60 * 1000;
const clerkContactCache = new Map<
	string,
	{ email: string | null; name: string | null; expiresAt: number }
>();

export async function resolveClerkContact(
	env: Env,
	employeeId: string,
): Promise<{ email: string | null; name: string | null }> {
	const cached = clerkContactCache.get(employeeId);
	if (cached && cached.expiresAt > Date.now()) {
		return { email: cached.email, name: cached.name };
	}
	const secretKey = env.PARROT_CLERK_SECRET_KEY;
	if (!secretKey) return { email: null, name: null };
	try {
		const res = await fetch(
			`https://api.clerk.com/v1/users/${encodeURIComponent(employeeId)}`,
			{ headers: { Authorization: `Bearer ${secretKey}` } },
		);
		if (!res.ok) {
			console.warn("clerk_contact_lookup_failed", res.status);
			return { email: null, name: null };
		}
		const body = (await res.json().catch(() => null)) as {
			first_name?: string | null;
			last_name?: string | null;
			primary_email_address_id?: string | null;
			email_addresses?: Array<{ id?: string; email_address?: string }>;
		} | null;
		const addrs = body?.email_addresses ?? [];
		const primary =
			addrs.find((a) => a.id === body?.primary_email_address_id) ?? addrs[0];
		const email = primary?.email_address?.trim().toLowerCase() || null;
		const name =
			[body?.first_name ?? "", body?.last_name ?? ""]
				.filter(Boolean)
				.join(" ")
				.trim() || null;
		clerkContactCache.set(employeeId, {
			email,
			name,
			expiresAt: Date.now() + CLERK_CONTACT_CACHE_TTL_MS,
		});
		return { email, name };
	} catch (e) {
		console.warn("clerk_contact_lookup_failed", (e as Error).message);
		return { email: null, name: null };
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
