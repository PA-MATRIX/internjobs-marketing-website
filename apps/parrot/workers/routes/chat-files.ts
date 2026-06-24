// Phase 31 Wave 3 (plan 31-04): file/image upload + download proxy.
//
// CRITICAL (from 31-RESEARCH — do NOT buffer the upload):
//   The upload route MUST stream the request body straight through to
//   Mattermost using `c.req.raw.body` (a ReadableStream). Calling
//   `c.req.formData()` (or .arrayBuffer/.blob) would buffer the ENTIRE file
//   in Worker memory — a 50MB upload then risks OOM against the 128MB Worker
//   memory limit. We forward the multipart body + its Content-Type (which
//   carries the boundary) verbatim and let MM parse it.
//
// Auth: every route is gated by requireEmployeeMailbox (Clerk session →
//   c.var.employee). Both routes proxy AS the employee using their stored
//   Mattermost personal access token (PAT, Wave 0) so uploaded files belong
//   to the real MM user, not the parrot bot. No PAT yet → 503
//   chat_not_provisioned (same contract as the other /api/chat/* routes).
//
// GET /api/chat/files/:fileId forwards the UPSTREAM Content-Type header so
//   that <img src="/api/chat/files/:id"> renders inline in the browser. We
//   deliberately do NOT default to application/octet-stream (which would
//   force a download and break inline image preview in the message list).

import { Hono } from "hono";
import { requireEmployeeMailbox, type ParrotContext } from "../lib/mailbox";
import { getWorkspaceStub } from "../durableObject/workspace";

export const chatFilesRoute = new Hono<ParrotContext>();

// POST /api/chat/files?channel_id=:id — stream a multipart upload to MM.
chatFilesRoute.post("/", requireEmployeeMailbox, async (c) => {
	const channelId = c.req.query("channel_id");
	if (!channelId) return c.json({ error: "Missing channel_id" }, 400);

	const employee = c.var.employee;
	const stub = getWorkspaceStub(c.env);
	const tokenRow = await stub.getEmployeeToken(employee.employeeId);
	if (!tokenRow) return c.json({ error: "chat_not_provisioned" }, 503);

	const mmUrl = c.env.MATTERMOST_URL.replace(/\/$/, "");
	const upstreamResp = await fetch(
		`${mmUrl}/api/v4/files?channel_id=${encodeURIComponent(channelId)}`,
		{
			method: "POST",
			headers: {
				Authorization: `Bearer ${tokenRow.token}`,
				// Forward the multipart Content-Type verbatim — it carries the
				// boundary token MM needs to parse the form parts.
				"Content-Type": c.req.header("content-type") ?? "multipart/form-data",
			},
			// Stream the body straight through — NO buffering (c.req.formData()
			// would buffer the whole upload in memory). duplex:"half" is required
			// by the Fetch standard when the request body is a stream.
			body: c.req.raw.body,
			// @ts-expect-error duplex is required for a streaming request body but
			// is not yet in the lib.dom RequestInit type.
			duplex: "half",
		},
	);

	const data = await upstreamResp.json().catch(() => null);
	return c.json(data, upstreamResp.status as 200);
});

// GET /api/chat/files/:fileId — proxy a file download for inline preview.
chatFilesRoute.get("/:fileId", requireEmployeeMailbox, async (c) => {
	const fileId = c.req.param("fileId");
	const employee = c.var.employee;
	const stub = getWorkspaceStub(c.env);
	const tokenRow = await stub.getEmployeeToken(employee.employeeId);
	if (!tokenRow) return c.json({ error: "chat_not_provisioned" }, 503);

	const mmUrl = c.env.MATTERMOST_URL.replace(/\/$/, "");
	const upstream = await fetch(
		`${mmUrl}/api/v4/files/${encodeURIComponent(fileId)}`,
		{ headers: { Authorization: `Bearer ${tokenRow.token}` } },
	);
	if (!upstream.ok) {
		return c.json({ error: "file_not_found" }, upstream.status as 404);
	}

	// IMPORTANT: forward the upstream Content-Type so the browser renders images
	// inline. Defaulting to application/octet-stream would force a download and
	// break inline <img> preview in the message list.
	const contentType =
		upstream.headers.get("Content-Type") ?? "application/octet-stream";
	return new Response(upstream.body, {
		status: 200,
		headers: {
			"Content-Type": contentType,
			"Content-Disposition":
				upstream.headers.get("Content-Disposition") ?? "inline",
			"Cache-Control": "private, max-age=3600",
		},
	});
});
