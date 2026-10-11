// Job A leak/scope gate. Exits non-zero if any candidate or the output layout fails.
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { indexGitTree } from "../lib/coreindex.ts";
import { gateCandidate, validateSummary, loadSummaryContext } from "../lib/gate.ts";
import { loadTargets, scopeOf } from "../lib/target.ts";

const outDir = process.env.PEACEAI_OUT_DIR;
const coreDir = process.env.PEACEAI_CORE_DIR;
const repo = process.env.PEACEAI_WORKSPACE_DIR ?? process.cwd();
if (!outDir || !coreDir) throw new Error("PEACEAI_OUT_DIR and PEACEAI_CORE_DIR are required");

let failed = false;
const fail = (message: string) => {
  failed = true;
  console.log(`GATE FAIL ${message}`);
};

const summary = JSON.parse(readFileSync(join(outDir, "summary.json"), "utf8"));
if (!validateSummary(summary, loadSummaryContext())) fail("summary.json schema");
const expected = new Set(["summary.json", "candidates"]);
for (const entry of readdirSync(outDir)) if (!expected.has(entry)) fail(`unexpected output entry ${entry}`);
const listed = new Set<string>((summary.candidates ?? []).map((c: { id: string }) => `${c.id}.diff`));
let present: string[] = [];
try {
  present = readdirSync(join(outDir, "candidates"));
} catch {
  present = [];
}
for (const entry of present) if (!listed.has(entry)) fail(`unlisted candidate file ${entry}`);

const baseFiles = new Set(
  execFileSync("git", ["ls-tree", "-r", "--name-only", "-z", summary.baseSha], { cwd: repo, encoding: "utf8" })
    .split("\0")
    .filter(Boolean),
);
const baseline = indexGitTree(repo).text;
const core = indexGitTree(coreDir);
// M5: per-target scope. The baseline is the target's own (public) tree.
const targets = loadTargets();
const targetName = process.env.PEACEAI_TARGET || targets.default;
const config = targets.targets[targetName];
if (!config) fail("target has no scope config");
const scope = config ? scopeOf(config) : undefined;

for (const candidate of summary.candidates ?? []) {
  let diff: string;
  try {
    diff = readFileSync(join(outDir, candidate.file), "utf8");
  } catch {
    fail(`${candidate.id}: missing diff`);
    continue;
  }
  const result = gateCandidate(diff, baseFiles, baseline, core, scope);
  if (!result.ok) for (const reason of result.reasons) fail(`${candidate.id}: ${reason}`);
}
if (failed) process.exit(1);
console.log(`GATE PASS candidates=${(summary.candidates ?? []).length}`);
