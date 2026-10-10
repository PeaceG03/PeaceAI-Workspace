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

test("issue text reaches steps only through env", () => {
  for (const f of files) {
    for (const line of read(f).split("\n")) {
      if (/github\.event\.(issue|pull_request|comment)\.(title|body)|head_ref|pull_request\.head\.ref/.test(line))
        assert.match(line, /^\s+[A-Z_]+: \$\{\{/, `${f}: ${line.trim()}`);
    }
  }
});

test("peace-task: owner/label/kill-switch gate, concurrency, core env only on Job A, no Results key", () => {
  const text = read("peace-task.yml");
  const j = jobs(text);
  assert.match(text, /concurrency:\n {2}group: peace-task/);
  const a = j.get("generate")!;
  for (const cond of ["github.event.label.name == 'peace-task'", "github.event.issue.user.login == 'PeaceG03'", "github.event.sender.login == 'PeaceG03'", "vars.PEACEAI_ENABLED == 'true'"])
    assert.ok(a.includes(cond), cond);
  assert.match(a, /environment: peaceai-core/);
  assert.ok(a.indexOf("Kill switch") >= 0 && a.indexOf("Kill switch") < a.indexOf("clone-core.sh"), `kill switch before core clone ${a.indexOf("Kill switch")} ${a.indexOf("clone-core.sh")}`);
  assert.ok(a.indexOf("Delete core") < a.indexOf("Upload candidates"));
  assert.ok(a.indexOf("gate.ts") < a.indexOf("Upload candidates"));
  for (const [name, block] of j) if (name !== "generate") assert.ok(!/environment:|secrets\./.test(block), name);
  assert.ok(!text.includes("PEACEAI_RESULTS_DEPLOY_KEY") && !text.includes("environment: peaceai-results"));
  assert.match(j.get("test")!, /permissions:\n {6}contents: read\n/);
  assert.match(text, /retention-days: 1/);
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
