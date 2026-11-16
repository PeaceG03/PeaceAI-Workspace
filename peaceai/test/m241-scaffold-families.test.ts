// Closed bounds, array quantifiers, and integer predicates. Synthetic calls only.
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { scaffoldPlan } from "../lib/testspec.ts";

const PATTERN = "^src/.+\\.ts$";
const root = resolve(import.meta.dirname, "../..");

function plan(name: string, body: string, output: string, read: (path: string) => string | null = () => null) {
  const text = `import ${name} from "./${name}.ts";\n${body}\n`;
  return scaffoldPlan(`src/${name}.test.ts`, text, output, PATTERN, [], read);
}

function named(name: string, body: string) {
  const text = `import { ${name} } from "./${name}.ts";\n${body}\n`;
  return scaffoldPlan(`src/${name}.test.ts`, text, `Cannot find module '/work/src/${name}.ts'`, PATTERN, [], () => null);
}

test("an integer class emits the closed example bound", () => {
  const above = named("above", [
    "assert.equal(above(-1), false);",
    "assert.equal(above(0), false);",
    "assert.equal(above(1), true);",
    "assert.equal(above(2), true);",
  ].join("\n"));
  assert.equal(above?.ok, true);
  if (above?.ok) {
    assert.match(above.files[0]!.content, /return a >= 1;/);
    assert.equal(above.files[0]!.content.includes("Number.isInteger"), false);
  }
  const wide = named("wide", "assert.equal(wide(0), false);\nassert.equal(wide(2), true);");
  assert.equal(wide?.ok, false);
});

test("a number array uses some or every, and a gap stays a refusal", () => {
  const attention = named("attention", [
    "assert.equal(attention([]), false);",
    "assert.equal(attention([0, 0]), false);",
    "assert.equal(attention([1, 0]), true);",
    "assert.equal(attention([0, 40]), true);",
    "assert.equal(attention([-5, 0]), false);",
  ].join("\n"));
  assert.equal(attention?.ok, true);
  if (attention?.ok) assert.match(attention.files[0]!.content, /return a\.some\(\(item\) => item >= 1\);/);
  const gap = named("gap", "assert.equal(gap([0]), false);\nassert.equal(gap([2]), true);");
  assert.equal(gap?.ok, false);
  if (gap && !gap.ok) assert.equal(gap.reason, "CANT_DO_YET_NO_BODY");
});

test("a non-integer rejection conjoins Number.isInteger, and a true fraction does not", () => {
  const whole = named("whole", [
    "assert.equal(whole(1), true);",
    "assert.equal(whole(6), true);",
    "assert.equal(whole(0), false);",
    "assert.equal(whole(-1), false);",
    "assert.equal(whole(1.5), false);",
    "assert.equal(whole(Infinity), false);",
  ].join("\n"));
  assert.equal(whole?.ok, true);
  if (whole?.ok) assert.match(whole.files[0]!.content, /return Number\.isInteger\(a\) && a >= 1;/);
  const fraction = named("fraction", [
    "assert.equal(fraction(-1), false);",
    "assert.equal(fraction(0), false);",
    "assert.equal(fraction(0.5), true);",
    "assert.equal(fraction(1), true);",
    "assert.equal(fraction(2), true);",
  ].join("\n"));
  assert.equal(fraction?.ok, false);
  const hole = named("hole", "assert.equal(hole(0), false);\nassert.equal(hole(2), true);\nassert.equal(hole(1.5), false);");
  assert.equal(hole?.ok, false);
});

test("one missing property is added to the default object, and two are not", () => {
  const mod = [
    "const base = {};",
    "const api = Object.assign(base, { left: 1 });",
    "export default api;",
    "",
  ].join("\n");
  const calls = "assert.equal(mod.left(0), false);\nassert.equal(mod.whole(1), true);\nassert.equal(mod.whole(6), true);\nassert.equal(mod.whole(0), false);\nassert.equal(mod.whole(-1), false);\nassert.equal(mod.whole(1.5), false);";
  const one = plan("mod", calls, "TypeError: mod.whole is not a function", (path) => path === "src/mod.ts" ? mod : null);
  assert.equal(one?.ok, true);
  if (one?.ok) {
    assert.match(one.files[0]!.content, /whole: whole/);
    assert.match(one.files[0]!.content, /export function whole/);
    assert.match(one.files[0]!.content, /Number\.isInteger\(a\) && a >= 1/);
    assert.equal(one.files[0]!.content.split("export default").length, 2);
  }
  const two = plan(
    "mod",
    "assert.equal(mod.left(1), true);\nassert.equal(mod.right(1), false);",
    "TypeError: mod.left is not a function\nTypeError: mod.right is not a function",
    (path) => path === "src/mod.ts" ? mod : null,
  );
  assert.equal(two?.ok, false);
  const doubled = [
    "const api = Object.assign({}, { a: 1 }, { b: 2 });",
    "export default api;",
    "",
  ].join("\n");
  const bags = plan("mod", calls, "TypeError: mod.whole is not a function", (path) => path === "src/mod.ts" ? doubled : null);
  assert.equal(bags?.ok, false);
  const present = [
    "const api = { whole: 1 };",
    "export default api;",
    "",
  ].join("\n");
  const again = plan("mod", calls, "TypeError: mod.whole is not a function", (path) => path === "src/mod.ts" ? present : null);
  assert.equal(again?.ok, false);
});

const base = resolve(root, "peaceai/test/.m241-mutants");
mkdirSync(base, { recursive: true });
let n = 0;
async function mutant(guard: string) {
  const text = readFileSync(resolve(root, "peaceai/lib/testspec.ts"), "utf8");
  const lines = text.split("\n");
  const hits = lines.flatMap((line, i) => (line.includes(`// ${guard}`) ? [i] : []));
  assert.equal(hits.length, 1, guard);
  const next = lines.filter((_, i) => i !== hits[0]).join("\n").replace(/from "\.\/([A-Za-z0-9-]+\.ts)"/g, (_m, file: string) => `from ${JSON.stringify(pathToFileURL(resolve(root, "peaceai/lib", file)).href)}`);
  const file = join(base, `mutant-${n++}.ts`);
  writeFileSync(file, next);
  return import(pathToFileURL(file).href);
}

test("deleting a scaffold guard admits the case it refused", async () => {
  const opened = await mutant("cmp-guard:closed-bound") as typeof import("../lib/testspec.ts");
  const above = opened.scaffoldPlan(
    "src/above.test.ts",
    'import { above } from "./above.ts";\nassert.equal(above(-1), false);\nassert.equal(above(0), false);\nassert.equal(above(1), true);\nassert.equal(above(2), true);\n',
    "Cannot find module '/work/src/above.ts'",
    PATTERN, [], () => null,
  );
  assert.equal(above?.ok, true);
  if (above?.ok) assert.match(above.files[0]!.content, /return a > 0;/);

  const quant = await mutant("quant-guard:one-class") as typeof import("../lib/testspec.ts");
  const gap = quant.scaffoldPlan(
    "src/gap.test.ts",
    'import { gap } from "./gap.ts";\nassert.equal(gap([0]), false);\nassert.equal(gap([2]), true);\n',
    "Cannot find module '/work/src/gap.ts'",
    PATTERN, [], () => null,
  );
  assert.equal(gap?.ok, true);

  const fraction = await mutant("int-guard:needs-fraction") as typeof import("../lib/testspec.ts");
  const bare = fraction.scaffoldPlan(
    "src/above.test.ts",
    'import { above } from "./above.ts";\nassert.equal(above(-1), false);\nassert.equal(above(0), false);\nassert.equal(above(1), true);\nassert.equal(above(2), true);\n',
    "Cannot find module '/work/src/above.ts'",
    PATTERN, [], () => null,
  );
  assert.equal(bare?.ok, false);

  const accepted = await mutant("int-guard:others-false") as typeof import("../lib/testspec.ts");
  const half = accepted.scaffoldPlan(
    "src/fraction.test.ts",
    'import { fraction } from "./fraction.ts";\nassert.equal(fraction(-1), false);\nassert.equal(fraction(0), false);\nassert.equal(fraction(0.5), true);\nassert.equal(fraction(1), true);\nassert.equal(fraction(2), true);\n',
    "Cannot find module '/work/src/fraction.ts'",
    PATTERN, [], () => null,
  );
  assert.equal(half?.ok, true);
  if (half?.ok) assert.match(half.files[0]!.content, /Number\.isInteger/);

  const classes = await mutant("int-guard:one-class") as typeof import("../lib/testspec.ts");
  const hole = classes.scaffoldPlan(
    "src/hole.test.ts",
    'import { hole } from "./hole.ts";\nassert.equal(hole(0), false);\nassert.equal(hole(2), true);\nassert.equal(hole(1.5), false);\n',
    "Cannot find module '/work/src/hole.ts'",
    PATTERN, [], () => null,
  );
  assert.equal(hole?.ok, true);

  const mod = "const api = Object.assign({}, { a: 1 }, { b: 2 });\nexport default api;\n";
  const calls = 'import mod from "./mod.ts";\nassert.equal(mod.left(0), false);\nassert.equal(mod.whole(1), true);\nassert.equal(mod.whole(6), true);\nassert.equal(mod.whole(0), false);\nassert.equal(mod.whole(-1), false);\nassert.equal(mod.whole(1.5), false);\n';
  const bags = await mutant("prop-guard:one-object") as typeof import("../lib/testspec.ts");
  const attached = bags.scaffoldPlan("src/mod.test.ts", calls, "TypeError: mod.whole is not a function", PATTERN, [], (path) => path === "src/mod.ts" ? mod : null);
  assert.equal(attached?.ok, true);

  const many = await mutant("prop-guard:one-prop") as typeof import("../lib/testspec.ts");
  const pair = many.scaffoldPlan(
    "src/mod.test.ts",
    'import mod from "./mod.ts";\nassert.equal(mod.left(1), true);\nassert.equal(mod.right(1), false);\n',
    "TypeError: mod.left is not a function\nTypeError: mod.right is not a function",
    PATTERN, [],
    () => "const api = { kept: 1 };\nexport default api;\n",
  );
  assert.equal(pair?.ok, true);

  const present = await mutant("prop-guard:present") as typeof import("../lib/testspec.ts");
  const again = present.scaffoldPlan(
    "src/mod.test.ts",
    calls,
    "TypeError: mod.whole is not a function",
    PATTERN, [],
    (path) => path === "src/mod.ts" ? "const api = { whole: 1 };\nexport default api;\n" : null,
  );
  assert.equal(again?.ok, true);

  const member = await mutant("prop-guard:member") as typeof import("../lib/testspec.ts");
  const receiver = member.scaffoldPlan(
    "src/mod.test.ts",
    calls,
    "TypeError: mod.whole is not a function",
    PATTERN, [],
    (path) => path === "src/mod.ts" ? "const base = {};\nconst api = Object.assign(base, { left: 1 });\nexport default api;\n" : null,
  );
  assert.equal(receiver?.ok, false);
  rmSync(base, { recursive: true, force: true });
});
