/**
 * admin.mjs — read-only admin route handlers for Phase 06 INTEG-01.
 *
 * All handlers are exported as plain async functions that accept (req, res,
 * { url, pool }) and return void. They are mounted in server.mjs under
 * requireOperatorAuth so auth is already confirmed by the time these run.
 *
 * No mutations. No sends. Pure read-only DB introspection.
 */

import { sendJson } from "../http.mjs";

/**
 * GET /admin/integ-01-status
 *
 * Returns 8 boolean step states derived from live Neon rows in
 * `inbound_messages` and `drafts`, scoped to a single test conversation
 * identified by `?student_id=<UUID>`.
 *
 * If no student_id is provided, the most recent conversation is used
 * (convenient during live smoke test when you have only one active pair).
 *
 * Response shape:
 * {
 *   conversation_id: string | null,
 *   student_id: string | null,
 *   startup_id: string | null,
 *   all_passed: boolean,
 *   steps: {
 *     step3_spectrum_inbound: boolean,
 *     step4_student_draft: boolean,
 *     step6_student_sms_sent: boolean,
 *     step7_startup_draft: boolean,
 *     step8_startup_email_sent: boolean,
 *     step9_email_inbound: boolean,
 *     step10_student_draft_2: boolean,
 *     step11_student_sms_sent_2: boolean,
 *   },
 *   inbound_rows: number,
 *   draft_rows: number,
 * }
 *
 * When the DB has no matching data, all booleans are false and
 * all_passed is false.
 */
export async function handleInteg01Status(req, res, { url, pool }) {
  // pool is the pg Pool attached to the store. If not available (dev without
  // DB), return a safe empty state rather than crashing.
  if (!pool) {
    sendJson(res, 200, {
      status: "no_database",
      conversation_id: null,
      student_id: null,
      startup_id: null,
      all_passed: false,
      steps: emptySteps(),
      inbound_rows: 0,
      draft_rows: 0,
    });
    return;
  }

  const studentId = url.searchParams.get("student_id") || null;

  try {
    // ── 1. Resolve conversation ───────────────────────────────────────────────
    let conv = null;
    if (studentId) {
      const { rows } = await pool.query(
        `SELECT id, student_id, startup_id
           FROM conversations
          WHERE student_id = $1
          ORDER BY created_at DESC
          LIMIT 1`,
        [studentId],
      );
      conv = rows[0] || null;
    } else {
      // No filter — use the most recent conversation globally. Useful during a
      // live smoke test where there is exactly one active test pair.
      const { rows } = await pool.query(
        `SELECT id, student_id, startup_id
           FROM conversations
          ORDER BY created_at DESC
          LIMIT 1`,
      );
      conv = rows[0] || null;
    }

    if (!conv) {
      sendJson(res, 200, {
        status: "no_conversation",
        conversation_id: null,
        student_id: studentId,
        startup_id: null,
        all_passed: false,
        steps: emptySteps(),
        inbound_rows: 0,
        draft_rows: 0,
      });
      return;
    }

    // ── 2. Parallel queries: inbound_messages + drafts ────────────────────────
    const [inboundResult, draftResult] = await Promise.all([
      pool.query(
        `SELECT provider
           FROM inbound_messages
          WHERE student_id = $1 OR startup_id = $2`,
        [conv.student_id, conv.startup_id],
      ),
      pool.query(
        `SELECT recipient_type, status
           FROM drafts
          WHERE conversation_id = $1`,
        [conv.id],
      ),
    ]);

    const inboundRows = inboundResult.rows;   // { provider }[]
    const draftRows = draftResult.rows;       // { recipient_type, status }[]

    // ── 3. Derive boolean step states ─────────────────────────────────────────
    const spectrumInboundCount = inboundRows.filter((r) => r.provider === "spectrum").length;
    const emailInboundCount = inboundRows.filter((r) => r.provider === "email").length;

    const studentDrafts = draftRows.filter((r) => r.recipient_type === "student");
    const startupDrafts = draftRows.filter((r) => r.recipient_type === "startup");
    const studentSentDrafts = studentDrafts.filter((r) => r.status === "sent");
    const startupSentDrafts = startupDrafts.filter((r) => r.status === "sent");

    const steps = {
      step3_spectrum_inbound:   spectrumInboundCount >= 1,
      step4_student_draft:      studentDrafts.length >= 1,
      step6_student_sms_sent:   studentSentDrafts.length >= 1,
      step7_startup_draft:      startupDrafts.length >= 1,
      step8_startup_email_sent: startupSentDrafts.length >= 1,
      step9_email_inbound:      emailInboundCount >= 1,
      step10_student_draft_2:   studentDrafts.length >= 2,
      step11_student_sms_sent_2: studentSentDrafts.length >= 2,
    };

    const allPassed = Object.values(steps).every(Boolean);

    sendJson(res, 200, {
      conversation_id: conv.id,
      student_id: conv.student_id,
      startup_id: conv.startup_id,
      all_passed: allPassed,
      steps,
      inbound_rows: inboundRows.length,
      draft_rows: draftRows.length,
    });
  } catch (err) {
    console.error(
      JSON.stringify({
        level: "error",
        message: "integ01_status_query_failed",
        error: err?.message ?? String(err),
      }),
    );
    sendJson(res, 500, { error: "internal_error" });
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function emptySteps() {
  return {
    step3_spectrum_inbound:    false,
    step4_student_draft:       false,
    step6_student_sms_sent:    false,
    step7_startup_draft:       false,
    step8_startup_email_sent:  false,
    step9_email_inbound:       false,
    step10_student_draft_2:    false,
    step11_student_sms_sent_2: false,
  };
}
