// Sandboxed test-and-fix loop v1 CLI (see peaceai/spec/loop-v1.md).
//   tsx peaceai/bin/loop.ts run <taskfile> [--max N] [--deps-dir DIR] [--proposer rules-v1|repair-v1|repair-v2|model-v1] [--planner NAME]
//       [--ranking FILE --ranking-sha256 HEX]   (model-v1 only)
//   (DIR: where the run's install cache goes; the proposer defaults to rules-v1, repair-v1 is M152's edit proposer,
//   repair-v2 is M168's (repair-v1 plus idiom templates, depth-2 callees and file-name focus; spec/edit-proposer-v2.md),
//   model-v1 (M167) reranks repair-v1's candidates by the scoring job's ranking FILE, which must hash to HEX; model-v1
//   runs only on the pinned public dev task file at the pinned --max (peaceai/model/model-v1-proposer.json), and any
//   ranking problem ends every task PROPOSER_FAILED (never repair-v1's order);
//   NAME: v1|v2|v3|v4 or plan-only-vN, picked by lib/plandefault.ts selectPlanner, default = its default planner (M162))
// The task file must be locked in the committed plan log (plan-only.ts lock). Candidate code runs only as the
// stage-2 candidate uid named by PEACEAI_STAGE2_CAND; without it every task is refused (CAND_UID_*). Appends one
// loop row per task to peaceai/plan/loop-runs.jsonl. Prints codes and numbers only; a hidden-set line names no task.
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { repairProposer } from "../lib/editpropose.ts";
import { loopPlanner, MAX_ATTEMPTS, ROOT, runLoopFile, type Proposer } from "../lib/loop.ts";
import { MODEL_PROPOSER, MODEL_V1_PIN, modelProposer, modelV1RunProblem, parseRanking, type ModelV1Pin, type Ranking } from "../lib/modelpropose.ts";
import { sha256 } from "../lib/plan.ts";
import { taskKey } from "../lib/plangrade.ts";
import { reachedTests } from "../lib/looprow.ts";
import { PROOFS, runIsolationProofs } from "../lib/loopdeps.ts";
import { runnerWrapper } from "../lib/loop.ts";
import { stage2CandUid } from "../lib/selfpropose.ts";

// M171 (Auditor ruling on run 41521457458, condition c): `loop.ts proofs` runs the isolation proofs
// (lib/loopdeps.ts runIsolationProofs) inside this loop's runner wrapper as the candidate uid, before any attempt.
// Fixed codes only; exits 1 on any refusal (fail closed; nothing falls back to the runner uid).
if (process.argv[2] === "proofs") {
  const c = stage2CandUid(process.env);
  if (!c.ok) { console.log(`refused ${c.reason}`); process.exit(1); }
  // no top-level await: a copy of this file outside the ESM package (the m169 mutation harness) compiles as CJS
  runIsolationProofs(c.cand, { env: process.env, root: ROOT, wrapper: runnerWrapper }).then((r) => {
    for (const p of PROOFS) if (r.proofs[p]) console.log(`proof ${p}=${r.proofs[p]}`);
    console.log(`git-credential files checked=${r.credFiles}`);
    if (!r.ok) { console.log(`refused ${r.refusal}`); process.exit(1); }
    console.log("isolation proofs ok");
    process.exit(0);
  }, () => { console.log("refused PROOFS_CRASHED"); process.exit(1); });
} else runLoopCommand();

// the `run` command (unchanged, kept at the original indentation so the diff stays small); never reached for `proofs`
function runLoopCommand(): void {

const args = process.argv.slice(2);
const [cmd, file] = args;
const maxAt = args.indexOf("--max");
const max = maxAt >= 0 ? Number(args[maxAt + 1]) : 3;
const depsAt = args.indexOf("--deps-dir");
const depsDir = depsAt >= 0 ? args[depsAt + 1] : undefined;
const propAt = args.indexOf("--proposer");
const prop = propAt >= 0 ? args[propAt + 1] : "rules-v1";
const planAt = args.indexOf("--planner");
const plannerFlag = planAt >= 0 ? (args[planAt + 1] ?? "") : undefined;
if (cmd !== "run" || !file || !Number.isInteger(max) || max < 1 || max > MAX_ATTEMPTS || (depsAt >= 0 && !depsDir?.startsWith("/")) || (prop !== "rules-v1" && prop !== "repair-v1" && prop !== "repair-v2" && prop !== MODEL_PROPOSER)) {
  console.log(`usage: loop.ts run <taskfile> [--max 1..${MAX_ATTEMPTS}] [--deps-dir /abs/dir] [--proposer rules-v1|repair-v1|repair-v2|model-v1] [--planner v1|v2|v3|v4] [--ranking /abs --ranking-sha256 HEX]`);
  process.exit(2);
}
// the planner is picked only by selectPlanner; an unknown name is refused before anything runs
const planner = loopPlanner(plannerFlag);
if (!planner) { console.log("refused PLANNER_UNKNOWN"); process.exit(2); }
let out: ReturnType<typeof runLoopFile>;
let rankingRefused = false;
let makeProposer: ((t: { taskKey: string }) => Proposer) | undefined = prop === "repair-v1" ? (): Proposer => repairProposer() : prop === "repair-v2" ? (): Proposer => repairProposer({ v2: true }) : undefined;
const rankAt = args.indexOf("--ranking"), rankShaAt = args.indexOf("--ranking-sha256");
if (prop !== MODEL_PROPOSER && (rankAt >= 0 || rankShaAt >= 0)) { console.log("refused RANKING_WITHOUT_MODEL_V1"); process.exit(2); }
if (prop === MODEL_PROPOSER) {
  // M167: the pre-registered dev run only: the pinned public task file at the pinned --max
  let pin: unknown = null;
  try { pin = JSON.parse(readFileSync(join(ROOT, MODEL_V1_PIN), "utf8")); } catch { /* refused below */ }
  const bad = modelV1RunProblem(pin, file, max, ROOT);
  if (bad) { console.log(`refused ${bad}`); process.exit(2); }
  const rankPath = rankAt >= 0 ? args[rankAt + 1] : undefined;
  const text = rankPath && existsSync(rankPath) ? readFileSync(rankPath, "utf8") : null;
  const fileText = readFileSync(file, "utf8"), fileSha = sha256(fileText);
  let keys: string[] = [];
  try { keys = ((JSON.parse(fileText) as { tasks: { id: string }[] }).tasks).map((t) => taskKey(fileSha, t.id)); } catch { /* the loop refuses the file below */ }
  const pr = parseRanking(text, rankShaAt >= 0 ? (args[rankShaAt + 1] ?? null) : null, pin as ModelV1Pin, fileSha, keys);
  const ranking: Ranking | null = pr.ok ? pr.ranking : null;
  // the rows are still written (every task PROPOSER_FAILED, no model named), then the run exits non-zero below
  if (!pr.ok) { console.log(`model-v1 ranking refused ${pr.reason}: every task ends PROPOSER_FAILED`); rankingRefused = true; }
  makeProposer = (t) => modelProposer(t, ranking) as Proposer;
}
// M169: only a failure to read the task file itself is TASK_FILE_INVALID (runLoopFile returns that code for a file it
// read but could not parse or validate); any other throw is LOOP_CRASHED with a fixed code (the error's code or class
// name, never its message), so a crash elsewhere (run 41473993873: a missing --deps-dir) is no longer reported as a
// bad task file
const regularFile = (p: string | undefined): boolean => { try { return !!p && statSync(p).isFile(); } catch { return false; } };
// the printed code comes from fixed allow-lists only (public-log rule: filtered codes); any other code, an upper-case
// token included (e.g. ENAMETOOLONG, ERR_*), or any other class name prints OTHER
const CRASH_CODES: ReadonlySet<string> = new Set([
  "ENOENT", "EACCES", "EPERM", "EEXIST", "ENOTDIR", "EISDIR", "ENOTEMPTY", "EROFS", "ENOSPC", "EDQUOT", "EMFILE", "ENFILE",
  "EBUSY", "EAGAIN", "ENOMEM", "E2BIG", "EPIPE", "ETIMEDOUT", "ECONNRESET", "ECONNREFUSED", "EAI_AGAIN", "ENOTFOUND",
]);
const CRASH_CLASSES: ReadonlySet<string> = new Set(["Error", "TypeError", "RangeError", "SyntaxError", "ReferenceError", "URIError", "EvalError", "AggregateError"]);
const crashCode = (e: unknown): string => {
  const c = (e as { code?: unknown } | null)?.code;
  if (typeof c === "string" && CRASH_CODES.has(c)) return c; // m169-guard:bin-crash-code
  const n = e instanceof Error ? e.name : "";
  return c === undefined && CRASH_CLASSES.has(n) ? n : "OTHER";
};
try { out = runLoopFile(file, { maxAttempts: max, depsDir, makeProposer, plannerFlag }); } catch (e) {
  let taskFile = false;
  // the task file is the first thing runLoopFile reads: a throw naming it, or any throw while it is not a regular file
  // (a directory read fails EISDIR without a path), is the task file's
  if ((e as { path?: unknown } | null)?.path === file || !regularFile(file)) taskFile = true; // m169-guard:bin-task-file
  console.log(taskFile ? "refused TASK_FILE_INVALID" : `refused LOOP_CRASHED ${crashCode(e)}`);
  process.exit(1);
}
if (out.code !== "OK") { console.log(`refused ${out.code}`); process.exit(1); }
for (const { row: r } of out.results) {
  const id = r.set === "public" ? `${r.repo}@${r.commit!.slice(0, 10)}` : r.taskKey;
  const t = r.tests ? ` tests=${r.tests.total} byPeaceAI=${r.tests.passedByPeaceAI} byTeam=${r.tests.filledByTeam}` : "";
  const b = r.baseline ? ` baseline=${r.baseline.total}/${r.baseline.passing}/${r.baseline.failing}` : "";
  console.log(`${id} ${r.code} attempts=${r.attempts}/${r.maxAttempts} codes=${r.attemptCodes.map((c) => c.join("+")).join(",") || "-"} runner=${r.runner ?? "-"} deps=${r.deps ?? "-"}${b}${t}`);
}
const n = (c: string) => out.results.filter((x) => x.row.result === c).length;
console.log(`planner=${planner} tasks=${out.results.length} pass=${n("pass")} fail=${n("fail")} refused=${n("refused")} reachedTests=${out.results.filter((x) => reachedTests(x.row)).length}`);
if (rankingRefused) process.exit(1); // M167: a refused ranking is never a green run
}
