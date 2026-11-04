// M187 mutation check: every M187 detection guard is a single line tagged "// m187-guard:<id>" in peaceai/lib/
// loopdeps.ts (a separate tag, so the M151..M173 lists are unchanged). For each one this test deletes that line and
// runs the M187 cases against the mutant in a child process group (capped at MUTANT_MS, group killed), which must fail
// an assertion (not crash). The forging guard (m187-forge-guard:ava-send-pin) is a different tag, mutated against a
// real ava install by m187-forge.test.ts.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = resolve(import.meta.dirname, "../..");
const libDir = join(ROOT, "peaceai/lib");
const LIB_FILES = ["loopdeps.ts", "looprow.ts", "loop.ts", "editpropose.ts"] as const;
const TAG = /\/\/ m187-guard:([a-z0-9-]+)(?:\s*$|",?\s*$)/;
const sources: Record<string, string> = Object.fromEntries(LIB_FILES.map((f) => [f, readFileSync(join(libDir, f), "utf8")]));
const guards = Object.entries(sources).flatMap(([file, text]) => text.split("\n").flatMap((l, i) => { const m = TAG.exec(l); return m ? [{ id: m[1]!, file, line: i }] : []; }));

let dir: string;
before(() => { dir = mkdtempSync(join(tmpdir(), "peaceai-m187-mut-")); });
after(() => rmSync(dir, { recursive: true, force: true }));

function rewrite(text: string, local: Record<string, string>, from: string): string {
  const tsPath = createRequire(join(libDir, "loop.ts")).resolve("typescript");
  return text
    .replace(/from "(?:\.\/|\.\.\/lib\/)([a-z0-9-]+\.ts)"/g, (_, f: string) => `from ${JSON.stringify(pathToFileURL(local[f] ?? join(libDir, f)).href)}`)
    .replace(/from "typescript"/, `from ${JSON.stringify(pathToFileURL(tsPath).href)}`)
    .replace(/import\.meta\.dirname/g, JSON.stringify(from));
}

const MUTANT_MS = 180_000;
function runMutant(name: string, file: string, text: string): Promise<{ failed: string[]; crashed: string[]; skipped: string[]; cand: boolean } | null> {
  const local = Object.fromEntries(LIB_FILES.map((f) => [f, join(dir, `mutant-${name}-${f}`)]));
  for (const f of LIB_FILES) writeFileSync(local[f]!, rewrite(f === file ? text : sources[f]!, local, libDir));
  return new Promise((done, fail) => {
    const child = spawn(process.execPath, [...process.execArgv, join(import.meta.dirname, "m187-mutant-runner.ts"), local["loopdeps.ts"]!, local["looprow.ts"]!, local["loop.ts"]!, local["editpropose.ts"]!], { detached: true, stdio: ["ignore", "pipe", "inherit"] });
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

test("M187 mutation: the guard tags are unique and cover the detection guards", () => {
  const ids = guards.map((g) => g.id);
  assert.equal(new Set(ids).size, ids.length, "duplicate guard id");
  assert.deepEqual([...ids].sort(), [
    "ava-bool", "ava-concurrency", "ava-config-file", "ava-flag", "ava-flag-value",
    "ava-node-args", "ava-one-command", "ava-options", "ava-require", "ava-timeout",
  ]);
});

test("M187 mutation: the unmutated copies pass every check (the harness itself is sound)", async () => {
  const r = await runMutant("control", "none", "");
  assert.ok(r, "control hung");
  assert.deepEqual(r.crashed, []);
  assert.deepEqual(r.failed, []);
});

for (const g of guards) {
  test(`M187 mutation: deleting m187-guard:${g.id} makes a check fail`, async () => {
    const text = sources[g.file]!.split("\n").filter((_, i) => i !== g.line).join("\n");
    const r = await runMutant(g.id, g.file, text);
    assert.ok(r, `m187-guard:${g.id} mutant hung`);
    assert.deepEqual(r.crashed, [], `m187-guard:${g.id} mutant crashed instead of failing an assertion`);
    assert.ok(r.failed.length > 0, `no case notices m187-guard:${g.id} removed`);
  });
}
