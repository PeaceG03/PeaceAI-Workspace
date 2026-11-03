# Loop runners, batch 11: mocha (stacked on batch 10)

Status: implemented in `peaceai/lib/loopdeps.ts` (`detectRunner`, `mochaOptions`, the json-runner shim, `shimArgs`)
and `peaceai/lib/looprow.ts` (`LOOP_RUNNERS` gains `mocha`). Tests: `peaceai/test/m172-batch11.test.ts` (cases in
`m172-cases.ts`), `peaceai/test/m172-mutation.test.ts`. Found on the public dev tasks
(`peaceai/plan/tasks-public-v1.json`) and synthetic fixtures only; no hidden-set row, task or result was read.

## Cause

superstruct-coerce-undefined (public dev task) was refused before any install with TEST_RUNNER_UNSUPPORTED: its test
script is `mocha --require ./test/register.cjs --require source-map-support/register test/index.ts` and mocha was in
`OTHER_RUNNERS`. The loop never ran it, so no proposer could be judged on it. mocha is a common runner in public
TypeScript libraries, so this is a general gap, not a task-specific one.

## Change

1. Detection. mocha leaves `OTHER_RUNNERS` and becomes a named runner like vitest and jest: the package's test script
   (or one level of package scripts it names, as before) must name `mocha`, and mocha must be a dependency
   (`guard:runner-dep`, unchanged). There is no dependency-only fallback for mocha (as before, only vitest / jest).
2. Options. mocha's own options live in the command line that runs it (typically `--require <hook>` for a TypeScript
   or Babel loader). `mochaOptions` reads them itself and passes on only an allowlist:
   - exactly one `mocha ...` (or `npx mocha ...`) command among the script and its one level of named scripts
     (`m172-guard:mocha-one-command`; a wrapper such as `nyc mocha` gives none and is refused);
   - value flags `--require/-r`, `--ui/-u`, `--timeout/-t`, `--extension` (also as `--flag=value`), boolean flags
     `--recursive`, `--exit`, `--full-trace`, `--check-leaks`; any other flag is refused (`m172-guard:mocha-flag`), as
     is a flag with no value;
   - `--ui` one of bdd / tdd / qunit / exports (`mocha-ui`); `--timeout` digits only (`mocha-timeout`); `--extension`
     1-8 letters / digits (`mocha-extension`);
   - `--require` a package name (optionally scoped, optionally a subpath; `mocha-require-pkg`) or a path that is a
     regular file inside the package; no absolute path and no `..` segment anywhere (`mocha-require-dotdot`). mocha
     loads a value as a file relative to its cwd whenever that value or value + `.js` exists, with or without `./`
     (lib/cli/run-helpers.js `handleRequires`), so every such value, `./x` or bare `test/x.cjs` (`mocha-require-bare`,
     batch 11 fix), must be a regular file (lstat, not a symlink) whose real path is its plain path (no symlinked
     directory on the way) (`mocha-require-file`);
   - the script's positional words (its own spec files / globs) are dropped: the loop names the team's files itself.
   Anything else refuses the whole task (`m172-guard:mocha-options`), TEST_RUNNER_UNSUPPORTED, before any install.
3. Config files. mocha reads `.mocharc.*` and a `"mocha"` key in package.json on its own. PeaceAI does not interpret
   them, so a task with one (in the package or the repo root) is refused (`m172-guard:mocha-config`), and the shim
   runs mocha with `--no-config --no-package` so no config anywhere above the copy is read either.
4. Shim. `shimArgs` passes mocha's normalised options before a `--` and then the files; the shim requires that
   separator for mocha (`m172-guard:shim-mocha-sep`) and runs
   `mocha --no-config --no-package <options> --reporter json --reporter-option output=<TMPDIR report> <files>`
   (`m172-guard:shim-mocha-args`). The counts are the report's `stats.passes` / `stats.failures`; a report without a
   `stats` object is a failure (`m172-guard:shim-mocha-stats`). Batch 11 fix (Auditor B2): a run is not credited
   (pass 0, at least one failure) when `stats.pending > 0` (`m172-guard:shim-mocha-pending`) or when `stats.tests` is
   not `passes + failures` (`m172-guard:shim-mocha-total`: a test that ended neither way, a pending test, or a hook
   failure), so a skipped team test fails its run (fail closed).
5. Pending guard (batch 11 fix, Auditor B2). Real mocha (10.8.2 `Runnable#run`) finishes a test cleanly when its
   function throws ANY `Pending` synchronously; only `this.skip()` first marks the test pending. So code under test
   that throws `new (require("mocha/lib/pending"))()` inside a failing test made mocha count it as passed, and the
   shim reported a pass. The shim now requires PeaceAI's guard (`node_modules/.peaceai-loop/mocha-guard.cjs`,
   `MOCHA_GUARD_SOURCE`, written beside the shim, read-only and tamper-hashed like it) before the repo's own hooks;
   it finds the running mocha's `lib/` through `PEACEAI_MOCHA_LIB` (set by the shim to the resolved mocha package)
   and wraps each runnable's function for the duration of its call: a `Pending` from a runnable that `this.skip()`
   did not mark pending becomes an Error, so that test (or hook) fails. A promise rejected with a Pending is already
   a failure in mocha (shown by the real-mocha case). Missing mocha internals make the guard throw, mocha exits with
   no report, and the run fails (fail closed). The guard runs in the same process as the code under test, like the
   runner itself; it closes the documented Pending path, not an adversary that rewrites mocha in-process (that is
   the same exposure vitest and jest already have and is covered by isolation and tamper hashes, not the count). The json reporter's `output` option exists from mocha
   9.2; an older mocha writes no report file, so the existing no-report rule (`guard:shim-report`) scores it as failing
   (fail closed). The suite / exit rules after it (`guard:shim-suites`, `guard:shim-exit`) are unchanged and apply.

## Soundness

No check is removed or weakened. mocha runs inside the same stage-2 isolation as the candidate uid, from the copy's
read-only, tamper-hashed node_modules, exactly like vitest and jest: the shim resolves mocha's own package.json and
`bin` there. The only repo-controlled inputs passed to it are the allowlisted options, and those are no more powerful
than the test files themselves (a `--require` hook is code from the repo or its locked dependencies, which the test
files can already import); paths are confined to regular files inside the package. Config files are refused rather
than read, and mocha is told not to read any. The pass / fail counts still come only from the report file in the
private TMPDIR, and a nonzero exit with a clean report still scores `fail 1`.

## Tests (m172-cases.ts)

Admitted on two script shapes: a direct `mocha --require ./test/setup.cjs --recursive test`, and a named script one
level down with `npx mocha -r <pkg> -u tdd --timeout=5000 --extension ts --exit <glob>` (plus a bare `mocha`). The
shim is admitted with a bdd suite plus a `--require` hook whose effect a test checks, and with a tdd suite over two
files; the exact argv mocha got is asserted. Near misses, one per guard: two mocha commands and `nyc mocha`; --grep /
--file / --config and a missing value; a ui that is a package name, a `2s` timeout, an extension that is a path; `..`
in a path and in a package subpath, a missing file, a symlinked hook, an absolute path; `.mocharc.json`,
`.mocharc.yml`, a package.json `mocha` key, no mocha dependency, ava; a failing test, no `--` separator, a report
without stats; (batch 11 fix) `--loader`, `--import`, `--node-option` / `-n`, `--reporter` / `-R`, `--reporter-option`
and `--package` (also as `--flag=value`); a bare `--require test/x.cjs` admitted as a regular file, and refused as a
symlink, as a symlink reached by the `.js` fallback, under a symlinked directory (bare and `./`), and as a directory;
a report with a pending test, with tests != passes + failures, and with two failures (counted as two). End to end (candidate uid): a mocha stub task with a `--require` hook through `runLoopTask` is PASS
with the right baseline. `m172-mutation.test.ts` deletes each m172 guard line and needs a case to fail.

## Batch 11 follow-ups (Auditor, non-blocking)

- Order guard `m172-order:service-first`: the service check (`guard:service`) must stay above the unsupported-runner
  check (`guard:runner-other`), so a repo with a compose file is refused as TEST_NEEDS_SERVICE even when its runner is
  also unsupported. Now that mocha is admitted, the m172 case uses ava (compose + ava -> TEST_NEEDS_SERVICE, direct and
  one script down; ava alone -> TEST_RUNNER_UNSUPPORTED). m172-mutation swaps the two lines and requires a case to fail.
- Real old vitest: m172-real-vitest.test.ts installs vitest 1.6.0 from a pinned lockfile
  (peaceai/test/fixtures/m172-real-vitest1, `npm ci --ignore-scripts`), makes node_modules read-only, shows the real CLI
  exits 1 there although every test passes, and shows the shim scores pass 2 / fail 0 and pass 1 / fail 1. It needs the
  npm registry at test time (it runs `npm ci` against registry.npmjs.org): with CI=true an install failure fails the
  test; otherwise (an offline box) it is skipped.
- Real mocha (batch 11 fix, Auditor B2): m172-real-mocha.test.ts installs mocha 10.8.2 from a pinned lockfile
  (peaceai/test/fixtures/m172-real-mocha10, same way, same registry need and CI rule). It shows the raw CLI counts a
  test ending in a thrown Pending as passed (stats 2 tests / 2 passes), and that through the shim that test fails
  (sync, async, and from a beforeEach hook), a `this.skip()` (sync and done-style) run is pass 0 / fail 1, a failing
  `before` hook with a passing test is pass 0 / fail 1, and two failures are fail 2. Its mutation checks, against the
  same real mocha, delete each `m172-pend-guard` line of the guard (`convert`, `wrap`), `shim-mocha-total`, both
  count guards together, and the guard's `--require`, and need a case to change. (Real mocha counts a pending test in
  `stats.tests`, so `shim-mocha-pending` alone is redundant there; it is killed on the stub's pending report.)
- Both lockfile fixtures are exempt from THIRD_PARTY_NOTICES (m75): they hold a package.json written here and npm's
  lockfile (names, versions, registry URLs, integrity hashes; no third-party code or license text); m75 holds them
  to exactly that shape.
