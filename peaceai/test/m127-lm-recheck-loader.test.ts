// Fix B (Auditor's conditions 1-5, after recheck run 40766362070 of retrain run 40694718190): the model loader accepts
// a PASS memcheck recheck (runs/lm-retrain/<config.json retrain.runId>/memcheck-recheck-<run>.json) for a pretrain-mode
// retrain model whose first memcheck.json FAILed, only when every condition holds; any FAIL recheck refuses; trainedOn
// is compared key-order independently (also the M52 check); lmEvaluate counts only the judged model's scores; a refused
// model under PEACEAI_LM_SHADOW is logged once, as a reason code only. Fixtures only: no real model, record or core.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { logShadowRefusal, lmShadowRanking, MEMCHECK_SCHEMA, modelFileShas, recheckDecision, retrainRunDir, sameJson, verifyModelDir } from "../lib/lm.ts";

const repo = resolve(import.meta.dirname, "..", "..");
const py = process.env.PEACEAI_PYTHON ?? "python3";
const V = "lm-v1-000000000127", RUN = "40694718190", RECHECK = "40766362070", OTHER_RUN = "40694718191";
const P = "1".repeat(64), F = "2".repeat(64);
const tmp = (fn: (d: string) => void) => { const d = mkdtempSync(join(tmpdir(), "m127-")); try { fn(d); } finally { rmSync(d, { recursive: true, force: true }); } };
const json = (p: string, x: unknown) => writeFileSync(p, JSON.stringify(x, null, 1));
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));

/** <root>/models/lm/<V>/ and <root>/runs/lm-retrain/<RUN>/ in the runtime layout, with a FAIL memcheck.json (binding
 *  the files) and one PASS recheck shaped like the memcheck-only path's output. */
function layout(root: string, o: { cfg?: (c: any) => void; recheck?: (r: any) => void; memcheck?: (m: any) => void } = {}) {
  const dir = join(root, "models", "lm", V), run = join(root, "runs", "lm-retrain", RUN);
  mkdirSync(dir, { recursive: true }); mkdirSync(run, { recursive: true });
  const cfg: any = { schema: "peaceai-lm:v1", version: V, retrain: { mode: "pretrain", initFrom: "lm-v1-088073d41dbc", finetuneManifestSha256: F, runId: RUN, replayManifestSha256: P, replayCorpus: { manifestSha256: P } } };
  o.cfg?.(cfg);
  json(join(dir, "config.json"), cfg); writeFileSync(join(dir, "tokenizer.json"), "{}"); writeFileSync(join(dir, "weights.npz"), "w");
  const files = modelFileShas(dir)!;
  const mc: any = { schema: MEMCHECK_SCHEMA, status: "FAIL", substringRule: "strict", model: V, files: clone(files) };
  o.memcheck?.(mc);
  json(join(dir, "memcheck.json"), mc);
  const proofs = { ok: true, reasons: [], trainedOn: { finetune: F, pretrain: P }, note: { checked: false } };
  const r: any = {
    schema: MEMCHECK_SCHEMA, status: "PASS", substringRule: "core-free-64", model: V, files: clone(files), coreFreeProofs: clone(proofs),
    pretrainMemcheck: { schema: "peaceai-lm-retrain-memcheck-pretrain:v2", twoCorpus: true, runStatus: { ftCorpus: "PASS", replayCorpus: "PASS" },
      replayCorpus: { schema: MEMCHECK_SCHEMA, status: "PASS", substringRule: "core-free-64", model: V, files: clone(files), coreFreeProofs: clone(proofs) } },
    recheck: { sourceRunId: RUN, recheckRunId: RECHECK, workspaceSha: "7".repeat(40), candidate: V, promotes: false },
  };
  o.recheck?.(r);
  json(join(run, `memcheck-recheck-${RECHECK}.json`), r);
  json(join(run, "memcheck.json"), mc);
  return { dir, run, files };
}
/** infer.py's own check must agree: exit 3 (MEMCHECK_REQUIRED) iff the loader refuses. */
function inferRefuses(dir: string): boolean {
  const req = join(dir, "..", "req.json");
  writeFileSync(req, JSON.stringify({ items: [] }));
  const r = spawnSync(py, [join(repo, "peaceai/model/infer.py"), "score", "--model", dir, "--request", req, "--response", join(dir, "..", "res.json")], { encoding: "utf8" });
  return r.status === 3;
}
const refused = (dir: string, reason: string, why: string) => {
  assert.deepEqual(verifyModelDir(dir), { ok: false, reason }, why);
  assert.equal(inferRefuses(dir), true, `infer.py: ${why}`);
};

test("Fix B (1) a PASS two-corpus recheck in the model's own run directory loads the model; infer.py agrees", () => tmp((d) => {
  const { dir } = layout(d);
  assert.deepEqual(verifyModelDir(dir), { ok: true, version: V });
  assert.equal(inferRefuses(dir), false);
  // Without the recheck the first memcheck's FAIL stands.
  rmSync(join(d, "runs", "lm-retrain", RUN, `memcheck-recheck-${RECHECK}.json`));
  refused(dir, "MEMCHECK_FAILED", "no recheck");
}));

test("Fix B (1) wrong run dir: a recheck is read only under runs/lm-retrain/<config.json retrain.runId>/", () => {
  tmp((d) => { // under another run's directory
    const { dir, run } = layout(d);
    const other = join(d, "runs", "lm-retrain", OTHER_RUN); mkdirSync(other, { recursive: true });
    renameSync(join(run, `memcheck-recheck-${RECHECK}.json`), join(other, `memcheck-recheck-${RECHECK}.json`));
    refused(dir, "MEMCHECK_FAILED", "recheck under another run");
  });
  tmp((d) => { // in the model directory itself
    const { dir, run } = layout(d);
    renameSync(join(run, `memcheck-recheck-${RECHECK}.json`), join(dir, `memcheck-recheck-${RECHECK}.json`));
    refused(dir, "MEMCHECK_FAILED", "recheck in the model dir");
  });
  tmp((d) => { const { dir } = layout(d, { recheck: (r) => { r.recheck.sourceRunId = OTHER_RUN; } }); refused(dir, "RECHECK_INVALID", "recheck of another source run"); });
  tmp((d) => { const { dir } = layout(d, { cfg: (c) => { c.retrain.runId = OTHER_RUN; } }); refused(dir, "MEMCHECK_FAILED", "config names another run (its dir is absent)"); });
  tmp((d) => { const { dir } = layout(d, { recheck: (r) => { r.recheck.recheckRunId = "40766362071"; } }); refused(dir, "RECHECK_INVALID", "recheckRunId differs from the file name"); });
  tmp((d) => { // a run directory that is a symlink is not read
    const { dir, run } = layout(d);
    renameSync(run, join(d, "elsewhere")); symlinkSync(join(d, "elsewhere"), run);
    refused(dir, "MEMCHECK_FAILED", "symlinked run dir");
  });
});

test("Fix B (1) runs/ is found from the runtime layout <results>/models/lm/<version>/ only", () => tmp((d) => {
  const { dir } = layout(join(d, "results"));
  assert.equal(retrainRunDir(dir, V, RUN), join(d, "results", "runs", "lm-retrain", RUN));
  assert.equal(retrainRunDir(join(dir, "..", "..", "lm", V), V, RUN), join(d, "results", "runs", "lm-retrain", RUN), "path normalised");
  assert.equal(retrainRunDir(dir, "lm-v1-0000000000ff", RUN), null, "dir name is not the version");
  assert.equal(retrainRunDir(dir, V, "12"), null, "bad run id");
  assert.equal(retrainRunDir(dir, V, 40694718190 as never), null, "run id must be the string config.json records");
  // The same files outside models/lm/ (e.g. a staged copy) never find the run.
  const staged = join(d, "staged", V); mkdirSync(staged, { recursive: true });
  for (const f of ["config.json", "tokenizer.json", "weights.npz", "memcheck.json"]) writeFileSync(join(staged, f), readFileSync(join(dir, f)));
  mkdirSync(join(d, "runs", "lm-retrain"), { recursive: true }); renameSync(join(d, "results", "runs", "lm-retrain", RUN), join(d, "runs", "lm-retrain", RUN));
  assert.equal(retrainRunDir(staged, V, RUN), null);
  refused(staged, "MEMCHECK_FAILED", "not in the runtime layout");
}));

test("Fix B (1) sha mismatch: the recheck and the original memcheck.json must both bind the model's exact files", () => {
  tmp((d) => { const { dir } = layout(d, { recheck: (r) => { r.files["weights.npz"] = "9".repeat(64); } }); refused(dir, "RECHECK_INVALID", "recheck files"); });
  tmp((d) => { const { dir } = layout(d, { recheck: (r) => { r.pretrainMemcheck.replayCorpus.files["config.json"] = "9".repeat(64); } }); refused(dir, "RECHECK_INVALID", "replay-run files"); });
  tmp((d) => { const { dir } = layout(d, { recheck: (r) => { r.files.extra = "9".repeat(64); } }); refused(dir, "RECHECK_INVALID", "extra file"); });
  tmp((d) => { const { dir } = layout(d, { memcheck: (m) => { m.files["tokenizer.json"] = "9".repeat(64); } }); refused(dir, "MEMCHECK_STALE", "original memcheck binds other files"); });
  tmp((d) => { const { dir } = layout(d, { memcheck: (m) => { m.model = "lm-v1-0000000000ff"; } }); refused(dir, "MEMCHECK_STALE", "original memcheck for another model"); });
  tmp((d) => { const { dir } = layout(d); writeFileSync(join(dir, "weights.npz"), "w2"); refused(dir, "RECHECK_INVALID", "weights changed after both records"); });
  tmp((d) => { const { dir } = layout(d, { recheck: (r) => { r.files = { "weights.npz": r.files["weights.npz"], "tokenizer.json": r.files["tokenizer.json"], "config.json": r.files["config.json"] }; } });
    assert.deepEqual(verifyModelDir(dir), { ok: true, version: V }, "files key order does not matter"); assert.equal(inferRefuses(dir), false); });
});

test("Fix B (1) a FAIL recheck can never be outvoted by a PASS (also when memcheck.json itself is PASS)", () => {
  const fail = (r: any) => { r.status = "FAIL"; r.recheck.recheckRunId = "40766362071"; };
  tmp((d) => {
    const { dir, run } = layout(d);
    const pass = JSON.parse(readFileSync(join(run, `memcheck-recheck-${RECHECK}.json`), "utf8"));
    const f = clone(pass); fail(f); json(join(run, "memcheck-recheck-40766362071.json"), f);
    refused(dir, "RECHECK_FAILED", "FAIL alongside PASS");
    assert.equal(recheckDecision(run, JSON.parse(readFileSync(join(dir, "config.json"), "utf8")), modelFileShas(dir)!), "RECHECK_FAILED");
    // Even a first memcheck PASS is refused once the model's run holds a FAIL recheck.
    const mc = JSON.parse(readFileSync(join(dir, "memcheck.json"), "utf8")); json(join(dir, "memcheck.json"), { ...mc, status: "PASS" });
    refused(dir, "RECHECK_FAILED", "memcheck PASS but a FAIL recheck");
  });
  tmp((d) => { const { dir } = layout(d, { recheck: (r) => { r.pretrainMemcheck.runStatus.ftCorpus = "FAIL"; } }); refused(dir, "RECHECK_FAILED", "one run FAILed"); });
  tmp((d) => { const { dir } = layout(d, { recheck: (r) => { r.pretrainMemcheck.replayCorpus.status = "FAIL"; } }); refused(dir, "RECHECK_FAILED", "replay run FAILed"); });
  tmp((d) => { const { dir, run } = layout(d); writeFileSync(join(run, "memcheck-recheck-40766362071.json"), "{not json"); refused(dir, "RECHECK_FAILED", "unreadable recheck"); });
  tmp((d) => { const { dir, run } = layout(d); writeFileSync(join(run, "memcheck-recheck-latest.json"), "{}"); refused(dir, "RECHECK_FAILED", "malformed recheck name"); });
});

test("Fix B (1) only a schema v2, two-corpus, core-free-64 recheck with both proofs ok counts (v1 / strict / no twoCorpus refused)", () => {
  const cases: [string, (r: any) => void][] = [
    ["pretrain schema v1", (r) => { r.pretrainMemcheck.schema = "peaceai-lm-retrain-memcheck-pretrain:v1"; }],
    ["strict rule", (r) => { r.substringRule = "strict"; }],
    ["strict replay run", (r) => { r.pretrainMemcheck.replayCorpus.substringRule = "strict"; }],
    ["no substringRule (strict)", (r) => { delete r.substringRule; }],
    ["missing twoCorpus", (r) => { delete r.pretrainMemcheck.twoCorpus; }],
    ["twoCorpus false", (r) => { r.pretrainMemcheck.twoCorpus = false; }],
    ["twoCorpus \"true\"", (r) => { r.pretrainMemcheck.twoCorpus = "true"; }],
    ["coreFreeProofs not ok", (r) => { r.coreFreeProofs.ok = false; }],
    ["replay-run coreFreeProofs not ok", (r) => { r.pretrainMemcheck.replayCorpus.coreFreeProofs.ok = false; }],
    ["replay-run coreFreeProofs missing", (r) => { delete r.pretrainMemcheck.replayCorpus.coreFreeProofs; }],
    ["top schema", (r) => { r.schema = "peaceai-lm-memcheck:v0"; }],
    ["model", (r) => { r.model = "lm-v1-0000000000ff"; }],
    ["replay-run model", (r) => { r.pretrainMemcheck.replayCorpus.model = "lm-v1-0000000000ff"; }],
    ["recheck.candidate", (r) => { r.recheck.candidate = "lm-v1-0000000000ff"; }],
    ["no recheck block", (r) => { delete r.recheck; }],
  ];
  for (const [why, f] of cases) tmp((d) => { const { dir } = layout(d, { recheck: f }); refused(dir, "RECHECK_INVALID", why); });
});

test("Fix B (2) retrainPretrainTrainedOn must be non-null and equal the recheck's trainedOn, key order ignored, swapped values refused", () => {
  tmp((d) => { const { dir } = layout(d, { recheck: (r) => { for (const x of [r.coreFreeProofs, r.pretrainMemcheck.replayCorpus.coreFreeProofs]) x.trainedOn = { pretrain: P, finetune: F }; } });
    assert.deepEqual(verifyModelDir(dir), { ok: true, version: V }, "key order does not matter"); assert.equal(inferRefuses(dir), false); });
  tmp((d) => { const { dir } = layout(d, { recheck: (r) => { r.coreFreeProofs.trainedOn = { pretrain: F, finetune: P }; } }); refused(dir, "RECHECK_INVALID", "swapped values"); });
  tmp((d) => { const { dir } = layout(d, { recheck: (r) => { r.pretrainMemcheck.replayCorpus.coreFreeProofs.trainedOn = { finetune: P, pretrain: F }; } }); refused(dir, "RECHECK_INVALID", "swapped values (replay run)"); });
  tmp((d) => { const { dir } = layout(d, { recheck: (r) => { r.coreFreeProofs.trainedOn = { finetune: F, pretrain: P, extra: P }; } }); refused(dir, "RECHECK_INVALID", "extra key"); });
  tmp((d) => { const { dir } = layout(d, { cfg: (c) => { c.retrain.mode = "finetune"; } }); refused(dir, "RECHECK_INVALID", "retrainPretrainTrainedOn null (not pretrain)"); });
  tmp((d) => { const { dir } = layout(d, { cfg: (c) => { c.retrain.replayCorpus.manifestSha256 = F; } }); refused(dir, "RECHECK_INVALID", "retrainPretrainTrainedOn null (replay shas disagree)"); });
  assert.equal(sameJson({ a: 1, b: { c: 2, d: [1, { e: 1, f: 2 }] } }, { b: { d: [1, { f: 2, e: 1 }], c: 2 }, a: 1 }), true);
  assert.equal(sameJson({ a: 1, b: 2 }, { a: 2, b: 1 }), false);
  assert.equal(sameJson([1, 2], [2, 1]), false, "array order still matters");
  assert.equal(sameJson({ a: 1 }, { a: 1, b: undefined }), true, "as JSON");
  assert.equal(sameJson(undefined, { a: 1 }), false);
});

test("Fix B (2) the M52 trainedOn check (lm.ts verifyModelDir, two-corpus config) uses the same key-order independent compare", () => tmp((d) => {
  const dir = join(d, "m52"); mkdirSync(dir);
  json(join(dir, "config.json"), { schema: "peaceai-lm:v1", version: "lm-v1-000000000052", trainedOn: { pretrainManifestSha256: P, finetuneManifestSha256: F } });
  writeFileSync(join(dir, "tokenizer.json"), "{}"); writeFileSync(join(dir, "weights.npz"), "w");
  const mc = (trainedOn: unknown) => json(join(dir, "memcheck.json"), { schema: MEMCHECK_SCHEMA, status: "PASS", files: modelFileShas(dir), coreFreeProofs: { ok: true, reasons: [], trainedOn } });
  mc({ pretrain: P, finetune: F }); assert.deepEqual(verifyModelDir(dir), { ok: true, version: "lm-v1-000000000052" });
  mc({ finetune: F, pretrain: P }); assert.deepEqual(verifyModelDir(dir), { ok: true, version: "lm-v1-000000000052" }, "key order does not matter (was JSON.stringify)");
  mc({ pretrain: F, finetune: P }); assert.deepEqual(verifyModelDir(dir), { ok: false, reason: "MEMCHECK_FAILED" }, "swapped values refuse");
  mc({ finetune: P, pretrain: F }); assert.deepEqual(verifyModelDir(dir), { ok: false, reason: "MEMCHECK_FAILED" }, "swapped values refuse in either order");
}));

test("Fix B (5) a refused model under PEACEAI_LM_SHADOW is logged once, as a reason code only", () => tmp((d) => {
  const { dir } = layout(d, { recheck: (r) => { r.pretrainMemcheck.twoCorpus = false; } });
  const lines: string[] = [], state = { logged: false };
  const ranking = { presentation: [{ id: "candidate-1" }, { id: "candidate-2" }], rankerOrder: ["candidate-1", "candidate-2"] } as never;
  for (let i = 0; i < 3; i += 1) assert.equal(lmShadowRanking(dir, ranking, () => "", { env: { PEACEAI_LM_SHADOW: "true" }, log: (l) => lines.push(l), state }), null);
  assert.deepEqual(lines, ["lm shadow: model refused reason=RECHECK_INVALID"], "once, reason only");
  for (const l of lines) for (const secret of [d, dir, V, RUN, RECHECK, P, F, "memcheck-recheck"]) assert.ok(!l.includes(secret), `no path, version, run or hash in the log (${secret})`);
  // Shadow off: nothing logged.
  const off: string[] = [];
  assert.equal(lmShadowRanking(dir, ranking, () => "", { env: {}, log: (l) => off.push(l), state: { logged: false } }), null);
  assert.equal(logShadowRefusal("MODEL_MISSING", { env: { PEACEAI_LM_SHADOW: "1" }, log: (l) => off.push(l), state: { logged: false } }), false, "only exactly \"true\"");
  assert.deepEqual(off, []);
  // A different later reason is still not logged a second time in the same process.
  assert.equal(logShadowRefusal("MODEL_MISSING", { env: { PEACEAI_LM_SHADOW: "true" }, log: (l) => lines.push(l), state }), false);
  assert.equal(lines.length, 1);
  // record-task.ts calls lmShadowRanking with the default (process-wide) logger, and only under the shadow flag.
  const rt = readFileSync(join(repo, "peaceai/bin/record-task.ts"), "utf8");
  assert.match(rt, /if \(lmFlags\(process\.env\)\.shadow\) \{\n  const lmDir = latestLmDir\(resultsRoot\);\n  const lmShadow = lmDir \? lmShadowRanking\(lmDir, records\.ranking, diffOf\) : null;/);
}));

test("Fix B item 3: the retrain restore uses lm-retrain.json replayBase, never latest.json (latest.json naming another version is ignored); pins enforced", () => tmp((d) => {
  const H = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");
  const g = (cwd: string, ...a: string[]) => execFileSync("git", ["-C", cwd, "-c", "user.name=t", "-c", "user.email=t@t", ...a], { encoding: "utf8" }).trim();
  const CFG = JSON.parse(readFileSync(join(repo, "peaceai/model/lm-retrain.json"), "utf8"));
  // the real config: replayBase is the existing live model with its existing manifest and proof pins
  assert.deepEqual(CFG.replayBase && [CFG.replayBase.version, CFG.replayBase.manifestSha256, CFG.replayBase.corefreeProofSha256],
    ["lm-v1-088073d41dbc", "6fc30d39a649601067a1ad8f74c10083993420db0abdbeb1ae8e72286fa19ab1", "24ffc77c1d49cd9b441d09613d799dc64b78a838c3c352fe470e7e3dab74281a"]);
  assert.equal(CFG.replayBase.manifestSha256, CFG.replay.manifestSha256); assert.equal("live" in CFG, false, "the live entry is retired (m131)");
  // the judge-v2 live AUC pin is unchanged and still names the replay base
  const V2 = JSON.parse(readFileSync(join(repo, "peaceai/model/judge-v2.json"), "utf8"));
  assert.deepEqual(V2.live, { version: "lm-v1-088073d41dbc", auc: 0.175, auc_ci95: [0.116, 0.237] });
  for (const f of [".github/workflows/peace-lm-retrain.yml", ".github/workflows/peace-lm-judge-v2.yml", "peaceai/bin/lm-retrain-memcheck-fetch.sh", "peaceai/bin/lm-retrain-live.sh"]) {
    const code = readFileSync(join(repo, f), "utf8").split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");
    assert.match(code, /\.replayBase\.version/, `${f} reads the replay base`);
    assert.doesNotMatch(code, /live=\$\(jq -r \.live\.version/, `${f} no longer takes the live model from .live`);
  }
  assert.match(readFileSync(join(repo, "peaceai/bin/lm-memcheck.ts"), "utf8"), /liveVersion: String\(rc\.replayBase\?\.version/);
  // fixture Results: the replay base model, and latest.json naming a different (promoted) version
  const m = CFG.model, w = "fixture-replay-base-weights", BASE = `lm-v1-${H(w).slice(0, 12)}`;
  const src = join(d, "results-src"), L = join(src, "models/lm", BASE); mkdirSync(L, { recursive: true }); g(d, "init", "-q", src);
  const man = "{\"doc\":0}\n", proof = JSON.stringify({ noCoreFiles: "PROVEN", manifestSha256: H(man) }) + "\n";
  writeFileSync(join(src, "models/lm/latest.json"), JSON.stringify({ version: "lm-v1-858573767465", memcheck: "PASS" }));
  json(join(L, "config.json"), { version: BASE, ctx: m.ctx, d_model: m.d_model, n_layer: m.n_layer, n_head: m.n_head, vocab_size: m.vocab });
  writeFileSync(join(L, "tokenizer.json"), "{}"); writeFileSync(join(L, "weights.npz"), w); writeFileSync(join(L, "manifest.jsonl"), man); writeFileSync(join(L, "corefree-proof.json"), proof);
  g(src, "add", "-A"); g(src, "commit", "-qm", "r");
  const bare = join(d, "results.git"); execFileSync("git", ["clone", "-q", "--bare", src, bare]); g(bare, "config", "uploadpack.allowFilter", "true");
  // scratch cwd: the restore script, the deploy-key wrapper and a stub judge fetch
  const cwd = join(d, "cwd"); mkdirSync(join(cwd, "peaceai/bin"), { recursive: true }); mkdirSync(join(cwd, "peaceai/model"));
  for (const f of ["lm-retrain-live.sh", "with-deploy-key.sh"]) { copyFileSync(join(repo, "peaceai/bin", f), join(cwd, "peaceai/bin", f)); chmodSync(join(cwd, "peaceai/bin", f), 0o755); }
  writeFileSync(join(cwd, "peaceai/bin/lm-retrain-judge.sh"), "#!/usr/bin/env bash\necho \"$2\" > \"$1/judged\"\n"); chmodSync(join(cwd, "peaceai/bin/lm-retrain-judge.sh"), 0o755);
  const run = (cfg: any) => {
    json(join(cwd, "peaceai/model/lm-retrain.json"), cfg); const dest = join(d, "dest"); rmSync(dest, { recursive: true, force: true });
    const r = spawnSync("bash", ["peaceai/bin/lm-retrain-live.sh", dest], { cwd, encoding: "utf8", env: { ...process.env, DEPLOY_KEY: "fixture-not-a-key", GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: `url.file://${bare}.insteadOf`, GIT_CONFIG_VALUE_0: "git@github.com:PeaceG03/PeaceAI-Results.git", GIT_TERMINAL_PROMPT: "0" } });
    return { st: r.status, out: r.stdout + r.stderr, dest };
  };
  const base = { ...CFG, replay: { ...CFG.replay, manifestSha256: H(man) }, replayBase: { version: BASE, manifestSha256: H(man), corefreeProofSha256: H(proof) } };
  const ok = run(base);
  assert.equal(ok.st, 0, ok.out); assert.match(ok.out, new RegExp(`live model ${BASE} restored`));
  assert.equal(readFileSync(join(ok.dest, "judged"), "utf8"), `${BASE}\n`, "judged and scored as the replay base, not latest.json's version");
  assert.equal(readFileSync(join(ok.dest, "live/weights.npz"), "utf8"), w);
  const no = (why: string, cfg: any, msg: RegExp) => { const r = run(cfg); assert.notEqual(r.st, 0, `${why}: ${r.out}`); assert.match(r.out, msg, why); };
  // the retired live entry, reintroduced: refused whether it names another model or the replay base itself
  no("live entry naming another model", { ...base, live: { version: "lm-v1-858573767465", corefreeProofSha256: H(proof) } }, /has the retired live entry/);
  no("live entry naming the replay base", { ...base, live: { version: BASE, corefreeProofSha256: H(proof) } }, /has the retired live entry/);
  no("replay base proof pin differs", { ...base, replayBase: { ...base.replayBase, corefreeProofSha256: "0".repeat(64) } }, /core-free proof differs from its pin/);
  no("replay.manifestSha256 differs from the replay base's", { ...base, replay: { ...base.replay, manifestSha256: "0".repeat(64) } }, /replay\.manifestSha256 is not replayBase\.manifestSha256/);
  no("no replay base", { ...base, replayBase: undefined }, /bad replay base version/);
}));
