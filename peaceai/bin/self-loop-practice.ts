#!/usr/bin/env tsx
// M220: run the labelled self-loop practice set (credit:false). See peaceai/spec/self-loop-practice-v1.md.
//   tsx peaceai/bin/self-loop-practice.ts --head <40hex> --clone /abs --scratch-base /abs --out /abs [--host /abs]
// Prints fixed codes / rates only. Exit 0 always after a completed report (honest failures are data); 2 on live refusal.
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { ROOT } from "../lib/loop.ts";
import { STAGE2_CAND_ENV } from "../lib/selfpropose.ts";
import {
  SELF_LOOP_PRACTICE_RESULTS,
  runPracticeSet,
} from "../lib/self-loop-practice.ts";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

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

if (!/^[0-9a-f]{40}$/.test(head) || !cloneDest.startsWith("/") || !scratchBase.startsWith("/") || !outDir.startsWith("/")) {
  console.log("usage: self-loop-practice.ts --head <40hex> --clone /abs --scratch-base /abs --out /abs [--host /abs] [--write-repo-results]");
  process.exit(2);
}

if (!existsSync(cloneDest)) {
  mkdirSync(cloneDest, { recursive: true });
  execFileSync("git", ["clone", "--quiet", "--no-tags", "https://github.com/PeaceG03/PeaceAI-Workspace.git", cloneDest], {
    stdio: "ignore",
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GH_TOKEN: "", GITHUB_TOKEN: "" },
  });
  execFileSync("git", ["-C", cloneDest, "checkout", "--quiet", "--detach", head], { stdio: "ignore" });
} else {
  execFileSync("git", ["-C", cloneDest, "checkout", "--quiet", "--detach", head], { stdio: "ignore" });
}

const report = runPracticeSet({
  expectedHead: head,
  cleanDir: cloneDest,
  scratchBase,
  hostWorkspace: host,
  outDir,
  env: { ...process.env, [STAGE2_CAND_ENV]: process.env[STAGE2_CAND_ENV] ?? "peaceai-cand3" },
  maxAttempts: 5,
});
if ("ok" in report && report.ok === false) {
  console.log(`refused ${report.code}${report.detail ? ` ${report.detail}` : ""}`);
  process.exit(2);
}
const r = report as Exclude<typeof report, { ok: false }>;
console.log(`practice total=${r.total} pass=${r.passCount} rate=${r.passRate.toFixed(3)} proposer=${r.proposer} credit=false`);
for (const s of r.shapes) {
  console.log(`shape ${s.id} code=${s.loopCode} result=${s.result} attempts=${s.attempts}${s.gap ? ` gap=${s.gap}` : ""}${s.expectUnfixable ? " unfixable" : ""}`);
}
if (r.gaps.length) {
  console.log(`gaps ${r.gaps.length}`);
  for (const g of r.gaps) console.log(`gap ${g}`);
}
if (writeRepo) {
  const dest = join(host, SELF_LOOP_PRACTICE_RESULTS);
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, JSON.stringify(r, null, 2) + "\n");
  console.log(`wrote ${SELF_LOOP_PRACTICE_RESULTS}`);
}
process.exit(0);
