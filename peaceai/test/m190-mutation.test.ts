// M190 mutation check: every M190 guard is a single line tagged "// m190-guard:<id>" in peaceai/lib/loopdeps.ts (the
// shim and its vitest / jest reporters) or loop.ts (the names reader). For each one this test deletes that line and
// runs the M190 cases (m190-cases.ts) against the mutant in a child process group (capped at MUTANT_MS, group killed);
// at least one case must fail an assertion (not crash). The end-to-end cases need the stage-2 candidate uid; every
// guard is also covered by a case that does not.
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
const LIB_FILES = ["loopdeps.ts", "loop.ts", "editpropose.ts"] as const;
const TAG = /\/\/ m190-guard:([a-z0-9-]+)(?:[\s",].*)?$/;
const sources: Record<string, string> = Object.fromEntries(LIB_FILES.map((f) => [f, readFileSync(join(libDir, f), "utf8")]));
const guards = Object.entries(sources).flatMap(([file, text]) => text.split("\n").flatMap((l, i) => { const m = TAG.exec(l); return m ? [{ id: m[1]!, file, line: i }] : []; }));

let dir: string;
before(() => { dir = mkdtempSync(join(tmpdir(), "peaceai-m190-mut-")); });
after(() => rmSync(dir, { recursive: true, force: true }));

function rewrite(text: string, local: Record<string, string>, from: string): string {
  const tsPath = createRequire(join(libDir, "loop.ts")).resolve("typescript");
  return text
    .replace(/from "(?:\.\/|\.\.\/lib\/)([a-z0-9-]+\.ts)"/g, (_, f: string) => `from ${JSON.stringify(pathToFileURL(local[f] ?? join(libDir, f)).href)}`)
    .replace(/from "typescript"/, `from ${JSON.stringify(pathToFileURL(tsPath).href)}`)
    .replace(/import\.meta\.dirname/g, JSON.stringify(from));
}

const MUTANT_MS = 600_000;
function runMutant(name: string, file: string, text: string): Promise<{ failed: string[]; crashed: string[]; skipped: string[]; cand: boolean } | null> {
  const local = Object.fromEntries(LIB_FILES.map((f) => [f, join(dir, `mutant-${name}-${f}`)]));
  for (const f of LIB_FILES) writeFileSync(local[f]!, rewrite(f === file ? text : sources[f]!, local, libDir));
  return new Promise((done, fail) => {
    const child = spawn(process.execPath, [...process.execArgv, join(import.meta.dirname, "m190-mutant-runner.ts"), local["loopdeps.ts"]!, local["loop.ts"]!, local["editpropose.ts"]!], { detached: true, stdio: ["ignore", "pipe", "inherit"] });
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

test("M190 mutation: the guard tags are unique and cover the guards", () => {
  const ids = guards.map((g) => g.id);
  assert.equal(new Set(ids).size, ids.length, "duplicate guard id");
  assert.deepEqual([...ids].sort(), ["jest-names", "jf-clean", "jf-count", "jf-synth", "pn-adjacent", "pn-cap", "pn-shape", "shim-count", "shim-printable", "shim-real", "vitest-names"]);
});

test("M190 mutation: the unmutated copies pass every case (the harness itself is sound)", async () => {
  const r = await runMutant("control", "none", "");
  assert.ok(r, "control hung");
  assert.deepEqual(r.crashed, []);
  assert.deepEqual(r.failed, []);
});

for (const g of guards) {
  test(`M190 mutation: deleting m190-guard:${g.id} makes a case fail`, async () => {
    const text = sources[g.file]!.split("\n").filter((_, i) => i !== g.line).join("\n");
    const r = await runMutant(g.id, g.file, text);
    assert.ok(r, `m190-guard:${g.id} mutant hung`);
    assert.deepEqual(r.crashed, [], `m190-guard:${g.id} mutant crashed instead of failing an assertion`);
    assert.ok(r.failed.length > 0, `no case notices m190-guard:${g.id} removed`);
  });
}
