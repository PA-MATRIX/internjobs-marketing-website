// v1.3.1 patch: Mattermost embed proxy.
//
// Forwards chat.internjobs.ai/* → internjobs-mattermost.fly.dev/*
// and rewrites response headers so the Mattermost UI can be iframed
// from workspace.internjobs.ai.
//
// Why this exists:
//   Mattermost 11.6.2 hardcodes CSP `frame-ancestors 'self'` and
//   `X-Frame-Options: SAMEORIGIN`. There is no env-var override.
//   To embed Mattermost inside Parrot Workspace (workspace.internjobs.ai),
//   we need either a custom Mattermost build (painful upgrades) or
//   a reverse proxy that rewrites the iframe-blocking headers.
//
// Why on a SHARED root domain:
//   chat.internjobs.ai + workspace.internjobs.ai both sit under
//   .internjobs.ai, so the Mattermost session cookie is SAME-SITE for
//   the iframe and doesn't get blocked by browser third-party-cookie
//   policies. This is the whole reason for putting the proxy on its
//   own subdomain instead of just stripping headers in-place on Fly.
//
// What we proxy:
//   - All HTTP requests (GET/POST/PUT/DELETE/PATCH)
//   - WebSocket upgrades for /api/v4/websocket (chat realtime)
//
// Response header rewrites:
//   - DELETE x-frame-options (hardcoded SAMEORIGIN, blocks iframe)
//   - REPLACE content-security-policy frame-ancestors to include
//     https://workspace.internjobs.ai

interface Env {
	MATTERMOST_ORIGIN: string; // "https://internjobs-mattermost.fly.dev"
	ALLOWED_PARENT: string;    // "https://workspace.internjobs.ai"
}

const HOP_BY_HOP = new Set([
	"connection",
	"keep-alive",
	"proxy-authenticate",
	"proxy-authorization",
	"te",
	"trailers",
	"transfer-encoding",
	"upgrade",
]);

function rewriteCsp(original: string, allowedParent: string): string {
	// CSP is a single header with `;` separated directives.
	// Mattermost ships: `frame-ancestors 'self' ; script-src 'self'`
	// We replace the frame-ancestors directive to add allowedParent.
	const directives = original.split(";").map((d) => d.trim()).filter(Boolean);
	const rewritten = directives.map((d) => {
		if (d.toLowerCase().startsWith("frame-ancestors")) {
			return `frame-ancestors 'self' ${allowedParent}`;
		}
		return d;
	});
	// Defensive: if Mattermost ever drops the directive entirely, ADD it.
	if (!rewritten.some((d) => d.toLowerCase().startsWith("frame-ancestors"))) {
		rewritten.push(`frame-ancestors 'self' ${allowedParent}`);
	}
	return rewritten.join("; ");
}

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const incoming = new URL(request.url);
		const upstreamUrl = new URL(incoming.pathname + incoming.search, env.MATTERMOST_ORIGIN);

		// Forward as-is, preserving method + body + most headers.
		// Drop hop-by-hop headers and any host-coupled headers.
		const fwdHeaders = new Headers();
		for (const [k, v] of request.headers.entries()) {
			if (HOP_BY_HOP.has(k.toLowerCase())) continue;
			if (k.toLowerCase() === "host") continue;
			fwdHeaders.set(k, v);
		}
		// Tell the upstream the real host so it generates correct URLs.
		// Mattermost's SiteURL is also being set to chat.internjobs.ai so
		// most absolute-URL generation is correct without X-Forwarded-Host,
		// but we still set it for the few places that read the request host.
		fwdHeaders.set("x-forwarded-host", incoming.host);
		fwdHeaders.set("x-forwarded-proto", incoming.protocol.replace(":", ""));
		fwdHeaders.set("x-forwarded-for", request.headers.get("cf-connecting-ip") ?? "");

		const upstreamReq = new Request(upstreamUrl.toString(), {
			method: request.method,
			headers: fwdHeaders,
			body:
				request.method === "GET" || request.method === "HEAD"
					? undefined
					: request.body,
			redirect: "manual",
		});

		const upstreamRes = await fetch(upstreamReq);

		// Mirror the response, but rewrite iframe-blocking headers.
		const outHeaders = new Headers();
		for (const [k, v] of upstreamRes.headers.entries()) {
			const lk = k.toLowerCase();
			if (lk === "x-frame-options") {
				// Drop entirely — having ANY value blocks iframing.
				continue;
			}
			if (lk === "content-security-policy") {
				outHeaders.set(k, rewriteCsp(v, env.ALLOWED_PARENT));
				continue;
			}
			outHeaders.append(k, v);
		}

		return new Response(upstreamRes.body, {
			status: upstreamRes.status,
			statusText: upstreamRes.statusText,
			headers: outHeaders,
		});
	},
};
