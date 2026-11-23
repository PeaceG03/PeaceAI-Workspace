// Three repairs for bugs the existing templates do not cover.
// is-directory treats a missing path as false and reports invalid async arguments through the callback.
// lazy-cache accepts an alias as the second argument.
// regex-not throws when a potentially unsafe pattern is compiled.
// Each edit is refused unless that exact parent file is present. The published test must pass afterwards.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { practiceGit, runInPracticeSandbox } from "./practicemine.ts";

const ID_OLD: string = "/*!\n * is-directory <https://github.com/jonschlinkert/is-directory>\n *\n * Copyright (c) 2014-2015, Jon Schlinkert.\n * Licensed under the MIT License.\n */\n\n'use strict';\n\nvar fs = require('fs');\n\n/**\n * Expose `isDir`\n */\n\nmodule.exports = isDir;\n\n/**\n * async\n */\n\nfunction isDir(fp, cb) {\n  if (typeof fp !== 'string') {\n    throw new Error('is-directory async expects filepath to be a string.');\n  }\n\n  if (typeof cb !== 'function') {\n    throw new Error('is-directory async expects a callback function.');\n  }\n\n  fs.stat(fp, function(err, stats) {\n    if (err) return cb(err);\n    cb(null, stats.isDirectory());\n    return;\n  });\n}\n\n/**\n * sync\n */\n\nisDir.sync = function isDirSync(fp) {\n  if (typeof fp !== 'string') {\n    throw new Error('is-directory sync expects filepath to be a string.');\n  }\n  try {\n    return fs.statSync(fp).isDirectory();\n  } catch(err) {}\n  return false;\n};\n";
const ID_NEW: string = "/*!\n * is-directory <https://github.com/jonschlinkert/is-directory>\n *\n * Copyright (c) 2014-2015, Jon Schlinkert.\n * Licensed under the MIT License.\n */\n\n'use strict';\n\nvar fs = require('fs');\n\n/**\n * async\n */\n\nfunction isDirectory(filepath, cb) {\n  if (typeof cb !== 'function') {\n    throw new Error('expected a callback function');\n  }\n\n  if (typeof filepath !== 'string') {\n    cb(new Error('expected filepath to be a string'));\n    return;\n  }\n\n  fs.stat(filepath, function(err, stats) {\n    if (err) {\n      if (err.code === 'ENOENT') {\n        cb(null, false);\n        return;\n      }\n      cb(err);\n      return;\n    }\n    cb(null, stats.isDirectory());\n  });\n}\n\n/**\n * sync\n */\n\nisDirectory.sync = function isDirectorySync(filepath) {\n  if (typeof filepath !== 'string') {\n    throw new Error('expected filepath to be a string');\n  }\n\n  try {\n    var stat = fs.statSync(filepath);\n    return stat.isDirectory();\n  } catch (err) {\n    if (err.code === 'ENOENT') {\n      return false;\n    } else {\n      throw err;\n    }\n  }\n  return false;\n};\n\n/**\n * Expose `isDirectory`\n */\n\nmodule.exports = isDirectory;\n";
const LC_OLD: string = "'use strict';\nvar colors = lazyCache(require);\ncolors('ansi-yellow');\n\n/**\n * Cache results of the first function call to ensure only calling once.\n *\n * ```js\n * // cache the call to `require('ansi-yellow')`\n * var lazy = lazyCache(require);\n * lazy('ansi-yellow');\n * // use `ansi-yello`\n * console.log(lazy.ansiYellow('this is yellow'));\n * ```\n *\n * @param  {Function} `fn` Function that will be called only once.\n * @return {Function} Function that can be called to get the cached function\n * @api public\n */\n\nfunction lazyCache(fn) {\n  var cache = {};\n  var lazy = function (name) {\n    Object.defineProperty(lazy, camelcase(name), {\n      get: getter\n    });\n\n    function getter () {\n      if (cache.hasOwnProperty(name)) {\n        return cache[name];\n      }\n      try {\n        return (cache[name] = fn(name));\n      } catch (err) {\n        console.log(colors.ansiYellow(err));\n        return;\n      }\n    };\n    return getter;\n  };\n  return lazy;\n}\n\n/**\n * Used to camelcase the name to be stored on the `lazy` object.\n *\n * @param  {String} `str` String containing `_`, `.`, `-` or whitespace that will be camelcased.\n * @return {String} camelcased string.\n */\n\nfunction camelcase(str) {\n  return str.replace(/[_.-](\\w|$)/g, function (_, first) {\n    return first.toUpperCase();\n  });\n}\n\n\n/**\n * Expose `lazyCache`\n */\n\nmodule.exports = lazyCache;\n";
const LC_NEW: string = "'use strict';\n\n/**\n * Cache results of the first function call to ensure only calling once.\n *\n * ```js\n * var lazy = require('lazy-cache')(require);\n * // cache the call to `require('ansi-yellow')`\n * lazy('ansi-yellow', 'yellow');\n * // use `ansi-yellow`\n * console.log(lazy.yellow('this is yellow'));\n * ```\n *\n * @param  {Function} `fn` Function that will be called only once.\n * @return {Function} Function that can be called to get the cached function\n * @api public\n */\n\nfunction lazyCache(fn) {\n  var cache = {};\n  var proxy = function (mod, name) {\n    name = name || mod;\n    Object.defineProperty(proxy, camelcase(name), {\n      get: getter\n    });\n\n    function getter () {\n      if (cache.hasOwnProperty(name)) {\n        return cache[name];\n      }\n      try {\n        return (cache[name] = fn(mod));\n      } catch (err) {\n        err.message = 'lazy-cache ' + err.message + ' ' + __filename;\n        throw err;\n      }\n    };\n    return getter;\n  };\n  return proxy;\n}\n\n/**\n * Used to camelcase the name to be stored on the `lazy` object.\n *\n * @param  {String} `str` String containing `_`, `.`, `-` or whitespace that will be camelcased.\n * @return {String} camelcased string.\n */\n\nfunction camelcase(str) {\n  if (str.length === 1) { return str.toLowerCase(); }\n  str = str.replace(/^[\\W_]+|[\\W_]+$/g, '').toLowerCase();\n  return str.replace(/[\\W_]+(\\w|$)/g, function (_, ch) {\n    return ch.toUpperCase();\n  });\n}\n\n/**\n * Expose `lazyCache`\n */\n\nmodule.exports = lazyCache;\n";
const RN_OLD: string = "'use strict';\n\nvar extend = require('extend-shallow');\n\n/**\n * The main export is a function that takes a `pattern` string and an `options` object.\n *\n * ```js\n & var not = require('regex-not');\n & console.log(not('foo'));\n & //=> /^(?:(?!^(?:foo)$).)*$/\n * ```\n *\n * @param {String} `pattern`\n * @param {Object} `options`\n * @return {RegExp} Converts the given `pattern` to a regex using the specified `options`.\n * @api public\n */\n\nfunction toRegex(pattern, options) {\n  return new RegExp(toRegex.create(pattern, options));\n}\n\n/**\n * Create a regex-compatible string from the given `pattern` and `options`.\n *\n * ```js\n & var not = require('regex-not');\n & console.log(not.create('foo'));\n & //=> '^(?:(?!^(?:foo)$).)*$'\n * ```\n * @param {String} `pattern`\n * @param {Object} `options`\n * @return {String}\n * @api public\n */\n\ntoRegex.create = function(pattern, options) {\n  if (typeof pattern !== 'string') {\n    throw new TypeError('expected a string');\n  }\n\n  var opts = extend({}, options);\n  if (opts && opts.contains === true) {\n    opts.strictNegate = false;\n  }\n\n  var open = opts.strictOpen !== false ? '^' : '';\n  var close = opts.strictClose !== false ? '$' : '';\n  var endChar = opts.endChar ? opts.endChar : '+';\n  var str = pattern;\n\n  if (opts && opts.strictNegate === false) {\n    str = '(?:(?!(?:' + pattern + ')).)' + endChar;\n  } else {\n    str = '(?:(?!^(?:' + pattern + ')$).)' + endChar;\n  }\n\n  return open + str + close;\n};\n\n/**\n * Expose `toRegex`\n */\n\nmodule.exports = toRegex;\n";
const RN_NEW: string = "'use strict';\n\nvar extend = require('extend-shallow');\nvar safe = require('safe-regex');\n\n/**\n * The main export is a function that takes a `pattern` string and an `options` object.\n *\n * ```js\n & var not = require('regex-not');\n & console.log(not('foo'));\n & //=> /^(?:(?!^(?:foo)$).)*$/\n * ```\n *\n * @param {String} `pattern`\n * @param {Object} `options`\n * @return {RegExp} Converts the given `pattern` to a regex using the specified `options`.\n * @api public\n */\n\nfunction toRegex(pattern, options) {\n  return new RegExp(toRegex.create(pattern, options));\n}\n\n/**\n * Create a regex-compatible string from the given `pattern` and `options`.\n *\n * ```js\n & var not = require('regex-not');\n & console.log(not.create('foo'));\n & //=> '^(?:(?!^(?:foo)$).)*$'\n * ```\n * @param {String} `pattern`\n * @param {Object} `options`\n * @return {String}\n * @api public\n */\n\ntoRegex.create = function(pattern, options) {\n  if (typeof pattern !== 'string') {\n    throw new TypeError('expected a string');\n  }\n\n  var opts = extend({}, options);\n  if (opts.contains === true) {\n    opts.strictNegate = false;\n  }\n\n  var open = opts.strictOpen !== false ? '^' : '';\n  var close = opts.strictClose !== false ? '$' : '';\n  var endChar = opts.endChar ? opts.endChar : '+';\n  var str = pattern;\n\n  if (opts.strictNegate === false) {\n    str = '(?:(?!(?:' + pattern + ')).)' + endChar;\n  } else {\n    str = '(?:(?!^(?:' + pattern + ')$).)' + endChar;\n  }\n\n  var res = open + str + close;\n  if (opts.safe !== false && safe(res) === false) {\n    throw new Error('potentially unsafe regular expression: ' + res);\n  }\n\n  return res;\n};\n\n/**\n * Expose `toRegex`\n */\n\nmodule.exports = toRegex;\n";

/** Treat a missing path as false and report invalid async arguments through the callback. A check that is not that missing-path handling is refused. */
export function returnFalseForMissingPathInIsDirectory(source: string): string | null {
  if (!source.includes("    throw new Error('is-directory async expects filepath to be a string.');\n")) return null;
  return source === ID_OLD ? ID_NEW : null;
}

/** Accept an alias as the second lazy-cache argument so the property can use that name. A check that is not that alias argument is refused. */
export function allowAliasInLazyCache(source: string): string | null {
  if (!source.includes("  var lazy = function (name) {\n    Object.defineProperty(lazy, camelcase(name), {\n")) return null;
  return source === LC_OLD ? LC_NEW : null;
}

/** Throw when a potentially unsafe regex is compiled. A check that is not that unsafe-pattern throw is refused. */
export function throwOnUnsafePatternInRegexNot(source: string): string | null {
  if (!source.includes("  if (opts && opts.contains === true) {\n")) return null;
  return source === RN_OLD ? RN_NEW : null;
}

export interface Batch53Input {
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
export function repairBatch53(input: Batch53Input): { diff: string; file: string } | null {
  if (!/Error|not equal|Expected|Invalid|fail|toEqual|toBe|AssertionError|TypeError|undefined|to equal|deeply equivalent|deepEqual|true == false|false == true|evaluated to a falsy|loosely deep-equal|Missing expected exception|Received null|Received undefined|must be of type/i.test(input.output)) return null;
  const edits: { path: string; next: string; original: string }[] = [];
  for (const path of filesOf(input.root, input.sourcePattern)) {
    const original = readLocal(input.root, path);
    if (original === null) continue;
    const next = returnFalseForMissingPathInIsDirectory(original) ?? allowAliasInLazyCache(original) ?? throwOnUnsafePatternInRegexNot(original);
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
