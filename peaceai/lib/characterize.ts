// A characterization with no check bullets. The exported function is called on a fixed lattice and one
// passing assertion is appended to a test file that already imports it. credit is false.
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";
import { ARGS_PLAIN_DATA_V3, buildTestEdit, FIX_LINE, type TestCheck, type TestTask } from "./learned-test.ts";
import { existingTargetRefusal, type RepoFile } from "./learned-test-existing.ts";

type Arg = { k: "s"; v: string } | { k: "n"; v: number } | { k: "b"; v: boolean } | { k: "date" } | { k: "env" } | { k: "ss"; v: string[] } | { k: "omit" };
type Slot = { src: string; arg: Arg }[];

const require = createRequire(import.meta.url);

function headerOf(trigger: string, objective: string): { symbol: string; file: string } | null {
  const lines = objective.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.some((l) => FIX_LINE.test(l) || /^[-*] /.test(l))) return null;
  const head = lines.find((l) => new RegExp(trigger, "i").test(l));
  if (!head) return null;
  const g = new RegExp(trigger, "i").exec(head)?.groups ?? {};
  if (!g.symbol || !g.file || !/^[\w./-]+\.ts$/.test(g.file)) return null;
  return { symbol: g.symbol, file: g.file };
}

function slotOf(type: ts.TypeNode): Slot | null {
  if (ts.isParenthesizedTypeNode(type)) return slotOf(type.type);
  if (type.kind === ts.SyntaxKind.StringKeyword) return [{ src: '"2020-01-01"', arg: { k: "s", v: "2020-01-01" } }, { src: '"a"', arg: { k: "s", v: "a" } }];
  if (type.kind === ts.SyntaxKind.NumberKeyword) return [{ src: "0", arg: { k: "n", v: 0 } }, { src: "1", arg: { k: "n", v: 1 } }];
  if (type.kind === ts.SyntaxKind.BooleanKeyword) return [{ src: "false", arg: { k: "b", v: false } }, { src: "true", arg: { k: "b", v: true } }];
  if (type.kind === ts.SyntaxKind.UnknownKeyword) return [{ src: '"a"', arg: { k: "s", v: "a" } }, { src: "0", arg: { k: "n", v: 0 } }];
  if (ts.isTypeReferenceNode(type) && ts.isIdentifier(type.typeName) && type.typeName.text === "Date" && !type.typeArguments) return [{ src: 'new Date("2020-01-01T00:00:00Z")', arg: { k: "date" } }];
  if (ts.isTypeReferenceNode(type) && ts.isQualifiedName(type.typeName) && type.typeName.left.getText() === "NodeJS" && type.typeName.right.text === "ProcessEnv") return [{ src: "{}", arg: { k: "env" } }];
  if (ts.isArrayTypeNode(type) && type.elementType.kind === ts.SyntaxKind.StringKeyword) return [{ src: '["a"]', arg: { k: "ss", v: ["a"] } }, { src: "[]", arg: { k: "ss", v: [] } }];
  if (ts.isTypeOperatorNode(type) && type.operator === ts.SyntaxKind.ReadonlyKeyword) return slotOf(type.type);
  if (type.kind === ts.SyntaxKind.UndefinedKeyword) return [{ src: "", arg: { k: "omit" } }];
  if (ts.isUnionTypeNode(type)) {
    const parts = type.types.map(slotOf);
    if (parts.some((p) => p === null)) return null;
    const merged: Slot = [];
    for (const part of parts) for (const v of part!) if (!merged.some((m) => m.src === v.src)) merged.push(v);
    return merged;
  }
  return null;
}

function signature(content: string, symbol: string): Slot[] | null {
  const sf = ts.createSourceFile("m.ts", content, ts.ScriptTarget.Latest, true);
  const box: { fn: ts.FunctionDeclaration | ts.ArrowFunction | ts.FunctionExpression | null } = { fn: null };
  const visit = (n: ts.Node): void => {
    if (box.fn) return;
    if (ts.isFunctionDeclaration(n) && n.name?.text === symbol) box.fn = n;
    else if (ts.isVariableStatement(n)) for (const d of n.declarationList.declarations) {
      if (ts.isIdentifier(d.name) && d.name.text === symbol && d.initializer && (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer))) box.fn = d.initializer;
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  const fn = box.fn;
  if (!fn || fn.asteriskToken || fn.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword)) return null;
  if (fn.parameters.length > 4) return null;
  const slots: Slot[] = [];
  for (const p of fn.parameters) {
    if (!ts.isIdentifier(p.name) || p.dotDotDotToken || !p.type) return null;
    const slot = slotOf(p.type);
    if (!slot) return null;
    const optional = !!p.questionToken || !!p.initializer || slot.some((s) => s.arg.k === "omit");
    const next = optional && !slot.some((s) => s.arg.k === "omit") ? [...slot, { src: "", arg: { k: "omit" as const } }] : slot;
    slots.push(next);
  }
  return slots;
}

function callsOf(slots: Slot[]): { src: string[]; args: Exclude<Arg, { k: "omit" }>[] }[] {
  const out: { src: string[]; args: Exclude<Arg, { k: "omit" }>[] }[] = [];
  const rec = (i: number, src: string[], args: Exclude<Arg, { k: "omit" }>[], omitted: boolean): void => {
    if (out.length >= 8) return;
    if (i === slots.length) { out.push({ src, args }); return; }
    for (const choice of slots[i]!) {
      if (choice.arg.k === "omit") rec(i + 1, src, args, true);
      else if (!omitted) rec(i + 1, [...src, choice.src], [...args, choice.arg], false);
    }
  };
  rec(0, [], [], false);
  return out;
}

function importsSymbol(content: string, symbol: string, froms: ReadonlySet<string>): boolean {
  const sf = ts.createSourceFile("t.ts", content, ts.ScriptTarget.Latest, true);
  let assertOk = false;
  let testOk = false;
  let named = false;
  for (const s of sf.statements) {
    if (!ts.isImportDeclaration(s) || !ts.isStringLiteral(s.moduleSpecifier) || s.importClause?.isTypeOnly) continue;
    const from = s.moduleSpecifier.text;
    const c = s.importClause;
    if (from === "node:assert/strict" && c?.name?.text === "assert") assertOk = true;
    else if (from === "node:test" && c?.name?.text === "test") testOk = true;
    else if (froms.has(from) && c?.namedBindings && ts.isNamedImports(c.namedBindings))
      named = c.namedBindings.elements.some((el) => !el.isTypeOnly && !el.propertyName && el.name.text === symbol);
  }
  return assertOk && testOk && named;
}

function testFile(symbol: string, source: string, files: readonly { path: string; content: string }[], isTest: (p: string) => boolean): string | null {
  const dir = source.includes("/") ? source.slice(0, source.lastIndexOf("/") + 1) : "";
  const stem = source.slice(dir.length).replace(/\.ts$/, "");
  const froms = new Set([`./${stem}`, `./${stem}.ts`]);
  const hits = files.filter((f) => isTest(f.path) && importsSymbol(f.content, symbol, froms)).map((f) => f.path).sort();
  const own = `${dir}${stem}.test.ts`;
  return hits.includes(own) ? own : hits[0] ?? null;
}

type Enc = { t: "bad" } | { t: "null" } | { t: "undef" } | { t: "bool"; v: boolean } | { t: "str"; v: string } | { t: "num"; v: string } | { t: "arr"; v: Enc[] } | { t: "obj"; v: [string, Enc][] };
type Outcome = { t: "bad" } | { t: "throw"; m: string } | { t: "value"; v: Enc };

function probe(workspace: string, file: string, symbol: string, calls: { args: Exclude<Arg, { k: "omit" }>[] }[]): Outcome[] | null {
  if (!/^[A-Za-z_$][\w$]+$/.test(symbol)) return null;
  const dir = mkdtempSync(join(tmpdir(), "peaceai-probe-"));
  try {
    const script = join(dir, "probe.mts");
    writeFileSync(script, `const fn = (await import(process.env.PROBE_URL)).${symbol};
const calls = JSON.parse(process.env.PROBE_CALLS);
const dec = (a) => a.k === "s" ? a.v : a.k === "n" ? a.v : a.k === "b" ? a.v : a.k === "date" ? new Date("2020-01-01T00:00:00Z") : a.k === "env" ? {} : a.v;
const enc = (v, d) => {
  if (d > 2) return { t: "bad" };
  if (v === null) return { t: "null" };
  if (v === undefined) return { t: "undef" };
  if (typeof v === "boolean") return { t: "bool", v };
  if (typeof v === "string") return v.length > 80 ? { t: "bad" } : { t: "str", v };
  if (typeof v === "number") return { t: "num", v: Object.is(v, -0) ? "-0" : Number.isNaN(v) ? "NaN" : v === Infinity ? "Infinity" : v === -Infinity ? "-Infinity" : String(v) };
  if (Array.isArray(v)) { if (v.length > 8) return { t: "bad" }; return { t: "arr", v: v.map((x) => enc(x, d + 1)) }; }
  if (typeof v === "object" && v.constructor === Object) { const keys = Object.keys(v).sort(); if (keys.length > 8) return { t: "bad" }; return { t: "obj", v: keys.map((k) => [k, enc(v[k], d + 1)]) }; }
  return { t: "bad" };
};
const out = [];
for (const call of calls) {
  if (typeof fn !== "function") { out.push({ t: "bad" }); break; }
  try { const v = fn(...call.map(dec)); out.push(v instanceof Promise ? { t: "bad" } : { t: "value", v: enc(v, 0) }); }
  catch (e) { out.push({ t: "throw", m: e instanceof Error ? e.message : "" }); }
}
process.stdout.write(JSON.stringify(out));
`);
    const tsx = require.resolve("tsx");
    const ran = spawnSync(process.execPath, ["--import", tsx, script], {
      encoding: "utf8", timeout: 12_000,
      env: { ...process.env, PROBE_URL: pathToFileURL(join(workspace, file)).href, PROBE_CALLS: JSON.stringify(calls.map((c) => c.args)) },
    });
    if (ran.status !== 0 || !ran.stdout) return null;
    const parsed = JSON.parse(ran.stdout) as Outcome[];
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function literal(v: Enc): string | null {
  if (v.t === "bad") return null;
  if (v.t === "null") return "null";
  if (v.t === "undef") return "undefined";
  if (v.t === "bool") return v.v ? "true" : "false";
  if (v.t === "str") return JSON.stringify(v.v);
  if (v.t === "num") return v.v;
  if (v.t === "arr") {
    const xs = v.v.map(literal);
    if (xs.some((x) => x === null)) return null;
    return `[${xs.join(", ")}]`;
  }
  const pairs = v.v.map(([k, val]) => { const lit = literal(val); return lit === null || !/^[A-Za-z_$][\w$]*$/.test(k) ? null : `${k}: ${lit}`; });
  if (pairs.some((p) => p === null)) return null;
  return `{ ${pairs.join(", ")} }`;
}

function checkFor(symbol: string, src: string[], outcome: Outcome): TestCheck | null {
  const expr = `${symbol}(${src.join(", ")})`;
  if (expr.length > 180) return null;
  if (outcome.t === "throw" && /^[A-Z][A-Z0-9_]{2,63}$/.test(outcome.m)) return { kind: "throws", expr, code: outcome.m };
  if (outcome.t !== "value") return null;
  const value = literal(outcome.v);
  if (value === null) return null;
  return value.startsWith("[") || value.startsWith("{") ? { kind: "deepEqual", expr, value } : { kind: "equal", expr, value };
}

/** Append one characterized assertion, or null when the request, the function, or the test file will not support it. */
export function characterizeAppend(trigger: string, objective: string, files: readonly { path: string; content: string }[], isTest: (p: string) => boolean, why?: { reason?: string }): { path: string; content: string; selfGrade: true } | null {
  const no = (r: string) => { if (why) why.reason = r; return null; };
  const head = headerOf(trigger, objective);
  if (!head) return null;
  const target = files.find((f) => f.path === head.file);
  if (!target) return no("target_file_not_found");
  const sib = { read: (rel: string) => files.find((f) => f.path === rel && !isTest(f.path))?.content ?? null };
  const repo = files as readonly RepoFile[];
  const pure = existingTargetRefusal(target.path, target.content, head.symbol, { v2: sib, dates: true, v4: true, v5: true, v6: true, v7: true, repo });
  if (pure) return no(/^[a-z_]{1,40}$/.test(pure) ? pure : "probe_refused");
  const slots = signature(target.content, head.symbol);
  if (!slots) return no("probe_signature");
  const where = testFile(head.symbol, head.file, files, isTest);
  if (!where) return no("no_test_file");
  const workspace = process.env.PEACEAI_WORKSPACE_DIR?.trim() || "";
  if (!workspace) return no("probe_unrun");
  const calls = callsOf(slots);
  const got = probe(workspace, head.file, head.symbol, calls);
  if (!got) return no("probe_failed");
  const order = got.map((outcome, i) => ({ outcome, call: calls[i]! })).filter((x) => x.call).sort((a, b) => Number(a.outcome.t !== "value") - Number(b.outcome.t !== "value"));
  const taskBase: TestTask = { symbol: head.symbol, file: head.file, title: `characterization ${head.symbol}`, checks: [], fixSha: "0".repeat(40) };
  const params = { assert: "node:assert/strict-default", checks: ["equal", "deepEqual", "throws"], framework: "node:test-default", grading: "fail-before-pass-after", matcher: "regex", maxLines: "8", placement: "append", args: ARGS_PLAIN_DATA_V3 };
  for (const item of order) {
    const check = checkFor(head.symbol, item.call.src, item.outcome);
    if (!check) continue;
    const built = buildTestEdit(params, { ...taskBase, checks: [check] }, files, isTest, where);
    if (!built || !built.content.startsWith(files.find((f) => f.path === built.path)?.content ?? "\0")) continue;
    return { path: built.path, content: built.content, selfGrade: true };
  }
  return no("probe_empty");
}
