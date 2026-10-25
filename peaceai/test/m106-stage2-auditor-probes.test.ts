// M106 stage 2, Auditor's #504 review: every probe Auditor ran against head 4be9544 (round 1, blockers 1-6) and
// against 98611e6 (round 2, B1-B4) is kept here as a permanent negative test. Each one must stay refused; the positive controls show the guard is not just "refuse all".
import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  addOnlyTestCheck, appliedDiffRefusals, checkStage2Proposal, computeNeverZone, parseGitDiff, parseRawZ, stage2ZoneRefusal,
  TOKEN_SCRIPTS, STAGE2_PHASES, stage2EngineFindings, stage2LedgerReasons, stage2PathRefusal, STAGE2_DATA_ALLOWLIST, type Stage2Record,
} from "../lib/selfchange.ts";
import { isolatedRun, lastCount, prepareStage2, recordStage2, stage2PrFacts, type Stage2PhaseRun } from "../lib/selfpropose.ts";

const repo = join(import.meta.dirname, "../..");
const NOREPLY = ["-c", "user.name=PeaceG03", "-c", "user.email=301894882+PeaceG03@users.noreply.github.com", "-c", "commit.gpgsign=false"];
const git = (cwd: string, ...a: string[]) => execFileSync("git", [...NOREPLY, ...a], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const reasons = (c: { refusals: { reason: string }[] }) => c.refusals.map((r) => r.reason).join(" | ");

// ---- a tiny base repo with a flag file, a workflow, a never-zone engine file, a proposable lib file and a doc
const FLAG = '{\n "schema": "peaceai-self-stage2:v1",\n "enabled": false,\n "note": "off"\n}\n';
const S = FLAG.split("\n");
function baseRepo(): string {
  const d = mkdtempSync(join(tmpdir(), "m106-probe-"));
  const put = (p: string, t: string) => { mkdirSync(join(d, p, ".."), { recursive: true }); writeFileSync(join(d, p), t); };
  put("peaceai/self/stage2.json", FLAG);
  put(".github/workflows/ci.yml", "name: ci\n\non:\n  push:\n");
  put("peaceai/lib/verdict.ts", 'import { r } from "./refusal-reason.ts";\nexport const v = r;\n');
  put("peaceai/lib/refusal-reason.ts", "export const r = 1;\n");
  put("peaceai/lib/free.ts", "export const free = 1;\n");
  put("docs/a.md", "a\n");
  git(d, "init", "-q", "-b", "main");
  git(d, "add", "-A");
  git(d, "commit", "-qm", "base");
  return d;
}
const flipHunk = `@@ -1,4 +1,4 @@\n ${S[0]}\n ${S[1]}\n-${S[2]}\n+ "enabled": true,\n ${S[3]}\n`;
const benign = "diff --git a/docs/zz-probe.md b/docs/zz-probe.md\nnew file mode 100644\nindex 0000000..1111111\n--- /dev/null\n+++ b/docs/zz-probe.md\n@@ -0,0 +1 @@\n+hello\n";
// Auditor's probe/mk.py cases, each one tries to flip peaceai/self/stage2.json (or reach the never-zone) past the parser
const CASES: Record<string, string> = {
  control_direct: "diff --git a/peaceai/self/stage2.json b/peaceai/self/stage2.json\nindex 1..2 100644\n--- a/peaceai/self/stage2.json\n+++ b/peaceai/self/stage2.json\n" + flipHunk,
  plain_unified_after_git: benign + "--- a/peaceai/self/stage2.json\n+++ b/peaceai/self/stage2.json\n" + flipHunk,
  header_mismatch: "diff --git a/docs/zz.md b/docs/zz.md\nindex 1..2 100644\n--- a/peaceai/self/stage2.json\n+++ b/peaceai/self/stage2.json\n" + flipHunk,
  space_header: benign + "diff --git a/peaceai/self/stage2.json b/peaceai/self/stage2.json \nindex 1..2 100644\n--- a/peaceai/self/stage2.json\n+++ b/peaceai/self/stage2.json\n" + flipHunk,
  crlf_header: benign + "diff --git a/peaceai/self/stage2.json b/peaceai/self/stage2.json\r\nindex 1..2 100644\n--- a/peaceai/self/stage2.json\n+++ b/peaceai/self/stage2.json\n" + flipHunk,
  dotslash: "diff --git a/peaceai/./self/stage2.json b/peaceai/./self/stage2.json\nindex 1..2 100644\n--- a/peaceai/./self/stage2.json\n+++ b/peaceai/./self/stage2.json\n" + flipHunk,
  dupslash: "diff --git a/peaceai//self/stage2.json b/peaceai//self/stage2.json\nindex 1..2 100644\n--- a/peaceai//self/stage2.json\n+++ b/peaceai//self/stage2.json\n" + flipHunk,
  quoted_octal: 'diff --git "a/peaceai/self/stage2.json" "b/peaceai/self/\\163tage2.json"\nindex 1..2 100644\n--- "a/peaceai/self/stage2.json"\n+++ "b/peaceai/self/\\163tage2.json"\n' + flipHunk,
  symlink_new: "diff --git a/peaceai/lib/zz.ts b/peaceai/lib/zz.ts\nnew file mode 120000\nindex 0000000..1111111\n--- /dev/null\n+++ b/peaceai/lib/zz.ts\n@@ -0,0 +1 @@\n+../self/stage2.json\n\\ No newline at end of file\n",
  rename_in: "diff --git a/docs/a.md b/peaceai/self/x.json\nsimilarity index 100%\nrename from docs/a.md\nrename to peaceai/self/x.json\n",
  git_p0_strip: "diff --git a/docs/zz.md b/docs/zz.md\nnew file mode 100644\n--- /dev/null\n+++ b/docs/zz.md\n@@ -0,0 +1 @@\n+x\ndiff --git a/x b/y\n",
  case_variant: "diff --git a/Peaceai/self/stage2.json b/Peaceai/self/stage2.json\nnew file mode 100644\n--- /dev/null\n+++ b/Peaceai/self/stage2.json\n@@ -0,0 +1 @@\n+{}\n",
  plain_unified_only: benign + "\nIndex: x\n--- peaceai/self/stage2.json\n+++ peaceai/self/stage2.json\n" + flipHunk,
  // probe/repro-gh-plain-after.patch and probe/repro-header-mismatch.patch (they rewrite the CI workflow)
  repro_gh_plain_after: "diff --git a/docs/zz-probe.md b/docs/zz-probe.md\nnew file mode 100644\n--- /dev/null\n+++ b/docs/zz-probe.md\n@@ -0,0 +1 @@\n+hello\n--- a/.github/workflows/ci.yml\n+++ b/.github/workflows/ci.yml\n@@ -1,3 +1,3 @@\n-name: ci\n+name: ci-pwned\n \n on:\n",
  repro_header_mismatch: "diff --git a/peaceai/lib/refusal-reason.ts b/peaceai/lib/refusal-reason.ts\nindex 1..2 100644\n--- a/.github/workflows/ci.yml\n+++ b/.github/workflows/ci.yml\n@@ -1,3 +1,3 @@\n-name: ci\n+name: ci-pwned\n \n on:\n",
};

test("M106 #504 blocker 1: every Auditor diff-parser probe is refused by the parser alone, and by the full prepare step (git apply + staged==parsed); the flag never flips", () => {
  const d = baseRepo();
  try {
    const base = git(d, "rev-parse", "HEAD");
    for (const [name, diff] of Object.entries(CASES)) {
      // layer 1: the strict parser + the check (empty closure: patterns only)
      const c = checkStage2Proposal(diff, { base: () => null, cand: () => null }, computeNeverZone([], () => null));
      assert.equal(c.ok, false, `${name}: the check must refuse`);
      // layer 2: the real prepare step in a fresh base repo
      git(d, "checkout", "-qf", "--detach", base);
      git(d, "clean", "-qfdx");
      const prep = prepareStage2(d, `sc-${name.replace(/_/g, "-")}`, diff, base, "refs/heads/main");
      assert.equal(prep.check.ok, false, `${name}: prepare must refuse: ${reasons(prep.check)}`);
      assert.equal(prep.candidateSha, "", `${name}: no candidate commit`);
      assert.equal(git(d, "show", "HEAD:peaceai/self/stage2.json").includes('"enabled": true'), false, `${name}: the flag is never committed flipped`);
      assert.equal(git(d, "rev-parse", "HEAD"), base, `${name}: nothing committed`);
    }
    // the parser names the trick
    assert.match(parseGitDiff(CASES.repro_gh_plain_after!).problems.join(), /text after a complete hunk/);
    assert.match(parseGitDiff(CASES.repro_header_mismatch!).problems.join(), /--- names another file than the header/);
    assert.match(parseGitDiff(CASES.crlf_header!).problems.join(), /carriage return|CR/i);
    assert.ok(parseGitDiff(CASES.space_header!).problems.length > 0);
    assert.ok(parseGitDiff(CASES.quoted_octal!).problems.length > 0, "quoted (octal) paths are refused, never crash");
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test("M106 #504 blocker 1: second layer, what git STAGED must equal what was parsed (even if a parser bug let a patch through)", () => {
  const d = baseRepo();
  try {
    for (const name of ["plain_unified_after_git", "repro_gh_plain_after", "repro_header_mismatch"]) {
      git(d, "checkout", "-qf", "main");
      git(d, "reset", "-q", "--hard");
      git(d, "clean", "-qfdx");
      writeFileSync(join(d, ".p"), CASES[name]!);
      const ap = spawnSync("git", ["apply", "--index", ".p"], { cwd: d });
      rmSync(join(d, ".p"));
      if (ap.status !== 0) continue; // git itself refused: fine
      const staged = parseRawZ(execFileSync("git", ["diff", "--cached", "--raw", "-z", "--no-renames"], { cwd: d, encoding: "utf8" }));
      const r = appliedDiffRefusals(staged, parseGitDiff(CASES[name]!).files);
      assert.ok(r.length > 0, `${name}: staged ${staged.map((e) => e.path)} must not match the parsed set`);
      assert.ok(r.join().match(/\.github\/workflows\/ci\.yml|peaceai\/self\/stage2\.json/), `${name}: ${r}`);
    }
    // modes git staged are checked too (symlink, executable)
    assert.ok(appliedDiffRefusals([{ oldMode: "000000", newMode: "120000", status: "A", path: "peaceai/lib/zz.ts" }], [{ oldPath: null, newPath: "peaceai/lib/zz.ts", status: "A", newMode: "100644", binary: false, added: [] }]).length > 0);
    // control: an honest diff stages exactly what it says
    git(d, "checkout", "-qf", "main");
    const ok = "diff --git a/peaceai/lib/free.ts b/peaceai/lib/free.ts\nindex 1..2 100644\n--- a/peaceai/lib/free.ts\n+++ b/peaceai/lib/free.ts\n@@ -1 +1 @@\n-export const free = 1;\n+export const free = 2;\n";
    assert.deepEqual(parseGitDiff(ok).problems, []);
    writeFileSync(join(d, ".p"), ok);
    execFileSync("git", ["apply", "--index", ".p"], { cwd: d });
    rmSync(join(d, ".p"));
    const staged = parseRawZ(execFileSync("git", ["diff", "--cached", "--raw", "-z", "--no-renames"], { cwd: d, encoding: "utf8" }));
    assert.deepEqual(appliedDiffRefusals(staged, parseGitDiff(ok).files), []);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test("M106 #504 blocker 2: the never-zone is the import / script closure of every never-zone file, computed from the base tree", () => {
  const tracked = execFileSync("git", ["ls-files"], { cwd: repo, encoding: "utf8" }).split("\n").filter(Boolean);
  const zone = computeNeverZone(tracked, (p) => { try { return readFileSync(join(repo, p), "utf8"); } catch { return null; } });
  // Auditor's probe/closure.out examples
  for (const p of [
    "peaceai/lib/learned.ts", "peaceai/lib/learned-workflow.ts", "peaceai/lib/workflow-job.ts", "peaceai/lib/tsconfig-script.ts",
    "peaceai/bin/leak-scan.ts", "peaceai/bin/gate.ts", "peaceai/bin/test-candidates.ts", "peaceai/bin/record-verdict.ts", "peaceai/bin/approve-rule.ts",
  ].filter((p) => tracked.includes(p))) assert.ok(stage2ZoneRefusal(p, zone), `${p} must be in the closure`);
  // token-holding peace-task / peace-train scripts and what they import
  for (const p of TOKEN_SCRIPTS) if (tracked.includes(p)) assert.match(stage2ZoneRefusal(p, zone) ?? "", /never-zone/, p);
  for (const p of ["peaceai/bin/review-comment.ts", "peaceai/bin/issue-fetch.ts", "peaceai/bin/select.ts", "peaceai/bin/generate.ts", "peaceai/bin/train.ts"]) assert.ok(TOKEN_SCRIPTS.includes(p), p);
  // synthetic: import chain, script reference from a workflow, and shadowing a missing import target
  const files: Record<string, string> = {
    "peaceai/lib/verdict.ts": 'import { a } from "./mid.ts";\nimport "./ghost.ts";\nexport const v = a;\n',
    "peaceai/lib/mid.ts": 'export { b as a } from "./leaf.ts";\n',
    "peaceai/lib/leaf.ts": "export const b = 1;\n",
    "peaceai/lib/free.ts": 'import { b } from "./leaf.ts";\nexport const f = b;\n',
    ".github/workflows/x.yml": "jobs:\n  a:\n    steps:\n      - run: npx tsx peaceai/bin/helper.ts\n",
    "peaceai/bin/helper.ts": "export {};\n",
  };
  const z = computeNeverZone(Object.keys(files), (p) => files[p] ?? null);
  assert.match(stage2ZoneRefusal("peaceai/lib/mid.ts", z) ?? "", /imported by peaceai\/lib\/verdict\.ts/);
  assert.match(stage2ZoneRefusal("peaceai/lib/leaf.ts", z) ?? "", /imported by peaceai\/lib\/mid\.ts/);
  assert.match(stage2ZoneRefusal("peaceai/bin/helper.ts", z) ?? "", /run or named by \.github\/workflows\/x\.yml/);
  assert.match(stage2ZoneRefusal("peaceai/lib/ghost.ts", z, true) ?? "", /replace a module a never-zone file imports/);
  assert.equal(stage2ZoneRefusal("peaceai/lib/free.ts", z), null, "control: importing a never-zone file does not close the importer");
  // and through the proposal check
  const diff = "diff --git a/peaceai/lib/leaf.ts b/peaceai/lib/leaf.ts\nindex 1..2 100644\n--- a/peaceai/lib/leaf.ts\n+++ b/peaceai/lib/leaf.ts\n@@ -1 +1 @@\n-export const b = 1;\n+export const b = 2;\n";
  assert.match(reasons(checkStage2Proposal(diff, { base: (p) => files[p] ?? null, cand: () => "export const b = 2;\n" }, z)), /never-zone: imported by/);
});

const ADD_BASE = 'import test from "node:test";\nimport assert from "node:assert/strict";\ntest("existing must fail", () => { assert.equal(1, 2); });\n';
test("M106 #504 blocker 3: new code may not write through parameters, aliases or nested paths into imports / globals (probe/neuter)", () => {
  const refused: [string, string][] = [
    ["probe/neuter/cand.test.ts", 'function neuter(x: any) { x.equal = () => {}; }\nconst done = neuter(assert);\ntest("new", () => { assert.ok(true); });\n'],
    ["arrow param", 'const n = (x: any) => { x.equal = () => {}; };\nconst d = n(assert);\ntest("new", () => { assert.ok(true); });\n'],
    ["alias then param", 'const a: any = assert;\nfunction n(x: any) { x.equal = 0; }\nconst d = n(a);\ntest("new", () => { assert.ok(true); });\n'],
    ["shadowed param name", 'function n(assert: any) { assert.equal = () => {}; }\nconst d = n(assert);\ntest("new", () => { assert.ok(true); });\n'],
    ["depth 2 through a fresh object", 'const o: any = { a: assert };\nconst d = (o.a.equal = () => {});\ntest("new", () => { assert.ok(true); });\n'],
    ["alias of an import", 'const a: any = assert;\ntest("new", () => { a.equal = () => {}; });\n'],
    ["destructured param", 'function n({ x }: any) { x.equal = 0; }\ntest("new", () => { n({ x: assert }); });\n'],
    ["Object.assign onto import", 'test("new", () => { Object.assign(assert, { equal: () => {} }); });\n'],
    ["module passed to a helper", 'function h(m: any) { return m; }\ntest("new", () => { h(assert); });\n'],
    ["delete through param", 'function n(x: any) { delete x.equal; }\ntest("new", () => { n(assert); });\n'],
  ];
  for (const [what, extra] of refused) {
    const r = addOnlyTestCheck("peaceai/test/m999-neuter.test.ts", ADD_BASE, ADD_BASE + extra);
    assert.ok(r.refusals.length > 0, `${what}: must be refused`);
  }
  // control: writes to fresh locals are fine
  const ok = addOnlyTestCheck("peaceai/test/m999-neuter.test.ts", ADD_BASE, ADD_BASE + 'test("new", () => { const o: { n: number } = { n: 1 }; o.n = 2; const xs: number[] = []; xs.push(1); assert.equal(o.n + xs.length, 3); });\n');
  assert.deepEqual(ok.refusals, []);
  assert.deepEqual(ok.added, ["new"]);
});

// probe/bans.mts: Auditor's non-literal forms. Content bans are ADVISORY LINT (paths / never-zone / add-only are the
// real guard), but every one of these forms is now flagged.
const BANS: Record<string, string> = {
  eval_direct: 'const r = eval("1");', eval_indirect: 'const r = (0, eval)("1");', eval_bracket: 'const r = (globalThis as any)["ev" + "al"]("1");',
  Function_nonew: 'const f = Function("return 1");', newFunction: 'const f = new Function("return 1");', dyn_import: "const m = await import(name);",
  require_var: "const m = require(name);", require_cp_literal: 'const cp = require("child_process");', import_cp: 'import { execSync } from "node:child_process";',
  token_literal: "const t = process.env.GITHUB_TOKEN;", token_concat: 'const t = process.env["GITHUB" + "_TOKEN"];', env_bracket: 'const t = process["env"]["PEACEAI_" + "SELF_SANDBOX"];',
  env_dot: "const t = process.env.PEACEAI_SELF_SANDBOX;", noverify: 'git("commit", "--no-verify");', noverify_concat: 'git("commit", "--no-" + "verify");',
  hooks_concat: 'git("config", "core.hooks" + "Path", "x");', approval_cmd: 'const c = "/auditor-pass";', approval_concat: 'const c = "/auditor" + "-pass";',
  verdict_cmd: 'const c = "/verdict sc-x abc right";',
};
test("M106 #504 content bans (advisory lint): every non-literal form in probe/bans.mts is flagged; a ban the base already has is not re-counted", () => {
  const zone = computeNeverZone([], () => null);
  for (const [k, line] of Object.entries(BANS)) {
    const cand = `export {};\n${line}\n`;
    const diff = `diff --git a/peaceai/lib/zz.ts b/peaceai/lib/zz.ts\nnew file mode 100644\n--- /dev/null\n+++ b/peaceai/lib/zz.ts\n@@ -0,0 +1,2 @@\n+export {};\n+${line}\n`;
    const c = checkStage2Proposal(diff, { base: () => null, cand: () => cand }, zone);
    assert.ok(c.refusals.some((r) => /^content/.test(r.reason)), `${k} must be flagged: ${reasons(c)}`);
  }
  // control: an unrelated edit to a file that already has a finding adds no content refusal
  const base = 'export const t = process.env.GITHUB_TOKEN;\nexport const a = 1;\n';
  const cand = 'export const t = process.env.GITHUB_TOKEN;\nexport const a = 2;\n';
  const diff = "diff --git a/peaceai/lib/zz.ts b/peaceai/lib/zz.ts\nindex 1..2 100644\n--- a/peaceai/lib/zz.ts\n+++ b/peaceai/lib/zz.ts\n@@ -1,2 +1,2 @@\n export const t = process.env.GITHUB_TOKEN;\n-export const a = 1;\n+export const a = 2;\n";
  assert.ok(!checkStage2Proposal(diff, { base: () => base, cand: () => cand }, zone).refusals.some((r) => /^content/.test(r.reason)));
});

test("M106 #504 blocker 5: each candidate run gets its own session; leftover processes are killed, counted, and fail the phase", () => {
  const d = mkdtempSync(join(repo, ".m106-iso-"));
  try {
    writeFileSync(join(d, "leak.test.ts"), 'import test from "node:test";\nimport { spawn } from "node:child_process";\ntest("leaks a sleeper", () => { spawn("sleep", ["37"], { stdio: "ignore" }).unref(); });\n');
    const r = isolatedRun(repo, ["--test", "--test-reporter=tap", join(d, "leak.test.ts")], Date.now() + 60_000);
    assert.ok(r.leftovers >= 1, `the sleeper must be found: ${JSON.stringify(r)}`);
    const still = spawnSync("pgrep", ["-f", "^sleep 37$"], { encoding: "utf8" }).stdout.trim();
    assert.equal(still, "", "and killed");
    const clean = join(d, "clean.test.ts");
    writeFileSync(clean, 'import test from "node:test";\ntest("ok", () => {});\n');
    const c = isolatedRun(repo, ["--test", "--test-reporter=tap", clean], Date.now() + 60_000);
    assert.deepEqual({ leftovers: c.leftovers, pass: c.pass, exit: c.exitCode }, { leftovers: 0, pass: 1, exit: 0 });
  } finally { rmSync(d, { recursive: true, force: true }); }
  // the record: a phase with leftovers, or a missing phase output, is failed (no retry)
  const prep = { schema: "peaceai-self-change-prep:v2", id: "sc-x", baseSha: "b".repeat(40), mainSha: "b".repeat(40), candidateSha: "c".repeat(40), diffSha256: "d".repeat(64), paths: ["peaceai/lib/free.ts", "peaceai/test/m999.test.ts"], candidateBlobs: {}, check: { ok: true, refusals: [], paths: [], newTests: [{ file: "peaceai/test/m999.test.ts", names: ["n"] }] }, suiteFiles: ["peaceai/test/a.test.ts"], createdAt: "" } as const;
  const run = (phase: (typeof STAGE2_PHASES)[number], over: Partial<Stage2PhaseRun["runs"][number]> = {}): Stage2PhaseRun => ({
    schema: "peaceai-self-change-run:v2", id: "sc-x", phase, candidateSha: "c".repeat(40), leftovers: over.leftovers ?? 0,
    runs: [phase === "suite" ? { exitCode: 0, pass: 5, fail: 0, leftovers: 0, ...over } : phase === "new-on-base" ? { file: "peaceai/test/m999.test.ts", name: "n", exitCode: 1, pass: 0, fail: 1, leftovers: 0, ...over } : { file: "peaceai/test/m999.test.ts", name: "n", exitCode: 0, pass: 1, fail: 0, leftovers: 0, ...over }],
  });
  const p = JSON.parse(JSON.stringify(prep));
  assert.equal(recordStage2(p, STAGE2_PHASES.map((ph) => run(ph))).status, "awaiting-review", "control");
  assert.equal(recordStage2(p, [run("suite"), run("new-on-candidate")]).status, "tested-failing", "missing phase");
  assert.equal(recordStage2(p, [run("suite", { leftovers: 1 }), run("new-on-candidate"), run("new-on-base")]).status, "tested-failing", "leftover in suite");
  assert.equal(recordStage2(p, [run("suite"), run("new-on-candidate"), run("new-on-base", { leftovers: 2 })]).status, "tested-failing", "leftover on base");
  assert.equal(recordStage2(p, [run("suite"), run("new-on-candidate"), { ...run("new-on-base"), candidateSha: "e".repeat(40) }]).status, "tested-failing", "foreign phase output");
});

test("M106 #504 blocker 6: the base is pinned to main and the PR is exactly base..head, re-checked on the real diff", () => {
  const d = baseRepo();
  try {
    const base = git(d, "rev-parse", "HEAD");
    const commit = (file: string, text: string, msg: string) => { mkdirSync(join(d, file, ".."), { recursive: true }); writeFileSync(join(d, file), text); git(d, "add", "-A"); git(d, "commit", "-qm", msg); return git(d, "rev-parse", "HEAD"); };
    const T = 'import test from "node:test";\ntest("free is 2", () => {});\n';
    git(d, "checkout", "-qb", "prop");
    commit("peaceai/test/m999-free.test.ts", T, "t");
    git(d, "reset", "-q", "--soft", base);
    writeFileSync(join(d, "peaceai/lib/free.ts"), "export const free = 2;\n");
    git(d, "add", "-A");
    git(d, "commit", "-qm", "proposal");
    const head = git(d, "rev-parse", "HEAD");
    const rec = { baseSha: base } as Stage2Record;
    const ok = stage2PrFacts(d, rec, head, [head], "refs/heads/main");
    assert.deepEqual({ baseOnMain: ok.baseOnMain, commitsExact: ok.commitsExact, recheck: ok.recheck.ok }, { baseOnMain: true, commitsExact: true, recheck: true }, reasons(ok.recheck));
    assert.equal(stage2PrFacts(d, rec, head, [head, head], "refs/heads/main").commitsExact, false, "GitHub lists another commit");
    const extra = commit("docs/b.md", "b\n", "extra");
    assert.equal(stage2PrFacts(d, rec, extra, [head, extra], "refs/heads/main").commitsExact, false, "two commits");
    // a base that is not on main
    git(d, "checkout", "-qb", "side", base);
    const side = commit("docs/side.md", "s\n", "side");
    assert.equal(stage2PrFacts(d, { baseSha: side } as Stage2Record, head, [head], "refs/heads/main").baseOnMain, false);
    git(d, "checkout", "-qf", "--detach", side);
    const prep = prepareStage2(d, "sc-side", "diff --git a/docs/a.md b/docs/a.md\nindex 1..2 100644\n--- a/docs/a.md\n+++ b/docs/a.md\n@@ -1 +1 @@\n-a\n+b\n", side, "refs/heads/main");
    assert.match(reasons(prep.check), /BASE_NOT_ON_MAIN/);
    // the real diff is re-checked: a PR head that touches the flag is refused even if the record looked clean
    git(d, "checkout", "-qf", "--detach", base);
    writeFileSync(join(d, "peaceai/self/stage2.json"), FLAG.replace("false", "true"));
    git(d, "add", "-A");
    git(d, "commit", "-qm", "flip");
    const flip = git(d, "rev-parse", "HEAD");
    const f = stage2PrFacts(d, rec, flip, [flip], "refs/heads/main");
    assert.equal(f.recheck.ok, false);
    assert.match(reasons(f.recheck), /never-zone/);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test("M106 #504: decide2 refuses the fixture-only --approvals mode; credit2 always refuses", () => {
  const tsx = join(repo, "node_modules/.bin/tsx");
  if (!existsSync(tsx)) return;
  const env = { ...process.env, GITHUB_ACTIONS: "", GITHUB_REPOSITORY: "" };
  const d = spawnSync(tsx, [join(repo, "peaceai/bin/self-change.ts"), "decide2", "--record", "/nonexistent", "--approvals", "/nonexistent"], { encoding: "utf8", env });
  assert.equal(d.status, 1);
  assert.match(d.stdout, /--approvals is a fixture-only mode/);
  const dir = mkdtempSync(join(tmpdir(), "m106-credit-"));
  try {
    writeFileSync(join(dir, "r.json"), JSON.stringify({ id: "sc-x" }));
    const c = spawnSync(tsx, [join(repo, "peaceai/bin/self-change.ts"), "credit2", "--record", join(dir, "r.json"), "--landed", "a".repeat(40)], { encoding: "utf8", env });
    assert.equal(c.status, 2);
    assert.match(c.stdout, /credit=false mark="no credit: no generator run record"/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ======================= round 2 (Auditor on 98611e6) =======================
const newFile = (path: string, text: string) => { const l = text.split("\n"); if (l[l.length - 1] === "") l.pop(); return `diff --git a/${path} b/${path}\nnew file mode 100644\n--- /dev/null\n+++ b/${path}\n@@ -0,0 +1,${l.length} @@\n${l.map((x) => "+" + x).join("\n")}\n`; };
const editFile = (path: string, base: string, cand: string) => { const b = base.split("\n"), c = cand.split("\n"); b.pop(); c.pop(); return `diff --git a/${path} b/${path}\nindex 1..2 100644\n--- a/${path}\n+++ b/${path}\n@@ -1,${b.length} +1,${c.length} @@\n${b.map((x) => "-" + x).join("\n")}\n${c.map((x) => "+" + x).join("\n")}\n`; };

test("M106 #504 round 2 B1(2): the LAST TAP summary counts; a fake summary printed earlier by a test cannot win (probe/forge/c, d)", () => {
  assert.equal(lastCount("# pass 50\n# fail 0\nnot ok 1 - x\n# pass 0\n# fail 1\n", "pass"), 0);
  assert.equal(lastCount("# pass 50\n# fail 0\nnot ok 1 - x\n# pass 0\n# fail 1\n", "fail"), 1);
  assert.equal(lastCount("no summary", "fail"), 0);
  const d = mkdtempSync(join(repo, ".m106-forge-"));
  try {
    for (const [f, body] of [["c.test.ts", 'import test from "node:test";\nconsole.log("# pass 50\\n# fail 0");\ntest("x fails", () => { throw new Error("boom"); });\n'], ["d.test.ts", 'import test from "node:test";\nconsole.log("pass 50\\nfail 0");\ntest("x fails", () => { throw new Error("boom"); });\n']]) {
      writeFileSync(join(d, f), body);
      const r = isolatedRun(repo, ["--test", "--test-reporter=tap", join(d, f)], Date.now() + 60_000);
      assert.deepEqual({ pass: r.pass, fail: r.fail, failed: r.exitCode !== 0 }, { pass: 0, fail: 1, failed: true }, f);
    }
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test("M106 #504 round 2 B1(3): ENFORCED engine-safety rule on added / changed code (probe/forge/a, b; cases6 via learned-multibody.ts)", () => {
  const zone = computeNeverZone([], () => null);
  const T = 'import test from "node:test";\nimport assert from "node:assert/strict";\nimport { f } from "../lib/zz.ts";\ntest("zz new", () => { assert.equal(f(), 1); });\n';
  const check = (lib: string, base: string | null = null) => checkStage2Proposal((base === null ? newFile("peaceai/lib/zz.ts", lib) : editFile("peaceai/lib/zz.ts", base, lib)) + newFile("peaceai/test/zz.test.ts", T), { base: (p) => (p === "peaceai/lib/zz.ts" ? base : null), cand: (p) => (p === "peaceai/lib/zz.ts" ? lib : T) }, zone);
  const ENGINE: Record<string, string> = {
    forge_a_exit: "export const f = () => 1;\nprocess.exit(0);\n",
    forge_b_assert_patch: 'import assert from "node:assert/strict";\n(assert as any).equal = () => {};\nexport const f = () => 1;\n',
    cases6_defineGetter: 'import nodeAssert from "node:assert/strict";\nexport const f = (): number => { (nodeAssert as any).__defineGetter__("equal", () => () => undefined); return 1; };\n',
    node_test_import: 'import test from "node:test";\nexport const f = () => 1;\n',
    assert_require: 'const a = require("node:assert");\nexport const f = () => 1;\n',
    assert_dyn: 'export const f = () => 1;\nvoid import("assert");\n',
    process_on: 'process.on("exit", () => {});\nexport const f = () => 1;\n',
    process_once: 'process.once("beforeExit", () => {});\nexport const f = () => 1;\n',
    process_env: "export const f = () => (process.env.X ? 1 : 1);\n",
    process_bracket: 'export const f = () => { (process as any)["ex" + "it"](0); return 1; };\n',
    process_alias: "const p = process;\nexport const f = () => 1;\n",
    process_exitCode: "export const f = () => { process.exitCode = 0; return 1; };\n",
    globalThis_write: "(globalThis as any).x = 1;\nexport const f = () => 1;\n",
    globalThis_read: "export const f = () => ((globalThis as any).process ? 1 : 1);\n",
    global_write: "(global as any).x = 1;\nexport const f = () => 1;\n",
    proto_write: "(Array.prototype as any).includes = () => true;\nexport const f = () => 1;\n",
    proto_user: "class A {}\n(A.prototype as any).x = 1;\nexport const f = () => 1;\n",
    dunder_proto: "const o: any = {};\no.__proto__.x = 1;\nexport const f = () => 1;\n",
    setPrototypeOf: "Object.setPrototypeOf({}, null);\nexport const f = () => 1;\n",
    defineSetter: '({} as any).__defineSetter__("x", () => {});\nexport const f = () => 1;\n',
    lookupGetter: 'const g = ({} as any).__lookupGetter__("x");\nexport const f = () => 1;\n',
    computed_define: 'const k = "__define" + "Getter__";\nexport const f = () => 1;\n',
    reflect: 'import * as m from "./other.ts";\nReflect.set(m, "x", 1);\nexport const f = () => 1;\n',
    defineProperty_import: 'import * as m from "./other.ts";\nObject.defineProperty(m, "x", { value: 1 });\nexport const f = () => 1;\n',
    assign_builtin: "Object.assign(Math, { max: () => 0 });\nexport const f = () => 1;\n",
    write_import: 'import { cfg } from "./other.ts";\n(cfg as any).on = true;\nexport const f = () => 1;\n',
    delete_builtin: "delete (JSON as any).parse;\nexport const f = () => 1;\n",
    builtin_write: "(Math as any).max = () => 0;\nexport const f = () => 1;\n",
    child_process: 'import { execSync } from "node:child_process";\nexport const f = () => 1;\n',
    worker_threads: 'import { Worker } from "node:worker_threads";\nexport const f = () => 1;\n',
    node_process: 'import p from "node:process";\nexport const f = () => 1;\n',
    constructor_escape: 'export const f = () => (() => 1).constructor("return 1")();\n',
    eval: 'export const f = () => eval("1");\n',
  };
  for (const [k, lib] of Object.entries(ENGINE)) {
    const c = check(lib);
    assert.ok(c.refusals.some((r) => /^engine-safety:/.test(r.reason)), `${k} must be refused (enforced): ${reasons(c)}`);
    assert.equal(c.ok, false, k);
  }
  // only NEW occurrences count: an unrelated edit to a file that already reads process.env is not refused
  const old = "export const g = process.env.HOME;\nexport const f = () => 1;\n";
  assert.ok(!check(old.replace("=> 1", "=> 2"), old).refusals.some((r) => /^engine-safety/.test(r.reason)), "pre-existing occurrence is not re-counted");
  // control: plain engine code passes
  const ok = check('import { join } from "node:path";\nexport const f = (): number => { const xs: number[] = []; xs.push(1); return join("a", "b").length - 2; };\n');
  assert.ok(!ok.refusals.some((r) => /^engine-safety/.test(r.reason)), reasons(ok));
  // tests too: the same rule minus the node:assert / node:test ban (a test file that exits 0 at import neuters its file)
  for (const extra of ["const quit = process.exit(0);\n", 'const hook = process.on("exit", () => {});\n', "const g = (globalThis as any).x;\n"]) {
    const base = 'import test from "node:test";\nimport assert from "node:assert/strict";\ntest("existing must fail", () => { assert.equal(1, 2); });\n';
    const cand = base + extra + 'test("zz new", () => { assert.ok(true); });\n';
    const c = checkStage2Proposal(editFile("peaceai/test/m999-x.test.ts", base, cand), { base: () => base, cand: () => cand }, zone);
    assert.ok(c.refusals.some((r) => /^engine-safety:/.test(r.reason)), `${extra.trim()}: ${reasons(c)}`);
  }
  assert.deepEqual(stage2EngineFindings("peaceai/test/x.test.ts", 'import test from "node:test";\nimport assert from "node:assert/strict";\n', { testFile: true }), []);
});

test("M106 #504 round 2 B1(3): cases6 (learned-multibody.ts neuters node:assert at load) is refused by the full prepare step", () => {
  const d = baseRepo();
  try {
    const base = git(d, "rev-parse", "HEAD");
    const lib = 'import nodeAssert from "node:assert/strict";\nexport const free = 1;\nexport const multibodyReady = (): boolean => { (nodeAssert as any).__defineGetter__("equal", () => () => undefined); return true; };\nexport const MB_READY = multibodyReady();\n';
    const t = 'import test from "node:test";\nimport assert from "node:assert/strict";\nimport { MB_READY } from "../lib/free.ts";\ntest("zz multibody ready", () => { assert.ok(MB_READY); });\n';
    const diff = editFile("peaceai/lib/free.ts", "export const free = 1;\n", lib) + newFile("peaceai/test/zz-probe.test.ts", t);
    const prep = prepareStage2(d, "sc-r2-cases6", diff, base, "refs/heads/main");
    assert.equal(prep.check.ok, false);
    assert.match(reasons(prep.check), /engine-safety: non-test code imports node:assert\/strict/);
    assert.match(reasons(prep.check), /engine-safety: uses __defineGetter__/);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test("M106 #504 round 2 B2: data files protected code reads are never-zone (cases4 derive-practice-families.json, cases5 nl/model.json); the allowlist is short and lives in selfchange.ts", () => {
  for (const p of ["peaceai/lib/derive-practice-families.json", "peaceai/nl/model.json", "peaceai/model/x.json", "peaceai/rules/learned/x.json", "peaceai/spec/multibody-v1.md", "peaceai/test/fixtures/m99-dfb/a.txt", "peaceai/lib/x.txt", "peaceai/lib/x.yml", "peaceai/x.sh", "peaceai/proof/x.md", "peaceai/package.json", "peaceai/lib/x"]) {
    assert.match(stage2PathRefusal(p) ?? "", /never-zone/, p);
  }
  assert.equal(STAGE2_DATA_ALLOWLIST.length, 1, "keep the allowlist short (adding to it is a never-zone edit)");
  assert.match(stage2PathRefusal("peaceai/lib/selfchange.ts") ?? "", /never-zone/, "the allowlist's own file is never-zone");
  for (const p of ["peaceai/docs/a.md", "peaceai/lib/free.ts", "docs/a.md"]) assert.equal(stage2PathRefusal(p), null, `control: ${p}`);
  // the real repo's never-zone and the exact probe diffs (headers + first hunk of cases4 / cases5)
  const tracked = execFileSync("git", ["ls-files"], { cwd: repo, encoding: "utf8" }).split("\n").filter(Boolean);
  const read = (p: string) => { try { return readFileSync(join(repo, p), "utf8"); } catch { return null; } };
  const zone = computeNeverZone(tracked, read);
  const T = 'import test from "node:test";\nimport assert from "node:assert/strict";\nimport { FAMILIES } from "../lib/derive-practice.ts";\n\ntest("zz probe families", () => {\n  assert.equal(FAMILIES.length > 0, true);\n});\n';
  for (const path of ["peaceai/lib/derive-practice-families.json", "peaceai/nl/model.json"]) {
    const base = read(path)!;
    const cand = base.replace(/"active"|"none"/, (m) => (m === '"active"' ? '"staged"' : '"guard"'));
    assert.notEqual(cand, base);
    const c = checkStage2Proposal(editFile(path, base, cand) + newFile("peaceai/test/zz-probe.test.ts", T), { base: (p) => (p === path ? base : null), cand: (p) => (p === path ? cand : T) }, zone);
    assert.equal(c.ok, false, path);
    assert.ok(c.refusals.some((r) => r.path === path && /never-zone: data file under peaceai\//.test(r.reason)), `${path}: ${reasons(c)}`);
  }
  // and through prepare on a git base
  const d = baseRepo();
  try {
    mkdirSync(join(d, "peaceai/nl"), { recursive: true });
    writeFileSync(join(d, "peaceai/nl/model.json"), '{"labels":["none"]}\n');
    git(d, "add", "-A");
    git(d, "commit", "-qm", "model");
    const base = git(d, "rev-parse", "HEAD");
    const prep = prepareStage2(d, "sc-r2-cases5", editFile("peaceai/nl/model.json", '{"labels":["none"]}\n', '{"labels":["guard"]}\n'), base, "refs/heads/main");
    assert.equal(prep.check.ok, false);
    assert.match(reasons(prep.check), /never-zone: data file under peaceai\//);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test("M106 #504 round 2 B3: __defineGetter__ & co in any form, and computed member calls / writes on imports, are refused in test files (probe/neuter2)", () => {
  const BASE = 'import test from "node:test";\nimport assert from "node:assert/strict";\nimport { strict } from "node:assert";\ntest("existing must fail", () => { assert.equal(1, 2); });\n';
  const NEUTER2: Record<string, string> = {
    c7_defineGetter: 'const z = (assert as any).__defineGetter__("equal", () => () => {});\n',
    c8_defineGetter_named: 'const z = (strict as any).__defineGetter__("equal", () => () => {});\n',
    c8b_computed_concat: 'const z = (strict as any)["__define" + "Getter__"]("equal", () => () => {});\n',
    c8c_computed_template: 'const z = (strict as any)[`__define${"Getter"}__`]("equal", () => () => {});\n',
    c8d_computed_var: 'const k = "__define" + "Getter__";\nconst z = (strict as any)[k]("equal", () => () => {});\n',
    c8e_computed_join: 'const z = (strict as any)[["__define", "Getter__"].join("")]("equal", () => () => {});\n',
    c8f_defineSetter: 'const z = (assert as any).__defineSetter__("equal", () => {});\n',
    c8g_lookupGetter: 'const z = (assert as any).__lookupGetter__("equal");\n',
    c8h_lookupSetter: 'const z = (assert as any).__lookupSetter__("equal");\n',
    c8i_proto_string: 'const z = (assert as any)["__pro" + "to__"];\n',
    c8j_computed_write_named: 'const k = "equal";\ntest("w", () => { (strict as any)[k] = () => {}; });\n',
    c8k_constructor: 'const z = (strict as any).constructor;\n',
    c23_test_body: 'test("helper", () => { (strict as any).__defineGetter__("equal", () => () => {}); });\n',
    c24_named_objassign_in_test: 'test("helper2", () => { const o: any = { s: strict }; o.s.equal = () => {}; });\n',
    c22_named_in_array_assign: 'const arr: any[] = [strict];\nconst z = Object.assign(arr[0], { equal: () => {} });\n',
    c12_alias: 'const a: any = strict;\ntest("helper3", () => { a.equal = () => {}; });\n',
    c4_reflect: 'const z = Reflect.set(strict, "equal", () => {});\n',
    c5_defprop: 'const z = Object.defineProperty(strict, "equal", { value: () => {} });\n',
    c6_named_assign: 'test("helper4", () => { (strict as any).equal = () => {}; });\n',
  };
  for (const [k, extra] of Object.entries(NEUTER2)) {
    const r = addOnlyTestCheck("peaceai/test/m999-neuter.test.ts", BASE, BASE + extra);
    assert.ok(r.refusals.length > 0, `${k} must be refused`);
  }
  // the files Auditor ran (probe/neuter2/c7, c8, c8b, c23), byte for byte
  for (const [k, extra] of [["c7", 'const z = (assert as any).__defineGetter__("equal", () => () => {});\n'], ["c8", 'const z = (strict as any).__defineGetter__("equal", () => () => {});\n'], ["c8b", 'const z = (strict as any)["__define" + "Getter__"]("equal", () => () => {});\n'], ["c23", 'test("helper", () => { (strict as any).__defineGetter__("equal", () => () => {}); });\n']] as const) {
    assert.match(addOnlyTestCheck("peaceai/test/m999-neuter.test.ts", BASE, BASE + extra).refusals.join(" | "), /accessor-definition|__defineGetter__|computed member call/, k);
  }
  // controls: numeric index calls and plain method calls on fresh values are fine
  const ok = addOnlyTestCheck("peaceai/test/m999-neuter.test.ts", BASE, BASE + 'test("zz ok", () => { const fs = [() => 1]; const o = { n: 1 }; o.n = 2; assert.equal(fs[0]() + o.n, 3); });\n');
  assert.deepEqual(ok.refusals, []);
});

test("M106 #504 round 2 B4: no retry across runs; the record names its run, the write-once ledger names the run per id, and a reused id cannot match", () => {
  const prep = { schema: "peaceai-self-change-prep:v2", id: "sc-x", baseSha: "b".repeat(40), mainSha: "b".repeat(40), candidateSha: "", diffSha256: "", paths: [], candidateBlobs: {}, check: { ok: false, refusals: [], paths: [], newTests: [] }, suiteFiles: [], createdAt: "" };
  const withRun = recordStage2({ ...prep, run: { repository: "PeaceG03/PeaceAI-Results", runId: "77", runAttempt: "1" } } as never, []);
  assert.deepEqual(withRun.run, { repository: "PeaceG03/PeaceAI-Results", runId: "77", runAttempt: "1" });
  assert.equal(withRun.countsTrust, "candidate-process-reported, advisory");
  assert.equal(recordStage2(prep as never, []).run, null, "no run id (offline) = cannot match any ledger entry");
  const rec = { ...withRun, id: "sc-x" } as Stage2Record;
  const entry = { schema: "peaceai-self-change-ledger:v1" as const, id: "sc-x", base: "b".repeat(40), runId: "77", patchSha256: "" };
  assert.deepEqual(stage2LedgerReasons(rec, { entry, commits: 1 }), []);
  // a second run for the same id: its ledger PUT fails (no sha = create-only), so the entry keeps naming run 77;
  // a record from the second run (run 78) never matches; deleting and re-creating the entry shows up as >1 commit
  assert.deepEqual(stage2LedgerReasons({ ...rec, run: { ...rec.run!, runId: "78" } }, { entry, commits: 1 }), ["RECORD_NOT_FROM_LEDGER_RUN"]);
  assert.deepEqual(stage2LedgerReasons({ ...rec, run: { ...rec.run!, runId: "78" } }, { entry: { ...entry, runId: "78" }, commits: 3 }), ["LEDGER_REWRITTEN"]);
  assert.deepEqual(stage2LedgerReasons(rec, { entry: null, commits: 0 }), ["LEDGER_MISSING"]);
  assert.deepEqual(stage2LedgerReasons({ ...rec, run: { ...rec.run!, repository: "someone/else" } }, { entry, commits: 1 }), ["RECORD_NOT_FROM_LEDGER_RUN"]);
  // decide2 reads the ledger with GETs only
  const bin = readFileSync(join(repo, "peaceai/bin/self-change.ts"), "utf8");
  const s2 = bin.slice(bin.indexOf('mode === "decide2"'), bin.indexOf('} else if (mode === "decide")'));
  assert.match(s2, /contents\/\$\{ledgerPath\}/);
  assert.match(s2, /commits\?path=/);
  assert.doesNotMatch(s2, /"-X"|--method|PUT|POST|DELETE/);
});
