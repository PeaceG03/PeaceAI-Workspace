// M224: practice skill-tree leaves and emit DEV-only training pairs.
// Inputs are generated in a temp directory. They are not practice tasks, reference diffs, or third-party fixtures.
// EXPERIMENTAL. credit is false; nothing here touches scoring.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { DEFAULT_PLANNER } from "../lib/plandefault.ts";
import type { ProgramMap } from "../lib/learnmap.ts";
import type { SkillTree } from "../lib/learntree.ts";
import { buildLearnPairs, readLearnPairs, writeLearnPairs } from "../lib/learnpairs.ts";
import { RETRY_MAX_ATTEMPTS } from "../lib/repair-retry.ts";
import {
  gapRows, hasSymlinkComponent, heldOutSha, insideRepo, leafStatus, LearnRefuse, mergeNeedsTeaching,
  practiceProgram, practiceSealOk, programName, recheckPractice, safeWriteFile, scoreHeldOut,
  shouldDemote, splitProblems, withParentStatus,
  type NodeResult, type PracticeProblem, type PracticeRun,
} from "../lib/learnpractice.ts";

const repoRoot = resolve(import.meta.dirname, "..", "..");
const tsx = join(repoRoot, "node_modules/.bin/tsx");
const frozen = () => 1_700_000_000_000;
const SECRET = "PEACEAI_LEARN_SENTINEL_SECRET_9f3c";
const SENTINEL = "/tmp/peaceai-learn-pwn-sentinel";

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

function makeBox(dir: string): void {
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(join(dir, "src/box.ts"), "/** Adds one to a number. */\nexport function score(n: number): number {\n  return n + 1;\n}\n\n/** Squares a number. */\nexport function dbl(n: number): number {\n  return n * n;\n}\n");
  writeFileSync(join(dir, "src/empty.ts"), "/** A module with no function, so its leaf cannot be practiced. */\nexport const marker = 1;\n");
}

function runPractice(repo: string, seed = 1): PracticeRun {
  return practiceProgram({ tree: tree(), map: map(), repoPath: repo, seed, maxMinutes: 30, maxAttemptsTotal: 200, now: frozen });
}

function problem(over: Partial<PracticeProblem>): PracticeProblem {
  return {
    id: over.id ?? "p", nodeId: over.nodeId ?? "fn:src/box.ts:score", set: over.set ?? "dev", kind: over.kind ?? "k",
    sourcePath: over.sourcePath ?? "src/box.ts", function: over.function ?? "score",
    broken: over.broken ?? "export function score(n: number): number {\n  return n - 1;\n}\n",
    original: over.original ?? "export function score(n: number): number {\n  return n + 1;\n}\n",
    fixed: over.fixed === undefined ? over.original ?? "export function score(n: number): number {\n  return n + 1;\n}\n" : over.fixed,
    test: over.test ?? "test(\"score holds\", () => { assert.equal(score(1), 2); });\n",
    fromHistory: over.fromHistory ?? false, historySha: over.historySha ?? null,
    solved: over.solved ?? true, verified: over.verified ?? true, attempts: over.attempts ?? 1, reasonCodes: over.reasonCodes ?? [],
  };
}

function node(over: Partial<NodeResult>): NodeResult {
  return {
    nodeId: over.nodeId ?? "n", title: over.title ?? "t", parent: over.parent ?? null, depth: over.depth ?? 0,
    size: over.size ?? "leaf", status: over.status ?? "PRACTICING",
    dev: over.dev ?? { problems: 0, solved: 0, attempts: 0 },
    heldout: over.heldout ?? { problems: 0, passed: 0, sha256: heldOutSha([]) },
    attempts: over.attempts ?? 0, reasonCodes: over.reasonCodes ?? [],
  };
}

test("held-out counts independent breaks, a short leaf is not LEARNED, and pairs stay on verified dev", { timeout: 180_000 }, () => {
  const repo = mkdtempSync(join(tmpdir(), "peaceai-box-"));
  try {
    makeBox(repo);
    const a = runPractice(repo, 1);
    const b = runPractice(repo, 1);
    assert.equal(JSON.stringify(a), JSON.stringify(b));
    assert.equal(a.credit, false);
    assert.equal(a.experimental, true);
    assert.equal(a.sealedBeforeAttempts, true);
    assert.ok(a.attemptsUsed <= 200);
    assert.ok(a.problems.every((p) => p.attempts <= RETRY_MAX_ATTEMPTS));
    assert.equal(a.attemptsUsed, a.problems.reduce((s, p) => s + p.attempts, 0));
    const score = a.nodes.find((n) => n.nodeId === "fn:src/box.ts:score");
    const dbl = a.nodes.find((n) => n.nodeId === "fn:src/box.ts:dbl");
    const parent = a.nodes.find((n) => n.nodeId === "mod:src/box.ts");
    assert.ok(score && dbl && parent);
    for (const n of [score, dbl]) {
      const held = a.problems.filter((p) => p.nodeId === n.nodeId && p.set === "heldout");
      const kinds = new Set(held.map((p) => p.kind));
      assert.equal(kinds.size, held.length, n.nodeId);
      assert.equal(n.heldout.problems, kinds.size);
      assert.equal(n.heldout.sha256, heldOutSha(held));
      assert.equal(practiceSealOk(held, held), true);
      const bar = kinds.size >= 4 && n.heldout.passed / kinds.size >= 0.75;
      assert.equal(n.status === "LEARNED", bar);
    }
    assert.ok(score.heldout.problems < 4, `score independent held-out ${score.heldout.problems}`);
    assert.notEqual(score.status, "LEARNED");
    assert.notEqual(dbl.status, "LEARNED");
    assert.notEqual(parent.status, "LEARNED");
    const changed = a.problems.filter((p) => p.set === "heldout").map((p, i) => (i === 0 ? { ...p, test: `${p.test}// changed\n` } : p));
    assert.equal(practiceSealOk(a.problems.filter((p) => p.set === "heldout"), changed), false);

    const built = buildLearnPairs(a, "practice");
    assert.equal(built.credit, false);
    const heldRows = a.problems.filter((p) => p.set === "heldout");
    for (const d of built.docs) {
      assert.equal(d.split, "train");
      assert.ok(heldRows.every((p) => !d.text.includes(p.test) && !d.text.includes(p.broken)));
    }
    const solvedDev = a.problems.filter((p) => p.set === "dev" && p.solved && p.verified && p.fixed);
    if (solvedDev.length > 0) assert.ok(built.docs.length > 0);
    assert.ok(built.docs.every((d) => solvedDev.some((p) => d.text.includes(p.test))));

    const out = mkdtempSync(join(tmpdir(), "peaceai-pairs-"));
    const other = mkdtempSync(join(tmpdir(), "peaceai-pair-repo-"));
    try {
      if (built.docs.length > 0) {
        writeLearnPairs(out, built, other);
        const rawDocs = readFileSync(join(out, "docs.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l) as { doc: number; text: string });
        const rawMan = readFileSync(join(out, "manifest.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l) as Record<string, unknown>);
        assert.deepEqual(Object.keys(rawDocs[0]!).sort(), ["doc", "text"]);
        assert.deepEqual(Object.keys(rawMan[0]!).sort(), ["doc", "function", "path", "repo", "sha", "split"]);
        const read = readLearnPairs(out);
        assert.equal(read[0]!.text, built.docs[0]!.text);
        assert.equal(read[0]!.split, "train");
        assert.equal(JSON.parse(readFileSync(join(out, "meta.json"), "utf8")).credit, false);
      }
    } finally {
      rmSync(out, { recursive: true, force: true });
      rmSync(other, { recursive: true, force: true });
    }

    const rows = gapRows(a, tree(), programName(repo), "2026-11-06");
    assert.ok(rows.some((r) => r.nodeId === "fn:src/empty.ts:gone"));
    assert.ok(rows.some((r) => r.nodeId === "mod:src/wide.ts"));
    assert.equal(rows.some((r) => r.nodeId === "mod:src/box.ts"), false);
    assert.equal(new Set(rows.map((r) => r.nodeId)).size, rows.length);
    const once = mergeNeedsTeaching("", rows);
    const later = rows.map((r) => ({ ...r, firstSeen: "2026-12-01", title: "rewritten" }));
    const twice = mergeNeedsTeaching(once, later);
    assert.equal(twice, once);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("status, seal, split, and parent gates do not treat copies as independent held-outs", () => {
  assert.equal(leafStatus(4, 4, false), "LEARNED");
  assert.equal(leafStatus(3, 4, false), "LEARNED");
  assert.equal(leafStatus(2, 4, false), "NEEDS_TEACHING");
  assert.equal(leafStatus(3, 3, false), "PRACTICING");
  assert.equal(leafStatus(0, 0, false), "NEEDS_TEACHING");
  assert.equal(leafStatus(4, 4, true), "BUDGET_STOPPED");
  assert.equal(shouldDemote(4, 2, false), true);
  assert.equal(shouldDemote(4, 3, false), false);
  assert.equal(shouldDemote(3, 0, false), false);
  assert.equal(shouldDemote(4, 0, true), false);
  const held = [0, 1].flatMap((k) => [0, 1, 2].map((n) => problem({
    id: `h${k}-${n}`, set: "heldout", kind: `break-${k}`, solved: true, verified: true,
  })));
  assert.equal(scoreHeldOut(held).independent, 2);
  assert.equal(scoreHeldOut(held).passed, 2);
  assert.notEqual(leafStatus(scoreHeldOut(held).passed, scoreHeldOut(held).independent, false), "LEARNED");
  const oneFail = held.map((p, i) => (i === 0 ? { ...p, solved: false, verified: false } : p));
  assert.equal(scoreHeldOut(oneFail).passed, 1);
  assert.equal(practiceSealOk(held, held), true);
  assert.equal(practiceSealOk(held, held.map((p, i) => (i === 0 ? { ...p, broken: `${p.broken}\n` } : p))), false);

  const kinds = [0, 1, 2].map((i) => problem({ id: `k${i}`, kind: `kind-${i}`, set: "dev" }));
  const same = splitProblems(kinds, 1);
  assert.deepEqual(same.map((p) => [p.id, p.set]), splitProblems(kinds, 1).map((p) => [p.id, p.set]));
  assert.equal(new Set(same.map((p) => p.kind)).size, same.length);
  const both = new Set(same.map((p) => p.set));
  assert.ok(both.has("heldout") && both.has("dev"));
  assert.equal(splitProblems([kinds[0]!, { ...kinds[0]!, id: "copy" }], 1).length, 1);
  assert.ok([2, 3, 4, 5, 6, 7, 8, 9].some((seed) => splitProblems(kinds, seed).some((p, i) => p.set !== same[i]!.set)));

  const parentTree: SkillTree = {
    ...tree(),
    nodes: [
      { id: "p", title: "parent", parent: null, children: ["a", "b", "missing"], size: "split", testIdea: null, reason: null, depth: 0, units: 3 },
      { id: "a", title: "a", parent: "p", children: [], size: "leaf", testIdea: "a", reason: null, depth: 1, units: 1 },
      { id: "b", title: "b", parent: "p", children: [], size: "leaf", testIdea: "b", reason: null, depth: 1, units: 1 },
    ],
  };
  const blocked = withParentStatus(parentTree, [
    node({ nodeId: "p", size: "split", parent: null, status: "PRACTICING" }),
    node({ nodeId: "a", status: "LEARNED", parent: "p" }),
    node({ nodeId: "b", status: "LEARNED", parent: "p" }),
  ]);
  assert.notEqual(blocked.find((n) => n.nodeId === "p")!.status, "LEARNED");
  const open: SkillTree = { ...parentTree, nodes: parentTree.nodes.map((n) => n.id === "p" ? { ...n, children: ["a", "b"] } : n) };
  const learned = withParentStatus(open, [
    node({ nodeId: "p", size: "split", parent: null, status: "PRACTICING" }),
    node({ nodeId: "a", status: "LEARNED", parent: "p" }),
    node({ nodeId: "b", status: "LEARNED", parent: "p" }),
  ]);
  assert.equal(learned.find((n) => n.nodeId === "p")!.status, "LEARNED");
});

test("pairs drop held-out copies, unverified solves, and secret-shaped leaks", () => {
  const leakMail = ["person", "gmail.com"].join("@");
  const held = problem({
    id: "held", set: "heldout", solved: true, verified: true,
    test: "test(\"held only\", () => { assert.equal(score(1), 2); });\n",
    broken: "export function score(n: number): number {\n  return n - 1;\n}\n",
  });
  const run: PracticeRun = {
    schema: "peaceai-learn-practice:v1", experimental: true, credit: false, seed: 1,
    minutesUsed: 0, attemptsUsed: 1, maxMinutes: 30, maxAttemptsTotal: 200, history: "OFF",
    budgetStopped: false, sealedBeforeAttempts: true, rechecks: [], nodes: [],
    problems: [
      held,
      problem({ id: "ok", set: "dev", kind: "dev-kind", test: "test(\"dev\", () => { assert.equal(score(1), 2); });\n", broken: "export function score(n: number): number {\n  return n + 0;\n}\n" }),
      problem({ id: "unverified", set: "dev", kind: "unverified", solved: true, verified: false, fixed: held.original }),
      problem({ id: "near", set: "dev", kind: "near", sourcePath: "src/other.ts", broken: held.broken, original: held.original, fixed: held.original, test: "test(\"other\", () => { assert.equal(1, 1); });\n" }),
      problem({
        id: "leak", set: "dev", kind: "leak", sourcePath: "src/zz.ts", function: "zz",
        broken: `export function zz(n: number): number {\n  return n; // ${leakMail}\n}\n`,
        original: "export function zz(n: number): number {\n  return n;\n}\n",
        fixed: "export function zz(n: number): number {\n  return n;\n}\n",
        test: "test(\"zz only\", () => { assert.equal(1, 1); });\n",
      }),
    ],
  };
  const built = buildLearnPairs(run, "practice");
  assert.equal(built.credit, false);
  assert.ok(built.dropped.nearDuplicate >= 1);
  assert.ok(built.dropped.leak >= 1);
  assert.ok(built.docs.every((d) => !d.text.includes(held.test) && !d.text.includes(held.broken) && !d.text.includes(leakMail)));
  assert.ok(built.docs.some((d) => d.function === "score"));
  assert.equal(built.docs.some((d) => d.text.includes("unverified") || d.path === "src/zz.ts"), false);
});

test("budget stop writes every unfinished leaf as BUDGET_STOPPED and exits 0", () => {
  const repo = mkdtempSync(join(tmpdir(), "peaceai-budget-repo-"));
  const out = mkdtempSync(join(tmpdir(), "peaceai-budget-"));
  try {
    makeBox(repo);
    const stopped = practiceProgram({ tree: tree(), map: map(), repoPath: repo, seed: 1, maxMinutes: 30, maxAttemptsTotal: 0, now: frozen });
    assert.equal(stopped.budgetStopped, true);
    assert.equal(stopped.credit, false);
    assert.equal(stopped.attemptsUsed, 0);
    for (const n of stopped.nodes.filter((x) => x.size === "leaf")) assert.equal(n.status, "BUDGET_STOPPED");
    let ticks = 0;
    const jumped = practiceProgram({ tree: tree(), map: map(), repoPath: repo, seed: 1, maxMinutes: 30, maxAttemptsTotal: 200, now: () => (ticks++ === 0 ? 0 : 31 * 60_000) });
    assert.equal(jumped.budgetStopped, true);
    assert.equal(jumped.attemptsUsed, 0);
    for (const n of jumped.nodes.filter((x) => x.size === "leaf")) assert.equal(n.status, "BUDGET_STOPPED");
    const treePath = join(out, "tree.json");
    const mapPath = join(out, "map.json");
    writeFileSync(treePath, JSON.stringify(tree()));
    writeFileSync(mapPath, JSON.stringify(map()));
    const dest = join(out, "out");
    const r = spawnSync(tsx, ["peaceai/bin/learn-practice.ts", "--repo", repo, "--tree", treePath, "--map", mapPath, "--out", dest, "--max-attempts-total", "0", "--today", "2026-11-06"], { cwd: repoRoot, encoding: "utf8" });
    assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
    const written = JSON.parse(readFileSync(join(dest, "practice-results.json"), "utf8")) as PracticeRun;
    assert.equal(written.credit, false);
    assert.ok(written.nodes.some((n) => n.status === "BUDGET_STOPPED"));
  } finally {
    rmSync(repo, { recursive: true, force: true });
    rmSync(out, { recursive: true, force: true });
  }
});

test("learn-practice refuses writes inside the target, including a symlink", () => {
  const repo = mkdtempSync(join(tmpdir(), "peaceai-refuse-repo-"));
  const out = mkdtempSync(join(tmpdir(), "peaceai-refuse-"));
  try {
    makeBox(repo);
    writeFileSync(join(repo, "secret.txt"), "keep");
    const treePath = join(out, "tree.json");
    const mapPath = join(out, "map.json");
    writeFileSync(treePath, JSON.stringify(tree()));
    writeFileSync(mapPath, JSON.stringify(map()));
    const inside = join(repo, "sneak");
    const r = spawnSync(tsx, ["peaceai/bin/learn-practice.ts", "--repo", repo, "--tree", treePath, "--map", mapPath, "--out", inside, "--max-attempts-total", "0"], { cwd: repoRoot, encoding: "utf8" });
    assert.notEqual(r.status, 0);
    assert.match(`${r.stdout}${r.stderr}`, /refused WRITE_IN_TARGET/);
    const linked = join(out, "linked");
    mkdirSync(linked);
    symlinkSync(join(repo, "secret.txt"), join(linked, "practice-results.json"));
    const s = spawnSync(tsx, ["peaceai/bin/learn-practice.ts", "--repo", repo, "--tree", treePath, "--map", mapPath, "--out", linked, "--max-attempts-total", "0"], { cwd: repoRoot, encoding: "utf8" });
    assert.notEqual(s.status, 0);
    assert.match(`${s.stdout}${s.stderr}`, /refused WRITE_IN_TARGET/);
    assert.equal(readFileSync(join(repo, "secret.txt"), "utf8"), "keep");
    const via = join(out, "via");
    symlinkSync(repo, via);
    assert.equal(insideRepo(repo, join(via, "nested")), true);
    const outside = mkdtempSync(join(tmpdir(), "peaceai-outside-link-"));
    const mid = join(out, "mid");
    symlinkSync(join(repo, "src"), mid);
    assert.equal(hasSymlinkComponent(join(mid, "new.txt")), true);
    assert.throws(() => safeWriteFile(repo, join(mid, "new.txt"), "pwn"), (e: unknown) => e instanceof LearnRefuse && e.code === "WRITE_IN_TARGET");
    assert.equal(existsSync(join(repo, "src/new.txt")), false);
    const broken = join(out, "broken");
    symlinkSync(join(repo, "missing-dir"), broken);
    assert.throws(() => safeWriteFile(repo, join(broken, "new.txt"), "pwn"), (e: unknown) => e instanceof LearnRefuse && e.code === "WRITE_IN_TARGET");
    symlinkSync(outside, join(out, "elsewhere"));
    assert.throws(() => safeWriteFile(repo, join(out, "elsewhere", "note.txt"), "nope"), (e: unknown) => e instanceof LearnRefuse && e.code === "WRITE_IN_TARGET");
    assert.equal(existsSync(join(outside, "note.txt")), false);
    rmSync(outside, { recursive: true, force: true });
  } finally {
    rmSync(repo, { recursive: true, force: true });
    rmSync(out, { recursive: true, force: true });
  }
});

test("target code cannot write outside the sandbox or read the parent environment", { timeout: 180_000 }, () => {
  const repo = mkdtempSync(join(tmpdir(), "peaceai-sand-"));
  rmSync(SENTINEL, { force: true });
  const prev = process.env.PEACEAI_LEARN_SENTINEL_SECRET;
  process.env.PEACEAI_LEARN_SENTINEL_SECRET = SECRET;
  try {
    mkdirSync(join(repo, "src"));
    writeFileSync(join(repo, "src/box.ts"), `export function score(n: number): number {\n  try {\n    const fs = process.getBuiltinModule("fs") as typeof import("node:fs");\n    fs.writeFileSync(${JSON.stringify(SENTINEL)}, process.env.PEACEAI_LEARN_SENTINEL_SECRET ?? "noenv");\n  } catch { /* denied */ }\n  return n + 1;\n}\n`);
    const only: SkillTree = { ...tree(), nodes: [tree().nodes.find((n) => n.id === "fn:src/box.ts:score")!] };
    const run = practiceProgram({ tree: only, map: map(), repoPath: repo, seed: 1, maxMinutes: 30, maxAttemptsTotal: 4, now: frozen });
    assert.equal(run.credit, false);
    assert.equal(JSON.stringify(run).includes(SECRET), false);
    assert.equal(existsSync(SENTINEL), false);
  } finally {
    if (prev === undefined) delete process.env.PEACEAI_LEARN_SENTINEL_SECRET;
    else process.env.PEACEAI_LEARN_SENTINEL_SECRET = prev;
    rmSync(SENTINEL, { force: true });
    rmSync(repo, { recursive: true, force: true });
  }
});

test("recheck demotes a learned leaf and its ancestors only from a real new sample", { timeout: 180_000 }, () => {
  const hard = mkdtempSync(join(tmpdir(), "peaceai-recheck-"));
  const empty = mkdtempSync(join(tmpdir(), "peaceai-recheck-empty-"));
  try {
    mkdirSync(join(hard, "src"));
    writeFileSync(join(hard, "src/box.ts"), "export function score(n: number): number {\n  if (n > 1 && n < 9) return n + 1;\n  if (n >= 9) return n - 2;\n  if (n === 0) return 0;\n  if (n < 0) return n * 2;\n  return n + 4;\n}\n");
    mkdirSync(join(empty, "src"));
    writeFileSync(join(empty, "src/box.ts"), "export const marker = 1;\n");
    const leafId = "fn:src/box.ts:score";
    const heldSentinel = "HELD_OUT_SENTINEL_m224_do_not_train";
    const heldProblem = problem({
      id: "old-held", set: "heldout", nodeId: leafId, kind: "old",
      test: `test("held", () => { assert.equal(1, 1); }); // ${heldSentinel}\n`,
      broken: `export function score(n: number): number {\n  return n - 9; // ${heldSentinel}\n}\n`,
    });
    const cleanDev = problem({
      id: "clean-dev", set: "dev", kind: "clean-dev", nodeId: leafId, solved: true, verified: true,
      broken: "export function score(n: number): number {\n  return n + 0;\n}\n",
      test: "test(\"clean dev\", () => { assert.equal(score(1), 2); });\n",
    });
    const launder = problem({
      id: "launder", set: "dev", kind: "launder", nodeId: leafId, solved: true, verified: true,
      sourcePath: "src/other.ts", broken: heldProblem.broken, original: heldProblem.original, fixed: heldProblem.original,
      test: "test(\"copy\", () => { assert.equal(1, 1); });\n",
    });
    const prior: PracticeRun = {
      schema: "peaceai-learn-practice:v1", experimental: true, credit: false, seed: 1,
      minutesUsed: 0, attemptsUsed: 3, maxMinutes: 30, maxAttemptsTotal: 200, history: "OFF",
      budgetStopped: false, sealedBeforeAttempts: true, problems: [heldProblem, cleanDev, launder], rechecks: [],
      nodes: [
        node({ nodeId: "root", size: "split", parent: null, status: "LEARNED", depth: 0 }),
        node({ nodeId: "mid", size: "split", parent: "root", status: "LEARNED", depth: 1 }),
        node({ nodeId: leafId, parent: "mid", status: "LEARNED", depth: 2, heldout: { problems: 4, passed: 4, sha256: heldOutSha([heldProblem]) } }),
      ],
    };
    (prior as { credit: boolean }).credit = true;
    const oldHeld = JSON.stringify(prior.problems);
    const oldSha = prior.nodes.find((n) => n.nodeId === leafId)!.heldout.sha256;
    const only: SkillTree = {
      ...tree(),
      nodes: [
        { id: "root", title: "root", parent: null, children: ["mid"], size: "split", testIdea: null, reason: null, depth: 0, units: 1 },
        { id: "mid", title: "mid", parent: "root", children: [leafId], size: "split", testIdea: null, reason: null, depth: 1, units: 1 },
        { id: leafId, title: "score", parent: "mid", children: [], size: "leaf", testIdea: "call score", reason: null, depth: 2, units: 1 },
      ],
    };
    const again = recheckPractice(prior, { tree: only, map: map(), repoPath: hard, seed: 1, now: frozen, today: "2026-11-06" });
    assert.equal(again.credit, false);
    assert.equal(JSON.stringify(again.problems), oldHeld);
    assert.equal(again.nodes.find((n) => n.nodeId === leafId)!.heldout.sha256, oldSha);
    assert.equal(again.rechecks.length, 1);
    assert.equal(again.rechecks[0]!.at, "2026-11-06");
    assert.equal(again.rechecks[0]!.demoted, true, JSON.stringify(again.rechecks[0]));
    assert.ok(again.rechecks[0]!.newRate < 0.75);
    assert.equal(again.nodes.find((n) => n.nodeId === leafId)!.status, "PRACTICING");
    assert.notEqual(again.nodes.find((n) => n.nodeId === "mid")!.status, "LEARNED");
    assert.notEqual(again.nodes.find((n) => n.nodeId === "root")!.status, "LEARNED");
    assert.ok(again.rechecks[0]!.ancestors.includes("mid"));
    assert.ok(again.rechecks[0]!.ancestors.includes("root"));
    const pairs = buildLearnPairs(again, "recheck");
    assert.equal(pairs.credit, false);
    assert.ok(pairs.dropped.nearDuplicate >= 1);
    assert.ok(pairs.docs.every((d) => !d.text.includes(heldSentinel) && !d.text.includes(heldProblem.test) && !d.text.includes(heldProblem.broken)));
    assert.ok(pairs.docs.some((d) => d.text.includes("clean dev")));
    assert.equal(pairs.docs.some((d) => d.path === "src/other.ts"), false);

    const stayed = recheckPractice(prior, { tree: only, map: map(), repoPath: empty, seed: 1, now: frozen, today: "2026-11-07" });
    assert.equal(stayed.rechecks[0]!.demoted, false);
    assert.equal(stayed.nodes.find((n) => n.nodeId === leafId)!.status, "LEARNED");
    assert.equal(stayed.nodes.find((n) => n.nodeId === leafId)!.heldout.sha256, oldSha);
  } finally {
    rmSync(hard, { recursive: true, force: true });
    rmSync(empty, { recursive: true, force: true });
  }
});

test("from-history reads git and ignores a repo without history", { timeout: 180_000 }, () => {
  const dir = mkdtempSync(join(tmpdir(), "peaceai-hist-"));
  const bare = mkdtempSync(join(tmpdir(), "peaceai-nohist-"));
  const pwn = join(dir, "pwn");
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
    git("config", "alias.log", `!touch ${pwn}`);
    git("config", "diff.external", `!touch ${pwn}`);
    git("config", "core.fsmonitor", `touch ${pwn}`);
    const only: SkillTree = {
      ...tree(),
      nodes: [
        { id: "fn:src/box.ts:score", title: "fix score in src/box.ts", parent: null, children: [], size: "leaf", testIdea: "call score", reason: null, depth: 0, units: 1 },
      ],
    };
    const histMap: ProgramMap = { ...map(), modules: [{ path: "src/box.ts", exports: ["score"], imports: [], summary: "History box." }], tests: [] };
    const used = practiceProgram({ tree: only, map: histMap, repoPath: dir, seed: 1, fromHistory: true, now: frozen });
    assert.equal(used.history, "USED");
    assert.equal(used.credit, false);
    assert.ok(used.problems.some((p) => p.fromHistory));
    const built = buildLearnPairs(used, "hist");
    for (const p of used.problems.filter((x) => x.fromHistory && x.set === "heldout")) {
      assert.ok(built.docs.every((d) => !d.text.includes(p.test) && !d.text.includes(p.broken)));
    }
    assert.equal(existsSync(pwn), false);
    const capped = practiceProgram({ tree: only, map: histMap, repoPath: dir, seed: 1, fromHistory: true, now: frozen, maxAttemptsTotal: 0 });
    assert.equal(capped.history, "USED");
    assert.equal(capped.attemptsUsed, 0);
    assert.equal(capped.nodes[0]!.status, "BUDGET_STOPPED");
    const none = practiceProgram({ tree: only, map: histMap, repoPath: bare, seed: 1, fromHistory: true, now: frozen, maxAttemptsTotal: 0 });
    assert.equal(none.history, "HISTORY_NONE");
    assert.equal(existsSync(pwn), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(bare, { recursive: true, force: true });
    rmSync(pwn, { force: true });
  }
});

test("arrows, arrays, strings, and booleans are candidates; two required params and an untrusted map are not learned", { timeout: 120_000 }, () => {
  const repo = mkdtempSync(join(tmpdir(), "peaceai-shapes-"));
  try {
    mkdirSync(join(repo, "src"));
    writeFileSync(join(repo, "src/shapes.ts"), [
      "export const inc = (n: number): number => n + 1;",
      "export const shout = (s: string): string => s.length > 1 ? s.toUpperCase() : s;",
      "export function total(xs: number[]): number { return xs.reduce((a, b) => a + b, 0); }",
      "export function on(v: boolean): boolean { return !v; }",
      "export function add(a: number, b: number): number { return a + b; }",
      "",
    ].join("\n"));
    const ids = ["inc", "shout", "total", "on", "add"].map((name) => `fn:src/shapes.ts:${name}`);
    const shapeTree: SkillTree = {
      ...tree(),
      nodes: ids.map((id) => ({ id, title: id, parent: null, children: [], size: "leaf" as const, testIdea: "call it", reason: null, depth: 0, units: 1 })),
    };
    const shapeMap: ProgramMap = {
      ...map(),
      modules: [{ path: "src/shapes.ts", exports: ["inc", "shout", "total", "on", "add"], imports: [], summary: "shapes" }],
      entryPoints: ["src/shapes.ts"],
    };
    const run = practiceProgram({ tree: shapeTree, map: shapeMap, repoPath: repo, seed: 1, maxMinutes: 2, maxAttemptsTotal: 24, now: frozen });
    assert.equal(run.credit, false);
    assert.equal(run.heldoutProof, false);
    const byId = (id: string) => run.nodes.find((n) => n.nodeId === id)!;
    assert.equal(byId(ids[4]!).status, "NEEDS_TEACHING");
    assert.ok(byId(ids[4]!).reasonCodes.includes("UNSUPPORTED_INPUT"));
    assert.equal(run.problems.some((p) => p.function === "add"), false);
    for (const name of ["inc", "shout", "total", "on"]) {
      const rows = run.problems.filter((p) => p.function === name);
      assert.ok(rows.length > 0, name);
      assert.notEqual(byId(`fn:src/shapes.ts:${name}`)!.status, "LEARNED");
    }
    assert.ok(run.problems.some((p) => p.function === "shout" && p.test.includes("\"a\"")));
    assert.ok(run.problems.some((p) => p.function === "total" && p.test.includes("[")));
    assert.ok(run.problems.some((p) => p.function === "on" && p.test.includes("true")));
    const held = run.problems.filter((p) => p.set === "heldout");
    const built = buildLearnPairs(run, "shapes");
    for (const d of built.docs) assert.ok(held.every((p) => !d.text.includes(p.test) && !d.text.includes(p.broken)));
    const kinds = built.docs.map((d) => run.problems.find((p) => d.text.includes(p.test))?.kind);
    assert.equal(new Set(kinds).size, kinds.length);
    const blocked = buildLearnPairs({ ...run, mapTrusted: false }, "shapes");
    assert.equal(blocked.eligible, false);
    assert.equal(blocked.docs.length, 0);
    const bare = practiceProgram({
      tree: { ...shapeTree, nodes: [shapeTree.nodes[4]!] },
      map: shapeMap, repoPath: repo, seed: 1, maxMinutes: 2, maxAttemptsTotal: 4, now: frozen,
    });
    assert.equal(bare.problems.length, 0);
    assert.equal(bare.sealedBeforeAttempts, false);
    assert.equal(bare.heldoutProof, false);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("a leaf path cannot escape the repo through .. or a symlink", () => {
  const repo = mkdtempSync(join(tmpdir(), "peaceai-escape-"));
  const outside = mkdtempSync(join(tmpdir(), "peaceai-outside-"));
  rmSync(SENTINEL, { force: true });
  try {
    mkdirSync(join(repo, "src"));
    writeFileSync(join(outside, "secret.ts"), `export function score(n: number): number {\n  const fs = process.getBuiltinModule("fs") as typeof import("node:fs");\n  fs.writeFileSync(${JSON.stringify(SENTINEL)}, "escaped");\n  return n + 1;\n}\n`);
    symlinkSync(join(outside, "secret.ts"), join(repo, "src/box.ts"));
    const bad: SkillTree = {
      ...tree(),
      nodes: [
        { id: "fn:../secret.ts:score", title: "escape", parent: null, children: [], size: "leaf", testIdea: "no", reason: null, depth: 0, units: 1 },
        { id: "fn:src/box.ts:score", title: "link", parent: null, children: [], size: "leaf", testIdea: "no", reason: null, depth: 0, units: 1 },
      ],
    };
    const run = practiceProgram({ tree: bad, map: map(), repoPath: repo, seed: 1, now: frozen, maxAttemptsTotal: 5 });
    for (const n of run.nodes) {
      assert.equal(n.status, "NEEDS_TEACHING");
      assert.ok(n.reasonCodes.includes("NO_FUNCTION"));
    }
    assert.equal(run.problems.length, 0);
    let saw = false;
    try { readFileSync(SENTINEL); saw = true; } catch { saw = false; }
    assert.equal(saw, false);
  } finally {
    rmSync(repo, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
    rmSync(SENTINEL, { force: true });
  }
});
