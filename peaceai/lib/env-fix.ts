// M67 ENV_FIX (public-env-fix-v1, un-drop batch; Architect-approved redefinition: a code edit that makes ONE
// environment-variable read strict and fail-closed). Two fixed shapes, chosen by the task:
//   flag  every read of X (process.env.NAME, env.NAME, or the ["NAME"] forms) in the file is `X === "1"` or `X !== "1"`; each becomes
//         `strictNAME(X)` / `!strictNAME(X)`, with an appended helper: unset/""/"0" -> false, "1" -> true, else throws
//         NAME_INVALID.
//   int   the one read of X is `Number(X) > 0 ? Number(X) : DEFAULT` (DEFAULT an identifier or integer literal);
//         it becomes `strictNAME(X)`, with an appended helper: blank -> DEFAULT, plain digits 1..MAX -> the number,
//         else throws NAME_INVALID.
// Plus ONE new test file with the value table (blank, 0/1 or in-range, and the fail-closed values).
// Refused (short codes): env_fix_read_not_found, env_fix_mixed_reads (any other read of X in the file),
// env_fix_helper_taken, env_fix_bad_max, path_not_plain, protected_path, target_missing, env_fix_test_exists.
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
const ENVNAME = String.raw`[A-Z][A-Z0-9_]{1,60}`;
const FILE = String.raw`[\w./-]+\.ts`;
/** make env NAME strict in src/FILE.ts as a flag | as an integer 1..MAX */
export const ENV_FIX_TRIGGER = String.raw`^make (?:the )?env(?:ironment variable)? \x60?(?<name>${ENVNAME})\x60? strict in \x60?(?<file>${FILE})\x60? as (?:a |an )?(?:(?<flag>flag)|integer 1\.\.(?<max>\d{1,9}))\.?$`;
export interface EnvFixTask { name: string; file: string; mode: "flag" | "int"; max: number }
const plainPath = (p: string) => !p.startsWith("/") && !p.split("/").some((x) => x === "" || x === "." || x === ".." || x.startsWith("."));
const isProtected = (p: string) => PROTECTED_SELF.some((x) => x.pattern.test(p));

export function parseEnvFixTask(trigger: string, objective: string): EnvFixTask | null {
  const re = new RegExp(trigger, "i");
  const heads = objective.split("\n").map((l) => l.trim()).filter((l) => re.test(l));
  if (heads.length !== 1) return null;
  const g = re.exec(heads[0]!)!.groups ?? {};
  if (!g.name || !g.file) return null;
  return g.flag ? { name: g.name, file: g.file, mode: "flag", max: 0 } : { name: g.name, file: g.file, mode: "int", max: Number(g.max) };
}

export const helperName = (name: string) => "strict" + name.toLowerCase().split("_").filter(Boolean).map((w) => w[0]!.toUpperCase() + w.slice(1)).join("");
const isEnvObj = (e: ts.Expression) => (ts.isPropertyAccessExpression(e) && ts.isIdentifier(e.expression) && e.expression.text === "process" && e.name.text === "env") || (ts.isIdentifier(e) && e.text === "env");
/** A read of NAME: process.env.NAME / env.NAME, or (Auditor #266) process.env["NAME"] / env["NAME"]. */
const isRead = (n: ts.Node, name: string): n is ts.PropertyAccessExpression | ts.ElementAccessExpression =>
  (ts.isPropertyAccessExpression(n) && n.name.text === name && isEnvObj(n.expression)) ||
  (ts.isElementAccessExpression(n) && (ts.isStringLiteral(n.argumentExpression) || ts.isNoSubstitutionTemplateLiteral(n.argumentExpression)) && n.argumentExpression.text === name && isEnvObj(n.expression));
const isOneLit = (e: ts.Expression) => ts.isStringLiteral(e) && e.text === "1";
const numberOf = (e: ts.Expression, name: string) => ts.isCallExpression(e) && ts.isIdentifier(e.expression) && e.expression.text === "Number" && e.arguments.length === 1 && isRead(e.arguments[0]!, name);

export function buildEnvFix(task: EnvFixTask, files: readonly { path: string; content: string }[], why?: { reason?: string }): { path: string; content: string; extra: { path: string; content: string; create: true }[]; selfGrade: true } | null {
  const no = (r: string) => { if (why) why.reason = r; return null; };
  if (!plainPath(task.file) || !task.file.startsWith("src/") || /\.test\.ts$/.test(task.file)) return no("path_not_plain");
  if (isProtected(task.file)) return no("protected_path");
  const cur = files.find((f) => f.path === task.file);
  if (!cur) return no("target_missing");
  if (task.mode === "int" && (!Number.isSafeInteger(task.max) || task.max < 1)) return no("env_fix_bad_max");
  const helper = helperName(task.name);
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
    ts.forEachChild(n, visit);
  };
  visit(sf);
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

const validParams = (params: Record<string, string | string[]>) => ENV_FIX_PARAM_KEYS.every((k) => typeof params[k] === "string" && ENV_FIX_VOCAB[k].includes(params[k] as string));
export function runEnvFixRule(trigger: string, params: Record<string, string | string[]>, objective: string, files: readonly { path: string; content: string }[], why?: { reason?: string }) {
  if (!validParams(params)) { if (why) why.reason = "bad_rule_params"; return null; }
  const task = parseEnvFixTask(trigger, objective);
  if (!task) { if (why) why.reason = "task_unparsed"; return null; }
  return buildEnvFix(task, files, why);
}
export function applyEnvFixRule(trigger: string, params: Record<string, string | string[]>, objective: string, files: readonly { path: string; content: string }[], env: Record<string, string | undefined> = process.env, why?: { reason?: string }) {
  return envFixEnabled(env) ? runEnvFixRule(trigger, params, objective, files, why) : null;
}
