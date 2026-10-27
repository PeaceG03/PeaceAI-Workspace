// Identity gate (Auditor, after the identity-gap audit of 2026-10-26). Before it, deriveProgram accepted a program equal
// to one parameter when no example changed that parameter: 17 spread number examples with result = n derived `n`, and
// 17 string examples with result = s derived `s` (deriveCandidate, the search plus witness gates, still shows that
// below). Now, whenever every example's result equals one parameter's value unchanged, whatever the fitted body
// (`n`, `n + 0`, `s.slice(0)`), the fit is refused as derive_expr_identity, naming the parameter; and when every example
// gives one same result it is refused as derive_examples_uninformative (fail closed). An identity-shaped set with an
// example that changes the parameter is not refused by the gate, and the 10 landed derive-from-behavior tasks
// (m99-derive-identity-landed.json: issue texts as filed, file hashes as landed) still derive to the
// same bytes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { deriveCandidate, deriveProgram, examplesIdentityProblem, type DeriveExample, type DeriveFit, type DeriveInput } from "../lib/derive.ts";
import { runDeriveRule } from "../lib/learned-derive.ts";
import type { RuleSpec } from "../lib/learned.ts";
import { cleanIssueText } from "../lib/taskmap.ts";

const repo = resolve(import.meta.dirname, "..", "..");
const read = (p: string) => readFileSync(join(repo, p), "utf8");
const N17 = [-1000, -100, -10, -2, -1, 0, 1, 2, 3, 5, 10, 50, 100, 1000, 10000, 50000, 100000];
// every DERIVE_STRING_CLASSES class appears (upper, lower, digit, inner space, edge space, punctuation, empty)
const S17 = ["", "a", "B", "ab", " lead", "abc", "hello", "world", "x y", "OK", "ERROR", "trail ", "z9", "q.r", "scanner", "part-7", "42"];
const idNum: DeriveInput = { params: [{ name: "n", type: "number" }], ret: "number", examples: N17.map((n) => ({ args: [n], out: n })) };
const idStr: DeriveInput = { params: [{ name: "s", type: "string" }], ret: "string", examples: S17.map((s) => ({ args: [s], out: s })) };
// a host directory with one source file, as a new-module rule needs (m99-derive-ask.test.ts uses the same)
const HOST = [{ path: "src/host.ts", content: "export const x = 1;\n" }];
const fit = (expr: string): DeriveFit => ({ program: { op: "param", i: 0 }, size: 1, expr });

test("identity gate: the 17-value number identity set was accepted as `n`; now it is refused as derive_expr_identity: n", () => {
  const before = deriveCandidate(idNum); // the search and witness gates alone: what deriveProgram emitted before the gate
  assert.equal(before.ok && before.fit.expr, "n");
  const r = deriveProgram(idNum);
  assert.equal(r.ok, false);
  assert.equal(!r.ok && `${r.reason}/${r.param}`, "derive_expr_identity/n");
  assert.match(!r.ok ? r.detail! : "", /every example's result equals n unchanged, so the program that fits \(n\) may just return n; add an example whose result differs from n/);
});

test("identity gate: the 17-string identity set was accepted as `s`; now it is refused as derive_expr_identity: s", () => {
  const before = deriveCandidate(idStr);
  assert.equal(before.ok && before.fit.expr, "s");
  const r = deriveProgram(idStr);
  assert.equal(!r.ok && `${r.reason}/${r.param}`, "derive_expr_identity/s");
});

test("identity gate: any body equal to the parameter on every example is refused (n + 0, s.slice(0)), and so is a second parameter passed through", () => {
  assert.equal(examplesIdentityProblem(idNum, fit("n + 0"))?.reason, "derive_expr_identity");
  assert.match(examplesIdentityProblem(idNum, fit("n + 0"))!.detail, /\(n \+ 0\)/);
  assert.equal(examplesIdentityProblem(idStr, fit("s.slice(0)"))?.param, "s");
  const two: DeriveInput = { params: [{ name: "a", type: "number" }, { name: "b", type: "number" }], ret: "number", examples: N17.map((n, i) => ({ args: [i * 3 - 20, n], out: n })) };
  assert.deepEqual([examplesIdentityProblem(two, fit("b"))?.reason, examplesIdentityProblem(two, fit("b"))?.param], ["derive_expr_identity", "b"]);
  // not identity: a value equal to the parameter on all examples but one
  assert.equal(examplesIdentityProblem({ ...idNum, examples: [...idNum.examples, { args: [7], out: 8 }] }, fit("x")), null);
  assert.equal(examplesIdentityProblem({ ...idNum, examples: [] }, fit("x")), null);
});

test("identity gate: a two-parameter function that returns its SECOND parameter unchanged is refused end to end (Auditor follow-up; kills the first-parameter-only witness mutant)", () => {
  // a varies, b passes through; three examples differ only in a (b = 1000) so the unread-parameter gate is satisfied
  // and the search fits `b`. deriveProgram must then refuse it as identity on b, not just on the first parameter.
  const A = [7, -3, 12, 400, -55, 9, 31, -8, 64, 2, -900, 17, 5, 88, -1, 250, 3];
  const num: DeriveInput = { params: [{ name: "a", type: "number" }, { name: "b", type: "number" }], ret: "number",
    examples: [...N17.map((n, i) => ({ args: [A[i]!, n], out: n })), ...[11, 22, 33].map((a) => ({ args: [a, 1000], out: 1000 }))] };
  const before = deriveCandidate(num);
  assert.equal(before.ok && before.fit.expr, "b");
  const r = deriveProgram(num);
  assert.equal(!r.ok && `${r.reason}/${r.param}`, "derive_expr_identity/b");
  assert.ok(num.examples.some((e) => e.out !== e.args[0]), "the first parameter alone shows nothing");
  // the same with strings: p varies, q passes through
  const str: DeriveInput = { params: [{ name: "p", type: "string" }, { name: "q", type: "string" }], ret: "string",
    examples: [...S17.map((x, i) => ({ args: [S17[(i + 5) % 17]!, x], out: x })), ...["k", "mm", "n o"].map((x) => ({ args: [x, "hello"], out: "hello" }))] };
  assert.equal((() => { const c = deriveCandidate(str); return c.ok && c.fit.expr; })(), "q");
  const rs = deriveProgram(str);
  assert.equal(!rs.ok && `${rs.reason}/${rs.param}`, "derive_expr_identity/q");
});

test("identity gate: equality is strict: the string '1' is not the number 1 (Auditor follow-up; kills the == mutant)", () => {
  // String(n): every result is the parameter's digits as a string, never the parameter's own value.
  const str: DeriveInput = { params: [{ name: "n", type: "number" }], ret: "string", examples: N17.map((n) => ({ args: [n], out: String(n) })) };
  assert.equal(examplesIdentityProblem(str, fit("String(n)")), null);
  // and the reverse: a number result equal to a string parameter's digits is not the parameter either
  const num: DeriveInput = { params: [{ name: "s", type: "string" }], ret: "number", examples: ["1", "2", "3", "10", "42"].map((s) => ({ args: [s], out: Number(s) })) };
  assert.equal(examplesIdentityProblem(num, fit("Number(s)")), null);
  // (The uninformative check compares results with each other; they share the return type, so == there is the same as ===.)
});

test("identity gate: an identity-shaped set plus a changing example is not refused by the gate", () => {
  // one changing example: whatever the search and witness gates decide stands unchanged (here no fit, or the cap gate)
  for (const [k, o] of [[7, 8], [7, 0], [200000, 100000]] as const) {
    const input = { ...idNum, examples: [...idNum.examples, { args: [k], out: o }] };
    const r = deriveProgram(input), c = deriveCandidate(input);
    assert.notEqual(!r.ok && r.reason, "derive_expr_identity", `${k} -> ${o}`);
    assert.deepEqual(r, c, `${k} -> ${o}`);
  }
  const strIn = { ...idStr, examples: [...idStr.examples.filter((e) => e.args[0] !== "ab"), { args: ["ab"], out: "abab" }] };
  assert.notEqual(!deriveProgram(strIn).ok && (deriveProgram(strIn) as { reason: string }).reason, "derive_expr_identity");
  // examples that show the cap: derived, not refused
  const cap = deriveProgram({ ...idNum, examples: [...idNum.examples, { args: [200000], out: 100000 }, { args: [300000], out: 100000 }] });
  assert.equal(cap.ok && cap.fit.expr, "n <= 100000 ? n : 100000");
});

test("uninformative examples: every example giving one same result is refused (fail closed)", () => {
  const same: DeriveExample[] = N17.map((n) => ({ args: [n], out: true }));
  const p = examplesIdentityProblem({ params: [{ name: "n", type: "number" }], examples: same }, fit("n <= 100000"));
  assert.equal(p?.reason, "derive_examples_uninformative");
  assert.match(p!.detail, /every example gives the same result \(true\), so the program that fits \(n <= 100000\) is not shown to depend on any parameter/);
  // through deriveProgram such a set never reaches a fit (derive_examples or derive_no_fit first); it is never accepted
  const r = deriveProgram({ params: [{ name: "n", type: "number" }], ret: "boolean", examples: same });
  assert.equal(r.ok, false);
});

test("identity gate through the v1 rule: the refusal code is derive_expr_identity", () => {
  const v1 = JSON.parse(read("peaceai/rules/learned/public-derive-from-behavior-v1.json")) as RuleSpec;
  const t = JSON.parse(read("peaceai/test/m99-derive-identity-landed.json")).tasks.find((x: { issue: number }) => x.issue === 515);
  // #515's issue text with its signature and examples swapped for the number identity set
  const lines = (t.body as string).split("\n");
  const head = lines.findIndex((l) => /^-\s/.test(l.trim()));
  let end = head; while (end < lines.length && /^-\s/.test(lines[end]!.trim())) end++;
  const sig = (t.body as string).match(/\(ageDays: number\): boolean/)![0];
  const body = [...lines.slice(0, head), ...N17.map((n) => `- ${n} gives ${n}`), ...lines.slice(end)].join("\n").replace(sig, "(ageDays: number): number");
  const why: { reason?: string } = {};
  assert.equal(runDeriveRule(v1.trigger, v1.params, cleanIssueText({ title: t.title, body } as never), HOST, undefined, why), null);
  assert.equal(why.reason, "derive_expr_identity");
});

test("the 10 landed derive-from-behavior tasks (#501 #502 #513-#516 #540-#543) still derive to the same files, byte for byte", () => {
  const tasks = JSON.parse(read("peaceai/test/m99-derive-identity-landed.json")).tasks as { issue: number; rule: string; title: string; body: string; files: { path: string; sha256: string }[] }[];
  assert.deepEqual(tasks.map((t) => t.issue), [501, 502, 513, 514, 515, 516, 540, 541, 542, 543]);
  const isTest = (p: string) => /\.test\.ts$/.test(p);
  for (const t of tasks) {
    const spec = JSON.parse(read(`peaceai/rules/learned/${t.rule}.json`)) as RuleSpec;
    const why: { reason?: string } = {};
    const e = runDeriveRule(spec.trigger, spec.params, cleanIssueText({ title: t.title, body: t.body } as never), HOST, isTest, why, `${t.title}\n\n${t.body}`);
    assert.ok(e, `#${t.issue}: ${why.reason}`);
    const got = [{ path: e.path, content: e.content }, ...(e.extra ?? []).map((x) => ({ path: x.path, content: x.content }))];
    assert.deepEqual(got.map((f) => ({ path: f.path, sha256: createHash("sha256").update(f.content).digest("hex") })), t.files, `#${t.issue}`);
  }
});

test("the mistakes ledger's known limit m100-floor-clamp-past (`n`, every example below the cap) is no longer emitted", () => {
  const e = JSON.parse(read("peaceai/test/m99-derive-mistakes.json")).entries.find((x: { id: string }) => x.id === "m100-floor-clamp-past");
  const input: DeriveInput = { params: [{ name: "n", type: "number" }], ret: "number", examples: (e.examples as number[][]).map(([a, b]) => ({ args: [a!], out: b! })) };
  const c = deriveCandidate(input);
  assert.equal(c.ok && c.fit.expr, "n"); // the search still picks the uncapped n
  const r = deriveProgram(input);
  assert.equal(!r.ok && `${r.reason}/${r.param}`, "derive_expr_identity/n");
});
