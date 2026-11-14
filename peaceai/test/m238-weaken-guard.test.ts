// Text flips are strict only when probes match the fix. Fixtures are bakery code written for these tests.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { finishTextRow, gradeTextCandidate } from "../bin/practice-replay.ts";
import { gradePracticeRow, replayDocument, seededIdiom, sourcePaths, textFlipBehavior } from "../lib/practicereplay.ts";
import { visibleNodeBin } from "../lib/practicemine.ts";
import { gradeBehavior, type Behavior } from "../lib/specgrade.ts";
import { behaviorTargets, changedFunctionNames, declaredExport } from "../lib/testspec.ts";

const nodePath = visibleNodeBin() ?? process.execPath;

function grade(candidate: string, fix: string, args: unknown[][], target: { symbol: string; exportName: string; form?: "named" | "named-prop"; prop?: string } = { symbol: "warm", exportName: "warm" }): Behavior {
  const write = (text: string) => {
    const root = mkdtempSync(join(tmpdir(), "peaceai-guard-"));
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "src/oven.ts"), text);
    return root;
  };
  const left = write(candidate);
  const right = write(fix);
  try {
    return gradeBehavior({
      candidateRoot: left, fixRoot: right, nodePath,
      target: { symbol: target.symbol, file: "src/oven.ts", form: target.form ?? "named", exportName: target.exportName, prop: target.prop, args },
    }).behavior;
  } finally {
    rmSync(left, { recursive: true, force: true });
    rmSync(right, { recursive: true, force: true });
  }
}

const range = "export function warm(n: number): boolean {\n  return n > 0 && n < 10;\n}\n";

test("thirteen weakenings are not strict, and an equivalent rewrite still can be", () => {
  const weak: [string, string, unknown[][]][] = [
    ["export function warm(n: number): boolean {\n  return n > 0;\n}\n", range, [[3], [12]]],
    ["export function warm(n: number): boolean {\n  if (n > 0) return true;\n  return n < 10;\n}\n", range, [[12]]],
    ["export function warm(n: number): boolean {\n  if (n > 0) return true;\n  return true;\n}\n", range, [[-1]]],
    ["function ready(n: number): boolean { return n > 0; }\nexport { ready as warm };\n", range, [[12]]],
    ["export function warm(n: number): boolean {\n  return n;\n}\n", "export function warm(n: number): number {\n  if (n < 0) throw new RangeError(\"cold\");\n  return n;\n}\n", [[-1]]],
    ["export function warm(n: number): boolean {\n  return n >= 0 || n < 0;\n}\n", range, [[12]]],
    ["export function warm(n: number): boolean {\n  return n < 10;\n}\n", range, [[-1]]],
    ["export function warm(n: number): boolean {\n  return n >= 0;\n}\n", "export function warm(n: number): boolean {\n  return n > 0;\n}\n", [[0]]],
    ["export function warm(batch: { hot: boolean } | null): boolean {\n  return Boolean(batch && batch.hot);\n}\n", "export function warm(batch: { hot: boolean } | null): boolean {\n  if (!batch) return false;\n  return batch.hot;\n}\n", [[null]]],
    ["export function warm(n: number): boolean {\n  if (n > 0) return true;\n  return false;\n}\n", "export function warm(n: number): boolean {\n  if (n > 0 && n < 10) return true;\n  return false;\n}\n", [[12]]],
    ["export function warm(n: number): boolean {\n  return true;\n}\n", range, [[-1]]],
    ["export function warm(n: number): boolean {\n  return n === n || n > 100;\n}\n", range, [[12]]],
  ];
  assert.equal(weak.length, 12);
  const method = grade(
    "export const oven = { warm(n: number): boolean { return n > 0; } };\n",
    "export const oven = { warm(n: number): boolean { return n > 0 && n < 10; } };\n",
    [[12]],
    { symbol: "warm", exportName: "oven", form: "named-prop", prop: "warm" },
  );
  assert.notEqual(method, "verified_strict");
  for (const [candidate, fix, args] of weak) assert.notEqual(grade(candidate, fix, args), "verified_strict");
  assert.equal(grade(
    "export function warm(a: boolean, b: boolean): boolean {\n  return !a || !b;\n}\n",
    "export function warm(a: boolean, b: boolean): boolean {\n  return !(a && b);\n}\n",
    [[true, true]],
  ), "verified_strict");
  assert.equal(grade(
    "export function warm(label: string): boolean {\n  return new RegExp(\"^loaf \").test(label);\n}\n",
    "export function warm(label: string): boolean {\n  return /^loaf /.test(label);\n}\n",
    [["loaf rye"]],
  ), "verified_strict");
});

test("a recorded text flip is strict only when the probes match the fix", () => {
  const repo = mkdtempSync(join(tmpdir(), "peaceai-text-probe-"));
  const git = (...args: string[]) => spawnSync("git", ["-C", repo, ...args], { encoding: "utf8" });
  const file = join(repo, "src/oven.ts");
  const testFile = join(repo, "test/oven.test.ts");
  const testText = "import assert from \"node:assert/strict\";\nimport { warm } from \"../src/oven.ts\";\nassert.equal(warm(3), true);\n";
  try {
    git("init", "-q");
    git("config", "user.email", "guard@example.com");
    git("config", "user.name", "guard");
    mkdirSync(join(repo, "src"));
    mkdirSync(join(repo, "test"));
    writeFileSync(file, "export function warm(n: number): boolean {\n  return n > 0;\n}\n");
    writeFileSync(testFile, testText);
    git("add", ".");
    git("commit", "-q", "-m", "base");
    const base = git("rev-parse", "HEAD").stdout.trim();
    writeFileSync(file, range);
    git("add", "src/oven.ts");
    git("commit", "-q", "-m", "fix");
    const fix = git("rev-parse", "HEAD").stdout.trim();
    git("checkout", "-q", base);
    writeFileSync(file, "export function warm(n: number): boolean {\n  return n > 0; // still wide\n}\n");
    const weakDiff = git("diff", "--", "src/oven.ts").stdout;
    const weak = gradeTextCandidate({
      repoDir: repo, baseSha: base, fixSha: fix, diff: weakDiff, testFile: "test/oven.test.ts",
      sourcePattern: "^src/.*\\.ts$", nodePath,
    });
    const row = gradePracticeRow({
      scorable: true, core: "ok", job: { status: "pass", reason: "JOB_A_CANDIDATES:1" }, gatePass: true,
      beforeExit: 1, afterExit: 0, behavior: textFlipBehavior(true, weak),
    });
    assert.equal(row.reason, "VERIFIED_TEST_ONLY");
    writeFileSync(file, range);
    const sameDiff = git("diff", "--", "src/oven.ts").stdout;
    const same = gradeTextCandidate({
      repoDir: repo, baseSha: base, fixSha: fix, diff: sameDiff, testFile: "test/oven.test.ts",
      sourcePattern: "^src/.*\\.ts$", nodePath,
    });
    assert.equal(textFlipBehavior(true, same), "verified_strict");
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("a changed function the test does not call is not strict", () => {
  const repo = mkdtempSync(join(tmpdir(), "peaceai-text-cover-"));
  const git = (...args: string[]) => spawnSync("git", ["-C", repo, ...args], { encoding: "utf8" });
  const file = join(repo, "src/predicates.ts");
  const testFile = join(repo, "test/predicates.test.ts");
  const fixSource = [
    "export function isPositive(value: unknown): boolean { return typeof value === \"number\" && value > 0; }",
    "export function isClass(value: unknown): boolean { return typeof value === \"function\" && /^class(\\s+|{)/.test(Function.prototype.toString.call(value)); }",
    "",
  ].join("\n");
  const baseSource = fixSource;
  const testText = [
    "import assert from \"node:assert/strict\";",
    "import { isPositive, isClass } from \"../src/predicates.ts\";",
    "assert.equal(isPositive(1), true);",
    "for (const value of [class {}, function () {}]) { assert.equal(isClass(value), true); }",
    "",
  ].join("\n");
  const row = {
    scorable: true, core: "ok" as const, job: { status: "pass" as const, reason: "JOB_A_CANDIDATES:1" },
    gatePass: true, beforeExit: 1, afterExit: 0,
  };
  try {
    git("init", "-q");
    git("config", "user.email", "guard@example.com");
    git("config", "user.name", "guard");
    mkdirSync(join(repo, "src"));
    mkdirSync(join(repo, "test"));
    writeFileSync(file, baseSource);
    writeFileSync(testFile, testText);
    git("add", ".");
    git("commit", "-q", "-m", "base");
    const base = git("rev-parse", "HEAD").stdout.trim();
    writeFileSync(file, `${fixSource}\n`);
    git("add", "src/predicates.ts");
    git("commit", "-q", "-m", "fix");
    const fix = git("rev-parse", "HEAD").stdout.trim();
    git("checkout", "-q", base);
    writeFileSync(file, fixSource.replace(
      "return typeof value === \"function\" && /^class(\\s+|{)/.test(Function.prototype.toString.call(value));",
      "return typeof value === \"function\";",
    ));
    const weakDiff = git("diff", "--", "src/predicates.ts").stdout;
    const weak = gradeTextCandidate({
      repoDir: repo, baseSha: base, fixSha: fix, diff: weakDiff, testFile: "test/predicates.test.ts",
      sourcePattern: "^src/.*\\.ts$", nodePath,
    });
    assert.equal(weak.behavior, "verified_test_only");
    assert.ok(weak.compared > 0);
    const graded = finishTextRow(true, weak, row);
    assert.equal(graded.reason, "VERIFIED_TEST_ONLY");
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("no recognized call and a diff that cannot be loaded are not strict", () => {
  const repo = mkdtempSync(join(tmpdir(), "peaceai-text-safe-"));
  const git = (...args: string[]) => spawnSync("git", ["-C", repo, ...args], { encoding: "utf8" });
  const row = {
    scorable: true, core: "ok" as const, job: { status: "pass" as const, reason: "JOB_A_CANDIDATES:1" },
    gatePass: true, beforeExit: 1, afterExit: 0,
  };
  try {
    git("init", "-q");
    git("config", "user.email", "guard@example.com");
    git("config", "user.name", "guard");
    mkdirSync(join(repo, "src"));
    mkdirSync(join(repo, "test"));
    writeFileSync(join(repo, "src/oven.ts"), "export const label = \"cold\";\nexport function warm(n: number): boolean { return n > 0; }\n");
    writeFileSync(join(repo, "test/oven.test.ts"), "import \"../src/oven.ts\";\n");
    git("add", ".");
    git("commit", "-q", "-m", "base");
    const base = git("rev-parse", "HEAD").stdout.trim();
    writeFileSync(join(repo, "src/oven.ts"), "export const label = \"warm\";\nexport function warm(n: number): boolean { return n > 0; }\n");
    git("add", "src/oven.ts");
    git("commit", "-q", "-m", "fix");
    const fix = git("rev-parse", "HEAD").stdout.trim();
    git("checkout", "-q", base);
    writeFileSync(join(repo, "src/oven.ts"), "export const label = \"warm\";\nexport function warm(n: number): boolean { return n > 0; }\n");
    const diff = git("diff", "--", "src/oven.ts").stdout;
    const empty = gradeTextCandidate({
      repoDir: repo, baseSha: base, fixSha: fix, diff, testFile: "test/oven.test.ts",
      sourcePattern: "^src/.*\\.ts$", nodePath,
    });
    assert.notEqual(empty.behavior, "verified_strict");
    assert.notEqual(finishTextRow(true, empty, row).reason, "GATE_PASS_AND_TEST");
    const missing = gradeTextCandidate({
      repoDir: repo, baseSha: base, fixSha: "0".repeat(40), diff, testFile: "test/oven.test.ts",
      sourcePattern: "^src/.*\\.ts$", nodePath,
    });
    assert.notEqual(missing.behavior, "verified_strict");
    assert.notEqual(finishTextRow(true, missing, row).reason, "GATE_PASS_AND_TEST");
    assert.equal(finishTextRow(true, { behavior: "verified_test_only", compared: 2 }, row).reason, "VERIFIED_TEST_ONLY");
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("source paths skip test files and test directories", () => {
  const diff = [
    "--- a/src/oven.ts", "+++ b/src/oven.ts",
    "--- a/test/oven.ts", "+++ b/test/oven.ts",
    "--- a/__tests__/oven.ts", "+++ b/__tests__/oven.ts",
    "--- a/src/oven.test.ts", "+++ b/src/oven.test.ts",
    "",
  ].join("\n");
  assert.deepEqual(sourcePaths(diff), ["src/oven.ts"]);
});

test("a property on the default object resolves to the exported function", () => {
  const source = [
    "export function isPositiveNumber(value: unknown): boolean { return typeof value === \"number\" && value > 0; }",
    "export function isClass(value: unknown): boolean { return typeof value === \"function\"; }",
    "const is = Object.assign(isClass, { positiveNumber: isPositiveNumber, class: isClass });",
    "export default is;",
    "",
  ].join("\n");
  assert.equal(declaredExport(source, "default", "positiveNumber"), "isPositiveNumber");
  assert.equal(declaredExport(source, "default", "class"), "isClass");
  assert.equal(declaredExport(source, "default", "missing"), null);
  const testText = [
    "import is from \"../source/index.js\";",
    "import assert from \"node:assert/strict\";",
    "assert.equal(is.positiveNumber(6), true);",
    "for (const value of [class {}]) { assert.equal(is.class(value), true); }",
    "",
  ].join("\n");
  const read = (path: string) => path === "source/index.ts" ? source : null;
  const targets = behaviorTargets("test/test.ts", testText, "^source/.+\\.ts$", [], (path) => path === "source/index.ts", read);
  assert.deepEqual(targets.map((target) => target.symbol), ["isPositiveNumber"]);
  assert.equal(targets[0]?.exportName, "isPositiveNumber");
});

test("seeded idiom rows are excluded from credit, and a held-out row with the same sha is not", () => {
  const dev = { repo: "sindresorhus/is", split: "dev" as const, fixSha: "cb4ee0e92cd3bff8353bb6738bd1f54db87dc293", status: "pass" as const, reason: "GATE_PASS_AND_TEST", gap: false, understanding: "text" as const };
  const held = { ...dev, split: "held-out" as const, status: "fail" as const, reason: "VERIFIED_TEST_ONLY", gap: true };
  const defu = { repo: "unjs/defu", split: "dev" as const, fixSha: "11ba02213d4b1c6b02dd686041f75edc479c98e9", status: "pass" as const, reason: "GATE_PASS_AND_TEST", gap: false, understanding: "text" as const };
  assert.equal(seededIdiom(dev), "enum-values");
  assert.equal(seededIdiom(held), null);
  assert.equal(seededIdiom(defu), "own-keys");
  const doc = replayDocument([dev, held, defu]);
  assert.deepEqual(doc.excludedFromCredit.map((row) => row.idiom).sort(), ["enum-values", "own-keys"]);
  assert.equal(doc.excludedFromCredit.every((row) => row.split === "dev"), true);
  assert.equal(doc.counts.text.dev.pass, 2);
  assert.equal(doc.creditCounts.text.dev.pass, 0);
});

test("the is class fix and its weakenings are graded on the dev repo", { timeout: 180_000 }, () => {
  const repo = mkdtempSync(join(tmpdir(), "peaceai-is-grade-"));
  const git = (...args: string[]) => spawnSync("git", ["-C", repo, ...args], { encoding: "utf8" });
  const baseSha = "d22ab629916392104a69b34387008ca2a2cc3ddd";
  const fixSha = "e7c84fcb797ea9857fa56750688440bf3f347589";
  const pattern = "^source/[A-Za-z0-9._-]+(?:/[A-Za-z0-9._-]+)*\\.ts$";
  const deny = ["(^|/)\\.", "(^|/)fixtures/", "(^|/)fixture/", "secret", "credential", "token"];
  const fixReturn = "return isFunction(value) && /^class(\\s+|{)/.test(value.toString());";
  const weaken: [string, string][] = [
    ["drop-class-check", "return isFunction(value);"],
    ["typeof-only", "return typeof value === \"function\";"],
    ["always-true", "return true;"],
    ["always-false", "return false;"],
    ["and-true", "return isFunction(value) && true;"],
    ["or-widen", "return isFunction(value) || /^class(\\s+|{)/.test(value.toString());"],
    ["drop-function-check", "return /^class(\\s+|{)/.test(String(value));"],
    ["broader-regex", "return isFunction(value) && /^class/.test(value.toString());"],
    ["includes-class", "return isFunction(value) && String(value).includes(\"class\");"],
    ["old-startsWith", "return isFunction(value) && value.toString().startsWith(\"class \");"],
    ["constant-pattern", "return isFunction(value) && /^class(\\s+|{)/.test(\"class {\");"],
    ["flipped-or", "return !isFunction(value) || /^class(\\s+|{)/.test(value.toString());"],
    ["equals-self", "return value === value;"],
    ["early-true", "if (isFunction(value)) return true;\n\treturn false;"],
    ["loose-null", "return value != null && isFunction(value);"],
    ["boolean-cast", "return Boolean(value);"],
    ["helper-true", "function seen(): boolean { return true; }\n\treturn isFunction(value) && seen();"],
  ];
  const equivalent: [string, string][] = [
    ["exact", fixReturn],
    ["de-morgan", "return !(!isFunction(value) || !/^class(\\s+|{)/.test(value.toString()));"],
    ["alt-regex", "return isFunction(value) && new RegExp(\"^class(\\\\s+|\\\\{)\").test(value.toString());"],
    ["helper", "function classText(value: Function): boolean { return /^class(\\s+|{)/.test(value.toString()); }\n\treturn isFunction(value) && classText(value);"],
  ];
  try {
    const cloned = git("clone", "--quiet", "--filter=blob:none", "--no-checkout", "https://github.com/sindresorhus/is.git", ".");
    assert.equal(cloned.status, 0, cloned.stderr);
    for (const sha of [baseSha, fixSha]) assert.equal(git("fetch", "--quiet", "--depth", "1", "origin", sha).status, 0, sha);
    const fixSource = git("show", `${fixSha}:source/index.ts`).stdout;
    const testText = git("show", `${fixSha}:test/test.ts`).stdout;
    assert.ok(fixSource.includes(fixReturn));
    const read = (path: string) => path === "source/index.ts" ? fixSource : null;
    const symbols = behaviorTargets("test/test.ts", testText, pattern, deny, (path) => path === "source/index.ts" || path === "source/utilities.ts" || path === "source/types.ts", read).map((target) => target.symbol);
    assert.ok(symbols.includes("isPositiveNumber"), symbols.join(","));
    assert.ok(!symbols.includes("positiveNumber"));
    assert.ok(!symbols.includes("isClass"));
    git("checkout", "--quiet", "--detach", baseSha);
    const gradeAt = (source: string) => {
      writeFileSync(join(repo, "source/index.ts"), source);
      const diff = git("diff", "--", "source/index.ts").stdout;
      return gradeTextCandidate({
        repoDir: repo, baseSha, fixSha, diff, testFile: "test/test.ts",
        sourcePattern: pattern, denyPatterns: deny, nodePath,
      });
    };
    const reason = (source: string, grade: { behavior: string; compared: number }) => {
      const changed = changedFunctionNames(git("show", `${baseSha}:source/index.ts`).stdout, source);
      const hit = changed.filter((name) => symbols.includes(name));
      if (grade.behavior === "diff_unavailable" || grade.compared === 0) return "probes-unavailable";
      if (changed.some((name) => !symbols.includes(name)) && hit.length === 0) return "probes-unavailable";
      if (grade.behavior !== "verified_strict") return "behavior-compared";
      return "strict";
    };
    for (const [name, body] of equivalent) {
      const source = fixSource.replace(fixReturn, body);
      const grade = gradeAt(source);
      assert.ok(grade.compared > 0, `${name} compared ${grade.compared} ${grade.behavior}`);
      assert.equal(grade.behavior, "verified_test_only", name);
      assert.equal(grade.counterexample, undefined, name);
      console.log(`is-equivalent ${name} verdict=${grade.behavior} compared=${grade.compared} disagreed=false ${reason(source, grade)}`);
    }
    assert.equal(weaken.length, 17);
    for (const [name, body] of weaken) {
      const source = fixSource.replace(fixReturn, body);
      const grade = gradeAt(source);
      const why = reason(source, grade);
      assert.notEqual(grade.behavior, "verified_strict", name);
      console.log(`is-weakening ${name} verdict=${grade.behavior} compared=${grade.compared} disagreed=${Boolean(grade.counterexample)} ${why}`);
    }
    const positiveReturn = "return isNumber(value) && value > 0;";
    assert.equal(fixSource.includes(positiveReturn), true);
    const checker = [
      "import { registerHooks } from 'node:module';",
      "import { fileURLToPath, pathToFileURL } from 'node:url';",
      "import { existsSync } from 'node:fs';",
      "registerHooks({ resolve(specifier, context, nextResolve) {",
      "  const relative = specifier.startsWith('./') || specifier.startsWith('../');",
      "  const swap = specifier.endsWith('.mjs') ? [4, '.mts'] : specifier.endsWith('.js') ? [3, '.ts'] : null;",
      "  if (!relative || !swap) return nextResolve(specifier, context);",
      "  try { return nextResolve(specifier, context); }",
      "  catch {",
      "    const mapped = specifier.slice(0, -swap[0]) + swap[1];",
      "    const resolved = nextResolve(mapped, context);",
      "    if (!existsSync(fileURLToPath(resolved.url))) return nextResolve(specifier, context);",
      "    return resolved;",
      "  }",
      "}});",
      "const mod = await import(pathToFileURL(process.argv[2]).href);",
      "const is = mod.default;",
      "const yes = (value) => is.positiveNumber(value) === true;",
      "const no = (value) => is.positiveNumber(value) === false;",
      "let pass = [6, 1.4, Infinity].every(yes) && [0, -0, -6, -1.4, -Infinity].every(no);",
      "class Foo {}",
      "class Bar extends Foo {}",
      "const minified = new Function('return class{};')();",
      "pass = pass && is.class(Foo) && is.class(Bar) && is.class(minified);",
      "process.exit(pass ? 0 : 1);",
      "",
    ].join("\n");
    const checkFile = join(repo, "check-recorded.mjs");
    writeFileSync(checkFile, checker);
    const recorded = (source: string) => {
      writeFileSync(join(repo, "source/index.ts"), source);
      return spawnSync(nodePath, ["--experimental-strip-types", checkFile, join(repo, "source/index.ts")], { encoding: "utf8" }).status;
    };
    const baseSource = git("show", `${baseSha}:source/index.ts`).stdout;
    assert.equal(recorded(baseSource), 1, "base recorded checks");
    assert.equal(recorded(fixSource), 0, "fix recorded checks");
    const positive: [string, string][] = [
      ["greater", "return (value as number) > 0;"],
      ["number-cast", "return Number(value) > 0;"],
      ["boolean-and", "return Boolean(value) && (value as number) > 0;"],
      ["not-string", "return typeof value !== \"string\" && (value as number) > 0;"],
      ["not-null", "return value != null && (value as number) > 0;"],
      ["open-below", "return isNumber(value) && value > -0.5 && value !== 0;"],
      ["sign", "return Math.sign(value as number) === 1;"],
      ["unary-plus", "return +value > 0;"],
      ["else-branch", "return isNumber(value) ? value > 0 : (value as number) > 0 && typeof value !== \"object\";"],
      ["not-le", "return !((value as number) <= 0);"],
      ["not-array", "return (value as number) > 0 && !Array.isArray(value);"],
      ["not-string-tag", "return Object.prototype.toString.call(value) !== \"[object String]\" && (value as number) > 0;"],
      ["bigint-or", "return (isNumber(value) && value > 0) || typeof value === \"bigint\";"],
      ["gte-epsilon", "return (value as number) >= 1e-12 && ((value as number) > 0 || value === Number.POSITIVE_INFINITY);"],
      ["skip-boolean", "return (value as number) > 0 && typeof value !== \"boolean\";"],
    ];
    assert.ok(positive.length >= 12 && positive.length <= 17);
    for (const [name, body] of positive) {
      const source = fixSource.replace(positiveReturn, body);
      const exit = recorded(source);
      assert.equal(exit, 0, `${name} recorded exit ${exit}`);
      const grade = gradeAt(source);
      assert.notEqual(grade.behavior, "verified_strict", name);
      if (name === "open-below" || name === "not-le" || name === "gte-epsilon") assert.ok(grade.counterexample, name);
      console.log(`is-positive ${name} verdict=${grade.behavior} compared=${grade.compared} disagreed=${Boolean(grade.counterexample)}`);
    }
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});
