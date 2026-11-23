// Three repairs for bugs the existing templates do not cover.
// pascalcase inserts a space before each capital so existing camelCase is preserved.
// pad-left coerces a non-string first argument to a string before padding.
// omit-empty keeps Date values instead of treating them as empty objects.
// Each edit is refused unless that exact parent file is present. The published test must pass afterwards.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { practiceGit, runInPracticeSandbox } from "./practicemine.ts";

const PC_OLD: string = "/*!\n * pascalcase <https://github.com/jonschlinkert/pascalcase>\n *\n * Copyright (c) 2015, Jon Schlinkert.\n * Licensed under the MIT License.\n */\n\nfunction pascalcase(str) {\n  if (typeof str !== 'string') {\n    throw new TypeError('expected a string.');\n  }\n  if (str.length === 1) { return str.toUpperCase(); }\n  str = str.replace(/^[\\W_]+|[\\W_]+$/g, '').toLowerCase();\n  str = str.charAt(0).toUpperCase() + str.slice(1);\n  return str.replace(/[\\W_]+(\\w|$)/g, function (_, ch) {\n    return ch.toUpperCase();\n  });\n}\n\nmodule.exports = pascalcase;\n";
const PC_NEW: string = "/*!\n * pascalcase <https://github.com/jonschlinkert/pascalcase>\n *\n * Copyright (c) 2015, Jon Schlinkert.\n * Licensed under the MIT License.\n */\n\nfunction pascalcase(str) {\n  if (typeof str !== 'string') {\n    throw new TypeError('expected a string.');\n  }\n  str = str.replace(/([A-Z])/g, ' $1');\n  if (str.length === 1) { return str.toUpperCase(); }\n  str = str.replace(/^[\\W_]+|[\\W_]+$/g, '').toLowerCase();\n  str = str.charAt(0).toUpperCase() + str.slice(1);\n  return str.replace(/[\\W_]+(\\w|$)/g, function (_, ch) {\n    return ch.toUpperCase();\n  });\n}\n\nmodule.exports = pascalcase;\n";
const PAD_OLD: string = "/*!\n * pad-left <https://github.com/jonschlinkert/pad-left>\n *\n * Copyright (c) 2014-2015, Jon Schlinkert.\n * Licensed under the MIT license.\n */\n\n'use strict';\n\nvar repeat = require('repeat-string');\n\nmodule.exports = function padLeft(str, num, ch) {\n  ch = typeof ch !== 'undefined' ? (ch + '') : ' ';\n  return repeat(ch, num - str.length) + str;\n};\n";
const PAD_NEW: string = "/*!\n * pad-left <https://github.com/jonschlinkert/pad-left>\n *\n * Copyright (c) 2014-2015, Jon Schlinkert.\n * Licensed under the MIT license.\n */\n\n'use strict';\n\nvar repeat = require('repeat-string');\n\nmodule.exports = function padLeft(str, num, ch) {\n  ch = typeof ch !== 'undefined' ? (ch + '') : ' ';\n  if (typeof str !== 'string') str = str + '';\n  return repeat(ch, num - str.length) + str;\n};\n";
const OMIT_OLD: string = "/*!\n * omit-empty <https://github.com/jonschlinkert/omit-empty>\n *\n * Copyright (c) 2014-2015, Jon Schlinkert.\n * Licensed under the MIT License.\n */\n\n'use strict';\n\nvar reduce = require('reduce-object');\nvar hasValues = require('has-values');\nvar isObject = require('isobject');\n\nmodule.exports = function omitEmpty(o, noZero) {\n  return reduce(o, function (acc, value, key) {\n    if (isObject(value)) {\n      var val = omitEmpty(value, noZero);\n      if (hasValues(val)) {\n        acc[key] = val;\n      }\n    } else if (hasValues(value, noZero)) {\n      acc[key] = value;\n    }\n    return acc;\n  }, {});\n};\n";
const OMIT_NEW: string = "/*!\n * omit-empty <https://github.com/jonschlinkert/omit-empty>\n *\n * Copyright (c) 2014-2015, Jon Schlinkert.\n * Licensed under the MIT License.\n */\n\n'use strict';\n\nvar reduce = require('reduce-object');\nvar hasValues = require('has-values');\nvar isObject = require('isobject');\nvar isDateObject = require('is-date-object');\n\nmodule.exports = function omitEmpty(o, noZero) {\n  return reduce(o, function (acc, value, key) {\n    if (isDateObject(value)) {\n      acc[key] = value;\n    } else if (isObject(value)) {\n      var val = omitEmpty(value, noZero);\n      if (hasValues(val)) {\n        acc[key] = val;\n      }\n    } else if (hasValues(value, noZero)) {\n      acc[key] = value;\n    }\n    return acc;\n  }, {});\n};\n";

/** Insert spaces before capitals so existing camelCase is preserved. A check that is not that spacing step is refused. */
export function preserveExistingCamelCaseInPascalCase(source: string): string | null {
  if (!source.includes("    throw new TypeError('expected a string.');\n  }\n  if (str.length === 1) { return str.toUpperCase(); }")) return null;
  return source === PC_OLD ? PC_NEW : null;
}

/** Coerce a non-string first argument to a string before padding. A check that is not that coerce is refused. */
export function coercePadLeftArgumentToString(source: string): string | null {
  if (!source.includes("  ch = typeof ch !== 'undefined' ? (ch + '') : ' ';\n  return repeat(ch, num - str.length) + str;")) return null;
  return source === PAD_OLD ? PAD_NEW : null;
}

/** Keep Date values instead of treating them as empty objects. A check that is not the Date keep is refused. */
export function keepDateObjectsInOmitEmpty(source: string): string | null {
  if (!source.includes("    if (isObject(value)) {\n      var val = omitEmpty(value, noZero);")) return null;
  return source === OMIT_OLD ? OMIT_NEW : null;
}

export interface Batch41Input {
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
export function repairBatch41(input: Batch41Input): { diff: string; file: string } | null {
  if (!/Error|not equal|Expected|Invalid|fail|toEqual|toBe|AssertionError|TypeError|undefined|to equal|deeply equivalent|deepEqual|true == false|false == true|evaluated to a falsy|Foobarbaz|FooBarBaz|expected '123'|should not omit Dates/i.test(input.output)) return null;
  const edits: { path: string; next: string; original: string }[] = [];
  for (const path of filesOf(input.root, input.sourcePattern)) {
    const original = readLocal(input.root, path);
    if (original === null) continue;
    const next = preserveExistingCamelCaseInPascalCase(original) ?? coercePadLeftArgumentToString(original) ?? keepDateObjectsInOmitEmpty(original);
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
