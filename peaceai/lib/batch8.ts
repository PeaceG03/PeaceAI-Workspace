// Three repairs for bugs the existing templates do not cover.
// A parameter name followed by an astral ID_Continue character is quoted.
// An array-difference key is any non-function, not only a string.
// getOffsetForIndex reads measurements rebuilt after the last size change.
// Each edit is refused unless that exact shape is present. The published test must pass afterwards.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { practiceGit, runInPracticeSandbox } from "./practicemine.ts";

const SURROGATE = `  if (next?.type === "text" && ID_CONTINUE.test(next.value[0])) {\n    return quoteName(name);\n  }`;
const CODE_POINT = `  if (next?.type === "text") {\n    const [first = ""] = next.value;\n    if (ID_CONTINUE.test(first)) return quoteName(name);\n  }`;

/** Quote a name when the next text starts with an ID_Continue code point, including astral characters. */
export function quoteAstralName(text: string): string | null {
  if (!text.includes("function stringifyName(")) return null; // name-guard:astral
  if (!text.includes(SURROGATE) || text.includes('const [first = ""] = next.value')) return null;
  if (text.split(SURROGATE).length !== 2) return null;
  return text.replace(SURROGATE, CODE_POINT);
}

const STRING_KEY = "if (typeof compareFn === 'string') {";
const ANY_KEY = "if (typeof compareFn !== 'function') {";

/** A number or symbol key is a property name. A check that is not useArrayDifference is refused. */
export function compareAnyKey(text: string): string | null {
  if (!text.includes("export function useArrayDifference")) return null; // key-guard:function
  if (!text.includes(STRING_KEY) || text.includes(ANY_KEY)) return null;
  if (text.split(STRING_KEY).length !== 2) return null;
  return text.replace(STRING_KEY, ANY_KEY);
}

const STALE = "    const size = this.getSize()\n    const scrollOffset = this.getScrollOffset()\n\n    const item = this.measurementsCache[index]";
const FRESH = "    const size = this.getSize()\n    const scrollOffset = this.getScrollOffset()\n\n    const item = this.getMeasurements()[index]";

/** The offset for an index uses measurements rebuilt after the last size change. */
export function freshMeasurements(text: string): string | null {
  if (!text.includes("getOffsetForIndex =")) return null; // offset-guard:fresh
  if (!text.includes(STALE) || text.includes("this.getMeasurements()[index]")) return null;
  if (text.split(STALE).length !== 2) return null;
  return text.replace(STALE, FRESH);
}

export interface Batch8Input {
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
export function repairBatch8(input: Batch8Input): { diff: string; file: string } | null {
  if (!/Error|not equal|Expected|Invalid|fail/i.test(input.output)) return null;
  const edits: { path: string; next: string; original: string }[] = [];
  for (const path of filesOf(input.root, input.sourcePattern)) {
    const original = readLocal(input.root, path);
    if (original === null) continue;
    const next = quoteAstralName(original) ?? compareAnyKey(original) ?? freshMeasurements(original);
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
