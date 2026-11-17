// Three repairs for bugs the existing templates do not cover.
// path.resolve keeps a UNC prefix that normalizeString would collapse.
// A raw argv value is coerced when the option is boolean or string.
// serialize(name, null) stores an empty cookie value instead of the string "null".
// Each edit is refused unless that exact shape is present. The published test must pass afterwards.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { practiceGit, runInPracticeSandbox } from "./practicemine.ts";

const RAW_VALUE = "value: String(_val)";
const RAW_OPTIONS = `const options = typeof _val === "object" ? _val : _opts;`;

/** `null` and `undefined` cookie values become `""`, and a null value is not read as the options object. */
export function coerceCookieValue(text: string): string | null {
  if (!text.includes("export function serialize(")) return null; // cookie-guard:serialize
  if (!text.includes(RAW_VALUE) || !text.includes(RAW_OPTIONS) || text.includes('value: String(_val ?? "")')) return null;
  if (text.split(RAW_VALUE).length !== 2 || text.split(RAW_OPTIONS).length !== 2) return null;
  return text
    .replace(RAW_VALUE, 'value: String(_val ?? "")')
    .replace(RAW_OPTIONS, "const options = typeof _name === \"object\" ? (_val as CookieStringifyOptions) : _opts;");
}

/** `resolve` remembers a UNC base segment and puts the `//` prefix back after normalization. */
export function preserveUncResolve(text: string): string | null {
  if (!text.includes("const _UNC_REGEX") || !text.includes("resolvedAbsolute = isAbsolute(path);")) return null;
  if (text.includes("resolvedUNC")) return null; // path-guard:unc
  const flag = "  let resolvedAbsolute = false;\n";
  const mark = "    resolvedAbsolute = isAbsolute(path);\n";
  const back = "  if (resolvedAbsolute && !isAbsolute(resolvedPath)) {\n";
  if (!text.includes(flag) || !text.includes(mark) || !text.includes(back)) return null;
  if (text.split(flag).length !== 2 || text.split(mark).length !== 2) return null;
  return text
    .replace(flag, `${flag}  let resolvedUNC = false;\n`)
    .replace(mark, `${mark}    resolvedUNC = _UNC_REGEX.test(path);\n`)
    .replace(back, `  if (resolvedUNC) {\n    return \`//\${resolvedPath}\`;\n  }\n\n${back}`);
}

const RAW_ASSIGN = "(out as any)[key] = value;";

/** A boolean option written as `--flag=false` stays false, and a bare string option stays a string. */
export function coerceArgValues(text: string): string | null {
  if (!text.includes("function getType(")) return null; // arg-guard:typed
  if (!text.includes(RAW_ASSIGN) || text.includes('value !== "false"')) return null;
  const helper = `  function isStringType(name: string): boolean {\n    if (strings.has(name)) return true;\n    const aliases = mainToAliases.get(name) || [];\n    for (const alias of aliases) {\n      if (strings.has(alias)) return true;\n    }\n    return false;\n  }\n\n`;
  const coerced = `let coerced = value;\n    const type = getType(key);\n    if (type === "boolean" && typeof value === "string") {\n      coerced = value !== "false";\n    } else if (isStringType(key) && typeof value === "boolean") {\n      coerced = "";\n    }\n    (out as any)[key] = coerced;`;
  let next = text.replace(RAW_ASSIGN, coerced);
  const anchor = "  // Add parsed values\n";
  if (!text.includes(anchor) || !text.includes("const strings = new Set")) return null;
  next = next.replace(anchor, `${helper}${anchor}`);
  return next === text ? null : next;
}

export interface Batch5Input {
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
export function repairBatch5(input: Batch5Input): { diff: string; file: string } | null {
  if (!/Error|not equal|Expected|Invalid|fail/i.test(input.output)) return null;
  const edits: { path: string; next: string; original: string }[] = [];
  for (const path of filesOf(input.root, input.sourcePattern)) {
    const original = readLocal(input.root, path);
    if (original === null) continue;
    const next = preserveUncResolve(original) ?? coerceArgValues(original) ?? coerceCookieValue(original);
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
