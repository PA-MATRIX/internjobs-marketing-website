#!/usr/bin/env node
// Read-only v1.5 promotion verifier (v1.6 Phase 37, MERGE-01/02).
// --pre : markers 32/33/36 on the git REF (not the worktree), Phase 34/35 status
//         record in CONTEXT.md, audit record, CI required-check names.
// Never runs a git command that writes refs or the worktree.
//
// Usage: node scripts/verify-v15-promotion.mjs --pre [--ref origin/integration/v1.5]
//   [--context <path>] [--audit <path>] [--ci <path>] [--expect-head <sha>] [--repo <dir>]

import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const REQUIRED_CHECKS = [
  "submission gate (rrr)",
  "workspaces (marketing · app · employers)",
  "workspace worker (parrot)",
  "startups worker (typecheck · tests)",
];

const SUB_DIR = ".planning/workstreams/team-workspace/submissions";
const REQUIRED_MARKERS = ["32", "33", "36"];
const STATUS_WORDS = ["done", "deferred", "dropped"];

/** Parse the `## v1.5 Phase 34/35 status (MERGE-01)` section. Returns {34: {...}|null, 35: ...}. */
export function parseStatus(text) {
  const out = { 34: null, 35: null };
  const m = /^##\s+v1\.5 Phase 34\/35 status \(MERGE-01\)\s*$([\s\S]*?)(?=^##\s|(?![\s\S]))/m.exec(text || "");
  if (!m) return out;
  for (const line of m[1].split("\n")) {
    const l = /^-\s+Phase (34|35):\s*(\S+)\s+—\s+(.*)$/.exec(line.trim());
    if (!l) continue;
    const confirmed = /^confirmed by (.+?) on (\d{4}-\d{2}-\d{2}):\s*(\S.*)$/.exec(l[3]);
    out[l[1]] = { word: l[2], confirmed: confirmed ? { by: confirmed[1], on: confirmed[2], evidence: confirmed[3] } : null };
  }
  return out;
}

/** Parse audit front matter: result + accepted_gaps (inline [..] list or `- item` lines). */
export function parseAudit(text) {
  const fm = /^---\n([\s\S]*?)\n---/.exec(text || "");
  if (!fm) return { result: null, accepted_gaps: [] };
  const body = fm[1];
  const result = (/^result:\s*(\S+)\s*$/m.exec(body) || [])[1] || null;
  let gaps = [];
  const inline = /^accepted_gaps:\s*\[(.*)\]\s*$/m.exec(body);
  if (inline) {
    gaps = inline[1].split(",").map((s) => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
  } else {
    const blk = /^accepted_gaps:\s*$([\s\S]*?)(?=^\S|(?![\s\S]))/m.exec(body);
    if (blk) gaps = blk[1].split("\n").map((l) => /^\s*-\s+(.+)$/.exec(l)?.[1]?.trim()).filter(Boolean);
  }
  return { result, accepted_gaps: gaps };
}

/** Job display names: `name:` at exactly 4-space indent (job level; step names are deeper). */
export function parseJobNames(yml) {
  return [...yml.matchAll(/^ {4}name:\s*(.+?)\s*$/gm)].map((m) => m[1].replace(/^["']|["']$/g, ""));
}

function parseArgs(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith("--")) continue;
    const k = argv[i].slice(2);
    const v = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : true;
    a[k] = v;
  }
  return a;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.pre) {
    console.error("usage: verify-v15-promotion.mjs --pre [options]");
    process.exit(2);
  }
  const repo = args.repo || process.cwd();
  const ref = args.ref || "origin/integration/v1.5";
  const ctxPath = args.context || path.join(repo, ".planning/milestones/v1.6-repo-split/CONTEXT.md");
  const auditPath = args.audit || path.join(repo, ".planning/milestones/v1.6-repo-split/phases/37-merge-v1.5/37-AUDIT-v1.5.md");
  const ciPath = args.ci || path.join(repo, ".github/workflows/ci.yml");
  let failed = false;
  const ok = (m) => console.log(`OK ${m}`);
  const fail = (m) => { failed = true; console.log(`FAIL ${m}`); console.error(`FAIL ${m}`); };
  const git = (...a) => execFileSync("git", ["-C", repo, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

  let tip = null;
  try { tip = git("rev-parse", "--verify", `${ref}^{commit}`).trim(); ok(`ref ${ref} = ${tip}`); }
  catch { fail(`ref ${ref} does not resolve`); }

  if (args["expect-head"] !== undefined) {
    if (tip && tip === args["expect-head"]) ok(`head matches expected ${tip}`);
    else fail(`head drift: ${ref} is ${tip}, expected ${args["expect-head"]}`);
  }

  const markerOnRef = (p) => {
    if (!tip) return null;
    try { return JSON.parse(git("show", `${tip}:${SUB_DIR}/${p}.json`)); } catch { return null; }
  };
  const validMarker = (p) => {
    const m = markerOnRef(p);
    return !!m && m.ready_for_integration === true && Array.isArray(m.phases_completed)
      && m.phases_completed.map(String).includes(p) && m.milestone === "v1.5";
  };

  for (const p of REQUIRED_MARKERS) {
    if (validMarker(p)) ok(`marker ${p} valid on ${ref}`);
    else fail(`marker for Phase ${p} missing/invalid on ${ref}`);
  }

  const status = existsSync(ctxPath) ? parseStatus(readFileSync(ctxPath, "utf8")) : { 34: null, 35: null };
  for (const p of ["34", "35"]) {
    const s = status[p];
    if (!s) fail(`Phase ${p} status unrecorded in ${path.basename(ctxPath)}`);
    else if (!STATUS_WORDS.includes(s.word)) fail(`Phase ${p} status word '${s.word}' not one of ${STATUS_WORDS.join("|")}`);
    else if (!s.confirmed) fail(`Phase ${p} status lacks 'confirmed by <who> on <date>: <evidence>'`);
    else if (s.word === "done" && !validMarker(p)) fail(`Phase ${p} recorded done but no valid marker on ${ref}`);
    else ok(`Phase ${p} status ${s.word} (confirmed by ${s.confirmed.by} on ${s.confirmed.on})`);
  }

  if (!existsSync(auditPath)) fail(`audit record missing: ${auditPath}`);
  else {
    const a = parseAudit(readFileSync(auditPath, "utf8"));
    if (a.result === "passed") ok("audit result passed");
    else if (a.result === "gaps_accepted" && a.accepted_gaps.length > 0) ok(`audit gaps_accepted (${a.accepted_gaps.length} named)`);
    else if (a.result === "gaps_accepted") fail("audit gaps_accepted with empty accepted_gaps");
    else fail(`audit result '${a.result}' is not passed/gaps_accepted`);
  }

  if (!existsSync(ciPath)) fail(`ci.yml missing: ${ciPath}`);
  else {
    const names = parseJobNames(readFileSync(ciPath, "utf8"));
    const missing = REQUIRED_CHECKS.filter((c) => !names.includes(c));
    if (missing.length) fail(`ci.yml lacks required job name(s): ${missing.join("; ")}`);
    else ok("ci.yml contains all required check names");
  }

  process.exit(failed ? 1 : 0);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
