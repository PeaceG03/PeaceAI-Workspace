import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";

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
    if (name !== "generate" && name !== "regate") assert.ok(!block.includes("peaceai-core") && !block.includes("CORE_DEPLOY_KEY"), name);
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
  assert.match(respond, /group: peace-verdict-respond-\$\{\{ github\.event\.issue\.number \}\}/);
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
  assert.match(wf, /no candidates generated for this task/);
  assert.match(wf, /NO_CANDIDATES: \$\{\{ needs\.generate\.result == 'success' && needs\.generate\.outputs\.candidates == '0'/);
});

test("M3.1 peace-verdict: no retrain after [test] verdicts; withdrawn PRs labelled and unlabelled", () => {
  const wf = read("peace-verdict.yml");
  const train = wf.slice(wf.indexOf("\n  train:"));
  assert.match(train, /if: needs\.record\.outputs\.status == 'recorded' && needs\.record\.outputs\.test != 'true'/);
  assert.match(wf, /test: \$\{\{ steps\.record\.outputs\.test \}\}/);
  const respond = wf.slice(wf.indexOf("\n  respond:"), wf.indexOf("\n  train:"));
  assert.match(respond, /--json number,headRefName,labels/);
  assert.match(respond, /WITHDREW: \$\{\{ needs\.record\.outputs\.withdrew \}\}/);
  assert.match(respond, /if: steps\.guard\.outputs\.mark != ''[\s\S]*gh label create verdict-withdrawn[\s\S]*--add-label verdict-withdrawn[\s\S]*Do not merge it\./);
  assert.match(respond, /if: steps\.guard\.outputs\.unmark != ''[\s\S]*--remove-label verdict-withdrawn/);
  assert.ok(respond.indexOf("Mark PRs whose verdict") < respond.indexOf("- name: Reply"));
});
