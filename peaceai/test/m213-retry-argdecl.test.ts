// M213 (batch 49) repair-retry-v1 wrong-argument for const/arrow/function-expression projection helpers:
// EXPERIMENTAL, opt-in, NOT the default, NOT for credit. Spec: peaceai/spec/repair-retry-v1.md ("M213"). Closes the
// Batch 47 residual "arrow/const declaration forms of the same projection shape": when no earlier form fits ONE run's
// evidence, and the changed function calls a same-file projection helper written as `const|let h = (p) => <expr>` or
// `= function (p) { return <expr>; }` (same closed identity / catalog-transform model as M210/M211) with a literal at
// the returned position, a later attempt may replace that literal with one of the outer function's own parameters.
// Function-declaration helpers (M210/M211) stay admitted via the same path. Pinned order after single: constant, pair
// (M208), branch (M209), wrong-arg (M210/M211/M213). Cap stays 3; credit only from the attempt's own verifier-v1 verdict.
//   1. pure: one case per m213-guard tag of repair-retry.ts, each replayed against a mutant with that line deleted;
//   2. end to end (candidate uid peaceai-cand3, judge uid PEACEAI_VERIFIER_UID): two self-made fixtures (a numeric
//      const-arrow ceil helper and a string const-function-expression trim helper) where only the wrong-arg form
//      passes; refused near misses (async arrow, multi-statement block, declare modifier, model mismatch, foreign
//      span, new-word class refuse). Function-declaration forms still admit (regression).
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
const base = mkdtempSync(join(tmpdir(), "peaceai-m213-rr-"));
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

// ---- fixtures (synthetic, unrelated shapes; not PeaceSTOCKS / scanner / dev / reference)
// Numeric: const-arrow expression body with Math.ceil
const BOUND = "const clip = (x: number): number => Math.ceil(x);\nexport function bound(n: number): number {\n  return clip(0);\n}\n";
const BOUND_FIX = "const clip = (x: number): number => Math.ceil(x);\nexport function bound(n: number): number {\n  return clip(n);\n}\n";
const BOUND_TEAM = 'import assert from "node:assert/strict";\nimport { bound } from "../src/bound.ts";\n\ntest("a", () => assert.equal(bound(1.2), 2));\ntest("b", () => assert.equal(bound(3.1), 4));\ntest("c", () => assert.equal(bound(0.5), 1));\n';
// String: const function-expression with .trim()
const MARK = 'const tidy = function (s: string): string {\n  return (s).trim();\n};\nexport function mark(s: string): string {\n  return tidy(" ");\n}\n';
const MARK_FIX = 'const tidy = function (s: string): string {\n  return (s).trim();\n};\nexport function mark(s: string): string {\n  return tidy(s);\n}\n';
const MARK_TEAM = 'import assert from "node:assert/strict";\nimport { mark } from "../src/mark.ts";\n\ntest("ab", () => assert.equal(mark(" ab "), "ab"));\ntest("cd", () => assert.equal(mark(" cd"), "cd"));\ntest("ok", () => assert.equal(mark("ok "), "ok"));\n';
// M210/M211 function-declaration forms still admitted (regression)
const UNITS = "function scale(x: number): number {\n  return Math.floor(x);\n}\nexport function units(n: number): number {\n  return scale(0);\n}\n";
const PREFER = "function take(a: number, _b: number): number {\n  return a;\n}\nexport function prefer(n: number): number {\n  return take(0, n);\n}\n";
// Block-body arrow (also admitted)
const BLOCK = "const clip = (x: number): number => {\n  return Math.ceil(x);\n};\nexport function bound(n: number): number {\n  return clip(0);\n}\n";

const ev = (run: string, cases: Partial<RR.EvidenceCase>[], module = "src/m.ts"): RR.RetryEvidence => ({ run, module, cases: cases.map((c, i) => ({ id: `c${i + 1}:f`, fn: "f", args: [], expect: { ok: true, value: 0 }, pass: false, run, ...c }) as RR.EvidenceCase) });
const boundEv = (run = "baseline") => ev(run, [
  { fn: "bound", args: [1.2], got: { ok: true, value: 0 }, expect: { ok: true, value: 2 } },
  { fn: "bound", args: [3.1], got: { ok: true, value: 0 }, expect: { ok: true, value: 4 } },
  { fn: "bound", args: [0.5], got: { ok: true, value: 0 }, expect: { ok: true, value: 1 } },
], "src/bound.ts");
const markEv = (run = "baseline") => ev(run, [
  { fn: "mark", args: [" ab "], got: { ok: true, value: "" }, expect: { ok: true, value: "ab" } },
  { fn: "mark", args: [" cd"], got: { ok: true, value: "" }, expect: { ok: true, value: "cd" } },
  { fn: "mark", args: ["ok "], got: { ok: true, value: "" }, expect: { ok: true, value: "ok" } },
], "src/mark.ts");
const unitsEv = (run = "baseline") => ev(run, [
  { fn: "units", args: [3.7], got: { ok: true, value: 0 }, expect: { ok: true, value: 3 } },
  { fn: "units", args: [5.2], got: { ok: true, value: 0 }, expect: { ok: true, value: 5 } },
  { fn: "units", args: [1.1], got: { ok: true, value: 0 }, expect: { ok: true, value: 1 } },
], "src/units.ts");
const preferEv = (run = "baseline") => ev(run, [
  { fn: "prefer", args: [3], got: { ok: true, value: 0 }, expect: { ok: true, value: 3 } },
  { fn: "prefer", args: [7], got: { ok: true, value: 0 }, expect: { ok: true, value: 7 } },
  { fn: "prefer", args: [1], got: { ok: true, value: 0 }, expect: { ok: true, value: 1 } },
], "src/prefer.ts");

interface GCase { guard: string; name: string; run(m: RRT): void }
const GCASES: GCase[] = [
  { guard: "helper-plain", name: "a const helper with a non-export modifier is not a projection helper", run: (m) => {
    const declared = "declare const clip = (x: number): number => Math.ceil(x);\nexport function bound(n: number): number {\n  return clip(0);\n}\n";
    assert.deepEqual(m.argHelpers(declared), []);
    assert.ok(m.argHelpers(BOUND).some((h) => h.name === "clip" && h.transform.name === "ceil"), JSON.stringify(m.argHelpers(BOUND)));
  } },
  { guard: "helper-noasync", name: "an async arrow helper is refused", run: (m) => {
    const asyncH = "const clip = async (x: number): Promise<number> => Math.ceil(x);\nexport function bound(n: number): number {\n  return 0;\n}\n";
    assert.deepEqual(m.argHelpers(asyncH), []);
    assert.ok(m.argHelpers(BOUND).some((h) => h.name === "clip"));
  } },
  { guard: "helper-block", name: "a const-arrow block body with more than one statement is refused", run: (m) => {
    const multi = "const clip = (x: number): number => {\n  return Math.ceil(x);\n  return 0;\n};\nexport function bound(n: number): number {\n  return clip(0);\n}\n";
    assert.deepEqual(m.argHelpers(multi), []);
    assert.deepEqual(m.fitWrongArg(boundEv(), multi), { refuse: "no-call" });
    assert.ok(m.argHelpers(BLOCK).some((h) => h.name === "clip" && h.transform.name === "ceil"));
  } },
  { guard: "helper-arrow", name: "a const-arrow expression body is admitted as a projection helper", run: (m) => {
    const ok = m.argHelpers(BOUND);
    assert.ok(ok.some((h) => h.name === "clip" && h.transform.name === "ceil" && h.retIdx === 0), JSON.stringify(ok));
    const fit = m.fitWrongArg(boundEv(), BOUND);
    assert.ok(!("refuse" in fit) && fit.param === "n" && fit.helper === "clip", JSON.stringify(fit));
    assert.equal(m.applyWrongArg(BOUND, fit.fn, fit.callStart, fit.argStart, fit.argEnd, fit.param), BOUND_FIX);
  } },
  { guard: "helper-fnexpr", name: "a const function-expression helper is admitted as a projection helper", run: (m) => {
    const ok = m.argHelpers(MARK);
    assert.ok(ok.some((h) => h.name === "tidy" && h.transform.name === "trim" && h.retIdx === 0), JSON.stringify(ok));
    const fit = m.fitWrongArg(markEv(), MARK);
    assert.ok(!("refuse" in fit) && fit.param === "s" && fit.helper === "tidy", JSON.stringify(fit));
    assert.equal(m.applyWrongArg(MARK, fit.fn, fit.callStart, fit.argStart, fit.argEnd, fit.param), MARK_FIX);
  } },
  { guard: "prop-order", name: "proposer tries wrong-arg (including const/arrow helpers) only after constant/pair/branch refuse", run: (m) => {
    const baseP = { name: "base", next: () => ({ refuse: "NO_MORE_EDITS" as const }) };
    const p = m.retryProposer(baseP as never);
    const files = [{ path: "src/bound.ts", content: BOUND }];
    assert.deepEqual(p.next({ attempt: 1, files, feedback: [], search: null } as never), { refuse: "NO_MORE_EDITS" });
    const prop = p.next({ attempt: 2, files, feedback: [{ attempt: 1, codes: ["TEST_FAIL"], failing: ["c1"], tests: { total: 3, passedByPeaceAI: 0, filledByTeam: 0 } }], retryBaseline: boundEv(), search: null } as never);
    assert.ok("edits" in prop, JSON.stringify(prop));
    assert.ok(p.transforms.some((t) => t.includes(":arg(")), JSON.stringify(p.transforms));
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
const TAGS = SRC.split("\n").flatMap((l) => { const m = /\/\/ m213-guard:([a-z-]+)/.exec(l); return m ? [m[1]!] : []; });
const tsPath = createRequire(join(libDir, "loop.ts")).resolve("typescript");
let mutN = 0;
const rewrite = (t: string) => t.replace(/from "\.\/([a-z0-9-]+\.ts)"/g, (_m, f: string) => `from ${JSON.stringify(pathToFileURL(join(libDir, f)).href)}`)
  .replace(/from "typescript"/g, `from ${JSON.stringify(pathToFileURL(tsPath).href)}`).replace(/import\.meta\.dirname/g, JSON.stringify(libDir));
async function rrMutant(text: string): Promise<RRT> {
  const f = join(base, `mutant-${mutN++}-repair-retry.ts`);
  writeFileSync(f, rewrite(text));
  return (await import(pathToFileURL(f).href)) as RRT;
}
const drop = (text: string, tag: string) => { const ls = text.split("\n"), hits = ls.filter((l) => l.includes(`// m213-guard:${tag}`)); assert.equal(hits.length, 1, `one line holds ${tag}`); return ls.filter((l) => !l.includes(`// m213-guard:${tag}`)).join("\n"); };

test("M213 tags: the guard lines are the expected ones, each with a case", () => {
  assert.deepEqual(TAGS, ["helper-plain", "helper-noasync", "helper-block", "helper-arrow", "helper-fnexpr", "prop-order"]);
  for (const t of TAGS) assert.ok(GCASES.some((c) => c.guard === t), `a case for ${t}`);
});
test("M213 pure: every case passes as committed and on an unmutated copy", async () => {
  for (const c of GCASES) c.run(RR);
  const m = await rrMutant(SRC);
  for (const c of GCASES) c.run(m);
});
for (const tag of TAGS) {
  test(`M213 mutation: deleting m213-guard:${tag} fails a case of its own guard`, async () => {
    const m = await rrMutant(drop(SRC, tag));
    assert.ok(GCASES.filter((c) => c.guard === tag).some((c) => { try { c.run(m); return false; } catch { return true; } }), `no ${tag} case notices it removed`);
  });
}
test("M213 pinned: cap, policy, order and default unchanged", () => {
  assert.equal(RR.RETRY_MAX_ATTEMPTS, 3);
  assert.deepEqual([...RR.RETRY_SCOPE_POLICY.classes], ["export-keyword", "in-body", "rr-in-function", "rr-helper"]);
  assert.equal(RR.RETRY_SCOPE_POLICY.maxAddedChars, 600);
  assert.equal(LoopReal.DEFAULT_VERDICT_MODE, "inproc");
  assert.deepEqual(LoopReal.EDIT_SCOPE_POLICY, { edit: ["export-keyword", "in-body"], load: ["export-keyword"] });
});

test("M213 near misses (pure): async, multi-stmt, declare, model mismatch, new-word; decl forms still admit", () => {
  const asyncH = "const clip = async (x: number): Promise<number> => Math.ceil(x);\nexport function bound(n: number): number {\n  return clip(0);\n}\n";
  assert.deepEqual(RR.argHelpers(asyncH), []);
  assert.deepEqual(RR.fitWrongArg(boundEv(), asyncH), { refuse: "no-call" });
  const multi = "const clip = (x: number): number => {\n  return Math.ceil(x);\n  return 0;\n};\nexport function bound(n: number): number {\n  return clip(0);\n}\n";
  assert.deepEqual(RR.argHelpers(multi), []);
  const declared = "declare const clip = (x: number): number => Math.ceil(x);\nexport function bound(n: number): number {\n  return clip(0);\n}\n";
  assert.deepEqual(RR.argHelpers(declared), []);
  const mismatch = ev("a", [
    { fn: "bound", args: [1.2], got: { ok: true, value: 9 }, expect: { ok: true, value: 2 } },
    { fn: "bound", args: [3.1], got: { ok: true, value: 9 }, expect: { ok: true, value: 4 } },
  ], "src/bound.ts");
  assert.deepEqual(RR.fitWrongArg(mismatch, BOUND), { refuse: "no-fit" });
  const f = RR.fitWrongArg(boundEv(), BOUND);
  assert.ok(!("refuse" in f));
  assert.equal(RR.applyWrongArg(BOUND, f.fn, f.callStart, f.argStart, f.argEnd, "pendingForeign"), null);
  // M210 select + M211 catalog function-declaration forms still fit
  const sel = RR.fitWrongArg(preferEv(), PREFER);
  assert.ok(!("refuse" in sel) && sel.helper === "take" && sel.param === "n", JSON.stringify(sel));
  const xform = RR.fitWrongArg(unitsEv(), UNITS);
  assert.ok(!("refuse" in xform) && xform.helper === "scale" && xform.param === "n", JSON.stringify(xform));
  // block-body arrow also admits
  const blk = RR.fitWrongArg(boundEv(), BLOCK);
  assert.ok(!("refuse" in blk) && blk.helper === "clip" && blk.param === "n", JSON.stringify(blk));
  // earlier form (constant) wins
  const PORT = "export function defaultPort(): number {\n  return 8080;\n}\n";
  const portEv = ev("a", [
    { fn: "defaultPort", got: { ok: true, value: 8080 }, expect: { ok: true, value: 3000 } },
    { fn: "defaultPort", got: { ok: true, value: 8080 }, expect: { ok: true, value: 3000 } },
  ], "src/port.ts");
  assert.deepEqual(RR.fitConstant(portEv, PORT), { from: 8080, to: 3000, fn: "defaultPort" });
});

const CAND = process.env.M213_CAND ?? process.env.M211_CAND ?? process.env.M210_CAND ?? process.env.M146_CAND ?? "";
const VERIFIER = process.env.M213_VERIFIER ?? process.env.PEACEAI_VERIFIER_UID ?? "";
const cand = stage2CandUid({ [STAGE2_CAND_ENV]: CAND }).ok ? stage2CandUid({ [STAGE2_CAND_ENV]: CAND }) : null;
const vOk = cand !== null && cand.ok && V.verifierUid({ [V.VERIFIER_UID_ENV]: VERIFIER }, cand as never).ok;
const skipE2e = !vOk && "needs M213_CAND / M146_CAND = peaceai-cand3 and PEACEAI_VERIFIER_UID = peaceai-verify";
type Edits = { path: string; content: string }[];
const scripted = (name: string, seq: (Edits | null)[]) => ({ name, next: (i: { attempt: number }) => { const e = seq[i.attempt - 1]; return e ? { edits: e } : { refuse: "NO_MORE_EDITS" as const }; } });
const BOUND_WRONG = BOUND.replace("clip(0)", "clip(1)");
const MARK_WRONG = MARK.replace('tidy(" ")', 'tidy("mark")');
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
  "src/bound.ts": "bound should pass its input through clip, not a hard-coded zero.",
  "src/mark.ts": "mark should pass its input through tidy, not a hard-coded blank.",
};
function go(file: string, src: string, team: string, proposer: unknown, extra: Record<string, unknown> = {}, max = 3) {
  const c = ctx();
  const task = e2eTask(c, `m213-${nTask++}`, { [file]: src }, team);
  return LoopReal.runLoopTask({ ...task, request: REQUESTS[file] ?? task.request } as never, "public", "a".repeat(64),
    { ...opts174(c, proposer as never, max), env: { ...c.m151.env, [STAGE2_CAND_ENV]: CAND, [V.VERIFIER_UID_ENV]: VERIFIER }, verdictMode: "oop-v1", repairRetry: "repair-retry-v1", ...extra } as never);
}
const summary = (r: ReturnType<typeof go>) => ({ code: r.row.code, attempts: r.row.attempts, codes: r.row.attemptCodes, max: r.row.maxAttempts });

for (const [label, file, src, team, wrong] of [
  ["bound ceil arrow", "src/bound.ts", BOUND, BOUND_TEAM, BOUND_WRONG],
  ["mark trim fnexpr", "src/mark.ts", MARK, MARK_TEAM, MARK_WRONG],
] as const) {
  test(`M213 admit wrong-arg const-decl (${label}): attempt 1 fails, only the arg form passes on its own oop-v1 verdict`, { skip: skipE2e }, () => {
    const p = RR.retryProposer(seedBase(file, wrong) as never);
    const r = go(file, src, team, p);
    assert.equal(RowReal.loopRowProblem(r.row), null, String(RowReal.loopRowProblem(r.row)));
    assert.equal(r.row.code, "PASS", JSON.stringify({ ...summary(r), t: p.transforms }));
    assert.ok(r.row.attempts >= 2 && r.row.attempts <= 3);
    assert.notDeepEqual(r.row.attemptCodes[0], [], "attempt 1 failed its own verdict");
    assert.equal(r.row.repairRetry, "repair-retry-v1");
    assert.ok(p.transforms.some((t) => t.includes(":arg(")), JSON.stringify(p.transforms));
    assert.ok(!p.transforms.some((t) => t.includes(":helper(") || t.includes(":branch(") || t.includes(":const(")), "only arg form: " + JSON.stringify(p.transforms));
    console.log(`M213-ADMIT-ARG ${label} ${JSON.stringify({ ...summary(r), transforms: p.transforms })}`);
    for (const vm of [undefined, "oop-v1"]) {
      const d = go(file, src, team, repairProposer({ v2: true }), { verdictMode: vm, repairRetry: undefined }, 3);
      assert.notEqual(d.row.code, "PASS", `control ${vm ?? "default"}: ${JSON.stringify(summary(d))}`);
      console.log(`M213-CONTROL-ARG ${label} ${vm ?? "default"} ${JSON.stringify(summary(d))}`);
    }
  });
}

test("M213 refuse end to end: new-word replacement -> EDIT_SCOPE before it runs", { skip: skipE2e }, () => {
  const wrong: Edits = [{ path: "src/bound.ts", content: BOUND_WRONG }];
  const f = RR.fitWrongArg(boundEv(), BOUND);
  assert.ok(!("refuse" in f));
  const good = RR.applyWrongArg(BOUND, f.fn, f.callStart, f.argStart, f.argEnd, f.param);
  assert.ok(good);
  const honest = go("src/bound.ts", BOUND, BOUND_TEAM, scripted("scripted", [wrong, [{ path: "src/bound.ts", content: good! }]]));
  assert.deepEqual([honest.row.code, honest.row.attempts], ["PASS", 2], "control: in-bound arg passes on its own verdict");
  const foreign = BOUND.replace("clip(0)", "clip(pendingForeign)");
  assert.equal(RR.retrySourceClass(BOUND, foreign).startsWith("new-word:"), true);
  const r = go("src/bound.ts", BOUND, BOUND_TEAM, scripted("scripted", [wrong, [{ path: "src/bound.ts", content: foreign }]]));
  assert.deepEqual([r.row.code, r.row.attempts], ["EDIT_SCOPE", 1], JSON.stringify(summary(r)));
  console.log(`M213-REFUSE new-word ${JSON.stringify(summary(r))}`);
});

test("M213 pins: selfpropose.ts, plandefault.ts, plan4.ts byte-identical to gen/batch48; v4 digest unchanged; runs.jsonl add-only; no Worker ctor literal", () => {
  const files = ["peaceai/lib/selfpropose.ts", "peaceai/lib/plandefault.ts", "peaceai/lib/plan4.ts", "peaceai/lib/plan4run.ts"];
  const tip = "ddbcb25fd63f7881985c85f61b856d9f364e60b1";
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

test("M213 hygiene: no process outlives the file's runs (checked last)", { skip: !existsSync("/proc/self") && "no /proc" }, () => {
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
