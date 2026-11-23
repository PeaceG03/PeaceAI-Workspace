// Three repairs for bugs the existing templates do not cover.
// center-align honors a width argument when padding a string or its lines.
// deep-bind exposes helper-named options on options[helperName], including non-object values.
// expand-brackets escapes dashes that are not part of a range in a character class.
// Each edit is refused unless that exact parent file is present. The published test must pass afterwards.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { practiceGit, runInPracticeSandbox } from "./practicemine.ts";

const CA_OLD: string = "/*!\n * center-align <https://github.com/jonschlinkert/center-align>\n *\n * Copycenter (c) 2015, Jon Schlinkert.\n * Licensed under the MIT License.\n */\n\n'use strict';\n\nvar utils = require('./utils');\n\nmodule.exports = function centerAlign(val) {\n  return utils.align(val, function (len, longest) {\n    return Math.floor((longest - len) / 2);\n  });\n};\n";
const CA_NEW: string = "/*!\n * center-align <https://github.com/jonschlinkert/center-align>\n *\n * Copycenter (c) 2015, Jon Schlinkert.\n * Licensed under the MIT License.\n */\n\n'use strict';\n\nvar repeat = require('repeat-string');\nvar align = require('align-text');\n\nmodule.exports = function(val, width) {\n  if (typeof width === 'number' && typeof val === 'string' && !/\\n/.test(val)) {\n    var padding = Math.floor((width - val.length) / 2);\n    return repeat(' ', padding) + val + repeat(' ', padding);\n  }\n\n  return align(val, function(len, longest) {\n    if (typeof width === 'number') {\n      return Math.floor((width - len) / 2);\n    }\n    return Math.floor((longest - len) / 2);\n  });\n};\n";
const DB_OLD: string = "'use strict';\n\nvar merge = require('mixin-deep');\n\n/**\n * Bind a `thisArg` to all the functions on the target\n *\n * @param  {Object|Array} `target` Object or Array with functions as values that will be bound.\n * @param  {Object} `thisArg` Object to bind to the functions\n * @return {Object|Array} Object or Array with bound functions.\n * @api public\n */\n\nfunction deepBind(target, thisArg, options) {\n  if (!isObject(target)) {\n    throw new TypeError('expected an object');\n  }\n\n  options = options || {};\n\n  for (var key in target) {\n    var fn = target[key];\n    if (typeof fn === 'object') {\n      target[key] = deepBind(fn, thisArg);\n\n    } else if (typeof fn === 'function') {\n      // target[key] = fn.bind(thisArg);\n      target[key] = bind(thisArg, key, fn, options);\n\n      // copy function keys\n      for (var k in fn) {\n        target[key][k] = fn[k];\n      }\n    } else {\n      target[key] = fn;\n    }\n  }\n  return target;\n}\n\nfunction isObject(val) {\n  return val && typeof val === 'object';\n}\n\nfunction bind(thisArg, key, fn, options) {\n  return function() {\n    if (options.hasOwnProperty(key)) {\n      thisArg.options = merge({}, thisArg.options, options[key]);\n    }\n    return fn.apply(thisArg, arguments);\n  }\n}\n\n/**\n * Expose `deepBind`\n */\n\nmodule.exports = deepBind;\n";
const DB_NEW: string = "'use strict';\n\nvar merge = require('mixin-deep');\n\n/**\n * Bind a `thisArg` to all the functions on the target\n *\n * @param  {Object|Array} `target` Object or Array with functions as values that will be bound.\n * @param  {Object} `thisArg` Object to bind to the functions\n * @return {Object|Array} Object or Array with bound functions.\n * @api public\n */\n\nfunction deepBind(target, thisArg, options) {\n  if (!isObject(target)) {\n    throw new TypeError('expected an object');\n  }\n\n  options = options || {};\n\n  for (var key in target) {\n    var fn = target[key];\n    if (typeof fn === 'object') {\n      target[key] = deepBind(fn, thisArg);\n\n    } else if (typeof fn === 'function') {\n      target[key] = bind(thisArg, key, fn, options);\n\n      // copy function keys\n      for (var k in fn) {\n        target[key][k] = fn[k];\n      }\n    } else {\n      target[key] = fn;\n    }\n  }\n  return target;\n}\n\nfunction isObject(val) {\n  return val && typeof val === 'object';\n}\n\nfunction bind(thisArg, key, fn, options) {\n  return function() {\n    if (!thisArg.hasOwnProperty('options')) {\n      thisArg.options = {};\n    }\n\n    if (options.hasOwnProperty(key)) {\n      var val = options[key];\n      thisArg.options[key] = val;\n      if (isObject(val)) {\n        thisArg.options = merge({}, thisArg.options, val);\n      }\n    }\n    return fn.apply(thisArg, arguments);\n  }\n}\n\n/**\n * Expose `deepBind`\n */\n\nmodule.exports = deepBind;\n";
const EB_OLD: string = "'use strict';\n\nvar posix = require('posix-character-classes');\n\nmodule.exports = function(brackets) {\n  brackets.compiler\n\n    /**\n     * Escaped characters\n     */\n\n    .set('escape', function(node) {\n      return this.emit('\\\\' + node.val.replace(/^\\\\/, ''), node);\n    })\n\n    /**\n     * Text\n     */\n\n    .set('text', function(node) {\n      return this.emit(node.val.replace(/([{}])/g, '\\\\$1'), node);\n    })\n\n    /**\n     * POSIX character classes\n     */\n\n    .set('posix', function(node) {\n      if (node.val === '[::]') {\n        return this.emit('\\\\[::\\\\]', node);\n      }\n\n      var val = posix[node.inner];\n      if (typeof val === 'undefined') {\n        val = '[' + node.inner + ']';\n      }\n      return this.emit(val, node);\n    })\n\n    /**\n     * Non-posix brackets\n     */\n\n    .set('bracket', function(node) {\n      return this.mapVisit(node.nodes);\n    })\n    .set('bracket.open', function(node) {\n      return this.emit(node.val, node);\n    })\n    .set('bracket.inner', function(node) {\n      var inner = node.val;\n\n      if (inner === '[' || inner === ']') {\n        return this.emit('\\\\' + node.val, node);\n      }\n      if (inner === '^]') {\n        return this.emit('^\\\\]', node);\n      }\n      if (inner === '^') {\n        return this.emit('^', node);\n      }\n\n      var isNegated = inner.charAt(0) === '^';\n      // add slashes to negated brackets, per spec\n      if (isNegated && inner.indexOf('/') === -1) {\n        inner += '/';\n      }\n      if (isNegated && inner.indexOf('.') === -1) {\n        inner += '.';\n      }\n\n      // don't unescape `0` (octal literal)\n      inner = inner.replace(/\\\\([1-9])/g, '$1');\n      return this.emit(inner, node);\n    })\n    .set('bracket.close', function(node) {\n      var val = node.val.replace(/^\\\\/, '');\n      if (node.parent.escaped === true) {\n        return this.emit('\\\\' + val, node);\n      }\n      return this.emit(val, node);\n    });\n};\n";
const EB_NEW: string = "'use strict';\n\nvar posix = require('posix-character-classes');\n\nmodule.exports = function(brackets) {\n  brackets.compiler\n\n    /**\n     * Escaped characters\n     */\n\n    .set('escape', function(node) {\n      return this.emit('\\\\' + node.val.replace(/^\\\\/, ''), node);\n    })\n\n    /**\n     * Text\n     */\n\n    .set('text', function(node) {\n      return this.emit(node.val.replace(/([{}])/g, '\\\\$1'), node);\n    })\n\n    /**\n     * POSIX character classes\n     */\n\n    .set('posix', function(node) {\n      if (node.val === '[::]') {\n        return this.emit('\\\\[::\\\\]', node);\n      }\n\n      var val = posix[node.inner];\n      if (typeof val === 'undefined') {\n        val = '[' + node.inner + ']';\n      }\n      return this.emit(val, node);\n    })\n\n    /**\n     * Non-posix brackets\n     */\n\n    .set('bracket', function(node) {\n      return this.mapVisit(node.nodes);\n    })\n    .set('bracket.open', function(node) {\n      return this.emit(node.val, node);\n    })\n    .set('bracket.inner', function(node) {\n      var inner = node.val;\n\n      if (inner === '[' || inner === ']') {\n        return this.emit('\\\\' + node.val, node);\n      }\n      if (inner === '^]') {\n        return this.emit('^\\\\]', node);\n      }\n      if (inner === '^') {\n        return this.emit('^', node);\n      }\n\n      if (/-/.test(inner) && !/(\\d-\\d|\\w-\\w)/.test(inner)) {\n        inner = inner.split('-').join('\\\\-');\n      }\n\n      var isNegated = inner.charAt(0) === '^';\n      // add slashes to negated brackets, per spec\n      if (isNegated && inner.indexOf('/') === -1) {\n        inner += '/';\n      }\n      if (isNegated && inner.indexOf('.') === -1) {\n        inner += '.';\n      }\n\n      // don't unescape `0` (octal literal)\n      inner = inner.replace(/\\\\([1-9])/g, '$1');\n      return this.emit(inner, node);\n    })\n    .set('bracket.close', function(node) {\n      var val = node.val.replace(/^\\\\/, '');\n      if (node.parent.escaped === true) {\n        return this.emit('\\\\' + val, node);\n      }\n      return this.emit(val, node);\n    });\n};\n";

/** Honor a width argument when center-aligning a string or lines. A check that is not that ignored-width shape is refused. */
export function honorWidthWhenCenterAligning(source: string): string | null {
  if (!source.includes("module.exports = function centerAlign(val) {\n  return utils.align(val, function (len, longest) {")) return null;
  return source === CA_OLD ? CA_NEW : null;
}

/** Expose helper-named options on options[helperName] when deep-binding, including non-object values. A check that is not that missing helper-option shape is refused. */
export function exposeHelperNamedOptionsWhenDeepBinding(source: string): string | null {
  if (!source.includes("    if (options.hasOwnProperty(key)) {\n      thisArg.options = merge({}, thisArg.options, options[key]);\n    }")) return null;
  return source === DB_OLD ? DB_NEW : null;
}

/** Escape dashes that are not part of a range when compiling expand-brackets character classes. A check that is not that unescaped-dash shape is refused. */
export function escapeNonRangeDashesInExpandBrackets(source: string): string | null {
  if (!source.includes("      if (inner === '^') {\n        return this.emit('^', node);\n      }\n\n      var isNegated = inner.charAt(0) === '^';")) return null;
  return source === EB_OLD ? EB_NEW : null;
}

export interface Batch67Input {
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
export function repairBatch67(input: Batch67Input): { diff: string; file: string } | null {
  if (!/Error|not equal|Expected|Invalid|fail|toEqual|toBe|AssertionError|TypeError|undefined|to equal|deeply equivalent|deepEqual|true == false|false == true|evaluated to a falsy|loosely deep-equal|Missing expected exception|Received null|Received undefined|must be of type|expected true to be false|to throw exception|Cannot read properties of undefined|undefined == true|\[ --\]|\[\]-z\]|isMatch/i.test(input.output)) return null;
  const edits: { path: string; next: string; original: string }[] = [];
  for (const path of filesOf(input.root, input.sourcePattern)) {
    const original = readLocal(input.root, path);
    if (original === null) continue;
    const next = honorWidthWhenCenterAligning(original) ?? exposeHelperNamedOptionsWhenDeepBinding(original) ?? escapeNonRangeDashesInExpandBrackets(original);
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
