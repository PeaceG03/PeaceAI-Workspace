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
   pnpm lockfile -> `DEPS_PM_UNSUPPORTED`. Before anything is installed the package-manager settings are checked and
   the lockfile is scanned (below); settings the loop does not vouch for -> `DEPS_PM_CONFIG`, a non-registry source
   -> `DEPS_NONREGISTRY`.
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
  - yarn classic (Auditor FAIL 7e7a41d): yarn 1.22's own lockfile parser falls back to js-yaml (FAILSAFE) whenever
    it throws, and that reading differs (an unquoted `is-number@npm:is-odd@3.0.1:` header becomes another key with a
    string value), so the lock is read only in the subset yarn's parser reads without throwing and the same way:
    printable ASCII, no tab, CR or BOM; `#` lines only at column 0 and no `yarn lockfile vN` with N other than 1;
    headers at column 0 as comma-separated tokens ending in `:`; quoted tokens without a backslash; a bare token must
    start with a letter, not start with `true` / `false` and hold none of `" \ [ ]`, and bare tokens end at space, `,`
    and `:` as in yarn (so an unquoted `:` inside a header is refused); scalar fields at 2 spaces only `version`,
    `resolved`, `integrity`, maps at 2 spaces only `dependencies`, `optionalDependencies`, map entries at 4 spaces as
    two quoted-or-bare strings; no duplicate field, map or entry; any other line (whitespace-only, odd indent, a third
    token, a trailing comment) is refused. Every header spec is `name@range` (a valid npm name; a bare-name header is
    refused because yarn looks the bare name up first) with range a plain semver range (a subset of node-semver 5: `^ ~
    x * = < <= > >=`, spaces, `||`; no hyphen ranges, `v`, `~>` or loose forms), an `npm:` alias of one, or an in-repo
    `link:`. A semver header range must be satisfied by the block's `version` (otherwise yarn treats the entry as
    outdated and resolves it fresh). The closure: every entry of every block's `dependencies` / `optionalDependencies`
    must be a registry range (no URL, git, `file:`, `link:` or other protocol) whose `name@range` is itself a header,
    because yarn looks sub-dependencies up by that exact key and fetches anything missing. Every non-link block's
    `resolved` is a plain tarball path under `https://registry.npmjs.org/` or `https://registry.yarnpkg.com/` (exact
    host, https, lower case; Auditor ruling) with an `integrity` line, or, without one, the `#<40-hex sha1>` fragment
    yarn v1 checks the tarball against. A layout outside the subset is refused; any other host or no hash stays
    `DEPS_NONREGISTRY`. The parser and the semver subset were checked off-repo against yarn 1.22.22's own modules (same
    object on the yup lock and 4,000 line mutants of it wherever ours accepts; same `satisfies` (strict and loose)
    and a valid range on 123,505 random accepted range/version pairs).
- Package-manager settings outside the root lockfile (`depsSourceProblem`, before the lockfile scan, fail closed;
  Auditor FAIL 886ee29). The whole copy is walked (symlinks not followed, `.git` skipped; a dir it cannot read or
  more than 500,000 entries -> refused). Refused with `DEPS_PM_CONFIG`:
  - any lockfile below the root, for every package manager: `pnpm-lock.yaml`, `package-lock.json`,
    `npm-shrinkwrap.json`, `yarn.lock`, `bun.lock`, `bun.lockb` at any depth (only root lockfiles are scanned, and
    pnpm with `sharedWorkspaceLockfile: false` installs each workspace package from its own lock).
  - pnpm only (the picked manager is pnpm): a `pnpm-workspace.yaml` that is not a regular file, is outside the plain
    YAML subset (the lockfile parser), or has any top-level key other than `packages`, `catalog`, `catalogs`
    (`registries`, `sharedWorkspaceLockfile`, `overrides`, `pnpmfile`, `onlyBuiltDependencies`, ... are all refused,
    not judged); `packages` must be a list of globs inside the repo (`!` negations too); catalog entries must be
    plain version ranges (`npm:` aliases allowed, no other protocol). A `pnpm-workspace.yaml` below the root, a
    `pnpm-workspace.yml`, or a `package.yaml` / `package.json5` / `package.yml` anywhere. Any `pnpm` field in any
    `package.json` in the copy (a superset of the root plus the workspace packages), or a `package.json` that is not
    a regular file or not a JSON object (a leading BOM is stripped first, as pnpm does). Any `pnpm` field is refused
    rather than an allowed subset: `overrides`, `packageExtensions`, `patchedDependencies` and the settings pnpm still
    reads there can change what is fetched or from where, and none is needed for a frozen, scripts-off install.
  - npm and yarn never read pnpm's files, so those are not judged in npm / yarn repos.
  - every package manager (Auditor FAIL 71fff3d): a `packageManager` that is not exactly `name@x.y.z` with an
    optional `+algo.hexhash` (a URL, range, tag or another manager), or a `devEngines.packageManager` /
    `devEngines.runtime` (corepack and pnpm can download those), in any `package.json` that parses; a root
    `package.json` that is not a JSON object.
  - yarn only: `--frozen-lockfile` does not stop yarn v1 fetching a dependency that has no yarn.lock entry, so every
    spec in `dependencies`, `devDependencies` and `optionalDependencies` of the root and of EVERY other package.json in
    the tree, workspace or not (Auditor FAIL e5f28a6: a glob yarn normalises, such as `packages//*`, matched nothing
    here, so a workspace went unchecked), must be a `name@spec` header in yarn.lock (headers parsed as above), or name
    a workspace package whose version (strict semver) satisfies the spec as a plain semver range (yarn otherwise
    fetches `name@spec` from the registry). For that rule only, a workspace is a dir the glob matches with no segment
    starting with `.` and none named `node_modules`: a subset of what yarn's node-glob (dot: false) finds, so nothing
    yarn does not treat as a workspace counts as one. A package without both a `name` and a `version` is not a
    workspace for yarn and is not one here. A package.json anywhere that is not a JSON object is refused (fail
    closed; yarn would not read a fixture, but it is not vouched for). Cost: a yarn repo with an unlocked or URL dep in
    any fixture package.json is refused; none in the dev set (yup has only the root package.json). `peerDependencies`
    are not installed by yarn v1 (its install reads only the three fields above) and are not read.
    `bundledDependencies` / `bundleDependencies` other than an empty list, and `resolutions`, in any of those
    manifests are refused outright. `workspaces` must be a list (or `{packages, nohoist}`) of plain globs; the matcher
    matches at least what yarn does (`*` within a segment, `**` any number of segments). package.json files outside
    the workspaces (fixtures) are not read by yarn and are not judged.
  - plain globs (yarn workspaces and pnpm `packages`): inside the repo, no `..` segment, no empty or `.` segment and no
    trailing `/` (which the package managers normalise), no leading `.`, `/` or `#` (a minimatch comment), none of
    `{ } ? [ ] ( ) ! + @ \` (pnpm keeps a leading `!` negation).
  - `.npmrc`, `.yarnrc`, `.yarnrc.yml`, `.pnpmfile.cjs/.mjs`, `bunfig.toml`, `.corepack.env` are removed at ANY depth from the
    install tree (basename match over every tracked file, below), and untracked files are never copied there; the
    user / global config is the private HOME under `env -i`, so no repo file is read as one.
- npm also gets `--allow-git=none --allow-remote=none --allow-file=none` (npm 11 defaults these to `all`), so npm
  itself refuses git / url / file deps even if the scan missed one.
- Runs as the stage-2 candidate uid (`sudo -n -u <cand>`; the same separate no-sudo uid as the test runs), under
  `env -i` with a fixed PATH and a private HOME / TMPDIR / package-manager cache, inside `timeout -s KILL`.
- In a staging tree built from the tracked files at the pinned commit (no team tests, no edits), in the run's own
  cache dir; package-manager config files that can redirect the registry or run code (`.npmrc`, `.yarnrc`,
  `.yarnrc.yml`, `.pnpmfile.cjs/.mjs`, `bunfig.toml`, `.corepack.env`) are removed first (any depth); corepack is also
  told to read no env file (`COREPACK_ENV_FILE=0`, guard deps-corepack-env); the registry is pinned to
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

Each guard is one line tagged `// guard:<id>` in `loopdeps.ts` (71 at round 7; the list is in
`m151-mutation.test.ts`). Each has a refused
near-miss case; the layout guards also have a near miss whose content is harmless, so only the layout rule refuses
it. The m151
mutation test deletes each in turn (with a loop.ts that imports the mutant) and requires a case to fail with an
assertion. deps-cand / deps-config / deps-corepack-env / deps-registry / deps-env-i / deps-kill / deps-chown / deps-timeout / deps-size
need the candidate uid and sudo: where those are missing, their mutants and the install cases (`needsCand`) are
reported as SKIPPED with a reason, never as passes; the loop cases assert the `CAND_UID_*` refusal there. The
lockfile-scan and pm-config cases, `DEPS_NONREGISTRY` and `DEPS_PM_CONFIG` need no candidate uid and run everywhere. The tests never use the
network: the package manager is a vendored stub injected through `DepsOptions.tool`, and the vitest it installs is
a vendored stub runner.

## Log

Rows are `peaceai-plan-loop:v2` / `loop-v2` with three more required keys: `runner` (node-test / vitest / jest, or
null when refused before one was picked), `deps` (none / npm / pnpm / yarn, or null) and `baseline`
(`{ total, passing, failing }` for the team's tests on the unedited copy, or null when it did not run). New codes:
`TEST_NEEDS_SERVICE`, `DEPS_NO_LOCKFILE`, `DEPS_PM_UNSUPPORTED`, `DEPS_NONREGISTRY`, `DEPS_PM_CONFIG`,
`DEPS_INSTALL_FAILED`, `DEPS_TIMEOUT`, `DEPS_TOO_LARGE`, (M152, M164) `PROPOSER_FAILED`, attempt code `RELATED_FAIL` (all v2-only; v1 rows keep validating as before). Codes
and numbers only, as v1. Hidden-set rows carry the taskKey plus scores only: `runner`, `deps` and `baseline` are
always null there (together they could identify the repo); the loop writes them so and the validator refuses
anything else (`hidden_detail`).

## Planner (M162)

The loop plans with whichever planner `peaceai/lib/plandefault.ts` `selectPlanner` picks, never a planner of its own
choosing: no flag = `selectPlanner`'s default (`plan-only-v3` since #650, see `plan-default.md`), and
`tsx peaceai/bin/loop.ts run <taskfile> --planner v1|v2|v3|v4` (or the full `plan-only-vN` name) picks another. Any other
value is refused `PLANNER_UNKNOWN` (exit 2; `runLoopFile` returns the same code) before the task file is read or a
row is written. `bin/loop.ts`'s summary line (the loop scorecard printout) starts with `planner=<name>`. The
proposers read only the plan's steps, which every planner shares, so they are unchanged.

Rows the loop writes from M162 on are `peaceai-plan-loop:v3`: a v2 row (same keys and rules, loop still `loop-v2`)
plus two required keys, `planner` (one of `plan-only-v1` / `plan-only-v2` / `plan-only-v3` / (M164) `plan-only-v4`, the
same list as plandefault's `PLANNERS`) and `plannerSha256` (that planner's own fingerprint: `plannerSha256` /
`plannerSha256V2` / `plannerSha256V3` / `plannerSha256V4`). Codes `planner` / `planner_sha` refuse an unknown name or a malformed digest; a v3 row without
the keys, or a v1 / v2 row with them, is `loop_keys`. Existing v1 and v2 rows keep validating as before (the log
stays add-only). No planner file is edited, so no planner fingerprint moves.

Tests: `peaceai/test/m162-loop-planner.test.ts` (cases in `m162-cases.ts`: the default row is v3 with v3's digest and
the loop used v3's plan; near miss: v1 / v2 / v4 are honoured with their own digests; near-miss names `V3`, ` v3`, `v5`,
empty, `__proto__` are unknown; `runLoopFile` refuses an unknown flag without a row; the row validator; static
checks on loop.ts and bin/loop.ts). `m162-mutation.test.ts` deletes each `// m162-guard:<id>` line and applies fixed
semantic mutants (a hard-coded v1 planner, a v1 default, a dropped flag, a bypassed selectPlanner, one digest for
every planner, a plan that ignores the picked planner, v3 rows validated as v2); each must fail a case with an
assertion. The plan-observing cases need the stage-2 candidate uid (else they assert the `CAND_UID_*` refusal).

## v2 limits

- vitest / jest: per-test names are not collected (only counts); feedback to the proposer has codes, no names.
- Counts are advisory as in v1 (the candidate's code shares the runner process); tamper hashes and the leftover kill
  still apply. The installed tree is not tamper-hashed per file, but it is owned by the runner and not writable by
  the candidate.
- The install is a second place where the candidate uid runs a process, and that process (the package manager) has
  network. Package code is not run there (see Install safety); it first runs inside the test isolation (no network).
- pnpm lockfiles outside the plain YAML subset (hand-edited, or written by a future pnpm in another style) are
  refused (`DEPS_NONREGISTRY`) rather than parsed.
- pnpm repos whose `pnpm-workspace.yaml` carries settings (even inert ones such as `allowBuilds` or
  `minimumReleaseAge`), or whose `package.json` has a `pnpm` field, are refused (`DEPS_PM_CONFIG`); widening this
  needs a per-key ruling.
- One package per task; no service-backed suites; no yarn berry; no bun / deno.
- Box notes: the shared `peaceai-cand` uid is used by every agent's m146 runs, which kill all its processes; use a
  separate candidate uid per concurrent run (`PEACEAI_STAGE2_CAND`, `M146_CAND` / `M151_CAND` in tests). A full or
  inode-exhausted tmp breaks installs (`DEPS_INSTALL_FAILED`); point `--deps-dir` at a roomy exec-able filesystem.
