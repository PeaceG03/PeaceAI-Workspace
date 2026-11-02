// M172 mutation check: every M172 guard is a single line tagged "// m172-guard:<id>" (a separate tag, so the M151,
// M152, M168, M169 and M170 lists are unchanged) in peaceai/lib/loopdeps.ts, looprow.ts, loop.ts or editpropose.ts; a tag inside SHIM_SOURCE ends
// in `",`. For each one this test deletes that line and runs the M172 cases against the mutant in a child process
// group (capped at MUTANT_MS, group killed), which must fail an assertion (not crash).
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
const TAG = /\/\/ m172-guard:([a-z0-9-]+)(?:\s*$|",?\s*$)/;
const sources: Record<string, string> = Object.fromEntries(LIB_FILES.map((f) => [f, readFileSync(join(libDir, f), "utf8")]));
const guards = Object.entries(sources).flatMap(([file, text]) => text.split("\n").flatMap((l, i) => { const m = TAG.exec(l); return m ? [{ id: m[1]!, file, line: i }] : []; }));

let dir: string;
before(() => { dir = mkdtempSync(join(tmpdir(), "peaceai-m172-mut-")); });
after(() => rmSync(dir, { recursive: true, force: true }));

function rewrite(text: string, local: Record<string, string>, from: string): string {
  const tsPath = createRequire(join(libDir, "loop.ts")).resolve("typescript");
  return text
    .replace(/from "(?:\.\/|\.\.\/lib\/)([a-z0-9-]+\.ts)"/g, (_, f: string) => `from ${JSON.stringify(pathToFileURL(local[f] ?? join(libDir, f)).href)}`)
    .replace(/from "typescript"/, `from ${JSON.stringify(pathToFileURL(tsPath).href)}`)
    .replace(/import\.meta\.dirname/g, JSON.stringify(from));
}

const MUTANT_MS = 300_000;
function runMutant(name: string, file: string, text: string): Promise<{ failed: string[]; crashed: string[]; skipped: string[]; cand: boolean } | null> {
  const local = Object.fromEntries(LIB_FILES.map((f) => [f, join(dir, `mutant-${name}-${f}`)]));
  for (const f of LIB_FILES) writeFileSync(local[f]!, rewrite(f === file ? text : sources[f]!, local, libDir));
  return new Promise((done, fail) => {
    const child = spawn(process.execPath, [...process.execArgv, join(import.meta.dirname, "m172-mutant-runner.ts"), local["loopdeps.ts"]!, local["looprow.ts"]!, local["loop.ts"]!, local["editpropose.ts"]!], { detached: true, stdio: ["ignore", "pipe", "inherit"] });
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

test("M172 mutation: the guard tags are unique and cover the guards", () => {
  const ids = guards.map((g) => g.id);
  assert.equal(new Set(ids).size, ids.length, "duplicate guard id");
  assert.deepEqual([...ids].sort(), [
    "imp-allowed", "imp-inside", "imp-relative", "imp-v2-only", "mocha-config", "mocha-extension", "mocha-flag", "mocha-one-command", "mocha-options",
    "mocha-require-dotdot", "mocha-require-file", "mocha-require-pkg", "mocha-timeout", "mocha-ui", "ref-arg", "shim-mocha-args", "shim-mocha-sep",
    "shim-mocha-stats", "uk-key", "uk-no-else", "uk-ref", "uk-same-value", "uk-undefined",
  ]);
});

test("M172 mutation: the unmutated copies pass every check (the harness itself is sound)", async () => {
  const r = await runMutant("control", "none", "");
  assert.ok(r, "control hung");
  assert.deepEqual(r.crashed, []);
  assert.deepEqual(r.failed, []);
});

for (const g of guards) {
  test(`M172 mutation: deleting m172-guard:${g.id} makes a check fail`, async () => {
    const text = sources[g.file]!.split("\n").filter((_, i) => i !== g.line).join("\n");
    const r = await runMutant(g.id, g.file, text);
    assert.ok(r, `m172-guard:${g.id} mutant hung`);
    assert.deepEqual(r.crashed, [], `m172-guard:${g.id} mutant crashed instead of failing an assertion`);
    assert.ok(r.failed.length > 0, `no case notices m172-guard:${g.id} removed`);
  });
}
