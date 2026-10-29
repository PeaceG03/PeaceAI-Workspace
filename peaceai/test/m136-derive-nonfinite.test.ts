// G17 phase 1 (public-derive-from-behavior-v6, rule params dsl typed-dsl-v6-nonfinite + placement
// new-or-existing-module-v6): v4's list search for tasks whose examples hold NaN, Infinity or -Infinity. v4 still
// refuses those examples (derive_examples) and v6 is not_needed for a task without them, so the two never both
// answer one task; v1-v5 are untouched. Values compare as Object.is does (node:assert/strict, checked here), the
// generated test asserts the examples exactly as written, and Number.isFinite(E) / !Number.isFinite(E) join the
// predicates only when an example element shows a non-finite value.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { compileList, deriveListProgram, evalList, evalNonFiniteTwin, hasNonFinite, lexListValues, listLit, nonFiniteProbes, nonFiniteTwins, valueKey, valueOk, type ListArg, type ListParam } from "../lib/derive-list.ts";
import { M136_EVIDENCE, m136Grid, rerunEntry, upstreamFn, type M136Entry } from "./m136-evidence-run.ts";
import { DERIVE_LIST_TRIGGER, DERIVE_LIST_OPERATION, DERIVE_NONFINITE_DSL, DERIVE_NONFINITE_OPERATION, DERIVE_NONFINITE_PLACEMENT, deriveAppendRecheck, deriveListReviewNote, deriveModuleRecheck, deriveNonFiniteReviewNote, derivedListModuleProblem, derivedNonFiniteModuleProblem, runDeriveRule, validDeriveParams } from "../lib/learned-derive.ts";
import { specHash, validateSpec, type RuleSpec } from "../lib/learned.ts";
import { DERIVE_NONFINITE_PHRASING, phrasingFor } from "../lib/propose.ts";
import { cleanIssueText } from "../lib/taskmap.ts";

const repo = resolve(import.meta.dirname, "..", "..");
const tsx = join(repo, "node_modules/.bin/tsx");
const read = (p: string) => readFileSync(join(repo, p), "utf8");
const V4 = JSON.parse(read("peaceai/rules/learned/public-derive-from-behavior-v4.json")) as RuleSpec;
const V6 = JSON.parse(read("peaceai/rules/learned/public-derive-from-behavior-v6.json")) as RuleSpec;
const FILES = [{ path: "src/index.ts", content: "export const ready = true;\n" }];
const isTest = (p: string) => /\.test\.ts$/.test(p);
const XS: ListParam[] = [{ name: "xs", type: { list: "number" } }];
const issue = (head: string, behavior: string, examples: string[]) => [head, "", `Behavior: ${behavior}`, "", "Examples:", ...examples.map((e) => `- ${e}`), ""].join("\n");
const objective = (body: string) => cleanIssueText({ title: "non-finite task", body } as never);
const run = (spec: RuleSpec, text: string, files = FILES) => { const why: { reason?: string } = {}; const e = runDeriveRule(spec.trigger, spec.params, objective(text), files, isTest, why); return { e, why }; };

/** The G17 probe: a list of counts is fine when every count is a finite number. */
const ALL_FINITE = issue("Add a new module `src/all-finite.ts` exporting `allFinite(xs: number[]): boolean`.", "true when every count in the list is a finite number, false when any count is not.", [
  "[1, 2, 3] gives true", "[] gives true", "[NaN] gives false", "[0, Infinity] gives false", "[-Infinity, 4] gives false", "[5, NaN, 2] gives false", "[-100, 200] gives true",
]);

test("node:assert/strict compares with Object.is: NaN equals NaN, the infinities differ, 0 and -0 differ", () => {
  assert.equal(NaN, NaN);
  assert.deepEqual([NaN, Infinity, -Infinity], [NaN, Infinity, -Infinity]);
  assert.deepEqual({ n: NaN }, { n: NaN });
  assert.throws(() => assert.equal(Infinity, -Infinity));
  assert.throws(() => assert.equal(0, -0));
  assert.throws(() => assert.deepEqual([NaN], [0]));
});

test("lexing and values: NaN / Infinity / -Infinity only with the v6 flag; keys tell them apart; finite keys unchanged", () => {
  assert.equal(lexListValues("[NaN, 2], 3 gives 1"), null, "v4 lexes NaN as a name and refuses");
  assert.deepEqual(lexListValues("[NaN, Infinity, -Infinity], 3 gives NaN", true), { values: [[NaN, Infinity, -Infinity], 3], out: NaN });
  assert.equal(lexListValues("[NaNx] gives 1", true), null);
  assert.equal(lexListValues("[Infinity1] gives 1", true), null);
  assert.equal(lexListValues("[nan] gives 1", true), null, "exact spelling only");
  assert.equal(valueOk([NaN], { list: "number" }), false);
  assert.equal(valueOk([NaN], { list: "number" }, true), true);
  assert.equal(valueOk(1.5, "number", true), false, "non-integers stay out");
  assert.deepEqual([NaN, Infinity, -Infinity, 0].map(valueKey), ["NaN", "Infinity", "-Infinity", "0"]);
  assert.notEqual(valueKey([NaN]), valueKey([0]));
  assert.notEqual(valueKey([NaN]), valueKey([Infinity]));
  for (const [v, k] of [[[1, -2, 3], "[1,-2,3]"], [{ b: "x", a: 1 }, '{"a":1,"b":"x"}'], [[{ b: 2, a: "q" }], '[{"a":"q","b":2}]'], ["s", '"s"'], [7, "7"], [false, "false"]] as const) assert.equal(valueKey(v), k, "finite keys are unchanged");
  assert.equal(listLit([NaN, -Infinity, Infinity]), "[NaN, -Infinity, Infinity]");
  assert.equal(hasNonFinite([{ args: [[1, 2]], out: 3 }]), false);
  assert.equal(hasNonFinite([{ args: [[{ n: Infinity }]], out: 3 }]), true);
});

test("v4 still refuses non-finite examples; v6 is not_needed without them; v1-v5 never take a v6 spec", () => {
  assert.equal(run(V4, ALL_FINITE).why.reason, "derive_examples");
  const plain = issue("Add a new module `src/plain.ts` exporting `countBig(xs: number[]): number`.", "how many counts in the list are big ones.", ["[1, 2, 3] gives 0", "[] gives 0", "[200, 300, 5] gives 2", "[150] gives 1", "[-300, 101] gives 1"]);
  assert.equal(run(V6, plain).why.reason, "not_needed");
  assert.ok(validateSpec(V6));
  assert.ok(validDeriveParams(V6.params as Record<string, unknown>, "public"));
  assert.equal(validDeriveParams({ ...V6.params, dsl: V4.params.dsl } as Record<string, unknown>, "public"), false);
  assert.equal(validDeriveParams({ ...V6.params, placement: V4.params.placement } as Record<string, unknown>, "public"), false);
  assert.equal(V6.trigger, V4.trigger);
  assert.deepEqual({ ...V6.params, dsl: V4.params.dsl, placement: V4.params.placement }, V4.params);
  assert.equal(specHash(V4), "6edd341f45c7e4486bfb727aa90a66db1fcac4f7e3e3ce7ad6bf561240d0d6f8", "v4 unchanged");
  const approved = read("peaceai/rules/approved.json");
  assert.ok(!approved.includes("public-derive-from-behavior-v6") && !approved.includes(specHash(V6)), "v6 waits for /approve-rule");
  const prop = JSON.parse(read("peaceai/rules/proposals/public-derive-from-behavior-v6.json")) as { status: string; learned: string };
  assert.equal(prop.status, "proposal-off-wired");
  assert.equal(phrasingFor(V6), DERIVE_NONFINITE_PHRASING);
  // A wrong trigger with the v6 params is derive_params, not a v4 run.
  assert.equal(run({ ...V6, trigger: "^nothing$" }, ALL_FINITE).why.reason, "derive_params");
});

test("the G17 probe derives allFinite = xs.every((x) => Number.isFinite(x)); its test passes with Object.is and fails on a wrong body", () => {
  const { e, why } = run(V6, ALL_FINITE);
  assert.ok(e, JSON.stringify(why));
  assert.equal(e.path, "src/all-finite.ts");
  assert.equal(e.content, "export function allFinite(xs: number[]): boolean {\n  return xs.every((x) => Number.isFinite(x));\n}\n");
  const t = e.extra![0]!;
  assert.match(t.path, /^src\/all-finite\.all-finite-[0-9a-f]{7}\.test\.ts$/);
  assert.match(t.content, /assert\.equal\(allFinite\(\[NaN\]\), false\);/);
  assert.match(t.content, /assert\.equal\(allFinite\(\[-Infinity, 4\]\), false\);/);
  assert.equal(derivedNonFiniteModuleProblem(e.content), null);
  assert.equal(derivedListModuleProblem(e.content), "derive_list_expr", "v4's Job B check never accepts a v6 module");
  assert.equal(deriveModuleRecheck(`${DERIVE_NONFINITE_OPERATION}abc`, e.content), null);
  assert.notEqual(deriveModuleRecheck(`${DERIVE_LIST_OPERATION}abc`, e.content), null);
  const dir = mkdtempSync(join(tmpdir(), "g17-"));
  try {
    writeFileSync(join(dir, "package.json"), '{"type":"module"}\n');
    writeFileSync(join(dir, "all-finite.ts"), e.content);
    writeFileSync(join(dir, "probe.test.ts"), t.content);
    const env = { ...process.env }; delete env.NODE_TEST_CONTEXT; // a nested runner reports to this one otherwise
    const ok = spawnSync(tsx, ["--test", "probe.test.ts"], { cwd: dir, encoding: "utf8", timeout: 60_000, env });
    assert.equal(ok.status, 0, ok.stdout + ok.stderr);
    writeFileSync(join(dir, "all-finite.ts"), "export function allFinite(xs: number[]): boolean {\n  return xs.every((x) => x === x);\n}\n");
    const bad = spawnSync(tsx, ["--test", "probe.test.ts"], { cwd: dir, encoding: "utf8", timeout: 60_000, env });
    assert.notEqual(bad.status, 0, "a NaN-only check misses the infinities");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("count and keep with non-finite elements derive; NaN results compare by Object.is in the search", () => {
  const count = issue("Add a new module `src/count-bad.ts` exporting `countBad(xs: number[]): number`.", "how many counts in the list are not finite numbers.", ["[1, 2, 3] gives 0", "[] gives 0", "[NaN] gives 1", "[0, Infinity, NaN] gives 2", "[-Infinity, 4] gives 1"]);
  assert.match(run(V6, count).e!.content, /return xs\.filter\(\(x\) => !Number\.isFinite\(x\)\)\.length;/);
  const keep = issue("Add a new module `src/keep.ts` exporting `keepFinite(xs: number[]): number[]`.", "the counts in the list that are finite numbers, in order.", ["[1, 2, 3] gives [1, 2, 3]", "[] gives []", "[NaN, 4] gives [4]", "[Infinity, -Infinity, 0] gives [0]"]);
  const k = run(V6, keep).e!;
  assert.match(k.content, /return xs\.filter\(\(x\) => Number\.isFinite\(x\)\);/);
  assert.match(k.extra![0]!.content, /assert\.deepEqual\(keepFinite\(\[Infinity, -Infinity, 0\]\), \[0\]\);/);
  // A sum with a NaN element is NaN, and the search matches it to the NaN example (Object.is, not ===).
  const prog = { op: "sum", f: null, pred: null } as const;
  assert.ok(Object.is(evalList(prog, [[1, NaN]], 0), NaN));
});

test("refusals with stated reasons: under-pinned allFinite is ambiguous (rivals named); a name Number; prose naming NaN", () => {
  const short = ALL_FINITE.replace("- [-100, 200] gives true\n", "");
  const why: { reason?: string; questions?: string } = {};
  assert.equal(runDeriveRule(V6.trigger, V6.params, objective(short), FILES, isTest, why), null);
  assert.equal(why.reason, "derive_ambiguous");
  const r = deriveListProgram({ nonFinite: true, params: XS, ret: "boolean", examples: [[1, 2, 3], [], [NaN], [0, Infinity], [-Infinity, 4], [5, NaN, 2]].map((xs) => ({ args: [xs] as ListArg[], out: (xs as number[]).every(Number.isFinite) })) });
  assert.ok(!r.ok && r.reason === "derive_ambiguous" && /xs\.every\(\(x\) => Number\.isFinite\(x\)\)/.test(r.detail ?? ""), JSON.stringify(r));
  assert.equal(run(V6, ALL_FINITE.replace("allFinite(xs: number[])", "Number(xs: number[])")).e, null);
  assert.equal(run(V6, ALL_FINITE.replace("allFinite(xs: number[])", "allFinite(Number: number[])")).why.reason, "derive_reserved_name");
  assert.equal(run(V6, ALL_FINITE.replace("is a finite number", "is not NaN")).e, null, "the Behavior prose still may not name NaN");
  // The weekly-review wiring task needs a record result and calls to other modules (G16): still refused.
  const wiring = issue("Add a new module `src/health-part-review.ts` exporting `reviewPart(counts: number[], lastWeek: number, firstWeek: boolean): { attention: boolean; change: string }`.", "the attention flag and the change word for one part, unreadable when a count is not a finite number.", [
    '[0, 0, 0, 0], 0, false gives { attention: false, change: "same" }', '[NaN, 0, 0, 0], 5, false gives { attention: true, change: "unreadable" }', '[0, 0, 0, 0], Infinity, false gives { attention: true, change: "unreadable" }',
  ]);
  assert.equal(run(V6, wiring).e, null);
});

test("a non-finite scalar argument is read, and never counts as edge or far evidence", () => {
  const P: ListParam[] = [...XS, { name: "t", type: "number" }];
  const r = deriveListProgram({ nonFinite: true, params: P, ret: "number", examples: [
    { args: [[1, 2, 3], 2], out: 1 }, { args: [[1, 2, 3], NaN], out: 0 }, { args: [[5, Infinity], Infinity], out: 0 }, { args: [[], 0], out: 0 }, { args: [[-3, 9], -4], out: 2 }, { args: [[4, 4], 3], out: 2 }, { args: [[NaN, 2], 1], out: 1 },
  ] });
  assert.ok(!r.ok && r.reason === "derive_under_specified" && r.gate === "far", JSON.stringify(r));
});

test("Job B and the review note: v6 rechecks by its own operation id; the note is rebuilt from the diff alone", () => {
  const { e } = run(V6, ALL_FINITE);
  const lines = (c: string) => c.replace(/\n$/, "").split("\n");
  const newFile = (f: { path: string; content: string }) => `diff --git a/${f.path} b/${f.path}\nnew file mode 100644\nindex 0000000..1111111\n--- /dev/null\n+++ b/${f.path}\n@@ -0,0 +1,${lines(f.content).length} @@\n${lines(f.content).map((l) => `+${l}`).join("\n")}\n`;
  const d = newFile(e!) + newFile(e!.extra![0]!);
  const note = deriveNonFiniteReviewNote(d);
  assert.ok(note && note.includes("v6") && note.includes("return xs.every((x) => Number.isFinite(x));"), note ?? "null");
  assert.equal(deriveListReviewNote(d), null, "v4's note does not read NaN literals");
  assert.equal(deriveNonFiniteReviewNote(newFile({ ...e!, content: e!.content.replace("Number.isFinite(x)", "x === x") }) + newFile(e!.extra![0]!)), null);
  // Append: an existing module plus the v6 function, add-only.
  const base = "export const ready = true;\n";
  const files = [{ path: "src/checks.ts", content: base }];
  const app = run(V6, ALL_FINITE.replace("Add a new module `src/all-finite.ts` exporting `allFinite(xs: number[]): boolean`.", "Append a new function `allFinite(xs: number[]): boolean` to the existing module `src/checks.ts`."), files).e!;
  assert.ok(app, "append derives");
  assert.equal(deriveAppendRecheck(`${DERIVE_NONFINITE_OPERATION}x`, base, app.content), null);
  assert.notEqual(deriveAppendRecheck(`${DERIVE_LIST_OPERATION}x`, base, app.content), null);
  assert.equal(derivedNonFiniteModuleProblem("export function f(Number: number[]): boolean {\n  return Number.every((x) => Number.isFinite(x));\n}\n"), "derive_reserved_name");
});

test("the flag is off by default: v4 search, probes and programs are unchanged for finite examples", () => {
  const ex = [[1, 2, 3], [], [200, 300, 5], [150], [-300, 101], [6], [100, 99]].map((xs) => ({ args: [xs] as ListArg[], out: (xs as number[]).filter((x) => x >= 100).length }));
  const a = deriveListProgram({ params: XS, ret: "number", examples: ex });
  const b = deriveListProgram({ params: XS, ret: "number", examples: ex, nonFinite: true });
  assert.deepEqual(b, a);
  assert.ok(a.ok);
  assert.equal(compileList(a.program, ["xs"], 0), "xs.filter((x) => 100 <= x).length");
});

// ---- G17 gate fix: the non-finite twins ----
const N = (rows: (number[])[], f: (xs: number[]) => number | boolean | number[]) => rows.map((xs) => ({ args: [xs] as ListArg[], out: f(xs) as ListArg }));
const derive6 = (examples: ReturnType<typeof N>, ret: "number" | "boolean" | { list: "number" } = "number") => deriveListProgram({ nonFinite: true, params: XS, ret, examples });
/** Math.max / Math.min as the 5 upstream bodies use them (0 for the empty list). */
const mathMax = (xs: number[]) => (xs.length === 0 ? 0 : Math.max(...xs));
const mathMin = (xs: number[]) => (xs.length === 0 ? 0 : Math.min(...xs));
/** The DSL's own reduce max (keeps the running max; a NaN first element stays). */
const reduceMax = (xs: number[]) => xs.reduce((n, x, i) => (i === 0 || n <= x ? x : n), 0);
// The 5 upstream training slices from #596 (the first rows each derived a wrong max / min from).
const MAX_ROWS = [[1, 101, 3], [], [1], [-Infinity, 101], [-2, Infinity, -150, 30], [NaN], [-Infinity]];
const MIN_ROWS = [[1, 101, 3], [], [1], [-Infinity, 101], [-2, Infinity, -150, 30], [NaN], [150, -1]];

test("nonfinite gate: a max / min whose examples never show NaN after the first element is refused with a NaN row to answer", () => {
  for (const [rows, f, op] of [[MAX_ROWS, mathMax, "max"], [MIN_ROWS, mathMin, "min"]] as const) {
    const r = derive6(N(rows, f));
    assert.ok(!r.ok && r.reason === "derive_under_specified" && r.gate === "nonfinite", `${op}: ${JSON.stringify(r)}`);
    const q = r.questions![0]!;
    const L = q.at[0] as number[];
    assert.ok(L.length >= 2 && L.slice(1).some(Number.isNaN), `${op} asks for NaN after the first element: ${listLit(L)}`);
    assert.ok(Object.is(f(L), NaN), "upstream answers NaN");
    // Answered by the upstream function, no v6 program fits: refused, never a wrong derivation.
    const after = derive6([...N(rows, f), { args: [L], out: f(L) }]);
    assert.ok(!after.ok && after.reason === "derive_no_fit", `${op}: ${JSON.stringify(after)}`);
  }
  // Through the rule: the refusal is derive_under_specified_nonfinite, the asked row in the detail.
  const text = issue("Add a new module `src/peak.ts` exporting `peak(xs: number[]): number`.", "the largest count in the list, zero for an empty list.", MAX_ROWS.map((xs) => `${listLit(xs)} gives ${listLit(mathMax(xs))}`));
  const why: { reason?: string; questions?: string } = {};
  const e = runDeriveRule(V6.trigger, V6.params, objective(text), FILES, isTest, why as never);
  assert.equal(e, null);
  assert.match(why.reason ?? "", /^derive_under_specified_nonfinite: xs$/);
});

test("nonfinite gate: a function that really is the DSL's reduce max derives once its examples pin NaN first and later", () => {
  const rows = [...MAX_ROWS, [NaN, 4], [4, NaN, 2]];
  const r = derive6(N(rows, reduceMax));
  assert.ok(r.ok, JSON.stringify(r));
  assert.equal(compileList(r.program, ["xs"], 0), "xs.reduce((n, x, i) => (i === 0 || n <= x ? x : n), 0)");
  // Without the NaN-later row the NaN-propagating reading still fits: asked, not accepted.
  const short = derive6(N([...MAX_ROWS, [NaN, 4]], reduceMax));
  assert.ok(!short.ok && short.gate === "nonfinite", JSON.stringify(short));
  // Without the NaN-first row a skip-NaN reading fits: asked too.
  const short2 = derive6(N([...MAX_ROWS.filter((xs) => !(xs.length === 1 && Number.isNaN(xs[0]))), [4, NaN, 2], [Infinity]], reduceMax));
  assert.ok(!short2.ok && short2.gate === "nonfinite", JSON.stringify(short2));
});

test("nonfinite gate: comparisons with NaN (x >= c vs !(x < c)) and NaN-only / empty lists", () => {
  // keep 1 <= x: no NaN element in the examples, so `!(x < 1)` (keeps NaN) also fits: asked.
  const rows = [[1, 2, 3], [], [0, Infinity], [-Infinity, 4, 5], [-150, 150, 101], [2, 2], [0], [-101, 1, 101]];
  const ge = (xs: number[]) => xs.filter((x) => x >= 1);
  const r = derive6(N(rows, ge), { list: "number" });
  assert.ok(!r.ok && r.gate === "nonfinite", JSON.stringify(r));
  const L = r.questions![0]!.at[0] as number[];
  assert.ok(L.some(Number.isNaN), listLit(L));
  // Answered `x >= 1` (NaN dropped): derives `1 <= x`; answered `!(x < 1)` (NaN kept): no v6 program, refused.
  const yes = derive6([...N(rows, ge), { args: [L], out: ge(L) }], { list: "number" });
  assert.ok(yes.ok && compileList(yes.program, ["xs"], 0) === "xs.filter((x) => 1 <= x)", JSON.stringify(yes));
  const notLt = (xs: number[]) => xs.filter((x) => !(x < 1));
  const no = derive6([...N(rows, notLt), { args: [L], out: notLt(L) }], { list: "number" });
  assert.ok(!no.ok, JSON.stringify(no));
  // A NaN-only list is probed, and a NaN-only example pins it: sum of [NaN, NaN] is NaN, the empty list 0.
  const sum = (xs: number[]) => xs.reduce((n, x) => n + x, 0);
  const s = derive6(N([[1, 2, 3], [], [NaN, NaN], [Infinity, -Infinity], [4, NaN], [-150, 101], [-150, -101], [150, 101]], sum));
  assert.ok(s.ok && compileList(s.program, ["xs"], 0) === "xs.reduce((n, x) => n + x, 0)", JSON.stringify(s));
  const probes = nonFiniteProbes({ nonFinite: true, params: XS, ret: "number", examples: N([[1, 2, 3], [], [NaN]], sum) }, { op: "sum", f: null, pred: null })!;
  assert.ok(probes.some((a) => valueKey(a) === valueKey([[NaN, NaN]])) && probes.some((a) => valueKey(a) === valueKey([[]])), "NaN-only and empty lists are probed");
  // A sum that skips NaN: the plain sum no longer fits, and the kept-sum cuts that skip NaN stay rivals (asked, not guessed).
  const skip = (xs: number[]) => sum(xs.filter((x) => !Number.isNaN(x)));
  const k = derive6(N([[1, 2, 3], [], [NaN, NaN], [Infinity, 5], [4, NaN], [-150, 101], [-150, -101], [150, 101]], skip));
  assert.ok(!k.ok && k.reason === "derive_ambiguous", JSON.stringify(k));
  // One NaN-only list rules out the skip-NaN and skip-non-finite readings of a plain sum.
  const one = derive6(N([[1, 2, 3], [], [Infinity, 5], [-150, 101], [-150, -101], [150, 101], [NaN]], sum));
  assert.ok(one.ok && compileList(one.program, ["xs"], 0) === "xs.reduce((n, x) => n + x, 0)", JSON.stringify(one));
});

test("nonfinite gate: twins are v6 only; v4 search, gates and results are unchanged", () => {
  // The same finite examples as a v4 task and as a flagged search: identical (the gate needs a non-finite example).
  const ex = N([[1, 2, 3], [], [200, 300, 5], [150], [-300, 101], [6], [100, 99]], (xs) => xs.filter((x) => x >= 100).length);
  assert.deepEqual(deriveListProgram({ params: XS, ret: "number", examples: ex, nonFinite: true }), deriveListProgram({ params: XS, ret: "number", examples: ex }));
  // v4 refuses the max examples the gate asks about at derive_examples (it never reads NaN), as before.
  assert.equal((deriveListProgram({ params: XS, ret: "number", examples: N(MAX_ROWS, mathMax) }) as { reason?: string }).reason, "derive_examples");
  assert.deepEqual(nonFiniteTwins({ op: "length" }, XS), []);
  assert.deepEqual(nonFiniteTwins({ op: "max", f: null, empty: 0 }, XS), ["skip-nan", "skip-nonfinite", "nan-poison"]);
  assert.deepEqual(nonFiniteTwins({ op: "filter", pred: { op: "ge", f: null, c: 1 } }, XS), ["nan-true", "skip-nan", "skip-nonfinite"]);
  assert.ok(Object.is(evalNonFiniteTwin({ op: "max", f: null, empty: 0 }, "nan-poison", [[1, NaN, 3]], XS), NaN));
  assert.equal(evalNonFiniteTwin({ op: "max", f: null, empty: 0 }, "skip-nan", [[NaN, 1]], XS), 1);
  assert.deepEqual(evalNonFiniteTwin({ op: "filter", pred: { op: "ge", f: null, c: 1 } }, "nan-true", [[NaN, 0, 2]], XS), [NaN, 2]);
});

// ---- G17 phase 2 + gate fix: upstream evidence, every record recomputed from the committed seed-136 generator ----
test("evidence: the committed generator reproduces every record (training rows, asked rows, derivation or refusal, held-out counts) and the totals", () => {
  type Fn = M136Entry & { repo: string; commit: string; license: string; set: string; sha256: string; expr?: string; refused?: string; outOfVocabulary?: boolean; heldOut?: { right: number; wrong: number; nonFinite: number }; addedForGates: string[]; examples: string[]; wrongAt?: string[]; beforeNonFiniteGate?: { expr: string; heldOut: { right: number; wrong: number; nonFinite: number }; wrongAt: string[] } };
  const ev = JSON.parse(read(M136_EVIDENCE)) as { schema: string; functions: Fn[] };
  assert.equal(ev.schema, "peaceai-m136-derive-nonfinite-evidence:v1");
  const m113 = JSON.parse(read("peaceai/rules/proposals/m113-derive-list-evidence.json")) as { functions: { repo: string; commit: string; fn: string; sha256: string }[] };
  let held = 0, nonFinite = 0, wrong = 0;
  for (const f of ev.functions) {
    assert.ok(["MIT", "Apache-2.0", "ISC"].includes(f.license), `${f.repo}: ${f.license}`);
    assert.ok(["v4-upstream", "non-finite-upstream"].includes(f.set), f.fn);
    if (f.set === "v4-upstream") assert.ok(m113.functions.some((g) => g.repo === f.repo && g.commit === f.commit && g.fn === f.fn && g.sha256 === f.sha256), `${f.fn} is M113's`);
    const r = rerunEntry(f);
    assert.deepEqual(r.examples, f.examples, `${f.fn}: training rows`);
    assert.deepEqual(r.addedForGates, f.addedForGates, `${f.fn}: asked rows`);
    assert.equal(r.expr, f.expr, `${f.fn}: expression`);
    assert.equal(r.refused, f.refused, `${f.fn}: refusal`);
    assert.deepEqual(r.heldOut, f.heldOut, `${f.fn}: held-out counts`);
    assert.deepEqual(r.wrongAt, f.wrongAt, f.fn);
    const examples = f.examples.map((l) => { const v = lexListValues(l, true); assert.ok(v, `${f.fn}: ${l}`); return { args: v.values, out: v.out }; });
    assert.ok(hasNonFinite(examples), `${f.fn}: a v6 task holds a non-finite example`);
    if (r.heldOut) { held += r.heldOut.right; nonFinite += r.heldOut.nonFinite; wrong += r.heldOut.wrong; }
    if (f.beforeNonFiniteGate) {
      assert.ok(f.refused && f.addedForGates.some((a) => a.startsWith("derive_under_specified_nonfinite: ")), `${f.fn}: refused after the asked NaN row`);
      assert.equal(f.beforeNonFiniteGate.heldOut.wrong, 11);
      assert.ok(f.beforeNonFiniteGate.wrongAt.every((w) => /NaN/.test(w)), f.fn);
    }
  }
  const right = ev.functions.filter((f) => f.expr);
  assert.deepEqual([ev.functions.length, right.length, ev.functions.filter((f) => f.refused).length, ev.functions.filter((f) => f.beforeNonFiniteGate).length], [24, 14, 10, 5]);
  assert.deepEqual([held, nonFinite, wrong], [4355, 2589, 0]);
  assert.ok(right.some((f) => /Number\.isFinite/.test(f.expr!)) && ev.functions.filter((f) => f.set === "non-finite-upstream").length === 4);
  assert.deepEqual(V6.evidence, { commits: 14, files: 14, hunks: 14, repos: [...new Set(right.map((f) => f.repo))].sort() });
  const prop = JSON.parse(read("peaceai/rules/proposals/public-derive-from-behavior-v6.json")) as { evidence: { file: string; qualifies: boolean; examples: number; derived: number; right: number; wrongOnNaN: number; refused: number; heldOut: number; heldOutNonFinite: number } };
  assert.equal(prop.evidence.file, M136_EVIDENCE);
  assert.deepEqual([prop.evidence.examples, prop.evidence.derived, prop.evidence.right, prop.evidence.wrongOnNaN, prop.evidence.refused, prop.evidence.heldOut, prop.evidence.heldOutNonFinite], [24, 14, 14, 0, 10, held, nonFinite]);
  assert.equal(prop.evidence.qualifies, false, "v6 has no evidence bar of its own yet; only 3 of the 14 use a non-finite test themselves");
});

test("evidence generator: the seed-136 grid is deterministic and holds every non-finite value", () => {
  const e: M136Entry = { fn: "sum", upstream: "function sum(xs: number[]): number { return xs.reduce((a, b) => a + b, 0); }", params: [{ name: "xs", type: "number[]" }], ret: "number" };
  const g1 = m136Grid(e), g2 = m136Grid(e);
  assert.equal(g1.length, 48);
  assert.equal(valueKey(g1), valueKey(g2));
  const flat = g1.flatMap((a) => a[0] as number[]);
  assert.ok(flat.some(Number.isNaN) && flat.includes(Infinity) && flat.includes(-Infinity));
  assert.ok(Object.is(upstreamFn(e)([1, NaN]), NaN));
  assert.throws(() => upstreamFn({ ...e, upstream: "function sum(xs: number[]): number { return process.exit(1); }" })([1]), /process is not defined/);
});
