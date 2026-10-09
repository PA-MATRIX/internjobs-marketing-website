#!/usr/bin/env node
// Read-only v1.5 promotion verifier (v1.6 Phase 37, MERGE-01/02).
// --pre : markers 32/33/36 on the git REF (not the worktree), Phase 34/35 status
//         record in CONTEXT.md, audit record, CI required-check names.
// Never runs a git command that writes refs or the worktree.
//
// Usage: node scripts/verify-v15-promotion.mjs --pre [--ref origin/integration/v1.5]
//   [--context <path>] [--audit <path>] [--ci <path>] [--expect-head <sha>] [--repo <dir>]

import { execFileSync } from "node:child_process";
import { readFileSync, existsSync, realpathSync } from "node:fs";
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

const REPO_SLUG = "PA-MATRIX/internjobs-marketing-website";
const DEFAULT_PHASE_DIR = ".planning/milestones/v1.6-repo-split/phases/37-merge-v1.5";

function reporter() {
  const st = { failed: false };
  return {
    st,
    ok: (m) => console.log(`OK ${m}`),
    info: (m) => console.log(`INFO ${m}`),
    fail: (m) => { st.failed = true; console.log(`FAIL ${m}`); console.error(`FAIL ${m}`); },
  };
}

function ghJson(...a) {
  return JSON.parse(execFileSync("gh", a, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
}

/** --gate-prev <NN-MM>: SUMMARY exists and VERIFICATION front matter status: passed. */
function gatePrev(args) {
  const { ok, fail, st } = reporter();
  const plan = String(args["gate-prev"]);
  const dir = args["phase-dir"] || path.join(args.repo || process.cwd(), DEFAULT_PHASE_DIR);
  const sum = path.join(dir, `${plan}-SUMMARY.md`);
  const ver = path.join(dir, `${plan}-VERIFICATION.md`);
  if (existsSync(sum)) ok(`${plan}-SUMMARY.md exists`); else fail(`${plan}-SUMMARY.md missing`);
  if (!existsSync(ver)) fail(`${plan}-VERIFICATION.md missing (rrr-verifier has not run)`);
  else {
    const fm = /^---\n([\s\S]*?)\n---/.exec(readFileSync(ver, "utf8"));
    const status = fm && (/^status:\s*(\S+)\s*$/m.exec(fm[1]) || [])[1];
    if (status === "passed") ok(`${plan}-VERIFICATION.md status passed`);
    else fail(`${plan}-VERIFICATION.md status is '${status ?? "absent"}', not passed`);
  }
  process.exit(st.failed ? 1 : 0);
}

const sortedEq = (a, b) => a.length === b.length && [...a].sort().every((v, i) => v === [...b].sort()[i]);

/** protection contexts == REQUIRED_CHECKS AND REQUIRED_CHECKS subset of ref job names; extras reported. */
function preflightChecks(args) {
  const { ok, info, fail, st } = reporter();
  const repo = args.repo || process.cwd();
  const ref = args.ref || "origin/integration/v1.5";
  let prot, jobs, rulesets = null;
  try {
    prot = args["protection-json"] ? JSON.parse(readFileSync(args["protection-json"], "utf8"))
      : ghJson("api", `repos/${REPO_SLUG}/branches/main/protection`);
    if (args["ci-ref-json"]) {
      const j = JSON.parse(readFileSync(args["ci-ref-json"], "utf8"));
      jobs = Array.isArray(j) ? j : j.jobs;
    } else {
      jobs = parseJobNames(execFileSync("git", ["-C", repo, "show", `${ref}:.github/workflows/ci.yml`], { encoding: "utf8" }));
    }
    if (args["rulesets-json"]) rulesets = JSON.parse(readFileSync(args["rulesets-json"], "utf8"));
    else if (!args["protection-json"]) {
      rulesets = ghJson("api", `repos/${REPO_SLUG}/rulesets`).map((r) => ghJson("api", `repos/${REPO_SLUG}/rulesets/${r.id}`));
    }
  } catch (e) {
    fail(`could not read inputs: ${String(e.message).split("\n")[0]}`);
    process.exit(1);
  }
  const rsc = prot?.required_status_checks || {};
  const ctxs = [...new Set([...(rsc.contexts || []), ...(rsc.checks || []).map((c) => c.context)])];
  if (sortedEq(ctxs, REQUIRED_CHECKS)) ok("protection contexts == REQUIRED_CHECKS");
  else fail(`protection contexts [${ctxs.join("; ")}] != REQUIRED_CHECKS [${REQUIRED_CHECKS.join("; ")}]`);
  const missing = REQUIRED_CHECKS.filter((c) => !jobs.includes(c));
  if (missing.length) fail(`ref ci.yml lacks required job(s): ${missing.join("; ")}`);
  else ok("REQUIRED_CHECKS subset of ref job names");
  const extra = jobs.filter((j) => !REQUIRED_CHECKS.includes(j));
  info(`extra ref jobs (not required): ${extra.join("; ") || "(none)"}`);
  const rulesetCtxs = new Set();
  for (const r of rulesets || []) for (const rule of r.rules || [])
    if (rule.type === "required_status_checks") for (const c of rule.parameters?.required_status_checks || []) rulesetCtxs.add(c.context);
  for (const e of extra) info(`blocking: ${ctxs.includes(e) || rulesetCtxs.has(e) ? "yes" : "no"} (${e})`);
  if (rulesets === null && extra.length) info("rulesets not read (fixture protection only)");
  process.exit(st.failed ? 1 : 0);
}

/** --post [--pr <n>|--pr-json <file>]: tip is ancestor of main, markers on main, PR evidence. */
function postMode(args) {
  const { ok, info, fail, st } = reporter();
  const repo = args.repo || process.cwd();
  const ref = args.ref || "origin/integration/v1.5";
  const mainRef = args["main-ref"] || "origin/main";
  const ctxPath = args.context || path.join(repo, ".planning/milestones/v1.6-repo-split/CONTEXT.md");
  const git = (...a) => execFileSync("git", ["-C", repo, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  let tip = null;
  try { tip = git("rev-parse", "--verify", `${ref}^{commit}`).trim(); } catch { fail(`ref ${ref} does not resolve`); }
  let anc = false;
  if (tip) {
    try { git("merge-base", "--is-ancestor", tip, mainRef); anc = true; } catch { /* exit 1 = not ancestor */ }
    if (anc) ok(`${ref} (${tip}) is an ancestor of ${mainRef}`);
    else fail(`${ref} (${tip}) is not an ancestor of ${mainRef}`);
  }
  const mainMarker = (p) => {
    try {
      const m = JSON.parse(git("show", `${mainRef}:${SUB_DIR}/${p}.json`));
      return m.ready_for_integration === true && m.milestone === "v1.5" && Array.isArray(m.phases_completed) && m.phases_completed.map(String).includes(p);
    } catch { return false; }
  };
  const status = existsSync(ctxPath) ? parseStatus(readFileSync(ctxPath, "utf8")) : { 34: null, 35: null };
  const need = [...REQUIRED_MARKERS, ...["34", "35"].filter((p) => status[p]?.word === "done")];
  for (const p of need) {
    if (mainMarker(p)) ok(`marker ${p} present on ${mainRef}`);
    else fail(`marker ${p} absent/invalid on ${mainRef}`);
  }
  if (args.pr !== undefined || args["pr-json"] !== undefined) {
    let pr;
    try {
      pr = args["pr-json"] ? JSON.parse(readFileSync(args["pr-json"], "utf8"))
        : ghJson("pr", "view", String(args.pr), "--repo", REPO_SLUG, "--json", "number,state,mergedAt,baseRefName,headRefName,statusCheckRollup");
    } catch (e) { fail(`could not read PR evidence: ${String(e.message).split("\n")[0]}`); process.exit(1); }
    if (pr.baseRefName === "main") ok("PR base is main"); else fail(`PR base is '${pr.baseRefName}', not main`);
    if (pr.headRefName === "integration/v1.5") ok("PR head is integration/v1.5"); else fail(`PR head is '${pr.headRefName}'`);
    if (pr.state === "MERGED" && pr.mergedAt) ok("PR is merged"); else fail(`PR not merged (state ${pr.state})`);
    const roll = new Map((pr.statusCheckRollup || []).map((c) => [c.name || c.context, c.conclusion || c.state || c.status]));
    for (const c of REQUIRED_CHECKS) {
      if (roll.get(c) === "SUCCESS") ok(`check '${c}' SUCCESS`);
      else fail(`check '${c}' is ${roll.has(c) ? roll.get(c) : "absent"}, not SUCCESS`);
    }
    for (const e of ["email timeout invariant (cross-package)", "email worker (tests)"]) info(`extra check ${e}: ${roll.has(e) ? roll.get(e) : "absent"}`);
  }
  process.exit(st.failed ? 1 : 0);
}

const PEND = "executed, pending verification";
const CLOSURE_FILES = ["PROJECT.md", "ROADMAP.md", "MILESTONES.md", "STATE.md", "REQUIREMENTS.md"];

/** --closure [--final] [--repo <dir>]: v1.5 closed in the records + position records (MERGE-04). */
function closureMode(args) {
  const { ok, fail, st } = reporter();
  const repo = args.repo || process.cwd();
  const final = args.final === true;
  const pl = (f) => path.join(repo, ".planning", f);
  const read = (f) => (existsSync(pl(f)) ? readFileSync(pl(f), "utf8") : null);
  const t = {};
  for (const f of CLOSURE_FILES) {
    t[f] = read(f);
    if (t[f] === null) { fail(`${f} missing`); continue; }
    if (/^(<{7}|>{7})( |$)/m.test(t[f])) fail(`${f} carries conflict markers`);
    else ok(`${f} has no conflict markers`);
  }
  const chk = (cond, good, bad) => (cond ? ok(good) : fail(bad));
  const P = t["PROJECT.md"] || "", R = t["ROADMAP.md"] || "", M = t["MILESTONES.md"] || "", Q = t["REQUIREMENTS.md"] || "", S = t["STATE.md"] || "";
  chk(!/Current Milestone:\**\s*v1\.5/.test(P) && !/v1\.5 in flight/.test(P), "PROJECT.md: v1.5 is not current/in flight", "PROJECT.md still shows v1.5 as current or in flight");
  const rv15 = R.split("\n").filter((l) => /^\s*-\s.*\bv1\.5\b/.test(l) && /\*\*v1\.5\b/.test(l));
  chk(rv15.length > 0 && rv15.every((l) => !/In progress|\u{1F6A7}/iu.test(l)), "ROADMAP.md: v1.5 not in progress", "ROADMAP.md v1.5 line missing or still in progress");
  const entry = /^## v1\.5 .*\(Shipped: \d{4}-\d{2}-\d{2}[^)]*\)[\s\S]*?(?=^## |(?![\s\S]))/m.exec(M);
  chk(!!entry, "MILESTONES.md has a v1.5 shipped entry", "MILESTONES.md lacks a '## v1.5 ... (Shipped: <date>)' entry");
  if (entry) {
    const arch = /(\.planning\/milestones\/v1\.5\/)/.exec(entry[0]);
    if (!arch) fail("MILESTONES.md v1.5 entry cites no .planning/milestones/v1.5/ archive path");
    else chk(existsSync(path.join(repo, arch[1])), `archive path ${arch[1]} exists`, `archive path ${arch[1]} cited but absent from the tree`);
  }
  for (const n of [1, 2, 3, 4]) {
    const id = `MERGE-0${n}`;
    const line = Q.split("\n").find((l) => l.includes(`**${id}**`)) || "";
    const row = Q.split("\n").find((l) => new RegExp(`^\\|\\s*${id}\\s*\\|`).test(l)) || "";
    if (final) chk(/^- \[x\]/.test(line) && /Complete/.test(row), `${id} Complete`, `${id} not [x]/Complete`);
    else chk(/^- \[ \]/.test(line) && line.includes(PEND) && /Pending verification/.test(row), `${id} ${PEND}`, `${id} lacks '${PEND}' (unticked, traceability 'Pending verification')`);
  }
  const r37 = R.split("\n").find((l) => /\*\*Phase 37:/.test(l) && /^- \[/.test(l)) || "";
  if (final) chk(/^- \[x\]/.test(r37), "ROADMAP Phase 37 ticked", "ROADMAP Phase 37 not ticked");
  else chk(/^- \[ \]/.test(r37) && r37.includes(PEND), `ROADMAP Phase 37 unticked, ${PEND}`, `ROADMAP Phase 37 not unticked with '${PEND}'`);
  const fm = /^---\n([\s\S]*?)\n---/.exec(S);
  const fmv = (k) => (new RegExp(`^${k}:\\s*"?([^"\\n]*?)"?\\s*$`, "m").exec(fm ? fm[1] : "") || [])[1];
  chk(fmv("phase") === "37" && fmv("plan_total") === "3" && fmv("plan") === "3", "STATE.md frontmatter: phase 37, plan 3 of 3", "STATE.md frontmatter does not show phase 37 plan 3 of 3");
  if (final) chk(/complete/i.test(fmv("status") || "") && !(fmv("status") || "").includes(PEND), "STATE status complete", "STATE status not complete");
  else chk(S.includes(PEND), `STATE says ${PEND}`, `STATE lacks '${PEND}'`);
  let ci = null;
  try { ci = JSON.parse(read("current-intent.json")); } catch { /* handled below */ }
  if (!ci || typeof ci !== "object") fail("current-intent.json missing or unparseable");
  else {
    const miss = ["milestone_id", "phase_id", "plan_id", "intent", "updated_at"].filter((k) => !ci[k]);
    if (miss.length) fail(`current-intent.json lacks ${miss.join(", ")}`);
    else chk(/v1\.6/.test(String(ci.milestone_id)) && /^37\b/.test(String(ci.phase_id)), "current-intent.json names v1.6 / phase 37", "current-intent.json does not name v1.6 and phase 37");
  }
  if (final) {
    const ver = path.join(args["phase-dir"] || path.join(repo, DEFAULT_PHASE_DIR), "37-VERIFICATION.md");
    const vfm = existsSync(ver) ? /^---\n([\s\S]*?)\n---/.exec(readFileSync(ver, "utf8")) : null;
    chk(!!vfm && /^status:\s*passed\s*$/m.test(vfm[1]), "37-VERIFICATION.md status passed", "37-VERIFICATION.md missing or not status: passed (flip before verify)");
  }
  process.exit(st.failed ? 1 : 0);
}

/** --freeze [--prs-json <file>]: every open PR against main is a v1.6 docs/split branch. */
function freezeMode(args) {
  const { ok, info, fail, st } = reporter();
  let prs;
  try {
    prs = args["prs-json"] ? JSON.parse(readFileSync(args["prs-json"], "utf8"))
      : ghJson("pr", "list", "--repo", REPO_SLUG, "--state", "open", "--base", "main", "--json", "number,headRefName,title");
  } catch (e) { fail(`could not read open PRs: ${String(e.message).split("\n")[0]}`); process.exit(1); }
  for (const p of prs) {
    if (/^docs\/.*v1\.6/.test(p.headRefName) || /^rrr\/v1\.6\//.test(p.headRefName)) ok(`PR #${p.number} (${p.headRefName}) is a v1.6 branch`);
    else fail(`PR #${p.number} (${p.headRefName}) targets main and is not a v1.6 docs/split branch`);
  }
  info(`${prs.length} open PR(s) against main`);
  process.exit(st.failed ? 1 : 0);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args["gate-prev"]) return gatePrev(args);
  if (args["preflight-checks"]) return preflightChecks(args);
  if (args.post) return postMode(args);
  if (args.closure) return closureMode(args);
  if (args.freeze) return freezeMode(args);
  if (!args.pre) {
    console.error("usage: verify-v15-promotion.mjs --pre|--post|--preflight-checks|--gate-prev <plan> [options]");
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

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) main();
