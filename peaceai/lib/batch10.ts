// Three repairs for bugs the existing templates do not cover.
// A bracketed IPv6 host stays one host.
// A YAML merge source is resolved before it is copied, so a circular map stays a plain object.
// CSS identifier characters that end a selector are escaped.
// Each edit is refused unless that exact shape is present. The published test must pass afterwards.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { practiceGit, runInPracticeSandbox } from "./practicemine.ts";

const HOST = String.raw`const urlRegex = /^([\w+.-]+:)\/\/([^@/#?]*@)?([^:/#?]*)(:\d+)?(\/[^#?]*)?(\?[^#]*)?(#.*)?/;`;
const HOST_V6 = String.raw`const urlRegex =
  /^([\w+.-]+:)\/\/([^@/#?]*@)?(\[[^\]]+\]|[^:/#?]*)(:\d+)?(\/[^#?]*)?(\?[^#]*)?(#.*)?/;`;

/** Keep a bracketed IPv6 literal in the host. A check that is not resolve is refused. */
export function bracketHost(text: string): string | null {
  if (!text.includes("export default function resolve(")) return null; // host-guard:bracket
  if (!text.includes(HOST) || text.includes(String.raw`\[[^\]]+\]`)) return null;
  if (text.split(HOST).length !== 2) return null;
  return text.replace(HOST, HOST_V6);
}

const MERGE_IMPORT = "import type { MapLike, YAMLMap } from '../../nodes/YAMLMap.ts'";
const MERGE_IMPORT_VALUE = "import { type MapLike, YAMLMap } from '../../nodes/YAMLMap.ts'";
const MERGE_LOOP = `  const source = getMergeSource(doc, ctx, value)
  if (Array.isArray(source)) {
    for (const it of source) mergeValue(doc, ctx, map, it, isPlainObject)
  } else {
    mergeValue(doc, ctx, map, value, isPlainObject)
  }`;
const MERGE_LOOP_FRESH = `  const source = getMergeSource(doc, ctx, value)
  if (Array.isArray(source)) {
    for (const v of source) {
      const s = getMergeSource(doc, ctx, v)
      mergeValue(doc, ctx, map, s, isPlainObject)
    }
  } else {
    mergeValue(doc, ctx, map, source, isPlainObject)
  }`;
const MERGE_VALUE = `  value: unknown,
  isPlainObject: boolean
) {
  const source = getMergeSource(doc, ctx, value)
  const srcMap = (source as YAMLMap).toJS(doc, ctx, Map<any, any>)
  if (!(srcMap instanceof Map))
    throw new Error('Merge sources must be maps or map aliases')
  for (const [key, value] of srcMap) {`;
const MERGE_VALUE_FRESH = `  source: unknown,
  isPlainObject: boolean
) {
  if (!(source instanceof YAMLMap))
    throw new Error('Merge sources must be maps or map aliases')
  const srcMap = source.toJS(doc, ctx)
  const srcIter = srcMap instanceof Map ? srcMap : Object.entries(srcMap)
  for (const [key, value] of srcIter) {`;

/** Resolve a merge source before copying it. A check that is not MergeKey is refused. */
export function resolveMerge(text: string): string | null {
  if (!text.includes("export class MergeKey")) return null; // merge-guard:resolve
  if (!text.includes(MERGE_IMPORT) || !text.includes(MERGE_LOOP) || !text.includes(MERGE_VALUE)) return null;
  if (text.includes("source instanceof YAMLMap")) return null;
  if (text.split(MERGE_IMPORT).length !== 2 || text.split(MERGE_LOOP).length !== 2 || text.split(MERGE_VALUE).length !== 2) return null;
  return text.replace(MERGE_IMPORT, MERGE_IMPORT_VALUE).replace(MERGE_LOOP, MERGE_LOOP_FRESH).replace(MERGE_VALUE, MERGE_VALUE_FRESH);
}

const NAME_CHARS = `        "/",
        ",",
        ";",
    ].map((c) => c.charCodeAt(0)),`;
const NAME_CHARS_MORE = `        "/",
        ",",
        ";",
        "=",
        "&",
        "?",
        "@",
        "\`",
        "{",
        "}",
    ].map((c) => c.charCodeAt(0)),`;

/** Escape selector characters in a CSS identifier. A check that is not stringify is refused. */
export function escapeIdent(text: string): string | null {
  if (!text.includes("export function stringify(")) return null; // ident-guard:escape
  if (!text.includes(NAME_CHARS) || text.includes(`        "=",`)) return null;
  if (text.split(NAME_CHARS).length !== 2) return null;
  return text.replace(NAME_CHARS, NAME_CHARS_MORE);
}

export interface Batch10Input {
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
export function repairBatch10(input: Batch10Input): { diff: string; file: string } | null {
  if (!/Error|not equal|Expected|Invalid|fail/i.test(input.output)) return null;
  const edits: { path: string; next: string; original: string }[] = [];
  for (const path of filesOf(input.root, input.sourcePattern)) {
    const original = readLocal(input.root, path);
    if (original === null) continue;
    const next = bracketHost(original) ?? resolveMerge(original) ?? escapeIdent(original);
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
