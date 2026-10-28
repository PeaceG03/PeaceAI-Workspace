// M123 (LM retrain continued pretraining, Builder + Auditor 2026-10-27): workflow input mode = finetune | pretrain
// (default finetune). Pretrain mode reads lm-retrain.json .pretrain (1200 steps, warmup 100, evalEvery 100, patience 4,
// batch 16, replayFrac 1.0, valWindows 64, sweep lrs [1.5e-4, 6e-5], maxSeconds 15000), replays the live model's FULL
// pretrain train split (replay.pretrainTrainMaxBytes, read in pretrain mode only), refuses unless ftRows == 0, starts a
// fresh AdamW from the live weights, and ends cleanly before the job's time limit. Both modes: the set C v2 gate is
// candidate <= live - eval.minBpbGain (exact), at the validation-selected step; set C is the final gate only. Pretrain
// memcheck = the strict fine-tune-corpus run AND a replay-corpus run. Auditor conditions 1-5 are pinned below.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { protectedReason } from "../lib/selfchange.ts";

const repo = resolve(import.meta.dirname, "..", "..");
const py = process.env.PEACEAI_PYTHON ?? "python3";
const read = (p: string) => readFileSync(join(repo, p), "utf8");
const H = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");
const CFG = JSON.parse(read("peaceai/model/lm-retrain.json"));
const WF = read(".github/workflows/peace-lm-retrain.yml");
const tmp = (fn: (d: string) => void) => { const d = mkdtempSync(join(tmpdir(), "m123-")); try { fn(d); } finally { rmSync(d, { recursive: true, force: true }); } };
const jsonl = (p: string) => readFileSync(p, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const job = (j: string) => { const i = WF.indexOf(`\n  ${j}:\n`); assert.ok(i > 0, j); const rest = WF.slice(i + 1); const n = rest.slice(1).search(/\n  [a-z][a-z-]*:\n/); return n < 0 ? rest : rest.slice(0, n + 1); };
const env0 = (over: Record<string, string | undefined>) => { const e: Record<string, string> = {}; for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !(k in over)) e[k] = v; for (const [k, v] of Object.entries(over)) if (v !== undefined) e[k] = v; return e; };
type Doc = { doc: number; text: string; [k: string]: unknown };
function corpus(d: string, docs: Doc[]) {
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, "docs.jsonl"), docs.map((x) => JSON.stringify({ doc: x.doc, text: x.text })).join("\n") + "\n");
  writeFileSync(join(d, "manifest.jsonl"), docs.map(({ text: _t, ...m }) => JSON.stringify(m)).join("\n") + "\n");
  return d;
}
const body = (k: string, i: number) => `export function ${k}${i}(value: number, other: string): string {\n  const total = value * ${i} + other.length;\n  return String(total) + "${k}-${i}";\n}\n`;

// ---- config
test("M123 config: the pretrain block has the approved values; the finetune block is unchanged", () => {
  const p = CFG.pretrain;
  assert.deepEqual([p.steps, p.warmup, p.evalEvery, p.patience, p.batch, p.replayFrac, p.valWindows, p.maxSeconds], [1200, 100, 100, 4, 16, 1.0, 64, 15000]);
  assert.deepEqual(p.sweep.lrs, [1.5e-4, 6e-5]);
  assert.equal(p.valSeed, CFG.finetune.valSeed, "same pretrain-heldout windows as finetune");
  assert.ok(p.retrainMaxSeconds >= p.maxSeconds);
  const f = CFG.finetune;
  assert.deepEqual([f.steps, f.warmup, f.evalEvery, f.patience, f.replayFrac, f.valWindows, f.maxSeconds, f.retrainMaxSeconds, f.valSeed, f.ftLineMinChars, f.seed],
    [300, 30, 25, 4, 0.75, 64, 13800, 15000, "peaceai-val:v1", 20, 20261010]);
  assert.deepEqual(f.sweep.lrs, [0.00005, 0.000025]); assert.equal("batch" in f, false, "finetune keeps model.batch");
  assert.equal(CFG.model.batch, 8);
});

test("M123 config: the pretrain replay cap covers the full train split of the live manifest (78,555,701 bytes, 45562 docs)", () => {
  assert.ok(Number.isInteger(CFG.replay.pretrainTrainMaxBytes) && CFG.replay.pretrainTrainMaxBytes >= 78555701);
  assert.deepEqual([CFG.replay.pretrainTrainSplit.docs, CFG.replay.pretrainTrainSplit.bytes], [45562, 78555701]);
  assert.ok(CFG.replay.trainMaxBytes < 78555701, "the finetune cap is the smaller one");
  const have = spawnSync("git", ["-C", repo, "cat-file", "-e", `${CFG.replay.source.commit}:${CFG.replay.source.path}`]);
  if (have.status !== 0) return; // shallow CI checkout: the workflow re-checks both shas and full_train_split when it fetches the source
  tmp((d) => {
    const src = execFileSync("git", ["-C", repo, "show", `${CFG.replay.source.commit}:${CFG.replay.source.path}`], { maxBuffer: 1 << 28 });
    writeFileSync(join(d, "s.jsonl"), src);
    const plan = (mode: string) => spawnSync(py, ["peaceai/model/replay_corpus.py", "plan", "--mode", mode, "--source", join(d, "s.jsonl"), "--config", join(repo, "peaceai/model/lm-retrain.json"), "--plan", join(d, `p-${mode}.jsonl`), "--stats", join(d, `s-${mode}.json`)], { cwd: repo, encoding: "utf8" });
    const pr = plan("pretrain"); assert.equal(pr.status, 0, pr.stderr);
    const s = JSON.parse(readFileSync(join(d, "s-pretrain.json"), "utf8"));
    assert.deepEqual([s.mode, s.fullTrainSplit, s.splitTrainDocs, s.splitTrainBytes, s.trainDocs, s.trainBytes, s.trainCap], ["pretrain", true, 45562, 78555701, 45562, 78555701, CFG.replay.pretrainTrainMaxBytes]);
    const fr = plan("finetune"); assert.equal(fr.status, 0, fr.stderr);
    const t = JSON.parse(readFileSync(join(d, "s-finetune.json"), "utf8"));
    assert.equal(t.trainCap, CFG.replay.trainMaxBytes); assert.ok(t.trainBytes <= CFG.replay.trainMaxBytes); assert.equal(t.fullTrainSplit, false);
  });
});

test("M123 config: margin gate eval.minBpbGain = 0.005; the pretrain budgets equal the job timeouts", () => {
  assert.equal(CFG.eval.minBpbGain, 0.005); assert.match(CFG.eval.minBpbGainRule, /live - eval\.minBpbGain|live - minBpbGain/);
  const b = CFG.pretrain.budget;
  const tm = (j: string) => Number(/\n    timeout-minutes: (\d+)\n/.exec(job(j))![1]) * 60;
  assert.equal(b.sweepJobSeconds, tm("sweep-a")); assert.equal(b.sweepJobSeconds, tm("sweep-b")); assert.equal(b.finalJobSeconds, tm("finetune-eval-land"));
  assert.ok(tm("finetune-eval-land") <= 360 * 60 && tm("sweep-a") <= 360 * 60, "inside GitHub's 360-minute job limit");
  for (const k of ["sweepReserveSeconds", "dryRunReserveSeconds", "finalReserveSeconds"]) assert.ok(Number.isInteger(b[k]) && b[k] > 0, k);
  assert.ok(b.sweepJobSeconds - b.sweepReserveSeconds - b.dryRunReserveSeconds > 0 && b.finalJobSeconds - b.finalReserveSeconds > 0);
});

// ---- condition 1: mode is a choice input, allowlisted in a script, passed via env only
const MODE_SH = (mode: string | undefined) => spawnSync("bash", ["peaceai/bin/lm-retrain-mode.sh"], { cwd: repo, encoding: "utf8", env: env0({ MODE: mode }) });

test("M123 condition 1: mode is type: choice (default finetune), passed via env only, never ${{ }} inside run:", () => {
  assert.match(WF, /\n      mode:\n        description: "[^"\n]+"\n        type: choice\n        options:\n          - finetune\n          - pretrain\n        default: finetune\n/);
  assert.match(WF, /\nenv:\n(?:  .+\n)*  MODE: \$\{\{ inputs\.mode \|\| 'finetune' \}\}\n/);
  assert.equal((WF.match(/inputs\.mode/g) ?? []).length, 1, "the input is read once, into the MODE env");
  // no ${{ }} expression anywhere inside a run: script (single-line or block)
  const lines = WF.split("\n"); let inRun = -1; const bad: string[] = [];
  for (const l of lines) {
    const ind = l.length - l.trimStart().length;
    if (inRun >= 0 && (l.trim() === "" || ind > inRun)) { if (l.includes("${{")) bad.push(l.trim()); continue; }
    inRun = -1;
    const m = /^(\s*)(?:- )?run: ?(.*)$/.exec(l);
    if (m) { if (m[2]!.includes("${{")) bad.push(l.trim()); if (/^[|>]/.test(m[2]!)) inRun = m[1]!.length + (l.trimStart().startsWith("- ") ? 2 : 0); }
  }
  assert.deepEqual(bad, [], "no ${{ }} inside run:");
  // every consumer validates through the allowlist script; none reads $MODE raw
  for (const f of ["peaceai/bin/lm-retrain-train.sh", "peaceai/bin/lm-retrain-replay.sh"]) {
    const t = read(f); assert.match(t, /\nmode=\$\(\.\/peaceai\/bin\/lm-retrain-mode\.sh\)\n/, f);
    assert.doesNotMatch(t.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n"), /\$\{?MODE\b/, `${f} never reads MODE raw`);
  }
  for (const j of ["sweep-a", "sweep-b"]) assert.match(job(j), /mode=\$\(\.\/peaceai\/bin\/lm-retrain-mode\.sh\)\n\s+lr=\$\(jq -r --arg m "\$mode" --argjson a "\$ARM" '\.\[\$m\]\.sweep\.lrs\[\$a\]' "\$CFG"\)/, j);
  assert.doesNotMatch(WF, /\.finetune\.sweep\.lrs\[\$ARM\]/, "the arm lr follows the mode");
  const sel = job("finetune-eval-land");
  assert.match(sel, /mode=\$\(\.\/peaceai\/bin\/lm-retrain-mode\.sh\)\n\s+python3 peaceai\/model\/sweep_select\.py "\$CFG" "\$vs" "\$mode" "\$\(cat "\$RUNNER_TEMP\/armsv\/arm-0\.json"\)" "\$\(cat "\$RUNNER_TEMP\/armsv\/arm-1\.json"\)" > "\$RUNNER_TEMP\/select\.json"\n/);
  assert.match(read("peaceai/model/sweep_select.py"), /\nMODES = \("finetune", "pretrain"\)\ncfg, vs, mode = [^\n]+\nif mode not in MODES:\n\s+sys\.exit\("unknown retrain mode: refused"\)\nft = cfg\[mode\]/);
  assert.match(job("retrain-memcheck"), /mode=\$\(\.\/peaceai\/bin\/lm-retrain-mode\.sh\)/);
});

test("M123 condition 1: an unknown mode is refused by the allowlist script and by every Python entry point", () => tmp((d) => {
  for (const ok of ["finetune", "pretrain"]) { const r = MODE_SH(ok); assert.equal(r.status, 0); assert.equal(r.stdout, `${ok}\n`); }
  for (const bad of [undefined, "", "Pretrain", "PRETRAIN", "pretrain ", " finetune", "finetune\n", "pretrain;id", "$(id)", "full", "scratch", "../pretrain"]) {
    const r = MODE_SH(bad); assert.equal(r.status, 1, `MODE=${JSON.stringify(bad)} refused`); assert.equal(r.stdout, "", "nothing on stdout");
    assert.match(r.stderr, /unknown retrain mode: refused/);
  }
  const tr = spawnSync("bash", ["peaceai/bin/lm-retrain-train.sh", "a", "b", "c", "d", "e", join(d, "w"), "0.00015", "0"], { cwd: repo, encoding: "utf8", env: env0({ MODE: "bogus", PEACEAI_PYTHON: py }) });
  assert.notEqual(tr.status, 0); assert.match(tr.stderr, /unknown retrain mode: refused/); assert.equal(existsSync(join(d, "w")), false, "refused before any work");
  const rp = spawnSync("bash", ["peaceai/bin/lm-retrain-replay.sh", join(d, "w"), join(d, "i.json")], { cwd: repo, encoding: "utf8", env: env0({ MODE: "bogus" }) });
  assert.notEqual(rp.status, 0); assert.match(rp.stderr, /unknown retrain mode: refused/);
  const plan = spawnSync(py, ["peaceai/model/replay_corpus.py", "plan", "--mode", "bogus", "--source", join(d, "s"), "--config", join(d, "c"), "--plan", join(d, "p")], { cwd: repo, encoding: "utf8" });
  assert.notEqual(plan.status, 0); assert.doesNotMatch(plan.stdout, /replay mode=/);
  const cap = (mode: string) => execFileSync(py, ["-c", `import sys; sys.path.insert(0, "peaceai/model"); import replay_corpus as r\ntry:\n    print(r.train_cap({"trainMaxBytes": 7, "pretrainTrainMaxBytes": 9}, sys.argv[1]))\nexcept ValueError as e:\n    print("refused", e)`, mode], { cwd: repo, encoding: "utf8" }).trim();
  assert.equal(cap("bogus"), "refused unknown retrain mode");
}));

// ---- condition 2: pretrainTrainMaxBytes is read in pretrain mode only
function extSource(n: number) {
  const ents = Array.from({ length: n }, (_, i) => {
    const text = body("x", i).repeat(1 + (i % 4));
    return { e: { doc: i, stage: "pretrain", repo: i % 3 ? "colinhacks/zod" : "sindresorhus/ky", commit: "c".repeat(40), license: "MIT", path: `src/f${i}.ts`, sha256: H(text), bytes: Buffer.byteLength(text), origin: "ext" }, text };
  });
  const src = [JSON.stringify({ schema: "peaceai-ext-manifest:v1", config: "c", entries: n }), ...ents.map((x) => JSON.stringify(x.e))].join("\n") + "\n";
  const split = (r: string, p: string) => (createHash("sha256").update(`${r}\n${p}`).digest()[0]! < Math.round(256 * 5 / 100) ? "heldout" : "train");
  const live = ents.map((x) => JSON.stringify({ ...x.e, split: split(x.e.repo, x.e.path) })).join("\n") + "\n";
  const trainBytes = ents.filter((x) => split(x.e.repo, x.e.path) === "train").reduce((a, x) => a + x.e.bytes, 0);
  const trainDocs = ents.filter((x) => split(x.e.repo, x.e.path) === "train").length;
  return { src, live, trainBytes, trainDocs, nHeld: n - trainDocs };
}

test("M123 condition 2: the finetune cap is replay.trainMaxBytes and never pretrainTrainMaxBytes; pretrain takes the full split or refuses", () => tmp((d) => {
  const x = extSource(150); assert.ok(x.nHeld >= 2);
  writeFileSync(join(d, "s.jsonl"), x.src);
  const rc = { manifestSha256: H(x.live), source: { repo: "PeaceG03/PeaceAI-Workspace", commit: "d".repeat(40), path: "peaceai/model/ext-manifest.jsonl", sha256: H(x.src) }, salt: "peaceai-replay:v1", trainMaxBytes: 3000, pretrainTrainMaxBytes: x.trainBytes, valDocs: 2, valMinBytes: 1 };
  const plan = (mode: string, over: object = {}) => {
    writeFileSync(join(d, "c.json"), JSON.stringify({ replay: { ...rc, ...over } }));
    const r = spawnSync(py, ["peaceai/model/replay_corpus.py", "plan", "--mode", mode, "--source", join(d, "s.jsonl"), "--config", join(d, "c.json"), "--plan", join(d, "p.jsonl"), "--stats", join(d, "st.json")], { cwd: repo, encoding: "utf8" });
    return { r, s: r.status === 0 ? JSON.parse(readFileSync(join(d, "st.json"), "utf8")) : null };
  };
  const f = plan("finetune"); assert.equal(f.r.status, 0, f.r.stderr);
  assert.equal(f.s.trainCap, 3000); assert.ok(f.s.trainBytes <= 3000 && f.s.trainBytes > 0, "finetune mode is capped by trainMaxBytes"); assert.equal(f.s.fullTrainSplit, false);
  assert.match(f.r.stdout, /replay mode=finetune train_cap=3000 full_train_split=false/);
  // finetune never reads pretrainTrainMaxBytes: a missing or garbage value changes nothing
  for (const v of [undefined, "x", -1, 10 ** 12]) { const g = plan("finetune", { pretrainTrainMaxBytes: v }); assert.equal(g.r.status, 0, String(v)); assert.deepEqual(g.s, f.s, `finetune unchanged with pretrainTrainMaxBytes=${v}`); }
  const p = plan("pretrain"); assert.equal(p.r.status, 0, p.r.stderr);
  assert.deepEqual([p.s.mode, p.s.trainCap, p.s.trainBytes, p.s.trainDocs, p.s.splitTrainBytes, p.s.splitTrainDocs, p.s.fullTrainSplit], ["pretrain", x.trainBytes, x.trainBytes, x.trainDocs, x.trainBytes, x.trainDocs, true]);
  assert.equal(jsonl(join(d, "p.jsonl")).filter((r) => JSON.parse(r.line).split === "train").length, x.trainDocs, "every train doc planned");
  // pretrain mode never falls back to trainMaxBytes, and a cap below the full split is refused
  const small = plan("pretrain", { pretrainTrainMaxBytes: x.trainBytes - 1 }); assert.notEqual(small.r.status, 0); assert.match(small.r.stdout + small.r.stderr, /pretrain mode must replay the full train split/);
  const miss = plan("pretrain", { pretrainTrainMaxBytes: undefined }); assert.notEqual(miss.r.status, 0);
  const big = plan("pretrain", { trainMaxBytes: 1 }); assert.equal(big.r.status, 0); assert.equal(big.s.trainBytes, x.trainBytes, "pretrain ignores trainMaxBytes");
}));

// ---- condition 3: replay_proof.py over the full split in pretrain mode; corpus sha256 and bytes recorded
function proofFixture(d: string, mode: string | null, stats: Record<string, unknown> | null) {
  const rp: Doc[] = [];
  for (let i = 0; i < 6; i += 1) { const t = body("rp", i); rp.push({ doc: i, text: t, split: i < 4 ? "train" : "heldout", repo: "colinhacks/zod", commit: "a".repeat(40), path: `src/r${i}.ts`, sha256: H(t) }); }
  const rdir = corpus(join(d, "replay"), rp);
  corpus(join(d, "setc"), [{ doc: 0, text: body("setc", 1) }]);
  writeFileSync(join(d, "items.json"), JSON.stringify([{ context: "function judged(", reference: "a) { return a; }", derived: "a) { return b; }" }]));
  writeFileSync(join(d, "dedup.json"), JSON.stringify({ recheckOverlapDocs: 0, outManifestSha256: H(readFileSync(join(rdir, "manifest.jsonl"))) }));
  writeFileSync(join(d, "hc.json"), JSON.stringify({ schema: "peaceai-heldout-c:v2", sets: { C: [{ repo: "axios/axios", sha: "b".repeat(40), contentSha256: [H("listed\n")] }] } }));
  corpus(join(d, "ft"), [{ doc: 0, text: body("ft", 0), split: "train" }]);
  const extra: string[] = [];
  if (mode !== null) extra.push("--mode", mode);
  if (stats !== null) { writeFileSync(join(d, "plan-stats.json"), JSON.stringify(stats)); extra.push("--plan-stats", join(d, "plan-stats.json")); }
  const r = spawnSync(py, ["peaceai/model/replay_proof.py", "--replay", rdir, "--dedup", join(d, "dedup.json"), "--setc", join(d, "setc"), "--heldout-c", join(d, "hc.json"),
    "--judge", join(d, "items.json"), "--judge-sha", H(readFileSync(join(d, "items.json"))), "--ft", join(d, "ft"), ...extra, "--out", join(d, "proof.json")], { cwd: repo, encoding: "utf8" });
  return { r, p: existsSync(join(d, "proof.json")) ? JSON.parse(readFileSync(join(d, "proof.json"), "utf8")) : null, docs: readFileSync(join(rdir, "docs.jsonl")) };
}
const FULL = { mode: "pretrain", trainCap: 9999, splitTrainDocs: 4, splitTrainBytes: 1, trainDocs: 4, trainBytes: 1, valDocs: 2, valBytes: 1, fullTrainSplit: true };

test("M123 condition 3: in pretrain mode the overlap proof covers the full train split and records the corpus sha256 and bytes used", () => {
  tmp((d) => {
    const { r, p, docs } = proofFixture(d, "pretrain", FULL); assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(p.ok, true); assert.equal(p.mode, "pretrain"); assert.equal(p.overlap.planFull, 0); assert.equal(p.trainDocs, 4);
    assert.equal(p.replayDocsSha256, H(docs)); assert.equal(p.replayDocsBytes, docs.length);
    assert.ok(p.trainBytes > 0 && p.valBytes > 0); assert.deepEqual(p.plan, FULL);
    assert.match(r.stdout, new RegExp(`replay proof replayDocsSha256=${p.replayDocsSha256}\\n`)); assert.doesNotMatch(r.stdout, /export function/, "no text in the log");
  });
  for (const [why, stats] of [["not full", { ...FULL, fullTrainSplit: false }], ["docs short", { ...FULL, trainDocs: 3 }], ["other mode's plan", { ...FULL, mode: "finetune" }]] as const) tmp((d) => {
    const { r, p } = proofFixture(d, "pretrain", stats); assert.equal(r.status, 1, why); assert.equal(p.overlap.planFull, 1, why);
  });
  tmp((d) => { const { r, p } = proofFixture(d, "finetune", { ...FULL, mode: "finetune", fullTrainSplit: false }); assert.equal(r.status, 0, r.stdout + r.stderr); assert.equal(p.overlap.planFull, 0); assert.equal(p.mode, "finetune"); });
  tmp((d) => { const { r } = proofFixture(d, "pretrain", null); assert.notEqual(r.status, 0, "--mode without --plan-stats refused"); });
  tmp((d) => { const { r } = proofFixture(d, null, FULL); assert.notEqual(r.status, 0, "--plan-stats without --mode refused"); });
  tmp((d) => { const { r } = proofFixture(d, "bogus", FULL); assert.notEqual(r.status, 0, "unknown mode refused"); });
  // wiring: the replay build passes the mode and the plan stats; the record carries the corpus actually used
  const rs = read("peaceai/bin/lm-retrain-replay.sh");
  assert.match(rs, /replay_corpus\.py plan --mode "\$mode" [^\n]*--stats "\$work\/replay-plan\.json"/);
  assert.match(rs, /replay_proof\.py [\s\S]*--mode "\$mode" --plan-stats "\$work\/replay-plan\.json"/);
  const land = job("finetune-eval-land");
  assert.match(land, /corpus: \{docsSha256: \$rp\[0\]\.replayDocsSha256, docsBytes: \$rp\[0\]\.replayDocsBytes, trainBytes: \$rp\[0\]\.trainBytes, valBytes: \$rp\[0\]\.valBytes\}/);
  assert.match(land, /plan: \$rpl\[0\]/);
  assert.match(land, /\[ "\$\(jq -r \.replay\.corpus\.docsSha256 "\$RUNNER_TEMP\/candidate-train\.json"\)" = "\$\(jq -r \.replayDocsSha256 "\$RUNNER_TEMP\/w\/replay-proof\.json"\)" \] \|\| \{ ok=false; why\+=\(replay_corpus\); \}/);
});

// ---- train.py deadline / timing (tiny CPU runs, like m9 and m122)
const TINY = ["--d-model", "16", "--n-layer", "1", "--n-head", "2", "--ctx", "32", "--vocab", "300", "--batch", "4", "--threads", "1"];
function replayFixture(d: string) {
  const ft: Doc[] = [];
  for (let i = 0; i < 12; i += 1) ft.push({ doc: i, text: body("ft", i), split: "train" });
  ft.push({ doc: 12, text: body("held", 0), split: "heldout" });
  const rp: Doc[] = [];
  for (let i = 0; i < 20; i += 1) rp.push({ doc: 100 + i, text: body("rp", i), split: "train" });
  for (let i = 0; i < 5; i += 1) rp.push({ doc: 200 + i, text: body("val", i).repeat(2), split: "heldout" });
  return { ft: corpus(join(d, "ft"), ft), rp: corpus(join(d, "rp"), rp) };
}
const trainPy = (d: string, c: { ft: string; rp: string }, work: string, extra: string[]) =>
  spawnSync(py, [join(repo, "peaceai/model/train.py"), "--corpus", c.ft, "--work", join(d, work), "--replay-corpus", c.rp, "--val-seed", "m123", "--val-windows", "3", ...TINY, ...extra], { encoding: "utf8", maxBuffer: 1 << 28 });

test("M123 condition 4: train.py ends cleanly at a deadline or maxSeconds, keeps the validation-selected best, and writes timing.json", () => tmp((d) => {
  const c = replayFixture(d);
  const full = trainPy(d, c, "full", ["--steps", "4", "--eval-every", "2", "--max-seconds", "1e9", "--replay-frac", "1"]); assert.equal(full.status, 0, full.stderr + full.stdout);
  const t0 = JSON.parse(readFileSync(join(d, "full", "timing.json"), "utf8"));
  assert.deepEqual([t0.stopReason, t0.timeCut, t0.stoppedStep, t0.steps], ["steps", false, 4, 4]);
  for (const k of ["setupSeconds", "trainSeconds", "evalSeconds"]) assert.ok(typeof t0[k] === "number" && t0[k] >= 0, k);
  // a deadline already passed: no step starts; the run still ends cleanly with its checkpoint, best and timing written
  const past = trainPy(d, c, "past", ["--steps", "50", "--eval-every", "2", "--max-seconds", "1e9", "--replay-frac", "1", "--deadline", String(Date.now() / 1000 - 1)]);
  assert.equal(past.status, 0, past.stderr + past.stdout);
  const tp = JSON.parse(readFileSync(join(d, "past", "timing.json"), "utf8"));
  assert.deepEqual([tp.stopReason, tp.timeCut, tp.stoppedStep], ["deadline", true, 0]); assert.ok(existsSync(join(d, "past", "checkpoint.npz")));
  // a deadline mid-run: stops before a step that would not finish; best is a validation step it reached
  const mid = trainPy(d, c, "mid", ["--steps", "100000", "--eval-every", "2", "--max-seconds", "1e9", "--replay-frac", "1", "--deadline", String(Date.now() / 1000 + 6)]);
  assert.equal(mid.status, 0, mid.stderr + mid.stdout);
  const tm = JSON.parse(readFileSync(join(d, "mid", "timing.json"), "utf8"));
  assert.equal(tm.stopReason, "deadline"); assert.equal(tm.timeCut, true); assert.ok(tm.stoppedStep > 0 && tm.stoppedStep < 100000);
  const evals = jsonl(join(d, "mid", "metrics.jsonl")).filter((x) => "val_loss" in x && x.step > 0).map((x) => x.step);
  if (tm.bestStep > 0) { assert.ok(evals.includes(tm.bestStep), "bestStep is a validation step"); assert.ok(existsSync(join(d, "mid", "best.npz"))); }
  // maxSeconds: same clean end
  const ms = trainPy(d, c, "ms", ["--steps", "100000", "--eval-every", "2", "--max-seconds", "3", "--replay-frac", "1"]); assert.equal(ms.status, 0, ms.stderr);
  const tx = JSON.parse(readFileSync(join(d, "ms", "timing.json"), "utf8")); assert.deepEqual([tx.stopReason, tx.timeCut], ["max_seconds", true]);
  // patience still ends the loop and is reported
  const src = read("peaceai/model/train.py");
  assert.match(src, /ap\.add_argument\("--deadline", type=float, default=0\.0\)/);
  assert.match(src, /need = 2 \* \(slow\["step"\] \+ \(slow\["eval"\] if [^\n]+\)\)\n\s+if time\.time\(\) \+ need >= args\.deadline:\n\s+return "deadline"/);
}));

// ---- lm-retrain-train.sh end to end in a scratch checkout with a tiny model config (CPU, seconds)
function scratch(d: string, cfgOver: (c: Record<string, any>) => void) {
  const cwd = join(d, "cwd");
  for (const f of ["peaceai/bin/lm-retrain-train.sh", "peaceai/bin/lm-retrain-mode.sh", ...readdirSync(join(repo, "peaceai/model")).filter((x) => x.endsWith(".py")).map((x) => `peaceai/model/${x}`)]) {
    mkdirSync(join(cwd, f, ".."), { recursive: true }); copyFileSync(join(repo, f), join(cwd, f));
  }
  for (const f of ["peaceai/bin/lm-retrain-train.sh", "peaceai/bin/lm-retrain-mode.sh"]) chmodSync(join(cwd, f), 0o755);
  const cfg = JSON.parse(JSON.stringify(CFG));
  cfg.model = { d_model: 16, n_layer: 1, n_head: 2, ctx: 32, vocab: 300, batch: 4 };
  Object.assign(cfg.finetune, { steps: 4, warmup: 1, evalEvery: 2, valWindows: 3, maxSeconds: 600, retrainMaxSeconds: 600 });
  Object.assign(cfg.pretrain, { steps: 4, warmup: 1, evalEvery: 2, valWindows: 3, batch: 4, maxSeconds: 600, retrainMaxSeconds: 600 });
  cfgOver(cfg);
  writeFileSync(join(cwd, "peaceai/model/lm-retrain.json"), JSON.stringify(cfg));
  return cwd;
}
function liveModel(d: string, c: { ft: string; rp: string }) {
  const r = spawnSync(py, [join(repo, "peaceai/model/train.py"), "--corpus", c.ft, "--work", join(d, "lw"), ...TINY, "--steps", "2", "--eval-every", "2", "--max-seconds", "1e9"], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr + r.stdout);
  const e = spawnSync(py, [join(repo, "peaceai/model/export.py"), "--work", join(d, "lw"), "--out", join(d, "live"), "--threads", "1"], { encoding: "utf8" });
  assert.equal(e.status, 0, e.stderr + e.stdout);
  return join(d, "live");
}
const runTrain = (cwd: string, d: string, c: { ft: string; rp: string }, live: string, work: string, lr: string, stop: string, env: Record<string, string | undefined>) => {
  writeFileSync(join(d, "dd.json"), JSON.stringify({ recheckOverlapDocs: 0 }));
  return spawnSync("bash", ["peaceai/bin/lm-retrain-train.sh", c.ft, join(d, "dd.json"), c.rp, join(d, "dd.json"), live, join(d, work), lr, stop], { cwd, encoding: "utf8", env: env0({ PEACEAI_PYTHON: py, KEEP_CHECKPOINTS: undefined, DRY_RUN: undefined, ...env }) });
};
const NOW = () => String(Math.floor(Date.now() / 1000));

test("M123 lm-retrain-train.sh: pretrain mode reads .pretrain, takes every row from replay (ftRows 0), fresh AdamW, deadline, and records mode / timing / corpus", () => tmp((d) => {
  const c = replayFixture(d); const live = liveModel(d, c); const cwd = scratch(d, () => {});
  const lr = String(CFG.pretrain.sweep.lrs[0]);
  const p = runTrain(cwd, d, c, live, "pw", lr, "0", { MODE: "pretrain", JOB_START: NOW() }); assert.equal(p.status, 0, p.stdout + p.stderr);
  const s = JSON.parse(readFileSync(join(d, "pw", "summary.json"), "utf8"));
  assert.equal(s.mode, "pretrain"); assert.equal(s.batch, 4); assert.equal(s.replay.ftRows, 0); assert.equal(s.replay.replayRows, 4); assert.equal(s.replay.replayFrac, 1);
  assert.equal(s.replay.corpus.docsSha256, H(readFileSync(join(c.rp, "docs.jsonl")))); assert.equal(s.replay.corpus.docsBytes, readFileSync(join(c.rp, "docs.jsonl")).length);
  assert.equal(s.replay.corpus.manifestSha256, H(readFileSync(join(c.rp, "manifest.jsonl"))));
  assert.equal(s.timing.stopReason, "steps"); assert.equal(s.timing.timeCut, false);
  for (const x of jsonl(join(d, "pw", "metrics.jsonl")).filter((x) => x.step > 0)) assert.deepEqual([x.replay_rows, x.ft_rows], [4, 0], "every batch row is a replay row");
  const log = readFileSync(join(d, "pw", "train.log"), "utf8"); assert.match(log, /^initialized from weights/m); assert.doesNotMatch(log, /^resumed/m, "fresh AdamW (no optimizer state)");
  // the finetune lr is not a pretrain arm, and vice versa
  assert.match(runTrain(cwd, d, c, live, "x1", String(CFG.finetune.sweep.lrs[0]), "0", { MODE: "pretrain", JOB_START: NOW() }).stdout, /lr is not a configured sweep arm: refused/);
  assert.match(runTrain(cwd, d, c, live, "x2", lr, "0", { MODE: "finetune" }).stdout, /lr is not a configured sweep arm: refused/);
  // pretrain mode needs the job clock (no deadline, no run)
  assert.match(runTrain(cwd, d, c, live, "x3", lr, "0", { MODE: "pretrain", JOB_START: undefined }).stdout, /pretrain mode needs JOB_START/);
  // a job clock already past its budget: the run still ends cleanly at a deadline and writes its summary (step 0; see the no-candidate test)
  const late = runTrain(cwd, d, c, live, "late", lr, "0", { MODE: "pretrain", JOB_START: String(Math.floor(Date.now() / 1000) - CFG.pretrain.budget.sweepJobSeconds) });
  assert.equal(late.status, 0, late.stdout + late.stderr); assert.equal(JSON.parse(readFileSync(join(d, "late", "timing.json"), "utf8")).stopReason, "deadline");
  // default finetune mode is unchanged: model.batch, finetune.replayFrac 0.75, ft rows present, no deadline
  const f = runTrain(cwd, d, c, live, "fw", String(CFG.finetune.sweep.lrs[0]), "0", { MODE: "finetune" }); assert.equal(f.status, 0, f.stdout + f.stderr);
  const fs_ = JSON.parse(readFileSync(join(d, "fw", "summary.json"), "utf8"));
  assert.deepEqual([fs_.mode, fs_.batch, fs_.replay.replayFrac, fs_.replay.replayRows, fs_.replay.ftRows], ["finetune", 4, 0.75, 3, 1]);
  assert.doesNotMatch(readFileSync(join(d, "fw", "train.log"), "utf8"), /deadline/);
}));

// ---- condition 4: deadline cut before the first evaluation after step 0 -> record with "no candidate"
const block = (text: string, start: string, end: RegExp) => { const i = text.indexOf(start); assert.ok(i >= 0, start); const rest = text.slice(i + start.length); const j = rest.search(end); return j < 0 ? rest : rest.slice(0, j); };
const dedent = (t: string, n: number) => t.split("\n").map((l) => l.slice(Math.min(n, l.length - l.trimStart().length))).join("\n");
// the select rule lives in one file, run by the select step and by retrain-outcome's dry-run pick (no inline copy left)
const selectPy = () => { assert.doesNotMatch(WF, /<<'PY'/); assert.match(job("finetune-eval-land"), /python3 peaceai\/model\/sweep_select\.py /); return read("peaceai/model/sweep_select.py"); };
const gateRun = () => dedent(block(job("finetune-eval-land"), "        id: gate\n        env:\n          CAND: ${{ steps.select.outputs.candidate }}\n        run: |\n", /\n      - name: /), 10);

test("M123 condition 4: a sweep arm deadline-cut before its first evaluation after step 0 still lands a record (deadline-cut, step 0, 'no candidate', gate fails, no promotion)", () => tmp((d) => {
  // retrain_summary.py: only a time cut lets a step-0-only run through; any other stop reason is still refused
  const rows = join(d, "m0.jsonl"); writeFileSync(rows, JSON.stringify({ step: 0, val_loss: 5.7 }) + "\n");
  const sum = (reason?: string) => spawnSync(py, ["peaceai/model/retrain_summary.py", rows, "0.00015", "1200", "0", "0", '{"sha256":"x"}', ...(reason ? [reason] : [])], { cwd: repo, encoding: "utf8" });
  for (const reason of ["deadline", "max_seconds"]) {
    const r = sum(reason); assert.equal(r.status, 0, `${reason}: ${r.stderr}`);
    const s = JSON.parse(r.stdout); assert.deepEqual([s.bestStep, s.bestVal, s.step0Val, s.deadlineCut, s.noEvalAfterStep0], [0, 5.7, 5.7, true, true]);
  }
  for (const reason of [undefined, "patience", "steps", "max_steps_this_run"]) assert.match(sum(reason).stderr, /no validation loss after step 0/, `${reason} refused`);
  assert.match(sum("bogus").stderr, /unknown stop reason: refused/);
  // end to end: both pretrain sweep arms start with the job clock past its budget, so the deadline cuts each before step 1
  const c = replayFixture(d); const live = liveModel(d, c); const cwd = scratch(d, () => {});
  const past = String(Math.floor(Date.now() / 1000) - CFG.pretrain.budget.sweepJobSeconds);
  const arms = CFG.pretrain.sweep.lrs.map((lr: number, arm: number) => {
    const r = runTrain(cwd, d, c, live, `cut${arm}`, String(lr), "0", { MODE: "pretrain", JOB_START: past }); assert.equal(r.status, 0, r.stdout + r.stderr);
    const s = JSON.parse(readFileSync(join(d, `cut${arm}`, "summary.json"), "utf8"));
    assert.deepEqual([s.timing.stopReason, s.timing.timeCut, s.deadlineCut, s.noEvalAfterStep0, s.bestStep, s.stoppedStep, s.bestVal === s.step0Val], ["deadline", true, true, true, 0, 0, true]);
    return { ...s, arm };
  });
  // the workflow's select step (run as written): selected step 0, candidate false, result "no candidate"
  writeFileSync(join(d, "select.py"), selectPy());
  const sel = (as: unknown[]) => spawnSync("python3", [join(d, "select.py"), join(cwd, "peaceai/model/lm-retrain.json"), JSON.stringify(arms[0].valSplit), "pretrain", ...as.map((a) => JSON.stringify(a))], { encoding: "utf8" });
  const so = sel(arms); assert.equal(so.status, 0, so.stderr); const select = JSON.parse(so.stdout);
  assert.deepEqual([select.selected.step, select.selected.candidate, select.selected.result, select.selected.arm, select.selected.lr], [0, false, "no candidate", null, null]);
  assert.deepEqual(select.arms.map((a: any) => [a.deadlineCut, a.bestStep]), [[true, 0], [true, 0]], "each arm marked deadline-cut at step 0");
  // a step-0 best without the deadline-cut marks is still refused; one real arm next to a cut one is selected as before
  assert.match(sel([{ ...arms[0], deadlineCut: false }, arms[1]]).stderr, /bad sweep best step/);
  assert.match(sel([{ ...arms[0], timing: { ...arms[0].timing, timeCut: false } }, arms[1]]).stderr, /bad sweep best step/);
  const realArm = { ...arms[1], bestStep: 2, bestVal: arms[1].step0Val - 0.01, deadlineCut: false, noEvalAfterStep0: false };
  const mixed = JSON.parse(sel([arms[0], realArm]).stdout).selected; assert.deepEqual([mixed.arm, mixed.step, mixed.candidate], [1, 2, true]);
  // the workflow's gate step (run as written) with no candidate: it writes the record, the gate fails, nothing is landed or promoted
  const rt = join(d, "rt"); for (const x of ["evals", "w", "r"]) mkdirSync(join(rt, x), { recursive: true });
  writeFileSync(join(rt, "select.json"), JSON.stringify(select));
  writeFileSync(join(rt, "evals", "setc-live.txt"), `setc model=live slice_sha256=${CFG.eval.setcSliceSha256} bytes=1 bits_per_byte=1.6506\n`);
  writeFileSync(join(rt, "evals", "judge-live.json"), JSON.stringify({ summary: { n: 1 } }));
  writeFileSync(join(rt, "r", "scores-live-recorded.json"), "{}"); writeFileSync(join(rt, "r", "judge-commit.txt"), "0".repeat(40));
  writeFileSync(join(rt, "w", "dedup.json"), JSON.stringify({ recheckOverlapDocs: 0 }));
  const rc = arms[0].replay.corpus;
  writeFileSync(join(rt, "w", "replay-proof.json"), JSON.stringify({ replayDocsSha256: rc.docsSha256, replayDocsBytes: rc.docsBytes, trainBytes: 1, valBytes: 1 }));
  for (const f of ["w/ft-prepare.json", "w/replay-plan.json", "corefree-proof-finetune.json"]) writeFileSync(join(rt, f), "{}");
  writeFileSync(join(rt, "out"), "");
  const g = spawnSync("bash", ["-c", gateRun()], { cwd: repo, encoding: "utf8", env: env0({ RUNNER_TEMP: rt, CFG: "peaceai/model/lm-retrain.json", MODE: "pretrain", CAND: "false", GITHUB_OUTPUT: join(rt, "out"), GITHUB_RUN_ID: "1", GITHUB_SHA: "a".repeat(40) }) });
  assert.equal(g.status, 0, g.stdout + g.stderr);
  const rec = JSON.parse(readFileSync(join(rt, "evals", "record.json"), "utf8"));
  assert.equal(rec.schema, "peaceai-lm-retrain-record:v5"); assert.equal(rec.mode, "pretrain");
  assert.deepEqual([rec.gate.pass, rec.gate.result, rec.promoted, rec.candidate, rec.candidateWeightsSha256, rec.candidateTraining], [false, "no candidate", false, null, null, null]);
  assert.ok(rec.gate.failed.includes("no_candidate") && rec.gate.failed.includes("setc_bpb"), "the margin gate fails by construction (gain 0)");
  assert.deepEqual([rec.setcV2.bitsPerByte.live, rec.setcV2.bitsPerByte.candidate], [1.6506, 1.6506]);
  assert.deepEqual([rec.selected.step, rec.selected.candidate], [0, false]); assert.deepEqual(rec.sweep.map((a: any) => [a.deadlineCut, a.bestStep]), [[true, 0], [true, 0]]);
  const out = readFileSync(join(rt, "out"), "utf8"); assert.match(out, /^pass=false$/m); assert.doesNotMatch(out, /^version=/m, "no version: no model landed, no memcheck, no promotion");
  // wiring: no candidate training without a candidate; landing a model needs PASS; the memcheck needs a version; latest.json never touched
  const land = job("finetune-eval-land");
  assert.match(land, /- name: Fine-tune the candidate [^\n]*\n\s+if: steps\.select\.outputs\.candidate == 'true' && steps\.reuse\.outputs\.reused != 'true'\n/);
  assert.match(land, /- name: Reuse the selected sweep arm[^\n]*\n\s+id: reuse\n\s+if: steps\.select\.outputs\.candidate == 'true'\n/);
  assert.match(land, /echo "candidate=\$\(jq -r '\.selected\.candidate == true' "\$RUNNER_TEMP\/select\.json"\)" >> "\$GITHUB_OUTPUT"/);
  assert.match(land, /v=none; if \[ "\$PASS" = true \]; then v=\$\(jq -r \.version "\$MODEL_DIR\/config\.json"\)/);
  assert.match(land, /if \[ "\$PASS" = true \]; then d="\$RESULTS_DIR\/models\/lm\/\$v"/);
  assert.match(job("retrain-memcheck"), /needs\.finetune-eval-land\.outputs\.version != ''/);
  assert.doesNotMatch(WF, /latest\.json"?\s*(>|cp|mv)/);
}));

test("M123 lm-retrain-train.sh: pretrain mode refuses a run where any batch row came from the fine-tune corpus (ftRows != 0)", () => tmp((d) => {
  const c = replayFixture(d); const live = liveModel(d, c); const cwd = scratch(d, (cfg) => { cfg.pretrain.replayFrac = 0.75; });
  const r = runTrain(cwd, d, c, live, "pw", String(CFG.pretrain.sweep.lrs[0]), "0", { MODE: "pretrain", JOB_START: NOW() });
  assert.notEqual(r.status, 0); assert.match(r.stdout, /pretrain mode: a batch row came from the fine-tune corpus \(ftRows != 0\): refused/);
  assert.equal(existsSync(join(d, "pw", "summary.json")), false, "no summary, so no arm");
}));

test("M123 condition 4 wiring: a job clock in every training job; the deadline is JOB_START + budget - reserve; time-cut runs still land a record", () => {
  for (const j of ["sweep-a", "sweep-b", "finetune-eval-land"]) {
    const b = job(j); const clock = b.indexOf('echo "JOB_START=$(date +%s)" >> "$GITHUB_ENV"'), tr = b.indexOf("lm-retrain-train.sh");
    assert.ok(clock > 0 && clock < b.indexOf("npm ci") && clock < tr, `${j}: job clock first`);
  }
  const t = read("peaceai/bin/lm-retrain-train.sh");
  assert.match(t, /if \[ "\$stop" = 0 \]; then js=\$\(b sweepJobSeconds\); rs=\$\(b sweepReserveSeconds\); \[ "\$\{DRY_RUN-\}" = true \] && rs=\$\(\(rs \+ \$\(b dryRunReserveSeconds\)\)\)\n\s+else js=\$\(b finalJobSeconds\); rs=\$\(b finalReserveSeconds\); fi/);
  assert.match(t, /dl=\(--deadline "\$\(\(JOB_START \+ js - rs\)\)"\)/);
  assert.match(t, /"\$\{extra\[@\]\}" "\$\{dl\[@\]\}"/);
  const land = job("finetune-eval-land");
  // a candidate cut before the selected step fails the gate, and the record still lands (gate failure is not a step failure)
  assert.match(land, /\[ "\$\(jq -r \.stoppedStep "\$RUNNER_TEMP\/candidate-train\.json"\)" = "\$\(jq -r \.selected\.step "\$RUNNER_TEMP\/select\.json"\)" \] \|\| \{ ok=false; why\+=\(selected_step_not_reached\); \}/);
  assert.match(land, /stopReason: \.timing\.stopReason, timeCut: \.timing\.timeCut/);
});

// ---- margin gate
const gate = (live: string, cand: string, gain: string) => spawnSync(py, ["peaceai/model/bpb_gate.py", live, cand, gain], { cwd: repo, encoding: "utf8" });

test("M123 margin gate: candidate <= live - eval.minBpbGain, exact (1.6506 -> 1.6456 passes, 1.6457 fails); a margin <= 0 is refused", () => {
  const g = String(CFG.eval.minBpbGain);
  for (const [cand, st] of [["1.6456", 0], ["1.6455", 0], ["1.2000", 0], ["1.6457", 1], ["1.6500", 1], ["1.6506", 1], ["1.6505", 1], ["2.0670", 1]] as const) {
    const r = gate("1.6506", cand, g); assert.equal(r.status, st, `candidate ${cand}`);
    assert.match(r.stdout, /^setc_bpb gate live=1\.6506 candidate=[0-9.]+ min_gain=0\.005 need_at_most=1\.6456 pass=(true|false)\n$/);
  }
  assert.doesNotMatch(read("peaceai/model/bpb_gate.py").replace(/^"""[\s\S]*?"""/m, ""), /float\(|Decimal\(/, "exact fixed-point integers, no float");
  for (const [l, c, m, st] of [["0.3", "0.2", "0.1", 0], ["1.0000", "0.9950", "0.005", 0], ["1.0000", "0.9951", "0.005", 1]] as const) assert.equal(gate(l, c, m).status, st, `${l} ${c} ${m}`);
  for (const bad of ["0", "0.0", "-0.005", "nan", "inf", "5e-3", "", "x"]) assert.equal(gate("1.6506", "1.6", bad).status, 2, `margin ${JSON.stringify(bad)} refused`);
  for (const bad of ["", "nan", "-1", "1e0"]) { assert.equal(gate(bad, "1.6", g).status, 2); assert.equal(gate("1.6506", bad, g).status, 2); }
  const land = job("finetune-eval-land");
  assert.match(land, /python3 peaceai\/model\/bpb_gate\.py "\$\(bpb live\)" "\$\(bpb model\)" "\$\(jq -r \.eval\.minBpbGain "\$CFG"\)" \|\| \{ ok=false; why\+=\(setc_bpb\); \}/);
  assert.doesNotMatch(WF, /\bge\(\) \{|ge "\$\(bpb live\)"/, "the plain <= gate is gone");
  assert.match(land, /minBpbGain: \$cfg\[0\]\.eval\.minBpbGain, rule: \$cfg\[0\]\.eval\.minBpbGainRule/);
  // judged at the validation-selected step: the candidate trains to exactly select.step, and set C is read only after it
  assert.match(land, /lm-retrain-train\.sh [^\n]* "\$LR" "\$STEP"/);
  const sc = land.indexOf("eval_c.py"), tr = land.indexOf("lm-retrain-train.sh"), sel = land.indexOf("id: select");
  assert.ok(sel < tr && tr < sc, "select, then train, then set C");
  for (const f of ["peaceai/model/bpb_gate.py", "peaceai/model/memcheck_combine.py"]) assert.doesNotMatch(read("peaceai/model/val_split.py") + read("peaceai/model/retrain_summary.py"), new RegExp(f.split("/").pop()!.replace(".", "\\.")));
});

test("M123 record: schema v5 carries mode, the mode's training block, the replay plan and corpus, and the margin", () => {
  const land = job("finetune-eval-land");
  assert.match(land, /schema: "peaceai-lm-retrain-record:v5", runId: \$run, workspaceSha: \$ws, mode: \$mode,/);
  assert.match(land, /training: \$cfg\[0\]\[\$mode\]/);
  assert.match(land, /--arg mode "\$\(jq -r \.mode "\$RUNNER_TEMP\/select\.json"\)"/);
  assert.match(land, /'\.retrain = \{mode: \$sel\[0\]\.mode, initFrom: \$live,[\s\S]*?replayCorpus: \$ct\[0\]\.replay\.corpus,\n\s+candidateSource: \(\$ct\[0\]\.source \/\/ \{kind: "retrained"\}\)\}'/);
  assert.match(read("peaceai/model/sweep_select.py"), /if a\.get\("mode"\) != mode or \(mode == "pretrain" and r\.get\("ftRows"\) != 0\):\n\s+sys\.exit\("sweep arm ran in a different mode"\)/);
});

// ---- condition 5: memcheck
test("M123 condition 5: pretrain memcheck keeps the strict fine-tune-corpus run AND adds a replay-corpus run; both must PASS", () => tmp((d) => {
  const mc = job("retrain-memcheck");
  const rb = mc.indexOf("lm-retrain-replay.sh"), del = mc.indexOf('rm -rf "$RUNNER_TEMP/w/srcroot" "$RUNNER_TEMP/w/setc" "$RUNNER_TEMP/items.json"');
  assert.ok(rb > 0 && rb < del, "the replay corpus is rebuilt and re-proven before set C and the judge items are deleted");
  assert.match(mc, /lm-retrain-replay-check\.sh "\$RUNNER_TEMP\/w" "\$REPLAY" "\$REPLAYPROOF"/);
  assert.match(mc, /\.retrain\.replayCorpus\.docsSha256/);
  assert.match(mc, /PEACEAI_LM_CORPUS: \$\{\{ runner\.temp \}\}\/w\/ft\n/, "the strict fine-tune-corpus run is unchanged");
  const ftRun = mc.indexOf("./node_modules/.bin/tsx peaceai/bin/lm-memcheck.ts || true"), rpRun = mc.indexOf('PEACEAI_LM_CORPUS="$RUNNER_TEMP/w/replay" ./node_modules/.bin/tsx peaceai/bin/lm-memcheck.ts || true');
  assert.ok(ftRun > 0 && rpRun > ftRun, "both runs, fine-tune corpus first");
  assert.match(mc, /if \[ "\$mode" = pretrain \]; then\n\s+mv "\$M" "\$RUNNER_TEMP\/memcheck-ft\.json"\n/);
  assert.match(mc, /memcheck_combine\.py --ft "\$RUNNER_TEMP\/memcheck-ft\.json" --replay "\$RUNNER_TEMP\/memcheck-replay\.json" --out "\$M"/);
  assert.equal((mc.match(/test "\$\(jq -r \.substringRule "\$M"\)" = strict/g) ?? []).length, 2, "strict rule checked on the ft run and on the combined record");
  const comb = (ft: unknown, rp: unknown) => {
    writeFileSync(join(d, "a.json"), typeof ft === "string" ? ft : JSON.stringify(ft)); writeFileSync(join(d, "b.json"), typeof rp === "string" ? rp : JSON.stringify(rp));
    const r = spawnSync(py, ["peaceai/model/memcheck_combine.py", "--ft", join(d, "a.json"), "--replay", join(d, "b.json"), "--out", join(d, "o.json")], { cwd: repo, encoding: "utf8" });
    return { st: r.status, o: JSON.parse(readFileSync(join(d, "o.json"), "utf8")), out: r.stdout };
  };
  const P = { schema: "peaceai-memcheck:vX", status: "PASS", substringRule: "strict", files: { "weights.npz": "ab" } }, F = { ...P, status: "FAIL" };
  const ok = comb(P, P); assert.equal(ok.st, 0); assert.equal(ok.o.status, "PASS"); assert.equal(ok.o.schema, P.schema, "the ft record's schema and binding are kept"); assert.deepEqual(ok.o.files, P.files);
  assert.deepEqual(ok.o.pretrainMemcheck.runStatus, { ftCorpus: "PASS", replayCorpus: "PASS" }); assert.deepEqual(ok.o.pretrainMemcheck.replayCorpus, P);
  for (const [why, a, b] of [["replay FAIL", P, F], ["ft FAIL", F, P], ["both FAIL", F, F], ["replay unreadable", P, "{"], ["replay not strict", P, { ...P, substringRule: "core-free-64" }], ["ft not strict", { ...P, substringRule: "core-free-64" }, P], ["replay null", P, "null"]] as const) {
    const r = comb(a, b); assert.equal(r.st, 1, why); assert.equal(r.o.status, "FAIL", why);
  }
  assert.equal(comb(P, { ...P, substringRule: "core-free-64" }).o.substringRule, "mixed");
  assert.match(ok.out, /^memcheck pretrain status=PASS rule=strict ft=PASS replay=PASS\n$/);
}));

// ---- dry run, both modes
test("M123 dry run: phase times (numbers only) and set C bpb only; every Results write still refused in both modes", () => {
  const score = read("peaceai/bin/lm-retrain-dryrun-score.sh");
  assert.match(score, /\[\[ "\$ps" =~ \$num && "\$pt" =~ \$num && "\$pe" =~ \$num \]\] \|\| \{ echo "dryrun-score: bad timing record: refused"; exit 1; \}\necho "dry-run arm=\$arm phase setup_s=\$ps train_s=\$pt eval_s=\$pe score_s=\$psc job_s=\$pj"/);
  assert.match(score, /num='\^\[0-9\]\+\(\[\.\]\[0-9\]\+\)\?\$'/);
  for (const j of ["sweep-a", "sweep-b"]) assert.match(job(j), /lm-retrain-dryrun-score\.sh "\$RUNNER_TEMP\/arm" "\$RUNNER_TEMP\/r\/live" "\$ARM" "\$\(jq -r \.lr "\$RUNNER_TEMP\/arm\/summary\.json"\)" "\$RUNNER_TEMP\/dry"/);
  const guard = read("peaceai/bin/lm-retrain-dryrun-guard.sh"); assert.doesNotMatch(guard, /MODE/, "the guard does not depend on the mode");
  for (const mode of ["finetune", "pretrain"]) for (const v of ["true", "", "TRUE"]) tmp((d) => {
    const r = spawnSync("bash", ["peaceai/bin/lm-retrain-dryrun-guard.sh", "touch", join(d, "wrote")], { cwd: repo, encoding: "utf8", env: env0({ MODE: mode, DRY_RUN: v }) });
    assert.equal(r.status, 1); assert.equal(existsSync(join(d, "wrote")), false, `${mode} DRY_RUN=${v}`);
  });
  for (const j of ["finetune-eval-land", "retrain-memcheck", "record-memcheck"]) assert.match(job(j), /\n    if: [^\n]*&& inputs\.dry_run != true\n/, `${j} skipped in a dry run (both modes)`);
});

// ---- outcome guard (run 40555453905: a pretrain dry run went green with select, memcheck and record all skipped; Auditor's design 2)
// the two arm summaries of run 40555453905 exactly as its logs printed them
const VS0 = { docs: 79, sha256: "197b70a7ace3ed92615ccada9526ed4168f316b2087fb3316e3b6286c08f0c7f", trainDocs: 42663 };
const RP0 = { replayFrac: 1.0, replayRows: 16, ftRows: 0, val: { docs: 64, seed: "peaceai-val:v1", sha256: "9937aba9bf89cb034e67b459f382bbc4c32507998f820f870f572ec59580068d", windows: 64 },
  corpus: { docsSha256: "4b1fb4b79a82fa7b1a863d93f014e788ad7ae11fc1885cd108c262248dc157e5", docsBytes: 69548335, manifestSha256: "1653700a29dd740a4ed8fb9f4303d657b26f37d52dee93a3489c9d4362f16d34" } };
const ARM = (arm: number, lr: number, best: number, t: { evalSeconds: number; setupSeconds: number; trainSeconds: number }) => ({ bestStep: 1200, bestVal: best, deadlineCut: false, earlyStop: false, lr, noEvalAfterStep0: false, step0Val: 3.9159, steps: 1200, stopAt: 0, stoppedStep: 1200, valAtStop: best, valSplit: VS0, mode: "pretrain", batch: 16,
  timing: { bestStep: 1200, ...t, steps: 1200, stopReason: "steps", stoppedStep: 1200, timeCut: false }, replay: RP0, arm });
const SA0 = ARM(0, 0.00015, 3.5199, { evalSeconds: 160.6, setupSeconds: 26.2, trainSeconds: 8230.7 });
const SB0 = ARM(1, 0.00006, 3.7027, { evalSeconds: 159.8, setupSeconds: 25.7, trainSeconds: 8178.2 });
const outcome = (e: { DRY_RUN: string; SEL?: string; MC?: string; REC?: string; SA?: string; SB?: string; MODE?: string }) =>
  spawnSync("bash", ["peaceai/bin/lm-retrain-outcome.sh"], { cwd: repo, encoding: "utf8", env: env0({ CFG: "peaceai/model/lm-retrain.json", MODE: "pretrain", SEL: "skipped", MC: "skipped", REC: "skipped", SA: JSON.stringify(SA0), SB: JSON.stringify(SB0), ...e }) });
const ok0 = (r: ReturnType<typeof outcome>) => { assert.equal(r.status, 0, r.stdout + r.stderr); return r.stdout; };
const red0 = (r: ReturnType<typeof outcome>, why: RegExp) => { assert.equal(r.status, 1, r.stdout + r.stderr); assert.match(r.stdout, why); assert.match(r.stdout, /: RED\n$/); };

test("M123 outcome wiring: retrain-outcome is the last job, always(), needs every job, no secrets or environment, runs lm-retrain-outcome.sh", () => {
  const o = job("retrain-outcome");
  assert.ok(WF.trimEnd().endsWith(o.trimEnd()), "retrain-outcome is the last job");
  assert.match(o, /\n    needs: \[corpus-gate, sweep-a, sweep-b, finetune-eval-land, retrain-memcheck, record-memcheck\]\n/);
  assert.match(o, /\n    if: always\(\) && github\.repository == 'PeaceG03\/PeaceAI-Workspace' && github\.ref == 'refs\/heads\/main'\n/);
  assert.doesNotMatch(o, /secrets\.|environment:|dry_run != true|DEPLOY_KEY/, "no key, no environment, never skipped in a dry run");
  assert.match(o, /\n    permissions:\n      contents: read\n    steps:\n      - uses: actions\/checkout@[0-9a-f]{40} # v[0-9.]+\n        with:\n          persist-credentials: false\n/, "checkout only to run the shared select rule");
  assert.match(o, /\n          SEL: \$\{\{ needs\.finetune-eval-land\.result \}\}\n          MC: \$\{\{ needs\.retrain-memcheck\.result \}\}\n          REC: \$\{\{ needs\.record-memcheck\.result \}\}\n          SA: \$\{\{ needs\.sweep-a\.outputs\.summary \}\}\n          SB: \$\{\{ needs\.sweep-b\.outputs\.summary \}\}\n        run: \.\/peaceai\/bin\/lm-retrain-outcome\.sh\n/);
  const g = read("peaceai/bin/lm-retrain-outcome.sh");
  assert.match(g, /\npick=\$\(python3 peaceai\/model\/sweep_select\.py "\$CFG" "\$vs" "\$mode" "\$\{arms\[@\]\}"\)/, "the dry-run pick runs the select step's own rule");
  assert.match(g, /\nmode=\$\(\.\/peaceai\/bin\/lm-retrain-mode\.sh\)/);
  assert.doesNotMatch(g.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n"), /\$\{?MODE\b|bestVal|min\(|sort/, "no second copy of the select rule; MODE only via the allowlist script");
  for (const j of ["sweep-a", "sweep-b"]) assert.match(job(j), /\n    outputs:\n      summary: \$\{\{ steps\.arm\.outputs\.summary \}\}\n/);
});

test("M123 outcome dry run: the 40555453905-shaped good dry run passes and prints the pick (arm a, step 1200)", () => {
  const out = ok0(outcome({ DRY_RUN: "true" }));
  assert.match(out, /^outcome dry_run=true select=skipped memcheck=skipped record=skipped$/m);
  assert.match(out, /^dry-run pick arm=a \(index 0\) lr=0\.00015 step=1200 valLoss=3\.5199$/m);
  // an early stop (train.py stopReason "patience") is a finished arm too; the lower loss wins whichever arm it is
  const bEarly = { ...SB0, bestVal: 3.4, bestStep: 900, earlyStop: true, stoppedStep: 1100, timing: { ...SB0.timing, stopReason: "patience", stoppedStep: 1100, bestStep: 900 } };
  assert.match(ok0(outcome({ DRY_RUN: "true", SB: JSON.stringify(bEarly) })), /^dry-run pick arm=b \(index 1\) lr=0\.00006 step=900 valLoss=3\.4$/m);
});

test("M123 outcome dry run: an arm with an empty or unparseable summary, or one that did not finish, is RED", () => {
  red0(outcome({ DRY_RUN: "true", SB: "" }), /sweep arm b has an empty summary/);
  red0(outcome({ DRY_RUN: "true", SA: "" }), /sweep arm a has an empty summary/);
  red0(outcome({ DRY_RUN: "true", SA: "", SB: "" }), /sweep arm a has an empty summary/);
  red0(outcome({ DRY_RUN: "true", SA: "{not json" }), /sweep arm a summary is not parseable/);
  red0(outcome({ DRY_RUN: "true", SA: "[1]" }), /sweep arm a summary is not parseable/);
  for (const reason of ["deadline", "max_seconds", "max_steps_this_run", "", "early-stop"]) {
    const a = { ...SA0, timing: { ...SA0.timing, stopReason: reason } };
    red0(outcome({ DRY_RUN: "true", SA: JSON.stringify(a) }), /sweep arm a stopped on '[^']*' \(not steps or patience\)/);
  }
  const noTiming: Record<string, unknown> = { ...SA0 }; delete noTiming.timing;
  red0(outcome({ DRY_RUN: "true", SA: JSON.stringify(noTiming) }), /sweep arm a stopped on '' /);
});

test("M123 outcome dry run: a pick that is missing or cannot be computed is RED", () => {
  // the select rule refuses: a different validation split, an arm that is not the configured arm, a missing arm index
  red0(outcome({ DRY_RUN: "true", SB: JSON.stringify({ ...SB0, valSplit: { ...VS0, docs: 80 } }) }), /the select rule refused the sweep summaries/);
  red0(outcome({ DRY_RUN: "true", SA: JSON.stringify({ ...SA0, lr: 0.001 }) }), /the select rule refused the sweep summaries/);
  red0(outcome({ DRY_RUN: "true", SB: JSON.stringify({ ...SB0, arm: 0 }) }), /the select rule refused the sweep summaries/);
  red0(outcome({ DRY_RUN: "true", SA: JSON.stringify({ ...SA0, bestStep: 0 }) }), /the select rule refused the sweep summaries/);
  red0(outcome({ DRY_RUN: "true", SA: JSON.stringify({ ...SA0, replay: { ...RP0, ftRows: 3 } }) }), /the select rule refused the sweep summaries/);
  red0(outcome({ DRY_RUN: "true", SA: JSON.stringify({ ...SA0, mode: "finetune" }) }), /the select rule refused the sweep summaries/);
  red0(outcome({ DRY_RUN: "true", MODE: "scratch" }), /bad mode/);
  // the select rule picks no candidate (every arm cut at step 0): no pick, RED (also caught by the stop reason)
  const cut = (s: typeof SA0) => ({ ...s, bestStep: 0, bestVal: s.step0Val, deadlineCut: true, noEvalAfterStep0: true, stoppedStep: 0, timing: { ...s.timing, stopReason: "patience", timeCut: true, bestStep: 0, stoppedStep: 0 } });
  red0(outcome({ DRY_RUN: "true", SA: JSON.stringify(cut(SA0)), SB: JSON.stringify(cut(SB0)) }), /the select rule picked no candidate/);
});

test("M123 outcome real run: green only if select, memcheck and record all succeeded; any skipped or failed is RED", () => {
  assert.match(ok0(outcome({ DRY_RUN: "false", SEL: "success", MC: "success", REC: "success" })), /^real run: select, memcheck and record all succeeded$/m);
  for (const [s, m, r] of [["skipped", "skipped", "skipped"], ["failure", "skipped", "skipped"], ["success", "skipped", "skipped"], ["success", "success", "skipped"],
    ["success", "failure", "skipped"], ["success", "success", "failure"], ["skipped", "success", "success"], ["cancelled", "skipped", "skipped"], ["", "", ""]])
    red0(outcome({ DRY_RUN: "false", SEL: s, MC: m, REC: r }), /real run: select, memcheck and record did not all run and succeed/);
  // a real run never takes the dry-run path, even with good arm summaries
  red0(outcome({ DRY_RUN: "false" }), /real run/);
  for (const v of ["", "TRUE", "1", "False"]) red0(outcome({ DRY_RUN: v, SEL: "success", MC: "success", REC: "success" }), /DRY_RUN is neither true nor false/);
});

test("M123 outcome: the no-candidate record still lands (deadline before the first eval) before the gate result turns the run red", () => {
  const f = job("finetune-eval-land");
  const land = f.indexOf("      - name: Land the run record"), result = f.indexOf("      - name: Result (fail unless the gate passed)");
  assert.ok(land > 0 && result > land, "the record lands before the gate result step");
  assert.doesNotMatch(f.slice(land, result), /\n        if:/, "the record step is unconditional (no candidate included)");
  assert.match(f, /result: \(if \$sc != "true" and \$sel\[0\]\.selected\.candidate == true then \(if \$ok == "true" then "pass" else "fail" end\) else "no candidate" end\)/);
  assert.match(read("peaceai/model/sweep_select.py"), /selected = \{"arm": None, "lr": None, "step": 0, [^\n]*"candidate": False, "result": "no candidate"/);
  for (const s of ["Score live and candidate", "Gate (slice identical", "Verify the checkout and the landing scripts"]) {
    const i = f.indexOf(`      - name: ${s}`); assert.ok(i > 0, s);
    assert.doesNotMatch(f.slice(i, f.indexOf("\n      - name:", i + 10)), /\n        if:/, `${s} runs with no candidate`);
  }
});

test("M123 new files are protected", () => {
  for (const f of ["peaceai/bin/lm-retrain-outcome.sh", "peaceai/model/sweep_select.py", "peaceai/bin/lm-retrain-mode.sh", "peaceai/model/bpb_gate.py", "peaceai/model/memcheck_combine.py", "peaceai/test/m123-lm-pretrain.test.ts", "peaceai/model/lm-retrain.json", "peaceai/bin/lm-retrain-train.sh", "peaceai/model/train.py"]) assert.ok(protectedReason(f), f);
});
