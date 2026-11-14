// Mutants for the follow-up guards. Deleting a tagged line must fail an assertion.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const libDir = resolve(import.meta.dirname, "../lib");
const sources = {
  propose: { file: "editpropose.ts", tag: /\/\/ cap-guard:(own-alias-init|own-alias-use|own-alias-order|own-alias-scope|own-alias-optional|own-alias-optional-proto|own-alias-block|own-alias-shadow|own-alias-reassign|enum-roundtrip|bundle-max)\s*$/, suite: "propose" },
  spec: { file: "testspec.ts", tag: /\/\/ spec-guard:(ava-cross|ava-fail|ava-summary-count|ava-summary-one|ava-banner|ava-banner-error)\s*$/, suite: "spec" },
} as const;

let dir: string;
before(() => { dir = mkdtempSync(join(tmpdir(), "peaceai-m237-mut-")); });
after(() => rmSync(dir, { recursive: true, force: true }));

function rewrite(text: string): string {
  const tsPath = createRequire(join(libDir, "editpropose.ts")).resolve("typescript");
  return text
    .replace(/from "\.\/([a-z0-9-]+\.ts)"/g, (_, f: string) => `from ${JSON.stringify(pathToFileURL(join(libDir, f)).href)}`)
    .replace(/from "typescript"/, `from ${JSON.stringify(pathToFileURL(tsPath).href)}`)
    .replace(/import\.meta\.dirname/g, JSON.stringify(libDir));
}

function runMutant(name: string, body: string, suite: string): Promise<{ failed: string[]; crashed: string[] } | null> {
  const file = join(dir, `mutant-${name}.ts`);
  writeFileSync(file, rewrite(body));
  return new Promise((done, fail) => {
    const child = spawn(process.execPath, [...process.execArgv, join(import.meta.dirname, "m237-mutant-runner.ts"), file, suite], { detached: true, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => { out += d; });
    child.stderr.on("data", (d) => { err += d; });
    const timer = setTimeout(() => { try { process.kill(-child.pid!, "SIGKILL"); } catch { /* gone */ } }, 60_000);
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (signal === "SIGKILL") return done(null);
      if (code !== 0) return fail(new Error(`mutant runner exited ${code}: ${err.slice(-800)}`));
      done(JSON.parse(out.trim().split("\n").pop()!));
    });
  });
}

for (const spec of Object.values(sources)) {
  const text = readFileSync(join(libDir, spec.file), "utf8");
  const lines = text.split("\n");
  const guards = lines.flatMap((line, i) => { const m = spec.tag.exec(line); return m ? [{ id: m[1]!, line: i }] : []; });
  test(`${spec.file} follow-up guard tags are present`, () => {
    assert.deepEqual(guards.map((g) => g.id).sort(), spec.tag.source.includes("ava")
      ? ["ava-banner", "ava-banner-error", "ava-cross", "ava-fail", "ava-summary-count", "ava-summary-one"]
      : ["bundle-max", "enum-roundtrip", "own-alias-block", "own-alias-init", "own-alias-optional", "own-alias-optional-proto", "own-alias-order", "own-alias-reassign", "own-alias-scope", "own-alias-shadow", "own-alias-use"]);
  });
  test(`${spec.file} unmutated follow-up cases pass`, async () => {
    const r = await runMutant(`${spec.suite}-control`, text, spec.suite);
    assert.ok(r, "hung");
    assert.deepEqual(r.crashed, []);
    assert.deepEqual(r.failed, []);
  });
  for (const guard of guards) {
    test(`deleting ${spec.suite} ${guard.id} makes a case fail`, async () => {
      const r = await runMutant(`${spec.suite}-${guard.id}`, lines.filter((_, i) => i !== guard.line).join("\n"), spec.suite);
      assert.ok(r, "hung");
      assert.deepEqual(r.crashed, [], r?.crashed.join("; "));
      assert.ok(r.failed.length > 0, `no case notices ${guard.id}`);
    });
  }
}
