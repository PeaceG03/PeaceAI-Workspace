// Plain-language sentences name a symbol and the existing repair proposer edits it.
// The sentences and fixtures are bakery, shipping, and music code, not practice-set rows.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import test from "node:test";
import ts from "typescript";
import vm from "node:vm";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { openRepo } from "../lib/codesearch.ts";
import { classifyJobOutput } from "../lib/capabilityjob.ts";
import { editAim, resolvableSymbols, textRepairBatches } from "../lib/editpropose.ts";
import { validateSummary } from "../lib/gate.ts";
import { understandIssue } from "../lib/issueunderstand.ts";
import { CASES, setup, teardown } from "./m236-text-edit-cases.ts";
import * as prop from "../lib/editpropose.ts";

test("five repair candidates fit the summary schema and six do not", () => {
  const one = (i: number) => ({ id: `candidate-${i}`, file: `candidates/candidate-${i}.diff`, transformations: ["REPAIR_V2"], operationId: null, diffBytes: 1, diffLines: 1 });
  const summary = (n: number) => ({ schema: "peaceai-workspace-candidates:v1", taskId: "workspace-issue-1", baseSha: "a".repeat(40), candidates: Array.from({ length: n }, (_, i) => one(i + 1)) });
  assert.equal(validateSummary(summary(5)), true);
  assert.equal(validateSummary(summary(6)), false);
});

test("a sentence the phrase list refuses still names the symbol it asks to change", () => {
  const ctx = setup();
  try {
    for (const c of CASES) c.run({ prop }, ctx);
  } finally { teardown(ctx); }
});

test("near misses stay unnamed, and the phrase list still refuses them", () => {
  const refusals = [
    "Thanks for the review of the patch",
    "Thanks for reviewing foldDough",
    "What does foldDough return?",
    "add option",
    "support the empty case",
    "Require Node.js 22",
    "foldDough looks ready",
    "foldDough chosen for the kilnTemp schedule",
    "Give users a clearer error",
    "lgtm",
    "The patch looks fine after a careful read",
    "Make it faster",
    "Make them clearer",
  ];
  for (const sentence of refusals) {
    assert.equal(editAim(sentence), null, sentence);
    const got = understandIssue({ title: sentence, body: sentence });
    assert.equal(got.status, "cant", sentence);
  }
  // A well-formed rename is the phrase list's job. It is not a body repair.
  assert.equal(editAim("rename foldDough to kneadDough"), null);
  assert.equal(understandIssue({ title: "rename foldDough to kneadDough", body: "rename foldDough to kneadDough" }).status, "mapped");
  const stillCant = [
    "handle foldDough",
    "support whisk",
    "fix quoteLane when miles is empty",
    "add option insulated",
    "`parseDate` returns wrong offset for a western zone",
    "debounce fires twice on the trailing edge",
    "Make the cache eviction respect TTL",
  ];
  for (const sentence of stillCant) {
    assert.ok(editAim(sentence), sentence);
    const got = understandIssue({ title: sentence, body: sentence });
    assert.equal(got.status, "cant", sentence);
  }
});

test("handling a discarded trim in a bakery function rewrites that call", () => {
  const root = mkdtempSync(join(tmpdir(), "peaceai-m236-oven-"));
  try {
    mkdirSync(join(root, "src"));
    const before = "export function foldDough(label: string): string {\n  label.trim();\n  return label;\n}\n";
    writeFileSync(join(root, "src/dough.ts"), before);
    const batches = textRepairBatches(openRepo(root), "please handle foldDough");
    const hit = batches.map((edits) => edits.map((e) => e.content).join("\n")).find((text) => text.includes("label = label.trim()"));
    assert.ok(hit, "the discarded trim was not repaired");
    assert.equal(before.includes("label = label.trim()"), false);
    const js = ts.transpileModule(hit!, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const mod = { exports: {} as { foldDough?: (label: string) => string } };
    vm.runInNewContext(js, { module: mod, exports: mod.exports }, { timeout: 1000 });
    assert.equal(mod.exports.foldDough!("  rye"), "rye");
    assert.equal(mod.exports.foldDough!("rye"), "rye");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("a symptom's subject is the repair target, and a later name is not", () => {
  const root = mkdtempSync(join(tmpdir(), "peaceai-m236-date-"));
  try {
    mkdirSync(join(root, "src"));
    writeFileSync(join(root, "src/date.ts"), "export function parseDate(text: string): number {\n  text.trim();\n  return text.length;\n}\n");
    writeFileSync(join(root, "src/zone.ts"), "export const zoneId = \"Z\";\n");
    const batches = textRepairBatches(openRepo(root), "`parseDate` returns wrong offset for zoneId");
    assert.ok(batches.length > 0);
    assert.ok(batches.every((edits) => edits.every((e) => e.path === "src/date.ts")));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("verbless bug titles and a causative name the symbol, including a public React title", () => {
  assert.deepEqual(editAim("`parseDate` returns wrong offset for a western zone")?.symbols, ["parseDate"]);
  assert.deepEqual(editAim("debounce fires twice on the trailing edge")?.symbols, ["debounce"]);
  assert.deepEqual(editAim("Make the cache eviction respect TTL")?.symbols, ["cacheEviction"]);
  // React docs, "You Might Not Need an Effect" / Strict Mode: effects run twice in development.
  assert.deepEqual(editAim("useEffect runs twice in Strict Mode")?.symbols, ["useEffect"]);
});

test("a capitalized ordinary word is kept only when one source file defines it", () => {
  assert.deepEqual(editAim("Docs run on Node 18")?.symbols, ["Docs"]);
  const root = mkdtempSync(join(tmpdir(), "peaceai-m236-docs-"));
  try {
    mkdirSync(join(root, "src/a"), { recursive: true });
    mkdirSync(join(root, "src/b"), { recursive: true });
    assert.deepEqual(resolvableSymbols(openRepo(root), ["Docs"]), []);
    writeFileSync(join(root, "src/a/guide.ts"), "export function Docs(topic: string): string { return topic; }\n");
    assert.deepEqual(resolvableSymbols(openRepo(root), ["Docs"]), ["Docs"]);
    writeFileSync(join(root, "src/b/other.ts"), "export function Docs(topic: string): string { return topic; }\n");
    assert.deepEqual(resolvableSymbols(openRepo(root), ["Docs"]), []);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("a plain word defined in two source files is not a target", () => {
  const root = mkdtempSync(join(tmpdir(), "peaceai-m236-two-"));
  try {
    mkdirSync(join(root, "src/a"), { recursive: true });
    mkdirSync(join(root, "src/b"), { recursive: true });
    writeFileSync(join(root, "src/a/one.ts"), "export function debounce(fn: () => void): void {\n  fn();\n}\n");
    writeFileSync(join(root, "src/b/two.ts"), "export function debounce(fn: () => void): void {\n  fn();\n}\n");
    assert.deepEqual(editAim("debounce fires twice")?.symbols, ["debounce"]);
    assert.equal(textRepairBatches(openRepo(root), "debounce fires twice").length, 0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("a repair with candidates is not an unsure refusal", () => {
  const wf = readFileSync(join(resolve(import.meta.dirname, "../.."), ".github/workflows/peace-task.yml"), "utf8");
  const unsure = wf.indexOf("Say the parser was unsure");
  assert.ok(unsure > 0);
  assert.match(wf.slice(unsure, unsure + 400), /if: env\.NL_REASON != '' && env\.NO_CANDIDATES == 'true'/);
  assert.match(wf, /needs\.generate\.outputs\.candidates == '0'/);
  const gen = readFileSync(join(resolve(import.meta.dirname, "../.."), "peaceai/bin/generate.ts"), "utf8");
  assert.match(gen, /writeOutput\(\{ nl: "repair", nl_reason: "", nl_hint: "", nl_steps: "" \}\);/);
  assert.match(gen, /can't do yet: \$\{understood\.reason\}/);
  assert.equal(classifyJobOutput({ timedOut: false, code: 0, candidates: 1, stdout: "nl=repair\ntext-repair candidates=1\n" }).status, "pass");
  assert.equal(classifyJobOutput({ timedOut: false, code: 0, candidates: 0, stdout: "nl=unsure reason=NOT_SUPPORTED\ncan't do yet: CANT_DO_YET_NO_EDIT\n" }).reason, "CANT_DO_YET_NO_EDIT");
});

const repo = resolve(import.meta.dirname, "../..");
const tsx = join(repo, "node_modules/.bin/tsx");
const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

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

test("Job A emits a repair diff for a handle sentence and refuses a thanks sentence", () => {
  const dir = mkdtempSync(join(tmpdir(), "peaceai-m236-job-"));
  try {
    const ws = join(dir, "ws");
    mkdirSync(join(ws, "src"), { recursive: true });
    writeFileSync(join(ws, "src/dough.ts"), "export function foldDough(label: string): string {\n  label.trim();\n  return label;\n}\n");
    git(ws, "init", "-q");
    git(ws, "add", "-A");
    git(ws, "-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-qm", "c");
    const run = (body: string) => {
      const out = join(dir, `out-${body.length}`);
      const r = spawnSync(tsx, [join(repo, "peaceai/bin/generate.ts")], {
        cwd: repo, encoding: "utf8",
        env: {
          ...process.env,
          PEACEAI_KERNEL_BUNDLE: fakeKernel(dir),
          PEACEAI_OUT_DIR: out,
          PEACEAI_WORKSPACE_DIR: ws,
          PEACEAI_TARGET: "PeaceG03/PeaceAI-Workspace",
          ISSUE_NUMBER: "236",
          ISSUE_TITLE: body,
          ISSUE_BODY: body,
        },
      });
      const summaryPath = join(out, "summary.json");
      const summary = readFileSync(summaryPath, "utf8");
      return { r, summary: JSON.parse(summary) as { candidates: { file: string; transformations: string[] }[] }, out };
    };
    const handled = run("handle foldDough");
    assert.equal(handled.r.status, 0, handled.r.stderr);
    assert.match(handled.r.stdout, /nl=repair/);
    assert.doesNotMatch(handled.r.stdout, /nl=unsure/);
    assert.match(handled.r.stdout, /text-repair candidates=/);
    assert.ok(handled.summary.candidates.length > 0);
    assert.deepEqual(handled.summary.candidates[0]!.transformations, ["REPAIR_V2"]);
    const diff = readFileSync(join(handled.out, handled.summary.candidates[0]!.file), "utf8");
    assert.match(diff, /label = label\.trim\(\)/);
    const thanks = run("Thanks for the review of the patch");
    assert.equal(thanks.r.status, 0, thanks.r.stderr);
    assert.match(thanks.r.stdout, /can't do yet: CANT_DO_YET_NO_EDIT/);
    assert.equal(thanks.summary.candidates.length, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
