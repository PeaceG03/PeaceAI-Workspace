// M126 (run 40694718190 follow-up; Peace 2026-10-28, Auditor's ruling): the pretrain retrain memcheck uses the EXISTING
// two-corpus mode of lm-memcheck.ts (PEACEAI_LM_TRAIN_CORPUS = the replay corpus, PEACEAI_LM_FT_CORPUS = the fine-tune
// corpus), with both proofs verified against the manifests rebuilt in that run: the live model's proof for the live
// manifest (pin lm-retrain.json live.corefreeProofSha256, manifest replay.manifestSha256) and the corpus-gate fine-tune
// proof (the run record's finetuneCorefreeProofSha256). Anything missing or mismatched FAILs (never the strict
// fallback); line, shingle and personal-info hits stay hard; no new rule or threshold. The starting-weights link is a
// note only. Only the replay corpus's train docs explain a hit: fine-tune text never does (pretrain mode trains on
// no fine-tune row, lm-retrain-train.sh ftRows == 0), though the fine-tune proof and binding stay hard checks.
// Text of the live model's older corpus that this run did not rebuild is unexplained. Also: the
// memcheck-only path (input memcheck_only_run_id: append a recheck record, promote nothing) and the outcome message
// "memcheck FAIL (record landed)". Fixtures only: no real model, corpus or core is read.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { retrainPretrainChainDecision, retrainPretrainTrainedOn, RETRAIN_FT_PROOF_MODEL, validCoreFreeProof, LM_JOBS, type RetrainChainInput } from "../lib/lm.ts";

const repo = resolve(import.meta.dirname, "..", "..");
const tsx = join(repo, "node_modules/.bin/tsx");
const py = process.env.PEACEAI_PYTHON ?? "python3";
const H = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");
const read = (p: string) => readFileSync(join(repo, p), "utf8");
const WF = read(".github/workflows/peace-lm-retrain.yml");
const tmp = (fn: (d: string) => void) => { const d = mkdtempSync(join(tmpdir(), "m126-")); try { fn(d); } finally { rmSync(d, { recursive: true, force: true }); } };
const env0 = (over: Record<string, string | undefined>) => { const e: Record<string, string> = {}; for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !(k in over) && !k.startsWith("PEACEAI_")) e[k] = v; for (const [k, v] of Object.entries(over)) if (v !== undefined) e[k] = v; return e; };
const job = (j: string) => { const i = WF.indexOf(`\n  ${j}:\n`); assert.ok(i > 0, j); const rest = WF.slice(i + 1); const n = rest.slice(1).search(/\n  [a-z][a-z-]*:\n/); return n < 0 ? rest : rest.slice(0, n + 1); };
const LIVE = "lm-v1-0000000000aa", CAND = "lm-v1-000000000126", RUN = "40694718190";
const SCHEMA = "peaceai-lm-corefree-proof:v1";

// ---- fixture: core checkout, live manifest, replay corpus (a subset of it), fine-tune corpus, both proofs, model
const secret = [0, 1, 2, 3, 4].map((k) => `export const internalSecretRoutine${k} = (alpha${k}: number, beta${k}: string) => alpha${k} * ${k + 7} + beta${k}.length + ${k * 1000 + 17};`);
const RUN_TRAIN = secret[0]!.slice(6, 86), RUN_HELD = secret[1]!.slice(6, 86), RUN_LIVE = secret[2]!.slice(6, 86), RUN_NONE = secret[3]!.slice(6, 86), RUN_FT = secret[4]!.slice(6, 86);
const filler = (k: string, i: number) => Array.from({ length: 6 }, (_, j) => `export const ${k}Thing${i}_${j} = ${j};`).join("\n") + "\n";
const ext = (doc: number, text: string, split: string) => ({ doc, stage: "pretrain", repo: "colinhacks/zod", commit: "c".repeat(40), license: "MIT", path: `src/z${doc}.ts`, sha256: H(text), bytes: Buffer.byteLength(text), origin: "external", split });
const line = (o: object) => JSON.stringify(o);

function fixture(d: string) {
  const core = join(d, "core"); mkdirSync(join(core, "src"), { recursive: true });
  for (let i = 0; i < 100; i++) writeFileSync(join(core, "src", `c${i}.ts`), Array.from({ length: 12 }, (_, j) => `export const privateCoreValue${i}_${j} = ${i * 100 + j};`).join("\n") + "\n");
  writeFileSync(join(core, "src", "secret.ts"), secret.join("\n") + "\n");
  execFileSync("git", ["init", "-q"], { cwd: core }); execFileSync("git", ["add", "-A"], { cwd: core });
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "c"], { cwd: core });
  // live manifest: docs 0-1 train + 2 heldout are replayed; docs 3-4 are only in the live model's older corpus
  const texts = [`const kept = 1;\n${secret[0]}\n` + filler("a", 0), filler("b", 1), `const held = \`${RUN_HELD}\`;\n` + filler("c", 2), `const old = \`${RUN_LIVE}\`;\n` + filler("d", 3), filler("e", 4)];
  const splits = ["train", "train", "heldout", "train", "train"];
  const liveLines = texts.map((t, i) => line(ext(i, t, splits[i]!)));
  const liveMan = liveLines.join("\n") + "\n";
  writeFileSync(join(d, "live-manifest.jsonl"), liveMan);
  const rp = join(d, "replay"); mkdirSync(rp);
  writeFileSync(join(rp, "docs.jsonl"), [0, 1, 2].map((i) => line({ doc: i, text: texts[i] })).join("\n") + "\n");
  const rpMan = liveLines.slice(0, 3).join("\n") + "\n"; writeFileSync(join(rp, "manifest.jsonl"), rpMan);
  const proofFiles = (ents: { doc: number; path: string; sha256: string }[], source: string) => ents.map((e) => ({ doc: e.doc, path: e.path, source, sha256: e.sha256, coreExact: false, coreNearMax: 0.1 }));
  const liveProof = { schema: SCHEMA, model: LIVE, noCoreFiles: "PROVEN", manifestSha256: H(liveMan), coreCommit: "a".repeat(40), corpus: null, near: { method: "minhash", threshold: 0.8 }, files: proofFiles(texts.map((t, i) => ({ doc: i, path: `src/z${i}.ts`, sha256: H(t) })), "colinhacks/zod") };
  const liveProofText = JSON.stringify(liveProof, null, 2) + "\n"; writeFileSync(join(d, "live-proof.json"), liveProofText);
  // fine-tune corpus (ft-pairs schema; no content sha in the manifest)
  const ftTexts = [`function ftOne(a: number) {\n  return a + 1;\n}\nconst ftNote = \`${RUN_FT}\`;\n`, `function ftTwo(b: string) {\n  return b.trim();\n}\n`];
  const ftEnts = ftTexts.map((_, i) => ({ doc: i, split: i === 0 ? "train" : "heldout", repo: "PeaceG03/PeaceAI-Workspace", sha: "e".repeat(40), path: `peaceai/lib/f${i}.ts`, function: `ft${i}` }));
  const ft = join(d, "ft"); mkdirSync(ft);
  writeFileSync(join(ft, "docs.jsonl"), ftTexts.map((t, i) => line({ doc: i, text: t })).join("\n") + "\n");
  const ftMan = ftEnts.map(line).join("\n") + "\n"; writeFileSync(join(ft, "manifest.jsonl"), ftMan);
  const ftProof = { schema: SCHEMA, model: RETRAIN_FT_PROOF_MODEL, noCoreFiles: "PROVEN", manifestSha256: H(ftMan), near: { method: "minhash", threshold: 0.8 }, files: proofFiles(ftEnts.map((e, i) => ({ doc: e.doc, path: e.path, sha256: H(ftTexts[i]!) })), "PeaceG03/PeaceAI-Workspace"), corpus: "finetune" };
  const model = join(d, "model"); mkdirSync(model);
  const cfg = { version: CAND, retrain: { mode: "pretrain", runId: RUN, initFrom: LIVE, finetuneManifestSha256: H(ftMan), replayManifestSha256: H(rpMan), replayCorpus: { manifestSha256: H(rpMan), docsSha256: H(readFileSync(join(rp, "docs.jsonl"))) } } };
  writeFileSync(join(model, "config.json"), JSON.stringify(cfg)); writeFileSync(join(model, "tokenizer.json"), "{}"); writeFileSync(join(model, "weights.npz"), "w");
  const ftProofText = JSON.stringify(ftProof) + "\n"; writeFileSync(join(model, "corefree-proof-finetune.json"), ftProofText);
  const rc = { live: { version: LIVE, corefreeProofSha256: H(liveProofText) }, replay: { manifestSha256: H(liveMan) } };
  writeFileSync(join(d, "rc.json"), JSON.stringify(rc));
  // fake inference: core/public prompts continue with "x"; the empty prompts (no prompt text to explain anything)
  // continue with $SAMPLE
  const fake = join(d, "fake-python");
  writeFileSync(fake, `#!/usr/bin/env python3
import json, os, sys
a = sys.argv; req = json.load(open(a[a.index("--request") + 1]))
t = os.environ.get("M126_SAMPLE", "x")
s = [{"id": p["id"] + ":" + k, "prompt": p["id"], "kind": k, "prompt_tail": "", "text": t if p["id"].startswith("empty-") else "x"} for p in req["prompts"] for k in ("greedy", "sampled")]
json.dump({"model": ${JSON.stringify(CAND)}, "samples": s}, open(a[a.index("--response") + 1], "w"))
`);
  chmodSync(fake, 0o755);
  const base: Record<string, string> = { GITHUB_ACTIONS: "", PEACEAI_PYTHON: fake, PEACEAI_LM_MODEL_DIR: model, PEACEAI_LM_CORPUS: ft, PEACEAI_CORE_DIR: core, PEACEAI_LM_THREADS: "1",
    PEACEAI_MEMCHECK_CORE: "50", PEACEAI_MEMCHECK_PUBLIC: "0", PEACEAI_LM_TRAIN_CORPUS: rp, PEACEAI_LM_FT_CORPUS: ft, PEACEAI_LM_RETRAIN_CFG: join(d, "rc.json"),
    PEACEAI_LM_LIVE_PROOF: join(d, "live-proof.json"), PEACEAI_LM_LIVE_MANIFEST: join(d, "live-manifest.jsonl"), PEACEAI_LM_FT_PROOF_SHA256: H(ftProofText) };
  const run = (over: Record<string, string | undefined> = {}) => {
    const r = spawnSync(tsx, [join(repo, "peaceai/bin/lm-memcheck.ts")], { cwd: repo, encoding: "utf8", env: env0({ ...base, ...over }) });
    const p = join(model, "memcheck.json"); const rep = existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null; rmSync(p, { force: true });
    return { r, rep };
  };
  return { d, model, rp, ft, cfg, liveProof, ftProof, liveProofText, ftProofText, liveMan, rpMan, ftMan, liveLines, texts, ftTexts, ftEnts, run };
}

test("M126 two-corpus memcheck: a valid chain PASSes with core-free-64; the starting-weights link is a note only", () => tmp((d) => {
  const f = fixture(d);
  const { r, rep } = f.run(); assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(rep.status, "PASS"); assert.equal(rep.substringRule, "core-free-64"); assert.equal(rep.coreFreeProofs.ok, true); assert.deepEqual(rep.coreFreeProofs.reasons, []);
  assert.deepEqual(rep.coreFreeProofs.trainedOn, { pretrain: H(f.rpMan), finetune: H(f.ftMan) });
  assert.deepEqual(rep.coreFreeProofs.note, { initFrom: LIVE, liveVersion: LIVE, checked: false });
  assert.equal(rep.scan.countedSamples, 100);
  // a different starting point changes nothing but the note
  writeFileSync(join(f.model, "config.json"), JSON.stringify({ ...f.cfg, retrain: { ...f.cfg.retrain, initFrom: "lm-v1-ffffffffffff" } }));
  const o = f.run(); assert.equal(o.rep.status, "PASS"); assert.equal(o.rep.coreFreeProofs.note.initFrom, "lm-v1-ffffffffffff"); assert.equal(o.rep.coreFreeProofs.note.checked, false);
}));

test("M126 two-corpus memcheck: a 64+ core run is explained only by replay TRAIN docs rebuilt in this run; fine-tune train text (pretrain trains on no fine-tune row), held-out, the live model's older corpus or nowhere = FAIL", () => tmp((d) => {
  const f = fixture(d);
  const ok = f.run({ M126_SAMPLE: RUN_TRAIN }); assert.equal(ok.rep.status, "PASS", ok.r.stdout); assert.equal(ok.rep.scan.unexplainedHits, 0);
  for (const [why, s] of [["fine-tune TRAIN doc only (ftRows == 0 in pretrain mode)", RUN_FT], ["held-out replay doc", RUN_HELD], ["live model's older corpus only (not rebuilt here)", RUN_LIVE], ["nowhere", RUN_NONE]] as const) {
    const o = f.run({ M126_SAMPLE: s }); assert.equal(o.r.status, 1, why); assert.equal(o.rep.status, "FAIL", why);
    assert.equal(o.rep.substringRule, "core-free-64", why); assert.equal(o.rep.coreFreeProofs.ok, true, `${why}: the chain itself is valid`); assert.ok(o.rep.scan.countedHits > 0, why);
  }
  // the strict rule (no proofs: an ordinary model) fails the same train-explained run: the chain is what explains it
  const cfgText = readFileSync(join(f.model, "config.json"), "utf8");
  writeFileSync(join(f.model, "config.json"), JSON.stringify({ version: CAND }));
  const strict = f.run({ M126_SAMPLE: RUN_TRAIN, PEACEAI_LM_TRAIN_CORPUS: undefined, PEACEAI_LM_FT_CORPUS: undefined });
  assert.equal(strict.rep.substringRule, "strict"); assert.equal(strict.rep.status, "FAIL"); assert.equal(strict.rep.coreFreeProofs, undefined);
  writeFileSync(join(f.model, "config.json"), cfgText);
}));

test("M126 two-corpus memcheck: line and personal-info hits stay hard under a valid chain", () => tmp((d) => {
  const f = fixture(d);
  const ln = f.run({ M126_SAMPLE: `${secret[0]}\n${secret[0]}\n` }); // a whole core line, even though a replay train doc holds it
  assert.equal(ln.rep.coreFreeProofs.ok, true); assert.equal(ln.rep.status, "FAIL"); assert.ok(ln.rep.scan.coreLineHits > 0);
  const mail = ["jane.quill", "mailhost-sample.net"].join("@");
  const pi = f.run({ M126_SAMPLE: `reach me at ${mail} today` });
  assert.equal(pi.rep.coreFreeProofs.ok, true); assert.equal(pi.rep.status, "FAIL"); assert.ok(pi.rep.scan.personalInfo > 0);
}));

test("M126 two-corpus memcheck: a missing proof, a mismatched manifest or a wrong-corpus proof each FAIL (never strict)", () => tmp((d) => {
  const f = fixture(d);
  const fail = (why: string, over: Record<string, string | undefined>, reason: RegExp, setup?: () => () => void) => {
    const undo = setup?.(); const { r, rep } = f.run(over); undo?.();
    assert.equal(r.status, 1, why); assert.equal(rep.status, "FAIL", why); assert.equal(rep.scan, null, `${why}: nothing scanned`);
    assert.equal(rep.coreFreeProofs.ok, false, why); assert.match(rep.reason, /^COREFREE_PROOFS:/, why); assert.match(rep.reason, reason, `${why}: ${rep.reason}`);
    assert.equal(rep.scan, null, `${why}: no strict fallback (no scan, so no PASS under any rule)`); assert.equal(typeof rep.coreFreeProofs, "object", why);
  };
  const swap = (p: string, text: string) => () => { const old = readFileSync(p); writeFileSync(p, text); return () => writeFileSync(p, old); };
  const ftp = join(f.model, "corefree-proof-finetune.json");
  // missing proofs
  fail("live proof missing", { PEACEAI_LM_LIVE_PROOF: undefined }, /pretrain:MISSING_PROOF/);
  fail("live proof unreadable", { PEACEAI_LM_LIVE_PROOF: join(d, "nope.json") }, /pretrain:MISSING_PROOF/);
  fail("fine-tune proof missing", {}, /finetune:MISSING_PROOF/, () => { const old = readFileSync(ftp); rmSync(ftp); return () => writeFileSync(ftp, old); });
  // mismatched manifests / pins
  fail("live manifest missing", { PEACEAI_LM_LIVE_MANIFEST: undefined }, /pretrain:MANIFEST_MISMATCH/);
  writeFileSync(join(d, "lm2.jsonl"), f.liveMan + line(ext(9, "x\n", "train")) + "\n");
  fail("live manifest rebuilt differently", { PEACEAI_LM_LIVE_MANIFEST: join(d, "lm2.jsonl") }, /pretrain:MANIFEST_MISMATCH/);
  writeFileSync(join(d, "rc2.json"), JSON.stringify({ live: { version: LIVE, corefreeProofSha256: H(f.liveProofText) }, replay: { manifestSha256: "6".repeat(64) } }));
  fail("live manifest pin differs", { PEACEAI_LM_RETRAIN_CFG: join(d, "rc2.json") }, /pretrain:MANIFEST_MISMATCH/);
  writeFileSync(join(d, "rc3.json"), JSON.stringify({ live: { version: LIVE, corefreeProofSha256: "2".repeat(64) }, replay: { manifestSha256: H(f.liveMan) } }));
  fail("live proof pin differs", { PEACEAI_LM_RETRAIN_CFG: join(d, "rc3.json") }, /pretrain:PROOF_SHA_MISMATCH/);
  fail("retrain cfg missing", { PEACEAI_LM_RETRAIN_CFG: join(d, "none.json") }, /pretrain:PROOF_SHA_MISMATCH/);
  fail("fine-tune proof sha differs from the record's", { PEACEAI_LM_FT_PROOF_SHA256: "3".repeat(64) }, /finetune:PROOF_SHA_MISMATCH/);
  fail("fine-tune proof sha not given", { PEACEAI_LM_FT_PROOF_SHA256: undefined }, /finetune:PROOF_SHA_MISMATCH/);
  fail("replay corpus is not the one trained on", {}, /pretrain:CORPUS_NOT_TRAINED_ON/, swap(join(f.rp, "manifest.jsonl"), f.liveLines.slice(0, 2).join("\n") + "\n"));
  fail("fine-tune corpus is not the one trained on", {}, /finetune:CORPUS_NOT_TRAINED_ON/, swap(join(f.ft, "manifest.jsonl"), f.ftMan + line({ ...f.ftEnts[1], doc: 2 }) + "\n"));
  fail("replay doc text differs from its manifest sha", {}, /pretrain:(DOC_MISMATCH|NOT_PROVEN)/, swap(join(f.rp, "docs.jsonl"), [0, 1, 2].map((i) => line({ doc: i, text: i === 1 ? "changed\n" : f.texts[i] })).join("\n") + "\n"));
  fail("fine-tune doc text differs from its proof", {}, /finetune:FILE_MISMATCH/, swap(join(f.ft, "docs.jsonl"), f.ftTexts.map((t, i) => line({ doc: i, text: i ? "changed\n" : t })).join("\n") + "\n"));
  // wrong-corpus / swapped proofs
  fail("the fine-tune proof given as the live proof", { PEACEAI_LM_LIVE_PROOF: ftp }, /pretrain:SWAPPED_PROOF/);
  fail("the live proof given as the fine-tune proof", { PEACEAI_LM_FT_PROOF_SHA256: H(f.liveProofText) }, /finetune:SWAPPED_PROOF/, swap(ftp, f.liveProofText));
  const ftAsPre = JSON.stringify({ ...f.ftProof, corpus: "pretrain" }) + "\n";
  fail("a fine-tune proof labelled pretrain", { PEACEAI_LM_FT_PROOF_SHA256: H(ftAsPre) }, /finetune:SWAPPED_PROOF/, swap(ftp, ftAsPre));
  const otherLive = JSON.stringify({ ...f.liveProof, model: "lm-v1-0000000000bb" }, null, 2) + "\n"; writeFileSync(join(d, "other.json"), otherLive);
  writeFileSync(join(d, "rc4.json"), JSON.stringify({ live: { version: LIVE, corefreeProofSha256: H(otherLive) }, replay: { manifestSha256: H(f.liveMan) } }));
  fail("a live proof for another model", { PEACEAI_LM_LIVE_PROOF: join(d, "other.json"), PEACEAI_LM_RETRAIN_CFG: join(d, "rc4.json") }, /pretrain:OTHER_MODEL/);
  const badCommit = JSON.stringify({ ...f.ftProof, coreCommit: "zz" }) + "\n";
  fail("a fine-tune proof with a malformed coreCommit", { PEACEAI_LM_FT_PROOF_SHA256: H(badCommit) }, /finetune:NO_CORE_COMMIT/, swap(ftp, badCommit));
  // a corpus missing: FAIL, never the strict 32-character fallback
  fail("no fine-tune corpus", { PEACEAI_LM_FT_CORPUS: undefined }, /FINETUNE_CORPUS_REQUIRED/);
  fail("no corpora at all", { PEACEAI_LM_FT_CORPUS: undefined, PEACEAI_LM_TRAIN_CORPUS: undefined }, /PRETRAIN_CORPUS_REQUIRED/);
  fail("no replay corpus", { PEACEAI_LM_TRAIN_CORPUS: undefined }, /PRETRAIN_CORPUS_REQUIRED/);
  // a replay doc that is not in the proven live manifest (the replay corpus's own sha is what the model trained on)
  const extra = line(ext(7, filler("q", 7), "train"));
  const rpMan2 = f.liveLines.slice(0, 3).join("\n") + "\n" + extra + "\n";
  writeFileSync(join(f.model, "config.json"), JSON.stringify({ ...f.cfg, retrain: { ...f.cfg.retrain, replayManifestSha256: H(rpMan2), replayCorpus: { ...f.cfg.retrain.replayCorpus, manifestSha256: H(rpMan2) } } }));
  fail("a replay doc outside the proven manifest", {}, /pretrain:NOT_IN_PROVEN_MANIFEST/, () => {
    const a = swap(join(f.rp, "manifest.jsonl"), rpMan2)(), b = swap(join(f.rp, "docs.jsonl"), [0, 1, 2].map((i) => line({ doc: i, text: f.texts[i] })).join("\n") + "\n" + line({ doc: 7, text: filler("q", 7) }) + "\n")();
    return () => { a(); b(); };
  });
  writeFileSync(join(f.model, "config.json"), JSON.stringify(f.cfg));
  assert.equal(f.run().rep.status, "PASS", "fixture restored");
}));

test("M126 strict and fine-tune modes are unchanged: no proofs means strict; a finetune-mode candidate stays strict", () => tmp((d) => {
  const f = fixture(d);
  const none = { PEACEAI_LM_TRAIN_CORPUS: undefined, PEACEAI_LM_FT_CORPUS: undefined, PEACEAI_LM_LIVE_PROOF: undefined, PEACEAI_LM_LIVE_MANIFEST: undefined, PEACEAI_LM_FT_PROOF_SHA256: undefined, PEACEAI_LM_RETRAIN_CFG: undefined };
  writeFileSync(join(f.model, "config.json"), JSON.stringify({ version: CAND }));
  const plain = f.run(none); assert.equal(plain.rep.status, "PASS"); assert.equal(plain.rep.substringRule, "strict"); assert.equal(plain.rep.coreFreeProofs, undefined);
  writeFileSync(join(f.model, "config.json"), JSON.stringify({ ...f.cfg, retrain: { ...f.cfg.retrain, mode: "finetune" } }));
  const fm = f.run(none); assert.equal(fm.rep.status, "PASS"); assert.equal(fm.rep.substringRule, "strict"); assert.equal(fm.rep.coreFreeProofs, undefined);
  const fm2 = f.run({ ...none, M126_SAMPLE: RUN_TRAIN }); assert.equal(fm2.rep.status, "FAIL", "strict: any 32+ core run fails"); assert.ok(fm2.rep.scan.coreSubstringHits > 0);
}));

// ---- the decision itself (unit)
test("M126 retrainPretrainChainDecision and retrainPretrainTrainedOn: fail closed on every broken link", () => {
  const hx = (c: string) => c.repeat(64);
  const cfg = { retrain: { mode: "pretrain", initFrom: LIVE, replayManifestSha256: hx("1"), replayCorpus: { manifestSha256: hx("1") }, finetuneManifestSha256: hx("2") } };
  assert.deepEqual(retrainPretrainTrainedOn(cfg), { pretrain: hx("1"), finetune: hx("2") });
  for (const bad of [null, {}, { retrain: { ...cfg.retrain, mode: "finetune" } }, { retrain: { ...cfg.retrain, replayCorpus: { manifestSha256: hx("3") } } }, { retrain: { ...cfg.retrain, finetuneManifestSha256: hx("1") } },
    { retrain: { ...cfg.retrain, replayManifestSha256: "X" + hx("1").slice(1), replayCorpus: { manifestSha256: "X" + hx("1").slice(1) } } }, { retrain: { ...cfg.retrain, finetuneManifestSha256: undefined } }])
    assert.equal(retrainPretrainTrainedOn(bad), null, JSON.stringify(bad));
  const lv = { doc: 0, stage: "pretrain", repo: "colinhacks/zod", commit: "c".repeat(40), license: "MIT", path: "a.ts", sha256: H("t"), origin: "external", split: "train" };
  const lvLine = line(lv), liveSha = H(lvLine + "\n");
  const pp = { schema: SCHEMA, model: LIVE, noCoreFiles: "PROVEN", manifestSha256: liveSha, coreCommit: "a".repeat(40), corpus: null, near: { threshold: 0.8 }, files: [{ doc: 0, path: "a.ts", sha256: H("t"), coreExact: false, coreNearMax: 0 }] };
  const fm = { doc: 0, split: "train", repo: "PeaceG03/PeaceAI-Workspace", sha: "e".repeat(40), path: "b.ts", function: "f" };
  const fp = { schema: SCHEMA, model: RETRAIN_FT_PROOF_MODEL, noCoreFiles: "PROVEN", manifestSha256: hx("2"), near: { threshold: 0.8 }, files: [{ doc: 0, path: "b.ts", sha256: H("u"), coreExact: false, coreNearMax: 0 }], corpus: "finetune" };
  const X = (o: Partial<RetrainChainInput> = {}, pins: Partial<RetrainChainInput["pins"]> = {}): RetrainChainInput => ({
    pretrainProof: pp, pretrainProofSha256: hx("4"), finetuneProof: fp, finetuneProofSha256: hx("5"), liveManifest: { lines: [lvLine], manifestSha256: liveSha },
    replay: { lines: [lvLine], manifest: [lv], manifestSha256: hx("1"), docSha256: new Map([[0, H("t")]]) }, finetune: { manifest: [fm], manifestSha256: hx("2"), docSha256: new Map([[0, H("u")]]) },
    ...o, pins: { liveVersion: LIVE, liveProofSha256: hx("4"), liveManifestSha256: liveSha, finetuneProofSha256: hx("5"), ...pins } });
  const ok = retrainPretrainChainDecision(cfg, X()); assert.equal(ok.ok, true, ok.reasons.join()); assert.deepEqual(ok.note, { initFrom: LIVE, liveVersion: LIVE, checked: false });
  assert.equal(retrainPretrainChainDecision({ retrain: { ...cfg.retrain, initFrom: "lm-v1-bbbbbbbbbbbb" } }, X()).ok, true, "initFrom is a note only");
  const R = (c: unknown, x: RetrainChainInput) => retrainPretrainChainDecision(c, x).reasons;
  assert.deepEqual(R({}, X()), ["NO_TRAINED_ON"]);
  assert.deepEqual(R(cfg, X({ pretrainProof: null })), ["pretrain:MISSING_PROOF"]);
  assert.deepEqual(R(cfg, X({ finetuneProof: undefined })), ["finetune:MISSING_PROOF"]);
  assert.deepEqual(R(cfg, X({ pretrainProof: null, finetuneProof: null })), ["pretrain:MISSING_PROOF", "finetune:MISSING_PROOF"]);
  assert.deepEqual(R(cfg, X({ pretrainProof: { ...pp, corpus: "finetune" } })), ["pretrain:SWAPPED_PROOF"]);
  assert.deepEqual(R(cfg, X({ finetuneProof: { ...fp, corpus: "pretrain" } })), ["finetune:SWAPPED_PROOF"]);
  assert.deepEqual(R(cfg, X({ finetuneProof: { ...fp, corpus: undefined } })), ["finetune:SWAPPED_PROOF"]);
  assert.deepEqual(R(cfg, X({ finetuneProof: pp })), ["finetune:SWAPPED_PROOF"], "the live proof as the fine-tune proof");
  assert.deepEqual(R(cfg, X({ pretrainProofSha256: hx("6") })), ["pretrain:PROOF_SHA_MISMATCH"]);
  assert.deepEqual(R(cfg, X({}, { liveProofSha256: "" })), ["pretrain:PROOF_SHA_MISMATCH"]);
  assert.deepEqual(R(cfg, X({ finetuneProofSha256: hx("6") })), ["finetune:PROOF_SHA_MISMATCH"]);
  assert.deepEqual(R(cfg, X({}, { finetuneProofSha256: "" })), ["finetune:PROOF_SHA_MISMATCH"]);
  assert.deepEqual(R(cfg, X({ liveManifest: null })), ["pretrain:MANIFEST_MISMATCH"]);
  assert.deepEqual(R(cfg, X({ liveManifest: { lines: [lvLine], manifestSha256: hx("7") } })), ["pretrain:MANIFEST_MISMATCH"]);
  assert.deepEqual(R(cfg, X({}, { liveManifestSha256: "" })), ["pretrain:MANIFEST_MISMATCH"]);
  assert.deepEqual(R(cfg, X({ replay: { ...X().replay, manifestSha256: hx("8") } })), ["pretrain:CORPUS_NOT_TRAINED_ON"]);
  assert.deepEqual(R(cfg, X({ finetune: { ...X().finetune, manifestSha256: hx("8") } })), ["finetune:CORPUS_NOT_TRAINED_ON"]);
  assert.deepEqual(R(cfg, X({ pretrainProof: { ...pp, model: "lm-v1-cccccccccccc" } })), ["pretrain:OTHER_MODEL"]);
  assert.deepEqual(R(cfg, X({ pretrainProof: { ...pp, manifestSha256: hx("9") } })), ["pretrain:MANIFEST_MISMATCH"]);
  assert.deepEqual(R(cfg, X({ pretrainProof: { ...pp, coreCommit: undefined } })), ["pretrain:NO_CORE_COMMIT"], "the live proof must carry coreCommit");
  assert.deepEqual(R(cfg, X({ pretrainProof: { ...pp, files: [{ ...pp.files[0]!, coreExact: true }] } })), ["pretrain:CORE_EXACT"]);
  assert.deepEqual(R(cfg, X({ replay: { ...X().replay, lines: [lvLine.replace('"a.ts"', '"z.ts"')] } })), ["pretrain:NOT_IN_PROVEN_MANIFEST"]);
  assert.deepEqual(R(cfg, X({ replay: { ...X().replay, lines: [] } })), ["pretrain:NOT_IN_PROVEN_MANIFEST"]);
  assert.deepEqual(R(cfg, X({ replay: { ...X().replay, docSha256: new Map([[0, H("other")]]) } })), ["pretrain:DOC_MISMATCH"]);
  assert.deepEqual(R(cfg, X({ finetuneProof: { ...fp, model: LIVE } })), ["finetune:OTHER_MODEL"]);
  assert.deepEqual(R(cfg, X({ finetuneProof: { ...fp, coreCommit: "zz" } })), ["finetune:NO_CORE_COMMIT"]);
  assert.equal(R(cfg, X({ finetuneProof: { ...fp, coreCommit: "b".repeat(40) } })).length, 0);
  assert.deepEqual(R(cfg, X({ finetune: { ...X().finetune, docSha256: new Map([[0, H("v")]]) } })), ["finetune:FILE_MISMATCH"]);
  // the general proof check still requires coreCommit (only the retrain fine-tune proof may omit it)
  assert.deepEqual(validCoreFreeProof(fp, { modelId: RETRAIN_FT_PROOF_MODEL, manifest: [fm], manifestSha256: hx("2"), docSha256: new Map([[0, H("u")]]) }), { ok: false, reason: "NO_CORE_COMMIT" });
  assert.deepEqual(LM_JOBS.filter((j) => j.includes("memcheck")), ["memcheck", "retrain-memcheck"], "no new LM job");
});

// ---- replay_corpus.py plan --manifest-out: the live manifest rebuilt in this run, byte for byte
test("M126 replay_corpus.py plan --manifest-out writes the checked live manifest (sha = replay.manifestSha256)", () => tmp((d) => {
  const n = 40;
  const ents = Array.from({ length: n }, (_, i) => { const text = filler("r", i); return { e: { doc: i, stage: "pretrain", repo: "colinhacks/zod", commit: "c".repeat(40), license: "MIT", path: `src/f${i}.ts`, sha256: H(text), bytes: Buffer.byteLength(text), origin: "ext" }, text }; });
  const src = [line({ schema: "peaceai-ext-manifest:v1", config: "c", entries: n }), ...ents.map((x) => line(x.e))].join("\n") + "\n";
  const split = (r: string, p: string) => (createHash("sha256").update(`${r}\n${p}`).digest()[0]! < Math.round(256 * 5 / 100) ? "heldout" : "train");
  const live = ents.map((x) => line({ ...x.e, split: split(x.e.repo, x.e.path) })).join("\n") + "\n";
  const trainBytes = ents.filter((x) => split(x.e.repo, x.e.path) === "train").reduce((a, x) => a + x.e.bytes, 0);
  writeFileSync(join(d, "s.jsonl"), src);
  const rc = { manifestSha256: H(live), source: { repo: "PeaceG03/PeaceAI-Workspace", commit: "d".repeat(40), path: "peaceai/model/ext-manifest.jsonl", sha256: H(src) }, salt: "peaceai-replay:v1", trainMaxBytes: 3000, pretrainTrainMaxBytes: trainBytes, valDocs: 1, valMinBytes: 1 };
  const plan = (over: object, out: string) => {
    writeFileSync(join(d, "c.json"), JSON.stringify({ replay: { ...rc, ...over } }));
    return spawnSync(py, ["peaceai/model/replay_corpus.py", "plan", "--mode", "pretrain", "--source", join(d, "s.jsonl"), "--config", join(d, "c.json"), "--plan", join(d, "p.jsonl"), "--stats", join(d, "st.json"), "--manifest-out", out], { cwd: repo, encoding: "utf8" });
  };
  const r = plan({}, join(d, "live.jsonl")); assert.equal(r.status, 0, r.stderr);
  assert.equal(readFileSync(join(d, "live.jsonl"), "utf8"), live); assert.equal(H(readFileSync(join(d, "live.jsonl"))), rc.manifestSha256);
  const bad = plan({ manifestSha256: "0".repeat(64) }, join(d, "bad.jsonl")); assert.notEqual(bad.status, 0); assert.equal(existsSync(join(d, "bad.jsonl")), false, "no manifest written when the sha check fails");
  assert.match(read("peaceai/bin/lm-retrain-replay.sh"), /--manifest-out "\$work\/replay-live-manifest\.jsonl"/);
}));

// ---- lm-retrain-memcheck-fetch.sh
function results(d: string, o: { mcFirst?: boolean | object; mode?: string } = {}) {
  const res = join(d, "res"), w = "weights-of-858573", ws = H(w), V = `lm-v1-${ws.slice(0, 12)}`;
  const m = join(res, "models/lm", V); mkdirSync(m, { recursive: true });
  const cfg = JSON.stringify({ version: V, retrain: { mode: o.mode ?? "pretrain", runId: RUN } }), tok = "{\"t\":1}", fp = "{\"corpus\":\"finetune\"}\n";
  writeFileSync(join(m, "config.json"), cfg); writeFileSync(join(m, "tokenizer.json"), tok); writeFileSync(join(m, "weights.npz"), w); writeFileSync(join(m, "corefree-proof-finetune.json"), fp);
  const lv = join(res, "models/lm", LIVE); mkdirSync(lv, { recursive: true }); const lp = "{\"model\":\"live\"}\n"; writeFileSync(join(lv, "corefree-proof.json"), lp);
  const r = join(res, "runs/lm-retrain", RUN); mkdirSync(r, { recursive: true });
  writeFileSync(join(r, "record.json"), JSON.stringify({ runId: Number(RUN), candidate: V, candidateWeightsSha256: ws, finetuneCorefreeProofSha256: H(fp), memcheck: "pending" }));
  if (o.mcFirst !== false) writeFileSync(join(r, "memcheck.json"), JSON.stringify(typeof o.mcFirst === "object" ? o.mcFirst : { status: "FAIL", model: V, files: { "config.json": H(cfg), "tokenizer.json": H(tok), "weights.npz": ws } }));
  writeFileSync(join(d, "rc.json"), JSON.stringify({ live: { version: LIVE, corefreeProofSha256: H(lp) } }));
  return { res, V, ws, m, r, fp, lp, cfg, tok };
}
const fetch = (d: string, res: string, run: string, V = "", e: Record<string, string> = {}) => {
  const out = join(d, "out"); rmSync(out, { recursive: true, force: true }); mkdirSync(out);
  const r = spawnSync("bash", ["peaceai/bin/lm-retrain-memcheck-fetch.sh", res, out, run, V], { cwd: repo, encoding: "utf8", env: env0({ PEACEAI_LM_RETRAIN_CFG: join(d, "rc.json"), ...e }) });
  return { st: r.status, out: r.stdout + r.stderr, dir: out };
};

test("M126 memcheck fetch: re-verifies the landed candidate (weights, config, tokenizer, proofs) and refuses any mismatch", () => tmp((d) => {
  // memcheck-only: the first memcheck record binds config/tokenizer/weights
  let x = results(d);
  const ok = fetch(d, x.res, RUN, "", { MCO: RUN }); assert.equal(ok.st, 0, ok.out);
  assert.equal(readFileSync(join(ok.dir, "version"), "utf8"), `${x.V}\n`); assert.equal(readFileSync(join(ok.dir, "ft-proof-sha256"), "utf8"), `${H(x.fp)}\n`);
  assert.equal(readFileSync(join(ok.dir, "live-proof.json"), "utf8"), x.lp); assert.equal(H(readFileSync(join(ok.dir, "model/weights.npz"))), x.ws);
  assert.equal(existsSync(join(ok.dir, "model/memcheck.json")), false);
  assert.match(ok.out, new RegExp(`memcheck fetch: run=${RUN} candidate=${x.V} weights=${x.ws} finetuneProof=${H(x.fp)} memcheckOnly=true`));
  const refuse = (why: string, r: ReturnType<typeof fetch>, msg: RegExp) => { assert.equal(r.st, 1, `${why}: ${r.out}`); assert.match(r.out, msg, why); };
  refuse("normal path but the run already has a memcheck record", fetch(d, x.res, RUN, x.V), /already has a memcheck record/);
  refuse("MCO is another run", fetch(d, x.res, RUN, "", { MCO: "40694718191" }), /not the run checked/);
  refuse("bad run id", fetch(d, x.res, "1$(id)", "", { MCO: "1$(id)" }), /bad run id/);
  refuse("record names another candidate", fetch(d, x.res, RUN, "lm-v1-aaaaaaaaaaaa", { MCO: RUN }), /another candidate/);
  const tweak = (p: string, s: string, why: string, msg: RegExp) => { const old = readFileSync(p); writeFileSync(p, s); refuse(why, fetch(d, x.res, RUN, "", { MCO: RUN }), msg); writeFileSync(p, old); };
  tweak(join(x.m, "weights.npz"), "other", "weights changed", /weights do not hash to the version/);
  tweak(join(x.m, "tokenizer.json"), "{\"t\":2}", "tokenizer changed since the first memcheck", /config, tokenizer or weights differ/);
  tweak(join(x.m, "config.json"), JSON.stringify({ version: x.V, retrain: { mode: "pretrain", runId: RUN }, extra: 1 }), "config changed since the first memcheck", /config, tokenizer or weights differ/);
  tweak(join(x.m, "config.json"), JSON.stringify({ version: x.V, retrain: { mode: "pretrain", runId: "40694718191" } }), "model from another run", /not from this run/);
  tweak(join(x.m, "corefree-proof-finetune.json"), "{}\n", "fine-tune proof changed", /fine-tune proof differs/);
  tweak(join(x.res, "models/lm", LIVE, "corefree-proof.json"), "{}\n", "live proof differs from its pin", /live core-free proof differs from its pin/);
  const rec = JSON.parse(readFileSync(join(x.r, "record.json"), "utf8"));
  tweak(join(x.r, "record.json"), JSON.stringify({ ...rec, candidateWeightsSha256: "0".repeat(64) }), "record weights sha differs", /candidateWeightsSha256/);
  tweak(join(x.r, "record.json"), JSON.stringify({ ...rec, runId: 1 }), "record of another run", /not this run's/);
  tweak(join(x.r, "memcheck.json"), JSON.stringify({ status: "FAIL", model: "lm-v1-bbbbbbbbbbbb", files: {} }), "first memcheck of another model", /differ/);
  rmSync(join(x.r, "memcheck.json")); refuse("memcheck-only without a first memcheck record", fetch(d, x.res, RUN, "", { MCO: RUN }), /no first memcheck record/);
  // the normal path (this run's own candidate, no memcheck yet)
  const n = fetch(d, x.res, RUN, x.V); assert.equal(n.st, 0, n.out); assert.match(n.out, /memcheckOnly=\n/);
  symlinkSync(join(x.m, "weights.npz"), join(x.m, "extra.npz")); refuse("symlink in the model dir", fetch(d, x.res, RUN, x.V), /symlink in model dir/); rmSync(join(x.m, "extra.npz"));
  symlinkSync(join(x.r, "record.json"), join(x.r, "link.json")); refuse("symlink in the run dir", fetch(d, x.res, RUN, x.V), /symlink in run dir/); rmSync(join(x.r, "link.json"));
  rmSync(join(x.m, "corefree-proof-finetune.json")); refuse("no fine-tune proof", fetch(d, x.res, RUN, x.V), /lacks corefree-proof-finetune\.json/);
  rmSync(join(d, "res"), { recursive: true });
  // a finetune-mode candidate needs no live proof
  x = results(d, { mode: "finetune", mcFirst: false }); rmSync(join(x.res, "models/lm", LIVE), { recursive: true });
  const f = fetch(d, x.res, RUN, x.V); assert.equal(f.st, 0, f.out); assert.equal(existsSync(join(f.dir, "live-proof.json")), false);
  rmSync(join(d, "res"), { recursive: true });
  x = results(d, { mcFirst: false }); rmSync(join(x.res, "models/lm", LIVE), { recursive: true });
  refuse("pretrain candidate without the live proof", fetch(d, x.res, RUN, x.V), /no live core-free proof/);
  refuse("no run record", fetch(d, x.res, "40694718192", ""), /no run record/);
}));

// ---- workflow wiring: the memcheck-only path appends one recheck record and promotes nothing
const block = (t: string, start: string, end: RegExp) => { const i = t.indexOf(start); assert.ok(i >= 0, start); const r = t.slice(i + start.length); const j = r.search(end); return j < 0 ? r : r.slice(0, j); };
const dedent = (s: string, n: number) => s.split("\n").map((l) => l.slice(Math.min(n, l.length - l.trimStart().length))).join("\n");
const stepRun = (jobText: string, name: string) => dedent(block(block(jobText, `      - name: ${name}`, /\n      - name: |\n\n  [a-z]/), "        run: |\n", /$^/), 10);

test("M126 workflow: memcheck_only_run_id input, its checks, job conditions and the append-only recheck landing", () => tmp((d) => {
  assert.match(WF, /\n      memcheck_only_run_id:\n        description: "[^"\n]+"\n        type: string\n        default: ""\n/);
  assert.match(WF, /\n  MCO: \$\{\{ inputs\.memcheck_only_run_id \|\| '' \}\}\n/);
  const chk = stepRun(job("corpus-gate"), "Check the resume input");
  const run = (e: Record<string, string>) => spawnSync("bash", ["-c", chk], { cwd: repo, encoding: "utf8", env: env0({ GITHUB_RUN_ID: "40700000002", DRY_RUN: "false", RESUME: "", MCO: "", ...e }) }).status;
  assert.deepEqual([run({}), run({ MCO: RUN }), run({ MCO: RUN, DRY_RUN: "true" }), run({ MCO: RUN, RESUME: "40700000001" }), run({ MCO: "40700000002" }), run({ MCO: "1$(id)" }), run({ MCO: "123" })], [0, 0, 1, 1, 1, 1, 1]);
  for (const j of ["sweep-a", "sweep-b", "finetune-eval-land"]) assert.match(job(j), /\n    if: [^\n]*inputs\.memcheck_only_run_id == ''[^\n]*\n/, `${j} is skipped in memcheck-only mode`);
  // the fetch step re-verifies through the fetch script; this run's own candidate otherwise
  const mc = job("retrain-memcheck");
  assert.match(mc, /MCO="\$MCO" \.\/peaceai\/bin\/lm-retrain-memcheck-fetch\.sh "\$res" "\$RUNNER_TEMP" "\$run" "\$V"\n/);
  assert.match(mc, /run="\$\{MCO:-\$GITHUB_RUN_ID\}"/);
  assert.match(mc, /secrets\.PEACEAI_RESULTS_READ_KEY/); assert.doesNotMatch(mc, /PEACEAI_RESULTS_DEPLOY_KEY/, "the memcheck job only reads Results");
  // record-memcheck: the recheck block, then the landing
  const rec = job("record-memcheck");
  const dec = stepRun(rec, "Decode the count-level memcheck record");
  mkdirSync(join(d, "rt")); writeFileSync(join(d, "go"), "");
  const mcB64 = (o: object) => execFileSync("bash", ["-c", "gzip -9c | base64 -w0"], { input: JSON.stringify(o), encoding: "utf8" });
  const decode = (e: Record<string, string>) => spawnSync("bash", ["-c", dec], { cwd: repo, encoding: "utf8", env: env0({ RUNNER_TEMP: join(d, "rt"), GITHUB_OUTPUT: join(d, "go"), GITHUB_RUN_ID: "40700000002", GITHUB_SHA: "f".repeat(40), V: "lm-v1-858573767465", MCO: RUN, ...e }) });
  const dr = decode({ MC: mcB64({ status: "PASS", substringRule: "core-free-64" }) }); assert.equal(dr.status, 0, dr.stderr);
  assert.deepEqual(JSON.parse(readFileSync(join(d, "rt/mc/recheck.json"), "utf8")).recheck, { sourceRunId: RUN, recheckRunId: "40700000002", workspaceSha: "f".repeat(40), candidate: "lm-v1-858573767465", promotes: false });
  assert.match(readFileSync(join(d, "go"), "utf8"), /^status=PASS\n$/m);
  assert.notEqual(decode({ MC: mcB64({ status: "MAYBE" }) }).status, 0);
  rmSync(join(d, "rt/mc"), { recursive: true }); assert.equal(decode({ MCO: "", MC: mcB64({ status: "FAIL" }) }).status, 0); assert.equal(existsSync(join(d, "rt/mc/recheck.json")), false, "no recheck block on a normal run");
  // the memcheck-only landing script, run against a fixture Results checkout
  const land = stepRun(rec, "Land memcheck.json next to the run record and the candidate (latest.json untouched; memcheck-only - append memcheck-recheck-<this run>.json under that run only)");
  const inner = block(land, "bash -c '", /'\n/);
  assert.ok(inner.startsWith("set -euo pipefail") && inner.includes("memcheck-recheck-$GITHUB_RUN_ID.json"), inner);
  assert.doesNotMatch(inner, /latest\.json|record\.json"? *$|models\/lm/m); assert.doesNotMatch(inner, /cp [^\n]*(record|memcheck)\.json"/);
  assert.match(inner, /--diff-filter=MDRT\)" \|\| \{ echo "landing refused: not append-only"; exit 1; \}/);
  const resd = join(d, "results"); mkdirSync(join(resd, "runs/lm-retrain", RUN), { recursive: true }); mkdirSync(join(resd, "models/lm"), { recursive: true });
  const g = (...a: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...a], { cwd: resd, encoding: "utf8" });
  writeFileSync(join(resd, "runs/lm-retrain", RUN, "record.json"), "{\"outcome\":\"failed\"}\n"); writeFileSync(join(resd, "runs/lm-retrain", RUN, "memcheck.json"), "{\"status\":\"FAIL\"}\n");
  writeFileSync(join(resd, "models/lm/latest.json"), "{\"version\":\"lm-v1-088073d41dbc\"}\n");
  g("init", "-q"); g("add", "-A"); g("commit", "-qm", "base");
  mkdirSync(join(d, "mc2")); writeFileSync(join(d, "mc2/recheck.json"), "{\"status\":\"PASS\",\"recheck\":{}}\n");
  const L = (e: Record<string, string> = {}) => spawnSync("bash", ["-c", inner], { encoding: "utf8", env: env0({ RESULTS_DIR: resd, MCO: RUN, GITHUB_RUN_ID: "40700000002", MC_DIR: join(d, "mc2"), ...e }) });
  const l1 = L(); assert.equal(l1.status, 0, l1.stdout + l1.stderr);
  assert.deepEqual(g("diff", "--cached", "--name-status").trim().split("\n"), [`A\truns/lm-retrain/${RUN}/memcheck-recheck-40700000002.json`], "exactly one new file");
  assert.equal(readFileSync(join(resd, "runs/lm-retrain", RUN, "record.json"), "utf8"), "{\"outcome\":\"failed\"}\n", "record.json untouched");
  assert.equal(readFileSync(join(resd, "runs/lm-retrain", RUN, "memcheck.json"), "utf8"), "{\"status\":\"FAIL\"}\n", "the first memcheck record untouched");
  g("commit", "-qm", "recheck");
  assert.notEqual(L().status, 0, "the same recheck twice: refused (append-only)");
  assert.notEqual(L({ MCO: "40694718199" }).status, 0, "a run without a record: refused");
  writeFileSync(join(resd, "models/lm/latest.json"), "{\"version\":\"x\"}\n");
  const l2 = L({ GITHUB_RUN_ID: "40700000003" }); assert.notEqual(l2.status, 0, "any other change staged (here latest.json): refused"); assert.match(l2.stdout, /landing refused/);
  // the shell wrapper: dry-run guard + deploy key + results-write, and the landed output only after it
  assert.match(land, /if \[ -n "\$MCO" \]; then\n\s+\[\[ "\$MCO" =~ \^\[1-9\]\[0-9\]\{5,19\}\$ \]\] \|\| \{ echo "bad memcheck_only_run_id"; exit 1; \}\n\s+\.\/peaceai\/bin\/lm-retrain-dryrun-guard\.sh \.\/peaceai\/bin\/with-deploy-key\.sh \.\/peaceai\/bin\/results-write\.sh --sparse "\/runs\/lm-retrain\/\$MCO\/record\.json" --sparse "\/runs\/lm-retrain\/\$MCO\/memcheck-recheck-\$GITHUB_RUN_ID\.json" "LM retrain memcheck recheck of run \$MCO/);
  assert.match(land, /echo "landed=true" >> "\$GITHUB_OUTPUT"; rm -rf "\$RUNNER_TEMP\/mc"; exit 0\n\s*fi\n/);
  assert.match(rec, /\n      landed: \$\{\{ steps\.land\.outputs\.landed \}\}\n      status: \$\{\{ steps\.decode\.outputs\.status \}\}\n/);
  for (const l of WF.split("\n").filter((x) => x.includes("latest.json"))) assert.doesNotMatch(l, /cp |> |mv |tee /, "latest.json is never written");
}));

// ---- outcome: "memcheck FAIL (record landed)"
const outcome = (e: Record<string, string>) => spawnSync("bash", ["peaceai/bin/lm-retrain-outcome.sh"], { cwd: repo, encoding: "utf8", env: env0({ CFG: "peaceai/model/lm-retrain.json", MODE: "pretrain", DRY_RUN: "false", SEL: "success", MC: "success", REC: "success", ...e }) });
test("M126 outcome: a landed FAIL record prints 'memcheck FAIL (record landed)' (still RED); memcheck-only green/red", () => {
  const red = (e: Record<string, string>, why: RegExp) => { const r = outcome(e); assert.equal(r.status, 1, r.stdout); assert.match(r.stdout, why); assert.match(r.stdout, /: RED\n$/); return r.stdout; };
  const g = outcome({ REC_LANDED: "true", MC_STATUS: "PASS" }); assert.equal(g.status, 0); assert.match(g.stdout, /real run: select, memcheck and record all succeeded\n$/);
  const o = red({ REC: "failure", REC_LANDED: "true", MC_STATUS: "FAIL" }, /^real run: memcheck FAIL \(record landed\): RED$/m);
  assert.match(o, /^outcome dry_run=false select=success memcheck=success record=failure\noutcome recorded_status=FAIL record_landed=true memcheck_only_run=\n/);
  for (const e of [{ REC: "failure" }, { REC: "failure", REC_LANDED: "true" }, { REC: "failure", MC_STATUS: "FAIL" }, { REC: "failure", REC_LANDED: "true", MC_STATUS: "PASS" }, { REC: "skipped", REC_LANDED: "true", MC_STATUS: "FAIL" },
    { MC: "failure", REC: "failure", REC_LANDED: "true", MC_STATUS: "FAIL" }, { SEL: "failure", REC: "failure", REC_LANDED: "true", MC_STATUS: "FAIL" }] as Record<string, string>[])
    red(e, /^real run: select, memcheck and record did not all run and succeed: RED$/m);
  // memcheck-only
  const m = outcome({ MCO: RUN, SEL: "skipped" }); assert.equal(m.status, 0, m.stdout); assert.match(m.stdout, new RegExp(`memcheck-only \\(run ${RUN}\\): memcheck PASS, recheck record landed \\(nothing promoted\\)\\n$`));
  red({ MCO: RUN, SEL: "skipped", REC: "failure", REC_LANDED: "true", MC_STATUS: "FAIL" }, new RegExp(`^memcheck-only \\(run ${RUN}\\): memcheck FAIL \\(record landed\\): RED$`, "m"));
  red({ MCO: RUN, SEL: "skipped", REC: "failure" }, /memcheck and record did not both run and succeed: RED/);
  red({ MCO: RUN, SEL: "skipped", MC: "failure", REC: "skipped" }, /memcheck and record did not both run and succeed: RED/);
  red({ MCO: RUN, SEL: "success" }, /select was not skipped: RED/);
  red({ MCO: "1$(id)", SEL: "skipped" }, /memcheck-only: bad run id: RED/);
  const plain = outcome({}); assert.equal(plain.stdout.split("\n").filter(Boolean).length, 2, "no extra line when nothing is set");
});
