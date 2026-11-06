// EXPERIMENTAL. credit: false. Practices a skill tree outside the target repo. Never writes inside it.
//   tsx peaceai/bin/learn-practice.ts --repo <path> --tree <skill-tree.json> --map <program-map.json>
//     [--out <dir>] [--seed N] [--max-minutes N] [--max-attempts-total N] [--from-history] [--recheck] [--today YYYY-MM-DD]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { insideRepo, LearnRefuse } from "../lib/learnpractice.ts";

const USAGE = "usage: learn-practice.ts --repo <path> --tree <skill-tree.json> --map <program-map.json> [--out <dir>] [--seed N] [--max-minutes N] [--max-attempts-total N] [--from-history] [--recheck] [--today YYYY-MM-DD]";

const args = process.argv.slice(2);
const flag = new Set<string>();
const opt = new Map<string, string>();
for (let i = 0; i < args.length; i++) {
  const a = args[i]!;
  if (a === "--from-history" || a === "--recheck") { flag.add(a); continue; }
  if (a.startsWith("--")) {
    const key = a.slice(2);
    const v = args[++i];
    if (!v || v.startsWith("--")) { console.log(USAGE); process.exit(2); }
    opt.set(key, v);
  }
}
const repo = opt.get("repo");
const treePath = opt.get("tree");
const mapPath = opt.get("map");
if (!repo || !treePath || !mapPath || !existsSync(repo)) { console.log(repo && !existsSync(repo) ? "refused NOT_A_DIRECTORY" : USAGE); process.exit(2); }
const out = resolve(opt.get("out") ?? resolve(process.cwd(), "learn-practice-out"));
if (insideRepo(repo, out)) { console.log("refused WRITE_IN_TARGET"); process.exit(2); }

const num = (key: string, dflt: number) => {
  const v = opt.get(key);
  if (v === undefined) return dflt;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) { console.log(USAGE); process.exit(2); }
  return n;
};

const { practiceProgram, recheckPractice, renderProgress, gapRows, mergeNeedsTeaching, programName } = await import("../lib/learnpractice.ts");
const { buildLearnPairs, writeLearnPairs } = await import("../lib/learnpairs.ts");
const { readFileSync: read, existsSync: exists } = await import("node:fs");

let tree: ReturnType<typeof JSON.parse>;
let map: ReturnType<typeof JSON.parse>;
try {
  tree = JSON.parse(readFileSync(treePath, "utf8"));
  map = JSON.parse(readFileSync(mapPath, "utf8"));
} catch {
  console.log("refused BAD_INPUT");
  process.exit(2);
}

const today = opt.get("today") ?? new Date().toISOString().slice(0, 10);
const base = {
  tree, map, repoPath: repo, seed: num("seed", 1), maxMinutes: num("max-minutes", 30),
  maxAttemptsTotal: num("max-attempts-total", 200), fromHistory: flag.has("--from-history"), outPath: out, today,
};

let run;
try {
  if (flag.has("--recheck")) {
    const priorPath = resolve(out, "practice-results.json");
    if (!exists(priorPath)) { console.log("refused NO_PRIOR_RESULTS"); process.exit(2); }
    const prior = JSON.parse(read(priorPath, "utf8"));
    run = recheckPractice(prior, base);
  } else {
    run = practiceProgram(base);
  }
} catch (e) {
  if (e instanceof LearnRefuse) { console.log(`refused ${e.code}`); process.exit(2); }
  throw e;
}

mkdirSync(out, { recursive: true });
writeFileSync(resolve(out, "practice-results.json"), `${JSON.stringify(run, null, 2)}\n`);
writeFileSync(resolve(out, "learn-progress.txt"), renderProgress(run));
const gaps = gapRows(run, tree, programName(repo), today);
const prevGaps = existsSync(resolve(out, "needs-teaching.jsonl")) ? readFileSync(resolve(out, "needs-teaching.jsonl"), "utf8") : "";
writeFileSync(resolve(out, "needs-teaching.jsonl"), mergeNeedsTeaching(prevGaps, gaps));
const pairs = buildLearnPairs(run, programName(repo));
writeLearnPairs(resolve(out, "pairs"), pairs);
const learned = run.nodes.filter((n) => n.status === "LEARNED").length;
console.log(`experimental credit=false history=${run.history} budgetStopped=${run.budgetStopped}`);
console.log(`nodes=${run.nodes.length} learned=${learned} attempts=${run.attemptsUsed} minutes=${run.minutesUsed} pairs=${pairs.docs.length} dropped_leak=${pairs.dropped.leak} dropped_near=${pairs.dropped.nearDuplicate}`);
console.log("wrote practice-results.json learn-progress.txt needs-teaching.jsonl pairs/docs.jsonl pairs/manifest.jsonl");
process.exit(0);
