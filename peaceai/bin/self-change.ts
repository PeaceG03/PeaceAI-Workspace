// M11: self-change sandbox CLI. Runs on this box (or a private repo's manually started job), never on the public
// Workspace runners. It never edits, pushes or merges the live checkout:
//   propose  --id ID --patch FILE [--base REF] [--out DIR] [--budget MIN]
//            protected-set check -> separate clone at REF -> apply -> run the LIVE suite (test files from REF,
//            unchanged) and any new peaceai/self-tests -> write the record (<out>/self-changes/<id>.json)
//   decide   --record FILE (--pr N | --approvals FILE)  promotion decision (Auditor label + Architect command
//            comment traced by id/URL); prints only. This tool never sets the Auditor label or posts a command.
//   rollback --record FILE --repo DIR            one step: on a NEW branch in DIR, revert the promotion merge
// Exit codes: 0 ok, 2 refused, 3 tests failed / not allowed, 1 usage or error.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  budgetMinutes, checkSelfChangeDiff, listSha, promotionDecision, SELF_SCHEMA, selfChangeAllowedHere, sha256,
  WORKSPACE_REPO, type CommandComment, type LabelEvent, type SelfChangeRecord, type TestRun,
} from "../lib/selfchange.ts";

const argv = process.argv.slice(2);
const mode = argv[0];
const opt = (name: string) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : undefined; };
const NOREPLY = ["-c", "user.name=PeaceG03", "-c", "user.email=301894882+PeaceG03@users.noreply.github.com"];
const git = (cwd: string, ...a: string[]) => execFileSync("git", a, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 1 << 28 }).trim();
const die = (code: number, msg: string): never => { console.log(msg); process.exit(code); };

const here = selfChangeAllowedHere(process.env);
if (!here.ok) die(3, `self-change refused reason=${here.reason}`);

/** The suite runs as a fresh top-level test run (a parent test runner's context would swallow its report). */
function suiteEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, PEACEAI_SELF_SANDBOX: "1" };
  delete env.NODE_TEST_CONTEXT;
  return env;
}

function runSuite(cwd: string, suite: "live" | "new", files: string[], deadline: number): TestRun {
  if (files.length === 0) return { suite, files, filesSha256: listSha(files), exitCode: 0, pass: 0, fail: 0 };
  const left = Math.max(1000, deadline - Date.now());
  const r = spawnSync(join(cwd, "node_modules/.bin/tsx"), ["--test", "--test-reporter=tap", ...files], { cwd, encoding: "utf8", timeout: left, maxBuffer: 1 << 28, env: suiteEnv() });
  const num = (k: string) => Number(new RegExp(`^# ${k} (\\d+)$`, "m").exec(r.stdout ?? "")?.[1] ?? 0);
  return { suite, files, filesSha256: listSha(files), exitCode: r.status ?? 124, pass: num("pass"), fail: num("fail") + (r.status === null ? 1 : 0) };
}

if (mode === "propose") {
  const id = opt("id") ?? "";
  if (!/^sc-[a-z0-9-]{3,48}$/.test(id)) die(1, "usage: --id sc-<name>");
  const patchFile = resolve(opt("patch") ?? "");
  const live = resolve(opt("live") ?? process.cwd());
  const out = resolve(opt("out") ?? "/workspace/self-change-records");
  const deadline = Date.now() + budgetMinutes(opt("budget")) * 60_000;
  const diff = readFileSync(patchFile, "utf8");
  const baseSha = git(live, "rev-parse", `${opt("base") ?? "HEAD"}^{commit}`);
  const liveHead = git(live, "rev-parse", "HEAD");
  const liveStatus = git(live, "status", "--porcelain");
  const liveFiles = git(live, "ls-tree", "-r", "--name-only", baseSha, "peaceai/test/").split("\n").filter((f) => /\.test\.ts$/.test(f));
  const check = checkSelfChangeDiff(diff);
  const rec: SelfChangeRecord = {
    schema: SELF_SCHEMA, id, baseSha, candidateSha: "", diffSha256: sha256(diff), paths: check.paths, check,
    liveSuite: { baseSha, filesSha256: listSha(liveFiles) }, tests: [], status: "refused",
    rollback: { kind: "revert", of: null, command: `peaceai/bin/self-change.ts rollback --record self-changes/${id}.json --repo <clone of main>` },
    createdAt: new Date().toISOString(),
  };
  const write = () => {
    mkdirSync(join(out, "self-changes"), { recursive: true });
    writeFileSync(join(out, "self-changes", `${id}.json`), JSON.stringify(rec, null, 1) + "\n");
  };
  if (!check.ok) {
    write();
    die(2, `self-change propose id=${id} status=refused refusals=${check.refusals.length}\n${check.refusals.map((r) => `  ${r.path}: ${r.reason}`).join("\n")}`);
  }
  // The sandbox: a separate clone at the base commit. The live checkout is only read.
  const box = mkdtempSync(join(tmpdir(), "peaceai-self-"));
  try {
    execFileSync("git", ["clone", "--quiet", "--no-hardlinks", "--no-checkout", live, box], { stdio: "ignore" });
    git(box, "checkout", "--quiet", "--detach", baseSha);
    git(box, "remote", "remove", "origin");
    if (existsSync(join(live, "node_modules"))) symlinkSync(join(live, "node_modules"), join(box, "node_modules"), "dir");
    writeFileSync(join(box, ".self.patch"), diff);
    try { git(box, "apply", "--index", "--whitespace=nowarn", ".self.patch"); } catch { rec.check = { ...check, ok: false, refusals: [{ path: "-", reason: "patch does not apply to the base" }] }; write(); die(2, `self-change propose id=${id} status=refused reason=PATCH_DOES_NOT_APPLY`); }
    rmSync(join(box, ".self.patch"));
    git(box, ...NOREPLY, "commit", "--quiet", "--no-verify", "-m", `self-change ${id} (sandbox)`);
    rec.candidateSha = git(box, "rev-parse", "HEAD");
    // The LIVE suite: exactly the base commit's test files, restored from the base so the candidate cannot alter them.
    git(box, "checkout", baseSha, "--", "peaceai/test");
    const diffTests = git(box, "diff", "--name-only", baseSha, "--", "peaceai/test");
    if (diffTests) die(3, "self-change live suite differs from base");
    rec.tests.push(runSuite(box, "live", liveFiles, deadline));
    const newFiles = git(box, "ls-files", "peaceai/self-tests").split("\n").filter((f) => /\.test\.ts$/.test(f));
    rec.tests.push(runSuite(box, "new", newFiles, deadline));
    rec.status = rec.tests.every((t) => t.exitCode === 0 && t.fail === 0) && rec.tests[0]!.pass > 0 ? "awaiting-review" : "tested-failing";
  } finally {
    rmSync(box, { recursive: true, force: true });
  }
  if (git(live, "rev-parse", "HEAD") !== liveHead || git(live, "status", "--porcelain") !== liveStatus) die(1, "self-change: the live checkout changed during the run (refusing to record)");
  write();
  const t = rec.tests.map((x) => `${x.suite}:pass=${x.pass},fail=${x.fail},exit=${x.exitCode}`).join(" ");
  die(rec.status === "awaiting-review" ? 0 : 3, `self-change propose id=${id} status=${rec.status} base=${baseSha.slice(0, 12)} candidate=${rec.candidateSha.slice(0, 12)} ${t}`);
} else if (mode === "decide") {
  const rec = JSON.parse(readFileSync(resolve(opt("record") ?? ""), "utf8")) as SelfChangeRecord;
  // Approvals come straight from GitHub (--pr N: the PR's label events and comments, each comment with its id
  // and URL), or from a saved copy of that same shape (--approvals FILE, used by tests and the dry run).
  const pr = opt("pr");
  const ap: { labels: LabelEvent[]; comments: CommandComment[] } = pr
    ? (() => {
        if (!/^\d+$/.test(pr)) die(1, "usage: --pr <number>");
        const gh = (path: string) => execFileSync("gh", ["api", "--paginate", "--jq", ".[] | tojson", path], { encoding: "utf8", maxBuffer: 1 << 26 }).split("\n").filter(Boolean).map((l) => JSON.parse(l));
        const events = gh(`repos/${WORKSPACE_REPO}/issues/${pr}/events`) as any[];
        const comments = gh(`repos/${WORKSPACE_REPO}/issues/${pr}/comments`) as any[];
        return {
          labels: events.filter((e) => e.event === "labeled").map((e) => ({ label: e.label?.name, actor: e.actor?.login, createdAt: e.created_at })),
          comments: comments.map((c) => ({ id: c.id, url: c.html_url, body: c.body ?? "", author: c.user?.login, association: c.author_association, createdAt: c.created_at })),
        };
      })()
    : JSON.parse(readFileSync(resolve(opt("approvals") ?? ""), "utf8"));
  const approvers = JSON.parse(readFileSync(resolve(import.meta.dirname, "../self/approvers.json"), "utf8"));
  const live = resolve(opt("live") ?? process.cwd());
  const liveFiles = git(live, "ls-tree", "-r", "--name-only", rec.baseSha, "peaceai/test/").split("\n").filter((f) => /\.test\.ts$/.test(f));
  const d = promotionDecision(rec, liveFiles, ap.labels ?? [], ap.comments ?? [], approvers);
  die(d.ok ? 0 : 2, `self-change decide id=${rec.id} promote=${d.ok}${d.ok ? ` architect=${d.architectComment}` : ` reasons=${d.reasons.join(",")}`}`);
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
