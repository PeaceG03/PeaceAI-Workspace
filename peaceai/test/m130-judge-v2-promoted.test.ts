// M130 judge v2 promoted pin (Auditor, after #571): the promoted model (lm-v1-858573767465, Results latest.json at
// 0d86e8c) gets its own judge v2 entry, judge-v2.json promoted, with the AUC 0.298 and CI [0.227, 0.374] exactly as its
// run record (runs/lm-retrain/40694718190/record.json, sha256 56a1636f...) recorded them, beside .live, which is unchanged
// and stays tied to lm-retrain.json replayBase. peace-lm-judge-v2-promoted.yml restores the model by its weights sha256
// (lm-judge-v2-promoted.sh, never lm-retrain-live.sh), requires latest.json and lm-retrain.json promoted to name it,
// rescores it with judge364.py, requires per-item agreement with the run's judge-model.json (judge_repro.py) and the AUC
// and CI to equal the pin and the record exactly (judge_promoted_check.py), and lands one new file only. Report-only.
// Fixtures only: no real model, scoring, record or Results.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { protectedReason } from "../lib/selfchange.ts";

const repo = resolve(import.meta.dirname, "..", "..");
const read = (p: string) => readFileSync(join(repo, p), "utf8");
const H = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");
const CFG = JSON.parse(read("peaceai/model/lm-retrain.json"));
const V2 = JSON.parse(read("peaceai/model/judge-v2.json"));
const WFP = ".github/workflows/peace-lm-judge-v2-promoted.yml";
const WF = read(WFP);
const tmp = (fn: (d: string) => void) => { const d = mkdtempSync(join(tmpdir(), "m130-")); try { fn(d); } finally { rmSync(d, { recursive: true, force: true }); } };
const json = (p: string, x: unknown) => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, JSON.stringify(x, null, 1) + "\n"); };
const git = (cwd: string, ...a: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "init.defaultBranch=main", ...a], { cwd, encoding: "utf8" }).trim();
const block = (text: string, start: string, end: RegExp) => { const i = text.indexOf(start); assert.ok(i >= 0, start); const rest = text.slice(i + start.length); const j = rest.search(end); return j < 0 ? rest : rest.slice(0, j); };
const dedent = (t: string, n: number) => t.split("\n").map((l) => l.slice(Math.min(n, l.length - l.trimStart().length))).join("\n");
const stepRun = (name: string) => dedent(block(block(WF, `      - name: ${name}`, /\n      - name: |\n\n  [a-z]/), "        run: |\n", /$^/), 10);
const PY = process.env.PEACEAI_PYTHON ?? "python3";

const PROMOTED = "lm-v1-858573767465", RUN = "40694718190";
const RECORD = "56a1636fa9f6ffe9fd48205945815b92b601340cc55499f376399de4ad4e935c";
const WEIGHTS = "858573767465fbede9c9f1ea0d1e6a3e8c8830c70a07ff358c74783a26119255";
const JUDGE_MODEL = "2dc1e6706f70c659925add3f40b402cd130df9970d2230ae0445d46faa61731d";
const LAND = "Land lm-judge-v2/scores-<promoted>.json in Results (one new file only; nothing else changes)";
const RESCORE = "Rescore the promoted model on the v2 items (per-item agreement with the run's judge-model.json; AUC and CI exactly the pin and the record)";
const PINS = "Check the promoted pins against the retrain config (judge-v2.json promoted = lm-retrain.json promoted; live stays the replay base)";

test("M130 pin: judge-v2.json promoted is 858573 with the record's AUC 0.298 and CI [0.227, 0.374], its record, judge-model.json and weights shas; .live is unchanged", () => {
  assert.deepEqual({ ...V2.promoted, note: undefined }, { version: PROMOTED, runId: RUN, weightsSha256: WEIGHTS, recordSha256: RECORD, judgeModelSha256: JUDGE_MODEL,
    auc: 0.298, auc_ci95: [0.227, 0.374], scores: `lm-judge-v2/scores-${PROMOTED}.json`, note: undefined });
  assert.equal(V2.promoted.version, `lm-v1-${V2.promoted.weightsSha256.slice(0, 12)}`);
  for (const k of ["version", "runId", "recordSha256"]) assert.equal(V2.promoted[k], CFG.promoted[k], `matches lm-retrain.json promoted.${k} (#571)`);
  // .live: the same pin as before, still the replay base, and the judge-v2 workflow's check of it is unchanged
  assert.deepEqual(V2.live, { version: "lm-v1-088073d41dbc", auc: 0.175, auc_ci95: [0.116, 0.237] });
  assert.equal(V2.live.version, CFG.replayBase.version); assert.notEqual(V2.promoted.version, V2.live.version);
  assert.deepEqual(Object.keys(V2), ["schema", "note", "sources", "sourcesSha256", "out", "items", "dropped", "relabelled", "live", "promoted"]);
  assert.deepEqual(V2.items, { sha256: "1deadaaea1992ad18e533595218c9c0953128615c18c9ce0d24dc58d505da2b8", n: 230, right: 73, wrong: 157 });
  const J = read(".github/workflows/peace-lm-judge-v2.yml").split("\n");
  assert.equal(J[60], `          test "$(jq -r .live.version "$V2")" = "$(jq -r .replayBase.version "$CFG")" || { echo "v2 pins are not for the configured live model: refused"; exit 1; }`, "peace-lm-judge-v2.yml:61 unchanged");
  assert.doesNotMatch(read(".github/workflows/peace-lm-judge-v2.yml"), /promoted/, "the live judge-v2 workflow does not read the promoted entry");
});

// ---- lm-judge-v2-promoted.sh against a fixture Results repo
const W0 = "fixture-promoted-weights", WS = H(W0), PV = `lm-v1-${WS.slice(0, 12)}`;
const ITEMS = JSON.stringify([{ key: "f000", label: "right" }, { key: "f001", label: "wrong" }]) + "\n";
const SUMMARY = { model: PV, n: 2, right: 1, wrong: 1, auc_derived_right_vs_wrong_mean: 0.298, auc_exact: 0.2979, auc_ci95: [0.227, 0.374] };
type Fx = { weights?: string; latest?: (l: any) => void; record?: (r: any) => void; judgeModel?: (j: any) => void; target?: boolean; cfg?: (c: any) => void; v2?: (v: any) => void };
function fixture(d0: string, o: Fx = {}) {
  const d = mkdtempSync(join(d0, "fx-")); const src = join(d, "src"); mkdirSync(src);
  const put = (p: string, c: string) => { mkdirSync(dirname(join(src, p)), { recursive: true }); writeFileSync(join(src, p), c); };
  const jm: any = { model: PV, verified: false, scorer: "judge364.py", summary: SUMMARY, agg: { "f000:derived": { logprob: -1, tokens: 1, mean: -1 } } }; o.judgeModel?.(jm);
  const jmText = JSON.stringify(jm, null, 1) + "\n";
  const rec: any = { schema: "peaceai-lm-retrain-record:v5", runId: RUN, live: "lm-v1-088073d41dbc", candidate: PV, mode: "pretrain", candidateWeightsSha256: WS,
    setcV2: { maxBytes: CFG.eval.setcMaxBytes, sliceSha256: { live: CFG.eval.setcSliceSha256, candidate: CFG.eval.setcSliceSha256 }, bitsPerByte: { live: 1.6506, candidate: 1.5282 } },
    gate: { pass: true, failed: [], result: "pass" }, judge: { set: "v2", itemsSha256: H(ITEMS), candidate: { ...SUMMARY } }, promoted: false };
  o.record?.(rec); const recText = JSON.stringify(rec, null, 2) + "\n";
  const latest: any = { version: PV, memcheck: "PASS", recordSha256: H(recText) }; o.latest?.(latest);
  const m = CFG.model;
  put("models/lm/latest.json", JSON.stringify(latest, null, 2) + "\n");
  put(`models/lm/${PV}/config.json`, JSON.stringify({ version: PV, ctx: m.ctx, d_model: m.d_model, n_layer: m.n_layer, n_head: m.n_head, vocab_size: m.vocab }) + "\n");
  put(`models/lm/${PV}/tokenizer.json`, "{}\n"); put(`models/lm/${PV}/weights.npz`, o.weights ?? W0);
  put(`runs/lm-retrain/${RUN}/record.json`, recText); put(`runs/lm-retrain/${RUN}/judge-model.json`, jmText);
  put("lm-judge-v2/items.json", ITEMS); put("lm-judge-v2/scores-lm-v1-088073d41dbc.json", "{\"model\":\"lm-v1-088073d41dbc\"}\n");
  if (o.target) put(`lm-judge-v2/scores-${PV}.json`, "{\"old\":true}\n");
  put("models/lm/other/weights.npz", "never fetched\n");
  git(src, "init", "-q"); git(src, "add", "-A"); git(src, "commit", "-qm", "r");
  const bare = join(d, "results.git"); execFileSync("git", ["clone", "-q", "--bare", src, bare]);
  git(bare, "config", "uploadpack.allowFilter", "true"); git(bare, "config", "uploadpack.allowAnySHA1InWant", "true");
  // the pins a careful re-pin would write for this fixture (the honest values)
  const cfg: any = { ...CFG, promoted: { ...CFG.promoted, version: PV, recordSha256: H(recText) }, eval: { ...CFG.eval, judgeItemsSha256: H(ITEMS), judgeItemCount: 2 } };
  const v2: any = { ...V2, items: { sha256: H(ITEMS), n: 2, right: 1, wrong: 1 }, promoted: { ...V2.promoted, version: PV, weightsSha256: WS, recordSha256: cfg.promoted.recordSha256, judgeModelSha256: H(jmText), scores: `lm-judge-v2/scores-${PV}.json` } };
  o.cfg?.(cfg); o.v2?.(v2);
  return { bare, cfg, v2, d };
}
function restore(fx: ReturnType<typeof fixture>, key = "fixture-not-a-key") {
  const cwd = join(fx.d, "cwd"); rmSync(cwd, { recursive: true, force: true }); mkdirSync(join(cwd, "peaceai/bin"), { recursive: true });
  for (const f of ["lm-judge-v2-promoted.sh", "lm-retrain-promoted.sh", "lm-retrain-judge.sh", "with-deploy-key.sh"]) { copyFileSync(join(repo, "peaceai/bin", f), join(cwd, "peaceai/bin", f)); chmodSync(join(cwd, "peaceai/bin", f), 0o755); }
  json(join(cwd, "peaceai/model/lm-retrain.json"), fx.cfg); json(join(cwd, "peaceai/model/judge-v2.json"), fx.v2);
  const dest = join(fx.d, "dest"); rmSync(dest, { recursive: true, force: true });
  const env: Record<string, string> = { PATH: process.env.PATH!, HOME: fx.d, GIT_CONFIG_NOSYSTEM: "1", RUNNER_TEMP: fx.d, GIT_TERMINAL_PROMPT: "0",
    GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: `url.file://${fx.bare}.insteadOf`, GIT_CONFIG_VALUE_0: "git@github.com:PeaceG03/PeaceAI-Results.git" };
  if (key) env.DEPLOY_KEY = key;
  const r = spawnSync("bash", ["peaceai/bin/lm-judge-v2-promoted.sh", dest], { cwd, encoding: "utf8", env });
  return { st: r.status, out: r.stdout + r.stderr, dest };
}

test("M130 restore: the promoted model by its weights sha256, the run's judge-model.json, the record's judge.candidate and the v2 items, all at the pin-checked Results commit", () => tmp((d) => {
  const ok = restore(fixture(d));
  assert.equal(ok.st, 0, ok.out);
  assert.match(ok.out, new RegExp(`promoted model ${PV} restored \\(weights sha256 verified\\), recorded judge scores of run ${RUN} and 2 v2 items fetched`));
  assert.equal(readFileSync(join(ok.dest, "model/weights.npz"), "utf8"), W0);
  assert.equal(JSON.parse(readFileSync(join(ok.dest, "scores-recorded.json"), "utf8")).model, PV);
  assert.deepEqual(JSON.parse(readFileSync(join(ok.dest, "record-judge.json"), "utf8")), SUMMARY);
  assert.equal(readFileSync(join(ok.dest, "items.json"), "utf8"), ITEMS);
  assert.equal(JSON.parse(readFileSync(join(ok.dest, "promoted.json"), "utf8")).version, PV);
  for (const x of ["jp-res", "pp", "judge-res", "judge-commit.txt"]) assert.equal(existsSync(join(ok.dest, x)), false, `${x} removed`);
}));

test("M130 restore refuses: weights sha mismatch, latest.json naming another version, an existing target, and every other broken link", () => tmp((d) => {
  const no = (why: string, o: Fx, msg: RegExp, key?: string) => { const r = restore(fixture(d, o), key); assert.notEqual(r.st, 0, `${why}: ${r.out}`); assert.match(r.out, msg, why); assert.equal(existsSync(join(r.dest, "model/weights.npz")), false, `${why}: no model left behind`); };
  // (d) weights sha mismatch: the bytes in Results differ, or the pin names other weights
  no("weights bytes differ", { weights: "other-weights" }, /promoted weights do not hash to judge-v2\.json promoted\.weightsSha256: refused/);
  no("weights pin differs (same version prefix)", { v2: (v) => { v.promoted.weightsSha256 = WS.slice(0, 12) + "0".repeat(52); } }, /promoted weights do not hash to judge-v2\.json promoted\.weightsSha256: refused/);
  no("weights pin is not the version's", { v2: (v) => { v.promoted.weightsSha256 = "0".repeat(64); } }, /weightsSha256 is not the version's: refused/);
  no("record names other weights", { record: (r) => { r.candidateWeightsSha256 = "e".repeat(64); } }, /record candidateWeightsSha256 is not promoted\.weightsSha256: refused/);
  // (d) version mismatch with latest.json (lm-retrain-promoted.sh), or the two promoted pins disagree
  no("latest.json names another version", { latest: (l) => { l.version = "lm-v1-088073d41dbc"; delete l.recordSha256; } }, /Results latest\.json names lm-v1-088073d41dbc but lm-retrain\.json promoted\.version is lm-v1-[0-9a-f]{12}: refused/);
  no("judge-v2 promoted names another version than lm-retrain.json promoted", { v2: (v) => { v.promoted.version = PROMOTED; v.promoted.weightsSha256 = WEIGHTS; v.promoted.scores = `lm-judge-v2/scores-${PROMOTED}.json`; } }, /judge-v2 promoted\.version is not lm-retrain\.json promoted\.version: refused/);
  no("judge-v2 promoted runId differs", { v2: (v) => { v.promoted.runId = "40694718191"; } }, /judge-v2 promoted\.runId is not lm-retrain\.json promoted\.runId: refused/);
  no("judge-v2 promoted is the live model", { v2: (v) => { v.live = { ...v.live, version: PV }; } }, /names the live \(replay base\) model: refused/);
  // (d) an existing target file refuses before any scoring
  no("target scores file exists", { target: true }, new RegExp(`lm-judge-v2/scores-${PV}\\.json already exists in Results: refused`));
  // the recorded per-item scores and the record's judge facts
  no("judge-model.json bytes differ from the pin", { judgeModel: (j) => { j.agg["f000:derived"].mean = -1.5; }, v2: (v) => { v.promoted.judgeModelSha256 = "1".repeat(64); } }, /judge-model\.json does not hash to promoted\.judgeModelSha256: refused/);
  no("record AUC differs from the pin", { v2: (v) => { v.promoted.auc = 0.299; } }, /record judge\.candidate AUC or CI is not the judge-v2 promoted pin: refused/);
  no("record CI differs from the pin", { v2: (v) => { v.promoted.auc_ci95 = [0.227, 0.375]; } }, /record judge\.candidate AUC or CI is not the judge-v2 promoted pin: refused/);
  no("record judged other items", { v2: (v) => { v.items.sha256 = "0".repeat(64); } }, /record judge was not scored on the pinned v2 items: refused/);
  no("no Results key", {}, /no Results key: refused \(fail closed\)/, "");
}));

// ---- judge_promoted_check.py: AUC, CI, n and counts exactly, against the pin AND the record
function check(d: string, summary: object, rec: object, pin: object = V2) {
  const s = join(d, "s.json"), p = join(d, "p.json"), r = join(d, "r.json");
  json(s, { model: PROMOTED, summary: { model: PROMOTED, ...summary } }); json(p, pin); json(r, rec);
  const x = spawnSync(PY, [join(repo, "peaceai/model/judge_promoted_check.py"), s, p, r], { encoding: "utf8" });
  return { code: x.status, out: x.stdout + x.stderr };
}
const REAL = { model: PROMOTED, n: 230, right: 73, wrong: 157, auc_derived_right_vs_wrong_mean: 0.298, auc_exact: 0.2979670185847657, auc_ci95: [0.227, 0.374] };

test("M130 judge_promoted_check.py: the recorded AUC 0.298 and CI reproduce; any AUC, CI, count or model that does not refuses", () => tmp((d) => {
  const ok = check(d, REAL, REAL);
  assert.equal(ok.code, 0, ok.out); assert.match(ok.out, /^promoted judge v2 reproduced: model=lm-v1-858573767465 n=230 auc=0\.298 auc_ci95=\[0\.227,0\.374\]\n$/);
  const no = (why: string, s: object, r: object, msg: RegExp, pin?: object) => { const x = check(d, s, r, pin); assert.equal(x.code, 1, `${why}: ${x.out}`); assert.match(x.out, msg, why); };
  no("AUC 0.297", { ...REAL, auc_derived_right_vs_wrong_mean: 0.297 }, REAL, /differ from the judge-v2\.json promoted pin: refused\n.*differ from the run record's judge\.candidate: refused/);
  no("lower bound 0.226", { ...REAL, auc_ci95: [0.226, 0.374] }, REAL, /differ from the judge-v2\.json promoted pin: refused/);
  no("upper bound 0.375", { ...REAL, auc_ci95: [0.227, 0.375] }, REAL, /differ from the judge-v2\.json promoted pin: refused/);
  no("one item fewer", { ...REAL, n: 229, wrong: 156 }, REAL, /differ from the judge-v2\.json promoted pin: refused/);
  no("the record disagrees (pin matches)", REAL, { ...REAL, auc_ci95: [0.228, 0.374] }, /^promoted judge v2: AUC, CI, n or counts differ from the run record's judge\.candidate: refused\n$/);
  no("the pin disagrees (record matches)", REAL, REAL, /^promoted judge v2: AUC, CI, n or counts differ from the judge-v2\.json promoted pin: refused\n$/, { ...V2, promoted: { ...V2.promoted, auc: 0.3 } });
  no("another model", { ...REAL, model: "lm-v1-088073d41dbc" }, REAL, /rescored model is not judge-v2\.json promoted\.version: refused/);
  no("record of another model", REAL, { ...REAL, model: "lm-v1-088073d41dbc" }, /differ from the run record's judge\.candidate: refused/);
  // exact, not a tolerance: 0.2980001 is not 0.298
  no("not exact", { ...REAL, auc_derived_right_vs_wrong_mean: 0.2980001 }, REAL, /refused/);
}));

test("M130 rescore step: judge364.py on the restored model, per-item agreement with judge-model.json over ALL keys (no --subset), then the exact AUC/CI check, before any write", () => {
  const s = stepRun(RESCORE);
  assert.match(s, /peaceai\/model\/judge364\.py --model "\$P\/model" --items "\$P\/items\.json" --out "\$RUNNER_TEMP\/out\/scores-\$pv\.json" --threads 4\n/);
  assert.match(s, /peaceai\/model\/judge_repro\.py "\$P\/scores-recorded\.json" "\$RUNNER_TEMP\/out\/scores-\$pv\.json" --drift \\\n {2}\|\| \{ echo "per-item scores differ from the run's judge-model\.json \(tokens equal, mean within 1e-4\): refused"; exit 1; \}\n/);
  assert.doesNotMatch(s.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n"), /--subset/);
  assert.match(s, /peaceai\/model\/judge_promoted_check\.py "\$RUNNER_TEMP\/out\/scores-\$pv\.json" "\$V2" "\$P\/record-judge\.json"$/m);
  assert.ok(s.indexOf("judge364.py") < s.indexOf("judge_repro.py") && s.indexOf("judge_repro.py") < s.indexOf("judge_promoted_check.py"));
  assert.ok(WF.indexOf(RESCORE) < WF.indexOf(LAND));
});

// ---- the landing step, run as written against a fixture Results (results-write.sh --sparse, its local-test remote hook)
function landing(d: string, o: { target?: boolean; latest?: string } = {}) {
  const bare = join(d, `land-${Math.random().toString(36).slice(2)}.git`); mkdirSync(bare); git(bare, "init", "-q", "--bare");
  git(bare, "config", "uploadpack.allowFilter", "true"); git(bare, "config", "uploadpack.allowAnySHA1InWant", "true");
  const seed = mkdtempSync(join(d, "seed-")); git(seed, "init", "-q");
  const files: Record<string, string> = { "models/lm/latest.json": `{"version":"${o.latest ?? PROMOTED}"}\n`, "lm-judge-v2/items.json": "[]\n",
    "lm-judge-v2/scores-lm-v1-088073d41dbc.json": "{\"live\":true}\n", [`runs/lm-retrain/${RUN}/judge-model.json`]: "{\"rec\":true}\n" };
  if (o.target) files[`lm-judge-v2/scores-${PROMOTED}.json`] = "{\"old\":true}\n";
  for (const [p, c] of Object.entries(files)) { mkdirSync(dirname(join(seed, p)), { recursive: true }); writeFileSync(join(seed, p), c); }
  git(seed, "add", "-A"); git(seed, "commit", "-qm", "seed"); git(seed, "push", "-q", bare, "HEAD:main");
  const h0 = git(bare, "rev-parse", "main");
  const rt = mkdtempSync(join(d, "rt-")); mkdirSync(join(rt, "out")); writeFileSync(join(rt, "out", `scores-${PROMOTED}.json`), "{\"model\":\"new\"}\n"); writeFileSync(join(rt, "gho"), "");
  const r = spawnSync("bash", ["-e", "-c", stepRun(LAND).replaceAll("./peaceai/bin/with-deploy-key.sh ", "")], { cwd: repo, encoding: "utf8",
    env: { PATH: process.env.PATH!, HOME: d, GIT_CONFIG_NOSYSTEM: "1", RUNNER_TEMP: rt, GITHUB_OUTPUT: join(rt, "gho"), GITHUB_RUN_ID: "1", PEACEAI_RESULTS_REMOTE_OVERRIDE: `file://${bare}`, V2: "peaceai/model/judge-v2.json" } });
  const h1 = git(bare, "rev-parse", "main");
  return { st: r.status, out: r.stdout + r.stderr, h0, h1, changes: h0 === h1 ? [] : git(bare, "diff", "--name-status", "--no-renames", h0, h1).split("\n"), show: (p: string) => git(bare, "show", `main:${p}`) };
}

test("M130 landing (as written): one new file, lm-judge-v2/scores-<promoted>.json; existing scores untouched; an existing target or a moved latest.json refuses", () => tmp((d) => {
  const ok = landing(d);
  assert.equal(ok.st, 0, ok.out);
  assert.deepEqual(ok.changes, [`A\tlm-judge-v2/scores-${PROMOTED}.json`], "add-only: exactly one new file, nothing modified or deleted");
  assert.equal(ok.show(`lm-judge-v2/scores-${PROMOTED}.json`), "{\"model\":\"new\"}");
  assert.equal(ok.show("lm-judge-v2/scores-lm-v1-088073d41dbc.json"), "{\"live\":true}");
  const ex = landing(d, { target: true });
  assert.notEqual(ex.st, 0, ex.out); assert.match(ex.out, new RegExp(`lm-judge-v2/scores-${PROMOTED}\\.json already exists: refused`)); assert.equal(ex.h1, ex.h0, "nothing pushed");
  assert.equal(ex.show(`lm-judge-v2/scores-${PROMOTED}.json`), "{\"old\":true}", "the existing file is untouched");
  const mv = landing(d, { latest: "lm-v1-088073d41dbc" });
  assert.notEqual(mv.st, 0, mv.out); assert.match(mv.out, /Results latest\.json no longer names lm-v1-858573767465: refused/); assert.equal(mv.h1, mv.h0);
  const L = stepRun(LAND);
  assert.match(L, /results-write\.sh --sparse "\/\$T" --sparse "\/models\/lm\/latest\.json" "/);
  assert.match(L, /--diff-filter=A\)" = "\$T"/);
  assert.doesNotMatch(L, /\b(rm|mv|git rm)\b|--force|git push/);
}));

test("M130 workflow: dispatch only, free runner, every key use after the checkout and key-script hash check, restore by weights sha (never lm-retrain-live.sh), no training or model change", () => {
  assert.match(WF, /^on:\n  workflow_dispatch:\n\npermissions: \{\}$/m);
  assert.doesNotMatch(WF, /^\s+(push|schedule|pull_request|workflow_run|inputs):/m);
  assert.match(WF, /runs-on: ubuntu-24\.04/); assert.match(WF, /environment: peaceai-results/);
  assert.match(WF, /if: github\.repository == 'PeaceG03\/PeaceAI-Workspace' && github\.ref == 'refs\/heads\/main'/);
  assert.match(WF, /persist-credentials: false/);
  const pins = [...WF.matchAll(/^ {4}([0-9a-f]{64}) {2}(\S+)$/gm)];
  assert.deepEqual(pins.map((m) => m[2]), ["peaceai/bin/with-deploy-key.sh", "peaceai/bin/results-write.sh", "peaceai/bin/lm-retrain-promoted.sh", "peaceai/bin/lm-retrain-judge.sh", "peaceai/bin/lm-judge-v2-promoted.sh"]);
  for (const m of pins) assert.equal(H(readFileSync(join(repo, m[2]!))), m[1], m[2]);
  const steps = WF.split(/\n {6}- /);
  for (const [i, s] of steps.entries()) if (/secrets\.PEACEAI_RESULTS_(READ|DEPLOY)_KEY/.test(s)) assert.match(steps[i - 1]!, /sha256sum -c --quiet -/, s.split("\n")[0]);
  assert.equal((WF.match(/secrets\./g) ?? []).length, 2, "restore and landing only");
  assert.doesNotMatch(WF, /PEACEAI_RESULTS_READ_KEY/);
  const code = WF.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");
  assert.doesNotMatch(code, /lm-retrain-live\.sh|train\.py|export\.py|lm-corpus|lm-memcheck|upload-artifact|actions\/cache|self-hosted|gh workflow run|--force|git push/);
  assert.doesNotMatch(code, /latest\.json"? *>|cp [^\n]*latest\.json/, "never writes latest.json");
  assert.match(code, /\.\/peaceai\/bin\/lm-judge-v2-promoted\.sh "\$RUNNER_TEMP\/p"\n/);
  const pin = stepRun(PINS);
  assert.match(pin, /for k in version runId recordSha256; do\n/);
  assert.match(pin, /test "\$\(jq -r \.live\.version "\$V2"\)" = "\$\(jq -r \.replayBase\.version "\$CFG"\)"/);
  // the restore script never goes through lm-retrain-live.sh and reads Results only
  const sh = read("peaceai/bin/lm-judge-v2-promoted.sh");
  assert.doesNotMatch(sh.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n"), /lm-retrain-live\.sh|replayBase|git push|results-write/);
  assert.match(sh, /test "\$\(sha256sum "\$res\/\$M\/weights\.npz" \| cut -c1-64\)" = "\$ws"/);
  assert.match(sh, /\.\/peaceai\/bin\/lm-retrain-promoted\.sh "\$dest\/pp"/);
});

test("M130 the retrain's judge comparison stays report-only and never reads the promoted judge pin", () => {
  assert.equal(CFG.eval.judgeAucGate, "report-only");
  const RT = read(".github/workflows/peace-lm-retrain.yml");
  assert.match(RT, /# Judge AUC: report-only\./);
  assert.doesNotMatch(RT, /judge-v2\.json|judge_promoted_check|lm-judge-v2-promoted|scores-lm-v1-858573767465/);
  assert.doesNotMatch(read("peaceai/model/judge_gate.py"), /promoted/);
  assert.match(stepRun(PINS), /test "\$\(jq -r \.eval\.judgeAucGate "\$CFG"\)" = report-only \|\| \{ echo "the retrain judge gate is not report-only: refused"; exit 1; \}/);
});

test("M130 new files are protected", () => {
  for (const f of [WFP, "peaceai/bin/lm-judge-v2-promoted.sh", "peaceai/model/judge_promoted_check.py", "peaceai/model/judge-v2.json", "peaceai/test/m130-judge-v2-promoted.test.ts"]) assert.ok(protectedReason(f), f);
});
