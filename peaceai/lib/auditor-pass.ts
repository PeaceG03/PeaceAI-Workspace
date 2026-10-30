// `/auditor-pass <letter> <candidate diff sha256>`: Auditor's PASS on a candidate counts as the owner's `right`
// verdict, but ONLY for the scanner-helper class Peace delegated (Oct 29 2026): a Builder-filed (source: builder)
// peace-task on PeaceSTOCKS carrying the `scanner-helper` label, whose candidate only ADDS one new module and one
// new test file under src/. Everything else fails closed with a reason code.
//
// It is recorded honestly: the Results verdict row says `source: "auditor-pass"` and
// `delegatedBy: "owner (scanner-helper class)"`. It is never an owner verdict: it gives 0 credit and is excluded
// from every owner-verdict tally (agreement, training, LM evaluation, builder-log Workspace coverage); see
// records.ts effectiveVerdict().delegated.
//
// Limit (stated, not solved): every agent comments as PeaceG03, so nothing here can tell Auditor's comment from
// Builder's. The gate relies on the agents' rules: Auditor alone posts /auditor-pass, Builder never does.
import { createHash } from "node:crypto";
import type { TargetConfig } from "./target.ts";

export const SCANNER_HELPER_LABEL = "scanner-helper";
export const TASK_LABEL = "peace-task";
/** Targets the scanner-helper delegation covers. */
export const SCANNER_HELPER_TARGETS: readonly string[] = ["PeaceG03/PeaceSTOCKS"];
export const AUDITOR_PASS_SOURCE = "auditor-pass" as const;
export const AUDITOR_PASS_DELEGATED_BY = "owner (scanner-helper class)" as const;
export const AUDITOR_PASS_USAGE = "Usage: `/auditor-pass <letter> <candidate diff sha256>` (64 lowercase hex), on a `scanner-helper` peace-task only.";

export interface AuditorPassCommand {
  label: string;
  diffSha256: string;
}
export type AuditorPassParse = { ok: true; command: AuditorPassCommand } | { ok: false; error: string };

/** Parses the first line of a comment. Only the exact shape is accepted; the sha must be lowercase hex. */
export function parseAuditorPass(body: string): AuditorPassParse {
  const first = (body.split(/\r?\n/)[0] ?? "").trim();
  if (!/^\/auditor-pass\b/i.test(first)) return { ok: false, error: "not an auditor-pass command" };
  const m = /^\/auditor-pass\s+([A-Za-z])\s+([0-9a-f]{64})\s*$/.exec(first);
  if (!m) return { ok: false, error: "malformed" };
  return { ok: true, command: { label: m[1]!.toUpperCase(), diffSha256: m[2]! } };
}

export type ScopeRefusal = "not-peace-task" | "not-scanner-helper";

/** Issue-label scope (checked in the parse job from the event payload, before anything is read or written). */
export function auditorPassScope(labels: readonly string[]): ScopeRefusal | null {
  if (!labels.includes(TASK_LABEL)) return "not-peace-task";
  if (!labels.includes(SCANNER_HELPER_LABEL)) return "not-scanner-helper";
  return null;
}

export type DiffRefusal =
  | "sha-mismatch" | "not-two-files" | "not-new-file" | "path-not-src" | "path-denied" | "not-module-plus-test" | "unparsable-diff";

const SAFE_PATH = /^src\/(?:[A-Za-z0-9_-][A-Za-z0-9._-]*\/)*[A-Za-z0-9_-][A-Za-z0-9._-]*$/;
type PathRules = Pick<TargetConfig, "sourcePattern" | "testPattern" | "denyPatterns">;

/**
 * Re-checks the candidate's recorded diff bytes: their sha256 equals the posted one, and the diff only ADDS
 * exactly two new regular files under src/: one module and one test (no edit, delete, rename, mode change or
 * binary; nothing outside src/, so no workflow, peaceai/ or package file), each allowed by the target's own
 * source/test/deny patterns. null = accepted.
 */
export function checkHelperDiff(diff: string, postedSha: string, rules?: PathRules): DiffRefusal | null {
  if (!/^[0-9a-f]{64}$/.test(postedSha) || createHash("sha256").update(diff, "utf8").digest("hex") !== postedSha) return "sha-mismatch";
  if (!diff.startsWith("diff --git ")) return "unparsable-diff";
  const parts = diff.split(/^(?=diff --git )/m);
  if (parts.length !== 2) return "not-two-files";
  const paths: string[] = [];
  for (const s of parts) {
    const lines = s.split("\n");
    const m = /^diff --git a\/(\S+) b\/(\S+)$/.exec(lines[0] ?? "");
    if (!m || m[1] !== m[2]) return "unparsable-diff";
    const path = m[1]!;
    // Header up to the first hunk: exactly "new file mode 100644", one "index 0000000..<hex>", "--- /dev/null", "+++ b/<path>".
    const hunk = lines.findIndex((l) => l.startsWith("@@"));
    if (hunk < 0) return "not-new-file";
    const header = lines.slice(1, hunk);
    const index = header.filter((l) => l.startsWith("index "));
    const rest = header.filter((l) => !l.startsWith("index "));
    if (index.length !== 1 || !/^index 0+\.\.[0-9a-f]{7,64}$/.test(index[0]!) || rest.join("\n") !== ["new file mode 100644", "--- /dev/null", `+++ b/${path}`].join("\n"))
      return "not-new-file";
    // A new file's body is additions only (plus hunk headers and the no-newline marker).
    if (lines.slice(hunk + 1).some((l) => l !== "" && !l.startsWith("+") && !l.startsWith("@@ ") && l !== "\\ No newline at end of file"))
      return "not-new-file";
    if (!SAFE_PATH.test(path)) return "path-not-src";
    if (rules && (!new RegExp(rules.sourcePattern).test(path) || rules.denyPatterns.some((d) => new RegExp(d).test(path)))) return "path-denied";
    paths.push(path);
  }
  const testRe = new RegExp(rules?.testPattern ?? "\\.test\\.ts$");
  const tests = paths.filter((p) => testRe.test(p));
  const modules = paths.filter((p) => !testRe.test(p) && p.endsWith(".ts"));
  if (tests.length !== 1 || modules.length !== 1) return "not-module-plus-test";
  return null;
}

export type RecordRefusal = DiffRefusal | "wrong-target" | "not-source-builder" | "unknown-label" | "diff-missing" | "not-scoped";

/** Task-record scope, checked in the record job against Results (the derive run's own record). */
export function taskScopeRefusal(task: { source?: string; target?: string }): RecordRefusal | null {
  // The intake must have recorded source: builder explicitly (an absent field is not enough).
  if (task.source !== "builder") return "not-source-builder";
  if (!task.target || !SCANNER_HELPER_TARGETS.includes(task.target)) return "wrong-target";
  return null;
}

/** Human text for a refusal code (posted on the issue; codes only, never candidate bytes). */
export const REFUSAL_TEXT: Record<RecordRefusal | ScopeRefusal | "malformed", string> = {
  malformed: `Auditor pass not recorded: malformed command. ${AUDITOR_PASS_USAGE}`,
  "not-peace-task": "Auditor pass not recorded: this issue is not a `peace-task`.",
  "not-scanner-helper": "Auditor pass not recorded: this issue is not labelled `scanner-helper`. Only scanner-helper tasks are delegated; Peace's own `/verdict` is required here.",
  "not-scoped": "Auditor pass not recorded: the scope check did not run.",
  "wrong-target": "Auditor pass not recorded: this task's target is not a scanner-helper target (PeaceG03/PeaceSTOCKS).",
  "not-source-builder": "Auditor pass not recorded: the task's intake did not record `source: builder`.",
  "unknown-label": "Auditor pass not recorded: that letter is not a candidate in the latest review.",
  "diff-missing": "Auditor pass not recorded: the candidate's recorded diff is missing.",
  "sha-mismatch": "Auditor pass not recorded: the posted sha256 does not match the candidate's recorded diff.",
  "unparsable-diff": "Auditor pass not recorded: the candidate's diff could not be checked.",
  "not-two-files": "Auditor pass not recorded: the candidate must add exactly two files (one module, one test).",
  "not-new-file": "Auditor pass not recorded: the candidate edits, deletes, renames or re-modes a file; only new files are allowed.",
  "path-not-src": "Auditor pass not recorded: the candidate touches a path outside src/.",
  "path-denied": "Auditor pass not recorded: the candidate touches a path the target denies.",
  "not-module-plus-test": "Auditor pass not recorded: the candidate must be exactly one new module plus one new test file.",
};

export const isRefusalCode = (s: string): s is keyof typeof REFUSAL_TEXT => Object.hasOwn(REFUSAL_TEXT, s);
