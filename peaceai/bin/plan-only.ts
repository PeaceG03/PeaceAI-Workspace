// PLAN-ONLY mode v1 CLI (see peaceai/spec/plan-only-v1.md).
//   tsx peaceai/bin/plan-only.ts lock <taskfile>   append the file's sha256 lock row to peaceai/plan/runs.jsonl
//   tsx peaceai/bin/plan-only.ts run  <taskfile> [--planner plan-only-v1|plan-only-v2]
//                                                  plan + grade every task of a file locked in the committed log
//                                                  (default planner plan-only-v1; see peaceai/spec/plan-only-v2.md)
// Prints codes and numbers only. For a hidden-set file it prints nothing that names a task.
// Works from any working directory and from a worktree with no node_modules: typescript (needed by the planner's
// parser) is taken from this repo root or else the main worktree, at the pinned version (see lib/tsresolve.ts).
import { typescriptEntry, useTypescript } from "../lib/tsresolve.ts";

const tsEntry = typescriptEntry();
if (!tsEntry || !useTypescript(tsEntry)) { console.log("refused TYPESCRIPT_NOT_FOUND"); process.exit(1); }
const { appendLock, runFile, RunError, PLANNERS } = await import("../lib/planrun.ts");

const [cmd, file, ...rest] = process.argv.slice(2);
const planner = rest.length === 0 ? "plan-only-v1" : rest.length === 2 && rest[0] === "--planner" ? rest[1] : null;
if (!file || (cmd !== "lock" && cmd !== "run") || !planner || !(PLANNERS as readonly string[]).includes(planner) || (cmd === "lock" && rest.length)) { console.log("usage: plan-only.ts lock|run <taskfile> [--planner plan-only-v1|plan-only-v2] (lock takes no option)"); process.exit(2); }
try {
  if (cmd === "lock") {
    const r = appendLock(file);
    console.log(`locked set=${r.set} tasks=${r.tasks} sha256=${r.taskFileSha256}`);
  } else {
    const { code, rows } = runFile(file, { planner: planner as (typeof PLANNERS)[number] });
    if (code !== "OK") { console.log(`refused ${code}`); process.exit(1); }
    // Public half: a DEVELOPMENT score (the planner was built while reading the public wording). Hidden half: the score.
    const label = rows[0]?.set === "public" ? "devScore" : "score";
    for (const r of rows) {
      const g = r.grade;
      const id = r.set === "public" ? `${r.repo}@${r.commit!.slice(0, 10)}` : r.taskKey;
      console.log(`${id} ${r.code}` + (g ? ` ${label}=${g.score} work=${g.matched}/max(${g.required},${g.planned}) recall=${g.recall} precision=${g.precision} runTests=${g.runTests} files=${g.fileRecall}/${g.filePrecision} tests=${g.testRecall} canDo=${g.canDoVerified}/${g.canDoClaimed} own=${g.ownShare} team=${g.teamShare}` : ""));
    }
    const ok = rows.filter((r) => r.grade);
    const mean = (k: "score" | "runTests" | "ownShare" | "teamShare") => (ok.length ? (ok.reduce((s, r) => s + r.grade![k], 0) / ok.length).toFixed(3) : "n/a");
    console.log(`planner=${planner} grader=${rows[0]?.grader ?? "n/a"} tasks=${rows.length} graded=${ok.length} mean ${label}=${mean("score")} runTests=${mean("runTests")} ownShare=${mean("ownShare")} teamShare=${mean("teamShare")}`);
  }
} catch (e) {
  console.log(`refused ${e instanceof RunError ? e.code : "TASK_FILE_INVALID"}`);
  process.exit(1);
}
