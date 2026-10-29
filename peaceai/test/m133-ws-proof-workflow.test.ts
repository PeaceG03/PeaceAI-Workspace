// #575 self-edit wiring: the Workspace verdict PR carries the exact recorded candidate bytes and a ws-proof
// clause that builder-log/coverage.ts accepts; the Results cross-check job runs coverage with both inputs.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { WS_PROOF } from "../../builder-log/coverage.ts";

const verdict = readFileSync(".github/workflows/peace-verdict.yml", "utf8");
const blog = readFileSync(".github/workflows/builder-log.yml", "utf8");

function job(text: string, name: string): string {
  const body = text.split(/^jobs:\s*$/m)[1] ?? "";
  const start = body.indexOf(`\n  ${name}:\n`);
  assert.ok(start >= 0, `job ${name}`);
  const rest = body.slice(start + 1);
  const next = rest.slice(1).search(/\n {2}[A-Za-z0-9_-]+:\s*\n/);
  return next < 0 ? rest : rest.slice(0, next + 1);
}
function step(jobText: string, name: string): string {
  const i = jobText.indexOf(`- name: ${name}\n`);
  assert.ok(i >= 0, `step ${name}`);
  const rest = jobText.slice(i);
  const next = rest.slice(1).search(/\n {6}- (name|uses|run):/);
  return next < 0 ? rest : rest.slice(0, next + 1);
}

const respond = job(verdict, "respond");
const openPr = step(respond, "Open a PR for the chosen candidate");

test("respond: the Workspace PR step takes run, diff sha and verdict comment from trusted job outputs only", () => {
  assert.match(openPr, /RUN_ID: \$\{\{ needs\.record\.outputs\.run_id \}\}/);
  assert.match(openPr, /DIFF_SHA: \$\{\{ needs\.record\.outputs\.diff_sha256 \}\}/);
  assert.match(openPr, /COMMENT_ID: \$\{\{ needs\.parse\.outputs\.comment_id \}\}/);
  assert.doesNotMatch(openPr, /TARGET_PR_TOKEN|secrets\./, "no PAT on the Workspace path (Auditor limit 1)");
  assert.doesNotMatch(respond, /environment:/, "built-in token path, no environment secret");
  assert.match(respond, /needs: \[parse, record\]/);
});

test("respond: the hash check runs before any branch, apply or push", () => {
  const hash = openPr.indexOf("sha256sum \"$RUNNER_TEMP/chosen/chosen.diff\"");
  assert.ok(hash > 0);
  for (const later of ["git checkout -q -b", "git apply", "git push", "gh pr create"]) assert.ok(openPr.indexOf(later) > hash, later);
});

/** Runs the step's own shell up to (not including) the branch creation, plus its PR body printf. */
function runGate(env: Record<string, string>, diff: string): { ok: boolean; body: string; out: string } {
  const script = openPr.split("run: |\n")[1]!.split("\n").map((l) => l.replace(/^ {10}/, ""));
  const cut = script.findIndex((l) => l.startsWith("branch="));
  const bodyLine = script.find((l) => l.includes("--body"))!.trim().replace(/^--body /, "");
  const dir = mkdtempSync(join(tmpdir(), "m133-"));
  try {
    execFileSync("mkdir", ["-p", join(dir, "chosen")]);
    writeFileSync(join(dir, "chosen", "chosen.diff"), diff);
    const sh = script.slice(0, cut).join("\n") + `\nprintf '%s' ${bodyLine}\n`;
    const out = execFileSync("bash", ["-c", sh], { env: { PATH: process.env.PATH!, RUNNER_TEMP: dir, ...env }, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return { ok: true, body: out, out };
  } catch (e) {
    return { ok: false, body: "", out: String((e as { stdout?: string }).stdout ?? "") };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("respond: matching bytes give a PR body whose ws-proof coverage.ts parses back to the same values", () => {
  const diff = "diff --git a/src/x.ts b/src/x.ts\nnew file mode 100644\n";
  const sha = createHash("sha256").update(diff).digest("hex");
  const r = runGate({ CANDIDATE: "candidate-2", RUN_ID: "18800000001", DIFF_SHA: sha, COMMENT_ID: "3400000001", ISSUE_NUMBER: "700" }, diff);
  assert.ok(r.ok, r.out);
  const m = [...r.body.matchAll(WS_PROOF)];
  assert.equal(m.length, 1, r.body);
  assert.deepEqual(m[0]!.slice(1), ["18800000001", "candidate-2", sha, "3400000001"]);
  assert.match(r.body, /^Candidate chosen by owner review on #700\./);
});

test("respond: wrong, malformed or missing values refuse before any PR", () => {
  const diff = "x\n";
  const sha = createHash("sha256").update(diff).digest("hex");
  const good = { CANDIDATE: "candidate-1", RUN_ID: "1", DIFF_SHA: sha, COMMENT_ID: "2", ISSUE_NUMBER: "1" };
  assert.ok(runGate(good, diff).ok);
  assert.ok(!runGate(good, "y\n").ok, "bytes differ from the record");
  assert.ok(!runGate({ ...good, DIFF_SHA: "" }, diff).ok);
  assert.ok(!runGate({ ...good, DIFF_SHA: sha.toUpperCase() }, diff).ok);
  assert.ok(!runGate({ ...good, RUN_ID: "" }, diff).ok);
  assert.ok(!runGate({ ...good, RUN_ID: "1 verdict 9" }, diff).ok);
  assert.ok(!runGate({ ...good, COMMENT_ID: "2;x" }, diff).ok);
  assert.ok(!runGate({ ...good, CANDIDATE: "bogus" }, diff).ok);
});

test("builder-log: coverage runs in the Results cross-check with the Workspace clone, Results dir and full history", () => {
  const cc = job(blog, "results-crosscheck");
  assert.match(cc, /fetch-depth: 0/);
  const cov = step(cc, "PeaceAI vs Builder coverage (Workspace landings verified against Results)");
  assert.match(cov, /WORKSPACE_CLONE: \$\{\{ github\.workspace \}\}/);
  assert.match(cov, /PEACEAI_RESULTS_DIR: \$\{\{ runner\.temp \}\}\/results/);
  assert.match(cov, /PEACESTOCKS_CLONE: \$\{\{ runner\.temp \}\}\/stocks/);
  assert.match(cov, /tsx builder-log\/coverage\.ts/);
  assert.ok(cc.indexOf("Clone Results read-only") < cc.indexOf("PeaceAI vs Builder coverage"));
  assert.ok(cc.indexOf("PeaceAI vs Builder coverage") < cc.indexOf("Delete the Results clone"));
  assert.doesNotMatch(cov, /secrets\./);
});
