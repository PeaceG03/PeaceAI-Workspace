# Loop deps access, install-failure subcodes, inert pnpm keys, LOOP_CRASHED (M169)

Status: draft (batch PR). Code: `peaceai/lib/loopdeps.ts`, `peaceai/lib/looprow.ts`, `peaceai/lib/loop.ts`,
`peaceai/bin/loop.ts`, `.github/workflows/peace-model-v1-dev.yml` (attempt job). Tests:
`peaceai/test/m169-deps-access.test.ts`, `m169-cases.ts`, `m169-mutation.test.ts`, `m169-mutant-runner.ts`.

## Why

CI run 41488888877 (main 7abc445, after #666) wrote 36 loop rows and no task reached its tests. Per proposer
(rules-v1, repair-v1, model-v1 alike): 6 DEPS_INSTALL_FAILED, 2 DEPS_PM_CONFIG, 4 TEST_RUNNER_UNSUPPORTED; `deps`
null on every row. The rows could not say why an install failed.

Box reproduction: a `--deps-dir` under a directory the candidate uid cannot enter (mode 0750 / 0700, as a runner home
dir is) gives exactly DEPS_INSTALL_FAILED with deps null; the same task with a traversable deps dir reaches its tests.
The attempt job put the cache under `$RUNNER_TEMP`, which sits inside the runner's home.

## What changes

1. Workflow pre-flight (attempt job, fail closed). After the candidate user is created and before any loop run, a
   step makes a fresh `mktemp -d /tmp/peaceai-deps.XXXXXX` (mode 755), checks the candidate uid can traverse it
   (`refused DEPS_DIR_CAND_NO_TRAVERSE`, job fails) and can write a dir it owns there (`refused
   DEPS_DIR_CAND_NO_WRITE`, job fails), then exports it as `PEACEAI_DEPS_DIR`. The three loop lines pass
   `--deps-dir "$PEACEAI_DEPS_DIR"`. One extra line prints `runner-temp candidate-traversable=yes|no` (a fixed word,
   to confirm the cause on the next run). The m9 pin `MODEL_V1_DEV_WORKFLOW_SHA256` is updated.
2. In-code access check (`m169-guard:deps-cand-access`). After the staging dir and HOME are handed to the candidate
   uid and before the package manager runs, `sudo -u <cand> test -x/-w` on both; failure is DEPS_INSTALL_FAILED with
   subcode CAND_NO_ACCESS, and nothing is run.
3. Install-failure subcode. `installDeps` returns `{refuse, fail?}`; every DEPS_INSTALL_FAILED path has a fixed code:
   CAND_NO_ACCESS, CHOWN_TO_CAND, KILL, CHOWN_BACK, PM_EXIT, NO_MODULES. Public v4 rows with code
   DEPS_INSTALL_FAILED carry it as the optional `depsFail` field. Never message text or package-manager output.
   The row validator accepts `depsFail` only on v4 rows (`row-depsfail-v4`), only from the fixed list
   (`row-depsfail-code`), only with code DEPS_INSTALL_FAILED (`row-depsfail-only`), only on public rows
   (`row-depsfail-public`, hidden rows carry no install detail). Rows written before M169 still validate.
4. Inert pnpm-workspace.yaml keys (DEPS_PM_CONFIG, general form). `allowBuilds`, `onlyBuiltDependencies`,
   `neverBuiltDependencies`, `ignoredBuiltDependencies`, `minimumReleaseAge`, `minimumReleaseAgeExclude` are now
   allowed next to packages / catalog / catalogs, each in its documented shape only (names, a name -> true|false map,
   a minute count; `pnpm-inert-*` guards). Every other key (registries, overrides, patchedDependencies, pnpmfile,
   hoistPattern, ...) is still refused, and any `pnpm` field in a package.json is still refused.
5. LOOP_CRASHED (Auditor). `bin/loop.ts` no longer turns every throw into TASK_FILE_INVALID. A throw that names the
   task file, or any throw while the task file is not a regular file, is still `refused TASK_FILE_INVALID`
   (`bin-task-file`); validation codes runLoopFile returns (TASK_FILE_INVALID, TASK_FILE_UNLOCKED, ...) print as
   before; any other throw prints `refused LOOP_CRASHED <code>`, the error's `code` if it is an upper-case token,
   else its class name, else UNKNOWN (`bin-crash-code`). Exit 1 either way.

## Soundness note

- Nothing here widens what runs or what is fetched. The access check and the pre-flight only add refusals. The
  subcode is chosen from a fixed list by the code path taken; no string from the package manager, the error or the
  repo reaches a row or a log line. LOOP_CRASHED prints a token matched by `^[A-Z][A-Z0-9_]{1,40}$` or a class name
  matched by `^[A-Za-z]{1,40}$`, never `e.message` (the test checks the path is not printed).
- The inert keys cannot change sources or run code under the loop's install: it is `--frozen-lockfile` (nothing is
  resolved, so release-age settings have nothing to act on), `--ignore-scripts` (no dependency build script runs
  whatever the build allow lists say), the registry is pinned under `env -i`, and every lockfile entry is still
  checked for the registry and integrity. A value outside the documented shape (a url, a path, a protocol, a
  non-boolean) is refused rather than judged. This reverses one M151 near-miss (onlyBuiltDependencies was refused as
  "a harmless-looking setting"); that near-miss now uses hoistPattern, which stays refused.
- The deps dir moves from `$RUNNER_TEMP/deps` to a fresh mktemp dir under /tmp, owned by the runner, mode 755; the
  per-run cache inside it is still mkdtemp'd, chmod 755, and removed at the end of the run. The stage-2 isolation
  still mounts /tmp read-only for test runs.
- Hidden rows: unchanged (taskKey and scores only); `depsFail` is refused on them.

## Limits

- TEST_RUNNER_UNSUPPORTED is not handled in this batch. The four dev refusals are mocha (superstruct, with a babel
  register and a build step first), ava (p-queue, ts-node register and a build step first) and kysely x2 (needs a
  Postgres / MSSQL service). Supporting mocha / ava means running a repo build script and a second shim report format;
  that is a larger change and is left for its own batch. Services stay out of scope.
- valibot stays DEPS_PM_CONFIG: its pnpm-workspace.yaml has overrides and patchedDependencies, which change what is
  installed, and stay refused.
- The access check proves reachability at install time only; the pre-flight proves it once per job.

## Descriptive numbers (no gain claims)

Before: CI run 41488888877, 36 rows, 0 reached tests (per proposer 6 DEPS_INSTALL_FAILED, 2 DEPS_PM_CONFIG,
4 TEST_RUNNER_UNSUPPORTED), deps null on all rows.

After, box only (candidate uid peaceai-cand2, public dev tasks, not logged rows, not CI):
- defu task, deps dir under a 0750 dir: DEPS_INSTALL_FAILED, depsFail CAND_NO_ACCESS, deps null.
- ohash task, traversable deps dir: before DEPS_PM_CONFIG; after deps pnpm, repair-v2 PASS, repair-v1
  ATTEMPT_LIMIT (max 5 attempts).
- valibot: still DEPS_PM_CONFIG. The four runner tasks: still TEST_RUNNER_UNSUPPORTED.
