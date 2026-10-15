// M57 proposal (OFF until approved): PACKAGE_SCRIPT v2, a NEW kind beside PACKAGE_SCRIPT v1 (v1 is unchanged).
// Spec: peaceai/spec/package-script-v2.md. Not wired into learned.ts RULE_KINDS, not in approved.json; OFF unless
// PEACEAI_PACKAGE_SCRIPT_V2 is exactly "true". Builder never approves.
// v2 widens v1 in two mechanical ways, still adding ONE new script with every other byte identical:
//  - position: the new script may be inserted at any position of "scripts" (v1: only appended last);
//  - commands: besides v1's commands, a package-manager alias of an EXISTING script (`pnpm run x`, `yarn run x`,
//    `pnpm x`, `yarn x`), a v1 tool run through the local package manager (`pnpm vitest run`, `yarn jest --ci`,
//    `pnpm exec tsc --noEmit`) when that tool is a declared dependency, and `run-s`/`run-p` of existing scripts when
//    npm-run-all is a declared dependency. No network, install, dlx/npx, node/tsx, shell chaining or quoting.
import { scriptCommandProblem, TOOL_FLAGS, workflowScriptNames } from "./learned-config.ts";

export const PACKAGE_SCRIPT_V2_FLAG = "PEACEAI_PACKAGE_SCRIPT_V2";
export const packageScriptV2Enabled = (env: Record<string, string | undefined>): boolean => env[PACKAGE_SCRIPT_V2_FLAG] === "true";

const LIFECYCLE = /^(install|uninstall|prepare|prepublish|prepublishOnly|prepack|postpack|publish|shrinkwrap|restart|start|stop|test|version|dependencies)$/;
const SCRIPT_NAME = /^[a-z][a-z0-9:-]{0,40}$/;
// Package-manager built-in commands: never accepted as an alias target, so `pnpm <x>` can only mean a script or a tool.
const PM_BUILTINS = new Set(["add", "audit", "bin", "cache", "config", "create", "dedupe", "deploy", "dlx", "env", "exec", "fetch", "i", "import", "info", "init", "install", "install-test", "it", "link", "list", "ln", "ls", "outdated", "pack", "patch", "patch-commit", "prune", "publish", "rebuild", "remove", "rm", "root", "run", "server", "setup", "store", "un", "uninstall", "unlink", "up", "update", "upgrade", "why", "workspace", "workspaces", "global", "dlx", "self-update", "npm", "node", "plugin", "set", "policies", "constraints", "version", "versions", "login", "logout", "owner", "tag", "team", "unplug", "stage", "explain", "search", "test", "start", "restart", "stop"]);
const hasOwn = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

type Pkg = Record<string, unknown> & { scripts?: Record<string, unknown>; dependencies?: Record<string, unknown>; devDependencies?: Record<string, unknown> };
const declared = (p: Pkg, name: string) => [p.dependencies, p.devDependencies].some((d) => !!d && typeof d === "object" && hasOwn(d, name));

/** v2 command rule; `scripts` are the EXISTING scripts (before the edit). null = allowed. */
export function v2CommandProblem(cmd: string, pkg: Pkg, scripts: Record<string, unknown>): string | null {
  if (scriptCommandProblem(cmd) === null) return null;
  if (cmd.length > 300 || /\s{2,}|^\s|\s$/.test(cmd)) return "command not a short, single-spaced string";
  if (/[;&|<>`$"'\\(){}\n]/.test(cmd)) return "shell syntax";
  const w = cmd.split(" ");
  const isScript = (n: string) => SCRIPT_NAME.test(n) && hasOwn(scripts, n) && !PM_BUILTINS.has(n) && !TOOL_FLAGS.has(n);
  if (w[0] === "pnpm" || w[0] === "yarn") {
    if (w.length === 3 && w[1] === "run") return isScript(w[2]!) ? null : "alias target is not an existing script";
    const rest = w[1] === "exec" && w[0] === "pnpm" ? w.slice(2) : w.slice(1);
    if (rest.length === 1 && w[1] !== "exec" && isScript(rest[0]!)) return null;
    const tool = rest[0];
    if (!tool || !TOOL_FLAGS.has(tool)) return "command outside the allowed tools";
    if (hasOwn(scripts, tool)) return "tool name shadowed by a script";
    if (!declared(pkg, tool)) return "tool is not a declared dependency";
    return scriptCommandProblem(rest.join(" "));
  }
  if (w[0] === "run-s" || w[0] === "run-p") {
    if (!declared(pkg, "npm-run-all") && !declared(pkg, "npm-run-all2")) return "npm-run-all is not a declared dependency";
    if (w.length < 2 || w.length > 9) return "run-s/run-p needs 1 to 8 script names";
    for (const n of w.slice(1)) if (!isScript(n)) return `not an existing script: ${n}`;
    return null;
  }
  return "command outside the allowed tools";
}

/** PACKAGE_SCRIPT v2: exactly one new script, inserted anywhere in "scripts"; every other byte identical. */
export function packageScriptV2Problem(path: string, before: string, after: string, workflows: readonly string[] | undefined): string | null {
  if (path !== "package.json") return "only the root package.json";
  if (!Array.isArray(workflows) || workflows.length === 0) return "workflow list missing or empty (the target's workflows must be read first)";
  let a: Pkg, b: Pkg;
  try { a = JSON.parse(before); b = JSON.parse(after); } catch { return "not JSON"; }
  if (!a || typeof a !== "object" || Array.isArray(a) || !b || typeof b !== "object" || Array.isArray(b)) return "not an object";
  const { scripts: sa = {}, ...ra } = a; const { scripts: sb = {}, ...rb } = b;
  if (JSON.stringify(ra) !== JSON.stringify(rb)) return "something other than scripts changed";
  for (const s of [sa, sb]) if (typeof s !== "object" || s === null || Array.isArray(s)) return "scripts is not an object";
  const ka = Object.keys(sa), kb = Object.keys(sb);
  if (kb.length !== ka.length + 1) return kb.length > ka.length ? "more than one script added" : "no script added";
  const k = kb.find((x) => !hasOwn(sa, x));
  if (k === undefined) return "no script added";
  if (JSON.stringify(kb.filter((x) => x !== k)) !== JSON.stringify(ka)) return "existing scripts reordered";
  for (const x of ka) if (sa[x] !== sb[x]) return "changes an existing script (only new scripts may be added)";
  if (!SCRIPT_NAME.test(k)) return "script name";
  if (LIFECYCLE.test(k)) return "lifecycle script";
  const hooked = /^(?:pre|post)(.+)$/.exec(k)?.[1];
  if (hooked !== undefined && (LIFECYCLE.test(hooked) || hasOwn(sa, hooked))) return "lifecycle script";
  if (PM_BUILTINS.has(k) || TOOL_FLAGS.has(k)) return "script name shadows a package-manager command or tool";
  if (workflowScriptNames(workflows).has(k)) return "a workflow runs this script name";
  const cmd = sb[k];
  if (typeof cmd !== "string") return "command not a string";
  const why = v2CommandProblem(cmd, a, sa);
  if (why) return why;
  const ind = Number(before.match(/^\{\n( +)"/)?.[1]?.length ?? 2);
  if (JSON.stringify(a, null, ind) !== before.replace(/\n$/, "")) return "package.json is not in standard JSON formatting";
  const ns: Record<string, unknown> = {};
  kb.forEach((x) => { ns[x] = x === k ? cmd : sa[x]; });
  const reb = JSON.stringify({ ...a, scripts: ns }, null, ind) + (before.endsWith("\n") ? "\n" : "");
  if (reb !== after) return "formatting or key order changed";
  return null;
}
