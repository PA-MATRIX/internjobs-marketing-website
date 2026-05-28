// apps/startup/workers/routes/api.ts
// v1.4 Phase 28 Plan 28-05 — STARTUP-MARKETING-01.
//
// POST /api/request-access — receives the "/startups" marketing CTA form.
//
// Body: { name, email, phone?, what_hiring_for? }
// Auth: NONE (public marketing endpoint — CORS-restricted to internjobs.ai).
// Action: emails Ridhi at raj@internjobs.ai via CF Email Service (if EMAIL
//         binding exists) AND/OR logs the lead so it's visible in `wrangler tail`.
// Response: { ok: true, message } on success; 400 if name/email missing.
//
// Design notes:
//   - This is a transitional surface. Phase 28.5 (web onboarding at
//     employers.internjobs.ai) will replace the CTA with "sign up" instead of
//     "request access". Keep the implementation simple — no DB write here,
//     no token issuance. That's the admin endpoint's job.
//   - CORS is restricted to internjobs.ai + www.internjobs.ai so this
//     endpoint can't be invoked from arbitrary origins (would let scrapers
//     blast Ridhi's inbox).

import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Env } from "../types";

export const apiRouter = new Hono<{ Bindings: Env }>();

// CORS — marketing page is hosted on internjobs.ai (Cloudflare Pages), a
// different origin from mcp.internjobs.ai. Allow only internjobs.ai surfaces.
apiRouter.use(
	"/request-access",
	cors({
		origin: ["https://internjobs.ai", "https://www.internjobs.ai"],
		allowMethods: ["POST", "OPTIONS"],
		allowHeaders: ["Content-Type"],
	}),
);

apiRouter.post("/request-access", async (c) => {
	let body: {
		name?: string;
		email?: string;
		phone?: string;
		what_hiring_for?: string;
	};
	try {
		body = await c.req.json();
	} catch {
		return c.json({ error: "invalid_json" }, 400);
	}

	const name = body.name?.trim();
	const email = body.email?.trim();
	const phone = body.phone?.trim();
	const whatHiringFor = body.what_hiring_for?.trim();

	if (!name || !email) {
		return c.json({ error: "name_and_email_required" }, 400);
	}

	// Light sanity check — block obvious bot/empty submissions
	if (!email.includes("@") || email.length < 5) {
		return c.json({ error: "invalid_email" }, 400);
	}

	const subject = `startup access request — ${name} <${email}>`;
	const text = [
		`new startup access request from the /startups page.`,
		``,
		`name: ${name}`,
		`email: ${email}`,
		`phone: ${phone ?? "(not provided)"}`,
		`what hiring for: ${whatHiringFor ?? "(not provided)"}`,
		``,
		`next step — onboard via:`,
		`  POST https://mcp.internjobs.ai/admin/startups/new`,
		`  Authorization: Bearer $STARTUP_MCP_ADMIN_SECRET`,
		`  body: {"company":"<name's company>","founder_email":"${email}","founder_phone":"${phone ?? "+1..."}"}`,
	].join("\n");

	// Attempt CF Email Service send (EMAIL binding — declared in wrangler.jsonc).
	// If the binding isn't configured, fall through to log-only.
	const emailBinding = (c.env as unknown as Record<string, unknown>).EMAIL;
	if (
		emailBinding &&
		typeof (emailBinding as { send?: unknown }).send === "function"
	) {
		try {
			await (
				emailBinding as { send: (msg: unknown) => Promise<void> }
			).send({
				from: {
					email: "noreply@internjobs.ai",
					name: "internjobs startup",
				},
				to: [{ email: "raj@internjobs.ai" }],
				subject,
				text,
			});
			console.log(
				JSON.stringify({
					level: "info",
					event: "startup_access_request_emailed",
					from: email,
				}),
			);
		} catch (err) {
			// Email send failed — STILL log the lead so it's not lost.
			console.warn(
				JSON.stringify({
					level: "warn",
					event: "startup_access_request_email_failed",
					error: (err as Error)?.message ?? String(err),
					lead: { name, email, phone, what_hiring_for: whatHiringFor },
				}),
			);
		}
	} else {
		// No EMAIL binding configured — log the lead so Ridhi sees it in
		// `wrangler tail` (Phase 28.5 will swap this for a DB row + admin UI).
		console.log(
			JSON.stringify({
				level: "info",
				event: "startup_access_request_logged",
				name,
				email,
				phone,
				what_hiring_for: whatHiringFor,
			}),
		);
	}

	return c.json({
		ok: true,
		message: "request received — ridhi will text you shortly.",
	});
});
