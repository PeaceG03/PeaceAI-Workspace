// M143 mutation check: every safety or relevance filter in peaceai/lib/codesearch.ts is a single line tagged
// "// filter:<id>". For each one, this test deletes that line, loads the mutant from a temp dir and runs the M143
// cases against it. At least one case must fail with an assertion (not a crash), so no filter is untested.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { CASES } from "./m143-codesearch-cases.ts";
import { setup, teardown, type Ctx } from "./m143-fixtures.ts";

const libDir = resolve(import.meta.dirname, "../lib");
const source = readFileSync(join(libDir, "codesearch.ts"), "utf8");
const TAG = /\/\/ filter:([a-z0-9-]+)\s*$/;
const lines = source.split("\n");
const filters = lines.flatMap((l, i) => { const m = TAG.exec(l); return m ? [{ id: m[1]!, line: i }] : []; });

let ctx: Ctx;
let dir: string;
before(() => { ctx = setup(); dir = mkdtempSync(join(tmpdir(), "peaceai-m143-mut-")); });
after(() => { teardown(ctx); rmSync(dir, { recursive: true, force: true }); });

function rewriteImports(text: string): string {
  const tsPath = createRequire(join(libDir, "codesearch.ts")).resolve("typescript");
  return text
    .replace(/from "\.\/symbols\.ts"/, `from ${JSON.stringify(pathToFileURL(join(libDir, "symbols.ts")).href)}`)
    .replace(/from "typescript"/, `from ${JSON.stringify(pathToFileURL(tsPath).href)}`);
}

test("M143 mutation: the filter tags are unique and cover the safety filters", () => {
  const ids = filters.map((f) => f.id);
  assert.equal(new Set(ids).size, ids.length, "duplicate filter id");
  for (const need of ["absolute", "dotdot", "realpath", "git-real", "read-realpath", "symlink-walk", "gitignore", "read-listed", "binary", "redos"]) {
    assert.ok(ids.includes(need), `missing filter:${need}`);
  }
});

test("M143 mutation: the unmutated copy passes every case (the harness itself is sound)", async () => {
  const file = join(dir, "control.ts");
  writeFileSync(file, rewriteImports(source));
  const mod = await import(pathToFileURL(file).href);
  for (const c of CASES) c.run(mod, ctx);
});

for (const f of filters) {
  test(`M143 mutation: deleting filter:${f.id} makes a case fail`, async () => {
    const mutant = lines.filter((_, i) => i !== f.line).join("\n");
    const file = join(dir, `mutant-${f.id}.ts`);
    writeFileSync(file, rewriteImports(mutant));
    const mod = await import(pathToFileURL(file).href);
    const failed: string[] = [];
    for (const c of CASES) {
      try { c.run(mod, ctx); } catch (e) {
        // A failure thrown from inside the mutant itself (not an assertion in the case) is a crash, not a detection.
        const top = e instanceof Error ? (e.stack ?? "").split("\n").find((l) => l.trim().startsWith("at ")) ?? "" : "";
        assert.ok(e instanceof assert.AssertionError || !top.includes("mutant-"), `filter:${f.id} mutant crashed in "${c.id}" instead of failing an assertion: ${String(e)}`);
        failed.push(c.id);
      }
    }
    assert.ok(failed.length > 0, `no case notices filter:${f.id} removed`);
  });
}
