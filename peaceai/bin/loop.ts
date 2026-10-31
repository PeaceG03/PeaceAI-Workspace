// Sandboxed test-and-fix loop v1 CLI (see peaceai/spec/loop-v1.md).
//   tsx peaceai/bin/loop.ts run <taskfile> [--max N] [--deps-dir DIR] [--proposer rules-v1|repair-v1] [--planner NAME]
//   (DIR: where the run's install cache goes; the proposer defaults to rules-v1, repair-v1 is M152's edit proposer;
//   NAME: v1|v2|v3 or plan-only-vN, picked by lib/plandefault.ts selectPlanner, default = its default planner (M162))
// The task file must be locked in the committed plan log (plan-only.ts lock). Candidate code runs only as the
// stage-2 candidate uid named by PEACEAI_STAGE2_CAND; without it every task is refused (CAND_UID_*). Appends one
// loop row per task to peaceai/plan/loop-runs.jsonl. Prints codes and numbers only; a hidden-set line names no task.
import { repairProposer } from "../lib/editpropose.ts";
import { loopPlanner, MAX_ATTEMPTS, runLoopFile, type Proposer } from "../lib/loop.ts";

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
if (cmd !== "run" || !file || !Number.isInteger(max) || max < 1 || max > MAX_ATTEMPTS || (depsAt >= 0 && !depsDir?.startsWith("/")) || (prop !== "rules-v1" && prop !== "repair-v1")) {
  console.log(`usage: loop.ts run <taskfile> [--max 1..${MAX_ATTEMPTS}] [--deps-dir /abs/dir] [--proposer rules-v1|repair-v1] [--planner v1|v2|v3]`);
  process.exit(2);
}
// the planner is picked only by selectPlanner; an unknown name is refused before anything runs
const planner = loopPlanner(plannerFlag);
if (!planner) { console.log("refused PLANNER_UNKNOWN"); process.exit(2); }
let out: ReturnType<typeof runLoopFile>;
const makeProposer = prop === "repair-v1" ? (): Proposer => repairProposer() : undefined;
try { out = runLoopFile(file, { maxAttempts: max, depsDir, makeProposer, plannerFlag }); } catch { console.log("refused TASK_FILE_INVALID"); process.exit(1); }
if (out.code !== "OK") { console.log(`refused ${out.code}`); process.exit(1); }
for (const { row: r } of out.results) {
  const id = r.set === "public" ? `${r.repo}@${r.commit!.slice(0, 10)}` : r.taskKey;
  const t = r.tests ? ` tests=${r.tests.total} byPeaceAI=${r.tests.passedByPeaceAI} byTeam=${r.tests.filledByTeam}` : "";
  const b = r.baseline ? ` baseline=${r.baseline.total}/${r.baseline.passing}/${r.baseline.failing}` : "";
  console.log(`${id} ${r.code} attempts=${r.attempts}/${r.maxAttempts} codes=${r.attemptCodes.map((c) => c.join("+")).join(",") || "-"} runner=${r.runner ?? "-"} deps=${r.deps ?? "-"}${b}${t}`);
}
const n = (c: string) => out.results.filter((x) => x.row.result === c).length;
console.log(`planner=${planner} tasks=${out.results.length} pass=${n("pass")} fail=${n("fail")} refused=${n("refused")} reachedTests=${out.results.filter((x) => x.row.baseline).length}`);
