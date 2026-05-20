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

function rewritePublicUrl(value: string, upstreamOrigin: string, publicOrigin: string): string {
	const upstream = new URL(upstreamOrigin);
	const publicUrl = new URL(publicOrigin);
	const upstreamHttps = upstream.origin;
	const upstreamHttp = `http://${upstream.host}`;
	const upstreamProtocolRelative = `//${upstream.host}`;
	const publicHttps = publicUrl.origin;
	const publicProtocolRelative = `//${publicUrl.host}`;
	return value
		.replaceAll(upstreamHttps, publicHttps)
		.replaceAll(upstreamHttp, publicHttps)
		.replaceAll(upstreamProtocolRelative, publicProtocolRelative)
		.replaceAll(encodeURIComponent(upstreamHttps), encodeURIComponent(publicHttps))
		.replaceAll(encodeURIComponent(upstreamHttp), encodeURIComponent(publicHttps));
}

function corsHeaders(request: Request, env: Env): Headers {
	const headers = new Headers();
	const origin = request.headers.get("origin");
	if (origin === env.ALLOWED_PARENT) {
		headers.set("access-control-allow-origin", origin);
		headers.set("access-control-allow-credentials", "true");
		headers.set("vary", "Origin");
	}
	headers.set(
		"access-control-allow-methods",
		"GET,POST,PUT,PATCH,DELETE,OPTIONS",
	);
	headers.set(
		"access-control-allow-headers",
		request.headers.get("access-control-request-headers") ||
			"authorization,content-type,x-requested-with",
	);
	headers.set("access-control-max-age", "86400");
	return headers;
}

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const incoming = new URL(request.url);
		const publicOrigin = incoming.origin;
		const upstreamUrl = new URL(incoming.pathname + incoming.search, env.MATTERMOST_ORIGIN);
		const upstreamOrigin = new URL(env.MATTERMOST_ORIGIN).origin;

		if (request.method === "OPTIONS") {
			return new Response(null, { status: 204, headers: corsHeaders(request, env) });
		}

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
		for (const [k, v] of corsHeaders(request, env).entries()) {
			outHeaders.set(k, v);
		}
		for (const [k, v] of upstreamRes.headers.entries()) {
			const lk = k.toLowerCase();
			if (lk === "x-frame-options") {
				// Drop entirely — having ANY value blocks iframing.
				continue;
			}
			if (lk === "content-security-policy") {
				outHeaders.set(
					k,
					rewriteCsp(
						rewritePublicUrl(v, upstreamOrigin, publicOrigin),
						env.ALLOWED_PARENT,
					),
				);
				continue;
			}
			if (lk === "location") {
				outHeaders.set(k, rewritePublicUrl(v, upstreamOrigin, publicOrigin));
				continue;
			}
			if (lk === "content-length") {
				// Will be wrong after HTML injection — let the runtime
				// recompute via chunked encoding.
				continue;
			}
			outHeaders.append(k, v);
		}

		// White-label: inject CSS into HTML responses to hide the chat
		// backend's residual branding (edition badge, "Mattermost Inc."
		// copyright footer, About-dialog vendor links). Team Edition has
		// no Custom CSS setting — this proxy injection is the only lever.
		const contentType = upstreamRes.headers.get("content-type") ?? "";
		if (contentType.includes("text/html")) {
			let html = await upstreamRes.text();
			html = rewritePublicUrl(html, upstreamOrigin, publicOrigin);
			html = html.replace(
				"</head>",
				`<style id="parrot-whitelabel">
/* Hide edition badge ("TEAM EDITION") — the auth-page header uses
   span.freeBadge; admin/other surfaces use .edition-badge. */
.freeBadge,.edition-badge,[class*="edition-badge"],[class*="freeBadge"],.AnnouncementBar__purchaseNow{display:none!important;}
/* Hide "© Mattermost Inc." copyright footer on auth pages */
.footer,.hfroute-footer,[class*="copyright"]{display:none!important;}
/* Hide vendor links in the About dialog footer */
.about-modal__copyright,.about-modal__links{display:none!important;}
/* Hide the Mattermost wordmark SVG in the auth-page header logo.
   The adjacent text link still renders "Parrot" so the header
   isn't left empty. */
.header-logo-link svg,a.header-logo-link svg,#logo svg{display:none!important;}
.header-logo-link{min-width:0!important;}
</style></head>`,
			);
			return new Response(html, {
				status: upstreamRes.status,
				statusText: upstreamRes.statusText,
				headers: outHeaders,
			});
		}

		return new Response(upstreamRes.body, {
			status: upstreamRes.status,
			statusText: upstreamRes.statusText,
			headers: outHeaders,
		});
	},
};
