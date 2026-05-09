import { createServer } from "node:http";

const port = Number(process.env.PORT || 3000);

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

function sendHtml(res, status, body) {
  res.writeHead(status, {
    "content-type": "text/html; charset=utf-8",
    "content-length": Buffer.byteLength(body),
  });
  res.end(body);
}

const server = createServer((req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

  if (url.pathname === "/healthz") {
    sendJson(res, 200, {
      ok: true,
      service: "internjobs-app",
    });
    return;
  }

  if (url.pathname === "/") {
    sendHtml(
      res,
      200,
      `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>InternJobs.ai App</title>
    <style>
      :root {
        color-scheme: light;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background: #f7f7f5;
        color: #111111;
      }
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
      }
      main {
        width: min(720px, calc(100vw - 48px));
      }
      p {
        color: #5f625d;
        font-size: 18px;
        line-height: 1.6;
      }
    </style>
  </head>
  <body>
    <main>
      <p>app.internjobs.ai</p>
      <h1>InternJobs.ai app shell</h1>
      <p>This Fly.io app will host LinkedIn-only student signup, waitlist onboarding, QR/channel pairing, and the authenticated product flows.</p>
    </main>
  </body>
</html>`,
    );
    return;
  }

  sendJson(res, 404, {
    error: "not_found",
  });
});

server.listen(port, "0.0.0.0", () => {
  console.log(`InternJobs.ai app listening on ${port}`);
});
