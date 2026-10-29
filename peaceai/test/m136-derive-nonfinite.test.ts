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
import { compileList, deriveListProgram, evalList, hasNonFinite, lexListValues, listLit, parseListType, valueKey, valueOk, type ListArg, type ListParam } from "../lib/derive-list.ts";
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

// ---- G17 phase 2: upstream evidence, every recorded function re-derived from its recorded example lines ----
test("evidence: each upstream function re-derives (v6) to its recorded expression or refusal; the max / min wrong on NaN stay disclosed; the spec counts only the 0-wrong ones", () => {
  type Fn = { repo: string; commit: string; license: string; fn: string; set: string; params: { name: string; type: string }[]; ret: string; examples: string[]; expr?: string; refused?: string; outOfVocabulary?: boolean; wrongOnNaN?: boolean; heldOut?: { right: number; wrong: number; nonFinite: number }; wrongAt?: string[] };
  const ev = JSON.parse(read("peaceai/rules/proposals/m136-derive-nonfinite-evidence.json")) as { schema: string; functions: Fn[] };
  assert.equal(ev.schema, "peaceai-m136-derive-nonfinite-evidence:v1");
  const m113 = JSON.parse(read("peaceai/rules/proposals/m113-derive-list-evidence.json")) as { functions: { repo: string; commit: string; fn: string; sha256: string }[] };
  let held = 0, nonFinite = 0;
  for (const f of ev.functions) {
    assert.ok(["MIT", "Apache-2.0", "ISC"].includes(f.license), `${f.repo}: ${f.license}`);
    assert.ok(["v4-upstream", "non-finite-upstream"].includes(f.set), f.fn);
    if (f.set === "v4-upstream") assert.ok(m113.functions.some((g) => g.repo === f.repo && g.commit === f.commit && g.fn === f.fn && g.sha256 === (f as unknown as { sha256: string }).sha256), `${f.fn} is M113's`);
    const params = f.params.map((p) => ({ name: p.name, type: parseListType(p.type)! }));
    const ret = parseListType(f.ret)!;
    assert.ok(params.every((p) => p.type) && ret, f.fn);
    const examples = f.examples.map((l) => { const v = lexListValues(l, true); assert.ok(v, `${f.fn}: ${l}`); return { args: v.values, out: v.out }; });
    assert.ok(hasNonFinite(examples), `${f.fn}: a v6 task holds a non-finite example`);
    const r = deriveListProgram({ params, ret, examples, nonFinite: true });
    if (f.expr) {
      assert.ok(r.ok, `${f.repo} ${f.fn}: ${!r.ok && r.reason}`);
      assert.equal(compileList(r.program, params.map((p) => p.name), params.findIndex((p) => typeof p.type === "object")), f.expr, f.fn);
      if (f.wrongOnNaN) {
        assert.ok(f.heldOut!.wrong > 0 && f.wrongAt!.length > 0 && f.wrongAt!.every((w) => /NaN/.test(w)), f.fn);
        assert.match(f.expr, /\.reduce\(\(n, x, i\) => \(i === 0 \|\|/, `${f.fn}: only max / min are wrong`);
      } else { assert.equal(f.heldOut?.wrong, 0, f.fn); held += f.heldOut!.right; nonFinite += f.heldOut!.nonFinite; }
    } else assert.ok(!r.ok && r.reason === f.refused, `${f.fn}: ${r.ok ? "derived" : r.reason}`);
  }
  const right = ev.functions.filter((f) => f.expr && !f.wrongOnNaN);
  assert.deepEqual([ev.functions.length, ev.functions.filter((f) => f.expr).length, right.length, ev.functions.filter((f) => f.wrongOnNaN).length], [24, 19, 14, 5]);
  assert.deepEqual([held, nonFinite], [3565, 1799]);
  assert.ok(right.some((f) => /Number\.isFinite/.test(f.expr!)) && ev.functions.filter((f) => f.set === "non-finite-upstream").length === 4);
  assert.deepEqual(V6.evidence, { commits: 14, files: 14, hunks: 14, repos: [...new Set(right.map((f) => f.repo))].sort() });
  const prop = JSON.parse(read("peaceai/rules/proposals/public-derive-from-behavior-v6.json")) as { evidence: { file: string; qualifies: boolean; examples: number; derived: number; right: number; wrongOnNaN: number } };
  assert.equal(prop.evidence.file, "peaceai/rules/proposals/m136-derive-nonfinite-evidence.json");
  assert.deepEqual([prop.evidence.examples, prop.evidence.derived, prop.evidence.right, prop.evidence.wrongOnNaN], [24, 19, 14, 5]);
  assert.equal(prop.evidence.qualifies, false, "five in-vocabulary max / min derivations are wrong on NaN rows: not until v6 asks for a NaN row");
});
