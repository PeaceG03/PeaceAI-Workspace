// M125 (Builder, 2026-10-28; Auditor's reuse idea + Peace's "training results must never be lost again").
// 1. Durable sweep arms: each sweep arm, as soon as it finishes and before select runs, stages its summary, its losses
//    and the export of its best.npz (the checkpoint at its validation-selected step) with lm-retrain-arm-save.sh and
//    saves them in Results runs/lm-retrain/<run>/arms/<arm>/ through the dry-run guard (save.json binds every file by
//    sha256; the job's "saved" output {saveSha256, weightsSha256} exists only after the push). No artifact, no cache.
// 2. Reuse: finetune-eval-land verifies the saved arms by sha256 against the arm jobs' outputs (lm-retrain-arm-verify.sh),
//    selects on the verified summaries, and makes the selected arm's checkpoint the candidate (lm-retrain-arm-reuse.sh)
//    instead of re-training it from the live weights (14461 s in run 40624227227, same val loss 3.5199). An unsaved
//    selected arm is re-trained (the pre-M125 path); a saved arm that does not match refuses.
// 3. Resume: input resume_run_id skips the sweep and runs select, scoring and landing on that run's saved arms.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { protectedReason } from "../lib/selfchange.ts";

const repo = resolve(import.meta.dirname, "..", "..");
const read = (p: string) => readFileSync(join(repo, p), "utf8");
const CFG = JSON.parse(read("peaceai/model/lm-retrain.json"));
const WF = read(".github/workflows/peace-lm-retrain.yml");
const py = process.env.PEACEAI_PYTHON ?? "python3";
const sha = (p: string) => createHash("sha256").update(readFileSync(p)).digest("hex");
const job = (j: string) => { const i = WF.indexOf(`\n  ${j}:\n`); assert.ok(i > 0, j); const rest = WF.slice(i + 1); const n = rest.slice(1).search(/\n  [a-z][a-z-]*:\n/); return n < 0 ? rest : rest.slice(0, n + 1); };
const env0 = (over: Record<string, string | undefined>) => { const e: Record<string, string> = {}; for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !(k in over) && !/^(GITHUB_|RUNNER_|RESUME$|DRY_RUN$|MODE$|S[AB]$|V[AB]$|MANIFEST$)/.test(k)) e[k] = v; for (const [k, v] of Object.entries(over)) if (v !== undefined) e[k] = v; return e; };
const block = (text: string, start: string, end: RegExp) => { const i = text.indexOf(start); assert.ok(i >= 0, start); const rest = text.slice(i + start.length); const j = rest.search(end); return j < 0 ? rest : rest.slice(0, j); };
const dedent = (t: string, n: number) => t.split("\n").map((l) => l.slice(Math.min(n, l.length - l.trimStart().length))).join("\n");
const stepRun = (jobText: string, name: string) => dedent(block(block(jobText, `      - name: ${name}`, /\n      - name: |\n\n  [a-z]/), "        run: |\n", /$^/), 10);
const sh = (cmd: string, args: string[], env: Record<string, string | undefined>) => spawnSync(cmd, args, { cwd: repo, encoding: "utf8", env: env0(env) });
const git = (cwd: string, ...a: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "init.defaultBranch=main", ...a], { cwd, encoding: "utf8" });

const MODE = "pretrain";
const LRS: number[] = CFG[MODE].sweep.lrs;
const RUN = "40700000001", RUN2 = "40700000002", WS = "1".repeat(40);
const MANIFEST_TEXT = '{"doc":0,"path":"a.ts"}\n';

// ---- one tiny real training run (train.py + best.npz), re-used for both arms (each arm gets its own summary)
let fx: { d: string; work: string[]; live: string; ft: string; manifest: string; vs: unknown; S: Record<string, unknown>[] } | null = null;
function fixture() {
  if (fx) return fx;
  const d = mkdtempSync(join(tmpdir(), "m125-"));
  const corpus = join(d, "corpus"); mkdirSync(corpus);
  const docs: string[] = [], man: string[] = [];
  for (let i = 0; i < 70; i += 1) {
    const text = `export function f${i}(x: number): number {\n  return x + ${i};\n}\n`;
    docs.push(JSON.stringify({ doc: i, text }));
    man.push(JSON.stringify({ doc: i, source: "colinhacks/zod", visibility: "public", commit: "a".repeat(40), path: `src/f${i}.ts`, sha256: "0", bytes: text.length, license: "MIT", split: i % 10 === 3 ? "heldout" : "train" }));
  }
  writeFileSync(join(corpus, "docs.jsonl"), docs.join("\n") + "\n"); writeFileSync(join(corpus, "manifest.jsonl"), man.join("\n") + "\n");
  const w0 = join(d, "arm0");
  execFileSync(py, [join(repo, "peaceai/model/train.py"), "--corpus", corpus, "--work", w0, "--steps", "6", "--max-seconds", "1e9", "--d-model", "16", "--n-layer", "1", "--n-head", "2", "--ctx", "32", "--vocab", "300", "--batch", "2", "--threads", "1", "--eval-every", "2", "--lr", "0.003"], { encoding: "utf8" });
  assert.ok(existsSync(join(w0, "best.npz")), "train.py kept a best.npz");
  // The arm's best step in the real config is a multiple of evalEvery (here 1200 = pretrain.steps): re-stamp the tiny
  // checkpoint's step so export.py's trained_steps is the bestStep the summary carries (the arrays are untouched).
  execFileSync(py, ["-c", "import numpy as np, json, sys; z = dict(np.load(sys.argv[1], allow_pickle=False)); m = json.loads(str(z['meta'])); m['step'] = 1200; z['meta'] = np.array(json.dumps(m)); np.savez(sys.argv[1], **z)", join(w0, "best.npz")]);
  const w1 = join(d, "arm1"); cpSync(w0, w1, { recursive: true });
  const live = join(d, "live"); mkdirSync(live); cpSync(join(w0, "tokenizer.json"), join(live, "tokenizer.json"));
  const ft = join(d, "ft"); mkdirSync(ft); writeFileSync(join(ft, "manifest.jsonl"), MANIFEST_TEXT);
  const vs = { docs: 79, sha256: "197b70a7ace3ed92615ccada9526ed4168f316b2087fb3316e3b6286c08f0c7f", trainDocs: 42663 };
  const replay = { replayFrac: CFG[MODE].replayFrac, replayRows: CFG[MODE].batch ?? 16, ftRows: 0, val: { docs: CFG[MODE].valWindows, seed: "peaceai-val:v1", sha256: "9".repeat(64), windows: CFG[MODE].valWindows },
    corpus: { docsSha256: "4".repeat(64), docsBytes: 69548335, manifestSha256: "6".repeat(64) } };
  const S = [0, 1].map((a) => ({ bestStep: 1200, bestVal: a === 0 ? 3.5199 : 3.7027, deadlineCut: false, earlyStop: false, lr: LRS[a], noEvalAfterStep0: false, step0Val: 3.9159, steps: CFG[MODE].steps, stopAt: 0, stoppedStep: 1200, valAtStop: 3.6, valSplit: vs, mode: MODE, batch: 16,
    timing: { bestStep: 1200, evalSeconds: 160, setupSeconds: 26, trainSeconds: 8230, steps: 1200, stopReason: "steps", stoppedStep: 1200, timeCut: false }, replay }));
  [w0, w1].forEach((w, a) => writeFileSync(join(w, "summary.json"), JSON.stringify(S[a])));
  fx = { d, work: [w0, w1], live, ft, manifest: sha(join(ft, "manifest.jsonl")), vs, S };
  return fx;
}
test.after(() => { if (fx) rmSync(fx.d, { recursive: true, force: true }); });
const jobSummary = (a: number) => JSON.stringify({ ...fixture().S[a], arm: a });

// A local Results remote (results-write.sh's local-test override): the real recorder, commit and push.
function results(d: string) {
  const bare = join(d, "results.git"); mkdirSync(bare); git(bare, "init", "-q", "--bare");
  const seed = join(d, "seed"); mkdirSync(seed); git(seed, "init", "-q"); writeFileSync(join(seed, "README.md"), "results\n");
  git(seed, "add", "-A"); git(seed, "commit", "-q", "-m", "seed"); git(seed, "push", "-q", bare, "HEAD:main");
  return bare;
}
const checkout = (bare: string, d: string) => { const c = join(d, `co-${Math.random().toString(36).slice(2)}`); git(d, "clone", "-q", bare, c); return c; };

// The workflow's own stage + save steps (with-deploy-key.sh dropped: no key in tests; the dry-run guard and the real
// results-write.sh stay), run for one arm. Returns the step output and what reached GITHUB_OUTPUT.
const SWEEP = job("sweep-a");
const SAVE_STEP = stepRun(SWEEP, "Save the finished arm in Results before select runs");
function saveArm(d: string, bare: string, a: number, over: Record<string, string> = {}) {
  const f = fixture(); const rt = join(d, `rt-${a}-${Math.random().toString(36).slice(2)}`); mkdirSync(rt, { recursive: true });
  const out = join(rt, "out"); writeFileSync(out, "");
  const base = { DRY_RUN: "false", MODE, GITHUB_RUN_ID: RUN, GITHUB_SHA: WS, PEACEAI_PYTHON: py, RUNNER_TEMP: rt, GITHUB_OUTPUT: out, ARM: String(a), PEACEAI_RESULTS_REMOTE_OVERRIDE: bare, ...over };
  const stage = sh("bash", ["peaceai/bin/lm-retrain-arm-save.sh", f.work[a]!, f.live, f.ft, join(rt, "armsave"), String(a)], base);
  if (stage.status !== 0) return { status: stage.status, stdout: stage.stdout + stage.stderr, out: "", saved: "" };
  const script = SAVE_STEP.replace("./peaceai/bin/with-deploy-key.sh ", "");
  const r = sh("bash", ["-c", script], { ...base, STAGE: join(rt, "armsave") });
  const o = readFileSync(out, "utf8"); const m = /^saved=(.*)$/m.exec(o);
  return { status: r.status, stdout: stage.stdout + r.stdout + r.stderr, out: o, saved: m ? m[1]! : "" };
}
// finetune-eval-land's fetch (the Results checkout's runs/lm-retrain/<src>/arms/) and verify step.
function fetchArms(bare: string, d: string, src: string) {
  const c = checkout(bare, d); const arms = join(d, `arms-${Math.random().toString(36).slice(2)}`); mkdirSync(arms);
  const p = join(c, "runs/lm-retrain", src, "arms"); if (existsSync(p)) cpSync(p, arms, { recursive: true });
  rmSync(c, { recursive: true, force: true }); return arms;
}
const verify = (arms: string, dest: string, e: Record<string, string>) =>
  sh("bash", ["peaceai/bin/lm-retrain-arm-verify.sh", arms, dest], { MODE, MANIFEST: fixture().manifest, GITHUB_RUN_ID: RUN, RESUME: "", ...e });
function select(dest: string, d: string) {
  const sel = join(d, `select-${Math.random().toString(36).slice(2)}.json`);
  const r = spawnSync(py, ["peaceai/model/sweep_select.py", "peaceai/model/lm-retrain.json", JSON.stringify(fixture().vs), MODE, readFileSync(join(dest, "arm-0.json"), "utf8"), readFileSync(join(dest, "arm-1.json"), "utf8")], { cwd: repo, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr); writeFileSync(sel, r.stdout); return sel;
}
function reuse(arms: string, dest: string, sel: string, d: string) {
  const rt = join(d, `ru-${Math.random().toString(36).slice(2)}`); mkdirSync(rt); const out = join(rt, "out"); writeFileSync(out, "");
  const r = sh("bash", ["peaceai/bin/lm-retrain-arm-reuse.sh", arms, dest, sel, fixture().live, join(rt, "model"), join(rt, "ct.json"), join(rt, "m.jsonl")], { GITHUB_OUTPUT: out, MODE });
  return { ...r, rt, out: readFileSync(out, "utf8") };
}
// Auditor (PR #564): the training and export code, hashed in this fixed sorted order (sha256sum lines, then sha256sum).
const CODE_FILES = ["peaceai/model/export.py", "peaceai/model/lm.py", "peaceai/model/replay.py", "peaceai/model/retrain_summary.py", "peaceai/model/train.py", "peaceai/model/val_split.py"];
const codeSha = (root: string) => createHash("sha256").update(CODE_FILES.map((p) => `${sha(join(root, p))}  ${p}\n`).join("")).digest("hex");
const tmp = (fn: (d: string) => void) => { const d = mkdtempSync(join(tmpdir(), "m125t-")); try { fn(d); } finally { rmSync(d, { recursive: true, force: true }); } };
const PRIVATE = /export function|return x \+/;

test("M125 save: each finished arm lands in Results runs/lm-retrain/<run>/arms/<arm>/ only, bound by sha256; counts only in the log", () => tmp((d) => {
  const f = fixture(); const bare = results(d);
  for (const a of [0, 1]) {
    const s = saveArm(d, bare, a);
    assert.equal(s.status, 0, s.stdout); assert.doesNotMatch(s.stdout, PRIVATE, "no corpus text in the log");
    assert.match(s.stdout, new RegExp(`^arm ${a} staged: files=5 model=yes$`, "m"));
    const v = JSON.parse(s.saved); assert.match(v.saveSha256, /^[0-9a-f]{64}$/); assert.match(v.weightsSha256, /^[0-9a-f]{64}$/);
  }
  const c = checkout(bare, d); const base = join(c, "runs/lm-retrain", RUN, "arms");
  assert.deepEqual(readdirSync(base).sort(), ["0", "1"]);
  const sv = JSON.parse(readFileSync(join(base, "0", "save.json"), "utf8"));
  assert.deepEqual(Object.keys(sv.files).sort(), ["metrics.jsonl", "model/config.json", "model/eval.json", "model/weights.npz", "summary.json"]);
  for (const [p, h] of Object.entries(sv.files)) assert.equal(sha(join(base, "0", p)), h, p);
  assert.deepEqual([sv.schema, sv.runId, sv.workspaceSha, sv.arm, sv.mode, sv.lr, sv.bestStep, sv.live, sv.finetuneManifestSha256], ["peaceai-lm-retrain-arm:v1", RUN, WS, 0, MODE, LRS[0], 1200, CFG.replayBase.version, f.manifest]);
  assert.equal(sv.codeSha256, codeSha(repo)); assert.equal(sv.tokenizerSha256, sha(join(f.live, "tokenizer.json"))); assert.equal(existsSync(join(base, "0", "model", "tokenizer.json")), false, "the live tokenizer is not duplicated");
  const cfg = JSON.parse(readFileSync(join(base, "0", "model", "config.json"), "utf8"));
  assert.equal(cfg.trained_steps, 1200); assert.equal(cfg.version, `lm-v1-${sha(join(base, "0", "model", "weights.npz")).slice(0, 12)}`);
  assert.deepEqual(JSON.parse(readFileSync(join(base, "0", "summary.json"), "utf8")), JSON.parse(jobSummary(0)), "summary.json is exactly the job summary output");
  // only this run's arm dirs changed in Results (two commits, one per arm)
  const names = git(c, "log", "--name-only", "--format=", "-2").split("\n").filter(Boolean);
  assert.ok(names.length === 12 && names.every((n) => n.startsWith(`runs/lm-retrain/${RUN}/arms/`)), names.join(","));
}));

test("M125 save failures never fail the arm: a second save of the same arm, or a dry run, writes nothing and leaves no saved output", () => tmp((d) => {
  const bare = results(d);
  assert.equal(saveArm(d, bare, 0).status, 0);
  const again = saveArm(d, bare, 0);
  assert.equal(again.status, 0, "the step itself stays green"); assert.equal(again.saved, ""); assert.match(again.stdout, /arm 0 save failed \(exit 1\): not saved; the run continues/);
  for (const v of ["true", "", "TRUE"]) {
    const dry = saveArm(d, bare, 1, { DRY_RUN: v });
    assert.notEqual(dry.status, 0); assert.match(dry.stdout, /arm save: real runs only: refused/); assert.equal(dry.saved, "");
  }
  const c = checkout(bare, d); assert.deepEqual(readdirSync(join(c, "runs/lm-retrain", RUN, "arms")), ["0"], "no dry-run write");
  // the save steps run in real runs only; dry-run behaviour (arm summary output, dry-run scoring) is unchanged
  for (const j of ["sweep-a", "sweep-b"]) {
    const t = job(j);
    // a failed stage or checkout check skips the save (the arm job stays green; that arm is re-trained if selected)
    assert.match(t, /- name: Stage the finished arm[^\n]*\n\s+id: stage\n\s+if: env\.DRY_RUN != 'true'\n\s+continue-on-error: true\n/);
    assert.match(t, /- name: Verify the checkout[^\n]*\n\s+id: verify-save\n\s+if: env\.DRY_RUN != 'true' && steps\.stage\.outcome == 'success'\n\s+continue-on-error: true\n/);
    assert.match(t, /- name: Save the finished arm[^\n]*\n\s+id: save\n\s+if: env\.DRY_RUN != 'true' && steps\.stage\.outcome == 'success' && steps\.verify-save\.outcome == 'success'\n/);
    assert.ok(t.indexOf('echo "summary=') < t.indexOf("lm-retrain-arm-save.sh") && t.indexOf("lm-retrain-arm-save.sh") < t.indexOf("lm-retrain-dryrun-score.sh"), "saved right after the arm finishes");
    assert.match(t, /\n      summary: \$\{\{ steps\.arm\.outputs\.summary \}\}\n      saved: \$\{\{ steps\.save\.outputs\.saved \}\}\n/);
    assert.match(t, /\n    if: github\.repository == 'PeaceG03\/PeaceAI-Workspace' && github\.ref == 'refs\/heads\/main' && inputs\.resume_run_id == '' && inputs\.memcheck_only_run_id == ''\n/);
    assert.match(t, /\n    environment: peaceai-results\n/, "the existing Results environment (no new secret or environment)");
    assert.match(t, /\|\| st=\$\?\n\s+\[ "\$st" = 0 \] \|\| echo "arm \$ARM save failed/);
  }
}));

test("M125 a later failure leaves the saved arms in place, and the landing never touches them", () => tmp((d) => {
  const bare = results(d);
  for (const a of [0, 1]) assert.equal(saveArm(d, bare, a).status, 0);
  const before = git(checkout(bare, d), "rev-parse", "HEAD:runs/lm-retrain/" + RUN + "/arms").trim();
  // the landing recorder (workflow text, key wrapper dropped) on a run dir that already holds the saved arms
  const LAND = stepRun(job("finetune-eval-land"), "Land the run record");
  const land = (evals: Record<string, string>, pass = "false") => {
    const rt = join(d, `land-${Math.random().toString(36).slice(2)}`); mkdirSync(join(rt, "evals"), { recursive: true }); mkdirSync(join(rt, "model"));
    for (const [n, t] of Object.entries(evals)) writeFileSync(join(rt, "evals", n), t);
    return sh("bash", ["-c", LAND.replace("./peaceai/bin/with-deploy-key.sh ", "")], { DRY_RUN: "false", GITHUB_RUN_ID: RUN, RUNNER_TEMP: rt, MODEL_DIR: join(rt, "model"), EVALS: join(rt, "evals"), PASS: pass, PEACEAI_RESULTS_REMOTE_OVERRIDE: bare, GITHUB_OUTPUT: join(rt, "o") });
  };
  // a later failure: a record with the gate failed (or any landing refusal) keeps the arms byte-identical
  const r1 = land({ "record.json": "{}\n" }); assert.equal(r1.status, 0, r1.stdout + r1.stderr);
  const c = checkout(bare, d);
  assert.equal(git(c, "rev-parse", "HEAD:runs/lm-retrain/" + RUN + "/arms").trim(), before);
  assert.ok(existsSync(join(c, "runs/lm-retrain", RUN, "record.json")));
  // a second landing (a record already there) refuses; an eval file named like the arms dir refuses; arms still intact
  assert.match(land({ "x.json": "{}\n" }).stdout, /landing refused: run dir already holds more than the saved arms/);
  rmSync(c, { recursive: true, force: true });
  assert.equal(git(checkout(bare, d), "rev-parse", "HEAD:runs/lm-retrain/" + RUN + "/arms").trim(), before);
  assert.match(WF, /a="runs\/lm-retrain\/\$GITHUB_RUN_ID\/arms\/"; \[ "\$\{name:0:\$\{#a\}\}" != "\$a" \] \|\| okp=false/);
  // nothing in the workflow removes or rewrites Results arm dirs
  assert.doesNotMatch(WF.split("\n").filter((l) => /\brm\b|git rm|mv /.test(l)).join("\n"), /RESULTS_DIR[^\n]*arms/);
}));

test("M125 reuse: verified saved arms -> select -> the selected arm's checkpoint is the candidate (sha256, step, identity checks)", () => tmp((d) => {
  const f = fixture(); const bare = results(d);
  const v = [0, 1].map((a) => saveArm(d, bare, a).saved);
  const arms = fetchArms(bare, d, RUN), dest = join(d, "v");
  const r = verify(arms, dest, { SA: jobSummary(0), SB: jobSummary(1), VA: v[0]!, VB: v[1]! });
  assert.equal(r.status, 0, r.stdout + r.stderr); assert.doesNotMatch(r.stdout, PRIVATE);
  for (const a of [0, 1]) {
    const st = JSON.parse(readFileSync(join(dest, `arm-${a}.status.json`), "utf8"));
    assert.deepEqual([st.saved, st.reusable, st.weightsSha256, st.saveSha256, st.runId, st.workspaceSha], [true, true, JSON.parse(v[a]!).weightsSha256, JSON.parse(v[a]!).saveSha256, RUN, WS]);
  }
  const sel = select(dest, d); const s = JSON.parse(readFileSync(sel, "utf8"));
  assert.deepEqual([s.selected.arm, s.selected.step, s.selected.lr, s.selected.candidate], [0, 1200, LRS[0], true]);
  const u = reuse(arms, dest, sel, d);
  assert.equal(u.status, 0, u.stdout + u.stderr); assert.match(u.out, /^reused=true$/m);
  const w = sha(join(u.rt, "model", "weights.npz")); assert.equal(w, JSON.parse(v[0]!).weightsSha256);
  assert.deepEqual(readdirSync(join(u.rt, "model")).sort(), ["config.json", "eval.json", "tokenizer.json", "weights.npz"]);
  assert.equal(sha(join(u.rt, "model", "tokenizer.json")), sha(join(f.live, "tokenizer.json")));
  const ct = JSON.parse(readFileSync(join(u.rt, "ct.json"), "utf8"));
  assert.equal(ct.stoppedStep, s.selected.step, "the gate's selected_step_not_reached check holds");
  assert.deepEqual(ct.source, { kind: "sweep-arm", runId: RUN, workspaceSha: WS, arm: 0, weightsSha256: w, saveSha256: JSON.parse(v[0]!).saveSha256 });
  assert.equal(readFileSync(join(u.rt, "m.jsonl"), "utf8"), readFileSync(join(f.work[0]!, "metrics.jsonl"), "utf8"));
  // the export the arm saved is byte-identical to what the pre-M125 candidate path exports from the same checkpoint
  const again = join(d, "again"); execFileSync(py, ["peaceai/model/export.py", "--work", f.work[0]!, "--out", again, "--threads", "1", "--checkpoint", "best.npz"], { cwd: repo });
  assert.equal(sha(join(again, "weights.npz")), w); assert.equal(sha(join(again, "eval.json")), sha(join(u.rt, "model", "eval.json")));
}));

test("M125 sha mismatch refuses (verify and reuse): weights, summary, save record, run, manifest, training config", () => tmp((d) => {
  const bare = results(d); const v = [0, 1].map((a) => saveArm(d, bare, a).saved);
  const env = { SA: jobSummary(0), SB: jobSummary(1), VA: v[0]!, VB: v[1]! };
  const bad = (mut: (arms: string) => void, e: Record<string, string>, re: RegExp) => {
    const arms = fetchArms(bare, d, RUN); mut(arms); const r = verify(arms, join(d, `v-${Math.random()}`), e);
    assert.equal(r.status, 1, r.stdout); assert.match(r.stdout, re);
  };
  const flip = (p: string) => { const b = readFileSync(p); b[b.length - 1] ^= 1; writeFileSync(p, b); };
  bad((a) => flip(join(a, "0", "model", "weights.npz")), env, /saved arm 0: sha256 mismatch \(model\/weights\.npz\): refused/);
  bad((a) => flip(join(a, "1", "metrics.jsonl")), env, /saved arm 1: sha256 mismatch \(metrics\.jsonl\): refused/);
  bad((a) => { const p = join(a, "0", "save.json"); const s = JSON.parse(readFileSync(p, "utf8")); s.bestStep = 1100; writeFileSync(p, JSON.stringify(s)); }, env, /saved arm 0: save\.json sha256 mismatch: refused/);
  bad(() => {}, { ...env, VA: JSON.stringify({ ...JSON.parse(v[0]!), weightsSha256: "0".repeat(64) }) }, /saved arm 0: weights sha256 differs from the job summary: refused/);
  bad(() => {}, { ...env, SB: JSON.stringify({ ...JSON.parse(jobSummary(1)), bestVal: 3.1 }) }, /saved arm 1: summary differs from the job summary: refused/);
  bad(() => {}, { ...env, MANIFEST: "e".repeat(64) }, /saved arm 0: not this run's arm/);
  bad(() => {}, { ...env, GITHUB_RUN_ID: RUN2 }, /saved arm 0: not this run's arm/);
  bad(() => {}, { ...env, MODE: "finetune" }, /saved arm 0: not this run's arm/);
  bad((a) => writeFileSync(join(a, "0", "extra.txt"), "x"), env, /saved arm 0: file set differs from save\.json: refused/);
  bad((a) => rmSync(join(a, "1"), { recursive: true }), env, /saved arm 1: saved by its job but missing from Results: refused/);
  bad(() => {}, { ...env, VB: "not json" }, /saved arm 1: bad saved output: refused/);
  // reuse re-checks after verification: a changed checkpoint or a different selected step refuses
  const arms = fetchArms(bare, d, RUN), dest = join(d, "ok"); assert.equal(verify(arms, dest, env).status, 0);
  const sel = select(dest, d);
  flip(join(arms, "0", "model", "weights.npz"));
  const u = reuse(arms, dest, sel, d); assert.equal(u.status, 1); assert.match(u.stdout, /checkpoint sha256 does not match the arm summary: refused/); assert.doesNotMatch(u.out, /reused=/);
  flip(join(arms, "0", "model", "weights.npz"));
  const s2 = JSON.parse(readFileSync(sel, "utf8")); s2.selected.step = 1100; writeFileSync(sel, JSON.stringify(s2));
  assert.match(reuse(arms, dest, sel, d).stdout, /saved arm is not the selected arm\/step: refused/);
  const s3 = JSON.parse(readFileSync(select(dest, d), "utf8")); s3.validationSplit = { ...s3.validationSplit, docs: 80 }; const p3 = join(d, "s3.json"); writeFileSync(p3, JSON.stringify(s3));
  assert.match(reuse(arms, dest, p3, d).stdout, /candidate used a different validation split: refused/);
}));

test("M125 missing checkpoint: an unsaved arm (save failed) is re-trained, never refused; saved-but-absent refuses", () => tmp((d) => {
  const bare = results(d); const v1 = saveArm(d, bare, 1).saved;  // arm 0's save never happened (push failed)
  const arms = fetchArms(bare, d, RUN), dest = join(d, "v");
  const r = verify(arms, dest, { SA: jobSummary(0), SB: jobSummary(1), VA: "", VB: v1 });
  assert.equal(r.status, 0, r.stdout); assert.match(r.stdout, /arm 0: not saved \(its save failed\); a selected candidate from it is re-trained/);
  assert.deepEqual(JSON.parse(readFileSync(join(dest, "arm-0.json"), "utf8")), JSON.parse(jobSummary(0)), "select reads the job summary, as before M125");
  const sel = select(dest, d); assert.equal(JSON.parse(readFileSync(sel, "utf8")).selected.arm, 0);
  const u = reuse(arms, dest, sel, d);
  assert.equal(u.status, 0); assert.match(u.out, /^reused=false$/m); assert.equal(existsSync(join(u.rt, "model")), false);
  // the workflow then re-trains (the pre-M125 step, still bounded by the candidate deadline)
  const land = job("finetune-eval-land");
  assert.match(land, /- name: Fine-tune the candidate [^\n]*\n\s+if: steps\.select\.outputs\.candidate == 'true' && steps\.reuse\.outputs\.reused != 'true'\n/);
  assert.ok(land.indexOf("lm-retrain-arm-reuse.sh") < land.indexOf("- name: Fine-tune the candidate"));
  // a job that recorded a save whose files are absent, or files present with no recorded save, refuses
  const arms2 = fetchArms(bare, d, RUN); rmSync(join(arms2, "1"), { recursive: true });
  assert.match(verify(arms2, join(d, "v2"), { SA: jobSummary(0), SB: jobSummary(1), VA: "", VB: v1 }).stdout, /saved arm 1: saved by its job but missing from Results: refused/);
  assert.match(verify(fetchArms(bare, d, RUN), join(d, "v3"), { SA: jobSummary(0), SB: jobSummary(1), VA: "", VB: "" }).stdout, /saved arm 1: in Results but the job recorded no save: refused/);
}));

test("M125 resume: a failed run's saved arms -> verify -> select -> reuse, with no sweep; mismatches and missing arms refuse", () => tmp((d) => {
  const bare = results(d); const v = [0, 1].map((a) => saveArm(d, bare, a).saved);
  // the original run failed later (e.g. its finetune-eval-land refused): nothing else landed; a new run resumes it
  const arms = fetchArms(bare, d, RUN), dest = join(d, "v");
  const r = verify(arms, dest, { GITHUB_RUN_ID: RUN2, RESUME: RUN });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const sel = select(dest, d); const u = reuse(arms, dest, sel, d);
  assert.equal(u.status, 0, u.stdout); assert.match(u.out, /^reused=true$/m);
  assert.equal(sha(join(u.rt, "model", "weights.npz")), JSON.parse(v[0]!).weightsSha256);
  assert.deepEqual([JSON.parse(readFileSync(join(u.rt, "ct.json"), "utf8")).source.runId, JSON.parse(readFileSync(join(u.rt, "ct.json"), "utf8")).source.workspaceSha], [RUN, WS], "the source run and its workspace sha");
  const res = (mut: (a: string) => void, e: Record<string, string>, re: RegExp) => {
    const a = fetchArms(bare, d, RUN); mut(a); const x = verify(a, join(d, `r-${Math.random()}`), { GITHUB_RUN_ID: RUN2, RESUME: RUN, ...e });
    assert.equal(x.status, 1, x.stdout); assert.match(x.stdout, re);
  };
  const flip = (p: string) => { const b = readFileSync(p); b[0] ^= 1; writeFileSync(p, b); };
  res((a) => flip(join(a, "0", "model", "weights.npz")), {}, /saved arm 0: sha256 mismatch \(model\/weights\.npz\): refused/);
  res((a) => rmSync(join(a, "1"), { recursive: true }), {}, /saved arm 1: not saved in run 40700000001 \(resume needs every arm\): refused/);
  res(() => {}, { RESUME: "40700000009" }, /saved arm 0: not this run's arm/);
  res(() => {}, { MANIFEST: "e".repeat(64) }, /saved arm 0: not this run's arm/);
  res(() => {}, { SA: jobSummary(0) }, /resume with sweep outputs: refused/);
  res(() => {}, { RESUME: RUN2 }, /bad resume run id: refused/);
  res(() => {}, { RESUME: "12; rm" }, /bad resume run id: refused/);
  // a resume of a run with nothing saved (e.g. 40624227227, before M125) refuses: there is nothing to verify
  const none = fetchArms(bare, d, "40624227227"); assert.match(verify(none, join(d, "n"), { GITHUB_RUN_ID: RUN2, RESUME: "40624227227" }).stdout, /not saved in run 40624227227/);
}));

test("M125 workflow wiring: resume input, job conditions, fetch behind the checkout verification, no artifacts, outcome guard unchanged", () => {
  assert.match(WF, /\n      resume_run_id:\n        description: "[^"\n]+"\n        type: string\n        default: ""\n      memcheck_only_run_id:\n        description: "[^"\n]+"\n        type: string\n        default: ""\n\npermissions: \{\}\n/);
  assert.match(WF, /\n  RESUME: \$\{\{ inputs\.resume_run_id \|\| '' \}\}\n/);
  assert.doesNotMatch(WF, /upload-artifact|download-artifact|actions\/cache/);
  // corpus-gate refuses a bad id, a dry-run resume and a self-resume
  const chk = stepRun(job("corpus-gate"), "Check the resume input");
  const run = (e: Record<string, string>) => sh("bash", ["-c", chk], { GITHUB_RUN_ID: RUN2, DRY_RUN: "false", ...e }).status;
  assert.deepEqual([run({ RESUME: "" }), run({ RESUME: RUN }), run({ RESUME: RUN, DRY_RUN: "true" }), run({ RESUME: RUN2 }), run({ RESUME: "1$(id)" }), run({ RESUME: "123" }), run({ RESUME: "", DRY_RUN: "true" })], [0, 0, 1, 1, 1, 1, 0]);
  // finetune-eval-land: a normal run needs both arms; a resume needs both skipped; memchecks run after it explicitly
  const land = job("finetune-eval-land");
  assert.match(land, /\n    if: github\.repository == 'PeaceG03\/PeaceAI-Workspace' && github\.ref == 'refs\/heads\/main' && !cancelled\(\) && needs\.corpus-gate\.result == 'success' && inputs\.memcheck_only_run_id == '' && \(\(inputs\.resume_run_id == '' && needs\.sweep-a\.result == 'success' && needs\.sweep-b\.result == 'success'\) \|\| \(inputs\.resume_run_id != '' && needs\.sweep-a\.result == 'skipped' && needs\.sweep-b\.result == 'skipped'\)\) && inputs\.dry_run != true\n/);
  assert.match(job("retrain-memcheck"), /!cancelled\(\) && needs\.corpus-gate\.result == 'success' && \(\(inputs\.memcheck_only_run_id == '' && needs\.finetune-eval-land\.result == 'success' && needs\.finetune-eval-land\.outputs\.version != ''\) \|\| \(inputs\.memcheck_only_run_id != '' && needs\.finetune-eval-land\.result == 'skipped'\)\) && inputs\.dry_run != true\n/);
  assert.match(job("record-memcheck"), /!cancelled\(\) && \(\(inputs\.memcheck_only_run_id == '' && needs\.finetune-eval-land\.result == 'success'\) \|\| \(inputs\.memcheck_only_run_id != '' && needs\.finetune-eval-land\.result == 'skipped'\)\) && needs\.retrain-memcheck\.result == 'success' && needs\.retrain-memcheck\.outputs\.memcheck != '' && inputs\.dry_run != true\n/);
  // fetch -> verify -> select -> reuse -> (re-train only if not reused) -> provenance -> score
  const order = ["Fetch the saved sweep arms", "lm-retrain-arm-verify.sh", "sweep_select.py", "lm-retrain-arm-reuse.sh", "- name: Fine-tune the candidate", "- name: Candidate files and provenance", "- name: Score live and candidate"].map((s) => land.indexOf(s));
  assert.ok(order.every((x, i) => x > 0 && (i === 0 || x > order[i - 1]!)), order.join(","));
  assert.match(land, /- name: Verify the checkout[^\n]*\n(?:\s+.*\n)*?\s+printf '%s\\n' "\$RESULTS_SHA256"[^\n]*\n      - name: Fetch the saved sweep arms/);
  assert.match(land, /sparse-checkout set --no-cone "\/runs\/lm-retrain\/\$src\/arms\/"/);
  // the provenance records where the candidate came from (additive, record schema still v5)
  assert.match(land, /candidateSource: \(\$ct\[0\]\.source \/\/ \{kind: "retrained"\}\)\}'/);
  assert.match(land, /candidateSource: \(if \$ct\[0\]\.noCandidate == true then null else \(\$ct\[0\]\.source \/\/ \{kind: "retrained"\}\) end\), resumeRunId: \(if \$rs == "" then null else \$rs end\),/);
  // the outcome guard and the dry-run guard are pinned (sha256; the outcome guard re-pinned in M126)
  assert.equal(sha(join(repo, "peaceai/bin/lm-retrain-outcome.sh")), OUTCOME_SHA256);
  assert.equal(sha(join(repo, "peaceai/bin/lm-retrain-dryrun-guard.sh")), GUARD_SHA256);
  assert.match(job("retrain-outcome"), /needs: \[corpus-gate, sweep-a, sweep-b, finetune-eval-land, retrain-memcheck, record-memcheck\]\n    if: always\(\)/);
  // budgets: the candidate deadline (fallback path) and the reserves are unchanged
  assert.deepEqual([CFG.pretrain.budget.sweepJobSeconds, CFG.pretrain.budget.finalJobSeconds, CFG.pretrain.budget.sweepReserveSeconds, CFG.pretrain.budget.finalReserveSeconds, CFG.eval.scoringReserveSeconds], [19800, 21000, 1200, 5700, 1200]);
  // the new scripts hold no key and print counts only
  for (const f of ["lm-retrain-arm-save.sh", "lm-retrain-arm-verify.sh", "lm-retrain-arm-reuse.sh"]) {
    const t = read(`peaceai/bin/${f}`).split("\n").filter((l) => !/^\s*#/.test(l)).join("\n"); assert.doesNotMatch(t, /DEPLOY_KEY|with-deploy-key|git push|ssh/, f);
    assert.doesNotMatch(t, /\bcat "\$|jq [^\n]*"\$(S|sm)"\s*$|echo "\$S"/m, `${f} never prints a summary or file`);
  }
});
const OUTCOME_SHA256 = "f8c81ea77cd5c977690afffe56be7e122df5cb7b5b9cfb866cefa93087a33edf"; // M126 (run 40694718190): "memcheck FAIL (record landed)" and the memcheck-only branch (m126-lm-memcheck-chain.test.ts). Before: 16b81ef3...
const GUARD_SHA256 = "d4d7c4614fc1c88d806ef66d4e813e8bc31f4ff1f3a89835b9e1efa304a60361";

test("M125 new files are protected", () => {
  for (const f of ["peaceai/bin/lm-retrain-arm-save.sh", "peaceai/bin/lm-retrain-arm-verify.sh", "peaceai/bin/lm-retrain-arm-reuse.sh", "peaceai/test/m125-lm-retrain-arm-reuse.test.ts"]) assert.ok(protectedReason(f), f);
});

test("M125 resume refuses when the training/export code changed since the saved run (codeSha256, Auditor PR #564)", () => tmp((d) => {
  const bare = results(d); for (const a of [0, 1]) assert.equal(saveArm(d, bare, a).status, 0);
  // the hashed list is explicit, sorted, and exactly the code lm-retrain-train.sh and export run
  const vs = read("peaceai/bin/lm-retrain-arm-verify.sh");
  assert.ok(vs.includes(`CODE_FILES=(${CODE_FILES.join(" ")})`)); assert.deepEqual([...CODE_FILES].sort(), CODE_FILES);
  assert.match(vs, /codesha\(\) \{ sha256sum "\$\{CODE_FILES\[@\]\}" \| sha256sum \| cut -c1-64; \}/);
  assert.equal(execFileSync("bash", ["peaceai/bin/lm-retrain-arm-verify.sh", "--code-sha"], { cwd: repo, encoding: "utf8" }).trim(), codeSha(repo));
  for (const [f, re] of [["peaceai/model/train.py", /^import lm\b[\s\S]*^import replay\b/m], ["peaceai/model/export.py", /^import lm\b/m]] as const) assert.match(read(f), re, f);
  for (const p of ["val_split.py", "train.py", "retrain_summary.py"]) assert.match(read("peaceai/bin/lm-retrain-train.sh"), new RegExp(`peaceai/model/${p.replace(".", "\\.")}`));
  // a checkout whose train.py differs by one comment line: the same resume that passes on this checkout refuses there
  const co = join(d, "checkout"); for (const p of ["peaceai/bin", "peaceai/model"]) cpSync(join(repo, p), join(co, p), { recursive: true });
  const arms = fetchArms(bare, d, RUN);
  const run = (cwd: string) => spawnSync("bash", ["peaceai/bin/lm-retrain-arm-verify.sh", arms, join(d, `v-${Math.random()}`)], { cwd, encoding: "utf8", env: env0({ MODE, MANIFEST: fixture().manifest, GITHUB_RUN_ID: RUN2, RESUME: RUN }) });
  assert.equal(run(co).status, 0, "unchanged code resumes");
  writeFileSync(join(co, "peaceai/model/train.py"), readFileSync(join(co, "peaceai/model/train.py"), "utf8") + "# changed\n");
  assert.notEqual(codeSha(co), codeSha(repo));
  const r = run(co); assert.equal(r.status, 1, r.stdout); assert.match(r.stdout, /saved arm 0: training\/export code differs from this checkout's \(codeSha256\): refused/);
}));
