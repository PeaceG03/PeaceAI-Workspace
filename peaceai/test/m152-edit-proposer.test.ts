// M152: the general edit proposer (peaceai/lib/editpropose.ts) and its use in the loop (prepare on the clean copy,
// counts in the feedback). Behavior cases live in m152-cases.ts (replayed against mutants by m152-mutation.test.ts);
// this file adds static checks. Offline: the pure cases use an in-process oracle; the loop case uses node:test in the
// stage-2 isolation (candidate uid required; without it the case asserts the CAND_UID_* refusal).
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import * as prop from "../lib/editpropose.ts";
import * as loop from "../lib/loop.ts";
import { CASES } from "./m152-cases.ts";
import { setup, teardown, type M152Ctx } from "./m152-fixtures.ts";

const ROOT = resolve(import.meta.dirname, "../..");
let ctx: M152Ctx;
before(() => { ctx = setup(); });
after(() => teardown(ctx));

for (const c of CASES) test(`M152: ${c.id}`, () => c.run({ prop, loop }, ctx));

test("M152: the proposer is general: no project, repo or task names, no network, no process, no file writes", () => {
  const src = readFileSync(join(ROOT, "peaceai/lib/editpropose.ts"), "utf8");
  const code = src.split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");
  assert.doesNotMatch(code, /PeaceSTOCKS|peacestocks|scanner|github\.com|https?:\/\//i);
  assert.doesNotMatch(code, /node:(?:child_process|net|http|https|fs|dgram|worker_threads)|\bfetch\(|\beval\(|new Function/);
  const imports = [...code.matchAll(/from "([^"]+)"/g)].map((m) => m[1]).sort();
  assert.deepEqual(imports, ["./codesearch.ts", "node:crypto", "typescript"]);
});

test("M152: the template order is fixed and every template is reachable from a case", () => {
  assert.deepEqual([...prop.TEMPLATES], ["missing-export", "nullish-check", "comparison", "arithmetic", "off-by-one", "logical", "default-value", "null-guard", "negate-condition", "boolean-return"]);
  const text = "function f(a: { x: number } | null, n = 1, flag = true): boolean {\n  if (!a) return false;\n  if (a.x > n && n - 1 < 2 || a.x) return true;\n  return flag;\n}\n";
  const site = { path: "src/f.ts", name: "f", start: 0, end: text.length, tier: 0 };
  const got = new Set(prop.mutationsIn(prop.parseSource("src/f.ts", text), site, 0, new Set()).map((m) => m.template));
  assert.deepEqual([...got].sort(), [...prop.TEMPLATES].sort());
});

test("M152: the loop gives the proposer counts in the feedback and calls prepare after resetting the copy", () => {
  const src = readFileSync(join(ROOT, "peaceai/lib/loop.ts"), "utf8");
  assert.match(src, /feedback\.push\(\{ attempt, codes: r\.codes, failing: r\.failing, tests: r\.tests \}\)/);
  const at = src.indexOf("o.proposer.prepare(");
  assert.ok(at > 0 && src.lastIndexOf("resetCopy(c); // m152-guard:prepare-clean", at) > src.lastIndexOf("putTeamTests();", at), "prepare must follow a reset after the baseline");
});
