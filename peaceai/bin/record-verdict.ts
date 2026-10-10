// Verdict job: append one verdict to the latest attempt of an issue in a Results checkout.
import { appendFileSync, copyFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { effectiveVerdict, stableJson, VERDICT_SCHEMA, withdraws, type VerdictRecord } from "../lib/records.ts";
import { appendIndex, latestAttempt, taskDir, writeNew, writeSummary } from "../lib/store.ts";
import { parseVerdict } from "../lib/verdict.ts";

const out = (pairs: Record<string, string>) => {
  const lines = Object.entries(pairs).map(([k, v]) => `${k}=${v}`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, lines.join("\n") + "\n");
  console.log(lines.filter((l) => !l.startsWith("chosen_diff")).join(" "));
};

const root = resolve(process.env.RESULTS_DIR ?? "");
const issue = Number(process.env.ISSUE_NUMBER);
const commentId = String(process.env.COMMENT_ID ?? "");
const recordedAt = String(process.env.COMMENT_CREATED_AT ?? "");
const parsed = parseVerdict(process.env.COMMENT_BODY ?? "");
if (!parsed.ok || !/^\d{1,20}$/.test(commentId) || !/^\d{4}-\d\d-\d\dT/.test(recordedAt)) {
  out({ status: "malformed" });
  process.exit(0);
}
const attempt = latestAttempt(root, issue);
if (!attempt) {
  out({ status: "no-task" });
  process.exit(0);
}
const { label, verdict } = parsed.command;
const shown = attempt.ranking.presentation.find((p) => p.label === label);
if (label !== null && !shown) {
  out({ status: "unknown-label" });
  process.exit(0);
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
};
// Did this verdict withdraw the standing pick? (Same rule as effectiveVerdict.)
const withdrew = withdraws(record, effectiveVerdict(attempt.verdicts).pick);
const dir = taskDir(root, issue, attempt.task.runId);
writeNew(join(dir, "verdicts", `${commentId}.json`), stableJson(record));
appendIndex(root, { type: "verdict", issue, runId: attempt.task.runId, commentId, at: recordedAt, label, verdict });
writeSummary(root);

let chosen = "";
if (verdict === "right" && shown && process.env.CHOSEN_OUT_DIR) {
  const target = resolve(process.env.CHOSEN_OUT_DIR);
  mkdirSync(target, { recursive: true });
  chosen = join(target, "chosen.diff");
  copyFileSync(join(dir, "candidates", `${shown.id}.diff`), chosen);
}
out({
  status: "recorded", label: label ?? "none", verdict, candidate: shown?.id ?? "", withdrew: String(withdrew),
  test: String(attempt.task.test), base_sha: attempt.task.baseSha, chosen_diff: chosen,
});
