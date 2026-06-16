#!/usr/bin/env node
// RRR submission gate.
//
// A team phase only reaches the integration branch through `/rrr:submit-phase`,
// which writes `.planning/workstreams/<team>/SUBMISSION.json`. Before phase-27
// we learned the hard way that this is a *convention* GitHub never enforced —
// the coordinator could open a PR straight off a team branch and merge it the
// moment CI was green, with no submission at all. This script turns the
// convention into an enforced check.
//
// It validates the submission marker that lives at the tip of the PR's head
// branch against the branch+phase actually being merged:
//   - the submission exists and is `ready_for_integration: true`
//   - its `branch` field is the branch we're merging (not a stale earlier phase)
//   - the phase encoded in the branch name is in `phases_completed`
//   - its recorded `head_sha` is in this branch's history (tamper / staleness)
//
// Non-team branches (e.g. an integration -> main promotion PR) are not subject
// to the gate: the script reports "not applicable" and exits 0.
//
// Usage:
//   node scripts/check-submission.mjs --head-ref <ref> [--head-sha <sha>]
//   node scripts/check-submission.mjs            # derive ref/sha from local git

import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";

const args = parseArgs(process.argv.slice(2));
const repoRoot = process.cwd();

const headRef = args["head-ref"] || gitHeadRef();
const headSha = args["head-sha"] || gitHeadSha();

// rrr/<ver>/team-<name>[-<phase>]   e.g. rrr/v1.4/team-workspace-27, rrr/v1.4/team-cms
const TEAM_BRANCH = /^rrr\/[^/]+\/(team-[a-z0-9-]+?)(?:-(\d+(?:\.\d+)?))?$/;

const match = headRef ? TEAM_BRANCH.exec(headRef) : null;
if (!match) {
  pass(`'${headRef || "(unknown)"}' is not a team submission branch — gate not applicable.`);
}

const team = match[1];
const branchPhase = match[2] || null; // may be null for a bare team branch
const submissionPath = path.join(repoRoot, ".planning", "workstreams", team, "SUBMISSION.json");

let submission;
try {
  submission = JSON.parse(readFileSync(submissionPath, "utf8"));
} catch (err) {
  fail(
    `no submission for ${team}: ${path.relative(repoRoot, submissionPath)} is missing or unreadable.`,
    `The owning developer must run \`/rrr:submit-phase ${branchPhase ?? "<phase>"} --team ${team} --ready\` and push before this branch can be merged.`,
    err.code === "ENOENT" ? null : err.message,
  );
}

const problems = [];

if (submission.ready_for_integration !== true) {
  problems.push(`ready_for_integration is ${JSON.stringify(submission.ready_for_integration)} (expected true) — the phase was not submitted as ready.`);
}

if (submission.branch && submission.branch !== headRef) {
  problems.push(
    `submission.branch is "${submission.branch}" but this PR merges "${headRef}". ` +
      `This is a stale marker from an earlier phase — re-run \`/rrr:submit-phase\` on this branch.`,
  );
}

if (branchPhase) {
  const completed = (submission.phases_completed || []).map(normalizePhase);
  if (!completed.includes(normalizePhase(branchPhase))) {
    problems.push(
      `phase ${branchPhase} is not in phases_completed [${completed.join(", ") || "—"}]. ` +
        `The submission does not cover the phase this branch delivers.`,
    );
  }
}

// Freshness: the commit the submission was written against must be in this
// branch's history. Skip silently if we can't compute ancestry (shallow clone
// with no head sha) rather than fail on missing git data.
if (submission.head_sha && headSha && gitAvailable()) {
  if (!isAncestor(submission.head_sha, headSha)) {
    problems.push(
      `submission.head_sha ${short(submission.head_sha)} is not an ancestor of the branch tip ${short(headSha)} — ` +
        `the submission marker does not belong to the commits being merged.`,
    );
  }
}

if (problems.length) {
  fail(`submission gate failed for ${team}${branchPhase ? ` phase ${branchPhase}` : ""}:`, ...problems);
}

pass(
  `submission gate ok: ${team}${branchPhase ? ` phase ${branchPhase}` : ""} — ready, ` +
    `branch matches, ${(submission.phases_completed || []).length} phase(s) completed, marker in branch history.`,
);

// ---- helpers ----

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const eq = a.indexOf("=");
    if (eq !== -1) {
      out[a.slice(2, eq)] = a.slice(eq + 1);
    } else if (argv[i + 1] && !argv[i + 1].startsWith("--")) {
      out[a.slice(2)] = argv[++i];
    } else {
      out[a.slice(2)] = true;
    }
  }
  return out;
}

function normalizePhase(p) {
  return String(p).trim().replace(/^0+(?=\d)/, "");
}

function git(argv) {
  return execFileSync("git", argv, { cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
}

function gitAvailable() {
  try {
    git(["rev-parse", "--git-dir"]);
    return true;
  } catch {
    return false;
  }
}

function gitHeadRef() {
  try {
    const ref = git(["rev-parse", "--abbrev-ref", "HEAD"]);
    return ref === "HEAD" ? null : ref;
  } catch {
    return null;
  }
}

function gitHeadSha() {
  try {
    return git(["rev-parse", "HEAD"]);
  } catch {
    return null;
  }
}

function isAncestor(ancestor, descendant) {
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", ancestor, descendant], {
      cwd: repoRoot,
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

function short(sha) {
  return String(sha).slice(0, 10);
}

function pass(msg) {
  console.log(`✓ ${msg}`);
  process.exit(0);
}

function fail(headline, ...lines) {
  console.error(`✗ ${headline}`);
  for (const line of lines.filter(Boolean)) console.error(`  - ${line}`);
  console.error(
    `\nThe integration merge is blocked until the owning developer submits this phase via \`/rrr:submit-phase\`.`,
  );
  process.exit(1);
}
