// #575 self-edit (Auditor follow-up on #582): the Workspace verdict PR step mirrors the target-pr job's hash and
// stale-base rules. A Workspace PR is opened only when the chosen bytes match the Results record AND the task base
// is still Workspace main; a moved main posts the M18 regrade request (with pending carry) instead, and anything
// the check cannot decide fails closed. The tests run each step's own shell against a local bare repo.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { PENDING_OPEN } from "../lib/carry.ts";
import { REGRADE_MARKER } from "../lib/regrade.ts";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const verdict = readFileSync(join(repo, ".github/workflows/peace-verdict.yml"), "utf8");

function job(text: string, name: string): string {
  const body = text.split(/^jobs:\s*$/m)[1] ?? "";
  const start = body.indexOf(`\n  ${name}:\n`);
  assert.ok(start >= 0, `job ${name}`);
  const rest = body.slice(start + 1);
  const next = rest.slice(1).search(/\n {2}[A-Za-z0-9_-]+:\s*\n/);
  return next < 0 ? rest : rest.slice(0, next + 1);
}
function step(jobText: string, name: string): string {
  const i = jobText.indexOf(`- name: ${name}\n`);
  assert.ok(i >= 0, `step ${name}`);
  const rest = jobText.slice(i);
  const next = rest.slice(1).search(/\n {6}- (name|uses|run):/);
  return next < 0 ? rest : rest.slice(0, next + 1);
}
const cond = (s: string) => /\n {8}if: (.+)(?:\n|$)/.exec(s)?.[1] ?? "";
/** The step's own shell: a `run: |` block (dedented) or a one-line `run:`. */
function shell(s: string): string {
  const block = s.split("        run: |\n")[1];
  if (block !== undefined) return block.split("\n").map((l) => l.replace(/^ {10}/, "")).join("\n");
  const one = /\n {8}run: (.+)(?:\n|$)/.exec(s);
  assert.ok(one, "run line");
  return one[1]!;
}

const respond = job(verdict, "respond");
const targetPr = job(verdict, "target-pr");
const S = {
  hash: step(respond, "Check the chosen diff hash (Workspace PR)"),
  stale: step(respond, "Stale-base check (Workspace PR)"),
  post: step(respond, "Post the Workspace regrade request"),
  requeue: step(respond, "Re-queue the Workspace regrade (pending carry)"),
  fail: step(respond, "Workspace stale base without a regrade request (fail closed)"),
  open: step(respond, "Open a PR for the chosen candidate"),
};
const T = {
  hash: step(targetPr, "Check the chosen diff hash"),
  stale: step(targetPr, "Stale-base check"),
  post: step(targetPr, "Post the regrade request"),
  requeue: step(targetPr, "Re-queue the regrade (pending carry)"),
  fail: step(targetPr, "Stale base without a regrade request (fail closed)"),
};

test("wiring: hash -> stale -> regrade/fail-closed -> PR, and the PR step needs both a matching hash and stale == false", () => {
  const at = (s: string) => respond.indexOf(s);
  assert.ok(at("name: Hand off to the target's write environment") < at(S.hash));
  assert.ok(at("name: peaceai-chosen") < at(S.hash), "artifact is downloaded before the hash check");
  const order = [S.hash, S.stale, S.post, S.requeue, S.fail, S.open].map(at);
  assert.deepEqual([...order].sort((a, b) => a - b), order);
  assert.equal(cond(S.open), "steps.guard.outputs.open_pr == 'true' && steps.wshash.outputs.ok == 'true' && steps.wsstale.outputs.stale == 'false'");
  assert.equal(cond(S.hash), "steps.guard.outputs.open_pr == 'true'");
  assert.equal(cond(S.stale), "steps.guard.outputs.open_pr == 'true' && steps.wshash.outputs.ok == 'true'");
  assert.match(S.hash, /\n {8}id: wshash\n/);
  assert.match(S.stale, /\n {8}id: wsstale\n/);
  // #582's in-step hash check stays as a second line of defence.
  assert.match(S.open, /refused: chosen diff hash does not match the Results record/);
});

test("wiring: the Workspace checks are the target-pr checks with only the step ids and the target changed", () => {
  const norm = (s: string) => s.replaceAll("wsstale", "stale").replaceAll("wshash", "hash");
  for (const k of ["post", "requeue", "fail"] as const) assert.equal(norm(cond(S[k])), cond(T[k]), k);
  assert.equal(shell(S.stale), shell(T.stale), "same verdict-stale.ts invocation");
  assert.equal(shell(S.post), shell(T.post));
  assert.equal(shell(S.requeue), shell(T.requeue));
  assert.match(S.stale, /TARGET: \$\{\{ github\.repository \}\}/, "the target is this repository, never a record field");
  assert.match(S.stale, /BASE_SHA: \$\{\{ needs\.record\.outputs\.base_sha \}\}/);
  assert.match(S.stale, /VERDICT_COMMENT_ID: \$\{\{ needs\.parse\.outputs\.comment_id \}\}/);
  assert.match(S.stale, /VERDICT_SOURCE: \$\{\{ needs\.parse\.outputs\.source \}\}/);
  assert.match(S.hash, /DIFF_SHA: \$\{\{ needs\.record\.outputs\.diff_sha256 \}\}/);
  for (const s of Object.values(S)) assert.doesNotMatch(s, /secrets\.|TARGET_PR_TOKEN/, "built-in token only");
  assert.doesNotMatch(respond, /environment:/);
});

function sandbox(): { dir: string; done: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "m134-"));
  return { dir, done: () => rmSync(dir, { recursive: true, force: true }) };
}
function runSh(sh: string, cwd: string, env: Record<string, string>): { code: number; out: string; outputs: Record<string, string> } {
  const outFile = join(cwd, "gh-output");
  writeFileSync(outFile, "");
  const r = spawnSync("bash", ["--noprofile", "--norc", "-eo", "pipefail", "-c", sh], {
    cwd, encoding: "utf8", env: { PATH: process.env.PATH!, HOME: cwd, GITHUB_OUTPUT: outFile, ...env },
  });
  const outputs: Record<string, string> = {};
  for (const l of readFileSync(outFile, "utf8").split("\n")) { const i = l.indexOf("="); if (i > 0) outputs[l.slice(0, i)] = l.slice(i + 1); }
  return { code: r.status ?? -1, out: (r.stdout ?? "") + (r.stderr ?? ""), outputs };
}

test("hash step (its own shell): only the recorded bytes pass; wrong, upper-case or missing hashes refuse", () => {
  const { dir, done } = sandbox();
  try {
    mkdirSync(join(dir, "chosen"));
    const diff = "diff --git a/src/x.ts b/src/x.ts\n";
    writeFileSync(join(dir, "chosen", "chosen.diff"), diff);
    const sha = createHash("sha256").update(diff).digest("hex");
    const run = (DIFF_SHA: string) => runSh(shell(S.hash), dir, { RUNNER_TEMP: dir, DIFF_SHA });
    const ok = run(sha);
    assert.equal(ok.code, 0, ok.out);
    assert.equal(ok.outputs.ok, "true");
    for (const bad of [createHash("sha256").update("y").digest("hex"), sha.toUpperCase(), "", "x"]) {
      const r = run(bad);
      assert.notEqual(r.code, 0, bad);
      assert.equal(r.outputs.ok, "false", bad);
      assert.match(r.out, /refused: chosen diff hash does not match/);
    }
  } finally { done(); }
});

// The stale step resolves https://github.com/<TARGET>.git; the test points that at a local bare repo with an
// env-only git insteadOf, so the step's own command and verdict-stale.ts run unchanged and offline.
function staleFixture(dir: string) {
  const git = (cwd: string, ...a: string[]) => execFileSync("git", a, { cwd, encoding: "utf8", env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" } }).trim();
  const src = join(dir, "src"); mkdirSync(src);
  git(src, "init", "-q", "-b", "main");
  const commit = (m: string) => { git(src, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", m); return git(src, "rev-parse", "HEAD"); };
  const base = commit("base");
  const bare = join(dir, "remote", "PeaceG03", "PeaceAI-Workspace.git");
  mkdirSync(dirname(bare), { recursive: true });
  git(dir, "clone", "-q", "--bare", src, bare);
  const advance = () => { const h = commit("moved"); git(src, "push", "-q", bare, "HEAD:main"); return h; };
  symlinkSync(repo, join(dir, "tools"));
  mkdirSync(join(dir, "chosen"));
  const diff = "diff --git a/src/y.ts b/src/y.ts\nnew file mode 100644\n--- /dev/null\n+++ b/src/y.ts\n@@ -0,0 +1 @@\n+export const y = 1;\n";
  writeFileSync(join(dir, "chosen", "chosen.diff"), diff);
  const meta = (b: string) => writeFileSync(join(dir, "chosen", "chosen.json"), JSON.stringify({ runId: "18800000001", candidateId: "candidate-1", baseSha: b, transformations: ["DERIVE_FROM_BEHAVIOR"], operationId: null }));
  const run = (env: Record<string, string> = {}) => runSh(shell(S.stale), dir, {
    TARGET: "PeaceG03/PeaceAI-Workspace", BASE_SHA: base, CHOSEN_DIR: join(dir, "chosen"), BODY_FILE: join(dir, "regrade-comment.md"),
    VERDICT_COMMENT_ID: "3400000001", VERDICT_SOURCE: "comment", ISSUE_NUMBER: "700", LABEL: "A",
    GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_TERMINAL_PROMPT: "0",
    GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: `url.file://${join(dir, "remote")}/.insteadOf`, GIT_CONFIG_VALUE_0: "https://github.com/",
    ...env,
  });
  return { base, advance, meta, run, diff };
}

test("stale step (its own command): main still at the task base -> stale=false, so the PR step may run", () => {
  const { dir, done } = sandbox();
  try {
    const f = staleFixture(dir);
    f.meta(f.base);
    const r = f.run();
    assert.equal(r.code, 0, r.out);
    assert.equal(r.outputs.stale, "false", r.out);
  } finally { done(); }
});

test("stale step: main moved -> stale=true with the M18 regrade request and a pending carry for the owner's verdict", () => {
  const { dir, done } = sandbox();
  try {
    const f = staleFixture(dir);
    f.meta(f.base);
    const head = f.advance();
    const r = f.run();
    assert.equal(r.code, 0, r.out);
    assert.deepEqual([r.outputs.stale, r.outputs.ok, r.outputs.head], ["true", "true", head], r.out);
    const body = readFileSync(join(dir, "regrade-comment.md"), "utf8");
    assert.ok(body.startsWith(REGRADE_MARKER));
    assert.ok(body.includes(f.diff.trimEnd()), "the exact chosen bytes ride in the request");
    assert.ok(body.includes(PENDING_OPEN), "own /verdict comment -> pending carry");
    // A carried verdict that goes stale again is not re-carried.
    const again = f.run({ VERDICT_SOURCE: "carry" });
    assert.equal(again.outputs.ok, "true");
    assert.ok(!readFileSync(join(dir, "regrade-comment.md"), "utf8").includes(PENDING_OPEN));
  } finally { done(); }
});

test("stale step: undecidable cases fail closed (never stale=false)", () => {
  const { dir, done } = sandbox();
  try {
    const f = staleFixture(dir);
    f.meta(f.base);
    f.advance();
    rmSync(join(dir, "chosen", "chosen.json"));
    const noMeta = f.run();
    assert.deepEqual([noMeta.outputs.stale, noMeta.outputs.ok, noMeta.outputs.reason], ["true", "false", "chosen-meta-missing"], noMeta.out);
    f.meta("c".repeat(40));
    assert.equal(f.run().outputs.reason, "chosen-meta-missing", "meta for another base");
    assert.deepEqual([f.run({ TARGET: "PeaceG03/missing" }).outputs.stale, f.run({ TARGET: "PeaceG03/missing" }).outputs.reason], ["error", "head-unknown"]);
    assert.deepEqual([f.run({ BASE_SHA: "" }).outputs.stale, f.run({ BASE_SHA: "" }).outputs.reason], ["error", "bad-inputs"]);
    assert.equal(f.run({ TARGET: "../evil" }).outputs.stale, "error");
  } finally { done(); }
});

test("fail-closed step (its own shell): comments why and fails the job; the regrade steps post the body and re-queue", () => {
  const { dir, done } = sandbox();
  try {
    const bin = join(dir, "bin"); mkdirSync(bin);
    writeFileSync(join(bin, "gh"), `#!/bin/sh\nprintf '%s\\n' "$*" >> "${join(dir, "gh.log")}"\n`);
    chmodSync(join(bin, "gh"), 0o755);
    const env = { PATH: `${bin}:${process.env.PATH}`, ISSUE_NUMBER: "700", GITHUB_REPOSITORY: "PeaceG03/PeaceAI-Workspace", LABEL: "A" };
    const fail = runSh(shell(S.fail), dir, { ...env, REASON: "chosen-meta-missing" });
    assert.notEqual(fail.code, 0, "the job fails");
    const log = () => readFileSync(join(dir, "gh.log"), "utf8");
    assert.match(log(), /^issue comment 700 --repo PeaceG03\/PeaceAI-Workspace --body Verdict recorded: A right\. No PR opened: stale base, chosen-meta-missing\.\n$/);
    writeFileSync(join(dir, "gh.log"), "");
    assert.equal(runSh(shell(S.fail), dir, { ...env, REASON: "" }).code, 1);
    assert.match(log(), /stale base, regrade-request-failed\./);
    writeFileSync(join(dir, "gh.log"), "");
    assert.equal(runSh(shell(S.post), dir, { ...env, BODY_FILE: join(dir, "b.md") }).code, 0);
    assert.equal(runSh(shell(S.requeue), dir, env).code, 0);
    assert.equal(log(), `issue comment 700 --repo PeaceG03/PeaceAI-Workspace --body-file ${join(dir, "b.md")}\nissue edit 700 --repo PeaceG03/PeaceAI-Workspace --remove-label peaceai:done\nworkflow run peace-task.yml --repo PeaceG03/PeaceAI-Workspace --ref main\n`);
  } finally { done(); }
});
