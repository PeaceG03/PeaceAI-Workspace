// Every text-guard line is one condition. Deleting it must make a case fail by assertion.
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
const TAG = /\/\/ text-guard:([a-z0-9-]+)\s*$/;
const propLines = propSource.split("\n");
const guards = propLines.flatMap((l, i) => { const m = TAG.exec(l); return m ? [{ id: m[1]!, line: i }] : []; });

let dir: string;
before(() => { dir = mkdtempSync(join(tmpdir(), "peaceai-m236-mut-")); });
after(() => rmSync(dir, { recursive: true, force: true }));

function rewrite(text: string): string {
  const tsPath = createRequire(join(libDir, "editpropose.ts")).resolve("typescript");
  return text
    .replace(/from "\.\/([a-z0-9-]+\.ts)"/g, (_, f: string) => `from ${JSON.stringify(pathToFileURL(join(libDir, f)).href)}`)
    .replace(/from "typescript"/, `from ${JSON.stringify(pathToFileURL(tsPath).href)}`)
    .replace(/import\.meta\.dirname/g, JSON.stringify(libDir));
}

function runMutant(name: string, propText: string): Promise<{ failed: string[]; crashed: string[] } | null> {
  const propFile = join(dir, `mutant-${name}-editpropose.ts`);
  writeFileSync(propFile, rewrite(propText));
  return new Promise((done, fail) => {
    const child = spawn(process.execPath, [...process.execArgv, join(import.meta.dirname, "m236-mutant-runner.ts"), propFile], { detached: true, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => { out += d; });
    child.stderr.on("data", (d) => { err += d; });
    const timer = setTimeout(() => { try { process.kill(-child.pid!, "SIGKILL"); } catch { /* gone */ } }, 60_000);
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (signal === "SIGKILL") return done(null);
      if (code !== 0) return fail(new Error(`mutant runner exited ${code}: ${err.slice(-500)}`));
      done(JSON.parse(out.trim().split("\n").pop()!));
    });
  });
}

test("text-guard tags are unique and name every condition", () => {
  const ids = guards.map((g) => g.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual([...ids].sort(), [
    "backtick", "code-shape", "complement-respect", "complement-return", "complement-use", "fronted-clause",
    "generic-object", "hide-other", "if-boundary", "limit", "make-object", "meta", "noun-phrase",
    "plain-fallback", "plain-unique", "proposer", "question", "rename", "shaped-keep", "symptom",
    "symptom-fires", "symptom-returns", "symptom-run", "symptom-runs", "symptom-sends", "symptom-subject",
    "symptom-throws", "thanks", "verb", "verb-clause",
  ]);
});

test("the unmutated copy passes every text-edit case", async () => {
  const r = await runMutant("control", propSource);
  assert.ok(r, "control hung");
  assert.deepEqual(r.crashed, []);
  assert.deepEqual(r.failed, []);
});

for (const g of guards) {
  test(`deleting text-guard:${g.id} makes a case fail`, async () => {
    const r = await runMutant(g.id, propLines.filter((_, i) => i !== g.line).join("\n"));
    assert.ok(r, `text-guard:${g.id} hung`);
    assert.deepEqual(r.crashed, [], `text-guard:${g.id} crashed: ${r!.crashed.join("; ")}`);
    assert.ok(r.failed.length > 0, `no case notices text-guard:${g.id}`);
  });
}
