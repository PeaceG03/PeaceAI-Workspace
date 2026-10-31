// PLAN-ONLY mode v3 CLI (planner plan-only-v3, see peaceai/spec/plan-only-v3.md).
//   tsx peaceai/bin/plan-only-v3.ts run <taskfile>   plan (v3) + grade every task of a file locked in the committed log
// EXPERIMENTAL: v1 (bin/plan-only.ts) stays the default. Locking stays with v1's CLI (tsx peaceai/bin/plan-only.ts lock
// <taskfile>); a file locked once serves every planner. v1's and v2's CLIs and runners are untouched.
// Prints codes and numbers only. For a hidden-set file it prints nothing that names a task.
import { typescriptEntry, useTypescript } from "../lib/tsresolve.ts";

const tsEntry = typescriptEntry();
if (!tsEntry || !useTypescript(tsEntry)) { console.log("refused TYPESCRIPT_NOT_FOUND"); process.exit(1); }
const { RunError } = await import("../lib/planrun.ts");
const { runFileV3 } = await import("../lib/plan3run.ts");

const [cmd, file, ...rest] = process.argv.slice(2);
if (cmd !== "run" || !file || rest.length) { console.log("usage: plan-only-v3.ts run <taskfile>"); process.exit(2); }
try {
  const { code, rows } = runFileV3(file);
  if (code !== "OK") { console.log(`refused ${code}`); process.exit(1); }
  // Public half: a DEVELOPMENT score (v3 was checked against it, not proof of generalization). Hidden half: the score.
  const label = rows[0]?.set === "public" ? "devScore" : "score";
  for (const r of rows) {
    const g = r.grade;
    const id = r.set === "public" ? `${r.repo}@${r.commit!.slice(0, 10)}` : r.taskKey;
    console.log(`${id} ${r.code}` + (g ? ` ${label}=${g.score} work=${g.matched}/max(${g.required},${g.planned}) recall=${g.recall} precision=${g.precision} runTests=${g.runTests} files=${g.fileRecall}/${g.filePrecision} tests=${g.testRecall} canDo=${g.canDoVerified}/${g.canDoClaimed} own=${g.ownShare} team=${g.teamShare}` : ""));
  }
  const ok = rows.filter((r) => r.grade);
  const mean = (k: "score" | "runTests" | "ownShare" | "teamShare") => (ok.length ? (ok.reduce((s, r) => s + r.grade![k], 0) / ok.length).toFixed(3) : "n/a");
  console.log(`planner=${rows[0]?.planner ?? "plan-only-v3"} grader=${rows[0]?.grader ?? "n/a"} tasks=${rows.length} graded=${ok.length} mean ${label}=${mean("score")} runTests=${mean("runTests")} ownShare=${mean("ownShare")} teamShare=${mean("teamShare")}`);
} catch (e) {
  console.log(`refused ${e instanceof RunError ? e.code : "TASK_FILE_INVALID"}`);
  process.exit(1);
}
