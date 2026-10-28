// M9: the from-scratch language model, seen from the TypeScript pipeline. Fail-closed loading (a model is
// usable only with a PASS memorization check bound to its exact file hashes), the memorization scan, diff
// scoring for the shadow ranker, flags (both off by default) and the promotion rule.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { findCoreText, SHINGLE_LINE, type TextIndex } from "./coretext.ts";
import { scanText } from "./leak.ts";
import { coreSubstringWindows, countCoreSubstrings, indexHas, runsOf, type SubstringIndex } from "./substr.ts";
import { effectiveVerdict, type LmShadow, type RankingRecord } from "./records.ts";
import type { StoredTask } from "./store.ts";

export const MEMCHECK_SCHEMA = "peaceai-lm-memcheck:v1";
export const LM_FILES = ["config.json", "tokenizer.json", "weights.npz"] as const;
export const MIN_MEMCHECK_SAMPLES = 100;
export const LM_PROMOTION_RULE = { minHeldOutTasks: 10, mustBeatBaseline: true } as const;
export const MODEL_DIR = resolve(import.meta.dirname, "../model");

/** Both flags are off unless the repository variable is exactly "true". */
export function lmFlags(env: Record<string, string | undefined>): { shadow: boolean; fill: boolean } {
  return { shadow: env.PEACEAI_LM_SHADOW === "true", fill: env.PEACEAI_LM_FILL === "true" };
}

const sha256File = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");

export function modelFileShas(dir: string): Record<string, string> | null {
  if (!LM_FILES.every((f) => existsSync(join(dir, f)))) return null;
  return Object.fromEntries(LM_FILES.map((f) => [f, sha256File(join(dir, f))]));
}

export type LoadRefusal = "MODEL_MISSING" | "MEMCHECK_MISSING" | "MEMCHECK_FAILED" | "MEMCHECK_STALE" | "CONFIG_INVALID";

/** A model directory is usable only when memcheck.json is a PASS for exactly these files. */
export function verifyModelDir(dir: string): { ok: true; version: string } | { ok: false; reason: LoadRefusal } {
  const shas = modelFileShas(dir);
  if (!shas) return { ok: false, reason: "MODEL_MISSING" };
  let mc: { schema?: string; status?: string; files?: Record<string, string> };
  try { mc = JSON.parse(readFileSync(join(dir, "memcheck.json"), "utf8")); } catch { return { ok: false, reason: "MEMCHECK_MISSING" }; }
  if (mc.schema !== MEMCHECK_SCHEMA || mc.status !== "PASS") return { ok: false, reason: "MEMCHECK_FAILED" };
  if (JSON.stringify(mc.files) !== JSON.stringify(shas)) return { ok: false, reason: "MEMCHECK_STALE" };
  try {
    const cfg = JSON.parse(readFileSync(join(dir, "config.json"), "utf8"));
    if (cfg.schema !== "peaceai-lm:v1" || !/^lm-v1-[0-9a-f]{12}$/.test(cfg.version)) return { ok: false, reason: "CONFIG_INVALID" };
    // M52 (Architect (a)): a two-corpus model loads only when its memcheck recorded both core-free proofs valid for
    // exactly the manifests the model says it trained on.
    if ("trainedOn" in cfg) {
      const t = trainedOnShas(cfg);
      const d = (mc as { coreFreeProofs?: { ok?: boolean; trainedOn?: unknown } }).coreFreeProofs;
      if (!t || d?.ok !== true || JSON.stringify(d.trainedOn) !== JSON.stringify(t)) return { ok: false, reason: "MEMCHECK_FAILED" };
    }
    return { ok: true, version: cfg.version };
  } catch { return { ok: false, reason: "CONFIG_INVALID" }; }
}

// ---- memorization check

/** id is unique per sample: `<prompt id>:<decoding>` (infer.py); prompt is the prompt id both decodings share. */
export interface Sample { id: string; prompt?: string; kind: string; prompt_tail: string; text: string }
/** The prompt a sample continues: its `prompt` field, else the id before any `:<decoding>` suffix. */
export const promptIdOf = (s: Sample): string => s.prompt ?? s.id.split(":")[0]!;
/** Sample ids that occur more than once (a duplicate (id, decoding) pair fails the memcheck closed). */
export function duplicateSampleIds(samples: readonly Sample[]): string[] {
  const seen = new Set<string>(), dup = new Set<string>();
  for (const s of samples) { const k = String(s.id); if (seen.has(k)) dup.add(k); seen.add(k); }
  return [...dup];
}
export interface SampleScan {
  samples: number;
  /** Samples the loop actually scanned; must equal samples (Auditor: scanned == returned, else FAIL). */
  scannedSamples?: number;
  /** Samples that count toward MIN_MEMCHECK_SAMPLES: those from a non-empty prompt (ids not `empty-*`). Empty-prompt
   *  outputs are scanned but never count toward the minimum (Auditor, run 38905982366). */
  countedSamples?: number;
  coreLineHits: number; coreShingleHits: number; coreSubstringHits: number; personalInfo: number; flagged: number;
  /** "strict": any 32-character core hit fails (absent means strict). "core-free-64": only for a model whose
   *  Results record carries a valid core-free proof (see validCoreFreeProof); a hit is explained when its window
   *  is in that sample's prompt or in the public training corpus, and an unexplained run counts only when it is
   *  COREFREE_MIN_RUN (64) characters or longer. unexplainedHits = every unexplained run (reported);
   *  countedHits = the unexplained runs of 64+ characters (must be 0). */
  substringRule?: "strict" | "core-free-64";
  unexplainedHits?: number;
  countedHits?: number;
  longestUnexplained?: number;
  /** Every unexplained run, as a location only (no text): sample id, start offset in the generated text, length. */
  unexplainedRuns?: { sample: string; start: number; length: number }[];
}
export const COREFREE_MIN_RUN = 64;
/** Granted only by lm-memcheck when the model's record carries a valid core-free proof. */
export interface PublicOnlyExemption { prompts: ReadonlyMap<string, string>; trainingCorpus: SubstringIndex; minRun: number }

/** Scans model output for core text (the core-text scanner, public corpus as the baseline) and personal info. */
export function scanSamples(samples: readonly Sample[], core: TextIndex, baseline: TextIndex, coreRaw: SubstringIndex | null, exempt: PublicOnlyExemption | null = null): SampleScan {
  const scan: SampleScan = { samples: samples.length, countedSamples: samples.filter((s) => !promptIdOf(s).startsWith("empty-")).length, scannedSamples: 0, coreLineHits: 0, coreShingleHits: 0, coreSubstringHits: 0, personalInfo: 0, flagged: 0 };
  if (exempt) { scan.substringRule = "core-free-64"; scan.unexplainedHits = 0; scan.countedHits = 0; scan.longestUnexplained = 0; scan.unexplainedRuns = []; }
  for (const s of samples) {
    scan.scannedSamples! += 1;
    // The prompt's last partial line is joined to the output, so a core line the model completes is caught too.
    // When the model added fewer than SHINGLE_LINE non-space characters to that line, the line is the prompt's
    // own text (an echo, not model output) and is left out; every generated line after it is still scanned.
    const lines = (s.prompt_tail + s.text).split("\n");
    const added = s.text.split("\n")[0].replace(/\s/g, "").length;
    const hits = findCoreText(s.prompt_tail && added < SHINGLE_LINE ? lines.slice(1) : lines, core, baseline);
    // Exact copy: any run of >= 32 characters of the raw generated text (everything after the prompt, the first
    // line's new part included) that occurs in core. No baseline exemption. Without the core index: fail closed.
    const sub = coreRaw ? countCoreSubstrings(s.text, coreRaw) : 1;
    let counted = sub;
    if (exempt) {
      // Public-only model: a window found in this sample's prompt or in the public training corpus is explained.
      // A sample with no recorded prompt explains nothing. Without the core index: fail closed (1 unexplained).
      const prompt = exempt.prompts.get(promptIdOf(s));
      const unexplained = coreRaw
        ? coreSubstringWindows(s.text, coreRaw).filter((st) => {
            const w = s.text.slice(st, st + coreRaw.n);
            return !(prompt !== undefined && prompt.includes(w)) && !indexHas(exempt.trainingCorpus, w);
          })
        : null;
      // Maximal runs of consecutive unexplained windows; a run of k windows covers k + n - 1 characters.
      const lengths: number[] = [], starts: number[] = [];
      let prev = -2;
      for (const st of unexplained ?? []) {
        if (st === prev + 1) lengths[lengths.length - 1]! += 1; else { lengths.push(coreRaw!.n); starts.push(st); }
        prev = st;
      }
      // Auditor (memcheck trace, lm-v1-78b6e96990d2; #142 F2): a joined 64+ run counts only when SOME contiguous
      // substring of it of 64+ characters occurs in core (the longest in-core segment). Overlapping short windows
      // (a 128-char 'c' run over a core run of 40) do not count; a copy bridging two core places still does.
      // Two pointers: if [i, j) is in core so is [i + 1, j), so j never moves back. Reported lengths are unchanged.
      const has = (t: string): boolean => coreRaw!.texts.some((c) => c.includes(t));
      const longestInCore = (t: string): number => {
        let best = 0, j = 0;
        for (let i = 0; i < t.length && t.length - i > best; i += 1) {
          if (j < i) j = i;
          while (j < t.length && has(t.slice(i, j + 1))) j += 1;
          best = Math.max(best, j - i);
        }
        return best;
      };
      const inCore = (i: number): boolean => longestInCore(s.text.slice(starts[i]!, starts[i]! + lengths[i]!)) >= exempt.minRun;
      const long = unexplained ? lengths.filter((l, i) => l >= exempt.minRun && inCore(i)).length : 1;
      scan.unexplainedHits! += unexplained ? lengths.length : 1;
      if (unexplained) lengths.forEach((l, i) => scan.unexplainedRuns!.push({ sample: s.id, start: starts[i]!, length: l }));
      else scan.unexplainedRuns!.push({ sample: s.id, start: -1, length: 0 });
      scan.countedHits! += long;
      scan.longestUnexplained = Math.max(scan.longestUnexplained!, ...lengths, 0);
      counted = long;
    }
    const pii = scanText(s.text).length;
    scan.coreSubstringHits += sub;
    scan.coreLineHits += hits.lineHits;
    scan.coreShingleHits += hits.shingleHits;
    scan.personalInfo += pii;
    if (hits.lineHits + hits.shingleHits + counted + pii > 0) scan.flagged += 1;
  }
  return scan;
}

export function memcheckStatus(scan: SampleScan | null): "PASS" | "FAIL" {
  // Fail closed: the minimum counts non-empty-prompt samples only (and never more than were scanned).
  if (!scan || Math.min(scan.samples, scan.countedSamples ?? 0) < MIN_MEMCHECK_SAMPLES) return "FAIL";
  if (scan.scannedSamples !== scan.samples) return "FAIL"; // every returned sample must have been scanned
  const substring = scan.substringRule === "core-free-64" ? scan.countedHits ?? 1 : scan.coreSubstringHits;
  return scan.coreLineHits === 0 && scan.coreShingleHits === 0 && substring === 0 && scan.personalInfo === 0 ? "PASS" : "FAIL";
}

/**
 * The exemption's precondition: the model's training manifest proves zero core files. Every entry must be public,
 * from a source other than core, and its content hash must match no core file. An empty or unreadable manifest
 * proves nothing.
 */
export function manifestProvesNoCore(manifest: readonly Record<string, unknown>[], coreFileShas: ReadonlySet<string>, coreSource = "PeaceG03/PeaceAI", docSha256?: ReadonlyMap<unknown, string>): boolean {
  if (manifest.length === 0) return false;
  const shaOk = (m: Record<string, unknown>) => typeof m.sha256 === "string" && /^[0-9a-f]{64}$/.test(m.sha256) && !coreFileShas.has(m.sha256);
  // M52 (Architect, M49 M5): the fine-tune schema (ft-pairs.ts). All entries one schema, exact keys; its content
  // sha256 comes only from the doc text (docSha256), never from the manifest. No doc hashes given: fails closed.
  const ft = manifest.map((m) => m !== null && typeof m === "object" && ("function" in m || "sha" in m)); // keys only the fine-tune schema has
  if (ft.some(Boolean)) return ft.every(Boolean) && !!docSha256 && manifest.every((m) => ftManifestEntryProblem(m) === null && shaOk({ sha256: docSha256.get(m.doc) }));
  // M39 (Architect): the external manifest schema (ext-fetch.ts: repo + license + sha256). All entries one schema;
  // any unknown field or malformed entry fails closed. The internal schema keeps its visibility check unchanged.
  if (manifest.every((m) => m !== null && typeof m === "object" && "repo" in m)) return manifest.every((m) => extManifestEntryProblem(m, coreSource) === null && shaOk(m));
  return manifest.every((m) => m !== null && typeof m === "object" && !("repo" in m) && m.visibility === "public" && typeof m.source === "string" && m.source !== coreSource && shaOk(m));
}

/** M39: keys an external training manifest entry may carry (ext-fetch.ts output); anything else is refused. */
export const EXT_PROOF_KEYS = new Set(["doc", "stage", "repo", "commit", "license", "path", "sha256", "bytes", "origin", "split"]);
const EXT_PROOF_REQUIRED = ["doc", "repo", "commit", "license", "path", "sha256", "origin"];
const EXT_PROOF_PERMISSIVE = new Set(["MIT", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "ISC"]);
/** M40 (Auditor #160): the training docs.jsonl and manifest doc ids are the same set, with no duplicates on either side. */
export function docIdsMatch(manifestIds: readonly unknown[], docIds: readonly unknown[]): boolean {
  const a = new Set(manifestIds), b = new Set(docIds);
  return a.size === manifestIds.length && b.size === docIds.length && a.size === b.size && [...a].every((x) => b.has(x)) && manifestIds.every((x) => typeof x === "number" && Number.isInteger(x));
}
/** M40: ASCII whitespace only, the same set as corefree_proof.py (never NBSP, U+2000-200A, U+3000, \x1c-\x1f, U+FEFF). */
export const isAsciiBlank = (t: string) => t.replace(/[ \t\r\n\f\v]+/g, "") === "";
/** Peace's own repos allowed in an external manifest: only the public owner repos, only with the owner license. */
export const EXT_PROOF_OWNER_PUBLIC = new Set(["PeaceG03/PeaceSTOCKS", "PeaceG03/PeaceAI-Workspace"]);
/** Same rules as corefree_proof.py's ext_problem(): null when the entry is acceptable. */
export function extManifestEntryProblem(m: Record<string, unknown>, coreSource = "PeaceG03/PeaceAI"): string | null {
  for (const k of Object.keys(m)) if (!EXT_PROOF_KEYS.has(k)) return `unknown field ${k}`;
  for (const k of EXT_PROOF_REQUIRED) if (!(k in m)) return `missing field ${k}`;
  if (typeof m.doc !== "number" || !Number.isInteger(m.doc) || m.doc < 0 || typeof m.path !== "string" || !m.path) return "bad doc/path";
  if ("bytes" in m && (typeof m.bytes !== "number" || !Number.isInteger(m.bytes) || m.bytes < 0)) return "bad bytes";
  if (typeof m.license !== "string") return "bad license";
  if (typeof m.commit !== "string" || !/^[0-9a-f]{40}$/.test(m.commit)) return "bad commit";
  const repo = m.repo;
  if (typeof repo !== "string" || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo) || repo.split("/").some((x) => /^[.-]/.test(x)) || repo === coreSource) return "bad repo";
  if (m.origin === "external") return repo.toLowerCase().startsWith("peaceg03/") || !EXT_PROOF_PERMISSIVE.has(m.license) ? "external entry: Peace repo or non-permissive license" : null;
  if (m.origin === "owner-public") return EXT_PROOF_OWNER_PUBLIC.has(repo) && m.license === "owner:PeaceG03" ? null : "owner entry: not a public owner repo";
  return "bad origin";
}

/** M52: keys of an M49 fine-tune manifest entry (ft-pairs.ts); all required, anything else refused. */
export const FT_PROOF_KEYS = ["doc", "split", "repo", "sha", "path", "function"] as const;
/** Same rules as corefree_proof.py's ft_problem(): null when the entry is acceptable. */
/** M119 (LM retrain list mode): optional "line" (integer >= 1): the doc is exactly that line of <sha>:<path> (a builder-log row). */
export const FT_PROOF_OPTIONAL_KEYS = ["line"] as const;
export function ftManifestEntryProblem(m: Record<string, unknown>): string | null {
  if (m === null || typeof m !== "object" || Array.isArray(m)) return "not an object";
  const keys = new Set<string>([...FT_PROOF_KEYS, ...FT_PROOF_OPTIONAL_KEYS]);
  const unknown = Object.keys(m).filter((k) => !keys.has(k)).sort();
  if (unknown.length) return `unknown field ${unknown[0]}`;
  const missing = FT_PROOF_KEYS.filter((k) => !Object.hasOwn(m, k)).sort();
  if (missing.length) return `missing field ${missing[0]}`;
  if (typeof m.doc !== "number" || !Number.isInteger(m.doc) || m.doc < 0 || typeof m.path !== "string" || !m.path) return "bad doc/path";
  if (typeof m.function !== "string" || !m.function) return "bad function";
  if (m.split !== "train" && m.split !== "heldout") return "bad split";
  if (typeof m.sha !== "string" || !/^[0-9a-f]{40}$/.test(m.sha)) return "bad sha";
  if (typeof m.repo !== "string" || !EXT_PROOF_OWNER_PUBLIC.has(m.repo)) return "fine-tune entry: not a public owner repo";
  if (Object.hasOwn(m, "line") && (typeof m.line !== "number" || !Number.isInteger(m.line) || m.line < 1)) return "bad line";
  return null;
}

/**
 * The core-free proof attached to a model's Results record (written at training time by
 * peaceai/model/corefree_proof.py): the training manifest's hash, and for EVERY manifest file its content sha256,
 * whether it matches a core file exactly (must be false) and its highest MinHash similarity to any core file (must
 * be below the near-duplicate threshold, which may not be looser than 0.8). Anything missing, extra, mismatched or
 * malformed is invalid, and the model stays on the strict rule.
 */
export const COREFREE_PROOF_SCHEMA = "peaceai-lm-corefree-proof:v1";
export interface CoreFreeProofFile { doc: number; path: string; source: string; sha256: string; coreExact: boolean; coreNearMax: number }
export interface CoreFreeProof { schema: string; model: string; noCoreFiles: string; manifestSha256: string; coreCommit: string; near: { method: string; threshold: number }; files: CoreFreeProofFile[] }
export function validCoreFreeProof(proof: unknown, ctx: { modelId: string; manifest: readonly { doc: number; path: string; sha256?: string }[]; manifestSha256: string; docSha256?: ReadonlyMap<unknown, string> }, opts: { coreCommitOptional?: boolean } = {}): { ok: boolean; reason?: string } {
  const p = proof as CoreFreeProof | null;
  if (!p || typeof p !== "object") return { ok: false, reason: "MISSING" };
  if (p.schema !== COREFREE_PROOF_SCHEMA) return { ok: false, reason: "BAD_SCHEMA" };
  if (p.model !== ctx.modelId) return { ok: false, reason: "OTHER_MODEL" };
  if (p.noCoreFiles !== "PROVEN") return { ok: false, reason: "NOT_PROVEN" };
  if (p.manifestSha256 !== ctx.manifestSha256) return { ok: false, reason: "MANIFEST_MISMATCH" };
  // Run 40694718190: only the retrain fine-tune proof may omit coreCommit (corpus-gate strips it: jq 'del(.coreCommit)');
  // a coreCommit that is present must still be well formed.
  if (!(opts.coreCommitOptional && !Object.hasOwn(p, "coreCommit")) && !/^[0-9a-f]{40}$/.test(p.coreCommit ?? "")) return { ok: false, reason: "NO_CORE_COMMIT" };
  const t = p.near?.threshold;
  if (typeof t !== "number" || !(t > 0 && t <= 0.8)) return { ok: false, reason: "BAD_NEAR_THRESHOLD" };
  if (!Array.isArray(p.files) || p.files.length !== ctx.manifest.length || ctx.manifest.length === 0) return { ok: false, reason: "FILE_COUNT" };
  const byDoc = new Map(p.files.map((f) => [f?.doc, f]));
  for (const m of ctx.manifest) {
    const f = byDoc.get(m.doc);
    // M52: a fine-tune entry carries no sha256; its expected hash is the doc text's (docSha256), never the proof's own.
    const want = "function" in m || "sha" in m ? ctx.docSha256?.get(m.doc) : m.sha256;
    if (!f || f.path !== m.path || typeof want !== "string" || f.sha256 !== want) return { ok: false, reason: "FILE_MISMATCH" };
    if (f.coreExact !== false) return { ok: false, reason: "CORE_EXACT" };
    if (typeof f.coreNearMax !== "number" || !(f.coreNearMax >= 0 && f.coreNearMax < t)) return { ok: false, reason: "CORE_NEAR" };
  }
  return { ok: true };
}

/** M52 (Architect (a)): a model trained on two corpora (pretrain + fine-tune) records both manifest sha256 values in
 *  config.json as trainedOn: { pretrainManifestSha256, finetuneManifestSha256 }. null when absent or malformed. */
export const COREFREE_STAGES = ["pretrain", "finetune"] as const;
export type CoreFreeStage = (typeof COREFREE_STAGES)[number];
export function trainedOnShas(cfg: unknown): Record<CoreFreeStage, string> | null {
  const t = (cfg as { trainedOn?: Record<string, unknown> } | null)?.trainedOn;
  if (!t || typeof t !== "object" || Array.isArray(t)) return null;
  if (Object.keys(t).sort().join(",") !== "finetuneManifestSha256,pretrainManifestSha256") return null;
  const p = t.pretrainManifestSha256, f = t.finetuneManifestSha256;
  if (typeof p !== "string" || typeof f !== "string" || !/^[0-9a-f]{64}$/.test(p) || !/^[0-9a-f]{64}$/.test(f) || p === f) return null;
  return { pretrain: p, finetune: f };
}
export interface CorpusForProof { manifest: readonly { doc: number; path: string; sha256?: string }[]; manifestSha256: string; docSha256: ReadonlyMap<unknown, string> }
/** M52: both per-corpus proofs (corefree-proof-<stage>.json) are required. Each must name its own corpus, be for
 *  the manifest sha the model trained on (config.json trainedOn), match the corpus given here, and be valid. Any
 *  missing proof, sha mismatch or swapped proof blocks promotion (fail closed). */
export function dualCoreFreeDecision(cfg: unknown, proofs: Record<CoreFreeStage, unknown>, corpora: Record<CoreFreeStage, CorpusForProof>): { ok: boolean; reasons: string[]; trainedOn: Record<CoreFreeStage, string> | null } {
  const t = trainedOnShas(cfg);
  if (!t) return { ok: false, reasons: ["NO_TRAINED_ON"], trainedOn: null };
  const modelId = String((cfg as { version?: unknown }).version ?? "");
  const reasons: string[] = [];
  for (const st of COREFREE_STAGES) {
    const p = proofs[st] as { corpus?: unknown } | null | undefined, c = corpora[st];
    if (p === null || p === undefined || typeof p !== "object") { reasons.push(`${st}:MISSING_PROOF`); continue; }
    if (p.corpus !== st) { reasons.push(`${st}:SWAPPED_PROOF`); continue; }
    if (!c || c.manifestSha256 !== t[st]) { reasons.push(`${st}:CORPUS_NOT_TRAINED_ON`); continue; }
    const v = validCoreFreeProof(p, { modelId, manifest: c.manifest, manifestSha256: t[st], docSha256: c.docSha256 });
    if (!v.ok) reasons.push(`${st}:${v.reason}`);
  }
  return { ok: reasons.length === 0, reasons, trainedOn: t };
}

/** Run 40694718190 (Auditor ruling): an LM retrain candidate trained in mode "pretrain" (continued pretraining of the
 *  live model on the replay corpus only: lm-retrain-train.sh refuses ftRows != 0, so no fine-tune row is trained on;
 *  the fine-tune corpus is still built, proven and bound, and stays a hard chain check, but explains no memcheck hit)
 *  uses the two-corpus mode above, with no new rule. Its
 *  landed config.json carries no trainedOn block (its sha256 is bound by the record), so each stage's trainedOn sha is
 *  read from config.json retrain: pretrain = retrain.replayManifestSha256 (must equal retrain.replayCorpus.manifestSha256),
 *  finetune = retrain.finetuneManifestSha256. null when absent, malformed or not a pretrain retrain. */
export function retrainPretrainTrainedOn(cfg: unknown): Record<CoreFreeStage, string> | null {
  const r = (cfg as { retrain?: Record<string, unknown> } | null)?.retrain;
  if (!r || typeof r !== "object" || Array.isArray(r) || r.mode !== "pretrain") return null;
  const p = r.replayManifestSha256, pc = (r.replayCorpus as { manifestSha256?: unknown } | undefined)?.manifestSha256, f = r.finetuneManifestSha256;
  const hex = (x: unknown): x is string => typeof x === "string" && /^[0-9a-f]{64}$/.test(x);
  if (!hex(p) || !hex(f) || p !== pc || p === f) return null;
  return { pretrain: p, finetune: f };
}
/** corpus-gate's stub model id: the retrain fine-tune proof is written before any model exists (peace-lm-retrain.yml). */
export const RETRAIN_FT_PROOF_MODEL = "lm-retrain-corpus";
export interface RetrainChainPins { liveVersion: string; liveProofSha256: string; liveManifestSha256: string; finetuneProofSha256: string }
export interface RetrainChainInput {
  /** The live model's proof (Results models/lm/<live>/corefree-proof.json) and the sha256 of its bytes. */
  pretrainProof: unknown; pretrainProofSha256: string;
  /** The candidate's corefree-proof-finetune.json (from corpus-gate) and the sha256 of its bytes. */
  finetuneProof: unknown; finetuneProofSha256: string;
  /** The live training manifest, rebuilt in this run by replay_corpus.py plan (--manifest-out); null when missing. */
  liveManifest: { lines: readonly string[]; manifestSha256: string } | null;
  /** The replay corpus and the fine-tune corpus rebuilt in this run (manifest lines byte-for-byte). */
  replay: CorpusForProof & { lines: readonly string[] }; finetune: CorpusForProof;
  /** lm-retrain.json live.version / live.corefreeProofSha256 / replay.manifestSha256 and the run record's finetuneCorefreeProofSha256. */
  pins: RetrainChainPins;
}
/** The proof chain for a pretrain-mode retrain candidate. Every link is checked against the corpora rebuilt in this run:
 *  pretrain: the live model's proof (sha pinned) is valid for the full live manifest rebuilt here (sha pinned, 6fc30d39),
 *    every replay manifest line is a line of it, every replay doc hashes to its entry, and the replay manifest is the
 *    one the candidate trained on;
 *  finetune: the corpus-gate proof (sha from the run record, corpus "finetune", stub model id) is valid for the
 *    fine-tune manifest rebuilt here, which is the one the candidate trained on.
 *  Anything missing or mismatched fails (the caller FAILs; never the strict fallback). The candidate's starting weights
 *  (retrain.initFrom) vs the live model is a note only, never a check. */
export function retrainPretrainChainDecision(cfg: unknown, x: RetrainChainInput): { ok: boolean; reasons: string[]; trainedOn: Record<CoreFreeStage, string> | null; note: { initFrom: unknown; liveVersion: string; checked: false } } {
  const note = { initFrom: (cfg as { retrain?: { initFrom?: unknown } } | null)?.retrain?.initFrom ?? null, liveVersion: x.pins.liveVersion, checked: false as const };
  const t = retrainPretrainTrainedOn(cfg);
  if (!t) return { ok: false, reasons: ["NO_TRAINED_ON"], trainedOn: null, note };
  const reasons: string[] = [];
  const hex = (s: unknown) => typeof s === "string" && /^[0-9a-f]{64}$/.test(s);
  // pretrain (replay corpus)
  const pp = x.pretrainProof as { corpus?: unknown } | null | undefined;
  if (pp === null || pp === undefined || typeof pp !== "object") reasons.push("pretrain:MISSING_PROOF");
  else if (pp.corpus !== undefined && pp.corpus !== null && pp.corpus !== "pretrain") reasons.push("pretrain:SWAPPED_PROOF");
  else if (!hex(x.pins.liveProofSha256) || x.pretrainProofSha256 !== x.pins.liveProofSha256) reasons.push("pretrain:PROOF_SHA_MISMATCH");
  else if (!x.liveManifest || !hex(x.pins.liveManifestSha256) || x.liveManifest.manifestSha256 !== x.pins.liveManifestSha256) reasons.push("pretrain:MANIFEST_MISMATCH");
  else if (x.replay.manifestSha256 !== t.pretrain) reasons.push("pretrain:CORPUS_NOT_TRAINED_ON");
  else {
    let live: { doc: number; path: string; sha256?: string }[] | null;
    try { live = x.liveManifest.lines.map((l) => JSON.parse(l)); } catch { live = null; }
    const v = live ? validCoreFreeProof(pp, { modelId: x.pins.liveVersion, manifest: live, manifestSha256: x.liveManifest.manifestSha256 }) : { ok: false, reason: "BAD_MANIFEST" };
    const proven = new Set(x.liveManifest.lines);
    if (!v.ok) reasons.push(`pretrain:${v.reason}`);
    else if (x.replay.lines.length === 0 || !x.replay.lines.every((l) => proven.has(l))) reasons.push("pretrain:NOT_IN_PROVEN_MANIFEST");
    else if (!x.replay.manifest.every((m) => typeof m.sha256 === "string" && x.replay.docSha256.get(m.doc) === m.sha256)) reasons.push("pretrain:DOC_MISMATCH");
  }
  // finetune
  const fp = x.finetuneProof as { corpus?: unknown } | null | undefined;
  if (fp === null || fp === undefined || typeof fp !== "object") reasons.push("finetune:MISSING_PROOF");
  else if (fp.corpus !== "finetune") reasons.push("finetune:SWAPPED_PROOF");
  else if (!hex(x.pins.finetuneProofSha256) || x.finetuneProofSha256 !== x.pins.finetuneProofSha256) reasons.push("finetune:PROOF_SHA_MISMATCH");
  else if (x.finetune.manifestSha256 !== t.finetune) reasons.push("finetune:CORPUS_NOT_TRAINED_ON");
  else {
    const v = validCoreFreeProof(fp, { modelId: RETRAIN_FT_PROOF_MODEL, manifest: x.finetune.manifest, manifestSha256: t.finetune, docSha256: x.finetune.docSha256 }, { coreCommitOptional: true });
    if (!v.ok) reasons.push(`finetune:${v.reason}`);
  }
  return { ok: reasons.length === 0, reasons, trainedOn: t, note };
}

// ---- where the model may run

/** Jobs that may load a model: the fill job, Job A, Job C, ci.yml's unit tests (tiny fixture model only), and
 *  m49-posttrain-memcheck.yml's single `memcheck` job (main-only, peaceai-core, no candidate code; it must sample the
 *  model, else lm-memcheck refuses before any proof is read), and m49-provenance-check.yml's single `provenance` job
 *  (same environment and guards, read-only, dispatch-only, no upload), and m49-source-hunt.yml's `source-hunt` job (same).
 *  Never Job B/B2 (ids `test`, `regate`), where candidate code runs. */
export const LM_JOBS = ["lm-fill", "generate", "record", "tests", "memcheck", "provenance", "source-hunt", "retrain-memcheck"] as const;
/** Each LM job id is pinned to the one workflow file that defines it: GITHUB_JOB alone is a plain job id that any
 *  workflow (or a new one) can reuse, so the job must also run from its own workflow in this repository. */
export const LM_JOB_WORKFLOWS: Readonly<Record<(typeof LM_JOBS)[number], string>> = {
  "lm-fill": ".github/workflows/peace-task.yml",
  generate: ".github/workflows/peace-task.yml",
  record: ".github/workflows/peace-task.yml",
  tests: ".github/workflows/ci.yml",
  memcheck: ".github/workflows/m49-posttrain-memcheck.yml",
  provenance: ".github/workflows/m49-provenance-check.yml",
  "source-hunt": ".github/workflows/m49-source-hunt.yml",
  "retrain-memcheck": ".github/workflows/peace-lm-retrain.yml", // M119: the retrain candidate's verbatim memcheck (strict rule)
};
export const LM_REPO = "PeaceG03/PeaceAI-Workspace";
/** On Actions the job id AND its workflow path decide (GITHUB_WORKFLOW_REF = "<repo>/<path>@<ref>", repository
 *  pinned); a job marked as running candidate code is always refused. Off Actions (the box) is allowed. */
export function lmJobAllowed(env: Record<string, string | undefined>): boolean {
  if (env.PEACEAI_CANDIDATE_JOB === "true") return false;
  if (env.GITHUB_ACTIONS === "true") {
    const job = env.GITHUB_JOB ?? "";
    if (!Object.hasOwn(LM_JOB_WORKFLOWS, job)) return false;
    const path = LM_JOB_WORKFLOWS[job as keyof typeof LM_JOB_WORKFLOWS];
    const ref = env.GITHUB_WORKFLOW_REF ?? "";
    const at = ref.indexOf("@");
    if (at < 0 || env.GITHUB_REPOSITORY !== LM_REPO) return false;
    return ref.slice(0, at) === `${LM_REPO}/${path}`;
  }
  return true;
}

// ---- python bridge

export function runInfer(mode: "score" | "fill" | "sample", modelDir: string, request: unknown, extra: string[] = []): { ok: true; response: any } | { ok: false; reason: string } {
  if (!lmJobAllowed(process.env)) return { ok: false, reason: "LM_JOB_REFUSED" };
  const tmp = mkdtempSync(join(tmpdir(), "peaceai-lm-"));
  try {
    writeFileSync(join(tmp, "req.json"), JSON.stringify(request));
    const r = spawnSync(process.env.PEACEAI_PYTHON ?? "python3", [join(MODEL_DIR, "infer.py"), mode, "--model", modelDir, "--request", join(tmp, "req.json"), "--response", join(tmp, "res.json"), ...extra], { encoding: "utf8", timeout: 20 * 60_000 });
    if (r.status !== 0) return { ok: false, reason: r.status === 3 ? "MEMCHECK_REQUIRED" : "INFER_FAILED" };
    return { ok: true, response: JSON.parse(readFileSync(join(tmp, "res.json"), "utf8")) };
  } catch { return { ok: false, reason: "INFER_FAILED" }; }
  finally { rmSync(tmp, { recursive: true, force: true }); }
}

// ---- shadow scoring

/** One scoring item per block of added lines: the new-side lines before it in its hunk are the context. */
export function diffScoreItems(diff: string, maxBlocks = 8): { context: string; target: string }[] {
  const items: { context: string; target: string }[] = [];
  let path = "";
  let before: string[] = [];
  let block: string[] = [];
  const flush = () => {
    if (block.length && items.length < maxBlocks) items.push({ context: `// ${path}\n` + before.slice(-30).join("\n") + (before.length ? "\n" : ""), target: block.join("\n").slice(0, 2000) + "\n" });
    if (block.length) before.push(...block);
    block = [];
  };
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++ ")) { flush(); path = line.replace(/^\+\+\+ (b\/)?/, ""); before = []; continue; }
    if (line.startsWith("--- ") || line.startsWith("diff --git") || line.startsWith("index ")) continue;
    if (line.startsWith("@@")) { flush(); before = []; continue; }
    if (line.startsWith("+")) block.push(line.slice(1));
    else { flush(); if (line.startsWith(" ")) before.push(line.slice(1)); }
  }
  flush();
  return items;
}

/** LM shadow ranking over the distinct eligible edits: mean log-probability of the added lines, high first. */
export function lmShadowRanking(modelDir: string, ranking: RankingRecord, diff: (id: string) => string): LmShadow | null {
  const ok = verifyModelDir(modelDir);
  if (!ok.ok) return null;
  const ids = ranking.presentation.map((p) => p.id).sort();
  const items: { id: string; context: string; target: string }[] = [];
  for (const id of ids) diffScoreItems(diff(id)).forEach((it, k) => items.push({ id: `${id}#${k}`, ...it }));
  if (items.length === 0) return null;
  const r = runInfer("score", modelDir, { items });
  if (!r.ok || r.response.model !== ok.version) return null;
  const scores = ids.map((id) => {
    const parts = (r.response.scores as { id: string; logprob: number; tokens: number }[]).filter((s) => s.id.startsWith(`${id}#`));
    const tokens = parts.reduce((n, s) => n + s.tokens, 0);
    return { id, tokens, mean: tokens ? Math.round((parts.reduce((n, s) => n + s.logprob, 0) / tokens) * 1e6) / 1e6 : null };
  });
  const pos = (id: string) => ranking.rankerOrder.indexOf(id);
  const order = [...scores].sort((a, b) => (b.mean ?? -Infinity) - (a.mean ?? -Infinity) || pos(a.id) - pos(b.id)).map((s) => s.id);
  return { model: ok.version, order, top: order[0] ?? null, scores };
}

// ---- promotion (M3-style): shadow first; "lm" is active only with the variable AND the rule met

export function lmEvaluate(stored: readonly StoredTask[]) {
  const latest = new Map<number, StoredTask>();
  for (const t of stored) {
    const cur = latest.get(t.task.issue);
    if (!cur || BigInt(t.task.runId) > BigInt(cur.task.runId)) latest.set(t.task.issue, t);
  }
  let tasks = 0, lmAgree = 0, baselineAgree = 0;
  for (const t of latest.values()) {
    const e = effectiveVerdict(t.verdicts);
    if (t.task.test || !t.task.heldOut || e.withdrawn || !e.pick.decided || !t.ranking.lmShadow || t.ranking.presentation.length < 2) continue;
    tasks += 1;
    if (t.ranking.lmShadow.top === e.pick.candidateId) lmAgree += 1;
    if (t.ranking.rankerTop === e.pick.candidateId) baselineAgree += 1;
  }
  const reasons: string[] = [];
  if (tasks < LM_PROMOTION_RULE.minHeldOutTasks) reasons.push(`held-out tasks with an LM score ${tasks} < ${LM_PROMOTION_RULE.minHeldOutTasks}`);
  if (!(lmAgree > baselineAgree)) reasons.push("LM does not beat the baseline on held-out");
  return { rule: LM_PROMOTION_RULE, tasks, lmAgree, baselineAgree, eligible: reasons.length === 0, reasons };
}

export function activeWithLm(variable: string | undefined, lmEligible: boolean, current: "deterministic" | "model" | "lm"): "deterministic" | "model" | "lm" {
  return variable === "lm" && lmEligible ? "lm" : current;
}

/** The current model directory in a Results checkout (models/lm/latest.json), or null. */
export function latestLmDir(resultsRoot: string): string | null {
  try {
    const latest = JSON.parse(readFileSync(join(resultsRoot, "models", "lm", "latest.json"), "utf8"));
    return /^lm-v1-[0-9a-f]{12}$/.test(latest.version ?? "") ? join(resultsRoot, "models", "lm", latest.version) : null;
  } catch { return null; }
}
