// M175 (batch 14) behavior cases for the general L0 edit-scope gate, as data so m175-edit-gate.test.ts runs them and
// m175-mutation.test.ts replays them against each loop.ts / looprow.ts mutant. Spec: peaceai/spec/edit-gate-m175.md.
// The gate (lib/loop.ts editScopeProblem / editClass / editSourceClass / editScopeOf) classifies every candidate edit's
// scope BEFORE any run and refuses (EDIT_SCOPE) anything wider than the pinned policy admits; it generalises the M174
// load gate (loadEditShape + LOAD_EDIT_INFRA, reused here) to every proposer and attempt. Pure cases need no candidate
// uid; the end-to-end cases (needsCand) run the whole loop on the m146 calc fixture.
// Every fixture is synthetic and unrelated to any public dev task, reference diff or forbidden idiom: a Celsius/Fahrenheit
// helper, a roman-numeral helper, a palette const, a day-of-week enum.
import assert from "node:assert/strict";
import type * as Loop from "../lib/loop.ts";
import type * as Row from "../lib/looprow.ts";
import type { LoopRow } from "../lib/looprow.ts";
import { CALC_FIXED, type Ctx } from "./m146-fixtures.ts";
import { STAGE2_CAND_ENV, stage2CandUid } from "../lib/selfpropose.ts";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { repairProposer } from "../lib/editpropose.ts";
import { e2eTask, opts as opts174, STOCK, STOCK_TEST } from "./m174-cases.ts";
import { setup as setup151, teardown as teardown151 } from "./m151-fixtures.ts";

// M175 runs ONLY as candidate uid peaceai-cand3 (M175_CAND); it never borrows another batch's candidate user.
const M175_CAND = process.env.M175_CAND ?? process.env.M146_CAND ?? "";
const m175Env = (ctx: Ctx) => ({ ...ctx.env, [STAGE2_CAND_ENV]: M175_CAND });
export const m175Cand = (): boolean => stage2CandUid({ [STAGE2_CAND_ENV]: M175_CAND }).ok;

export interface Libs { loop: typeof Loop; row: typeof Row }
export interface Case { id: string; needsCand?: boolean; run: (l: Libs, ctx: Ctx) => void }

// ---- unrelated source shapes (an in-body repair on each; none is an export / import / test / config / dangerous-token change)
const TEMP = "export function toCelsius(f: number): number {\n  return (f - 32) * 5 / 9;\n}\n";
const TEMP_FIX = "export function toCelsius(f: number): number {\n  return (f - 32) * 5 / 9 | 0;\n}\n";
const ROMAN = "const M = [\"\", \"X\", \"XX\", \"XXX\"];\nexport function tens(n: number): string {\n  return M[n % 3]!;\n}\n";
const ROMAN_FIX = "const M = [\"\", \"X\", \"XX\", \"XXX\"];\nexport function tens(n: number): string {\n  return M[n % 4]!;\n}\n";
const PAL = "function hex(n: number): string {\n  return n.toString(16);\n}\nexport const red = hex(255);\n";

const fixed = (edits: { path: string; content: string }[]): Loop.Proposer => ({ name: "fixed", next: () => ({ edits }) });
const orig = (files: Record<string, string>) => (p: string): string | null => (p in files ? files[p]! : null);
const noSkip = (_: string): boolean => false;

// a valid v4 public PASS row (edit mode), to vary for the looprow validation cases
function prow(l: Libs, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema: l.row.LOOP_SCHEMA_V4, at: "2026-11-03T00:00:00Z", set: "public", taskFileSha256: "a".repeat(64), taskKey: "0123456789abcdef",
    repo: "example/temp", commit: "b".repeat(40), workspace: "c".repeat(40), loop: l.row.LOOP_VERSION_V2, loopSha256: "d".repeat(64),
    proposer: "repair-v2", lm: "not-loadable", code: "PASS", maxAttempts: 2, attempts: 1, result: "pass",
    attemptCodes: [[]], tests: { total: 2, passedByPeaceAI: 2, filledByTeam: 0 }, runner: "vitest", deps: "npm",
    baseline: { total: 2, passing: 0, failing: 2 }, planner: "plan-only-v4", plannerSha256: "e".repeat(64), modelManifestSha256: null, ...over,
  };
}

export const CASES: Case[] = [
  // ---- 1. admit: two unrelated in-body shapes, and the M174 export-keyword shape, in edit mode
  {
    id: "admit: an in-body repair on two unrelated shapes is in-body and admitted; an export-keyword insertion is admitted (and recorded as such)",
    run(l) {
      assert.equal(l.loop.editSourceClass(TEMP, TEMP_FIX), "in-body");
      assert.equal(l.loop.editSourceClass(ROMAN, ROMAN_FIX), "in-body");
      assert.equal(l.loop.editScopeProblem([{ path: "src/temp.ts", content: TEMP_FIX }], orig({ "src/temp.ts": TEMP }), noSkip), null);
      assert.equal(l.loop.editScopeProblem([{ path: "src/roman.ts", content: ROMAN_FIX }], orig({ "src/roman.ts": ROMAN }), noSkip), null);
      assert.equal(l.loop.editScopeOf([{ path: "src/temp.ts", content: TEMP_FIX }], orig({ "src/temp.ts": TEMP })), "in-body");
      // export-keyword (M174 shape): `export ` inserted before an existing declaration
      const exported = PAL.replace("function hex", "export function hex");
      assert.equal(l.loop.editSourceClass(PAL, exported), "export-keyword"); // m175-guard:shape-export killed if this drifts
      assert.equal(l.loop.editScopeProblem([{ path: "src/pal.ts", content: exported }], orig({ "src/pal.ts": PAL }), noSkip), null);
      assert.equal(l.loop.editScopeProblem([{ path: "src/pal.ts", content: exported }], orig({ "src/pal.ts": PAL }), noSkip, "load"), null, "export-keyword is also the load-mode shape");
      assert.equal(l.loop.editScopeOf([{ path: "src/pal.ts", content: exported }], orig({ "src/pal.ts": PAL })), "export-keyword");
      // in-body wins over export-keyword when a proposal carries both (the widest recorded)
      assert.equal(l.loop.editScopeOf([{ path: "src/pal.ts", content: exported }, { path: "src/temp.ts", content: TEMP_FIX }], orig({ "src/pal.ts": PAL, "src/temp.ts": TEMP })), "in-body");
    },
  },
  // ---- 2. the top-level / token axis (each refusal with a near miss)
  {
    id: "refuse: a new top-level import (count), a changed top-level kind, an added export-from, a new dangerous token; each with an admitted near miss",
    run(l) {
      // top-level-count: a new import statement (the "import that patches expect" forge)
      assert.equal(l.loop.editSourceClass(TEMP, 'import { expect } from "vitest";\n' + TEMP), "top-level-count");
      assert.equal(l.loop.editSourceClass(TEMP, TEMP + "export const x = 1;\n"), "top-level-count");
      assert.equal(l.loop.editSourceClass(TEMP, TEMP_FIX), "in-body", "near miss: same statements, an in-body change");
      // top-level-kind: a const turned into a function (same count)
      const twoConst = "export const a = 1;\nexport function f() { return 0; }\n";
      const kindChanged = "export function a() { return 1; }\nexport function f() { return 0; }\n";
      const bodyChanged = "export const a = 2;\nexport function f() { return 0; }\n";
      assert.equal(l.loop.editSourceClass(twoConst, kindChanged), "top-level-kind");
      assert.equal(l.loop.editSourceClass(twoConst, bodyChanged), "in-body", "near miss: same kinds, an in-body change");
      // adds-import: a bare `export {}` swapped for an `export ... from` (same count, same kind)
      const bareExport = "export function f() { return 0; }\nexport {};\n";
      const reExport = "export function f() { return 0; }\nexport { x } from \"./evil.ts\";\n";
      const bareBody = "export function f() { return 1; }\nexport {};\n";
      assert.equal(l.loop.editSourceClass(bareExport, reExport), "adds-import");
      assert.equal(l.loop.editSourceClass(bareExport, bareBody), "in-body", "near miss: same export, an in-body change");
      // dangerous: a global redefine inside the body (same structure)
      const flag = "export function ready(): boolean {\n  return false;\n}\n";
      const forgeGlobal = "export function ready(): boolean {\n  (globalThis as Record<string, unknown>).expect = () => ({ toBe() {} });\n  return true;\n}\n";
      const flagFix = "export function ready(): boolean {\n  return true;\n}\n";
      assert.equal(l.loop.editSourceClass(flag, forgeGlobal), "global-write"); // (the write axis sees it first)
      const readGlobal = "export function ready(): boolean {\n  return (globalThis as Record<string, unknown>).expect !== undefined;\n}\n";
      assert.equal(l.loop.editSourceClass(flag, readGlobal), "dangerous:globalThis");
      assert.equal(l.loop.editSourceClass(flag, flagFix), "in-body", "near miss: the same fix without the global");
      // a multi-token source edit that redefines a global as a new top-level statement is refused on the count axis too
      assert.equal(l.loop.editSourceClass(flag, flagFix + "globalThis.expect = 1;\n"), "top-level-count");
    },
  },
  // ---- 2b. the vocabulary axis: an in-body edit may only add words the file already has, plus EDIT_NEW_WORDS
  {
    id: "refuse: an in-body edit that adds a word the file lacks (identifier or string), or re-adds a dangerous word the file has; near misses admitted",
    run(l) {
      // new identifier / new word in a string (the in-body forge has to name something the file never did)
      assert.equal(l.loop.editSourceClass(ROMAN, ROMAN.replace("M[n % 3]!", "M[n % 3]!.padStart(2)")), "new-word:padStart");
      assert.equal(l.loop.editSourceClass(ROMAN, ROMAN.replace("M[n % 3]!", "M[n % 3]! + \"zz\"")), "new-word:zz");
      assert.equal(l.loop.editSourceClass(ROMAN, ROMAN.replace("M[n % 3]!", "M[n % 3]! + \"XX\"")), "in-body", "near miss: a word the file already has");
      // near miss: a null-guard-shaped insertion uses only EDIT_NEW_WORDS (if, undefined, null, return, as, any)
      const guarded = TEMP.replace("{\n", "{ if (f === undefined || f === null) { return f as any; }\n");
      assert.equal(l.loop.editSourceClass(TEMP, guarded), "in-body");
      // near miss: a typeof "object" shape and a case flip use only EDIT_NEW_WORDS
      const S = "export function k(s: string): boolean {\n  return s === s;\n}\n";
      assert.equal(l.loop.editSourceClass(S, S.replace("s === s", "s === s.toLowerCase() || typeof s !== \"object\"")), "in-body");
      // a dangerous word the file already uses (so it is not new) is still refused when the edit adds another use
      const P = "// keeps the constructor\nexport function n(x: number): number {\n  return x;\n}\n";
      assert.equal(l.loop.editSourceClass(P, P.replace("return x;", "return x.constructor.length;")), "dangerous:constructor");
      assert.equal(l.loop.editSourceClass(P, P.replace("return x;", "return x + 1;")), "in-body", "near miss: no dangerous word added");
      // a new comment is inert when the candidate parses; a word that only a comment of the original has is not vocabulary
      assert.equal(l.loop.editSourceClass(P, P.replace("return x;", "return x; // any words here")), "in-body", "near miss: a comment");
      const C = "// see the padStart note\nexport function w(s: string): string {\n  return s;\n}\n";
      assert.equal(l.loop.editSourceClass(C, C.replace("return s;", "return s.padStart(2);")), "new-word:padStart");
    },
  },
  // ---- 2c. the write axis: an in-body edit may not add a write to a global / built-in (a name the file never declares)
  {
    id: "refuse: an in-body edit that adds a write rooted at an undeclared name (Object.is = ..., a call result's property); near misses: a parameter, a local, this",
    run(l) {
      const SAME = "export function same(a: number, b: number): boolean {\n  return Object.is(a, b);\n}\n";
      // every word is already in the file, so only the write axis sees it (vitest / jest toBe call Object.is)
      assert.equal(l.loop.editSourceClass(SAME, SAME.replace("  return", "  Object.is = (a: number) => a === a;\n  return")), "global-write");
      assert.equal(l.loop.editSourceClass(SAME, SAME.replace("  return", "  delete (Object as any).is;\n  return")), "global-write");
      assert.equal(l.loop.editSourceClass(SAME, SAME.replace("  return", "  a = b;\n  return")), "in-body", "near miss: a parameter write");
      const CTR = "export class Counter {\n  n = 0;\n  inc(): number {\n    const k = 1;\n    return this.n + k;\n  }\n}\n";
      assert.equal(l.loop.editSourceClass(CTR, CTR.replace("return this.n + k;", "this.n += k;\n    return this.n;")), "in-body", "near miss: a write to this");
      assert.equal(l.loop.editSourceClass(CTR, CTR.replace("return this.n + k;", "return this.n + k++;")), "in-body", "near miss: a local ++");
      assert.equal(l.loop.editSourceClass(CTR, CTR.replace("return this.n + k;", "return (this.n + k).n = k;")), "global-write", "a write rooted at an expression, not a declared name");
    },
  },
  // ---- 3. an unparsable candidate is admitted (it cannot run or patch anything; m173's broken-return case)
  {
    id: "admit: a candidate that does not parse is in-body (it fails safely at run time, it is not refused here)",
    run(l) {
      assert.equal(l.loop.editSourceClass("export function f(c) { return c; }\n", "export function f(c) {\n  return (\n}\n"), "in-body");
      // ... but the lexical checks still run on it (a runner's transform may accept what the TS parser rejects)
      assert.equal(l.loop.editSourceClass("export function f(c) { return c; }\n", "export function f(c) {\n  return (cx\n}\n"), "new-word:cx");
      assert.equal(l.loop.editSourceClass("export function f(c) { return c; }\n", "export function f(c) {\n  return (c.constructor\n}\n"), "dangerous:constructor");
      // a trailing top-level comment is trivia, not a statement: admitted (m164's near miss), when it adds no new word
      assert.equal(l.loop.editSourceClass(TEMP, TEMP + "// f\n"), "in-body");
    },
  },
  // ---- 4. the file-class axis (each refusal with its admitted source near miss)
  {
    id: "refuse: a test file, a runner config, a package / json config, a lockfile, a new source file; a source edit to the same shape is admitted",
    run(l) {
      const o = orig({ "test/helper.test.ts": TEMP, "vitest.config.ts": "export default {};\n", "data.json": "{}\n", "package-lock.json": "{}\n", "src/temp.ts": TEMP });
      assert.equal(l.loop.editClass("test/helper.test.ts", TEMP_FIX, o), "test-file"); // m175-guard:class-test
      assert.equal(l.loop.editClass("vitest.config.ts", "export default { x: 1 };\n", o), "runner-infra"); // m175-guard:class-infra
      assert.equal(l.loop.editClass("package.json", '{ "scripts": { "test": "x" } }\n', o), "config"); // m175-guard:class-source
      assert.equal(l.loop.editClass("jest.config.js", "module.exports = {};\n", o), "config");
      assert.equal(l.loop.editClass("data.json", '{ "a": 2 }\n', o), "config");
      assert.equal(l.loop.editClass("package-lock.json", '{ "x": 1 }\n', o), "lockfile"); // m175-guard:class-lockfile
      assert.equal(l.loop.editClass("src/new.ts", TEMP, o), "new-file"); // m175-guard:class-exists (does not exist at the pinned commit)
      assert.equal(l.loop.editClass("src/temp.ts", TEMP_FIX, o), "in-body", "near miss: the same change to an existing source file");
      // (batch 15) a declaration file is a generated path (codesearch isGeneratedPath), so `test-file`, refused in both modes
      for (const d of ["src/types.d.ts", "types/index.d.mts", "lib/shim.d.cts"]) {
        assert.equal(l.loop.editClass(d, "export declare const x: number;\n", orig({ [d]: "export declare const x: string;\n" })), "test-file", d);
        for (const mode of ["edit", "load"] as const) assert.equal(l.loop.editScopeProblem([{ path: d, content: "x" }], orig({ [d]: "y" }), noSkip, mode), "test-file", `${d} ${mode}`);
      }
    },
  },
  // ---- 5. the gate: owned paths are left to applyEdits; the policy refuses a class a mode does not admit
  {
    id: "gate: an outside / team path is skipped (applyEdits owns it); a non-team test path is refused; load mode admits only export-keyword",
    run(l) {
      const o = orig({ "src/temp.ts": TEMP });
      // skip-owned: a path applyEdits owns is skipped here (so EDIT_OUTSIDE_COPY / TEAM_TEST_EDIT still fire there)
      assert.equal(l.loop.editScopeProblem([{ path: "test/team.test.ts", content: "x" }], o, (p) => p === "test/team.test.ts"), null); // m175-guard:skip-owned
      // the same path when NOT owned is refused as a test file
      assert.equal(l.loop.editScopeProblem([{ path: "test/team.test.ts", content: "x" }], o, noSkip), "test-file");
      // policy: an in-body edit is admitted in edit mode, refused in load mode (load admits only export-keyword)
      assert.equal(l.loop.editScopeProblem([{ path: "src/temp.ts", content: TEMP_FIX }], o, noSkip, "edit"), null);
      assert.equal(l.loop.editScopeProblem([{ path: "src/temp.ts", content: TEMP_FIX }], o, noSkip, "load"), "in-body"); // m175-guard:policy
    },
  },
  // ---- 6. the row vocabulary (EDIT_SCOPE, the optional editScope class)
  {
    id: "row: EDIT_SCOPE is a v2/v4-only code; a PASS row may record editScope; a bad / non-PASS / load-mode editScope is rejected",
    run(l) {
      // EDIT_SCOPE is valid on a v4 refusal row (attempts 0), and v2-only
      const refused = prow(l, { code: "EDIT_SCOPE", attempts: 0, result: "refused", attemptCodes: [], tests: null, baseline: { total: 2, passing: 0, failing: 2 } });
      assert.equal(l.row.loopRowProblem(refused), null);
      assert.equal(l.row.loopRowProblem({ ...refused, schema: "peaceai-loop-row:v1" }), "schema");
      // a PASS row may carry an editScope class
      assert.equal(l.row.loopRowProblem(prow(l, { editScope: "in-body" })), null);
      assert.equal(l.row.loopRowProblem(prow(l, { editScope: "export-keyword" })), null);
      assert.equal(l.row.loopRowProblem(prow(l, { editScope: "wide-open" })), "edit_scope"); // m175-guard:row-scope-value
      // editScope only on a PASS
      assert.equal(l.row.loopRowProblem({ ...refused, editScope: "in-body" }), "edit_scope_code"); // m175-guard:row-scope-pass
      // never alongside baselineLoad (load-repair PASS rows never record it)
      assert.equal(l.row.loopRowProblem(prow(l, { editScope: "in-body", baselineLoad: "MISSING_EXPORT" })), "edit_scope_mode"); // m175-guard:row-scope-edit-mode
    },
  },
  // ---- 6b. the export-keyword shape (EDIT_EXPORT_SHAPE, Auditor): exactly one `export ` per edit, at the first token of a
  // plain top-level declaration of the parsed original. Synthetic tide-table module (nothing to do with any dev task).
  {
    id: "export shape: one insert before a plain top-level declaration is admitted; two inserts, nested, string / comment / template and non-declaration sites are refused",
    run(l) {
      const TIDE = "// tide helpers\nconst STEP = 6;\nfunction nextTide(h: number): number {\n  const later = h + STEP;\n  return later % 24;\n}\n" +
        "namespace Tides {\n  function slack(h: number): number { return h; }\n}\nclass Gauge {\n  read(): number { return 1; }\n}\n" +
        "let note = \"function inner() {}\";\nconst tpl = `\nfunction ghost() {}`;\nnextTide(0);\n";
      const at = (needle: string, k = 0): string => { const i = TIDE.indexOf(needle) + k; assert.ok(i >= k, needle); return TIDE.slice(0, i) + "export " + TIDE.slice(i); };
      const read = orig({ "src/tide.ts": TIDE });
      const load = (content: string) => l.loop.loadEditProblem([{ path: "src/tide.ts", content }], read);
      // admits (one per declaration kind used here): a function, a class, a const after the file's leading comment
      for (const [what, needle] of [["function", "function nextTide"], ["class", "class Gauge"], ["const after a comment", "const STEP"]] as const) {
        const next = at(needle);
        assert.equal(l.loop.exportInsertAt(TIDE, next), TIDE.indexOf(needle), what); // m175-guard:export-at
        assert.equal(load(next), null, `${what}: load gate admits`);
        assert.equal(l.loop.editSourceClass(TIDE, next), "export-keyword", `${what}: the general gate's class`);
      }
      for (const [what, src, next] of [["enum", "enum Dir { N, S }\n", "export enum Dir { N, S }\n"], ["interface", "interface P { x: number }\n", "export interface P { x: number }\n"], ["type", "type Q = number;\n", "export type Q = number;\n"]] as const)
        assert.equal(l.loop.exportInsertAt(src, next), 0, what);
      // near misses: each refused by the load gate and never the export-keyword class
      const two = at("function nextTide").replace("class Gauge", "export class Gauge");
      const misses: [string, string, string][] = [
        ["two inserts in one edit", two, "count"],
        ["mid-body (inside a function body)", at("const later"), "kind"],
        ["inside a namespace", at("function slack"), "kind"],
        ["inside a class body", at("read()"), "kind"],
        ["inside a string", at("function inner"), "kind"],
        ["inside a template", at("function ghost"), "kind"],
        ["inside a comment", at("tide helpers"), "kind"],
        ["before the leading comment, not the declaration's first token", "export " + TIDE, "kind"],
        ["before a non-declaration statement", at("nextTide(0);"), "export-kind"], // m175-guard:export-kind
      ];
      for (const [what, next] of misses) {
        assert.equal(l.loop.loadEditShape(TIDE, next), false, what);
        assert.equal(load(next), "shape", `${what}: load gate refuses`);
        assert.notEqual(l.loop.editSourceClass(TIDE, next), "export-keyword", `${what}: never the export-keyword class`);
        assert.notEqual(l.loop.editScopeProblem([{ path: "src/tide.ts", content: next }], read, noSkip, "load"), null, `${what}: load-mode policy refuses`);
      }
      // the declaration itself must be plain (one guard each)
      assert.equal(l.loop.exportInsertAt("export function f() {}\n", "export export function f() {}\n"), null, "already exported"); // m175-guard:export-plain
      assert.equal(l.loop.exportInsertAt("declare function d(): void;\n", "export declare function d(): void;\n"), null, "declare");
      assert.equal(l.loop.exportInsertAt("function over(a: number): number;\nfunction over(a: any): any { return a; }\n", "export function over(a: number): number;\nfunction over(a: any): any { return a; }\n"), null, "an overload signature"); // m175-guard:export-body
      assert.equal(l.loop.exportInsertAt("let p = 1, q = 2;\n", "export let p = 1, q = 2;\n"), null, "two declarators"); // m175-guard:export-single
      assert.equal(l.loop.exportInsertAt("let p = 1;\n", "export let p = 1;\n"), 0, "near miss: one declarator");
      assert.equal(l.loop.exportInsertAt("function ok() { return 1; }\nconst = ;\n", "export function ok() { return 1; }\nconst = ;\n"), null, "an original that does not parse"); // m175-guard:export-parse
      assert.equal(l.loop.exportInsertAt("function ok() { return 1; }\nconst z = 1;\n", "export function ok() { return 1; }\nconst z = 1;\n"), 0, "near miss: it parses");
      // (batch 15) a decorated class: `export ` before its decorator (or after it) is refused in both modes, never in-body;
      // the same class without the decorator is admitted
      const DECO = "function tag(c: unknown) { return c; }\n@tag\nclass Gauge {}\n";
      for (const [what, next] of [["export before the decorator", DECO.replace("@tag", "export @tag")], ["export after the decorator", DECO.replace("class Gauge", "export class Gauge")]] as const) {
        assert.equal(l.loop.exportInsertAt(DECO, next), null, what); // m175-guard:export-decorator
        assert.equal(l.loop.editSourceClass(DECO, next), "export-decorated", what); // m175-guard:export-decorated
        assert.equal(l.loop.editScopeProblem([{ path: "src/gauge.ts", content: next }], orig({ "src/gauge.ts": DECO }), noSkip, "edit"), "export-decorated", `${what}: edit mode`);
        assert.equal(l.loop.editScopeProblem([{ path: "src/gauge.ts", content: next }], orig({ "src/gauge.ts": DECO }), noSkip, "load"), "export-decorated", `${what}: load mode`);
      }
      const PLAIN = "function tag(c: unknown) { return c; }\nclass Gauge {}\n";
      assert.equal(l.loop.exportInsertAt(PLAIN, PLAIN.replace("class Gauge", "export class Gauge")), PLAIN.indexOf("class Gauge"), "near miss: no decorator");
      // a decorated class that was already exported, with an in-body edit elsewhere, is not refused by export-decorated
      const DONE = "function tag(c: unknown) { return c; }\n@tag\nexport class Gauge { v = 1; }\n";
      assert.equal(l.loop.editSourceClass(DONE, DONE.replace("v = 1", "v = 2")), "in-body", "near miss: an export the original already had");
      // pinned in the one policy table
      assert.equal(l.loop.EDIT_EXPORT_SHAPE.inserts, 1);
    },
  },
  // ---- 6c. the diagnostics compile bounds (LOAD_DIAG_CAPS, Auditor): file count, bytes and wall time; over -> LoadDiagLimit
  {
    id: "compile caps: at each cap the diagnostics are read; one file, one byte or one ms over refuses (LoadDiagLimit); the row code LOAD_DIAG_LIMIT validates only as a v4 refusal",
    run(l) {
      const dir = mkdtempSync(join(tmpdir(), "peaceai-m175-caps-"));
      try {
        const files: Record<string, string> = { "src/meter.ts": "const toMeters = (ft: number): number => ft * 0.3048;\nexport const unit = \"m\";\n", "test/meter.test.ts": 'import { toMeters } from "../src/meter.ts";\ntoMeters(1);\n' };
        for (const [p, c] of Object.entries(files)) { mkdirSync(dirname(join(dir, p)), { recursive: true }); writeFileSync(join(dir, p), c); }
        const bytes = Object.values(files).reduce((n, c) => n + Buffer.byteLength(c, "utf8"), 0);
        const run = (caps: Partial<Loop.LoadDiagCaps>) => l.loop.loadDiagnostics(dir, ["test/meter.test.ts"], undefined, { ...l.loop.LOAD_DIAG_CAPS, ...caps });
        const limit = (what: string) => (e: unknown) => e instanceof l.loop.LoadDiagLimit && e.message === what;
        const want = [{ kind: "MISSING_EXPORT", test: "test/meter.test.ts", module: "src/meter.ts", name: "toMeters", spec: "../src/meter.ts" }];
        assert.deepEqual(run({}), want, "the default caps admit a small suite");
        assert.deepEqual(run({ files: 2 }), want, "near miss: exactly the file cap");
        assert.throws(() => run({ files: 1 }), limit("files"), "one file over"); // m175-guard:limit-files
        assert.deepEqual(run({ bytes }), want, "near miss: exactly the byte cap");
        assert.throws(() => run({ bytes: bytes - 1 }), limit("bytes"), "one byte over"); // m175-guard:limit-bytes
        let calls = 0;
        const clock = () => (calls++ === 0 ? 0 : 1000); // the compile "takes" 1000 ms
        assert.deepEqual(run({ ms: 1000, clock }), want, "near miss: exactly the wall-time cap");
        calls = 0;
        assert.throws(() => run({ ms: 999, clock }), limit("ms"), "one ms over"); // m175-guard:limit-ms
        assert.ok(Object.isFrozen(l.loop.LOAD_DIAG_CAPS));
      } finally { rmSync(dir, { recursive: true, force: true }); }
      // the row: a v4 refusal before any attempt, with its baseline on a public row
      const lim = prow(l, { code: "LOAD_DIAG_LIMIT", attempts: 0, result: "refused", attemptCodes: [], tests: null });
      assert.equal(l.row.loopRowProblem(lim), null, "a v4 LOAD_DIAG_LIMIT refusal validates");
      const v3: Record<string, unknown> = { ...lim, schema: l.row.LOOP_SCHEMA_V3 }; delete v3.modelManifestSha256;
      assert.equal(l.row.loopRowProblem(v3), "code", "v4 only"); // m175-guard:row-limit-v4
      assert.equal(l.row.loopRowProblem({ ...lim, attempts: 1, attemptCodes: [["TEST_FAIL"]], tests: { total: 2, passedByPeaceAI: 0, filledByTeam: 2 } }), "load_limit_attempts", "no attempt ran"); // m175-guard:row-limit-attempts
      assert.equal(l.row.loopRowProblem({ ...lim, baseline: null }), "baseline_presence", "a public row keeps its baseline"); // m175-guard:row-limit-baseline
    },
  },
  {
    id: "loop compile caps: a load-repair task whose diagnostics compile is over a cap refuses LOAD_DIAG_LIMIT before any attempt; exactly at the cap it goes on and passes",
    needsCand: true,
    run(l) {
      const m151 = setup151();
      const scratch = mkdtempSync(join(tmpdir(), "peaceai-m175-lim-"));
      try {
        const ctx = { m151, scratch };
        const go = (files: number) => l.loop.runLoopTask(e2eTask(ctx, `lim${files}-${Date.now() % 100000}`, { "src/stock.ts": STOCK }, STOCK_TEST) as never, "public", "a".repeat(64),
          { ...opts174(ctx, repairProposer({ v2: true }) as unknown as Loop.Proposer, 2), env: { ...m151.env, [STAGE2_CAND_ENV]: M175_CAND }, loadCaps: { ...l.loop.LOAD_DIAG_CAPS, files } } as never);
        const over = go(1);
        assert.equal(l.row.loopRowProblem(over.row), null, `row valid (${l.row.loopRowProblem(over.row)})`);
        if (!m175Cand()) { assert.match(over.row.code, /^CAND_UID_/); return; }
        assert.equal(over.row.code, "LOAD_DIAG_LIMIT", "one file over the cap: refused fail-closed"); // m175-guard:loop-load-limit
        assert.equal(over.row.attempts, 0);
        assert.equal(over.row.result, "refused");
        const at = go(2);
        assert.equal(at.row.code, "PASS", "near miss: exactly at the cap");
        assert.equal(at.row.baselineLoad, "MISSING_EXPORT");
      } finally { teardown151(m151); rmSync(scratch, { recursive: true, force: true }); }
    },
  },
  // ---- 7. end to end (candidate uid): the loop records the scope of a PASS, and refuses every forge before any run
  {
    id: "loop admit: a known-correct in-body edit passes and the row records editScope in-body",
    needsCand: true,
    run(l, ctx) {
      const r = l.loop.runLoopTask(ctx.calc, "public", "a".repeat(64), { root: ctx.root, fetcher: ctx.fetcher, proposer: fixed([{ path: "src/calc.ts", content: CALC_FIXED }]), maxAttempts: 2, runMs: 60_000, env: m175Env(ctx), rules: [], training: new Set<string>() } as never);
      assert.equal(l.row.loopRowProblem(r.row), null, `row valid (${l.row.loopRowProblem(r.row)})`);
      if (!m175Cand()) { assert.match(r.row.code, /^CAND_UID_/); return; }
      assert.equal(r.row.code, "PASS");
      assert.equal((r.row as LoopRow).editScope, "in-body"); // m175-guard:loop-row-scope
    },
  },
  {
    id: "loop forge: an added import, a non-team test edit, a config edit and a global-redefine source edit are each refused EDIT_SCOPE before any run",
    needsCand: true,
    run(l, ctx) {
      const forgeEdits: Record<string, { path: string; content: string }> = {
        "added import": { path: "src/calc.ts", content: 'import { expect } from "vitest";\n' + CALC_FIXED },
        "a non-team test file": { path: "test/forge.test.ts", content: "import test from \"node:test\";\ntest(\"x\", () => {});\n" },
        "a config file": { path: "package.json", content: '{ "name": "fixture", "private": true, "type": "module", "scripts": { "test": "node --test", "x": "y" } }\n' },
        "a global redefine": { path: "src/calc.ts", content: CALC_FIXED + "(globalThis as Record<string, unknown>).expect = () => ({ toBe() {} });\n" },
      };
      for (const [what, edit] of Object.entries(forgeEdits)) {
        const r = l.loop.runLoopTask(ctx.calc, "public", "a".repeat(64), { root: ctx.root, fetcher: ctx.fetcher, proposer: fixed([edit]), maxAttempts: 2, runMs: 60_000, env: m175Env(ctx), rules: [], training: new Set<string>() } as never);
        assert.equal(l.row.loopRowProblem(r.row), null, `${what}: row valid (${l.row.loopRowProblem(r.row)})`);
        if (!m175Cand()) { assert.match(r.row.code, /^CAND_UID_/); continue; }
        assert.equal(r.row.code, "EDIT_SCOPE", `${what}: refused before any run`); // m175-guard:scope-gate
        assert.equal(r.row.attempts, 0, `${what}: nothing ran`);
        assert.equal(r.row.result, "refused");
      }
    },
  },
];
