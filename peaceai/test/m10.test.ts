// M10: plain-language task parsing. Fail closed, never widen scope, refusal text is fixed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  FAMILIES, MAX_PLAN_STEPS, PHRASINGS, features, isCanonical, loadModel, nlDecision, parseTask, readJsonl, refusalComment, trainNb, widens,
  type Label, type ParseResult,
} from "../lib/nlparse.ts";

const repo = join(import.meta.dirname, "../..");
const model = loadModel()!;
const none = new Set<string>();
const all = new Set(["SET_LITERAL", "ADD_SWITCH_CASE", "ADD_NULLISH_DEFAULT"]);
const parse = (body: string, kinds: ReadonlySet<string> = none): ParseResult => parseTask({ title: "", body }, { model, approvedKinds: kinds });

test("model.json loads, has every label, and only public-set vocabulary", () => {
  assert.ok(model, "model present");
  assert.deepEqual(model.labels, [...FAMILIES, "none"]);
  const pub = [...readJsonl(join(repo, "peaceai/nl/data/builder-train.jsonl")), ...Object.values(PHRASINGS).map((t) => ({ text: t.replace(/ \(learned rule.*\)$/, ""), label: "none" as Label }))];
  const allowed = new Set(pub.flatMap((e) => features(e.text)));
  for (const l of model.labels) for (const f of Object.keys(model.counts[l]!)) assert.ok(allowed.has(f), `feature outside the public set: ${f}`);
});

test("training is deterministic", () => {
  const ex = readJsonl(join(repo, "peaceai/nl/data/builder-train.jsonl")) as { text: string; label: Label }[];
  assert.equal(JSON.stringify(trainNb(ex)), JSON.stringify(trainNb(ex)));
});

test("features mask names, literals and paths", () => {
  const f = features('Add "secret-value" to MY_LIST in src/private/file.ts with 42').join(" ");
  assert.doesNotMatch(f, /secret|my_list|private|42/);
  assert.match(f, /strtok/); assert.match(f, /idtok/); assert.match(f, /pathtok/); assert.match(f, /numtok/);
});

test("plain wording parses into the canonical phrase", () => {
  const cases: [string, string][] = [
    ['Append "csv" to the EXPORT_KINDS list', 'Add "csv" to the array EXPORT_KINDS'],
    ["Make parseQuantity return 0 when raw is empty", "Add a guard to parseQuantity that returns 0 when raw is empty"],
    ["Catch any errors in parseJson and return null", "Wrap the body of parseJson in try/catch that returns null on error"],
    ["Give the type User an optional field nickname of type string", "Add an optional field nickname of type string to type User"],
  ];
  for (const [input, expect] of cases) {
    const r = parse(input);
    assert.equal(r.status, "parsed", input);
    if (r.status === "parsed") { assert.equal(r.objective, expect); assert.ok(isCanonical(r.objective)); }
  }
});

test("unsure means refuse: unsupported, unknown, empty, no model, ambiguous", () => {
  for (const t of ["Fix the flaky test in the scheduler", "Can you review my pull request", "Delete the unused helpers in utils", "Make it faster", "Refactor everything"]) {
    const r = parse(t);
    assert.equal(r.status, "unsure", t);
  }
  assert.deepEqual(parseTask({ title: "", body: "" }, { model, approvedKinds: none }), { status: "unsure", reason: "EMPTY", hint: null });
  const nm = parseTask({ title: "", body: 'Append "csv" to the EXPORT_KINDS list' }, { model: null, approvedKinds: none });
  assert.equal(nm.status, "unsure"); if (nm.status === "unsure") assert.equal(nm.reason, "NO_MODEL");
  const amb = parse('Add "critical" to Severity');
  assert.equal(amb.status, "unsure"); if (amb.status === "unsure") assert.equal(amb.reason, "AMBIGUOUS");
});

test("a parsed plan can't widen scope: every name, value and path comes from the task", () => {
  assert.equal(widens('Append "csv" to EXPORT_KINDS', 'Add "csv" to the array EXPORT_KINDS'), false);
  assert.equal(widens('Append "csv" to EXPORT_KINDS', 'Add "csv" to the array OTHER_LIST'), true);
  assert.equal(widens('Append "csv" to EXPORT_KINDS', 'Add "tsv" to the array EXPORT_KINDS'), true);
  assert.equal(widens("Add X to src/a.ts", "Add X to src/b.ts"), true);
  for (const file of ["builder-train.jsonl", "builder-heldout.jsonl"])
    for (const e of readJsonl(join(repo, "peaceai/nl/data", file), true)) {
      const r = parse(e.text, all);
      if (r.status === "parsed") assert.equal(widens(e.text, r.objective), false, e.text);
    }
  // A plan is one target per step, never more steps than the task's clauses, and capped.
  const many = Array.from({ length: MAX_PLAN_STEPS + 1 }, (_, i) => `- Add "v${i}" to the array LIST_${i}`).join("\n");
  const r = parse(many.replace(/Add "v(\d+)" to the array/g, 'Append "v$1" to'));
  assert.equal(r.status, "unsure");
});

test("multi-step: numbered or listed steps become a Step plan; one bad step refuses the whole plan", () => {
  const ok = parse('- Give the type Profile an optional field locale of type string\n- Give GUEST a key locale with value "en"\n- add a test');
  assert.equal(ok.status, "parsed");
  if (ok.status === "parsed") assert.equal(ok.objective, 'Step 1: Add an optional field locale of type string to type Profile\nStep 2: Add property locale with value "en" to object GUEST\nStep 3: add a test');
  const bad = parse('- Give GUEST a key locale with value "en"\n- Make the whole app faster');
  assert.equal(bad.status, "unsure"); if (bad.status === "unsure") assert.equal(bad.reason, "PARTIAL_PLAN");
  const onlyTest = parse("add a test");
  assert.equal(onlyTest.status, "unsure");
});

test("learned rules: refused until approved, and never inside a multi-step plan", () => {
  const r = parse('Change name in src/theme.ts to "classic"');
  assert.equal(r.status, "unsure"); if (r.status === "unsure") assert.equal(r.reason, "RULE_NOT_APPROVED");
  const plain = parse("Default opts.kinds to [] in listKinds");
  assert.equal(plain.status, "unsure"); if (plain.status === "unsure") assert.equal(plain.reason, "RULE_NOT_APPROVED");
  assert.equal(parse('Change name in src/theme.ts to "classic"', all).status, "canonical");
  const mixed = parse('- Give GUEST a key locale with value "en"\n- In listKinds, fall back opts.kinds to []', all);
  assert.equal(mixed.status, "unsure");
});

test("canonical wording passes through unchanged (no regression for existing tasks)", () => {
  for (const [f, p] of Object.entries(PHRASINGS)) {
    if (/learned rule/.test(p)) continue;
    const r = parse(p);
    assert.equal(r.status, "canonical", f);
  }
  assert.equal(parseTask({ title: "[test] Add a helper that will normalize a title in src/text.ts", body: "" }, { model, approvedKinds: none }).status, "canonical");
});

test("kill switch: PEACEAI_NL_PARSE=off leaves the task text alone", () => {
  assert.deepEqual(nlDecision({ title: "", body: "Make it faster" }, "off", none, model), { status: "off" });
  assert.equal(nlDecision({ title: "", body: "Make it faster" }, undefined, none, model).status, "unsure");
});

test("refusal comment: fixed text and the phrasing list only, never the task text", () => {
  const secret = "ZQX_PRIVATE_MARKER_991";
  const r = parse(`Please make ${secret} faster and nicer`);
  assert.equal(r.status, "unsure");
  if (r.status !== "unsure") return;
  const body = refusalComment(r.reason, r.hint);
  assert.doesNotMatch(body, new RegExp(secret));
  for (const p of Object.values(PHRASINGS)) assert.ok(body.includes(p));
  const script = join(repo, "peaceai/bin/nl-refusal.ts");
  const tsx = join(repo, "node_modules/.bin/tsx");
  const run = (reason: string, hint: string) => spawnSync(tsx, [script], { encoding: "utf8", env: { ...process.env, NL_REASON: reason, NL_HINT: hint, PEACEAI_BODY_FILE: "/tmp/m10-refusal-test.md" } });
  assert.equal(run("AMBIGUOUS", "union-member").status, 0);
  assert.notEqual(run("Add X to Y", "").status, 0, "free text is not a reason");
  assert.notEqual(run("AMBIGUOUS", "rm -rf /").status, 0, "free text is not a hint");
});

test("workflow: Job A parses before the gate; refusals post only the fixed comment", () => {
  const wf = readFileSync(join(repo, ".github/workflows/peace-task.yml"), "utf8");
  const gen = readFileSync(join(repo, "peaceai/bin/generate.ts"), "utf8");
  // The parse lives in generate.ts (Job A), before variants are built; the gate step still follows generation.
  assert.ok(gen.indexOf("nlDecision(") > 0 && gen.indexOf("nlDecision(") < gen.indexOf("buildVariants("));
  assert.ok(wf.indexOf("peaceai/bin/generate.ts") < wf.indexOf("peaceai/bin/gate.ts"));
  assert.match(wf, /PEACEAI_NL_PARSE: \$\{\{ vars\.PEACEAI_NL_PARSE \}\}/);
  // Only enums leave Job A, and the refusal comment comes from nl-refusal.ts (body file), not from task text.
  assert.match(wf, /nl_reason: \$\{\{ steps\.generate\.outputs\.nl_reason \}\}/);
  assert.match(wf, /nl-refusal\.ts\n {10}gh issue comment "\$ISSUE_NUMBER" --repo "\$GITHUB_REPOSITORY" --body-file "\$RUNNER_TEMP\/nl-refusal\.md"/);
  assert.doesNotMatch(wf, /nl_objective|outputs\.objective/);
});

test("held-out accuracy floor on the committed held-out set (no confident wrong parse)", () => {
  const r = spawnSync(join(repo, "node_modules/.bin/tsx"), [join(repo, "peaceai/bin/nl-eval.ts")], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  const m = /accuracy=([0-9.]+) wrong_parse=(\d+) refused=\d+ none_accepted=(\d+)/.exec(r.stdout)!;
  assert.ok(Number(m[1]) >= 0.9, r.stdout);
  assert.equal(m[2], "0"); assert.equal(m[3], "0");
});
