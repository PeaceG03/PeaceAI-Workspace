// M163 lb-train v1 first real run (Auditor ruling after #654): the lb-first-run job of peace-lm-train.yml, its guards
// (peaceai/model/lb_run.py), the ported corpus rebuild (peaceai/bin/lb-corpus-rebuild.sh) and the run script
// (peaceai/bin/lb-first-run.sh). Every tagged lb_run.py guard has a case whose outcome must change when the guard is
// disabled (killed mutant), next to a near miss that passes; the workflow shape is checked by lbJobProblems, which is
// itself mutation-tested (wrong ref, upload / cache / R2 step, LoRA or replay flag, latest.json, non-sparse landing).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { protectedReason } from "../lib/selfchange.ts";
import { json, MODEL, py, repo, tinyCorpus, withDir } from "./m157-lbtrain-mut.ts";
import { noNumpyEnv } from "./nonumpy.ts";

const WF = ".github/workflows/peace-lm-train.yml";
const read = (p: string) => readFileSync(join(repo, p), "utf8");
const sha = (p: string) => createHash("sha256").update(readFileSync(p)).digest("hex");
const PINS = {
  docs: "7eb6c62800fd8f6b73192f85d0c93972efce5c02c2c390116a888d29f7737764",
  manifest: "e9f78828c3777788294b99fe4b2684d288b7144bed10277b7c53ad8ea54119f7",
  fingerprint: "a3e9165f13ec603e2e1bcb5e0fb99fed1916a60204208ff63b9c6b116ece0bd4",
};
// batch 6 (deliberate pin change, 9 -> 12 fields): + heldBytes, heldoutTokens, modelCe, the inputs heldoutBpb is computed from.
const ROW_FIELDS = ["baselineBpb", "checkpointSha256", "heldBytes", "heldoutBpb", "heldoutTokens", "modelCe", "pins", "runId", "steps", "stopReason", "wallSeconds", "workflowSha"];
const TINY_TRAIN = { "--d-model": "16", "--n-layer": "1", "--n-head": "2", "--ctx": "32", "--vocab": "300", "--batch": "2", "--threads": "1", "--eval-every": "2", "--steps": "4", "--patience": "2", "--optimizer": "adamw8bit", "--curriculum": "easy_to_hard", "--val-split": "disjoint" };
const SHA40 = "0123456789abcdef0123456789abcdef01234567";

const pinsOf = (c: string) => ({ docs: sha(join(c, "docs.jsonl")), manifest: sha(join(c, "manifest.jsonl")), fingerprint: json(join(c, "fingerprint.json")).fingerprint });

/** When set, scratchModel installs this mutated lb_run.py instead of the real one (the mutation check). */
let MUTANT: string | null = null;

/** A copy of peaceai/model under dir/name with lb-train.json edited by cfgEdit. */
function scratchModel(dir: string, name: string, cfgEdit: (cfg: any) => void = () => {}) {
  const m = join(dir, name);
  mkdirSync(m, { recursive: true });
  for (const f of readdirSync(MODEL).filter((x) => x.endsWith(".py") || x.endsWith(".json"))) copyFileSync(join(MODEL, f), join(m, f));
  if (MUTANT !== null) writeFileSync(join(m, "lb_run.py"), MUTANT);
  const cfg = json(join(m, "lb-train.json"));
  cfgEdit(cfg);
  writeFileSync(join(m, "lb-train.json"), JSON.stringify(cfg));
  return m;
}

/** Point firstRun (and the cleared list) at a tiny test corpus. */
const tinyCfg = (c: string, train: Record<string, string> = TINY_TRAIN) => (cfg: any) => {
  cfg.firstRun.corpus = pinsOf(c); cfg.clearedCorpora.push({ ...pinsOf(c) }); cfg.firstRun.train = { ...train };
};

const lb = (m: string, args: string[], env: Record<string, string> = {}) => {
  const r = spawnSync(py, [join(m, "lb_run.py"), ...args], { encoding: "utf8", env: { ...process.env, ...noNumpyEnv(), ...env } }); // numpy blocked: stdlib only
  return { status: r.status, out: r.stdout.trim(), last: (r.stdout.trim() || r.stderr.trim()).split("\n").pop()! };
};

/** model_ce for a given bpb, tokens and bytes (export.py: bpb = model_ce * tokens / ln 2 / bytes). */
const ceFor = (bpb: number, tokens: number, bytes: number) => (bpb * Math.LN2 * bytes) / tokens;
/** A valid row for the tiny corpus c. */
const goodRow = (c: string, extra: Record<string, unknown> = {}) => ({
  pins: pinsOf(c), workflowSha: SHA40, runId: "42", steps: 4, stopReason: "steps", heldoutBpb: 3.9, baselineBpb: 4.06,
  wallSeconds: 100, checkpointSha256: "c".repeat(64), modelCe: ceFor(3.9, 1000, 2000), heldoutTokens: 1000, heldBytes: 2000, ...extra,
});

/** A work dir (stop.json + checkpoint) and eval.json, as train.py / export.py leave them. */
function fakeRun(d: string, stop: Record<string, unknown> = { reason: "patience", step: 30 }, ev: Record<string, unknown> = {}) {
  mkdirSync(join(d, "w"), { recursive: true }); mkdirSync(join(d, "m"), { recursive: true });
  writeFileSync(join(d, "w/stop.json"), JSON.stringify(stop)); writeFileSync(join(d, "w/best.npz"), "ckpt");
  const e: Record<string, any> = { heldout_windows: 3, model_bits_per_byte: 3.5, unigram_bits_per_byte: 4.06, heldout_tokens: 96, held_bytes: 300, ...ev };
  if (!("model_ce" in ev)) e.model_ce = ceFor(Number(e.model_bits_per_byte), e.heldout_tokens, e.held_bytes);
  writeFileSync(join(d, "m/eval.json"), JSON.stringify(e));
}
const rowArgs = (d: string, c: string) => ["row", "--corpus", c, "--work", join(d, "w"), "--eval", join(d, "m/eval.json"), "--checkpoint", join(d, "w/best.npz"),
  "--run-id", "42", "--sha", SHA40, "--job-start", String(Math.floor(Date.now() / 1000) - 50), "--out", join(d, `row-${Math.random().toString(36).slice(2)}.json`)];
function landArgs(d: string, row: unknown, runId = "42") {
  const res = join(d, `res-${Math.random().toString(36).slice(2)}`); mkdirSync(res);
  const f = join(d, `in-${Math.random().toString(36).slice(2)}.json`); writeFileSync(f, JSON.stringify(row));
  return { args: ["land", "--row", f, "--run-id", runId], env: { RESULTS_DIR: res }, res };
}
const now = () => Math.floor(Date.now() / 1000);
const argvArgs = (start = now() - 60) => ["train-argv", "--corpus", "C", "--work", "W", "--job-start", String(start)];

/** One case per tagged guard: (scratch model dir, scratch dir) -> the lb_run.py outcome (last output line). */
type Case = (dir: string, name: string) => string;
const withTrain = (edit: (t: Record<string, string>) => void) => (c: string) => { const t: Record<string, string> = { ...TINY_TRAIN }; edit(t); return tinyCfg(c, t); };
const argvCase = (edit: (t: Record<string, string>) => void, cfgMore: (cfg: any) => void = () => {}, start?: number): Case => (dir, name) => {
  const c = tinyCorpus(dir, { name: `${name}-c` });
  const m = scratchModel(dir, name, (cfg) => { withTrain(edit)(c)(cfg); cfgMore(cfg); });
  return lb(m, argvArgs(start)).last;
};
const landCase = (row: (c: string) => unknown, runId = "42", prep: (res: string) => void = () => {}): Case => (dir, name) => {
  const c = tinyCorpus(dir, { name: `${name}-c` });
  const m = scratchModel(dir, name, tinyCfg(c));
  const L = landArgs(dir, row(c), runId); prep(L.res);
  return lb(m, L.args, L.env).last;
};
const rowCase = (stop?: Record<string, unknown>, ev?: Record<string, unknown>): Case => (dir, name) => {
  const c = tinyCorpus(dir, { name: `${name}-c` });
  const m = scratchModel(dir, name, tinyCfg(c));
  const d = join(dir, `${name}-run`); fakeRun(d, stop, ev);
  return lb(m, rowArgs(d, c)).last;
};

const CASES: Record<string, { run: Case; real: string | RegExp }> = {
  "run-ref": { run: (dir, name) => lb(scratchModel(dir, name), ["ref", "--ref", "refs/heads/feature"]).last, real: "LB_RUN_REF_NOT_MAIN" },
  "run-pins": {
    // the corpus is cleared, but it is not the first-run corpus
    run: (dir, name) => { const c = tinyCorpus(dir, { name: `${name}-c` }); return lb(scratchModel(dir, name, (cfg) => cfg.clearedCorpora.push(pinsOf(c))), ["pins", "--corpus", c]).last; },
    real: "LB_RUN_PIN_MISMATCH",
  },
  "run-pins-cleared": {
    run: (dir, name) => { const c = tinyCorpus(dir, { name: `${name}-c` }); return lb(scratchModel(dir, name, (cfg) => { cfg.firstRun.corpus = pinsOf(c); }), ["pins", "--corpus", c]).last; },
    real: "LB_RUN_NOT_CLEARED",
  },
  "run-setting-forbidden": { run: argvCase((t) => { t["--lora-rank"] = "4"; }), real: "LB_RUN_FORBIDDEN_SETTING" },
  "run-setting-allowed": { run: argvCase((t) => { t["--weight-decay"] = "0.1"; }), real: "LB_RUN_SETTING_NOT_ALLOWED" },
  "run-setting-values": { run: argvCase((t) => { t["--seed"] = "1;rm"; }), real: "LB_RUN_SETTING_NOT_ALLOWED" },
  "run-setting-required": { run: argvCase((t) => { t["--optimizer"] = "adamw"; }), real: "LB_RUN_SETTING_REQUIRED" },
  "run-val-split": { run: argvCase((t) => { t["--val-split"] = "first"; }), real: "LB_RUN_SETTING_REQUIRED" },
  "run-patience": { run: argvCase((t) => { delete t["--patience"]; }), real: "LB_RUN_SETTING_REQUIRED" },
  "run-deadline-cap": { run: argvCase(() => {}, (cfg) => { cfg.firstRun.trainDeadlineMin = 300; }), real: "LB_RUN_BAD_DEADLINE" },
  "run-job-start": { run: argvCase(() => {}, () => {}, now() + 3600), real: "LB_RUN_BAD_DEADLINE" },
  "run-deadline-passed": { run: argvCase(() => {}, () => {}, now() - 290 * 60 + 30), real: "LB_RUN_BAD_DEADLINE" },
  "run-row-fields": { run: landCase((c) => goodRow(c, { weightsSha256: "d".repeat(64) })), real: "LB_RUN_ROW_FIELD" },
  "run-row-pin-fields": { run: landCase((c) => goodRow(c, { pins: { ...pinsOf(c), drop: "x" } })), real: "LB_RUN_ROW_FIELD" },
  "run-row-pins": { run: landCase((c) => goodRow(c, { pins: { ...pinsOf(c), docs: "0".repeat(64) } })), real: "LB_RUN_PIN_MISMATCH" },
  "run-row-values": { run: landCase((c) => goodRow(c, { heldoutBpb: "3.9" })), real: "LB_RUN_ROW_VALUE" },
  "run-row-bpb": { run: landCase((c) => goodRow(c, { heldoutBpb: 3.95 })), real: "LB_RUN_ROW_VALUE" },
  "run-land-id": { run: landCase((c) => goodRow(c), "43"), real: "LB_RUN_ROW_VALUE" },
  "run-land-symlink": {
    run: landCase((c) => goodRow(c), "42", (res) => { const o = join(res, "..", `elsewhere-${Math.random().toString(36).slice(2)}`); mkdirSync(o); symlinkSync(o, join(res, "runs")); }),
    real: "LB_RUN_LAND_SYMLINK",
  },
  "run-stop": { run: rowCase({ reason: "error", code: "X", step: 3 }), real: "LB_RUN_TRAIN_ERROR" },
  "run-eval-windows": { run: rowCase(undefined, { heldout_windows: 0 }), real: "LB_RUN_TRAIN_ERROR" },
  "run-gain": { run: rowCase(undefined, { model_bits_per_byte: 4.07, unigram_bits_per_byte: 4.06 }), real: /verdict=no_gain / },
};

test("M163: every tagged lb_run.py guard has a case, and disabling the guard changes its outcome (killed mutant)", () => {
  const src = readFileSync(join(MODEL, "lb_run.py"), "utf8");
  const tags = [...src.matchAll(/# guard:([a-z0-9-]+)$/gm)].map((g) => g[1]!);
  assert.deepEqual([...tags].sort(), Object.keys(CASES).sort(), "every tagged guard has a case and no case is untagged");
  withDir((dir) => {
    for (const name of tags) {
      const real = CASES[name]!.run(dir, `${name}-real`);
      const want = CASES[name]!.real;
      if (typeof want === "string") assert.equal(real, want, `real outcome of ${name}`); else assert.match(real, want, `real outcome of ${name}`);
      const lines = src.split("\n");
      const i = lines.findIndex((l) => l.endsWith(`# guard:${name}`));
      assert.match(lines[i]!, /^\s+if .+:  # guard:/, `${name} is an if-guard`);
      lines[i] = lines[i]!.replace(/if .+:  # guard:/, "if False:  # guard:");
      MUTANT = lines.join("\n");
      let mutated: string;
      try { mutated = CASES[name]!.run(dir, `${name}-mut`); } finally { MUTANT = null; }
      assert.notEqual(mutated, real, `guard ${name}: disabling it must change "${real}"`);
    }
  });
});

test("M163 near misses: main passes the ref gate, a cleared first-run corpus passes the pins, the real config argv is the ruled settings", () => {
  withDir((dir) => {
    const m0 = scratchModel(dir, "m0");
    assert.equal(lb(m0, ["ref", "--ref", "refs/heads/main"]).last, "ref ok");
    for (const bad of ["refs/heads/main2", "refs/heads/feature/main", "refs/tags/main", "main", ""]) assert.equal(lb(m0, ["ref", "--ref", bad]).last, "LB_RUN_REF_NOT_MAIN", bad);
    const c = tinyCorpus(dir);
    const m1 = scratchModel(dir, "m1", tinyCfg(c));
    assert.match(lb(m1, ["pins", "--corpus", c]).last, /^pins ok docs=[0-9a-f]{64} manifest=[0-9a-f]{64} fingerprint=e{64}$/);
    // one changed doc byte is a pin mismatch, and so is a missing file
    const c2 = tinyCorpus(dir, { name: "c2" });
    writeFileSync(join(c2, "docs.jsonl"), readFileSync(join(c2, "docs.jsonl"), "utf8").replace("return x + 1;", "return x + 2;"));
    assert.equal(lb(m1, ["pins", "--corpus", c2]).last, "LB_RUN_PIN_MISMATCH");
    assert.equal(lb(m1, ["pins", "--corpus", join(dir, "nope")]).last, "LB_RUN_PIN_MISMATCH");
    // the real config: exactly the ruled settings, deadline 290 min after the job start (40 min reserve in the 330 min cap)
    const start = now() - 120;
    const r = lb(m0, argvArgs(start));
    assert.equal(r.status, 0, r.out);
    const a = r.out.split("\n");
    const kv = Object.fromEntries(Array.from({ length: a.length / 2 }, (_, i) => [a[2 * i]!, a[2 * i + 1]!]));
    assert.equal(kv["--optimizer"], "adamw8bit"); assert.equal(kv["--curriculum"], "easy_to_hard"); assert.equal(kv["--patience"], "4"); assert.equal(kv["--val-split"], "disjoint");
    assert.equal(Number(kv["--deadline"]), start + 290 * 60);
    assert.ok(Number(kv["--deadline"]) + 40 * 60 <= start + 330 * 60, "the deadline leaves the reserve inside the job cap");
    assert.ok(!a.some((x) => /^--(lora|replay|init-from|resume|save-dir|marker|keep-checkpoints)/.test(x)), "no LoRA, replay, init, resume or saves");
    // every forbidden flag is refused as forbidden (not just as not-allowed); an allowed extra flag is a near miss
    for (const f of ["--lora-rank", "--lora-alpha", "--lora-targets", "--replay-corpus", "--replay-frac", "--init-from", "--resume-from", "--resume-manifest-sha", "--save-dir", "--marker", "--keep-checkpoints"]) {
      const m = scratchModel(dir, `f${f}`, withTrain((t) => { t[f] = "1"; })(c));
      assert.equal(lb(m, argvArgs()).last, "LB_RUN_FORBIDDEN_SETTING", f);
    }
    for (const [f, v] of [["--curriculum", "none"], ["--curriculum", "hard_to_easy"], ["--optimizer", "adamw_fp32"], ["--val-split", "first"], ["--val-split", "overlap"]]) {
      const m = scratchModel(dir, `r${f}${v}`, withTrain((t) => { t[f!] = v!; })(c));
      assert.equal(lb(m, argvArgs()).last, "LB_RUN_SETTING_REQUIRED", `${f} ${v}`);
    }
    const near = scratchModel(dir, "near", withTrain((t) => { t["--lr"] = "0.0006"; t["--min-delta"] = "0.001"; })(c));
    assert.equal(lb(near, argvArgs()).status, 0);
    for (const own of ["--corpus", "--work", "--deadline", "--max-seconds"]) {
      const m = scratchModel(dir, `o${own}`, withTrain((t) => { t[own] = "1"; })(c));
      assert.equal(lb(m, argvArgs()).last, "LB_RUN_SETTING_NOT_ALLOWED", own);
    }
  });
});

test("M163 row: exactly the allowed fields, a gain only below the baseline, one new file under runs/lb-train/, never twice", () => {
  withDir((dir) => {
    const c = tinyCorpus(dir);
    const m = scratchModel(dir, "m", tinyCfg(c));
    const d = join(dir, "run"); fakeRun(d);
    const args = rowArgs(d, c);
    const r = lb(m, args);
    assert.equal(r.status, 0, r.out);
    assert.match(r.last, /^lb-run steps=30 stop=patience heldout_bpb=3\.5 baseline_bpb=4\.06 verdict=beats_baseline wall_s=\d+ checkpoint=[0-9a-f]{64} model_ce=[0-9.]+ heldout_tokens=96 held_bytes=300$/);
    const row = json(args[args.length - 1]!);
    assert.deepEqual(Object.keys(row).sort(), [...ROW_FIELDS].sort());
    // the bpb inputs are logged exactly (model_ce unrounded) and recompute heldoutBpb
    const ev = json(join(d, "m/eval.json"));
    assert.deepEqual([row.modelCe, row.heldoutTokens, row.heldBytes], [ev.model_ce, 96, 300]);
    assert.ok(r.last.includes(` model_ce=${ev.model_ce} `), "the log line carries the same unrounded model_ce");
    assert.ok(Math.abs(row.modelCe * row.heldoutTokens / Math.LN2 / row.heldBytes - row.heldoutBpb) <= 5e-5);
    // inputs that do not recompute the bpb, or are not counts, are refused; an eval without them too
    for (const [what, e] of [["bpb off", { model_ce: ceFor(3.6, 96, 300) }], ["float bytes", { held_bytes: 300.5 }], ["no tokens", { heldout_tokens: null, model_ce: 2 }], ["zero ce", { model_ce: 0 }]] as const) {
      const x = join(dir, `bad-${what.replace(/ /g, "-")}`); fakeRun(x, undefined, e);
      assert.equal(lb(m, rowArgs(x, c)).last, "LB_RUN_ROW_VALUE", what);
    }
    assert.deepEqual(Object.keys(row.pins).sort(), ["docs", "fingerprint", "manifest"]);
    assert.equal(row.checkpointSha256, sha(join(d, "w/best.npz")));
    // equal to the baseline is no gain; just below is
    for (const [h, v] of [[4.06, "no_gain"], [4.0599, "beats_baseline"], [9, "no_gain"]] as const) {
      const e = join(dir, `e${h}`); fakeRun(e, undefined, { model_bits_per_byte: h, unigram_bits_per_byte: 4.06 });
      assert.match(lb(m, rowArgs(e, c)).last, new RegExp(`verdict=${v} `), String(h));
    }
    // a row whose eval lacks the baseline is refused (no claim without it)
    const nb = join(dir, "nb"); fakeRun(nb, undefined, { unigram_bits_per_byte: null });
    assert.equal(lb(m, rowArgs(nb, c)).last, "LB_RUN_ROW_VALUE");
    // land: the near miss lands exactly one file; again is refused; forbidden fields are refused
    const L = landArgs(dir, row, "42");
    assert.equal(lb(m, L.args, L.env).last, "landed runs/lb-train/42.json");
    assert.deepEqual(readdirSync(L.res, { recursive: true }).map(String).sort(), ["runs", "runs/lb-train", "runs/lb-train/42.json"]);
    assert.deepEqual(json(join(L.res, "runs/lb-train/42.json")), row);
    assert.equal(lb(m, [...L.args], L.env).last, "LB_RUN_ROW_EXISTS");
    for (const f of ["weights", "weightsSha256", "tokenizer", "metrics", "docs", "latest", "schema", "verdict", "eval"]) {
      const X = landArgs(dir, { ...row, [f]: "x" }, "42");
      assert.equal(lb(m, X.args, X.env).last, "LB_RUN_ROW_FIELD", f);
      assert.ok(!existsSync(join(X.res, "runs/lb-train/42.json")), f);
    }
    for (const f of ROW_FIELDS) {
      const { [f]: _drop, ...less } = row;
      const X = landArgs(dir, less, "42");
      assert.equal(lb(m, X.args, X.env).last, "LB_RUN_ROW_FIELD", `missing ${f}`);
    }
    const noRes = lb(m, landArgs(dir, row, "42").args, { RESULTS_DIR: "" });
    assert.equal(noRes.last, "LB_RUN_NO_RESULTS");
  });
});

/** The lb jobs of the workflow: from the ref gate job to the M37 train job. */
function lbJobs(text: string) {
  const a = text.indexOf("\n  lb-ref-gate:\n"), b = text.indexOf("\n  train:\n");
  return a < 0 || b < a ? "" : text.slice(a, b);
}

/** Problems with the lb-first-run jobs: [] for the reviewed shape. */
function lbJobProblems(text: string, jobTimeoutMin: number): string[] {
  const p = new Set<string>();
  const j = lbJobs(text);
  if (!j) return ["missing"];
  if (!j.includes("\n  lb-ref-gate:\n    name: lb-first-run ref gate (main only)\n    if: inputs.run == 'lb-first-run'\n    runs-on: ubuntu-24.04\n")) p.add("ref");
  if (!j.includes(`\n        run: test "$GITHUB_REF" = refs/heads/main || { echo "LB_RUN_REF_NOT_MAIN"; exit 1; }\n`)) p.add("ref");
  if (!/\n  lb-first-run:\n    name: [^\n]+\n    needs: lb-ref-gate\n    if: inputs\.run == 'lb-first-run' && github\.ref == 'refs\/heads\/main'\n    runs-on: ubuntu-24\.04\n    timeout-minutes: (\d+)\n    environment: peaceai-results\n/.test(j)) p.add("ref");
  const tm = j.match(/\n  lb-first-run:\n(?:    [^\n]*\n)*?    timeout-minutes: (\d+)\n/);
  if (!tm || Number(tm[1]) !== jobTimeoutMin) p.add("timeout");
  if ((j.match(/runs-on: /g) ?? []).length !== 2 || (j.match(/runs-on: ubuntu-24\.04\n/g) ?? []).length !== 2) p.add("runner");
  if (/upload-artifact|download-artifact|actions\/cache|\bR2\b|r2\.cloudflarestorage|\baws\b|rclone|s3:\/\/|gh release|\bcurl\b|\bwget\b|\bscp\b|\brsync\b/i.test(j)) p.add("upload");
  if (/--(lora|replay|init-from|resume|save-dir|marker|keep-checkpoints)/.test(j)) p.add("setting");
  if (/latest\.json/.test(j.replaceAll("no latest.json", ""))) p.add("latest");
  if ((j.match(/secrets\./g) ?? []).length !== 1) p.add("key");
  const land = `./peaceai/bin/with-deploy-key.sh ./peaceai/bin/results-write.sh --sparse "/runs/lb-train/$GITHUB_RUN_ID.json" "lb-train v1 first run metrics (run $GITHUB_RUN_ID)" \\\n            python3 peaceai/model/lb_run.py land --row "$RUNNER_TEMP/lb-row.json" --run-id "$GITHUB_RUN_ID"\n`;
  if ((j.match(/\.\/peaceai\/bin\/results-write\.sh/g) ?? []).length !== 1 || !j.includes(land)) p.add("land");
  const steps = j.split(/\n(?=      - )/);
  const keyed = steps.findIndex((s) => s.includes("secrets."));
  const verify = steps.findIndex((s) => s.startsWith("      - name: Verify the checkout and the key scripts before the key is used\n"));
  if (keyed < 0 || verify < 0 || verify !== keyed - 1 || !(steps[keyed]! + "\n").includes(land)) p.add("verify");
  const order = ["peaceai/bin/lb-corpus-rebuild.sh", "peaceai/bin/lb-first-run.sh", "Verify the checkout", "./peaceai/bin/results-write.sh"].map((s) => j.indexOf(s));
  if (order.some((x, i) => x < 0 || (i > 0 && x < order[i - 1]!))) p.add("order");
  if (!/\n      - name: Remove the corpus, work and model dirs \(nothing leaves the runner\)\n        if: always\(\)\n        run: rm -rf [^\n]*"\$RUNNER_TEMP\/lbw" "\$RUNNER_TEMP\/lbm"[^\n]*\n$/.test(j)) p.add("cleanup");
  return [...p].sort();
}

test("M163 workflow: the lb-first-run jobs have the reviewed shape; each guard kills its mutant and a near miss passes", () => {
  const wf = read(WF);
  const cfg = json(join(MODEL, "lb-train.json")).firstRun;
  assert.deepEqual(lbJobProblems(wf, cfg.jobTimeoutMin), []);
  const step = (body: string) => wf.replace("      - name: Remove the corpus, work and model dirs", `${body}      - name: Remove the corpus, work and model dirs`);
  const mutants: [string, string, string][] = [
    ["ref", "gate step removed", wf.replace(`test "$GITHUB_REF" = refs/heads/main || { echo "LB_RUN_REF_NOT_MAIN"; exit 1; }`, `echo gate`)],
    ["ref", "job if without the ref", wf.replace("if: inputs.run == 'lb-first-run' && github.ref == 'refs/heads/main'", "if: inputs.run == 'lb-first-run'")],
    ["ref", "job not behind the gate", wf.replace("    needs: lb-ref-gate\n", "")],
    ["upload", "upload-artifact step", step("      - uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02 # v4.6.2\n        with:\n          path: ${{ runner.temp }}/lbm\n")],
    ["upload", "cache step", step("      - uses: actions/cache@5a3ec84eff668545956fd18022155c47e93e2684 # v4.2.3\n        with:\n          path: ${{ runner.temp }}/lbw\n          key: lb\n")],
    ["upload", "R2 copy", step('      - name: Save\n        run: rclone copy "$RUNNER_TEMP/lbm" r2:peaceai\n')],
    ["upload", "aws s3", step('      - name: Save\n        run: aws s3 cp "$RUNNER_TEMP/lbm" s3://x --recursive\n')],
    ["setting", "LoRA flag", wf.replace('lb-first-run.sh "$RUNNER_TEMP/lbc/out"', 'lb-first-run.sh --lora-rank 4 "$RUNNER_TEMP/lbc/out"')],
    ["setting", "replay flag", wf.replace('lb-first-run.sh "$RUNNER_TEMP/lbc/out"', 'lb-first-run.sh --replay-corpus x "$RUNNER_TEMP/lbc/out"')],
    ["latest", "latest.json write", step('      - name: Promote\n        run: cp "$RUNNER_TEMP/lb-row.json" latest.json\n')],
    ["land", "landing without --sparse", wf.replace('results-write.sh --sparse "/runs/lb-train/$GITHUB_RUN_ID.json" ', "results-write.sh ")],
    ["land", "landing a whole dir", wf.replace('--sparse "/runs/lb-train/$GITHUB_RUN_ID.json"', '--sparse "/runs/"')],
    ["verify", "no checkout verify before the key", wf.replace("      - name: Verify the checkout and the key scripts before the key is used\n", "      - name: Check\n")],
    ["runner", "self-hosted runner", wf.replace("    needs: lb-ref-gate\n    if: inputs.run == 'lb-first-run' && github.ref == 'refs/heads/main'\n    runs-on: ubuntu-24.04", "    needs: lb-ref-gate\n    if: inputs.run == 'lb-first-run' && github.ref == 'refs/heads/main'\n    runs-on: self-hosted")],
    ["timeout", "job cap above the config", wf.replace("    timeout-minutes: 330\n    environment: peaceai-results\n    permissions:\n      contents: read\n    env:\n      PYTHONDONTWRITEBYTECODE", "    timeout-minutes: 350\n    environment: peaceai-results\n    permissions:\n      contents: read\n    env:\n      PYTHONDONTWRITEBYTECODE")],
    ["cleanup", "no cleanup", wf.replace("        if: always()\n        run: rm -rf \"$RUNNER_TEMP/lbc\"", "        run: rm -rf \"$RUNNER_TEMP/lbc\"")],
  ];
  for (const [want, what, text] of mutants) {
    assert.notEqual(text, wf, `${what}: the mutation applies`);
    assert.ok(lbJobProblems(text, cfg.jobTimeoutMin).includes(want), `${what}: expected ${want}, got ${lbJobProblems(text, cfg.jobTimeoutMin)}`);
  }
  // near misses: a comment about uploads, and the cleanup naming more dirs, still pass
  assert.deepEqual(lbJobProblems(step("      # nothing is uploaded or cached: the weights stay on this runner\n"), cfg.jobTimeoutMin), []);
  assert.deepEqual(lbJobProblems(wf.replace('"$RUNNER_TEMP/venv"\n', '"$RUNNER_TEMP/venv" "$RUNNER_TEMP/tmp"\n'), cfg.jobTimeoutMin), []);
  // the key scripts are pinned to their committed bytes (checked by sha256sum -c before the key is used)
  for (const f of ["peaceai/bin/with-deploy-key.sh", "peaceai/bin/results-write.sh"]) assert.ok(lbJobs(wf).includes(`\n        ${sha(join(repo, f))}  ${f}\n`), f);
  // the M37 job runs only for the default input, the lb jobs only for lb-first-run
  assert.match(wf, /\n  train:\n    name: train LM \(external pretrain corpus\)\n    if: github\.ref == 'refs\/heads\/main' && inputs\.run == 'ext-pretrain'\n/);
  assert.ok(!/lb-train\.json|lb-daily-cycle|daily_cycle/.test(wf), "the daily cycle stays unscheduled (M160)");
});

test("M163 config and rebuild: the three ruled pins, b149d9b, the drop file, and the ported rebuild recipe", () => {
  const cfg = json(join(MODEL, "lb-train.json"));
  const fr = cfg.firstRun;
  assert.deepEqual(fr.corpus, PINS, "exactly the Auditor's pins");
  assert.ok(cfg.clearedCorpora.some((c: any) => c.docs === PINS.docs && c.manifest === PINS.manifest && c.fingerprint === PINS.fingerprint && c.builtAt === "b149d9b"));
  assert.equal(fr.corpusCommit, "b149d9bea430d45792470f0e32657032748af717");
  assert.equal(fr.dropHashesSha256, sha(join(MODEL, "lb-hidden-drop-hashes.txt")));
  assert.ok(fr.trainDeadlineMin + fr.reserveMin <= fr.jobTimeoutMin && fr.jobTimeoutMin <= 330);
  const rb = read("peaceai/bin/lb-corpus-rebuild.sh");
  assert.match(rb, new RegExp(`\\nWS_COMMIT=${fr.corpusCommit}\\n`));
  assert.match(rb, new RegExp(`\\nDROP_SHA=${fr.dropHashesSha256}\\n`));
  assert.match(rb, /\nPIN=8458eac61cc414128e98eedb6c3b3ad9c50813e62ab680f5a9ef9d909ccfc231\n/, "the M37 manifest pin");
  assert.match(rb, /git -C ws fetch -q --depth 1 https:\/\/github\.com\/PeaceG03\/PeaceAI-Workspace "\$WS_COMMIT"\n/);
  assert.match(rb, /test "\$\(git -C ws rev-parse HEAD\)" = "\$WS_COMMIT" \|\| \{ echo "LB_REBUILD_COMMIT_MISMATCH"; exit 1; \}/);
  assert.match(rb, /cmp -s "\$DROP" "\$HERE\/peaceai\/model\/lb-hidden-drop-hashes\.txt" \|\| \{ echo "LB_REBUILD_DROP_MISMATCH"; exit 1; \}/);
  assert.match(rb, /lb-clean\.ts --in corpus --out out --refs refs --exclusions "\$EX" --drop-hashes "\$DROP"/);
  assert.ok(!/secrets|DEPLOY_KEY|PeaceAI\.git|PeaceAI-Results|latest\.json/.test(rb), "anonymous and public only");
  const fr2 = read("peaceai/bin/lb-first-run.sh");
  const order = ["lb ref --ref", "lb pins --corpus", "lb train-argv", "/train.py", "/export.py", "lb row"].map((s) => fr2.indexOf(s));
  assert.ok(order.every((x, i) => x > 0 && (i === 0 || x > order[i - 1]!)), "ref, pins, argv, train, export, row");
  assert.match(fr2, /\ntrap cleanup EXIT\n/);
  for (const p of ["peaceai/model/lb_run.py", "peaceai/bin/lb-corpus-rebuild.sh", "peaceai/bin/lb-first-run.sh", "peaceai/test/m163-lb-first-run.test.ts", WF]) assert.ok(protectedReason(p), p);
});

test("M163 end to end (tiny corpus): lb-first-run.sh trains, evaluates and writes the metrics-only row; the dirs are gone; refusals stop before training", () => {
  withDir((dir) => {
    const run = (m: string, c: string, tag: string, ref = "refs/heads/main") => {
      const r = spawnSync("bash", [join(repo, "peaceai/bin/lb-first-run.sh"), c, join(dir, `${tag}-w`), join(dir, `${tag}-m`), join(dir, `${tag}-row.json`)], {
        encoding: "utf8", env: { ...process.env, PY: py, LB_MODEL_DIR: m, LB_JOB_START: String(now() - 5), GITHUB_REF: ref, GITHUB_SHA: SHA40, GITHUB_RUN_ID: "77" } });
      return { status: r.status, out: r.stdout + r.stderr };
    };
    const c = tinyCorpus(dir, { bigHeld: true }); // --val-split disjoint needs at least 113 held-out windows
    const m = scratchModel(dir, "m", tinyCfg(c));
    const g = run(m, c, "good");
    assert.equal(g.status, 0, g.out);
    for (const line of g.out.trim().split("\n")) assert.match(line, /^(ref ok|pins ok |params=|tokens |optimizer=adamw8bit |curriculum easy_to_hard |val split=disjoint windows=97\.\.112 |best val_loss|stopped |lb-run steps=)/, `quiet log: ${line}`);
    assert.match(g.out, /^val split=disjoint windows=97\.\.112 n=16 eval_windows=0\.\.95$/m);
    assert.match(g.out, /optimizer=adamw8bit /); assert.match(g.out, /curriculum easy_to_hard /);
    assert.match(g.out, /lb-run steps=\d+ stop=(steps|patience) heldout_bpb=[\d.]+ baseline_bpb=[\d.]+ verdict=(beats_baseline|no_gain) /);
    const row = json(join(dir, "good-row.json"));
    assert.deepEqual(Object.keys(row).sort(), [...ROW_FIELDS].sort());
    assert.equal(row.runId, "77"); assert.equal(row.workflowSha, SHA40); assert.equal(row.pins.fingerprint, "e".repeat(64));
    // real export.py output: 96 eval windows of ctx 32, and the logged inputs recompute the bpb
    assert.equal(row.heldoutTokens, 96 * 32);
    assert.ok(Number.isInteger(row.heldBytes) && row.heldBytes > 0 && row.modelCe > 0);
    assert.ok(Math.abs(row.modelCe * row.heldoutTokens / Math.LN2 / row.heldBytes - row.heldoutBpb) <= 5e-5, "bpb recomputes from the row");
    assert.match(g.out, new RegExp(`lb-run .* model_ce=${row.modelCe} heldout_tokens=${row.heldoutTokens} held_bytes=${row.heldBytes}$`, "m"));
    for (const p of ["good-w", "good-m", "good-w.log"]) assert.ok(!existsSync(join(dir, p)), `${p} removed`);
    assert.ok(!existsSync(c), "the corpus is removed");
    // a pin mismatch and a non-main ref refuse before any training (no work dir, no row)
    const c2 = tinyCorpus(dir, { name: "c2" });
    const pm = run(scratchModel(dir, "m2"), c2, "pm");
    assert.notEqual(pm.status, 0); assert.match(pm.out, /^ref ok\nLB_RUN_PIN_MISMATCH\n$/);
    assert.ok(!existsSync(join(dir, "pm-row.json")));
    const c3 = tinyCorpus(dir, { name: "c3" });
    const wr = run(scratchModel(dir, "m3", tinyCfg(c3)), c3, "wr", "refs/heads/lb-train/first-run");
    assert.notEqual(wr.status, 0); assert.equal(wr.out, "LB_RUN_REF_NOT_MAIN\n");
    const c4 = tinyCorpus(dir, { name: "c4" });
    const lo = run(scratchModel(dir, "m4", withTrain((t) => { t["--lora-rank"] = "2"; })(c4)), c4, "lo");
    assert.notEqual(lo.status, 0); assert.match(lo.out, /LB_RUN_FORBIDDEN_SETTING\n$/); assert.ok(!/params=/.test(lo.out), "no training");
  });
});

test("M163 landing: the workflow's results-write --sparse command adds exactly runs/lb-train/<run id>.json to Results, and refuses a second write", () => {
  withDir((dir) => {
    const git = (cwd: string, ...a: string[]) => spawnSync("git", a, { cwd, encoding: "utf8", env: { ...process.env, ...ID } });
    const ID = { GIT_AUTHOR_NAME: "PeaceG03", GIT_AUTHOR_EMAIL: "301894882+PeaceG03@users.noreply.github.com", GIT_COMMITTER_NAME: "PeaceG03", GIT_COMMITTER_EMAIL: "301894882+PeaceG03@users.noreply.github.com" };
    const remote = join(dir, "remote.git"), seed = join(dir, "seed");
    git(dir, "init", "-q", "--bare", "-b", "main", remote); git(dir, "init", "-q", "-b", "main", seed);
    mkdirSync(join(seed, "models/lm"), { recursive: true }); writeFileSync(join(seed, "latest.json"), "{}\n"); writeFileSync(join(seed, "models/lm/x.json"), "1\n");
    git(seed, "add", "-A"); git(seed, "commit", "-qm", "seed"); git(seed, "push", "-q", remote, "main");
    const c = tinyCorpus(dir);
    const row = { ...goodRow(c), pins: PINS, runId: "555" };
    writeFileSync(join(dir, "lb-row.json"), JSON.stringify(row));
    const wf = read(WF);
    const cmd = lbJobs(wf).match(/\n          (\.\/peaceai\/bin\/with-deploy-key\.sh \.\/peaceai\/bin\/results-write\.sh [^\n]+\\\n[^\n]+)\n/)![1]!
      .replace("./peaceai/bin/with-deploy-key.sh ", "").replace("\\\n", " ");
    const land = () => spawnSync("bash", ["-c", cmd], { cwd: repo, encoding: "utf8",
      env: { ...process.env, ...ID, RUNNER_TEMP: dir, GITHUB_RUN_ID: "555", PEACEAI_RESULTS_REMOTE_OVERRIDE: remote, GITHUB_OUTPUT: "" } });
    const r = land();
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /^landed runs\/lb-train\/555\.json\n/);
    const files = git(dir, "--git-dir", remote, "diff", "--name-status", "main~1", "main").stdout;
    assert.equal(files, "A\truns/lb-train/555.json\n", "one new file, latest.json untouched");
    assert.deepEqual(JSON.parse(git(dir, "--git-dir", remote, "show", "main:runs/lb-train/555.json").stdout), row);
    const again = land();
    assert.notEqual(again.status, 0); assert.match(again.stdout, /LB_RUN_ROW_EXISTS/);
  });
});
