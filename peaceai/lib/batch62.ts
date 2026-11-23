// Three repairs for bugs the existing templates do not cover.
// is-git-url anchors the optional trailing slash before end-of-string in its git-url regex.
// group-array accepts object values as group keys and requires kind-of.
// time-stamp exports a .utc helper that formats with UTC getters.
// Each edit is refused unless that exact parent file is present. The published test must pass afterwards.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { practiceGit, runInPracticeSandbox } from "./practicemine.ts";

const IG_OLD: string = "/*!\n * is-git-url <https://github.com/jonschlinkert/is-git-url>\n *\n * Copyright (c) 2014-2015, Jon Schlinkert.\n * Licensed under the MIT License.\n */\n\nmodule.exports = function isGitUrl(str) {\n  var re = /(?:git|ssh|https?|git@[\\w\\.]+):(?:\\/\\/)?[\\w\\.@:\\/~_-]+\\.git$\\/?/;\n  return re.test(str);\n};\n";
const IG_NEW: string = "/*!\n * is-git-url <https://github.com/jonschlinkert/is-git-url>\n *\n * Copyright (c) 2014-2015, Jon Schlinkert.\n * Licensed under the MIT License.\n */\n\nmodule.exports = function isGitUrl(str) {\n  var re = /(?:git|ssh|https?|git@[\\w\\.]+):(?:\\/\\/)?[\\w\\.@:\\/~_-]+\\.git\\/?$/;\n  return re.test(str);\n};\n";
const GA_OLD: string = "/*!\n * group-array <https://github.com/doowb/group-array>\n *\n * Copyright (c) 2015, Brian Woodward.\n * Licensed under the MIT License.\n */\n\n'use strict';\n\nvar get = require('get-value');\n\nfunction groupArray(arr, props) {\n  if (arr == null) {\n    return [];\n  }\n\n  if (!Array.isArray(arr)) {\n    throw new TypeError('group-array expects an array.');\n  }\n\n  if (arguments.length === 1) {\n    return arr;\n  }\n\n  props = flatten([].slice.call(arguments, 1));\n  var groups = groupBy(arr, props.shift());\n\n  while (props.length) {\n    subGroup(groups, props.shift());\n  }\n  return groups;\n}\n\nfunction groupBy(arr, prop) {\n  var len = arr.length, i = -1;\n  var groups = {};\n\n  while (++i < len) {\n    var obj = arr[i];\n    var key;\n\n    if (typeof prop === 'function') {\n      key = prop(obj);\n    } else {\n      key = get(obj, prop);\n      if (typeof key !== 'string') {\n        throw new TypeError('group-array expects group keys to be strings: ' + JSON.stringify(key));\n      }\n    }\n\n    groups[key] = groups[key] || [];\n    groups[key].push(obj);\n  }\n  return groups;\n}\n\nfunction subGroup(groups, prop) {\n  for (var key in groups) {\n    if (groups.hasOwnProperty(key)) {\n      var val = groups[key];\n      if (!Array.isArray(val)) {\n        groups[key] = subGroup(val, prop);\n      } else {\n        groups[key] = groupArray(val, prop);\n      }\n    }\n  }\n  return groups;\n}\n\n/**\n * Flatten the given array.\n */\n\nfunction flatten(arr) {\n  return [].concat.apply([], arr);\n}\n\n/**\n * Expose `groupArray`\n */\n\nmodule.exports = groupArray;\n";
const GA_NEW: string = "/*!\n * group-array <https://github.com/doowb/group-array>\n *\n * Copyright (c) 2015, Brian Woodward.\n * Licensed under the MIT License.\n */\n\n'use strict';\n\nvar typeOf = require('kind-of');\nvar get = require('get-value');\n\nfunction groupArray(arr, props) {\n  if (arr == null) {\n    return [];\n  }\n\n  if (!Array.isArray(arr)) {\n    throw new TypeError('group-array expects an array.');\n  }\n\n  if (arguments.length === 1) {\n    return arr;\n  }\n\n  props = flatten([].slice.call(arguments, 1));\n  var groups = groupBy(arr, props.shift());\n\n  while (props.length) {\n    subGroup(groups, props.shift());\n  }\n  return groups;\n}\n\nfunction groupBy(arr, prop) {\n  var len = arr.length, i = -1;\n  var groups = {};\n\n  while (++i < len) {\n    var obj = arr[i];\n    var key;\n\n    if (typeof prop === 'function') {\n      key = prop(obj);\n    } else {\n      key = get(obj, prop);\n      if (typeof key == 'string') {\n        groups[key] = groups[key] || [];\n        groups[key].push(obj);\n      } else if (typeOf(key) === 'object') {\n        var value = key;\n        for (var k in value) {\n          if (value.hasOwnProperty(k)) {\n            groups[k] = groups[k] || [];\n            groups[k].push(obj);\n          }\n        }\n      } else {\n        throw new TypeError('group-array expects group keys to be strings or objects: ' + JSON.stringify(key));\n      }\n    }\n  }\n  return groups;\n}\n\nfunction subGroup(groups, prop) {\n  for (var key in groups) {\n    if (groups.hasOwnProperty(key)) {\n      var val = groups[key];\n      if (!Array.isArray(val)) {\n        groups[key] = subGroup(val, prop);\n      } else {\n        groups[key] = groupArray(val, prop);\n      }\n    }\n  }\n  return groups;\n}\n\n/**\n * Flatten the given array.\n */\n\nfunction flatten(arr) {\n  return [].concat.apply([], arr);\n}\n\n/**\n * Expose `groupArray`\n */\n\nmodule.exports = groupArray;\n";
const TS_OLD: string = "/*!\n * time-stamp <https://github.com/jonschlinkert/time-stamp>\n *\n * Copyright (c) 2015-2018, Jon Schlinkert.\n * Released under the MIT License.\n */\n\n'use strict';\n\n/**\n * Parse the given pattern and return a formatted\n * timestamp.\n *\n * @param  {String} `pattern` Date pattern.\n * @param  {Date} `date` Date object.\n * @return {String}\n */\n\nmodule.exports = function(pattern, date) {\n  if (typeof pattern !== 'string') {\n    date = pattern;\n    pattern = 'YYYY-MM-DD';\n  }\n\n  if (!date) date = new Date();\n\n  function timestamp() {\n    var regex = /(?=(YYYY|YY|MM|DD|HH|mm|ss|ms))\\1([:\\/]*)/;\n    var match = regex.exec(pattern);\n\n    if (match) {\n      var increment = method(match[1]);\n      var val = '00' + String(date[increment[0]]() + (increment[2] || 0));\n      var res = val.slice(-increment[1]) + (match[2] || '');\n      pattern = pattern.replace(match[0], res);\n      timestamp();\n    }\n  }\n\n  timestamp(pattern);\n  return pattern;\n};\n\nfunction method(key) {\n  return ({\n    YYYY: ['getFullYear', 4],\n    YY: ['getFullYear', 2],\n    // getMonth is zero-based, thus the extra increment field\n    MM: ['getMonth', 2, 1],\n    DD: ['getDate', 2],\n    HH: ['getHours', 2],\n    mm: ['getMinutes', 2],\n    ss: ['getSeconds', 2],\n    ms: ['getMilliseconds', 3]\n  })[key];\n}\n";
const TS_NEW: string = "/*!\n * time-stamp <https://github.com/jonschlinkert/time-stamp>\n *\n * Copyright (c) 2015-2018, Jon Schlinkert.\n * Released under the MIT License.\n */\n\n'use strict';\n\n/**\n * Parse the given pattern and return a formatted\n * timestamp.\n *\n * @param  {String} `pattern` Date pattern.\n * @param  {Date} `date` Date object.\n * @param  {Bool} `useUTC` Whether or not to use UTC (local timezone is used otherwise)\n * @return {String}\n */\n\nfunction _getTimestamp(pattern, date, useUTC) {\n  if (typeof pattern !== 'string') {\n    date = pattern;\n    pattern = 'YYYY-MM-DD';\n  }\n\n  if (!date) date = new Date();\n\n  function timestamp() {\n    var regex = /(?=(YYYY|YY|MM|DD|HH|mm|ss|ms))\\1([:\\/]*)/;\n    var match = regex.exec(pattern);\n\n    if (match) {\n      var increment = method(match[1], useUTC);\n      var val = '00' + String(date[increment[0]]() + (increment[2] || 0));\n      var res = val.slice(-increment[1]) + (match[2] || '');\n      pattern = pattern.replace(match[0], res);\n      timestamp();\n    }\n  }\n\n  timestamp(pattern);\n  return pattern;\n};\n\nfunction method(key, useUTC) {\n  return ({\n    YYYY: [useUTC ? 'getUTCFullYear' : 'getFullYear', 4],\n    YY: [useUTC ? 'getUTCFullYear' : 'getFullYear', 2],\n    // getMonth is zero-based, thus the extra increment field\n    MM: [useUTC ? 'getUTCMonth' : 'getMonth', 2, 1],\n    DD: [useUTC ? 'getUTCDate' : 'getDate', 2],\n    HH: [useUTC ? 'getUTCHours' : 'getHours', 2],\n    mm: [useUTC ? 'getUTCMinutes' : 'getMinutes', 2],\n    ss: [useUTC ? 'getUTCSeconds' : 'getSeconds', 2],\n    ms: [useUTC ? 'getUTCMilliseconds' : 'getMilliseconds', 3]\n  })[key];\n}\n\nmodule.exports = function(pattern, date) {\n  return _getTimestamp(pattern, date, false);\n};\n\nmodule.exports.utc = function(pattern, date) {\n  return _getTimestamp(pattern, date, true);\n};\n";

/** Anchor the git-url regex so an optional trailing slash stays before end-of-string. A check that is not that regex-boundary shape is refused. */
export function anchorOptionalSlashBeforeEndInIsGitUrl(source: string): string | null {
  if (!source.includes("var re = /(?:git|ssh|https?|git@[\\w\\.]+):(?:\\/\\/)?[\\w\\.@:\\/~_-]+\\.git$\\/?/;")) return null;
  return source === IG_OLD ? IG_NEW : null;
}

/** Accept object group-key values and require kind-of. A check that is not that object-key shape is refused. */
export function acceptObjectGroupKeysInGroupArray(source: string): string | null {
  if (!source.includes("throw new TypeError('group-array expects group keys to be strings: ' + JSON.stringify(key));")) return null;
  return source === GA_OLD ? GA_NEW : null;
}

/** Export a .utc helper that formats with UTC getters. A check that is not that utc-export shape is refused. */
export function exportUtcHelperInTimeStamp(source: string): string | null {
  if (!source.includes("module.exports = function(pattern, date) {\n  if (typeof pattern !== 'string') {\n")) return null;
  return source === TS_OLD ? TS_NEW : null;
}

export interface Batch62Input {
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
export function repairBatch62(input: Batch62Input): { diff: string; file: string } | null {
  if (!/Error|not equal|Expected|Invalid|fail|toEqual|toBe|AssertionError|TypeError|undefined|to equal|deeply equivalent|deepEqual|true == false|false == true|evaluated to a falsy|loosely deep-equal|Missing expected exception|Received null|Received undefined|must be of type|expected true to be false|to throw exception|timestampUTC is not a function|group-array expects group keys to be strings|isGitUrl/i.test(input.output)) return null;
  const edits: { path: string; next: string; original: string }[] = [];
  for (const path of filesOf(input.root, input.sourcePattern)) {
    const original = readLocal(input.root, path);
    if (original === null) continue;
    const next = anchorOptionalSlashBeforeEndInIsGitUrl(original) ?? acceptObjectGroupKeysInGroupArray(original) ?? exportUtcHelperInTimeStamp(original);
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
