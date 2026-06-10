// apps/startup/workers/lib/workEmail.ts
// v1.4 Phase 29-01 — Shared personal-email blocklist.
//
// Extracted from apps/startup/workers/routes/webhooks.ts (Phase 28.5-05) so
// both the Clerk webhook handler (signup path) and the Voice AI
// `register_startup` action (Phase 29-01) reject the same set of free-email
// providers. ONE list, ONE update path; reduces drift between two enforcement
// surfaces.
//
// v1.5 hardening: externalize to a Workers KV namespace so ops can add a
// domain without a code deploy. See DEFER-28.5-05-C in
// .planning/milestones/v1.4-pilot-readiness/phases/28.5-startups-web-app/
// PHASE-28.5-DEFERRED-OPS.md.

const BLOCKED_DOMAINS = new Set<string>([
	"gmail.com",
	"googlemail.com",
	"yahoo.com",
	"yahoo.co.uk",
	"yahoo.co.in",
	"ymail.com",
	"hotmail.com",
	"hotmail.co.uk",
	"outlook.com",
	"outlook.co.uk",
	"live.com",
	"msn.com",
	"icloud.com",
	"me.com",
	"mac.com",
	"aol.com",
	"proton.me",
	"protonmail.com",
	"pm.me",
	"mail.com",
	"yandex.com",
	"yandex.ru",
	"zoho.com",
	"fastmail.com",
	"tutanota.com",
	"tutamail.com",
]);

/**
 * Returns true if the email's domain is a known personal/free provider.
 * Case-insensitive on the domain. Also matches any `gmx.*` domain (gmx.com,
 * gmx.de, gmx.net, etc.) since gmx has dozens of country TLDs.
 *
 * Exported for unit tests and shared between webhooks.ts (Phase 28.5-05)
 * and tools/execute.ts handleRegisterStartup (Phase 29-01).
 */
export function isPersonalEmailDomain(email: string): boolean {
	if (typeof email !== "string" || !email.includes("@")) return false;
	const domain = email.split("@")[1]?.toLowerCase().trim() ?? "";
	if (!domain) return false;
	if (BLOCKED_DOMAINS.has(domain)) return true;
	// gmx.* (gmx.com, gmx.de, gmx.net, gmx.at, ...) — all personal.
	if (domain === "gmx" || domain.startsWith("gmx.")) return true;
	return false;
}

/** Exposed for tests that want to assert against the canonical list. */
export function getBlockedDomains(): ReadonlySet<string> {
	return BLOCKED_DOMAINS;
}
