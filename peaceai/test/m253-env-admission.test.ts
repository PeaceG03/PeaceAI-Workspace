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
import { envLine, type SlotRepo } from "../lib/slotfill.ts";
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
const PUBLISHED = "packages/bench/compile-matrix.ts";
const FLAG = 'export const a = process.env.ZOD_BENCH_CHILD === "1";\n';
const REFUSED = [
  "packages/bench/compile-matrix.test.ts",
  "packages/bench/compile-matrix.spec.ts",
  "test/compile-matrix.ts",
  "packages/bench/__tests__/compile-matrix.ts",
  "fixtures/compile-matrix.ts",
  "src/__fixtures__/compile-matrix.ts",
  "dist/compile-matrix.ts",
  "src/generated/compile-matrix.ts",
  "coverage/compile-matrix.ts",
  "packages/bench/compile-matrix.generated.ts",
  "vendor/compile-matrix.ts",
  "third_party/compile-matrix.ts",
  "node_modules/zod/compile-matrix.ts",
];

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

test("the published path takes the flag edit, and the slot filler names that path", () => {
  const edit = editOf(pinned, PUBLISHED).edit;
  assert.ok(edit);
  assert.equal(edit!.path, PUBLISHED);
  assert.match(edit!.content, /strictZodBenchChild\(process\.env\.ZOD_BENCH_CHILD\)/);
  assert.equal(edit!.content.includes(ZOD_FLAG), false);
  assert.match(edit!.content, /ZOD_BENCH_CHILD: "1"/);
  const line = envLine("ZOD_BENCH_CHILD", repo({ [PUBLISHED]: pinned, "src/worker.ts": "export const n = 1;\n" }));
  assert.equal(line, `make env ZOD_BENCH_CHILD strict in ${PUBLISHED} as a flag`);
  const lib = editOf(FLAG, "lib/worker.ts").edit;
  assert.ok(lib);
  assert.equal(lib!.path, "lib/worker.ts");
});

test("a test, a fixture, generated output and a vendored path are refused", () => {
  for (const path of REFUSED) {
    const got = editOf(FLAG, path);
    assert.equal(got.edit, null, path);
    assert.equal(got.reason, "path_not_plain", path);
  }
  assert.equal(editOf(FLAG, "src/../compile-matrix.ts").reason, "path_not_plain");
  assert.equal(editOf(FLAG, "src/compile-matrix.d.ts").reason, "path_not_plain");
});

test("the loose comparison does not throw and the strict helper does", (t) => {
  if (!practiceSandboxReady()) { t.skip("bwrap is not installed"); return; }
  const edit = editOf(pinned, PUBLISHED).edit;
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

test("a sentence that already states the integer bound stays a canonical line, and a duration phrase does not invent one", () => {
  assert.equal(canonicalRequest("ENV_FIX", "Make LIMIT_MS strict in lib/worker.ts as integer 1..50"), "make env LIMIT_MS strict in lib/worker.ts as integer 1..50");
  const asked = "Make LIMIT_MS strict in the worker (1 ms to 2 h)";
  assert.equal(guessFamily(model, asked).family, "ENV_FIX");
  const one = repo({ "lib/worker.ts": "export const n = Number(process.env.LIMIT_MS) > 0 ? Number(process.env.LIMIT_MS) : DELAY;\n" });
  assert.equal(canonicalRequest("ENV_FIX", asked, one), null);
  assert.equal(envLine("LIMIT_MS", one), null);
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

test("deleting the source-path guard admits the near miss, with the sandbox and without it", async (t) => {
  if (!practiceSandboxReady()) { t.skip("bwrap is not installed"); return; }
  for (const path of ["test/compile-matrix.ts", "fixtures/compile-matrix.ts", "dist/compile-matrix.ts", "vendor/compile-matrix.ts"]) {
    assert.equal(editOf(FLAG, path).reason, "path_not_plain", path);
  }
  const opened = await mutant("path-guard:source", "peaceai/lib/env-fix.ts") as { runEnvFixRule: typeof runEnvFixRule };
  let helper = "";
  for (const path of ["test/compile-matrix.ts", "fixtures/compile-matrix.ts", "dist/compile-matrix.ts", "vendor/compile-matrix.ts"]) {
    const why: { reason?: string } = {};
    const edit = opened.runEnvFixRule(spec.trigger, spec.params, `make env ZOD_BENCH_CHILD strict in ${path} as a flag`, [{ path, content: FLAG }], why);
    assert.ok(edit, `${path} ${why.reason ?? ""}`);
    helper = edit!.content.slice(edit!.content.indexOf("export function strictZodBenchChild"));
  }
  const live = probeEnvFlag("strict", pinned, helper);
  const missing = probeEnvFlag("strict", pinned, helper, "/no/such/bwrap");
  assert.equal(live.unsafe, false);
  assert.equal(live.one, true);
  assert.equal(live.threw, true);
  assert.equal(missing.unsafe, true);
  assert.equal(missing.threw, false);
  const sandboxed = await mutant("admit-guard:bwrap", "peaceai/lib/env-admit.ts") as { probeEnvFlag: typeof probeEnvFlag };
  const lied = sandboxed.probeEnvFlag("strict", pinned, helper, "/no/such/bwrap");
  assert.equal(lied.unsafe, false);
  assert.equal(lied.threw, true);
  const held = sandboxed.probeEnvFlag("strict", pinned, helper);
  assert.equal(held.unsafe, false);
  assert.equal(held.threw, true);
});
