// v1.3 Phase 20 SAFETY-01: Lakera Guard pre-LLM screening helper (Node ESM).
//
// NOT shared with the Parrot Worker — different runtimes, different env
// injection. Worker version: apps/parrot/workers/lib/safety.ts
//
// Fail-open contract: this function NEVER throws. On Lakera timeout (>1s),
// 5xx, or network error, returns { flagged: false, action: 'passed_lakera_unavailable', ... }
// and the caller proceeds normally. Lakera downtime must never block student SMS.
//
// Scope discipline (SAFETY-SCOPE-01):
//   Mattermost inbound does NOT pass through this helper. Mattermost is polled
//   via the EmployeeMailboxDO alarm path (not through server.mjs or
//   inbound-email.ts), and is intentionally excluded from Lakera screening —
//   internal channel, wrong risk profile, wastes quota. This exclusion is
//   architectural, enforced by the call sites that import screenMessage.
//
// API schema (Lakera v2 — VERIFIED 2026-05-24 via live probe from the
// internjobs-ai-student-app Fly machine against the production key):
//   POST https://api.lakera.ai/v2/guard
//   Auth: Authorization: Bearer <LAKERA_GUARD_API_KEY>
//   Body: { messages: [{ role: "user", content: <text> }] }
//   Response is binary — no per-category scores in v2:
//     benign:    { "flagged": false, "metadata": { "request_uuid": "..." } }
//     injection: { "flagged": true,  "metadata": { "request_uuid": "..." } }
//   That is the entire payload. There is no `results[]`, no `categories`,
//   no numeric confidence. The previous v1 shape
//     { results: [{ categories: { prompt_injection: <0-1> }, flagged: bool }] }
//   was deprecated by Lakera in the Cisco AI Defense rebrand and is gone.
//   We map `flagged: true` → score=1 / reason="lakera_flagged" so the
//   downstream `safety_events` row + hard-block gate stays meaningful;
//   `flagged: false` → score=0 / reason=null. Tier: pending dashboard
//   sign-in confirmation (see infra/LAKERA-PRICING.md).

const LAKERA_ENDPOINT = process.env.LAKERA_GUARD_ENDPOINT || "https://api.lakera.ai/v2/guard";
const TIMEOUT_MS = 1000; // hard 1s timeout — fail-open on breach

/**
 * Screen a message body for prompt injection and policy violations.
 *
 * @param {string} text    Raw message text to screen (student SMS body or email body).
 * @param {string} apiKey  LAKERA_GUARD_API_KEY from process.env.
 * @returns {Promise<{
 *   flagged: boolean,
 *   action: 'blocked' | 'flagged' | 'passed' | 'passed_lakera_unavailable',
 *   reason: string | null,    // Lakera category label, e.g. "prompt_injection"
 *   score: number | null,     // 0-1 confidence score
 *   raw: object | null,       // full Lakera response (for logging)
 * }>}
 */
export async function screenMessage(text, apiKey) {
  if (!apiKey) {
    // No key configured — fail-open silently. Not a screened surface.
    return { flagged: false, action: "passed_lakera_unavailable", reason: null, score: null, raw: null };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(LAKERA_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messages: [{ role: "user", content: String(text || "").slice(0, 4000) }],
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      // 4xx / 5xx from Lakera — fail-open
      console.warn(JSON.stringify({ level: "warn", event: "lakera_screen_non2xx", status: res.status }));
      return { flagged: false, action: "passed_lakera_unavailable", reason: null, score: null, raw: null };
    }

    const raw = await res.json().catch(() => null);

    // Parse the v2 response — see schema block at top of file.
    // v2 is binary: { flagged: bool, metadata: { request_uuid: string } }.
    // There is no per-category score, so we map flagged → score=1/0 to
    // preserve the ScreenResult contract (callers + safety_events.score
    // column expect a number). Forward-compat: if Lakera ever re-introduces
    // a per-category numeric score under results[0].categories, we honor it.
    if (raw === null || typeof raw !== "object") {
      // Response unparseable — fail-open with raw for debug
      return { flagged: false, action: "passed_lakera_unavailable", reason: null, score: null, raw };
    }

    const topFlagged = raw?.flagged === true;
    // Forward-compat shim — if categories ever come back, prefer real score.
    const legacyResult = Array.isArray(raw?.results) ? raw.results[0] : null;
    const legacyScore = legacyResult?.categories?.prompt_injection;
    const isFlagged = topFlagged || legacyResult?.flagged === true;

    let score;
    let reason = null;
    let action = "passed";

    if (typeof legacyScore === "number") {
      // Legacy v1 shape (unexpected in v2 — kept for resilience)
      score = legacyScore;
      const categories = legacyResult?.categories || {};
      const topCategory = Object.entries(categories)
        .filter(([, v]) => typeof v === "number" && v > 0)
        .sort(([, a], [, b]) => b - a)[0];
      if (isFlagged) {
        reason = topCategory?.[0] ?? "lakera_flagged";
        action = "flagged";
      }
    } else {
      // v2 binary path — what production actually returns
      score = isFlagged ? 1 : 0;
      if (isFlagged) {
        reason = "lakera_flagged";
        action = "flagged";
      }
    }

    return { flagged: isFlagged, action, reason, score, raw };
  } catch (err) {
    // AbortError (timeout) or network failure — fail-open
    const isTimeout = err?.name === "AbortError";
    console.warn(JSON.stringify({
      level: "warn",
      event: isTimeout ? "lakera_timeout" : "lakera_network_error",
      error: err?.message ?? String(err),
    }));
    return { flagged: false, action: "passed_lakera_unavailable", reason: null, score: null, raw: null };
  } finally {
    clearTimeout(timeoutId);
  }
}
