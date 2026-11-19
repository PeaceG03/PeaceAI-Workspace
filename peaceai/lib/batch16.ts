// Three repairs for bugs the existing templates do not cover.
// A negative or zero import priority stays below the default of 1.
// An invalid compatibility date becomes an empty string, including a default.
// `--recreateLockfile=false` is the boolean false, not the string "false".
// Each edit is refused unless that exact shape is present. The published test must pass afterwards.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { practiceGit, runInPracticeSandbox } from "./practicemine.ts";

const PRIORITY_OLD = `        if ((currImp.priority || 1) > (prevImp.priority || 1)) {
          deduped.delete(name)
          deduped.set(name, currImp)
        }
      }
      else {
        // currImp and prevImp are complementary imports; one for the value and one for the type
        const altName = encodeImportName(name)
        const prevImpComplement = deduped.get(altName)
        if (!prevImpComplement) {
          deduped.set(altName, currImp)
        }
        else if ((currImp.priority || 1) > (prevImpComplement.priority || 1)) {
          deduped.delete(altName)
          deduped.set(altName, currImp)
        }
      }
      continue
    }

    // currImp and prevImp are duplicate imports
    const altName = encodeImportName(name)
    const prevImpComplement = deduped.get(altName)
    const priorityDiff = (currImp.priority || 1) - Math.max(prevImp.priority || 1, prevImpComplement?.priority || 1)
`;
const PRIORITY_NEW = `        if ((currImp.priority ?? 1) > (prevImp.priority ?? 1)) {
          deduped.delete(name)
          deduped.set(name, currImp)
        }
      }
      else {
        // currImp and prevImp are complementary imports; one for the value and one for the type
        const altName = encodeImportName(name)
        const prevImpComplement = deduped.get(altName)
        if (!prevImpComplement) {
          deduped.set(altName, currImp)
        }
        else if ((currImp.priority ?? 1) > (prevImpComplement.priority ?? 1)) {
          deduped.delete(altName)
          deduped.set(altName, currImp)
        }
      }
      continue
    }

    // currImp and prevImp are duplicate imports
    const altName = encodeImportName(name)
    const prevImpComplement = deduped.get(altName)
    const prevPriority = prevImpComplement
      ? Math.max(prevImp.priority ?? 1, prevImpComplement.priority ?? 1)
      : prevImp.priority ?? 1
    const priorityDiff = (currImp.priority ?? 1) - prevPriority
`;

/** Keep a negative or zero priority below the default. A check that is not dedupeImports is refused. */
export function negativePriority(text: string): string | null {
  if (!text.includes("export function dedupeImports(")) return null; // ui-guard:priority
  if (!text.includes(PRIORITY_OLD) || text.includes("prevPriority")) return null;
  if (text.split(PRIORITY_OLD).length !== 2) return null;
  return text.replace(PRIORITY_OLD, () => PRIORITY_NEW);
}

const FORMAT_OLD = `export function formatDate(date: string | Date): DateString {
  const d = normalizeDate(date);
  const year = d.getFullYear().toString();`;
const FORMAT_NEW = `export function formatDate(date: string | Date): DateString {
  const d = normalizeDate(date);
  if (Number.isNaN(d.getDate())) {
    return "";
  }
  const year = d.getFullYear().toString();`;
const INIT_OLD = `  const dates: CompatibilityDates = { ...(defaults as CompatibilityDates) };

  // Add normalized input values`;
const INIT_NEW = `  const dates: CompatibilityDates = { ...(defaults as CompatibilityDates) };

  // Normalize default date
  dates.default = formatDate(dates.default || "");

  // Add normalized input values`;
const FALLBACK_OLD = `  // Ensure default date is set
  if (!dates.default) {
    dates.default = "";
  }

`;

/** An invalid date is empty, and a default is normalized too. A check that is not formatDate is refused. */
export function emptyInvalidDate(text: string): string | null {
  if (!text.includes("export function formatDate(")) return null; // cx-guard:date
  if (!text.includes(FORMAT_OLD) || !text.includes(INIT_OLD) || !text.includes(FALLBACK_OLD)) return null;
  if (text.includes("Number.isNaN(d.getDate())")) return null;
  if (text.split(FORMAT_OLD).length !== 2 || text.split(FALLBACK_OLD).length !== 2) return null;
  return text.replace(FORMAT_OLD, () => FORMAT_NEW).replace(INIT_OLD, () => INIT_NEW).replace(FALLBACK_OLD, () => "");
}

const LOCK_OLD = `    if (args.recreateLockFile !== undefined) args.recreateLockfile ??= args.recreateLockFile;
`;
const LOCK_NEW = `    if (args.recreateLockFile !== undefined) args.recreateLockfile ??= args.recreateLockFile;
    if (args.recreateLockfile === "false") args.recreateLockfile = false;
`;

/** A string "false" is not a request to recreate the lockfile. A check that is not the dedupe command is refused. */
export function falseLockfile(text: string): string | null {
  if (!text.includes("const dedupe = defineCommand(")) return null; // np-guard:false
  if (!text.includes(LOCK_OLD) || text.includes('args.recreateLockfile === "false"')) return null;
  if (text.split(LOCK_OLD).length !== 2) return null;
  return text.replace(LOCK_OLD, () => LOCK_NEW);
}

export interface Batch16Input {
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
export function repairBatch16(input: Batch16Input): { diff: string; file: string } | null {
  if (!/Error|not equal|Expected|Invalid|fail|toBe|snapshot/i.test(input.output)) return null;
  const edits: { path: string; next: string; original: string }[] = [];
  for (const path of filesOf(input.root, input.sourcePattern)) {
    const original = readLocal(input.root, path);
    if (original === null) continue;
    const next = negativePriority(original) ?? emptyInvalidDate(original) ?? falseLockfile(original);
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
