// M45 proposal (OFF until approved): two edit kinds mined from licensed external commits (#148 ext-corpus repos,
// set C excluded, LICENSE blob equal to the pinned one): IMPORT_EDIT v1 and PACKAGE_SCRIPT v1.
// Specs: peaceai/spec/import-edit-v1.md, peaceai/spec/package-script-v1.md. Not wired into learned.ts RULE_KINDS
// and not in approved.json; each kind is OFF unless its flag is exactly "true". Builder never approves.
import ts from "typescript";
import { posix } from "node:path";
import { PROTECTED_SELF } from "./selfchange.ts";

export const IMPORT_EDIT_FLAG = "PEACEAI_IMPORT_EDIT";
export const PACKAGE_SCRIPT_FLAG = "PEACEAI_PACKAGE_SCRIPT";
export const importEditEnabled = (env: Record<string, string | undefined>): boolean => env[IMPORT_EDIT_FLAG] === "true";
export const packageScriptEnabled = (env: Record<string, string | undefined>): boolean => env[PACKAGE_SCRIPT_FLAG] === "true";

const isProtected = (path: string) => PROTECTED_SELF.some((p) => p.pattern.test(path));
const plainPath = (p: string) => !p.startsWith("/") && !p.split("/").some((s) => s === "" || s === "." || s === "..");

interface Imp { text: string; spec: string; clause: string }
function topImports(text: string): { imps: Imp[]; rest: string; bad: boolean } {
  const sf = ts.createSourceFile("m.ts", text, ts.ScriptTarget.Latest, true);
  const bad = ((sf as unknown as { parseDiagnostics?: unknown[] }).parseDiagnostics ?? []).length > 0;
  const imps: Imp[] = []; let rest = ""; let last = 0;
  for (const s of sf.statements) {
    if (!ts.isImportDeclaration(s) || !ts.isStringLiteral(s.moduleSpecifier)) continue;
    rest += text.slice(last, s.getStart(sf)); last = s.getEnd();
    imps.push({ text: s.getText(sf), spec: s.moduleSpecifier.text, clause: s.importClause ? s.importClause.getText(sf) : "" });
  }
  return { imps, rest: rest + text.slice(last), bad };
}
// A relative specifier, or an extension-only change of one; bare package names may not be introduced or swapped.
const RELATIVE = /^\.{1,2}\/[\w./-]{1,200}$/;
const stem = (s: string) => s.replace(/\.(ts|tsx|js|mjs|cjs)$/, "");

export const IMPORT_MAX_UP = 3;
const RESOLVE_EXT = ["", ".ts", ".tsx", ".mts", "/index.ts"];
/** L4 (Auditor #167): the new specifier, resolved from the file's own folder, stays inside the repo (at most
 *  IMPORT_MAX_UP leading ../), names an existing file and is not protected. null = resolves. */
export function importResolveProblem(path: string, spec: string, repoFiles: ReadonlySet<string>): string | null {
  const up = /^(?:\.\.\/)*/.exec(spec.replace(/^\.\//, ""))![0].length / 3;
  if (up > IMPORT_MAX_UP) return "specifier climbs too far";
  const joined = posix.normalize(posix.join(posix.dirname(path), spec));
  if (joined.startsWith("../") || joined === ".." || joined.startsWith("/")) return "specifier leaves the repo";
  const bases = [joined, joined.replace(/\.(js|mjs|cjs)$/, "")];
  const hit = bases.flatMap((b) => RESOLVE_EXT.map((e) => b + e)).find((c) => repoFiles.has(c));
  if (!hit) return "specifier does not resolve to a repo file";
  if (isProtected(hit)) return "specifier resolves to a protected file";
  return null;
}

/** IMPORT_EDIT v1: exactly one existing import's specifier changes; every other byte is identical. null = inside. */
export function importEditProblem(path: string, before: string, after: string, repoFiles: ReadonlySet<string>): string | null {
  if (!plainPath(path) || !/\.(ts|mts)$/.test(path) || path.endsWith(".d.ts")) return "not a plain .ts path";
  if (isProtected(path)) return "protected path";
  const a = topImports(before), b = topImports(after);
  if (a.bad || b.bad) return "syntax error";
  if (a.rest !== b.rest) return "text outside the imports changed";
  if (a.imps.length !== b.imps.length) return "imports added or removed";
  const ch = a.imps.map((x, i) => [x, b.imps[i]!] as const).filter(([x, y]) => x.text !== y.text);
  if (ch.length !== 1) return ch.length ? "more than one import changed" : "no import changed";
  const [x, y] = ch[0]!;
  if (x.clause !== y.clause) return "imported names changed";
  if (x.text.replace(JSON.stringify(x.spec).slice(1, -1), "\0") !== y.text.replace(JSON.stringify(y.spec).slice(1, -1), "\0")) return "more than the specifier changed";
  if (!RELATIVE.test(x.spec) || !RELATIVE.test(y.spec)) return "only relative specifiers may change";
  if (stem(x.spec) !== stem(y.spec) && x.spec.split("/").pop() !== y.spec.split("/").pop()) return "specifier must keep its module (extension or directory move only)";
  return importResolveProblem(path, y.spec, repoFiles);
}

const LIFECYCLE = /^(install|uninstall|prepare|prepublish|prepublishOnly|prepack|postpack|publish|shrinkwrap|restart|start|stop|test|version|dependencies)$/;
const SCRIPT_NAME = /^[a-z][a-z0-9:-]{0,40}$/;
// The command: one tool from node_modules/.bin (or npm run <script>), flags and relative paths; no shell syntax.
const COMMAND = /^(?:tsc|eslint|prettier|vitest|jest|mocha|rollup|vite|npm run [a-z][a-z0-9:-]{0,40})(?: (?:--?[A-Za-z][\w-]{0,30}(?:=[\w./:@-]{1,80})?|[\w./*@-]{1,120}))*$/;
// M2 (Auditor #167): no code-loading flags, tool configs or plugins, and no absolute paths.
const BANNED_ARG = /^(?:--?(?:require|r|config|c|loader|import|experimental-loader|plugin|rulesdir|resolve-plugins-relative-to|configLoader|setupFiles|setupFilesAfterEach|globalSetup|transform|preset|environment|reporter|resolver|testRunner|watchPlugins)(?:=|$)|\/)|(?:jest|vitest|vite|rollup|eslint|prettier|mocha)\.config|\.(?:eslintrc|mocharc|prettierrc)|^-[A-Za-z]*[rc][A-Za-z]*$/;
const BANNED = /curl|wget|\bsh\b|bash|\bnode\b|npx|eval|\$|`|;|&|\||>|<|\\|\.\.\//;

/** Script names a workflow runs (`npm run x`, `pnpm run x`, `pnpm x`, `yarn x`, `npm test`/`npm start`). */
export function workflowScriptNames(workflows: readonly string[]): Set<string> {
  const out = new Set<string>();
  for (const w of workflows) for (const m of w.matchAll(/\b(?:npm|pnpm|yarn)\s+(?:run(?:-script)?\s+)?(?:-[\w-]+\s+)*([a-z][\w:.-]*)/g)) out.add(m[1]!);
  return out;
}

/** PACKAGE_SCRIPT v1: exactly one NEW non-lifecycle script added to package.json; nothing else differs.
 *  M1 (Auditor #167): existing scripts are never changed, and no script name a workflow runs may be added. */
export function packageScriptProblem(path: string, before: string, after: string, workflows: readonly string[]): string | null {
  if (path !== "package.json") return "only the root package.json";
  let a: Record<string, unknown>, b: Record<string, unknown>;
  try { a = JSON.parse(before); b = JSON.parse(after); } catch { return "not JSON"; }
  const { scripts: sa = {}, ...ra } = a as { scripts?: Record<string, unknown> };
  const { scripts: sb = {}, ...rb } = b as { scripts?: Record<string, unknown> };
  if (JSON.stringify(ra) !== JSON.stringify(rb)) return "something other than scripts changed";
  if (typeof sb !== "object" || sb === null || Array.isArray(sb)) return "scripts is not an object";
  const keys = [...new Set([...Object.keys(sa), ...Object.keys(sb)])].filter((k) => (sa as Record<string, unknown>)[k] !== (sb as Record<string, unknown>)[k]);
  if (keys.length !== 1) return keys.length ? "more than one script changed" : "no script changed";
  const k = keys[0]!; const cmd = (sb as Record<string, unknown>)[k];
  if (!(k in sb)) return "removes a script";
  if (k in (sa as object)) return "changes an existing script (only new scripts may be added)";
  if (workflowScriptNames(workflows).has(k)) return "a workflow runs this script name";
  if (!SCRIPT_NAME.test(k)) return "script name";
  if (LIFECYCLE.test(k)) return "lifecycle script";
  // npm runs pre<x>/post<x> around script x: refuse a hook for any script or lifecycle event.
  const hooked = /^(?:pre|post)(.+)$/.exec(k)?.[1];
  if (hooked !== undefined && (LIFECYCLE.test(hooked) || hooked in (sa as object) || hooked in (sb as object))) return "lifecycle script";
  if (typeof cmd !== "string" || cmd.length > 300) return "command not a short string";
  if (BANNED.test(cmd)) return "command uses shell syntax, a network tool or node directly";
  if (!COMMAND.test(cmd)) return "command outside the allowed tools";
  if (cmd.split(" ").slice(1).some((a) => BANNED_ARG.test(a))) return "code-loading flag, tool config, plugin or absolute path";
  // Every other byte identical: the new file must be the old file with only that one value inserted or replaced.
  const ind = Number(before.match(/^\{\n( +)"/)?.[1]?.length ?? 2);
  if (JSON.stringify(a, null, ind) !== before.replace(/\n$/, "")) return "package.json is not in standard JSON formatting";
  const reb = JSON.stringify({ ...a, scripts: { ...(sa as object), [k]: cmd } }, null, ind) + (before.endsWith("\n") ? "\n" : "");
  if (reb !== after) return "formatting or key order changed";
  return null;
}
