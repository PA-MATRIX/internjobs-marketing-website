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
  // v1.2 Phase 04: Mastra (@mastra/core + @mastra/pg) imports make cold-start
  // vary widely — ~300ms on a warm laptop, several seconds on a cold CI
  // runner — so a fixed delay flakes with ECONNREFUSED. Poll /healthz until
  // the server answers (or we hit the budget) instead of sleeping once.
  const health = await waitForHealth(`${baseUrl}/healthz`);
  assert(health.ok, `health check returned ${health.status}`);
  const healthBody = await health.json();
  assert(healthBody.ok === true && healthBody.service === "internjobs-app", "health check returned unexpected payload");

  const waitlist = await fetch(`${baseUrl}/waitlist`);
  const waitlistHtml = await waitlist.text();
  assert(waitlistHtml.includes("Continue with LinkedIn"), "waitlist does not show LinkedIn-first CTA");
  assert(!/password/i.test(waitlistHtml), "waitlist should not present password signup copy");

  const startupSignIn = await fetch(`${baseUrl}/dev/sign-in?role=startup`, { redirect: "manual" });
  const startupCookie = startupSignIn.headers.get("set-cookie");
  assert(startupSignIn.status === 302 && startupCookie, "dev startup sign-in did not set session cookie");
  const blockedPairing = await fetch(`${baseUrl}/pairing`, { headers: { cookie: startupCookie } });
  const blockedPairingHtml = await blockedPairing.text();
  assert(blockedPairing.status === 403, "pairing should reject sessions without a LinkedIn URL");
  assert(blockedPairingHtml.includes("Connect LinkedIn before pairing your phone"), "pairing should explain LinkedIn is required");
  assert(!/\b[A-F0-9]{8}\b/.test(blockedPairingHtml), "pairing must not create a QR code without LinkedIn");

  const noLinkedInHeaders = {
    "x-clerk-user-id": "dev_no_linkedin_student",
    "x-student-name": "No Link Student",
    "x-student-email": "nolink@student.edu",
  };
  const blockedStart = await fetch(`${baseUrl}/onboard/start`, { headers: noLinkedInHeaders });
  const blockedStartHtml = await blockedStart.text();
  assert(blockedStart.status === 403, "onboard/start should reject student sessions without a LinkedIn URL");
  assert(blockedStartHtml.includes("Add your public LinkedIn URL"), "missing LinkedIn URL should show the capture form");
  assert(!/START-[A-Z0-9]+/.test(blockedStartHtml), "onboard/start must not create START QR codes without LinkedIn");
  const invalidLinkedIn = await fetch(`${baseUrl}/linkedin/profile-url`, {
    method: "POST",
    headers: { ...noLinkedInHeaders, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ linkedinProfileUrl: "https://linkedin.com/company/internjobs" }),
  });
  assert(invalidLinkedIn.status === 400, "LinkedIn capture should reject non-profile URLs");
  const capturedLinkedIn = await fetch(`${baseUrl}/linkedin/profile-url`, {
    method: "POST",
    headers: { ...noLinkedInHeaders, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ linkedinProfileUrl: "linkedin.com/in/no-link-student" }),
    redirect: "manual",
  });
  assert(capturedLinkedIn.status === 302 && capturedLinkedIn.headers.get("location") === "/onboard/start", "LinkedIn capture should save valid public profile URLs");

  const signIn = await fetch(`${baseUrl}/dev/sign-in`, { redirect: "manual" });
  const cookie = signIn.headers.get("set-cookie");
  assert(signIn.status === 302 && cookie, "dev sign-in did not set session cookie");
  assert(signIn.headers.get("location") === "/onboard/start", "dev sign-in should route directly to START-code onboarding");

  const authHeaders = { cookie };
  const onboarding = await fetch(`${baseUrl}/onboarding`, { headers: authHeaders });
  assert(onboarding.ok, `onboarding returned ${onboarding.status}`);
  assert((await onboarding.text()).includes("Now connect the channel"), "onboarding screen missing channel prompt");

  const pairing = await fetch(`${baseUrl}/pairing`, { headers: authHeaders, redirect: "manual" });
  assert(pairing.status === 302 && pairing.headers.get("location") === "/onboard/start", "pairing should hand off to START-code onboarding");

  const invalidWebhook = await fetch(`${baseUrl}/webhooks/photon`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text: "START-DEVCODE", from: "+15555550123" }),
  });
  assert(invalidWebhook.status === 401, "invalid webhook auth should be rejected");

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
  assert(!qrHtml.includes("My verification code is"), "onboard/qr must not render the legacy verification-code SMS copy");

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

async function waitForHealth(url, { timeoutMs = 30000, intervalMs = 250 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastErr;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return res;
      lastErr = new Error(`health check returned ${res.status}`);
    } catch (err) {
      lastErr = err;
    }
    await delay(intervalMs);
  }
  throw new Error(
    `server did not become ready within ${timeoutMs}ms: ${lastErr?.message ?? "unknown"}`,
  );
}
