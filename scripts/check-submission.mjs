#!/usr/bin/env node
// RRR submission gate.
//
// A team phase only reaches the integration branch once it is *submitted* — a
// marker file the owning developer writes with `node scripts/submit-phase.mjs`.
// Before phase-27 we learned the hard way that this hand-off was a *convention*
// GitHub never enforced — the coordinator could open a PR straight off a team
// branch and merge it the moment CI was green, with no submission at all. This
// script turns the convention into an enforced check.
//
// The marker is a per-phase file `.planning/workstreams/<team>/submissions/<phase>.json`
// (collision-free: one file per phase, so two concurrent phase branches never
// conflict on it). A single rolling `.planning/workstreams/<team>/SUBMISSION.json`
// is honored as a fallback for branches predating per-phase markers.
//
// It validates the submission marker that lives at the tip of the PR's head
// branch against the branch+phase actually being merged:
//   - the submission exists and is `ready_for_integration: true`
//   - its `branch` field is the branch we're merging (not a stale earlier phase)
//   - the phase encoded in the branch name is in `phases_completed`
//   - its recorded `head_sha` is in this branch's history (tamper / staleness)
//
// Two classes of PR are exempt and pass as "not applicable":
//   - non-team branches (e.g. an integration -> main promotion PR)
//   - documentation-only PRs (only `.md` / `.planning/**` changed) — these ship
//     no code, so they carry no submission obligation. Requires a base SHA to
//     compute the diff; without one we fall through to the normal check.
//
// Usage:
//   node scripts/check-submission.mjs --head-ref <ref> [--head-sha <sha>] [--base-sha <sha>]
//   node scripts/check-submission.mjs            # derive ref/sha from local git

import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";

const args = parseArgs(process.argv.slice(2));
const repoRoot = process.cwd();

const headRef = args["head-ref"] || gitHeadRef();
const headSha = args["head-sha"] || gitHeadSha();
const baseSha = args["base-sha"] || null;

// rrr/<ver>/team-<name>[-<phase>][-<suffix>]
//   team  = "team-" + letter words (cms, workspace) — never digits
//   phase = first numeric token after the team (optional; e.g. 26, 28.5)
//   suffix= optional descriptive tail (e.g. -docs, -chat-provisioning)
// Examples: team-workspace-27, team-workspace-26-docs, team-cms-28.5, team-cms
const TEAM_BRANCH =
  /^rrr\/[^/]+\/(team-[a-z]+(?:-[a-z]+)*)(?:-(\d+(?:\.\d+)?))?(?:-[a-z][a-z0-9-]*)?$/;

const match = headRef ? TEAM_BRANCH.exec(headRef) : null;
if (!match) {
  pass(`'${headRef || "(unknown)"}' is not a team submission branch — gate not applicable.`);
}

const team = match[1];
const branchPhase = match[2] || null; // may be null for a bare team branch

// Documentation-only exemption — a PR that touches no code ships no phase.
const changed = changedFiles(baseSha, headSha);
if (changed && changed.length && changed.every(isDocFile)) {
  pass(
    `docs-only PR (${changed.length} file(s), all .md/.planning) — no code shipped, gate not applicable.`,
  );
}

// Prefer the per-phase marker `submissions/<phase>.json` so two of a team's phase
// branches in flight at once never collide on one rolling file (the SUBMISSION.json
// problem, same rolling-state class as STATE.md). Fall back to the legacy single
// `SUBMISSION.json` so any branch created before per-phase markers still validates.
const { path: submissionPath, kind: submissionKind } = resolveSubmissionPath(repoRoot, team, branchPhase);

let submission;
try {
  submission = JSON.parse(readFileSync(submissionPath, "utf8"));
} catch (err) {
  fail(
    `no submission for ${team}: ${path.relative(repoRoot, submissionPath)} is missing or unreadable.`,
    `The owning developer must run \`node scripts/submit-phase.mjs --team ${team} --phase ${branchPhase ?? "<phase>"} --ready\` and push before this branch can be merged.`,
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
    `branch matches, ${(submission.phases_completed || []).length} phase(s) completed, marker in branch history ` +
    `(${submissionKind} marker: ${path.relative(repoRoot, submissionPath)}).`,
);

// ---- helpers ----

// Resolve which submission marker governs this branch+phase. Per-phase markers
// (`submissions/<phase>.json`) are collision-free — one file per phase, never
// rewritten by another phase — so they win when present. A bare team branch (no
// phase) and any legacy branch fall back to the single rolling `SUBMISSION.json`.
function resolveSubmissionPath(root, team, phase) {
  const dir = path.join(root, ".planning", "workstreams", team);
  if (phase) {
    const perPhase = path.join(dir, "submissions", `${phase}.json`);
    if (existsSync(perPhase)) return { path: perPhase, kind: "per-phase" };
  }
  return { path: path.join(dir, "SUBMISSION.json"), kind: "legacy" };
}

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

// Files a PR adds relative to its base, via three-dot (merge-base..head) so a
// stale branch isn't charged with everything the base has moved on to. Returns
// null when we can't compute it (no base sha or no git) — caller then skips the
// docs exemption rather than guessing.
function changedFiles(base, head) {
  if (!base || !head || !gitAvailable()) return null;
  try {
    const out = git(["diff", "--name-only", `${base}...${head}`]);
    return out ? out.split("\n").map(s => s.trim()).filter(Boolean) : [];
  } catch {
    return null;
  }
}

function isDocFile(f) {
  return f.startsWith(".planning/") || /\.mdx?$/.test(f);
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
    `\nThe integration merge is blocked until the owning developer submits this phase via \`node scripts/submit-phase.mjs --team <team> --phase <phase> --ready\`.`,
  );
  process.exit(1);
}
