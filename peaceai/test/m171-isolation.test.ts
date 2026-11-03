// M171 (run 41521457458: every task ISOLATION_UNAVAILABLE with 0 attempts, reachedTests 0). The cause was not a path:
// the runner wrapper's first line (`unshare -r -n -m true || exit 97`, loop.ts runnerWrapper) fails as the candidate
// uid on ubuntu-24.04, which restricts unprivileged user namespaces (kernel.apparmor_restrict_unprivileged_userns=1).
// This test runs the M171 loop cases (the per-task 0750 work dir under os.tmpdir(), the isolation checks, the
// isolationFail subcode) and pins and EXECUTES the attempt job's new fail-closed pre-flight step: it must pass on a
// runner-like layout and refuse when the candidate uid can read RUNNER_TEMP, the runner's home or a git-credentials
// file; deleting any of its refusals must make a scenario fail. Synthetic fixtures only; no network.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import * as deps from "../lib/loopdeps.ts";
import * as loop from "../lib/loop.ts";
import * as row from "../lib/looprow.ts";
import { stage2CandUid } from "../lib/selfpropose.ts";
import { CASES, type Both } from "./m171-cases.ts";
import { setup, teardown } from "./m171-fixtures.ts";
import { setup as setup151, teardown as teardown151 } from "./m151-fixtures.ts";

const ROOT = resolve(import.meta.dirname, "../..");
const WF = readFileSync(join(ROOT, ".github/workflows/peace-model-v1-dev.yml"), "utf8");
const CAND = process.env.M171_CAND ?? process.env.M146_CAND ?? "peaceai-cand";
const cand = stage2CandUid({ PEACEAI_STAGE2_CAND: CAND }).ok;
const STEP = "Pre-flight (fail closed) - the candidate uid gets a private work dir and cannot read the runner's files (M171, run 41521457458)";
const SYSCTL_STEP = "Lift the user namespace restriction on this credential-free VM only (M171, Auditor ruling; runner-images#10443)";

let ctx: Both;
before(() => { ctx = { m171: setup(), m151: setup151() }; });
after(() => { teardown(ctx.m171); teardown151(ctx.m151); });

for (const c of CASES) {
  test(`M171: ${c.id}`, (t) => {
    if (c.needsCand && !ctx.m171.cand) { t.skip(c.needsCand); return; }
    c.run({ deps, loop, row }, ctx);
  });
}

function attemptJob(): string {
  const job = WF.slice(WF.indexOf("\n  model-v1-attempt:"));
  const next = /\n  [a-z0-9-]+:\n/.exec(job.slice(1));
  return next ? job.slice(0, next.index + 1) : job;
}
function stepBody(): string {
  const steps = attemptJob();
  const at = steps.indexOf(STEP);
  assert.ok(at > 0, "the M171 pre-flight step is in the attempt job");
  const block = steps.slice(at, steps.indexOf("\n      - name:", at + 1));
  const run = block.slice(block.indexOf("run: |\n") + "run: |\n".length);
  return run.split("\n").map((l) => l.replace(/^ {10}/, "")).join("\n");
}

test("M171 workflow: the pre-flight step sits after the candidate user and the M169 deps step, before the tools go read-only and any loop run", () => {
  const steps = attemptJob();
  const order = [
    steps.indexOf("sudo useradd --system --no-create-home --shell /usr/sbin/nologin peaceai-cand"),
    steps.indexOf("Pre-flight (fail closed) - the candidate uid can traverse and write the deps dir"),
    steps.indexOf(STEP),
    steps.indexOf("Make this runner's tools read-only"),
    steps.indexOf(SYSCTL_STEP),
    steps.indexOf("./node_modules/.bin/tsx peaceai/bin/loop.ts proofs"),
    steps.indexOf("peaceai/bin/loop.ts run"),
  ];
  for (const i of order) assert.ok(i > 0);
  assert.deepEqual([...order].sort((a, b) => a - b), order, "step order");
  assert.match(steps, /persist-credentials: false/, "checkout leaves no credentials behind");
  const body = stepBody();
  assert.match(body, /^set -euo pipefail$/m);
  assert.match(body, /^C=peaceai-cand$/m);
  assert.doesNotMatch(body, /sysctl|unshare/, "the userns change is its own step, right before the loop step");
  assert.match(body, /W=\$\(mktemp -d \/tmp\/peaceai-work-preflight\.XXXXXX\); chmod 750 "\$W"/);
  // never a chmod/chown/chgrp/setfacl on the runner's home, RUNNER_TEMP or the workspace, anywhere in the attempt job
  for (const l of steps.split("\n")) {
    if (/\b(chmod|chown|chgrp|setfacl)\b/.test(l)) assert.doesNotMatch(l, /\/home\/runner|\$HOME|RUNNER_TEMP|GITHUB_WORKSPACE|_temp/, l.trim());
  }
  // fixed words and numbers only (no path, no listing, no file content)
  for (const m of body.matchAll(/echo "([^"]*)"/g)) assert.match(m[1]!, /^(?:refused [A-Z_]+|git-credential files checked=\$n|isolation pre-flight ok)$/, m[1]!);
  assert.doesNotMatch(body, /\bls\b|\bcat "\$f"|\bfind\b[^\n]*-print(?!0)/);
});

// ---- executing the step body on this host: a runner-like layout under a scratch dir, the candidate uid for real

function layout(o: { home: number; temp: number; cred?: [string, number] }) {
  const base = mkdtempSync(join(tmpdir(), "peaceai-m171-wf-"));
  chmodSync(base, 0o755);
  const home = join(base, "runner");
  const temp = join(home, "work/_temp");
  mkdirSync(temp, { recursive: true });
  writeFileSync(join(temp, "git-credentials-0000.config"), "[http]\n\textraheader = AUTHORIZATION: basic bTE3MA==\n", { mode: 0o600 });
  writeFileSync(join(home, ".gitconfig"), "[include]\n\tpath = x\n", { mode: 0o600 });
  if (o.cred) { mkdirSync(dirname(join(home, o.cred[0])), { recursive: true, mode: 0o755 }); writeFileSync(join(home, o.cred[0]), `https://${["x:m171", "github.com"].join("@")}\n`, { mode: o.cred[1] }); }
  chmodSync(join(home, "work"), 0o755);
  chmodSync(temp, o.temp);
  chmodSync(home, o.home);
  return { base, home, temp };
}
function runStep(body: string, l: { home: string; temp: string }, f: string) {
  void f;
  const script = body.replace(/^C=peaceai-cand$/m, `C=${CAND}`);
  const r = spawnSync("bash", ["-c", script], { encoding: "utf8", env: { PATH: process.env.PATH, HOME: l.home, RUNNER_TEMP: l.temp }, timeout: 120_000 });
  return { status: r.status, out: (r.stdout ?? "").trim().split("\n").pop() ?? "", all: r.stdout ?? "" };
}
const SCENARIOS: { id: string; o: Parameters<typeof layout>[0]; want: string }[] = [
  { id: "runner-like (home 0750, _temp 0700, credential files 0600)", o: { home: 0o750, temp: 0o700 }, want: "isolation pre-flight ok" },
  { id: "RUNNER_TEMP readable by the candidate", o: { home: 0o711, temp: 0o755 }, want: "refused CAND_READS_RUNNER_TEMP" },
  { id: "RUNNER_TEMP only traversable by the candidate", o: { home: 0o711, temp: 0o711 }, want: "refused CAND_READS_RUNNER_TEMP" },
  { id: "the runner's home readable by the candidate", o: { home: 0o755, temp: 0o700 }, want: "refused CAND_READS_RUNNER_HOME" },
  { id: "a git-credentials file elsewhere under the home the candidate can read (found by name)", o: { home: 0o711, temp: 0o700, cred: ["work/git-credentials-other.config", 0o644] }, want: "refused CAND_READS_GIT_CREDENTIALS" },
  { id: "git's own credential store the candidate can read (a fixed path)", o: { home: 0o711, temp: 0o700, cred: [".config/git/credentials", 0o644] }, want: "refused CAND_READS_GIT_CREDENTIALS" },
];
function scenarioFails(body: string, f: string): string[] {
  const bad: string[] = [];
  for (const s of SCENARIOS) {
    const l = layout(s.o);
    try { const r = runStep(body, l, f); if (r.out !== s.want || (r.status === 0) !== s.want.endsWith(" ok")) bad.push(`${s.id}: ${r.out} (${r.status})`); }
    finally { chmodSync(l.home, 0o755); rmSync(l.base, { recursive: true, force: true }); }
  }
  return bad;
}

test("M171 workflow: the pre-flight passes on a runner-like layout and refuses each way the candidate could read the runner's files", (t) => {
  if (!cand) { t.skip("needs the stage-2 candidate uid and sudo (box / private job)"); return; }
  const scratch = mkdtempSync(join(tmpdir(), "peaceai-m171-f-"));
  try {
    const zero = join(scratch, "restrict");
    writeFileSync(zero, "0\n");
    assert.deepEqual(scenarioFails(stepBody(), zero), []);
    const l = layout({ home: 0o750, temp: 0o700 });
    try {
      const r = runStep(stepBody(), l, zero);
      assert.match(r.all, /^git-credential files checked=2$/m, "the _temp credentials file and ~/.gitconfig were checked");
    } finally { chmodSync(l.home, 0o755); rmSync(l.base, { recursive: true, force: true }); }
  } finally { rmSync(scratch, { recursive: true, force: true }); }
});

test("M171 workflow mutation: deleting any refusal line of the pre-flight makes a scenario fail", (t) => {
  if (!cand) { t.skip("needs the stage-2 candidate uid and sudo (box / private job)"); return; }
  const scratch = mkdtempSync(join(tmpdir(), "peaceai-m171-f-"));
  try {
    const zero = join(scratch, "restrict");
    writeFileSync(zero, "0\n");
    const lines = stepBody().split("\n");
    const refusals = lines.flatMap((l, i) => /refused CAND_READS_/.test(l) ? [i] : []);
    assert.equal(refusals.length, 4, "RUNNER_TEMP, home, found credential files, fixed credential paths");
    for (const i of refusals) {
      const body = lines.filter((_, j) => j !== i).join("\n");
      assert.ok(scenarioFails(body, zero).length > 0, `no scenario notices: ${lines[i]!.trim()}`);
    }
  } finally { rmSync(scratch, { recursive: true, force: true }); }
});

test("M171 static: the loop names the private roots, and gives the candidate no other way in", () => {
  const src = readFileSync(join(ROOT, "peaceai/lib/loop.ts"), "utf8");
  assert.match(src, /for \(const p of \[homedir\(\), env\.RUNNER_TEMP, root\]\)/);
  assert.match(src, /work = openWorkDir\(cand, o\.workBase\);/);
  assert.match(src, /c = o\.fetcher\(task\.repo, task\.commit, task\.reference\.from\.merge, task\.tests\.files, work\.dir\);/);
  assert.doesNotMatch(src, /isolation\s*=\s*true|fallback/i, "no path runs the tests without the isolation");
  const ds = readFileSync(join(ROOT, "peaceai/lib/loopdeps.ts"), "utf8");
  assert.match(ds, /chmodSync\(dir, 0o750\);/);
});
