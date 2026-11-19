// Three repairs for bugs the existing templates do not cover.
// rename-keys looks up own keys with Object.prototype.hasOwnProperty.
// remove-bom-buffer only strips a UTF-8 BOM from UTF-8 buffers.
// requires-regex ignores require() calls that appear only inside quoted strings.
// Each edit is refused unless that exact parent file is present. The published test must pass afterwards.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { practiceGit, runInPracticeSandbox } from "./practicemine.ts";

const KEYS_OLD: string = "(function () {\n  'use strict';\n\n  function rename(obj, fn) {\n    if (typeof fn !== 'function') {\n      return obj;\n    }\n\n    var res = {};\n    for (var key in obj) {\n      if (obj.hasOwnProperty(key)) {\n        res[fn(key) || key] = obj[key];\n      }\n    }\n    return res;\n  }\n\n  if (typeof module !== 'undefined' && module.exports) {\n    module.exports = rename;\n  } else {\n    if (typeof define === 'function' && define.amd) {\n      define([], function () {\n        return rename;\n      });\n    } else {\n      window.rename = rename;\n    }\n  }\n})();\n";
const KEYS_NEW: string = "(function () {\n  'use strict';\n\n  function rename(obj, fn) {\n    if (typeof fn !== 'function') {\n      return obj;\n    }\n\n    var res = {};\n    for (var key in obj) {\n      if (Object.prototype.hasOwnProperty.call(obj, key)) {\n        res[fn(key) || key] = obj[key];\n      }\n    }\n    return res;\n  }\n\n  if (typeof module !== 'undefined' && module.exports) {\n    module.exports = rename;\n  } else {\n    if (typeof define === 'function' && define.amd) {\n      define([], function () {\n        return rename;\n      });\n    } else {\n      window.rename = rename;\n    }\n  }\n})();\n";
const BOM_OLD: string = "/*!\n * strip-bom-buffer <https://github.com/jonschlinkert/strip-bom-buffer>\n *\n * Copyright (c) 2015, 2017, Jon Schlinkert.\n * Released under the MIT License.\n */\n\n'use strict';\n\nvar isBuffer = require('is-buffer');\n\nmodule.exports = function(buf) {\n  if (isBuffer(buf) && String(buf.slice(0, 3)) === '\\ufeff') {\n    return buf.slice(3);\n  }\n  return buf;\n};\n";
const BOM_NEW: string = "/*!\n * strip-bom-buffer <https://github.com/jonschlinkert/strip-bom-buffer>\n *\n * Copyright (c) 2015, 2017, Jon Schlinkert.\n * Released under the MIT License.\n */\n\n'use strict';\n\nvar isUTF8 = require('is-utf8');\nvar isBuffer = require('is-buffer');\n\nmodule.exports = function(buf) {\n  if (isBuffer(buf) && isUTF8(buf) && String(buf.slice(0, 3)) === '\\ufeff') {\n    return buf.slice(3);\n  }\n  return buf;\n};\n";
const REQ_OLD: string = "'use strict';\n\nmodule.exports = function() {\n  return /(?:([`'\"])\\s*[_.\\w/$]*?\\s*require\\s*[^\\1]*?\\s*\\1)|\\s*(?:(?:var|const|let)?\\s*([_.\\w/$]+?)\\s*=\\s*)?require\\(([`'\"])((?:@([^/]+?)\\/)?([^/]+?)|[-.@\\w/$]+?)\\3\\);?/g;\n};\n";
const REQ_NEW: string = "'use strict';\n\nmodule.exports = function() {\n  return /(?:(?:\\\\['\"`][\\s\\S])*?(['\"`](?=[\\s\\S]*?require\\s*\\(['\"`][^`\"']+?[`'\"]\\)))(?:\\\\\\1|[\\s\\S])*?\\1|\\s*(?:(?:var|const|let)?\\s*([_.\\w/$]+?)\\s*=\\s*)?require\\s*\\(([`'\"])((?:@([^/]+?)\\/([^/]*?)|[-.@\\w/$]+?))\\3(?:, ([`'\"])([^\\7]+?)\\7)?\\);?)/g;\n};\n";

/** Use Object.prototype.hasOwnProperty when renaming keys on objects that do not inherit from Object.prototype. A check that is not that hasOwnProperty call is refused. */
export function useObjectPrototypeHasOwnPropertyWhenRenamingKeys(source: string): string | null {
  if (!source.includes("      if (obj.hasOwnProperty(key)) {")) return null;
  return source === KEYS_OLD ? KEYS_NEW : null;
}

/** Leave a non-UTF-8 buffer's BOM in place. A check that is not that UTF-8 guard is refused. */
export function skipStrippingBomFromNonUtf8Buffers(source: string): string | null {
  if (!source.includes("  if (isBuffer(buf) && String(buf.slice(0, 3)) === '\\ufeff') {")) return null;
  return source === BOM_OLD ? BOM_NEW : null;
}

/** Ignore require() calls that appear only inside quoted strings. A check that is not that quoted-require regex is refused. */
export function ignoreRequireCallsInsideQuotedStrings(source: string): string | null {
  if (!source.includes("((?:@([^/]+?)\\/)?([^/]+?)|[-.@\\w/$]+?)\\3\\);?/g;")) return null;
  return source === REQ_OLD ? REQ_NEW : null;
}

export interface Batch47Input {
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
export function repairBatch47(input: Batch47Input): { diff: string; file: string } | null {
  if (!/Error|not equal|Expected|Invalid|fail|toEqual|toBe|AssertionError|TypeError|undefined|to equal|deeply equivalent|deepEqual|true == false|false == true|evaluated to a falsy|hasOwnProperty is not a function|non-utf8 value|"foo": "bar"/i.test(input.output)) return null;
  const edits: { path: string; next: string; original: string }[] = [];
  for (const path of filesOf(input.root, input.sourcePattern)) {
    const original = readLocal(input.root, path);
    if (original === null) continue;
    const next = useObjectPrototypeHasOwnPropertyWhenRenamingKeys(original) ?? skipStrippingBomFromNonUtf8Buffers(original) ?? ignoreRequireCallsInsideQuotedStrings(original);
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
