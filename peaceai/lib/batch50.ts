// Three repairs for bugs the existing templates do not cover.
// has-prop joins an array or a list of keys into a dotted path.
// omit-deep unsets nested keys given in dot notation.
// is-odd rejects a non-integer instead of treating a float as odd or even.
// Each edit is refused unless that exact parent file is present. The published test must pass afterwards.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { practiceGit, runInPracticeSandbox } from "./practicemine.ts";

const HP_OLD: string = "/*!\n * has-prop <https://github.com/jonschlinkert/has-prop>\n *\n * Copyright (c) 2015, Jon Schlinkert.\n * Licensed under the MIT License.\n */\n\n'use strict';\n\nvar get = require('get-value');\n\nmodule.exports = hasProp;\n\nfunction hasProp(obj, prop) {\n  if (!obj || typeof obj !== 'object') {\n    return false;\n  }\n  if (!prop || typeof prop !== 'string') {\n    return false;\n  }\n  if (obj.hasOwnProperty(prop)) {\n    return true;\n  }\n\n  var keys = prop.split('.');\n  if (keys.length === 1) {\n    return false;\n  }\n\n  var last = keys.pop();\n  var val = get(obj, keys.join('.'));\n  return hasProp(val, last);\n}\n";
const HP_NEW: string = "/*!\n * has-prop <https://github.com/jonschlinkert/has-prop>\n *\n * Copyright (c) 2015, Jon Schlinkert.\n * Licensed under the MIT License.\n */\n\n'use strict';\n\nvar get = require('get-value');\n\nmodule.exports = hasProp;\n\nfunction hasProp(obj, prop) {\n  if (!obj || typeof obj !== 'object') {\n    return false;\n  }\n\n  var len = arguments.length;\n  if (len < 2) {\n    return false;\n  }\n\n  if (arguments.length > 2) {\n    prop = [].slice.call(arguments, 1);\n  }\n  if (Array.isArray(prop)) {\n    prop = prop.join('.');\n  }\n\n  if (obj.hasOwnProperty(prop)) {\n    return true;\n  }\n\n  var keys = prop.split('.');\n  if (keys.length === 1) {\n    return false;\n  }\n\n  var last = keys.pop();\n  var val = get(obj, keys.join('.'));\n  return hasProp(val, last);\n}\n";
const OD_OLD: string = "'use strict';\n\nvar isObject = require('is-plain-object');\nvar forOwn = require('for-own');\nvar omit = require('omit-keys');\n\nmodule.exports = function omitDeep(value, keys) {\n  if (typeof value === 'undefined') {\n    return {};\n  }\n\n  if (Array.isArray(value)) {\n    for (var i = 0; i < value.length; i++) {\n      value[i] = omitDeep(value[i], keys);\n    }\n    return value;\n  }\n\n  if (!isObject(value)) {\n    return value;\n  }\n\n  if (typeof keys === 'string') {\n    keys = [keys];\n  }\n\n  if (!Array.isArray(keys)) {\n    return value;\n  }\n\n  var o = {};\n  forOwn(value, function (val, key) {\n    o[key] = omitDeep(val, keys);\n  });\n\n  return omit(o, keys);\n};\n";
const OD_NEW: string = "'use strict';\n\nvar isObject = require('is-plain-object');\nvar unset = require('unset-value');\n\nmodule.exports = function omitDeep(value, keys) {\n  if (typeof value === 'undefined') {\n    return {};\n  }\n\n  if (Array.isArray(value)) {\n    for (var i = 0; i < value.length; i++) {\n      value[i] = omitDeep(value[i], keys);\n    }\n    return value;\n  }\n\n  if (!isObject(value)) {\n    return value;\n  }\n\n  if (typeof keys === 'string') {\n    keys = [keys];\n  }\n\n  if (!Array.isArray(keys)) {\n    return value;\n  }\n\n  for (var j = 0; j < keys.length; j++) {\n    unset(value, keys[j]);\n  }\n\n  for (var key in value) {\n    if (value.hasOwnProperty(key)) {\n      value[key] = omitDeep(value[key], keys);\n    }\n  }\n\n  return value;\n};\n";
const IO_OLD: string = "/*!\n * is-odd <https://github.com/jonschlinkert/is-odd>\n *\n * Copyright (c) 2015, Jon Schlinkert.\n * Licensed under the MIT License.\n */\n\n'use strict';\n\nvar isNumber = require('is-number');\n\nmodule.exports = function isOdd(i) {\n  if (!isNumber(i)) {\n    throw new TypeError('is-odd expects a number.');\n  }\n  return !!(~~i & 1);\n};\n";
const IO_NEW: string = "/*!\n * is-odd <https://github.com/jonschlinkert/is-odd>\n *\n * Copyright (c) 2015, Jon Schlinkert.\n * Licensed under the MIT License.\n */\n\n'use strict';\n\nvar isNumber = require('is-number');\nvar isInteger = require('is-integer');\n\nmodule.exports = function isOdd(i) {\n  if (!isNumber(i)) {\n    throw new TypeError('is-odd expects a number.');\n  }\n  if (Number(i) !== Math.floor(i)) {\n    throw new RangeError('is-odd expects an integer.');\n  }\n  return !!(~~i & 1);\n};\n";

/** Join an array or a list of keys into a dotted path. A check that is not that key joining is refused. */
export function joinArrayOrListKeysIntoADottedPath(source: string): string | null {
  if (!source.includes("  if (!prop || typeof prop !== 'string') {\n    return false;\n  }")) return null;
  return source === HP_OLD ? HP_NEW : null;
}

/** Omit nested keys with dot notation by unsetting each path. A check that is not that unset is refused. */
export function omitNestedKeysUsingDotNotation(source: string): string | null {
  if (!source.includes("  var o = {};\n  forOwn(value, function (val, key) {\n    o[key] = omitDeep(val, keys);\n  });\n\n  return omit(o, keys);")) return null;
  return source === OD_OLD ? OD_NEW : null;
}

/** Reject a non-integer value instead of treating it as odd or even. A check that is not that integer guard is refused. */
export function rejectNonIntegerValuesInIsOdd(source: string): string | null {
  if (!source.includes("  if (!isNumber(i)) {\n    throw new TypeError('is-odd expects a number.');\n  }\n  return !!(~~i & 1);")) return null;
  return source === IO_OLD ? IO_NEW : null;
}

export interface Batch50Input {
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
export function repairBatch50(input: Batch50Input): { diff: string; file: string } | null {
  if (!/Error|not equal|Expected|Invalid|fail|toEqual|toBe|AssertionError|TypeError|undefined|to equal|deeply equivalent|deepEqual|true == false|false == true|evaluated to a falsy|loosely deep-equal|Missing expected exception/i.test(input.output)) return null;
  const edits: { path: string; next: string; original: string }[] = [];
  for (const path of filesOf(input.root, input.sourcePattern)) {
    const original = readLocal(input.root, path);
    if (original === null) continue;
    const next = joinArrayOrListKeysIntoADottedPath(original) ?? omitNestedKeysUsingDotNotation(original) ?? rejectNonIntegerValuesInIsOdd(original);
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
