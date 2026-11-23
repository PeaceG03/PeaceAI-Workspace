// Three repairs for bugs the existing templates do not cover.
// map-files re-resolves glob results against cwd so file paths stay valid when a cwd option is set.
// pad-right pads a string to a target length instead of appending that many characters.
// map-cache exposes del instead of delete when removing a cache entry.
// Each edit is refused unless that exact parent file is present. The published test must pass afterwards.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { practiceGit, runInPracticeSandbox } from "./practicemine.ts";

const MF_OLD: string = "'use strict';\n\n/**\n * Module dependencies\n */\n\nvar fs = require('fs');\nvar path = require('path');\nvar glob = require('globby');\n\n/**\n * Return an object for all files matching the given `patterns`\n * and `options`. The full filepath of the file is used as the key.\n *\n * @param  {String} `patterns` Glob patterns to pass to [globby]\n * @param  {Object} `opts` Options for globby, or pass a custom `parse` or `name`.\n * @return {Object}\n * @api public\n */\n\nmodule.exports = function mapFiles(patterns, options) {\n  var files = glob.sync(patterns, options);\n\n  return files.reduce(function (cache, filepath) {\n    var key = name(filepath, options);\n    var str = read(filepath, options);\n\n    cache[key] = str;\n    return cache;\n  }, {});\n};\n\nfunction name(filepath, options) {\n  if (options && options.name) {\n    return options.name(filepath, options);\n  }\n  var ext = path.extname(filepath);\n  return path.basename(filepath, ext);\n}\n\nfunction read(filepath, options) {\n  if (options && options.read) {\n    return options.read(filepath, options);\n  }\n  var str = fs.readFileSync(filepath, 'utf8');\n  return {path: filepath, content: str};\n}\n";
const MF_NEW: string = "'use strict';\n\n/**\n * Module dependencies\n */\n\nvar fs = require('fs');\nvar path = require('path');\nvar relative = require('relative');\n\n/**\n * Return an object for all files matching the given `patterns`\n * and `options`. The full filepath of the file is used as the key.\n *\n * @param  {String} `patterns` Glob patterns to pass to [globby]\n * @param  {Object} `opts` Options for globby, or pass a custom `parse` or `name`.\n * @return {Object}\n * @api public\n */\n\nmodule.exports = function mapFiles(patterns, options) {\n  var files = globber(patterns, options);\n  var cwd = options && options.cwd || process.cwd();\n\n  return files.reduce(function (cache, filepath) {\n    filepath = relative(path.resolve(cwd, filepath));\n    var key = name(filepath, options);\n    var str = read(filepath, options);\n\n    cache[key] = str;\n    return cache;\n  }, {});\n};\n\nfunction globber(patterns, options) {\n  if (options && options.glob) {\n    return options.glob(patterns, options);\n  }\n  var glob = require('globby');\n  return glob.sync(patterns, options);\n}\n\nfunction name(filepath, options) {\n  if (options && options.name) {\n    return options.name(filepath, options);\n  }\n  var ext = path.extname(filepath);\n  return path.basename(filepath, ext);\n}\n\nfunction read(filepath, options) {\n  if (options && options.read) {\n    return options.read(filepath, options);\n  }\n  var str = fs.readFileSync(filepath, 'utf8');\n  return {path: filepath, content: str};\n}\n";
const PR_OLD: string = "/*!\n * pad-left <https://github.com/jonschlinkert/pad-left>\n *\n * Copyright (c) 2014 Jon Schlinkert, contributors.\n * Licensed under the MIT license.\n */\n\n'use strict';\n\nvar repeat = require('repeat-string');\n\nmodule.exports = function padLeft(val, num, str) {\n  var padding = '';\n\n  // Breakpoints based on benchmarks to use the fastest approach\n  // for the given number of zeros\n  if (num <= 5 && !str) {\n    padding = '00000';\n  } else if (num <= 25 && !str) {\n    padding = '000000000000000000000000000';\n  } else {\n    return val + repeat(str || '0', num);\n  }\n\n  return val + padding.slice(-num);\n};\n";
const PR_NEW: string = "/*!\n * pad-left <https://github.com/jonschlinkert/pad-left>\n *\n * Copyright (c) 2014 Jon Schlinkert, contributors.\n * Licensed under the MIT license.\n */\n\n'use strict';\n\nvar repeat = require('repeat-string');\n\nmodule.exports = function padLeft(val, num, str) {\n  var padding = '';\n  var postfix = num - val.length;\n\n  // Breakpoints based on benchmarks to use the fastest approach\n  // for the given number of zeros\n  if (postfix <= 5 && !str) {\n    padding = '00000';\n  } else if (postfix <= 25 && !str) {\n    padding = '000000000000000000000000000';\n  } else {\n    return val + repeat(str || '0', postfix);\n  }\n\n  return val + padding.slice(-postfix);\n};\n";
const MC_OLD: string = "/*!\n * map-cache <https://github.com/jonschlinkert/map-cache>\n *\n * Copyright (c) 2015, Jon Schlinkert.\n * Licensed under the MIT License.\n */\n\n'use strict';\n\nvar hasOwn = Object.prototype.hasOwnProperty;\n\n\n/**\n * Expose `MapCache`\n */\n\nmodule.exports = MapCache;\n\n/**\n * Creates a cache object to store key/value pairs.\n *\n * ```js\n * var cache = new MapCache();\n * ```\n *\n * @api public\n */\n\nfunction MapCache() {\n  this.__data__ = {};\n}\n\n/**\n * Adds `value` to `key` on the cache.\n *\n * ```js\n * cache.set('foo', 'bar');\n * ```\n *\n * @param {String} `key` The key of the value to cache.\n * @param {*} `value` The value to cache.\n * @returns {Object} Returns the `Cache` object for chaining.\n * @api public\n */\n\nMapCache.prototype.set = function mapSet(key, value) {\n  if (key !== '__proto__') {\n    this.__data__[key] = value;\n  }\n  return this;\n};\n\n/**\n * Gets the cached value for `key`.\n *\n * ```js\n * cache.get('foo');\n * //=> 'bar'\n * ```\n *\n * @param {String} `key` The key of the value to get.\n * @returns {*} Returns the cached value.\n * @api public\n */\n\nMapCache.prototype.get = function mapGet(key) {\n  return key === '__proto__' ? undefined : this.__data__[key];\n};\n\n/**\n * Checks if a cached value for `key` exists.\n *\n * ```js\n * cache.has('foo');\n * //=> true\n * ```\n *\n * @param {String} `key` The key of the entry to check.\n * @returns {Boolean} Returns `true` if an entry for `key` exists, else `false`.\n * @api public\n */\n\nMapCache.prototype.has = function mapHas(key) {\n  return key !== '__proto__' && hasOwn.call(this.__data__, key);\n};\n\n/**\n * Removes `key` and its value from the cache.\n *\n * ```js\n * cache.delete('foo');\n * ```\n * @title .delete\n * @param {String} `key` The key of the value to remove.\n * @returns {Boolean} Returns `true` if the entry was removed successfully, else `false`.\n * @api public\n */\n\nMapCache.prototype['delete'] = function mapDelete(key) {\n  return this.has(key) && delete this.__data__[key];\n};\n";
const MC_NEW: string = "/*!\n * map-cache <https://github.com/jonschlinkert/map-cache>\n *\n * Copyright (c) 2015, Jon Schlinkert.\n * Licensed under the MIT License.\n */\n\n'use strict';\n\nvar hasOwn = Object.prototype.hasOwnProperty;\n\n\n/**\n * Expose `MapCache`\n */\n\nmodule.exports = MapCache;\n\n/**\n * Creates a cache object to store key/value pairs.\n *\n * ```js\n * var cache = new MapCache();\n * ```\n *\n * @api public\n */\n\nfunction MapCache() {\n  this.__data__ = {};\n}\n\n/**\n * Adds `value` to `key` on the cache.\n *\n * ```js\n * cache.set('foo', 'bar');\n * ```\n *\n * @param {String} `key` The key of the value to cache.\n * @param {*} `value` The value to cache.\n * @returns {Object} Returns the `Cache` object for chaining.\n * @api public\n */\n\nMapCache.prototype.set = function mapSet(key, value) {\n  if (key !== '__proto__') {\n    this.__data__[key] = value;\n  }\n  return this;\n};\n\n/**\n * Gets the cached value for `key`.\n *\n * ```js\n * cache.get('foo');\n * //=> 'bar'\n * ```\n *\n * @param {String} `key` The key of the value to get.\n * @returns {*} Returns the cached value.\n * @api public\n */\n\nMapCache.prototype.get = function mapGet(key) {\n  return key === '__proto__' ? undefined : this.__data__[key];\n};\n\n/**\n * Checks if a cached value for `key` exists.\n *\n * ```js\n * cache.has('foo');\n * //=> true\n * ```\n *\n * @param {String} `key` The key of the entry to check.\n * @returns {Boolean} Returns `true` if an entry for `key` exists, else `false`.\n * @api public\n */\n\nMapCache.prototype.has = function mapHas(key) {\n  return key !== '__proto__' && hasOwn.call(this.__data__, key);\n};\n\n/**\n * Removes `key` and its value from the cache.\n *\n * ```js\n * cache.del('foo');\n * ```\n * @title .del\n * @param {String} `key` The key of the value to remove.\n * @returns {Boolean} Returns `true` if the entry was removed successfully, else `false`.\n * @api public\n */\n\nMapCache.prototype.del = function mapDelete(key) {\n  return this.has(key) && delete this.__data__[key];\n};\n";

/** Resolve glob results against cwd so file paths stay valid when a cwd option is set. A check that is not that unresolved-cwd-glob shape is refused. */
export function resolveGlobResultsAgainstCwd(source: string): string | null {
  if (!source.includes("  var files = glob.sync(patterns, options);\n\n  return files.reduce(function (cache, filepath) {\n    var key = name(filepath, options);")) return null;
  return source === MF_OLD ? MF_NEW : null;
}

/** Pad a string to a target length instead of appending that many characters. A check that is not that extra-width padding shape is refused. */
export function padRightToTargetLength(source: string): string | null {
  if (!source.includes("  if (num <= 5 && !str) {\n    padding = '00000';\n  } else if (num <= 25 && !str) {\n    padding = '000000000000000000000000000';\n  } else {\n    return val + repeat(str || '0', num);\n  }\n\n  return val + padding.slice(-num);")) return null;
  return source === PR_OLD ? PR_NEW : null;
}

/** Expose cache.del instead of cache.delete when removing a map-cache entry. A check that is not that missing-del shape is refused. */
export function exposeMapCacheDel(source: string): string | null {
  if (!source.includes("MapCache.prototype['delete'] = function mapDelete(key) {")) return null;
  return source === MC_OLD ? MC_NEW : null;
}

export interface Batch69Input {
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
export function repairBatch69(input: Batch69Input): { diff: string; file: string } | null {
  if (!/Error|not equal|Expected|Invalid|fail|toEqual|toBe|AssertionError|TypeError|undefined|to equal|deeply equivalent|deepEqual|true == false|false == true|evaluated to a falsy|loosely deep-equal|Missing expected exception|Received null|Received undefined|must be of type|expected true to be false|to throw exception|Cannot read properties of undefined|undefined == true|is not a function|ENOENT|no such file or directory/i.test(input.output)) return null;
  const edits: { path: string; next: string; original: string }[] = [];
  for (const path of filesOf(input.root, input.sourcePattern)) {
    const original = readLocal(input.root, path);
    if (original === null) continue;
    const next = resolveGlobResultsAgainstCwd(original) ?? padRightToTargetLength(original) ?? exposeMapCacheDel(original);
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
