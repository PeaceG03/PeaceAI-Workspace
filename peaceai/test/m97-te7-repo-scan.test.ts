// Auditor ruling on the #466 load-call allowance, part (c): a module binding the target reads (a literal or a call
// result, exported or not) must not be written, handed out or passed on by ANY module of the repo, test files
// included; unparseable modules, dynamic imports / requires and escaping namespace imports fail closed. Each attack
// below is refused under v1-v7 with the repo list (Job A's `files`); the controls stay accepted; without a repo list a
// read binding holding state is refused (fail closed).
import { test } from "node:test";
import assert from "node:assert/strict";
import { existingTargetRefusal, existingTargetAnalysisForEvidence, type RepoFile } from "../lib/learned-test-existing.ts";

const LIT = "export const L: string[] = [\"a\", \"b\"];\nexport function f(x: string): number { return L.indexOf(x); }\n";
const CALL = "function mk(n: number): string[] { return [\"a\", \"b\"]; }\nexport const L = mk(1);\nexport function f(x: string): number { return L.indexOf(x); }\n";
const OBJ = "export const O: { n: number } = { n: 1 };\nexport function f(x: number): number { return x + O.n; }\n";
const ENUM = "export enum E { A = 1, B = 2 }\nexport function f(x: number): number { return x + E.A; }\n";
const CALL_LOCAL = "function mk(n: number): string[] { return [\"a\", \"b\"]; }\nconst L = mk(1);\nexport function f(x: string): number { return L.indexOf(x); }\n";
const RX = "export const RX = /^[a-z]+$/;\nexport function f(x: string): boolean { return RX.test(x); }\n";
const NOEXP = "const L: string[] = [\"a\", \"b\"];\nexport function f(x: string): number { return L.indexOf(x); }\nexport function g(): string[] { return L; }\n";

/** name -> [target module, the other repo files]. The target is always src/m.ts, function f. */
const ATTACKS: Record<string, [string, Record<string, string>]> = {
  push_literal: [LIT, { "src/s.ts": "import { L } from \"./m\";\nexport function g(): void { L.push(\"z\"); }\n" }],
  push_call_result: [CALL, { "src/s.ts": "import { L } from \"./m\";\nexport function g(): void { L.push(\"z\"); }\n" }],
  push_from_test_file: [LIT, { "src/m.test.ts": "import { L } from \"./m\";\nL.push(\"z\");\n" }],
  renamed_import_sort: [LIT, { "src/s.ts": "import { L as Q } from \"./m.ts\";\nexport function g(): void { Q.sort(); }\n" }],
  index_write: [LIT, { "src/s.ts": "import { L } from \"./m\";\nexport function g(): void { L[0] = \"z\"; }\n" }],
  length_write: [LIT, { "src/s.ts": "import { L } from \"./m\";\nexport function g(): void { L.length = 0; }\n" }],
  property_write: [OBJ, { "src/s.ts": "import { O } from \"./m\";\nexport function g(): void { O.n++; }\n" }],
  delete_write: [OBJ, { "src/s.ts": "import { O } from \"./m\";\nexport function g(): void { delete (O as { n?: number }).n; }\n" }],
  export_returns: [LIT, { "src/s.ts": "import { L } from \"./m\";\nexport function g(): string[] { return L; }\n" }],
  export_returns_same_module: [NOEXP, {}],
  arrow_returns: [LIT, { "src/s.ts": "import { L } from \"./m\";\nexport const g = (): string[] => L;\n" }],
  alias_write: [LIT, { "src/s.ts": "import { L } from \"./m\";\nconst A = L;\nexport function g(): void { A.push(\"z\"); }\n" }],
  alias_chain_write: [LIT, { "src/s.ts": "import { L } from \"./m\";\nlet A: string[] = [];\nA = L;\nconst B = A ?? [];\nexport function g(): void { B.splice(0, 1); }\n" }],
  container_alias_write: [LIT, { "src/s.ts": "import { L } from \"./m\";\nconst H = { list: L };\nexport function g(): void { H.list.push(\"z\"); }\n" }],
  for_of_alias_write: [OBJ.replace("export const O: { n: number } = { n: 1 };", "export const O: { n: number }[] = [{ n: 1 }];").replace("O.n", "O[0]!.n"), { "src/s.ts": "import { O } from \"./m\";\nexport function g(): void { for (const o of O) o.n = 2; }\n" }],
  callback_param_write: [OBJ.replace("export const O: { n: number } = { n: 1 };", "export const O: { n: number }[] = [{ n: 1 }];").replace("O.n", "O[0]!.n"), { "src/s.ts": "import { O } from \"./m\";\nexport function g(): void { O.forEach((o) => { o.n = 2; }); }\n" }],
  find_result_write: [OBJ.replace("export const O: { n: number } = { n: 1 };", "export const O: { n: number }[] = [{ n: 1 }];").replace("O.n", "O[0]!.n"), { "src/s.ts": "import { O } from \"./m\";\nexport function g(): void { const o = O.find((x) => x.n === 1); if (o) o.n = 2; }\n" }],
  fresh_copy_element_write: [OBJ.replace("export const O: { n: number } = { n: 1 };", "export const O: { n: number }[] = [{ n: 1 }];").replace("O.n", "O[0]!.n"), { "src/s.ts": "import { O } from \"./m\";\nexport function g(): void { const c = [...O]; c[0]!.n = 2; }\n" }],
  callback_array_param_write: [LIT, { "src/s.ts": "import { L } from \"./m\";\nexport function g(): number { return L.map((e, i, arr) => arr.push(e)).length; }\n" }],
  destructuring_write: [OBJ.replace("export const O: { n: number } = { n: 1 };", "export const O: { n: number; k: { v: number } } = { n: 1, k: { v: 1 } };"), { "src/s.ts": "import { O } from \"./m\";\nexport function g(): void { const { k } = O; k.v = 2; }\n" }],
  destructuring_assign_target: [OBJ, { "src/s.ts": "import { O } from \"./m\";\nexport function g(): void { ({ n: O.n } = { n: 5 }); }\n" }],
  array_destructuring_target: [LIT, { "src/s.ts": "import { L } from \"./m\";\nexport function g(): void { [L[0]] = [\"z\"]; }\n" }],
  object_assign: [OBJ, { "src/s.ts": "import { O } from \"./m\";\nexport function g(): void { Object.assign(O, { n: 2 }); }\n" }],
  define_property: [OBJ, { "src/s.ts": "import { O } from \"./m\";\nexport function g(): void { Object.defineProperty(O, \"n\", { value: 2 }); }\n" }],
  reflect_set: [OBJ, { "src/s.ts": "import { O } from \"./m\";\nexport function g(): void { Reflect.set(O, \"n\", 2); }\n" }],
  enum_write: [ENUM, { "src/s.ts": "import { E } from \"./m\";\nexport function g(): void { (E as unknown as Record<string, number>).A = 5; }\n" }],
  passed_to_unanalysed: [LIT, { "src/s.ts": "import { L } from \"./m\";\nimport { sink } from \"some-package\";\nexport function g(): void { sink(L); }\n" }],
  passed_to_method: [LIT, { "src/s.ts": "import { L } from \"./m\";\nconst H = { take(a: string[]): void { a.push(\"z\"); } };\nexport function g(): void { H.take(L); }\n" }],
  passed_to_repo_fn_writes: [LIT, { "src/s.ts": "import { L } from \"./m\";\nfunction take(a: string[]): void { a.push(\"z\"); }\nexport function g(): void { take(L); }\n" }],
  passed_to_rest_param: [LIT, { "src/s.ts": "import { L } from \"./m\";\nfunction take(...a: string[][]): number { return a.length; }\nexport function g(): number { return take(L); }\n" }],
  stored_on_object: [LIT, { "src/s.ts": "import { L } from \"./m\";\nexport const box: { l?: string[] } = {};\nexport function g(): void { box.l = L; }\n" }],
  thrown: [LIT, { "src/s.ts": "import { L } from \"./m\";\nexport function g(): void { throw L; }\n" }],
  unknown_method: [LIT, { "src/s.ts": "import { L } from \"./m\";\nexport function g(): unknown { return (L as unknown as { frob(): number }).frob(); }\n" }],
  computed_method: [LIT, { "src/s.ts": "import { L } from \"./m\";\nconst k = \"push\";\nexport function g(): void { (L as unknown as Record<string, (x: string) => void>)[k]!(\"z\"); }\n" }],
  namespace_escape: [LIT, { "src/s.ts": "import * as M from \"./m\";\nconst N = M;\nexport function g(): void { N.L.push(\"z\"); }\n" }],
  namespace_passed: [LIT, { "src/s.ts": "import * as M from \"./m\";\nexport function g(o: object): object { return Object.assign(o, M); }\n" }],
  namespace_write: [LIT, { "src/s.ts": "import * as M from \"./m\";\nexport function g(): void { M.L.push(\"z\"); }\n" }],
  reexport_alias: [LIT, { "src/s.ts": "export { L as Q } from \"./m\";\n", "src/t.ts": "import { Q } from \"./s\";\nexport function g(): void { Q.push(\"z\"); }\n" }],
  reexport_star: [LIT, { "src/s.ts": "export * from \"./m\";\n" }],
  reexport_star_as: [LIT, { "src/s.ts": "export * as M from \"./m\";\n" }],
  local_export_alias: [LIT + "export { L as Q };\n", {}],
  export_default: [LIT, { "src/s.ts": "import { L } from \"./m\";\nexport default L;\n" }],
  dynamic_import: [LIT, { "src/s.ts": "export async function g(p: string): Promise<void> { const m = await import(p); m.L.push(\"z\"); }\n" }],
  dynamic_import_literal: [LIT, { "src/s.ts": "export async function g(): Promise<void> { const m = await import(\"./m\"); m.L.push(\"z\"); }\n" }],
  require_nonliteral: [LIT, { "src/s.js": "const p = \"./m\";\nmodule.exports = function g() { require(p).L.push(\"z\"); };\n" }],
  require_literal: [LIT, { "src/s.js": "module.exports = function g() { require(\"./m\").L.push(\"z\"); };\n" }],
  unparseable_module: [LIT, { "src/s.ts": "import { L } from \"./m\";\nexport function g( { L.push(\"z\");\n" }],
  eval_anywhere: [LIT, { "src/s.ts": "export function g(s: string): unknown { return eval(s); }\n" }],
  internal_bare_specifier: [LIT, { "src/s.ts": "import { L } from \"src/m\";\nexport function g(): void { L.push(\"z\"); }\n" }],
  regex_compile: [RX, { "src/s.ts": "import { RX } from \"./m\";\nexport function g(): void { (RX as unknown as { compile(p: string): void }).compile(\"z\"); }\n" }],
  regex_last_index: [RX, { "src/s.ts": "import { RX } from \"./m\";\nexport function g(): void { RX.lastIndex = 3; }\n" }],
  regex_to_user_replace: [RX, { "src/s.ts": "import { RX } from \"./m\";\nconst o = { replace(r: RegExp): void { r.lastIndex = 1; } };\nexport function g(): void { o.replace(RX); }\n" }],
  regex_untyped_receiver: [RX, { "src/s.js": "import { RX } from \"./m\";\nexport function g(s) { return s.split(RX); }\n" }],
};

const CONTROLS: Record<string, [string, Record<string, string>]> = {
  read_only_literal: [LIT, { "src/s.ts": "import { L } from \"./m\";\nexport function g(x: string): boolean { return L.includes(x) && L.length > 1; }\n", "src/m.test.ts": "import { L, f } from \"./m\";\nimport assert from \"node:assert\";\nassert.equal(f(L[0]!), 0);\n" }],
  read_only_literal_map: [LIT, { "src/s.ts": "import { L } from \"./m\";\nexport function g(): string[] { return L.map((x) => x.toUpperCase()); }\n" }],
  local_call_result: [CALL_LOCAL, { "src/m.test.ts": "import { f } from \"./m\";\nf(\"a\");\n" }],
  read_only_object: [OBJ, { "src/s.ts": "import { O } from \"./m\";\nexport function g(): number { const { n } = O; return n + O.n; }\n" }],
  read_only_enum: [ENUM, { "src/s.ts": "import { E } from \"./m\";\nexport function g(x: number): boolean { return x === E.B; }\n" }],
  namespace_member_read: [LIT, { "src/s.ts": "import * as M from \"./m\";\nexport function g(): number { return M.L.length; }\n" }],
  shadowed_name: [LIT, { "src/s.ts": "export function g(): void { const L: string[] = []; L.push(\"z\"); }\n" }],
  copies_handed_out: [LIT, { "src/s.ts": "import { L } from \"./m\";\nexport function g(): string[] { return [...L].sort(); }\nexport function h(): string[] { const c = L.slice(); c.push(\"z\"); return c.filter((x) => x !== \"a\"); }\n" }],
  object_rows_read: [OBJ.replace("export const O: { n: number } = { n: 1 };", "export const O: { n: number }[] = [{ n: 1 }];").replace("O.n", "O[0]!.n"), { "src/s.ts": "import { O } from \"./m\";\nexport function g(): number[] { return O.map((o) => o.n * 2); }\nexport function h(k: number): number { const r = O.find((o) => o.n === k); return r ? r.n : 0; }\n" }],
  spread_copy: [LIT, { "src/s.ts": "import { L } from \"./m\";\nexport function g(): string[] { const c = [...L]; c.push(\"z\"); return c; }\n" }],
  regex_string_methods: [RX, { "src/s.ts": "import { RX } from \"./m\";\nexport function g(s: string): string[] { const a = s.match(RX); const b = RX.exec(s); return [s.replace(RX, \"\"), RX.source, String(a), String(b)]; }\n" }],
};

const VERS = ["v1", "v2", "v3", "v4", "v5", "v6", "v7"] as const;
function run(target: string, others: Record<string, string>, ver: (typeof VERS)[number], repo: boolean, fn = existingTargetRefusal): string {
  const all: Record<string, string> = { "src/m.ts": target, ...others };
  const files: RepoFile[] = Object.entries(all).map(([path, content]) => ({ path, content }));
  const rd = { read: (rel: string) => (rel.endsWith(".test.ts") ? null : all[rel] ?? null) };
  const r = repo ? { repo: files } : {};
  const O: Record<string, object> = { v1: { load: rd, ...r }, v2: { v2: rd, ...r }, v3: { v2: rd, dates: true, ...r }, v4: { v2: rd, dates: true, v4: true, ...r }, v5: { v2: rd, dates: true, v4: true, v5: true, ...r }, v6: { v2: rd, v6: true, ...r }, v7: { v2: rd, v7: true, ...r } };
  return fn("src/m.ts", target, "f", O[ver] as never) ?? "ok";
}

test("repo scan: every attack is refused under v1-v7", () => {
  for (const [k, [t, o]] of Object.entries(ATTACKS)) for (const v of VERS) assert.notEqual(run(t, o, v, true), "ok", `${k} ${v}`);
});

test("repo scan: the same targets without the attacking module are accepted (the attack is what refuses)", () => {
  for (const t of [LIT, CALL_LOCAL, OBJ, ENUM, RX]) for (const v of VERS) assert.equal(run(t, {}, v, true), "ok", `${t.slice(0, 30)} ${v}`);
});

test("repo scan: read-only uses across the repo stay accepted", () => {
  for (const [k, [t, o]] of Object.entries(CONTROLS)) for (const v of VERS) assert.equal(run(t, o, v, true), "ok", `${k} ${v}`);
});

test("repo scan: without a repo list a read binding holding state is refused (fail closed); primitives are not", () => {
  for (const t of [LIT, CALL_LOCAL, OBJ, ENUM, RX]) for (const v of VERS) assert.notEqual(run(t, {}, v, false), "ok", `${t.slice(0, 30)} ${v}`);
  const prim = "export const N = 3;\nconst S = \"a\" + \"b\";\nexport function f(x: number): number { return x + N + S.length; }\n";
  for (const v of VERS) assert.equal(run(prim, {}, v, false), "ok", v);
});

test("repo scan: the refusal names the first problem (diagnostics)", () => {
  const why: { shared?: string } = {};
  const files: RepoFile[] = [{ path: "src/m.ts", content: LIT }, { path: "src/s.ts", content: ATTACKS.push_literal![1]["src/s.ts"]! }];
  assert.equal(existingTargetRefusal("src/m.ts", LIT, "f", { v2: { read: () => null }, repo: files, why }), "test_target_impure");
  assert.match(why.shared ?? "", /^src\/m\.ts#L: mutator_push at src\/s\.ts:2$/);
});

test("repo scan: the call-result form is refused by the scan itself (besides #466's exported-array rule)", () => {
  for (const [t, o] of [[CALL, ATTACKS.push_call_result![1]], [CALL_LOCAL.replace("const L", "export const L"), ATTACKS.push_call_result![1]]] as const) {
    const all: Record<string, string> = { "src/m.ts": t, ...o };
    const why: { shared?: string } = {};
    const r = existingTargetRefusal("src/m.ts", t, "f", { v2: { read: (rel) => all[rel] ?? null }, v7: true, repo: Object.entries(all).map(([path, content]) => ({ path, content })), why });
    assert.notEqual(r, null);
    assert.match(why.shared ?? "", /#L: mutator_push at src\/s\.ts:2$/);
  }
});

test("repo scan: evidence replay is not gated by the scan", () => {
  for (const v of VERS) assert.equal(run(LIT, ATTACKS.push_literal![1], v, true, existingTargetAnalysisForEvidence), "ok", v);
});

test("repo scan: Map values are reached as deep through get as through iteration (a Map of arrays stays shared)", () => {
  const MAP = "export const M = new Map<string, string[]>([[\"a\", [\"x\"]]]);\nexport function f(k: string): number { return M.get(k)?.length ?? 0; }\n";
  for (const s of [
    "for (const [, v] of M) v.push(\"z\");",
    "M.get(\"a\")!.push(\"z\");",
    "[...M][0]![1].push(\"z\");",
    "Array.from(M)[0]![1].push(\"z\");",
    "M.forEach((v) => v.push(\"z\"));",
    "for (const v of M.values()) v.push(\"z\");",
    "for (const [, v] of M.entries()) v.push(\"z\");",
  ]) for (const v of VERS) assert.notEqual(run(MAP, { "src/s.ts": `import { M } from "./m";\nexport function g(): void { ${s} }\n` }, v, true), "ok", `${s} ${v}`);
  for (const v of VERS) assert.equal(run(MAP, {}, v, true), "ok", `alone ${v}`);
  const PRIM = "export const M = new Map<string, number>([[\"a\", 1]]);\nexport function f(k: string): number { return M.get(k) ?? 0; }\n";
  for (const v of VERS) assert.equal(run(PRIM, { "src/s.ts": "import { M } from \"./m\";\nexport function g(k: string): number | undefined { return M.get(k); }\n" }, v, true), "ok", v);
});
