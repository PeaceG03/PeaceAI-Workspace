// Verdict job: append one verdict to the latest attempt of an issue in a Results checkout.
import { appendFileSync, copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { chosenMetaOf } from "../lib/regrade.ts";
import { join, resolve } from "node:path";
import { effectiveVerdict, stableJson, VERDICT_SCHEMA, withdraws, type VerdictRecord } from "../lib/records.ts";
import { appendIndex, latestAttempt, taskDir, writeNew, writeSummary } from "../lib/store.ts";
import { loadTargets } from "../lib/target.ts";
import { parseVerdict, type VerdictCommand } from "../lib/verdict.ts";
import {
  AUDITOR_PASS_SOURCE, checkDiffFor, delegatedByFor, isAuditorPassClass, parseAuditorPass, REFUSAL_TEXT, taskScopeRefusal, type RecordRefusal,
} from "../lib/auditor-pass.ts";
import { existsSync } from "node:fs";

const out = (pairs: Record<string, string>) => {
  const lines = Object.entries(pairs).map(([k, v]) => `${k}=${v}`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, lines.join("\n") + "\n");
  console.log(lines.filter((l) => !l.startsWith("chosen_diff")).join(" "));
};

/** Auditor pass refused: nothing is written; the respond job posts the one-line reason. */
function refuse(reason: RecordRefusal): never {
  out({ status: "auditor-pass-refused", reason, refusal: REFUSAL_TEXT[reason] });
  process.exit(0);
}

const root = resolve(process.env.RESULTS_DIR ?? "");
const issue = Number(process.env.ISSUE_NUMBER);
const commentId = String(process.env.COMMENT_ID ?? "");
const recordedAt = String(process.env.COMMENT_CREATED_AT ?? "");
// Two commands reach this recorder: the owner's `/verdict` (default) and, for scanner-helper and scanner-wiring tasks only,
// Auditor's `/auditor-pass <letter> <diff sha256>` (VERDICT_KIND=auditor-pass; lib/auditor-pass.ts).
const auditorPass = process.env.VERDICT_KIND === "auditor-pass";
const body = process.env.COMMENT_BODY ?? "";
let command: VerdictCommand | null = null;
let postedSha = "";
if (auditorPass) {
  const ap = parseAuditorPass(body);
  if (ap.ok) { command = { label: ap.command.label, verdict: "right" }; postedSha = ap.command.diffSha256; }
} else {
  const v = parseVerdict(body);
  if (v.ok) command = v.command;
}
if (!command || !/^\d{1,20}$/.test(commentId) || !/^\d{4}-\d\d-\d\dT/.test(recordedAt)) {
  out({ status: "malformed" });
  process.exit(0);
}
// The parse job checked the issue labels; it hands over its scope result, and nothing else stands in for it.
const apClass = process.env.AUDITOR_PASS_SCOPE;
if (auditorPass && !isAuditorPassClass(apClass)) {
  refuse("not-scoped");
}
const delegatedBy = auditorPass && isAuditorPassClass(apClass) ? delegatedByFor(apClass) : null;
const attempt = latestAttempt(root, issue);
if (!attempt) {
  out({ status: "no-task" });
  process.exit(0);
}
// Carry-forward (lib/carry.ts): a carried verdict applies only to the attempt it was checked against.
const expectRun = process.env.EXPECT_RUN_ID ?? "";
if (expectRun && attempt.task.runId !== expectRun) {
  out({ status: "carry-stale" });
  process.exit(0);
}
const { label, verdict } = command;
const shown = attempt.ranking.presentation.find((p) => p.label === label);
if (label !== null && !shown) {
  if (auditorPass) refuse("unknown-label");
  out({ status: "unknown-label" });
  process.exit(0);
}
if (auditorPass) {
  // Fail closed before anything is written: the derive run's own record must be a source: builder task on a
  // scanner-helper target, and the candidate's recorded diff must hash to the posted sha and only add one new
  // module plus one new test under src/ that the target allows.
  const scope = taskScopeRefusal(attempt.task);
  const diffPath = join(taskDir(root, issue, attempt.task.runId), "candidates", `${shown!.id}.diff`);
  const rules = loadTargets().targets[attempt.task.target ?? ""];
  const reason = scope
    ?? (!existsSync(diffPath) || !rules ? "diff-missing" : checkDiffFor(apClass as Parameters<typeof checkDiffFor>[0], readFileSync(diffPath, "utf8"), postedSha, rules));
  if (reason) refuse(reason);
}
const record: VerdictRecord = {
  schema: VERDICT_SCHEMA,
  issue,
  runId: attempt.task.runId,
  commentId,
  recordedAt,
  label,
  candidateId: shown?.id ?? null,
  verdict,
  // Recorded as what it is: a delegated pass, never disguised as the owner's own verdict.
  ...(delegatedBy ? { source: AUDITOR_PASS_SOURCE, delegatedBy, diffSha256: postedSha } : {}),
};
// Did this verdict withdraw the standing pick? (Same rule as effectiveVerdict.)
const withdrew = withdraws(record, effectiveVerdict(attempt.verdicts).pick);
const dir = taskDir(root, issue, attempt.task.runId);
writeNew(join(dir, "verdicts", `${commentId}.json`), stableJson(record));
appendIndex(root, {
  type: "verdict", issue, runId: attempt.task.runId, commentId, at: recordedAt, label, verdict,
  ...(delegatedBy ? { source: AUDITOR_PASS_SOURCE, delegatedBy } : {}),
});
writeSummary(root);

let chosen = "";
if (verdict === "right" && shown && process.env.CHOSEN_OUT_DIR) {
  const target = resolve(process.env.CHOSEN_OUT_DIR);
  mkdirSync(target, { recursive: true });
  chosen = join(target, "chosen.diff");
  copyFileSync(join(dir, "candidates", `${shown.id}.diff`), chosen);
  // M18: what the stale-base regrade request needs to re-submit exactly this candidate.
  const rc = attempt.ranking.candidates.find((c) => c.id === shown.id);
  const meta = rc ? chosenMetaOf(attempt.task, rc) : null;
  if (meta) writeFileSync(join(target, "chosen.json"), JSON.stringify(meta) + "\n");
}
const diffSha256 = chosen ? createHash("sha256").update(readFileSync(chosen)).digest("hex") : "";
// Belt and braces: the bytes handed to the PR job are the bytes Auditor's sha names.
if (auditorPass && diffSha256 !== postedSha) throw new Error("auditor-pass: chosen diff does not match the posted sha");
out({
  status: "recorded", label: label ?? "none", verdict, candidate: shown?.id ?? "", withdrew: String(withdrew),
  source: auditorPass ? AUDITOR_PASS_SOURCE : "owner", delegated_by: delegatedBy ?? "",
  test: String(attempt.task.test), base_sha: attempt.task.baseSha, chosen_diff: chosen, diff_sha256: diffSha256, run_id: attempt.task.runId,
  ...targetOutputs(attempt.task.target),
});

/** M5: where a chosen PR goes. Workspace (default or older records) or a configured external target. */
function targetOutputs(target: string | undefined): Record<string, string> {
  const targets = loadTargets();
  if (!target || target === targets.default) return { target: targets.default, external: "false", write_env: "", route: "pr" };
  const config = targets.targets[target];
  // A recorded target without a config (or write environment) gets no PR; the respond job says so.
  // M6: a "patch" route target gets a format-patch comment instead and never needs a write token.
  return { target, external: "true", write_env: config?.writeEnvironment ?? "", route: config?.verdictRoute ?? "pr" };
}
