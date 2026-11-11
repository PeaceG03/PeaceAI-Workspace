// M223: learn a program — program map, self-check, and skill tree.
// The shop is generated in a temp directory. It is made-up original input, not a third-party fixture,
// not a practice task, and not a reference diff.
// EXPERIMENTAL. credit is false; nothing here touches scoring.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, linkSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { buildProgramMap, checkMap, resetLearnMapCache } from "../lib/learnmap.ts";
import { buildSkillTree, renderSkillTree, treeConserved, type GapNode } from "../lib/learntree.ts";
import { practiceProgram } from "../lib/learnpractice.ts";

const repo = resolve(import.meta.dirname, "..", "..");
const tsx = join(repo, "node_modules/.bin/tsx");

/** Byte-for-byte the made-up shop previously stored under peaceai/test/fixtures/learn/mini. */
const SHOP: Readonly<Record<string, string>> = {
  "src/cart.ts": `/** Adds one item to the running count. */
export function addItem(count: number): number {
  return count + 1;
}

/** Removes one item from the running count. */
export function removeItem(count: number): number {
  return count - 1;
}

/** Computes the cart total from a unit price. */
export function total(count: number, price: number): number {
  return count * price;
}
`,
  "src/deep.ts": `/** Nested tunnel used so a gap stays too big at depth 5. */
export function tunnel(x: number): number {
  if (x > 0) {
    if (x > 1) {
      if (x > 2) {
        if (x > 3) {
          if (x > 4) {
            if (x > 5) {
              return x;
            } else {
              return 5;
            }
          } else {
            return 4;
          }
        } else {
          return 3;
        }
      } else {
        return 2;
      }
    } else {
      return 1;
    }
  } else {
    return 0;
  }
}
`,
  "src/index.ts": `/** Shop barrel: cart, tax, and the tunnel. */
export { addItem, removeItem, total } from "./cart.ts";
export { rate } from "./tax.ts";
export { tunnel } from "./deep.ts";
`,
  "src/tax.ts": `/** Sales tax for a cent amount. */
export function rate(cents: number): number {
  return cents * 5;
}
`,
  "test/cart.test.ts": `import { addItem, total } from "../src/cart.ts";

export function cartCoversAdd(): number {
  return total(addItem(1), 3);
}
`,
  "test/tax.test.ts": `import { rate } from "../src/tax.ts";

export function taxCoversRate(): number {
  return rate(100);
}
`,
};

function writeShop(dir: string): void {
  for (const [rel, text] of Object.entries(SHOP)) {
    const full = join(dir, rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, text);
  }
}

function withShop(fn: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "peaceai-mini-"));
  try {
    writeShop(dir);
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("map lists the fixture modules, edges and tests, and is byte-stable", () => {
  withShop((fix) => {
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
});

test("checkMap trusts a real map and catches a corrupted edge", () => {
  withShop((fix) => {
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
});

test("checkMap trusts a renamed re-export, including a reserved-word alias", () => {
  const dir = mkdtempSync(join(tmpdir(), "peaceai-alias-"));
  try {
    mkdirSync(join(dir, "src"));
    writeFileSync(join(dir, "src/inner.ts"), "export const inner = 1;\n");
    writeFileSync(join(dir, "src/index.ts"), "export { inner as kept } from \"./inner.ts\";\nexport { inner as try } from \"./inner.ts\";\n");
    const map = buildProgramMap(dir);
    const check = checkMap(map, dir);
    assert.deepEqual(check.wrong, []);
    assert.ok(check.asked > 0);
    const index = map.modules.find((m) => m.path === "src/index.ts");
    assert.ok(index?.exports.includes("kept"));
    assert.ok(index?.exports.includes("try"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("skill tree splits a wide gap, keeps every leaf testable, and parks the depth-5 gap", { timeout: 120_000 }, () => {
  withShop((fix) => {
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
});

test("overload declarations keep distinct ids and practice resolves every generated function id", { timeout: 180_000 }, () => {
  const dir = mkdtempSync(join(tmpdir(), "peaceai-over-"));
  try {
    mkdirSync(join(dir, "src"));
    writeFileSync(join(dir, "src/measure.ts"), [
      "export function measure(n: number): number;",
      "export function measure(n: number, label: string): number;",
      "export function measure(n: number, label?: string): number {",
      "  return label ? n + label.length : n + 1;",
      "}",
      "export const other = (n: number): number => n + 2;",
      "",
    ].join("\n"));
    const map = buildProgramMap(dir);
    const tree = buildSkillTree(map, dir);
    const ids = tree.nodes.map((n) => n.id);
    assert.equal(new Set(ids).size, ids.length);
    assert.equal(treeConserved(tree), true);
    assert.ok(ids.filter((id) => id.startsWith("fn:src/measure.ts:measure:")).length >= 2);
    const run = practiceProgram({
      tree, map, repoPath: dir, seed: 1, maxMinutes: 2, maxAttemptsTotal: 80, now: () => 1_700_000_000_000,
    });
    assert.equal(run.credit, false);
    assert.equal(run.nodes.length, tree.nodes.length);
    assert.equal(new Set(run.nodes.map((n) => n.nodeId)).size, tree.nodes.length);
    for (const leaf of tree.nodes.filter((n) => n.size === "leaf")) {
      const row = run.nodes.find((n) => n.nodeId === leaf.id)!;
      assert.equal(row.reasonCodes.includes("NO_FUNCTION"), false, leaf.id);
    }
    assert.ok(run.problems.some((p) => p.function === "measure" && p.test.split("assert.").length - 1 >= 2));
    assert.ok(run.problems.some((p) => p.function === "other" && p.test.split("assert.").length - 1 >= 2));
    assert.equal(run.problems.some((p) => p.verified && p.test.split("assert.").length - 1 < 2), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("learn CLI refuses a symlink or hard link at each output and writes none of them", { timeout: 180_000 }, () => {
  withShop((fix) => {
    const marker = join(fix, "src", "keep.txt");
    writeFileSync(marker, "ORIGINAL\n");
    const names = ["program-map.json", "skill-tree.json", "learn-tree.txt"] as const;
    const run = (out: string) => spawnSync(tsx, ["peaceai/bin/learn.ts", fix, "--out", out], { cwd: repo, encoding: "utf8" });
    for (const name of names) {
      const out = mkdtempSync(join(tmpdir(), "peaceai-link-"));
      try {
        symlinkSync(marker, join(out, name));
        const before = readFileSync(marker, "utf8");
        const r = run(out);
        assert.notEqual(r.status, 0, name);
        assert.match(`${r.stdout}${r.stderr}`, /WRITE_IN_TARGET/);
        assert.equal(readFileSync(marker, "utf8"), before);
        for (const other of names) {
          const dest = join(out, other);
          if (other === name) assert.equal(lstatSync(dest).isSymbolicLink(), true);
          else assert.equal(existsSync(dest), false, other);
        }
      } finally {
        rmSync(out, { recursive: true, force: true });
      }
    }
    const mixed = mkdtempSync(join(tmpdir(), "peaceai-mixed-"));
    try {
      for (const name of names) symlinkSync(marker, join(mixed, name));
      const before = readFileSync(marker, "utf8");
      const r = run(mixed);
      assert.notEqual(r.status, 0);
      assert.equal(readFileSync(marker, "utf8"), before);
      for (const name of names) assert.equal(lstatSync(join(mixed, name)).isSymbolicLink(), true);
    } finally {
      rmSync(mixed, { recursive: true, force: true });
    }
    const hard = mkdtempSync(join(tmpdir(), "peaceai-hard-"));
    try {
      linkSync(marker, join(hard, "program-map.json"));
      const before = readFileSync(marker, "utf8");
      const r = run(hard);
      assert.notEqual(r.status, 0);
      assert.match(`${r.stdout}${r.stderr}`, /WRITE_IN_TARGET/);
      assert.equal(readFileSync(marker, "utf8"), before);
      assert.equal(existsSync(join(hard, "skill-tree.json")), false);
      assert.equal(existsSync(join(hard, "learn-tree.txt")), false);
    } finally {
      rmSync(hard, { recursive: true, force: true });
    }
  });
});

test("learn CLI refuses to write into the repo it studies", () => {
  withShop((fix) => {
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
});

test("learn CLI writes the map and the outline outside the repo", { timeout: 120_000 }, () => {
  withShop((fix) => {
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
});

test("checkMap scans once, reuses file text by hash, and stays inside a time budget", () => {
  const dir = mkdtempSync(join(tmpdir(), "peaceai-map-budget-"));
  try {
    mkdirSync(join(dir, "src"));
    const n = 24;
    for (let i = 0; i < n; i++) {
      const prev = i === 0 ? "" : `import { piece${i - 1} } from "./p${String(i - 1).padStart(2, "0")}.ts";\n`;
      writeFileSync(join(dir, "src", `p${String(i).padStart(2, "0")}.ts`), `${prev}export function piece${i}(x: number): number {\n  return x + ${i};\n}\n`);
    }
    resetLearnMapCache();
    const map = buildProgramMap(dir);
    resetLearnMapCache();
    const t0 = Date.now();
    const check = checkMap(map, dir);
    const ms = Date.now() - t0;
    assert.equal(check.scans, 1);
    assert.ok(check.parses > 0 && check.parses <= n, `parses ${check.parses}`);
    assert.deepEqual(check.wrong, []);
    assert.ok(ms < 2000, `checkMap took ${ms}ms`);
    const again = checkMap(map, dir);
    assert.equal(again.scans, 1);
    assert.equal(again.parses, 0);
    assert.deepEqual(again.wrong, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

function countUnits(nodes: GapNode[]): number {
  return nodes.reduce((s, n) => s + n.units, 0);
}
