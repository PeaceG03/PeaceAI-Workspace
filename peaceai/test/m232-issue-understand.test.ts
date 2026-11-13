// Issue and commit wording. The sentences here are synthetic. They are not practice-set rows.
// credit: false.
import assert from "node:assert/strict";
import test from "node:test";
import { classifyJobOutput } from "../lib/capabilityjob.ts";
import { impliedSourceFile, understandIssue, type UnderstandInput } from "../lib/issueunderstand.ts";
import { isCanonical, nlDecision, loadModel } from "../lib/nlparse.ts";

const model = loadModel();
const none = new Set<string>();
const learned = new Set(["SET_LITERAL", "ADD_SWITCH_CASE", "ADD_NULLISH_DEFAULT"]);

function read(body: string, extra: Partial<UnderstandInput> = {}) {
  return understandIssue({ title: body, body, approvedKinds: learned, ...extra });
}

function mapped(body: string, objective: string, family: string, extra: Partial<UnderstandInput> = {}) {
  const old = nlDecision({ title: "", body }, undefined, learned, model);
  assert.equal(old.status, "unsure", `the phrase list already accepts: ${body}`);
  const got = read(body, extra);
  assert.equal(got.status, "mapped", body);
  if (got.status !== "mapped") return;
  assert.equal(got.objective, objective);
  assert.equal(got.steps[0]?.family, family);
  assert.equal(isCanonical(got.objective), true, got.objective);
}

test("issue sentences map onto the existing phrase, and the old phrase list does not", () => {
  mapped(
    "fix parseQuantity so it returns 0 when raw is empty",
    "Add a guard to parseQuantity that returns 0 when raw is empty",
    "guard",
  );
  mapped(
    "fix: parseQuantity when raw is empty so it returns 0",
    "Add a guard to parseQuantity that returns 0 when raw is empty",
    "guard",
  );
  mapped(
    "handle the edge case where raw is empty in parseQuantity by returning 0",
    "Add a guard to parseQuantity that returns 0 when raw is empty",
    "guard",
  );
  mapped(
    "wrong return for empty raw: parseQuantity should return 0",
    "Add a guard to parseQuantity that returns 0 when raw is empty",
    "guard",
  );
  mapped(
    "add the missing check so parseQuantity returns 0 when raw is empty",
    "Add a guard to parseQuantity that returns 0 when raw is empty",
    "guard",
  );
  mapped(
    "fix readProfile so a thrown error returns null",
    "Wrap the body of readProfile in try/catch that returns null on error",
    "try-catch",
  );
  mapped(
    'add the missing value "pdf" to the array EXPORT_KINDS',
    'Add "pdf" to the array EXPORT_KINDS',
    "array-item",
  );
  mapped(
    "add the missing property timeoutMs with value 3000 on the object LIMITS",
    "Add property timeoutMs with value 3000 to object LIMITS",
    "object-property",
  );
  mapped(
    'add the missing member "critical" to the union Severity',
    'Add "critical" to the union type Severity',
    "union-member",
  );
  mapped(
    "add the missing field email of type string to the type Profile",
    "Add a field email of type string to type Profile",
    "type-field",
  );
  mapped(
    "fix the value of LIMIT to 4",
    "set LIMIT to 4",
    "set-literal",
  );
  mapped(
    "wrong value of LIMIT: it should be 4",
    "set LIMIT to 4",
    "set-literal",
  );
  mapped(
    'fix the switch in parseKind so the case "odd" returns 0',
    'add case "odd" returning 0 to the switch in parseKind',
    "switch-case",
  );
  mapped(
    "when opts.kinds is missing, listKinds should use []",
    "default opts.kinds to [] in listKinds",
    "nullish-default",
  );
  mapped(
    "please rename the existing function foo into bar",
    "rename the function foo to bar",
    "rename",
  );
});

test("a test path and the source pattern name one source file, and a generic test file names none", () => {
  const pattern = "^src/[A-Za-z0-9._-]+\\.ts$";
  const sources = ["src/lim.ts", "src/other.ts", "src/lim.test.ts"];
  assert.equal(impliedSourceFile("src/lim.test.ts", pattern, sources), "src/lim.ts");
  assert.equal(impliedSourceFile("test/lim.test.ts", pattern, sources), "src/lim.ts");
  assert.equal(impliedSourceFile("src/lim.edge.test.ts", pattern, sources), "src/lim.ts");
  assert.equal(impliedSourceFile("test/test.ts", pattern, sources), null);
  assert.equal(impliedSourceFile("src/lim.test.ts", "^src/.+\\.ts$", ["src/lim.ts", "src/extra/lim.ts"]), null);
  assert.equal(impliedSourceFile("src/lim.test.ts", "^source/.+\\.ts$", ["source/lim.ts"]), "source/lim.ts");
  const set = read("fix the value of LIMIT to 4", { testFile: "src/lim.test.ts", sourcePattern: pattern, sources });
  assert.equal(set.status, "mapped");
  if (set.status === "mapped") assert.equal(set.objective, "set LIMIT in src/lim.ts to 4");
  const constant = read("add the missing constant MAX_PAGES = 50", { testFile: "src/config.test.ts", sourcePattern: pattern, sources: ["src/config.ts", "src/other.ts"] });
  assert.equal(constant.status, "mapped");
  if (constant.status === "mapped") assert.equal(constant.objective, "Add an exported constant MAX_PAGES with value 50 to src/config.ts");
  const missing = read("add the missing constant MAX_PAGES = 50");
  assert.equal(missing.status, "cant");
  if (missing.status === "cant") assert.equal(missing.reason, "CANT_DO_YET_NO_FILE");
  const outside = read("add the missing constant MAX_PAGES = 50 in notes/config.ts", { sourcePattern: pattern, sources: ["src/config.ts"] });
  assert.equal(outside.status, "cant");
  if (outside.status === "cant") assert.equal(outside.reason, "CANT_DO_YET_NO_FILE");
});

test("a missing slot, a bug report, or a second unfinished clause is can't do yet", () => {
  const cases: [string, string][] = [
    ["Thanks for the review of the patch", "CANT_DO_YET_NO_EDIT"],
    ["fix parseQuantity when raw is empty", "CANT_DO_YET_EDIT_UNSPECIFIED"],
    ["fix parseQuantity so it silently returns 0 when raw is empty", "CANT_DO_YET_EDIT_UNSPECIFIED"],
    ["fix parseQuantity so it returns 0 when raw is not a date", "CANT_DO_YET_EDIT_UNSPECIFIED"],
    ["add leftPad and rightPad helpers", "CANT_DO_YET_ADD_UNSPECIFIED"],
    ["Require Node.js 22", "CANT_DO_YET_NOT_A_FAMILY"],
    ["rename box.size to box.length", "CANT_DO_YET_NAME_SHAPE"],
    ["fix the value of LIMIT to 4", "CANT_DO_YET_RULE_NOT_APPROVED"],
  ];
  for (const [body, reason] of cases) {
    const got = body.startsWith("fix the value")
      ? read(body, { approvedKinds: none })
      : read(body);
    assert.equal(got.status, "cant", body);
    if (got.status === "cant") assert.equal(got.reason, reason, body);
  }
  const partial = read("Fix parseQuantity so it returns 0 when raw is empty.\nMake the whole module faster.");
  assert.equal(partial.status, "cant");
  if (partial.status === "cant") assert.equal(partial.reason, "CANT_DO_YET_PARTIAL");
  const both = read('Fix parseQuantity so it returns 0 when raw is empty.\nAdd the missing value "pdf" to the array EXPORT_KINDS.');
  assert.equal(both.status, "mapped");
  if (both.status === "mapped") {
    assert.equal(both.steps.length, 2);
    assert.match(both.objective, /^Step 1: Add a guard to parseQuantity/);
    assert.match(both.objective, /Step 2: Add "pdf" to the array EXPORT_KINDS/);
    assert.equal(isCanonical(both.objective), true);
  }
});

test("a sentence the phrase list already accepts stays on that path", () => {
  const body = "Make parseQuantity return 0 when raw is empty";
  const old = nlDecision({ title: "", body }, undefined, none, model);
  assert.equal(old.status, "parsed");
  if (old.status === "parsed") assert.equal(old.objective, "Add a guard to parseQuantity that returns 0 when raw is empty");
});

test("a can't-do-yet line is the replay reason, and a candidate is still a pass", () => {
  const refused = classifyJobOutput({
    timedOut: false, code: 0, candidates: 0,
    stdout: "nl=unsure reason=NOT_SUPPORTED\ncan't do yet: CANT_DO_YET_NO_EDIT\n",
  });
  assert.equal(refused.reason, "CANT_DO_YET_NO_EDIT");
  const older = classifyJobOutput({ timedOut: false, code: 0, candidates: 0, stdout: "nl=unsure reason=NOT_SUPPORTED\n" });
  assert.equal(older.reason, "NL_NOT_SUPPORTED");
  const passed = classifyJobOutput({ timedOut: false, code: 0, candidates: 1, stdout: "can't do yet: CANT_DO_YET_NO_EDIT\n" });
  assert.equal(passed.status, "pass");
});
