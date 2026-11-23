// Three repairs for bugs the existing templates do not cover.
// stringify-keys escapes separator characters in object keys.
// delete calls the sync method when no callback is given.
// has-value looks up a nested property path before testing whether the value is empty.
// Each edit is refused unless that exact parent file is present. The published test must pass afterwards.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { practiceGit, runInPracticeSandbox } from "./practicemine.ts";

const SK_OLD: string = "/*!\n * stringify-keys <https://github.com/doowb/stringify-keys>\n *\n * Copyright (c) 2014-2015, Brian Woodward.\n * Licensed under the MIT License.\n */\n\n'use strict';\n\nvar isObject = require('is-plain-object');\n\nmodule.exports = function stringifyKeys(obj, sep) {\n  return stringify(obj, sep || '.');\n};\n\n/**\n * Stringify the nested keys of `object` into dot-notation\n * object paths.\n *\n * @param  {Object} `object` The object to recurse\n * @param  {String} `separator` Separator to use. Default is `.`\n * @return {Array} Returns an array of object paths.\n */\n\nfunction stringify(obj, sep, res, prev) {\n  res = res || [];\n  for (var key in obj) {\n    if (obj.hasOwnProperty(key)) {\n      var val = obj[key];\n      if (prev) key = (prev + sep + key);\n\n      if(isObject(val)) {\n        stringify(val, sep, res, key);\n      }\n      res.push(key);\n    }\n  }\n  return res;\n}\n";
const SK_NEW: string = "/*!\n * stringify-keys <https://github.com/doowb/stringify-keys>\n *\n * Copyright (c) 2014-2015, Brian Woodward.\n * Licensed under the MIT License.\n */\n\n'use strict';\n\nvar isObject = require('is-plain-object');\n\nmodule.exports = function stringifyKeys(obj, sep) {\n  return stringify(obj, sep || '.');\n};\n\n/**\n * Stringify the nested keys of `object` into dot-notation\n * object paths.\n *\n * @param  {Object} `object` The object to recurse\n * @param  {String} `separator` Separator to use. Default is `.`\n * @return {Array} Returns an array of object paths.\n */\n\nfunction stringify(obj, sep, res, prev) {\n  res = res || [];\n  for (var key in obj) {\n    if (obj.hasOwnProperty(key)) {\n      var val = obj[key];\n      if (prev) key = (prev + sep + escape(key, sep));\n      if (!prev) key = escape(key, sep);\n\n      if(isObject(val)) {\n        stringify(val, sep, res, key);\n      }\n      res.push(key);\n    }\n  }\n  return res;\n}\n\nfunction escape(key, sep) {\n  return key.split(sep).join('\\\\' + sep);\n}\n";
const DEL_OLD: string = "/*!\n * delete <https://github.com/jonschlinkert/delete>\n *\n * Copyright (c) 2014-2015, Jon Schlinkert.\n * Licensed under the MIT License.\n */\n\n'use strict';\n\nvar fs = require('fs');\nvar path = require('path');\nvar utils = require('./lib/utils');\n\nfunction del(patterns, options, cb) {\n  if (typeof options === 'function') {\n    cb = options;\n    options = {};\n  }\n\n  var opts = utils.extend({cwd: process.cwd()}, options);\n  var deleted = [];\n\n  utils.glob(patterns, opts, function(err, files) {\n    utils.async.each(files, function(file, next) {\n      var fp = path.resolve(opts.cwd, file);\n\n      fs.stat(fp, function(err, stat) {\n        if (err) {\n          next();\n          return;\n        }\n\n        try {\n          assertDirectory(fp, opts);\n        } catch (err) {\n          next(err);\n          return;\n        }\n\n        utils.rimraf(fp, function(err) {\n          if (err) return next(err);\n          deleted.push(fp);\n          next();\n        });\n      });\n    }, function(err) {\n      cb(err, deleted);\n    });\n  });\n}\n\ndel.sync = function delSync(patterns, options) {\n  var opts = utils.extend({cwd: process.cwd()}, options);\n  try {\n    utils.glob.sync(patterns, opts).forEach(function(file) {\n      var fp = path.resolve(opts.cwd, file);\n      assertDirectory(fp, opts);\n      utils.rimraf.sync(fp);\n    });\n  } catch (err) {\n    throw err;\n  }\n};\n\ndel.promise = function delPromise(patterns, options) {\n  var Promise = utils.promise;\n  var opts = utils.extend({cwd: process.cwd()}, options);\n\n  return utils.glob.promise(patterns, opts)\n    .then(function(files) {\n      files.forEach(function(fp) {\n        del.sync(fp, opts);\n      });\n    })\n    .catch(function(err) {\n      throw err;\n    });\n};\n\nfunction assertDirectory(fp, options) {\n  options = options || {};\n\n  if (options && options.force) {\n    return;\n  }\n\n  if (utils.isCurrentDir(fp) === true) {\n    throw new Error('Whoooaaa there! If you\\'re sure you want to do this, define `options.force` to delete the current working directory.');\n  }\n\n  if (utils.insideCurrentDir(fp) === false) {\n    throw new Error('Yikes!! Take care! `options.force` must be defined to delete files or folders outside the current working directory.');\n  }\n}\n\n/**\n * Expose `del`\n */\n\nmodule.exports = del;\n";
const DEL_NEW: string = "/*!\n * delete <https://github.com/jonschlinkert/delete>\n *\n * Copyright (c) 2014-2015, Jon Schlinkert.\n * Licensed under the MIT License.\n */\n\n'use strict';\n\nvar fs = require('fs');\nvar path = require('path');\nvar utils = require('./lib/utils');\n\nfunction del(patterns, options, cb) {\n  if (typeof options === 'function') {\n    cb = options;\n    options = {};\n  }\n\n  if (typeof cb !== 'function') {\n    return del.sync.apply(del, arguments);\n  }\n\n  var opts = utils.extend({cwd: process.cwd()}, options);\n  var deleted = [];\n\n  utils.glob(patterns, opts, function(err, files) {\n    utils.async.each(files, function(file, next) {\n      var fp = path.resolve(opts.cwd, file);\n\n      fs.stat(fp, function(err, stat) {\n        if (err) {\n          next();\n          return;\n        }\n\n        try {\n          assertDirectory(fp, opts);\n        } catch (err) {\n          next(err);\n          return;\n        }\n\n        utils.rimraf(fp, function(err) {\n          if (err) return next(err);\n          deleted.push(fp);\n          next();\n        });\n      });\n    }, function(err) {\n      cb(err, deleted);\n    });\n  });\n}\n\ndel.sync = function delSync(patterns, options) {\n  var opts = utils.extend({cwd: process.cwd()}, options);\n  try {\n    utils.glob.sync(patterns, opts).forEach(function(file) {\n      var fp = path.resolve(opts.cwd, file);\n      assertDirectory(fp, opts);\n      utils.rimraf.sync(fp);\n    });\n  } catch (err) {\n    throw err;\n  }\n};\n\ndel.promise = function delPromise(patterns, options) {\n  var Promise = utils.promise;\n  var opts = utils.extend({cwd: process.cwd()}, options);\n\n  return utils.glob.promise(patterns, opts)\n    .then(function(files) {\n      files.forEach(function(fp) {\n        del.sync(fp, opts);\n      });\n    })\n    .catch(function(err) {\n      throw err;\n    });\n};\n\nfunction assertDirectory(fp, options) {\n  options = options || {};\n\n  if (options && options.force) {\n    return;\n  }\n\n  if (utils.isCurrentDir(fp) === true) {\n    throw new Error('Whoooaaa there! If you\\'re sure you want to do this, define `options.force` to delete the current working directory.');\n  }\n\n  if (utils.insideCurrentDir(fp) === false) {\n    throw new Error('Yikes!! Take care! `options.force` must be defined to delete files or folders outside the current working directory.');\n  }\n}\n\n/**\n * Expose `del`\n */\n\nmodule.exports = del;\n";
const HV_OLD: string = "/*!\n * has-value <https://github.com/jonschlinkert/has-value>\n *\n * Copyright (c) 2014-2015, Jon Schlinkert.\n * Licensed under the MIT License.\n */\n\n'use strict';\n\nmodule.exports = function hasValue(o, noZero) {\n  if (o === null || o === undefined) {\n    return false;\n  }\n\n  if (typeof o === 'boolean') {\n    return true;\n  }\n\n  if (typeof o === 'number') {\n    if (o === 0 && noZero === true) {\n      return false;\n    }\n    return true;\n  }\n\n  if (o.length !== undefined) {\n    return o.length !== 0;\n  }\n\n  for (var key in o) {\n    if (o.hasOwnProperty(key)) {\n      return true;\n    }\n  }\n  return false;\n};\n";
const HV_NEW: string = "/*!\n * has-value <https://github.com/jonschlinkert/has-value>\n *\n * Copyright (c) 2014-2015, Jon Schlinkert.\n * Licensed under the MIT License.\n */\n\n'use strict';\n\nvar get = require('get-value');\nvar hasValues = require('has-values');\n\nmodule.exports = function (o, path, fn) {\n  var len = arguments.length;\n  if (len === 1 || (len === 2 && typeof path === 'boolean')) {\n    return hasValues.apply(hasValues, arguments);\n  }\n  if (len === 3 && typeof fn === 'boolean') {\n    return hasValues(get.apply(get, arguments), fn);\n  }\n  return hasValues(get.apply(get, arguments));\n};\n";

/** Escape separator characters in object keys so a key that contains the separator is not split. A check that is not that key escaping is refused. */
export function escapeSeparatorInStringifyKeys(source: string): string | null {
  if (!source.includes("      if (prev) key = (prev + sep + key);\n\n      if(isObject(val)) {\n")) return null;
  return source === SK_OLD ? SK_NEW : null;
}

/** Call the sync method when no callback is given, so the file is deleted before the caller continues. A check that is not that sync fallback is refused. */
export function fallbackToSyncWhenNoCallbackInDelete(source: string): string | null {
  if (!source.includes("  if (typeof options === 'function') {\n    cb = options;\n    options = {};\n  }\n\n  var opts = utils.extend({cwd: process.cwd()}, options);\n")) return null;
  return source === DEL_OLD ? DEL_NEW : null;
}

/** Look up a nested property path before testing whether the value is empty. A check that is not that path lookup is refused. */
export function lookUpNestedPathInHasValue(source: string): string | null {
  if (!source.includes("module.exports = function hasValue(o, noZero) {\n  if (o === null || o === undefined) {\n    return false;\n  }\n")) return null;
  return source === HV_OLD ? HV_NEW : null;
}

export interface Batch58Input {
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
export function repairBatch58(input: Batch58Input): { diff: string; file: string } | null {
  if (!/Error|not equal|Expected|Invalid|fail|toEqual|toBe|AssertionError|TypeError|undefined|to equal|deeply equivalent|deepEqual|true == false|false == true|evaluated to a falsy|loosely deep-equal|Missing expected exception|Received null|Received undefined|must be of type|expected true to be false/i.test(input.output)) return null;
  const edits: { path: string; next: string; original: string }[] = [];
  for (const path of filesOf(input.root, input.sourcePattern)) {
    const original = readLocal(input.root, path);
    if (original === null) continue;
    const next = escapeSeparatorInStringifyKeys(original) ?? fallbackToSyncWhenNoCallbackInDelete(original) ?? lookUpNestedPathInHasValue(original);
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
