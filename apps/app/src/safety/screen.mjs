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
// API schema (Lakera v2 — verify post-Cisco-acquisition before runtime use):
//   POST https://api.lakera.ai/v2/guard
//   Auth: Authorization: Bearer <LAKERA_GUARD_API_KEY>
//   Body: { messages: [{ role: "user", content: <text> }], project_id?: <id> }
//   Response: { flagged: bool, results: [{ categories: { prompt_injection: <0-1> }, ... }] }

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

    // Parse the response. Lakera v2 schema (assumed — adjust based on signup-time verification):
    //   { flagged: bool, results: [{ categories: { prompt_injection: <0-1>, ... } }] }
    // Pre-acquisition v1 schema was:
    //   { results: [{ categories: { prompt_injection: <0-1> }, flagged: bool }] }
    // Both shapes are handled below.
    const topFlagged = raw?.flagged === true;
    const result = raw?.results?.[0];
    if (!result && topFlagged === false) {
      // Response shape unrecognized — fail-open with raw for debug
      return { flagged: false, action: "passed_lakera_unavailable", reason: null, score: null, raw };
    }

    const injectionScore = result?.categories?.prompt_injection ?? 0;
    const isFlagged = topFlagged || result?.flagged === true;

    let action = "passed";
    let reason = null;

    if (isFlagged) {
      // Determine top category
      const categories = result?.categories || {};
      const topCategory = Object.entries(categories)
        .filter(([, v]) => typeof v === "number" && v > 0)
        .sort(([, a], [, b]) => b - a)[0];
      reason = topCategory?.[0] ?? "unknown";
      action = "flagged"; // default: soft-flag; caller applies hard-block rule (score >= 0.8)
    }

    return { flagged: isFlagged, action, reason, score: injectionScore, raw };
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
