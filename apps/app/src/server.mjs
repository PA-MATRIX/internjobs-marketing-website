import { createServer } from "node:http";
import { createHmac, timingSafeEqual } from "node:crypto";
import { getConfig, getMissingProviderConfig } from "./config.mjs";
import { getAuth, getSignInUrl, getStartupSignInUrl, requireStartupAuth, requireOperatorAuth as requireOperatorAuthImpl, setDevSessionCookie, clearDevSessionCookie, applyHandshakeOrContinue, tryDeriveLinkedInProfileUrl } from "./auth.mjs";
import { readBody, readForm, redirect, sendHtml, sendJson, getClientIp } from "./http.mjs";
import { createStore, hasLinkedInProfileUrl } from "./store.mjs";
import { createWelcomeText } from "./messaging.mjs";
import { createSpectrumSmsProvider } from "./sms/spectrum.mjs";
import { createMacBridgeSmsProvider } from "./sms/mac-bridge.mjs";
import { startSpectrumWaitlistListener } from "./spectrum-listener.mjs";
import { initMastra, isMastraReady } from "./mastra.mjs";
import { runStudentInboundWorkflow } from "./workflows/student-inbound.mjs";
// v1.3 Phase 20 SAFETY-01: Lakera Guard pre-LLM screen.
import { screenMessage } from "./safety/screen.mjs";
import { writeRoleEmbedding, logEmbedErr } from "./embeddings.mjs";
import { ensureGraphSchema, pingGraph } from "./memory/graph.mjs";
import {
  renderLayout,
  renderOnboarding,
  renderOnboardingQR,
  renderOnboardingMobile,
  renderOnboardingSuccess,
  renderPairingConfirmed,
  renderProfile,
  renderRoleForm,
  renderSavedProfile,
  renderStartupDashboard,
  renderStartupOnboarding,
  renderStartupSignIn,
  renderWaitlist,
  renderMessageLog,
  renderDraftDetail,
  renderFeedbackLog,
  renderLinkedInRequired,
  renderLinkedInUrlCapture,
} from "./views.mjs";
import { enrichByBrightDataLinkedInUrl } from "./onboarding/brightdata.mjs";
import {
  generatePairingCode,
  parsePairingCode,
  claimPairingCode,
  lookupPairingStatus,
} from "./onboarding/pairing.mjs";
// routeAndSend was previously imported here for the /ops/drafts/:id/approve
// path; after the 2026-05-17 autonomy pivot the approve/edit/reject routes
// are gone and the Mastra workflow calls outbound.routeAndSend directly.
// Kept commented to make the pivot visible during code review.
// import { routeAndSend } from "./outbound.mjs";
import { handleInteg01Status } from "./routes/admin.mjs";
import { getR2Client } from "./storage/r2.mjs";

const config = getConfig();
const store = createStore(config);

// v1.2 (2026-05-17): SMS provider selector. Production uses
// SMS_PROVIDER=mac-bridge: BlueBubbles on the self-hosted Mac mini is the
// active path. Legacy Photon/Spectrum routes stay wired for old callbacks
// and tests, but they do not define the visible pairing number.
const spectrumProvider = createSpectrumSmsProvider(config);
const macBridgeProvider = createMacBridgeSmsProvider(config);

// v1.2 Phase 04: initialize Mastra in-process. Idempotent + side-effect-light
// (Mastra defers actual schema creation until first memory/workflow API call).
// Without DATABASE_URL this returns null and /healthz reports mastraReady=false
// — used during the verify-app.mjs smoke suite where ENABLE_DEV_AUTH=true.
initMastra(config);

// v1.2 MEMORY-01: bootstrap the FalkorDB graph schema on startup.
// Fail-soft: if FALKORDB_URL is unset or the DB is unreachable, the
// function logs a warning and returns false; the app boots normally.
// Indexes are idempotent — re-running ensureGraphSchema on every boot
// is the desired pattern (cheap, no-op when already present).
ensureGraphSchema().catch((err) => {
  console.warn(
    JSON.stringify({
      level: "warn",
      message: "graph_schema_bootstrap_failed",
      error: err?.message ?? String(err),
    }),
  );
});

// v1.2 MEMORY-01: graphReady cache. /healthz hits PING but we don't want
// to spam the graph DB on every probe. 30s cache window matches the
// internal-network latency budget (a PING is sub-ms but the round-trip
// + JSON parse adds up at high request rates).
let _graphReadyCache = { value: false, ts: 0 };
async function checkGraphReady() {
  const now = Date.now();
  if (now - _graphReadyCache.ts < 30_000) return _graphReadyCache.value;
  let val = false;
  try {
    val = await pingGraph();
  } catch (_) {
    val = false;
  }
  _graphReadyCache = { value: val, ts: now };
  return val;
}

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

      // v1.2 MEMORY-01: graphReady = FALKORDB_URL set AND PING round-trips.
      // 30s cached (see checkGraphReady) so a stampede of /healthz hits
      // doesn't beat up the graph DB.
      const graphReady = Boolean(process.env.FALKORDB_URL) && (await checkGraphReady());

      sendJson(res, 200, {
        ok: true,
        service: "internjobs-app",
        configured: {
          clerk: Boolean(config.clerk.publishableKey || config.clerk.signInUrl),
          database: Boolean(config.databaseUrl),
          agentNumber: Boolean(config.onboarding.agentNumber),
          macBridge: Boolean(config.macBridge.url && config.macBridge.hmacSecret),
          // v1.2 Phase 03: presence-only checks (we don't call CF here).
          // cloudflareEmailReady is true iff BOTH the account id and the
          // Email-Sending-scoped API token are present — the send call
          // needs both, so a single boolean keeps the operator-facing
          // readiness signal honest.
          emailWorkerSecret: Boolean(config.emailWorkerSecret),
          cloudflareEmailReady: Boolean(
            config.cloudflareEmailAccountId && config.cloudflareEmailApiToken,
          ),
          brightdata: Boolean(config.brightdata?.apiToken),
        },
        // v1.2 Phase 04 (AGENT-01..03): Mastra readiness surface.
        // mastraReady     — Mastra in-process instance constructed.
        // pgvectorReady   — vector extension actually installed in Postgres.
        // workersAiReady  — both CLOUDFLARE_AI_ACCOUNT_ID +
        //                   CLOUDFLARE_AI_API_TOKEN set. We do not call
        //                   the CF API on /healthz (no network hit on the
        //                   hot path); presence-only check. Replaces the
        //                   deprecated aiProxyReady flag (2026-05-16
        //                   Workers AI direct tear-out — proxy Worker
        //                   removed in favor of direct REST).
        mastraReady: isMastraReady(),
        pgvectorReady,
        workersAiReady: Boolean(config.cloudflareAi?.accountId && config.cloudflareAi?.apiToken),
        // v1.2 STORAGE-01 (scope-add 2026-05-16): r2Ready is true iff all
        // four R2 envs are set (accountId + accessKeyId + secretAccessKey)
        // AND the client constructed without error. Unset envs are NOT a
        // failure — STORAGE-01 ships the scaffold only; ingestion lands in
        // v1.3. We do not call R2 here (no network hit on /healthz).
        r2Ready: Boolean(
          config.r2?.accountId &&
            config.r2?.accessKeyId &&
            config.r2?.secretAccessKey &&
            getR2Client() !== null,
        ),
        // v1.2 MEMORY-01: self-hosted graph memory readiness. true iff
        // FALKORDB_URL is set AND a PING + RETURN 1 round-trips. The
        // student app boots fine without it (graph features degrade
        // gracefully — agent has no cross-conversation recall).
        graphReady,
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
      // AUTH-PROD: handshake sentinel → forward Clerk's headers + 307.
      if (applyHandshakeOrContinue(res, auth)) return;
      if (auth) {
        redirect(res, "/onboard/start");
        return;
      }
      sendHtml(res, 200, renderLayout({ title: "Join Early Access", config, auth: null, body: renderWaitlist(config), bgEffect: "clouds", embedClerk: true }));
      return;
    }

    // v1.2 Phase 05: dev-only seed endpoint for the operator smoke suite.
    // POST /dev/seed-draft with JSON body { recipient_type, channel, ... }
    // inserts a pending draft row via store.insertDraftForTest and returns
    // the new id. Gated by ENABLE_DEV_AUTH so production cannot hit this
    // even by accident.
    if (req.method === "POST" && url.pathname === "/dev/seed-draft") {
      if (!config.enableDevAuth) {
        sendJson(res, 404, { error: "not_found" });
        return;
      }
      const raw = await readBody(req);
      let payload = {};
      try {
        payload = JSON.parse(raw || "{}");
      } catch (_) {
        sendJson(res, 400, { error: "invalid_json" });
        return;
      }
      if (typeof store.insertDraftForTest !== "function") {
        sendJson(res, 503, { error: "store_does_not_support_seed" });
        return;
      }
      const draft = await store.insertDraftForTest(payload);
      sendJson(res, 200, { ok: true, draft });
      return;
    }

    if (req.method === "GET" && url.pathname === "/dev/sign-in") {
      if (!config.enableDevAuth) {
        sendJson(res, 404, { error: "not_found" });
        return;
      }
      // v1.2 Phase 05: optional ?role=operator|startup query lets the dev
      // sign-in mint a non-student identity. Used by the smoke suite to
      // hit /ops/* without standing up a real Clerk session. Gated by
      // ENABLE_DEV_AUTH=true; production cannot reach this branch.
      const role = url.searchParams.get("role");
      if (role === "operator") {
        setDevSessionCookie(res, config, {
          sub: "dev_operator",
          email: "ops@internjobs.ai",
          name: "Ops Person",
          provider: "linkedin",
          linkedinProfileUrl: "",
          userType: "operator",
        });
        redirect(res, "/ops/drafts");
        return;
      }
      if (role === "startup") {
        setDevSessionCookie(res, config, {
          sub: "dev_startup_founder",
          email: "founder@startup.example",
          name: "Founder Person",
          provider: "google",
          linkedinProfileUrl: "",
          userType: "startup",
        });
        redirect(res, "/startup/dashboard");
        return;
      }
      setDevSessionCookie(res, config);
      redirect(res, "/onboard/start");
      return;
    }

    if (req.method === "POST" && url.pathname === "/sign-out") {
      clearDevSessionCookie(res);
      redirect(res, "/waitlist");
      return;
    }

    if (req.method === "GET" && url.pathname === "/auth/callback") {
      const auth = await getAuth(req, config);
      // AUTH-PROD (2026-05-16): the bug was here. On the first hop after
      // LinkedIn sign-in completed, Clerk redirects to /auth/callback with
      // a `__clerk_handshake` URL param (no `__session` cookie yet). The
      // old JWKS-only verifier saw no cookie, returned null, and we
      // redirected back to sign-in — auth loop. authenticateRequest() now
      // returns a handshake state on that exact hop; we forward Clerk's
      // Set-Cookie + Location headers verbatim with 307, and the browser
      // follows up with the session cookie in place.
      if (applyHandshakeOrContinue(res, auth)) return;
      if (!auth?.clerkUserId) {
        redirect(res, getSignInUrl(config));
        return;
      }

      // Set userType only if not already set (idempotent). LinkedIn sign-in
      // infers 'student'. Non-LinkedIn sign-in is routed to startup onboarding,
      // where userType='startup' is set after consent. Per PITFALLS #13:
      // userType is set via Clerk Backend API (server-side), never trusted
      // from a client-writable column.
      const authIntent = url.searchParams.get("intent");
      if (!auth.userType && config.clerk.secretKey) {
        const existingStudent = await store.getStudentByClerkId(auth.clerkUserId);
        const inferredType =
          authIntent === "student"
            ? "student"
            : authIntent === "startup"
              ? null
              : auth.provider === "linkedin" && hasPairableLinkedIn(auth, existingStudent)
                ? "student"
                : null;
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

      // Existing students land on the START-code onboarding flow; startups
      // land on /startup/dashboard.
      if (auth.userType === "startup") {
        redirect(res, "/startup/dashboard");
        return;
      }

      // Best-effort: if the session JWT didn't carry a LinkedIn URL (it
      // usually doesn't — Clerk session JWTs only ship `sub` by default,
      // and LinkedIn's modern OIDC scope doesn't return a vanity slug),
      // try to recover it from the Clerk user's external_accounts before
      // prompting the student. Swallow all errors — this path NEVER
      // blocks sign-in; falls through to the existing prompt page when
      // we can't derive a URL.
      if (!auth.linkedinProfileUrl && auth.provider === "linkedin" && config.clerk.secretKey) {
        const derived = await tryDeriveLinkedInProfileUrl(auth.clerkUserId, config);
        if (derived) auth.linkedinProfileUrl = derived;
      }

      const student = await store.upsertStudentFromAuth(auth);
      if (!hasPairableLinkedIn(auth, student)) {
        redirect(res, "/linkedin/profile-url");
        return;
      }
      redirect(res, "/onboard/start");
      return;
    }

    if (req.method === "GET" && url.pathname === "/linkedin/profile-url") {
      const auth = await requireAuth(req, res);
      if (!auth) return;
      const student = await store.upsertStudentFromAuth(auth);
      if (hasPairableLinkedIn(auth, student)) {
        redirect(res, "/onboard/start");
        return;
      }
      sendHtml(
        res,
        200,
        renderLayout({
          title: "LinkedIn Profile",
          config,
          auth,
          body: renderLinkedInUrlCapture({ value: auth.linkedinProfileUrl || student.linkedinProfileUrl || "" }),
        }),
      );
      return;
    }

    if (req.method === "POST" && url.pathname === "/linkedin/profile-url") {
      const auth = await requireAuth(req, res);
      if (!auth) return;
      const student = await store.upsertStudentFromAuth(auth);
      const form = await readForm(req);
      try {
        const updated = await store.updateStudentLinkedInProfileUrl(
          student.id,
          form.linkedinProfileUrl,
          "student_profile_url_form",
        );
        await ensureLinkedInProfileForFirstContact(updated.id);
        redirect(res, "/onboard/start");
      } catch (err) {
        const message =
          err?.message === "invalid_linkedin_profile_url"
            ? "Use a public LinkedIn profile URL like https://www.linkedin.com/in/your-name."
            : "Couldn't save that LinkedIn URL. Try again.";
        sendHtml(
          res,
          400,
          renderLayout({
            title: "LinkedIn Profile",
            config,
            auth,
            body: renderLinkedInUrlCapture({
              value: String(form.linkedinProfileUrl || ""),
              error: message,
            }),
          }),
        );
      }
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
      if (!hasPairableLinkedIn(auth, student)) {
        sendLinkedInRequired(res, auth);
        return;
      }
      if (student.status === "channel_confirmed") {
        sendHtml(res, 200, renderLayout({ title: "Messages Connected", config, auth, body: renderPairingConfirmed(student) }));
        return;
      }
      redirect(res, "/onboard/start");
      return;
    }

    if (req.method === "POST" && url.pathname === "/pairing/regenerate") {
      const auth = await requireAuth(req, res);
      if (!auth) return;
      const student = await store.upsertStudentFromAuth(auth);
      if (!hasPairableLinkedIn(auth, student)) {
        redirect(res, "/pairing");
        return;
      }
      redirect(res, "/onboard/start");
      return;
    }

    // ─── v1.2 Phase 09 — Standout-style onboarding ──────────────────────────
    //
    // Flow:
    //   /auth/callback (Clerk LinkedIn OAuth) → /onboard/start
    //     ↓ server-side
    //   LinkedIn URL → Bright Data profile enrichment → linkedin_profiles
    //     ↓
    //   generatePairingCode(student.id) → pairing_sessions row
    //     ↓
    //   Render /onboard/qr (desktop) OR /onboard/mobile (mobile UA) with the
    //   sms:// URI baked into a QR / deep-link button
    //     ↓
    //   Student texts START-XXXXXX → Mac bridge → /webhooks/mac-bridge (below)
    //     ↓
    //   claimPairingCode binds students.channel_address = phone, fires the
    //   first-contact workflow with the LinkedIn block in the prompt.

    if (req.method === "GET" && url.pathname === "/onboard/start") {
      const auth = await requireAuth(req, res);
      if (!auth) return;
      const student = await store.upsertStudentFromAuth(auth);
      if (!hasPairableLinkedIn(auth, student)) {
        sendLinkedInRequired(res, auth);
        return;
      }
      if (student.status === "channel_confirmed") {
        redirect(res, "/onboard/success");
        return;
      }
      // Cookie used by /onboard/qr + /onboard/mobile + /onboard/status to look
      // up the active pairing code without putting the code in the URL.
      // Short-lived (matches the pairing TTL). HttpOnly so client JS can't
      // read it — the status poll goes through the server. SameSite=Lax is
      // fine since these are all same-origin GETs.
      const ttlHours = config.onboarding.pairingTtlHours;
      let pairingCode = null;
      if (store?.pool) {
        try {
          pairingCode = await generatePairingCode(store.pool, student.id, {
            ttlHours,
            source: detectMobile(req) ? "mobile-deeplink" : "qr",
          });
        } catch (err) {
          console.error(
            JSON.stringify({
              level: "error",
              message: "pairing_code_generate_failed",
              error: err?.message ?? String(err),
            }),
          );
        }
      } else if (config.enableDevAuth) {
        // Dev/test mode (no DATABASE_URL). Generate a deterministic-shaped
        // code so /onboard/qr can render and the smoke suite can exercise
        // the route. The code is NOT persisted (no pairing_sessions row),
        // so /onboard/status will always return paired: false in this mode.
        pairingCode = "START-DEVCODE";
      }

      // LinkedIn enrichment is part of the onboarding contract. Bright Data is
      // the only URL→profile provider because the QR code is tied to that
      // exact LinkedIn identity. It runs in the BACKGROUND (not awaited) so
      // the QR page renders immediately — the student can scan while the
      // Bright Data scrape is still in flight. The function is idempotent and
      // is also invoked on the /webhooks/mac-bridge pairing claim, so the
      // first-contact workflow still gets the profile even if this background
      // run is slow. Fail-soft: a scrape error never blocks pairing.
      void ensureLinkedInProfileForFirstContact(student.id).catch((err) => {
        console.error(
          JSON.stringify({
            level: "error",
            message: "background_linkedin_enrichment_failed",
            studentId: student.id,
            error: err?.message ?? String(err),
          }),
        );
      });

      if (pairingCode) {
        setPairingCodeCookie(res, pairingCode, ttlHours);
      }

      // Mobile UA → deep-link page; desktop → QR page.
      redirect(res, detectMobile(req) ? "/onboard/mobile" : "/onboard/qr");
      return;
    }

    if (req.method === "GET" && url.pathname === "/onboard/qr") {
      const auth = await requireAuth(req, res);
      if (!auth) return;
      const student = await store.getStudentByClerkId(auth.clerkUserId);
      if (!hasPairableLinkedIn(auth, student)) {
        sendLinkedInRequired(res, auth);
        return;
      }
      const pairingCode = getPairingCodeCookie(req);
      if (!pairingCode) {
        redirect(res, "/onboard/start");
        return;
      }
      const agentNumber = config.onboarding.agentNumber;
      const smsUri = buildSmsUri(agentNumber, pairingCode);
      sendHtml(
        res,
        200,
        renderLayout({
          title: "Pair your phone",
          config,
          auth,
          body: await renderOnboardingQR({ pairingCode, smsUri, agentNumber }),
        }),
      );
      return;
    }

    if (req.method === "GET" && url.pathname === "/onboard/mobile") {
      const auth = await requireAuth(req, res);
      if (!auth) return;
      const student = await store.getStudentByClerkId(auth.clerkUserId);
      if (!hasPairableLinkedIn(auth, student)) {
        sendLinkedInRequired(res, auth);
        return;
      }
      const pairingCode = getPairingCodeCookie(req);
      if (!pairingCode) {
        redirect(res, "/onboard/start");
        return;
      }
      const agentNumber = config.onboarding.agentNumber;
      const smsUri = buildSmsUri(agentNumber, pairingCode);
      sendHtml(
        res,
        200,
        renderLayout({
          title: "Pair your phone",
          config,
          auth,
          body: renderOnboardingMobile({ pairingCode, smsUri, agentNumber }),
        }),
      );
      return;
    }

    if (req.method === "GET" && url.pathname === "/onboard/status") {
      // Polled by /onboard/qr + /onboard/mobile every 3s. Returns
      // { paired: bool, claimed_phone?: string }. Auth required so a leaked
      // code can't be probed externally; the cookie carries the code.
      const auth = await requireAuth(req, res);
      if (!auth) return;
      const student = await store.getStudentByClerkId(auth.clerkUserId);
      if (!hasPairableLinkedIn(auth, student)) {
        sendJson(res, 200, { paired: false, reason: "linkedin_profile_required_for_pairing" });
        return;
      }
      const pairingCode = getPairingCodeCookie(req);
      if (!pairingCode || !store?.pool) {
        sendJson(res, 200, { paired: false });
        return;
      }
      const status = await lookupPairingStatus(store.pool, pairingCode);
      sendJson(res, 200, {
        paired: Boolean(status?.paired),
        ...(status?.claimedPhone ? { claimed_phone: status.claimedPhone } : {}),
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/onboard/success") {
      const auth = await requireAuth(req, res);
      if (!auth) return;
      // Drop the cookie now that we've paired (best-effort; route works
      // without it either way).
      clearPairingCodeCookie(res);
      sendHtml(
        res,
        200,
        renderLayout({
          title: "Paired",
          config,
          auth,
          body: renderOnboardingSuccess(),
        }),
      );
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
      const verified = spectrumProvider.verifyWebhook(req, rawBody);
      if (!verified.ok) {
        sendJson(res, 401, { error: "unauthorized" });
        return;
      }

      const payload = JSON.parse(rawBody || "{}");
      const inbound = spectrumProvider.parseInbound(payload);
      // v1.2 Phase 04, Flag 3 fix: parameterize provider so the Spectrum
      // path stays explicitly 'spectrum' (matches messaging_events writes
      // elsewhere and unblocks the future Telnyx adapter without code
      // changes in confirmPairingCode).
      const confirmation = inbound.code
        ? await store.confirmPairingCode({ ...inbound, provider: "spectrum" })
        : await store.recordInboundMessage(inbound);

      if (confirmation.student && confirmation.welcomeNeeded) {
        const welcome = await spectrumProvider.sendSms(confirmation.student.channelAddress, createWelcomeText(confirmation.student));
        await store.markWelcomeSent(confirmation.student.id, welcome.status, welcome.metadata);
      }

      // v1.2 Phase 04 (AGENT-01) + 2026-05-17 autonomy pivot: on a regular
      // student reply (not a pairing confirmation), write to
      // inbound_messages and trigger the agent workflow FIRE-AND-FORGET.
      // The HTTP 200 returns immediately; the workflow continues in the
      // background, drafts the response, AND autonomously sends it via the
      // outbound router. The terminal draft state is 'sent' (or 'failed').
      // The prior 'pending_review' operator-gate is GONE — /ops/drafts is
      // now a read-only audit log + flag-for-review surface.
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
            // v1.3 SAFETY-01: Pre-LLM screen BEFORE agent sees the text.
            // Hard-block on prompt_injection >= 0.8. Fail-open — Lakera downtime
            // must never block student SMS. Canned reply matches AGENT_VOICE.
            // The inbound_messages row is already written (audit trail preserved).
            const _screenStart = Date.now();
            const screenResult = await screenMessage(
              inbound.text || "",
              process.env.LAKERA_GUARD_API_KEY || "",
            );
            const _screenMs = Date.now() - _screenStart;
            console.log(JSON.stringify({ level: "info", event: "lakera_latency_ms", ms: _screenMs, channel: "sms", source: "photon" }));
            const injectionScore = screenResult.score ?? 0;
            // Lakera v2 returns a binary flag (no per-category score) — `flagged: true`
            // alone is sufficient to hard-block. The `>= 0.8` clause is the forward-compat
            // shim for if Lakera ever re-introduces a per-category numeric score.
            const isHardBlock = screenResult.flagged === true || injectionScore >= 0.8;

            if (screenResult.action !== "passed") {
              console.log(JSON.stringify({
                level: "info",
                event: "lakera_screen",
                action: screenResult.action,
                reason: screenResult.reason,
                score: screenResult.score,
                channel: "sms",
                hard_block: isHardBlock,
                sender_last4: (inbound.channelAddress || "").slice(-4),
                message_id: messageId,
                preview: (inbound.text || "").slice(0, 80),
              }));

              // Plan 20-03: Write to Neon safety_events (fire-and-forget — must not block webhook 200)
              const senderAddr = inbound.channelAddress || "";
              store.pool.query(
                `insert into safety_events
                   (channel, action, reason, score, sender_last4, preview, reviewed)
                 values ($1, $2, $3, $4, $5, $6, false)`,
                [
                  "sms",
                  isHardBlock ? "blocked" : screenResult.action,
                  screenResult.reason,
                  screenResult.score,
                  senderAddr.slice(-4),
                  (inbound.text || "").slice(0, 80),
                ],
              ).catch((err) => {
                console.error(JSON.stringify({ level: "error", event: "safety_events_write_failed", error: err?.message ?? String(err) }));
              });
            }

            if (isHardBlock) {
              // SAFETY-RESPONSE-01: canned reply matches AGENT_VOICE exactly.
              // No throw on send failure — log and continue so the 200 still goes
              // back to the legacy provider (no retry storm).
              try {
                await spectrumProvider.sendSms(
                  inbound.channelAddress,
                  "hey — couldn't process that one. try rephrasing?",
                );
              } catch (sendErr) {
                console.error(JSON.stringify({
                  level: "error",
                  event: "safety_block_reply_failed",
                  error: sendErr?.message ?? String(sendErr),
                }));
              }
              // Do NOT call runStudentInboundWorkflow — agent must not see this text.
            } else {
              // Fire-and-forget: don't await, don't block the 200 response.
              // Errors are logged but never surface to the SMS provider —
              // audit_events is the primary recovery surface, not a 5xx
              // that would trigger SMS retries.
              //
              // Autonomy pivot (2026-05-17): pass smsProvider + config so
              // the workflow can autonomously route the draft to the
              // outbound provider. Without these the workflow still drafts
              // but marks the row 'failed' with reason='no_sms_provider'.
              runStudentInboundWorkflow({
                pool: store.pool,
                messageId,
                smsProvider: spectrumProvider,
                config,
              }).catch((err) => {
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

    // ─── Inbound iMessage/SMS via self-hosted Mac bridge (v1.2 2026-05-17) ───
    //
    // apps/mac-bridge (running on a Mac mini at HostMyApple) POSTs every
    // inbound message here, signed with x-bridge-signature: sha256=<hex>
    // over the raw body using BRIDGE_HMAC_SECRET. Payload shape:
    //   { providerEventId, platform: 'imessage'|'sms', from, spaceId,
    //     messageId, text, ts }
    //
    // Mirrors /webhooks/photon: pairing-code path runs first when the body
    // matches, otherwise we recordInboundMessage + fire the agent workflow
    // fire-and-forget. Outbound replies go back through BlueBubbles via
    // macBridgeProvider.
    if (req.method === "POST" && url.pathname === "/webhooks/mac-bridge") {
      const rawBody = await readBody(req);
      const verified = macBridgeProvider.verifyWebhook(req, rawBody);
      if (!verified.ok) {
        sendJson(res, 401, { error: "unauthorized", reason: verified.reason });
        return;
      }

      const payload = JSON.parse(rawBody || "{}");
      const inbound = macBridgeProvider.parseInbound(payload);

      // v1.2 Phase 09 — START- pairing-code branch. Runs BEFORE the legacy
      // hex/IJ-XXXXXX confirmPairingCode path so a Standout-style code
      // matches even if parseInbound's legacy regex happened to also pick
      // something up. claimPairingCode binds the phone atomically; on
      // success we fire the FIRST-CONTACT workflow with the LinkedIn
      // context already in place.
      const startCode = parsePairingCode(inbound.text);
      if (startCode && store?.pool) {
        const claim = await claimPairingCode(store.pool, startCode, inbound.channelAddress, {
          channelType: inbound.channelType,
        });
        if (claim.ok) {
          await ensureLinkedInProfileForFirstContact(claim.studentId);

          // Record the inbound for messaging_events observability and
          // write an inbound_messages row so the workflow has something
          // to consume. providerEventId from the bridge is reused so
          // dedup still works on a retry.
          await store.writeMessagingEvent({
            provider: "mac-bridge",
            providerEventId: inbound.providerEventId,
            studentId: claim.studentId,
            direction: "inbound",
            channelType: inbound.channelType,
            channelAddress: inbound.channelAddress,
            eventType: "pairing_started",
            deliveryStatus: "received",
            metadata: { ...inbound.metadata, pairingCode: startCode, source: "phase-09" },
          });
          await store.writeAuditEvent(claim.studentId, "pairing_started", "provider", {
            code: startCode,
            channelType: inbound.channelType,
          });

          if (typeof store.writeInboundMessage === "function") {
            try {
              const messageId = await store.writeInboundMessage({
                provider: "mac-bridge",
                providerEventId: inbound.providerEventId,
                channelType: inbound.channelType,
                channelAddress: inbound.channelAddress,
                studentId: claim.studentId,
                body: inbound.text,
                metadata: { ...inbound.metadata, firstContact: true, pairingCode: startCode },
              });
              if (messageId && store?.pool) {
                // v1.3 SAFETY-01: Pre-LLM screen on mac-bridge pairing first-contact path.
                // Same hard-block rule (>=0.8) and fail-open semantics as photon.
                const _screenStart = Date.now();
                const screenResult = await screenMessage(
                  inbound.text || "",
                  process.env.LAKERA_GUARD_API_KEY || "",
                );
                const _screenMs = Date.now() - _screenStart;
                console.log(JSON.stringify({ level: "info", event: "lakera_latency_ms", ms: _screenMs, channel: "sms", source: "mac-bridge-pairing" }));
                const injectionScore = screenResult.score ?? 0;
                // Lakera v2 returns a binary flag (no per-category score) — `flagged: true`
                // alone is sufficient to hard-block. The `>= 0.8` clause is the forward-compat
                // shim for if Lakera ever re-introduces a per-category numeric score.
                const isHardBlock = screenResult.flagged === true || injectionScore >= 0.8;

                if (screenResult.action !== "passed") {
                  console.log(JSON.stringify({
                    level: "info",
                    event: "lakera_screen",
                    action: screenResult.action,
                    reason: screenResult.reason,
                    score: screenResult.score,
                    channel: "sms",
                    hard_block: isHardBlock,
                    sender_last4: (inbound.channelAddress || "").slice(-4),
                    message_id: messageId,
                    source: "mac-bridge-pairing",
                    preview: (inbound.text || "").slice(0, 80),
                  }));

                  store.pool.query(
                    `insert into safety_events
                       (channel, action, reason, score, sender_last4, preview, reviewed)
                     values ($1, $2, $3, $4, $5, $6, false)`,
                    [
                      "sms",
                      isHardBlock ? "blocked" : screenResult.action,
                      screenResult.reason,
                      screenResult.score,
                      (inbound.channelAddress || "").slice(-4),
                      (inbound.text || "").slice(0, 80),
                    ],
                  ).catch((err) => {
                    console.error(JSON.stringify({ level: "error", event: "safety_events_write_failed", error: err?.message ?? String(err) }));
                  });
                }

                if (isHardBlock) {
                  try {
                    await macBridgeProvider.sendSms(
                      inbound.channelAddress,
                      "hey — couldn't process that one. try rephrasing?",
                    );
                  } catch (sendErr) {
                    console.error(JSON.stringify({
                      level: "error",
                      event: "safety_block_reply_failed",
                      source: "mac-bridge-pairing",
                      error: sendErr?.message ?? String(sendErr),
                    }));
                  }
                  // Agent never sees the text. Pairing audit row preserved.
                } else {
                  runStudentInboundWorkflow({
                    pool: store.pool,
                    messageId,
                    smsProvider: macBridgeProvider,
                    config,
                  }).catch((err) => {
                    console.error(
                      JSON.stringify({
                        level: "error",
                        message: "student_inbound_workflow_failed",
                        source: "mac-bridge-pairing",
                        messageId,
                        error: err?.message ?? String(err),
                      }),
                    );
                  });
                }
              }
            } catch (err) {
              console.error(
                JSON.stringify({
                  level: "error",
                  message: "write_inbound_message_failed",
                  source: "mac-bridge-pairing",
                  error: err?.message ?? String(err),
                }),
              );
            }
          }

          sendJson(res, 200, { ok: true, eventType: "pairing_started", studentId: claim.studentId });
          return;
        }

        // Code matched the START-XXXXXX format but the claim failed
        // (expired, already used, or phone already tied to this LinkedIn
        // profile). Record the attempt for ops review but don't fire any
        // workflow.
        const rejectedEventType =
          claim.reason === "phone_already_bound" || claim.reason === "linkedin_profile_required_for_pairing"
            ? "pairing_rejected"
            : "pairing_expired";
        await store.writeMessagingEvent({
          provider: "mac-bridge",
          providerEventId: inbound.providerEventId,
          studentId: null,
          direction: "inbound",
          channelType: inbound.channelType,
          channelAddress: inbound.channelAddress,
          eventType: rejectedEventType,
          deliveryStatus: "received",
          metadata: { ...inbound.metadata, pairingCode: startCode, reason: claim.reason },
        });
        sendJson(res, 200, { ok: false, eventType: rejectedEventType, reason: claim.reason });
        return;
      }

      const confirmation = inbound.code
        ? await store.confirmPairingCode({ ...inbound, provider: "mac-bridge" })
        : await store.recordInboundMessage(inbound);

      if (!confirmation.error && confirmation.eventType === "unmatched_inbound" && !confirmation.duplicate) {
        const reply = createUnknownSenderText(config, inbound.text);
        try {
          const sent = await macBridgeProvider.sendSms(inbound.channelAddress, reply);
          await store.writeMessagingEvent({
            provider: "mac-bridge",
            providerEventId: `${inbound.providerEventId}:unknown-reply`,
            studentId: null,
            direction: "outbound",
            channelType: inbound.channelType,
            channelAddress: inbound.channelAddress,
            eventType: "unknown_sender_registration_reply",
            deliveryStatus: sent?.status || "sent",
            metadata: {
              source: "unknown_sender",
              providerMessageId: sent?.providerMessageId || sent?.metadata?.providerMessageId || null,
            },
          });
        } catch (sendErr) {
          console.error(JSON.stringify({
            level: "error",
            event: "unknown_sender_reply_failed",
            source: "mac-bridge",
            error: sendErr?.message ?? String(sendErr),
          }));
        }
      }

      if (confirmation.student && confirmation.welcomeNeeded) {
        const welcome = await macBridgeProvider.sendSms(
          confirmation.student.channelAddress,
          createWelcomeText(confirmation.student),
        );
        await store.markWelcomeSent(confirmation.student.id, welcome.status, welcome.metadata);
      }

      if (
        !confirmation.error &&
        confirmation.eventType === "student_reply" &&
        confirmation.student &&
        typeof store.writeInboundMessage === "function"
      ) {
        try {
          const messageId = await store.writeInboundMessage({
            provider: "mac-bridge",
            providerEventId: inbound.providerEventId,
            channelType: inbound.channelType,
            channelAddress: inbound.channelAddress,
            studentId: confirmation.student.id,
            body: inbound.text,
            metadata: inbound.metadata || {},
          });
          if (messageId && store?.pool) {
            // v1.3 SAFETY-01: Pre-LLM screen on mac-bridge student_reply path.
            // Same hard-block rule (>=0.8) and fail-open semantics as photon.
            const _screenStart = Date.now();
            const screenResult = await screenMessage(
              inbound.text || "",
              process.env.LAKERA_GUARD_API_KEY || "",
            );
            const _screenMs = Date.now() - _screenStart;
            console.log(JSON.stringify({ level: "info", event: "lakera_latency_ms", ms: _screenMs, channel: "sms", source: "mac-bridge" }));
            const injectionScore = screenResult.score ?? 0;
            // Lakera v2 returns a binary flag (no per-category score) — `flagged: true`
            // alone is sufficient to hard-block. The `>= 0.8` clause is the forward-compat
            // shim for if Lakera ever re-introduces a per-category numeric score.
            const isHardBlock = screenResult.flagged === true || injectionScore >= 0.8;

            if (screenResult.action !== "passed") {
              console.log(JSON.stringify({
                level: "info",
                event: "lakera_screen",
                action: screenResult.action,
                reason: screenResult.reason,
                score: screenResult.score,
                channel: "sms",
                hard_block: isHardBlock,
                sender_last4: (inbound.channelAddress || "").slice(-4),
                message_id: messageId,
                source: "mac-bridge",
                preview: (inbound.text || "").slice(0, 80),
              }));

              store.pool.query(
                `insert into safety_events
                   (channel, action, reason, score, sender_last4, preview, reviewed)
                 values ($1, $2, $3, $4, $5, $6, false)`,
                [
                  "sms",
                  isHardBlock ? "blocked" : screenResult.action,
                  screenResult.reason,
                  screenResult.score,
                  (inbound.channelAddress || "").slice(-4),
                  (inbound.text || "").slice(0, 80),
                ],
              ).catch((err) => {
                console.error(JSON.stringify({ level: "error", event: "safety_events_write_failed", error: err?.message ?? String(err) }));
              });
            }

            if (isHardBlock) {
              try {
                await macBridgeProvider.sendSms(
                  inbound.channelAddress,
                  "hey — couldn't process that one. try rephrasing?",
                );
              } catch (sendErr) {
                console.error(JSON.stringify({
                  level: "error",
                  event: "safety_block_reply_failed",
                  source: "mac-bridge",
                  error: sendErr?.message ?? String(sendErr),
                }));
              }
              // Agent never sees the text. Audit row preserved.
            } else {
              runStudentInboundWorkflow({
                pool: store.pool,
                messageId,
                smsProvider: macBridgeProvider,
                config,
              }).catch((err) => {
                console.error(
                  JSON.stringify({
                    level: "error",
                    message: "student_inbound_workflow_failed",
                    source: "mac-bridge",
                    messageId,
                    error: err?.message ?? String(err),
                  }),
                );
              });
            }
          }
        } catch (err) {
          console.error(
            JSON.stringify({
              level: "error",
              message: "write_inbound_message_failed",
              source: "mac-bridge",
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

    // ─── Internal safety-events API (Neon-exit 2026-05-21) ───────────────────
    //
    // The Parrot Worker (apps/parrot) used to read/write the safety_events
    // table directly via @neondatabase/serverless. Once the student DB moved
    // off Neon to a Fly-internal Postgres, a Cloudflare Worker can no longer
    // reach it — so the Worker now calls these endpoints instead. The student
    // app owns safety_events (it also writes the SMS-path rows via
    // store.pool). Bearer-secret auth mirrors the GRAPH_API_SECRET pattern;
    // every handler is fail-soft so the Worker degrades cleanly.
    if (url.pathname === "/internal/safety-events" || url.pathname.startsWith("/internal/safety-events/")) {
      const authHeader = String(req.headers["authorization"] || "");
      const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
      if (!config.internalApiSecret || !safeStringEqual(bearer, config.internalApiSecret)) {
        sendJson(res, 401, { error: "unauthorized" });
        return;
      }
      if (!store?.pool) {
        if (req.method === "GET" && url.pathname.endsWith("/unreviewed-count")) { sendJson(res, 200, { count: 0 }); return; }
        if (req.method === "GET") { sendJson(res, 200, { events: [], total: 0 }); return; }
        sendJson(res, 200, { ok: true, skipped: "no_database" });
        return;
      }

      // POST /internal/safety-events — insert one screening event.
      if (req.method === "POST" && url.pathname === "/internal/safety-events") {
        let body = {};
        try {
          const raw = String((await readBody(req)) || "");
          body = raw ? JSON.parse(raw) : {};
        } catch {
          sendJson(res, 400, { error: "bad_json" });
          return;
        }
        try {
          await store.pool.query(
            `insert into safety_events
               (channel, action, reason, score, sender_last4, preview, employee_id, reviewed)
             values ($1, $2, $3, $4, $5, $6, $7, false)`,
            [
              body.channel ?? "unknown",
              body.action ?? "flagged",
              body.reason ?? null,
              body.score ?? null,
              body.sender_last4 ?? null,
              body.preview ?? null,
              body.employee_id ?? null,
            ],
          );
          sendJson(res, 200, { ok: true });
        } catch (err) {
          console.error(JSON.stringify({ level: "error", event: "safety_events_write_failed", error: err?.message ?? String(err) }));
          sendJson(res, 500, { ok: false, error: "write_failed" });
        }
        return;
      }

      // GET /internal/safety-events — paginated flag log (last 100, 7 days).
      if (req.method === "GET" && url.pathname === "/internal/safety-events") {
        try {
          const { rows } = await store.pool.query(
            `select id, channel, action, reason, score, sender_last4, preview,
                    employee_id, reviewed, reviewed_at, created_at
               from safety_events
              where created_at > now() - interval '7 days'
              order by created_at desc
              limit 100`,
          );
          sendJson(res, 200, { events: rows, total: rows.length });
        } catch (err) {
          console.error(JSON.stringify({ level: "error", event: "ops_safety_query_failed", error: err?.message ?? String(err) }));
          sendJson(res, 200, { events: [], total: 0, error: "query_failed" });
        }
        return;
      }

      // GET /internal/safety-events/unreviewed-count — badge count (24h).
      if (req.method === "GET" && url.pathname === "/internal/safety-events/unreviewed-count") {
        try {
          const { rows } = await store.pool.query(
            `select count(*)::int as n
               from safety_events
              where reviewed = false
                and action in ('flagged', 'blocked')
                and created_at > now() - interval '24 hours'`,
          );
          sendJson(res, 200, { count: rows[0]?.n ?? 0 });
        } catch (err) {
          console.error(JSON.stringify({ level: "error", event: "ops_safety_unreviewed_count_failed", error: err?.message ?? String(err) }));
          sendJson(res, 200, { count: 0 });
        }
        return;
      }

      // POST /internal/safety-events/mark-reviewed — mark event(s) reviewed.
      if (req.method === "POST" && url.pathname === "/internal/safety-events/mark-reviewed") {
        let body = {};
        try {
          const raw = String((await readBody(req)) || "");
          body = raw ? JSON.parse(raw) : {};
        } catch {
          sendJson(res, 400, { error: "bad_json" });
          return;
        }
        const ids = Array.isArray(body.ids) ? body.ids : null;
        const reviewedBy = typeof body.reviewed_by === "string" && body.reviewed_by ? body.reviewed_by : "operator";
        try {
          if (ids && ids.length > 0) {
            await store.pool.query(
              `update safety_events
                  set reviewed = true, reviewed_at = now(), reviewed_by = $2
                where id = any($1::uuid[])`,
              [ids, reviewedBy],
            );
          } else {
            await store.pool.query(
              `update safety_events
                  set reviewed = true, reviewed_at = now(), reviewed_by = $1
                where reviewed = false
                  and created_at > now() - interval '24 hours'`,
              [reviewedBy],
            );
          }
          sendJson(res, 200, { ok: true });
        } catch (err) {
          console.error(JSON.stringify({ level: "error", event: "ops_safety_mark_reviewed_failed", error: err?.message ?? String(err) }));
          sendJson(res, 500, { ok: false, error: "update_failed" });
        }
        return;
      }

      sendJson(res, 404, { error: "not_found" });
      return;
    }

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
        // v1.2 EMAIL-03: optional conversation_id from Worker payload.
        // Validate UUID v4 syntactically; malformed → drop the field
        // silently so the legacy From-address lookup path still runs.
        const rawConvId = payload.conversation_id;
        const conversationId = validateUuidLoose(rawConvId);
        const result = await store.recordEmailInbound({
          from: payload.from,
          to: payload.to,
          subject: payload.subject,
          body: payload.body,
          ts: payload.ts,
          conversationId,
        });
        sendJson(res, 200, {
          ok: true,
          duplicate: result.duplicate,
          eventType: result.eventType,
          conversationId: conversationId || null,
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
        // email is not lost; operator sees it in OPERATOR_FALLBACK
        // (rentalaraj@gmail.com, verified destination in CF Email Routing).
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
      // .catch(logEmbedErr), never inline await. A failing proxy-Worker
      // call must not block the user-visible "role created" redirect.
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

    // ─── Operator audit log (v1.2 — autonomy pivot 2026-05-17) ──────────────
    //
    // All /ops/drafts* and /ops/feedback routes are gated by
    // requireOperatorAuth (middleware-level per PITFALLS #12, never
    // in-handler). The middleware re-reads publicMetadata.userType from the
    // Clerk Backend API on every request — JWT claims are not trusted
    // (PITFALLS #13). In dev mode the signed dev cookie carries userType
    // directly; ENABLE_DEV_AUTH gates that branch.
    //
    // 2026-05-17 PIVOT: these routes USED to be the operator approval gate
    // (approve / edit / reject before send). After the pivot, the agent
    // sends autonomously and /ops/drafts is a READ-ONLY audit log — every
    // sent + failed + flagged draft is visible here; operators can only
    // flag a sent draft post-hoc for prompt-tuning review (POST
    // /ops/drafts/:id/flag). The approve/edit/reject endpoints return 410
    // Gone so external tooling that hit them gets a clear deprecation
    // signal (not a generic 404).

    if (req.method === "GET" && url.pathname === "/ops/drafts") {
      const auth = await requireOperatorAuth(req, res);
      if (!auth) return;
      const type = url.searchParams.get("type") || "";
      const page = Math.max(0, Number.parseInt(url.searchParams.get("page") || "0", 10) || 0);
      const offset = page * 50;
      const drafts = await store.listAllDrafts({ type, limit: 50, offset });
      let banner = "";
      if (url.searchParams.get("flagged") === "1") {
        banner = '<div class="ops-banner ops-banner-warn">Message flagged for prompt-tuning review. See <a href="/ops/feedback">flagged log</a>.</div>';
      }
      sendHtml(
        res,
        200,
        renderLayout({
          title: "Message Log",
          config,
          auth,
          body: renderMessageLog({ drafts, filter: type, page, banner }),
        }),
      );
      return;
    }

    // GET /ops/drafts/:id — read-only detail view with flag-for-review
    if (req.method === "GET" && /^\/ops\/drafts\/[^/]+$/.test(url.pathname)) {
      const auth = await requireOperatorAuth(req, res);
      if (!auth) return;
      const draftId = url.pathname.split("/")[3];
      const draft = await store.getDraftById(draftId);
      if (!draft) {
        sendJson(res, 404, { error: "not_found" });
        return;
      }
      const priorMessages = await store.getPriorMessages(draft.conversation_id, 10);
      const flaggedBanner = url.searchParams.get("flagged") === "1"
        ? '<div class="ops-banner ops-banner-warn">Flagged for prompt-tuning review.</div>'
        : "";
      sendHtml(
        res,
        200,
        renderLayout({
          title: "Message Detail",
          config,
          auth,
          body: renderDraftDetail({ draft, priorMessages, errorBanner: flaggedBanner }),
        }),
      );
      return;
    }

    // POST /ops/drafts/:id/flag — post-hoc flag for prompt-tuning review.
    // Writes a draft_feedback row (feedback_type='flagged'). Does NOT
    // mutate the draft itself — the message is already sent, this is a
    // signal for the human prompt-tuner.
    if (req.method === "POST" && /^\/ops\/drafts\/[^/]+\/flag$/.test(url.pathname)) {
      const auth = await requireOperatorAuth(req, res);
      if (!auth) return;
      const draftId = url.pathname.split("/")[3];
      const form = await readForm(req);
      const reason = String(form.flag_reason || "").trim() || null;
      const draft = await store.getDraftById(draftId);
      if (!draft) {
        sendJson(res, 404, { error: "not_found" });
        return;
      }
      await store.recordDraftFeedback({
        draftId,
        operatorId: auth.clerkUserId,
        feedbackType: "flagged",
        originalBody: draft.body,
        correctedBody: null,
        reason,
      });
      redirect(res, `/ops/drafts/${draftId}?flagged=1`);
      return;
    }

    // POST /ops/drafts/:id/approve — DEPRECATED 2026-05-17. Returns 410 Gone.
    // The autonomous agent flow removed the pre-send approval gate.
    if (req.method === "POST" && /^\/ops\/drafts\/[^/]+\/(approve|edit|reject)$/.test(url.pathname)) {
      sendJson(res, 410, {
        error: "gone",
        reason: "approval_gate_removed_2026_05_17",
        message: "The operator approval gate was removed when the agent went autonomous. Use POST /ops/drafts/:id/flag to flag a sent message for prompt-tuning review.",
      });
      return;
    }

    // GET /ops/feedback — read-only log of flagged drafts (post-pivot:
    // 'flagged' is the canonical type; legacy 'rejected'/'edited' rows from
    // the pre-pivot approval gate stay queryable for historical context).
    if (req.method === "GET" && url.pathname === "/ops/feedback") {
      const auth = await requireOperatorAuth(req, res);
      if (!auth) return;
      const rows = await store.listDraftFeedback({ limit: 100, feedbackType: "flagged" });
      sendHtml(
        res,
        200,
        renderLayout({
          title: "Flagged Messages Log",
          config,
          auth,
          body: renderFeedbackLog({ rows }),
        }),
      );
      return;
    }

    if (req.method === "GET" && url.pathname === "/ops/privacy") {
      const privacyAuth = await getAuth(req, config);
      // AUTH-PROD: handshake sentinel → forward Clerk's headers + 307.
      if (applyHandshakeOrContinue(res, privacyAuth)) return;
      sendHtml(
        res,
        200,
        renderLayout({
          title: "Privacy Operations",
          config,
          auth: privacyAuth,
          body: `<section class="panel narrow"><p class="eyebrow">Operations</p><h1>Privacy controls before production data.</h1><p class="lede">User deletion/export requests should be handled from audit-backed database records. Do not log profile snapshots, message bodies, provider tokens, or raw webhook payloads.</p></section>`,
        }),
      );
      return;
    }

    // ─── Admin read-only endpoints (Phase 06) ────────────────────────────────
    //
    // All /admin/* routes require operator auth (requireOperatorAuth gates
    // the entire block). No mutations live here — read-only DB introspection
    // only. The handler module is apps/app/src/routes/admin.mjs.
    if (req.method === "GET" && url.pathname === "/admin/integ-01-status") {
      const auth = await requireOperatorAuth(req, res);
      if (!auth) return;
      await handleInteg01Status(req, res, { url, pool: store?.pool ?? null });
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

startSpectrumWaitlistListener({ config, store, smsProvider: spectrumProvider });

async function requireAuth(req, res) {
  const auth = await getAuth(req, config);
  // AUTH-PROD: handshake sentinel → SDK headers + 307. Caller bails like
  // for any unauthenticated case (the `return null` path below).
  if (applyHandshakeOrContinue(res, auth)) return null;
  if (auth?.clerkUserId) return auth;

  redirect(res, getSignInUrl(config));
  return null;
}

function hasPairableLinkedIn(auth, student = null) {
  return hasLinkedInProfileUrl(student?.linkedinProfileUrl || auth?.linkedinProfileUrl || "");
}

function sendLinkedInRequired(res, auth) {
  const canCaptureUrl = Boolean(auth?.clerkUserId && auth.userType !== "startup");
  sendHtml(
    res,
    403,
    renderLayout({
      title: "LinkedIn Required",
      config,
      auth,
      body: canCaptureUrl
        ? renderLinkedInUrlCapture({ value: auth.linkedinProfileUrl || "" })
        : renderLinkedInRequired({ signInUrl: getSignInUrl(config) }),
      embedClerk: false,
    }),
  );
}

function createUnknownSenderText(config, inboundText = "") {
  const registrationUrl = new URL("/waitlist", config.appUrl || "https://app.internjobs.ai").toString();
  const text = String(inboundText || "").toLowerCase();
  if (/\b(stop|unsubscribe|remove me|do not text)\b/.test(text)) {
    return "got it - no more from this thread unless you register again.";
  }
  if (/\b(who is this|what is this|wrong number)\b/.test(text)) {
    return `this is InternJobs.ai. students join with LinkedIn, then we text when matching is ready. if that was meant for you: ${registrationUrl}`;
  }
  if (/\b(register|sign up|signup|apply|internship|job|waitlist|link)\b/.test(text)) {
    return `right - start here: ${registrationUrl}. connect LinkedIn first, then this number is the thread we use.`;
  }
  if (/^(hi|hey|hello|yo)\b/.test(text.trim())) {
    return `hey - this is InternJobs.ai. if you're joining the student waitlist, start here: ${registrationUrl}`;
  }
  return `hey - this is InternJobs.ai. register with LinkedIn first so this number can recognize you: ${registrationUrl}`;
}

async function ensureLinkedInProfileForFirstContact(studentId) {
  if (!studentId || !store?.pool) return null;
  const hasBrightData = Boolean(config.brightdata?.apiToken);
  if (!hasBrightData) return null;
  try {
    const existing = typeof store.getLinkedInProfile === "function"
      ? await store.getLinkedInProfile(studentId)
      : null;
    if (hasStructuredLinkedInProfile(existing)) return existing;

    const { rows } = await store.pool.query(
      `select linkedin_profile_url
         from students
        where id = $1
        limit 1`,
      [studentId],
    );
    const student = rows[0] || {};

    let enrichmentSource = "brightdata_linkedin_url";
    let profile = await enrichByBrightDataLinkedInUrl({
      linkedinUrl: student.linkedin_profile_url,
      apiToken: config.brightdata?.apiToken,
      datasetId: config.brightdata?.linkedinProfileDatasetId,
    });
    if (!profile) return existing;
    return store.linkUserLinkedInProfile(studentId, {
      ...profile,
      linkedinUrl: profile.linkedinUrl || student.linkedin_profile_url || "",
      enrichedVia: enrichmentSource,
    });
  } catch (err) {
    console.error(
      JSON.stringify({
        level: "error",
        message: "linkedin_enrichment_failed",
        studentId,
        error: err?.message ?? String(err),
      }),
    );
    return null;
  }
}

function hasStructuredLinkedInProfile(profile) {
  if (!profile) return false;
  return Boolean(
    profile.headline ||
      profile.current_company ||
      profile.current_title ||
      (Array.isArray(profile.schools) && profile.schools.length) ||
      (Array.isArray(profile.experiences) && profile.experiences.length) ||
      (Array.isArray(profile.skills) && profile.skills.length),
  );
}

// v1.2 Phase 05 — thin closure binding the auth.mjs middleware to local
// config + the request. Mirrors requireAuth above. The Clerk Backend API
// call (PITFALLS #13) is owned by requireOperatorAuthImpl.
async function requireOperatorAuth(req, res) {
  return requireOperatorAuthImpl(req, res, config);
}

// Pre-2026-05-17 the operator-approve handlers called outbound.routeAndSend
// here. Post-pivot, the Mastra workflow (student-inbound.mjs) is the call
// site and builds its own deps from server.mjs's exports — see the
// runStudentInboundWorkflow invocation in the /webhooks/photon handler.
// server.mjs intentionally does NOT import sendStartupEmail — that import
// lives in outbound.mjs only.

// Onboarding gate: requires an authenticated session that is NOT a student.
// Used by /startup/onboarding GET/POST where userType='startup' is set after
// the consent form is submitted. Authorization is enforced at this middleware
// layer (PITFALLS #12), not inside handlers.
async function requireStartupAuthOrRedirect(req, res) {
  const auth = await getAuth(req, config);
  // AUTH-PROD: handshake sentinel → SDK headers + 307.
  if (applyHandshakeOrContinue(res, auth)) return null;
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

// v1.2 EMAIL-03: loose UUID v4 syntactic validator. The catch-all Worker
// on `agent.internjobs.ai` parses `conv-{uuid}@agent.internjobs.ai` and
// ships the UUID in the JSON payload; we accept it only if it's
// syntactically a UUID (8-4-4-4-12 hex with hyphens). Malformed → null
// and the legacy From-address lookup runs unchanged. We deliberately
// don't enforce v4 version/variant bits (gen_random_uuid() emits v4
// anyway, but cross-version compat keeps the validator dumb and
// forgiving).
function validateUuidLoose(value) {
  if (!value || typeof value !== "string") return null;
  const trimmed = value.trim().toLowerCase();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(trimmed)
    ? trimmed
    : null;
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

// ─── v1.2 Phase 09 — onboarding helpers ─────────────────────────────────────

// Build the sms:// URI scanned via QR (desktop) or tapped via deep-link
// (mobile). iOS quirk: the canonical separator between recipient and query
// params is `&` (the historical Apple shape) rather than `?` for an sms
// URI — both work on modern iOS, but `&` is the safer choice across iOS
// versions and Android. We URL-encode the recipient + body so unusual
// numbers (+, dashes) and the code stay intact through the iOS scheme
// handler.
function buildSmsUri(agentNumber, code) {
  const recipient = encodeURIComponent(String(agentNumber || ""));
  const body = encodeURIComponent(String(code || ""));
  return `sms:${recipient}&body=${body}`;
}

// Crude UA-based mobile detection. We only need to distinguish "phone in
// the user's hand" from "desktop browser". A false negative (desktop
// flagged mobile) still works — the deep-link button just doesn't open
// Messages, the student copies the code instead. A false positive on
// mobile means we show a QR they can't scan from the same device — the
// fallback copy still works. Cheap heuristic, fine for v1.2.
function detectMobile(req) {
  const ua = String(req.headers["user-agent"] || "");
  return /iPhone|iPod|Android.+Mobile/i.test(ua);
}

const PAIRING_COOKIE = "ij_pair";

function setPairingCodeCookie(res, code, ttlHours) {
  const maxAge = Math.max(1, Number(ttlHours) || 24) * 3600;
  const attrs = [
    `${PAIRING_COOKIE}=${encodeURIComponent(code)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAge}`,
  ];
  if (config.isProduction) attrs.push("Secure");
  res.appendHeader
    ? res.appendHeader("Set-Cookie", attrs.join("; "))
    : res.setHeader("Set-Cookie", attrs.join("; "));
}

function getPairingCodeCookie(req) {
  const raw = String(req.headers.cookie || "");
  const m = raw.match(new RegExp(`(?:^|;\\s*)${PAIRING_COOKIE}=([^;]+)`));
  return m ? decodeURIComponent(m[1]) : "";
}

function clearPairingCodeCookie(res) {
  const attrs = [
    `${PAIRING_COOKIE}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
  ];
  if (config.isProduction) attrs.push("Secure");
  res.appendHeader
    ? res.appendHeader("Set-Cookie", attrs.join("; "))
    : res.setHeader("Set-Cookie", attrs.join("; "));
}
