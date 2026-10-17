// peace-task `carry` job (trusted; plain read-only Results clone at RESULTS_DIR, issue read-only, no write token):
// after Job C recorded a regrade attempt, decide whether the owner's original verdict carries (lib/carry.ts).
// Outputs carry=true|false and reason; on true writes the carry comment body to BODY_FILE. Nothing is written.
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { carryComment, checkCarry, declaredRule, freshFromRecord, latestPending, suiteFromRecord } from "../lib/carry.ts";
import { loadApprovedList } from "../lib/approved.ts";
import { specHash } from "../lib/learned.ts";
import { scanText } from "../lib/leak.ts";
import { latestAttempt, taskDir } from "../lib/store.ts";
import { isRepoName } from "../lib/target.ts";

const out = (pairs: Record<string, string>) => {
  const lines = Object.entries(pairs).map(([k, v]) => `${k}=${v}`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, lines.join("\n") + "\n");
  console.log(lines.join(" "));
};
const stop: (reason: string) => never = (reason) => { out({ carry: "false", reason }); process.exit(0); };
const repo = process.env.GITHUB_REPOSITORY ?? "";
const issue = Number(process.env.ISSUE_NUMBER ?? "");
const runId = process.env.RUN_ID ?? "";
if (!/^[\w.-]+\/[\w.-]+$/.test(repo) || !Number.isInteger(issue) || issue < 1 || !/^\d{1,20}$/.test(runId)) stop("carry_bad_inputs");

const r = spawnSync("gh", ["api", "--paginate", `repos/${repo}/issues/${issue}/comments?per_page=100`, "--jq", ".[] | {user: .user.login, body: .body} | tojson"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
if (r.status !== 0) stop("carry_bad_inputs");
const pending = latestPending(r.stdout.split("\n").filter(Boolean).map((l) => JSON.parse(l) as { user: string; body: string }));
if (pending === null) stop("carry_none_pending");

const root = resolve(process.env.RESULTS_DIR ?? "");
const attempt = latestAttempt(root, issue);
// Only the attempt THIS run recorded (a later or earlier attempt never carries a verdict).
if (!attempt || attempt.task.runId !== runId) stop("carry_not_this_run");
const cand = attempt!.ranking.candidates.find((c) => c.id === "candidate-1");
const diffPath = cand ? join(taskDir(root, issue, runId), "candidates", `${cand.id}.diff`) : "";
const diff = diffPath && existsSync(diffPath) ? readFileSync(diffPath, "utf8") : "";
const target = attempt!.task.target ?? "";
const head = attempt!.task.baseSha;

// Facts from an anonymous throwaway clone of the public target: clean apply on the new head, changed files.
let applyCheck = false;
let changedSinceBase: string[] | null = null;
if (typeof pending === "object" && isRepoName(target) && diff) {
  const work = mkdtempSync(join(process.env.RUNNER_TEMP ?? tmpdir(), "carry-target-"));
  const g = (...a: string[]) => spawnSync("git", ["-C", work, ...a], { encoding: "utf8", env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });
  g("init", "-q");
  if (g("fetch", "-q", "--filter=blob:none", `https://github.com/${target}.git`, pending.oldBase, head).status === 0) {
    applyCheck = g("checkout", "-q", "--detach", head).status === 0 &&
      spawnSync("git", ["-C", work, "apply", "--check", "--whitespace=nowarn", "-"], { input: diff, encoding: "utf8" }).status === 0;
    const names = g("diff", "--name-only", "--no-renames", pending.oldBase, head);
    changedSinceBase = names.status === 0 ? names.stdout.split("\n").filter(Boolean) : null;
  }
}
// M71: the grade type comes from main's approved list and main's spec file (this checkout), never the candidate.
const tooling = resolve(import.meta.dirname, "../..");
const list = loadApprovedList(join(tooling, "peaceai/rules/approved.json"));
const specOf = (id: string) => {
  const f = join(tooling, "peaceai/rules/learned", `${id}.json`);
  if (!/^[a-z0-9][a-z0-9.-]{0,79}$/.test(id) || !existsSync(f)) return null;
  try { const spec = JSON.parse(readFileSync(f, "utf8")); return { spec, hash: specHash(spec) }; } catch { return null; }
};
const rule = declaredRule(cand?.operationId, cand?.transformations ?? [], list.ok ? list.list.rules : [], specOf);
const d = checkCarry({ pending, task: attempt!.task, diff, appliedByJobA: cand?.applied === true, applyCheck, changedSinceBase, fresh: freshFromRecord(cand), rule, suite: suiteFromRecord(cand) });
if (!d.carry) stop(d.reason);
const p = pending as Exclude<typeof pending, string | null>;
const body = carryComment({ schema: "peaceai-carry:v1", issue, verdictCommentId: p.verdictCommentId, fromRunId: p.runId, fromCandidate: p.candidateId, runId, label: cand!.label ?? "" }, rule ? rule.grading : undefined);
if (scanText(body).length > 0) stop("carry_leak_scan");
writeFileSync(process.env.BODY_FILE ?? "", body);
out({ carry: "true", reason: "" });
