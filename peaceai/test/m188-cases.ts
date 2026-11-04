// M188 (batch 23): package-manager settings PeaceAI's dependency install now vouches for instead of refusing them
// with DEPS_PM_CONFIG (spec: peaceai/spec/deps-pm-config-v1.md). Each admitted setting either only lays out / checks
// the locked tree, or must equal what the scanned lockfile records (pnpm refuses a frozen install whose overrides /
// patches differ: ERR_PNPM_LOCKFILE_CONFIG_MISMATCH). These cases admit three unrelated synthetic shapes (a pnpm
// workspace, a single pnpm package with a root `pnpm` field, a yarn v1 workspace) and refuse a near-miss for every
// condition; m188-mutation.test.ts replays them against mutants (one per m188 guard line). Synthetic fixtures only;
// no network; no practice-task shape.
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type * as Deps from "../lib/loopdeps.ts";
import type * as Loop from "../lib/loop.ts";
import type * as Row from "../lib/looprow.ts";
import { plain, repo, type Ctx } from "./m151-fixtures.ts";

export interface Libs { deps: typeof Deps; loop: typeof Loop; row: typeof Row }
export interface Case { id: string; needsCand?: string; run: (l: Libs, ctx: Ctx) => void }
const CAND_SKIP = "needs the stage-2 candidate uid (M151_CAND / M188_CAND)";

let n = 0;
const dir = (ctx: Ctx, name: string) => join(ctx.base, "m188", `${name}-${n++}`);
const REG = "https://registry.npmjs.org/";
const INT = "sha512-" + "B".repeat(86) + "==";

// ---- synthetic shape A: a pnpm workspace ("kite") with layout settings, overrides and a patch in pnpm-workspace.yaml
const PATCH = [
  "diff --git a/lib/walk.js b/lib/walk.js", "index 1111111..2222222 100644", "--- a/lib/walk.js", "+++ b/lib/walk.js",
  "@@ -1,3 +1,3 @@ module.exports", " const a = 1;", "-const depth = 8;", "+const depth = 16;", " module.exports = a;",
  "diff --git a/NOTES.md b/NOTES.md", "new file mode 100644", "index 0000000..3333333", "--- /dev/null", "+++ b/NOTES.md", "@@ -0,0 +1 @@", "+patched", "",
].join("\n");
const OVR_LOCK = ["overrides:", "  fs-walk: 2.0.1", "  tiny-glob>fs-walk: 2.0.1", "  '@kite/meter@<2': npm:@kite/meter-lite@^1.2.0", ""];
const PATCH_LOCK = ["patchedDependencies:", "  kite-core@3.1.4:", "    hash: abcdefabcdefabcdefabcdefab", "    path: patches/kite-core-3.1.4.patch", ""];
const pnpmLock = (extra: string[]) => [
  "lockfileVersion: '9.0'", "", "settings:", "  autoInstallPeers: true", "  excludeLinksFromLockfile: false", "", ...extra,
  "importers:", "", "  .:", "    dependencies:", "      kite-core:", "        specifier: ^3.1.0", "        version: 3.1.4", "",
  "packages:", "", "  kite-core@3.1.4:", `    resolution: {integrity: ${INT}}`, "", "  fs-walk@2.0.1:", `    resolution: {integrity: ${INT}}`, "",
  "snapshots:", "", "  kite-core@3.1.4: {}", "", "  fs-walk@2.0.1: {}", "",
].join("\n");
const WS_OVR = ["overrides:", "  fs-walk: 2.0.1", "  tiny-glob>fs-walk: 2.0.1", "  '@kite/meter@<2': npm:@kite/meter-lite@^1.2.0"];
const WS_PATCH = ["patchedDependencies:", "  kite-core@3.1.4: patches/kite-core-3.1.4.patch"];
const WS_LAYOUT = ["nodeLinker: hoisted", "autoInstallPeers: true", "strictPeerDependencies: false", "linkWorkspacePackages: deep", "savePrefix: '~'", "publicHoistPattern:", "  - '*eslint*'", "  - '!@kite/*'",
  "peerDependencyRules:", "  ignoreMissing:", "    - '@kite/ui-*'", "  allowedVersions:", "    react: '18'", "  allowAny:", "    - '@types/*'"];
const ws = (...extra: string[][]) => ["packages:", "  - 'apps/*'", "  - 'libs/*'", ...extra.flat(), ""].join("\n");
const KITE: Record<string, string> = {
  "package.json": JSON.stringify({ name: "kite-mono", private: true, packageManager: "pnpm@9.15.9", dependencies: { "kite-core": "^3.1.0" } }),
  "pnpm-lock.yaml": pnpmLock([...OVR_LOCK, ...PATCH_LOCK]),
  "pnpm-workspace.yaml": ws(WS_LAYOUT, WS_OVR, WS_PATCH),
  "patches/kite-core-3.1.4.patch": PATCH,
  "apps/board/package.json": JSON.stringify({ name: "@kite/board", version: "0.1.0", dependencies: { "@kite/meter": "workspace:*" } }),
  "libs/meter/package.json": JSON.stringify({ name: "@kite/meter", version: "0.1.0" }),
};
// ---- synthetic shape B: one pnpm package ("quill") with a root `pnpm` field and devEngines checks
const quillPkg = (pnpm: unknown, more: Record<string, unknown> = {}) => JSON.stringify({ name: "quill", version: "2.0.0", dependencies: { "kite-core": "^3.1.0" }, pnpm, ...more });
const QUILL_PNPM = { overrides: { "fs-walk": "2.0.1", "tiny-glob>fs-walk": "2.0.1", "@kite/meter@<2": "npm:@kite/meter-lite@^1.2.0" }, patchedDependencies: { "kite-core@3.1.4": "patches/kite-core-3.1.4.patch" }, peerDependencyRules: { ignoreMissing: ["vue"] }, onlyBuiltDependencies: ["esbuild"], allowedDeprecatedVersions: { request: "2" } };
const QUILL_DEV = { packageManager: { name: "pnpm", version: "^9.0.0", onFail: "error" }, runtime: [{ name: "node", version: ">=18", onFail: "warn" }] };
const QUILL: Record<string, string> = {
  "package.json": quillPkg(QUILL_PNPM, { devEngines: QUILL_DEV }),
  "pnpm-lock.yaml": pnpmLock([...OVR_LOCK, ...PATCH_LOCK]),
  "patches/kite-core-3.1.4.patch": PATCH,
};
// ---- synthetic shape C: a yarn v1 workspace ("lark") with root resolutions pinned to locked entries
const YARN_LOCK = [
  "# yarn lockfile v1", "", '"lark-color@^2.0.0", lark-color@2.4.1:', '  version "2.4.1"', `  resolved "${REG}lark-color/-/lark-color-2.4.1.tgz#${"1".repeat(40)}"`, `  integrity ${INT}`, "",
  '"@lark/tz@npm:tzlite@^1", tzlite@1.0.3:', '  version "1.0.3"', `  resolved "${REG}tzlite/-/tzlite-1.0.3.tgz"`, `  integrity ${INT}`, "",
].join("\n");
const larkPkg = (o: Record<string, unknown>) => JSON.stringify({ name: "lark", private: true, packageManager: "yarn@1.22.22", workspaces: ["pkgs/*"], dependencies: { "lark-color": "^2.0.0" }, ...o });
const LARK_RES = { "**/lark-color": "2.4.1", "pkgs-ui/@lark/tz": "npm:tzlite@^1", tzlite: "1.0.3" };
const LARK: Record<string, string> = {
  "package.json": larkPkg({ resolutions: LARK_RES, devEngines: { runtime: { name: "node", onFail: "ignore" }, packageManager: { name: "yarn", version: "1.x", onFail: "error" } } }),
  "yarn.lock": YARN_LOCK,
  "pkgs/ui/package.json": JSON.stringify({ name: "pkgs-ui", version: "1.0.0", dependencies: { "@lark/tz": "npm:tzlite@^1", "lark-color": "2.4.1" } }),
};

function problem(l: Libs, ctx: Ctx, files: Record<string, string>, name = "fx") {
  const d = plain(dir(ctx, name), files);
  const p = l.deps.pickLockfile(d);
  assert.ok(!("refuse" in p), `pickLockfile refused: ${JSON.stringify(p)}`);
  return l.deps.depsSourceProblem(d, p);
}
type YDoc = Parameters<typeof Deps.overridesOk>[1];
const lockDoc = (l: Libs, extra: string[]): YDoc => { const d = l.deps.pnpmParse(pnpmLock(extra)); assert.ok(d); return d; };
const ctxOf = (l: Libs, root: string, files: string[], extra: string[]) => ({ root, files, lock: lockDoc(l, extra) });

/** An install-time stub package manager that records the staging .npmrc (STUB_PM exits on any .npmrc). */
const STUB_M188 = [
  'import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";',
  "const [pm, ...args] = process.argv.slice(2);",
  'if (!args.includes("--ignore-scripts")) process.exit(3);',
  'if (pm !== "npm" && !args.includes("--frozen-lockfile")) process.exit(4);',
  'for (const f of [".yarnrc", ".yarnrc.yml", ".pnpmfile.cjs", ".pnpmfile.mjs", ".corepack.env"]) if (existsSync(f)) process.exit(5);',
  'mkdirSync("node_modules/kite-core", { recursive: true });',
  'writeFileSync("node_modules/.m188-npmrc", existsSync(".npmrc") ? readFileSync(".npmrc", "utf8") : "<none>");',
  "",
].join("\n");

export const CASES: Case[] = [
  {
    id: "admit: three synthetic shapes (pnpm workspace settings + overrides + patch; root pnpm field + devEngines; yarn v1 root resolutions + devEngines)",
    run(l, ctx) {
      assert.equal(problem(l, ctx, KITE, "kite"), null, "pnpm workspace (shape A)");
      assert.equal(problem(l, ctx, QUILL, "quill"), null, "root pnpm field (shape B)");
      assert.equal(problem(l, ctx, LARK, "lark"), null, "yarn v1 workspace (shape C)");
      assert.equal(problem(l, ctx, { ...QUILL, "package.json": quillPkg({}) }), null, "an empty pnpm field (pnpm reads nothing from it; m151-cases.ts now expects the same)");
      // layout-only workspace file, no lock-bound settings, no lock sections
      assert.equal(problem(l, ctx, { ...KITE, "pnpm-lock.yaml": pnpmLock([]), "pnpm-workspace.yaml": ws(WS_LAYOUT, ["sharedWorkspaceLockfile: true", "hoistPattern:", "  - '*'", "dedupePeerDependents: true"]) }), null, "layout settings only");
    },
  },
  {
    id: "pnpm layout settings: values outside the vetted set are refused (m188 ws-setting, layout-bool/enum/pattern)",
    run(l, ctx) {
      const bad: [string, string][] = [
        ["nodeLinker pnp", "nodeLinker: pnp"], ["sharedWorkspaceLockfile false (pnpm would read per-package lockfiles)", "sharedWorkspaceLockfile: false"],
        ["a boolean setting that is not a boolean", "autoInstallPeers: sometimes"], ["a hoist pattern as a scalar", "publicHoistPattern: '*'"],
        ["a hoist pattern with a space", "hoistPattern:\n  - 'a b'"], ["savePrefix >=", "savePrefix: '>='"],
      ];
      for (const [why, line] of bad) {
        assert.equal(problem(l, ctx, { ...KITE, "pnpm-lock.yaml": pnpmLock([]), "pnpm-workspace.yaml": ws([line]) }), "DEPS_PM_CONFIG", why);
        assert.equal(l.deps.pnpmWorkspaceAllowed(ws([line])), false, why);
      }
      for (const key of ["registries:\n  default: https://evil.example/", "packageExtensions:\n  a:\n    dependencies:\n      b: 1.0.0", "configDependencies:\n  x: 1.0.0+sha512-AA==", "executionEnv:\n  nodeVersion: 22.0.0", "pnpmfile: x.cjs"])
        assert.equal(l.deps.pnpmWorkspaceAllowed(ws([key])), false, `still refused: ${key.split(":")[0]}`);
    },
  },
  {
    id: "pnpm overrides: selector and value shapes, and equal entry for entry to the lockfile's (m188 ovr-key/value/equal)",
    run(l, ctx) {
      const cfg = { "fs-walk": "2.0.1", "tiny-glob>fs-walk": "2.0.1", "@kite/meter@<2": "npm:@kite/meter-lite@^1.2.0" };
      assert.equal(l.deps.overridesOk(cfg, lockDoc(l, OVR_LOCK)), true);
      assert.equal(l.deps.overridesOk({ "a>b": "-" }, lockDoc(l, ["overrides:", "  a>b: '-'", ""])), true, "'-' drops a dependency");
      // each refused value / key is also in the lockfile, so only the shape check refuses it
      const same = (k: string, v: string): YDoc => ({ ...lockDoc(l, []), overrides: { [k]: v } });
      for (const v of ["$fs-walk", "link:../walk", "file:./walk.tgz", "https://evil.example/w.tgz", "github:o/r", "latest", "workspace:*"]) assert.equal(l.deps.overridesOk({ "fs-walk": v }, same("fs-walk", v)), false, `value ${v}`);
      for (const k of ["a>b>c>d", "fs-walk@file:x", "../walk", "Fs Walk", "a@latest"]) assert.equal(l.deps.overridesOk({ [k]: "2.0.1" }, same(k, "2.0.1")), false, `key ${k}`);
      assert.equal(l.deps.overridesOk(cfg, lockDoc(l, [])), false, "no overrides in the lockfile");
      assert.equal(l.deps.overridesOk(cfg, lockDoc(l, OVR_LOCK.map((s) => s.replace("  fs-walk: 2.0.1", "  fs-walk: 2.0.2")))), false, "a different value in the lockfile");
      assert.equal(l.deps.overridesOk({ "fs-walk": "2.0.1" }, lockDoc(l, OVR_LOCK)), false, "the lockfile has more overrides");
      assert.equal(l.deps.overridesOk(cfg, null), false, "no lockfile read");
      assert.equal(problem(l, ctx, { ...KITE, "pnpm-lock.yaml": pnpmLock([...OVR_LOCK.map((s) => s.replace("tiny-glob>fs-walk", "tiny-glob>fs-walk-x")), ...PATCH_LOCK]) }), "DEPS_PM_CONFIG", "workspace overrides that differ from the lockfile");
      assert.equal(l.deps.pnpmWorkspaceAllowed(ws(WS_OVR)), false, "overrides without a lockfile to check them against");
    },
  },
  {
    id: "pnpm patches: a plain text diff inside the package, a regular file in the tree, the lockfile's keys (m188 patch-*)",
    run(l, ctx) {
      assert.equal(l.deps.patchTextOk(PATCH), true);
      assert.equal(l.deps.patchTextOk(PATCH.replace("index 1111111..2222222 100644\n", "similarity index 90%\nrename from lib/walk.js\nrename to lib/walk2.js\n")), true, "a rename inside the package");
      const bad: [string, string][] = [
        ["a git path that climbs out", PATCH.replace("diff --git a/lib/walk.js b/lib/walk.js", "diff --git a/lib/walk.js b/../../walk.js")],
        ["a ---/+++ path that climbs out", PATCH.replace("+++ b/lib/walk.js", "+++ b/../../../etc/x")],
        ["an absolute ---/+++ path", PATCH.replace("--- a/lib/walk.js", "--- /etc/passwd")],
        ["a rename out of the package", PATCH.replace("index 1111111..2222222 100644\n", "rename from lib/walk.js\nrename to ../walk.js\n")],
        ["a binary patch", PATCH.replace("index 1111111..2222222 100644\n", "GIT binary patch\nliteral 4\nLcmZ?l\n")],
        ["a truncated hunk (more lines promised than the file has)", PATCH.replace("@@ -0,0 +1 @@\n+patched\n", "@@ -0,0 +1,3 @@\n+patched")],
        ["CRLF", PATCH.replace(/\n/g, "\r\n")], ["no hunk at all", "diff --git a/x b/x\n"],
      ];
      for (const [why, t] of bad) assert.equal(l.deps.patchTextOk(t), false, why);
      const root = plain(dir(ctx, "patch"), { "repo/patches/p.patch": PATCH, "repo/patches/bad.patch": bad[0]![1], "outside.patch": PATCH });
      const r = join(root, "repo"), files = ["patches/p.patch", "patches/bad.patch"];
      const lock = (k: string) => lockDoc(l, ["patchedDependencies:", `  ${k}:`, "    hash: abc", "    path: x", ""]);
      assert.equal(l.deps.patchedOk(r, files, { "kite-core@3.1.4": "patches/p.patch" }, lock("kite-core@3.1.4")), true);
      assert.equal(l.deps.patchedOk(r, files, { "kite-core@3.1.4": "../outside.patch" }, lock("kite-core@3.1.4")), false, "a patch file outside the repo");
      assert.equal(l.deps.patchedOk(r, files, { "kite-core@3.1.4": "patches/missing.patch" }, lock("kite-core@3.1.4")), false, "not in the tree");
      assert.equal(l.deps.patchedOk(r, files, { "kite-core@3.1.4": "patches/bad.patch" }, lock("kite-core@3.1.4")), false, "a patch that fails patchTextOk");
      assert.equal(l.deps.patchedOk(r, files, { "kite-core@3.1.4": "patches/p.patch" }, lock("kite-core@3.1.5")), false, "the lockfile patches another key");
      assert.equal(l.deps.patchedOk(r, files, { "kite-core@3.1.4": "patches/p.patch" }, lockDoc(l, [])), false, "no patchedDependencies in the lockfile");
      assert.equal(problem(l, ctx, { ...KITE, "patches/kite-core-3.1.4.patch": bad[1]![1] }), "DEPS_PM_CONFIG", "the workspace shape with an escaping patch");
    },
  },
  {
    id: "pnpm peerDependencyRules: only ignoreMissing / allowAny / allowedVersions (m188 peer-key)",
    run(l) {
      assert.equal(l.deps.peerRulesOk({ ignoreMissing: ["a", "@s/*"], allowAny: ["b"], allowedVersions: { "x>react": "17 || 18" } }), true);
      assert.equal(l.deps.peerRulesOk({ ignoreMissing: ["a"], allowDeprecated: ["b"] }), false, "an unknown rule");
      assert.equal(l.deps.peerRulesOk({ allowedVersions: { react: "file:../react" } }), false, "a protocol in allowedVersions");
      assert.equal(l.deps.peerRulesOk({ ignoreMissing: "a" }), false, "not a list");
    },
  },
  {
    id: "root pnpm field: root only, vetted keys and values, not doubled in the workspace file (m188 field-*)",
    run(l, ctx) {
      const bad: [string, Record<string, string>][] = [
        ["a pnpm field in a nested package.json", { ...QUILL, "pkgs/a/package.json": JSON.stringify({ name: "a", pnpm: { onlyBuiltDependencies: ["esbuild"] } }) }],
        ["a layout setting pnpm does not read from the field", { ...QUILL, "package.json": quillPkg({ nodeLinker: "hoisted" }) }],
        ["packageExtensions (adds dependencies)", { ...QUILL, "package.json": quillPkg({ packageExtensions: { a: { dependencies: { b: "1.0.0" } } } }) }],
        ["configDependencies (fetches and runs)", { ...QUILL, "package.json": quillPkg({ configDependencies: { x: "1.0.0" } }) }],
        ["an override to a URL", { ...QUILL, "package.json": quillPkg({ ...QUILL_PNPM, overrides: { ...QUILL_PNPM.overrides, "fs-walk": "https://evil.example/w.tgz" } }) }],
        ["an override to a $reference", { ...QUILL, "package.json": quillPkg({ ...QUILL_PNPM, overrides: { ...QUILL_PNPM.overrides, "fs-walk": "$kite-core" } }) }],
        ["overrides in both the field and the workspace file", { ...QUILL, "pnpm-workspace.yaml": ws(WS_OVR) }],
        ["field overrides the lockfile does not have", { ...QUILL, "pnpm-lock.yaml": pnpmLock(PATCH_LOCK) }],
      ];
      for (const [why, files] of bad) assert.equal(problem(l, ctx, files), "DEPS_PM_CONFIG", why);
    },
  },
  {
    id: "devEngines: a package manager / runtime check that never downloads (m188 dev-*)",
    run(l, ctx) {
      const npmLock = JSON.stringify({ lockfileVersion: 3, packages: { "": {}, "node_modules/kite-core": { version: "3.1.4", resolved: `${REG}kite-core/-/kite-core-3.1.4.tgz`, integrity: INT } } });
      const p = (de: unknown) => problem(l, ctx, { "package.json": JSON.stringify({ name: "heron", devEngines: de }), "package-lock.json": npmLock });
      assert.equal(p({ packageManager: { name: "npm", onFail: "warn" }, runtime: { name: "node", version: "^20 || ^22", onFail: "error" } }), null);
      const bad: [string, unknown][] = [
        ["onFail download", { packageManager: { name: "pnpm", version: "^10", onFail: "download" } }],
        ["no onFail (corepack defaults differ by version)", { runtime: { name: "node", version: ">=20" } }],
        ["an unknown manager", { packageManager: { name: "bun", onFail: "error" } }],
        ["a runtime other than node", { runtime: { name: "deno", onFail: "warn" } }],
        ["a version tag", { packageManager: { name: "npm", version: "latest", onFail: "warn" } }],
        ["an extra key", { packageManager: { name: "npm", onFail: "warn", url: "https://evil.example/npm.tgz" } }],
        ["one bad entry in a list", { runtime: [{ name: "node", onFail: "warn" }, { name: "node", onFail: "download" }] }],
        ["not an object", { packageManager: "pnpm@10" }],
      ];
      for (const [why, de] of bad) assert.equal(p(de), "DEPS_PM_CONFIG", why);
      assert.equal(l.deps.devEnginesEntryOk("runtime", []), false, "an empty list");
    },
  },
  {
    id: "yarn v1 resolutions: root only, name paths, registry ranges that are yarn.lock headers (m188 res-*)",
    run(l, ctx) {
      const lock = new Set(["lark-color@2.4.1", "lark-color@file:../c", "**@1.0.0"]);
      assert.equal(l.deps.yarnResolutionsOk({ "**/lark-color": "2.4.1", "a/@s/b/lark-color": "2.4.1" }, lock), true);
      const bad: [string, Record<string, string>][] = [
        ["a key with a .. segment", { "../lark-color": "2.4.1" }], ["a key ending in **", { "a/**": "1.0.0" }],
        ["a protocol value (even with a lock header)", { "lark-color": "file:../c" }], ["a value with no lock header", { "lark-color": "2.4.2" }],
      ];
      for (const [why, r] of bad) assert.equal(l.deps.yarnResolutionsOk(r, lock), false, why);
      assert.equal(problem(l, ctx, { ...LARK, "package.json": larkPkg({ resolutions: { "**/lark-color": "2.4.2" } }) }), "DEPS_PM_CONFIG", "an unlocked resolution (yarn would fetch it)");
      assert.equal(problem(l, ctx, { ...LARK, "pkgs/ui/package.json": JSON.stringify({ name: "pkgs-ui", version: "1.0.0", resolutions: { "lark-color": "2.4.1" } }) }), "DEPS_PM_CONFIG", "resolutions in a workspace package");
    },
  },
  {
    id: ".npmrc: only vetted layout / peer settings are carried; registry, auth, scripts and env references are dropped (m188 npmrc-*)",
    run(l) {
      const text = ["; comment", "# comment", "legacy-peer-deps = true", "registry=https://evil.example/", "//evil.example/:_authToken=abc", "ignore-scripts=false", "node-linker=hoisted",
        "public-hoist-pattern[]=*types*", "public-hoist-pattern[]=*eslint*", "node-linker=pnp", "auto-install-peers=${CI}", "save-prefix=\"~\"", "strict-peer-dependencies=false", "script-shell=/bin/evil", "prefer-workspace-packages=yes", ""].join("\r\n");
      assert.equal(l.deps.npmrcCarry(text), "legacy-peer-deps=true\nnode-linker=hoisted\nstrict-peer-dependencies=false\npublic-hoist-pattern[]=*types*\npublic-hoist-pattern[]=*eslint*\n");
      assert.equal(l.deps.npmrcCarry("registry=https://evil.example/\n"), "");
      assert.equal(l.deps.npmrcCarry(null), "");
    },
  },
  {
    id: "install: the carried .npmrc reaches the install tree and is in the cache key, as is every patch file (m188 npmrc-write, key-carry)",
    needsCand: CAND_SKIP,
    run(l, ctx) {
      const stub = join(ctx.base, "m188-stub-pm.mjs");
      if (!existsSync(stub)) writeFileSync(stub, STUB_M188, { mode: 0o644 });
      const tool = (pm: string) => [process.execPath, stub, pm];
      const cache = l.deps.openDepsCache(ctx.base);
      try {
        let ran = 0;
        const go = (files: Record<string, string>) => {
          const d = repo(dir(ctx, "inst"), files);
          const r = l.deps.installDeps(d, ctx.cand!, cache, { tool, timeoutMs: 60_000, onInstall: () => { ran++; } });
          return { d, r };
        };
        const a = go({ ...KITE, ".npmrc": "registry=http://127.0.0.1:9/\nlegacy-peer-deps=true\n//127.0.0.1:9/:_authToken=x\n" });
        assert.deepEqual(a.r, { pm: "pnpm" }, "the workspace shape installs");
        assert.equal(readFileSync(join(a.d, "node_modules/.m188-npmrc"), "utf8"), "legacy-peer-deps=true\n", "only the carried line");
        go({ ...KITE, ".npmrc": "legacy-peer-deps=true\nregistry=http://127.0.0.1:8/\n" });
        assert.equal(ran, 1, "a dropped line does not change the install");
        const c = go({ ...KITE, ".npmrc": "legacy-peer-deps=false\n" });
        assert.equal(ran, 2, "a carried setting does");
        assert.equal(readFileSync(join(c.d, "node_modules/.m188-npmrc"), "utf8"), "legacy-peer-deps=false\n");
        go({ ...KITE, ".npmrc": "legacy-peer-deps=false\n", "patches/kite-core-3.1.4.patch": PATCH.replace("+patched", "+patched twice") });
        assert.equal(ran, 3, "a patch change does");
        const e = go({ ...QUILL });
        assert.deepEqual(e.r, { pm: "pnpm" }, "the root-field shape installs");
        assert.equal(readFileSync(join(e.d, "node_modules/.m188-npmrc"), "utf8"), "<none>", "no .npmrc without carried settings");
      } finally { cache.close(); }
    },
  },
];
