// Auditor #489 (review of 7508d20): BEHAVIORAL proof that an EXISTING_EDIT (M98) candidate's original suite runs
// confined, in both original-suite modes ("full": PeaceAI-Workspace; "related": PeaceSTOCKS). The fixture's existing
// test escapes (writes a marker file outside the confined scratch dir) only when it sees the edited behaviour, so it
// passes confined on the base (and is judged in "related" mode) and attempts the escape only on the candidate. A
// confined run denies the write and fails the original suite; an unconfined one would leave the marker behind. Each
// test fails if its branch in bin/test-candidates.ts falls back to the unconfined runner (verified by mutation).
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { APPROVED_SCHEMA } from "../lib/approved.ts";
import { specHash, type RuleSpec } from "../lib/learned.ts";
import { analyzeSuppliedEdit } from "../lib/learned-edit-existing.ts";
import { PEACE_AUTHOR } from "../lib/minetest.ts";

const repo = resolve(import.meta.dirname, "..", "..");
const tsx = join(repo, "node_modules/.bin/tsx");
const spec = JSON.parse(readFileSync(join(repo, "peaceai/rules/learned/public-existing-function-edit-v1.json"), "utf8")) as RuleSpec & { trigger: string; params: Record<string, string> };
const git = (cwd: string, ...a: string[]) => execFileSync("git", ["-c", "user.name=PeaceG03", "-c", `user.email=${PEACE_AUTHOR}`, ...a], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const MOD = "export function f(n: number): number {\n  return n + 1;\n}\n";
const TSCONFIG = JSON.stringify({ compilerOptions: { target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", strict: true, noEmit: true, allowImportingTsExtensions: true }, include: ["src"] });
const permission = Number(process.versions.node.split(".")[0]) >= 22;

function runConfinedFixture(target: string, escape: "edit" | "base" | "never" = "edit", extraTests: Record<string, string> = {}) {
  const dir = mkdtempSync(join(tmpdir(), "m98c-"));
  try {
    const ws = join(dir, "ws"), marker = join(dir, "escaped.txt");
    // the harness's own TMPDIR is fixture-private, so leftover confined scratch dirs can be seen after the run
    const harnessTmp = join(dir, "harness-tmp");
    mkdirSync(harnessTmp);
    mkdirSync(join(ws, "src"), { recursive: true });
    writeFileSync(join(ws, "src/m.ts"), MOD);
    // the existing test: passes on the base (f(1) === 2); on the edit it tries to write outside the scratch dir
    writeFileSync(join(ws, "src/m.test.ts"), `import test from "node:test";\nimport { writeFileSync } from "node:fs";\nimport { f } from "./m.ts";\ntest("orig", () => {\n  if (${escape === "edit" ? "f(1) === 3" : escape === "base" ? "f(1) === 2" : "f(1) === 3 && f(0) === 0"}) writeFileSync(${JSON.stringify(marker)}, "escaped");\n});\n`);
    for (const [path, content] of Object.entries(extraTests)) writeFileSync(join(ws, path), content);
    writeFileSync(join(ws, "tsconfig.json"), TSCONFIG);
    writeFileSync(join(ws, "package.json"), JSON.stringify({ name: "m98c", private: true, type: "module" }));
    writeFileSync(join(ws, ".gitignore"), "node_modules\n");
    symlinkSync(join(repo, "node_modules"), join(ws, "node_modules"));
    git(ws, "init", "-q", "-b", "main"); git(ws, "add", "-A"); git(ws, "commit", "-qm", "base");
    const baseSha = git(ws, "rev-parse", "HEAD").trim();
    const r = analyzeSuppliedEdit(spec.trigger, spec.params, "in f in src/m.ts: replace statement return n + 1; with return n + 2;\n- expect f(1) returns 3", [{ path: "src/m.ts", content: MOD }]);
    assert.ok(r.edit, r.reason ?? "");
    writeFileSync(join(ws, r.edit.path), r.edit.content);
    for (const x of r.edit.extra) writeFileSync(join(ws, x.path), x.content);
    git(ws, "add", "-N", "--", ...r.edit.extra.map((x) => x.path));
    const diff = git(ws, "diff", "--no-color", "--full-index", "--no-renames");
    git(ws, "reset", "-q", "--hard"); git(ws, "clean", "-fdq");
    const inDir = join(dir, "in");
    mkdirSync(join(inDir, "candidates"), { recursive: true });
    writeFileSync(join(inDir, "candidates/candidate-1.diff"), diff);
    const op = `learned:${spec.id}@${specHash(spec)}`;
    writeFileSync(join(inDir, "summary.json"), JSON.stringify({ schema: "peaceai-workspace-candidates:v1", taskId: "workspace-issue-9", baseSha, candidates: [{ id: "candidate-1", file: "candidates/candidate-1.diff", transformations: ["LEARNED_EXISTING_EDIT"], operationId: op, diffBytes: diff.length, diffLines: 5, selfGrade: true }] }));
    // a fixture-local approval list (the repo's approved.json is never read or asserted on here)
    const list = join(dir, "approved.json");
    writeFileSync(list, JSON.stringify({ schema: APPROVED_SCHEMA, rules: [{ id: spec.id, sha256: specHash(spec), source: "workspace", approval: { url: "https://github.com/PeaceG03/PeaceAI-Workspace/issues/40#issuecomment-123", commentId: 123, issue: 40, repo: "PeaceG03/PeaceAI-Workspace", author: "PeaceG03", approvedAt: "2026-10-11T00:00:00Z" } }] }));
    const resultsFile = join(dir, "out/results.json");
    mkdirSync(join(dir, "out"), { recursive: true });
    const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("NODE_TEST")));
    const p = spawnSync(tsx, [join(repo, "peaceai/bin/test-candidates.ts")], {
      cwd: repo, encoding: "utf8",
      env: { ...env, PEACEAI_IN_DIR: inDir, PEACEAI_RESULTS_FILE: resultsFile, PEACEAI_WORKSPACE_DIR: ws, PEACEAI_TARGET: target, PEACEAI_SANDBOX_USER: "", PEACEAI_REQUIRE_SANDBOX: "", PEACEAI_APPROVED_LIST: list, TMPDIR: harnessTmp },
    });
    assert.equal(p.status, 0, p.stderr);
    const res = JSON.parse(readFileSync(resultsFile, "utf8")).results[0];
    return { res, escaped: existsSync(marker), log: p.stdout, leftovers: readdirSync(harnessTmp).filter((n) => n.startsWith("peaceai-confined-")) };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

test("Auditor #489: full mode (PeaceAI-Workspace) runs the M98 original suite confined — the escape is denied", { skip: !permission && "needs Node >= 22 (--permission)" }, () => {
  // control: the same candidate with an existing test that never escapes passes confined, so a failure below is the denied write
  const ok = runConfinedFixture("PeaceG03/PeaceAI-Workspace", "never");
  assert.equal(ok.res.originalSuitePassed, true, ok.log);
  assert.equal(ok.escaped, false);
  const { res, escaped, log } = runConfinedFixture("PeaceG03/PeaceAI-Workspace");
  assert.equal(res.applied, true, log);
  assert.equal(escaped, false, "the candidate's original suite wrote outside its scratch dir (ran unconfined)");
  assert.equal(res.originalSuitePassed, false, log);
});

test("Auditor #489: related mode (PeaceSTOCKS) judges confined on the base and runs the M98 suite confined — the escape is denied", { skip: !permission && "needs Node >= 22 (--permission)" }, () => {
  const ok = runConfinedFixture("PeaceG03/PeaceSTOCKS", "never");
  assert.equal(ok.res.originalSuitePassed, true, ok.log);
  assert.equal(ok.escaped, false);
  const { res, escaped, log } = runConfinedFixture("PeaceG03/PeaceSTOCKS");
  assert.match(log, /related_tests=1 judged=1 confined=1 unconfinable=0/);
  assert.equal(res.applied, true, log);
  assert.equal(escaped, false, "the candidate's related test wrote outside its scratch dir (ran unconfined)");
  assert.equal(res.originalSuitePassed, false, log);
});

test("Auditor #489: related mode judges an M98 candidate's related tests CONFINED on the base — a test that escapes there is denied and fails closed", { skip: !permission && "needs Node >= 22 (--permission)" }, () => {
  const { res, escaped, log } = runConfinedFixture("PeaceG03/PeaceSTOCKS", "base");
  assert.match(log, /related_tests=1 judged=0 confined=1 unconfinable=1/);
  assert.equal(escaped, false, "the related test wrote outside its scratch dir while judged on the base (ran unconfined)");
  assert.equal(res.originalSuitePassed, false, log);
});

// W619 (#619 derive run 41063057390): PeaceSTOCKS related tests that spawn zstd or read .github/ can't pass confined even
// on the base. They are never run on the edit (still never unconfined); the harness takes the next related tests that
// do pass confined, and judges the edit with them when at least MIN_CONFINED_JUDGED (2) remain.
const SPAWNS = `import test from "node:test";\nimport { execFileSync } from "node:child_process";\nimport { f } from "./m.ts";\ntest("spawns", () => { execFileSync("true"); if (f(1) < 0) throw new Error("x"); });\n`;
const CONFINED_OK = `import test from "node:test";\nimport assert from "node:assert/strict";\nimport { f } from "./m.ts";\ntest("ok", () => { assert.equal(f(0) > 0, true); });\n`;
const BREAKS_ON_EDIT = `import test from "node:test";\nimport assert from "node:assert/strict";\nimport { f } from "./m.ts";\ntest("pins", () => { assert.equal(f(1), 2); });\n`;

test("W619: a related test that can't pass confined on the base is skipped when enough confined tests judge the edit", { skip: !permission && "needs Node >= 22 (--permission)" }, () => {
  const { res, escaped, log } = runConfinedFixture("PeaceG03/PeaceSTOCKS", "never", { "src/m.a-spawn.test.ts": SPAWNS, "src/m.b-ok.test.ts": CONFINED_OK });
  assert.match(log, /related_tests=3 judged=2 confined=1 unconfinable=1 pool=3 judgeable=true/);
  assert.equal(res.applied, true, log);
  assert.equal(escaped, false);
  assert.equal(res.originalSuitePassed, true, log);
});

test("W619: the pool is probed past unconfinable tests up to RELATED_LIMIT judged; a judged test the edit breaks still fails it", { skip: !permission && "needs Node >= 22 (--permission)" }, () => {
  const extra = { "src/m.a-spawn.test.ts": SPAWNS, "src/m.b-spawn.test.ts": SPAWNS, "src/m.c-ok.test.ts": CONFINED_OK, "src/m.d-ok.test.ts": CONFINED_OK, "src/m.e-pins.test.ts": BREAKS_ON_EDIT, "src/m.f-ok.test.ts": CONFINED_OK };
  const { res, escaped, log } = runConfinedFixture("PeaceG03/PeaceSTOCKS", "never", extra);
  // m.a, m.b unconfinable; m.c, m.d, m.e (passes on the base), m.f judged = RELATED_LIMIT 4; m.test.ts never probed
  assert.match(log, /related_tests=6 judged=4 confined=1 unconfinable=2 pool=7 judgeable=true/);
  assert.equal(res.applied, true, log);
  assert.equal(escaped, false);
  assert.equal(res.originalSuitePassed, false, log);
  // control: the same pool with m.e passing on the edit too passes, so the failure above is the broken judged test
  const ok = runConfinedFixture("PeaceG03/PeaceSTOCKS", "never", { ...extra, "src/m.e-pins.test.ts": CONFINED_OK });
  assert.match(ok.log, /related_tests=6 judged=4 confined=1 unconfinable=2 pool=7 judgeable=true/);
  assert.equal(ok.res.originalSuitePassed, true, ok.log);
});

test("W619: with unconfinable related tests, fewer than 2 confined judged tests fails closed (0 and 1)", { skip: !permission && "needs Node >= 22 (--permission)" }, () => {
  const none = runConfinedFixture("PeaceG03/PeaceSTOCKS", "base", { "src/m.a-spawn.test.ts": SPAWNS });
  assert.match(none.log, /related_tests=2 judged=0 confined=1 unconfinable=2 pool=2 judgeable=false/);
  assert.equal(none.escaped, false);
  assert.equal(none.res.originalSuitePassed, false, none.log);
  const one = runConfinedFixture("PeaceG03/PeaceSTOCKS", "never", { "src/m.a-spawn.test.ts": SPAWNS });
  assert.match(one.log, /related_tests=2 judged=1 confined=1 unconfinable=1 pool=2 judgeable=false/);
  assert.equal(one.res.originalSuitePassed, false, one.log);
});

// W619 follow-ups (Auditor #620): the edited module's own tests are probed first, and every confined run gets a fresh
// TMPDIR/TMP/TEMP/HOME scratch dir (outside the tree) that is removed after the run.
test("W619 follow-up: related mode orders the edited module's own tests before importers", { skip: !permission && "needs Node >= 22 (--permission)" }, () => {
  // src/a-imp.test.ts imports ./m.ts and sorts before src/m.*; it must come after the own tests
  const { res, log } = runConfinedFixture("PeaceG03/PeaceSTOCKS", "never", { "src/a-imp.test.ts": CONFINED_OK, "src/m.b-ok.test.ts": CONFINED_OK, "src/m-c.test.ts": CONFINED_OK });
  assert.match(log, /related_pool=src\/m-c\.test\.ts,src\/m\.b-ok\.test\.ts,src\/m\.test\.ts,src\/a-imp\.test\.ts judged_tests=src\/m-c\.test\.ts,src\/m\.b-ok\.test\.ts,src\/m\.test\.ts,src\/a-imp\.test\.ts/);
  assert.equal(res.originalSuitePassed, true, log);
});

const TMP_PROBE = `import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { f } from "./m.ts";
test("tmp", () => {
  const t = resolve(tmpdir());
  assert.equal(process.env.TMP, process.env.TMPDIR);
  assert.equal(process.env.TEMP, process.env.TMPDIR);
  assert.equal(process.env.HOME, process.env.TMPDIR);
  assert.equal(t.startsWith(resolve(process.cwd()) + "/"), false);
  assert.equal(existsSync(join(t, "seen")), false);
  writeFileSync(join(t, "seen"), "1");
  const d = mkdtempSync(join(t, "probe-"));
  writeFileSync(join(d, "a"), "b");
  assert.equal(readFileSync(join(d, "a"), "utf8"), "b");
  assert.equal(f(0) > 0, true);
});
`;

test("W619 follow-up: a confined test gets a fresh writable TMPDIR/TMP/TEMP/HOME outside the tree, removed after the run", { skip: !permission && "needs Node >= 22 (--permission)" }, () => {
  // judged on the base, then run on the edit: "seen" must be absent both times (fresh per run); mkdtemp(tmpdir()) works
  const { res, log, leftovers } = runConfinedFixture("PeaceG03/PeaceSTOCKS", "never", { "src/m.tmp.test.ts": TMP_PROBE });
  assert.match(log, /related_tests=2 judged=2 confined=1 unconfinable=0 pool=2 judgeable=true/);
  assert.equal(res.applied, true, log);
  assert.equal(res.originalSuitePassed, true, log);
  assert.deepEqual(leftovers, [], "confined scratch dirs were left behind");
});
