#!/usr/bin/env tsx
// M219: live self-loop entry. Clean-clones PeaceAI-Workspace at --head (never the working tree), finds a failing
// safe-zone self-test or seeds a labelled practice break, builds a PlanTask, runs the sandboxed loop as the stage-2
// cand, appends an experimental/not-for-credit row. See peaceai/spec/self-loop-live-v1.md.
//
//   tsx peaceai/bin/self-loop-live.ts --head <40hex> --clone <abs> --scratch <abs> --out <abs>
//       [--repo PeaceG03/PeaceAI-Workspace] [--host <abs>] [--no-seed] [--dry-prepare]
//
// Prints fixed codes only. Exit 0 on loop PASS; 1 on loop non-PASS; 2 on live refusal / usage.
import { resolve } from "node:path";
import { ROOT } from "../lib/loop.ts";
import { STAGE2_CAND_ENV } from "../lib/selfpropose.ts";
import {
  prepareSelfLoopLive,
  practiceBreakProposer,
  runSelfLoopLive,
  SELF_LOOP_LIVE_LOG,
} from "../lib/self-loop-live.ts";

function opt(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
function has(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

const head = opt("head") ?? "";
const cloneDest = opt("clone") ?? "";
const scratchDest = opt("scratch") ?? "";
const outDir = opt("out") ?? "";
const repo = opt("repo") ?? "PeaceG03/PeaceAI-Workspace";
const host = opt("host") ? resolve(opt("host")!) : ROOT;
const dry = has("dry-prepare");
const seedIfClean = !has("no-seed");

if (!/^[0-9a-f]{40}$/.test(head) || !cloneDest.startsWith("/") || !scratchDest.startsWith("/") || !outDir.startsWith("/")) {
  console.log("usage: self-loop-live.ts --head <40hex> --clone /abs --scratch /abs --out /abs [--repo owner/name] [--host /abs] [--no-seed] [--dry-prepare]");
  process.exit(2);
}

const prepared = prepareSelfLoopLive({
  expectedHead: head,
  cloneDest,
  scratchDest,
  hostWorkspace: host,
  repo,
  seedIfClean,
});
if (!prepared.ok) {
  console.log(`refused ${prepared.code}${prepared.detail ? ` ${prepared.detail}` : ""}`);
  process.exit(2);
}
console.log(`prepared seeded=${prepared.seeded} failing=${prepared.failingTests.length} commit=${prepared.gap.commit} merge=${prepared.gap.merge} edit=${prepared.gap.editPath}`);
if (dry) {
  console.log("dry-prepare ok");
  process.exit(0);
}

const ran = runSelfLoopLive({
  prepared,
  hostWorkspace: host,
  outDir,
  env: { ...process.env, [STAGE2_CAND_ENV]: process.env[STAGE2_CAND_ENV] ?? "peaceai-cand3" },
  proposer: practiceBreakProposer(),
});
if (!ran.ok) {
  console.log(`refused ${ran.code}${ran.detail ? ` ${ran.detail}` : ""}`);
  process.exit(2);
}
console.log(`row experimental=${ran.row.experimental} credit=${ran.row.credit} code=${ran.row.loopCode} result=${ran.row.result} attempts=${ran.row.attempts} log=${outDir}/${SELF_LOOP_LIVE_LOG}`);
process.exit(ran.row.loopCode === "PASS" ? 0 : 1);
