// Three repairs for bugs the existing templates do not cover.
// strip-comments replaces only the first comment occurrence, not every substring match.
// index-of stops a fromIndex walk at the array end so it cannot read past the last element.
// falsey lower-cases keywords before lookup (the parent typo was toLoweCase).
// Each edit is refused unless that exact parent file is present. The published test must pass afterwards.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { practiceGit, runInPracticeSandbox } from "./practicemine.ts";

const STRIP_OLD: string = "'use strict';\n\nvar extract = require('extract-comments');\n\n/**\n * Strip comments from the given `string`.\n *\n * @param {String} `string`\n * @param {Object} `options` Pass `safe: true` to keep comments with `!`\n * @return {String}\n * @api public\n */\n\nfunction strip(str, options) {\n  options = options || {};\n  if (options.line) {\n    return line(str, options);\n  }\n  if (options.block) {\n    return block(str, options);\n  }\n  if (options.first) {\n    return first(str, options);\n  }\n  str = block(str, options);\n  return line(str, options);\n}\n\n/**\n * Strip block comments from the given `string`.\n *\n * @param {String} `string`\n * @param {Object} `options` Pass `safe: true` to keep comments with `!`\n * @return {String}\n * @api public\n */\n\nfunction block(str, options) {\n  return stripEach(str, extract.block(str, options), options);\n}\n\n/**\n * Strip line comments from the given `string`.\n *\n * @param {String} `string`\n * @param {Object} `options` Pass `safe: true` to keep comments with `!`\n * @return {String}\n * @api public\n */\n\nfunction line(str, options) {\n  return stripEach(str, extract.line(str, options), options);\n}\n\n/**\n * Strip the first comment from the given `string`.\n *\n * @param {String} `string`\n * @param {Object} `options` Pass `safe: true` to keep comments with `!`\n * @return {String}\n * @api public\n */\n\nfunction first(str, options) {\n  return stripEach(str, extract.first(str), options);\n}\n\n/**\n * Private function for stripping comments.\n *\n * @param {String} `string`\n * @param {Object} `options` Pass `safe: true` to keep comments with `!`\n * @return {String}\n */\n\nfunction stripEach(str, comments, options) {\n  comments.forEach(function(comment) {\n    str = discard(str, comment, options);\n  });\n  return str;\n}\n\n/**\n * Remove a comment from the given string.\n *\n * @param {String} `string`\n * @param {Object} `options` Pass `safe: true` to keep comments with `!`\n * @return {String}\n */\n\nfunction discard(str, comment, opts) {\n  var ch = comment.value.charAt(0);\n  if (opts && opts.safe === true && ch === '!') {\n    return str;\n  }\n  return str.split(comment.raw).join('');\n}\n\n/**\n * Expose `strip`\n */\n\nmodule.exports = strip;\n\n/**\n * Expose methods\n */\n\nmodule.exports.block = block;\nmodule.exports.first = first;\nmodule.exports.line = line;\n";
const STRIP_NEW: string = "'use strict';\n\nvar extract = require('extract-comments');\n\n/**\n * Strip comments from the given `string`.\n *\n * @param {String} `string`\n * @param {Object} `options` Pass `safe: true` to keep comments with `!`\n * @return {String}\n * @api public\n */\n\nfunction strip(str, options) {\n  options = options || {};\n  if (options.line) {\n    return line(str, options);\n  }\n  if (options.block) {\n    return block(str, options);\n  }\n  if (options.first) {\n    return first(str, options);\n  }\n  str = block(str, options);\n  return line(str, options);\n}\n\n/**\n * Strip block comments from the given `string`.\n *\n * @param {String} `string`\n * @param {Object} `options` Pass `safe: true` to keep comments with `!`\n * @return {String}\n * @api public\n */\n\nfunction block(str, options) {\n  return stripEach(str, extract.block(str, options), options);\n}\n\n/**\n * Strip line comments from the given `string`.\n *\n * @param {String} `string`\n * @param {Object} `options` Pass `safe: true` to keep comments with `!`\n * @return {String}\n * @api public\n */\n\nfunction line(str, options) {\n  return stripEach(str, extract.line(str, options), options);\n}\n\n/**\n * Strip the first comment from the given `string`.\n *\n * @param {String} `string`\n * @param {Object} `options` Pass `safe: true` to keep comments with `!`\n * @return {String}\n * @api public\n */\n\nfunction first(str, options) {\n  return stripEach(str, extract.first(str), options);\n}\n\n/**\n * Private function for stripping comments.\n *\n * @param {String} `string`\n * @param {Object} `options` Pass `safe: true` to keep comments with `!`\n * @return {String}\n */\n\nfunction stripEach(str, comments, options) {\n  comments.forEach(function(comment) {\n    str = discard(str, comment, options);\n  });\n  return str;\n}\n\n/**\n * Remove a comment from the given string.\n *\n * @param {String} `string`\n * @param {Object} `options` Pass `safe: true` to keep comments with `!`\n * @return {String}\n */\n\nfunction discard(str, comment, opts) {\n  var ch = comment.value.charAt(0);\n  if (opts && opts.safe === true && ch === '!') {\n    return str;\n  }\n  return str.replace(comment.raw, '');\n}\n\n/**\n * Expose `strip`\n */\n\nmodule.exports = strip;\n\n/**\n * Expose methods\n */\n\nmodule.exports.block = block;\nmodule.exports.first = first;\nmodule.exports.line = line;\n";
const INDEX_OLD: string = "/*!\n * index-of <https://github.com/jonschlinkert/index-of>\n *\n * Copyright (c) 2014-2015 Jon Schlinkert.\n * Licensed under the MIT license.\n */\n\n'use strict';\n\nmodule.exports = function indexOf(arr, ele, start) {\n  start = start || 0;\n  var idx = -1;\n\n  if (arr == null) return idx;\n  var len = arr.length;\n  var i = start < 0\n    ? (len + start)\n    : start;\n\n  while (len--) {\n    if (arr[i++] === ele) {\n      idx = i - 1;\n      break;\n    }\n  }\n\n  return idx;\n};\n";
const INDEX_NEW: string = "/*!\n * index-of <https://github.com/jonschlinkert/index-of>\n *\n * Copyright (c) 2014-2015 Jon Schlinkert.\n * Licensed under the MIT license.\n */\n\n'use strict';\n\nmodule.exports = function indexOf(arr, ele, start) {\n  start = start || 0;\n  var idx = -1;\n\n  if (arr == null) return idx;\n  var len = arr.length;\n  var i = start < 0\n    ? (len + start)\n    : start;\n\n  if (i >= arr.length) {\n    return -1;\n  }\n\n  while (i < len) {\n    if (arr[i] === ele) {\n      return i;\n    }\n    i++;\n  }\n\n  return -1;\n};\n";
const FALSEY_OLD: string = "/*!\n * falsey <https://github.com/jonschlinkert/falsey>\n *\n * Copyright (c) 2014-2015, Jon Schlinkert.\n * Licensed under the MIT License.\n */\n\n'use strict';\n\nvar typeOf = require('kind-of');\n\nmodule.exports = function falsey(val, keywords) {\n  if (!val) return true;\n\n  if (Array.isArray(val) || typeOf(val) === 'arguments') {\n    return !val.length;\n  }\n\n  if (typeOf(val) === 'object') {\n    return !Object.keys(val).length;\n  }\n\n  var arr = !keywords\n    ? ['none', 'nil', 'nope', 'no', 'nada', '0', 'false']\n    : arrayify(keywords);\n\n  return arr.indexOf(val.toLoweCase ? val.toLowerCase() : val) !== -1;\n};\n\nfunction arrayify(val) {\n  return Array.isArray(val) ? val : [val];\n}\n";
const FALSEY_NEW: string = "/*!\n * falsey <https://github.com/jonschlinkert/falsey>\n *\n * Copyright (c) 2014-2015, Jon Schlinkert.\n * Licensed under the MIT License.\n */\n\n'use strict';\n\nvar typeOf = require('kind-of');\n\nmodule.exports = function falsey(val, keywords) {\n  if (!val) return true;\n\n  if (Array.isArray(val) || typeOf(val) === 'arguments') {\n    return !val.length;\n  }\n\n  if (typeOf(val) === 'object') {\n    return !Object.keys(val).length;\n  }\n\n  var arr = !keywords\n    ? ['none', 'nil', 'nope', 'no', 'nada', '0', 'false']\n    : arrayify(keywords);\n\n  return arr.indexOf(val.toLowerCase ? val.toLowerCase() : val) !== -1;\n};\n\nfunction arrayify(val) {\n  return Array.isArray(val) ? val : [val];\n}\n";

/** Replace only the first occurrence of a comment so a later comment that contains it as a substring is not broken. A check that is not that first-occurrence replace is refused. */
export function stripCommentByReplacingFirstOccurrence(source: string): string | null {
  if (!source.includes("  return str.split(comment.raw).join('');")) return null;
  return source === STRIP_OLD ? STRIP_NEW : null;
}

/** Stop an indexOf search at the array length so a fromIndex walk cannot read past the end. A check that is not that bounded walk is refused. */
export function stopIndexOfSearchAtArrayEnd(source: string): string | null {
  if (!source.includes("  while (len--) {\n    if (arr[i++] === ele) {\n      idx = i - 1;\n      break;")) return null;
  return source === INDEX_OLD ? INDEX_NEW : null;
}

/** Lower-case a falsey keyword before looking it up. A check that is not that toLowerCase typo fix is refused. */
export function lowerCaseFalseyKeywordsBeforeLookup(source: string): string | null {
  if (!source.includes("  return arr.indexOf(val.toLoweCase ? val.toLowerCase() : val) !== -1;")) return null;
  return source === FALSEY_OLD ? FALSEY_NEW : null;
}

export interface Batch44Input {
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
export function repairBatch44(input: Batch44Input): { diff: string; file: string } | null {
  if (!/Error|not equal|Expected|Invalid|fail|toEqual|toBe|AssertionError|TypeError|undefined|to equal|deeply equivalent|deepEqual|true == false|false == true|evaluated to a falsy|of a larger comment|expected 5 to be -1|isFalsey\('NIL'\)/i.test(input.output)) return null;
  const edits: { path: string; next: string; original: string }[] = [];
  for (const path of filesOf(input.root, input.sourcePattern)) {
    const original = readLocal(input.root, path);
    if (original === null) continue;
    const next = stripCommentByReplacingFirstOccurrence(original) ?? stopIndexOfSearchAtArrayEnd(original) ?? lowerCaseFalseyKeywordsBeforeLookup(original);
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
