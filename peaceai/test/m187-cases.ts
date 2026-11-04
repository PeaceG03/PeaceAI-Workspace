// M187 (batch 22): the ava runner (spec: peaceai/spec/loop-runners-v4.md). ava has no pluggable reporter API and runs
// each test file in its own worker process, so PeaceAI gives ava a static config (--config, which also makes ava
// ignore the package.json "ava" key and stop searching for ava.config.*) carrying only vetted options, reads ava's TAP
// from stdout in the main process (where no code under test runs) and pins process.send in each worker so a worker
// cannot forge an IPC result. This file holds the DETECTION cases (what PeaceAI admits and refuses, and the vetted
// config it produces); they are replayed against mutants by m187-mutation.test.ts. The report-channel and forging
// behaviour on a real ava install live in m187-forge.test.ts. Synthetic fixtures only; no network; no task shape.
import assert from "node:assert/strict";
import { join } from "node:path";
import type * as Deps from "../lib/loopdeps.ts";
import type * as Loop from "../lib/loop.ts";
import type * as Row from "../lib/looprow.ts";
import type * as Prop from "../lib/editpropose.ts";
import { existsSync } from "node:fs";
import { pkgJson, plain, type Ctx } from "./m151-fixtures.ts";

export interface Libs { deps: typeof Deps; loop: typeof Loop; row: typeof Row; prop: typeof Prop }
export interface Case { id: string; needsCand?: string; run: (l: Libs, ctx: Ctx) => void }

let n = 0;
const dir = (ctx: Ctx, name: string) => join(ctx.base, "m187", `${name}-${n++}`);
const OK = "export default {};\n";
const REFUSED = { refuse: "TEST_RUNNER_UNSUPPORTED" };

/** detectRunner on a fixture whose package.json has the given scripts / "ava" key / deps, plus extra files. */
function detect(l: Libs, ctx: Ctx, pkg: Record<string, unknown>, extra: Record<string, string> = {}, files = ["test/a.test.mjs"]) {
  const base = { name: "fixture", private: true, type: "module", devDependencies: { ava: "6.4.1" }, ...pkg };
  const d = plain(dir(ctx, "det"), { "package.json": JSON.stringify(base, null, 1) + "\n", "test/a.test.mjs": OK, "test/setup.cjs": OK, ...extra });
  return l.deps.detectRunner(d, files);
}
/** The vetted config object detectRunner produced (options[0], parsed), asserting it admitted an ava pick. */
function config(r: ReturnType<typeof detect>): Record<string, unknown> {
  assert.ok(!("refuse" in r), `refused: ${JSON.stringify(r)}`);
  const pick = r as Deps.RunnerPick;
  assert.equal(pick.runner, "ava");
  assert.ok(pick.options && pick.options.length === 1, "one JSON option");
  return JSON.parse(pick.options![0]!);
}

export const CASES: Case[] = [
  // ---- admit (two or more unrelated shapes): a plain JS package, and a package.json "ava" config with several keys
  {
    id: "ava admit: a plain `ava` test script with ava in devDependencies (no config) is admitted, runner ava, empty vetted config",
    run(l, ctx) {
      const r = detect(l, ctx, { scripts: { test: "ava" } });
      assert.deepEqual(config(r), {}, "nothing to pass through");
      assert.equal((r as Deps.RunnerPick).pkgDir, "");
      assert.deepEqual((r as Deps.RunnerPick).files, ["test/a.test.mjs"]);
    },
  },
  {
    id: "ava admit: a package.json \"ava\" config (extensions, require, nodeArguments, timeout, serial) and an npx ava script pass through vetted; dropped keys gone",
    run(l, ctx) {
      const r = detect(l, ctx, {
        scripts: { test: "npx ava --serial" },
        ava: { files: ["test/**/*.mjs"], extensions: { ts: "module", mjs: true }, require: ["./test/setup.cjs"], nodeArguments: ["--import=tsx", "--no-warnings"], timeout: "30s", concurrency: 4, failWithoutAssertions: false, cache: true, workerThreads: true, verbose: true },
      });
      const c = config(r);
      // files / cache / workerThreads / verbose are read and DROPPED (the loop names the files; the shim forces the rest)
      assert.deepEqual(c, { extensions: { ts: "module", mjs: true }, require: ["./test/setup.cjs"], nodeArguments: ["--import=tsx", "--no-warnings"], timeout: "30s", concurrency: 4, failWithoutAssertions: false, serial: true });
      assert.ok(!("files" in c) && !("cache" in c) && !("workerThreads" in c) && !("verbose" in c), "read-and-dropped keys are gone");
    },
  },
  {
    id: "ava admit: a short extensions array, an in-package require file, and nodeArguments naming a loader / import package are allowed",
    run(l, ctx) {
      const r = detect(l, ctx, { scripts: { test: "ava" }, ava: { extensions: ["js", "mjs", "ts"], require: ["./test/setup.cjs"], nodeArguments: ["--loader=ts-node/esm", "--import=tsx"] } });
      assert.deepEqual(config(r), { extensions: ["js", "mjs", "ts"], require: ["./test/setup.cjs"], nodeArguments: ["--loader=ts-node/esm", "--import=tsx"] });
    },
  },
  // ---- the config-file refusal (ava.config.* anywhere from the package dir up to the root): m187-guard:ava-config-file
  {
    id: "ava near-miss (m187-guard:ava-config-file): an ava.config.js / .cjs / .mjs / .json, in the package or at the repo root, is refused",
    run(l, ctx) {
      for (const f of ["ava.config.js", "ava.config.cjs", "ava.config.mjs", "ava.config.json"]) {
        assert.deepEqual(detect(l, ctx, { scripts: { test: "ava" } }, { [f]: "export default {};\n" }), REFUSED, f);
      }
      // a config file one dir above the package (ava searches up to the repo root) is refused too
      const d = plain(dir(ctx, "nest"), {
        "package.json": JSON.stringify({ name: "root", private: true }),
        "ava.config.mjs": "export default {};\n",
        "pkg/package.json": pkgJson({ test: "ava" }, { ava: "6.4.1" }),
        "pkg/test/a.test.mjs": OK,
      });
      assert.deepEqual(l.deps.detectRunner(d, ["pkg/test/a.test.mjs"]), REFUSED, "a config file above the package");
    },
  },
  // ---- the "ava" key allowlist (m187-guard:ava-key, ava-bool, ava-timeout, ava-concurrency, ava-extensions, ava-require, ava-node-args, ava-options)
  {
    id: "ava near-miss (m187-guard:ava-key): an unknown \"ava\" key (environmentVariables, typescript, snapshotDir) is refused; a non-object ava value is refused",
    run(l, ctx) {
      for (const bad of [{ environmentVariables: { X: "1" } }, { typescript: { rewritePaths: {} } }, { snapshotDir: "snap" }, { watchMode: {} }]) {
        assert.deepEqual(detect(l, ctx, { scripts: { test: "ava" }, ava: bad }), REFUSED, JSON.stringify(bad));
      }
      assert.deepEqual(detect(l, ctx, { scripts: { test: "ava" }, ava: "./ava.cfg" }), REFUSED, "a string ava value");
      assert.deepEqual(detect(l, ctx, { scripts: { test: "ava" }, ava: [1] }), REFUSED, "an array ava value");
    },
  },
  {
    id: "ava near-miss (m187-guard:ava-bool): a non-boolean serial / failFast / failWithoutAssertions is refused",
    run(l, ctx) {
      assert.deepEqual(detect(l, ctx, { scripts: { test: "ava" }, ava: { serial: "yes" } }), REFUSED, "serial: string");
      assert.deepEqual(detect(l, ctx, { scripts: { test: "ava" }, ava: { failFast: 1 } }), REFUSED, "failFast: number");
      assert.deepEqual(config(detect(l, ctx, { scripts: { test: "ava" }, ava: { serial: true, failFast: false } })), { serial: true, failFast: false });
    },
  },
  {
    id: "ava near-miss (m187-guard:ava-timeout): only an integer ms or an `N(ms|s|m)` string timeout; 0, negative, huge or odd units are refused",
    run(l, ctx) {
      for (const t of [0, -5, 10_000_000, "30x", "soon", "1.5s", {}]) assert.deepEqual(detect(l, ctx, { scripts: { test: "ava" }, ava: { timeout: t } }), REFUSED, JSON.stringify(t));
      assert.deepEqual(config(detect(l, ctx, { scripts: { test: "ava" }, ava: { timeout: "10s" } })), { timeout: "10s" });
      assert.deepEqual(config(detect(l, ctx, { scripts: { test: "ava" }, ava: { timeout: 5000 } })), { timeout: 5000 });
    },
  },
  {
    id: "ava near-miss (m187-guard:ava-concurrency): only an integer 1..64; 0, >64 or a non-number is refused",
    run(l, ctx) {
      for (const c of [0, 65, -1, 1.5, "lots"]) assert.deepEqual(detect(l, ctx, { scripts: { test: "ava" }, ava: { concurrency: c } }), REFUSED, JSON.stringify(c));
      assert.deepEqual(config(detect(l, ctx, { scripts: { test: "ava" }, ava: { concurrency: 8 } })), { concurrency: 8 });
    },
  },
  {
    id: "ava near-miss: a long or non-word extension is refused; an unknown module type in the object form is refused",
    run(l, ctx) {
      assert.deepEqual(detect(l, ctx, { scripts: { test: "ava" }, ava: { extensions: ["js", "this-is-way-too-long"] } }), REFUSED, "long ext");
      assert.deepEqual(detect(l, ctx, { scripts: { test: "ava" }, ava: { extensions: ["js/../x"] } }), REFUSED, "non-word ext");
      assert.deepEqual(detect(l, ctx, { scripts: { test: "ava" }, ava: { extensions: { ts: "typescript" } } }), REFUSED, "unknown module type");
      assert.deepEqual(config(detect(l, ctx, { scripts: { test: "ava" }, ava: { extensions: { ts: "commonjs" } } })), { extensions: { ts: "commonjs" } });
    },
  },
  {
    id: "ava near-miss (m187-guard:ava-require): a require naming a file outside the package (absolute, ..) or a missing / non-file path is refused; an in-package file is allowed",
    run(l, ctx) {
      assert.deepEqual(detect(l, ctx, { scripts: { test: "ava" }, ava: { require: ["/etc/passwd"] } }), REFUSED, "absolute");
      assert.deepEqual(detect(l, ctx, { scripts: { test: "ava" }, ava: { require: ["../evil.cjs"] } }), REFUSED, "dotdot");
      assert.deepEqual(detect(l, ctx, { scripts: { test: "ava" }, ava: { require: ["./nope.cjs"] } }), REFUSED, "missing file is not a package name (leading ./)");
      assert.deepEqual(config(detect(l, ctx, { scripts: { test: "ava" }, ava: { require: ["./test/setup.cjs"] } })), { require: ["./test/setup.cjs"] });
    },
  },
  {
    id: "ava near-miss (m187-guard:ava-node-args): a nodeArguments entry that is not a safe flag or a validated loader / require is refused",
    run(l, ctx) {
      for (const a of [["--allow-fs-write=/"], ["--eval=process.exit(0)"], ["--require=../evil.cjs"], ["--import=/abs/x.mjs"], ["--loader=./missing.mjs"]]) {
        assert.deepEqual(detect(l, ctx, { scripts: { test: "ava" }, ava: { nodeArguments: a } }), REFUSED, JSON.stringify(a));
      }
      assert.deepEqual(config(detect(l, ctx, { scripts: { test: "ava" }, ava: { nodeArguments: ["--require=./test/setup.cjs", "--enable-source-maps"] } })), { nodeArguments: ["--require=./test/setup.cjs", "--enable-source-maps"] });
    },
  },
  // ---- the script allowlist (m187-guard:ava-one-command, ava-flag, ava-flag-value)
  {
    id: "ava near-miss (m187-guard:ava-one-command): zero ava commands, or two, in the test script is refused",
    run(l, ctx) {
      assert.deepEqual(detect(l, ctx, { scripts: { test: "jest" } }, {}, ["test/a.test.mjs"]), REFUSED, "no ava command (and no ava in deps path)");
      assert.deepEqual(detect(l, ctx, { scripts: { test: "ava && ava --serial" } }), REFUSED, "two ava commands");
      // one ava command behind an npm-run indirection is allowed
      assert.deepEqual(config(detect(l, ctx, { scripts: { test: "npm run t", t: "ava" } })), {});
    },
  },
  {
    id: "ava near-miss (m187-guard:ava-flag / ava-flag-value): an unknown ava flag, or a bad --timeout / --concurrency value, is refused; file globs in the script are dropped",
    run(l, ctx) {
      assert.deepEqual(detect(l, ctx, { scripts: { test: "ava --watch" } }), REFUSED, "--watch");
      assert.deepEqual(detect(l, ctx, { scripts: { test: "ava --jobs=4" } }), REFUSED, "an unknown flag carrying a numeric value is refused, not swallowed");
      assert.deepEqual(detect(l, ctx, { scripts: { test: "ava --concurrency=lots" } }), REFUSED, "bad --concurrency");
      assert.deepEqual(detect(l, ctx, { scripts: { test: "ava --timeout=99x" } }), REFUSED, "bad --timeout");
      // a glob argument (not a flag) is dropped; allowlisted flags pass through
      assert.deepEqual(config(detect(l, ctx, { scripts: { test: "ava 'test/**/*.mjs' --serial --timeout 20s" } })), { serial: true, timeout: "20s" });
    },
  },
  {
    id: "ava: a script flag and the \"ava\" key combine; the script wins on a shared key",
    run(l, ctx) {
      assert.deepEqual(config(detect(l, ctx, { scripts: { test: "ava --timeout=15s" }, ava: { timeout: "99s", serial: true } })), { timeout: "15s", serial: true });
    },
  },
  // ---- ava needs to be a dependency (guard:runner-dep) and the shim arg shape
  {
    id: "ava near-miss (guard:runner-dep): an ava script with no ava dependency is refused",
    run(l, ctx) {
      assert.deepEqual(detect(l, ctx, { scripts: { test: "ava" }, devDependencies: { mocha: "10" } }), REFUSED, "no ava dep");
    },
  },
  {
    id: "ava: shimArgs puts the vetted config JSON before `--`, then the files (shape only, no runner)",
    run(l, ctx) {
      const r = detect(l, ctx, { scripts: { test: "ava --serial" } });
      assert.ok(!("refuse" in r));
      const args = l.deps.shimArgs(r as Deps.RunnerPick);
      assert.equal(args[0], l.deps.SHIM_PATH);
      assert.equal(args[1], "ava");
      const sep = args.indexOf("--");
      assert.ok(sep >= 3, "a -- separator after the options");
      assert.deepEqual(JSON.parse(args[sep - 1]!), { serial: true }, "the vetted config just before --");
      assert.deepEqual(args.slice(sep + 1), ["test/a.test.mjs"], "the files after --");
    },
  },
  // ---- the installed shim carries ava's three files, and ava is a valid loop runner
  {
    id: "ava: installShim writes ava-config.mjs, ava-reporter.cjs and ava-guard.cjs; LOOP_RUNNERS includes ava",
    run(l, ctx) {
      const d = plain(dir(ctx, "inst"), { "package.json": pkgJson({ test: "ava" }, { ava: "6.4.1" }) });
      l.deps.installShim(d);
      for (const p of [l.deps.AVA_CONFIG_PATH, l.deps.AVA_REPORTER_PATH, l.deps.AVA_GUARD_PATH]) {
        assert.ok(existsSync(join(d, p)), p);
      }
      assert.ok((l.row.LOOP_RUNNERS as readonly string[]).includes("ava"), "ava is a valid loop runner");
    },
  },
];

