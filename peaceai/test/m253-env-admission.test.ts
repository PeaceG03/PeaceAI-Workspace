// Real env-fix admission and the integer slot. Sentences and modules here are made up,
// except the pinned zod bench file, which is copied unmodified.
// Third-party bytes run only inside the practice sandbox.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { canonicalRequest, guessFamily, trainRequestModel, type FamilyRow } from "../lib/requestfamily.ts";
import { envFixLine, intEnvLine, type SlotRepo } from "../lib/slotfill.ts";
import { runEnvFixRule } from "../lib/env-fix.ts";
import { probeEnvFlag, ZOD_FLAG } from "../lib/env-admit.ts";
import { gradeBehavior } from "../lib/specgrade.ts";
import { practiceSandboxReady, visibleNodeBin } from "../lib/practicemine.ts";

const root = resolve(import.meta.dirname, "../..");
const pinnedPath = resolve(import.meta.dirname, "fixtures/m253/compile-matrix.ts.txt");
const pinned = readFileSync(pinnedPath, "utf8");
const PIN = "b55c5cc785e1db48a4dc1147041f138a0acf7c09e6a8e4ddf50c47098a50f614";
const COMMIT = "90bf57b8e96a3729d766fff3185d39b2ab3ba016";
const spec = JSON.parse(readFileSync(resolve(root, "peaceai/rules/learned/public-env-fix-v1.json"), "utf8")) as { trigger: string; params: Record<string, string> };
const log = readFileSync(resolve(root, "builder-log/tasks.jsonl"), "utf8");
const rows: FamilyRow[] = log.split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l) as FamilyRow);
const model = trainRequestModel(rows);

const repo = (files: Record<string, string>): SlotRepo => ({ files: Object.entries(files).map(([path, content]) => ({ path, content })) });
const TERNARY = "export const budgetMs = Number(process.env.LIMIT_MS) > 0 ? Number(process.env.LIMIT_MS) : DELAY;\n";
const ASK = "Make LIMIT_MS strict in the worker (1 ms to 2 h)";

function editOf(text: string, path: string) {
  const why: { reason?: string } = {};
  const edit = runEnvFixRule(spec.trigger, spec.params, `make env ZOD_BENCH_CHILD strict in ${path} as a flag`, [{ path, content: text }], why);
  return { edit, reason: why.reason ?? "" };
}

test("the zod bench pin is the published bytes", () => {
  assert.equal(createHash("sha256").update(pinned).digest("hex"), PIN);
  assert.equal(COMMIT.length, 40);
  assert.equal(pinned.includes(ZOD_FLAG), true);
});

test("the published path is refused, and the same bytes under src/ take the flag edit", () => {
  const published = editOf(pinned, "packages/bench/compile-matrix.ts");
  assert.equal(published.edit, null);
  assert.equal(published.reason, "path_not_plain");
  const edit = editOf(pinned, "src/compile-matrix.ts").edit;
  assert.ok(edit);
  assert.match(edit!.content, /strictZodBenchChild\(process\.env\.ZOD_BENCH_CHILD\)/);
  assert.equal(edit!.content.includes(ZOD_FLAG), false);
  assert.match(edit!.content, /ZOD_BENCH_CHILD: "1"/);
});

test("the loose comparison does not throw and the strict helper does", (t) => {
  if (!practiceSandboxReady()) { t.skip("bwrap is not installed"); return; }
  const edit = editOf(pinned, "src/compile-matrix.ts").edit;
  assert.ok(edit);
  const helper = edit!.content.slice(edit!.content.indexOf("export function strictZodBenchChild"));
  const before = probeEnvFlag("loose", pinned, helper);
  const after = probeEnvFlag("strict", pinned, helper);
  assert.equal(before.unsafe, false);
  assert.equal(before.one, true);
  assert.equal(before.threw, false);
  assert.equal(after.unsafe, false);
  assert.equal(after.one, true);
  assert.equal(after.threw, true);
  const missing = probeEnvFlag("strict", pinned, helper, "/no/such/bwrap");
  assert.equal(missing.unsafe, true);
  assert.equal(missing.threw, false);
});

test("an overfit that only compares to 1 is test-only, and the strict helper matches itself", (t) => {
  if (!practiceSandboxReady()) { t.skip("bwrap is not installed"); return; }
  const nodePath = visibleNodeBin();
  assert.ok(nodePath);
  const strict = "export function strictZodBenchChild(value: string | undefined): boolean {\n  const s = value?.trim() ?? \"\";\n  if (s === \"\" || s === \"0\") return false;\n  if (s === \"1\") return true;\n  throw new Error(\"ZOD_BENCH_CHILD_INVALID\");\n}\n";
  const over = "export function strictZodBenchChild(value: string | undefined): boolean {\n  return (value?.trim() ?? \"\") === \"1\";\n}\n";
  const write = (body: string) => {
    const dir = mkdtempSync(join(tmpdir(), "peaceai-m253-grade-"));
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "src/compile-matrix.ts"), body);
    return dir;
  };
  const left = write(over);
  const right = write(strict);
  const same = write(strict);
  try {
    const target = { symbol: "strictZodBenchChild", file: "src/compile-matrix.ts", form: "named" as const, exportName: "strictZodBenchChild", args: [["1"], [""], ["0"]] };
    const unfit = gradeBehavior({ candidateRoot: left, fixRoot: right, nodePath: nodePath!, target });
    assert.equal(unfit.behavior, "verified_test_only");
    const fit = gradeBehavior({ candidateRoot: same, fixRoot: right, nodePath: nodePath!, target });
    assert.equal(fit.behavior, "verified_strict");
  } finally {
    rmSync(left, { recursive: true, force: true });
    rmSync(right, { recursive: true, force: true });
    rmSync(same, { recursive: true, force: true });
  }
});

test("a duration range fills the integer line, and the near misses refuse", () => {
  assert.equal(guessFamily(model, ASK).family, "ENV_FIX");
  const one = repo({ "src/worker.ts": TERNARY });
  const line = intEnvLine("LIMIT_MS", ASK, one);
  assert.equal(line, "make env LIMIT_MS strict in src/worker.ts as integer 1..7200000");
  assert.equal(canonicalRequest("ENV_FIX", ASK, one), line);
  assert.equal(intEnvLine("LIMIT_MS", "Make LIMIT_MS strict (2 ms to 2 h)", one), null);
  assert.equal(intEnvLine("LIMIT_MS", "Make LIMIT_MS strict (1 ms to 2 h and 3 s)", one), null);
  assert.equal(intEnvLine("LIMIT_COUNT", "Make LIMIT_COUNT strict (1 ms to 2 h)", one), null);
  assert.equal(intEnvLine("LIMIT_MS", "Make LIMIT_MS strict in the worker", one), null);
  const or = repo({ "src/worker.ts": "export const n = Number(process.env.LIMIT_MS) || 5;\n" });
  assert.equal(intEnvLine("LIMIT_MS", ASK, or), null);
  const two = repo({
    "src/a.ts": TERNARY,
    "src/b.ts": TERNARY,
  });
  assert.equal(intEnvLine("LIMIT_MS", ASK, two), null);
  const flag = repo({ "src/worker.ts": 'export const on = process.env.LIMIT_MS === "1";\n' });
  assert.equal(envFixLine("LIMIT_MS", ASK, flag), 'make env LIMIT_MS strict in src/worker.ts as a flag');
  const seconds = repo({ "src/worker.ts": "export const n = Number(process.env.LIMIT_S) > 0 ? Number(process.env.LIMIT_S) : DELAY;\n" });
  assert.equal(intEnvLine("LIMIT_S", "Make LIMIT_S strict (1 s to 2 h)", seconds), "make env LIMIT_S strict in src/worker.ts as integer 1..7200");
});

const base = resolve(root, "peaceai/test/.capability-mutants");
mkdirSync(base, { recursive: true });
let n = 0;
async function mutant(guard: string, source: string) {
  const text = readFileSync(resolve(root, source), "utf8");
  const lines = text.split("\n");
  const hits = lines.flatMap((line, i) => (line.includes(`// ${guard}`) ? [i] : []));
  assert.equal(hits.length, 1, guard);
  const next = lines.filter((_, i) => i !== hits[0]).join("\n").replace(/from "\.\/([A-Za-z0-9-]+\.ts)"/g, (_m, f: string) => `from ${JSON.stringify(pathToFileURL(resolve(root, "peaceai/lib", f)).href)}`);
  const file = join(base, `mutant-${n++}.ts`);
  writeFileSync(file, next);
  return import(pathToFileURL(file).href);
}

test("deleting the integer and sandbox guards admits the near miss", async () => {
  const one = repo({ "src/worker.ts": TERNARY });
  const or = repo({ "src/worker.ts": "export const n = Number(process.env.LIMIT_MS) || 5;\n" });
  assert.equal(intEnvLine("LIMIT_MS", ASK, or), null);
  const shape = await mutant("slot-guard:int-shape", "peaceai/lib/slotfill.ts") as { intEnvLine: typeof intEnvLine };
  assert.equal(shape.intEnvLine("LIMIT_MS", ASK, or), "make env LIMIT_MS strict in src/worker.ts as integer 1..7200000");

  const two = repo({ "src/a.ts": TERNARY, "src/b.ts": TERNARY });
  assert.equal(intEnvLine("LIMIT_MS", ASK, two), null);
  const many = await mutant("slot-guard:one-int", "peaceai/lib/slotfill.ts") as { intEnvLine: typeof intEnvLine };
  assert.equal(many.intEnvLine("LIMIT_MS", ASK, two), "make env LIMIT_MS strict in src/a.ts as integer 1..7200000");

  assert.equal(intEnvLine("LIMIT_MS", "Make LIMIT_MS strict (2 ms to 2 h)", one), null);
  const bound = await mutant("slot-guard:int-bound", "peaceai/lib/slotfill.ts") as { intEnvLine: typeof intEnvLine };
  assert.equal(bound.intEnvLine("LIMIT_MS", "Make LIMIT_MS strict (2 ms to 2 h)", one), "make env LIMIT_MS strict in src/worker.ts as integer 1..7200000");

  const edit = editOf(pinned, "src/compile-matrix.ts").edit;
  assert.ok(edit);
  const helper = edit!.content.slice(edit!.content.indexOf("export function strictZodBenchChild"));
  const missing = probeEnvFlag("strict", pinned, helper, "/no/such/bwrap");
  assert.equal(missing.unsafe, true);
  const opened = await mutant("admit-guard:bwrap", "peaceai/lib/env-admit.ts") as { probeEnvFlag: typeof probeEnvFlag };
  const lied = opened.probeEnvFlag("strict", pinned, helper, "/no/such/bwrap");
  assert.equal(lied.unsafe, false);
  assert.equal(lied.threw, true);
});
