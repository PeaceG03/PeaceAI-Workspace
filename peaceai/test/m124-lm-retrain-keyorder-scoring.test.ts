// M124 (after live run 40624227227, Builder + Auditor 2026-10-28).
// 1. False refusal: select.json is written by sweep_select.py with json.dumps(sort_keys=True), but the candidate
//    summary.json (lm-retrain-train.sh) keeps jq's insertion order ({docsSha256, docsBytes, manifestSha256}), and the
//    finetune-eval-land checks compared raw `jq -c` strings, so identical replay corpora were refused ("candidate used a
//    different replay corpus: refused"). The three checks (valSplit, replay.val, replay.corpus) now compare `jq -cS`
//    (sorted keys) on both sides: reordered keys pass, any changed value still refuses.
// 2. Scoring deadline: the candidate fine-tune took 14461 s (sweep: 8231 s for the same 1200 steps) in a 350-minute job,
//    and set C + judge scoring had no deadline. Scoring now ends by JOB_START + pretrain.budget.finalJobSeconds -
//    eval.scoringReserveSeconds; a command still running is killed, its partial output removed, scoring stops, the gate
//    lands a "no candidate" record (failed: scoring_deadline) and the job ends red (so retrain-outcome is red).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { protectedReason } from "../lib/selfchange.ts";

const repo = resolve(import.meta.dirname, "..", "..");
const read = (p: string) => readFileSync(join(repo, p), "utf8");
const CFG = JSON.parse(read("peaceai/model/lm-retrain.json"));
const WF = read(".github/workflows/peace-lm-retrain.yml");
const tmp = (fn: (d: string) => void) => { const d = mkdtempSync(join(tmpdir(), "m124-")); try { fn(d); } finally { rmSync(d, { recursive: true, force: true }); } };
const job = (j: string) => { const i = WF.indexOf(`\n  ${j}:\n`); assert.ok(i > 0, j); const rest = WF.slice(i + 1); const n = rest.slice(1).search(/\n  [a-z][a-z-]*:\n/); return n < 0 ? rest : rest.slice(0, n + 1); };
const env0 = (over: Record<string, string | undefined>) => { const e: Record<string, string> = {}; for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !(k in over)) e[k] = v; for (const [k, v] of Object.entries(over)) if (v !== undefined) e[k] = v; return e; };
const block = (text: string, start: string, end: RegExp) => { const i = text.indexOf(start); assert.ok(i >= 0, start); const rest = text.slice(i + start.length); const j = rest.search(end); return j < 0 ? rest : rest.slice(0, j); };
const dedent = (t: string, n: number) => t.split("\n").map((l) => l.slice(Math.min(n, l.length - l.trimStart().length))).join("\n");
const LAND = job("finetune-eval-land");
const stepRun = (name: string) => dedent(block(block(LAND, `      - name: ${name}`, /\n      - name: /), "        run: |\n", /$^/), 10);
const NOW = () => Math.floor(Date.now() / 1000);

// ---- 1. key order
const CHECKS = LAND.split("\n").filter((l) => /^\s+test "\$\(jq -cS? [^\n]*ftwork\/summary\.json"\)" = /.test(l)).map((l) => l.trim());

test("M124 the three candidate checks compare sorted-key JSON (jq -cS) on both sides; no raw jq -c compare is left", () => {
  assert.equal(CHECKS.length, 3, "valSplit, replay.val, replay.corpus");
  for (const [l, field] of [[CHECKS[0]!, ".valSplit"], [CHECKS[1]!, ".replay.val"], [CHECKS[2]!, ".replay.corpus"]] as const) {
    assert.ok(l.startsWith(`test "$(jq -cS ${field} "$RUNNER_TEMP/ftwork/summary.json")" = "$(jq -cS `), l);
    assert.equal((l.match(/jq -cS /g) ?? []).length, 2, l); assert.doesNotMatch(l, /jq -c /, l);
  }
  assert.doesNotMatch(WF, /test "\$\(jq -c [^\n]*\)" = "\$\(jq -c /, "no raw jq -c string compare anywhere in the workflow");
  // the two writers really differ in key order (the cause of the false refusal)
  assert.match(read("peaceai/model/sweep_select.py"), /"rule": ft\["sweep"\]\["select"\]\}, sort_keys=True\)\)/);
  assert.match(read("peaceai/bin/lm-retrain-train.sh"), /\{corpus: \{docsSha256: \$ds, docsBytes: \$db, manifestSha256: \$ms\}\}/);
});

const corpus = { docsSha256: "d".repeat(64), docsBytes: 78555701, manifestSha256: "m".repeat(64) };
const val = { windows: 64, docs: 64, sha256: "v".repeat(64) };
const valSplit = { sha256: "s".repeat(64), docs: 96, seed: "peaceai-val:v1" };
const sorted = (o: unknown): unknown => Array.isArray(o) ? o.map(sorted) : o && typeof o === "object" ? Object.fromEntries(Object.keys(o).sort().map((k) => [k, sorted((o as any)[k])])) : o;
const reversed = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).reverse());
function runChecks(d: string, cand: { valSplit: object; val: object; corpus: object }, lines = CHECKS) {
  const rt = join(d, "rt"); mkdirSync(join(rt, "ftwork"), { recursive: true });
  // candidate summary.json: jq insertion order, as lm-retrain-train.sh writes it
  writeFileSync(join(rt, "ftwork", "summary.json"), JSON.stringify({ valSplit: cand.valSplit, mode: "pretrain", replay: { replayFrac: 1, val: cand.val, corpus: cand.corpus } }));
  // select.json: sort_keys=True, as sweep_select.py writes it
  writeFileSync(join(rt, "select.json"), JSON.stringify(sorted({ mode: "pretrain", validationSplit: valSplit, arms: [{ arm: 0, replay: { replayFrac: 1, val, corpus } }] })));
  return spawnSync("bash", ["-c", `set -euo pipefail\n${lines.join("\n")}\necho CHECKS-OK`], { encoding: "utf8", env: env0({ RUNNER_TEMP: rt }) });
}

test("M124 identical values with reordered keys pass (the 40624227227 false refusal); raw jq -c would have refused", () => tmp((d) => {
  const cand = { valSplit: reversed(valSplit), val: reversed(val), corpus };
  const r = runChecks(d, cand); assert.equal(r.status, 0, r.stdout + r.stderr); assert.match(r.stdout, /CHECKS-OK/);
  // the live shape: valSplit and val already in sorted order, only the corpus in jq insertion order
  const live = { valSplit: sorted(valSplit) as object, val: sorted(val) as object, corpus };
  const now = runChecks(d, live); assert.equal(now.status, 0, now.stdout + now.stderr);
  const old = runChecks(d, live, CHECKS.map((l) => l.replace(/jq -cS /g, "jq -c ")));
  assert.equal(old.status, 1); assert.match(old.stdout, /candidate used a different replay corpus: refused/, "the old compare reproduces the live failure");
}));

test("M124 a changed value still refuses (docsBytes, docsSha256, manifestSha256, validation windows, validation split)", () => tmp((d) => {
  const base = { valSplit, val, corpus };
  for (const [name, cand, why] of [
    ["docsBytes", { ...base, corpus: { ...corpus, docsBytes: corpus.docsBytes + 1 } }, /candidate used a different replay corpus: refused/],
    ["docsSha256", { ...base, corpus: { ...corpus, docsSha256: "e".repeat(64) } }, /candidate used a different replay corpus: refused/],
    ["manifestSha256", { ...base, corpus: reversed({ ...corpus, manifestSha256: "n".repeat(64) }) }, /candidate used a different replay corpus: refused/],
    ["extra corpus key", { ...base, corpus: { ...corpus, extra: 1 } }, /candidate used a different replay corpus: refused/],
    ["number type", { ...base, corpus: { ...corpus, docsBytes: String(corpus.docsBytes) } }, /candidate used a different replay corpus: refused/],
    ["val windows", { ...base, val: reversed({ ...val, windows: 63 }) }, /candidate used different validation windows: refused/],
    ["valSplit sha", { ...base, valSplit: reversed({ ...valSplit, sha256: "t".repeat(64) }) }, /candidate used a different validation split: refused/],
  ] as const) {
    const r = runChecks(d, cand as never); assert.equal(r.status, 1, name); assert.match(r.stdout, why, name); assert.doesNotMatch(r.stdout, /CHECKS-OK/, name);
  }
}));

// ---- 2. scoring deadline
const SCORE = "Score live and candidate in this run (same set C v2 byte slice, same judge v2 items, same code)";
const GATE = "Gate (slice identical and pinned; 0 eval overlap; scorer reproduces the live record; candidate set C bpb <= live - eval.minBpbGain; judge AUC report-only)";
const STUB = `#!/usr/bin/env bash
kind=; who=; out=
for a in "$@"; do case "$a" in *eval_c.py) kind=setc;; *judge364.py) kind=judge;; esac; done
while [ $# -gt 0 ]; do case "$1" in --model) who=$(basename "$2"); shift;; --out) out=$2; shift;; esac; shift; done
echo "$kind-$who" >> "$STUB_LOG"
[ "\${STUB_FAIL-}" = "$kind-$who" ] && { echo "stub failure" >&2; exit 3; }
if [ "\${STUB_SLOW-}" = "$kind-$who" ]; then echo partial; [ -n "$out" ] && echo partial > "$out"; exec sleep 60; fi
if [ "$kind" = setc ]; then
  bpb=1.6506; [ "$who" = model ] && bpb=1.6400
  echo "setc model=$who slice_sha256=$SLICE bytes=1 bits_per_byte=$bpb"
else echo '{"summary": {"n": 1}}' > "$out"; fi
`;
function fixture(d: string, candidate: boolean) {
  const rt = join(d, "rt"); for (const x of ["evals", "w", "r", "venv/bin", "live", "model"]) mkdirSync(join(rt, x), { recursive: true });
  writeFileSync(join(rt, "venv/bin/python"), STUB); chmodSync(join(rt, "venv/bin/python"), 0o755);
  const sel = { mode: "pretrain", validationSplit: valSplit, selected: candidate ? { arm: 0, lr: 0.00015, step: 1200, candidate: true, result: "selected" } : { arm: null, lr: null, step: 0, candidate: false, result: "no candidate" }, arms: [{ arm: 0, replay: { val, corpus } }] };
  writeFileSync(join(rt, "select.json"), JSON.stringify(sorted(sel)));
  if (candidate) {
    writeFileSync(join(rt, "candidate-train.json"), JSON.stringify({ mode: "pretrain", stoppedStep: 1200, bestStep: 1200, timing: { seconds: 14461 }, replay: { corpus } }));
    writeFileSync(join(rt, "model", "config.json"), JSON.stringify({ version: "lm-v1-0123456789ab" })); writeFileSync(join(rt, "model", "weights.npz"), "w");
  }
  writeFileSync(join(rt, "r", "scores-live-recorded.json"), "{}"); writeFileSync(join(rt, "r", "judge-commit.txt"), "0".repeat(40));
  writeFileSync(join(rt, "w", "dedup.json"), JSON.stringify({ recheckOverlapDocs: 0 }));
  writeFileSync(join(rt, "w", "replay-proof.json"), JSON.stringify({ replayDocsSha256: corpus.docsSha256, replayDocsBytes: corpus.docsBytes, trainBytes: 1, valBytes: 1 }));
  for (const f of ["w/ft-prepare.json", "w/replay-plan.json", "corefree-proof-finetune.json"]) writeFileSync(join(rt, f), "{}");
  writeFileSync(join(rt, "out"), ""); writeFileSync(join(rt, "stub.log"), "");
  return rt;
}
const base = (rt: string, cand: boolean, over: Record<string, string | undefined>) => env0({ RUNNER_TEMP: rt, CFG: "peaceai/model/lm-retrain.json", MODE: "pretrain", CAND: cand ? "true" : "false",
  GITHUB_OUTPUT: join(rt, "out"), GITHUB_RUN_ID: "1", GITHUB_SHA: "a".repeat(40), STUB_LOG: join(rt, "stub.log"), SLICE: CFG.eval.setcSliceSha256, ...over });
const score = (rt: string, cand: boolean, over: Record<string, string | undefined>) => spawnSync("bash", ["-e", "-c", stepRun(SCORE)], { cwd: repo, encoding: "utf8", env: base(rt, cand, over) });
const gate = (rt: string, cand: boolean) => spawnSync("bash", ["-e", "-c", stepRun(GATE)], { cwd: repo, encoding: "utf8", env: base(rt, cand, {}) });
const result = (rt: string) => spawnSync("bash", ["-e", "-c", stepRun("Result (fail unless the gate passed)")], { encoding: "utf8", env: env0({ PASS: /^pass=(.*)$/m.exec(readFileSync(join(rt, "out"), "utf8"))![1] }) });
// JOB_START so that the scoring deadline is `left` seconds from now
const startFor = (left: number) => String(NOW() - CFG.pretrain.budget.finalJobSeconds + CFG.eval.scoringReserveSeconds + left);
const rec = (rt: string) => JSON.parse(readFileSync(join(rt, "evals", "record.json"), "utf8"));

test("M124 config: the scoring deadline is the job timeout minus a reserve kept for the gate and the landing", () => {
  const js = CFG.pretrain.budget.finalJobSeconds, rs = CFG.eval.scoringReserveSeconds;
  assert.equal(js, Number(/\n    timeout-minutes: (\d+)\n/.exec(LAND)![1]) * 60, "finalJobSeconds is this job's timeout");
  assert.ok(Number.isInteger(rs) && rs >= 900 && rs < CFG.pretrain.budget.finalReserveSeconds, "reserve: at least 15 minutes, inside the training reserve");
  assert.match(CFG.eval.scoringDeadlineRule, /no-candidate record \(failed: scoring_deadline\) and the job ends red/);
  const s = stepRun(SCORE);
  assert.match(s, /dl=\$\(\(JOB_START \+ js - rs\)\)/);
  assert.match(s, /by_deadline\(\) \{ local left=\$\(\(dl - \$\(date \+%s\)\)\); \[ "\$left" -gt 0 \] \|\| return 124; timeout -k 30 "\$left" "\$@"; \}/);
  for (const t of ["eval_c.py", "judge364.py"]) assert.match(s, new RegExp(`by_deadline "\\$py" peaceai/model/${t.replace(".", "\\.")} `), `${t} runs under the deadline`);
  assert.doesNotMatch(s.replace(/by_deadline "\$py"/g, ""), /"\$py" peaceai\/model\/(eval_c|judge364)\.py/, "no scoring command outside the deadline");
});

test("M124 scoring in time: both models scored, no cut marker, gate unchanged", () => tmp((d) => {
  const rt = fixture(d, true);
  const s = score(rt, true, { JOB_START: String(NOW()) }); assert.equal(s.status, 0, s.stdout + s.stderr);
  assert.equal(readFileSync(join(rt, "stub.log"), "utf8"), "setc-live\njudge-live\nsetc-model\njudge-model\n");
  assert.equal(existsSync(join(rt, "scoring-cut.txt")), false);
  for (const f of ["setc-live.txt", "judge-live.json", "setc-model.txt", "judge-model.json"]) assert.ok(existsSync(join(rt, "evals", f)), f);
  const g = gate(rt, true); assert.equal(g.status, 0, g.stdout + g.stderr);
  const r = rec(rt); assert.deepEqual(r.gate.scoringDeadline, { cut: false, during: null, reserveSeconds: CFG.eval.scoringReserveSeconds });
  assert.ok(!r.gate.failed.includes("scoring_deadline")); assert.equal(r.candidate, "lm-v1-0123456789ab"); assert.equal(r.setcV2.bitsPerByte.candidate, 1.64);
}));

test("M124 deadline reached while scoring the candidate: killed, partial output removed, no-candidate record lands, job ends red", () => tmp((d) => {
  const rt = fixture(d, true);
  const t0 = Date.now();
  const s = score(rt, true, { JOB_START: startFor(3), STUB_SLOW: "setc-model" });
  assert.equal(s.status, 0, s.stdout + s.stderr); assert.ok(Date.now() - t0 < 30000, "killed at the deadline, not after the stub's 60 s");
  assert.match(s.stdout, /scoring deadline \(\d+\) reached while scoring model: scoring stopped; no candidate; the record still lands and the job ends red/);
  assert.equal(readFileSync(join(rt, "scoring-cut.txt"), "utf8"), "model\n");
  assert.equal(existsSync(join(rt, "evals", "setc-model.txt")), false, "partial candidate output removed");
  assert.equal(readFileSync(join(rt, "stub.log"), "utf8"), "setc-live\njudge-live\nsetc-model\n", "judge never started for the candidate");
  const g = gate(rt, true); assert.equal(g.status, 0, g.stdout + g.stderr);
  const r = rec(rt);
  assert.deepEqual([r.gate.pass, r.gate.result, r.promoted, r.candidate, r.candidateWeightsSha256], [false, "no candidate", false, null, null]);
  assert.ok(r.gate.failed.includes("scoring_deadline") && r.gate.failed.includes("no_candidate"), r.gate.failed.join(" "));
  assert.deepEqual(r.gate.scoringDeadline, { cut: true, during: "model", reserveSeconds: CFG.eval.scoringReserveSeconds });
  assert.equal(r.candidateTraining.timing.seconds, 14461, "the real candidate training summary is kept as evidence");
  assert.deepEqual([r.setcV2.bitsPerByte.live, r.setcV2.bitsPerByte.candidate], [1.6506, 1.6506], "no candidate score: the live weights stand in, gain 0");
  const out = readFileSync(join(rt, "out"), "utf8"); assert.match(out, /^pass=false$/m); assert.doesNotMatch(out, /^version=/m, "no model landed, no memcheck");
  const res = result(rt); assert.equal(res.status, 1); assert.match(res.stdout, /gate FAILED: record landed, candidate not landed/);
}));

test("M124 no time left before scoring (or cut while scoring live): the record still lands with no scores and the job ends red", () => tmp((d) => {
  for (const [name, over, log] of [
    ["deadline already passed", { JOB_START: startFor(-5) }, ""],
    ["cut during the live judge", { JOB_START: startFor(3), STUB_SLOW: "judge-live" }, "setc-live\njudge-live\n"],
  ] as const) {
    rmSync(join(d, "rt"), { recursive: true, force: true }); const rt = fixture(d, true);
    const s = score(rt, true, over); assert.equal(s.status, 0, name + s.stdout + s.stderr);
    assert.equal(readFileSync(join(rt, "scoring-cut.txt"), "utf8"), "live\n", name);
    assert.equal(readFileSync(join(rt, "stub.log"), "utf8"), log, name);
    for (const f of ["setc-live.txt", "judge-live.json", "setc-model.txt", "judge-model.json"]) assert.equal(existsSync(join(rt, "evals", f)), false, `${name}: ${f}`);
    const g = gate(rt, true); assert.equal(g.status, 0, name + g.stdout + g.stderr);
    const r = rec(rt);
    assert.deepEqual([r.gate.pass, r.gate.result, r.candidate, r.setcV2.bitsPerByte.live, r.setcV2.bitsPerByte.candidate, r.judge.live], [false, "no candidate", null, null, null, null], name);
    assert.deepEqual(r.gate.scoringDeadline.during, "live", name);
    assert.equal(result(rt).status, 1, `${name}: red`);
  }
}));

test("M124 a scoring failure that is not the deadline still fails the step (no record, red)", () => tmp((d) => {
  const rt = fixture(d, true);
  const s = score(rt, true, { JOB_START: String(NOW()), STUB_FAIL: "setc-model" });
  assert.equal(s.status, 3, s.stdout + s.stderr); assert.match(s.stdout, /scoring model failed \(exit 3\)/);
  assert.equal(existsSync(join(rt, "scoring-cut.txt")), false);
  for (const bad of [undefined, "", "abc", "12"]) {
    const r = score(fixture(join(d, `b${bad}`), true), true, { JOB_START: bad }); assert.equal(r.status, 1, String(bad)); assert.match(r.stdout, /no job clock \(JOB_START\): refused/);
  }
}));

test("M124 wiring: the record step stays unconditional after the score step, the result step turns a cut red, retrain-outcome needs it", () => {
  const sc = LAND.indexOf(`      - name: ${SCORE}`), ga = LAND.indexOf(`      - name: ${GATE}`), la = LAND.indexOf("      - name: Land the run record"), re = LAND.indexOf("      - name: Result (fail unless the gate passed)");
  assert.ok(sc > 0 && sc < ga && ga < la && la < re);
  for (const [a, b] of [[sc, ga], [ga, la], [la, re]]) assert.doesNotMatch(LAND.slice(a, b), /\n        if:|continue-on-error/);
  assert.match(LAND, /result: \(if \$sc != "true" and \$sel\[0\]\.selected\.candidate == true then \(if \$ok == "true" then "pass" else "fail" end\) else "no candidate" end\)/);
  const o = spawnSync("bash", ["peaceai/bin/lm-retrain-outcome.sh"], { cwd: repo, encoding: "utf8", env: env0({ DRY_RUN: "false", SEL: "failure", MC: "skipped", REC: "skipped" }) });
  assert.equal(o.status, 1); assert.match(o.stdout, /RED/);
});

test("M124 new test file is protected", () => { assert.ok(protectedReason("peaceai/test/m124-lm-retrain-keyorder-scoring.test.ts")); });
