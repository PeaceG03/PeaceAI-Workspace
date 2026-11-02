// Batch 10 (box hygiene): scratchDir (peaceai/test/scratch.ts) removes every dir it made, and the `<dir>.<ext>` files
// beside it, when the test process exits, pass or fail; it never touches a dir it did not make.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const tsx = resolve(import.meta.dirname, "../../node_modules/.bin/tsx");
const scratch = resolve(import.meta.dirname, "scratch.ts");

function child(base: string, exitCode: number): string {
  const src = `import { scratchDir } from ${JSON.stringify(scratch)}; import { writeFileSync, mkdirSync } from "node:fs";
const a = scratchDir("m170a-", ${JSON.stringify(base)}); const b = scratchDir("m170b-", ${JSON.stringify(base)});
mkdirSync(a + "/deep/er", { recursive: true }); writeFileSync(a + "/deep/er/f", "x"); writeFileSync(b + ".diff", "d"); writeFileSync(b + ".empty.diff", "");
console.log(a + "\\n" + b); process.exitCode = ${exitCode};`;
  const f = join(base, "child.ts");
  writeFileSync(f, src);
  const r = spawnSync(tsx, [f], { encoding: "utf8", env: { ...process.env, TMPDIR: base } });
  assert.equal(r.status, exitCode, r.stderr);
  return r.stdout;
}

for (const code of [0, 1]) test(`scratchDir: dirs and their <dir>.<ext> siblings are gone after the process exits (exit ${code}); others stay`, () => {
  const base = mkdtempSync(join(tmpdir(), "m170s-"));
  try {
    mkdirSync(join(base, "m170a-keep"));
    writeFileSync(join(base, "unrelated.diff"), "");
    const [a, b] = child(base, code).trim().split("\n");
    assert.ok(a && b && a.startsWith(base) && b.startsWith(base));
    assert.equal(existsSync(a!), false);
    assert.equal(existsSync(b!), false);
    assert.deepEqual(readdirSync(base).filter((e) => !e.startsWith("tsx-")).sort(), ["child.ts", "m170a-keep", "unrelated.diff"]); // tsx-<uid>: the child tsx cache
  } finally { rmSync(base, { recursive: true, force: true }); }
});
