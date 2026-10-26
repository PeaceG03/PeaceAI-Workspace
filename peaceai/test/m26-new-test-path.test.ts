// Auditor #135 (all kinds): a generated NEW test path that already exists anywhere in the checkout (full
// `git ls-files` list or on disk) is refused, not just when it is in the context subset handed to the rule.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { applyRule, pathExistsIn, type RuleSpec } from "../lib/learned.ts";

const root = resolve(import.meta.dirname, "../..");
const spec = (id: string) => JSON.parse(readFileSync(join(root, "peaceai/rules/learned", `${id}.json`), "utf8")) as RuleSpec;
const isTest = (p: string) => /\.test\.ts$/.test(p);
const SRC = "export function pick(s: string, n: number): string {\n  return s.slice(0, n);\n}\n";
const files = [{ path: "src/a.ts", content: SRC }];

const CASES: { kind: string; id: string; objective: string }[] = [
  { kind: "COMPLEX_FUNCTION", id: "public-complex-function-v1", objective: "add complex function spanOf(from: string, to: string): string[] to src/a.ts with body:\nconst a = from.slice(0, 7);\nconst b = to.slice(0, 7);\nif (b < a) return [];\nreturn [a, b];\n- spanOf(\"2026-09\", \"2026-11\") equals [\"2026-09\", \"2026-11\"]" },
  { kind: "METHOD_GUARD", id: "public-method-guard-v1", objective: "guard `pick` in `src/a.ts` with a method: throw EMPTY_PREFIX when s.startsWith(\"#\")\n- pick(\"#x\", 1) throws EMPTY_PREFIX" },
  { kind: "ADD_THROW_GUARD", id: "public-throw-guard-v1", objective: "guard `pick` in `src/a.ts`: throw BAD_N when n < 0\n- pick(\"x\", -1) throws BAD_N" },
  { kind: "ADD_THROW_GUARD (function-top)", id: "public-throw-guard-top-v1", objective: "guard `pick` in `src/a.ts` at the top: throw BAD_N when n < 0\n- pick(\"x\", -1) throws BAD_N" },
  { kind: "ADD_FUNCTION", id: "public-add-function-v2", objective: "add function `twice(s: string): string` to `src/a.ts` returning s + s\n- twice(\"ab\") is \"abab\"" },
];

for (const c of CASES) {
  test(`${c.kind}: builds, then refuses when its new test path already exists (ls-files or disk)`, () => {
    const s = spec(c.id);
    const ok = applyRule(s, c.objective, files, isTest);
    assert.ok(ok, `${c.id} builds on the fixture`);
    const created = (ok!.extra ?? []).filter((x) => x.create).map((x) => x.path);
    assert.ok(created.length >= 1 && created.every(isTest), `${c.id} creates a new test file`);
    // Not in the context subset, but present in the full tracked list:
    const why1: { reason?: string } = {};
    assert.equal(applyRule(s, c.objective, files, isTest, undefined, why1, pathExistsIn("/nonexistent", ["README.md", created[0]!])), null);
    assert.equal(why1.reason, "new_test_path_exists");
    // Untracked but on disk:
    const dir = mkdtempSync(join(tmpdir(), "m26-ntp-"));
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, created[0]!), "// untracked\n");
    const why2: { reason?: string } = {};
    assert.equal(applyRule(s, c.objective, files, isTest, undefined, why2, pathExistsIn(dir, [])), null);
    assert.equal(why2.reason, "new_test_path_exists");
    // Free path: still builds with the check on.
    assert.ok(applyRule(s, c.objective, files, isTest, undefined, {}, pathExistsIn(mkdtempSync(join(tmpdir(), "m26-ntp-")), ["src/a.ts"])));
  });
}

test("generate.ts passes the full ls-files + disk check to every rule", () => {
  const g = readFileSync(join(root, "peaceai/bin/generate.ts"), "utf8");
  assert.match(g, /const newPathExists = pathExistsIn\(repo, tracked\);/);
  assert.match(g, /applyRule\(a\.spec, [^\n]*, why, newPathExists(?:, \[\.\.\.scanOnlyFiles, \.\.\.workflowFiles\])?(?:, `\$\{task\.title\}\\n\\n\$\{task\.body\}`)?\)/); // M114: + the raw issue text (read only by the v5 derive rule)
});

test("a broken symlink at the new test path counts as existing (lstat, not existsSync)", () => {
  const s = spec("public-complex-function-v1");
  const c = CASES[0]!;
  const created = applyRule(s, c.objective, files, isTest)!.extra!.map((x) => x.path);
  const dir = mkdtempSync(join(tmpdir(), "m26-ntp-link-"));
  mkdirSync(join(dir, "src"), { recursive: true });
  symlinkSync(join(dir, "does-not-exist"), join(dir, created[0]!));
  assert.equal(pathExistsIn(dir, [])(created[0]!), true);
  assert.equal(pathExistsIn(dir, [])("src/free.test.ts"), false);
  const why: { reason?: string } = {};
  assert.equal(applyRule(s, c.objective, files, isTest, undefined, why, pathExistsIn(dir, [])), null);
  assert.equal(why.reason, "new_test_path_exists");
});

test("a non-ENOENT lstat error counts as existing (fail closed): a path under a regular file is ENOTDIR", () => {
  const dir = mkdtempSync(join(tmpdir(), "m26-ntp-enotdir-"));
  writeFileSync(join(dir, "src"), "a regular file, not a directory\n");
  assert.equal(pathExistsIn(dir, [])("src/a.foo-0000000.test.ts"), true);
  assert.equal(pathExistsIn(dir, [])("other/a.test.ts"), false, "plain ENOENT stays free");
  const s = spec("public-complex-function-v1");
  const why: { reason?: string } = {};
  assert.equal(applyRule(s, CASES[0]!.objective, files, isTest, undefined, why, pathExistsIn(dir, [])), null);
  assert.equal(why.reason, "new_test_path_exists");
});
