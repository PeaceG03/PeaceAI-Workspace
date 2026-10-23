// M99 DERIVE_FROM_BEHAVIOR (public-derive-from-behavior-v1): the issue states only the behavior of a new pure function
// (header, plain-prose Behavior paragraph, literal examples); PeaceAI derives the body with its own typed-DSL program
// search (peaceai/lib/derive.ts) and writes the test from the examples. Code in the behavior section is refused
// (anti-credit guard); two smallest programs that disagree on a boundary probe are refused (derive_ambiguous).
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { admitRules } from "../lib/approved.ts";
import { compileProgram, DERIVE_FORM_BAR, DERIVE_FORMS, DERIVE_MAX_EXAMPLES, DERIVE_MAX_EXPR_CHARS, DERIVE_MAX_STRING, deriveCandidate, deriveProgram, derivedExprProblem, evidenceFormCounts, evidenceTernaryShapeCounts, formsOf, ternaryShapesOf, unevidencedForms, type DeriveForm, edgeConstants, evalProgram, probeSet, repeatedResults, type DeriveNode, type DeriveType } from "../lib/derive.ts";
import { applyRule, specHash, validateSpec, type RuleSpec } from "../lib/learned.ts";
import { behaviorCodeProblem, buildDeriveEdit, DERIVE_TRIGGER, DERIVE_VOCAB, derivedModuleProblem, parseDeriveTask, rawIssueProblem } from "../lib/learned-derive.ts";
import { callsFunction, stubFunction } from "../lib/learned-function.ts";
import { LEARNED_CANONICAL } from "../lib/nlparse.ts";
import { readManifestBytes } from "../lib/manifestparts.ts";
import { phrasingFor } from "../lib/propose.ts";
import { PROTECTED_SELF } from "../lib/selfchange.ts";
import { cleanIssueText } from "../lib/taskmap.ts";
import ts from "typescript";

const root = resolve(import.meta.dirname, "../..");
const read = (p: string) => readFileSync(resolve(root, p), "utf8");
const SPEC = JSON.parse(read("peaceai/rules/learned/public-derive-from-behavior-v1.json")) as RuleSpec;
const SHA = "317913d44290b8ebf635a212055157e8498545fd90a12ee1d48785d1f3a601e7"; // M104: learned spec evidence counts re-pinned (if-form entries added); the spec's rule fields are unchanged
const FILES = [{ path: "src/host.ts", content: "export const x = 1;\n" }, { path: "src/host.test.ts", content: 'import { x } from "./host.ts";\n' }];
const S1 = `Add a new module \`src/r2-retry-status.ts\` exporting \`isRetryableR2Status(status: number): boolean\`.

Behavior: given the HTTP status code of a reply from R2, answer true when the request is worth retrying and false when it is not. Worth retrying: 429 (too many requests) and every server error status from 500 through 599. Not worth retrying: everything else, including success, redirect and other client error statuses, and anything above 599.

Examples:
${[[429, true], [500, true], [502, true], [503, true], [504, true], [550, true], [510, true], [520, true], [530, true], [540, true], [560, true], [570, true], [580, true], [590, true], [438, false], [446, false], [454, false], [462, false], [470, false], [478, false], [486, false], [494, false], [599, true], [428, false], [430, false], [499, false], [465, false], [600, false], [700, false], [200, false], [204, false], [100, false], [301, false], [400, false], [403, false], [404, false], [0, false]].map(([a, b]) => `- ${a} gives ${b}`).join("\n")}

Context: this is the status check a future retry will use. PeaceAI has to work out the implementation itself.`;
const S2 = `Add a new module \`src/r2-retry-delay.ts\` exporting \`r2RetryDelayMs(attempt: number, baseMs: number): number\`.

Behavior: how many milliseconds to wait before retry number \`attempt\` (counting from 0), given a base wait of \`baseMs\`. Attempt 0 waits exactly the base. Each later attempt waits longer than the one before, following the pattern in the examples. The wait is never more than 30000 ms, whatever the attempt or base. A base of 0 always gives 0.

Examples (attempt, baseMs gives wait):
${[[0, 1000, 1000], [1, 1000, 4000], [2, 1000, 9000], [3, 1000, 16000], [4, 1000, 25000], [5, 1000, 30000], [10, 1000, 30000], [100, 1000, 30000], [0, 500, 500], [1, 500, 2000], [2, 250, 2250], [0, 0, 0], [7, 0, 0], [0, 40000, 30000]].map(([a, b, c]) => `- ${a}, ${b} gives ${c}`).join("\n")}`;
const S3 = `Add a new module \`src/host-failure-line.ts\` exporting \`hostFailureLine(message: string, causeCode: string): string\`.

Behavior: build the one-line failure report the scheduler host prints. The line always starts with the marker MARKETS_SCHEDULER_HOST_FAILED, then a colon, then the message exactly as given. When a cause code is given, the line ends with a colon, the word cause, an equals sign and the cause code. When the cause code is empty, nothing is added after the message.

Examples (message, causeCode gives line):
- "fetch failed", "ECONNRESET" gives "MARKETS_SCHEDULER_HOST_FAILED:fetch failed:cause=ECONNRESET"
- "fetch failed", "" gives "MARKETS_SCHEDULER_HOST_FAILED:fetch failed"
- "R2_GET_500", "" gives "MARKETS_SCHEDULER_HOST_FAILED:R2_GET_500"
- "", "UND_ERR_SOCKET" gives "MARKETS_SCHEDULER_HOST_FAILED::cause=UND_ERR_SOCKET"
- "", "" gives "MARKETS_SCHEDULER_HOST_FAILED:"
- "R2_PUT_500", "ETIMEDOUT" gives "MARKETS_SCHEDULER_HOST_FAILED:R2_PUT_500:cause=ETIMEDOUT"
- " fetch failed ", "ECONNRESET" gives "MARKETS_SCHEDULER_HOST_FAILED: fetch failed :cause=ECONNRESET"
- "R2_GET_500", " err 42 " gives "MARKETS_SCHEDULER_HOST_FAILED:R2_GET_500:cause= err 42 "`;
const clean = (body: string, title = "derive task") => cleanIssueText({ title, body } as never);
// The search and witness gates alone (no form gate): what the engine would fit, for refused tasks.
const cand = (body: string) => { const p = parseDeriveTask(DERIVE_TRIGGER, clean(body)); assert.ok("task" in p); return deriveCandidate({ params: p.task.params, ret: p.task.ret, examples: p.task.examples }); };
const run = (body: string) => { const why: { reason?: string } = {}; const e = applyRule(SPEC, clean(body), FILES, (p) => /\.test\.ts$/.test(p), undefined, why); return { e, why: why.reason }; };

test("spec: valid, hash pinned, kind wired; any approved.json entry pins the exact hash; protected paths", () => {
  assert.ok(validateSpec(SPEC));
  assert.equal(specHash(SPEC), SHA);
  assert.equal(SPEC.kind, "DERIVE_FROM_BEHAVIOR");
  assert.equal(SPEC.trigger, DERIVE_TRIGGER);
  assert.deepEqual(SPEC.params, Object.fromEntries(Object.entries(DERIVE_VOCAB).map(([k, v]) => [k, v[0]])));
  assert.ok(!validateSpec({ ...SPEC, params: { ...SPEC.params, ambiguity: "pick-first" } }), "ambiguity is refuse only");
  assert.ok(!validateSpec({ ...SPEC, minedFrom: "core", id: "core-derive-from-behavior-v1" }));
  // Lesson (M85+): never assert the rule is absent from approved.json; any listed entry must pin this exact hash.
  const onMain = JSON.parse(read("peaceai/rules/approved.json")) as { rules: { id: string; sha256: string }[] };
  for (const r of onMain.rules.filter((x) => x.id === SPEC.id)) assert.equal(r.sha256, SHA, "a listed entry pins the exact spec hash");
  const list = (sha: string) => ({ ok: true as const, list: { schema: "peaceai-approved-rules:v1", rules: [{ id: SPEC.id, sha256: sha, source: "workspace" }] } as never });
  assert.equal(admitRules([SPEC], list(SHA))[0]!.decision, "APPROVED");
  assert.equal(admitRules([SPEC], list("0".repeat(64)))[0]!.decision, "HASH_CHANGED");
  assert.match(phrasingFor(SPEC), /Behavior:/);
  assert.equal(LEARNED_CANONICAL.deriveFromBehavior.kind, "DERIVE_FROM_BEHAVIOR");
  for (const p of ["peaceai/lib/derive.ts", "peaceai/lib/learned-derive.ts", "peaceai/spec/derive-from-behavior-v1.md", "peaceai/test/m99-derive-from-behavior.test.ts", "peaceai/test/fixtures/m99-dfb/x.txt", "peaceai/rules/proposals/m99-derive-from-behavior-evidence.json", "peaceai/rules/learned/public-derive-from-behavior-v1.json", "peaceai/rules/proposals/public-derive-from-behavior-v1.json", "peaceai/bin/test-candidates.ts", "peaceai/lib/learned.ts", "peaceai/test/m99-derive-mistakes.json", "peaceai/test/m99-derive-mistakes.test.ts"]) assert.ok(PROTECTED_SELF.some((x) => x.pattern.test(p)), p);
});

test("S1-S3 (scanner refile): S1 and S2 derive; S3 refuses honestly (its ternary sub-shape has fewer than 10 distinct upstream entries, Auditor #498)", () => {
  // Auditor ruling on 6f1ea5e: no program using a form with fewer than DERIVE_FORM_BAR replaying upstream evidence
  // entries is emitted. Round 4 mining brought eq to >= 10 entries, so S1 (eq, ||, range) derives; S3 needs a general
  // if (ternary). M104 mined 12 upstream if entries, but the Auditor #498 ruling counts distinct problems per sub-shape:
  // S3's if is eq-const/string (a parameter === a constant choosing a string), which has 4 distinct entries (identical
  // examples once, at most 2 per expression shape), under the bar, so S3 is still refused by name.
  const r1 = run(S1), r3 = run(S3);
  assert.equal(r1.why ?? null, null);
  assert.match(r1.e!.content, /return \(status === 429\) \|\| \(500 <= status && status <= 599\);/);
  assert.equal(r3.e, null);
  assert.equal(r3.why, "derive_unevidenced_form: ternary");
  // The search and the witness gates alone still find the programs (so the refusal is the form gate, nothing else).
  const c1 = cand(S1), c3 = cand(S3);
  assert.ok(c1.ok && c3.ok);
  assert.equal(c1.ok && c1.fit.expr, "(status === 429) || (500 <= status && status <= 599)");
  assert.deepEqual(c1.ok && formsOf(c1.fit.program), ["eq", "or", "range"]);
  assert.equal(c3.ok && c3.fit.expr, '"MARKETS_SCHEDULER_HOST_FAILED:" + (message + (((causeCode === "") ? causeCode : ":cause=") + causeCode))');
  assert.deepEqual(c3.ok && formsOf(c3.fit.program), ["ternary", "strcat", "eq"]);
  assert.deepEqual(c3.ok && ternaryShapesOf(c3.fit.program, ["string", "string"]), ["eq-const/string"]);
  assert.deepEqual(c3.ok && unevidencedForms(c3.fit.program, undefined, ["string", "string"]), ["ternary"]);
  // With 10 distinct eq-const/string entries it would be emitted (the sub-shape gate, not the search, refuses it).
  assert.deepEqual(c3.ok && unevidencedForms(c3.fit.program, undefined, ["string", "string"], { "eq-const/string": DERIVE_FORM_BAR }), []);
  const s2 = run(S2).e!;
  assert.equal(s2.path, "src/r2-retry-delay.ts");
  assert.equal(s2.content, "export function r2RetryDelayMs(attempt: number, baseMs: number): number {\n  return (baseMs * ((attempt + 1) * (attempt + 1))) <= 30000 ? (baseMs * ((attempt + 1) * (attempt + 1))) : 30000;\n}\n");
  assert.match(s2.extra![0]!.path, /^src\/r2-retry-delay\.r2-retry-delay-ms-[0-9a-f]{7}\.test\.ts$/);
  // The test is exactly the issue's examples: one assertion per example, nothing else.
  assert.equal((s2.extra![0]!.content.match(/assert\.equal\(/g) ?? []).length, 14);
  for (const e of [s2]) {
    assert.equal(e.create, true);
    assert.equal(e.selfGrade, true);
    assert.equal(e.extra!.length, 1);
    assert.equal(derivedModuleProblem(e.content), null);
    const fn = /export function (\w+)/.exec(e.content)![1]!;
    assert.ok(callsFunction(e.extra![0]!.content, fn));
    assert.notEqual(stubFunction(e.content, fn), null, "Job B can stub it");
    assert.doesNotMatch(e.content, /Math|globalThis|process|Date|\[|\.\w/, "no globals or member access");
  }
});

test("generated module + test pass under TZ=UTC, America/Denver and Asia/Tokyo with an empty env, and fail on a stub", () => {
  const tsx = resolve(root, "node_modules/tsx/dist/cli.mjs");
  for (const body of [S2]) { // S1 is checked above; S3 refuses (form gate): no edit to run
    const e = run(body).e!;
    const dir = mkdtempSync(join(tmpdir(), "m99-"));
    try {
      writeFileSync(join(dir, e.path.slice(4)), e.content);
      const t = join(dir, e.extra![0]!.path.slice(4));
      writeFileSync(t, e.extra![0]!.content);
      for (const tz of ["UTC", "America/Denver", "Asia/Tokyo"]) {
        const r = spawnSync(process.execPath, [tsx, "--test", t], { env: { TZ: tz }, encoding: "utf8", cwd: dir });
        assert.equal(r.status, 0, `${e.path} ${tz}: ${r.stdout}${r.stderr}`);
      }
      const fn = /export function (\w+)/.exec(e.content)![1]!;
      writeFileSync(join(dir, e.path.slice(4)), stubFunction(e.content, fn)!);
      assert.notEqual(spawnSync(process.execPath, [tsx, "--test", t], { env: { TZ: "UTC" }, encoding: "utf8", cwd: dir }).status, 0, `${e.path} stub fails`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

test("AMBIGUOUS: two minimal programs that agree on the examples but not on a probe are refused", () => {
  // x * x and x + x agree on 0 and 2, not on 1 or 3.
  const sq = deriveProgram({ params: [{ name: "x", type: "number" }], ret: "number", examples: [{ args: [0], out: 0 }, { args: [2], out: 4 }, { args: [-2], out: 4 }] });
  // With -2 only, x * x is a smallest fit, but the examples show x over 4 values only (gate span, Auditor #491 round 2:
  // a cap inside that stretch would not show); one example 100 past the others settles it.
  assert.equal(!sq.ok && `${sq.reason}/${sq.gate}`, "derive_under_specified/span");
  const sq20 = deriveProgram({ params: [{ name: "x", type: "number" }], ret: "number", examples: [{ args: [0], out: 0 }, { args: [2], out: 4 }, { args: [-2], out: 4 }, { args: [100], out: 10000 }, { args: [-101], out: 10201 }] });
  assert.equal(sq20.ok && sq20.fit.expr, "x * x", "with -2, 100 and -101 only x * x fits"); // round 3: x shown negative needs -100 or below (gate span, sign)
  // w * w and h * h agree on squares (1,1) (2,2) (3,3), not on (1,2).
  const r = deriveProgram({ params: [{ name: "w", type: "number" }, { name: "h", type: "number" }], ret: "number", examples: [{ args: [1, 1], out: 1 }, { args: [2, 2], out: 4 }, { args: [3, 3], out: 9 }] });
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.reason, "derive_ambiguous");
    const [a, b] = r.alternatives!;
    assert.ok(a && b && r.probe);
    assert.notEqual(evalProgram(a.program, r.probe!), evalProgram(b.program, r.probe!), "they disagree on the named probe");
  }
  // Through the rule: refused by name, no candidate.
  const body = "Add a new module src/area.ts exporting area(w: number, h: number): number.\n\nBehavior: the area of the tile, in square units.\n\nExamples:\n- 1, 1 gives 1\n- 2, 2 gives 4\n- 3, 3 gives 9\n";
  assert.deepEqual(run(body), { e: null, why: "derive_ambiguous" });
});

test("anti-credit guard: code or expressions in the behavior section are refused; prose is fine", () => {
  const withBehavior = (b: string) => S1.replace(/Behavior: [^\n]*/, `Behavior: ${b}`);
  for (const b of ["true when status >= 500 and status <= 599 or status === 429.", "use status == 429 || (500 <= status && status <= 599)", "answer Math.min(status, 599) equal to the status for server errors only.", "the result of isServer(status) for this status.", "true when status.valueOf() is a server error.", "true for 500-599 and 429.", "true for the values from a - b onward.", "return true for 429 and for server errors.", "true when the text is 'retry' for this status.", "true for 429; false otherwise.", "use the ternary on status for server errors.", "true when the status is in [500, 599] or 429."]) {
    assert.equal(run(withBehavior(b)).why, "derive_behavior_code", b);
  }
  assert.equal(behaviorCodeProblem("true for 429 and for every status from 500 through 599, false for anything else, including 0."), null);
  assert.equal(behaviorCodeProblem("the line ends with a colon, the word cause, an equals sign and the cause code."), null);
  // Any other line with a strong code marker is refused too, and so is a raw body with a fence or an HTML comment.
  assert.equal(run(`${S1}\n\nHint: status => status === 429 works.`).why, "derive_behavior_code");
  assert.equal(rawIssueProblem(`${S1}\n\n\`\`\`ts\nreturn status === 429;\n\`\`\`\n`), "derive_behavior_code");
  assert.equal(rawIssueProblem(`${S1}\n<!-- return status === 429 -->\n`), "derive_behavior_code");
  assert.equal(rawIssueProblem(`${S1}\n\n    return status === 429;\n`), "derive_behavior_code");
  assert.equal(rawIssueProblem(S1), null);
});

test("parse refusals: sections, signature, examples; no fit; path rules", () => {
  assert.equal(run(S1.replace("Behavior: ", "About: ")).why, "derive_sections");
  assert.equal(run(S1.replace("Examples:", "Cases:")).why, "derive_sections");
  assert.equal(run(S1.replace("- 0 gives false", "- 0 gives false\n- 0 gives true")).why, "derive_examples");
  assert.equal(run(S1.replace("- 0 gives false", "- 0, 1 gives false")).why, "derive_examples");
  assert.equal(run(S1.replace("- 0 gives false", "- status gives false")).why, "derive_examples");
  assert.equal(run(S1.replace("- 0 gives false", "- 1.5 gives false")).why, "derive_examples");
  assert.equal(run(S1.replace("- 0 gives false", '- "0" gives false')).why, "derive_examples");
  assert.equal(run(S1.replace("isRetryableR2Status(status: number)", "isRetryableR2Status(constructor: number)")).why, "derive_signature");
  // string length is outside the DSL: no fit (or ambiguous lookup tables), never a guess.
  const len = 'Add a new module src/len.ts exporting width(s: string): number.\n\nBehavior: how many characters the text has, counting every character.\n\nExamples:\n- "a" gives 1\n- "bb" gives 2\n- "ccc" gives 3\n- "dddd" gives 4\n- "" gives 0\n- "eeeeeeee" gives 8\n';
  assert.match(run(len).why ?? "", /^derive_(no_fit|ambiguous|budget)$/);
  // Path rules (same as the ADD_FUNCTION new module): protected or sibling-less directories are refused.
  assert.equal(run(S1.replace("src/r2-retry-status.ts", "src/approval-check.ts")).why, "derive_path");
  assert.equal(run(S1.replace("src/r2-retry-status.ts", "src/deep/new/x.ts")).why, "derive_path");
  assert.equal(run(S1.replace("src/r2-retry-status.ts", "src/host.ts")).why, "derive_module_exists");
  assert.equal(parseDeriveTask(DERIVE_TRIGGER, clean("Add function f(a: number): number to src/a.ts returning a + 1.")).hasOwnProperty("reason"), true);
});

test("derived expressions: compile to the whitelist only; derivedModuleProblem refuses anything else", () => {
  const P = ["a", "s"];
  assert.equal(derivedExprProblem("(a + 1) * a <= 30 ? a : 30", P), null);
  for (const bad of ["Math.max(a, 1)", "a.length", "s[0]", "s['constructor']", "globalThis", "a / 2", "a % 2", "`${s}`", "eval(s)", "(() => a)()", "1 + 2", "b + 1", "a > 1", "s.constructor"]) assert.notEqual(derivedExprProblem(bad, P), null, bad);
  assert.equal(derivedModuleProblem("export function f(a: number): number {\n  return a + 1;\n}\n"), null);
  for (const bad of ["export function f(a: number): number {\n  return Math.abs(a);\n}\n", "export function f(a: number): number {\n  const b = a;\n  return b;\n}\n", "export function f(a: number[]): number {\n  return a + 1;\n}\n", "export function f(a: number): number {\n  return a + 1;\n}\nexport const g = 1;\n", "export async function f(a: number): number {\n  return a + 1;\n}\n", "export function f(a = 1): number {\n  return a + 1;\n}\n"]) assert.notEqual(derivedModuleProblem(bad), null, bad);
  // Every node kind compiles to something the whitelist accepts.
  const nodes: DeriveNode[] = [
    { op: "min", c: 3, a: { op: "param", i: 0 } }, { op: "max", c: -3, a: { op: "sq", a: { op: "param", i: 0 } } },
    { op: "if", c: { op: "empty", i: 1 }, t: { op: "lit", v: "x" }, e: { op: "cat", a: { op: "param", i: 1 }, b: { op: "lit", v: ":" } } },
    { op: "not", a: { op: "range", i: 0, lo: -5, hi: 5 } }, { op: "or", a: { op: "eq", a: { op: "param", i: 0 }, b: { op: "lit", v: 4 } }, b: { op: "le", a: { op: "lit", v: 9 }, b: { op: "param", i: 0 } } },
  ];
  for (const n of nodes) assert.equal(derivedExprProblem(compileProgram(n, P), P), null, compileProgram(n, P));
});

test("probes and constants: deterministic, from the examples only (edges and repeated results)", () => {
  const params = [{ name: "n", type: "number" as const }];
  const ex = [{ args: [5], out: true }, { args: [6], out: false }];
  assert.deepEqual(probeSet(params, ex), probeSet(params, ex));
  assert.ok(!probeSet(params, ex).some((p) => p[0] === 5 || p[0] === 6));
  const t1 = parseDeriveTask(DERIVE_TRIGGER, clean(S1)), t2 = parseDeriveTask(DERIVE_TRIGGER, clean(S2));
  assert.ok("task" in t1 && "task" in t2);
  if ("task" in t1) assert.deepEqual(edgeConstants(t1.task.params, t1.task.examples), [428, 429, 430, 499, 500, 599, 600]);
  if ("task" in t2) {
    assert.deepEqual(edgeConstants(t2.task.params, t2.task.examples), [0, 1, 2, 3, 4, 5]);
    assert.deepEqual(repeatedResults(t2.task.examples), [0, 30000], "30000 is a cap because three examples hit it, not because the prose says it");
  }
});

test("the examples alone determine the program: the behavior prose only has to be prose (module, name and signature come from the header)", () => {
  const withBehavior = (body: string, b: string) => body.replace(/Behavior: [^\n]*/, `Behavior: ${b}`);
  const proses = [
    "Follow the examples below, case by case, and nothing else.",
    "True from 400 through 450 and for 777, false for 12 and 13, the wait is never more than 99 ms and the line starts with OTHER_MARKER.",
    "An unrelated paragraph about weather, tides and the number 30000, mentioned only to show it is ignored.",
  ];
  for (const body of [S1, S2, S3]) {
    const base = run(body); // S2: the edit; S1, S3: the same named refusal (form gate) whatever the prose says
    for (const b of proses) assert.deepEqual(run(withBehavior(body, b)), base, `${b} changed the result`);
    for (const b of proses) assert.deepEqual(cand(withBehavior(body, b)), cand(body), `${b} changed the fit`);
    // The parsed behavior is carried for the guard only: the build ignores it entirely.
    const t = parseDeriveTask(DERIVE_TRIGGER, clean(body));
    assert.ok("task" in t);
    if ("task" in t) assert.deepEqual(buildDeriveEdit(SPEC.params, { ...t.task, behavior: "" }, FILES), buildDeriveEdit(SPEC.params, t.task, FILES));
  }
  // Change one example and the program follows the examples (not the prose, which still says 599).
  // (S1 itself is refused by the form gate, so the fit is read from the search; the S2 variant goes through the rule.)
  const moved = cand(S1.replace("- 599 gives true", "- 598 gives true").replace("- 600 gives false", "- 599 gives false\n- 600 gives false"));
  assert.equal(moved.ok && moved.fit.expr, "(status === 429) || (500 <= status && status <= 598)");
  // The header picks the module, name and signature; renaming them renames only those.
  const renamed = run(S2.replace("src/r2-retry-delay.ts", "src/delay-ok.ts").replace("r2RetryDelayMs(attempt: number, baseMs: number)", "delayOk(k: number, base: number)")).e!;
  assert.equal(renamed.path, "src/delay-ok.ts");
  assert.equal(renamed.content, "export function delayOk(k: number, base: number): number {\n  return (base * ((k + 1) * (k + 1))) <= 30000 ? (base * ((k + 1) * (k + 1))) : 30000;\n}\n");
});

test("no memorizing: strings are only tested for emptiness; an integer is compared only where the examples show an edge", () => {
  const p = [{ name: "name", type: "string" as const }];
  const ex = [{ args: ["write_file"], out: true }, { args: ["edit"], out: true }, { args: ["patch"], out: true }, { args: ["read_file"], out: false }];
  // The only fits are lookup tables of the example inputs: refused, never a guess.
  assert.equal(deriveProgram({ params: p, ret: "boolean", examples: ex }).ok, false);
  assert.equal(derivedExprProblem('!(name === "read_file")', ["name"]), "derive_expr_memorize");
  assert.equal(derivedExprProblem('(("read_file") === name)', ["name"]), "derive_expr_memorize");
  assert.equal(derivedExprProblem('!(name === "")', ["name"]), null);
  // Numbers: a threshold with no witnessed edge (no v / v + 1 pair with different results) is not invented.
  const n = [{ name: "n", type: "number" as const }];
  const nx = [{ args: [10], out: true }, { args: [11], out: true }, { args: [3], out: false }];
  assert.equal(deriveProgram({ params: n, ret: "boolean", examples: nx }).ok, false);
  // The edge alone is not enough: what happens far past it (gate far) must be shown too.
  const near = deriveProgram({ params: n, ret: "boolean", examples: [...nx, { args: [9], out: false }] });
  assert.equal(!near.ok && `${near.reason}/${near.gate}/${near.param}`, "derive_under_specified/far/n");
  const ten = deriveProgram({ params: n, ret: "boolean", examples: [...nx, { args: [9], out: false }, { args: [110], out: true }, { args: [-90], out: false }] });
  assert.equal(ten.ok && ten.fit.expr, "10 <= n");
  // Through the rule, prose that names the threshold does not help: only the examples can.
  const body = (exs: string) => `Add a new module src/big.ts exporting isBig(n: number): boolean.\n\nBehavior: true from 10 upward, false below 10.\n\nExamples:\n${exs}`;
  assert.equal(run(body("- 10 gives true\n- 11 gives true\n- 3 gives false\n")).why, "derive_no_fit");
  assert.equal(run(body("- 10 gives true\n- 11 gives true\n- 3 gives false\n- 9 gives false\n")).why, "derive_under_specified_far: n");
  assert.match(run(body("- 10 gives true\n- 11 gives true\n- 3 gives false\n- 9 gives false\n- 110 gives true\n- -90 gives false\n")).e!.content, /return 10 <= n;/);
});

test("fail closed: a competing fit one node larger is AMBIGUOUS; constant programs never fit; one-result examples refused", () => {
  const s1 = [{ name: "s", type: "string" as const }];
  // Every example false: "s is empty" would fit, but the examples show no behavior.
  const allFalse = deriveProgram({ params: s1, ret: "boolean", examples: [{ args: ["a"], out: false }, { args: ["b"], out: false }, { args: ["c"], out: false }] });
  assert.equal(!allFalse.ok && allFalse.reason, "derive_examples");
  assert.equal(!allFalse.ok && allFalse.detail, "one_result");
  // p && !p reads p only syntactically: never a fit (it was the smallest "fit" of a constant-false column).
  const n2 = [{ name: "a", type: "number" as const }, { name: "b", type: "number" as const }];
  const r = deriveProgram({ params: n2, ret: "number", examples: [{ args: [1, 1], out: 2 }, { args: [2, 2], out: 4 }, { args: [3, 3], out: 6 }] });
  // a + b (size 3) vs a + a / b + b / 2 * a ... all fit and differ on (1, 2): refused, not the first one built.
  assert.equal(!r.ok && r.reason, "derive_ambiguous");
  assert.ok(!r.ok && (r.alternatives?.length ?? 0) >= 2);
  // Slack: (x + 1) squared is the only size-4 fit, but its square (size 5) also fits and differs on a probe.
  const x1 = [{ name: "x", type: "number" as const }];
  const ex = [{ args: [-2], out: 1 }, { args: [-1], out: 0 }, { args: [0], out: 1 }];
  const tight = deriveProgram({ params: x1, ret: "number", examples: ex, slack: 0 });
  // Slack 0 keeps only the size-4 fit; the examples still have to show x over DERIVE_FAR (gate span).
  assert.equal(!tight.ok && `${tight.reason}/${tight.gate}`, "derive_under_specified/span");
  const tight2 = deriveProgram({ params: x1, ret: "number", examples: [...ex, { args: [1], out: 4 }, { args: [98], out: 9801 }, { args: [-101], out: 10000 }], slack: 0 }); // round 3: -101 (gate span, sign)
  assert.equal(tight2.ok && tight2.fit.expr, "(x + 1) * (x + 1)");
  const dflt = deriveProgram({ params: x1, ret: "number", examples: ex });
  assert.equal(!dflt.ok && dflt.reason, "derive_ambiguous");
  assert.deepEqual(!dflt.ok && dflt.alternatives!.map((f) => f.size), [4, 5]);
});

// Strict allowlist (Auditor, #489 review): an independent walk of EVERY AST node. Allowed: the function's own
// parameters, fresh integer / bounded plain string / boolean literals, parentheses, ! and unary minus on a number,
// + - * === <= && || and ?:. No global is used at all (so none of the #489 pure-global list is even needed), and no
// regex, member / element access, call, new, template, assignment, spread, arrow or any other node; bounded size.
const ALLOW_KINDS = new Set([ts.SyntaxKind.SourceFile, ts.SyntaxKind.ExpressionStatement, ts.SyntaxKind.EndOfFileToken, ts.SyntaxKind.ParenthesizedExpression, ts.SyntaxKind.Identifier, ts.SyntaxKind.NumericLiteral, ts.SyntaxKind.StringLiteral, ts.SyntaxKind.TrueKeyword, ts.SyntaxKind.FalseKeyword, ts.SyntaxKind.PrefixUnaryExpression, ts.SyntaxKind.BinaryExpression, ts.SyntaxKind.ConditionalExpression, ts.SyntaxKind.QuestionToken, ts.SyntaxKind.ColonToken, ts.SyntaxKind.PlusToken, ts.SyntaxKind.MinusToken, ts.SyntaxKind.AsteriskToken, ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.LessThanEqualsToken, ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken]);
function strictAllowlist(text: string, params: readonly string[]): string | null {
  if (text.length > DERIVE_MAX_EXPR_CHARS) return "size";
  const sf = ts.createSourceFile("s.ts", `(${text});`, ts.ScriptTarget.Latest, true);
  if ((sf as unknown as { parseDiagnostics: unknown[] }).parseDiagnostics.length || sf.statements.length !== 1) return "parse";
  let bad: string | null = null;
  const walk = (n: ts.Node): void => {
    if (bad) return;
    if (!ALLOW_KINDS.has(n.kind)) { bad = ts.SyntaxKind[n.kind]!; return; }
    if (ts.isIdentifier(n) && !params.includes(n.text)) bad = `name:${n.text}`;
    if (ts.isNumericLiteral(n) && !/^\d{1,13}$/.test(n.text)) bad = "number";
    if (ts.isStringLiteral(n) && (n.text.length > DERIVE_MAX_STRING || /[\\\u0000-\u001f\u007f]/.test(n.text))) bad = "string";
    if (ts.isPrefixUnaryExpression(n) && !(n.operator === ts.SyntaxKind.ExclamationToken || (n.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(n.operand)))) bad = "prefix";
    ts.forEachChild(n, walk);
  };
  walk(sf);
  return bad;
}

test("strict allowlist: every compiled DSL program (over 10000: all small programs, 3000 seeded random ones, S1-S3, evidence) passes it", () => {
  const P = ["a", "b", "s", "t", "f"]; // number, number, string, string, boolean
  const num: DeriveNode[][] = [[], [{ op: "param", i: 0 }, { op: "param", i: 1 }, { op: "int", v: 1 }, { op: "int", v: 2 }, { op: "lit", v: -7 }, { op: "lit", v: 30000 }]];
  const str: DeriveNode[][] = [[], [{ op: "param", i: 2 }, { op: "param", i: 3 }, { op: "lit", v: "" }, { op: "lit", v: "x:" }, { op: "lit", v: "__proto__" }, { op: "lit", v: "constructor" }, { op: "lit", v: "/a+/g" }, { op: "lit", v: "x".repeat(DERIVE_MAX_STRING) }]];
  const bool: DeriveNode[][] = [[], [{ op: "param", i: 4 }]];
  for (let size = 2; size <= 5; size++) {
    num[size] = []; str[size] = []; bool[size] = [];
    if (size === 2) bool[2]!.push({ op: "empty", i: 2 }, { op: "empty", i: 3 });
    if (size === 3) for (const c of [-1, 0, 599]) bool[3]!.push({ op: "eq", a: { op: "param", i: 0 }, b: { op: "lit", v: c } }, { op: "le", a: { op: "lit", v: c }, b: { op: "param", i: 1 } });
    if (size === 4) bool[4]!.push({ op: "range", i: 0, lo: -5, hi: 599 });
    for (const a of num[size - 1]!) num[size]!.push({ op: "sq", a });
    for (const a of bool[size - 1]!) bool[size]!.push({ op: "not", a });
    if (size >= 3) for (const a of num[size - 2]!) num[size]!.push({ op: "min", c: 30000, a }, { op: "max", c: -3, a });
    for (let la = 1; la <= size - 2; la++) {
      const lb = size - 1 - la;
      for (const a of num[la]!) for (const b of num[lb]!) for (const op of ["add", "sub", "mul"] as const) num[size]!.push({ op, a, b });
      for (const a of str[la]!) for (const b of str[lb]!) str[size]!.push({ op: "cat", a, b });
      for (const a of bool[la]!) for (const b of bool[lb]!) for (const op of ["and", "or"] as const) bool[size]!.push({ op, a, b });
    }
    for (let lt = 1; lt <= size - 3; lt++) { const le = size - 2 - lt; if (le < 1) continue; for (const g of [{ op: "empty", i: 2 } as DeriveNode]) for (const [x, y] of [[num, num], [str, str]] as const) for (const t of x[lt]!) for (const e of y[le]!) (x === num ? num : str)[size]!.push({ op: "if", c: g, t, e }); }
  }
  let rnd = 99991;
  const R = (n: number) => { rnd = (rnd * 48271) % 2147483647; return rnd % n; };
  const gen = (ty: "n" | "s" | "b", budget: number): DeriveNode => {
    const leaf = (): DeriveNode => (ty === "n" ? num[1]![R(num[1]!.length)]! : ty === "s" ? str[1]![R(str[1]!.length)]! : bool[1]![0]!);
    if (budget <= 1) return leaf();
    const k = R(4);
    if (ty === "n") return k === 0 ? { op: "sq", a: gen("n", budget - 1) } : k === 1 ? { op: "min", c: R(2) ? 30000 : -1, a: gen("n", budget - 2) } : k === 2 ? { op: "if", c: { op: "empty", i: 2 }, t: gen("n", (budget - 3) >> 1), e: gen("n", (budget - 3) >> 1) } : { op: (["add", "sub", "mul"] as const)[R(3)]!, a: gen("n", (budget - 1) >> 1), b: gen("n", (budget - 1) >> 1) };
    if (ty === "s") return k < 2 ? { op: "cat", a: gen("s", (budget - 1) >> 1), b: gen("s", (budget - 1) >> 1) } : k === 2 ? { op: "if", c: { op: "eq", a: { op: "param", i: 0 }, b: { op: "lit", v: 3 } }, t: gen("s", (budget - 3) >> 1), e: gen("s", (budget - 3) >> 1) } : leaf();
    return k === 0 ? { op: "not", a: gen("b", budget - 1) } : k === 1 ? { op: "and", a: gen("b", (budget - 1) >> 1), b: gen("b", (budget - 1) >> 1) } : k === 2 ? { op: "le", a: gen("n", (budget - 1) >> 1), b: gen("n", (budget - 1) >> 1) } : { op: "range", i: 1, lo: 0, hi: 9 };
  };
  const all = [...num.flat(), ...str.flat(), ...bool.flat()];
  for (let i = 0; i < 3000; i++) all.push(gen((["n", "s", "b"] as const)[i % 3]!, 2 + (i % 12)));
  let checked = 0, refusedBySize = 0;
  for (const n of all) {
    const text = compileProgram(n, P);
    const engine = derivedExprProblem(text, P);
    // The engine gate refuses only oversize text or a program reading no parameter; everything it admits passes the
    // strict allowlist (and so does every program short enough, whatever it reads).
    assert.ok(engine === null || engine === "derive_expr_size" || engine === "derive_expr_constant", `${engine}: ${text}`);
    if (engine === "derive_expr_size") { refusedBySize++; continue; }
    assert.equal(strictAllowlist(text, P), null, text);
    assert.doesNotMatch(text, /[[\]`{}]|=>|\bnew\b|\.\s*[A-Za-z_$]/, text);
    checked++;
  }
  assert.ok(checked > 10000, `checked ${checked}`);
  for (const body of [S2]) { const e = run(body).e!; const m = /return (.*);\n\}\n$/s.exec(e.content)!; const names = [...e.content.matchAll(/(\w+): (?:number|string|boolean)[,)]/g)].map((x) => x[1]!); assert.equal(strictAllowlist(m[1]!, names), null, e.content); }
  for (const body of [S1, S3]) { const c = cand(body); const t = parseDeriveTask(DERIVE_TRIGGER, clean(body)); assert.ok(c.ok && "task" in t); assert.equal(strictAllowlist(c.fit.expr, t.task.params.map((q) => q.name)), null, c.fit.expr); }
  for (const e of EV.examples) assert.equal(strictAllowlist(e.expr, e.params.map((p) => p.name)), null, e.expr);
  // The strict check itself refuses what Auditor listed.
  for (const bad of ["Math.min(a, 1)", "Reflect.get(a, 1)", "/x/.test(s)", "s.repeat(a)", "s.padStart(a)", "Object.getOwnPropertyNames(s)", "s.constructor", "s['__proto__']", "(() => a)()", "a = 1", "`${s}`", "new Array(a)", "f.call(a)", "Error.captureStackTrace(s)", "b2 + 1", "a > 1", `"${"x".repeat(DERIVE_MAX_STRING + 1)}" + s`, "x".repeat(DERIVE_MAX_EXPR_CHARS + 1)]) assert.notEqual(strictAllowlist(bad, P), null, bad);
});

// ---- mined evidence ----
type DV = number | string | boolean;
type Ex = { repo: string; commit: string; module: string; fn: string; params: { name: string; type: "number" | "string" | "boolean" }[]; ret: "number" | "string" | "boolean"; prose: string; examples: { args: DV[]; out: DV }[]; expr: string; heldOut: { right: number; wrong: number }; upstream: string; forms: DeriveForm[]; path: string; fileBlob: string; sha256: string; fixture: string; license: string; licenseSha256: string };
const EV = JSON.parse(read("peaceai/rules/proposals/m99-derive-from-behavior-evidence.json")) as { bar: number; manifestSha256: string; examples: Ex[]; peace: { repo: string; checkedAt: string; counted: number }[] };
const REPLAYED = new Map<Ex, ReturnType<typeof deriveCandidate>>();
// Evidence replays through the search and witness gates WITHOUT the form gate (deriveCandidate): the entries are what
// the form gate counts, so they cannot depend on it.
const replay = (e: Ex) => { let r = REPLAYED.get(e); if (!r) { r = deriveCandidate({ params: e.params, ret: e.ret, examples: e.examples }); REPLAYED.set(e, r); } return r; };
const P0 = { op: "param", i: 0 } as const;
const FORM_SAMPLE: Record<DeriveForm, DeriveNode> = {
  cap: { op: "min", c: 3, a: P0 }, ternary: { op: "if", c: { op: "le", a: P0, b: { op: "lit", v: 3 } }, t: P0, e: { op: "int", v: 1 } }, strcat: { op: "cat", a: P0, b: { op: "lit", v: ":" } },
  eq: { op: "eq", a: P0, b: { op: "lit", v: 4 } }, or: { op: "or", a: { op: "le", a: P0, b: { op: "lit", v: 1 } }, b: { op: "le", a: { op: "lit", v: 9 }, b: P0 } },
  range: { op: "range", i: 0, lo: 1, hi: 9 }, square: { op: "sq", a: P0 },
};
const gitBlob = (b: Buffer) => createHash("sha1").update(`blob ${b.length}\0`).update(b).digest("hex");
const pinned = (p: { fixture: string; fileBlob: string; sha256: string }) => {
  const b = readFileSync(resolve(root, p.fixture));
  assert.ok(b.length <= 65536, p.fixture);
  assert.equal(gitBlob(b), p.fileBlob, p.fixture);
  assert.equal(createHash("sha256").update(b).digest("hex"), p.sha256, p.fixture);
  return b.toString("utf8");
};
test("evidence: bar met; modules blob-pinned and hold the upstream function; each expression re-derives from the recorded examples alone", () => {
  assert.ok(EV.examples.length >= EV.bar && EV.bar >= 10);
  assert.equal(new Set(EV.examples.map((e) => `${e.repo}\0${e.module}\0${e.fn}`)).size, EV.examples.length);
  const perRepo = new Map<string, number>();
  for (const e of EV.examples) perRepo.set(e.repo, (perRepo.get(e.repo) ?? 0) + 1);
  assert.ok([...perRepo.values()].every((n) => n <= 3), "at most 3 per repo");
  let nonString = 0;
  for (const e of EV.examples) {
    const text = pinned(e);
    assert.equal(e.path, e.module);
    assert.ok(text.includes(e.upstream) && new RegExp(`\\b${e.fn}\\b`).test(e.upstream), `${e.repo} ${e.fn} upstream`);
    assert.ok(e.examples.length >= 4 && e.examples.length <= DERIVE_MAX_EXAMPLES);
    assert.ok(e.heldOut.right > 0 && e.heldOut.wrong === 0);
    const r = replay(e);
    assert.ok(r.ok, `${e.repo} ${e.fn}: ${r.ok ? "" : r.reason}`);
    const expr = compileProgram(r.fit.program, e.params.map((p) => p.name));
    assert.equal(expr, e.expr, `${e.repo} ${e.fn}`);
    assert.equal(derivedExprProblem(expr, e.params.map((p) => p.name)), null, `${e.repo} ${e.fn} whitelist`);
    for (const x of e.examples) assert.equal(evalProgram(r.fit.program, x.args), x.out);
    if (e.ret !== "string") nonString++;
  }
  assert.ok(nonString >= 3, "number and boolean results are evidenced too");
});
test("evidence by form (#491 round 3, Auditor ruling): the recorded forms replay; a form is emitted only with >= 10 entries", () => {
  // Each entry records the forms of the program its examples replay to; the runtime gate counts those (the evidence
  // file is the single source). Here every entry is re-derived and its recorded forms checked.
  const counts = Object.fromEntries(DERIVE_FORMS.map((f) => [f, 0])) as Record<DeriveForm, number>;
  for (const e of EV.examples) {
    const r = replay(e);
    assert.ok(r.ok, `${e.repo} ${e.fn}`);
    assert.deepEqual(e.forms, formsOf(r.fit.program), `${e.repo} ${e.fn}: recorded forms`);
    for (const f of e.forms) counts[f]++;
  }
  assert.deepEqual(evidenceFormCounts(), counts, "the runtime reads the same counts");
  assert.equal(EV.bar, DERIVE_FORM_BAR);
  // Every form the engine may emit has at least DERIVE_FORM_BAR replaying entries; every other form is refused.
  const allowed = DERIVE_FORMS.filter((f) => unevidencedForms(FORM_SAMPLE[f]).length === 0);
  for (const f of DERIVE_FORMS) assert.deepEqual(formsOf(FORM_SAMPLE[f]), [f], f);
  for (const f of allowed) assert.ok(counts[f] >= DERIVE_FORM_BAR, `${f}: ${counts[f]}`);
  for (const f of DERIVE_FORMS) if (counts[f] < DERIVE_FORM_BAR) assert.deepEqual(unevidencedForms(FORM_SAMPLE[f]), [f], f);
  // Pinned so a change in what PeaceAI may emit is a visible diff (round 4 mining: eq 17; M104 mining: ternary 12
  // entries, but per sub-shape only eq-const/string 4 distinct ones, Auditor #498: no ternary sub-shape is emitted).
  assert.deepEqual(allowed, ["cap", "strcat", "eq", "or", "range", "square"], JSON.stringify(counts));
  assert.equal(counts.ternary, 12, "M104: 12 replaying upstream if / else entries");
  assert.deepEqual(evidenceTernaryShapeCounts(), { "eq-const/string": 4 });
});
test("form gate: boundary at the bar, fail closed on a bad evidence file, refused by name through deriveProgram", () => {
  const zero = Object.fromEntries(DERIVE_FORMS.map((f) => [f, 0])) as Record<DeriveForm, number>;
  const or = FORM_SAMPLE.or; // (n <= 1) || (9 <= n)
  assert.deepEqual(formsOf(or), ["or"], "the sample is a pure || of two <= tests");
  assert.deepEqual(unevidencedForms(or, { ...zero, or: DERIVE_FORM_BAR }), []);
  assert.deepEqual(unevidencedForms(or, { ...zero, or: DERIVE_FORM_BAR - 1 }), ["or"]);
  assert.deepEqual(unevidencedForms({ op: "add", a: { op: "param", i: 0 }, b: { op: "int", v: 1 } }, zero), [], "base vocabulary is not gated");
  // Fail closed: unreadable JSON, no examples array, a form name outside the list -> nothing counted.
  assert.deepEqual(evidenceFormCounts("{not json"), zero);
  assert.deepEqual(evidenceFormCounts('{"examples": 3}'), zero);
  const many = (forms: unknown) => JSON.stringify({ examples: Array.from({ length: DERIVE_FORM_BAR }, () => ({ forms })) });
  assert.deepEqual(evidenceFormCounts(many(["or", "nope"])), zero);
  assert.deepEqual(evidenceFormCounts(many("or")), zero);
  assert.equal(evidenceFormCounts(many(["or", "or"])).or, DERIVE_FORM_BAR, "an entry counts once per form");
  // A square of a subexpression and a square of a parameter are both the square form.
  assert.deepEqual(formsOf({ op: "mul", a: { op: "add", a: { op: "param", i: 0 }, b: { op: "int", v: 1 } }, b: { op: "add", a: { op: "param", i: 0 }, b: { op: "int", v: 1 } } }), ["square"]);
  // Through deriveProgram: an equality-only behavior (eq: >= 10 entries) is emitted, and since M104 (ternary: 12 entries)
  // so is a general if. With an evidence file one ternary entry short of the bar (a copy of derive.ts run in a child
  // process), the same behavior is refused by name, with the count in the detail.
  const N = [{ name: "n", type: "number" as const }];
  const grid = [-5, 0, 3, 4, 5, 6, 9, 100, -100, 200, 2, 7, 50];
  const eqEx = [-5, 0, 3, 4, 5, 9, 100, -100, 200, 6, 2].map((n) => ({ args: [n], out: n === 4 }));
  const e = deriveProgram({ params: N, ret: "boolean", examples: eqEx });
  assert.ok(e.ok && e.fit.expr === "n === 4", JSON.stringify(e));
  const ex = grid.map((n) => ({ args: [n], out: n === 4 ? 1 : 0 }));
  const c = deriveCandidate({ params: N, ret: "number", examples: ex });
  assert.ok(c.ok && c.fit.expr === "(n === 4) ? 1 : 0", "the search alone fits (n === 4) ? 1 : 0");
  // The real evidence: the form count (12) is at the bar but the sub-shape eq-const/number has no entry, so refused.
  const sub = deriveProgram({ params: N, ret: "number", examples: ex });
  assert.ok(!sub.ok && sub.reason === "derive_unevidenced_form" && JSON.stringify(sub.forms) === '["ternary"]', JSON.stringify(sub).slice(0, 300));
  assert.match(!sub.ok ? sub.detail! : "", /sub-shape eq-const\/number has 0 distinct ones/);
  const dir = mkdtempSync(join(tmpdir(), "m104-gate-"));
  try {
    mkdirSync(join(dir, "peaceai/lib"), { recursive: true });
    mkdirSync(join(dir, "peaceai/rules/proposals"), { recursive: true });
    symlinkSync(resolve(root, "node_modules"), join(dir, "node_modules"));
    writeFileSync(join(dir, "peaceai/lib/derive.ts"), read("peaceai/lib/derive.ts"));
    let drop = evidenceFormCounts().ternary - (DERIVE_FORM_BAR - 1);
    const short = { ...EV, examples: EV.examples.filter((e) => !(e.forms.includes("ternary") && drop-- > 0)) };
    writeFileSync(join(dir, "peaceai/rules/proposals/m99-derive-from-behavior-evidence.json"), JSON.stringify(short));
    writeFileSync(join(dir, "probe.ts"), `import { deriveProgram } from "./peaceai/lib/derive.ts";\nprocess.stdout.write(JSON.stringify(deriveProgram(${JSON.stringify({ params: N, ret: "number", examples: ex })})));\n`);
    const out = spawnSync(process.execPath, [resolve(root, "node_modules/tsx/dist/cli.mjs"), "probe.ts"], { cwd: dir, encoding: "utf8" });
    assert.equal(out.status, 0, out.stderr);
    const r = JSON.parse(out.stdout) as { ok: boolean; reason?: string; forms?: string[]; detail?: string };
    assert.equal(r.ok, false);
    assert.equal(r.reason, "derive_unevidenced_form");
    assert.deepEqual(r.forms, ["ternary"]);
    assert.match(r.detail!, new RegExp(`ternary form .*; ${DERIVE_FORM_BAR - 1} replaying upstream evidence entries\\).*at least ${DERIVE_FORM_BAR}`));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test("ternary sub-shapes (Auditor #498 on 19d6100): only the sub-shapes with 10 distinct entries unlock; copies count once", () => {
  // Every ternary evidence entry records the sub-shapes of the program it replays to.
  for (const e of EV.examples) {
    const r = replay(e);
    assert.ok(r.ok, `${e.repo} ${e.fn}`);
    const rec = (e as Ex & { ternaryShapes?: string[] }).ternaryShapes;
    if (e.forms.includes("ternary")) assert.deepEqual(rec, ternaryShapesOf(r.fit.program, e.params.map((p) => p.type)), `${e.repo} ${e.fn}`);
    else assert.equal(rec, undefined, `${e.repo} ${e.fn}`);
  }
  // Sub-shapes: guard class / branch type.
  const p = (i: number): DeriveNode => ({ op: "param", i });
  const max: DeriveNode = { op: "if", c: { op: "le", a: p(0), b: p(1) }, t: p(1), e: p(0) };
  const cmp: DeriveNode = { op: "if", c: { op: "le", a: p(0), b: p(1) }, t: { op: "int", v: -1 }, e: { op: "int", v: 1 } };
  const plural: DeriveNode = { op: "if", c: { op: "eq", a: p(0), b: { op: "int", v: 1 } }, t: { op: "lit", v: "" }, e: { op: "lit", v: "s" } };
  const flag: DeriveNode = { op: "if", c: { op: "eq", a: p(0), b: { op: "int", v: 4 } }, t: { op: "int", v: 1 }, e: { op: "lit", v: 0 } };
  const join: DeriveNode = { op: "cat", a: p(0), b: { op: "if", c: { op: "empty", i: 0 }, t: p(0), e: { op: "lit", v: "/" } } };
  const eqp: DeriveNode = { op: "if", c: { op: "eq", a: p(0), b: p(1) }, t: { op: "lit", v: "same" }, e: { op: "lit", v: "diff" } };
  const sle: DeriveNode = { op: "if", c: { op: "sle", i: 0, j: 1 }, t: p(0), e: p(1) };
  const nested: DeriveNode = { op: "if", c: { op: "eq", a: p(0), b: { op: "int", v: 0 } }, t: { op: "lit", v: "zero" }, e: { op: "if", c: { op: "le", a: p(0), b: { op: "int", v: 5 } }, t: { op: "lit", v: "few" }, e: { op: "lit", v: "many" } } };
  assert.deepEqual(ternaryShapesOf(max, ["number", "number"]), ["le/number"]);
  assert.deepEqual(ternaryShapesOf(max), ["le/unknown"], "untyped parameter branches are never covered");
  assert.deepEqual(ternaryShapesOf(cmp, ["string", "string"]), ["le/number"]);
  assert.deepEqual(ternaryShapesOf(plural, ["number"]), ["eq-const/string"]);
  assert.deepEqual(ternaryShapesOf(flag, ["number"]), ["eq-const/number"]);
  assert.deepEqual(ternaryShapesOf(join, ["string"]), ["eq-const/string"]);
  assert.deepEqual(ternaryShapesOf(eqp, ["string", "string"]), ["eq/string"]);
  assert.deepEqual(ternaryShapesOf(sle, ["string", "string"]), ["sle/string"]);
  assert.deepEqual(ternaryShapesOf(nested, ["number"]), ["eq-const/string", "le/string"]);
  // Even with eq-const/string at the bar, every other sub-shape stays refused (max, comparator, numeric branches, a
  // nested if whose inner guard is <=); the form count alone never unlocks them.
  const at = { "eq-const/string": DERIVE_FORM_BAR };
  assert.deepEqual(unevidencedForms(plural, undefined, ["number"], at), []);
  assert.deepEqual(unevidencedForms(join, undefined, ["string"], at), ["strcat"].filter((f) => evidenceFormCounts().strcat < DERIVE_FORM_BAR));
  for (const [x, t] of [[max, ["number", "number"]], [cmp, ["string", "string"]], [flag, ["number"]], [eqp, ["string", "string"]], [sle, ["string", "string"]], [nested, ["number"]]] as [DeriveNode, DeriveType[]][]) assert.deepEqual(unevidencedForms(x, undefined, t, at), ["ternary"], JSON.stringify(x));
  assert.deepEqual(unevidencedForms(plural, undefined, ["number"], { "eq-const/string": DERIVE_FORM_BAR - 1 }), ["ternary"]);
  // Distinct counting: identical examples count once (any names or quotes), at most 2 per expression shape, renaming
  // only outside string literals; fail closed.
  const ent = (fn: string, name: string, expr: string, rows: number[], shapes: unknown = ["eq-const/string"]) => ({ fn, params: [{ name, type: "number" }], expr, examples: rows.map((n) => ({ args: [n], out: n === 1 ? "" : "s" })), ternaryShapes: shapes });
  const file = (...es: unknown[]) => JSON.stringify({ examples: es });
  assert.deepEqual(evidenceTernaryShapeCounts(file(ent("a", "n", '(n === 1) ? "" : "s"', [0, 1, 2]), ent("b", "count", '(count === 1) ? "" : "s"', [0, 1, 2]))), { "eq-const/string": 1 }, "same examples: one problem");
  assert.deepEqual(evidenceTernaryShapeCounts(file(ent("a", "n", '(n === 1) ? "" : "s"', [0, 1, 2]), ent("b", "count", '(count === 1) ? "" : "s"', [0, 1, 3]), ent("c", "k", '(k === 1) ? "" : "s"', [0, 1, 4]))), { "eq-const/string": 2 }, "at most 2 per expression shape");
  assert.deepEqual(evidenceTernaryShapeCounts(file(ent("a", "s", '(s === 1) ? "" : "s"', [0, 1, 2]), ent("b", "n", '(n === 1) ? "" : "p0"', [0, 1, 3]), ent("c", "n", '(n === 1) ? "" : "p0"', [0, 1, 4]), ent("d", "n", '(n === 1) ? "" : "p0"', [0, 1, 5]))), { "eq-const/string": 3 }, "a literal is never renamed");
  assert.deepEqual(evidenceTernaryShapeCounts("{not json"), {});
  assert.deepEqual(evidenceTernaryShapeCounts(file(ent("a", "n", "n", [0], "eq-const/string"), ent("b", "n", "n", [1], [3]))), {});
});
test("form gate: nothing that emits code calls deriveCandidate (replay / mining only)", () => {
  for (const dir of ["peaceai/lib", "peaceai/bin"]) for (const f of readdirSync(resolve(root, dir))) {
    if (!/\.ts$/.test(f) || `${dir}/${f}` === "peaceai/lib/derive.ts") continue;
    assert.doesNotMatch(read(`${dir}/${f}`), /deriveCandidate/, `${dir}/${f}`);
  }
});
test("evidence: licenses by hash in THIRD_PARTY_NOTICES; fixtures dir holds exactly the evidence fixtures", () => {
  const notices = read("THIRD_PARTY_NOTICES");
  const listed = new Set<string>();
  for (const e of EV.examples) {
    assert.ok(["MIT", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "ISC"].includes(e.license), e.repo);
    assert.ok(notices.includes(`repo: ${e.repo}\nlicense: ${e.license} (`) && notices.includes(`sha256 of trimmed text ${e.licenseSha256})`), e.repo);
    assert.ok(notices.includes(` ${e.fixture}\n`), e.fixture);
    listed.add(e.fixture.split("/").pop()!);
  }
  const have = readdirSync(resolve(root, "peaceai/test/fixtures/m99-dfb"));
  for (const f of have) assert.ok(listed.has(f), f);
  assert.equal(have.length, listed.size);
});
test("evidence: no overlap with the training corpus or the ext-manifest; Peace's repos checked first and not counted", () => {
  const buf = readManifestBytes(resolve(root, "peaceai/model"), "ext-manifest");
  assert.equal(createHash("sha256").update(buf).digest("hex"), EV.manifestSha256);
  const repos = new Set<string>(); const shas = new Set<string>();
  for (const l of buf.toString("utf8").split("\n")) if (l.trim()) { const r = JSON.parse(l) as { repo?: string; sha256?: string }; if (r.repo) repos.add(r.repo); if (r.sha256) shas.add(r.sha256); }
  for (const r of (JSON.parse(read("peaceai/model/ext-corpus.json")) as { repos: { name: string }[] }).repos) repos.add(r.name);
  for (const e of EV.examples) { assert.ok(!repos.has(e.repo), e.repo); assert.ok(!shas.has(e.sha256), e.fixture); assert.ok(!e.repo.startsWith("PeaceG03/")); }
  for (const p of EV.peace) { assert.ok(repos.has(p.repo)); assert.equal(p.counted, 0); assert.match(p.checkedAt, /^[0-9a-f]{40}$/); }
  const rec = JSON.parse(read("peaceai/rules/proposals/public-derive-from-behavior-v1.json")) as { status: string; evidence: { examples: number; repos: number; bar: number; qualifies: boolean } };
  assert.match(rec.status, /^proposal-off/);
  assert.equal(rec.evidence.examples, EV.examples.length);
  assert.equal(rec.evidence.repos, new Set(EV.examples.map((e) => e.repo)).size);
  assert.ok(rec.evidence.qualifies && rec.evidence.examples >= rec.evidence.bar);
  assert.deepEqual(SPEC.evidence.repos, [...new Set(EV.examples.map((e) => e.repo))].sort());
  assert.equal(SPEC.evidence.hunks, EV.examples.length);
});
