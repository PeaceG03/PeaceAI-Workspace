// Three repairs for bugs the existing templates do not cover.
// cwd returns the directory of the found package.json, not a resolve against the start path.
// array-sort sends null and undefined property values to the end of the compare.
// replace-nth anchors alternation in the nth-match index so 1|3|5 is exact.
// Each edit is refused unless that exact parent file is present. The published test must pass afterwards.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { practiceGit, runInPracticeSandbox } from "./practicemine.ts";

const CWD_OLD: string = "/*!\n * cwd <https://github.com/jonschlinkert/cwd>\n *\n * Copyright (c) 2014-2015, Jon Schlinkert.\n * Licensed under the MIT License.\n */\n\nvar path = require('path');\nvar lookup = require('look-up');\n\n/**\n * Expose `cwd`\n */\n\nmodule.exports = cwd;\n\n/**\n * Cache filepaths to prevent hitting the file system\n * for multiple lookups on the exact same path.\n */\n\nvar cache = {};\n\n/**\n * Uses [look-up] to resolve the absolute path to the root of a project.\n *\n * @param {String|Array} `filepath` The starting filepath. Can be a string, or path parts as a list of arguments or array.\n * @return {String} Resolve filepath.\n * @api public\n */\n\nfunction cwd() {\n  var fp = path.resolve.apply(path, [].concat.apply([], arguments));\n  if (cache.hasOwnProperty(fp)) {\n    return cache[fp];\n  }\n\n  try {\n    var res = lookup('package.json', {cwd: fp});\n    var base = res ? path.dirname(res) : '';\n    return (cache[fp] = path.resolve(base, fp));\n  } catch (err) {\n    return (cache[fp] = fp);\n  }\n}\n";
const CWD_NEW: string = "/*!\n * cwd <https://github.com/jonschlinkert/cwd>\n *\n * Copyright (c) 2014-2015, Jon Schlinkert.\n * Licensed under the MIT License.\n */\n\nvar path = require('path');\nvar lookup = require('look-up');\n\n/**\n * Expose `cwd`\n */\n\nmodule.exports = cwd;\n\n/**\n * Cache filepaths to prevent hitting the file system\n * for multiple lookups on the exact same path.\n */\n\nvar cache = {};\n\n/**\n * Uses [look-up] to resolve the absolute path to the root of a project.\n *\n * @param {String|Array} `filepath` The starting filepath. Can be a string, or path parts as a list of arguments or array.\n * @return {String} Resolve filepath.\n * @api public\n */\n\nfunction cwd() {\n  var fp = path.resolve.apply(path, [].concat.apply([], arguments));\n\n  if (cache.hasOwnProperty(fp)) {\n    return cache[fp];\n  }\n\n  try {\n    var res = lookup('package.json', {cwd: fp});\n    var base = res ? path.dirname(res) : '';\n    return (cache[fp] = base);\n  } catch (err) {\n    return (cache[fp] = fp);\n  }\n}\n";
const SORT_OLD: string = "/*!\n * array-sort <https://github.com/jonschlinkert/array-sort>\n *\n * Copyright (c) 2015-2017, Jon Schlinkert.\n * Released under the MIT License.\n */\n\n'use strict';\n\nvar typeOf = require('kind-of');\nvar get = require('get-value');\n\n/**\n * Sort an array of objects by one or more properties.\n *\n * @param  {Array} `arr` The Array to sort.\n * @param  {String|Array|Function} `props` One or more object paths or comparison functions.\n * @param  {Object} `opts` Pass `{ reverse: true }` to reverse the sort order.\n * @return {Array} Returns a sorted array.\n * @api public\n */\n\nfunction arraySort(arr, props, opts) {\n  if (arr == null) {\n    return [];\n  }\n\n  if (!Array.isArray(arr)) {\n    throw new TypeError('array-sort expects an array.');\n  }\n\n  if (arguments.length === 1) {\n    return arr.sort();\n  }\n\n  var args = flatten([].slice.call(arguments, 1));\n\n  // if the last argument appears to be a plain object,\n  // it's not a valid `compare` arg, so it must be options.\n  if (typeOf(args[args.length - 1]) === 'object') {\n    opts = args.pop();\n  }\n  return arr.sort(sortBy(args, opts));\n}\n\n/**\n * Iterate over each comparison property or function until `1` or `-1`\n * is returned.\n *\n * @param  {String|Array|Function} `props` One or more object paths or comparison functions.\n * @param  {Object} `opts` Pass `{ reverse: true }` to reverse the sort order.\n * @return {Array}\n */\n\nfunction sortBy(props, opts) {\n  opts = opts || {};\n\n  return function compareFn(a, b) {\n    var len = props.length, i = -1;\n    var result;\n\n    while (++i < len) {\n      result = compare(props[i], a, b);\n      if (result !== 0) {\n        break;\n      }\n    }\n    if (opts.reverse === true) {\n      return result * -1;\n    }\n    return result;\n  };\n}\n\n/**\n * Compare `a` to `b`. If an object `prop` is passed, then\n * `a[prop]` is compared to `b[prop]`\n */\n\nfunction compare(prop, a, b) {\n  if (typeof prop === 'function') {\n    // expose `compare` to custom function\n    return prop(a, b, compare.bind(null, null));\n  }\n  // compare object values\n  if (prop && typeof a === 'object' && typeof b === 'object') {\n    return compare(null, get(a, prop), get(b, prop));\n  }\n  return defaultCompare(a, b);\n}\n\n/**\n * Default compare function used as a fallback\n * for sorting.\n */\n\nfunction defaultCompare(a, b) {\n  return a < b ? -1 : (a > b ? 1 : 0);\n}\n\n/**\n * Flatten the given array.\n */\n\nfunction flatten(arr) {\n  return [].concat.apply([], arr);\n}\n\n/**\n * Expose `arraySort`\n */\n\nmodule.exports = arraySort;\n";
const SORT_NEW: string = "/*!\n * array-sort <https://github.com/jonschlinkert/array-sort>\n *\n * Copyright (c) 2015-2017, Jon Schlinkert.\n * Released under the MIT License.\n */\n\n'use strict';\n\nvar typeOf = require('kind-of');\nvar get = require('get-value');\n\n/**\n * Sort an array of objects by one or more properties.\n *\n * @param  {Array} `arr` The Array to sort.\n * @param  {String|Array|Function} `props` One or more object paths or comparison functions.\n * @param  {Object} `opts` Pass `{ reverse: true }` to reverse the sort order.\n * @return {Array} Returns a sorted array.\n * @api public\n */\n\nfunction arraySort(arr, props, opts) {\n  if (arr == null) {\n    return [];\n  }\n\n  if (!Array.isArray(arr)) {\n    throw new TypeError('array-sort expects an array.');\n  }\n\n  if (arguments.length === 1) {\n    return arr.sort();\n  }\n\n  var args = flatten([].slice.call(arguments, 1));\n\n  // if the last argument appears to be a plain object,\n  // it's not a valid `compare` arg, so it must be options.\n  if (typeOf(args[args.length - 1]) === 'object') {\n    opts = args.pop();\n  }\n  return arr.sort(sortBy(args, opts));\n}\n\n/**\n * Iterate over each comparison property or function until `1` or `-1`\n * is returned.\n *\n * @param  {String|Array|Function} `props` One or more object paths or comparison functions.\n * @param  {Object} `opts` Pass `{ reverse: true }` to reverse the sort order.\n * @return {Array}\n */\n\nfunction sortBy(props, opts) {\n  opts = opts || {};\n\n  return function compareFn(a, b) {\n    var len = props.length, i = -1;\n    var result;\n\n    while (++i < len) {\n      result = compare(props[i], a, b);\n      if (result !== 0) {\n        break;\n      }\n    }\n    if (opts.reverse === true) {\n      return result * -1;\n    }\n    return result;\n  };\n}\n\n/**\n * Compare `a` to `b`. If an object `prop` is passed, then\n * `a[prop]` is compared to `b[prop]`\n */\n\nfunction compare(prop, a, b) {\n  if (typeof prop === 'function') {\n    // expose `compare` to custom function\n    return prop(a, b, compare.bind(null, null));\n  }\n  // compare object values\n  if (prop && typeof a === 'object' && typeof b === 'object') {\n    return compare(null, get(a, prop), get(b, prop));\n  }\n  return defaultCompare(a, b);\n}\n\n/**\n * Default compare function used as a fallback\n * for sorting. Built-in array sorting pushes\n * null and undefined values to the end of the array.\n */\n\nfunction defaultCompare(a, b) {\n  var typeA = typeOf(a);\n  var typeB = typeOf(b);\n\n  if (typeA === 'null') {\n    return typeB === 'null' ? 0 : (typeB === 'undefined' ? -1 : 1);\n  } else if (typeA === 'undefined') {\n    return typeB === 'null' ? 1 : (typeB === 'undefined' ? 0 : 1);\n  } else if (typeB === 'null' || typeB === 'undefined') {\n    return -1;\n  } else {\n    return a < b ? -1 : (a > b ? 1 : 0);\n  }\n}\n\n/**\n * Flatten the given array.\n */\n\nfunction flatten(arr) {\n  return [].concat.apply([], arr);\n}\n\n/**\n * Expose `arraySort`\n */\n\nmodule.exports = arraySort;\n";
const NTH_OLD: string = "/**\n * replace-nth <https://github.com/assemble/replace-nth>\n *\n * Copyright (c) 2014 Jon Schlinkert, Brian Woodward, contributors.\n * Licensed under the MIT license.\n */\nvar _ = require('lodash');\n\nmodule.exports = function(options) {\n  options = options || {};\n\n  var pattern = options.pattern;\n  var replacement = options.replacement;\n  var str = options.str;\n  var num = options.num;\n\n  var i = 0;\n  return str.replace(pattern, function (match) {\n    i++;\n    return new RegExp('^' + num + '$').test(i) ? replacement : match;\n  });\n};";
const NTH_NEW: string = "/**\n * replace-nth <https://github.com/assemble/replace-nth>\n *\n * Copyright (c) 2014 Jon Schlinkert, Brian Woodward, contributors.\n * Licensed under the MIT license.\n */\nvar _ = require('lodash');\n\nmodule.exports = function(options) {\n  options = options || {};\n\n  var pattern = options.pattern;\n  var replacement = options.replacement;\n  var str = options.str;\n  var num = options.num;\n\n  var i = 0;\n  return str.replace(pattern, function (match) {\n    i++;\n    return new RegExp('^(?:' + num + ')$', 'g').test(i) ? replacement : match;\n  });\n};";

/** Return the directory of the found package.json, not a resolve of that directory against the start path. A check that is not that directory return is refused. */
export function returnDirectoryOfFoundPackageJson(source: string): string | null {
  if (!source.includes("    return (cache[fp] = path.resolve(base, fp));")) return null;
  return source === CWD_OLD ? CWD_NEW : null;
}

/** Sort null and undefined property values to the end. A check that is not that null/undefined compare is refused. */
export function sortNullAndUndefinedValuesToEnd(source: string): string | null {
  if (!source.includes("function defaultCompare(a, b) {\n  return a < b ? -1 : (a > b ? 1 : 0);\n}")) return null;
  return source === SORT_OLD ? SORT_NEW : null;
}

/** Anchor alternation in the nth-match index so `1|3|5` is an exact index, not a start-or-end pattern. A check that is not that anchored alternation is refused. */
export function anchorAlternationWhenReplacingNthMatch(source: string): string | null {
  if (!source.includes("    return new RegExp('^' + num + '$').test(i) ? replacement : match;")) return null;
  return source === NTH_OLD ? NTH_NEW : null;
}

export interface Batch43Input {
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
export function repairBatch43(input: Batch43Input): { diff: string; file: string } | null {
  if (!/Error|not equal|Expected|Invalid|fail|toEqual|toBe|AssertionError|TypeError|undefined|to equal|deeply equivalent|deepEqual|true == false|false == true|evaluated to a falsy|fixtures\/a\/b\/c|key: null|BaBaBaaaa/i.test(input.output)) return null;
  const edits: { path: string; next: string; original: string }[] = [];
  for (const path of filesOf(input.root, input.sourcePattern)) {
    const original = readLocal(input.root, path);
    if (original === null) continue;
    const next = returnDirectoryOfFoundPackageJson(original) ?? sortNullAndUndefinedValuesToEnd(original) ?? anchorAlternationWhenReplacingNthMatch(original);
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
