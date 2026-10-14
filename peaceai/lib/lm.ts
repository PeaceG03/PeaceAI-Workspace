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
    return { ok: true, version: cfg.version };
  } catch { return { ok: false, reason: "CONFIG_INVALID" }; }
}

// ---- memorization check

export interface Sample { id: string; kind: string; prompt_tail: string; text: string }
export interface SampleScan {
  samples: number; coreLineHits: number; coreShingleHits: number; coreSubstringHits: number; personalInfo: number; flagged: number;
  /** "strict": any 32-character core hit fails (absent means strict). "core-free-64": only for a model whose
   *  Results record carries a valid core-free proof (see validCoreFreeProof); a hit is explained when its window
   *  is in that sample's prompt or in the public training corpus, and an unexplained run counts only when it is
   *  COREFREE_MIN_RUN (64) characters or longer. unexplainedHits = every unexplained run (reported);
   *  countedHits = the unexplained runs of 64+ characters (must be 0). */
  substringRule?: "strict" | "core-free-64";
  unexplainedHits?: number;
  countedHits?: number;
  longestUnexplained?: number;
}
export const COREFREE_MIN_RUN = 64;
/** Granted only by lm-memcheck when the model's record carries a valid core-free proof. */
export interface PublicOnlyExemption { prompts: ReadonlyMap<string, string>; trainingCorpus: SubstringIndex; minRun: number }

/** Scans model output for core text (the core-text scanner, public corpus as the baseline) and personal info. */
export function scanSamples(samples: readonly Sample[], core: TextIndex, baseline: TextIndex, coreRaw: SubstringIndex | null, exempt: PublicOnlyExemption | null = null): SampleScan {
  const scan: SampleScan = { samples: samples.length, coreLineHits: 0, coreShingleHits: 0, coreSubstringHits: 0, personalInfo: 0, flagged: 0 };
  if (exempt) { scan.substringRule = "core-free-64"; scan.unexplainedHits = 0; scan.countedHits = 0; scan.longestUnexplained = 0; }
  for (const s of samples) {
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
      const prompt = exempt.prompts.get(s.id);
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
      // Auditor (memcheck trace, lm-v1-78b6e96990d2): a joined run of 64+ counts ONLY when its ENTIRE text occurs
      // contiguously in core. Overlapping short windows (e.g. a 128-char 'c' run over a core run of 40) join into a
      // "run" that core never contains; that is not a copy. Reported lengths are unchanged.
      const inCore = (i: number): boolean => { const t = s.text.slice(starts[i]!, starts[i]! + lengths[i]!); return coreRaw!.texts.some((c) => c.includes(t)); };
      const long = unexplained ? lengths.filter((l, i) => l >= exempt.minRun && inCore(i)).length : 1;
      scan.unexplainedHits! += unexplained ? lengths.length : 1;
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
  if (!scan || scan.samples < MIN_MEMCHECK_SAMPLES) return "FAIL";
  const substring = scan.substringRule === "core-free-64" ? scan.countedHits ?? 1 : scan.coreSubstringHits;
  return scan.coreLineHits === 0 && scan.coreShingleHits === 0 && substring === 0 && scan.personalInfo === 0 ? "PASS" : "FAIL";
}

/**
 * The exemption's precondition: the model's training manifest proves zero core files. Every entry must be public,
 * from a source other than core, and its content hash must match no core file. An empty or unreadable manifest
 * proves nothing.
 */
export function manifestProvesNoCore(manifest: readonly { source?: string; visibility?: string; sha256?: string }[], coreFileShas: ReadonlySet<string>, coreSource = "PeaceG03/PeaceAI"): boolean {
  if (manifest.length === 0) return false;
  return manifest.every((m) => m.visibility === "public" && typeof m.source === "string" && m.source !== coreSource && typeof m.sha256 === "string" && /^[0-9a-f]{64}$/.test(m.sha256) && !coreFileShas.has(m.sha256));
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
export function validCoreFreeProof(proof: unknown, ctx: { modelId: string; manifest: readonly { doc: number; path: string; sha256?: string }[]; manifestSha256: string }): { ok: boolean; reason?: string } {
  const p = proof as CoreFreeProof | null;
  if (!p || typeof p !== "object") return { ok: false, reason: "MISSING" };
  if (p.schema !== COREFREE_PROOF_SCHEMA) return { ok: false, reason: "BAD_SCHEMA" };
  if (p.model !== ctx.modelId) return { ok: false, reason: "OTHER_MODEL" };
  if (p.noCoreFiles !== "PROVEN") return { ok: false, reason: "NOT_PROVEN" };
  if (p.manifestSha256 !== ctx.manifestSha256) return { ok: false, reason: "MANIFEST_MISMATCH" };
  if (!/^[0-9a-f]{40}$/.test(p.coreCommit ?? "")) return { ok: false, reason: "NO_CORE_COMMIT" };
  const t = p.near?.threshold;
  if (typeof t !== "number" || !(t > 0 && t <= 0.8)) return { ok: false, reason: "BAD_NEAR_THRESHOLD" };
  if (!Array.isArray(p.files) || p.files.length !== ctx.manifest.length || ctx.manifest.length === 0) return { ok: false, reason: "FILE_COUNT" };
  const byDoc = new Map(p.files.map((f) => [f?.doc, f]));
  for (const m of ctx.manifest) {
    const f = byDoc.get(m.doc);
    if (!f || f.path !== m.path || f.sha256 !== m.sha256) return { ok: false, reason: "FILE_MISMATCH" };
    if (f.coreExact !== false) return { ok: false, reason: "CORE_EXACT" };
    if (typeof f.coreNearMax !== "number" || !(f.coreNearMax >= 0 && f.coreNearMax < t)) return { ok: false, reason: "CORE_NEAR" };
  }
  return { ok: true };
}

// ---- where the model may run

/** Jobs that may load a model: the fill job, Job A, Job C, and ci.yml's unit tests (tiny fixture model only).
 *  Never Job B/B2 (ids `test`, `regate`), where candidate code runs. */
export const LM_JOBS = ["lm-fill", "generate", "record", "tests"] as const;
/** On Actions the job id decides; a job marked as running candidate code is always refused. Off Actions (the box) is allowed. */
export function lmJobAllowed(env: Record<string, string | undefined>): boolean {
  if (env.PEACEAI_CANDIDATE_JOB === "true") return false;
  if (env.GITHUB_ACTIONS === "true") return (LM_JOBS as readonly string[]).includes(env.GITHUB_JOB ?? "");
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
