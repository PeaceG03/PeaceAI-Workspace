// M90 TEST_EXISTING v4 target (public-test-case-existing-v4): characterization tests for existing exported functions
// whose signatures use optional / literal-default parameters, the built-in plain-data generic references (Array,
// ReadonlyArray, Readonly, Partial, Record, Pick, Omit) or deeper / wider plain-data types than v1-v3 allow. v1-v3
// targets stay with v1-v3 (not_needed). Job B re-checks under v4 and stubs with the v2 object-aware stub.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { admitRules } from "../lib/approved.ts";
import { applyRule, specHash, validateSpec, type RuleSpec } from "../lib/learned.ts";
import { stubAll } from "../lib/learned-function.ts";
import { existingTargetRefusal, MAX_TYPE_DEPTH_V4, MAX_TYPE_MEMBERS_V4, TEST_EXISTING_TRIGGER, TEST_EXISTING_VOCAB, TEST_TARGET_DATE_LOCAL, TEST_TARGET_IMPURE, TEST_TARGET_SIGNATURE, V4_GENERICS } from "../lib/learned-test-existing.ts";
import { readManifestBytes } from "../lib/manifestparts.ts";
import { phrasingFor } from "../lib/propose.ts";
import { PROTECTED_SELF } from "../lib/selfchange.ts";

const root = resolve(import.meta.dirname, "../..");
const read = (p: string) => readFileSync(resolve(root, p), "utf8");
const SPEC = JSON.parse(read("peaceai/rules/learned/public-test-case-existing-v4.json")) as RuleSpec;
const V1 = JSON.parse(read("peaceai/rules/learned/public-test-case-existing-v1.json")) as RuleSpec;
const V3 = JSON.parse(read("peaceai/rules/learned/public-test-case-existing-v3.json")) as RuleSpec;
const SHA = "7829c9803cdab076e821f0400216bb5f7791c521a251ce6b97d32695dac37ddc";

const nest = (d: number) => `${"{ a: ".repeat(d)}number${" }".repeat(d)}`;
const wide = (n: number) => `{ ${Array.from({ length: n }, (_, i) => `k${i}: number`).join("; ")} }`;
const A = [
  "export interface Cfg { base: number; max: number; label: string }",
  "export interface Row { id: string; n: number }",
  "export function scale(n: number, by = 2): number { return n * by; }",
  'export function greet(name: string, greeting: string = "hi"): string { return `${greeting} ${name}`; }',
  "export function suffix(s: string, tail?: string): string { return tail === undefined ? s : s + tail; }",
  "export function neg(n: number, d = -1): number { return n * d; }",
  "export function flag(b = false): boolean { return !b; }",
  "export function sum(xs: Array<number>): number { let t = 0; for (const x of xs) t += x; return t; }",
  "export function first(xs: ReadonlyArray<Row>): string { return xs.length ? xs[0]!.id : \"\"; }",
  "export function fill(p: Partial<Cfg>): Cfg { return { base: p.base ?? 1, max: p.max ?? 10, label: p.label ?? \"x\" }; }",
  "export function frozen(c: Readonly<Cfg>): number { return c.base + c.max; }",
  "export function counts(xs: readonly string[]): Record<string, number> { const o: Record<string, number> = {}; for (const x of xs) o[x] = (o[x] ?? 0) + 1; return o; }",
  'export function pickBase(c: Pick<Cfg, "base" | "max">): number { return c.base * c.max; }',
  'export function omitLabel(c: Omit<Cfg, "label">): number { return c.base - c.max; }',
  'export function lit(r: Record<"a" | "b", number>): number { return r.a + r.b; }',
  `export function deep5(x: ${nest(5)}): number { return 1; }`,
  `export function wide20(x: ${wide(20)}): number { return x.k0; }`,
  "export function plain(x: number): number { return x + 1; }",
  "export function total(rows: readonly Row[]): number { let t = 0; for (const r of rows) t += r.n; return t; }",
  "export function day(d: Date): number { return d.getTime(); }",
  // negatives
  "export function withMap(m: Map<string, number>): number { return m.size; }",
  "export function withSet(s: Set<string>): number { return s.size; }",
  "export function bytes(b: Uint8Array): number { return b.length; }",
  "export function clockDefault(d: Date = new Date()): number { return d.getTime(); }",
  "export function nowDefault(t: number = Date.now()): number { return t; }",
  "let counter = 0;",
  "export function impureDefault(n: number = counter++): number { return n; }",
  "export const START = 5;",
  "export function untypedConst(n = START): number { return n; }",
  "export function both(n?: number = 1): number { return n ?? 0; }",
  "export function unk(x: unknown): number { return 1; }",
  "export function inter(x: Cfg & Row): number { return x.n; }",
  "export function recKey(r: Record<Row, number>): number { return 1; }",
  "export function promiseLike(x: Partial<Promise<number>>): number { return 1; }",
  "export function arr2(xs: Array<number, string>): number { return 1; }",
  "export function readArr(xs: Readonly<number[]>): number { return xs.length; }",
  "export function fnArg(f: Partial<() => number>): number { return 1; }",
  `export function deep8(x: ${nest(8)}): number { return 1; }`,
  `export function wide40(x: ${wide(40)}): number { return x.k0; }`,
  "",
].join("\n");
const FILES = [{ path: "src/a.ts", content: A }];
const v2 = { v2: { read: () => null } };
const v3 = { v2: { read: () => null }, dates: true };
const v4 = { v2: { read: () => null }, dates: true, v4: true };
const isTest = (p: string) => /\.test\.ts$/.test(p);
const run = (fn: string, checks: string, spec: RuleSpec = SPEC, files = FILES) => {
  const w: { reason?: string } = {};
  const e = applyRule(spec, `add a characterization test for ${fn} in src/a.ts\n${checks}`, files, isTest, undefined, w, () => false);
  return { e: e as { path: string; content: string } | null, r: w.reason };
};

test("spec: valid, hash pinned, v3 params except the target, the v1 trigger; any listed approval pins the exact hash", () => {
  assert.ok(validateSpec(SPEC));
  assert.equal(specHash(SPEC), SHA);
  assert.equal(SPEC.trigger, TEST_EXISTING_TRIGGER);
  assert.deepEqual(SPEC.params, { ...V1.params, target: "exported-pure-function-v4" });
  assert.deepEqual(V3.params, { ...V1.params, target: "exported-pure-function-v3" }, "v3 is unchanged");
  assert.equal(specHash(V3), "b31df045b2de0fe7ce970f556de3c16fe14afce10a689905b172a053c68d3557", "the v3 hash is unchanged");
  // M91: v5 appends one more target; the v1-v4 entries and their order are unchanged.
  assert.deepEqual([...TEST_EXISTING_VOCAB.target].slice(0, 4), ["exported-pure-function", "exported-pure-function-v2", "exported-pure-function-v3", "exported-pure-function-v4"]);
  assert.ok(!validateSpec({ ...SPEC, params: { ...SPEC.params, target: "exported-pure-function-v6" } }));
  // Lesson (M85/M87/M88): never assert the rule is absent from approved.json; any listed entry must pin this exact hash.
  const onMain = JSON.parse(read("peaceai/rules/approved.json")) as { rules: { id: string; sha256: string }[] };
  for (const r of onMain.rules.filter((x) => x.id === SPEC.id)) assert.equal(r.sha256, SHA, "a listed entry pins the exact spec hash");
  assert.match(phrasingFor(SPEC), /characteri[sz]ation/);
  for (const p of ["peaceai/rules/learned/public-test-case-existing-v4.json", "peaceai/rules/proposals/public-test-case-existing-v4.json", "peaceai/rules/proposals/m90-test-case-existing-v4-evidence.json", "peaceai/test/m90-test-case-existing-v4.test.ts", "peaceai/test/fixtures/m90-te4/x.txt", "peaceai/spec/test-case-existing-v4.md", "peaceai/lib/learned-test.ts", "peaceai/lib/learned-test-existing.ts", "peaceai/bin/test-candidates.ts"]) assert.ok(PROTECTED_SELF.some((x) => x.pattern.test(p)), p);
  const list = (sha: string) => ({ ok: true as const, list: { schema: "peaceai-approved-rules:v1", rules: [{ id: SPEC.id, sha256: sha, source: "workspace" }] } as never });
  assert.equal(admitRules([SPEC], list(SHA))[0]!.decision, "APPROVED");
  assert.equal(admitRules([SPEC], list("0".repeat(64)))[0]!.decision, "HASH_CHANGED");
});

test("target: the v4 widenings pass under v4 only; v1-v3 still refuse them", () => {
  assert.equal(MAX_TYPE_DEPTH_V4, 6);
  assert.equal(MAX_TYPE_MEMBERS_V4, 32);
  assert.deepEqual([...V4_GENERICS].sort(), ["Array", "Omit", "Partial", "Pick", "Readonly", "ReadonlyArray", "Record"]);
  for (const fn of ["scale", "greet", "suffix", "neg", "flag", "sum", "first", "fill", "frozen", "counts", "pickBase", "omitLabel", "lit", "deep5", "wide20"]) {
    assert.equal(existingTargetRefusal("src/a.ts", A, fn, v4), null, `v4 ${fn}`);
    assert.equal(existingTargetRefusal("src/a.ts", A, fn, v3), TEST_TARGET_SIGNATURE, `v3 ${fn}`);
    assert.equal(existingTargetRefusal("src/a.ts", A, fn, v2), TEST_TARGET_SIGNATURE, `v2 ${fn}`);
    assert.equal(existingTargetRefusal("src/a.ts", A, fn), TEST_TARGET_SIGNATURE, `v1 ${fn}`);
  }
  for (const fn of ["plain", "total", "day"]) assert.equal(existingTargetRefusal("src/a.ts", A, fn, v4), null, `v4 keeps ${fn}`);
  assert.equal(existingTargetRefusal("src/a.ts", A, "plain"), null);
  assert.equal(existingTargetRefusal("src/a.ts", A, "total", v2), null);
  assert.equal(existingTargetRefusal("src/a.ts", A, "day", v3), null);
});

test("target negatives under v4: Map/Set, bytes, clock and impure defaults, untyped non-literal defaults, ? with a default, unknown, intersections, other generics, bounds", () => {
  for (const fn of ["withMap", "withSet", "bytes", "untypedConst", "both", "unk", "inter", "recKey", "promiseLike", "arr2", "readArr", "fnArg", "deep8", "wide40"])
    assert.equal(existingTargetRefusal("src/a.ts", A, fn, v4), TEST_TARGET_SIGNATURE, fn);
  assert.equal(existingTargetRefusal("src/a.ts", A, "clockDefault", v4), TEST_TARGET_DATE_LOCAL);
  assert.equal(existingTargetRefusal("src/a.ts", A, "nowDefault", v4), TEST_TARGET_DATE_LOCAL);
  assert.equal(existingTargetRefusal("src/a.ts", A, "impureDefault", v4), TEST_TARGET_IMPURE);
  // Shadowed generic names are not the built-ins.
  const shadows = [
    "type Partial<T> = { f: () => T };\ninterface O { a: number }\nexport function f(x: Partial<O>): number { return 1; }\n",
    'import type { Record } from "./b";\nexport function f(x: Record<string, number>): number { return 1; }\n',
    "class Array<T> { v!: T }\nexport function f(x: Array<number>): number { return 1; }\n",
    "const Pick = 1;\ninterface O { a: number }\nexport function f(x: Pick<O, \"a\">): number { return 1; }\n",
  ];
  for (const src of shadows) assert.notEqual(existingTargetRefusal("src/a.ts", src, "f", v4), null, src.split("\n")[0]);
  // A method interface (class-like) stays refused, also behind Partial / Readonly / Pick.
  const meth = "interface Cal { open(d: string): boolean; tz: string }\n";
  for (const t of ["Cal", "Partial<Cal>", "Readonly<Cal>", 'Pick<Cal, "tz">', "Record<string, Cal>"])
    assert.equal(existingTargetRefusal("src/a.ts", `${meth}export function f(c: ${t}, n = 1): number { return n; }\n`, "f", v4), TEST_TARGET_SIGNATURE, t);
  // The plain object type behind a default may not hide a method either.
  assert.equal(existingTargetRefusal("src/a.ts", `${meth}export function f(n: number, c: Cal = { tz: "x", open: () => true }): number { return n; }\n`, "f", v4), TEST_TARGET_SIGNATURE);
  // A default that calls an impure helper stays refused; a pure helper is fine.
  assert.notEqual(existingTargetRefusal("src/a.ts", "let k = 0;\nfunction bump(): number { return k++; }\nexport function f(n: number = bump()): number { return n; }\n", "f", v4), null);
  assert.equal(existingTargetRefusal("src/a.ts", "function two(): number { return 2; }\nexport function f(n: number = two()): number { return n; }\n", "f", v4), null);
});

test("parameter defaults are walked for every target: a followed helper's impure default is refused under v1-v3 too", () => {
  const src = "let k = 0;\nfunction helper(n: number = k++): number { return n; }\nexport function f(x: number): number { return helper(x); }\n";
  for (const o of [undefined, v2, v3, v4]) assert.equal(existingTargetRefusal("src/a.ts", src, "f", o), TEST_TARGET_IMPURE, JSON.stringify(o ?? "v1"));
  const ok = "function helper(n: number, d = 2): number { return n * d; }\nexport function f(x: number): number { return helper(x); }\n";
  for (const o of [undefined, v2, v3, v4]) assert.equal(existingTargetRefusal("src/a.ts", ok, "f", o), null, JSON.stringify(o ?? "v1"));
});

test("Job A: optional / defaulted arguments may be omitted; generic and wide objects; not_needed for v1/v2/v3 targets", () => {
  const s = run("scale", "- scale(3) is 6\n- scale(3, 3) is 9");
  assert.ok(s.e, s.r);
  assert.match(s.e!.content, /assert\.equal\(scale\(3\), 6\);/);
  assert.match(s.e!.content, /^import \{ scale \} from "\.\/a";$/m);
  const g = run("suffix", '- suffix("a") is "a"\n- suffix("a", "b") is "ab"');
  assert.ok(g.e, g.r);
  const f = run("fill", '- fill({ base: 2 }) is { base: 2, max: 10, label: "x" }');
  assert.ok(f.e, f.r);
  assert.match(f.e!.content, /assert\.deepEqual\(fill\(\{ base: 2 \}\), \{ base: 2, max: 10, label: "x" \}\);/);
  const c = run("counts", '- counts(["a", "b", "a"]) is { a: 2, b: 1 }');
  assert.ok(c.e, c.r);
  const p = run("pickBase", "- pickBase({ base: 2, max: 3 }) is 6");
  assert.ok(p.e, p.r);
  const fr = run("first", '- first([{ id: "x", n: 1 }]) is "x"');
  assert.ok(fr.e, fr.r);
  assert.equal(run("plain", "- plain(1) is 2").r, "not_needed", "a v1 target");
  assert.equal(run("total", '- total([{ id: "a", n: 1 }]) is 1').r, "not_needed", "a v2 target");
  assert.equal(run("day", '- day(new Date("2026-01-01T00:00:00Z")) is 1767225600000').r, "not_needed", "a v3 target");
  assert.equal(run("withMap", "- withMap(1) is 1").e, null);
  assert.equal(run("clockDefault", "- clockDefault() is 1").r, TEST_TARGET_DATE_LOCAL);
  // v3 still refuses the v4 targets by name.
  assert.equal(run("scale", "- scale(3) is 6", V3).r, TEST_TARGET_SIGNATURE);
});

test("stub and Job B wiring: v4 candidates are re-checked under v4 (with v2 and v3 set) and stubbed by the v2 object-aware stub", () => {
  const st = stubAll(A, ["fill"], true);
  assert.ok(st && !st.throws && /export function fill\(p: Partial<Cfg>\): Cfg \{ __peaceaiStubRan\(\); return \(\{\} as never\); \}/.test(st.content));
  const tc = read("peaceai/bin/test-candidates.ts");
  assert.match(tc, /function gradeExisting\([^)]*v2 = false, v3 = false, v4 = false(?:, v5 = false)?\): TestGrading/);
  // M91: v5 candidates set v4 too.
  assert.match(tc, /typeof candidate\.operationId === "string" && \(candidate\.operationId\.startsWith\("learned:public-test-case-existing-v4@"\) \|\| candidate\.operationId\.startsWith\("learned:public-test-case-existing-v5@"\)\),/);
  assert.match(tc, /dates: v3, v4(?:, v5)? \} : undefined\) !== null\) return ungradable\("not-test-only"\)/);
  assert.match(tc, /stubAll\(real, \[fn\], v2\)/);
  assert.match(tc, /gradedTestSourceProblem\(test, \[spec, `\$\{spec\}\.ts`\], declaredFunctions\(real\), moduleDataKeys\(real\), v3\)/);
});

// ---- mined evidence ----
type Pin = { path: string; fileBlob: string; sha256: string; fixture: string; repo: string; commit: string };
type Ex = Pin & { module: string; fn: string; signature: string; v1Refusal: string; v2Refusal: string; v3Refusal: string; siblings: Pin[]; license: string; licenseSha256: string };
const EV = JSON.parse(read("peaceai/rules/proposals/m90-test-case-existing-v4-evidence.json")) as { bar: number; manifestSha256: string; examples: Ex[]; peace: { repo: string; checkedAt: string; counted: number }[] };
const gitBlob = (b: Buffer) => createHash("sha1").update(`blob ${b.length}\0`).update(b).digest("hex");
const pinned = (p: { fixture: string; fileBlob: string; sha256: string }) => {
  const b = readFileSync(resolve(root, p.fixture));
  assert.ok(b.length <= 65536, p.fixture);
  assert.equal(gitBlob(b), p.fileBlob, p.fixture);
  assert.equal(createHash("sha256").update(b).digest("hex"), p.sha256, p.fixture);
  return b.toString("utf8");
};
test("evidence: bar met; every module and sibling blob-pinned; v1-v3 refuse and v4 accepts each on the pinned text", () => {
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
    assert.equal(existingTargetRefusal(e.module, text, e.fn, { v2: rd, dates: true }), e.v3Refusal, `${e.repo} ${e.fn} v3`);
    assert.notEqual(e.v3Refusal, null);
    assert.equal(existingTargetRefusal(e.module, text, e.fn, { v2: rd, dates: true, v4: true }), null, `${e.repo} ${e.fn} v4`);
    // v4 differs from v3 only by optional / default parameters, the V4_GENERICS and the wider bounds.
    assert.ok(/\?|=|\b(?:Array|ReadonlyArray|Readonly|Partial|Record|Pick|Omit)</.test(e.signature) || e.siblings.length > 0 || /\{/.test(e.signature), `${e.fn}: a v4 widening in the signature or a followed type`);
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
  const have = readdirSync(resolve(root, "peaceai/test/fixtures/m90-te4"));
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
  const rec = JSON.parse(read("peaceai/rules/proposals/public-test-case-existing-v4.json")) as { status: string; evidence: { examples: number; repos: number; bar: number; qualifies: boolean } };
  assert.match(rec.status, /^proposal-off/);
  assert.equal(rec.evidence.examples, EV.examples.length);
  assert.equal(rec.evidence.repos, new Set(EV.examples.map((e) => e.repo)).size);
  assert.ok(rec.evidence.qualifies && rec.evidence.examples >= rec.evidence.bar);
  assert.deepEqual(SPEC.evidence.repos, [...new Set(EV.examples.map((e) => e.repo))].sort());
});
