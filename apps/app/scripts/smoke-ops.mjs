// apps/app/scripts/smoke-ops.mjs
//
// v1.2 — smoke suite for the operator audit log (post-2026-05-17
// autonomy pivot).
//
// What this asserts:
//   1. /ops/drafts is 403 for a student dev-session.
//   2. /ops/drafts is 403 for a startup dev-session.
//   3. /ops/drafts is 200 for an operator dev-session.
//   4. Seeding a draft with status='sent' (simulating Mastra autopilot
//      output) makes it appear in /ops/drafts as a log row.
//   5. POST /ops/drafts/:id/flag writes a draft_feedback row with
//      feedback_type='flagged' and the row shows up at /ops/feedback.
//   6. The deprecated POST /ops/drafts/:id/approve returns 410 Gone.
//   7. The deprecated POST /ops/drafts/:id/reject returns 410 Gone.
//   8. The deprecated POST /ops/drafts/:id/edit returns 410 Gone.
//   9. Detail page renders for any status (no 409 gate any more).
//
// Runs against MemoryStore — no DATABASE_URL required. Outbound providers
// are short-circuited by OUTBOUND_DRY_RUN=true so no real SMS/email is sent.

import { spawn } from "node:child_process";
import { createHmac } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

const port = 3918;
const baseUrl = `http://127.0.0.1:${port}`;

// v1.2 EMAIL-03 (scope-add 2026-05-16): shared HMAC secret for the
// /webhooks/email assertions below. Mirrors the Worker → Fly flow without
// standing up Cloudflare locally.
const EMAIL_WORKER_SECRET = "smoke-ops-email-worker-secret-xyz123";

const child = spawn(process.execPath, ["src/server.mjs"], {
  cwd: new URL("..", import.meta.url),
  env: {
    ...process.env,
    PORT: String(port),
    NODE_ENV: "test",
    ENABLE_DEV_AUTH: "true",
    OUTBOUND_DRY_RUN: "true",
    APP_SESSION_SECRET: "smoke-ops-secret",
    PHOTON_WEBHOOK_SECRET: "smoke-ops-webhook",
    PHOTON_FROM_NUMBER: "+15555550100",
    EMAIL_WORKER_SECRET,
  },
  stdio: "ignore",
});

try {
  await delay(1000);

  // ─── 1. Health check ───────────────────────────────────────────────────────
  const health = await fetch(`${baseUrl}/healthz`);
  assert(health.ok, `health check returned ${health.status}`);

  // ─── 2. Negative auth: student session → /ops/drafts → 403 ─────────────────
  const studentCookie = await signInAs("student");
  const studentOps = await fetch(`${baseUrl}/ops/drafts`, {
    headers: { cookie: studentCookie },
    redirect: "manual",
  });
  assert(studentOps.status === 403, `student → /ops/drafts expected 403, got ${studentOps.status}`);
  const studentBody = await studentOps.json();
  assert(studentBody.reason === "not_operator", "student rejection should report reason=not_operator");

  // ─── 3. Negative auth: startup session → /ops/drafts → 403 ─────────────────
  const startupCookie = await signInAs("startup");
  const startupOps = await fetch(`${baseUrl}/ops/drafts`, {
    headers: { cookie: startupCookie },
    redirect: "manual",
  });
  assert(startupOps.status === 403, `startup → /ops/drafts expected 403, got ${startupOps.status}`);

  // ─── 4. Positive auth: operator → /ops/drafts → 200 ────────────────────────
  const operatorCookie = await signInAs("operator");
  const opsEmpty = await fetch(`${baseUrl}/ops/drafts`, {
    headers: { cookie: operatorCookie },
  });
  assert(opsEmpty.ok, `operator → /ops/drafts expected 200, got ${opsEmpty.status}`);
  const opsEmptyHtml = await opsEmpty.text();
  assert(opsEmptyHtml.includes("No messages yet."), "empty log should show empty-state message");
  assert(opsEmptyHtml.includes("Message log"), "header should be 'Message log' (not 'Operator queue')");

  // ─── 5. Seed a SENT draft (simulating Mastra autopilot output) and confirm
  //       it appears in the audit log ─────────────────────────────────────────
  const seed1 = await seedDraft({
    recipient_type: "student",
    channel: "sms",
    channel_address: "+15555550123",
    body: "Hi! Thanks for reaching out — I'd love to chat about the role.",
    status: "sent",
    sent_at: new Date().toISOString(),
    provider_message_id: "spectrum-msg-stub-001",
    student_name: "Jordan Lee",
    startup_name: "Acme Robotics",
    role_title: "Growth Engineer Intern",
  });
  const seedId1 = seed1.draft.id;
  assert(seedId1, "seed-draft should return an id");

  const opsList = await fetch(`${baseUrl}/ops/drafts`, { headers: { cookie: operatorCookie } });
  assert(opsList.ok, `operator → /ops/drafts expected 200, got ${opsList.status}`);
  const opsListHtml = await opsList.text();
  assert(opsListHtml.includes("Jordan Lee"), "log should show seeded student name");
  assert(opsListHtml.includes("Acme Robotics"), "log should show seeded startup name");
  assert(opsListHtml.includes("Growth Engineer Intern"), "log should show seeded role title");
  assert(opsListHtml.includes("STUDENT"), "log should show recipient-type badge");
  assert(opsListHtml.includes("Sent"), "log should show 'Sent' status badge");

  // ─── 6. Detail page renders read-only view with flag form (no approve/edit/reject) ─
  const detail = await fetch(`${baseUrl}/ops/drafts/${seedId1}`, { headers: { cookie: operatorCookie } });
  assert(detail.ok, `operator detail expected 200, got ${detail.status}`);
  const detailHtml = await detail.text();
  assert(detailHtml.includes(`/ops/drafts/${seedId1}/flag`), "detail should include flag-for-review form");
  assert(!detailHtml.includes(`/ops/drafts/${seedId1}/approve`), "detail must NOT include approve form (autonomy pivot)");
  assert(!detailHtml.includes(`/ops/drafts/${seedId1}/reject`), "detail must NOT include reject form (autonomy pivot)");
  assert(!detailHtml.includes(`/ops/drafts/${seedId1}/edit`), "detail must NOT include edit form (autonomy pivot)");
  assert(detailHtml.includes("flag_reason"), "flag form should have flag_reason input");

  // ─── 7. Deprecated approve/edit/reject routes return 410 Gone ──────────────
  for (const action of ["approve", "edit", "reject"]) {
    const gone = await fetch(`${baseUrl}/ops/drafts/${seedId1}/${action}`, {
      method: "POST",
      headers: { cookie: operatorCookie, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ edited_body: "x", rejection_reason: "x" }),
      redirect: "manual",
    });
    assert(gone.status === 410, `deprecated POST /ops/drafts/:id/${action} expected 410 Gone, got ${gone.status}`);
    const goneBody = await gone.json();
    assert(goneBody.reason === "approval_gate_removed_2026_05_17", `${action} 410 should carry deprecation reason`);
  }

  // ─── 8. Flag the seeded sent draft → draft_feedback row + /ops/feedback ────
  const flag = await fetch(`${baseUrl}/ops/drafts/${seedId1}/flag`, {
    method: "POST",
    headers: { cookie: operatorCookie, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ flag_reason: "Too generic; should mention the candidate's project." }),
    redirect: "manual",
  });
  assert(flag.status === 302, `flag should redirect (302), got ${flag.status}`);
  assert(
    flag.headers.get("location") === `/ops/drafts/${seedId1}?flagged=1`,
    "flag should redirect back to detail page with ?flagged=1",
  );

  const feedback = await fetch(`${baseUrl}/ops/feedback`, { headers: { cookie: operatorCookie } });
  assert(feedback.ok, `operator → /ops/feedback expected 200, got ${feedback.status}`);
  const feedbackHtml = await feedback.text();
  assert(feedbackHtml.includes("Too generic"), "feedback log should display flag reason");
  assert(feedbackHtml.includes("flagged"), "feedback log should display 'flagged' feedback_type");

  // ─── 9. Seed a FAILED draft and confirm it renders with error banner ───────
  const seed2 = await seedDraft({
    recipient_type: "startup",
    channel: "email",
    channel_address: "founder@startup.example",
    body: "We have a candidate who matches your role — interested?",
    status: "failed",
    agent_metadata: { send_error: "stub-test-send-failure: provider 500" },
    student_name: "Sam Builder",
    startup_name: "BetaCo",
    role_title: "Founding Engineer",
  });
  const seedId2 = seed2.draft.id;
  const failedDetail = await fetch(`${baseUrl}/ops/drafts/${seedId2}`, { headers: { cookie: operatorCookie } });
  assert(failedDetail.ok, `failed-draft detail expected 200, got ${failedDetail.status}`);
  const failedDetailHtml = await failedDetail.text();
  assert(failedDetailHtml.includes("Send failed:"), "failed draft should show the send-error banner");
  assert(failedDetailHtml.includes("stub-test-send-failure"), "failed draft should surface the error message");
  assert(failedDetailHtml.includes("Failed"), "failed draft should show 'Failed' status badge");

  // ─── 10. Filter bar still works ────────────────────────────────────────────
  const filterStudent = await fetch(`${baseUrl}/ops/drafts?type=student`, { headers: { cookie: operatorCookie } });
  assert(filterStudent.ok, `filtered log expected 200, got ${filterStudent.status}`);

  // ─── 11. Student/startup → /ops/feedback → 403 (defense in depth) ──────────
  const studentFeedback = await fetch(`${baseUrl}/ops/feedback`, {
    headers: { cookie: studentCookie },
    redirect: "manual",
  });
  assert(studentFeedback.status === 403, `student → /ops/feedback expected 403, got ${studentFeedback.status}`);

  // ─── 12. routeAndSend unit smoke (in-process) — failure path ───────────────
  // This is a direct in-process check of the send-failure semantics, so
  // the smoke suite covers both the happy path (dry-run above) AND the
  // throwing-provider path that the server's catch block depends on.
  // We import routeAndSend, hand it a draft with an unknown channel,
  // and assert it throws.
  const { routeAndSend } = await import("../src/outbound.mjs");
  let threw = false;
  try {
    await routeAndSend(
      { channel: "carrier-pigeon", channel_address: "x", body: "test" },
      { smsProvider: { sendSms: async () => ({}) }, config: { outboundDryRun: false } },
    );
  } catch (err) {
    threw = true;
    assert(String(err.message).includes("unknown channel"), "unknown channel should throw a clear error");
  }
  assert(threw, "routeAndSend should throw on unknown channel");

  // Also exercise the SMS provider_error → throw path.
  threw = false;
  try {
    await routeAndSend(
      { channel: "sms", channel_address: "+15555550000", body: "test" },
      {
        smsProvider: {
          sendSms: async () => ({ status: "provider_error", providerMessageId: null, metadata: { reason: "test" } }),
        },
        config: { outboundDryRun: false },
      },
    );
  } catch (err) {
    threw = true;
    assert(String(err.message).includes("sms_provider_error"), "sms provider_error should surface as a thrown error");
  }
  assert(threw, "routeAndSend should throw when smsProvider returns provider_error");

  // ─── 13. R2 storage scaffold (STORAGE-01) — null / non-null behavior ───────
  // In-process import: with no R2_* envs set, getR2Client() returns null.
  // Stub envs → returns a non-null client. The singleton must be reset
  // between calls so the env swap is observed.
  const r2Mod = await import("../src/storage/r2.mjs");
  r2Mod.__resetR2ClientForTest();
  const r2Empty = r2Mod.getR2Client({});
  assert(r2Empty === null, "getR2Client() with no envs should return null");
  r2Mod.__resetR2ClientForTest();
  const r2Full = r2Mod.getR2Client({
    R2_ACCOUNT_ID: "stub-acct",
    R2_ACCESS_KEY_ID: "stub-key",
    R2_SECRET_ACCESS_KEY: "stub-secret",
    R2_BUCKET: "internjobs-agent-store-smoke",
  });
  assert(r2Full !== null, "getR2Client() with stub envs should return a client");
  assert(r2Full.bucket === "internjobs-agent-store-smoke", "client.bucket should reflect R2_BUCKET");
  assert(typeof r2Full.putObject === "function", "client.putObject should be a function");
  assert(typeof r2Full.signedGetUrl === "function", "client.signedGetUrl should be a function");
  // Key helpers
  assert(
    r2Mod.studentKey("stud-1", "Resume.PDF") === "students/stud-1/resume.pdf",
    "studentKey should sanitize + prefix",
  );
  assert(
    r2Mod.conversationKey("conv-1", "transcript.txt") === "conversations/conv-1/transcript.txt",
    "conversationKey should sanitize + prefix",
  );
  r2Mod.__resetR2ClientForTest();

  // ─── 14. Per-conv email alias (EMAIL-03) — Fly ingest writes conversation_id ─
  // Send a synthetic /webhooks/email POST with To: conv-<uuid>@internjobs.ai
  // and assert recordEmailInbound stamped metadata.conversation_id.
  // We reach into the in-process MemoryStore via the server's store
  // closure — but smoke-ops is an out-of-process http client, so we use
  // a `?diag=inbound` debug surface? No — easier: we import the helper
  // module and validate the regex + builder behavior in-process, then
  // we POST to /webhooks/email with HMAC and assert 200 + the
  // documented response shape carries the conversationId back.
  const replyToMod = await import("../src/workflows/reply-to.mjs");
  const uuid = "abcdef12-3456-7890-abcd-ef1234567890";
  const built = replyToMod.buildConversationReplyTo(uuid);
  assert(
    built === `conv-${uuid}@agent.internjobs.ai`,
    "buildConversationReplyTo should return canonical subdomain form",
  );
  const parsed = replyToMod.parseConversationReplyTo(
    `"Op" <CONV-${uuid.toUpperCase()}@agent.internjobs.ai>`,
  );
  assert(parsed === uuid, "parseConversationReplyTo should lowercase + extract from angle brackets");
  assert(replyToMod.parseConversationReplyTo("ops@internjobs.ai") === null, "non-conv address should parse to null");
  assert(
    replyToMod.parseConversationReplyTo(`conv-${uuid}@internjobs.ai`) === null,
    "apex `conv-<uuid>@internjobs.ai` must NOT be parsed as a conv alias (subdomain isolation)",
  );
  assert(replyToMod.validateConversationUuid("not-a-uuid") === null, "validateConversationUuid rejects malformed");
  assert(replyToMod.validateConversationUuid(uuid.toUpperCase()) === uuid, "validateConversationUuid lowercases");

  // POST /webhooks/email with HMAC + conversation_id payload.
  // The Fly ingest endpoint is shape-agnostic about apex vs. subdomain in
  // the `to` field — it only validates `conversation_id` independently.
  const payloadObj = {
    from: '"Founder" <founder@startup.example>',
    to: `conv-${uuid}@agent.internjobs.ai`,
    subject: "Re: candidate intro",
    body: "Sounds good, let's chat.",
    ts: Date.now(),
    conversation_id: uuid,
  };
  const payloadJson = JSON.stringify(payloadObj);
  const sig = createHmac("sha256", EMAIL_WORKER_SECRET).update(payloadJson).digest("hex");
  const ingest = await fetch(`${baseUrl}/webhooks/email`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-email-worker-secret": EMAIL_WORKER_SECRET,
      "x-email-hmac-sha256": sig,
    },
    body: payloadJson,
  });
  assert(ingest.ok, `webhooks/email expected 200, got ${ingest.status}`);
  const ingestBody = await ingest.json();
  assert(ingestBody.ok === true, "webhooks/email response.ok should be true");
  assert(ingestBody.conversationId === uuid, `response.conversationId should echo the alias UUID, got ${ingestBody.conversationId}`);

  // Negative: malformed conversation_id should be silently dropped and
  // legacy lookup runs (responds with conversationId: null).
  const payloadBad = {
    from: '"Founder" <founder@startup.example>',
    to: "ops@internjobs.ai",
    subject: "no alias",
    body: "hello",
    ts: Date.now() + 1,
    conversation_id: "not-a-uuid",
  };
  const payloadBadJson = JSON.stringify(payloadBad);
  const sigBad = createHmac("sha256", EMAIL_WORKER_SECRET).update(payloadBadJson).digest("hex");
  const ingestBad = await fetch(`${baseUrl}/webhooks/email`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-email-worker-secret": EMAIL_WORKER_SECRET,
      "x-email-hmac-sha256": sigBad,
    },
    body: payloadBadJson,
  });
  assert(ingestBad.ok, `webhooks/email negative-path expected 200, got ${ingestBad.status}`);
  const ingestBadBody = await ingestBad.json();
  assert(ingestBadBody.conversationId === null, "malformed conv id should be silently dropped (null)");

  // ─── 15. Outbound startup email — agent_metadata.reply_to is honored ──────
  // Hand routeAndSend a synthetic startup-email draft with reply_to set;
  // OUTBOUND_DRY_RUN=true short-circuits the CF call, but we verify the
  // path is reachable + returns the synthetic providerMessageId. The
  // structural assertion (that draft.agent_metadata.reply_to is read) is
  // covered by code review + the unit reply-to.test.mjs file; here we
  // just verify no regression in the dry-run path.
  const { routeAndSend: routeAndSendForEmail } = await import("../src/outbound.mjs");
  const emailDraft = {
    channel: "email",
    channel_address: "founder@startup.example",
    body: "draft body",
    agent_metadata: { reply_to: `conv-${uuid}@agent.internjobs.ai` },
  };
  const provId = await routeAndSendForEmail(emailDraft, {
    smsProvider: { sendSms: async () => ({}) },
    config: { outboundDryRun: true, cloudflareEmailAccountId: "stub", cloudflareEmailApiToken: "stub" },
  });
  assert(typeof provId === "string" && provId.startsWith("dryrun-email-"), `dryrun email returned ${provId}`);

  console.log("internjobs-app: ops audit log + autonomous-agent + STORAGE-01 + EMAIL-03 smoke checks passed");
} finally {
  child.kill();
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function signInAs(role) {
  const url = role === "student" ? `${baseUrl}/dev/sign-in` : `${baseUrl}/dev/sign-in?role=${role}`;
  const res = await fetch(url, { redirect: "manual" });
  const cookie = res.headers.get("set-cookie");
  if (!cookie) throw new Error(`dev sign-in for role=${role} returned no cookie`);
  return cookie.split(";")[0];
}

async function seedDraft(payload) {
  const res = await fetch(`${baseUrl}/dev/seed-draft`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`seed-draft failed ${res.status}: ${text}`);
  }
  return res.json();
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
