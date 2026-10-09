import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(here, "verify-workspace-quarantine-live.mjs");

const GOOD = 'const a="Trust sender";const b="trust-sender";const c="/inbox?folder=spam";';
const PARROT = 'const t="parrot-token";';

/**
 * routes: { path: {status, headers, body} }. Returns {base, close}.
 */
async function serve(routes) {
  const srv = http.createServer((req, res) => {
    const r = routes[req.url.split("#")[0]];
    if (!r) { res.writeHead(404); res.end("nf"); return; }
    res.writeHead(r.status ?? 200, r.headers ?? {});
    res.end(r.body ?? "");
  });
  await new Promise((ok) => srv.listen(0, "127.0.0.1", ok));
  return { base: `http://127.0.0.1:${srv.address().port}`, close: () => new Promise((ok) => srv.close(ok)) };
}

const html = (manifest = "manifest-abc.js") =>
  `<!DOCTYPE html><html><head><link rel="modulepreload" href="/assets/root-r.js"/></head><body><script>x</script><script type="module" src="/assets/${manifest}"></script></body></html>`;

const manifest = (inboxImports = ["/assets/imp-i.js"]) =>
  "window.__reactRouterManifest=" + JSON.stringify({
    entry: { module: "/assets/entry.js", imports: [] },
    routes: {
      root: { id: "root", module: "/assets/root-r.js", imports: [] },
      "routes/inbox": { id: "routes/inbox", parentId: "root", path: "inbox", module: "/assets/inbox-x.js", imports: inboxImports },
    },
  }) + ";";

const js = (body) => ({ headers: { "content-type": "text/javascript" }, body });

function base({ inbox = "x", imp = GOOD, root = PARROT, extra = {}, idx } = {}) {
  return {
    "/": idx ?? { status: 200, body: html() },
    "/assets/manifest-abc.js": js(manifest()),
    "/assets/root-r.js": js(root),
    "/assets/inbox-x.js": js(inbox),
    "/assets/imp-i.js": js(imp),
    ...extra,
  };
}

// spawnSync would block the event loop that serves the fixtures; use spawn.
import { spawn } from "node:child_process";
async function runAsync(routes, args = []) {
  const s = await serve(routes);
  try {
    return await new Promise((ok) => {
      const p = spawn("node", [SCRIPT, "--base", s.base, ...args]);
      let out = "", err = "";
      p.stdout.on("data", (d) => (out += d));
      p.stderr.on("data", (d) => (err += d));
      p.on("close", (code) => ok({ status: code, stdout: out, stderr: err }));
    });
  } finally { await s.close(); }
}

test("1 NEG: no 'Trust sender' anywhere -> exit 1 naming the marker", async () => {
  const r = await runAsync(base({ imp: 'const b="trust-sender";const c="folder=spam";' }));
  assert.equal(r.status, 1);
  assert.match(r.stdout + r.stderr, /Trust sender/);
});

test("2 POSITIVE: all three markers in an imported chunk -> exit 0", async () => {
  const r = await runAsync(base());
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test("3 NEG: markers only in a chunk unreachable from manifest/inbox -> exit 1", async () => {
  const r = await runAsync(base({ imp: "nothing", extra: { "/assets/orphan.js": js(GOOD) } }));
  assert.equal(r.status, 1);
});

test("4 NEG: markers present but parrot-token absent -> exit 1", async () => {
  const r = await runAsync(base({ root: "nothing" }));
  assert.equal(r.status, 1);
  assert.match(r.stdout + r.stderr, /parrot-token/);
});

test("5a NEG: terminal 500 on index -> exit 1", async () => {
  const r = await runAsync(base({ idx: { status: 500, body: "boom" } }));
  assert.equal(r.status, 1);
});

test("5b NEG: index lacks manifest URL -> exit 1", async () => {
  const r = await runAsync(base({ idx: { status: 200, body: "<html>no manifest</html>" } }));
  assert.equal(r.status, 1);
});

test("5c NEG: manifest 404 -> exit 1", async () => {
  const routes = base();
  delete routes["/assets/manifest-abc.js"];
  const r = await runAsync(routes);
  assert.equal(r.status, 1);
});

test("6 REDIRECT: / -> 302 /sign-in?redirect_url=%2F, script follows and exits 0", async () => {
  const r = await runAsync(base({
    idx: { status: 302, headers: { location: "/sign-in?redirect_url=%2F" } },
    extra: { "/sign-in?redirect_url=%2F": { status: 200, body: html() } },
  }));
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test("6b NEG: redirect loop (>5 hops) -> exit 1", async () => {
  const r = await runAsync(base({ idx: { status: 302, headers: { location: "/" } } }));
  assert.equal(r.status, 1);
});

test("7 --no-require-parrot downgrades the parrot check only", async () => {
  const r = await runAsync(base({ root: "nothing" }), ["--no-require-parrot"]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
});
