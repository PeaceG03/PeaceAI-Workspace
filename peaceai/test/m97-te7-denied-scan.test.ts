// Auditor #466 (c), option A (joint Builder + Auditor decision): denied in-scope files (PeaceSTOCKS's host / scheduler /
// backfill, `secret`, `token`, ...) join the TEST_CASE_EXISTING static shared-binding scan ONLY. repoFileLists builds
// both lists with two separate outputs: `context` (never a denied file) and `scan` (denied files included). Conditions:
// (1) a denied file's text never reaches context, prompts, records, logs or artifacts (canary, Job A and Job B end to end);
// (2) denied files are never targets or edits; (3) the scan caps count denied files and fail closed; (4) a denied file
// that writes or hands out a tracked binding refuses.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { APPROVED_SCHEMA } from "../lib/approved.ts";
import { applyRule, specHash, type RuleSpec } from "../lib/learned.ts";
import { existingTargetRefusal, MAX_SCAN_BYTES, MAX_SCAN_FILES, repoFileLists, TEST_TARGET_TOO_LARGE } from "../lib/learned-test-existing.ts";
import { PEACE_AUTHOR } from "../lib/minetest.ts";
import { loadTargets, scopeOf } from "../lib/target.ts";

const root = resolve(import.meta.dirname, "../..");
const read = (p: string) => readFileSync(resolve(root, p), "utf8");
const STOCKS = scopeOf(loadTargets().targets["PeaceG03/PeaceSTOCKS"]!);
const SPEC = JSON.parse(read("peaceai/rules/learned/public-test-case-existing-v1.json")) as RuleSpec;
const SHA = specHash(SPEC);
const isTest = (p: string) => /\.test\.ts$/.test(p);
const CANARY = "CANARY-7f3e91c2-denied-text-never-leaves-the-scan";

const MOD = 'export const R: ReadonlySet<string> = new Set(["A", "B"]);\nexport function isR(x: string): boolean { return R.has(x); }\n';
// PeaceSTOCKS-shaped barrel: re-exports a denied module (src/index.ts `export * from "./scheduler"`), not the target's.
const INDEX = 'export * from "./host";\n';
const HOST_OK = `// ${CANARY}\nimport { R } from "./m";\nexport const hostLabel = "${CANARY}";\nexport function hostHas(x: string): boolean { return R.has(x); }\n`;
const HOST_WRITES = `// ${CANARY}\nimport { R } from "./m";\nexport const hostLabel = "${CANARY}";\nexport function hostAdd(x: string): void { (R as Set<string>).add(x); }\n`;
const HOST_HANDS_OUT = `// ${CANARY}\nimport { R } from "./m";\nexport const hostLabel = "${CANARY}";\nexport function hostSet(): ReadonlySet<string> { return R; }\n`;
const TASK = 'add a characterization test for isR in src/m.ts\n- isR("A") is true\n- isR("Z") is false';

const lists = (host: string, extra: Record<string, string> = {}) => {
  const all: Record<string, string> = { "src/m.ts": MOD, "src/index.ts": INDEX, "src/host.ts": host, "src/base.test.ts": 'import test from "node:test";\ntest("b", () => {});\n', ...extra };
  return repoFileLists(Object.keys(all), STOCKS, (p) => all[p] ?? null);
};

test("repoFileLists: one helper, two separate outputs; context never holds a denied file, scan holds every in-scope file", () => {
  const all: Record<string, string> = { "src/a.ts": "a", "src/a.test.ts": "t", "src/host.ts": "h", "src/my-secret.ts": "s", "src/fixtures/x.ts": "f", "docs/x.ts": "d", "src/gone.ts": "" };
  const { context, scan } = repoFileLists([...Object.keys(all), "src/a.ts", ""], STOCKS, (p) => (p === "src/gone.ts" ? null : all[p] ?? null));
  assert.deepEqual(context.map((f) => f.path), ["src/a.ts", "src/a.test.ts"]);
  assert.deepEqual(scan.map((f) => f.path), ["src/a.ts", "src/a.test.ts", "src/host.ts", "src/my-secret.ts", "src/fixtures/x.ts"]);
  for (const f of context) assert.equal(STOCKS.isDenied(f.path), false);
});

test("Job A rule: an `export *` of a denied module is followed by the scan (accepted when it only reads the binding)", () => {
  const l = lists(HOST_OK);
  const w: { reason?: string } = {};
  assert.ok(applyRule(SPEC, TASK, l.context, isTest, undefined, w, () => false, l.scan), w.reason);
  // without the scan list, the denied module is unresolvable: fail closed
  const w2: { reason?: string } = {};
  assert.equal(applyRule(SPEC, TASK, l.context, isTest, undefined, w2, () => false), null);
  assert.equal(w2.reason, "test_target_impure");
});

test("(4) a denied file that writes or hands out the binding refuses (Job A rule and Job B options)", () => {
  for (const host of [HOST_WRITES, HOST_HANDS_OUT]) {
    const l = lists(host);
    const w: { reason?: string } = {};
    assert.equal(applyRule(SPEC, TASK, l.context, isTest, undefined, w, () => false, l.scan), null);
    assert.equal(w.reason, "test_target_impure");
    const why: { shared?: string } = {};
    const rd = { read: (rel: string) => l.context.find((f) => f.path === rel)?.content ?? null };
    for (const o of [{ load: rd }, { v2: rd }, { v2: rd, dates: true, v4: true, v5: true, v6: true, v7: true }]) assert.notEqual(existingTargetRefusal("src/m.ts", MOD, "isR", { ...o, repo: l.scan, why }), null);
    assert.match(why.shared ?? "", /src\/host\.ts:\d+$/, "the diagnostic names the file and line only, never its text");
    assert.equal((why.shared ?? "").includes(CANARY), false);
  }
});

test("(2) scanning never makes a denied file a target: Job A refuses a task naming one; Job B refuses a test importing one", () => {
  const l = lists(HOST_OK);
  const w: { reason?: string } = {};
  assert.equal(applyRule(SPEC, 'add a characterization test for hostHas in src/host.ts\n- hostHas("A") is true', l.context, isTest, undefined, w, () => false, l.scan), null);
  assert.equal(w.reason, "target_file_not_found");
  const tc = read("peaceai/bin/test-candidates.ts");
  assert.match(tc, /if \(!baseFiles\.has\(modPath\) \|\| !scope\.isSource\(modPath\) \|\| scope\.isTest\(modPath\) \|\| scope\.isDenied\(modPath\)\) return ungradable\("not-test-only"\);/);
  // edits / proposals stay on the context list: generate.ts hands rules `candidatesForContext`, the scan list only as `scan`
  const gen = read("peaceai/bin/generate.ts");
  assert.match(gen, /const repoLists = repoFileLists\(tracked, scope, /);
  assert.match(gen, /const candidatesForContext = repoLists\.context;\nconst scanOnlyFiles = repoLists\.scan;/);
  assert.equal((gen.match(/scanOnlyFiles/g) ?? []).length, 2, "the scan list is used once: the applyRule scan argument");
  assert.match(gen, /applyRule\(a\.spec, objectiveText, \[\.\.\.candidatesForContext, \.\.\.workflowFiles\], scope\.isTest, target, why, newPathExists, \[\.\.\.scanOnlyFiles, \.\.\.workflowFiles\]\)/);
  assert.match(tc, /const repo = repoFileLists\(gitIn\(tree, "ls-files", "-z", "--cached", "--others", "--exclude-standard"\)\.split\("\\0"\), scope, regular\)\.scan;/);
  const lib = read("peaceai/lib/learned.ts");
  assert.match(lib, /return runExistingTestRule\(spec\.trigger, spec\.params, objective, files, isTest, why, scan\);/);
  assert.match(lib, /const edit = applyRuleInner\(spec, objective, files, isTest, repo, why, scan\);/);
});

test("(3) the scan caps count denied files and fail closed", () => {
  const extra: Record<string, string> = {};
  for (let i = 0; i <= MAX_SCAN_FILES; i++) extra[`src/secret-${i}.ts`] = "export const z = 1;\n";
  const many = lists(HOST_OK, extra);
  assert.equal(many.context.length, 3, "the denied files are not context");
  const why: { shared?: string } = {};
  assert.equal(existingTargetRefusal("src/m.ts", MOD, "isR", { v2: { read: () => null }, repo: many.scan, why }), TEST_TARGET_TOO_LARGE);
  const big = lists(HOST_OK, { "src/token-blob.ts": `export const z = "${"x".repeat(MAX_SCAN_BYTES)}";\n` });
  assert.equal(existingTargetRefusal("src/m.ts", MOD, "isR", { v2: { read: (r) => big.context.find((f) => f.path === r)?.content ?? null }, repo: big.scan }), TEST_TARGET_TOO_LARGE);
});

// ---- (1) the canary, end to end through Job A (generate.ts) and Job B (test-candidates.ts) ----
const git = (cwd: string, ...a: string[]) => execFileSync("git", ["-c", "user.name=PeaceG03", "-c", `user.email=${PEACE_AUTHOR}`, ...a], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const TSCONFIG = JSON.stringify({ compilerOptions: { target: "ES2022", module: "ESNext", moduleResolution: "Bundler", strict: true, noEmit: true, allowImportingTsExtensions: true, types: ["node"] }, include: ["src"] });
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
const allText = (dir: string): string => {
  let out = "";
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir)) { const p = join(dir, e); out += statSync(p).isDirectory() ? allText(p) : `${p}\n${readFileSync(p, "utf8")}\n`; }
  return out;
};
const approval = { url: "https://github.com/PeaceG03/PeaceAI-Workspace/issues/40#issuecomment-123", commentId: 123, issue: 40, repo: "PeaceG03/PeaceAI-Workspace", author: "PeaceG03", approvedAt: "2026-10-25T00:00:00Z" };
const env0 = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("NODE_TEST")));
function jobs(host: string) {
  const dir = mkdtempSync(join(tmpdir(), "m97-denied-"));
  const ws = join(dir, "ws");
  mkdirSync(join(ws, "src"), { recursive: true });
  for (const [p, c] of Object.entries({ "src/m.ts": MOD, "src/index.ts": INDEX, "src/host.ts": host, "src/base.test.ts": 'import test from "node:test";\ntest("base", () => {});\n', "tsconfig.json": TSCONFIG, "package.json": '{ "name": "m97-denied", "private": true, "type": "module" }\n', ".gitignore": "node_modules\n" })) writeFileSync(join(ws, p), c);
  symlinkSync(join(root, "node_modules"), join(ws, "node_modules"));
  git(ws, "init", "-q", "-b", "main"); git(ws, "add", "-A"); git(ws, "commit", "-qm", "base");
  const baseSha = git(ws, "rev-parse", "HEAD").trim();
  const rules = join(dir, "rules"); mkdirSync(rules);
  writeFileSync(join(rules, `${SPEC.id}.json`), JSON.stringify(SPEC));
  const list = join(dir, "approved.json");
  writeFileSync(list, JSON.stringify({ schema: APPROVED_SCHEMA, rules: [{ id: SPEC.id, sha256: SHA, source: "workspace", approval }] }));
  const out = join(dir, "out");
  const a = spawnSync(join(root, "node_modules/.bin/tsx"), [join(root, "peaceai/bin/generate.ts")], {
    cwd: root, encoding: "utf8",
    env: { ...env0(), PEACEAI_NL_PARSE: "off", PEACEAI_KERNEL_BUNDLE: fakeKernel(dir), PEACEAI_OUT_DIR: out, PEACEAI_WORKSPACE_DIR: ws, PEACEAI_TARGET: "PeaceG03/PeaceSTOCKS", ISSUE_NUMBER: "9", ISSUE_TITLE: "[test] isR", ISSUE_BODY: TASK, PEACEAI_RULES_DIR: rules, PEACEAI_APPROVED_LIST: list },
  });
  const summary = existsSync(join(out, "summary.json")) ? JSON.parse(readFileSync(join(out, "summary.json"), "utf8")) : null;
  let b: ReturnType<typeof spawnSync> | null = null;
  let results: { results: { testGrading?: { verdict: string; reason: string | null } }[] } | null = null;
  const bOut = join(dir, "bout");
  if (summary?.candidates?.length) {
    mkdirSync(bOut, { recursive: true });
    const resultsFile = join(bOut, "results.json");
    b = spawnSync(join(root, "node_modules/.bin/tsx"), [join(root, "peaceai/bin/test-candidates.ts")], {
      cwd: root, encoding: "utf8",
      env: { ...env0(), PEACEAI_IN_DIR: out, PEACEAI_RESULTS_FILE: resultsFile, PEACEAI_WORKSPACE_DIR: ws, PEACEAI_TARGET: "PeaceG03/PeaceSTOCKS", PEACEAI_SANDBOX_USER: "", PEACEAI_REQUIRE_SANDBOX: "", PEACEAI_APPROVED_LIST: list },
    });
    if (existsSync(resultsFile)) results = JSON.parse(readFileSync(resultsFile, "utf8"));
  }
  const text = [a.stdout, a.stderr, allText(out), b ? `${b.stdout}\n${b.stderr}` : "", allText(bOut)].join("\n");
  return { dir, baseSha, a, b, summary, results, text, clean: () => rmSync(dir, { recursive: true, force: true }) };
}
const confined = Number(process.versions.node.split(".")[0]) >= 22;

test("(1) canary: a denied file's text appears in none of Job A's or Job B's output, artifacts or records", { timeout: 600_000 }, () => {
  const ok = jobs(HOST_OK);
  try {
    assert.equal(ok.a.status, 0, ok.a.stderr);
    assert.equal(ok.summary.candidates.length, 1, ok.a.stdout);
    assert.ok(ok.b, "Job B ran");
    assert.equal(ok.b!.status, 0, String(ok.b!.stderr));
    if (confined) assert.equal(ok.results!.results[0]!.testGrading!.verdict, "COUNTS", JSON.stringify(ok.results!.results[0]!.testGrading));
    else assert.equal(ok.results!.results[0]!.testGrading!.reason, "not-confined");
    assert.ok(ok.text.length > 1000, "outputs were collected");
    assert.equal(ok.text.includes(CANARY), false, "canary leaked");
    assert.equal(ok.text.includes("hostHas"), false, "no denied-file identifier leaked either");
  } finally { ok.clean(); }
  const bad = jobs(HOST_WRITES);
  try {
    assert.equal(bad.a.status, 0, bad.a.stderr);
    assert.equal(bad.summary.candidates.length, 0, "a denied file writing the binding refuses in Job A");
    assert.match(bad.a.stdout, /test_target_impure/);
    assert.equal(bad.text.includes(CANARY), false, "canary leaked on the refusal path");
  } finally { bad.clean(); }
});
