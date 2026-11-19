// Three repairs for bugs the existing templates do not cover.
// longest-value accepts an object as well as an array.
// write-json forwards extra JSON.stringify arguments instead of always using a two-space indent.
// project-name falls back to process.cwd() when no directory is passed.
// Each edit is refused unless that exact parent file is present. The published test must pass afterwards.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { practiceGit, runInPracticeSandbox } from "./practicemine.ts";

const LV_OLD: string = "/*!\n * longest-value <https://github.com/jonschlinkert/longest-value>\n *\n * Copyright (c) 2015, Jon Schlinkert.\n * Licensed under the MIT License.\n */\n\n'use strict';\n\nvar longest = require('longest');\n\nmodule.exports = function longestValue(arr, prop) {\n  if (!Array.isArray(arr)) {\n    throw new TypeError('longest-value expects an array.');\n  }\n\n  var value = [];\n  var len = arr.length;\n  while (len--) {\n    var obj = arr[len];\n    if (obj.hasOwnProperty(prop)) {\n      value.push(arr[len][prop]);\n    } else {\n      throw new Error('longest-value cannot find ' + prop + ' in array objects.');\n    }\n  }\n  return longest(value);\n};\n";
const LV_NEW: string = "/*!\n * longest-value <https://github.com/jonschlinkert/longest-value>\n *\n * Copyright (c) 2015, Jon Schlinkert.\n * Licensed under the MIT License.\n */\n\n'use strict';\n\nvar longest = require('longest');\n\nmodule.exports = function longestValue(obj, prop) {\n  if (typeof obj !== 'object') {\n    throw new TypeError('longest-value expects an object or array.');\n  }\n  if (Array.isArray(obj)) {\n    return longest(arrayValues(obj, prop));\n  }\n  return longest(objectValues(obj));\n};\n\nfunction objectValues(obj) {\n  var values = [];\n  for (var key in obj) {\n    if (obj.hasOwnProperty(key)) {\n      values.push(obj[key]);\n    }\n  }\n  return values;\n}\n\nfunction arrayValues(arr, prop) {\n  var values = [];\n  var len = arr.length;\n  while (len--) {\n    var obj = arr[len];\n    if (obj.hasOwnProperty(prop)) {\n      values.push(arr[len][prop]);\n    } else {\n      throw new Error('longest-value cannot find ' + prop + ' in array objects.');\n    }\n  }\n  return values;\n}\n";
const WJ_OLD: string = "/*!\n * write-json <https://github.com/jonschlinkert/write-json>\n *\n * Copyright (c) 2014-2015, 2017, Jon Schlinkert.\n * Released under the MIT License.\n */\n\n'use strict';\n\nvar writeFile = require('write');\n\n/**\n * Expose `writeJson`\n */\n\nmodule.exports = function writeJson(dest, obj, cb) {\n  writeFile(dest, JSON.stringify(obj, null, 2), cb);\n};\n\n/**\n * Expose `writeJson.sync`\n */\n\nmodule.exports.sync = function writeJsonSync(dest, obj) {\n  try {\n    writeFile.sync(dest, JSON.stringify(obj, null, 2));\n  } catch (err) {\n    throw err;\n  }\n};\n";
const WJ_NEW: string = "/*!\n * write-json <https://github.com/jonschlinkert/write-json>\n *\n * Copyright (c) 2014-2015, 2017, Jon Schlinkert.\n * Released under the MIT License.\n */\n\n'use strict';\n\nvar writeFile = require('write');\n\n/**\n * Expose `writeJson`\n */\n\nmodule.exports = function writeJson(dest, data, cb) {\n  var args = [].slice.call(arguments, 1);\n  cb = args.pop();\n  if (args.length === 1) args.push(null, 2);\n  writeFile(dest, JSON.stringify.apply(JSON, args), cb);\n};\n\n/**\n * Expose `writeJson.sync`\n */\n\nmodule.exports.sync = function writeJsonSync(dest, data) {\n  try {\n    var args = [].slice.call(arguments, 1);\n    if (args.length === 1) args.push(null, 2);\n    writeFile.sync(dest, JSON.stringify.apply(JSON, args));\n  } catch (err) {\n    throw err;\n  }\n};\n";
const PN_OLD: string = "'use strict';\n\nconst fs = require('fs');\nconst path = require('path');\nconst repo = require('git-repo-name');\n\nmodule.exports = cwd => {\n  return pkgname(cwd) || gitname(cwd) || path.basename(cwd);\n};\n\nfunction pkgname(cwd = '') {\n  let pkgPath = path.resolve(process.cwd(), cwd);\n\n  if (!pkgPath.endsWith('package.json')) {\n    pkgPath = path.join(pkgPath, 'package.json');\n  }\n\n  if (fs.existsSync(pkgPath)) {\n    let pkg = JSON.parse(fs.readFileSync(pkgPath));\n    return pkg.name;\n  }\n}\n\nfunction gitname(cwd = '.') {\n  try {\n    return repo.sync({ cwd: path.resolve(cwd) });\n  } catch (err) {}\n}\n";
const PN_NEW: string = "'use strict';\n\nconst fs = require('fs');\nconst path = require('path');\nconst repo = require('git-repo-name');\n\nmodule.exports = cwd => {\n  return pkgname(cwd) || gitname(cwd) || path.basename(cwd || process.cwd());\n};\n\nfunction pkgname(cwd = '') {\n  let pkgPath = path.resolve(process.cwd(), cwd);\n\n  if (!pkgPath.endsWith('package.json')) {\n    pkgPath = path.join(pkgPath, 'package.json');\n  }\n\n  if (fs.existsSync(pkgPath)) {\n    let pkg = JSON.parse(fs.readFileSync(pkgPath));\n    return pkg.name;\n  }\n}\n\nfunction gitname(cwd = '.') {\n  try {\n    return repo.sync({ cwd: path.resolve(cwd) });\n  } catch (err) {}\n}\n";

/** Accept an object as well as an array when finding the longest value. A check that is not that object-or-array branch is refused. */
export function acceptObjectOrArrayInLongestValue(source: string): string | null {
  if (!source.includes("  if (!Array.isArray(arr)) {\n    throw new TypeError('longest-value expects an array.');\n  }")) return null;
  return source === LV_OLD ? LV_NEW : null;
}

/** Forward extra JSON.stringify arguments instead of always using null and 2. A check that is not that argument forwarding is refused. */
export function forwardJsonStringifyArgsInWriteJson(source: string): string | null {
  if (!source.includes("module.exports = function writeJson(dest, obj, cb) {\n  writeFile(dest, JSON.stringify(obj, null, 2), cb);\n};")) return null;
  return source === WJ_OLD ? WJ_NEW : null;
}

/** Fall back to process.cwd() when no directory is passed to project-name. A check that is not that cwd fallback is refused. */
export function fallBackToProcessCwdInProjectName(source: string): string | null {
  if (!source.includes("  return pkgname(cwd) || gitname(cwd) || path.basename(cwd);\n")) return null;
  return source === PN_OLD ? PN_NEW : null;
}

export interface Batch51Input {
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
export function repairBatch51(input: Batch51Input): { diff: string; file: string } | null {
  if (!/Error|not equal|Expected|Invalid|fail|toEqual|toBe|AssertionError|TypeError|undefined|to equal|deeply equivalent|deepEqual|true == false|false == true|evaluated to a falsy|loosely deep-equal|Missing expected exception|Received null|Received undefined|must be of type/i.test(input.output)) return null;
  const edits: { path: string; next: string; original: string }[] = [];
  for (const path of filesOf(input.root, input.sourcePattern)) {
    const original = readLocal(input.root, path);
    if (original === null) continue;
    const next = acceptObjectOrArrayInLongestValue(original) ?? forwardJsonStringifyArgsInWriteJson(original) ?? fallBackToProcessCwdInProjectName(original);
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
