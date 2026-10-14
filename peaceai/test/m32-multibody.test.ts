// M32: MULTI_LINE_BODY v1 under Auditor's six limits. OFF by default; spec pinned; live proofs on a real editable file.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { applyMultiBody, multiBodyCredited, multiBodyEditProblem, multiBodyEnabled, MULTIBODY_MAX_LINES } from "../lib/learned-multibody.ts";
import { protectedReason } from "../lib/selfchange.ts";

const root = resolve(import.meta.dirname, "../..");
const WS = "PeaceG03/PeaceAI-Workspace", P = "src/numbers.ts";
const real = readFileSync(join(root, P), "utf8");
const SPEC_SHA256 = "5f3d916583c1fbe9adfcef9c0fc36f8776f76da4d9e83f9f93c7196132e9b041";
const avg = (inner: string) => applyMultiBody(real, "average", inner)!;
const ML = "\n  if (values.length === 0) {\n    return 0;\n  }\n  let total = 0;\n  for (const v of values) total += v;\n  return total / values.length;\n";

test("limit 6: off by default, spec sha256 pinned, rule files protected", () => {
  assert.equal(multiBodyEnabled({}), false);
  assert.equal(multiBodyEnabled({ PEACEAI_MULTIBODY: "1" }), false);
  assert.equal(multiBodyEnabled({ PEACEAI_MULTIBODY: "true" }), true);
  assert.equal(createHash("sha256").update(readFileSync(join(root, "peaceai/spec/multibody-v1.md"))).digest("hex"), SPEC_SHA256);
  for (const p of ["peaceai/lib/learned-multibody.ts", "peaceai/spec/multibody-v1.md", "peaceai/test/m32-multibody.test.ts"]) assert.ok(protectedReason(p), p);
});

test("limits 1-3 accept a multi-line rewrite of one existing body in an editable file", () => {
  assert.equal(multiBodyEditProblem(WS, P, real, avg(ML)), null);
});

test("limit 1: one existing function in an editable, non-protected file; nothing else changes", () => {
  assert.equal(multiBodyEditProblem(WS, "src/text.ts", real, avg(ML)), "path not editable");
  assert.equal(multiBodyEditProblem("PeaceG03/PeaceSTOCKS", P, real, avg(ML)), "path not editable");
  assert.equal(multiBodyEditProblem(WS, P, real, real), "no body changed");
  const two = applyMultiBody(avg(ML), "sum", "\n  return 0;\n")!;
  assert.equal(multiBodyEditProblem(WS, P, real, two), "more than one body changed");
  assert.equal(multiBodyEditProblem(WS, P, real, avg(ML).replace("MAX_RETRIES = 5", "MAX_RETRIES = 6")), "text outside the body changed");
  assert.equal(multiBodyEditProblem(WS, P, real, avg(ML) + "\nexport function extra(): number { return 1; }\n"), "functions changed");
  assert.equal(multiBodyEditProblem(WS, P, real, avg(ML).replace("number[]): number {", "number[], k = 1): number {")), "text outside the body changed", "signature");
  assert.equal(multiBodyEditProblem(WS, P, real, avg("\n  return (;\n")), "syntax error");
});

test("limit 2: at most 20 body lines", () => {
  const lines = (n: number) => "\n" + Array.from({ length: n }, (_, i) => (i === n - 1 ? "  return 0;" : `  const a${i} = ${i};`)).join("\n") + "\n";
  assert.equal(multiBodyEditProblem(WS, P, real, avg(lines(MULTIBODY_MAX_LINES))), null);
  assert.equal(multiBodyEditProblem(WS, P, real, avg(lines(MULTIBODY_MAX_LINES + 1))), "body too long");
});

test("limit 3: no new imports and no fs/net/process/child_process/eval/Function/env reach", () => {
  assert.equal(multiBodyEditProblem(WS, P, real, 'import { readFileSync } from "node:fs";\n' + avg(ML)), "imports changed");
  for (const [inner, why] of [
    ["\n  return process.env.X ? 1 : 0;\n", "process"],
    ['\n  const m = require("fs");\n  return 0;\n', "require"],
    ['\n  void import("node:child_process");\n  return 0;\n', "dynamic import"],
    ['\n  return eval("1");\n', "eval"],
    ['\n  return Function("return 1")();\n', "Function"],
    ["\n  return (values as any).constructor.constructor(\"return 1\")();\n", "constructor"],
    ['\n  return (globalThis as any)["proc" + "ess"] ? 1 : 0;\n', "globalThis"],
    ['\n  const k = "env";\n  return 0;\n', "env string"],
    ["\n  void fetch;\n  return 0;\n", "fetch"],
    ["\n  return import.meta.url.length;\n", "import.meta"],
    ["\n  debugger;\n  return 0;\n", "debugger"],
    ["\n  return Reflect.ownKeys(values).length;\n", "Reflect"],
  ] as const) assert.ok(multiBodyEditProblem(WS, P, real, avg(inner)), why);
});

/** Live proof harness: a scratch copy of this repo's src/, the real numbers.test.ts, real tsx. */
function runNumbersTest(content: string): { ok: boolean; tap: string } {
  const d = mkdtempSync(join(tmpdir(), "m32-"));
  cpSync(join(root, "src"), join(d, "src"), { recursive: true });
  writeFileSync(join(d, P), content);
  const r = spawnSync(join(root, "node_modules/.bin/tsx"), ["--test", join(d, "src/numbers.test.ts")], { encoding: "utf8", env: { ...process.env, NODE_TEST_CONTEXT: undefined } });
  return { ok: r.status === 0, tap: r.stdout + r.stderr };
}

test("limit 4 live proof: the edit restores behavior, the unedited (broken) body fails by assertion only -> credited", () => {
  const broken = avg("\n  return 0;\n");                       // the 'before' state of the task: average is wrong
  const fixed = avg(ML);                                       // a multi-line body that is correct
  assert.equal(multiBodyEditProblem(WS, P, broken, fixed), null);
  const w = runNumbersTest(fixed), wo = runNumbersTest(broken);
  assert.equal(w.ok, true, "passes with the edit");
  assert.equal(wo.ok, false, "fails without it");
  assert.equal(multiBodyCredited(w, wo), true);
});

test("limit 4 live proof: a crash without the edit is never credited", () => {
  const crash = avg('\n  throw new TypeError("x");\n');
  const w = runNumbersTest(avg(ML)), wo = runNumbersTest(crash);
  assert.equal(wo.ok, false);
  assert.equal(multiBodyCredited(w, wo), false, "TypeError is not an assertion failure");
  assert.equal(multiBodyCredited({ ok: false }, { ok: false, tap: wo.tap }), false, "the edit must pass");
  assert.equal(multiBodyCredited(w, w), false, "must fail without");
});
