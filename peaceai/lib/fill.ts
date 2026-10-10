// M9 gap filling with templates. A task that names a constant but not its value ("add an exported constant
// MAX_RETRIES of type number to src/config.ts") has one gap. The template fixes everything except the value;
// the options are literals of the right type already present in the target (plus a neutral default), so
// the model only CHOOSES among target text and never writes free text into a diff. Job A re-derives the
// options and accepts a fill only if it is one of them; the candidate then goes through the normal gate,
// scope, leak, sandboxed tests and repair loop like any other.
import { createHash } from "node:crypto";
import ts from "typescript";

export const FILLS_SCHEMA = "peaceai-lm-fills:v1";
export const MAX_OPTIONS = 24;
export const MAX_LITERAL = 40;
export type FillType = "string" | "number" | "boolean";
export interface FillTask { name: string; type: FillType | null; path: string }

const TEMPLATE = /\badd (?:an |a )?exported (?:constant|const) `?([A-Z][A-Z0-9_]{1,40})`?(?: of type (string|number|boolean))? (?:to|in) `?([A-Za-z0-9_./-]+\.tsx?)`?/i;

/** The gap template; null when the task gives a value (then the kernel's own families handle it). */
export function parseFillTask(objective: string): FillTask | null {
  const m = TEMPLATE.exec(objective);
  if (!m) return null;
  if (/=|\b(?:with value|set to|equal to|equals|value of)\b/i.test(objective)) return null;
  if (m[3]!.includes("..") || m[3]!.startsWith("/")) return null;
  return { name: m[1]!, type: (m[2]?.toLowerCase() as FillType | undefined) ?? null, path: m[3]! };
}

export function fillKey(task: FillTask): string {
  return createHash("sha256").update(`${task.path}\n${task.name}\n${task.type ?? ""}`).digest("hex").slice(0, 16);
}

function literalsOf(path: string, content: string): { type: FillType; text: string }[] {
  const out: { type: FillType; text: string }[] = [];
  const sf = ts.createSourceFile(path, content, ts.ScriptTarget.Latest, true, path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const visit = (n: ts.Node) => {
    if (ts.isStringLiteral(n) && !ts.isImportDeclaration(n.parent) && !ts.isExportDeclaration(n.parent) && !ts.isExternalModuleReference(n.parent)) {
      if (/^[\x20-\x7e]*$/.test(n.text) && !/["\\`]/.test(n.text)) out.push({ type: "string", text: JSON.stringify(n.text) });
    } else if (ts.isNumericLiteral(n)) {
      const neg = ts.isPrefixUnaryExpression(n.parent) && n.parent.operator === ts.SyntaxKind.MinusToken;
      out.push({ type: "number", text: (neg ? "-" : "") + n.text });
    } else if (n.kind === ts.SyntaxKind.TrueKeyword || n.kind === ts.SyntaxKind.FalseKeyword) {
      out.push({ type: "boolean", text: n.kind === ts.SyntaxKind.TrueKeyword ? "true" : "false" });
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

/** Options for the gap: same-type literals from the target file first, then other in-scope files (sorted). */
export function fillOptions(task: FillTask, files: readonly { path: string; content: string }[]): string[] {
  const ordered = [...files].sort((a, b) => (a.path === task.path ? -1 : b.path === task.path ? 1 : a.path < b.path ? -1 : 1));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const f of ordered) {
    if (!/\.tsx?$/.test(f.path)) continue;
    for (const l of literalsOf(f.path, f.content)) {
      if ((task.type && l.type !== task.type) || l.text.length > MAX_LITERAL || seen.has(l.text)) continue;
      seen.add(l.text);
      out.push(l.text);
      if (out.length >= MAX_OPTIONS - 1) break;
    }
    if (out.length >= MAX_OPTIONS - 1) break;
  }
  const neutral = task.type === "string" ? '""' : task.type === "boolean" ? "false" : "0";
  if (!seen.has(neutral)) out.push(neutral);
  return out;
}

const declares = (content: string, name: string) => new RegExp(`\\b(?:const|let|var|function|class|type|interface|enum)\\s+${name}\\b`).test(content);

/** The hole the model scores: everything before the value, and what follows it. */
export function fillHole(task: FillTask, content: string): { prefix: string; suffix: string } | null {
  if (declares(content, task.name)) return null;
  return { prefix: (content.endsWith("\n") ? content : content + "\n") + `\nexport const ${task.name} = `, suffix: ";\n" };
}

export function applyFill(task: FillTask, content: string, value: string): string | null {
  const hole = fillHole(task, content);
  return hole ? hole.prefix + value + hole.suffix : null;
}

export interface FillsFile { schema: typeof FILLS_SCHEMA; key: string; model: string; value: string; options: number }

/** Job A's acceptance: the right schema and task key, and a value that is one of Job A's own options. */
export function acceptFill(raw: unknown, task: FillTask, options: readonly string[]): string | null {
  const f = raw as Partial<FillsFile> | null;
  if (!f || f.schema !== FILLS_SCHEMA || f.key !== fillKey(task) || typeof f.value !== "string" || !/^lm-v1-[0-9a-f]{12}$/.test(String(f.model))) return null;
  return options.includes(f.value) ? f.value : null;
}
