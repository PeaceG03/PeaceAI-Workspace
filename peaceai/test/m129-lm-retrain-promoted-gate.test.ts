// M129 (Auditor, after promotion of lm-v1-858573767465 in Results 0d86e8c): before any next promotion a retrain candidate
// must beat the PROMOTED model, using its own set C v2 bits/byte from its pinned run record (runs/lm-retrain/40694718190/
// record.json, sha256 56a1636f..., setcV2.bitsPerByte.candidate 1.5282), not the replay base's (1.6506, gate 1.6456).
// lm-retrain.json promoted {version, runId, recordSha256, setcBpb} is separate from replayBase (training, restoring, the
// in-run live score and replay stay on replayBase). The gate adds bpb_gate.py <promoted.setcBpb> <candidate> <minBpbGain>
// (same margin rule: candidate <= 1.5282 - 0.005 = 1.5232). lm-retrain-promoted.sh verifies, from Results, that
// latest.json names promoted.version and that the record hashes to promoted.recordSha256 and holds that score; it runs in
// corpus-gate (exit before any training) and right before the gate (refusal = gate failure promoted_pin; the record
// still lands). Fixtures only: no real model, record or Results.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { protectedReason } from "../lib/selfchange.ts";

const repo = resolve(import.meta.dirname, "..", "..");
const read = (p: string) => readFileSync(join(repo, p), "utf8");
const CFG = JSON.parse(read("peaceai/model/lm-retrain.json"));
const WF = read(".github/workflows/peace-lm-retrain.yml");
const H = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");
const tmp = (fn: (d: string) => void) => { const d = mkdtempSync(join(tmpdir(), "m129-")); try { fn(d); } finally { rmSync(d, { recursive: true, force: true }); } };
const json = (p: string, x: unknown) => writeFileSync(p, JSON.stringify(x, null, 1) + "\n");
const job = (j: string) => { const i = WF.indexOf(`\n  ${j}:\n`); assert.ok(i > 0, j); const rest = WF.slice(i + 1); const n = rest.slice(1).search(/\n  [a-z][a-z-]*:\n/); return n < 0 ? rest : rest.slice(0, n + 1); };
const env0 = (over: Record<string, string | undefined>) => { const e: Record<string, string> = {}; for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !(k in over)) e[k] = v; for (const [k, v] of Object.entries(over)) if (v !== undefined) e[k] = v; return e; };
const block = (text: string, start: string, end: RegExp) => { const i = text.indexOf(start); assert.ok(i >= 0, start); const rest = text.slice(i + start.length); const j = rest.search(end); return j < 0 ? rest : rest.slice(0, j); };
const dedent = (t: string, n: number) => t.split("\n").map((l) => l.slice(Math.min(n, l.length - l.trimStart().length))).join("\n");
const LAND = job("finetune-eval-land"), CG = job("corpus-gate");
const stepRun = (text: string, name: string) => dedent(block(block(text, `      - name: ${name}`, /\n      - name: /), "        run: |\n", /$^/), 10);
const GATE = "Gate (slice identical and pinned; 0 eval overlap; scorer reproduces the live record; candidate set C bpb <= live - eval.minBpbGain; judge AUC report-only)";
const RECHECK = "Re-check the promoted-model gate pin at gate time";
const EARLY = "Check the promoted-model gate pin before any training";
const PROMOTED = "lm-v1-858573767465", RUN = "40694718190", RECORD = "56a1636fa9f6ffe9fd48205945815b92b601340cc55499f376399de4ad4e935c";
const bpbGate = (live: string, cand: string, gain: string) => spawnSync("python3", ["peaceai/model/bpb_gate.py", live, cand, gain], { cwd: repo, encoding: "utf8" });

test("M129 config: a pinned promoted entry (858573, its record sha, set C 1.5282 as an exact decimal string), separate from replayBase, which is unchanged", () => {
  assert.deepEqual({ ...CFG.promoted, note: undefined }, { version: PROMOTED, runId: RUN, recordSha256: RECORD, setcBpb: "1.5282", note: undefined });
  assert.equal(typeof CFG.promoted.setcBpb, "string", "a string: bpb_gate.py compares exact decimals");
  assert.match(CFG.promoted.note, /1\.5282 - 0\.005 = 1\.5232/);
  assert.deepEqual([CFG.replayBase.version, CFG.replayBase.manifestSha256, CFG.replayBase.corefreeProofSha256],
    ["lm-v1-088073d41dbc", "6fc30d39a649601067a1ad8f74c10083993420db0abdbeb1ae8e72286fa19ab1", "24ffc77c1d49cd9b441d09613d799dc64b78a838c3c352fe470e7e3dab74281a"], "training, restoring and replay stay on the replay base");
  assert.equal("live" in CFG, false, "the live entry is retired (m131)"); assert.notEqual(CFG.promoted.version, CFG.replayBase.version);
  assert.equal(CFG.eval.minBpbGain, 0.005, "the same margin as today");
});

test("M129 margin rule applied to the promoted score: 1.60 (passed the old 1.6456 gate) now fails; just under 1.5232 passes", () => {
  const gain = String(CFG.eval.minBpbGain), pb = CFG.promoted.setcBpb;
  assert.equal(bpbGate("1.6506", "1.6000", gain).status, 0, "1.60 passes the replay-base gate (live 1.6506)");
  const r = bpbGate(pb, "1.6000", gain); assert.equal(r.status, 1, r.stdout); assert.match(r.stdout, /need_at_most=1\.5232 pass=false/);
  for (const c of ["1.5231", "1.5232", "1.5"]) { const p = bpbGate(pb, c, gain); assert.equal(p.status, 0, `${c}: ${p.stdout}`); assert.match(p.stdout, /need_at_most=1\.5232 pass=true/); }
  for (const c of ["1.5233", "1.5282", "1.53"]) assert.equal(bpbGate(pb, c, gain).status, 1, c);
});

// ---- the workflow's gate step, run as written, with fixtures
function gateFixture(d: string, model: string, promoted: Record<string, string> | null) {
  const rt = join(d, "rt"); rmSync(rt, { recursive: true, force: true }); for (const x of ["evals", "w", "r", "model"]) mkdirSync(join(rt, x), { recursive: true });
  const slice = CFG.eval.setcSliceSha256;
  writeFileSync(join(rt, "evals", "setc-live.txt"), `setc model=live slice_sha256=${slice} bytes=1 bits_per_byte=1.6506\n`);
  writeFileSync(join(rt, "evals", "setc-model.txt"), `setc model=model slice_sha256=${slice} bytes=1 bits_per_byte=${model}\n`);
  const agg = { agg: { k: { tokens: 1, mean: -1, logprob: -1 } } };
  json(join(rt, "evals", "judge-live.json"), { ...agg, summary: { n: 1 } }); json(join(rt, "evals", "judge-model.json"), { ...agg, summary: { n: 1 } });
  json(join(rt, "r", "scores-live-recorded.json"), agg); writeFileSync(join(rt, "r", "judge-commit.txt"), "0".repeat(40));
  const corpus = { docsSha256: "c".repeat(64), docsBytes: 1 };
  json(join(rt, "select.json"), { mode: "pretrain", validationSplit: {}, selected: { arm: 0, lr: 0.00015, step: 1200, candidate: true, result: "selected" }, arms: [{ arm: 0, replay: { corpus } }] });
  json(join(rt, "candidate-train.json"), { mode: "pretrain", stoppedStep: 1200, bestStep: 1200, replay: { corpus } });
  json(join(rt, "model", "config.json"), { version: "lm-v1-0123456789ab" }); writeFileSync(join(rt, "model", "weights.npz"), "w");
  json(join(rt, "w", "dedup.json"), { recheckOverlapDocs: 0 });
  json(join(rt, "w", "replay-proof.json"), { replayDocsSha256: corpus.docsSha256, replayDocsBytes: 1, trainBytes: 1, valBytes: 1 });
  for (const f of ["w/ft-prepare.json", "w/replay-plan.json", "corefree-proof-finetune.json"]) writeFileSync(join(rt, f), "{}");
  if (promoted) json(join(rt, "promoted.json"), promoted);
  writeFileSync(join(rt, "out"), "");
  const g = spawnSync("bash", ["-e", "-c", stepRun(LAND, GATE)], { cwd: repo, encoding: "utf8", env: env0({ RUNNER_TEMP: rt, CFG: "peaceai/model/lm-retrain.json", MODE: "pretrain", CAND: "true", GITHUB_OUTPUT: join(rt, "out"), GITHUB_RUN_ID: "1", GITHUB_SHA: "a".repeat(40) }) });
  assert.equal(g.status, 0, g.stdout + g.stderr);
  return { rec: JSON.parse(readFileSync(join(rt, "evals", "record.json"), "utf8")), out: readFileSync(join(rt, "out"), "utf8"), log: g.stdout };
}
const good = () => ({ version: PROMOTED, runId: RUN, recordSha256: RECORD, setcBpb: "1.5282", latestJsonSha256: "f".repeat(64), resultsCommit: "0".repeat(40) });

test("M129 gate step (as written): candidate 1.60 fails setc_bpb_promoted although it beats the replay base; 1.5231 passes; the record names the promoted pin", () => tmp((d) => {
  const f = gateFixture(d, "1.6000", good());
  assert.deepEqual([f.rec.gate.pass, f.rec.gate.result, f.rec.gate.failed], [false, "fail", ["setc_bpb_promoted"]], "only the promoted gate fails");
  assert.match(f.out, /^pass=false$/m); assert.doesNotMatch(f.out, /^version=/m, "not landed as a model, no memcheck");
  assert.deepEqual(f.rec.setcV2.promoted, { version: PROMOTED, runId: RUN, recordSha256: RECORD, bitsPerByte: 1.5282 });
  assert.deepEqual(f.rec.setcV2.bitsPerByte, { live: 1.6506, candidate: 1.6 }); assert.equal(f.rec.live, CFG.replayBase.version, "the in-run live is still the replay base");
  const p = gateFixture(d, "1.5231", good());
  assert.deepEqual([p.rec.gate.pass, p.rec.gate.result, p.rec.gate.failed], [true, "pass", []], p.log);
  assert.match(p.out, /^pass=true$/m); assert.match(p.out, /^version=lm-v1-0123456789ab$/m);
  assert.match(p.log, /setc_bpb gate live=1\.5282 candidate=1\.5231 min_gain=0\.005 need_at_most=1\.5232 pass=true/);
  assert.equal(gateFixture(d, "1.5233", good()).rec.gate.failed.join(), "setc_bpb_promoted");
}));

test("M129 gate step: no verified promoted pin (refused or missing promoted.json, or one not matching the config) fails closed as promoted_pin", () => tmp((d) => {
  for (const [name, pp] of [
    ["missing (lm-retrain-promoted.sh refused)", null],
    ["another version", { ...good(), version: "lm-v1-088073d41dbc" }],
    ["another record sha", { ...good(), recordSha256: "0".repeat(64) }],
    ["another score", { ...good(), setcBpb: "1.6506" }],
  ] as const) {
    const f = gateFixture(d, "1.5000", pp as Record<string, string> | null);
    assert.deepEqual([f.rec.gate.pass, f.rec.gate.failed], [false, ["promoted_pin"]], name);
    assert.equal(f.rec.setcV2.promoted, null, name); assert.match(f.out, /^pass=false$/m, name);
  }
}));

// ---- lm-retrain-promoted.sh against a fixture Results repo
let nres = 0;
/** The promoted model's PASS run record, shaped like the real one (fields the pin check reads). */
const baseRecord = (): any => ({ schema: "peaceai-lm-retrain-record:v5", runId: RUN, live: "lm-v1-088073d41dbc", candidate: PROMOTED, mode: "pretrain",
  setcV2: { maxBytes: CFG.eval.setcMaxBytes, sliceSha256: { live: CFG.eval.setcSliceSha256, candidate: CFG.eval.setcSliceSha256 }, bitsPerByte: { live: 1.6506, candidate: 1.5282 }, minBpbGain: 0.005 },
  gate: { pass: true, failed: [], result: "pass" }, promoted: false });
function results(d0: string, o: { latest?: (l: any) => void; record?: (r: any) => void; recordText?: (t: string) => string } = {}) {
  const d = join(d0, `res${nres++}`); mkdirSync(d);
  const g = (cwd: string, ...a: string[]) => execFileSync("git", ["-C", cwd, "-c", "user.name=t", "-c", "user.email=t@t", ...a], { encoding: "utf8" }).trim();
  const src = join(d, "results-src"); rmSync(src, { recursive: true, force: true }); mkdirSync(join(src, "models/lm"), { recursive: true }); mkdirSync(join(src, "runs/lm-retrain", RUN), { recursive: true });
  g(d, "init", "-q", src);
  const rec = baseRecord(); o.record?.(rec);
  let text = JSON.stringify(rec, null, 2) + "\n"; if (o.recordText) text = o.recordText(text);
  writeFileSync(join(src, "runs/lm-retrain", RUN, "record.json"), text);
  const recSha = H(JSON.stringify(baseRecord(), null, 2) + "\n"); // the unmodified record's sha (what latest.json binds)
  const latest: any = { version: PROMOTED, memcheck: "PASS", rule: "core-free-64", recordSha256: recSha };
  o.latest?.(latest);
  writeFileSync(join(src, "models/lm/latest.json"), JSON.stringify(latest, null, 2) + "\n");
  writeFileSync(join(src, "models/lm/other.txt"), "not fetched\n");
  g(src, "add", "-A"); g(src, "commit", "-qm", "r");
  const bare = join(d, "results.git"); rmSync(bare, { recursive: true, force: true }); execFileSync("git", ["clone", "-q", "--bare", src, bare]); g(bare, "config", "uploadpack.allowFilter", "true");
  return { bare, recSha, src };
}
function runScript(d: string, bare: string, cfg: any, key = "fixture-not-a-key") {
  const cwd = join(d, "cwd"); rmSync(cwd, { recursive: true, force: true }); mkdirSync(join(cwd, "peaceai/bin"), { recursive: true }); mkdirSync(join(cwd, "peaceai/model"));
  for (const f of ["lm-retrain-promoted.sh", "with-deploy-key.sh"]) { copyFileSync(join(repo, "peaceai/bin", f), join(cwd, "peaceai/bin", f)); chmodSync(join(cwd, "peaceai/bin", f), 0o755); }
  json(join(cwd, "peaceai/model/lm-retrain.json"), cfg);
  const dest = join(d, "dest"); rmSync(dest, { recursive: true, force: true });
  const r = spawnSync("bash", ["peaceai/bin/lm-retrain-promoted.sh", dest], { cwd, encoding: "utf8", env: env0({ DEPLOY_KEY: key || undefined, RUNNER_TEMP: d, GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: `url.file://${bare}.insteadOf`, GIT_CONFIG_VALUE_0: "git@github.com:PeaceG03/PeaceAI-Results.git", GIT_TERMINAL_PROMPT: "0" }) });
  return { st: r.status, out: r.stdout + r.stderr, dest };
}

test("M129 lm-retrain-promoted.sh: PASS writes promoted.json; latest.json naming another version, a record sha mismatch, or a record not holding the pinned score refuses", () => tmp((d) => {
  const { bare, recSha } = results(d);
  const cfg = { ...CFG, promoted: { ...CFG.promoted, recordSha256: recSha } };
  const ok = runScript(d, bare, cfg);
  assert.equal(ok.st, 0, ok.out); assert.match(ok.out, new RegExp(`promoted model ${PROMOTED} pinned: record ${recSha} \\(run ${RUN}\\), set C v2 1\\.5282; latest\\.json names it`));
  const pj = JSON.parse(readFileSync(join(ok.dest, "promoted.json"), "utf8"));
  assert.deepEqual([pj.version, pj.runId, pj.recordSha256, pj.setcBpb], [PROMOTED, RUN, recSha, "1.5282"]); assert.match(pj.resultsCommit, /^[0-9a-f]{40}$/);
  assert.equal(existsSync(join(ok.dest, "promoted-res")), false, "the Results clone is removed");
  const no = (why: string, r: { st: number | null; out: string; dest: string }, msg: RegExp) => { assert.notEqual(r.st, 0, `${why}: ${r.out}`); assert.match(r.out, msg, why); assert.equal(existsSync(join(r.dest, "promoted.json")), false, why); };
  // latest.json names a different version than the pinned promoted entry (e.g. a later promotion without a re-pin, or a rollback)
  no("latest.json names another version", runScript(d, results(d, { latest: (l) => { l.version = "lm-v1-088073d41dbc"; } }).bare, cfg),
    /Results latest\.json names lm-v1-088073d41dbc but lm-retrain\.json promoted\.version is lm-v1-858573767465: refused/);
  no("pin names another version than latest.json", runScript(d, bare, { ...cfg, promoted: { ...cfg.promoted, version: "lm-v1-aaaaaaaaaaaa" } }), /latest\.json names lm-v1-858573767465 but lm-retrain\.json promoted\.version is lm-v1-aaaaaaaaaaaa: refused/);
  no("latest.json binds another record", runScript(d, results(d, { latest: (l) => { l.recordSha256 = "e".repeat(64); } }).bare, cfg), /latest\.json recordSha256 is not promoted\.recordSha256: refused/);
  // record sha mismatch: the pin differs, or the record bytes changed (one byte of whitespace)
  no("record sha pin differs", runScript(d, bare, { ...cfg, promoted: { ...cfg.promoted, recordSha256: "0".repeat(64) } }), /latest\.json recordSha256 is not promoted\.recordSha256: refused/);
  no("record sha pin differs (latest.json binds no record)", runScript(d, results(d, { latest: (l) => { delete l.recordSha256; } }).bare, { ...cfg, promoted: { ...cfg.promoted, recordSha256: "0".repeat(64) } }), /record\.json does not hash to promoted\.recordSha256: refused/);
  no("record bytes changed", runScript(d, results(d, { recordText: (t) => t + " " }).bare, cfg), /record\.json does not hash to promoted\.recordSha256: refused/);
  // a record that hashes to the pin but does not hold the pinned facts (re-pinned carelessly)
  const pinTo = (o: Parameters<typeof results>[1]) => { const r = results(d, o); const t = readFileSync(join(r.src, "runs/lm-retrain", RUN, "record.json"), "utf8"); return runScript(d, r.bare, { ...cfg, promoted: { ...cfg.promoted, recordSha256: H(t) } }); };
  const strip = (l: any) => { delete l.recordSha256; };
  no("record score differs", pinTo({ latest: strip, record: (r) => { r.setcV2.bitsPerByte.candidate = 1.6; } }), /candidate bits\/byte is not promoted\.setcBpb: refused/);
  no("record candidate differs", pinTo({ latest: strip, record: (r) => { r.candidate = "lm-v1-aaaaaaaaaaaa"; } }), /record candidate is not promoted\.version: refused/);
  no("record gate did not pass", pinTo({ latest: strip, record: (r) => { r.gate.pass = false; r.gate.result = "fail"; } }), /record gate did not pass: refused/);
  no("record on another slice", pinTo({ latest: strip, record: (r) => { r.setcV2.sliceSha256.candidate = "0".repeat(64); } }), /not the pinned slice: refused/);
  no("record of another run", pinTo({ latest: strip, record: (r) => { r.runId = "40694718191"; } }), /record runId is not promoted\.runId: refused/);
  // bad pins and no key
  no("setcBpb as a number", runScript(d, bare, { ...cfg, promoted: { ...cfg.promoted, setcBpb: 1.5282 } }), /setcBpb must be a string/);
  no("no promoted entry", runScript(d, bare, { ...cfg, promoted: undefined }), /promoted pin: bad version: refused/);
  no("bad run id", runScript(d, bare, { ...cfg, promoted: { ...cfg.promoted, runId: "../x" } }), /promoted pin: bad runId: refused/);
  no("no Results key", runScript(d, bare, cfg, ""), /no Results key: refused \(fail closed\)/);
}));

test("M129 wiring: checked in corpus-gate before any training (exit; not in memcheck-only runs) and re-checked right before the gate (no if:, record still lands); restore stays on replayBase", () => {
  const e = CG.indexOf(`      - name: ${EARLY}`), build = CG.indexOf("      - name: Build the corpus at the pinned heads");
  assert.ok(e > 0 && e < build, "before the corpus build (so before both sweep arms, which need corpus-gate)");
  const early = block(CG, `      - name: ${EARLY}`, /\n      - name: /);
  assert.match(early, /\n        if: inputs\.memcheck_only_run_id == ''\n        env:\n          DEPLOY_KEY: \$\{\{ secrets\.PEACEAI_RESULTS_READ_KEY \}\}\n/);
  assert.match(stepRun(CG, EARLY), /^set -euo pipefail\n.*\n\.\/peaceai\/bin\/lm-retrain-promoted\.sh "\$RUNNER_TEMP\/pp"; rm -rf "\$RUNNER_TEMP\/pp"/);
  for (const j of ["sweep-a", "sweep-b"]) assert.match(job(j), /\n    needs: corpus-gate\n/);
  const r = LAND.indexOf(`      - name: ${RECHECK}`), g = LAND.indexOf(`      - name: ${GATE}`), s = LAND.indexOf("      - name: Score live and candidate");
  assert.ok(s > 0 && s < r && r < g, "after scoring, directly before the gate");
  assert.equal(LAND.slice(r, g).split("\n      - name: ").length, 1, "no step between the re-check and the gate");
  const rc = block(LAND, `      - name: ${RECHECK}`, /\n      - name: /);
  assert.doesNotMatch(rc, /\n        if:|continue-on-error/); assert.match(rc, /DEPLOY_KEY: \$\{\{ secrets\.PEACEAI_RESULTS_DEPLOY_KEY \}\}/);
  assert.match(stepRun(LAND, RECHECK), /if \.\/peaceai\/bin\/lm-retrain-promoted\.sh "\$RUNNER_TEMP\/pp"; then mv "\$RUNNER_TEMP\/pp\/promoted\.json" "\$RUNNER_TEMP\/promoted\.json"; else echo "promoted pin refused: the gate fails \(promoted_pin\); the record still lands"; fi/);
  assert.match(stepRun(LAND, RECHECK), /^set -euo pipefail\nrm -rf "\$RUNNER_TEMP\/promoted\.json" "\$RUNNER_TEMP\/pp"\n/, "a stale promoted.json never survives");
  const gate = stepRun(LAND, GATE);
  assert.match(gate, /python3 peaceai\/model\/bpb_gate\.py "\$\(bpb live\)" "\$\(bpb model\)" "\$\(jq -r \.eval\.minBpbGain "\$CFG"\)" \|\| \{ ok=false; why\+=\(setc_bpb\); \}/, "the in-run replay-base margin gate is kept");
  assert.match(gate, /pb=\$\(jq -r \.setcBpb "\$pp"\); python3 peaceai\/model\/bpb_gate\.py "\$pb" "\$\(bpb model\)" "\$\(jq -r \.eval\.minBpbGain "\$CFG"\)" \|\| \{ ok=false; why\+=\(setc_bpb_promoted\); \}\nelse ok=false; why\+=\(promoted_pin\); fi/);
  // restore, training init, the in-run live score and replay are still the replay base, never latest.json or promoted
  const live = read("peaceai/bin/lm-retrain-live.sh");
  assert.match(live, /live=\$\(jq -r \.replayBase\.version "\$cfg"\)/); assert.doesNotMatch(live, /promoted|latest\.json"/);
  for (const f of ["peaceai/bin/lm-retrain-train.sh", "peaceai/bin/lm-retrain-replay.sh", "peaceai/model/train.py", "peaceai/model/replay_corpus.py"]) assert.doesNotMatch(read(f), /\.promoted\b/, f);
  assert.match(WF, /live: \$cfg\[0\]\.replayBase\.version/);
  // the script reads Results only (m119 pins no push / no write for it) and is the only reader of latest.json in the workflow's scripts
  assert.doesNotMatch(read("peaceai/bin/lm-retrain-promoted.sh"), /git push|results-write/);
  assert.doesNotMatch(WF.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n"), /models\/lm\/latest\.json/, "the workflow itself never reads or writes latest.json");
  assert.match(WF, /"\$RUNNER_TEMP\/drops\.txt" "\$RUNNER_TEMP\/pp"\n/, "corpus-gate cleanup removes the pin check's scratch");
});

test("M129 new files are protected", () => {
  for (const f of ["peaceai/bin/lm-retrain-promoted.sh", "peaceai/test/m129-lm-retrain-promoted-gate.test.ts", "peaceai/model/lm-retrain.json"]) assert.ok(protectedReason(f), f);
});
