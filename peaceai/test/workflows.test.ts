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
        assert.match(line, /^\s+[A-Z_]+: \$\{\{|^\s+startsWith\(github\.event\.comment\.body, '\/verdict'\)$/, `${f}: ${line.trim()}`);
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

test("peace-task: serialized sweep, core env only on Job A, Results env only on Job C, review needs Job C", () => {
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
  const c = j.get("record")!;
  assert.match(c, /environment: peaceai-results/);
  assert.match(c, /PEACEAI_RESULTS_DEPLOY_KEY/);
  for (const [name, block] of j) {
    if (name !== "generate") assert.ok(!block.includes("peaceai-core") && !block.includes("CORE_DEPLOY_KEY"), name);
    if (name !== "record") assert.ok(!block.includes("environment: peaceai-results") && !block.includes("RESULTS_DEPLOY_KEY"), name);
  }
  assert.match(j.get("review")!, /needs: \[select, record\]\n\s+if: needs\.record\.result == 'success'/);
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
