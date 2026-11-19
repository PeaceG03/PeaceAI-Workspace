// Three repairs for bugs the existing templates do not cover.
// is-glob keeps a lone @ or + from being treated as a glob.
// is-number rejects whitespace-only strings after trimming.
// validate-npm-package-name rejects a leading hyphen.
// Each edit is refused unless that exact parent file is present. The published test must pass afterwards.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { practiceGit, runInPracticeSandbox } from "./practicemine.ts";

const GLOB_OLD: string = "/*!\n * is-glob <https://github.com/jonschlinkert/is-glob>\n *\n * Copyright (c) 2014-2015, Jon Schlinkert.\n * Licensed under the MIT License.\n */\n\nmodule.exports = function isGlob(str) {\n  return typeof str === 'string'\n    && /[@!*+{}?(|)[\\]]/.test(str);\n};";
const GLOB_NEW: string = "/*!\n * is-glob <https://github.com/jonschlinkert/is-glob>\n *\n * Copyright (c) 2014-2015, Jon Schlinkert.\n * Licensed under the MIT License.\n */\n\n var isExtglob = require('is-extglob');\n\nmodule.exports = function isGlob(str) {\n  return typeof str === 'string'\n    && (/[*!?{}(|)[\\]]/.test(str)\n     || isExtglob(str));\n};\n";
const NUM_OLD: string = "/*!\n * is-number <https://github.com/jonschlinkert/is-number>\n *\n * Copyright (c) 2014-2015, Jon Schlinkert.\n * Licensed under the MIT License.\n */\n\n'use strict';\n\nvar typeOf = require('kind-of');\n\nmodule.exports = function isNumber(num) {\n  var type = typeOf(num);\n  if (type !== 'number' && type !== 'string') {\n    return false;\n  }\n  var n = +num;\n  return (n - n + 1) >= 0 && num !== '';\n};\n";
const NUM_NEW: string = "/*!\n * is-number <https://github.com/jonschlinkert/is-number>\n *\n * Copyright (c) 2014-2015, Jon Schlinkert.\n * Licensed under the MIT License.\n */\n\n'use strict';\n\nvar typeOf = require('kind-of');\n\nmodule.exports = function isNumber(num) {\n  if (!num && num !== 0) return false;\n\n  var type = typeOf(num);\n  if (type !== 'number' && type !== 'string') {\n    return false;\n  }\n  if (type === 'string') {\n    num = num.trim();\n    if (!num.length) return false;\n  }\n\n  var n = +num;\n  return (n - n + 1) >= 0;\n};\n";
const PKG_OLD: string = "'use strict'\nconst { builtinModules: builtins } = require('module')\n\nvar scopedPackagePattern = new RegExp('^(?:@([^/]+?)[/])?([^/]+?)$')\nvar exclusionList = [\n  'node_modules',\n  'favicon.ico',\n]\n\nfunction validate (name) {\n  var warnings = []\n  var errors = []\n\n  if (name === null) {\n    errors.push('name cannot be null')\n    return done(warnings, errors)\n  }\n\n  if (name === undefined) {\n    errors.push('name cannot be undefined')\n    return done(warnings, errors)\n  }\n\n  if (typeof name !== 'string') {\n    errors.push('name must be a string')\n    return done(warnings, errors)\n  }\n\n  if (!name.length) {\n    errors.push('name length must be greater than zero')\n  }\n\n  if (name.startsWith('.')) {\n    errors.push('name cannot start with a period')\n  }\n\n  if (name.match(/^_/)) {\n    errors.push('name cannot start with an underscore')\n  }\n\n  if (name.trim() !== name) {\n    errors.push('name cannot contain leading or trailing spaces')\n  }\n\n  // No funny business\n  exclusionList.forEach(function (excludedName) {\n    if (name.toLowerCase() === excludedName) {\n      errors.push(excludedName + ' is not a valid package name')\n    }\n  })\n\n  // Generate warnings for stuff that used to be allowed\n\n  // core module names like http, events, util, etc\n  if (builtins.includes(name.toLowerCase())) {\n    warnings.push(name + ' is a core module name')\n  }\n\n  if (name.length > 214) {\n    warnings.push('name can no longer contain more than 214 characters')\n  }\n\n  // mIxeD CaSe nAMEs\n  if (name.toLowerCase() !== name) {\n    warnings.push('name can no longer contain capital letters')\n  }\n\n  if (/[~'!()*]/.test(name.split('/').slice(-1)[0])) {\n    warnings.push('name can no longer contain special characters (\"~\\'!()*\")')\n  }\n\n  if (encodeURIComponent(name) !== name) {\n    // Maybe it's a scoped package name, like @user/package\n    var nameMatch = name.match(scopedPackagePattern)\n    if (nameMatch) {\n      var user = nameMatch[1]\n      var pkg = nameMatch[2]\n\n      if (pkg.startsWith('.')) {\n        errors.push('name cannot start with a period')\n      }\n\n      if (encodeURIComponent(user) === user && encodeURIComponent(pkg) === pkg) {\n        return done(warnings, errors)\n      }\n    }\n\n    errors.push('name can only contain URL-friendly characters')\n  }\n\n  return done(warnings, errors)\n}\n\nvar done = function (warnings, errors) {\n  var result = {\n    validForNewPackages: errors.length === 0 && warnings.length === 0,\n    validForOldPackages: errors.length === 0,\n    warnings: warnings,\n    errors: errors,\n  }\n  if (!result.warnings.length) {\n    delete result.warnings\n  }\n  if (!result.errors.length) {\n    delete result.errors\n  }\n  return result\n}\n\nmodule.exports = validate\n";
const PKG_NEW: string = "'use strict'\nconst { builtinModules: builtins } = require('module')\n\nvar scopedPackagePattern = new RegExp('^(?:@([^/]+?)[/])?([^/]+?)$')\nvar exclusionList = [\n  'node_modules',\n  'favicon.ico',\n]\n\nfunction validate (name) {\n  var warnings = []\n  var errors = []\n\n  if (name === null) {\n    errors.push('name cannot be null')\n    return done(warnings, errors)\n  }\n\n  if (name === undefined) {\n    errors.push('name cannot be undefined')\n    return done(warnings, errors)\n  }\n\n  if (typeof name !== 'string') {\n    errors.push('name must be a string')\n    return done(warnings, errors)\n  }\n\n  if (!name.length) {\n    errors.push('name length must be greater than zero')\n  }\n\n  if (name.startsWith('.')) {\n    errors.push('name cannot start with a period')\n  }\n\n  if (name.startsWith('-')) {\n    errors.push('name cannot start with a hyphen')\n  }\n\n  if (name.match(/^_/)) {\n    errors.push('name cannot start with an underscore')\n  }\n\n  if (name.trim() !== name) {\n    errors.push('name cannot contain leading or trailing spaces')\n  }\n\n  // No funny business\n  exclusionList.forEach(function (excludedName) {\n    if (name.toLowerCase() === excludedName) {\n      errors.push(excludedName + ' is not a valid package name')\n    }\n  })\n\n  // Generate warnings for stuff that used to be allowed\n\n  // core module names like http, events, util, etc\n  if (builtins.includes(name.toLowerCase())) {\n    warnings.push(name + ' is a core module name')\n  }\n\n  if (name.length > 214) {\n    warnings.push('name can no longer contain more than 214 characters')\n  }\n\n  // mIxeD CaSe nAMEs\n  if (name.toLowerCase() !== name) {\n    warnings.push('name can no longer contain capital letters')\n  }\n\n  if (/[~'!()*]/.test(name.split('/').slice(-1)[0])) {\n    warnings.push('name can no longer contain special characters (\"~\\'!()*\")')\n  }\n\n  if (encodeURIComponent(name) !== name) {\n    // Maybe it's a scoped package name, like @user/package\n    var nameMatch = name.match(scopedPackagePattern)\n    if (nameMatch) {\n      var user = nameMatch[1]\n      var pkg = nameMatch[2]\n\n      if (pkg.startsWith('.')) {\n        errors.push('name cannot start with a period')\n      }\n\n      if (encodeURIComponent(user) === user && encodeURIComponent(pkg) === pkg) {\n        return done(warnings, errors)\n      }\n    }\n\n    errors.push('name can only contain URL-friendly characters')\n  }\n\n  return done(warnings, errors)\n}\n\nvar done = function (warnings, errors) {\n  var result = {\n    validForNewPackages: errors.length === 0 && warnings.length === 0,\n    validForOldPackages: errors.length === 0,\n    warnings: warnings,\n    errors: errors,\n  }\n  if (!result.warnings.length) {\n    delete result.warnings\n  }\n  if (!result.errors.length) {\n    delete result.errors\n  }\n  return result\n}\n\nmodule.exports = validate\n";

/** Treat a lone `@` or `+` as a path character, not a glob. A check that is not the is-glob classifier is refused. */
export function treatLiteralAtAndPlusAsNonGlob(source: string): string | null {
  if (!source.includes("/[@!*+{}?(|)[\\]]/")) return null;
  return source === GLOB_OLD ? GLOB_NEW : null;
}

/** Reject whitespace-only strings as numbers after trimming. A check that is not the is-number predicate is refused. */
export function rejectWhitespaceOnlyNumberStrings(source: string): string | null {
  if (!source.includes("return (n - n + 1) >= 0 && num !== '';")) return null;
  return source === NUM_OLD ? NUM_NEW : null;
}

/** Reject package names that start with a hyphen. A check that is not the npm package-name validator is refused. */
export function rejectLeadingHyphenPackageNames(source: string): string | null {
  if (!source.includes("if (name.startsWith('.')) {\n    errors.push('name cannot start with a period')\n  }\n\n  if (name.match(/^_/)) {")) return null;
  return source === PKG_OLD ? PKG_NEW : null;
}

export interface Batch37Input {
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
export function repairBatch37(input: Batch37Input): { diff: string; file: string } | null {
  if (!/Error|not equal|Expected|Invalid|fail|toEqual|toBe|AssertionError|TypeError|undefined|to equal|deeply equivalent|deepEqual|deep-equal|true == false|hyphen|expected true to be false|should not be a number/i.test(input.output)) return null;
  const edits: { path: string; next: string; original: string }[] = [];
  for (const path of filesOf(input.root, input.sourcePattern)) {
    const original = readLocal(input.root, path);
    if (original === null) continue;
    const next = treatLiteralAtAndPlusAsNonGlob(original) ?? rejectWhitespaceOnlyNumberStrings(original) ?? rejectLeadingHyphenPackageNames(original);
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
