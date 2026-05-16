import { createServer } from "node:http";
import { getConfig, getMissingProviderConfig } from "./config.mjs";
import { getAuth, getSignInUrl, getStartupSignInUrl, requireStartupAuth, setDevSessionCookie, clearDevSessionCookie } from "./auth.mjs";
import { readBody, readForm, redirect, sendHtml, sendJson, getClientIp } from "./http.mjs";
import { createStore } from "./store.mjs";
import { createWelcomeText } from "./messaging.mjs";
import { createSpectrumSmsProvider } from "./sms/spectrum.mjs";
import { startSpectrumWaitlistListener } from "./spectrum-listener.mjs";
import { renderLayout, renderOnboarding, renderPairing, renderPairingConfirmed, renderProfile, renderSavedProfile, renderWaitlist } from "./views.mjs";

const config = getConfig();
const store = createStore(config);
const smsProvider = createSpectrumSmsProvider(config);

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

    if (req.method === "GET" && url.pathname === "/healthz") {
      sendJson(res, 200, {
        ok: true,
        service: "internjobs-app",
        configured: {
          clerk: Boolean(config.clerk.publishableKey || config.clerk.signInUrl),
          database: Boolean(config.databaseUrl),
          photonNumber: Boolean(config.photon.fromNumber),
          photonWebhook: Boolean(config.photon.webhookSecret),
          spectrumListener: Boolean(config.enableSpectrumListener),
        },
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/config/status") {
      sendJson(res, 200, { missing: getMissingProviderConfig(config) });
      return;
    }

    if (req.method === "GET" && url.pathname === "/") {
      redirect(res, "/waitlist");
      return;
    }

    if (req.method === "GET" && url.pathname === "/waitlist") {
      const auth = await getAuth(req, config);
      if (auth) {
        redirect(res, "/pairing");
        return;
      }
      sendHtml(res, 200, renderLayout({ title: "Join Early Access", config, auth: null, body: renderWaitlist(config) }));
      return;
    }

    if (req.method === "GET" && url.pathname === "/dev/sign-in") {
      if (!config.enableDevAuth) {
        sendJson(res, 404, { error: "not_found" });
        return;
      }
      setDevSessionCookie(res, config);
      redirect(res, "/pairing");
      return;
    }

    if (req.method === "POST" && url.pathname === "/sign-out") {
      clearDevSessionCookie(res);
      redirect(res, "/waitlist");
      return;
    }

    if (req.method === "GET" && url.pathname === "/auth/callback") {
      const auth = await getAuth(req, config);
      if (!auth?.clerkUserId) {
        redirect(res, getSignInUrl(config));
        return;
      }

      // Set userType only if not already set (idempotent). LinkedIn sign-in
      // infers 'student'. Non-LinkedIn sign-in is routed to startup onboarding,
      // where userType='startup' is set after consent. Per PITFALLS #13:
      // userType is set via Clerk Backend API (server-side), never trusted
      // from a client-writable column.
      if (!auth.userType && config.clerk.secretKey) {
        const inferredType = auth.provider === "linkedin" ? "student" : null;
        if (inferredType) {
          await fetch(`${config.clerk.backendApiUrl}/v1/users/${auth.clerkUserId}`, {
            method: "PATCH",
            headers: {
              Authorization: `Bearer ${config.clerk.secretKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ public_metadata: { userType: inferredType } }),
          });
        } else {
          // Non-LinkedIn sign-in with no userType — route to startup onboarding.
          redirect(res, "/startup/onboarding");
          return;
        }
      }

      // Existing students land on /pairing; startups on /startup/dashboard.
      if (auth.userType === "startup") {
        redirect(res, "/startup/dashboard");
        return;
      }
      redirect(res, "/pairing");
      return;
    }

    if (req.method === "GET" && url.pathname === "/onboarding") {
      const auth = await requireAuth(req, res);
      if (!auth) return;
      const student = await store.upsertStudentFromAuth(auth);
      sendHtml(res, 200, renderLayout({ title: "Onboarding", config, auth, body: renderOnboarding(student) }));
      return;
    }

    if (req.method === "GET" && url.pathname === "/pairing") {
      const auth = await requireAuth(req, res);
      if (!auth) return;
      const student = await store.upsertStudentFromAuth(auth);
      if (student.status === "channel_confirmed") {
        sendHtml(res, 200, renderLayout({ title: "Messages Connected", config, auth, body: renderPairingConfirmed(student) }));
        return;
      }
      const pairing = await store.createOrRefreshPairingCode(student.id);
      sendHtml(res, 200, renderLayout({ title: "Pair Messages", config, auth, body: await renderPairing({ student, pairing, config }) }));
      return;
    }

    if (req.method === "POST" && url.pathname === "/pairing/regenerate") {
      const auth = await requireAuth(req, res);
      if (!auth) return;
      const student = await store.upsertStudentFromAuth(auth);
      await store.expireAndCreatePairingCode(student.id);
      redirect(res, "/pairing");
      return;
    }

    if (req.method === "GET" && url.pathname === "/profile") {
      const auth = await requireAuth(req, res);
      if (!auth) return;
      const student = await store.upsertStudentFromAuth(auth);
      const context = await store.getProfileContext(student.id);
      sendHtml(res, 200, renderLayout({ title: "Profile Context", config, auth, body: renderProfile({ student, context }) }));
      return;
    }

    if (req.method === "POST" && url.pathname === "/profile") {
      const auth = await requireAuth(req, res);
      if (!auth) return;
      const student = await store.upsertStudentFromAuth(auth);
      const form = await readForm(req);
      await store.saveProfileContext(student.id, {
        interests: String(form.interests || "")
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean)
          .slice(0, 12),
        projects: String(form.projects || "").slice(0, 4000),
        preferredWork: String(form.preferredWork || "").slice(0, 500),
        notes: String(form.notes || "").slice(0, 2000),
      });
      sendHtml(res, 200, renderLayout({ title: "Profile Saved", config, auth, body: renderSavedProfile() }));
      return;
    }

    if (req.method === "POST" && url.pathname === "/webhooks/photon") {
      const rawBody = await readBody(req);
      const verified = smsProvider.verifyWebhook(req, rawBody);
      if (!verified.ok) {
        sendJson(res, 401, { error: "unauthorized" });
        return;
      }

      const payload = JSON.parse(rawBody || "{}");
      const inbound = smsProvider.parseInbound(payload);
      const confirmation = inbound.code ? await store.confirmPairingCode(inbound) : await store.recordInboundMessage(inbound);

      if (confirmation.student && confirmation.welcomeNeeded) {
        const welcome = await smsProvider.sendSms(confirmation.student.channelAddress, createWelcomeText(confirmation.student));
        await store.markWelcomeSent(confirmation.student.id, welcome.status, welcome.metadata);
      }

      sendJson(res, confirmation.error ? 422 : 200, {
        ok: !confirmation.error,
        duplicate: confirmation.duplicate,
        error: confirmation.error,
        eventType: confirmation.eventType,
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/ops/privacy") {
      sendHtml(
        res,
        200,
        renderLayout({
          title: "Privacy Operations",
          config,
          auth: await getAuth(req, config),
          body: `<section class="panel narrow"><p class="eyebrow">Operations</p><h1>Privacy controls before production data.</h1><p class="lede">User deletion/export requests should be handled from audit-backed database records. Do not log profile snapshots, message bodies, provider tokens, or raw webhook payloads.</p></section>`,
        }),
      );
      return;
    }

    sendJson(res, 404, { error: "not_found" });
  } catch (error) {
    console.error(
      JSON.stringify({
        level: "error",
        message: "request_failed",
        path: req.url,
        ip: getClientIp(req),
        error: error.message,
      }),
    );
    sendJson(res, 500, { error: "internal_error" });
  }
});

server.listen(config.port, config.host, () => {
  console.log(`InternJobs.ai app listening on ${config.host}:${config.port}`);
});

startSpectrumWaitlistListener({ config, store, smsProvider });

async function requireAuth(req, res) {
  const auth = await getAuth(req, config);
  if (auth?.clerkUserId) return auth;

  redirect(res, getSignInUrl(config));
  return null;
}
