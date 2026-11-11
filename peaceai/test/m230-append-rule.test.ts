// The characterization-append rule is its own spec. It emits one appended case only when the task names a
// fix commit, and the gate accepts that append only when the edit carries the same fix sha.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { emptyIndex } from "../lib/coretext.ts";
import { parseDiff } from "../lib/diff.ts";
import { gateCandidate } from "../lib/gate.ts";
import { applyRule, specFileText, specHash, validateSpec, type RuleSpec } from "../lib/learned.ts";
import { auditorPolicyProblem } from "../lib/approval.ts";
import { runExistingTestRule, TEST_EXISTING_TRIGGER } from "../lib/learned-test-existing.ts";
import { WORKSPACE_SCOPE } from "../lib/scope.ts";
import { scratchDir } from "./scratch.ts";
import { spawnSync } from "node:child_process";

const SHA = "a".repeat(40);
const V7 = "peaceai/rules/learned/public-test-case-existing-v7.json";
const LEARNED = "peaceai/rules/learned/public-test-case-existing-append-v1.json";
const RECORD = "peaceai/rules/proposals/public-test-case-existing-append-v1.json";

const SPEC: RuleSpec = {
  schema: "peaceai-learned-rule:v1",
  id: "public-test-case-existing-append-v1",
  kind: "TEST_EXISTING",
  minedFrom: "public",
  minerVersion: "peaceai-team:test-case-existing-append-v1",
  shape: "TEST_CASE_EXISTING_APPEND",
  trigger: TEST_EXISTING_TRIGGER,
  params: {
    assert: "node:assert/strict-default",
    checks: ["equal", "deepEqual", "throws"],
    framework: "node:test-default",
    grading: "fail-before-pass-after",
    matcher: "regex",
    maxLines: "8",
    placement: "append",
    target: "exported-pure-function-v7",
  },
  evidence: { hunks: 0, commits: 0, files: 0, repos: [] },
};

const SRC = "export function band(x: number): number { return x + 1; }\n";
const BASE = [
  'import assert from "node:assert/strict";',
  'import test from "node:test";',
  'import { band } from "./band.ts";',
  "",
  'test("band keeps one", () => {',
  "  assert.equal(band(2), 3);",
  "});",
  "",
].join("\n");
const FILES = [{ path: "src/band.ts", content: SRC }, { path: "src/band.test.ts", content: BASE }];
const ask = (fix: string) => `Add a characterization test for band in src/band.ts\n${fix}`;

test("the append spec validates, stays delegable, and matches its learned file", () => {
  assert.equal(validateSpec(SPEC), true);
  assert.equal(auditorPolicyProblem(SPEC), null);
  const text = readFileSync(LEARNED, "utf8");
  assert.equal(text, specFileText(SPEC));
  assert.equal(specHash(JSON.parse(text)), specHash(SPEC));
  const record = JSON.parse(readFileSync(RECORD, "utf8")) as { id: string; teamPicked: boolean; credit: number };
  assert.equal(record.id, SPEC.id);
  assert.equal(record.teamPicked, true);
  assert.equal(record.credit, 0);
  const v7 = readFileSync(V7, "utf8");
  assert.equal(createHash("sha256").update(v7.endsWith("\n") ? v7.slice(0, -1) : v7, "utf8").digest("hex"), "719f792af9fd16a0cea96218ddac9c43727e5c0c4a64e485e9dd07e5d2b66410");
});

test("no fix sha emits nothing", () => {
  const why: { reason?: string } = {};
  assert.equal(runExistingTestRule(TEST_EXISTING_TRIGGER, SPEC.params, ask(""), FILES, undefined, why), null);
  assert.equal(why.reason, "no_fix_sha");
});

test("a fix sha appends one case; the gate accepts it only when that sha is present", () => {
  const why: { reason?: string } = {};
  const edit = runExistingTestRule(TEST_EXISTING_TRIGGER, SPEC.params, ask(`Fix: ${SHA}`), FILES, undefined, why);
  assert.ok(edit && "fixSha" in edit, why.reason);
  assert.equal(edit.fixSha, SHA);
  assert.equal("create" in edit ? edit.create : undefined, undefined);
  assert.ok(edit.content.startsWith(BASE));
  assert.match(edit.content.slice(BASE.length), /^\ntest\("band: behavior fixed in aaaaaaa", \(\) => \{\n  assert\.equal\(band\(0\), 1\);\n\}\);\n$/);
  const dir = scratchDir("m230-");
  mkdirSync(join(dir, "src"));
  writeFileSync(join(dir, "src/band.test.ts"), BASE);
  const git = (...args: string[]) => spawnSync("git", args, { cwd: dir, encoding: "utf8" });
  git("init", "-q");
  git("add", "-A");
  git("commit", "-qm", "b");
  writeFileSync(join(dir, "src/band.test.ts"), edit.content);
  const diff = git("diff", "--no-color").stdout;
  const parsed = parseDiff(diff);
  assert.equal(parsed[0]?.appendOnly, true);
  const base = new Set(["src/band.ts", "src/band.test.ts"]);
  const core = { text: emptyIndex(), paths: new Set<string>(), basenames: new Set<string>() };
  assert.equal(gateCandidate(diff, base, emptyIndex(), core, WORKSPACE_SCOPE, { testAppend: true }).ok, true);
  const blocked = gateCandidate(diff, base, emptyIndex(), core, WORKSPACE_SCOPE, { testAppend: false });
  assert.equal(blocked.ok, false);
  assert.match(blocked.reasons.join("\n"), /modifies an existing test file/);
});

test("a denied target module is refused before any edit", () => {
  const why: { reason?: string } = {};
  const edit = applyRule(SPEC, `Add a characterization test for band in src/backfill.ts\nFix: ${SHA}\n`, [{ path: "src/backfill.ts", content: SRC }], (p) => /\.test\.ts$/.test(p), "PeaceG03/PeaceSTOCKS", why);
  assert.equal(edit, null);
  assert.equal(why.reason, "denied_path");
});

test("the probe does not inherit the caller environment", () => {
  const text = readFileSync("peaceai/lib/learned-test-existing.ts", "utf8");
  assert.doesNotMatch(text, /\.\.\.process\.env/);
  assert.match(text, /env: \{ PATH: process\.env\.PATH \?\? "" \}/);
});
