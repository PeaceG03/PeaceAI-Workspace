// M46: issue-text cleaning keeps comparison operators (#169's first attempt lost the > of `n > 99`).
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanIssueText } from "../lib/taskmap.ts";
import { applyGuardRule } from "../lib/learned-guard.ts";
import { PROTECTED_SELF } from "../lib/selfchange.ts";

const repo = join(import.meta.dirname, "../..");
const clean = (body: string) => cleanIssueText({ title: "T", body });

test("every comparison operator survives cleaning", () => {
  for (const op of ["<", ">", "<=", ">=", "===", "!==", "==", "!="]) {
    const out = clean(`guard \`f\` in \`src/a.ts\`: throw BAD_X when x ${op} 3`);
    assert.ok(out.includes(`x ${op} 3`), `${op}: ${out}`);
  }
  assert.ok(clean("when a > 1 && b >= 2 || c < 3").includes("a > 1 && b >= 2 || c < 3"));
  assert.ok(clean("- `f(1)` equals `[1]` and `(x) => x > 0` is kept").includes("(x) => x > 0"));
});

test("Markdown quote markers, backticks, * and # are still dropped", () => {
  assert.equal(clean("> quoted line\n>> nested\n  > indented"), "T\n\nquoted line\nnested\nindented");
  assert.equal(clean("`code` **bold** # head"), "T\n\n code bold head");
  assert.equal(cleanIssueText({ title: "T", body: "a <!-- hidden --> `b`\n```\ncode\n```" }), "T\n\na b");
});

test("#169 regression: a guard task with n > 99 now yields the edit", () => {
  const spec = JSON.parse(readFileSync(join(repo, "peaceai/rules/learned/public-throw-guard-v1.json"), "utf8"));
  const body = "guard `pad2` in `src/t.ts`: throw INVALID_PAD2 when !Number.isInteger(n) || n < 0 || n > 99\n- `pad2(-1)` throws INVALID_PAD2\n- `pad2(7)` is `\"07\"`";
  const files = [{ path: "src/t.ts", content: 'export function pad2(n: number): string {\n  return String(n).padStart(2, "0");\n}\n' }];
  const edit = applyGuardRule(spec.trigger, spec.params, cleanIssueText({ title: "[scanner] guard pad2", body }), files, (p) => p.endsWith(".test.ts"));
  assert.ok(edit, "no edit");
  assert.match(edit!.content, /if \(!Number\.isInteger\(n\) \|\| n < 0 \|\| n > 99\) throw new Error\("INVALID_PAD2"\);/);
});

test("taskmap.ts and this test are protected", () => {
  for (const p of ["peaceai/lib/taskmap.ts", "peaceai/test/m46-issue-text.test.ts"]) assert.ok(PROTECTED_SELF.some((x) => x.pattern.test(p)), p);
});
