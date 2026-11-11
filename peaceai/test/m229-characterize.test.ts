// M229: an appended characterization is not a production pass.
// It has no fixSha, so gate.ts rejects it. It is not shipped under public-test-case-existing-v7.
// EXPERIMENTAL. credit is false.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { emptyIndex } from "../lib/coretext.ts";
import { gateCandidate } from "../lib/gate.ts";

test("the production gate rejects an appended test that has no fix sha", () => {
  const dir = mkdtempSync(join(tmpdir(), "peaceai-gate-"));
  try {
    execFileSync("git", ["init", "-q"], { cwd: dir });
    execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "c", "--allow-empty"], { cwd: dir });
    writeFileSync(join(dir, "a.test.ts"), "import test from \"node:test\";\ntest(\"old\", () => {});\n");
    execFileSync("git", ["add", "a.test.ts"], { cwd: dir });
    execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "t"], { cwd: dir });
    writeFileSync(join(dir, "a.test.ts"), "import test from \"node:test\";\ntest(\"old\", () => {});\n\ntest(\"characterization band\", () => {\n  assert.equal(band(0), \"zero\");\n});\n");
    const diff = execFileSync("git", ["diff", "--no-color", "--no-ext-diff"], { cwd: dir, encoding: "utf8" });
    const scope = { isSource: (p: string) => p.endsWith(".ts"), isTest: (p: string) => p.endsWith(".test.ts"), isDenied: () => false };
    const core = { text: emptyIndex(), paths: new Set<string>(), basenames: new Set<string>() };
    const rejected = gateCandidate(diff, new Set(["a.test.ts"]), emptyIndex(), core, scope, { testAppend: false });
    assert.equal(rejected.ok, false);
    assert.match(rejected.reasons.join("\n"), /modifies an existing test file/);
    const job = readFileSync(join(import.meta.dirname, "../bin/generate.ts"), "utf8");
    assert.equal(job.includes("characterizeAppend"), false);
    assert.equal(job.includes("appendedCase"), false);
    const engine = readFileSync(join(import.meta.dirname, "../lib/learned-test-existing.ts"), "utf8");
    assert.equal(engine.includes("characterizeAppend"), false);
    assert.equal(engine.includes("--import"), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
