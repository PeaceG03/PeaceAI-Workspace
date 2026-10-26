// M67 ENV_FIX (public-env-fix-v1, un-drop batch; Architect-approved redefinition: a code edit that makes ONE
// environment-variable read strict and fail-closed). Two fixed shapes, chosen by the task:
//   flag  every read of X (process.env.NAME, env.NAME, or the ["NAME"] forms) in the file is `X === "1"` or `X !== "1"`; each becomes
//         `strictNAME(X)` / `!strictNAME(X)`, with an appended helper: unset/""/"0" -> false, "1" -> true, else throws
//         NAME_INVALID.
//   int   the one read of X is `Number(X) > 0 ? Number(X) : DEFAULT` (DEFAULT an identifier or integer literal);
//         it becomes `strictNAME(X)`, with an appended helper: blank -> DEFAULT, plain digits 1..MAX -> the number,
//         else throws NAME_INVALID.
// v2 (public-env-fix-v2, params.int = "ternary-nullish-or"): int also accepts, as the ONE read of X,
//         `Number(X ?? "N")` (N a plain-digit string literal) and `Number(X) || D` (D an integer literal, an
//         identifier, or a product of integer literals such as `5 * 3_600_000`); the default must be >= 1 when literal.
//         Refused: env_fix_bad_default (non-numeric / zero / fractional default), env_fix_mixed_reads (any other read).
// v3 (public-env-fix-v3, params.name = "task-or-sibling-convention"): the helper NAME is no longer always strictNAME.
//         1. the task names it: `... as a flag via \`fooBar\`` (the optional `via` group of the v3 trigger);
//         2. else the file's own convention: every one-parameter function DECLARED in the file and called on an env
//            read (`parseX(process.env.Y)`) is read as prefix + kept tokens of Y (a dropped leading namespace, e.g.
//            APP_, must equal NAME's own leading tokens), with the sibling's spelling of each token (MYAPP ->
//            MyApp). Each sibling votes for a name for NAME; most votes wins, ties prefer fewer dropped tokens,
//            and a remaining tie (or no sibling) abstains;
//         3. else strictNAME as in v1/v2. A v1/v2 spec (no `name` param) ignores both and is unchanged.
// Plus ONE new test file with the value table (blank, 0/1 or in-range, and the fail-closed values).
// Refused (short codes): env_fix_read_not_found, env_fix_mixed_reads (any other read of X in the file),
// env_fix_helper_taken, env_fix_bad_helper (v3: not a plain lower-camel name, or reserved), env_fix_bad_max, path_not_plain, protected_path, target_missing, env_fix_test_exists.
import ts from "typescript";
import { PROTECTED_SELF } from "./selfchange.ts";

export const ENV_FIX_FLAG = "PEACEAI_ENV_FIX";
export const envFixEnabled = (env: Record<string, string | undefined>): boolean => env[ENV_FIX_FLAG] === "true";
export const ENV_FIX_PARAM_KEYS = ["grading", "helper", "test"] as const;
export const ENV_FIX_VOCAB: Record<(typeof ENV_FIX_PARAM_KEYS)[number], readonly string[]> = {
  grading: ["self-fail-before-pass-after"],
  helper: ["end-of-module-fail-closed"],
  test: ["new-file-value-table"],
};
/** v2 only: optional `int` param. Absent = v1 (ternary shape only); a v1 spec's hash and behaviour are unchanged. */
export const ENV_FIX_INT_VOCAB = ["ternary-nullish-or"] as const;
/** v3 only: optional `name` param (helper name from the task text, else the file's sibling convention). */
export const ENV_FIX_NAME_VOCAB = ["task-or-sibling-convention"] as const;
export function validEnvFixParams(p: Record<string, unknown>): boolean {
  if ("name" in p && !(typeof p.name === "string" && (ENV_FIX_NAME_VOCAB as readonly string[]).includes(p.name))) return false;
  const keys = Object.keys(p).filter((k) => k !== "int" && k !== "name");
  if (keys.sort().join(",") !== [...ENV_FIX_PARAM_KEYS].sort().join(",")) return false;
  if (!ENV_FIX_PARAM_KEYS.every((k) => typeof p[k] === "string" && ENV_FIX_VOCAB[k].includes(p[k] as string))) return false;
  return !("int" in p) || (typeof p.int === "string" && (ENV_FIX_INT_VOCAB as readonly string[]).includes(p.int));
}
const ENVNAME = String.raw`[A-Z][A-Z0-9_]{1,60}`;
const FILE = String.raw`[\w./-]+\.ts`;
/** make env NAME strict in src/FILE.ts as a flag | as an integer 1..MAX */
export const ENV_FIX_TRIGGER = String.raw`^make (?:the )?env(?:ironment variable)? \x60?(?<name>${ENVNAME})\x60? strict in \x60?(?<file>${FILE})\x60? as (?:a |an )?(?:(?<flag>flag)|integer 1\.\.(?<max>\d{1,9}))\.?$`;
/** v3: the v2 phrase plus an optional ` via \`helperName\`` (the exported helper the change adds). */
export const ENV_FIX_TRIGGER_V3 = ENV_FIX_TRIGGER.replace(String.raw`)\.?$`, String.raw`)(?: via (?:helper )?\x60?(?<helper>[a-z][A-Za-z0-9]{2,60})\x60?)?\.?$`);
export interface EnvFixTask { name: string; file: string; mode: "flag" | "int"; max: number; helper?: string }
const plainPath = (p: string) => !p.startsWith("/") && !p.split("/").some((x) => x === "" || x === "." || x === ".." || x.startsWith("."));
const isProtected = (p: string) => PROTECTED_SELF.some((x) => x.pattern.test(p));

export function parseEnvFixTask(trigger: string, objective: string): EnvFixTask | null {
  const re = new RegExp(trigger, "i");
  const heads = objective.split("\n").map((l) => l.trim()).filter((l) => re.test(l));
  if (heads.length !== 1) return null;
  const g = re.exec(heads[0]!)!.groups ?? {};
  if (!g.name || !g.file) return null;
  const t: EnvFixTask = g.flag ? { name: g.name, file: g.file, mode: "flag", max: 0 } : { name: g.name, file: g.file, mode: "int", max: Number(g.max) };
  return g.helper ? { ...t, helper: g.helper } : t;
}

export const helperName = (name: string) => "strict" + name.toLowerCase().split("_").filter(Boolean).map((w) => w[0]!.toUpperCase() + w.slice(1)).join("");
const isEnvObj = (e: ts.Expression) => (ts.isPropertyAccessExpression(e) && ts.isIdentifier(e.expression) && e.expression.text === "process" && e.name.text === "env") || (ts.isIdentifier(e) && e.text === "env");
/** A read of NAME: process.env.NAME / env.NAME, or (Auditor #266) process.env["NAME"] / env["NAME"]. */
const isRead = (n: ts.Node, name: string): n is ts.PropertyAccessExpression | ts.ElementAccessExpression =>
  (ts.isPropertyAccessExpression(n) && n.name.text === name && isEnvObj(n.expression)) ||
  (ts.isElementAccessExpression(n) && (ts.isStringLiteral(n.argumentExpression) || ts.isNoSubstitutionTemplateLiteral(n.argumentExpression)) && n.argumentExpression.text === name && isEnvObj(n.expression));
const envReadName = (n: ts.Node): string | null =>
  ts.isPropertyAccessExpression(n) && isEnvObj(n.expression) ? n.name.text
  : ts.isElementAccessExpression(n) && isEnvObj(n.expression) && (ts.isStringLiteral(n.argumentExpression) || ts.isNoSubstitutionTemplateLiteral(n.argumentExpression)) ? n.argumentExpression.text : null;
const RESERVED = new Set(["break", "case", "catch", "class", "const", "continue", "debugger", "default", "delete", "do", "else", "enum", "export", "extends", "false", "finally", "for", "function", "if", "import", "in", "instanceof", "new", "null", "return", "super", "switch", "this", "throw", "true", "try", "typeof", "var", "void", "while", "with", "let", "static", "yield", "await", "implements", "interface", "package", "private", "protected", "public", "undefined", "process", "env", "value"]);

/**
 * v3: the helper name the file's own env-parsing siblings imply for NAME, or null (abstain). A sibling is a
 * one-parameter function declared at the top level of this file and called as `fn(<env read of Y>)`, Y != NAME.
 * fn must end with Y's tokens minus k leading ones (case-insensitive; the rest of fn is a lower-camel prefix, maybe
 * empty), and NAME must start with the same k dropped tokens. The sibling then votes for prefix + NAME's kept
 * tokens, spelled as the sibling spells shared tokens (MYAPP -> MyApp) and Capitalized otherwise.
 */
export function siblingHelperName(name: string, content: string): string | null {
  const sf = ts.createSourceFile("m.ts", content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const declared = new Set<string>();
  for (const s of sf.statements) if (ts.isFunctionDeclaration(s) && s.name && s.parameters.length === 1) declared.add(s.name.text);
  const toks = name.split("_").filter(Boolean);
  const votes = new Map<string, { n: number; d: number }>();
  const seen = new Set<string>();
  const visit = (n: ts.Node): void => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && declared.has(n.expression.text) && n.arguments.length === 1) {
      const fn = n.expression.text;
      const y = envReadName(n.arguments[0]!);
      if (y && y !== name && !seen.has(`${fn}|${y}`)) {
        seen.add(`${fn}|${y}`);
        const ys = y.split("_").filter(Boolean);
        for (let d = 0; d < ys.length; d += 1) {
          const kept = ys.slice(d);
          const tail = kept.join("").toLowerCase();
          if (!fn.toLowerCase().endsWith(tail)) continue;
          const prefix = fn.slice(0, fn.length - tail.length);
          if (prefix && !/^[a-z][A-Za-z0-9]*$/.test(prefix)) break;
          if (d >= toks.length || ys.slice(0, d).some((t, i) => toks[i] !== t)) break;
          const spell = new Map<string, string>();
          let i = prefix.length;
          for (const t of kept) { spell.set(t, fn.slice(i, i + t.length)); i += t.length; }
          const parts = toks.slice(d).map((t) => { const w = spell.get(t) ?? t[0]! + t.slice(1).toLowerCase(); return w[0]!.toUpperCase() + w.slice(1); });
          const joined = parts.join("");
          const out = prefix ? prefix + joined : joined[0]!.toLowerCase() + joined.slice(1);
          const v = votes.get(out) ?? { n: 0, d };
          v.n += 1;
          votes.set(out, v);
          break;
        }
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  const ranked = [...votes.entries()].sort((a, b) => b[1].n - a[1].n || a[1].d - b[1].d);
  if (!ranked.length) return null;
  if (ranked.length > 1 && ranked[0]![1].n === ranked[1]![1].n && ranked[0]![1].d === ranked[1]![1].d) return null;
  return ranked[0]![0];
}
const isOneLit = (e: ts.Expression) => ts.isStringLiteral(e) && e.text === "1";
const numberOf = (e: ts.Expression, name: string) => ts.isCallExpression(e) && ts.isIdentifier(e.expression) && e.expression.text === "Number" && e.arguments.length === 1 && isRead(e.arguments[0]!, name);

/** v2 `|| D` default: integer literal >= 1, an identifier, or a product of integer literals >= 1. */
function intDefault(e: ts.Expression): boolean {
  if (ts.isParenthesizedExpression(e)) return intDefault(e.expression);
  if (ts.isNumericLiteral(e)) return /^[1-9][\d_]*$/.test(e.getText()) ;
  if (ts.isIdentifier(e)) return e.text !== "undefined" && e.text !== "NaN" && e.text !== "Infinity";
  return ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.AsteriskToken && intDefault(e.left) && intDefault(e.right) && !ts.isIdentifier(e.left) && !ts.isIdentifier(e.right);
}

export function buildEnvFix(task: EnvFixTask, files: readonly { path: string; content: string }[], why?: { reason?: string }, wide = false, named = false): { path: string; content: string; extra: { path: string; content: string; create: true }[]; selfGrade: true } | null {
  const no = (r: string) => { if (why) why.reason = r; return null; };
  if (!plainPath(task.file) || !task.file.startsWith("src/") || /\.test\.ts$/.test(task.file)) return no("path_not_plain");
  if (isProtected(task.file)) return no("protected_path");
  const cur = files.find((f) => f.path === task.file);
  if (!cur) return no("target_missing");
  if (task.mode === "int" && (!Number.isSafeInteger(task.max) || task.max < 1)) return no("env_fix_bad_max");
  const helper = named ? task.helper ?? siblingHelperName(task.name, cur.content) ?? helperName(task.name) : helperName(task.name);
  if (!/^[a-z][A-Za-z0-9]{2,60}$/.test(helper) || RESERVED.has(helper)) return no("env_fix_bad_helper");
  if (new RegExp(`\\b${helper}\\b`).test(cur.content)) return no("env_fix_helper_taken");
  const sf = ts.createSourceFile("m.ts", cur.content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const reads: ts.Expression[] = [];
  const edits: { start: number; end: number; text: string }[] = [];
  const covered = new Set<ts.Node>();
  let def: string | null = null;
  const visit = (n: ts.Node): void => {
    if (isRead(n, task.name)) reads.push(n);
    if (task.mode === "flag" && ts.isBinaryExpression(n) && isRead(n.left, task.name) && isOneLit(n.right) && (n.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken || n.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsEqualsToken)) {
      const neg = n.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsEqualsToken;
      edits.push({ start: n.getStart(sf), end: n.getEnd(), text: `${neg ? "!" : ""}${helper}(${n.left.getText(sf)})` });
      covered.add(n.left);
    }
    if (task.mode === "int" && ts.isConditionalExpression(n) && ts.isBinaryExpression(n.condition) && n.condition.operatorToken.kind === ts.SyntaxKind.GreaterThanToken && numberOf(n.condition.left, task.name) && ts.isNumericLiteral(n.condition.right) && n.condition.right.text === "0" && numberOf(n.whenTrue, task.name) && (ts.isIdentifier(n.whenFalse) || (ts.isNumericLiteral(n.whenFalse) && /^\d+$/.test(n.whenFalse.text)))) {
      const read = (n.condition.left as ts.CallExpression).arguments[0]!;
      def = n.whenFalse.getText(sf);
      edits.push({ start: n.getStart(sf), end: n.getEnd(), text: `${helper}(${read.getText(sf)})` });
      covered.add(read);
      covered.add((n.whenTrue as ts.CallExpression).arguments[0]!);
    }
    if (wide && task.mode === "int") {
      // v2: Number(X ?? "N")
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "Number" && n.arguments.length === 1) {
        const a = n.arguments[0]!;
        if (ts.isBinaryExpression(a) && a.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken && isRead(a.left, task.name)) {
          covered.add(a.left);
          if (!(ts.isStringLiteral(a.right) || ts.isNoSubstitutionTemplateLiteral(a.right)) || !/^\d{1,15}$/.test(a.right.text) || Number(a.right.text) < 1) { badDefault = true; }
          else { def = String(Number(a.right.text)); edits.push({ start: n.getStart(sf), end: n.getEnd(), text: `${helper}(${a.left.getText(sf)})` }); }
        }
      }
      // v2: Number(X) || D
      if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.BarBarToken && numberOf(n.left, task.name)) {
        const read = (n.left as ts.CallExpression).arguments[0]!;
        covered.add(read);
        if (!intDefault(n.right)) badDefault = true;
        else { def = n.right.getText(sf); edits.push({ start: n.getStart(sf), end: n.getEnd(), text: `${helper}(${read.getText(sf)})` }); }
      }
    }
    ts.forEachChild(n, visit);
  };
  let badDefault = false;
  visit(sf);
  if (badDefault) return no("env_fix_bad_default");
  const d0 = def as string | null; // assigned inside the visitor closure
  if (wide && task.mode === "int" && d0 !== null && /^[\d_ *()]+$/.test(d0)) {
    const v = d0.replace(/[_ ()]/g, "").split("*").reduce((a: number, b: string) => a * Number(b), 1);
    if (!Number.isSafeInteger(v) || v < 1 || v > task.max) return no("env_fix_bad_default"); // literal default outside 1..MAX
  }
  if (!reads.length) return no("env_fix_read_not_found");
  if (!edits.length) return no("env_fix_mixed_reads");
  if (reads.some((r) => !covered.has(r)) || (task.mode === "int" && edits.length !== 1)) return no("env_fix_mixed_reads");
  let content = cur.content;
  for (const e of [...edits].sort((a, b) => b.start - a.start)) content = content.slice(0, e.start) + e.text + content.slice(e.end);
  const code = `${task.name}_INVALID`;
  const fn = task.mode === "flag"
    ? `\n/** ${task.name}: unset, "" or "0" -> false; "1" -> true; anything else throws (fail closed). */\nexport function ${helper}(value: string | undefined): boolean {\n  const s = value?.trim() ?? "";\n  if (s === "" || s === "0") return false;\n  if (s === "1") return true;\n  throw new Error(\`${code}:\${JSON.stringify(s.slice(0, 20))}\`);\n}\n`
    : `\n/** ${task.name}: blank -> the default; plain digits 1..${task.max} -> the number; anything else throws (fail closed). */\nexport function ${helper}(value: string | undefined): number {\n  const s = value?.trim() ?? "";\n  if (!s) return ${def};\n  if (!/^\\d{1,${String(task.max).length}}$/u.test(s) || Number(s) < 1 || Number(s) > ${task.max}) throw new Error(\`${code}:\${JSON.stringify(s.slice(0, 20))}\`);\n  return Number(s);\n}\n`;
  content = content.replace(/\n*$/, "\n") + fn;
  const base = task.file.replace(/^.*\//, "").replace(/\.ts$/, "");
  const dir = task.file.slice(0, task.file.lastIndexOf("/"));
  const testPath = `${dir}/${base}.${helper.toLowerCase()}-strict-env.test.ts`;
  if (files.some((f) => f.path === testPath)) return no("env_fix_test_exists");
  const bad = task.mode === "flag" ? ["true", "yes", "2", "on"] : ["Infinity", "1e3", "0x10", "0", "-1", "1.5", String(task.max + 1), "abc"];
  const good = task.mode === "flag"
    ? [`  assert.equal(${helper}(undefined), false);`, `  assert.equal(${helper}(""), false);`, `  assert.equal(${helper}("0"), false);`, `  assert.equal(${helper}("1"), true);`]
    : [`  assert.equal(${helper}(undefined), ${helper}(""));`, `  assert.equal(${helper}("1"), 1);`, `  assert.equal(${helper}("${task.max}"), ${task.max});`];
  const testText = [
    `import assert from "node:assert/strict";`,
    `import test from "node:test";`,
    `import { ${helper} } from "./${base}";`,
    ``,
    `test("${helper}: strict ${task.name}, fail closed", () => {`,
    ...good,
    `  for (const bad of ${JSON.stringify(bad)}) assert.throws(() => ${helper}(bad), /${code}/, bad);`,
    `});`,
    ``,
  ].join("\n");
  // Live proof #305: params.grading is self-fail-before-pass-after, so the edit is self-graded; without selfGrade
  // generate.ts silently dropped it (no candidate, no refusal reason).
  return { path: task.file, content, extra: [{ path: testPath, content: testText, create: true }], selfGrade: true };
}

const validParams = (params: Record<string, string | string[]>) => validEnvFixParams(params as Record<string, unknown>);
export function runEnvFixRule(trigger: string, params: Record<string, string | string[]>, objective: string, files: readonly { path: string; content: string }[], why?: { reason?: string }) {
  if (!validParams(params)) { if (why) why.reason = "bad_rule_params"; return null; }
  const task = parseEnvFixTask(trigger, objective);
  if (!task) { if (why) why.reason = "task_unparsed"; return null; }
  return buildEnvFix(task, files, why, params.int === "ternary-nullish-or", params.name === "task-or-sibling-convention");
}
export function applyEnvFixRule(trigger: string, params: Record<string, string | string[]>, objective: string, files: readonly { path: string; content: string }[], env: Record<string, string | undefined> = process.env, why?: { reason?: string }) {
  return envFixEnabled(env) ? runEnvFixRule(trigger, params, objective, files, why) : null;
}
