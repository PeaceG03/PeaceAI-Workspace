// Three repairs for bugs the existing templates do not cover.
// is-equal-shallow counts own keys on both objects so a subset is not treated as equal.
// wordcount includes Cyrillic letters in its word-matching pattern.
// to-object-path joins an Arguments object into a dotted path instead of stringifying it.
// Each edit is refused unless that exact parent file is present. The published test must pass afterwards.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { practiceGit, runInPracticeSandbox } from "./practicemine.ts";

const IES_OLD: string = "/*!\n * is-equal-shallow <https://github.com/jonschlinkert/is-equal-shallow>\n *\n * Copyright (c) 2015, Jon Schlinkert.\n * Licensed under the MIT License.\n */\n\n'use strict';\n\nvar isPrimitive = require('is-primitive');\n\nmodule.exports = function isEqual(a, b) {\n  if (!a && !b) { return true; }\n  if (!a && b || a && !b) { return false; }\n\n  for (var key in b) {\n    if (!isPrimitive(b[key]) || !a.hasOwnProperty(key) || (a[key] !== b[key])) {\n      return false;\n    }\n  }\n  return true;\n};\n";
const IES_NEW: string = "/*!\n * is-equal-shallow <https://github.com/jonschlinkert/is-equal-shallow>\n *\n * Copyright (c) 2015, Jon Schlinkert.\n * Licensed under the MIT License.\n */\n\n'use strict';\n\nvar isPrimitive = require('is-primitive');\n\nmodule.exports = function isEqual(a, b) {\n  if (!a && !b) { return true; }\n  if (!a && b || a && !b) { return false; }\n\n  var numKeysA = 0, numKeysB = 0, key;\n  for (key in b) {\n    numKeysB++;\n    if (!isPrimitive(b[key]) || !a.hasOwnProperty(key) || (a[key] !== b[key])) {\n      return false;\n    }\n  }\n  for (key in a) {\n    numKeysA++;\n  }\n  return numKeysA === numKeysB;\n};\n";
const WC_OLD: string = "/*!\n * wordcount <https://github.com/jonschlinkert/wordcount>\n *\n * Copyright (c) 2014 Jon Schlinkert, contributors.\n * Licensed under the MIT License\n */\n\n'use strict';\n\nmodule.exports = function wordcount(str) {\n  // regex from https://github.com/lepture/editor/blob/master/src/intro.js#L343\n  var pattern = /[a-zA-Z0-9_\\u0392-\\u03c9]+|[\\u4E00-\\u9FFF\\u3400-\\u4dbf\\uf900-\\ufaff\\u3040-\\u309f\\uac00-\\ud7af]+/g;\n\n  var matches = str.match(pattern);\n  if (matches === null) {\n    return 0;\n  }\n\n  return matches.length;\n};\n";
const WC_NEW: string = "/*!\n * wordcount <https://github.com/jonschlinkert/wordcount>\n *\n * Copyright (c) 2014 Jon Schlinkert, contributors.\n * Licensed under the MIT License\n */\n\n'use strict';\n\nmodule.exports = function wordcount(str) {\n  // CJK and Cyrillic regex from:\n  // https://github.com/lepture/editor/blob/master/src/intro.js#L343\n  // added cyrillic: \\u0400-\\u04FF - to the end of groups\n  var pattern = /[a-zA-Z0-9_\\u0392-\\u03c9\\u0400-\\u04FF]+|[\\u4E00-\\u9FFF\\u3400-\\u4dbf\\uf900-\\ufaff\\u3040-\\u309f\\uac00-\\ud7af\\u0400-\\u04FF]+|\\w+/g;\n\n  var matches = str.match(pattern);\n  if (matches === null) {\n    return 0;\n  }\n\n  return matches.length;\n};\n";
const TOP_OLD: string = "/*!\n * to-path <https://github.com/jonschlinkert/to-path>\n *\n * Copyright (c) 2015, Jon Schlinkert.\n * Licensed under the MIT License.\n */\n\n'use strict';\n\nmodule.exports = function toPath() {\n  return [].concat.apply([], arguments).join('.');\n};\n";
const TOP_NEW: string = "/*!\n * to-object-path <https://github.com/jonschlinkert/to-object-path>\n *\n * Copyright (c) 2015, Jon Schlinkert.\n * Licensed under the MIT License.\n */\n\n'use strict';\n\nvar isArguments = require('is-arguments');\nvar flatten = require('arr-flatten');\n\nmodule.exports = function toPath(args) {\n  if (isArguments(args)) {\n    args = [].slice.call(args);\n  } else {\n    args = [].slice.call(arguments);\n  }\n  return flatten(args).join('.');\n};\n";

/** Count own keys on both objects so a subset is not treated as equal. A check that is not that key-count comparison is refused. */
export function countOwnKeysSoASubsetIsNotEqual(source: string): string | null {
  if (!source.includes("  for (var key in b) {\n    if (!isPrimitive(b[key]) || !a.hasOwnProperty(key) || (a[key] !== b[key])) {\n      return false;\n    }\n  }\n  return true;")) return null;
  return source === IES_OLD ? IES_NEW : null;
}

/** Include Cyrillic letters in the word-count pattern. A check that is not that character-class expansion is refused. */
export function includeCyrillicLettersInWordCount(source: string): string | null {
  if (!source.includes("  var pattern = /[a-zA-Z0-9_\\u0392-\\u03c9]+|[\\u4E00-\\u9FFF\\u3400-\\u4dbf\\uf900-\\ufaff\\u3040-\\u309f\\uac00-\\ud7af]+/g;")) return null;
  return source === WC_OLD ? WC_NEW : null;
}

/** Join an Arguments object into an object path instead of stringifying it. A check that is not that Arguments handling is refused. */
export function joinArgumentsObjectIntoAnObjectPath(source: string): string | null {
  if (!source.includes("module.exports = function toPath() {\n  return [].concat.apply([], arguments).join('.');\n};")) return null;
  return source === TOP_OLD ? TOP_NEW : null;
}

export interface Batch49Input {
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
  return listed.out.split("\n").map((p) => p.trim()).filter((p) => /\.(?:tsx?|js)$/.test(p) && !p.endsWith(".d.ts") && (!pattern || new RegExp(pattern).test(p)));
}

/** Apply the one repair the failure can prove, then require the published test to pass in the sandbox. */
export function repairBatch49(input: Batch49Input): { diff: string; file: string } | null {
  if (!/Error|not equal|Expected|Invalid|fail|toEqual|toBe|AssertionError|TypeError|undefined|to equal|deeply equivalent|deepEqual|true == false|false == true|evaluated to a falsy|expected true to be false|0 !== 3|\[object Arguments\]/i.test(input.output)) return null;
  const edits: { path: string; next: string; original: string }[] = [];
  for (const path of filesOf(input.root, input.sourcePattern)) {
    const original = readLocal(input.root, path);
    if (original === null) continue;
    const next = countOwnKeysSoASubsetIsNotEqual(original) ?? includeCyrillicLettersInWordCount(original) ?? joinArgumentsObjectIntoAnObjectPath(original);
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
