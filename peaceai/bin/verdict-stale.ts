// M18 verdict job (patch route): is the task base still the target's head? If not, write the regrade
// request comment (lib/regrade.ts) instead of building a patch on the old base. Fails closed.
// Carry-forward (lib/carry.ts): the original verdict is kept on the new head (stale=carry) only when the hash,
// clean apply, untouched-files and fresh-COUNTS checks ALL pass; anything else falls through to the regrade request.
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { scanText } from "../lib/leak.ts";
import { carryForward } from "../lib/carry.ts";
import { regradeComment, validChosenMeta } from "../lib/regrade.ts";
import { isRepoName } from "../lib/target.ts";

const out = (pairs: Record<string, string>) => {
  const lines = Object.entries(pairs).map(([k, v]) => `${k}=${v}`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, lines.join("\n") + "\n");
  console.log(lines.join(" "));
};
const target = process.env.TARGET ?? "";
const base = process.env.BASE_SHA ?? "";
const dir = process.env.CHOSEN_DIR ?? "";
if (!isRepoName(target) || !/^[0-9a-f]{40}$/.test(base)) { out({ stale: "error", reason: "bad-inputs" }); process.exit(0); }
const ls = spawnSync("git", ["ls-remote", `https://github.com/${target}.git`, "HEAD"], { encoding: "utf8", env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });
const head = /^([0-9a-f]{40})\tHEAD$/m.exec(ls.stdout ?? "")?.[1] ?? "";
if (ls.status !== 0 || !head) { out({ stale: "error", reason: "head-unknown" }); process.exit(0); }
if (head === base) { out({ stale: "false", head }); process.exit(0); }
const metaFile = join(dir, "chosen.json");
const meta = existsSync(metaFile) ? JSON.parse(readFileSync(metaFile, "utf8")) : null;
if (!validChosenMeta(meta) || meta.baseSha !== base) { out({ stale: "true", head, ok: "false", reason: "chosen-meta-missing" }); process.exit(0); }
const diff = readFileSync(join(dir, "chosen.diff"), "utf8");
const freshFile = join(dir, "fresh-grade.json");
if (existsSync(freshFile)) {
  let fresh: unknown = null;
  try { fresh = JSON.parse(readFileSync(freshFile, "utf8")); } catch { fresh = null; }
  const gradedDiffSha256 = fresh && typeof fresh === "object" && typeof (fresh as { diffSha256?: unknown }).diffSha256 === "string" ? (fresh as { diffSha256: string }).diffSha256 : "";
  // Facts from a throwaway clone of the target: clean apply on the new head, files changed since the old base.
  const work = join(process.env.RUNNER_TEMP ?? "/tmp", "carry-target");
  const g = (...a: string[]) => spawnSync("git", a, { encoding: "utf8", env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });
  g("init", "-q", work);
  const fetched = g("-C", work, "fetch", "-q", "--filter=blob:none", `https://github.com/${target}.git`, base, head).status === 0;
  const co = fetched && g("-C", work, "checkout", "-q", "--detach", head).status === 0;
  const appliesCleanly = co && spawnSync("git", ["-C", work, "apply", "--check", "--whitespace=nowarn", "-"], { input: diff, encoding: "utf8" }).status === 0;
  const names = fetched ? g("-C", work, "diff", "--name-only", base, head) : null;
  const changedSinceBase = names && names.status === 0 ? names.stdout.split("\n").filter(Boolean) : null;
  const d = changedSinceBase ? carryForward({ meta, newHead: head, diff, gradedDiffSha256, appliesCleanly, changedSinceBase, fresh }) : { carry: false as const, reason: "carry_bad_inputs" };
  if (d.carry) { out({ stale: "carry", head, ok: "true" }); process.exit(0); }
  console.log(`carry-forward refused: ${d.reason}`);
}
const body = regradeComment(meta, head, diff);
if (!body) { out({ stale: "true", head, ok: "false", reason: "regrade-request-too-large" }); process.exit(0); }
if (scanText(body).length > 0) { out({ stale: "true", head, ok: "false", reason: "personal-info-in-regrade-request" }); process.exit(0); }
writeFileSync(process.env.BODY_FILE ?? "", body);
out({ stale: "true", head, ok: "true" });
