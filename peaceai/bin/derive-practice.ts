// M100: run the DERIVE_FROM_BEHAVIOR practice tasks (peaceai/lib/derive-practice.ts) at scale, on the CPU only.
// Usage: tsx peaceai/bin/derive-practice.ts [--seed 100] [--count 5000] [--jobs 8] [--ask-rounds 3] [--budget N]
//          [--family active|all|<name,...>] [--slice j/n] [--no-fail] [--cells N] [--only <category substring>] [--out derive-practice.json] [--findings findings.json] [--engine sha]
// Task i is category i mod the category count, so every category gets the same share. Shards run as child processes
// (task i in shard i mod jobs) and append one JSON line per graded task to <out>.parts/<shard>.jsonl, so a run cut
// off part-way resumes where it stopped (same seed and options). The report: per-category right / wrong / refused,
// refusal reasons, the questions graded against the truth, the ask loop; every wrong accepted program in the derive
// mistakes ledger's shape (peaceai-derive-mistakes:v1). Exit 1 when a wrong program outside the known limit was accepted.
import { spawn, execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { cpus } from "node:os";
import { fileURLToPath } from "node:url";
import { familyCategories, gradeTask, ledgerEntry, practiceTask, PRACTICE_SCHEMA, tally, type PracticeGrade } from "../lib/derive-practice.ts";

const argv = process.argv.slice(2);
const opt = (name: string, dflt: string) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1]! : dflt; };
const seed = Number(opt("seed", "100")), count = Number(opt("count", "5000")), jobs = Math.max(1, Number(opt("jobs", String(Math.min(8, cpus().length)))));
const askRounds = Number(opt("ask-rounds", "3")), budget = Number(opt("budget", "0")) || undefined, cells = Number(opt("cells", "0")) || undefined;
const only = opt("only", ""), out = opt("out", "derive-practice.json"), findings = opt("findings", ""), shard = opt("shard", "");
// --family: a family name, a comma list, "active" (default: what CI grades) or "all" (peaceai/lib/derive-practice-families.json).
// --slice j/n: grade only tasks i with i mod n = j (a CI matrix shard; task i is the same task in every slicing).
const family = opt("family", "active"), slice = opt("slice", "");
const [sliceJ, sliceN] = slice ? (slice.split("/").map(Number) as [number, number]) : [0, 1];
if (!(sliceN >= 1 && sliceJ >= 0 && sliceJ < sliceN)) { console.error(`bad --slice ${slice}`); process.exit(2); }
const cats = familyCategories(family).filter((c) => !only || `${c.form.name}/${c.mode}`.includes(only));
if (!cats.length) { console.error(`no category matches ${only}`); process.exit(2); }
const partsDir = `${out}.parts`;
const runKey = JSON.stringify({ seed, count, askRounds, budget: budget ?? null, cells: cells ?? null, only, family, slice });

if (shard) {
  // A child: grade every task of this shard not already in its part file.
  const [j, n] = shard.split("/").map(Number) as [number, number];
  const file = `${partsDir}/${j}.jsonl`;
  const done = new Set(existsSync(file) ? readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => (JSON.parse(l) as PracticeGrade).index) : []);
  // The slice's tasks (i = sliceJ + k * sliceN) are dealt to the shards by k, so every shard gets a share.
  appendFileSync(file, "");
  for (let k = j; sliceJ + k * sliceN < count; k += n) {
    const i = sliceJ + k * sliceN;
    if (done.has(i)) continue;
    const g = gradeTask(practiceTask(seed, i, cats), { budget, maxKeptCells: cells, askRounds });
    appendFileSync(file, JSON.stringify(g) + "\n");
  }
  process.exit(0);
}

const t0 = Date.now();
mkdirSync(partsDir, { recursive: true });
const keyFile = `${partsDir}/run.json`;
if (existsSync(keyFile) && readFileSync(keyFile, "utf8") !== runKey) { console.error(`${partsDir} holds a run with other options (${readFileSync(keyFile, "utf8")}); use another --out`); process.exit(2); }
writeFileSync(keyFile, runKey);
// A resumed run keeps its shard count (task i lives in part i mod jobs).
const existing = readdirSync(partsDir).filter((f) => /^\d+\.jsonl$/.test(f)).length;
const nj = existing || jobs;
const self = fileURLToPath(import.meta.url);
const pass = argv.filter((_, k) => !["--jobs", "--shard"].includes(argv[k]!) && !["--jobs", "--shard"].includes(argv[k - 1]!));
await Promise.all(Array.from({ length: nj }, (_, j) => new Promise<void>((res, rej) => {
  const c = spawn(process.execPath, [...process.execArgv, self, ...pass, "--shard", `${j}/${nj}`], { stdio: ["ignore", "inherit", "inherit"] });
  c.on("exit", (code) => (code === 0 ? res() : rej(new Error(`shard ${j} exited ${code}`))));
})));
const grades: PracticeGrade[] = [];
for (let j = 0; j < nj; j++) for (const l of readFileSync(`${partsDir}/${j}.jsonl`, "utf8").split("\n")) if (l) grades.push(JSON.parse(l));
grades.sort((a, b) => a.index - b.index);
let engine = opt("engine", "");
if (!engine) try { engine = execFileSync("git", ["rev-parse", "--short=12", "HEAD"], { cwd: new URL("../..", import.meta.url).pathname, encoding: "utf8" }).trim(); } catch { engine = "unknown"; }
const table = tally(grades);
const wrong = grades.filter((g) => g.outcome === "wrong");
const blocking = wrong.filter((g) => !g.knownLimit);
const entry = (g: PracticeGrade) => ledgerEntry(practiceTask(seed, g.index, cats), g, engine, seed);
const afterAskAll = grades.filter((g) => g.ask?.outcome === "wrong").map((g) => {
  const t = practiceTask(seed, g.index, cats);
  const e = ledgerEntry({ ...t, examples: g.ask!.examples!.map((r) => ({ args: r.slice(0, -1), out: r[r.length - 1]! })) }, { ...g, expr: g.ask!.expr, wrongAt: [g.ask!.wrongAt!], where: g.ask!.where, knownLimit: !!g.ask!.knownLimit }, engine, seed);
  return { ...e, id: `${e.id}-after-ask`, why: `${t.why}; after ${g.ask!.rounds} round(s) of questions answered from the truth` };
});
const afterAsk = afterAskAll.filter((e) => !e.practice.knownLimit);
const totals = { tasks: grades.length, right: 0, wrong: 0, refused: 0, wrongBlocking: blocking.length, wrongKnownLimit: wrong.length - blocking.length, wrongAfterAsk: afterAsk.length, wrongAfterAskKnownLimit: afterAskAll.length - afterAsk.length, unsafe: grades.filter((g) => g.unsafe).length };
for (const g of grades) totals[g.outcome]++;
const report = { schema: PRACTICE_SCHEMA, engine, seed, count, family, slice: `${sliceJ}/${sliceN}`, jobs: nj, askRounds, budget: budget ?? "engine default", cells: cells ?? "engine default", runtimeMs: Date.now() - t0, totals, categories: table, wrongAccepted: blocking.map(entry), knownLimitWrong: wrong.filter((g) => g.knownLimit).map(entry), wrongAfterAsk: afterAsk };
writeFileSync(out, JSON.stringify(report, null, 1) + "\n");
if (findings) writeFileSync(findings, JSON.stringify({ schema: "peaceai-derive-mistakes:v1", source: `m100 derive-practice seed ${seed}, ${grades.length} tasks, engine ${engine}`, entries: report.wrongAccepted, afterAsk: report.wrongAfterAsk, knownLimit: report.knownLimitWrong }, null, 1) + "\n");
const pad = (s: string | number, n: number) => String(s).padStart(n);
console.log(`| category | tasks | right | wrong (inside / past / known limit) | refused | refused with question | truth in answers / asked | after asking: right / wrong / refused / stuck |`);
console.log(`|---|---:|---:|---:|---:|---:|---:|---|`);
for (const [k, c] of Object.entries(table)) console.log(`| ${k} | ${c.tasks} | ${c.right} | ${c.wrong} (${c.wrongInside} / ${c.wrongPast} / ${c.wrongKnownLimit}) | ${c.refused} | ${c.withQuestions} | ${c.truthInAnswers} / ${c.questions} | ${c.ask.right ?? 0} / ${c.ask.wrong ?? 0} / ${c.ask.refused ?? 0} / ${c.ask.stuck ?? 0} |`);
console.log(`| **total** | ${totals.tasks} | ${totals.right} | ${totals.wrong} | ${totals.refused} | | | |`);
console.log(`wrong accepted (blocking): ${blocking.length}; known-limit wrong: ${totals.wrongKnownLimit}; wrong after asking: ${afterAsk.length} (+${afterAskAll.length - afterAsk.length} known limit); unsafe expressions: ${totals.unsafe}; runtime ${pad(((Date.now() - t0) / 1000).toFixed(1), 1)} s; report ${out}`);
process.exit(blocking.length && !argv.includes("--no-fail") ? 1 : 0);
