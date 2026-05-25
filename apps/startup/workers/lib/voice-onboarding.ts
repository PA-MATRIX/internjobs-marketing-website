// apps/startup/workers/lib/voice-onboarding.ts
// v1.4 Phase 29-02 STARTUP-VOICE-02 — Voice AI onboarding helper.
//
// Called by:
//   • routes/voice.ts voice-tool handler (webhook-tool fallback path, when
//     TELNYX_USE_MCP_INTEGRATION !== 'true')
//   • Indirectly by tools/execute.ts handleRegisterStartup() when the Voice AI
//     agent calls `register_startup` via the MCP integration path
//
// Wraps the loopback `POST /admin/startups/new` admin endpoint with:
//   1. Work-email validation (mirrors execute.ts handleRegisterStartup)
//   2. Idempotency-on-founder-email: returns `already_registered=true` on 409
//      rather than throwing — Voice AI agent says "looks like you're already
//      in our system, I'll text you a fresh setup link" and recovers
//   3. SMS confirmation via lib/telnyx.ts sendSms() on success
//   4. Best-effort audit-log row with channel='telnyx-voice'
//
// Auth model: the admin endpoint requires STARTUP_MCP_ADMIN_SECRET (Bearer).
// The Voice AI agent NEVER holds this secret — it lives only in the Worker
// env. The webhook-tool path receives function args from Telnyx and this
// helper performs the privileged loopback fetch.

import type { Env } from "../types";
import { sendSms } from "./telnyx";
import { writeAuditLog, hashParams } from "./audit";
import { isPersonalEmailDomain } from "./workEmail";

export interface VoiceRegistrationArgs {
	company: string;
	founder_name: string;
	founder_email: string;
	what_hiring_for: string;
	caller_phone: string; // E.164 from telnyx_end_user_target dynamic variable
}

export type VoiceRegistrationResult =
	| {
			ok: true;
			startup_id: string;
			agent_email: string | null;
			mcp_install_snippet: string | null;
			already_registered: false;
	  }
	| {
			ok: false;
			error: string;
			message: string;
			already_registered: boolean;
	  };

/**
 * Mint a startup from a Voice AI intake call.
 *
 * Returns idempotent-friendly results on 409 (founder email already exists)
 * so the Voice AI agent can give the caller a clean "you're already in our
 * system" message without an exception bubbling up to the conversation layer.
 *
 * On success: fires the welcome SMS via lib/telnyx.ts sendSms() before
 * returning. SMS failure does NOT roll back the registration — sendSms is
 * fire-and-forget safe (logs a warning and returns without throwing when
 * TELNYX_* secrets are unbound or the API call fails).
 */
export async function handleRegisterStartupFromVoice(
	env: Env,
	args: VoiceRegistrationArgs,
): Promise<VoiceRegistrationResult> {
	// 1. Work-email validation (mirrors execute.ts handleRegisterStartup)
	if (isPersonalEmailDomain(args.founder_email)) {
		await writeAuditLog(env, {
			member_id: "onboarding",
			startup_id: "onboarding",
			channel: "telnyx-voice",
			action: "register_startup",
			status: "error",
			error_code: "personal_email_rejected",
			params_hash: await hashParams({
				company: args.company,
				email: args.founder_email,
			}),
		});
		return {
			ok: false,
			error: "personal_email_rejected",
			message:
				"work emails only — gmail/yahoo/outlook/etc are not accepted. ask the caller to use their company email.",
			already_registered: false,
		};
	}

	// 2. Admin endpoint loopback — Voice AI agent doesn't hold the admin secret.
	const adminSecret = env.STARTUP_MCP_ADMIN_SECRET;
	if (!adminSecret) {
		console.error(
			JSON.stringify({
				level: "error",
				event: "startup_voice_onboarding_no_admin_secret",
				note: "STARTUP_MCP_ADMIN_SECRET unbound — cannot mint",
			}),
		);
		await writeAuditLog(env, {
			member_id: "onboarding",
			startup_id: "onboarding",
			channel: "telnyx-voice",
			action: "register_startup",
			status: "error",
			error_code: "registration_unavailable",
		});
		return {
			ok: false,
			error: "registration_unavailable",
			message: "registration is temporarily offline — our team will follow up.",
			already_registered: false,
		};
	}

	const adminUrl = "https://mcp.internjobs.ai/admin/startups/new";
	let res: Response;
	try {
		res = await fetch(adminUrl, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${adminSecret}`,
			},
			body: JSON.stringify({
				company: args.company,
				founder_email: args.founder_email,
				founder_phone: args.caller_phone,
				founder_name: args.founder_name,
			}),
			signal: AbortSignal.timeout(15000),
		});
	} catch (err) {
		console.error(
			JSON.stringify({
				level: "error",
				event: "startup_voice_onboarding_admin_fetch_error",
				error: (err as Error)?.message ?? String(err),
			}),
		);
		await writeAuditLog(env, {
			member_id: "onboarding",
			startup_id: "onboarding",
			channel: "telnyx-voice",
			action: "register_startup",
			status: "error",
			error_code: "proxy_unavailable",
		});
		return {
			ok: false,
			error: "registration_failed",
			message:
				"we couldn't complete the registration just now. our team will follow up shortly.",
			already_registered: false,
		};
	}

	const data = (await res.json().catch(() => ({}))) as {
		ok?: boolean;
		startup_id?: string;
		token?: string;
		install_snippet?: { sms_body?: string };
		agent_email?: string | null;
		error?: string;
	};

	// 3. 409 — already registered. Idempotent recovery path (founder is calling
	//    back). Don't re-send the SMS install snippet (we don't have the token).
	//    Voice AI agent says "you're already in our system, check your inbox or
	//    reach ridhi@internjobs.ai".
	if (res.status === 409) {
		await writeAuditLog(env, {
			member_id: "onboarding",
			startup_id: "onboarding",
			channel: "telnyx-voice",
			action: "register_startup",
			status: "error",
			error_code: "already_registered",
		});
		return {
			ok: false,
			error: "already_registered",
			message:
				"looks like you're already in our system. check your inbox for the welcome email or reach out to ridhi@internjobs.ai for help.",
			already_registered: true,
		};
	}

	if (!res.ok) {
		console.error(
			JSON.stringify({
				level: "error",
				event: "startup_voice_onboarding_admin_failed",
				status: res.status,
				detail: data,
			}),
		);
		await writeAuditLog(env, {
			member_id: "onboarding",
			startup_id: "onboarding",
			channel: "telnyx-voice",
			action: "register_startup",
			status: "error",
			error_code: "registration_failed",
		});
		return {
			ok: false,
			error: "registration_failed",
			message:
				"we couldn't complete the registration just now. our team will follow up shortly.",
			already_registered: false,
		};
	}

	// 4. Success. Upsert the voice channel-link metadata (best-effort — failure
	//    here doesn't undo the startup creation).
	try {
		const base = env.STARTUP_API_URL.replace(/\/$/, "");
		await fetch(`${base}/v1/channel-links`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${env.STARTUP_API_SECRET}`,
			},
			body: JSON.stringify({
				startup_id: data.startup_id,
				channel_type: "telnyx-voice",
				channel_external_id: args.caller_phone,
				status: "active",
				opt_in_flags: { weekly_touchbase: true },
				metadata: {
					what_hiring_for: args.what_hiring_for,
					founder_name: args.founder_name,
					registered_via: "telnyx-voice",
				},
			}),
			signal: AbortSignal.timeout(5000),
		});
	} catch (err) {
		console.warn(
			JSON.stringify({
				level: "warn",
				event: "startup_voice_onboarding_channel_link_failed",
				error: (err as Error)?.message ?? String(err),
				startup_id: data.startup_id,
			}),
		);
	}

	// 5. Fire confirmation SMS — install snippet already contains the MCP setup
	//    line + Cursor JSON + ChatGPT hint (built by admin endpoint's
	//    buildInstallSnippet). For the voice intake, replace the default opener
	//    with a voice-specific confirmation so the founder knows the call
	//    completed successfully.
	//
	//    sendSms is fire-and-forget safe — never throws even if Telnyx errors.
	const smsBody = data.install_snippet?.sms_body
		? `your internjobs account is ready! ${data.install_snippet.sms_body}\n\nreply YES to get weekly candidate updates.`
		: `your internjobs account is ready! check your inbox for setup instructions, or reach ridhi@internjobs.ai. reply YES to get weekly candidate updates.`;
	await sendSms(env, args.caller_phone, smsBody);

	// 6. Audit success.
	await writeAuditLog(env, {
		member_id: "onboarding",
		startup_id: data.startup_id ?? "onboarding",
		channel: "telnyx-voice",
		action: "register_startup",
		status: "ok",
		params_hash: await hashParams({
			company: args.company,
			email: args.founder_email,
		}),
	});

	return {
		ok: true,
		startup_id: data.startup_id ?? "",
		agent_email: data.agent_email ?? null,
		mcp_install_snippet: data.install_snippet?.sms_body ?? null,
		already_registered: false,
	};
}
