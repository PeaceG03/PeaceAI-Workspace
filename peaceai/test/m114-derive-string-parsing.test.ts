// M114 (public-derive-from-behavior-v5, rule params dsl typed-dsl-v5-strings + placement new-or-existing-module-v5):
// PeaceAI derives a small pure STRING PARSER (read back a check-in line `part|status|note`: split on one delimiter,
// pick a field, trim, parse an integer, startsWith / endsWith / includes / ===, strip a prefix or suffix, a comma
// list) from literal examples, by a bounded search over a typed string DSL (peaceai/lib/derive-string.ts). It refuses
// when two fits disagree on a probe (with the asked rows), when an unpinned default or constant is relied on (asked
// row), when none fits, when the search is too large, and anything with side effects, regexes built from input or
// loops. v1-v3 are untouched (separate trigger, separate engine; their hashes are pinned below).
// HELD_OUT (peaceai/test/m114-held-out.ts) was committed before the engine existed; its first-run refusals and the
// rows they asked for are recorded below. Names are this file's own (nothing names a PeaceSTOCKS function).
// Escaping (escapeCheckinNote: backslash, `|` and newline escaped) is NOT in v5; it is v6 scope, and v5 refuses it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { APPROVED_SCHEMA } from "../lib/approved.ts";
import { compileStr, deriveStringProgram, evalStr, outKey, readsQ, strExprProblem, strLit, validProgram, type StrArg, type StrExample, type StrOut, type StrParam, type StrProgram, type StrRet, type XNode } from "../lib/derive-string.ts";
import { DERIVE_APPEND_TRIGGER, DERIVE_STRING_DSL, DERIVE_STRING_OPERATION, DERIVE_STRING_PLACEMENT, DERIVE_STRING_TRIGGER, DERIVE_TRIGGER, DERIVE_VOCAB, deriveAppendRecheck, deriveModuleRecheck, deriveReviewNote, deriveStringReviewNote, derivedStringModuleProblem, parseDeriveStringTask, runDeriveRule, validDeriveParams } from "../lib/learned-derive.ts";
import { specHash, validateSpec, type RuleSpec } from "../lib/learned.ts";
import { PEACE_AUTHOR } from "../lib/minetest.ts";
import { DERIVE_APPEND_PHRASING, DERIVE_STRING_PHRASING, PHRASING, phrasingFor } from "../lib/propose.ts";
import { LEARNED_CANONICAL } from "../lib/nlparse.ts";
import { validateResults } from "../lib/results.ts";
import { cleanIssueText } from "../lib/taskmap.ts";
import { HELD_OUT, type HeldArg, type HeldSpec } from "./m114-held-out.ts";

const repo = resolve(import.meta.dirname, "..", "..");
const tsx = join(repo, "node_modules/.bin/tsx");
const read = (p: string) => readFileSync(join(repo, p), "utf8");
const V1 = JSON.parse(read("peaceai/rules/learned/public-derive-from-behavior-v1.json")) as RuleSpec;
const V2 = JSON.parse(read("peaceai/rules/learned/public-derive-from-behavior-v2.json")) as RuleSpec;
const V3 = JSON.parse(read("peaceai/rules/learned/public-derive-from-behavior-v3.json")) as RuleSpec;
const V5 = JSON.parse(read("peaceai/rules/learned/public-derive-from-behavior-v5.json")) as RuleSpec;
const SHA5 = specHash(V5);
const CONFINED = Number(process.versions.node.split(".")[0]) >= 22;
const git = (cwd: string, ...a: string[]) => execFileSync("git", ["-c", "user.name=PeaceG03", "-c", `user.email=${PEACE_AUTHOR}`, ...a], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const isTest = (p: string) => /\.test\.ts$/.test(p);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Fn = (...a: any[]) => any;
type Spec = { fn: string; sig: string; ret: StrRet; f: Fn; examples: HeldArg[][]; asked: HeldArg[][] };
const paramsOf = (sig: string): StrParam[] => sig.split(", ").map((p) => { const [name, type] = p.split(": "); return { name: name!, type: type as "string" | "number" }; });
const rows = (h: Spec, first = false) => [...h.examples, ...(first ? [] : h.asked)].map((args) => ({ args, out: h.f(...args) as StrOut }));
const addHead = (file: string, h: Spec) => `Add a new module \`${file}\` exporting the string parser \`${h.fn}(${h.sig}): ${h.ret}\`.`;
const appendHead = (file: string, h: Spec) => `Append a new string parser \`${h.fn}(${h.sig}): ${h.ret}\` to the existing module \`${file}\`.`;
/** A v5 issue, in the shape Builder files them (header, behavior prose, literal examples). */
const issue = (head: string, examples: { args: readonly StrArg[]; out: StrOut }[]) => [
  head, "",
  "Behavior: a plain description of the wanted result.", "",
  "Examples:",
  ...examples.map((e) => `- ${e.args.map((a) => strLit(a)).join(", ")} gives ${strLit(e.out)}`), "",
].join("\n");
const TITLE = "string task";
const objective = (body: string) => cleanIssueText({ title: TITLE, body } as never);
const rawOf = (body: string) => `${TITLE}\n\n${body}`;

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

const derivedFn = (block: string, h: Spec): Fn => {
  const m = /^export function (\w+)\(.*\{\n {2}return (.*);\n\}\n$/s.exec(block);
  assert.ok(m && m[1] === h.fn, block);
  return new Function(...paramsOf(h.sig).map((p) => p.name), `return ${m[2]};`) as Fn;
};
const body = (e: { content: string }, base = "") => {
  if (base) { assert.ok(e.content.startsWith(`${base}\n`), "add-only: the old text is a prefix, then one blank line"); return e.content.slice(base.length + 1); }
  return e.content;
};
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function runTests(files: readonly { path: string; content: string }[], tests: readonly string[]): { ok: boolean; out: string } {
  const dir = mkdtempSync(join(tmpdir(), "m114t-"));
  try {
    for (const f of files) { mkdirSync(join(dir, f.path, ".."), { recursive: true }); writeFileSync(join(dir, f.path), f.content); }
    writeFileSync(join(dir, "package.json"), '{ "type": "module" }\n');
    symlinkSync(join(repo, "node_modules"), join(dir, "node_modules"));
    const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("NODE_TEST")));
    const r = spawnSync(tsx, ["--test", ...tests], { cwd: dir, encoding: "utf8", timeout: 120_000, env });
    return { ok: r.status === 0, out: `${r.stdout}\n${r.stderr}` };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

const rng = (seed: number) => () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const TOK = ["scan", "r2", "tenmin", "ok", "error", " error ", "late", "12", "0", "-3", "x", "", " ok", "#slow", "#retry", "part:scan", "part:", "src", "a.ts", "# note", "7x", "daily"];
const DELIMS = ["|", ",", "/", ":", " "];
/** Random lines for held-out checks: 0-5 tokens joined by the spec's delimiter (sometimes another), padded at times. */
function randomArgs(h: Spec, seed: number, n = 300): StrArg[][] {
  const R = rng(seed);
  const pick = <T>(a: readonly T[]) => a[Math.floor(R() * a.length)]!;
  const own = h.examples.flatMap((e) => [...String(e[0])].filter((c) => DELIMS.includes(c) && c !== " "))[0] ?? "|";
  const ps = paramsOf(h.sig);
  const out: StrArg[][] = [];
  for (let k = 0; k < n; k++) {
    let s = Array.from({ length: Math.floor(R() * 6) }, () => pick(TOK)).join(R() < 0.8 ? own : pick(DELIMS));
    if (R() < 0.15) s = ` ${s}`;
    if (R() < 0.15) s = `${s} `;
    const q = ps[1] ? (ps[1].type === "number" ? Math.floor(R() * 6) - 1 : pick([...h.examples.map((e) => e[1] as string), "#slow", "#", "", " #slow", "ok"])) : undefined;
    out.push(q === undefined ? [s] : [s, q]);
  }
  return out;
}

// ---- Held-out specs (peaceai/test/m114-held-out.ts, committed before the engine existed) ----
// First run on the examples as written: partOf, statusOf, fieldCount and listItems derived; the other eight were
// REFUSED, each as derive_ambiguous with up to three asked rows in its detail. The rows below are the ones the engine
// asked for, round by round, answered by the reference function the way an issue author would (nothing in
// `examples` was changed). hasTag (a test on its second parameter) needs the most: 14 rows over five rounds; the
// rivals are the same test on a field, on the trimmed line, or with a constant cut from the examples.
const ASKED: Record<string, HeldArg[][]> = {
  partOf: [], statusOf: [], fieldCount: [], listItems: [],
  noteOf: [["scan|ok| took 12s "]],
  ageOf: [[" scan|12 "], ["scan|12|zz"], ["|scan|12"]],
  isErrorLine: [["scan|r|disk"], ["scan|or|disk"], ["scan|ror|disk"], ["scan|rror|disk"], ["scan|~error|disk"]],
  stripPartPrefix: [[" part: "], ["part: part:scan"], ["part: 12"]],
  hasTag: [["", "#slow"], ["s", "#slow"], [" #s ", "#slow"], ["n", "#slow"], [" n| ", "#slow"], ["#scan|ok|#slow", "#retry"], [" scan|ok|#slow ", "#slow"], ["scan|ok|#slow|zz", "#slow"], ["scan|ok| #slow ", "#slow"], ["|scan|ok|#slow", "#slow"], ["scan|ok| #slow ", " #slow"], [" scan|ok|#slow ", "#slow "], ["#slow", "#slow"], ["scan|ok|#slow", "|#slow"]],
  fieldAt: [[" scan |ok|fine", 0]],
  isComment: [["## note"]],
  lastSegment: [["src/a/ b.ts "]],
};
const EXPR: Record<string, string> = {
  partOf: '(line.split("|")[0] ?? "").trim()',
  statusOf: '(line.split("|")[1] ?? "unknown").trim()',
  noteOf: 'line.split("|").length > 2 ? line.split("|").slice(2).join("|") : ""',
  fieldCount: 'line.split("|").length',
  ageOf: '/^-?\\d{1,12}$/.test(line.split("|")[1] ?? "") ? Number(line.split("|")[1] ?? "") : -1',
  isErrorLine: '(line.split("|")[1] ?? "").trim() === "error"',
  stripPartPrefix: 'line.startsWith("part:") ? line.slice(5) : line',
  hasTag: "line.includes(tag)",
  fieldAt: 'line.split("|")[n] ?? ""',
  isComment: 'line.trim().startsWith("#")',
  lastSegment: 'path.slice(path.lastIndexOf("/") + 1)',
  listItems: 'text.split(",").map((v) => v.trim())',
};
const SPECS: Spec[] = HELD_OUT.map((h: HeldSpec) => ({ ...h, f: h.f as Fn, asked: ASKED[h.fn]! }));

const derive = (h: Spec, head: string, first = false, files = FILES, withRaw = true) => {
  const why: { reason?: string } = {};
  const b = issue(head, rows(h, first));
  const e = runDeriveRule(V5.trigger, V5.params, objective(b), files, isTest, why, withRaw ? rawOf(b) : undefined);
  return { e, why };
};
const NEW = (h: Spec) => addHead("src/checkin-read.ts", h);

test("held-out record: as first written, four derive and eight are refused as derive_ambiguous with asked rows", () => {
  const got = SPECS.map((h) => { const { e, why } = derive(h, NEW(h), true); return e ? "derived" : why.reason; });
  assert.deepEqual(got, ["derived", "derived", "derive_ambiguous", "derived", "derive_ambiguous", "derive_ambiguous", "derive_ambiguous", "derive_ambiguous", "derive_ambiguous", "derive_ambiguous", "derive_ambiguous", "derived"]);
  // the refusal's own result carries the asked row
  const b = issue(NEW(SPECS[9]!), rows(SPECS[9]!, true));
  const t = parseDeriveStringTask(objective(b), rawOf(b));
  assert.ok("task" in t);
  const r = deriveStringProgram({ params: t.task.params, ret: t.task.ret, examples: t.task.examples });
  assert.ok(!r.ok && r.reason === "derive_ambiguous");
  assert.deepEqual(r.questions?.map((q) => q.at), [["## note"]]);
});

test("held-out: answering each round's asked rows with the reference reproduces the recorded rows and expressions", () => {
  for (const h of SPECS) {
    const params = paramsOf(h.sig);
    const args = h.examples.map((a) => [...a]);
    const asked: HeldArg[][] = [];
    let done = false;
    for (let r = 0; r < 8 && !done; r++) {
      const res = deriveStringProgram({ params, ret: h.ret, examples: args.map((a) => ({ args: a, out: h.f(...a) as StrOut })) });
      if (res.ok) { assert.equal(compileStr(res.program, params.map((p) => p.name)), EXPR[h.fn], h.fn); done = true; break; }
      assert.equal(res.reason, "derive_ambiguous", h.fn);
      assert.ok(res.questions?.length, h.fn);
      for (const q of res.questions!) { args.push(q.at as HeldArg[]); asked.push(q.at as HeldArg[]); }
    }
    assert.ok(done, h.fn);
    assert.deepEqual(asked, h.asked, h.fn);
  }
});

test("held-out specs: each derives (new module and append) to the recorded expression, equal to the reference on 300 seeded random lines; the generated tests pass", () => {
  let checked = 0;
  const files: { path: string; content: string }[] = [];
  const tests: string[] = [];
  for (const [k, h] of SPECS.entries()) {
    const { e, why } = derive(h, addHead(`src/read-${k}.ts`, h));
    assert.ok(e, `${h.fn}: ${why.reason}`);
    assert.equal(/return (.*);/.exec(e.content)![1], EXPR[h.fn], h.fn);
    const a = derive(h, appendHead("src/health.ts", h)).e;
    assert.ok(a, h.fn);
    assert.equal(body(a, HEALTH), e.content, "the appended block is the new-module text");
    assert.equal(deriveAppendRecheck(`${DERIVE_STRING_OPERATION}${SHA5}`, HEALTH, a.content), null);
    const got = derivedFn(e.content, h);
    const params = paramsOf(h.sig);
    const res = deriveStringProgram({ params, ret: h.ret, examples: rows(h) });
    assert.ok(res.ok, h.fn);
    for (const args of randomArgs(h, 114 + k)) {
      checked++;
      assert.ok(same(got(...args), h.f(...args)), `${h.fn}(${JSON.stringify(args)}): ${JSON.stringify(got(...args))} vs ${JSON.stringify(h.f(...args))}`);
      // the compiled text and the evaluator agree
      assert.ok(same(got(...args), evalStr(res.program, args)), h.fn);
    }
    files.push({ path: e.path, content: e.content }, { path: e.extra[0]!.path, content: e.extra[0]!.content });
    tests.push(e.extra[0]!.path);
  }
  assert.equal(checked, 12 * 300);
  const r = runTests(files, tests);
  assert.ok(r.ok, r.out);
});

// ---- Raw issue text (cleaning rewrites #, backticks, *, tabs and space runs) ----
test("raw text: a literal with a space is read from the uncleaned issue; without it, or when the raw bullets differ, derive_examples_raw", () => {
  const h = SPECS[9]!; // isComment: "# note", "## note"
  const b = issue(NEW(h), rows(h));
  assert.ok(!objective(b).includes('"# note"'), "cleaning rewrites the literal");
  const w: { reason?: string } = {};
  assert.equal(runDeriveRule(V5.trigger, V5.params, objective(b), FILES, isTest, w), null);
  assert.equal(w.reason, "derive_examples_raw");
  const { e } = derive(h, NEW(h));
  assert.ok(e && e.extra[0]!.content.includes('isComment("# note"), true') && e.extra[0]!.content.includes('isComment("## note"), true'), e?.extra[0]!.content);
  const parse = (raw: string) => { const t = parseDeriveStringTask(objective(b), raw); return "reason" in t ? t.reason : "ok"; };
  assert.equal(parse(rawOf(b)), "ok");
  assert.equal(parse(rawOf(b.replace('"# note"', '"# notes"'))), "derive_examples_raw");
  // a space run the cleaning collapses is read as written (the raw text is what the author typed)
  const t2 = parseDeriveStringTask(objective(b), rawOf(b.replace('"# note"', '"#  note"')));
  assert.ok("task" in t2 && t2.task.examples.some((x) => x.args[0] === "#  note"));
  assert.equal(parse(rawOf(b.replace('- "# note"', '- "x" gives true <!-- -->\n- "# note"'))), "derive_examples_raw");
  assert.equal(parse(rawOf(b.replace('- "# note" gives true', '- "# note" gives true ```'))), "derive_examples_raw");
  assert.equal(parse(rawOf(`${b}\nExamples:\n- "a" gives false\n`)), "derive_examples_raw");
  // strings with no space need no raw text (cleaning leaves them verbatim)
  const p = SPECS[3]!; // fieldCount
  const wp: { reason?: string } = {};
  assert.ok(runDeriveRule(V5.trigger, V5.params, objective(issue(NEW(p), rows(p))), FILES, isTest, wp), wp.reason);
});

test("raw text reaches only v5: v1-v3 build the same edit with and without it", () => {
  const head = "Add a new module `src/budget.ts` exporting `isOverBudget(spent: number, budget: number): boolean`.";
  const b = [head, "", "Behavior: true when the amount spent is more than the budget.", "", "Examples:", ...[[5, 10, false], [11, 10, true], [10, 10, false], [0, 0, false], [1, 0, true], [100, 7, true], [9, 10, false], [12, 10, true]].map(([a, c, d]) => `- ${a}, ${c} gives ${d}`), ""].join("\n");
  const ah = "Append a new function `isOverBudget(spent: number, budget: number): boolean` to the existing module `src/health.ts`.";
  const ab = b.replace(head, ah);
  for (const [s, bb] of [[V1, b], [V2, b], [V3, ab]] as const) {
    const w1: { reason?: string } = {}, w2: { reason?: string } = {};
    const x = runDeriveRule(s.trigger, s.params, objective(bb), FILES, isTest, w1);
    const y = runDeriveRule(s.trigger, s.params, objective(bb), FILES, isTest, w2, rawOf(bb.replace("Examples:", "Examples:\n- 1, 1 gives true")));
    assert.deepEqual(y, x, s.id);
    assert.deepEqual(w2, w1, s.id);
    assert.ok(x || w1.reason, s.id);
  }
});

// ---- Negatives ----
test("negative: escapeCheckinNote (backslash, | and newline escaped) is refused, never derived; replace-like functions find no fit", () => {
  const esc = (s: string) => s.replaceAll("\\", "\\\\").replaceAll("|", "\\|").replaceAll("\n", "\\n");
  const P: StrParam[] = [{ name: "note", type: "string" }];
  const ins = ["took 12s", "a|b", "x|y|z", "plain", "", "a||b"];
  const r = deriveStringProgram({ params: P, ret: "string", examples: ins.map((s) => ({ args: [s], out: esc(s) })) });
  assert.ok(!r.ok && r.reason === "derive_examples", JSON.stringify(r));
  const head = "Add a new module `src/checkin-write.ts` exporting the string parser `escapeCheckinNote(note: string): string`.";
  const lines = ['- "took 12s" gives "took 12s"', '- "a|b" gives "a\\|b"', '- "x|y|z" gives "x\\|y\\|z"', '- "plain" gives "plain"', '- "a\\\\b" gives "a\\\\\\\\b"', '- "" gives ""'];
  const b = [head, "", "Behavior: escape a note so it can sit in a check-in line.", "", "Examples:", ...lines, ""].join("\n");
  const w: { reason?: string } = {};
  assert.equal(runDeriveRule(V5.trigger, V5.params, objective(b), FILES, isTest, w, rawOf(b)), null);
  assert.ok(w.reason === "derive_examples" || w.reason === "derive_examples_raw", w.reason);
  const slash = deriveStringProgram({ params: P, ret: "string", examples: ins.map((s) => ({ args: [s], out: s.replaceAll("|", "/") })) });
  assert.ok(!slash.ok && slash.reason === "derive_no_fit", JSON.stringify(slash));
  for (const bad of ['note.replaceAll("|", "/")', 'note.replace("|", "/")', 'note.split("|").join("/")']) assert.notEqual(strExprProblem(bad, P, "string"), null, bad);
});

test("negative: side effects, regexes built from input and loops never pass the emit re-check", () => {
  const P: StrParam[] = [{ name: "line", type: "string" }, { name: "q", type: "string" }];
  assert.equal(strExprProblem('(line.split("|")[0] ?? "").trim()', P.slice(0, 1), "string"), null);
  assert.equal(strExprProblem("line.includes(q)", P, "boolean"), null);
  for (const bad of ["new RegExp(q).test(line)", "RegExp(line).test(q)", "line.match(q) !== null", "line.search(q) >= 0", "(() => { while (true) {} })()", "[...line].every((c) => c !== q)", "line.includes(q) || console.log(line)", "globalThis.line.includes(q)", 'line.includes((q = "x"))', "eval(line) === q", 'line.split("|").sort()[0] === q', "line.includes(q.repeat(1e9))", "line.padStart(1e9).includes(q)", "process.exit(1) === q"]) {
    assert.notEqual(strExprProblem(bad, P, "boolean"), null, bad);
  }
  const mod = (e: string) => `export function f(line: string, q: string): boolean {\n  return ${e};\n}\n`;
  assert.equal(derivedStringModuleProblem(mod("line.includes(q)")), null);
  assert.notEqual(derivedStringModuleProblem(mod("new RegExp(q).test(line)")), null);
  assert.notEqual(derivedStringModuleProblem(`${mod("line.includes(q)")}export const leak = 1;\n`), null);
  assert.notEqual(derivedStringModuleProblem("let n = 0;\nexport function f(line: string, q: string): boolean {\n  return line.includes(q) && n++ > 0;\n}\n"), null);
  assert.notEqual(derivedStringModuleProblem("export function f(line: string, q: string): boolean {\n  for (;;) {}\n  return line.includes(q);\n}\n"), null);
});

test("negative: signature, reserved names, examples, placement and derive_params refusals", () => {
  const parse = (head: string) => { const t = parseDeriveStringTask(objective(`${head}\n\nBehavior: a plain description of the wanted result.\n\nExamples:\n- "a" gives "a"\n- "b" gives "b"\n`)); return "reason" in t ? t.reason : "ok"; };
  assert.equal(parse("Add a new module `src/x.ts` exporting the string parser `f(line: string): string`."), "ok");
  assert.equal(parse("Add a new module `src/x.ts` exporting the string parser `f(v: string): string`."), "derive_reserved_name");
  assert.equal(parse("Add a new module `src/x.ts` exporting the string parser `v(line: string): string`."), "derive_reserved_name");
  assert.equal(parse("Add a new module `src/x.ts` exporting the string parser `f(constructor: string): string`."), "derive_signature");
  assert.notEqual(parse("Add a new module `src/x.ts` exporting the string parser `f(line: string, line: string): string`."), "ok");
  assert.notEqual(parse("Add a new module `src/x.ts` exporting the string parser `f(n: number): string`."), "ok");
  assert.notEqual(parse("Add a new module `src/x.ts` exporting the string parser `f(a: string, b: string, c: string): string`."), "ok");
  assert.notEqual(parse("Add a new module `src/x.ts` exporting the string parser `f(line: string): number[]`."), "ok");
  const P: StrParam[] = [{ name: "line", type: "string" }];
  const ex = (pairs: [string, StrOut][]): StrExample[] => pairs.map(([a, o]) => ({ args: [a], out: o }));
  for (const bad of [ex([["a", "x"], ["a", "y"], ["b", "z"]]), ex([['a"b', "x"], ["c", "y"]]), ex([["a".repeat(121), "x"], ["b", "y"]])]) assert.equal((deriveStringProgram({ params: P, ret: "string", examples: bad }) as { reason: string }).reason, "derive_examples");
  const h = SPECS[0]!;
  const taken = { ...h, fn: "isSilent" };
  assert.equal(derive(taken, appendHead("src/health.ts", taken)).why.reason, "derive_append_name_collision");
  assert.equal(derive(h, appendHead("src/missing.ts", h)).why.reason, "target_file_not_found");
  assert.equal(derive(h, addHead("src/health.ts", h)).why.reason, "derive_module_exists");
  assert.equal(derive(h, addHead("src/health.test.ts", h)).why.reason, "derive_path");
  assert.equal(derive(h, appendHead("src/health.ts", h), false, [{ path: "src/health.ts", content: `${HEALTH}let n = 0;\n` }, ...FILES.slice(1)]).why.reason, "derive_append_mutable_state");
  const b5 = objective(issue(NEW(h), rows(h)));
  for (const [t, p] of [[V5.trigger, V1.params], [V5.trigger, V3.params], [DERIVE_TRIGGER, V5.params], [DERIVE_APPEND_TRIGGER, V5.params], [V5.trigger, { ...V5.params, dsl: "typed-dsl-v1" }], [V5.trigger, { ...V5.params, placement: "new-module" }]] as const) {
    const w: { reason?: string } = {};
    assert.equal(runDeriveRule(t, p as Record<string, unknown>, b5, FILES, isTest, w), null);
    assert.equal(w.reason, "derive_params");
  }
  assert.equal(validDeriveParams({ ...V5.params, dsl: "typed-dsl-v1" } as Record<string, unknown>, "public"), false);
  assert.equal(validDeriveParams({ ...V1.params, dsl: DERIVE_STRING_DSL } as Record<string, unknown>, "public"), false);
  assert.equal(validDeriveParams({ ...V1.params, placement: DERIVE_STRING_PLACEMENT } as Record<string, unknown>, "public"), false);
});

test("Auditor #523 lessons: an unpinned default is an asked row; a test true on every example stays a rival; an unchanged-line example set is refused", () => {
  const P: StrParam[] = [{ name: "line", type: "string" }];
  const r = deriveStringProgram({ params: P, ret: "string", examples: ["scan|ok|fine", "r2| late |", "daily|error|disk full", "r2|ok"].map((s) => ({ args: [s], out: (s.split("|")[1] ?? "unknown").trim() })) });
  assert.ok(!r.ok && (r.reason === "derive_under_specified" || r.reason === "derive_ambiguous"), JSON.stringify(r));
  assert.ok(r.questions?.some((q) => !(q.at[0] as string).includes("|")), JSON.stringify(r.questions));
  const c = deriveStringProgram({ params: P, ret: "boolean", examples: ["# a", "#b", "x", "y#", "", "#"].map((s) => ({ args: [s], out: s.trim().startsWith("#") })) });
  assert.ok(!c.ok && c.reason === "derive_ambiguous", JSON.stringify(c));
  assert.ok(c.questions!.some((q) => (q.at[0] as string).startsWith(" ")), JSON.stringify(c.questions));
  // found by the near-rival test below: examples that never show the strip all return the line unchanged; the bare
  // line would fit and the strip is never a rival (its prefix is drawn from changes the examples show), so refuse
  const id = deriveStringProgram({ params: P, ret: "string", examples: ["scan|ok", "ok|part:scan", "x", "12|error"].map((s) => ({ args: [s], out: s.startsWith("part:") ? s.slice(5) : s })) });
  assert.ok(!id.ok && id.reason === "derive_under_specified" && id.gate === "outputs", JSON.stringify(id));
});

test("triggers are disjoint: no v1-v3 header matches v5 and no v5 header matches v1-v3; v1-v3 never answer a string-parser task", () => {
  const v5Heads = SPECS.flatMap((h) => [NEW(h), appendHead("src/health.ts", h)]).map((l) => objective(l).trim());
  const scalarHeads = ["Add a new module `src/budget.ts` exporting `isOverBudget(spent: number, budget: number): boolean`.", "Append a new function `tagLine(name: string, level: string): string` to the existing module `src/units.ts`.", "Add a new module `src/x.ts` exporting `partOf(line: string): string`."].map((l) => objective(l).trim());
  for (const l of v5Heads) {
    assert.ok(new RegExp(DERIVE_STRING_TRIGGER, "imu").test(l), l);
    for (const t of [DERIVE_TRIGGER, DERIVE_APPEND_TRIGGER]) assert.ok(!new RegExp(t, "imu").test(l), l);
  }
  for (const l of scalarHeads) {
    assert.ok(!new RegExp(DERIVE_STRING_TRIGGER, "imu").test(l), l);
    assert.ok([DERIVE_TRIGGER, DERIVE_APPEND_TRIGGER].some((t) => new RegExp(t, "imu").test(l)), l);
  }
  const h = SPECS[0]!;
  for (const s of [V1, V2, V3]) for (const head of [NEW(h), appendHead("src/health.ts", h)]) {
    const w: { reason?: string } = {};
    const b = issue(head, rows(h));
    assert.equal(runDeriveRule(s.trigger, s.params, objective(b), FILES, isTest, w, rawOf(b)), null, s.id);
    assert.equal(w.reason, undefined, s.id);
  }
  assert.equal(LEARNED_CANONICAL.deriveString.re.source, new RegExp(DERIVE_STRING_TRIGGER, "imu").source);
});

// ---- Seeded random tasks: a random in-vocabulary truth, random examples, asked rows answered by the truth ----
function xNode(R: () => number, d: string, q: "number" | "string" | null, strips: boolean): XNode {
  const pick = <T>(a: readonly T[]) => a[Math.floor(R() * a.length)]!;
  const r = R();
  const piece = r < 0.15 ? { k: "whole" as const } : r < 0.55 ? { k: "field" as const, d, i: q === "number" && R() < 0.4 ? ("q" as const) : Math.floor(R() * 3) } : r < 0.65 ? { k: "last" as const, d } : r < 0.8 || !strips ? { k: "rest" as const, d, i: 1 + Math.floor(R() * 2) } : { k: "strip" as const, side: pick(["prefix", "suffix"] as const), p: q === "string" && R() < 0.4 ? ("q" as const) : pick(["part:", "#", "x", "ok"]) };
  return { trim: R() < 0.3, piece, post: piece.k !== "whole" && R() < 0.4 } as XNode;
}
const STOK = ["scan", "r2", "tenmin", "ok", "error", "late", "12", "0", "-3", "45", "x", "", " ok", "ok ", "#slow", "part:scan", "7x", "daily"];
const SDELIMS = ["|", ",", ":", "/", " ", "=", ";"];
function seeded(seed: number, n: number) {
  const R = rng(seed);
  const pick = <T>(a: readonly T[]) => a[Math.floor(R() * a.length)]!;
  const line = (d: string) => Array.from({ length: 1 + Math.floor(R() * 4) }, () => pick(STOK)).join(d);
  let derived = 0, refused = 0, wrong = 0, unwitnessed = 0, checked = 0;
  const reasons: Record<string, number> = {};
  for (let k = 0; k < n; k++) {
    const d = pick(SDELIMS);
    const ret = pick(["string", "string", "number", "boolean", "boolean", "string[]"] as const);
    const q = ret !== "string[]" && R() < 0.25 ? (ret === "number" ? "number" : pick(["number", "string"] as const)) : null;
    const params: StrParam[] = [{ name: "line", type: "string" }, ...(q ? [{ name: "q", type: q }] : [])];
    let prog!: StrProgram;
    for (let g = 0; g < 50; g++) {
      if (ret === "string") prog = { op: "str", x: xNode(R, d, q, true), dflt: pick(["", "none", "unknown"]) } as StrProgram;
      else if (ret === "number") { const u = R(); prog = (u < 0.6 ? { op: "int", x: xNode(R, d, q, false), lenient: R() < 0.3, dflt: pick([0, -1, 99]) } : u < 0.8 ? { op: "count", trim: R() < 0.3, d } : { op: "len", x: xNode(R, d, q, false) }) as StrProgram; }
      else if (ret === "boolean") prog = (R() < 0.85 ? { op: "test", x: xNode(R, d, q, false), test: pick(["starts", "ends", "has", "eq"] as const), c: q === "string" && R() < 0.4 ? "q" : pick(["ok", "error", "#", "scan", "1", ""]), neg: R() < 0.3 } : { op: "isint", x: xNode(R, d, q, false), neg: R() < 0.3 }) as StrProgram;
      else prog = { op: "split", trim: R() < 0.3, d, each: R() < 0.5, drop: R() < 0.3 } as StrProgram;
      const p = prog as { op: string; x?: XNode; dflt?: string; test?: string; c?: string };
      if (p.op === "str" && (!p.x || !["field", "rest"].includes(p.x.piece.k) || (p.x.piece.k === "field" && (p.x.piece as { i: unknown }).i === 0))) p.dflt = "";
      if (p.op === "test" && p.c === "" && p.test !== "eq") p.c = "ok";
      if (!q || readsQ(prog)) break;
    }
    if (!validProgram(prog, params) || (q && !readsQ(prog))) { unwitnessed++; continue; }
    const args = (dd: string): StrArg[] => [line(dd), ...(q ? [q === "number" ? Math.floor(R() * 4) : pick(["ok", "#", "scan", "part:", "x", "error"])] : [])];
    let ex: StrArg[][] = [];
    let witnessed = false;
    for (let tries = 0; tries < 30 && !witnessed; tries++) {
      ex = Array.from({ length: 6 + Math.floor(R() * 8) }, () => args(d));
      const seen = new Set<string>();
      const outs = ex.map((a) => outKey(evalStr(prog, a, (p) => seen.add(p))));
      const need: string[] = [];
      if ("x" in prog) { const c = prog.x.piece; if ((c.k === "field" && c.i !== 0) || c.k === "rest") need.push("miss", "have"); if (c.k === "strip") need.push("strip-yes", "strip-no"); }
      if (prog.op === "int") need.push("int-ok", "int-fail");
      witnessed = need.every((p) => seen.has(p)) && (ret === "boolean" ? outs.filter((o) => o === "true").length >= 2 && outs.filter((o) => o === "false").length >= 2 : new Set(outs).size >= 2);
    }
    if (!witnessed) { unwitnessed++; continue; }
    let res = deriveStringProgram({ params, ret, examples: ex.map((a) => ({ args: a, out: evalStr(prog, a) })) });
    for (let r = 0; r < 8 && !res.ok && res.questions?.length; r++) {
      for (const qq of res.questions) ex.push(qq.at);
      res = deriveStringProgram({ params, ret, examples: ex.map((a) => ({ args: a, out: evalStr(prog, a) })) });
    }
    if (!res.ok) { refused++; const key = res.reason + ("gate" in res ? `_${res.gate}` : ""); reasons[key] = (reasons[key] ?? 0) + 1; continue; }
    derived++;
    const p = res.program;
    const fn = new Function(...params.map((x) => x.name), `return ${compileStr(p, params.map((x) => x.name))};`) as Fn;
    let bad = false;
    for (let h = 0; h < 300; h++) {
      const a = args(R() < 0.8 ? d : pick(SDELIMS));
      checked++;
      if (outKey(evalStr(p, a)) !== outKey(evalStr(prog, a)) || !same(fn(...a), evalStr(prog, a))) bad = true;
    }
    if (bad) wrong++;
  }
  return { derived, refused, wrong, unwitnessed, checked, reasons };
}

for (const seed of [112, 7, 2026]) {
  test(`seeded random string tasks (seed ${seed}, 40 tasks): 0 wrong programs`, { timeout: 600_000 }, (t) => {
    const r = seeded(seed, 40);
    t.diagnostic(`seed ${seed}: derived ${r.derived}, refused ${r.refused} ${JSON.stringify(r.reasons)}, unwitnessed ${r.unwitnessed}, wrong ${r.wrong}, held-out calls ${r.checked}`);
    assert.equal(r.wrong, 0);
    assert.ok(r.derived >= 25, `${r.derived}`);
  });
}

// ---- Auditor #523 lesson: adversarial negatives from RANDOM examples (near-rival families, not fixed rows) ----
const ADVERSARIAL: { name: string; f: (s: string) => StrOut; ret: StrRet }[] = [
  { name: "field 1 === ok (untrimmed)", ret: "boolean", f: (s) => s.split("|")[1] === "ok" },
  { name: "field 1 trimmed === ok", ret: "boolean", f: (s) => (s.split("|")[1] ?? "").trim() === "ok" },
  { name: "untrimmed startsWith #", ret: "boolean", f: (s) => s.startsWith("#") },
  { name: "field 0 startsWith part:", ret: "boolean", f: (s) => (s.split("|")[0] ?? "").startsWith("part:") },
  { name: "endsWith ok", ret: "boolean", f: (s) => s.endsWith("ok") },
  { name: "field 2 or none", ret: "string", f: (s) => s.split("|")[2] ?? "none" },
  { name: "strip prefix part:", ret: "string", f: (s) => (s.startsWith("part:") ? s.slice(5) : s) },
  { name: "int of field 1 or 0", ret: "number", f: (s) => { const v = s.split("|")[1] ?? ""; return /^-?\d{1,12}$/.test(v) ? Number(v) : 0; } },
];
const APOOL = ["ok", " ok", "ok ", "#", "# x", "part:", "part:scan", "scan", "12", "-3", "", "x", "error"];
test("Auditor #523: near-rival families on random examples (seeds 112, 7, 2026): every derived program equals the reference on 1000 random lines", { timeout: 600_000 }, (t) => {
  const P: StrParam[] = [{ name: "line", type: "string" }];
  const tally: string[] = [];
  for (const seed of [112, 7, 2026]) {
    const R = rng(seed);
    const pick = <T>(a: readonly T[]) => a[Math.floor(R() * a.length)]!;
    const line = () => { let s = Array.from({ length: Math.floor(R() * 4) }, () => pick(APOOL)).join(R() < 0.85 ? "|" : ","); if (R() < 0.2) s = ` ${s}`; return s; };
    for (const fam of ADVERSARIAL) {
      let derived = 0, refused = 0;
      for (let k = 0; k < 8; k++) {
        const ex = [...new Set(Array.from({ length: 6 + Math.floor(R() * 10) }, line))];
        let res = deriveStringProgram({ params: P, ret: fam.ret, examples: ex.map((s) => ({ args: [s], out: fam.f(s) })) });
        for (let r = 0; r < 8 && !res.ok && res.questions?.length; r++) {
          for (const q of res.questions) ex.push(q.at[0] as string);
          res = deriveStringProgram({ params: P, ret: fam.ret, examples: ex.map((s) => ({ args: [s], out: fam.f(s) })) });
        }
        if (!res.ok) { refused++; continue; }
        derived++;
        for (let h = 0; h < 1000; h++) { const s = line(); assert.equal(outKey(evalStr(res.program, [s])), outKey(fam.f(s)), `seed ${seed} ${fam.name}: ${JSON.stringify(s)} with ${compileStr(res.program, ["line"])}`); }
      }
      tally.push(`${seed} ${fam.name}: ${derived} derived, ${refused} refused`);
    }
  }
  t.diagnostic(tally.join("; "));
});

// ---- Upstream evidence ----
test("evidence: each in-vocabulary upstream function re-derives to its recorded expression with 0 wrong; out-of-vocabulary entries are recorded as such; permissive licenses only", () => {
  type EvFn = { repo: string; license: string; fn: string; params: StrParam[]; ret: StrRet; examples: StrExample[]; expr?: string; refused?: string; heldOut?: { right: number; wrong: number }; outOfVocabulary: boolean };
  const ev = JSON.parse(read("peaceai/rules/proposals/m114-derive-string-evidence.json")) as { schema: string; functions: EvFn[] };
  assert.equal(ev.schema, "peaceai-m114-derive-string-evidence:v1");
  let derived = 0, held = 0, oovWrong = 0;
  for (const f of ev.functions) {
    assert.ok(["MIT", "Apache-2.0", "ISC", "BSD-2-Clause", "BSD-3-Clause"].includes(f.license), `${f.repo}: ${f.license}`);
    const r = deriveStringProgram({ params: f.params, ret: f.ret, examples: f.examples });
    if (f.expr) {
      assert.ok(r.ok, `${f.repo} ${f.fn}: ${!r.ok && r.reason}`);
      assert.equal(compileStr(r.program, f.params.map((p) => p.name)), f.expr, f.fn);
      if (f.outOfVocabulary) { oovWrong += f.heldOut!.wrong > 0 ? 1 : 0; continue; }
      assert.equal(f.heldOut?.wrong, 0, f.fn);
      derived++; held += f.heldOut!.right;
    } else {
      assert.ok(!r.ok && `${r.reason}${"gate" in r ? `_${r.gate}` : ""}` === f.refused, f.fn);
    }
  }
  const evSummary = V5.evidence as { hunks: number; repos: string[] };
  assert.equal(derived, evSummary.hunks);
  assert.deepEqual(evSummary.repos, [...new Set(ev.functions.filter((f) => f.expr && !f.outOfVocabulary).map((f) => f.repo))].sort());
  assert.ok(derived >= 25 && held > 10_000, `${derived} ${held}`);
  // the disclosed limit: out-of-vocabulary functions can be fitted by a wrong in-vocabulary program
  assert.equal(oovWrong, 3);
});

// ---- Review note ----
const newFile = (f: { path: string; content: string }) => { const lines = f.content.replace(/\n$/, "").split("\n"); return `diff --git a/${f.path} b/${f.path}\nnew file mode 100644\nindex 0000000..1111111\n--- /dev/null\n+++ b/${f.path}\n@@ -0,0 +1,${lines.length} @@\n${lines.map((l) => `+${l}`).join("\n")}\n`; };
const appendDiff = (path: string, before: string, after: string): string => {
  const old = before.replace(/\n$/, "").split("\n"), add = after.slice(before.length).replace(/\n$/, "").split("\n");
  const ctx = old.slice(-3);
  return `diff --git a/${path} b/${path}\nindex 1111111..2222222 100644\n--- a/${path}\n+++ b/${path}\n@@ -${old.length - ctx.length + 1},${ctx.length} +${old.length - ctx.length + 1},${ctx.length + add.length} @@\n${ctx.map((l) => ` ${l}`).join("\n")}\n${add.map((l) => `+${l}`).join("\n")}\n`;
};

test("review note: rebuilt from a new-module or an append diff (probe table included); none for a tampered diff; the scalar note stays null", () => {
  const h = SPECS[5]!; // isErrorLine
  const e = derive(h, NEW(h)).e!;
  const d = newFile(e) + newFile(e.extra[0]!);
  const note = deriveStringReviewNote(d);
  assert.ok(note && note.includes(`return ${EXPR.isErrorLine};`) && note.includes('isErrorLine("'), note ?? "null");
  assert.equal(deriveReviewNote(d), null, "the scalar note does not read string parsers");
  const a = derive(h, appendHead("src/health.ts", h)).e!;
  assert.ok(deriveStringReviewNote(appendDiff(a.path, HEALTH, a.content) + newFile(a.extra[0]!)));
  assert.equal(deriveStringReviewNote(newFile({ ...e, content: e.content.replace('=== "error"', '=== "errors"') }) + newFile(e.extra[0]!)), null);
  assert.equal(deriveStringReviewNote(newFile({ ...e, content: e.content.replace(".trim()", ".trimStart()") }) + newFile(e.extra[0]!)), null);
  assert.equal(deriveStringReviewNote(d + newFile({ path: "src/other.ts", content: "export const o = 1;\n" })), null);
});

// ---- Spec v5 ----
test("spec v5: valid; the v3 spec with only id, minerVersion, trigger, two params and evidence changed; v1-v3 hashes pinned", () => {
  assert.ok(validateSpec(V5));
  assert.ok(validDeriveParams(V5.params as Record<string, unknown>, V5.minedFrom));
  const { id: _a, minerVersion: _b, trigger: _t3, params: p3, evidence: _e3, ...rest3 } = V3 as unknown as Record<string, unknown> & { params: Record<string, string> };
  const { id: _c, minerVersion: _d, trigger: t5, params: p5, evidence: _e5, ...rest5 } = V5 as unknown as Record<string, unknown> & { params: Record<string, string> };
  assert.deepEqual(rest5, rest3);
  assert.deepEqual({ ...p5, dsl: p3.dsl, placement: p3.placement }, p3);
  assert.deepEqual([p5.dsl, p5.placement], [DERIVE_STRING_DSL, DERIVE_STRING_PLACEMENT]);
  assert.equal(t5, DERIVE_STRING_TRIGGER);
  assert.equal(V5.id, "public-derive-from-behavior-v5");
  assert.equal(V5.minerVersion, "peaceai-miner:derive-from-behavior-v5");
  assert.deepEqual(DERIVE_VOCAB.dsl, ["typed-dsl-v1", "typed-dsl-v2"]);
  assert.deepEqual(DERIVE_VOCAB.placement, ["new-module", "end-of-existing-module"]);
  assert.equal(specHash(V1), "799182d79506931e78a232b5729121a339c0aa584dd008479d5aacd9869f7cc1", "v1 unchanged");
  assert.equal(specHash(V2), "e11ae193d1927c4d26efb430d862763db7f9683170a6438deb7e53d98eadff8c", "v2 unchanged");
  assert.equal(specHash(V3), "7087afcfdbe365b01816b5db0b518407733c7ce88b9d29d57392358be4bc6f8f", "v3 unchanged");
  assert.equal(SHA5, "6533548a2d2cc73fda838b3a5388f7dd59fcfc3ced3400ed83e26da7ab932d76");
  // Lesson (M85+): never assert v5 is absent from approved.json; any listed entry must pin this exact hash.
  const onMain = JSON.parse(read("peaceai/rules/approved.json")) as { rules: { id: string; sha256: string }[] };
  for (const r of onMain.rules.filter((x) => x.id === V5.id)) assert.equal(r.sha256, SHA5);
  const record = JSON.parse(read("peaceai/rules/proposals/public-derive-from-behavior-v5.json")) as { id: string; learned: string; tests: string[]; evidence: { file: string }; limits: string };
  assert.equal(record.id, V5.id);
  assert.equal(record.learned, "peaceai/rules/learned/public-derive-from-behavior-v5.json");
  for (const p of [...record.tests, record.evidence.file]) assert.ok(existsSync(join(repo, p)), p);
  assert.match(record.limits, /no in-vocabulary rival fit was missed/);
  assert.doesNotMatch(JSON.stringify(record), /on every probe/);
  assert.equal(phrasingFor(V5), DERIVE_STRING_PHRASING);
  assert.equal(phrasingFor(V3), DERIVE_APPEND_PHRASING);
  for (const s of [V1, V2]) assert.equal(phrasingFor(s), PHRASING.DERIVE_FROM_BEHAVIOR);
});

// ---- Auditor #523 lesson: Job B re-checks by the candidate's own rule id ----
test("Job B re-checks a derive module by the candidate's own rule id", () => {
  const sha = (s: RuleSpec) => `learned:${s.id}@${specHash(s)}`;
  const v5mod = 'export function partOf(line: string): string {\n  return (line.split("|")[0] ?? "").trim();\n}\n';
  const v1mod = "export function twice(n: number): number {\n  return n * 2;\n}\n";
  assert.equal(sha(V5).startsWith(DERIVE_STRING_OPERATION), true);
  assert.equal(deriveModuleRecheck(sha(V5), v5mod), null);
  for (const s of [V1, V2, V3]) {
    assert.notEqual(deriveModuleRecheck(sha(s), v5mod), null, s.id);
    assert.notEqual(deriveAppendRecheck(sha(s), HEALTH, `${HEALTH}\n${v5mod}`), null, s.id);
  }
  assert.notEqual(deriveModuleRecheck(undefined, v5mod), null);
  assert.equal(deriveAppendRecheck(sha(V5), HEALTH, `${HEALTH}\n${v5mod}`), null);
  assert.notEqual(deriveModuleRecheck(sha(V5), v1mod), null);
  for (const bad of ['(line.split("|")[0] ?? "").trimStart()', 'line.replace("|", "")', "new RegExp(line).source"]) assert.notEqual(deriveModuleRecheck(sha(V5), v5mod.replace('(line.split("|")[0] ?? "").trim()', bad)), null, bad);
});

// ---- Job A (generate.ts) and Job B (test-candidates.ts) end to end, with v5 on a temporary approved list ----
const entry = { id: V5.id, sha256: SHA5, source: "workspace", approval: { url: "https://github.com/PeaceG03/PeaceAI-Workspace/issues/41#issuecomment-123", commentId: 123, issue: 41, repo: "PeaceG03/PeaceAI-Workspace", author: "PeaceG03", approvedAt: "2026-10-26T00:00:00Z" } };
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
  test(`Job A: an approved v5 makes one ${form} candidate (literals with a space read from the raw issue) whose review note is rebuilt from its own diff`, () => {
    const dir = mkdtempSync(join(tmpdir(), "m114a-"));
    try {
      const { ws } = workspace(dir);
      const rules = join(dir, "rules");
      mkdirSync(rules);
      writeFileSync(join(rules, `${V5.id}.json`), JSON.stringify(V5));
      const list = join(dir, "approved.json");
      writeFileSync(list, JSON.stringify({ schema: APPROVED_SCHEMA, rules: [entry] }));
      const out = join(dir, "out");
      const h = SPECS[9]!; // isComment: "# note" survives only in the raw issue text
      const BODY = issue(form === "append" ? appendHead("src/health.ts", h) : NEW(h), rows(h));
      const r = spawnSync(tsx, [join(repo, "peaceai/bin/generate.ts")], {
        cwd: repo, encoding: "utf8", timeout: 300_000,
        env: { ...process.env, PEACEAI_NL_PARSE: "off", PEACEAI_KERNEL_BUNDLE: fakeKernel(dir), PEACEAI_OUT_DIR: out, PEACEAI_WORKSPACE_DIR: ws, PEACEAI_TARGET: "PeaceG03/PeaceAI-Workspace", ISSUE_NUMBER: "9", ISSUE_TITLE: TITLE, ISSUE_BODY: BODY, PEACEAI_RULES_DIR: rules, PEACEAI_APPROVED_LIST: list },
      });
      assert.equal(r.status, 0, r.stderr);
      const summary = JSON.parse(readFileSync(join(out, "summary.json"), "utf8")) as { candidates: { file: string; transformations: string[] }[] };
      assert.equal(summary.candidates.length, 1, r.stdout);
      assert.deepEqual(summary.candidates[0]!.transformations, ["LEARNED_DERIVE_FROM_BEHAVIOR"]);
      const diff = readFileSync(join(out, summary.candidates[0]!.file), "utf8");
      assert.doesNotMatch(diff, /^-(?!--)/m, "no removed line");
      if (form === "append") assert.match(diff, /^--- a\/src\/health\.ts$/m); else assert.match(diff, /^\+\+\+ b\/src\/checkin-read\.ts$/m);
      assert.match(diff, /isComment\("# note"\), true/);
      assert.match(diff, /^\+ {2}return line\.trim\(\)\.startsWith\("#"\);$/m);
      assert.ok(deriveStringReviewNote(diff), "the review note is rebuilt from Job A's own diff");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
}

function grade(dir: string, ws: string, baseSha: string, diff: string, operationId = `learned:${V5.id}@${SHA5}`) {
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

test("Job B: the v5 new module and the v5 append COUNT; a side effect, an extra statement or a v1 / v3 id is not-test-only", { skip: !CONFINED && "Node < 22: derive candidates grade not-confined", timeout: 900_000 }, () => {
  const dir = mkdtempSync(join(tmpdir(), "m114b-"));
  try {
    const { ws, baseSha } = workspace(dir);
    const h = SPECS[5]!; // isErrorLine
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
    assert.ok(n.content.includes('?? ""'), n.content);
    const loud = grade(dir, ws, baseSha, diffOf(n, n.content.replace('?? ""', "?? String(console.log(line))")));
    assert.deepEqual([loud.g.verdict, loud.g.reason], ["UNGRADABLE", "not-test-only"], loud.stdout);
    const extra = grade(dir, ws, baseSha, diffOf(a, `${a.content}\nexport const leak = 1;\n`));
    assert.deepEqual([extra.g.verdict, extra.g.reason], ["UNGRADABLE", "not-test-only"], extra.stdout);
    // Auditor #523 B2: the same v5 module and append under a v3 (or v1) operation id: re-checked as before M114
    for (const s of [V3, V1]) {
      const asOld = grade(dir, ws, baseSha, diffOf(n, n.content), `learned:${s.id}@${specHash(s)}`);
      assert.deepEqual([asOld.g.verdict, asOld.g.reason], ["UNGRADABLE", "not-test-only"], asOld.stdout);
    }
    const asV3 = grade(dir, ws, baseSha, diffOf(a, a.content), `learned:${V3.id}@${specHash(V3)}`);
    assert.deepEqual([asV3.g.verdict, asV3.g.reason], ["UNGRADABLE", "not-test-only"], asV3.stdout);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
