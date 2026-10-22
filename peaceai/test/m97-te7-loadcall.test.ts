// #466 load-call allowance (after Auditor's 3rd review): a top-level const initializer / expression statement may call
// a function of the same closure only when the callee passes the full target purity analysis (callee mode, recursion-
// free), every argument is inert, omitted parameters have inert defaults, and the result is a primitive - or an array of
// primitives built only from the callee's own values, bound to a non-exported const that is only read in place.
// Each attack below must stay refused under v1-v7; the controls are accepted.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existingTargetRefusal } from "../lib/learned-test-existing.ts";

const F: Record<string, string> = {
 "back2.ts": "import { K } from \"./bad_back\";\nexport function viaBack(n: number): number { return n + K; }\n",
 "bad_alias.ts": "function days(n: number): number { return n * 2; }\nconst g = days;\nconst D = g(3);\nexport function f(x: number): number { return x + D; }\n",
 "bad_back.ts": "import { viaBack } from \"./back2\";\nconst D = viaBack(1);\nexport function f(x: number): number { return x + D; }\nexport const K = 3;\n",
 "bad_date.ts": "function d(n: number): string { const c = new Date(Date.UTC(2024, 0, 1)); c.setUTCDate(n); return c.toISOString(); }\nconst D = d(3);\nexport function f(x: string): string { return x + D; }\n",
 "bad_env.ts": "function flag(n: number, env: NodeJS.ProcessEnv = process.env): number { return env.PEACE_PROBE === \"1\" ? 1 : n; }\nconst D = flag(2);\nexport function f(x: number): number { return x + D; }\n",
 "bad_env2.ts": "function flag(n: number): number { return process.env.PEACE_PROBE === \"1\" ? 1 : n; }\nconst D = flag(2);\nexport function f(x: number): number { return x + D; }\n",
 "bad_export.ts": "function mk(n: number): string[] { return [\"a\"]; }\nexport const L = mk(1);\nexport function f(x: string): number { return L.indexOf(x); }\n",
 "bad_gen.ts": "function* gen(): Generator<number> { yield 1; }\nconst G = gen();\nexport function f(x: number): number { return x; }\n",
 "bad_impure.ts": "let C = 0;\nfunction bump(n: number): number { C++; return n + C; }\nconst D = bump(1);\nexport function f(x: number): number { return x + D; }\n",
 "bad_iter.ts": "function mk2(): IterableIterator<number> { return [1, 2, 3].values(); }\nconst IT = mk2();\nexport function f(x: number): number { return x + (IT.next().value ?? 0); }\n",
 "bad_let.ts": "function days(n: number): number { return n * 2; }\nlet D = days(3);\nexport function f(x: number): number { return x + D; }\n",
 "bad_member.ts": "const H = { days(n: number): number { return n * 2; } };\nconst D = H.days(3);\nexport function f(x: number): number { return x + D; }\n",
 "bad_mut.ts": "function mk(n: number): string[] { return [\"a\"]; }\nconst L = mk(1);\nexport function f(x: string): number { L.push(x); return L.length; }\n",
 "bad_mut2.ts": "function mk(n: number): string[] { return [\"a\"]; }\nconst L = mk(1);\nexport function f(x: string): number { return L.indexOf(x); }\nexport function g(): string[] { return L; }\n",
 "bad_mut3.ts": "function mk(n: number): string[] { return [\"a\"]; }\nconst L = mk(1);\nexport function f(x: string): number { return L.map((e, i, arr) => arr.length).length + L.indexOf(x); }\n",
 "bad_nonlit.ts": "function days(n: number): number { return n * 2; }\nconst D = days(Date.now());\nexport function f(x: number): number { return x + D; }\n",
 "bad_obj.ts": "function mk(n: number): { n: number } { return { n }; }\nconst O = mk(1);\nexport function f(x: number): number { return x + O.n; }\n",
 "bad_patch.ts": "function inst(n: number): number { (String.prototype as any).trim = () => \"x\"; return n; }\ninst(1);\nexport function f(s: string): string { return s.trim(); }\n",
 "bad_rec.ts": "function r(n: number): number { return r(n + 1); }\nconst D = r(1);\nexport function f(x: number): number { return x + D; }\n",
 "bad_rec2.ts": "function a1(n: number): number { return n > 0 ? b1(n - 1) : 0; }\nfunction b1(n: number): number { return a1(n); }\nconst D = a1(3);\nexport function f(x: number): number { return x + D; }\n",
 "bad_rec3.ts": "function r(n: number): number[] { return [n].map(r as never); }\nconst L = r(1);\nexport function f(x: number): number { return L.indexOf(x); }\n",
 "bad_rx.ts": "function mk(): RegExp { return /a/g; }\nconst RX = mk();\nexport function f(s: string): boolean { return RX.test(s); }\n",
 "bad_rxstatic.ts": "function m(s: string): string { /(a+)/.test(s); return RegExp.$1; }\nconst D = m(\"aa\");\nexport function f(x: string): string { return x + D; }\n",
 "bad_set.ts": "function mk(): Set<string> { return new Set([\"a\"]); }\nconst S = mk();\nexport function f(x: string): boolean { return S.has(x); }\n",
 "bad_shared.ts": "const BASE: string[] = [\"a\"];\nfunction mk(n: number): string[] { return BASE; }\nconst L = mk(1);\nexport function f(x: string): number { return L.indexOf(x); }\nexport function g(): void { BASE.push(\"b\"); }\n",
 "bad_state2.ts": "const S: { n: number } = { n: 0 };\nfunction rd(n: number): number { return n + S.n; }\nconst D = rd(1);\nexport function f(x: number): number { return x + D; }\nexport function g(): void { S.n++; }\n",
 "bad_state3.ts": "const S: { n: number } = { n: 0 };\nfunction rd(n: number): number { return n + S.n; }\nconst D = rd(1);\nexport function f(x: number): number { return x + D; }\nexport function g(o: { n: number }): void { o.n++; }\ng(S);\n",
 "bad_state4.ts": "import { S } from \"./st\";\nfunction rd(n: number): number { return n + S.n; }\nconst D = rd(1);\nexport function f(x: number): number { return x + D; }\n",
 "bad_unrelated.ts": "function boom(n: number): number { if (process.env.X) throw new Error(\"x\"); return n; }\nboom(1);\nexport function f(x: number): number { return x; }\n",
 "h.ts": "export function pureLen(s: string): number { return s.length; }\n",
 "ok1.ts": "function days(n: number): number { return n * 2; }\nconst D = days(3);\nexport function f(x: number): number { return x + D; }\n",
 "ok2.ts": "function list(n: number): string[] { const o: string[] = []; for (let i = 0; i < n; i++) o.push(`s${i}`); return o; }\nconst L = list(3);\nexport function f(x: string): boolean { return L.includes(x) && L.length === 3; }\n",
 "ok3.ts": "import { pureLen } from \"./h\";\nconst N = pureLen(\"abcd\");\nexport function f(x: number): number { return x * N; }\n",
 "ok_state_inert.ts": "const S: { n: number } = { n: 0 };\nfunction rd(n: number): number { return n + S.n; }\nconst D = rd(1);\nexport function f(x: number): number { return x + D; }\n",
 "st.ts": "export const S: { n: number } = { n: 0 };\nexport function bump(): void { S.n++; }\n"
};
const SIB: Record<string, string[]> = {"bad_back": ["back2.ts"], "ok3": ["h.ts"], "bad_state4": ["st.ts"]};
const VERS = ["v1", "v2", "v3", "v4", "v5", "v6", "v7"] as const;
function verdicts(name: string): Record<string, string> {
  const own: Record<string, string> = { [`src/${name}.ts`]: F[`${name}.ts`]! };
  for (const s of SIB[name] ?? []) own[`src/${s}`] = F[s]!;
  const rd = { read: (rel: string) => own[rel] ?? null };
  const O: Record<string, object> = { v1: { load: rd }, v2: { v2: rd }, v3: { v2: rd, dates: true }, v4: { v2: rd, dates: true, v4: true }, v5: { v2: rd, dates: true, v4: true, v5: true }, v6: { v2: rd, v6: true }, v7: { v2: rd, v7: true } };
  return Object.fromEntries(VERS.map((v) => [v, existingTargetRefusal(`src/${name}.ts`, own[`src/${name}.ts`]!, "f", O[v] as never) ?? "ok"]));
}

const ATTACKS: Record<string, string> = {
  bad_impure: "callee bumps module state", bad_state2: "callee reads a module object written by another export", bad_state3: "callee reads a module object mutated through an alias call",
  bad_state4: "callee reads an imported object a sibling mutates", bad_shared: "callee returns a shared mutable array mutated elsewhere", bad_mut: "array result mutated by the target",
  bad_mut2: "array result exposed by another export", bad_mut3: "array result exposed through a map callback's 3rd parameter", bad_export: "array result bound to an exported const",
  bad_env: "omitted parameter with a process.env default", bad_env2: "callee reads process.env", bad_alias: "callee reached through a const alias", bad_back: "callee imported from a module that imports the caller back",
  bad_rx: "callee returns a /g regex", bad_iter: "callee returns an iterator", bad_gen: "callee is a generator", bad_set: "callee returns a Set", bad_obj: "callee returns an object",
  bad_nonlit: "non-inert argument (clock)", bad_patch: "callee patches a global", bad_rec: "self-recursive callee", bad_rec2: "mutually recursive callees", bad_rec3: "callee passes itself as a callback",
  bad_member: "callee is an object method", bad_let: "call result bound to let", bad_rxstatic: "callee reads RegExp statics", bad_date: "callee uses a Date setter", bad_unrelated: "impure top-level call unrelated to the target",
};

test("load-call allowance: every attack stays refused under v1-v7", () => {
  for (const [k, why] of Object.entries(ATTACKS)) { const v = verdicts(k); for (const ver of VERS) assert.notEqual(v[ver], "ok", `${k} (${why}) ${ver}`); }
  assert.deepEqual(Object.keys(F).filter((f) => f.startsWith("bad_")).map((f) => f.slice(0, -3)).sort(), Object.keys(ATTACKS).sort());
});

test("load-call allowance: controls are accepted", () => {
  // a pure same-module callee returning a number; a locally built string[] read only in place; a pure imported callee
  // (v1 does not follow relative imports at all); a callee reading a never-written module object is as inert as the target reading it
  for (const k of ["ok1", "ok2", "ok_state_inert"]) assert.ok(VERS.every((v) => verdicts(k)[v] === "ok"), k);
  assert.deepEqual(verdicts("ok3"), { v1: "test_target_impure", v2: "ok", v3: "ok", v4: "ok", v5: "ok", v6: "ok", v7: "ok" });
});
