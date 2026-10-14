// M32 (Auditor's six limits): MULTI_LINE_BODY v1. Replace the whole body of ONE existing top-level function in
// an editable, non-protected file. Everything else stays byte-identical. OFF unless PEACEAI_MULTIBODY=true.
// Spec: peaceai/spec/multibody-v1.md (sha256 pinned in peaceai/test/m32-multibody.test.ts).
import ts from "typescript";
import { assertionFailuresOnly, editablePath } from "./learned-body.ts";
import { PROTECTED_SELF } from "./selfchange.ts";
import { bodyGrammarProblem, moduleDataKeys } from "./learned-function.ts";

export const MULTIBODY_MAX_LINES = 20;
export const MULTIBODY_MAX_CHARS = 1600;
export const MULTIBODY_FLAG = "PEACEAI_MULTIBODY";
export const multiBodyEnabled = (env: Record<string, string | undefined>): boolean => env[MULTIBODY_FLAG] === "true";

const FORBIDDEN_NAMES = new Set(["fs", "net", "http", "https", "process", "child_process", "require", "eval", "Function", "globalThis", "global", "window", "Deno", "Bun", "fetch", "env", "WebAssembly", "Reflect", "Proxy", "constructor", "prototype", "__proto__"]);

interface Body { name: string; open: number; close: number }
function bodies(sf: ts.SourceFile): Body[] {
  const out: Body[] = [];
  for (const s of sf.statements) if (ts.isFunctionDeclaration(s) && s.name && s.body) out.push({ name: s.name.text, open: s.body.getStart(sf), close: s.body.getEnd() });
  return out;
}
const parse = (t: string) => ts.createSourceFile("m.ts", t, ts.ScriptTarget.Latest, true);
const imports = (sf: ts.SourceFile) => sf.statements.filter((s) => ts.isImportDeclaration(s) || ts.isImportEqualsDeclaration(s)).map((s) => s.getText(sf)).join("\n");
const hasSyntaxErrors = (sf: ts.SourceFile) => ((sf as unknown as { parseDiagnostics?: unknown[] }).parseDiagnostics ?? []).length > 0;

/** Limit 3: names, members, keys and string literals in the body; no dynamic import, with, debugger, meta-properties. */
export function bodyReachProblem(body: ts.Node): string | null {
  let p: string | null = null;
  const v = (n: ts.Node): void => {
    if (p) return;
    if (ts.isIdentifier(n) || ts.isPrivateIdentifier(n)) { if (FORBIDDEN_NAMES.has(n.text)) p = `names ${n.text}`; }
    else if ((ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) && FORBIDDEN_NAMES.has(n.text)) p = `string ${n.text}`;
    else if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword) p = "dynamic import";
    else if (ts.isMetaProperty(n)) p = "meta property";
    else if (ts.isWithStatement(n)) p = "with";
    else if (ts.isDebuggerStatement(n)) p = "debugger";
    ts.forEachChild(n, v);
  };
  v(body);
  return p;
}

/** Every reason the edit is outside limits 1-3; null = inside. */
export function multiBodyEditProblem(repo: string, path: string, before: string, after: string): string | null {
  if (!editablePath(repo, path)) return "path not editable";
  if (PROTECTED_SELF.some((p) => p.pattern.test(path))) return "protected path"; // a protected pattern, never editable
  const a = parse(before), b = parse(after);
  if (hasSyntaxErrors(b)) return "syntax error";
  if (imports(a) !== imports(b)) return "imports changed";
  const ba = bodies(a), bb = bodies(b);
  if (ba.length !== bb.length || ba.some((x, i) => x.name !== bb[i]!.name)) return "functions changed";
  const changed = ba.map((x, i) => [x, bb[i]!] as const).filter(([x, y]) => before.slice(x.open, x.close) !== after.slice(y.open, y.close));
  if (changed.length !== 1) return changed.length ? "more than one body changed" : "no body changed";
  const [x, y] = changed[0]!;
  if (before.slice(0, x.open) !== after.slice(0, y.open) || before.slice(x.close) !== after.slice(y.close)) return "text outside the body changed";
  const nb = after.slice(y.open, y.close);
  if (nb.split("\n").length - 2 > MULTIBODY_MAX_LINES || nb.length > MULTIBODY_MAX_CHARS) return "body too long";
  const fn = b.statements.find((s) => ts.isFunctionDeclaration(s) && s.name?.text === y.name) as ts.FunctionDeclaration;
  if (fn.asteriskToken) return "generator";
  // Auditor #141 (limit 3): the #129 ALLOW-list grammar (kinds, globals, property names, string folding, numeric-only
  // computed keys, same-module callees checked recursively); the deny-list below stays as a second, independent net.
  return bodyGrammarProblem(after, y.name, new Set(), moduleDataKeys(before)) ?? bodyReachProblem(fn.body!);
}

/** Replaces `fn`'s body (inside the braces) with `inner`; null when there is no such single top-level function. */
export function applyMultiBody(content: string, fn: string, inner: string): string | null {
  const bs = bodies(parse(content)).filter((x) => x.name === fn);
  if (bs.length !== 1) return null;
  return content.slice(0, bs[0]!.open + 1) + inner + content.slice(bs[0]!.close - 1);
}

/** Limit 4 (Auditor #141): when wired, BOTH runs must come from runGradedTests under the #129 confinement.
 *  Credited only when the edit passes and the unedited code fails with assertion failures only. */
export function multiBodyCredited(withEdit: { ok: boolean }, withoutEdit: { ok: boolean; tap: string }): boolean {
  return withEdit.ok && !withoutEdit.ok && assertionFailuresOnly(withoutEdit.tap);
}
