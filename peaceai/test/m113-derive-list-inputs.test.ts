// M113 (public-derive-from-behavior-v4, rule params dsl typed-dsl-v4-lists + placement new-or-existing-module):
// PeaceAI derives a small pure function whose input is a LIST (of numbers, strings, booleans or simple records, plus
// at most one scalar parameter) from behavior prose + literal examples, by a bounded search over a typed list DSL
// (peaceai/lib/derive-list.ts): count / filter / some / every where P, sum (also of the kept elements), max / min,
// map to a label or a boolean, a field of each (kept) element, the length. It refuses when more than one program
// fits, when none fits, when the examples do not show what the fit relies on, and anything with side effects.
// v1 / v2 / v3 are untouched (separate trigger, separate engine; their hashes are pinned below).
// HELD_OUT (health-check slice-2 shapes: a summary of check-ins and pruning old ones) was written before its first
// run and not used to build the engine; the first-run refusals and the rows they asked for are recorded below. It
// uses its own names (nothing here names a PeaceSTOCKS issue's function or reads scanner code).
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { APPROVED_SCHEMA } from "../lib/approved.ts";
import { compileList, deriveListProgram, evalList, listExprProblem, listGateProblem, listLit, parseListType, valueKey, type ListArg, type ListParam } from "../lib/derive-list.ts";
import { DERIVE_APPEND_TRIGGER, DERIVE_LIST_DSL, DERIVE_LIST_PLACEMENT, DERIVE_LIST_TRIGGER, DERIVE_TRIGGER, DERIVE_VOCAB, DERIVE_LIST_OPERATION, buildDeriveListEdit, deriveAppendRecheck, deriveListReviewNote, deriveModuleRecheck, deriveReviewNote, derivedListAppendProblem, derivedListModuleProblem, parseDeriveListTask, runDeriveRule, validDeriveParams } from "../lib/learned-derive.ts";
import { specHash, validateSpec, type RuleSpec } from "../lib/learned.ts";
import { PEACE_AUTHOR } from "../lib/minetest.ts";
import { DERIVE_APPEND_PHRASING, DERIVE_LIST_PHRASING, PHRASING, phrasingFor } from "../lib/propose.ts";
import { LEARNED_CANONICAL } from "../lib/nlparse.ts";
import { validateResults } from "../lib/results.ts";
import { cleanIssueText } from "../lib/taskmap.ts";

const repo = resolve(import.meta.dirname, "..", "..");
const tsx = join(repo, "node_modules/.bin/tsx");
const read = (p: string) => readFileSync(join(repo, p), "utf8");
const V1 = JSON.parse(read("peaceai/rules/learned/public-derive-from-behavior-v1.json")) as RuleSpec;
const V2 = JSON.parse(read("peaceai/rules/learned/public-derive-from-behavior-v2.json")) as RuleSpec;
const V3 = JSON.parse(read("peaceai/rules/learned/public-derive-from-behavior-v3.json")) as RuleSpec;
const V4 = JSON.parse(read("peaceai/rules/learned/public-derive-from-behavior-v4.json")) as RuleSpec;
const SHA4 = specHash(V4);
const CONFINED = Number(process.versions.node.split(".")[0]) >= 22;
const git = (cwd: string, ...a: string[]) => execFileSync("git", ["-c", "user.name=PeaceG03", "-c", `user.email=${PEACE_AUTHOR}`, ...a], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const isTest = (p: string) => /\.test\.ts$/.test(p);
type R = Record<string, string | number | boolean>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Fn = (...a: any[]) => any;
/** A spec as an issue author writes it: the signature, a reference function and the example inputs. */
type Spec = { fn: string; sig: string; ret: string; f: Fn; examples: ListArg[][]; asked: ListArg[][]; shape?: string };
const rows = (h: Spec, first = false) => [...h.examples, ...(first ? [] : h.asked)].map((args) => ({ args, out: h.f(...args) as ListArg }));
const addHead = (file: string, h: Spec) => `Add a new module \`${file}\` exporting \`${h.fn}(${h.sig}): ${h.ret}\`.`;
const appendHead = (file: string, h: Spec) => `Append a new function \`${h.fn}(${h.sig}): ${h.ret}\` to the existing module \`${file}\`.`;
/** A v4 issue, in the shape Builder files them (header, behavior prose, literal examples). */
const issue = (head: string, examples: { args: readonly ListArg[]; out: ListArg }[]) => [
  head, "",
  "Behavior: a plain description of the wanted result.", "",
  "Examples:",
  ...examples.map((e) => `- ${e.args.map((a) => listLit(a)).join(", ")} gives ${listLit(e.out)}`), "",
].join("\n");
const objective = (body: string) => cleanIssueText({ title: "list task", body } as never);

/** A realistic existing module for the append form: a type import, a constant, an interface and two functions. */
const HEALTH = `import type { Part } from "./health-types.ts";

/** Minutes after which a part counts as silent. */
export const SILENT_AFTER = 60;

export interface Checkin { part: Part; ageMin: number }

export function isSilent(c: Checkin): boolean {
  return c.ageMin > SILENT_AFTER;
}

export function describe(c: Checkin): string {
  return \`\${c.part}: \${c.ageMin} min\`;
}
`;
const HEALTH_TYPES = `export type Part = "scan" | "r2" | "tenmin";\n`;
const HEALTH_TEST = `import assert from "node:assert/strict";\nimport test from "node:test";\nimport { describe, isSilent } from "./health.ts";\n\ntest("existing", () => {\n  assert.equal(isSilent({ part: "scan", ageMin: 61 }), true);\n  assert.equal(describe({ part: "r2", ageMin: 3 }), "r2: 3 min");\n});\n`;
const FILES = [
  { path: "src/health.ts", content: HEALTH },
  { path: "src/health-types.ts", content: HEALTH_TYPES },
  { path: "src/health.test.ts", content: HEALTH_TEST },
];

/** The derived function (the block's single return expression), evaluated with the spec's parameter names. */
const derivedFn = (block: string, h: Spec): Fn => {
  const m = /^export function (\w+)\(.*\{\n {2}return (.*);\n\}\n$/s.exec(block);
  assert.ok(m && m[1] === h.fn, block);
  const names = [...h.sig.matchAll(/(?:^|, )(\w+): /g)].map((x) => x[1]!);
  return new Function(...names, `return ${m[2]};`) as Fn;
};
const body = (e: { content: string }, base = "") => {
  if (base) { assert.ok(e.content.startsWith(`${base}\n`), "add-only: the old text is a prefix, then one blank line"); return e.content.slice(base.length + 1); }
  return e.content;
};
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Writes the files into a scratch tree and runs every given test file with tsx; true when all pass. */
function runTests(files: readonly { path: string; content: string }[], tests: readonly string[]): { ok: boolean; out: string } {
  const dir = mkdtempSync(join(tmpdir(), "m113t-"));
  try {
    for (const f of files) { mkdirSync(join(dir, f.path, ".."), { recursive: true }); writeFileSync(join(dir, f.path), f.content); }
    writeFileSync(join(dir, "package.json"), '{ "type": "module" }\n');
    symlinkSync(join(repo, "node_modules"), join(dir, "node_modules"));
    // NODE_TEST_* is dropped: inherited, it makes the child runner report into this one and exit 0 regardless
    const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("NODE_TEST")));
    const r = spawnSync(tsx, ["--test", ...tests], { cwd: dir, encoding: "utf8", timeout: 120_000, env });
    return { ok: r.status === 0, out: `${r.stdout}\n${r.stderr}` };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

/** Seeded random lists for held-out checks (mulberry32, as m112). */
const rng = (seed: number) => () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const PARTS = ["scan", "r2", "tenmin", "daily", ""];
/** Random inputs for a spec: lists of 0-8 elements shaped like its first non-empty example list, values far and near. */
function probeInputs(h: Spec, seed: number, n = 150): ListArg[][] {
  const R = rng(seed);
  const int = () => { const k = R(); return k < 0.5 ? Math.floor(R() * 21) - 10 + [0, 30, 60, 90][Math.floor(R() * 4)]! : Math.floor(R() * 2001) - 1000; };
  const li = h.examples[0]!.findIndex((a) => Array.isArray(a));
  const sample = h.examples.flatMap((e) => e[li] as unknown[]).find((x) => x !== undefined);
  const scalars = h.examples.map((e) => e.filter((_, i) => i !== li));
  const value = (v: unknown): unknown => typeof v === "number" ? int() : typeof v === "boolean" ? R() < 0.5 : typeof v === "string" ? PARTS[Math.floor(R() * PARTS.length)] : Object.fromEntries(Object.entries(v as R).map(([k, x]) => [k, value(x)]));
  const out: ListArg[][] = [];
  for (let k = 0; k < n; k++) {
    const list = Array.from({ length: Math.floor(R() * 9) }, () => value(sample)) as ListArg;
    const rest = scalars[Math.floor(R() * scalars.length)]!.map((s) => (typeof s === "number" && R() < 0.5 ? int() : s));
    const args = [...rest]; args.splice(li, 0, list);
    out.push(args as ListArg[]);
  }
  return out;
}

// ---- Held-out slice-2-shaped specs (written before their first run; not used to build the engine) ----
// `examples` is what was written first. On the first run five of the eight were REFUSED, each naming what it lacked:
// four by the far gate (no element 100 or more past the cut on the low side) and totalErrors as derive_ambiguous
// (asked: totalErrors([{ part: "scan", errors: -1 }]) gives -1 or 0?). Each got one asked row, answered by the
// reference function the way an issue author would. The engine was changed twice after that first run, and the record
// in the next test is the run on the current engine (nothing in `examples` was changed):
//   - the kept gate (see the kept-gate negative); these specs derive the same programs with and without it;
//   - Auditor #523 round 2: the seed gate and unsplit predicates kept as rivals. oldestAge (a max with 0 for the
//     empty list) is now refused by the seed gate (no example has its largest ageMin below 0) and got one asked row,
//     [{ scan, -1 }]; totalErrors (a plain sum) is asked first [{ scan, -101 }] (an unsplit cut `-1 <= x.errors` is now
//     a rival) and then [{ scan, 111 }] (an unsplit cut on the high side). Its earlier asked row
//     [{ a, -1 }, { b, 2 }, { c, 0 }] is replaced by those two. Every program derived is the same as before.
const C = (part: string, ageMin: number): R => ({ part, ageMin });
const K = (part: string, ok: boolean): R => ({ part, ok });
const D = (part: string, ageDays: number): R => ({ part, ageDays });
const E = (part: string, errors: number): R => ({ part, errors });
const HELD_OUT: Spec[] = [
  { fn: "countErrored", sig: "checkins: { part: string; ok: boolean }[]", ret: "number", f: (l: R[]) => l.filter((x) => !x.ok).length,
    examples: [[[]], [[K("scan", true), K("r2", true), K("tenmin", true)]], [[K("scan", false), K("r2", true), K("tenmin", false)]], [[K("scan", false)]], [[K("r2", true), K("r2", false), K("r2", false), K("scan", false)]]], asked: [] },
  { fn: "oldestAge", sig: "checkins: { part: string; ageMin: number }[]", ret: "number", f: (l: R[]) => (l.length ? Math.max(...l.map((x) => x.ageMin as number)) : 0),
    examples: [[[]], [[C("scan", 5), C("r2", 40), C("tenmin", 12)]], [[C("scan", 90)]], [[C("a", 3), C("b", 3), C("c", 1)]], [[C("a", 0), C("b", 720), C("c", 61), C("d", 15)]]], asked: [[[C("scan", -1)]]] },
  { fn: "anySilent", sig: "checkins: { part: string; ageMin: number }[], limit: number", ret: "boolean", f: (l: R[], t: number) => l.some((x) => (x.ageMin as number) > t),
    examples: [[[], 30], [[C("scan", 5), C("r2", 10), C("tenmin", 12)], 30], [[C("scan", 31)], 30], [[C("scan", 30)], 30], [[C("r2", 29), C("scan", 45), C("x", 2)], 30], [[C("a", 100)], 60], [[C("a", 60)], 60], [[C("a", 61), C("b", 0)], 60], [[C("a", -5), C("b", 200), C("c", 3)], 15], [[C("a", 15), C("b", 15), C("c", 15)], 15]], asked: [[[C("a", -90), C("b", 0), C("c", 5)], 30]] },
  { fn: "pruneOld", sig: "checkins: { part: string; ageDays: number }[], keepDays: number", ret: "{ part: string; ageDays: number }[]", f: (l: R[], k: number) => l.filter((x) => (x.ageDays as number) <= k),
    examples: [[[], 30], [[D("scan", 0), D("r2", 30), D("tenmin", 31)], 30], [[D("a", 400), D("b", 7)], 30], [[D("a", 7), D("b", 8), D("c", 6)], 7], [[D("a", 90), D("b", 91)], 90], [[D("a", 1)], 0], [[D("a", 0), D("b", -2), D("c", 365)], 0]], asked: [[[D("a", -100), D("b", 40)], 30]] },
  { fn: "allHealthy", sig: "checkins: { ok: boolean; part: string }[]", ret: "boolean", f: (l: R[]) => l.every((x) => x.ok),
    examples: [[[]], [[K("scan", true), K("r2", true), K("tenmin", true)]], [[K("scan", true), K("r2", false), K("tenmin", true)]], [[K("scan", false)]], [[K("a", true)]]], asked: [] },
  { fn: "statusLabels", sig: "checkins: { part: string; ageMin: number }[]", ret: "string[]", f: (l: R[]) => l.map((x) => ((x.ageMin as number) > 60 ? "STALE" : "FRESH")),
    examples: [[[]], [[C("scan", 5), C("r2", 60), C("tenmin", 61)]], [[C("a", 600)]], [[C("a", 0), C("b", 59), C("c", 62), C("d", 1440)]], [[C("a", -3)]]], asked: [[[C("a", -45), C("b", 61)]]] },
  { fn: "totalErrors", sig: "checkins: { part: string; errors: number }[]", ret: "number", f: (l: R[]) => l.reduce((n, x) => n + (x.errors as number), 0),
    examples: [[[]], [[E("scan", 0), E("r2", 2), E("tenmin", 1)]], [[E("scan", 5)]], [[E("a", 10), E("b", 0), E("c", 0), E("d", 3)]]], asked: [[[E("scan", -101)]], [[E("scan", 111)]]] },
  { fn: "stalePartNames", sig: "checkins: { part: string; ageMin: number }[], limit: number", ret: "string[]", f: (l: R[], t: number) => l.filter((x) => (x.ageMin as number) > t).map((x) => x.part),
    examples: [[[], 30], [[C("scan", 5), C("r2", 31), C("tenmin", 30)], 30], [[C("a", 100), C("b", 1)], 60], [[C("a", 61), C("b", 60), C("c", 200)], 60], [[C("x", 0)], 10]], asked: [[[C("a", -50), C("b", 61)], 60]] },
];

// ---- Every shape of the DSL, one spec each (written for this test; scanCount and hasExitThree were refused on
// their first run, derive_ambiguous and derive_under_specified_far, and got one asked row each. After Auditor #523
// round 2, partNames is refused as derive_ambiguous (the unsplit cut `-1 <= x.ageMin` is a rival) and got one asked
// row; failedErrors (a sum of the kept elements) is refused by the seed gate twice, below -100 and above 100, and got
// two asked rows) ----
const F = (ok: boolean, errors: number): R => ({ ok, errors });
const SHAPES: Spec[] = [
  { shape: "length", fn: "numCheckins", sig: "parts: string[]", ret: "number", f: (l: string[]) => l.length,
    examples: [[[]], [["scan"]], [["scan", "r2", "tenmin"]], [["r2", "r2"]], [["a", "b", "c", "d"]]], asked: [] },
  { shape: "test", fn: "staleFlags", sig: "ages: number[]", ret: "boolean[]", f: (l: number[]) => l.map((x) => x > 60),
    examples: [[[]], [[60, 61, 0]], [[200, -45]], [[5, 100, 59, 62]], [[61, 61, 60]]], asked: [] },
  { shape: "pluck", fn: "partNames", sig: "checkins: { part: string; ageMin: number }[]", ret: "string[]", f: (l: R[]) => l.map((x) => x.part),
    examples: [[[]], [[C("scan", 5), C("r2", 60), C("tenmin", 61)]], [[C("a", 600)]], [[C("b", 0), C("b", 1)]]], asked: [[[C("scan", -101)]]] },
  { shape: "count eqs", fn: "scanCount", sig: "checkins: { part: string; ok: boolean }[]", ret: "number", f: (l: R[]) => l.filter((x) => x.part === "scan").length,
    examples: [[[]], [[K("scan", true), K("r2", true), K("tenmin", false)]], [[K("scan", false), K("scan", true), K("r2", false)]], [[K("tenmin", true)]], [[K("scan", true), K("r2", false), K("scan", false), K("tenmin", true)]]], asked: [[[K("scan", true)]]] },
  { shape: "filter nep", fn: "otherParts", sig: "parts: string[], name: string", ret: "string[]", f: (l: string[], n: string) => l.filter((x) => x !== n),
    examples: [[[], "scan"], [["scan", "r2", "tenmin"], "scan"], [["scan", "r2", "tenmin"], "r2"], [["a", "a", "b"], "a"], [["a"], "b"], [["r2", "scan", "r2", "x"], "r2"]], asked: [] },
  { shape: "some not", fn: "anyDown", sig: "up: boolean[]", ret: "boolean", f: (l: boolean[]) => l.some((x) => !x),
    examples: [[[]], [[true, true, true]], [[true, false, true]], [[false]], [[false, false, true, true]], [[true]]], asked: [] },
  { shape: "some eqn", fn: "hasExitThree", sig: "codes: number[]", ret: "boolean", f: (l: number[]) => l.some((x) => x === 3),
    examples: [[[]], [[0, 2, 4]], [[3]], [[1, 3, 5]], [[2, 4, 4, 0]], [[3, 3, 7]]], asked: [[[103, -97, 2]]] },
  { shape: "min", fn: "newestAge", sig: "checkins: { part: string; ageMin: number }[]", ret: "number", f: (l: R[]) => (l.length ? Math.min(...l.map((x) => x.ageMin as number)) : -1),
    examples: [[[]], [[C("scan", 5), C("r2", 40), C("tenmin", 12)]], [[C("scan", 90)]], [[C("a", 3), C("b", 3), C("c", 1)]], [[C("a", 0), C("b", 720), C("c", -61), C("d", 15)]]], asked: [] },
  { shape: "count lep", fn: "countWithin", sig: "ages: number[], limit: number", ret: "number", f: (l: number[], t: number) => l.filter((x) => x <= t).length,
    examples: [[[], 10], [[10, 11, 9], 10], [[0, 200, -150], 10], [[5, 6, 4], 5], [[50], 50], [[51, 49], 50], [[0, 1, 2], 0]], asked: [] },
  { shape: "count ltp", fn: "countBelow", sig: "ages: number[], limit: number", ret: "number", f: (l: number[], t: number) => l.filter((x) => x < t).length,
    examples: [[[], 10], [[10, 11, 9], 10], [[0, 200, -150], 10], [[5, 6, 4], 5], [[50], 50], [[51, 49], 50], [[0, 1, -1], 0]], asked: [] },
  { shape: "sum of kept", fn: "failedErrors", sig: "checkins: { ok: boolean; errors: number }[]", ret: "number", f: (l: R[]) => l.filter((x) => !x.ok).reduce((n, x) => n + (x.errors as number), 0),
    examples: [[[]], [[F(true, 3), F(false, 2), F(false, 5)]], [[F(true, 9)]], [[F(false, 4), F(true, 1), F(true, 0)]], [[F(false, 0), F(false, 7), F(true, 2), F(false, 1)]]], asked: [[[F(false, -101)]], [[F(false, 110)]]] },
  { shape: "filter ge", fn: "positives", sig: "deltas: number[]", ret: "number[]", f: (l: number[]) => l.filter((x) => x > 0),
    examples: [[[]], [[0, 1, -1]], [[150, -150, 2]], [[5, 0, 0, 3]], [[-7]]], asked: [] },
  { shape: "every gep", fn: "allAtLeast", sig: "scores: number[], floor: number", ret: "boolean", f: (l: number[], t: number) => l.every((x) => x >= t),
    examples: [[[], 5], [[5, 6, 7], 5], [[4, 6, 7], 5], [[200, -150], 0], [[0, 0, 1], 0], [[10], 11], [[11, 12, 300], 11]], asked: [] },
];

const derive = (h: Spec, head: string, first = false, files = FILES) => {
  const why: { reason?: string } = {};
  const e = runDeriveRule(V4.trigger, V4.params, objective(issue(head, rows(h, first))), files, isTest, why);
  return { e, why };
};
const NEW = (h: Spec) => addHead("src/health-sum.ts", h);

test("held-out record: the specs as first written; six refused, each naming what it lacked", () => {
  const got = HELD_OUT.map((h) => { const { e, why } = derive(h, NEW(h), true); return e ? "derived" : why.reason; });
  assert.deepEqual(got, ["derived", "derive_under_specified_seed: ageMin", "derive_under_specified_far: ageMin", "derive_under_specified_far: ageDays", "derived", "derive_under_specified_far: ageMin", "derive_ambiguous", "derive_under_specified_far: ageMin"]);
  // the refusal's own detail carries the question that the asked row answers
  const t = parseDeriveListTask(objective(issue(NEW(HELD_OUT[6]!), rows(HELD_OUT[6]!, true))));
  assert.ok("task" in t);
  const b = buildDeriveListEdit(V4.params, t.task, FILES, isTest);
  assert.ok("reason" in b && b.reason === "derive_ambiguous");
  assert.match((b as { detail?: string }).detail ?? "", /Asked: totalErrors\(\[\{ part: "scan", errors: -101 \}\]\) gives -101 or 0\?/);
  const o = parseDeriveListTask(objective(issue(NEW(HELD_OUT[1]!), rows(HELD_OUT[1]!, true))));
  assert.ok("task" in o);
  const ob = buildDeriveListEdit(V4.params, o.task, FILES, isTest);
  assert.match((ob as { detail?: string }).detail ?? "", /Asked: oldestAge\(\[\{ part: "scan", ageMin: -1 \}\]\) gives -1 or 0\?/);
  // one asked row per refusal, answered in turn (totalErrors: two refusals in a row)
  for (const h of HELD_OUT) assert.ok(h.asked.length <= (h.fn === "totalErrors" ? 2 : 1), h.fn);
});

test("held-out specs: each derives (new module and append), equal to the reference on 150 seeded random lists per spec", () => {
  const exprs: string[] = [];
  let checked = 0;
  for (const [k, h] of HELD_OUT.entries()) {
    const { e, why } = derive(h, NEW(h));
    assert.ok(e, `${h.fn}: ${why.reason}`);
    assert.equal(e.path, "src/health-sum.ts");
    assert.equal(derivedListModuleProblem(e.content), null);
    const got = derivedFn(body(e), h);
    for (const args of [...h.examples, ...h.asked, ...probeInputs(h, 113 + k)]) { assert.ok(same(got(...args), h.f(...args)), `${h.fn}(${JSON.stringify(args)})`); checked++; }
    exprs.push(/return (.*);/.exec(e.content)![1]!);
    // the same spec appended to the existing module: add-only, the same expression
    const a = derive(h, appendHead("src/health.ts", h));
    assert.ok(a.e, `${h.fn} append: ${a.why.reason}`);
    assert.equal(a.e.path, "src/health.ts");
    assert.equal(derivedListAppendProblem(HEALTH, a.e.content), null);
    assert.equal(/return (.*);\n\}\n$/.exec(body(a.e, HEALTH))![1], exprs[k]);
  }
  assert.deepEqual(exprs, [
    "checkins.filter((x) => !x.ok).length",
    "checkins.reduce((n, x, i) => (i === 0 || n <= x.ageMin ? x.ageMin : n), 0)",
    "checkins.some((x) => limit < x.ageMin)",
    "checkins.filter((x) => x.ageDays <= keepDays)",
    "checkins.every((x) => x.ok)",
    'checkins.map((x) => (x.ageMin <= 60 ? "FRESH" : "STALE"))',
    "checkins.reduce((n, x) => n + x.errors, 0)",
    "checkins.filter((x) => limit < x.ageMin).map((x) => x.part)",
  ]);
  assert.ok(checked > HELD_OUT.length * 150);
});

test("held-out specs: the module's existing test and the new tests pass with the appends; each new test fails without its function", { timeout: 600_000 }, () => {
  let content = HEALTH;
  const tests: { path: string; content: string }[] = [];
  for (const h of HELD_OUT.slice(0, 4)) {
    const { e, why } = derive(h, appendHead("src/health.ts", h), false, [{ path: "src/health.ts", content }, ...FILES.slice(1)]);
    assert.ok(e, `${h.fn}: ${why.reason}`);
    assert.equal(derivedListAppendProblem(content, e.content), null);
    content = e.content;
    tests.push(e.extra[0]!);
  }
  const files = [{ path: "src/health.ts", content }, ...FILES.slice(1), ...tests];
  const all = runTests(files, ["src/health.test.ts", ...tests.map((t) => t.path)]);
  assert.ok(all.ok, all.out);
  const without = runTests([...FILES, tests[0]!], [tests[0]!.path]);
  assert.equal(without.ok, false, "the new test fails without the derived function");
});

test("every DSL shape: one spec each derives the intended program, equal to the reference on seeded random lists", () => {
  const got: Record<string, string> = {};
  for (const [k, h] of SHAPES.entries()) {
    const { e, why } = derive(h, NEW(h));
    assert.ok(e, `${h.fn}: ${why.reason}`);
    const f = derivedFn(body(e), h);
    for (const args of [...h.examples, ...h.asked, ...probeInputs(h, 7 + k)]) assert.ok(same(f(...args), h.f(...args)), `${h.fn}(${JSON.stringify(args)})`);
    got[h.shape!] = /return (.*);/.exec(e.content)![1]!;
  }
  assert.deepEqual(got, {
    "length": "parts.length",
    "test": "ages.map((x) => 61 <= x)",
    "pluck": "checkins.map((x) => x.part)",
    "count eqs": 'checkins.filter((x) => x.part === "scan").length',
    "filter nep": "parts.filter((x) => x !== name)",
    "some not": "up.some((x) => !x)",
    "some eqn": "codes.some((x) => x === 3)",
    "min": "checkins.reduce((n, x, i) => (i === 0 || x.ageMin <= n ? x.ageMin : n), -1)",
    "count lep": "ages.filter((x) => x <= limit).length",
    "count ltp": "ages.filter((x) => x < limit).length",
    "sum of kept": "checkins.filter((x) => !x.ok).reduce((n, x) => n + x.errors, 0)",
    "filter ge": "deltas.filter((x) => 1 <= x)",
    "every gep": "scores.every((x) => floor <= x)",
  });
  // first-run refusals of the specs that needed asked rows
  assert.deepEqual(SHAPES.filter((h) => h.asked.length).map((h) => [h.fn, derive(h, NEW(h), true).why.reason]), [["partNames", "derive_ambiguous"], ["scanCount", "derive_ambiguous"], ["hasExitThree", "derive_under_specified_far: codes"], ["failedErrors", "derive_under_specified_seed: errors"]]);
});

// ---- Negatives ----
const N = (examples: ListArg[][], f: Fn, sig = "xs: number[]", ret = "number", fn = "pick"): Spec => ({ fn, sig, ret, f, examples, asked: [] });
const reason = (h: Spec, head = NEW(h)) => derive(h, head).why.reason;

test("negative: ambiguous fits are refused (two thresholds fit, a field or a filter fits, plain sum or sum of kept)", () => {
  // the examples hold 3 and 8 only around the cut: >= 4 ... >= 8 all fit
  assert.equal(reason(N([[[]], [[3, 8, 3]], [[8]], [[3]], [[-200, 200, 3]]], (l: number[]) => l.some((x) => x >= 6), "xs: number[]", "boolean")), "derive_ambiguous");
  // two boolean fields that agree on every example
  const T = (ok: boolean, up: boolean) => ({ ok, up });
  assert.equal(reason(N([[[]], [[T(true, true), T(false, false), T(true, true)]], [[T(false, false)]], [[T(true, true), T(true, true), T(false, false)]]], (l: R[]) => l.filter((x) => x.ok).length, "xs: { ok: boolean; up: boolean }[]")), "derive_ambiguous");
  // a count by part or by ok (scanCount as first written), and sum vs sum of kept (totalErrors as first written)
  const scan = SHAPES.find((h) => h.fn === "scanCount")!;
  assert.equal(derive(scan, NEW(scan), true).why.reason, "derive_ambiguous");
  assert.equal(derive(HELD_OUT[6]!, NEW(HELD_OUT[6]!), true).why.reason, "derive_ambiguous");
  // the search itself: every fit is compared, not only the smallest
  const r = deriveListProgram({ params: [{ name: "xs", type: { list: "number" } }], ret: "boolean", examples: [{ args: [[]], out: false }, { args: [[3, 8, 3]], out: true }, { args: [[3]], out: false }, { args: [[8]], out: true }] });
  assert.ok(!r.ok && r.reason === "derive_ambiguous" && (r.questions?.length ?? 0) >= 1);
});

test("negative: no program fits (string parsing, a product, an index, a running max seeded with 0) is derive_no_fit", () => {
  assert.equal(reason(N([[[]], [["1", "20", "3"]], [["7"]], [["0", "5", "250"]]], (l: string[]) => l.filter((s) => Number(s) > 4).length, "xs: string[]")), "derive_no_fit");
  assert.equal(reason(N([[[]], [[2, 3, 4]], [[5]], [[1, 1, 7]], [[-2, 3, 10]]], (l: number[]) => l.reduce((n, x) => n * x, 1))), "derive_no_fit");
  assert.equal(reason(N([[[9, 1]], [[2, 3, 4]], [[4, 3, 2]], [[1, 1, 7]], [[]]], (l: number[]) => (l.length ? l[l.length - 1]! : 0))), "derive_no_fit");
  // a running max seeded with 0 (two upstream functions in the evidence): with a list of two large elements, no fit
  const runMax = (l: number[]) => l.reduce((m, x) => Math.max(m, x), 0);
  assert.equal(reason(N([[[]], [[-5, -3, -9]], [[2, 7, 1]], [[5, 6, 2]], [[-1]], [[150, -150, 3]], [[7, 8, -150]]], runMax)), "derive_no_fit");
});

test("negative: the kept gate (found by the running-max negative): without a list holding 2 kept elements, a sum of the kept elements is not derived", () => {
  // Without [7, 8, -150], `sum of x >= 6` fits every example below and passes every other gate (on [7, 8] it gives 15,
  // the running max 8). The kept gate refuses it and names the condition; nothing outside the DSL is guessed.
  const runMax = (l: number[]) => l.reduce((m, x) => Math.max(m, x), 0);
  const h = N([[[]], [[-5, -3, -9]], [[2, 7, 1]], [[5, 6, 2]], [[-1]], [[150, -150, 3]]], runMax);
  assert.equal(reason(h), "derive_under_specified_kept: xs");
  const r = deriveListProgram({ params: [{ name: "xs", type: { list: "number" } }], ret: "number", examples: rows(h) });
  assert.ok(!r.ok && r.gate === "kept" && r.detail.includes("`6 <= x`"), JSON.stringify(r));
  // a count where at most one element is kept per list reads as "1 when any is kept" as well: refused the same way
  const once = N([[[]], [[1, 50, 2]], [[49, 3, 0]], [[51, -150]], [[150, 4]], [[-1, 5, 49]]], (l: number[]) => l.filter((x) => x >= 50).length);
  assert.equal(reason(once), "derive_under_specified_kept: xs");
});

test("negative: the gates (no empty list, no list of 3+, scalar never read, one side of P unseen, no edge, nothing far)", () => {
  assert.equal(reason(N([[[1]], [[2, 3, 4]], [[5, 6]], [[1, 1, 7]]], (l: number[]) => l.length)), "derive_under_specified_empty: xs");
  assert.equal(reason(N([[[]], [[2, 3]], [[5]], [[1, 7]]], (l: number[]) => l.length)), "derive_under_specified_many: xs");
  // (elements far on both sides and one equal to limit: the unsplit cuts and `x !== limit` would be rivals otherwise)
  assert.equal(reason(N([[[], 5], [[2, 3, 4], 5], [[5], 1], [[1, 1, 7], 9], [[-150, 150, 0], 3], [[5, 1, 0], 5]], (l: number[]) => l.length, "xs: number[], limit: number")), "derive_under_specified_unread: limit");
  // P = ok holds on one example element only (branch)
  const O = (ok: boolean) => ({ ok });
  assert.equal(reason(N([[[]], [[O(false), O(false), O(false)]], [[O(true), O(false)]], [[O(false)]]], (l: R[]) => l.filter((x) => x.ok).length, "xs: { ok: boolean }[]")), "derive_under_specified_branch: ok");
  // no element on the cut and one past it (edge): x <= limit when no element equals limit or limit + 1. A constant cut
  // with a gap is refused earlier as ambiguous (every cut inside the gap fits), so the edge gate is shown on the
  // unique fit directly as well.
  const gap = reason(N([[[], 10], [[0, 5, 20], 10], [[-150, 200, 30], 10], [[25, 1, 2], 10], [[19, 300, -3], 10]], (l: number[], t: number) => l.filter((x) => x <= t).length, "xs: number[], limit: number"));
  assert.match(gap ?? "", /^derive_(ambiguous|under_specified_edge)/);
  const P1: ListParam[] = [{ name: "xs", type: { list: "number" } }];
  const g = listGateProblem({ params: P1, ret: "number", examples: [[], [0, 5, 20], [-150, 200, 30], [25, 1, 2], [19, 300, -3]].map((l) => ({ args: [l], out: l.filter((x) => x >= 11).length })) }, { op: "count", pred: { op: "ge", f: null, c: 11 } });
  assert.equal(g?.gate, "edge");
  // the far gate (as the held-out first runs)
  assert.equal(reason(N([[[]], [[9, 10, 11]], [[12, 8, 10]], [[11, 11, 50]], [[-20, 10, 11]]], (l: number[]) => l.filter((x) => x > 10).length)), "derive_under_specified_far: xs");
});

test("negative: signature, examples and reserved names", () => {
  const parse = (head: string) => { const t = parseDeriveListTask(objective(issue(head, [{ args: [[]], out: 0 }, { args: [[1, 2, 3]], out: 3 }, { args: [[4]], out: 1 }]))); return "reason" in t ? t.reason : "ok"; };
  assert.equal(parse("Add a new module `src/x.ts` exporting `f(xs: number[]): number`."), "ok");
  // two lists, a nested list, a boolean scalar, three parameters: the trigger does not match (v4 never answers)
  for (const sig of ["xs: number[], ys: number[]", "xs: number[][]", "xs: number[], on: boolean", "xs: number[], a: number, b: number", "n: number"]) assert.equal(parse(`Add a new module \`src/x.ts\` exporting \`f(${sig}): number\`.`), "derive_trigger", sig);
  for (const field of ["constructor", "length", "toString", "valueOf"]) assert.equal(parse(`Add a new module \`src/x.ts\` exporting \`f(xs: { ${field}: number }[]): number\`.`), "derive_reserved_name", field);
  // issue-text cleaning reads __proto__ as markdown (no trigger match); uncleaned, the name gate refuses it
  assert.equal(parse("Add a new module `src/x.ts` exporting `f(xs: { __proto__: number }[]): number`."), "derive_trigger");
  const raw = parseDeriveListTask("Add a new module src/x.ts exporting f(xs: { __proto__: number }[]): number\nBehavior: a plain description of the wanted result.\nExamples:\n- [] gives 0");
  assert.deepEqual(raw, { reason: "derive_reserved_name" });
  assert.equal(parse("Add a new module `src/x.ts` exporting `f(xs: number[], xs: number): number`."), "derive_signature");
  // an optional field is not a v4 type
  assert.equal(parseListType("{ a?: number }[]"), null);
  // examples typed wrongly, or contradicting each other
  assert.equal(reason(N([[[]], [["a", "b", "c"]], [[1]]], (l: unknown[]) => l.length)), "derive_examples");
  const c = N([[[]], [[1, 2, 3]], [[1, 2, 3]], [[4]]], () => 0);
  assert.equal(derive(c, NEW(c)).why.reason, "derive_examples");
});

test("negative: side effects never pass the emit re-check (sort, push, splice, assignment, calls, globals)", () => {
  const P: ListParam[] = [{ name: "xs", type: { list: "number" } }];
  assert.equal(listExprProblem("xs.filter((x) => 1 <= x).length", P, "number"), null);
  for (const bad of ["xs.sort().length", "xs.push(1)", "xs.splice(0, 1).length", "xs.filter((x) => (x = 1) <= x).length", "xs.filter((x) => console.log(x) || 1 <= x).length", "xs.reverse().length", "globalThis.xs.length", "xs.filter((x) => 1 <= x, globalThis).length", "xs.map((x) => process.exit(1)).length"]) {
    assert.notEqual(listExprProblem(bad, P, "number"), null, bad);
  }
  const mod = (e: string) => `export function f(xs: number[]): number {\n  return ${e};\n}\n`;
  assert.equal(derivedListModuleProblem(mod("xs.length")), null);
  assert.notEqual(derivedListModuleProblem(mod("xs.sort().length")), null);
  assert.notEqual(derivedListModuleProblem(`${mod("xs.length")}export const leak = 1;\n`), null);
  assert.notEqual(derivedListModuleProblem("let n = 0;\nexport function f(xs: number[]): number {\n  return xs.length + n++;\n}\n"), null);
});

test("negative: append collisions and placement, path and derive_params refusals", () => {
  const h = HELD_OUT[0]!;
  const taken = { ...h, fn: "isSilent" };
  assert.equal(derive(taken, appendHead("src/health.ts", taken)).why.reason, "derive_append_name_collision");
  assert.equal(derive(h, appendHead("src/missing.ts", h)).why.reason, "target_file_not_found");
  assert.equal(derive(h, addHead("src/health.ts", h)).why.reason, "derive_module_exists");
  assert.equal(derive(h, addHead("src/health.test.ts", h)).why.reason, "derive_path");
  assert.equal(derive(h, appendHead("src/health.ts", h), false, [{ path: "src/health.ts", content: `${HEALTH}let n = 0;\n` }, ...FILES.slice(1)]).why.reason, "derive_append_mutable_state");
  // v4 params with another trigger, other params with the v4 trigger: derive_params
  const body4 = objective(issue(NEW(h), rows(h)));
  for (const [t, p] of [[V4.trigger, V1.params], [V4.trigger, V3.params], [DERIVE_TRIGGER, V4.params], [DERIVE_APPEND_TRIGGER, V4.params], [V4.trigger, { ...V4.params, dsl: "typed-dsl-v1" }], [V4.trigger, { ...V4.params, placement: "new-module" }]] as const) {
    const w: { reason?: string } = {};
    assert.equal(runDeriveRule(t, p as Record<string, unknown>, body4, FILES, isTest, w), null);
    assert.equal(w.reason, "derive_params");
  }
  assert.equal(validDeriveParams({ ...V4.params, dsl: "typed-dsl-v1" } as Record<string, unknown>, "public"), false);
  assert.equal(validDeriveParams({ ...V1.params, dsl: DERIVE_LIST_DSL } as Record<string, unknown>, "public"), false);
  assert.equal(validDeriveParams({ ...V1.params, placement: DERIVE_LIST_PLACEMENT } as Record<string, unknown>, "public"), false);
});

test("triggers are disjoint: no v1-v3 header matches v4 and no v4 header matches v1-v3; v1-v3 never answer a list task", () => {
  const v4Heads = [...HELD_OUT, ...SHAPES].flatMap((h) => [NEW(h), appendHead("src/health.ts", h)]).map((l) => objective(l).trim());
  const scalarHeads = ["Add a new module `src/budget.ts` exporting `isOverBudget(spent: number, budget: number): boolean`.", "Append a new function `tagLine(name: string, level: string): string` to the existing module `src/units.ts`.", "Add a new module `src/x.ts` exporting `lightColor(stop: boolean, slow: boolean): string`."].map((l) => objective(l).trim());
  for (const l of v4Heads) {
    assert.ok(new RegExp(DERIVE_LIST_TRIGGER, "imu").test(l), l);
    for (const t of [DERIVE_TRIGGER, DERIVE_APPEND_TRIGGER]) assert.ok(!new RegExp(t, "imu").test(l), l);
  }
  for (const l of scalarHeads) {
    assert.ok(!new RegExp(DERIVE_LIST_TRIGGER, "imu").test(l), l);
    assert.ok([DERIVE_TRIGGER, DERIVE_APPEND_TRIGGER].some((t) => new RegExp(t, "imu").test(l)), l);
  }
  const h = HELD_OUT[3]!;
  for (const s of [V1, V2, V3]) for (const head of [NEW(h), appendHead("src/health.ts", h)]) {
    const w: { reason?: string } = {};
    assert.equal(runDeriveRule(s.trigger, s.params, objective(issue(head, rows(h))), FILES, isTest, w), null, s.id);
    assert.equal(w.reason, undefined, s.id);
  }
  assert.equal(LEARNED_CANONICAL.deriveList.re.source, new RegExp(DERIVE_LIST_TRIGGER, "imu").source);
});

// ---- Seeded random tasks (m112 style): never a wrong program ----
type Fam = { sig: string; ret: string; f: (c: number) => Fn; rec: boolean; param?: boolean };
const FAMILIES: Fam[] = [
  { sig: "xs: { part: string; age: number; ok: boolean }[]", ret: "number", rec: true, f: (c) => (l: R[]) => l.filter((x) => (x.age as number) > c).length },
  { sig: "xs: { part: string; age: number; ok: boolean }[]", ret: "{ part: string; age: number; ok: boolean }[]", rec: true, f: (c) => (l: R[]) => l.filter((x) => (x.age as number) <= c) },
  { sig: "xs: { part: string; age: number; ok: boolean }[]", ret: "boolean", rec: true, f: (c) => (l: R[]) => l.some((x) => (x.age as number) >= c) },
  { sig: "xs: { part: string; age: number; ok: boolean }[]", ret: "boolean", rec: true, f: () => (l: R[]) => l.every((x) => x.ok) },
  { sig: "xs: { part: string; age: number; ok: boolean }[]", ret: "number", rec: true, f: () => (l: R[]) => l.filter((x) => !x.ok).reduce((n, x) => n + (x.age as number), 0) },
  { sig: "xs: { part: string; age: number; ok: boolean }[]", ret: "number", rec: true, f: () => (l: R[]) => (l.length ? Math.max(...l.map((x) => x.age as number)) : 0) },
  { sig: "xs: { part: string; age: number; ok: boolean }[]", ret: "number", rec: true, f: () => (l: R[]) => (l.length ? Math.min(...l.map((x) => x.age as number)) : -1) },
  { sig: "xs: { part: string; age: number; ok: boolean }[]", ret: "string[]", rec: true, f: (c) => (l: R[]) => l.map((x) => ((x.age as number) > c ? "OLD" : "NEW")) },
  { sig: "xs: { part: string; age: number; ok: boolean }[]", ret: "string[]", rec: true, f: (c) => (l: R[]) => l.filter((x) => (x.age as number) > c).map((x) => x.part) },
  { sig: "xs: { part: string; age: number; ok: boolean }[]", ret: "number", rec: true, f: () => (l: R[]) => l.filter((x) => x.part === "scan").length },
  { sig: "xs: number[], limit: number", ret: "number[]", rec: false, param: true, f: () => (l: number[], t: number) => l.filter((x) => x < t) },
  { sig: "xs: number[], limit: number", ret: "boolean", rec: false, param: true, f: () => (l: number[], t: number) => l.some((x) => x > t) },
  { sig: "xs: number[]", ret: "number", rec: false, f: () => (l: number[]) => l.reduce((n, x) => n + x, 0) },
  { sig: "xs: number[]", ret: "number", rec: false, f: () => (l: number[]) => l.length },
];

function seeded(seed: number, n: number) {
  const R = rng(seed);
  const pick = <T>(a: readonly T[]) => a[Math.floor(R() * a.length)]!;
  let derived = 0, refused = 0, wrong = 0, checked = 0;
  const reasons: Record<string, number> = {};
  for (let k = 0; k < n; k++) {
    const fam = FAMILIES[k % FAMILIES.length]!;
    const c = Math.floor(R() * 60) - 10;
    const near = () => c + Math.floor(R() * 5) - 2;
    const num = () => { const u = R(); return u < 0.45 ? near() : u < 0.7 ? c + Math.floor(R() * 81) - 40 : u < 0.85 ? c + 100 + Math.floor(R() * 100) : c - 100 - Math.floor(R() * 100); };
    const elem = (): ListArg => (fam.rec ? { part: pick(["scan", "r2", "tenmin"]), age: num(), ok: R() < 0.5 } : num()) as never;
    const list = (len: number) => Array.from({ length: len }, elem) as ListArg;
    const lists: ListArg[] = [[], list(3), list(4), ...Array.from({ length: 5 + Math.floor(R() * 8) }, () => list(Math.floor(R() * 7)))];
    const examples: ListArg[][] = lists.map((l) => (fam.param ? [l, near()] : [l]));
    const h: Spec = { fn: `task${k}`, sig: fam.sig, ret: fam.ret, f: fam.f(c), examples, asked: [] };
    const { e, why } = derive(h, addHead("src/rand.ts", h), false, [{ path: "src/a.ts", content: "export const a = 1;\n" }]);
    if (!e) { refused++; const r = (why.reason ?? "none").replace(/:.*/, ""); reasons[r] = (reasons[r] ?? 0) + 1; continue; }
    derived++;
    if (derivedListModuleProblem(e.content) !== null) wrong++;
    const got = derivedFn(body(e), h);
    let bad = false;
    for (const args of [...examples, ...probeInputs(h, seed * 1000 + k, 100)]) { checked++; if (!same(got(...args), h.f(...args))) bad = true; }
    if (bad) wrong++;
  }
  return { derived, refused, wrong, checked, reasons };
}

for (const seed of [112, 7, 2026]) {
  test(`seeded random list tasks (seed ${seed}, 70 tasks over 14 families): 0 wrong programs`, (t) => {
    const r = seeded(seed, 70);
    t.diagnostic(`seed ${seed}: derived ${r.derived}, refused ${r.refused} ${JSON.stringify(r.reasons)}, wrong ${r.wrong}, held-out calls ${r.checked}`);
    assert.equal(r.wrong, 0);
    assert.ok(r.derived >= 35, `${r.derived}`);
  });
}

// ---- Upstream evidence: every recorded function re-derived from its recorded examples ----
test("evidence: each derived upstream function re-derives to its recorded expression; each refused one is refused; permissive licenses only", () => {
  const ev = JSON.parse(read("peaceai/rules/proposals/m113-derive-list-evidence.json")) as { schema: string; functions: { repo: string; license: string; fn: string; params: { name: string; type: string }[]; ret: string; examples: { args: ListArg[]; out: ListArg }[]; expr?: string; refused?: string; heldOut?: { right: number; wrong: number } }[] };
  assert.equal(ev.schema, "peaceai-m113-derive-list-evidence:v1");
  let derived = 0, held = 0;
  for (const f of ev.functions) {
    assert.ok(["MIT", "Apache-2.0", "ISC"].includes(f.license), `${f.repo}: ${f.license}`);
    const params = f.params.map((p) => ({ name: p.name, type: parseListType(p.type)! }));
    const ret = parseListType(f.ret)!;
    assert.ok(params.every((p) => p.type) && ret, f.fn);
    const r = deriveListProgram({ params, ret, examples: f.examples });
    if (f.expr) {
      assert.ok(r.ok, `${f.repo} ${f.fn}: ${!r.ok && r.reason}`);
      assert.equal(compileList(r.program, params.map((p) => p.name), params.findIndex((p) => typeof p.type === "object")), f.expr, f.fn);
      assert.equal(f.heldOut?.wrong, 0);
      derived++; held += f.heldOut!.right;
    } else {
      assert.ok(!r.ok && r.reason === f.refused, f.fn);
    }
  }
  assert.equal(ev.functions.length, 28);
  assert.equal(derived, 26);
  assert.equal(held, 3144);
  assert.deepEqual(V4.evidence, { commits: 23, files: 23, hunks: 26, repos: [...new Set(ev.functions.filter((f) => f.expr).map((f) => f.repo))].sort() });
});

// ---- Review note ----
const newFile = (f: { path: string; content: string }) => { const lines = f.content.replace(/\n$/, "").split("\n"); return `diff --git a/${f.path} b/${f.path}\nnew file mode 100644\nindex 0000000..1111111\n--- /dev/null\n+++ b/${f.path}\n@@ -0,0 +1,${lines.length} @@\n${lines.map((l) => `+${l}`).join("\n")}\n`; };
const appendDiff = (path: string, before: string, after: string): string => {
  const old = before.replace(/\n$/, "").split("\n"), add = after.slice(before.length).replace(/\n$/, "").split("\n");
  const ctx = old.slice(-3);
  return `diff --git a/${path} b/${path}\nindex 1111111..2222222 100644\n--- a/${path}\n+++ b/${path}\n@@ -${old.length - ctx.length + 1},${ctx.length} +${old.length - ctx.length + 1},${ctx.length + add.length} @@\n${ctx.map((l) => ` ${l}`).join("\n")}\n${add.map((l) => `+${l}`).join("\n")}\n`;
};

test("review note: rebuilt from a new-module or an append diff (probe table included); none for a tampered diff; the v1 note stays null", () => {
  const h = HELD_OUT[3]!;
  const e = derive(h, NEW(h)).e!;
  const d = newFile(e) + newFile(e.extra[0]!);
  const note = deriveListReviewNote(d);
  assert.ok(note && note.includes("return checkins.filter((x) => x.ageDays <= keepDays);") && note.includes("pruneOld(["), note ?? "null");
  assert.equal(deriveReviewNote(d), null, "the scalar note does not read list functions");
  const a = derive(h, appendHead("src/health.ts", h)).e!;
  assert.ok(deriveListReviewNote(appendDiff(a.path, HEALTH, a.content) + newFile(a.extra[0]!)));
  assert.equal(deriveListReviewNote(newFile({ ...e, content: e.content.replace("<= keepDays", "< keepDays") }) + newFile(e.extra[0]!)), null);
  assert.equal(deriveListReviewNote(newFile({ ...e, content: e.content.replace("checkins.filter", "checkins.sort().filter") }) + newFile(e.extra[0]!)), null);
  assert.equal(deriveListReviewNote(d + newFile({ path: "src/other.ts", content: "export const o = 1;\n" })), null);
});

// ---- Spec v4 ----
test("spec v4: valid; the v3 spec with only id, minerVersion, trigger, two params and evidence changed; v1-v3 hashes pinned", () => {
  assert.ok(validateSpec(V4));
  assert.ok(validDeriveParams(V4.params as Record<string, unknown>, V4.minedFrom));
  const { id: _a, minerVersion: _b, trigger: _t3, params: p3, evidence: _e3, ...rest3 } = V3 as unknown as Record<string, unknown> & { params: Record<string, string> };
  const { id: _c, minerVersion: _d, trigger: t4, params: p4, evidence: _e4, ...rest4 } = V4 as unknown as Record<string, unknown> & { params: Record<string, string> };
  assert.deepEqual(rest4, rest3);
  assert.deepEqual({ ...p4, dsl: p3.dsl, placement: p3.placement }, p3);
  assert.deepEqual([p4.dsl, p4.placement], [DERIVE_LIST_DSL, DERIVE_LIST_PLACEMENT]);
  assert.equal(t4, DERIVE_LIST_TRIGGER);
  assert.equal(V4.id, "public-derive-from-behavior-v4");
  assert.equal(V4.minerVersion, "peaceai-miner:derive-from-behavior-v4");
  // the v1-v3 vocabulary is unchanged; the v4 pair is accepted only together (validDeriveParams)
  assert.deepEqual(DERIVE_VOCAB.dsl, ["typed-dsl-v1", "typed-dsl-v2"]);
  assert.deepEqual(DERIVE_VOCAB.placement, ["new-module", "end-of-existing-module"]);
  assert.equal(specHash(V1), "799182d79506931e78a232b5729121a339c0aa584dd008479d5aacd9869f7cc1", "v1 unchanged");
  assert.equal(specHash(V2), "e11ae193d1927c4d26efb430d862763db7f9683170a6438deb7e53d98eadff8c", "v2 unchanged");
  assert.equal(specHash(V3), "7087afcfdbe365b01816b5db0b518407733c7ce88b9d29d57392358be4bc6f8f", "v3 unchanged");
  assert.equal(SHA4, "6edd341f45c7e4486bfb727aa90a66db1fcac4f7e3e3ce7ad6bf561240d0d6f8");
  // Lesson (M85+): never assert v4 is absent from approved.json; any listed entry must pin this exact hash.
  const onMain = JSON.parse(read("peaceai/rules/approved.json")) as { rules: { id: string; sha256: string }[] };
  for (const r of onMain.rules.filter((x) => x.id === V4.id)) assert.equal(r.sha256, SHA4);
  const record = JSON.parse(read("peaceai/rules/proposals/public-derive-from-behavior-v4.json")) as { id: string; learned: string; tests: string[]; evidence: { file: string } };
  assert.equal(record.id, V4.id);
  assert.equal(record.learned, "peaceai/rules/learned/public-derive-from-behavior-v4.json");
  for (const p of [...record.tests, record.evidence.file]) assert.ok(existsSync(join(repo, p)), p);
  // the proposal body phrases the list header; v1-v3 keep theirs
  assert.equal(phrasingFor(V4), DERIVE_LIST_PHRASING);
  assert.equal(phrasingFor(V3), DERIVE_APPEND_PHRASING);
  for (const s of [V1, V2]) assert.equal(phrasingFor(s), PHRASING.DERIVE_FROM_BEHAVIOR);
});

// ---- Auditor #523 round 2 ----
// B1: a max / min seeded with a constant, a capped or a floored sum, on RANDOM examples (seeded; the Auditor's
// families, not fixed rows). Every derived program must equal the reference on 2000 random lists; refusals are fine.
const ADVERSARIAL: { name: string; f: (l: number[]) => number }[] = [
  { name: "running max from 0", f: (l) => Math.max(0, ...l) },
  { name: "running max from 5", f: (l) => Math.max(5, ...l) },
  { name: "min capped at 10", f: (l) => Math.min(10, ...l) },
  { name: "sum capped at 100", f: (l) => Math.min(100, l.reduce((a, b) => a + b, 0)) },
  { name: "sum floored at 0", f: (l) => Math.max(0, l.reduce((a, b) => a + b, 0)) },
];
const POOL = [-100, -95, 0, 1, 2, 3, 4, 5, 6, 7, 9, 10, 50, 105, 110];
function adversarial(seed: number, trials: number): Record<string, { derived: number; wrong: number; refused: number }> {
  const R = rng(seed);
  const pick = <T>(a: readonly T[]) => a[Math.floor(R() * a.length)]!;
  const wide = () => (R() < 0.5 ? pick(POOL) : Math.floor(R() * 601) - 300);
  const list = (n: number, w = false) => Array.from({ length: n }, () => (w ? wide() : pick(POOL)));
  const out: Record<string, { derived: number; wrong: number; refused: number }> = {};
  const params: ListParam[] = [{ name: "xs", type: { list: "number" } }];
  for (const fam of ADVERSARIAL) {
    const c = (out[fam.name] = { derived: 0, wrong: 0, refused: 0 });
    for (let k = 0; k < trials; k++) {
      const lists = [[], list(3 + Math.floor(R() * 4))];
      const n = 6 + Math.floor(R() * 25);
      for (let i = 2; i < n; i++) lists.push(list(Math.floor(R() * 8)));
      const examples = [...new Map(lists.map((l) => [valueKey([l]), { args: [l] as ListArg[], out: fam.f(l) }])).values()];
      const r = deriveListProgram({ params, ret: "number", examples });
      if (!r.ok) { c.refused++; continue; }
      c.derived++;
      for (let h = 0; h < 2000; h++) { const l = list(Math.floor(R() * 12), true); if (evalList(r.program, [l], 0) !== fam.f(l)) { c.wrong++; break; } }
    }
  }
  return out;
}

test("Auditor #523 B1: seeded max / min, capped and floored sums on random examples: 0 wrong over seeds 112, 7 and 2026", () => {
  for (const seed of [112, 7, 2026]) {
    const got = adversarial(seed, 40);
    for (const [name, c] of Object.entries(got)) {
      assert.equal(c.wrong, 0, `seed ${seed} ${name}: ${JSON.stringify(c)}`);
      assert.equal(c.derived + c.refused, 40);
    }
  }
});

test("Auditor #523 B1: the seed gate refuses with an asked row; answered, the max is derived (or no program fits)", () => {
  const P1: ListParam[] = [{ name: "xs", type: { list: "number" } }];
  const runMax = (l: number[]) => Math.max(0, ...l);
  const plainMax = (l: number[]) => (l.length ? Math.max(...l) : 0);
  const rowsOf = (ls: number[][], f: (l: number[]) => number) => ls.map((l) => ({ args: [l] as ListArg[], out: f(l) }));
  // the Auditor's example: before this round it derived the max with 0 for the empty list, and [-5] gave -5
  const ls = [[], [5, 40, 12], [90], [3, 3, 1], [0, 720, 61, 15]];
  const r = deriveListProgram({ params: P1, ret: "number", examples: rowsOf(ls, runMax) });
  assert.ok(!r.ok && r.reason === "derive_under_specified" && r.gate === "seed", JSON.stringify(r));
  assert.deepEqual(r.questions, [{ at: [[-1]], answers: [-1, 0] }]);
  // answered the "max, but at least 0" way: no program in the DSL fits; answered the plain-max way: derived
  assert.equal((deriveListProgram({ params: P1, ret: "number", examples: rowsOf([...ls, [-1]], runMax) }) as { reason?: string }).reason, "derive_no_fit");
  const ok = deriveListProgram({ params: P1, ret: "number", examples: rowsOf([...ls, [-1]], plainMax) });
  assert.ok(ok.ok && compileList(ok.program, ["xs"], 0) === "xs.reduce((n, x, i) => (i === 0 || n <= x ? x : n), 0)");
  // a min with the empty-list result 10 needs a list whose min is above 10
  const minR = deriveListProgram({ params: P1, ret: "number", examples: rowsOf([[], [5, 40, 12], [9], [3, 3, 1], [0, -720, 6, 1]], (l) => Math.min(10, ...l)) });
  assert.ok(!minR.ok && minR.gate === "seed" && minR.questions?.[0]?.answers[1] === 10, JSON.stringify(minR));
  // a plain sum needs a sum past -100 and past 100 (else "floored at 0" / "capped at 100" read the same examples)
  const sum = (l: number[]) => l.reduce((a, b) => a + b, 0);
  const s1 = deriveListProgram({ params: P1, ret: "number", examples: rowsOf([[], [5, 40, 12], [-150, 3], [9], [3, 3, 1], [150, -100]], sum) });
  assert.ok(!s1.ok && s1.gate === "seed" && /sum at or above 101/.test(s1.detail), JSON.stringify(s1));
  const s2 = deriveListProgram({ params: P1, ret: "number", examples: rowsOf([[], [5, 40, 12], [-150, 3], [9], [3, 3, 1], [150, -100], [150, 1]], sum) });
  assert.ok(s2.ok && compileList(s2.program, ["xs"], 0) === "xs.reduce((n, x) => n + x, 0)", JSON.stringify(s2));
});

test("Auditor #523 ruling: a condition true on every example element is a rival, not dropped (count x >= 0 vs the length)", () => {
  const P1: ListParam[] = [{ name: "xs", type: { list: "number" } }];
  const ls = [[], [1, 2, 3], [5], [0, 10, 7], [4, 4, 9, 2]];
  const r = deriveListProgram({ params: P1, ret: "number", examples: ls.map((l) => ({ args: [l], out: l.filter((x) => x >= 0).length })) });
  assert.ok(!r.ok && r.reason === "derive_ambiguous" && (r.questions?.length ?? 0) >= 1, JSON.stringify(r));
  assert.match(r.detail, /xs\.length/);
  assert.match(r.detail, /0 <= x/);
  // its asked row: one negative element far below the cut; answered, the count is derived only when a list holds
  // elements on both sides (else the gates name what is missing); the length is never chosen silently
  const q = r.questions![0]!;
  assert.ok((q.at[0] as number[]).some((x) => x < 0), JSON.stringify(q));
  const more = [...ls, [-150, 3, 4], [-1, 0, 150, -2]];
  const r2 = deriveListProgram({ params: P1, ret: "number", examples: more.map((l) => ({ args: [l], out: l.filter((x) => x >= 0).length })) });
  assert.ok(r2.ok && compileList(r2.program, ["xs"], 0) === "xs.filter((x) => 0 <= x).length", JSON.stringify(r2));
  const r3 = deriveListProgram({ params: P1, ret: "number", examples: more.map((l) => ({ args: [l], out: l.length })) });
  assert.ok(r3.ok && compileList(r3.program, ["xs"], 0) === "xs.length", JSON.stringify(r3));
});

test("Auditor #523 B2: Job B re-checks a derive module by the candidate's own rule id; reserved record fields are refused", () => {
  const sha = (s: RuleSpec) => `learned:${s.id}@${specHash(s)}`;
  const v4mod = "export function pick(xs: number[]): number {\n  return xs.filter((x) => 5 <= x).length;\n}\n";
  const v1mod = "export function twice(n: number): number {\n  return n * 2;\n}\n";
  assert.equal(sha(V4).startsWith(DERIVE_LIST_OPERATION), true);
  assert.equal(deriveModuleRecheck(sha(V4), v4mod), null);
  // v1, v2 and v3 candidates: exactly the pre-M113 re-check (derivedModuleProblem), so v4-shaped code is refused
  for (const s of [V1, V2, V3]) {
    assert.notEqual(deriveModuleRecheck(sha(s), v4mod), null, s.id);
    assert.notEqual(deriveAppendRecheck(sha(s), HEALTH, `${HEALTH}\n${v4mod}`), null, s.id);
  }
  assert.notEqual(deriveModuleRecheck(undefined, v4mod), null);
  assert.equal(deriveAppendRecheck(sha(V4), HEALTH, `${HEALTH}\n${v4mod}`), null);
  // and a v4 candidate never passes with a v1 module either
  assert.notEqual(deriveModuleRecheck(sha(V4), v1mod), null);
  // reserved record field names (the parse refuses them; the re-check on the diff alone does too)
  for (const f of ["constructor", "__proto__", "length", "toString"]) {
    const m = `export function pick(xs: { ${f}: number; s: string }[]): number {\n  return xs.filter((x) => 5 <= x.${f}).length;\n}\n`;
    assert.equal(derivedListModuleProblem(m), "derive_reserved_name", f);
    assert.notEqual(deriveModuleRecheck(sha(V4), m), null, f);
    const ret = `export function pick(xs: { a: number; s: string }[]): { ${f}: number; s: string }[] {\n  return xs;\n}\n`;
    assert.notEqual(derivedListModuleProblem(ret), null, `${f} in the result type`);
  }
});

// ---- Job A (generate.ts) and Job B (test-candidates.ts) end to end, with v4 on a temporary approved list ----
const entry = { id: V4.id, sha256: SHA4, source: "workspace", approval: { url: "https://github.com/PeaceG03/PeaceAI-Workspace/issues/41#issuecomment-123", commentId: 123, issue: 41, repo: "PeaceG03/PeaceAI-Workspace", author: "PeaceG03", approvedAt: "2026-10-26T00:00:00Z" } };
const TSCONFIG = JSON.stringify({ compilerOptions: { target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", strict: true, noEmit: true, allowImportingTsExtensions: true }, include: ["src"] });

function fakeKernel(dir: string): string {
  const file = join(dir, "fake-kernel.cjs");
  writeFileSync(file, `const crypto = require("node:crypto");
exports.NATIVE_CODE_SYNTHESIS_PROTOCOL_VERSION = "x";
exports.sourceFingerprint = (p, c) => crypto.createHash("sha256").update(p + "\\0" + c).digest("hex");
exports.PeaceAINativeCodeSynthesizer = class { synthesize() { return { status: "INSUFFICIENT" }; } };
exports.parsePlanSteps = () => null;
`);
  return file;
}
function workspace(dir: string): { ws: string; baseSha: string } {
  const ws = join(dir, "ws");
  mkdirSync(join(ws, "src"), { recursive: true });
  for (const f of FILES) writeFileSync(join(ws, f.path), f.content);
  writeFileSync(join(ws, "tsconfig.json"), TSCONFIG);
  writeFileSync(join(ws, "package.json"), '{ "type": "module" }\n');
  writeFileSync(join(ws, ".gitignore"), "node_modules\n");
  symlinkSync(join(repo, "node_modules"), join(ws, "node_modules"));
  git(ws, "init", "-q", "-b", "main"); git(ws, "add", "-A"); git(ws, "commit", "-qm", "base");
  return { ws, baseSha: git(ws, "rev-parse", "HEAD").trim() };
}

for (const form of ["new module", "append"] as const) {
  test(`Job A: an approved v4 makes one ${form} candidate whose review note is rebuilt from its own diff`, () => {
    const dir = mkdtempSync(join(tmpdir(), "m113a-"));
    try {
      const { ws } = workspace(dir);
      const rules = join(dir, "rules");
      mkdirSync(rules);
      writeFileSync(join(rules, `${V4.id}.json`), JSON.stringify(V4));
      const list = join(dir, "approved.json");
      writeFileSync(list, JSON.stringify({ schema: APPROVED_SCHEMA, rules: [entry] }));
      const out = join(dir, "out");
      const h = HELD_OUT[0]!;
      const BODY = issue(form === "append" ? appendHead("src/health.ts", h) : NEW(h), rows(h));
      const r = spawnSync(tsx, [join(repo, "peaceai/bin/generate.ts")], {
        cwd: repo, encoding: "utf8", timeout: 300_000,
        env: { ...process.env, PEACEAI_NL_PARSE: "off", PEACEAI_KERNEL_BUNDLE: fakeKernel(dir), PEACEAI_OUT_DIR: out, PEACEAI_WORKSPACE_DIR: ws, PEACEAI_TARGET: "PeaceG03/PeaceAI-Workspace", ISSUE_NUMBER: "9", ISSUE_TITLE: "list task", ISSUE_BODY: BODY, PEACEAI_RULES_DIR: rules, PEACEAI_APPROVED_LIST: list },
      });
      assert.equal(r.status, 0, r.stderr);
      const summary = JSON.parse(readFileSync(join(out, "summary.json"), "utf8")) as { candidates: { file: string; transformations: string[] }[] };
      assert.equal(summary.candidates.length, 1, r.stdout);
      assert.deepEqual(summary.candidates[0]!.transformations, ["LEARNED_DERIVE_FROM_BEHAVIOR"]);
      const diff = readFileSync(join(out, summary.candidates[0]!.file), "utf8");
      assert.doesNotMatch(diff, /^-(?!--)/m, "no removed line");
      if (form === "append") assert.match(diff, /^--- a\/src\/health\.ts$/m); else assert.match(diff, /^\+\+\+ b\/src\/health-sum\.ts$/m);
      assert.ok(deriveListReviewNote(diff), "the review note is rebuilt from Job A's own diff");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
}

function grade(dir: string, ws: string, baseSha: string, diff: string, operationId = `learned:${V4.id}@${SHA4}`) {
  const inDir = join(dir, "in");
  rmSync(inDir, { recursive: true, force: true });
  mkdirSync(join(inDir, "candidates"), { recursive: true });
  writeFileSync(join(inDir, "candidates", "candidate-1.diff"), diff);
  const candidates = [{ id: "candidate-1", file: "candidates/candidate-1.diff", transformations: ["LEARNED_DERIVE_FROM_BEHAVIOR"], operationId, diffBytes: diff.length, diffLines: 5, selfGrade: true as const }];
  writeFileSync(join(inDir, "summary.json"), JSON.stringify({ schema: "peaceai-workspace-candidates:v1", taskId: "workspace-issue-9", baseSha, candidates }));
  const list = join(dir, "approved.json");
  writeFileSync(list, JSON.stringify({ schema: APPROVED_SCHEMA, rules: [entry, ...[V1, V3].map((x, i) => ({ ...entry, id: x.id, sha256: specHash(x), approval: { ...entry.approval, url: `https://github.com/PeaceG03/PeaceAI-Workspace/issues/41#issuecomment-${124 + i}`, commentId: 124 + i } }))] }));
  const out = join(dir, "out");
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("NODE_TEST")));
  const r = spawnSync(tsx, [join(repo, "peaceai/bin/test-candidates.ts")], {
    cwd: repo, encoding: "utf8", timeout: 600_000,
    env: { ...env, TZ: "UTC", PEACEAI_IN_DIR: inDir, PEACEAI_RESULTS_FILE: join(out, "results.json"), PEACEAI_WORKSPACE_DIR: ws, PEACEAI_TARGET: "PeaceG03/PeaceAI-Workspace", PEACEAI_SANDBOX_USER: "", PEACEAI_REQUIRE_SANDBOX: "", PEACEAI_APPROVED_LIST: list },
  });
  assert.equal(r.status, 0, r.stderr);
  const results = JSON.parse(readFileSync(join(out, "results.json"), "utf8"));
  assert.ok(validateResults(results));
  return { g: results.results[0].testGrading as { verdict: string; reason: string | null; stubFails?: boolean }, stdout: r.stdout };
}

test("Job B: the v4 new module and the v4 append COUNT; a side effect, an extra statement or a v1 / v3 id is not-test-only", { skip: !CONFINED && "Node < 22: derive candidates grade not-confined", timeout: 900_000 }, () => {
  const dir = mkdtempSync(join(tmpdir(), "m113b-"));
  try {
    const { ws, baseSha } = workspace(dir);
    const h = HELD_OUT[3]!;
    const diffOf = (e: { path: string; extra: { path: string; content: string }[] }, content: string) => {
      writeFileSync(join(ws, e.path), content);
      writeFileSync(join(ws, e.extra[0]!.path), e.extra[0]!.content);
      git(ws, "add", "-N", "--", e.path, e.extra[0]!.path);
      const d = git(ws, "diff", "--no-color", "--full-index", "--no-renames");
      git(ws, "reset", "-q", "--hard"); git(ws, "clean", "-fdq");
      return d;
    };
    const n = derive(h, NEW(h)).e!;
    const good = grade(dir, ws, baseSha, diffOf(n, n.content));
    assert.equal(good.g.verdict, "COUNTS", good.stdout);
    assert.equal(good.g.stubFails, true);
    const a = derive(h, appendHead("src/health.ts", h)).e!;
    const goodA = grade(dir, ws, baseSha, diffOf(a, a.content));
    assert.equal(goodA.g.verdict, "COUNTS", goodA.stdout);
    const sorted = grade(dir, ws, baseSha, diffOf(n, n.content.replace("checkins.filter", "checkins.sort().filter")));
    assert.deepEqual([sorted.g.verdict, sorted.g.reason], ["UNGRADABLE", "not-test-only"], sorted.stdout);
    const extra = grade(dir, ws, baseSha, diffOf(a, `${a.content}\nexport const leak = 1;\n`));
    assert.deepEqual([extra.g.verdict, extra.g.reason], ["UNGRADABLE", "not-test-only"], extra.stdout);
    // Auditor #523 B2: the same v4 module and append under a v3 (or v1) operation id: re-checked as before M113
    for (const s of [V3, V1]) {
      const asOld = grade(dir, ws, baseSha, diffOf(n, n.content), `learned:${s.id}@${specHash(s)}`);
      assert.deepEqual([asOld.g.verdict, asOld.g.reason], ["UNGRADABLE", "not-test-only"], asOld.stdout);
    }
    const asV3 = grade(dir, ws, baseSha, diffOf(a, a.content), `learned:${V3.id}@${specHash(V3)}`);
    assert.deepEqual([asV3.g.verdict, asV3.g.reason], ["UNGRADABLE", "not-test-only"], asV3.stdout);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
