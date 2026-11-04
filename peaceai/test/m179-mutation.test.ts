// M179 mutation check (batch 18) on repair-v2's anchored continuation: every M179 guard in peaceai/lib/editpropose.ts is a
// single line tagged "// m179-guard:<id>" (a separate tag, so the M152, M168, M172, M173, M176, M177 and M178 lists are unchanged). For
// each one, this test deletes that line, writes the mutant to a temp dir and runs the pure M179 cases against it in a
// child process group (capped at MUTANT_MS, group killed). At least one case must fail with an assertion (not a crash).
// The pure cases need no candidate uid, so every guard is checked everywhere.
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
const TAG = /\/\/ m179-guard:([a-z0-9-]+)\s*$/;
const propLines = propSource.split("\n");
const guards = propLines.flatMap((l, i) => { const m = TAG.exec(l); return m ? [{ id: m[1]!, line: i }] : []; });

let dir: string;
before(() => { dir = mkdtempSync(join(tmpdir(), "peaceai-m179-mut-")); });
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
    const child = spawn(process.execPath, [...process.execArgv, join(import.meta.dirname, "m179-mutant-runner.ts"), propFile], { detached: true, stdio: ["ignore", "pipe", "inherit"] });
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

test("M179 mutation: the guard tags are unique and cover the guards", () => {
  const ids = guards.map((g) => g.id);
  assert.equal(new Set(ids).size, ids.length, "duplicate guard id");
  assert.deepEqual([...ids].sort(), [
    "an-clean", "an-improves", "an-names", "an-no-evidence", "an-room", "an-total", "an-v2-only", "co-cap", "co-overlap", "co-seen", "co-valid", "df-defer", "df-tail", "rb-deferred",
  ]);
});

test("M179 mutation: the unmutated copy passes every case (the harness itself is sound)", async () => {
  const r = await runMutant("control", propSource);
  assert.ok(r, "control hung");
  assert.deepEqual(r.crashed, []);
  assert.deepEqual(r.failed, []);
});

for (const g of guards) {
  test(`M179 mutation: deleting m179-guard:${g.id} makes a case fail`, async () => {
    const r = await runMutant(g.id, propLines.filter((_, i) => i !== g.line).join("\n"));
    assert.ok(r, `m179-guard:${g.id} mutant hung`);
    assert.deepEqual(r.crashed, [], `m179-guard:${g.id} mutant crashed instead of failing an assertion`);
    assert.ok(r.failed.length > 0, `no case notices m179-guard:${g.id} removed`);
  });
}
