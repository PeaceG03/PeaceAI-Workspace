// M18 (Auditor option b): stale-base regrade through the normal pipeline. When the owner picks a candidate
// whose task base is no longer the target's head, the verdict job does NOT build a patch on the old base.
// It posts a regrade request (this marker + the chosen diff, hash-pinned) on the issue. When the owner
// re-queues the task, Job A re-applies exactly that diff onto the target's CURRENT head (plain apply, no
// 3-way; not clean = refused, 0 candidates), sandboxed Job B grades it fresh there, and the record job
// writes a normal Results attempt whose task record carries `regradeOf` (old run, candidate, old base,
// diff hash). The old grade is never carried forward: the owner gives a new verdict on the new attempt.
import { createHash } from "node:crypto";

export const REGRADE_MARKER = "<!-- peaceai-regrade-request:v1 -->";
export const MAX_REGRADE_DIFF = 60_000;
const SHA = /^[0-9a-f]{40}$/;
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export interface ChosenMeta {
  runId: string;
  candidateId: string;
  baseSha: string;
  transformations: string[];
  operationId: string | null;
  selfGrade?: true;
  fixSha?: string;
}
export interface RegradeRequest extends ChosenMeta { schema: "peaceai-regrade-request:v1"; newHead: string; diffSha256: string; diff: string }
export interface RegradeOf { runId: string; candidateId: string; oldBase: string; diffSha256: string }

export function validChosenMeta(m: unknown): m is ChosenMeta {
  if (!m || typeof m !== "object") return false;
  const c = m as Record<string, unknown>;
  const keys = Object.keys(c).sort().join(",");
  const base = "baseSha,candidateId,operationId,runId,transformations";
  if (![base, `${base},selfGrade`.split(",").sort().join(","), `${base},fixSha`.split(",").sort().join(",")].includes(keys)) return false;
  return (
    typeof c.runId === "string" && /^\d{1,20}$/.test(c.runId) &&
    typeof c.candidateId === "string" && /^candidate-\d{1,3}$/.test(c.candidateId) &&
    typeof c.baseSha === "string" && SHA.test(c.baseSha) &&
    Array.isArray(c.transformations) && c.transformations.length > 0 && c.transformations.every((t) => typeof t === "string" && /^[A-Z_]{1,40}$/.test(t)) &&
    (c.operationId === null || (typeof c.operationId === "string" && c.operationId.length <= 200 && /^[\w:@.-]+$/.test(c.operationId))) &&
    (!("selfGrade" in c) || c.selfGrade === true) &&
    (!("fixSha" in c) || (typeof c.fixSha === "string" && SHA.test(c.fixSha)))
  );
}

/** The issue comment that asks for a regrade. The diff rides in a fenced block; its hash is in the JSON. */
export function regradeComment(meta: ChosenMeta, newHead: string, diff: string): string | null {
  if (!validChosenMeta(meta) || !SHA.test(newHead) || newHead === meta.baseSha || diff.length === 0 || diff.length > MAX_REGRADE_DIFF) return null;
  const fence = "`".repeat(Math.max(3, ...[...diff.matchAll(/`+/g)].map((m) => m[0].length + 1)));
  const req = { schema: "peaceai-regrade-request:v1", ...meta, newHead, diffSha256: sha256(diff) };
  return [
    REGRADE_MARKER,
    `Verdict recorded, but the target moved since this attempt was graded (base \`${meta.baseSha.slice(0, 12)}\` → head \`${newHead.slice(0, 12)}\`). No patch is built on the old base and the old grade is not carried forward.`,
    "",
    "To regrade: remove `peaceai:done` and re-add `peace-task`. The next run re-applies exactly this candidate onto the target's current head (refused if it does not apply cleanly), grades it fresh in the sandboxed Job B, records a new attempt in Results (`regradeOf` this one) and posts a new review for a new verdict.",
    "",
    "<!-- regrade-json",
    JSON.stringify(req),
    "regrade-json -->",
    "",
    `${fence}diff`,
    diff.endsWith("\n") ? diff.slice(0, -1) : diff,
    fence,
    "",
  ].join("\n");
}

/** Parses a regrade comment; null unless the JSON is valid and the fenced diff matches its hash exactly. */
export function parseRegradeComment(body: string): RegradeRequest | null {
  const b = body.replace(/\r\n/g, "\n");
  if (!b.startsWith(REGRADE_MARKER + "\n")) return null;
  const j = /\n<!-- regrade-json\n(.+)\nregrade-json -->\n/.exec(b);
  const d = /\n(`{3,})diff\n([\s\S]*?)\n\1\n/.exec(b);
  if (!j || !d) return null;
  let req: Record<string, unknown>;
  try { req = JSON.parse(j[1]!); } catch { return null; }
  const { schema, newHead, diffSha256, ...meta } = req;
  if (schema !== "peaceai-regrade-request:v1" || typeof newHead !== "string" || !SHA.test(newHead) || typeof diffSha256 !== "string" || !validChosenMeta(meta)) return null;
  const diff = `${d[2]}\n`;
  if (sha256(diff) !== diffSha256 || diff.length > MAX_REGRADE_DIFF) return null;
  return { schema: "peaceai-regrade-request:v1", ...(meta as ChosenMeta), newHead, diffSha256, diff };
}

/**
 * Which regrade request (if any) the next run must honour: the newest bot comment that is either a
 * regrade request or a review/no-candidates reply. A review posted after the request means it was used.
 */
export function pendingRegrade(comments: readonly { user: string; body: string }[], bot = "github-actions[bot]"): RegradeRequest | "invalid" | null {
  const mine = comments.filter((c) => c.user === bot);
  for (let i = mine.length - 1; i >= 0; i--) {
    const body = mine[i]!.body;
    // Anything that looks like a regrade request but is not a valid v1 request (an older format, a hand
    // edit, a broken hash) is refused, never silently treated as a fresh task.
    if (body.replace(/\r\n/g, "\n").includes("peaceai-regrade-request")) return parseRegradeComment(body) ?? "invalid";
    if (body.startsWith("PeaceAI review.") || body.startsWith("PeaceAI: no candidates")) return null;
  }
  return null;
}

export const regradeOf = (r: RegradeRequest): RegradeOf => ({ runId: r.runId, candidateId: r.candidateId, oldBase: r.baseSha, diffSha256: r.diffSha256 });
export function validRegradeOf(v: unknown): v is RegradeOf {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return Object.keys(o).sort().join(",") === "candidateId,diffSha256,oldBase,runId" && typeof o.runId === "string" && /^\d{1,20}$/.test(o.runId) &&
    typeof o.candidateId === "string" && /^candidate-\d{1,3}$/.test(o.candidateId) && typeof o.oldBase === "string" && SHA.test(o.oldBase) &&
    typeof o.diffSha256 === "string" && /^[0-9a-f]{64}$/.test(o.diffSha256);
}

/** Chosen-candidate metadata from its Results records (selfGrade = graded against the task base). */
export function chosenMetaOf(task: { runId: string; baseSha: string }, c: { id: string; transformations: string[]; operationId: string | null; testGrading?: { fixSha: string } | null }): ChosenMeta | null {
  const g = c.testGrading ?? null;
  const meta: ChosenMeta = {
    runId: task.runId, candidateId: c.id, baseSha: task.baseSha, transformations: [...c.transformations], operationId: c.operationId,
    ...(g ? (g.fixSha === task.baseSha ? { selfGrade: true as const } : { fixSha: g.fixSha }) : {}),
  };
  return validChosenMeta(meta) ? meta : null;
}

/**
 * M18 (Auditor): the regrade record must match the attempt it rides with: exactly one candidate, the
 * candidate's diff hashes to `diffSha256`, and the old base differs from this attempt's base. Null = ok.
 */
export function regradeMismatch(rg: unknown, summary: { baseSha: string; candidates: { id: string; file: string }[] }, diffOf: (file: string) => string): string | null {
  if (!validRegradeOf(rg)) return "regrade record schema";
  if (summary.candidates.length !== 1 || summary.candidates[0]!.id !== "candidate-1") return "regrade record needs exactly one candidate";
  if (rg.oldBase === summary.baseSha) return "regrade record old base equals this base";
  if (sha256(diffOf(summary.candidates[0]!.file)) !== rg.diffSha256) return "regrade record diff hash does not match the candidate";
  return null;
}
