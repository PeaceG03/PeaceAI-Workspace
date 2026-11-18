// Three repairs for bugs the existing templates do not cover.
// A TypeScript annotation must not stretch a local-declaration scan.
// A string compatibility default is an object with default, not character keys.
// Combining zero streams ends immediately.
// Each edit is refused unless that exact parent file is present. The published test must pass afterwards.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { practiceGit, runInPracticeSandbox } from "./practicemine.ts";

const REGEXP_OLD: string = "import type { StripLiteralOptions } from 'strip-literal'\nimport { stripLiteral } from 'strip-literal'\n\nexport const RE_EXCLUDE = [\n  // imported/exported from other module\n  /\\b(import|export)\\b([\\w$*{},\\s]+?)\\bfrom\\s*[\"']/g,\n  // defined as function\n  /\\bfunction\\s*([\\w$]+)\\s*\\(/g,\n  // defined as class\n  /\\bclass\\s+([\\w$]+)/g,\n  // defined as local variable (including for-of/for-in loop declarations)\n  // eslint-disable-next-line regexp/no-super-linear-backtracking\n  /\\b(?:const|let|var)\\s+?(\\[.*?\\]|\\{.*?\\}|.+?)\\s*?(?:[=;\\n]|\\bof\\b|\\bin\\b)/gs,\n]\n\nexport const RE_IMPORT_AS = /^.*\\sas\\s+/\nexport const RE_SEPARATOR = /[,[\\]{}\\n]|\\b(?:import|export)\\b/g\n\n/**\n *                                                                             |       |\n *                    destructing   case&ternary    non-call     inheritance   |  id   |\n *                         \u2193             \u2193             \u2193             \u2193         |       |\n */\n// eslint-disable-next-line regexp/no-super-linear-backtracking\nexport const RE_MATCH = /(^|\\.\\.\\.|(?:\\bcase|\\?)\\s+|[^\\w$/)]|\\bextends\\s+)([\\w$]+)\\s*(?=[.()[\\]}:;?+\\-*&|`<>,\\n%/^~]|[!=]=|\\b(?:instanceof|in)\\b|$|(?<=extends\\s+\\w+)\\s+\\{)/g\n\n// eslint-disable-next-line regexp/no-super-linear-backtracking\nconst RE_REGEX = /\\/\\S*?(?<!\\\\)(?<!\\[[^\\]]*)\\/[gimsuy]*/g\n\nexport function stripCommentsAndStrings(code: string, options?: StripLiteralOptions) {\n  return stripLiteral(code, options)\n    .replace(RE_REGEX, 'new RegExp(\"\")')\n}\n\n/**\n * @deprecated renamed to `RE_EXCLUDE`\n */\nexport const excludeRE = RE_EXCLUDE\n\n/**\n * @deprecated renamed to `RE_IMPORT_AS`\n */\nexport const importAsRE = RE_IMPORT_AS\n\n/**\n * @deprecated renamed to `RE_SEPARATOR`\n */\nexport const separatorRE = RE_SEPARATOR\n\n/**\n * @deprecated renamed to `RE_MATCH`\n */\nexport const matchRE = RE_MATCH\n";
const REGEXP_NEW: string = "import type { StripLiteralOptions } from 'strip-literal'\nimport { stripLiteral } from 'strip-literal'\n\nexport const RE_EXCLUDE = [\n  // imported/exported from other module\n  /\\b(import|export)\\b([\\w$*{},\\s]+?)\\bfrom\\s*[\"']/g,\n  // defined as function\n  /\\bfunction\\s*([\\w$]+)\\s*\\(/g,\n  // defined as class\n  /\\bclass\\s+([\\w$]+)/g,\n  // defined as local variable (including for-of/for-in loop declarations).\n  // A TypeScript annotation (`const { a }: Props = ...`) is matched outside the\n  // captured group, so a destructuring pattern ends at its own closing bracket\n  // instead of stretching to a later `]`/`}` that happens to precede `=`.\n  // eslint-disable-next-line regexp/no-super-linear-backtracking\n  /\\b(?:const|let|var)\\s+?(\\[.*?\\]|\\{.*?\\}|.+?)\\s*?(?::[^=;\\n]*)?(?:[=;\\n]|\\bof\\b|\\bin\\b)/gs,\n]\n\nexport const RE_IMPORT_AS = /^.*\\sas\\s+/\nexport const RE_SEPARATOR = /[,[\\]{}\\n]|\\b(?:import|export)\\b/g\n\n/**\n *                                                                             |       |\n *                    destructing   case&ternary    non-call     inheritance   |  id   |\n *                         \u2193             \u2193             \u2193             \u2193         |       |\n */\n// eslint-disable-next-line regexp/no-super-linear-backtracking\nexport const RE_MATCH = /(^|\\.\\.\\.|(?:\\bcase|\\?)\\s+|[^\\w$/)]|\\bextends\\s+)([\\w$]+)\\s*(?=[.()[\\]}:;?+\\-*&|`<>,\\n%/^~]|[!=]=|\\b(?:instanceof|in)\\b|$|(?<=extends\\s+\\w+)\\s+\\{)/g\n\n// eslint-disable-next-line regexp/no-super-linear-backtracking\nconst RE_REGEX = /\\/\\S*?(?<!\\\\)(?<!\\[[^\\]]*)\\/[gimsuy]*/g\n\nexport function stripCommentsAndStrings(code: string, options?: StripLiteralOptions) {\n  return stripLiteral(code, options)\n    .replace(RE_REGEX, 'new RegExp(\"\")')\n}\n\n/**\n * @deprecated renamed to `RE_EXCLUDE`\n */\nexport const excludeRE = RE_EXCLUDE\n\n/**\n * @deprecated renamed to `RE_IMPORT_AS`\n */\nexport const importAsRE = RE_IMPORT_AS\n\n/**\n * @deprecated renamed to `RE_SEPARATOR`\n */\nexport const separatorRE = RE_SEPARATOR\n\n/**\n * @deprecated renamed to `RE_MATCH`\n */\nexport const matchRE = RE_MATCH\n";

/** Annotated destructuring stays local. A check that is not the RE_EXCLUDE local-variable pattern is refused. */
export function annotatedDestructure(text: string): string | null {
  if (!text.includes("export const RE_EXCLUDE")) return null; // ui-guard:regexp
  if (text !== REGEXP_OLD) return null;
  return REGEXP_NEW;
}

const DATE_OLD: string = "import { platforms, type PlatformName } from \"./platforms\";\n\n/**\n * Normalize the compatibility dates from input config and defaults.\n */\nexport function resolveCompatibilityDates(\n  input?: CompatibilityDateSpec | undefined,\n  defaults?: CompatibilityDateSpec,\n): CompatibilityDates {\n  // Initialize with defaults object\n  const dates: CompatibilityDates = { ...(defaults as CompatibilityDates) };\n\n  // Normalize default date\n  dates.default = formatDate(dates.default || \"\");\n\n  // Add normalized input values\n  const _input = typeof input === \"string\" ? { default: input } : input || {};\n  for (const [key, value] of Object.entries(_input)) {\n    if (value) {\n      dates[key as PlatformName] = formatDate(value);\n    }\n  }\n\n  return dates;\n}\n\n/**\n * Resolve compatibility dates with environment variables as defaults.\n *\n * Environment variable name format is `COMPATIBILITY_DATE` for default and `COMPATIBILITY_DATE_<PLATFORM>` for specific platforms.\n */\nexport function resolveCompatibilityDatesFromEnv(\n  overridesInput?: CompatibilityDateSpec | undefined,\n) {\n  const defaults: Partial<CompatibilityDates> = {\n    default: process.env.COMPATIBILITY_DATE\n      ? formatDate(process.env.COMPATIBILITY_DATE)\n      : undefined,\n  };\n  for (const platform of platforms) {\n    const envName = `COMPATIBILITY_DATE_${platform.toUpperCase()}`;\n    const env = process.env[envName];\n    if (env) {\n      defaults[platform] = formatDate(env);\n    }\n  }\n  return resolveCompatibilityDates(overridesInput, defaults);\n}\n\n/**\n * Format a date to a `YYYY-MM-DD` string\n *\n * @example\n *\n * ```ts\n * formatDateString(new Date(\"2021/01/01\")) // \"2021-01-01\"\n * ```\n */\nexport function formatDate(date: string | Date): DateString {\n  const d = normalizeDate(date);\n  if (Number.isNaN(d.getDate())) {\n    return \"\";\n  }\n  const year = d.getFullYear().toString();\n  const month = (d.getMonth() + 1).toString().padStart(2, \"0\");\n  const day = d.getDate().toString().padStart(2, \"0\");\n  return `${year}-${month}-${day}` as DateString;\n}\n\n// --- internal ---\n\nfunction normalizeDate(date: Date | string): Date {\n  if (date instanceof Date) {\n    return date;\n  }\n  return new Date(date);\n}\n\n// --- Types ---\n\ntype Year = `${number}${number}${number}${number}`;\ntype Month = `${\"0\" | \"1\"}${number}`;\ntype Day = `${\"0\" | \"1\" | \"2\" | \"3\"}${number}`;\n\n/**\n * Typed date string in `YYYY-MM-DD` format\n *\n * Empty string is used to represent an unspecified date.\n */\nexport type DateString = \"\" | `${Year}-${Month}-${Day}`;\n\n/**\n * Last known compatibility dates for platforms\n *\n * @example\n * {\n *  \"default\": \"2024-01-01\",\n *  \"cloudflare\": \"2024-03-01\",\n * }\n */\nexport type CompatibilityDates = {\n  /**\n   * Default compatibility date for all unspecified platforms (required)\n   */\n  default: DateString;\n} & Partial<Record<PlatformName, DateString>>;\n\n/**\n * Last known compatibility date for the used platform\n */\nexport type CompatibilityDateSpec = DateString | Partial<CompatibilityDates>;\n";
const DATE_NEW: string = "import { platforms, type PlatformName } from \"./platforms\";\n\n/**\n * Normalize the compatibility dates from input config and defaults.\n */\nexport function resolveCompatibilityDates(\n  input?: CompatibilityDateSpec | undefined,\n  defaults?: CompatibilityDateSpec,\n): CompatibilityDates {\n  // Initialize with defaults object\n  const dates = {\n    ...(typeof defaults === \"string\" ? { default: defaults } : defaults),\n  } as CompatibilityDates;\n\n  // Normalize default date\n  dates.default = formatDate(dates.default || \"\");\n\n  // Add normalized input values\n  const _input = typeof input === \"string\" ? { default: input } : input || {};\n  for (const [key, value] of Object.entries(_input)) {\n    if (value) {\n      dates[key as PlatformName] = formatDate(value);\n    }\n  }\n\n  return dates;\n}\n\n/**\n * Resolve compatibility dates with environment variables as defaults.\n *\n * Environment variable name format is `COMPATIBILITY_DATE` for default and `COMPATIBILITY_DATE_<PLATFORM>` for specific platforms.\n */\nexport function resolveCompatibilityDatesFromEnv(\n  overridesInput?: CompatibilityDateSpec | undefined,\n) {\n  const defaults: Partial<CompatibilityDates> = {\n    default: process.env.COMPATIBILITY_DATE\n      ? formatDate(process.env.COMPATIBILITY_DATE)\n      : undefined,\n  };\n  for (const platform of platforms) {\n    const envName = `COMPATIBILITY_DATE_${platform.toUpperCase()}`;\n    const env = process.env[envName];\n    if (env) {\n      defaults[platform] = formatDate(env);\n    }\n  }\n  return resolveCompatibilityDates(overridesInput, defaults);\n}\n\n/**\n * Format a date to a `YYYY-MM-DD` string\n *\n * @example\n *\n * ```ts\n * formatDateString(new Date(\"2021/01/01\")) // \"2021-01-01\"\n * ```\n */\nexport function formatDate(date: string | Date): DateString {\n  const d = normalizeDate(date);\n  if (Number.isNaN(d.getDate())) {\n    return \"\";\n  }\n  const year = d.getFullYear().toString();\n  const month = (d.getMonth() + 1).toString().padStart(2, \"0\");\n  const day = d.getDate().toString().padStart(2, \"0\");\n  return `${year}-${month}-${day}` as DateString;\n}\n\n// --- internal ---\n\nfunction normalizeDate(date: Date | string): Date {\n  if (date instanceof Date) {\n    return date;\n  }\n  return new Date(date);\n}\n\n// --- Types ---\n\ntype Year = `${number}${number}${number}${number}`;\ntype Month = `${\"0\" | \"1\"}${number}`;\ntype Day = `${\"0\" | \"1\" | \"2\" | \"3\"}${number}`;\n\n/**\n * Typed date string in `YYYY-MM-DD` format\n *\n * Empty string is used to represent an unspecified date.\n */\nexport type DateString = \"\" | `${Year}-${Month}-${Day}`;\n\n/**\n * Last known compatibility dates for platforms\n *\n * @example\n * {\n *  \"default\": \"2024-01-01\",\n *  \"cloudflare\": \"2024-03-01\",\n * }\n */\nexport type CompatibilityDates = {\n  /**\n   * Default compatibility date for all unspecified platforms (required)\n   */\n  default: DateString;\n} & Partial<Record<PlatformName, DateString>>;\n\n/**\n * Last known compatibility date for the used platform\n */\nexport type CompatibilityDateSpec = DateString | Partial<CompatibilityDates>;\n";

/** A string defaults value becomes { default }. A check that is not resolveCompatibilityDates is refused. */
export function stringDefaults(text: string): string | null {
  if (!text.includes("export function resolveCompatibilityDates")) return null; // cx-guard:date
  if (text !== DATE_OLD) return null;
  return DATE_NEW;
}

const STREAM_OLD: string = "import {type EventEmitter} from 'node:events';\nimport {pipeline} from 'node:stream/promises';\nimport {type Readable, PassThrough} from 'node:stream';\n\nexport const waitForEvent = (\n  emitter: EventEmitter,\n  name: string\n): Promise<void> => {\n  return new Promise((resolve) => {\n    emitter.once(name, resolve);\n  });\n};\n\nexport const combineStreams = (streams: Readable[]): Readable => {\n  let streamCount = streams.length;\n  const combined = new PassThrough();\n  const maybeEmitEnd = () => {\n    if (--streamCount === 0) {\n      combined.end();\n    }\n  };\n\n  for (const stream of streams) {\n    pipeline(stream, combined, {end: false})\n      .then(maybeEmitEnd)\n      .catch(maybeEmitEnd);\n  }\n\n  return combined;\n};\n";
const STREAM_NEW: string = "import {type EventEmitter} from 'node:events';\nimport {pipeline} from 'node:stream/promises';\nimport {type Readable, PassThrough} from 'node:stream';\n\nexport const waitForEvent = (\n  emitter: EventEmitter,\n  name: string\n): Promise<void> => {\n  return new Promise((resolve) => {\n    emitter.once(name, resolve);\n  });\n};\n\nexport const combineStreams = (streams: Readable[]): Readable => {\n  let streamCount = streams.length;\n  const combined = new PassThrough();\n  if (streamCount === 0) {\n    combined.end();\n    return combined;\n  }\n  const maybeEmitEnd = () => {\n    if (--streamCount === 0) {\n      combined.end();\n    }\n  };\n\n  for (const stream of streams) {\n    pipeline(stream, combined, {end: false})\n      .then(maybeEmitEnd)\n      .catch(maybeEmitEnd);\n  }\n\n  return combined;\n};\n";

/** Zero input streams end the combined stream. A check that is not combineStreams is refused. */
export function emptyCombine(text: string): string | null {
  if (!text.includes("export const combineStreams")) return null; // tx-guard:stream
  if (text !== STREAM_OLD) return null;
  return STREAM_NEW;
}

export interface Batch24Input {
  root: string;
  output: string;
  sourcePattern?: string;
  nodePath: string;
  nodeModules?: string | null;
  testCommand: readonly string[];
  bwrap?: string;
}

function readLocal(dir: string, path: string): string | null {
  try {
    return readFileSync(join(dir, path), "utf8");
  } catch {
    return null;
  }
}

function filesOf(dir: string, pattern: string | undefined): string[] {
  const listed = practiceGit(dir, ["ls-files"]);
  if (!listed.ok) return [];
  return listed.out.split("\n").map((p) => p.trim()).filter((p) => /\.tsx?$/.test(p) && !p.endsWith(".d.ts") && (!pattern || new RegExp(pattern).test(p)));
}

/** Apply the one repair the failure can prove, then require the published test to pass in the sandbox. */
export function repairBatch24(input: Batch24Input): { diff: string; file: string } | null {
  if (!/Error|not equal|Expected|Invalid|fail|toEqual|toBe|snapshot|toMatchObject|toHaveLength|timeout/i.test(input.output)) return null;
  const edits: { path: string; next: string; original: string }[] = [];
  for (const path of filesOf(input.root, input.sourcePattern)) {
    const original = readLocal(input.root, path);
    if (original === null) continue;
    const next = annotatedDestructure(original) ?? stringDefaults(original) ?? emptyCombine(original);
    if (next && next !== original) edits.push({ path, next, original });
  }
  if (edits.length !== 1) return null;
  const edit = edits[0]!;
  try {
    writeFileSync(join(input.root, edit.path), edit.next);
    const again = runInPracticeSandbox(input.root, input.testCommand, 180_000, {
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
