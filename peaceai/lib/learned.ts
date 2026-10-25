// M8: learned edit rules. A rule is a small JSON spec mined from commits (peaceai/lib/mine.ts): a kind the
// engine below knows how to execute, the parameters learned from the evidence, the trigger phrase, and
// frequency counts. No code text is stored in a spec. The engine is deterministic TypeScript-AST editing;
// a rule only runs in Job A when the approved-rules list pins its exact content hash (peaceai/lib/approved.ts).
import { createHash } from "node:crypto";
import ts from "typescript";
import { buildTestEdit, parseTestTask, TEST_ASSERTS, TEST_CHECKS, TEST_FRAMEWORKS, TEST_MATCHERS, TEST_PARAM_KEYS, TEST_TRIGGER } from "./learned-test.ts";
import { applyGuardRule, GUARD_PARAM_KEYS, GUARD_TRIGGER, GUARD_VOCAB, type Refusal } from "./learned-guard.ts";
import { WORKFLOW_JOB_PARAM_KEYS, WORKFLOW_JOB_TRIGGER, WORKFLOW_JOB_VOCAB, runWorkflowJobRule } from "./workflow-job.ts";
import { TSCONFIG_SCRIPT_PARAM_KEYS, TSCONFIG_SCRIPT_TRIGGER, TSCONFIG_SCRIPT_VOCAB, runTsconfigScriptRule } from "./tsconfig-script.ts";
import { ENV_FIX_TRIGGER, runEnvFixRule, validEnvFixParams } from "./env-fix.ts";
import { IMPORT_EDIT_V2_PARAM_KEYS, IMPORT_EDIT_V2_TRIGGER, IMPORT_EDIT_V2_VOCAB, runImportEditV2Rule } from "./import-edit-v2.ts";
import { applyMethodGuardRule, METHOD_GUARD_PARAM_KEYS, METHOD_GUARD_TRIGGER, METHOD_GUARD_VOCAB } from "./method-guard.ts";
import { applyReplaceRule, BODY_PARAM_KEYS, BODY_VOCAB, REPLACE_TRIGGER } from "./learned-body.ts";
import { parseExistingTestTask, runExistingTestRule, TEST_EXISTING_TRIGGER, validTestExistingParams } from "./learned-test-existing.ts";
import { existingEditDetail, EXISTING_EDIT_TRIGGER, validExistingEditParams } from "./learned-edit-existing.ts";
import { COMPLEX_OPTIONAL_VOCAB, COMPLEX_PARAM_KEYS, COMPLEX_TRIGGER, COMPLEX_VOCAB, runComplexRule } from "./learned-complex.ts";
import { lstatSync } from "node:fs";
import { loadTargets, scopeOf } from "./target.ts";
import { selfZoneEditRefusal, WORKSPACE_TARGET } from "./self-zone.ts";
import { join } from "node:path";
import { DERIVE_TRIGGER, runDeriveRule, validDeriveParams } from "./learned-derive.ts";
import { applyFunctionRule, FUNCTION_PARAM_KEYS, FUNCTION_TRIGGER, FUNCTION_VOCAB } from "./learned-function.ts";
import { applyWorkflowRule, REVOKED_WORKFLOW_SPECS, WORKFLOW_PARAM_KEYS, WORKFLOW_TRIGGER, WORKFLOW_VOCAB } from "./learned-workflow.ts";

export const RULE_SCHEMA = "peaceai-learned-rule:v1" as const;
export const RULE_KINDS = ["SET_LITERAL", "ADD_SWITCH_CASE", "ADD_NULLISH_DEFAULT", "ADD_TEST_CASE", "ADD_THROW_GUARD", "ADD_FUNCTION", "ADD_WORKFLOW_STEP", "REPLACE_EXPRESSION", "METHOD_GUARD", "COMPLEX_FUNCTION", "IMPORT_EDIT_V2", "WORKFLOW_JOB", "TSCONFIG_SCRIPT", "ENV_FIX", "TEST_EXISTING", "EXISTING_EDIT", "DERIVE_FROM_BEHAVIOR"] as const;
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
  if (s.kind === "IMPORT_EDIT_V2" && !validImportEditV2Params(s.params as Record<string, unknown>, s.minedFrom)) return false;
  if (s.kind === "WORKFLOW_JOB" && !validFixedParams(s.params as Record<string, unknown>, s.minedFrom, WORKFLOW_JOB_PARAM_KEYS, WORKFLOW_JOB_VOCAB)) return false;
  if (s.kind === "TSCONFIG_SCRIPT" && !validFixedParams(s.params as Record<string, unknown>, s.minedFrom, TSCONFIG_SCRIPT_PARAM_KEYS, TSCONFIG_SCRIPT_VOCAB)) return false;
  if (s.kind === "ENV_FIX" && (s.minedFrom !== "public" || !validEnvFixParams(s.params as Record<string, unknown>))) return false; // v2: optional `int`
  if (s.kind === "METHOD_GUARD" && !validMethodGuardParams(s.params as Record<string, unknown>, s.minedFrom)) return false;
  if (s.kind === "TEST_EXISTING" && !validTestExistingParams(s.params as Record<string, unknown>, s.minedFrom)) return false; // M80
  if (s.kind === "EXISTING_EDIT" && !validExistingEditParams(s.params as Record<string, unknown>, s.minedFrom)) return false; // M98
  if (s.kind === "COMPLEX_FUNCTION" && !validComplexParams(s.params as Record<string, unknown>, s.minedFrom)) return false;
  if (s.kind === "DERIVE_FROM_BEHAVIOR" && !validDeriveParams(s.params as Record<string, unknown>, s.minedFrom)) return false; // M99
  if (s.kind === "ADD_FUNCTION" && !validFunctionParams(s.params as Record<string, unknown>, s.minedFrom)) return false;
  if (s.kind === "REPLACE_EXPRESSION" && !validBodyParams(s.params as Record<string, unknown>, s.minedFrom)) return false;
  if (s.kind === "ADD_WORKFLOW_STEP" && REVOKED_WORKFLOW_SPECS.has(s.id as string)) return false;
  if (s.kind === "ADD_WORKFLOW_STEP" && !validWorkflowParams(s.params as Record<string, unknown>, s.minedFrom)) return false;
  return Object.keys(s).every((k) => ["schema", "id", "kind", "minedFrom", "minerVersion", "shape", "trigger", "params", "evidence"].includes(k));
}

/** M12: ADD_TEST_CASE specs carry exactly the template parameters, from fixed vocabularies; public-mined only. */
function validTestParams(p: Record<string, unknown>, minedFrom: unknown): boolean {
  // M20: the optional `args` key marks an arguments spec: "object-literal" (M20) or "date-literal" (M35).
  const keys = Object.keys(p).filter((k) => k !== "args").sort().join(",");
  if (minedFrom !== "public" || keys !== [...TEST_PARAM_KEYS].join(",") || ("args" in p && p.args !== "object-literal" && p.args !== "date-literal")) return false;
  const checks = p.checks;
  return (
    Array.isArray(checks) && checks.length > 0 && checks.every((c) => (TEST_CHECKS as readonly unknown[]).includes(c)) && new Set(checks).size === checks.length &&
    (TEST_FRAMEWORKS as readonly unknown[]).includes(p.framework) && (TEST_ASSERTS as readonly unknown[]).includes(p.assert) &&
    (TEST_MATCHERS as readonly unknown[]).includes(p.matcher) && (p.placement === "new-file" || p.placement === "append") && p.grading === "fail-before-pass-after" &&
    typeof p.maxLines === "string" && /^[1-9][0-9]?$/.test(p.maxLines)
  );
}

/** M67: WORKFLOW_JOB / TSCONFIG_SCRIPT / ENV_FIX specs; public-mined only, fixed one-value vocabularies. */
function validFixedParams(p: Record<string, unknown>, minedFrom: unknown, keys: readonly string[], vocab: Record<string, readonly string[]>): boolean {
  if (minedFrom !== "public" || Object.keys(p).sort().join(",") !== [...keys].sort().join(",")) return false;
  return keys.every((k) => typeof p[k] === "string" && vocab[k]!.includes(p[k] as string));
}

/** M66: IMPORT_EDIT_V2 specs; public-mined only, fixed one-value vocabularies. */
function validImportEditV2Params(p: Record<string, unknown>, minedFrom: unknown): boolean {
  if (minedFrom !== "public" || Object.keys(p).sort().join(",") !== [...IMPORT_EDIT_V2_PARAM_KEYS].join(",")) return false;
  return IMPORT_EDIT_V2_PARAM_KEYS.every((k) => typeof p[k] === "string" && IMPORT_EDIT_V2_VOCAB[k].includes(p[k] as string));
}

/** M62: METHOD_GUARD specs; public-mined only. */
function validMethodGuardParams(p: Record<string, unknown>, minedFrom: unknown): boolean {
  if (minedFrom !== "public" || Object.keys(p).sort().join(",") !== [...METHOD_GUARD_PARAM_KEYS].join(",")) return false;
  return METHOD_GUARD_PARAM_KEYS.every((k) => typeof p[k] === "string" && METHOD_GUARD_VOCAB[k].includes(p[k] as string));
}

/** M26 wiring: COMPLEX_FUNCTION specs; public-mined only; loops is a non-empty list from the vocabulary. */
function validComplexParams(p: Record<string, unknown>, minedFrom: unknown): boolean {
  // M74: optional `types: "primitive+date"` (public-date-function-v1), only with loops ["none"].
  if ("types" in p && (p.types !== "primitive+date" || !Array.isArray(p.loops) || (p.loops as unknown[]).join(",") !== "none")) return false;
  // M85: optional calls + callbacks pair (public-complex-calls-v1): both or neither, fixed values, never with types.
  if (("calls" in p || "callbacks" in p) && (p.calls !== COMPLEX_OPTIONAL_VOCAB.calls[0] || p.callbacks !== COMPLEX_OPTIONAL_VOCAB.callbacks[0] || "types" in p)) return false;
  if (minedFrom !== "public" || Object.keys(p).filter((k) => k !== "types" && k !== "calls" && k !== "callbacks").sort().join(",") !== [...COMPLEX_PARAM_KEYS].join(",")) return false;
  return COMPLEX_PARAM_KEYS.every((k) => k === "loops"
    ? Array.isArray(p[k]) && (p[k] as unknown[]).length > 0 && (p[k] as unknown[]).every((x) => typeof x === "string" && COMPLEX_VOCAB.loops.includes(x))
      && (!(p[k] as unknown[]).includes("none") || (p[k] as unknown[]).length === 1) // Auditor #218: "none" never mixed with loop kinds
    : typeof p[k] === "string" && COMPLEX_VOCAB[k].includes(p[k] as string));
}

/** M13: ADD_THROW_GUARD specs carry exactly the guard parameters, from fixed vocabularies; public-mined only. */
function validGuardParams(p: Record<string, unknown>, minedFrom: unknown): boolean {
  if (minedFrom !== "public" || Object.keys(p).sort().join(",") !== [...GUARD_PARAM_KEYS].join(",")) return false;
  return GUARD_PARAM_KEYS.every((k) => typeof p[k] === "string" && GUARD_VOCAB[k].includes(p[k] as string));
}

/** M19: ADD_WORKFLOW_STEP specs carry exactly the step parameters, from fixed one-value vocabularies; public-mined only. */
function validWorkflowParams(p: Record<string, unknown>, minedFrom: unknown): boolean {
  if (minedFrom !== "public" || Object.keys(p).sort().join(",") !== [...WORKFLOW_PARAM_KEYS].join(",")) return false;
  return WORKFLOW_PARAM_KEYS.every((k) => typeof p[k] === "string" && WORKFLOW_VOCAB[k].includes(p[k] as string));
}

/** M27: REPLACE_EXPRESSION specs carry exactly the body parameters, from fixed vocabularies; public-mined only. */
function validBodyParams(p: Record<string, unknown>, minedFrom: unknown): boolean {
  if (minedFrom !== "public" || Object.keys(p).sort().join(",") !== [...BODY_PARAM_KEYS].join(",")) return false;
  return BODY_PARAM_KEYS.every((k) => {
    const v = p[k];
    const vocab = BODY_VOCAB[k] as readonly string[];
    if (k === "sites") return Array.isArray(v) && v.length > 0 && new Set(v).size === v.length && v.every((x) => vocab.includes(x as string));
    return typeof v === "string" && vocab.includes(v);
  });
}

/** M15: ADD_FUNCTION specs carry exactly the function parameters, from fixed vocabularies; public-mined only. */
function validFunctionParams(p: Record<string, unknown>, minedFrom: unknown): boolean {
  if (minedFrom !== "public" || Object.keys(p).sort().join(",") !== [...FUNCTION_PARAM_KEYS].join(",")) return false;
  return FUNCTION_PARAM_KEYS.every((k) => typeof p[k] === "string" && FUNCTION_VOCAB[k].includes(p[k] as string));
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
  METHOD_GUARD: METHOD_GUARD_TRIGGER,
  IMPORT_EDIT_V2: IMPORT_EDIT_V2_TRIGGER,
  WORKFLOW_JOB: WORKFLOW_JOB_TRIGGER,
  TSCONFIG_SCRIPT: TSCONFIG_SCRIPT_TRIGGER,
  ENV_FIX: ENV_FIX_TRIGGER,
  COMPLEX_FUNCTION: COMPLEX_TRIGGER,
  ADD_FUNCTION: FUNCTION_TRIGGER,
  ADD_WORKFLOW_STEP: WORKFLOW_TRIGGER,
  REPLACE_EXPRESSION: REPLACE_TRIGGER,
  TEST_EXISTING: TEST_EXISTING_TRIGGER,
  EXISTING_EDIT: EXISTING_EDIT_TRIGGER,
  DERIVE_FROM_BEHAVIOR: DERIVE_TRIGGER,
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

/**
 * Auditor #135: a predicate that says whether a path already exists in the whole target checkout, the full
 * `git ls-files` list or on disk (untracked/ignored files too), not just the context subset handed to a rule.
 */
export function pathExistsIn(repo: string, tracked: readonly string[]): (path: string) => boolean {
  const all = new Set(tracked);
  // lstat, not exists: a dangling symlink at the path still occupies it (existsSync follows links and says no).
  const onDisk = (path: string) => { try { lstatSync(join(repo, path)); return true; } catch (e) { return (e as NodeJS.ErrnoException).code !== "ENOENT"; } }; // only a clean ENOENT means free (fail closed)
  return (path) => all.has(path) || onDisk(path);
}

/**
 * Runs one rule against the objective. Null when the trigger does not match or the edit is not unique.
 * Auditor #135 (all kinds): a generated NEW file (new test files in `extra`, or a created main file) is refused
 * with `new_test_path_exists` when `exists` reports it already present in the full checkout.
 */
export function applyRule(spec: RuleSpec, objective: string, files: readonly SourceFile[], isTest?: (path: string) => boolean, repo?: string, why?: Refusal, exists?: (path: string) => boolean, scan?: readonly SourceFile[]): LearnedEdit | null {
  // Auditor #466 (c), option A: `scan` (repoFileLists' scan list, denied files included) reaches only the
  // TEST_CASE_EXISTING static shared-binding scan; every rule still reads, targets and edits `files` alone.
  const edit = applyRuleInner(spec, objective, files, isTest, repo, why, scan);
  if (!edit) {
    // M76: Job A hands the rules only in-scope files, so a Workspace task naming a protected (or out-of-zone) file
    // used to read as target_file_not_found. Name the real reason instead. This only renames a refusal; it never builds.
    if (repo === WORKSPACE_TARGET && why?.reason === "target_file_not_found") {
      const file = namedTargetFile(spec, objective);
      const r = file === null ? null : selfZoneRefusal([file]);
      if (r) why.reason = r;
    }
    return edit;
  }
  // #314 (Architect): the target's denyPatterns are enforced here too, so every caller (generate.ts, box
  // dry-runs, tools) refuses a denied path even when it hands in an unfiltered file list. Same order as
  // scope.ts checkCandidateScope: an opted-in workflow file is checked by its own rules, not by deny.
  // M72 SELF_CHANGE stage 1 (checked first, so the reason is named even when the zone is on): on this Workspace a candidate outside src/ may only touch the safe zone, and never a
  // protected file (grading, leak/tamper checks, verdict/approval, scope lists, lm.ts, workflows, the lists).
  if (repo === WORKSPACE_TARGET) {
    const r = selfZoneRefusal([edit.path, ...(edit.extra ?? []).map((x) => x.path)]);
    if (r) { if (why) why.reason = r; return null; }
  }
  if (repo && deniedEditPath(repo, [edit.path, ...(edit.extra ?? []).map((x) => x.path)])) { if (why) why.reason = "denied_path"; return null; }
  if (!exists) return edit;
  const created = [...(edit.create ? [edit.path] : []), ...(edit.extra ?? []).filter((x) => x.create).map((x) => x.path)];
  if (created.some((p) => exists(p))) { if (why) why.reason = "new_test_path_exists"; return null; }
  return edit;
}

/** M76: the file a rule's own trigger names (its `file` group), or null when the trigger has none or does not match. */
export function namedTargetFile(spec: RuleSpec, objective: string): string | null {
  try {
    const m = new RegExp(spec.trigger, "imu").exec(objective);
    return typeof m?.groups?.file === "string" ? m.groups.file : null;
  } catch {
    return null;
  }
}

/** M72: the Workspace refusal for a set of edit paths: protected first, then outside the (enabled) safe zone. */
export function selfZoneRefusal(paths: readonly string[], enabled = loadTargets().targets[WORKSPACE_TARGET]?.selfZone === true): "self_protected_path" | "outside_safe_zone" | null {
  const r = selfZoneEditRefusal(paths);
  if (r) return r;
  return !enabled && paths.some((p) => !/^src\//.test(p)) ? "outside_safe_zone" : null;
}

/** True when `repo` is a configured target and any path is denied for it (opted-in workflow files excepted). */
export function deniedEditPath(repo: string, paths: readonly string[]): boolean {
  const config = loadTargets().targets[repo];
  if (!config) return false;
  const scope = scopeOf(config);
  return paths.some((p) => !(!scope.isSource(p) && scope.isWorkflow(p)) && scope.isDenied(p));
}

/** M98: an engine refusal as a run-log reason: the code, plus the refused name only when it is a plain identifier. */
function whyReason(code: string): string {
  const i = code.indexOf(":");
  if (i < 0) return code;
  const head = code.slice(0, i), name = code.slice(i + 1);
  return /^[A-Za-z_$][\w$]{0,63}$/.test(name) ? `${head}: ${name}` : head;
}

function applyRuleInner(spec: RuleSpec, objective: string, files: readonly SourceFile[], isTest?: (path: string) => boolean, repo?: string, why?: Refusal, scan?: readonly SourceFile[]): LearnedEdit | null {
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
      return applyGuardRule(spec.trigger, spec.params, objective, files, isTest, why);
    } catch {
      if (why) why.reason = "internal_error";
      return null;
    }
  }
  // M67 un-drop batch: each admitted only via the hash-pinned approved list (Peace /approve-rule).
  if (spec.kind === "WORKFLOW_JOB" || spec.kind === "TSCONFIG_SCRIPT" || spec.kind === "ENV_FIX") {
    try {
      const run = spec.kind === "WORKFLOW_JOB" ? runWorkflowJobRule : spec.kind === "TSCONFIG_SCRIPT" ? runTsconfigScriptRule : runEnvFixRule;
      return run(spec.trigger, spec.params, objective, files, why);
    } catch {
      if (why) why.reason = "internal_error";
      return null;
    }
  }
  if (spec.kind === "IMPORT_EDIT_V2") {
    try {
      return runImportEditV2Rule(spec.trigger, spec.params, objective, files, why); // M66: one existing import; admitted only via the hash-pinned approved list; graded by the target's own checks
    } catch {
      if (why) why.reason = "internal_error";
      return null;
    }
  }
  if (spec.kind === "EXISTING_EDIT") {
    // M98 (public-existing-function-edit-v1): one statement inside an existing function / class method, with a new
    // fake-driven test; the engine refuses with a code (whyReason keeps only the code and a plain identifier).
    try {
      const r = existingEditDetail(spec.trigger, spec.params, objective, files, isTest);
      if (!r.edit) { if (why) why.reason = whyReason(r.reason ?? "edit_refused"); return null; }
      if (repo && deniedEditPath(repo, [r.edit.path])) { if (why) why.reason = "denied_path"; return null; }
      return r.edit;
    } catch {
      if (why) why.reason = "internal_error";
      return null;
    }
  }
  if (spec.kind === "METHOD_GUARD") {
    try {
      return applyMethodGuardRule(spec.trigger, spec.params, objective, files, isTest, why);
    } catch {
      if (why) why.reason = "internal_error";
      return null;
    }
  }
  if (spec.kind === "TEST_EXISTING") {
    try {
      // The tested module itself may not be a denied path of the target (the new test file is checked by applyRule).
      const t = parseExistingTestTask(spec.trigger, objective);
      if (t && repo && deniedEditPath(repo, [t.file])) { if (why) why.reason = "denied_path"; return null; }
      return runExistingTestRule(spec.trigger, spec.params, objective, files, isTest, why, scan); // M80: one new test file for an existing exported pure function; admitted only via the hash-pinned approved list; graded fix-free in Job B
    } catch {
      if (why) why.reason = "internal_error";
      return null;
    }
  }
  if (spec.kind === "COMPLEX_FUNCTION") {
    try {
      return runComplexRule(spec.trigger, spec.params, objective, files, isTest, why); // #211 loops ["none"]: loop_unsupported; M65: public-loop-function-v1 runs its for/for-of grammar (while: loop_while_unsupported). Admitted only via the hash-pinned approved list; plain, unprotected paths only
    } catch {
      if (why) why.reason = "internal_error";
      return null;
    }
  }
  if (spec.kind === "DERIVE_FROM_BEHAVIOR") {
    try {
      return runDeriveRule(spec.trigger, spec.params, objective, files, isTest, why); // M99: PeaceAI derives the body from behavior + examples; admitted only via the hash-pinned approved list
    } catch {
      if (why) why.reason = "internal_error";
      return null;
    }
  }
  if (spec.kind === "ADD_FUNCTION") {
    try {
      return applyFunctionRule(spec.trigger, spec.params, objective, files, isTest);
    } catch {
      return null;
    }
  }
  if (spec.kind === "REPLACE_EXPRESSION") {
    try {
      return applyReplaceRule(spec.trigger, spec.params, objective, files, isTest, repo); // Round 3 (#136): per-repo allow-list
    } catch {
      return null;
    }
  }
  if (spec.kind === "ADD_WORKFLOW_STEP") {
    try {
      return applyWorkflowRule(spec.trigger, spec.params, objective, files, isTest);
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
