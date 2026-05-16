export function getConfig(env = process.env) {
  const isProduction = env.NODE_ENV === "production";

  return {
    port: Number(env.PORT || 3000),
    host: env.HOST || "0.0.0.0",
    appUrl: env.APP_URL || env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
    isProduction,
    appSessionSecret: env.APP_SESSION_SECRET || (isProduction ? "" : "internjobs-local-dev-secret"),
    enableDevAuth: env.ENABLE_DEV_AUTH === "true" || (!isProduction && env.ENABLE_DEV_AUTH !== "false"),
    enableSpectrumListener: env.ENABLE_SPECTRUM_LISTENER === "true",
    clerk: {
      publishableKey: env.CLERK_PUBLISHABLE_KEY || env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY || "",
      secretKey: env.CLERK_SECRET_KEY || "",
      backendApiUrl: env.CLERK_BACKEND_API_URL || "https://api.clerk.com",
      signInUrl: env.CLERK_SIGN_IN_URL || env.NEXT_PUBLIC_CLERK_SIGN_IN_URL || "",
      signUpUrl: env.CLERK_SIGN_UP_URL || env.NEXT_PUBLIC_CLERK_SIGN_UP_URL || "",
      jwksUrl: env.CLERK_JWKS_URL || env.NEON_AUTH_JWKS_URL || "",
    },
    databaseUrl: env.DATABASE_URL || "",
    photon: {
      projectId: env.PHOTON_PROJECT_ID || env.SPECTRUM_PROJECT_ID || env.PROJECT_ID || "",
      apiBaseUrl: env.PHOTON_API_BASE_URL || env.SPECTRUM_API_BASE_URL || "",
      apiToken: env.PHOTON_API_TOKEN || env.SPECTRUM_API_TOKEN || env.PROJECT_SECRET || "",
      fromNumber: env.PHOTON_FROM_NUMBER || env.SPECTRUM_FROM_NUMBER || "",
      webhookSecret: env.PHOTON_WEBHOOK_SECRET || env.SPECTRUM_WEBHOOK_SECRET || "",
    },
    // v1.2 Phase 03 — startup email channel.
    // emailWorkerSecret: shared HMAC secret with the CF Email Worker
    //   (apps/email-worker). The Worker signs the JSON payload with this
    //   secret and includes it in `x-email-worker-secret`; the Fly app
    //   verifies via crypto.timingSafeEqual.
    // resendApiKey: outbound transactional sending via Resend. Not exercised
    //   until Phase 05 (operator approval gate) actually triggers a send —
    //   loaded here so /healthz can report presence.
    emailWorkerSecret: env.EMAIL_WORKER_SECRET || "",
    resendApiKey: env.RESEND_API_KEY || "",
    // v1.2 Phase 05: dry-run guard for outbound send paths. When true,
    // outbound.mjs routes drafts to synthetic provider IDs instead of
    // calling the real SMS/email backends. Used by the smoke suite so
    // tests assert the approve → 'sent' transition without hitting
    // Photon/Resend. NEVER set this in production.
    outboundDryRun: env.OUTBOUND_DRY_RUN === "true",
  };
}

export function getMissingProviderConfig(config) {
  const missing = [];
  const warnings = [];

  if (!config.clerk.publishableKey && !config.clerk.signInUrl) missing.push("CLERK_PUBLISHABLE_KEY or CLERK_SIGN_IN_URL");
  if (!config.databaseUrl) missing.push("DATABASE_URL");
  if (!config.photon.fromNumber) missing.push("PHOTON_FROM_NUMBER");
  if (!config.photon.webhookSecret) missing.push("PHOTON_WEBHOOK_SECRET or SPECTRUM_WEBHOOK_SECRET");

  // Phase 03 keys: warnings (not hard blocks) — they become hard blocks in
  // Phase 05 when sends are required and inbound is required end-to-end.
  if (!config.emailWorkerSecret) warnings.push("EMAIL_WORKER_SECRET (warn — required for inbound email in Phase 05)");
  if (!config.resendApiKey) warnings.push("RESEND_API_KEY (warn — required for outbound email in Phase 05)");

  // Back-compat: callers (e.g. /config/status route) currently expect an
  // array. Append warnings with the "(warn — …)" prefix so they're visible
  // but distinguishable from hard misses. The return type stays string[].
  return [...missing, ...warnings];
}
