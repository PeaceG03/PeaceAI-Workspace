// Three repairs for bugs the existing templates do not cover.
// A module augmentation joins interfaces with newlines, not commas.
// A hook list is copied before dispatch when the same file can splice it.
// tryUse returns null when no context is set, and keeps 0, "", and false.
// Each edit is refused unless that exact shape is present. The published test must pass afterwards.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { practiceGit, runInPracticeSandbox } from "./practicemine.ts";

const AUG_CLOSE = "    ),\n  )}`;";

/** Interface lines inside `declare module` are separated by newlines. A call that is not that generator is refused. */
export function plainAugmentation(text: string): string | null {
  if (!text.includes("export function genAugmentation(")) return null; // aug-guard:module
  if (!text.includes("wrapInDelimiters(") || !text.includes(AUG_CLOSE) || text.includes("\n    false,\n  )}`;")) return null;
  if (text.split(AUG_CLOSE).length !== 2) return null;
  return text.replace(AUG_CLOSE, "    ),\n    undefined,\n    undefined,\n    false,\n  )}`;");
}

const RAW_CALL = "return callHooks(hooks, args, 0);";

/** The list passed to dispatch is a copy, so a hook that removes itself does not skip the next one. */
export function copyHooksBeforeCall(text: string): string | null {
  if (!text.includes("hooks.splice(index, 1)")) return null; // hook-guard:splice
  if (!text.includes(RAW_CALL) || text.includes("hooks.slice()")) return null;
  if (text.split(RAW_CALL).length !== 2) return null;
  return text.replace(RAW_CALL, "return callHooks(hooks.slice(), args, 0);");
}

const RAW_USE = "return _getCurrentInstance();";

/** No current context is null. A stored 0, empty string, or false stays itself. */
export function nullTryUse(text: string): string | null {
  if (!text.includes("tryUse: () =>")) return null; // ctx-guard:tryuse
  if (!text.includes(RAW_USE) || text.includes("?? null")) return null;
  if (text.split(RAW_USE).length !== 2) return null;
  return text.replace(RAW_USE, "return _getCurrentInstance() ?? null;");
}

export interface Batch6Input {
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
export function repairBatch6(input: Batch6Input): { diff: string; file: string } | null {
  if (!/Error|not equal|Expected|Invalid|fail/i.test(input.output)) return null;
  const edits: { path: string; next: string; original: string }[] = [];
  for (const path of filesOf(input.root, input.sourcePattern)) {
    const original = readLocal(input.root, path);
    if (original === null) continue;
    const next = plainAugmentation(original) ?? copyHooksBeforeCall(original) ?? nullTryUse(original);
    if (next && next !== original) edits.push({ path, next, original });
  }
  if (edits.length !== 1) return null;
  const edit = edits[0]!;
  try {
    writeFileSync(join(input.root, edit.path), edit.next);
    const again = runInPracticeSandbox(input.root, input.testCommand, 60_000, {
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
