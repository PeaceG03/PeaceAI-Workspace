// M50: grade predictions for the set C v2 tasks. Usage: setc-grade.ts <predictions.jsonl> [EXT_DIR]
// Prints aggregate counts only. Unwired: no workflow calls this until the Architect decides.
import { readFileSync } from "node:fs";
import { gradeAll, type CTask } from "../lib/setc-grade.ts";
const T = JSON.parse(readFileSync(new URL("../model/heldout-c-tasks.json", import.meta.url), "utf8")).tasks as CTask[];
const ext = process.argv[3] ?? process.env.EXT_DIR ?? "/workspace/ext";
const preds = readFileSync(process.argv[2]!, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
const { summary } = gradeAll(T, (t) => readFileSync(`${ext}/${t.repo.replace("/", "__")}/${t.path}`, "utf8"), preds);
console.log(JSON.stringify(summary));
