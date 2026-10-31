// PLAN-ONLY CLI with the DEFAULT planner (see peaceai/spec/plan-default.md). The default is decided only in
// lib/plandefault.ts (now plan-only-v4: hidden 0.337 vs 0.287, gain on 3 of 20 tasks; v3 before, still selectable).
//   tsx peaceai/bin/plan.ts run [--planner=v1|v2|v3|v4] <taskfile> plan + grade a locked file (default planner if no flag)
//   tsx peaceai/bin/plan.ts lock <taskfile>                       same lock as bin/plan-only.ts lock (one lock serves all)
// bin/plan-only.ts (v1), bin/plan-only-v2.ts and bin/plan-only-v3.ts are unchanged and still run their planner.
// Prints codes and numbers only. For a hidden-set file it prints nothing that names a task.
import { typescriptEntry, useTypescript } from "../lib/tsresolve.ts";
import { selectPlanner } from "../lib/plandefault.ts";

const USAGE = "usage: plan.ts lock <taskfile> | run [--planner=v1|v2|v3|v4] <taskfile>";
const args = process.argv.slice(2);
const cmd = args.shift();
let flag: string | undefined;
if (cmd === "run" && args[0]?.startsWith("--planner=")) flag = args.shift()!.slice("--planner=".length);
const [file, ...rest] = args;
if (!file || rest.length || (cmd !== "lock" && cmd !== "run") || file.startsWith("--")) { console.log(USAGE); process.exit(2); }
const entry = selectPlanner(flag);
if (!entry) { console.log("refused PLANNER_UNKNOWN"); process.exit(2); }

const tsEntry = typescriptEntry();
if (!tsEntry || !useTypescript(tsEntry)) { console.log("refused TYPESCRIPT_NOT_FOUND"); process.exit(1); }
const { appendLock, RunError } = await import("../lib/planrun.ts");
try {
  if (cmd === "lock") {
    const r = appendLock(file);
    console.log(`locked set=${r.set} tasks=${r.tasks} sha256=${r.taskFileSha256}`);
  } else {
    const mod = await import(entry.module);
    const { code, rows } = mod[entry.run](file) as { code: string; rows: any[] };
    if (code !== "OK") { console.log(`refused ${code}`); process.exit(1); }
    const label = rows[0]?.set === "public" ? "devScore" : "score";
    for (const r of rows) {
      const g = r.grade;
      const id = r.set === "public" ? `${r.repo}@${r.commit!.slice(0, 10)}` : r.taskKey;
      console.log(`${id} ${r.code}` + (g ? ` ${label}=${g.score} work=${g.matched}/max(${g.required},${g.planned}) recall=${g.recall} precision=${g.precision} runTests=${g.runTests} files=${g.fileRecall}/${g.filePrecision} tests=${g.testRecall} canDo=${g.canDoVerified}/${g.canDoClaimed} own=${g.ownShare} team=${g.teamShare}` : ""));
    }
    const ok = rows.filter((r) => r.grade);
    const mean = (k: string) => (ok.length ? (ok.reduce((s, r) => s + r.grade[k], 0) / ok.length).toFixed(3) : "n/a");
    console.log(`planner=${entry.name} grader=${rows[0]?.grader ?? "n/a"} tasks=${rows.length} graded=${ok.length} mean ${label}=${mean("score")} runTests=${mean("runTests")} ownShare=${mean("ownShare")} teamShare=${mean("teamShare")}`);
  }
} catch (e) {
  console.log(`refused ${e instanceof RunError ? e.code : "TASK_FILE_INVALID"}`);
  process.exit(1);
}
