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
}

function renderWelcomeText(input: WelcomeEmailInput): string {
	const { employeeName, workspaceEmail, signinUrl } = input;
	return [
		`Hi ${employeeName},`,
		"",
		"Welcome to InternJobs! Your work email is ready:",
		"",
		`  ${workspaceEmail}`,
		"",
		"To sign in to the workspace (email, chat, meetings), open:",
		"",
		`  ${signinUrl}`,
		"",
		`When prompted, enter your work email (${workspaceEmail}). We'll send a one-time code to that mailbox; the code will be forwarded to this address so you can paste it back in.`,
		"",
		"— The InternJobs team",
	].join("\n");
}

function renderWelcomeHtml(input: WelcomeEmailInput): string {
	const { employeeName, workspaceEmail, signinUrl } = input;
	const safeName = escapeHtml(employeeName);
	const safeEmail = escapeHtml(workspaceEmail);
	const safeUrl = escapeHtml(signinUrl);
	return `<!doctype html>
<html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#0f172a">
  <h1 style="font-size:20px;margin:0 0 16px">Welcome to InternJobs, ${safeName}</h1>
  <p>Your work email is ready:</p>
  <p style="font-family:monospace;background:#f1f5f9;padding:12px;border-radius:6px"><strong>${safeEmail}</strong></p>
  <p>Sign in to the workspace (email, chat, meetings):</p>
  <p><a href="${safeUrl}" style="display:inline-block;background:#0f172a;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none">Open workspace</a></p>
  <p style="font-size:13px;color:#475569;margin-top:24px">When prompted, enter your work email (<strong>${safeEmail}</strong>). We'll send a one-time code to that mailbox; the code will be forwarded to this address so you can paste it back in.</p>
  <p style="font-size:13px;color:#475569">— The InternJobs team</p>
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
	const subject = "Welcome to InternJobs — your work email is ready";
	const text = renderWelcomeText(input);
	const html = renderWelcomeHtml(input);
	const from = "noreply@internjobs.ai";

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
