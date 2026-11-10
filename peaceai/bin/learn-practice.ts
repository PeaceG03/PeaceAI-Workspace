// EXPERIMENTAL. credit: false. Practices a skill tree outside the target repo. Never writes inside it.
//   tsx peaceai/bin/learn-practice.ts --repo <path> --tree <skill-tree.json> --map <program-map.json>
//     [--out <dir>] [--seed N] [--max-minutes N] [--max-attempts-total N] [--from-history] [--recheck] [--today YYYY-MM-DD]
import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { insideRepo, LearnRefuse, prepareOutDir, safeWriteFile } from "../lib/learnpractice.ts";

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
if (!repo || !treePath || !mapPath || !existsSync(repo) || !statSync(repo).isDirectory()) { console.log(repo && existsSync(repo) && !statSync(repo).isDirectory() ? "refused NOT_A_DIRECTORY" : repo && !existsSync(repo) ? "refused NOT_A_DIRECTORY" : USAGE); process.exit(2); }
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

const todayRaw = opt.get("today") ?? new Date().toISOString().slice(0, 10);
if (!/^\d{4}-\d{2}-\d{2}$/.test(todayRaw)) { console.log(USAGE); process.exit(2); }
const today = todayRaw;
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
  prepareOutDir(repo, out);
  safeWriteFile(repo, resolve(out, "practice-results.json"), `${JSON.stringify(run, null, 2)}\n`);
  safeWriteFile(repo, resolve(out, "learn-progress.txt"), renderProgress(run));
  const gaps = gapRows(run, tree, programName(repo), today);
  const gapPath = resolve(out, "needs-teaching.jsonl");
  const prevGaps = exists(gapPath) ? readFileSync(gapPath, "utf8") : "";
  safeWriteFile(repo, gapPath, mergeNeedsTeaching(prevGaps, gaps));
  const { checkMap } = await import("../lib/learnmap.ts");
  let mapTrusted = false;
  try {
    const checked = checkMap(map, repo);
    mapTrusted = checked.wrong.length === 0 && checked.asked > 0;
  } catch {
    mapTrusted = false;
  }
  if (run.mapTrusted === false) mapTrusted = false;
  const pairs = buildLearnPairs(run, programName(repo), { eligible: mapTrusted });
  writeLearnPairs(resolve(out, "pairs"), pairs, repo);
  const learned = run.nodes.filter((n: { status: string }) => n.status === "LEARNED").length;
  const heldPassed = run.nodes.reduce((s: number, n: { heldout: { passed: number } }) => s + n.heldout.passed, 0);
  const heldRows = run.nodes.reduce((s: number, n: { heldout: { problems: number } }) => s + n.heldout.problems, 0);
  console.log(`experimental credit=false history=${run.history} budgetStopped=${run.budgetStopped} mapTrusted=${mapTrusted} heldoutProof=${run.heldoutProof === true}`);
  console.log(`nodes=${run.nodes.length} learned=${learned} attempts=${run.attemptsUsed} minutes=${run.minutesUsed} heldout=${heldPassed}/${heldRows} pairs=${pairs.docs.length} eligible=${pairs.eligible} dropped_leak=${pairs.dropped.leak} dropped_near=${pairs.dropped.nearDuplicate}`);
  console.log("wrote practice-results.json learn-progress.txt needs-teaching.jsonl pairs/docs.jsonl pairs/manifest.jsonl");
} catch (e) {
  if (e instanceof LearnRefuse) { console.log(`refused ${e.code}`); process.exit(2); }
  throw e;
}
process.exit(0);
