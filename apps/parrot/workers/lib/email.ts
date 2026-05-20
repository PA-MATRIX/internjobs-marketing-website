// v1.2 Phase 10 Wave 2b: welcome email + Cloudflare Email Service helper.
//
// We send the new-hire welcome email via the Cloudflare Workers
// `send_email` binding (env.EMAIL.send()). The binding is the
// first-party path documented at
//   https://developers.cloudflare.com/email-service/api/send-emails/workers-api/
// and is already wired in apps/parrot/wrangler.jsonc.
//
// The CLOUDFLARE_EMAIL_API_TOKEN / CLOUDFLARE_EMAIL_ACCOUNT_ID secrets
// in the Worker env exist as a REST-API FALLBACK for sending mail to
// addresses outside CF Email Routing's verified recipients. If the
// SendEmail binding rejects an external recipient (which Cloudflare's
// dev/preview tiers do — they only accept Routing-verified addresses),
// we transparently fall through to the REST API. In prod, once
// internjobs.ai is fully verified, the binding becomes the only path.

import type { Env } from "../types";

export interface WelcomeEmailInput {
	to: string;
	employeeName: string;
	workspaceEmail: string;
	signinUrl: string;
	/**
	 * Display name of the operator (e.g. "Ridhi") sending the invite. Used
	 * in the signature line and (alongside `inviterEmail`) personalizes the
	 * From identity so invitees see the email coming from a real person on
	 * the team, not a system address.
	 */
	inviterName?: string;
	/**
	 * From address for the welcome email (e.g. "ridhi@internjobs.ai"). Falls
	 * back to noreply@internjobs.ai when the route handler can't resolve the
	 * operator identity (defensive — keeps the path working for legacy
	 * non-operator-context callers).
	 */
	inviterEmail?: string;
	/**
	 * E.164 phone number the invitee should use to log in at
	 * workspace.internjobs.ai (phone-OTP auth). Workspace email is created
	 * inside Parrot and is not a login credential.
	 */
	phoneNumber: string;
}

function renderWelcomeText(input: WelcomeEmailInput): string {
	const {
		employeeName,
		workspaceEmail,
		signinUrl,
		phoneNumber,
		inviterName,
		inviterEmail,
	} = input;
	const ridhi = inviterName || "The InternJobs team";
	const ridhiEmail = inviterEmail || "noreply@internjobs.ai";

	const loginLine = `When you open that link, enter your phone number (${phoneNumber}). You'll get a one-time code — paste it in and you're in.`;

	return [
		`Hi ${employeeName},`,
		"",
		`I'm so excited you're joining InternJobs! We're on a mission to connect ambitious high school and college students with meaningful internship opportunities — and you're going to be a huge part of making that happen.`,
		"",
		"Your work email is ready:",
		"",
		`  ${workspaceEmail}`,
		"",
		"Here's how to log in to your workspace (email, chat, and meetings):",
		"",
		`  ${signinUrl}`,
		"",
		loginLine,
		"",
		"I'll be right there to help you get set up. Can't wait to work with you!",
		"",
		`— ${ridhi}`,
		`  Founder, InternJobs`,
		`  ${ridhiEmail}`,
	].join("\n");
}

function renderWelcomeHtml(input: WelcomeEmailInput): string {
	const {
		employeeName,
		workspaceEmail,
		signinUrl,
		phoneNumber,
		inviterName,
		inviterEmail,
	} = input;
	const safeName = escapeHtml(employeeName);
	const safeEmail = escapeHtml(workspaceEmail);
	const safeUrl = escapeHtml(signinUrl);
	const safeInviter = escapeHtml(inviterName || "The InternJobs team");
	const safeInviterEmail = escapeHtml(inviterEmail || "noreply@internjobs.ai");
	const loginInstruction = `When you open that link, enter your phone number (<strong>${escapeHtml(phoneNumber)}</strong>). You'll get a one-time code — paste it in and you're in.`;

	return `<!doctype html>
<html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#0f172a">
  <p>Hi ${safeName},</p>
  <p>I'm so excited you're joining InternJobs! We're on a mission to connect ambitious high school and college students with meaningful internship opportunities — and you're going to be a huge part of making that happen.</p>
  <p>Your work email is ready:</p>
  <p style="font-family:monospace;background:#f1f5f9;padding:12px;border-radius:6px"><strong>${safeEmail}</strong></p>
  <p>Here's how to log in to your workspace (email, chat, and meetings):</p>
  <p><a href="${safeUrl}" style="display:inline-block;background:#0f172a;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none">Open workspace</a></p>
  <p style="font-size:13px;color:#475569;margin-top:24px">${loginInstruction}</p>
  <p>I'll be right there to help you get set up. Can't wait to work with you!</p>
  <p style="font-size:13px;color:#475569;margin-top:24px">— ${safeInviter}<br>Founder, InternJobs<br>${safeInviterEmail}</p>
</body></html>`;
}

function escapeHtml(text: string): string {
	return text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

/**
 * Send the welcome email to a newly-invited employee's personal address.
 *
 * Strategy: try the SendEmail binding first. If it throws (which
 * Cloudflare does on dev tiers when sending to a non-verified
 * recipient), fall back to the Email Routing REST API using
 * CLOUDFLARE_EMAIL_API_TOKEN. Either path returns the same shape.
 */
export async function sendWelcomeEmail(
	env: Env,
	input: WelcomeEmailInput,
): Promise<{ messageId: string | null; transport: "binding" | "rest" }> {
	const subject = "You're joining InternJobs — here's how to get in";
	const text = renderWelcomeText(input);
	const html = renderWelcomeHtml(input);
	// Personalize the From identity to the inviting operator (e.g. Ridhi).
	// Default to noreply@internjobs.ai when the caller hasn't supplied a
	// resolved operator identity — keeps the path working for any legacy
	// callsite that hasn't been updated to pass inviterEmail.
	const from = input.inviterEmail || "noreply@internjobs.ai";

	// Path A: SendEmail binding (primary).
	if (env.EMAIL) {
		try {
			const result = await env.EMAIL.send({
				to: input.to,
				from,
				subject,
				text,
				html,
			} as Parameters<SendEmail["send"]>[0]);
			return { messageId: result.messageId ?? null, transport: "binding" };
		} catch (e) {
			console.warn(
				"sendWelcomeEmail: SendEmail binding failed, falling back to REST:",
				(e as Error).message,
			);
		}
	}

	// Path B: REST fallback.
	if (!env.CLOUDFLARE_EMAIL_API_TOKEN || !env.CLOUDFLARE_EMAIL_ACCOUNT_ID) {
		throw new Error(
			"sendWelcomeEmail: SendEmail binding unavailable and CLOUDFLARE_EMAIL_API_TOKEN / CLOUDFLARE_EMAIL_ACCOUNT_ID are not set.",
		);
	}

	const url = `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_EMAIL_ACCOUNT_ID}/email/routing/email`;
	const res = await fetch(url, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${env.CLOUDFLARE_EMAIL_API_TOKEN}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			from,
			to: [input.to],
			subject,
			text,
			html,
		}),
	});

	if (!res.ok) {
		const body = await res.text().catch(() => "");
		throw new Error(
			`sendWelcomeEmail: REST send failed (${res.status}): ${body.slice(0, 500)}`,
		);
	}

	const json = (await res.json().catch(() => null)) as
		| { result?: { id?: string }; messageId?: string }
		| null;
	const messageId =
		(json && (json.messageId ?? json.result?.id)) || null;
	return { messageId, transport: "rest" };
}

/**
 * Create a Cloudflare Email Routing rule that forwards inbound mail
 * for `workspaceEmail` to the Parrot Worker.
 *
 * Cloudflare Email Routing models forwarding rules at the zone level:
 *   POST /zones/{zone_id}/email/routing/rules
 *
 * For an employee mailbox the cleanest mapping is:
 *   matchers: [{ type: "literal", field: "to", value: alice.smith@internjobs.ai }]
 *   actions:  [{ type: "worker", value: ["internjobs-parrot"] }]
 *
 * which routes the message into the Worker's `email()` handler with
 * `event.to === alice.smith@internjobs.ai`. The Worker then dispatches
 * to the right EmployeeMailboxDO.
 *
 * Returns the rule id (used to disable the rule later in the
 * /api/admin/employees DELETE handler).
 */
export async function createEmailRoutingRule(
	env: Env,
	workspaceEmail: string,
): Promise<{ id: string }> {
	if (!env.CLOUDFLARE_EMAIL_ROUTING_API_TOKEN || !env.CLOUDFLARE_INTERNJOBS_ZONE_ID) {
		throw new Error(
			"createEmailRoutingRule: CLOUDFLARE_EMAIL_ROUTING_API_TOKEN / CLOUDFLARE_INTERNJOBS_ZONE_ID not configured.",
		);
	}

	const url = `https://api.cloudflare.com/client/v4/zones/${env.CLOUDFLARE_INTERNJOBS_ZONE_ID}/email/routing/rules`;
	const payload = {
		enabled: true,
		name: `parrot: ${workspaceEmail}`,
		priority: 50,
		matchers: [
			{ type: "literal", field: "to", value: workspaceEmail },
		],
		actions: [{ type: "worker", value: ["internjobs-parrot"] }],
	};
	const res = await fetch(url, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${env.CLOUDFLARE_EMAIL_ROUTING_API_TOKEN}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify(payload),
	});
	if (!res.ok) {
		const body = await res.text().catch(() => "");
		throw new Error(
			`createEmailRoutingRule: ${res.status} ${body.slice(0, 500)}`,
		);
	}
	const json = (await res.json()) as {
		result?: { id?: string };
		errors?: unknown;
		success?: boolean;
	};
	if (!json.success || !json.result?.id) {
		throw new Error(
			`createEmailRoutingRule: CF returned !success (${JSON.stringify(json).slice(0, 500)})`,
		);
	}
	return { id: json.result.id };
}

export async function disableEmailRoutingRule(
	env: Env,
	ruleId: string,
): Promise<void> {
	if (!env.CLOUDFLARE_EMAIL_ROUTING_API_TOKEN || !env.CLOUDFLARE_INTERNJOBS_ZONE_ID) {
		throw new Error(
			"disableEmailRoutingRule: provisioning secrets missing.",
		);
	}
	const url = `https://api.cloudflare.com/client/v4/zones/${env.CLOUDFLARE_INTERNJOBS_ZONE_ID}/email/routing/rules/${ruleId}`;
	const res = await fetch(url, {
		method: "PATCH",
		headers: {
			Authorization: `Bearer ${env.CLOUDFLARE_EMAIL_ROUTING_API_TOKEN}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({ enabled: false }),
	});
	if (!res.ok) {
		const body = await res.text().catch(() => "");
		throw new Error(
			`disableEmailRoutingRule: ${res.status} ${body.slice(0, 500)}`,
		);
	}
}
