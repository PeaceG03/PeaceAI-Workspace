// M168 mutation check on repair-v2's guards: every repair-v2 guard in peaceai/lib/editpropose.ts is a single line
// tagged "// m168-guard:<id>" (a separate tag, so M152's "// guard:" list is unchanged). For each one, this test
// deletes that line, writes the mutant to a temp dir and runs the M168 cases against it in a child process group
// (capped at MUTANT_MS, group killed). At least one case must fail with an assertion (not a crash). The cases need no
// candidate uid, so every guard is checked everywhere.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const libDir = resolve(import.meta.dirname, "../lib");
const propSource = readFileSync(join(libDir, "editpropose.ts"), "utf8");
const TAG = /\/\/ m168-guard:([a-z0-9-]+)\s*$/;
const propLines = propSource.split("\n");
const guards = propLines.flatMap((l, i) => { const m = TAG.exec(l); return m ? [{ id: m[1]!, line: i }] : []; });

let dir: string;
before(() => { dir = mkdtempSync(join(tmpdir(), "peaceai-m168-mut-")); });
after(() => rmSync(dir, { recursive: true, force: true }));

function rewrite(text: string): string {
  const tsPath = createRequire(join(libDir, "editpropose.ts")).resolve("typescript");
  return text
    .replace(/from "\.\/([a-z0-9-]+\.ts)"/g, (_, f: string) => `from ${JSON.stringify(pathToFileURL(join(libDir, f)).href)}`)
    .replace(/from "typescript"/, `from ${JSON.stringify(pathToFileURL(tsPath).href)}`)
    .replace(/import\.meta\.dirname/g, JSON.stringify(libDir));
}

const MUTANT_MS = 300_000;
function runMutant(name: string, propText: string): Promise<{ failed: string[]; crashed: string[] } | null> {
  const propFile = join(dir, `mutant-${name}-editpropose.ts`);
  writeFileSync(propFile, rewrite(propText));
  return new Promise((done, fail) => {
    const child = spawn(process.execPath, [...process.execArgv, join(import.meta.dirname, "m168-mutant-runner.ts"), propFile], { detached: true, stdio: ["ignore", "pipe", "inherit"] });
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

test("M168 mutation: the guard tags are unique and cover the guards", () => {
  const ids = guards.map((g) => g.id);
  assert.equal(new Set(ids).size, ids.length, "duplicate guard id");
  assert.deepEqual([...ids].sort(), [
    "cp-noargs", "cp-op", "cp-ref", "cp-same", "depth-v1", "dr-const", "dr-method", "dr-optional", "dr-ref", "dr-statement",
    "focus-named", "focus-v2-only", "idioms-v2-only", "pc-empty", "pc-object", "pc-sources", "pc-spread", "tn-and", "tn-object", "tn-ref", "tn-same",
  ]);
});

test("M168 mutation: the unmutated copy passes every case (the harness itself is sound)", async () => {
  const r = await runMutant("control", propSource);
  assert.ok(r, "control hung");
  assert.deepEqual(r.crashed, []);
  assert.deepEqual(r.failed, []);
});

for (const g of guards) {
  test(`M168 mutation: deleting m168-guard:${g.id} makes a case fail`, async () => {
    const r = await runMutant(g.id, propLines.filter((_, i) => i !== g.line).join("\n"));
    assert.ok(r, `m168-guard:${g.id} mutant hung`);
    assert.deepEqual(r.crashed, [], `m168-guard:${g.id} mutant crashed instead of failing an assertion`);
    assert.ok(r.failed.length > 0, `no case notices m168-guard:${g.id} removed`);
  });
}
