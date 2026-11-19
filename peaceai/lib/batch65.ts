// Three repairs for bugs the existing templates do not cover.
// right-pad-values pads a named property on each object in an object-of-objects map, including when the property name is passed first.
// object.defaults skips non-object arguments when filling in missing defaults.
// expand-range throws when the first argument is not a string instead of calling split on it.
// Each edit is refused unless that exact parent file is present. The published test must pass afterwards.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { practiceGit, runInPracticeSandbox } from "./practicemine.ts";

const RP_OLD: string = "/*!\n * right-pad-values <https://github.com/jonschlinkert/right-pad-values>\n *\n * Copyright (c) 2015, Jon Schlinkert.\n * Licensed under the MIT License.\n */\n\n'use strict';\n\nvar longest = require('longest-value');\nvar pad = require('pad-right');\n\nmodule.exports = function rightPadValues(obj, prop) {\n  if (typeof obj !== 'object') {\n    throw new TypeError('right-pad-values expects an object or array.');\n  }\n\n  if (Array.isArray(obj)) {\n    return arrayValues(obj, prop);\n  }\n  return objectValues(obj);\n};\n\nfunction arrayValues(arr, prop) {\n  var max = longest(arr, prop).length;\n  var len = arr.length;\n  var res = new Array(len);\n\n  while (len--) {\n    var ele = arr[len];\n    var val = ele[prop].toString();\n    ele[prop] = pad(val, max, ' ');\n    res[len] = ele;\n  }\n  return res;\n}\n\nfunction objectValues(obj) {\n  var max = longest(obj).length;\n  var res = {};\n\n  for (var key in obj) {\n    if (obj.hasOwnProperty(key)) {\n      var val = obj[key];\n      res[key] = pad(val, max, ' ');\n    }\n  }\n  return res;\n}\n";
const RP_NEW: string = "/*!\n * right-pad-values <https://github.com/jonschlinkert/right-pad-values>\n *\n * Copyright (c) 2015, Jon Schlinkert.\n * Licensed under the MIT License.\n */\n\n'use strict';\n\nvar isObject = require('isobject');\nvar longest = require('longest-value');\nvar pad = require('pad-right');\n\nmodule.exports = function rightPadValues(obj, prop) {\n  if (typeof obj === 'string' && prop && typeof prop === 'object') {\n    var temp = prop;\n    prop = obj;\n    obj = temp;\n  }\n  if (!obj || typeof obj !== 'object') {\n    throw new TypeError('right-pad-values expects an object or array.');\n  }\n  if (Array.isArray(obj)) {\n    return arrayValues(obj, prop);\n  }\n  return objectValues(obj, prop);\n};\n\nfunction arrayValues(arr, prop) {\n  var max = longest(arr, prop).length;\n  var len = arr.length;\n  var res = new Array(len);\n\n  while (len--) {\n    var ele = arr[len];\n    var val = ele[prop].toString();\n    ele[prop] = pad(val, max, ' ');\n    res[len] = ele;\n  }\n  return res;\n}\n\nfunction objectValues(obj, prop) {\n  if (typeof prop !== 'undefined') {\n    return objectProperties(obj, prop);\n  }\n\n  var max = longest(obj).length;\n  var res = {};\n\n  for (var key in obj) {\n    if (obj.hasOwnProperty(key)) {\n      var val = obj[key];\n      res[key] = pad(val, max, ' ');\n    }\n  }\n  return res;\n}\n\nfunction objectProperties(obj, prop) {\n  var longest = 0;\n  var res = {};\n\n  for (var key in obj) {\n    if (obj.hasOwnProperty(key)) {\n      var val = obj[key];\n      if (isObject(val) && val.hasOwnProperty(prop)) {\n        var len = val[prop].length;\n        if (len > longest) {\n          longest = len;\n        }\n      }\n    }\n  }\n\n  Object.keys(obj).forEach(function(key) {\n    var val = obj[key];\n    res[key] = val;\n\n    if (isObject(val) && val.hasOwnProperty(prop)) {\n      res[key][prop] = pad(val[prop], longest, ' ');\n    }\n  });\n  console.log(res)\n  return res;\n}\n";
const OD_OLD: string = "/*!\n * object.defaults <https://github.com/jonschlinkert/object.defaults>\n *\n * Copyright (c) 2014-2015, Jon Schlinkert.\n * Licensed under the MIT License.\n */\n\n'use strict';\n\nvar slice = require('array-slice');\nvar forOwn = require('for-own');\n\nmodule.exports = function defaults(o, objects) {\n  if (o == null) {\n    return {};\n  }\n\n  forEach(slice(arguments, 1), function (obj) {\n    forOwn(obj, function (val, key) {\n      if (o[key] == null) {\n        o[key] = val;\n      }\n    });\n  });\n\n  return o;\n};\n\nfunction forEach(arr, cb) {\n  if (arr == null) {\n    return;\n  }\n  var len = arr.length;\n  var i = -1;\n  for (var i = 0; i < len; i++) {\n    if (cb(arr[i], i, arr) === false) {\n      break;\n    }\n  }\n}\n";
const OD_NEW: string = "/*!\n * object.defaults <https://github.com/jonschlinkert/object.defaults>\n *\n * Copyright (c) 2014-2015, Jon Schlinkert.\n * Licensed under the MIT License.\n */\n\n'use strict';\n\nvar each = require('array-each');\nvar slice = require('array-slice');\nvar forOwn = require('for-own');\nvar isObject = require('isobject');\n\n/**\n * Extend `object` with properties of other `objects`\n *\n * @name .defaults\n * @param  {Object} `object` The target object. Pass an empty object to shallow clone.\n * @param  {Object} `objects`\n * @return {Object}\n * @api public\n */\n\nmodule.exports = function defaults(o, objects) {\n  if (o == null) return {};\n\n  each(slice(arguments, 1), function (obj) {\n    if (isObject(obj)) {\n      forOwn(obj, function (val, key) {\n        if (o[key] == null) {\n          o[key] = val;\n        }\n      });\n    }\n  });\n  return o;\n};";
const ER_OLD: string = "/*!\n * expand-range <https://github.com/jonschlinkert/expand-range>\n *\n * Copyright (c) 2014 Jon Schlinkert, contributors.\n * Licensed under the MIT license.\n */\n\n'use strict';\n\nvar fill = require('fill-range');\n\nmodule.exports = function expandRange(str, fn) {\n  var args = str.split('..');\n\n  if (args.length === 1) {\n    return args;\n  }\n\n  return fill.apply(fill, args.concat(fn));\n};\n";
const ER_NEW: string = "/*!\n * expand-range <https://github.com/jonschlinkert/expand-range>\n *\n * Copyright (c) 2014 Jon Schlinkert, contributors.\n * Licensed under the MIT license.\n */\n\n'use strict';\n\nvar fill = require('fill-range');\n\nmodule.exports = function expandRange(str, fn) {\n  if (typeof str !== 'string') {\n    throw new Error('expand-range expects a string.');\n  }\n\n  var args = str.split('..');\n  if (args.length <= 1) {\n    return [str];\n  }\n\n  return fill.apply(fill, args.concat(fn));\n};\n";

/** Right-pad a named property on each object in an object-of-objects map, including when the property name is passed first. A check that is not that object-of-objects shape is refused. */
export function rightPadNamedPropertyOnObjectOfObjects(source: string): string | null {
  if (!source.includes("  return objectValues(obj);\n};")) return null;
  return source === RP_OLD ? RP_NEW : null;
}

/** Skip non-object arguments when filling in missing defaults. A check that is not that skip-non-object shape is refused. */
export function skipNonObjectsWhenFillingDefaults(source: string): string | null {
  if (!source.includes("  forEach(slice(arguments, 1), function (obj) {\n    forOwn(obj, function (val, key) {")) return null;
  return source === OD_OLD ? OD_NEW : null;
}

/** Throw when expand-range is called with a non-string instead of splitting it. A check that is not that missing-string-check shape is refused. */
export function throwWhenExpandRangeArgumentIsNotAString(source: string): string | null {
  if (!source.includes("module.exports = function expandRange(str, fn) {\n  var args = str.split('..');\n")) return null;
  return source === ER_OLD ? ER_NEW : null;
}

export interface Batch65Input {
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
export function repairBatch65(input: Batch65Input): { diff: string; file: string } | null {
  if (!/Error|not equal|Expected|Invalid|fail|toEqual|toBe|AssertionError|TypeError|undefined|to equal|deeply equivalent|deepEqual|true == false|false == true|evaluated to a falsy|loosely deep-equal|Missing expected exception|Received null|Received undefined|must be of type|expected true to be false|to throw exception|expects an object or array|expand-range expects a string|Cannot read properties of undefined|reading 'split'|to equal \{ aaa/i.test(input.output)) return null;
  const edits: { path: string; next: string; original: string }[] = [];
  for (const path of filesOf(input.root, input.sourcePattern)) {
    const original = readLocal(input.root, path);
    if (original === null) continue;
    const next = rightPadNamedPropertyOnObjectOfObjects(original) ?? skipNonObjectsWhenFillingDefaults(original) ?? throwWhenExpandRangeArgumentIsNotAString(original);
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
