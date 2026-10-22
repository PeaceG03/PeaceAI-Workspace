// #466 (Auditor ruling): Date setters on a FRESH LOCAL Date are sound under exact conditions (freshDateSetters in
// learned-test-existing.ts): (a) the Date is `new Date(arg, ...)` with >= 1 argument declared in the same function, not fed
// by the clock; (b) only setTime / setUTC* (local-time setters, local getters, toString / toLocale* stay refused);
// (c) no mutation after any escape (call argument, container / property store, closure capture, alias, destructuring);
// returning after the mutations is fine; (d) Date.prototype patches stay refused by the global-patch check.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existingTargetRefusal } from "../lib/learned-test-existing.ts";

const F: Record<string, string> = {
 "bad_alias": "export function f(s: string): number { const d = new Date(s); const e = d; d.setUTCDate(1); return e.getTime(); }\n",
 "bad_callerMut": "function mk(s: string): Date { return new Date(s); }\nexport function f(s: string): string { const d = mk(s); d.setUTCDate(1); return d.toISOString(); }\n",
 "bad_callerMut2": "function mk(s: string): Date { const d = new Date(s); return d; }\nexport function f(s: string): string { const e = mk(s); e.setUTCDate(1); return e.toISOString(); }\n",
 "bad_capture": "export function f(s: string): number { const d = new Date(s); const later = () => d.getTime(); d.setUTCDate(1); return later(); }\n",
 "bad_capture2": "export function f(s: string): number { const d = new Date(s); const bump = (): void => { d.setUTCDate(d.getUTCDate() + 1); }; bump(); return d.getTime(); }\n",
 "bad_concat": "export function f(s: string): string { return \"\" + new Date(s); }\n",
 "bad_container": "const STORE: Date[] = [];\nexport function f(s: string): number { const d = new Date(s); STORE.push(d); d.setUTCDate(1); return STORE.length; }\n",
 "bad_container2": "const STORE: Date[] = [];\nexport function f(s: string): number { const d = new Date(s); d.setUTCDate(1); STORE.push(d); return STORE.length; }\n",
 "bad_dateShadow": "class Date { constructor(public s: string) {} setUTCDate(n: number): number { return n; } }\nexport function f(s: string): number { const d = new Date(s); return d.setUTCDate(1); }\n",
 "bad_destr": "export function f(s: string): number { const d = new Date(s); const [e] = [d]; e.setUTCDate(1); return d.getTime(); }\n",
 "bad_destr2": "export function f(s: string): number { const d = new Date(s); const { x } = { x: d }; d.setUTCDate(1); return x.getTime(); }\n",
 "bad_extract": "export function f(s: string): number { const d = new Date(s); const set = d.setUTCDate; set.call(d, 1); return d.getTime(); }\n",
 "bad_forHeader": "export function f(a: string, b: string): Date[] { const out: Date[] = []; for (const c = new Date(a); c.getTime() <= new Date(b).getTime(); c.setUTCDate(c.getUTCDate() + 1)) out.push(c); return out; }\n",
 "bad_getHours": "export function f(s: string): number { const d = new Date(s); d.setUTCDate(1); return d.getHours(); }\n",
 "bad_helperMut": "function bump(x: Date): void { x.setUTCDate(1); }\nexport function f(s: string): number { const d = new Date(s); bump(d); return d.getTime(); }\n",
 "bad_helperPass": "function keep(x: Date): Date { return x; }\nexport function f(s: string): number { const d = new Date(s); const e = keep(d); d.setUTCDate(1); return e.getTime(); }\n",
 "bad_loopEsc": "export function f(xs: string[]): number { const arr: Date[] = []; const d = new Date(0); for (const x of xs) { d.setUTCDate(x.length); arr.push(d); } return arr.length; }\n",
 "bad_module": "const D = new Date(0);\nexport function f(n: number): number { D.setUTCDate(n); return D.getTime(); }\n",
 "bad_moduleinit": "const D = new Date(0); D.setUTCDate(3);\nexport function f(n: number): number { return n + D.getTime(); }\n",
 "bad_multiArgLocal": "export function f(y: number): number { const d = new Date(y, 0, 1); d.setUTCDate(2); return d.getTime(); }\n",
 "bad_noarg": "export function f(n: number): number { const d = new Date(); d.setUTCDate(n); return d.getTime(); }\n",
 "bad_now": "export function f(n: number): number { const d = new Date(Date.now()); d.setUTCDate(n); return d.getTime(); }\n",
 "bad_param": "export function f(d: Date, n: number): number { d.setUTCDate(n); return d.getTime(); }\n",
 "bad_perf": "export function f(n: number): number { const d = new Date(performance.timeOrigin); d.setUTCDate(n); return d.getTime(); }\n",
 "bad_proto": "export function f(s: string): number { (Date.prototype as any).setUTCDate = () => 0; const d = new Date(s); d.setUTCDate(1); return d.getTime(); }\n",
 "bad_protoMod": "(Date.prototype as any).getTime = () => 0;\nexport function f(s: string): number { const d = new Date(s); d.setUTCDate(1); return d.getTime(); }\n",
 "bad_pushThen": "export function f(s: string): number { const arr: Date[] = []; const d = new Date(s); arr.push(d); d.setUTCDate(1); return arr[0]!.getTime(); }\n",
 "bad_reassign": "const D0 = new Date(0);\nexport function f(s: string): number { let d = new Date(s); d = D0; d.setUTCDate(1); return d.getTime(); }\n",
 "bad_setDate": "export function f(s: string): string { const d = new Date(s); d.setDate(d.getUTCDate() + 1); return d.toISOString(); }\n",
 "bad_setHours": "export function f(s: string): string { const d = new Date(s); d.setHours(0); return d.toISOString(); }\n",
 "bad_shadow": "export function f(s: string, k: Date[]): number { const d = new Date(s); for (const d of k) d.setUTCDate(1); return d.getTime(); }\n",
 "bad_spread": "export function f(s: string): number { const d = new Date(s); const o = { ...{ d } }; d.setUTCDate(1); return o.d.getTime(); }\n",
 "bad_strCall": "export function f(s: string): string { const d = new Date(s); return String(d); }\n",
 "bad_template": "export function f(s: string): string { const d = new Date(s); d.setUTCDate(1); return `${d}`; }\n",
 "bad_toLocale": "export function f(s: string): string { const d = new Date(s); d.setUTCDate(1); return d.toLocaleDateString(); }\n",
 "bad_toString": "export function f(s: string): string { const d = new Date(s); return d.toString(); }\n",
 "bad_toStringNew": "export function f(s: string): string { return new Date(s).toString(); }\n",
 "bad_toStringParam": "export function f(n: number): string { const d: Date = new Date(n); const e: Date = d; return e.toString(); }\n",
 "ok_basic": "export function f(s: string, n: number): string { const d = new Date(`${s}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }\n",
 "ok_loop": "export function f(a: string, b: string): string[] { const out: string[] = []; const end = new Date(`${b}T00:00:00Z`); for (const c = new Date(`${a}T00:00:00Z`); c <= end; c.setUTCDate(c.getUTCDate() + 1)) out.push(c.toISOString().slice(0, 10)); return out; }\n",
 "ok_perIter": "export function f(xs: string[]): number[] { const out: Date[] = []; for (const x of xs) { const d = new Date(x); d.setUTCDate(1); out.push(d); } return out.map((y) => y.getTime()); }\n",
 "ok_return": "export function f(s: string): number { const d = new Date(s); d.setUTCFullYear(2000); return g(d); }\nfunction g(x: Date): number { return x.getTime(); }\n",
 "ok_returnd": "function mk(s: string): Date { const d = new Date(s); d.setUTCMonth(0); return d; }\nexport function f(s: string): string { return mk(s).toISOString(); }\n",
 "ok_settime": "export function f(t: number): number { const d = new Date(0); d.setTime(t); d.setUTCHours(0, 0, 0, 0); return d.getTime(); }\n",
 "ok_utc": "export function f(y: number): string { const d = new Date(Date.UTC(y, 0, 1)); d.setUTCDate(1 + ((1 - d.getUTCDay() + 7) % 7)); return d.toISOString(); }\n"
};
const ATTACKS: Record<string, string> = {
 "bad_module": "module-level Date mutated in the target",
 "bad_moduleinit": "module-level Date mutated at load",
 "bad_param": "parameter Date mutated",
 "bad_callerMut": "Date returned by a helper, mutated by the caller",
 "bad_callerMut2": "fresh Date returned by a helper, mutated by the caller",
 "bad_container": "Date stored in a module container, then mutated",
 "bad_container2": "Date mutated, then stored in a module container (module state written)",
 "bad_destr": "array-destructuring alias mutated",
 "bad_destr2": "object-destructuring alias read after mutation",
 "bad_alias": "const alias read after mutation",
 "bad_setDate": "local-time setDate",
 "bad_setHours": "local-time setHours",
 "bad_noarg": "new Date() with no argument",
 "bad_now": "new Date(Date.now())",
 "bad_perf": "new Date(performance.timeOrigin)",
 "bad_capture": "Date captured by an arrow, mutated later",
 "bad_capture2": "arrow mutates a captured Date",
 "bad_helperMut": "Date passed to a helper that mutates its parameter",
 "bad_helperPass": "Date passed to a helper, mutated afterwards",
 "bad_pushThen": "mutation after arr.push(d)",
 "bad_loopEsc": "escape and mutation repeated by one loop",
 "bad_forHeader": "for-incrementor mutation after the body pushes the Date",
 "bad_reassign": "let reassigned to a module Date",
 "bad_shadow": "name shadowed by a loop variable",
 "bad_dateShadow": "Date is a local class",
 "bad_proto": "Date.prototype patched in the target",
 "bad_protoMod": "Date.prototype patched at load",
 "bad_toString": "toString on a Date",
 "bad_toStringNew": "toString on new Date(..)",
 "bad_toStringParam": "toString through a Date-annotated alias",
 "bad_strCall": "String(date)",
 "bad_concat": "\"\" + new Date(..)",
 "bad_template": "Date in a template literal",
 "bad_toLocale": "toLocaleDateString",
 "bad_getHours": "getHours",
 "bad_spread": "Date stored via shorthand property and spread",
 "bad_extract": "setter extracted from the Date",
 "bad_multiArgLocal": "new Date(y, m, d) (local time)"
};
const VERS = ["v1", "v2", "v3", "v4", "v5", "v6", "v7"] as const;
function verdicts(src: string, extra: Record<string, string> = {}): Record<string, string> {
  const own: Record<string, string> = { "src/a.ts": src, ...extra };
  const rd = { read: (rel: string) => own[rel] ?? null };
  const O: Record<string, object> = { v1: { load: rd }, v2: { v2: rd }, v3: { v2: rd, dates: true }, v4: { v2: rd, dates: true, v4: true }, v5: { v2: rd, dates: true, v4: true, v5: true }, v6: { v2: rd, v6: true }, v7: { v2: rd, v7: true } };
  return Object.fromEntries(VERS.map((v) => [v, existingTargetRefusal("src/a.ts", src, "f", O[v] as never) ?? "ok"]));
}

test("fresh-Date setters: every attack is refused under v1-v7", () => {
  for (const [k, why] of Object.entries(ATTACKS)) { const v = verdicts(F[k]!); for (const ver of VERS) assert.notEqual(v[ver], "ok", `${k} (${why}) ${ver}`); }
  assert.deepEqual(Object.keys(F).filter((k) => k.startsWith("bad_")).sort(), Object.keys(ATTACKS).sort());
});

test("fresh-Date setters: controls are accepted under v1-v7", () => {
  // UTC setters on a fresh Date (string, Date.UTC, setTime), a for-loop cursor read only in place, a Date passed on or
  // returned after its mutations, and a per-iteration fresh Date pushed after its mutation.
  for (const k of Object.keys(F).filter((x) => x.startsWith("ok_"))) assert.ok(VERS.every((v) => verdicts(F[k]!)[v] === "ok"), `${k} ${JSON.stringify(verdicts(F[k]!))}`);
});

test("setDate depends on the runner's time zone (America/Denver vs UTC), so local-time setters stay refused", () => {
  const prog = 'const d = new Date("2024-03-10T05:30:00Z"); d.setDate(d.getDate() + 1); process.stdout.write(d.toISOString());';
  const run = (tz: string) => spawnSync(process.execPath, ["-e", prog], { env: { ...process.env, TZ: tz }, encoding: "utf8" }).stdout;
  const den = run("America/Denver"), utc = run("UTC");
  assert.equal(utc, "2024-03-11T05:30:00.000Z");
  assert.equal(den, "2024-03-11T04:30:00.000Z"); // the DST change in Denver shifts the result by an hour
  assert.notEqual(den, utc);
  const prog2 = 'const d = new Date("2024-03-10T05:30:00Z"); d.setUTCDate(d.getUTCDate() + 1); process.stdout.write(d.toISOString());';
  const run2 = (tz: string) => spawnSync(process.execPath, ["-e", prog2], { env: { ...process.env, TZ: tz }, encoding: "utf8" }).stdout;
  assert.equal(run2("America/Denver"), run2("UTC"));
  assert.ok(VERS.every((v) => verdicts('export function f(s: string): string { const d = new Date(s); d.setDate(d.getDate() + 1); return d.toISOString(); }\n')[v] !== "ok"));
  assert.ok(VERS.every((v) => verdicts('export function f(s: string): string { const d = new Date(s); d.setDate(1); return d.toISOString(); }\n')[v] !== "ok"));
});

test("fresh-Date setters compose with the load-call allowance only through pure callees", () => {
  const helper = 'export function addDays(date: string, days: number): string { const c = new Date(`${date}T00:00:00Z`); c.setUTCDate(c.getUTCDate() + days); return c.toISOString().slice(0, 10); }\n';
  const ok = 'import { addDays } from "./h";\nconst NEXT = addDays("2024-10-11", 1);\nexport function f(s: string): boolean { return s === NEXT; }\n';
  assert.deepEqual(verdicts(ok, { "src/h.ts": helper }), { v1: "test_target_impure", v2: "ok", v3: "ok", v4: "ok", v5: "ok", v6: "ok", v7: "ok" });
  const leaky = 'const SHARED = new Date(0);\nexport function addDays(date: string, days: number): string { SHARED.setUTCDate(days); return date; }\n';
  assert.ok(VERS.every((v) => verdicts(ok, { "src/h.ts": leaky })[v] !== "ok"));
});
