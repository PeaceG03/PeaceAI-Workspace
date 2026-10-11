// M9 gap-fill job (flag PEACEAI_LM_FILL, off by default). Reads the task and the public target, asks the
// verified model to choose the gap's value among the template's options, and writes fills.json for Job A.
// Writes nothing (no fill) when the flag is off, the task has no gap, or the model is not verified.
// Prints counts only.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { FILLS_SCHEMA, fillHole, fillKey, fillOptions, parseFillTask } from "../lib/fill.ts";
import { lmFlags, lmJobAllowed, runInfer, verifyModelDir } from "../lib/lm.ts";
import { loadTargets, scopeOf } from "../lib/target.ts";
import { cleanIssueText } from "../lib/taskmap.ts";

const done = (why: string) => { console.log(`lm-fill ${why}`); process.exit(0); };
if (!lmFlags(process.env).fill) done("off");
if (!lmJobAllowed(process.env)) done("refused=LM_JOB_REFUSED");
const modelDir = resolve(process.env.PEACEAI_LM_MODEL_DIR ?? "");
const v = verifyModelDir(modelDir);
if (!v.ok) done(`refused=${v.reason}`);
const issue = JSON.parse(readFileSync(resolve(process.env.ISSUE_JSON ?? ""), "utf8"));
const task = parseFillTask(cleanIssueText({ title: String(issue.title ?? ""), body: String(issue.body ?? "") }));
if (!task) done("no-gap");
const repo = resolve(process.env.PEACEAI_WORKSPACE_DIR ?? process.cwd());
const targets = loadTargets();
const scope = scopeOf(targets.targets[process.env.PEACEAI_TARGET || targets.default]!);
const files = execFileSync("git", ["ls-files", "-z"], { cwd: repo, encoding: "utf8" }).split("\0").filter((p) => p && scope.isSource(p) && !scope.isDenied(p))
  .map((path) => ({ path, content: readFileSync(join(repo, path), "utf8") }));
const target = files.find((f) => f.path === task!.path);
const hole = target ? fillHole(task!, target.content) : null;
if (!hole) done("no-hole");
const options = fillOptions(task!, files);
const r = runInfer("fill", modelDir, { holes: [{ key: fillKey(task!), prefix: hole!.prefix, suffix: hole!.suffix, options }] });
if (!r.ok || r.response.model !== (v as { version: string }).version) done(`refused=${r.ok ? "MODEL_MISMATCH" : r.reason}`);
const best = (r as { response: { fills: { best: string | null }[] } }).response.fills[0]?.best;
if (!best || !options.includes(best)) done("no-choice");
writeFileSync(resolve(process.env.PEACEAI_FILLS_OUT ?? "fills.json"), JSON.stringify({ schema: FILLS_SCHEMA, key: fillKey(task!), model: (v as { version: string }).version, value: best, options: options.length }) + "\n");
done(`filled options=${options.length}`);
