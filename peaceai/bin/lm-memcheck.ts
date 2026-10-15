// M9 memorization check. Samples the model (greedy and sampled continuations of core, public and empty
// prompts), scans every output with the core-text scanner (public corpus as baseline) and the personal-info
// scanner, and writes memcheck.json bound to the model files' sha256. Fail closed: any hit, too few samples,
// an inference error or files that changed during the check -> FAIL (exit 1). Prints counts only; no
// sample text is written anywhere. Runs where the core checkout is (the box), never on public runners.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { indexGitTree } from "../lib/coreindex.ts";
import { addText, emptyIndex } from "../lib/coretext.ts";
import { buildSubstringIndex } from "../lib/substr.ts";
import { COREFREE_MIN_RUN, docIdsMatch, dualCoreFreeDecision, isAsciiBlank, manifestProvesNoCore, MEMCHECK_SCHEMA, memcheckStatus, modelFileShas, runInfer, scanSamples, validCoreFreeProof, type PublicOnlyExemption, type Sample, type SampleScan } from "../lib/lm.ts";
import type { ManifestEntry } from "../lib/lmcorpus.ts";
import { readManifestBytes } from "../lib/manifestparts.ts";

const modelDir = resolve(process.env.PEACEAI_LM_MODEL_DIR ?? "");
const corpus = resolve(process.env.PEACEAI_LM_CORPUS ?? "");
const coreDir = resolve(process.env.PEACEAI_CORE_DIR ?? "");
const counts = { core: Number(process.env.PEACEAI_MEMCHECK_CORE ?? 96), public: Number(process.env.PEACEAI_MEMCHECK_PUBLIC ?? 32), empty: 8 };
const CORE_SOURCE = "PeaceG03/PeaceAI";

const before = modelFileShas(modelDir);
const manifest: ManifestEntry[] = readManifestBytes(corpus, "manifest").toString("utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const texts = new Map<number, string>();
for (const l of readFileSync(join(corpus, "docs.jsonl"), "utf8").split("\n")) if (l) { const d = JSON.parse(l); texts.set(d.doc, d.text); }
const h = (s: string) => createHash("sha256").update(s).digest("hex");
const pick = (list: ManifestEntry[], n: number) => [...list].sort((a, b) => (h(`m9:${a.path}`) < h(`m9:${b.path}`) ? -1 : 1)).slice(0, n);
const promptOf = (m: ManifestEntry) => {
  const t = texts.get(m.doc) ?? "";
  const lines = t.split("\n");
  const start = parseInt(h(`off:${m.path}`).slice(0, 8), 16) % Math.max(1, lines.length - 8);
  return lines.slice(start).join("\n").slice(0, 400);
};
const prompts = [
  ...pick(manifest.filter((m) => m.source === CORE_SOURCE), counts.core).map((m, i) => ({ id: `core-${i}`, text: promptOf(m) })),
  ...pick(manifest.filter((m) => m.source !== CORE_SOURCE), counts.public).map((m, i) => ({ id: `public-${i}`, text: promptOf(m) })),
  ...Array.from({ length: counts.empty }, (_, i) => ({ id: `empty-${i}`, text: "" })),
];

const trainCorpus = process.env.PEACEAI_LM_TRAIN_CORPUS ? resolve(process.env.PEACEAI_LM_TRAIN_CORPUS) : "";
// M52 (Architect (a)): a two-corpus model (config.json trainedOn) is checked once, as the final fine-tuned model,
// against BOTH corpora: PEACEAI_LM_TRAIN_CORPUS (pretrain) and PEACEAI_LM_FT_CORPUS (fine-tune), with both
// per-corpus proofs required. Anything missing or mismatched: FAIL (blocks promotion), never the strict fallback.
const ftCorpus = process.env.PEACEAI_LM_FT_CORPUS ? resolve(process.env.PEACEAI_LM_FT_CORPUS) : "";
let dual: { ok: boolean; reasons: string[]; trainedOn: unknown } | null = null;
let trainManifestSha = "";
let noCoreProof = trainCorpus ? "PROVEN" : "NOT_GIVEN";
let proofState = trainCorpus ? "INVALID:MISSING" : "NOT_GIVEN";
let proofSha = "";
let scan: SampleScan | null = null;
let reason = "";
const r = before ? runInfer("sample", modelDir, { prompts, seed: 9, prompt_tokens: 64, new_tokens: 128, temperature: 0.8 }, ["--unverified", "--threads", process.env.PEACEAI_LM_THREADS ?? "8"]) : { ok: false as const, reason: "MODEL_MISSING" };
if (!r.ok) reason = r.reason;
else {
  const tree = indexGitTree(coreDir, () => true, true);
  const core = tree.text;
  const coreRaw = buildSubstringIndex(tree.raw ?? []);
  const baseline = emptyIndex();
  for (const m of manifest) if (m.source !== CORE_SOURCE) addText(baseline, texts.get(m.doc) ?? "");
  // M9 (Auditor/Architect): the core-free-64 rule needs BOTH a valid core-free proof attached to the model's record
  // (<model>/corefree-proof.json, written at training time) for this exact training manifest AND the manifest still
  // proving zero core files against the current core tree. Anything else (no training corpus given, no proof, an
  // invalid proof, a manifest that no longer proves it): the strict 32-character rule.
  let exempt: PublicOnlyExemption | null = null;
  const cfgNow = JSON.parse(readFileSync(join(modelDir, "config.json"), "utf8"));
  if ("trainedOn" in cfgNow || ftCorpus) {
    const coreShas = new Set((tree.raw ?? []).filter((t) => !isAsciiBlank(t)).map((t) => h(t)));
    const load = (dir: string) => {
      const mText = readManifestBytes(dir, "manifest").toString("utf8"); // M51: one file or split parts, never both
      const man: (ManifestEntry & Record<string, unknown>)[] = mText.split("\n").filter(Boolean).map((l) => JSON.parse(l));
      const docSha256 = new Map<unknown, string>(), ids: unknown[] = [], txt: string[] = [];
      for (const l of readFileSync(join(dir, "docs.jsonl"), "utf8").split("\n")) if (l) { const d = JSON.parse(l); docSha256.set(d.doc, h(String(d.text))); ids.push(d.doc); txt.push(String(d.text)); }
      const proves = docIdsMatch(man.map((m) => m.doc), ids) && manifestProvesNoCore(man, coreShas, CORE_SOURCE, docSha256) && (tree.raw ?? []).length > 0;
      return { manifest: man, manifestSha256: h(mText), docSha256, txt, proves };
    };
    const readProof = (st: string) => { try { return JSON.parse(readFileSync(join(modelDir, `corefree-proof-${st}.json`), "utf8")); } catch { return null; } };
    if (!trainCorpus || !ftCorpus) dual = { ok: false, reasons: [trainCorpus ? "FINETUNE_CORPUS_REQUIRED" : "PRETRAIN_CORPUS_REQUIRED"], trainedOn: null };
    else {
      const pre = load(trainCorpus), ft = load(ftCorpus);
      const d = dualCoreFreeDecision(cfgNow, { pretrain: readProof("pretrain"), finetune: readProof("finetune") }, { pretrain: pre, finetune: ft });
      if (!pre.proves) d.reasons.push("pretrain:NOT_PROVEN"); if (!ft.proves) d.reasons.push("finetune:NOT_PROVEN");
      dual = { ok: d.reasons.length === 0, reasons: d.reasons, trainedOn: d.trainedOn };
      trainManifestSha = pre.manifestSha256; noCoreProof = dual.ok ? "PROVEN" : "NOT_PROVEN"; proofState = dual.ok ? "VALID" : `INVALID:${d.reasons.join(",")}`;
      if (dual.ok) exempt = { prompts: new Map(prompts.map((p) => [p.id, p.text])), trainingCorpus: buildSubstringIndex([...pre.txt, ...ft.txt]), minRun: COREFREE_MIN_RUN };
    }
    if (!dual.ok) reason = `COREFREE_PROOFS:${dual.reasons.join(",")}`;
  } else if (trainCorpus) {
    const tmText = readManifestBytes(trainCorpus, "manifest").toString("utf8"); // M51: one file or split parts, never both
    const tm: (ManifestEntry & Record<string, unknown>)[] = tmText.split("\n").filter(Boolean).map((l) => JSON.parse(l));
    // M39: empty / whitespace-only core files carry no text; they never make a training file "core" (allowlisted
    // public-origin files are already out of tree.raw, matched by path and exact-bytes pin in coreindex.ts).
    const coreShas = new Set((tree.raw ?? []).filter((t) => !isAsciiBlank(t)).map((t) => h(t)));
    trainManifestSha = h(tmText);
    let proof: unknown = null;
    try { proof = JSON.parse(readFileSync(join(modelDir, "corefree-proof.json"), "utf8")); } catch { proof = null; }
    const modelId = String(JSON.parse(readFileSync(join(modelDir, "config.json"), "utf8")).version ?? "");
    // M52: doc text hashes (the fine-tune manifest carries none; its proof is checked against these).
    const docSha256 = new Map<unknown, string>();
    for (const l of readFileSync(join(trainCorpus, "docs.jsonl"), "utf8").split("\n")) if (l) { const d = JSON.parse(l); docSha256.set(d.doc, h(String(d.text))); }
    const v = validCoreFreeProof(proof, { modelId, manifest: tm, manifestSha256: trainManifestSha, docSha256 });
    proofState = v.ok ? "VALID" : `INVALID:${v.reason}`;
    if (proof !== null && v.ok) proofSha = h(readFileSync(join(modelDir, "corefree-proof.json"), "utf8"));
    // M40: docs.jsonl ids must equal the manifest ids, else the manifest proves nothing (strict rule).
    const docIds: unknown[] = [];
    for (const l of readFileSync(join(trainCorpus, "docs.jsonl"), "utf8").split("\n")) if (l) docIds.push(JSON.parse(l).doc);
    if (!docIdsMatch(tm.map((m) => m.doc), docIds)) noCoreProof = "NOT_PROVEN";
    if (!manifestProvesNoCore(tm, coreShas, CORE_SOURCE, docSha256) || (tree.raw ?? []).length === 0) noCoreProof = "NOT_PROVEN";
    if (v.ok && noCoreProof === "PROVEN") {
      const tt: string[] = [];
      for (const l of readFileSync(join(trainCorpus, "docs.jsonl"), "utf8").split("\n")) if (l) tt.push(JSON.parse(l).text);
      exempt = { prompts: new Map(prompts.map((p) => [p.id, p.text])), trainingCorpus: buildSubstringIndex(tt), minRun: COREFREE_MIN_RUN };
    }
  }
  scan = dual && !dual.ok ? null : scanSamples(r.response.samples as Sample[], core, baseline, (tree.raw ?? []).length ? coreRaw : null, exempt);
}
const after = modelFileShas(modelDir);
if (JSON.stringify(before) !== JSON.stringify(after)) { scan = null; reason = "FILES_CHANGED"; }
const status = memcheckStatus(scan);
const report = {
  schema: MEMCHECK_SCHEMA,
  status,
  ...(reason ? { reason } : {}),
  files: before,
  model: r.ok ? r.response.model : null,
  prompts: counts,
  substringRule: scan?.substringRule ?? "strict",
  trainingManifest: trainCorpus ? { sha256: trainManifestSha, noCoreFiles: noCoreProof } : null,
  coreFreeProof: { state: proofState, ...(proofSha ? { sha256: proofSha } : {}) },
  ...(dual ? { coreFreeProofs: dual } : {}),
  settings: { promptTokens: 64, newTokens: 128, decoding: ["greedy", "sampled t=0.8 top-k 40 seed 9"], minSamples: 100 },
  scanners: ["core-text (hashed long lines and 4-line shingles; public corpus as baseline)", "core-substring (any 32+ character run of generated text found in core; no baseline)", "personal-info (leak.ts)"],
  scan,
};
writeFileSync(join(modelDir, "memcheck.json"), JSON.stringify(report, null, 2) + "\n");
console.log(`memcheck status=${status} samples=${scan?.samples ?? 0} core_line_hits=${scan?.coreLineHits ?? "-"} core_shingle_hits=${scan?.coreShingleHits ?? "-"} core_substring_hits=${scan?.coreSubstringHits ?? "-"} personal_info=${scan?.personalInfo ?? "-"} rule=${scan?.substringRule ?? "strict"}${scan?.substringRule === "core-free-64" ? ` unexplained_hits=${scan.unexplainedHits} longest_unexplained=${scan.longestUnexplained} counted_hits_64=${scan.countedHits}` : ""} proof=${proofState}${reason ? ` reason=${reason}` : ""}`);
process.exit(status === "PASS" ? 0 : 1);
