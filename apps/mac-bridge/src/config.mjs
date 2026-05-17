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
  };
}
