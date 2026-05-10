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
  await delay(450);

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

  console.log("internjobs-app: waitlist smoke checks passed");
} finally {
  child.kill();
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
