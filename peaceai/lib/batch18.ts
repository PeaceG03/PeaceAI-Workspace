// Three repairs for bugs the existing templates do not cover.
// An internal route starts with /_, so it is not rate limited.
// Indent detection skips leading padding and blank lines.
// ENOTDIR while resolving a package is not-found, not an error to log.
// Each edit is refused unless that exact shape is present. The published test must pass afterwards.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { practiceGit, runInPracticeSandbox } from "./practicemine.ts";

const RATE_OLD = "  if (event.url.pathname.startsWith(\"_\")) {\n";
const RATE_NEW = "  if (event.url.pathname.startsWith(\"/_\")) {\n";
const WS_OLD = "const WhitespaceStartRe = /^(\\s+)/;\n";
const WS_NEW = "const WhitespaceStartRe = /^(\\s+)/;\nconst BlankLineRe = /^[ \\t]+(?=\\r?$)/gm;\n";
const SAMPLE_OLD = "export function stripBOM(text: string): string {\n  return text.charCodeAt(0) === 0xfe_ff ? text.slice(1) : text;\n}\n\nexport function detectFormat(text: string, opts: FormatOptions = {}): FormatInfo {\n  // Keep ref to a sample of the original text only if need to later detect indent to reduce memory usage.\n  const sample =\n    opts.indent === undefined && opts.preserveIndentation !== false\n      ? stripBOM(text).slice(0, opts?.sampleSize || 1024)\n      : undefined;\n";
const SAMPLE_NEW = "export function stripBOM(text: string): string {\n  return text.charCodeAt(0) === 0xfe_ff ? text.slice(1) : text;\n}\n\n/**\n * Takes the sample used to detect indentation, starting at the first line with content so that\n * leading padding (e.g. an SFC block padded with spaces) does not fill it.\n *\n * Whitespace-only lines are emptied: `detect-indent` skips empty lines but would count these as\n * indented ones.\n */\nfunction indentSample(text: string, size: number): string {\n  const leading = WhitespaceStartRe.exec(text)?.[0] || \"\";\n  const start = leading.lastIndexOf(\"\\n\") + 1;\n  return text.slice(start, start + size).replace(BlankLineRe, \"\");\n}\n\nexport function detectFormat(text: string, opts: FormatOptions = {}): FormatInfo {\n  // Keep ref to a sample of the original text only if need to later detect indent to reduce memory usage.\n  const sample =\n    opts.indent === undefined && opts.preserveIndentation !== false\n      ? indentSample(stripBOM(text), opts?.sampleSize || 1024)\n      : undefined;\n\n";
const ENOT_OLD = "    if (e.code !== 'MODULE_NOT_FOUND' && e.code !== 'ERR_MODULE_NOT_FOUND')\n";
const ENOT_NEW = "    if (e.code !== 'MODULE_NOT_FOUND' && e.code !== 'ERR_MODULE_NOT_FOUND' && e.code !== 'ENOTDIR')\n";

/** Skip routes whose pathname starts with /_. A check that is not this middleware is refused. */
export function skipInternalRoute(text: string): string | null {
  if (!text.includes("export default defineMiddleware")) return null; // uh-guard:route
  if (!text.includes(RATE_OLD) || text.includes(RATE_NEW)) return null;
  if (text.split(RATE_OLD).length !== 2) return null;
  return text.replace(RATE_OLD, () => RATE_NEW);
}

/** Detect indent from the first content line, ignoring blank lines. A check that is not detectFormat is refused. */
export function indentFromContent(text: string): string | null {
  if (!text.includes("export function detectFormat(")) return null; // cb-guard:indent
  if (!text.includes(WS_OLD) || !text.includes(SAMPLE_OLD) || text.includes("function indentSample")) return null;
  if (text.split(SAMPLE_OLD).length !== 2) return null;
  return text.replace(WS_OLD, () => WS_NEW).replace(SAMPLE_OLD, () => SAMPLE_NEW);
}

/** Treat ENOTDIR as a missing package. A check that is not resolvePackage is refused. */
export function enotdirNotFound(text: string): string | null {
  if (!text.includes("function resolvePackage(")) return null; // lp-guard:enotdir
  if (!text.includes(ENOT_OLD) || text.includes("ENOTDIR")) return null;
  if (text.split(ENOT_OLD).length !== 2) return null;
  return text.replace(ENOT_OLD, () => ENOT_NEW);
}

export interface Batch18Input {
  root: string;
  output: string;
  sourcePattern?: string;
  nodePath: string;
  nodeModules?: string | null;
  testCommand: readonly string[];
  bwrap?: string;
}

function readLocal(root: string, path: string): string | null {
  try { return readFileSync(join(root, path), "utf8"); } catch { return null; }
}

function filesOf(root: string, pattern: string | undefined): string[] {
  const listed = practiceGit(root, ["ls-files"]);
  if (!listed.ok) return [];
  return listed.out.split("\n").map((p) => p.trim()).filter((p) => /\.tsx?$/.test(p) && !p.endsWith(".d.ts") && (!pattern || new RegExp(pattern).test(p)));
}

/** Apply the one repair the failure can prove, then require the published test to pass in the sandbox. */
export function repairBatch18(input: Batch18Input): { diff: string; file: string } | null {
  if (!/Error|not equal|Expected|Invalid|fail|toBe|ENOTDIR|called/i.test(input.output)) return null;
  const edits: { path: string; next: string; original: string }[] = [];
  for (const path of filesOf(input.root, input.sourcePattern)) {
    const original = readLocal(input.root, path);
    if (original === null) continue;
    const next = skipInternalRoute(original) ?? indentFromContent(original) ?? enotdirNotFound(original);
    if (next && next !== original) edits.push({ path, next, original });
  }
  if (edits.length !== 1) return null;
  const edit = edits[0]!;
  try {
    writeFileSync(join(input.root, edit.path), edit.next);
    const again = runInPracticeSandbox(input.root, input.testCommand, 120_000, {
      capture: true, nodePath: input.nodePath, nodeModules: input.nodeModules, ...(input.bwrap ? { bwrap: input.bwrap } : {}),
    });
    if (again.unsafe || again.code !== 0) return null;
    const diff = practiceGit(input.root, ["diff", "--no-color", "--no-ext-diff", "--no-renames", "--", edit.path]);
    if (!diff.ok || !diff.out.trim()) return null;
    return { diff: diff.out, file: edit.path };
  } finally {
    writeFileSync(join(input.root, edit.path), edit.original);
  }
}
