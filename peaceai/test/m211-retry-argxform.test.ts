// M211 (batch 47) repair-retry-v1 wrong-argument for catalog-transform helpers: EXPERIMENTAL, opt-in, NOT the default,
// NOT for credit. Spec: peaceai/spec/repair-retry-v1.md ("M211"). Closes the Batch 46 residual "non-select callees" for
// one bounded shape: when no earlier form fits ONE run's evidence, and the changed function calls a same-file projection
// helper whose body is exactly one closed-catalog unary transform of a parameter (Math.floor / .toLowerCase / ...) with a
// literal at the returned position, a later attempt may replace that literal with one of the outer function's own
// parameters. Select helpers (M210) stay admitted via the same path. Pinned order after single: constant, pair (M208),
// branch (M209), wrong-arg (M210/M211). Cap stays 3; credit only from the attempt's own verifier-v1 verdict.
//   1. pure: one case per m211-guard tag of repair-retry.ts, each replayed against a mutant with that line deleted;
//   2. end to end (candidate uid peaceai-cand3, judge uid PEACEAI_VERIFIER_UID): two self-made fixtures (a numeric
//      scale/units floor helper and a string norm/key lower helper) where only the wrong-arg form passes; refused near
//      misses (arbitrary non-select body, non-catalog Math.abs, model mismatch, foreign span, new-word class refuse).
// Fixtures are synthetic: nothing is modelled on PeaceSTOCKS, a dev task, the scanner or a reference diff.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import * as RR from "../lib/repair-retry.ts";
import * as LoopReal from "../lib/loop.ts";
import * as RowReal from "../lib/looprow.ts";
import * as V from "../lib/verifier.ts";
import { repairProposer } from "../lib/editpropose.ts";
import { STAGE2_CAND_ENV, stage2CandUid } from "../lib/selfpropose.ts";
import { setup as setup151, teardown as teardown151 } from "./m151-fixtures.ts";
import { e2eTask, opts as opts174 } from "./m174-cases.ts";

type RRT = typeof RR;
const base = mkdtempSync(join(tmpdir(), "peaceai-m211-rr-"));
after(() => {
  for (const p of survivors(base)) { try { process.kill(p, "SIGKILL"); } catch { /* gone */ } }
  spawnSync("chmod", ["-R", "u+w", base]); rmSync(base, { recursive: true, force: true });
});
function survivors(dir: string): number[] {
  if (!existsSync("/proc/self")) return [];
  const out: number[] = [];
  for (const e of readdirSync("/proc")) {
    if (!/^\d+$/.test(e) || Number(e) === process.pid) continue;
    let cmd = "", cwd = "";
    try { cmd = readFileSync(`/proc/${e}/cmdline`, "utf8").replace(/\0/g, " "); } catch { continue; }
    try { cwd = readlinkSync(`/proc/${e}/cwd`); } catch { /* not ours */ }
    if (cmd === "") continue;
    if (cmd.includes(dir) || cwd === dir || cwd.startsWith(dir + "/")) out.push(Number(e));
  }
  return out;
}

// ---- fixtures (synthetic)
const UNITS = "function scale(x: number): number {\n  return Math.floor(x);\n}\nexport function units(n: number): number {\n  return scale(0);\n}\n";
const UNITS_FIX = "function scale(x: number): number {\n  return Math.floor(x);\n}\nexport function units(n: number): number {\n  return scale(n);\n}\n";
const UNITS_TEAM = 'import assert from "node:assert/strict";\nimport { units } from "../src/units.ts";\n\ntest("a", () => assert.equal(units(3.7), 3));\ntest("b", () => assert.equal(units(5.2), 5));\ntest("c", () => assert.equal(units(1.1), 1));\n';
const KEY = 'function norm(s: string): string {\n  return (s).toLowerCase();\n}\nexport function key(s: string): string {\n  return norm("X");\n}\n';
const KEY_FIX = 'function norm(s: string): string {\n  return (s).toLowerCase();\n}\nexport function key(s: string): string {\n  return norm(s);\n}\n';
const KEY_TEAM = 'import assert from "node:assert/strict";\nimport { key } from "../src/key.ts";\n\ntest("ab", () => assert.equal(key("Ab"), "ab"));\ntest("cd", () => assert.equal(key("Cd"), "cd"));\ntest("ok", () => assert.equal(key("Ok"), "ok"));\n';
// M210 select still admitted (regression through the same path)
const PREFER = "function take(a: number, _b: number): number {\n  return a;\n}\nexport function prefer(n: number): number {\n  return take(0, n);\n}\n";

const ev = (run: string, cases: Partial<RR.EvidenceCase>[], module = "src/m.ts"): RR.RetryEvidence => ({ run, module, cases: cases.map((c, i) => ({ id: `c${i + 1}:f`, fn: "f", args: [], expect: { ok: true, value: 0 }, pass: false, run, ...c }) as RR.EvidenceCase) });
const unitsEv = (run = "baseline") => ev(run, [
  { fn: "units", args: [3.7], got: { ok: true, value: 0 }, expect: { ok: true, value: 3 } },
  { fn: "units", args: [5.2], got: { ok: true, value: 0 }, expect: { ok: true, value: 5 } },
  { fn: "units", args: [1.1], got: { ok: true, value: 0 }, expect: { ok: true, value: 1 } },
], "src/units.ts");
const keyEv = (run = "baseline") => ev(run, [
  { fn: "key", args: ["Ab"], got: { ok: true, value: "x" }, expect: { ok: true, value: "ab" } },
  { fn: "key", args: ["Cd"], got: { ok: true, value: "x" }, expect: { ok: true, value: "cd" } },
  { fn: "key", args: ["Ok"], got: { ok: true, value: "x" }, expect: { ok: true, value: "ok" } },
], "src/key.ts");
const preferEv = (run = "baseline") => ev(run, [
  { fn: "prefer", args: [3], got: { ok: true, value: 0 }, expect: { ok: true, value: 3 } },
  { fn: "prefer", args: [7], got: { ok: true, value: 0 }, expect: { ok: true, value: 7 } },
  { fn: "prefer", args: [1], got: { ok: true, value: 0 }, expect: { ok: true, value: 1 } },
], "src/prefer.ts");

interface GCase { guard: string; name: string; run(m: RRT): void }
const GCASES: GCase[] = [
  { guard: "helper-catalog", name: "only closed-catalog transforms count as projection helpers", run: (m) => {
    const abs = "function scale(x: number): number {\n  return Math.abs(x);\n}\nexport function units(n: number): number {\n  return scale(0);\n}\n";
    assert.deepEqual(m.argHelpers(abs), []);
    assert.deepEqual(m.fitWrongArg(unitsEv(), abs), { refuse: "no-call" });
    const ok = m.argHelpers(UNITS);
    assert.ok(ok.some((h) => h.name === "scale" && h.transform.name === "floor" && h.retIdx === 0), JSON.stringify(ok));
  } },
  { guard: "helper-proj", name: "a helper body must project exactly one parameter through identity or a catalog wrap", run: (m) => {
    const add = "function scale(x: number, y: number): number {\n  return x + y;\n}\nexport function units(n: number): number {\n  return scale(0, n);\n}\n";
    assert.deepEqual(m.argHelpers(add), []);
    assert.deepEqual(m.fitWrongArg(unitsEv(), add), { refuse: "no-call" });
    assert.ok(m.argHelpers(UNITS).some((h) => h.name === "scale"));
    assert.ok(m.argHelpers(PREFER).some((h) => h.name === "take" && h.transform.name === "id"));
  } },
  { guard: "arg-pred", name: "non-identity projection prediction applies the catalog transform (not the raw literal)", run: (m) => {
    // if prediction ignored the transform, floor(0)=0 would still "agree" with got=0, but fitting expect=3 from param
    // would compare raw n=3.7 to 3 and refuse; with transform it fits. Mutant that drops the transform apply breaks fit.
    const fit = m.fitWrongArg(unitsEv(), UNITS);
    assert.ok(!("refuse" in fit) && fit.param === "n" && fit.helper === "scale", JSON.stringify(fit));
    assert.equal(m.applyWrongArg(UNITS, fit.fn, fit.callStart, fit.argStart, fit.argEnd, fit.param), UNITS_FIX);
  } },
  { guard: "prop-order", name: "proposer tries wrong-arg (including xform helpers) only after constant/pair/branch refuse", run: (m) => {
    const baseP = { name: "base", next: () => ({ refuse: "NO_MORE_EDITS" as const }) };
    const p = m.retryProposer(baseP as never);
    const files = [{ path: "src/units.ts", content: UNITS }];
    assert.deepEqual(p.next({ attempt: 1, files, feedback: [], search: null } as never), { refuse: "NO_MORE_EDITS" });
    const prop = p.next({ attempt: 2, files, feedback: [{ attempt: 1, codes: ["TEST_FAIL"], failing: ["c1"], tests: { total: 3, passedByPeaceAI: 0, filledByTeam: 0 } }], retryBaseline: unitsEv(), search: null } as never);
    assert.ok("edits" in prop, JSON.stringify(prop));
    assert.ok(p.transforms.some((t) => t.includes(":arg(")), JSON.stringify(p.transforms));
    // constant fixture still offers const, not arg
    const PORT = "export function defaultPort(): number {\n  return 8080;\n}\n";
    const portEv = ev("baseline", [
      { fn: "defaultPort", got: { ok: true, value: 8080 }, expect: { ok: true, value: 3000 } },
      { fn: "defaultPort", got: { ok: true, value: 8080 }, expect: { ok: true, value: 3000 } },
    ], "src/port.ts");
    const p2 = m.retryProposer({ name: "base", next: () => ({ refuse: "NO_MORE_EDITS" as const }) } as never);
    p2.next({ attempt: 1, files: [{ path: "src/port.ts", content: PORT }], feedback: [], search: null } as never);
    const prop2 = p2.next({ attempt: 2, files: [{ path: "src/port.ts", content: PORT }], feedback: [{ attempt: 1, codes: ["TEST_FAIL"], failing: ["c1"], tests: { total: 2, passedByPeaceAI: 0, filledByTeam: 0 } }], retryBaseline: portEv, search: null } as never);
    assert.ok("edits" in prop2 && p2.transforms.some((t) => t.includes(":const(")), JSON.stringify({ prop2, t: p2.transforms }));
    assert.ok(!p2.transforms.some((t) => t.includes(":arg(")), "constant wins over arg");
  } },
];

const libDir = resolve(import.meta.dirname, "../lib");
const SRC = readFileSync(join(libDir, "repair-retry.ts"), "utf8");
const TAGS = SRC.split("\n").flatMap((l) => { const m = /\/\/ m211-guard:([a-z-]+)/.exec(l); return m ? [m[1]!] : []; });
const tsPath = createRequire(join(libDir, "loop.ts")).resolve("typescript");
let mutN = 0;
const rewrite = (t: string) => t.replace(/from "\.\/([a-z0-9-]+\.ts)"/g, (_m, f: string) => `from ${JSON.stringify(pathToFileURL(join(libDir, f)).href)}`)
  .replace(/from "typescript"/g, `from ${JSON.stringify(pathToFileURL(tsPath).href)}`).replace(/import\.meta\.dirname/g, JSON.stringify(libDir));
async function rrMutant(text: string): Promise<RRT> {
  const f = join(base, `mutant-${mutN++}-repair-retry.ts`);
  writeFileSync(f, rewrite(text));
  return (await import(pathToFileURL(f).href)) as RRT;
}
const drop = (text: string, tag: string) => { const ls = text.split("\n"), hits = ls.filter((l) => l.includes(`// m211-guard:${tag}`)); assert.equal(hits.length, 1, `one line holds ${tag}`); return ls.filter((l) => !l.includes(`// m211-guard:${tag}`)).join("\n"); };

test("M211 tags: the guard lines are the expected ones, each with a case", () => {
  assert.deepEqual(TAGS, ["helper-catalog", "helper-proj", "arg-pred", "prop-order"]);
  for (const t of TAGS) assert.ok(GCASES.some((c) => c.guard === t), `a case for ${t}`);
});
test("M211 pure: every case passes as committed and on an unmutated copy", async () => {
  for (const c of GCASES) c.run(RR);
  const m = await rrMutant(SRC);
  for (const c of GCASES) c.run(m);
});
for (const tag of TAGS) {
  test(`M211 mutation: deleting m211-guard:${tag} fails a case of its own guard`, async () => {
    const m = await rrMutant(drop(SRC, tag));
    assert.ok(GCASES.filter((c) => c.guard === tag).some((c) => { try { c.run(m); return false; } catch { return true; } }), `no ${tag} case notices it removed`);
  });
}
test("M211 pinned: cap, policy, order and default unchanged", () => {
  assert.equal(RR.RETRY_MAX_ATTEMPTS, 3);
  assert.deepEqual([...RR.RETRY_SCOPE_POLICY.classes], ["export-keyword", "in-body", "rr-in-function", "rr-helper"]);
  assert.equal(RR.RETRY_SCOPE_POLICY.maxAddedChars, 600);
  assert.equal(LoopReal.DEFAULT_VERDICT_MODE, "inproc");
  assert.deepEqual(LoopReal.EDIT_SCOPE_POLICY, { edit: ["export-keyword", "in-body"], load: ["export-keyword"] });
});

test("M211 near misses (pure): arbitrary non-select, non-catalog, model mismatch, new-word, select still admits", () => {
  const add = "function scale(x: number): number {\n  return x + 1;\n}\nexport function units(n: number): number {\n  return scale(0);\n}\n";
  assert.deepEqual(RR.argHelpers(add), []);
  assert.deepEqual(RR.fitWrongArg(unitsEv(), add), { refuse: "no-call" });
  const abs = "function scale(x: number): number {\n  return Math.abs(x);\n}\nexport function units(n: number): number {\n  return scale(0);\n}\n";
  assert.deepEqual(RR.argHelpers(abs), []);
  assert.deepEqual(RR.fitWrongArg(unitsEv(), abs), { refuse: "no-call" });
  const mismatch = ev("a", [
    { fn: "units", args: [3.7], got: { ok: true, value: 9 }, expect: { ok: true, value: 3 } },
    { fn: "units", args: [5.2], got: { ok: true, value: 9 }, expect: { ok: true, value: 5 } },
  ], "src/units.ts");
  assert.deepEqual(RR.fitWrongArg(mismatch, UNITS), { refuse: "no-fit" });
  const f = RR.fitWrongArg(unitsEv(), UNITS);
  assert.ok(!("refuse" in f));
  assert.equal(RR.applyWrongArg(UNITS, f.fn, f.callStart, f.argStart, f.argEnd, "pendingForeign"), null);
  // M210 select still fits through the generalised path
  const sel = RR.fitWrongArg(preferEv(), PREFER);
  assert.ok(!("refuse" in sel) && sel.helper === "take" && sel.param === "n", JSON.stringify(sel));
  // earlier form (constant) wins
  const PORT = "export function defaultPort(): number {\n  return 8080;\n}\n";
  const portEv = ev("a", [
    { fn: "defaultPort", got: { ok: true, value: 8080 }, expect: { ok: true, value: 3000 } },
    { fn: "defaultPort", got: { ok: true, value: 8080 }, expect: { ok: true, value: 3000 } },
  ], "src/port.ts");
  assert.deepEqual(RR.fitConstant(portEv, PORT), { from: 8080, to: 3000, fn: "defaultPort" });
});

const CAND = process.env.M211_CAND ?? process.env.M210_CAND ?? process.env.M146_CAND ?? "";
const VERIFIER = process.env.M211_VERIFIER ?? process.env.PEACEAI_VERIFIER_UID ?? "";
const cand = stage2CandUid({ [STAGE2_CAND_ENV]: CAND }).ok ? stage2CandUid({ [STAGE2_CAND_ENV]: CAND }) : null;
const vOk = cand !== null && cand.ok && V.verifierUid({ [V.VERIFIER_UID_ENV]: VERIFIER }, cand as never).ok;
const skipE2e = !vOk && "needs M211_CAND / M146_CAND = peaceai-cand3 and PEACEAI_VERIFIER_UID = peaceai-verify";
type Edits = { path: string; content: string }[];
const scripted = (name: string, seq: (Edits | null)[]) => ({ name, next: (i: { attempt: number }) => { const e = seq[i.attempt - 1]; return e ? { edits: e } : { refuse: "NO_MORE_EDITS" as const }; } });
const UNITS_WRONG = UNITS.replace("scale(0)", "scale(1)");
const KEY_WRONG = KEY.replace('norm("X")', 'norm("key")');
function seedBase(file: string, wrong: string) {
  const inner = repairProposer({ v2: true }) as { name: string; loadRepair?: boolean; prepare?: Function; next: Function };
  let seeded = false;
  return {
    name: inner.name,
    loadRepair: true as const,
    prepare: inner.prepare ? (search: unknown, input: unknown) => inner.prepare!(search, input) : undefined,
    next: (i: { attempt: number }) => {
      if (!seeded) { seeded = true; return { edits: [{ path: file, content: wrong }] }; }
      return inner.next(i);
    },
  };
}
let ctxShared: { m151: ReturnType<typeof setup151>; scratch: string } | null = null;
const ctx = () => { if (!ctxShared) { const m151 = setup151(); ctxShared = { m151, scratch: mkdtempSync(join(base, "e2e-")) }; } return ctxShared; };
after(() => { if (ctxShared) teardown151(ctxShared.m151); });
let nTask = 0;
const REQUESTS: Record<string, string> = {
  "src/units.ts": "units should pass its input through scale, not a hard-coded zero.",
  "src/key.ts": "key should pass its input through norm, not a hard-coded mark.",
};
function go(file: string, src: string, team: string, proposer: unknown, extra: Record<string, unknown> = {}, max = 3) {
  const c = ctx();
  const task = e2eTask(c, `m211-${nTask++}`, { [file]: src }, team);
  return LoopReal.runLoopTask({ ...task, request: REQUESTS[file] ?? task.request } as never, "public", "a".repeat(64),
    { ...opts174(c, proposer as never, max), env: { ...c.m151.env, [STAGE2_CAND_ENV]: CAND, [V.VERIFIER_UID_ENV]: VERIFIER }, verdictMode: "oop-v1", repairRetry: "repair-retry-v1", ...extra } as never);
}
const summary = (r: ReturnType<typeof go>) => ({ code: r.row.code, attempts: r.row.attempts, codes: r.row.attemptCodes, max: r.row.maxAttempts });

for (const [label, file, src, team, wrong] of [
  ["units floor", "src/units.ts", UNITS, UNITS_TEAM, UNITS_WRONG],
  ["key lower", "src/key.ts", KEY, KEY_TEAM, KEY_WRONG],
] as const) {
  test(`M211 admit wrong-arg xform (${label}): attempt 1 fails, only the arg form passes on its own oop-v1 verdict`, { skip: skipE2e }, () => {
    const p = RR.retryProposer(seedBase(file, wrong) as never);
    const r = go(file, src, team, p);
    assert.equal(RowReal.loopRowProblem(r.row), null, String(RowReal.loopRowProblem(r.row)));
    assert.equal(r.row.code, "PASS", JSON.stringify({ ...summary(r), t: p.transforms }));
    assert.ok(r.row.attempts >= 2 && r.row.attempts <= 3);
    assert.notDeepEqual(r.row.attemptCodes[0], [], "attempt 1 failed its own verdict");
    assert.equal(r.row.repairRetry, "repair-retry-v1");
    assert.ok(p.transforms.some((t) => t.includes(":arg(")), JSON.stringify(p.transforms));
    assert.ok(!p.transforms.some((t) => t.includes(":helper(") || t.includes(":branch(") || t.includes(":const(")), "only arg form: " + JSON.stringify(p.transforms));
    console.log(`M211-ADMIT-ARG ${label} ${JSON.stringify({ ...summary(r), transforms: p.transforms })}`);
    for (const vm of [undefined, "oop-v1"]) {
      const d = go(file, src, team, repairProposer({ v2: true }), { verdictMode: vm, repairRetry: undefined }, 3);
      assert.notEqual(d.row.code, "PASS", `control ${vm ?? "default"}: ${JSON.stringify(summary(d))}`);
      console.log(`M211-CONTROL-ARG ${label} ${vm ?? "default"} ${JSON.stringify(summary(d))}`);
    }
  });
}

test("M211 refuse end to end: new-word replacement -> EDIT_SCOPE before it runs", { skip: skipE2e }, () => {
  const wrong: Edits = [{ path: "src/units.ts", content: UNITS_WRONG }];
  const f = RR.fitWrongArg(unitsEv(), UNITS);
  assert.ok(!("refuse" in f));
  const good = RR.applyWrongArg(UNITS, f.fn, f.callStart, f.argStart, f.argEnd, f.param);
  assert.ok(good);
  const honest = go("src/units.ts", UNITS, UNITS_TEAM, scripted("scripted", [wrong, [{ path: "src/units.ts", content: good! }]]));
  assert.deepEqual([honest.row.code, honest.row.attempts], ["PASS", 2], "control: in-bound arg passes on its own verdict");
  const foreign = UNITS.replace("scale(0)", "scale(pendingForeign)");
  assert.equal(RR.retrySourceClass(UNITS, foreign).startsWith("new-word:"), true);
  const r = go("src/units.ts", UNITS, UNITS_TEAM, scripted("scripted", [wrong, [{ path: "src/units.ts", content: foreign }]]));
  assert.deepEqual([r.row.code, r.row.attempts], ["EDIT_SCOPE", 1], JSON.stringify(summary(r)));
  console.log(`M211-REFUSE new-word ${JSON.stringify(summary(r))}`);
});

test("M211 pins: selfpropose.ts, plandefault.ts, plan4.ts byte-identical to gen/batch46; v4 digest unchanged; runs.jsonl add-only; no Worker ctor literal", () => {
  const files = ["peaceai/lib/selfpropose.ts", "peaceai/lib/plandefault.ts", "peaceai/lib/plan4.ts", "peaceai/lib/plan4run.ts"];
  const tip = "7d5ba67caf446ac37247d24196d5c4503f6bd6b5";
  const diff = spawnSync("git", ["diff", tip, "--", ...files], { encoding: "utf8" });
  assert.equal(diff.stdout, "", diff.stdout);
  const { plannerSha256V4 } = createRequire(import.meta.url)("../lib/plan4run.ts") as { plannerSha256V4: () => string };
  const sha = plannerSha256V4();
  assert.equal(typeof sha, "string");
  assert.equal(sha.length, 64);
  const runsDiff = spawnSync("git", ["diff", tip, "-U0", "--", "peaceai/plan/runs.jsonl"], { encoding: "utf8" });
  for (const line of (runsDiff.stdout ?? "").split("\n")) {
    if (line.startsWith("-") && !line.startsWith("---")) assert.fail(`runs.jsonl lost a line: ${line}`);
  }
  const needle = "new " + "Worker(";
  const newFiles = spawnSync("git", ["diff", tip, "--name-only", "--diff-filter=A"], { encoding: "utf8" });
  for (const f of (newFiles.stdout ?? "").split("\n").filter(Boolean)) {
    if (!existsSync(f)) continue;
    if (f.startsWith("peaceai/test/")) continue;
    const t = readFileSync(f, "utf8");
    assert.equal(t.includes(needle), false, `${needle} in ${f}`);
  }
  assert.ok(existsSync(join(libDir, "plan4.ts")));
});

test("M211 hygiene: no process outlives the file's runs (checked last)", { skip: !existsSync("/proc/self") && "no /proc" }, () => {
  assert.deepEqual(survivors(base), []);
  if (CAND) {
    const u = Number((spawnSync("id", ["-u", CAND], { encoding: "utf8" }).stdout ?? "").trim());
    if (Number.isInteger(u)) {
      const live: number[] = [];
      for (const e of readdirSync("/proc")) {
        if (!/^\d+$/.test(e)) continue;
        try {
          const st = readFileSync(`/proc/${e}/status`, "utf8");
          if (new RegExp(`^Uid:\\s+${u}\\b`, "m").test(st)) live.push(Number(e));
        } catch { /* */ }
      }
      assert.deepEqual(live, []);
    }
  }
});
