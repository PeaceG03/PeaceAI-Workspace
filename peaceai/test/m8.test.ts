// M8: learned edit types. Mining, specs and hashing, the rule engine, the hash-pinned approved list and
// Job A's fail-closed enforcement, the approval write path (Workspace and Results), the CI trace guard,
// the proposal leak gate, and the workflow wiring.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { admitRules, APPROVED_SCHEMA, loadApprovedList, validateList, withEntry, type ApprovalEntry } from "../lib/approved.ts";
import { attestationFor, entryFromAttestation, validateWorkspaceApproval, type CommentEvent } from "../lib/approval.ts";
import { addText, emptyIndex } from "../lib/coretext.ts";
import { applyRule, canonicalJson, RULE_SCHEMA, specFileText, specHash, TRIGGERS, validateSpec, type RuleSpec } from "../lib/learned.ts";
import { literalDelta, majority, observeFile, parseHunks, tally } from "../lib/mine.ts";
import { mineRepo } from "../lib/minegit.ts";
import { parseMarker, parseSpecBlock, proposalBody, proposalMarker, proposeRules } from "../lib/propose.ts";
import { gateProposal } from "../bin/proposal-gate.ts";

const repo = resolve(import.meta.dirname, "..", "..");
const tsx = join(repo, "node_modules/.bin/tsx");
const scratch = () => mkdtempSync(join(tmpdir(), "m8-"));
const git = (cwd: string, ...a: string[]) => execFileSync("git", a, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const commitAll = (cwd: string, msg: string) => { git(cwd, "add", "-A"); git(cwd, "-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-qm", msg); };

const hunk = (newStart: number, added: string[], removed: string[] = [], oldStart = newStart) =>
  ({ newStart, newCount: added.length, oldStart, oldCount: removed.length, added, removed });

// ---- mining

test("miner: -U0 hunks parse; additive shapes found by AST (enum member, switch case, covered shapes); tests skipped", () => {
  const diff = "diff --git a/x.ts b/x.ts\n--- a/x.ts\n+++ b/x.ts\n@@ -3,0 +4,2 @@ enum\n+  Green = \"green\",\n+  Blue = \"blue\",\n@@ -9 +11 @@\n-a\n+b\n";
  assert.deepEqual(parseHunks(diff).map((h) => [h.newStart, h.newCount, h.added.length, h.removed.length]), [[4, 2, 2, 0], [11, 1, 1, 1]]);
  const post = 'export enum Color {\n  Red = "red",\n  Pink = "pink",\n  Green = "green",\n  Blue = "blue",\n}\nfunction label(s: string): string {\n  switch (s) {\n    case "a":\n      return "A";\n    case "b":\n      return "B";\n    default:\n      return "?";\n  }\n}\nexport const CONFIG = { a: 1, b: 2 };\n';
  const obs = observeFile("r@1", "src/x.ts", post, [hunk(4, ['  Green = "green",', '  Blue = "blue",']), hunk(11, ['    case "b":', '      return "B";'])]);
  assert.deepEqual(obs.map((o) => [o.shape, o.line, o.style]), [
    ["ENUM_MEMBER", 4, { value: "string-lower", name: "pascal" }],
    ["ENUM_MEMBER", 5, { value: "string-lower", name: "pascal" }],
    ["SWITCH_CASE", 11, { body: "return-string", label: "string" }],
  ]);
  assert.deepEqual(observeFile("r@1", "src/x.test.ts", post, [hunk(4, ['  Green = "green",'])]), []);
  const prop = observeFile("r@1", "src/c.ts", "export const C = {\n  a: 1,\n  b: 2,\n};\n", [hunk(3, ["  b: 2,"])]);
  assert.deepEqual(prop.map((o) => o.shape), ["OBJECT_PROPERTY"]);
});

test("miner: modification shapes (nullish default, literal change) need the matching before-line", () => {
  const post = "export function load(opts: { items?: string[] }) {\n  const xs = opts.items ?? [];\n  return xs;\n}\n";
  const nd = observeFile("r@1", "src/l.ts", post, [hunk(2, ["  const xs = opts.items ?? [];"], ["  const xs = opts.items;"])]);
  assert.deepEqual(nd.map((o) => [o.shape, o.style]), [["NULLISH_DEFAULT", { default: "array", target: "member" }]]);
  // Already defaulted before: not a new default.
  assert.deepEqual(observeFile("r@1", "src/l.ts", post, [hunk(2, ["  const xs = opts.items ?? [];"], ["  const xs = opts.items ?? null;"])]).map((o) => o.shape), []);
  const lit = observeFile("r@1", "src/k.ts", 'export const LIMIT = 50;\nexport const S = { mode: "fast" };\n', [hunk(1, ["export const LIMIT = 50;"], ["export const LIMIT = 20;"]), hunk(2, ['export const S = { mode: "fast" };'], ['export const S = { mode: "slow" };'])]);
  assert.deepEqual(lit.map((o) => [o.shape, o.style]), [["LITERAL_CHANGE", { kind: "number", context: "top-level-const" }], ["LITERAL_CHANGE", { kind: "string", context: "object-property" }]]);
  assert.equal(literalDelta("f(a, 1)", "f(b, 1)"), null, "identifier changes are not literal changes");
  assert.equal(literalDelta('x = "a" + "b"', 'x = "c" + "d"'), null, "two literals changed is not one literal change");
});

function literalRepo(commits: number): string {
  const dir = scratch();
  mkdirSync(join(dir, "src"));
  writeFileSync(join(dir, "src/a.ts"), 'export const MODE = { level: "low" };\n');
  writeFileSync(join(dir, "src/b.ts"), "export const LIMIT = 1;\n");
  git(dir, "init", "-q");
  commitAll(dir, "base");
  for (let i = 0; i < commits; i++) {
    if (i % 2 === 0) writeFileSync(join(dir, "src/a.ts"), `export const MODE = { level: "l${i}" };\n`);
    else writeFileSync(join(dir, "src/b.ts"), `export const LIMIT = ${i + 10};\n`);
    commitAll(dir, `c${i}`);
  }
  return dir;
}

test("miner over git history: deterministic frequency evidence; proposals only for uncovered, frequent, executable shapes", () => {
  const dir = literalRepo(4);
  try {
    const a = mineRepo(dir, "HEAD", "Fixture");
    const b = mineRepo(dir, "HEAD", "Fixture");
    assert.deepEqual(a, b);
    const stats = tally(a.observations);
    assert.deepEqual(stats.map((s) => [s.shape, s.hunks, s.commits, s.files, s.covered]), [["LITERAL_CHANGE", 4, 4, 2, null]]);
    assert.equal(majority(stats[0]!, "kind"), "number"); // 2 number vs 2 string: tie broken by name
    assert.equal(stats[0]!.examples.length, 3);
    assert.match(stats[0]!.examples[0]!.commit, /^Fixture@[0-9a-f]{10}$/);
    const { proposals } = proposeRules(stats, "public", ["PeaceG03/Fixture"]);
    assert.equal(proposals.length, 1);
    assert.deepEqual(proposals[0]!.spec.params, { contexts: ["object-property", "top-level-const"], kinds: ["number", "string"] });
    assert.equal(proposals[0]!.spec.id, "public-set-literal-v1");
    assert.equal(proposals[0]!.sha256, specHash(proposals[0]!.spec));
  } finally { rmSync(dir, { recursive: true, force: true }); }
  const few = literalRepo(2);
  try {
    const { proposals, skipped } = proposeRules(tally(mineRepo(few, "HEAD", "F").observations), "public", ["x"]);
    assert.equal(proposals.length, 0);
    assert.deepEqual(skipped, [{ shape: "LITERAL_CHANGE", why: "below-threshold" }]);
  } finally { rmSync(few, { recursive: true, force: true }); }
  // Covered shapes never become proposals.
  const covered = tally([{ shape: "OBJECT_PROPERTY", commit: "a", path: "x", line: 1, style: {} }, { shape: "OBJECT_PROPERTY", commit: "b", path: "y", line: 1, style: {} }, { shape: "OBJECT_PROPERTY", commit: "c", path: "z", line: 1, style: {} }]);
  assert.deepEqual(proposeRules(covered, "core", ["x"]).skipped, [{ shape: "OBJECT_PROPERTY", why: "covered" }]);
});

// ---- specs, hashing, engine

const spec = (over: Partial<RuleSpec> = {}): RuleSpec => ({
  schema: RULE_SCHEMA, id: "public-set-literal-v1", kind: "SET_LITERAL", minedFrom: "public", minerVersion: "peaceai-miner:v1", shape: "LITERAL_CHANGE",
  trigger: TRIGGERS.SET_LITERAL, params: { contexts: ["object-property", "top-level-const"], kinds: ["number", "string"] },
  evidence: { hunks: 7, commits: 4, files: 5, repos: ["PeaceG03/PeaceSTOCKS"] }, ...over,
});

test("specs: canonical hash ignores key order and formatting, changes with any content; validation is strict", () => {
  const s = spec();
  const { evidence, params, ...rest } = s;
  const reordered = JSON.parse(JSON.stringify({ evidence, params: { kinds: params.kinds, contexts: params.contexts }, ...rest }));
  assert.equal(specHash(reordered), specHash(s));
  assert.equal(canonicalJson({ b: 1, a: [2, { d: 1, c: 2 }] }), '{"a":[2,{"c":2,"d":1}],"b":1}');
  assert.notEqual(specHash(spec({ params: { contexts: ["object-property"], kinds: ["number", "string"] } })), specHash(s));
  assert.ok(validateSpec(s));
  assert.ok(!validateSpec({ ...s, extra: 1 }));
  assert.ok(!validateSpec({ ...s, id: "core-set-literal-v1" }), "id prefix must match minedFrom");
  assert.ok(!validateSpec({ ...s, kind: "RUN_ANYTHING" }));
  assert.ok(!validateSpec({ ...s, trigger: "(" }));
});

const THEME = 'export type Theme = { readonly name: string; readonly dark: boolean };\nexport const DEFAULT_THEME: Theme = {\n  name: "plain",\n  dark: false,\n};\nexport const RETRIES = 3;\n';

test("engine SET_LITERAL: unique site only; quote style kept; kind and context must match the learned params", () => {
  const files = [{ path: "src/theme.ts", content: THEME }, { path: "src/other.ts", content: 'export const X = { name: "x" };\n' }];
  const r = applyRule(spec(), "set `name` in `src/theme.ts` to 'classic'", files);
  assert.equal(r?.path, "src/theme.ts");
  assert.match(r!.content, /name: "classic",/);
  assert.match(applyRule(spec(), "Set RETRIES to 5", files)!.content, /RETRIES = 5;/);
  assert.equal(applyRule(spec(), 'set name to "classic"', files), null, "two `name` sites: ambiguous, no guess");
  assert.equal(applyRule(spec(), "set RETRIES to \"five\"", files), null, "string into a number site");
  assert.equal(applyRule(spec(), "set dark to true", files), null, "boolean not a learned kind");
  assert.equal(applyRule(spec({ params: { contexts: ["top-level-const"], kinds: ["string"] } }), 'set name in src/theme.ts to "c"', files), null, "object-property not a learned context");
  assert.equal(applyRule(spec(), "please rename everything", files), null);
});

test("engine ADD_SWITCH_CASE and ADD_NULLISH_DEFAULT", () => {
  const sw = spec({ id: "core-add-switch-case-v1", kind: "ADD_SWITCH_CASE", minedFrom: "core", shape: "SWITCH_CASE", trigger: TRIGGERS.ADD_SWITCH_CASE, params: { body: "return-literal", label: "string" } });
  const src = 'export function label(s: string): string {\n  switch (s) {\n    case "a":\n      return "A";\n    default:\n      return "?";\n  }\n}\n';
  const out = applyRule(sw, 'add case "b" returning "B" to the switch in `label`', [{ path: "src/l.ts", content: src }]);
  assert.equal(out?.content, 'export function label(s: string): string {\n  switch (s) {\n    case "a":\n      return "A";\n    case "b":\n      return "B";\n    default:\n      return "?";\n  }\n}\n');
  assert.equal(applyRule(sw, 'add case "a" returning "Z" to the switch in label', [{ path: "src/l.ts", content: src }]), null, "existing label");
  const nd = spec({ id: "core-add-nullish-default-v1", kind: "ADD_NULLISH_DEFAULT", minedFrom: "core", shape: "NULLISH_DEFAULT", trigger: TRIGGERS.ADD_NULLISH_DEFAULT, params: { kinds: ["array", "null", "string"], target: "member" } });
  const f = "export function count(opts: { items?: string[] }): number {\n  const xs = opts.items;\n  return (xs ?? []).length;\n}\n";
  assert.match(applyRule(nd, "default `opts.items` to [] in `count`", [{ path: "src/c.ts", content: f }])!.content, /const xs = opts\.items \?\? \[\];/);
  assert.equal(applyRule(nd, "default opts.items to 0 in count", [{ path: "src/c.ts", content: f }]), null, "number not a learned kind");
});

// ---- approved list and Job A enforcement

const ENTRY_URL = "https://github.com/PeaceG03/PeaceAI-Workspace/issues/50#issuecomment-123";
const entry = (sha: string, over: Partial<ApprovalEntry> = {}): ApprovalEntry => ({
  id: "public-set-literal-v1", sha256: sha, source: "workspace",
  approval: { url: ENTRY_URL, commentId: 123, issue: 50, repo: "PeaceG03/PeaceAI-Workspace", author: "PeaceG03", approvedAt: "2026-10-10T22:00:00Z" }, ...over,
});

test("approved list: strict schema; missing, corrupt or invalid fails closed for every learned rule", () => {
  const dir = scratch();
  try {
    const p = join(dir, "approved.json");
    assert.deepEqual(loadApprovedList(p), { ok: false, reason: "LIST_MISSING" });
    writeFileSync(p, "{not json");
    assert.deepEqual(loadApprovedList(p), { ok: false, reason: "LIST_CORRUPT" });
    writeFileSync(p, JSON.stringify({ schema: APPROVED_SCHEMA, rules: [{ ...entry("a".repeat(64)), approval: { ...entry("a".repeat(64)).approval, author: "someone" } }] }));
    assert.deepEqual(loadApprovedList(p), { ok: false, reason: "LIST_CORRUPT" });
    assert.ok(!validateList({ schema: APPROVED_SCHEMA, rules: [entry("a".repeat(64)), entry("b".repeat(64))] }), "duplicate ids");
    assert.ok(!validateList({ schema: APPROVED_SCHEMA, rules: [entry("a".repeat(64), { id: "core-set-literal-v1" })] }), "core rule approved on Workspace");
    assert.ok(!validateList({ schema: APPROVED_SCHEMA, rules: [entry("a".repeat(64), { approval: { ...entry("a".repeat(64)).approval, commentId: 999 } })] }), "comment id must match URL");
    const s = spec();
    for (const bad of [loadApprovedList(join(dir, "nope.json")), { ok: false as const, reason: "LIST_CORRUPT" as const }])
      assert.deepEqual(admitRules([s], bad).map((a) => a.decision), [bad.ok ? "" : bad.reason]);
    const ok = { ok: true as const, list: { schema: APPROVED_SCHEMA, rules: [entry(specHash(s))] } };
    assert.deepEqual(admitRules([s], ok).map((a) => a.decision), ["APPROVED"]);
    assert.deepEqual(admitRules([spec({ evidence: { ...s.evidence, hunks: 8 } })], ok).map((a) => a.decision), ["HASH_CHANGED"]);
    assert.deepEqual(admitRules([s], { ok: true, list: { schema: APPROVED_SCHEMA, rules: [] } }).map((a) => a.decision), ["NOT_APPROVED"]);
    assert.deepEqual(admitRules([{ id: "x" }], ok).map((a) => a.decision), ["SPEC_INVALID"]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

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

type ListMode = "empty" | "approved" | "hash-changed" | "missing" | "corrupt" | "core-approved" | "default";
function runJobA(mode: ListMode, objective = "set `name` in `src/theme.ts` to \"classic\"") {
  const dir = scratch();
  const ws = join(dir, "ws");
  mkdirSync(join(ws, "src"), { recursive: true });
  writeFileSync(join(ws, "src/theme.ts"), THEME);
  git(ws, "init", "-q");
  commitAll(ws, "base");
  const rules = join(dir, "rules");
  mkdirSync(rules);
  const s = spec();
  writeFileSync(join(rules, `${s.id}.json`), JSON.stringify(s, null, 2));
  const core = join(dir, "core");
  const coreSpec = spec({ id: "core-set-literal-v1", minedFrom: "core", evidence: { hunks: 68, commits: 41, files: 35, repos: ["PeaceG03/PeaceAI"] } });
  if (mode === "core-approved") {
    mkdirSync(join(core, "packages/coding-kernel/learned-rules"), { recursive: true });
    writeFileSync(join(core, "packages/coding-kernel/learned-rules", `${coreSpec.id}.json`), JSON.stringify(coreSpec));
    rmSync(join(rules, `${s.id}.json`));
  }
  const list = join(dir, "approved.json");
  const lists: Record<string, string | null> = {
    empty: JSON.stringify({ schema: APPROVED_SCHEMA, rules: [] }),
    approved: JSON.stringify({ schema: APPROVED_SCHEMA, rules: [entry(specHash(s))] }),
    "hash-changed": JSON.stringify({ schema: APPROVED_SCHEMA, rules: [entry(specHash(spec({ params: { contexts: ["object-property"], kinds: ["string"] } })))] }),
    missing: null,
    corrupt: '{"schema": "peaceai-approved-rules:v1", "rules": [',
    "core-approved": JSON.stringify({ schema: APPROVED_SCHEMA, rules: [{
      id: coreSpec.id, sha256: specHash(coreSpec), source: "results",
      approval: { url: "https://github.com/PeaceG03/PeaceAI-Results/issues/3#issuecomment-77", commentId: 77, issue: 3, repo: "PeaceG03/PeaceAI-Results", author: "PeaceG03", approvedAt: "2026-10-10T22:00:00Z" },
      attestation: { commit: "c".repeat(40), path: `rules/approvals/${specHash(coreSpec)}.json` },
    }] }),
  };
  if (mode !== "default" && lists[mode]) writeFileSync(list, lists[mode]!);
  const out = join(dir, "out");
  const env: Record<string, string> = { ...process.env as Record<string, string>, PEACEAI_KERNEL_BUNDLE: fakeKernel(dir), PEACEAI_OUT_DIR: out, PEACEAI_WORKSPACE_DIR: ws, PEACEAI_TARGET: "PeaceG03/PeaceAI-Workspace", ISSUE_NUMBER: "9", ISSUE_TITLE: "[test] learned", ISSUE_BODY: objective };
  if (mode !== "default") { env.PEACEAI_RULES_DIR = rules; env.PEACEAI_APPROVED_LIST = list; }
  if (mode === "core-approved") env.PEACEAI_CORE_DIR = core;
  const r = spawnSync(tsx, [join(repo, "peaceai/bin/generate.ts")], { cwd: repo, encoding: "utf8", env });
  const summary = existsSync(join(out, "summary.json")) ? JSON.parse(readFileSync(join(out, "summary.json"), "utf8")) : null;
  const diff = summary?.candidates[0] ? readFileSync(join(out, summary.candidates[0].file), "utf8") : "";
  rmSync(dir, { recursive: true, force: true });
  return { r, summary, diff };
}

test("Job A: an UNAPPROVED learned rule produces no candidate", () => {
  const { r, summary } = runJobA("empty");
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /learned rules=1 approved=0 candidates=0 refused=public-set-literal-v1:NOT_APPROVED/);
  assert.equal(summary.candidates.length, 0);
});

test("Job A: a rule whose content hash changed produces no candidate", () => {
  const { r, summary } = runJobA("hash-changed");
  assert.match(r.stdout, /refused=public-set-literal-v1:HASH_CHANGED/);
  assert.equal(summary.candidates.length, 0);
});

test("Job A: a missing or corrupt approved list refuses every learned rule (fail closed)", () => {
  for (const [mode, reason] of [["missing", "LIST_MISSING"], ["corrupt", "LIST_CORRUPT"]] as const) {
    const { r, summary } = runJobA(mode);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, new RegExp(`refused=public-set-literal-v1:${reason}`));
    assert.equal(summary.candidates.length, 0);
  }
});

test("Job A: an APPROVED rule (exact hash) produces its candidate, tagged as learned", () => {
  const { r, summary, diff } = runJobA("approved");
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /learned rules=1 approved=1 candidates=1/);
  assert.equal(summary.candidates.length, 1);
  assert.deepEqual(summary.candidates[0].transformations, ["LEARNED_SET_LITERAL"]);
  assert.equal(summary.candidates[0].operationId, "learned:public-set-literal-v1");
  assert.match(diff, /^-  name: "plain",$/m);
  assert.match(diff, /^\+  name: "classic",$/m);
  // The same approved rule with a non-matching objective: no candidate.
  assert.equal(runJobA("approved", "add a guard to function x").summary.candidates.length, 0);
});

test("Job A: a core-mined rule is read from the core checkout and needs its Results approval entry", () => {
  const { r, summary } = runJobA("core-approved");
  assert.match(r.stdout, /learned rules=1 approved=1 candidates=1/);
  assert.equal(summary.candidates[0].operationId, "learned:core-set-literal-v1");
});

test("Job A with the repository's real list and specs: nothing is approved yet, so learned rules yield nothing", () => {
  const list = loadApprovedList(join(repo, "peaceai/rules/approved.json"));
  assert.ok(list.ok);
  const { r, summary } = runJobA("default");
  assert.equal(r.status, 0, r.stderr);
  if (list.ok && list.list.rules.length === 0) {
    assert.match(r.stdout, /approved=0 candidates=0 refused=public-set-literal-v1:NOT_APPROVED/);
    assert.equal(summary.candidates.length, 0);
  }
});

// ---- approval write path

const PUBLIC = spec();
const PUBLIC_SHA = specHash(PUBLIC);
const proposalOf = (s: RuleSpec) => ({ spec: s, sha256: specHash(s), stats: { shape: s.shape as never, covered: null, hunks: 7, commits: 4, files: 5, examples: [], styles: {} } });
const ev = (over: Partial<CommentEvent> = {}): CommentEvent => ({
  repo: "PeaceG03/PeaceAI-Workspace", body: `/approve-rule ${PUBLIC_SHA}`, author: "PeaceG03", association: "OWNER", commentId: 123, url: ENTRY_URL,
  createdAt: "2026-10-10T22:00:00Z", issue: 50, labels: ["rule-proposal"], issueBody: proposalBody(proposalOf(PUBLIC), []), ...over,
});

test("Workspace approval: only PeaceG03's exact /approve-rule <hash> on the proposal, matching marker and spec file", () => {
  const good = validateWorkspaceApproval(ev(), PUBLIC, []);
  assert.ok(good.ok);
  assert.deepEqual(good.ok && good.entry, entry(PUBLIC_SHA));
  const reason = (e: CommentEvent, s: unknown = PUBLIC, cur: ApprovalEntry[] = []) => { const r = validateWorkspaceApproval(e, s, cur); return r.ok ? "OK" : r.reason; };
  assert.equal(reason(ev({ author: "someone" })), "WRONG_AUTHOR");
  assert.equal(reason(ev({ association: "COLLABORATOR" })), "NOT_OWNER");
  assert.equal(reason(ev({ labels: [] })), "NOT_A_PROPOSAL");
  assert.equal(reason(ev({ body: `/approve-rule ${PUBLIC_SHA} please` })), "BAD_COMMAND");
  assert.equal(reason(ev({ body: `/approve-rule ${PUBLIC_SHA.toUpperCase()}` })), "BAD_COMMAND");
  assert.equal(reason(ev({ body: `/approve-rule ${"0".repeat(64)}` })), "HASH_NOT_PROPOSAL");
  assert.equal(reason(ev({ issueBody: "no marker" })), "NO_MARKER");
  assert.equal(reason(ev(), null), "SPEC_MISSING");
  assert.equal(reason(ev(), spec({ evidence: { ...PUBLIC.evidence, hunks: 99 } })), "SPEC_HASH_MISMATCH");
  assert.equal(reason(ev({ repo: "PeaceG03/PeaceAI-Results" })), "WRONG_SOURCE");
  assert.equal(reason(ev(), PUBLIC, [entry(PUBLIC_SHA)]), "ALREADY_APPROVED");
  assert.equal(parseMarker(`${proposalMarker(proposalOf(PUBLIC))}\n${proposalMarker(proposalOf(PUBLIC))}`), null, "exactly one marker");
});

function approveEnv(dir: string, over: Record<string, string> = {}) {
  const rules = join(dir, "rules");
  mkdirSync(rules, { recursive: true });
  writeFileSync(join(rules, `${PUBLIC.id}.json`), JSON.stringify(PUBLIC, null, 2));
  const e = ev();
  return {
    ...process.env as Record<string, string>, GITHUB_REPOSITORY: e.repo, COMMENT_BODY: e.body, COMMENT_AUTHOR: e.author, COMMENT_ASSOCIATION: e.association,
    COMMENT_ID: "123", COMMENT_URL: e.url, COMMENT_CREATED_AT: "2026-10-10T22:00:00.000Z", ISSUE_NUMBER: "50", ISSUE_LABELS: '["rule-proposal"]', ISSUE_BODY: e.issueBody,
    PEACEAI_RULES_DIR: rules, PEACEAI_APPROVED_LIST_OUT: join(dir, "approved.json"), PEACEAI_MESSAGE_FILE: join(dir, "msg.txt"), GITHUB_OUTPUT: join(dir, "out.txt"), ...over,
  };
}

test("approve-rule.ts workspace: writes the entry and a commit message citing the comment; refusals leave the list untouched", () => {
  const dir = scratch();
  try {
    const list = join(dir, "approved.json");
    writeFileSync(list, JSON.stringify({ schema: APPROVED_SCHEMA, rules: [] }));
    const r = spawnSync(tsx, [join(repo, "peaceai/bin/approve-rule.ts"), "workspace"], { cwd: repo, encoding: "utf8", env: approveEnv(dir) });
    assert.equal(r.status, 0, r.stderr);
    assert.match(readFileSync(join(dir, "out.txt"), "utf8"), /ok=true\nreason=ADDED\nchanged=true\nrules=public-set-literal-v1/);
    const written = JSON.parse(readFileSync(list, "utf8"));
    assert.deepEqual(written.rules, [entry(PUBLIC_SHA)]);
    const msg = readFileSync(join(dir, "msg.txt"), "utf8");
    assert.match(msg, new RegExp(`Approval: ${ENTRY_URL.replace(/[.?]/g, "\\$&")}`));
    assert.match(msg, new RegExp(`SHA-256: ${PUBLIC_SHA}`));
    // Wrong author: refused, list unchanged.
    const before = readFileSync(list, "utf8");
    writeFileSync(join(dir, "out.txt"), "");
    spawnSync(tsx, [join(repo, "peaceai/bin/approve-rule.ts"), "workspace"], { cwd: repo, encoding: "utf8", env: approveEnv(dir, { COMMENT_AUTHOR: "mallory" }) });
    assert.match(readFileSync(join(dir, "out.txt"), "utf8"), /ok=false\nreason=WRONG_AUTHOR\nchanged=false/);
    assert.equal(readFileSync(list, "utf8"), before);
    // A corrupt list is never extended.
    writeFileSync(list, "{");
    writeFileSync(join(dir, "out.txt"), "");
    spawnSync(tsx, [join(repo, "peaceai/bin/approve-rule.ts"), "workspace"], { cwd: repo, encoding: "utf8", env: approveEnv(dir) });
    assert.match(readFileSync(join(dir, "out.txt"), "utf8"), /ok=false\nreason=LIST_CORRUPT/);
    assert.equal(readFileSync(list, "utf8"), "{");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

const CORE = spec({ id: "core-set-literal-v1", minedFrom: "core", evidence: { hunks: 68, commits: 41, files: 35, repos: ["PeaceG03/PeaceAI"] } });
const CORE_SHA = specHash(CORE);
const RESULTS_URL = "https://github.com/PeaceG03/PeaceAI-Results/issues/3#issuecomment-77";
const coreEv = (over: Partial<CommentEvent> = {}) => ev({ repo: "PeaceG03/PeaceAI-Results", body: `/approve-rule ${CORE_SHA}`, url: RESULTS_URL, commentId: 77, issue: 3, issueBody: proposalBody(proposalOf(CORE), [], ["private example"]), ...over });

test("Results approval: the Results workflow script and lib/approval agree; attestation needs the in-issue spec to hash right", async () => {
  const mjs = await import(join(repo, "peaceai/results-repo/rule-approval.mjs"));
  assert.equal(mjs.specHash(CORE), CORE_SHA, "same canonical hash on both sides");
  const cases = [coreEv(), coreEv({ author: "x" }), coreEv({ association: "NONE" }), coreEv({ body: `/approve-rule ${PUBLIC_SHA}` }), coreEv({ repo: "PeaceG03/PeaceAI-Workspace" }),
    coreEv({ issueBody: coreEv().issueBody.replace('"hunks": 68', '"hunks": 69') }), coreEv({ labels: [] })];
  for (const c of cases) assert.deepEqual(mjs.attestationFor(c), attestationFor(c));
  assert.deepEqual(cases.map((c) => { const r = attestationFor(c); return r.ok ? "OK" : r.reason; }),
    ["OK", "WRONG_AUTHOR", "NOT_OWNER", "HASH_NOT_PROPOSAL", "WRONG_SOURCE", "SPEC_HASH_MISMATCH", "NOT_A_PROPOSAL"]);
  assert.deepEqual(parseSpecBlock(coreEv().issueBody), CORE);
  // CLI writes the attestation file.
  const dir = scratch();
  try {
    const e = coreEv();
    const r = spawnSync(process.execPath, [join(repo, "peaceai/results-repo/rule-approval.mjs")], { encoding: "utf8", env: { ...process.env, GITHUB_REPOSITORY: e.repo, COMMENT_BODY: e.body, COMMENT_AUTHOR: e.author, COMMENT_ASSOCIATION: e.association, COMMENT_ID: "77", COMMENT_URL: e.url, COMMENT_CREATED_AT: e.createdAt, ISSUE_NUMBER: "3", ISSUE_LABELS: '["rule-proposal"]', ISSUE_BODY: e.issueBody, RESULTS_ROOT: dir, GITHUB_OUTPUT: join(dir, "o") } });
    assert.equal(r.status, 0, r.stderr);
    const att = JSON.parse(readFileSync(join(dir, "rules/approvals", `${CORE_SHA}.json`), "utf8"));
    assert.deepEqual(att, (attestationFor(e) as { attestation: unknown }).attestation);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("sync: a Results attestation lands only if the core spec hashes to it and its commit cites the comment", () => {
  const att = (attestationFor(coreEv()) as { attestation: unknown }).attestation;
  const commit = "d".repeat(40);
  const ok = entryFromAttestation(att, commit, `approve learned rule core-set-literal-v1\n\nApproval: ${RESULTS_URL}\n`, CORE);
  assert.ok(ok.ok);
  assert.deepEqual(ok.ok && ok.entry.attestation, { commit, path: `rules/approvals/${CORE_SHA}.json` });
  const why = (r: ReturnType<typeof entryFromAttestation>) => (r.ok ? "OK" : r.reason);
  assert.equal(why(entryFromAttestation(att, commit, "no citation", CORE)), "BAD_EVENT");
  assert.equal(why(entryFromAttestation(att, commit, RESULTS_URL, spec({ ...CORE, evidence: { ...CORE.evidence, hunks: 1 } }))), "SPEC_HASH_MISMATCH");
  assert.equal(why(entryFromAttestation(att, commit, RESULTS_URL, null)), "SPEC_MISSING");
  // End to end through approve-rule.ts sync.
  const dir = scratch();
  try {
    const atts = join(dir, "att");
    const core = join(dir, "core/packages/coding-kernel/learned-rules");
    mkdirSync(atts, { recursive: true });
    mkdirSync(core, { recursive: true });
    writeFileSync(join(atts, `${CORE_SHA}.json`), JSON.stringify(att));
    writeFileSync(join(atts, `${CORE_SHA}.commit.json`), JSON.stringify({ commit, message: `x\n\nApproval: ${RESULTS_URL}` }));
    writeFileSync(join(core, `${CORE.id}.json`), JSON.stringify(CORE));
    writeFileSync(join(dir, "approved.json"), JSON.stringify({ schema: APPROVED_SCHEMA, rules: [] }));
    const r = spawnSync(tsx, [join(repo, "peaceai/bin/approve-rule.ts"), "sync"], { cwd: repo, encoding: "utf8", env: { ...process.env, PEACEAI_ATTESTATIONS_DIR: atts, PEACEAI_CORE_DIR: join(dir, "core"), PEACEAI_APPROVED_LIST_OUT: join(dir, "approved.json"), PEACEAI_MESSAGE_FILE: join(dir, "m"), GITHUB_OUTPUT: join(dir, "o") } });
    assert.equal(r.status, 0, r.stderr);
    const list = JSON.parse(readFileSync(join(dir, "approved.json"), "utf8"));
    assert.equal(list.rules[0].source, "results");
    assert.ok(validateList(list));
    assert.match(readFileSync(join(dir, "m"), "utf8"), /Attestation: PeaceG03\/PeaceAI-Results@d{40}/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ---- CI trace guard

function fakeGh(dir: string, comment: Record<string, unknown>, issue: Record<string, unknown>): string {
  const f = join(dir, "gh");
  writeFileSync(f, `#!/usr/bin/env node
const p = process.argv[3];
if (p.includes("/issues/comments/")) process.stdout.write(${JSON.stringify(JSON.stringify(comment))});
else process.stdout.write(${JSON.stringify(JSON.stringify(issue))});
`);
  chmodSync(f, 0o755);
  return f;
}

test("CI guard: each Workspace list entry must trace to PeaceG03's exact comment on the proposal, with the spec hash", () => {
  const dir = scratch();
  try {
    const rules = join(dir, "rules");
    mkdirSync(rules);
    writeFileSync(join(rules, `${PUBLIC.id}.json`), JSON.stringify(PUBLIC));
    const list = join(dir, "approved.json");
    writeFileSync(list, JSON.stringify(withEntry({ schema: APPROVED_SCHEMA, rules: [] }, entry(PUBLIC_SHA))));
    const comment = { user: { login: "PeaceG03" }, author_association: "OWNER", body: `/approve-rule ${PUBLIC_SHA}`, html_url: ENTRY_URL, issue_url: "https://api.github.com/repos/PeaceG03/PeaceAI-Workspace/issues/50" };
    const issue = { labels: [{ name: "rule-proposal" }], body: ev().issueBody };
    const run = (c: Record<string, unknown>, i: Record<string, unknown> = issue) => spawnSync(tsx, [join(repo, "peaceai/bin/check-approved-list.ts")], { cwd: repo, encoding: "utf8", env: { ...process.env, PEACEAI_APPROVED_LIST: list, PEACEAI_RULES_DIR: rules, PEACEAI_GH: fakeGh(dir, c, i) } });
    const good = run(comment);
    assert.equal(good.status, 0, good.stdout + good.stderr);
    assert.match(good.stdout, /APPROVED LIST PASS rules=1/);
    assert.match(run({ ...comment, user: { login: "someone" } }).stdout, /author is not PeaceG03/);
    assert.match(run({ ...comment, body: `/approve-rule ${"1".repeat(64)}` }).stdout, /not exactly \/approve-rule/);
    assert.match(run(comment, { ...issue, labels: [] }).stdout, /not a rule proposal/);
    writeFileSync(join(rules, `${PUBLIC.id}.json`), JSON.stringify(spec({ params: { contexts: ["object-property"], kinds: ["string"] } })));
    const changed = run(comment);
    assert.equal(changed.status, 1);
    assert.match(changed.stdout, /spec file does not hash/);
    writeFileSync(list, "{}");
    assert.match(run(comment).stdout, /APPROVED LIST FAIL LIST_CORRUPT/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ---- proposals and the leak gate

test("proposal leak gate: a public body with links passes; core text, core paths or personal info fail", () => {
  const core = { text: emptyIndex(), paths: new Set(["packages/secret/Thing.ts"]), basenames: new Set(["Thing.ts"]) };
  const coreLine = "export function computeTheVerySpecificInternalThing(alpha: number, beta: number): number {";
  addText(core.text, `${coreLine}\n`);
  const body = proposalBody(proposalOf(PUBLIC), [{ label: "PeaceSTOCKS@abc src/x.ts:1", url: "https://github.com/PeaceG03/PeaceSTOCKS/commit/abc" }]);
  assert.deepEqual(gateProposal(body, core), []);
  assert.ok(!/```diff/.test(body), "public bodies quote no code");
  assert.deepEqual(gateProposal(`${body}\n+${coreLine}`, core), ["core-text:1+0"]);
  assert.deepEqual(gateProposal(`${body}\npackages/secret/Thing.ts`, core), ["core-path"]);
  assert.deepEqual(gateProposal(`${body}\n${["someone", "gmail.com"].join("@")}`, core), ["personal-info:email"]);
  assert.deepEqual(gateProposal(`${body}\nsee PeaceG03/PeaceAI`, core), ["core-repo-reference"]);
});

// ---- wiring

test("workflows: only peace-approve-rule writes the list; Job A reads core rules; tamper-proof runs the trace guard", () => {
  const wf = (n: string) => readFileSync(join(repo, ".github/workflows", n), "utf8");
  const approve = wf("peace-approve-rule.yml");
  assert.match(approve, /contains\(github\.event\.issue\.labels\.\*\.name, 'rule-proposal'\)/);
  assert.match(approve, /github\.event\.comment\.user\.login == 'PeaceG03'/);
  assert.match(approve, /COMMENT_BODY: \$\{\{ github\.event\.comment\.body \}\}/);
  assert.match(approve, /ISSUE_BODY: \$\{\{ github\.event\.issue\.body \}\}/);
  for (const line of approve.split("\n").filter((l) => /github\.event\.(comment|issue)\.(body|title)/.test(l) && !/startsWith\(/.test(l)))
    assert.match(line, /^\s+[A-Z_]+: \$\{\{ github\.event\.(comment|issue)\.body \}\}$/, "untrusted text via env only");
  assert.match(approve, /results-read:[\s\S]*environment: peaceai-results/);
  assert.match(approve, /results-write:[\s\S]*environment: peaceai-core[\s\S]*Delete core/);
  assert.match(wf("ci.yml"), /tamper-proof:[\s\S]*issues: read[\s\S]*check-approved-list\.ts/);
  const task = wf("peace-task.yml");
  assert.match(task, /export PEACEAI_CORE_DIR="\$RUNNER_TEMP\/peaceai-core"[\s\S]*generate\.ts/);
  for (const name of ["peace-task.yml", "peace-verdict.yml", "peace-intake.yml", "peace-train.yml", "ci.yml", "leak-check.yml"]) {
    assert.ok(!/PEACEAI_APPROVED_LIST|PEACEAI_RULES_DIR|approve-rule\.ts|approve-rule-pr\.sh/.test(wf(name)), `${name} never overrides or writes the list`);
  }
  const pr = readFileSync(join(repo, "peaceai/bin/approve-rule-pr.sh"), "utf8");
  assert.match(pr, /only the approved list may change/);
  assert.match(pr, /git add peaceai\/rules\/approved\.json/);
  assert.match(pr, /--required --watch/);
  assert.match(readFileSync(join(repo, ".github/CODEOWNERS"), "utf8"), /^\/peaceai\/rules\/approved\.json @PeaceG03$/m);
  assert.ok(validateList(JSON.parse(readFileSync(join(repo, "peaceai/rules/approved.json"), "utf8"))));
  // Spec files are stored as their canonical JSON, so the file bytes (minus the newline) are what is hashed.
  const pub = readFileSync(join(repo, "peaceai/rules/learned/public-set-literal-v1.json"), "utf8");
  assert.equal(pub, specFileText(JSON.parse(pub)));
  assert.ok(validateSpec(JSON.parse(pub)));
  const results = readFileSync(join(repo, "peaceai/results-repo/rule-approval.yml"), "utf8");
  assert.match(results, /github\.event\.comment\.user\.login == 'PeaceG03'/);
  assert.match(results, /-m "Approval: \$\{COMMENT_URL\}"/);
});
