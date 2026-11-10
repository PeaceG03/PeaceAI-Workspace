// M229: a characterization with no bullets appends one assertion and that assertion passes when run.
// EXPERIMENTAL. credit is false. The fixture is unrelated to any builder-log row.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { appendedTest } from "../bin/capability-job.ts";
import { characterizeAppend, TEST_EXISTING_TRIGGER } from "../lib/learned-test-existing.ts";

const isTest = (p: string) => p.endsWith(".test.ts");

test("a characterized assertion is appended to the existing test and passes", () => {
  const dir = mkdtempSync(join(tmpdir(), "peaceai-char-"));
  const prev = process.env.PEACEAI_WORKSPACE_DIR;
  process.env.PEACEAI_WORKSPACE_DIR = dir;
  try {
    mkdirSync(join(dir, "src"), { recursive: true });
    const source = "export function band(x: number): string {\n  if (x < 0) throw new Error(\"BAD_BAND\");\n  return x === 0 ? \"zero\" : \"pos\";\n}\n";
    const prior = "import assert from \"node:assert/strict\";\nimport test from \"node:test\";\nimport { band } from \"./a\";\n\ntest(\"already\", () => {\n  assert.equal(band(1), \"pos\");\n});\n";
    writeFileSync(join(dir, "src/a.ts"), source);
    writeFileSync(join(dir, "src/a.test.ts"), prior);
    const why: { reason?: string } = {};
    const edit = characterizeAppend(TEST_EXISTING_TRIGGER, "add a characterization test for band in src/a.ts", [{ path: "src/a.ts", content: source }, { path: "src/a.test.ts", content: prior }], isTest, why);
    assert.ok(edit, why.reason);
    assert.equal(edit.path, "src/a.test.ts");
    assert.ok(edit.content.startsWith(prior));
    assert.match(edit.content, /test\("characterization band"/);
    writeFileSync(join(dir, edit.path), edit.content);
    const tsx = createRequire(import.meta.url).resolve("tsx");
    const ran = spawnSync(process.execPath, ["--import", tsx, "--test", "--test-name-pattern", "^characterization band$", "src/a.test.ts"], { cwd: dir, encoding: "utf8" });
    assert.equal(ran.status, 0, `${ran.stdout}\n${ran.stderr}`);
  } finally {
    if (prev === undefined) delete process.env.PEACEAI_WORKSPACE_DIR;
    else process.env.PEACEAI_WORKSPACE_DIR = prev;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an appended characterization diff names the test that must be run", () => {
  const diff = "diff --git a/src/a.test.ts b/src/a.test.ts\n+++ b/src/a.test.ts\n@@ -1 +1,4 @@\n+test(\"characterization band\", () => {\n+  assert.equal(band(0), \"zero\");\n+});\n";
  assert.deepEqual(appendedTest(diff), { file: "src/a.test.ts", name: "characterization band" });
});

test("a function the lattice cannot call is refused", () => {
  const source = "export function box(o: { n: number }): number { return o.n; }\n";
  const prior = "import assert from \"node:assert/strict\";\nimport test from \"node:test\";\nimport { box } from \"./a\";\ntest(\"x\", () => { assert.equal(box({ n: 1 }), 1); });\n";
  const why: { reason?: string } = {};
  const edit = characterizeAppend(TEST_EXISTING_TRIGGER, "add a characterization test for box in src/a.ts", [{ path: "src/a.ts", content: source }, { path: "src/a.test.ts", content: prior }], isTest, why);
  assert.equal(edit, null);
  assert.equal(why.reason, "probe_signature");
});
