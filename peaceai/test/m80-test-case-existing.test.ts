// M80 TEST_CASE_EXISTING (public-test-case-existing-v1, kind TEST_EXISTING): a characterization test for an EXISTING
// exported pure function. One new test file, no source edit, no fix commit. Job B grades it fix-free: the test must
// pass on today's code and fail, by assertions only, with the function's body replaced by the write-only stub (M23
// confined route). Impure, async, I/O, date-local and self-protected targets are refused by name.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { admitRules, APPROVED_SCHEMA } from "../lib/approved.ts";
import { applyRule, RULE_KINDS, specHash, TRIGGERS, validateSpec, type RuleSpec } from "../lib/learned.ts";
import { TEST_TRIGGER } from "../lib/learned-test.ts";
import { stubAll } from "../lib/learned-function.ts";
import {
  applyExistingTestRule, existingTargetRefusal, moduleReadClosure, parseExistingTestTask, SELF_PROTECTED_PATH, TEST_CHECK_REFUSED, TEST_EXISTING_FLAG,
  TEST_EXISTING_REFUSALS, TEST_EXISTING_TRIGGER, TEST_TARGET_ASYNC, TEST_TARGET_DATE_LOCAL, TEST_TARGET_IMPURE, TEST_TARGET_IO, TEST_TARGET_NOT_EXPORTED,
  TEST_TARGET_NOT_FOUND, TEST_TARGET_SIGNATURE, TEST_TARGET_TOO_LARGE,
} from "../lib/learned-test-existing.ts";
import { readManifestBytes } from "../lib/manifestparts.ts";
import { PEACE_AUTHOR } from "../lib/minetest.ts";
import { parseTask } from "../lib/nlparse.ts";
import { parseMarker, parseSpecBlock, phrasingFor, proposalBody } from "../lib/propose.ts";
import { buildRecords } from "../lib/records.ts";
import { validateResults } from "../lib/results.ts";
import { PROTECTED_SELF } from "../lib/selfchange.ts";

const root = resolve(import.meta.dirname, "../..");
const read = (p: string) => readFileSync(resolve(root, p), "utf8");
const SPEC = JSON.parse(read("peaceai/rules/learned/public-test-case-existing-v1.json")) as RuleSpec;
const SHA = "81aba1e3e190ceff2e95c87b1faef43ed60bdb935bc11dfff290f2b8c32e3377";
const TC = JSON.parse(read("peaceai/rules/learned/public-test-case-v1.json")) as RuleSpec;

// A module in the shape of PeaceSTOCKS's untested helpers (sibling consts, a private helper, regexes).
const MOD = [
  'export const PREFIX = "permanent/tenmin-reply-dust";',
  "const LIMITS = [1, 2, 3] as const;",
  "function requireRange(from: string, to: string): void {",
  '  if (!/^\\d{4}-\\d{2}-\\d{2}$/u.test(from) || !/^\\d{4}-\\d{2}-\\d{2}$/u.test(to) || from > to) throw new Error("INVALID_RANGE");',
  "}",
  "export function rangePrefix(calendarFrom: string, calendarTo: string): string {",
  "  requireRange(calendarFrom, calendarTo);",
  "  return `${PREFIX}/${calendarFrom}_${calendarTo}`;",
  "}",
  "export function isOutage(message: string): boolean {",
  '  return message.startsWith("MASSIVE_NETWORK") || /^MASSIVE_HTTP_5\\d\\d\\b/u.test(message);',
  "}",
  "export function gapReason(message: string): string {",
  "  const match = /^([A-Z][A-Z0-9_]+)/u.exec(message);",
  '  return match?.[1] ?? "TENMIN_RANGE_FETCH_FAILED";',
  "}",
  "export function sorted(xs: readonly number[]): number[] {",
  "  const out = [...xs];",
  "  out.sort((a, b) => a - b);",
  "  return out;",
  "}",
  "export function limitCount(): number { return LIMITS.length; }",
  "",
].join("\n");
const FILES = [{ path: "src/r.ts", content: MOD }, { path: "src/r.test.ts", content: 'import test from "node:test";\n' }];
const isTest = (p: string) => /\.test\.ts$/.test(p);
const task = (fn: string, checks: string, file = "src/r.ts", title = "") => `add a characterization test for ${fn} in ${file}${title ? `: ${title}` : ""}\n${checks}`;
const run = (t: string, files = FILES, repo?: string) => {
  const w: { reason?: string } = {};
  const e = applyRule(SPEC, t, files, isTest, repo, w, () => false);
  return { e, r: w.reason };
};

// ---- spec and wiring ----
test("spec: valid, hash pinned, own kind and trigger, fixed vocabulary; nothing else validates", () => {
  assert.ok(validateSpec(SPEC));
  assert.equal(specHash(SPEC), SHA);
  assert.equal(SPEC.kind, "TEST_EXISTING");
  assert.ok((RULE_KINDS as readonly string[]).includes("TEST_EXISTING"));
  assert.equal(SPEC.trigger, TEST_EXISTING_TRIGGER);
  assert.equal(TRIGGERS.TEST_EXISTING, TEST_EXISTING_TRIGGER);
  assert.notEqual(TEST_EXISTING_TRIGGER, TEST_TRIGGER);
  assert.equal(SPEC.minedFrom, "public");
  assert.deepEqual(SPEC.params, { assert: "node:assert/strict-default", checks: ["equal", "deepEqual", "throws"], framework: "node:test-default", grading: "pass-now-fail-stub", matcher: "regex", maxLines: "40", placement: "new-file", target: "exported-pure-function" });
  for (const [k, v] of [["checks", ["equal", "rejects"]], ["grading", "fail-before-pass-after"], ["placement", "append"], ["target", "any-function"], ["maxLines", "2"], ["extra", "x"]] as const)
    assert.ok(!validateSpec({ ...SPEC, params: { ...SPEC.params, [k]: v } }), `${k} refused`);
  assert.ok(!validateSpec({ ...SPEC, minedFrom: "core", id: "core-test-case-existing-v1" }), "public-mined only");
  // The fix-based kind is unchanged and the two triggers never read each other's header.
  assert.ok(validateSpec(TC));
  assert.equal(new RegExp(TEST_TRIGGER, "i").test("add a characterization test for f in src/a.ts"), false);
  assert.equal(new RegExp(TEST_EXISTING_TRIGGER, "i").test("add a regression test for f in src/a.ts"), false);
  // Approval lands only via Peace's /approve-rule bot PR; whether or not it has landed, any listed entry must pin this exact spec hash.
  const onMain = JSON.parse(read("peaceai/rules/approved.json")) as { rules: { id: string; sha256: string }[] };
  for (const r of onMain.rules.filter((r) => r.id === SPEC.id)) assert.equal(r.sha256, SHA, "a listed entry pins the exact spec hash");
});

test("Job A: admitted only with the exact hash; the dev path needs its flag exactly \"true\"", () => {
  const list = (sha: string, source = "workspace") => ({ ok: true as const, list: { schema: "peaceai-approved-rules:v1", rules: [{ id: SPEC.id, sha256: sha, source }] } as never });
  assert.equal(admitRules([SPEC], list(SHA))[0]!.decision, "APPROVED");
  assert.equal(admitRules([SPEC], list("0".repeat(64)))[0]!.decision, "HASH_CHANGED");
  assert.equal(admitRules([SPEC], list(SHA, "results"))[0]!.decision, "NOT_APPROVED");
  assert.equal(admitRules([{ ...SPEC, params: { ...SPEC.params, grading: "x" } }], list(SHA))[0]!.decision, "SPEC_INVALID");
  const t = task("isOutage", '- isOutage("MASSIVE_HTTP_503 x") is true');
  for (const v of [undefined, "1", "TRUE", "yes"]) assert.equal(applyExistingTestRule(SPEC.trigger, SPEC.params, t, FILES, isTest, { [TEST_EXISTING_FLAG]: v }), null, String(v));
  assert.ok(applyExistingTestRule(SPEC.trigger, SPEC.params, t, FILES, isTest, { [TEST_EXISTING_FLAG]: "true" }));
});

test("build: exactly one new test file next to the module, importing only the target; no source edit", () => {
  const { e, r } = run(task("isOutage", '- isOutage("MASSIVE_HTTP_503 upstream") is true\n- isOutage("MASSIVE_NETWORK reset") is true\n- isOutage("MASSIVE_HTTP_404") is false', "src/r.ts", "outage message prefixes"));
  assert.ok(e, r);
  assert.equal(e!.create, true);
  assert.equal(e!.selfGrade, true);
  assert.equal(e!.fixSha, undefined);
  assert.equal(e!.extra, undefined);
  assert.match(e!.path, /^src\/r\.outage-message-prefixes-[0-9a-f]{7}\.test\.ts$/);
  assert.equal(e!.content, [
    'import assert from "node:assert/strict";',
    'import test from "node:test";',
    'import { isOutage } from "./r";',
    "",
    'test("outage message prefixes", () => {',
    '  assert.equal(isOutage("MASSIVE_HTTP_503 upstream"), true);',
    '  assert.equal(isOutage("MASSIVE_NETWORK reset"), true);',
    '  assert.equal(isOutage("MASSIVE_HTTP_404"), false);',
    "});",
    "",
  ].join("\n"));
  // Stable id: the same task gives the same path; another bullet gives another one.
  assert.equal(run(task("isOutage", '- isOutage("MASSIVE_HTTP_503 upstream") is true\n- isOutage("MASSIVE_NETWORK reset") is true\n- isOutage("MASSIVE_HTTP_404") is false', "src/r.ts", "outage message prefixes")).e!.path, e!.path);
  assert.notEqual(run(task("isOutage", '- isOutage("MASSIVE_HTTP_404") is false', "src/r.ts", "outage message prefixes")).e!.path, e!.path);
  // Default title, throws and deepEqual checks, helper + module const followed.
  const p = run(task("rangePrefix", '- rangePrefix("2026-01-01", "2026-01-31") is "permanent/tenmin-reply-dust/2026-01-01_2026-01-31"\n- rangePrefix("2026-02-01", "2026-01-01") throws INVALID_RANGE'));
  assert.ok(p.e, p.r);
  assert.match(p.e!.content, /test\("rangePrefix characterization"/);
  assert.match(p.e!.content, /assert\.throws\(\(\) => rangePrefix\("2026-02-01", "2026-01-01"\), \/INVALID_RANGE\/\);/);
  const s = run(task("sorted", "- sorted([3, 1, 2]) equals [1, 2, 3]"));
  assert.ok(s.e, s.r);
  assert.ok(run(task("limitCount", "- limitCount() is 3")).e);
  assert.ok(run(task("gapReason", '- gapReason("MASSIVE_HTTP_503 x") is "MASSIVE_HTTP_503"\n- gapReason("oops") is "TENMIN_RANGE_FETCH_FAILED"')).e);
});

test("task grammar: a Fix line, rejects, other roots or non-literal arguments are refused", () => {
  assert.equal(parseExistingTestTask(SPEC.trigger, `${task("isOutage", '- isOutage("x") is false')}\nFix: ${"a".repeat(40)}`), null, "a Fix line belongs to ADD_TEST_CASE");
  assert.equal(run(`${task("isOutage", '- isOutage("x") is false')}\nFix: ${"a".repeat(40)}`).r, "task_unparsed");
  assert.equal(run(task("isOutage", '- isOutage("x") rejects with NOPE')).r, TEST_CHECK_REFUSED);
  assert.equal(run(task("isOutage", '- gapReason("x") is "x"')).r, TEST_CHECK_REFUSED, "every check starts from the target");
  assert.equal(run(task("isOutage", "- isOutage is true")).r, TEST_CHECK_REFUSED, "every check calls the target");
  assert.equal(run(task("isOutage", "- isOutage(PREFIX) is true")).r, TEST_CHECK_REFUSED, "literal arguments only");
  assert.equal(run(task("isOutage", '- isOutage("x".repeat(3)) is true')).r, TEST_CHECK_REFUSED);
  assert.equal(run(task("isOutage", "- unreadable bullet")).r, "task_unparsed");
  assert.equal(new RegExp(SPEC.trigger, "i").test("add a characterisation test for isOutage in src/r.ts"), true, "British spelling too");
});

// ---- named refusals ----
const refusal = (body: string, fn = "f", path = "src/m.ts") => existingTargetRefusal(path, body, fn);
test("refusals: every one is named, with a stable reason string", () => {
  const all = [TEST_TARGET_NOT_FOUND, TEST_TARGET_NOT_EXPORTED, TEST_TARGET_ASYNC, TEST_TARGET_IO, TEST_TARGET_DATE_LOCAL, TEST_TARGET_IMPURE, TEST_TARGET_SIGNATURE, TEST_TARGET_TOO_LARGE, TEST_CHECK_REFUSED, SELF_PROTECTED_PATH];
  assert.deepEqual([...TEST_EXISTING_REFUSALS].sort(), [...all].sort());
  assert.deepEqual(all.map((r) => /^[a-z_]+$/.test(r)), all.map(() => true));
});
test("refusals: async targets (test_target_async)", () => {
  assert.equal(refusal("export async function f(a: string): Promise<string> { return a; }\n"), TEST_TARGET_ASYNC);
  assert.equal(refusal("export function* f(): Generator<number> { yield 1; }\n"), TEST_TARGET_ASYNC);
  assert.equal(refusal("export function f(a: string): Promise<string> { return Promise.resolve(a); }\n"), TEST_TARGET_ASYNC);
  assert.equal(refusal("async function g(): Promise<number> { return 1; }\nexport function f(a: number): number { void g(); return a; }\n"), TEST_TARGET_ASYNC, "reached helper is async");
  assert.equal(refusal("export function f(xs: number[]): number { const h = async () => 1; return xs.length; }\n"), TEST_TARGET_ASYNC, "async closure");
});
test("refusals: I/O targets (test_target_io)", () => {
  assert.equal(refusal("export function f(a: string): string { return process.env[a] ?? \"\"; }\n"), TEST_TARGET_IO);
  assert.equal(refusal("export function f(a: string): string { console.log(a); return a; }\n"), TEST_TARGET_IO);
  assert.equal(refusal('import { readFileSync } from "node:fs";\nexport function f(a: string): string { return readFileSync(a, "utf8"); }\n'), TEST_TARGET_IO);
  assert.equal(refusal('import { join } from "path";\nexport function f(a: string): string { return join(a, "x"); }\n'), TEST_TARGET_IO, "bare builtin");
  assert.equal(refusal("export function f(a: string): number { return setTimeout(() => a, 1) as unknown as number; }\n"), TEST_TARGET_IO);
  assert.equal(refusal("export function f(a: string): string { return import.meta.url + a; }\n"), TEST_TARGET_IO);
  assert.equal(refusal("export function f(a: string): string { return globalThis.String(a); }\n"), TEST_TARGET_IO);
  assert.equal(refusal("const ENV = process.env.X;\nexport function f(a: string): string { return a + ENV; }\n"), TEST_TARGET_IO, "through a module const");
});
test("refusals: the clock and local time (test_target_date_local)", () => {
  assert.equal(refusal("export function f(): number { return Date.now(); }\n"), TEST_TARGET_DATE_LOCAL);
  assert.equal(refusal("export function f(): string { return new Date().toISOString(); }\n"), TEST_TARGET_DATE_LOCAL);
  assert.equal(refusal("export function f(t: number): number { return new Date(t).getHours(); }\n"), TEST_TARGET_DATE_LOCAL);
  assert.equal(refusal('export function f(s: string): number { return Date.parse(s); }\n'), TEST_TARGET_DATE_LOCAL);
  assert.equal(refusal('const fmt = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York" });\nexport function f(t: number): string { return fmt.format(t); }\n'), TEST_TARGET_DATE_LOCAL, "Intl");
  assert.equal(refusal("export function f(t: number): string { return new Date(t).toISOString().slice(0, 10); }\n"), null, "timezone-free Date API is fine");
});
test("refusals: impurity (test_target_impure)", () => {
  assert.equal(refusal('import { g } from "./g";\nexport function f(a: number): number { return g(a); }\n'), TEST_TARGET_IMPURE, "imported value");
  assert.equal(refusal("let n = 0;\nexport function f(): number { return n++; }\n"), TEST_TARGET_IMPURE, "module let");
  assert.equal(refusal("const cache = new Map<string, number>();\nexport function f(a: string): number { return cache.get(a) ?? 0; }\nexport function put(a: string): void { cache.set(a, 1); }\n"), TEST_TARGET_IMPURE, "module const mutated elsewhere");
  assert.equal(refusal("export function f(xs: number[]): number[] { xs.sort(); return xs; }\n"), TEST_TARGET_IMPURE, "mutates a parameter");
  assert.equal(refusal("export function f(xs: number[]): number { xs[0] = 1; return xs.length; }\n"), TEST_TARGET_IMPURE);
  assert.equal(refusal("export function f(): number { return Math.random(); }\n"), TEST_TARGET_IMPURE);
  assert.equal(refusal("const RE = /a/g;\nexport function f(s: string): boolean { return RE.test(s); }\n"), TEST_TARGET_IMPURE, "stateful regex");
  assert.equal(refusal("export function f(s: string): string { return eval(s); }\n"), TEST_TARGET_IMPURE);
  assert.equal(refusal("class C {}\nexport function f(): number { return new C() ? 1 : 0; }\n"), TEST_TARGET_IMPURE);
  assert.equal(refusal("export function f(s: string): number { return new Uint8Array(s.length).length; }\n"), TEST_TARGET_IMPURE, "other new");
  assert.equal(refusal("export function f(s: string): string { return Buffer.from(s).toString(\"hex\"); }\n"), TEST_TARGET_IMPURE, "unlisted global");
  assert.equal(refusal("export function f(t: number): number { const d = new Date(t); d.setUTCDate(1); return d.getTime(); }\n"), TEST_TARGET_IMPURE, "date setter");
  assert.equal(refusal("export function f(o: string[]): number { Object.assign(o, [1]); return o.length; }\n"), TEST_TARGET_IMPURE);
  assert.equal(refusal("export function f(xs: number[]): number[] { const out: number[] = []; for (const x of xs) out.push(x * 2); return out; }\n"), null, "local array is fine");
});
test("refusals: signature, existence, export and size", () => {
  assert.equal(refusal("export function g(): number { return 1; }\n"), TEST_TARGET_NOT_FOUND);
  assert.equal(refusal("function f(): number { return 1; }\n"), TEST_TARGET_NOT_EXPORTED);
  assert.equal(refusal("export default function f(): number { return 1; }\n"), TEST_TARGET_NOT_EXPORTED);
  assert.equal(refusal("function f(): number { return 1; }\nexport { f };\n"), null, "export list counts");
  assert.equal(refusal("export const f = (a: number): number => a;\n"), TEST_TARGET_SIGNATURE);
  assert.equal(refusal("export function f(a: { x: number }): number { return a.x; }\n"), TEST_TARGET_SIGNATURE);
  assert.equal(refusal("export function f(a: number) { return a; }\n"), TEST_TARGET_SIGNATURE, "return annotation required");
  assert.equal(refusal("export function f(a?: number): number { return a ?? 0; }\n"), TEST_TARGET_SIGNATURE);
  assert.equal(refusal("export function f<T>(a: number): number { return a; }\n"), TEST_TARGET_SIGNATURE);
  assert.equal(refusal("export function f(a: number): number;\nexport function f(a: number): number { return a; }\n"), TEST_TARGET_SIGNATURE, "overloads");
  assert.equal(refusal("export function f(a: number, b: number, c: number, d: number, e: number): number { return a + b + c + d + e; }\n"), TEST_TARGET_SIGNATURE);
  const chain = Array.from({ length: 14 }, (_, i) => `function h${i}(n: number): number { return ${i === 13 ? "n" : `h${i + 1}(n)`}; }`).join("\n");
  assert.equal(refusal(`${chain}\nexport function f(n: number): number { return h0(n); }\n`), TEST_TARGET_TOO_LARGE);
  assert.equal(refusal("export function f(n: number): number { return n; }\n", "f", "src/m.d.ts"), SELF_PROTECTED_PATH);
});
test("refusals through applyRule: self-protected, denied, missing, test module, existing path", () => {
  const prot = [{ path: "peaceai/lib/learned.ts", content: "export function specHash(a: string): string { return a; }\n" }];
  assert.equal(run(task("specHash", '- specHash("a") is "a"', "peaceai/lib/learned.ts"), prot).r, SELF_PROTECTED_PATH);
  assert.equal(run(task("f", "- f(1) is 1", "builder-log/x.ts"), [{ path: "builder-log/x.ts", content: "export function f(n: number): number { return n; }\n" }]).r, SELF_PROTECTED_PATH);
  assert.equal(run(task("f", "- f(1) is 1", "src/host.ts"), [{ path: "src/host.ts", content: "export function f(n: number): number { return n; }\n" }], "PeaceG03/PeaceSTOCKS").r, "denied_path");
  assert.equal(run(task("isOutage", '- isOutage("x") is false', "src/none.ts")).r, "target_file_not_found");
  assert.equal(run(task("x", "- x(1) is 1", "src/r.test.ts")).r, SELF_PROTECTED_PATH, "a test file is never a target");
  assert.equal(run(task("isOutage", '- isOutage("x") is false', "src/../r.ts")).r, "path_not_plain");
  const w: { reason?: string } = {};
  assert.equal(applyRule(SPEC, task("isOutage", '- isOutage("x") is false'), FILES, isTest, undefined, w, () => true), null);
  assert.equal(w.reason, "new_test_path_exists");
});

test("PeaceSTOCKS-shaped helpers are accepted; their impure neighbours are refused with the right names", () => {
  assert.equal(refusal(MOD, "rangePrefix"), null);
  assert.equal(refusal(MOD, "isOutage"), null);
  const io = 'import { readFile } from "node:fs/promises";\nexport async function load(p: string): Promise<string> { return readFile(p, "utf8"); }\nexport function key(p: string): string { return `${p}.json`; }\n';
  assert.equal(refusal(io, "load"), TEST_TARGET_ASYNC);
  assert.equal(refusal(io, "key"), null, "an unused I/O import does not taint a pure neighbour");
});

// ---- the read closure for the confined run ----
test("moduleReadClosure: relative imports, re-exports and literal dynamic imports, type-only included; fails closed on non-literal dynamic imports, require and unresolved paths", () => {
  const fs: Record<string, string> = {
    "src/a.ts": 'import type { T } from "./t";\nimport { b } from "./b";\nexport * from "./c.js";\nimport x from "pkg";\nexport function a(): number { return b(); }\n',
    "src/t.ts": "export type T = number;\n", "src/b.ts": 'import { d } from "./d/index.ts";\nexport function b(): number { return d; }\n', "src/c.ts": "export const c = 1;\n", "src/d/index.ts": "export const d = 1;\n",
  };
  const r = (p: string) => fs[p] ?? null;
  assert.deepEqual(moduleReadClosure("src/a.ts", r), ["src/a.ts", "src/b.ts", "src/c.ts", "src/d/index.ts", "src/t.ts"]);
  assert.equal(moduleReadClosure("src/a.ts", (p) => (p === "src/b.ts" ? 'import { z } from "./missing";\n' : r(p))), null);
  assert.deepEqual(moduleReadClosure("src/a.ts", (p) => (p === "src/c.ts" ? 'export async function c(): Promise<number> { return (await import("./e")).e; }\n' : p === "src/e.ts" ? "export const e = 1;\n" : r(p))), ["src/a.ts", "src/b.ts", "src/c.ts", "src/d/index.ts", "src/e.ts", "src/t.ts"], "a literal dynamic import joins the closure");
  assert.equal(moduleReadClosure("src/a.ts", (p) => (p === "src/c.ts" ? 'const n = "./t";\nexport const c = await import(n);\n' : r(p))), null, "a non-literal dynamic import fails closed");
  assert.equal(moduleReadClosure("src/a.ts", (p) => (p === "src/c.ts" ? 'const c = require("./t");\n' : r(p))), null);
  assert.equal(moduleReadClosure("src/a.ts", r, 3), null, "bounded");
  assert.equal(moduleReadClosure("src/a.ts", (p) => (p === "src/a.ts" ? 'import "../../../x";\n' : null)), null, "escapes the tree");
});

// ---- Job B: fix-free grading end to end ----
const git = (cwd: string, ...a: string[]) => execFileSync("git", ["-c", "user.name=PeaceG03", "-c", `user.email=${PEACE_AUTHOR}`, ...a], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
// Extensionless relative imports, as in PeaceSTOCKS.
const TSCONFIG = JSON.stringify({ compilerOptions: { target: "ES2022", module: "ESNext", moduleResolution: "Bundler", strict: true, noEmit: true, allowImportingTsExtensions: true, types: ["node"] }, include: ["src"] });
const DEP = 'export const PREFIX = "permanent/tenmin-reply-dust";\n';
const JMOD = MOD.replace('export const PREFIX = "permanent/tenmin-reply-dust";', 'import type { Unused } from "./types.ts";\nexport const PREFIX = "permanent/tenmin-reply-dust";\nexport type X = Unused;');
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "m80-"));
  const ws = join(dir, "ws");
  mkdirSync(join(ws, "src"), { recursive: true });
  writeFileSync(join(ws, "src/r.ts"), JMOD);
  writeFileSync(join(ws, "src/types.ts"), "export type Unused = string;\n" + DEP.replace("PREFIX", "OTHER"));
  writeFileSync(join(ws, "src/base.test.ts"), 'import test from "node:test";\ntest("base", () => {});\n');
  writeFileSync(join(ws, "tsconfig.json"), TSCONFIG);
  writeFileSync(join(ws, "package.json"), '{ "name": "m80-fixture", "private": true, "type": "module" }\n');
  writeFileSync(join(ws, ".gitignore"), "node_modules\n");
  symlinkSync(join(root, "node_modules"), join(ws, "node_modules"));
  git(ws, "init", "-q", "-b", "main"); git(ws, "add", "-A"); git(ws, "commit", "-qm", "base");
  const baseSha = git(ws, "rev-parse", "HEAD").trim();
  const files = [{ path: "src/r.ts", content: JMOD }, { path: "src/types.ts", content: "" }, { path: "src/base.test.ts", content: "" }];
  const candidate = (t: string, edit?: (c: string) => string, extra: Record<string, string> = {}) => {
    const e = applyRule(SPEC, t, files, isTest, undefined, {}, () => false)!;
    assert.ok(e, t);
    writeFileSync(join(ws, e.path), edit ? edit(e.content) : e.content);
    for (const [p, c] of Object.entries(extra)) writeFileSync(join(ws, p), c);
    git(ws, "add", "-N", "--", e.path, ...Object.keys(extra).filter((p) => !p.startsWith("src/r.ts")));
    const d = git(ws, "diff", "--no-color", "--full-index", "--no-renames");
    git(ws, "reset", "-q", "--hard"); git(ws, "clean", "-fdq");
    return d;
  };
  return { dir, ws, baseSha, candidate };
}
function grade(fx: ReturnType<typeof fixture>, diffs: string[]) {
  const inDir = join(fx.dir, "in");
  mkdirSync(join(inDir, "candidates"), { recursive: true });
  const candidates = diffs.map((d, i) => {
    writeFileSync(join(inDir, "candidates", `candidate-${i + 1}.diff`), d);
    return { id: `candidate-${i + 1}`, file: `candidates/candidate-${i + 1}.diff`, transformations: ["LEARNED_TEST_EXISTING"], operationId: `learned:${SPEC.id}@${SHA}`, diffBytes: d.length, diffLines: 5, selfGrade: true as const };
  });
  const summary = { schema: "peaceai-workspace-candidates:v1", taskId: "workspace-issue-9", baseSha: fx.baseSha, candidates };
  writeFileSync(join(inDir, "summary.json"), JSON.stringify(summary));
  const list = join(fx.dir, "approved.json");
  writeFileSync(list, JSON.stringify({ schema: APPROVED_SCHEMA, rules: [{ id: SPEC.id, sha256: SHA, source: "workspace", approval: { url: "https://github.com/PeaceG03/PeaceAI-Workspace/issues/40#issuecomment-123", commentId: 123, issue: 40, repo: "PeaceG03/PeaceAI-Workspace", author: "PeaceG03", approvedAt: "2026-10-17T00:00:00Z" } }] }));
  const resultsFile = join(fx.dir, "out", "results.json");
  mkdirSync(join(fx.dir, "out"), { recursive: true });
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("NODE_TEST")));
  const r = spawnSync(join(root, "node_modules/.bin/tsx"), [join(root, "peaceai/bin/test-candidates.ts")], {
    cwd: root, encoding: "utf8",
    env: { ...env, PEACEAI_IN_DIR: inDir, PEACEAI_RESULTS_FILE: resultsFile, PEACEAI_WORKSPACE_DIR: fx.ws, PEACEAI_TARGET: "PeaceG03/PeaceAI-Workspace", PEACEAI_SANDBOX_USER: "", PEACEAI_REQUIRE_SANDBOX: "", PEACEAI_APPROVED_LIST: list },
  });
  assert.equal(r.status, 0, r.stderr);
  const results = JSON.parse(readFileSync(resultsFile, "utf8"));
  assert.ok(validateResults(results));
  return { results: results.results, summary, stdout: r.stdout };
}
const confined = Number(process.versions.node.split(".")[0]) >= 22;
test("Job B: passes today + fails on the stub COUNTS; a stub-satisfied test is rejected; extra files, other imports and unstable tests never count", { timeout: 600_000 }, () => {
  const fx = fixture();
  try {
    const good = fx.candidate(task("rangePrefix", '- rangePrefix("2026-01-01", "2026-01-31") is "permanent/tenmin-reply-dust/2026-01-01_2026-01-31"\n- rangePrefix("2026-02-01", "2026-01-01") throws INVALID_RANGE'));
    const weak = fx.candidate(task("isOutage", '- isOutage("MASSIVE_HTTP_404") is false'));
    const wrong = fx.candidate(task("gapReason", '- gapReason("oops") is "WRONG"'));
    const extra = fx.candidate(task("isOutage", '- isOutage("MASSIVE_HTTP_503 x") is true', "src/r.ts", "extra file"), undefined, { "src/other.ts": "export const z = 1;\n" });
    const sneaky = fx.candidate(task("isOutage", '- isOutage("MASSIVE_HTTP_503 x") is true', "src/r.ts", "sneaky import"), (c) => c.replace('import test from "node:test";', 'import test from "node:test";\nimport { readFileSync } from "node:fs";\nvoid readFileSync;'));
    const { results, summary, stdout } = grade(fx, [good, weak, wrong, extra, sneaky]);
    if (confined) {
      assert.deepEqual(results[0].testGrading, { fixSha: fx.baseSha, afterFix: true, beforeFix: false, verdict: "COUNTS", reason: null, stubFails: true, stubbed: ["rangePrefix"] });
      assert.deepEqual(results[1].testGrading, { fixSha: fx.baseSha, afterFix: true, beforeFix: true, verdict: "REJECTED_PASSES_BOTH", reason: null, stubFails: false, stubbed: ["isOutage"] });
      assert.match(stdout, /grading: test-existing stub \(tested rangePrefix in src\/r\.ts; failure credited: true; stub notes: [1-9]\d*; permission model: true; reads: 2 module files\)/);
    } else {
      for (const i of [0, 1]) assert.equal(results[i].testGrading!.reason, "not-confined", "never graded unconfined");
    }
    assert.equal(results[2].newTestsPassed, false);
    assert.equal(results[2].testGrading!.verdict === "COUNTS", false, "fails today: never counts");
    assert.equal(results[3].testGrading!.verdict, "UNGRADABLE"); assert.equal(results[3].testGrading!.reason, "not-test-only");
    assert.equal(results[4].testGrading!.verdict, "UNGRADABLE"); assert.equal(results[4].testGrading!.reason, confined ? "not-test-only" : "not-confined");
    const rec = buildRecords({ issue: 9, runId: "1", recordedAt: "2026-10-17T00:00:00Z", baseSha: fx.baseSha, title: "[test] f", body: "x" }, summary.candidates, results, "seed");
    assert.equal(rec.ranking.candidates[0]!.eligible, confined, JSON.stringify(rec.ranking.candidates[0]));
    for (const i of [1, 2, 3, 4]) assert.equal(rec.ranking.candidates[i]!.eligible, false, String(i));
    // The module is restored after the stub run.
    assert.equal(git(fx.ws, "status", "--porcelain"), "");
  } finally {
    rmSync(fx.dir, { recursive: true, force: true });
  }
});
test("Job B code: the TEST_EXISTING route is confined, closure-narrowed, three real runs, credited stub only", () => {
  const tc = read("peaceai/bin/test-candidates.ts");
  const g = tc.slice(tc.indexOf("function gradeExisting("), tc.indexOf("/**\n * M13: grading of a learned guard"));
  assert.ok(g.length > 0);
  assert.match(g, /PERMISSION_NODE_MAJOR\) return ungradable\("not-confined"\)/);
  assert.match(g, /gradedTestSourceProblem\(test,/);
  // M85: the v2 candidate is re-checked under the v2 target; any other under v1 (opts undefined).
  // M88: v3 candidates arrive with v2 set and add the global Date (`dates: v3`); M90: v4 adds `v4`.
  assert.match(g, /existingTargetRefusal\(modPath, real, fn, v2 \? \{ v2: \{ read: \(rel\) => \(scope\.isSource\(rel\) && !scope\.isTest\(rel\) \? regular\(rel\) : null\) \}, dates: v3, v4(?:, v5)? \} : undefined\) !== null/);
  assert.match(g, /moduleReadClosure\(modPath, regular\)/);
  assert.match(g, /i < REAL_RUNS_REQUIRED; i\+\+\) if \(!runExistingTests\(tree, newTests, reads\)\.ok\)/);
  assert.match(g, /run = runExistingTests\(tree, newTests, reads, true\);/);
  const r = tc.slice(tc.indexOf("function runExistingTests("), tc.indexOf("function gradeExisting("));
  assert.match(r, /const args = \["--permission", /);
  assert.doesNotMatch(r, /allow-fs-write|allow-child-process|allow-addons|allow-wasi/);
  assert.match(g, /stubAll\(real, \[fn\], v2\)/);
  assert.match(g, /finally \{\n    writeFileSync\(file, real\);/);
  assert.match(g, /stubFailureCredited\(run\.out, run\.notes\)/);
  assert.match(tc, /candidate\.transformations\.includes\("LEARNED_TEST_EXISTING"\)\) result\.testGrading = gradeExisting\(/);
  const gen = read("peaceai/bin/generate.ts");
  assert.match(gen, /const existingTest = a\.spec\.kind === "TEST_EXISTING";/);
  assert.match(gen, /edit\.extra === undefined && edit\.fixSha === undefined && !baseFiles\.has\(edit\.path\) && scope\.isSource\(edit\.path\) && scope\.isTest\(edit\.path\)/);
});
test("stub: the tested function's body becomes the write-only type default", () => {
  const s = stubAll(MOD, ["isOutage"])!;
  assert.ok(s.content.includes('export function isOutage(message: string): boolean { __peaceaiStubRan(); return false; }'));
  assert.equal(s.throws, false);
});

// ---- protection, phrasing, nlparse ----
test("protected: the engine, spec, evidence, fixtures, learned spec, proposal record and these proofs", () => {
  for (const p of ["peaceai/lib/learned-test-existing.ts", "peaceai/spec/test-case-existing-v1.md", "peaceai/test/m80-test-case-existing.test.ts", "peaceai/rules/proposals/m80-test-case-existing-evidence.json", "peaceai/test/fixtures/m80/x.txt", "peaceai/rules/learned/public-test-case-existing-v1.json", "peaceai/rules/proposals/public-test-case-existing-v1.json", "peaceai/bin/test-candidates.ts", "peaceai/bin/generate.ts", "peaceai/lib/learned.ts"])
    assert.ok(PROTECTED_SELF.some((x) => x.pattern.test(p)), p);
});
test("phrasing and proposal body: the marker and spec block pin the exact hash; every refusal is named", () => {
  assert.match(phrasingFor(SPEC), /^add a characterization test for/);
  const body = proposalBody({ spec: SPEC, sha256: SHA, stats: { shape: "TEST_CASE_EXISTING" as never, covered: null, hunks: SPEC.evidence.hunks, commits: SPEC.evidence.commits, files: SPEC.evidence.files, examples: [], styles: {} } }, []);
  assert.deepEqual(parseMarker(body), { id: SPEC.id, sha256: SHA, source: "public" });
  assert.equal(specHash(parseSpecBlock(body) as RuleSpec), SHA);
  for (const r of [TEST_TARGET_ASYNC, TEST_TARGET_IO, TEST_TARGET_DATE_LOCAL, TEST_TARGET_IMPURE, SELF_PROTECTED_PATH]) assert.ok(body.includes(r), r);
  assert.match(body, /fix-free/);
});
test("nlparse: the phrase is canonical only when TEST_EXISTING is approved; RULE_NOT_APPROVED otherwise", () => {
  const body = task("isOutage", '- isOutage("MASSIVE_HTTP_503 x") is true');
  const p = (kinds: string[]) => parseTask({ title: "", body }, { model: null, approvedKinds: new Set(kinds) });
  const off = p(["ADD_TEST_CASE"]);
  assert.equal(off.status, "unsure"); if (off.status === "unsure") assert.equal(off.reason, "RULE_NOT_APPROVED");
  assert.equal(p(["TEST_EXISTING"]).status, "canonical");
});

// ---- evidence replay ----
type Ex = { repo: string; commit: string; parent: string; test: string; module: string; fn: string; framework: string; sha256: string; license: string; licenseSha256: string; fileBlob: string; fixture: string; signature: string; files: number };
const EV = JSON.parse(read("peaceai/rules/proposals/m80-test-case-existing-evidence.json")) as { bar: number; manifestSha256: string; examples: Ex[]; pins: { name: string; commit: string; spdx: string; classified: string; licenseFile: string }[]; peace: { repo: string; checkedAt: string; testOnlyCommits: number }[] };
const gitBlob = (b: Buffer) => createHash("sha1").update(`blob ${b.length}\0`).update(b).digest("hex");
test("evidence: bar met; every target module blob-pinned at the parent; the target analysis accepts every example", () => {
  assert.ok(EV.examples.length >= EV.bar && EV.bar >= 10);
  assert.equal(new Set(EV.examples.map((e) => `${e.repo}:${e.fn}`)).size, EV.examples.length);
  for (const e of EV.examples) {
    const b = readFileSync(resolve(root, e.fixture));
    assert.ok(b.length <= 65536, e.fixture);
    assert.equal(gitBlob(b), e.fileBlob, e.fixture);
    assert.equal(createHash("sha256").update(b).digest("hex"), e.sha256);
    assert.ok(e.fixture.endsWith(`${e.repo.replace("/", "__")}-${e.fileBlob.slice(0, 12)}.txt`));
    assert.match(e.commit, /^[0-9a-f]{40}$/); assert.match(e.parent, /^[0-9a-f]{40}$/);
    assert.match(e.test, /\.(?:test|spec)\.ts$/);
    assert.equal(existingTargetRefusal(e.module, b.toString("utf8"), e.fn), null, `${e.repo} ${e.fn}`);
    assert.match(e.signature, /^\(.*\): .+$/);
  }
});
test("evidence: permissive licenses by hash only; fixtures dir holds exactly the evidence fixtures", () => {
  for (const e of EV.examples) {
    const pin = EV.pins.find((p) => p.name === e.repo)!;
    assert.ok(pin, e.repo);
    assert.ok(["MIT", "Apache-2.0", "BSD-3-Clause", "ISC"].includes(pin.classified), `${e.repo}: ${pin.classified}`);
    assert.match(e.licenseSha256, /^[0-9a-f]{64}$/);
  }
  const listed = new Set(EV.examples.map((e) => e.fixture.split("/").pop()));
  const have = readdirSync(resolve(root, "peaceai/test/fixtures/m80"));
  for (const f of have) { assert.ok(listed.has(f), f); assert.ok(!/licen[cs]e/i.test(f)); }
  assert.equal(have.length, listed.size);
});
test("evidence: no overlap with the training corpus or the ext-manifest; Peace's public repos checked first and not counted", () => {
  const buf = readManifestBytes(resolve(root, "peaceai/model"), "ext-manifest");
  assert.equal(createHash("sha256").update(buf).digest("hex"), EV.manifestSha256);
  const repos = new Set<string>(); const shas = new Set<string>();
  for (const l of buf.toString("utf8").split("\n")) if (l.trim()) { const r = JSON.parse(l) as { repo?: string; sha256?: string }; if (r.repo) repos.add(r.repo); if (r.sha256) shas.add(r.sha256); }
  for (const r of (JSON.parse(read("peaceai/model/ext-corpus.json")) as { repos: { name: string }[] }).repos) repos.add(r.name);
  for (const e of EV.examples) { assert.ok(!repos.has(e.repo), e.repo); assert.ok(!shas.has(e.sha256), e.module); assert.ok(!e.repo.startsWith("PeaceG03/")); }
  assert.deepEqual(EV.peace.map((p) => p.repo).sort(), ["PeaceG03/PeaceAI-Workspace", "PeaceG03/PeaceSTOCKS"]);
  for (const p of EV.peace) assert.ok(repos.has(p.repo), `${p.repo} is in the corpus manifest`);
  const rec = JSON.parse(read("peaceai/rules/proposals/public-test-case-existing-v1.json")) as { status: string; learned: string; evidence: { examples: number; bar: number; repos: number; qualifies: boolean } };
  assert.match(rec.status, /^proposal-off/);
  assert.equal(rec.learned, "peaceai/rules/learned/public-test-case-existing-v1.json");
  assert.equal(rec.evidence.examples, EV.examples.length);
  assert.equal(rec.evidence.repos, new Set(EV.examples.map((e) => e.repo)).size);
  assert.ok(rec.evidence.examples >= rec.evidence.bar && rec.evidence.qualifies);
  assert.deepEqual(SPEC.evidence.repos, [...new Set(EV.examples.map((e) => e.repo))].sort());
});
