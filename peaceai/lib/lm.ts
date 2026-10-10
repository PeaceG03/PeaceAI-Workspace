// M9: the from-scratch language model, seen from the TypeScript pipeline. Fail-closed loading (a model is
// usable only with a PASS memorization check bound to its exact file hashes), the memorization scan, diff
// scoring for the shadow ranker, flags (both off by default) and the promotion rule.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { findCoreText, type TextIndex } from "./coretext.ts";
import { scanText } from "./leak.ts";
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
export interface SampleScan { samples: number; coreLineHits: number; coreShingleHits: number; personalInfo: number; flagged: number }

/** Scans model output for core text (the core-text scanner, public corpus as the baseline) and personal info. */
export function scanSamples(samples: readonly Sample[], core: TextIndex, baseline: TextIndex): SampleScan {
  const scan: SampleScan = { samples: samples.length, coreLineHits: 0, coreShingleHits: 0, personalInfo: 0, flagged: 0 };
  for (const s of samples) {
    // The prompt's last partial line is joined to the output, so a completed core line is caught too.
    const text = s.prompt_tail + s.text;
    const hits = findCoreText(text.split("\n"), core, baseline);
    const pii = scanText(s.text).length;
    scan.coreLineHits += hits.lineHits;
    scan.coreShingleHits += hits.shingleHits;
    scan.personalInfo += pii;
    if (hits.lineHits + hits.shingleHits + pii > 0) scan.flagged += 1;
  }
  return scan;
}

export function memcheckStatus(scan: SampleScan | null): "PASS" | "FAIL" {
  if (!scan || scan.samples < MIN_MEMCHECK_SAMPLES) return "FAIL";
  return scan.coreLineHits === 0 && scan.coreShingleHits === 0 && scan.personalInfo === 0 ? "PASS" : "FAIL";
}

// ---- python bridge

export function runInfer(mode: "score" | "fill" | "sample", modelDir: string, request: unknown, extra: string[] = []): { ok: true; response: any } | { ok: false; reason: string } {
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
