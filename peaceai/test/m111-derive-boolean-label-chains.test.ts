// M111 (public-derive-from-behavior-v2, rule param dsl typed-dsl-v2): boolean label chains. A boolean parameter is an
// if-guard over constant branches / label chains; a covered all-boolean domain makes every output a constant leaf and
// is exempt from the ternary evidence bar (the program IS the examples' table); a missing input is asked, never
// guessed (gate domain); v1 (labelChains off) is unchanged and v2 answers only what v1 does not (not_needed).
// The held-out specs below were written before they were first run and were not used to build the engine (the
// engine was built against PeaceSTOCKS-shaped issue #516 only); nothing in this file names #516's function.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { compileProgram, deriveProgram, evalProgram, finiteDomain, finiteDomainCovered, gateProblem, isBooleanLabelTree, type DeriveExample, type DeriveInput, type DeriveNode, type DeriveParam, type DeriveValue } from "../lib/derive.ts";
import { buildDeriveEdit, deriveReviewNote, parseDeriveTask, runDeriveRule, validDeriveParams } from "../lib/learned-derive.ts";
import { specHash, validateSpec, type RuleSpec } from "../lib/learned.ts";

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
const V1 = JSON.parse(read("peaceai/rules/learned/public-derive-from-behavior-v1.json")) as RuleSpec;
const V2 = JSON.parse(read("peaceai/rules/learned/public-derive-from-behavior-v2.json")) as RuleSpec;
const FILES = [{ path: "src/a.ts", content: "export const a = 1;\n" }];
const B = (name: string): DeriveParam => ({ name, type: "boolean" });
const lit = (v: DeriveValue) => (typeof v === "string" ? JSON.stringify(v) : String(v));
const table = (params: DeriveParam[], f: (...a: boolean[]) => DeriveValue): DeriveExample[] => finiteDomain(params)!.map((args) => ({ args, out: f(...args) }));
const issue = (file: string, fn: string, params: DeriveParam[], ret: string, examples: DeriveExample[]) => [
  `Add a new module ${file} exporting ${fn}(${params.map((p) => `${p.name}: ${p.type}`).join(", ")}): ${ret}.`, "",
  "Behavior: a plain description of the wanted result.", "",
  `Examples (${params.map((p) => p.name).join(", ")} gives result):`,
  ...examples.map((e) => `- ${e.args.map(lit).join(", ")} gives ${lit(e.out)}`), "",
].join("\n");
/** The emitted module's function, evaluated on every input of its domain (the held-out check: no input is left out). */
const moduleFn = (content: string): ((...a: boolean[]) => DeriveValue) => {
  const m = /^export function \w+\(([^)]*)\): \w+ \{\n {2}return (.*);\n\}\n$/.exec(content);
  assert.ok(m, content);
  const names = m[1]!.split(", ").map((s) => s.split(":")[0]!);
  return new Function(...names, `return ${m[2]};`) as (...a: boolean[]) => DeriveValue;
};

// ---- Held-out positive specs (exhaustive examples) ----
const HELD_OUT: { file: string; fn: string; params: DeriveParam[]; ret: "string" | "number"; f: (...a: boolean[]) => DeriveValue }[] = [
  // an else-if chain over three booleans, four labels
  { file: "src/door-label.ts", fn: "doorLabel", params: [B("locked"), B("open"), B("alarm")], ret: "string", f: (locked, open, alarm) => (alarm ? "ALARM" : open ? "OPEN" : locked ? "LOCKED" : "CLOSED") },
  // number labels: one shown twice, two shown once
  { file: "src/retry-delay.ts", fn: "retryDelay", params: [B("timedOut"), B("rateLimited")], ret: "number", f: (timedOut, rateLimited) => (rateLimited ? 60 : timedOut ? 5 : 0) },
  // a decision tree, not a chain: four distinct labels
  { file: "src/quadrant.ts", fn: "quadrant", params: [B("east"), B("north")], ret: "string", f: (east, north) => (east ? (north ? "NE" : "SE") : north ? "NW" : "SW") },
];

test("held-out limit: a one-boolean function has 2 inputs, under the rule's 3-example minimum -> derive_examples (unchanged)", () => {
  // Recorded on the first run of the held-out specs: this spec was in HELD_OUT and was refused; v2 does not lower the
  // v1 minimum of 3 examples, so `on ? "ON" : "OFF"` is out of scope.
  const P = [B("on")];
  const r = deriveProgram({ params: P, ret: "string", examples: table(P, (on) => (on ? "ON" : "OFF")), labelChains: true });
  assert.ok(!r.ok);
  assert.equal(r.reason, "derive_examples");
  assert.equal(r.detail, "count");
});

test("held-out specs: v1 refuses each; v2 writes a module equal to the spec on EVERY input, and its test file", () => {
  for (const h of HELD_OUT) {
    const examples = table(h.params, h.f);
    const body = issue(h.file, h.fn, h.params, h.ret, examples);
    const why1: { reason?: string } = {};
    assert.equal(runDeriveRule(V1.trigger, V1.params, body, FILES, undefined, why1), null, h.fn);
    assert.equal(why1.reason, "derive_no_fit", h.fn);
    const why2: { reason?: string } = {};
    const e = runDeriveRule(V2.trigger, V2.params, body, FILES, undefined, why2);
    assert.ok(e, `${h.fn}: ${JSON.stringify(why2)}`);
    assert.equal(e.path, h.file);
    const got = moduleFn(e.content);
    for (const args of finiteDomain(h.params)!) assert.equal(got(...args), h.f(...args), `${h.fn}(${args})`);
    assert.equal(e.extra.length, 1);
    for (const ex of examples) assert.ok(e.extra[0]!.content.includes(`assert.equal(${h.fn}(${ex.args.map(lit).join(", ")}), ${lit(ex.out)});`));
  }
});

test("held-out specs: the exact expressions (smallest label chain / tree)", () => {
  const exprs = HELD_OUT.map((h) => { const r = deriveProgram({ params: h.params, ret: h.ret, examples: table(h.params, h.f), labelChains: true }); assert.ok(r.ok, h.fn); return r.fit.expr; });
  assert.deepEqual(exprs, [
    'alarm ? "ALARM" : (open ? "OPEN" : (locked ? "LOCKED" : "CLOSED"))',
    "rateLimited ? 60 : (timedOut ? 5 : 0)",
    'east ? (north ? "NE" : "SE") : (north ? "NW" : "SW")',
  ]);
});

// ---- Held-out negative specs: examples that do not fix the branch order are refused with a question ----
test("negative: any one input left out of a held-out table -> refused, asking for exactly that input", () => {
  for (const h of HELD_OUT) {
    const full = table(h.params, h.f);
    for (let k = 0; k < full.length; k++) {
      const examples = full.filter((_, j) => j !== k);
      if (new Set(examples.map((e) => JSON.stringify(e.out))).size < 2) continue; // derive_examples (one result only)
      const r = deriveProgram({ params: h.params, ret: h.ret, examples, labelChains: true });
      assert.equal(r.ok, false, `${h.fn} without ${full[k]!.args}`);
      if (r.ok) continue;
      assert.ok(r.reason === "derive_under_specified" || r.reason === "derive_ambiguous", `${h.fn}: ${r.reason}`);
      if (r.reason === "derive_under_specified") assert.equal(r.gate, "domain");
      assert.ok(r.questions?.some((q) => JSON.stringify(q.at) === JSON.stringify(full[k]!.args)), `${h.fn}: no question at ${full[k]!.args}: ${JSON.stringify(r.questions)}`);
      for (const q of r.questions ?? []) assert.ok(q.answers.length >= 2);
    }
  }
});

test("negative: a 2-boolean chain whose 4th input is missing fits both orders -> asks at it with both answers; the rule refuses", () => {
  const P = [B("dim"), B("broken")];
  const examples: DeriveExample[] = [{ args: [false, false], out: "LIT" }, { args: [true, false], out: "DIM" }, { args: [false, true], out: "BROKEN" }];
  const r = deriveProgram({ params: P, ret: "string", examples, labelChains: true });
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.reason, "derive_under_specified");
  assert.equal(r.gate, "domain");
  assert.deepEqual(r.questions, [{ at: [true, true], answers: ["BROKEN", "DIM", "LIT"] }]);
  assert.match(r.detail ?? "", /3 of the 4 possible inputs/);
  // both orders fit every given example and differ only at the missing input
  const a: DeriveNode = { op: "if", c: { op: "param", i: 1 }, t: { op: "lit", v: "BROKEN" }, e: { op: "if", c: { op: "param", i: 0 }, t: { op: "lit", v: "DIM" }, e: { op: "lit", v: "LIT" } } };
  const b: DeriveNode = { op: "if", c: { op: "param", i: 0 }, t: { op: "lit", v: "DIM" }, e: { op: "if", c: { op: "param", i: 1 }, t: { op: "lit", v: "BROKEN" }, e: { op: "lit", v: "LIT" } } };
  for (const ex of examples) { assert.equal(evalProgram(a, ex.args), ex.out); assert.equal(evalProgram(b, ex.args), ex.out); }
  assert.notEqual(evalProgram(a, [true, true]), evalProgram(b, [true, true]));
  const why: { reason?: string; questions?: string } = {};
  assert.equal(runDeriveRule(V2.trigger, V2.params, issue("src/lamp.ts", "lampState", P, "string", examples), FILES, undefined, why), null);
  assert.equal(why.reason, "derive_under_specified_domain");
  // String answers never reach the public refusal line (refusal-reason.ts formatDeriveQuestions); number answers do.
  assert.equal(why.questions, undefined);
  const N: DeriveExample[] = [{ args: [false, false], out: 0 }, { args: [true, false], out: 5 }, { args: [false, true], out: 60 }];
  const whyN: { reason?: string; questions?: string } = {};
  assert.equal(runDeriveRule(V2.trigger, V2.params, issue("src/wait.ts", "waitFor", [B("slow"), B("limited")], "number", N), FILES, undefined, whyN), null);
  assert.deepEqual(whyN, { reason: "derive_under_specified_domain", questions: "waitFor(true,true)=0|5|60" });
});

/** Deterministic PRNG (mulberry32). */
const rng = (seed: number) => () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

test("held-out random tables (seeded, 2-3 booleans, 40 tasks): never a wrong program; partial tables always refused", (t) => {
  // A random table over 3 booleans often needs a decision tree past DERIVE_MAX_SIZE (13): refused derive_no_fit, which
  // is safe. What must never happen: an emitted program that disagrees with the table, or any program from a partial one.
  const R = rng(111), POOL = ["OK", "WARN", "FAIL", "IDLE", "BUSY"];
  let derived = 0, refusedFull = 0, refusedPartial = 0;
  for (let k = 0; k < 40; k++) {
    const n = 2 + Math.floor(R() * 2), params = Array.from({ length: n }, (_, i) => B("abc"[i]!));
    const labels = POOL.slice(0, 2 + Math.floor(R() * 3));
    const outs = finiteDomain(params)!.map(() => labels[Math.floor(R() * labels.length)]!);
    if (new Set(outs).size < 2) continue;
    const full = finiteDomain(params)!.map((args, j) => ({ args, out: outs[j]! }));
    const r = deriveProgram({ params, ret: "string", examples: full, labelChains: true });
    if (r.ok) { derived++; for (const ex of full) assert.equal(evalProgram(r.fit.program, ex.args), ex.out); } else { refusedFull++; assert.equal(r.reason, "derive_no_fit", JSON.stringify(full)); }
    const drop = full.filter(() => R() < 0.3);
    const part = full.filter((e) => !drop.includes(e));
    if (!drop.length || new Set(part.map((e) => e.out)).size < 2) continue;
    const p = deriveProgram({ params, ret: "string", examples: part, labelChains: true });
    assert.equal(p.ok, false, `partial table derived: ${JSON.stringify(part)} -> ${p.ok ? p.fit.expr : ""}`);
    refusedPartial++;
  }
  t.diagnostic(`full tables derived ${derived}, full tables refused (no fit within size 13) ${refusedFull}, partial tables refused ${refusedPartial}`);
  assert.ok(derived >= 15 && refusedPartial >= 15, `${derived} / ${refusedPartial}`);
});

// ---- v1 unchanged; v2 never answers what v1 answers; the exemption is only for a covered all-boolean table ----
test("v1 mode (labelChains off) refuses boolean label tables as before; v2 is not_needed for a task v1 derives", () => {
  const P = [B("a"), B("b")];
  const r1 = deriveProgram({ params: P, ret: "string", examples: table(P, (a, b) => (a ? "X" : b ? "Y" : "Z")) });
  assert.ok(!r1.ok);
  assert.equal(r1.reason, "derive_no_fit");
  const task = parseDeriveTask(V2.trigger, issue("src/small.ts", "isSmall", [{ name: "n", type: "number" }], "boolean", [-100, -50, -10, -1, 0, 1, 3, 4, 5, 6, 7, 10, 15, 50, 100, 150].map((n) => ({ args: [n], out: n <= 5 }))));
  assert.ok("task" in task);
  const b1 = buildDeriveEdit(V1.params, task.task, FILES);
  assert.ok("edit" in b1, JSON.stringify(b1));
  assert.deepEqual(buildDeriveEdit(V2.params, task.task, FILES), { reason: "not_needed" });
});

test("the ternary bar is lifted only for a covered all-boolean label table; a mixed chain is still refused", () => {
  const P = [B("urgent"), { name: "count", type: "number" } as DeriveParam];
  // urgent -> "NOW"; else count <= 2 -> "SOON"; else "LATER" (each label shown at least twice)
  const f = (u: boolean, c: number) => (u ? "NOW" : c <= 2 ? "SOON" : "LATER");
  const examples = [[true, 0], [true, 7], [true, 3], [false, 0], [false, 1], [false, 2], [false, 3], [false, 4], [false, 9], [true, -4], [false, -10], [false, 120]].map(([u, c]) => ({ args: [u as boolean, c as number], out: f(u as boolean, c as number) }));
  const r = deriveProgram({ params: P, ret: "string", examples, labelChains: true });
  assert.equal(r.ok, false, r.ok ? r.fit.expr : "");
  const covered: DeriveInput = { params: [B("a"), B("b")], ret: "string", examples: table([B("a"), B("b")], (a, b) => (a ? "X" : b ? "Y" : "Z")), labelChains: true };
  assert.ok(finiteDomainCovered(covered));
  const ok = deriveProgram(covered);
  assert.ok(ok.ok && isBooleanLabelTree(ok.fit.program, covered.params));
  assert.equal(deriveProgram({ ...covered, labelChains: false }).ok, false);
});

test("branch gate (labelChains): a side no input of the finite domain reaches is refused; v1 keeps DERIVE_MIN_REACH", () => {
  const P = [B("a"), B("b")];
  const input: DeriveInput = { params: P, ret: "string", examples: table(P, (a, b) => (a ? "X" : b ? "Y" : "Z")), labelChains: true };
  const L = (v: string): DeriveNode => ({ op: "lit", v });
  const dead: DeriveNode = { op: "if", c: { op: "param", i: 0 }, t: { op: "if", c: { op: "param", i: 0 }, t: L("X"), e: L("Q") }, e: { op: "if", c: { op: "param", i: 1 }, t: L("Y"), e: L("Z") } };
  assert.equal(gateProblem(input, dead, 10)?.gate, "branch");
  const chain: DeriveNode = { op: "if", c: { op: "param", i: 0 }, t: L("X"), e: { op: "if", c: { op: "param", i: 1 }, t: L("Y"), e: L("Z") } };
  assert.equal(gateProblem(input, chain, 7), null);
  assert.equal(gateProblem({ ...input, labelChains: false }, chain, 7)?.gate, "branch", "v1: the inner sides have one example each");
});

test("review note: rebuilt for a v2 candidate from its diff (v1 first, then v2)", () => {
  const h = HELD_OUT[0]!;
  const e = runDeriveRule(V2.trigger, V2.params, issue(h.file, h.fn, h.params, h.ret, table(h.params, h.f)), FILES);
  assert.ok(e);
  const add = (f: { path: string; content: string }) => { const lines = f.content.replace(/\n$/, "").split("\n"); return `diff --git a/${f.path} b/${f.path}\nnew file mode 100644\nindex 0000000..1111111\n--- /dev/null\n+++ b/${f.path}\n@@ -0,0 +1,${lines.length} @@\n${lines.map((l) => `+${l}`).join("\n")}\n`; };
  const note = deriveReviewNote(add(e) + add(e.extra[0]!));
  assert.ok(note && note.includes('return alarm ? "ALARM" : (open ? "OPEN" : (locked ? "LOCKED" : "CLOSED"));'), note ?? "null");
});

test("spec v2: valid, the v1 spec with only id, minerVersion and dsl changed; hash pinned", () => {
  assert.ok(validateSpec(V2));
  assert.ok(validDeriveParams(V2.params as Record<string, unknown>, V2.minedFrom));
  const { id: _a, minerVersion: _b, params: p1, ...rest1 } = V1 as unknown as Record<string, unknown> & { params: Record<string, string> };
  const { id: _c, minerVersion: _d, params: p2, ...rest2 } = V2 as unknown as Record<string, unknown> & { params: Record<string, string> };
  assert.deepEqual(rest2, rest1);
  assert.deepEqual({ ...p2, dsl: "typed-dsl-v1" }, p1);
  assert.equal(V2.id, "public-derive-from-behavior-v2");
  assert.equal(p2.dsl, "typed-dsl-v2");
  assert.equal(specHash(V1), "799182d79506931e78a232b5729121a339c0aa584dd008479d5aacd9869f7cc1", "v1 unchanged");
  assert.equal(specHash(V2), "e11ae193d1927c4d26efb430d862763db7f9683170a6438deb7e53d98eadff8c");
  // Lesson (M85+): never assert v2 is absent from approved.json; any listed entry must pin this exact hash.
  const onMain = JSON.parse(read("peaceai/rules/approved.json")) as { rules: { id: string; sha256: string }[] };
  for (const r of onMain.rules.filter((x) => x.id === V2.id)) assert.equal(r.sha256, specHash(V2));
});
