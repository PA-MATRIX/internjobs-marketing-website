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

/**
 * E.164 phone number regex.
 * Matches a leading "+", a non-zero first digit, then 7–14 additional digits
 * (total length 8–15 digits including the leading non-zero). Used by the
 * Parrot Worker to gate phone-OTP Clerk enrollment.
 */
const E164_REGEX = /^\+[1-9]\d{7,14}$/;

export interface ClerkUserCreateInput {
	/**
	 * Email address to associate with the Clerk user. Optional because the
	 * Parrot ("InternJobs Employees") Clerk app is phone-OTP only — when
	 * `phoneNumber` is provided the worker omits `email_address` from the
	 * Clerk POST body entirely. See memory/project-auth-architecture.md.
	 */
	emailAddress?: string;
	/**
	 * E.164 phone number (e.g. "+12125551234"). When provided, the Clerk
	 * user is created with a phone_number identifier (and NO email_address)
	 * so the user authenticates via phone-OTP at workspace.internjobs.ai.
	 */
	phoneNumber?: string;
	firstName: string;
	lastName: string;
	publicMetadata?: Record<string, unknown>;
}

export interface ClerkUser {
	id: string;
	email_addresses?: { id: string; email_address: string }[];
	phone_numbers?: { id: string; phone_number: string }[];
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

	// Validate phone-number identifier shape up front (don't trust the
	// caller's regex). The Parrot Worker uses Clerk phone-OTP enrollment,
	// which REQUIRES E.164 ("+" + country code + subscriber number, no
	// spaces / dashes / parens).
	if (input.phoneNumber !== undefined && !E164_REGEX.test(input.phoneNumber)) {
		throw new Error(
			"createClerkUser: phoneNumber must be E.164 (e.g. +12125551234)",
		);
	}

	if (!input.phoneNumber && !input.emailAddress) {
		throw new Error(
			"createClerkUser: at least one of phoneNumber or emailAddress is required",
		);
	}

	// Build the identifier portion of the body. Phone-OTP and email-OTP
	// Clerk apps are separate instances in our setup; we never send BOTH
	// identifiers to the same instance — phone wins when present.
	const identifierBody: Record<string, unknown> = input.phoneNumber
		? { phone_number: [input.phoneNumber] }
		: { email_address: [input.emailAddress] };

	const res = await fetch("https://api.clerk.com/v1/users", {
		method: "POST",
		headers: {
			Authorization: `Bearer ${secretKey}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			...identifierBody,
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
