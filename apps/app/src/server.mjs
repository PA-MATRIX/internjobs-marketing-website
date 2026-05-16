import { createServer } from "node:http";
import { createHmac, timingSafeEqual } from "node:crypto";
import { getConfig, getMissingProviderConfig } from "./config.mjs";
import { getAuth, getSignInUrl, getStartupSignInUrl, requireStartupAuth, setDevSessionCookie, clearDevSessionCookie } from "./auth.mjs";
import { readBody, readForm, redirect, sendHtml, sendJson, getClientIp } from "./http.mjs";
import { createStore } from "./store.mjs";
import { createWelcomeText } from "./messaging.mjs";
import { createSpectrumSmsProvider } from "./sms/spectrum.mjs";
import { startSpectrumWaitlistListener } from "./spectrum-listener.mjs";
import { initMastra, isMastraReady } from "./mastra.mjs";
import { runStudentInboundWorkflow } from "./workflows/student-inbound.mjs";
import { writeRoleEmbedding, logEmbedErr } from "./embeddings.mjs";
import {
  renderLayout,
  renderOnboarding,
  renderPairing,
  renderPairingConfirmed,
  renderProfile,
  renderRoleForm,
  renderSavedProfile,
  renderStartupDashboard,
  renderStartupOnboarding,
  renderStartupSignIn,
  renderWaitlist,
} from "./views.mjs";

const config = getConfig();
const store = createStore(config);
const smsProvider = createSpectrumSmsProvider(config);

// v1.2 Phase 04: initialize Mastra in-process. Idempotent + side-effect-light
// (Mastra defers actual schema creation until first memory/workflow API call).
// Without DATABASE_URL this returns null and /healthz reports mastraReady=false
// — used during the verify-app.mjs smoke suite where ENABLE_DEV_AUTH=true.
initMastra(config);

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

    if (req.method === "GET" && url.pathname === "/healthz") {
      // v1.2 Phase 04 (Flag 5): pgvectorReady checks the actual extension
      // installation rather than just config presence, so it reflects DB
      // state. Cheap (single row in pg_extension), kept on the hot path.
      // Failure (no DB, no pool) → false, not throw.
      let pgvectorReady = false;
      try {
        if (store?.pool) {
          const { rows } = await store.pool.query(
            "select 1 from pg_extension where extname='vector' limit 1",
          );
          pgvectorReady = rows.length > 0;
        }
      } catch (_err) {
        pgvectorReady = false;
      }

      sendJson(res, 200, {
        ok: true,
        service: "internjobs-app",
        configured: {
          clerk: Boolean(config.clerk.publishableKey || config.clerk.signInUrl),
          database: Boolean(config.databaseUrl),
          photonNumber: Boolean(config.photon.fromNumber),
          photonWebhook: Boolean(config.photon.webhookSecret),
          spectrumListener: Boolean(config.enableSpectrumListener),
          // v1.2 Phase 03: presence-only checks (we don't call Resend here).
          emailWorkerSecret: Boolean(config.emailWorkerSecret),
          resendApiKey: Boolean(config.resendApiKey),
        },
        // v1.2 Phase 04 (AGENT-01..03): Mastra readiness surface.
        // mastraReady       — Mastra in-process instance constructed.
        // pgvectorReady     — vector extension actually installed in Postgres.
        // openaiKeyPresent  — key loaded (we don't ping OpenAI on /healthz).
        mastraReady: isMastraReady(),
        pgvectorReady,
        openaiKeyPresent: Boolean(process.env.OPENAI_API_KEY),
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
      // v1.2 Phase 04, Flag 3 fix: parameterize provider so the Spectrum
      // path stays explicitly 'spectrum' (matches messaging_events writes
      // elsewhere and unblocks the future Telnyx adapter without code
      // changes in confirmPairingCode).
      const confirmation = inbound.code
        ? await store.confirmPairingCode({ ...inbound, provider: "spectrum" })
        : await store.recordInboundMessage(inbound);

      if (confirmation.student && confirmation.welcomeNeeded) {
        const welcome = await smsProvider.sendSms(confirmation.student.channelAddress, createWelcomeText(confirmation.student));
        await store.markWelcomeSent(confirmation.student.id, welcome.status, welcome.metadata);
      }

      // v1.2 Phase 04 (AGENT-01): on a regular student reply (not a pairing
      // confirmation), write to inbound_messages and trigger the agent
      // workflow FIRE-AND-FORGET. The HTTP 200 returns immediately; the
      // workflow continues in the background and writes a drafts row.
      // PHASE 04 NEVER SENDS — the workflow's terminal state is drafts row
      // with status='pending_review'. Phase 05 owns the send path.
      if (
        !confirmation.error &&
        confirmation.eventType === "student_reply" &&
        confirmation.student &&
        typeof store.writeInboundMessage === "function"
      ) {
        try {
          const messageId = await store.writeInboundMessage({
            provider: "spectrum",
            providerEventId: inbound.providerEventId,
            channelType: inbound.channelType,
            channelAddress: inbound.channelAddress,
            studentId: confirmation.student.id,
            body: inbound.text,
            metadata: inbound.metadata || {},
          });
          if (messageId && store?.pool) {
            // Fire-and-forget: don't await, don't block the 200 response.
            // Errors are logged but never surface to the SMS provider —
            // operator dashboards (audit_events) are the primary recovery
            // surface, not a 5xx that would trigger SMS retries.
            runStudentInboundWorkflow({ pool: store.pool, messageId }).catch((err) => {
              console.error(
                JSON.stringify({
                  level: "error",
                  message: "student_inbound_workflow_failed",
                  messageId,
                  error: err?.message ?? String(err),
                }),
              );
            });
          }
        } catch (err) {
          // writeInboundMessage failures are non-fatal for the webhook:
          // messaging_events already captured the inbound for ops review.
          console.error(
            JSON.stringify({
              level: "error",
              message: "write_inbound_message_failed",
              error: err?.message ?? String(err),
            }),
          );
        }
      }

      sendJson(res, confirmation.error ? 422 : 200, {
        ok: !confirmation.error,
        duplicate: confirmation.duplicate,
        error: confirmation.error,
        eventType: confirmation.eventType,
      });
      return;
    }

    // ─── Inbound email webhook (v1.2 Phase 03 EMAIL-01) ──────────────────────
    //
    // Receives HMAC-signed payloads from the CF Email Worker
    // (apps/email-worker). The Worker signs payload bytes with EMAIL_WORKER_SECRET
    // using Web Crypto HMAC-SHA256; we verify here with Node crypto. Two
    // checks happen:
    //   1. Fast-fail: shared-secret header equals config.emailWorkerSecret
    //      (constant-time compare via timingSafeEqual).
    //   2. HMAC: recompute HMAC over the raw bytes and timingSafeEqual the hex.
    //
    // If either check fails → 401. If body parse fails → 400. On success we
    // call store.recordEmailInbound which writes an inbound_messages row +
    // an audit_events row, then return 200 quickly so the Worker doesn't
    // fall back to the operator-forward path (PITFALLS #7).
    if (req.method === "POST" && url.pathname === "/webhooks/email") {
      if (!config.emailWorkerSecret) {
        sendJson(res, 503, { error: "email_worker_secret_not_configured" });
        return;
      }

      const rawBody = await readBody(req);
      const providedSecret = String(req.headers["x-email-worker-secret"] || "");
      const providedSig = String(req.headers["x-email-hmac-sha256"] || "");

      const secretOk = safeStringEqual(providedSecret, config.emailWorkerSecret);
      const expectedSig = createHmac("sha256", config.emailWorkerSecret).update(rawBody).digest("hex");
      const sigOk = safeStringEqual(providedSig, expectedSig);

      if (!secretOk || !sigOk) {
        sendJson(res, 401, { error: "unauthorized" });
        return;
      }

      let payload;
      try {
        payload = JSON.parse(rawBody || "{}");
      } catch (_) {
        sendJson(res, 400, { error: "invalid_json" });
        return;
      }

      try {
        const result = await store.recordEmailInbound({
          from: payload.from,
          to: payload.to,
          subject: payload.subject,
          body: payload.body,
          ts: payload.ts,
        });
        sendJson(res, 200, {
          ok: true,
          duplicate: result.duplicate,
          eventType: result.eventType,
        });
      } catch (err) {
        console.error(
          JSON.stringify({
            level: "error",
            message: "email_inbound_persist_failed",
            error: err?.message ?? String(err),
          }),
        );
        // Return 500 so the Worker falls back to operator-forward — the
        // email is not lost; operator sees it in ops@internjobs.ai.
        sendJson(res, 500, { error: "internal_error" });
      }
      return;
    }

    // ─── Startup sign-in landing ─────────────────────────────────────────────
    if (req.method === "GET" && url.pathname === "/startup") {
      sendHtml(
        res,
        200,
        renderLayout({ title: "Startup Access", config, auth: null, body: renderStartupSignIn(config) }),
      );
      return;
    }

    // ─── Startup onboarding ──────────────────────────────────────────────────
    if (req.method === "GET" && url.pathname === "/startup/onboarding") {
      const auth = await requireStartupAuthOrRedirect(req, res);
      if (!auth) return;
      const existing = await store.getStartupByClerkUserId(auth.clerkUserId);
      if (existing?.status === "active") {
        redirect(res, "/startup/dashboard");
        return;
      }
      sendHtml(
        res,
        200,
        renderLayout({
          title: "Company Profile",
          config,
          auth,
          body: renderStartupOnboarding({ auth, startup: existing }),
        }),
      );
      return;
    }

    if (req.method === "POST" && url.pathname === "/startup/onboarding") {
      const auth = await requireStartupAuthOrRedirect(req, res);
      if (!auth) return;
      const form = await readForm(req);
      if (!form.name || !form.consent_messaging) {
        redirect(res, "/startup/onboarding");
        return;
      }
      const startup = await store.createStartupWithFounder({
        clerkUserId: auth.clerkUserId,
        name: String(form.name).slice(0, 200),
        website: String(form.website || "").slice(0, 500),
        email: auth.email,
        founderName: auth.name,
      });
      await store.recordStartupConsent({
        startupId: startup.id,
        consentType: "messaging_on_behalf",
        granted: true,
        grantedByClerkUserId: auth.clerkUserId,
      });
      // Set userType='startup' in Clerk publicMetadata now that onboarding is
      // complete. Per PITFALLS #13: server-side only, via Clerk Backend API.
      if (config.clerk.secretKey) {
        await fetch(`${config.clerk.backendApiUrl}/v1/users/${auth.clerkUserId}`, {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${config.clerk.secretKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ public_metadata: { userType: "startup" } }),
        });
      }
      await store.activateStartup(startup.id);
      redirect(res, "/startup/dashboard");
      return;
    }

    // ─── Startup dashboard ───────────────────────────────────────────────────
    if (req.method === "GET" && url.pathname === "/startup/dashboard") {
      const auth = await requireStartupAuth(req, res, config);
      if (!auth) return;
      const startup = await store.getStartupByClerkUserId(auth.clerkUserId);
      if (!startup || startup.status === "onboarding") {
        redirect(res, "/startup/onboarding");
        return;
      }
      const hasConsent = await store.hasStartupConsent(startup.id, "messaging_on_behalf");
      if (!hasConsent) {
        redirect(res, "/startup/onboarding");
        return;
      }
      const roles = await store.getRolesByStartup(startup.id);
      sendHtml(
        res,
        200,
        renderLayout({
          title: startup.name,
          config,
          auth,
          body: renderStartupDashboard({ startup, roles }),
        }),
      );
      return;
    }

    // ─── Roles: helper that requires startup auth + active consent ───────────
    // Used by all roles routes. Per PITFALLS #12, authorization is enforced
    // here, not inside individual handlers. Per the consent gate in
    // success_criteria #3, missing 'messaging_on_behalf' redirects to onboarding.
    async function requireStartupWithConsent() {
      const auth = await requireStartupAuth(req, res, config);
      if (!auth) return null;
      const startup = await store.getStartupByClerkUserId(auth.clerkUserId);
      if (!startup) {
        redirect(res, "/startup/onboarding");
        return null;
      }
      const hasConsent = await store.hasStartupConsent(startup.id, "messaging_on_behalf");
      if (!hasConsent) {
        redirect(res, "/startup/onboarding");
        return null;
      }
      return { auth, startup };
    }

    // GET /startup/roles/new
    if (req.method === "GET" && url.pathname === "/startup/roles/new") {
      const ctx = await requireStartupWithConsent();
      if (!ctx) return;
      sendHtml(
        res,
        200,
        renderLayout({
          title: "New Role",
          config,
          auth: ctx.auth,
          body: renderRoleForm({ role: null, action: "/startup/roles" }),
        }),
      );
      return;
    }

    // POST /startup/roles
    if (req.method === "POST" && url.pathname === "/startup/roles") {
      const ctx = await requireStartupWithConsent();
      if (!ctx) return;
      const form = await readForm(req);
      if (!form.title || !form.description || !form.requirements) {
        redirect(res, "/startup/roles/new");
        return;
      }
      const role = await store.createRole({
        startupId: ctx.startup.id,
        title: String(form.title).slice(0, 200),
        description: String(form.description).slice(0, 4000),
        requirements: String(form.requirements).slice(0, 4000),
        location: String(form.location || "").slice(0, 100),
        compRange: String(form.comp_range || "").slice(0, 100),
      });
      // v1.2 Phase 04 (AGENT-03): background role embedding write. Same
      // contract as the student-profile hook in store.saveProfileContext —
      // .catch(logEmbedErr), never inline await. A failing OpenAI call must
      // not block the user-visible "role created" redirect.
      if (role?.id && store?.pool) {
        writeRoleEmbedding(
          store.pool,
          role.id,
          flattenRoleForEmbedding(role),
        ).catch(logEmbedErr);
      }
      redirect(res, "/startup/dashboard");
      return;
    }

    // GET /startup/roles/:id/edit
    if (req.method === "GET" && /^\/startup\/roles\/[^/]+\/edit$/.test(url.pathname)) {
      const ctx = await requireStartupWithConsent();
      if (!ctx) return;
      const roleId = url.pathname.split("/")[3];
      const role = await store.getRoleById(roleId, ctx.startup.id);
      if (!role) {
        sendJson(res, 404, { error: "not_found" });
        return;
      }
      sendHtml(
        res,
        200,
        renderLayout({
          title: "Edit Role",
          config,
          auth: ctx.auth,
          body: renderRoleForm({ role, action: `/startup/roles/${roleId}` }),
        }),
      );
      return;
    }

    // POST /startup/roles/:id/pause  (match BEFORE the generic update route)
    if (req.method === "POST" && /^\/startup\/roles\/[^/]+\/pause$/.test(url.pathname)) {
      const ctx = await requireStartupWithConsent();
      if (!ctx) return;
      const roleId = url.pathname.split("/")[3];
      await store.pauseRole(roleId, ctx.startup.id);
      redirect(res, "/startup/dashboard");
      return;
    }

    // POST /startup/roles/:id
    if (req.method === "POST" && /^\/startup\/roles\/[^/]+$/.test(url.pathname)) {
      const ctx = await requireStartupWithConsent();
      if (!ctx) return;
      const roleId = url.pathname.split("/")[3];
      const form = await readForm(req);
      if (!form.title || !form.description || !form.requirements) {
        redirect(res, `/startup/roles/${roleId}/edit`);
        return;
      }
      const updated = await store.updateRole(roleId, ctx.startup.id, {
        title: String(form.title).slice(0, 200),
        description: String(form.description).slice(0, 4000),
        requirements: String(form.requirements).slice(0, 4000),
        location: String(form.location || "").slice(0, 100),
        compRange: String(form.comp_range || "").slice(0, 100),
      });
      // v1.2 Phase 04 (AGENT-03): re-embed on edit so the role-side vector
      // tracks the latest description/requirements. Background, same as create.
      if (updated?.id && store?.pool) {
        writeRoleEmbedding(
          store.pool,
          updated.id,
          flattenRoleForEmbedding(updated),
        ).catch(logEmbedErr);
      }
      redirect(res, "/startup/dashboard");
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

// Onboarding gate: requires an authenticated session that is NOT a student.
// Used by /startup/onboarding GET/POST where userType='startup' is set after
// the consent form is submitted. Authorization is enforced at this middleware
// layer (PITFALLS #12), not inside handlers.
async function requireStartupAuthOrRedirect(req, res) {
  const auth = await getAuth(req, config);
  if (!auth?.clerkUserId) {
    redirect(res, getStartupSignInUrl(config));
    return null;
  }
  if (auth.userType === "student") {
    sendJson(res, 403, { error: "forbidden", reason: "not_startup" });
    return null;
  }
  return auth;
}

// v1.2 Phase 04 (AGENT-03): build the text we embed for a role row. We
// concatenate the discoverable fields with labels so the embedding captures
// "title is X, requirements are Y" rather than a bag of words. Mirrors
// flattenProfileForEmbedding in store.mjs.
function flattenRoleForEmbedding(role) {
  if (!role) return "";
  const parts = [];
  if (role.title) parts.push("title: " + role.title);
  if (role.description) parts.push("description: " + role.description);
  if (role.requirements) parts.push("requirements: " + role.requirements);
  if (role.location) parts.push("location: " + role.location);
  if (role.comp_range) parts.push("comp range: " + role.comp_range);
  return parts.join("\n").trim();
}

// Constant-time string equality. Used by the email webhook to compare both
// the shared-secret header and the HMAC hex string in a timing-safe way.
// Returns false on any length mismatch (timingSafeEqual throws on unequal
// lengths, which would leak length via timing through the throw path).
function safeStringEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
