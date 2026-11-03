// M172 batch 11 fix (Auditor B2): the mocha shim against a REAL mocha 10.8.2, not the stub. The fixture is a pinned
// lockfile (peaceai/test/fixtures/m172-real-mocha10, integrity hashes from the registry), installed with
// `npm ci --ignore-scripts` into a temp dir. Real mocha (lib/runnable.js) treats a Pending thrown by a test without
// this.skip() as a clean finish, so code under test could turn its own failing test into a pass; this test shows that
// hazard on the raw CLI, shows the shim (with PeaceAI's pending guard, loopdeps.ts MOCHA_GUARD_SOURCE) fails such a test,
// refuses to credit a run with a pending test or with tests != passes + failures, and counts two failures as two.
// Mutation checks run here too, against the same real mocha: each `m172-pend-guard` line of the guard and the
// shim's `m172-guard:shim-mocha-total` line (and it with shim-mocha-pending) are deleted in turn and a case must change.
// Needs the npm registry: in CI (CI=true) an install failure fails the test; elsewhere (an offline box) it is skipped.
// No candidate uid needed (the shim runs directly). Spec: peaceai/spec/loop-runners-v3.md.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { installShim, MOCHA_GUARD_PATH, MOCHA_GUARD_SOURCE, SHIM_PATH, SHIM_SOURCE } from "../lib/loopdeps.ts";

const FIXTURE = resolve(import.meta.dirname, "fixtures/m172-real-mocha10");
const dir = mkdtempSync(join(tmpdir(), "peaceai-m172-rm-"));
after(() => { spawnSync("chmod", ["-R", "u+w", dir]); rmSync(dir, { recursive: true, force: true }); });

cpSync(FIXTURE, dir, { recursive: true });
const install = spawnSync("npm", ["ci", "--ignore-scripts", "--no-audit", "--no-fund", "--loglevel=error"], { cwd: dir, encoding: "utf8", timeout: 300_000 });
const installed = install.status === 0;
const skip = installed ? false : process.env.CI === "true" ? false : `npm ci failed (no registry?): ${String(install.stderr).slice(0, 200)}`;

// code under test that throws mocha's own Pending (as `require("mocha/lib/pending")`) inside a test that should fail
const FILES: Record<string, string> = {
  "test/ok.test.js": 'it("a", () => {});\nit("b", () => {});\n',
  "test/sneaky.test.js": 'const assert = require("node:assert");\nconst Pending = require("mocha/lib/pending");\nfunction underTest(x) { if (x !== 2) throw new Pending("hidden"); return x; }\nit("ok", () => {});\nit("wrong", () => { assert.equal(underTest(1), 2); });\n',
  "test/sneaky-async.test.js": 'const Pending = require("mocha/lib/pending");\nit("ok", () => {});\nit("wrong", async () => { await null; throw new Pending("hidden"); });\n',
  "test/sneaky-hook.test.js": 'const Pending = require("mocha/lib/pending");\ndescribe("s", () => { beforeEach(() => { throw new Pending("hidden"); }); it("wrong", () => { throw new Error("never reached"); }); });\nit("ok", () => {});\n',
  "test/skip.test.js": 'it("ok", () => {});\nit("skipped", function () { this.skip(); });\n',
  "test/skip-done.test.js": 'it("ok", () => {});\nit("skipped", function (done) { this.skip(); });\n',
  "test/two-fail.test.js": 'it("ok", () => {});\nit("f1", () => { throw new Error("a"); });\nit("f2", () => { throw new Error("b"); });\n',
  "test/hook-fail.test.js": 'it("ok", () => {});\ndescribe("s", () => { before(() => { throw new Error("setup"); }); it("never", () => {}); });\n',
};
let setUp = false;
function ready() {
  assert.ok(installed, `npm ci of the pinned mocha 10.8.2 failed: ${install.stderr}`);
  if (setUp) return;
  mkdirSync(join(dir, "test"));
  for (const [p, c] of Object.entries(FILES)) writeFileSync(join(dir, p), c);
  mkdirSync(join(dir, ".tmp"));
  setUp = true;
}
const env = () => ({ PATH: process.env.PATH, TMPDIR: join(dir, ".tmp") });
/** Runs the shim on one file with the given shim / guard sources installed; the last two lines of its output. */
function shim(file: string, src = { shim: SHIM_SOURCE, guard: MOCHA_GUARD_SOURCE }): string {
  installShim(dir);
  writeFileSync(join(dir, SHIM_PATH), src.shim);
  writeFileSync(join(dir, MOCHA_GUARD_PATH), src.guard);
  const r = spawnSync(process.execPath, [SHIM_PATH, "mocha", "", "--", file], { cwd: dir, encoding: "utf8", env: env(), timeout: 120_000 });
  return (r.stdout ?? "").trimEnd().split("\n").slice(-2).join("\n");
}
const P = (pass: number, fail: number) => `# pass ${pass}\n# fail ${fail}`;
const EXPECT: Record<string, string> = {
  "test/ok.test.js": P(2, 0),
  "test/sneaky.test.js": P(1, 1),
  "test/sneaky-async.test.js": P(1, 1),
  "test/sneaky-hook.test.js": P(0, 1), // the hook fails: one failure, and the skipped test is not counted (fail closed)
  "test/skip.test.js": P(0, 1),
  "test/skip-done.test.js": P(0, 1),
  "test/two-fail.test.js": P(1, 2),
  "test/hook-fail.test.js": P(0, 1),
};

test("M172 real mocha 10.8.2: the raw CLI counts a test that ends in a thrown Pending (no this.skip()) as passed (the hazard)", { skip }, () => {
  ready();
  const out = join(dir, ".tmp", "raw.json");
  spawnSync(process.execPath, ["node_modules/mocha/bin/mocha.js", "--no-config", "--no-package", "--reporter", "json", "--reporter-option", `output=${out}`, "test/sneaky.test.js"], { cwd: dir, encoding: "utf8", env: env(), timeout: 120_000 });
  const stats = JSON.parse(spawnSync("cat", [out], { encoding: "utf8" }).stdout).stats;
  assert.deepEqual([stats.tests, stats.passes, stats.failures, stats.pending], [2, 2, 0, 0]);
});

test("M172 real mocha 10.8.2: the shim fails an unsanctioned Pending (sync, async, in a hook), credits no run with a pending test or a test count mismatch, counts two failures as two", { skip }, () => {
  ready();
  for (const [file, want] of Object.entries(EXPECT)) assert.equal(shim(file), want, file);
});

// mutation checks against the same real mocha
const lines = (s: string) => s.split("\n");
const without = (s: string, tag: RegExp) => { const ls = lines(s); const i = ls.findIndex((l) => tag.test(l)); assert.ok(i >= 0, `no line ${tag}`); return ls.filter((_, j) => j !== i).join("\n"); };
const PEND_TAGS = lines(MOCHA_GUARD_SOURCE).flatMap((l) => { const m = /\/\/ m172-pend-guard:([a-z-]+)/.exec(l); return m ? [m[1]!] : []; });

test("M172 real mocha mutation: the pending-guard tags are the expected ones", () => {
  assert.deepEqual(PEND_TAGS, ["convert", "wrap"]);
});

const MUTANTS: { id: string; src: () => { shim: string; guard: string } }[] = [
  ...PEND_TAGS.map((t) => ({ id: `m172-pend-guard:${t}`, src: () => ({ shim: SHIM_SOURCE, guard: without(MOCHA_GUARD_SOURCE, new RegExp(`// m172-pend-guard:${t}\\b`)) }) })),
  { id: "m172-guard:shim-mocha-total", src: () => ({ shim: without(SHIM_SOURCE, /\/\/ m172-guard:shim-mocha-total$/), guard: MOCHA_GUARD_SOURCE }) },
  // real mocha counts a pending test in stats.tests, so shim-mocha-total also refuses a pending run there and deleting
  // shim-mocha-pending alone changes nothing on mocha 10.8.2 (it is killed on the stub's pending report in
  // m172-mutation.test.ts); deleting both must change a result here
  { id: "m172-guard:shim-mocha-pending and shim-mocha-total together", src: () => ({ shim: without(without(SHIM_SOURCE, /\/\/ m172-guard:shim-mocha-pending$/), /\/\/ m172-guard:shim-mocha-total$/), guard: MOCHA_GUARD_SOURCE }) },
  // (M173, batch 12) the guard is also launch.cjs's preload and mocha's reporter, so it is loaded without the
  // --require too: that mutant is no longer a change in behaviour and is not listed; the guard not loaded at all is no
  // report (m173-forge.test.ts)
];
for (const m of MUTANTS) {
  test(`M172 real mocha mutation: deleting ${m.id} changes a case's result`, { skip }, () => {
    ready();
    const src = m.src();
    assert.ok(src.shim !== SHIM_SOURCE || src.guard !== MOCHA_GUARD_SOURCE, "the mutant is not a change");
    const changed = Object.entries(EXPECT).filter(([file, want]) => shim(file, src) !== want).map(([f]) => f);
    assert.ok(changed.length > 0, `no case notices ${m.id}`);
  });
}
