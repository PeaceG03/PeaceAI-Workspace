// Sandboxed test-and-fix loop v1 CLI (see peaceai/spec/loop-v1.md).
//   tsx peaceai/bin/loop.ts run <taskfile> [--max N] [--deps-dir DIR] [--proposer rules-v1|repair-v1|model-v1] [--planner NAME]
//       [--ranking FILE --ranking-sha256 HEX]   (model-v1 only)
//   (DIR: where the run's install cache goes; the proposer defaults to rules-v1, repair-v1 is M152's edit proposer,
//   model-v1 (M167) reranks repair-v1's candidates by the scoring job's ranking FILE, which must hash to HEX; model-v1
//   runs only on the pinned public dev task file at the pinned --max (peaceai/model/model-v1-proposer.json), and any
//   ranking problem ends every task PROPOSER_FAILED (never repair-v1's order);
//   NAME: v1|v2|v3|v4 or plan-only-vN, picked by lib/plandefault.ts selectPlanner, default = its default planner (M162))
// The task file must be locked in the committed plan log (plan-only.ts lock). Candidate code runs only as the
// stage-2 candidate uid named by PEACEAI_STAGE2_CAND; without it every task is refused (CAND_UID_*). Appends one
// loop row per task to peaceai/plan/loop-runs.jsonl. Prints codes and numbers only; a hidden-set line names no task.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { repairProposer } from "../lib/editpropose.ts";
import { loopPlanner, MAX_ATTEMPTS, ROOT, runLoopFile, type Proposer } from "../lib/loop.ts";
import { MODEL_PROPOSER, MODEL_V1_PIN, modelProposer, modelV1RunProblem, parseRanking, type ModelV1Pin, type Ranking } from "../lib/modelpropose.ts";
import { sha256 } from "../lib/plan.ts";

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
if (cmd !== "run" || !file || !Number.isInteger(max) || max < 1 || max > MAX_ATTEMPTS || (depsAt >= 0 && !depsDir?.startsWith("/")) || (prop !== "rules-v1" && prop !== "repair-v1" && prop !== MODEL_PROPOSER)) {
  console.log(`usage: loop.ts run <taskfile> [--max 1..${MAX_ATTEMPTS}] [--deps-dir /abs/dir] [--proposer rules-v1|repair-v1|model-v1] [--planner v1|v2|v3|v4] [--ranking /abs --ranking-sha256 HEX]`);
  process.exit(2);
}
// the planner is picked only by selectPlanner; an unknown name is refused before anything runs
const planner = loopPlanner(plannerFlag);
if (!planner) { console.log("refused PLANNER_UNKNOWN"); process.exit(2); }
let out: ReturnType<typeof runLoopFile>;
let makeProposer: ((t: { taskKey: string }) => Proposer) | undefined = prop === "repair-v1" ? (): Proposer => repairProposer() : undefined;
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
  const pr = parseRanking(text, rankShaAt >= 0 ? (args[rankShaAt + 1] ?? null) : null, pin as ModelV1Pin, sha256(readFileSync(file, "utf8")));
  const ranking: Ranking | null = pr.ok ? pr.ranking : null;
  if (!pr.ok) console.log(`model-v1 ranking refused ${pr.reason}: every task ends PROPOSER_FAILED`);
  makeProposer = (t) => modelProposer(t, ranking) as Proposer;
}
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
