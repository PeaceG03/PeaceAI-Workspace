// M5 target check, run on EVERY task run (select, Job A, Job B, review, verdict PR) through the GitHub API.
// MODE=select: resolve the issue's target; when it is not a confirmed-public, configured target, mark the
//   issue failed with a content-free message and output run=false (nothing is fetched).
// MODE=recheck: TARGET must still be public and configured, else exit 1.
// Prints decisions only; a target name is printed only once it is confirmed public.
import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { STATE } from "../lib/queue.ts";
import { decide, DECISION_MESSAGE, loadTargets, resolveTarget, visibilityOf } from "../lib/target.ts";

const repo = process.env.GITHUB_REPOSITORY ?? "";
const mode = process.env.MODE ?? "recheck";
const force = process.env.PEACEAI_FORCE_VISIBILITY_FAIL === "true";
const gh = (...args: string[]) => execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
const out = (pairs: Record<string, string>) => {
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, Object.entries(pairs).map(([k, v]) => `${k}=${v}`).join("\n") + "\n");
};

const targets = loadTargets();
let labels: string[] = [];
let body = "";
let issue = "";
if (mode === "select") {
  issue = String(process.env.ISSUE_NUMBER ?? "");
  if (!/^\d{1,9}$/.test(issue)) throw new Error("invalid issue number");
  const data = JSON.parse(gh("api", `repos/${repo}/issues/${issue}`));
  labels = (data.labels ?? []).map((l: { name: string }) => l.name);
  body = String(data.body ?? "");
}
const resolution = mode === "select" ? resolveTarget(labels, body, targets.default) : resolveTarget([`target:${process.env.TARGET ?? ""}`], "", targets.default);
let api: unknown = null;
if (resolution.ok && !force) {
  try {
    api = JSON.parse(gh("api", `repos/${resolution.target}`));
  } catch {
    api = null; // not found, no access, rate limit, network: all mean "not confirmed public"
  }
}
const visibility = resolution.ok ? visibilityOf(resolution.target, api, force) : null;
const decision = decide(resolution, visibility, targets);

if (decision.run) {
  out({ run: "true", target: decision.target, is_default: String(decision.isDefault), install: decision.config.install, write_env: decision.config.writeEnvironment ?? "" });
  console.log(`target_check run=true target=${decision.target} default=${decision.isDefault}`);
  process.exit(0);
}
out({ run: "false", target: "", is_default: "false", install: "", write_env: "" });
console.log(`target_check run=false reason=${decision.reason}`);
if (mode === "select") {
  gh("issue", "edit", issue, "--repo", repo, "--add-label", STATE.failed, "--remove-label", STATE.running);
  gh("issue", "comment", issue, "--repo", repo, "--body", DECISION_MESSAGE[decision.reason]);
  process.exit(0);
}
process.exit(1);
