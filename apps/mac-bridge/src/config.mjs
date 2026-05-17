function required(name) {
  const v = process.env[name];
  if (!v || !v.trim()) throw new Error(`missing env: ${name}`);
  return v.trim();
}

function optional(name, fallback = "") {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : fallback;
}

export function loadConfig() {
  return {
    port: Number(optional("BRIDGE_PORT", "8787")),
    host: optional("BRIDGE_HOST", "127.0.0.1"),
    hmacSecret: required("BRIDGE_HMAC_SECRET"),
    outboundWebhookUrl: required("BRIDGE_OUTBOUND_WEBHOOK_URL"),
    logLevel: optional("BRIDGE_LOG_LEVEL", "info"),

    // BlueBubbles is the new local transport (replaces spectrum-ts local
    // mode). Defaults match BlueBubbles' out-of-the-box config: HTTP on
    // 127.0.0.1:1234. The password is set in the BlueBubbles UI on first
    // launch; it's required for any non-trivial deploy.
    bluebubblesUrl: optional("BLUEBUBBLES_URL", "http://127.0.0.1:1234"),
    bluebubblesPassword: required("BLUEBUBBLES_PASSWORD"),
  };
}
