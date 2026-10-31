// PLAN-ONLY mode v4 (planner id plan-only-v4, peaceai/spec/plan-only-v4.md). EXPERIMENTAL; v3 (plan3.ts) stays the
// default (lib/plandefault.ts) and is unchanged; v1 and v2 are unchanged. v4 is v3 (copied, so v4 depends on no v3
// file and v3's plannerSha256 does not move) plus ONE test-pick rule (M164): when the request states a code name and
// exactly one existing behavior test file in the package of a planned source is named after it (file stem equal,
// ignoring case and separators), that file is the plan's test, before v3's import-based pick. Names the request
// states as plain names come first; names that appear only inside a code example are used only when no plain name
// fits. Everything else is v3's: same inputs, plan shape, grader and rules, each one line tagged `rule:<id>` with its
// reason in the specs; M164 removes each tagged rule in turn and requires a case to fail.
// Nothing here names a repository, task, task set or file of any task set, and no dev-set wording is matched.
// Read-only: the checkout is opened through codesearch.openRepo (readdir/stat/readFile only, nothing executed).
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, posix } from "node:path";
import { openRepo, isGeneratedPath, isTestPath as isTestPathCS, type CodeRepo } from "./codesearch.ts";
import { clauses, classify, parseTask } from "./nlparse.ts";
import { applyRule, specHash, type RuleSpec } from "./learned.ts";
import { loadTargets } from "./target.ts";
import { CAPABILITIES, isTestPath as isTestPathV1, PLAN_SCHEMA, type Capability, type PlanContext, type PlanStep } from "./plan.ts";

export const PLANNER_V4 = "plan-only-v4" as const;
/** Most source files one plan may name: a bound on a runaway request, not a target (files join only by a stated name). */
export const MAX_SOURCES_V4 = 6;
export const CAPABILITIES_V4 = CAPABILITIES;

export interface PlanV4 {
  schema: typeof PLAN_SCHEMA;
  planner: typeof PLANNER_V4;
  taskId: string;
  understanding: { clauses: number; intents: string[]; parse: string; anchors: string[]; kind: "add" | "edit"; testsOnly: boolean; scope: { names: number; sources: number; tests: number } };
  files: { path: string; role: "source" | "test"; reason: string }[];
  steps: PlanStep[];
  tests: { files: string[]; command: string | null };
  /** How the test command was found: package manager, runner, package directory ("" = repo root). Codes only. */
  testCommand: { pm: PackageManager; runner: Runner | null; packageDir: string; form: "targeted" | "script" | "none" };
  missingSkills: Capability[];
}

// ---- paths

const CODE = /\.(?:[cm]?[jt]sx?)$/;
const NON_SOURCE_DIR = /(?:^|\/)(?:node_modules|benchmarks?|bench|docs?|examples?|scripts?|website|playground|fixtures?|__fixtures__|__mocks__|e2e)\//;
const isTest = (p: string): boolean => isTestPathCS(p) || /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(p);
/** A file of code the package ships (not a test, generated output, declaration, doc, example, script or fixture). */
export const isSourceFile = (p: string): boolean => CODE.test(p) && !isTest(p) && !isGeneratedPath(p) && !NON_SOURCE_DIR.test(p); // rule:source-filter
/** A test file that holds test cases (not a fixture, helper, setup file, type test or bench). */
export const isBehaviorTest = (p: string): boolean => isTest(p) && CODE.test(p) && !/\.test-d\.|\.bench\.|\.d\.[cm]?ts$|(?:^|\/)(?:fixtures?|__fixtures__|helpers?|utils?|setup)\/|(?:^|\/)(?:test-)?(?:setup|helpers?|utils?|globals?|index)\.[cm]?[jt]sx?$/.test(p); // rule:behavior-test
export const fileStem = (p: string): string => posix.basename(p).replace(/\.[cm]?[jt]sx?$/, "").replace(/\.(?:test|spec)$/, "");
const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, "");

// ---- reading the request: the code names it states

export interface StatedName { name: string; qualifier: string | null; example: boolean }
const IDENT = /^[A-Za-z_$][\w$]*$/;
/** Names the request states: a backticked name (`f`, `A.b`, `f()`), or a code-shaped prose word (camelCase,
 *  inner-capital PascalCase, snake_case, CONSTANT_CASE). Names found only inside a longer code example are `example`. */
export function statedNames(request: string): StatedName[] {
  const out = new Map<string, StatedName>();
  const add = (name: string, qualifier: string | null, example: boolean) => {
    if (!IDENT.test(name) || /^\d/.test(name)) return;
    const k = `${qualifier ?? ""}.${name}`;
    const cur = out.get(k);
    if (!cur) out.set(k, { name, qualifier, example });
    else if (!example) cur.example = false;
  };
  for (const m of request.matchAll(/`([^`\n]{1,200})`/g)) {
    const span = m[1]!.trim();
    const bare = /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*\s*(?:\(\s*\))?$/.test(span);
    if (bare) {
      const parts = span.replace(/\(\s*\)$/, "").trim().split(".");
      add(parts[parts.length - 1]!, parts.length > 1 ? parts[parts.length - 2]! : null, false);
      if (parts.length > 1) add(parts[0]!, null, true);
      continue;
    }
    const code = span.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, '""');
    for (const x of code.matchAll(/(?<![\w$.])([A-Za-z_$][\w$]*)/g)) add(x[1]!, null, true);
  }
  const prose = request.replace(/`[^`\n]*`/g, " ");
  for (const m of prose.matchAll(/(?<![\w$.\/])([A-Za-z_$][\w$]{2,63})(?![\w$])/g)) if (/[a-z][A-Z]|^[A-Z][a-z]+[A-Z]|[a-z]_[a-z]|^[A-Z][A-Z0-9]*_[A-Z0-9_]+$/.test(m[1]!)) add(m[1]!, null, false);
  return [...out.values()];
}

/** "add" when the request asks for something new and reports no defect; else "edit" (v1's reading, unchanged words). */
export function kindOfChange(request: string): "add" | "edit" {
  return /\b(?:add|adds|adding|introduce|new|support for|expose|export)\b/i.test(request) && !/\b(?:fix|bug|wrong|incorrect|instead|should not|shouldn't|doesn't|does not|ignores|drops|accepts|leaves|treats|fails?|throws|crash(?:es)?|hangs?)\b/i.test(request) ? "add" : "edit";
}
/** A request that asks only for tests (no defect, no new behaviour): plan test steps only. */
export function asksTestsOnly(request: string): boolean {
  return /^\s*(?:please\s+)?(?:add|write|extend|improve|increase)\b[^.\n]*\b(?:tests?|coverage)\b/i.test(request) && !/\b(?:fix|bug|wrong|incorrect|instead|should|must|doesn't|does not|fails?|throws|crash(?:es)?|implement|support)\b/i.test(request); // rule:tests-only
}

// ---- scope: the files the stated names live in

/** The one source file a name lives in: its only defining file; else the file named after it; else its only exported
 *  definition. Ambiguous or absent names locate nothing. */
export function homeOf(code: CodeRepo, name: string): string | null {
  const r = code.symbol(name);
  if (!r.ok) return null;
  const defs = r.definitions.filter((d) => isSourceFile(d.path) && d.kind !== "parameter" && d.kind !== "local");
  const paths = [...new Set(defs.map((d) => d.path))];
  if (paths.length === 1) return paths[0]!;
  const named = paths.filter((p) => norm(fileStem(p)) === norm(name)); // rule:home-eponymous
  if (named.length === 1) return named[0]!;
  const exported = [...new Set(defs.filter((d) => d.exported).map((d) => d.path))]; // rule:home-exported
  return exported.length === 1 ? exported[0]! : null;
}

export interface Scope { sources: { path: string; symbol: string | null; reason: string }[]; names: number }
export function scopeOf(code: CodeRepo, request: string, names: readonly StatedName[]): Scope {
  const sources: Scope["sources"] = [];
  const add = (path: string, symbol: string | null, reason: string) => { if (!sources.some((s) => s.path === path) && sources.length < MAX_SOURCES_V4) sources.push({ path, symbol, reason }); }; // rule:max-sources
  let located = 0;
  const pass = (list: readonly StatedName[]) => {
    for (const n of list) {
      const own = homeOf(code, n.name);
      const home = own ?? (n.qualifier ? homeOf(code, n.qualifier) : null); // rule:qualifier-home
      if (home) { located++; add(home, own ? n.name : n.qualifier, `defines ${own ? n.name : n.qualifier}`); }
    }
  };
  pass(names.filter((n) => !n.example));
  if (sources.length === 0) pass(names.filter((n) => n.example)); // rule:example-fallback
  if (sources.length === 0) { // rule:rank-fallback
    const rel = code.relevant({ target: request }, { limit: 10 });
    const top = rel.ok ? rel.files.find((f) => isSourceFile(f.path) && f.score > 0) : undefined;
    if (top) add(top.path, null, "best search match");
  }
  return { sources, names: located };
}

// ---- tests

export interface TestPick { path: string; add: boolean; reason: string }
/** The existing test file that exercises `src` most directly (imports it, imports what it exports, or shares its name). */
export function testOf(code: CodeRepo, src: string): string | null {
  const r = code.testsFor(src);
  if (!r.ok) return null;
  const t = r.tests.find((x) => isBehaviorTest(x.path) && x.score >= 2); // rule:test-direct
  return t ? t.path : null;
}
/** (M164) Existing behavior tests named after a code name the request states: file stem equal to the name (ignoring
 *  case and separators), in the package of one of the plan's sources (any package when there is none), and only when
 *  exactly one file fits that name. Plain names first; names found only in a code example only when no plain name fits. */
export function namedTests(all: readonly string[], names: readonly StatedName[], sourcePkgs: ReadonlySet<string> | null): string[] {
  const pick = (list: readonly StatedName[]) => [...new Set(list.flatMap((n) => {
    const m = all.filter((p) => isBehaviorTest(p) && norm(fileStem(p)) === norm(n.name)); // rule:test-named
    const own = sourcePkgs === null ? m : m.filter((p) => sourcePkgs.has(packageDirOf(all, p))); // rule:test-named-package
    return own.length === 1 ? own : []; // rule:test-named-unique
  }))];
  const stated = pick(names.filter((n) => !n.example));
  return stated.length ? stated : pick(names.filter((n) => n.example)); // rule:test-named-examples-last
}
/** The package directory that owns `p`: the deepest directory above it holding a package.json ("" = repo root). */
export function packageDirOf(all: readonly string[], p: string): string {
  const dirs = all.filter((f) => posix.basename(f) === "package.json").map((f) => posix.dirname(f)).map((d) => (d === "." ? "" : d));
  return dirs.filter((d) => d === "" || p.startsWith(`${d}/`)).sort((a, b) => b.length - a.length)[0] ?? "";
}
/** Where a new test for `src` goes: in src's own package, the directory holding most of its test files, named after
 *  `src`, in that directory's naming style. None when src's package has no test files. */
export function newTestPath(all: readonly string[], src: string): string | null {
  const own = packageDirOf(all, src);
  const tests = all.filter((t) => isBehaviorTest(t) && packageDirOf(all, t) === own); // rule:new-test-same-package
  if (tests.length === 0) return null;
  const byDir = new Map<string, number>();
  for (const t of tests) byDir.set(posix.dirname(t), (byDir.get(posix.dirname(t)) ?? 0) + 1);
  const dir = [...byDir.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]![0];
  const sample = tests.filter((t) => posix.dirname(t) === dir).sort()[0]!;
  const suffix = /(\.(?:test|spec)\.[cm]?[jt]sx?)$/.exec(sample)?.[1] ?? /(\.[cm]?[jt]sx?)$/.exec(sample)![1]!;
  const p = `${dir === "." ? "" : `${dir}/`}${fileStem(src)}${suffix}`;
  return all.includes(p) ? null : p;
}

// ---- the project's test command

export type PackageManager = "npm" | "pnpm" | "yarn" | "bun";
export type Runner = "vitest" | "jest" | "ava" | "mocha";
const RUNNERS: Runner[] = ["vitest", "jest", "ava", "mocha"];
const readJson = (code: CodeRepo, p: string): Record<string, any> | null => {
  const r = code.read(p);
  if (!r.ok || r.truncated) return null;
  try { const o = JSON.parse(r.text); return o && typeof o === "object" && !Array.isArray(o) ? o : null; } catch { return null; }
};
const join2 = (d: string, f: string) => (d ? `${d}/${f}` : f);

/** The narrowest test command the project's own tooling supports for `testFiles` (paths from the repo root). */
export function testCommandFor(code: CodeRepo, all: readonly string[], anchor: string | null, testFiles: readonly string[]): { command: string | null; pm: PackageManager; runner: Runner | null; packageDir: string; form: "targeted" | "script" | "none" } {
  const set = new Set(all);
  // The package that owns the change: the deepest package.json above the first source (or test) file.
  const pkgDir = packageDirOf(all, anchor ?? testFiles[0] ?? ""); // rule:nearest-package
  const pkg = readJson(code, join2(pkgDir, "package.json"));
  const root = pkgDir ? readJson(code, "package.json") : pkg;
  // Package manager: the lockfile (package dir, then root), else the root `packageManager` field, else npm.
  const LOCKS: [string, PackageManager][] = [["pnpm-lock.yaml", "pnpm"], ["yarn.lock", "yarn"], ["bun.lock", "bun"], ["bun.lockb", "bun"], ["package-lock.json", "npm"], ["npm-shrinkwrap.json", "npm"]];
  let pm: PackageManager | null = null;
  for (const d of [...new Set([pkgDir, ""])]) for (const [f, m] of LOCKS) if (!pm && set.has(join2(d, f))) pm = m; // rule:pm-lockfile
  if (!pm && typeof root?.packageManager === "string") pm = (["pnpm", "yarn", "bun", "npm"] as PackageManager[]).find((m) => root.packageManager.startsWith(`${m}@`)) ?? null; // rule:pm-field
  pm ??= "npm";
  // Runner: named by the test script, else a runner config file, else a declared dependency.
  const scripts: Record<string, unknown> = pkg?.scripts && typeof pkg.scripts === "object" ? pkg.scripts : {};
  const testScript = typeof scripts.test === "string" ? scripts.test : null;
  let runner: Runner | null = RUNNERS.find((r) => testScript !== null && new RegExp(String.raw`(?<![\w-])${r}(?![\w-])`).test(testScript)) ?? null; // rule:runner-script
  for (const d of [...new Set([pkgDir, ""])]) if (!runner) runner = RUNNERS.find((r) => all.some((p) => posix.dirname(p) === (d || ".") && new RegExp(String.raw`^(?:${r}\.config|${r}\.workspace|\.${r}rc)(?:\.[\w.]+)?$`).test(posix.basename(p)))) ?? null; // rule:runner-config
  const deps = { ...(root?.devDependencies ?? {}), ...(root?.dependencies ?? {}), ...(pkg?.devDependencies ?? {}), ...(pkg?.dependencies ?? {}) };
  if (!runner) runner = RUNNERS.find((r) => Object.prototype.hasOwnProperty.call(deps, r)) ?? null; // rule:runner-deps
  const exec = { npm: "npx", pnpm: "pnpm", yarn: "yarn", bun: "bunx" }[pm];
  const cd = pkgDir ? `cd ${pkgDir} && ` : "";
  const rel = testFiles.filter((t) => !pkgDir || t.startsWith(`${pkgDir}/`)).map((t) => (pkgDir ? t.slice(pkgDir.length + 1) : t));
  // Targeted: a runner that takes test file paths directly (mocha's TypeScript setup often lives in its script flags).
  if (runner && runner !== "mocha" && rel.length) { // rule:targeted-runner
    const verb = runner === "vitest" ? "vitest run" : runner;
    return { command: `${cd}${exec} ${verb} ${rel.join(" ")}`, pm, runner, packageDir: pkgDir, form: "targeted" };
  }
  // Script: the package's own `test` script, else its `test:unit` script, else its first `test:*` script.
  const named = Object.keys(scripts).filter((k) => /^test:/.test(k) && typeof scripts[k] === "string").sort((a, b) => Number(b === "test:unit") - Number(a === "test:unit") || (a < b ? -1 : 1));
  const name = testScript !== null ? "test" : named[0] ?? null; // rule:script-fallback
  if (name) return { command: `${cd}${name === "test" && pm !== "bun" ? `${pm} test` : `${pm} run ${name}`}`, pm, runner, packageDir: pkgDir, form: "script" };
  return { command: null, pm, runner, packageDir: pkgDir, form: "none" };
}

// ---- can-do: only an approved rule run on an objective the request fully states (as v2)

/** Objectives in the approved rules' phrasing, built ONLY from names and values the request itself states. */
export function composedObjectives(request: string, fileOf: (name: string) => string | null): string[] {
  const out = new Set<string>();
  const bullets = request.split("\n").map((l) => l.trim()).filter((l) => /^[-*] /.test(l)).map((l) => l.replace(/\x60/g, ""));
  const withBullets = (head: string) => [head, ...bullets].join("\n");
  for (const s of request.split(/(?<=[.!?])\s+|\n+/).map((x) => x.trim()).filter(Boolean)) out.add(s);
  const LIT = String.raw`"[^"\n]*"|'[^'\n]*'|-?\d+(?:\.\d+)?|true|false`;
  for (const m of request.matchAll(new RegExp(String.raw`\b(?:set|change|update)\s+(?:the\s+)?(?:value\s+of\s+|default\s+)?\x60?([A-Za-z_$][\w$]*)\x60?\s+to\s+\x60?(${LIT})\x60?`, "gi"))) {
    const f = fileOf(m[1]!);
    if (f) out.add(`set \`${m[1]}\` in \`${f}\` to ${m[2]}`);
  }
  for (const m of request.matchAll(/\x60?([A-Za-z_$][\w$]*)\x60?(?:\(\))?\s+(?:should|must)\s+throw\s+\x60?([A-Z][A-Z0-9_]{2,63})\x60?\s+(when|if)\s+([^.\n]{1,160})/g)) {
    const f = fileOf(m[1]!);
    if (f) out.add(withBullets(`guard \`${m[1]}\` in \`${f}\`: throw \`${m[2]}\` ${m[3]} ${m[4]!.trim()}`));
  }
  for (const m of request.matchAll(/\bin\s+\x60([A-Za-z_$][\w$]*)\x60,?\s+replace\s+(?:the\s+)?(condition|return)\s+\x60([^`\n]{1,160})\x60\s+with\s+\x60([^`\n]{1,160})\x60/gi)) {
    const f = fileOf(m[1]!);
    if (f) out.add(withBullets(`in \`${m[1]}\` in \`${f}\`: replace ${m[2]!.toLowerCase()} \`${m[3]}\` with \`${m[4]}\``));
  }
  return [...out];
}

function ruleFor(ctx: PlanContext, objectives: readonly string[], file: string): { spec: RuleSpec; objective: string } | null {
  const src = ctx.files.filter((f) => CODE.test(f.path) || isTestPathV1(f.path));
  for (const objective of objectives) for (const spec of ctx.rules) {
    try {
      const edit = applyRule(spec, objective, src, isTestPathV1, ctx.repo);
      if (edit && (edit.path === file || (edit.extra ?? []).some((x) => x.path === file))) return { spec, objective }; // rule:can-do-same-file
    } catch { /* an engine error is a refusal */ }
  }
  return null;
}

// ---- the planner

/** Makes the plan. Reads only `ctx` and the read-only `code` view of the same checkout; writes nothing. */
export function planTaskV4(taskId: string, request: string, ctx: PlanContext, code: CodeRepo): PlanV4 {
  const tree = code.tree();
  const all = tree.ok ? tree.files : [];
  const names = statedNames(request);
  const parts = clauses(request);
  const intents = ctx.model ? parts.map((c) => { const p = classify(ctx.model!, c); return Object.entries(p).sort((a, b) => b[1] - a[1])[0]![0]; }) : [];
  const parsed = parseTask({ title: "", body: request }, { model: ctx.model, approvedKinds: new Set(ctx.rules.map((r) => r.kind as string)) });
  const kind = kindOfChange(request);
  const testsOnly = asksTestsOnly(request);
  const scope = scopeOf(code, request, names);
  const files: PlanV4["files"] = [];
  const tests: TestPick[] = [];
  const named = namedTests(all, names, scope.sources.length ? new Set(scope.sources.map((s) => packageDirOf(all, s.path))) : null);
  for (const p of named) tests.push({ path: p, add: false, reason: "named by the request" });
  if (named.length === 0) for (const s of scope.sources) { // rule:test-named-first
    const t = testOf(code, s.path);
    if (t) { if (!tests.some((x) => x.path === t)) tests.push({ path: t, add: false, reason: `tests ${s.path}` }); continue; }
    const p = newTestPath(all, s.path); // rule:new-test-beside
    if (p && !tests.some((x) => x.path === p)) tests.push({ path: p, add: true, reason: `new test for ${s.path}` });
  }
  if (!testsOnly) for (const s of scope.sources) files.push({ path: s.path, role: "source", reason: s.reason });
  for (const t of tests) files.push({ path: t.path, role: "test", reason: t.reason });
  const fileOf = (name: string) => homeOf(code, name);
  const objectives = composedObjectives(request, fileOf);
  const steps: PlanStep[] = [];
  const push = (s: Omit<PlanStep, "n">) => steps.push({ n: steps.length + 1, ...s });
  if (!testsOnly && scope.sources.length === 0) push({ action: "edit-source", file: null, symbol: null, status: "missing", rule: null, objective: null, missing: names.length ? "locate-code" : "understand-request" });
  if (!testsOnly) for (const s of scope.sources) {
    const hit = ruleFor(ctx, objectives, s.path);
    const isConst = s.symbol !== null && /^[A-Z][A-Z0-9_]+$/.test(s.symbol);
    const missing: Capability = kind === "add" ? "add-function-or-member" : isConst ? "edit-constant" : "edit-existing-function";
    push(hit ? { action: "edit-source", file: s.path, symbol: s.symbol, status: "can-do", rule: `${hit.spec.id}@${specHash(hit.spec)}`, objective: hit.objective, missing: null }
      : { action: "edit-source", file: s.path, symbol: s.symbol, status: "missing", rule: null, objective: null, missing });
  }
  if (tests.length === 0) push({ action: "add-test", file: null, symbol: null, status: "missing", rule: null, objective: null, missing: "add-test-file" }); // rule:test-step-always
  for (const t of tests) {
    const hit = ruleFor(ctx, objectives, t.path);
    const action = t.add ? "add-test" : "edit-test";
    push(hit ? { action, file: t.path, symbol: null, status: "can-do", rule: `${hit.spec.id}@${specHash(hit.spec)}`, objective: hit.objective, missing: null }
      : { action, file: t.path, symbol: null, status: "missing", rule: null, objective: null, missing: t.add ? "add-test-file" : "extend-existing-test" });
  }
  const tc = testCommandFor(code, all, scope.sources[0]?.path ?? null, tests.map((t) => t.path));
  const runnable = Object.prototype.hasOwnProperty.call(loadTargets().targets, ctx.repo); // rule:run-tests-target
  push(runnable ? { action: "run-tests", file: null, symbol: null, status: "can-do", rule: "pipeline:job-b-tests", objective: null, missing: null }
    : { action: "run-tests", file: null, symbol: null, status: "missing", rule: null, objective: null, missing: "run-target-tests" });
  const missingSkills = [...new Set(steps.map((s) => s.missing).filter((m): m is Capability => m !== null))];
  return {
    schema: PLAN_SCHEMA, planner: PLANNER_V4, taskId,
    understanding: { clauses: parts.length, intents, parse: parsed.status === "unsure" ? `unsure:${parsed.reason}` : parsed.status, anchors: names.filter((n) => !n.example).map((n) => n.name).slice(0, 8), kind, testsOnly, scope: { names: scope.names, sources: testsOnly ? 0 : scope.sources.length, tests: tests.length } },
    files, steps, tests: { files: tests.map((t) => t.path), command: tc.command },
    testCommand: { pm: tc.pm, runner: tc.runner, packageDir: tc.packageDir, form: tc.form },
    missingSkills,
  };
}

/** A read-only search view over files held in memory (a fixture checkout): written once to a temp dir, removed by close. */
export function repoFromFiles(files: readonly { path: string; content: string }[]): { code: CodeRepo; close(): void } {
  const dir = mkdtempSync(join(tmpdir(), "peaceai-plan3-"));
  try {
    for (const f of files) {
      if (!/^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[\w@+.\/-]{1,300}$/.test(f.path)) continue;
      mkdirSync(dirname(join(dir, f.path)), { recursive: true });
      writeFileSync(join(dir, f.path), f.content);
    }
    return { code: openRepo(dir), close: () => rmSync(dir, { recursive: true, force: true }) };
  } catch (e) { rmSync(dir, { recursive: true, force: true }); throw e; }
}
