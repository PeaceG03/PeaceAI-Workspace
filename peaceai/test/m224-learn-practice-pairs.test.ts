// M224: practice skill-tree leaves and emit DEV-only training pairs.
// The fixture is a made-up box, not a practice task and not a reference diff.
// EXPERIMENTAL. credit is false; nothing here touches scoring.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { DEFAULT_PLANNER } from "../lib/plandefault.ts";
import type { ProgramMap } from "../lib/learnmap.ts";
import type { SkillTree } from "../lib/learntree.ts";
import { buildLearnPairs, readLearnPairs, writeLearnPairs } from "../lib/learnpairs.ts";
import {
  gapRows, heldOutSha, mergeNeedsTeaching, practiceProgram, programName, recheckPractice,
  type PracticeRun,
} from "../lib/learnpractice.ts";

const repoRoot = resolve(import.meta.dirname, "..", "..");
const fix = join(repoRoot, "peaceai/test/fixtures/learn/practice");
const tsx = join(repoRoot, "node_modules/.bin/tsx");
const frozen = () => 1_700_000_000_000;

function tree(): SkillTree {
  return {
    schema: "peaceai-learn-skill-tree:v1",
    experimental: true,
    credit: false,
    planner: DEFAULT_PLANNER,
    doable: [],
    missing: ["edit-existing-function"],
    nodes: [
      { id: "mod:src/box.ts", title: "fix src/box.ts", parent: null, children: ["fn:src/box.ts:dbl", "fn:src/box.ts:score"], size: "split", testIdea: null, reason: null, depth: 0, units: 2 },
      { id: "fn:src/box.ts:dbl", title: "fix dbl in src/box.ts", parent: "mod:src/box.ts", children: [], size: "leaf", testIdea: "call dbl and assert return n * n", reason: null, depth: 1, units: 1 },
      { id: "fn:src/box.ts:score", title: "fix score in src/box.ts", parent: "mod:src/box.ts", children: [], size: "leaf", testIdea: "call score and assert return n + 1", reason: null, depth: 1, units: 1 },
      { id: "fn:src/empty.ts:gone", title: "fix gone in src/empty.ts", parent: null, children: [], size: "leaf", testIdea: "call gone", reason: null, depth: 0, units: 1 },
      { id: "mod:src/wide.ts", title: "fix src/wide.ts", parent: null, children: [], size: "TOO_BIG_UNSPLIT", testIdea: null, reason: "still 9 behaviors at depth 5", depth: 5, units: 9 },
    ],
  };
}

function map(): ProgramMap {
  return {
    schema: "peaceai-learn-map:v1",
    experimental: true,
    credit: false,
    modules: [
      { path: "src/box.ts", exports: ["dbl", "score"], imports: [], summary: "Practice box." },
      { path: "src/empty.ts", exports: ["marker"], imports: [], summary: "No function." },
    ],
    edges: [],
    entryPoints: ["src/box.ts"],
    tests: [],
  };
}

function runPractice(seed = 1): PracticeRun {
  return practiceProgram({ tree: tree(), map: map(), repoPath: fix, seed, maxMinutes: 30, maxAttemptsTotal: 200, now: frozen });
}

test("held-out is sealed before attempts, a solved leaf is LEARNED, a short leaf and its parent are not", { timeout: 180_000 }, () => {
  const a = runPractice(1);
  const b = runPractice(1);
  assert.equal(JSON.stringify(a), JSON.stringify(b));
  assert.equal(a.credit, false);
  assert.equal(a.experimental, true);
  assert.equal(a.sealedBeforeAttempts, true);
  const score = a.nodes.find((n) => n.nodeId === "fn:src/box.ts:score");
  const dbl = a.nodes.find((n) => n.nodeId === "fn:src/box.ts:dbl");
  const parent = a.nodes.find((n) => n.nodeId === "mod:src/box.ts");
  assert.ok(score && dbl && parent);
  assert.ok(score.heldout.problems >= 4, `score held-out ${score.heldout.problems}`);
  assert.ok(score.heldout.passed / score.heldout.problems >= 0.75);
  assert.equal(score.status, "LEARNED");
  assert.ok(dbl.heldout.problems < 4);
  assert.notEqual(dbl.status, "LEARNED");
  assert.notEqual(parent.status, "LEARNED");
  const held = a.problems.filter((p) => p.nodeId === score.nodeId && p.set === "heldout");
  assert.equal(score.heldout.sha256, heldOutSha(held));
  const changed = held.map((p, i) => (i === 0 ? { ...p, test: `${p.test}// changed\n` } : p));
  assert.notEqual(heldOutSha(changed), score.heldout.sha256);
  assert.equal(a.problems.some((p) => p.set === "heldout" && a.problems.filter((q) => q.set === "dev").some((q) => q.test === p.test)), false);

  const built = buildLearnPairs(a, "practice");
  assert.equal(built.credit, false);
  const heldTests = a.problems.filter((p) => p.set === "heldout").map((p) => p.test);
  assert.ok(built.docs.length > 0);
  for (const d of built.docs) {
    assert.equal(d.split, "train");
    assert.ok(!heldTests.some((t) => d.text.includes(t)));
  }
  const heldP = a.problems.find((p) => p.set === "heldout")!;
  const planted: PracticeRun = structuredClone(a);
  planted.problems.push({
    ...heldP, id: "planted-near", set: "dev", solved: true, verified: true, fixed: heldP.original,
    test: "test(\"other\", () => { assert.equal(1, 1); });\n",
  });
  planted.problems.push({
    ...heldP, id: "planted-leak", set: "dev", solved: true, verified: true, fixed: "export function zz(n: number): number {\n  return n;\n}\n",
    original: "export function zz(n: number): number {\n  return n;\n}\n",
    broken: "export function zz(n: number): number {\n  return n; // person@gmail.com\n}\n",
    test: "test(\"zz only\", () => { assert.equal(1, 1); });\n",
    kind: "leak-plant", sourcePath: "src/zz.ts", function: "zz",
  });
  const flagged = buildLearnPairs(planted, "practice");
  assert.ok(flagged.dropped.nearDuplicate >= 1);
  assert.ok(flagged.dropped.leak >= 1);
  assert.ok(flagged.docs.every((d) => !d.text.includes(heldP.test)));

  const dir = mkdtempSync(join(tmpdir(), "peaceai-pairs-"));
  try {
    writeLearnPairs(dir, built);
    const rawDocs = readFileSync(join(dir, "docs.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    const rawMan = readFileSync(join(dir, "manifest.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    assert.deepEqual(Object.keys(rawDocs[0]).sort(), ["doc", "text"]);
    assert.deepEqual(Object.keys(rawMan[0]).sort(), ["doc", "function", "path", "repo", "sha", "split"]);
    const read = readLearnPairs(dir);
    assert.equal(read.length, built.docs.length);
    assert.equal(read[0]!.text, built.docs[0]!.text);
    assert.equal(read[0]!.function, built.docs[0]!.function);
    assert.equal(read[0]!.split, "train");
    const meta = JSON.parse(readFileSync(join(dir, "meta.json"), "utf8"));
    assert.equal(meta.credit, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  const program = programName(fix);
  const rows = gapRows(a, tree(), program, "2026-11-06");
  assert.ok(rows.some((r) => r.nodeId === "fn:src/empty.ts:gone"));
  assert.ok(rows.some((r) => r.nodeId === "mod:src/wide.ts"));
  const once = mergeNeedsTeaching("", rows);
  const twice = mergeNeedsTeaching(once, rows);
  assert.equal(twice, once);
  assert.equal(twice.trim().split("\n").length, rows.length);
});

test("budget stop writes every unfinished leaf as BUDGET_STOPPED and exits 0", () => {
  const stopped = practiceProgram({ tree: tree(), map: map(), repoPath: fix, seed: 1, maxMinutes: 30, maxAttemptsTotal: 0, now: frozen });
  assert.equal(stopped.budgetStopped, true);
  assert.equal(stopped.credit, false);
  const leaves = stopped.nodes.filter((n) => n.size === "leaf");
  assert.ok(leaves.length >= 3);
  for (const n of leaves) assert.equal(n.status, "BUDGET_STOPPED");
  const out = mkdtempSync(join(tmpdir(), "peaceai-budget-"));
  const treePath = join(out, "tree.json");
  const mapPath = join(out, "map.json");
  writeFileSync(treePath, JSON.stringify(tree()));
  writeFileSync(mapPath, JSON.stringify(map()));
  const dest = join(out, "out");
  const r = spawnSync(tsx, ["peaceai/bin/learn-practice.ts", "--repo", fix, "--tree", treePath, "--map", mapPath, "--out", dest, "--max-attempts-total", "0", "--today", "2026-11-06"], { cwd: repoRoot, encoding: "utf8" });
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  const written = JSON.parse(readFileSync(join(dest, "practice-results.json"), "utf8"));
  assert.equal(written.credit, false);
  assert.ok(written.nodes.some((n: { status: string }) => n.status === "BUDGET_STOPPED"));
  rmSync(out, { recursive: true, force: true });
});

test("learn-practice refuses to write inside the target repo", () => {
  const out = mkdtempSync(join(tmpdir(), "peaceai-refuse-"));
  const treePath = join(out, "tree.json");
  const mapPath = join(out, "map.json");
  writeFileSync(treePath, JSON.stringify(tree()));
  writeFileSync(mapPath, JSON.stringify(map()));
  const inside = join(fix, "sneak");
  const r = spawnSync(tsx, ["peaceai/bin/learn-practice.ts", "--repo", fix, "--tree", treePath, "--map", mapPath, "--out", inside], { cwd: repoRoot, encoding: "utf8" });
  assert.notEqual(r.status, 0);
  assert.match(`${r.stdout}${r.stderr}`, /refused WRITE_IN_TARGET/);
  rmSync(out, { recursive: true, force: true });
});

test("recheck demotes a learned leaf and its parent when the new rate drops", { timeout: 180_000 }, () => {
  const only: SkillTree = {
    ...tree(),
    nodes: [
      { id: "mod:src/box.ts", title: "fix src/box.ts", parent: null, children: ["fn:src/box.ts:score"], size: "split", testIdea: null, reason: null, depth: 0, units: 1 },
      { id: "fn:src/box.ts:score", title: "fix score in src/box.ts", parent: "mod:src/box.ts", children: [], size: "leaf", testIdea: "call score and assert return n + 1", reason: null, depth: 1, units: 1 },
    ],
  };
  const prior = practiceProgram({ tree: only, map: map(), repoPath: fix, seed: 1, now: frozen });
  const leaf = prior.nodes.find((n) => n.nodeId === "fn:src/box.ts:score")!;
  const parent = prior.nodes.find((n) => n.nodeId === "mod:src/box.ts")!;
  assert.equal(leaf.status, "LEARNED");
  assert.equal(parent.status, "LEARNED");
  const oldHeld = JSON.stringify(prior.problems.filter((p) => p.set === "heldout"));
  const oldSha = leaf.heldout.sha256;
  const copy = mkdtempSync(join(tmpdir(), "peaceai-recheck-"));
  mkdirSync(join(copy, "src"));
  writeFileSync(join(copy, "src/box.ts"), `export function score(n: number): number {\n  if (n > 0 && n > 1) return n + 1;\n  if (n < 0) return n - 1;\n  return n * 2 + 0;\n}\n`);
  const again = recheckPractice(prior, { tree: only, map: map(), repoPath: copy, seed: 1, now: frozen, today: "2026-11-06" });
  const leaf2 = again.nodes.find((n) => n.nodeId === "fn:src/box.ts:score")!;
  const parent2 = again.nodes.find((n) => n.nodeId === "mod:src/box.ts")!;
  assert.equal(leaf2.status, "PRACTICING");
  assert.notEqual(parent2.status, "LEARNED");
  assert.equal(leaf2.heldout.sha256, oldSha);
  assert.equal(JSON.stringify(again.problems.filter((p) => p.set === "heldout")), oldHeld);
  assert.equal(again.rechecks.length, 1);
  assert.ok(again.rechecks[0]!.newRate < 0.75);
  assert.ok(again.rechecks[0]!.oldRate >= 0.75);
  assert.equal(again.rechecks[0]!.demoted, true);
  assert.equal(again.rechecks[0]!.at, "2026-11-06");
  rmSync(copy, { recursive: true, force: true });
});

test("from-history builds a problem from a two-commit repo, and HISTORY_NONE without history", { timeout: 180_000 }, () => {
  const dir = mkdtempSync(join(tmpdir(), "peaceai-hist-"));
  const bare = mkdtempSync(join(tmpdir(), "peaceai-nohist-"));
  try {
    mkdirSync(join(dir, "src"));
    const git = (...a: string[]) => execFileSync("git", ["-C", dir, ...a], { encoding: "utf8" });
    git("init");
    git("config", "user.email", "test@example.com");
    git("config", "user.name", "test");
    writeFileSync(join(dir, "src/box.ts"), "export function score(n: number): number {\n  return n + 1;\n}\n");
    git("add", "src/box.ts");
    git("commit", "-m", "start");
    writeFileSync(join(dir, "src/box.ts"), "export function score(n: number): number {\n  return n + 2;\n}\n");
    git("add", "src/box.ts");
    git("commit", "-m", "fix score");
    const only: SkillTree = {
      ...tree(),
      nodes: [
        { id: "fn:src/box.ts:score", title: "fix score in src/box.ts", parent: null, children: [], size: "leaf", testIdea: "call score", reason: null, depth: 0, units: 1 },
      ],
    };
    const histMap: ProgramMap = { ...map(), modules: [{ path: "src/box.ts", exports: ["score"], imports: [], summary: "History box." }], tests: [] };
    const used = practiceProgram({ tree: only, map: histMap, repoPath: dir, seed: 1, fromHistory: true, now: frozen });
    assert.equal(used.history, "USED");
    assert.ok(used.problems.some((p) => p.fromHistory));
    const none = practiceProgram({ tree: only, map: histMap, repoPath: bare, seed: 1, fromHistory: true, now: frozen, maxAttemptsTotal: 0 });
    assert.equal(none.history, "HISTORY_NONE");
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(bare, { recursive: true, force: true });
  }
});
