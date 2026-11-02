# Loop runners and installs, batch 10 (stacked on repair-v2)

Status: implemented in `peaceai/lib/loopdeps.ts` (the json-runner shim and `detectRunner`). Tests:
`peaceai/test/m170-runners.test.ts` (cases in `m170-cases.ts`), `peaceai/test/m170-mutation.test.ts`. Everything here
was found and tuned on the public dev tasks (`peaceai/plan/tasks-public-v1.json`) and synthetic fixtures only; no
hidden-set row, task or result was read.

## 1. vitest < 2 through its node API (admitted: a run that already happened is now scored correctly)

Cause (scule, destr; public dev run, plan-only-v4): vitest 0.x / 1.x write their results cache to
`<root>/node_modules/.vitest/results.json` after every run (`VitestCache`; only skipped when the config says
`cache: false`). In the loop copy node_modules is read-only for the candidate uid and tamper-hashed, so that write
fails with EACCES and vitest exits 1 even when every test passed. The shim's exit rule (`guard:shim-exit`) then counts
`fail 1`, so a correct fix was never credited: scule's reference one-line fix ran 58/58 and still scored TEST_FAIL,
ending in ATTEMPT_LIMIT. Their CLI has no flag to turn the cache off (`--cache` / `--no-cache` are rejected as
unknown options), and pointing the cache at /dev/null breaks the next read.

Change: when the runner is vitest, its package.json version has major < 2, and its `exports["./node"]` names a file
that exists (string, `{import: path}` or `{import: {default: path}}`), the shim starts the same run through vitest's
own node API, which is what its CLI calls:

    startVitest("test", files, { run: true, watch: false, reporters: ["json"], outputFile: <report>, cache: false },
                { cacheDir: <TMPDIR>/vite-cache })

in a child `node --input-type=module -e ...` with the same cwd, the same files, the same report path. The report
rules after it are unchanged: no report -> `fail 1`, failed suites count, a nonzero exit or `success: false` with no
failure -> `fail 1`. Every other case (vitest >= 2, no `./node` export, an export with no file, a require-only export,
jest) runs the CLI exactly as before.

Soundness: no check is removed or weakened; the change only turns off a write that cannot succeed in the copy and
moves vite's own cache dir to the private TMPDIR (it, too, would write into node_modules). The run is still inside
the unchanged isolation as the candidate uid, the shim is still under node_modules (tamper-hashed, never an edit
target), the entry file is the installed vitest's own (resolved from the package.json the shim already found, under
node_modules), and the exit code is still enforced: a nonzero exit with a clean report still scores `fail 1`.

Tests (m170-cases.ts): admitted on three export shapes (1.x string, `{types, import}` as 0.34 / 1.x ship it,
`{import: {default}}`), each asserting the options the API got (run, no watch, cache false, json reporter, the TMPDIR
report and vite cache dir). Near misses: a failing test, a nonzero exit with a clean report, a suite that fails to
load (all still failing); vitest 2 and 4 keep the CLI; no `./node` export, an export with no file and a require-only
export keep the CLI (no credit, as before). End to end: a vitest < 2 stub task through `runLoopTask` with a real
install as the candidate uid is PASS (it was TEST_FAIL on every attempt). Mutation: the selection line is tagged
`// m170-guard:vitest-legacy-api`; deleting it fails the m170 cases.

## 2. The service check first (kysely: TEST_NEEDS_SERVICE, refusal to refusal)

kysely's test script reaches mocha one script level down and the repo has `docker-compose.yml` (its tests need
Postgres / MySQL / MSSQL). It was refused TEST_RUNNER_UNSUPPORTED because the runner check came first; now
`guard:service` sits above `guard:runner-other`, so the row says the real reason. Both remain refusals; nothing new is
run. Tests: compose + mocha (direct, and one script level down) -> TEST_NEEDS_SERVICE; mocha with no compose file ->
TEST_RUNNER_UNSUPPORTED; vitest with no compose file still admitted. Mutation: deleting `guard:service` is already
caught by m151-mutation.

## 3. Kept refused (with the reason)

- valibot (DEPS_PM_CONFIG): its `pnpm-workspace.yaml` has `overrides` and `patchedDependencies` besides the six inert
  keys. Per the Auditor ruling, only the six inert keys (expected-form values) are admitted; every other key stays
  refused unless proven safe. `overrides` alone could be checked (exact versions that equal the lockfile's
  `overrides:` block, which `--frozen-lockfile` also enforces), but valibot needs both keys. `patchedDependencies`
  makes pnpm apply a repo-supplied diff to installed packages; proving that safe needs an audit of pnpm's patch
  applier (paths in diff headers, renames, symlinks, binary hunks, the lockfile `patchedDependencies` hash) per
  pnpm version, which this batch did not do. So both stay refused; no near-miss is weakened.
- p-queue (ava, TEST_RUNNER_UNSUPPORTED): ava stays an unsupported runner, and the repo has no lockfile, so even with an
  ava shim there would be nothing to install from (DEPS_NO_LOCKFILE; dependencies only ever come from a lockfile).
- superstruct (mocha + a build step, TEST_RUNNER_UNSUPPORTED): not done in this batch. A mocha shim needs its own
  report path (mocha's JSON reporter, npm-script flags such as `--require`) and the opt-in build-before-test step needs
  the project's build script run as the candidate uid in the same isolation with no network; neither is built yet,
  so both stay refused.
