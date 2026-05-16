export function startSpectrumWaitlistListener({ config, store, smsProvider }) {
  if (!config.enableSpectrumListener) return null;
  if (!smsProvider || typeof smsProvider.listen !== "function") return null;

  const runner = smsProvider.listen({ store }).catch((error) => {
    console.error(JSON.stringify({ level: "error", message: "spectrum_listener_failed", error: error.message }));
  });

  return runner;
}
