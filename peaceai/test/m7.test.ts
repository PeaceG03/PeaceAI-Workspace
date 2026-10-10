// M7: the test-and-fix loop. Parser and sorter, every repair rule, the budget and stop conditions, the
// Job B harness end to end (sandbox-free mode), the Job B2 re-gate and the Results record.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import {
  editDistance,
  errorFingerprint,
  parseTapFailures,
  parseTscOutput,
  planRepairs,
  repairFor,
  RULES,
  sortErrors,
  type RepairContext,
  type RepairError,
} from "../lib/repair.ts";
import { runRepairLoop, type Evaluation, type LoopIO } from "../lib/repairloop.ts";
import { validateRepairRecord } from "../lib/repairrecord.ts";
import { WORKSPACE_SCOPE } from "../lib/scope.ts";
import { taskDir } from "../lib/store.ts";
import { buildIndex } from "../lib/symbols.ts";

import { b2Fixture, harnessFixture, PROFILE, PROFILE_TEST, repo, runB2, runJobB, sha, THEME, TSCONFIG, tsx } from "./m7-fixtures.ts";

const tscBin = join(repo, "node_modules/.bin/tsc");

/** In-memory repair context over a file map; `base` marks files present at the base commit. */
function ctxOf(files: Record<string, string>, base: Record<string, string> = files): RepairContext {
  return {
    index: buildIndex(Object.entries(files).map(([path, content]) => ({ path, content }))),
    read: (p) => files[p] ?? null,
    base: (p) => base[p] ?? null,
    isSource: WORKSPACE_SCOPE.isSource,
    isTest: WORKSPACE_SCOPE.isTest,
  };
}
const err = (e: Partial<RepairError> & Pick<RepairError, "code" | "file" | "line" | "col" | "message">): RepairError =>
  parseTscOutput(`${e.file}(${e.line},${e.col}): error ${e.code}: ${e.message}`, "")[0] ?? (e as RepairError);

// ---- parser and sorter

test("tsc parser: codes, positions, repo-relative paths, classification; continuation lines ignored", () => {
  const root = "/tmp/peaceai-test-x";
  const out = [
    `${root}/src/b.ts(3,5): error TS2304: Cannot find name 'clamp'.`,
    `src/a.ts(10,2): error TS2551: Property 'nmae' does not exist on type 'Profile'. Did you mean 'name'?`,
    `  The declaration was here.`,
    `src/a.ts(4,14): error TS2741: Property 'accent' is missing in type '{ name: string; }' but required in type 'Theme'.`,
    `src/c.ts(1,10): error TS2724: '"./theme"' has no exported member named 'DEFAULT_THEM'. Did you mean 'DEFAULT_THEME'?`,
    `src/c.ts(2,3): error TS2353: Object literal may only specify known properties, and 'accent' does not exist in type 'Theme'.`,
    `src/c.ts(5,9): error TS2322: Type '"critical"' is not assignable to type 'Severity'.`,
    `src/d.ts(7,1): error TS2552: Cannot find name 'themLabel'. Did you mean 'themeLabel'?`,
    `/etc/passwd(1,1): error TS1005: ';' expected.`,
    `garbage line`,
  ].join("\n");
  const errors = parseTscOutput(out, root);
  assert.equal(errors.length, 8);
  assert.deepEqual(errors.map((e) => [e.code, e.file, e.kind]), [
    ["TS2304", "src/b.ts", "unknown-identifier"],
    ["TS2551", "src/a.ts", "misspelled-property"],
    ["TS2741", "src/a.ts", "missing-property"],
    ["TS2724", "src/c.ts", "missing-export"],
    ["TS2353", "src/c.ts", "unknown-property"],
    ["TS2322", "src/c.ts", "type-mismatch"],
    ["TS2552", "src/d.ts", "unknown-identifier"],
    ["TS1005", "", "other"], // outside the tree: no path
  ]);
  assert.equal(errors[0]!.name, "clamp");
  assert.deepEqual([errors[1]!.name, errors[1]!.suggestion], ["nmae", "name"]);
  assert.deepEqual([errors[2]!.name, errors[2]!.typeName], ["accent", "Theme"]);
  assert.deepEqual([errors[5]!.literal, errors[5]!.typeName], ['"critical"', "Severity"]);
  assert.deepEqual([errors[6]!.name, errors[6]!.suggestion], ["themLabel", "themeLabel"]);
  assert.equal(errors[0]!.line, 3);
  assert.equal(errors[0]!.col, 5);
});

test("TAP parser: expected vs actual for scalar assertions, leaf failures only, frame inside the tree", () => {
  const root = "/tmp/peaceai-test-y";
  const tap = [
    "TAP version 13",
    "# Subtest: suite",
    "    not ok 1 - RETRIES is 4",
    "      ---",
    `      location: '${root}/src/x.test.ts:5:1'`,
    "      failureType: 'testCodeFailure'",
    "      error: |-",
    "        Expected values to be strictly equal:",
    "        3 !== 4",
    "      code: 'ERR_ASSERTION'",
    "      expected: 4",
    "      actual: 3",
    "      operator: 'strictEqual'",
    "      stack: |-",
    `        TestContext.<anonymous> (file://${root}/src/x.test.ts:6:10)`,
    "        Test.runInAsyncScope (node:async_hooks:206:9)",
    "      ...",
    "not ok 1 - suite",
    "  ---",
    "  failureType: 'subtestsFailed'",
    "  ...",
    "not ok 2 - label is plain",
    "  ---",
    `  location: '${root}/src/y.test.ts:3:1'`,
    "  expected: 'plain'",
    "  actual: 'fancy'",
    "  operator: 'strictEqual'",
    "  ...",
    "not ok 3 - throws",
    "  ---",
    `  location: '${root}/src/y.test.ts:9:1'`,
    "  error: 'boom'",
    "  ...",
    "not ok 4 - object compare",
    "  ---",
    `  location: '${root}/src/y.test.ts:12:1'`,
    "  expected:",
    "    a: 1",
    "  actual:",
    "    a: 2",
    "  operator: 'deepStrictEqual'",
    "  ...",
  ].join("\n");
  const errors = parseTapFailures(tap, root);
  assert.deepEqual(errors.map((e) => [e.kind, e.code, e.file, e.line]), [
    ["assertion", "ASSERT_strictEqual", "src/x.test.ts", 6],
    ["assertion", "ASSERT_strictEqual", "src/y.test.ts", 3],
    ["test-failure", "TEST_FAIL", "src/y.test.ts", 9],
    ["test-failure", "TEST_FAIL", "src/y.test.ts", 12], // non-scalar: no expected/actual pair
  ]);
  assert.deepEqual([errors[0]!.expected, errors[0]!.actual], ["4", "3"]);
  assert.deepEqual([errors[1]!.expected, errors[1]!.actual], ["'plain'", "'fancy'"]);
});

test("sorter is deterministic (tsc first, then kind/file/line), drops duplicates; fingerprint ignores positions", () => {
  const a = err({ code: "TS2304", file: "src/b.ts", line: 3, col: 5, message: "Cannot find name 'x'." });
  const b = err({ code: "TS2741", file: "src/a.ts", line: 4, col: 1, message: "Property 'p' is missing in type '{}' but required in type 'T'." });
  const c = err({ code: "TS2304", file: "src/a.ts", line: 9, col: 1, message: "Cannot find name 'y'." });
  const t: RepairError = { source: "test", kind: "assertion", code: "ASSERT_equal", file: "src/a.test.ts", line: 1, col: 1, message: "t" };
  const orders = [[a, b, c, t], [t, c, b, a], [b, t, a, c, a]];
  const sorted = orders.map((o) => sortErrors(o).map((e) => `${e.code}@${e.file}:${e.line}`));
  for (const s of sorted) assert.deepEqual(s, sorted[0]);
  assert.deepEqual(sorted[0], ["TS2304@src/a.ts:9", "TS2304@src/b.ts:3", "TS2741@src/a.ts:4", "ASSERT_equal@src/a.test.ts:1"]);
  assert.equal(errorFingerprint([a, b]), errorFingerprint([{ ...b, line: 40, col: 7 }, { ...a, line: 1 }]));
  assert.notEqual(errorFingerprint([a, b]), errorFingerprint([a]));
});

// ---- the rules, one by one

test("ADD_MISSING_IMPORT: from the index (value and type-only), following the file's import style; refuses ambiguity", () => {
  const files = {
    "src/util.ts": "export function clamp(n: number): number {\n  return Math.max(0, n);\n}\nexport type Size = number;\n",
    "src/app.ts": 'import { other } from "./other";\n\nexport const v: Size = clamp(5);\n',
    "src/other.ts": "export const other = 1;\n",
  };
  const ctx = ctxOf(files);
  const e1 = err({ code: "TS2304", file: "src/app.ts", line: 3, col: 24, message: "Cannot find name 'clamp'." });
  const fix1 = repairFor(e1, ctx)!;
  assert.equal(fix1.rule, "ADD_MISSING_IMPORT");
  assert.match(fix1.content, /^import \{ other \} from "\.\/other";\nimport \{ clamp \} from "\.\/util";\n/);
  const e2 = err({ code: "TS2304", file: "src/app.ts", line: 3, col: 17, message: "Cannot find name 'Size'." });
  assert.match(repairFor(e2, ctx)!.content, /import type \{ Size \} from "\.\/util";/);
  // Two exported definitions of the same name: no guess.
  const amb = ctxOf({ ...files, "src/util2.ts": "export function clamp(n: number): number {\n  return n;\n}\n" });
  assert.equal(repairFor(e1, amb), null);
  // Wrong position (the text there is not that name): refuse.
  assert.equal(repairFor({ ...e1, col: 1 }, ctx), null);
});

test("FIX_NAME_TYPO / FIX_PROPERTY_TYPO / FIX_IMPORT_NAME_TYPO rename exactly the token tsc points at", () => {
  const files = {
    "src/theme.ts": "export const DEFAULT_THEME = { name: \"plain\" };\nexport function themeLabel(t: { name: string }): string {\n  return t.name;\n}\n",
    "src/use.ts": 'import { DEFAULT_THEM, themeLabel } from "./theme";\n\nexport const a = themLabel(DEFAULT_THEM);\nexport const b = DEFAULT_THEM.nmae;\n',
  };
  const ctx = ctxOf(files);
  const name = repairFor(err({ code: "TS2552", file: "src/use.ts", line: 3, col: 18, message: "Cannot find name 'themLabel'. Did you mean 'themeLabel'?" }), ctx)!;
  assert.equal(name.rule, "FIX_NAME_TYPO");
  assert.match(name.content, /export const a = themeLabel\(DEFAULT_THEM\);/);
  const prop = repairFor(err({ code: "TS2551", file: "src/use.ts", line: 4, col: 31, message: "Property 'nmae' does not exist on type '{ name: string; }'. Did you mean 'name'?" }), ctx)!;
  assert.equal(prop.rule, "FIX_PROPERTY_TYPO");
  assert.match(prop.content, /DEFAULT_THEM\.name;/);
  const imp = repairFor(err({ code: "TS2724", file: "src/use.ts", line: 1, col: 10, message: "'\"./theme\"' has no exported member named 'DEFAULT_THEM'. Did you mean 'DEFAULT_THEME'?" }), ctx)!;
  assert.equal(imp.rule, "FIX_IMPORT_NAME_TYPO");
  assert.match(imp.content, /^import \{ DEFAULT_THEME, themeLabel \}/);
});

test("ADD_MISSING_REQUIRED_PROPERTY: a typed literal gets the field with its type's default; optional/complex types refuse", () => {
  const files = {
    "src/theme.ts": [
      "export type Theme = {",
      "  readonly name: string;",
      "  readonly accent: string;",
      "  readonly size: number;",
      "  readonly tone: \"warm\" | \"cool\";",
      "  readonly meta: { a: number };",
      "};",
      "",
      "export const DEFAULT_THEME: Theme = {",
      '  name: "plain",',
      "};",
      "",
    ].join("\n"),
  };
  const ctx = ctxOf(files);
  const mk = (p: string) => err({ code: "TS2741", file: "src/theme.ts", line: 9, col: 14, message: `Property '${p}' is missing in type '{ name: string; }' but required in type 'Theme'.` });
  const fix = repairFor(mk("accent"), ctx)!;
  assert.equal(fix.rule, "ADD_MISSING_REQUIRED_PROPERTY");
  assert.match(fix.content, /name: "plain",\n {2}accent: "",\n\};/);
  assert.match(repairFor(mk("size"), ctx)!.content, /size: 0,/);
  assert.match(repairFor(mk("tone"), ctx)!.content, /tone: "warm",/);
  assert.equal(repairFor(mk("meta"), ctx), null);
  // Inside a test file (new or existing) this rule never runs: tests keep their own literals.
  const t = ctxOf({ ...files, "src/theme.extra.test.ts": 'import type { Theme } from "./theme";\nconst t: Theme = { name: "x" };\n' }, files);
  assert.equal(repairFor(err({ code: "TS2741", file: "src/theme.extra.test.ts", line: 2, col: 7, message: "Property 'accent' is missing in type '{ name: string; }' but required in type 'Theme'." }), t), null);
});

test("ADD_FIELD_TO_TYPE: an unknown literal property becomes an optional field (style kept); ADD_UNION_LITERAL widens a literal union", () => {
  const files = {
    "src/theme.ts": "export type Theme = {\n  readonly name: string;\n};\nexport type Severity = \"low\" | \"high\";\n",
    "src/use.ts": 'import type { Severity, Theme } from "./theme";\n\nexport const t: Theme = { name: "a", accent: "red" };\nexport const s: Severity = "critical";\n',
  };
  const ctx = ctxOf(files);
  const f = repairFor(err({ code: "TS2353", file: "src/use.ts", line: 3, col: 38, message: "Object literal may only specify known properties, and 'accent' does not exist in type 'Theme'." }), ctx)!;
  assert.equal(f.rule, "ADD_FIELD_TO_TYPE");
  assert.equal(f.path, "src/theme.ts");
  assert.match(f.content, /readonly name: string;\n {2}readonly accent\?: string;\n\};/);
  const u = repairFor(err({ code: "TS2322", file: "src/use.ts", line: 4, col: 14, message: "Type '\"critical\"' is not assignable to type 'Severity'." }), ctx)!;
  assert.equal(u.rule, "ADD_UNION_LITERAL");
  assert.match(u.content, /export type Severity = "low" \| "high" \| "critical";/);
  // A number literal into a string union: no.
  assert.equal(repairFor(err({ code: "TS2322", file: "src/use.ts", line: 4, col: 14, message: "Type '7' is not assignable to type 'Severity'." }), ctx), null);
});

test("ALIGN_ADDED_CONSTANT: only a constant the candidate added, only to the literal the failing assertion expects", () => {
  const base = { "src/limits.ts": "export const MAX = 10;\n" };
  const files = {
    "src/limits.ts": "export const MAX = 10;\nexport const RETRIES = 3;\n",
    "src/limits.RETRIES.test.ts": 'import assert from "node:assert/strict";\nimport test from "node:test";\nimport { MAX, RETRIES } from "./limits";\ntest("r", () => {\n  assert.equal(RETRIES, 4);\n  assert.equal(MAX, 11);\n});\n',
  };
  const ctx = ctxOf(files, base);
  const a: RepairError = { source: "test", kind: "assertion", code: "ASSERT_strictEqual", file: "src/limits.RETRIES.test.ts", line: 5, col: 10, message: "r", expected: "4", actual: "3" };
  const fix = repairFor(a, ctx)!;
  assert.equal(fix.rule, "ALIGN_ADDED_CONSTANT");
  assert.match(fix.content, /export const RETRIES = 4;/);
  assert.match(fix.content, /export const MAX = 10;/);
  // MAX existed at the base: never changed to satisfy a test.
  assert.equal(repairFor({ ...a, line: 6, expected: "11", actual: "10" }, ctx), null);
  // The runner's expected value must be the literal written in the test.
  assert.equal(repairFor({ ...a, expected: "5" }, ctx), null);
});

test("planRepairs: existing tests are never edited; at most one edit per file per round; every rule is listed", () => {
  const files = {
    "src/theme.ts": "export type Theme = {\n  readonly name: string;\n  readonly accent: string;\n};\nexport const T: Theme = {\n  name: \"a\",\n};\nexport const U: Theme = {\n  name: \"b\",\n};\n",
    "src/theme.test.ts": 'import { clampX } from "./nowhere";\nexport const v = clamp(1);\n',
    "src/util.ts": "export function clamp(n: number): number {\n  return n;\n}\n",
  };
  const ctx = ctxOf(files);
  const errors = [
    err({ code: "TS2741", file: "src/theme.ts", line: 8, col: 14, message: "Property 'accent' is missing in type '{ name: string; }' but required in type 'Theme'." }),
    err({ code: "TS2741", file: "src/theme.ts", line: 5, col: 14, message: "Property 'accent' is missing in type '{ name: string; }' but required in type 'Theme'." }),
    err({ code: "TS2304", file: "src/theme.test.ts", line: 2, col: 18, message: "Cannot find name 'clamp'." }),
  ];
  const edits = planRepairs(errors, ctx);
  assert.deepEqual(edits.map((e) => [e.rule, e.path, e.line]), [["ADD_MISSING_REQUIRED_PROPERTY", "src/theme.ts", 5]]);
  assert.equal(RULES.length, 8);
});

test("FIX_PROPERTY_TYPO without a compiler suggestion: the single closest member of the indexed type; ties refuse", () => {
  const files = {
    "src/t.ts": "export type Theme = {\n  readonly name: string;\n  readonly accent: string;\n  readonly ascent: string;\n};\n",
    "src/u.ts": 'import type { Theme } from "./t";\nexport const f = (t: Theme) => t.nmae;\nexport const g = (t: Theme) => t.acent;\n',
  };
  const ctx = ctxOf(files);
  const fix = repairFor(err({ code: "TS2339", file: "src/u.ts", line: 2, col: 34, message: "Property 'nmae' does not exist on type 'Theme'." }), ctx)!;
  assert.equal(fix.rule, "FIX_PROPERTY_TYPO");
  assert.match(fix.content, /t\.name;/);
  // "acent" is one edit from both accent and ascent: no guess.
  assert.equal(repairFor(err({ code: "TS2339", file: "src/u.ts", line: 3, col: 34, message: "Property 'acent' does not exist on type 'Theme'." }), ctx), null);
  assert.equal(editDistance("nmae", "name"), 1);
  assert.equal(editDistance("acent", "accent"), 1);
});

// ---- loop: budget and stop conditions

function fakeIO(evals: Evaluation[], opts: { refuse?: boolean; clock?: number[] } = {}): LoopIO & { applied: string[] } {
  let i = 0;
  let t = 0;
  const applied: string[] = [];
  const files = {
    "src/theme.ts": "export type Theme = {\n  readonly name: string;\n  readonly accent: string;\n};\nexport const T: Theme = {\n  name: \"a\",\n};\n",
  };
  return {
    applied,
    evaluate: () => evals[Math.min(i++, evals.length - 1)]!,
    context: () => ctxOf(files),
    apply: (e) => {
      applied.push(e.rule);
      return !opts.refuse;
    },
    now: () => (opts.clock ? opts.clock[Math.min(t++, opts.clock.length - 1)]! : 0),
  };
}
const RED_FIXABLE: Evaluation = {
  typecheck: false, originalSuite: false, newTests: false,
  errors: [err({ code: "TS2741", file: "src/theme.ts", line: 5, col: 14, message: "Property 'accent' is missing in type '{ name: string; }' but required in type 'Theme'." })],
};
const GREEN: Evaluation = { typecheck: true, originalSuite: true, newTests: true, errors: [] };
const RED_OTHER = (n: number): Evaluation => ({ ...RED_FIXABLE, errors: [{ ...RED_FIXABLE.errors[0]!, message: `${RED_FIXABLE.errors[0]!.message} #${n}` }] });
const UNFIXABLE: Evaluation = { typecheck: false, originalSuite: false, newTests: false, errors: [err({ code: "TS1005", file: "src/theme.ts", line: 1, col: 1, message: "';' expected." })] };

test("loop stops: NOT_NEEDED, GREEN, NO_RULE, NO_PROGRESS, BUDGET_ITERATIONS, BUDGET_TIME, EDIT_REFUSED", () => {
  assert.equal(runRepairLoop(fakeIO([GREEN])).stop, "NOT_NEEDED");
  const green = runRepairLoop(fakeIO([RED_FIXABLE, GREEN]));
  assert.deepEqual([green.stop, green.rounds, green.changed], ["GREEN", 1, true]);
  assert.deepEqual(green.iterations.map((it) => [it.round, it.errorCount, it.applied.map((a) => a.rule)]), [[0, 1, ["ADD_MISSING_REQUIRED_PROPERTY"]], [1, 0, []]]);
  assert.equal(runRepairLoop(fakeIO([UNFIXABLE])).stop, "NO_RULE");
  const same = runRepairLoop(fakeIO([RED_FIXABLE, RED_FIXABLE]));
  assert.deepEqual([same.stop, same.rounds], ["NO_PROGRESS", 1]);
  // Errors change every round (so it is progress) until the round budget runs out.
  const rounds = runRepairLoop(fakeIO([RED_OTHER(0), RED_OTHER(1), RED_OTHER(2), RED_OTHER(3)]), { maxRounds: 2, deadlineMs: 1e9 });
  assert.deepEqual([rounds.stop, rounds.rounds, rounds.iterations.length], ["BUDGET_ITERATIONS", 2, 3]);
  // Clock past the deadline before the first repair round.
  const time = runRepairLoop(fakeIO([RED_FIXABLE, GREEN], { clock: [0, 500] }), { maxRounds: 4, deadlineMs: 400 });
  assert.deepEqual([time.stop, time.rounds, time.changed], ["BUDGET_TIME", 0, false]);
  // Deadline hit right after applying: stop without another evaluation.
  const late = runRepairLoop(fakeIO([RED_FIXABLE, GREEN], { clock: [0, 10, 500] }), { maxRounds: 4, deadlineMs: 400 });
  assert.deepEqual([late.stop, late.rounds, late.iterations.length], ["BUDGET_TIME", 1, 1]);
  const refused = runRepairLoop(fakeIO([RED_FIXABLE, GREEN], { refuse: true }));
  assert.equal(refused.stop, "EDIT_REFUSED");
});

test("real tsc: the loop parses actual compiler output and repairs five error kinds to green", () => {
  const dir = mkdtempSync(join(tmpdir(), "m7-tsc-"));
  const files: Record<string, string> = {
    "src/util.ts": "export function clamp(n: number): number {\n  return Math.max(0, n);\n}\n",
    "src/theme.ts": [
      "export type Theme = {",
      "  readonly name: string;",
      "  readonly accent: string;",
      "};",
      'export type Severity = "low" | "high";',
      "export const DEFAULT_THEME: Theme = {",
      '  name: "plain",',
      "};",
      "export function themeLabel(t: Theme): string {",
      "  return t.name;",
      "}",
      "",
    ].join("\n"),
    "src/use.ts": [
      'import { DEFAULT_THEME, themeLabel } from "./theme";',
      'import type { Severity } from "./theme";',
      "",
      "export const a = themLabel(DEFAULT_THEME);",
      "export const b = DEFAULT_THEME.nmae;",
      "export const c = clamp(3);",
      'export const s: Severity = "critical";',
      "",
    ].join("\n"),
  };
  for (const [p, c] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, p)), { recursive: true });
    writeFileSync(join(dir, p), c);
  }
  writeFileSync(join(dir, "tsconfig.json"), TSCONFIG);
  symlinkSync(join(repo, "node_modules"), join(dir, "node_modules"));
  const read = (p: string) => (existsSync(join(dir, p)) ? readFileSync(join(dir, p), "utf8") : null);
  const io: LoopIO = {
    evaluate: () => {
      const r = spawnSync(tscBin, ["-p", "tsconfig.json", "--noEmit", "--pretty", "false"], { cwd: dir, encoding: "utf8" });
      const ok = r.status === 0;
      return { typecheck: ok, originalSuite: ok, newTests: ok, errors: ok ? [] : parseTscOutput(r.stdout, dir) };
    },
    context: () => ctxOf(Object.fromEntries(Object.keys(files).map((p) => [p, read(p)!]))),
    apply: (e) => {
      writeFileSync(join(dir, e.path), e.content);
      return true;
    },
    now: Date.now,
  };
  const r = runRepairLoop(io, { maxRounds: 6, deadlineMs: 120_000 });
  assert.equal(r.stop, "GREEN", JSON.stringify(r.iterations.map((i) => i.errors.map((e) => e.code))));
  const rules = new Set(r.iterations.flatMap((i) => i.applied.map((a) => a.rule)));
  for (const rule of ["FIX_NAME_TYPO", "FIX_PROPERTY_TYPO", "ADD_MISSING_IMPORT", "ADD_UNION_LITERAL", "ADD_MISSING_REQUIRED_PROPERTY"]) assert.ok(rules.has(rule as never), rule);
  assert.match(read("src/use.ts")!, /import \{ clamp \} from "\.\/util";/);
  assert.match(read("src/theme.ts")!, /accent: "",/);
});

// ---- Job B harness end to end (sandbox-free mode; CI adds the unprivileged user)

test("Job B harness: a candidate failing tsc is repaired to green; the harness writes results, record and repaired diff", () => {
  const fx = harnessFixture();
  const diff = fx.candidate({
    "src/theme.ts": THEME.replace("  readonly dark: boolean;\n", "  readonly dark: boolean;\n  readonly accent: string;\n"),
    "src/theme.Theme-accent.test.ts": 'import assert from "node:assert/strict";\nimport test from "node:test";\nimport type { Theme } from "./theme";\n\ntest("Theme has field accent", () => {\n  const key: keyof Theme = "accent";\n  assert.equal(key, "accent");\n});\n',
  });
  const { results, repairOf, out, stdout } = runJobB(fx, [diff]);
  assert.match(stdout, /candidate-1 repair stop=GREEN rounds=1 rules=ADD_MISSING_REQUIRED_PROPERTY gate=pass/);
  assert.deepEqual([results[0].applied, results[0].typecheckPassed, results[0].originalSuitePassed, results[0].newTestsPassed, results[0].newTestFiles], [true, true, true, true, 1]);
  const rec = repairOf("candidate-1");
  assert.ok(validateRepairRecord(rec));
  assert.deepEqual(rec.original, { typecheckPassed: false, originalSuitePassed: false, newTestsPassed: false });
  assert.equal(rec.iterations[0].errors[0].code, "TS2741");
  const repaired = readFileSync(join(out, "repair", "candidate-1.diff"), "utf8");
  assert.equal(sha(repaired), rec.repairedDiffSha256);
  assert.equal(sha(diff), rec.originalDiffSha256);
  assert.match(repaired, /^\+ {2}accent: "",$/m);
  assert.match(repaired, /^\+ {2}readonly accent: string;$/m);
  assert.equal(results[0].diffBytes, Buffer.byteLength(repaired));
});

test("Job B harness: existing tests are never edited; an unrepairable candidate is tested exactly as generated", () => {
  const fx = harnessFixture();
  // A required field breaks the existing test's literal; the only fix would be in that test: refused.
  const diff = fx.candidate({ "src/profile.ts": PROFILE.replace("  readonly id: string;\n", "  readonly id: string;\n  readonly email: string;\n") });
  const { results, repairOf, out } = runJobB(fx, [diff]);
  const rec = repairOf("candidate-1");
  assert.equal(rec.stop, "NO_RULE");
  assert.equal(rec.repairedDiffSha256, null);
  assert.ok(rec.iterations.every((it: { applied: { path: string }[] }) => it.applied.every((a) => a.path !== "src/profile.test.ts")));
  assert.equal(existsSync(join(out, "repair", "candidate-1.diff")), false);
  assert.equal(results[0].typecheckPassed, false);
  assert.equal(results[0].diffBytes, Buffer.byteLength(diff));
  assert.equal(readFileSync(join(fx.ws, "src/profile.test.ts"), "utf8"), PROFILE_TEST);
});

test("Job B harness: a failing new-test assertion on a constant the candidate added is aligned; PEACEAI_REPAIR=off disables the loop", () => {
  const fx = harnessFixture();
  const diff = fx.candidate({
    "src/theme.ts": `${THEME}export const RETRIES = 3;\n`,
    "src/theme.RETRIES.test.ts": 'import assert from "node:assert/strict";\nimport test from "node:test";\nimport { RETRIES } from "./theme";\n\ntest("RETRIES is 4", () => {\n  assert.equal(RETRIES, 4);\n});\n',
  });
  const on = runJobB(fx, [diff]);
  const rec = on.repairOf("candidate-1");
  assert.equal(rec.stop, "GREEN", JSON.stringify(rec.iterations));
  assert.deepEqual(rec.iterations[0].errors.map((e: RepairError) => [e.kind, e.expected, e.actual]), [["assertion", "4", "3"]]);
  assert.equal(rec.iterations[0].applied[0].rule, "ALIGN_ADDED_CONSTANT");
  assert.equal(on.results[0].newTestsPassed, true);
  const fx2 = harnessFixture();
  const off = runJobB(fx2, [diff], { PEACEAI_REPAIR: "off" });
  assert.equal(off.repairOf("candidate-1"), null);
  assert.equal(off.results[0].newTestsPassed, false);
});

// ---- Job B2 re-gate and Job C record

test("Job B2: a repaired diff that passes the core gate replaces the candidate (TEST_FIX_LOOP); the original is kept for Results", () => {
  const b = b2Fixture('accent: "",');
  const r = runB2(b);
  assert.equal(r.diff, b.repaired);
  assert.equal(r.rec.regate, "pass");
  assert.deepEqual(r.summary.candidates[0].transformations, ["ADD_TYPE_FIELD", "TEST_FIX_LOOP"]);
  assert.equal(r.summary.candidates[0].diffBytes, Buffer.byteLength(b.repaired));
  assert.equal(readFileSync(join(b.final, "testresults", "repair", "candidate-1.original.diff"), "utf8"), b.diff);
  assert.equal(r.results[0].typecheckPassed, true);
  assert.match(r.stdout, /repaired=1 used=1/);
});

test("Job B2: core text in the repair, or a hash mismatch, falls back to the candidate as generated with its round-0 results", () => {
  const coreLine = 'accent: "CORE-unique-marker-value-that-only-the-core-has-in-it-for-this-test",';
  const rejected = runB2(b2Fixture(coreLine));
  assert.equal(rejected.rec.regate, "core-gate-rejected");
  assert.ok(!rejected.diff.includes("CORE-unique"));
  assert.deepEqual([rejected.results[0].typecheckPassed, rejected.results[0].originalSuitePassed, rejected.results[0].newTestsPassed], [false, false, false]);
  assert.deepEqual(rejected.summary.candidates[0].transformations, ["ADD_TYPE_FIELD"]);
  const tampered = runB2(b2Fixture('accent: "",', { tamper: true }));
  assert.equal(tampered.rec.regate, "hash-mismatch");
  assert.equal(tampered.results[0].typecheckPassed, false);
});

test("Job C records the repair iterations and the original diff in Results", () => {
  const b = b2Fixture('accent: "",');
  runB2(b);
  const work = b.fx.dir;
  const root = join(work, "results");
  mkdirSync(root);
  writeFileSync(join(work, "issue.json"), JSON.stringify({ number: 7, title: "[test] add accent", body: "" }));
  const r = spawnSync(tsx, [join(repo, "peaceai/bin/record-task.ts")], {
    cwd: repo, encoding: "utf8",
    env: { ...process.env, RESULTS_DIR: root, PEACEAI_IN_DIR: b.final, PEACEAI_TESTRESULTS_DIR: join(b.final, "testresults"), ISSUE_JSON: join(work, "issue.json"), RUN_ID: "7001", RECORDED_AT: "2026-10-10T22:00:00Z", GITHUB_OUTPUT: join(work, "out") },
  });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /repair_records=1/);
  const dir = taskDir(root, 7, "7001");
  const rec = JSON.parse(readFileSync(join(dir, "repair", "candidate-1.json"), "utf8"));
  assert.ok(validateRepairRecord(rec));
  assert.equal(rec.iterations.length, 2);
  assert.equal(readFileSync(join(dir, "repair", "candidate-1.original.diff"), "utf8"), b.diff);
  assert.equal(readFileSync(join(dir, "candidates", "candidate-1.diff"), "utf8"), b.repaired);
});
