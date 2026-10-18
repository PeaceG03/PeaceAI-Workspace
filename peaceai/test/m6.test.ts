import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";

import { addText, emptyIndex } from "../lib/coretext.ts";
import { gateCandidate } from "../lib/gate.ts";
import { checkKernelBundle } from "../lib/kernelguard.ts";
import { authorIsNoreply, NOREPLY_EMAIL, parsePatchComment, patchCommentBody, sha256, splitPatch, verifyPatch } from "../lib/patch.ts";
import { indexBoost, selectSources } from "../lib/sources.ts";
import { buildIndex, definitions, indexStats, references, relatedFiles, resolveTargets, search, tokenize } from "../lib/symbols.ts";
import { loadTargets, scopeOf } from "../lib/target.ts";
import { buildVariants } from "../lib/taskmap.ts";

const repo = resolve(import.meta.dirname, "..", "..");
const tsx = join(repo, "node_modules/.bin/tsx");
const WS = "PeaceG03/PeaceAI-Workspace";
const PS = "PeaceG03/PeaceSTOCKS";
const targets = loadTargets();
const isTest = (p: string) => p.endsWith(".test.ts");
const scratch = () => mkdtempSync(join(tmpdir(), "m6-"));
const git = (cwd: string, ...a: string[]) => execFileSync("git", a, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

// ----
// Part 2: symbol and keyword index
const FILES = [
  {
    path: "src/config.ts",
    content: `// Settings for the scanner.\nexport const LIMITS = { pageSize: 20 };\nexport type Profile = {\n  readonly id: string;\n};\nconst hidden = 1;\nexport function parseQuantity(raw: string): number {\n  const amount = Number(raw) + hidden;\n  return amount;\n}\n`,
  },
  {
    path: "src/presets.ts",
    content: `import type { Profile } from "./config";\nimport { parseQuantity } from "./config.ts";\nexport const GUEST: Profile = { id: "guest" };\nexport function guestQuantity(): number {\n  return parseQuantity("2");\n}\n`,
  },
  { path: "src/feed/rate-limit.ts", content: `/** Backoff for rate limited requests. */\nexport function backoffDelay(attempt: number): number {\n  return 2 ** attempt * 100;\n}\n` },
  { path: "src/feed/rate-limit.test.ts", content: `import { backoffDelay } from "./rate-limit";\nbackoffDelay(1);\n` },
  { path: "src/dup-a.ts", content: `export function shared(): number { return 1; }\n` },
  { path: "src/dup-b.ts", content: `export function shared(): number { return 2; }\n` },
];

test("index: exported and local symbols, definitions, references, file maps and imports", () => {
  const index = buildIndex(FILES);
  const parse = definitions(index, "parseQuantity");
  assert.deepEqual(parse.map((d) => [d.path, d.kind, d.exported, d.line]), [["src/config.ts", "function", true, 7]]);
  assert.deepEqual(definitions(index, "hidden").map((d) => [d.kind, d.exported]), [["const", false]]);
  const locals = index.defs.filter((d) => d.scope === "local" && d.path === "src/config.ts").map((d) => `${d.kind}:${d.name}@${d.container}`);
  assert.ok(locals.includes("parameter:raw@parseQuantity") && locals.includes("local:amount@parseQuantity") && locals.includes("property:id@Profile"), locals.join(","));
  assert.deepEqual(references(index, "parseQuantity").map((r) => `${r.path}:${r.line}`), ["src/presets.ts:5"]);
  assert.deepEqual(references(index, "hidden").map((r) => `${r.path}:${r.line}`), ["src/config.ts:8"]);
  assert.deepEqual(index.fileSymbols.get("src/config.ts"), ["LIMITS", "Profile", "hidden", "parseQuantity"]);
  assert.deepEqual(index.imports.get("src/presets.ts"), ["src/config.ts"]);
  assert.deepEqual(index.imports.get("src/feed/rate-limit.test.ts"), ["src/feed/rate-limit.ts"]);
});

test("index: deterministic regardless of input order; only counts are reportable", () => {
  const a = buildIndex(FILES);
  const b = buildIndex([...FILES].reverse());
  assert.deepEqual(a.defs, b.defs);
  assert.deepEqual([...a.refs.entries()], [...b.refs.entries()]);
  assert.deepEqual(search(a, "rate limit backoff"), search(b, "rate limit backoff"));
  const stats = indexStats(a);
  assert.match(stats, /^index_files=6 index_skipped=0 symbols=\d+ exported=\d+ local=\d+ refs=\d+ terms=\d+$/);
  for (const f of FILES) assert.ok(!stats.includes(f.path), "stats name no files");
});

test("index: resolves 'function X', 'type Y', 'the config', named files and bare symbols; ambiguity resolves nothing", () => {
  const index = buildIndex(FILES);
  const r = (q: string) => resolveTargets(index, q, isTest).map((t) => `${t.path}|${t.reason}`);
  assert.deepEqual(r("add a guard to function parseQuantity"), ["src/config.ts|function parseQuantity"]);
  assert.deepEqual(r("add field x of type number to type Profile"), ["src/config.ts|type Profile"]);
  assert.deepEqual(r("raise the limit in the config"), ["src/config.ts|the config"]);
  assert.deepEqual(r("change src/feed/rate-limit.ts"), ["src/feed/rate-limit.ts|named file"]);
  assert.deepEqual(r("make backoffDelay cap at 5s"), ["src/feed/rate-limit.ts|symbol backoffDelay"]);
  assert.deepEqual(r("add a guard to function shared"), [], "two definitions: no guess");
  assert.deepEqual(r("change src/feed/rate-limit.test.ts"), [], "tests are never targets");
  assert.deepEqual(r("add a guard to function nowhere"), []);
});

test("index: related files (imports, importers, references) and BM25 keyword search", () => {
  const index = buildIndex(FILES);
  assert.deepEqual(relatedFiles(index, ["src/config.ts"]), ["src/presets.ts"]);
  assert.deepEqual(relatedFiles(index, ["src/feed/rate-limit.ts"]), ["src/feed/rate-limit.test.ts"]);
  assert.deepEqual(search(index, "rate limited backoff", 2).map((h) => h.path), ["src/feed/rate-limit.ts", "src/feed/rate-limit.test.ts"]);
  assert.deepEqual(search(index, "zzz-unknown"), []);
  assert.deepEqual(tokenize("parseQuantity MAX_ITEMS rate-limit"), ["parse", "quantity", "parsequantity", "max", "items", "max_items", "rate", "limit"]);
});

test("index: oversized files are skipped, not read into the index", () => {
  const big = { path: "src/big.ts", content: "export const x = 1;\n" + "// pad\n".repeat(70_000) };
  const index = buildIndex([...FILES, big]);
  assert.equal(index.skipped, 1);
  assert.ok(!index.files.includes("src/big.ts"));
});

test("index works on a PeaceSTOCKS-shaped tree under its scope", () => {
  const ps = scopeOf(targets.targets[PS]!);
  const tree = [
    { path: "src/dust.ts", content: "export interface DustRow { readonly symbol: string; }\nexport function dustScore(row: DustRow): number { return row.symbol.length; }\n" },
    { path: "src/intraday-dust.ts", content: 'import { dustScore, type DustRow } from "./dust";\nexport const intradayScore = (r: DustRow) => dustScore(r) * 2;\n' },
    { path: "src/intraday-dust.test.ts", content: 'import { intradayScore } from "./intraday-dust";\nintradayScore({ symbol: "A" });\n' },
    { path: "src/host.ts", content: "export function startHost(): void {}\n" },
  ].filter((f) => ps.isSource(f.path) && !ps.isDenied(f.path));
  assert.ok(!tree.some((f) => f.path === "src/host.ts"), "denied paths never reach the index");
  const index = buildIndex(tree);
  assert.deepEqual(resolveTargets(index, "add a guard to function dustScore", ps.isTest).map((t) => t.path), ["src/dust.ts"]);
  assert.deepEqual(resolveTargets(index, "add field venue of type string to interface DustRow", ps.isTest).map((t) => t.path), ["src/dust.ts"]);
  assert.deepEqual(relatedFiles(index, ["src/dust.ts"]), ["src/intraday-dust.ts"]);
});

test("index steers source selection and variant order", () => {
  const files = Array.from({ length: 30 }, (_, i) => ({ path: `src/f${String(i).padStart(2, "0")}.ts`, content: `export const v${i} = ${i};\n` }));
  const boost = indexBoost(["src/f29.ts"], ["src/f28.ts"], ["src/f27.ts"]);
  const picked = selectSources("change something", files, boost).map((f) => f.path);
  assert.equal(picked.length, 20);
  for (const p of ["src/f27.ts", "src/f28.ts", "src/f29.ts"]) assert.ok(picked.includes(p), p);
  const variants = buildVariants({ title: "t", body: "change it" }, ["src/a.ts", "src/b.ts", "src/c.ts"], isTest, ["src/c.ts"]);
  assert.equal(variants[0]!.targetPath, "src/c.ts");
});

// ----
// Part 3: the planner in generate (fake kernel), gates on the combined diff
function fakeKernel(dir: string, plan: "materialized" | "blocked"): string {
  const file = join(dir, "fake-kernel.cjs");
  writeFileSync(
    file,
    `const crypto = require("node:crypto");
exports.NATIVE_CODE_SYNTHESIS_PROTOCOL_VERSION = "x";
exports.sourceFingerprint = (p, c) => crypto.createHash("sha256").update(p + "\\0" + c).digest("hex");
let single = 0;
exports.PeaceAINativeCodeSynthesizer = class { synthesize() { single += 1; require("node:fs").writeFileSync(${JSON.stringify(join(dir, "single-calls"))}, String(single)); return { status: "INSUFFICIENT" }; } };
exports.parsePlanSteps = (o) => (/^step 1:/im.test(o) ? [{ index: 1 }, { index: 2 }] : null);
exports.synthesizePlan = async (req) => {
  if (${JSON.stringify(plan)} !== "materialized") return { status: "BLOCKED", failedStep: 2, reasons: ["x"] };
  const cfg = req.sources.find((s) => s.path === "src/config.ts");
  const pre = req.sources.find((s) => s.path === "src/presets.ts");
  return {
    status: "MATERIALIZED", operationId: "MULTI_STEP_PLAN",
    steps: [{ transformations: ["ADD_TYPE_FIELD"] }, { transformations: ["ADD_OBJECT_PROPERTY", "ADD_TEST_CASE"] }],
    operations: [
      { operation: "EDIT_FILE", path: "src/config.ts", expectedCurrentFingerprint: cfg.fingerprint, content: cfg.content + "export const A = 1;\\n", transformation: "ADD_TYPE_FIELD" },
      { operation: "EDIT_FILE", path: "src/presets.ts", expectedCurrentFingerprint: pre.fingerprint, content: pre.content + "export const B = 2;\\n", transformation: "ADD_OBJECT_PROPERTY" },
      { operation: "CREATE_FILE", path: "src/presets.plan.test.ts", expectedCurrentFingerprint: null, content: "import test from 'node:test';\\ntest('x', () => {});\\n", transformation: "ADD_TEST_CASE" },
    ],
  };
};
`,
  );
  return file;
}

function runGenerate(plan: "materialized" | "blocked", body: string) {
  const dir = scratch();
  const ws = join(dir, "ws");
  mkdirSync(join(ws, "src"), { recursive: true });
  for (const f of FILES.slice(0, 2)) writeFileSync(join(ws, f.path), f.content);
  git(ws, "init", "-q");
  git(ws, "add", "-A");
  git(ws, "-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-qm", "base");
  const out = join(dir, "out");
  const r = spawnSync(tsx, [join(repo, "peaceai/bin/generate.ts")], {
    cwd: repo,
    encoding: "utf8",
    env: { ...process.env, PEACEAI_NL_PARSE: "off", PEACEAI_KERNEL_BUNDLE: fakeKernel(dir, plan), PEACEAI_OUT_DIR: out, PEACEAI_WORKSPACE_DIR: ws, PEACEAI_TARGET: WS, ISSUE_NUMBER: "7", ISSUE_TITLE: "[test] plan", ISSUE_BODY: body },
  });
  return { dir, out, r, singleCalls: existsSync(join(dir, "single-calls")) ? Number(readFileSync(join(dir, "single-calls"), "utf8")) : 0 };
}

test("generate: a numbered-step task runs once through the planner and yields one combined multi-file candidate", () => {
  const { dir, out, r, singleCalls } = runGenerate("materialized", "Step 1: add field a of type number to type Profile\nStep 2: add property a with value 1 to object GUEST");
  try {
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /plan=materialized:2 calls=1 candidates=1/);
    assert.match(r.stdout, /index_files=2 .* resolved=\d+ related=\d+/);
    assert.equal(singleCalls, 0, "single-step variants are not tried for a plan");
    const summary = JSON.parse(readFileSync(join(out, "summary.json"), "utf8"));
    assert.deepEqual(summary.candidates[0].transformations, ["ADD_TYPE_FIELD", "ADD_OBJECT_PROPERTY", "ADD_TEST_CASE"]);
    assert.equal(summary.candidates[0].operationId, "MULTI_STEP_PLAN");
    const diff = readFileSync(join(out, "candidates", "candidate-1.diff"), "utf8");
    assert.deepEqual([...diff.matchAll(/^diff --git a\/(\S+)/gm)].map((m) => m[1]), ["src/config.ts", "src/presets.plan.test.ts", "src/presets.ts"]);
    // Index data stays in the job: the output holds only the candidates and the summary.
    assert.deepEqual(readdirSync(out).sort(), ["candidates", "summary.json"]);
    assert.ok(!/defs|refs|bm25|fileSymbols/.test(JSON.stringify(summary)));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("generate: a blocked plan yields no candidate (no partial chain); a plain task still uses single-step variants", () => {
  const blocked = runGenerate("blocked", "Step 1: a\nStep 2: b");
  const plain = runGenerate("materialized", "add a guard to function parseQuantity that returns 0 when raw is empty");
  try {
    assert.match(blocked.r.stdout, /plan=blocked:2 calls=1 candidates=0/);
    assert.equal(blocked.singleCalls, 0);
    assert.match(plain.r.stdout, /plan=none/);
    assert.ok(plain.singleCalls > 0);
  } finally {
    rmSync(blocked.dir, { recursive: true, force: true });
    rmSync(plain.dir, { recursive: true, force: true });
  }
});

const edit = (path: string, added: string[]) => [`diff --git a/${path} b/${path}`, "index 1111111..2222222 100644", `--- a/${path}`, `+++ b/${path}`, "@@ -1,1 +1,2 @@", " context", ...added.map((l) => `+${l}`), ""].join("\n");

test("scope and leak gates apply to the combined plan diff (any one file fails the whole plan)", () => {
  const ps = scopeOf(targets.targets[PS]!);
  const base = new Set(["src/dust.ts", "src/intraday-dust.ts", "src/host.ts"]);
  const good = edit("src/dust.ts", ["export const A = 1;"]) + edit("src/intraday-dust.ts", ["export const B = 2;"]);
  const core = { text: emptyIndex(), paths: new Set<string>(), basenames: new Set<string>() };
  assert.deepEqual(gateCandidate(good, base, emptyIndex(), core, ps).reasons, []);
  const denied = edit("src/dust.ts", ["export const A = 1;"]) + edit("src/host.ts", ["export const B = 2;"]);
  assert.ok(gateCandidate(denied, base, emptyIndex(), core, ps).reasons.some((r) => r.includes("denied path")));
  const pii = edit("src/dust.ts", ["export const A = 1;"]) + edit("src/intraday-dust.ts", [`export const B = "${["someone", "gmail.com"].join("@")}";`]);
  assert.ok(gateCandidate(pii, base, emptyIndex(), core, ps).reasons.some((r) => r.startsWith("personal-info")));
  const secret = ["export function coreOnlyRoutine(alpha: number, beta: number): number {", "  const gamma = alpha * 31 + beta;", "  return gamma ^ (gamma >>> 7);", "}"];
  const withCore = { text: emptyIndex(), paths: new Set<string>(), basenames: new Set<string>() };
  addText(withCore.text, secret.join("\n"));
  const leaky = edit("src/dust.ts", ["export const A = 1;"]) + edit("src/intraday-dust.ts", secret);
  assert.ok(gateCandidate(leaky, base, emptyIndex(), withCore, ps).reasons.some((r) => r.startsWith("core-text")));
});

// ----
// Part 1: kernel guard (the Actions build cannot reach a teacher or outside model)
const meta = (inputs: string[], externals: string[] = []) => ({
  inputs: Object.fromEntries(inputs.map((i, n) => [i, { imports: n === 0 ? externals.map((path) => ({ path, external: true })) : [] }])),
});

test("kernel guard passes a clean bundle and names each violation class", () => {
  const ok = checkKernelBundle("module.exports = { synthesize() {} };", meta(["core/src/ActionsKernel.ts", "core/src/NativeCodeSynthesis.ts"], ["node:crypto", "fs"]));
  assert.deepEqual(ok.violations, []);
  const bad = checkKernelBundle(
    'const u = "https://api.openai.com/v1/chat/completions"; const m = "microsoft/Phi-4-mini"; new TeacherReuseOrchestrator(); const w = "model.onnx"; const c = "CODEX_FALLBACK";',
    meta(["core/src/ActionsKernel.ts", "core/src/PeaceAIFirstRouting.ts"], ["node:https", "child_process"]),
  );
  assert.deepEqual(bad.violations.sort(), [
    "bundle-text: codex",
    "bundle-text: hosted-model-endpoint",
    "bundle-text: model-identifier",
    "bundle-text: model-sdk",
    "bundle-text: model-weights",
    "bundle-text: teacher-route",
    "external-import: child_process",
    "external-import: node:https",
    "removed-module-bundled: PeaceAIFirstRouting",
  ]);
  assert.ok(!checkKernelBundle("x", { inputs: {} }).ok, "empty metafile fails closed");
});

function fakeCore(entry: string | null, extra: Record<string, string> = {}): string {
  const core = scratch();
  const src = join(core, "packages/coding-kernel/src");
  mkdirSync(src, { recursive: true });
  if (entry !== null) writeFileSync(join(src, "ActionsKernel.ts"), entry);
  for (const [name, content] of Object.entries(extra)) writeFileSync(join(src, name), content);
  return core;
}

test("build-kernel.sh bundles ActionsKernel.ts, runs the guard, and deletes a bundle that fails it", () => {
  const out = join(scratch(), "kernel.cjs");
  const clean = fakeCore('export * from "./Synth";\n', { "Synth.ts": 'import { createHash } from "node:crypto";\nexport const fp = (s: string) => createHash("sha256").update(s).digest("hex");\n' });
  const ok = spawnSync(join(repo, "peaceai/bin/build-kernel.sh"), [clean, out], { encoding: "utf8" });
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /kernel guard passed/);
  assert.ok(existsSync(out));
  const dirty = fakeCore('export * from "./Teach";\n', { "Teach.ts": 'import https from "node:https";\nexport const ask = () => https.get("https://api.openai.com/v1/chat/completions");\n' });
  const bad = spawnSync(join(repo, "peaceai/bin/build-kernel.sh"), [dirty, out], { encoding: "utf8" });
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /external-import: node:https/);
  assert.match(bad.stderr, /bundle-text: hosted-model-endpoint/);
  assert.ok(!existsSync(out), "a failing bundle is removed");
  const none = spawnSync(join(repo, "peaceai/bin/build-kernel.sh"), [fakeCore(null), out], { encoding: "utf8" });
  assert.equal(none.status, 1);
  assert.match(none.stderr, /no Actions kernel entry/);
});

// ----
// Part 4: patch-file verdict route
function makeTarget(): { dir: string; base: string; diff: string } {
  const dir = scratch();
  const t = join(dir, "PeaceSTOCKS");
  mkdirSync(join(t, "src"), { recursive: true });
  writeFileSync(join(t, "src/dust.ts"), "export const LIMIT = 3;\n");
  git(t, "init", "-q", "-b", "main");
  git(t, "add", "-A");
  git(t, "-c", "user.name=PeaceG03", "-c", `user.email=${NOREPLY_EMAIL}`, "commit", "-qm", "base");
  git(t, "remote", "add", "origin", "https://github.com/PeaceG03/PeaceSTOCKS.git");
  const base = git(t, "rev-parse", "HEAD");
  writeFileSync(join(t, "src/dust.ts"), "export const LIMIT = 3;\nexport const FLOOR = 1;\n");
  writeFileSync(join(t, "src/dust.floor.test.ts"), "import test from 'node:test';\ntest('floor', () => {});\n");
  git(t, "add", "-A", "--intent-to-add", ".");
  const diff = execFileSync("git", ["diff", "--no-color", "--no-ext-diff", "--no-renames", "--full-index"], { cwd: t, encoding: "utf8" });
  git(t, "reset", "-q", "--hard", base);
  git(t, "clean", "-fdq");
  return { dir: t, base, diff };
}

function formatPatch(target: string, base: string, diff: string, email = NOREPLY_EMAIL, name = "PeaceG03"): string {
  const work = join(scratch(), "w");
  execFileSync("git", ["clone", "-q", target, work]);
  git(work, "checkout", "-q", base);
  writeFileSync(join(work, "c.diff"), diff);
  git(work, "apply", "c.diff");
  rmSync(join(work, "c.diff"));
  git(work, "add", "-A", "--", "src");
  execFileSync("git", ["-c", `user.name=${name}`, "-c", `user.email=${email}`, "commit", "-qm", "PeaceAI candidate chosen in review of PeaceG03/PeaceAI-Workspace#9"], {
    cwd: work,
    env: { ...process.env, GIT_AUTHOR_DATE: "2026-10-10T20:00:00Z", GIT_COMMITTER_DATE: "2026-10-10T20:00:00Z" },
  });
  return execFileSync("git", ["format-patch", "-1", "--stdout", "--no-signature", "--no-stat", "--full-index", "--no-renames", "--no-color"], { cwd: work, encoding: "utf8" });
}

test("patch: format-patch diff is byte-identical to the candidate diff; author and shape are checked", () => {
  const t = makeTarget();
  const patch = formatPatch(t.dir, t.base, t.diff);
  const parts = splitPatch(patch);
  assert.ok(!("error" in parts));
  if (!("error" in parts)) {
    assert.equal(parts.diff, t.diff);
    assert.equal(authorIsNoreply(parts.header), true);
  }
  const other = splitPatch(formatPatch(t.dir, t.base, t.diff, "someone@example.com", "Someone"));
  assert.ok(!("error" in other) && !authorIsNoreply(other.header));
  assert.deepEqual(splitPatch(patch.replace(/\n/g, "\r\n")), { error: "patch has CR line endings" });
  assert.deepEqual(splitPatch(patch + patch), { error: "more than one commit" });
  assert.deepEqual(splitPatch("hello"), { error: "not a format-patch file" });
});

test("patch: the comment round-trips exactly, even when the patch contains backtick fences", () => {
  const t = makeTarget();
  const patch = formatPatch(t.dir, t.base, t.diff).replace("PeaceAI candidate", "PeaceAI ```` candidate");
  const c = { candidateId: "candidate-2", runId: "123", target: PS, diffSha256: sha256(t.diff), patchSha256: sha256(patch), patch };
  const body = patchCommentBody(c, "B");
  assert.ok(body.length < 65_536);
  assert.deepEqual(parsePatchComment(body), c);
  assert.deepEqual(parsePatchComment(body.replace(/\n/g, "\r\n")), c, "CRLF from the API is tolerated in the comment wrapper");
  assert.equal(parsePatchComment("hello"), null);
});

test("patch: verify accepts the effective pick's exact diff and refuses every mismatch", () => {
  const t = makeTarget();
  const patch = formatPatch(t.dir, t.base, t.diff);
  const comment = { candidateId: "candidate-1", runId: "5", target: PS, diffSha256: sha256(t.diff), patchSha256: sha256(patch), patch };
  const pick = { decided: true, candidateId: "candidate-1" };
  assert.deepEqual(verifyPatch({ comment, resultsDiff: t.diff, effectivePick: pick, latestRunId: "5" }), []);
  const other = t.diff.replace("FLOOR = 1", "FLOOR = 2");
  assert.ok(verifyPatch({ comment, resultsDiff: other, effectivePick: pick, latestRunId: "5" }).includes("posted diff sha256 does not match Results"));
  assert.ok(verifyPatch({ comment, resultsDiff: t.diff, effectivePick: { decided: true, candidateId: "candidate-2" }, latestRunId: "5" }).includes("patch candidate is not the verdict's effective pick"));
  assert.ok(verifyPatch({ comment, resultsDiff: t.diff, effectivePick: { decided: false, candidateId: null }, latestRunId: "5" }).length > 0, "withdrawn pick");
  assert.ok(verifyPatch({ comment, resultsDiff: t.diff, effectivePick: pick, latestRunId: "6" }).includes("patch is not for the latest attempt"));
  assert.ok(verifyPatch({ comment: { ...comment, patch: patch.replace("FLOOR = 1", "FLOOR = 9") }, resultsDiff: t.diff, effectivePick: pick, latestRunId: "5" }).includes("patch sha256 does not match the posted value"));
  const forged = formatPatch(t.dir, t.base, t.diff, "someone@example.com", "Someone");
  const forgedComment = { ...comment, patch: forged, patchSha256: sha256(forged) };
  assert.deepEqual(verifyPatch({ comment: forgedComment, resultsDiff: t.diff, effectivePick: pick, latestRunId: "5" }), ["From: is not the noreply identity"]);
});

test("verdict-patch.ts writes the comment only for a noreply patch identical to the chosen diff", () => {
  const t = makeTarget();
  const dir = scratch();
  const run = (patch: string, chosen: string) => {
    writeFileSync(join(dir, "p.patch"), patch);
    writeFileSync(join(dir, "c.diff"), chosen);
    rmSync(join(dir, "body.md"), { force: true });
    const r = spawnSync(tsx, [join(repo, "peaceai/bin/verdict-patch.ts")], {
      encoding: "utf8",
      env: { ...process.env, GITHUB_OUTPUT: "", PATCH_FILE: join(dir, "p.patch"), CHOSEN_DIFF: join(dir, "c.diff"), BODY_FILE: join(dir, "body.md"), CANDIDATE: "candidate-1", RUN_ID: "5", TARGET: PS, LABEL: "A" },
    });
    return { out: r.stdout, body: existsSync(join(dir, "body.md")) ? readFileSync(join(dir, "body.md"), "utf8") : null };
  };
  const patch = formatPatch(t.dir, t.base, t.diff);
  const good = run(patch, t.diff);
  assert.match(good.out, /ok=true/);
  assert.equal(parsePatchComment(good.body!)!.diffSha256, sha256(t.diff));
  assert.match(run(patch, t.diff.replace("FLOOR = 1", "FLOOR = 2")).out, /ok=false reason=patch-diff-differs-from-candidate/);
  assert.match(run(formatPatch(t.dir, t.base, t.diff, "someone@example.com", "Someone"), t.diff).out, /ok=false reason=author-not-noreply/);
  assert.equal(run(patch, t.diff.replace("FLOOR = 1", "FLOOR = 2")).body, null);
});

/** A fake `gh` serving Workspace issue comments and a Results tree, logging every call. */
function fakeGhForApply(comments: { user: string; body: string }[], results: string): { bin: string; log: string } {
  const dir = scratch();
  const log = join(dir, "calls.log");
  writeFileSync(join(dir, "comments.json"), JSON.stringify(comments));
  const script = `#!/usr/bin/env node
const fs = require("node:fs"); const path = require("node:path");
const args = process.argv.slice(2); fs.appendFileSync(${JSON.stringify(log)}, args.join(" ") + "\\n");
if (args[0] !== "api") process.exit(3);
const url = args.find((a) => a.startsWith("repos/"));
if (/^repos\\/PeaceG03\\/PeaceAI-Workspace\\/issues\\/\\d+\\/comments/.test(url)) {
  for (const c of JSON.parse(fs.readFileSync(${JSON.stringify(join(dir, "comments.json"))}, "utf8"))) console.log(JSON.stringify(c));
  process.exit(0);
}
const m = /^repos\\/PeaceG03\\/PeaceAI-Results\\/contents\\/(.+)$/.exec(url || "");
if (!m) process.exit(4);
const p = path.join(${JSON.stringify(results)}, m[1]);
if (!fs.existsSync(p)) process.exit(1);
if (fs.statSync(p).isDirectory()) { for (const n of fs.readdirSync(p).sort()) console.log(n); process.exit(0); }
process.stdout.write(fs.readFileSync(p, "utf8"));
`;
  writeFileSync(join(dir, "gh"), script);
  chmodSync(join(dir, "gh"), 0o755);
  return { bin: dir, log };
}

function resultsTree(issue: number, runId: string, base: string, diffs: Record<string, string>, verdicts: { id: string; label: string; candidate: string; verdict: string; at: string }[]): string {
  const root = scratch();
  const dir = join(root, "tasks", String(issue), runId);
  mkdirSync(join(dir, "candidates"), { recursive: true });
  mkdirSync(join(dir, "verdicts"), { recursive: true });
  writeFileSync(join(dir, "task.json"), JSON.stringify({ issue, runId, baseSha: base, target: PS }));
  writeFileSync(join(dir, "ranking.json"), "{}");
  for (const [id, d] of Object.entries(diffs)) writeFileSync(join(dir, "candidates", `${id}.diff`), d);
  for (const v of verdicts)
    writeFileSync(join(dir, "verdicts", `${v.id}.json`), JSON.stringify({ schema: "peaceai-verdict:v1", issue, runId, commentId: v.id, recordedAt: v.at, label: v.label, candidateId: v.candidate, verdict: v.verdict }));
  return root;
}

function applyScenario(opts: { results: "match" | "mismatch"; author?: "noreply" | "other"; dirty?: boolean; origin?: string }) {
  const t = makeTarget();
  const patch = opts.author === "other" ? formatPatch(t.dir, t.base, t.diff, "someone@example.com", "Someone") : formatPatch(t.dir, t.base, t.diff);
  const body = patchCommentBody({ candidateId: "candidate-1", runId: "77", target: PS, diffSha256: sha256(t.diff), patchSha256: sha256(patch), patch }, "A");
  const stored = opts.results === "match" ? t.diff : t.diff.replace("FLOOR = 1", "FLOOR = 2");
  const results = resultsTree(9, "77", t.base, { "candidate-1": stored }, [{ id: "100", label: "A", candidate: "candidate-1", verdict: "right", at: "2026-10-10T20:00:00Z" }]);
  const gh = fakeGhForApply([{ user: "PeaceG03", body: "a forged patch comment by a human is ignored" }, { user: "github-actions[bot]", body }], results);
  if (opts.dirty) writeFileSync(join(t.dir, "src/dust.ts"), "dirty\n");
  if (opts.origin) git(t.dir, "remote", "set-url", "origin", opts.origin);
  // A bare "remote" proves nothing is pushed: its refs must not change.
  const bare = join(scratch(), "bare.git");
  execFileSync("git", ["clone", "-q", "--bare", t.dir, bare]);
  git(t.dir, "remote", "set-url", "--push", "origin", bare);
  const before = git(bare, "for-each-ref");
  const r = spawnSync(join(repo, "peaceai/bin/apply-verdict-patch.sh"), ["9", "--worktree", t.dir], {
    encoding: "utf8",
    env: { ...process.env, PATH: `${gh.bin}:${process.env.PATH}` },
  });
  return { t, r, gh, bare, before };
}

test("apply script: a good patch verifies against Results and applies with git am, and is not pushed", () => {
  const { t, r, gh, bare, before } = applyScenario({ results: "match" });
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.match(r.stdout, /verified: issue #9 run 77 candidate-1/);
  assert.match(r.stdout, /Not pushed/);
  assert.equal(git(t.dir, "log", "-1", "--format=%an <%ae>|%s"), `PeaceG03 <${NOREPLY_EMAIL}>|PeaceAI candidate chosen in review of PeaceG03/PeaceAI-Workspace#9`);
  assert.equal(git(t.dir, "rev-parse", "HEAD^"), t.base);
  assert.match(readFileSync(join(t.dir, "src/dust.ts"), "utf8"), /FLOOR = 1/);
  assert.equal(git(bare, "for-each-ref"), before, "nothing pushed");
  const calls = readFileSync(gh.log, "utf8");
  assert.ok(!/ -X | --method |-f |--field |POST|PATCH|DELETE|PUT/.test(calls), "gh is used read-only");
  assert.ok(!readFileSync(join(repo, "peaceai/bin/apply-verdict-patch.ts"), "utf8").includes('"push"'), "the script has no push call");
});

test("apply script: a mismatched SHA refuses and leaves the worktree unchanged", () => {
  const { t, r } = applyScenario({ results: "mismatch" });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /REFUSED: .*does not match/);
  assert.equal(git(t.dir, "rev-parse", "HEAD"), t.base);
});

test("apply script: a non-noreply author refuses", () => {
  const { t, r } = applyScenario({ results: "match", author: "other" });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /REFUSED: From: is not the noreply identity/);
  assert.equal(git(t.dir, "rev-parse", "HEAD"), t.base);
});

test("apply script: refuses a dirty worktree or a clone of another repository", () => {
  const dirty = applyScenario({ results: "match", dirty: true });
  assert.equal(dirty.r.status, 1);
  assert.match(dirty.r.stderr, /uncommitted changes/);
  const other = applyScenario({ results: "match", origin: "https://github.com/someone/else.git" });
  assert.equal(other.r.status, 1);
  assert.match(other.r.stderr, /origin is not PeaceG03\/PeaceSTOCKS/);
});

// ----
// Workflows and config
test("targets: PeaceSTOCKS lands by bot PR; the Workspace keeps PRs", () => {
  assert.equal(targets.targets[PS]!.verdictRoute, "pr");
  assert.equal(targets.targets[PS]!.writeEnvironment, "peacestocks-write");
  assert.equal(targets.targets[WS]!.verdictRoute, "pr");
});

test("workflows: patch job has no environment or secrets; index is built only after the visibility re-check", () => {
  const verdict = readFileSync(join(repo, ".github/workflows/peace-verdict.yml"), "utf8");
  const job = verdict.slice(verdict.indexOf("  target-patch:"), verdict.indexOf("  train:"));
  assert.ok(job.length > 100);
  assert.ok(!/environment:|secrets\./.test(job), "no write environment or token");
  assert.match(job, /permissions:\n      contents: read\n      issues: write\n/);
  assert.match(job, /Re-check the target is public[\s\S]*clone-target\.sh[\s\S]*format-patch[\s\S]*verdict-patch\.ts[\s\S]*--body-file/);
  assert.match(verdict, /elif \[ "\$ROUTE" = "patch" \] \|\| \[ "\$ROUTE" = "pr" \]; then/);
  const targetPr = verdict.slice(verdict.indexOf("  target-pr:"), verdict.indexOf("  target-patch:"));
  assert.ok(targetPr.indexOf("Check the chosen diff hash") < targetPr.indexOf("Stale-base check"));
  assert.ok(targetPr.indexOf("Stale-base check") < targetPr.indexOf("Open a PR on the target"));
  assert.match(targetPr, /steps\.stale\.outputs\.stale == 'false'/);
  assert.match(targetPr, /HEAD:refs\/heads\/\$branch/);
  assert.doesNotMatch(targetPr, /pr merge|git push[^\n]*\bmain\b/);
  assert.match(targetPr, /refused: would push the default branch/);
  assert.match(verdict, /route: \$\{\{ steps\.record\.outputs\.route \}\}/);
  const task = readFileSync(join(repo, ".github/workflows/peace-task.yml"), "utf8");
  const gen = task.slice(task.indexOf('name: "Job A: generate"'), task.indexOf('name: "Job B'));
  const order = ["Re-check the target is public", "Clone the target anonymously", "build-kernel.sh", "generate.ts"].map((s) => gen.indexOf(s));
  assert.ok(order.every((i, n) => i > 0 && (n === 0 || i > order[n - 1]!)), `generate job order ${order.join(",")}`);
  const generate = readFileSync(join(repo, "peaceai/bin/generate.ts"), "utf8");
  // M18: + the regrade mode's one candidate diff and regrade.json (both in the output dir).
  assert.equal([...generate.matchAll(/writeFileSync\(/g)].length, 5, "generate writes only worktree files, candidate diffs, the summary and (regrade mode) regrade.json");
});
