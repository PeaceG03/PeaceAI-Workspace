// Three repairs for bugs the existing templates do not cover.
// parse-filepath preserves the basename when dirname is ".".
// is-self-closing lower-cases the tag name before looking it up in the self-closing list.
// exponential-moving-average rounds the default range so odd-length arrays do not produce a fractional window.
// Each edit is refused unless that exact parent file is present. The published test must pass afterwards.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { practiceGit, runInPracticeSandbox } from "./practicemine.ts";

const PATH_OLD: string = "'use strict';\n\nvar path = require('path');\n\nfunction addDot(str) {\n  return '.' + str;\n}\n\nfunction compact(arr) {\n  return arr.filter(Boolean);\n}\n\nfunction strip(str) {\n  return str.replace(/^\\/|\\/$/g, '');\n}\n\nfunction isDotfile(str) {\n  return /^\\./.test(str.split('/').reverse()[0]);\n}\n\nmodule.exports = function(filepath) {\n  filepath = filepath.replace(/\\\\/g, '/');\n  var dirname = path.dirname(filepath);\n\n  var basename = filepath.replace(dirname, '');\n  var name = basename.split('.')[0];\n  var extname = basename.replace(name, '');\n\n  if (isDotfile(filepath)) {\n    basename = extname;\n    name = basename;\n    extname = '';\n  }\n\n  // create an array of extensions. useful if more than one extension exists\n  var segments = compact(extname.split('.')).map(addDot);\n\n  return {\n    basename: strip(basename),\n    dirname: dirname,\n    extname: extname,\n    name: strip(name),\n    extSegments: segments\n  };\n};";
const PATH_NEW: string = "'use strict';\n\nvar path = require('path');\n\nfunction strip(str) {\n  return str.replace(/^\\/|\\/$/g, '');\n}\n\nfunction isDotfile(str) {\n  return /^\\./.test(str.split('/').reverse()[0]);\n}\n\nmodule.exports = function(filepath) {\n  filepath = filepath.replace(/\\\\/g, '/');\n  var dirname = path.dirname(filepath);\n\n  var basename = path.basename(filepath);\n  if (dirname !== '.') {\n    basename = filepath.replace(dirname, '');\n  }\n\n  var name = basename.split('.')[0];\n  var extname = basename.replace(name, '');\n\n  if (isDotfile(filepath)) {\n    basename = extname;\n    name = basename;\n    extname = '';\n  }\n\n  // create an array of extensions. useful if more than one extension exists\n  var segments = extname.split('.').filter(Boolean);\n\n  var parts = {\n    dirname    : dirname,\n    basename   : strip(basename),\n    name       : strip(name),\n    extname    : extname,\n    extSegments: segments.map(function(str) {\n      return '.' + str;\n    })\n  };\n  return parts;\n};";
const TAG_OLD: string = "'use strict';\n\nvar selfClosing = require('self-closing-tags');\n\nmodule.exports = function(name) {\n  if (typeof name !== 'string') {\n    throw new TypeError('expected name to be a string');\n  }\n  return selfClosing.indexOf(name) !== -1;\n};\n";
const TAG_NEW: string = "'use strict';\n\nvar tags = require('self-closing-tags');\n\nmodule.exports = function(name) {\n  if (typeof name !== 'string') {\n    throw new TypeError('expected name to be a string');\n  }\n  return tags.indexOf(name.toLowerCase()) !== -1;\n};\n";
const EMA_OLD: string = "'use strict';\n\nvar extend = require('extend-shallow');\n\nmodule.exports = function(arr, options) {\n  if (!Array.isArray(arr)) {\n    throw new TypeError('expected an array');\n  }\n\n  if (typeof options === 'number') {\n    options = { range: options };\n  }\n\n  var defaults = {range: arr.length / 2, format: toFixed};\n  var opts = extend({}, defaults, options);\n  var range = opts.range;\n\n  if (arr.length < range) {\n    throw new RangeError('expected range to be greater than array length');\n  }\n\n  var c = smooth(range);\n  var num = avg(arr.slice(0, range), opts);\n  var acc = [opts.format(num)];\n  for (var i = range; i < arr.length; i++) {\n    num = (c * Number(arr[i])) + ((1 - c) * num);\n    acc.push(opts.format(num));\n  }\n  return acc;\n};\n\nfunction avg(arr, options) {\n  var len = arr.length, i = -1;\n  var num = 0;\n  while (++i < len) num += Number(arr[i]);\n  return num / len;\n}\n\nfunction smooth(n) {\n  return 2 / (n + 1);\n}\n\nfunction toFixed(n) {\n  return n.toFixed(2);\n}\n";
const EMA_NEW: string = "'use strict';\n\nvar extend = require('extend-shallow');\n\nmodule.exports = function(arr, options) {\n  if (!Array.isArray(arr)) {\n    throw new TypeError('expected an array');\n  }\n\n  if (typeof options === 'number') {\n    options = { range: options };\n  }\n\n  var defaults = {range: Math.round(arr.length / 2), format: toFixed};\n  var opts = extend({}, defaults, options);\n  var range = opts.range;\n\n  if (arr.length < range) {\n    throw new RangeError('expected range to be greater than array length');\n  }\n\n  var c = smooth(range);\n  var num = avg(arr.slice(0, range), opts);\n  var acc = [opts.format(num)];\n  for (var i = range; i < arr.length; i++) {\n    num = (c * Number(arr[i])) + ((1 - c) * num);\n    acc.push(opts.format(num));\n  }\n  return acc;\n};\n\nfunction avg(arr, options) {\n  var len = arr.length, i = -1;\n  var num = 0;\n  while (++i < len) num += Number(arr[i]);\n  return num / len;\n}\n\nfunction smooth(n) {\n  return 2 / (n + 1);\n}\n\nfunction toFixed(n) {\n  return n.toFixed(2);\n}\n";

/** Preserve the basename when parse-filepath's dirname is ".". A check that is not that dirname guard is refused. */
export function preserveBasenameWhenParseFilepathDirnameIsDot(source: string): string | null {
  if (!source.includes("  var dirname = path.dirname(filepath);\n\n  var basename = filepath.replace(dirname, '');")) return null;
  return source === PATH_OLD ? PATH_NEW : null;
}

/** Lower-case the tag name before looking it up in the self-closing list. A check that is not that toLowerCase lookup is refused. */
export function lowerCaseTagNameWhenCheckingIsSelfClosing(source: string): string | null {
  if (!source.includes("  return selfClosing.indexOf(name) !== -1;")) return null;
  return source === TAG_OLD ? TAG_NEW : null;
}

/** Round the default moving-average range so odd-length arrays do not produce a fractional window. A check that is not that rounded range is refused. */
export function roundDefaultMovingAverageRangeForOddLengthArrays(source: string): string | null {
  if (!source.includes("  var defaults = {range: arr.length / 2, format: toFixed};")) return null;
  return source === EMA_OLD ? EMA_NEW : null;
}

export interface Batch46Input {
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
export function repairBatch46(input: Batch46Input): { diff: string; file: string } | null {
  if (!/Error|not equal|Expected|Invalid|fail|toEqual|toBe|AssertionError|TypeError|undefined|to equal|deeply equivalent|deepEqual|true == false|false == true|evaluated to a falsy|"basename": "indexjs"|isSelfClosing\('IMG'\)|'NaN'/i.test(input.output)) return null;
  const edits: { path: string; next: string; original: string }[] = [];
  for (const path of filesOf(input.root, input.sourcePattern)) {
    const original = readLocal(input.root, path);
    if (original === null) continue;
    const next = preserveBasenameWhenParseFilepathDirnameIsDot(original) ?? lowerCaseTagNameWhenCheckingIsSelfClosing(original) ?? roundDefaultMovingAverageRangeForOddLengthArrays(original);
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
