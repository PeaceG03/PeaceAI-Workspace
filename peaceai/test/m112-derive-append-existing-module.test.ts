// M112 (public-derive-from-behavior-v3, rule param placement end-of-existing-module): PeaceAI derives a new exported
// function from behavior + literal examples (the v1 search, then v2's boolean label chains) and APPENDS it to a module
// that already exists, plus one new test file. The append is add-only (one blank line, then the function, at the very
// end; no existing line changes) and refused on a name collision, top-level mutable state, anything that runs at
// import, a protected / denied / never-zone path or a missing module. Imports are never changed.
// The held-out specs below were written before they were first run and were not used to build the engine; the
// slice-1-shaped sequence uses its own names (nothing here names a PeaceSTOCKS issue's function).
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { APPROVED_SCHEMA } from "../lib/approved.ts";
import { evalProgram, finiteDomain, type DeriveExample, type DeriveParam, type DeriveValue } from "../lib/derive.ts";
import { appendTargetProblem, buildDeriveEdit, DERIVE_APPEND_TRIGGER, DERIVE_TRIGGER, DERIVE_VOCAB, deriveReviewNote, derivedAppendProblem, parseDeriveTask, runDeriveRule, validDeriveParams } from "../lib/learned-derive.ts";
import { applyRule, specHash, validateSpec, type RuleSpec } from "../lib/learned.ts";
import { PEACE_AUTHOR } from "../lib/minetest.ts";
import { DERIVE_APPEND_PHRASING, PHRASING, phrasingFor } from "../lib/propose.ts";
import { LEARNED_CANONICAL } from "../lib/nlparse.ts";
import { validateResults } from "../lib/results.ts";
import { cleanIssueText } from "../lib/taskmap.ts";

const repo = resolve(import.meta.dirname, "..", "..");
const tsx = join(repo, "node_modules/.bin/tsx");
const read = (p: string) => readFileSync(join(repo, p), "utf8");
const V1 = JSON.parse(read("peaceai/rules/learned/public-derive-from-behavior-v1.json")) as RuleSpec;
const V2 = JSON.parse(read("peaceai/rules/learned/public-derive-from-behavior-v2.json")) as RuleSpec;
const V3 = JSON.parse(read("peaceai/rules/learned/public-derive-from-behavior-v3.json")) as RuleSpec;
const SHA3 = specHash(V3);
const CONFINED = Number(process.versions.node.split(".")[0]) >= 22;
const git = (cwd: string, ...a: string[]) => execFileSync("git", ["-c", "user.name=PeaceG03", "-c", `user.email=${PEACE_AUTHOR}`, ...a], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const lit = (v: DeriveValue) => (typeof v === "string" ? JSON.stringify(v) : String(v));
const N = (name: string): DeriveParam => ({ name, type: "number" });
const S = (name: string): DeriveParam => ({ name, type: "string" });
const B = (name: string): DeriveParam => ({ name, type: "boolean" });
const sig = (params: DeriveParam[]) => params.map((p) => `${p.name}: ${p.type}`).join(", ");
/** An append issue, in the shape Builder files them (header, behavior prose, literal examples). */
const issue = (file: string, fn: string, params: DeriveParam[], ret: string, examples: DeriveExample[]) => [
  `Append a new function \`${fn}(${sig(params)}): ${ret}\` to the existing module \`${file}\`.`, "",
  "Behavior: a plain description of the wanted result.", "",
  `Examples (${params.map((p) => p.name).join(", ")} gives result):`,
  ...examples.map((e) => `- ${e.args.map(lit).join(", ")} gives ${lit(e.out)}`), "",
].join("\n");
const objective = (body: string) => cleanIssueText({ title: "append task", body } as never);
const isTest = (p: string) => /\.test\.ts$/.test(p);

/** A realistic existing module: type import, constants, a frozen table, an interface, a class and two functions. */
const UNITS = `import type { Unit } from "./unit-types.ts";
import { ROUND } from "./unit-types.ts";

/** Seconds per unit. */
export const PER: Readonly<Record<Unit, number>> = Object.freeze({ s: 1, m: 60, h: 3600 });
const LIMIT = 10 * ROUND;

export interface Span { from: number; to: number }

export class Clock {
  constructor(private readonly start: number) {}
  since(now: number): number { return now - this.start; }
}

export function toSeconds(n: number, unit: Unit): number {
  return n * PER[unit];
}

export function capped(n: number): number {
  return n > LIMIT ? LIMIT : n;
}
`;
const UNIT_TYPES = `export type Unit = "s" | "m" | "h";\nexport const ROUND = 6;\n`;
const UNITS_TEST = `import assert from "node:assert/strict";\nimport test from "node:test";\nimport { capped, toSeconds, Clock } from "./units.ts";\n\ntest("existing", () => {\n  assert.equal(toSeconds(2, "m"), 120);\n  assert.equal(capped(99), 60);\n  assert.equal(new Clock(5).since(9), 4);\n});\n`;
const FILES = [
  { path: "src/units.ts", content: UNITS },
  { path: "src/unit-types.ts", content: UNIT_TYPES },
  { path: "src/units.test.ts", content: UNITS_TEST },
];

/** The appended block's function, evaluated (the held-out check runs it on inputs the examples never show). */
const appendedFn = (base: string, content: string): ((...a: DeriveValue[]) => DeriveValue) => {
  assert.ok(content.startsWith(`${base}\n`), "add-only: the old text is a prefix, then one blank line");
  const m = /^export function \w+\(([^)]*)\): \w+ \{\n {2}return (.*);\n\}\n$/.exec(content.slice(base.length + 1));
  assert.ok(m, content.slice(base.length));
  const names = m[1]!.split(", ").map((s) => s.split(":")[0]!);
  return new Function(...names, `return ${m[2]};`) as (...a: DeriveValue[]) => DeriveValue;
};

/** Writes the files into a scratch tree and runs every given test file with tsx; true when all pass. */
function runTests(files: readonly { path: string; content: string }[], tests: readonly string[]): { ok: boolean; out: string } {
  const dir = mkdtempSync(join(tmpdir(), "m112t-"));
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

// ---- Held-out positive specs (written before the first run) ----
// `examples` is what was written first. On the first run three of the four were REFUSED by the v1 gates, each asking
// for the examples it lacked (recorded in the next test); `asked` is exactly what those refusals asked for, added the
// way an issue author would answer them. One more change, recorded in the next test: tagLine's fifth example was
// first written as [" x ", "ERR"]; issue-text cleaning collapses the double space in its result "[ERR]  x " (a v1
// limit: runs of spaces inside quoted example strings are collapsed), so that example became inconsistent and the
// search ran out of budget (derive_budget, a refusal, not a wrong program). It was rewritten as ["x ", "ERR"].
type Spec = { fn: string; params: DeriveParam[]; ret: "number" | "string" | "boolean"; f: (...a: never[]) => DeriveValue; examples: DeriveValue[][]; asked: DeriveValue[][]; probes: DeriveValue[][] };
const HELD_OUT: Spec[] = [
  // a comparison of two parameters
  { fn: "isOverBudget", params: [N("spent"), N("budget")], ret: "boolean", f: (s: number, b: number) => s > b,
    examples: [[0, 10], [5, 10], [10, 10], [11, 10], [30, 10], [9, 10], [100, 100], [101, 100], [99, 100], [0, 0], [1, 0], [250, 300], [301, 300], [-5, 0], [-1, -2], [7, 3]],
    asked: [[200, 50], [50, 200]],
    probes: [[1e6, 5], [5, 1e6], [-1e6, -1e6], [42, 41], [41, 42], [3.5, 3], [3, 3.5]] },
  // a string built from fixed text and the parameters, copied exactly
  { fn: "tagLine", params: [S("name"), S("level")], ret: "string", f: (n: string, l: string) => `[${l}] ${n}`,
    examples: [["scan", "OK"], ["r2", "WARN"], ["", "OK"], ["host", ""], ["x ", "ERR"], ["Daily Bars", "ok"], ["a|b", "INFO"], ["tenmin", "ERROR"], ["q", " "]],
    asked: [["x", "ERR 2"], ["y", "a.b, c!"]],
    probes: [["zzz", "LONG LEVEL"], ["", ""], ["[", "]"], ["\u540d", "\u7d1a"]] },
  // a threshold on one parameter
  { fn: "isLongRun", params: [N("minutes")], ret: "boolean", f: (m: number) => m >= 45,
    examples: [[0], [10], [30], [44], [45], [46], [60], [90], [200], [-3], [43], [47], [120], [15], [1], [500]],
    asked: [[-60], [350], [275], [425]],
    probes: [[44.5], [45.5], [1e9], [-1e9], [44.999]] },
  // boolean label chain (v2's label chains through v3: the v1 search fails, then label chains)
  { fn: "lightColor", params: [B("stop"), B("slow")], ret: "string", f: (stop: boolean, slow: boolean) => (stop ? "RED" : slow ? "AMBER" : "GREEN"),
    examples: finiteDomain([B("stop"), B("slow")])!, asked: [], probes: finiteDomain([B("stop"), B("slow")])! },
];
const call = (h: Spec, args: DeriveValue[]) => (h.f as (...a: DeriveValue[]) => DeriveValue)(...args);
const exs = (h: Spec, first = false): DeriveExample[] => [...h.examples, ...(first ? [] : h.asked)].map((args) => ({ args, out: call(h, args) }));

test("held-out record: the specs as first written; the v1 gates refused three, each asking for what it lacked (v3 adds no gate and lowers none)", () => {
  const got = HELD_OUT.map((h) => { const why: { reason?: string } = {}; const e = runDeriveRule(V3.trigger, V3.params, objective(issue("src/units.ts", h.fn, h.params, h.ret, exs(h, true))), FILES, isTest, why); return e ? "appended" : why.reason; });
  assert.deepEqual(got, ["derive_under_specified_far: spent", "derive_under_specified_chars: level", "derive_under_specified_far: minutes", "appended"]);
  // isLongRun asked twice: first for a value far before its edge, then for the gaps past it (region)
  const h = HELD_OUT[2]!, why: { reason?: string } = {};
  const once = [...h.examples, [-60]].map((args) => ({ args, out: call(h, args) }));
  assert.equal(runDeriveRule(V3.trigger, V3.params, objective(issue("src/units.ts", h.fn, h.params, h.ret, once)), FILES, isTest, why), null);
  assert.equal(why.reason, "derive_under_specified_region: minutes");
  // tagLine as literally first written: the collapsed double space made the examples inconsistent -> derive_budget
  const t = HELD_OUT[1]!, tw: { reason?: string } = {};
  const literal = t.examples.map((args) => (args[0] === "x " ? [" x ", args[1]!] : args)).map((args) => ({ args, out: call(t, args) }));
  assert.equal(runDeriveRule(V3.trigger, V3.params, objective(issue("src/units.ts", t.fn, t.params, t.ret, literal)), FILES, isTest, tw), null);
  assert.equal(tw.reason, "derive_budget");
});

test("held-out specs: each is appended to an existing module, add-only, equal to the spec on probes past every example; the module's own test and the new test pass", () => {
  for (const h of HELD_OUT) {
    const why: { reason?: string } = {};
    const e = runDeriveRule(V3.trigger, V3.params, objective(issue("src/units.ts", h.fn, h.params, h.ret, exs(h))), FILES, isTest, why);
    assert.ok(e, `${h.fn}: ${JSON.stringify(why)}`);
    assert.equal(e.path, "src/units.ts");
    assert.equal(e.create, undefined, "an existing module is edited, never created");
    assert.equal(derivedAppendProblem(UNITS, e.content), null);
    const got = appendedFn(UNITS, e.content);
    for (const args of [...h.examples, ...h.asked, ...h.probes]) assert.equal(got(...args), call(h, args), `${h.fn}(${args.map(lit)})`);
    // every import and every old line is unchanged
    assert.deepEqual(e.content.split("\n").slice(0, UNITS.split("\n").length - 1), UNITS.split("\n").slice(0, -1));
    assert.equal(e.extra.length, 1);
    assert.match(e.extra[0]!.path, new RegExp(`^src/units\\.[a-z-]+-[0-9a-f]{7}\\.test\\.ts$`));
    assert.ok(e.extra[0]!.content.includes(`import { ${h.fn} } from "./units.ts";`));
    for (const ex of exs(h)) assert.ok(e.extra[0]!.content.includes(`assert.equal(${h.fn}(${ex.args.map(lit).join(", ")}), ${lit(ex.out)});`), h.fn);
  }
});

test("held-out specs: the existing tests and the new test pass with the append; the new test fails without it", () => {
  let files = [...FILES];
  const tests = ["src/units.test.ts"];
  for (const h of HELD_OUT) {
    const e = runDeriveRule(V3.trigger, V3.params, objective(issue("src/units.ts", h.fn, h.params, h.ret, exs(h))), files, isTest)!;
    assert.ok(e, h.fn);
    const without = runTests([...files, e.extra[0]!], [e.extra[0]!.path]);
    assert.equal(without.ok, false, `${h.fn}: the new test must fail before the append`);
    files = [...files.filter((f) => f.path !== e.path), { path: e.path, content: e.content }, e.extra[0]!];
    tests.push(e.extra[0]!.path);
  }
  // all four appended in sequence to ONE module; the module's own test and all four new tests pass
  const all = runTests(files, tests);
  assert.ok(all.ok, all.out);
  const mod = files.find((f) => f.path === "src/units.ts")!.content;
  assert.ok(mod.startsWith(UNITS));
  assert.equal(HELD_OUT.filter((h) => mod.includes(`export function ${h.fn}(`)).length, HELD_OUT.length);
});

// ---- A slice-1-shaped sequence: a "health" family of four tiny functions in ONE module ----
// The examples include the ones the v1 gates asked for when this test was first run (pumpLine: a digit and punctuation
// in part; isPumpLate: inputs far from the edge; isLogStale: far-negative and then region gaps -143, 282, 145).
// The same shapes as a scanner self-health slice (a check-in line, a silence check, a keep-window check, a one-glance
// state word), with their own names. v1 creates the module from the first issue; v3 appends the other three to it.
test("slice-1 shape: one module holds all four functions (v1 creates it, v3 appends three); every test passes", () => {
  const host = [{ path: "src/pump.ts", content: "export const PUMP = 1;\n" }];
  const first = runDeriveRule(V1.trigger, V1.params, objective([
    "Add a new module `src/pump-health.ts` exporting `pumpLine(part: string, status: string): string`.", "",
    "Behavior: the word PUMP, then the part, then the status, separated by single vertical bars.", "",
    "Examples (part, status gives line):",
    ...[["a", "OK"], ["b", "ERROR"], ["", "OK"], ["c d", ""], [" e", "WARN "], ["f|g", "x"], ["h", "ok"], ["IJ", "Bad, 3"], ["p2", "Bad 4"], ["k.l, m!", "z"]].map(([p, s]) => `- ${lit(p!)}, ${lit(s!)} gives ${lit(`PUMP|${p}|${s}`)}`),
  ].join("\n")), host, isTest);
  assert.ok(first && first.create === true);
  let files = [...host, { path: first.path, content: first.content }, first.extra[0]!];
  const tests = [first.extra[0]!.path];
  const late = (age: number, allowed: number) => age > allowed;
  const stale = (days: number) => days > 14;
  const state = (late: boolean, failed: boolean) => (failed ? "FAULT" : late ? "LATE" : "FINE");
  const steps: [string, DeriveParam[], string, DeriveExample[]][] = [
    ["isPumpLate", [N("ageMinutes"), N("allowedMinutes")], "boolean", [[0, 10], [5, 10], [10, 10], [11, 10], [12, 10], [60, 10], [9, 10], [30, 30], [31, 30], [29, 30], [120, 120], [121, 120], [119, 120], [1440, 1440], [1441, 1440], [700, 1440], [5000, 10], [10, 5000]].map(([a, b]) => ({ args: [a!, b!], out: late(a!, b!) }))],
    ["isLogStale", [N("ageDays")], "boolean", [0, 1, 7, 13, 14, 15, 16, 30, 60, 90, 365, -1, -14, -30, 12, 20, -85, -200, -143, 282, 145, 200].map((d) => ({ args: [d], out: stale(d) }))],
    ["pumpState", [B("late"), B("failed")], "string", finiteDomain([B("late"), B("failed")])!.map((args) => ({ args, out: state(args[0] as boolean, args[1] as boolean) }))],
  ];
  for (const [fn, params, ret, examples] of steps) {
    const why: { reason?: string } = {};
    const e = applyRule(V3, objective(issue("src/pump-health.ts", fn, params, ret, examples)), files, isTest, "PeaceG03/PeaceSTOCKS", why, () => false);
    assert.ok(e, `${fn}: ${JSON.stringify(why)}`);
    const before = files.find((f) => f.path === e.path)!.content;
    assert.equal(derivedAppendProblem(before, e.content), null, fn);
    files = [...files.filter((f) => f.path !== e.path), { path: e.path, content: e.content }, e.extra![0]!];
    tests.push(e.extra![0]!.path);
  }
  const mod = files.find((f) => f.path === "src/pump-health.ts")!.content;
  assert.deepEqual([...mod.matchAll(/^export function (\w+)\(/gm)].map((m) => m[1]), ["pumpLine", "isPumpLate", "isLogStale", "pumpState"]);
  const run = runTests(files, tests);
  assert.ok(run.ok, run.out);
});

// ---- Negatives ----
const OK = { fn: "isOverBudget", params: [N("spent"), N("budget")], ret: "boolean" } as const;
const okExamples = exs(HELD_OUT[0]!);
const refuse = (file: string, files: readonly { path: string; content: string }[], fn: string = OK.fn, repoName?: string) => {
  const why: { reason?: string } = {};
  const e = repoName
    ? applyRule(V3, objective(issue(file, fn, [...OK.params], OK.ret, okExamples)), files, isTest, repoName, why, () => false)
    : runDeriveRule(V3.trigger, V3.params, objective(issue(file, fn, [...OK.params], OK.ret, okExamples)), files, isTest, why);
  assert.equal(e, null, `${file}: expected a refusal`);
  return why.reason;
};
const withUnits = (content: string) => [{ path: "src/units.ts", content }, { path: "src/unit-types.ts", content: UNIT_TYPES }];

test("negative: name collision with any binding, import, export, use or property of the module, or an `export *`", () => {
  for (const content of [
    `${UNITS}\nexport function isOverBudget(a: number): boolean {\n  return a > 0;\n}\n`,
    UNITS.replace('import { ROUND } from "./unit-types.ts";', 'import { ROUND, ROUND as isOverBudget } from "./unit-types.ts";'),
    `${UNITS}\nconst isOverBudget = 1;\nexport { isOverBudget };\n`,
    `${UNITS}\nexport { capped as isOverBudget };\n`,
    `${UNITS}\nexport const T = { isOverBudget: 1 };\n`,
    `${UNITS}\nexport type isOverBudget = number;\n`,
    `${UNITS}\nexport * from "./unit-types.ts";\n`,
    `${UNITS}\nexport * as more from "./unit-types.ts";\n`,
  ]) assert.equal(refuse("src/units.ts", withUnits(content)), "derive_append_name_collision", content.slice(UNITS.length - 20));
  // the name in a comment is refused too (fail closed: a reviewer would read it as the same thing)
  assert.equal(refuse("src/units.ts", withUnits(`// isOverBudget lives elsewhere\n${UNITS}`)), "derive_append_name_collision");
});

test("negative: top-level mutable state (let / var) the module could share", () => {
  for (const content of [`${UNITS}\nlet count = 0;\n`, `${UNITS}\nexport let mode = "a";\n`, `var seen = 1;\n${UNITS}`]) assert.equal(refuse("src/units.ts", withUnits(content)), "derive_append_mutable_state");
});

test("negative: a module (or anything it imports) that runs code at import", () => {
  const cases: [string, { path: string; content: string }[]][] = [
    ["top-level call", withUnits(`${UNITS}\nconsole.log("loaded");\n`)],
    ["clock read in an initializer", withUnits(`${UNITS}\nexport const STARTED = Date.now();\n`)],
    ["environment read", withUnits(`${UNITS}\nexport const MODE = process.env.MODE;\n`)],
    ["export default of a call", withUnits(`${UNITS}\nexport default capped(3);\n`)],
    ["side effect in the imported sibling", [{ path: "src/units.ts", content: UNITS }, { path: "src/unit-types.ts", content: `${UNIT_TYPES}globalThis.x = 1;\n` }]],
    ["package import", withUnits(`import { z } from "zod";\n${UNITS}`)],
    ["unresolved import", [{ path: "src/units.ts", content: UNITS }]],
    ["class static block", withUnits(`${UNITS}\nexport class K { static { capped(1); } }\n`)],
  ];
  for (const [label, files] of cases) assert.match(refuse("src/units.ts", files) ?? "", /^derive_append_side_effects/, label);
});

test("negative: protected, denied, never-zone, test, .d.ts, fixture and traversal paths", () => {
  const f = (path: string, content = UNITS) => [{ path, content }, { path: "src/unit-types.ts", content: UNIT_TYPES }];
  for (const p of ["src/approval.ts", "src/token-cache.ts", "src/secrets.ts", "src/gate.ts", "src/units.test.ts", "src/units.d.ts", "src/fixtures/units.ts", "src/Units.ts", "src/a.test-helper.ts"]) {
    assert.equal(refuse(p, f(p)), "derive_path", p);
  }
  // the trigger names src/ paths only: a never-zone path (dot-path, workflows, peaceai/) cannot even be phrased
  for (const p of [".github/x.ts", "peaceai/lib/gate.ts", "peaceai/rules/x.ts"]) assert.equal(refuse(p, f(p)), undefined, p);
  for (const p of ["src/../peaceai/lib/gate.ts", "src/.env.ts", "src/x/../units.ts"]) assert.equal(refuse(p, f(p)), "derive_path", p);
  // PeaceSTOCKS denyPatterns (host / scheduler / backfill, wrangler, production) are enforced by applyRule
  for (const p of ["src/host.ts", "src/scheduler.ts", "src/wrangler-env.ts", "src/production-flags.ts"]) assert.equal(refuse(p, f(p), OK.fn, "PeaceG03/PeaceSTOCKS"), "denied_path", p);
});

test("negative: a missing module (also a case near-miss) is target_file_not_found; v3 never creates one", () => {
  assert.equal(refuse("src/nope.ts", FILES), "target_file_not_found");
  assert.equal(refuse("src/uNITS.ts", FILES), "target_file_not_found");
  assert.equal(refuse("src/units/index.ts", FILES), "target_file_not_found");
});

test("negative: a module whose text the append would have to touch (no final newline, CRLF, a trailing blank line, empty, unparsable)", () => {
  for (const content of [UNITS.replace(/\n$/, ""), UNITS.replace(/\n/g, "\r\n"), `${UNITS}\n`, "", "\n"]) assert.equal(refuse("src/units.ts", withUnits(content)), "derive_append_layout", JSON.stringify(content.slice(-4)));
  assert.equal(refuse("src/units.ts", withUnits(`${UNITS}export function (\n`)), "derive_append_parse");
});

test("negative: every v1/v2 refusal still applies through v3 (under-specified, code in the prose, an existing test path)", () => {
  // under-specified: the examples do not show the threshold
  const why: { reason?: string } = {};
  assert.equal(runDeriveRule(V3.trigger, V3.params, objective(issue("src/units.ts", "isBig", [N("n")], "boolean", [[0], [1], [100], [200]].map(([n]) => ({ args: [n!], out: n! > 50 })))), FILES, isTest, why), null);
  assert.match(why.reason ?? "", /^derive_/);
  const code: { reason?: string } = {};
  assert.equal(runDeriveRule(V3.trigger, V3.params, objective(`${issue("src/units.ts", OK.fn, [...OK.params], OK.ret, okExamples)}\nContext: return spent > budget;`), FILES, isTest, code), null);
  assert.equal(code.reason, "derive_behavior_code");
  const e = runDeriveRule(V3.trigger, V3.params, objective(issue("src/units.ts", OK.fn, [...OK.params], OK.ret, okExamples)), FILES, isTest)!;
  assert.equal(refuse("src/units.ts", [...FILES, { path: e.extra[0]!.path, content: "x\n" }]), "new_test_path_exists");
});

test("placement and trigger go together: no spec answers the other placement's phrasing", () => {
  const appendBody = objective(issue("src/units.ts", OK.fn, [...OK.params], OK.ret, okExamples));
  const newBody = appendBody.replace(/^Append a new function (.*) to the existing module src\/units\.ts ?\.$/m, "Add a new module src/budget.ts exporting $1.");
  assert.notEqual(newBody, appendBody);
  for (const s of [V1, V2]) { const w: { reason?: string } = {}; assert.equal(runDeriveRule(s.trigger, s.params, appendBody, FILES, isTest, w), null); assert.equal(w.reason, undefined, s.id); }
  const w3: { reason?: string } = {};
  assert.equal(runDeriveRule(V3.trigger, V3.params, newBody, FILES, isTest, w3), null);
  assert.equal(w3.reason, undefined);
  // a spec pointing one placement at the other's trigger is refused by name
  for (const [t, p] of [[DERIVE_TRIGGER, V3.params], [DERIVE_APPEND_TRIGGER, V1.params], [DERIVE_APPEND_TRIGGER, V2.params]] as const) {
    const w: { reason?: string } = {};
    assert.equal(runDeriveRule(t, p as Record<string, unknown>, appendBody, FILES, isTest, w), null);
    assert.equal(w.reason, "derive_params");
  }
  // buildDeriveEdit in new-module mode still refuses an existing module (v1/v2 unchanged)
  const task = parseDeriveTask(V3.trigger, appendBody);
  assert.ok("task" in task);
  assert.deepEqual(buildDeriveEdit(V1.params, task.task, FILES, isTest), { reason: "derive_module_exists" });
  assert.equal(LEARNED_CANONICAL.deriveAppend.re.source, new RegExp(DERIVE_APPEND_TRIGGER, "imu").source);
  assert.ok(appendBody.split("\n").some((l) => LEARNED_CANONICAL.deriveAppend.re.test(l.trim())));
});

// ---- Seeded random tasks: never a wrong program, never a non-add-only edit, every collision refused ----
const rng = (seed: number) => () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

test("seeded random append tasks (60): 0 wrong programs, every candidate add-only, every injected collision refused", (t) => {
  const R = rng(112);
  const pick = <T>(a: readonly T[]) => a[Math.floor(R() * a.length)]!;
  let appended = 0, refused = 0, wrong = 0, collisions = 0;
  for (let k = 0; k < 60; k++) {
    // a random existing module: some constants, functions and an interface, in random order
    const decls = Array.from({ length: 1 + Math.floor(R() * 5) }, (_, i) => pick([
      `export const K${i} = ${Math.floor(R() * 100)};\n`,
      `export function f${i}(x: number): number {\n  return x + ${i};\n}\n`,
      `export interface I${i} { v: number }\n`,
      `const T${i} = Object.freeze([${i}, ${i + 1}]);\nexport function g${i}(): number {\n  return T${i}.length;\n}\n`,
    ]));
    const base = decls.join("\n");
    const files = [{ path: "src/rand.ts", content: base }];
    // a random spec from three families
    const fam = Math.floor(R() * 3), c = Math.floor(R() * 40) - 10;
    const spec: Spec = fam === 0
      ? { fn: `atLeast${k}`, params: [N("n")], ret: "boolean", f: (n: number) => n >= c, examples: [], asked: [], probes: [[c - 1000], [c + 1000], [c - 0.5], [c + 0.5]] }
      : fam === 1
      ? { fn: `isAbove${k}`, params: [N("a"), N("b")], ret: "boolean", f: (a: number, b: number) => a > b, examples: [], asked: [], probes: [[1e6, 1], [1, 1e6], [-7, -7], [2.5, 2]] }
      : { fn: `label${k}`, params: [B("p"), B("q")], ret: "string", f: pick([(p: boolean, q: boolean) => (p ? "X" : q ? "Y" : "Z"), (p: boolean, q: boolean) => (q ? "A" : p ? "B" : "C")]), examples: finiteDomain([B("p"), B("q")])!, asked: [], probes: finiteDomain([B("p"), B("q")])! };
    if (fam === 0) spec.examples = [...new Set([c - 1, c, c + 1, c - 2, c + 2, c - 10, c + 10, c - 25, c + 25, c - 5, c + 5, c - 50, c + 50, c + 3, c - 3, c + 7, c - 150, c + 150, c + 100, c + 200, c + 300, c + 250, c - 100])].map((n) => [n]);
    if (fam === 1) spec.examples = [[0, 0], [1, 0], [0, 1], [5, 5], [6, 5], [4, 5], [100, 99], [99, 100], [-1, -2], [-2, -1], [30, 30], [31, 30], [29, 30], [7, -7], [-7, 7], [50, 49], [200, 50], [50, 200]];
    const body = objective(issue("src/rand.ts", spec.fn, spec.params, spec.ret, exs(spec)));
    const e = runDeriveRule(V3.trigger, V3.params, body, files, isTest);
    if (!e) { refused++; continue; }
    appended++;
    if (derivedAppendProblem(base, e.content) !== null) wrong++;
    const got = appendedFn(base, e.content);
    for (const args of [...spec.examples, ...spec.probes]) if (got(...args) !== call(spec, args)) wrong++;
    // the same task against the module with the name already taken (declared, exported alias, or used) is refused
    const taken = pick([`${base}\nexport const ${spec.fn} = 0;\n`, `${base}\nexport { K as ${spec.fn} };\nconst K = 1;\n`, `${base}\nconst o = { ${spec.fn}: 1 };\nexport { o };\n`]);
    const w: { reason?: string } = {};
    assert.equal(runDeriveRule(V3.trigger, V3.params, body, [{ path: "src/rand.ts", content: taken }], isTest, w), null);
    assert.equal(w.reason, "derive_append_name_collision");
    collisions++;
  }
  t.diagnostic(`appended ${appended}, refused ${refused}, wrong ${wrong}, collisions refused ${collisions}`);
  assert.equal(wrong, 0);
  assert.ok(appended >= 50, `${appended}`);
});

// ---- Review note and the add-only re-check ----
const appendDiff = (path: string, before: string, after: string): string => {
  const old = before.replace(/\n$/, "").split("\n"), add = after.slice(before.length).replace(/\n$/, "").split("\n");
  const ctx = old.slice(-3);
  return `diff --git a/${path} b/${path}\nindex 1111111..2222222 100644\n--- a/${path}\n+++ b/${path}\n@@ -${old.length - ctx.length + 1},${ctx.length} +${old.length - ctx.length + 1},${ctx.length + add.length} @@\n${ctx.map((l) => ` ${l}`).join("\n")}\n${add.map((l) => `+${l}`).join("\n")}\n`;
};
const newFile = (f: { path: string; content: string }) => { const lines = f.content.replace(/\n$/, "").split("\n"); return `diff --git a/${f.path} b/${f.path}\nnew file mode 100644\nindex 0000000..1111111\n--- /dev/null\n+++ b/${f.path}\n@@ -0,0 +1,${lines.length} @@\n${lines.map((l) => `+${l}`).join("\n")}\n`; };

test("review note: rebuilt from an append diff; refused for a diff that also removes or changes a line", () => {
  const h = HELD_OUT[3]!;
  const e = runDeriveRule(V3.trigger, V3.params, objective(issue("src/units.ts", h.fn, h.params, h.ret, exs(h))), FILES, isTest)!;
  const d = appendDiff(e.path, UNITS, e.content) + newFile(e.extra[0]!);
  const note = deriveReviewNote(d);
  assert.ok(note && note.includes('return stop ? "RED" : (slow ? "AMBER" : "GREEN");'), note ?? "null");
  // a removed line, a trailing context line (the block is not at the end) or a third file: no note
  assert.equal(deriveReviewNote(d.replace("\n+\n+export function", "\n-}\n+\n+export function")), null);
  assert.equal(deriveReviewNote(appendDiff(e.path, UNITS, e.content).replace(/\n$/, "\n tail\n") + newFile(e.extra[0]!)), null);
  assert.equal(deriveReviewNote(d + newFile({ path: "src/other.ts", content: "export const o = 1;\n" })), null);
});

test("derivedAppendProblem: the old text is a prefix, then one blank line, then exactly one derived function", () => {
  const e = runDeriveRule(V3.trigger, V3.params, objective(issue("src/units.ts", OK.fn, [...OK.params], OK.ret, okExamples)), FILES, isTest)!;
  assert.equal(derivedAppendProblem(UNITS, e.content), null);
  assert.equal(derivedAppendProblem(UNITS, e.content.replace("LIMIT = 10", "LIMIT = 11")), "derive_append_not_add_only");
  assert.equal(derivedAppendProblem(UNITS, `${UNITS}${e.content.slice(UNITS.length + 1)}`), "derive_append_not_add_only");
  assert.equal(derivedAppendProblem(UNITS, `${e.content}\nexport const extra = 1;\n`), "derive_module_shape");
  assert.match(derivedAppendProblem(UNITS, UNITS + e.content.slice(UNITS.length).replace(/return (.*);/, "return ($1) || process.env.X === \"1\";")) ?? "", /^derive_expr_/);
  assert.equal(appendTargetProblem("src/units.ts", UNITS, "toSeconds", (p) => (p === "src/unit-types.ts" ? UNIT_TYPES : p === "src/units.ts" ? UNITS : null)), "derive_append_name_collision");
});

// ---- Spec v3 ----
test("spec v3: valid; the v2 spec with only id, minerVersion, trigger and placement changed; v1 / v2 untouched; hash pinned", () => {
  assert.ok(validateSpec(V3));
  assert.ok(validDeriveParams(V3.params as Record<string, unknown>, V3.minedFrom));
  const { id: _a, minerVersion: _b, trigger: _t2, params: p2, ...rest2 } = V2 as unknown as Record<string, unknown> & { params: Record<string, string> };
  const { id: _c, minerVersion: _d, trigger: t3, params: p3, ...rest3 } = V3 as unknown as Record<string, unknown> & { params: Record<string, string> };
  assert.deepEqual(rest3, rest2);
  assert.deepEqual({ ...p3, placement: "new-module" }, p2);
  assert.equal(p3.placement, "end-of-existing-module");
  assert.equal(t3, DERIVE_APPEND_TRIGGER);
  assert.equal(V3.id, "public-derive-from-behavior-v3");
  assert.equal(V3.minerVersion, "peaceai-miner:derive-from-behavior-v3");
  assert.deepEqual(DERIVE_VOCAB.placement, ["new-module", "end-of-existing-module"]);
  assert.equal(specHash(V1), "799182d79506931e78a232b5729121a339c0aa584dd008479d5aacd9869f7cc1", "v1 unchanged");
  assert.equal(specHash(V2), "e11ae193d1927c4d26efb430d862763db7f9683170a6438deb7e53d98eadff8c", "v2 unchanged");
  assert.equal(SHA3, "7087afcfdbe365b01816b5db0b518407733c7ce88b9d29d57392358be4bc6f8f");
  // Lesson (M85+): never assert v3 is absent from approved.json; any listed entry must pin this exact hash.
  const onMain = JSON.parse(read("peaceai/rules/approved.json")) as { rules: { id: string; sha256: string }[] };
  for (const r of onMain.rules.filter((x) => x.id === V3.id)) assert.equal(r.sha256, SHA3);
  const record = JSON.parse(read("peaceai/rules/proposals/public-derive-from-behavior-v3.json")) as { id: string; learned: string; tests: string[] };
  assert.equal(record.id, V3.id);
  assert.equal(record.learned, "peaceai/rules/learned/public-derive-from-behavior-v3.json");
  for (const p of record.tests) assert.ok(existsSync(join(repo, p)), p);
  // the proposal body phrases the append header; v1 / v2 keep the new-module phrasing
  assert.equal(phrasingFor(V3), DERIVE_APPEND_PHRASING);
  assert.ok(new RegExp(DERIVE_APPEND_TRIGGER, "imu").test("Append a new function isOverBudget(spent: number, budget: number): boolean to the existing module src/units.ts."));
  for (const s of [V1, V2]) assert.equal(phrasingFor(s), PHRASING.DERIVE_FROM_BEHAVIOR);
});

// ---- Job A (generate.ts) and Job B (test-candidates.ts) end to end, with v3 on a temporary approved list ----
const entry = { id: V3.id, sha256: SHA3, source: "workspace", approval: { url: "https://github.com/PeaceG03/PeaceAI-Workspace/issues/40#issuecomment-123", commentId: 123, issue: 40, repo: "PeaceG03/PeaceAI-Workspace", author: "PeaceG03", approvedAt: "2026-10-26T00:00:00Z" } };
const TSCONFIG = JSON.stringify({ compilerOptions: { target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", strict: true, noEmit: true, allowImportingTsExtensions: true }, include: ["src"] });
const BODY = issue("src/units.ts", OK.fn, [...OK.params], OK.ret, okExamples);

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

test("Job A: an approved v3 makes one append candidate (EDIT of the existing module + one new test file)", () => {
  const dir = mkdtempSync(join(tmpdir(), "m112a-"));
  try {
    const { ws } = workspace(dir);
    const rules = join(dir, "rules");
    mkdirSync(rules);
    writeFileSync(join(rules, `${V3.id}.json`), JSON.stringify(V3));
    const list = join(dir, "approved.json");
    writeFileSync(list, JSON.stringify({ schema: APPROVED_SCHEMA, rules: [entry] }));
    const out = join(dir, "out");
    const r = spawnSync(tsx, [join(repo, "peaceai/bin/generate.ts")], {
      cwd: repo, encoding: "utf8", timeout: 300_000,
      env: { ...process.env, PEACEAI_NL_PARSE: "off", PEACEAI_KERNEL_BUNDLE: fakeKernel(dir), PEACEAI_OUT_DIR: out, PEACEAI_WORKSPACE_DIR: ws, PEACEAI_TARGET: "PeaceG03/PeaceAI-Workspace", ISSUE_NUMBER: "9", ISSUE_TITLE: "append task", ISSUE_BODY: BODY, PEACEAI_RULES_DIR: rules, PEACEAI_APPROVED_LIST: list },
    });
    assert.equal(r.status, 0, r.stderr);
    const summary = JSON.parse(readFileSync(join(out, "summary.json"), "utf8")) as { candidates: { file: string; transformations: string[] }[] };
    assert.equal(summary.candidates.length, 1, r.stdout);
    assert.deepEqual(summary.candidates[0]!.transformations, ["LEARNED_DERIVE_FROM_BEHAVIOR"]);
    const diff = readFileSync(join(out, summary.candidates[0]!.file), "utf8");
    assert.match(diff, /^--- a\/src\/units\.ts$/m);
    assert.doesNotMatch(diff, /^-(?!--)/m, "no removed line");
    assert.ok(deriveReviewNote(diff), "the review note is rebuilt from Job A's own diff");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

function grade(dir: string, ws: string, baseSha: string, diff: string) {
  const inDir = join(dir, "in");
  rmSync(inDir, { recursive: true, force: true });
  mkdirSync(join(inDir, "candidates"), { recursive: true });
  writeFileSync(join(inDir, "candidates", "candidate-1.diff"), diff);
  const candidates = [{ id: "candidate-1", file: "candidates/candidate-1.diff", transformations: ["LEARNED_DERIVE_FROM_BEHAVIOR"], operationId: `learned:${V3.id}@${SHA3}`, diffBytes: diff.length, diffLines: 5, selfGrade: true as const }];
  writeFileSync(join(inDir, "summary.json"), JSON.stringify({ schema: "peaceai-workspace-candidates:v1", taskId: "workspace-issue-9", baseSha, candidates }));
  const list = join(dir, "approved.json");
  writeFileSync(list, JSON.stringify({ schema: APPROVED_SCHEMA, rules: [entry] }));
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
  return { g: results.results[0].testGrading as { verdict: string; reason: string | null; stubFails?: boolean }, res: results.results[0] as { originalSuitePassed?: boolean }, stdout: r.stdout };
}

test("Job B: the untouched append COUNTS (existing suite still passes, confined runs read the module's closure); a changed old line or an extra statement is not-test-only", { skip: !CONFINED && "Node < 22: derive candidates grade not-confined" }, () => {
  const dir = mkdtempSync(join(tmpdir(), "m112b-"));
  try {
    const { ws, baseSha } = workspace(dir);
    const e = runDeriveRule(V3.trigger, V3.params, objective(BODY), FILES, isTest)!;
    const diffOf = (content: string) => {
      writeFileSync(join(ws, e.path), content);
      writeFileSync(join(ws, e.extra[0]!.path), e.extra[0]!.content);
      git(ws, "add", "-N", "--", e.extra[0]!.path);
      const d = git(ws, "diff", "--no-color", "--full-index", "--no-renames");
      git(ws, "reset", "-q", "--hard"); git(ws, "clean", "-fdq");
      return d;
    };
    const good = grade(dir, ws, baseSha, diffOf(e.content));
    assert.equal(good.g.verdict, "COUNTS", good.stdout);
    assert.equal(good.g.stubFails, true);
    const changed = grade(dir, ws, baseSha, diffOf(e.content.replace("LIMIT = 10 * ROUND", "LIMIT = 10 * ROUND + 0")));
    assert.deepEqual([changed.g.verdict, changed.g.reason], ["UNGRADABLE", "not-test-only"], changed.stdout);
    const extra = grade(dir, ws, baseSha, diffOf(`${e.content}\nexport const leak = 1;\n`));
    assert.deepEqual([extra.g.verdict, extra.g.reason], ["UNGRADABLE", "not-test-only"], extra.stdout);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
