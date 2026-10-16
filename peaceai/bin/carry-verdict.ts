// peace-verdict parse job, workflow_dispatch (carry) only: re-validate the carry comment against the owner's
// own original /verdict comment and the pending carry on the issue (lib/carry.ts). Reads the issue only.
// Outputs ok, issue, body ("/verdict <label> right" for the new attempt), comment_id, created_at, expect_run.
import { spawnSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { validateCarryDispatch, type GhComment } from "../lib/carry.ts";

const out = (pairs: Record<string, string>) => {
  const lines = Object.entries(pairs).map(([k, v]) => `${k}<<EOF_CARRY\n${v}\nEOF_CARRY`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, lines.join("\n") + "\n");
  console.log(Object.entries(pairs).map(([k, v]) => `${k}=${v}`).join(" "));
};
const repo = process.env.GITHUB_REPOSITORY ?? "";
const id = process.env.CARRY_COMMENT_ID ?? "";
if (!/^[\w.-]+\/[\w.-]+$/.test(repo) || !/^\d{1,20}$/.test(id)) { out({ ok: "false", reason: "carry_bad_inputs" }); process.exit(0); }
const api = (path: string) => { const r = spawnSync("gh", ["api", path], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }); return r.status === 0 ? JSON.parse(r.stdout) : null; };
const toC = (c: { id: number; user?: { login?: string }; body?: string; issue_url?: string; created_at?: string } | null): GhComment | null =>
  c ? { id: String(c.id), user: c.user?.login ?? "", body: c.body ?? "", issue: Number(/\/issues\/(\d+)$/.exec(c.issue_url ?? "")?.[1] ?? 0), createdAt: c.created_at ?? "" } : null;
const carry = toC(api(`repos/${repo}/issues/comments/${id}`));
const vid = /"verdictCommentId":"(\d{1,20})"/.exec(carry?.body ?? "")?.[1];
const verdict = vid ? toC(api(`repos/${repo}/issues/comments/${vid}`)) : null;
let all: { user: string; body: string }[] = [];
if (carry && carry.issue > 0) {
  const r = spawnSync("gh", ["api", "--paginate", `repos/${repo}/issues/${carry.issue}/comments?per_page=100`, "--jq", ".[] | {user: .user.login, body: .body} | tojson"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (r.status === 0) all = r.stdout.split("\n").filter(Boolean).map((l) => JSON.parse(l));
}
const v = validateCarryDispatch(carry, verdict, all);
if (!v.ok) { out({ ok: "false", reason: v.reason }); process.exit(0); }
out({ ok: "true", issue: String(v.issue), body: v.body, comment_id: v.commentId, created_at: v.createdAt, expect_run: v.expectRun });
