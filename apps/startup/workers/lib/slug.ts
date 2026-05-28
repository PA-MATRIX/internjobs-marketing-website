// apps/startup/workers/lib/slug.ts
// v1.4 Phase 28.5 STARTUP-AGENT-EMAIL-01 — slug generation + uniqueness
// reservation for per-startup agent email addresses
// (`<slug>@employers.internjobs.ai`).
//
// `mintSlug` is deterministic: the same company name always produces the
// same base slug. Reservation handles collisions by appending `-1`, `-2`,
// ... up to MAX_ATTEMPTS, calling the Fly proxy to atomically check
// availability via the `GET /v1/startups/check-slug` endpoint.
//
// Algorithm (locked, from 28.5-RESEARCH.md §4):
//   1. lowercase
//   2. replace any run of non-alphanumeric with a single hyphen
//   3. trim leading/trailing hyphens
//   4. truncate to MAX_LEN = 30 chars
//   5. on collision, append `-<attempt>` (starting at 1); re-truncate to
//      MAX_LEN to keep the email local-part within RFC-5321's 64-octet
//      bound (we cap at 30 — well under)
//
// Open edge cases (acceptable for v1.4):
//   • Empty input ("Acme Inc.!" with all non-alphanumeric → "") — the
//     `reserveUniqueSlug` caller is expected to validate beforehand;
//     mintSlug returns `""` and reserveUniqueSlug will surface a 4xx from
//     the Fly proxy.
//   • Slug ending in `-` after truncate (e.g. a 30-char run that ends at a
//     boundary): handled by re-trimming after slice.
//   • Collision tail can grow the slug past MAX_LEN — we re-truncate the
//     full `<base>-<n>` to MAX_LEN before the check.

export const MAX_SLUG_LEN = 30;
export const MAX_RESERVE_ATTEMPTS = 10;

/**
 * Deterministically derive a slug from a company name.
 *
 * Pure function — no env, no fetch, no I/O. Easily unit-tested.
 */
export function mintSlug(companyName: string): string {
	return companyName
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-") // any non-alphanumeric run → single "-"
		.replace(/^-+|-+$/g, "") // trim leading/trailing hyphens
		.slice(0, MAX_SLUG_LEN) // cap length
		.replace(/^-+|-+$/g, ""); // re-trim in case the slice landed on "-"
}

/**
 * Build the candidate slug for a given collision-attempt number.
 *
 * attempt=0 → base. attempt=1 → "base-1" (truncated to MAX_SLUG_LEN).
 * attempt=N → "base-N".
 */
function candidateForAttempt(base: string, attempt: number): string {
	if (attempt === 0) return base;
	const suffix = `-${attempt}`;
	// Reserve room for the suffix; truncate the base so the full candidate
	// fits within MAX_SLUG_LEN. Re-trim in case the base ends on a hyphen
	// after truncation.
	const room = MAX_SLUG_LEN - suffix.length;
	const trimmed = base.slice(0, Math.max(0, room)).replace(/-+$/g, "");
	return `${trimmed}${suffix}`;
}

/**
 * Reserve a unique slug for a new startup by asking the Fly proxy whether
 * `<candidate>@employers.internjobs.ai` is already taken (404 = free).
 *
 * Behaviour:
 *   • 404 from the proxy → candidate is free; return it.
 *   • 200 from the proxy → candidate is taken; advance attempt counter.
 *   • Any other status → throw (this is a control-flow signal we can't
 *     reason about — surface to caller).
 *
 * The check + persistence atomicity actually lives in the Fly proxy
 * (UNIQUE constraint on `startups.agent_email`); this function is just the
 * pre-check that lets the admin endpoint pick a non-colliding slug before
 * writing the startup row. If a race slips through, the Fly INSERT path
 * will surface a 409 and the admin endpoint can re-attempt or report.
 *
 * Throws on:
 *   • non-2xx / non-404 HTTP response from the Fly proxy (network/auth)
 *   • exhausting MAX_RESERVE_ATTEMPTS without finding a free slug
 *   • empty `base` (caller must mintSlug() something non-empty first)
 */
export async function reserveUniqueSlug(
	base: string,
	apiUrl: string,
	apiSecret: string,
): Promise<string> {
	if (!base) {
		throw new Error("reserveUniqueSlug: base slug is empty (company name was non-alphanumeric)");
	}
	const trimmedBase = base.replace(/^-+|-+$/g, "");
	if (!trimmedBase) {
		throw new Error("reserveUniqueSlug: base slug is empty after trim");
	}

	const baseUrl = apiUrl.replace(/\/$/, "");

	for (let attempt = 0; attempt < MAX_RESERVE_ATTEMPTS; attempt++) {
		const candidate = candidateForAttempt(trimmedBase, attempt);
		const email = `${candidate}@employers.internjobs.ai`;
		const url = `${baseUrl}/v1/startups/check-slug?agent_email=${encodeURIComponent(email)}`;

		const res = await fetch(url, {
			headers: { Authorization: `Bearer ${apiSecret}` },
			signal: AbortSignal.timeout(8000),
		});

		// 404 = slug is free → reserve it.
		if (res.status === 404) return candidate;
		// 200 = slug is taken → advance.
		if (res.ok) continue;
		// Any other status is an error we can't reason about.
		const detail = await res.text().catch(() => "");
		throw new Error(
			`reserveUniqueSlug: Fly proxy returned ${res.status} for ${candidate}: ${detail.slice(0, 200)}`,
		);
	}

	throw new Error(
		`reserveUniqueSlug: could not reserve a free slug for "${trimmedBase}" after ${MAX_RESERVE_ATTEMPTS} attempts`,
	);
}
