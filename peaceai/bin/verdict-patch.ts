// M6 verdict job: turn the chosen candidate's format-patch into the issue comment body. Fails closed
// (no comment body) unless the patch is one noreply commit whose diff is byte-identical to the chosen
// candidate diff from Results, fits in a comment, and carries no personal info or secrets.
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { scanText } from "../lib/leak.ts";
import { authorIsNoreply, MAX_PATCH_CHARS, patchCommentBody, sha256, splitPatch } from "../lib/patch.ts";
import { isRepoName } from "../lib/target.ts";

const out = (pairs: Record<string, string>) => {
  const lines = Object.entries(pairs).map(([k, v]) => `${k}=${v}`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, lines.join("\n") + "\n");
  console.log(lines.join(" "));
};
const fail = (reason: string) => {
  out({ ok: "false", reason });
  process.exit(0);
};

const patch = readFileSync(process.env.PATCH_FILE ?? "", "utf8");
const chosen = readFileSync(process.env.CHOSEN_DIFF ?? "", "utf8");
const candidateId = process.env.CANDIDATE ?? "";
const runId = process.env.RUN_ID ?? "";
const target = process.env.TARGET ?? "";
const label = process.env.LABEL ?? "";
if (!/^candidate-\d{1,3}$/.test(candidateId) || !/^\d{1,20}$/.test(runId) || !isRepoName(target) || !/^[A-Z]$/.test(label))
  fail("bad-inputs");
const parts = splitPatch(patch);
if ("error" in parts) fail("not-a-single-commit-patch");
else {
  if (!authorIsNoreply(parts.header)) fail("author-not-noreply");
  if (parts.diff !== chosen) fail("patch-diff-differs-from-candidate");
  if (patch.length > MAX_PATCH_CHARS) fail("patch-too-large-for-a-comment");
  if (scanText(patch).length > 0) fail("personal-info-in-patch");
  const body = patchCommentBody(
    { candidateId, runId, target, diffSha256: sha256(chosen), patchSha256: sha256(patch), patch },
    label,
  );
  writeFileSync(process.env.BODY_FILE ?? "", body);
  out({ ok: "true", diff_sha256: sha256(chosen), patch_sha256: sha256(patch) });
}
