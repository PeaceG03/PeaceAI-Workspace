// Three repairs for bugs the existing templates do not cover.
// unescape adds the missing &apos; HTML entity and caches the replace regex.
// set-getter filters __proto__, constructor, and prototype keys so a getter is not defined on the prototype.
// koalas returns the last argument when no value is valid, instead of null, and exposes a strict coalesce.
// Each edit is refused unless that exact parent file is present. The published test must pass afterwards.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { practiceGit, runInPracticeSandbox } from "./practicemine.ts";

const UE_OLD: string = "/*!\n * unescape <https://github.com/jonschlinkert/unescape>\n *\n * Copyright (c) 2014 Jon Schlinkert, contributors.\n * Licensed under the MIT License\n */\n\n\n'use strict';\n\n\n/**\n * Convert HTML entities to HTML characters.\n *\n * @param  {String} `str` String with HTML entities to un-escape.\n * @return {String}\n */\n\nvar unescape = module.exports = function (str) {\n  if (str == null) return '';\n\n  var re = new RegExp('(' + Object.keys(chars)\n    .join('|') + ')', 'g');\n\n  return String(str).replace(re, function (match) {\n    return chars[match];\n  });\n};\n\n\nvar chars = unescape.chars = {\n  '&#39;': '\\'',\n  '&amp;': '&',\n  '&gt;': '>',\n  '&lt;': '<',\n  '&quot;': '\"'\n};\n";
const UE_NEW: string = "'use strict';\n\nvar cache;\n\n/**\n * Convert HTML entities to HTML characters.\n *\n * @param  {String} `str` String with HTML entities to un-escape.\n * @return {String}\n */\n\nvar unescape = module.exports = function(str) {\n  if (str == null) return '';\n\n  var re = cache || (cache = new RegExp('(' + Object.keys(chars).join('|') + ')', 'g'));\n  return String(str).replace(re, function(match) {\n    return chars[match];\n  });\n};\n\nvar chars = unescape.chars = {\n  '&apos;': '\\'',\n  '&#39;': '\\'',\n  '&amp;': '&',\n  '&gt;': '>',\n  '&lt;': '<',\n  '&quot;': '\"'\n};\n";
const SG_OLD: string = "/*!\n * set-getter (https://github.com/doowb/set-getter)\n *\n * Copyright (c) 2016, Brian Woodward.\n * Licensed under the MIT License.\n */\n\n'use strict';\n\nvar toPath = require('to-object-path');\n\n/**\n * Defines a getter function on an object using property path notation.\n *\n * ```js\n * var obj = {};\n * getter(obj, 'foo', function() {\n *   return 'bar';\n * });\n * ```\n * @param {Object} `obj` Object to add property to.\n * @param {String|Array} `prop` Property string or array to add.\n * @param {Function} `getter` Getter function to add as a property.\n * @api public\n */\n\nfunction setGetter(obj, prop, getter) {\n  var key = toPath(arguments);\n  return define(obj, key, getter);\n}\n\n/**\n * Define getter function on object or object hierarchy using dot notation.\n *\n * @param  {Object} `obj` Object to define getter property on.\n * @param  {String} `prop` Property string to define.\n * @param  {Function} `getter` Getter function to define.\n * @return {Object} Returns original object.\n */\n\nfunction define(obj, prop, getter) {\n  if (!~prop.indexOf('.')) {\n    defineProperty(obj, prop, getter);\n    return obj;\n  }\n\n  var keys = prop.split('.');\n  var last = keys.pop();\n  var target = obj;\n  var key;\n\n  while ((key = keys.shift())) {\n    while (key.slice(-1) === '\\\\') {\n      key = key.slice(0, -1) + '.' + keys.shift();\n    }\n    target = target[key] || (target[key] = {});\n  }\n\n  defineProperty(target, last, getter);\n  return obj;\n}\n\n/**\n * Define getter function on object as a configurable and enumerable property.\n *\n * @param  {Object} `obj` Object to define property on.\n * @param  {String} `prop` Property to define.\n * @param  {Function} `getter` Getter function to define.\n */\n\nfunction defineProperty(obj, prop, getter) {\n  Object.defineProperty(obj, prop, {\n    configurable: true,\n    enumerable: true,\n    get: getter\n  });\n}\n\n/**\n * Expose `setGetter`\n */\n\nmodule.exports = setGetter;\n";
const SG_NEW: string = "/*!\n * set-getter (https://github.com/doowb/set-getter)\n *\n * Copyright (c) 2016, Brian Woodward.\n * Licensed under the MIT License.\n */\n\n'use strict';\n\nvar toPath = require('to-object-path');\n\nfunction isValidKey(key) {\n  return key !== '__proto__' && key !== 'constructor' && key !== 'prototype';\n}\n\n/**\n * Defines a getter function on an object using property path notation.\n *\n * ```js\n * var obj = {};\n * getter(obj, 'foo', function() {\n *   return 'bar';\n * });\n * ```\n * @param {Object} `obj` Object to add property to.\n * @param {String|Array} `prop` Property string or array to add.\n * @param {Function} `getter` Getter function to add as a property.\n * @api public\n */\n\nfunction setGetter(obj, prop, getter) {\n  var key = toPath(arguments);\n  return define(obj, key, getter);\n}\n\n/**\n * Define getter function on object or object hierarchy using dot notation.\n *\n * @param  {Object} `obj` Object to define getter property on.\n * @param  {String} `prop` Property string to define.\n * @param  {Function} `getter` Getter function to define.\n * @return {Object} Returns original object.\n */\n\nfunction define(obj, prop, getter) {\n  if (!~prop.indexOf('.')) {\n    if (isValidKey(prop)) {\n      defineProperty(obj, prop, getter);\n    }\n    return obj;\n  }\n\n  var keys = prop.split('.').filter(isValidKey);\n  var last = keys.pop();\n  var target = obj;\n  var key;\n\n  while ((key = keys.shift())) {\n    while (key.slice(-1) === '\\\\') {\n      key = key.slice(0, -1) + '.' + keys.shift();\n    }\n    target = target[key] || (target[key] = {});\n  }\n\n  defineProperty(target, last, getter);\n  return obj;\n}\n\n/**\n * Define getter function on object as a configurable and enumerable property.\n *\n * @param  {Object} `obj` Object to define property on.\n * @param  {String} `prop` Property to define.\n * @param  {Function} `getter` Getter function to define.\n */\n\nfunction defineProperty(obj, prop, getter) {\n  Object.defineProperty(obj, prop, {\n    configurable: true,\n    enumerable: true,\n    get: getter\n  });\n}\n\n/**\n * Expose `setGetter`\n */\n\nmodule.exports = setGetter;\n";
const KO_OLD: string = "'use strict';\n\n/**\n * Coalesce function to find the first valid value.\n * A valid value is one that is not undefined, not null and not NaN (not a number).\n *\n * ```js\n * console.log(koalas(undefined, null, NaN, 'a', 'b'));\n * //=> 'a'\n *\n * console.log(koalas(undefined, null, NaN, {a: 'b'}, 'b'));\n * //=> {a: 'b'}\n *\n * console.log(koalas(undefined, null, NaN, ['a', 'b', 'c'], {a: 'b'}, 'b'));\n * //=> ['a', 'b', 'c']\n * ```\n * @param {Mixed} `arguments` Pass in any amount of arguments.\n * @return {Mixed} First valid value.\n * @api public\n */\n\nfunction koalas() {\n  var len = arguments.length;\n  for (var i = 0; i < len; i++) {\n    var arg = arguments[i];\n    if (hasValue(arg)) {\n      return arg;\n    }\n  }\n  return null;\n}\n\n/**\n * Check to see if a value actual has a valid value:\n *  - not undefined\n *  - not null\n *  - not NaN (not a number)\n *\n * @param  {*} `val` value to check\n * @return {Boolean} returns `true` if the `val` has a valid value\n */\n\nfunction hasValue(val) {\n  // eslint-disable-next-line no-self-compare\n  return val != null && val === val;\n}\n\n/**\n * Expose koalas\n */\n\nmodule.exports = koalas;\n";
const KO_NEW: string = "'use strict';\n\n/**\n * Coalesce function to find the first valid value.\n * A valid value is one that is not undefined, not null and not NaN (not a number).\n *\n * ```js\n * console.log(koalas(undefined, null, NaN, 'a', 'b'));\n * //=> 'a'\n *\n * console.log(koalas(undefined, null, NaN, {a: 'b'}, 'b'));\n * //=> {a: 'b'}\n *\n * console.log(koalas(undefined, null, NaN, ['a', 'b', 'c'], {a: 'b'}, 'b'));\n * //=> ['a', 'b', 'c']\n * ```\n * @name koalas\n * @param {Mixed} `arguments` Pass in any amount of arguments.\n * @return {Mixed} First valid value.\n * @api public\n */\n\nvar koalas = create(hasValue);\n\n/**\n * Coalesce function to find the first valid value.\n * A strictly valid value is one that is not undefined and not NaN (not a number).\n *\n * ```js\n * console.log(koalas.strict(undefined, NaN, 'a', 'b'));\n * //=> 'a'\n *\n * console.log(koalas.strict(undefined, NaN, {a: 'b'}, 'b'));\n * //=> {a: 'b'}\n *\n * console.log(koalas.strict(undefined, NaN, ['a', 'b', 'c'], {a: 'b'}, 'b'));\n * //=> ['a', 'b', 'c']\n *\n * console.log(koalas.strict(undefined, null, NaN, ['a', 'b', 'c'], {a: 'b'}, 'b'));\n * //=> null\n *\n * console.log(koalas.strict(undefined, NaN, null, ['a', 'b', 'c'], {a: 'b'}, 'b'));\n * //=> null\n * ```\n * @name strict\n * @param {Mixed} `arguments` Pass in any amount of arguments.\n * @return {Mixed} First valid value.\n * @api public\n */\n\nkoalas.strict = create(hasStrictValue);\n\n/**\n * Create a function using the passed in `valid` function\n * to determine if an argument is valid.\n *\n * @param  {Function} `valid` Method to determine if a value is valid.\n * @return {Function} koalas function\n */\n\nfunction create(valid) {\n  return function() {\n    var len = arguments.length;\n    var arg;\n    for (var i = 0; i < len; i++) {\n      arg = arguments[i];\n      if (valid(arg)) {\n        return arg;\n      }\n    }\n    return arg;\n  }\n}\n\n/**\n * Check to see if a value actually has a valid value:\n *  - not undefined\n *  - not null\n *  - not NaN (not a number)\n *\n * @param  {*} `val` value to check\n * @return {Boolean} returns `true` if the `val` has a valid value\n */\n\nfunction hasValue(val) {\n  // eslint-disable-next-line no-self-compare\n  return val != null && val === val;\n}\n\n/**\n * Check to see if a value actually has a strictly valid value:\n *  - not undefined\n *  - not NaN (not a number)\n *\n * @param  {*} `val` value to check\n * @return {Boolean} returns `true` if the `val` has a valid value\n */\n\nfunction hasStrictValue(val) {\n  // eslint-disable-next-line no-self-compare\n  return typeof val !== 'undefined' && val === val;\n}\n\n/**\n * Expose koalas\n */\n\nmodule.exports = koalas;\n";

/** Add the missing `&apos;` HTML entity and cache the replace regex. A check that is not that entity mapping is refused. */
export function addMissingAposInUnescape(source: string): string | null {
  if (!source.includes("var chars = unescape.chars = {\n  '&#39;': '\\'',\n  '&amp;': '&',\n  '&gt;': '>',\n  '&lt;': '<',\n  '&quot;': '\"'\n};\n")) return null;
  return source === UE_OLD ? UE_NEW : null;
}

/** Filter `__proto__`, `constructor`, and `prototype` keys so a getter is not defined on the prototype. A check that is not that key filter is refused. */
export function filterInvalidKeysInSetGetter(source: string): string | null {
  if (!source.includes("  if (!~prop.indexOf('.')) {\n    defineProperty(obj, prop, getter);\n    return obj;\n  }\n\n  var keys = prop.split('.');\n")) return null;
  return source === SG_OLD ? SG_NEW : null;
}

/** Return the last argument when no value is valid, instead of null, and expose a strict coalesce. A check that is not that last-argument return is refused. */
export function returnLastArgInKoalas(source: string): string | null {
  if (!source.includes("    if (hasValue(arg)) {\n      return arg;\n    }\n  }\n  return null;\n}\n")) return null;
  return source === KO_OLD ? KO_NEW : null;
}

export interface Batch57Input {
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
export function repairBatch57(input: Batch57Input): { diff: string; file: string } | null {
  if (!/Error|not equal|Expected|Invalid|fail|toEqual|toBe|AssertionError|TypeError|undefined|to equal|deeply equivalent|deepEqual|true == false|false == true|evaluated to a falsy|loosely deep-equal|Missing expected exception|Received null|Received undefined|must be of type/i.test(input.output)) return null;
  const edits: { path: string; next: string; original: string }[] = [];
  for (const path of filesOf(input.root, input.sourcePattern)) {
    const original = readLocal(input.root, path);
    if (original === null) continue;
    const next = addMissingAposInUnescape(original) ?? filterInvalidKeysInSetGetter(original) ?? returnLastArgInKoalas(original);
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
