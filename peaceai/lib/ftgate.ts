// M49 BLOCKING (1) (Auditor): the fine-tune corpus gets a core gate before training, like the pretrain corpus
// (ext-corpus.ts excludes core on the box; ext-manifest-check.ts refuses training unless the box memcheck record for
// that exact manifest sha is PASS). Here the box record is peaceai/model/ft-corefree.json:
// - the fine-tune repos are pinned to exact commits (the runner builds the corpus from those, never from HEAD);
// - docs the box proof flagged as core are dropped by text sha256 (excludedDocSha256) when ft-pairs builds the corpus;
// - corefree_proof.py --stage finetune ran on the box against PeaceAI core for the resulting manifest, PROVEN, and its
//   proof file (peaceai/model/ft-corefree-proof.json) is committed and pinned by sha256.
// ftGateProblems refuses unless the built manifest/docs match the record and the pinned proof is PROVEN for them.
import { createHash } from "node:crypto";

export const FT_COREFREE_SCHEMA = "peaceai-ft-corefree:v1";
const HEX64 = /^[0-9a-f]{64}$/;
const HEX40 = /^[0-9a-f]{40}$/;
export const sha256Hex = (b: string | Buffer): string => createHash("sha256").update(b).digest("hex");

export interface FtCorefreeRecord {
  schema: string;
  repos: { repo: string; sha: string }[];
  excludedDocSha256: string[];
  manifestSha256: string;
  docsSha256: string;
  proof: { path: string; sha256: string; noCoreFiles: string; coreCommit: string };
}

/** Shape problems of the committed record (empty list = well formed). */
export function recordProblems(r: unknown): string[] {
  const p: string[] = [];
  const x = r as Partial<FtCorefreeRecord> | null;
  if (!x || x.schema !== FT_COREFREE_SCHEMA) return ["record schema"];
  if (!Array.isArray(x.repos) || x.repos.length === 0 || !x.repos.every((e) => typeof e?.repo === "string" && /^[\w.-]+\/[\w.-]+$/.test(e.repo) && HEX40.test(String(e.sha)))) p.push("repos must be pinned to 40-hex commits");
  if (!Array.isArray(x.excludedDocSha256) || !x.excludedDocSha256.every((s) => HEX64.test(String(s)))) p.push("excludedDocSha256");
  if (!HEX64.test(String(x.manifestSha256))) p.push("manifestSha256");
  if (!HEX64.test(String(x.docsSha256))) p.push("docsSha256");
  if (!x.proof || x.proof.path !== "peaceai/model/ft-corefree-proof.json" || !HEX64.test(String(x.proof.sha256)) || x.proof.noCoreFiles !== "PROVEN" || !HEX40.test(String(x.proof.coreCommit))) p.push("proof pin");
  return p;
}

/** Everything that must hold before the fine-tune trains. Empty list = gate passes. */
export function ftGateProblems(input: { record: unknown; proofBytes: Buffer | string; manifestBytes: Buffer | string; docsBytes: Buffer | string; repos: { repo: string; sha: string }[] }): string[] {
  const p = recordProblems(input.record);
  if (p.length) return p;
  const r = input.record as FtCorefreeRecord;
  if (JSON.stringify(input.repos) !== JSON.stringify(r.repos)) p.push("corpus not built from the pinned repo commits");
  if (sha256Hex(input.proofBytes) !== r.proof.sha256) p.push("proof file sha256 is not the recorded one");
  const ms = sha256Hex(input.manifestBytes), ds = sha256Hex(input.docsBytes);
  if (ms !== r.manifestSha256) p.push("fine-tune manifest sha256 is not the recorded one");
  if (ds !== r.docsSha256) p.push("fine-tune docs sha256 is not the recorded one");
  let proof: { schema?: string; noCoreFiles?: string; manifestSha256?: string; corpus?: string; coreCommit?: string; files?: { sha256: string; coreExact: boolean; coreNearMax: number }[]; near?: { threshold?: number } } | null = null;
  try { proof = JSON.parse(input.proofBytes.toString()); } catch { proof = null; }
  if (!proof || proof.schema !== "peaceai-lm-corefree-proof:v1" || proof.corpus !== "finetune") return [...p, "proof is not a fine-tune core-free proof"];
  if (proof.noCoreFiles !== "PROVEN") p.push("proof is not PROVEN");
  if (proof.manifestSha256 !== ms) p.push("proof is for a different manifest");
  if (proof.coreCommit !== r.proof.coreCommit) p.push("proof core commit is not the recorded one");
  const files = Array.isArray(proof.files) ? proof.files : [];
  const th = proof.near?.threshold ?? 0.8;
  if (files.length === 0 || files.some((f) => f.coreExact || !(f.coreNearMax < th) || r.excludedDocSha256.includes(f.sha256))) p.push("proof lists a core or excluded doc");
  const docShas = String(input.docsBytes).split("\n").filter(Boolean).map((l) => sha256Hex(JSON.parse(l).text as string));
  if (docShas.length !== files.length || docShas.some((s, i) => s !== files[i]!.sha256)) p.push("proof does not cover exactly the built docs");
  return p;
}
