# Sandboxed test-and-fix loop v2 (M151)

Status: draft for Auditor review (Builder, 2026-10-30). Builds on loop v1 (`loop-v1.md`, PR #637). Code:
`peaceai/lib/loopdeps.ts` (new: runner detection, lockfile-only dependency install, json-runner shim),
`peaceai/lib/loop.ts` (uses it; v2 rows), `peaceai/lib/looprow.ts` (v2 row + validator), `peaceai/bin/loop.ts`
(`--deps-dir`). Tests: `peaceai/test/m151-loop-v2.test.ts`, `peaceai/test/m151-mutation.test.ts` (cases in
`m151-cases.ts`, fixtures in `m151-fixtures.ts`, mutant runner `m151-mutant-runner.ts`). Everything in v1's safety
section still holds; `selfpropose.ts` is unchanged and there is still exactly one candidate run site (`guardedRun`).

## What changes

1. Test stage first. After plan and context, the loop puts the team's test files in place, picks the runner, installs
   dependencies and runs the team tests on the UNEDITED copy (the baseline) before asking the proposer for anything.
   Every row therefore says how far the task's own tests could be run, whatever the proposer does.
2. Runners: node:test (as v1), vitest and jest. `detectRunner` reads the nearest package of the team's test files
   (they must share one): its test script (split into words, plus one level of the package scripts it names; the
   root scripts for a workspace package without one). Exactly one of vitest / jest named -> that runner; a
   `node|tsx ... --test` script -> node:test; neither named -> the dependencies decide (exactly one of vitest / jest).
   The runner must be a dependency. Refused with a code, never text: another runner in the script (mocha, ava, tap,
   tape, uvu, jasmine, karma, cypress, playwright, qunit, lab, ospec, bun, deno) or two / no runner ->
   `TEST_RUNNER_UNSUPPORTED`; a compose file or `docker` in the script (a database or other service) ->
   `TEST_NEEDS_SERVICE`.
3. Dependencies, only from the repo's lockfile: `pnpm-lock.yaml` -> `corepack pnpm@V install --ignore-pnpmfile
   --frozen-lockfile --ignore-scripts`; `package-lock.json` / `npm-shrinkwrap.json` -> `npm ci --ignore-scripts`;
   `yarn.lock` (classic) -> `corepack yarn@1.x install --frozen-lockfile --ignore-scripts`. `packageManager` pins the
   version; otherwise the pnpm lockfile format picks one. No lockfile -> `DEPS_NO_LOCKFILE`; yarn berry or an unknown
   pnpm lockfile -> `DEPS_PM_UNSUPPORTED`.
4. Targets: the team's test files (as v1). After a team pass, the tests the code search tools relate to the edited
   files (`testsFor`, top 3 per file, at most 10, same package, not the team's) are run on the edited copy; if they
   fail there but passed on the unedited copy the attempt gets `RELATED_FAIL` (a regression) and the loop revises.

## Install safety (binding)

- Runs as the stage-2 candidate uid (`sudo -n -u <cand>`; the same separate no-sudo uid as the test runs), under
  `env -i` with a fixed PATH and a private HOME / TMPDIR / package-manager cache, inside `timeout -s KILL`.
- In a staging tree built from the tracked files at the pinned commit (no team tests, no edits), in the run's own
  cache dir; package-manager config files that can redirect the registry or run code (`.npmrc`, `.yarnrc`,
  `.yarnrc.yml`, `.pnpmfile.cjs/.mjs`, `bunfig.toml`) are removed first; the registry is pinned to
  `https://registry.npmjs.org/`. Install scripts are off; pnpmfiles are ignored.
- Network is used only by this step (the registry). Test runs never have network (v1 wrapper unchanged).
- After the install the tree is chowned back to the runner and made `go-w`; the private HOME is deleted. The copy gets
  a real `node_modules` dir of per-entry symlinks into the staging tree (no `.bin`), so nothing the loop writes into
  the copy (wrapper, shim) can reach the shared tree, and the candidate cannot write the tree.
- Caps: deadline (default 600 s) -> `DEPS_TIMEOUT`; installed bytes over the cap (default 1.5 GiB, inode-deduped) ->
  `DEPS_TOO_LARGE`; any other failure -> `DEPS_INSTALL_FAILED`. Codes only, never package-manager output (its output
  is discarded).
- Cache: keyed by sha256 of (package manager, version, lockfile sha256, every package.json / pnpm-workspace.yaml
  sha256), inside one run's cache dir only (`openDepsCache`, newest 2 kept); the dir is removed when the run ends.
  Nothing is shared between runs or with any global cache. `--deps-dir /abs/dir` (default `os.tmpdir()`) picks where
  the run's cache dir is made; it must allow exec (native addons) and be traversable by the candidate uid.

## Running vitest / jest

Inside the unchanged isolation, through a PeaceAI-written shim (`node_modules/.peaceai-loop/run.mjs` in the copy;
under node_modules, so never an edit target, and tamper-hashed by `guardedRun`). It starts the runner from its
package bin with the JSON reporter writing to the private TMPDIR (`vitest run --reporter=json --outputFile=...`;
`jest --ci --json --outputFile=... --runTestsByPath`), and prints the counts in the TAP summary form guardedRun reads.
Fail closed: no report -> `fail 1`; failed suites with no failed test -> counted as failures; a nonzero exit or
`success: false` with no failure -> `fail 1`. vitest >= 3.1 is retried once with `--configLoader runner` when no
report was written (the default config loader writes a temp file beside the config, and the copy is read-only).

Each guard is one line tagged `// guard:<id>` in `loopdeps.ts` (runner-other, service, runner-dep, deps-lockfile,
deps-frozen, deps-ignore-scripts, deps-config, deps-cand, deps-timeout, deps-size, shim-report, shim-suites,
shim-exit). The m151 mutation test deletes each in turn (with a loop.ts that imports the mutant) and requires a case
to fail with an assertion. deps-cand / deps-config / deps-timeout / deps-size need the candidate uid and sudo; where
those are missing they are skipped and the loop cases assert the `CAND_UID_*` refusal. The tests never use the
network: the package manager is a vendored stub injected through `DepsOptions.tool`, and the vitest it installs is
a vendored stub runner.

## Log

Rows are `peaceai-plan-loop:v2` / `loop-v2` with three more required keys: `runner` (node-test / vitest / jest, or
null when refused before one was picked), `deps` (none / npm / pnpm / yarn, or null) and `baseline`
(`{ total, passing, failing }` for the team's tests on the unedited copy, or null when it did not run). New codes:
`TEST_NEEDS_SERVICE`, `DEPS_NO_LOCKFILE`, `DEPS_PM_UNSUPPORTED`, `DEPS_INSTALL_FAILED`, `DEPS_TIMEOUT`,
`DEPS_TOO_LARGE`, attempt code `RELATED_FAIL` (all v2-only; v1 rows keep validating as before). Codes and numbers
only, as v1.

## v2 limits

- vitest / jest: per-test names are not collected (only counts); feedback to the proposer has codes, no names.
- Counts are advisory as in v1 (the candidate's code shares the runner process); tamper hashes and the leftover kill
  still apply. The installed tree is not tamper-hashed per file, but it is owned by the runner and not writable by
  the candidate.
- The install is a second place where the candidate uid runs a process (the package manager, not candidate code),
  and it has network (the registry). Packages' own code first runs inside the test isolation (no network).
- One package per task; no service-backed suites; no yarn berry; no bun / deno.
- Box notes: the shared `peaceai-cand` uid is used by every agent's m146 runs, which kill all its processes; use a
  separate candidate uid per concurrent run (`PEACEAI_STAGE2_CAND`, `M146_CAND` / `M151_CAND` in tests). A full or
  inode-exhausted tmp breaks installs (`DEPS_INSTALL_FAILED`); point `--deps-dir` at a roomy exec-able filesystem.
