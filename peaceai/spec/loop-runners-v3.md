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
   - `--require` a package name (optionally scoped, optionally a subpath; `mocha-require-pkg`) or a `./path` that is
     a regular file inside the package (lstat, so no symlink; `mocha-require-file`); no `..` segment anywhere
     (`mocha-require-dotdot`);
   - the script's positional words (its own spec files / globs) are dropped: the loop names the team's files itself.
   Anything else refuses the whole task (`m172-guard:mocha-options`), TEST_RUNNER_UNSUPPORTED, before any install.
3. Config files. mocha reads `.mocharc.*` and a `"mocha"` key in package.json on its own. PeaceAI does not interpret
   them, so a task with one (in the package or the repo root) is refused (`m172-guard:mocha-config`), and the shim
   runs mocha with `--no-config --no-package` so no config anywhere above the copy is read either.
4. Shim. `shimArgs` passes mocha's normalised options before a `--` and then the files; the shim requires that
   separator for mocha (`m172-guard:shim-mocha-sep`) and runs
   `mocha --no-config --no-package <options> --reporter json --reporter-option output=<TMPDIR report> <files>`
   (`m172-guard:shim-mocha-args`). The counts are the report's `stats.passes` / `stats.failures`; a report without a
   `stats` object is a failure (`m172-guard:shim-mocha-stats`). The json reporter's `output` option exists from mocha
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
without stats. End to end (candidate uid): a mocha stub task with a `--require` hook through `runLoopTask` is PASS
with the right baseline. `m172-mutation.test.ts` deletes each m172 guard line and needs a case to fail.

## Batch 11 follow-ups (Auditor, non-blocking)

- Order guard `m172-order:service-first`: the service check (`guard:service`) must stay above the unsupported-runner
  check (`guard:runner-other`), so a repo with a compose file is refused as TEST_NEEDS_SERVICE even when its runner is
  also unsupported. Now that mocha is admitted, the m172 case uses ava (compose + ava -> TEST_NEEDS_SERVICE, direct and
  one script down; ava alone -> TEST_RUNNER_UNSUPPORTED). m172-mutation swaps the two lines and requires a case to fail.
- Real old vitest: m172-real-vitest.test.ts installs vitest 1.6.0 from a pinned lockfile
  (peaceai/test/fixtures/m172-real-vitest1, `npm ci --ignore-scripts`), makes node_modules read-only, shows the real CLI
  exits 1 there although every test passes, and shows the shim scores pass 2 / fail 0 and pass 1 / fail 1. It needs the
  registry: with CI=true an install failure fails the test; otherwise it is skipped.
