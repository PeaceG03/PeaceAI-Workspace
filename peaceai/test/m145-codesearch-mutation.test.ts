// M145 mutation check: every safety or relevance filter in peaceai/lib/codesearch.ts is a single line tagged
// "// filter:<id>". For each one, this test deletes that line, writes the mutant to a temp dir and runs the M145
// cases against it in a child process (its own process group, capped at MUTANT_MS). At least one case must fail
// with an assertion (not a crash), or the mutant must hang past the cap (deleting the regex deadline makes grep hang
// on a catastrophic pattern: that hang is the detection), so no filter is untested.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { CASES } from "./m145-codesearch-cases.ts";
import { setup, teardown, type Ctx } from "./m145-fixtures.ts";

const libDir = resolve(import.meta.dirname, "../lib");
const source = readFileSync(join(libDir, "codesearch.ts"), "utf8");
const TAG = /\/\/ filter:([a-z0-9-]+)\s*$/;
const lines = source.split("\n");
const filters = lines.flatMap((l, i) => { const m = TAG.exec(l); return m ? [{ id: m[1]!, line: i }] : []; });

let ctx: Ctx;
let dir: string;
before(() => { ctx = setup(); dir = mkdtempSync(join(tmpdir(), "peaceai-m145-mut-")); });
after(() => { teardown(ctx); rmSync(dir, { recursive: true, force: true }); });

function rewriteImports(text: string): string {
  const tsPath = createRequire(join(libDir, "codesearch.ts")).resolve("typescript");
  return text
    .replace(/from "\.\/symbols\.ts"/, `from ${JSON.stringify(pathToFileURL(join(libDir, "symbols.ts")).href)}`)
    .replace(/from "typescript"/, `from ${JSON.stringify(pathToFileURL(tsPath).href)}`);
}

test("M145 mutation: the filter tags are unique and cover the safety filters", () => {
  const ids = filters.map((f) => f.id);
  assert.equal(new Set(ids).size, ids.length, "duplicate filter id");
  for (const need of ["absolute", "dotdot", "realpath", "git-real", "read-realpath", "symlink-walk", "gitignore", "read-listed", "binary", "redos", "regex-deadline", "regex-timeout", "gitignore-bad-rule"]) {
    assert.ok(ids.includes(need), `missing filter:${need}`);
  }
});

test("M145 mutation: the unmutated copy passes every case (the harness itself is sound)", async () => {
  const file = join(dir, "control.ts");
  writeFileSync(file, rewriteImports(source));
  const mod = await import(pathToFileURL(file).href);
  for (const c of CASES) c.run(mod, ctx);
});

const MUTANT_MS = 60_000;
/** Runs the cases against one mutant file in a child process group; null = it hung past MUTANT_MS (group killed). */
function runMutant(file: string): Promise<{ failed: string[]; crashed: string[] } | null> {
  return new Promise((done, fail) => {
    const child = spawn(process.execPath, [...process.execArgv, join(import.meta.dirname, "m145-mutant-runner.ts"), file], { detached: true, stdio: ["ignore", "pipe", "inherit"] });
    let out = "";
    child.stdout.on("data", (d) => { out += d; });
    const timer = setTimeout(() => { try { process.kill(-child.pid!, "SIGKILL"); } catch { /* gone */ } }, MUTANT_MS);
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (signal === "SIGKILL") return done(null);
      try { process.kill(-child.pid!, "SIGKILL"); } catch { /* no strays */ }
      if (code !== 0) return fail(new Error(`mutant runner exited ${code}`));
      done(JSON.parse(out.trim().split("\n").pop()!));
    });
  });
}

for (const f of filters) {
  test(`M145 mutation: deleting filter:${f.id} makes a case fail`, async () => {
    const mutant = lines.filter((_, i) => i !== f.line).join("\n");
    const file = join(dir, `mutant-${f.id}.ts`);
    writeFileSync(file, rewriteImports(mutant));
    const r = await runMutant(file);
    if (r === null) { assert.equal(f.id, "regex-deadline", `filter:${f.id} mutant hung`); return; } // hung past the cap: detected
    assert.deepEqual(r.crashed, [], `filter:${f.id} mutant crashed instead of failing an assertion`);
    assert.ok(r.failed.length > 0, `no case notices filter:${f.id} removed`);
  });
}
