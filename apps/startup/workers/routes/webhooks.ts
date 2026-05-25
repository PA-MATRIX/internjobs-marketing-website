// apps/startup/workers/routes/webhooks.ts
// v1.4 Phase 28.5 Plan 05 STARTUP-WORK-EMAIL-01 + STARTUP-WEB-AUTH-03
//
// POST /webhooks/clerk — Clerk user.created webhook handler with Svix
// signature verification + personal-domain enforcement.
//
// Flow:
//   1. Read raw body (Svix needs the raw bytes — DO NOT JSON.parse first).
//   2. Verify signature via svix.Webhook(env.STARTUPS_CLERK_WEBHOOK_SECRET).verify().
//      On verification failure → 400. Unsigned/forged payloads are rejected.
//   3. If event.type !== "user.created" → 200 no-op (ignore other events).
//   4. Extract primary email. If no email present at user.created time (some
//      OAuth flows fire user.created before email materializes), log + 200
//      no-op rather than deleting — safer false-negative than false-positive.
//   5. If email domain is in the personal-email blocklist (gmail/yahoo/etc.):
//      → DELETE the user via Clerk Backend API
//        (DELETE https://api.clerk.com/v1/users/:id with Bearer STARTUPS_CLERK_SECRET_KEY).
//      → Log a structured rejection event for audit.
//      Otherwise → 200 no-op (signup proceeds).
//
// OPEN RISKS (per 28.5-RESEARCH.md §5):
//   • Race window between user.created firing and DELETE completing — the
//     user may briefly have a valid session. Clerk's paid-tier native
//     blocklist eliminates this race. TODO v1.5: migrate to Clerk's
//     built-in blocked-email-domains list and remove this webhook.
//   • Some OAuth flows (Google in particular) may not populate
//     email_addresses[0] at user.created time. Guard against this by
//     refusing to delete users whose email cannot be extracted — Clerk
//     will fire user.updated shortly after with the email; in v1.5 we'll
//     handle that event too.
//
// Blocklist is hardcoded for v1.4. v1.5 follow-up: externalize to a
// Workers KV namespace or env-var-driven list so ops can add a domain
// without a code deploy. See PHASE-28.5-DEFERRED-OPS.md (DEFER-28.5-05-C
// added by this plan's execution).

import { Webhook } from "svix";
import type { Env } from "../types";
import { isPersonalEmailDomain } from "../lib/workEmail";

// ── Personal-email blocklist ────────────────────────────────────────────────
// Common free/personal email providers that should NOT be allowed to sign
// up as a founder (founders must use a work email so we can verify they
// belong to the startup). The canonical blocklist lives in lib/workEmail.ts
// and is shared with Phase 29-01's Voice AI `register_startup` handler.
// `isPersonalEmail` is preserved as a re-export to keep the existing
// webhooks.test.ts (26 cases) green; new code should import from
// `../lib/workEmail` directly.
export function isPersonalEmail(email: string): boolean {
	return isPersonalEmailDomain(email);
}

// ── Clerk Backend API ────────────────────────────────────────────────────────

/**
 * Deletes a user via Clerk Backend API. Returns true on 200/204, false otherwise.
 * Caller is responsible for logging the rejection event for audit.
 */
async function deleteClerkUser(
	userId: string,
	secretKey: string,
): Promise<boolean> {
	if (!secretKey) return false;
	try {
		const res = await fetch(`https://api.clerk.com/v1/users/${userId}`, {
			method: "DELETE",
			headers: {
				Authorization: `Bearer ${secretKey}`,
				"Content-Type": "application/json",
			},
		});
		return res.ok;
	} catch {
		return false;
	}
}

// ── Webhook payload shape (Clerk user.created event subset) ─────────────────

interface ClerkUserCreatedEvent {
	type: string;
	data?: {
		id?: string;
		email_addresses?: Array<{
			email_address?: string;
			id?: string;
		}>;
		primary_email_address_id?: string;
	};
}

/**
 * Extracts the primary email address from a Clerk user.created event.
 * Prefers primary_email_address_id when set; falls back to email_addresses[0].
 * Returns null if no email is present (the OAuth-race case described above).
 */
export function extractPrimaryEmail(
	event: ClerkUserCreatedEvent,
): string | null {
	const emails = event.data?.email_addresses ?? [];
	if (emails.length === 0) return null;
	const primaryId = event.data?.primary_email_address_id;
	if (primaryId) {
		const primary = emails.find((e) => e.id === primaryId);
		if (primary?.email_address) return primary.email_address;
	}
	return emails[0]?.email_address ?? null;
}

// ── Handler ──────────────────────────────────────────────────────────────────

export async function handleClerkWebhook(
	req: Request,
	env: Env,
): Promise<Response> {
	// 1. Guard: webhook secret must be present (DEFER-28.5-05-B until
	// the wrangler secret is set). Without it we cannot verify any signed
	// payload, so refuse to process any webhook at all — log + 503.
	if (!env.STARTUPS_CLERK_WEBHOOK_SECRET) {
		console.warn(
			JSON.stringify({
				event: "clerk_webhook_secret_unbound",
				note: "STARTUPS_CLERK_WEBHOOK_SECRET not set — DEFER-28.5-05-B pending",
			}),
		);
		return new Response("webhook secret not configured", { status: 503 });
	}

	// 2. Read raw body for Svix verification (must be raw bytes, not parsed).
	const body = await req.text();

	// 3. Svix signature verification — throws on any tamper / wrong sig.
	const wh = new Webhook(env.STARTUPS_CLERK_WEBHOOK_SECRET);
	let payload: unknown;
	try {
		payload = wh.verify(body, {
			"svix-id": req.headers.get("svix-id") ?? "",
			"svix-timestamp": req.headers.get("svix-timestamp") ?? "",
			"svix-signature": req.headers.get("svix-signature") ?? "",
		});
	} catch {
		return new Response("invalid signature", { status: 400 });
	}

	const event = payload as ClerkUserCreatedEvent;

	// 4. Only act on user.created. Other events (user.updated, user.deleted,
	// session.*, organization.*) → 200 no-op so Clerk doesn't retry.
	if (event.type !== "user.created") {
		return new Response("ok", { status: 200 });
	}

	const userId = event.data?.id;
	if (!userId) {
		console.warn(
			JSON.stringify({
				event: "clerk_webhook_user_created_missing_id",
				note: "user.created event with no data.id — payload shape changed?",
			}),
		);
		return new Response("ok", { status: 200 });
	}

	// 5. Extract primary email. If absent (OAuth race) → log + no-op.
	const primaryEmail = extractPrimaryEmail(event);
	if (!primaryEmail) {
		console.warn(
			JSON.stringify({
				event: "clerk_webhook_user_created_no_email",
				user_id: userId,
				note: "user.created with empty email_addresses — possible Google OAuth race; Clerk will fire user.updated shortly. Skipping delete (safer false-negative).",
			}),
		);
		return new Response("ok", { status: 200 });
	}

	// 6. Check personal-domain blocklist.
	if (isPersonalEmail(primaryEmail)) {
		const deleted = await deleteClerkUser(
			userId,
			env.STARTUPS_CLERK_SECRET_KEY ?? "",
		);
		console.log(
			JSON.stringify({
				event: "work_email_enforcement",
				action: deleted ? "deleted" : "delete_failed",
				user_id: userId,
				email_domain: primaryEmail.split("@")[1]?.toLowerCase(),
			}),
		);
		return new Response("ok", { status: 200 });
	}

	// 7. Work email accepted — signup proceeds.
	return new Response("ok", { status: 200 });
}
