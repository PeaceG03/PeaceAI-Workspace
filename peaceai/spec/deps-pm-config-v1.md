# Dependency install: package-manager settings PeaceAI vouches for (M188)

Status: draft (batch 23 PR). Code: `peaceai/lib/loopdeps.ts` (M188 section, `managerFieldsOk`,
`yarnManifestsAllowed`, `pnpmWorkspaceAllowed`, `pnpmConfigAllowed`, `installDeps`, `install`). Tests:
`peaceai/test/m188-pmconfig.test.ts`, `m188-cases.ts`, `m188-mutation.test.ts`, `m188-mutant-runner.ts`.

## Why

DEPS_PM_CONFIG is the loop's refusal for package-manager settings it does not vouch for. Before M188 it refused
every `pnpm` field, every pnpm-workspace.yaml key beyond packages / catalog(s) / the M169 inert keys, every
devEngines package manager or runtime, and every yarn `resolutions` map. Common repos carry these settings, and
most of them cannot change what is fetched, from where, or what runs. This change was ranked by failure category
(DEPS_PM_CONFIG) only. No practice task's fix, reference diff or repo was opened, and the fixtures are unrelated
synthetic shapes. The loop-v2 notes already list one practice task as DEPS_PM_CONFIG for overrides /
patchedDependencies. The rule below is the general pnpm / yarn feature, not that repo's settings.

## The rule

Under the loop's install (frozen lockfile, `--ignore-scripts`, `--ignore-pnpmfile`, registry pinned by env, `env
-i`, candidate uid), a setting is admitted only if it falls into one of two kinds:

- It only lays out or checks the locked tree.
- It must equal what the scanned root lockfile already records.

Everything else stays DEPS_PM_CONFIG.

1. **pnpm layout / check settings** (pnpm-workspace.yaml):
   - **Booleans:** autoInstallPeers, strictPeerDependencies, dedupePeerDependents, resolvePeersFromWorkspaceRoot,
     shamefullyHoist, hoist, preferWorkspacePackages, injectWorkspacePackages, saveExact, engineStrict,
     excludeLinksFromLockfile, strictDepBuilds, ignoreWorkspaceRootCheck, dedupeDirectDeps, dedupeInjectedDeps,
     disallowWorkspaceCycles.
   - **Enums:**
     - `nodeLinker`: isolated or hoisted (never pnp).
     - `linkWorkspacePackages`, `savePrefix` and `resolutionMode`, each to the values pnpm documents.
     - `sharedWorkspaceLockfile`: true only. With false, pnpm would read per-package lockfiles the loop never scanned.
   - **Patterns:** hoistPattern and publicHoistPattern, as lists of plain name patterns.
2. **pnpm overrides** (workspace file or the root `pnpm` field, not both):
   - Selectors are up to three `name[@range]` parts joined by `>`.
   - Values are `-` or a registry range (the semver subset, or `npm:` alias to one). A `$reference`, link:, file:,
     git, URL or tag is refused.
   - The map must equal the lockfile's `overrides` entry for entry.
3. **pnpm patchedDependencies** (same places):
   - Each key is `name[@version]`. Each path is a regular file in the repo tree, size-capped, that passes a strict
     unified-diff check:
     - Every path is `/dev/null` or stays inside the package (no absolute path, no `..`).
     - No binary patch, and no line kind outside the header set.
     - Hunk line counts match their headers.
   - The key set must equal the lockfile's `patchedDependencies` keys. pnpm compares the patch hashes itself.
4. **pnpm peerDependencyRules:**
   - ignoreMissing and allowAny (name patterns).
   - allowedVersions (selector to a plain range).
   - These only silence peer warnings, and a frozen install resolves nothing.
5. **The root `pnpm` field:**
   - Allowed keys: overrides, patchedDependencies, peerDependencyRules, the M169 build keys and
     allowedDeprecatedVersions, each vetted as above.
   - A nested package.json with a `pnpm` field is still refused. pnpm reads the field from the root only, and
     refusing the rest keeps the rule simple.
   - Still refused: packageExtensions (adds dependencies), configDependencies (fetches and runs code), executionEnv,
     supportedArchitectures, layout settings in the field, and any other key.
6. **devEngines.packageManager / runtime:**
   - An object, or a list of 1-4, with keys from name / version / onFail.
   - onFail must be ignore, warn or error. A missing onFail or `download` is refused.
   - The name must be npm / pnpm / yarn (runtime: node). The version is absent or a semver range.
7. **yarn v1 resolutions** (root package.json only):
   - Each key is a `**` / name path ending in a package name.
   - Each value is a registry range whose `name@value` is a yarn.lock header. Without one, yarn resolves it afresh
     from the registry; probe y2 below.
8. **The root .npmrc:**
   - Still removed from the install tree (guard:deps-config). PeaceAI then writes back only vetted layout / peer
     keys (`npmrcCarry`), each with its value shape:
     - The kebab forms of 1.
     - npm's legacy-peer-deps, strict-peer-deps and install-strategy.
   - Registry, auth, proxy, script-shell, ignore-scripts and every other line is dropped, as before, never refused.
   - Lines with `${...}` or quotes are dropped.
9. **Cache key:** patch files and the carried .npmrc text are added to the install cache key.

## Soundness note

Admitted settings never widen what the install can reach:

- The network allowlist is unchanged: the registry is pinned by env, and the npm `--allow-*=none` flags remain.
- Scripts stay off and the pnpmfile stays ignored.
- The root lockfile is still the only source of packages, and is still scanned for registry + integrity.

Override and patch settings are admitted only when they equal the scanned lockfile. Box probes with real pnpm
9.15.9 under `--frozen-lockfile` showed pnpm refusing the install (`ERR_PNPM_LOCKFILE_CONFIG_MISMATCH`) when an
override value, a patch file's content, or the patch config itself differed from the lockfile. So the installed
graph is the scanned one. A patch only edits files inside one already-fetched package. The path check keeps it
there, and scripts stay off, so patched code does not run at install.

devEngines checks are only admitted with an onFail that cannot download. A box probe showed corepack 0.36 running
`corepack pnpm@9.15.9 ...` unchanged under four devEngines variants, including a mismatching manager and a `node
>=99` runtime, and fetching only the explicit pnpm. The loop always names its manager explicitly.

yarn v1 resolutions are admitted only when the resolved spec is itself a yarn.lock header. The existing closure
check then covers it. A box probe showed yarn 1.22.22 with `--frozen-lockfile` going to the registry for an
unlocked resolution value.

The carried .npmrc keys change node_modules layout or peer strictness only. No carried key names a host, a path, a
credential or a command.

## Still refused (DEPS_PM_CONFIG, by design)

- packageExtensions and configDependencies.
- onFail download, or a missing onFail.
- Non-root `pnpm` fields and non-root resolutions.
- `$reference`, protocol or URL overrides, and overrides / patches that differ from the lockfile or appear in both
  places.
- sharedWorkspaceLockfile false, nodeLinker pnp, registries and pnpmfile keys.

Each has a refused near-miss case.

## Expectation change

Two m151 case expectations changed:

1. `m151-cases.ts` used to expect an empty root `pnpm: {}` field to be refused. M188 admits it, since pnpm reads
   nothing from an empty field, and the case now asserts null. The other `pnpm` field cases there are unchanged and
   still refused: a URL override, a nested field, and a nested field behind a BOM.
2. The pnpm-workspace.yaml case used `hoistPattern: ['*']` as its "a harmless-looking setting is still a setting"
   example. M188 admits hoistPattern as a layout pattern list, so the case now asserts it is admitted, and the
   refused example is `verifyStoreIntegrity: false` (a store-integrity setting M188 does not list).

## Tests

- `m188-pmconfig.test.ts` runs ten cases:
  - Admits on three synthetic shapes: a pnpm workspace, one pnpm package with a root field, and a yarn v1
    workspace.
  - A refused near-miss for every condition.
  - An install case on the candidate uid (stub package manager) checking that the carried .npmrc reaches the
    install tree, and that a carried setting or a patch change gets a new install while a dropped line does not.
- `m188-mutation.test.ts` deletes each `// m188-guard:<id>` line in turn (32 guards) and requires a case to fail an
  assertion. key-carry and npmrc-write need the candidate uid.
