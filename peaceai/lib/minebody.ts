// M27: mine the `modify-body` family's evidence (shapes EXPR_REPLACE and GUARD_MID) from the same public
// repositories and the same author filter as M12 test mining (assertTestMiningAllowed, PEACE_AUTHOR). For each
// finished commit, each modified non-test source file, each hunk inside a function that exists before and
// after: EXPR_REPLACE = exactly one `if (...)`/`return ...;` line replaced by one of the same kind; GUARD_MID =
// exactly one added `if (COND) throw|return ...;` line, not the first statement. Style facts only, no code text.
// Deterministic; no model.
import { execFileSync } from "node:child_process";
import ts from "typescript";
import { parseHunks, SKIP_FILE, SOURCE_FILE, type Observation } from "./mine.ts";
import { MAX_FILES_PER_COMMIT } from "./minegit.ts";
import { assertTestMiningAllowed, PEACE_AUTHOR } from "./minetest.ts";
import { calleesOf, freeNames, localsBefore, parseExpr, safeExpression, SCANNER_PATH } from "./learned-body.ts";

type Fn = { name: string; a: number; b: number; params: Set<string>; body: ts.Block; sf: ts.SourceFile };
function functions(src: string): Fn[] {
  const sf = ts.createSourceFile("m.ts", src, ts.ScriptTarget.Latest, true);
  const line = (p: number) => sf.getLineAndCharacterOfPosition(p).line + 1;
  const out: Fn[] = [];
  const v = (n: ts.Node): void => {
    if ((ts.isFunctionDeclaration(n) || ts.isMethodDeclaration(n) || ts.isArrowFunction(n) || ts.isFunctionExpression(n)) && n.body && ts.isBlock(n.body)) {
      const name = n.name?.getText(sf) ?? (ts.isVariableDeclaration(n.parent) ? n.parent.name.getText(sf) : null);
      if (name) out.push({ name, a: line(n.body.getStart(sf)), b: line(n.body.getEnd()), params: new Set(n.parameters.map((p) => p.name.getText(sf))), body: n.body, sf });
    }
    ts.forEachChild(n, v);
  };
  v(sf);
  return out;
}
const SITE = /^(if \((.*)\)(?: (?:return|throw)\b.*| \{)?|return (.*);)$/;
const expr = (line: string): { site: string; text: string } | null => {
  const t = line.trim();
  const r = /^return (.+);$/.exec(t);
  if (r) return { site: "return-expression", text: r[1]! };
  const i = /^(?:\} else )?if \((.+)\)(?: \{| return\b.*| throw\b.*)?$/.exec(t);
  return i ? { site: "if-condition", text: i[1]! } : null;
};
void SITE;

export function observeBodyFile(commit: string, path: string, pre: string, post: string, diff: string): Observation[] {
  const out: Observation[] = [];
  const preF = functions(pre), postF = functions(post);
  for (const h of parseHunks(diff)) {
    const f = postF.find((x) => h.newStart > x.a && h.newStart + Math.max(h.newCount, 1) - 1 < x.b);
    if (!f || !preF.some((x) => x.name === f.name)) continue;
    if (h.removed.length === 1 && h.added.length === 1) {
      const a = expr(h.removed[0]!), b = expr(h.added[0]!);
      if (!a || !b || a.site !== b.site) continue;
      const oe = parseExpr(a.text), ne = parseExpr(b.text);
      if (!oe || !ne) continue;
      const allowed = new Set([...freeNames(oe), ...f.params]);
      const pos = f.sf.getPositionOfLineAndCharacter(h.newStart - 1, 0);
      const widened = new Set([...allowed, ...localsBefore(f.body, pos)]);
      const fits = (ns: Set<string>) => [...freeNames(ne)].every((n) => ns.has(n));
      const names = fits(widened) ? "old-names-params-and-enclosing-locals" : "other";
      out.push({ shape: "EXPR_REPLACE", commit, path, line: h.newStart, style: { site: a.site, names, vocabulary: safeExpression(ne, widened, calleesOf(oe)) && !SCANNER_PATH.test(path) ? "pure" : "other" } });
    } else if (h.removed.length === 0 && h.added.length === 1) {
      const m = /^if \((.+)\) (throw new Error\(["'][A-Z][A-Z0-9_]{2,63}["']\)|return [^;]*);$/.exec(h.added[0]!.trim());
      if (!m) continue;
      const top = f.body.statements;
      const idx = top.findIndex((s) => f.sf.getLineAndCharacterOfPosition(s.getStart(f.sf)).line + 1 === h.newStart);
      if (idx <= 0) continue; // entry guards are THROW_GUARD evidence
      const names = new Set(f.params);
      for (const s of top.slice(0, idx)) if (ts.isVariableStatement(s) && s.declarationList.flags & ts.NodeFlags.Const) for (const d of s.declarationList.declarations) if (ts.isIdentifier(d.name)) names.add(d.name.text);
      const ce = parseExpr(m[1]!);
      const exit = m[2]!.startsWith("throw") ? "throw-code" : /^return (-?\d+(\.\d+)?|true|false|null|"[^"]*"|'[^']*')$/.test(m[2]!) ? "return-literal" : "return-other";
      out.push({ shape: "GUARD_MID", commit, path, line: h.newStart, style: { exit, names: ce && [...freeNames(ce)].every((n) => names.has(n)) ? "params-and-prior-consts" : "other", vocabulary: ce && safeExpression(ce, names) ? "pure" : "other" } });
    }
  }
  return out;
}

export function mineBody(dir: string, rev: string, label: string): { commits: number; observations: Observation[] } {
  assertTestMiningAllowed(dir, label);
  const git = (...a: string[]) => execFileSync("git", a, { cwd: dir, encoding: "utf8", maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] });
  const commits = git("log", "--no-merges", "--reverse", "--format=%H %ae", rev).split("\n").filter(Boolean)
    .map((l) => l.split(" ")).filter(([, email]) => email === PEACE_AUTHOR).map(([sha]) => sha!);
  const observations: Observation[] = [];
  for (const c of commits) {
    let files: string[];
    try { files = git("diff-tree", "--no-commit-id", "--name-only", "-r", "--diff-filter=M", c).split("\n").filter(Boolean); } catch { continue; }
    if (files.length === 0 || files.length > MAX_FILES_PER_COMMIT) continue;
    for (const f of files.filter((x) => SOURCE_FILE.test(x) && !SKIP_FILE.test(x))) {
      try {
        observations.push(...observeBodyFile(`${label}@${c.slice(0, 10)}`, f, git("show", `${c}^:${f}`), git("show", `${c}:${f}`), git("diff", "-U0", "--no-color", "--no-renames", `${c}^`, c, "--", f)));
      } catch { /* root commit */ }
    }
  }
  return { commits: commits.length, observations };
}
