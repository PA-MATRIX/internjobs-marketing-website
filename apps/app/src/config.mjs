export function getConfig(env = process.env) {
  const isProduction = env.NODE_ENV === "production";

  return {
    port: Number(env.PORT || 3000),
    host: env.HOST || "0.0.0.0",
    appUrl: env.APP_URL || env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
    isProduction,
    appSessionSecret: env.APP_SESSION_SECRET || (isProduction ? "" : "internjobs-local-dev-secret"),
    enableDevAuth: env.ENABLE_DEV_AUTH === "true" || (!isProduction && env.ENABLE_DEV_AUTH !== "false"),
    clerk: {
      publishableKey: env.CLERK_PUBLISHABLE_KEY || env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY || "",
      secretKey: env.CLERK_SECRET_KEY || "",
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
  };
}

export function getMissingProviderConfig(config) {
  const missing = [];

  if (!config.clerk.publishableKey && !config.clerk.signInUrl) missing.push("CLERK_PUBLISHABLE_KEY or CLERK_SIGN_IN_URL");
  if (!config.databaseUrl) missing.push("DATABASE_URL");
  if (!config.photon.fromNumber) missing.push("PHOTON_FROM_NUMBER");
  if (!config.photon.webhookSecret) missing.push("PHOTON_WEBHOOK_SECRET or SPECTRUM_WEBHOOK_SECRET");

  return missing;
}
