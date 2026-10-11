// M7 Job B2: re-gate repaired candidates with the core (read-only, deleted after), then publish the final
// candidate set for Job C and the review. A repaired diff is used only if its hash matches the harness
// record and it passes the same scope + core-text + personal-info gate as Job A. Otherwise the candidate
// stays exactly as generated, with the results measured on it before repair (round 0).
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { indexGitTree } from "../lib/coreindex.ts";
import { countDiffLines } from "../lib/diff.ts";
import { gateCandidate, validateSummary, loadSummaryContext, type Summary } from "../lib/gate.ts";
import type { CandidateResult } from "../lib/rank.ts";
import { validateRepairRecord, type StoredRepairRecord } from "../lib/repairrecord.ts";
import { validateResults } from "../lib/results.ts";
import { loadTargets, scopeOf } from "../lib/target.ts";

const env = (name: string) => {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is required`);
  return resolve(v);
};
const inDir = env("PEACEAI_IN_DIR");
const testDir = env("PEACEAI_TESTRESULTS_DIR");
const finalDir = env("PEACEAI_FINAL_DIR");
const repo = resolve(process.env.PEACEAI_WORKSPACE_DIR ?? process.cwd());
const coreDir = process.env.PEACEAI_CORE_DIR ? resolve(process.env.PEACEAI_CORE_DIR) : "";
const sha256 = (t: string) => createHash("sha256").update(t).digest("hex");

const summary = JSON.parse(readFileSync(join(inDir, "summary.json"), "utf8"));
if (!validateSummary(summary, loadSummaryContext())) throw new Error("candidate summary failed validation");
const results: CandidateResult[] = [];
for (const f of existsSync(testDir) ? readdirSync(testDir).filter((x) => x.endsWith(".json")).sort() : []) {
  const parsed = JSON.parse(readFileSync(join(testDir, f), "utf8"));
  if (!validateResults(parsed) || parsed.baseSha !== summary.baseSha) throw new Error(`${f} failed validation`);
  results.push(...parsed.results);
}
const repairIn = join(testDir, "repair");
const repairs = new Map<string, StoredRepairRecord>();
for (const c of summary.candidates) {
  const p = join(repairIn, `${c.id}.json`);
  if (!existsSync(p)) continue;
  const r = JSON.parse(readFileSync(p, "utf8"));
  if (!validateRepairRecord(r) || r.id !== c.id) throw new Error(`${c.id}: repair record failed validation`);
  repairs.set(c.id, r);
}
const repairedIds = [...repairs.values()].filter((r) => r.repairedDiffSha256 !== null).map((r) => r.id);
if (repairedIds.length > 0 && !coreDir) throw new Error("repaired candidates need the core for the re-gate");

const targets = loadTargets();
const config = targets.targets[process.env.PEACEAI_TARGET || targets.default];
if (!config) throw new Error("target has no scope config");
const scope = scopeOf(config);
const baseFiles = repairedIds.length
  ? new Set(execFileSync("git", ["ls-tree", "-r", "--name-only", "-z", summary.baseSha], { cwd: repo, encoding: "utf8" }).split("\0").filter(Boolean))
  : new Set<string>();
const baseline = repairedIds.length ? indexGitTree(repo).text : null;
const core = repairedIds.length ? indexGitTree(coreDir) : null;

mkdirSync(join(finalDir, "candidates"), { recursive: true });
mkdirSync(join(finalDir, "testresults", "repair"), { recursive: true });
const finalSummary: Summary = { ...summary, candidates: [] };
let used = 0;
for (const c of summary.candidates) {
  const original = readFileSync(join(inDir, c.file), "utf8");
  const r = repairs.get(c.id);
  const result = results.find((x) => x.id === c.id);
  let diff = original;
  let entry = { ...c };
  if (r && r.repairedDiffSha256) {
    const repairedPath = join(repairIn, `${c.id}.diff`);
    const repaired = existsSync(repairedPath) ? readFileSync(repairedPath, "utf8") : "";
    const hashOk = repaired !== "" && sha256(repaired) === r.repairedDiffSha256 && sha256(original) === r.originalDiffSha256;
    const gate = hashOk && r.jobBGate === "pass" ? gateCandidate(repaired, baseFiles, baseline!, core!, scope) : { ok: false, reasons: ["hash"] };
    if (gate.ok) {
      diff = repaired;
      entry = { ...c, diffBytes: Buffer.byteLength(repaired), diffLines: countDiffLines(repaired), transformations: [...c.transformations, "TEST_FIX_LOOP"] };
      r.regate = "pass";
      used++;
    } else {
      r.regate = hashOk ? "core-gate-rejected" : "hash-mismatch";
      if (result) {
        // Back to the candidate as generated, judged by its round-0 measurement.
        result.diffBytes = c.diffBytes;
        result.diffLines = c.diffLines;
        result.typecheckPassed = r.original.typecheckPassed;
        result.originalSuitePassed = r.original.originalSuitePassed;
        result.newTestsPassed = r.original.newTestsPassed;
        result.newTestFiles = r.originalNewTestFiles;
      }
    }
    writeFileSync(join(finalDir, "testresults", "repair", `${c.id}.original.diff`), original);
  }
  if (r) writeFileSync(join(finalDir, "testresults", "repair", `${c.id}.json`), JSON.stringify(r, null, 2) + "\n");
  writeFileSync(join(finalDir, c.file), diff);
  finalSummary.candidates.push(entry);
}
if (!validateSummary(finalSummary, loadSummaryContext())) throw new Error("final summary failed validation");
writeFileSync(join(finalDir, "summary.json"), JSON.stringify(finalSummary, null, 2) + "\n");
if (results.length > 0)
  writeFileSync(
    join(finalDir, "testresults", "results.json"),
    JSON.stringify({ schema: "peaceai-workspace-results:v1", taskId: summary.taskId, baseSha: summary.baseSha, results: results.sort((a, b) => (a.id < b.id ? -1 : 1)) }, null, 2) + "\n",
  );
console.log(`regate candidates=${summary.candidates.length} repair_records=${repairs.size} repaired=${repairedIds.length} used=${used}`);
