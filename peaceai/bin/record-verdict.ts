// Verdict job: append one verdict to the latest attempt of an issue in a Results checkout.
import { appendFileSync, copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { chosenMetaOf } from "../lib/regrade.ts";
import { join, resolve } from "node:path";
import { effectiveVerdict, stableJson, VERDICT_SCHEMA, withdraws, type VerdictRecord } from "../lib/records.ts";
import { appendIndex, latestAttempt, taskDir, writeNew, writeSummary } from "../lib/store.ts";
import { loadTargets } from "../lib/target.ts";
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
  // M18: what the stale-base regrade request needs to re-submit exactly this candidate.
  const rc = attempt.ranking.candidates.find((c) => c.id === shown.id);
  const meta = rc ? chosenMetaOf(attempt.task, rc) : null;
  if (meta) writeFileSync(join(target, "chosen.json"), JSON.stringify(meta) + "\n");
}
out({
  status: "recorded", label: label ?? "none", verdict, candidate: shown?.id ?? "", withdrew: String(withdrew),
  test: String(attempt.task.test), base_sha: attempt.task.baseSha, chosen_diff: chosen, run_id: attempt.task.runId,
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
