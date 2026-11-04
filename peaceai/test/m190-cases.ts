// M190 (batch 24) behavior cases, as data so m190-mutation.test.ts can replay them against each mutant of loopdeps.ts /
// loop.ts: failing test names for vitest and jest runs (spec: peaceai/spec/json-failing-names-m190.md).
//   1. PeaceAI's vitest / jest reporters put each failed test's name in the nonce-checked report; the shim writes them
//      (`# failed-names <hex json>`, or `-` when unknown) as the line right before its counts, only when the counts are
//      the runner's own and there is exactly one name per failed test (capped, printable);
//   2. the loop reads that line only when it is the one right before the last `# pass` line, and uses the names only
//      when there is one per failed test of a clean run with real counts (else []: no names, as before);
//   3. end to end (candidate uid): NO names leave the stage-2 isolation (batch 24 fix: selfpropose.ts stays unchanged,
//      M146, and its guardedRun returns counts only), so the proposer gets baseFailing [] and every attempt's failing
//      is [] for vitest, exactly the pre-M190 behavior; the shim's names line and the reader above stay tested.
// Every fixture is synthetic (a parser, a money rounder, a fee table, a word wrapper); none is modelled on a practice
// task or a reference diff, and none is a PeaceSTOCKS shape.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type * as Deps from "../lib/loopdeps.ts";
import type * as Loop from "../lib/loop.ts";
import type * as Prop from "../lib/editpropose.ts";
import { MIT, pkgJson, type Ctx as Ctx151 } from "./m151-fixtures.ts";

export interface Libs { deps: typeof Deps; loop: typeof Loop; prop: typeof Prop }
export interface Ctx { m151: Ctx151; scratch: string }
export interface Case { id: string; needsCand?: boolean; run(l: Libs, ctx: Ctx): void }

const put = (dir: string, files: Record<string, string>) => { for (const [p, c] of Object.entries(files)) { mkdirSync(dirname(join(dir, p)), { recursive: true }); writeFileSync(join(dir, p), c); } };
let seq = 0;

// ---- the shim, run directly (plain node): a fake jest / vitest that hands an aggregated result from env to the
// reporter it is given, the way each runner does
const FAKE_JEST = [
  'const rp = process.argv.find((a) => a.startsWith("--reporters="))?.slice("--reporters=".length);',
  'if (rp && process.env.M190_REPORT) { const R = require(rp); new R({}, {}).onRunComplete(new Set(), JSON.parse(process.env.M190_REPORT)); }',
  'process.exit(Number(process.env.M190_EXIT || "0"));',
  "",
].join("\n");
const FAKE_VITEST = [
  'import { pathToFileURL } from "node:url";',
  'const rp = process.argv.find((a) => a.startsWith("--reporter="))?.slice("--reporter=".length);',
  'if (rp && process.env.M190_REPORT) { const R = (await import(pathToFileURL(rp).href)).default; await new R().onFinished(JSON.parse(process.env.M190_REPORT), []); }',
  'process.exit(Number(process.env.M190_EXIT || "0"));',
  "",
].join("\n");
interface ShimOut { stdout: string; tail: string; status: number | null }
function shimRun(l: Libs, ctx: Ctx, runner: "jest" | "vitest", report: unknown, exit: number, noise = ""): ShimOut {
  const d = join(ctx.scratch, `shim-${seq++}`);
  put(d, { "package.json": JSON.stringify({ name: "fixture", private: true }), "t/a.test.js": "// run by the fake runner\n" });
  if (runner === "jest") put(d, { "node_modules/jest/package.json": JSON.stringify({ name: "jest", version: "29.7.0", bin: { jest: "bin/jest.js" } }), "node_modules/jest/bin/jest.js": noise + FAKE_JEST });
  else put(d, { "node_modules/vitest/package.json": JSON.stringify({ name: "vitest", version: "4.1.10", type: "module", bin: { vitest: "cli.mjs" } }), "node_modules/vitest/cli.mjs": noise + FAKE_VITEST });
  l.deps.installShim(d);
  const tmp = join(d, ".tmp");
  mkdirSync(tmp);
  const env: Record<string, string> = { PATH: process.env.PATH ?? "/usr/bin:/bin", TMPDIR: tmp, M190_EXIT: String(exit), M190_REPORT: JSON.stringify(report) };
  const r = spawnSync(process.execPath, l.deps.shimArgs({ runner, pkgDir: "", files: ["t/a.test.js"], hasDeps: true } as Deps.RunnerPick), { cwd: d, encoding: "utf8", env, timeout: 60_000 });
  const stdout = r.stdout ?? "";
  return { stdout, tail: stdout.trimEnd().split("\n").slice(-2).join("\n"), status: r.status };
}
// jest's aggregated results: files of tests with a status, describe titles and a title
const jt = (title: string, status: string, ancestorTitles: string[] = []) => ({ title, status, ancestorTitles, fullName: [...ancestorTitles, title].join(" ") });
const jrep = (files: ReturnType<typeof jt>[][], extra: object = {}) => {
  const all = files.flat();
  const p = all.filter((t) => t.status === "passed").length, f = all.filter((t) => t.status === "failed").length;
  return { numPassedTests: p, numFailedTests: f, numFailedTestSuites: files.filter((x) => x.some((t) => t.status === "failed")).length, numRuntimeErrorTestSuites: 0, numTotalTests: all.length, success: f === 0, testResults: files.map((x) => ({ testResults: x })), ...extra };
};
// vitest's file tasks (suites with a filepath) holding suites and tests
const vt = (name: string, state: string) => ({ type: "test", name, mode: "run", result: { state } });
const vs = (name: string, tasks: object[], file = false) => ({ type: "suite", name, ...(file ? { filepath: `/x/${name}` } : {}), result: { state: JSON.stringify(tasks).includes('"fail"') ? "fail" : "pass" }, tasks });
const hex = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("hex");
const raw = (over: Partial<{ fail: number; leftovers: number; tampered: string[] }> = {}) => ({ fail: 1, leftovers: 0, tampered: [] as string[], ...over });

// ---- end to end (candidate uid): small vitest-stub repos (the M151 stub runner, which hands the reporter real tasks)
const VITEST_LOCK = JSON.stringify({ name: "fixture", lockfileVersion: 3, requires: true, packages: { "": { name: "fixture", devDependencies: { vitest: "1.0.0" } } } }, null, 1) + "\n";
const G = ["-c", "user.name=PeaceG03", "-c", "user.email=301894882+PeaceG03@users.noreply.github.com", "-c", "commit.gpgsign=false"];
function e2eTask(ctx: Ctx, name: string, srcPath: string, src: string, teamTest: string) {
  const dir = join(ctx.m151.base, "repos", name);
  const git = (...a: string[]) => execFileSync("git", [...G, ...a], { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  mkdirSync(dir, { recursive: true });
  git("init", "-q", "-b", "main");
  put(dir, { "package.json": pkgJson({ test: "vitest run" }, { vitest: "1.0.0" }), "package-lock.json": VITEST_LOCK, LICENSE: MIT, [srcPath]: src });
  git("add", "-A"); git("commit", "-q", "-m", "base");
  execFileSync("chmod", ["-R", "a+rX", dir]);
  const commit = git("rev-parse", "HEAD");
  const test = "test/unit.test.ts";
  put(dir, { [srcPath]: src + "// reference\n", [test]: teamTest }); git("add", "-A"); git("commit", "-q", "-m", "reference");
  const merge = git("rev-parse", "HEAD");
  return { ...ctx.m151.vitest, id: `m190-${name}`.slice(0, 40), repo: `m151-fixture/${name}`, commit,
    request: `Fix the function in ${srcPath} so that the team tests pass.`,
    tests: { command: "vitest run", files: [test] },
    reference: { from: { pr: 1, merge }, files: [{ path: srcPath, change: "modify" as const }, { path: test, change: "add" as const }],
      steps: [{ action: "edit-source" as const, file: srcPath }, { action: "add-test" as const, file: test }, { action: "run-tests" as const, file: null }], docs: [] } };
}
const opts = (ctx: Ctx, proposer: Loop.Proposer, maxAttempts = 1) => ({
  root: ctx.m151.root, fetcher: ctx.m151.fetcher, proposer, maxAttempts, runMs: 60_000, env: ctx.m151.env, rules: [], training: new Set<string>(),
  deps: { tool: ctx.m151.tool, extraEnv: { M151_STUB_VITEST_DIR: ctx.m151.stubVitest } },
});
/** A proposer that records what the loop gives it and proposes the given edits in turn. */
function recording(edits: Prop.RepairEdit[][]) {
  const seen: { prepare: { failing: readonly string[]; baseFailing?: readonly string[] } | null; feedback: Loop.Feedback[] } = { prepare: null, feedback: [] };
  const p: Loop.Proposer = {
    name: "record",
    prepare: (_s, input) => { seen.prepare = { failing: [...input.failing], baseFailing: input.baseFailing ? [...input.baseFailing] : undefined }; },
    next: (input) => { seen.feedback = [...input.feedback]; const e = edits.shift(); return e ? { edits: e } : { refuse: "NO_MORE_EDITS" as const }; },
  };
  return { p, seen };
}

export const CASES: readonly Case[] = [
  // ---- 1. the shim
  {
    id: "shim, jest: the failed tests' names (describe titles > title) are the line right before the counts (m190-guard:jest-names)",
    run(l, ctx) {
      // a tokenizer suite in two files: one failure under a describe, one at the top level
      const r = shimRun(l, ctx, "jest", jrep([[jt("splits on commas", "passed", ["tokenize"]), jt("keeps quoted commas", "failed", ["tokenize", "quotes"])], [jt("rejects tabs", "failed"), jt("trims", "passed")]]), 1);
      assert.equal(r.tail, "# pass 2\n# fail 2");
      assert.equal(r.status, 1);
      assert.deepEqual(l.loop.shimFailedNames(r.stdout), ["tokenize > quotes > keeps quoted commas", "rejects tabs"]);
      // a passing run: an empty list (known: nothing failed)
      const ok = shimRun(l, ctx, "jest", jrep([[jt("trims", "passed")]]), 0);
      assert.deepEqual([ok.tail, l.loop.shimFailedNames(ok.stdout)], ["# pass 1\n# fail 0", []]);
    },
  },
  {
    id: "shim, vitest: names below the file (suite > test); the file task's own name is left out (m190-guard:vitest-names)",
    run(l, ctx) {
      // a money rounder: a file with a nested suite and a top-level test
      const tree = [vs("money.test.ts", [vs("round", [vt("half up", "fail"), vt("half even", "pass")]), vt("formats cents", "fail")], true), vs("parse.test.ts", [vt("reads dollars", "pass")], true)];
      const r = shimRun(l, ctx, "vitest", tree, 1);
      assert.equal(r.tail, "# pass 2\n# fail 2");
      assert.deepEqual(l.loop.shimFailedNames(r.stdout), ["round > half up", "formats cents"]);
    },
  },
  {
    id: "shim: a report's own failedNames field is never passed through (the reporter builds the names itself)",
    run(l, ctx) {
      const r = shimRun(l, ctx, "jest", jrep([[jt("wraps at width", "failed")]], { failedNames: ["forged"] }), 1);
      assert.deepEqual(l.loop.shimFailedNames(r.stdout), ["wraps at width"]);
    },
  },
  {
    id: "shim near miss: a failure count the names do not match is unknown (m190-guard:shim-count)",
    run(l, ctx) {
      // the runner says 2 failed tests but only one failed test is in its results
      const r = shimRun(l, ctx, "jest", jrep([[jt("wraps at width", "failed"), jt("keeps words", "passed")]], { numFailedTests: 2 }), 1);
      assert.equal(r.tail, "# pass 1\n# fail 2");
      assert.equal(l.loop.shimFailedNames(r.stdout), null);
      assert.match(r.stdout, /\n# failed-names -\n# pass 1\n/);
    },
  },
  {
    id: "shim near miss: made-up counts (a suite that did not load) carry no names (m190-guard:shim-real)",
    run(l, ctx) {
      const r = shimRun(l, ctx, "jest", jrep([[jt("wraps at width", "failed")]], { numRuntimeErrorTestSuites: 1 }), 1);
      assert.equal(r.status, l.deps.SHIM_EXITS.SUITE_LOAD);
      assert.equal(l.loop.shimFailedNames(r.stdout), null);
      // vitest: failed suites with no failed test (made-up failure count)
      const v = shimRun(l, ctx, "vitest", [vs("a.test.ts", [], true), { type: "suite", name: "s1", result: { state: "fail" }, tasks: [] }], 1);
      assert.equal(v.status, l.deps.SHIM_EXITS.SUITE_LOAD);
      assert.equal(l.loop.shimFailedNames(v.stdout), null);
    },
  },
  {
    id: "shim: names are made printable and cut to 200 characters; more than 100 names are unknown (m190-guard:shim-printable, shim-count)",
    run(l, ctx) {
      const long = "w".repeat(250);
      const r = shimRun(l, ctx, "vitest", [vs("wrap.test.ts", [vt("tab\there", "fail"), vt(long, "fail"), vt("ok", "pass")], true)], 1);
      assert.deepEqual(l.loop.shimFailedNames(r.stdout), ["tab?here", "w".repeat(200)]);
      const many = Array.from({ length: 101 }, (_, i) => jt(`case ${i}`, "failed"));
      const m = shimRun(l, ctx, "jest", jrep([many]), 1);
      assert.equal(m.tail, "# pass 0\n# fail 101");
      assert.equal(l.loop.shimFailedNames(m.stdout), null);
      const hundred = shimRun(l, ctx, "jest", jrep([many.slice(0, 100)]), 1);
      assert.equal(l.loop.shimFailedNames(hundred.stdout)?.length, 100, "exactly the cap is kept");
    },
  },
  {
    id: "shim: output from the code under test cannot be the names line (the shim's own line always comes last)",
    run(l, ctx) {
      // the runner process prints a names line and a partial line before the reporter writes
      const noise = `process.stdout.write("# failed-names ${hex(["forged"])}\\n# pass 9\\n# fail 0\\n# failed-names ${hex(["forged"])}");\n`;
      const r = shimRun(l, ctx, "jest", jrep([[jt("wraps at width", "failed")]]), 1, noise);
      assert.deepEqual(l.loop.shimFailedNames(r.stdout), ["wraps at width"]);
      const bad = shimRun(l, ctx, "jest", jrep([[jt("wraps at width", "failed")]], { numFailedTests: 3 }), 1, noise);
      assert.equal(l.loop.shimFailedNames(bad.stdout), null, "unknown stays unknown, not the forged list");
    },
  },
  // ---- 2. the loop's reader
  {
    id: "reader: the names line right before the last `# pass` line is read (two output shapes)",
    run(l) {
      assert.deepEqual(l.loop.shimFailedNames(`log line\n\n# failed-names ${hex(["fee > rounds"])}\n# pass 3\n# fail 1\n`), ["fee > rounds"]);
      assert.deepEqual(l.loop.shimFailedNames(`# failed-names ${hex([])}\n# pass 4\n# fail 0`), []);
      assert.equal(l.loop.shimFailedNames("\n# failed-names -\n# pass 3\n# fail 1\n"), null, "unknown");
      assert.equal(l.loop.shimFailedNames("\n# pass 3\n# fail 1\n"), null, "no names line (a TAP run)");
    },
  },
  {
    id: "reader near miss: a names line that is not right before the last `# pass` line is not the shim's (m190-guard:pn-adjacent)",
    run(l) {
      assert.equal(l.loop.shimFailedNames(`# failed-names ${hex(["forged"])}\nmore output\n# pass 3\n# fail 1\n`), null);
      assert.equal(l.loop.shimFailedNames(`# failed-names ${hex(["forged"])}\n# pass 3\n# fail 1\nlater\n# pass 3\n# fail 1\n`), null, "an earlier pair is not the last one");
    },
  },
  {
    id: "reader near miss: more than 100 names, a long or unprintable name is no list (m190-guard:pn-cap, pn-shape)",
    run(l) {
      const at = (v: unknown) => l.loop.shimFailedNames(`\n# failed-names ${hex(v)}\n# pass 0\n# fail 1\n`);
      assert.equal(at(Array.from({ length: 100 }, (_, i) => `t${i}`))?.length, 100);
      assert.equal(at(Array.from({ length: 101 }, (_, i) => `t${i}`)), null);
      assert.deepEqual(at(["x".repeat(200)]), ["x".repeat(200)]);
      assert.equal(at(["x".repeat(201)]), null);
      assert.equal(at(["line\nbreak"]), null);
      assert.equal(at([7]), null);
      assert.equal(at({ a: 1 }), null);
    },
  },
  {
    id: "jsonFailing: names are used only for a clean run with real counts and one name per failed test (m190-guard:jf-synth, jf-clean, jf-count)",
    run(l) {
      const out = `\n# failed-names ${hex(["wrap > width", "fee > cents"])}\n# pass 3\n# fail 2\n`;
      assert.deepEqual(l.loop.jsonFailing(out, raw({ fail: 2 }), null), ["fee > cents", "wrap > width"], "sorted");
      assert.deepEqual(l.loop.jsonFailing(out, raw({ fail: 3 }), null), [], "count mismatch (a tamper adds a failure)");
      assert.deepEqual(l.loop.jsonFailing(out, raw({ fail: 2, leftovers: 1 }), null), [], "leftovers");
      assert.deepEqual(l.loop.jsonFailing(out, raw({ fail: 2, tampered: ["node_modules"] }), null), [], "tampered");
      assert.deepEqual(l.loop.jsonFailing(out, raw({ fail: 2 }), "SUITE_LOAD"), [], "made-up counts");
      assert.deepEqual(l.loop.jsonFailing(out, raw({ fail: 2 }), "EXIT_ONLY"), []);
    },
  },
  // ---- 3. end to end (candidate uid)
  {
    id: "loop, vitest: no names leave the isolation (selfpropose.ts unchanged): baseFailing [] and a swap is not seen in names",
    needsCand: true,
    run(l, ctx) {
      // a fee table: fee(1) should be 3 (fails), fee(2) is 4 (passes); the edit fixes the first and breaks the second
      const src = "export function fee(n) {\n  return n * 2;\n}\n";
      const t = e2eTask(ctx, `m190-fee-${seq++}`, "src/fee.ts", src, 'import assert from "node:assert/strict";\nimport { fee } from "../src/fee.ts";\n\ntest("fee for one", () => assert.equal(fee(1), 3));\ntest("fee for two", () => assert.equal(fee(2), 4));\n');
      const swap = [{ path: "src/fee.ts", content: "export function fee(n) {\n  return n * 3;\n}\n" }];
      const { p, seen } = recording([swap, swap.map((e) => ({ ...e, content: e.content.replace("n * 3", "n * 3 + 0") }))]);
      const r = l.loop.runLoopTask(t as never, "public", "a".repeat(64), opts(ctx, p, 2) as never);
      assert.equal(r.row.code, "ATTEMPT_LIMIT");
      assert.deepEqual(r.row.baseline, { total: 2, passing: 1, failing: 1 });
      assert.deepEqual(seen.prepare, { failing: [], baseFailing: [] });
      assert.deepEqual(seen.feedback.map((f) => [f.failing, f.tests.passedByPeaceAI]), [[[], 1]]);
      // the same counts as the baseline and no names on either side: M178 reads INERT, as before M190
      assert.equal(l.prop.siteEvidence(seen.feedback[0] as never, r.row.baseline as never, seen.prepare!.baseFailing!), "inert");
      assert.deepEqual(r.attempts.map((a) => a.failing), [[], []]);
      // the public row carries no names (the fixed keys only)
      assert.ok(!JSON.stringify(r.row).includes("fee for"));
    },
  },
  {
    id: "loop, vitest: a second shape (a word wrapper, two failing): no names, whatever the failure count",
    needsCand: true,
    run(l, ctx) {
      const src = "export function wrap(s, w) {\n  return s.length > w ? s.slice(0, w) : s;\n}\n";
      const t = e2eTask(ctx, `m190-wrap-${seq++}`, "src/wrap.ts", src, 'import assert from "node:assert/strict";\nimport { wrap } from "../src/wrap.ts";\n\ntest("short stays", () => assert.equal(wrap("ab", 5), "ab"));\ntest("long is cut with a mark", () => assert.equal(wrap("abcdef", 3), "ab~"));\ntest("exact width stays", () => assert.equal(wrap("abc", 3), "abc~"));\n');
      const { p, seen } = recording([[{ path: "src/wrap.ts", content: "export function wrap(s, w) {\n  return s;\n}\n" }]]);
      const r = l.loop.runLoopTask(t as never, "public", "a".repeat(64), opts(ctx, p, 1) as never);
      assert.deepEqual(r.row.baseline, { total: 3, passing: 1, failing: 2 });
      assert.deepEqual(seen.prepare, { failing: [], baseFailing: [] });
      assert.deepEqual(r.attempts.map((a) => a.failing), [[]]);
    },
  },
];
