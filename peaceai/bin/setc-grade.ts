// M50: grade predictions for the set C v2 tasks. Usage: setc-grade.ts <predictions.jsonl> [EXT_DIR]
// Prints aggregate counts only. Unwired: no workflow calls this until the Architect decides.
import { readFileSync } from "node:fs";
import { gradeAll, declaredCount, type CTask } from "../lib/setc-grade.ts";
const L = JSON.parse(readFileSync(new URL("../model/heldout-c-tasks.json", import.meta.url), "utf8"));
const T = L.tasks as CTask[];
const N = declaredCount(L);
if (N !== 138 || T.length !== N) throw new Error(`task list has ${T.length} tasks, declares ${N}, expected 138`);
const ext = process.argv[3] ?? process.env.EXT_DIR ?? "/workspace/ext";
const preds = readFileSync(process.argv[2]!, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
const { summary } = gradeAll(T, (t) => readFileSync(`${ext}/${t.repo.replace("/", "__")}/${t.path}`, "utf8"), preds, N);
console.log(JSON.stringify(summary));
