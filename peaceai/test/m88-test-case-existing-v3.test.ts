// M88 TEST_EXISTING v3 target (public-test-case-existing-v3): characterization tests for existing exported functions
// whose signatures use the global Date (parameters, returns, members), with Date literal arguments and expected
// values, and bounded objects nested inside array arguments (stress gap 1, also for v2). v1/v2 targets stay with
// v1/v2 (not_needed). Job B re-checks under v3 (v2 plus Date) and stubs with the v2 object-aware stub.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { admitRules } from "../lib/approved.ts";
import { applyRule, specHash, validateSpec, type RuleSpec } from "../lib/learned.ts";
import { gradedTestSourceProblem, stubAll } from "../lib/learned-function.ts";
import { ARGS_NESTED_OBJECTS, ARGS_PLAIN_DATA_V3, buildTestEdit } from "../lib/learned-test.ts";
import { existingTargetRefusal, TEST_EXISTING_TRIGGER, TEST_EXISTING_VOCAB, TEST_TARGET_DATE_LOCAL, TEST_TARGET_IMPURE, TEST_TARGET_SIGNATURE } from "../lib/learned-test-existing.ts";
import { readManifestBytes } from "../lib/manifestparts.ts";
import { phrasingFor } from "../lib/propose.ts";
import { PROTECTED_SELF } from "../lib/selfchange.ts";

const root = resolve(import.meta.dirname, "../..");
const read = (p: string) => readFileSync(resolve(root, p), "utf8");
const SPEC = JSON.parse(read("peaceai/rules/learned/public-test-case-existing-v3.json")) as RuleSpec;
const V1 = JSON.parse(read("peaceai/rules/learned/public-test-case-existing-v1.json")) as RuleSpec;
const V2 = JSON.parse(read("peaceai/rules/learned/public-test-case-existing-v2.json")) as RuleSpec;
const SHA = "b31df045b2de0fe7ce970f556de3c16fe14afce10a689905b172a053c68d3557";

const A = [
  "export interface Win { start: Date; end: Date; label: string }",
  "export interface Row { id: string; n: number }",
  "export function dayKey(d: Date): string {",
  "  return d.toISOString().slice(0, 10);",
  "}",
  "export function minuteOfDay(d: Date): number {",
  "  return d.getUTCHours() * 60 + d.getUTCMinutes();",
  "}",
  "export function addDays(d: Date, n: number): Date {",
  "  return new Date(d.getTime() + n * 86400000);",
  "}",
  "export function spanOf(start: Date, minutes: number): Win {",
  '  return { start, end: new Date(start.getTime() + minutes * 60000), label: "w" };',
  "}",
  "export function latest(ds: readonly Date[]): Date | undefined {",
  "  let best: Date | undefined;",
  "  for (const d of ds) if (!best || d.getTime() > best.getTime()) best = d;",
  "  return best;",
  "}",
  "export function localHour(d: Date): number { return d.getHours(); }",
  "export function nowKey(): string { return new Date().toISOString(); }",
  "export function bump(d: Date): number { d.setUTCDate(1); return d.getTime(); }",
  "export function withMap(m: Map<string, Date>): number { return m.size; }",
  "export function total(rows: readonly Row[]): number { let t = 0; for (const r of rows) t += r.n; return t; }",
  "export function plain(x: number): number { return x + 1; }",
  "",
].join("\n");
const FILES = [{ path: "src/a.ts", content: A }];
const v2 = { v2: { read: () => null } };
const v3 = { v2: { read: () => null }, dates: true };
const isTest = (p: string) => /\.test\.ts$/.test(p);
const run = (fn: string, checks: string, spec: RuleSpec = SPEC, files = FILES) => {
  const w: { reason?: string } = {};
  const e = applyRule(spec, `add a characterization test for ${fn} in src/a.ts\n${checks}`, files, isTest, undefined, w, () => false);
  return { e: e as { path: string; content: string } | null, r: w.reason };
};

test("spec: valid, hash pinned, v1 params except the target, the v1 trigger; any listed approval pins the exact hash", () => {
  assert.ok(validateSpec(SPEC));
  assert.equal(specHash(SPEC), SHA);
  assert.equal(SPEC.trigger, TEST_EXISTING_TRIGGER);
  assert.deepEqual(SPEC.params, { ...V1.params, target: "exported-pure-function-v3" });
  assert.deepEqual(V2.params, { ...V1.params, target: "exported-pure-function-v2" }, "v2 is unchanged");
  // M90 appends exported-pure-function-v4; the first three stay in place.
  assert.deepEqual([...TEST_EXISTING_VOCAB.target].slice(0, 3), ["exported-pure-function", "exported-pure-function-v2", "exported-pure-function-v3"]);
  assert.ok(!validateSpec({ ...SPEC, params: { ...SPEC.params, target: "any-function" } }));
  // Lesson (M85/M87): never assert the rule is absent from approved.json; any listed entry must pin this exact hash.
  const onMain = JSON.parse(read("peaceai/rules/approved.json")) as { rules: { id: string; sha256: string }[] };
  for (const r of onMain.rules.filter((x) => x.id === SPEC.id)) assert.equal(r.sha256, SHA, "a listed entry pins the exact spec hash");
  assert.match(phrasingFor(SPEC), /characteri[sz]ation/);
  for (const p of ["peaceai/rules/learned/public-test-case-existing-v3.json", "peaceai/rules/proposals/public-test-case-existing-v3.json", "peaceai/rules/proposals/m88-test-case-existing-v3-evidence.json", "peaceai/test/m88-test-case-existing-v3.test.ts", "peaceai/test/fixtures/m88-te3/x.txt", "peaceai/spec/test-case-existing-v3.md", "peaceai/lib/learned-test.ts", "peaceai/lib/learned-test-existing.ts", "peaceai/bin/test-candidates.ts"]) assert.ok(PROTECTED_SELF.some((x) => x.pattern.test(p)), p);
  const list = (sha: string) => ({ ok: true as const, list: { schema: "peaceai-approved-rules:v1", rules: [{ id: SPEC.id, sha256: sha, source: "workspace" }] } as never });
  assert.equal(admitRules([SPEC], list(SHA))[0]!.decision, "APPROVED");
  assert.equal(admitRules([SPEC], list("0".repeat(64)))[0]!.decision, "HASH_CHANGED");
});

test("internal args modes are not selectable by any spec's params", () => {
  const tc = JSON.parse(read("peaceai/rules/learned/public-test-case-objargs-v1.json")) as RuleSpec;
  assert.ok(validateSpec(tc));
  for (const args of [ARGS_PLAIN_DATA_V3, ARGS_NESTED_OBJECTS]) {
    assert.ok(!validateSpec({ ...tc, params: { ...tc.params, args } }), args);
    assert.ok(!validateSpec({ ...SPEC, params: { ...SPEC.params, args } } as RuleSpec), `${args} on v3`);
  }
});

test("target: the global Date passes under v3 only; v1 and v2 are unchanged", () => {
  for (const fn of ["dayKey", "minuteOfDay", "addDays", "spanOf"]) {
    assert.equal(existingTargetRefusal("src/a.ts", A, fn), TEST_TARGET_SIGNATURE, `v1 ${fn}`);
    assert.equal(existingTargetRefusal("src/a.ts", A, fn, v2), TEST_TARGET_SIGNATURE, `v2 ${fn}`);
    assert.equal(existingTargetRefusal("src/a.ts", A, fn, v3), null, `v3 ${fn}`);
  }
  assert.equal(existingTargetRefusal("src/a.ts", A, "latest", v3), null, "readonly Date[] and Date | undefined");
  assert.equal(existingTargetRefusal("src/a.ts", A, "plain", v3), null);
});

test("target negatives under v3: clock, local time, setters, Map, shadowed Date", () => {
  assert.equal(existingTargetRefusal("src/a.ts", A, "localHour", v3), TEST_TARGET_DATE_LOCAL);
  assert.equal(existingTargetRefusal("src/a.ts", A, "nowKey", v3), TEST_TARGET_DATE_LOCAL);
  assert.equal(existingTargetRefusal("src/a.ts", A, "bump", v3), TEST_TARGET_IMPURE);
  assert.equal(existingTargetRefusal("src/a.ts", A, "withMap", v3), TEST_TARGET_SIGNATURE);
  const shadows = [
    "class Date { n = 1 }\nexport function f(d: Date): number { return d.n; }\n",
    "interface Date { n: () => number }\nexport function f(d: Date): number { return d.n(); }\n",
    'import type { Date } from "./b";\nexport function f(d: Date): number { return 1; }\n',
    "const Date = 1;\nexport function f(d: Date): number { return 1; }\n",
  ];
  for (const src of shadows) assert.notEqual(existingTargetRefusal("src/a.ts", src, "f", v3), null, src.split("\n")[0]);
  const alias = "type Date = { n: number };\nexport function f(d: Date): number { return d.n; }\n";
  assert.equal(existingTargetRefusal("src/a.ts", alias, "f", v3), existingTargetRefusal("src/a.ts", alias, "f", v2), "a local alias named Date is the v2 alias, not the global");
  assert.equal(existingTargetRefusal("src/a.ts", "export function f(d: Date<string>): number { return 1; }\n", "f", v3), TEST_TARGET_SIGNATURE, "type arguments");
  const defaulted = "export function f(d: Date = new Date()): number { return d.getTime(); }\n";
  assert.notEqual(existingTargetRefusal("src/a.ts", defaulted, "f", v3), null, "a clock default stays refused");
});

test("Job A: Date arguments and Date expected values (also nested); not_needed for v1/v2 targets", () => {
  const k = run("dayKey", '- dayKey(new Date("2026-10-17T05:59:00Z")) is "2026-10-17"\n- dayKey(new Date("2024-02-29")) is "2024-02-29"');
  assert.ok(k.e, k.r);
  assert.match(k.e!.content, /assert\.equal\(dayKey\(new Date\("2026-10-17T05:59:00Z"\)\), "2026-10-17"\);/);
  assert.match(k.e!.content, /^import \{ dayKey \} from "\.\/a";$/m);
  const d = run("addDays", '- addDays(new Date("2026-10-17T00:00:00Z"), 2) is new Date("2026-10-19T00:00:00Z")');
  assert.ok(d.e, d.r);
  assert.match(d.e!.content, /assert\.deepEqual\(addDays\(new Date\("2026-10-17T00:00:00Z"\), 2\), new Date\("2026-10-19T00:00:00Z"\)\);/);
  const s = run("spanOf", '- spanOf(new Date("2026-10-17T10:00:00Z"), 30) is { start: new Date("2026-10-17T10:00:00Z"), end: new Date("2026-10-17T10:30:00Z"), label: "w" }');
  assert.ok(s.e, s.r);
  assert.match(s.e!.content, /assert\.deepEqual\(spanOf\(/);
  const l = run("latest", '- latest([new Date("2026-01-01"), new Date("2026-03-01")]) is new Date("2026-03-01")');
  assert.ok(l.e, l.r);
  assert.equal(run("plain", "- plain(1) is 2").r, "not_needed", "a v1 target");
  assert.equal(run("total", '- total([{ id: "a", n: 1 }]) is 1').r, "not_needed", "a v2 target");
  assert.equal(run("localHour", '- localHour(new Date("2026-10-17T10:00:00Z")) is 10').e, null);
});

test("Job A: Date literal bounds hold (no clock, no impossible dates, no computed arguments)", () => {
  for (const c of [
    "- dayKey(new Date()) is \"x\"",
    '- dayKey(new Date("2026-02-30")) is "2026-02-30"',
    '- dayKey(new Date("2026-10-17T25:00:00Z")) is "2026-10-17"',
    "- dayKey(new Date(0)) is \"1970-01-01\"",
    '- dayKey(new Date("Oct 17 2026")) is "2026-10-17"',
    '- dayKey(new Date(`2026-10-17`)) is "2026-10-17"',
    '- addDays(new Date("2026-10-17"), 1) is new Date()',
  ]) assert.equal(run(c.slice(2, c.indexOf("(")), c).e, null, c);
});

test("gap 1: objects nested inside array arguments, under v3 and v2, within the M20 bounds", () => {
  const rows = Array.from({ length: 6 }, (_, i) => `{ id: "row-${i}-abcdefghij", n: ${i + 1} }`).join(", ");
  const check = `- total([${rows}]) is 21`;
  assert.ok(check.length > 200, "past the plain 200-character limit");
  const w = run("total", check, V2);
  assert.ok(w.e, w.r);
  assert.match(w.e!.content, /assert\.equal\(total\(\[\{ id: "row-0-abcdefghij", n: 1 \}/);
  assert.equal(run("total", "- total([{ __proto__: { n: 1 } }]) is 1", V2).e, null, "objectArgsReason still applies");
  const deep = `- total([${"{ a: ".repeat(6)}1${" }".repeat(6)}]) is 1`;
  assert.equal(run("total", deep, V2).e, null, "depth bound still applies");
  const big = `- total([${Array.from({ length: 30 }, (_, i) => `{ id: "r${i}-abcdefghijklmnop", n: ${i} }`).join(", ")}]) is 1`;
  assert.ok(big.length > 600);
  assert.equal(run("total", big, V2).e, null, "the 600-character bound still applies");
  // The M20 object-literal mode keeps its direct-argument trigger: a nested-only task is not an M20 task.
  const t = { symbol: "total", file: "src/a.ts", fixSha: "a".repeat(40), checks: [{ kind: "equal" as const, expr: 'total([{ id: "a", n: 1 }])', value: "1" }] };
  const objParams = { assert: "node:assert/strict-default", checks: ["equal"], framework: "node:test-default", grading: "fail-before-pass-after", matcher: "regex", maxLines: "12", placement: "new-file" };
  assert.equal(buildTestEdit({ ...objParams, args: "object-literal" }, t as never, FILES, isTest), null);
  assert.ok(buildTestEdit({ ...objParams, args: ARGS_NESTED_OBJECTS }, t as never, FILES, isTest));
  assert.equal(buildTestEdit({ ...objParams, args: ARGS_NESTED_OBJECTS }, { ...t, checks: [{ kind: "equal" as const, expr: 'total([{ id: "a", n: 1 }], new Date("2026-01-01"))', value: "1" }] } as never, FILES, isTest), null, "no Dates in the v2 nested mode");
});

test("stub and Job B wiring: v3 candidates are re-checked with Date and stubbed by the v2 object-aware stub", () => {
  const st = stubAll(A, ["addDays"], true);
  assert.ok(st && !st.throws && /export function addDays\(d: Date, n: number\): Date \{ __peaceaiStubRan\(\); return \(\{\} as never\); \}/.test(st.content));
  const tc = read("peaceai/bin/test-candidates.ts");
  // M90: v4 candidates also set v2 and v3 (the v4 prefix follows the v3 prefix in both disjunctions).
  assert.match(tc, /candidate\.operationId\.startsWith\("learned:public-test-case-existing-v2@"\) \|\| candidate\.operationId\.startsWith\("learned:public-test-case-existing-v3@"\) \|\| candidate\.operationId\.startsWith\("learned:public-test-case-existing-v4@"\)(?: \|\| candidate\.operationId\.startsWith\("learned:public-test-case-existing-v5@"\))?\)/);
  assert.match(tc, /\(candidate\.operationId\.startsWith\("learned:public-test-case-existing-v3@"\) \|\| candidate\.operationId\.startsWith\("learned:public-test-case-existing-v4@"\)(?: \|\| candidate\.operationId\.startsWith\("learned:public-test-case-existing-v5@"\))?\),/);
  assert.match(tc, /dates: v3, v4(?:, v5)? \} : undefined\) !== null\) return ungradable\("not-test-only"\)/);
  assert.match(tc, /stubAll\(real, \[fn\], v2\)/);
});

test("graded test source: fixed Date literals only, and only for v3 grading", () => {
  const src = (body: string) => `import assert from "node:assert/strict";\nimport test from "node:test";\nimport { dayKey } from "./a";\n\ntest("t", () => {\n  ${body}\n});\n`;
  const ok = src('assert.equal(dayKey(new Date("2026-10-17T05:59:00Z")), "2026-10-17");');
  assert.equal(gradedTestSourceProblem(ok, ["./a", "./a.ts"], ["dayKey"], [], true), null);
  assert.notEqual(gradedTestSourceProblem(ok, ["./a", "./a.ts"], ["dayKey"], []), null, "v1/v2 grading still forbids Date");
  for (const body of [
    'assert.equal(dayKey(new Date()), "x");',
    'assert.equal(dayKey(new Date(0)), "x");',
    'assert.equal(dayKey(new Date("2026-02-30")), "x");',
    'assert.equal(dayKey(new Date(`2026-10-17`)), "x");',
    'assert.equal(String(Date.now()), "x");',
    'const D = Date; assert.equal(dayKey(new D("2026-10-17")), "x");',
    'assert.equal(dayKey(new Date("2026-10-17", "x")), "x");',
  ]) assert.notEqual(gradedTestSourceProblem(src(body), ["./a", "./a.ts"], ["dayKey"], [], true), null, body);
  assert.match(read("peaceai/bin/test-candidates.ts"), /gradedTestSourceProblem\(test, \[spec, `\$\{spec\}\.ts`\], declaredFunctions\(real\), moduleDataKeys\(real\), v3\)/);
});

// ---- mined evidence ----
type Pin = { path: string; fileBlob: string; sha256: string; fixture: string; repo: string; commit: string };
type Ex = Pin & { module: string; fn: string; signature: string; v1Refusal: string; v2Refusal: string; siblings: Pin[]; license: string; licenseSha256: string };
const EV = JSON.parse(read("peaceai/rules/proposals/m88-test-case-existing-v3-evidence.json")) as { bar: number; manifestSha256: string; examples: Ex[]; peace: { repo: string; checkedAt: string; counted: number }[] };
const gitBlob = (b: Buffer) => createHash("sha1").update(`blob ${b.length}\0`).update(b).digest("hex");
const pinned = (p: { fixture: string; fileBlob: string; sha256: string }) => {
  const b = readFileSync(resolve(root, p.fixture));
  assert.ok(b.length <= 65536, p.fixture);
  assert.equal(gitBlob(b), p.fileBlob, p.fixture);
  assert.equal(createHash("sha256").update(b).digest("hex"), p.sha256, p.fixture);
  return b.toString("utf8");
};
test("evidence: bar met; every module and sibling blob-pinned; v1 and v2 refuse and v3 accepts each on the pinned text", () => {
  assert.ok(EV.examples.length >= EV.bar && EV.bar >= 10);
  assert.equal(new Set(EV.examples.map((e) => `${e.repo}\0${e.module}\0${e.fn}`)).size, EV.examples.length);
  const perRepo = new Map<string, number>();
  for (const e of EV.examples) perRepo.set(e.repo, (perRepo.get(e.repo) ?? 0) + 1);
  assert.ok([...perRepo.values()].every((n) => n <= 3), "at most 3 per repo");
  for (const e of EV.examples) {
    const text = pinned(e);
    const sibs = new Map(e.siblings.map((s) => [s.path, pinned(s)]));
    const rd = { read: (rel: string) => sibs.get(rel) ?? null };
    assert.equal(existingTargetRefusal(e.module, text, e.fn), e.v1Refusal, `${e.repo} ${e.fn} v1`);
    assert.equal(existingTargetRefusal(e.module, text, e.fn, { v2: rd }), e.v2Refusal, `${e.repo} ${e.fn} v2`);
    assert.notEqual(e.v2Refusal, null);
    assert.equal(existingTargetRefusal(e.module, text, e.fn, { v2: rd, dates: true }), null, `${e.repo} ${e.fn} v3`);
    // v3 differs from v2 only by the global Date, so a v2 refusal that v3 lifts is a Date in the signature's types.
    assert.ok(/\bDate\b/.test(e.signature) || /\bDate\b/.test(text) || [...sibs.values()].some((t) => /\bDate\b/.test(t)), `${e.fn}: Date in the signature or a followed type`);
  }
});
test("evidence: licenses by hash in THIRD_PARTY_NOTICES; fixtures dir holds exactly the evidence fixtures", () => {
  const notices = read("THIRD_PARTY_NOTICES");
  const listed = new Set<string>();
  for (const e of EV.examples) {
    assert.ok(["MIT", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "ISC"].includes(e.license), e.repo);
    assert.ok(notices.includes(`repo: ${e.repo}\nlicense: ${e.license} (`) && notices.includes(`sha256 of trimmed text ${e.licenseSha256})`), e.repo);
    for (const p of [e, ...e.siblings]) { assert.ok(notices.includes(` ${p.fixture}\n`), p.fixture); listed.add(p.fixture.split("/").pop()!); }
  }
  const have = readdirSync(resolve(root, "peaceai/test/fixtures/m88-te3"));
  for (const f of have) assert.ok(listed.has(f), f);
  assert.equal(have.length, listed.size);
});
test("evidence: no overlap with the training corpus or the ext-manifest; Peace's repos checked first and not counted", () => {
  const buf = readManifestBytes(resolve(root, "peaceai/model"), "ext-manifest");
  assert.equal(createHash("sha256").update(buf).digest("hex"), EV.manifestSha256);
  const repos = new Set<string>(); const shas = new Set<string>();
  for (const l of buf.toString("utf8").split("\n")) if (l.trim()) { const r = JSON.parse(l) as { repo?: string; sha256?: string }; if (r.repo) repos.add(r.repo); if (r.sha256) shas.add(r.sha256); }
  for (const r of (JSON.parse(read("peaceai/model/ext-corpus.json")) as { repos: { name: string }[] }).repos) repos.add(r.name);
  for (const e of EV.examples) { assert.ok(!repos.has(e.repo), e.repo); for (const p of [e, ...e.siblings]) assert.ok(!shas.has(p.sha256), p.fixture); assert.ok(!e.repo.startsWith("PeaceG03/")); }
  for (const p of EV.peace) { assert.ok(repos.has(p.repo)); assert.equal(p.counted, 0); assert.match(p.checkedAt, /^[0-9a-f]{40}$/); }
  const rec = JSON.parse(read("peaceai/rules/proposals/public-test-case-existing-v3.json")) as { status: string; evidence: { examples: number; repos: number; bar: number; qualifies: boolean } };
  assert.match(rec.status, /^proposal-off/);
  assert.equal(rec.evidence.examples, EV.examples.length);
  assert.equal(rec.evidence.repos, new Set(EV.examples.map((e) => e.repo)).size);
  assert.ok(rec.evidence.qualifies && rec.evidence.examples >= rec.evidence.bar);
  assert.deepEqual(SPEC.evidence.repos, [...new Set(EV.examples.map((e) => e.repo))].sort());
});
