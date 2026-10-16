import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";
import { LM_JOBS } from "../lib/lm.ts";

const dir = ".github/workflows";
const files = readdirSync(dir).filter((f) => f.endsWith(".yml"));
const read = (f: string) => readFileSync(`${dir}/${f}`, "utf8");

/** Splits a workflow into job blocks by two-space-indented job keys under `jobs:`. */
function jobs(text: string): Map<string, string> {
  const body = text.split(/^jobs:\s*$/m)[1] ?? "";
  const out = new Map<string, string>();
  let name = "";
  for (const line of body.split("\n")) {
    const m = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(line);
    if (m) {
      name = m[1]!;
      out.set(name, "");
    } else if (name) out.set(name, out.get(name)! + line + "\n");
  }
  return out;
}

test("no pull_request_target and default permissions are empty", () => {
  for (const f of files) {
    assert.ok(!read(f).includes("pull_request_target"), f);
    assert.match(read(f), /^permissions: \{\}$/m, f);
  }
});

test("every job has timeout-minutes", () => {
  for (const f of files) for (const [name, block] of jobs(read(f))) assert.match(block, /timeout-minutes: \d+/, `${f}:${name}`);
});

test("untrusted text reaches steps only through env, never inside run scripts", () => {
  for (const f of files) {
    const text = read(f);
    for (const line of text.split("\n")) {
      if (/github\.event\.(issue|pull_request|comment)\.(title|body)|head_ref|pull_request\.head\.ref/.test(line))
        assert.match(line, /^\s+[A-Z_]+: \$\{\{|^\s+startsWith\(github\.event\.comment\.body, '\/(verdict|approve-rule)'\)$/, `${f}: ${line.trim()}`);
    }
    for (const block of text.split(/\n\s+run: \|?/).slice(1)) {
      const script = block.split(/\n\s{6}- |\n {2}[a-z]/)[0]!;
      assert.ok(!/\$\{\{\s*(github\.event|needs\.[a-z]+\.outputs\.presentation)/.test(script), `${f}: run block interpolates untrusted data`);
    }
  }
});

test("peace-intake: owner, label and kill switch gate; it only queues and dispatches", () => {
  const text = read("peace-intake.yml");
  for (const cond of ["github.event.label.name == 'peace-task'", "github.event.issue.user.login == 'PeaceG03'", "github.event.sender.login == 'PeaceG03'", "vars.PEACEAI_ENABLED == 'true'"])
    assert.ok(text.includes(cond), cond);
  assert.ok(!/environment:|secrets\.|concurrency:/.test(text));
  assert.match(text, /gh workflow run peace-task\.yml/);
});

test("peace-task: serialized sweep, core env only on Job A and Job B2, Results env only on Job C, review needs Job C", () => {
  const text = read("peace-task.yml");
  const j = jobs(text);
  assert.match(text, /concurrency:\n {2}group: peace-task\n {2}cancel-in-progress: false/);
  assert.match(text, /workflow_dispatch:/);
  assert.match(text, /schedule:/);
  assert.ok(!/^ {2}issues:/m.test(text), "no direct issue trigger");
  assert.ok(j.get("select")!.includes("vars.PEACEAI_ENABLED == 'true'"));
  const a = j.get("generate")!;
  assert.match(a, /environment: peaceai-core/);
  assert.ok(a.indexOf("issue-fetch.ts") < a.indexOf("clone-core.sh"), "live task check before the core clone");
  assert.ok(a.indexOf("gate.ts") < a.indexOf("Upload candidates") && a.indexOf("Delete core") < a.indexOf("Upload candidates"));
  // M7 Job B2: core only when a repaired diff exists; target re-check first; core deleted before upload.
  const b2 = j.get("regate")!;
  assert.match(b2, /environment: peaceai-core/);
  assert.match(b2, /needs: \[select, generate, test\]/);
  assert.ok(b2.indexOf("target-check.ts") < b2.indexOf("clone-core.sh"));
  assert.ok(b2.indexOf("regate.ts") < b2.indexOf("Delete core") && b2.indexOf("Delete core") < b2.indexOf("Upload the final candidate set"));
  assert.match(b2, /Clone core[^\n]*\n {8}if: steps\.repaired\.outputs\.any == 'true'/);
  assert.ok(!/issues: write|secrets\.PEACEAI_RESULTS/.test(b2));
  const c = j.get("record")!;
  assert.match(c, /needs: \[select, generate, test, regate\]/);
  assert.match(c, /name: peaceai-final/);
  assert.ok(!c.includes("peaceai-test-"), "Job C reads only the re-gated final set");
  assert.match(j.get("review")!, /name: peaceai-final/);
  assert.match(c, /environment: peaceai-results/);
  assert.match(c, /PEACEAI_RESULTS_DEPLOY_KEY/);
  for (const [name, block] of j) {
    if (name !== "generate" && name !== "regate" && name !== "carry") assert.ok(!block.includes("peaceai-core") && !block.includes("CORE_DEPLOY_KEY"), name);
    // M9: the flag-gated lm-fill job reads the verified model from Results (no core, no write).
    if (name !== "record" && name !== "lm-fill") assert.ok(!block.includes("environment: peaceai-results") && !block.includes("RESULTS_DEPLOY_KEY"), name);
  }
  assert.match(j.get("review")!, /needs: \[select, generate, record\]/);
  assert.match(j.get("review")!, /if: always\(\) && needs\.record\.result == 'success' && needs\.generate\.outputs\.candidates != '0'/);
  const b = j.get("test")!;
  assert.match(b, /matrix:/);
  assert.match(b, /chmod -R a-w node_modules peaceai/);
  assert.ok(!/secrets\.|environment:/.test(b));
  assert.match(j.get("finish")!, /gh workflow run peace-task\.yml/);
  assert.match(text, /retention-days: 1/);
});

test("peace-verdict: owner-only issue comments; Results env only on the record job", () => {
  const text = read("peace-verdict.yml");
  const j = jobs(text);
  const parse = j.get("parse")!;
  for (const cond of ["github.event.comment.user.login == 'PeaceG03'", "github.event.sender.login == 'PeaceG03'", "github.event.issue.pull_request == null", "contains(github.event.issue.labels.*.name, 'peace-task')"])
    assert.ok(parse.includes(cond), cond);
  assert.match(j.get("record")!, /environment: peaceai-results/);
  for (const name of ["parse", "respond"]) assert.ok(!/environment:|secrets\./.test(j.get(name)!), name);
});

test("key-proof: dispatch only, owner and main only, results key in its own job", () => {
  const text = read("key-proof.yml");
  assert.match(text, /^on:\n {2}workflow_dispatch:\n\n/m);
  const j = jobs(text);
  assert.match(j.get("core-key")!, /environment: peaceai-core/);
  assert.ok(!j.get("core-key")!.includes("RESULTS_DEPLOY_KEY"));
  assert.match(j.get("results-key")!, /environment: peaceai-results/);
  for (const block of j.values()) {
    assert.ok(block.includes("github.ref == 'refs/heads/main'"));
    assert.ok(block.includes("github.actor == 'PeaceG03'"));
  }
});

test("leak-check: PR job uses no core key; backstop is main-only", () => {
  const j = jobs(read("leak-check.yml"));
  assert.ok(!/environment:|DEPLOY_KEY/.test(j.get("leak-check")!));
  assert.ok(j.get("core-backstop")!.includes("github.ref == 'refs/heads/main'"));
  assert.ok(!j.get("core-backstop")!.includes("pull_request'"));
});

test("M2.5 peace-verdict: a PR opens only after the duplicate guard says so; respond is serialized per issue", () => {
  const wf = read("peace-verdict.yml");
  const respond = wf.slice(wf.indexOf("\n  respond:"));
  assert.match(respond, /group: peace-verdict-respond-\$\{\{ needs\.parse\.outputs\.issue \}\}/);
  assert.match(respond, /cancel-in-progress: false/);
  assert.match(respond, /pr-guard\.ts/);
  const prStep = respond.slice(respond.indexOf("- name: Open a PR for the chosen candidate"));
  assert.match(prStep, /if: steps\.guard\.outputs\.open_pr == 'true'/);
  assert.ok(respond.indexOf("pr-guard.ts") < respond.indexOf("gh pr create"));
  assert.doesNotMatch(respond, /if: needs\.record\.outputs\.chosen == 'true'/);
});

test("M2.5 tamper-proof: Job B runs candidates as an unprivileged user and fails closed; CI runs the proof", () => {
  const task = read("peace-task.yml");
  const jobB = task.slice(task.indexOf("\n  test:"), task.indexOf("\n  record:"));
  assert.match(jobB, /sudo useradd --system --no-create-home --shell \/usr\/sbin\/nologin peaceai-cand/);
  assert.match(jobB, /PEACEAI_SANDBOX_USER: peaceai-cand/);
  assert.match(jobB, /PEACEAI_REQUIRE_SANDBOX: "true"/);
  assert.ok(jobB.indexOf("useradd") < jobB.indexOf("test-candidates.ts"));
  assert.ok(jobB.indexOf("test-candidates.ts") < jobB.indexOf("upload-artifact"));
  const ci = read("ci.yml");
  const proof = ci.slice(ci.indexOf("\n  tamper-proof:"));
  assert.match(proof, /useradd .* peaceai-cand/);
  assert.match(proof, /PROOF_SANDBOX_USER: peaceai-cand/);
  assert.match(proof, /peaceai\/proof\/tamper-proof\.ts/);
  assert.doesNotMatch(proof, /secrets\./);
});

test("M3 peace-train: dispatch only, Results key only, no core, main only, serialized", () => {
  const wf = read("peace-train.yml");
  assert.match(wf, /on:\n  workflow_dispatch:\n\n/);
  assert.match(wf, /environment: peaceai-results/);
  assert.match(wf, /if: github\.ref == 'refs\/heads\/main'/);
  assert.match(wf, /group: peace-train/);
  assert.doesNotMatch(wf, /CORE|peaceai-core|clone-core/);
  assert.equal((wf.match(/secrets\./g) ?? []).length, 1);
  assert.match(wf, /secrets\.PEACEAI_RESULTS_DEPLOY_KEY/);
  assert.match(wf, /contents: read/);
  assert.doesNotMatch(wf, /contents: write|issues: write|pull-requests/);
});

test("M3 peace-verdict: recorded verdicts dispatch training; stale PRs closed before the reply and new PR", () => {
  const wf = read("peace-verdict.yml");
  const train = wf.slice(wf.indexOf("\n  train:"));
  assert.match(train, /needs: \[record\]/);
  assert.match(train, /gh workflow run peace-train\.yml/);
  // Auto-dispatch is off unless Architect's explicit gate variable is set (no retrain before the gated retrain).
  assert.match(train, /if: vars\.PEACEAI_RANKER_AUTOTRAIN == 'on' && needs\.record\.outputs\.status == 'recorded'/);
  assert.doesNotMatch(train, /secrets\.|environment:/);
  const respond = wf.slice(wf.indexOf("\n  respond:"), wf.indexOf("\n  train:"));
  assert.ok(respond.indexOf("Close stale PeaceAI PRs") < respond.indexOf("gh pr create"));
  assert.match(respond, /CLOSE: \$\{\{ steps\.guard\.outputs\.close \}\}/);
  assert.match(respond, /branch="peace-task\/issue-\$\{ISSUE_NUMBER\}-\$\{CANDIDATE\}-/);
});

test("M3 peace-task: source from pick time, ranker variable to Job C only, zero-candidate message", () => {
  const wf = read("peace-task.yml");
  const jobC = wf.slice(wf.indexOf("\n  record:"), wf.indexOf("\n  review:"));
  assert.match(jobC, /TASK_SOURCE: \$\{\{ needs\.select\.outputs\.source \}\}/);
  assert.match(jobC, /PEACEAI_RANKER: \$\{\{ vars\.PEACEAI_RANKER \}\}/);
  assert.equal((wf.match(/vars\.PEACEAI_RANKER/g) ?? []).length, 1);
  // M59: the zero-candidate text moved to lib/refusal-reason.ts (posted via bin/no-candidate-comment.ts).
  assert.match(wf, /peaceai\/bin\/no-candidate-comment\.ts/);
  assert.match(readFileSync(new URL("../lib/refusal-reason.ts", import.meta.url), "utf8"), /no candidates generated for this task/);
  assert.match(wf, /NO_CANDIDATES: \$\{\{ needs\.generate\.result == 'success' && needs\.generate\.outputs\.candidates == '0'/);
});

test("M3.1 peace-verdict: no retrain after [test] verdicts; withdrawn PRs labelled and unlabelled", () => {
  const wf = read("peace-verdict.yml");
  const train = wf.slice(wf.indexOf("\n  train:"));
  assert.match(train, /if: vars\.PEACEAI_RANKER_AUTOTRAIN == 'on' && needs\.record\.outputs\.status == 'recorded' && needs\.record\.outputs\.test != 'true'/);
  assert.match(wf, /test: \$\{\{ steps\.record\.outputs\.test \}\}/);
  const respond = wf.slice(wf.indexOf("\n  respond:"), wf.indexOf("\n  train:"));
  assert.match(respond, /--json number,headRefName,labels/);
  assert.match(respond, /WITHDREW: \$\{\{ needs\.record\.outputs\.withdrew \}\}/);
  assert.match(respond, /if: steps\.guard\.outputs\.mark != ''[\s\S]*gh label create verdict-withdrawn[\s\S]*--add-label verdict-withdrawn[\s\S]*Do not merge it\./);
  assert.match(respond, /if: steps\.guard\.outputs\.unmark != ''[\s\S]*--remove-label verdict-withdrawn/);
  assert.ok(respond.indexOf("Mark PRs whose verdict") < respond.indexOf("- name: Reply"));
});

test("approval landing uses no deploy key: no workflow names the approve-push key or environment; results-land has no environment", () => {
  for (const f of files) assert.doesNotMatch(read(f), /PEACEAI_APPROVE_PUSH_KEY|peaceai-approve-push|APPROVE_PUSH_KEY/, f);
  const land = jobs(read("peace-approve-rule.yml")).get("results-land")!;
  assert.doesNotMatch(land, /environment:|secrets\./);
  assert.ok(!/upload-artifact/.test(land), "no artifact upload in results-land");
  assert.match(land, /permissions:\n {6}contents: write\n {6}pull-requests: write\n {6}issues: read\n(?: {6}#.*\n)? {6}actions: write\n/);
  // One step: it either lands (approve-rule-pr.sh) or, on a push_proof dispatch, runs the push proof.
  assert.match(land, /PUSH_PROOF: \$\{\{ inputs\.push_proof == true \}\}\n {8}run: \|\n {10}if \[ "\$PUSH_PROOF" = "true" \]; then \.\/peaceai\/bin\/push-proof-main\.sh; else \.\/peaceai\/bin\/approve-rule-pr\.sh /);
  // A push proof lands nothing: the landing artifact and list steps are skipped, and the Results/core jobs never start.
  assert.equal((land.match(/if: inputs\.push_proof != true/g) ?? []).length, 2);
  assert.match(jobs(read("peace-approve-rule.yml")).get("results-read")!, /inputs\.push_proof != true/);
  // The dispatched required checks report under their exact required names.
  assert.match(jobs(read("leak-check.yml")).get("leak-check")!, /^ {4}name: leak-check$/m);
  assert.match(jobs(read("ci.yml")).get("tamper-proof")!, /^ {4}name: tamper-proof$/m);
  assert.match(jobs(read("ci.yml")).get("tests")!, /^ {4}name: tests$/m);
  for (const f of ["leak-check.yml", "ci.yml"]) assert.match(read(f), /^ {2}workflow_dispatch:/m, f);
  // Every secret is environment-scoped: no job reads a secret without an environment.
  for (const f of files) for (const [name, block] of jobs(read(f)))
    if (/secrets\.(?!GITHUB_TOKEN)[A-Z_]+_KEY\b/.test(block)) assert.match(block, /^ {4}environment: peaceai-[a-z-]+$/m, `${f}:${name}`);
});

test("Job B runs whenever Job A succeeded with candidates, even with the LM fill job skipped", () => {
  const b = jobs(read("peace-task.yml")).get("test")!;
  assert.match(b, /^ {4}if: always\(\) && needs\.generate\.result == 'success' && needs\.generate\.outputs\.candidates != '0'$/m);
  // Every job downstream of generate guards with always() (lm-fill is skipped by default).
  for (const [name, block] of jobs(read("peace-task.yml")))
    if (/needs: \[[^\]]*\bgenerate\b/.test(block)) assert.match(block, /^ {4}if: (?:>-\n {6})?always\(\)/m, name);
});

test("peace-verdict: patch build disables background gc and cleanup cannot fail a built patch", () => {
  const y = readFileSync(new URL("../../.github/workflows/peace-verdict.yml", import.meta.url), "utf8");
  const i = y.indexOf("- name: Build the format-patch");
  const step = y.slice(i, y.indexOf("- name:", i + 10));
  assert.match(step, /git -c gc\.auto=0 -c maintenance\.auto=false /u);
  assert.match(step, /test -s "\$RUNNER_TEMP\/verdict\.patch"/u);
  assert.match(step, /rm -rf "\$RUNNER_TEMP\/target" \|\| \{/u);
  assert.ok(step.indexOf("test -s") < step.indexOf('rm -rf "$RUNNER_TEMP/target"'));
});

test("m49-posttrain-memcheck: one job, core env only, read-only keys, guarded, nothing written, counts-only upload", () => {
  const text = read("m49-posttrain-memcheck.yml");
  const j = jobs(text);
  assert.deepEqual([...j.keys()], ["memcheck"]);
  // Run 38902887991: the job that runs lm-memcheck.ts must be an LM job, else sampling is refused (LM_JOB_REFUSED).
  assert.ok((LM_JOBS as readonly string[]).includes("memcheck"), "memcheck job id must be in LM_JOBS");
  const m = j.get("memcheck")!;
  // Triggers: a completed peace-lm-train-m49 run (success checked in `if`) or a dispatch with a run id; nothing else.
  assert.match(text, /^on:\n  workflow_run:\n    workflows: \[peace-lm-train-m49\]\n    types: \[completed\]\n  workflow_dispatch:\n    inputs:\n      run_id:\n/m);
  assert.ok(!/pull_request|schedule:|^  push:/m.test(text));
  assert.match(m, /github\.event\.workflow_run\.conclusion == 'success' && github\.event\.workflow_run\.head_branch == 'main'/);
  assert.match(m, /github\.event\.workflow_run\.head_repository\.full_name == 'PeaceG03\/PeaceAI-Workspace' &&/);
  assert.match(m, /\.head_repository\.full_name\] \| join/);
  assert.match(m, /github\.ref == 'refs\/heads\/main'/);
  // Least privilege: one environment (core), contents+actions read only; the only secrets are the two read keys.
  assert.equal((text.match(/^ +environment:/gm) ?? []).length, 1); assert.match(m, /environment: peaceai-core\n/);
  assert.match(m, /permissions:\n      contents: read\n      actions: read\n    steps:/);
  assert.ok(!/: write/.test(text));
  assert.deepEqual([...new Set(text.match(/secrets\.[A-Z_]+/g))].sort(), ["secrets.PEACEAI_CORE_DEPLOY_KEY", "secrets.PEACEAI_RESULTS_READ_KEY"]);
  assert.ok(!/PEACEAI_RESULTS_DEPLOY_KEY|results-write\.sh|latest\.json|git push|git commit|model\/train\.py/.test(text), "read-only: no Results write, no promotion, no training");
  assert.match(text, /persist-credentials: false/); assert.equal((text.match(/actions\/checkout@/g) ?? []).length, 1);
  // The run id is checked through the API before anything else; the dispatch input reaches the script only via env.
  assert.match(m, /INPUT_RUN_ID: \$\{\{ inputs\.run_id \}\}/);
  assert.match(m, /"\.github\/workflows\/peace-lm-train-m49\.yml main workflow_dispatch completed success PeaceG03\/PeaceAI-Workspace"/);
  // Missing secret: fail closed with a clear message.
  assert.match(m, /\[ -n "\$\{DEPLOY_KEY:-\}" \] \|\| \{ echo "PEACEAI_RESULTS_READ_KEY is not set in the peaceai-core environment: refused \(fail closed\)"; exit 1; \}/);
  // Same checkout and script-hash guard as corpus-checks, before either key is used.
  const at = (s: string) => { const i = m.indexOf(s); assert.ok(i >= 0, s); return i; };
  const guard = at("Verify the checkout and the landing scripts before any key is used");
  assert.ok(guard < at("secrets.PEACEAI_RESULTS_READ_KEY") && guard < at("secrets.PEACEAI_CORE_DEPLOY_KEY"));
  assert.equal(text.match(/LANDING_SHA256: \|-\n.*\n.*\n/)![0], read("corpus-checks.yml").match(/LANDING_SHA256: \|-\n.*\n.*\n/)![0]);
  // Both corpora rebuilt (pinned manifest; ft-pairs at the pinned commits), both proofs (fine-tune with --source-root), memcheck.
  assert.match(m, /ext-fetch\.ts "\$RUNNER_TEMP\/src" "\$RUNNER_TEMP\/pre" --manifest-sha 8458eac61cc414128e98eedb6c3b3ad9c50813e62ab680f5a9ef9d909ccfc231\n/);
  assert.match(m, /ft-pairs\.ts "\$RUNNER_TEMP\/ft"/);
  assert.match(m, /--stage pretrain\n/); assert.match(m, /--stage finetune --source-root "\$RUNNER_TEMP\/srcroot"\n/);
  assert.ok(at("--stage finetune") < at("lm-memcheck.ts"));
  // Core, model, corpora and clones deleted before the one upload, which holds only the count-level JSONs.
  assert.equal((text.match(/upload-artifact@/g) ?? []).length, 1);
  assert.ok(at("Delete core, the model") < at("upload-artifact@"));
  assert.match(m, /rm -rf "\$RUNNER_TEMP\/peaceai-core" "\$RUNNER_TEMP"\/peaceai-ssh\.\* "\$RUNNER_TEMP\/model"/);
  assert.match(m, /path: \$\{\{ runner\.temp \}\}\/checks\/\n/);
  assert.match(m, /for f in memcheck\.json corefree-proof-pretrain\.json corefree-proof-finetune\.json; do/);
});

test("builder-log results-crosscheck (#217): push-to-main only, core env, read-only Results key, guarded, sparse tasks/, deleted after", () => {
  const text = read("builder-log.yml");
  const j = jobs(text);
  const pr = j.get("builder-log")!, rc = j.get("results-crosscheck")!;
  assert.ok(!/secrets\.|environment:/.test(pr), "the PR job holds no key");
  assert.match(rc, /if: github\.event_name == 'push' && github\.ref == 'refs\/heads\/main'/);
  assert.match(rc, /environment: peaceai-core\n/);
  assert.match(rc, /permissions:\n      contents: read\n      issues: read\n/);
  assert.deepEqual([...new Set(text.match(/secrets\.[A-Z_]+/g))], ["secrets.PEACEAI_RESULTS_READ_KEY"]);
  assert.ok(!/PEACEAI_RESULTS_DEPLOY_KEY|git push|results-write\.sh|: write/.test(text));
  assert.match(rc, /\[ -n "\$\{DEPLOY_KEY:-\}" \] \|\| \{ echo "PEACEAI_RESULTS_READ_KEY is not set in the peaceai-core environment: refused \(fail closed\)"; exit 1; \}/);
  const at = (s: string) => { const i = rc.indexOf(s); assert.ok(i >= 0, s); return i; };
  assert.ok(at("Verify the checkout and the key script") < at("secrets.PEACEAI_RESULTS_READ_KEY"));
  assert.match(rc, /bee71029e4a528f4ea7a9aae3c25d8591f4f35db398c9fb24cf11d645b4b355e  peaceai\/bin\/with-deploy-key\.sh/);
  assert.match(rc, /sparse-checkout set tasks\n/);
  assert.match(rc, /rule-skill\.ts --results-dir "\$RUNNER_TEMP\/results" --ci >>/);
  assert.ok(at("trace.ts --results-dir") < at("Delete the Results clone") && at("rule-skill.ts --results-dir") < at("Delete the Results clone"));
  assert.ok(!/upload-artifact/.test(text));
});

test("#273 prep: peace-approve-rule concurrency is per issue and never cancels, so approvals queue instead of being dropped", () => {
  const text = read("peace-approve-rule.yml");
  const m = /^concurrency:\n {2}group: (.+)\n {2}cancel-in-progress: (\w+)$/m.exec(text);
  assert.ok(m, "top-level concurrency block");
  assert.equal(m![1], "peace-approve-rule-${{ github.event.issue.number || github.event_name }}");
  assert.equal(m![2], "false");
  assert.equal(text.match(/^\s*concurrency:/gm)!.length, 1, "no job-level group re-serialising approvals");
});

test("carry-forward carry job: core env (main-only, read-only keys), read-only Results clone, no write key and no push reachable", () => {
  const text = read("peace-task.yml");
  const j = jobs(text);
  const c = j.get("carry")!;
  assert.ok(c, "carry job");
  assert.equal((c.match(/^ +environment:/gm) ?? []).length, 1); assert.match(c, /environment: peaceai-core\n/);
  assert.match(c, /permissions:\n      contents: read\n      issues: read\n    outputs:/);
  assert.ok(!/: write/.test(c), "no write permission");
  assert.deepEqual([...new Set(c.match(/secrets\.[A-Z_]+/g))], ["secrets.PEACEAI_RESULTS_READ_KEY"]);
  assert.ok(!/PEACEAI_RESULTS_DEPLOY_KEY|CORE_DEPLOY_KEY|peaceai-results\b|results-write\.sh|git push|git commit|gh workflow run|gh api [^\n]*-F|gh issue comment/.test(c), "no write key, no push, no write call");
  assert.match(c, /persist-credentials: false/); assert.equal((c.match(/actions\/checkout@/g) ?? []).length, 1);
  assert.match(c, /if: always\(\) && github\.event_name != 'pull_request' && github\.ref == 'refs\/heads\/main' &&/);
  assert.match(c, /\[ -n "\$\{DEPLOY_KEY:-\}" \] \|\| \{ echo "PEACEAI_RESULTS_READ_KEY is not set in the peaceai-core environment: refused \(fail closed\)"; exit 1; \}/);
  assert.match(c, /\.\/peaceai\/bin\/with-deploy-key\.sh git clone --quiet --depth 1 git@github\.com:PeaceG03\/PeaceAI-Results\.git "\$RUNNER_TEMP\/results"\n/);
  const at = (s: string) => { const i = c.indexOf(s); assert.ok(i >= 0, s); return i; };
  assert.ok(at("Verify the checkout and the key script") < at("secrets.PEACEAI_RESULTS_READ_KEY"));
  assert.match(c, /bee71029e4a528f4ea7a9aae3c25d8591f4f35db398c9fb24cf11d645b4b355e  peaceai\/bin\/with-deploy-key\.sh/);
  assert.ok(at("carry-check.ts") < at("Delete the Results clone") && at("Delete the Results clone") < at("upload-artifact@"));
  // Scripts the job runs never reach a push or results-write.sh.
  const scripts = [...new Set(c.match(/peaceai\/bin\/[\w.-]+\.(?:ts|sh)/g))];
  for (const f of scripts) assert.ok(!/results-write\.sh|git push|"push"|'push'/.test(readFileSync(`${dir}/../../${f}`, "utf8")), f);
  // The write key stays in the separate peaceai-results environment, only on the record path.
  assert.ok(!j.get("carry-apply")!.includes("secrets."), "carry-apply holds no key");
});

// #286 follow-up: approval PRs whose own pull_request runs are held for approval (external-contributor setting).
// The bot never approves, cancels or deletes them and the setting is not relaxed; it says so on the PR, waits for
// a human approval, and retries the same exact-head merge once. Human PR checks are untouched.
{
  const { mkdtempSync, writeFileSync, chmodSync, rmSync, existsSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const { spawnSync } = await import("node:child_process");
  const SHA = "6c220579d76e47467b9eb009f0b556a4c1d26adf";
  const BR = "peaceai-approve-rule/a6b02e310551-e27782";
  const run = (o: { id: number; status?: string; conclusion: string | null; sha?: string; branch?: string; event?: string }) => ({
    id: o.id, head_sha: o.sha ?? SHA, head_branch: o.branch ?? BR, event: o.event ?? "pull_request",
    status: o.status ?? "completed", conclusion: o.conclusion, html_url: `https://github.com/PeaceG03/PeaceAI-Workspace/actions/runs/${o.id}`,
  });
  /** Runs await-held-runs.sh against a fake gh whose N-th `api` call returns polls[N] (the last one repeats). */
  function held(polls: unknown[][], args = [SHA, BR, "286"]) {
    const dir = mkdtempSync(join(tmpdir(), "held-"));
    try {
      polls.forEach((p, i) => writeFileSync(join(dir, `poll${i}.json`), JSON.stringify({ workflow_runs: p })));
      writeFileSync(join(dir, "gh"), `#!/usr/bin/env bash
echo "$*" >> ${JSON.stringify(join(dir, "gh.log"))}
case "$1" in
  api) n=$(cat ${JSON.stringify(join(dir, "n"))} 2>/dev/null || echo 0); echo $((n+1)) > ${JSON.stringify(join(dir, "n"))}
       f=${JSON.stringify(dir)}/poll$n.json; [ -e "$f" ] || f=${JSON.stringify(dir)}/poll${polls.length - 1}.json; cat "$f" ;;
esac
exit 0
`);
      chmodSync(join(dir, "gh"), 0o755);
      const r = spawnSync("peaceai/bin/await-held-runs.sh", args, { encoding: "utf8", env: { ...process.env, PEACEAI_GH: join(dir, "gh"),
        GH_TOKEN: "dummy", GITHUB_REPOSITORY: "PeaceG03/PeaceAI-Workspace", PEACEAI_HELD_INTERVAL: "0", PEACEAI_HELD_TIMEOUT: "3" } });
      const log = existsSync(join(dir, "gh.log")) ? readFileSync(join(dir, "gh.log"), "utf8") : "";
      return { status: r.status, out: r.stdout + r.stderr, log };
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }

  test("#286 held runs: held, then approved and passed -> exit 0, one PR comment with the run links, read-only API", () => {
    const r = held([
      [run({ id: 1, conclusion: "action_required" }), run({ id: 2, conclusion: "action_required" })],
      [run({ id: 1, status: "in_progress", conclusion: null }), run({ id: 2, conclusion: "action_required" })],
      [run({ id: 1, conclusion: "success" }), run({ id: 2, conclusion: "success" })],
    ]);
    assert.equal(r.status, 0, r.out);
    const comments = r.log.split("\n").filter((l) => l.startsWith("pr comment"));
    assert.equal(comments.length, 1);
    assert.match(comments[0]!, /pr comment 286 --repo PeaceG03\/PeaceAI-Workspace --body /);
    assert.match(r.log, /actions\/runs\/1\b[\s\S]*actions\/runs\/2\b/);
    assert.match(r.log, /Approve and run/);
    for (const l of r.log.split("\n").filter((x) => x.startsWith("api "))) {
      assert.equal(l, `api repos/PeaceG03/PeaceAI-Workspace/actions/runs?head_sha=${SHA}&event=pull_request&per_page=100`);
    }
  });

  test("#286 held runs: no held run -> exit 2 (refusal has another cause), no comment", () => {
    const r = held([[run({ id: 1, conclusion: "success" }), run({ id: 9, conclusion: "action_required", sha: "f".repeat(40) }), run({ id: 8, conclusion: "action_required", branch: "feature" })]]);
    assert.equal(r.status, 2, r.out);
    assert.doesNotMatch(r.log, /pr comment/);
  });

  test("#286 held runs: an approved run that fails, never approved by the deadline, or unreadable API -> exit 1", () => {
    assert.equal(held([[run({ id: 1, conclusion: "action_required" })], [run({ id: 1, conclusion: "failure" })]]).status, 1);
    assert.equal(held([[run({ id: 1, conclusion: "action_required" })]]).status, 1);
    const dir = mkdtempSync(join(tmpdir(), "held-bad-"));
    try {
      writeFileSync(join(dir, "gh"), "#!/usr/bin/env bash\necho not-json\n"); chmodSync(join(dir, "gh"), 0o755);
      const r = spawnSync("peaceai/bin/await-held-runs.sh", [SHA, BR, "286"], { encoding: "utf8", env: { ...process.env, PEACEAI_GH: join(dir, "gh"), GH_TOKEN: "d", GITHUB_REPOSITORY: "PeaceG03/PeaceAI-Workspace" } });
      assert.equal(r.status, 1);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test("#286 held runs: only peaceai-approve-rule/ branches, a full sha and a numeric PR", () => {
    const ok = [[run({ id: 1, conclusion: "action_required" })], [run({ id: 1, conclusion: "success" })]];
    assert.equal(held(ok, [SHA, "feature/x", "286"]).status, 1);
    assert.equal(held(ok, ["abc", BR, "286"]).status, 1);
    assert.equal(held(ok, [SHA, BR, "286;x"]).status, 1);
  });

  test("#286 held runs: the bot never approves, cancels, deletes or re-runs runs and never admin-merges", () => {
    const h = readFileSync("peaceai/bin/await-held-runs.sh", "utf8");
    const code = h.split("\n").filter((l) => !l.trimStart().startsWith("#")).join("\n");
    assert.doesNotMatch(code, /\/approve|run cancel|run delete|run rerun|-X\s*(POST|DELETE|PUT|PATCH)|--method|pr merge/);
    const pr = readFileSync("peaceai/bin/approve-rule-pr.sh", "utf8");
    assert.doesNotMatch(pr, /--admin|--auto|run cancel|run delete|\/approve\b/);
    // The required gate runs first and is unchanged; the retry is the same exact-head squash merge, once.
    assert.ok(pr.indexOf('await-checks.sh" "$sha" $REQUIRED_CHECKS') < pr.indexOf("if ! merge; then"));
    assert.match(pr, /merge\(\) \{ gh pr merge "\$pr" --repo "\$GITHUB_REPOSITORY" --squash --delete-branch --match-head-commit "\$sha" /);
    assert.match(pr, /if ! merge; then\n[\s\S]*?"\$here\/await-held-runs\.sh" "\$sha" "\$branch" "\$pr"[\s\S]*?\n  if ! merge; then\n/);
    assert.equal((pr.match(/\bmerge;/g) ?? []).length, 2);
  });

  test("#286 held runs: human PR checks keep their pull_request triggers; landing job has room for both waits", () => {
    for (const f of ["ci.yml", "leak-check.yml"]) {
      assert.match(read(f), /^on:\n {2}pull_request:\n {4}branches: \[main\]\n/m, f);
      const on = read(f).split(/^on:\n/m)[1]!.split(/^\S/m)[0]!;
      assert.doesNotMatch(on, /branches-ignore|paths-ignore|paths:/, f);
      assert.doesNotMatch(read(f), /peaceai-approve-rule|github\.head_ref/, f);
    }
    const land = jobs(read("peace-approve-rule.yml")).get("results-land")!;
    assert.match(land, /timeout-minutes: 60\b/);
    assert.match(land, /approve-rule-pr\.sh/);
  });
}

test("peace-verdict: record is serialized in ONE global queue (no per-issue key, never cancels, queue: max)", () => {
  const j = jobs(read("peace-verdict.yml"));
  const record = j.get("record")!;
  assert.match(record, /concurrency:\n {6}group: peace-verdict-record-results\n {6}cancel-in-progress: false\n {6}queue: max\n/);
  assert.doesNotMatch(record, /group: peace-verdict-record-results\$\{\{/);
  assert.match(record, /environment: peaceai-results/);
});
