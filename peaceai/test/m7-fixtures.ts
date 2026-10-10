// Shared fixtures for the M7/M7.1 harness, re-gate and record tests (not a test file itself).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

export const repo = resolve(import.meta.dirname, "../..");
export const tsx = join(repo, "node_modules/.bin/tsx");
export const sha = (t: string) => createHash("sha256").update(t).digest("hex");
export const TSCONFIG = JSON.stringify({
  compilerOptions: { target: "ES2022", module: "ESNext", moduleResolution: "Bundler", strict: true, noEmit: true, skipLibCheck: true, allowImportingTsExtensions: true, types: ["node"] },
  include: ["src/**/*.ts"],
});

export const THEME = [
  "export type Theme = {",
  "  readonly name: string;",
  "  readonly dark: boolean;",
  "};",
  "",
  "export const DEFAULT_THEME: Theme = {",
  '  name: "plain",',
  "  dark: false,",
  "};",
  "",
  "export function themeLabel(theme: Theme): string {",
  "  return theme.dark ? `${theme.name} (dark)` : theme.name;",
  "}",
  "",
].join("\n");
export const THEME_TEST = 'import assert from "node:assert/strict";\nimport test from "node:test";\nimport { DEFAULT_THEME, themeLabel } from "./theme";\n\ntest("label", () => {\n  assert.equal(themeLabel(DEFAULT_THEME), "plain");\n});\n';
export const PROFILE = "export type Profile = {\n  readonly id: string;\n};\n";
export const PROFILE_TEST = 'import assert from "node:assert/strict";\nimport test from "node:test";\nimport type { Profile } from "./profile";\n\ntest("profile literal", () => {\n  const p: Profile = { id: "x" };\n  assert.equal(p.id, "x");\n});\n';

export function harnessFixture() {
  const dir = mkdtempSync(join(tmpdir(), "m7-job-b-"));
  const ws = join(dir, "ws");
  mkdirSync(join(ws, "src"), { recursive: true });
  writeFileSync(join(ws, "src/theme.ts"), THEME);
  writeFileSync(join(ws, "src/theme.test.ts"), THEME_TEST);
  writeFileSync(join(ws, "src/profile.ts"), PROFILE);
  writeFileSync(join(ws, "src/profile.test.ts"), PROFILE_TEST);
  writeFileSync(join(ws, "tsconfig.json"), TSCONFIG);
  writeFileSync(join(ws, ".gitignore"), "node_modules\n");
  symlinkSync(join(repo, "node_modules"), join(ws, "node_modules"));
  const g = (...args: string[]) => {
    const r = spawnSync("git", ["-c", "user.name=T", "-c", "user.email=1+t@users.noreply.github.com", ...args], { cwd: ws, encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout;
  };
  g("init", "-q");
  g("add", "-A");
  g("commit", "-q", "-m", "base");
  const baseSha = g("rev-parse", "HEAD").trim();
  /** Makes a candidate diff by editing the tree, then restores it. */
  const candidate = (edit: Record<string, string>) => {
    for (const [p, c] of Object.entries(edit)) writeFileSync(join(ws, p), c);
    g("add", "-A", "-N", "--", ...Object.keys(edit));
    const diff = g("diff", "--no-color", "--full-index", "--no-renames");
    g("reset", "-q", "--hard");
    g("clean", "-fdq");
    return diff;
  };
  return { dir, ws, baseSha, candidate };
}

export function runJobB(fx: ReturnType<typeof harnessFixture>, diffs: string[], extraEnv: Record<string, string> = {}) {
  const inDir = join(fx.dir, "in");
  const out = join(fx.dir, "out");
  mkdirSync(join(inDir, "candidates"), { recursive: true });
  mkdirSync(out, { recursive: true });
  const candidates = diffs.map((d, i) => {
    writeFileSync(join(inDir, "candidates", `candidate-${i + 1}.diff`), d);
    return { id: `candidate-${i + 1}`, file: `candidates/candidate-${i + 1}.diff`, transformations: ["ADD_TYPE_FIELD"], operationId: null, diffBytes: Buffer.byteLength(d), diffLines: 3 };
  });
  writeFileSync(join(inDir, "summary.json"), JSON.stringify({ schema: "peaceai-workspace-candidates:v1", taskId: "workspace-issue-7", baseSha: fx.baseSha, candidates }));
  const env: Record<string, string> = { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "/tmp", PEACEAI_IN_DIR: inDir, PEACEAI_RESULTS_FILE: join(out, "r.json"), PEACEAI_WORKSPACE_DIR: fx.ws, ...extraEnv };
  const r = spawnSync(tsx, [join(repo, "peaceai/bin/test-candidates.ts")], { cwd: repo, encoding: "utf8", env, timeout: 300_000 });
  assert.equal(r.status, 0, r.stderr);
  const results = JSON.parse(readFileSync(join(out, "r.json"), "utf8")).results;
  const repairOf = (id: string) => (existsSync(join(out, "repair", `${id}.json`)) ? JSON.parse(readFileSync(join(out, "repair", `${id}.json`), "utf8")) : null);
  return { results, repairOf, out, stdout: r.stdout, inDir };
}

export function b2Fixture(repairedLine: string, opts: { tamper?: boolean; twin?: boolean } = {}) {
  const fx = harnessFixture();
  const diff = fx.candidate({ "src/theme.ts": THEME.replace("  readonly dark: boolean;\n", "  readonly dark: boolean;\n  readonly accent: string;\n") });
  const repaired = fx.candidate({ "src/theme.ts": THEME.replace("  readonly dark: boolean;\n", "  readonly dark: boolean;\n  readonly accent: string;\n").replace("  dark: false,\n", `  dark: false,\n  ${repairedLine}\n`) });
  const inDir = join(fx.dir, "in");
  const testDir = join(fx.dir, "tests");
  mkdirSync(join(inDir, "candidates"), { recursive: true });
  mkdirSync(join(testDir, "repair"), { recursive: true });
  writeFileSync(join(inDir, "candidates", "candidate-1.diff"), diff);
  // twin: a second candidate generated already equal to candidate-1's repaired diff (no repair needed).
  const candidates = [{ id: "candidate-1", file: "candidates/candidate-1.diff", transformations: ["ADD_TYPE_FIELD"], operationId: null, diffBytes: Buffer.byteLength(diff), diffLines: 1 }];
  const results = [{ id: "candidate-1", diffBytes: Buffer.byteLength(repaired), diffLines: 2, applied: true, typecheckPassed: true, originalSuitePassed: true, newTestsPassed: true, newTestFiles: 0 }];
  if (opts.twin) {
    writeFileSync(join(inDir, "candidates", "candidate-2.diff"), repaired);
    candidates.push({ id: "candidate-2", file: "candidates/candidate-2.diff", transformations: ["ADD_TYPE_FIELD"], operationId: null, diffBytes: Buffer.byteLength(repaired), diffLines: 2 });
    results.push({ ...results[0]!, id: "candidate-2" });
  }
  writeFileSync(join(inDir, "summary.json"), JSON.stringify({ schema: "peaceai-workspace-candidates:v1", taskId: "workspace-issue-7", baseSha: fx.baseSha, candidates }));
  writeFileSync(join(testDir, "candidate-1.json"), JSON.stringify({ schema: "peaceai-workspace-results:v1", taskId: "workspace-issue-7", baseSha: fx.baseSha, results }));
  const rec = {
    schema: "peaceai-repair:v1", id: "candidate-1", stop: "GREEN", rounds: 1,
    originalDiffSha256: sha(diff), repairedDiffSha256: sha(repaired), jobBGate: "pass",
    original: { typecheckPassed: false, originalSuitePassed: false, newTestsPassed: false }, originalNewTestFiles: 0,
    iterations: [
      { round: 0, typecheck: false, originalSuite: false, newTests: false, errorCount: 1, errors: [{ source: "tsc", kind: "missing-property", code: "TS2741", file: "src/theme.ts", line: 6, col: 14, message: "m" }], applied: [{ rule: "ADD_MISSING_REQUIRED_PROPERTY", path: "src/theme.ts", line: 6, placeholder: true }] },
      { round: 1, typecheck: true, originalSuite: true, newTests: true, errorCount: 0, errors: [], applied: [] },
    ],
  };
  writeFileSync(join(testDir, "repair", "candidate-1.json"), JSON.stringify(rec));
  writeFileSync(join(testDir, "repair", "candidate-1.diff"), opts.tamper ? repaired.replace("accent", "acc3nt") : repaired);
  const core = join(fx.dir, "core");
  mkdirSync(join(core, "lib"), { recursive: true });
  writeFileSync(join(core, "lib", "core.ts"), `export const coreMarker = "  ${repairedLine.includes("CORE") ? repairedLine : "nothing in common with the candidate at all, really"}";\n${repairedLine}\n`);
  spawnSync("git", ["init", "-q"], { cwd: core });
  spawnSync("git", ["add", "-A"], { cwd: core });
  return { fx, inDir, testDir, core, diff, repaired, final: join(fx.dir, "final") };
}

export function runB2(b: ReturnType<typeof b2Fixture>) {
  const r = spawnSync(tsx, [join(repo, "peaceai/bin/regate.ts")], {
    cwd: repo, encoding: "utf8",
    env: { ...process.env, PEACEAI_IN_DIR: b.inDir, PEACEAI_TESTRESULTS_DIR: b.testDir, PEACEAI_FINAL_DIR: b.final, PEACEAI_WORKSPACE_DIR: b.fx.ws, PEACEAI_CORE_DIR: b.core, PEACEAI_TARGET: "" },
  });
  assert.equal(r.status, 0, r.stderr);
  const summary = JSON.parse(readFileSync(join(b.final, "summary.json"), "utf8"));
  const results = JSON.parse(readFileSync(join(b.final, "testresults", "results.json"), "utf8")).results;
  const rec = JSON.parse(readFileSync(join(b.final, "testresults", "repair", "candidate-1.json"), "utf8"));
  return { summary, results, rec, diff: readFileSync(join(b.final, "candidates", "candidate-1.diff"), "utf8"), stdout: r.stdout };
}

