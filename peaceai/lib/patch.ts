// M6: patch-file verdict route. A `right` verdict on a "patch" target posts the chosen candidate as a
// `git format-patch` file in a Workspace issue comment, with the SHA-256 of the patch and of the
// candidate diff. The Builder-side apply script verifies both against Results before `git am`.
import { createHash } from "node:crypto";

export const NOREPLY_NAME = "PeaceG03";
export const NOREPLY_EMAIL = "301894882+PeaceG03@users.noreply.github.com";
export const NOREPLY_FROM = `From: ${NOREPLY_NAME} <${NOREPLY_EMAIL}>`;
export const PATCH_MARKER = "<!-- peaceai-verdict-patch:v1 -->";
/** GitHub's comment body limit is 65536 characters; leave room for the header lines. */
export const MAX_PATCH_CHARS = 60_000;

export const sha256 = (text: string): string => createHash("sha256").update(text, "utf8").digest("hex");

export interface PatchParts {
  /** Header block: mbox separator line through the blank line before the message. */
  header: string[];
  /** The diff exactly as `git diff --full-index` prints it: from the first `diff --git` line to the end. */
  diff: string;
}

/**
 * Splits a single-commit `git format-patch --stdout --no-signature --no-stat` file. Refuses anything
 * else: several commits, a signature, a missing diff, or CRLF line endings (bytes must be exact).
 */
export function splitPatch(patch: string): PatchParts | { error: string } {
  if (patch.includes("\r")) return { error: "patch has CR line endings" };
  const lines = patch.split("\n");
  if (!/^From [0-9a-f]{40} Mon Sep 17 00:00:00 2001$/.test(lines[0] ?? "")) return { error: "not a format-patch file" };
  if (lines.slice(1).some((l) => /^From [0-9a-f]{40} Mon Sep 17 00:00:00 2001$/.test(l))) return { error: "more than one commit" };
  const blank = lines.indexOf("");
  if (blank < 0) return { error: "no header end" };
  const start = lines.findIndex((l) => l.startsWith("diff --git "));
  if (start < 0) return { error: "no diff" };
  if (lines.includes("-- ")) return { error: "patch has a signature" };
  return { header: lines.slice(0, blank), diff: lines.slice(start).join("\n") };
}

/** The From: header must be exactly the noreply identity, and appear exactly once. */
export function authorIsNoreply(header: readonly string[]): boolean {
  const from = header.filter((l) => /^From:/i.test(l));
  return from.length === 1 && from[0] === NOREPLY_FROM;
}

export interface PatchComment {
  candidateId: string;
  runId: string;
  target: string;
  diffSha256: string;
  patchSha256: string;
  patch: string;
}

/** A fence longer than any backtick run in the patch, so the patch cannot close it. */
function fenceFor(text: string): string {
  const longest = Math.max(0, ...[...text.matchAll(/`+/g)].map((m) => m[0].length));
  return "`".repeat(Math.max(3, longest + 1));
}

export function patchCommentBody(c: PatchComment, label: string): string {
  const fence = fenceFor(c.patch);
  return [
    PATCH_MARKER,
    `Verdict recorded: ${label} right. \`${c.target}\` gets no PR from here; the chosen candidate is below as a \`git format-patch\` file.`,
    "",
    `- candidate: \`${c.candidateId}\``,
    `- run: \`${c.runId}\``,
    `- target: \`${c.target}\``,
    `- diff-sha256: \`${c.diffSha256}\``,
    `- patch-sha256: \`${c.patchSha256}\``,
    "",
    "Apply on the Builder box (verifies both hashes against Results and the noreply author, then `git am`; never pushes):",
    "",
    "```",
    "peaceai/bin/apply-verdict-patch.sh <issue> --worktree <PeaceSTOCKS clone>",
    "```",
    "",
    `${fence}patch`,
    c.patch.replace(/\n$/, ""),
    fence,
    "",
  ].join("\n");
}

/** Parses a comment written by patchCommentBody. The patch text is returned with its final newline. */
export function parsePatchComment(body: string): PatchComment | null {
  const text = body.replace(/\r\n/g, "\n");
  if (!text.startsWith(PATCH_MARKER + "\n")) return null;
  const field = (name: string, re: RegExp) => {
    const m = new RegExp(`^- ${name}: \`(${re.source})\`$`, "m").exec(text);
    return m ? m[1]! : null;
  };
  const candidateId = field("candidate", /candidate-\d{1,3}/);
  const runId = field("run", /\d{1,20}/);
  const target = field("target", /[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}/);
  const diffSha256 = field("diff-sha256", /[0-9a-f]{64}/);
  const patchSha256 = field("patch-sha256", /[0-9a-f]{64}/);
  const open = /^(`{3,})patch$/m.exec(text);
  if (!candidateId || !runId || !target || !diffSha256 || !patchSha256 || !open) return null;
  const fence = open[1]!;
  const from = open.index + open[0].length + 1;
  const close = text.indexOf(`\n${fence}\n`, from - 1);
  if (close < from - 1) return null;
  const patch = text.slice(from, close + 1);
  return { candidateId, runId, target, diffSha256, patchSha256, patch };
}

export interface VerifyInput {
  comment: PatchComment;
  /** The candidate diff stored in Results for the verdict's effective pick. */
  resultsDiff: string | null;
  effectivePick: { decided: boolean; candidateId: string | null };
  latestRunId: string | null;
}

/** Every reason the patch must not be applied; empty means it may be applied. */
export function verifyPatch(input: VerifyInput): string[] {
  const reasons: string[] = [];
  const { comment } = input;
  if (sha256(comment.patch) !== comment.patchSha256) reasons.push("patch sha256 does not match the posted value");
  const parts = splitPatch(comment.patch);
  if ("error" in parts) {
    reasons.push(parts.error);
    return reasons;
  }
  if (!authorIsNoreply(parts.header)) reasons.push("From: is not the noreply identity");
  if (input.latestRunId !== comment.runId) reasons.push("patch is not for the latest attempt");
  if (!input.effectivePick.decided || input.effectivePick.candidateId !== comment.candidateId)
    reasons.push("patch candidate is not the verdict's effective pick");
  if (input.resultsDiff === null) reasons.push("no candidate diff in Results");
  else {
    const resultsSha = sha256(input.resultsDiff);
    if (resultsSha !== comment.diffSha256) reasons.push("posted diff sha256 does not match Results");
    if (sha256(parts.diff) !== resultsSha) reasons.push("patch diff sha256 does not match the Results candidate diff");
  }
  return reasons;
}
