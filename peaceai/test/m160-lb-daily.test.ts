// M160 (limit-breaker step 3): the daily cycle (peaceai/bin/lb-daily-cycle.sh + peaceai/model/daily_cycle.py):
// plan (fail-closed checks) -> train within the budget resuming from the latest verified local save -> evaluate ->
// report. It trains only an Auditor-cleared corpus (lb-train.json), runs only on free compute, and is NOT scheduled:
// no workflow under .github/workflows mentions it. The end-to-end run uses a scratch copy of the model dir with its own
// lb-train.json (the real config cannot be pointed at a test corpus). Every tagged guard is mutation-checked.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import test from "node:test";
import { json, MODEL, mutationCheck, ok, py, repo, runCase, stateHash, tinyCorpus, TINY, withDir } from "./m157-lbtrain-mut.ts";

const SCRIPT = join(repo, "peaceai/bin/lb-daily-cycle.sh");
const sha = (p: string) => createHash("sha256").update(readFileSync(p)).digest("hex");
const ARGS = ["--", ...TINY, "--steps", "8", "--max-steps-this-run", "4"];
const cycle = (script: string, corpus: string, state: string, day: string, extra = ARGS, env: Record<string, string> = {}) =>
  spawnSync("bash", [script, corpus, state, "2", day, ...extra], { encoding: "utf8", env: { ...process.env, PEACEAI_PYTHON: py, ...env } });

function scratch(dir: string, corpus: string) {
  mkdirSync(join(dir, "pkg/model"), { recursive: true }); mkdirSync(join(dir, "pkg/bin"));
  for (const f of readdirSync(MODEL).filter((x) => x.endsWith(".py"))) copyFileSync(join(MODEL, f), join(dir, "pkg/model", f));
  copyFileSync(SCRIPT, join(dir, "pkg/bin/lb-daily-cycle.sh"));
  const cfg = json(join(MODEL, "lb-train.json"));
  cfg.clearedCorpora = [{ docs: sha(join(corpus, "docs.jsonl")), manifest: sha(join(corpus, "manifest.jsonl")), fingerprint: json(join(corpus, "fingerprint.json")).fingerprint }];
  writeFileSync(join(dir, "pkg/model/lb-train.json"), JSON.stringify(cfg));
  return join(dir, "pkg/bin/lb-daily-cycle.sh");
}

test("m160: three days: fresh -> resume -> done, bitwise the uninterrupted run, one report per day", () => withDir((dir) => {
  const corpus = tinyCorpus(dir), st = join(dir, "state"), s = scratch(dir, corpus);
  const d1 = cycle(s, corpus, st, "2026-10-01");
  assert.equal(d1.status, 0, d1.stdout + d1.stderr);
  assert.match(d1.stdout, /^plan fresh start=0\ndaily 2026-10-01 status=trained start=0 end=4 stop=max_steps_this_run best_val=[0-9.]+\n$/);
  const d2 = cycle(s, corpus, st, "2026-10-02");
  assert.equal(d2.status, 0, d2.stdout + d2.stderr);
  assert.match(d2.stdout, /^plan resume start=4 save=save-000000004 sha=[0-9a-f]{64}\ndaily 2026-10-02 status=trained start=4 end=8 stop=steps /);
  const d3 = cycle(s, corpus, st, "2026-10-03");
  assert.equal(d3.status, 0); assert.equal(d3.stdout, "plan done step=8 stop=steps\n");
  ok(["--corpus", corpus, "--work", join(dir, "u"), "--steps", "8"]);
  assert.equal(stateHash(join(st, "work/2026-10-02/checkpoint.npz")), stateHash(join(dir, "u/checkpoint.npz")), "daily chain == one uninterrupted run");
  const r2 = json(join(st, "reports/2026-10-02.json"));
  assert.deepEqual([r2.schema, r2.status, r2.startStep, r2.endStep, r2.more, r2.precision, r2.optimizer, r2.evalOk], ["peaceai-lb-daily:v1", "trained", 4, 8, false, "fp32", "adamw", true]);
  assert.equal(r2.manifestSha256, json(join(st, "chain.json")).manifestSha256);
  assert.equal(r2.stopRule.maxSeconds, 120);
  assert.ok(Number.isFinite(r2.eval.model_bits_per_byte));
  assert.equal(json(join(st, "reports/2026-10-03.json")).status, "done");
  assert.ok(!existsSync(join(st, "work/2026-10-03")), "done trains nothing");
  // near miss: the same day again is refused and the report is untouched
  const before = readFileSync(join(st, "reports/2026-10-03.json"));
  const again = cycle(s, corpus, st, "2026-10-03");
  assert.equal(again.status, 3); assert.equal(again.stdout, "DAILY_ALREADY_RAN\n");
  assert.ok(readFileSync(join(st, "reports/2026-10-03.json")).equals(before));
}));

test("m160: refusals: an uncleared corpus with the real config, owned / unlisted args, a non-free runner, saves without a chain", () => withDir((dir) => {
  const corpus = tinyCorpus(dir), st = join(dir, "state");
  const real = cycle(SCRIPT, corpus, st, "2026-10-01");
  assert.equal(real.status, 3); assert.equal(real.stdout, "DAILY_CORPUS_NOT_CLEARED\n");
  assert.ok(!existsSync(st), "a refusal writes nothing");
  const s = scratch(dir, corpus);
  for (const bad of [["--", "--init-from", "x.npz"], ["--", "--replay-frac", "0.5"], ["--", "--steps"], ["--", "--lora-rank", "4"]]) {
    const r = cycle(s, corpus, st, "2026-10-01", bad);
    assert.deepEqual([r.status, r.stdout], [3, "DAILY_BAD_ARGS\n"], bad.join(" "));
  }
  const r = cycle(s, corpus, st, "2026-10-01", ARGS, { GITHUB_ACTIONS: "true", RUNNER_ENVIRONMENT: "self-hosted" });
  assert.deepEqual([r.status, r.stdout], [3, "DAILY_NOT_FREE_RUNNER\n"]);
  const okRunner = cycle(s, corpus, st, "2026-10-01", ARGS, { GITHUB_ACTIONS: "true", RUNNER_ENVIRONMENT: "github-hosted" });
  assert.equal(okRunner.status, 0, "near miss: a GitHub-hosted runner is free compute");
  writeFileSync(join(st, "chain.json"), "{}");
  const inc = cycle(s, corpus, st, "2026-10-02");
  assert.deepEqual([inc.status, inc.stdout], [3, "DAILY_STATE_INCONSISTENT\n"]);
}));

test("m160: static: real pins are the cleared corpus, not scheduled anywhere, budget within a free runner job", () => {
  const cfg = json(join(MODEL, "lb-train.json"));
  assert.deepEqual(cfg.clearedCorpora.map((c: Record<string, string>) => [c.docs, c.manifest, c.fingerprint]), [[
    "7eb6c62800fd8f6b73192f85d0c93972efce5c02c2c390116a888d29f7737764",
    "e9f78828c3777788294b99fe4b2684d288b7144bed10277b7c53ad8ea54119f7",
    "a3e9165f13ec603e2e1bcb5e0fb99fed1916a60204208ff63b9c6b116ece0bd4",
  ]], "exactly the Auditor-cleared corpus");
  assert.ok(cfg.daily.maxBudgetMin <= 340, "fits a 360 min GitHub-hosted job");
  for (const owned of ["--corpus", "--work", "--save-dir", "--marker", "--resume-from", "--init-from", "--replay-corpus", "--max-seconds", "--deadline", "--lora-rank"]) assert.ok(!cfg.daily.trainArgsAllowed.includes(owned), owned);
  const wf = join(repo, ".github/workflows");
  for (const f of readdirSync(wf)) assert.ok(!/lb-daily-cycle|daily_cycle|lb-train\.json/.test(readFileSync(join(wf, f), "utf8")), `${f} must not run the daily cycle`);
});

test("m160: mutation check: disabling any daily-cycle guard changes its case's outcome", () => {
  assert.match(runCase(MODEL, "near-daily-fresh"), /plan fresh start=0/);
  assert.match(runCase(MODEL, "near-daily-resume"), /plan resume start=4 /);
  assert.match(runCase(MODEL, "near-daily-done"), /plan done /);
  mutationCheck(/^daily-/, {
    "daily-corpus-cleared": "DAILY_CORPUS_NOT_CLEARED", "daily-free-runner": "DAILY_NOT_FREE_RUNNER", "daily-budget": "DAILY_BAD_ARGS", "daily-date": "DAILY_BAD_ARGS",
    "daily-train-args": "DAILY_BAD_ARGS", "daily-saves-without-chain": "DAILY_STATE_INCONSISTENT", "daily-chain-schema": "DAILY_STATE_INCONSISTENT",
    "daily-latest-save": "DAILY_STATE_INCONSISTENT", "daily-once": "DAILY_ALREADY_RAN",
  });
});
