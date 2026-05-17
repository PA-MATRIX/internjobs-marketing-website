import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

const port = 3917;
const baseUrl = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, ["src/server.mjs"], {
  cwd: new URL("..", import.meta.url),
  env: {
    ...process.env,
    PORT: String(port),
    NODE_ENV: "test",
    ENABLE_DEV_AUTH: "true",
    APP_SESSION_SECRET: "verify-secret",
    PHOTON_WEBHOOK_SECRET: "verify-webhook-secret",
    PHOTON_FROM_NUMBER: "+15555550100",
  },
  stdio: "ignore",
});

try {
  // v1.2 Phase 04: Mastra (@mastra/core + @mastra/pg) imports add ~300ms
  // to cold-start. The previous 450ms delay flakes on the first run after
  // a clean install. 1000ms gives headroom for cold ESM resolution without
  // making the suite noticeably slower.
  await delay(1000);

  const health = await fetch(`${baseUrl}/healthz`);
  assert(health.ok, `health check returned ${health.status}`);
  const healthBody = await health.json();
  assert(healthBody.ok === true && healthBody.service === "internjobs-app", "health check returned unexpected payload");

  const waitlist = await fetch(`${baseUrl}/waitlist`);
  const waitlistHtml = await waitlist.text();
  assert(waitlistHtml.includes("Continue with LinkedIn"), "waitlist does not show LinkedIn-first CTA");
  assert(!/password/i.test(waitlistHtml), "waitlist should not present password signup copy");

  const signIn = await fetch(`${baseUrl}/dev/sign-in`, { redirect: "manual" });
  const cookie = signIn.headers.get("set-cookie");
  assert(signIn.status === 302 && cookie, "dev sign-in did not set session cookie");
  assert(signIn.headers.get("location") === "/pairing", "dev sign-in should route directly to pairing");

  const authHeaders = { cookie };
  const onboarding = await fetch(`${baseUrl}/onboarding`, { headers: authHeaders });
  assert(onboarding.ok, `onboarding returned ${onboarding.status}`);
  assert((await onboarding.text()).includes("Now connect the channel"), "onboarding screen missing channel prompt");

  const pairing = await fetch(`${baseUrl}/pairing`, { headers: authHeaders });
  const pairingHtml = await pairing.text();
  const code = pairingHtml.match(/\b[A-F0-9]{8}\b/)?.[0];
  assert(pairing.ok && code, "pairing screen did not render a code");
  assert(pairingHtml.includes(`Hey internjobs.ai! My verification code is ${code}. What&#039;s next?`), "pairing screen did not render the expected SMS copy");

  const invalidWebhook = await fetch(`${baseUrl}/webhooks/photon`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text: code, from: "+15555550123" }),
  });
  assert(invalidWebhook.status === 401, "invalid webhook auth should be rejected");

  const webhookPayload = JSON.stringify({ id: "verify-event-1", text: `Hey internjobs.ai! My verification code is ${code}. What's next?`, from: "+15555550123", channel: "sms" });
  const validWebhook = await fetch(`${baseUrl}/webhooks/photon`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-internjobs-webhook-secret": "verify-webhook-secret" },
    body: webhookPayload,
  });
  assert(validWebhook.ok, `valid webhook returned ${validWebhook.status}`);

  const duplicateWebhook = await fetch(`${baseUrl}/webhooks/photon`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-internjobs-webhook-secret": "verify-webhook-secret" },
    body: webhookPayload,
  });
  assert(duplicateWebhook.ok, `duplicate webhook returned ${duplicateWebhook.status}`);
  const duplicateBody = await duplicateWebhook.json();
  assert(duplicateBody.duplicate === true, "duplicate webhook was not idempotent");

  const replyWebhook = await fetch(`${baseUrl}/webhooks/photon`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-internjobs-webhook-secret": "verify-webhook-secret" },
    body: JSON.stringify({ id: "verify-event-2", text: "Sounds good, what should I do next?", from: "+1 (555) 555-0123", channel: "sms" }),
  });
  assert(replyWebhook.ok, `reply webhook returned ${replyWebhook.status}`);
  const replyBody = await replyWebhook.json();
  assert(replyBody.eventType === "student_reply", "reply webhook should attach to the verified student by phone number");

  const confirmed = await fetch(`${baseUrl}/pairing`, { headers: authHeaders });
  assert(confirmed.ok && (await confirmed.text()).includes("Messages connected"), "pairing page should show connected state after verification");

  const profile = await fetch(`${baseUrl}/profile`, {
    method: "POST",
    headers: { ...authHeaders, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ interests: "AI tools, growth", projects: "Built a waitlist", preferredWork: "growth", notes: "remote preferred" }),
  });
  assert(profile.ok && (await profile.text()).includes("Profile context updated"), "profile context did not save");

  // v1.2 Phase 09 — Standout-style onboarding smoke. Memory-store mode (no
  // DATABASE_URL) emits a dev-stub pairing code so the QR + mobile + status
  // pages render. Postgres-mode is exercised by the operator smoke suite +
  // manual /onboard/* clicks during release.
  const onboardStart = await fetch(`${baseUrl}/onboard/start`, { headers: authHeaders, redirect: "manual" });
  assert(onboardStart.status === 302, "onboard/start should redirect");
  const startSetCookie = onboardStart.headers.get("set-cookie") || "";
  assert(startSetCookie.includes("ij_pair="), "onboard/start should set ij_pair cookie");
  const pairCookie = startSetCookie.split(";")[0]; // "ij_pair=START-..."

  const qr = await fetch(`${baseUrl}/onboard/qr`, { headers: { cookie: `${cookie}; ${pairCookie}` } });
  assert(qr.ok, `onboard/qr returned ${qr.status}`);
  const qrHtml = await qr.text();
  assert(qrHtml.includes("Scan it"), "onboard/qr should render the QR landing");
  assert(/START-[A-Z0-9]+/.test(qrHtml), "onboard/qr should embed a pairing code");

  const status = await fetch(`${baseUrl}/onboard/status`, { headers: { cookie: `${cookie}; ${pairCookie}` } });
  const statusBody = await status.json();
  assert(status.ok && statusBody.paired === false, "onboard/status should report unpaired before claim");

  console.log("internjobs-app: waitlist smoke checks passed");
} finally {
  child.kill();
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
