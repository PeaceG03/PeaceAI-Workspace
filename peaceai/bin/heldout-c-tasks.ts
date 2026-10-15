// Set C v2 function-body task list: deterministic carve from the pinned held-out snapshots.
import ts from "typescript";
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
const W = new URL("../model/heldout-c.json", import.meta.url);
const C = JSON.parse(readFileSync(W, "utf8")).sets.C as { repo: string; sha: string; contentSha256: string[] }[];
const sha = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");
const PER_REPO = 20, MIN_LINES = 2, MAX_LINES = 15, MAX_CHARS = 600;
const out: unknown[] = []; const counts: Record<string, { files: number; eligible: number; chosen: number }> = {};
for (const c of C) {
  const dir = (process.env.EXT_DIR ?? "/workspace/ext") + "/" + c.repo.replace("/", "__");
  if (execSync("git rev-parse HEAD", { cwd: dir }).toString().trim() !== c.sha) throw new Error("pin mismatch " + c.repo);
  const held = new Set(c.contentSha256);
  const paths = execSync("git ls-files", { cwd: dir }).toString().trim().split("\n")
    .filter((p) => /\.(ts|mts|js|mjs)$/.test(p) && !/\.d\.ts$/.test(p) && !/(^|\/)(test|tests|__tests__|spec|fixtures?|examples?|docs?)\//.test(p) && !/\.(test|spec)\.[mc]?[jt]s$/.test(p));
  const elig: any[] = []; let files = 0;
  for (const p of paths) {
    const buf = readFileSync(dir + "/" + p); const h = sha(buf);
    if (!held.has(h)) continue; files++;
    const text = buf.toString("utf8");
    const sf = ts.createSourceFile(p, text, ts.ScriptTarget.Latest, true);
    if (((sf as any).parseDiagnostics ?? []).length) continue;
    const visit = (n: ts.Node) => {
      if ((ts.isFunctionDeclaration(n) || ts.isMethodDeclaration(n)) && n.body && n.name && ts.isIdentifier(n.name)) {
        const body = n.body.getText(sf); const lines = body.split("\n").length - 2;
        if (lines >= MIN_LINES && lines <= MAX_LINES && body.length <= MAX_CHARS && n.body.statements.length > 0) {
          const name = n.name.text; const start = n.body.getStart(sf);
          const line = sf.getLineAndCharacterOfPosition(start).line + 1;
          elig.push({ id: sha(`peaceai-ext-c-tasks:v1\n${c.repo}\n${p}\n${name}\n${line}`), repo: c.repo, sha: c.sha, path: p, fileSha256: h, function: name, bodyLine: line, bodyStart: start, bodyEnd: n.body.getEnd(), bodySha256: sha(body), bodyLines: lines });
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  elig.sort((a, b) => (a.id < b.id ? -1 : 1));
  const chosen = elig.slice(0, PER_REPO); out.push(...chosen);
  counts[c.repo] = { files, eligible: elig.length, chosen: chosen.length };
}
const doc = { schema: "peaceai-heldout-c-tasks:v1", source: "peaceai/model/heldout-c.json (set C v2 pins)",
  rule: `Function-body tasks from the set C v2 pinned snapshots. File: tracked .ts/.mts/.js/.mjs, not .d.ts, not under test/tests/__tests__/spec/fixture(s)/example(s)/doc(s), not *.test/*.spec, content sha256 in the repo's held-out contentSha256 list, parses cleanly. Function: a named function or method declaration whose body block has ${MIN_LINES}-${MAX_LINES} inner lines, at most ${MAX_CHARS} characters, at least one statement. Order eligible functions per repo by id = sha256('peaceai-ext-c-tasks:v1\\n'+repo+'\\n'+path+'\\n'+name+'\\n'+bodyLine) ascending; take the first ${PER_REPO}.`,
  task: "The model gets the file with the body block [bodyStart, bodyEnd) replaced by '{}' and must produce the body. Graded statically, never by running the target repo's code: pass = the produced file parses and its body is token-equal to the original (TypeScript scanner tokens, trivia ignored); fail = parses but differs, or no output; ungradable = the produced file does not parse at the original span boundary (reported, never dropped from the denominator).",
  counts, tasks: out };
writeFileSync(new URL("../model/heldout-c-tasks.json", import.meta.url), JSON.stringify(doc, null, 1) + "\n");
console.log(JSON.stringify(counts), out.length);
