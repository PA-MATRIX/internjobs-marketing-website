// Phase 31 Wave 4 (plan 31-05): Worker-proxied WebSocket for Mattermost real-time.
//
// Security invariant: the employee PAT NEVER reaches the browser. The Worker:
//   1. Resolves the employee PAT from WorkspaceDO
//   2. Opens an upstream WebSocket to Mattermost
//   3. Sends `authentication_challenge` with the PAT on upstream open (upstream
//      ONLY — this frame is never forwarded to the browser)
//   4. Only then begins bidirectional proxying of every other frame
//
// Why Worker-proxied (not browser → MM directly)? The browser would need the
// PAT to authenticate the MM socket; exposing the PAT client-side defeats the
// entire per-employee-PAT identity model (research Decision 3). Cloudflare
// Workers support WebSocket proxying via WebSocketPair + the `webSocket`
// Response field.
// Reference: https://developers.cloudflare.com/workers/runtime-apis/websockets/
//
// IMPORTANT (prod): chat.internjobs.ai (the nginx proxy in front of Fly MM)
// MUST pass `Upgrade: websocket` headers through to the Fly backend. If it does
// NOT, set MATTERMOST_WS_URL in wrangler.jsonc to point directly at
// wss://internjobs-mattermost.fly.dev. This is the open question from
// 31-RESEARCH (Question 3); resolve it in 31-06 prep and set the URL there.

import { getWorkspaceStub } from "../durableObject/workspace";
import type { Employee, Env } from "../types";

export async function handleChatWebSocket(
	request: Request,
	env: Env,
	employee: Employee,
): Promise<Response> {
	const upgradeHeader = request.headers.get("upgrade");
	if (upgradeHeader?.toLowerCase() !== "websocket") {
		return Response.json(
			{ error: "Expected WebSocket upgrade" },
			{ status: 426 },
		);
	}

	// Resolve the employee PAT from WorkspaceDO. We do NOT mint one here (no
	// admin token plumbing on the WS path) — the REST routes lazily mint the
	// PAT on the employee's first chat action, so by the time the client opens
	// a socket the token already exists. 503 if it doesn't yet.
	const stub = getWorkspaceStub(env);
	const tokenRow = await stub.getEmployeeToken(employee.employeeId);
	if (!tokenRow) {
		return Response.json({ error: "chat_not_provisioned" }, { status: 503 });
	}

	// Client-facing WebSocket pair: `client` is handed back in the 101 response,
	// `server` is the Worker's end that we pump bytes through.
	const pair = new WebSocketPair();
	const client = pair[0];
	const server = pair[1];

	// Derive the upstream URL. Cloudflare Workers open OUTBOUND WebSockets via
	// `fetch()` with an `Upgrade: websocket` header (the browser-style
	// `new WebSocket(url)` constructor is NOT supported for client connections in
	// the Workers runtime), so we use the http(s):// scheme here, not ws(s)://.
	// MATTERMOST_WS_URL overrides the host if the nginx proxy can't pass WS
	// upgrades (see header); it may be given as ws(s):// or http(s):// — normalize.
	const wsOverride = (env as unknown as { MATTERMOST_WS_URL?: string })
		.MATTERMOST_WS_URL;
	const mmUpgradeUrl =
		(wsOverride
			? wsOverride.replace(/^wss/, "https").replace(/^ws/, "http")
			: env.MATTERMOST_URL) + "/api/v4/websocket";

	// Open the upstream connection to Mattermost's WebSocket via fetch upgrade.
	let upstream: WebSocket;
	try {
		const upstreamResp = await fetch(mmUpgradeUrl, {
			headers: { Upgrade: "websocket", Connection: "Upgrade" },
		});
		const ws = upstreamResp.webSocket;
		if (!ws) {
			return Response.json(
				{ error: "upstream_ws_failed", status: upstreamResp.status },
				{ status: 502 },
			);
		}
		upstream = ws;
	} catch {
		return Response.json({ error: "upstream_ws_unreachable" }, { status: 502 });
	}

	// Accept the upstream socket, then authenticate with the PAT. This frame is
	// sent to MM ONLY and is never forwarded to the browser — the browser's
	// `server` socket only ever receives MM's RESPONSE frames (hello / posted /
	// typing / …), none of which echo the token back. With the fetch-upgrade
	// pattern the socket is already open after accept(), so there is no "open"
	// event to wait for — send the challenge immediately.
	upstream.accept();
	upstream.send(
		JSON.stringify({
			seq: 1,
			action: "authentication_challenge",
			data: { token: tokenRow.token },
		}),
	);

	// Bidirectional proxy. No filtering is required: the only place the PAT
	// appears is the authentication_challenge above, which is sent on `upstream`
	// directly (not relayed from `server`), so it can never leak downstream.
	upstream.addEventListener("message", (evt) => {
		if (server.readyState === WebSocket.OPEN) {
			server.send(evt.data as string | ArrayBuffer);
		}
	});
	server.addEventListener("message", (evt) => {
		if (upstream.readyState === WebSocket.OPEN) {
			upstream.send(evt.data as string | ArrayBuffer);
		}
	});

	upstream.addEventListener("close", (evt) => {
		try {
			server.close(evt.code || 1000, evt.reason || "upstream_closed");
		} catch {
			/* socket already closed — ignore */
		}
	});
	server.addEventListener("close", (evt) => {
		try {
			upstream.close(evt.code || 1000, evt.reason || "client_closed");
		} catch {
			/* socket already closed — ignore */
		}
	});

	upstream.addEventListener("error", () => {
		try {
			server.close(1011, "upstream_error");
		} catch {
			/* ignore */
		}
	});

	// server.accept() takes NO arguments in the Cloudflare Workers runtime.
	server.accept();

	return new Response(null, {
		status: 101,
		webSocket: client,
	});
}
