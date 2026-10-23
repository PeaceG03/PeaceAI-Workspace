// M99 DERIVE_FROM_BEHAVIOR (public-derive-from-behavior-v1): the issue states only the behavior of a new pure function
// (header, plain-prose Behavior paragraph, literal examples); PeaceAI derives the body with its own typed-DSL program
// search (peaceai/lib/derive.ts) and writes the test from the examples. Code in the behavior section is refused
// (anti-credit guard); two smallest programs that disagree on a boundary probe are refused (derive_ambiguous).
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { admitRules } from "../lib/approved.ts";
import { compileProgram, deriveProgram, derivedExprProblem, evalProgram, probeSet, type DeriveNode } from "../lib/derive.ts";
import { applyRule, specHash, validateSpec, type RuleSpec } from "../lib/learned.ts";
import { behaviorCodeProblem, DERIVE_TRIGGER, DERIVE_VOCAB, derivedModuleProblem, describedConstants, describedProbes, parseDeriveTask, rawIssueProblem } from "../lib/learned-derive.ts";
import { callsFunction, stubFunction } from "../lib/learned-function.ts";
import { LEARNED_CANONICAL } from "../lib/nlparse.ts";
import { phrasingFor } from "../lib/propose.ts";
import { PROTECTED_SELF } from "../lib/selfchange.ts";
import { cleanIssueText } from "../lib/taskmap.ts";

const root = resolve(import.meta.dirname, "../..");
const read = (p: string) => readFileSync(resolve(root, p), "utf8");
const SPEC = JSON.parse(read("peaceai/rules/learned/public-derive-from-behavior-v1.json")) as RuleSpec;
const SHA = "3c4a0abfc59c2f74a5a9e74b39f6d4e4b0bab98ed6b76d84c48e285a4394f0b1";
const FILES = [{ path: "src/host.ts", content: "export const x = 1;\n" }, { path: "src/host.test.ts", content: 'import { x } from "./host.ts";\n' }];
const S1 = `Add a new module \`src/r2-retry-status.ts\` exporting \`isRetryableR2Status(status: number): boolean\`.

Behavior: given the HTTP status code of a reply from R2, answer true when the request is worth retrying and false when it is not. Worth retrying: 429 (too many requests) and every server error status from 500 through 599. Not worth retrying: everything else, including success, redirect and other client error statuses, and anything above 599.

Examples:
${[[429, true], [500, true], [502, true], [503, true], [504, true], [550, true], [599, true], [428, false], [430, false], [499, false], [600, false], [200, false], [204, false], [301, false], [400, false], [403, false], [404, false], [0, false]].map(([a, b]) => `- ${a} gives ${b}`).join("\n")}

Context: this is the status check a future retry will use. PeaceAI has to work out the implementation itself.`;
const S2 = `Add a new module \`src/r2-retry-delay.ts\` exporting \`r2RetryDelayMs(attempt: number, baseMs: number): number\`.

Behavior: how many milliseconds to wait before retry number \`attempt\` (counting from 0), given a base wait of \`baseMs\`. Attempt 0 waits exactly the base. Each later attempt waits longer than the one before, following the pattern in the examples. The wait is never more than 30000 ms, whatever the attempt or base. A base of 0 always gives 0.

Examples (attempt, baseMs gives wait):
${[[0, 1000, 1000], [1, 1000, 4000], [2, 1000, 9000], [3, 1000, 16000], [4, 1000, 25000], [5, 1000, 30000], [10, 1000, 30000], [0, 500, 500], [1, 500, 2000], [2, 250, 2250], [0, 0, 0], [7, 0, 0], [0, 40000, 30000]].map(([a, b, c]) => `- ${a}, ${b} gives ${c}`).join("\n")}`;
const S3 = `Add a new module \`src/host-failure-line.ts\` exporting \`hostFailureLine(message: string, causeCode: string): string\`.

Behavior: build the one-line failure report the scheduler host prints. The line always starts with the marker MARKETS_SCHEDULER_HOST_FAILED, then a colon, then the message exactly as given. When a cause code is given, the line ends with a colon, the word cause, an equals sign and the cause code. When the cause code is empty, nothing is added after the message.

Examples (message, causeCode gives line):
- "fetch failed", "ECONNRESET" gives "MARKETS_SCHEDULER_HOST_FAILED:fetch failed:cause=ECONNRESET"
- "fetch failed", "" gives "MARKETS_SCHEDULER_HOST_FAILED:fetch failed"
- "R2_GET_500", "" gives "MARKETS_SCHEDULER_HOST_FAILED:R2_GET_500"
- "", "UND_ERR_SOCKET" gives "MARKETS_SCHEDULER_HOST_FAILED::cause=UND_ERR_SOCKET"
- "", "" gives "MARKETS_SCHEDULER_HOST_FAILED:"
- "R2_PUT_500", "ETIMEDOUT" gives "MARKETS_SCHEDULER_HOST_FAILED:R2_PUT_500:cause=ETIMEDOUT"`;
const clean = (body: string, title = "derive task") => cleanIssueText({ title, body } as never);
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
  for (const p of ["peaceai/lib/derive.ts", "peaceai/lib/learned-derive.ts", "peaceai/spec/derive-from-behavior-v1.md", "peaceai/test/m99-derive-from-behavior.test.ts", "peaceai/test/fixtures/m99-dfb/x.txt", "peaceai/rules/proposals/m99-derive-from-behavior-evidence.json", "peaceai/rules/learned/public-derive-from-behavior-v1.json", "peaceai/rules/proposals/public-derive-from-behavior-v1.json", "peaceai/bin/test-candidates.ts", "peaceai/lib/learned.ts"]) assert.ok(PROTECTED_SELF.some((x) => x.pattern.test(p)), p);
});

test("S1-S3 (scanner refile): each derives one program; module and test are the expected text", () => {
  const s1 = run(S1).e!;
  assert.equal(s1.path, "src/r2-retry-status.ts");
  assert.equal(s1.content, "export function isRetryableR2Status(status: number): boolean {\n  return (status === 429) || (500 <= status && status <= 599);\n}\n");
  assert.match(s1.extra![0]!.path, /^src\/r2-retry-status\.is-retryable-r2-status-[0-9a-f]{7}\.test\.ts$/);
  assert.match(s1.extra![0]!.content, /assert\.equal\(isRetryableR2Status\(429\), true\);/);
  // The description names 429, 500 and 599: their neighbours that are not examples (501, 598) are written too.
  assert.match(s1.extra![0]!.content, /the boundaries the description names[\s\S]*isRetryableR2Status\(501\), true\);\n  assert\.equal\(isRetryableR2Status\(598\), true\);/);
  const s2 = run(S2).e!;
  assert.equal(s2.content, "export function r2RetryDelayMs(attempt: number, baseMs: number): number {\n  return (baseMs * ((attempt + 1) * (attempt + 1))) <= 30000 ? (baseMs * ((attempt + 1) * (attempt + 1))) : 30000;\n}\n");
  assert.doesNotMatch(s2.extra![0]!.content, /boundaries/, "no derived probes for a two-number formula");
  const s3 = run(S3).e!;
  assert.match(s3.content, /^export function hostFailureLine\(message: string, causeCode: string\): string \{\n  return "MARKETS_SCHEDULER_HOST_FAILED:" \+ /);
  for (const e of [s1, s2, s3]) {
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
  for (const body of [S1, S2, S3]) {
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
  assert.equal(sq.ok, true, "with -2 only x * x fits");
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

test("probes: deterministic; examples dropped; described probes only for one-number yes/no rules", () => {
  const params = [{ name: "n", type: "number" as const }];
  const ex = [{ args: [5], out: true }, { args: [6], out: false }];
  assert.deepEqual(probeSet(params, ex), probeSet(params, ex));
  assert.ok(!probeSet(params, ex).some((p) => p[0] === 5 || p[0] === 6));
  const t = parseDeriveTask(DERIVE_TRIGGER, clean(S1));
  assert.ok("task" in t);
  if ("task" in t) assert.deepEqual(describedProbes(t.task), [501, 598]);
  const t2 = parseDeriveTask(DERIVE_TRIGGER, clean(S2));
  if ("task" in t2) assert.deepEqual(describedProbes(t2.task), []);
});

test("no memorizing: strings are only tested for emptiness; integers only when the description writes them", () => {
  const p = [{ name: "name", type: "string" as const }];
  const ex = [{ args: ["write_file"], out: true }, { args: ["edit"], out: true }, { args: ["patch"], out: true }, { args: ["read_file"], out: false }];
  // The only fits are lookup tables of the example inputs: refused, never a guess, even when the prose names them.
  assert.equal(deriveProgram({ params: p, ret: "boolean", examples: ex }).ok, false);
  assert.equal(deriveProgram({ params: p, ret: "boolean", examples: ex, described: describedConstants("Every tool except read_file can change files.") }).ok, false);
  assert.equal(derivedExprProblem('!(name === "read_file")', ["name"]), "derive_expr_memorize");
  assert.equal(derivedExprProblem('(("read_file") === name)', ["name"]), "derive_expr_memorize");
  assert.equal(derivedExprProblem('!(name === "")', ["name"]), null);
  // Numbers: a threshold the prose does not write is not invented from the examples.
  const n = [{ name: "n", type: "number" as const }];
  const nx = [{ args: [10], out: true }, { args: [11], out: true }, { args: [3], out: false }];
  assert.equal(deriveProgram({ params: n, ret: "boolean", examples: nx }).ok, false);
  const ten = deriveProgram({ params: n, ret: "boolean", examples: nx, described: describedConstants("True from 10 upward.") });
  assert.equal(ten.ok && ten.fit.expr, "10 <= n");
  assert.deepEqual(describedConstants("Worth retrying: 429 and 500 through 599. Not 1.5 or v2."), { numbers: [429, 500, 599] });
});
