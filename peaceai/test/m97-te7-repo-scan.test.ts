// Auditor ruling on the #466 load-call allowance, part (c): a module binding the target reads (a literal or a call
// result, exported or not) must not be written, handed out or passed on by ANY module of the repo, test files
// included; unparseable modules, dynamic imports / requires and escaping namespace imports fail closed. Each attack
// below is refused under v1-v7 with the repo list (Job A's `files`); the controls stay accepted; without a repo list a
// read binding holding state is refused (fail closed).
import { test } from "node:test";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { existingTargetRefusal, existingTargetAnalysisForEvidence, constGlobalRoots, primGlobalTouched, repoFileLists, type RepoFile } from "../lib/learned-test-existing.ts";

const LIT = "export const L: string[] = [\"a\", \"b\"];\nexport function f(x: string): number { return L.indexOf(x); }\n";
const CALL = "function mk(n: number): string[] { return [\"a\", \"b\"]; }\nexport const L = mk(1);\nexport function f(x: string): number { return L.indexOf(x); }\n";
const OBJ = "export const O: { n: number } = { n: 1 };\nexport function f(x: number): number { return x + O.n; }\n";
const ENUM = "export enum E { A = 1, B = 2 }\nexport function f(x: number): number { return x + E.A; }\n";
const CALL_LOCAL = "function mk(n: number): string[] { return [\"a\", \"b\"]; }\nconst L = mk(1);\nexport function f(x: string): number { return L.indexOf(x); }\n";
const RX = "export const RX = /^[a-z]+$/;\nexport function f(x: string): boolean { return RX.test(x); }\n";
const NOEXP = "const L: string[] = [\"a\", \"b\"];\nexport function f(x: string): number { return L.indexOf(x); }\nexport function g(): string[] { return L; }\n";

const DUTC_X = "export const E = Date.UTC(1970, 0, 1);\nexport function f(x: number): number { return x - E; }\n";
const MATH_PI = "export const E = Math.PI;\nexport function f(x: number): boolean { return x === E; }\n";
const MATH_PI_NESTED = "export const E = [Math.PI, { p: Math.E * 2 }];\nexport function f(x: number): boolean { return x === E[0]; }\n";
const MATH_PI_VIA_CONST = "const P = Math.PI;\nexport const E = P;\nexport function f(x: number): boolean { return x === E; }\n";
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
  // Auditor #505 Math.PI gap: a const reading a member of Math goes through the same global-root check
  PI_global_object_plain_write: [MATH_PI, { "src/s.js": "globalThis.Math = { PI: [] };\n" }],
  PI_global_object_cast_write: [MATH_PI, { "src/s.ts": "(globalThis as any).Math = { PI: [] };\n" }],
  PI_define_property_global_object: [MATH_PI, { "src/s.ts": "Object.defineProperty(globalThis, \"Math\", { value: { PI: [] } });\n" }],
  PI_direct_patch: [MATH_PI, { "src/s.js": "Math.PI = 4;\n" }],
  PI_define_property_member: [MATH_PI, { "src/s.ts": "Object.defineProperty(Math, \"PI\", { value: [] });\n" }],
  PI_alias_patch_in_test: [MATH_PI, { "src/s.test.ts": "const M: any = Math;\nM.PI = [];\n" }],
  PI_nested_literal: [MATH_PI_NESTED, { "src/s.js": "globalThis.Math = { PI: [], E: [] };\n" }],
  PI_via_module_const: [MATH_PI_VIA_CONST, { "src/s.ts": "Object.defineProperty(globalThis, \"Math\", { value: { PI: [] } });\n" }],
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
  PI_unpatched: [MATH_PI, { "src/s.ts": "export const g = (): number => Math.PI * 2 + Math.max(1, 2);\n", "src/a.test.ts": "const original = globalThis.fetch;\nglobalThis.fetch = original;\n" }],
  PI_nested_unpatched: [MATH_PI_NESTED, {}],
  PI_via_module_const_unpatched: [MATH_PI_VIA_CONST, {}],
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

// Auditor #505 Math.PI gap, forms the v1-v7 load check refuses on its own (a nested call, a computed key, Date members):
// the const still routes its root through the global-root check, and a repo-wide mutation of that root cancels.
test("repo scan: every const reading a member of Math or Date (nested, computed, through a const) names that root", () => {
  const cases: [string, string[]][] = [
    ["export const E = Math.PI;", ["Math"]],
    ["export const E = Math.PI.toString();", ["Math"]],
    ["export const E = Math[\"P\" + \"I\"];", ["Math"]],
    ["export const E = (Math as { PI: number }).PI;", ["Math"]],
    ["export const E = [{ p: Math.E }];", ["Math"]],
    ["const P = Math.PI;\nexport const E = { P };", ["Math"]],
    ["export const E = Date.prototype;", ["Date"]],
    ["export const E = Date.now;", ["Date"]],
    ["export const E = Date.UTC(1970, 0, 1) + Math.PI;", ["Date", "Math"]],
    ["export const E = 3.14;", []],
    ["export const E = { Math: 1, PI: 2 };", []],
    ["const Math = { PI: 3 };\nexport const E = Math.PI;", []],
  ];
  for (const [src, roots] of cases) assert.deepEqual(constGlobalRoots(src, "E"), roots, src);
  const files = (o: Record<string, string>) => Object.entries({ "src/m.ts": "export const E = Date.prototype;\n", ...o }).map(([path, content]) => ({ path, content }));
  assert.equal(primGlobalTouched(files({}), "Date"), null);
  for (const o of <Record<string, string>[]>[{ "src/s.js": "globalThis.Date = class {};\n" }, { "src/s.ts": "(globalThis as any).Date = class {};\n" }, { "src/s.ts": "Object.defineProperty(globalThis, \"Date\", { value: 1 });\n" }, { "src/s.js": "Date.now = () => 0;\n" }])
    assert.match(primGlobalTouched(files(o), "Date") ?? "", /global_Date/, JSON.stringify(o));
  for (const o of [{ "src/s.js": "globalThis.Math = { PI: [] };\n" }, { "src/s.js": "globalThis[\"Ma\" + \"th\"] = {};\n" }])
    assert.match(primGlobalTouched(files(o), "Math") ?? "", /global_Math/, JSON.stringify(o));
});

// Auditor #505 final review at aa6a6b2 (B1-B3). Each repro: [target, other files, expected diagnostic]. The target alone
// (no other files, or only the helper module it imports) is accepted on the listed versions, and with the other files it is refused there with that diagnostic.
const KD = "function k(): number { return Date.UTC(1970, 0, 1); }\nexport const E = k();\nexport function f(x: number): number { return x - E; }\n";
const KM = "function k(): number { return Math.PI; }\nexport const E = k();\nexport function f(x: number): number { return x + E; }\n";
const KX = "import { k } from \"./c\";\nexport const E = k();\nexport function f(x: number): number { return x + E; }\n";
const KC = "class C { static k(): number { return Math.PI; } }\nexport const E = C.k();\nexport function f(x: number): number { return x + E; }\n";
const C_TS = "export function k(): number { return Math.PI; }\n";
const HT = (h: string, path = "src/h.ts"): Record<string, string> => ({ [path]: h, "src/x.test.ts": `import "./${path.slice(4).replace(/\.ts$/, "")}";\nimport { f } from "./m";\nimport test from "node:test";\ntest("t", () => { f(1); });\n` });
const FINAL: Record<string, [string, Record<string, string>, RegExp, readonly (typeof VERS)[number][], Record<string, string>?]> = {
  B1_fn_decl_Date_UTC_write: [KD, { "src/x.test.ts": "Date.UTC = () => 5;\n" }, /E: global_Date_shadowed_or_patched/, VERS],
  B1_fn_decl_globalThis_Date: [KD, { "src/x.test.ts": "(globalThis as any).Date = { UTC: () => 5 };\n" }, /E: global_(?:Math|Date)_via_global_object/, VERS],
  B1_fn_decl_globalThis_Math: [KM, { "src/x.test.ts": "(globalThis as any).Math = { PI: 4 };\n" }, /E: global_Math_via_global_object/, VERS],
  B1_fn_decl_Math_PI_write: [KM, { "src/x.test.ts": "Object.defineProperty(Math, \"PI\", { value: 4 });\n" }, /E: global_Math_shadowed_or_patched/, VERS],
  B1_imported_fn_globalThis_Math: [KX, { "src/c.ts": C_TS, "src/x.test.ts": "(globalThis as any).Math = { PI: 4 };\n" }, /E: global_Math_via_global_object/, ["v2", "v3", "v4", "v5", "v6", "v7"], { "src/c.ts": C_TS }],
  B1_class_static_method: [KC, { "src/x.test.ts": "(globalThis as any).Math = { PI: 4 };\n" }, /E: global_Math_via_global_object/, []],
  B2_arrow_constructor: [DUTC_X, HT("(() => {}).constructor(\"Date.UTC = () => 5\")();\nexport {};\n"), /repo: constructor_access:src\/h\.ts/, VERS],
  B2_async_constructor: [DUTC_X, HT("Object.getPrototypeOf(async () => {}).constructor(\"globalThis.Math = { PI: 4 }\");\nexport {};\n"), /repo: constructor_access:src\/h\.ts/, VERS],
  B2_array_constructor_constructor: [MATH_PI, HT("[].constructor.constructor(\"globalThis.Math = { PI: 4 }\")();\nexport {};\n"), /repo: constructor_access:src\/h\.ts/, VERS],
  B2_constructor_element_access: [MATH_PI, HT("([] as any)[\"constructor\"][\"constructor\"](\"Math.PI = 4\")();\nexport {};\n"), /repo: constructor_access:src\/h\.ts/, VERS],
  B2_vm_named_import: [DUTC_X, HT("import { runInThisContext } from \"node:vm\";\nrunInThisContext(\"Date.UTC = () => 6\");\nexport {};\n"), /repo: code_loader_import_vm:src\/h\.ts/, VERS],
  B2_vm_default_import: [MATH_PI, HT("import vm from \"vm\";\nvm.runInThisContext(\"Math.PI = 4\");\nexport {};\n"), /repo: code_loader_import_vm:src\/h\.ts/, VERS],
  B2_vm_dynamic_import: [DUTC_X, HT("export async function g(): Promise<void> { (await import(\"node:vm\")).runInThisContext(\"Date.UTC = () => 6\"); }\n"), /repo: code_loader_import_vm:src\/h\.ts/, VERS],
  B2_vm_require: [DUTC_X, HT("require(\"vm\").runInThisContext(\"Date.UTC = () => 6\");\n", "src/h.cjs"), /repo: code_loader_import_vm:src\/h\.cjs/, VERS],
  B2_getBuiltinModule: [DUTC_X, HT("(process as any).getBuiltinModule(\"node:vm\").runInThisContext(\"Date.UTC = () => 6\");\nexport {};\n"), /repo: getBuiltinModule:src\/h\.ts/, VERS],
  B2_getBuiltinModule_alias: [DUTC_X, HT("const p: any = process;\np.getBuiltinModule(\"node:vm\");\nexport {};\n"), /repo: getBuiltinModule:src\/h\.ts/, VERS],
  B3a_createRequire: [DUTC_X, HT("import { createRequire } from \"node:module\";\ncreateRequire(import.meta.url)(\"../scripts/evil.cjs\");\nexport {};\n"), /repo: code_loader_import_module:src\/h\.ts/, VERS],
  B3a_module_require: [MATH_PI, HT("const m = require(\"module\");\nm.createRequire(__filename)(\"../scripts/evil.cjs\");\n", "src/h.cjs"), /repo: code_loader_import_module:src\/h\.cjs/, VERS],
  B3b_cjs_sloppy_this: [DUTC_X, HT("(function () { return this; })().Date = { UTC: () => 9 };\n", "src/h.cjs"), /E: global_Date_via_sloppy_this at src\/h\.cjs:1/, VERS],
  B3b_cjs_sloppy_this_Math: [MATH_PI, HT("(function () { return this; })().Math = { PI: 4 };\n", "src/h.cjs"), /E: global_Math_via_sloppy_this at src\/h\.cjs:1/, VERS],
  B3b_cts_sloppy_this: [DUTC_X, HT("function g(this: any): void { this.Date = { UTC: () => 9 }; }\ng.call(undefined);\n", "src/h.cts"), /E: global_Date_via_sloppy_this at src\/h\.cts:1/, VERS],
  B3b_script_js_sloppy_this: [MATH_PI, HT("var g = function () { return this; };\ng().Math = { PI: 4 };\n", "src/h.js"), /E: global_Math_via_sloppy_this at src\/h\.js:1/, VERS],
  B3b_cjs_top_level_this: [DUTC_X, HT("this.x = 1;\n", "src/h.cjs"), /E: global_Date_via_sloppy_this at src\/h\.cjs:1/, VERS],
};
test("repo scan (Auditor #505 final): B1-B3 repros are refused with their diagnostic", () => {
  for (const [k, [t, o, re, vs, base]] of Object.entries(FINAL)) {
    for (const v of VERS) assert.notEqual(run(t, o, v, true), "ok", `${k} ${v}`);
    for (const v of vs) {
      assert.equal(run(t, base ?? {}, v, true), "ok", `${k} ${v}: the target alone is accepted`);
      const why: { shared?: string } = {};
      run(t, o, v, true, (p, c, f, opts) => existingTargetRefusal(p, c, f, { ...(opts as object), why } as never));
      assert.match(why.shared ?? "", re, `${k} ${v}`);
    }
  }
});
test("repo scan (Auditor #505 final): helpers, classes, strict code and other modules stay accepted without a mutation", () => {
  const ok: Record<string, [string, Record<string, string>, readonly (typeof VERS)[number][]]> = {
    plain_helper_Date: [KD, { "src/x.test.ts": "import { f } from \"./m\";\nf(1);\n" }, VERS],
    plain_helper_Math: [KM, { "src/s.ts": "export const g = (): number => Math.abs(-1) + Date.UTC(1970, 0, 1);\n" }, VERS],
    imported_helper: [KX, { "src/c.ts": C_TS }, ["v2", "v3", "v4", "v5", "v6", "v7"]],
    helper_fake_fetch: [KD, { "src/a.test.ts": "const original = globalThis.fetch;\nglobalThis.fetch = original;\n" }, VERS],
    class_own_constructor: [DUTC_X, HT("export class K { n: number; constructor() { this.n = 1; } m(): number { return this.n; } }\n"), VERS],
    esm_js_function_this: [DUTC_X, HT("export function g() { return this; }\n", "src/h.js"), VERS],
    strict_cjs_function_this: [MATH_PI, HT("\"use strict\";\n(function () { return this; })();\n", "src/h.cjs"), VERS],
    cjs_class_method_and_arrow_this: [MATH_PI, HT("class K { m() { return () => this; } }\nmodule.exports = { K };\n", "src/h.cjs"), VERS],
    other_node_builtins: [DUTC_X, HT("import { join } from \"node:path\";\nimport { readFileSync } from \"node:fs\";\nexport const j = (): string => join(\"a\", String(readFileSync.length));\n"), VERS],
  };
  for (const [k, [t, o, vs]] of Object.entries(ok)) for (const v of vs) assert.equal(run(t, o, v, true), "ok", `${k} ${v}`);
});
// Auditor #505 delta review at 84b03bf (X1-X4), same shape as FINAL: refused v1-v7 with the diagnostic, and the target
// alone accepted on the listed versions.
const EK = "enum K { A = Math.PI }\nexport const E = K.A;\nexport function f(x: number): number { return x + E; }\n";
const EKC = "const enum K { A = Math.PI }\nexport const E = K.A;\nexport function f(x: number): number { return x + E; }\n";
const EKD = "enum K { A = 1 }\nexport const E = K.A;\nexport function f(x: number): number { return x + E; }\n";
const EKR = "enum K { A = Math.PI }\nexport function f(x: number): number { return x + K.A; }\n";
const NS = "namespace N { export const A = 1; }\nexport const E = N.A;\nexport function f(x: number): number { return x + E; }\n";
const GM = { "src/x.test.ts": "(globalThis as any).Math = { PI: 4 };\n" };
const GD = { "src/x.test.ts": "(globalThis as any).Date = { UTC: () => 5 };\n" };
const CA = /repo: constructor_access:src\/h\.ts/, GB = /repo: getBuiltinModule:src\/h\.ts/, UL = /repo: unlisted_import_specifier:src\/h\.ts/;
const DELTA: Record<string, [string, Record<string, string>, RegExp, readonly (typeof VERS)[number][], Record<string, string>?]> = {
  X1_enum_Math_PI: [EK, GM, /E: global_Math_via_global_object/, VERS],
  X1_const_enum_Math_PI: [EKC, GM, /E: global_Math_via_global_object/, VERS],
  X1_enum_literal_member_globalThis_Date: [EKD, GD, /E: global_(?:Math|Date)_via_global_object/, VERS],
  X1_enum_read_directly: [EKR, GM, /global_Math_via_global_object/, VERS],
  X1_namespace_member: [NS, GM, /./, []],
  X2_destructured_constructor: [DUTC_X, HT("const { constructor: C } = (() => 0) as any;\nC(\"Date.UTC = () => 5\")();\nexport {};\n"), CA, VERS],
  X2_shorthand_constructor: [DUTC_X, HT("const { constructor } = (() => 0) as any;\nconstructor(\"Date.UTC = () => 5\")();\nexport {};\n"), CA, VERS],
  X2_parameter_destructuring: [DUTC_X, HT("function g({ constructor: C }: any): void { C(\"Date.UTC = () => 5\")(); }\ng(() => 0);\nexport {};\n"), CA, VERS],
  X2_reflect_get: [DUTC_X, HT("(Reflect.get(() => 0, \"constructor\") as any)(\"Date.UTC = () => 5\")();\nexport {};\n"), CA, VERS],
  X2_get_own_property_descriptor: [MATH_PI, HT("(Object.getOwnPropertyDescriptor(Object.getPrototypeOf(() => 0), \"constructor\") as any).value(\"Math.PI = 4\")();\nexport {};\n"), CA, VERS],
  X2_template_literal: [DUTC_X, HT("((() => 0) as any)[`constructor`](\"Date.UTC = () => 5\")();\nexport {};\n"), CA, VERS],
  X2_template_part: [DUTC_X, HT("((() => 0) as any)[`${\"\"}constructor`](\"Date.UTC = () => 5\")();\nexport {};\n"), CA, VERS],
  X2_destructured_getBuiltinModule: [DUTC_X, HT("const { getBuiltinModule: g } = process as any;\ng(\"node:vm\").runInThisContext(\"Date.UTC = () => 5\");\nexport {};\n"), GB, VERS],
  X2_reflect_get_getBuiltinModule: [DUTC_X, HT("(Reflect.get(process, \"getBuiltinModule\") as any)(\"node:vm\");\nexport {};\n"), GB, VERS],
  X3_data_url: [DUTC_X, HT("import \"data:text/javascript,Date.UTC=()=>5\";\nexport {};\n"), UL, VERS],
  X3_file_url: [DUTC_X, HT("import \"file:///tmp/evil2.mjs\";\nexport {};\n"), UL, VERS],
  X3_http_url: [MATH_PI, HT("import \"http://example.com/e.mjs\";\nexport {};\n"), UL, VERS],
  X3_export_star_data_url: [DUTC_X, HT("export * from \"data:text/javascript,export const a = 1\";\n"), UL, VERS],
  X3_node_inspector: [DUTC_X, HT("import inspector from \"node:inspector\";\nvoid inspector;\nexport {};\n"), UL, VERS],
  X3_node_repl: [DUTC_X, HT("import \"node:repl\";\nexport {};\n"), UL, VERS],
  X3_unlisted_builtin_bare: [DUTC_X, HT("import \"worker_threads\";\nexport {};\n"), UL, VERS],
  X3_npm_package: [DUTC_X, HT("import _ from \"lodash\";\nvoid _;\nexport {};\n"), UL, VERS],
  X3_bare_test_is_a_package: [DUTC_X, HT("import \"test\";\nexport {};\n"), UL, VERS],
  X4_cjs_object_method: [DUTC_X, HT("const o = { m() { return this; } };\n(0, o.m)().Date = { UTC: () => 9 };\n", "src/h.cjs"), /E: global_Date_via_sloppy_this at src\/h\.cjs:1/, VERS],
  X4_cjs_object_getter: [DUTC_X, HT("const o = { get g() { return this; } };\nObject.getOwnPropertyDescriptor(o, \"g\").get.call(undefined).Date = { UTC: () => 9 };\n", "src/h.cjs"), /E: global_Date_via_sloppy_this at src\/h\.cjs:1/, VERS],
  X4_cjs_object_setter: [MATH_PI, HT("const o = { set s(v) { this.Math = v; } };\nObject.getOwnPropertyDescriptor(o, \"s\").set.call(undefined, { PI: 4 });\n", "src/h.cjs"), /E: global_Math_via_sloppy_this at src\/h\.cjs:1/, VERS],
  X4_script_js_object_method: [MATH_PI, HT("var o = { m: function () { return this; }, n() { return this; } };\n(0, o.n)().Math = { PI: 4 };\n", "src/h.js"), /E: global_Math_via_sloppy_this at src\/h\.js:1/, VERS],
  // Auditor #505 r5 (X4): `this` in a heritage clause, a computed member key or a decorator is the enclosing `this`
  X4_cjs_heritage_clause: [DUTC_X, HT("(function () { class C extends ((this.Date = { UTC: () => 9 }), Object) {} void C; })();\n", "src/h.cjs"), /E: global_Date_via_sloppy_this at src\/h\.cjs:1/, VERS],
  X4_cjs_static_computed_key: [DUTC_X, HT("(function () { class C { static [(this.Date = { UTC: () => 9 }, \"k\")]() {} } void C; })();\n", "src/h.cjs"), /E: global_Date_via_sloppy_this at src\/h\.cjs:1/, VERS],
  X4_cjs_field_computed_key: [DUTC_X, HT("function g() { let G; class C { [(G = this, \"k\")] = 1; } void C; return G; }\ng().Date = { UTC: () => 9 };\n", "src/h.cjs"), /E: global_Date_via_sloppy_this at src\/h\.cjs:1/, VERS],
  X4_cjs_accessor_computed_key: [MATH_PI, HT("function g() { let G; class C { get [(G = this, \"k\")]() { return 1; } } void C; return G; }\ng().Math = { PI: 4 };\n", "src/h.cjs"), /E: global_Math_via_sloppy_this at src\/h\.cjs:1/, VERS],
  X4_cjs_class_decorator: [DUTC_X, HT("function g() { let G; @((G = this, (c) => c)) class C {} void C; return G; }\ng().Date = { UTC: () => 9 };\n", "src/h.cjs"), /E: global_Date_via_sloppy_this at src\/h\.cjs:1/, VERS],
  X4_cjs_member_decorator: [DUTC_X, HT("function g() { let G; class C { @((G = this, () => {})) m() {} } void C; return G; }\ng().Date = { UTC: () => 9 };\n", "src/h.cjs"), /E: global_Date_via_sloppy_this at src\/h\.cjs:1/, VERS],
  X4_cjs_nested_class_in_heritage: [DUTC_X, HT("function g() { let G; class C extends class { static s = (G = 0); } { [(G = this, \"k\")] = 1; } void C; return G; }\ng().Date = { UTC: () => 9 };\n", "src/h.cjs"), /E: global_Date_via_sloppy_this at src\/h\.cjs:1/, VERS],
};
test("repo scan (Auditor #505 delta): X1-X4 repros are refused with their diagnostic", () => {
  for (const [k, [t, o, re, vs, base]] of Object.entries(DELTA)) {
    for (const v of VERS) assert.notEqual(run(t, o, v, true), "ok", `${k} ${v}`);
    for (const v of vs) {
      assert.equal(run(t, base ?? {}, v, true), "ok", `${k} ${v}: the target alone is accepted`);
      const why: { shared?: string } = {};
      run(t, o, v, true, (p, c, f, opts) => existingTargetRefusal(p, c, f, { ...(opts as object), why } as never));
      assert.match(why.shared ?? "", re, `${k} ${v}`);
    }
  }
});
test("repo scan (Auditor #505 delta): the matching positives stay accepted (allowlisted builtins, own constructors, strict and class `this`, enums with no mutation)", () => {
  const BUILTINS = ["path", "fs", "url", "util", "assert", "crypto", "events", "os", "stream", "timers", "buffer", "assert/strict", "fs/promises", "child_process", "zlib", "perf_hooks", "http", "process"];
  const imports = [...BUILTINS.flatMap((b, i) => [`import * as n${i} from "node:${b}";`, `import * as b${i} from "${b}";`]), "import * as t0 from \"node:test\";"].join("\n");
  const ok: Record<string, [string, Record<string, string>, readonly (typeof VERS)[number][]]> = {
    every_allowlisted_builtin: [DUTC_X, HT(`${imports}\nexport const u = [${BUILTINS.map((_, i) => `n${i}, b${i}`).join(", ")}, t0].length;\n`), VERS],
    type_only_package_import: [DUTC_X, HT("import type { Foo } from \"lodash\";\nexport type { Bar } from \"some-pkg\";\nexport const x: Foo | null = null;\n"), VERS],
    class_own_constructor_and_super: [DUTC_X, HT("export class A { n = 1; constructor() { this.n = 2; } }\nexport class B extends A { constructor() { super(); this.n = 3; } }\n"), VERS],
    cjs_class_members_this: [MATH_PI, HT("class K { x = () => this; static s() { return this; } get g() { return this; } set h(v) { this.v = v; } constructor() { this.v = 0; } m() { return this; } }\nmodule.exports = { K };\n", "src/h.cjs"), VERS],
    strict_cjs_object_method_this: [DUTC_X, HT("\"use strict\";\nconst o = { m() { return this; } };\n(0, o.m)();\n", "src/h.cjs"), VERS],
    mjs_object_method_this: [DUTC_X, HT("const o = { m() { return this; } };\n(0, o.m)();\nexport {};\n", "src/h.mjs"), VERS],
    esm_js_object_method_this: [DUTC_X, HT("const o = { m() { return this; } };\nexport const r = (0, o.m)();\n", "src/h.js"), VERS],
    enum_and_const_enum_without_mutation: [EK, {}, VERS],
    const_enum_without_mutation: [EKC, { "src/s.ts": "export const g = (): number => Math.abs(-1);\n" }, VERS],
    literal_enum_with_other_global_write: [EKD, { "src/a.test.ts": "const original = globalThis.fetch;\nglobalThis.fetch = original;\n" }, VERS],
    math_pi_const: [MATH_PI, {}, VERS],
    cjs_this_in_body_field_static_block: [DUTC_X, HT("class B {}\nclass C extends B { [\"k\"] = this; f = () => this; static s = this; static { this.t = 1; } m(a = this) { return [a, this]; } get [\"g\"]() { return this; } }\nclass D { [Symbol.iterator]() { return this; } }\nmodule.exports = { C, D };\n", "src/h.cjs"), VERS],
    cjs_computed_key_in_class_method_body: [DUTC_X, HT("class C { m() { class I { [String(this)] = 1; } return { [this.k]: 1, I }; } }\nmodule.exports = { C };\n", "src/h.cjs"), VERS],
  };
  for (const [k, [t, o, vs]] of Object.entries(ok)) for (const v of vs) assert.equal(run(t, o, v, true), "ok", `${k} ${v}`);
});
test("repo scan (Auditor #505 final): past the depth bound the member-read roots refuse (a sentinel), never stop silently", () => {
  const chain = Array.from({ length: 16 }, (_, i) => `const C${i} = ${i === 0 ? "1" : `C${i - 1}`};`).join("\n");
  assert.deepEqual(constGlobalRoots(`${chain}\nexport const E = C15;`, "E"), ["<too_deep>"]);
  assert.deepEqual(constGlobalRoots(`${chain.split("\n").slice(0, 8).join("\n")}\nexport const E = C7;`, "E"), []);
  assert.deepEqual(constGlobalRoots("function k(): number { return 1; }\nexport const E = k();", "E"), ["Date", "Math"]);
  assert.deepEqual(constGlobalRoots("import { k } from \"./c\";\nexport const E = [0].map(k);", "E"), ["Date", "Math"]);
  assert.deepEqual(constGlobalRoots("import type { T } from \"./c\";\nexport const E = 1 as T;", "E"), []);
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
