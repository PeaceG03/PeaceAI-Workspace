// EXPERIMENTAL. credit: false. Reads a repo and writes a program map + skill tree NEXT TO it, never inside it.
//   tsx peaceai/bin/learn.ts <repo-path> [--out <dir>]
// --out defaults to ./learn-out from the current directory. Refuses when that directory is the repo or inside it.
import { existsSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, dirname, sep } from "node:path";
import { typescriptEntry, useTypescript } from "../lib/tsresolve.ts";

const USAGE = "usage: learn.ts <repo-path> [--out <dir>]";

function existingAncestor(path: string): { base: string; rest: string[] } {
  const rest: string[] = [];
  let cur = resolve(path);
  while (!existsSync(cur)) {
    const parent = dirname(cur);
    if (parent === cur) break;
    rest.push(cur.slice(parent.length + 1));
    cur = parent;
  }
  return { base: cur, rest: rest.reverse() };
}

/** True when `target` is `root` or a path inside it, after realpath (symlink-safe). */
export function insideRepo(root: string, target: string): boolean {
  const repo = realpathSync(resolve(root));
  const anc = existingAncestor(target);
  const base = realpathSync(anc.base);
  const full = anc.rest.length ? resolve(base, ...anc.rest) : base;
  const rel = relative(repo, full);
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !rel.startsWith("..") && !isAbsolute(rel));
}

const args = process.argv.slice(2);
let outFlag: string | undefined;
const pos: string[] = [];
for (let i = 0; i < args.length; i++) {
  const a = args[i]!;
  if (a === "--out") { outFlag = args[++i]; continue; }
  if (a.startsWith("--out=")) { outFlag = a.slice("--out=".length); continue; }
  pos.push(a);
}
const repoArg = pos[0];
if (!repoArg || pos.length !== 1 || outFlag === "") { console.log(USAGE); process.exit(2); }
if (!existsSync(repoArg)) { console.log("refused NOT_A_DIRECTORY"); process.exit(2); }

const out = resolve(outFlag ?? resolve(process.cwd(), "learn-out"));
if (insideRepo(repoArg, out)) { console.log("refused WRITE_IN_TARGET"); process.exit(2); }

const tsEntry = typescriptEntry();
if (!tsEntry || !useTypescript(tsEntry)) { console.log("refused TYPESCRIPT_NOT_FOUND"); process.exit(1); }

const { learnRepo } = await import("../lib/learntree.ts");
const { checkMap } = await import("../lib/learnmap.ts");
const { publishLearnFiles, LearnRefuse } = await import("../lib/learnpractice.ts");
let learned: ReturnType<typeof learnRepo>;
try { learned = learnRepo(repoArg); } catch { console.log("refused NOT_A_DIRECTORY"); process.exit(2); }
const check = checkMap(learned.map, repoArg);
try {
  publishLearnFiles(repoArg, [
    { path: resolve(out, "program-map.json"), data: `${JSON.stringify(learned.map, null, 2)}\n` },
    { path: resolve(out, "skill-tree.json"), data: `${JSON.stringify(learned.tree, null, 2)}\n` },
    { path: resolve(out, "learn-tree.txt"), data: learned.outline },
  ]);
} catch (e) {
  if (e instanceof LearnRefuse) { console.log(`refused ${e.code}`); process.exit(2); }
  throw e;
}
console.log(`experimental credit=false planner=${learned.tree.planner}`);
console.log(`map modules=${learned.map.modules.length} edges=${learned.map.edges.length} tests=${learned.map.tests.length} trusted=${check.wrong.length === 0 && check.asked > 0 ? "yes" : "no"} asked=${check.asked} correct=${check.correct}`);
console.log(`tree nodes=${learned.tree.nodes.length} leaves=${learned.tree.nodes.filter((n) => n.size === "leaf").length} unsplittable=${learned.tree.nodes.filter((n) => n.size === "TOO_BIG_UNSPLIT").length}`);
console.log("wrote program-map.json skill-tree.json learn-tree.txt");
if (check.wrong.length !== 0 || check.asked === 0) {
  console.log(`untrusted asked=${check.asked} correct=${check.correct} first=${check.wrong[0]?.id ?? "none"}`);
  process.exit(1);
}
