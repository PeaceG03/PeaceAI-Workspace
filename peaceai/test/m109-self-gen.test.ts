// M109: the stage-2 proposal generator (Auditor #504 limit 5 provenance). Pinned here: its only inputs are the task
// text and the BASE commit's tree (the leak wall), it runs sandboxed (no fs, no child processes, no code from
// strings, empty env), it is deterministic and independent of whether the answer commit exists, and its output
// goes through the stage-2 check. Credit stays hard-refused.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { generateStage2Proposal, genSnapshot, runGeneratorSandboxed, selfGenerateCore, SELF_GEN_SCHEMA } from "../lib/selfpropose.ts";
import { NO_GENERATOR_MARK } from "../lib/selfchange.ts";

const SENTINEL = "ANSWER_SENTINEL_7c41";
const NOREPLY = ["-c", "user.name=PeaceG03", "-c", "user.email=301894882+PeaceG03@users.noreply.github.com"];
const git = (cwd: string, ...a: string[]) => execFileSync("git", [...NOREPLY, ...a], { cwd, encoding: "utf8" }).trim();
const put = (dir: string, p: string, t: string) => { mkdirSync(join(dir, p, ".."), { recursive: true }); writeFileSync(join(dir, p), t); };

/** base commit B (branch `base`) and a landed answer commit A on `main` that adds the sentinel everywhere. */
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "m109-"));
  git(dir, "init", "--quiet", "-b", "main");
  put(dir, "docs/old.md", "# Old\n");
  put(dir, "peaceai/test/m59-refusal-reason.test.ts", 'import { test } from "node:test";\ntest("a", () => {});\n');
  put(dir, "peaceai/lib/x.ts", "export const x = 1;\n");
  git(dir, "add", "-A"); git(dir, "commit", "--quiet", "--no-verify", "-m", "base");
  const base = git(dir, "rev-parse", "HEAD");
  git(dir, "branch", "base");
  put(dir, "docs/pre-280-memcheck-pass-core-free.md", `# ${SENTINEL}\n`);
  put(dir, "docs/answer.md", `${SENTINEL}\n`);
  put(dir, "peaceai/test/m59-refusal-reason.test.ts", `import { test } from "node:test";\ntest("a", () => {});\ntest("${SENTINEL}", () => {});\n`);
  git(dir, "add", "-A"); git(dir, "commit", "--quiet", "--no-verify", "-m", `answer ${SENTINEL}`);
  return { dir, base, landed: git(dir, "rev-parse", "HEAD") };
}

test("leak wall 1: the snapshot is the base tree only (no landed path, no landed text)", () => {
  const f = fixture();
  try {
    const s = genSnapshot(f.dir, f.base);
    assert.deepEqual(s.paths, ["docs/old.md", "peaceai/lib/x.ts", "peaceai/test/m59-refusal-reason.test.ts"]);
    assert.ok(!JSON.stringify(s).includes(SENTINEL));
    assert.equal(s.files["docs/old.md"], "# Old\n");
    assert.ok(!("peaceai/lib/x.ts" in s.files), "only proposable shapes carry text");
    assert.throws(() => genSnapshot(f.dir, "main"), /full commit sha/);
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
});

test("leak wall 2: the sandboxed generator cannot read files, spawn, see env, or build code from strings", () => {
  const f = fixture();
  try {
    // a probe in place of the skills: it tries every route to the answer commit
    const probe = (input: { repo: string }) => {
      const out: Record<string, string> = {};
      const fs = require("node:fs");
      const tryIt = (k: string, fn: () => unknown) => { try { fn(); out[k] = "READ"; } catch (e) { out[k] = String((e as { code?: string }).code ?? (e as Error).name); } };
      tryIt("answerFile", () => fs.readFileSync(input.repo + "/docs/answer.md", "utf8"));
      tryIt("gitDir", () => fs.readdirSync(input.repo + "/.git"));
      tryIt("cwd", () => fs.readdirSync("."));
      tryIt("write", () => fs.writeFileSync("/tmp/m109-probe-write", "x"));
      tryIt("spawn", () => require("node:child_process").execFileSync("git", ["-C", input.repo, "show", "main"]));
      tryIt("worker", () => new (require("node:worker_threads").Worker)("1", { eval: true }));
      tryIt("eval", () => (0, eval)("1"));
      out.env = Object.keys(process.env).join(",");
      return out;
    };
    const r = runGeneratorSandboxed(probe.toString(), { repo: resolve(f.dir) });
    assert.ok(r.ok, r.error);
    const o = r.output as Record<string, string>;
    for (const k of ["answerFile", "gitDir", "cwd", "write", "spawn", "worker"]) assert.equal(o[k], "ERR_ACCESS_DENIED", k);
    assert.equal(o.eval, "EvalError");
    assert.equal(o.env, "");
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
});

test("leak wall 3: the record is identical whether or not the answer commit exists in the repo", () => {
  const f = fixture();
  const only = mkdtempSync(join(tmpdir(), "m109-only-"));
  try {
    git(only, "clone", "--quiet", "--no-local", "--single-branch", "--branch", "base", f.dir, ".");
    assert.notEqual(spawnSync("git", ["cat-file", "-e", `${f.landed}^{commit}`], { cwd: only }).status, 0, "clone has no answer");
    for (const task of ["docs: pre-#280 memcheck PASS on a core-free corpus is not evidence", "M59: listed loop-rule entry must admit as APPROVED"]) {
      const a = generateStage2Proposal(f.dir, task, f.base), b = generateStage2Proposal(only, task, f.base);
      assert.deepEqual({ ...a, createdAt: "" }, { ...b, createdAt: "" }, task);
      assert.ok(!JSON.stringify(a).includes(SENTINEL));
    }
  } finally { rmSync(f.dir, { recursive: true, force: true }); rmSync(only, { recursive: true, force: true }); }
});

test("DOC_PAGE_STUB: a new root doc page, canonical diff, passes the stage-2 check", () => {
  const f = fixture();
  try {
    const r = generateStage2Proposal(f.dir, "docs: pre-#280 memcheck PASS on a core-free corpus is not evidence", f.base);
    assert.equal(r.schema, SELF_GEN_SCHEMA);
    assert.equal(r.status, "candidate", JSON.stringify(r.check));
    assert.equal(r.skill, "DOC_PAGE_STUB");
    assert.deepEqual(r.paths, ["docs/pre-280-memcheck-pass-core-free.md"]);
    assert.match(r.diff, /^diff --git a\/docs\/pre-280-memcheck-pass-core-free\.md b\/docs\/pre-280-memcheck-pass-core-free\.md\nnew file mode 100644\nindex 0{40}\.\.[0-9a-f]{40}\n/);
    // the blob id is git's own
    const blob = execFileSync("git", ["hash-object", "--stdin"], { input: "# Pre-#280 memcheck PASS on a core-free corpus is not evidence\n\nPre-#280 memcheck PASS on a core-free corpus is not evidence.\n", encoding: "utf8" }).trim();
    assert.equal(r.candidateBlobs["docs/pre-280-memcheck-pass-core-free.md"], blob);
    assert.ok(r.check?.ok);
    assert.match(r.taskSha256, /^[0-9a-f]{64}$/); assert.match(r.generatorSha256, /^[0-9a-f]{64}$/); assert.match(r.diffSha256, /^[0-9a-f]{64}$/);
    // an existing target is refused, not overwritten
    assert.equal(generateStage2Proposal(f.dir, "docs: old", f.base).reason, "TARGET_EXISTS: docs/old.md");
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
});

test("TEST_APPEND locates the target and refuses honestly; other tasks are NO_FAMILY", () => {
  const paths = ["peaceai/test/m59-refusal-reason.test.ts", "peaceai/test/m12-a.test.ts", "peaceai/test/m12-b.test.ts"];
  const g = (task: string) => selfGenerateCore({ task, baseSha: "0".repeat(40), paths, files: {} });
  assert.deepEqual(g("M59: listed loop-rule entry must admit as APPROVED"), { status: "refused", skill: "TEST_APPEND", reason: "NO_SKILL: writing a test body from the task text alone is not supported (target located: peaceai/test/m59-refusal-reason.test.ts)", files: [] });
  assert.match(g("M12: x").reason, /^NO_TARGET: 2 files/);
  assert.match(g("Fix the verdict patch-build cleanup race").reason, /^NO_FAMILY/);
  assert.equal(g("   ").reason, "EMPTY_TASK");
  assert.deepEqual(g("docs: x"), g("docs: x"), "deterministic");
});

test("trusted side: malformed, blind or never-zone output is refused; the stage-2 check runs on the canonical diff", () => {
  const f = fixture();
  try {
    const src = (files: unknown) => `() => (${JSON.stringify({ status: "candidate", skill: "T", reason: "t", files })})`;
    assert.equal(generateStage2Proposal(f.dir, "t", f.base, "() => 42").reason, "GENERATOR_OUTPUT_MALFORMED");
    assert.match(generateStage2Proposal(f.dir, "t", f.base, "() => { throw new Error('x'); }").reason, /^GENERATOR_FAILED/);
    assert.equal(generateStage2Proposal(f.dir, "t", f.base, src([{ path: "peaceai/lib/x.ts", text: "export const x = 2;\n" }])).reason, "GENERATOR_WRITES_UNSEEN_FILE: peaceai/lib/x.ts");
    const nz = generateStage2Proposal(f.dir, "t", f.base, src([{ path: "README.md", text: "x\n" }]));
    assert.equal(nz.status, "refused-by-check");
    assert.ok(nz.check!.refusals.some((r) => /never-zone/.test(r.reason)));
    const edit = generateStage2Proposal(f.dir, "t", f.base, src([{ path: "peaceai/test/m59-refusal-reason.test.ts", text: 'import { test } from "node:test";\ntest("b", () => {});\n' }]));
    assert.equal(edit.status, "refused-by-check", "add-only: an existing test changed");
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
});

test("the skills are self-contained (shipped as source) and credit stays hard-refused", () => {
  const s = selfGenerateCore.toString();
  for (const bad of [/\brequire\s*\(/, /\bimport\s*\(/, /\bprocess\b/, /\bfetch\b/, /\bglobalThis\b/]) assert.doesNotMatch(s, bad);
  assert.equal(NO_GENERATOR_MARK, "no credit: no generator run record");
});
