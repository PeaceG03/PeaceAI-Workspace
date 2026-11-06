#!/usr/bin/env tsx
// M220-M222: run labelled self-loop practice sets (credit:false).
//   --heldout     held-out set 1 (spent / second dev)
//   --heldout2    sealed held-out set 2
//   --dev-combined  M220 shapes + held-out set 1
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { execFileSync } from "node:child_process";
import { ROOT } from "../lib/loop.ts";
import { STAGE2_CAND_ENV } from "../lib/selfpropose.ts";
import {
  runPracticeSet,
  practiceGradeProposer,
  practiceRepairProposer,
  loadHeldoutShapes,
  loadHeldout2Shapes,
  loadDevCombinedShapes,
  PRACTICE_SHAPES,
} from "../lib/self-loop-practice.ts";

function opt(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const head = opt("head") ?? "";
const cloneDest = opt("clone") ?? "";
const scratchBase = opt("scratch-base") ?? "";
const outDir = opt("out") ?? "";
const host = opt("host") ? resolve(opt("host")!) : ROOT;
const writeRepo = process.argv.includes("--write-repo-results");
const heldout = process.argv.includes("--heldout");
const heldout2 = process.argv.includes("--heldout2");
const devCombined = process.argv.includes("--dev-combined");
const prop = opt("proposer") ?? "fault-localize-v1";

if (!/^[0-9a-f]{40}$/.test(head) || !cloneDest.startsWith("/") || !scratchBase.startsWith("/") || !outDir.startsWith("/")) {
  console.log("usage: self-loop-practice.ts --head <40hex> --clone /abs --scratch-base /abs --out /abs [--host /abs] [--write-repo-results] [--heldout|--heldout2|--dev-combined] [--proposer fault-localize-v1|repair-v2]");
  process.exit(2);
}

if (!existsSync(cloneDest)) {
  mkdirSync(dirname(cloneDest), { recursive: true });
  execFileSync("git", ["clone", "--quiet", "--no-tags", "https://github.com/PeaceG03/PeaceAI-Workspace.git", cloneDest], {
    stdio: "ignore",
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GH_TOKEN: "", GITHUB_TOKEN: "" },
  });
}
execFileSync("git", ["-C", cloneDest, "checkout", "--quiet", "--detach", head], { stdio: "ignore" });

const setName = heldout2 ? "heldout2" : heldout ? "heldout1" : devCombined ? "dev-combined" : "dev-m220";
const shapes = heldout2 ? loadHeldout2Shapes(host)
  : heldout ? loadHeldoutShapes(host)
  : devCombined ? loadDevCombinedShapes(host)
  : PRACTICE_SHAPES;

const report = runPracticeSet({
  expectedHead: head,
  cleanDir: cloneDest,
  scratchBase,
  hostWorkspace: host,
  outDir,
  env: { ...process.env, [STAGE2_CAND_ENV]: process.env[STAGE2_CAND_ENV] ?? "peaceai-cand3" },
  maxAttempts: 20, // stay at loop MAX_ATTEMPTS; ranking must win without raising the cap
  shapes,
  proposer: prop === "repair-v2" ? practiceRepairProposer() : practiceGradeProposer(),
});
if ("ok" in report && report.ok === false) {
  console.log(`refused ${report.code}${report.detail ? ` ${report.detail}` : ""}`);
  process.exit(2);
}
const r = report as Exclude<typeof report, { ok: false }>;
const avgAttempts = r.shapes.length ? r.shapes.reduce((s, x) => s + x.attempts, 0) / r.shapes.length : 0;
console.log(`practice set=${setName} total=${r.total} pass=${r.passCount} rate=${r.passRate.toFixed(3)} avgAttempts=${avgAttempts.toFixed(2)} proposer=${r.proposer} credit=false`);
for (const s of r.shapes) {
  console.log(`shape ${s.id} code=${s.loopCode} result=${s.result} attempts=${s.attempts}${s.gap ? ` gap=${s.gap}` : ""}${s.expectUnfixable ? " unfixable" : ""}`);
}
if (r.gaps.length) {
  console.log(`gaps ${r.gaps.length}`);
  for (const g of r.gaps) console.log(`gap ${g}`);
}
if (writeRepo) {
  const name = `peaceai/self-tests/practice/m222-${setName}-results.json`;
  const dest = join(host, name);
  mkdirSync(dirname(dest), { recursive: true });
  const withAvg = { ...r, avgAttempts, set: setName };
  writeFileSync(dest, JSON.stringify(withAvg, null, 2) + "\n");
  console.log(`wrote ${name}`);
}
process.exit(0);
