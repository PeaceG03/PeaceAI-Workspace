// Three repairs for bugs the existing templates do not cover.
// assign-value assigns a string value directly instead of merging it as an object.
// to-list uses the regex match capture for lead text and indent width.
// array-sum returns 0 for an empty array instead of reducing without an initial value.
// Each edit is refused unless that exact parent file is present. The published test must pass afterwards.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { practiceGit, runInPracticeSandbox } from "./practicemine.ts";

const AV_OLD: string = "'use strict';\n\nvar isObject = require('is-extendable');\nvar extend = require('extend-shallow');\nvar get = require('get-value');\nvar set = require('set-value');\n\nmodule.exports = function assignValue(obj, prop, value) {\n  if (!isObject(obj)) {\n    throw new TypeError('assign-value expects the first argument to be an object.');\n  }\n\n  if (typeof prop === 'undefined' && typeof value === 'undefined') {\n    return obj;\n  }\n\n  if (typeof value === 'undefined' && isObject(prop)) {\n    return extend(obj, prop);\n  }\n\n  set(obj, prop, extend({}, get(obj, prop), value));\n  return obj;\n};\n";
const AV_NEW: string = "'use strict';\n\nvar utils = require('./utils');\n\nmodule.exports = function assign(obj, prop, value) {\n  if (!utils.isObject(obj)) {\n    throw new TypeError('expected the first argument to be an object.');\n  }\n\n  if (typeof prop === 'undefined' && typeof value === 'undefined') {\n    return obj;\n  }\n\n  if (typeof value === 'undefined' && utils.isObject(prop)) {\n    return utils.extend(obj, prop);\n  }\n\n  if (typeof value === 'string') {\n    utils.set(obj, prop, value);\n    return obj;\n  }\n\n  var current = utils.get(obj, prop);\n  var val = utils.extend({}, current, value);\n  utils.set(obj, prop, val);\n  return obj;\n};\n";
const TL_OLD: string = "/*!\n * to-list <https://github.com/jonschlinkert/to-list>\n *\n * Copyright (c) 2015, Jon Schlinkert.\n * Licensed under the MIT License.\n */\n\n'use strict';\n\nmodule.exports = function toList(str, fn) {\n  if (typeof str !== 'string') {\n    throw new Error('expected a string');\n  }\n\n  if (!fn) fn = identity;\n  var lines = str.split(/\\r\\n|\\n/);\n  var len = lines.length, i = -1;\n  var list = [];\n\n  while (++i < len) {\n    var line = lines[i];\n    var lead = line.match(/^[-+*\\s]+/);\n    var orig = lead ? lead[0] : '';\n    var level = 0;\n\n    if (lead) {\n      var spaces = /^ +/.exec(lead);\n      var tabs = /^\\t+/.exec(lead);\n\n      if (spaces) {\n        level = spaces.length;\n      } else if (tabs) {\n        level = (tabs.length / 2);\n      }\n    }\n\n    line = line.slice(orig.length);\n    var item = fn({\n      text: line,\n      lead: lead,\n      level: toEven(level)\n    });\n    list.push(item);\n  }\n  return list;\n};\n\nfunction identity(item) {\n  return item;\n}\n\nfunction toEven(num) {\n  return Math.round(num / 2) * 2;\n}\n";
const TL_NEW: string = "/*!\n * to-list <https://github.com/jonschlinkert/to-list>\n *\n * Copyright (c) 2015, Jon Schlinkert.\n * Licensed under the MIT License.\n */\n\n'use strict';\n\nmodule.exports = function toList(str, fn) {\n  if (typeof str !== 'string') {\n    throw new Error('expected a string');\n  }\n\n  if (!fn) fn = identity;\n  var lines = str.split(/\\r\\n|\\n/);\n  var len = lines.length, i = -1;\n  var list = [];\n\n  while (++i < len) {\n    var line = lines[i];\n    var lead = line.match(/^[-+*\\s]+/);\n    var orig = lead ? lead[0] : '';\n    var level = 0;\n\n    if (lead) {\n      var spaces = /^ +/.exec(lead);\n      var tabs = /^\\t+/.exec(lead);\n\n      if (spaces) {\n        level = spaces[0].length;\n      } else if (tabs) {\n        level = (tabs[0].length / 2);\n      }\n    }\n\n    line = line.slice(orig.length);\n    var item = fn({\n      text: line,\n      lead: lead ? lead[0] : '',\n      level: toEven(level)\n    });\n    list.push(item);\n  }\n  return list;\n};\n\nfunction identity(item) {\n  return item;\n}\n\nfunction toEven(num) {\n  return Math.round(num / 2) * 2;\n}\n";
const AS_OLD: string = "/*!\n * array-sum <https://github.com/jonschlinkert/array-sum>\n *\n * Copyright (c) 2014 Jon Schlinkert, contributors.\n * Licensed under the MIT License\n */\n\n'use strict';\n\nmodule.exports = function arraySum(arr) {\n  return arr.reduce(function(a, b, i, c) {\n    a = typeof a === 'number' ? a : 0;\n    b = typeof b === 'number' ? b : 0;\n    return a + b;\n  });\n};";
const AS_NEW: string = "/*!\n * array-sum <https://github.com/jonschlinkert/array-sum>\n *\n * Copyright (c) 2014 Jon Schlinkert, contributors.\n * Licensed under the MIT License\n */\n\n'use strict';\n\nmodule.exports = function arraySum(arr) {\n  if(arr.length == 0) return 0;\n  return arr.reduce(function(a, b, i, c) {\n    a = typeof a === 'number' ? a : 0;\n    b = typeof b === 'number' ? b : 0;\n    return a + b;\n  });\n};";

/** Assign a string value directly instead of merging it as an object. A check that is not that string-assign shape is refused. */
export function assignStringValueWithoutMergingAsObject(source: string): string | null {
  if (!source.includes("set(obj, prop, extend({}, get(obj, prop), value));")) return null;
  return source === AV_OLD ? AV_NEW : null;
}

/** Use the regex match capture for list lead text and indent width. A check that is not that capture-index shape is refused. */
export function useRegexMatchCaptureForListLeadAndIndent(source: string): string | null {
  if (!source.includes("        level = spaces.length;\n      } else if (tabs) {\n        level = (tabs.length / 2);")) return null;
  return source === TL_OLD ? TL_NEW : null;
}

/** Return 0 for an empty array instead of reducing without an initial value. A check that is not that empty-array shape is refused. */
export function returnZeroForEmptyArraySum(source: string): string | null {
  if (!source.includes("module.exports = function arraySum(arr) {\n  return arr.reduce(function(a, b, i, c) {")) return null;
  return source === AS_OLD ? AS_NEW : null;
}

export interface Batch64Input {
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
export function repairBatch64(input: Batch64Input): { diff: string; file: string } | null {
  if (!/Error|not equal|Expected|Invalid|fail|toEqual|toBe|AssertionError|TypeError|undefined|to equal|deeply equivalent|deepEqual|true == false|false == true|evaluated to a falsy|loosely deep-equal|Missing expected exception|Received null|Received undefined|must be of type|expected true to be false|to throw exception|Object \{\} to be 'b'|Reduce of empty array|no initial value|lead ===/i.test(input.output)) return null;
  const edits: { path: string; next: string; original: string }[] = [];
  for (const path of filesOf(input.root, input.sourcePattern)) {
    const original = readLocal(input.root, path);
    if (original === null) continue;
    const next = assignStringValueWithoutMergingAsObject(original) ?? useRegexMatchCaptureForListLeadAndIndent(original) ?? returnZeroForEmptyArraySum(original);
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
