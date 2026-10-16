// #316: a method guard whose error code is already quoted in the target file is refused with
// code_already_in_file (was the generic edit_refused). Cases from the batch2 investigation:
// sessionCollectionDue/INVALID_SESSION_DATE (et-time.ts) and alertMarker/INVALID_ALERT_KEY (tenmin-alert.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { applyRule } from "../lib/learned.ts";

const spec = JSON.parse(readFileSync(join(import.meta.dirname, "..", "rules", "learned", "public-method-guard-v1.json"), "utf8"));
const file = {
  path: "src/alert.ts",
  content: 'export function alertMarker(key: string): string {\n  if (key.length === 0) throw new Error("INVALID_ALERT_KEY");\n  return `<!-- k: ${key} -->`;\n}\n',
};
const task = (code: string) => `guard \`alertMarker\` in \`src/alert.ts\` with a method: throw ${code} when key.includes("-->")\n- \`alertMarker("a-->b")\` throws ${code}\n- \`alertMarker("k").length\` is 14`;

test("code already quoted in the file: refused as code_already_in_file", () => {
  const why: { reason?: string } = {};
  assert.equal(applyRule(spec, task("INVALID_ALERT_KEY"), [file], undefined, undefined, why), null);
  assert.equal(why.reason, "code_already_in_file");
});

test("a fresh code builds the guard and its test", () => {
  const why: { reason?: string } = {};
  const edit = applyRule(spec, task("ALERT_KEY_CLOSES_COMMENT"), [file], undefined, undefined, why);
  assert.ok(edit, why.reason);
  assert.match(edit!.content, /if \(key\.includes\("-->"\)\)/);
  assert.equal(edit!.extra?.length, 1);
});
