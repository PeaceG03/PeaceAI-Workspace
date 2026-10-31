// M151 mutation check on loop v2's guards: every guard in peaceai/lib/loopdeps.ts is a single line tagged
// "// guard:<id>" (shim guards are lines of the shim source). For each one, this test deletes that line, writes the
// mutant (and a loop.ts that imports it) to a temp dir and runs the M151 cases against them in a child process
// group (capped at MUTANT_MS, group killed). At least one case must fail with an assertion (not a crash). Guards
// that only act during a real install need the stage-2 candidate uid; elsewhere they are reported, not claimed.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { stage2CandUid } from "../lib/selfpropose.ts";

const libDir = resolve(import.meta.dirname, "../lib");
const source = readFileSync(join(libDir, "loopdeps.ts"), "utf8");
const loopSource = readFileSync(join(libDir, "loop.ts"), "utf8");
const TAG = /\/\/ guard:([a-z0-9-]+)(?:\s*$|",?\s*$)/;
const lines = source.split("\n");
const guards = lines.flatMap((l, i) => { const m = TAG.exec(l); return m ? [{ id: m[1]!, line: i }] : []; });
const NEEDS_CAND = new Set(["deps-cand", "deps-config", "deps-timeout", "deps-size", "deps-registry", "deps-env-i", "deps-kill", "deps-chown"]);
const cand = stage2CandUid({ PEACEAI_STAGE2_CAND: process.env.M151_CAND ?? process.env.M146_CAND ?? "peaceai-cand" }).ok;

let dir: string;
before(() => { dir = mkdtempSync(join(tmpdir(), "peaceai-m151-mut-")); });
after(() => rmSync(dir, { recursive: true, force: true }));

function rewrite(text: string, depsFile: string | null): string {
  const tsPath = createRequire(join(libDir, "loop.ts")).resolve("typescript");
  return text
    .replace(/from "\.\/([a-z0-9-]+\.ts)"/g, (_, f: string) => `from ${JSON.stringify(pathToFileURL(f === "loopdeps.ts" && depsFile ? depsFile : join(libDir, f)).href)}`)
    .replace(/from "typescript"/, `from ${JSON.stringify(pathToFileURL(tsPath).href)}`)
    .replace(/import\.meta\.dirname/g, JSON.stringify(libDir));
}

const MUTANT_MS = 300_000;
function runMutant(name: string, depsText: string): Promise<{ failed: string[]; crashed: string[]; skipped: string[]; cand: boolean } | null> {
  const depsFile = join(dir, `mutant-${name}-loopdeps.ts`);
  const loopFile = join(dir, `mutant-${name}-loop.ts`);
  writeFileSync(depsFile, rewrite(depsText, null));
  writeFileSync(loopFile, rewrite(loopSource, depsFile));
  return new Promise((done, fail) => {
    const child = spawn(process.execPath, [...process.execArgv, join(import.meta.dirname, "m151-mutant-runner.ts"), depsFile, loopFile], { detached: true, stdio: ["ignore", "pipe", "inherit"] });
    let out = "";
    child.stdout.on("data", (d) => { out += d; });
    const timer = setTimeout(() => { try { process.kill(-child.pid!, "SIGKILL"); } catch { /* gone */ } }, MUTANT_MS);
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (signal === "SIGKILL") return done(null);
      if (code !== 0) return fail(new Error(`mutant runner exited ${code}`));
      done(JSON.parse(out.trim().split("\n").pop()!));
    });
  });
}

test("M151 mutation: the guard tags are unique and cover the guards", () => {
  const ids = guards.map((g) => g.id);
  assert.equal(new Set(ids).size, ids.length, "duplicate guard id");
  assert.deepEqual([...ids].sort(), [
    "deps-cand", "deps-chown", "deps-config", "deps-env-i", "deps-frozen", "deps-ignore-scripts", "deps-kill", "deps-lockfile", "deps-nonregistry", "deps-npm-allow",
    "deps-pnpmfile", "deps-registry", "deps-size", "deps-timeout", "lock-all", "lock-link", "lock-npm", "lock-npm-both", "lock-npm-key", "lock-npm-v1", "lock-pnpm-anchor", "lock-pnpm-dup", "lock-pnpm-esc",
    "lock-pnpm-flow", "lock-pnpm-indent", "lock-pnpm-key", "lock-pnpm-link", "lock-pnpm-missing", "lock-pnpm-res", "lock-pnpm-url", "lock-size", "lock-yarn",
    "lock-yarn-dup", "lock-yarn-field", "lock-yarn-spec", "pm-nested-lock", "pm-pnpm", "pm-tree", "pnpm-field", "pnpm-manifest", "pnpm-ws", "pnpm-ws-catalog", "pnpm-ws-key",
    "pnpm-ws-other", "pnpm-ws-packages", "pnpm-ws-parse", "runner-dep", "runner-other", "service", "shim-exit", "shim-report", "shim-suites",
  ]);
});

test("M151 mutation: the unmutated copy passes every case (the harness itself is sound)", async () => {
  const r = await runMutant("control", source);
  assert.ok(r, "control hung");
  assert.deepEqual(r.crashed, []);
  assert.deepEqual(r.failed, []);
});

for (const g of guards) {
  test(`M151 mutation: deleting guard:${g.id} makes a case fail`, async (t) => {
    if (NEEDS_CAND.has(g.id) && !cand) { t.skip("needs the stage-2 candidate uid (box / private job)"); return; }
    const r = await runMutant(g.id, lines.filter((_, i) => i !== g.line).join("\n"));
    assert.ok(r, `guard:${g.id} mutant hung`);
    assert.deepEqual(r.crashed, [], `guard:${g.id} mutant crashed instead of failing an assertion`);
    assert.ok(r.failed.length > 0, `no case notices guard:${g.id} removed`);
  });
}
