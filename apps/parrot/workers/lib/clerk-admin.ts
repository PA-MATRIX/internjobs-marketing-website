// v1.2 Phase 10 Wave 2b: Clerk Backend API helpers.
//
// We don't pull in @clerk/backend's full Node SDK here because the
// only thing we need server-side from the worker is a single REST
// call: POST https://api.clerk.com/v1/users to create a new user
// with the derived @internjobs.ai email address.
//
// Keeping this as a hand-rolled fetch lets us run on the standard
// Workers fetch runtime without dragging in the larger SDK's
// node-only dependencies.

import type { Env } from "../types";

export interface ClerkUserCreateInput {
	emailAddress: string;
	firstName: string;
	lastName: string;
	publicMetadata?: Record<string, unknown>;
}

export interface ClerkUser {
	id: string;
	email_addresses?: { id: string; email_address: string }[];
	first_name?: string | null;
	last_name?: string | null;
	primary_email_address_id?: string | null;
}

export async function createClerkUser(
	env: Env,
	input: ClerkUserCreateInput,
): Promise<ClerkUser> {
	const secretKey = env.PARROT_CLERK_SECRET_KEY;
	if (!secretKey) {
		throw new Error("createClerkUser: PARROT_CLERK_SECRET_KEY not configured");
	}

	const res = await fetch("https://api.clerk.com/v1/users", {
		method: "POST",
		headers: {
			Authorization: `Bearer ${secretKey}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			email_address: [input.emailAddress],
			first_name: input.firstName,
			last_name: input.lastName,
			skip_password_requirement: true,
			...(input.publicMetadata
				? { public_metadata: input.publicMetadata }
				: {}),
		}),
	});

	if (!res.ok) {
		const body = await res.text().catch(() => "");
		throw new ClerkApiError(
			res.status,
			`createClerkUser failed (${res.status}): ${body.slice(0, 500)}`,
		);
	}

	return (await res.json()) as ClerkUser;
}

export async function disableClerkUser(env: Env, userId: string): Promise<void> {
	const secretKey = env.PARROT_CLERK_SECRET_KEY;
	if (!secretKey) {
		throw new Error("disableClerkUser: PARROT_CLERK_SECRET_KEY not configured");
	}
	const res = await fetch(`https://api.clerk.com/v1/users/${userId}/lock`, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${secretKey}`,
			"Content-Type": "application/json",
		},
	});
	if (!res.ok) {
		const body = await res.text().catch(() => "");
		throw new ClerkApiError(
			res.status,
			`disableClerkUser failed (${res.status}): ${body.slice(0, 500)}`,
		);
	}
}

export class ClerkApiError extends Error {
	status: number;
	constructor(status: number, message: string) {
		super(message);
		this.name = "ClerkApiError";
		this.status = status;
	}
}

/**
 * "Alice Smith" → { firstName: "Alice", lastName: "Smith", slug: "alice.smith" }
 * "Alice"       → { firstName: "Alice", lastName: "", slug: "alice" }
 * "Mary-Anne O'Connor" → { firstName: "Mary-Anne", lastName: "O'Connor", slug: "mary-anne.oconnor" }
 *
 * Slug rules:
 *   - Lowercase ASCII
 *   - Spaces between words → dot
 *   - Apostrophes / quotes stripped
 *   - Anything else not [a-z0-9-] collapsed to a single dash
 *   - Leading/trailing dots and dashes trimmed
 */
export function parseAndSlugify(name: string): {
	firstName: string;
	lastName: string;
	slug: string;
} {
	const trimmed = name.trim().replace(/\s+/g, " ");
	if (!trimmed) {
		return { firstName: "", lastName: "", slug: "" };
	}
	const parts = trimmed.split(" ");
	const firstName = parts[0]!;
	const lastName = parts.length > 1 ? parts.slice(1).join(" ") : "";

	const slug = parts
		.map((part) =>
			part
				.toLowerCase()
				.replace(/['"]/g, "")
				.replace(/[^a-z0-9-]+/g, "-")
				.replace(/^-+|-+$/g, ""),
		)
		.filter(Boolean)
		.join(".");

	return { firstName, lastName, slug };
}
