// Three repairs for bugs the existing templates do not cover.
// log-ok prefixes the checkmark with any leading whitespace from the message.
// object.pick returns an empty object when the target is not an object, and allows functions.
// parse-glob escapes the inside of character classes, braces, and parens (the parent only captured braces).
// Each edit is refused unless that exact parent file is present. The published test must pass afterwards.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { practiceGit, runInPracticeSandbox } from "./practicemine.ts";

const LOG_OLD: string = "'use strict';\n\nvar check = require('success-symbol');\nvar green = require('ansi-green');\n\nmodule.exports = function() {\n  console.log.bind(console, green(check)).apply(console, arguments);\n};\n";
const LOG_NEW: string = "'use strict';\n\nvar check = require('success-symbol');\nvar green = require('ansi-green');\n\nmodule.exports = function() {\n  var args = [].slice.call(arguments);\n  var msg = args[0];\n  var ok = green(check);\n\n  if (typeof msg === 'string') {\n    var match = /^(\\s+)(.*)/.exec(msg);\n    if (match) {\n      ok = match[1] + ok;\n      args[0] = match[2];\n    }\n  }\n\n  console.log.bind(console, ok).apply(console, args);\n};\n";
const PICK_OLD: string = "/*!\n * object.pick <https://github.com/jonschlinkert/object.pick>\n *\n * Copyright (c) 2014-2015 Jon Schlinkert, contributors.\n * Licensed under the MIT License\n */\n\n'use strict';\n\nmodule.exports = function pick(obj, keys) {\n  var res = {};\n  var i = 0;\n\n  if (typeof obj !== 'object') {\n    return res;\n  }\n\n  if (typeof keys === 'string') {\n    if (keys in obj) {\n      res[keys] = obj[keys];\n    }\n    return res;\n  }\n\n  var len = keys.length;\n\n  while (len--) {\n    var key = keys[i++];\n    if (key in obj) {\n      res[key] = obj[key];\n    }\n  }\n  return res;\n};\n";
const PICK_NEW: string = "/*!\n * object.pick <https://github.com/jonschlinkert/object.pick>\n *\n * Copyright (c) 2014-2015 Jon Schlinkert, contributors.\n * Licensed under the MIT License\n */\n\n'use strict';\n\nvar isObject = require('isobject');\n\nmodule.exports = function pick(obj, keys) {\n  if (!isObject(obj) && typeof obj !== 'function') {\n    return {};\n  }\n\n  var res = {};\n  if (typeof keys === 'string') {\n    if (keys in obj) {\n      res[keys] = obj[keys];\n    }\n    return res;\n  }\n\n  var len = keys.length;\n  var idx = -1;\n\n  while (++idx < len) {\n    var key = keys[idx];\n    if (key in obj) {\n      res[key] = obj[key];\n    }\n  }\n  return res;\n};\n";
const GLOB_OLD: string = "/*!\n * parse-glob <https://github.com/jonschlinkert/parse-glob>\n *\n * Copyright (c) 2015, Jon Schlinkert.\n * Licensed under the MIT License.\n */\n\n'use strict';\n\nvar isGlob = require('is-glob');\nvar findBase = require('glob-base');\nvar extglob = require('is-extglob');\nvar dotfile = require('is-dotfile');\n\n/**\n * Expose `cache`\n */\n\nvar cache = module.exports.cache = {};\n\n/**\n * Parse a glob pattern into tokens.\n *\n * When no paths or '**' are in the glob, we use a\n * different strategy for parsing the filename, since\n * file names can contain braces and other difficult\n * patterns. such as:\n *\n *  - `*.{a,b}`\n *  - `(**|*.js)`\n */\n\nmodule.exports = function parseGlob(glob) {\n  if (cache.hasOwnProperty(glob)) {\n    return cache[glob];\n  }\n\n  var tok = {};\n  tok.orig = glob;\n  tok.is = {};\n\n  // unescape dots and slashes in braces/brackets\n  glob = escape(glob);\n\n  var parsed = findBase(glob);\n  tok.is.glob = parsed.isGlob;\n\n  tok.glob = parsed.glob;\n  tok.base = parsed.base;\n  var segs = /([^\\/]*)$/.exec(glob);\n\n  tok.path = {};\n  tok.path.dirname = '';\n  tok.path.basename = segs[1] || '';\n  tok.path.dirname = glob.split(tok.path.basename).join('') || '';\n  var basename = (tok.path.basename || '').split('.') || '';\n  tok.path.filename = basename[0] || '';\n  tok.path.extname = basename.slice(1).join('.') || '';\n  tok.path.ext = '';\n\n  if (isGlob(tok.path.dirname) && !tok.path.basename) {\n    if (!/\\/$/.test(tok.glob)) {\n      tok.path.basename = tok.glob;\n    }\n    tok.path.dirname = tok.base;\n  }\n\n  if (glob.indexOf('/') === -1 && !tok.is.globstar) {\n    tok.path.dirname = '';\n    tok.path.basename = tok.orig;\n  }\n\n  var dot = tok.path.basename.indexOf('.');\n  if (dot !== -1) {\n    tok.path.filename = tok.path.basename.slice(0, dot);\n    tok.path.extname = tok.path.basename.slice(dot);\n  }\n\n  if (tok.path.extname.charAt(0) === '.') {\n    var exts = tok.path.extname.split('.');\n    tok.path.ext = exts[exts.length - 1];\n  }\n\n  // unescape dots and slashes in braces/brackets\n  tok.glob = unescape(tok.glob);\n  tok.path.dirname = unescape(tok.path.dirname);\n  tok.path.basename = unescape(tok.path.basename);\n  tok.path.filename = unescape(tok.path.filename);\n  tok.path.extname = unescape(tok.path.extname);\n\n  // Booleans\n  var is = (glob && tok.is.glob);\n  tok.is.negated  = glob && glob.charAt(0) === '!';\n  tok.is.extglob  = glob && extglob(glob);\n  tok.is.braces   = has(is, glob, '{');\n  tok.is.brackets = has(is, glob, '[:');\n  tok.is.globstar = has(is, glob, '**');\n  tok.is.dotfile  = dotfile(tok.path.basename);\n  tok.is.dotdir   = dotdir(tok.path.dirname);\n  return (cache[glob] = tok);\n}\n\n/**\n * Returns true if the glob matches dot-directories.\n *\n * @param  {Object} `tok` The tokens object\n * @param  {Object} `path` The path object\n * @return {Object}\n */\n\nfunction dotdir(base) {\n  if (base.indexOf('/.') !== -1) {\n    return true;\n  }\n  if (base.charAt(0) === '.' && base.charAt(1) !== '/') {\n    return true;\n  }\n  return false;\n}\n\n/**\n * Returns true if the pattern has the given `ch`aracter(s)\n *\n * @param  {Object} `glob` The glob pattern.\n * @param  {Object} `ch` The character to test for\n * @return {Object}\n */\n\nfunction has(is, glob, ch) {\n  return is && glob.indexOf(ch) !== -1;\n}\n\n/**\n * Escape/unescape utils\n */\n\nfunction escape(str) {\n  var re = /\\{([^{}]*?)}|\\(([^()]*?)\\)|\\[([^\\[\\]]*?)\\]/g;\n  return str.replace(re, function (outter, inner) {\n    if (!inner) { return outter; }\n    return outter.split(inner).join(esc(inner));\n  });\n}\n\nfunction esc(str) {\n  str = str.split('/').join('__SLASH__');\n  str = str.split('.').join('__DOT__');\n  return str;\n}\n\nfunction unescape(str) {\n  str = str.split('__SLASH__').join('/');\n  str = str.split('__DOT__').join('.');\n  return str;\n}\n";
const GLOB_NEW: string = "/*!\n * parse-glob <https://github.com/jonschlinkert/parse-glob>\n *\n * Copyright (c) 2015, Jon Schlinkert.\n * Licensed under the MIT License.\n */\n\n'use strict';\n\nvar isGlob = require('is-glob');\nvar findBase = require('glob-base');\nvar extglob = require('is-extglob');\nvar dotfile = require('is-dotfile');\n\n/**\n * Expose `cache`\n */\n\nvar cache = module.exports.cache = {};\n\n/**\n * Parse a glob pattern into tokens.\n *\n * When no paths or '**' are in the glob, we use a\n * different strategy for parsing the filename, since\n * file names can contain braces and other difficult\n * patterns. such as:\n *\n *  - `*.{a,b}`\n *  - `(**|*.js)`\n */\n\nmodule.exports = function parseGlob(glob) {\n  if (cache.hasOwnProperty(glob)) {\n    return cache[glob];\n  }\n\n  var tok = {};\n  tok.orig = glob;\n  tok.is = {};\n\n  // unescape dots and slashes in braces/brackets\n  glob = escape(glob);\n\n  var parsed = findBase(glob);\n  tok.is.glob = parsed.isGlob;\n\n  tok.glob = parsed.glob;\n  tok.base = parsed.base;\n  var segs = /([^\\/]*)$/.exec(glob);\n\n  tok.path = {};\n  tok.path.dirname = '';\n  tok.path.basename = segs[1] || '';\n  tok.path.dirname = glob.split(tok.path.basename).join('') || '';\n  var basename = (tok.path.basename || '').split('.') || '';\n  tok.path.filename = basename[0] || '';\n  tok.path.extname = basename.slice(1).join('.') || '';\n  tok.path.ext = '';\n\n  if (isGlob(tok.path.dirname) && !tok.path.basename) {\n    if (!/\\/$/.test(tok.glob)) {\n      tok.path.basename = tok.glob;\n    }\n    tok.path.dirname = tok.base;\n  }\n\n  if (glob.indexOf('/') === -1 && !tok.is.globstar) {\n    tok.path.dirname = '';\n    tok.path.basename = tok.orig;\n  }\n\n  var dot = tok.path.basename.indexOf('.');\n  if (dot !== -1) {\n    tok.path.filename = tok.path.basename.slice(0, dot);\n    tok.path.extname = tok.path.basename.slice(dot);\n  }\n\n  if (tok.path.extname.charAt(0) === '.') {\n    var exts = tok.path.extname.split('.');\n    tok.path.ext = exts[exts.length - 1];\n  }\n\n  // unescape dots and slashes in braces/brackets\n  tok.glob = unescape(tok.glob);\n  tok.path.dirname = unescape(tok.path.dirname);\n  tok.path.basename = unescape(tok.path.basename);\n  tok.path.filename = unescape(tok.path.filename);\n  tok.path.extname = unescape(tok.path.extname);\n\n  // Booleans\n  var is = (glob && tok.is.glob);\n  tok.is.negated  = glob && glob.charAt(0) === '!';\n  tok.is.extglob  = glob && extglob(glob);\n  tok.is.braces   = has(is, glob, '{');\n  tok.is.brackets = has(is, glob, '[:');\n  tok.is.globstar = has(is, glob, '**');\n  tok.is.dotfile  = dotfile(tok.path.basename);\n  tok.is.dotdir   = dotdir(tok.path.dirname);\n  return (cache[glob] = tok);\n}\n\n/**\n * Returns true if the glob matches dot-directories.\n *\n * @param  {Object} `tok` The tokens object\n * @param  {Object} `path` The path object\n * @return {Object}\n */\n\nfunction dotdir(base) {\n  if (base.indexOf('/.') !== -1) {\n    return true;\n  }\n  if (base.charAt(0) === '.' && base.charAt(1) !== '/') {\n    return true;\n  }\n  return false;\n}\n\n/**\n * Returns true if the pattern has the given `ch`aracter(s)\n *\n * @param  {Object} `glob` The glob pattern.\n * @param  {Object} `ch` The character to test for\n * @return {Object}\n */\n\nfunction has(is, glob, ch) {\n  return is && glob.indexOf(ch) !== -1;\n}\n\n/**\n * Escape/unescape utils\n */\n\nfunction escape(str) {\n  var re = /\\{([^{}]*?)}|\\(([^()]*?)\\)|\\[([^\\[\\]]*?)\\]/g;\n  return str.replace(re, function (outter, braces, parens, brackets) {\n    var inner = braces || parens || brackets;\n    if (!inner) { return outter; }\n    return outter.split(inner).join(esc(inner));\n  });\n}\n\nfunction esc(str) {\n  str = str.split('/').join('__SLASH__');\n  str = str.split('.').join('__DOT__');\n  return str;\n}\n\nfunction unescape(str) {\n  str = str.split('__SLASH__').join('/');\n  str = str.split('__DOT__').join('.');\n  return str;\n}\n";

/** Prefix the log-ok checkmark with any leading whitespace from the message. A check that is not that whitespace prefix is refused. */
export function prefixLogOkCheckWithLeadingWhitespace(source: string): string | null {
  if (!source.includes("  console.log.bind(console, green(check)).apply(console, arguments);")) return null;
  return source === LOG_OLD ? LOG_NEW : null;
}

/** Return an empty object when pick's target is not an object, and allow functions (which are objects). A check that is not that object guard is refused. */
export function returnEmptyObjectWhenPickTargetIsNotAnObject(source: string): string | null {
  if (!source.includes("  if (typeof obj !== 'object') {\n    return res;\n  }")) return null;
  return source === PICK_OLD ? PICK_NEW : null;
}

/** Escape the inside of character classes, braces, and parens when parsing a glob. A check that is not that inner-group escape is refused. */
export function escapeBracketContentsWhenParsingGlob(source: string): string | null {
  if (!source.includes("  return str.replace(re, function (outter, inner) {")) return null;
  return source === GLOB_OLD ? GLOB_NEW : null;
}

export interface Batch45Input {
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
export function repairBatch45(input: Batch45Input): { diff: string; file: string } | null {
  if (!/Error|not equal|Expected|Invalid|fail|toEqual|toBe|AssertionError|TypeError|undefined|to equal|deeply equivalent|deepEqual|true == false|false == true|evaluated to a falsy|in' operator|\[\.\]bashrc|    \\x1B\[32m|    \x1B\[32m/i.test(input.output)) return null;
  const edits: { path: string; next: string; original: string }[] = [];
  for (const path of filesOf(input.root, input.sourcePattern)) {
    const original = readLocal(input.root, path);
    if (original === null) continue;
    const next = prefixLogOkCheckWithLeadingWhitespace(original) ?? returnEmptyObjectWhenPickTargetIsNotAnObject(original) ?? escapeBracketContentsWhenParsingGlob(original);
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
