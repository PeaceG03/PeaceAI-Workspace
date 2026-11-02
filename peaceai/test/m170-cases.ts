// M170 behavior cases (batch 10): the shim runs vitest < 2 through vitest's node API with its results cache off (the
// CLI's cache write into the read-only node_modules made every such run exit 1, so a correct fix was never credited),
// and a compose file wins over the runner (kysely: TEST_NEEDS_SERVICE, not TEST_RUNNER_UNSUPPORTED). As data so
// m170-mutation.test.ts can replay them against each mutant of loopdeps.ts / looprow.ts / loop.ts. Each case throws
// (node:assert) on failure; every m170 guard has a refused near-miss. Synthetic fixtures only (stub runners; no network,
// no task repo). Spec: peaceai/spec/loop-runners-v2.md.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type * as Deps from "../lib/loopdeps.ts";
import type * as Loop from "../lib/loop.ts";
import type * as Row from "../lib/looprow.ts";
import { ADD_FIXED, pkgJson, plain, STUB_VITEST_CLI, type Ctx } from "./m151-fixtures.ts";

export interface Libs { deps: typeof Deps; loop: typeof Loop; row: typeof Row }
export interface Case { id: string; needsCand?: string; run: (l: Libs, ctx: Ctx) => void }
const CAND_SKIP = "needs the stage-2 candidate uid and sudo (box / private job): a real install and run as that uid";

let n = 0;
const dir = (ctx: Ctx, name: string) => join(ctx.base, "m170", `${name}-${n++}`);

/** vitest < 2's CLI: runs and reports like the m151 stub, then its results-cache write into the read-only
 * node_modules fails, so it always exits 1. */
export const STUB_VITEST_LEGACY_CLI = STUB_VITEST_CLI.replace(/^process\.exit\(mode === "exitonly".*$/m, "process.exit(1); // the results-cache write (node_modules/.vitest) fails");
/** vitest's node API (startVitest), stubbed: records what it was given in $TMPDIR/m170-api.json; writes the report only
 * for run / no watch / a json reporter / an outputFile; exits 1 unless the results cache is off (like the CLI). */
export const STUB_VITEST_NODE = [
  'import { writeFileSync } from "node:fs";',
  'import { join, resolve } from "node:path";',
  'import { pathToFileURL } from "node:url";',
  "export async function startVitest(mode, files, opts, vite) {",
  '  writeFileSync(join(process.env.TMPDIR, "m170-api.json"), JSON.stringify({ mode, files, opts, vite }));',
  "  const tests = [];",
  "  globalThis.test = (name, fn) => tests.push(fn);",
  "  let pass = 0, fail = 0, suites = 0;",
  "  for (const f of files) {",
  "    try { await import(pathToFileURL(resolve(f)).href); } catch { suites++; tests.length = 0; continue; }",
  "    for (const fn of tests.splice(0)) { try { await fn(); pass++; } catch { fail++; } }",
  "  }",
  '  if (mode !== "test" || opts.run !== true || opts.watch !== false || !Array.isArray(opts.reporters) || !opts.reporters.includes("json") || typeof opts.outputFile !== "string") { process.exitCode = 1; return undefined; }',
  "  writeFileSync(opts.outputFile, JSON.stringify({ numPassedTests: pass, numFailedTests: fail, numFailedTestSuites: suites, success: !fail && !suites }));",
  "  process.exitCode = opts.cache !== false || fail || suites || process.env.M170_STUB_EXIT ? 1 : 0;",
  "  return { close: async () => {} };",
  "}",
  "",
].join("\n");

/** A stub vitest package dir: version, the `./node` export (undefined: none), whether node.mjs exists, which CLI. */
export function stubVitest(at: string, version: string, nodeExport: unknown, o: { nodeFile?: boolean; legacyCli?: boolean } = {}): string {
  mkdirSync(at, { recursive: true });
  const meta: Record<string, unknown> = { name: "vitest", version, type: "module", bin: { vitest: "cli.mjs" } };
  if (nodeExport !== undefined) meta.exports = { ".": "./index.mjs", "./node": nodeExport, "./package.json": "./package.json" };
  writeFileSync(join(at, "package.json"), JSON.stringify(meta));
  writeFileSync(join(at, "cli.mjs"), o.legacyCli === false ? STUB_VITEST_CLI : STUB_VITEST_LEGACY_CLI);
  if (o.nodeFile !== false) writeFileSync(join(at, "node.mjs"), STUB_VITEST_NODE);
  return at;
}

const OK = 'test("a", () => {});\n';
const ONE_FAIL = 'test("a", () => {});\ntest("b", () => { throw new Error("x"); });\n';
/** Runs the shim directly in a dir with the given stub vitest; returns the last two lines and the API record. */
function shim(l: Libs, ctx: Ctx, version: string, nodeExport: unknown, test: string, o: { nodeFile?: boolean; legacyCli?: boolean; exit1?: boolean } = {}) {
  const d = plain(dir(ctx, "shim"), { "package.json": pkgJson({ test: "vitest run" }, { vitest: version }), "test/a.test.mjs": test });
  stubVitest(join(d, "node_modules/vitest"), version, nodeExport, o);
  l.deps.installShim(d);
  const tmp = join(d, ".tmp");
  mkdirSync(tmp);
  const r = spawnSync(process.execPath, l.deps.shimArgs({ runner: "vitest", pkgDir: "", files: ["test/a.test.mjs"], hasDeps: true }), { cwd: d, encoding: "utf8", env: { PATH: process.env.PATH, TMPDIR: tmp, ...(o.exit1 ? { M170_STUB_EXIT: "1" } : {}) }, timeout: 60_000 });
  const rec = join(tmp, "m170-api.json");
  return { tail: (r.stdout ?? "").trimEnd().split("\n").slice(-2).join("\n"), api: existsSync(rec) ? JSON.parse(readFileSync(rec, "utf8")) : null, tmp, status: r.status };
}
const PASS1 = "# pass 1\n# fail 0";
const FAIL1 = "# pass 1\n# fail 1";

export const CASES: Case[] = [
  // ---- vitest < 2 through the node API (m170-guard:vitest-legacy-api)
  {
    id: "legacy vitest: a run where every test passes is credited (three export shapes: 1.x string, 1.x / 0.34 {import}, {import: {default}})",
    run(l, ctx) {
      for (const [v, e] of [["1.6.0", "./node.mjs"], ["0.34.6", { types: "./node.d.ts", import: "./node.mjs" }], ["1.1.3", { import: { types: "./node.d.ts", default: "./node.mjs" } }]] as [string, unknown][]) {
        const r = shim(l, ctx, v, e, OK);
        assert.equal(r.tail, PASS1, `vitest ${v}: ${JSON.stringify(e)}`);
        assert.ok(r.api, `vitest ${v} went through the node API`);
        assert.equal(r.api.mode, "test");
        assert.deepEqual(r.api.files, ["test/a.test.mjs"]);
        assert.deepEqual([r.api.opts.run, r.api.opts.watch, r.api.opts.cache, r.api.opts.reporters], [true, false, false, ["json"]]);
        assert.equal(r.api.opts.outputFile, join(r.tmp, "peaceai-loop-report.json"));
        assert.equal(r.api.vite.cacheDir, join(r.tmp, "vite-cache"), "vite's cache goes to TMPDIR, not node_modules");
      }
    },
  },
  {
    id: "legacy vitest near-misses: a failing test, a nonzero exit with a clean report, no report -> still counted as failing",
    run(l, ctx) {
      assert.equal(shim(l, ctx, "1.6.0", "./node.mjs", ONE_FAIL).tail, FAIL1, "a failing test still fails");
      assert.equal(shim(l, ctx, "1.6.0", "./node.mjs", OK, { exit1: true }).tail, FAIL1, "guard:shim-exit still applies to the API run");
      assert.equal(shim(l, ctx, "1.6.0", "./node.mjs", 'throw new Error("load");\n').tail, FAIL1.replace("pass 1", "pass 0"), "a suite that fails to load");
    },
  },
  {
    id: "legacy vitest near-misses: vitest >= 2, no ./node export, or a ./node export with no file -> the CLI as before (no API run)",
    run(l, ctx) {
      const v2 = shim(l, ctx, "2.0.0", "./node.mjs", OK, { legacyCli: false });
      assert.deepEqual([v2.tail, v2.api], [PASS1, null], "vitest 2 keeps the CLI");
      const v4 = shim(l, ctx, "4.1.0", "./node.mjs", OK, { legacyCli: true });
      assert.deepEqual([v4.tail, v4.api], [FAIL1, null], "vitest 4 uses the CLI (its exit code counts)");
      const none = shim(l, ctx, "1.6.0", undefined, OK);
      assert.deepEqual([none.tail, none.api], [FAIL1, null], "no ./node export: the CLI, whose cache write fails, so no credit (unchanged)");
      const missing = shim(l, ctx, "1.6.0", "./node.mjs", OK, { nodeFile: false });
      assert.deepEqual([missing.tail, missing.api], [FAIL1, null], "a ./node export with no file: the CLI");
      const odd = shim(l, ctx, "1.6.0", { require: "./node.mjs" }, OK);
      assert.deepEqual([odd.tail, odd.api], [FAIL1, null], "a require-only export: the CLI");
    },
  },
  // ---- the service check comes before the runner check (guard:service above guard:runner-other)
  {
    id: "service first: a compose file with a mocha suite is TEST_NEEDS_SERVICE (direct, and one script level down as in a monorepo)",
    run(l, ctx) {
      const d1 = plain(dir(ctx, "svc"), { "package.json": pkgJson({ test: "mocha test" }, { mocha: "10.0.0" }), "docker-compose.yml": "services: {}\n", "test/a.test.js": OK });
      assert.deepEqual(l.deps.detectRunner(d1, ["test/a.test.js"]), { refuse: "TEST_NEEDS_SERVICE" });
      const d2 = plain(dir(ctx, "svc"), { "package.json": pkgJson({ test: "pnpm run test:node", "test:node": "mocha test" }, { mocha: "10.0.0" }), "compose.yaml": "services: {}\n", "test/a.test.js": OK });
      assert.deepEqual(l.deps.detectRunner(d2, ["test/a.test.js"]), { refuse: "TEST_NEEDS_SERVICE" });
    },
  },
  {
    id: "service first near-misses: mocha with no compose file stays TEST_RUNNER_UNSUPPORTED; vitest with no compose file is admitted",
    run(l, ctx) {
      const d1 = plain(dir(ctx, "svc"), { "package.json": pkgJson({ test: "mocha test" }, { mocha: "10.0.0" }), "test/a.test.js": OK });
      assert.deepEqual(l.deps.detectRunner(d1, ["test/a.test.js"]), { refuse: "TEST_RUNNER_UNSUPPORTED" });
      const d2 = plain(dir(ctx, "svc"), { "package.json": pkgJson({ test: "vitest run" }, { vitest: "1.0.0" }), "test/a.test.js": OK });
      assert.equal((l.deps.detectRunner(d2, ["test/a.test.js"]) as Deps.RunnerPick).runner, "vitest");
    },
  },
  // ---- end to end: a vitest < 2 task through runLoopTask (real install as the candidate uid, stage-2 isolation)
  {
    id: "loop: a vitest < 2 task whose fix makes every test pass is PASS (before batch 10: every attempt TEST_FAIL)",
    needsCand: CAND_SKIP,
    run(l, ctx) {
      const stub = stubVitest(join(ctx.base, "m170", `stub-legacy-${n++}`), "1.0.0", { types: "./node.d.ts", import: "./node.mjs" });
      chmodSync(stub, 0o755);
      spawnSync("chmod", ["-R", "a+rX", stub]);
      const proposer: Loop.Proposer = { name: "fixed", next: () => ({ edits: [{ path: "src/calc.ts", content: ADD_FIXED }] }) };
      const r = l.loop.runLoopTask(ctx.vitest, "public", "a".repeat(64), {
        root: ctx.root, fetcher: ctx.fetcher, proposer, maxAttempts: 1, runMs: 60_000, env: ctx.env, rules: [], training: new Set<string>(),
        deps: { tool: ctx.tool, extraEnv: { M151_STUB_VITEST_DIR: stub } },
      });
      assert.equal(l.row.loopRowProblem(r.row), null, String(l.row.loopRowProblem(r.row)));
      assert.equal(r.row.code, "PASS", JSON.stringify(r.row));
      assert.deepEqual(r.row.tests, { total: 2, passedByPeaceAI: 2, filledByTeam: 0 });
      assert.deepEqual(r.row.baseline, { total: 2, passing: 1, failing: 1 });
    },
  },
];
