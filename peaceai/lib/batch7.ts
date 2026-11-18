// Three repairs for bugs the existing templates do not cover.
// A date parser rejects a separator or a trailing character the format does not describe.
// A non-Hangul character is appended, not composed into the previous syllable.
// Effects captured while a model factory throws are disposed, and the factory error stays.
// Each edit is refused unless that exact shape is present. The published test must pass afterwards.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { practiceGit, runInPracticeSandbox } from "./practicemine.ts";

const PARTS_LINE = "const formatParts = validate(parts(format, locale).filter(partFilter))";
const PARSE_CALL = "parsedParts = parseParts(dateStr, formatParts)";
const PARSE_SIG = "export function parseParts(dateStr: string, formatParts: Part[]): FilledPart[] {";
const PARSE_PUSH = "parsed.push({ ...current, value: dateStr.substring(pos, pos + len) })\n    pos += len\n  } while (n)\n  return parsed";

/** A format whose parts are all kept rejects a different separator and trailing text. A file that is not parseParts is refused. */
export function strictDateParse(text: string): string | null {
  if (!text.includes(PARSE_SIG)) return null; // parse-guard:literal
  if (text.includes("normalizeLiteral") || text.includes("strict = false")) return null;
  if (!text.includes(PARTS_LINE) || !text.includes(PARSE_CALL) || !text.includes(PARSE_PUSH)) return null;
  if (text.split(PARSE_CALL).length !== 2 || text.split(PARSE_PUSH).length !== 2) return null;
  const helper = `function normalizeLiteral(literal: string): string {\n  return literal.normalize("NFKC").replace(/\\s/g, " ").toLowerCase()\n}\n\n`;
  return text
    .replace(PARTS_LINE, "const allParts = parts(format, locale)\n  const formatParts = validate(allParts.filter(partFilter))")
    .replace(PARSE_CALL, "parsedParts = parseParts(\n      dateStr,\n      formatParts,\n      formatParts.length === allParts.length\n    )")
    .replace(PARSE_SIG, `${helper}export function parseParts(\n  dateStr: string,\n  formatParts: Part[],\n  strict = false\n): FilledPart[] {`)
    .replace(PARSE_PUSH, `const value = dateStr.substring(pos, pos + len)
    if (
      strict &&
      current.partName === "literal" &&
      normalizeLiteral(value) !== normalizeLiteral(current.partValue)
    ) {
      throw new Error()
    }
    parsed.push({ ...current, value })
    pos += len
  } while (n)
  if (strict && pos < dateStr.length) throw new Error()
  return parsed`);
}

const JOIN_BLANK = "const needJoinString = isBlank(lastCharacter) || isBlank(nextCharacter);";

/** A digit or symbol is kept as itself. A join that is not binaryAssemble is refused. */
export function keepForeignHangul(text: string): string | null {
  if (!text.includes("export function binaryAssemble(")) return null; // hangul-guard:assemble
  if (!text.includes(JOIN_BLANK) || text.includes("!(isHangulCharacter(lastCharacter)")) return null;
  if (text.split(JOIN_BLANK).length !== 2) return null;
  return text.replace(JOIN_BLANK, `const needJoinString =
    isBlank(lastCharacter) ||
    isBlank(nextCharacter) ||
    !(isHangulCharacter(lastCharacter) || isHangulAlphabet(lastCharacter)) ||
    !isHangulAlphabet(nextCharacter);`);
}

const MODEL_CATCH = [
  "\t\t} catch (err) {",
  "\t\t\t// Drop any captured effects on error. Errors from nested models will bubble",
  "\t\t\t// up here and recursively reset `capturedEffects` to `undefined` preventing",
  "\t\t\t// any captured effects from leaking",
  "\t\t\tcapturedEffects = undefined;",
  "\t\t\tthrow err;",
  "\t\t}",
].join("\n");

const MODEL_FIXED = [
  "\t\t} catch (err) {",
  "\t\t\tconst effects = capturedEffects;",
  "\t\t\tcapturedEffects = undefined;",
  "\t\t\tif (effects) {",
  "\t\t\t\ttry {",
  "\t\t\t\t\tbatch(() => {",
  "\t\t\t\t\t\tfor (let i = 0; i < effects.length; i++) {",
  "\t\t\t\t\t\t\ttry {",
  "\t\t\t\t\t\t\t\teffects[i].dispose();",
  "\t\t\t\t\t\t\t} catch { /* a dispose error must not hide the factory error */ }",
  "\t\t\t\t\t\t}",
  "\t\t\t\t\t});",
  "\t\t\t\t} catch { /* a dispose error must not hide the factory error */ }",
  "\t\t\t}",
  "\t\t\tthrow err;",
  "\t\t}",
].join("\n");

/** Effects started by a model factory that throws are disposed. A catch that is not createModel is refused. */
export function disposeFailedModel(text: string): string | null {
  if (!text.includes("function createModel<")) return null; // model-guard:dispose
  if (!text.includes(MODEL_CATCH) || text.includes("effects[i].dispose()")) return null;
  if (text.split(MODEL_CATCH).length !== 2) return null;
  return text.replace(MODEL_CATCH, MODEL_FIXED);
}

export interface Batch7Input {
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
export function repairBatch7(input: Batch7Input): { diff: string; file: string } | null {
  if (!/Error|not equal|Expected|Invalid|fail/i.test(input.output)) return null;
  const edits: { path: string; next: string; original: string }[] = [];
  for (const path of filesOf(input.root, input.sourcePattern)) {
    const original = readLocal(input.root, path);
    if (original === null) continue;
    const next = strictDateParse(original) ?? keepForeignHangul(original) ?? disposeFailedModel(original);
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
