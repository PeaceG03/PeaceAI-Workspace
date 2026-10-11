// M11: self-change sandbox CLI. Never on the public Workspace runners; it never edits, pushes or merges anything:
//   propose  --id ID --patch FILE [--source URL] [--base REF] [--out DIR] [--budget MIN]
//            ONLY in an ephemeral GitHub-hosted job of a private repo (Results or core), started manually or by
//            a proposal, no credentials in env. No box or local mode. Protected-set check -> FRESH clone at REF -> apply
//            -> run the LIVE suite (test files from REF, unchanged) and any new peaceai/self-tests -> write the
//            record and a bundle of the exact candidate commit (<out>/self-changes/<id>.{json,bundle})
//   decide   --record FILE (--pr N | --approvals FILE)  promotion decision: `/auditor-pass <id> <sha>` then
//            `/promote-self-change <id> <sha>`, both traced by comment id/URL, both SHAs = PR head = tested
//            candidate. Prints only; this tool never posts either comment.
//   rollback --record FILE --repo DIR            one step: on a NEW branch in DIR, revert the promotion merge
// Exit codes: 0 ok, 2 refused, 3 tests failed / not allowed, 1 usage or error.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { PRIVATE_RUNNERS, promotionDecision, selfChangeAllowedHere, WORKSPACE_REPO, type CommandComment, type SelfChangeRecord } from "../lib/selfchange.ts";
import { proposeInSandbox } from "../lib/selfpropose.ts";

const argv = process.argv.slice(2);
const mode = argv[0];
const opt = (name: string) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : undefined; };
const NOREPLY = ["-c", "user.name=PeaceG03", "-c", "user.email=301894882+PeaceG03@users.noreply.github.com"];
const git = (cwd: string, ...a: string[]) => execFileSync("git", a, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 1 << 28 }).trim();
const die = (code: number, msg: string): never => { console.log(msg); process.exit(code); };

// decide and rollback run no candidate code, but still never on the public Workspace runners.
if (process.env.GITHUB_ACTIONS === "true" && !(PRIVATE_RUNNERS as readonly string[]).includes(process.env.GITHUB_REPOSITORY ?? "")) die(3, "self-change refused reason=PUBLIC_RUNNER_REFUSED");

if (mode === "propose") {
  // Runs new or changed code: only in an ephemeral private Actions job (checked here and again in proposeInSandbox).
  const here = selfChangeAllowedHere(process.env);
  if (!here.ok) die(3, `self-change refused reason=${here.reason}`);
  const id = opt("id") ?? "";
  if (!/^sc-[a-z0-9-]{3,48}$/.test(id)) die(1, "usage: --id sc-<name>");
  const r = proposeInSandbox({
    id, diff: readFileSync(resolve(opt("patch") ?? ""), "utf8"), source: opt("source") ?? `https://github.com/${WORKSPACE_REPO}.git`,
    base: opt("base") ?? "origin/main", out: resolve(opt("out") ?? join(process.env.RUNNER_TEMP ?? "", "self-change-records")), budget: opt("budget"),
    nodeModules: existsSync(join(process.cwd(), "node_modules")) ? join(process.cwd(), "node_modules") : undefined,
  });
  die(r.code, r.message);
} else if (mode === "decide") {
  const rec = JSON.parse(readFileSync(resolve(opt("record") ?? ""), "utf8")) as SelfChangeRecord;
  // Approvals come straight from GitHub (--pr N: the PR's current head SHA and its comments, each with id and URL),
  // or from a saved copy of that same shape (--approvals FILE: { headSha, comments }, for tests).
  const pr = opt("pr");
  let ap: { headSha: string; comments: CommandComment[] };
  if (pr) {
    if (!/^\d+$/.test(pr)) die(1, "usage: --pr <number>");
    const gh = (path: string) => execFileSync("gh", ["api", "--paginate", "--jq", ".[] | tojson", path], { encoding: "utf8", maxBuffer: 1 << 26 }).split("\n").filter(Boolean).map((l) => JSON.parse(l));
    const headSha = execFileSync("gh", ["api", `repos/${WORKSPACE_REPO}/pulls/${pr}`, "--jq", ".head.sha"], { encoding: "utf8" }).trim();
    const comments = gh(`repos/${WORKSPACE_REPO}/issues/${pr}/comments`) as any[];
    ap = { headSha, comments: comments.map((c) => ({ id: c.id, url: c.html_url, body: c.body ?? "", author: c.user?.login, association: c.author_association, createdAt: c.created_at })) };
  } else ap = JSON.parse(readFileSync(resolve(opt("approvals") ?? ""), "utf8"));
  const approvers = JSON.parse(readFileSync(resolve(import.meta.dirname, "../self/approvers.json"), "utf8"));
  const liveRepo = resolve(opt("live") ?? process.cwd());
  const liveFiles = execFileSync("git", ["ls-tree", "-r", "--name-only", rec.baseSha, "peaceai/test/"], { cwd: liveRepo, encoding: "utf8" }).split("\n").filter((f) => /\.test\.ts$/.test(f));
  const d = promotionDecision(rec, liveFiles, ap.headSha ?? "", ap.comments ?? [], approvers);
  die(d.ok ? 0 : 2, `self-change decide id=${rec.id} promote=${d.ok}${d.ok ? ` auditor=${d.auditorComment} architect=${d.architectComment}` : ` reasons=${d.reasons.join(",")}`}`);
} else if (mode === "rollback") {
  const recPath = resolve(opt("record") ?? "");
  const rec = JSON.parse(readFileSync(recPath, "utf8")) as SelfChangeRecord;
  const repo = resolve(opt("repo") ?? "");
  const of = rec.promotion?.mergeSha ?? rec.rollback.of;
  if (rec.status !== "promoted" || !of || !/^[0-9a-f]{40}$/.test(of)) die(2, `self-change rollback id=${rec.id} refused reason=NOT_PROMOTED`);
  const branch = `peaceai-self-rollback/${rec.id}`;
  git(repo, "checkout", "--quiet", "-b", branch);
  git(repo, ...NOREPLY, "revert", "--no-edit", of!);
  // The rollback restores every touched path to its content before the promotion.
  const bad = rec.paths.filter((p) => {
    const before = spawnSync("git", ["show", `${of}^:${p}`], { cwd: repo, encoding: "utf8" });
    const now = existsSync(join(repo, p)) ? readFileSync(join(repo, p), "utf8") : null;
    return (before.status === 0 ? before.stdout : null) !== now;
  });
  if (bad.length) die(3, `self-change rollback id=${rec.id} INCOMPLETE paths=${bad.length}`);
  die(0, `self-change rollback id=${rec.id} branch=${branch} reverts=${of!.slice(0, 12)} head=${git(repo, "rev-parse", "HEAD").slice(0, 12)} (open it as a normal PR)`);
} else die(1, "usage: self-change.ts propose|decide|rollback");
