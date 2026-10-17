// Builder task log validator: schema per line + append-only against a base revision.
// Usage: tsx builder-log/check.ts [--base <git-rev>] [--verify-shas]
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

export const LOG_PATH = "builder-log/tasks.jsonl";

/** Edit kinds (PeaceAI skills). APPROVED = learned rules live today; the rest are known gaps. */
export const APPROVED_SKILLS = [
  "TEST_CASE", // public-test-case-v1
  "TEST_CASE_APPEND", // public-test-case-append-v1
  "THROW_GUARD", // public-throw-guard-v1
  "ADD_FUNCTION", // public-add-function-v1 (existing module)
  "ADD_FUNCTION_NEW_MODULE", // public-add-function-v2
] as const;
export const MISSING_SKILLS = [
  "MODIFY_LOGIC", // multi-line logic change in an existing function
  "PEACEAI_SELF_CHANGE", // PeaceAI's own tooling: protected, never a PeaceAI edit by design
  "OPS_ACTION", // dispatch, close, label, diagnose: no code edit
] as const;
/**
 * Skills approved later: approved for entries at or after the landing time (MT, "YYYY-MM-DD HH:MM"), and still a
 * missing skill for earlier entries (the log is append-only, so history keeps the mark it had then).
 */
export const APPROVED_SINCE = {
  CHECK_OBJECT_LITERAL_ARGS: "2026-10-13 21:30", // public-test-case(-append)-objargs-v1, #118/#119 merged 03:30Z
  WORKFLOW_STEP: "2026-10-13 22:41", // public-workflow-step-v2, #125 merged 04:41Z
  METHOD_GUARD: "2026-10-15 12:01", // public-method-guard-v1, #201 merged bdd1e27
  COMPLEX_FUNCTION: "2026-10-15 16:27", // public-complex-function-v1 (loop-free only), #211 merged f33baa1; earlier entries keep "missing skill"
  LOOP_FUNCTION: "2026-10-15 21:29", // public-loop-function-v1 (bounded for/for-of), approval PR #225 merged 95c1e79 (03:29Z); earlier entries keep "missing skill"
  ENV_FIX: "2026-10-16 11:41", // public-env-fix-v1 (strict env flag edit), approval PR #292 merged 6fdb337 (17:41Z); earlier entries keep "missing skill"
  WORKFLOW_JOB: "2026-10-16 11:46", // public-workflow-job-v1, approval PR #296 merged 782a309 (17:46Z); earlier entries keep "missing skill"
  TSCONFIG_SCRIPT: "2026-10-16 12:17", // public-tsconfig-script-v1, approval PR #300 merged ed44b44 (18:17Z); earlier entries keep "missing skill"
  IMPORT_EDIT: "2026-10-15 22:33", // public-import-edit-v2, approval PR #234 merged ba5f2b7 (04:33Z); earlier entries keep "missing skill"
} as const;
/**
 * Skills with a passing live proof from `since` (MT) on. Distinct from APPROVED_SINCE: approval alone is not
 * live-proven. Every entry MUST name a builder-log `seq` that backs it: that line must be by PeaceAI, use the
 * same skill, and land a repo@sha in `changed`. validateLog / validateLiveProven refuse an unbacked map.
 */
export type LiveProvenRef = { readonly since: string; readonly seq: number };
export const LIVE_PROVEN_SINCE: Readonly<Record<string, LiveProvenRef>> = {
  WORKFLOW_STEP: { since: "2026-10-15 12:02", seq: 85 }, // PeaceSTOCKS#6 @f57036b; tenmin-mode-sim run 38782483772
  METHOD_GUARD: { since: "2026-10-15 17:28", seq: 86 }, // PeaceAI-Workspace#205 landed as PeaceSTOCKS@365b91e
  COMPLEX_FUNCTION: { since: "2026-10-15 18:57", seq: 87 }, // PeaceAI-Workspace#214 landed as PeaceSTOCKS@c9a6076 (loop-free bodies only)
  LOOP_FUNCTION: { since: "2026-10-15 21:52", seq: 97 }, // PeaceAI-Workspace#229 landed as PeaceSTOCKS@22b0f3d; tenmin-mode-sim run 38847676694
  IMPORT_EDIT: { since: "2026-10-16 00:17", seq: 101 }, // PeaceAI-Workspace#237 (proof A1) landed as PeaceSTOCKS@eb8aadc; tenmin-mode-sim run 38860420718
};
/** repo@sha landing in a changed field (not an issue-only ref). */
export const LIVE_LANDING_REF = /(?:PeaceSTOCKS|PeaceAI-Workspace)@[0-9a-f]{7,40}/;
export type Skill = (typeof APPROVED_SKILLS)[number] | (typeof MISSING_SKILLS)[number] | keyof typeof APPROVED_SINCE;

/** Sole allowed value of the optional `coverage` field (proof / no-credit landings). */
export const COVERAGE_NONE = "none" as const;
export type CoverageFlag = typeof COVERAGE_NONE;

/**
 * Historical PeaceAI rows whose asked/why already say "live proof" / "proof A" / "no coverage" but that
 * predate the `coverage` field. Append-only: they cannot gain the field without a rewrite. validateLog
 * grandfathers these seqs; new PeaceAI rows with that wording must set `"coverage":"none"`.
 * coverage.ts also treats the allowlist as no real-task credit (none of these are source: peace except
 * 99/101, which stay uncredited).
 */
export const COVERAGE_NONE_SEQS: ReadonlySet<number> = new Set([
  28, 30, 31, 35, 59, 60, 85, 86, 87, 97, 99, 101,
]);

/** PeaceAI prose that requires coverage:"none" unless the seq is in COVERAGE_NONE_SEQS. */
export const COVERAGE_NONE_WORDING = /live proof|proof A|no coverage/i;

export interface Entry {
  seq: number;
  date: string; // YYYY-MM-DD (America/Denver)
  time: string; // HH:MM MT
  asked: string;
  changed: string; // diff ref
  why: string;
  skill: Skill;
  mark: string; // "PeaceAI-able today" | "missing skill <SKILL>"
  by: "Builder" | "PeaceAI";
  /** When present must be "none": exclude from PeaceAI real-task coverage credit. */
  coverage?: CoverageFlag;
}

const KEYS = ["seq", "date", "time", "asked", "changed", "why", "skill", "mark", "by"] as const;
const KEYS_WITH_COVERAGE = [...KEYS, "coverage"] as const;
// Diff ref: PeaceSTOCKS@<sha>, PeaceAI-Workspace@<sha>, PeaceAI-Workspace#<n>, "none (...)"; several joined by ", ".
const REF = /^(?:(?:PeaceSTOCKS|PeaceAI-Workspace)@[0-9a-f]{7,40}|PeaceAI-Workspace#\d+)$/;
// Public repo: refuse secret-shaped text and private-repo references.
const FORBIDDEN: [RegExp, string][] = [
  [/gh[pousr]_[A-Za-z0-9]{20,}|github_pat_|AKIA[0-9A-Z]{16}|sk-[A-Za-z0-9]{20,}|-----BEGIN/, "secret-shaped text"],
  [/PeaceSTOCKS-Net|Net-Runner|peacestocks-net|\bnet\//i, "private Net reference"],
  [/^diff --git|^@@ /m, "inline diff text"],
];

export function validateEntry(raw: unknown, expectSeq: number): string[] {
  const e = raw as Record<string, unknown>;
  const errs: string[] = [];
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return ["not an object"];
  const keys = Object.keys(e);
  const keyLine = keys.join(",");
  if (keyLine !== KEYS.join(",") && keyLine !== KEYS_WITH_COVERAGE.join(",")) {
    errs.push(`keys must be exactly ${KEYS.join(",")} in order, or the same with trailing coverage`);
  }
  if (Object.prototype.hasOwnProperty.call(e, "coverage") && e.coverage !== COVERAGE_NONE) {
    errs.push(`coverage must be "${COVERAGE_NONE}" when present`);
  }
  if (e.seq !== expectSeq) errs.push(`seq must be ${expectSeq}`);
  if (typeof e.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(e.date)) errs.push("bad date");
  if (typeof e.time !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(e.time)) errs.push("bad time");
  for (const k of ["asked", "why"] as const)
    if (typeof e[k] !== "string" || (e[k] as string).trim().length < 8 || (e[k] as string).length > 400) errs.push(`${k} must be 8..400 chars`);
  if (typeof e.changed !== "string") errs.push("changed must be a string");
  else if (!/^none \(.{4,120}\)$/.test(e.changed) && !e.changed.split(", ").every((r) => REF.test(r)))
    errs.push("changed must be repo@sha / PeaceAI-Workspace#PR refs or 'none (reason)'");
  const since = Object.prototype.hasOwnProperty.call(APPROVED_SINCE, e.skill as string) ? APPROVED_SINCE[e.skill as keyof typeof APPROVED_SINCE] : null;
  const at = `${String(e.date)} ${String(e.time)}`;
  const approved = (APPROVED_SKILLS as readonly string[]).includes(e.skill as string) || (since !== null && at >= since);
  const missing = (MISSING_SKILLS as readonly string[]).includes(e.skill as string) || (since !== null && at < since);
  if (!approved && !missing) errs.push(`unknown skill ${String(e.skill)}`);
  const want = approved ? "PeaceAI-able today" : `missing skill ${String(e.skill)}`;
  if (e.mark !== want) errs.push(`mark must be "${want}"`);
  if (e.by !== "Builder" && e.by !== "PeaceAI") errs.push("by must be Builder or PeaceAI");
  if (e.by === "PeaceAI" && !approved) errs.push("a PeaceAI-authored entry must use an approved skill");
  if (e.by === "PeaceAI") {
    const prose = `${String(e.asked)}\n${String(e.why)}`;
    if (COVERAGE_NONE_WORDING.test(prose)) {
      const hasField = e.coverage === COVERAGE_NONE;
      const grandfathered = COVERAGE_NONE_SEQS.has(expectSeq);
      if (!hasField && !grandfathered) {
        errs.push('PeaceAI asked/why proof wording requires coverage:"none" (or a COVERAGE_NONE_SEQS grandfather)');
      }
    }
  }
  const text = JSON.stringify(raw);
  for (const [re, what] of FORBIDDEN) if (re.test(text)) errs.push(what);
  return errs;
}


/**
 * Retag (append-only correction of an earlier entry's skill): a Builder line whose `changed` is exactly
 * `none (retag seq N)`. Its `skill` replaces seq N's skill for coverage (latest retag wins); it is not a task.
 */
export const RETAG = /^none \(retag seq ([1-9]\d*)\)$/;
export const retagTarget = (e: Pick<Entry, "changed">): number | null => {
  const m = RETAG.exec(e.changed);
  return m ? Number(m[1]) : null;
};

/** A retag must point at an earlier, existing, non-retag Builder entry. */
export function validateRetags(entries: readonly Entry[]): string[] {
  const bySeq = new Map(entries.map((e) => [e.seq, e]));
  const errs: string[] = [];
  for (const e of entries) {
    const t = retagTarget(e);
    if (t === null) continue;
    if (e.by !== "Builder") errs.push(`seq ${e.seq}: a retag must be by Builder`);
    const target = bySeq.get(t);
    if (!target || t >= e.seq) { errs.push(`seq ${e.seq}: retag references missing or later seq ${t}`); continue; }
    if (retagTarget(target) !== null) errs.push(`seq ${e.seq}: retag references another retag (seq ${t})`);
    if (target.by !== "Builder") errs.push(`seq ${e.seq}: retag target seq ${t} must be a Builder task`);
  }
  return errs;
}

/** Refuse LIVE_PROVEN_SINCE entries that are not backed by a PeaceAI repo@sha log line for that skill. */
export function validateLiveProven(
  entries: readonly Entry[],
  map: Readonly<Record<string, LiveProvenRef>> = LIVE_PROVEN_SINCE,
): string[] {
  const bySeq = new Map(entries.map((e) => [e.seq, e]));
  const errs: string[] = [];
  for (const [skill, ref] of Object.entries(map)) {
    if (!ref || typeof ref.since !== "string" || typeof ref.seq !== "number") {
      errs.push(`LIVE_PROVEN_SINCE.${skill}: need { since, seq }`);
      continue;
    }
    if (!/^\d{4}-\d{2}-\d{2} ([01]\d|2[0-3]):[0-5]\d$/.test(ref.since)) {
      errs.push(`LIVE_PROVEN_SINCE.${skill}: bad since (want YYYY-MM-DD HH:MM MT)`);
    }
    if (!Number.isInteger(ref.seq) || ref.seq < 1) {
      errs.push(`LIVE_PROVEN_SINCE.${skill}: seq must be a positive integer`);
      continue;
    }
    const e = bySeq.get(ref.seq);
    if (!e) {
      errs.push(`LIVE_PROVEN_SINCE.${skill}: no builder-log seq ${ref.seq}`);
      continue;
    }
    if (e.by !== "PeaceAI") errs.push(`LIVE_PROVEN_SINCE.${skill}: seq ${ref.seq} by must be PeaceAI (got ${e.by})`);
    if (e.skill !== skill) errs.push(`LIVE_PROVEN_SINCE.${skill}: seq ${ref.seq} skill is ${e.skill}, not ${skill}`);
    if (!LIVE_LANDING_REF.test(e.changed)) {
      errs.push(`LIVE_PROVEN_SINCE.${skill}: seq ${ref.seq} changed must include a repo@sha landing`);
    }
  }
  return errs;
}


/** Refuse allowlist seqs missing from `entries`. Caller gates short fixtures (see validateLog). */
export function validateCoverageNoneSeqs(
  entries: readonly Entry[],
  allow: ReadonlySet<number> = COVERAGE_NONE_SEQS,
): string[] {
  const bySeq = new Map(entries.map((e) => [e.seq, e]));
  const errs: string[] = [];
  for (const seq of [...allow].sort((a, b) => a - b)) {
    if (!bySeq.has(seq)) errs.push(`COVERAGE_NONE_SEQS: no builder-log seq ${seq}`);
  }
  return errs;
}

/** True when the entry opts out of PeaceAI real-task coverage (field or grandfather allowlist). */
export function isCoverageNone(e: Pick<Entry, "seq" | "coverage">): boolean {
  return e.coverage === COVERAGE_NONE || COVERAGE_NONE_SEQS.has(e.seq);
}

export function validateLog(text: string): string[] {
  if (text.length > 0 && !text.endsWith("\n")) return ["file must end with a newline"];
  const errs: string[] = [];
  const lines = text.split("\n").slice(0, -1);
  const entries: Entry[] = [];
  lines.forEach((line, i) => {
    let v: unknown;
    try {
      v = JSON.parse(line);
    } catch {
      errs.push(`line ${i + 1}: not JSON`);
      return;
    }
    if (JSON.stringify(v) !== line) errs.push(`line ${i + 1}: not canonical JSON (one compact object per line)`);
    for (const e of validateEntry(v, i + 1)) errs.push(`line ${i + 1}: ${e}`);
    if (typeof v === "object" && v !== null) entries.push(v as Entry);
  });
  // LIVE_PROVEN_SINCE is checked once the log is long enough to contain every named seq (short schema
  // fixtures are not required to embed the full backing history).
  if (errs.length === 0) errs.push(...validateRetags(entries));
  if (errs.length === 0) {
    const need = Object.values(LIVE_PROVEN_SINCE).reduce((m, r) => Math.max(m, r.seq), 0);
    if (entries.length >= need) errs.push(...validateLiveProven(entries));
  }
  if (errs.length === 0) {
    const need = [...COVERAGE_NONE_SEQS].reduce((m, n) => Math.max(m, n), 0);
    if (entries.length >= need) errs.push(...validateCoverageNoneSeqs(entries));
  }
  return errs;
}

/** Append-only: the base file must be a byte prefix of the head file. */
export function appendOnly(base: string, head: string): string[] {
  if (head.startsWith(base)) return [];
  const b = base.split("\n");
  const h = head.split("\n");
  const i = b.findIndex((l, n) => l !== h[n]);
  return [`existing line ${i + 1} was modified or removed (log is append-only)`];
}


/** Public GitHub owner/repo for each landing label in `changed`. */
export const LANDING_REPOS: Readonly<Record<"PeaceSTOCKS" | "PeaceAI-Workspace", string>> = {
  PeaceSTOCKS: "PeaceG03/PeaceSTOCKS",
  "PeaceAI-Workspace": "PeaceG03/PeaceAI-Workspace",
};

export type ShaResolver = (repo: string, sha: string) => boolean | Promise<boolean>;

const LANDING_CAPTURE = /(PeaceSTOCKS|PeaceAI-Workspace)@([0-9a-f]{7,40})/g;

/** Every PeaceAI repo@sha landing in the log (deduped by repo@sha; first seq wins for error text). */
export function peaceAiShaLandings(entries: readonly Entry[]): { seq: number; label: string; repo: string; sha: string }[] {
  const out: { seq: number; label: string; repo: string; sha: string }[] = [];
  const seen = new Set<string>();
  for (const e of entries) {
    if (e.by !== "PeaceAI") continue;
    for (const m of e.changed.matchAll(LANDING_CAPTURE)) {
      const label = m[1] as "PeaceSTOCKS" | "PeaceAI-Workspace";
      const sha = m[2]!;
      const repo = LANDING_REPOS[label];
      const key = `${repo}@${sha}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ seq: e.seq, label, repo, sha });
    }
  }
  return out;
}

/**
 * Fail-closed: each PeaceAI repo@sha must resolve true via `resolve`. Lookup errors and false both become errs.
 * Injectable so unit tests can stub the GitHub API (no network).
 */
export async function verifyPeaceAiShas(entries: readonly Entry[], resolve: ShaResolver): Promise<string[]> {
  const errs: string[] = [];
  for (const hit of peaceAiShaLandings(entries)) {
    let ok = false;
    try {
      ok = await resolve(hit.repo, hit.sha);
    } catch {
      errs.push(`seq ${hit.seq}: ${hit.label}@${hit.sha} lookup failed (fail closed)`);
      continue;
    }
    if (!ok) errs.push(`seq ${hit.seq}: ${hit.label}@${hit.sha} does not exist`);
  }
  return errs;
}

/** GitHub Commits API resolver using a token (contents:read is enough for public + this-repo commits). */
export function makeGithubShaResolver(token: string, fetchImpl: typeof fetch = fetch): ShaResolver {
  if (!token) throw new Error("GITHUB_TOKEN is required for --verify-shas");
  return async (repo, sha) => {
    const url = `https://api.github.com/repos/${repo}/commits/${encodeURIComponent(sha)}`;
    const res = await fetchImpl(url, {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "PeaceAI-Workspace-builder-log",
      },
    });
    if (res.status === 200) return true;
    if (res.status === 404) return false;
    throw new Error(`HTTP ${res.status}`);
  };
}

function baseText(rev: string): string {
  try {
    return execFileSync("git", ["show", `${rev}:${LOG_PATH}`], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    // No log at base (first PR). Confirm the revision itself exists, so a bad ref fails closed.
    execFileSync("git", ["cat-file", "-e", `${rev}^{commit}`]);
    return "";
  }
}

async function main(): Promise<void> {
  const head = readFileSync(LOG_PATH, "utf8");
  const errs = validateLog(head);
  const i = process.argv.indexOf("--base");
  if (i > 0) errs.push(...appendOnly(baseText(process.argv[i + 1]!), head));
  if (errs.length === 0 && process.argv.includes("--verify-shas")) {
    const entries = head.split("\n").filter(Boolean).map((l) => JSON.parse(l) as Entry);
    const token = process.env.GITHUB_TOKEN ?? "";
    errs.push(...(await verifyPeaceAiShas(entries, makeGithubShaResolver(token))));
  }
  if (errs.length) {
    for (const e of errs) console.error(`builder-log: ${e}`);
    process.exit(1);
  }
  const bits = [`${head.split("\n").length - 1} entries OK`];
  if (i > 0) bits.push("append-only vs base");
  if (process.argv.includes("--verify-shas")) bits.push("PeaceAI repo@sha verified");
  console.log(`builder-log: ${bits.join("; ")}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(`builder-log: ${e instanceof Error ? e.message : e}`);
    process.exit(1);
  });
}
