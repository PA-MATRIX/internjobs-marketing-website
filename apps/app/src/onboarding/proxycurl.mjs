// apps/app/src/onboarding/proxycurl.mjs
//
// v1.2 Phase 09 — LinkedIn enrichment via Proxycurl's Reverse Email Lookup
// + Person Profile endpoints. The "lookup_depth=deep" + "enrich_profile=enrich"
// query params on the reverse-email path collapse the two-hop pattern
// (email → LinkedIn URL → person profile) into ONE request, which is the
// cheapest path per the docs (~$0.04 / profile vs ~$0.10 for the two-hop
// chain).
//
// IMPORTANT (open question — flagged in the Phase 09 report):
//   In January 2025 LinkedIn filed suit against Proxycurl and the public
//   API briefly went dark; the team (nubela.co) relaunched the service.
//   Verify per-profile pricing + service availability at deploy time. If
//   Proxycurl is unreachable, the caller (server.mjs /onboard/start) is
//   wired to fail-soft — `runEnrichment` returns `null` and the student
//   still proceeds to /onboard/qr without a contextual first-touch.
//   Phase 10 (deferred) can wire Apollo as a fallback by branching here.
//
// Auth: Bearer <PROXYCURL_API_TOKEN> in the Authorization header. The token
// is loaded into config.proxycurl.apiToken — when unset, the client returns
// null without making any HTTP call (no spurious 401s during local dev).
//
// Retries: 3 attempts with exponential backoff (1s / 3s / 9s) on transient
// 5xx + network errors. 4xx never retries — bad token / missing email is a
// fast-fail signal.

const PROXYCURL_BASE_URL = "https://nubela.co";
const REVERSE_EMAIL_PATH = "/proxycurl/api/contact-api/personal-contact";
const PERSON_PROFILE_PATH = "/proxycurl/api/v2/linkedin";

/**
 * Resolve a student's email to a normalized LinkedIn profile.
 *
 * @param {object} opts
 * @param {string} opts.email     Student email (from Clerk OIDC).
 * @param {string} opts.apiToken  Proxycurl bearer token.
 * @param {string} [opts.type]    'personal' (default) — Proxycurl treats this
 *                                 as the personal-email lookup mode.
 * @returns {Promise<object | null>}  Normalized profile or null on hard fail.
 */
export async function enrichByEmail({ email, apiToken, type = "personal" }) {
  if (!email || !apiToken) return null;

  const url = new URL(REVERSE_EMAIL_PATH, PROXYCURL_BASE_URL);
  // Phase 09 contract: pass the email + ask Proxycurl to also enrich the
  // person profile in the same hop. lookup_depth=deep + enrich_profile=enrich
  // returns the full LinkedIn shape on the matched profile.
  url.searchParams.set("email", email);
  url.searchParams.set("lookup_depth", "deep");
  url.searchParams.set("enrich_profile", "enrich");
  url.searchParams.set("type", type === "work" ? "work_email" : "personal_email");

  const raw = await fetchWithRetry(url, apiToken);
  if (!raw) return null;
  return normalizeProfile(raw);
}

/**
 * Resolve a student's LinkedIn URL to a normalized person profile.
 *
 * This is the preferred path for QR onboarding because the QR identity is
 * keyed to `students.linkedin_profile_url`. Reverse-email stays as a fallback
 * for older rows or provider gaps.
 *
 * @param {object} opts
 * @param {string} opts.linkedinUrl  Public LinkedIn profile URL.
 * @param {string} opts.apiToken     Proxycurl bearer token.
 * @returns {Promise<object | null>} Normalized profile or null on hard fail.
 */
export async function enrichByLinkedInUrl({ linkedinUrl, apiToken }) {
  if (!linkedinUrl || !apiToken) return null;

  const url = new URL(PERSON_PROFILE_PATH, PROXYCURL_BASE_URL);
  url.searchParams.set("url", linkedinUrl);
  url.searchParams.set("skills", "include");
  url.searchParams.set("use_cache", "if-recent");

  const raw = await fetchWithRetry(url, apiToken);
  if (!raw) return null;
  return normalizeProfile({ ...raw, linkedin_profile_url: raw.linkedin_profile_url || linkedinUrl });
}

// ─── HTTP with retry/backoff ────────────────────────────────────────────────

const BACKOFF_MS = [1000, 3000, 9000];

async function fetchWithRetry(url, apiToken) {
  let lastErr = null;
  for (let attempt = 0; attempt < BACKOFF_MS.length; attempt += 1) {
    try {
      const res = await fetch(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${apiToken}`,
          Accept: "application/json",
        },
      });

      if (res.ok) {
        return await res.json().catch(() => null);
      }

      // 4xx — fast-fail, do not retry. 404 (no profile found) is also a hard
      // no — Proxycurl returns 404 when the email doesn't resolve to any
      // LinkedIn profile, and retrying won't change that.
      if (res.status >= 400 && res.status < 500) {
        const body = await res.text().catch(() => "");
        console.warn(
          JSON.stringify({
            level: "warn",
            message: "proxycurl_4xx",
            status: res.status,
            body: body.slice(0, 200),
          }),
        );
        return null;
      }

      // 5xx — retryable.
      lastErr = new Error(`proxycurl_${res.status}`);
    } catch (err) {
      lastErr = err;
    }

    // Sleep before the next attempt (skipped on the final iteration).
    if (attempt < BACKOFF_MS.length - 1) {
      await sleep(BACKOFF_MS[attempt]);
    }
  }

  console.error(
    JSON.stringify({
      level: "error",
      message: "proxycurl_exhausted_retries",
      error: lastErr?.message ?? String(lastErr ?? "unknown"),
    }),
  );
  return null;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Normalization ──────────────────────────────────────────────────────────
//
// Proxycurl's response wraps the enriched person profile under a
// `profile` key when enrich_profile=enrich is used. We project just the
// fields the agent needs into a flat normalized shape so call sites
// (store.linkUserLinkedInProfile + the student-inbound prompt) don't have
// to know about provider quirks.
//
// Proxycurl field names of note:
//   linkedin_profile_url, public_identifier, headline, summary
//   experiences[].{company, title, description, starts_at, ends_at}
//   education[].{school, degree_name, field_of_study, ends_at}
//   skills[]  — array of skill names

function normalizeProfile(raw) {
  if (!raw || typeof raw !== "object") return null;

  // Proxycurl's reverse-email response with enrich_profile=enrich nests the
  // profile under `profile` (or returns the profile fields at the top level
  // when the email maps directly). Handle both shapes.
  const p = raw.profile && typeof raw.profile === "object" ? raw.profile : raw;
  const linkedinUrl =
    p.linkedin_profile_url ||
    p.profile_url ||
    raw.linkedin_profile_url ||
    raw.url ||
    "";
  const linkedinId = p.public_identifier || p.public_id || "";

  const experiences = Array.isArray(p.experiences)
    ? p.experiences.map((exp) => ({
        company: exp.company || "",
        title: exp.title || "",
        description: exp.description || "",
        startsAt: formatDate(exp.starts_at),
        endsAt: formatDate(exp.ends_at),
      }))
    : [];

  const schools = Array.isArray(p.education)
    ? p.education.map((s) => ({
        school: s.school || "",
        degree: s.degree_name || "",
        fieldOfStudy: s.field_of_study || "",
        endYear: s.ends_at?.year || null,
      }))
    : [];

  const skills = Array.isArray(p.skills) ? p.skills.map((s) => (typeof s === "string" ? s : s?.name || "")).filter(Boolean) : [];

  // current_* derived from the most-recent experience that has no end date
  // (Proxycurl's convention for "still working there"). Fall back to the
  // first experience if every entry has an end date.
  const currentExp = experiences.find((e) => !e.endsAt) || experiences[0] || null;

  return {
    linkedinUrl,
    linkedinId,
    headline: p.headline || "",
    summary: p.summary || "",
    currentCompany: currentExp?.company || "",
    currentTitle: currentExp?.title || "",
    schools,
    experiences,
    skills,
    raw,
  };
}

// Proxycurl date shape: { day, month, year } — we collapse to ISO YYYY-MM
// (or YYYY when month is missing) for the agent prompt.
function formatDate(d) {
  if (!d || typeof d !== "object") return "";
  const year = d.year ? String(d.year) : "";
  const month = d.month ? String(d.month).padStart(2, "0") : "";
  if (!year) return "";
  return month ? `${year}-${month}` : year;
}
