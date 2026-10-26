// M108 (Auditor's #504 PASS-note follow-up): run the REAL decide2 collection code in peaceai/bin/self-change.ts
// (the part that calls gh: PR head + comments + commits, the Results ledger read, the ledger's commit history, the
// self-change-stage2 runs list, the run's workflow blob at its head_sha, its jobs list, and the artifact download)
// against a stubbed `gh` placed first on PATH that serves fixture JSON. The landing reasons below are therefore
// produced end to end from gh-shaped data, not from hand-built Stage2PrFacts. Test-only: no engine edit.
// The fake origin is a local bare repo whose path ends in github.com/PeaceG03/PeaceAI-Workspace, so decide2's own
// origin check and `git fetch origin main + refs/pull/N/head` run unchanged. The stage-2 flag is ON only in that
// throwaway origin; the committed flag stays off (m106 checks it).
import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  checkStage2Proposal, listSha, STAGE2_COUNTS_TRUST, STAGE2_DIFF_ARGS, STAGE2_LEDGER_DIR, STAGE2_PHASES, STAGE2_SCHEMA, stage2DiffSha,
  type Stage2Record,
} from "../lib/selfchange.ts";
import { neverZoneAtSha, suiteFilesAt } from "../lib/selfpropose.ts";

const root = resolve(import.meta.dirname, "../..");
const ID = "sc-ghstub";
const PR = "7";
const RESULTS = "PeaceG03/PeaceAI-Results";
const RUN = "4242";
const WF = ".github/workflows/self-change-stage2.yml";

const tmp = mkdtempSync(join(tmpdir(), "m108-decide2-"));
test.after(() => rmSync(tmp, { recursive: true, force: true }));
// Auditor #507 note: a MINIMAL env (no ...process.env), so a real GH_TOKEN / GITHUB_* never reaches decide2 or the stub.
const env0: NodeJS.ProcessEnv = { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR ?? tmpdir(), GIT_CONFIG_NOSYSTEM: "1", GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "1+t@users.noreply.github.com", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "1+t@users.noreply.github.com" };
for (const k of Object.keys(env0)) if (env0[k] === undefined) delete env0[k]; // GITHUB_ACTIONS is never copied: decide2 refuses on public Actions runners
const git = (cwd: string, ...a: string[]) => { const r = spawnSync("git", a, { cwd, encoding: "utf8", env: env0 }); assert.equal(r.status, 0, `git ${a.join(" ")}: ${r.stderr}`); return r.stdout.trim(); };
const put = (dir: string, p: string, s: string) => { mkdirSync(join(dir, p, ".."), { recursive: true }); writeFileSync(join(dir, p), s); };

// ---- the fake origin (bare) and a work clone: base on main, the proposal one commit on top as refs/pull/7/head
const origin = join(tmp, "github.com", "PeaceG03", "PeaceAI-Workspace");
mkdirSync(origin, { recursive: true });
git(origin, "init", "-q", "--bare", "-b", "main");
const work = join(tmp, "work");
mkdirSync(work);
git(work, "init", "-q", "-b", "main");
git(work, "remote", "add", "origin", origin);
put(work, "peaceai/self/approvers.json", JSON.stringify({ schema: "peaceai-self-approvers:v1", auditor: ["PeaceG03"], architect: ["PeaceG03"], peace: ["PeaceG03"] }));
put(work, "peaceai/self/stage2.json", JSON.stringify({ schema: "peaceai-self-stage2:v1", enabled: true }));
put(work, "peaceai/results-repo/self-change-stage2.yml", "name: self-change-stage2\non: workflow_dispatch\n");
put(work, "peaceai/test/a.test.ts", 'import test from "node:test";\ntest("a", () => {});\n');
put(work, "docs/notes.md", "# notes\n");
git(work, "add", "-A");
git(work, "commit", "-q", "-m", "base");
const base = git(work, "rev-parse", "HEAD");
put(work, "docs/notes.md", "# notes\n\nOne more line.\n");
git(work, "commit", "-q", "-am", "proposal");
const head = git(work, "rev-parse", "HEAD");
git(origin, "fetch", "-q", work, `${base}:refs/heads/main`, `${head}:refs/pull/${PR}/head`); // the origin pulls the refs in (no push, no hooks)
const templateBlob = git(work, "rev-parse", `${base}:peaceai/results-repo/self-change-stage2.yml`);

// ---- the record the ledger's run would have uploaded (graded content; decide2 must DOWNLOAD it, not be handed it)
const diff = git(work, ...STAGE2_DIFF_ARGS, base, head);
const show = (sha: string) => (p: string) => { const r = spawnSync("git", ["show", `${sha}:${p}`], { cwd: work, encoding: "utf8" }); return r.status === 0 ? r.stdout : null; };
const check = checkStage2Proposal(diff + "\n", { base: show(base), cand: show(head) }, neverZoneAtSha(work, base));
const suite = suiteFilesAt(work, base);
const record: Stage2Record = {
  schema: STAGE2_SCHEMA, id: ID, baseSha: base, candidateSha: head, diffSha256: stage2DiffSha(diff), paths: check.paths,
  candidateBlobs: Object.fromEntries(check.paths.map((p) => [p, git(work, "rev-parse", `${head}:${p}`)])), check,
  baseSuite: { suite: "live", files: suite, filesSha256: listSha(suite), exitCode: 0, pass: 1, fail: 0 }, newTests: [],
  phases: STAGE2_PHASES.map((phase) => ({ phase, ran: true, leftovers: 0, tampered: 0 })), status: "awaiting-review",
  createdAt: "2026-10-25T12:00:00.000Z", countsTrust: STAGE2_COUNTS_TRUST, run: { repository: RESULTS, runId: RUN, runAttempt: "1" },
} as Stage2Record;

// ---- the fake gh: routes `gh api ...` paths to fixture JSON, applies the few --jq forms decide2 uses, logs each call
const fakeBin = join(tmp, "bin");
mkdirSync(fakeBin);
writeFileSync(join(fakeBin, "gh"), `#!${process.execPath}
const fs = require("node:fs"), path = require("node:path");
const a = process.argv.slice(2);
const st = JSON.parse(fs.readFileSync(process.env.FAKE_GH_STATE, "utf8"));
fs.appendFileSync(process.env.FAKE_GH_LOG, JSON.stringify(a) + "\\n");
const fail = (m) => { process.stderr.write("fake gh: " + m + "\\n"); process.exit(1); };
if (a[0] === "run" && a[1] === "download") {
  const at = (f) => a[a.indexOf(f) + 1];
  if (a[2] !== st.artifactRunId || at("-R") !== "${RESULTS}" || at("-n") !== "self-change-stage2-${ID}" || !st.artifact) fail("no such artifact");
  fs.mkdirSync(at("-D"), { recursive: true });
  fs.writeFileSync(path.join(at("-D"), "${ID}.stage2.json"), JSON.stringify(st.artifact));
  process.exit(0);
}
if (a[0] !== "api") fail("unsupported " + a.join(" "));
let jq = null, raw = false, p = null;
for (let i = 1; i < a.length; i++) {
  if (a[i] === "--paginate") continue;
  if (a[i] === "--jq") { jq = a[++i]; continue; }
  if (a[i] === "-H") { raw = /raw/.test(a[++i]); continue; }
  p = a[i];
}
const [route, query] = p.split("?");
let body;
if (route === "repos/PeaceG03/PeaceAI-Workspace/pulls/${PR}") body = { head: { sha: st.headSha } };
else if (route === "repos/PeaceG03/PeaceAI-Workspace/issues/${PR}/comments") body = st.comments;
else if (route === "repos/PeaceG03/PeaceAI-Workspace/pulls/${PR}/commits") body = st.prCommits.map((sha) => ({ sha }));
else if (route === "repos/${RESULTS}/contents/${STAGE2_LEDGER_DIR}/${ID}.json" && raw) { if (!st.ledger) fail("404"); process.stdout.write(JSON.stringify(st.ledger)); process.exit(0); }
else if (route === "repos/${RESULTS}/commits") body = st.ledgerCommits.map((sha) => ({ sha }));
else if (route === "repos/${RESULTS}/actions/workflows/self-change-stage2.yml/runs") body = { workflow_runs: st.runs };
else if (route.startsWith("repos/${RESULTS}/contents/") && /^ref=[0-9a-f]{40}$/.test(query || "")) { const b = (st.blobs[route.slice("repos/${RESULTS}/contents/".length)] || {})[query.slice(4)]; if (!b) fail("404"); body = { sha: b }; }
else if (/^repos\\/PeaceG03\\/PeaceAI-Results\\/actions\\/runs\\/\\d+\\/attempts\\/1\\/jobs$/.test(route)) body = { jobs: st.jobs[route.split("/")[5]] || [] };
else fail("unrouted " + p);
const out = jq === null ? [JSON.stringify(body)]
  : jq === ".[] | tojson" ? body.map((x) => JSON.stringify(x))
  : jq === ".workflow_runs[] | tojson" ? body.workflow_runs.map((x) => JSON.stringify(x))
  : jq === ".jobs[] | tojson" ? body.jobs.map((x) => JSON.stringify(x))
  : jq === ".head.sha" ? [body.head.sha]
  : jq === ".sha" ? [body.sha]
  : fail("unsupported jq " + jq);
process.stdout.write(out.join("\\n") + (out.length ? "\\n" : ""));
`);
chmodSync(join(fakeBin, "gh"), 0o755);

const RUN_SHA = "e".repeat(40);
const comment = (id: number, body: string) => ({ id, html_url: `https://github.com/PeaceG03/PeaceAI-Workspace/pull/${PR}#issuecomment-${id}`, body, user: { login: "PeaceG03" }, author_association: "OWNER", created_at: "2026-10-25T12:00:00Z" });
const ghRun = (o: Record<string, unknown> = {}) => ({ id: Number(RUN), run_attempt: 1, display_title: `self-change-stage2 ${ID}`, path: WF, event: "workflow_dispatch", head_branch: "main", head_sha: RUN_SHA, ...o });
function state(o: Record<string, unknown> = {}) {
  return {
    headSha: head, prCommits: [head],
    comments: [comment(901, `/auditor-pass ${ID} ${head}`), comment(902, `/verdict ${ID} ${head} right`)],
    ledger: { schema: "peaceai-self-change-ledger:v1", id: ID, base, runId: RUN, patchSha256: "" }, ledgerCommits: ["1".repeat(40)],
    // an unrelated run of the same workflow (another id) must be filtered out by display_title
    runs: [ghRun(), ghRun({ id: 4300, display_title: "self-change-stage2 sc-other" })],
    blobs: { [WF]: { [RUN_SHA]: templateBlob } },
    jobs: { [RUN]: [{ name: "prepare", conclusion: "success" }, { name: "record", conclusion: "success" }] },
    artifactRunId: RUN, artifact: record,
    ...o,
  };
}
let n = 0;
function decide2(st: ReturnType<typeof state>) {
  n += 1;
  const sf = join(tmp, `state-${n}.json`), log = join(tmp, `calls-${n}.log`);
  writeFileSync(sf, JSON.stringify(st));
  writeFileSync(log, "");
  const r = spawnSync(process.execPath, [join(root, "node_modules/tsx/dist/cli.mjs"), join(root, "peaceai/bin/self-change.ts"), "decide2", "--id", ID, "--pr", PR, "--repo", work],
    { cwd: work, encoding: "utf8", env: { ...env0, PATH: `${fakeBin}:${process.env.PATH}`, FAKE_GH_STATE: sf, FAKE_GH_LOG: log }, timeout: 120_000 });
  const calls = readFileSync(log, "utf8").split("\n").filter(Boolean).map((l) => (JSON.parse(l) as string[]).join(" "));
  return { code: r.status, out: (r.stdout ?? "").trim(), err: r.stderr ?? "", calls };
}
const reasonsOf = (out: string) => (/reasons=(\S+)/.exec(out)?.[1] ?? "").split(",").filter(Boolean);

test("decide2 via stubbed gh, happy path: every collection call is made and the proposal lands (exit 0, land=true)", () => {
  assert.ok(check.ok, JSON.stringify(check.refusals));
  const r = decide2(state());
  assert.equal(r.code, 0, `${r.out}\n${r.err}`);
  assert.match(r.out, new RegExp(`^self-change decide2 id=${ID} land=true auditor=https://github\\.com/PeaceG03/PeaceAI-Workspace/pull/${PR}#issuecomment-901 peace=https://github\\.com/PeaceG03/PeaceAI-Workspace/pull/${PR}#issuecomment-902$`));
  const has = (re: RegExp, what: string) => assert.ok(r.calls.some((c) => re.test(c)), `${what} not called:\n${r.calls.join("\n")}`);
  has(/^api repos\/PeaceG03\/PeaceAI-Workspace\/pulls\/7 --jq \.head\.sha$/, "PR head");
  has(/issues\/7\/comments$/, "PR comments");
  has(/pulls\/7\/commits$/, "PR commits");
  has(/^api -H Accept: application\/vnd\.github\.raw repos\/PeaceG03\/PeaceAI-Results\/contents\/self-proposals\/ledger\/sc-ghstub\.json$/, "ledger read");
  has(/PeaceAI-Results\/commits\?path=/, "ledger history");
  has(/actions\/workflows\/self-change-stage2\.yml\/runs\?per_page=100$/, "runs list");
  has(new RegExp(`contents/\\.github/workflows/self-change-stage2\\.yml\\?ref=${RUN_SHA} --jq \\.sha$`), "workflow blob at head_sha");
  has(/actions\/runs\/4242\/attempts\/1\/jobs\?per_page=100$/, "jobs list");
  has(/^run download 4242 -R PeaceG03\/PeaceAI-Results -n self-change-stage2-sc-ghstub -D /, "artifact download");
  assert.ok(r.calls.every((c) => !/\b(POST|PATCH|PUT|DELETE)\b|--method|-X /.test(c)), "decide2 only reads");
});

const cases: [string, Record<string, unknown>, string][] = [
  ["the run was dispatched on a side branch", { runs: [ghRun({ head_branch: "side" })] }, "RUN_NOT_ON_MAIN"],
  ["the run's workflow file at its head_sha is not the reviewed template", { blobs: { [WF]: { [RUN_SHA]: "0".repeat(40) } } }, "RUN_WORKFLOW_NOT_REVIEWED_TEMPLATE"],
  ["the workflow file is missing at the run's head_sha (gh 404)", { blobs: {} }, "RUN_WORKFLOW_NOT_REVIEWED_TEMPLATE"],
  ["the run's record job failed", { jobs: { [RUN]: [{ name: "record", conclusion: "failure" }] } }, "RECORD_JOB_NOT_SUCCESS"],
  ["the run has no record job", { jobs: { [RUN]: [{ name: "prepare", conclusion: "success" }] } }, "RECORD_JOB_NOT_SUCCESS"],
  ["a second self-change-stage2 run named the same id", { runs: [ghRun(), ghRun({ id: 4243 })] }, "STAGE2_RUN_NOT_UNIQUE"],
  ["no self-change-stage2 run named the id", { runs: [ghRun({ display_title: "self-change-stage2 sc-other" })] }, "STAGE2_RUN_NOT_UNIQUE"],
];
for (const [what, over, reason] of cases)
  test(`decide2 via stubbed gh refuses (${reason}): ${what}`, () => {
    const r = decide2(state(over));
    assert.equal(r.code, 2, `${r.out}\n${r.err}`);
    assert.match(r.out, new RegExp(`^self-change decide2 id=${ID} land=false reasons=`));
    assert.deepEqual(reasonsOf(r.out), [reason], r.out); // exactly this reason: everything else in the fixture is valid
  });

test("decide2 via stubbed gh: no artifact for the ledger's run -> RECORD_NOT_FROM_LEDGER_RUN_ARTIFACT (never a local record)", () => {
  const r = decide2(state({ artifact: null }));
  assert.equal(r.code, 2);
  assert.equal(r.out, `self-change decide2 id=${ID} land=false reasons=RECORD_NOT_FROM_LEDGER_RUN_ARTIFACT`);
});

// ---- M115 (Auditor #504 follow-up): the approval branches end to end through the same stubbed gh. Landing needs
// Peace's /verdict AND Auditor's /auditor-pass on the EXACT PR head sha, and the stage-2 flag ON at origin main.
const OTHER = "f".repeat(40);
const approvalCases: [string, Record<string, unknown>, string[]][] = [
  ["both commands name a different sha than the PR head", { comments: [comment(901, `/auditor-pass ${ID} ${OTHER}`), comment(902, `/verdict ${ID} ${OTHER} right`)] }, ["AUDITOR_PASS_STALE_OR_SHA_MISMATCH", "PEACE_VERDICT_STALE_OR_SHA_MISMATCH"]],
  ["the Auditor pass names a different sha (verdict exact)", { comments: [comment(901, `/auditor-pass ${ID} ${OTHER}`), comment(902, `/verdict ${ID} ${head} right`)] }, ["AUDITOR_PASS_STALE_OR_SHA_MISMATCH"]],
  ["the verdict names a different sha (pass exact)", { comments: [comment(901, `/auditor-pass ${ID} ${head}`), comment(902, `/verdict ${ID} ${OTHER} right`)] }, ["PEACE_VERDICT_STALE_OR_SHA_MISMATCH"]],
  ["Peace's verdict but no Auditor pass", { comments: [comment(902, `/verdict ${ID} ${head} right`)] }, ["AUDITOR_PASS_MISSING"]],
  ["Auditor's pass but no verdict", { comments: [comment(901, `/auditor-pass ${ID} ${head}`)] }, ["PEACE_VERDICT_MISSING"]],
  ["no approval comments at all", { comments: [] }, ["AUDITOR_PASS_MISSING", "PEACE_VERDICT_MISSING"]],
  ["the commands are for another id", { comments: [comment(901, `/auditor-pass sc-other ${head}`), comment(902, `/verdict sc-other ${head} right`)] }, ["AUDITOR_PASS_MISSING", "PEACE_VERDICT_MISSING"]],
];
for (const [what, over, reasons] of approvalCases)
  test(`decide2 via stubbed gh refuses (${reasons.join("+")}): ${what}`, () => {
    const r = decide2(state(over));
    assert.equal(r.code, 2, `${r.out}\n${r.err}`);
    assert.deepEqual(reasonsOf(r.out), reasons, r.out);
  });

test("decide2 via stubbed gh: exact pass + verdict but the flag is OFF at origin main -> exactly STAGE2_OFF", () => {
  // a main commit on top of base that only turns the flag off (base stays an ancestor of main, template unchanged)
  const off = join(tmp, "work-off");
  git(tmp, "clone", "-q", origin, off);
  put(off, "peaceai/self/stage2.json", JSON.stringify({ schema: "peaceai-self-stage2:v1", enabled: false }));
  git(off, "commit", "-q", "-am", "flag off");
  const offSha = git(off, "rev-parse", "HEAD");
  git(origin, "fetch", "-q", off, `${offSha}:refs/heads/main`);
  try {
    const r = decide2(state());
    assert.equal(r.code, 2, `${r.out}\n${r.err}`);
    assert.deepEqual(reasonsOf(r.out), ["STAGE2_OFF"], r.out);
  } finally {
    git(origin, "update-ref", "refs/heads/main", base);
  }
  const back = decide2(state()); // restoring main restores landing: the only difference was the flag
  assert.equal(back.code, 0, `${back.out}\n${back.err}`);
});

test("the committed stage-2 flag stays OFF", () => {
  assert.equal(JSON.parse(readFileSync(join(root, "peaceai/self/stage2.json"), "utf8")).enabled, false);
});
