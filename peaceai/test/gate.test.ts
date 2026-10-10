import assert from "node:assert/strict";
import test from "node:test";

import { addText, emptyIndex } from "../lib/coretext.ts";
import { parseDiff } from "../lib/diff.ts";
import { gateCandidate, validateSummary } from "../lib/gate.ts";
import { checkCandidateScope, isSafeCandidatePath } from "../lib/scope.ts";

const base = new Set(["src/text.ts", "src/text.test.ts", "package.json", "package-lock.json", ".github/workflows/a.yml", "tsconfig.json"]);

function editDiff(path: string, added: string[]): string {
  return [
    `diff --git a/${path} b/${path}`,
    "index 1111111..2222222 100644",
    `--- a/${path}`,
    `+++ b/${path}`,
    "@@ -1,1 +1,2 @@",
    " context",
    ...added.map((line) => `+${line}`),
    "",
  ].join("\n");
}

function newFileDiff(path: string, added: string[], mode = "100644"): string {
  return [
    `diff --git a/${path} b/${path}`,
    `new file mode ${mode}`,
    "index 0000000..3333333",
    "--- /dev/null",
    `+++ b/${path}`,
    `@@ -0,0 +1,${added.length} @@`,
    ...added.map((line) => `+${line}`),
    "",
  ].join("\n");
}

const deleteDiff = (path: string) =>
  [`diff --git a/${path} b/${path}`, "deleted file mode 100644", "index 1111111..0000000", `--- a/${path}`, "+++ /dev/null", "@@ -1 +0,0 @@", "-x", ""].join("\n");

const scope = (diff: string) => checkCandidateScope(parseDiff(diff), base).map((v) => v.reason);

test("allowed: edit existing source and add a new test file", () => {
  assert.deepEqual(scope(editDiff("src/text.ts", ["export const a = 1;"])), []);
  assert.deepEqual(scope(newFileDiff("src/text.extra.test.ts", ["test"])), []);
  assert.deepEqual(scope(newFileDiff("src/feature/new.ts", ["export {}"])), []);
});

test("denied: paths outside src, workflows, package.json, lockfile, config", () => {
  for (const path of ["package.json", "package-lock.json", ".github/workflows/a.yml", "tsconfig.json", "peaceai/lib/x.ts", "README.md"])
    assert.ok(scope(editDiff(path, ["x"])).some((r) => r.startsWith("outside allowed paths")), path);
  assert.ok(scope(newFileDiff(".github/workflows/b.yml", ["x"])).length > 0);
  assert.ok(scope(newFileDiff("src/../package.json", ["x"])).length > 0);
  assert.ok(scope(newFileDiff("src/.hidden.ts", ["x"])).length > 0);
  assert.ok(scope(newFileDiff("src/a.js", ["x"])).length > 0);
});

test("denied: modifying or deleting existing tests, deleting anything, modes, renames, binary", () => {
  assert.ok(scope(editDiff("src/text.test.ts", ["test('x')"])).includes("modifies an existing test file"));
  assert.ok(scope(deleteDiff("src/text.test.ts")).includes("deletes a file"));
  assert.ok(scope(deleteDiff("src/text.ts")).includes("deletes a file"));
  assert.ok(scope(newFileDiff("src/run.ts", ["x"], "100755")).includes("file mode change"));
  const rename = "diff --git a/src/text.ts b/src/other.ts\nsimilarity index 100%\nrename from src/text.ts\nrename to src/other.ts\n";
  assert.ok(scope(rename).includes("renames or copies a file"));
  const binary = "diff --git a/src/x.ts b/src/x.ts\nnew file mode 100644\nBinary files /dev/null and b/src/x.ts differ\n";
  assert.ok(scope(binary).includes("binary change"));
  assert.ok(scope(newFileDiff("src/text.ts", ["x"])).includes("creates a file that already exists"));
  assert.ok(scope("").includes("empty diff"));
});

test("isSafeCandidatePath", () => {
  assert.equal(isSafeCandidatePath("src/a.ts"), true);
  assert.equal(isSafeCandidatePath("src/a/b.test.ts"), true);
  assert.equal(isSafeCandidatePath("srcx/a.ts"), false);
  assert.equal(isSafeCandidatePath("src/a b.ts"), false);
});

const coreLine = "export function privateCoreFunction(alpha: number, beta: number): number {";
const coreBlock = ["const firstPrivateValue = 1;", "const secondPrivateValue = 2;", "const thirdPrivateValue = 3;", "const fourthPrivateValue = 4;"];

function coreIndex() {
  const text = emptyIndex();
  addText(text, [coreLine, "  return alpha + beta;", "}", ...coreBlock].join("\n"));
  return { text, paths: new Set(["packages/core/src/SecretEngine.ts", "README.md"]), basenames: new Set(["SecretEngine.ts", "README.md", "index.ts"]) };
}

test("core text: long copied line and copied block are rejected without printing them", () => {
  const core = coreIndex();
  const r1 = gateCandidate(editDiff("src/text.ts", [coreLine]), base, emptyIndex(), core);
  assert.equal(r1.ok, false);
  assert.ok(r1.reasons.some((r) => r.startsWith("core-text: 1 line")));
  assert.ok(r1.reasons.every((r) => !r.includes("privateCoreFunction")));
  const r2 = gateCandidate(newFileDiff("src/block.ts", coreBlock), base, emptyIndex(), core);
  assert.ok(r2.reasons.some((r) => /core-text: 0 line match\(es\), 1 shingle/.test(r)));
  const indented = gateCandidate(editDiff("src/text.ts", [`      ${coreLine.replace(/ /g, "   ")}`]), base, emptyIndex(), core);
  assert.equal(indented.ok, false, "whitespace changes do not evade detection");
});

test("core text: lines already public in the workspace and boilerplate are ignored", () => {
  const core = coreIndex();
  const baseline = emptyIndex();
  addText(baseline, coreLine);
  assert.equal(gateCandidate(editDiff("src/text.ts", [coreLine]), base, baseline, core).ok, true);
  const boiler = emptyIndex();
  const imp = 'import { aaaaaaaaaaaa, bbbbbbbbbbbbbb, cccccccccccc } from "node:fs";';
  addText(boiler, imp);
  assert.equal(gateCandidate(editDiff("src/text.ts", [imp]), base, emptyIndex(), { ...core, text: boiler }).ok, true);
  assert.equal(gateCandidate(editDiff("src/text.ts", ["export const fresh = 1;"]), base, emptyIndex(), core).ok, true);
});

test("core path: new file matching a core path or distinctive name is rejected", () => {
  const core = coreIndex();
  assert.ok(gateCandidate(newFileDiff("src/SecretEngine.ts", ["export {}"]), base, emptyIndex(), core).reasons.includes("core-path: src/SecretEngine.ts"));
  assert.equal(gateCandidate(newFileDiff("src/index.ts", ["export {}"]), base, emptyIndex(), core).ok, true);
});

test("summary schema is strict", () => {
  const good = {
    schema: "peaceai-workspace-candidates:v1",
    taskId: "workspace-issue-12",
    baseSha: "a".repeat(40),
    candidates: [{ id: "candidate-1", file: "candidates/candidate-1.diff", transformations: ["ADD_TEST_CASE"], operationId: null, diffBytes: 10, diffLines: 2 }],
  };
  assert.equal(validateSummary(good), true);
  assert.equal(validateSummary({ ...good, extra: "x" }), false);
  assert.equal(validateSummary({ ...good, candidates: [{ ...good.candidates[0], file: "../x" }] }), false);
  assert.equal(validateSummary({ ...good, candidates: [{ ...good.candidates[0], note: "core text" }] }), false);
  assert.equal(validateSummary({ ...good, candidates: [{ ...good.candidates[0], transformations: ["lower case text"] }] }), false);
});
