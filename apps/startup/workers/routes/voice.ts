// apps/startup/workers/routes/voice.ts
// v1.4 Phase 29-02 STARTUP-VOICE-01 — Telnyx Voice AI Agent webhook handlers.
//
// Three endpoints, all mounted under the same router (registered in app.ts):
//
//   POST /webhooks/telnyx/voice-init
//     Pre-call dynamic-variables hook. Telnyx calls this BEFORE the AI agent
//     greets the caller. Must respond within ~1s. Returns:
//       { dynamic_variables: { mcp_token?: "..." } }
//     For pilot v1.4, the global TELNYX_VOICE_AGENT_TOKEN is the per-agent
//     Bearer for MCP calls — we don't inject per-caller tokens here (v1.5
//     follow-up). Always returns {} (empty dynamic_variables) for pilot.
//
//   POST /webhooks/telnyx/voice-postprocess
//     Post-call insights hook. Telnyx calls this AFTER the call ends with the
//     transcript + recording URL. We download the recording, store both
//     transcript JSON and mp3 to the VOICE_AUDIT R2 bucket, and detect
//     partial/abandoned calls (short transcript) to trigger an SMS recovery
//     prompt for the caller to dial back.
//
//   POST /webhooks/telnyx/voice-tool
//     Webhook-tool fallback (active when env.TELNYX_USE_MCP_INTEGRATION !== 'true').
//     Telnyx Voice AI's webhook-tool protocol sends tool_name + tool_arguments
//     here as an alternative to the MCP integration path. We map the tool
//     name (register_startup, show_candidate) to the existing handlers and
//     return { result: <json-string> }.
//
// ALL THREE return 200 even on internal errors — Telnyx retries are noisy and
// the agent conversation flow tolerates a single missed hook better than a
// retry storm. The only 401-worthy path would be signature verify, but
// Telnyx's Voice AI hooks (as of 2026-05) do NOT use the same Ed25519
// signature scheme as the SMS webhook — we rely on URL-secrecy + Bearer
// patterns from the portal config. (If signature verify gets added later,
// mirror the routes/telnyx.ts pattern.)
//
// R2 audit log layout:
//   recordings/{startup_id}/{call_control_id}.mp3
//   transcripts/{startup_id}/{call_control_id}.json
//
// When the caller hasn't been resolved to a startup yet (new caller mid-
// onboarding) we use startup_id='onboarding' as the R2 path prefix. Operator
// can re-key these later once the registration row exists.
//
// IMPORTANT — post-call payload field names are LOW confidence per
// 29-RESEARCH.md. The handler logs the FULL raw body on every call (for now;
// can be tightened post-pilot) so field-name drift is debuggable from
// `wrangler tail` output. TODO: prune the log after first 5 successful calls
// confirm the schema.

import { Hono } from "hono";
import type { Env, StartupContext } from "../types";
import { resolveChannelLink } from "../lib/resolveChannelLink";
import { sendSms } from "../lib/telnyx";
import { writeAuditLog, hashParams } from "../lib/audit";
import { handleRegisterStartupFromVoice } from "../lib/voice-onboarding";
import { handleExecute, type ExecuteAction } from "../tools/execute";

// ── Phone extraction helpers ─────────────────────────────────────────────────
// Telnyx Voice AI payload shape is similar to SMS but field names differ. We
// fan out across both shapes defensively.
function extractCallerPhone(body: unknown): string {
	if (!body || typeof body !== "object") return "";
	const b = body as Record<string, unknown>;
	// Voice AI pre-call hook shape: { data: { payload: { from: { phone_number } } } }
	const data = b.data as Record<string, unknown> | undefined;
	const payload = data?.payload as Record<string, unknown> | undefined;
	const from = payload?.from as Record<string, unknown> | undefined;
	const fromPhoneNumber =
		typeof from?.phone_number === "string" ? (from.phone_number as string) : "";
	if (fromPhoneNumber) return fromPhoneNumber;
	// Alternative flat shape: { from: "+1..." } or { caller_phone: "+1..." }
	if (typeof b.caller_phone === "string") return b.caller_phone as string;
	if (typeof b.from === "string") return b.from as string;
	// telnyx_end_user_target dynamic variable name from research doc
	if (typeof b.telnyx_end_user_target === "string")
		return b.telnyx_end_user_target as string;
	// dynamic_variables nested shape
	const dv = b.dynamic_variables as Record<string, unknown> | undefined;
	if (typeof dv?.telnyx_end_user_target === "string")
		return dv.telnyx_end_user_target as string;
	return "";
}

function extractCallControlId(body: unknown): string {
	if (!body || typeof body !== "object") return "unknown";
	const b = body as Record<string, unknown>;
	const data = b.data as Record<string, unknown> | undefined;
	const payload = data?.payload as Record<string, unknown> | undefined;
	if (typeof payload?.call_control_id === "string")
		return payload.call_control_id as string;
	if (typeof b.call_control_id === "string")
		return b.call_control_id as string;
	if (typeof b.call_session_id === "string")
		return b.call_session_id as string;
	return "unknown";
}

function extractTranscript(body: unknown): string {
	if (!body || typeof body !== "object") return "";
	const b = body as Record<string, unknown>;
	const data = b.data as Record<string, unknown> | undefined;
	const payload = data?.payload as Record<string, unknown> | undefined;
	if (typeof payload?.transcript === "string")
		return payload.transcript as string;
	if (typeof b.transcript === "string") return b.transcript as string;
	// Some Telnyx Voice AI variants nest transcript under insights.* or
	// conversation.* — defensive fan-out:
	const insights = b.insights as Record<string, unknown> | undefined;
	if (typeof insights?.transcript === "string")
		return insights.transcript as string;
	const conversation = b.conversation as Record<string, unknown> | undefined;
	if (typeof conversation?.transcript === "string")
		return conversation.transcript as string;
	return "";
}

function extractRecordingUrl(body: unknown): string | null {
	if (!body || typeof body !== "object") return null;
	const b = body as Record<string, unknown>;
	const data = b.data as Record<string, unknown> | undefined;
	const payload = data?.payload as Record<string, unknown> | undefined;
	if (typeof payload?.recording_url === "string")
		return payload.recording_url as string;
	if (typeof b.recording_url === "string") return b.recording_url as string;
	// Telnyx Call Recording API typically returns recording_urls.mp3
	const recordingUrls = payload?.recording_urls as
		| Record<string, unknown>
		| undefined;
	if (typeof recordingUrls?.mp3 === "string")
		return recordingUrls.mp3 as string;
	const topRecordingUrls = b.recording_urls as
		| Record<string, unknown>
		| undefined;
	if (typeof topRecordingUrls?.mp3 === "string")
		return topRecordingUrls.mp3 as string;
	return null;
}

// ── Tool-name → MCP action mapping (webhook-tool fallback path) ───────────────
// Telnyx tool names may differ from the action enum used internally. Map them
// here so we can rename in either system without breaking the other.
const TOOL_NAME_TO_ACTION: Record<string, ExecuteAction> = {
	register_startup: "register_startup",
	show_candidate: "show_candidate",
	post_role: "post_role",
	reply_to_candidate: "reply_to_candidate",
	update_role: "update_role",
	archive_role: "archive_role",
	mark_candidate: "mark_candidate",
};

// ── Hono router ───────────────────────────────────────────────────────────────

export const voiceRouter = new Hono<{ Bindings: Env }>();

// ─── POST /webhooks/telnyx/voice-init ────────────────────────────────────────
// Pre-call dynamic-variables hook. Must respond fast (Telnyx times out at ~1s).
//
// Returns: { dynamic_variables: { mcp_token?: "..." } }
//
// PILOT SIMPLIFICATION (v1.5 follow-up): always return {} for dynamic_variables.
// The Voice AI agent uses the global TELNYX_VOICE_AGENT_TOKEN (configured per-
// agent in the Telnyx portal, DEFER-29-02-C) as its MCP Bearer — per-caller
// token injection requires a new endpoint to mint short-lived tokens, which
// isn't load-bearing for the pilot. TODO: add /v1/startups/:id/voice-token in
// v1.5 to support per-startup token scoping during call.
voiceRouter.post("/webhooks/telnyx/voice-init", async (c) => {
	const env = c.env;
	let body: unknown = {};
	try {
		body = await c.req.json();
	} catch {
		// fall through with empty body — voice-init must not 500
	}

	const callerPhone = extractCallerPhone(body);

	// Best-effort identity resolution to log who's calling (for ops dashboard
	// signal — not used to inject anything in the response yet).
	let ctx: StartupContext | null = null;
	if (callerPhone) {
		ctx = await resolveChannelLink(env, "telnyx-voice", callerPhone);
	}

	console.log(
		JSON.stringify({
			level: "info",
			event: "startup_voice_init",
			caller_phone_preview: callerPhone.slice(0, 6),
			startup_id: ctx?.startup_id ?? null,
			known_caller: ctx !== null,
		}),
	);

	// Pilot v1.4: empty dynamic_variables. The Voice AI agent uses the global
	// TELNYX_VOICE_AGENT_TOKEN configured in the portal as its MCP Bearer.
	// TODO(v1.5): mint a per-call short-lived MCP token here for known callers.
	return c.json({ dynamic_variables: {} });
});

// ─── POST /webhooks/telnyx/voice-postprocess ─────────────────────────────────
// Post-call insights hook. Telnyx calls this after the call ends with
// transcript + (eventually) recording URL.
//
// Behavior:
//   1. Log full raw payload (LOW-confidence field names per research)
//   2. Extract call_control_id, caller_phone, transcript, recording_url
//   3. Resolve startup_id via channel-link lookup (fallback to 'onboarding')
//   4. Store transcript JSON → R2 transcripts/{startup_id}/{call_control_id}.json
//   5. Fetch recording_url + store mp3 → R2 recordings/{startup_id}/{call_control_id}.mp3
//   6. If transcript empty/short AND caller_phone known → send SMS recovery prompt
//   7. Audit log with channel='telnyx-voice', action='voice_call'
voiceRouter.post("/webhooks/telnyx/voice-postprocess", async (c) => {
	const env = c.env;
	let body: unknown = {};
	try {
		body = await c.req.json();
	} catch {
		console.warn(
			JSON.stringify({
				level: "warn",
				event: "startup_voice_postprocess_invalid_json",
			}),
		);
		return c.json({ ok: true });
	}

	// 1. Log full raw payload — field names are LOW confidence (29-RESEARCH.md).
	//    TODO: trim this to the structured fields once schema is confirmed by
	//    first 5 production calls.
	console.log(
		JSON.stringify({
			level: "info",
			event: "startup_voice_postprocess_raw",
			raw_payload: body,
		}),
	);

	// 2. Extract fields defensively.
	const callControlId = extractCallControlId(body);
	const callerPhone = extractCallerPhone(body);
	const transcript = extractTranscript(body);
	const recordingUrl = extractRecordingUrl(body);

	// 3. Resolve startup context (or fallback to 'onboarding' for partial calls
	//    during registration flow — caller may not yet have a channel-link row).
	let ctx: StartupContext | null = null;
	if (callerPhone) {
		ctx = await resolveChannelLink(env, "telnyx-voice", callerPhone);
	}
	const startupId = ctx?.startup_id ?? "onboarding";

	// 4. Store transcript JSON to R2 if binding is bound (DEFER-29-02-B).
	if (env.VOICE_AUDIT) {
		try {
			await env.VOICE_AUDIT.put(
				`transcripts/${startupId}/${callControlId}.json`,
				JSON.stringify({
					transcript,
					call_control_id: callControlId,
					caller_phone: callerPhone,
					startup_id: startupId,
					timestamp: new Date().toISOString(),
					raw_payload: body,
				}),
				{ httpMetadata: { contentType: "application/json" } },
			);
		} catch (err) {
			console.warn(
				JSON.stringify({
					level: "warn",
					event: "startup_voice_postprocess_r2_transcript_failed",
					error: (err as Error)?.message ?? String(err),
					call_control_id: callControlId,
				}),
			);
		}
	} else {
		console.warn(
			JSON.stringify({
				level: "warn",
				event: "startup_voice_postprocess_r2_unbound",
				note: "VOICE_AUDIT R2 binding unbound (DEFER-29-02-B) — skipping transcript persist",
				call_control_id: callControlId,
			}),
		);
	}

	// 5. Fetch + persist recording mp3 if URL provided + R2 bound.
	if (env.VOICE_AUDIT && recordingUrl) {
		try {
			const audioRes = await fetch(recordingUrl, {
				signal: AbortSignal.timeout(30000),
			});
			if (audioRes.ok) {
				const audioBuffer = await audioRes.arrayBuffer();
				await env.VOICE_AUDIT.put(
					`recordings/${startupId}/${callControlId}.mp3`,
					audioBuffer,
					{ httpMetadata: { contentType: "audio/mpeg" } },
				);
			} else {
				console.warn(
					JSON.stringify({
						level: "warn",
						event: "startup_voice_postprocess_recording_fetch_non_ok",
						status: audioRes.status,
						call_control_id: callControlId,
					}),
				);
			}
		} catch (err) {
			console.warn(
				JSON.stringify({
					level: "warn",
					event: "startup_voice_postprocess_recording_fetch_error",
					error: (err as Error)?.message ?? String(err),
					call_control_id: callControlId,
				}),
			);
		}
	}

	// 6. Partial/abandoned call detection. Voice intake should yield > 50 chars
	//    once all 4 questions are answered. Empty or very short transcripts
	//    indicate a hangup mid-flow. If we have the caller's phone, prompt them
	//    via SMS to call back.
	const isAbandoned = transcript.length < 50;
	if (isAbandoned && callerPhone) {
		await sendSms(
			env,
			callerPhone,
			"looks like we got cut off. call us back to finish your internjobs registration!",
		);
	}

	// 7. Audit log.
	await writeAuditLog(env, {
		member_id: ctx?.member_id ?? "onboarding",
		startup_id: startupId,
		channel: "telnyx-voice",
		action: "voice_call",
		status: "ok",
		params_hash: await hashParams({
			call_control_id: callControlId,
			caller_phone_preview: callerPhone.slice(0, 6),
			transcript_chars: transcript.length,
			abandoned: isAbandoned,
		}),
	});

	return c.json({ ok: true });
});

// ─── POST /webhooks/telnyx/voice-tool ────────────────────────────────────────
// Webhook-tool fallback path. Active when env.TELNYX_USE_MCP_INTEGRATION !==
// 'true' (e.g. MCP Servers tab is plan-gated and Ridhi configured webhook
// tools in the Telnyx portal instead).
//
// Telnyx Voice AI webhook-tool protocol sends:
//   { tool_name: "register_startup", tool_arguments: {...},
//     call_control_id: "...", ... }
//
// We map tool_name to an ACTION_HANDLERS key and dispatch to either
// handleRegisterStartupFromVoice (for the onboarding tool — needs the
// admin-secret loopback) or handleExecute (for any other authenticated tool —
// rare in pilot, but supported).
voiceRouter.post("/webhooks/telnyx/voice-tool", async (c) => {
	const env = c.env;

	// Feature flag gate: if MCP integration is enabled, this webhook should
	// never be called. Log a warning if it is (misconfig in Telnyx portal).
	if (env.TELNYX_USE_MCP_INTEGRATION === "true") {
		console.warn(
			JSON.stringify({
				level: "warn",
				event: "startup_voice_tool_unexpected",
				note: "TELNYX_USE_MCP_INTEGRATION=true but voice-tool webhook was called — Telnyx portal config likely points at this endpoint anyway",
			}),
		);
		// Still process the call — failing here would just break the agent flow.
	}

	let body: unknown = {};
	try {
		body = await c.req.json();
	} catch {
		console.warn(
			JSON.stringify({
				level: "warn",
				event: "startup_voice_tool_invalid_json",
			}),
		);
		return c.json({ result: JSON.stringify({ ok: false, error: "invalid_json" }) });
	}

	const b = body as Record<string, unknown>;
	const toolName = typeof b.tool_name === "string" ? (b.tool_name as string) : "";
	const toolArgs =
		(b.tool_arguments as Record<string, unknown> | undefined) ?? {};
	const action = TOOL_NAME_TO_ACTION[toolName];

	if (!action) {
		console.warn(
			JSON.stringify({
				level: "warn",
				event: "startup_voice_tool_unknown",
				tool_name: toolName,
			}),
		);
		return c.json({
			result: JSON.stringify({
				ok: false,
				error: "unknown_tool",
				message: `tool '${toolName}' is not implemented`,
			}),
		});
	}

	// Caller phone — Telnyx injects {{telnyx_end_user_target}} into args if the
	// agent prompt asks it to. Falls back to inspecting body fields.
	const callerPhone =
		(typeof toolArgs.channel_external_id === "string"
			? (toolArgs.channel_external_id as string)
			: "") ||
		(typeof toolArgs.caller_phone === "string"
			? (toolArgs.caller_phone as string)
			: "") ||
		(typeof toolArgs.phone_number === "string"
			? (toolArgs.phone_number as string)
			: "") ||
		extractCallerPhone(body);

	// Onboarding path — register_startup uses the admin endpoint loopback.
	if (action === "register_startup") {
		const result = await handleRegisterStartupFromVoice(env, {
			company: String(toolArgs.company ?? ""),
			founder_name: String(toolArgs.founder_name ?? ""),
			founder_email: String(toolArgs.founder_email ?? ""),
			what_hiring_for: String(toolArgs.what_hiring_for ?? ""),
			caller_phone: callerPhone,
		});
		return c.json({ result: JSON.stringify(result) });
	}

	// All other actions need an authenticated startup context. Resolve via the
	// caller phone. If the caller isn't a known founder, refuse — voice-tool
	// only handles register_startup for new callers.
	const ctx = await resolveChannelLink(env, "telnyx-voice", callerPhone);
	if (!ctx) {
		return c.json({
			result: JSON.stringify({
				ok: false,
				error: "no_startup_context",
				message:
					"caller isn't linked to a startup yet — call register_startup first",
			}),
		});
	}

	const exec = await handleExecute({
		startup_id: ctx.startup_id,
		member_id: ctx.member_id,
		action,
		params: toolArgs,
		env,
	});
	return c.json({ result: JSON.stringify(exec) });
});
