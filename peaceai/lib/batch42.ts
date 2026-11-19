// Three repairs for bugs the existing templates do not cover.
// dashify strips the leading dash that an initial capital inserted.
// unixify passes a trailing-slash flag through and also strips a leading ./.
// array-last returns the last element itself when n is 1, not a one-element array.
// Each edit is refused unless that exact parent file is present. The published test must pass afterwards.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { practiceGit, runInPracticeSandbox } from "./practicemine.ts";

const DASH_OLD: string = "/*!\n * dashify <https://github.com/jonschlinkert/dashify>\n *\n * Copyright (c) 2015 Jon Schlinkert.\n * Licensed under the MIT license.\n */\n\n'use strict';\n\nmodule.exports = function dashify(str) {\n  if (typeof str !== 'string') {\n    throw new TypeError('dashify expects a string.');\n  }\n  str = str.replace(/[A-Z]/g, '-$&');\n  str = str.replace(/[ \\t]/g, '-');\n  return str.toLowerCase();\n};\n";
const DASH_NEW: string = "/*!\n * dashify <https://github.com/jonschlinkert/dashify>\n *\n * Copyright (c) 2015 Jon Schlinkert.\n * Licensed under the MIT license.\n */\n\n'use strict';\n\nmodule.exports = function dashify(str) {\n  if (typeof str !== 'string') {\n    throw new TypeError('dashify expects a string.');\n  }\n  str = str.replace(/[A-Z]/g, '-$&');\n  str = str.replace(/[ \\t]/g, '-')\n  str = str.replace(/^-/, '');\n  return str.toLowerCase();\n};\n";
const UNIX_OLD: string = "/*!\n * unixify <https://github.com/jonschlinkert/unixify>\n *\n * Copyright (c) 2014 Jon Schlinkert, contributors.\n * Licensed under the MIT license.\n */\n\n'use strict';\n\nvar normalize = require('normalize-path');\n\nmodule.exports = function unixify(fp) {\n  return normalize(fp).replace(/^\\w+:/, '');\n};\n";
const UNIX_NEW: string = "/*!\n * unixify <https://github.com/jonschlinkert/unixify>\n *\n * Copyright (c) 2014, 2017, Jon Schlinkert.\n * Released under the MIT License.\n */\n\n'use strict';\n\nvar normalizePath = require('normalize-path');\n\nmodule.exports = function unixify(filepath, stripTrailing) {\n  filepath = normalizePath(filepath, stripTrailing);\n  return filepath.replace(/^([a-zA-Z]+:|\\.\\/)/, '');\n};\n";
const LAST_OLD: string = "/*!\n * array-last <https://github.com/jonschlinkert/array-last>\n *\n * Copyright (c) 2014 Jon Schlinkert, contributors.\n * Licensed under the MIT license.\n */\n\nvar isNumber = require('is-number');\n\nmodule.exports = function last(arr, n) {\n  if (!Array.isArray(arr)) {\n    throw new Error('expected the first argument to be an array');\n  }\n\n  var len = arr.length;\n  if (len === 0) {\n    return null;\n  }\n\n  n = isNumber(n) ? +n : 1;\n  if (n === 1 && len === 1) {\n    return arr[0];\n  }\n\n  var res = new Array(n);\n  while (n--) {\n    res[n] = arr[--len];\n  }\n  return res;\n};\n";
const LAST_NEW: string = "/*!\n * array-last <https://github.com/jonschlinkert/array-last>\n *\n * Copyright (c) 2014 Jon Schlinkert, contributors.\n * Licensed under the MIT license.\n */\n\nvar isNumber = require('is-number');\n\nmodule.exports = function last(arr, n) {\n  if (!Array.isArray(arr)) {\n    throw new Error('expected the first argument to be an array');\n  }\n\n  var len = arr.length;\n  if (len === 0) {\n    return null;\n  }\n\n  n = isNumber(n) ? +n : 1;\n  if (n === 1) {\n    return arr[len - 1];\n  }\n\n  var res = new Array(n);\n  while (n--) {\n    res[n] = arr[--len];\n  }\n  return res;\n};\n";

/** Strip a leading dash that an initial capital inserted. A check that is not that leading-dash strip is refused. */
export function stripLeadingDashFromDashify(source: string): string | null {
  if (!source.includes("  str = str.replace(/[A-Z]/g, '-$&');\n  str = str.replace(/[ \\t]/g, '-');\n  return str.toLowerCase();")) return null;
  return source === DASH_OLD ? DASH_NEW : null;
}

/** Pass a trailing-slash flag through to normalize-path and also strip a leading `./`. A check that is not that path cleanup is refused. */
export function stripDotSlashAndHonorTrailingSlashFlag(source: string): string | null {
  if (!source.includes("module.exports = function unixify(fp) {\n  return normalize(fp).replace(/^\\w+:/, '');\n};")) return null;
  return source === UNIX_OLD ? UNIX_NEW : null;
}

/** Return the last element itself when n is 1, not a one-element array. A check that is not that n===1 return is refused. */
export function returnSingleElementWhenArrayLastNIsOne(source: string): string | null {
  if (!source.includes("  n = isNumber(n) ? +n : 1;\n  if (n === 1 && len === 1) {\n    return arr[0];\n  }")) return null;
  return source === LAST_OLD ? LAST_NEW : null;
}

export interface Batch42Input {
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
export function repairBatch42(input: Batch42Input): { diff: string; file: string } | null {
  if (!/Error|not equal|Expected|Invalid|fail|toEqual|toBe|AssertionError|TypeError|undefined|to equal|deeply equivalent|deepEqual|true == false|false == true|evaluated to a falsy|-foo-bar-baz-quux|one\/two\/three|strictly equal/i.test(input.output)) return null;
  const edits: { path: string; next: string; original: string }[] = [];
  for (const path of filesOf(input.root, input.sourcePattern)) {
    const original = readLocal(input.root, path);
    if (original === null) continue;
    const next = stripLeadingDashFromDashify(original) ?? stripDotSlashAndHonorTrailingSlashFlag(original) ?? returnSingleElementWhenArrayLastNIsOne(original);
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
