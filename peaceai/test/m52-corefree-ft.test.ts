// M52 (Architect, M49 Auditor M5): the core-free proof accepts the M49 fine-tune manifest schema
// (doc, split, repo, sha, path, function), fail-closed on unknown fields, with Python/JS parity.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { dualCoreFreeDecision, ftManifestEntryProblem, manifestProvesNoCore, trainedOnShas, validCoreFreeProof, verifyModelDir, modelFileShas, MEMCHECK_SCHEMA } from "../lib/lm.ts";
import { protectedReason } from "../lib/selfchange.ts";

const repo = resolve(import.meta.dirname, "..", "..");
const py = process.env.PEACEAI_PYTHON ?? "python3";
const H = (s: string) => createHash("sha256").update(s).digest("hex");
const S40 = "0123456789abcdef0123456789abcdef01234567";
const body = (n: number) => `export function f${n}(a: number): number {\n  const r = a * ${n} + ${n * 7};\n  return r;\n}`;
const ft = (doc: number, over: Record<string, unknown> = {}) => ({ doc, split: doc % 5 ? "train" : "heldout", repo: "PeaceG03/PeaceSTOCKS", sha: S40, path: `src/f${doc}.ts`, function: `f${doc}`, ...over });
const CORE = Array.from({ length: 40 }, (_, i) => `export function coreOnly${i}(v: string): string { return v.repeat(${i}) + "${i}"; }`).join("\n");


// M49 fix (2) (Auditor #227): fine-tune docs are checked against git, so each run commits its docs into local source
// repos (<root>/<owner>/<repo>) and the placeholder sha S40 in the manifest becomes that real commit.
function sourceRoot(dir: string) {
  const root = join(dir, "src");
  return { root, commit(docs: { doc: unknown; text: string }[], man: unknown[]): unknown[] {
    const text = new Map(docs.map((d) => [d.doc, d.text]));
    const shas = new Map<string, string>();
    for (const m of man as Record<string, unknown>[]) {
      if (!m || typeof m !== "object" || !("function" in m) || typeof m.repo !== "string" || !/^[\w.-]+\/[\w.-]+$/.test(m.repo) || typeof m.path !== "string" || !m.path || !text.has(m.doc)) continue;
      const g = join(root, m.repo);
      if (!existsSync(g)) { mkdirSync(g, { recursive: true }); execFileSync("git", ["init", "-q"], { cwd: g }); }
      mkdirSync(join(g, m.path, ".."), { recursive: true }); writeFileSync(join(g, m.path), text.get(m.doc)!);
      shas.set(m.repo, g);
    }
    const sha = new Map<string, string>();
    for (const [repoName, g] of shas) {
      execFileSync("git", ["add", "-A"], { cwd: g });
      execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "c", "--allow-empty"], { cwd: g });
      sha.set(repoName, execFileSync("git", ["rev-parse", "HEAD"], { cwd: g, encoding: "utf8" }).trim());
    }
    return (man as Record<string, unknown>[]).map((m) => (m && typeof m === "object" && m.sha === S40 && sha.has(m.repo as string) ? { ...m, sha: sha.get(m.repo as string) } : m));
  } };
}
function env() {
  const dir = mkdtempSync(join(tmpdir(), "m52-"));
  const core = join(dir, "core"); mkdirSync(core); writeFileSync(join(core, "x.ts"), CORE);
  execFileSync("git", ["init", "-q"], { cwd: core }); execFileSync("git", ["add", "-A"], { cwd: core });
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "c"], { cwd: core });
  const model = join(dir, "model"); mkdirSync(model);
  writeFileSync(join(model, "config.json"), JSON.stringify({ version: "lm-v1-000000000052" }));
  let k = 0;
  const src = sourceRoot(dir);
  const run = (docs: { doc: unknown; text: string }[], man0: unknown[], stage?: string) => {
    const d = join(dir, `c${k++}`); mkdirSync(d);
    const man = src.commit(docs, man0);
    const manText = man.map((x) => JSON.stringify(x)).join("\n") + "\n";
    writeFileSync(join(d, "docs.jsonl"), docs.map((x) => JSON.stringify(x)).join("\n") + "\n");
    writeFileSync(join(d, "manifest.jsonl"), manText);
    const r = spawnSync(py, [join(repo, "peaceai/model/corefree_proof.py"), "--corpus", d, "--core-dir", core, "--model", model, "--source-root", src.root, ...(stage ? ["--stage", stage] : [])], { encoding: "utf8" });
    const p = join(model, stage ? `corefree-proof-${stage}.json` : "corefree-proof.json");
    return { status: r.status, stderr: r.stderr, out: r.stdout ? JSON.parse(r.stdout) : null, proof: existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null, manSha: H(manText) };
  };
  return { run, model };
}
const DOCS = [0, 1, 2, 3, 4, 5].map((i) => ({ doc: i, text: body(i + 1) }));
const MAN = DOCS.map((d) => ft(d.doc));
const docSha = new Map<unknown, string>(DOCS.map((d) => [d.doc, H(d.text)]));

test("M52: a clean fine-tune manifest is PROVEN; the proof's file hashes are the doc texts' hashes; JS accepts the same proof", () => {
  const { run } = env();
  const r = run(DOCS, MAN);
  assert.equal(r.status, 0, r.stderr); assert.equal(r.out.schema, "finetune"); assert.equal(r.proof.noCoreFiles, "PROVEN");
  for (const f of r.proof.files) assert.equal(f.sha256, docSha.get(f.doc));
  assert.equal(manifestProvesNoCore(MAN, new Set([H(CORE)]), "PeaceG03/PeaceAI", docSha), true);
  assert.deepEqual(validCoreFreeProof(r.proof, { modelId: "lm-v1-000000000052", manifest: MAN, manifestSha256: r.manSha, docSha256: docSha }), { ok: true });
  assert.equal(validCoreFreeProof(r.proof, { modelId: "lm-v1-000000000052", manifest: MAN, manifestSha256: r.manSha }).reason, "FILE_MISMATCH", "no doc hashes: fails closed");
  const wrong = new Map(docSha); wrong.set(0, H("other"));
  assert.equal(validCoreFreeProof(r.proof, { modelId: "lm-v1-000000000052", manifest: MAN, manifestSha256: r.manSha, docSha256: wrong }).reason, "FILE_MISMATCH");
  assert.equal(manifestProvesNoCore(MAN, new Set([H(CORE)])), false, "no doc hashes: not proven");
  assert.equal(manifestProvesNoCore(MAN, new Set([docSha.get(0)!]), "PeaceG03/PeaceAI", docSha), false, "a doc equal to a core file");
});

test("M52: a fine-tune doc that copies core is NOT_PROVEN", () => {
  const { run } = env();
  const r = run([...DOCS, { doc: 6, text: CORE }], [...MAN, ft(6)]);
  assert.equal(r.status, 0, r.stderr); assert.equal(r.proof.noCoreFiles, "NOT_PROVEN");
});

// Every case: Python refuses (exit 1, no proof) exactly when JS reports a problem; same first problem text.
const BAD: [string, Record<string, unknown>][] = [
  ["unknown field", ft(0, { sha256: H("x") })], ["unknown field (license)", ft(0, { license: "MIT" })], ["missing function", (({ function: _f, ...r }) => r)(ft(0))],
  ["missing sha", (({ sha: _s, ...r }) => r)(ft(0))], ["bool doc", ft(0, { doc: true })], ["negative doc", ft(0, { doc: -1 })], ["float doc", ft(0, { doc: 0.5 })],
  ["empty path", ft(0, { path: "" })], ["empty function", ft(0, { function: "" })], ["function not a string", ft(0, { function: 3 })],
  ["bad split", ft(0, { split: "test" })], ["short sha", ft(0, { sha: "abc" })], ["upper sha", ft(0, { sha: S40.toUpperCase() })],
  ["external repo", ft(0, { repo: "honojs/hono" })], ["core repo", ft(0, { repo: "PeaceG03/PeaceAI" })], ["repo not a string", ft(0, { repo: ["PeaceG03/PeaceSTOCKS"] })],
];
test("M52: Python/JS parity on every malformed fine-tune entry (fail closed, no proof written)", () => {
  const { run } = env();
  for (const [name, m] of BAD) {
    const js = ftManifestEntryProblem(m);
    assert.notEqual(js, null, `JS accepts ${name}`);
    const docs = [{ doc: typeof m.doc === "number" && Number.isInteger(m.doc) ? m.doc : 0, text: body(9) }];
    const r = run(docs, [{ ...m }]);
    assert.equal(r.status, 1, `python accepts ${name}`); assert.equal(r.proof, null, name);
    assert.ok(r.stderr.includes(js!), `${name}: python "${r.stderr.trim()}" vs JS "${js}"`);
    assert.equal(manifestProvesNoCore([m], new Set(), "PeaceG03/PeaceAI", new Map([[m.doc, H(body(9))]])), false, name);
  }
  assert.equal(ftManifestEntryProblem(ft(0)), null);
  assert.equal(ftManifestEntryProblem(ft(0, { repo: "PeaceG03/PeaceAI-Workspace", split: "heldout" })), null);
});

test("M52: mixed fine-tune and external/internal entries are refused by both sides", () => {
  const { run } = env();
  const ext = { doc: 1, stage: "pretrain", repo: "honojs/hono", commit: S40, license: "MIT", path: "src/a.ts", sha256: H(body(2)), origin: "external" };
  const r = run([{ doc: 0, text: body(1) }, { doc: 1, text: body(2) }], [ft(0), ext]);
  assert.equal(r.status, 1); assert.match(r.stderr, /mixed fine-tune/); assert.equal(r.proof, null);
  assert.equal(manifestProvesNoCore([ft(0), ext], new Set(), "PeaceG03/PeaceAI", new Map([[0, H(body(1))], [1, H(body(2))]])), false);
  const int = { doc: 1, path: "a.ts", source: "PeaceG03/PeaceSTOCKS", visibility: "public", sha256: H(body(2)) };
  assert.equal(run([{ doc: 0, text: body(1) }, { doc: 1, text: body(2) }], [ft(0), int]).status, 1);
  assert.equal(manifestProvesNoCore([ft(0), int], new Set(), "PeaceG03/PeaceAI", new Map([[0, H(body(1))], [1, H(body(2))]])), false);
});

test("M52: the strict rule is not the fallback for a valid fine-tune proof; the proof code and this test are protected", () => {
  for (const p of ["peaceai/model/corefree_proof.py", "peaceai/lib/lm.ts", "peaceai/bin/lm-memcheck.ts", "peaceai/test/m52-corefree-ft.test.ts"]) assert.ok(protectedReason(p), p);
  const mc = readFileSync(join(repo, "peaceai/bin/lm-memcheck.ts"), "utf8");
  assert.match(mc, /validCoreFreeProof\(proof, \{ modelId, manifest: tm, manifestSha256: trainManifestSha, docSha256 \}\)/);
  assert.match(mc, /manifestProvesNoCore\(tm, coreShas, CORE_SOURCE, docSha256\)/);
});

// ---- Architect (a): one proof per corpus, both manifest shas in config.json, both required for promotion.
const PRE_DOCS = [0, 1, 2, 3].map((i) => ({ doc: i, text: body(i + 50) }));
const C40b = "fedcba9876543210fedcba9876543210fedcba98";
const PRE_MAN = PRE_DOCS.map((d) => ({ doc: d.doc, stage: "pretrain", repo: "honojs/hono", commit: C40b, license: "MIT", path: `src/p${d.doc}.ts`, sha256: H(d.text), bytes: Buffer.byteLength(d.text), origin: "external", split: "train" }));
const preSha = new Map<unknown, string>(PRE_DOCS.map((d) => [d.doc, H(d.text)]));
function dualSetup() {
  const e = env();
  const p = e.run(PRE_DOCS, PRE_MAN, "pretrain"), f = e.run(DOCS, MAN, "finetune");
  assert.equal(p.status, 0, p.stderr); assert.equal(f.status, 0, f.stderr);
  assert.equal(p.proof.corpus, "pretrain"); assert.equal(f.proof.corpus, "finetune");
  assert.equal(p.proof.noCoreFiles, "PROVEN"); assert.equal(f.proof.noCoreFiles, "PROVEN");
  const cfg = { schema: "peaceai-lm:v1", version: "lm-v1-000000000052", trainedOn: { pretrainManifestSha256: p.manSha, finetuneManifestSha256: f.manSha } };
  const corpora = { pretrain: { manifest: PRE_MAN, manifestSha256: p.manSha, docSha256: preSha }, finetune: { manifest: MAN, manifestSha256: f.manSha, docSha256: docSha } };
  return { ...e, cfg, corpora, proofs: { pretrain: p.proof, finetune: f.proof } };
}

test("M52 (a) pass: both per-corpus proofs, each for the manifest sha the model trained on", () => {
  const { cfg, corpora, proofs, model } = dualSetup();
  assert.ok(existsSync(join(model, "corefree-proof-pretrain.json")) && existsSync(join(model, "corefree-proof-finetune.json")));
  assert.deepEqual(dualCoreFreeDecision(cfg, proofs, corpora), { ok: true, reasons: [], trainedOn: { pretrain: cfg.trainedOn.pretrainManifestSha256, finetune: cfg.trainedOn.finetuneManifestSha256 } });
});

test("M52 (a) a missing proof blocks promotion (either one)", () => {
  const { cfg, corpora, proofs } = dualSetup();
  assert.deepEqual(dualCoreFreeDecision(cfg, { ...proofs, finetune: null }, corpora).reasons, ["finetune:MISSING_PROOF"]);
  assert.deepEqual(dualCoreFreeDecision(cfg, { ...proofs, pretrain: undefined }, corpora).reasons, ["pretrain:MISSING_PROOF"]);
  assert.equal(dualCoreFreeDecision({ ...cfg, trainedOn: undefined }, proofs, corpora).reasons[0], "NO_TRAINED_ON");
  assert.equal(dualCoreFreeDecision({ ...cfg, trainedOn: { pretrainManifestSha256: cfg.trainedOn.pretrainManifestSha256 } }, proofs, corpora).ok, false, "one sha missing in config");
});

test("M52 (a) a mismatched manifest sha fails closed (config vs proof, config vs corpus)", () => {
  const { cfg, corpora, proofs } = dualSetup();
  const other = "1".repeat(64);
  assert.deepEqual(dualCoreFreeDecision({ ...cfg, trainedOn: { ...cfg.trainedOn, finetuneManifestSha256: other } }, proofs, corpora).reasons, ["finetune:CORPUS_NOT_TRAINED_ON"]);
  assert.deepEqual(dualCoreFreeDecision({ ...cfg, trainedOn: { ...cfg.trainedOn, finetuneManifestSha256: other } }, proofs, { ...corpora, finetune: { ...corpora.finetune, manifestSha256: other } }).reasons, ["finetune:MANIFEST_MISMATCH"], "proof is for another manifest");
  assert.deepEqual(dualCoreFreeDecision(cfg, { ...proofs, pretrain: { ...proofs.pretrain, manifestSha256: other } }, corpora).reasons, ["pretrain:MANIFEST_MISMATCH"]);
  assert.equal(trainedOnShas({ trainedOn: { pretrainManifestSha256: other, finetuneManifestSha256: other } }), null, "the same sha for both corpora is refused");
  assert.equal(trainedOnShas({ trainedOn: { pretrainManifestSha256: other, finetuneManifestSha256: "2".repeat(64), extra: 1 } }), null);
});

test("M52 (a) a swapped proof is refused (by corpus label, and by sha even if relabelled)", () => {
  const { cfg, corpora, proofs } = dualSetup();
  const sw = dualCoreFreeDecision(cfg, { pretrain: proofs.finetune, finetune: proofs.pretrain }, corpora).reasons;
  assert.deepEqual(sw, ["pretrain:SWAPPED_PROOF", "finetune:SWAPPED_PROOF"]);
  const relabel = dualCoreFreeDecision(cfg, { pretrain: { ...proofs.finetune, corpus: "pretrain" }, finetune: { ...proofs.pretrain, corpus: "finetune" } }, corpora).reasons;
  assert.deepEqual(relabel, ["pretrain:MANIFEST_MISMATCH", "finetune:MANIFEST_MISMATCH"]);
  assert.equal(dualCoreFreeDecision(cfg, proofs, { pretrain: corpora.finetune, finetune: corpora.pretrain }).ok, false, "corpora swapped");
});

test("M52 (a) --stage must match the manifest schema; the single-corpus file is untouched by --stage", () => {
  const e = env();
  assert.equal(e.run(DOCS, MAN, "pretrain").status, 1);
  assert.equal(e.run(PRE_DOCS, PRE_MAN, "finetune").status, 1);
  assert.ok(!existsSync(join(e.model, "corefree-proof.json")));
});

test("M52 (a) loaders refuse a two-corpus model unless memcheck recorded both proofs valid for its trainedOn shas", () => {
  const dir = mkdtempSync(join(tmpdir(), "m52v-"));
  const trainedOn = { pretrainManifestSha256: "3".repeat(64), finetuneManifestSha256: "4".repeat(64) };
  writeFileSync(join(dir, "config.json"), JSON.stringify({ schema: "peaceai-lm:v1", version: "lm-v1-000000000052", trainedOn }));
  writeFileSync(join(dir, "tokenizer.json"), "{}"); writeFileSync(join(dir, "weights.npz"), "w");
  const mc = (extra: Record<string, unknown>) => writeFileSync(join(dir, "memcheck.json"), JSON.stringify({ schema: MEMCHECK_SCHEMA, status: "PASS", files: modelFileShas(dir), ...extra }));
  mc({}); assert.deepEqual(verifyModelDir(dir), { ok: false, reason: "MEMCHECK_FAILED" });
  mc({ coreFreeProofs: { ok: false, reasons: ["finetune:MISSING_PROOF"], trainedOn: { pretrain: "3".repeat(64), finetune: "4".repeat(64) } } }); assert.equal(verifyModelDir(dir).ok, false);
  mc({ coreFreeProofs: { ok: true, reasons: [], trainedOn: { pretrain: "3".repeat(64), finetune: "5".repeat(64) } } }); assert.equal(verifyModelDir(dir).ok, false, "memcheck was for other manifests");
  mc({ coreFreeProofs: { ok: true, reasons: [], trainedOn: { pretrain: "3".repeat(64), finetune: "4".repeat(64) } } }); assert.deepEqual(verifyModelDir(dir), { ok: true, version: "lm-v1-000000000052" });
});

test("M52 (a) memcheck runs once on the final model against both corpora, fails closed, never falls back to strict", () => {
  const mc = readFileSync(join(repo, "peaceai/bin/lm-memcheck.ts"), "utf8");
  assert.match(mc, /PEACEAI_LM_FT_CORPUS/);
  assert.match(mc, /dualCoreFreeDecision\(cfgNow, \{ pretrain: readProof\("pretrain"\), finetune: readProof\("finetune"\) \}/);
  assert.match(mc, /scan = dual && !dual\.ok \? null :/, "a failed dual decision means no scan, so status FAIL");
  assert.match(mc, /buildSubstringIndex\(\[\.\.\.pre\.txt, \.\.\.ft\.txt\]\)/, "the exemption corpus is both corpora");
  assert.match(mc, /if \("trainedOn" in cfgNow \|\| ftCorpus\)/, "a trainedOn model cannot be checked as single-corpus");
});

// ---- M49 fix (2) (Architect option (i)): a fine-tune doc that is a prefix / near copy of a NEWER version of a pinned
// public-origin core file is accepted only when its own repo + path equal that pin's public origin.
const UNIV = Array.from({ length: 40 }, (_, i) => `export function elig${i}(barCount: number): string { return barCount > ${i} ? "LEVEL_${i % 3}" : "LEVEL_0"; }`).join("\n") + "\n";
const FEAT = Array.from({ length: 40 }, (_, i) => `export function featureRecipe${i}(x: number[]): number { return x.slice(${i}).reduce((a, b) => a + b * ${i + 1}, 0); }`).join("\n") + "\n";
const PRIV = Array.from({ length: 40 }, (_, i) => `export function privateCore${i}(s: string): string { return s.padStart(${i + 3}, "*") + "${i}"; }`).join("\n") + "\n";
function pinEnv() {
  const dir = mkdtempSync(join(tmpdir(), "m49p-"));
  const core = join(dir, "core");
  const files: Record<string, string> = { "packages/markets-scanner/src/universe.ts": UNIV, "packages/markets-scanner/src/features.ts": FEAT, "packages/private.ts": PRIV };
  for (const [p, t] of Object.entries(files)) { mkdirSync(join(core, p, ".."), { recursive: true }); writeFileSync(join(core, p), t); }
  mkdirSync(join(core, "docs"));
  writeFileSync(join(core, "docs", "peaceai-public-origin.json"), JSON.stringify({ schema: "peaceai-public-origin:v1", files: [
    { path: "packages/markets-scanner/src/features.ts", sha256: H(FEAT), origin: "PeaceG03/PeaceSTOCKS@607525c:src/features.ts" },
    { path: "packages/markets-scanner/src/universe.ts", sha256: H(UNIV), origin: "PeaceG03/PeaceSTOCKS@99c0cfb:src/universe.ts" },
  ] }));
  execFileSync("git", ["init", "-q"], { cwd: core }); execFileSync("git", ["add", "-A"], { cwd: core });
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "c"], { cwd: core });
  const model = join(dir, "model"); mkdirSync(model);
  writeFileSync(join(model, "config.json"), JSON.stringify({ version: "lm-v1-000000000049" }));
  let k = 0;
  const src = sourceRoot(dir);
  return (docs: { doc: number; text: string }[], man0: unknown[], opts: { root?: string | null; expectExit?: number } = {}) => {
    const d = join(dir, `c${k++}`); mkdirSync(d);
    const man = src.commit(docs, man0);
    writeFileSync(join(d, "docs.jsonl"), docs.map((x) => JSON.stringify(x)).join("\n") + "\n");
    writeFileSync(join(d, "manifest.jsonl"), man.map((x) => JSON.stringify(x)).join("\n") + "\n");
    const r = spawnSync(py, [join(repo, "peaceai/model/corefree_proof.py"), "--corpus", d, "--core-dir", core, "--model", model, "--stage", "finetune", ...(opts.root === null ? [] : ["--source-root", opts.root ?? src.root])], { encoding: "utf8" });
    if (opts.expectExit) { assert.equal(r.status, opts.expectExit, r.stderr); assert.ok(!existsSync(join(model, "corefree-proof-finetune.json"))); return { stderr: r.stderr } as never; }
    assert.equal(r.status, 0, r.stderr);
    const proof = JSON.parse(readFileSync(join(model, "corefree-proof-finetune.json"), "utf8"));
    return { out: JSON.parse(r.stdout), proof, file: (doc: number) => proof.files.find((f: { doc: number }) => f.doc === doc) };
  };
}
// doc 44: a cut-off prefix of a newer PeaceSTOCKS src/universe.ts (refreshEligibility appended, then truncated).
const DOC44 = UNIV.split("\n").slice(0, 36).join("\n") + "\nexport async function refreshEligibility(storage: unknown) {\n  const counts = await storage";
// doc 13: the featureRecipe case, src/features.ts at a newer commit (same code, reformatted whitespace + tail).
const DOC13 = FEAT.replace(/ \{ return/g, " {\n  return").split("\n").slice(0, 70).join("\n");
const STOCKS = (doc: number, path: string, fn: string) => ft(doc, { path, function: fn });

test("M49 fix (2): doc 44 (universe.ts prefix) and doc 13 (featureRecipe, features.ts) are PROVEN only via their pin's own origin", () => {
  const run = pinEnv();
  const r = run([...DOCS, { doc: 13, text: DOC13 }, { doc: 44, text: DOC44 }], [...MAN, STOCKS(13, "src/features.ts", "featureRecipe"), STOCKS(44, "src/universe.ts", "refreshEligibility")]);
  assert.notEqual(H(DOC44), H(UNIV)); assert.notEqual(H(DOC13), H(FEAT));
  assert.equal(r.proof.noCoreFiles, "PROVEN"); assert.equal(r.out.allowlistedPublicOrigin, 2);
  assert.equal(r.file(13).coreExact, false); assert.equal(r.file(44).coreExact, false);
});

test("M49 fix (2) negative: a doc that matches a pinned file but whose source is not the pin's origin is still refused", () => {
  const run = pinEnv();
  for (const [name, m] of [
    ["other repo, same path", ft(44, { repo: "PeaceG03/PeaceAI-Workspace", path: "src/universe.ts", function: "refreshEligibility" })],
    ["same repo, other path", STOCKS(44, "src/scanner.ts", "refreshEligibility")],
    ["origin of the OTHER pin", STOCKS(44, "src/features.ts", "refreshEligibility")],
  ] as const) {
    const r = run([...DOCS, { doc: 44, text: DOC44 }], [...MAN, m]);
    assert.equal(r.proof.noCoreFiles, "NOT_PROVEN", name); assert.equal(r.file(44).coreExact, true, name); assert.equal(r.out.allowlistedPublicOrigin, 0, name);
  }
  // A doc from the pin's origin that also carries non-pinned core text is still caught by the core check.
  const mixed = run([...DOCS, { doc: 44, text: PRIV }], [...MAN, STOCKS(44, "src/universe.ts", "refreshEligibility")]);
  assert.equal(mixed.proof.noCoreFiles, "NOT_PROVEN");
});

test("M49 fix (2) containment: a whole pinned file plus a few verbatim private core lines, labelled with its origin, is refused", () => {
  const run = pinEnv();
  const priv = PRIV.split("\n");
  for (const n of [3, 4, 6]) {
    const mixed = UNIV + priv.slice(10, 10 + n).join("\n") + "\n";
    const r = run([...DOCS, { doc: 44, text: mixed }], [...MAN, STOCKS(44, "src/universe.ts", "refreshEligibility")]);
    assert.equal(r.proof.noCoreFiles, "NOT_PROVEN", `${n} private lines`); assert.equal(r.file(44).coreExact, true);
    assert.ok(r.file(44).coreContained > 0); assert.ok(r.file(44).coreNearMax < 0.8, "similarity alone would not catch it");
  }
});

test("M49 fix (2) containment: half-core dilution (half private core, half new code, similarity under the threshold) is refused", () => {
  const run = pinEnv();
  const fresh = Array.from({ length: 40 }, (_, i) => `export const novel${i} = (q: number) => Math.max(q, ${i * 13}) - ${i};`);
  const half = [...PRIV.split("\n").slice(0, 20), ...fresh].join("\n");
  const r = run([...DOCS, { doc: 7, text: half }], [...MAN, ft(7)]);
  assert.ok(r.file(7).coreNearMax < 0.8, `near ${r.file(7).coreNearMax}`);
  assert.equal(r.proof.noCoreFiles, "NOT_PROVEN"); assert.equal(r.file(7).coreExact, true); assert.ok(r.file(7).coreContained > 0);
  const clean = run([...DOCS, { doc: 7, text: fresh.join("\n") }], [...MAN, ft(7)]);
  assert.equal(clean.proof.noCoreFiles, "PROVEN"); assert.equal(clean.file(7).coreContained, 0);
});

test("M49 fix (2) git: each fine-tune doc must be a prefix of repo@sha:path; no source root, unknown commit or a non-prefix fails closed", () => {
  const run = pinEnv();
  const ok = run([...DOCS, { doc: 44, text: DOC44 }], [...MAN, STOCKS(44, "src/universe.ts", "refreshEligibility")]);
  assert.equal(ok.proof.noCoreFiles, "PROVEN");
  run([...DOCS], MAN, { root: null, expectExit: 1 });
  run([...DOCS], MAN, { root: join(tmpdir(), "m49-no-such-root"), expectExit: 1 });
  run([...DOCS], [...MAN.slice(0, 5), ft(5, { sha: "f".repeat(40) })], { expectExit: 1 });
  // The manifest names a path whose committed text is not what the doc says (doc text != committed prefix).
  const r = run([...DOCS], [...MAN.slice(0, 5), ft(5, { path: "src/f0.ts" })], { expectExit: 1 }) as unknown as { stderr: string };
  assert.match(r.stderr, /not a prefix/);
});
