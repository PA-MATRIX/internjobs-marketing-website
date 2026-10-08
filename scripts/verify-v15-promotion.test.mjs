import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(here, "verify-v15-promotion.mjs");
const REAL_CI = path.join(here, "..", ".github", "workflows", "ci.yml");
const SUB_DIR = ".planning/workstreams/team-workspace/submissions";

const git = (cwd, ...a) =>
  execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...a], { cwd, encoding: "utf8" }).trim();

function marker(phase, over = {}) {
  return JSON.stringify({
    milestone: "v1.5",
    phase: String(phase),
    ready_for_integration: true,
    phases_completed: [String(phase)],
    ...over,
  });
}

const STATUS_OK = (w34 = "deferred", w35 = "deferred") =>
  `# ctx\n\n## v1.5 Phase 34/35 status (MERGE-01)\n\n- Phase 34: ${w34} \u2014 confirmed by Raj on 2026-10-08: no marker\n- Phase 35: ${w35} \u2014 confirmed by Raj on 2026-10-08: no marker\n`;
const AUDIT = (result = "passed", gaps = "[]") =>
  `---\nresult: ${result}\naccepted_gaps: ${gaps}\naudited_ref: abc\n---\nbody\n`;

/** Build a fixture repo with branch integration/v1.5 (as a local ref named origin/integration/v1.5 too). */
function fixture({ markers = [32, 33, 36], markerOverrides = {}, worktreeOnly = [], context = STATUS_OK(), audit = AUDIT(), ci = REAL_CI } = {}) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "v15fx-"));
  git(dir, "init", "-q", "-b", "main");
  writeFileSync(path.join(dir, "README"), "x");
  git(dir, "add", "README");
  git(dir, "commit", "-qm", "init");
  git(dir, "checkout", "-q", "-b", "integration/v1.5");
  mkdirSync(path.join(dir, SUB_DIR), { recursive: true });
  for (const p of markers) writeFileSync(path.join(dir, SUB_DIR, `${p}.json`), marker(p, markerOverrides[p]));
  git(dir, "add", "-A");
  git(dir, "commit", "-qm", "markers", "--allow-empty");
  git(dir, "update-ref", "refs/remotes/origin/integration/v1.5", "HEAD");
  for (const p of worktreeOnly) writeFileSync(path.join(dir, SUB_DIR, `${p}.json`), marker(p));
  const ctx = path.join(dir, "CONTEXT.md");
  const aud = path.join(dir, "AUDIT.md");
  if (context !== null) writeFileSync(ctx, context);
  if (audit !== null) writeFileSync(aud, audit);
  return { dir, ctx, aud, ci };
}

function run(fx, extra = []) {
  return spawnSync(
    "node",
    [SCRIPT, "--pre", "--repo", fx.dir, "--context", fx.ctx, "--audit", fx.aud, "--ci", fx.ci, ...extra],
    { encoding: "utf8" },
  );
}

test("1 markers present on ref + status + audit -> exit 0", () => {
  const r = run(fixture());
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test("2 NEG marker missing on ref -> exit 1 naming 36", () => {
  const r = run(fixture({ markers: [32, 33] }));
  assert.equal(r.status, 1);
  assert.match(r.stdout + r.stderr, /36/);
});

test("3 NEG marker only in worktree -> exit 1 (marker only in worktree)", () => {
  const r = run(fixture({ markers: [32, 33], worktreeOnly: [36] }));
  assert.equal(r.status, 1);
});

test("4 NEG ready false / phase not in phases_completed -> exit 1", () => {
  assert.equal(run(fixture({ markerOverrides: { 36: { ready_for_integration: false } } })).status, 1);
  assert.equal(run(fixture({ markerOverrides: { 33: { phases_completed: ["99"] } } })).status, 1);
});

test("5 status record: deferred/dropped -> exit 0", () => {
  assert.equal(run(fixture({ context: STATUS_OK("deferred", "dropped") })).status, 0);
});

test("6 NEG status missing / bad word / no confirmed-by / done without marker", () => {
  const miss = run(fixture({ context: "# ctx\n" }));
  assert.equal(miss.status, 1);
  assert.match(miss.stdout + miss.stderr, /34/);
  assert.match(miss.stdout + miss.stderr, /35/);
  assert.equal(run(fixture({ context: STATUS_OK("maybe", "deferred") })).status, 1);
  const noConf = STATUS_OK().replace(/confirmed by Raj on 2026-10-08: no marker/, "whatever");
  assert.equal(run(fixture({ context: noConf })).status, 1);
  assert.equal(run(fixture({ context: STATUS_OK("done", "deferred") })).status, 1);
  // done WITH a marker on the ref passes
  assert.equal(run(fixture({ markers: [32, 33, 34, 36], context: STATUS_OK("done", "deferred") })).status, 0);
});

test("7 audit record", () => {
  assert.equal(run(fixture({ audit: null })).status, 1);
  assert.equal(run(fixture({ audit: AUDIT("failed") })).status, 1);
  assert.equal(run(fixture({ audit: AUDIT("gaps_accepted", "[]") })).status, 1);
  assert.equal(run(fixture({ audit: AUDIT("gaps_accepted", '["34/35 deferred (owner Raj)"]') })).status, 0);
  assert.equal(run(fixture({ audit: AUDIT("passed") })).status, 0);
});

test("8 --expect-head mismatch -> exit 1, match -> 0", () => {
  const fx = fixture();
  const tip = git(fx.dir, "rev-parse", "origin/integration/v1.5");
  assert.equal(run(fx, ["--expect-head", tip]).status, 0);
  assert.equal(run(fx, ["--expect-head", "0".repeat(40)]).status, 1);
});

test("9 REQUIRED_CHECKS subset of ci.yml job names", async () => {
  const { REQUIRED_CHECKS, parseJobNames } = await import("./verify-v15-promotion.mjs");
  assert.equal(REQUIRED_CHECKS.length, 4);
  const real = readFileSync(REAL_CI, "utf8");
  const names = parseJobNames(real);
  for (const c of REQUIRED_CHECKS) assert.ok(names.includes(c), `ci.yml lacks job ${c}`);
  const tmp = mkdtempSync(path.join(os.tmpdir(), "v15ci-"));
  // NEG: rename a required job
  const renamed = path.join(tmp, "renamed.yml");
  writeFileSync(renamed, real.replace(`name: ${REQUIRED_CHECKS[0]}`, "name: renamed job"));
  assert.equal(run(fixture({ ci: renamed })).status, 1);
  // POSITIVE: extra jobs allowed
  const extra = path.join(tmp, "extra.yml");
  writeFileSync(extra, real + "\n  email-a:\n    name: email a\n    runs-on: x\n  email-b:\n    name: email b\n    runs-on: x\n");
  assert.equal(run(fixture({ ci: extra })).status, 0);
});
