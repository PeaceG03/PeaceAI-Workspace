// M151 fixtures (loop v2): tiny synthetic repos and VENDORED stubs, built in one os.tmpdir() scratch dir, never
// inside this repository. No network: the package manager is a stub (a node script injected through
// DepsOptions.tool) and the "vitest" it installs is a tiny stub runner that writes a jest-format JSON report.
// Nothing here is modeled on a public task repo or a training repo.
//   stub pm:     refuses (exit 3) without --ignore-scripts, (exit 4) without --frozen-lockfile for pnpm / yarn,
//                (exit 5) when a package-manager config file (.npmrc ...) is present, (exit 6) for npm without
//                --allow-git/--allow-remote/--allow-file=none; records its uid, argv, the registry it was given and
//                whether sudo's variables leaked through (no env -i).
//                Modes (M151_STUB_PM): sleep (never ends), big (2 MiB file), fail (exit 1), none (no node_modules),
//                escape (leaves a setsid child running after it exits).
//   stub vitest: imports each test file (global test(name, fn)), counts, writes the report given by --outputFile.
//                Modes (M151_STUB_RUNNER, direct shim cases only): noreport, suitefail (a failed suite, yet success / exit 0),
//                exitonly (no failure in the report, exit 1).
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { PlanTask } from "../lib/plan.ts";
import { gitCopyFetcher, type CopyFetcher } from "../lib/loop.ts";
import { STAGE2_CAND_ENV, stage2CandUid, type CandUid } from "../lib/selfpropose.ts";

export const MIT = `MIT License\n\nCopyright (c) 2026 M151 fixture\n\nPermission is hereby granted, free of charge, to any person obtaining a copy of this software, to deal in the\nSoftware without restriction. THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND.\n`;
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const G = ["-c", "user.name=PeaceG03", "-c", "user.email=301894882+PeaceG03@users.noreply.github.com", "-c", "commit.gpgsign=false"];
const git = (cwd: string, ...a: string[]) => execFileSync("git", [...G, ...a], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
const put = (dir: string, files: Record<string, string>) => { for (const [p, c] of Object.entries(files)) { mkdirSync(dirname(join(dir, p)), { recursive: true }); writeFileSync(join(dir, p), c); } };

/** A one-commit git repo (installDeps reads the tracked tree). */
export function repo(dir: string, files: Record<string, string>): string {
  mkdirSync(dir, { recursive: true });
  git(dir, "init", "-q", "-b", "main");
  put(dir, files);
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "base");
  chmodSync(dir, 0o755);
  return dir;
}
/** A plain dir (detectRunner / pickLockfile only read files). */
export function plain(dir: string, files: Record<string, string>): string { mkdirSync(dir, { recursive: true }); put(dir, files); return dir; }

export const ESCAPEE = "m151-escapee";
export const STUB_PM = [
  'import { spawn } from "node:child_process";',
  'import { cpSync, existsSync, mkdirSync, writeFileSync } from "node:fs";',
  "const [pm, ...args] = process.argv.slice(2);",
  'if (!args.includes("--ignore-scripts")) process.exit(3);',
  'if (pm !== "npm" && !args.includes("--frozen-lockfile")) process.exit(4);',
  'if (pm === "npm" && !["--allow-git=none", "--allow-remote=none", "--allow-file=none"].every((f) => args.includes(f))) process.exit(6);',
  'for (const f of [".npmrc", ".yarnrc", ".yarnrc.yml", ".pnpmfile.cjs", ".pnpmfile.mjs"]) if (existsSync(f)) process.exit(5);',
  'const mode = process.env.M151_STUB_PM || "";',
  'if (mode === "sleep") await new Promise((r) => setTimeout(r, 3_600_000));',
  'if (mode === "fail") process.exit(1);',
  'if (mode === "none") process.exit(0);',
  `if (mode === "escape") spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)", "${ESCAPEE}"], { detached: true, stdio: "ignore" }).unref();`,
  'mkdirSync("node_modules", { recursive: true });',
  'if (process.env.M151_STUB_VITEST_DIR) cpSync(process.env.M151_STUB_VITEST_DIR, "node_modules/vitest", { recursive: true });',
  'writeFileSync("node_modules/.m151-uid", String(process.getuid()));',
  'writeFileSync("node_modules/.m151-argv", JSON.stringify([pm, ...args]));',
  'writeFileSync("node_modules/.m151-env", JSON.stringify({ registry: process.env.npm_config_registry ?? null, sudoVars: Object.keys(process.env).filter((k) => k.startsWith("SUDO_")).length }));',
  'if (mode === "big") writeFileSync("node_modules/big.bin", Buffer.alloc(2 << 20));',
  "",
].join("\n");

export const STUB_VITEST_CLI = [
  'import { writeFileSync } from "node:fs";',
  'import { resolve } from "node:path";',
  'import { pathToFileURL } from "node:url";',
  "const args = process.argv.slice(2);",
  'const out = args.find((a) => a.startsWith("--outputFile="))?.slice("--outputFile=".length);',
  'const files = args.filter((a) => a !== "run" && !a.startsWith("-"));',
  'const mode = process.env.M151_STUB_RUNNER || "";',
  'if (mode === "noreport") process.exit(1);',
  "const tests = [];",
  "globalThis.test = (name, fn) => tests.push([name, fn]);",
  "let pass = 0, fail = 0, suites = 0;",
  "for (const f of files) {",
  "  try { await import(pathToFileURL(resolve(f)).href); } catch { suites++; tests.length = 0; continue; }",
  "  for (const [, fn] of tests.splice(0)) { try { await fn(); pass++; } catch { fail++; } }",
  "}",
  'if (mode === "suitefail") { fail = 0; suites = 1; }',
  "const rep = { numPassedTests: pass, numFailedTests: fail, numFailedTestSuites: suites, success: fail === 0 && suites === 0 };",
  'if (mode === "exitonly") { rep.numFailedTests = 0; rep.numFailedTestSuites = 0; rep.success = true; }',
  '// suitefail: a runner that reports a failed suite but says success and exits 0 (each shim guard stands alone)',
  'if (mode === "suitefail") rep.success = true;',
  "if (out) writeFileSync(out, JSON.stringify(rep));",
  'process.exit(mode === "exitonly" ? 1 : mode === "suitefail" ? 0 : fail || suites ? 1 : 0);',
  "",
].join("\n");

const VITEST_PKG = JSON.stringify({ name: "vitest", version: "1.0.0", type: "module", bin: { vitest: "cli.mjs" } }) + "\n";
const LOCK_NPM = JSON.stringify({ name: "fixture", lockfileVersion: 3, requires: true, packages: { "": { name: "fixture", devDependencies: { vitest: "1.0.0" } } } }, null, 1) + "\n";
export const pkgJson = (scripts: Record<string, string>, devDependencies: Record<string, string> = {}) => JSON.stringify({ name: "fixture", private: true, type: "module", scripts, devDependencies }, null, 1) + "\n";

export const ADD_FIXED = "export function add(a, b) {\n  return a + b;\n}\nexport function sub(a, b) {\n  return a - b;\n}\n";
/** Team tests pass, but the existing sub() test (related by import) breaks. */
export const ADD_FIXED_SUB_BROKEN = "export function add(a, b) {\n  return a + b;\n}\nexport function sub(a, b) {\n  return a + b;\n}\n";

export interface Ctx {
  base: string;
  cand: CandUid | null;
  env: Record<string, string | undefined>;
  stubPm: string;
  stubVitest: string;
  tool: (pm: string, version: string | null) => string[];
  root: string;
  fetcher: CopyFetcher;
  /** vitest repo: add() subtracts; team test wants a sum (1 of 2 team tests fails at base). */
  vitest: PlanTask;
  /** same, but the package's test script runs mocha (refused before any install). */
  mocha: PlanTask;
  /** same, but there is no lockfile (refused with DEPS_NO_LOCKFILE). */
  nolock: PlanTask;
}

function task(id: string, name: string, pins: { commit: string; merge: string }): PlanTask {
  const src = "src/calc.ts", test = "test/calc.test.ts";
  return {
    id, repo: `m151-fixture/${name}`, license: "MIT", licensePath: "LICENSE", licenseSha256: sha(MIT), commit: pins.commit,
    request: "Fix add in src/calc.ts so that it returns the sum of its two arguments.",
    tests: { command: "vitest run", files: [test] },
    reference: { from: { pr: 1, merge: pins.merge }, files: [{ path: src, change: "modify" }, { path: test, change: "add" }],
      steps: [{ action: "edit-source", file: src }, { action: "add-test", file: test }, { action: "run-tests", file: null }], docs: [] },
    trainingCheck: { workspaceCommit: "0".repeat(40), sources: 0, inTraining: false },
  };
}

function twoCommits(dir: string, base: Record<string, string>, merge: Record<string, string>): { commit: string; merge: string } {
  repo(dir, base);
  const commit = git(dir, "rev-parse", "HEAD");
  put(dir, merge); git(dir, "add", "-A"); git(dir, "commit", "-q", "-m", "reference");
  return { commit, merge: git(dir, "rev-parse", "HEAD") };
}

export function setup(): Ctx {
  const base = mkdtempSync(join(tmpdir(), "peaceai-m151-"));
  chmodSync(base, 0o755);
  const stubPm = join(base, "stub-pm.mjs");
  writeFileSync(stubPm, STUB_PM);
  const stubVitest = join(base, "stub-vitest");
  mkdirSync(stubVitest);
  writeFileSync(join(stubVitest, "package.json"), VITEST_PKG);
  writeFileSync(join(stubVitest, "cli.mjs"), STUB_VITEST_CLI);
  execFileSync("chmod", ["-R", "a+rX", base]);
  const env = { ...process.env, [STAGE2_CAND_ENV]: process.env.M151_CAND ?? process.env.M146_CAND ?? "peaceai-cand" };
  const c = stage2CandUid(env);
  const srcBase = "export function add(a, b) {\n  return a - b;\n}\nexport function sub(a, b) {\n  return a - b;\n}\n";
  const teamTest = 'import assert from "node:assert/strict";\nimport { add } from "../src/calc.ts";\n\ntest("add sums two numbers", () => assert.equal(add(2, 3), 5));\ntest("add keeps the first number for zero", () => assert.equal(add(2, 0), 2));\n';
  const subTest = 'import assert from "node:assert/strict";\nimport { sub } from "../src/calc.ts";\n\ntest("sub subtracts", () => assert.equal(sub(5, 3), 2));\n';
  const files = (scripts: Record<string, string>, lock: boolean) => ({
    "package.json": pkgJson(scripts, { vitest: "1.0.0" }), LICENSE: MIT, "src/calc.ts": srcBase, "test/sub.test.ts": subTest,
    ...(lock ? { "package-lock.json": LOCK_NPM } : {}),
  });
  const mk = (name: string, scripts: Record<string, string>, lock = true) => task(`m151-${name}`, name, twoCommits(join(base, "repos", name), files(scripts, lock), { "src/calc.ts": ADD_FIXED, "test/calc.test.ts": teamTest }));
  const vitest = mk("vitest", { test: "vitest run" });
  const mocha = mk("mocha", { test: "mocha test" });
  const nolock = mk("nolock", { test: "vitest run" }, false);
  const root = join(base, "root");
  mkdirSync(join(root, "peaceai/plan"), { recursive: true });
  git(root, "init", "-q", "-b", "main");
  return {
    base, env, stubPm, stubVitest, root, vitest, mocha, nolock,
    cand: c.ok ? c.cand : null,
    tool: (pm) => [process.execPath, stubPm, pm],
    fetcher: gitCopyFetcher((r) => join(base, "repos", r.split("/")[1]!)),
  };
}

export function teardown(ctx: Ctx): void {
  execFileSync("sudo", ["-n", "rm", "-rf", "--", ctx.base], { stdio: "ignore" });
  rmSync(ctx.base, { recursive: true, force: true });
}
