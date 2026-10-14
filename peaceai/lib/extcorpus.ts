// M36: the external pretraining corpus (licensed TS/JS) and set C v2 (whole held-out external repositories).
// Pure helpers only; the builder is peaceai/bin/ext-corpus.ts. Rule text is committed before any carve.
import { createHash } from "node:crypto";
import { ALLOWED_SPDX, fileExclusion, type Exclusion } from "./lmcorpus.ts";
import { scanText } from "./leak.ts";

export const EXT_SCHEMA = "peaceai-ext-corpus:v1";
export const EXT_MANIFEST_SCHEMA = "peaceai-ext-manifest:v1";
/** Training stages. Only "pretrain" is built now; "finetune" (Peace code + builder-log changes) is reserved. */
export const STAGES = ["pretrain", "finetune"] as const;
export type Stage = (typeof STAGES)[number];
export const BUILT_STAGES: readonly Stage[] = ["pretrain"];
/** Corpus size band for the pretrain stage (bytes of used training text). */
export const EXT_MIN_BYTES = 50_000_000, EXT_MAX_BYTES = 100_000_000;
/** Per-repository cap on used training bytes (files in path order), so no single repo dominates. */
export const EXT_REPO_CAP_BYTES = 6_000_000;

/** Set C v2 rule (Architect, option 2). Committed before the carve. */
export const EXT_C_PERCENT = 15;
export const EXT_C_RULE = [
  "Set C v2 (Architect option 2, replaces the Peace-commit carve of M33): whole external repositories, held out from training.",
  "Pool: every repository in peaceai/model/ext-corpus.json whose root LICENSE classifies as its pinned SPDX id at its pinned commit.",
  "Order the pool by sha256('peaceai-ext-c:v1\\n' + name) ascending; the first ceil(15% of the pool) repositories are set C.",
  "A set C repository contributes no file to any training stage; every file it has that passes the corpus file filters is held out by content sha256 across all sources.",
  "Not wired in as the evaluation set until the Architect decides; until then it is only excluded from training.",
].join(" ");

const rank = (name: string): string => createHash("sha256").update(`peaceai-ext-c:v1\n${name}`).digest("hex");
export function extCRepos(pool: readonly string[]): string[] {
  const sorted = [...new Set(pool)].sort((a, b) => (rank(a) < rank(b) ? -1 : rank(a) > rank(b) ? 1 : 0));
  return sorted.slice(0, Math.ceil((sorted.length * EXT_C_PERCENT) / 100)).sort();
}

export type ExtExclusion = Exclusion | "generated-path" | "secret" | "duplicate" | "core" | "held-out" | "authorship" | "repo-cap" | "core-text" | "safety-tool";
/** Generic hex API key / secret / token literal (Auditor #148 follow-up): a key-like name assigned a 32+ hex string. */
export const HEX_SECRET = /(?:api[_-]?key|apikey|secret|token|access[_-]?key|auth)[\w$-]*["'`]?\s*[:=]\s*["'`][0-9a-fA-F]{32,}["'`]/i;
/** File filter for external code: the M9 filters plus generated/vendored path forms and the secret scanner. */
export function extFileExclusion(path: string, text: string, licenseDirs: readonly string[]): ExtExclusion | null {
  if (/(?:^|\/)(?:__snapshots__|__generated__|generated|gen|out|lib-cov|bower_components|jspm_packages|\.yarn|\.next|\.nuxt|\.svelte-kit|\.output|\.vercel|\.cache|bundle|bundles|umd|esm\/dist|types\/generated)\//.test(path)) return "generated-path";
  if (/\.(?:bundle|umd|prod|production)\.[cm]?js$|\.(?:snap|map)$|-lock\.|\.lock$/.test(path)) return "generated-path";
  const why = fileExclusion(path, text, licenseDirs, false);
  if (why === null && HEX_SECRET.test(text)) return "secret";
  if (why === "personal-info") return scanText(text).some((f) => /key|token|jwt/.test(f.kind)) ? "secret" : why;
  return why;
}

export interface ExtRepo { name: string; commit: string; spdx: (typeof ALLOWED_SPDX)[number]; licenseFile: string; licenseSha256: string }
export interface ExtManifestEntry { doc: number; stage: Stage; repo: string; commit: string; license: string; path: string; sha256: string; bytes: number; origin: "external" | "owner-public" }
export function validExtConfig(c: any): string | null {
  if (c?.schema !== EXT_SCHEMA) return "schema";
  if (!(STAGES as readonly string[]).includes(c.stage) || !BUILT_STAGES.includes(c.stage)) return "stage";
  if (!Array.isArray(c.repos) || c.repos.length === 0) return "repos";
  for (const r of c.repos) {
    if (!/^[\w.-]+\/[\w.-]+$/.test(r.name) || !/^[0-9a-f]{40}$/.test(r.commit) || !(ALLOWED_SPDX as readonly string[]).includes(r.spdx) || !/^[0-9a-f]{64}$/.test(r.licenseSha256)) return `repo ${r.name}`;
  }
  if (new Set(c.repos.map((r: ExtRepo) => r.name)).size !== c.repos.length) return "duplicate repo";
  return null;
}

/** Whole-corpus memcheck record schema (peaceai/model/ext-memcheck.json, written on the box by ext-memcheck.ts). */
export const EXT_MEMCHECK_SCHEMA = "peaceai-ext-memcheck:v1";

/** Architect (#148): Peace's safety-scanner tool files never enter any training stage: they describe what the
 *  leak and core-text checks look for. Matched by repo and exact path. */
export const SAFETY_TOOL_FILES: readonly { repo: string; path: RegExp }[] = [
  { repo: "PeaceG03/PeaceAI-Workspace", path: /^peaceai\/bin\/(?:core-scan|leak-scan|prepush-scan)\.ts$/ },
  { repo: "PeaceG03/PeaceAI-Workspace", path: /^peaceai\/lib\/(?:leak|trigger|coretext|coreindex|substr|kernelguard|prguard)\.ts$/ },
];
export const isSafetyToolFile = (repo: string, path: string): boolean => SAFETY_TOOL_FILES.some((s) => s.repo === repo && s.path.test(path));
