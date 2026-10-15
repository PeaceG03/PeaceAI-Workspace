// M50: static grader for the set C v2 function-body tasks (#176, peaceai/model/heldout-c-tasks.json).
// Runs nothing: target files and predictions are only parsed and scanned by the TypeScript compiler API.
// Every task is counted: pass + fail + ungradable === tasks.length, always (a missing prediction is a fail).
import ts from "typescript";
import { createHash } from "node:crypto";

export interface CTask { id: string; repo: string; path: string; fileSha256: string; function: string; bodyStart: number; bodyEnd: number; bodySha256: string }
export type Verdict = "pass" | "fail" | "ungradable";
export interface Graded { id: string; verdict: Verdict; why: string }

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const kindOf = (p: string) => (/\.m?ts$/.test(p) ? ts.ScriptKind.TS : ts.ScriptKind.JS);

/** Token texts of a code fragment (trivia skipped). Used only for comparison. */
export function tokens(text: string, path: string): string[] {
  const sc = ts.createScanner(ts.ScriptTarget.Latest, true, ts.LanguageVariant.Standard, text);
  const out: string[] = [];
  for (let k = sc.scan(); k !== ts.SyntaxKind.EndOfFileToken; k = sc.scan()) {
    if (k === ts.SyntaxKind.SlashToken || k === ts.SyntaxKind.SlashEqualsToken) { const r = sc.reScanSlashToken(); if (r === ts.SyntaxKind.RegularExpressionLiteral) k = r; }
    out.push(sc.getTokenText());
  }
  return out;
}

function parses(text: string, path: string): ts.SourceFile | null {
  const sf = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, kindOf(path));
  return ((sf as unknown as { parseDiagnostics?: unknown[] }).parseDiagnostics ?? []).length ? null : sf;
}

/** The function or method named `name` whose body block starts exactly at `start`. */
function bodyAt(sf: ts.SourceFile, name: string, start: number): ts.Block | null {
  let hit: ts.Block | null = null;
  const v = (n: ts.Node) => {
    if (hit) return;
    if ((ts.isFunctionDeclaration(n) || ts.isMethodDeclaration(n)) && n.body && n.name && ts.isIdentifier(n.name) && n.name.text === name && n.body.getStart(sf) === start) hit = n.body;
    ts.forEachChild(n, v);
  };
  v(sf);
  return hit;
}

/** Grade one task. `source` is the pinned file text (its sha256 must match); `body` is the predicted body block
 *  (from "{" to "}") or undefined when the model produced nothing. */
export function gradeOne(t: CTask, source: string, body: string | undefined): Graded {
  if (sha(source) !== t.fileSha256) throw new Error(`pinned file mismatch for ${t.id}`); // never grade against the wrong file
  const want = source.slice(t.bodyStart, t.bodyEnd);
  if (sha(want) !== t.bodySha256) throw new Error(`body span mismatch for ${t.id}`);
  if (typeof body !== "string" || body.trim() === "") return { id: t.id, verdict: "fail", why: "no output" };
  if (body.length > 20_000) return { id: t.id, verdict: "ungradable", why: "output too long" };
  const produced = source.slice(0, t.bodyStart) + body + source.slice(t.bodyEnd);
  const sf = parses(produced, t.path);
  if (!sf) return { id: t.id, verdict: "ungradable", why: "produced file does not parse" };
  const blk = bodyAt(sf, t.function, t.bodyStart);
  if (!blk || blk.getEnd() !== t.bodyStart + body.length) return { id: t.id, verdict: "ungradable", why: "body does not close at the original span boundary" };
  const a = tokens(want, t.path), b = tokens(body, t.path);
  return a.length === b.length && a.every((x, i) => x === b[i]) ? { id: t.id, verdict: "pass", why: "token-equal" } : { id: t.id, verdict: "fail", why: "differs" };
}

export interface Summary { tasks: number; pass: number; fail: number; ungradable: number; perRepo: Record<string, { tasks: number; pass: number; fail: number; ungradable: number }>; unknownPredictions: number }

/** Grade every task. Predictions for ids not in the list are counted and ignored; duplicates are refused. */
export function gradeAll(tasks: readonly CTask[], readSource: (t: CTask) => string, predictions: readonly { id: string; body: string }[]): { summary: Summary; graded: Graded[] } {
  const ids = new Set(tasks.map((t) => t.id));
  if (ids.size !== tasks.length) throw new Error("duplicate task id");
  const pred = new Map<string, string>(); let unknown = 0;
  for (const p of predictions) {
    if (!ids.has(p.id)) { unknown++; continue; }
    if (pred.has(p.id)) throw new Error(`duplicate prediction ${p.id}`);
    pred.set(p.id, p.body);
  }
  const graded = tasks.map((t) => gradeOne(t, readSource(t), pred.get(t.id)));
  const s: Summary = { tasks: tasks.length, pass: 0, fail: 0, ungradable: 0, perRepo: {}, unknownPredictions: unknown };
  graded.forEach((g, i) => { const r = (s.perRepo[tasks[i]!.repo] ??= { tasks: 0, pass: 0, fail: 0, ungradable: 0 }); r.tasks++; r[g.verdict]++; s[g.verdict]++; });
  if (s.pass + s.fail + s.ungradable !== s.tasks) throw new Error("denominator");
  return { summary: s, graded };
}
