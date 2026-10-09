// Phase 33-03 — Clerk Restrictions config for the EMPLOYERS Clerk app.
//
// Rejects personal-email signups at Clerk's own sign-up form (no Worker code,
// no user.created webhook — that approach was built then reverted on
// 2026-05-27, commit 67f69e0, in favour of Clerk's built-in Restrictions:
// rejection happens at the form, so there is no orphan account and no 1-3s
// window where a blocked user holds a valid session before deletion).
//
// Usage:
//   # apply (idempotent — safe to re-run)
//   infisical run --projectId 26995afd-9a6f-4690-912f-01cbcebb76d5 --env prod \
//     --path /internjobs-ai -- node scripts/33-clerk-restrictions-config.mjs
//
//   # read-only health check (no writes; exit 1 if anything is missing)
//   infisical run --projectId 26995afd-9a6f-4690-912f-01cbcebb76d5 --env prod \
//     --path /internjobs-ai -- node scripts/33-clerk-restrictions-config.mjs --verify-only
//
// The secret is never printed. Node 22+ (native fetch, AbortSignal.timeout).
//
// NOTE on reading the restriction flags (verified live 2026-07-14):
//   Clerk's Backend API has NO `GET /v1/instance/restrictions` — that path is
//   PATCH-only and answers 405 to a GET. The flags ARE readable (unauthenticated,
//   read-only) from the instance's Frontend API at
//   `GET https://<fapi-host>/v1/environment` -> `user_settings.restrictions`.
//   The FAPI host is encoded in the publishable key (base64 of "<host>$").
//   So: writes go to the Backend API with the secret key; flag read-back goes to
//   the FAPI with the publishable key. Blocklist identifiers use the Backend API
//   for both read and write.

import { execFileSync } from "node:child_process";

const API_BASE = "https://api.clerk.com/v1";
const TIMEOUT_MS = 10_000;

const INFISICAL_PROJECT_ID = "26995afd-9a6f-4690-912f-01cbcebb76d5";
const INFISICAL_ENV = "prod";
const INFISICAL_PATH = "/internjobs-ai";
const SECRET_NAME = "STARTUPS_CLERK_SECRET_KEY";
const PUBLISHABLE_KEY_NAME = "STARTUPS_NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY";

const VERIFY_ONLY = process.argv.includes("--verify-only");

// ---------------------------------------------------------------------------
// Canonical domain list
// ---------------------------------------------------------------------------

// MUST mirror apps/startup/workers/lib/workEmail.ts BLOCKED_DOMAINS — if you
// add/remove a domain there, add/remove it here too. (26 domains.)
const BLOCKED_DOMAINS = [
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
];

// Approximates the code-side `gmx.*` wildcard match (workEmail.ts does
// `domain.startsWith("gmx.")`). Clerk's blocklist only accepts literal
// identifiers — there is no TLD wildcard — so enumerate the common TLDs.
// This is the ONE place the two lists genuinely cannot be expressed the same
// way; an exotic gmx TLD would still be caught by the Worker-side check.
const GMX_TLDS = [
	"gmx.com",
	"gmx.de",
	"gmx.net",
	"gmx.at",
	"gmx.ch",
	"gmx.co.uk",
	"gmx.us",
	"gmx.fr",
	"gmx.es",
];

const TARGET_DOMAINS = [...BLOCKED_DOMAINS, ...GMX_TLDS];
const TARGET_IDENTIFIERS = TARGET_DOMAINS.map((d) => `*@${d}`);

const RESTRICTION_FLAGS = {
	blocklist: true,
	block_disposable_email_domains: true,
	block_email_subaddresses: true,
};

// ---------------------------------------------------------------------------
// Secret resolution — env first (composes with `infisical run`), else shell out
// ---------------------------------------------------------------------------

/**
 * env first (so this composes with `infisical run`), else shell out to the
 * Infisical CLI. Returns "" when `required` is false and nothing was found.
 */
function resolveSecret(name, { required = true } = {}) {
	const fromEnv = (process.env[name] ?? "").trim();
	if (fromEnv) return fromEnv;

	try {
		const out = execFileSync(
			"infisical",
			[
				"secrets",
				"get",
				name,
				"--projectId",
				INFISICAL_PROJECT_ID,
				"--env",
				INFISICAL_ENV,
				"--path",
				INFISICAL_PATH,
				"--plain",
			],
			{ encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], shell: false },
		);
		const val = (out ?? "").trim();
		if (val) return val;
	} catch {
		// fall through — never echo stderr, which can contain the secret value.
	}

	if (!required) return "";

	console.error(
		`ERROR: could not resolve ${name}.\n\n` +
			`Set it in the environment, or wrap the call:\n` +
			`  infisical run --projectId ${INFISICAL_PROJECT_ID} --env ${INFISICAL_ENV} \\\n` +
			`    --path ${INFISICAL_PATH} -- node scripts/33-clerk-restrictions-config.mjs\n`,
	);
	process.exit(2);
}

/** The publishable key is base64("<fapi-host>$") after the pk_live_/pk_test_ prefix. */
function fapiHostFromPublishableKey(pk) {
	if (!pk) return null;
	const enc = pk.replace(/^pk_(live|test)_/, "");
	try {
		const decoded = Buffer.from(enc, "base64").toString("utf8").trim();
		const host = decoded.replace(/\$$/, "");
		return /^[a-z0-9.-]+$/i.test(host) ? host : null;
	} catch {
		return null;
	}
}

// ---------------------------------------------------------------------------
// Clerk API helpers
// ---------------------------------------------------------------------------

/** @returns {Promise<{status: number, ok: boolean, body: any}>} */
async function clerk(secret, method, path, body) {
	const res = await fetch(`${API_BASE}${path}`, {
		method,
		headers: {
			Authorization: `Bearer ${secret}`,
			"Content-Type": "application/json",
		},
		body: body === undefined ? undefined : JSON.stringify(body),
		signal: AbortSignal.timeout(TIMEOUT_MS),
	});

	const text = await res.text();
	let parsed;
	try {
		parsed = text ? JSON.parse(text) : null;
	} catch {
		parsed = text;
	}
	return { status: res.status, ok: res.ok, body: parsed };
}

function assertOk(res, what) {
	if (!res.ok) {
		// throw (not process.exit) — main().catch sets exitCode; a hard exit while a
		// fetch socket is still closing trips a libuv assertion on Windows.
		throw new Error(
			`${what} failed (HTTP ${res.status}): ${JSON.stringify(res.body)}`,
		);
	}
	return res.body;
}

/**
 * Read the live restriction flags. There is NO Backend API GET for these
 * (`GET /v1/instance/restrictions` -> 405, PATCH-only), so read them from the
 * instance's Frontend API environment payload, which is public and read-only.
 * Shape: user_settings.restrictions.<flag>.enabled: boolean
 * @returns {Promise<Record<string, boolean>|null>} null if unreadable
 */
async function getRestrictions(fapiHost) {
	if (!fapiHost) return null;
	try {
		const url =
			`https://${fapiHost}/v1/environment` +
			`?__clerk_api_version=2021-02-05&_clerk_js_version=5.0.0`;
		const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
		if (!res.ok) {
			console.error(`WARN: GET ${fapiHost}/v1/environment -> HTTP ${res.status}`);
			return null;
		}
		const body = await res.json();
		const r = body?.user_settings?.restrictions;
		if (!r) return null;
		const out = {};
		for (const key of Object.keys(RESTRICTION_FLAGS)) {
			out[key] = r?.[key]?.enabled === true;
		}
		return out;
	} catch (err) {
		console.error(`WARN: could not read restrictions from FAPI: ${err?.message}`);
		return null;
	}
}

/**
 * Clerk has returned blocklist_identifiers as both a bare array and a
 * {data, total_count} envelope across API versions. Handle both, and paginate
 * with limit/offset (Clerk's standard Backend API pagination) until we've seen
 * everything.
 * @returns {Promise<string[]>} raw identifier strings
 */
async function listBlocklistIdentifiers(secret) {
	const identifiers = [];
	const limit = 100;
	let offset = 0;

	for (;;) {
		const res = await clerk(
			secret,
			"GET",
			`/blocklist_identifiers?limit=${limit}&offset=${offset}`,
		);
		const body = assertOk(res, "GET /blocklist_identifiers");

		const page = Array.isArray(body) ? body : (body?.data ?? []);
		for (const row of page) {
			const id = typeof row === "string" ? row : row?.identifier;
			if (id) identifiers.push(id);
		}

		const total = Array.isArray(body) ? undefined : body?.total_count;
		offset += page.length;

		if (page.length < limit) break;
		if (typeof total === "number" && offset >= total) break;
		if (page.length === 0) break;
		if (offset > 10_000) break; // hard stop; blocklist should never be this big
	}

	return identifiers;
}

/** Normalise for comparison: `*@Gmail.COM` and `gmail.com` both -> `gmail.com`. */
function domainOf(identifier) {
	const s = String(identifier).toLowerCase().trim();
	const at = s.lastIndexOf("@");
	return at === -1 ? s : s.slice(at + 1);
}

/** Clerk returns 400/409/422 for duplicates depending on version — treat all as already-present. */
function isAlreadyExists(res) {
	if (res.status === 409 || res.status === 422) return true;
	const blob = JSON.stringify(res.body ?? "").toLowerCase();
	return (
		blob.includes("already exists") ||
		blob.includes("already_exists") ||
		blob.includes("duplicate")
	);
}

function printFlags(label, restrictions) {
	console.log(`\n${label}`);
	if (!restrictions) {
		console.log("  [????] restriction flags UNREADABLE (no publishable key / FAPI error)");
		console.log("         Confirm manually: Clerk Dashboard -> Configure -> Restrictions");
		return false;
	}
	let allOk = true;
	for (const key of Object.keys(RESTRICTION_FLAGS)) {
		const actual = restrictions[key];
		if (actual !== true) allOk = false;
		console.log(`  [${actual === true ? "OK  " : "MISS"}] ${key}: ${actual}`);
	}
	return allOk;
}

// ---------------------------------------------------------------------------
// Modes
// ---------------------------------------------------------------------------

async function verifyOnly(secret, fapiHost) {
	console.log("Clerk Restrictions — VERIFY ONLY (read-only; no writes)\n");
	console.log(`Instance: employers Clerk app (via ${SECRET_NAME})`);
	console.log(`Frontend API host: ${fapiHost ?? "(unknown — flags unreadable)"}`);

	const restrictions = await getRestrictions(fapiHost);
	const flagsOk = printFlags("Restriction flags:", restrictions);

	const existing = await listBlocklistIdentifiers(secret);
	const existingDomains = new Set(existing.map(domainOf));

	const present = TARGET_DOMAINS.filter((d) => existingDomains.has(d));
	const missing = TARGET_DOMAINS.filter((d) => !existingDomains.has(d));

	console.log(
		`\nBlocklist identifiers: ${existing.length} total on the instance` +
			` | target domains present: ${present.length}/${TARGET_DOMAINS.length}`,
	);
	if (missing.length > 0) {
		console.log("\nMISSING target domains:");
		for (const d of missing) console.log(`  [MISS] *@${d}`);
	} else {
		console.log("  [OK  ] all target domains present");
	}

	const ok = flagsOk && missing.length === 0;
	console.log(
		`\nRESULT: ${ok ? "FULLY CONFIGURED" : "NOT FULLY CONFIGURED"}` +
			` (flags ${flagsOk ? "ok" : "incomplete"}, ${missing.length} domain(s) missing)`,
	);
	return ok ? 0 : 1;
}

async function apply(secret, fapiHost) {
	console.log("Clerk Restrictions — APPLY (idempotent)\n");
	console.log(`Instance: employers Clerk app (via ${SECRET_NAME})`);
	console.log(`Frontend API host: ${fapiHost ?? "(unknown — flags unreadable)"}`);

	// 1. Restriction flags -------------------------------------------------
	printFlags("BEFORE:", await getRestrictions(fapiHost));

	assertOk(
		await clerk(secret, "PATCH", "/instance/restrictions", RESTRICTION_FLAGS),
		"PATCH /instance/restrictions",
	);
	console.log("\nPATCH /instance/restrictions -> 200");

	// Read the flags back from the FAPI rather than trusting the PATCH body.
	const flagsOk = printFlags("AFTER (read back from FAPI):", await getRestrictions(fapiHost));

	// 2. Blocklist identifiers --------------------------------------------
	const existing = await listBlocklistIdentifiers(secret);
	const existingDomains = new Set(existing.map(domainOf));
	console.log(
		`\nExisting blocklist identifiers on instance: ${existing.length}`,
	);

	const results = [];
	for (const domain of TARGET_DOMAINS) {
		const identifier = `*@${domain}`;

		if (existingDomains.has(domain)) {
			results.push({ domain, action: "already_present", ok: true });
			continue;
		}

		const res = await clerk(secret, "POST", "/blocklist_identifiers", {
			identifier,
		});

		if (res.ok) {
			results.push({ domain, action: "created", ok: true });
		} else if (isAlreadyExists(res)) {
			// Idempotency: a duplicate is a success, not a failure.
			results.push({ domain, action: "already_present", ok: true });
		} else {
			results.push({
				domain,
				action: `FAILED (HTTP ${res.status})`,
				ok: false,
				error: JSON.stringify(res.body),
			});
		}
	}

	// 3. Summary -----------------------------------------------------------
	console.log("\nSummary:");
	console.log("  domain                    action           ok");
	console.log("  ------------------------- ---------------- --");
	for (const r of results) {
		console.log(
			`  ${r.domain.padEnd(25)} ${String(r.action).padEnd(16)} ${r.ok ? "y" : "N"}`,
		);
		if (r.error) console.log(`      -> ${r.error}`);
	}

	const created = results.filter((r) => r.action === "created").length;
	const alreadyPresent = results.filter(
		(r) => r.action === "already_present",
	).length;
	const failed = results.filter((r) => !r.ok);

	console.log(
		`\nTotals: ${results.length} target domains` +
			` | created: ${created}` +
			` | already present: ${alreadyPresent}` +
			` | failed: ${failed.length}`,
	);

	if (!flagsOk) {
		console.error("\nERROR: restriction flags did not read back as all-true.");
		return 1;
	}
	if (failed.length > 0) {
		console.error(
			`\nERROR: ${failed.length} domain(s) failed for a reason other than "already exists".`,
		);
		return 1;
	}

	console.log("\nRESULT: APPLIED. Re-run with --verify-only to read back.");
	return 0;
}

// ---------------------------------------------------------------------------

async function main() {
	const secret = resolveSecret(SECRET_NAME);
	const pk = resolveSecret(PUBLISHABLE_KEY_NAME, { required: false });
	const fapiHost = fapiHostFromPublishableKey(pk);

	// process.exitCode (not process.exit()) — exiting hard while a fetch socket is
	// still closing trips a libuv assertion on Windows.
	process.exitCode = VERIFY_ONLY
		? await verifyOnly(secret, fapiHost)
		: await apply(secret, fapiHost);
}

main().catch((err) => {
	console.error(`FATAL: ${err?.message ?? err}`);
	process.exitCode = 1;
});
