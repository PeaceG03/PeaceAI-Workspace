// Three repairs for bugs the existing templates do not cover.
// A "$" in a subpath is a literal replacement, not a pattern.
// constructor.name is used only when it is a non-empty string, and each accessor is read once.
// A plain value is replaced when the incoming value is an object.
// Each edit is refused unless that exact shape is present. The published test must pass afterwards.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { practiceGit, runInPracticeSandbox } from "./practicemine.ts";

const DOLLAR_OLD = "\t\t\t? tmp.replace(rgx1, value)\n";
const DOLLAR_NEW = "\t\t\t? tmp.replace(rgx1, () => value)\n";

/** Treat "$" in a replacement as literal text. A check that is not injects is refused. */
export function literalDollar(text: string): string | null {
  if (!text.includes("export function injects(")) return null; // dollar-guard:literal
  if (!text.includes(DOLLAR_OLD) || text.includes(DOLLAR_NEW)) return null;
  if (text.split(DOLLAR_OLD).length !== 2) return null;
  return text.replace(DOLLAR_OLD, DOLLAR_NEW);
}

const NAME_OLD = "      if (value.constructor && value.constructor.name) {\n        return `an instance of ${value.constructor.name}`;\n      }\n";
const NAME_NEW = "      const name: unknown = value.constructor?.name;\n      if (typeof name === \"string\" && name !== \"\") {\n        return `an instance of ${name}`;\n      }\n";

/** Use constructor.name only when it is a non-empty string. A check that is not determineSpecificType is refused. */
export function constructorName(text: string): string | null {
  if (!text.includes("function determineSpecificType(")) return null; // name-guard:string
  if (!text.includes(NAME_OLD) || text.includes("const name: unknown = value.constructor?.name")) return null;
  if (text.split(NAME_OLD).length !== 2) return null;
  return text.replace(NAME_OLD, NAME_NEW);
}

const MERGE_OLD = "        // @ts-expect-error\n        deepMerge(target[key], source[key])\n";
const MERGE_NEW = "        // @ts-expect-error\n        if (isMergableObject(target[key])) {\n          // @ts-expect-error\n          deepMerge(target[key], source[key])\n        }\n        else {\n          // @ts-expect-error\n          target[key] = source[key]\n        }\n";

/** Replace a plain value when the incoming value is an object. A check that is not deepMerge is refused. */
export function plainMerge(text: string): string | null {
  if (!text.includes("export function deepMerge<")) return null; // merge-guard:plain
  if (!text.includes(MERGE_OLD) || text.includes("isMergableObject(target[key])")) return null;
  if (text.split(MERGE_OLD).length !== 2) return null;
  return text.replace(MERGE_OLD, MERGE_NEW);
}

export interface Batch12Input {
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
export function repairBatch12(input: Batch12Input): { diff: string; file: string } | null {
  if (!/Error|not equal|Expected|Invalid|fail/i.test(input.output)) return null;
  const edits: { path: string; next: string; original: string }[] = [];
  for (const path of filesOf(input.root, input.sourcePattern)) {
    const original = readLocal(input.root, path);
    if (original === null) continue;
    const next = literalDollar(original) ?? constructorName(original) ?? plainMerge(original);
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
