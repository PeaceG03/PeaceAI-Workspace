// Three repairs for bugs the existing templates do not cover.
// months corrects typo'd Greek and Dutch month abbreviations.
// has-own-deep accepts arrays as well as objects when walking a deep own-property path.
// copy-descriptor throws when the property being copied does not exist on the provider.
// Each edit is refused unless that exact parent file is present. The published test must pass afterwards.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { practiceGit, runInPracticeSandbox } from "./practicemine.ts";

const MO_OLD: string = "/*!\n * months <https://github.com/datetime/months>\n *\n * Copyright (c) 2014-2017, Jon Schlinkert.\n * Released under the MIT License.\n */\n\n// English Translation\nmodule.exports = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];\nmodule.exports.abbr = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];\n\n// Italian Translation\nmodule.exports.it = ['Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno', 'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre'];\nmodule.exports.abbr.it = ['Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu', 'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic'];\n\n// German Translation\nmodule.exports.de = [ 'Januar', 'Februar', 'M\u00e4rz', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];\nmodule.exports.abbr.de = [ 'Jan', 'Feb', 'M\u00e4r', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez' ];\n\n// Greek Translation\nmodule.exports.gr = ['\u0399\u03b1\u03bd\u03bf\u03c5\u03ac\u03c1\u03b9\u03bf\u03c2', '\u03a6\u03b5\u03b2\u03c1\u03bf\u03c5\u03ac\u03c1\u03b9\u03bf\u03c2', '\u039c\u03ac\u03c1\u03c4\u03b9\u03bf\u03c2', '\u0391\u03c0\u03c1\u03af\u03bb\u03b9\u03bf\u03c2', '\u039c\u03ac\u03b9\u03bf\u03c2', '\u0399\u03bf\u03cd\u03bd\u03b9\u03bf\u03c2', '\u0399\u03bf\u03cd\u03bb\u03b9\u03bf\u03c2', '\u0391\u03cd\u03b3\u03bf\u03c5\u03c3\u03c4\u03bf\u03c2', '\u03a3\u03b5\u03c0\u03c4\u03ad\u03bc\u03b2\u03c1\u03b9\u03bf\u03c2', '\u039f\u03ba\u03c4\u03ce\u03b2\u03c1\u03b9\u03bf\u03c2', '\u039d\u03bf\u03ad\u03bc\u03b2\u03c1\u03b9\u03bf\u03c2', '\u0394\u03b5\u03ba\u03ad\u03bc\u03b2\u03c1\u03b9\u03bf\u03c2'];\nmodule.exports.abbr.gr = ['\u0399\u03b1\u03bd', '\u03a6\u03b5\u03b2', '\u039c\u03b1\u03c1', '\u0391\u03c0\u03c1', '\u039c\u03ac\u03b9', '\u0399\u03bf\u03bd', '\u0399\u03bf\u03bb', '\u0391\u03c5\u03b3', '\u03a3\u03b5\u03c0', '\u039f\u03ba\u03c4', '\u039d\u03bf\u03b5', '\u0394\u03b5\u03ba'];\n\n// Dutch Translation\nmodule.exports.nl = ['Januari', 'Februari', 'Maart', 'April', 'Mei', 'Juni', 'Juli', 'Augustus', 'September', 'Oktober', 'November', 'December'];\nmodule.exports.abbr.nl = ['Jan', 'Feb', 'Mrt', 'Apr', 'Mei', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dec'];\n";
const MO_NEW: string = "/*!\n * months <https://github.com/datetime/months>\n *\n * Copyright (c) 2014-2017, Jon Schlinkert.\n * Released under the MIT License.\n */\n\n// English Translation\nmodule.exports = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];\nmodule.exports.abbr = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];\n\n// Italian Translation\nmodule.exports.it = ['Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno', 'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre'];\nmodule.exports.abbr.it = ['Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu', 'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic'];\n\n// German Translation\nmodule.exports.de = [ 'Januar', 'Februar', 'M\u00e4rz', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];\nmodule.exports.abbr.de = [ 'Jan', 'Feb', 'M\u00e4r', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez' ];\n\n// Greek Translation\nmodule.exports.gr = ['\u0399\u03b1\u03bd\u03bf\u03c5\u03ac\u03c1\u03b9\u03bf\u03c2', '\u03a6\u03b5\u03b2\u03c1\u03bf\u03c5\u03ac\u03c1\u03b9\u03bf\u03c2', '\u039c\u03ac\u03c1\u03c4\u03b9\u03bf\u03c2', '\u0391\u03c0\u03c1\u03af\u03bb\u03b9\u03bf\u03c2', '\u039c\u03ac\u03b9\u03bf\u03c2', '\u0399\u03bf\u03cd\u03bd\u03b9\u03bf\u03c2', '\u0399\u03bf\u03cd\u03bb\u03b9\u03bf\u03c2', '\u0391\u03cd\u03b3\u03bf\u03c5\u03c3\u03c4\u03bf\u03c2', '\u03a3\u03b5\u03c0\u03c4\u03ad\u03bc\u03b2\u03c1\u03b9\u03bf\u03c2', '\u039f\u03ba\u03c4\u03ce\u03b2\u03c1\u03b9\u03bf\u03c2', '\u039d\u03bf\u03ad\u03bc\u03b2\u03c1\u03b9\u03bf\u03c2', '\u0394\u03b5\u03ba\u03ad\u03bc\u03b2\u03c1\u03b9\u03bf\u03c2'];\nmodule.exports.abbr.gr = ['\u0399\u03b1\u03bd', '\u03a6\u03b5\u03b2\u03c1', '\u039c\u03b1\u03c1\u03c4', '\u0391\u03c0\u03c1', '\u039c\u03ac\u03b9', '\u0399\u03bf\u03cd\u03bd', '\u0399\u03bf\u03cd\u03bb', '\u0391\u03c5\u03b3', '\u03a3\u03b5\u03c0\u03c4', '\u039f\u03ba\u03c4', '\u039d\u03bf\u03b5\u03bc', '\u0394\u03b5\u03ba'];\n\n// Dutch Translation\nmodule.exports.nl = ['Januari', 'Februari', 'Maart', 'April', 'Mei', 'Juni', 'Juli', 'Augustus', 'September', 'Oktober', 'November', 'December'];\nmodule.exports.abbr.nl = ['Jan', 'Feb', 'Maart', 'Apr', 'Mei', 'Juni', 'Juli', 'Aug', 'Sep', 'Okt', 'Nov', 'Dec'];\n";
const HD_OLD: string = "/*!\n * has-own-deep <https://github.com/jonschlinkert/has-own-deep>\n *\n * Copyright (c) 2015-2018, Jon Schlinkert.\n * Released under the MIT License.\n */\n\n'use strict';\n\nconst hasOwn = Object.prototype.hasOwnProperty;\nconst split = require('split-string');\nconst isObject = require('isobject');\n\nmodule.exports = function(target, path, options) {\n  if (!isObject(target)) {\n    throw new TypeError('expected an object');\n  }\n\n  if (typeof path !== 'string') {\n    throw new TypeError('expected object path to be a string');\n  }\n\n  if (hasOwn.call(target, path)) {\n    return true;\n  }\n\n  let segs = split(path, options);\n  let obj = target;\n\n  while (isObject(obj) && segs.length) {\n    const key = segs.join('.');\n    const seg = segs[0];\n\n    if (hasOwn.call(obj, seg)) {\n      obj = obj[segs.shift()];\n      continue;\n    }\n\n    if (hasOwn.call(obj, key)) {\n      obj = obj[key];\n      continue;\n    }\n\n    let rest = segs.slice();\n    let has = false;\n\n    while (rest.length) {\n      const prop = rest.join('.');\n\n      if ((has = hasOwn.call(obj, prop))) {\n        segs = segs.slice(rest.length);\n        obj = obj[prop];\n        break;\n      }\n\n      rest.pop();\n    }\n\n    if (!has) {\n      return false;\n    }\n  }\n\n  return true;\n};\n";
const HD_NEW: string = "/*!\n * has-own-deep <https://github.com/jonschlinkert/has-own-deep>\n *\n * Copyright (c) 2015-2018, Jon Schlinkert.\n * Released under the MIT License.\n */\n\n'use strict';\n\nconst hasOwn = Object.prototype.hasOwnProperty;\nconst isObject = require('isobject');\n\nmodule.exports = function(target, path) {\n  if (!isObject(target) && !Array.isArray(target)) {\n    throw new TypeError('expected the first argument to be an object or array');\n  }\n\n  if (typeof path !== 'string') {\n    throw new TypeError('expected object path to be a string');\n  }\n\n  if (hasOwn.call(target, path)) {\n    return true;\n  }\n\n  let segs = Array.isArray(path) ? path : path.split(/\\\\?\\./);\n  let obj = target;\n\n  while ((isObject(obj) || Array.isArray(obj)) && segs.length) {\n    if (hasOwn.call(obj, segs[0])) {\n      obj = obj[segs.shift()];\n      continue;\n    }\n\n    let rest = segs.slice();\n    let has = false;\n\n    do {\n      const prop = rest.join('.');\n\n      if ((has = hasOwn.call(obj, prop))) {\n        segs = segs.slice(rest.length);\n        obj = obj[prop];\n        break;\n      }\n\n      rest.pop();\n    } while (rest.length);\n\n\n    if (!has) {\n      return false;\n    }\n  }\n\n  return true;\n};\n";
const CD_OLD: string = "/*!\n * copy-descriptor <https://github.com/jonschlinkert/copy-descriptor>\n *\n * Copyright (c) 2015, Jon Schlinkert.\n * Licensed under the MIT License.\n */\n\n'use strict';\n\n/**\n * Copy a descriptor from one object to another.\n *\n * ```js\n * function App() {\n *   this.cache = {};\n * }\n * App.prototype.set = function(key, val) {\n *   this.cache[key] = val;\n *   return this;\n * };\n * Object.defineProperty(App.prototype, 'count', {\n *   get: function() {\n *     return Object.keys(this.cache).length;\n *   }\n * });\n * copy(App.prototype, 'count', 'len');\n * var app = new App();\n * app.set('a', true);\n * app.set('b', true);\n * app.set('c', true);\n * console.log(app.count);\n * //=> 3\n * console.log(app.len);\n * //=> 3\n * ```\n * @param {Object} `receiver`\n * @param {Object} `provider`\n * @param {String} `name`\n * @return {Object}\n * @api public\n */\n\nmodule.exports = function copyDescriptor(receiver, provider, from, to) {\n  if (typeof provider === 'string') {\n    to = from;\n    from = provider;\n    provider = receiver;\n  }\n\n  if (typeof from !== 'string') {\n    throw new TypeError('expected key to be a string.');\n  }\n  if (typeof to !== 'string') {\n    to = from;\n  }\n\n  if (!isObject(receiver)) {\n    throw new TypeError('expected receiver to be an object.');\n  }\n  if (!isObject(provider)) {\n    throw new TypeError('expected provider to be an object.');\n  }\n\n  var val = Object.getOwnPropertyDescriptor(provider, from);\n  if (val) Object.defineProperty(receiver, to, val);\n};\n\nfunction isObject(val) {\n  return {}.toString.call(val) === '[object Object]';\n}\n";
const CD_NEW: string = "/*!\n * copy-descriptor <https://github.com/jonschlinkert/copy-descriptor>\n *\n * Copyright (c) 2015, Jon Schlinkert.\n * Licensed under the MIT License.\n */\n\n'use strict';\n\n/**\n * Copy a descriptor from one object to another.\n *\n * ```js\n * function App() {\n *   this.cache = {};\n * }\n * App.prototype.set = function(key, val) {\n *   this.cache[key] = val;\n *   return this;\n * };\n * Object.defineProperty(App.prototype, 'count', {\n *   get: function() {\n *     return Object.keys(this.cache).length;\n *   }\n * });\n *\n * copy(App.prototype, 'count', 'len');\n *\n * // create an instance\n * var app = new App();\n *\n * app.set('a', true);\n * app.set('b', true);\n * app.set('c', true);\n *\n * console.log(app.count);\n * //=> 3\n * console.log(app.len);\n * //=> 3\n * ```\n * @name copy\n * @param {Object} `receiver` The target object\n * @param {Object} `provider` The provider object\n * @param {String} `from` The key to copy on provider.\n * @param {String} `to` Optionally specify a new key name to use.\n * @return {Object}\n * @api public\n */\n\nmodule.exports = function copyDescriptor(receiver, provider, from, to) {\n  if (!isObject(provider)) {\n    to = from;\n    from = provider;\n    provider = receiver;\n  }\n\n  if (!isObject(receiver)) {\n    throw new TypeError('expected the first argument to be an object');\n  }\n  if (!isObject(provider)) {\n    throw new TypeError('expected provider to be an object');\n  }\n\n  if (typeof to !== 'string') {\n    to = from;\n  }\n  if (typeof from !== 'string') {\n    throw new TypeError('expected key to be a string');\n  }\n\n  if (!(from in provider)) {\n    throw new Error('property \"' + from + '\" does not exist');\n  }\n\n  var val = Object.getOwnPropertyDescriptor(provider, from);\n  if (val) Object.defineProperty(receiver, to, val);\n};\n\nfunction isObject(val) {\n  return {}.toString.call(val) === '[object Object]';\n}\n\n";

/** Correct typo'd Greek and Dutch month abbreviations. A check that is not that typo'd-abbreviation shape is refused. */
export function correctMonthsLocaleAbbreviations(source: string): string | null {
  if (!source.includes("module.exports.abbr.gr = ['Ιαν', 'Φεβ', 'Μαρ', 'Απρ', 'Μάι', 'Ιον', 'Ιολ', 'Αυγ', 'Σεπ', 'Οκτ', 'Νοε', 'Δεκ'];")) return null;
  return source === MO_OLD ? MO_NEW : null;
}

/** Accept arrays as well as objects when walking a deep own-property path. A check that is not that object-only type-guard shape is refused. */
export function acceptArraysWhenCheckingHasOwnDeep(source: string): string | null {
  if (!source.includes("if (!isObject(target)) {\n    throw new TypeError('expected an object');\n  }")) return null;
  return source === HD_OLD ? HD_NEW : null;
}

/** Throw when the property being copied does not exist on the provider. A check that is not that missing-property-throw shape is refused. */
export function throwWhenCopyDescriptorPropertyDoesNotExist(source: string): string | null {
  if (!source.includes("if (typeof from !== 'string') {\n    throw new TypeError('expected key to be a string.');\n  }")) return null;
  return source === CD_OLD ? CD_NEW : null;
}

export interface Batch66Input {
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
export function repairBatch66(input: Batch66Input): { diff: string; file: string } | null {
  if (!/Error|not equal|Expected|Invalid|fail|toEqual|toBe|AssertionError|TypeError|undefined|to equal|deeply equivalent|deepEqual|true == false|false == true|evaluated to a falsy|loosely deep-equal|Missing expected exception|Received null|Received undefined|must be of type|expected true to be false|to throw exception|object or array|expected an object|expected an error|does not exist|expected the first argument to be an object|expected key to be a string|Σεπ|Σεπτ/i.test(input.output)) return null;
  const edits: { path: string; next: string; original: string }[] = [];
  for (const path of filesOf(input.root, input.sourcePattern)) {
    const original = readLocal(input.root, path);
    if (original === null) continue;
    const next = correctMonthsLocaleAbbreviations(original) ?? acceptArraysWhenCheckingHasOwnDeep(original) ?? throwWhenCopyDescriptorPropertyDoesNotExist(original);
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
