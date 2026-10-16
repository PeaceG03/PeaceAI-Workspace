import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const SCRIPT = resolve("peaceai/bin/stage-chosen.sh");
const git = (dir: string, ...a: string[]) => execFileSync("git", ["-C", dir, ...a], { encoding: "utf8" }).trim();

function repo(): string {
  const d = mkdtempSync(join(tmpdir(), "stage-chosen-"));
  git(d, "init", "-q");
  mkdirSync(join(d, "src"));
  mkdirSync(join(d, ".github/workflows"), { recursive: true });
  writeFileSync(join(d, "src/a.ts"), "export const a = 1;\n");
  writeFileSync(join(d, "package.json"), '{\n  "scripts": {\n    "typecheck": "tsc --noEmit"\n  }\n}\n');
  writeFileSync(join(d, ".github/workflows/ci.yml"), "name: ci\n");
  writeFileSync(join(d, "untracked-noise.txt"), "x\n");
  git(d, "add", "src", "package.json", ".github");
  git(d, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "base");
  return d;
}
/** Build a diff by editing, diffing (incl. new files), then resetting the worktree. */
function makeDiff(d: string, edit: () => void): string {
  edit();
  git(d, "add", "-N", ".");
  const diff = execFileSync("git", ["-C", d, "diff", "--", ".", ":!untracked-noise.txt"], { encoding: "utf8" });
  git(d, "reset", "-q");
  git(d, "checkout", "-q", "--", ".");
  spawnSync("git", ["-C", d, "clean", "-qfd", "-e", "untracked-noise.txt"]);
  const f = join(d, "..", `${d.split("/").pop()}.diff`);
  writeFileSync(f, diff);
  return f;
}
const run = (d: string, f: string) => {
  const ap = spawnSync("git", ["-C", d, "apply", "--whitespace=nowarn", f], { encoding: "utf8" });
  assert.equal(ap.status, 0, ap.stderr);
  return spawnSync("bash", [SCRIPT, f], { cwd: d, encoding: "utf8" });
};
const staged = (d: string) => git(d, "diff", "--cached", "--name-only").split("\n").filter(Boolean).sort();

test("tsconfig-script candidate (package.json + new tsconfig) is staged; untracked noise is not", () => {
  const d = repo();
  const f = makeDiff(d, () => {
    writeFileSync(join(d, "package.json"), '{\n  "scripts": {\n    "typecheck": "tsc --noEmit",\n    "typecheck:scanner": "tsc -p tsconfig.scanner.json --noEmit"\n  }\n}\n');
    writeFileSync(join(d, "tsconfig.scanner.json"), '{ "extends": "./tsconfig.json" }\n');
  });
  const r = run(d, f);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(staged(d), ["package.json", "tsconfig.scanner.json"]);
});

test("src candidate still staged (unchanged behaviour)", () => {
  const d = repo();
  const f = makeDiff(d, () => {
    writeFileSync(join(d, "src/a.ts"), "export const a = 2;\n");
    writeFileSync(join(d, "src/a.test.ts"), "// t\n");
  });
  const r = run(d, f);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(staged(d), ["src/a.test.ts", "src/a.ts"]);
});

test("workflow-file candidate is refused and nothing is staged", () => {
  const d = repo();
  const f = makeDiff(d, () => writeFileSync(join(d, ".github/workflows/ci.yml"), "name: ci2\n"));
  const r = run(d, f);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /refused: \.github\/workflows/);
  assert.deepEqual(staged(d), []);
});

test("empty diff fails closed", () => {
  const d = repo();
  const f = join(d, "..", "empty.diff");
  writeFileSync(f, "");
  const r = spawnSync("bash", [SCRIPT, f], { cwd: d, encoding: "utf8" });
  assert.notEqual(r.status, 0);
});

test("peace-verdict.yml: every build step stages via stage-chosen.sh and keeps the pre-apply workflow refusal", () => {
  const y = readFileSync(".github/workflows/peace-verdict.yml", "utf8");
  assert.ok(!/git add -A -- src/.test(y), "no src-only staging left");
  assert.equal((y.match(/tools\/peaceai\/bin\/stage-chosen\.sh" "\$RUNNER_TEMP\/chosen\/chosen\.diff"/g) ?? []).length, 3);
  assert.equal((y.match(/refused: \.github\/workflows\/\*\* goes in only through a normal PR that Architect merges/g) ?? []).length, 3);
});
