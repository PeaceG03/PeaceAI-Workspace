// Auditor #491 (B2): one behavioral test per DERIVE_FROM_BEHAVIOR guard, each shown to FAIL with its guard removed
// (the mutation proofs are recorded in peaceai/proof/m99-derive-mutation-proof.md):
//   Job B's derived-module check, its 3-zone re-runs and their confinement (--permission);
//   generate.ts's raw-issue check (``` and ~~~ fences, HTML comments, indented code);
//   DERIVE_BUDGET (the search budget and its clamp), MAX_KEPT_CELLS (the memory bound and its clamp, by assertion), the DERIVE_MAX_SIZE clamp;
//   the emit-time checks of buildDeriveEdit (size cap, body vocabulary, strict allowlist);
//   the constant-program filter.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { APPROVED_SCHEMA } from "../lib/approved.ts";
import { DERIVE_BUDGET, deriveProgram, keptCellsLimit, MAX_KEPT_CELLS, type DeriveInput, type DeriveNode, type DeriveResult } from "../lib/derive.ts";
import { applyRule, specHash, type RuleSpec } from "../lib/learned.ts";
import { buildDeriveEdit, DERIVE_VOCAB, parseDeriveTask, DERIVE_TRIGGER } from "../lib/learned-derive.ts";
import { PEACE_AUTHOR } from "../lib/minetest.ts";
import { validateResults } from "../lib/results.ts";
import { cleanIssueText } from "../lib/taskmap.ts";

const repo = resolve(import.meta.dirname, "..", "..");
const tsx = join(repo, "node_modules/.bin/tsx");
const SPEC = JSON.parse(readFileSync(join(repo, "peaceai/rules/learned/public-derive-from-behavior-v1.json"), "utf8")) as RuleSpec;
const SHA = specHash(SPEC);
const CONFINED = Number(process.versions.node.split(".")[0]) >= 22;
const git = (cwd: string, ...a: string[]) => execFileSync("git", ["-c", "user.name=PeaceG03", "-c", `user.email=${PEACE_AUTHOR}`, ...a], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const HOST = "export const x = 1;\n";
const HOST_TEST = 'import test from "node:test";\nimport { x } from "./host.ts";\ntest("base", () => { if (x !== 1) throw new Error("x"); });\n';
const FILES = [{ path: "src/host.ts", content: HOST }, { path: "src/host.test.ts", content: HOST_TEST }];
const TSCONFIG = JSON.stringify({ compilerOptions: { target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", strict: true, noEmit: true, allowImportingTsExtensions: true }, include: ["src"] });
const S1 = `Add a new module \`src/r2-retry-status.ts\` exporting \`isRetryableR2Status(status: number): boolean\`.

Behavior: given the HTTP status code of a reply from R2, answer true when the request is worth retrying and false when it is not. Worth retrying: 429 and every server error status from 500 through 599.

Examples:
${[[429, true], [500, true], [502, true], [550, true], [599, true], [428, false], [430, false], [499, false], [600, false], [700, false], [200, false], [404, false], [0, false]].map(([a, b]) => `- ${a} gives ${b}`).join("\n")}`;
const entry = { id: SPEC.id, sha256: SHA, source: "workspace", approval: { url: "https://github.com/PeaceG03/PeaceAI-Workspace/issues/40#issuecomment-123", commentId: 123, issue: 40, repo: "PeaceG03/PeaceAI-Workspace", author: "PeaceG03", approvedAt: "2026-10-11T00:00:00Z" } };

// ---- Job B (test-candidates.ts gradeSelf, derive branch)

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "m99g-"));
  const ws = join(dir, "ws");
  mkdirSync(join(ws, "src"), { recursive: true });
  for (const f of FILES) writeFileSync(join(ws, f.path), f.content);
  writeFileSync(join(ws, "tsconfig.json"), TSCONFIG);
  // The confined runs may read package.json files inside the tree only, so the tree has one (as every target does).
  writeFileSync(join(ws, "package.json"), '{ "type": "module" }\n');
  writeFileSync(join(ws, ".gitignore"), "node_modules\n");
  symlinkSync(join(repo, "node_modules"), join(ws, "node_modules"));
  git(ws, "init", "-q", "-b", "main"); git(ws, "add", "-A"); git(ws, "commit", "-qm", "base");
  const baseSha = git(ws, "rev-parse", "HEAD").trim();
  /** The S1 candidate, with its module and / or test text changed by `tamper`. */
  const candidate = (tamper: { module?: (s: string) => string; test?: (s: string) => string } = {}) => {
    const e = applyRule(SPEC, cleanIssueText({ title: "derive", body: S1 } as never), FILES, (p) => /\.test\.ts$/.test(p))!;
    assert.ok(e, "S1 derives");
    writeFileSync(join(ws, e.path), (tamper.module ?? ((s) => s))(e.content));
    const t = e.extra![0]!;
    writeFileSync(join(ws, t.path), (tamper.test ?? ((s) => s))(t.content));
    git(ws, "add", "-N", "--", e.path, t.path);
    const d = git(ws, "diff", "--no-color", "--full-index", "--no-renames");
    git(ws, "reset", "-q", "--hard"); git(ws, "clean", "-fdq");
    return d;
  };
  return { dir, ws, baseSha, candidate };
}

function grade(fx: ReturnType<typeof fixture>, diff: string) {
  const inDir = join(fx.dir, "in");
  rmSync(inDir, { recursive: true, force: true });
  mkdirSync(join(inDir, "candidates"), { recursive: true });
  writeFileSync(join(inDir, "candidates", "candidate-1.diff"), diff);
  const candidates = [{ id: "candidate-1", file: "candidates/candidate-1.diff", transformations: ["LEARNED_DERIVE_FROM_BEHAVIOR"], operationId: `learned:${SPEC.id}@${SHA}`, diffBytes: diff.length, diffLines: 5, selfGrade: true as const }];
  writeFileSync(join(inDir, "summary.json"), JSON.stringify({ schema: "peaceai-workspace-candidates:v1", taskId: "workspace-issue-9", baseSha: fx.baseSha, candidates }));
  const list = join(fx.dir, "approved.json");
  writeFileSync(list, JSON.stringify({ schema: APPROVED_SCHEMA, rules: [entry] }));
  const out = join(fx.dir, "out");
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("NODE_TEST")));
  const r = spawnSync(tsx, [join(repo, "peaceai/bin/test-candidates.ts")], {
    cwd: repo, encoding: "utf8", timeout: 600_000,
    env: { ...env, TZ: "UTC", PEACEAI_IN_DIR: inDir, PEACEAI_RESULTS_FILE: join(out, "results.json"), PEACEAI_WORKSPACE_DIR: fx.ws, PEACEAI_TARGET: "PeaceG03/PeaceAI-Workspace", PEACEAI_SANDBOX_USER: "", PEACEAI_REQUIRE_SANDBOX: "", PEACEAI_APPROVED_LIST: list },
  });
  assert.equal(r.status, 0, r.stderr);
  const results = JSON.parse(readFileSync(join(out, "results.json"), "utf8"));
  assert.ok(validateResults(results));
  return { g: results.results[0].testGrading as { verdict: string; reason: string | null; stubFails?: boolean }, stdout: r.stdout };
}

test("Job B derive: the untouched candidate COUNTS; a module that is not exactly a derived function is not-test-only", { skip: !CONFINED && "Node < 22: derive candidates grade not-confined" }, () => {
  const fx = fixture();
  try {
    const good = grade(fx, fx.candidate());
    assert.equal(good.g.verdict, "COUNTS", good.stdout);
    assert.equal(good.g.stubFails, true);
    // Passes its tests, stub fails them, but reads the environment: only derivedModuleProblem stops it.
    const env = grade(fx, fx.candidate({ module: (s) => s.replace(/return (.*);/, 'return ($1) || process.env.PEACE_X === "1";') }));
    assert.deepEqual([env.g.verdict, env.g.reason], ["UNGRADABLE", "not-test-only"], env.stdout);
  } finally { rmSync(fx.dir, { recursive: true, force: true }); }
});

test("Job B derive: the new tests are re-run in UTC, America/Denver and Asia/Tokyo, confined; a zone-dependent or fs-reading test is real-not-stable", { skip: !CONFINED && "Node < 22: derive candidates grade not-confined" }, () => {
  const fx = fixture();
  try {
    // Passes in the harness's own zone (UTC), fails only in Asia/Tokyo: only the zone re-runs catch it.
    const tz = grade(fx, fx.candidate({ test: (s) => s.replace(/\n\}\);\n$/, "\n  assert.notEqual(new Date(0).getTimezoneOffset(), -540);\n});\n") }));
    assert.deepEqual([tz.g.verdict, tz.g.reason], ["UNGRADABLE", "real-not-stable"], tz.stdout);
    // Each zone run is its own run: a test that fails only when the zone is SET to America/Denver, or to UTC, passes
    // the harness's own run (zone not set; the machine's default) and is caught only by that zone's re-run.
    for (const zone of ["America/Denver", "UTC"]) {
      const z = grade(fx, fx.candidate({ test: (s) => s.replace(/\n\}\);\n$/, `\n  assert.notEqual(process.env.TZ, ${JSON.stringify(zone)});\n});\n`) }));
      assert.deepEqual([z.g.verdict, z.g.reason], ["UNGRADABLE", "real-not-stable"], `${zone}: ${z.stdout}`);
    }
    // Reads a file outside the test, the module and node_modules: passes unconfined, fails under --permission.
    const fs = grade(fx, fx.candidate({ test: (s) => s.replace('import test from "node:test";', 'import test from "node:test";\nimport { readFileSync } from "node:fs";').replace(/\n\}\);\n$/, "\n  assert.ok(readFileSync(process.execPath).length > 0);\n});\n") }));
    assert.deepEqual([fs.g.verdict, fs.g.reason], ["UNGRADABLE", "real-not-stable"], fs.stdout);
  } finally { rmSync(fx.dir, { recursive: true, force: true }); }
});

// ---- Job A (generate.ts): the raw issue body is checked before cleaning drops fenced code and comments

function fakeKernel(dir: string): string {
  const file = join(dir, "fake-kernel.cjs");
  writeFileSync(file, `const crypto = require("node:crypto");
exports.NATIVE_CODE_SYNTHESIS_PROTOCOL_VERSION = "x";
exports.sourceFingerprint = (p, c) => crypto.createHash("sha256").update(p + "\\0" + c).digest("hex");
exports.PeaceAINativeCodeSynthesizer = class { synthesize() { return { status: "INSUFFICIENT" }; } };
exports.parsePlanSteps = () => null;
`);
  return file;
}
function jobA(body: string) {
  const dir = mkdtempSync(join(tmpdir(), "m99a-"));
  try {
    const ws = join(dir, "ws");
    mkdirSync(join(ws, "src"), { recursive: true });
    for (const f of FILES) writeFileSync(join(ws, f.path), f.content);
    git(ws, "init", "-q"); git(ws, "add", "-A"); git(ws, "commit", "-qm", "base");
    const rules = join(dir, "rules");
    mkdirSync(rules);
    writeFileSync(join(rules, `${SPEC.id}.json`), JSON.stringify(SPEC));
    const list = join(dir, "approved.json");
    writeFileSync(list, JSON.stringify({ schema: APPROVED_SCHEMA, rules: [entry] }));
    const out = join(dir, "out");
    const r = spawnSync(tsx, [join(repo, "peaceai/bin/generate.ts")], {
      cwd: repo, encoding: "utf8", timeout: 300_000,
      env: { ...process.env, PEACEAI_NL_PARSE: "off", PEACEAI_KERNEL_BUNDLE: fakeKernel(dir), PEACEAI_OUT_DIR: out, PEACEAI_WORKSPACE_DIR: ws, PEACEAI_TARGET: "PeaceG03/PeaceAI-Workspace", ISSUE_NUMBER: "9", ISSUE_TITLE: "derive task", ISSUE_BODY: body, PEACEAI_RULES_DIR: rules, PEACEAI_APPROVED_LIST: list },
    });
    assert.equal(r.status, 0, r.stderr);
    const summary = existsSync(join(out, "summary.json")) ? JSON.parse(readFileSync(join(out, "summary.json"), "utf8")) : null;
    return { stdout: r.stdout, n: summary?.candidates.length ?? -1 };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

test("Job A: code hidden where cleaning drops it (``` / ~~~ fences, HTML comments, indented code) refuses the derive rule; the clean issue makes a candidate", () => {
  const clean = jobA(S1);
  assert.equal(clean.n, 1, clean.stdout);
  for (const [label, extra] of [
    ["backtick fence", "\n\n```ts\nreturn status === 429 || (500 <= status && status <= 599);\n```\n"],
    ["tilde fence", "\n\n~~~ts\nreturn status === 429 || (500 <= status && status <= 599);\n~~~\n"],
    ["html comment", "\n\n<!-- return status === 429 || (500 <= status && status <= 599); -->\n"],
    ["indented code", "\n\n    return status === 429 || (500 <= status && status <= 599);\n"],
    // The raw check on its own: blocks whose text the cleaned-issue guard would let through (cleaning keeps ~~~ blocks
    // and collapses indentation, so only the raw body shows them as blocks).
    ["tilde fence, plain words", "\n\n~~~\nsee the retry table in the wiki\n~~~\n"],
    ["indented block, plain words", "\n\n    see the retry table in the wiki\n"],
  ] as const) {
    const r = jobA(S1 + extra);
    assert.equal(r.n, 0, `${label}: ${r.stdout}`);
    assert.match(r.stdout, new RegExp(`learned refusals: ${SPEC.id}=derive_behavior_code`), label);
  }
});

// ---- The search bounds

const n1 = [{ name: "x", type: "number" as const }];
const parity = (ret: "number" | "boolean", k: number) => Array.from({ length: k }, (_, i) => ({ args: [i * 3], out: ret === "boolean" ? i % 2 === 0 : i % 2 }));
const why = (r: DeriveResult) => (r.ok ? `ok ${r.fit.expr}` : `${r.reason}${r.gate ? `/${r.gate}` : ""}`);

test("budget: the search stops at the caller's budget, and a larger budget is clamped to DERIVE_BUDGET", () => {
  const small = deriveProgram({ params: n1, ret: "number", examples: parity("number", 6), budget: 5000 });
  assert.deepEqual([why(small), small.searched], ["derive_budget", 5001]);
  const huge = deriveProgram({ params: n1, ret: "number", examples: parity("number", 6), budget: 1e12 });
  assert.deepEqual([why(huge), huge.searched], ["derive_budget", DERIVE_BUDGET + 1]);
});

test("memory: a search over many points stops at MAX_KEPT_CELLS (derive_budget) long before DERIVE_BUDGET programs", () => {
  const p3 = ["a", "b", "c"].map((name) => ({ name, type: "number" as const }));
  const examples = Array.from({ length: 40 }, (_, i) => ({ args: [i % 7, (i * 3) % 11, (i * 5) % 13], out: (i * 7919) % 101 }));
  const r = deriveProgram({ params: p3, ret: "number", examples });
  assert.equal(why(r), "derive_budget");
  assert.ok(r.searched < DERIVE_BUDGET / 4, `${r.searched}`);
});

// The memory bound by assertion (the test above can only crash when the bound is gone): S1 derives within the default
// bound, and the same search under a smaller bound stops with derive_budget well before its program budget.
test("memory: the kept-values bound stops the search (derive_budget); a caller's bound is clamped to MAX_KEPT_CELLS", () => {
  const s1 = [[429, true], [500, true], [502, true], [550, true], [599, true], [428, false], [430, false], [499, false], [600, false], [700, false], [200, false], [404, false], [0, false]] as const;
  const input: DeriveInput = { params: [{ name: "status", type: "number" }], ret: "boolean", examples: s1.map(([a, b]) => ({ args: [a], out: b })) };
  const full = deriveProgram(input);
  assert.equal(why(full), "ok (status === 429) || (500 <= status && status <= 599)");
  const capped = deriveProgram({ ...input, maxKeptCells: 20_000 });
  assert.equal(why(capped), "derive_budget");
  assert.ok(capped.searched < full.searched, `${capped.searched} vs ${full.searched}`);
  assert.equal(keptCellsLimit({}), MAX_KEPT_CELLS);
  assert.equal(keptCellsLimit({ maxKeptCells: 1000 }), 1000);
  assert.equal(keptCellsLimit({ maxKeptCells: MAX_KEPT_CELLS * 1000 }), MAX_KEPT_CELLS);
});

test("size: maxSize above DERIVE_MAX_SIZE (13) searches exactly what 13 does", () => {
  const input: DeriveInput = { params: n1, ret: "boolean", examples: parity("boolean", 8), budget: 1_200_000 };
  const at13 = deriveProgram({ ...input, maxSize: 13 });
  const at99 = deriveProgram({ ...input, maxSize: 99 });
  assert.equal(why(at13), "derive_no_fit");
  assert.deepEqual([why(at99), at99.searched], [why(at13), at13.searched]);
});

// ---- buildDeriveEdit's emit-time checks: fed a program the search never produces, each layer refuses with its own code

const task = (() => { const p = parseDeriveTask(DERIVE_TRIGGER, cleanIssueText({ title: "t", body: S1 } as never)); assert.ok("task" in p); return p.task; })();
const PARAMS = Object.fromEntries(Object.entries(DERIVE_VOCAB).map(([k, v]) => [k, v[0]]));
const fake = (program: DeriveNode) => (_: DeriveInput): DeriveResult => ({ ok: true, fit: { program, size: 1, expr: "" }, probes: [], searched: 0 });
const emit = (program: DeriveNode) => { const b = buildDeriveEdit(PARAMS, task, FILES, undefined, fake(program)); return "reason" in b ? b.reason : "edit"; };

test("emit checks: size cap (derive_emit_size), then body vocabulary (derive_expr_vocab), then the strict allowlist", () => {
  const status: DeriveNode = { op: "param", i: 0 };
  assert.equal(emit({ op: "le", a: status, b: { op: "lit", v: 5 } }), "edit");
  // Over 400 characters (the allowlist would refuse it too, as derive_expr_size): the cap answers first.
  let long: DeriveNode = status;
  for (let i = 0; i < 40; i++) long = { op: "add", a: long, b: { op: "lit", v: 1234567 }};
  assert.equal(emit({ op: "le", a: long, b: { op: "lit", v: 5 }}), "derive_emit_size");
  // A name that is not a parameter (and that the allowlist refuses too): the body vocabulary answers first.
  assert.equal(emit({ op: "eq", a: { op: "param", i: 3 }, b: { op: "lit", v: 1 }}), "derive_expr_vocab");
  // Allowed by the body vocabulary, refused by the strict allowlist only (a compared, memorized string).
  assert.equal(emit({ op: "eq", a: status, b: { op: "lit", v: "read_file" } }), "derive_expr_memorize");
});

// ---- The constant-program filter: a program that reads a parameter but has one value at every point (`x - x`) is
// treated as a constant, so it is never squared, capped or combined with another constant. The filter changes no
// result, only how many programs the search builds: with it, S1's and S2's main searches finish inside exactly the
// budget they need (the run then goes on to the rival search, which that budget does not cover); without it the
// same budget runs out first (derive_budget).

test("constant programs: the filtered search finishes S1 and S2 within the programs they need (unfiltered: derive_budget)", () => {
  const s1 = [[429, true], [500, true], [502, true], [550, true], [599, true], [428, false], [430, false], [499, false], [600, false], [700, false], [200, false], [404, false], [0, false]] as const;
  const s2 = [[0, 1000, 1000], [1, 1000, 4000], [2, 1000, 9000], [3, 1000, 16000], [4, 1000, 25000], [5, 1000, 30000], [10, 1000, 30000], [0, 500, 500], [1, 500, 2000], [2, 250, 2250], [0, 0, 0], [7, 0, 0], [0, 40000, 30000]] as const;
  const S1x: DeriveInput = { params: [{ name: "status", type: "number" }], ret: "boolean", examples: s1.map(([a, b]) => ({ args: [a], out: b })) };
  const S2x: DeriveInput = { params: [{ name: "attempt", type: "number" }, { name: "baseMs", type: "number" }], ret: "number", examples: s2.map(([a, b, c]) => ({ args: [a, b], out: c })) };
  assert.equal(why(deriveProgram(S1x)), "ok (status === 429) || (500 <= status && status <= 599)");
  for (const [input, need] of [[S1x, 20_405], [S2x, 191_447]] as const) {
    assert.equal(why(deriveProgram({ ...input, budget: need })), "derive_under_specified/rival_budget");
    assert.equal(why(deriveProgram({ ...input, budget: need - 1 })), "derive_budget");
  }
});
