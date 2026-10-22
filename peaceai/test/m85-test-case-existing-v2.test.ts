// M85 TEST_EXISTING v2 target (public-test-case-existing-v2; stress gaps 1 and 7): characterization tests for existing
// exported functions with plain-data object/array signatures, or bodies calling pure exports of relative sibling
// modules. Same params as v1 except the target; v1 targets stay with v1 (not_needed). Job B re-checks under v2 with
// only the scope's non-test source files readable and stubs object returns.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { admitRules } from "../lib/approved.ts";
import { applyRule, specHash, validateSpec, type RuleSpec } from "../lib/learned.ts";
import { stubAll } from "../lib/learned-function.ts";
import { existingTargetAnalysisForEvidence, existingTargetRefusal, TEST_EXISTING_TRIGGER, TEST_TARGET_DATE_LOCAL, TEST_TARGET_IMPURE, TEST_TARGET_IO, TEST_TARGET_SIGNATURE, TEST_TARGET_TOO_LARGE } from "../lib/learned-test-existing.ts";
import { readManifestBytes } from "../lib/manifestparts.ts";
import { phrasingFor } from "../lib/propose.ts";
import { PROTECTED_SELF } from "../lib/selfchange.ts";

const root = resolve(import.meta.dirname, "../..");
const read = (p: string) => readFileSync(resolve(root, p), "utf8");
const SPEC = JSON.parse(read("peaceai/rules/learned/public-test-case-existing-v2.json")) as RuleSpec;
const V1 = JSON.parse(read("peaceai/rules/learned/public-test-case-existing-v1.json")) as RuleSpec;
const SHA = "2baeab3b89fa11fd20b324e3cded5b39d5b0e85764445ebc894f46e4efe87e08";

const B = "export function clamp(x: number, lo: number, hi: number): number {\n  return Math.min(hi, Math.max(lo, x));\n}\nexport function stamp(): number { return Date.now(); }\n";
const A = [
  'import { clamp, stamp } from "./b.ts";',
  'import { join } from "node:path";',
  "export interface Opts { host: string; port?: number; tags: readonly string[] }",
  "export type Pt = { x: number; y: number };",
  "export function url(o: Opts): string {",
  '  return `ftp://${o.host}:${o.port ?? 21}/${o.tags.join(",")}`;',
  "}",
  "export function scaled(x: number): number {",
  "  return clamp(x, 0, 10) * 2;",
  "}",
  "export function span(p: Pt): Pt[] {",
  "  return [p, { x: p.x + p.y, y: p.y }];",
  "}",
  "export function stamped(x: number): number { return stamp() + x; }",
  "export function joined(a: string): string { return join(a, \"x\"); }",
  "export class C { n = 1 }",
  "export function withClass(c: C): number { return c.n; }",
  "export function withFn(o: { f: () => number }): number { return o.f(); }",
  "export function plain(x: number): number { return x + 1; }",
  "export function tuple(p: [number, number]): number { return p[0]; }",
  "",
].join("\n");
const FILES = [{ path: "src/a.ts", content: A }, { path: "src/b.ts", content: B }];
const sib = (files: { path: string; content: string }[]) => ({ v2: { read: (rel: string) => files.find((f) => f.path === rel)?.content ?? null } });
const isTest = (p: string) => /\.test\.ts$/.test(p);
const run = (fn: string, checks: string, files = FILES) => {
  const w: { reason?: string } = {};
  const e = applyRule(SPEC, `add a characterization test for ${fn} in src/a.ts\n${checks}`, files, isTest, undefined, w, () => false);
  return { e, r: w.reason };
};

test("spec: valid, hash pinned, v1 params except the target, the v1 trigger; any listed approval pins the exact hash", () => {
  assert.ok(validateSpec(SPEC));
  assert.equal(specHash(SPEC), SHA);
  assert.equal(SPEC.trigger, TEST_EXISTING_TRIGGER);
  assert.deepEqual(SPEC.params, { ...V1.params, target: "exported-pure-function-v2" });
  assert.ok(!validateSpec({ ...SPEC, params: { ...SPEC.params, target: "any-function" } }));
  const onMain = JSON.parse(read("peaceai/rules/approved.json")) as { rules: { id: string; sha256: string }[] };
  for (const r of onMain.rules.filter((x) => x.id === SPEC.id)) assert.equal(r.sha256, SHA, "a listed entry pins the exact spec hash");
  assert.match(phrasingFor(SPEC), /characteri[sz]ation/);
  for (const p of ["peaceai/rules/learned/public-test-case-existing-v2.json", "peaceai/rules/proposals/public-test-case-existing-v2.json", "peaceai/rules/proposals/m85-test-case-existing-v2-evidence.json", "peaceai/test/m85-test-case-existing-v2.test.ts", "peaceai/test/fixtures/m85-te2/x.txt", "peaceai/spec/test-case-existing-v2.md"]) assert.ok(PROTECTED_SELF.some((x) => x.pattern.test(p)), p);
  const list = (sha: string) => ({ ok: true as const, list: { schema: "peaceai-approved-rules:v1", rules: [{ id: SPEC.id, sha256: sha, source: "workspace" }] } as never });
  assert.equal(admitRules([SPEC], list(SHA))[0]!.decision, "APPROVED");
  assert.equal(admitRules([SPEC], list("0".repeat(64)))[0]!.decision, "HASH_CHANGED");
});

test("target: plain-data signatures and pure sibling imports pass under v2 only; v1 is unchanged", () => {
  for (const fn of ["url", "span"]) {
    assert.equal(existingTargetRefusal("src/a.ts", A, fn), TEST_TARGET_SIGNATURE, `v1 ${fn}`);
    assert.equal(existingTargetRefusal("src/a.ts", A, fn, sib(FILES)), null, `v2 ${fn}`);
  }
  assert.equal(existingTargetRefusal("src/a.ts", A, "scaled"), TEST_TARGET_IMPURE, "v1 does not follow imports");
  assert.equal(existingTargetRefusal("src/a.ts", A, "scaled", sib(FILES)), null);
  // Auditor #466 (3rd review): v1 without the tree cannot see A's load closure (it imports ./b), so it fails closed;
  // with the tree for the load check only (`load`, as Job A and Job B pass it) the closure is visible and inert.
  assert.equal(existingTargetRefusal("src/a.ts", A, "plain"), TEST_TARGET_IMPURE, "v1 without the tree fails closed");
  assert.equal(existingTargetRefusal("src/a.ts", A, "plain", { load: sib(FILES).v2 }), null, "v1 with the load tree");
  assert.equal(existingTargetRefusal("src/a.ts", A, "plain", sib(FILES)), null);
});

test("target negatives under v2: impure sibling, package import, unreadable sibling, class and function members", () => {
  assert.equal(existingTargetRefusal("src/a.ts", A, "stamped", sib(FILES)), TEST_TARGET_DATE_LOCAL, "sibling reads the clock");
  assert.notEqual(existingTargetRefusal("src/a.ts", A, "joined", sib(FILES)), null, "node: import is not followed");
  assert.notEqual(existingTargetRefusal("src/a.ts", A, "scaled", sib([FILES[0]!])), null, "sibling not readable");
  assert.equal(existingTargetRefusal("src/a.ts", A, "withClass", sib(FILES)), TEST_TARGET_SIGNATURE);
  assert.equal(existingTargetRefusal("src/a.ts", A, "withFn", sib(FILES)), TEST_TARGET_SIGNATURE);
  assert.equal(existingTargetRefusal("src/a.ts", A, "tuple", sib(FILES)), TEST_TARGET_SIGNATURE, "tuples are not in the v2 vocabulary");
});

test("v2 bounds: 4 sibling modules and import depth 2, refused before a further read", () => {
  const iface = (n: string) => `export interface ${n} { n: number }\n`;
  const param = (k: number) => `{ ${Array.from({ length: k }, (_, i) => `t${i}: T${i}`).join("; ")} }`;
  const src = (k: number) => [
    ...Array.from({ length: k }, (_, i) => `import type { T${i} } from "./s${i}";`),
    `export function f(x: ${param(k)}): number { return x.t0.n; }`,
    "",
  ].join("\n");
  const files = (k: number) => Array.from({ length: k }, (_, i) => ({ path: `src/s${i}.ts`, content: iface(`T${i}`) }));
  const seen = (k: number) => {
    const reads: string[] = [];
    const map = new Map(files(k).map((f) => [f.path, f.content]));
    const r = existingTargetRefusal("src/a.ts", src(k), "f", { v2: { read: (rel) => { reads.push(rel); return map.get(rel) ?? null; } } });
    return { r, reads };
  };
  const four = seen(4);
  assert.equal(four.r, null, "4 sibling interfaces are the cap");
  assert.ok(four.reads.includes("src/s3.ts"));
  const five = seen(5);
  assert.equal(five.r, TEST_TARGET_TOO_LARGE, "a 5th sibling is too large");
  assert.ok(!five.reads.includes("src/s4.ts"), "the 5th sibling is not read");
  const chain = new Map<string, string>([
    ["src/s.ts", 'import type { B } from "./b";\nexport interface A { n: number; b: B }\n'],
    ["src/b.ts", 'import type { E } from "./c";\nexport interface B { n: number; e: E }\n'],
    ["src/c.ts", "export enum E { A = Date.now() }\n"],
  ]);
  const deepReads: string[] = [];
  const deep = existingTargetRefusal("src/a.ts", 'import type { A } from "./s";\nexport function f(x: A): number { return x.n; }\n', "f", { v2: { read: (rel) => { deepReads.push(rel); return chain.get(rel) ?? null; } } });
  assert.equal(deep, TEST_TARGET_TOO_LARGE, "import depth past 2");
  assert.ok(deepReads.includes("src/b.ts") && !deepReads.includes("src/c.ts"), "the depth-3 module is not read");
  const pure = new Map<string, string>([
    ["src/s.ts", 'import type { E } from "./b";\nexport interface A { n: number; e: E }\n'],
    ["src/b.ts", "export enum E { A = 1 }\n"],
  ]);
  assert.equal(existingTargetRefusal("src/a.ts", 'import type { A } from "./s";\nexport function f(x: A): number { return x.n; }\n', "f", { v2: { read: (rel) => pure.get(rel) ?? null } }), null, "a pure enum at depth 2");
});

test("v2 purity: enum initializers and sibling top-level statements run on load; v1 walks only its own top-level statements", () => {
  const execEnum = 'import { execFileSync } from "node:child_process";\nexport enum E { A = execFileSync("id").length }\nexport function f(x: E): number { return 1; }\n';
  const clockEnum = 'export enum E { A = Date.now() }\nexport function f(x: E): number { return 1; }\n';
  const hoursEnum = 'export enum E { A = new Date().getHours() }\nexport function f(x: E): number { return 1; }\n';
  for (const src of [execEnum, clockEnum, hoursEnum]) assert.equal(existingTargetRefusal("src/a.ts", src, "f"), TEST_TARGET_SIGNATURE, "v1 still refuses an enum parameter");
  assert.equal(existingTargetRefusal("src/a.ts", execEnum, "f", sib([])), TEST_TARGET_IO);
  assert.equal(existingTargetRefusal("src/a.ts", clockEnum, "f", sib([])), TEST_TARGET_DATE_LOCAL);
  assert.equal(existingTargetRefusal("src/a.ts", hoursEnum, "f", sib([])), TEST_TARGET_DATE_LOCAL);
  const top = 'Date.now();\nexport function f(n: number): number { return n; }\n';
  // Auditor #466: v1 walks the target module's top-level expression statements too (a load-time patch is not
  // invisible to v1); it still does not read siblings or scan unused consts.
  assert.equal(existingTargetRefusal("src/a.ts", top, "f"), TEST_TARGET_DATE_LOCAL, "v1 walks top-level statements (Auditor #466)");
  assert.equal(existingTargetRefusal("src/a.ts", top, "f", sib([])), TEST_TARGET_DATE_LOCAL);
  const sibTop = 'Date.now();\nexport function g(n: number): number { return n; }\n';
  const importer = 'import { g } from "./b";\nexport function f(n: number): number { return g(n); }\n';
  assert.equal(existingTargetRefusal("src/a.ts", importer, "f"), TEST_TARGET_IMPURE, "v1 still refuses the import itself");
  assert.equal(existingTargetRefusal("src/a.ts", importer, "f", sib([{ path: "src/b.ts", content: sibTop }])), TEST_TARGET_DATE_LOCAL);
  const enumSib = "export enum E { A = Date.now() }\n";
  const enumImp = 'import type { E } from "./b";\nexport function f(x: E): number { return 1; }\n';
  assert.equal(existingTargetRefusal("src/a.ts", enumImp, "f", sib([{ path: "src/b.ts", content: enumSib }])), TEST_TARGET_DATE_LOCAL, "a followed enum's initializer is not skipped");
  const clockConst = "const opened = Date.now();\nexport function f(n: number): number { return n; }\n";
  // Auditor #466 (3rd review): fail-closed load allowlist - a call at load (Date.now()) is refused even when unused.
  assert.equal(existingTargetRefusal("src/a.ts", clockConst, "f"), TEST_TARGET_IMPURE, "v1 refuses a load-time call outside the allowlist");
  assert.equal(existingTargetRefusal("src/a.ts", clockConst, "f", sib([])), TEST_TARGET_DATE_LOCAL);
  const weak = "const sessions = new WeakMap<object, number>();\nexport function f(n: number): number { return n; }\n";
  assert.equal(existingTargetRefusal("src/a.ts", weak, "f", sib([])), null, "an unused WeakMap is not a v2 refusal");
});

test("Job A: builds one new test file (object-literal arguments allowed); not_needed for v1 targets", () => {
  const u = run("url", '- url({ host: "h", tags: ["a"] }) is "ftp://h:21/a"');
  assert.ok(u.e, u.r);
  assert.match((u.e as { content: string }).content, /url\(\{ host: "h", tags: \["a"\] \}\)/);
  const s = run("scaled", "- scaled(20) is 20");
  assert.ok(s.e, s.r);
  assert.equal(run("plain", "- plain(1) is 2").r, "not_needed");
  assert.equal(run("stamped", "- stamped(1) is 2").e, null);
});

test("stub: object mode stubs annotated object returns; Job B wiring", () => {
  const st = stubAll(A, ["span"], true);
  assert.ok(st && !st.content.includes("p.x + p.y") && st.content.includes("export function url(o: Opts)"));
  const tc = read("peaceai/bin/test-candidates.ts");
  assert.match(tc, /candidate\.operationId\.startsWith\("learned:public-test-case-existing-v2@"\)/);
  assert.match(tc, /scope\.isSource\(rel\) && !scope\.isTest\(rel\) \? regular\(rel\) : null/);
  assert.match(tc, /stubAll\(real, \[fn\], v2\)/);
});

// ---- mined evidence ----
type Pin = { path: string; fileBlob: string; sha256: string; fixture: string; repo: string; commit: string };
type Ex = Pin & { module: string; fn: string; v1Refusal: string; siblings: Pin[]; license: string; licenseSha256: string };
const EV = JSON.parse(read("peaceai/rules/proposals/m85-test-case-existing-v2-evidence.json")) as { bar: number; manifestSha256: string; examples: Ex[]; peace: { repo: string; checkedAt: string; counted: number }[] };
const gitBlob = (b: Buffer) => createHash("sha1").update(`blob ${b.length}\0`).update(b).digest("hex");
const pinned = (p: { fixture: string; fileBlob: string; sha256: string }) => {
  const b = readFileSync(resolve(root, p.fixture));
  assert.ok(b.length <= 65536, p.fixture);
  assert.equal(gitBlob(b), p.fileBlob, p.fixture);
  assert.equal(createHash("sha256").update(b).digest("hex"), p.sha256, p.fixture);
  return b.toString("utf8");
};
test("evidence: bar met; every module and sibling blob-pinned; v1 refuses and v2 accepts each on the pinned text", () => {
  assert.ok(EV.examples.length >= EV.bar && EV.bar >= 10);
  assert.equal(new Set(EV.examples.map((e) => `${e.module}\0${e.fn}`)).size, EV.examples.length);
  assert.ok(EV.examples.some((e) => e.siblings.length > 0), "sibling-import variant present");
  for (const e of EV.examples) {
    const text = pinned(e);
    const sibs = new Map(e.siblings.map((s) => [s.path, pinned(s)]));
    assert.equal(existingTargetAnalysisForEvidence(e.module, text, e.fn), e.v1Refusal, `${e.repo} ${e.fn} v1`);
    assert.equal(existingTargetAnalysisForEvidence(e.module, text, e.fn, { v2: { read: (rel) => sibs.get(rel) ?? null } }), null, `${e.repo} ${e.fn} v2`);
    if (e.siblings.length) assert.notEqual(existingTargetAnalysisForEvidence(e.module, text, e.fn, { v2: { read: () => null } }), null, `${e.fn} needs its siblings`);
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
  const have = readdirSync(resolve(root, "peaceai/test/fixtures/m85-te2"));
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
  const rec = JSON.parse(read("peaceai/rules/proposals/public-test-case-existing-v2.json")) as { status: string; evidence: { examples: number; repos: number; bar: number; qualifies: boolean } };
  assert.match(rec.status, /^proposal-off/);
  assert.equal(rec.evidence.examples, EV.examples.length);
  assert.equal(rec.evidence.repos, new Set(EV.examples.map((e) => e.repo)).size);
  assert.ok(rec.evidence.qualifies && rec.evidence.examples >= rec.evidence.bar);
  assert.deepEqual(SPEC.evidence.repos, [...new Set(EV.examples.map((e) => e.repo))].sort());
});
