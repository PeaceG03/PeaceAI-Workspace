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
// #167 round 2: an ALLOW list of flags per tool (anything else is refused, so new code-loading flags never slip through).
// #167 round 3: a Map (no prototype lookups such as "__proto__", "constructor" or "toString"); mocha dropped
// (its spec files are code it loads, and positional paths cannot be confined to a test folder safely).
export const TOOL_FLAGS: ReadonlyMap<string, readonly string[]> = new Map<string, readonly string[]>([
  ["tsc", ["--noEmit", "-p", "--project", "--pretty", "--incremental"]],
  ["eslint", ["--fix", "--cache", "--quiet", "--max-warnings"]],
  ["prettier", ["--write", "--check", "--list-different"]],
  ["vitest", ["run", "--run", "--watch", "--coverage", "--passWithNoTests"]],
  ["jest", ["--watch", "--coverage", "--ci", "--passWithNoTests", "--runInBand"]],
]);
const POSITIONAL = /^(?!.*\.\.)[\w.*@-][\w./*@-]{0,119}$/; // relative path or glob: no leading "/", no "..", no shell syntax
const FLAG_VALUE = /^[\w.-]{1,40}$/;
/** null = the command is one allowed tool with allowed flags and relative paths/globs; else the reason. */
export function scriptCommandProblem(cmd: string): string | null {
  if (cmd.length > 300 || /\s{2,}|^\s|\s$/.test(cmd)) return "command not a short, single-spaced string";
  const run = /^npm run ([a-z][a-z0-9:-]{0,40})$/.exec(cmd);
  if (run) return null;
  const [tool, ...args] = cmd.split(" ");
  const allowed = TOOL_FLAGS.get(tool!);
  if (!allowed) return "command outside the allowed tools";
  for (const a of args) {
    if (a.startsWith("-")) {
      const [flag, value] = a.split(/=(.*)/s);
      if (!allowed.includes(flag!)) return `flag ${flag} is not allowed for ${tool}`;
      if (value !== undefined && !FLAG_VALUE.test(value)) return "flag value";
    } else if (allowed.includes(a)) continue; // subcommand such as `vitest run`
    else if (!POSITIONAL.test(a)) return "argument is not a relative path or glob";
  }
  return null;
}

/** Script names a workflow runs (`npm run x`, `pnpm run x`, `pnpm x`, `yarn x`, `npm test`/`npm start`). */
export function workflowScriptNames(workflows: readonly string[]): Set<string> {
  const out = new Set<string>();
  for (const w of workflows) for (const m of w.matchAll(/\b(?:npm|pnpm|yarn)\s+(?:run(?:-script)?\s+)?(?:-[\w-]+\s+)*([a-z][\w:.-]*)/g)) out.add(m[1]!);
  return out;
}

/** PACKAGE_SCRIPT v1: exactly one NEW non-lifecycle script added to package.json; nothing else differs.
 *  M1 (Auditor #167): existing scripts are never changed, and no script name a workflow runs may be added. */
export function packageScriptProblem(path: string, before: string, after: string, workflows: readonly string[] | undefined): string | null {
  if (path !== "package.json") return "only the root package.json";
  if (!Array.isArray(workflows) || workflows.length === 0) return "workflow list missing or empty (the target's workflows must be read first)";
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
  if (typeof cmd !== "string") return "command not a string";
  const why = scriptCommandProblem(cmd);
  if (why) return why;
  // Every other byte identical: the new file must be the old file with only that one value inserted or replaced.
  const ind = Number(before.match(/^\{\n( +)"/)?.[1]?.length ?? 2);
  if (JSON.stringify(a, null, ind) !== before.replace(/\n$/, "")) return "package.json is not in standard JSON formatting";
  const reb = JSON.stringify({ ...a, scripts: { ...(sa as object), [k]: cmd } }, null, ind) + (before.endsWith("\n") ? "\n" : "");
  if (reb !== after) return "formatting or key order changed";
  return null;
}
