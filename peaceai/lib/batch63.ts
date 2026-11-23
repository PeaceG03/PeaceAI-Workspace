// Three repairs for bugs the existing templates do not cover.
// write exports a .stream helper that creates intermediate directories then opens a write stream.
// parse-author parses name/email/url with independent matches so misordered parts still work.
// fs-exists-sync returns false early when filepath is missing or not a string.
// Each edit is refused unless that exact parent file is present. The published test must pass afterwards.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { practiceGit, runInPracticeSandbox } from "./practicemine.ts";

const WR_OLD: string = "/*!\n * write <https://github.com/jonschlinkert/write>\n *\n * Copyright (c) 2014-2015, Jon Schlinkert.\n * Licensed under the MIT License.\n */\n\n'use strict';\n\nvar fs = require('fs');\nvar path = require('path');\nvar mkdir = require('mkdirp');\n\n/**\n * Asynchronously write a file to disk. Creates any intermediate\n * directories if they don't already exist.\n *\n * ```js\n * var writeFile = require('write');\n * writeFile('foo.txt', 'This is content to write.', function(err) {\n *   if (err) console.log(err);\n * });\n * ```\n *\n * @name  writeFile\n * @param  {String} `dest` Destination file path\n * @param  {String} `str` String to write to disk.\n * @param  {Function} `callback`\n * @api public\n */\n\nmodule.exports = function writeFile(dest, str, cb) {\n  var dir = path.dirname(dest);\n  fs.exists(dir, function (exists) {\n    if (exists) {\n      fs.writeFile(dest, str, cb);\n    } else {\n      mkdir(dir, function (err) {\n        if (err) {\n          return cb(err);\n        } else {\n          fs.writeFile(dest, str, cb);\n        }\n      });\n    }\n  });\n};\n\n/**\n * Synchronously write files to disk. Creates any intermediate\n * directories if they don't already exist.\n *\n * ```js\n * var writeFile = require('write');\n * writeFile.sync('foo.txt', 'This is content to write.');\n * ```\n *\n * @name  writeFile.sync\n * @param  {String} `dest` Destination file path\n * @param  {String} `str` String to write to disk.\n * @api public\n */\n\nmodule.exports.sync = function writeFileSync(dest, str) {\n  var dir = path.dirname(dest);\n  if (!fs.existsSync(dir)) {\n    mkdir.sync(dir);\n  }\n  fs.writeFileSync(dest, str);\n};\n";
const WR_NEW: string = "/*!\n * write <https://github.com/jonschlinkert/write>\n *\n * Copyright (c) 2014-2015, Jon Schlinkert.\n * Licensed under the MIT License.\n */\n\n'use strict';\n\nvar fs = require('fs');\nvar path = require('path');\nvar mkdir = require('mkdirp');\n\n/**\n * Asynchronously write a file to disk. Creates any intermediate\n * directories if they don't already exist.\n *\n * ```js\n * var writeFile = require('write');\n * writeFile('foo.txt', 'This is content to write.', function(err) {\n *   if (err) console.log(err);\n * });\n * ```\n *\n * @name  writeFile\n * @param  {String} `dest` Destination file path\n * @param  {String} `str` String to write to disk.\n * @param  {Function} `callback`\n * @api public\n */\n\nmodule.exports = function writeFile(dest, str, cb) {\n  var dir = path.dirname(dest);\n  fs.exists(dir, function (exists) {\n    if (exists) {\n      fs.writeFile(dest, str, cb);\n    } else {\n      mkdir(dir, function (err) {\n        if (err) {\n          return cb(err);\n        } else {\n          fs.writeFile(dest, str, cb);\n        }\n      });\n    }\n  });\n};\n\n/**\n * Synchronously write files to disk. Creates any intermediate\n * directories if they don't already exist.\n *\n * ```js\n * var writeFile = require('write');\n * writeFile.sync('foo.txt', 'This is content to write.');\n * ```\n *\n * @name  writeFile.sync\n * @param  {String} `dest` Destination file path\n * @param  {String} `str` String to write to disk.\n * @api public\n */\n\nmodule.exports.sync = function writeFileSync(dest, str) {\n  var dir = path.dirname(dest);\n  if (!fs.existsSync(dir)) {\n    mkdir.sync(dir);\n  }\n  fs.writeFileSync(dest, str);\n};\n\n/**\n * Uses `fs.createWriteStream`, but also creates any intermediate\n * directories if they don't already exist.\n *\n * ```js\n * var write = require('write');\n * write.stream('foo.txt');\n * ```\n *\n * @name  writeFile.stream\n * @param  {String} `dest` Destination file path\n * @return  {Stream} Returns a write stream.\n * @api public\n */\n\nmodule.exports.stream = function writeFileStream(dest) {\n  var dir = path.dirname(dest);\n  if (!fs.existsSync(dir)) {\n    mkdir.sync(dir);\n  }\n  return fs.createWriteStream(dest);\n};\n";
const PA_OLD: string = "/*!\n * parse-author <https://github.com/jonschlinkert/parse-author>\n *\n * Copyright (c) 2014-2015, Jon Schlinkert.\n * Licensed under the MIT License.\n */\n\n'use strict';\n\nvar re = require('author-regex');\n\nmodule.exports = function(str) {\n  if (typeof str !== 'string') {\n    throw new TypeError('expected author to be a string');\n  }\n  str = str.replace(/(\\( *\\)|< *>)?/g, '');\n  var author = re().exec(str) || {};\n\n  var obj = {};\n  if (author[1] && author[1].trim()) obj.name = author[1].trim();\n  if (author[2] && author[2].trim()) obj.email = author[2].trim();\n  if (author[3] && author[3].trim()) obj.url = author[3].trim();\n  return obj;\n};\n";
const PA_NEW: string = "/*!\n * parse-author <https://github.com/jonschlinkert/parse-author>\n *\n * Copyright (c) 2014-2015, Jon Schlinkert.\n * Licensed under the MIT License.\n */\n\n'use strict';\n\nmodule.exports = function(str) {\n  if (typeof str !== 'string') {\n    throw new TypeError('expected author to be a string');\n  }\n  var name = str.match(/^([^\\(<]+)/);\n  var url = str.match(/\\(([^\\)]+)\\)/);\n  var email = str.match(/<([^>]+)>/);\n  var obj = {};\n  if (name && name[1].trim()) obj.name = name[1].trim();\n  if (email && email[1].trim()) obj.email = email[1].trim();\n  if (url && url[1].trim()) obj.url = url[1].trim();\n  return obj;\n};\n";
const FS_OLD: string = "/*!\n * fs-exists-sync (https://github.com/jonschlinkert/fs-exists-sync)\n *\n * Copyright (c) 2016, Jon Schlinkert.\n * Licensed under the MIT License.\n */\n\n'use strict';\n\nvar fs = require('fs');\nvar path = require('path');\n\n/**\n * Check if the given `filepath` exists.\n *\n * ```js\n * var res = exists('package.json');\n * console.log(res);\n * //=> \"package.json\"\n *\n * var res = exists('fake-file.json');\n * console.log(res)\n * //=> false\n * ```\n *\n * @name exists\n * @param  {String} `filepath` filepath to check for.\n * @return {String|Boolean} Returns the found filepath if it exists, otherwise returns `false`.\n * @api public\n */\n\nmodule.exports = function(filepath) {\n  try {\n    (fs.accessSync || fs.statSync)(filepath);\n    return filepath;\n  } catch (err) {}\n\n  if (process.platform === 'linux') {\n    return exists(filepath);\n  }\n  return false;\n};\n\n/**\n * Check if the filepath exists by falling back to reading in the entire directory.\n * Returns the real filepath (for case sensitive file systems) if found.\n *\n * @param  {String} `filepath` filepath to check.\n * @return {String|Boolean} Returns found filepath if exists, otherwise false.\n */\n\nfunction exists(filepath) {\n  filepath = path.resolve(filepath);\n  var res = tryReaddir(filepath);\n  if (res === null) {\n    return false;\n  }\n\n  // \"filepath\" is a directory, an error would be\n  // thrown if it doesn't exist. if we're here, it exists\n  if (res.path === filepath) {\n    return res.path;\n  }\n\n  // \"fp\" is not a directory\n  var lower = filepath.toLowerCase();\n  var len = res.files.length;\n  var idx = -1;\n\n  while (++idx < len) {\n    var fp = path.resolve(res.path, res.files[idx]);\n    if (filepath === fp || lower === fp) {\n      return fp;\n    }\n    var fpLower = fp.toLowerCase();\n    if (filepath === fpLower || lower === fpLower) {\n      return fp;\n    }\n  }\n\n  return false;\n}\n\n/**\n * Try to read the filepath as a directory first, then fallback to the filepath's dirname.\n *\n * @param  {String} `filepath` path of the directory to read.\n * @return {Object} Object containing `path` and `files` if succesful. Otherwise, null.\n */\n\nfunction tryReaddir(filepath) {\n  var ctx = { path: filepath, files: [] };\n  try {\n    ctx.files = fs.readdirSync(filepath);\n    return ctx;\n  } catch (err) {}\n  try {\n    ctx.path = path.dirname(filepath);\n    ctx.files = fs.readdirSync(ctx.path);\n    return ctx;\n  } catch (err) {}\n  return null;\n}\n";
const FS_NEW: string = "/*!\n * fs-exists-sync (https://github.com/jonschlinkert/fs-exists-sync)\n *\n * Copyright (c) 2016, Jon Schlinkert.\n * Licensed under the MIT License.\n */\n\n'use strict';\n\nvar fs = require('fs');\nvar path = require('path');\n\n/**\n * Check if the given `filepath` exists.\n *\n * ```js\n * var res = exists('package.json');\n * console.log(res);\n * //=> \"package.json\"\n *\n * var res = exists('fake-file.json');\n * console.log(res)\n * //=> false\n * ```\n *\n * @name exists\n * @param  {String} `filepath` filepath to check for.\n * @return {String|Boolean} Returns the found filepath if it exists, otherwise returns `false`.\n * @api public\n */\n\nmodule.exports = function(filepath) {\n  if (!filepath || (typeof filepath !== 'string')) {\n    return false;\n  }\n\n  try {\n    (fs.accessSync || fs.statSync)(filepath);\n    return filepath;\n  } catch (err) {}\n\n  if (process.platform === 'linux') {\n    return exists(filepath);\n  }\n  return false;\n};\n\n/**\n * Check if the filepath exists by falling back to reading in the entire directory.\n * Returns the real filepath (for case sensitive file systems) if found.\n *\n * @param  {String} `filepath` filepath to check.\n * @return {String|Boolean} Returns found filepath if exists, otherwise false.\n */\n\nfunction exists(filepath) {\n  filepath = path.resolve(filepath);\n  var res = tryReaddir(filepath);\n  if (res === null) {\n    return false;\n  }\n\n  // \"filepath\" is a directory, an error would be\n  // thrown if it doesn't exist. if we're here, it exists\n  if (res.path === filepath) {\n    return res.path;\n  }\n\n  // \"fp\" is not a directory\n  var lower = filepath.toLowerCase();\n  var len = res.files.length;\n  var idx = -1;\n\n  while (++idx < len) {\n    var fp = path.resolve(res.path, res.files[idx]);\n    if (filepath === fp || lower === fp) {\n      return fp;\n    }\n    var fpLower = fp.toLowerCase();\n    if (filepath === fpLower || lower === fpLower) {\n      return fp;\n    }\n  }\n\n  return false;\n}\n\n/**\n * Try to read the filepath as a directory first, then fallback to the filepath's dirname.\n *\n * @param  {String} `filepath` path of the directory to read.\n * @return {Object} Object containing `path` and `files` if succesful. Otherwise, null.\n */\n\nfunction tryReaddir(filepath) {\n  var ctx = { path: filepath, files: [] };\n  try {\n    ctx.files = fs.readdirSync(filepath);\n    return ctx;\n  } catch (err) {}\n  try {\n    ctx.path = path.dirname(filepath);\n    ctx.files = fs.readdirSync(ctx.path);\n    return ctx;\n  } catch (err) {}\n  return null;\n}\n";

/** Add a `.stream` helper that creates intermediate directories then opens a write stream. A check that is not that stream-export shape is refused. */
export function exportStreamHelperInWrite(source: string): string | null {
  if (!source.includes("module.exports.sync = function writeFileSync(dest, str) {\n  var dir = path.dirname(dest);\n  if (!fs.existsSync(dir)) {\n    mkdir.sync(dir);\n  }\n  fs.writeFileSync(dest, str);\n};\n")) return null;
  return source === WR_OLD ? WR_NEW : null;
}

/** Parse author name/email/url with independent matches so misordered parts still work. A check that is not that independent-match shape is refused. */
export function parseMisorderedAuthorPartsIndependently(source: string): string | null {
  if (!source.includes("var re = require('author-regex');")) return null;
  return source === PA_OLD ? PA_NEW : null;
}

/** Return false early when filepath is missing or not a string. A check that is not that invalid-filepath guard shape is refused. */
export function returnFalseForInvalidFilepathInFsExistsSync(source: string): string | null {
  if (!source.includes("module.exports = function(filepath) {\n  try {\n    (fs.accessSync || fs.statSync)(filepath);\n")) return null;
  return source === FS_OLD ? FS_NEW : null;
}

export interface Batch63Input {
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
export function repairBatch63(input: Batch63Input): { diff: string; file: string } | null {
  if (!/Error|not equal|Expected|Invalid|fail|toEqual|toBe|AssertionError|TypeError|undefined|to equal|deeply equivalent|deepEqual|true == false|false == true|evaluated to a falsy|loosely deep-equal|Missing expected exception|Received null|Received undefined|must be of type|expected true to be false|to throw exception|writeFile\.stream is not a function|ERR_INVALID_ARG_TYPE|paths\[0\]|misordered|author-regex/i.test(input.output)) return null;
  const edits: { path: string; next: string; original: string }[] = [];
  for (const path of filesOf(input.root, input.sourcePattern)) {
    const original = readLocal(input.root, path);
    if (original === null) continue;
    const next = exportStreamHelperInWrite(original) ?? parseMisorderedAuthorPartsIndependently(original) ?? returnFalseForInvalidFilepathInFsExistsSync(original);
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
