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
// M106 stage 2 (proposals that may touch protected, never-zone excluded, paths; Auditor's limits 1-5 and the #504
// review). Grading is split so candidate code never shares a process tree, a dependency install or a job with the
// grader or the record (each mode below is its own job in the private workflow; no retry, outputs are write-once):
//   prepare2 --id ID --patch FILE --base SHA [--source URL] [--out DIR]   no candidate code: base must be on main,
//            never-zone closure of the base tree, strict parse + git apply + staged==parsed + check on git's own
//            diff -> <out>/<id>.prep.json + <id>.bundle
//   run2     --prep FILE --bundle FILE --phase suite|new-on-candidate|new-on-base [--source URL] [--out DIR] [--budget MIN]
//            the ONLY candidate-code step: fresh clone + own npm ci, fresh session per run, leftovers killed and
//            counted (= failed) -> <out>/<id>.<phase>.json (raw counts, no verdict)
//   record2  --prep FILE --runs DIR [--out DIR]   no candidate code -> <out>/self-changes/<id>.stage2.json
//   decide2  --id ID --pr N [--repo DIR]   (record downloaded from the ledger's run; --record FILE fixtures only, never lands)   landing decision; flag + approvers read from origin/main, base on
//            main, PR = exactly base..head, check re-run on the real diff, the Results write-once ledger entry for
//            the id names the run that made the record (read with GET only), Auditor `/auditor-pass <id> <sha>` and
//            Peace `/verdict <id> <sha> right`. Prints only; never posts, applies, pushes or merges.
//   credit2  always refuses: no generator run record exists yet (limit 5 needs provenance, a later PR).
// M109 generator (no candidate code runs; writes nothing but the record):
//   generate2 --task-file FILE --base SHA [--repo DIR] [--out FILE]   PeaceAI writes a stage-2 proposal from the task
//            text ONLY plus the base commit's tree (skills run sandboxed: no fs, no child processes, empty env), then
//            the stage-2 check runs on the canonical diff -> a peaceai-self-gen:v1 record (and <out>.patch for a
//            candidate). Exit 0 candidate, 2 refused. Never credit (credit2 still refuses).
//   verify2 --record FILE [--repo DIR]   S2: re-run a generate2 record from its own inputs (task text + base tree) and
//            check it reproduces field for field (createdAt excepted). Exit 0 reproduced, 3 differs. Never credit.
// Exit codes: 0 ok, 2 refused, 3 tests failed / not allowed, 1 usage or error.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { NO_GENERATOR_MARK, PRIVATE_RUNNERS, promotionDecision, selfChangeAllowedHere, STAGE2_FLAG_PATH, STAGE2_LEDGER_DIR, STAGE2_PHASES, stage2LandingDecision, WORKSPACE_REPO, type CommandComment, type SelfChangeRecord, type Stage2LedgerEntry, type Stage2Record, type Stage2RunFacts } from "../lib/selfchange.ts";
import { generateStage2Proposal, verifySelfGenRecord, prepareStage2InSandbox, proposeInSandbox, recordStage2, runStage2InSandbox, stage2PrFacts, suiteFilesAt, type Stage2PhaseRun, type Stage2Prep } from "../lib/selfpropose.ts";

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
} else if (mode === "prepare2" || mode === "run2") {
  const here = selfChangeAllowedHere(process.env);
  if (!here.ok) die(3, `self-change stage2 refused reason=${here.reason}`);
  const source = opt("source") ?? `https://github.com/${WORKSPACE_REPO}.git`;
  const out = resolve(opt("out") ?? join(process.env.RUNNER_TEMP ?? "", "self-change-records"));
  if (mode === "prepare2") {
    const id = opt("id") ?? "";
    if (!/^sc-[a-z0-9-]{3,48}$/.test(id)) die(1, "usage: --id sc-<name>");
    const r = prepareStage2InSandbox({ id, diff: readFileSync(resolve(opt("patch") ?? ""), "utf8"), source, base: opt("base") ?? "", out });
    die(r.code, r.message);
  }
  const r = runStage2InSandbox({ prepFile: resolve(opt("prep") ?? ""), bundle: resolve(opt("bundle") ?? ""), source, phase: opt("phase") ?? "", out, budget: opt("budget") });
  die(r.code, r.message);
} else if (mode === "record2") {
  const prep = JSON.parse(readFileSync(resolve(opt("prep") ?? ""), "utf8")) as Stage2Prep;
  const dir = resolve(opt("runs") ?? "");
  const runs = STAGE2_PHASES.map((ph) => join(dir, `${prep.id}.${ph}.json`)).filter((f) => existsSync(f)).map((f) => JSON.parse(readFileSync(f, "utf8")) as Stage2PhaseRun);
  const rec = recordStage2(prep, runs);
  const file = join(resolve(opt("out") ?? join(process.env.RUNNER_TEMP ?? "", "self-change-records")), "self-changes", `${prep.id}.stage2.json`);
  if (existsSync(file)) die(1, `refusing to overwrite ${file} (a stage-2 failure is final; rerun with a new id)`);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(rec, null, 1) + "\n", { flag: "wx" });
  die(rec.status === "awaiting-review" ? 0 : 3, `self-change stage2 record id=${rec.id} status=${rec.status} phases=${rec.phases.map((p) => `${p.phase}:${p.ran ? "ran" : "missing"}${p.leftovers ? `,leftovers=${p.leftovers}` : ""}`).join(" ")}`);
} else if (mode === "generate2") {
  const base = opt("base") ?? "";
  if (!/^[0-9a-f]{40}$/.test(base) || !opt("task-file")) die(1, "usage: generate2 --task-file FILE --base <40-hex sha> [--repo DIR] [--out FILE]");
  const rec = generateStage2Proposal(resolve(opt("repo") ?? "."), readFileSync(resolve(opt("task-file")!), "utf8"), base);
  const out = opt("out");
  if (out) {
    mkdirSync(dirname(resolve(out)), { recursive: true });
    writeFileSync(resolve(out), JSON.stringify(rec, null, 1) + "\n", { flag: "wx" });
    if (rec.diff) writeFileSync(resolve(out) + ".patch", rec.diff, { flag: "wx" });
  }
  die(rec.status === "candidate" ? 0 : 2, `self-change generate2 status=${rec.status} skill=${rec.skill ?? "-"} base=${base.slice(0, 12)} generator=${rec.generatorSha256.slice(0, 12)} diff=${rec.diffSha256.slice(0, 12) || "-"} reason=${rec.reason}${rec.check && !rec.check.ok ? `\n${rec.check.refusals.map((r) => `  ${r.path}: ${r.reason}`).join("\n")}` : ""}`);
} else if (mode === "verify2") {
  if (!opt("record")) die(1, "usage: verify2 --record FILE [--repo DIR]");
  const rec = JSON.parse(readFileSync(resolve(opt("record")!), "utf8")) as { generator?: string; baseSha?: string; diffSha256?: string; status?: string };
  const bad = verifySelfGenRecord(resolve(opt("repo") ?? "."), rec);
  die(bad.length ? 3 : 0, `self-change verify2 ${bad.length ? `DIFFERS (${bad.join(", ")})` : "reproduced"} generator=${rec.generator ?? "-"} base=${String(rec.baseSha ?? "").slice(0, 12)} status=${rec.status ?? "-"} diff=${String(rec.diffSha256 ?? "").slice(0, 12) || "-"}`);
} else if (mode === "credit2") {
  // Auditor #504 blocker 4: no credit without a recorded generator run (task text only, output hash bound). None exists.
  const rec = JSON.parse(readFileSync(resolve(opt("record") ?? ""), "utf8")) as Stage2Record;
  die(2, `self-change credit2 id=${rec.id} credit=false mark="${NO_GENERATOR_MARK}"`);
} else if (mode === "decide2") {
  if (opt("approvals") !== undefined) die(1, "self-change decide2 refused: --approvals is a fixture-only mode (tests call stage2LandingDecision directly); use --pr N");
  const repo = resolve(opt("repo") ?? process.cwd());
  const pr = opt("pr") ?? "";
  const id = opt("id") ?? "";
  if (!/^\d+$/.test(pr) || !/^sc-[a-z0-9-]{3,48}$/.test(id)) die(1, "usage: decide2 --id sc-<name> --pr <number> [--repo DIR]");
  // R3-4: the record is DOWNLOADED (read-only) from the ledger's run; a local --record is accepted only from the
  // committed test fixtures and such a decision never lands
  const recOpt = opt("record");
  const fixtures = join(repo, "peaceai/test/fixtures") + "/";
  if (recOpt !== undefined && !resolve(recOpt).startsWith(fixtures)) die(1, "self-change decide2 refused: --record is fixtures-only; decide2 downloads the record artifact from the ledger's run");
  const origin = spawnSync("git", ["remote", "get-url", "origin"], { cwd: repo, encoding: "utf8" }).stdout.trim().replace(/\.git$/, "");
  if (!origin.endsWith(`github.com/${WORKSPACE_REPO}`)) die(1, `self-change decide2 refused: --repo origin must be ${WORKSPACE_REPO}`);
  const MAIN = "refs/peaceai/decide2-main";
  git(repo, "fetch", "--quiet", "--no-tags", "origin", `+refs/heads/main:${MAIN}`, `+refs/pull/${pr}/head:refs/peaceai/decide2-pr`);
  const gh = (path: string, jq = ".[] | tojson") => execFileSync("gh", ["api", "--paginate", "--jq", jq, path], { encoding: "utf8", maxBuffer: 1 << 26 }).split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const headSha = execFileSync("gh", ["api", `repos/${WORKSPACE_REPO}/pulls/${pr}`, "--jq", ".head.sha"], { encoding: "utf8" }).trim();
  const comments = (gh(`repos/${WORKSPACE_REPO}/issues/${pr}/comments`) as any[]).map((c) => ({ id: c.id, url: c.html_url, body: c.body ?? "", author: c.user?.login, association: c.author_association, createdAt: c.created_at })) as CommandComment[];
  const prCommits = (gh(`repos/${WORKSPACE_REPO}/pulls/${pr}/commits`) as any[]).map((c) => String(c.sha));
  // flag and approvers from MAIN (never from the PR, the proposal or this checkout's working tree)
  const atMain = (p: string) => { const r = spawnSync("git", ["show", `${MAIN}:${p}`], { cwd: repo, encoding: "utf8" }); return r.status === 0 ? r.stdout : null; };
  const approvers = JSON.parse(atMain("peaceai/self/approvers.json") ?? "{}");
  // round 2 B4 + R3-5: the write-once Results ledger entry for this id, the commits that ever touched it, and every
  // self-change-stage2 run for this id (the runs list survives a force-push of Results main). GETs only.
  const RESULTS = PRIVATE_RUNNERS[0];
  const ledgerPath = `${STAGE2_LEDGER_DIR}/${id}.json`;
  const getRaw = (path: string) => { const r = spawnSync("gh", ["api", "-H", "Accept: application/vnd.github.raw", path], { encoding: "utf8", maxBuffer: 1 << 26 }); return r.status === 0 ? r.stdout : null; };
  let entry: Stage2LedgerEntry | null = null;
  try { const t = getRaw(`repos/${RESULTS}/contents/${ledgerPath}`); entry = t ? JSON.parse(t) : null; } catch { entry = null; }
  let commits = 0;
  try { commits = gh(`repos/${RESULTS}/commits?path=${encodeURIComponent(ledgerPath)}&per_page=100`).length; } catch { commits = 0; }
  let runs: Stage2RunFacts[] = [];
  try {
    runs = (gh(`repos/${RESULTS}/actions/workflows/self-change-stage2.yml/runs?per_page=100`, ".workflow_runs[] | tojson") as any[])
      .filter((r) => r.display_title === `self-change-stage2 ${id}`)
      .map((r) => ({ id: String(r.id), attempt: Number(r.run_attempt), path: String(r.path ?? ""), event: String(r.event ?? ""), headBranch: String(r.head_branch ?? ""), headSha: String(r.head_sha ?? "") }));
  } catch { runs = []; }
  // round 4 provenance of the ONE run: its workflow file's blob at the run's head_sha, and its record job's conclusion
  const one = runs.length === 1 ? runs[0]! : null;
  if (one && /^\d+$/.test(one.id) && /^[0-9a-f]{40}$/.test(one.headSha ?? "")) {
    try { one.workflowBlob = execFileSync("gh", ["api", `repos/${RESULTS}/contents/${one.path.replace(/@.*$/, "")}?ref=${one.headSha}`, "--jq", ".sha"], { encoding: "utf8" }).trim() || null; } catch { one.workflowBlob = null; }
    try { one.recordJob = (gh(`repos/${RESULTS}/actions/runs/${one.id}/attempts/1/jobs?per_page=100`, ".jobs[] | tojson") as any[]).filter((j) => j.name === "record").map((j) => String(j.conclusion ?? "")).join(",") || null; } catch { one.recordJob = null; }
  }
  // the reviewed template: peaceai/results-repo/self-change-stage2.yml on Workspace main (never the PR's copy)
  const tpl = spawnSync("git", ["rev-parse", "--verify", "--quiet", `${MAIN}:peaceai/results-repo/self-change-stage2.yml`], { cwd: repo, encoding: "utf8" });
  const templateBlob = tpl.status === 0 ? tpl.stdout.trim() : null;
  // the record: from the ledger run's own artifact (read-only download), never from a hand-supplied file
  let rec: Stage2Record | null = null;
  let recordSource: "artifact" | "fixture" | "none" = "none";
  if (recOpt !== undefined) { rec = JSON.parse(readFileSync(resolve(recOpt), "utf8")) as Stage2Record; recordSource = "fixture"; }
  else if (entry && /^\d+$/.test(String(entry.runId))) {
    const dir = mkdtempSync(join(tmpdir(), "peaceai-decide2-"));
    try {
      const r = spawnSync("gh", ["run", "download", String(entry.runId), "-R", RESULTS, "-n", `self-change-stage2-${id}`, "-D", dir], { encoding: "utf8" });
      const f = join(dir, `${id}.stage2.json`);
      if (r.status === 0 && existsSync(f)) { rec = JSON.parse(readFileSync(f, "utf8")) as Stage2Record; recordSource = "artifact"; }
    } catch { rec = null; } finally { rmSync(dir, { recursive: true, force: true }); }
  }
  if (!rec || rec.id !== id) die(2, `self-change decide2 id=${id} land=false reasons=RECORD_NOT_FROM_LEDGER_RUN_ARTIFACT`);
  const r2 = rec!;
  const facts = stage2PrFacts(repo, r2, headSha, prCommits, MAIN, { entry, commits, runs, recordSource, templateBlob });
  const d = stage2LandingDecision(r2, suiteFilesAt(repo, r2.baseSha), facts, comments, { auditor: approvers.auditor ?? [], peace: approvers.peace ?? [] }, atMain(STAGE2_FLAG_PATH));
  die(d.ok ? 0 : 2, `self-change decide2 id=${r2.id} land=${d.ok}${d.ok ? ` auditor=${d.auditorComment} peace=${d.architectComment}` : ` reasons=${d.reasons.join(",")}`}`);
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
} else die(1, "usage: self-change.ts propose|decide|rollback|prepare2|run2|record2|decide2|credit2|generate2|verify2");
