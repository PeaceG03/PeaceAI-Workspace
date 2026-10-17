// M77 (Auditor, before the next helpers/ self-zone landing): `npm run test:self` runs every *.test.ts under
// peaceai/self-tests, including peaceai/self-tests/helpers/** (where self-zone landings add their tests, e.g. #345),
// not only the top level. Proved by running the real script in a scratch tree with canary tests at every depth.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const SCRIPT = (JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as { scripts: Record<string, string> }).scripts["test:self"]!;
const canary = (name: string, ok = true) => `import test from "node:test";\nimport assert from "node:assert/strict";\ntest(${JSON.stringify(name)}, () => { assert.ok(${ok}); });\n`;

function runIn(files: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), "m77-"));
  try {
    for (const [p, c] of Object.entries(files)) { mkdirSync(join(dir, p, ".."), { recursive: true }); writeFileSync(join(dir, p), c); }
    symlinkSync(resolve(root, "node_modules"), join(dir, "node_modules"));
    const env: Record<string, string | undefined> = { ...process.env, PATH: `${resolve(root, "node_modules/.bin")}:${process.env.PATH ?? ""}` };
    delete env.NODE_TEST_CONTEXT; // run as a top-level test run so failures set the exit code
    const r = spawnSync("sh", ["-c", SCRIPT], { cwd: dir, env, encoding: "utf8" });
    return { code: r.status, out: `${r.stdout}${r.stderr}` };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

test("test:self picks up top-level, helpers/ and nested helpers/** tests, and nothing outside self-tests", () => {
  const r = runIn({
    "peaceai/self-tests/top.test.ts": canary("canary top"),
    "peaceai/self-tests/helpers/dates.canary.test.ts": canary("canary helpers"),
    "peaceai/self-tests/helpers/deep/more.test.ts": canary("canary helpers deep"),
    "peaceai/self-tests/helpers/dates.ts": "export const notATest = 1;\n",
    "peaceai/test/outside.test.ts": canary("canary outside"),
  });
  assert.equal(r.code, 0, r.out);
  for (const n of ["canary top", "canary helpers", "canary helpers deep"]) assert.match(r.out, new RegExp(`^ok \\d+ - ${n}$`, "m"), n);
  assert.doesNotMatch(r.out, /canary outside/);
  assert.match(r.out, /^# pass 3$/m);
});

test("a failing helpers/ test fails test:self", () => {
  const r = runIn({
    "peaceai/self-tests/top.test.ts": canary("canary top"),
    "peaceai/self-tests/helpers/broken.test.ts": canary("canary broken helper", false),
  });
  assert.notEqual(r.code, 0);
  assert.match(r.out, /^not ok \d+ - canary broken helper$/m);
});

test("the real tree: every *.test.ts under peaceai/self-tests is in test:self's file list", () => {
  const listed = spawnSync("sh", ["-c", "find peaceai/self-tests -name '*.test.ts' -type f | LC_ALL=C sort"], { cwd: root, encoding: "utf8" }).stdout.trim().split("\n").filter(Boolean);
  assert.ok(listed.includes("peaceai/self-tests/helpers.test.ts"));
  assert.ok(SCRIPT.includes("find peaceai/self-tests -name '*.test.ts' -type f | LC_ALL=C sort"));
  const tracked = spawnSync("git", ["-C", root, "ls-files", "peaceai/self-tests"], { encoding: "utf8" }).stdout.split("\n").filter((p) => p.endsWith(".test.ts"));
  for (const p of tracked) assert.ok(listed.includes(p), p);
});
