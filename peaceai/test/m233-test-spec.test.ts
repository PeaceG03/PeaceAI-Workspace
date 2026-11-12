// Test-as-spec. A tiny fixture, not a practice row. credit: false.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { MAX_CANDIDATES } from "../lib/editpropose.ts";
import { MAX_ATTEMPTS } from "../lib/loop.ts";
import { GIT_LOCK_ARGS, practiceGit, practiceGitEnv, practiceSandboxReady, visibleNodeBin } from "../lib/practicemine.ts";
import { classifyRunnerOutput, expectationsIn, originalSuiteArgv, runTestSpec, sanitizeRunnerLines, SPEC_ATTEMPT_CAP, specTask, type SpecInput } from "../lib/testspec.ts";

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
