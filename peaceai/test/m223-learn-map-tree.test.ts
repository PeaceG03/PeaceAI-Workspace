// M223: learn a program — program map, self-check, and skill tree.
// The fixture is a made-up shop, not a practice task and not a reference diff.
// EXPERIMENTAL. credit is false; nothing here touches scoring.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { buildProgramMap, checkMap } from "../lib/learnmap.ts";
import { buildSkillTree, renderSkillTree, treeConserved, type GapNode } from "../lib/learntree.ts";

const repo = resolve(import.meta.dirname, "..", "..");
const fix = join(repo, "peaceai/test/fixtures/learn/mini");
const tsx = join(repo, "node_modules/.bin/tsx");

test("map lists the fixture modules, edges and tests, and is byte-stable", () => {
  const a = buildProgramMap(fix);
  const b = buildProgramMap(fix);
  assert.equal(JSON.stringify(a), JSON.stringify(b));
  assert.equal(a.schema, "peaceai-learn-map:v1");
  assert.equal(a.experimental, true);
  assert.equal(a.credit, false);
  assert.deepEqual(a.modules.map((m) => m.path), ["src/cart.ts", "src/deep.ts", "src/index.ts", "src/tax.ts"]);
  assert.deepEqual(a.modules.map((m) => m.exports), [
    ["addItem", "removeItem", "total"],
    ["tunnel"],
    ["addItem", "rate", "removeItem", "total", "tunnel"],
    ["rate"],
  ]);
  assert.deepEqual(a.modules.map((m) => m.imports), [
    [],
    [],
    ["src/cart.ts", "src/deep.ts", "src/tax.ts"],
    [],
  ]);
  assert.equal(a.modules[0]!.summary, "Adds one item to the running count. Removes one item from the running count. Computes the cart total from a unit price.");
  assert.equal(a.modules[2]!.summary, "Shop barrel: cart, tax, and the tunnel.");
  assert.deepEqual(a.edges, [
    { from: "src/index.ts", to: "src/cart.ts" },
    { from: "src/index.ts", to: "src/deep.ts" },
    { from: "src/index.ts", to: "src/tax.ts" },
  ]);
  assert.deepEqual(a.entryPoints, ["src/index.ts"]);
  assert.deepEqual(a.tests, [
    { path: "test/cart.test.ts", covers: ["src/cart.ts"] },
    { path: "test/tax.test.ts", covers: ["src/tax.ts"] },
  ]);
});

test("checkMap trusts a real map and catches a corrupted edge", () => {
  const map = buildProgramMap(fix);
  const ok = checkMap(map, fix);
  assert.equal(ok.asked, 10);
  assert.equal(ok.correct, 10);
  assert.deepEqual(ok.wrong, []);
  const bad = structuredClone(map);
  const edge = bad.edges[0]!;
  edge.to = "src/does-not-exist.ts";
  const no = checkMap(bad, fix);
  assert.ok(no.wrong.some((w) => w.id === `edge:${edge.from}>src/does-not-exist.ts`));
  assert.ok(no.correct < no.asked);
});

test("skill tree splits a wide gap, keeps every leaf testable, and parks the depth-5 gap", { timeout: 120_000 }, () => {
  const map = buildProgramMap(fix);
  const tree = buildSkillTree(map, fix);
  const again = buildSkillTree(map, fix);
  assert.equal(JSON.stringify(tree), JSON.stringify(again));
  assert.equal(tree.credit, false);
  assert.equal(tree.experimental, true);
  assert.equal(tree.planner, "plan-only-v4");
  assert.ok(tree.missing.includes("edit-existing-function"));
  const cart = tree.nodes.find((n) => n.id === "mod:src/cart.ts");
  assert.ok(cart);
  assert.equal(cart.size, "split");
  assert.equal(cart.children.length, 3);
  const byId = new Map(tree.nodes.map((n) => [n.id, n]));
  for (const id of cart.children) {
    const leaf = byId.get(id)!;
    assert.equal(leaf.size, "leaf");
    assert.equal(leaf.children.length, 0);
    assert.equal(typeof leaf.testIdea, "string");
    assert.ok(leaf.testIdea);
  }
  const stuck = tree.nodes.filter((n) => n.size === "TOO_BIG_UNSPLIT");
  assert.equal(stuck.length, 1);
  assert.equal(stuck[0]!.depth, 5);
  assert.match(stuck[0]!.reason ?? "", /depth 5/);
  assert.equal(stuck[0]!.children.length, 0);
  for (const n of tree.nodes) if (n.size === "leaf") assert.ok(n.testIdea && n.testIdea.length > 0);
  assert.equal(treeConserved(tree), true);
  const before = countUnits(tree.nodes.filter((n) => n.parent === null));
  const after = countUnits(tree.nodes.filter((n) => n.size !== "split"));
  assert.equal(before, after);
  const text = renderSkillTree(tree);
  assert.match(text, /EXPERIMENTAL credit=false/);
  assert.match(text, /TOO_BIG_UNSPLIT/);
  assert.match(text, /fix addItem in src\/cart.ts/);
});

test("learn CLI refuses to write into the repo it studies", () => {
  const before = readdirSync(fix).sort();
  const inside = join(fix, "sneak");
  const r = spawnSync(tsx, ["peaceai/bin/learn.ts", fix, "--out", inside], { cwd: repo, encoding: "utf8" });
  assert.notEqual(r.status, 0);
  assert.match(`${r.stdout}${r.stderr}`, /refused WRITE_IN_TARGET/);
  assert.equal(existsSync(inside), false);
  assert.deepEqual(readdirSync(fix).sort(), before);
  const self = spawnSync(tsx, ["peaceai/bin/learn.ts", fix, "--out", fix], { cwd: repo, encoding: "utf8" });
  assert.match(`${self.stdout}${self.stderr}`, /refused WRITE_IN_TARGET/);
  assert.deepEqual(readdirSync(fix).sort(), before);
});

test("learn CLI writes the map and the outline outside the repo", { timeout: 120_000 }, () => {
  const out = mkdtempSync(join(tmpdir(), "peaceai-learn-"));
  try {
    const r = spawnSync(tsx, ["peaceai/bin/learn.ts", fix, "--out", out], { cwd: repo, encoding: "utf8" });
    assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
    assert.match(r.stdout, /credit=false/);
    const map = JSON.parse(readFileSync(join(out, "program-map.json"), "utf8"));
    assert.equal(map.credit, false);
    assert.deepEqual(map.modules.map((m: { path: string }) => m.path), buildProgramMap(fix).modules.map((m) => m.path));
    const text = readFileSync(join(out, "learn-tree.txt"), "utf8");
    assert.match(text, /TOO_BIG_UNSPLIT/);
    assert.equal(existsSync(join(fix, "program-map.json")), false);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

function countUnits(nodes: GapNode[]): number {
  return nodes.reduce((s, n) => s + n.units, 0);
}
