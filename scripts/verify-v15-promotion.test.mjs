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

// ---------------------------------------------------------------- plan 37-02
const REQ = [
  "submission gate (rrr)",
  "workspaces (marketing · app · employers)",
  "workspace worker (parrot)",
  "startups worker (typecheck · tests)",
];
const EXTRA = ["email timeout invariant (cross-package)", "email worker (tests)"];
const tmpd = (p) => mkdtempSync(path.join(os.tmpdir(), p));
const wj = (dir, name, obj) => { const f = path.join(dir, name); writeFileSync(f, JSON.stringify(obj)); return f; };
const out = (r) => r.stdout + r.stderr;

// --- Task 0: --gate-prev
function phaseDir({ summary = true, verification = "passed" } = {}) {
  const d = tmpd("v15gate-");
  if (summary) writeFileSync(path.join(d, "37-01-SUMMARY.md"), "# s\n");
  if (verification !== null) writeFileSync(path.join(d, "37-01-VERIFICATION.md"), `---\nstatus: ${verification}\n---\n`);
  return d;
}
const gate = (d, plan = "37-01") =>
  spawnSync("node", [SCRIPT, "--gate-prev", plan, "--phase-dir", d], { encoding: "utf8" });

test("g1 NEG gate: no SUMMARY -> exit 1", () => {
  assert.equal(gate(phaseDir({ summary: false })).status, 1);
});
test("g2 NEG gate: no VERIFICATION -> exit 1", () => {
  assert.equal(gate(phaseDir({ verification: null })).status, 1);
});
test("g3 NEG gate: status gaps_found -> exit 1", () => {
  const r = gate(phaseDir({ verification: "gaps_found" }));
  assert.equal(r.status, 1);
  assert.match(out(r), /gaps_found/);
});
test("g4 gate: both present, status passed -> exit 0", () => {
  assert.equal(gate(phaseDir()).status, 0);
});

// --- Task 1: --preflight-checks
const protection = (ctxs) => ({ required_status_checks: { strict: true, contexts: ctxs, checks: ctxs.map((c) => ({ context: c })) } });
function pf(prot, jobs, rulesets, script = SCRIPT) {
  const d = tmpd("v15pf-");
  const args = [script, "--preflight-checks", "--protection-json", wj(d, "p.json", prot), "--ci-ref-json", wj(d, "c.json", jobs)];
  if (rulesets) args.push("--rulesets-json", wj(d, "r.json", rulesets));
  return spawnSync("node", args, { encoding: "utf8" });
}

test("p1 preflight positive: exact 4 -> exit 0", () => {
  assert.equal(pf(protection(REQ), REQ).status, 0);
});
test("p2 preflight positive: 4 required + 2 extra ref jobs -> exit 0", () => {
  assert.equal(pf(protection(REQ), [...REQ, ...EXTRA]).status, 0);
});
test("p3 NEG protection context removed -> exit 1", () => {
  assert.equal(pf(protection(REQ.slice(1)), [...REQ, ...EXTRA]).status, 1);
});
test("p4 NEG protection context renamed -> exit 1", () => {
  assert.equal(pf(protection([...REQ.slice(1), "renamed"]), REQ).status, 1);
});
test("p5 NEG protection has an extra context beyond the constant -> exit 1 (equality)", () => {
  assert.equal(pf(protection([...REQ, EXTRA[0]]), [...REQ, ...EXTRA]).status, 1);
});
test("p6 NEG required job missing/renamed on ref -> exit 1", () => {
  assert.equal(pf(protection(REQ), [...REQ.slice(1), "renamed job", ...EXTRA]).status, 1);
});
test("p7 NEG mutated REQUIRED_CHECKS constant -> exit 1", () => {
  const d = tmpd("v15mut-");
  const copy = path.join(d, "mut.mjs");
  const src = readFileSync(SCRIPT, "utf8").replace('"submission gate (rrr)",', '"submission gate (MUTATED)",');
  assert.notEqual(src, readFileSync(SCRIPT, "utf8"), "mutation must apply");
  writeFileSync(copy, src);
  assert.equal(pf(protection(REQ), REQ, null, copy).status, 1);
});
const rs = (ctxs) => [{ name: "integration branches", rules: [{ type: "required_status_checks", parameters: { required_status_checks: ctxs.map((c) => ({ context: c })) } }] }];
test("p8 extra-jobs report: ruleset requiring an extra job -> blocking: yes; none -> blocking: no; both exit 0", () => {
  const yes = pf(protection(REQ), [...REQ, ...EXTRA], rs([...REQ, EXTRA[1]]));
  assert.equal(yes.status, 0, out(yes));
  assert.match(yes.stdout, /INFO extra ref jobs \(not required\):.*email worker \(tests\)/);
  assert.match(yes.stdout, /INFO blocking: yes.*email worker \(tests\)|email worker \(tests\).*INFO blocking: yes|INFO blocking: yes/);
  assert.match(yes.stdout, /email worker \(tests\)[^\n]*blocking: yes/);
  assert.match(yes.stdout, /email timeout invariant \(cross-package\)[^\n]*blocking: no/);
  const no = pf(protection(REQ), [...REQ, ...EXTRA], rs(REQ));
  assert.equal(no.status, 0, out(no));
  assert.doesNotMatch(no.stdout, /blocking: yes/);
  assert.match(no.stdout, /blocking: no/);
});

// --- Task 1: --post
const MAIN_FILES = ["32", "33", "36"];
/** mode: promoted (merge commit) | untouched | squash | partial (main == tip, tip lacks 33) */
function postFx({ mode = "promoted", markers = MAIN_FILES, context = STATUS_OK() } = {}) {
  const dir = tmpd("v15post-");
  git(dir, "init", "-q", "-b", "main");
  writeFileSync(path.join(dir, "README"), "x");
  git(dir, "add", "README");
  git(dir, "commit", "-qm", "init");
  git(dir, "update-ref", "refs/remotes/origin/main", "HEAD");
  git(dir, "checkout", "-q", "-b", "integration/v1.5");
  mkdirSync(path.join(dir, SUB_DIR), { recursive: true });
  for (const p of markers) writeFileSync(path.join(dir, SUB_DIR, `${p}.json`), marker(p));
  git(dir, "add", "-A");
  git(dir, "commit", "-qm", "markers", "--allow-empty");
  git(dir, "update-ref", "refs/remotes/origin/integration/v1.5", "HEAD");
  if (mode === "promoted") {
    git(dir, "checkout", "-q", "main");
    git(dir, "merge", "-q", "--no-ff", "-m", "promote", "integration/v1.5");
    git(dir, "update-ref", "refs/remotes/origin/main", "HEAD");
  } else if (mode === "partial") {
    git(dir, "update-ref", "refs/remotes/origin/main", "HEAD");
  } else if (mode === "squash") {
    git(dir, "checkout", "-q", "main");
    git(dir, "checkout", "integration/v1.5", "--", ".");
    git(dir, "commit", "-qm", "squash promote");
    git(dir, "update-ref", "refs/remotes/origin/main", "HEAD");
  }
  const ctx = path.join(dir, "CONTEXT.md");
  writeFileSync(ctx, context);
  return { dir, ctx };
}
const post = (fx, extra = []) =>
  spawnSync("node", [SCRIPT, "--post", "--repo", fx.dir, "--context", fx.ctx, ...extra], { encoding: "utf8" });

test("t1 post GREEN: merge-commit promotion -> exit 0", () => {
  const r = post(postFx());
  assert.equal(r.status, 0, out(r));
});
test("t2 NEG post: not ancestor (main untouched) -> exit 1", () => {
  const r = post(postFx({ mode: "untouched" }));
  assert.equal(r.status, 1);
  assert.match(out(r), /not an ancestor/);
});
test("t3 NEG post: squash-merged (same tree, tip not ancestor) -> exit 1", () => {
  const r = post(postFx({ mode: "squash" }));
  assert.equal(r.status, 1);
  assert.match(out(r), /not an ancestor/);
});
test("t4 NEG post: ancestor but marker 33 missing on main -> exit 1", () => {
  const r = post(postFx({ mode: "partial", markers: ["32", "36"] }));
  assert.equal(r.status, 1);
  assert.match(out(r), /marker.*33.*main|33.*main/i);
});
test("t4b post: marker 34 required on main only when CONTEXT status is done", () => {
  assert.equal(post(postFx()).status, 0); // 34 deferred, no marker: fine
  assert.equal(post(postFx({ context: STATUS_OK("done", "deferred") })).status, 1);
  assert.equal(post(postFx({ markers: ["32", "33", "34", "36"], context: STATUS_OK("done", "deferred") })).status, 0);
});

const chk = (name, conclusion = "SUCCESS") => ({ __typename: "CheckRun", name, status: "COMPLETED", conclusion });
const prJson = (over = {}) => ({
  number: 99, state: "MERGED", mergedAt: "2026-10-08T00:00:00Z", baseRefName: "main", headRefName: "integration/v1.5",
  statusCheckRollup: REQ.map((n) => chk(n)),
  ...over,
});
function postPr(obj, fx = postFx()) {
  return post(fx, ["--pr-json", wj(tmpd("v15pr-"), "pr.json", obj)]);
}
test("t5a post --pr positive: 4 SUCCESS merged -> exit 0", () => {
  const r = postPr(prJson());
  assert.equal(r.status, 0, out(r));
});
test("t5b NEG PR: one required check FAILURE -> exit 1", () => {
  const roll = REQ.map((n, i) => chk(n, i === 2 ? "FAILURE" : "SUCCESS"));
  assert.equal(postPr(prJson({ statusCheckRollup: roll })).status, 1);
});
test("t5c NEG PR: one required check absent -> exit 1", () => {
  assert.equal(postPr(prJson({ statusCheckRollup: REQ.slice(1).map((n) => chk(n)) })).status, 1);
});
test("t5d NEG PR: base != main -> exit 1", () => {
  assert.equal(postPr(prJson({ baseRefName: "develop" })).status, 1);
});
test("t5e NEG PR: head != integration/v1.5 -> exit 1", () => {
  assert.equal(postPr(prJson({ headRefName: "feature/x" })).status, 1);
});
test("t5f NEG PR: not merged -> exit 1", () => {
  assert.equal(postPr(prJson({ state: "OPEN", mergedAt: null })).status, 1);
});
test("t5g NEG PR: all green merged JSON but squash fixture (tip not ancestor) -> exit 1", () => {
  assert.equal(postPr(prJson(), postFx({ mode: "squash" })).status, 1);
});
test("t9 post --pr: extra email check FAILURE or absent reported, exit 0", () => {
  const fail = postPr(prJson({ statusCheckRollup: [...REQ.map((n) => chk(n)), chk(EXTRA[0], "FAILURE")] }));
  assert.equal(fail.status, 0, out(fail));
  assert.match(fail.stdout, /INFO extra check email timeout invariant \(cross-package\): FAILURE/);
  assert.match(fail.stdout, /INFO extra check email worker \(tests\): absent/);
});
