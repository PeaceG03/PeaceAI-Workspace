// M91 TEST_EXISTING v5 target (public-test-case-existing-v5): characterization tests for existing exported functions
// whose signatures use `typeof N` of a literal const or `T["k"]` property lookups on a plain object type. v1-v4
// targets stay with v1-v4 (not_needed). Job B re-checks under v5 and stubs with the v2 object-aware stub.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { admitRules } from "../lib/approved.ts";
import { applyRule, specHash, validateSpec, type RuleSpec } from "../lib/learned.ts";
import { stubAll } from "../lib/learned-function.ts";
import { existingTargetRefusal, TEST_EXISTING_TRIGGER, TEST_EXISTING_VOCAB, TEST_TARGET_SIGNATURE } from "../lib/learned-test-existing.ts";
import { readManifestBytes } from "../lib/manifestparts.ts";
import { phrasingFor } from "../lib/propose.ts";
import { PROTECTED_SELF } from "../lib/selfchange.ts";

const root = resolve(import.meta.dirname, "../..");
const read = (p: string) => readFileSync(resolve(root, p), "utf8");
const SPEC = JSON.parse(read("peaceai/rules/learned/public-test-case-existing-v5.json")) as RuleSpec;
const V1 = JSON.parse(read("peaceai/rules/learned/public-test-case-existing-v1.json")) as RuleSpec;
const V4 = JSON.parse(read("peaceai/rules/learned/public-test-case-existing-v4.json")) as RuleSpec;
const SHA = "ad677b3667432177ebdc221fe74160bb590e074c5d7768d840119505c9fe5bab";

const A = [
  'export const KIND = "row" as const;',
  "const N = 3;",
  "export const LIMIT: number = 5;",
  "const NEG = -1;",
  "const ON = (true);",
  "export interface R { status: \"ok\" | \"bad\"; n: number; tags: string[] }",
  "type Q = { mode: \"a\" | \"b\" };",
  "export function kindOf(k: typeof KIND): string { return k; }",
  "export function nOf(n: typeof N): number { return n + 1; }",
  "export function limit(n: typeof LIMIT): number { return n; }",
  "export function neg(n: typeof NEG, b: typeof ON): number { return b ? n : 0; }",
  'export function isOk(s: R["status"]): boolean { return s === "ok"; }',
  'export function count(t: R["tags"]): R["n"] { return t.length; }',
  'export function modeOf(q: Q): Q["mode"] { return q.mode; }',
  'export function lit(x: { a: number }["a"]): number { return x * 2; }',
  "export function plain(x: number): number { return x + 1; }",
  "export function scale(n: number, by = 2): number { return n * by; }",
  // negatives
  'let L = "x";',
  "function g(): number { return 1; }",
  "const O = { a: 1 };",
  'const ARR = ["a", "b"] as const;',
  "const x = 1;",
  "interface M { f(): void; k: string }",
  "interface P { a?: number }",
  "interface Big extends R { z: number }",
  "export function letType(s: typeof L): string { return s; }",
  "export function fnType(f: typeof g): number { return 1; }",
  "export function objType(o: typeof O): number { return o.a; }",
  "export function arrType(a: typeof ARR): number { return a.length; }",
  "export function globalType(f: typeof fetch): number { return 1; }",
  "export function paramType(x: string, y: typeof x): string { return y; }",
  'export function missing(s: R["nope"]): number { return 1; }',
  'export function keyed(s: R[keyof R]): number { return 1; }',
  'export function union(s: R["n" | "status"]): number { return 1; }',
  'export function method(s: M["k"]): number { return 1; }',
  'export function optional(s: P["a"]): number { return 1; }',
  'export function heritage(s: Big["z"]): number { return 1; }',
  'export function numKey(s: string[][0]): number { return 1; }',
  "",
].join("\n");
const B = 'export const MARK = "m" as const;\nexport interface S { a: string; b: number }\nexport let MUT = 1;\n';
const AI = [
  'import { MARK, MUT, type S } from "./b";',
  "export function mark(m: typeof MARK): string { return m; }",
  'export function sa(s: S["a"]): string { return s; }',
  "export function mut(m: typeof MUT): number { return m; }",
  "",
].join("\n");
const FILES = [{ path: "src/a.ts", content: A }, { path: "src/i.ts", content: AI }, { path: "src/b.ts", content: B }];
const rd = { read: (rel: string) => FILES.find((f) => f.path === rel)?.content ?? null };
const v2 = { v2: rd };
const v3 = { v2: rd, dates: true };
const v4 = { v2: rd, dates: true, v4: true };
const v5 = { v2: rd, dates: true, v4: true, v5: true };
const isTest = (p: string) => /\.test\.ts$/.test(p);
const run = (fn: string, checks: string, spec: RuleSpec = SPEC, file = "src/a.ts") => {
  const w: { reason?: string } = {};
  const e = applyRule(spec, `add a characterization test for ${fn} in ${file}\n${checks}`, FILES, isTest, undefined, w, () => false);
  return { e: e as { path: string; content: string } | null, r: w.reason };
};

test("spec: valid, hash pinned, v4 params except the target, the v1 trigger; any listed approval pins the exact hash", () => {
  assert.ok(validateSpec(SPEC));
  assert.equal(specHash(SPEC), SHA);
  assert.equal(SPEC.trigger, TEST_EXISTING_TRIGGER);
  assert.deepEqual(SPEC.params, { ...V1.params, target: "exported-pure-function-v5" });
  assert.deepEqual(V4.params, { ...V1.params, target: "exported-pure-function-v4" }, "v4 is unchanged");
  assert.equal(specHash(V4), "7829c9803cdab076e821f0400216bb5f7791c521a251ce6b97d32695dac37ddc", "the v4 hash is unchanged");
  assert.deepEqual([...TEST_EXISTING_VOCAB.target], ["exported-pure-function", "exported-pure-function-v2", "exported-pure-function-v3", "exported-pure-function-v4", "exported-pure-function-v5"]);
  assert.ok(!validateSpec({ ...SPEC, params: { ...SPEC.params, target: "exported-pure-function-v6" } }));
  // Lesson (M85/M87/M88/M90): never assert the rule is absent from approved.json; any listed entry must pin this exact hash.
  const onMain = JSON.parse(read("peaceai/rules/approved.json")) as { rules: { id: string; sha256: string }[] };
  for (const r of onMain.rules.filter((x) => x.id === SPEC.id)) assert.equal(r.sha256, SHA, "a listed entry pins the exact spec hash");
  assert.match(phrasingFor(SPEC), /characteri[sz]ation/);
  for (const p of ["peaceai/rules/learned/public-test-case-existing-v5.json", "peaceai/rules/proposals/public-test-case-existing-v5.json", "peaceai/rules/proposals/m91-test-case-existing-v5-evidence.json", "peaceai/test/m91-test-case-existing-v5.test.ts", "peaceai/test/fixtures/m91-te5/x.txt", "peaceai/spec/test-case-existing-v5.md", "peaceai/lib/learned-test-existing.ts", "peaceai/bin/test-candidates.ts"]) assert.ok(PROTECTED_SELF.some((x) => x.pattern.test(p)), p);
  const list = (sha: string) => ({ ok: true as const, list: { schema: "peaceai-approved-rules:v1", rules: [{ id: SPEC.id, sha256: sha, source: "workspace" }] } as never });
  assert.equal(admitRules([SPEC], list(SHA))[0]!.decision, "APPROVED");
  assert.equal(admitRules([SPEC], list("0".repeat(64)))[0]!.decision, "HASH_CHANGED");
});

test("target: literal-const typeof and string-literal property lookups pass under v5 only; v1-v4 still refuse them", () => {
  const pos: [string, string][] = [["src/a.ts", "kindOf"], ["src/a.ts", "nOf"], ["src/a.ts", "limit"], ["src/a.ts", "neg"], ["src/a.ts", "isOk"], ["src/a.ts", "count"], ["src/a.ts", "modeOf"], ["src/a.ts", "lit"], ["src/i.ts", "mark"], ["src/i.ts", "sa"]];
  for (const [f, fn] of pos) {
    const c = rd.read(f)!;
    assert.equal(existingTargetRefusal(f, c, fn, v5), null, `v5 ${fn}`);
    for (const [n, o] of [["v4", v4], ["v3", v3], ["v2", v2]] as const) assert.equal(existingTargetRefusal(f, c, fn, o), TEST_TARGET_SIGNATURE, `${n} ${fn}`);
    assert.equal(existingTargetRefusal(f, c, fn), TEST_TARGET_SIGNATURE, `v1 ${fn}`);
  }
  for (const fn of ["plain", "scale"]) assert.equal(existingTargetRefusal("src/a.ts", A, fn, v5), null, `v5 keeps ${fn}`);
  // Without the sibling the imported names do not resolve.
  for (const fn of ["mark", "sa"]) assert.equal(existingTargetRefusal("src/i.ts", AI, fn, { v2: { read: () => null }, dates: true, v4: true, v5: true }), TEST_TARGET_SIGNATURE, fn);
});

test("target negatives under v5: let / function / object / array / global typeof, parameter typeof, non-literal or missing keys, method, optional and heritage members", () => {
  for (const fn of ["letType", "fnType", "objType", "arrType", "globalType", "paramType", "missing", "keyed", "union", "method", "optional", "heritage", "numKey"])
    assert.equal(existingTargetRefusal("src/a.ts", A, fn, v5), TEST_TARGET_SIGNATURE, fn);
  assert.equal(existingTargetRefusal("src/i.ts", AI, "mut", v5), TEST_TARGET_SIGNATURE, "an exported let in a sibling");
  // A local name shadowing a sibling const of the same name is the local declaration.
  assert.equal(existingTargetRefusal("src/a.ts", 'function KIND(): number { return 1; }\nexport function f(k: typeof KIND): number { return 1; }\n', "f", v5), TEST_TARGET_SIGNATURE);
  // A const that is reassigned through a namespace-like mutation is still a const binding, but a mutated object is not literal.
  assert.equal(existingTargetRefusal("src/a.ts", "const C = { v: 1 };\nC.v = 2;\nexport function f(k: typeof C): number { return 1; }\n", "f", v5), TEST_TARGET_SIGNATURE);
});

test("Job A: v5 targets get one candidate; not_needed for v1-v4 targets; v4 refuses v5 targets by name", () => {
  const k = run("kindOf", '- kindOf("row") is "row"');
  assert.ok(k.e, k.r);
  assert.match(k.e!.content, /assert\.equal\(kindOf\("row"\), "row"\);/);
  assert.match(k.e!.content, /^import \{ kindOf \} from "\.\/a";$/m);
  const s = run("isOk", '- isOk("ok") is true\n- isOk("bad") is false');
  assert.ok(s.e, s.r);
  const c = run("count", '- count(["a", "b"]) is 2');
  assert.ok(c.e, c.r);
  const m = run("mark", '- mark("m") is "m"', SPEC, "src/i.ts");
  assert.ok(m.e, m.r);
  assert.equal(run("plain", "- plain(1) is 2").r, "not_needed", "a v1 target");
  assert.equal(run("scale", "- scale(3) is 6").r, "not_needed", "a v4 target");
  assert.equal(run("fnType", "- fnType(1) is 1").r, TEST_TARGET_SIGNATURE);
  assert.equal(run("kindOf", '- kindOf("row") is "row"', V4).r, TEST_TARGET_SIGNATURE);
});

test("stub and Job B wiring: v5 candidates are re-checked under v5 (with v2, v3 and v4 set) and stubbed by the v2 object-aware stub", () => {
  const st = stubAll(A, ["modeOf"], true);
  assert.ok(st && !st.throws && /export function modeOf\(q: Q\): Q\["mode"\] \{ __peaceaiStubRan\(\);/.test(st.content));
  const tc = read("peaceai/bin/test-candidates.ts");
  assert.match(tc, /function gradeExisting\([^)]*v2 = false, v3 = false, v4 = false, v5 = false\): TestGrading/);
  assert.match(tc, /existing-v4@"\) \|\| candidate\.operationId\.startsWith\("learned:public-test-case-existing-v5@"\)\), typeof candidate\.operationId === "string" && candidate\.operationId\.startsWith\("learned:public-test-case-existing-v5@"\)\);/);
  assert.match(tc, /dates: v3, v4, v5 \} : undefined\) !== null\) return ungradable\("not-test-only"\)/);
  assert.match(tc, /stubAll\(real, \[fn\], v2\)/);
});

// ---- mined evidence ----
type Pin = { path: string; fileBlob: string; sha256: string; fixture: string; repo: string; commit: string };
type Ex = Pin & { module: string; fn: string; signature: string; v1Refusal: string; v2Refusal: string; v3Refusal: string; v4Refusal: string; siblings: Pin[]; license: string; licenseSha256: string };
const EV = JSON.parse(read("peaceai/rules/proposals/m91-test-case-existing-v5-evidence.json")) as { bar: number; manifestSha256: string; examples: Ex[]; peace: { repo: string; checkedAt: string; counted: number }[] };
const gitBlob = (b: Buffer) => createHash("sha1").update(`blob ${b.length}\0`).update(b).digest("hex");
const pinned = (p: { fixture: string; fileBlob: string; sha256: string }) => {
  const b = readFileSync(resolve(root, p.fixture));
  assert.ok(b.length <= 65536, p.fixture);
  assert.equal(gitBlob(b), p.fileBlob, p.fixture);
  assert.equal(createHash("sha256").update(b).digest("hex"), p.sha256, p.fixture);
  return b.toString("utf8");
};
test("evidence: bar met; every module and sibling blob-pinned; v1-v4 refuse and v5 accepts each on the pinned text", () => {
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
    assert.equal(existingTargetRefusal(e.module, text, e.fn, { v2: rd, dates: true, v4: true }), e.v4Refusal, `${e.repo} ${e.fn} v4`);
    assert.notEqual(e.v3Refusal, null);
    assert.notEqual(e.v4Refusal, null);
    assert.equal(existingTargetRefusal(e.module, text, e.fn, { v2: rd, dates: true, v4: true, v5: true }), null, `${e.repo} ${e.fn} v5`);
    // v5 differs from v4 only by typeof of literal consts and T["k"] lookups: one appears in the pinned module or a pinned sibling.
    assert.ok([text, ...sibs.values()].some((t) => /\btypeof\s+[A-Za-z_$]|[\w$>\]]\[\s*["'][^"']+["']\s*\]/.test(t)), `${e.fn}: a v5 widening in the module or a followed type`);
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
  const have = readdirSync(resolve(root, "peaceai/test/fixtures/m91-te5"));
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
  const rec = JSON.parse(read("peaceai/rules/proposals/public-test-case-existing-v5.json")) as { status: string; evidence: { examples: number; repos: number; bar: number; qualifies: boolean } };
  assert.match(rec.status, /^proposal-off/);
  assert.equal(rec.evidence.examples, EV.examples.length);
  assert.equal(rec.evidence.repos, new Set(EV.examples.map((e) => e.repo)).size);
  assert.ok(rec.evidence.qualifies && rec.evidence.examples >= rec.evidence.bar);
  assert.deepEqual(SPEC.evidence.repos, [...new Set(EV.examples.map((e) => e.repo))].sort());
});
