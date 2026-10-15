// M58: METHOD_GUARD proposal (a new kind; ADD_THROW_GUARD v1 unchanged). Evidence, acceptance and refusal proofs.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { readManifestBytes } from "../lib/manifestparts.ts";
import test from "node:test";
import ts from "typescript";
import { applyMethodGuardRule, buildMethodGuardEdit, guardCondition, METHOD_GUARD_TRIGGER, methodGuardCondition, methodGuardEnabled, safeRegexLiteral } from "../lib/method-guard.ts";
import { safeCondition, type Refusal } from "../lib/learned-guard.ts";
import { PROTECTED_SELF } from "../lib/selfchange.ts";

const root = resolve(import.meta.dirname, "../..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const EV = JSON.parse(read("peaceai/rules/proposals/m58-method-guard-evidence.json"));
const REC = JSON.parse(read("peaceai/rules/proposals/public-method-guard-v1.json"));
const expr = (t: string) => (ts.createSourceFile("c.ts", `(${t});`, ts.ScriptTarget.Latest, true).statements[0] as ts.ExpressionStatement).expression as ts.ParenthesizedExpression;
const C = (t: string, ps = ["s", "d", "o", "set"]) => methodGuardCondition(expr(t).expression, new Set(ps));
const SRC = 'export function f(s: string, d: Date, o: { name: string }, set: Set<string>) {\n  if (!s) return 0;\n  return s.length;\n}\n';
const B = (cond: string, form: "one-line" | "block" = "block", src = SRC, code = "BAD_S") => buildMethodGuardEdit("src/f.ts", src, "f", cond, code, form);
let refusals = 0;
const refuse = (r: unknown, msg: string) => { assert.ok(r === null || r === false, msg); refusals++; };

test("off by default until approved; v1 untouched; wired for /approve-rule", () => {
  assert.equal(methodGuardEnabled({}), false);
  assert.equal(methodGuardEnabled({ PEACEAI_METHOD_GUARD: "1" }), false);
  assert.equal(methodGuardEnabled({ PEACEAI_METHOD_GUARD: "true" }), true);
  assert.match(REC.status, /^proposal-off/);
  assert.ok(read("peaceai/lib/learned.ts").includes("METHOD_GUARD"));
  assert.ok(read("peaceai/rules/learned/public-method-guard-v1.json").includes("METHOD_GUARD"));
  // May be approved (via peace-approve-rule) only with exactly its hash; same pattern as m47/#184.
  const list = JSON.parse(read("peaceai/rules/approved.json")) as { rules?: { id: string; sha256: string }[] } | { id: string; sha256: string }[];
  const entries = (Array.isArray(list) ? list : list.rules ?? []).filter((r) => r.id === "public-method-guard-v1");
  for (const r of entries) assert.equal(r.sha256, "d8287e62f4114f1673d1e835efdc33174c02f480263edddffb5e4efbca728160", "method-guard-v1 approved only with its exact hash");
  assert.equal(safeCondition(expr("s.startsWith('x')").expression, new Set(["s"])), false, "v1 grammar still refuses method calls");
});

test("evidence: AST scan of the pinned example-only repos; every recorded guard replays on its blob-pinned fixture", () => {
  const setc = new Set((JSON.parse(read("peaceai/model/heldout-c.json")).sets.C as { repo: string }[]).map((r) => r.repo));
  const pins = new Map((JSON.parse(read("peaceai/rules/proposals/m45-example-repos.json")).repos as { name: string; commit: string; spdx: string; licenseSha256: string }[]).map((r) => [r.name, r]));
  const FIX = "peaceai/test/fixtures/m58/";
  const gitBlob = (b: Buffer) => createHash("sha1").update(Buffer.concat([Buffer.from(`blob ${b.length}\0`), b])).digest("hex");
  const fx = (n: string, blob: string) => {
    assert.match(n, /^[\w.-]+-[0-9a-f]{12}\.txt$/);
    const b = readFileSync(join(root, FIX + n));
    assert.ok(b.length <= 65536, n);
    assert.equal(gitBlob(b), blob, `${n}: not the real blob`);
    return b.toString("utf8");
  };
  assert.deepEqual(readdirSync(join(root, FIX)).filter((n) => !/^[\w.-]+-[0-9a-f]{12}\.txt$/.test(n)), [], "fixtures hold only source files (no LICENSE text; license pinned by sha256 in the repo records)");
  for (const x of EV.examples as { repo: string; commit: string; path: string; sha256: string; params: string[]; line: number; form: string; guard: string; license: string; licenseSha256: string; fixture: string; fileBlob: string }[]) {
    assert.ok(!setc.has(x.repo));
    const p = pins.get(x.repo);
    assert.ok(p, `${x.repo} is not on the example-only list`);
    assert.equal(x.commit, p.commit); assert.equal(x.license, p.spdx); assert.equal(x.licenseSha256, p.licenseSha256);
    assert.match(x.sha256, /^[0-9a-f]{64}$/);
    assert.match(x.fileBlob, /^[0-9a-f]{40}$/);
    const body = fx(x.fixture, x.fileBlob);
    assert.equal(createHash("sha256").update(body).digest("hex"), x.sha256, `${x.repo} ${x.path}`);
    const sf = ts.createSourceFile(x.path, body, ts.ScriptTarget.Latest, true);
    let found = false;
    const visit = (n: ts.Node) => {
      const bodyNode = (ts.isFunctionDeclaration(n) || ts.isMethodDeclaration(n) || ts.isFunctionExpression(n) || ts.isArrowFunction(n)) && n.body && ts.isBlock(n.body) ? n.body : null;
      if (bodyNode && bodyNode.statements.length) {
        const st = bodyNode.statements[0]!;
        const startLine = sf.getLineAndCharacterOfPosition(st.getStart(sf)).line + 1;
        if (startLine === x.line) {
          const c = guardCondition(st);
          assert.ok(c && methodGuardCondition(c, new Set(x.params)), `${x.repo} ${x.path}:${x.line}`);
          const oneLine = ts.isThrowStatement((st as ts.IfStatement).thenStatement);
          assert.equal(oneLine ? "one-line" : "block", x.form, `${x.repo} ${x.path}:${x.line} form`);
          found = true;
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
    assert.ok(found, `${x.repo} ${x.path}:${x.line} not found as first-statement method guard in fixture`);
    // the recorded guard text still parses on its own
    const gsf = ts.createSourceFile("g.ts", x.guard, ts.ScriptTarget.Latest, true);
    assert.equal(gsf.statements.length, 1);
    const gc = guardCondition(gsf.statements[0]!);
    assert.ok(gc && methodGuardCondition(gc, new Set(x.params)), x.guard);
  }
  assert.equal(EV.counts.firstStatementMethodGuards, EV.examples.length);
  assert.equal(REC.evidence.examples, EV.examples.length);
  assert.equal(REC.evidence.repos, new Set(EV.examples.map((x: { repo: string }) => x.repo)).size);
  assert.equal(REC.evidence.qualifies, EV.examples.length >= EV.bar);
  assert.equal(EV.bar, 10);
  assert.equal(REC.evidence.bar, 10);
});

test("no overlap: no example repo is in the training corpus list or manifest (Architect M60)", () => {
  const corpus = new Set<string>((JSON.parse(read("peaceai/model/ext-corpus.json")).repos as { name: string }[]).map((r) => r.name));
  for (const l of readManifestBytes(join(root, "peaceai/model"), "ext-manifest").toString("utf8").split("\n")) if (l.trim()) { const r = JSON.parse(l).repo; if (r) corpus.add(r); }
  for (const x of EV.examples as { repo: string }[]) assert.ok(!corpus.has(x.repo), `${x.repo} is in the training corpus`);
});

test("METHOD_GUARD accepts the method forms (#149 folded in) and builds one-line and block guards first", () => {
  for (const t of ["!s.startsWith('#')", "s.endsWith('.d.ts')", "s.includes('--')", "set.has(s)", "o.name.includes(':')", "s.trim() === ''", "!(d.getTime() > 0)", "!/^[0-9]{1,3}$/.test(s)", "/^[a-z]+$/i.test(o.name)", "typeof s !== 'string' || !s.startsWith(\"x\")"]) assert.ok(C(t), t);
  const block = B("s.startsWith('#')");
  assert.ok(block);
  assert.ok(block!.includes("  if (s.startsWith('#')) {\n    throw new Error(\"BAD_S\");\n  }\n  if (!s) return 0;"), block!);
  const one = B("s.includes('--')", "one-line");
  assert.ok(one!.includes("  if (s.includes('--')) throw new Error(\"BAD_S\");\n  if (!s) return 0;"), one!);
  const sq = B("s.endsWith('x')", "block", SRC.replace("return s.length;", "if (s === 'q') throw new Error('Q_ERR');\n  return s.length;"));
  assert.ok(sq!.includes("throw new Error('BAD_S');"), "file's quote style");
  assert.ok(B("set.has(s)", "block", "export function f(s: string, set: Set<string>) {}\n"), "empty body");
});

test("METHOD_GUARD refuses everything else", () => {
  const conds: [string, string][] = [
    ["s.length > 3", "no method call (that is v1)"],
    ["s.replace('a', 'b') === ''", "method outside the list"],
    ["s.startsWith('a', 1)", "extra argument"],
    ["s.startsWith()", "missing argument"],
    ["s.startsWith(s.slice(1))", "computed argument"],
    ["s.startsWith(x)", "free name argument"],
    ["s.trim('x') === ''", "argument to a no-arg method"],
    ["s?.startsWith('a')", "optional chaining"],
    ["s['startsWith']('a')", "computed access"],
    ["s.trim().startsWith('a')", "call-result receiver"],
    ["x.startsWith('a')", "non-param receiver"],
    ["globalThis.process.env.X.startsWith('a')", "global receiver"],
    ["re.test(s)", "regex held in a variable"],
    ["/a/g.test(s)", "flag g"],
    ["/a/y.test(s)", "flag y"],
    ["/(a+)+$/.test(s)", "ReDoS: quantified group"],
    ["/(a)\\1/.test(s)", "backreference"],
    ["/(?=a)b/.test(s)", "lookahead"],
    ["/(?<=a)b/.test(s)", "lookbehind"],
    [`/${"a".repeat(81)}/.test(s)`, "overlong regex"],
    ["/a/.test(s.slice(1))", "regex on a call result"],
    ["/a/.test('lit')", "regex on a literal"],
    ["s.startsWith(`${s}`)", "template with substitution"],
    ["(s.startsWith('a'), true)", "comma operator"],
    ["s.startsWith('a') ? 1 : 0", "conditional"],
    ["(s = 'a').startsWith('a')", "assignment"],
    ["new Set([s]).has(s)", "new"],
    ["s.startsWith<string>('a')", "type arguments"],
    ["s.startsWith.call(s, 'a')", "call indirection"],
  ];
  for (const [t, msg] of conds) refuse(C(t), msg);
  refuse(B("s.startsWith('#')", "block", SRC, "lower"), "bad code");
  refuse(B("s.startsWith('#')", "nested" as "block"), "bad form");
  refuse(B("s.startsWith('#')".padEnd(161, " ")), "too long");
  refuse(B("s.startsWith('#')", "block", SRC + "const z = 'BAD_S';\n"), "code already in file");
  refuse(buildMethodGuardEdit("src/f.test.ts", SRC, "f", "s.startsWith('#')", "BAD_S", "block"), "test file");
  refuse(buildMethodGuardEdit("src/f.d.ts", SRC, "f", "s.startsWith('#')", "BAD_S", "block"), ".d.ts");
  refuse(buildMethodGuardEdit("src/f.js", SRC, "f", "s.startsWith('#')", "BAD_S", "block"), ".js");
  refuse(buildMethodGuardEdit("src/f.ts", SRC, "g", "s.startsWith('#')", "BAD_S", "block"), "no such function");
  refuse(buildMethodGuardEdit("src/f.ts", SRC.replace("export function", "function"), "f", "s.startsWith('#')", "BAD_S", "block"), "not exported");
  refuse(buildMethodGuardEdit("src/f.ts", SRC + SRC, "f", "s.startsWith('#')", "BAD_S", "block"), "two implementations");
  refuse(buildMethodGuardEdit("src/f.ts", "export function f({ s }: { s: string }) { return s; }\n", "f", "s.startsWith('#')", "BAD_S", "block"), "destructured parameter");
  refuse(buildMethodGuardEdit("peaceai/lib/gate.ts", SRC, "f", "s.startsWith('#')", "BAD_S", "block"), "protected gate");
  refuse(buildMethodGuardEdit("peaceai/lib/selfchange.ts", SRC, "f", "s.startsWith('#')", "BAD_S", "block"), "protected selfchange");
  refuse(buildMethodGuardEdit("../src/f.ts", SRC, "f", "s.startsWith('#')", "BAD_S", "block"), "path contains ..");
  refuse(buildMethodGuardEdit("/src/f.ts", SRC, "f", "s.startsWith('#')", "BAD_S", "block"), "leading /");
  refuse(B("s.startsWith('#')); evil(("), "injection");
  refuse(guardCondition(ts.createSourceFile("g.ts", "if (s.startsWith('a')) { throw new Error('A'); } else { x(); }", ts.ScriptTarget.Latest, true).statements[0]!), "else branch");
  refuse(guardCondition(ts.createSourceFile("g.ts", "if (s.startsWith('a')) { log(); throw new Error('A'); }", ts.ScriptTarget.Latest, true).statements[0]!), "block with more than the throw");
  refuse(guardCondition(ts.createSourceFile("g.ts", "if (s.startsWith('a')) throw 'A';", ts.ScriptTarget.Latest, true).statements[0]!), "throw of a non-Error");
  refuse(safeRegexLiteral("/a/gi"), "regex flags");
  assert.equal(refusals, REFUSALS_STATED);
});
const REFUSALS_STATED = 49;

test("applyMethodGuardRule: failed parse sets why.reason to task_unparsed (RULE_REFUSALS)", () => {
  const params = {
    error: "Error",
    form: "block",
    grading: "self-fail-before-pass-after",
    message: "code-only",
    placement: "function-top",
    test: "new-file",
  };
  const why: Refusal = {};
  assert.equal(
    applyMethodGuardRule(METHOD_GUARD_TRIGGER, params, "this is not a method-guard header", [{ path: "src/f.ts", content: SRC }], undefined, why),
    null,
  );
  assert.equal(why.reason, "task_unparsed");
  // Valid header still works (sanity: refusal path did not break the happy path).
  const okWhy: Refusal = {};
  const obj =
    "guard f in src/f.ts with a method: throw BAD_S when s.startsWith('#')\n- `f('#x')` throws BAD_S\n- `f('ok')` is 2";
  const edit = applyMethodGuardRule(METHOD_GUARD_TRIGGER, params, obj, [{ path: "src/f.ts", content: SRC }], (p) => p.endsWith(".test.ts"), okWhy);
  assert.ok(edit, "parsed task should edit");
  assert.equal(okWhy.reason, undefined);
});

test("engine, spec, evidence and this test are protected; spec pinned", () => {
  for (const p of ["peaceai/lib/method-guard.ts", "peaceai/spec/method-guard-v1.md", "peaceai/test/m58-method-guard.test.ts", "peaceai/rules/proposals/m58-method-guard-evidence.json", "peaceai/rules/proposals/public-method-guard-v1.json", "peaceai/rules/learned/public-method-guard-v1.json"])
    assert.ok(PROTECTED_SELF.some((x) => x.pattern.test(p)), p);
  assert.equal(createHash("sha256").update(read("peaceai/spec/method-guard-v1.md")).digest("hex"), SPEC_SHA);
});
const SPEC_SHA = "dc3f900b43d00b767db719763d1eb205acc4f1f179f0c774d611bd545040c4f8";
