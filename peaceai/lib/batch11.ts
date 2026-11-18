// Three repairs for bugs the existing templates do not cover.
// %i is a digit placeholder, the same as %d.
// A source-map sourceRoot is prefixed before the source is resolved against the map URL.
// A non-positive query limit returns no nodes and does not call the predicate.
// Each edit is refused unless that exact shape is present. The published test must pass afterwards.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { practiceGit, runInPracticeSandbox } from "./practicemine.ts";

const DIGITS = String.raw`const POSITIONALS_EXP = /(%?)(%([sdjo]))/g`;
const DIGITS_I = String.raw`const POSITIONALS_EXP = /(%?)(%([sdijo]))/g`;

/** Treat %i as a digit placeholder. A check that is not format is refused. */
export function digitToken(text: string): string | null {
  if (!text.includes("export function format(")) return null; // digit-guard:token
  if (!text.includes(DIGITS) || text.includes(DIGITS_I)) return null;
  if (text.split(DIGITS).length !== 2) return null;
  return text.replace(DIGITS, DIGITS_I);
}

const DIRECT = `export default function resolve(input: string, base: string | undefined): string {
  // The base is always treated as a directory, if it's not empty.
  // https://github.com/mozilla/source-map/blob/8cb3ee57/lib/util.js#L327
  // https://github.com/chromium/chromium/blob/da4adbb3/third_party/blink/renderer/devtools/front_end/sdk/SourceMap.js#L400-L401
  if (base && !base.endsWith('/')) base += '/';

  return resolveUri(input, base);
}`;
const PREFIXED = `import stripFilename from './strip-filename';

type Resolve = (source: string | null) => string;
export default function resolver(
  mapUrl: string | null | undefined,
  sourceRoot: string | undefined,
): Resolve {
  const from = stripFilename(mapUrl);
  // The sourceRoot is always treated as a directory, if it's not empty.
  // https://github.com/mozilla/source-map/blob/8cb3ee57/lib/util.js#L327
  // https://github.com/chromium/chromium/blob/da4adbb3/third_party/blink/renderer/devtools/front_end/sdk/SourceMap.js#L400-L401
  const prefix = sourceRoot ? sourceRoot + '/' : '';

  return (source) => resolveUri(prefix + (source || ''), from);
}`;

/** Prefix sourceRoot, then resolve against the map URL. A check that is not the resolve-uri import is refused. */
export function prefixSourceRoot(text: string): string | null {
  if (!text.includes("from '@jridgewell/resolve-uri'")) return null; // root-guard:prefix
  if (!text.includes(DIRECT) || text.includes("function resolver(")) return null;
  if (text.split(DIRECT).length !== 2) return null;
  return text.replace(DIRECT, PREFIXED);
}

const OPEN_LIMIT = "    const result: AnyNode[] = [];\n";
const CLOSED_LIMIT = "    const result: AnyNode[] = [];\n    if (limit <= 0) return result;\n";

/** A non-positive limit matches nothing. A check that is not find is refused. */
export function zeroLimit(text: string): string | null {
  if (!text.includes("export function find(")) return null; // limit-guard:zero
  if (!text.includes(OPEN_LIMIT) || text.includes("if (limit <= 0) return result;")) return null;
  if (text.split(OPEN_LIMIT).length !== 2) return null;
  return text.replace(OPEN_LIMIT, CLOSED_LIMIT);
}

export interface Batch11Input {
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
export function repairBatch11(input: Batch11Input): { diff: string; file: string } | null {
  if (!/Error|not equal|Expected|Invalid|fail/i.test(input.output)) return null;
  const edits: { path: string; next: string; original: string }[] = [];
  for (const path of filesOf(input.root, input.sourcePattern)) {
    const original = readLocal(input.root, path);
    if (original === null) continue;
    const next = digitToken(original) ?? prefixSourceRoot(original) ?? zeroLimit(original);
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
