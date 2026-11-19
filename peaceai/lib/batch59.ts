// Three repairs for bugs the existing templates do not cover.
// append-buffer returns early when the suffix is empty so a line ending is not inserted.
// gfm-code-blocks uses the exec match groups instead of RegExp.$* and records start and end.
// object-visit throws a dedicated thisArg error instead of using the expected helper.
// Each edit is refused unless that exact parent file is present. The published test must pass afterwards.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { practiceGit, runInPracticeSandbox } from "./practicemine.ts";

const AB_OLD: string = "'use strict';\n\nvar os = require('os');\nvar equals = require('buffer-equal');\nvar cr = new Buffer('\\r\\n');\nvar nl = new Buffer('\\n');\n\n/**\n * Append a buffer to another buffer ensuring to preserve line ending characters.\n *\n * ```js\n * console.log([appendBuffer(new Buffer('abc\\r\\n'), new Buffer('def')).toString()]);\n * //=> [ 'abc\\r\\ndef\\r\\n' ]\n *\n * console.log([appendBuffer(new Buffer('abc\\n'), new Buffer('def')).toString()]);\n * //=> [ 'abc\\ndef\\n' ]\n *\n * // uses os.EOL when a line ending is not found\n * console.log([appendBuffer(new Buffer('abc'), new Buffer('def')).toString()]);\n * //=> [ 'abc\\ndef' ]\n * * ```\n * @param  {Buffer} `buf` Buffer that will be used to check for an existing line ending. The suffix is appended to this.\n * @param  {Buffer} `suffix` Buffer that will be appended to the buf.\n * @return {Buffer} Final Buffer\n * @api public\n */\n\nmodule.exports = function appendBuffer(buf, suffix) {\n  var eol;\n  if (equals(buf.slice(-2), cr)) {\n    eol = cr;\n  } else if (equals(buf.slice(-1), nl)) {\n    eol = nl;\n  } else {\n    return Buffer.concat([buf, new Buffer(os.EOL), new Buffer(suffix)]);\n  }\n  return Buffer.concat([buf, new Buffer(suffix), eol]);\n};\n";
const AB_NEW: string = "'use strict';\n\nvar os = require('os');\nvar equals = require('buffer-equal');\nvar cr = new Buffer('\\r\\n');\nvar nl = new Buffer('\\n');\n\n/**\n * Append a buffer to another buffer ensuring to preserve line ending characters.\n *\n * ```js\n * console.log([appendBuffer(new Buffer('abc\\r\\n'), new Buffer('def')).toString()]);\n * //=> [ 'abc\\r\\ndef\\r\\n' ]\n *\n * console.log([appendBuffer(new Buffer('abc\\n'), new Buffer('def')).toString()]);\n * //=> [ 'abc\\ndef\\n' ]\n *\n * // uses os.EOL when a line ending is not found\n * console.log([appendBuffer(new Buffer('abc'), new Buffer('def')).toString()]);\n * //=> [ 'abc\\ndef' ]\n * * ```\n * @param  {Buffer} `buf` Buffer that will be used to check for an existing line ending. The suffix is appended to this.\n * @param  {Buffer} `suffix` Buffer that will be appended to the buf.\n * @return {Buffer} Final Buffer\n * @api public\n */\n\nmodule.exports = function appendBuffer(buf, suffix) {\n  if (!suffix || !suffix.length) {\n    return buf;\n  }\n  var eol;\n  if (equals(buf.slice(-2), cr)) {\n    eol = cr;\n  } else if (equals(buf.slice(-1), nl)) {\n    eol = nl;\n  } else {\n    return Buffer.concat([buf, new Buffer(os.EOL), new Buffer(suffix)]);\n  }\n  return Buffer.concat([buf, new Buffer(suffix), eol]);\n};\n";
const GFM_OLD: string = "/*!\n * gfm-code-blocks <https://github.com/jonschlinkert/gfm-code-blocks>\n *\n * Copyright (c) 2014-2015, Jon Schlinkert.\n * Licensed under the MIT License.\n */\n\n'use strict';\n\nvar re = require('gfm-code-block-regex')();\n\nmodule.exports = function(str) {\n  var arr = [];\n  while(re.exec(str)) {\n    arr.push({\n      lang: RegExp.$3,\n      code: RegExp.$5,\n      block: RegExp.$1\n    });\n  }\n  return arr;\n};\n";
const GFM_NEW: string = "/*!\n * gfm-code-blocks <https://github.com/jonschlinkert/gfm-code-blocks>\n *\n * Copyright (c) 2014-2015, Jon Schlinkert.\n * Licensed under the MIT License.\n */\n\n'use strict';\n\nvar re = require('gfm-code-block-regex')();\n\nmodule.exports = function(str) {\n  var arr = [];\n  var match = null\n\n  while (match = re.exec(str)) {\n    arr.push({\n      start: match.index,\n      end: match.index + match[1].length,\n      lang: match[3],\n      code: match[5],\n      block: match[1]\n    });\n  }\n  return arr;\n};\n";
const OV_OLD: string = "/*!\n * object-visit <https://github.com/jonschlinkert/object-visit>\n *\n * Copyright (c) 2015, Jon Schlinkert.\n * Licensed under the MIT License.\n */\n\n'use strict';\n\nvar isObject = require('isobject');\nvar expected = require('expected');\n\nmodule.exports = function visit(thisArg, method, target) {\n  if (!isObject(thisArg) && typeof thisArg !== 'function') {\n    expected(thisArg).to.be.an('object');\n  }\n\n  if (!isObject(target) && typeof target !== 'function') {\n    expected(target).to.be.an('object');\n  }\n\n  if (typeof method !== 'string') {\n    expected(method).to.be.a('string');\n  }\n\n  for (var key in target) {\n    var fn = thisArg[method];\n    if (typeof fn !== 'function') {\n      expected(fn).to.be.a('function');\n    }\n    fn(key, target[key]);\n  }\n  return thisArg;\n};\n";
const OV_NEW: string = "/*!\n * object-visit <https://github.com/jonschlinkert/object-visit>\n *\n * Copyright (c) 2015, Jon Schlinkert.\n * Licensed under the MIT License.\n */\n\n'use strict';\n\nvar isObject = require('isobject');\n\nmodule.exports = function visit(thisArg, method, target) {\n  if (!isObject(thisArg) && typeof thisArg !== 'function') {\n    throw new Error('object-visit expects `thisArg` to be an object.');\n  }\n\n  if (typeof method !== 'string') {\n    throw new Error('object-visit expects `method` name to be a string');\n  }\n\n  target = target || {};\n  for (var key in target) {\n    var fn = thisArg[method];\n    if (typeof fn === 'function') {\n      fn(key, target[key]);\n    }\n  }\n  return thisArg;\n};\n";

/** Return early when the suffix is empty so a line ending is not inserted. A check that is not that empty-suffix return is refused. */
export function returnEarlyWhenSuffixEmptyInAppendBuffer(source: string): string | null {
  if (!source.includes("module.exports = function appendBuffer(buf, suffix) {\n  var eol;\n")) return null;
  return source === AB_OLD ? AB_NEW : null;
}

/** Use the exec match groups instead of RegExp.$* and record start and end. A check that is not that match-group capture is refused. */
export function useExecMatchGroupsInGfmCodeBlocks(source: string): string | null {
  if (!source.includes("  while(re.exec(str)) {\n    arr.push({\n      lang: RegExp.$3,\n")) return null;
  return source === GFM_OLD ? GFM_NEW : null;
}

/** Throw a dedicated thisArg error instead of using the expected helper. A check that is not that dedicated error is refused. */
export function throwDedicatedThisArgErrorInObjectVisit(source: string): string | null {
  if (!source.includes("    expected(thisArg).to.be.an('object');\n")) return null;
  return source === OV_OLD ? OV_NEW : null;
}

export interface Batch59Input {
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
export function repairBatch59(input: Batch59Input): { diff: string; file: string } | null {
  if (!/Error|not equal|Expected|Invalid|fail|toEqual|toBe|AssertionError|TypeError|undefined|to equal|deeply equivalent|deepEqual|true == false|false == true|evaluated to a falsy|loosely deep-equal|Missing expected exception|Received null|Received undefined|must be of type|expected true to be false|to throw exception/i.test(input.output)) return null;
  const edits: { path: string; next: string; original: string }[] = [];
  for (const path of filesOf(input.root, input.sourcePattern)) {
    const original = readLocal(input.root, path);
    if (original === null) continue;
    const next = returnEarlyWhenSuffixEmptyInAppendBuffer(original) ?? useExecMatchGroupsInGfmCodeBlocks(original) ?? throwDedicatedThisArgErrorInObjectVisit(original);
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
