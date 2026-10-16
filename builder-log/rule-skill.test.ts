import { test } from "node:test";
import assert from "node:assert/strict";
import type { Entry } from "./check.ts";
import { checkRuleSkills, RULE_SKILL } from "./rule-skill.ts";

const e = (seq: number, skill: string, changed: string, by = "PeaceAI"): Entry =>
  ({ seq, date: "2026-10-15", time: "22:51", asked: "x", changed, why: "x", skill, mark: "PeaceAI-able today", by }) as Entry;

test("#238 shape: IMPORT_EDIT tag on an objargs candidate is refused; CHECK_OBJECT_LITERAL_ARGS passes", () => {
  const look = (n: number) => (n === 238 ? ["public-test-case-objargs-v1"] : null);
  assert.match(checkRuleSkills([e(99, "IMPORT_EDIT", "PeaceAI-Workspace#238, PeaceSTOCKS@c095bbc")], look)[0]!, /came from public-test-case-objargs-v1 \(CHECK_OBJECT_LITERAL_ARGS\)/);
  assert.deepEqual(checkRuleSkills([e(99, "CHECK_OBJECT_LITERAL_ARGS", "PeaceAI-Workspace#238, PeaceSTOCKS@c095bbc")], look), []);
});

test("fails closed: no record, unknown rule, no issue; Builder and issue-only lines skipped", () => {
  assert.match(checkRuleSkills([e(5, "TEST_CASE", "PeaceAI-Workspace#1, PeaceSTOCKS@abcdef1")], () => null)[0]!, /fail closed/);
  assert.match(checkRuleSkills([e(5, "TEST_CASE", "PeaceAI-Workspace#1, PeaceSTOCKS@abcdef1")], () => ["core-x-v1"])[0]!, /unknown rule core-x-v1/);
  assert.match(checkRuleSkills([e(5, "TEST_CASE", "PeaceSTOCKS@abcdef1")], () => ["public-test-case-v1"])[0]!, /no single/);
  assert.deepEqual(checkRuleSkills([e(5, "TEST_CASE", "PeaceSTOCKS@abcdef1", "Builder"), e(6, "TEST_CASE", "PeaceAI-Workspace#1")], () => null), []);
});

test("every approved public learned rule file maps to a skill", async () => {
  const { readdirSync } = await import("node:fs");
  const { resolve } = await import("node:path");
  const files = readdirSync(resolve(import.meta.dirname, "../peaceai/rules/learned")).map((f) => f.replace(/\.json$/, ""));
  for (const r of Object.keys(RULE_SKILL)) assert.ok(files.includes(r), r);
});
