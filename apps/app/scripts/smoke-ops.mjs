// apps/app/scripts/smoke-ops.mjs
//
// v1.2 Phase 05 — smoke suite for the operator approval gate.
//
// What this asserts:
//   1. /ops/drafts is 403 for a student dev-session.
//   2. /ops/drafts is 403 for a startup dev-session.
//   3. /ops/drafts is 200 for an operator dev-session.
//   4. Seeding a pending draft makes it appear in /ops/drafts.
//   5. POST /ops/drafts/:id/approve flips status to 'sent' (with OUTBOUND_DRY_RUN=true).
//   6. POST /ops/drafts/:id/reject writes a draft_feedback row and the row
//      shows up at /ops/feedback.
//   7. POST /ops/drafts/:id/edit writes a draft_feedback row (type='edited').
//   8. Detail page rejects non-pending draft IDs with 409.
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
  assert(opsEmptyHtml.includes("No drafts pending review."), "empty queue should show empty-state message");

  // ─── 5. Seed a pending draft and confirm it appears in the queue ───────────
  const seed1 = await seedDraft({
    recipient_type: "student",
    channel: "sms",
    channel_address: "+15555550123",
    body: "Hi! Thanks for reaching out — I'd love to chat about the role.",
    student_name: "Jordan Lee",
    startup_name: "Acme Robotics",
    role_title: "Growth Engineer Intern",
  });
  const seedId1 = seed1.draft.id;
  assert(seedId1, "seed-draft should return an id");

  const opsList = await fetch(`${baseUrl}/ops/drafts`, { headers: { cookie: operatorCookie } });
  assert(opsList.ok, `operator → /ops/drafts expected 200, got ${opsList.status}`);
  const opsListHtml = await opsList.text();
  assert(opsListHtml.includes("Jordan Lee"), "queue should show seeded student name");
  assert(opsListHtml.includes("Acme Robotics"), "queue should show seeded startup name");
  assert(opsListHtml.includes("Growth Engineer Intern"), "queue should show seeded role title");
  assert(opsListHtml.includes("STUDENT"), "queue should show recipient-type badge");

  // ─── 6. Detail page renders all three forms ────────────────────────────────
  const detail = await fetch(`${baseUrl}/ops/drafts/${seedId1}`, { headers: { cookie: operatorCookie } });
  assert(detail.ok, `operator detail expected 200, got ${detail.status}`);
  const detailHtml = await detail.text();
  assert(detailHtml.includes(`/ops/drafts/${seedId1}/approve`), "detail should include approve form");
  assert(detailHtml.includes(`/ops/drafts/${seedId1}/edit`), "detail should include edit form");
  assert(detailHtml.includes(`/ops/drafts/${seedId1}/reject`), "detail should include reject form");
  assert(detailHtml.includes("edited_body"), "edit form should have edited_body textarea");

  // ─── 7. Approve flips status to 'sent' (dry-run send) ──────────────────────
  const approve = await fetch(`${baseUrl}/ops/drafts/${seedId1}/approve`, {
    method: "POST",
    headers: { cookie: operatorCookie },
    redirect: "manual",
  });
  assert(approve.status === 302, `approve should redirect (302), got ${approve.status}`);
  assert(approve.headers.get("location") === "/ops/drafts?approved=1", "approve should redirect to ?approved=1");

  // Confirm the draft is no longer in the pending queue.
  const opsAfterApprove = await fetch(`${baseUrl}/ops/drafts`, { headers: { cookie: operatorCookie } });
  const opsAfterApproveHtml = await opsAfterApprove.text();
  assert(!opsAfterApproveHtml.includes(seedId1), "approved draft should be out of the pending queue");

  // Confirm direct access returns 409 (not pending).
  const detailAfter = await fetch(`${baseUrl}/ops/drafts/${seedId1}`, {
    headers: { cookie: operatorCookie },
    redirect: "manual",
  });
  assert(detailAfter.status === 409, `detail for sent draft expected 409, got ${detailAfter.status}`);

  // ─── 8. Seed another draft, reject it with a reason ────────────────────────
  const seed2 = await seedDraft({
    recipient_type: "startup",
    channel: "email",
    channel_address: "founder@startup.example",
    body: "We have a candidate who matches your role — interested in chatting?",
    student_name: "Sam Builder",
    startup_name: "BetaCo",
    role_title: "Founding Engineer",
  });
  const seedId2 = seed2.draft.id;

  const reject = await fetch(`${baseUrl}/ops/drafts/${seedId2}/reject`, {
    method: "POST",
    headers: { cookie: operatorCookie, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ rejection_reason: "Too generic; ask the agent to mention the candidate's project." }),
    redirect: "manual",
  });
  assert(reject.status === 302, `reject should redirect (302), got ${reject.status}`);
  assert(reject.headers.get("location") === "/ops/drafts?rejected=1", "reject should redirect to ?rejected=1");

  const feedback = await fetch(`${baseUrl}/ops/feedback`, { headers: { cookie: operatorCookie } });
  assert(feedback.ok, `operator → /ops/feedback expected 200, got ${feedback.status}`);
  const feedbackHtml = await feedback.text();
  assert(feedbackHtml.includes("Too generic"), "feedback log should display rejection reason");
  assert(feedbackHtml.includes("rejected"), "feedback log should display 'rejected' feedback_type");

  // ─── 9. Seed a third draft, edit-then-approve, confirm feedback row ────────
  const seed3 = await seedDraft({
    recipient_type: "student",
    channel: "sms",
    channel_address: "+15555550789",
    body: "Initial agent body that needs editing.",
    student_name: "Pat Coder",
    startup_name: "GammaCo",
    role_title: "ML Intern",
  });
  const seedId3 = seed3.draft.id;

  const edit = await fetch(`${baseUrl}/ops/drafts/${seedId3}/edit`, {
    method: "POST",
    headers: { cookie: operatorCookie, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ edited_body: "Edited operator body with much more relevant context." }),
    redirect: "manual",
  });
  assert(edit.status === 302, `edit should redirect (302), got ${edit.status}`);
  assert(edit.headers.get("location") === "/ops/drafts?approved=1", "edit-approve should redirect to ?approved=1");

  const feedbackAfterEdit = await fetch(`${baseUrl}/ops/feedback`, { headers: { cookie: operatorCookie } });
  const feedbackAfterEditHtml = await feedbackAfterEdit.text();
  assert(feedbackAfterEditHtml.includes("edited"), "feedback log should display 'edited' feedback_type");
  assert(feedbackAfterEditHtml.includes("Edited operator body"), "feedback log should show corrected body");

  // ─── 10. Confirm filter bar works ───────────────────────────────────────────
  const filterStudent = await fetch(`${baseUrl}/ops/drafts?type=student`, { headers: { cookie: operatorCookie } });
  assert(filterStudent.ok, `filtered queue expected 200, got ${filterStudent.status}`);

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

  console.log("internjobs-app: ops approval gate + STORAGE-01 + EMAIL-03 smoke checks passed");
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
