// Test-as-spec. A tiny fixture, not a practice row. credit: false.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { openRepo } from "../lib/codesearch.ts";
import { CALLEE_DEPTH, locate, MAX_CANDIDATES } from "../lib/editpropose.ts";
import { MAX_ATTEMPTS } from "../lib/loop.ts";
import { GIT_LOCK_ARGS, practiceGit, practiceGitEnv, practiceSandboxReady, visibleNodeBin } from "../lib/practicemine.ts";
import { classifyRunnerOutput, expectationsIn, originalSuiteArgv, runTestSpec, sanitizeRunnerLines, scaffoldPlan, SPEC_ATTEMPT_CAP, specTask, type SpecInput } from "../lib/testspec.ts";

const PATTERN = "^src/.+\\.ts$";

function git(root: string, args: string[]): void {
  const ran = practiceGit(root, ["-c", "user.email=fixture@example.com", "-c", "user.name=Fixture", ...args]);
  if (!ran.ok) throw new Error(ran.out || "git failed");
}

function repo(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "peaceai-spec-"));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(root, path, ".."), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  git(root, ["init", "-q"]);
  git(root, ["add", "-A"]);
  git(root, ["commit", "-q", "-m", "base"]);
  return root;
}

const pad = `export function pad(n: number): number {\n  return n + 0;\n}\n`;
const keep = `export function keep(n: number): number {\n  return n;\n}\n`;
const padTest = `import assert from "node:assert/strict";\nimport test from "node:test";\nimport { pad } from "./pad.ts";\ntest("pad of 2", () => { assert.equal(pad(2), 3); });\n`;
const keepTest = `import assert from "node:assert/strict";\nimport test from "node:test";\nimport { keep } from "./keep.ts";\ntest("keep of 2", () => { assert.equal(keep(2), 2); });\n`;

test("the attempt cap stays inside the loop and the proposer caps", () => {
  assert.equal(SPEC_ATTEMPT_CAP, Math.min(MAX_ATTEMPTS, MAX_CANDIDATES));
  assert.ok(SPEC_ATTEMPT_CAP <= MAX_ATTEMPTS);
  assert.equal(specTask("Fix the total"), "make this failing test pass, context: Fix the total");
  assert.deepEqual(originalSuiteArgv(["node", "--test", "src/pad.test.ts"], "src/pad.test.ts", "full"), ["node", "--test"]);
  assert.deepEqual(
    originalSuiteArgv(["node", "--test", "src/pad.test.ts"], "src/pad.test.ts", "related", ["src/keep.test.ts"]),
    ["node", "--test", "src/pad.test.ts", "src/keep.test.ts"],
  );
  const source = readFileSync(join(import.meta.dirname, "../lib/testspec.ts"), "utf8");
  assert.equal(source.includes("git push"), false);
  assert.equal(source.includes("runInPracticeSandbox"), true);
  assert.equal(source.includes("practiceGit"), true);
  assert.equal(source.includes("poisonStamp"), true);
  assert.equal(source.includes("spawnSync"), false);
});

function specInput(root: string, file: string, extra: Partial<SpecInput> = {}): SpecInput {
  const nodePath = visibleNodeBin();
  if (!nodePath) throw new Error("no visible node");
  return {
    root, subject: "fixture", testFile: file,
    testCommand: [nodePath, "--experimental-strip-types", "--test", file],
    sourcePattern: PATTERN, toolchain: { nodePath }, ...extra,
  };
}

const VITEST_FAIL = [
  "FAIL  src/num.test.ts > pad",
  "AssertionError: expected 2 to be 3 // Object.is equality",
  "- Expected",
  "+ Received",
  "- 3",
  "+ 2",
].join("\n");
const NODE_FAIL = [
  "not ok 1 - pad",
  "error: |-",
  "  Expected values to be strictly equal:",
  "  2 !== 3",
  "code: 'ERR_ASSERTION'",
  "name: 'AssertionError'",
  "operator: 'strictEqual'",
].join("\n");
const AVA_FAIL = [
  "✘ [fail]: pad",
  "Difference (- actual, + expected):",
  "- 2",
  "+ 3",
  "1 test failed",
].join("\n");

test("runner output from vitest, node:assert, and ava is told apart from a startup error", () => {
  assert.equal(classifyRunnerOutput(VITEST_FAIL, 1), "assertion_seen");
  assert.equal(classifyRunnerOutput(NODE_FAIL, 1), "assertion_seen");
  assert.equal(classifyRunnerOutput(AVA_FAIL, 1), "assertion_seen");
  assert.equal(classifyRunnerOutput("bwrap: Can't mkdir <work>/.git: Not a directory", 1), "runner_error");
  assert.equal(classifyRunnerOutput("Error [ERR_MODULE_NOT_FOUND]: Cannot find module './missing'\nnot ok 1 - file", 1), "runner_error");
  assert.equal(classifyRunnerOutput("TAP version 13\n# tests 1\n# pass 1\n# fail 0", 0), "no_failure");
  const lines = sanitizeRunnerLines(`AssertionError: expected 2 to be 3\n at /tmp/secret/src/num.test.ts:3\nTOKEN=hidden`, "/tmp/secret");
  assert.equal(lines.some((line) => line.includes("/tmp/secret") || line.includes("TOKEN=")), false);
  assert.ok(lines.some((line) => line.includes("expected 2 to be 3")));
  const text = [
    'import { expect, test } from "vitest";',
    'import testAva from "ava";',
    'import assert from "node:assert/strict";',
    'import { pad } from "./num.ts";',
    'test("pad", () => { expect(pad(2)).toBe(3); expect(pad(1)).toEqual(2); });',
    'testAva("pad", t => { t.is(pad(2), 3); t.true(pad(1)); t.false(pad(0)); t.throws(() => pad(-1)); });',
    'test("node", () => { assert.strictEqual(pad(2), 3); assert.equal(pad(0), 0); assert.ok(pad(4)); });',
  ].join("\n");
  const found = expectationsIn("src/num.test.ts", text, "^src/.+\\.ts$", [], (path) => path === "src/num.ts");
  assert.ok(found.some((row) => row.symbol === "pad" && row.expected === "3" && row.input === "2"));
  assert.ok(found.some((row) => row.expected === "2" && row.input === "1"));
  assert.ok(found.some((row) => row.kind === "boolean" && row.expected === "true"));
  assert.ok(found.some((row) => row.kind === "boolean" && row.expected === "false"));
  assert.ok(found.some((row) => row.kind === "throws"));
  assert.ok(found.filter((row) => row.symbol === "pad").length >= 5);
});

test("repair-v2 makes the failing test pass and leaves the other function alone", (t) => {
  if (!practiceSandboxReady()) { t.skip("bwrap is not installed on this host"); return; }
  const root = repo({ "src/pad.ts": pad, "src/keep.ts": keep, "src/pad.test.ts": padTest, "src/keep.test.ts": keepTest });
  try {
    const got = runTestSpec(specInput(root, "src/pad.test.ts", {
      subject: "pad is short by one", originalSuite: "related", relatedTests: ["src/keep.test.ts"],
    }));
    assert.equal(got.status, "diff", got.status === "diff" ? "" : got.reason);
    if (got.status !== "diff") return;
    assert.match(got.diff, /n \+ 0/);
    assert.match(got.diff, /n \+ 1/);
    assert.equal(got.diff.includes("keep"), false);
    assert.equal(readFileSync(join(root, "src/pad.ts"), "utf8").includes("n + 0"), true);
    const applied = spawnSync("git", ["-C", root, ...GIT_LOCK_ARGS, "apply", "--whitespace=nowarn", "-"], { input: got.diff, encoding: "utf8", env: practiceGitEnv() });
    assert.equal(applied.status, 0, applied.stderr);
    const nodePath = visibleNodeBin()!;
    const after = spawnSync(nodePath, ["--experimental-strip-types", "--test", "src/pad.test.ts", "src/keep.test.ts"], { cwd: root, encoding: "utf8" });
    assert.equal(after.status, 0, `${after.stdout ?? ""}\n${after.stderr ?? ""}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a missing symbol, an irreducible assertion, a string the templates cannot edit, and the cap are refusals", (t) => {
  if (!practiceSandboxReady()) { t.skip("bwrap is not installed on this host"); return; }
  const bare = repo({
    "src/pad.ts": pad,
    "src/keep.ts": keep,
    "src/bare.test.ts": `import assert from "node:assert/strict";\nimport test from "node:test";\ntest("numbers", () => { assert.equal(1, 2); });\n`,
  });
  const vague = repo({
    "src/pad.ts": pad,
    "src/keep.ts": keep,
    "src/pad.test.ts": `import assert from "node:assert/strict";\nimport test from "node:test";\nimport { pad } from "./pad.ts";\ntest("pad", () => { assert.ok(pad(1) < 0); });\n`,
  });
  const text = repo({
    "src/tag.ts": `export function tag(s: string): string {\n  return "no-" + s;\n}\n`,
    "src/tag.test.ts": `import assert from "node:assert/strict";\nimport test from "node:test";\nimport { tag } from "./tag.ts";\ntest("tag", () => { assert.equal(tag("a"), "a"); });\n`,
  });
  const capped = repo({ "src/pad.ts": pad, "src/keep.ts": keep, "src/pad.test.ts": padTest, "src/keep.test.ts": keepTest });
  try {
    const noSymbol = runTestSpec(specInput(bare, "src/bare.test.ts", { subject: "numbers" }));
    assert.equal(noSymbol.status, "cant");
    if (noSymbol.status === "cant") assert.equal(noSymbol.reason, "CANT_DO_YET_NO_SYMBOL");
    const irreducible = runTestSpec(specInput(vague, "src/pad.test.ts", { subject: "pad" }));
    assert.equal(irreducible.status, "cant");
    if (irreducible.status === "cant") assert.equal(irreducible.reason, "CANT_DO_YET_ASSERTION_UNREDUCIBLE");
    const unverified = runTestSpec(specInput(text, "src/tag.test.ts", { subject: "tag drops its prefix" }));
    assert.equal(unverified.status, "cant");
    if (unverified.status === "cant") assert.equal(unverified.reason, "CANT_DO_YET_NO_VERIFY");
    const cap = runTestSpec(specInput(capped, "src/pad.test.ts", {
      subject: "pad is short by one", originalSuite: "related", relatedTests: ["src/keep.test.ts"], maxAttempts: 1,
    }));
    assert.equal(cap.status, "cant");
    if (cap.status === "cant") assert.equal(cap.reason, "CANT_DO_YET_CAP");
    assert.equal(readFileSync(join(capped, "src/pad.ts"), "utf8").includes("n + 0"), true);
  } finally {
    rmSync(bare, { recursive: true, force: true });
    rmSync(vague, { recursive: true, force: true });
    rmSync(text, { recursive: true, force: true });
    rmSync(capped, { recursive: true, force: true });
  }
});

const aliasFn = `export function atLeastOne(n: number): boolean {\n  return n > 1;\n}\nexport const box = { atLeast: atLeastOne };\n`;
const aliasArrow = `export const atLeastOne = (n: number): boolean => n > 1;\nexport const box = { atLeast: atLeastOne };\n`;
const aliasAssign = `export function atLeastOne(n: number): boolean {\n  return n > 1;\n}\nexport const box: { atLeast?: (n: number) => boolean } = {};\nbox.atLeast = atLeastOne;\n`;

test("repair-v2 follows an object property, an assignment, and a const arrow to the function", () => {
  const shapes: [string, string][] = [["alias.ts", aliasFn], ["assign.ts", aliasAssign], ["arrow.ts", aliasArrow]];
  for (const [file, source] of shapes) {
    const root = repo({ [`src/${file}`]: source });
    try {
      const text = readFileSync(join(root, "src", file), "utf8");
      const request = { request: "`atLeast`", failing: [] as string[] };
      const v1 = locate(openRepo(root), request, CALLEE_DEPTH.v1);
      const v2 = locate(openRepo(root), request, CALLEE_DEPTH.v2);
      const covers = (sites: { path: string; start: number; end: number }[]) => sites.some((site) => site.path === `src/${file}` && text.slice(site.start, site.end).includes("n > 1"));
      assert.equal(covers(v1), false, file);
      assert.equal(covers(v2), true, file);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

const labelTest = [
  'import assert from "node:assert/strict";',
  'import test from "node:test";',
  'import { label } from "./label.ts";',
  'test("label", () => {',
  '  assert.equal(label("A", "B"), "L:A:B");',
  '  assert.equal(label("", ""), "L::");',
  '});',
].join("\n");
const MISSING_MODULE = "Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/work/src/label.ts' imported from /work/src/label.test.ts";

test("a missing export is scaffolded only when one body fits every reduced call", () => {
  const bareModule = "Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/work/src/label' imported from /work/src/label.test.ts";
  const bare = scaffoldPlan("src/label.test.ts", labelTest, bareModule, PATTERN, [], () => null);
  assert.ok(bare?.ok, "an extensionless absolute module path is the same import");
  const plan = scaffoldPlan("src/label.test.ts", labelTest, MISSING_MODULE, PATTERN, [], () => null);
  assert.ok(plan?.ok);
  if (!plan?.ok) return;
  assert.equal(plan.symbols[0]?.symbol, "label");
  assert.equal(plan.symbols[0]?.module, "./label.ts");
  assert.equal(plan.symbols[0]?.file, "src/label.ts");
  assert.match(plan.files[0]!.content, /export function label\(a: string, b: string\): string/);
  assert.match(plan.files[0]!.content, /return "L:" \+ a \+ ":" \+ b/);
  const kind = [
    'import { kind } from "./kind.ts";',
    'assert.equal(kind(1), "n");',
    'assert.equal(kind("a"), "s");',
  ].join("\n");
  const guards = scaffoldPlan("src/kind.test.ts", kind, "Cannot find module '/work/src/kind.ts'", PATTERN, [], () => null);
  assert.ok(guards?.ok);
  if (guards?.ok) assert.match(guards.files[0]!.content, /typeof a === "number"/);
  const ambiguous = [
    'import { pos } from "./pos.ts";',
    "assert.equal(pos(1), true);",
    "assert.equal(pos(0), false);",
  ].join("\n");
  const refused = scaffoldPlan("src/pos.test.ts", ambiguous, "Cannot find module '/work/src/pos.ts'", PATTERN, [], () => null);
  assert.equal(refused?.ok, false);
  if (refused && !refused.ok) assert.equal(refused.reason, "CANT_DO_YET_NO_BODY");
  const mixed = [
    'import { f } from "./f.ts";',
    "assert.equal(f(1), 1);",
    "assert.equal(f(1, 2), 1);",
  ].join("\n");
  const signature = scaffoldPlan("src/f.test.ts", mixed, "Cannot find module '/work/src/f.ts'", PATTERN, [], () => null);
  assert.equal(signature?.ok, false);
  if (signature && !signature.ok) assert.equal(signature.reason, "CANT_DO_YET_SIGNATURE");
  const outside = scaffoldPlan("src/a.test.ts", 'import { a } from "../outside.ts";\nassert.equal(a(1), 1);\n', "Cannot find module '../outside.ts'", PATTERN, [], () => null);
  assert.equal(outside?.ok, false);
  if (outside && !outside.ok) assert.equal(outside.reason, "CANT_DO_YET_NO_MODULE");
  const present = 'export const label = 1;\n';
  const called = scaffoldPlan("src/label.test.ts", 'import { label } from "./label.ts";\nassert.equal(label("A"), "A");\n', "TypeError: label is not a function", PATTERN, [], (path) => path === "src/label.ts" ? present : null);
  assert.equal(called?.ok, false);
  if (called && !called.ok) {
    assert.equal(called.reason, "CANT_DO_YET_NOT_A_FUNCTION");
    assert.equal(called.symbols[0]?.symbol, "label");
    assert.equal(called.symbols[0]?.module, "./label.ts");
  }
  const peer = 'export function twice(n: number): number {\n  return n + n;\n}\n';
  const again = [
    'import { again } from "./twice.ts";',
    "assert.equal(again(2), 4);",
    "assert.equal(again(3), 6);",
  ].join("\n");
  const composed = scaffoldPlan("src/twice.test.ts", again, "The requested module './twice.ts' does not provide an export named 'again'", PATTERN, [], (path) => path === "src/twice.ts" ? peer : null);
  assert.ok(composed?.ok);
  if (composed?.ok) assert.match(composed.files[0]!.content, /return twice\(a\)/);
  assert.equal(scaffoldPlan("src/pad.test.ts", padTest, NODE_FAIL, PATTERN), null);
  const sourceOf = (name: string, body: string) => {
    const text = `import { ${name} } from "./${name}.ts";\n${body}\n`;
    return scaffoldPlan(`src/${name}.test.ts`, text, `Cannot find module '/work/src/${name}.ts'`, PATTERN, [], () => null);
  };
  const flag = sourceOf("flag", [
    "assert.equal(flag(true, false), true);",
    "assert.equal(flag(true, true), false);",
    "assert.equal(flag(false, true), false);",
    "assert.equal(flag(false, false), false);",
  ].join("\n"));
  assert.ok(flag?.ok);
  if (flag?.ok) assert.match(flag.files[0]!.content, /return a && !b;/);
  const stuck = sourceOf("stuck", "assert.equal(stuck(5), false);\nassert.equal(stuck(6), true);");
  assert.equal(stuck?.ok, false);
  if (stuck && !stuck.ok) assert.equal(stuck.reason, "CANT_DO_YET_NO_BODY");
  const same = sourceOf("same", [
    "assert.equal(same(1, 1), true);",
    "assert.equal(same(1, 2), false);",
    "assert.equal(same(0, 0), true);",
    "assert.equal(same(2, 1), false);",
  ].join("\n"));
  assert.ok(same?.ok);
  if (same?.ok) assert.match(same.files[0]!.content, /return a === b;/);
  const picked = sourceOf("picked", [
    "assert.deepEqual(picked([]), []);",
    'assert.deepEqual(picked([{ id: "a", on: true }]), ["a"]);',
    'assert.deepEqual(picked([{ id: "a", on: false }]), []);',
    'assert.deepEqual(picked([{ id: "a", on: true }, { id: "b", on: false }]), ["a"]);',
  ].join("\n"));
  assert.ok(picked?.ok);
  if (picked?.ok) assert.match(picked.files[0]!.content, /item\.on === true/);
  const head = sourceOf("head", 'assert.equal(head("a/b"), "a");\nassert.equal(head("z"), "z");\nassert.equal(head("/a"), "");');
  assert.ok(head?.ok);
  if (head?.ok) assert.match(head.files[0]!.content, /split\("\/"\)/);
  const total = sourceOf("total", [
    'assert.equal(total([], "a"), 0);',
    'assert.equal(total([{ k: "a", n: 2 }, { k: "b", n: 5 }], "a"), 2);',
    'assert.equal(total([{ k: "a", n: 2 }, { k: "a", n: 3 }], "a"), 5);',
  ].join("\n"));
  assert.ok(total?.ok);
  if (total?.ok) assert.match(total.files[0]!.content, /item\.k === b/);
  const line = sourceOf("line", 'assert.equal(line("a", 2), "L:a:2");\nassert.equal(line("b", 3), "L:b:3");\nassert.equal(line("", 0), "L::0");');
  assert.ok(line?.ok);
  if (line?.ok) assert.match(line.files[0]!.content, /"L:" \+ a \+ ":" \+ b/);
});

test("a missing module is created, and a comparison behind an alias is edited, when the test and the suite pass", (t) => {
  if (!practiceSandboxReady()) { t.skip("bwrap is not installed on this host"); return; }
  const missing = repo({
    "src/keep.ts": keep,
    "src/label.test.ts": labelTest,
    "src/keep.test.ts": keepTest,
  });
  const edge = `import assert from "node:assert/strict";\nimport test from "node:test";\nimport { box } from "./alias.ts";\ntest("edge", () => { assert.equal(box.atLeast(1), true); });\n`;
  const aliased = repo({ "src/alias.ts": aliasFn, "src/keep.ts": keep, "src/alias.test.ts": edge, "src/keep.test.ts": keepTest });
  try {
    const created = runTestSpec(specInput(missing, "src/label.test.ts", { subject: "label", originalSuite: "related", relatedTests: ["src/keep.test.ts"] }));
    assert.equal(created.status, "diff", created.status === "cant" ? `${created.reason} ${created.diagnostic.lines.join(" | ")}` : created.status);
    if (created.status !== "diff") return;
    assert.equal(created.diagnostic.kind, "verified");
    assert.equal(created.diagnostic.symbol, "label");
    assert.equal(created.diagnostic.module, "./label.ts");
    assert.match(created.diff, /export function label/);
    const applied = spawnSync("git", ["-C", missing, ...GIT_LOCK_ARGS, "apply", "--whitespace=nowarn", "-"], { input: created.diff, encoding: "utf8", env: practiceGitEnv() });
    assert.equal(applied.status, 0, applied.stderr);
    const nodePath = visibleNodeBin()!;
    const after = spawnSync(nodePath, ["--experimental-strip-types", "--test", "src/label.test.ts", "src/keep.test.ts"], { cwd: missing, encoding: "utf8" });
    assert.equal(after.status, 0, `${after.stdout ?? ""}\n${after.stderr ?? ""}`);
    const flipped = runTestSpec(specInput(aliased, "src/alias.test.ts", { subject: "at least one", originalSuite: "related", relatedTests: ["src/keep.test.ts"] }));
    assert.equal(flipped.status, "diff", flipped.status === "cant" ? `${flipped.reason} attempts=${flipped.attempts}` : flipped.status);
    if (flipped.status !== "diff") return;
    assert.match(flipped.diff, />/);
    assert.match(flipped.diff, />=/);
    assert.equal(flipped.diff.includes("keep"), false);
  } finally {
    rmSync(missing, { recursive: true, force: true });
    rmSync(aliased, { recursive: true, force: true });
  }
});
