import { createServer } from "node:http";
import { loadConfig } from "./config.mjs";
import { verifyBody } from "./security.mjs";
import { startListener } from "./listener.mjs";

const config = loadConfig();

function log(level, message, fields = {}) {
  process.stdout.write(JSON.stringify({ level, message, ...fields, ts: new Date().toISOString() }) + "\n");
}

const listener = await startListener({ config, log });

const server = createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, ts: new Date().toISOString() }));
      return;
    }

    if (req.method === "POST" && req.url === "/v1/send") {
      const raw = await readBody(req);
      if (!verifyBody(config.hmacSecret, raw, req.headers["x-bridge-signature"])) {
        res.writeHead(401, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: "invalid_signature" }));
        return;
      }
      let parsed;
      try { parsed = JSON.parse(raw); } catch {
        res.writeHead(400); res.end('{"ok":false,"error":"bad_json"}'); return;
      }
      const to = String(parsed.to || "").trim();
      const text = String(parsed.text || "");
      if (!to || !text) {
        res.writeHead(400); res.end('{"ok":false,"error":"to_and_text_required"}'); return;
      }
      try {
        const result = await listener.send({ to, text });
        log("info", "send_ok", { to, route: result.route, id: result.id });
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, id: result.id, route: result.route }));
      } catch (err) {
        log("error", "send_failed", { to, error: err?.message || String(err) });
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: "send_failed" }));
      }
      return;
    }

    res.writeHead(404); res.end('{"ok":false,"error":"not_found"}');
  } catch (err) {
    log("error", "request_handler_crashed", { error: err?.message || String(err) });
    if (!res.headersSent) {
      res.writeHead(500); res.end('{"ok":false,"error":"internal"}');
    }
  }
});

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

server.listen(config.port, config.host, () => {
  log("info", "bridge_listening", { host: config.host, port: config.port });
});

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    log("info", "bridge_shutting_down", { signal: sig });
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 5000).unref();
  });
}
