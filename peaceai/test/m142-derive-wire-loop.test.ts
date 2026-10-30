// G28 (public-derive-wire-loop-v1, kind EXISTING_EDIT, proposal-off-wired, team-picked, credit 0): the v2 ask "go over
// a list" for a NEW module. From the header signature, a plain-words Behavior paragraph and data-only fake examples,
// PeaceAI writes one closed template (for-of over the list parameter, one awaited call of the injected collaborator,
// push to the report list, a stop condition from a closed set fitted to the examples, an empty error list) and Job B
// grades it end to end (the created module's before-run source is its type-default stub). The module's loop is the
// seam public-derive-wire-v2's record ask uses next (checked here on the derived module).
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { admitRules, APPROVED_SCHEMA, loadApprovedList } from "../lib/approved.ts";
import { DERIVE_WIRE_LOOP_TRIGGER, DERIVE_WIRE_V2_TRIGGER, deriveWireLoopDetail, deriveWireV2Detail } from "../lib/derive-wire-v2.ts";
import { DERIVE_TRIGGER } from "../lib/learned-derive.ts";
import { applyRule, specHash, validateSpec, type RuleSpec } from "../lib/learned.ts";
import { gradeLoopModuleProblem, isWire2Params, isWireLoopParams, isWireParams, loopModule, loopModuleShape, loopStub } from "../lib/learned-edit-existing.ts";
import { PEACE_AUTHOR } from "../lib/minetest.ts";
import { nlDecision } from "../lib/nlparse.ts";
import { DERIVE_WIRE_LOOP_PHRASING, phrasingFor } from "../lib/propose.ts";
import { cleanIssueText } from "../lib/taskmap.ts";

const repo = resolve(import.meta.dirname, "..", "..");
const tsx = join(repo, "node_modules/.bin/tsx");
const read = (p: string) => readFileSync(join(repo, p), "utf8");
const LOOP = JSON.parse(read("peaceai/rules/learned/public-derive-wire-loop-v1.json")) as RuleSpec;
const WIRE2 = JSON.parse(read("peaceai/rules/learned/public-derive-wire-v2.json")) as RuleSpec;
const isTest = (p: string) => /\.test\.ts$/.test(p);
const issue = (head: string, behavior: string, examples: string[]) => [head, "", `Behavior: ${behavior}`, "", "Examples:", ...examples.map((e) => `- ${e}`), ""].join("\n");
const objective = (body: string) => cleanIssueText({ title: "loop task", body } as never);
const derive = (body: string, files: { path: string; content: string }[]) => deriveWireLoopDetail(LOOP.trigger, LOOP.params, objective(body), files, isTest, body);

// --- the fixture: a declared report type (as PeaceSTOCKS src/contracts.ts) and a test in the repo's import style
const CONTRACTS = `export type RunStatus =
  | "COMPLETE"
  | "PARTIAL"
  | "PROVIDER_NOT_READY";
export interface SessionRecord {
  sessionDate: string;
}
export interface ScannerRunReport {
  session: SessionRecord;
  status: RunStatus;
  unresolvedFailures: string[];
  skips?: string[];
  note: string;
}
`;
const CONTRACTS_TEST = `import assert from "node:assert/strict";
import test from "node:test";
import type { ScannerRunReport } from "./contracts.ts";

test("a report literal type-checks", () => {
  const r: ScannerRunReport = { session: { sessionDate: "d" }, status: "COMPLETE", unresolvedFailures: [], note: "" };
  assert.equal(r.status, "COMPLETE");
});
`;
const FILES = [{ path: "src/contracts.ts", content: CONTRACTS }, { path: "src/contracts.test.ts", content: CONTRACTS_TEST }];
const HEAD = 'Add a new module `src/catch-up.ts` exporting `async catchUpSessions(missed: string[], scanner: { run(session: string, mode: "EVIDENCE_ONLY"): Promise<ScannerRunReport> })` that returns the reports and an errors list of `{ day: string; error: string }`.';
const BEHAVIOR = "catchUpSessions scans each missed day in order in EVIDENCE_ONLY mode and stops right after a report whose status is PROVIDER_NOT_READY or whose unresolved failures mention MASSIVE_CREDENTIAL_REJECTED, the same as the catch-up loop in the host today. The errors list is declared before the loop and stays empty in this task.";
const rep = (day: string, status: string, failures: string[] = []) => `{ session: { sessionDate: "${day}" }, status: "${status}", unresolvedFailures: [${failures.map((f) => JSON.stringify(f)).join(", ")}] }`;
const FULL = [
  `fake scannerA = { run: sequence(resolves(${rep("2026-10-01", "COMPLETE")}), resolves(${rep("2026-10-02", "COMPLETE")})) }`,
  `expect catchUpSessions(["2026-10-01", "2026-10-02"], scannerA) resolves to { reports: [${rep("2026-10-01", "COMPLETE")}, ${rep("2026-10-02", "COMPLETE")}], errors: [] }`,
  "expect scannerA.run is called 2 times",
];
const STOPS = [
  `fake scannerB = { run: resolves(${rep("2026-10-01", "PROVIDER_NOT_READY")}) }`,
  `expect catchUpSessions(["2026-10-01", "2026-10-02"], scannerB) resolves to { reports: [${rep("2026-10-01", "PROVIDER_NOT_READY")}], errors: [] }`,
  "expect scannerB.run is called 1 time",
];
const TASK = issue(HEAD, BEHAVIOR, [...FULL, ...STOPS]);

const EXPECTED = `import type { ScannerRunReport } from "./contracts.ts";

export async function catchUpSessions(missed: string[], scanner: { run(session: string, mode: "EVIDENCE_ONLY"): Promise<ScannerRunReport> }): Promise<{ reports: ScannerRunReport[]; errors: { day: string; error: string }[] }> {
  const reports: ScannerRunReport[] = [];
  const errors: { day: string; error: string }[] = [];
  for (const session of missed) {
    const report = await scanner.run(session, "EVIDENCE_ONLY");
    reports.push(report);
    if (report.status === "PROVIDER_NOT_READY" || report.unresolvedFailures.some((entry) => entry.includes("MASSIVE_CREDENTIAL_REJECTED"))) break;
  }
  return { reports, errors };
}
`;

test("the spec: EXISTING_EDIT with its own loop vocabulary and trigger, valid, approved only as its exact sha, team-picked, no credit; phrasing", () => {
  assert.equal(LOOP.id, "public-derive-wire-loop-v1");
  assert.equal(LOOP.kind, "EXISTING_EDIT");
  assert.equal(LOOP.trigger, DERIVE_WIRE_LOOP_TRIGGER);
  assert.equal(validateSpec(LOOP), true);
  assert.ok(isWireLoopParams(LOOP.params) && !isWire2Params(LOOP.params) && !isWireParams(LOOP.params));
  assert.ok(!isWireLoopParams(WIRE2.params), "v2 keeps its own vocabulary");
  // public-derive-wire-v2 is unchanged: its trigger and the sha Peace approved on #613
  assert.equal(WIRE2.trigger, DERIVE_WIRE_V2_TRIGGER);
  assert.equal(specHash(WIRE2), "e9e6d7e10e0195850f6e29f13e92c803424fafc94c280e4fe7ea10ace311bc28");
  // Holds before and after its approval lands (the #626 lesson). Not listed: the id and sha appear nowhere in approved.json.
  // Listed: once, as this exact spec sha, by Peace on a Workspace issue, and it admits.
  const approvedText = read("peaceai/rules/approved.json");
  const listed = (JSON.parse(approvedText) as { rules: { id: string; sha256: string; approval: { author: string; repo: string } }[] }).rules.filter((r) => r.id === LOOP.id);
  const loopDecisions = admitRules([LOOP], loadApprovedList(join(repo, "peaceai/rules/approved.json"))).filter((a) => a.id === LOOP.id).map((a) => a.decision);
  if (listed.length === 0) {
    assert.ok(!approvedText.includes(LOOP.id) && !approvedText.includes(specHash(LOOP)), "waits for /approve-rule or /auditor-approve-rule");
    assert.ok(!loopDecisions.includes("APPROVED"), "not listed: never APPROVED");
  } else {
    assert.equal(listed.length, 1, "listed once");
    assert.equal(listed[0]!.sha256, specHash(LOOP), "approved as the exact spec sha");
    assert.equal(listed[0]!.sha256, "04f01ffd6d6c0e1097c1fc0eefb25b62d120aeebf5cfac84516698f450b9d74a", "the sha this PR proposes");
    assert.deepEqual([listed[0]!.approval.author, listed[0]!.approval.repo], ["PeaceG03", "PeaceG03/PeaceAI-Workspace"]);
    assert.deepEqual(loopDecisions, ["APPROVED"], "a listed loop entry must admit (exact sha)");
  }
  const prop = JSON.parse(read("peaceai/rules/proposals/public-derive-wire-loop-v1.json")) as { status: string; teamPicked: boolean; credit: number; evidence: { qualifies: boolean }; tests: string[] };
  assert.equal(prop.status, "proposal-off-wired");
  assert.equal(prop.teamPicked, true);
  assert.equal(prop.credit, 0);
  assert.equal(prop.evidence.qualifies, false);
  assert.ok(prop.tests.includes("peaceai/test/m142-derive-wire-loop.test.ts"));
  assert.equal(phrasingFor(LOOP), DERIVE_WIRE_LOOP_PHRASING);
  assert.match(read("builder-log/rule-skill.ts"), /"public-derive-wire-loop-v1": "EXISTING_FUNCTION_EDIT"/);
  assert.match(read("peaceai/spec/derive-wire-v2.md"), /G28/);
});

test("nlparse: the loop header is canonical once EXISTING_EDIT is approved (was NO_FAMILY); nothing else widens", () => {
  assert.equal(nlDecision({ title: "", body: TASK }, undefined, new Set(["EXISTING_EDIT"]), null).status, "canonical");
  const off = nlDecision({ title: "", body: TASK }, undefined, new Set(), null);
  assert.ok(off.status === "unsure" && off.reason === "RULE_NOT_APPROVED");
  // the trigger is its own: no overlap with M99's new-module header or v2's existing-function header
  const re = new RegExp(LOOP.trigger, "imu");
  assert.ok(re.test(objective(TASK)));
  assert.ok(!new RegExp(DERIVE_TRIGGER, "imu").test(objective(TASK)), "M99 never reads the async loop header");
  assert.ok(!re.test("add a new module src/a.ts exporting double(n: number): number"));
  assert.ok(!re.test("In the existing function catchUpSessions in src/catch-up.ts, record a failing call and go on."));
  // a near-miss wording (no `async`, or no error list) is still refused
  assert.ok(!re.test(objective(TASK).replace("exporting async ", "exporting ")));
  assert.ok(!re.test(objective(TASK).replace(" and an errors list of { day: string; error: string }", "")));
});

test("derives the loop module and its fake-driven test; Job B's static gate accepts it; the template round-trips", () => {
  const r = derive(TASK, FILES);
  assert.equal(r.reason, null, r.detail);
  assert.equal(r.edit!.path, "src/catch-up.ts");
  assert.equal(r.edit!.create, true);
  assert.equal(r.edit!.content, EXPECTED);
  assert.equal(r.edit!.extra.length, 1);
  const t = r.edit!.extra[0]!;
  assert.match(t.path, /^src\/catch-up\.catch-up-sessions-[0-9a-f]{7}\.test\.ts$/);
  assert.match(t.content, /import \{ catchUpSessions \} from "\.\/catch-up\.ts";/);
  assert.equal(r.holes!.placement, "after");
  const h = loopModuleShape(r.edit!.path, r.edit!.content)!;
  assert.deepEqual(h, r.holes);
  const rd = (p: string) => (p === "src/catch-up.ts" ? r.edit!.content : FILES.find((f) => f.path === p && !isTest(p))?.content ?? null);
  assert.equal(gradeLoopModuleProblem(r.edit!.path, r.edit!.content, t.path, t.content, rd), null);
  // the stub keeps the import and signature; its lists are empty
  assert.match(loopStub(h)!, /return \{ reports: \[\], errors: \[\] \};/);
  // applyRule (the learned.ts EXISTING_EDIT dispatch) returns the same created module
  const why: { reason?: string } = {};
  const e = applyRule(LOOP, objective(TASK), FILES, isTest, undefined, why, () => false, undefined, TASK);
  assert.ok(e, why.reason);
  assert.equal(e.content, EXPECTED);
  assert.equal(e.create, true);
  // the error list stays empty: no catch, no error read (no error message can be emitted, Auditor #623 (2))
  assert.doesNotMatch(r.edit!.content, /\bcatch\s*[({]|\.message|throw/);
});

test("the derived module runs: stops after a not-ready report or a credential rejection, else goes over the whole list", async () => {
  const dir = mkdtempSync(join(tmpdir(), "m142-run-"));
  try {
    mkdirSync(join(dir, "src"));
    writeFileSync(join(dir, "src/contracts.ts"), CONTRACTS);
    writeFileSync(join(dir, "src/catch-up.ts"), derive(TASK, FILES).edit!.content);
    const mod = await import(pathToFileURL(join(dir, "src/catch-up.ts")).href) as { catchUpSessions: (m: string[], s: unknown) => Promise<{ reports: { status: string }[]; errors: unknown[] }> };
    const seen: [string, string][] = [];
    const scanner = (out: Record<string, { status: string; unresolvedFailures: string[] }>) => ({ run: async (d: string, mode: string) => { seen.push([d, mode]); return out[d] ?? { status: "COMPLETE", unresolvedFailures: [] }; } });
    let r = await mod.catchUpSessions(["d1", "d2", "d3"], scanner({}));
    assert.deepEqual([r.reports.length, r.errors], [3, []]);
    assert.deepEqual(seen, [["d1", "EVIDENCE_ONLY"], ["d2", "EVIDENCE_ONLY"], ["d3", "EVIDENCE_ONLY"]]);
    seen.length = 0;
    r = await mod.catchUpSessions(["d1", "d2", "d3"], scanner({ d2: { status: "PROVIDER_NOT_READY", unresolvedFailures: [] } }));
    assert.deepEqual(r.reports.map((x) => x.status), ["COMPLETE", "PROVIDER_NOT_READY"]);
    seen.length = 0;
    r = await mod.catchUpSessions(["d1", "d2", "d3"], scanner({ d1: { status: "FAILED", unresolvedFailures: ["x MASSIVE_CREDENTIAL_REJECTED y"] } }));
    assert.deepEqual([r.reports.length, seen.length], [1, 1], "the credential stop the prose states (not in the examples)");
    // a failing scan propagates (this ask handles no failure; v2's record ask adds the per-day catch)
    const bug = new TypeError("boom");
    await assert.rejects(mod.catchUpSessions(["d1"], { run: async () => { throw bug; } }), (e) => e === bug);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("the placement is fitted to the examples: a report that stops but is not kept selects stop-before-push", () => {
  const before = [
    `fake scannerB = { run: resolves(${rep("2026-10-01", "PROVIDER_NOT_READY")}) }`,
    `expect catchUpSessions(["2026-10-01", "2026-10-02"], scannerB) resolves to { reports: [], errors: [] }`,
    "expect scannerB.run is called 1 time",
  ];
  const r = derive(issue(HEAD, BEHAVIOR, [...FULL, ...before]), FILES);
  assert.equal(r.reason, null, r.detail);
  assert.equal(r.holes!.placement, "before");
  assert.match(r.edit!.content, /break;\n    reports\.push\(report\);/);
});

test("refusals by name", () => {
  const R = (body: string, files = FILES) => derive(body, files).reason;
  // the stop must be stated, from the closed set, on declared fields of the right type
  assert.equal(R(issue(HEAD, BEHAVIOR.replace(/ and stops right after .*? today\./, "."), [...FULL, ...STOPS])), "wire_loop_stop_unstated");
  assert.equal(R(issue(HEAD, BEHAVIOR.replace("whose status is", "whose status looks like"), [...FULL, ...STOPS])), "wire_loop_stop_unstated");
  assert.equal(R(issue(HEAD, BEHAVIOR.replace("whose status is", "whose state is"), [...FULL, ...STOPS])), "wire_loop_stop_field");
  assert.equal(R(issue(HEAD, BEHAVIOR.replace("whose status is PROVIDER_NOT_READY", "whose status is NOT_DUE"), [...FULL, ...STOPS])), "wire_loop_stop_field", "a word outside the status union");
  assert.equal(R(issue(HEAD, BEHAVIOR.replace("unresolved failures mention", "skips mention"), [...FULL, ...STOPS])), "wire_loop_stop_field", "an optional field");
  assert.equal(R(issue(HEAD, BEHAVIOR.replace("unresolved failures mention", "note mentions"), [...FULL, ...STOPS])), "wire_loop_stop_field", "a string field read as a list");
  // the collaborator's literal argument is stated in the prose
  assert.equal(R(issue(HEAD, BEHAVIOR.replace("in EVIDENCE_ONLY mode ", ""), [...FULL, ...STOPS])), "wire_loop_literal_unstated");
  // the report type must exist (exactly one exported declaration)
  assert.equal(R(TASK, [{ path: "src/contracts.ts", content: CONTRACTS.replace("export interface ScannerRunReport", "interface ScannerRunReport") }, FILES[1]!]), "wire_loop_type_missing");
  assert.equal(R(TASK, [...FILES, { path: "src/other.ts", content: "export interface ScannerRunReport {\n  status: string;\n}\n" }]), "wire_loop_type_ambiguous");
  // the module must be new
  assert.equal(R(TASK, [...FILES, { path: "src/catch-up.ts", content: "export const x = 1;\n" }]), "wire_loop_module_exists");
  // the signature: a string list, one collaborator method, literal-typed extra arguments
  assert.equal(R(TASK.replace("missed: string[]", "missed: number[]")), "wire_loop_signature");
  assert.equal(R(TASK.replace('mode: "EVIDENCE_ONLY"', "mode: string")), "wire_loop_signature");
  assert.equal(R(TASK.replace("error: string }", "error: number }")), "wire_loop_errors");
  // the examples: only resolving reports carrying the stop fields; a stop and a full run, each counted
  assert.equal(R(issue(HEAD, BEHAVIOR, [...FULL, ...STOPS, 'fake scannerC = { run: rejects("R2_REQUEST_FAILED:GET") }', 'expect catchUpSessions(["2026-10-01"], scannerC) rejects with "R2_REQUEST_FAILED:GET"', "expect scannerC.run is called 1 time"])), "wire_loop_entry", "a rejecting run: this ask handles no failure");
  assert.equal(R(issue(HEAD, BEHAVIOR, [...FULL, ...STOPS, 'fake scannerC = { run: rejects("R2_REQUEST_FAILED:GET") }', 'expect catchUpSessions(["2026-10-01"], scannerC) resolves to { reports: [], errors: [] }', "expect scannerC.run is called 1 time"])), "wire_loop_examples", "a rejecting fake");
  assert.equal(R(issue(HEAD, BEHAVIOR, [...FULL, ...STOPS, `fake scannerD = { run: resolves(${rep("2026-10-01", "COMPLETE")}) }`, 'expect catchUpSessions("2026-10-01", scannerD) resolves to { reports: [], errors: [] }'])), "wire_loop_entry", "the list is a list literal");
  assert.equal(R(issue(HEAD, BEHAVIOR, [...FULL, ...STOPS].map((b) => b.replace(/, unresolvedFailures: \[\]/g, "")))), "wire_loop_examples");
  assert.equal(R(issue(HEAD, BEHAVIOR, FULL)), "wire_loop_stop_unpinned");
  assert.equal(R(issue(HEAD, BEHAVIOR, STOPS)), "wire_loop_full_unpinned");
  assert.equal(R(issue(HEAD, BEHAVIOR, [...FULL, ...STOPS.slice(0, 2)])), "wire_loop_stop_unpinned", "the stop's call count is pinned");
  // an expected value no placement gives
  assert.equal(R(issue(HEAD, BEHAVIOR, [...FULL, ...STOPS].map((b) => b.replace("resolves to { reports: [{ session: { sessionDate: \"2026-10-01\" }, status: \"PROVIDER_NOT_READY\"", "resolves to { reports: [{ session: { sessionDate: \"2026-10-09\" }, status: \"PROVIDER_NOT_READY\"")))), "wire_no_fit");
  // code anywhere (a path and member access in the Behavior paragraph)
  assert.equal(R(issue(HEAD, BEHAVIOR.replace("in the host today", "in src/host.ts today"), [...FULL, ...STOPS])), "wire_behavior_code");
  // the issue reaches the objective cut
  assert.equal(R(issue(HEAD, BEHAVIOR + " " + "Plain words. ".repeat(160), [...FULL, ...STOPS])), "wire_task_truncated");
  // another spec's params or trigger
  assert.equal(deriveWireLoopDetail(LOOP.trigger, WIRE2.params, objective(TASK), FILES, isTest, TASK).reason, "wire_params");
  assert.equal(deriveWireLoopDetail(WIRE2.trigger, LOOP.params, objective(TASK), FILES, isTest, TASK).reason, "wire_params");
  // v2 does not read the loop header, and the loop spec does not read v2's
  assert.equal(deriveWireV2Detail(WIRE2.trigger, WIRE2.params, objective(TASK), FILES, isTest, TASK).reason, "wire_trigger");
});

test("Job B's recognizer refuses anything but the exact template", () => {
  const r = derive(TASK, FILES);
  const t = r.edit!.extra[0]!;
  const rd = (text: string) => (p: string) => (p === "src/catch-up.ts" ? text : FILES.find((f) => f.path === p && !isTest(p))?.content ?? null);
  const bad = [
    EXPECTED.replace("    reports.push(report);\n", "    reports.push(report);\n    console.log(session);\n"),
    EXPECTED.replace(" break;", " continue;"),
    EXPECTED.replace('report.status === "PROVIDER_NOT_READY"', 'report.status !== "PROVIDER_NOT_READY"'),
    EXPECTED.replace("  return { reports, errors };", "  errors.push({ day: \"x\", error: String(globalThis) });\n  return { reports, errors };"),
    EXPECTED.replace("const report = await scanner.run(session, \"EVIDENCE_ONLY\");", "const report = await scanner.run(session, \"EVIDENCE_ONLY\").catch((error: Error) => { throw new Error(error.message); });"),
    EXPECTED + "export const extra = 1;\n",
  ];
  for (const b of bad) {
    assert.equal(loopModuleShape("src/catch-up.ts", b), null, b);
    assert.equal(gradeLoopModuleProblem("src/catch-up.ts", b, t.path, t.content, rd(b)), "edit_not_confined");
  }
  // a type whose stop field changed type is refused on the graded tree too
  const rd2 = (p: string) => (p === "src/catch-up.ts" ? EXPECTED : p === "src/contracts.ts" ? CONTRACTS.replace("unresolvedFailures: string[];", "unresolvedFailures: number;") : null);
  assert.equal(gradeLoopModuleProblem("src/catch-up.ts", EXPECTED, t.path, t.content, rd2), "wire_loop_stop_field");
  // the builder refuses colliding or reserved names
  assert.equal(loopModule({ ...r.holes!, item: "missed" }), null);
  assert.equal(loopModule({ ...r.holes!, list: "default" }), null);
});

test("the derived module is the seam v2's record ask needs: the per-day catch derives on it next", () => {
  const mod = derive(TASK, FILES).edit!;
  const files = [...FILES, { path: mod.path, content: mod.content }];
  const body = issue(
    "In the existing function catchUpSessions in src/catch-up.ts, record a failing call and go on.",
    "when the scan of one missed day fails with an error whose message starts with R2 the day and the error message are recorded in errors and catch-up goes on to the next day. That day gets no report, so it is scanned again on a later run. Any other failure, such as a TypeError, is not swallowed: it stops the run.",
    [
      `fake scannerA = { run: sequence(rejects("R2_REQUEST_FAILED:GET"), resolves(${rep("2026-10-02", "COMPLETE")})) }`,
      `expect catchUpSessions(["2026-10-01", "2026-10-02"], scannerA) resolves to { reports: [${rep("2026-10-02", "COMPLETE")}], errors: [{ day: "2026-10-01", error: "R2_REQUEST_FAILED:GET" }] }`,
      "expect scannerA.run is called 2 times",
      'fake scannerB = { run: rejects("boom", { name: "TypeError" }) }',
      'expect catchUpSessions(["2026-10-01", "2026-10-02"], scannerB) rejects with "boom"',
      "expect scannerB.run is called 1 time",
    ],
  );
  const r = deriveWireV2Detail(WIRE2.trigger, WIRE2.params, cleanIssueText({ title: "record task", body } as never), files, isTest, body);
  assert.equal(r.reason, null, `${r.reason} ${r.detail}`);
  assert.equal(r.derivation!.kind, "record");
});

/** Run Job B (bin/test-candidates.ts) on a fixture repo with the derived candidate, under a fixture-local approval list. */
function jobB(files: { path: string; content: string }[], body: string, tamper?: (e: { path: string; content: string }) => string) {
  const dir = mkdtempSync(join(tmpdir(), "m142-"));
  try {
    const ws = join(dir, "ws");
    for (const f of files) { mkdirSync(join(ws, f.path, ".."), { recursive: true }); writeFileSync(join(ws, f.path), f.content); }
    writeFileSync(join(ws, "tsconfig.json"), JSON.stringify({ compilerOptions: { target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", strict: true, noEmit: true, allowImportingTsExtensions: true }, include: ["src"] }));
    writeFileSync(join(ws, "package.json"), JSON.stringify({ name: "m142", private: true, type: "module" }));
    writeFileSync(join(ws, ".gitignore"), "node_modules\n");
    symlinkSync(join(repo, "node_modules"), join(ws, "node_modules"));
    const git = (...a: string[]) => execFileSync("git", ["-c", "user.name=PeaceG03", "-c", `user.email=${PEACE_AUTHOR}`, ...a], { cwd: ws, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    git("init", "-q", "-b", "main"); git("add", "-A"); git("commit", "-qm", "base");
    const baseSha = git("rev-parse", "HEAD").trim();
    const why: { reason?: string } = {};
    const e = applyRule(LOOP, objective(body), files, isTest, undefined, why, () => false, undefined, body);
    assert.ok(e, why.reason);
    writeFileSync(join(ws, e.path), tamper ? tamper(e) : e.content);
    for (const x of e.extra ?? []) writeFileSync(join(ws, x.path), x.content);
    git("add", "-N", "--", e.path, ...(e.extra ?? []).map((x) => x.path));
    const diff = git("diff", "--no-color", "--full-index", "--no-renames");
    git("reset", "-q", "--hard"); git("clean", "-fdq");
    const inDir = join(dir, "in");
    mkdirSync(join(inDir, "candidates"), { recursive: true });
    writeFileSync(join(inDir, "candidates/candidate-1.diff"), diff);
    writeFileSync(join(inDir, "summary.json"), JSON.stringify({ schema: "peaceai-workspace-candidates:v1", taskId: "workspace-issue-9", baseSha, candidates: [{ id: "candidate-1", file: "candidates/candidate-1.diff", transformations: ["LEARNED_EXISTING_EDIT"], operationId: `learned:${LOOP.id}@${specHash(LOOP)}`, diffBytes: diff.length, diffLines: diff.split("\n").length, selfGrade: true }] }));
    // a fixture-local approval list (the repo's approved.json is never read or written here)
    const list = join(dir, "approved.json");
    writeFileSync(list, JSON.stringify({ schema: APPROVED_SCHEMA, rules: [{ id: LOOP.id, sha256: specHash(LOOP), source: "workspace", approval: { url: "https://github.com/PeaceG03/PeaceAI-Workspace/issues/40#issuecomment-123", commentId: 123, issue: 40, repo: "PeaceG03/PeaceAI-Workspace", author: "PeaceG03", approvedAt: "2026-10-11T00:00:00Z" } }] }));
    const resultsFile = join(dir, "out/results.json");
    mkdirSync(join(dir, "out"), { recursive: true });
    const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("NODE_TEST")));
    const p = spawnSync(tsx, [join(repo, "peaceai/bin/test-candidates.ts")], { cwd: repo, encoding: "utf8", env: { ...env, PEACEAI_IN_DIR: inDir, PEACEAI_RESULTS_FILE: resultsFile, PEACEAI_WORKSPACE_DIR: ws, PEACEAI_TARGET: "PeaceG03/PeaceAI-Workspace", PEACEAI_SANDBOX_USER: "", PEACEAI_REQUIRE_SANDBOX: "", PEACEAI_APPROVED_LIST: list } });
    assert.equal(p.status, 0, p.stderr);
    return { res: JSON.parse(readFileSync(resultsFile, "utf8")).results[0], log: p.stdout };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

test("Job B grades the created module end to end: the new test fails on the stub by assertions, passes on the module", { skip: Number(process.versions.node.split(".")[0]) < 22 && "needs Node >= 22" }, () => {
  const { res, log } = jobB(FILES, TASK);
  assert.equal(res.applied, true, log);
  assert.equal(res.typecheckPassed, true, log);
  assert.equal(res.originalSuitePassed, true, log);
  assert.equal(res.newTestsPassed, true, log);
  assert.equal(res.testGrading.afterFix, true, log);
  assert.equal(res.testGrading.beforeFix, false, log);
  assert.equal(res.testGrading.verdict, "COUNTS", log);
  assert.match(log, /grading: existing-edit \(module src\/catch-up\.ts; 2 load-closure files; before-run ok: false\)/);
  // a tampered module (an extra statement in the loop) never runs: the static gate refuses it first
  const t = jobB(FILES, TASK, (e) => e.content.replace("    reports.push(report);\n", "    reports.push(report);\n    reports.push(report);\n"));
  assert.match(t.log, /existing_edit_static=not-test-only/);
  assert.notEqual(t.res.testGrading?.verdict, "COUNTS");
});

// Job A (bin/generate.ts) end to end: the loop spec's module is NEW, so generate.ts must let an EXISTING_EDIT with the loop
// params through its new-module gate (the G28 generate.ts change). Without it, the candidate is dropped and none is made.
test("Job A: an approved loop spec makes one candidate that creates the module and its test (generate.ts new-module gate)", () => {
  const dir = mkdtempSync(join(tmpdir(), "m142a-"));
  try {
    const ws = join(dir, "ws");
    for (const f of FILES) { mkdirSync(join(ws, f.path, ".."), { recursive: true }); writeFileSync(join(ws, f.path), f.content); }
    writeFileSync(join(ws, "tsconfig.json"), JSON.stringify({ compilerOptions: { target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", strict: true, noEmit: true, allowImportingTsExtensions: true }, include: ["src"] }));
    writeFileSync(join(ws, "package.json"), JSON.stringify({ name: "m142", private: true, type: "module" }));
    writeFileSync(join(ws, ".gitignore"), "node_modules\n");
    symlinkSync(join(repo, "node_modules"), join(ws, "node_modules"));
    const git = (...a: string[]) => execFileSync("git", ["-c", "user.name=PeaceG03", "-c", `user.email=${PEACE_AUTHOR}`, ...a], { cwd: ws, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    git("init", "-q", "-b", "main"); git("add", "-A"); git("commit", "-qm", "base");
    const kernel = join(dir, "fake-kernel.cjs");
    writeFileSync(kernel, `const crypto = require("node:crypto");
exports.NATIVE_CODE_SYNTHESIS_PROTOCOL_VERSION = "x";
exports.sourceFingerprint = (p, c) => crypto.createHash("sha256").update(p + "\\0" + c).digest("hex");
exports.PeaceAINativeCodeSynthesizer = class { synthesize() { return { status: "INSUFFICIENT" }; } };
exports.parsePlanSteps = () => null;
`);
    const rules = join(dir, "rules");
    mkdirSync(rules);
    writeFileSync(join(rules, `${LOOP.id}.json`), JSON.stringify(LOOP));
    // a fixture-local approval list (the repo's approved.json is never read or written here)
    const list = join(dir, "approved.json");
    writeFileSync(list, JSON.stringify({ schema: APPROVED_SCHEMA, rules: [{ id: LOOP.id, sha256: specHash(LOOP), source: "workspace", approval: { url: "https://github.com/PeaceG03/PeaceAI-Workspace/issues/40#issuecomment-123", commentId: 123, issue: 40, repo: "PeaceG03/PeaceAI-Workspace", author: "PeaceG03", approvedAt: "2026-10-11T00:00:00Z" } }] }));
    const out = join(dir, "out");
    const r = spawnSync(tsx, [join(repo, "peaceai/bin/generate.ts")], {
      cwd: repo, encoding: "utf8", timeout: 300_000,
      env: { ...process.env, PEACEAI_NL_PARSE: "off", PEACEAI_KERNEL_BUNDLE: kernel, PEACEAI_OUT_DIR: out, PEACEAI_WORKSPACE_DIR: ws, PEACEAI_TARGET: "PeaceG03/PeaceAI-Workspace", ISSUE_NUMBER: "9", ISSUE_TITLE: "loop task", ISSUE_BODY: TASK, PEACEAI_RULES_DIR: rules, PEACEAI_APPROVED_LIST: list },
    });
    assert.equal(r.status, 0, r.stderr);
    const summary = JSON.parse(readFileSync(join(out, "summary.json"), "utf8")) as { candidates: { file: string; transformations: string[]; operationId: string; selfGrade?: boolean }[] };
    assert.equal(summary.candidates.length, 1, r.stdout);
    const c = summary.candidates[0]!;
    assert.deepEqual(c.transformations, ["LEARNED_EXISTING_EDIT"]);
    assert.equal(c.operationId, `learned:${LOOP.id}@${specHash(LOOP)}`);
    assert.equal(c.selfGrade, true);
    const diff = readFileSync(join(out, c.file), "utf8");
    assert.doesNotMatch(diff, /^-(?!--)/m, "no removed line: only new files");
    assert.match(diff, /^--- \/dev\/null\n\+\+\+ b\/src\/catch-up\.ts$/m, "creates the module");
    assert.match(diff, /^--- \/dev\/null\n\+\+\+ b\/src\/catch-up\.[a-z0-9-]+\.test\.ts$/m, "and its new test");
    assert.ok(diff.includes(EXPECTED.split("\n").map((l) => `+${l}`).slice(0, -1).join("\n")), "the module is the derived one");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
