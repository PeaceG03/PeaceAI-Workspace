import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { appendOnly, LOG_PATH, validateLog } from "./check.ts";

const ok = {
  seq: 1, date: "2026-10-13", time: "01:05", asked: "Fix the typecheck failure", changed: "PeaceSTOCKS@369f6ea",
  why: "tsc failed on main", skill: "THROW_GUARD", mark: "PeaceAI-able today", by: "Builder",
};
const line = (o: object) => JSON.stringify(o) + "\n";

test("the committed log is valid", () => {
  assert.deepEqual(validateLog(readFileSync(LOG_PATH, "utf8")), []);
});

test("a valid entry passes; missing skills need the matching mark", () => {
  assert.deepEqual(validateLog(line(ok)), []);
  assert.deepEqual(validateLog(line({ ...ok, skill: "WORKFLOW_JOB", mark: "missing skill WORKFLOW_JOB" })), []);
  assert.ok(validateLog(line({ ...ok, skill: "WORKFLOW_JOB" })).some((e) => /mark must be/.test(e)));
  assert.ok(validateLog(line({ ...ok, mark: "missing skill THROW_GUARD" })).some((e) => /mark must be/.test(e)));
});

test("schema refusals", () => {
  const bad: [object, RegExp][] = [
    [{ ...ok, seq: 2 }, /seq must be 1/],
    [{ ...ok, extra: 1 }, /keys must be exactly/],
    [{ ...ok, skill: "ANYTHING" }, /unknown skill/],
    [{ ...ok, changed: "main" }, /changed must be/],
    [{ ...ok, changed: "OtherRepo@369f6ea" }, /changed must be/],
    [{ ...ok, time: "25:00" }, /bad time/],
    [{ ...ok, by: "PeaceAI", skill: "WORKFLOW_JOB", mark: "missing skill WORKFLOW_JOB" }, /approved skill/],
    [{ ...ok, why: "x ghp_" + "a".repeat(30) }, /secret-shaped/],
    [{ ...ok, why: "touched PeaceSTOCKS-Net code" }, /private Net/],
  ];
  for (const [o, re] of bad) assert.ok(validateLog(line(o)).some((e) => re.test(e)), String(re));
  assert.ok(validateLog("{not json}\n").some((e) => /not JSON/.test(e)));
  assert.ok(validateLog(JSON.stringify(ok, null, 1) + "\n").length > 0);
  assert.ok(validateLog(JSON.stringify(ok)).some((e) => /newline/.test(e)));
});

test("append-only: appending passes; editing, removing or reordering fails", () => {
  const a = line(ok);
  const b = line({ ...ok, seq: 2 });
  assert.deepEqual(appendOnly("", a), []);
  assert.deepEqual(appendOnly(a, a + b), []);
  assert.deepEqual(appendOnly(a + b, a + b), []);
  assert.match(appendOnly(a + b, a)[0] ?? "", /line 2 was modified or removed/);
  assert.match(appendOnly(a, line({ ...ok, why: "rewritten reason" }))[0] ?? "", /line 1/);
  assert.match(appendOnly(a + b, b + a)[0] ?? "", /line 1/);
});

test("skills approved later: missing before the landing time, approved (and PeaceAI-able) from it on", () => {
  for (const [skill, date, before, after] of [["WORKFLOW_STEP", "2026-10-13", "22:40", "22:41"], ["CHECK_OBJECT_LITERAL_ARGS", "2026-10-13", "21:29", "21:30"]] as const) {
    assert.deepEqual(validateLog(line({ ...ok, date, time: before, skill, mark: `missing skill ${skill}` })), [], `${skill} before`);
    assert.ok(validateLog(line({ ...ok, date, time: before, skill, mark: "PeaceAI-able today" })).some((e) => /mark must be/.test(e)));
    assert.ok(validateLog(line({ ...ok, date, time: before, skill, mark: `missing skill ${skill}`, by: "PeaceAI" })).some((e) => /approved skill/.test(e)), "PeaceAI cannot use it before landing");
    assert.deepEqual(validateLog(line({ ...ok, date, time: after, skill, mark: "PeaceAI-able today", by: "PeaceAI" })), [], `${skill} after`);
    assert.deepEqual(validateLog(line({ ...ok, date: "2026-10-14", time: "00:01", skill, mark: "PeaceAI-able today" })), [], "next day");
    assert.ok(validateLog(line({ ...ok, date, time: after, skill, mark: `missing skill ${skill}` })).some((e) => /mark must be/.test(e)));
  }
  assert.ok(validateLog(line({ ...ok, skill: "toString", mark: "missing skill toString" })).some((e) => /unknown skill/.test(e)), "no prototype keys");
});
