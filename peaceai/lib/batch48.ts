// Three repairs for bugs the existing templates do not cover.
// html-tag emits a close tag when the text argument is a boolean.
// pretty-time accepts a numeric nanosecond duration, not only a process.hrtime() tuple.
// condense-newlines normalizes trailing newlines when collapsing blank lines.
// Each edit is refused unless that exact parent file is present. The published test must pass afterwards.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { practiceGit, runInPracticeSandbox } from "./practicemine.ts";

const TAG_OLD: string = "/*!\n * html-tag <https://github.com/jonschlinkert/html-tag>\n *\n * Copyright (c) 2014 Jon Schlinkert, contributors.\n * Licensed under the MIT License\n */\n\n'use strict';\n\n\n/**\n * ## tag( name, attrs, text )\n *\n * Create a snippet of HTML.\n *\n * **Examples:**\n *\n * ```js\n * tag('a', {href: 'http://www.google.com'}, 'Google');\n * tag('img', {src: 'foo.jpg'});\n * ```\n *\n * yields:\n *\n * ```html\n * <a href=\"http://www.google.com\">Google</a>\n * <img src=\"foo.jpg\">\n * ```\n *\n * @param {String} `tag` The tag to create.\n * @param {Object} `attrs` Optional attributes\n * @param {String} `text` Optional text\n * @return {String} HTML\n */\n\nmodule.exports = function (tag, attrs, text) {\n  var html = '<' + tag;\n\n  for (var i in attrs) {\n    if (attrs[i]) html += ' ' + i + '=\"' + attrs[i] + '\"';\n  }\n\n  html += text ? '>' + text + '</' + tag + '>' : '>';\n  return html;\n};";
const TAG_NEW: string = "/*!\n * html-tag <https://github.com/jonschlinkert/html-tag>\n *\n * Copyright (c) 2014 Jon Schlinkert, contributors.\n * Licensed under the MIT License\n */\n\n'use strict';\n\n\n/**\n * ## tag( name, attrs, text )\n *\n * Create a snippet of HTML.\n *\n * **Examples:**\n *\n * ```js\n * tag('a', {href: 'http://www.google.com'}, 'Google');\n * tag('img', {src: 'foo.jpg'});\n * ```\n *\n * yields:\n *\n * ```html\n * <a href=\"http://www.google.com\">Google</a>\n * <img src=\"foo.jpg\">\n * ```\n *\n * @param {String} `tag` The tag to create.\n * @param {Object} `attrs` Optional attributes\n * @param {String} `text` Optional text\n * @return {String} HTML\n */\n\nmodule.exports = function (tag, attrs, text) {\n  var html = '<' + tag;\n\n  for (var i in attrs) {\n    if (attrs[i]) html += ' ' + i + '=\"' + attrs[i] + '\"';\n  }\n\n  if (typeof text === 'boolean') {\n    html += '></' + tag + '>';\n    return html;\n  }\n\n  html += text ? '>' + text + '</' + tag + '>' : '>';\n  return html;\n};";
const TIME_OLD: string = "/*!\n * pretty-time <https://github.com/jonschlinkert/pretty-time>\n *\n * Copyright (c) 2015, Jon Schlinkert.\n * Licensed under the MIT License.\n */\n\n'use strict';\n\nvar isNumber = require('is-number');\nvar utils = require('./utils');\nvar scale = {\n  'w': 6048e11,\n  'd': 864e11,\n  'h': 36e11,\n  'm': 6e10,\n  's': 1e9,\n  'ms': 1e6,\n  '\u03bcs': 1e3,\n  'ns': 1,\n};\n\nfunction pretty(time, smallest, digits) {\n  if (!Array.isArray(time) || time.length !== 2) {\n    throw new TypeError('expected an array from process.hrtime()');\n  }\n\n  if (isNumber(smallest)) {\n    digits = smallest;\n    smallest = null;\n  }\n\n  var num = ((+time[0]) * 1e9) + (+time[1]);\n  var res = '';\n  var prev;\n\n  for (var uom in scale) {\n    var step = scale[uom];\n    var inc = num / step;\n\n    if (smallest && utils.isSmallest(uom, smallest)) {\n      inc = utils.round(inc, digits);\n      if (prev && (inc === (prev / step))) --inc;\n      res += inc + uom;\n      return res.trim();\n    }\n\n    if (inc < 1) continue;\n    if (!smallest) {\n      inc = utils.round(inc, digits);\n      res += inc + uom;\n      return res;\n    }\n\n    prev = step;\n\n    inc = Math.floor(inc);\n    num -= (inc * step);\n    res += inc + uom + ' ';\n  }\n  return res.trim();\n}\n\n/**\n * Expose `pretty`\n */\n\nmodule.exports = pretty;\n";
const TIME_NEW: string = "/*!\n * pretty-time <https://github.com/jonschlinkert/pretty-time>\n *\n * Copyright (c) 2015, Jon Schlinkert.\n * Licensed under the MIT License.\n */\n\n'use strict';\n\nvar isNumber = require('is-number');\nvar nano = require('nanoseconds');\nvar utils = require('./utils');\nvar scale = {\n  'w': 6048e11,\n  'd': 864e11,\n  'h': 36e11,\n  'm': 6e10,\n  's': 1e9,\n  'ms': 1e6,\n  '\u03bcs': 1e3,\n  'ns': 1,\n};\n\nfunction pretty(time, smallest, digits) {\n  if (!isNumber(time) && !Array.isArray(time)) {\n    throw new TypeError('expected an array or number in nanoseconds');\n  }\n  if (Array.isArray(time) && time.length !== 2) {\n    throw new TypeError('expected an array from process.hrtime()');\n  }\n\n  if (isNumber(smallest)) {\n    digits = smallest;\n    smallest = null;\n  }\n\n  var num = isNumber(time) ? time : nano(time);\n  var res = '';\n  var prev;\n\n  for (var uom in scale) {\n    var step = scale[uom];\n    var inc = num / step;\n\n    if (smallest && utils.isSmallest(uom, smallest)) {\n      inc = utils.round(inc, digits);\n      if (prev && (inc === (prev / step))) --inc;\n      res += inc + uom;\n      return res.trim();\n    }\n\n    if (inc < 1) continue;\n    if (!smallest) {\n      inc = utils.round(inc, digits);\n      res += inc + uom;\n      return res;\n    }\n\n    prev = step;\n\n    inc = Math.floor(inc);\n    num -= (inc * step);\n    res += inc + uom + ' ';\n  }\n  return res.trim();\n}\n\n/**\n * Expose `pretty`\n */\n\nmodule.exports = pretty;\n";
const CNL_OLD: string = "/*!\n * condense-newlines <https://github.com/jonschlinkert/condense-newlines>\n *\n * Copyright (c) 2014 Jon Schlinkert, contributors.\n * Licensed under the MIT License\n */\n\n'use strict';\n\nvar isWhitespace = require('is-whitespace');\n\nmodule.exports = function(str, options) {\n  options = options || {};\n  var sep = options.sep || '\\n\\n';\n  var min = options.min;\n  var re;\n\n  if (typeof min === 'number' && min !== 2) {\n    re = new RegExp('(\\\\r\\\\n|\\\\n){' + min + ',}');\n  }\n  re = options.regex || /(\\r\\n|\\n){2,}/g;\n\n  // if a line is 100% whitespace, remove the whitespace (but not the line, yet)\n  if (options.keepWhitespace !== true) {\n    str = str.split('\\n').map(function(line) {\n      if (/^\\s+$/.test(line)) {\n        return line.trim();\n      }\n      return line;\n    }).join('\\n');\n  }\n  return str.replace(re, sep);\n};\n";
const CNL_NEW: string = "/*!\n * condense-newlines <https://github.com/jonschlinkert/condense-newlines>\n *\n * Copyright (c) 2014 Jon Schlinkert, contributors.\n * Licensed under the MIT License\n */\n\n'use strict';\n\nvar isWhitespace = require('is-whitespace');\nvar extend = require('extend-shallow');\nvar typeOf = require('kind-of');\n\nmodule.exports = function(str, options) {\n  var opts = extend({}, options);\n  var sep = opts.sep || '\\n\\n';\n  var min = opts.min;\n  var re;\n\n  if (typeof min === 'number' && min !== 2) {\n    re = new RegExp('(\\\\r\\\\n|\\\\n|\\\\u2424) {' + min + ',}');\n  }\n  if (typeof re === 'undefined') {\n    re = opts.regex || /(\\r\\n|\\n|\\u2424){2,}/g;\n  }\n\n  // if a line is 100% whitespace it will be trimmed, so that\n  // later we can condense newlines correctly\n  if (opts.keepWhitespace !== true) {\n    str = str.split('\\n').map(function(line) {\n      return isWhitespace(line) ? line.trim() : line;\n    }).join('\\n');\n  }\n\n  str = trailingNewline(str, opts);\n  return str.replace(re, sep);\n};\n\nfunction trailingNewline(str, options) {\n  var val = options.trailingNewline;\n  if (val === false) {\n    return str;\n  }\n\n  switch (typeOf(val)) {\n    case 'string':\n      str = str.replace(/\\s+$/, options.trailingNewline);\n      break;\n    case 'function':\n      str = options.trailingNewline(str);\n      break;\n    case 'undefined':\n    case 'boolean':\n    default: {\n      str = str.replace(/\\s+$/, '\\n');\n      break;\n    }\n  }\n  return str;\n}\n";

/** Emit a close tag when the text argument is a boolean, instead of stringifying the boolean. A check that is not that boolean text guard is refused. */
export function emitCloseTagWhenTextIsBoolean(source: string): string | null {
  if (!source.includes("  html += text ? '>' + text + '</' + tag + '>' : '>';")) return null;
  return source === TAG_OLD ? TAG_NEW : null;
}

/** Accept a numeric nanosecond duration, not only a process.hrtime() tuple. A check that is not that numeric-nanoseconds path is refused. */
export function acceptNumericNanoseconds(source: string): string | null {
  if (!source.includes("  if (!Array.isArray(time) || time.length !== 2) {")) return null;
  return source === TIME_OLD ? TIME_NEW : null;
}

/** Normalize trailing newlines when condensing. A check that is not that trailing-newline rewrite is refused. */
export function normalizeTrailingNewlinesWhenCondensing(source: string): string | null {
  if (!source.includes("  re = options.regex || /(\\r\\n|\\n){2,}/g;")) return null;
  return source === CNL_OLD ? CNL_NEW : null;
}

export interface Batch48Input {
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
export function repairBatch48(input: Batch48Input): { diff: string; file: string } | null {
  if (!/Error|not equal|Expected|Invalid|fail|toEqual|toBe|AssertionError|TypeError|undefined|to equal|deeply equivalent|deepEqual|true == false|false == true|evaluated to a falsy|foo\.html">true<\/a>|expected an array from process\.hrtime|d\\n\\n/i.test(input.output)) return null;
  const edits: { path: string; next: string; original: string }[] = [];
  for (const path of filesOf(input.root, input.sourcePattern)) {
    const original = readLocal(input.root, path);
    if (original === null) continue;
    const next = emitCloseTagWhenTextIsBoolean(original) ?? acceptNumericNanoseconds(original) ?? normalizeTrailingNewlinesWhenCondensing(original);
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
