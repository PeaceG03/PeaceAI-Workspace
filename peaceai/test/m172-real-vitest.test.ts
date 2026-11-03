// M172 (batch 11, Auditor item): the batch-10 vitest < 2 path (spec: peaceai/spec/loop-runners-v2.md) against a REAL
// vitest 1.6.0, not the stub. The fixture is a pinned lockfile (peaceai/test/fixtures/m172-real-vitest1, integrity
// hashes from the registry), installed with `npm ci --ignore-scripts` into a temp dir; node_modules is then made
// read-only, as in the loop copy. The real CLI exits 1 there (its results-cache write fails: the cause batch 10
// fixed); the shim's node-API run scores the same run correctly. Needs the npm registry: in CI (CI=true) an install
// failure fails the test; elsewhere (an offline box) it is skipped. No candidate uid needed (the shim runs directly).
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { installShim, shimArgs } from "../lib/loopdeps.ts";

const FIXTURE = resolve(import.meta.dirname, "fixtures/m172-real-vitest1");
const dir = mkdtempSync(join(tmpdir(), "peaceai-m172-rv-"));
after(() => { spawnSync("chmod", ["-R", "u+w", dir]); rmSync(dir, { recursive: true, force: true }); });

cpSync(FIXTURE, dir, { recursive: true });
const install = spawnSync("npm", ["ci", "--ignore-scripts", "--no-audit", "--no-fund", "--loglevel=error"], { cwd: dir, encoding: "utf8", timeout: 300_000 });
const installed = install.status === 0;
const skip = installed ? false : process.env.CI === "true" ? false : `npm ci failed (no registry?): ${String(install.stderr).slice(0, 200)}`;

const OK = 'import { test, expect } from "vitest";\ntest("a", () => expect(1).toBe(1));\ntest("b", () => expect(2).toBe(2));\n';
const ONE_FAIL = 'import { test, expect } from "vitest";\ntest("a", () => expect(1).toBe(1));\ntest("b", () => expect(2).toBe(3));\n';
let setUp = false;
function ready() {
  assert.ok(installed, `npm ci of the pinned vitest 1.6.0 failed: ${install.stderr}`);
  if (setUp) return;
  mkdirSync(join(dir, "test"));
  writeFileSync(join(dir, "test/ok.test.mjs"), OK);
  writeFileSync(join(dir, "test/fail.test.mjs"), ONE_FAIL);
  installShim(dir);
  mkdirSync(join(dir, ".tmp"));
  spawnSync("chmod", ["-R", "a-w", join(dir, "node_modules")]);
  setUp = true;
}
const env = () => ({ PATH: process.env.PATH, TMPDIR: join(dir, ".tmp") });
const shim = (file: string) => {
  const r = spawnSync(process.execPath, shimArgs({ runner: "vitest", pkgDir: "", files: [file], hasDeps: true }), { cwd: dir, encoding: "utf8", env: env(), timeout: 120_000 });
  return (r.stdout ?? "").trimEnd().split("\n").slice(-2).join("\n");
};

test("M172 real vitest 1.6.0: the CLI run in a read-only node_modules exits 1 even when every test passes (the batch-10 cause)", { skip }, () => {
  ready();
  const r = spawnSync(process.execPath, ["node_modules/vitest/vitest.mjs", "run", "test/ok.test.mjs"], { cwd: dir, encoding: "utf8", env: env(), timeout: 120_000 });
  assert.notEqual(r.status, 0);
});

test("M172 real vitest 1.6.0: the shim credits a passing run (node API, cache off) and still counts a failing test", { skip }, () => {
  ready();
  assert.equal(shim("test/ok.test.mjs"), "# pass 2\n# fail 0");
  assert.equal(shim("test/fail.test.mjs"), "# pass 1\n# fail 1");
});
