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
    // cloudflareEmailAccountId / cloudflareEmailApiToken: outbound
    //   transactional sending via Cloudflare Email Service (public beta
    //   2026-04-17, the "Agent Mail" product). The token is Account-scoped
    //   with "Email Sending" permission — distinct from any future CF
    //   Workers / DNS-management token. Not exercised until Phase 05
    //   (operator approval gate) actually triggers a send — loaded here so
    //   /healthz can report presence.
    emailWorkerSecret: env.EMAIL_WORKER_SECRET || "",
    cloudflareEmailAccountId: env.CLOUDFLARE_EMAIL_ACCOUNT_ID || "",
    cloudflareEmailApiToken: env.CLOUDFLARE_EMAIL_API_TOKEN || "",
    // v1.2 Phase 05: dry-run guard for outbound send paths. When true,
    // outbound.mjs routes drafts to synthetic provider IDs instead of
    // calling the real SMS/email backends. Used by the smoke suite so
    // tests assert the approve → 'sent' transition without hitting
    // Photon/Cloudflare. NEVER set this in production.
    outboundDryRun: env.OUTBOUND_DRY_RUN === "true",
    // v1.2 (swap 2026-05-16): Cloudflare Workers AI via internjobs-ai-proxy.
    // aiWorker.url    — public Worker URL (https://internjobs-ai-proxy.<acct>.workers.dev)
    // aiWorker.secret — shared bearer in x-ai-worker-secret header; the
    //                   Worker constant-time compares it against its
    //                   wrangler-stored AI_WORKER_SECRET.
    // The Fly app never holds a Cloudflare API token — all AI calls flow
    // through the Worker, which uses its native env.AI binding.
    aiWorker: {
      url: env.AI_WORKER_URL || "",
      secret: env.AI_WORKER_SECRET || "",
    },
    // v1.2 STORAGE-01 (scope-add 2026-05-16): R2 storage scaffold.
    // Cloudflare R2 (S3-compatible) for per-entity artifact tree. Private
    // bucket + signed-URL-only sharing (Mala posture from SuperIntelligence).
    // Fail-soft: callers must check getR2Client() for null on missing envs.
    // Account-ID fallback CF_ACCOUNT_ID matches SuperIntelligence convention
    // for repos that already have a CF Account ID env in the shell.
    r2: {
      accountId: env.R2_ACCOUNT_ID || env.CF_ACCOUNT_ID || "",
      accessKeyId: env.R2_ACCESS_KEY_ID || "",
      secretAccessKey: env.R2_SECRET_ACCESS_KEY || "",
      bucket: env.R2_BUCKET || "internjobs-agent-store",
    },
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
  if (!config.cloudflareEmailAccountId) warnings.push("CLOUDFLARE_EMAIL_ACCOUNT_ID (warn — required for outbound email in Phase 05)");
  if (!config.cloudflareEmailApiToken) warnings.push("CLOUDFLARE_EMAIL_API_TOKEN (warn — required for outbound email in Phase 05)");

  // v1.2 swap 2026-05-16: Workers AI proxy. Warning, not hard block — the
  // workflow falls back to canned-stub when both are missing so dev/test
  // boots still work. Treat as a paired warning (either both or neither).
  const ai = config.aiWorker || {};
  const aiSet = [ai.url, ai.secret].filter(Boolean).length;
  if (aiSet === 1) {
    warnings.push("AI_WORKER_* (warn — partial Workers AI proxy config: set AI_WORKER_URL + AI_WORKER_SECRET together, or neither)");
  } else if (aiSet === 0) {
    warnings.push("AI_WORKER_URL + AI_WORKER_SECRET (warn — agent workflow runs in canned-stub mode until both set)");
  }

  // STORAGE-01: R2 envs are entirely optional in v1.2 (no ingestion is
  // wired). Warn ONLY when the operator partially set them (so a missing
  // SECRET_ACCESS_KEY next to a present ACCESS_KEY_ID is loud), not when
  // all four are unset.
  const r2 = config.r2 || {};
  const r2Set = [r2.accountId, r2.accessKeyId, r2.secretAccessKey].filter(Boolean).length;
  if (r2Set > 0 && r2Set < 3) {
    warnings.push("R2_* (warn — partial R2 config: set R2_ACCOUNT_ID + R2_ACCESS_KEY_ID + R2_SECRET_ACCESS_KEY together, or none)");
  }

  // Back-compat: callers (e.g. /config/status route) currently expect an
  // array. Append warnings with the "(warn — …)" prefix so they're visible
  // but distinguishable from hard misses. The return type stays string[].
  return [...missing, ...warnings];
}
