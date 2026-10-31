// Sandboxed test-and-fix loop v1 CLI (see peaceai/spec/loop-v1.md).
//   tsx peaceai/bin/loop.ts run <taskfile> [--max N] [--deps-dir DIR]   (DIR: where the run's install cache goes)
// The task file must be locked in the committed plan log (plan-only.ts lock). Candidate code runs only as the
// stage-2 candidate uid named by PEACEAI_STAGE2_CAND; without it every task is refused (CAND_UID_*). Appends one
// loop row per task to peaceai/plan/loop-runs.jsonl. Prints codes and numbers only; a hidden-set line names no task.
import { MAX_ATTEMPTS, runLoopFile } from "../lib/loop.ts";

const args = process.argv.slice(2);
const [cmd, file] = args;
const maxAt = args.indexOf("--max");
const max = maxAt >= 0 ? Number(args[maxAt + 1]) : 3;
const depsAt = args.indexOf("--deps-dir");
const depsDir = depsAt >= 0 ? args[depsAt + 1] : undefined;
if (cmd !== "run" || !file || !Number.isInteger(max) || max < 1 || max > MAX_ATTEMPTS || (depsAt >= 0 && !depsDir?.startsWith("/"))) {
  console.log(`usage: loop.ts run <taskfile> [--max 1..${MAX_ATTEMPTS}] [--deps-dir /abs/dir]`);
  process.exit(2);
}
let out: ReturnType<typeof runLoopFile>;
try { out = runLoopFile(file, { maxAttempts: max, depsDir }); } catch { console.log("refused TASK_FILE_INVALID"); process.exit(1); }
if (out.code !== "OK") { console.log(`refused ${out.code}`); process.exit(1); }
for (const { row: r } of out.results) {
  const id = r.set === "public" ? `${r.repo}@${r.commit!.slice(0, 10)}` : r.taskKey;
  const t = r.tests ? ` tests=${r.tests.total} byPeaceAI=${r.tests.passedByPeaceAI} byTeam=${r.tests.filledByTeam}` : "";
  const b = r.baseline ? ` baseline=${r.baseline.total}/${r.baseline.passing}/${r.baseline.failing}` : "";
  console.log(`${id} ${r.code} attempts=${r.attempts}/${r.maxAttempts} codes=${r.attemptCodes.map((c) => c.join("+")).join(",") || "-"} runner=${r.runner ?? "-"} deps=${r.deps ?? "-"}${b}${t}`);
}
const n = (c: string) => out.results.filter((x) => x.row.result === c).length;
console.log(`tasks=${out.results.length} pass=${n("pass")} fail=${n("fail")} refused=${n("refused")} reachedTests=${out.results.filter((x) => x.row.baseline).length}`);
