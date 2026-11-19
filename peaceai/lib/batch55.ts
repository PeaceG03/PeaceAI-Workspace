// Three repairs for bugs the existing templates do not cover.
// parse-gitignore keeps insertion order instead of sorting patterns.
// append-string returns early when the suffix is empty, so an EOL is not appended.
// randomatic type-checks the exclude option rather than the length argument before joining excluded characters.
// Each edit is refused unless that exact parent file is present. The published test must pass afterwards.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { practiceGit, runInPracticeSandbox } from "./practicemine.ts";

const PG_OLD: string = "/*!\n * parse-gitignore <https://github.com/jonschlinkert/parse-gitignore>\n *\n * Copyright (c) 2015, Jon Schlinkert.\n * Licensed under the MIT License.\n */\n\n'use strict';\n\nvar fs = require('fs');\nvar isGlob = require('is-glob');\nvar unique = require('array-unique');\nvar cache = {};\n\n\nfunction gitignore(fp, patterns, options) {\n  if (!fp || !fs.existsSync(fp)) return [];\n\n  if (cache.hasOwnProperty(fp)) {\n    return cache[fp];\n  }\n\n  if (typeof pattern !== 'string' && !Array.isArray(patterns)) {\n    options = patterns;\n    patterns = [];\n  }\n\n  options = options || {};\n  var str = fs.readFileSync(fp, 'utf8');\n  var lines = str.split(/\\r\\n|\\n/).concat(patterns || []);\n  var arr = unique(gitignore.parse(lines, options));\n  arr.sort();\n\n  if (options.cache !== false) {\n    gitignore.cache[fp] = arr;\n  }\n  return arr;\n}\n\ngitignore.cache = cache;\n\ngitignore.parse = function parse(arr, opts) {\n  arr = arrayify(arr);\n  var len = arr.length, i = -1;\n  var res = [];\n\n  while (++i < len) {\n    var str = arr[i];\n    str = (str || '').trim();\n\n    if (!str || str.charAt(0) === '#') {\n      continue;\n    }\n\n    var parsed = gitignore.toGlob(str);\n    addPattern(res, parsed.patterns, parsed.stats, opts);\n  }\n  return res;\n};\n\ngitignore.toGlob = function toGlob(str) {\n  var parsed = {}, stats = {};\n\n  stats.first = str.charAt(0);\n  stats.last = str.slice(-1);\n\n  stats.isNegated = stats.first === '!';\n  stats.isGlob = isGlob(str);\n\n  if (stats.isNegated) {\n    str = str.slice(1);\n    stats.first = str.charAt(0);\n  }\n\n  if (stats.first === '/') {\n    str = str.slice(1);\n  }\n\n  if (/\\w\\/[*]{2}\\/\\w/.test(str)) {\n    str += '|' + str.split('/**/').join('/');\n  }\n\n  if (/^[\\w.]/.test(str) && /\\w$/.test(str) && !stats.isGlob) {\n    str += '|' + str + '/**';\n\n  } else if (/\\/$/.test(str)) {\n    str += '**';\n  }\n\n  parsed.stats = stats;\n  parsed.patterns = str.split('|');\n  return parsed;\n};\n\nfunction addPattern(res, arr, stats, options) {\n  arr = arrayify(arr);\n  var len = arr.length, i = -1;\n  while (++i < len) {\n    var str = arr[i];\n    if (stats.isNegated) {\n      str = '!' + str;\n    }\n    if (options.invert) {\n      str = invert(str);\n    }\n    if (res.indexOf(str) === -1) {\n      res.push(str);\n    }\n  }\n  return res;\n}\n\nfunction invert(str) {\n  if (str.charAt(0) === '!') {\n    return str.slice(1);\n  }\n  return '!' + str;\n}\n\nfunction arrayify(val) {\n  return Array.isArray(val) ? val : [val];\n}\n\n/**\n * Expose `gitignore`\n */\n\nmodule.exports = gitignore;\n";
const PG_NEW: string = "/*!\n * parse-gitignore <https://github.com/jonschlinkert/parse-gitignore>\n *\n * Copyright (c) 2015, Jon Schlinkert.\n * Licensed under the MIT License.\n */\n\n'use strict';\n\nvar fs = require('fs');\nvar isGlob = require('is-glob');\nvar unique = require('array-unique');\nvar cache = {};\n\n\nfunction gitignore(fp, patterns, options) {\n  if (!fp || !fs.existsSync(fp)) return [];\n\n  if (cache.hasOwnProperty(fp)) {\n    return cache[fp];\n  }\n\n  if (typeof pattern !== 'string' && !Array.isArray(patterns)) {\n    options = patterns;\n    patterns = [];\n  }\n\n  options = options || {};\n  var str = fs.readFileSync(fp, 'utf8');\n  var lines = str.split(/\\r\\n|\\n/).concat(patterns || []);\n  var arr = unique(gitignore.parse(lines, options));\n\n  if (options.cache !== false) {\n    gitignore.cache[fp] = arr;\n  }\n  return arr;\n}\n\ngitignore.cache = cache;\n\ngitignore.parse = function parse(arr, opts) {\n  arr = arrayify(arr);\n  var len = arr.length, i = -1;\n  var res = [];\n\n  while (++i < len) {\n    var str = arr[i];\n    str = (str || '').trim();\n\n    if (!str || str.charAt(0) === '#') {\n      continue;\n    }\n\n    var parsed = gitignore.toGlob(str);\n    addPattern(res, parsed.patterns, parsed.stats, opts);\n  }\n  return res;\n};\n\ngitignore.toGlob = function toGlob(str) {\n  var parsed = {}, stats = {};\n\n  stats.first = str.charAt(0);\n  stats.last = str.slice(-1);\n\n  stats.isNegated = stats.first === '!';\n  stats.isGlob = isGlob(str);\n\n  if (stats.isNegated) {\n    str = str.slice(1);\n    stats.first = str.charAt(0);\n  }\n\n  if (stats.first === '/') {\n    str = str.slice(1);\n  }\n\n  if (/\\w\\/[*]{2}\\/\\w/.test(str)) {\n    str += '|' + str.split('/**/').join('/');\n  }\n\n  if (/^[\\w.]/.test(str) && /\\w$/.test(str) && !stats.isGlob) {\n    str += '|' + str + '/**';\n\n  } else if (/\\/$/.test(str)) {\n    str += '**';\n  }\n\n  parsed.stats = stats;\n  parsed.patterns = str.split('|');\n  return parsed;\n};\n\nfunction addPattern(res, arr, stats, options) {\n  arr = arrayify(arr);\n  var len = arr.length, i = -1;\n  while (++i < len) {\n    var str = arr[i];\n    if (stats.isNegated) {\n      str = '!' + str;\n    }\n    if (options.invert) {\n      str = invert(str);\n    }\n    if (res.indexOf(str) === -1) {\n      res.push(str);\n    }\n  }\n  return res;\n}\n\nfunction invert(str) {\n  if (str.charAt(0) === '!') {\n    return str.slice(1);\n  }\n  return '!' + str;\n}\n\nfunction arrayify(val) {\n  return Array.isArray(val) ? val : [val];\n}\n\n/**\n * Expose `gitignore`\n */\n\nmodule.exports = gitignore;\n";
const AS_OLD: string = "'use strict';\n\nvar os = require('os');\n\n/**\n * Append a string to another string ensuring to preserve line ending characters.\n *\n * ```js\n * console.log([appendString('abc\\r\\n', 'def')]);\n * //=> [ 'abc\\r\\ndef\\r\\n' ]\n *\n * console.log([appendString('abc\\n', 'def')]);\n * //=> [ 'abc\\ndef\\n' ]\n *\n * // uses os.EOL when a line ending is not found\n * console.log([appendString('abc', 'def')]);\n * //=> [ 'abc\\ndef' ]\n * ```\n * @param  {String} `str` String that will be used to check for an existing line ending. The suffix is appended to this.\n * @param  {String} `suffix` String that will be appended to the str.\n * @return {String} Final String\n * @api public\n */\n\nmodule.exports = function appendString(str, suffix) {\n  var eol;\n  if (str.slice(-2) === '\\r\\n') {\n    eol = '\\r\\n';\n  } else if (str.slice(-1) === '\\n') {\n    eol = '\\n';\n  } else {\n    return [str, os.EOL, suffix].join('');\n  }\n  return [str, suffix, eol].join('');\n};\n";
const AS_NEW: string = "'use strict';\n\nvar os = require('os');\n\n/**\n * Append a string to another string ensuring to preserve line ending characters.\n *\n * ```js\n * console.log([appendString('abc\\r\\n', 'def')]);\n * //=> [ 'abc\\r\\ndef\\r\\n' ]\n *\n * console.log([appendString('abc\\n', 'def')]);\n * //=> [ 'abc\\ndef\\n' ]\n *\n * // uses os.EOL when a line ending is not found\n * console.log([appendString('abc', 'def')]);\n * //=> [ 'abc\\ndef' ]\n * ```\n * @param  {String} `str` String that will be used to check for an existing line ending. The suffix is appended to this.\n * @param  {String} `suffix` String that will be appended to the str.\n * @return {String} Final String\n * @api public\n */\n\nmodule.exports = function appendString(str, suffix) {\n  if (!suffix || !suffix.length) {\n    return str;\n  }\n  var eol;\n  if (str.slice(-2) === '\\r\\n') {\n    eol = '\\r\\n';\n  } else if (str.slice(-1) === '\\n') {\n    eol = '\\n';\n  } else {\n    return [str, os.EOL, suffix].join('');\n  }\n  return [str, suffix, eol].join('');\n};\n";
const RA_OLD: string = "/*!\n * randomatic <https://github.com/jonschlinkert/randomatic>\n *\n * Copyright (c) 2014-2017, Jon Schlinkert.\n * Released under the MIT License.\n */\n\n'use strict';\n\nvar isNumber = require('is-number');\nvar typeOf = require('kind-of');\nvar mathRandom = require('math-random');\n\n/**\n * Expose `randomatic`\n */\n\nmodule.exports = randomatic;\nmodule.exports.isCrypto = !!mathRandom.cryptographic;\n\n/**\n * Available mask characters\n */\n\nvar type = {\n  lower: 'abcdefghijklmnopqrstuvwxyz',\n  upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',\n  number: '0123456789',\n  special: '~!@#$%^&()_+-={}[];\\',.'\n};\n\ntype.all = type.lower + type.upper + type.number + type.special;\n\n/**\n * Generate random character sequences of a specified `length`,\n * based on the given `pattern`.\n *\n * @param {String} `pattern` The pattern to use for generating the random string.\n * @param {String} `length` The length of the string to generate.\n * @param {String} `options`\n * @return {String}\n * @api public\n */\n\nfunction randomatic(pattern, length, options) {\n  if (typeof pattern === 'undefined') {\n    throw new Error('randomatic expects a string or number.');\n  }\n\n  var custom = false;\n  if (arguments.length === 1) {\n    if (typeof pattern === 'string') {\n      length = pattern.length;\n\n    } else if (isNumber(pattern)) {\n      options = {};\n      length = pattern;\n      pattern = '*';\n    }\n  }\n\n  if (typeOf(length) === 'object' && length.hasOwnProperty('chars')) {\n    options = length;\n    pattern = options.chars;\n    length = pattern.length;\n    custom = true;\n  }\n\n  var opts = options || {};\n  var mask = '';\n  var res = '';\n\n  // Characters to be used\n  if (pattern.indexOf('?') !== -1) mask += opts.chars;\n  if (pattern.indexOf('a') !== -1) mask += type.lower;\n  if (pattern.indexOf('A') !== -1) mask += type.upper;\n  if (pattern.indexOf('0') !== -1) mask += type.number;\n  if (pattern.indexOf('!') !== -1) mask += type.special;\n  if (pattern.indexOf('*') !== -1) mask += type.all;\n  if (custom) mask += pattern;\n\n  // Characters to exclude\n  if (opts.exclude) {\n    var exclude = typeOf(length) === 'string' ? opts.exclude : opts.exclude.join('');\n    mask = mask.replace(new RegExp('[' + exclude + ']+', 'g'), '');\n  }\n\n  while (length--) {\n    res += mask.charAt(parseInt(mathRandom() * mask.length, 10));\n  }\n  return res;\n};\n";
const RA_NEW: string = "/*!\n * randomatic <https://github.com/jonschlinkert/randomatic>\n *\n * Copyright (c) 2014-2017, Jon Schlinkert.\n * Released under the MIT License.\n */\n\n'use strict';\n\nvar isNumber = require('is-number');\nvar typeOf = require('kind-of');\nvar mathRandom = require('math-random');\n\n/**\n * Expose `randomatic`\n */\n\nmodule.exports = randomatic;\nmodule.exports.isCrypto = !!mathRandom.cryptographic;\n\n/**\n * Available mask characters\n */\n\nvar type = {\n  lower: 'abcdefghijklmnopqrstuvwxyz',\n  upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',\n  number: '0123456789',\n  special: '~!@#$%^&()_+-={}[];\\',.'\n};\n\ntype.all = type.lower + type.upper + type.number + type.special;\n\n/**\n * Generate random character sequences of a specified `length`,\n * based on the given `pattern`.\n *\n * @param {String} `pattern` The pattern to use for generating the random string.\n * @param {String} `length` The length of the string to generate.\n * @param {String} `options`\n * @return {String}\n * @api public\n */\n\nfunction randomatic(pattern, length, options) {\n  if (typeof pattern === 'undefined') {\n    throw new Error('randomatic expects a string or number.');\n  }\n\n  var custom = false;\n  if (arguments.length === 1) {\n    if (typeof pattern === 'string') {\n      length = pattern.length;\n\n    } else if (isNumber(pattern)) {\n      options = {};\n      length = pattern;\n      pattern = '*';\n    }\n  }\n\n  if (typeOf(length) === 'object' && length.hasOwnProperty('chars')) {\n    options = length;\n    pattern = options.chars;\n    length = pattern.length;\n    custom = true;\n  }\n\n  var opts = options || {};\n  var mask = '';\n  var res = '';\n\n  // Characters to be used\n  if (pattern.indexOf('?') !== -1) mask += opts.chars;\n  if (pattern.indexOf('a') !== -1) mask += type.lower;\n  if (pattern.indexOf('A') !== -1) mask += type.upper;\n  if (pattern.indexOf('0') !== -1) mask += type.number;\n  if (pattern.indexOf('!') !== -1) mask += type.special;\n  if (pattern.indexOf('*') !== -1) mask += type.all;\n  if (custom) mask += pattern;\n\n  // Characters to exclude\n  if (opts.exclude) {\n    var exclude = typeOf(opts.exclude) === 'string' ? opts.exclude : opts.exclude.join('');\n    mask = mask.replace(new RegExp('[' + exclude + ']+', 'g'), '');\n  }\n\n  while (length--) {\n    res += mask.charAt(parseInt(mathRandom() * mask.length, 10));\n  }\n  return res;\n};\n";

/** Skip sorting parsed gitignore patterns, so insertion order is kept. A check that is not that skipped sort is refused. */
export function skipSortInParseGitignore(source: string): string | null {
  if (!source.includes("  var arr = unique(gitignore.parse(lines, options));\n  arr.sort();\n\n  if (options.cache !== false) {\n")) return null;
  return source === PG_OLD ? PG_NEW : null;
}

/** Return early when the suffix is empty or missing, so an EOL is not appended. A check that is not that early return is refused. */
export function returnEarlyOnEmptySuffixInAppendString(source: string): string | null {
  if (!source.includes("module.exports = function appendString(str, suffix) {\n  var eol;\n  if (str.slice(-2) === '\\r\\n') {\n")) return null;
  return source === AS_OLD ? AS_NEW : null;
}

/** Type-check the exclude option, not the length argument, before joining excluded characters. A check that is not that type check is refused. */
export function typeCheckExcludeOptionInRandomatic(source: string): string | null {
  if (!source.includes("    var exclude = typeOf(length) === 'string' ? opts.exclude : opts.exclude.join('');\n")) return null;
  return source === RA_OLD ? RA_NEW : null;
}

export interface Batch55Input {
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
export function repairBatch55(input: Batch55Input): { diff: string; file: string } | null {
  if (!/Error|not equal|Expected|Invalid|fail|toEqual|toBe|AssertionError|TypeError|undefined|to equal|deeply equivalent|deepEqual|true == false|false == true|evaluated to a falsy|loosely deep-equal|Missing expected exception|Received null|Received undefined|must be of type/i.test(input.output)) return null;
  const edits: { path: string; next: string; original: string }[] = [];
  for (const path of filesOf(input.root, input.sourcePattern)) {
    const original = readLocal(input.root, path);
    if (original === null) continue;
    const next = skipSortInParseGitignore(original) ?? returnEarlyOnEmptySuffixInAppendString(original) ?? typeCheckExcludeOptionInRandomatic(original);
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
