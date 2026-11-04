// M185 mutation check (batch 21) on repair-v2's imported-base localisation: every M185 guard in peaceai/lib/editpropose.ts is a
// single line tagged "// m185-guard:<id>" (a separate tag, so earlier lists are unchanged). The guards of earlier batches
// that M185's conditions rely on (m183-guard:ih-extends, m183-guard:ih-super, m183-guard:ih-depth, m184-guard:rx-exported, m184-guard:rx-hops, m184-guard:rx-type-only, m184-guard:rx-star-unique, m184-guard:rx-named-first, m186-guard:dx-not-named, m172-guard:imp-type-only, m172-guard:imp-type-only-name) are replayed against the M185 cases too, so each condition
// the spec states is shown to matter here. For each line, this test deletes it, writes the mutant to a temp dir and runs the
// pure M185 cases against it in a child process group (capped at MUTANT_MS, group killed). At least one case must fail
// with an assertion (not a crash). The pure cases need no candidate uid, so every guard is checked everywhere.
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
const TAG = /\/\/ (m1[0-9]{2}-guard:[a-z0-9-]+)\s*$/;
const REUSED = ["m183-guard:ih-extends", "m183-guard:ih-super", "m183-guard:ih-depth", "m184-guard:rx-exported", "m184-guard:rx-hops", "m184-guard:rx-type-only", "m184-guard:rx-star-unique", "m184-guard:rx-named-first", "m186-guard:dx-not-named", "m172-guard:imp-type-only", "m172-guard:imp-type-only-name"];
const propLines = propSource.split("\n");
const guards = propLines.flatMap((l, i) => { const m = TAG.exec(l); return m && (m[1]!.startsWith("m185-guard:") || REUSED.includes(m[1]!)) ? [{ id: m[1]!, line: i }] : []; });

let dir: string;
before(() => { dir = mkdtempSync(join(tmpdir(), "peaceai-m185-mut-")); });
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
    const child = spawn(process.execPath, [...process.execArgv, join(import.meta.dirname, "m185-mutant-runner.ts"), propFile], { detached: true, stdio: ["ignore", "pipe", "inherit"] });
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

test("M185 mutation: the guard tags are unique and cover the guards", () => {
  const ids = guards.map((g) => g.id);
  assert.equal(new Set(ids).size, ids.length, "duplicate guard id");
  assert.deepEqual([...ids].sort(), ["m172-guard:imp-type-only", "m172-guard:imp-type-only-name", "m183-guard:ih-depth", "m183-guard:ih-extends", "m183-guard:ih-super", "m184-guard:rx-exported", "m184-guard:rx-hops", "m184-guard:rx-named-first", "m184-guard:rx-star-unique", "m184-guard:rx-type-only", "m185-guard:xb-allowed", "m186-guard:dx-not-named"]);
});

test("M185 mutation: the unmutated copy passes every case (the harness itself is sound)", async () => {
  const r = await runMutant("control", propSource);
  assert.ok(r, "control hung");
  assert.deepEqual(r.crashed, []);
  assert.deepEqual(r.failed, []);
});

for (const g of guards) {
  test(`M185 mutation: deleting ${g.id} makes a case fail`, async () => {
    const r = await runMutant(g.id, propLines.filter((_, i) => i !== g.line).join("\n"));
    assert.ok(r, `${g.id} mutant hung`);
    assert.deepEqual(r.crashed, [], `${g.id} mutant crashed instead of failing an assertion`);
    assert.ok(r.failed.length > 0, `no case notices ${g.id} removed`);
  });
}
