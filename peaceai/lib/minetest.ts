// M12: mine finished test cases (the ADD_TEST_CASE rule's evidence). Reads test files only, and only from
// the public repositories in TEST_MINING_REPOS (the PeaceSTOCKS scanner and this Workspace): never core,
// PeaceSTOCKS-Net, Net-Runner or any other repository. A repository is mined only when its label is on the
// list AND its origin remote is that public repository. Only commits by Peace's noreply identity count
// (finished work), reachable from the given revision (main). Each observation is one top-level test()/it()
// call wholly inside the added lines, described by style facts only (no code text). Deterministic; no model.
import { execFileSync } from "node:child_process";
import ts from "typescript";
import { parseHunks, type Observation } from "./mine.ts";
import { MAX_FILES_PER_COMMIT } from "./minegit.ts";

export const TEST_MINING_REPOS: Readonly<Record<string, string>> = { PeaceSTOCKS: "PeaceG03/PeaceSTOCKS", "PeaceAI-Workspace": "PeaceG03/PeaceAI-Workspace" };
export const PEACE_AUTHOR = "301894882+PeaceG03@users.noreply.github.com";
export const TEST_FILE = /\.(test|spec)\.(ts|mts|tsx)$/;
const CALENDAR = /holiday|early close|half[- ]day|calendar|new year|christmas|thanksgiving|session|weekend|trading day/i;
const CHECKS = ["equal", "deepEqual", "throws", "rejects"] as const;

export class TestMiningRefused extends Error {}

/** Refuses any repository that is not an allowed public one (by label and by origin remote). */
export function assertTestMiningAllowed(dir: string, label: string): void {
  const slug = TEST_MINING_REPOS[label];
  if (!slug) throw new TestMiningRefused(`test mining refused: ${label} is not an allowed public repository`);
  let origin = "";
  try { origin = execFileSync("git", ["remote", "get-url", "origin"], { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { /* none */ }
  const m = /github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?\/?$/.exec(origin);
  if (!m || m[1] !== slug) throw new TestMiningRefused(`test mining refused: origin of ${label} is not ${slug}`);
}

const lineOf = (sf: ts.SourceFile, pos: number) => sf.getLineAndCharacterOfPosition(pos).line + 1;
const bucket = (n: number) => (n <= 12 ? "<=12" : n <= 40 ? "13-40" : ">40");

/** File-level style: how the test file imports the test runner and assert, and its relative import style. */
export function fileStyle(sf: ts.SourceFile): Record<string, string> {
  let framework = "other";
  let assertStyle = "other";
  let ext = 0;
  let bare = 0;
  for (const s of sf.statements) {
    if (!ts.isImportDeclaration(s) || !ts.isStringLiteral(s.moduleSpecifier)) continue;
    const from = s.moduleSpecifier.text;
    const clause = s.importClause;
    if (from === "node:test") framework = clause?.name ? "node:test-default" : "node:test-named";
    else if (from === "node:assert/strict") assertStyle = clause?.name ? "node:assert/strict-default" : "node:assert/strict-named";
    else if (from === "node:assert") assertStyle = "node:assert-loose";
    else if (/^\.{1,2}\//.test(from)) { if (from.endsWith(".ts")) ext += 1; else bare += 1; }
  }
  return { framework, assert: assertStyle, importExt: ext && bare ? "mixed" : ext ? "ts" : bare ? "none" : "n/a" };
}

/** Style facts for one test()/it() call: size, check forms, error matcher, async, fail-closed, calendar. */
export function caseStyle(call: ts.CallExpression, sf: ts.SourceFile): Record<string, string> {
  const name = call.arguments[0] && ts.isStringLiteralLike(call.arguments[0]) ? call.arguments[0].text : "";
  const fn = call.arguments.find((a) => ts.isArrowFunction(a) || ts.isFunctionExpression(a)) as ts.ArrowFunction | ts.FunctionExpression | undefined;
  const used = new Set<string>();
  let matcher = "n/a";
  const visit = (n: ts.Node) => {
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && ts.isIdentifier(n.expression.expression) && n.expression.expression.text === "assert") {
      const m = n.expression.name.text;
      if ((CHECKS as readonly string[]).includes(m)) used.add(m);
      if ((m === "throws" || m === "rejects") && matcher !== "regex") {
        const second = n.arguments[1];
        matcher = !second ? "none" : ts.isRegularExpressionLiteral(second) ? "regex" : ts.isObjectLiteralExpression(second) ? "object" : "other";
      }
    }
    ts.forEachChild(n, visit);
  };
  if (fn) visit(fn.body);
  // M20: does any non-assert call in the case take an object-literal argument?
  let objectArgs = false;
  const objVisit = (n: ts.Node) => {
    if (ts.isCallExpression(n) && !(ts.isPropertyAccessExpression(n.expression) && ts.isIdentifier(n.expression.expression) && n.expression.expression.text === "assert") && n.arguments.some((a) => ts.isObjectLiteralExpression(a))) objectArgs = true;
    ts.forEachChild(n, objVisit);
  };
  if (fn) objVisit(fn.body);
  const lines = lineOf(sf, call.getEnd()) - lineOf(sf, call.getStart(sf)) + 1;
  return {
    lines: bucket(lines),
    ...Object.fromEntries(CHECKS.map((c) => [`check:${c}`, used.has(c) ? "yes" : "no"])),
    matcher,
    objectArgs: objectArgs ? "yes" : "no",
    async: fn?.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword) ? "yes" : "no",
    failClosed: used.has("throws") || used.has("rejects") ? "yes" : "no",
    calendar: CALENDAR.test(name) ? "yes" : "no",
  };
}

/** TEST_CASE observations in one test file of one commit. Pure; deterministic. */
export function observeTestFile(commit: string, path: string, postContent: string, diff: string): Observation[] {
  if (!TEST_FILE.test(path)) return [];
  const sf = ts.createSourceFile(path, postContent, ts.ScriptTarget.Latest, true, path.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const ranges = parseHunks(diff).filter((h) => h.newCount > 0).map((h) => [h.newStart, h.newStart + h.newCount - 1] as const);
  const file = fileStyle(sf);
  const out: Observation[] = [];
  for (const s of sf.statements) {
    if (!ts.isExpressionStatement(s) || !ts.isCallExpression(s.expression)) continue;
    const call = s.expression;
    if (!ts.isIdentifier(call.expression) || !/^(test|it)$/.test(call.expression.text)) continue;
    const a = lineOf(sf, s.getStart(sf));
    const b = lineOf(sf, s.getEnd());
    if (!ranges.some(([x, y]) => a >= x && b <= y)) continue; // a new case, not an edit of an existing one
    // M14: where the case went: a new file, appended after every existing statement, or inserted between them.
    const added = (n: ts.Node) => ranges.some(([x, y]) => lineOf(sf, n.getStart(sf)) >= x && lineOf(sf, n.getEnd()) <= y);
    const placement = sf.statements.every((t) => added(t)) ? "new-file" : sf.statements.slice(sf.statements.indexOf(s)).every((t) => added(t)) ? "append" : "insert";
    const style = { ...file, ...caseStyle(call, sf) };
    out.push({ shape: "TEST_CASE", commit, path, line: a, style });
    if (placement === "append") out.push({ shape: "TEST_CASE_APPEND", commit, path, line: a, style });
  }
  return out;
}

/** Test-case observations for Peace's commits reachable from `rev` in an allowed public repository. */
export function mineTests(dir: string, rev: string, label: string): { commits: number; observations: Observation[] } {
  assertTestMiningAllowed(dir, label);
  const git = (...a: string[]) => execFileSync("git", a, { cwd: dir, encoding: "utf8", maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] });
  const commits = git("log", "--no-merges", "--reverse", "--format=%H %ae", rev).split("\n").filter(Boolean)
    .map((l) => l.split(" ")).filter(([, email]) => email === PEACE_AUTHOR).map(([sha]) => sha!);
  const observations: Observation[] = [];
  for (const c of commits) {
    let files: string[];
    try {
      files = git("diff-tree", "--no-commit-id", "--name-only", "-r", "--diff-filter=AM", c).split("\n").filter(Boolean);
    } catch { continue; }
    if (files.length === 0 || files.length > MAX_FILES_PER_COMMIT) continue;
    for (const f of files.filter((x) => TEST_FILE.test(x) && !/(^|\/)(dist|node_modules|build)\//.test(x))) {
      try {
        const diff = git("diff", "-U0", "--no-color", "--no-renames", `${c}^`, c, "--", f);
        observations.push(...observeTestFile(`${label}@${c.slice(0, 10)}`, f, git("show", `${c}:${f}`), diff));
      } catch { /* root commit */ }
    }
  }
  return { commits: commits.length, observations };
}
