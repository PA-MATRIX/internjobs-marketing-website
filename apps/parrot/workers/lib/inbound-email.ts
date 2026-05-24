// v1.2 Phase 12-fix 2026-05-19: Inbound email handler for Parrot.
//
// Replaces the Wave-1 stub in workers/app.ts that drained the stream and
// discarded the message. Cloudflare Email Routing delivers a raw MIME
// stream + size hint via the Worker's `email()` export; this module
// parses it (postal-mime), resolves the recipient to an employee via
// the WorkspaceDO directory, writes the email into the per-employee
// EmployeeMailboxDO's Inbox folder, and lets the existing Phase 12
// fire-and-forget hook (extractTodosFromEmail) extract todos.
//
// Forked from apps/agentic-inbox/workers/index.ts::receiveEmail with two
// adaptations:
//   1. Lookup mechanism: agentic-inbox uses a static EMAIL_ADDRESSES env
//      var + R2 head check. Parrot uses WorkspaceDO.getEmployeeByWorkspaceEmail()
//      since the alias-to-clerk_user_id mapping is dynamic (provisioned
//      by /api/admin/invite during onboarding).
//   2. No agent auto-draft. agentic-inbox dispatches an EmailAgent
//      "onNewEmail" call after createEmail; Parrot doesn't have one
//      (Phase 12's mothership agent extracts TODOS — not drafts — and
//      it's already wired inside EmployeeMailboxDO.createEmail() as a
//      fire-and-forget call.)
//
// Skills referenced:
//   cloudflare/skills: durable-objects, email-routing
//   postal-mime — MIME parsing for the raw stream Email Routing hands us

import PostalMime from "postal-mime";
import { Folders } from "../../shared/folders";
import type { Env } from "../types";
// v1.3 Phase 20 SAFETY-01: Lakera Guard pre-LLM screen for inbound email.
import { screenMessage } from "./safety";

// Stream → ArrayBuffer. The size hint lets us preallocate without a
// growing chain of Uint8Array concatenations.
async function streamToArrayBuffer(
	stream: ReadableStream,
	sizeHint: number,
): Promise<ArrayBuffer> {
	const result = new Uint8Array(sizeHint);
	let offset = 0;
	const reader = stream.getReader();
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		// If the actual stream is larger than the hint (rare but possible),
		// fall back to a growing array. Email Routing's hint is usually exact.
		if (offset + value.byteLength > result.byteLength) {
			const grown = new Uint8Array(offset + value.byteLength);
			grown.set(result.subarray(0, offset));
			grown.set(value, offset);
			return grown.buffer as ArrayBuffer;
		}
		result.set(value, offset);
		offset += value.byteLength;
	}
	return result.subarray(0, offset).buffer as ArrayBuffer;
}

// Pull a clean RFC-5322 Message-ID out of an angle-bracketed string or a
// whitespace-separated reference list token.
function extractMsgId(raw: string): string {
	const m = raw.match(/<([^>]+)>/);
	return m ? m[1] : raw.trim().split(/\s+/)[0];
}

// The shape WorkspaceDO.getEmployeeByWorkspaceEmail returns. Kept loose
// (cross-DO RPC calls go through `any` since the type imports would
// pull in the WorkspaceDO module which the email handler shouldn't be
// coupled to).
interface EmployeeLookupRow {
	id: string;
	clerk_user_id: string;
	workspace_email: string;
	display_name: string;
	status: "invited" | "active" | "disabled";
}

export async function receiveEmail(
	event: { raw: ReadableStream; rawSize: number },
	env: Env,
	ctx: ExecutionContext,
): Promise<void> {
	// NOTE (SAFETY-SCOPE-01): Mattermost inbound is polled via EmployeeMailboxDO
	// alarm and is NOT screened by Lakera in v1.3. Internal channel, wrong risk
	// profile, wastes quota. Explicitly out of scope.
	const rawEmail = await streamToArrayBuffer(event.raw, event.rawSize);
	const parsed = await new PostalMime().parse(rawEmail);

	if (!parsed.to?.length || !parsed.to[0].address) {
		throw new Error("Parrot inbound: empty To: header");
	}

	const toRecipients = parsed.to
		.map((t) => t.address?.toLowerCase())
		.filter(Boolean) as string[];
	const ccRecipients = (parsed.cc || [])
		.map((e) => e.address?.toLowerCase())
		.filter(Boolean) as string[];
	const bccRecipients = (parsed.bcc || [])
		.map((e) => e.address?.toLowerCase())
		.filter(Boolean) as string[];

	// Resolve any To: address to a Parrot employee. We don't trust Cc/Bcc
	// for ownership (a forwarded thread could put an employee on Cc — that
	// email belongs to the To: recipient, not the Cc'd employee).
	const workspaceStub = env.WORKSPACE.get(
		env.WORKSPACE.idFromName("workspace"),
	);

	let employee: EmployeeLookupRow | null = null;
	for (const addr of toRecipients) {
		const row = (await (
			workspaceStub as unknown as {
				getEmployeeByWorkspaceEmail(
					email: string,
				): Promise<EmployeeLookupRow | null>;
			}
		).getEmployeeByWorkspaceEmail(addr)) as EmployeeLookupRow | null;
		if (row && row.status !== "disabled") {
			employee = row;
			break;
		}
	}

	if (!employee) {
		console.log(
			`Parrot inbound: no employee matches recipients ${JSON.stringify(toRecipients)} — dropping (rawSize=${event.rawSize})`,
		);
		return;
	}

	const messageId = crypto.randomUUID();

	// Persist attachments to R2 keyed by the employee's clerk_user_id so
	// the per-employee scoping rule holds at the storage layer too. Same
	// folder-convention as the rest of the Parrot DO.
	const attachmentData: Array<{
		id: string;
		email_id: string;
		filename: string;
		mimetype: string;
		size: number;
		content_id: string | null;
		disposition: string;
	}> = [];

	if (parsed.attachments) {
		for (const att of parsed.attachments) {
			const attId = crypto.randomUUID();
			const filename = (att.filename || "untitled").replace(
				// eslint-disable-next-line no-control-regex
				/[\\/\\\\:*?"<>|\x00-\x1f]/g,
				"_",
			);
			const r2Key = `attachments/${employee.clerk_user_id}/${messageId}/${attId}/${filename}`;
			await env.BUCKET.put(r2Key, att.content);
			attachmentData.push({
				id: attId,
				email_id: messageId,
				filename,
				mimetype: att.mimeType,
				size:
					typeof att.content === "string"
						? att.content.length
						: (att.content as ArrayBuffer).byteLength,
				content_id: att.contentId || null,
				disposition: att.disposition || "attachment",
			});
		}
	}

	// Threading: prefer References (oldest ancestor), then In-Reply-To,
	// then this message's own id (the new thread root).
	const inReplyTo = parsed.inReplyTo ? extractMsgId(parsed.inReplyTo) : null;
	const emailReferences = parsed.references
		? parsed.references.split(/\s+/).filter(Boolean).map(extractMsgId)
		: [];
	const threadId = emailReferences[0] || inReplyTo || messageId;
	const originalMessageId = parsed.messageId
		? extractMsgId(parsed.messageId)
		: null;

	const mailboxStub = env.EMPLOYEE_MAILBOX.get(
		env.EMPLOYEE_MAILBOX.idFromName(employee.clerk_user_id),
	);

	// v1.3 SAFETY-01: Pre-LLM screen before EmployeeMailboxDO.createEmail()
	// which triggers extractTodosFromEmail() → kimi-k2.6 LLM call.
	//
	// Scope discipline:
	//   - Internal Mattermost messages: NOT screened (polled separately, not in this path)
	//   - Known startup_members: check PARROT_FEATURE_FLAGS KV allowlist
	//     (key: "safety_skip_senders", value: comma-separated emails).
	//     Full Neon lookup deferred to v1.4 (Worker has no Neon binding for
	//     startup_members table lookup — using KV allowlist as proxy).
	//   - Cold email (unknown sender): ALWAYS screened.
	//
	// Email hard-block policy (SAFETY-RESPONSE-02):
	//   No auto-reply on hard-block — out-of-office loop risk.
	//   Log to structured console + safety_events (best-effort).
	const emailBody = parsed.html || parsed.text || "";
	const senderEmail = (parsed.from?.address || "").toLowerCase();

	// Check KV allowlist for known startup senders (skip screening for them).
	// User-provisioned: `wrangler kv:key put --binding=PARROT_FEATURE_FLAGS
	// safety_skip_senders "a@x.com,b@y.com"`. Enumerate startup_members
	// emails manually pending v1.4 Neon-binding work.
	let skipScreen = false;
	if (env.PARROT_FEATURE_FLAGS && senderEmail) {
		const skipList = await env.PARROT_FEATURE_FLAGS.get("safety_skip_senders").catch(
			() => null,
		);
		if (skipList) {
			const allowedSenders = skipList.split(",").map((s: string) => s.trim().toLowerCase());
			skipScreen = allowedSenders.includes(senderEmail);
		}
	}

	if (!skipScreen && emailBody.length > 0) {
		const _screenStart = Date.now();
		const screenResult = await screenMessage(emailBody, env);
		const _screenMs = Date.now() - _screenStart;

		const injectionScore = screenResult.score ?? 0;
		// Lakera v2 returns a binary flag (no per-category score) — `flagged: true`
		// alone is sufficient to hard-block. The `>= 0.8` clause is the forward-compat
		// shim for if Lakera ever re-introduces a per-category numeric score.
		const isHardBlock = screenResult.flagged === true || injectionScore >= 0.8;

		if (screenResult.action !== "passed") {
			console.log(
				JSON.stringify({
					level: "info",
					event: "lakera_screen",
					action: screenResult.action,
					reason: screenResult.reason,
					score: screenResult.score,
					channel: "email",
					hard_block: isHardBlock,
					sender: senderEmail.slice(-20), // partial — avoid PII in logs
					employee_id: employee.id,
					preview: emailBody.slice(0, 80),
				}),
			);

			// Neon-exit (2026-05-21): write safety_events via the student app's
			// internal API — the DB moved off Neon and a Worker can't reach a
			// Fly-internal Postgres. Registered with ctx.waitUntil so CF keeps
			// the Worker alive until the write finishes — a bare fire-and-forget
			// fetch can be cut off when the email handler returns, dropping the
			// safety audit row. Does not block email ingest (not awaited).
			if (env.STUDENT_API_URL && env.STUDENT_API_SECRET) {
				ctx.waitUntil(
					fetch(`${env.STUDENT_API_URL}/internal/safety-events`, {
						method: "POST",
						headers: {
							authorization: `Bearer ${env.STUDENT_API_SECRET}`,
							"content-type": "application/json",
						},
						body: JSON.stringify({
							channel: "email",
							action: isHardBlock ? "blocked" : screenResult.action,
							reason: screenResult.reason,
							score: screenResult.score,
							sender_last4: senderEmail.slice(-4),
							preview: emailBody.slice(0, 80),
							employee_id: employee.id,
						}),
					}).catch((err: unknown) => {
						console.error(
							JSON.stringify({
								level: "error",
								event: "safety_events_write_failed",
								error: (err as Error)?.message ?? String(err),
							}),
						);
					}),
				);
			}
		}

		console.log(JSON.stringify({ level: "debug", event: "lakera_latency_ms", ms: _screenMs, channel: "email" }));

		if (isHardBlock) {
			// SAFETY-RESPONSE-02: NO auto-reply on hard-block. Out-of-office
			// loop risk: if blocked email is from an automated sender, an
			// auto-reply triggers their auto-responder → infinite loop.
			// Operator reviews /ops/safety and replies manually.
			console.warn(
				JSON.stringify({
					level: "warn",
					event: "lakera_hard_block_email",
					employee_id: employee.id,
					reason: screenResult.reason,
					preview: emailBody.slice(0, 80),
				}),
			);
			return; // Drop silently — no createEmail(), no todo extraction, no auto-reply
		}
		// Soft-flag or fail-open: proceed to createEmail() normally.
	}

	// This call triggers EmployeeMailboxDO.createEmail() → which fires
	// the Phase 12 fire-and-forget extractTodosFromEmail() hook when
	// folder=Inbox. That's the whole point of this handler.
	await (
		mailboxStub as unknown as {
			createEmail(
				folder: string,
				email: {
					id: string;
					subject: string;
					sender: string;
					recipient: string;
					cc: string | null;
					bcc: string | null;
					date: string;
					body: string;
					in_reply_to: string | null;
					email_references: string | null;
					thread_id: string | null;
					message_id: string | null;
					raw_headers: string | null;
				},
				attachments: typeof attachmentData,
			): Promise<unknown>;
		}
	).createEmail(
		Folders.INBOX,
		{
			id: messageId,
			subject: parsed.subject || "",
			sender: (parsed.from?.address || "").toLowerCase(),
			recipient: toRecipients.join(", "),
			cc: ccRecipients.join(", ") || null,
			bcc: bccRecipients.join(", ") || null,
			date: new Date().toISOString(),
			body: parsed.html || parsed.text || "",
			in_reply_to: inReplyTo,
			email_references:
				emailReferences.length > 0 ? JSON.stringify(emailReferences) : null,
			thread_id: threadId,
			message_id: originalMessageId,
			raw_headers: JSON.stringify(parsed.headers),
		},
		attachmentData,
	);

	console.log(
		`Parrot inbound: routed to ${employee.workspace_email} (employee=${employee.id}, msg=${messageId}, attachments=${attachmentData.length})`,
	);
}
