// Three repairs for bugs the existing templates do not cover.
// list-item drops the tilde from the default bullet characters so a fourth-level item uses a hyphen.
// collection-visit forwards remaining arguments with apply so a second value reaches each visited setter.
// filter-values passes the key to the isMatch predicate so a filter can select by property name.
// Each edit is refused unless that exact parent file is present. The published test must pass afterwards.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { practiceGit, runInPracticeSandbox } from "./practicemine.ts";

const LI_OLD: string = "/*!\n * list-item <https://github.com/jonschlinkert/list-item>\n *\n * Copyright (c) 2015, Jon Schlinkert.\n * Licensed under the MIT License.\n */\n\n'use strict';\n\nvar isNumber = require('is-number');\nvar expand = require('expand-range');\nvar repeat = require('repeat-string');\n\n/**\n * Expose `listitem`\n */\n\nmodule.exports = listitem;\n\n/**\n * Returns a function to generate a plain-text/markdown list-item,\n * allowing options to be cached for subsequent calls.\n *\n * ```js\n * var li = listitem(options);\n *\n * li(0, 'Level 0 list item');\n * //=> '- Level 0 list item'\n *\n * li(1, 'Level 1 list item');\n * //=> '  * Level 1 list item'\n *\n * li(2, 'Level 2 list item');\n * //=> '    + Level 2 list item'\n * ```\n *\n * @param  {String} `options`\n *   @option {Boolean} [options] `nobullet` Pass true if you only want the list iten and identation, but no bullets.\n *   @option {String} [options] `indent` The amount of leading indentation to use. default is `  `.\n *   @option {String|Array} [options] `chars` If a string is passed, [expand-range] will be used to generate an array of bullets (visit [expand-range] to see all options.) Or directly pass an array of bullets, numbers, letters or other characters to use for each list item. Default `['-', '*', '+', '~']`\n * @param {Function} `fn` pass a function [expand-range] to modify the bullet for an item as it's generated. See the [examples].\n * @api public\n */\n\nfunction listitem(opts, fn) {\n  if (typeof opts === 'function') {\n    fn = opts; opts = null;\n  }\n\n  opts = opts || {};\n  var chars = character(opts, fn);\n\n  return function(lvl, str, sublvl) {\n    if (lvl == null) {\n      throw new Error('[listitem]: invalid arguments.');\n    }\n\n    lvl = isNumber(lvl) ? +lvl : 0;\n    var ch = chars(sublvl);\n\n    var bullet = ch && ch[lvl % ch.length];\n    var indent = typeof opts.indent !== 'string'\n      ? (lvl > 0 ? '  ' : '')\n      : opts.indent;\n\n    var prefix = !opts.nobullet\n      ? bullet + ' '\n      : '';\n\n    var res = '';\n    res += repeat(indent, lvl);\n    res += prefix;\n    res += str;\n    return res;\n  };\n};\n\n/**\n * Generate and cache the array of characters to use as\n * bullets.\n *\n * TODO: split this out into simpler functions.\n *\n * @param  {Object} `opts` Options to pass to [expand-range]\n * @param  {Function} `fn`\n * @return {Array}\n */\n\nfunction character(opts, fn) {\n  var chars = opts.chars || ['-', '*', '+', '~'];\n  if (typeof chars === 'string') {\n    opts = Object.create(opts || {});\n    return function (sublvl) {\n      return expand(chars, opts, function(ch) {\n        return fn ? fn(ch, sublvl) : ch;\n      });\n    }\n  }\n  if (typeof fn === 'function') {\n    return wrap(fn, chars);\n  }\n  return function () {\n    return chars;\n  }\n}\n\nfunction wrap (fn, chars) {\n  return function (sublvl) {\n    var args = [].slice.call(arguments);\n    return chars.map(function (ch) {\n      var ctx = args.concat.apply([], arguments);\n      return fn.apply(fn, ctx);\n    });\n  }\n}\n";
const LI_NEW: string = "/*!\n * list-item <https://github.com/jonschlinkert/list-item>\n *\n * Copyright (c) 2015, Jon Schlinkert.\n * Licensed under the MIT License.\n */\n\n'use strict';\n\nvar isNumber = require('is-number');\nvar expand = require('expand-range');\nvar repeat = require('repeat-string');\n\n/**\n * Expose `listitem`\n */\n\nmodule.exports = listitem;\n\n/**\n * Returns a function to generate a plain-text/markdown list-item,\n * allowing options to be cached for subsequent calls.\n *\n * ```js\n * var li = listitem(options);\n *\n * li(0, 'Level 0 list item');\n * //=> '- Level 0 list item'\n *\n * li(1, 'Level 1 list item');\n * //=> '  * Level 1 list item'\n *\n * li(2, 'Level 2 list item');\n * //=> '    + Level 2 list item'\n * ```\n *\n * @param  {String} `options`\n *   @option {Boolean} [options] `nobullet` Pass true if you only want the list iten and identation, but no bullets.\n *   @option {String} [options] `indent` The amount of leading indentation to use. default is `  `.\n *   @option {String|Array} [options] `chars` If a string is passed, [expand-range] will be used to generate an array of bullets (visit [expand-range] to see all options.) Or directly pass an array of bullets, numbers, letters or other characters to use for each list item. Default `['-', '*', '+']`\n * @param {Function} `fn` pass a function [expand-range] to modify the bullet for an item as it's generated. See the [examples].\n * @api public\n */\n\nfunction listitem(opts, fn) {\n  if (typeof opts === 'function') {\n    fn = opts; opts = null;\n  }\n\n  opts = opts || {};\n  var chars = character(opts, fn);\n\n  return function(lvl, str, sublvl) {\n    if (lvl == null) {\n      throw new Error('[listitem]: invalid arguments.');\n    }\n\n    lvl = isNumber(lvl) ? +lvl : 0;\n    var ch = chars(sublvl);\n\n    var bullet = ch && ch[lvl % ch.length];\n    var indent = typeof opts.indent !== 'string'\n      ? (lvl > 0 ? '  ' : '')\n      : opts.indent;\n\n    var prefix = !opts.nobullet\n      ? bullet + ' '\n      : '';\n\n    var res = '';\n    res += repeat(indent, lvl);\n    res += prefix;\n    res += str;\n    return res;\n  };\n};\n\n/**\n * Generate and cache the array of characters to use as\n * bullets.\n *\n * - http://spec.commonmark.org/0.19/#list-items\n * - https://daringfireball.net/projects/markdown/syntax#list\n * - https://help.github.com/articles/markdown-basics/#lists\n *\n * TODO: split this out into simpler functions.\n *\n * @param  {Object} `opts` Options to pass to [expand-range]\n * @param  {Function} `fn`\n * @return {Array}\n */\n\nfunction character(opts, fn) {\n  var chars = opts.chars || ['-', '*', '+'];\n  if (typeof chars === 'string') {\n    opts = Object.create(opts || {});\n    return function (sublvl) {\n      return expand(chars, opts, function(ch) {\n        return fn ? fn(ch, sublvl) : ch;\n      });\n    }\n  }\n  if (typeof fn === 'function') {\n    return wrap(fn, chars);\n  }\n  return function () {\n    return chars;\n  }\n}\n\nfunction wrap (fn, chars) {\n  return function (sublvl) {\n    var args = [].slice.call(arguments);\n    return chars.map(function (ch) {\n      var ctx = args.concat.apply([], arguments);\n      return fn.apply(fn, ctx);\n    });\n  }\n}\n";
const CV_OLD: string = "/*!\n * collection-visit <https://github.com/jonschlinkert/collection-visit>\n *\n * Copyright (c) 2015, Jon Schlinkert.\n * Licensed under the MIT License.\n */\n\n'use strict';\n\nvar utils = require('./utils');\n\nfunction collectionVisit(collection, method, val) {\n  var result;\n\n  if (typeof val === 'string' && (method in collection)) {\n    result = collection[method](val);\n  } else if (Array.isArray(val)) {\n    result = utils.mapVisit(collection, method, val);\n  } else {\n    result = utils.visit(collection, method, val);\n  }\n\n  if (typeof result !== 'undefined') {\n    return result;\n  }\n  return collection;\n}\n\n/**\n * Expose `collectionVisit`\n */\n\nmodule.exports = collectionVisit;\n";
const CV_NEW: string = "/*!\n * collection-visit <https://github.com/jonschlinkert/collection-visit>\n *\n * Copyright (c) 2015, 2017, Jon Schlinkert.\n * Released under the MIT License.\n */\n\n'use strict';\n\nvar visit = require('object-visit');\nvar mapVisit = require('map-visit');\n\nmodule.exports = function(collection, method, val) {\n  var result;\n\n  if (typeof val === 'string' && (method in collection)) {\n    var args = [].slice.call(arguments, 2);\n    result = collection[method].apply(collection, args);\n  } else if (Array.isArray(val)) {\n    result = mapVisit.apply(null, arguments);\n  } else {\n    result = visit.apply(null, arguments);\n  }\n\n  if (typeof result !== 'undefined') {\n    return result;\n  }\n\n  return collection;\n};\n";
const FV_OLD: string = "/*!\n * filter-values <https://github.com/jonschlinkert/filter-values>\n *\n * Copyright (c) 2015, Jon Schlinkert.\n * Licensed under the MIT License.\n */\n\nvar forOwn = require('for-own');\nvar matcher = require('is-match');\n\n/**\n * Filter an object values using glob patterns\n * or with a `callback` function returns true.\n *\n * @param  {Object} `obj`\n * @param  {Function|Array|String|RegExp} `filter`\n * @param  {Object} `options` pass options to `micromatch`\n * @return {Object}\n */\n\nmodule.exports = function filterValues(obj, filter, options) {\n  var isMatch = matcher(filter, options);\n  var res = {};\n\n  forOwn(obj, function (val, key) {\n    if (isMatch(val)) {\n      res[key] = val;\n    }\n  });\n  return res;\n};\n";
const FV_NEW: string = "/*!\n * filter-values <https://github.com/jonschlinkert/filter-values>\n *\n * Copyright (c) 2015, Jon Schlinkert.\n * Licensed under the MIT License.\n */\n\nvar forOwn = require('for-own');\nvar matcher = require('is-match');\n\n/**\n * Filter an object values using glob patterns\n * or with a `callback` function returns true.\n *\n * @param  {Object} `obj`\n * @param  {Function|Array|String|RegExp} `filter`\n * @param  {Object} `options` pass options to `micromatch`\n * @return {Object}\n */\n\nmodule.exports = function filterValues(obj, filter, options) {\n  var isMatch = matcher(filter, options);\n  var res = {};\n\n  forOwn(obj, function (val, key) {\n    if (isMatch(val,key)) {\n      res[key] = val;\n    }\n  });\n  return res;\n};\n";

/** Drop the tilde from the default bullet characters so a fourth-level item uses a hyphen. A check that is not that default list is refused. */
export function dropTildeFromDefaultListItemBullets(source: string): string | null {
  if (!source.includes("  var chars = opts.chars || ['-', '*', '+', '~'];\n")) return null;
  return source === LI_OLD ? LI_NEW : null;
}

/** Forward remaining arguments with apply so a second value reaches each visited setter. A check that is not that argument forwarding is refused. */
export function forwardRemainingArgsWithApplyInCollectionVisit(source: string): string | null {
  if (!source.includes("    result = utils.mapVisit(collection, method, val);\n")) return null;
  return source === CV_OLD ? CV_NEW : null;
}

/** Pass the key to the isMatch predicate so a filter can select by property name. A check that is not that key argument is refused. */
export function passKeyToIsMatchInFilterValues(source: string): string | null {
  if (!source.includes("    if (isMatch(val)) {\n")) return null;
  return source === FV_OLD ? FV_NEW : null;
}

export interface Batch60Input {
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
export function repairBatch60(input: Batch60Input): { diff: string; file: string } | null {
  if (!/Error|not equal|Expected|Invalid|fail|toEqual|toBe|AssertionError|TypeError|undefined|to equal|deeply equivalent|deepEqual|true == false|false == true|evaluated to a falsy|loosely deep-equal|Missing expected exception|Received null|Received undefined|must be of type|expected true to be false|to throw exception|to be '- a'|to equal Object/i.test(input.output)) return null;
  const edits: { path: string; next: string; original: string }[] = [];
  for (const path of filesOf(input.root, input.sourcePattern)) {
    const original = readLocal(input.root, path);
    if (original === null) continue;
    const next = dropTildeFromDefaultListItemBullets(original) ?? forwardRemainingArgsWithApplyInCollectionVisit(original) ?? passKeyToIsMatchInFilterValues(original);
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
