// Four repairs for bugs the existing templates do not cover.
// A prototype-less object is compared with hasOwn and a comparable string.
// A timer delay above the 32-bit limit is split into chunks.
// The constructor accepts the class_only shallow-copy mode.
// A trailing comma is stripped only after a value, so a parent's comma stays.
// Each edit is refused unless that exact shape is present. The published test must pass afterwards.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { practiceGit, runInPracticeSandbox } from "./practicemine.ts";

const LOOSE_IMPORT_OLD = "import { isArray, isDate, isMap, isObject, isSet, isSymbol } from './general'\n";
const LOOSE_IMPORT_NEW = "import {\n  hasOwn,\n  isArray,\n  isDate,\n  isMap,\n  isObject,\n  isSet,\n  isSymbol,\n  toTypeString,\n} from './general'\n";
const LOOSE_LOOP_OLD = "  for (const key in a) {\n    const aHasKey = a.hasOwnProperty(key)\n    const bHasKey = b.hasOwnProperty(key)\n    if (\n      (aHasKey && !bHasKey) ||\n      (!aHasKey && bHasKey) ||\n      !looseEqual(a[key], b[key], seen)\n    ) {\n      return false\n    }\n  }\n  return String(a) === String(b)\n";
const LOOSE_LOOP_NEW = "  for (const key in a) {\n    const aHasKey = hasOwn(a, key)\n    const bHasKey = hasOwn(b, key)\n    if (\n      (aHasKey && !bHasKey) ||\n      (!aHasKey && bHasKey) ||\n      !looseEqual(a[key], b[key], seen)\n    ) {\n      return false\n    }\n  }\n  return toComparableString(a) === toComparableString(b)\n";
const LOOSE_HELPER = "function toComparableString(value: any): string {\n  // Only supply a default for prototype-less objects without conversion methods.\n  return Object.getPrototypeOf(value) === null &&\n    value[Symbol.toPrimitive] == null &&\n    typeof value.toString !== 'function' &&\n    typeof value.valueOf !== 'function'\n    ? toTypeString(value)\n    : String(value)\n}\n";

/** Compare a prototype-less object without calling a missing method. A check that is not looseEqual is refused. */
export function prototypeLoose(text: string): string | null {
  if (!text.includes("export function looseEqual(")) return null; // loose-guard:prototype
  if (!text.includes(LOOSE_IMPORT_OLD) || text.includes("function toComparableString(")) return null;
  if (text.split(LOOSE_IMPORT_OLD).length !== 2) return null;
  if (!text.includes(LOOSE_LOOP_OLD) || text.includes("toComparableString(a)")) return null;
  if (text.split(LOOSE_LOOP_OLD).length !== 2) return null;
  return text.replace(LOOSE_IMPORT_OLD, LOOSE_IMPORT_NEW).replace(LOOSE_LOOP_OLD, LOOSE_LOOP_NEW) + "\n" + LOOSE_HELPER;
}

const TIMER_ANCHOR_OLD = "// --- Internal helpers ---\n\nfunction _clearTimer";
const TIMER_ANCHOR_NEW = "// --- Internal helpers ---\n\nconst MAX_TIMER_DELAY = 2 ** 31 - 1;\n\nfunction _clearTimer";
const TIMER_FN_OLD = "function _scheduleExpiry(\n  data: Map<string, any>,\n  timers: Map<string, ReturnType<typeof setTimeout>>,\n  key: string,\n  ttl?: number,\n) {\n  if (!ttl) {\n    return;\n  }\n  const ttlMs = ttl * 1000;\n  const timer = setTimeout(() => {\n    data.delete(key);\n    timers.delete(key);\n  }, ttlMs);\n  if (timer && typeof timer === \"object\" && \"unref\" in timer) {\n    timer.unref();\n  }\n  timers.set(key, timer);\n}\n";
const TIMER_FN_NEW = "function _scheduleExpiry(\n  data: Map<string, any>,\n  timers: Map<string, ReturnType<typeof setTimeout>>,\n  key: string,\n  ttl?: number,\n) {\n  if (!ttl || !Number.isFinite(ttl)) {\n    return;\n  }\n  // Delays above MAX_TIMER_DELAY overflow to 1ms, so long TTLs are split into chunks\n  let remaining = ttl * 1000;\n  const schedule = () => {\n    const delay = Math.min(remaining, MAX_TIMER_DELAY);\n    remaining -= delay;\n    const timer = setTimeout(() => {\n      if (remaining > 0) {\n        schedule();\n        return;\n      }\n      data.delete(key);\n      timers.delete(key);\n    }, delay);\n    if (timer && typeof timer === \"object\" && \"unref\" in timer) {\n      timer.unref();\n    }\n    timers.set(key, timer);\n  };\n  schedule();\n}\n";

/** Split a timer delay that would overflow a 32-bit integer. A check that is not the memory driver is refused. */
export function timerChunk(text: string): string | null {
  if (!text.includes("const DRIVER_NAME = \"memory\"")) return null; // timer-guard:chunk
  if (!text.includes(TIMER_ANCHOR_OLD) || text.includes("const MAX_TIMER_DELAY")) return null;
  if (text.split(TIMER_ANCHOR_OLD).length !== 2) return null;
  if (!text.includes(TIMER_FN_OLD) || text.includes("Number.isFinite(ttl)")) return null;
  if (text.split(TIMER_FN_OLD).length !== 2) return null;
  return text.replace(TIMER_ANCHOR_OLD, TIMER_ANCHOR_NEW).replace(TIMER_FN_OLD, TIMER_FN_NEW);
}

const CLASS_OLD = "\t\tif (isBoolean(config?.useStrictShallowCopy))\n\t\t\tthis.setUseStrictShallowCopy(config!.useStrictShallowCopy)\n";
const CLASS_NEW = "\t\tconst strictShallowCopy = config?.useStrictShallowCopy\n\t\tif (isBoolean(strictShallowCopy) || strictShallowCopy === \"class_only\")\n\t\t\tthis.setUseStrictShallowCopy(strictShallowCopy)\n";

/** Honor class_only when it is passed to the constructor. A check that is not the Immer class is refused. */
export function classOnlyCopy(text: string): string | null {
  if (!text.includes("export class Immer ")) return null; // class-guard:option
  if (!text.includes(CLASS_OLD) || text.includes("strictShallowCopy === \"class_only\"")) return null;
  if (text.split(CLASS_OLD).length !== 2) return null;
  return text.replace(CLASS_OLD, CLASS_NEW);
}

const COMMA_OBJECT_OLD = "        } else {\n          processedComma = true\n          initial = false\n        }\n\n        skipEllipsis()\n\n        const processedKey = parseString() || parseUnquotedString(true)\n        if (!processedKey) {\n          if (\n            text[i] === '}' ||\n            text[i] === '{' ||\n            text[i] === ']' ||\n            text[i] === '[' ||\n            text[i] === undefined\n          ) {\n            // repair trailing comma\n            output = stripLastOccurrence(output, ',')\n          } else {\n            throwObjectKeyExpected()\n          }\n          break\n        }\n\n        parseWhitespaceAndSkipComments()\n        const processedColon = parseCharacter(':')\n        const truncatedText = i >= text.length\n        if (!processedColon) {\n          if (isStartOfValue(text[i]) || truncatedText) {\n            // repair missing colon\n            output = insertBeforeLastWhitespace(output, ':')\n          } else {\n            throwColonExpected()\n          }\n        }\n        const processedValue = parseValue()\n        if (!processedValue) {\n          if (processedColon || truncatedText) {\n            // repair missing object value\n            output += 'null'\n          } else {\n            throwColonExpected()\n          }\n        }\n      }\n";
const COMMA_OBJECT_NEW = "        } else {\n          processedComma = true\n        }\n\n        skipEllipsis()\n\n        const processedKey = parseString() || parseUnquotedString(true)\n        if (!processedKey) {\n          if (\n            text[i] === '}' ||\n            text[i] === '{' ||\n            text[i] === ']' ||\n            text[i] === '[' ||\n            text[i] === undefined\n          ) {\n            // repair trailing comma\n            if (!initial) {\n              output = stripLastOccurrence(output, ',')\n            }\n          } else {\n            throwObjectKeyExpected()\n          }\n          break\n        }\n\n        parseWhitespaceAndSkipComments()\n        const processedColon = parseCharacter(':')\n        const truncatedText = i >= text.length\n        if (!processedColon) {\n          if (isStartOfValue(text[i]) || truncatedText) {\n            // repair missing colon\n            output = insertBeforeLastWhitespace(output, ':')\n          } else {\n            throwColonExpected()\n          }\n        }\n        const processedValue = parseValue()\n        if (!processedValue) {\n          if (processedColon || truncatedText) {\n            // repair missing object value\n            output += 'null'\n          } else {\n            throwColonExpected()\n          }\n        }\n\n        initial = false\n      }\n";
const COMMA_ARRAY_OLD = "        if (!initial) {\n          const processedComma = parseCharacter(',')\n          if (!processedComma) {\n            // repair missing comma\n            output = insertBeforeLastWhitespace(output, ',')\n          }\n        } else {\n          initial = false\n        }\n\n        skipEllipsis()\n\n        const processedValue = parseValue()\n        if (!processedValue) {\n          // repair trailing comma\n          output = stripLastOccurrence(output, ',')\n          break\n        }\n      }\n";
const COMMA_ARRAY_NEW = "        if (!initial) {\n          const processedComma = parseCharacter(',')\n          if (!processedComma) {\n            // repair missing comma\n            output = insertBeforeLastWhitespace(output, ',')\n          }\n        }\n\n        skipEllipsis()\n\n        const processedValue = parseValue()\n        if (!processedValue) {\n          // repair trailing comma\n          if (!initial) {\n            output = stripLastOccurrence(output, ',')\n          }\n          break\n        }\n\n        initial = false\n      }\n";

/** Strip a trailing comma only after a value, so the parent container keeps its comma. A check that is not jsonrepair is refused. */
export function parentComma(text: string): string | null {
  if (!text.includes("export function jsonrepair(")) return null; // comma-guard:parent
  if (!text.includes(COMMA_OBJECT_OLD) || text.includes(COMMA_OBJECT_NEW)) return null;
  if (text.split(COMMA_OBJECT_OLD).length !== 2) return null;
  if (!text.includes(COMMA_ARRAY_OLD) || text.includes(COMMA_ARRAY_NEW)) return null;
  if (text.split(COMMA_ARRAY_OLD).length !== 2) return null;
  return text.replace(COMMA_OBJECT_OLD, COMMA_OBJECT_NEW).replace(COMMA_ARRAY_OLD, COMMA_ARRAY_NEW);
}

export interface Batch14Input {
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
export function repairBatch14(input: Batch14Input): { diff: string; file: string } | null {
  if (!/Error|not equal|Expected|Invalid|fail/i.test(input.output)) return null;
  const edits: { path: string; next: string; original: string }[] = [];
  for (const path of filesOf(input.root, input.sourcePattern)) {
    const original = readLocal(input.root, path);
    if (original === null) continue;
    const next = prototypeLoose(original) ?? timerChunk(original) ?? classOnlyCopy(original) ?? parentComma(original);
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
