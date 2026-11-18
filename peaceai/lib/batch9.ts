// Three repairs for bugs the existing templates do not cover.
// A signless integer after An is rejected.
// nsecs that overflow time_low are carried into the high half of a v1 timestamp.
// update checks a split range before it edits, so a throw leaves the string unchanged.
// Each edit is refused unless that exact shape is present. The published test must pass afterwards.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { practiceGit, runInPracticeSandbox } from "./practicemine.ts";

const OPEN = "        if (index < formula.length) {\n            sign = readSign();";
const SIGNED = "        if (index < formula.length) {\n            const signChar = formula.charAt(index);\n            if (signChar !== \"+\" && signChar !== \"-\") {\n                throw new Error(`n-th rule couldn't be parsed ('${formula}')`);\n            }\n\n            sign = readSign();";

/** Reject a signless integer after An. A check that is not parse is refused. */
export function rejectSignless(text: string): string | null {
  if (!text.includes("export function parse(")) return null; // sign-guard:mandatory
  if (!text.includes(OPEN) || text.includes("signChar !== \"+\"")) return null;
  if (text.split(OPEN).length !== 2) return null;
  return text.replace(OPEN, SIGNED);
}

const LOW = "  const tl = ((msecs & 0xfffffff) * 10000 + nsecs) % 0x100000000;";
const LOW_CARRY = "  const t = (msecs & 0xfffffff) * 10000 + nsecs;\n  const tl = t >>> 0;";
const MID = "  const tmh = ((msecs / 0x100000000) * 10000) & 0xfffffff;";
const MID_CARRY = "  const tmh = (((msecs / 0x10000000) | 0) * 625 + ((t / 0x100000000) | 0)) & 0xfffffff;";

/** Carry nsecs out of time_low into the high half of the timestamp. A check that is not v1Bytes is refused. */
export function carryNsecs(text: string): string | null {
  if (!text.includes("function v1Bytes(")) return null; // carry-guard:nsecs
  if (!text.includes(LOW) || !text.includes(MID) || text.includes("const t = (msecs & 0xfffffff) * 10000 + nsecs;")) return null;
  if (text.split(LOW).length !== 2 || text.split(MID).length !== 2) return null;
  return text.replace(LOW, LOW_CARRY).replace(MID, MID_CARRY);
}

const MUTABLE = `      let chunk = first
      while (chunk !== last) {
        if (chunk.next !== this.byStart.get(chunk.end)) {
          throw new MagicStringError('cannot overwrite across a split point')
        }
        chunk = chunk.next
        // \`first\` takes the replacement and the rest of the range is emptied.
        // Unless overwriting, inserts on these chunks are kept as they are on
        // \`first\`, so the result does not depend on where the range was split
        chunk.edit('', false, !overwrite)
      }`;
const ATOMIC = `      let chunk = first
      while (chunk !== last) {
        if (chunk.next !== this.byStart.get(chunk.end)) {
          throw new MagicStringError('cannot overwrite across a split point')
        }
        chunk = chunk.next
      }

      chunk = first
      while (chunk !== last) {
        chunk = chunk.next
        // \`first\` takes the replacement and the rest of the range is emptied.
        // Unless overwriting, inserts on these chunks are kept as they are on
        // \`first\`, so the result does not depend on where the range was split
        chunk.edit('', false, !overwrite)
      }`;

/** Check the whole range before editing it. A check that is not update is refused. */
export function atomicUpdate(text: string): string | null {
  if (!text.includes("update(start: number, end: number, content: string")) return null; // split-guard:atomic
  if (!text.includes(MUTABLE) || text.includes("      chunk = first\n      while (chunk !== last) {\n        chunk = chunk.next\n")) return null;
  if (text.split(MUTABLE).length !== 2) return null;
  return text.replace(MUTABLE, ATOMIC);
}

export interface Batch9Input {
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
export function repairBatch9(input: Batch9Input): { diff: string; file: string } | null {
  if (!/Error|not equal|Expected|Invalid|fail/i.test(input.output)) return null;
  const edits: { path: string; next: string; original: string }[] = [];
  for (const path of filesOf(input.root, input.sourcePattern)) {
    const original = readLocal(input.root, path);
    if (original === null) continue;
    const next = rejectSignless(original) ?? carryNsecs(original) ?? atomicUpdate(original);
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
