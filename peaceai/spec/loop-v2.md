# Sandboxed test-and-fix loop v2 (M151)

Status: draft for Auditor review (Builder, 2026-10-30; revised after Auditor's FAIL at 547444c). Builds on loop v1 (`loop-v1.md`, PR #637). Code:
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
   --frozen-lockfile --ignore-scripts`; `package-lock.json` / `npm-shrinkwrap.json` -> `npm ci --allow-git=none
   --allow-remote=none --allow-file=none --ignore-scripts`;
   `yarn.lock` (classic) -> `corepack yarn@1.x install --frozen-lockfile --ignore-scripts`. `packageManager` pins the
   version; otherwise the pnpm lockfile format picks one. No lockfile -> `DEPS_NO_LOCKFILE`; yarn berry or an unknown
   pnpm lockfile -> `DEPS_PM_UNSUPPORTED`. Before anything is installed the lockfile is scanned (below); a
   non-registry source -> `DEPS_NONREGISTRY`.
4. Targets: the team's test files (as v1). After a team pass, the tests the code search tools relate to the edited
   files (`testsFor`, top 3 per file, at most 10, same package, not the team's) are run on the edited copy; if they
   fail there but passed on the unedited copy the attempt gets `RELATED_FAIL` (a regression) and the loop revises.
   The related tests are worked out again for every attempt (each edit can touch different files).

## Install safety (binding)

- Lockfile scan first (`lockfileAllowed`, fail closed). Every lockfile at the repo root (pnpm-lock.yaml,
  package-lock.json, npm-shrinkwrap.json, yarn.lock; regular files only) is scanned with its own rules, not just the
  one picked (npm also reads yarn.lock). A repo with both npm-shrinkwrap.json and package-lock.json is refused (npm ci
  reads the shrinkwrap; we do not guess which one). Any root lockfile over 64 MiB (`LOCK_MAX_BYTES`) ->
  `DEPS_TOO_LARGE` before any lockfile is read. Every package entry must be a tarball under
  `https://registry.npmjs.org/` with an integrity hash (sha512 / sha384 / sha256 / sha1 SRI). Allowed otherwise only:
  workspace package dirs and link entries whose target stays inside the repo, and npm entries bundled inside their
  parent's (registry) tarball (`inBundle` / `bundled`, no `resolved` of their own). Everything else is refused with
  `DEPS_NONREGISTRY` before the candidate uid runs anything: git deps (any form), remote tarballs on any other host
  (even with an integrity hash), `file:` deps, links or install locations outside the repo, registry entries with
  no integrity, an unparseable lockfile.
  - npm: `packages` (v2/v3) and `dependencies` (v1, also read when a v2 file has both), parsed as JSON. Directory
    links (`link: true`, which `--allow-file=none` does not block) must point inside the repo.
  - pnpm (v5/v6/v9): parsed by a small parser for the plain YAML subset pnpm writes (no YAML library is a pinned
    dependency of this repo): block maps / sequences with 2-space indent steps, one-level flow collections only at
    depth >= 2 (`{integrity: ...}`, `[x64]`), single-line plain / single-quoted / escape-free double-quoted scalars,
    whole-line comments. Refused as outside the subset: flow at the top two levels or nested flow, any other indent
    step, a backslash in a double-quoted scalar, anchors / aliases / tags (`&`, `*`, `!`) and merge keys (`<<`),
    duplicate keys, block or multi-line scalars, inline comments, more than one document, tabs, CR, NEL / LS / PS and
    other control characters. Inside the subset YAML has one reading, so pnpm sees the same tree (checked against
    js-yaml on the dev-set lockfiles: identical trees). Then, structurally: every `packages` entry has a
    `resolution` that is exactly `{integrity}` or `{integrity, tarball}` with a registry tarball; no package /
    snapshot key with a protocol; every `link:` resolves inside the repo from its importer dir; no other value with a
    URL, `file:`, `git...:` or `tarball:` (the free-text `deprecated:` notice is skipped).
  - yarn classic: fields at 2 spaces as `name value` or `name:` (dependency maps at 4); a quoted or colon-form field
    name, a duplicate field in a block (yarn keeps the last), or any other line shape is refused. Specs have no
    protocol except `npm:` aliases and in-repo `link:`; every non-link entry's `resolved` is a plain tarball path
    under `https://registry.npmjs.org/` or `https://registry.yarnpkg.com/` (exact host, https, lower case; Auditor
    ruling) with an `integrity` line, or, without one, the `#<40-hex sha1>` fragment yarn v1 checks the tarball
    against. Any other host or no hash stays `DEPS_NONREGISTRY`.
- npm also gets `--allow-git=none --allow-remote=none --allow-file=none` (npm 11 defaults these to `all`), so npm
  itself refuses git / url / file deps even if the scan missed one.
- Runs as the stage-2 candidate uid (`sudo -n -u <cand>`; the same separate no-sudo uid as the test runs), under
  `env -i` with a fixed PATH and a private HOME / TMPDIR / package-manager cache, inside `timeout -s KILL`.
- In a staging tree built from the tracked files at the pinned commit (no team tests, no edits), in the run's own
  cache dir; package-manager config files that can redirect the registry or run code (`.npmrc`, `.yarnrc`,
  `.yarnrc.yml`, `.pnpmfile.cjs/.mjs`, `bunfig.toml`) are removed first; the registry is pinned to
  `https://registry.npmjs.org/`. Install scripts are off; pnpmfiles are ignored.
- This step is the one place with network, and here the candidate uid runs a process WITH network: the package
  manager itself (npm, or pnpm / yarn which corepack fetches from the npm registry). It runs no package code:
  scripts off, pnpmfile ignored, config files stripped, only registry tarballs with integrity (scan + npm flags).
  Test runs never have network (v1 wrapper unchanged); package code first runs there.
- Right after the install, before the tree changes hands, every process of the candidate uid is killed
  (`sudo -n pkill -KILL -u <cand>`, up to 5 rounds, then `pgrep -u <cand>` must find none), so a `setsid` escapee
  cannot keep running with network. If that cannot be confirmed -> `DEPS_INSTALL_FAILED`.
- After the install the tree is chowned back to the runner (`sudo -n chown -R`; if that fails ->
  `DEPS_INSTALL_FAILED`, the tree is never used) and made `go-w`; the private HOME is deleted. The copy gets
  a real `node_modules` dir of per-entry symlinks into the staging tree (no `.bin`), so nothing the loop writes into
  the copy (wrapper, shim) can reach the shared tree, and the candidate cannot write the tree.
- Caps: deadline (default 600 s) -> `DEPS_TIMEOUT`; installed bytes over the cap (default 1.5 GiB, inode-deduped) ->
  `DEPS_TOO_LARGE`; any other failure -> `DEPS_INSTALL_FAILED`. Codes only, never package-manager output (its output
  is discarded).
- Cache: keyed by sha256 of (package manager, version, every root lockfile's sha256, every package.json / pnpm-workspace.yaml
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

Each guard is one line tagged `// guard:<id>` in `loopdeps.ts` (41: runner-other, service, runner-dep,
deps-lockfile, deps-nonregistry, deps-npm-allow, deps-pnpmfile, deps-frozen, deps-ignore-scripts, deps-config,
deps-registry, deps-env-i, deps-cand, deps-kill, deps-chown, deps-timeout, deps-size, lock-size, lock-npm-both,
lock-all, lock-npm-key, lock-link, lock-npm, lock-npm-v1, lock-pnpm-anchor, lock-pnpm-esc, lock-pnpm-flow,
lock-pnpm-indent, lock-pnpm-dup, lock-pnpm-key, lock-pnpm-missing, lock-pnpm-res, lock-pnpm-link, lock-pnpm-url,
lock-yarn-field, lock-yarn-dup, lock-yarn-spec, lock-yarn, shim-report, shim-suites, shim-exit). Each has a refused
near-miss case; the layout guards also have a near miss whose content is harmless, so only the layout rule refuses
it. The m151
mutation test deletes each in turn (with a loop.ts that imports the mutant) and requires a case to fail with an
assertion. deps-cand / deps-config / deps-registry / deps-env-i / deps-kill / deps-chown / deps-timeout / deps-size
need the candidate uid and sudo: where those are missing, their mutants and the install cases (`needsCand`) are
reported as SKIPPED with a reason, never as passes; the loop cases assert the `CAND_UID_*` refusal there. The
lockfile-scan cases and `DEPS_NONREGISTRY` need no candidate uid and run everywhere. The tests never use the
network: the package manager is a vendored stub injected through `DepsOptions.tool`, and the vitest it installs is
a vendored stub runner.

## Log

Rows are `peaceai-plan-loop:v2` / `loop-v2` with three more required keys: `runner` (node-test / vitest / jest, or
null when refused before one was picked), `deps` (none / npm / pnpm / yarn, or null) and `baseline`
(`{ total, passing, failing }` for the team's tests on the unedited copy, or null when it did not run). New codes:
`TEST_NEEDS_SERVICE`, `DEPS_NO_LOCKFILE`, `DEPS_PM_UNSUPPORTED`, `DEPS_NONREGISTRY`, `DEPS_INSTALL_FAILED`,
`DEPS_TIMEOUT`, `DEPS_TOO_LARGE`, attempt code `RELATED_FAIL` (all v2-only; v1 rows keep validating as before). Codes
and numbers only, as v1. Hidden-set rows carry the taskKey plus scores only: `runner`, `deps` and `baseline` are
always null there (together they could identify the repo); the loop writes them so and the validator refuses
anything else (`hidden_detail`).

## v2 limits

- vitest / jest: per-test names are not collected (only counts); feedback to the proposer has codes, no names.
- Counts are advisory as in v1 (the candidate's code shares the runner process); tamper hashes and the leftover kill
  still apply. The installed tree is not tamper-hashed per file, but it is owned by the runner and not writable by
  the candidate.
- The install is a second place where the candidate uid runs a process, and that process (the package manager) has
  network. Package code is not run there (see Install safety); it first runs inside the test isolation (no network).
- pnpm lockfiles outside the plain YAML subset (hand-edited, or written by a future pnpm in another style) are
  refused (`DEPS_NONREGISTRY`) rather than parsed.
- One package per task; no service-backed suites; no yarn berry; no bun / deno.
- Box notes: the shared `peaceai-cand` uid is used by every agent's m146 runs, which kill all its processes; use a
  separate candidate uid per concurrent run (`PEACEAI_STAGE2_CAND`, `M146_CAND` / `M151_CAND` in tests). A full or
  inode-exhausted tmp breaks installs (`DEPS_INSTALL_FAILED`); point `--deps-dir` at a roomy exec-able filesystem.
