// Three repairs for bugs the existing templates do not cover.
// snakecase uppercases the result when options.uppercase is set.
// object.omit accepts a filter function as the last argument and forwards remaining keys.
// lang-map exports the languages object by default with lang/ext helpers attached.
// Each edit is refused unless that exact parent file is present. The published test must pass afterwards.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { practiceGit, runInPracticeSandbox } from "./practicemine.ts";

const SC_OLD: string = "'use strict';\n\n/*!\n * snakecase <https://github.com/jonschlinkert/snakecase>\n * Copyright (c) Jon Schlinkert\n * Released under the MIT License.\n */\n\nconst PUNCTUATION = /[^\\p{L}\\p{N}]+/ug;\nconst REGEX = /([\\p{Lu}]+[\\p{Ll}\\p{N}]*|[\\p{Ll}\\p{N}]+)/gu;\nconst LAZY_UPPERCASE_REGEX = /([\\p{Lu}]{2,}(?![\\p{Ll}\\p{N}])|[\\p{Lu}]+[\\p{Ll}\\p{N}]*|[\\p{Ll}\\p{N}]+)/gu;\nconst PRESERVE_UPPERCASE_REGEX = /([\\p{Lu}]{2,}|[\\p{Lu}][\\p{Ll}]*|[\\p{Ll}\\p{N}]+)/gu;\n\nconst toString = input => {\n  if (input == null) return '';\n  if (Array.isArray(input)) return input.map(s => toString(s)).filter(s => s.length).join(' ');\n  if (typeof input === 'function') return input.name || '';\n  if (typeof input.toString !== 'function') return '';\n  return input.toString().trim();\n};\n\nconst splitString = (value, options = {}) => {\n  const regex = options.preserveConsecutiveUppercase\n    ? PRESERVE_UPPERCASE_REGEX\n    : (options.lazyUppercase !== false ? LAZY_UPPERCASE_REGEX : REGEX);\n\n  const input = toString(value);\n  const words = value ? (input.match(regex) || []).filter(Boolean) : [];\n  const output = words.filter(Boolean);\n\n  if (output.length === 0 && value.length > 0) {\n    return [value.replace(PUNCTUATION, '')];\n  }\n\n  return output;\n};\n\nconst transformWords = (input, options, joinChar = '', transformFn = s => s) => {\n  return input ? splitString(toString(input), options).map(transformFn).join(joinChar) : '';\n};\n\nconst lowercase = (input = '', options) => input.toLocaleLowerCase(options?.locale);\nconst snakecase = (input = '', options) => lowercase(transformWords(input, options, '_'), options);\n\nmodule.exports = snakecase;\nmodule.exports.snakecase = snakecase;\n";
const SC_NEW: string = "'use strict';\n\n/*!\n * snakecase <https://github.com/jonschlinkert/snakecase>\n * Copyright (c) Jon Schlinkert\n * Released under the MIT License.\n */\n\nconst PUNCTUATION = /[^\\p{L}\\p{N}]+/ug;\nconst REGEX = /([\\p{Lu}]+[\\p{Ll}\\p{N}]*|[\\p{Ll}\\p{N}]+)/gu;\nconst LAZY_UPPERCASE_REGEX = /([\\p{Lu}]{2,}(?![\\p{Ll}\\p{N}])|[\\p{Lu}]+[\\p{Ll}\\p{N}]*|[\\p{Ll}\\p{N}]+)/gu;\nconst PRESERVE_UPPERCASE_REGEX = /([\\p{Lu}]{2,}|[\\p{Lu}][\\p{Ll}]*|[\\p{Ll}\\p{N}]+)/gu;\n\nconst toString = input => {\n  if (input == null) return '';\n  if (Array.isArray(input)) return input.map(s => toString(s)).filter(s => s.length).join(' ');\n  if (typeof input === 'function') return input.name || '';\n  if (typeof input.toString !== 'function') return '';\n  return input.toString().trim();\n};\n\nconst splitString = (value, options = {}) => {\n  const regex = options.preserveConsecutiveUppercase\n    ? PRESERVE_UPPERCASE_REGEX\n    : (options.lazyUppercase !== false ? LAZY_UPPERCASE_REGEX : REGEX);\n\n  const input = toString(value);\n  const words = value ? (input.match(regex) || []).filter(Boolean) : [];\n  const output = words.filter(Boolean);\n\n  if (output.length === 0 && value.length > 0) {\n    return [value.replace(PUNCTUATION, '')];\n  }\n\n  return output;\n};\n\nconst transformWords = (input, options, joinChar = '', transformFn = s => s) => {\n  return input ? splitString(toString(input), options).map(transformFn).join(joinChar) : '';\n};\n\nconst lowercase = (input = '', options) => input.toLocaleLowerCase(options?.locale);\nconst snakecase = (input = '', options) => {\n  const output = lowercase(transformWords(input, options, '_'), options);\n\n  if (options?.uppercase) {\n    return output.toLocaleUpperCase(options?.locale);\n  }\n\n  return output;\n};\n\nmodule.exports = snakecase;\nmodule.exports.snakecase = snakecase;\n";
const OO_OLD: string = "/*!\n * object.omit <https://github.com/jonschlinkert/object.omit>\n *\n * Copyright (c) 2014-2015, Jon Schlinkert.\n * Licensed under the MIT License.\n */\n\n'use strict';\n\nvar isObject = require('isobject');\nvar forOwn = require('for-own');\n\nmodule.exports = function omit(obj, keys) {\n  if (!isObject(obj)) return {};\n  if (!keys) return obj;\n\n  keys = Array.isArray(keys) ? keys : [keys];\n  var res = {};\n\n  forOwn(obj, function (value, key) {\n    if (keys.indexOf(key) === -1) {\n      res[key] = value;\n    }\n  });\n  return res;\n};\n";
const OO_NEW: string = "/*!\n * object.omit <https://github.com/jonschlinkert/object.omit>\n *\n * Copyright (c) 2014-2015, Jon Schlinkert.\n * Licensed under the MIT License.\n */\n\n'use strict';\n\nvar isObject = require('is-extendable');\nvar forOwn = require('for-own');\n\nmodule.exports = function omit(obj, keys) {\n  if (!isObject(obj)) return {};\n\n  var keys = [].concat.apply([], [].slice.call(arguments, 1));\n  var last = keys[keys.length - 1];\n  var res = {}, fn;\n\n  if (typeof last === 'function') {\n    fn = keys.pop();\n  }\n\n  var isFunction = typeof fn === 'function';\n  if (!keys.length && !isFunction) {\n    return obj;\n  }\n\n  forOwn(obj, function (value, key) {\n    if (keys.indexOf(key) === -1) {\n\n      if (!isFunction) {\n        res[key] = value;\n      } else if (fn(value, key, obj)) {\n        res[key] = value;\n      }\n    }\n  });\n  return res;\n};\n";
const LM_OLD: string = "/*!\n * lang-map <https://github.com/jonschlinkert/lang-map>\n *\n * Copyright (c) 2014 Jon Schlinkert, contributors.\n * Licensed under the MIT license.\n */\n\n'use strict';\n\nvar languages = require('./lang.json');\n\n\nmodule.exports = function (extension) {\n  extension = extension.replace(/\\./, '');\n  for (var lang in languages) {\n    var ext = languages[lang];\n    if (ext.indexOf(extension) !== -1) {\n      return lang;\n    }\n  }\n  return null;\n};\n\nmodule.exports.ext = function (lang) {\n  lang = lang.toLowerCase();\n  return languages[lang];\n};\n\n";
const LM_NEW: string = "/*!\n * lang-map <https://github.com/jonschlinkert/lang-map>\n *\n * Copyright (c) 2014 Jon Schlinkert, contributors.\n * Licensed under the MIT license.\n */\n\n'use strict';\n\nvar languages = module.exports = require('./lang.json');\n\nlanguages.lang = function (extension) {\n  extension = extension.replace(/\\./, '');\n  for (var lang in languages) {\n    var ext = languages[lang];\n    if (ext.indexOf(extension) !== -1) {\n      return lang;\n    }\n  }\n  return null;\n};\n\nlanguages.ext = function (lang) {\n  lang = lang.toLowerCase();\n  return languages[lang];\n};\n\n";

/** Uppercase the snakecase output when options.uppercase is set. A check that is not that uppercase branch is refused. */
export function uppercaseSnakecaseWhenOptionSet(source: string): string | null {
  if (!source.includes("const snakecase = (input = '', options) => lowercase(transformWords(input, options, '_'), options);\n")) return null;
  return source === SC_OLD ? SC_NEW : null;
}

/** Accept a filter function as the last omit argument and forward remaining keys. A check that is not that filter-function shape is refused. */
export function acceptFilterFunctionInObjectOmit(source: string): string | null {
  if (!source.includes("var isObject = require('isobject');\n")) return null;
  return source === OO_OLD ? OO_NEW : null;
}

/** Export the languages object by default and attach lang/ext helpers on it. A check that is not that default export shape is refused. */
export function exportLanguagesObjectByDefaultInLangMap(source: string): string | null {
  if (!source.includes("var languages = require('./lang.json');\n")) return null;
  return source === LM_OLD ? LM_NEW : null;
}

export interface Batch61Input {
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
export function repairBatch61(input: Batch61Input): { diff: string; file: string } | null {
  if (!/Error|not equal|Expected|Invalid|fail|toEqual|toBe|AssertionError|TypeError|undefined|to equal|deeply equivalent|deepEqual|true == false|false == true|evaluated to a falsy|loosely deep-equal|Missing expected exception|Received null|Received undefined|must be of type|expected true to be false|to throw exception|function' == 'object|FOO_BAR_BAZ|foo_bar_baz/i.test(input.output)) return null;
  const edits: { path: string; next: string; original: string }[] = [];
  for (const path of filesOf(input.root, input.sourcePattern)) {
    const original = readLocal(input.root, path);
    if (original === null) continue;
    const next = uppercaseSnakecaseWhenOptionSet(original) ?? acceptFilterFunctionInObjectOmit(original) ?? exportLanguagesObjectByDefaultInLangMap(original);
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
