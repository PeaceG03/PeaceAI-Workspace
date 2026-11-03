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

// M175 runs ONLY as candidate uid peaceai-cand3 (M175_CAND); it never borrows another batch's candidate user.
const M175_CAND = process.env.M175_CAND ?? process.env.M146_CAND ?? "peaceai-cand";
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
