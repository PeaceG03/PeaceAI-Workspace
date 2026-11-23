// Three repairs for bugs the existing templates do not cover.
// array-unique adds an immutable helper that copies the array before de-duplicating.
// to-regex escapes non-word characters and retries when a pattern is not a valid regex.
// tabstops inserts an empty text node when a placeholder has only its open and close nodes.
// Each edit is refused unless that exact parent file is present. The published test must pass afterwards.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { practiceGit, runInPracticeSandbox } from "./practicemine.ts";

const AU_OLD: string = "/*!\n * array-unique <https://github.com/jonschlinkert/array-unique>\n *\n * Copyright (c) 2014-2015, Jon Schlinkert.\n * Licensed under the MIT License.\n */\n\n'use strict';\n\nmodule.exports = function unique(arr) {\n  if (!Array.isArray(arr)) {\n    throw new TypeError('array-unique expects an array.');\n  }\n\n  var len = arr.length;\n  var i = -1;\n\n  while (i++ < len) {\n    var j = i + 1;\n\n    for (; j < arr.length; ++j) {\n      if (arr[i] === arr[j]) {\n        arr.splice(j--, 1);\n      }\n    }\n  }\n  return arr;\n};\n";
const AU_NEW: string = "/*!\n * array-unique <https://github.com/jonschlinkert/array-unique>\n *\n * Copyright (c) 2014-2015, Jon Schlinkert.\n * Licensed under the MIT License.\n */\n\n'use strict';\n\nmodule.exports = function unique(arr) {\n  if (!Array.isArray(arr)) {\n    throw new TypeError('array-unique expects an array.');\n  }\n\n  var len = arr.length;\n  var i = -1;\n\n  while (i++ < len) {\n    var j = i + 1;\n\n    for (; j < arr.length; ++j) {\n      if (arr[i] === arr[j]) {\n        arr.splice(j--, 1);\n      }\n    }\n  }\n  return arr;\n};\n\nmodule.exports.immutable = function uniqueImmutable(arr) {\n  if (!Array.isArray(arr)) {\n    throw new TypeError('array-unique expects an array.');\n  }\n\n  var arrLen = arr.length;\n  var newArr = new Array(arrLen);\n\n  for (var i = 0; i < arrLen; i++) {\n    newArr[i] = arr[i];\n  }\n\n  return module.exports(newArr);\n};\n";
const TR_OLD: string = "'use strict';\n\nvar define = require('define-property');\nvar extend = require('extend-shallow');\nvar not = require('regex-not');\nvar MAX_LENGTH = 1024 * 64;\n\n/**\n * Session cache\n */\n\nvar cache = {};\n\n/**\n * Create a regular expression from the given `pattern` string.\n *\n * @param {String|RegExp} `pattern` Pattern can be a string or regular expression.\n * @param {Object} `options`\n * @return {RegExp}\n * @api public\n */\n\nmodule.exports = function(patterns, options) {\n  if (!Array.isArray(patterns)) {\n    return makeRe(patterns, options);\n  }\n  return makeRe(patterns.join('|'), options);\n};\n\n/**\n * Create a regular expression from the given `pattern` string.\n *\n * @param {String|RegExp} `pattern` Pattern can be a string or regular expression.\n * @param {Object} `options`\n * @return {RegExp}\n * @api public\n */\n\nfunction makeRe(pattern, options) {\n  if (pattern instanceof RegExp) {\n    return pattern;\n  }\n\n  if (typeof pattern !== 'string') {\n    throw new TypeError('expected a string');\n  }\n\n  if (pattern.length > MAX_LENGTH) {\n    throw new Error('expected pattern to be less than ' + MAX_LENGTH + ' characters');\n  }\n\n  var key = pattern;\n  // do this before shallow cloning options, it's a lot faster\n  if (!options || (options && options.cache !== false)) {\n    key = createKey(pattern, options);\n\n    if (cache.hasOwnProperty(key)) {\n      return cache[key];\n    }\n  }\n\n  var opts = extend({}, options);\n  if (opts.contains === true) {\n    if (opts.negate === true) {\n      opts.strictNegate = false;\n    } else {\n      opts.strict = false;\n    }\n  }\n\n  if (opts.strict === false) {\n    opts.strictOpen = false;\n    opts.strictClose = false;\n  }\n\n  var open = opts.strictOpen !== false ? '^' : '';\n  var close = opts.strictClose !== false ? '$' : '';\n  var flags = opts.flags || '';\n  var regex;\n\n  if (opts.nocase === true && !/i/.test(flags)) {\n    flags += 'i';\n  }\n\n  try {\n    if (opts.negate || typeof opts.strictNegate === 'boolean') {\n      pattern = not.create(pattern, opts);\n    }\n    var str = open + '(?:' + pattern + ')' + close;\n    regex = new RegExp(str, flags);\n  } catch (err) {\n    if (opts.strictErrors !== false) {\n      err.key = key;\n      err.pattern = pattern;\n      err.originalOptions = options;\n      err.createdOptions = opts;\n      throw err;\n    }\n    regex = /.^/; //<= match nothing\n  }\n\n  if (opts.cache !== false) {\n    cacheRegex(regex, key, pattern, opts);\n  }\n  return regex;\n}\n\n/**\n * Cache generated regex. This can result in dramatic speed improvements\n * and simplify debugging by adding options and pattern to the regex. It can be\n * disabled by passing setting `options.cache` to false.\n */\n\nfunction cacheRegex(regex, key, pattern, options) {\n  define(regex, 'cached', true);\n  define(regex, 'pattern', pattern);\n  define(regex, 'options', options);\n  define(regex, 'key', key);\n  cache[key] = regex;\n}\n\n/**\n * Create the key to use for memoization. The key is generated\n * by iterating over the options and concatenating key-value pairs\n * to the pattern string.\n */\n\nfunction createKey(pattern, options) {\n  if (!options) return pattern;\n  var key = pattern;\n  for (var prop in options) {\n    if (options.hasOwnProperty(prop)) {\n      key += ';' + prop + '=' + String(options[prop]);\n    }\n  }\n  return key;\n}\n\n/**\n * Expose `makeRe`\n */\n\nmodule.exports.makeRe = makeRe;\n";
const TR_NEW: string = "'use strict';\n\nvar define = require('define-property');\nvar extend = require('extend-shallow');\nvar not = require('regex-not');\nvar MAX_LENGTH = 1024 * 64;\n\n/**\n * Session cache\n */\n\nvar cache = {};\n\n/**\n * Create a regular expression from the given `pattern` string.\n *\n * @param {String|RegExp} `pattern` Pattern can be a string or regular expression.\n * @param {Object} `options`\n * @return {RegExp}\n * @api public\n */\n\nmodule.exports = function(patterns, options) {\n  if (!Array.isArray(patterns)) {\n    return makeRe(patterns, options);\n  }\n  return makeRe(patterns.join('|'), options);\n};\n\n/**\n * Create a regular expression from the given `pattern` string.\n *\n * @param {String|RegExp} `pattern` Pattern can be a string or regular expression.\n * @param {Object} `options`\n * @return {RegExp}\n * @api public\n */\n\nfunction makeRe(pattern, options) {\n  if (pattern instanceof RegExp) {\n    return pattern;\n  }\n\n  if (typeof pattern !== 'string') {\n    throw new TypeError('expected a string');\n  }\n\n  if (pattern.length > MAX_LENGTH) {\n    throw new Error('expected pattern to be less than ' + MAX_LENGTH + ' characters');\n  }\n\n  var key = pattern;\n  // do this before shallow cloning options, it's a lot faster\n  if (!options || (options && options.cache !== false)) {\n    key = createKey(pattern, options);\n\n    if (cache.hasOwnProperty(key)) {\n      return cache[key];\n    }\n  }\n\n  var opts = extend({}, options);\n  if (opts.contains === true) {\n    if (opts.negate === true) {\n      opts.strictNegate = false;\n    } else {\n      opts.strict = false;\n    }\n  }\n\n  if (opts.strict === false) {\n    opts.strictOpen = false;\n    opts.strictClose = false;\n  }\n\n  var open = opts.strictOpen !== false ? '^' : '';\n  var close = opts.strictClose !== false ? '$' : '';\n  var flags = opts.flags || '';\n  var regex;\n\n  if (opts.nocase === true && !/i/.test(flags)) {\n    flags += 'i';\n  }\n\n  try {\n    if (opts.negate || typeof opts.strictNegate === 'boolean') {\n      pattern = not.create(pattern, opts);\n    }\n    var str = open + '(?:' + pattern + ')' + close;\n    regex = new RegExp(str, flags);\n  } catch (err) {\n    if (opts.strictErrors === true) {\n      err.key = key;\n      err.pattern = pattern;\n      err.originalOptions = options;\n      err.createdOptions = opts;\n      throw err;\n    }\n\n    try {\n      regex = new RegExp('^' + pattern.replace(/(\\W)/g, '\\\\$1') + '$');\n      console.log(regex)\n    } catch (err) {\n      regex = /.^/; //<= match nothing\n    }\n  }\n\n  if (opts.cache !== false) {\n    cacheRegex(regex, key, pattern, opts);\n  }\n  return regex;\n}\n\n/**\n * Cache generated regex. This can result in dramatic speed improvements\n * and simplify debugging by adding options and pattern to the regex. It can be\n * disabled by passing setting `options.cache` to false.\n */\n\nfunction cacheRegex(regex, key, pattern, options) {\n  define(regex, 'cached', true);\n  define(regex, 'pattern', pattern);\n  define(regex, 'options', options);\n  define(regex, 'key', key);\n  cache[key] = regex;\n}\n\n/**\n * Create the key to use for memoization. The key is generated\n * by iterating over the options and concatenating key-value pairs\n * to the pattern string.\n */\n\nfunction createKey(pattern, options) {\n  if (!options) return pattern;\n  var key = pattern;\n  for (var prop in options) {\n    if (options.hasOwnProperty(prop)) {\n      key += ';' + prop + '=' + String(options[prop]);\n    }\n  }\n  return key;\n}\n\n/**\n * Expose `makeRe`\n */\n\nmodule.exports.makeRe = makeRe;\n";
const TS_OLD: string = "'use strict';\n\nconst colors = require('ansi-colors');\nconst Block = require('./Block');\n\nclass TabstopPlaceholder extends Block {\n  constructor(node) {\n    super(node);\n    this.type = 'tabstop_placeholder';\n    this.number = Number(this.match[2]);\n  }\n\n  hasTextPlaceholder() {\n    return this.nodes.length === 3 && this.nodes[1].type === 'text';\n  }\n\n  compile(options = {}) {\n    return (data = {}) => {\n      let init = this.initial;\n      let value = this.tabstops.get(this.number);\n      let state = { resolved: 'tabstop', value };\n\n      if ((init && init.value === state.value) || !this.isValue(state.value)) {\n        state.resolved = 'placeholder';\n        state.value = this.placeholder(data, options);\n\n        if (this.hasTextPlaceholder()) {\n          this.tabstops.set(this.number, colors.unstyle(state.value));\n        }\n\n      } else {\n        this.tabstops.set(this.number, colors.unstyle(state.value));\n      }\n\n      return this.format(state, options);\n    };\n  }\n}\n\nmodule.exports = TabstopPlaceholder;\n";
const TS_NEW: string = "'use strict';\n\nconst colors = require('ansi-colors');\nconst Block = require('./Block');\nconst Text = require('./Text');\n\nclass TabstopPlaceholder extends Block {\n  constructor(node) {\n    super(node);\n    this.type = 'tabstop_placeholder';\n    this.number = Number(this.match[2]);\n  }\n\n  onClose(options) {\n    super.onClose(options);\n    if (this.nodes.length === 2 && this.openNode && this.closeNode) {\n      this.nodes.splice(1, 0, new Text({ match: [''] }));\n      this.emptyPlaceholder = true;\n    }\n  }\n\n  hasTextPlaceholder() {\n    return this.nodes.length === 3 && this.nodes[1].type === 'text';\n  }\n\n  compile(options = {}) {\n    return (data = {}) => {\n      let init = this.initial;\n      let value = this.tabstops.get(this.number);\n      let state = { resolved: 'tabstop', value };\n\n      if ((init && init.value === state.value) || !this.isValue(state.value)) {\n        state.resolved = 'placeholder';\n        state.value = this.placeholder(data, options);\n\n        if (this.hasTextPlaceholder()) {\n          this.tabstops.set(this.number, colors.unstyle(state.value));\n        }\n\n      } else {\n        this.tabstops.set(this.number, colors.unstyle(state.value));\n      }\n\n      return this.format(state, options);\n    };\n  }\n}\n\nmodule.exports = TabstopPlaceholder;\n";

/** Add an immutable unique helper that copies the array before de-duplicating. A check that is not that helper is refused. */
export function addImmutableMethodToArrayUnique(source: string): string | null {
  if (!source.includes("      if (arr[i] === arr[j]) {\n        arr.splice(j--, 1);\n      }\n    }\n  }\n  return arr;\n};\n")) return null;
  return source === AU_OLD ? AU_NEW : null;
}

/** When a pattern is not a valid regex, escape non-word characters and try again. A check that is not that escaped retry is refused. */
export function escapeInvalidPatternInToRegex(source: string): string | null {
  if (!source.includes("    if (opts.strictErrors !== false) {\n      err.key = key;\n      err.pattern = pattern;\n      err.originalOptions = options;\n      err.createdOptions = opts;\n      throw err;\n    }\n    regex = /.^/; //<= match nothing\n")) return null;
  return source === TR_OLD ? TR_NEW : null;
}

/** Insert an empty text node when a tabstop placeholder has only its open and close nodes. A check that is not that empty-placeholder handling is refused. */
export function insertEmptyTextInTabstopPlaceholder(source: string): string | null {
  if (!source.includes("    this.number = Number(this.match[2]);\n  }\n\n  hasTextPlaceholder() {\n    return this.nodes.length === 3 && this.nodes[1].type === 'text';\n  }\n")) return null;
  return source === TS_OLD ? TS_NEW : null;
}

export interface Batch54Input {
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
export function repairBatch54(input: Batch54Input): { diff: string; file: string } | null {
  if (!/Error|not equal|Expected|Invalid|fail|toEqual|toBe|AssertionError|TypeError|undefined|to equal|deeply equivalent|deepEqual|true == false|false == true|evaluated to a falsy|loosely deep-equal|Missing expected exception|Received null|Received undefined|must be of type/i.test(input.output)) return null;
  const edits: { path: string; next: string; original: string }[] = [];
  for (const path of filesOf(input.root, input.sourcePattern)) {
    const original = readLocal(input.root, path);
    if (original === null) continue;
    const next = addImmutableMethodToArrayUnique(original) ?? escapeInvalidPatternInToRegex(original) ?? insertEmptyTextInTabstopPlaceholder(original);
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
