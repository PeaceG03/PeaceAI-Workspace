// Three repairs for bugs the existing templates do not cover.
// Space-separated rgb() may mix numbers and percentages. Comma syntax still may not.
// A non-empty allowElements list drops every other element.
// An unsafe integer written with a decimal point or an exponent is not a safe number.
// Each edit is refused unless that exact shape is present. The published test must pass afterwards.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { practiceGit, runInPracticeSandbox } from "./practicemine.ts";

const RGB_OLD = "  const match = commaRgbaMatcher.exec(input) || spaceRgbaMatcher.exec(input);\n\n  if (!match) return null;\n\n  // Mixing numbers and percentages is not allowed\n  // https://developer.mozilla.org/en-US/docs/Web/CSS/color_value#rgb_syntax_variations\n  if (match[2] !== match[4] || match[4] !== match[6]) return null;\n\n";
const RGB_NEW = "  const commaMatch = commaRgbaMatcher.exec(input);\n\n  // Only the legacy comma syntax forbids mixing numbers and percentages\n  // https://www.w3.org/TR/css-color-4/#rgb-functions\n  if (commaMatch && (commaMatch[2] !== commaMatch[4] || commaMatch[4] !== commaMatch[6]))\n    return null;\n\n  const match = commaMatch || spaceRgbaMatcher.exec(input);\n\n  if (!match) return null;\n\n";

/** Allow mixed numbers and percentages only in space-separated rgb(). A check that is not parseRgbaString is refused. */
export function mixedRgb(text: string): string | null {
  if (!text.includes("export const parseRgbaString")) return null; // rgb-guard:space
  if (!text.includes(RGB_OLD) || text.includes("const commaMatch = commaRgbaMatcher")) return null;
  if (text.split(RGB_OLD).length !== 2) return null;
  return text.replace(RGB_OLD, RGB_NEW);
}

const SAN_OLD = "  if (kind === \"custom-element\" && !sanitize.allowCustomElements) return \"drop\";\n  return \"allow\";\n}\n";
const SAN_NEW = "  if (kind === \"custom-element\" && !sanitize.allowCustomElements) return \"drop\";\n\n  return (sanitize.allowElements?.length > 0) ? 'drop' : 'allow';\n}\n";

/** A non-empty allow list drops every other element. A check that is not getAction is refused. */
export function allowList(text: string): string | null {
  if (!text.includes("function getAction(")) return null; // allow-guard:list
  if (!text.includes(SAN_OLD) || text.includes("? 'drop' : 'allow'")) return null;
  if (text.split(SAN_OLD).length !== 2) return null;
  return text.replace(SAN_OLD, SAN_NEW);
}

const SAFE_OLD = "  const num = Number.parseFloat(value)\n  const parsed = String(num)\n\n  if (value === parsed) {\n    return true\n  }\n\n  const valueDigits = extractSignificantDigits(value)\n  const parsedDigits = extractSignificantDigits(parsed)\n\n  if (valueDigits === parsedDigits) {\n    return true\n  }\n\n  if (config?.approx === true) {\n    // A value is approximately equal when:\n    // 1. it is a floating point number, not an integer\n    // 2. it has at least 14 digits\n    // 3. the first 14 digits are equal\n    const requiredDigits = 14\n    if (\n      !isInteger(value) &&\n      parsedDigits.length >= requiredDigits &&\n      valueDigits.startsWith(parsedDigits.substring(0, requiredDigits))\n    ) {\n      return true\n    }\n  }\n\n";
const SAFE_NEW = "  const num = Number.parseFloat(value)\n  // Reject unsafe integers written as floats, like '9007199254740992.0', which isInteger(value) misses.\n  if (Number.isInteger(num) && !Number.isSafeInteger(num)) {\n    return false\n  }\n  const parsed = String(num)\n\n  if (value === parsed) {\n    return true\n  }\n\n  const valueDigits = extractSignificantDigits(value)\n  const parsedDigits = extractSignificantDigits(parsed)\n\n  if (valueDigits === parsedDigits) {\n    return true\n  }\n\n  if (config?.approx === true) {\n    // A floating point value is approximately equal when:\n    // 1. it has at least 14 digits\n    // 2. the first 14 digits are equal\n    const requiredDigits = 14\n    if (\n      parsedDigits.length >= requiredDigits &&\n      valueDigits.startsWith(parsedDigits.substring(0, requiredDigits))\n    ) {\n      return true\n    }\n  }\n\n";

/** Reject an unsafe integer written as a float. A check that is not isSafeNumber is refused. */
export function unsafeFloat(text: string): string | null {
  if (!text.includes("export function isSafeNumber(")) return null; // safe-guard:float
  if (!text.includes(SAFE_OLD) || text.includes("!Number.isSafeInteger(num)")) return null;
  if (text.split(SAFE_OLD).length !== 2) return null;
  return text.replace(SAFE_OLD, SAFE_NEW);
}

export interface Batch13Input {
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
export function repairBatch13(input: Batch13Input): { diff: string; file: string } | null {
  if (!/Error|not equal|Expected|Invalid|fail/i.test(input.output)) return null;
  const edits: { path: string; next: string; original: string }[] = [];
  for (const path of filesOf(input.root, input.sourcePattern)) {
    const original = readLocal(input.root, path);
    if (original === null) continue;
    const next = mixedRgb(original) ?? allowList(original) ?? unsafeFloat(original);
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
