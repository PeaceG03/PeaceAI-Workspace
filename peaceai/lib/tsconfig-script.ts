// M67 TSCONFIG_SCRIPT (public-tsconfig-script-v1, un-drop batch). One task adds BOTH:
//   - a NEW tsconfig.NAME.json at the repo root that extends ./tsconfig.json, in one of three fixed shapes:
//       exclude  {"extends": "./tsconfig.json", "include": <the base include, copied>, "exclude": [GLOB]}
//       files    {"extends": "./tsconfig.json", "include": [], "files": [FILE]}            (FILE must exist)
//       checkjs  {"extends": "./tsconfig.json", "compilerOptions": {"allowJs": true, "checkJs": true}, "include": [GLOB]}
//   - ONE package.json script line `"typecheck:NAME": "tsc -p tsconfig.NAME.json --noEmit",` inserted right after an
//     existing `"typecheck"` script line that already ends with a comma (a pure one-line insertion).
// Nothing else: no outDir/emit/paths/plugins, no other compilerOptions, no edits to an existing tsconfig.
// Refusals (short codes): tsconfig_script_exists, tsconfig_script_name_taken, tsconfig_script_no_base,
// tsconfig_script_no_anchor, tsconfig_script_bad_pattern, tsconfig_script_file_missing, tsconfig_script_pkg_unparsed.
// scope.ts accepts such a candidate only on a target that opts in (targets.json `tsconfigScript: true`) and re-checks
// both files (tsconfigScriptCandidateReason). Graded by the target's own checks plus the new script (live proof).
import { safeScript } from "./learned-workflow.ts";

export const TSCONFIG_SCRIPT_FLAG = "PEACEAI_TSCONFIG_SCRIPT";
export const tsconfigScriptEnabled = (env: Record<string, string | undefined>): boolean => env[TSCONFIG_SCRIPT_FLAG] === "true";
export const TSCONFIG_SCRIPT_PARAM_KEYS = ["extends", "grading", "script"] as const;
export const TSCONFIG_SCRIPT_VOCAB: Record<(typeof TSCONFIG_SCRIPT_PARAM_KEYS)[number], readonly string[]> = {
  extends: ["root-tsconfig"],
  grading: ["target-suite"],
  script: ["tsc-project-noemit"],
};
const NAME = String.raw`[a-z][a-z0-9-]{0,20}`;
const GLOB = String.raw`[A-Za-z0-9_*./-]{1,80}`;
/** add typecheck script typecheck:NAME with new tsconfig.NAME.json (excluding GLOB | checking only FILE | checking GLOB with checkJs) */
export const TSCONFIG_SCRIPT_TRIGGER = String.raw`^add (?:a )?typecheck script \x60?typecheck:(?<name>${NAME})\x60? with (?:a )?new \x60?tsconfig\.(?<name2>${NAME})\.json\x60? (?:(?<mode1>excluding) \x60?(?<glob1>${GLOB})\x60?|(?<mode2>checking only) \x60?(?<file>${GLOB})\x60?|checking \x60?(?<glob3>${GLOB})\x60? (?<mode3>with checkJs))\.?$`;
export type TsMode = "exclude" | "files" | "checkjs";
export interface TsconfigScriptTask { name: string; mode: TsMode; pattern: string }

export function parseTsconfigScriptTask(trigger: string, objective: string): TsconfigScriptTask | null {
  const re = new RegExp(trigger, "i");
  const heads = objective.split("\n").map((l) => l.trim()).filter((l) => re.test(l));
  if (heads.length !== 1) return null;
  const g = re.exec(heads[0]!)!.groups ?? {};
  if (!g.name || g.name !== g.name2) return null;
  if (g.mode1) return { name: g.name, mode: "exclude", pattern: g.glob1! };
  if (g.mode2) return { name: g.name, mode: "files", pattern: g.file! };
  if (g.mode3) return { name: g.name, mode: "checkjs", pattern: g.glob3! };
  return null;
}

const plainPattern = (p: string) => !p.startsWith("/") && !p.split("/").some((x) => x === "" || x === "." || x === ".." || x.startsWith("."));
export const tsconfigPath = (name: string) => `tsconfig.${name}.json`;
export const scriptLine = (indent: string, name: string) => `${indent}"typecheck:${name}": "tsc -p ${tsconfigPath(name)} --noEmit",`;

/** The exact text of the new tsconfig for a task (null with a code when the pattern is not allowed). */
export function tsconfigText(mode: TsMode, pattern: string, baseInclude: readonly string[] | null): string | { code: string } {
  if (!plainPattern(pattern)) return { code: "tsconfig_script_bad_pattern" };
  let o: Record<string, unknown>;
  if (mode === "exclude") {
    if (!baseInclude || !baseInclude.length || !baseInclude.every((x) => typeof x === "string" && plainPattern(x))) return { code: "tsconfig_script_no_base" };
    if (!/\.ts$/.test(pattern)) return { code: "tsconfig_script_bad_pattern" };
    o = { extends: "./tsconfig.json", include: [...baseInclude], exclude: [pattern] };
  } else if (mode === "files") {
    if (/\*/.test(pattern) || !/\.(?:ts|mts)$/.test(pattern)) return { code: "tsconfig_script_bad_pattern" };
    o = { extends: "./tsconfig.json", include: [], files: [pattern] };
  } else {
    if (!/\.(?:mjs|js)$/.test(pattern)) return { code: "tsconfig_script_bad_pattern" };
    o = { extends: "./tsconfig.json", compilerOptions: { allowJs: true, checkJs: true }, include: [pattern] };
  }
  return JSON.stringify(o, null, 2) + "\n";
}

/** Re-check of a new tsconfig's full text (scope.ts): one of the three shapes exactly, nothing else. */
export function tsconfigTextProblem(text: string): string | null {
  let o: Record<string, unknown>;
  try { o = JSON.parse(text) as Record<string, unknown>; } catch { return "tsconfig does not parse"; }
  const keys = Object.keys(o).join(",");
  if (o.extends !== "./tsconfig.json") return "must extend ./tsconfig.json";
  const strs = (v: unknown) => Array.isArray(v) && v.every((x) => typeof x === "string" && plainPattern(x));
  if (keys === "extends,include,exclude" && strs(o.include) && strs(o.exclude) && (o.exclude as string[]).length === 1) return null;
  if (keys === "extends,include,files" && strs(o.include) && (o.include as string[]).length === 0 && strs(o.files) && (o.files as string[]).length === 1) return null;
  if (keys === "extends,compilerOptions,include" && JSON.stringify(o.compilerOptions) === '{"allowJs":true,"checkJs":true}' && strs(o.include) && (o.include as string[]).length === 1) return null;
  return "tsconfig is not one of the three allowed shapes";
}

export function buildTsconfigScript(task: TsconfigScriptTask, files: readonly { path: string; content: string }[], why?: { reason?: string }): { path: string; content: string; extra: { path: string; content: string; create: true }[] } | null {
  const no = (r: string) => { if (why) why.reason = r; return null; };
  const target = tsconfigPath(task.name);
  if (files.some((f) => f.path === target)) return no("tsconfig_script_exists");
  const base = files.find((f) => f.path === "tsconfig.json");
  if (!base) return no("tsconfig_script_no_base");
  let baseInclude: string[] | null = null;
  try { const b = JSON.parse(base.content) as { include?: unknown }; baseInclude = Array.isArray(b.include) ? (b.include as string[]) : null; } catch { return no("tsconfig_script_no_base"); }
  if (task.mode === "files" && !files.some((f) => f.path === task.pattern)) return no("tsconfig_script_file_missing");
  const text = tsconfigText(task.mode, task.pattern, baseInclude);
  if (typeof text !== "string") return no(text.code);
  const pkg = files.find((f) => f.path === "package.json");
  if (!pkg) return no("tsconfig_script_pkg_unparsed");
  let scripts: Record<string, unknown>;
  try { scripts = (JSON.parse(pkg.content) as { scripts?: Record<string, unknown> }).scripts ?? {}; } catch { return no("tsconfig_script_pkg_unparsed"); }
  if (Object.prototype.hasOwnProperty.call(scripts, `typecheck:${task.name}`)) return no("tsconfig_script_name_taken");
  const lines = pkg.content.split("\n");
  const anchors = lines.map((l, i) => (/^(\s+)"typecheck": "[^"\n]*",$/.test(l) ? i : -1)).filter((i) => i >= 0);
  if (anchors.length !== 1) return no("tsconfig_script_no_anchor");
  const at = anchors[0]!;
  const indent = /^(\s+)/.exec(lines[at]!)![1]!;
  const line = scriptLine(indent, task.name);
  if (!safeScript(`tsc -p ${target} --noEmit`)) return no("tsconfig_script_bad_pattern");
  const content = [...lines.slice(0, at + 1), line, ...lines.slice(at + 1)].join("\n");
  try { JSON.parse(content); } catch { return no("tsconfig_script_pkg_unparsed"); }
  return { path: "package.json", content, extra: [{ path: target, content: text, create: true }] };
}

/**
 * scope.ts re-check for a TSCONFIG_SCRIPT candidate: exactly package.json (one added `typecheck:NAME` line, nothing
 * removed) plus one NEW root tsconfig.NAME.json whose text passes tsconfigTextProblem and NAME matches. Null when ok.
 */
export function tsconfigScriptCandidateReason(files: readonly { path: string; isNew: boolean; addedLines: readonly string[]; removedLines: readonly string[] }[]): string | null {
  if (files.length !== 2) return "must be package.json plus one new tsconfig";
  const pkg = files.find((f) => f.path === "package.json");
  const ts = files.find((f) => /^tsconfig\.[a-z][a-z0-9-]{0,20}\.json$/.test(f.path));
  if (!pkg || !ts || pkg.isNew || !ts.isNew) return "must be package.json plus one new tsconfig";
  const name = /^tsconfig\.(.+)\.json$/.exec(ts.path)![1]!;
  if (pkg.removedLines.length || pkg.addedLines.length !== 1) return "package.json must gain exactly one line";
  if (!new RegExp(`^\\s+"typecheck:${name}": "tsc -p tsconfig\\.${name}\\.json --noEmit",$`).test(pkg.addedLines[0]!)) return "package.json line is not the typecheck script";
  return tsconfigTextProblem(ts.addedLines.join("\n"));
}

const validParams = (params: Record<string, string | string[]>) => TSCONFIG_SCRIPT_PARAM_KEYS.every((k) => typeof params[k] === "string" && TSCONFIG_SCRIPT_VOCAB[k].includes(params[k] as string));
export function runTsconfigScriptRule(trigger: string, params: Record<string, string | string[]>, objective: string, files: readonly { path: string; content: string }[], why?: { reason?: string }) {
  if (!validParams(params)) { if (why) why.reason = "bad_rule_params"; return null; }
  const task = parseTsconfigScriptTask(trigger, objective);
  if (!task) { if (why) why.reason = "task_unparsed"; return null; }
  return buildTsconfigScript(task, files, why);
}
export function applyTsconfigScriptRule(trigger: string, params: Record<string, string | string[]>, objective: string, files: readonly { path: string; content: string }[], env: Record<string, string | undefined> = process.env, why?: { reason?: string }) {
  return tsconfigScriptEnabled(env) ? runTsconfigScriptRule(trigger, params, objective, files, why) : null;
}
