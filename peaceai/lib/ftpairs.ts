// M49 fine-tune stage data: function-body pairs from Peace-authored commits (this includes Builder patch-flow
// landings, which carry Peace's noreply identity) in Peace's public repos. Pure selection logic; the CLI does git I/O.
import ts from "typescript";
import { createHash } from "node:crypto";

export const FT_SCHEMA = "peaceai-ft-pairs:v1";
export const FT_AUTHOR = "301894882+PeaceG03@users.noreply.github.com";
export const FT_MAX_BODY_CHARS = 4000;
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
export const isTestPath = (p: string) => /(\.test\.|\.spec\.|(^|\/)(test|tests|__tests__)\/)/.test(p);

export interface FtExclusions {
  commits: ReadonlySet<string>;      // set A/B held-out shas + heldout-c-excluded commits ("repo@sha")
  contentSha256: ReadonlySet<string>; // set C v2 held-out file hashes, #176 task file hashes, safety-tool hashes
  paths: ReadonlySet<string>;         // "repo:path" of every file a set A/B task touches (no later edit of a held-out body leaks)
}
export interface FtCommit { repo: string; sha: string; authorEmail: string; parents: number; files: { path: string; before: string | null; after: string }[] }
export interface FtDoc { repo: string; sha: string; path: string; function: string; text: string; split: "train" | "heldout" }

/** Named function/method bodies (block text) of a file. */
export function bodies(path: string, text: string): Map<string, string> {
  const sf = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
  const out = new Map<string, string>();
  if (((sf as unknown as { parseDiagnostics?: unknown[] }).parseDiagnostics ?? []).length) return out;
  const v = (n: ts.Node) => {
    if ((ts.isFunctionDeclaration(n) || ts.isMethodDeclaration(n)) && n.body && n.name && ts.isIdentifier(n.name)) out.set(n.name.text, n.body.getText(sf));
    else if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer && (ts.isArrowFunction(n.initializer) || ts.isFunctionExpression(n.initializer)) && ts.isBlock(n.initializer.body)) out.set(n.name.text, n.initializer.body.getText(sf));
    ts.forEachChild(n, v);
  };
  v(sf);
  return out;
}

/** One doc per changed function body: the new file cut right after that body (prefix = context, body = target). */
export function pairsOf(c: FtCommit, ex: FtExclusions): FtDoc[] {
  if (c.authorEmail !== FT_AUTHOR || c.parents !== 1) return [];
  if (ex.commits.has(`${c.repo}@${c.sha}`)) return [];
  const out: FtDoc[] = [];
  for (const f of c.files) {
    if (!/\.(ts|mts)$/.test(f.path) || f.path.endsWith(".d.ts") || isTestPath(f.path) || f.before === null) continue;
    if (ex.paths.has(`${c.repo}:${f.path}`)) continue;
    if (ex.contentSha256.has(sha(f.after)) || ex.contentSha256.has(sha(f.before))) continue;
    const a = bodies(f.path, f.before), b = bodies(f.path, f.after);
    for (const [name, body] of b) {
      if (!a.has(name) || a.get(name) === body || body.length > FT_MAX_BODY_CHARS) continue;
      const end = f.after.indexOf(body);
      if (end < 0 || f.after.indexOf(body, end + 1) >= 0) continue; // ambiguous span: skip
      const text = f.after.slice(0, end + body.length);
      const split = parseInt(sha(`peaceai-ft:v1\n${c.repo}\n${c.sha}\n${f.path}\n${name}`).slice(0, 8), 16) % 10 === 0 ? "heldout" : "train";
      out.push({ repo: c.repo, sha: c.sha, path: f.path, function: name, text, split });
    }
  }
  return out;
}
