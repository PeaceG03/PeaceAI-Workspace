// M85 REPLACE_EXPRESSION v2 (public-replace-expression-v2; stress gap 4, bounded bug fixes): the unchanged M27 engine
// (Auditor #136 rounds 1-3) gets a spec again, under a NEW id, with evidence from licensed external repos outside the
// training corpus (M27's Peace-only evidence was 5/27, below the bar). The engine's site/vocabulary core is now one
// function (replaceSite) shared by Job A and the evidence replay; the per-repo path allow-list stays a Job A check.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { admitRules } from "../lib/approved.ts";
import { EDITABLE_PATHS, REPLACE_TRIGGER, replaceFits, replaceSite } from "../lib/learned-body.ts";
import { applyRule, specHash, TRIGGERS, validateSpec, type RuleSpec } from "../lib/learned.ts";
import { classifyLicense } from "../lib/lmcorpus.ts";
import { readManifestBytes } from "../lib/manifestparts.ts";
import { phrasingFor } from "../lib/propose.ts";
import { PROTECTED_SELF } from "../lib/selfchange.ts";

const root = resolve(import.meta.dirname, "../..");
const read = (p: string) => readFileSync(resolve(root, p), "utf8");
const SPEC = JSON.parse(read("peaceai/rules/learned/public-replace-expression-v2.json")) as RuleSpec;
const SHA = "50fd5723ad988ff4732606343c04c583216e5984f9fcae4b87e72ad3757f8c88";
const SRC = "export function bandOf(x: number, lo: number, hi: number): string {\n  if (x < lo) return \"below\";\n  if (x > hi) return \"above\";\n  return \"inside\";\n}\n";
const FILES = [{ path: "src/num-utils.ts", content: SRC }];
const isTest = (p: string) => /\.test\.ts$/.test(p);
const run = (line: string, files = FILES, repo = "PeaceG03/PeaceSTOCKS") => applyRule(SPEC, [line, "- bandOf(5, 1, 5) is \"above\""].join("\n"), files, isTest, repo, {}, () => false);

test("spec: valid, hash pinned, the M27 trigger and params; any listed approval pins the exact hash", () => {
  assert.ok(validateSpec(SPEC));
  assert.equal(specHash(SPEC), SHA);
  assert.equal(SPEC.kind, "REPLACE_EXPRESSION");
  assert.equal(SPEC.trigger, REPLACE_TRIGGER);
  assert.equal(TRIGGERS.REPLACE_EXPRESSION, REPLACE_TRIGGER);
  assert.deepEqual(SPEC.params, { calls: "pure-builtins-and-old-callees-any-args", grading: "self-fail-before-pass-after", match: "unique-site", names: "old-names-params-and-enclosing-locals", paths: "allow-listed-leaf-modules", sites: ["if-condition", "return-expression"], test: "new-file" });
  for (const [k, v] of [["paths", "any"], ["names", "any"], ["sites", ["if-condition", "assignment"]], ["calls", "any"]] as const) assert.ok(!validateSpec({ ...SPEC, params: { ...SPEC.params, [k]: v } }), k);
  assert.ok(!validateSpec({ ...SPEC, minedFrom: "core", id: "core-replace-expression-v2" }));
  const onMain = JSON.parse(read("peaceai/rules/approved.json")) as { rules: { id: string; sha256: string }[] };
  for (const r of onMain.rules.filter((x) => x.id === SPEC.id)) assert.equal(r.sha256, SHA, "a listed entry pins the exact spec hash");
  assert.match(phrasingFor(SPEC), /replace/);
  for (const p of ["peaceai/rules/learned/public-replace-expression-v2.json", "peaceai/rules/proposals/public-replace-expression-v2.json", "peaceai/rules/proposals/m85-replace-expression-v2-evidence.json", "peaceai/test/m85-replace-expression.test.ts", "peaceai/test/fixtures/m85-replace/x.txt", "peaceai/spec/replace-expression-v2.md", "peaceai/lib/learned-body.ts"]) assert.ok(PROTECTED_SELF.some((x) => x.pattern.test(p)), p);
});

test("Job A: admitted only with the exact hash", () => {
  const list = (sha: string, source = "workspace") => ({ ok: true as const, list: { schema: "peaceai-approved-rules:v1", rules: [{ id: SPEC.id, sha256: sha, source }] } as never });
  assert.equal(admitRules([SPEC], list(SHA))[0]!.decision, "APPROVED");
  assert.equal(admitRules([SPEC], list("0".repeat(64)))[0]!.decision, "HASH_CHANGED");
  assert.equal(admitRules([SPEC], list(SHA, "results"))[0]!.decision, "NOT_APPROVED");
});

test("builds a one-site edit plus a new test on an allow-listed module; refused off the list or on another repo", () => {
  const e = run("in bandOf in src/num-utils.ts: replace condition x > hi with x >= hi");
  assert.ok(e && "extra" in e, "built");
  assert.equal((e as { content: string }).content, SRC.replace("if (x > hi)", "if (x >= hi)"));
  assert.ok(EDITABLE_PATHS["PeaceG03/PeaceSTOCKS"]!.includes("src/num-utils.ts"));
  assert.equal(run("in bandOf in src/other.ts: replace condition x > hi with x >= hi", [{ path: "src/other.ts", content: SRC }]), null, "off the allow-list");
  assert.equal(run("in bandOf in src/num-utils.ts: replace condition x > hi with x >= hi", FILES, "someone/else"), null, "another repo");
  assert.equal(run("in bandOf in src/num-utils.ts: replace condition x > hi with true"), null, "constant condition");
  assert.equal(run("in bandOf in src/num-utils.ts: replace condition x > hi with process.exit(1)"), null, "new name");
});

test("replaceSite / replaceFits: the shared core; ambiguous or out-of-vocabulary edits are refused", () => {
  assert.equal(replaceSite("m.ts", SRC, "bandOf", "if-condition", "x > hi", "x >= hi"), SRC.replace("x > hi", "x >= hi"));
  assert.equal(replaceFits(SRC, "condition", "x > hi", "x >= hi"), "bandOf");
  assert.equal(replaceFits(SRC, "return", "\"inside\"", "lo"), "bandOf");
  assert.equal(replaceFits(SRC + SRC.replace("bandOf", "bandOf2"), "condition", "x > hi", "x >= hi"), null, "two functions fit: ambiguous");
  assert.equal(replaceFits(SRC, "condition", "x > hi", "x[0] > hi"), null, "element access");
  assert.equal(replaceFits(SRC.replace("export ", ""), "condition", "x > hi", "x >= hi"), null, "not exported");
});

test("Job B wiring unchanged: LEARNED_REPLACE_EXPRESSION is graded by gradeSelf with the assertion-only before-run", () => {
  const tc = read("peaceai/bin/test-candidates.ts");
  assert.match(tc, /candidate\.transformations\.includes\("LEARNED_REPLACE_EXPRESSION"\)\);/);
  assert.match(tc, /if \(!run\.ok && !assertionFailuresOnly\(run\.out\)\) return ungradable\("before-not-assertion"\);/);
});

// ---- mined evidence ----
type Ex = { repo: string; commit: string; parent: string; path: string; fn: string; site: "condition" | "return"; old: string; new: string; sha256: string; fileBlob: string; fixture: string; license: string; licenseSha256: string };
const EV = JSON.parse(read("peaceai/rules/proposals/m85-replace-expression-v2-evidence.json")) as { bar: number; manifestSha256: string; examples: Ex[]; peace: { repo: string; checkedAt: string; fits: number }[] };
const gitBlob = (b: Buffer) => createHash("sha1").update(`blob ${b.length}\0`).update(b).digest("hex");
test("evidence: bar met; every parent module blob-pinned; the engine core accepts every replacement on it", () => {
  assert.ok(EV.examples.length >= EV.bar && EV.bar >= 10);
  assert.equal(new Set(EV.examples.map((e) => `${e.path}\0${e.old}\0${e.new}`)).size, EV.examples.length);
  for (const e of EV.examples) {
    const b = readFileSync(resolve(root, e.fixture));
    assert.ok(b.length <= 65536, e.fixture);
    assert.equal(gitBlob(b), e.fileBlob, e.fixture);
    assert.equal(createHash("sha256").update(b).digest("hex"), e.sha256);
    assert.ok(e.fixture.endsWith(`${e.repo.replace("/", "__")}-${e.fileBlob.slice(0, 12)}.txt`));
    assert.match(e.commit, /^[0-9a-f]{40}$/); assert.match(e.parent, /^[0-9a-f]{40}$/);
    assert.equal(replaceFits(b.toString("utf8"), e.site, e.old, e.new, e.path), e.fn, `${e.repo} ${e.fn}`);
  }
});
test("evidence: permissive licenses by hash (as in THIRD_PARTY_NOTICES); fixtures dir holds exactly the evidence fixtures", () => {
  const notices = read("THIRD_PARTY_NOTICES");
  for (const e of EV.examples) {
    assert.ok(["MIT", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "ISC"].includes(e.license), e.repo);
    assert.ok(notices.includes(`repo: ${e.repo}\nlicense: ${e.license} (`) && notices.includes(`sha256 of trimmed text ${e.licenseSha256})`), e.repo);
    assert.ok(notices.includes(`  ${e.commit} ${e.fixture}\n`), e.fixture);
  }
  assert.equal(classifyLicense("MIT License\nPermission is hereby granted, free of charge, to any person obtaining a copy ... PROVIDED \"AS IS\""), "MIT");
  const listed = new Set(EV.examples.map((e) => e.fixture.split("/").pop()));
  const have = readdirSync(resolve(root, "peaceai/test/fixtures/m85-replace"));
  for (const f of have) { assert.ok(listed.has(f), f); assert.ok(!/licen[cs]e/i.test(f)); }
  assert.equal(have.length, listed.size);
});
test("evidence: no overlap with the training corpus or the ext-manifest; Peace's public repos checked first and not counted", () => {
  const buf = readManifestBytes(resolve(root, "peaceai/model"), "ext-manifest");
  assert.equal(createHash("sha256").update(buf).digest("hex"), EV.manifestSha256);
  const repos = new Set<string>(); const shas = new Set<string>();
  for (const l of buf.toString("utf8").split("\n")) if (l.trim()) { const r = JSON.parse(l) as { repo?: string; sha256?: string }; if (r.repo) repos.add(r.repo); if (r.sha256) shas.add(r.sha256); }
  for (const r of (JSON.parse(read("peaceai/model/ext-corpus.json")) as { repos: { name: string }[] }).repos) repos.add(r.name);
  for (const e of EV.examples) { assert.ok(!repos.has(e.repo), e.repo); assert.ok(!shas.has(e.sha256), e.path); assert.ok(!e.repo.startsWith("PeaceG03/")); }
  assert.deepEqual(EV.peace.map((p) => p.repo).sort(), ["PeaceG03/PeaceAI-Workspace", "PeaceG03/PeaceSTOCKS"]);
  for (const p of EV.peace) { assert.ok(repos.has(p.repo), `${p.repo} is in the corpus manifest`); assert.match(p.checkedAt, /^[0-9a-f]{40}$/); }
  const rec = JSON.parse(read("peaceai/rules/proposals/public-replace-expression-v2.json")) as { status: string; learned: string; evidence: { examples: number; bar: number; repos: number; qualifies: boolean } };
  assert.match(rec.status, /^proposal-off/);
  assert.equal(rec.learned, "peaceai/rules/learned/public-replace-expression-v2.json");
  assert.equal(rec.evidence.examples, EV.examples.length);
  assert.equal(rec.evidence.repos, new Set(EV.examples.map((e) => e.repo)).size);
  assert.ok(rec.evidence.examples >= rec.evidence.bar && rec.evidence.qualifies);
  assert.deepEqual(SPEC.evidence.repos, [...new Set(EV.examples.map((e) => e.repo))].sort());
  assert.equal(SPEC.evidence.hunks, EV.examples.length);
});
