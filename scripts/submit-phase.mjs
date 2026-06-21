#!/usr/bin/env node
// RRR per-phase submission marker — repo-owned producer.
//
// Writes `.planning/workstreams/<team>/submissions/<phase>.json`: the developer's
// "this phase is done and verified — take it" signal that the submission gate
// (scripts/check-submission.mjs) enforces on every PR into integration/<ver>.
//
// Why this lives in the repo (not the global `/rrr:submit-phase`):
//   `/rrr:submit-phase` → ~/.claude/rrr/scripts/rrr-team-mode.js → manager.js:submitPhase
//   rewrites ONE rolling `SUBMISSION.json` and ACCUMULATES phases_completed. Two of a
//   team's phase branches in flight then both rewrite that one tracked file and
//   merge-CONFLICT on it (the same rolling-state class as STATE.md). It is also
//   global tooling that `/rrr:update` overwrites. A per-phase file keyed by phase
//   number never collides, and a repo-owned producer survives RRR updates.
//
// `/rrr:submit-phase` remains usable for RRR's own (advisory, report-first)
// coordinate-merge / integration-report — it just no longer writes the tracked,
// enforced marker.
//
// Usage:
//   node scripts/submit-phase.mjs --team <team> --phase <phase> [--ready]
//        [--tests a,b,c] [--uat path,path] [--risks "a; b"] [--base <ref>]

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";

const args = parseArgs(process.argv.slice(2));
const repoRoot = process.cwd();

const team = args.team;
const phase = args.phase != null ? String(args.phase) : null;
if (!team) die("--team <team> is required (e.g. --team team-workspace).");
if (!phase) die("--phase <phase> is required (e.g. --phase 31).");

const config = readJson(path.join(repoRoot, ".planning", "team-mode.json"));
if (!config) die("could not read .planning/team-mode.json — is this an RRR team-mode repo?");
const teamCfg = (config.teams || {})[team];
if (!teamCfg) die(`unknown team "${team}". Known: ${Object.keys(config.teams || {}).join(", ") || "(none)"}.`);

const baseRef = args.base || (config.github && config.github.base_branch) || "main";
const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]);
const headSha = git(["rev-parse", "HEAD"]);
const baseSha = tryGit(["merge-base", baseRef, "HEAD"]) || tryGit(["rev-parse", baseRef]) || null;
const filesTouched = baseSha
  ? (tryGit(["diff", "--name-only", `${baseSha}...HEAD`]) || "").split("\n").map(s => s.trim()).filter(Boolean)
  : [];

const submission = {
  schema_version: 1,
  workstream: team,
  github_team: teamCfg.github_team,
  milestone: config.milestone,
  phase, // explicit — this marker covers exactly one phase
  branch,
  expected_branch: teamCfg.branch,
  base_branch: baseRef,
  base_sha: baseSha,
  head_sha: headSha,
  phases_assigned: teamCfg.phases || [],
  phases_completed: [phase],
  ready_for_integration: args.ready === true,
  files_touched: filesTouched,
  tests_run: splitList(args.tests),
  uat_artifacts: splitList(args.uat),
  risks: args.risks ? args.risks.split(/\s*;\s*/).filter(Boolean) : [],
  updated_at: new Date().toISOString(),
};

const outDir = path.join(repoRoot, ".planning", "workstreams", team, "submissions");
mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, `${phase}.json`);
writeFileSync(outPath, JSON.stringify(submission, null, 2) + "\n");

const rel = path.relative(repoRoot, outPath);
console.log(`✓ wrote ${rel}`);
console.log(`  team=${team} phase=${phase} branch=${branch}`);
console.log(`  ready_for_integration=${submission.ready_for_integration ? "yes" : "no"}  files_touched=${filesTouched.length}`);
if (!submission.ready_for_integration) {
  console.log(`  (not ready — pass --ready once verification + UAT artifacts are done)`);
}
console.log(`\nNext:`);
console.log(`  git add ${rel} && git commit -m "submit(${phase}): ready for integration"`);
console.log(`  gh pr create --base ${config.github?.integration_branch || "integration/<ver>"} --fill`);

// ---- helpers ----

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const eq = a.indexOf("=");
    if (eq !== -1) out[a.slice(2, eq)] = a.slice(eq + 1);
    else if (argv[i + 1] && !argv[i + 1].startsWith("--")) out[a.slice(2)] = argv[++i];
    else out[a.slice(2)] = true;
  }
  return out;
}

function splitList(v) {
  if (!v || v === true) return [];
  return String(v).split(",").map(s => s.trim()).filter(Boolean);
}

function readJson(p) {
  try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; }
}

function git(argv) {
  return execFileSync("git", argv, { cwd: repoRoot, encoding: "utf8" }).trim();
}

function tryGit(argv) {
  try { return git(argv); } catch { return null; }
}

function die(msg) {
  console.error(`✗ submit-phase: ${msg}`);
  process.exit(1);
}
