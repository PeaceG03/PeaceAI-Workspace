// M169 mutation check: every M169 guard is a single line tagged "// m169-guard:<id>" (a separate tag, so the M151 and
// M152 "// guard:" lists are unchanged) in peaceai/lib/loopdeps.ts, looprow.ts, loop.ts or peaceai/bin/loop.ts. For
// each one this test deletes that line and runs the M169 checks against the mutant: lib guards in a child process
// group (capped at MUTANT_MS, group killed) over the M169 cases, which must fail an assertion (not crash); bin guards
// by running the mutant CLI through binChecks. Guards that only act during a real install need the stage-2 candidate
// uid; elsewhere they are reported as skipped, not claimed.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { stage2CandUid } from "../lib/selfpropose.ts";
import { binChecks } from "./m169-cases.ts";

const ROOT = resolve(import.meta.dirname, "../..");
const libDir = join(ROOT, "peaceai/lib");
const binFile = join(ROOT, "peaceai/bin/loop.ts");
const LIB_FILES = ["loopdeps.ts", "looprow.ts", "loop.ts"] as const;
const TAG = /\/\/ m169-guard:([a-z0-9-]+)\s*$/;
const sources: Record<string, string> = Object.fromEntries([...LIB_FILES.map((f) => [f, readFileSync(join(libDir, f), "utf8")]), ["bin", readFileSync(binFile, "utf8")]]);
const guards = Object.entries(sources).flatMap(([file, text]) => text.split("\n").flatMap((l, i) => { const m = TAG.exec(l); return m ? [{ id: m[1]!, file, line: i }] : []; }));
const NEEDS_CAND = new Set(["deps-cand-access", "loop-depsfail"]);
const cand = stage2CandUid({ PEACEAI_STAGE2_CAND: process.env.M169_CAND ?? process.env.M151_CAND ?? process.env.M146_CAND ?? "peaceai-cand" }).ok;
const tsx = join(ROOT, "node_modules/.bin/tsx");

let dir: string;
before(() => { dir = mkdtempSync(join(tmpdir(), "peaceai-m169-mut-")); });
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
    const child = spawn(process.execPath, [...process.execArgv, join(import.meta.dirname, "m169-mutant-runner.ts"), local["loopdeps.ts"]!, local["looprow.ts"]!, local["loop.ts"]!], { detached: true, stdio: ["ignore", "pipe", "inherit"] });
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

test("M169 mutation: the guard tags are unique and cover the guards", () => {
  const ids = guards.map((g) => g.id);
  assert.equal(new Set(ids).size, ids.length, "duplicate guard id");
  assert.deepEqual([...ids].sort(), [
    "bin-crash-code", "bin-task-file", "deps-cand-access", "loop-depsfail", "pnpm-inert-age", "pnpm-inert-builds", "pnpm-inert-names", "pnpm-inert-shape",
    "row-depsfail-code", "row-depsfail-only", "row-depsfail-public", "row-depsfail-v4",
  ]);
});

test("M169 mutation: the unmutated copies pass every check (the harness itself is sound)", async () => {
  const r = await runMutant("control", "none", "");
  assert.ok(r, "control hung");
  assert.deepEqual(r.crashed, []);
  assert.deepEqual(r.failed, []);
  const bin = join(dir, "control-loop.ts");
  writeFileSync(bin, rewrite(sources.bin!, {}, join(ROOT, "peaceai/bin")));
  binChecks(tsx, bin, ROOT, join(dir, "bin-control"));
});

for (const g of guards) {
  test(`M169 mutation: deleting m169-guard:${g.id} makes a check fail`, async (t) => {
    const text = sources[g.file]!.split("\n").filter((_, i) => i !== g.line).join("\n");
    if (g.file === "bin") {
      const bin = join(dir, `mutant-${g.id}-loop.ts`);
      writeFileSync(bin, rewrite(text, {}, join(ROOT, "peaceai/bin")));
      assert.throws(() => binChecks(tsx, bin, ROOT, join(dir, `bin-${g.id}`)), assert.AssertionError, `no check notices m169-guard:${g.id} removed`);
      return;
    }
    if (NEEDS_CAND.has(g.id) && !cand) { t.skip("needs the stage-2 candidate uid (box / private job)"); return; }
    const r = await runMutant(g.id, g.file, text);
    assert.ok(r, `m169-guard:${g.id} mutant hung`);
    assert.deepEqual(r.crashed, [], `m169-guard:${g.id} mutant crashed instead of failing an assertion`);
    assert.ok(r.failed.length > 0, `no case notices m169-guard:${g.id} removed`);
  });
}

// Semantic mutants of bin/loop.ts's crash-name rule (Auditor #667): printing any e.name, or any name-shaped token,
// instead of the fixed built-in class list must fail binChecks (the custom Error subclass near-miss).
const NAME_MUTANTS: readonly [string, string, string][] = [
  ["crash-any-name", 'return c === undefined && CRASH_CLASSES.has(n) ? n : "OTHER";', 'return n || "OTHER";'],
  ["crash-name-shape", "CRASH_CLASSES.has(n)", "/^[A-Za-z]{1,40}$/.test(n)"],
  ["crash-name-with-code", 'return c === undefined && CRASH_CLASSES.has(n) ? n : "OTHER";', 'return n ? n : "OTHER";'],
];
for (const [id, from, to] of NAME_MUTANTS) {
  test(`M169 mutation: bin/loop.ts semantic mutant ${id} makes a check fail`, () => {
    assert.equal(sources.bin!.split(from).length, 2, `${id}: the mutated text occurs exactly once`);
    const bin = join(dir, `mutant-${id}-loop.ts`);
    writeFileSync(bin, rewrite(sources.bin!.replace(from, to), {}, join(ROOT, "peaceai/bin")));
    assert.throws(() => binChecks(tsx, bin, ROOT, join(dir, `bin-${id}`)), assert.AssertionError, `no check notices ${id}`);
  });
}
