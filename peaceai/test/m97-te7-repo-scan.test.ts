// Auditor ruling on the #466 load-call allowance, part (c): a module binding the target reads (a literal or a call
// result, exported or not) must not be written, handed out or passed on by ANY module of the repo, test files
// included; unparseable modules, dynamic imports / requires and escaping namespace imports fail closed. Each attack
// below is refused under v1-v7 with the repo list (Job A's `files`); the controls stay accepted; without a repo list a
// read binding holding state is refused (fail closed).
import { test } from "node:test";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { existingTargetRefusal, existingTargetAnalysisForEvidence, primGlobalTouched, repoFileLists, type RepoFile } from "../lib/learned-test-existing.ts";

const LIT = "export const L: string[] = [\"a\", \"b\"];\nexport function f(x: string): number { return L.indexOf(x); }\n";
const CALL = "function mk(n: number): string[] { return [\"a\", \"b\"]; }\nexport const L = mk(1);\nexport function f(x: string): number { return L.indexOf(x); }\n";
const OBJ = "export const O: { n: number } = { n: 1 };\nexport function f(x: number): number { return x + O.n; }\n";
const ENUM = "export enum E { A = 1, B = 2 }\nexport function f(x: number): number { return x + E.A; }\n";
const CALL_LOCAL = "function mk(n: number): string[] { return [\"a\", \"b\"]; }\nconst L = mk(1);\nexport function f(x: string): number { return L.indexOf(x); }\n";
const RX = "export const RX = /^[a-z]+$/;\nexport function f(x: string): boolean { return RX.test(x); }\n";
const NOEXP = "const L: string[] = [\"a\", \"b\"];\nexport function f(x: string): number { return L.indexOf(x); }\nexport function g(): string[] { return L; }\n";

const DUTC_X = "export const E = Date.UTC(1970, 0, 1);\nexport function f(x: number): number { return x - E; }\n";
const MATH_X = "export const E = Math.max(1, 2);\nexport function f(x: number): number { return x - E; }\n";

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
  dynamic_import_destructured_push: [LIT, { "src/s.test.ts": "test(\"t\", async () => { const { L } = await import(\"./m\"); L.push(\"z\"); });\n" }],
  dynamic_import_destructured_renamed: [LIT, { "src/s.ts": "export async function g(): Promise<string[]> { const { L: Q } = (await import(\"./m.ts\")); return Q; }\n" }],
  dynamic_import_destructured_rest: [LIT, { "src/s.ts": "export async function g(): Promise<void> { const { ...r } = await import(\"./m\"); void r; }\n" }],
  dynamic_import_destructured_nested: [LIT, { "src/s.ts": "export async function g(): Promise<void> { const { L: [a] } = await import(\"./m\"); void a; }\n" }],
  require_destructured_sort: [LIT, { "src/s.js": "const { L } = require(\"./m\");\nmodule.exports = function g() { L.sort(); };\n" }],
  dynamic_import_default_calls: [LIT, { "src/s.ts": "function mk(): string[] { return []; }\nexport async function g(): Promise<void> { const { L = mk() } = await import(\"./m\"); L.push(\"z\"); }\n" }],
  dynamic_import_default_read_only: [LIT, { "src/s.ts": "function mk(): string[] { return []; }\nexport async function g(): Promise<number> { const { L = mk() } = await import(\"./m\"); return L.length; }\n" }],
  dynamic_import_computed_key: [LIT, { "src/s.ts": "export async function g(): Promise<number> { const { [\"L\"]: q } = await import(\"./m\"); return q.length; }\n" }],
  dynamic_import_string_key: [LIT, { "src/s.ts": "export async function g(): Promise<number> { const { \"L\": q } = await import(\"./m\"); return q.length; }\n" }],
  dynamic_import_object_kept: [LIT, { "src/s.ts": "let m: unknown;\nexport async function g(): Promise<number> { const { L } = (m = await import(\"./m\")) as { L: string[] }; return L.length; }\nexport const h = () => m;\n" }],
  star_chain_local_export: [LIT, { "src/index.ts": "export * from \"./mid\";\n", "src/mid.ts": "import { L } from \"./m\";\nexport { L };\n" }],
  star_chain_cycle: [LIT, { "src/index.ts": "export * from \"./a\";\n", "src/a.ts": "export * from \"./b\";\n", "src/b.ts": "export * from \"./a\";\nimport { L } from \"./m\";\nexport { L };\n" }],
  star_chain_unresolved: [CALL_LOCAL, { "src/index.ts": "export * from \"./a\";\n", "src/a.ts": "export * from \"./missing\";\n" }],
  unparseable_module: [LIT, { "src/s.ts": "import { L } from \"./m\";\nexport function g( { L.push(\"z\");\n" }],
  eval_anywhere: [LIT, { "src/s.ts": "export function g(s: string): unknown { return eval(s); }\n" }],
  internal_bare_specifier: [LIT, { "src/s.ts": "import { L } from \"src/m\";\nexport function g(): void { L.push(\"z\"); }\n" }],
  regex_compile: [RX, { "src/s.ts": "import { RX } from \"./m\";\nexport function g(): void { (RX as unknown as { compile(p: string): void }).compile(\"z\"); }\n" }],
  regex_last_index: [RX, { "src/s.ts": "import { RX } from \"./m\";\nexport function g(): void { RX.lastIndex = 3; }\n" }],
  regex_to_user_replace: [RX, { "src/s.ts": "import { RX } from \"./m\";\nconst o = { replace(r: RegExp): void { r.lastIndex = 1; } };\nexport function g(): void { o.replace(RX); }\n" }],
  regex_untyped_receiver: [RX, { "src/s.js": "import { RX } from \"./m\";\nexport function g(s) { return s.split(RX); }\n" }],
  // Auditor #505 NOT PASS at 989968f: (1) `arguments` past the parameter tracking
  D1_arguments_write: [LIT, { "src/s.ts": "import { L } from \"./m\";\nfunction t(_a: string[]): void { (arguments[0] as string[]).push(\"z\"); }\nt(L);\n" }],
  D1_arguments_handout: [LIT, { "src/s.ts": "import { L } from \"./m\";\nfunction t(_a: string[]): unknown { return arguments; }\nexport const r = t(L);\n" }],
  D1_arguments_cross_module_test: [LIT, { "src/s.ts": "export function t(_a: string[]): void { (arguments[0] as string[]).push(\"z\"); }\n", "src/u.test.ts": "import { L } from \"./m\";\nimport { t } from \"./s\";\nt(L);\n" }],
  D1_arguments_nested_arrow: [LIT, { "src/s.ts": "import { L } from \"./m\";\nfunction t(_a: string[]): void { const k = () => (arguments[0] as string[]).push(\"z\"); k(); }\nt(L);\n" }],
  D1_arguments_const_function_expression: [LIT, { "src/s.ts": "import { L } from \"./m\";\nconst t = function (_a: string[]): void { (arguments[0] as string[]).push(\"z\"); };\nt(L);\n" }],
  D1_arguments_callback: [OBJ.replace("export const O: { n: number } = { n: 1 };", "export const O: { n: number }[] = [{ n: 1 }];").replace("O.n", "O[0]!.n"), { "src/s.ts": "import { O } from \"./m\";\nO.forEach(function (_o) { (arguments[0] as { n: number }).n = 9; });\n" }],
  // (2) Array.of(x) is [x]: a container holding x
  D2_array_of_then_push: [LIT, { "src/s.ts": "import { L } from \"./m\";\nexport const A = Array.of(L);\n", "src/t.ts": "import { A } from \"./s\";\nA[0]!.push(\"z\");\n" }],
  D2_array_of_second_arg: [LIT, { "src/s.ts": "import { L } from \"./m\";\nconst A = Array.of([\"q\"], L);\nA[1]!.push(\"z\");\n" }],
  D2_array_of_handed_out: [LIT, { "src/s.ts": "import { L } from \"./m\";\nexport function g(): string[][] { return Array.of(L); }\n" }],
  // (3) the Date.UTC relaxation bypassed through a global object (exported target, every version)
  D3_globalThis_alias: [DUTC_X, { "src/s.ts": "const G: any = globalThis;\nG.Date = { UTC: () => [] };\n" }],
  D3_defineProperty_globalThis: [DUTC_X, { "src/s.ts": "Object.defineProperty(globalThis, \"Date\", { value: { UTC: () => [] } });\n" }],
  D3_assign_globalThis: [DUTC_X, { "src/s.ts": "Object.assign(globalThis, { Date: { UTC: () => [] } });\n" }],
  D3_reflect_set_globalThis: [DUTC_X, { "src/s.ts": "Reflect.set(globalThis, \"Date\", { UTC: () => [] });\n" }],
  D3_globalThis_passed: [DUTC_X, { "src/s.ts": "function p(o: any): void { o.Date = { UTC: () => [] }; }\np(globalThis);\n" }],
  D3_global_alias: [DUTC_X, { "src/s.js": "const G = global;\nG.Date = { UTC: () => [] };\n" }],
  D3_window_spread: [DUTC_X, { "src/s.ts": "export const w = { ...window };\n" }],
  D3_self_unsafe_member: [DUTC_X, { "src/s.ts": "export const d = self.Date;\n" }],
  D3_math_root_via_alias: [MATH_X, { "src/s.ts": "const G: any = globalThis;\nG.Math = { max: () => [] };\n" }],
  // (4) relative imports that resolve to no scanned file fail closed
  D4_test_imports_unlisted_js: [LIT, { "src/x.test.ts": "import { poke } from \"./evil.js\";\npoke();\n" }],
  D4_test_imports_outside_scope: [LIT, { "src/x.test.ts": "import \"../scripts/evil\";\n" }],
  D4_src_imports_dotdir: [LIT, { "src/s.ts": "import \"./.hidden/evil\";\nexport const q = 1;\n" }],
  D4_export_from_unlisted: [LIT, { "src/s.ts": "export { poke } from \"./evil\";\n" }],
  D4_require_unlisted: [LIT, { "src/s.js": "require(\"./evil\");\n" }],
  D4_dynamic_import_unlisted: [LIT, { "src/s.ts": "export const p = import(\"./evil\");\n" }],
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
  export_star_unexported: [CALL_LOCAL, { "src/index.ts": "export * from \"./m\";\n", "src/s.ts": "import * as all from \"./index\";\nexport function g(x: string): number { return all.f(x); }\n" }],
  star_chain_cycle_no_binding: [CALL_LOCAL, { "src/index.ts": "export * from \"./a\";\nexport * from \"./m\";\n", "src/a.ts": "export * from \"./b\";\n", "src/b.ts": "export * from \"./a\";\nexport const Z = 1;\n" }],
  dynamic_import_destructured_read: [LIT, { "src/s.test.ts": "test(\"t\", async () => { const { L, f } = await import(\"./m\"); if (f(L[0]!) !== 0 || !L.includes(\"b\")) throw new Error(\"x\"); });\n" }],
  // Auditor #505 controls: a plain read of a known-safe global-object member keeps the relaxation; an erased
  // type-only import of an unscanned file is no load
  D3_test_fake_fetch_write: [DUTC_X, { "src/a.test.ts": "const original = globalThis.fetch;\nglobalThis.fetch = (async () => new Response(\"{}\")) as typeof fetch;\nglobalThis.fetch = original;\n" }],
  D3_safe_global_member_read: [DUTC_X, { "src/s.ts": "export function g(): void { globalThis.console.log(\"x\"); }\n" }],
  D3_global_name_as_property: [DUTC_X, { "src/s.ts": "export const o = { globalThis: 1, window: 2 };\nexport const n = o.window;\n" }],
  D4_type_only_import_unlisted: [LIT, { "src/s.ts": "import type { T } from \"./types\";\nexport const t: T | null = null;\n" }],
  D1_arguments_not_reached: [LIT, { "src/s.ts": "import { L } from \"./m\";\nfunction t(): number { return arguments.length; }\nexport const n = t() + L.length;\n" }],
  D2_array_of_read: [LIT, { "src/s.ts": "import { L } from \"./m\";\nexport function g(): number { return Array.of(L).length + Array.of(L)[0]!.length; }\n" }],
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

// Auditor (c), tightening 3: `Date.UTC(..)` (and the other prim-returning globals) is a primitive only when every
// argument is inert and no module of the repo shadows or patches the global; with no repo list that is unproven.
const DUTC = "const E = Date.UTC(1970, 0, 1);\nexport function f(x: number): number { return x - E; }\n";
const V4P = ["v4", "v5", "v6", "v7"] as const;
test("repo scan: a Date.UTC const is a primitive only with the real, unpatched global and inert arguments", () => {
  for (const v of V4P) {
    assert.equal(run(DUTC, {}, v, true), "ok", `alone ${v}`);
    assert.equal(run(DUTC, { "src/s.ts": "export const t = (): number => Date.UTC(2020, 0, 1) + new Date(0).getTime() + Date.now();\n" }, v, true), "ok", `reads ${v}`);
    assert.notEqual(run(DUTC, {}, v, false), "ok", `no repo ${v}`);
  }
  const attacks: Record<string, Record<string, string>> = {
    patch_member: { "src/s.ts": "(Date as unknown as { UTC: () => unknown }).UTC = () => [];\n" },
    patch_member_plain: { "src/s.js": "Date.UTC = function () { return []; };\n" },
    global_object: { "src/s.ts": "(globalThis as { Date?: unknown }).Date = class {};\n" },
    global_object_index: { "src/s.ts": "const k = \"Da\" + \"te\";\n(globalThis as Record<string, unknown>)[k] = 1;\n" },
    define_property: { "src/s.ts": "Object.defineProperty(Date, \"UTC\", { value: () => 0 });\n" },
    passed: { "src/s.ts": "function p(x: unknown): void { void x; }\np(Date);\n" },
    imported_name: { "src/s.ts": "import { Date } from \"./d\";\nexport const y = Date;\n", "src/d.ts": "export const Date = 1;\n" },
    declared_name: { "src/s.ts": "export function g(Date: number): number { return Date; }\n" },
    // Auditor #505 option X: the root itself, patched directly, still cancels
    reflect_set_member: { "src/s.ts": "Reflect.set(Date, \"UTC\", () => []);\n" },
    delete_member: { "src/s.ts": "delete (Date as { UTC?: unknown }).UTC;\n" },
    delete_member_plain: { "src/s.js": "delete Date.UTC;\n" },
    alias_then_patch: { "src/s.ts": "const D: any = Date;\nD.UTC = () => [];\n" },
    alias_then_patch_in_test: { "src/s.test.ts": "const D: any = Date;\nD.UTC = () => [];\n" },
    // option X: plain writes through a global object cancel when the name is the root, or when the form is not plain
    global_object_plain_write: { "src/s.js": "globalThis.Date = class {};\n" },
    global_object_plain_write_window: { "src/s.js": "window.Date = class {};\n" },
    global_object_plain_write_global: { "src/s.test.js": "global.Date = class {};\n" },
    global_object_folded_key: { "src/s.js": "globalThis[\"Da\" + \"te\"] = class {};\n" },
    global_object_literal_key: { "src/s.js": "globalThis[\"fetch\"] = () => 0;\n" },
    global_object_cast_write: { "src/s.ts": "(globalThis as { fetch?: unknown }).fetch = () => 0;\n" },
    global_object_alias_write: { "src/s.ts": "const G: any = globalThis;\nG.fetch = () => 0;\n" },
    global_object_compound_write: { "src/s.js": "globalThis.fetch ||= () => 0;\n" },
    global_object_delete: { "src/s.js": "delete globalThis.fetch;\n" },
    global_object_destructuring_write: { "src/s.js": "({ a: globalThis.fetch } = { a: () => 0 });\n" },
    global_object_define_property_other: { "src/s.ts": "Object.defineProperty(globalThis, \"fetch\", { value: () => 0 });\n" },
    global_object_expando_then_alias: { "src/s.js": "globalThis.fetch = 0;\nconst G = globalThis;\nG.Date = class {};\n" },
    global_object_passed_other: { "src/s.ts": "function p(o: unknown): void { void o; }\np(self);\n" },
  };
  for (const [k, others] of Object.entries(attacks)) for (const v of V4P) {
    const all: Record<string, string> = { "src/m.ts": DUTC, ...others };
    const why: { shared?: string } = {};
    const rd = { read: (rel: string) => all[rel] ?? null };
    const r = existingTargetRefusal("src/m.ts", DUTC, "f", { v2: rd, dates: true, v4: true, v5: v !== "v4", v6: v === "v6" || v === "v7", v7: v === "v7", repo: Object.entries(all).map(([path, content]) => ({ path, content })), why } as never);
    assert.notEqual(r, null, `${k} ${v}`);
    assert.match(why.shared ?? "", /global_Date|repo:/, `${k} ${v}: ${why.shared}`);
  }
  // option X positive: a test's fake `globalThis.fetch = ..` (and its restore) no longer cancels (the PeaceSTOCKS row 136 shape)
  const fakeFetch = { "src/a.test.ts": "const original = globalThis.fetch;\nglobalThis.fetch = (async () => new Response(\"{}\")) as typeof fetch;\nglobalThis.fetch = original;\nwindow.onload = null;\n" };
  for (const v of V4P) assert.equal(run(DUTC, fakeFetch, v, true), "ok", `fake fetch ${v}`);
  // a non-inert argument: the const is not a proven primitive (the load check refuses the call anyway)
  const nonInert = "function mk(): number { return 1; }\nconst E = Date.UTC(mk(), 0, 1);\nexport function f(x: number): number { return x - E; }\n";
  for (const v of V4P) assert.notEqual(run(nonInert, {}, v, true), "ok", `non-inert ${v}`);
});

// Auditor #505 option X, Math: a `Math.*(..)` const never passes the load check under v1-v7, so the Math relaxation is
// checked directly through the same repo check (primGlobalTouched = globalTouched over the scan's repo index).
test("repo scan: the global-root check for Math uses the same denylist (option X)", () => {
  const files = (o: Record<string, string>) => Object.entries({ "src/m.ts": "export const E = Math.max(1, 2);\n", ...o }).map(([path, content]) => ({ path, content }));
  assert.equal(primGlobalTouched(files({}), "Math"), null);
  assert.equal(primGlobalTouched(files({ "src/a.test.ts": "const original = globalThis.fetch;\nglobalThis.fetch = original;\nglobalThis.Date = class {} as never;\n" }), "Math"), null, "other names written");
  assert.match(primGlobalTouched(files({ "src/a.test.ts": "globalThis.Date = class {};\n" }), "Date") ?? "", /global_Date/, "the Date root still cancels Date");
  const attacks: Record<string, Record<string, string>> = {
    patch_member: { "src/s.js": "Math.max = function () { return []; };\n" },
    define_property: { "src/s.ts": "Object.defineProperty(Math, \"max\", { value: () => [] });\n" },
    reflect_set: { "src/s.ts": "Reflect.set(Math, \"max\", () => []);\n" },
    delete_member: { "src/s.js": "delete Math.max;\n" },
    alias_then_patch: { "src/s.ts": "const M: any = Math;\nM.max = () => [];\n" },
    global_object_plain_write: { "src/s.js": "globalThis.Math = {};\n" },
    global_object_plain_write_self: { "src/s.js": "self.Math = {};\n" },
    global_object_folded_key: { "src/s.js": "globalThis[\"Ma\" + \"th\"] = {};\n" },
    global_object_alias: { "src/s.ts": "const G: any = globalThis;\nG.Math = {};\n" },
    global_object_alias_other_name: { "src/s.ts": "const G: any = globalThis;\nG.fetch = 0;\n" },
    global_object_expando_then_alias: { "src/s.js": "globalThis.fetch = 0;\nconst G = globalThis;\nG.Math = {};\n" },
  };
  for (const [k, o] of Object.entries(attacks)) assert.match(primGlobalTouched(files(o), "Math") ?? "", /global_Math/, k);
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

// Job B (test-candidates.ts gradeExisting) re-checks the target with the repo list too, built by the one helper Job A
// uses (generate.ts: repoFileLists, scan output), so the scan cannot drift between the jobs. The shapes below are the seven
// builder-log TEST_CASE_EXISTING rows (seq 143, 144, 226, 227, 233, 249, 259) that grade again with it, behind a
// PeaceSTOCKS-shaped barrel re-exporting a denied module (src/index.ts `export * from "./scheduler"`): refused with no
// repo list, and with only the context list (the denied module is then unresolvable: fail closed).
test("Job A and Job B build the scan's repo list with repoFileLists; Job B passes it to both option objects", () => {
  const gen = readFileSync(new URL("../bin/generate.ts", import.meta.url), "utf8");
  const tc = readFileSync(new URL("../bin/test-candidates.ts", import.meta.url), "utf8");
  assert.match(gen, /const repoLists = repoFileLists\(tracked, scope, /);
  assert.match(tc, /const repo = repoFileLists\(gitIn\(tree, "ls-files", "-z", "--cached", "--others", "--exclude-standard"\)\.split\("\\0"\), scope, regular\)\.scan;/);
  const call = tc.split("\n").find((l) => l.includes("existingTargetRefusal(modPath, real, fn,"))!;
  assert.match(call, /dates: v3, v4, v5, v6, v7, repo \}/);
  assert.match(call, / : \{ load: \{ read: .*\}, repo \}\) !== null\)/);
});

const JOB_B_ROWS: Record<string, [string, Record<string, string>]> = {
  "143": ["export const R: ReadonlySet<string> = new Set([\"WAIT_A\", \"WAIT_B\"]);\nexport function f(x: string): boolean { return R.has(x); }\n",
    { "src/h.test.ts": "test(\"t\", async () => { const { f } = await import(\"./m\"); if (!f(\"WAIT_A\")) throw new Error(\"x\"); });\n" }],
  "144": ["export const C = new Set([\n  \"queued\",\n  \"in_progress\",\n]);\nexport function f(x: string): boolean { return C.has(x); }\n", {}],
  "226": ["export const D = [2, 3, 4, 5, 6] as const;\nexport function f(d: number): boolean { return (D as readonly number[]).includes(d); }\n", {}],
  "227": ["export const D = [2, 3, 4, 5, 6] as const;\nexport function f(d: number): number { for (let i = d; i >= 0; i--) if ((D as readonly number[]).includes(i)) return i; return -1; }\n", {}],
  "233": ["import { W } from \"./y\";\nexport function f(x: number): boolean { return W.some(([s, e]) => x >= s && x < e); }\n",
    { "src/y.ts": "export const W: ReadonlyArray<readonly [number, number]> = [\n  [320, 340],\n  [560, 580],\n];\n", "src/y.test.ts": "test(\"t\", async () => { const { W } = await import(\"./y\"); if (W.length !== 2) throw new Error(\"x\"); });\n" }],
  "249": ["const A = new Set([\"queued\", \"in_progress\", \"waiting\"]);\nexport function f(xs: string[]): number { return xs.filter((x) => A.has(x)).length; }\n", { "src/index.ts": "export * from \"./m\";\n" }],
  "259": ["import { W } from \"./y\";\nexport function f(x: number): number { for (const [s, e] of W) if (x < e) return Math.max(0, s - x); return -1; }\n",
    { "src/y.ts": "export const W: ReadonlyArray<readonly [number, number]> = [\n  [320, 340],\n  [560, 580],\n];\n" }],
};
test("Job B: the seven builder-log rows' target shapes grade again with the scan list (refused without it)", () => {
  const scope = { isSource: (p: string) => p.startsWith("src/"), isDenied: (p: string) => /(^|\/)(host|scheduler|backfill)\.ts$/.test(p) };
  for (const [seq, [t, o]] of Object.entries(JOB_B_ROWS)) {
    const all: Record<string, string> = { "src/m.ts": t, "src/scheduler.ts": "export function tick(): number { return 1; }\n", ...o, "src/index.ts": `export * from "./scheduler";\n${o["src/index.ts"] ?? ""}` };
    const { scan: repo, context } = repoFileLists(Object.keys(all), scope, (p) => all[p] ?? null);
    assert.equal(context.some((f) => f.path === "src/scheduler.ts"), false);
    const rd = { read: (rel: string) => (rel.endsWith(".test.ts") ? null : context.find((f) => f.path === rel)?.content ?? null) };
    for (const o2 of [{ v2: rd, dates: true, v4: true, v5: true }, { v2: rd, dates: true, v4: true, v5: true, v6: true, v7: true }]) {
      const why: { shared?: string } = {};
      assert.equal(existingTargetRefusal("src/m.ts", t, "f", { ...o2, repo, why }), null, `${seq}: ${why.shared}`);
      assert.notEqual(existingTargetRefusal("src/m.ts", t, "f", o2), null, `${seq} without a repo list`);
      const w2: { shared?: string } = {};
      assert.notEqual(existingTargetRefusal("src/m.ts", t, "f", { ...o2, repo: context, why: w2 }), null, `${seq} with the context list only`);
      assert.match(w2.shared ?? "", /repo: unresolved_relative_import:src\/index\.ts/, seq);
    }
  }
});
