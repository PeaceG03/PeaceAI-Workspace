// M99 round 3 (Peace, #491): rule programs out by ASKING, not only refusing. A DERIVE refusal names the inputs where
// programs that fit every example disagree, with each one's result there, as questions ("what should f(20) give?
// one program that fits every example gives true, another gives false"). The questions are in the refusal record
// (deriveProgram -> buildDeriveEdit -> why.questions -> RULE_QUESTIONS) and in the issue's no-candidate comment, in
// plain words. A question is never answered from the derived program: only the issue author's next example does.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { deriveProgram, deriveQuestions, edgeQuestions, evalProgram, rivalProblem, DERIVE_MAX_QUESTIONS, type DeriveExample, type DeriveInput, type DeriveNode, type DeriveParam, type DeriveValue } from "../lib/derive.ts";
import { DERIVE_TRIGGER, DERIVE_VOCAB, runDeriveRule } from "../lib/learned-derive.ts";
import { formatDeriveQuestions, noCandidateComment, questionWords, validQuestionLine } from "../lib/refusal-reason.ts";
import { cleanIssueText } from "../lib/taskmap.ts";

const n = [{ name: "n", type: "number" }] as DeriveParam[];
const ex = (rows: readonly (readonly DeriveValue[])[]): DeriveExample[] => rows.map((r) => ({ args: r.slice(0, -1), out: r[r.length - 1]! }));
const grid = Array.from({ length: 601 }, (_, k) => [k - 300]);

/** The asking loop: refuse -> answer every question from the truth (the issue author) -> derive again. */
function askLoop(input: DeriveInput, truth: (a: readonly DeriveValue[]) => DeriveValue, rounds: number) {
  const examples = [...input.examples];
  const asked: string[] = [];
  for (let round = 0; round <= rounds; round++) {
    const before = JSON.stringify(examples);
    const r = deriveProgram({ ...input, examples });
    assert.equal(JSON.stringify(examples), before, "deriveProgram never adds or changes an example");
    if (r.ok) return { r, round, asked, examples };
    assert.ok(r.questions?.length, `round ${round}: ${r.reason}/${r.gate ?? ""} refused without a question`);
    for (const q of r.questions!) {
      assert.deepEqual(Object.keys(q), ["at", "answers"], "nothing marks the derived program's answer");
      assert.ok(q.answers.length >= 2 && !examples.some((e) => JSON.stringify(e.args) === JSON.stringify(q.at)));
      asked.push(`${r.reason === "derive_under_specified" ? r.gate : r.reason}@${q.at.join(",")}`);
      examples.push({ args: q.at, out: truth(q.at) });
    }
  }
  assert.fail(`not closed in ${rounds} rounds: ${asked.join(" ")}`);
}

test("hidden island: the region refusal asks at an input inside the bare band; answering closes the loop on the right program", () => {
  const truth = ([x]: readonly DeriveValue[]) => (x as number) <= 10 || (20 <= (x as number) && (x as number) <= 30) || (x as number) >= 50;
  const input: DeriveInput = { params: n, ret: "boolean", examples: ex([[10, true], [9, true], [11, false], [0, true], [-100, true], [15, false], [40, false], [49, false], [50, true], [51, true], [150, true]]) };
  const r0 = deriveProgram(input);
  assert.ok(!r0.ok && r0.reason === "derive_under_specified" && r0.gate === "region");
  // Round 3: every bare stretch over an eighth of the region is asked about (15..40 at 27, 40..49 at 44).
  assert.deepEqual(r0.questions, [{ at: [27], answers: [false, true] }, { at: [44], answers: [false, true] }]);
  // A disagreeing input: the smallest fit says false at 27, the truth (an island 20..30) says true.
  assert.equal(truth([27]), true);
  // Two edges hide in 15..40: the asking loop bisects them (the region, then the no-fit edge questions).
  const done = askLoop(input, truth, 8);
  assert.ok(done.r.ok);
  assert.ok(grid.every((a) => evalProgram(done.r.ok ? done.r.fit.program : { op: "int", v: 0 }, a) === truth(a)), done.r.ok ? done.r.fit.expr : "");
  assert.equal(done.round, 7, done.asked.join(" ")); // round 3: one more (the region now asks every bare stretch over an eighth of it)
  assert.ok(done.asked.includes("derive_no_fit@20"));
});

test("unwitnessed cap: the span refusal asks past the shown stretch (both sides); one answer round derives min(1000, n * n)", () => {
  const truth = ([x]: readonly DeriveValue[]) => Math.min(1000, (x as number) * (x as number));
  const input: DeriveInput = { params: n, ret: "number", examples: [[-5], [0], [3], [24], [-1], [1], [2], [10]].map((a) => ({ args: a, out: truth(a) })) };
  const r0 = deriveProgram(input);
  assert.ok(!r0.ok && r0.gate === "span");
  // n * n there (9025, 5776) or a cap at the largest shown result (576): both fit every example.
  assert.deepEqual(r0.questions, [{ at: [95], answers: [576, 9025] }, { at: [-76], answers: [576, 5776] }]);
  const done = askLoop(input, truth, 2);
  assert.equal(done.round, 1);
  assert.ok(done.r.ok && grid.every((a) => evalProgram(done.r.fit.program, a) === truth(a)), done.r.ok ? done.r.fit.expr : "");
});

test("a cap inside the examples' box (the size + 2 rival min(3, a - b)): the corner refusal asks there first; the answers derive a - b", () => {
  // Passes every other witness gate (spans over 100, both result signs shown); `min(3, actual - reference)` also fits.
  // Round 3 (practice generator, cap_lin2 inside): the result-extremes check now refuses first, at the box corner
  // (100, -100) where a - b gives 200, past every shown result (largest 3); the other answer is a cap at 3. (Both
  // parameters are shown down to -100, as the round-3 sign check asks.) (The near
  // rival pass that found (3, -1) before is covered in m99-derive-gates.test.ts, through rivalProblem.)
  const ab = [{ name: "actual", type: "number" }, { name: "reference", type: "number" }] as DeriveParam[];
  const input: DeriveInput = { params: ab, ret: "number", examples: ex([[-100, -100, 0], [-1, 2, -3], [-100, 100, -200], [0, 0, 0], [0, 3, -3], [2, -1, 3], [3, 0, 3], [100, 100, 0], [100, 97, 3], [3, 100, -97], [50, 60, -10], [-1, -1, 0], [-100, -97, -3], [-97, -100, 3]]) };
  const r0 = deriveProgram(input);
  assert.ok(!r0.ok && r0.reason === "derive_under_specified" && r0.gate === "span", JSON.stringify(r0));
  assert.match(r0.detail!, /gives 200 at \(100, -100\), inside the examples' range of every parameter/);
  assert.deepEqual(r0.questions, [{ at: [100, -100], answers: [3, 200] }]);
  const done = askLoop(input, ([a, b]) => (a as number) - (b as number), 8);
  assert.ok(done.r.ok && done.r.fit.expr === "actual - reference", done.r.ok ? done.r.fit.expr : "");
  assert.ok(done.round <= 8, done.asked.join(" ")); // the corner and far-rival answers widen the box a few rounds
});

test("rival and no-fit refusals ask too; questions are bounded, deterministic and never at an example", () => {
  const sq: DeriveInput = { params: [{ name: "x", type: "number" }], ret: "number", examples: ex([[0, 0], [2, 4], [-2, 4]]) };
  const mul: DeriveNode = { op: "mul", a: { op: "param", i: 0 }, b: { op: "param", i: 0 } };
  const far = rivalProblem(sq, mul, 3)!;
  assert.equal(far.gate, "rival");
  const qs = deriveQuestions(sq, mul, [], far.rivals);
  assert.ok(qs.length >= 1 && qs.length <= DERIVE_MAX_QUESTIONS);
  assert.deepEqual(qs.find((q) => q.at[0] === 20), { at: [20], answers: [16, 400] });
  assert.deepEqual(deriveQuestions(sq, mul, [], far.rivals), qs, "deterministic");
  // At an example there is nothing to ask; one answer is no question.
  assert.deepEqual(deriveQuestions(sq, mul, [[2]], [{ at: [2], values: [4, 9] }, { at: [7], values: [49, 49] }]), []);
  // No fit: where the result changes between two examples more than 1 apart, ask in the middle.
  assert.deepEqual(edgeQuestions({ params: n, ret: "boolean", examples: ex([[0, false], [100, true], [101, true]]) }), [{ at: [50], answers: [false, true] }]);
  // Boolean witness gate: the other value (that input flipped fits every example).
  assert.deepEqual(deriveQuestions({ params: n, ret: "boolean", examples: ex([[0, false]]) }, { op: "le", a: { op: "param", i: 0 }, b: { op: "lit", v: 5 } }, [[3]]), [{ at: [3], answers: [false, true] }]);
});

test("the questions reach the refusal record and the issue comment in plain words; strings, bad names and tampered lines are dropped", () => {
  const PARAMS = Object.fromEntries(Object.entries(DERIVE_VOCAB).map(([k, v]) => [k, v[0]]));
  const rows = [[10, true], [9, true], [11, false], [0, true], [-100, true], [15, false], [40, false], [49, false], [50, true], [51, true], [150, true]];
  const body = `Add a new module \`src/in-band.ts\` exporting \`inBand(n: number): boolean\`.\n\nBehavior: true outside the quiet band, and in a short busy band inside it.\n\nExamples:\n${rows.map(([a, b]) => `- ${a} gives ${b}`).join("\n")}`;
  const why: { reason?: string; questions?: string } = {};
  const edit = runDeriveRule(DERIVE_TRIGGER, PARAMS, cleanIssueText({ title: "t", body } as never), [{ path: "src/host.ts", content: "export const x = 1;\n" }], undefined, why);
  assert.equal(edit, null);
  assert.equal(why.reason, "derive_under_specified_region: n");
  assert.equal(why.questions, "inBand(27)=false|true; inBand(44)=false|true");
  assert.ok(validQuestionLine(why.questions));
  const c = noCandidateComment(`public-derive-from-behavior-v1=${why.reason}`, why.questions);
  assert.match(c, /What should inBand\(27\) give\? One program that fits every example gives false, another gives true\./);
  assert.match(c, /adding the right result for each input below as a new example/);
  assert.doesNotMatch(c.replace(/`public-derive-from-behavior-v1=[^`]*`/, "").replace("`peaceai:failed`", ""), /`|=>|return|\bn \*|<=/, "no code in the question words");
  assert.match(questionWords("f(1,2)=3|4|5"), /What should f\(1, 2\) give\? Programs that fit every example give 3, 4 or 5\./);
  // Strings are never echoed; names off the allowlist and tampered lines drop the questions (the refusal stays).
  assert.equal(formatDeriveQuestions("f", [{ at: ["x y"], answers: [true, false] }, { at: [1], answers: ["a", "b"] }]), "");
  assert.equal(formatDeriveQuestions("AKIAQWERTY", [{ at: [1], answers: [true, false] }]), "");
  assert.equal(formatDeriveQuestions("f", Array.from({ length: 5 }, (_, k) => ({ at: [k], answers: [k, k + 1] }))).split("; ").length, 3);
  for (const bad of ["f(1)=2", "f(1)=x|y", "f(`id`)=1|2", "f(1)=1|2; ", "f(1)=1|2\nx", "F(1)=1|2", "f(1.5)=1|2"]) {
    assert.equal(validQuestionLine(bad), false, bad);
    assert.equal(noCandidateComment("x-v1=derive_no_fit", bad), noCandidateComment("x-v1=derive_no_fit"), bad);
  }
  // Wired: generate.ts writes rule_questions (only with a refusal line), the workflow passes it to the comment step.
  const gen = readFileSync(new URL("../bin/generate.ts", import.meta.url), "utf8");
  assert.match(gen, /writeOutput\(\{ rule_questions: refusalLine && validQuestionLine\(ruleQuestions\) \? ruleQuestions : "" \}\)/);
  const wf = readFileSync(new URL("../../.github/workflows/peace-task.yml", import.meta.url), "utf8");
  assert.match(wf, /rule_questions: \$\{\{ steps\.generate\.outputs\.rule_questions \}\}/);
  assert.match(wf, /RULE_QUESTIONS: \$\{\{ needs\.generate\.outputs\.rule_questions \}\}/);
  assert.match(readFileSync(new URL("../bin/no-candidate-comment.ts", import.meta.url), "utf8"), /noCandidateComment\(process\.env\.RULE_REFUSALS \?\? "", process\.env\.RULE_QUESTIONS \?\? ""\)/);
});
