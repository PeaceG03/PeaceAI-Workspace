// M8: learned edit rules. A rule is a small JSON spec mined from commits (peaceai/lib/mine.ts): a kind the
// engine below knows how to execute, the parameters learned from the evidence, the trigger phrase, and
// frequency counts. No code text is stored in a spec. The engine is deterministic TypeScript-AST editing;
// a rule only runs in Job A when the approved-rules list pins its exact content hash (peaceai/lib/approved.ts).
import { createHash } from "node:crypto";
import ts from "typescript";
import { buildTestEdit, parseTestTask, TEST_ASSERTS, TEST_CHECKS, TEST_FRAMEWORKS, TEST_MATCHERS, TEST_PARAM_KEYS, TEST_TRIGGER } from "./learned-test.ts";
import { applyGuardRule, GUARD_PARAM_KEYS, GUARD_TRIGGER, GUARD_VOCAB } from "./learned-guard.ts";

export const RULE_SCHEMA = "peaceai-learned-rule:v1" as const;
export const RULE_KINDS = ["SET_LITERAL", "ADD_SWITCH_CASE", "ADD_NULLISH_DEFAULT", "ADD_TEST_CASE", "ADD_THROW_GUARD"] as const;
export type RuleKind = (typeof RULE_KINDS)[number];
export const RULE_ID = /^(public|core)-[a-z0-9]+(?:-[a-z0-9]+)*-v[0-9]+$/;

export interface RuleSpec {
  schema: typeof RULE_SCHEMA;
  id: string;
  kind: RuleKind;
  minedFrom: "public" | "core";
  minerVersion: string;
  shape: string; // the mined shape this rule generalizes
  /** Trigger phrase (regular expression source, case-insensitive) with named groups the kind needs. */
  trigger: string;
  /** Parameters learned from the evidence (majority styles, allowed contexts and literal kinds). */
  params: Record<string, string | string[]>;
  evidence: { hunks: number; commits: number; files: number; repos: string[] };
}

/** Canonical JSON: sorted keys, no whitespace. The same function is used by the Results approval workflow. */
export function canonicalJson(value: unknown): string {
  if (typeof value !== "object" || value === null) return JSON.stringify(value); // scalars and null
  if (Array.isArray(value)) return "[" + value.map((item) => canonicalJson(item)).join(",") + "]";
  const record = value as Record<string, unknown>;
  const pairs = Object.keys(record).sort().map((key) => JSON.stringify(key) + ":" + canonicalJson(record[key]));
  return "{" + pairs.join(",") + "}";
}
/** Spec files are stored as their canonical JSON on one line, so the file content is exactly what is hashed. */
export const specFileText = (spec: unknown): string => canonicalJson(spec) + "\n";
export const specHash = (spec: unknown): string => createHash("sha256").update(canonicalJson(spec), "utf8").digest("hex");

export function validateSpec(o: unknown): o is RuleSpec {
  if (!o || typeof o !== "object") return false;
  const s = o as Record<string, unknown>;
  const ev = s.evidence as Record<string, unknown> | undefined;
  if (s.schema !== RULE_SCHEMA || typeof s.id !== "string" || !RULE_ID.test(s.id) || !RULE_KINDS.includes(s.kind as RuleKind)) return false;
  if (s.minedFrom !== "public" && s.minedFrom !== "core") return false;
  if (!s.id.startsWith(`${s.minedFrom}-`)) return false;
  if (typeof s.minerVersion !== "string" || typeof s.shape !== "string" || typeof s.trigger !== "string") return false;
  try { new RegExp(s.trigger, "i"); } catch { return false; }
  if (!s.params || typeof s.params !== "object") return false;
  for (const v of Object.values(s.params)) if (!(typeof v === "string" || (Array.isArray(v) && v.every((x) => typeof x === "string")))) return false;
  if (!ev || ![ev.hunks, ev.commits, ev.files].every((n) => Number.isInteger(n) && (n as number) >= 0) || !Array.isArray(ev.repos)) return false;
  if (s.kind === "ADD_TEST_CASE" && !validTestParams(s.params as Record<string, unknown>, s.minedFrom)) return false;
  if (s.kind === "ADD_THROW_GUARD" && !validGuardParams(s.params as Record<string, unknown>, s.minedFrom)) return false;
  return Object.keys(s).every((k) => ["schema", "id", "kind", "minedFrom", "minerVersion", "shape", "trigger", "params", "evidence"].includes(k));
}

/** M12: ADD_TEST_CASE specs carry exactly the template parameters, from fixed vocabularies; public-mined only. */
function validTestParams(p: Record<string, unknown>, minedFrom: unknown): boolean {
  if (minedFrom !== "public" || Object.keys(p).sort().join(",") !== [...TEST_PARAM_KEYS].join(",")) return false;
  const checks = p.checks;
  return (
    Array.isArray(checks) && checks.length > 0 && checks.every((c) => (TEST_CHECKS as readonly unknown[]).includes(c)) && new Set(checks).size === checks.length &&
    (TEST_FRAMEWORKS as readonly unknown[]).includes(p.framework) && (TEST_ASSERTS as readonly unknown[]).includes(p.assert) &&
    (TEST_MATCHERS as readonly unknown[]).includes(p.matcher) && p.placement === "new-file" && p.grading === "fail-before-pass-after" &&
    typeof p.maxLines === "string" && /^[1-9][0-9]?$/.test(p.maxLines)
  );
}

/** M13: ADD_THROW_GUARD specs carry exactly the guard parameters, from fixed vocabularies; public-mined only. */
function validGuardParams(p: Record<string, unknown>, minedFrom: unknown): boolean {
  if (minedFrom !== "public" || Object.keys(p).sort().join(",") !== [...GUARD_PARAM_KEYS].join(",")) return false;
  return GUARD_PARAM_KEYS.every((k) => typeof p[k] === "string" && GUARD_VOCAB[k].includes(p[k] as string));
}

export interface SourceFile { path: string; content: string }
/** `create` (M12): a new file (never an existing one); `fixSha`: the fix commit Job B grades the new test against. */
/** `extra` + `selfGrade` (M13): the guard rule's new test file(s); Job B grades the candidate against itself. */
export interface LearnedEdit { path: string; content: string; create?: true; fixSha?: string; extra?: { path: string; content: string; create: true }[]; selfGrade?: true }

const LIT = String.raw`(?:"[^"\n]*"|'[^'\n]*'|-?\d+(?:\.\d+)?|true|false)`;
const NAME = String.raw`[A-Za-z_$][\w$]*`;
const FILE = String.raw`[\w./-]+\.tsx?`;
/** Default trigger phrases per kind (used by the proposer; the spec carries its own copy, hashed). */
export const TRIGGERS: Record<RuleKind, string> = {
  SET_LITERAL: String.raw`^(?:set|change|update) (?:the )?(?:value of )?\x60?(?<name>${NAME})\x60?(?: in \x60?(?<file>${FILE})\x60?)? to (?<value>${LIT})\.?$`,
  ADD_SWITCH_CASE: String.raw`^add (?:a )?case (?<label>"[^"\n]+"|'[^'\n]+') (?:returning|that returns) (?<value>${LIT}) to (?:the )?switch in \x60?(?<fn>${NAME})\x60?(?: in \x60?(?<file>${FILE})\x60?)?\.?$`,
  ADD_NULLISH_DEFAULT: String.raw`^default \x60?(?<expr>${NAME}(?:\.${NAME})+)\x60? to (?<value>\[\]|null|${LIT}) in \x60?(?<fn>${NAME})\x60?(?: in \x60?(?<file>${FILE})\x60?)?\.?$`,
  ADD_TEST_CASE: TEST_TRIGGER,
  ADD_THROW_GUARD: GUARD_TRIGGER,
};

/** ADD_NULLISH_DEFAULT trigger that accepts only the default kinds the rule allows ("array" -> [], "string", ...). */
export function nullishTrigger(kinds: readonly string[]): string {
  const alt: Record<string, string> = { array: String.raw`\[\]`, null: "null", string: String.raw`"[^"\n]*"|'[^'\n]*'`, number: String.raw`-?\d+(?:\.\d+)?`, boolean: "true|false" };
  const values = ["array", "null", "string", "number", "boolean"].filter((k) => kinds.includes(k)).map((k) => alt[k]).join("|");
  return String.raw`^default \x60?(?<expr>${NAME}(?:\.${NAME})+)\x60? to (?<value>${values}) in \x60?(?<fn>${NAME})\x60?(?: in \x60?(?<file>${FILE})\x60?)?\.?$`;
}

const parse = (f: SourceFile) => ts.createSourceFile(f.path, f.content, ts.ScriptTarget.Latest, true, f.path.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
const litKind = (text: string) => (/^["']/.test(text) ? "string" : /^(true|false)$/.test(text) ? "boolean" : text === "[]" ? "array" : text === "null" ? "null" : "number");
const splice = (s: string, start: number, end: number, text: string) => s.slice(0, start) + text + s.slice(end);
const quoteLike = (value: string, sample: string) => {
  if (!/^["']/.test(value)) return value;
  const q = sample.startsWith("'") ? "'" : '"';
  const inner = value.slice(1, -1);
  return inner.includes(q) ? value : `${q}${inner}${q}`;
};
const list = (v: string | string[] | undefined) => (Array.isArray(v) ? v : v ? [v] : []);

function functionsNamed(sf: ts.SourceFile, name: string): ts.Node[] {
  const out: ts.Node[] = [];
  const visit = (n: ts.Node) => {
    if ((ts.isFunctionDeclaration(n) || ts.isMethodDeclaration(n)) && n.name?.getText(sf) === name && n.body) out.push(n.body);
    else if (ts.isVariableDeclaration(n) && n.name.getText(sf) === name && n.initializer && (ts.isArrowFunction(n.initializer) || ts.isFunctionExpression(n.initializer))) out.push(n.initializer.body);
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

/** SET_LITERAL: the single const or object property named `name` whose literal is replaced. */
function setLiteral(spec: RuleSpec, g: Record<string, string>, files: readonly SourceFile[]): LearnedEdit | null {
  const kinds = list(spec.params.kinds);
  const contexts = list(spec.params.contexts);
  const value = g.value!;
  if (!kinds.includes(litKind(value))) return null;
  const hits: { file: SourceFile; node: ts.Node }[] = [];
  for (const f of files) {
    if (g.file && f.path !== g.file) continue;
    const sf = parse(f);
    const visit = (n: ts.Node) => {
      let init: ts.Expression | undefined;
      let ctx = "";
      if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === g.name && n.initializer && (n.parent.flags & ts.NodeFlags.Const)) {
        init = n.initializer;
        ctx = ts.isSourceFile(n.parent.parent.parent) ? "top-level-const" : "local-const";
      } else if (ts.isPropertyAssignment(n) && n.name.getText(sf).replace(/^["']|["']$/g, "") === g.name) {
        init = n.initializer;
        ctx = "object-property";
      }
      if (init && contexts.includes(ctx)) {
        const t = init.getText(sf);
        const isLit = ts.isStringLiteral(init) || ts.isNumericLiteral(init) || init.kind === ts.SyntaxKind.TrueKeyword || init.kind === ts.SyntaxKind.FalseKeyword || (ts.isPrefixUnaryExpression(init) && ts.isNumericLiteral(init.operand));
        if (isLit && litKind(t) === litKind(value)) hits.push({ file: f, node: init });
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  if (hits.length !== 1) return null; // missing or ambiguous: never guess
  const { file, node } = hits[0]!;
  const sf = node.getSourceFile();
  const old = node.getText(sf);
  const next = quoteLike(value, old);
  if (next === old) return null;
  return { path: file.path, content: splice(file.content, node.getStart(sf), node.getEnd(), next) };
}

/** ADD_SWITCH_CASE: a new string-labelled case returning a literal, before `default:` (or last). */
function addSwitchCase(spec: RuleSpec, g: Record<string, string>, files: readonly SourceFile[]): LearnedEdit | null {
  const found: { file: SourceFile; sw: ts.SwitchStatement }[] = [];
  for (const f of files) {
    if (g.file && f.path !== g.file) continue;
    const sf = parse(f);
    for (const body of functionsNamed(sf, g.fn!)) {
      const sws: ts.SwitchStatement[] = [];
      const visit = (n: ts.Node) => { if (ts.isSwitchStatement(n)) sws.push(n); ts.forEachChild(n, visit); };
      visit(body);
      if (sws.length === 1) found.push({ file: f, sw: sws[0]! });
    }
  }
  if (found.length !== 1) return null;
  const { file, sw } = found[0]!;
  const sf = sw.getSourceFile();
  const clauses = sw.caseBlock.clauses;
  const cases = clauses.filter(ts.isCaseClause);
  if (cases.length === 0 || !cases.every((c) => ts.isStringLiteral(c.expression))) return null;
  const label = g.label!.slice(1, -1);
  if (cases.some((c) => (c.expression as ts.StringLiteral).text === label)) return null;
  if (spec.params.body !== "return-literal") return null;
  const sample = cases[cases.length - 1]!;
  const indent = /[ \t]*$/.exec(file.content.slice(0, sample.getStart(sf)))![0];
  const inner = sample.statements[0] ? /[ \t]*$/.exec(file.content.slice(0, sample.statements[0].getStart(sf)))![0] : `${indent}  `;
  const sameLine = sample.statements[0] && sf.getLineAndCharacterOfPosition(sample.statements[0].getStart(sf)).line === sf.getLineAndCharacterOfPosition(sample.getStart(sf)).line;
  const q = sample.expression.getText(sf)[0]!;
  const valueSample = sample.statements.find(ts.isReturnStatement)?.expression?.getText(sf) ?? '"';
  const ret = `return ${quoteLike(g.value!, valueSample)};`;
  const text = sameLine ? `case ${q}${label}${q}: ${ret}` : `case ${q}${label}${q}:\n${inner}${ret}`;
  const def = clauses.find(ts.isDefaultClause);
  const at = def ? def.getStart(sf) : sample.getEnd();
  const insert = def ? `${text}\n${indent}` : `\n${indent}${text}`;
  return { path: file.path, content: splice(file.content, at, at, insert) };
}

/**
 * ADD_NULLISH_DEFAULT: the read of `expr` inside function `fn` becomes `expr ?? value`. Refused when `expr` is
 * read more than once in that function: a default on the first read would not cover the others.
 */
function addNullishDefault(spec: RuleSpec, g: Record<string, string>, files: readonly SourceFile[]): LearnedEdit | null {
  if (!list(spec.params.kinds).includes(litKind(g.value!))) return null;
  const found: { file: SourceFile; node: ts.Expression }[] = [];
  for (const f of files) {
    if (g.file && f.path !== g.file) continue;
    const sf = parse(f);
    for (const body of functionsNamed(sf, g.fn!)) {
      let first: ts.Expression | null = null;
      let reads = 0;
      const visit = (n: ts.Node) => {
        if (ts.isPropertyAccessExpression(n) && n.getText(sf) === g.expr) {
          const p = n.parent;
          const assigned = ts.isBinaryExpression(p) && p.left === n && p.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && p.operatorToken.kind <= ts.SyntaxKind.LastAssignment;
          if (!assigned) reads += 1;
          const defaulted = ts.isBinaryExpression(p) && p.left === n && (p.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken || p.operatorToken.kind === ts.SyntaxKind.BarBarToken);
          const callee = ts.isCallExpression(p) && p.expression === n;
          if (!first && !assigned && !defaulted && !callee && !ts.isPropertyAccessExpression(p)) first = n;
          return;
        }
        ts.forEachChild(n, visit);
      };
      visit(body);
      if (reads > 1) return null;
      if (first) found.push({ file: f, node: first });
    }
  }
  if (found.length !== 1) return null;
  const { file, node } = found[0]!;
  const sf = node.getSourceFile();
  const p = node.parent;
  const bare = ts.isVariableDeclaration(p) || ts.isReturnStatement(p) || ts.isPropertyAssignment(p) || ts.isCallExpression(p) || ts.isArrayLiteralExpression(p) || ts.isParenthesizedExpression(p);
  const text = `${node.getText(sf)} ?? ${g.value}`;
  return { path: file.path, content: splice(file.content, node.getStart(sf), node.getEnd(), bare ? text : `(${text})`) };
}

/** Runs one rule against the objective. Null when the trigger does not match or the edit is not unique. */
export function applyRule(spec: RuleSpec, objective: string, files: readonly SourceFile[], isTest?: (path: string) => boolean): LearnedEdit | null {
  if (spec.kind === "ADD_TEST_CASE") {
    try {
      const task = parseTestTask(spec.trigger, objective);
      return task ? buildTestEdit(spec.params, task, files, isTest) : null;
    } catch {
      return null;
    }
  }
  if (spec.kind === "ADD_THROW_GUARD") {
    try {
      return applyGuardRule(spec.trigger, spec.params, objective, files, isTest);
    } catch {
      return null;
    }
  }
  const line = objective.split("\n").map((l) => l.trim()).find((l) => new RegExp(spec.trigger, "i").test(l));
  if (!line) return null;
  const g = { ...(new RegExp(spec.trigger, "i").exec(line)!.groups ?? {}) } as Record<string, string>;
  try {
    if (spec.kind === "SET_LITERAL") return setLiteral(spec, g, files);
    if (spec.kind === "ADD_SWITCH_CASE") return addSwitchCase(spec, g, files);
    return addNullishDefault(spec, g, files);
  } catch {
    return null;
  }
}
