// M122 (LM retrain forgetting fix, after run 40375535718: set C v2 bpb 1.6506 -> 2.0670): the fine-tune pairs keep one
// version per (repo, path, function) and are split by file path with no significant heldout line in train; a pinned
// share of every batch replays the live model's own pretrain train split; early stopping and step selection read only
// pretrain-heldout windows spread over many docs (never set C v2 or the judge items); the replay corpus is proven not to
// overlap set C v2 or the judge-v2 items before training; the dry run refuses every Results write.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
const tmp = (fn: (d: string) => void) => { const d = mkdtempSync(join(tmpdir(), "m122-")); try { fn(d); } finally { rmSync(d, { recursive: true, force: true }); } };
const jsonl = (p: string) => readFileSync(p, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const code = (t: string) => t.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n").replace(/^"""[\s\S]*?"""/m, "");
type Doc = { doc: number; text: string; [k: string]: unknown };
function corpus(d: string, docs: Doc[]) {
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, "docs.jsonl"), docs.map((x) => JSON.stringify({ doc: x.doc, text: x.text })).join("\n") + "\n");
  writeFileSync(join(d, "manifest.jsonl"), docs.map(({ text: _t, ...m }) => JSON.stringify(m)).join("\n") + "\n");
  return d;
}
const pathSplit = (r: string, p: string) => (parseInt(H(`peaceai-ft-path:v1\n${r}\n${p}`).slice(0, 8), 16) % 10 === 0 ? "heldout" : "train");
const R = "PeaceG03/PeaceAI-Workspace";
const paths = Array.from({ length: 400 }, (_, i) => `src/m${i}.ts`);
const heldPaths = paths.filter((p) => pathSplit(R, p) === "heldout"), trainPaths = paths.filter((p) => pathSplit(R, p) === "train");

// ft-pairs.ts --list output shape: one doc per (merged PR, path, function), old per-commit split field.
function ftFixture(d: string) {
  const docs: Doc[] = []; let n = 0;
  const add = (path: string, fn: string, text: string, sha: string) => docs.push({ doc: n, text, split: n++ % 3 === 0 ? "heldout" : "train", repo: R, sha, path, function: fn });
  for (let v = 0; v < 4; v += 1) {  // four merged versions of the same functions (the duplication that run 40375535718 trained on)
    for (const p of [trainPaths[0]!, trainPaths[1]!, heldPaths[0]!]) for (const fn of ["alpha", "beta"]) { const id = p.replace(/\W/g, "_"); add(p, fn, `export function ${fn}_${id}(x: number) {\n  const ${fn}_marker_${v}_${id} = x * ${v} + 1;\n  return ${fn}_marker_${v}_${id};\n}\n`, `${v}`.repeat(40)); }
  }
  add(heldPaths[1]!, "gamma", `function gamma() {\n  return computeTheSharedThingFromTrain(1, 2, 3);\n}\n`, "e".repeat(40));  // shares a significant line with train: dropped
  add(trainPaths[2]!, "delta", `function delta() {\n  return computeTheSharedThingFromTrain(1, 2, 3);\n}\n`, "e".repeat(40));
  add(heldPaths[2]!, "eps", `function eps() {\n  return 0;\n}\n`, "e".repeat(40));  // shares only short lines ("}"): kept
  return { dir: corpus(join(d, "ft-in"), docs), docs };
}
const ftPrepare = (d: string, inDir: string) => spawnSync(py, ["peaceai/model/ft_prepare.py", "--in", inDir, "--out", join(d, "ft-out"), "--report", join(d, "ftp.json"), "--line-min-chars", String(CFG.finetune.ftLineMinChars)], { cwd: repo, encoding: "utf8" });

test("M122 ft_prepare: one version per (repo, path, function), the last listed one", () => tmp((d) => {
  const { dir, docs } = ftFixture(d);
  const r = ftPrepare(d, dir); assert.equal(r.status, 0, r.stderr + r.stdout);
  const out = jsonl(join(d, "ft-out", "manifest.jsonl"));
  const key = (m: { repo: string; path: string; function: string }) => `${m.repo}\0${m.path}\0${m.function}`;
  assert.equal(new Set(out.map(key)).size, out.length, "one version per key");
  for (const m of out) assert.equal(m.doc, Math.max(...docs.filter((x) => key(x as never) === key(m)).map((x) => x.doc)), "the last listed version is kept");
  const rep = JSON.parse(readFileSync(join(d, "ftp.json"), "utf8"));
  assert.equal(rep.olderVersionsDropped, 18); assert.equal(rep.keys, 9);
}));

test("M122 ft_prepare: the split is by file path (every version of a file on one side; the per-commit split is ignored)", () => tmp((d) => {
  const { dir } = ftFixture(d);
  assert.equal(ftPrepare(d, dir).status, 0);
  const out = jsonl(join(d, "ft-out", "manifest.jsonl"));
  for (const m of out) assert.equal(m.split, pathSplit(m.repo, m.path), `${m.path} split by path`);
  assert.ok(out.some((m) => m.split === "heldout") && out.some((m) => m.split === "train"));
  const byPath = new Map<string, Set<string>>(); for (const m of out) byPath.set(m.path, (byPath.get(m.path) ?? new Set()).add(m.split));
  for (const [p, s] of byPath) assert.equal(s.size, 1, `${p} on one side only`);
  const pyRule = execFileSync(py, ["-c", `import sys; sys.path.insert(0, "peaceai/model"); import replay; print(" ".join(replay.path_split("${R}", p) for p in ${JSON.stringify(paths.slice(0, 50))}))`], { cwd: repo, encoding: "utf8" }).trim().split(" ");
  assert.deepEqual(pyRule, paths.slice(0, 50).map((p) => pathSplit(R, p)), "python and the pinned rule agree");
}));

test("M122 ft_prepare: no significant heldout line appears in train", () => tmp((d) => {
  const { dir } = ftFixture(d);
  assert.equal(ftPrepare(d, dir).status, 0);
  const out = jsonl(join(d, "ft-out", "manifest.jsonl")), text = new Map(jsonl(join(d, "ft-out", "docs.jsonl")).map((x) => [x.doc, x.text as string]));
  const sig = (t: string) => t.split("\n").map((l) => l.trim()).filter((l) => l.length >= CFG.finetune.ftLineMinChars);
  const trainLines = new Set(out.filter((m) => m.split === "train").flatMap((m) => sig(text.get(m.doc)!)));
  const held = out.filter((m) => m.split === "heldout");
  assert.ok(held.length >= 2, "heldout docs remain");
  for (const m of held) for (const l of sig(text.get(m.doc)!)) assert.ok(!trainLines.has(l), `heldout line in train (doc ${m.doc})`);
  assert.ok(!out.some((m) => m.function === "gamma"), "the heldout doc sharing a train line is dropped");
  assert.ok(out.some((m) => m.function === "eps"), "a heldout doc sharing only short lines is kept");
  assert.equal(JSON.parse(readFileSync(join(d, "ftp.json"), "utf8")).heldoutSharedLineDropped, 1);
}));

// ---- train.py with replay (tiny model; unit-test sized, like m9's tiny runs)
const TINY = ["--d-model", "16", "--n-layer", "1", "--n-head", "2", "--ctx", "32", "--vocab", "300", "--batch", "4", "--threads", "1", "--eval-every", "2", "--steps", "2", "--max-seconds", "1e9"];
const body = (k: string, i: number) => `export function ${k}${i}(value: number, other: string): string {\n  const total = value * ${i} + other.length;\n  return String(total) + "${k}-${i}";\n}\n`;
function replayFixture(d: string, opts: { ftHeldText?: string; valText?: string; valDocs?: number } = {}) {
  const ft: Doc[] = [];
  for (let i = 0; i < 12; i += 1) ft.push({ doc: i, text: body("ft", i), split: "train" });
  ft.push({ doc: 12, text: opts.ftHeldText ?? body("held", 0), split: "heldout" });
  const rp: Doc[] = [];
  for (let i = 0; i < 20; i += 1) rp.push({ doc: 100 + i, text: body("rp", i), split: "train" });
  for (let i = 0; i < (opts.valDocs ?? 5); i += 1) rp.push({ doc: 200 + i, text: (opts.valText ?? "") + body("val", i).repeat(2), split: "heldout" });
  return { ft: corpus(join(d, "ft"), ft), rp: corpus(join(d, "rp"), rp) };
}
const trainReplay = (d: string, c: { ft: string; rp: string }, work: string, extra: string[]) =>
  spawnSync(py, [join(repo, "peaceai/model/train.py"), "--corpus", c.ft, "--work", join(d, work), "--replay-corpus", c.rp, ...TINY, ...(extra.includes("--val-seed") ? [] : ["--val-seed", "m122-seed"]), ...extra], { encoding: "utf8" });

test("M122 train.py: --replay-frac is respected in every batch (rows recorded per step); out-of-range refused", () => tmp((d) => {
  const c = replayFixture(d);
  for (const [frac, rp, ft] of [[0.75, 3, 1], [0.5, 2, 2], [0, 0, 4], [1, 4, 0]] as const) {
    const r = trainReplay(d, c, `w${frac}`, ["--replay-frac", String(frac), "--val-windows", "3"]);
    assert.equal(r.status, 0, r.stderr + r.stdout);
    const rows = jsonl(join(d, `w${frac}`, "metrics.jsonl")).filter((x) => x.step > 0);
    assert.ok(rows.length === 2);
    for (const x of rows) { assert.equal(x.replay_rows, rp, `frac ${frac}`); assert.equal(x.ft_rows, ft, `frac ${frac}`); }
    const rr = JSON.parse(readFileSync(join(d, `w${frac}`, "replay.json"), "utf8"));
    assert.equal(rr.replayFrac, frac); assert.equal(rr.replayRows, rp); assert.equal(rr.ftRows, ft);
  }
  for (const bad of ["1.5", "-0.1", "nan"]) {
    const r = trainReplay(d, c, `bad${bad}`, ["--replay-frac", bad, "--val-windows", "3"]);
    assert.notEqual(r.status, 0); assert.match(r.stdout + r.stderr, /REPLAY_REFUSED/);
  }
  assert.equal(CFG.finetune.replayFrac, 0.75); assert.match(read("peaceai/model/train.py"), /ap\.add_argument\("--replay-frac", type=float, default=0\.75\)/);
  assert.match(read("peaceai/bin/lm-retrain-train.sh"), /--replay-frac "\$\(f replayFrac\)"/);
}));

test("M122 train.py: validation = one window per pretrain-heldout doc over --val-windows distinct docs; too few docs refused", () => tmp((d) => {
  const c = replayFixture(d);
  const r = trainReplay(d, c, "w", ["--val-windows", "4"]); assert.equal(r.status, 0, r.stderr + r.stdout);
  const v = JSON.parse(readFileSync(join(d, "w", "val.json"), "utf8"));
  assert.equal(v.windows, 4); assert.equal(v.docs, 4); assert.match(v.sha256, /^[0-9a-f]{64}$/); assert.equal(v.seed, "m122-seed");
  assert.equal(trainReplay(d, c, "w-same", ["--val-windows", "4"]).status, 0);
  assert.equal(JSON.parse(readFileSync(join(d, "w-same", "val.json"), "utf8")).sha256, v.sha256, "same seed: same windows");
  assert.equal(trainReplay(d, c, "w-seed2", ["--val-windows", "4", "--val-seed", "other-seed"]).status, 0);
  assert.notEqual(JSON.parse(readFileSync(join(d, "w-seed2", "val.json"), "utf8")).sha256, v.sha256, "another seed: other windows");
  const noSeed = spawnSync(py, [join(repo, "peaceai/model/train.py"), "--corpus", c.ft, "--work", join(d, "w-noseed"), "--replay-corpus", c.rp, ...TINY, "--val-windows", "4"], { encoding: "utf8" });
  assert.notEqual(noSeed.status, 0); assert.match(noSeed.stdout + noSeed.stderr, /REPLAY_REFUSED: --val-seed is required/);
  const few = trainReplay(d, replayFixture(join(d, "few"), { valDocs: 2 }), "w2", ["--val-windows", "4"]);
  assert.notEqual(few.status, 0); assert.match(few.stdout + few.stderr, /REPLAY_REFUSED: only 2 heldout docs/);
  assert.equal(CFG.finetune.valWindows, 64); assert.ok(CFG.replay.valDocs > CFG.finetune.valWindows, "slack for docs the eval dedup drops");
  assert.match(CFG.finetune.valSeed, /^peaceai-val:v\d+$/);
  assert.match(read("peaceai/bin/lm-retrain-train.sh"), /--val-seed "\$\(f valSeed\)"/);
  assert.match(read("peaceai/bin/lm-retrain-train.sh"), /\.val\.seed == \$vseed/);
}));

test("M122 val windows: a seeded, deterministic offset per doc (config seed + doc id), clamped to fit; not all at the doc start", () => {
  const r = spawnSync(py, ["-c", `
import json, sys
sys.path.insert(0, ${JSON.stringify(join(repo, "peaceai/model"))})
import replay
ctx = 32
docs = [(d, [(d * 7 + j) % 251 for j in range(40 + (d * 37) % 400)]) for d in range(100, 140)]
docs.append((99, list(range(ctx + 1))))  # exactly one window long: the only start is 0
a = replay.val_windows(docs, ctx, 30, "peaceai-val:v1")
b = replay.val_windows(list(reversed(docs)), ctx, 30, "peaceai-val:v1")
c = replay.val_windows(docs, ctx, 30, "another-seed")
toks = dict(docs)
offs = [replay.val_offset("peaceai-val:v1", d, len(toks[d]), ctx) for d, _ in a]
ok_slices = all(w == toks[d][o:o + ctx + 1] and len(w) == ctx + 1 and 0 <= o <= len(toks[d]) - ctx - 1 for (d, w), o in zip(a, offs))
bad = []
for s in ("", None, 5):
    try:
        replay.val_windows(docs, ctx, 3, s); bad.append("accepted")
    except ValueError:
        bad.append("refused")
print(json.dumps({"same": a == b, "otherSeed": a != c, "offs": offs, "slices": ok_slices, "bad": bad,
                  "repeat": [replay.val_offset("peaceai-val:v1", 123, 500, ctx) for _ in range(3)]}))
`], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  const o = JSON.parse(r.stdout);
  assert.ok(o.same, "deterministic: same seed and docs give the same windows (input order irrelevant)");
  assert.ok(o.otherSeed, "the seed changes the windows");
  assert.ok(o.slices, "each window is tokens[o:o+ctx+1] with o clamped so it fits");
  assert.equal(o.offs[0], 0, "a doc exactly one window long starts at 0");
  assert.ok(o.offs.filter((x: number) => x > 0).length >= 20, `offsets are not all zero: ${o.offs.join(",")}`);
  assert.equal(new Set(o.repeat).size, 1);
  assert.deepEqual(o.bad, ["refused", "refused", "refused"], "empty / missing / non-string seed refused");
});

test("M122 selection never reads set C: val loss depends only on the replay heldout docs; set C is gone before training; static scan", () => tmp((d) => {
  const val = (w: string) => jsonl(join(d, w, "metrics.jsonl")).filter((x) => "val_loss" in x).map((x) => x.val_loss);
  assert.equal(trainReplay(d, replayFixture(join(d, "a")), "wa", ["--val-windows", "3"]).status, 0);
  assert.equal(trainReplay(d, replayFixture(join(d, "b"), { ftHeldText: "a completely different fine-tune heldout document\n".repeat(9) }), "wb", ["--val-windows", "3"]).status, 0);
  assert.equal(trainReplay(d, replayFixture(join(d, "c"), { valText: "zzzz qqqq different replay heldout text ;;;; \n" }), "wc", ["--val-windows", "3"]).status, 0);
  assert.deepEqual(val("wb"), val("wa"), "the fine-tune heldout docs do not move the validation loss");
  assert.notDeepEqual(val("wc"), val("wa"), "the replay heldout docs are what the validation loss reads");
  // Static: nothing on the selection path names set C, the judge items or the set C scorer.
  // the step's code (its "- name:" title, which says what it never reads, is not code)
  const sel = WF.slice(WF.indexOf("      - name: Select the sweep arm"), WF.indexOf("      - name: Fine-tune the candidate")).split("\n").slice(1).join("\n");
  assert.ok(sel.length > 200);
  for (const [name, t] of [["train.py", read("peaceai/model/train.py")], ["replay.py", read("peaceai/model/replay.py")], ["val_split.py", read("peaceai/model/val_split.py")],
    ["retrain_summary.py", read("peaceai/model/retrain_summary.py")], ["sweep_select.py", read("peaceai/model/sweep_select.py")], ["lm-retrain-outcome.sh", read("peaceai/bin/lm-retrain-outcome.sh")], ["lm-retrain-train.sh", read("peaceai/bin/lm-retrain-train.sh")], ["select step", sel]] as const) {
    assert.doesNotMatch(code(t), /setc|set_c|heldout-c|items\.json|judge|eval_c/i, `${name} never reads set C or the judge items`);
  }
  assert.match(sel, /val_split\.py --corpus "\$RUNNER_TEMP\/w\/replay" --dedup "\$RUNNER_TEMP\/w\/replay-dedup\.json"/);
  for (const j of ["sweep-a", "sweep-b"]) {
    const job = WF.slice(WF.indexOf(`\n  ${j}:`), WF.indexOf(j === "sweep-a" ? "\n  sweep-b:" : "\n  finetune-eval-land:"));
    const del = job.indexOf('rm -rf "$RUNNER_TEMP/w/srcroot" "$RUNNER_TEMP/w/setc" "$RUNNER_TEMP/r/items.json"'), tr = job.indexOf("lm-retrain-train.sh"), sc = job.indexOf("lm-retrain-dryrun-score.sh");
    assert.ok(del > 0 && del < tr && tr < sc, `${j}: set C and the judge items are deleted before training; the dry-run scoring comes after`);
    assert.ok(job.indexOf('echo "summary=') < sc, `${j}: the arm summary is fixed before any set C scoring`);
  }
  tmp((s) => {
    const noDry = spawnSync("bash", ["peaceai/bin/lm-retrain-dryrun-score.sh", s, s, "0", "0.1", join(s, "x")], { cwd: repo, encoding: "utf8", env: { ...process.env, DRY_RUN: "false", PEACEAI_PYTHON: py } });
    assert.notEqual(noDry.status, 0); assert.match(noDry.stdout, /only in a dry run: refused/);
    const early = spawnSync("bash", ["peaceai/bin/lm-retrain-dryrun-score.sh", s, s, "0", "0.1", join(s, "x")], { cwd: repo, encoding: "utf8", env: { ...process.env, DRY_RUN: "true", PEACEAI_PYTHON: py } });
    assert.notEqual(early.status, 0); assert.match(early.stdout, /arm has not finished: refused/);
  });
}));

test("M122 dry run: the guard refuses every Results write unless DRY_RUN is exactly false (the command never starts)", () => tmp((d) => {
  const marker = join(d, "wrote");
  const guard = (env: Record<string, string | undefined>) => {
    const e: Record<string, string> = {}; for (const [k, v] of Object.entries(process.env)) if (v !== undefined && k !== "DRY_RUN") e[k] = v;
    for (const [k, v] of Object.entries(env)) if (v !== undefined) e[k] = v;
    return spawnSync("bash", ["peaceai/bin/lm-retrain-dryrun-guard.sh", "touch", marker], { cwd: repo, encoding: "utf8", env: e });
  };
  for (const v of ["true", undefined, "", "TRUE", "False", "0", "false "]) {
    const r = guard({ DRY_RUN: v });
    assert.equal(r.status, 1, `DRY_RUN=${JSON.stringify(v)} refused`); assert.match(r.stdout, /dry run: Results write refused/);
    assert.equal(existsSync(marker), false, "the write command never ran");
  }
  const ok = guard({ DRY_RUN: "false" }); assert.equal(ok.status, 0); assert.equal(existsSync(marker), true, "a real run writes");
  // Workflow: the dry_run input, the DRY_RUN env, every results-write.sh call behind the guard, landing jobs skipped, no uploads.
  assert.match(WF, /^on:\n  workflow_dispatch:\n    inputs:\n      dry_run:\n        description: "[^"\n]+"\n        type: boolean\n        default: false\n      mode:\n        description: "[^"\n]+"\n        type: choice\n        options:\n          - finetune\n          - pretrain\n        default: finetune\n      resume_run_id:\n        description: "[^"\n]+"\n        type: string\n        default: ""\n      memcheck_only_run_id:\n        description: "[^"\n]+"\n        type: string\n        default: ""\n\npermissions: \{\}\n/m);
  assert.match(WF, /\n  DRY_RUN: \$\{\{ inputs\.dry_run && 'true' \|\| 'false' \}\}\n/);
  const writes = WF.split("\n").filter((l) => l.includes("results-write.sh") && !l.includes("sha256") && !/^\s*#/.test(l) && !/  peaceai\/bin\/results-write\.sh$/.test(l));
  assert.ok(writes.length >= 2);
  for (const l of writes) assert.match(l, /^\s+\.\/peaceai\/bin\/lm-retrain-dryrun-guard\.sh \.\/peaceai\/bin\/with-deploy-key\.sh \.\/peaceai\/bin\/results-write\.sh /, l.trim());
  for (const j of ["finetune-eval-land", "retrain-memcheck", "record-memcheck"]) {
    const head = WF.slice(WF.indexOf(`\n  ${j}:`)).split("\n").slice(0, 6).join("\n");
    assert.match(head, /\n    if: [^\n]*&& inputs\.dry_run != true\n/, `${j} is skipped in a dry run`);
  }
  assert.doesNotMatch(WF, /upload-artifact|actions\/cache|download-artifact/);
  assert.ok(WF.includes(`${H(readFileSync(join(repo, "peaceai/bin/lm-retrain-dryrun-guard.sh")))}  peaceai/bin/lm-retrain-dryrun-guard.sh`), "the guard is hash-checked before the key is used");
  const score = read("peaceai/bin/lm-retrain-dryrun-score.sh");
  const echoes = score.split("\n").filter((l) => /\becho\b/.test(l) && !/refused|no kept checkpoints/.test(l));
  // M123: plus one phase-times line (numbers only; each value checked against a number pattern first).
  assert.deepEqual(echoes.map((l) => l.trim()), ['echo "dry-run $2 setc_bpb=$bpb"', 'echo "dry-run arm=$arm phase setup_s=$ps train_s=$pt eval_s=$pe score_s=$psc job_s=$pj"'], "the dry run prints set C bpb lines and phase times only");
  assert.match(score, /score "\$live" "live"/); assert.match(score, /score "\$s\/m" "arm=\$arm lr=\$lr step=\$c"/);
  assert.match(score, /\[ "\$sl" = "\$want" \]/, "same pinned set C slice as the gate");
}));

// ---- overlap proof
function proofFixture(d: string, mut: (x: { rp: Doc[]; setc: string[]; items: { context: string; reference: string; derived: string }[]; dedup: Record<string, unknown> }) => void = () => {}) {
  const rp: Doc[] = [];
  for (let i = 0; i < 6; i += 1) { const t = body("rp", i); rp.push({ doc: i, text: t, split: i < 4 ? "train" : "heldout", repo: "colinhacks/zod", commit: "a".repeat(40), path: `src/r${i}.ts`, sha256: H(t) }); }
  const x = { rp, setc: [body("setc", 1), body("setc", 2)], items: [{ context: "function judged(", reference: "a) { return a; }", derived: "a) { return b; }" }], dedup: { recheckOverlapDocs: 0 } as Record<string, unknown> };
  mut(x);
  for (const r of x.rp) r.sha256 = H(r.text);
  const rdir = corpus(join(d, "replay"), x.rp);
  if (!("outManifestSha256" in x.dedup)) x.dedup.outManifestSha256 = H(readFileSync(join(rdir, "manifest.jsonl")));
  corpus(join(d, "setc"), x.setc.map((t, i) => ({ doc: i, text: t })));
  writeFileSync(join(d, "items.json"), JSON.stringify(x.items)); writeFileSync(join(d, "dedup.json"), JSON.stringify(x.dedup));
  const hc = { schema: "peaceai-heldout-c:v2", sets: { C: [{ repo: "axios/axios", sha: "b".repeat(40), contentSha256: [H("listed set C file\n")] }] } };
  writeFileSync(join(d, "hc.json"), JSON.stringify(hc));
  corpus(join(d, "ft"), [{ doc: 0, text: body("ft", 0), split: "train" }]);
  return spawnSync(py, ["peaceai/model/replay_proof.py", "--replay", rdir, "--dedup", join(d, "dedup.json"), "--setc", join(d, "setc"), "--heldout-c", join(d, "hc.json"),
    "--judge", join(d, "items.json"), "--judge-sha", H(readFileSync(join(d, "items.json"))), "--ft", join(d, "ft"), "--out", join(d, "proof.json")], { cwd: repo, encoding: "utf8" });
}

test("M122 overlap proof: clean replay passes and prints counts and shas; each kind of overlap refuses", () => {
  tmp((d) => {
    const r = proofFixture(d); assert.equal(r.status, 0, r.stdout + r.stderr);
    const p = JSON.parse(readFileSync(join(d, "proof.json"), "utf8"));
    assert.equal(p.ok, true); assert.equal(p.trainDocs, 4); assert.equal(p.valDocs, 2);
    for (const k of ["trainIdsSha256", "valIdsSha256", "setcShaListSha256", "judgeItemsSha256", "replayManifestSha256"]) { assert.match(p[k], /^[0-9a-f]{64}$/); assert.match(r.stdout, new RegExp(`replay proof ${k}=${p[k]}`)); }
    assert.match(r.stdout, /replay proof trainDocs=4\n/); assert.doesNotMatch(r.stdout, /export function/, "no text in the log");
  });
  const cases: [string, Parameters<typeof proofFixture>[1]][] = [
    ["setcSha", (x) => { x.rp[1]!.text = x.setc[0]!; }],
    ["setcSha", (x) => { x.rp[4]!.text = "listed set C file\n"; }],
    ["repo", (x) => { x.rp[2]!.repo = "axios/axios"; }],
    ["judgeSha256", (x) => { x.rp[0]!.text = x.items[0]!.context + x.items[0]!.reference; }],
    ["judgeSha256", (x) => { x.rp[5]!.text = x.items[0]!.derived; }],
    ["trainVal", (x) => { x.rp[4]!.text = x.rp[0]!.text; }],
    ["ftVal", (x) => { x.rp[5]!.text = body("ft", 0); }],
    ["dedup", (x) => { x.dedup.recheckOverlapDocs = 1; }],
    ["dedup", (x) => { x.dedup.outManifestSha256 = "0".repeat(64); }],
  ];
  for (const [k, mut] of cases) tmp((d) => {
    const r = proofFixture(d, mut); assert.equal(r.status, 1, `${k} refused`); assert.match(r.stdout, /OVERLAP or unreadable input: refused/);
    assert.ok(JSON.parse(readFileSync(join(d, "proof.json"), "utf8")).overlap[k] > 0, k);
  });
  tmp((d) => { // the judge items must be the pinned ones
    proofFixture(d);
    const r = spawnSync(py, ["peaceai/model/replay_proof.py", "--replay", join(d, "replay"), "--dedup", join(d, "dedup.json"), "--setc", join(d, "setc"), "--heldout-c", join(d, "hc.json"),
      "--judge", join(d, "items.json"), "--judge-sha", "f".repeat(64), "--out", join(d, "p2.json")], { cwd: repo, encoding: "utf8" });
    assert.equal(r.status, 1); assert.equal(JSON.parse(readFileSync(join(d, "p2.json"), "utf8")).overlap.judgeSha, 1);
  });
});

// ---- replay corpus: rebuild + select (offline), fetch (local fixture remotes), assemble (sha-checked)
function extSource(n: number) {
  const ents = Array.from({ length: n }, (_, i) => {
    const repo = i % 3 ? "colinhacks/zod" : "sindresorhus/ky", path = i === 5 ? "src/we ird[1]*name?.ts" : `src/f${i}.ts`, text = body("x", i).repeat(1 + (i % 4));
    return { e: { doc: i, stage: "pretrain", repo, commit: "", license: "MIT", path, sha256: H(text), bytes: Buffer.byteLength(text), origin: "ext" }, text };
  });
  return ents;
}
const splitOf = (r: string, p: string) => (createHash("sha256").update(`${r}\n${p}`).digest()[0]! < Math.round(256 * 5 / 100) ? "heldout" : "train");

test("M122 replay corpus: rebuilt manifest must hash to the pin; selection is train-only / heldout-only; fetch + assemble are sha-checked", () => tmp((d) => {
  const g = (cwd: string, ...a: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "init.defaultBranch=main", ...a], { cwd, encoding: "utf8" }).trim();
  const ents = extSource(120);
  // fixture remotes for the two ext repos (file:// via url.insteadOf; partial clone and fetch-by-sha allowed)
  const commits: Record<string, string> = {};
  for (const r of ["colinhacks/zod", "sindresorhus/ky"]) {
    const src = join(d, "src", r); mkdirSync(src, { recursive: true }); g(src, "init", "-q");
    for (const x of ents.filter((x) => x.e.repo === r)) { mkdirSync(join(src, x.e.path, ".."), { recursive: true }); writeFileSync(join(src, x.e.path), x.text); }
    g(src, "add", "-A"); g(src, "commit", "-qm", "c"); commits[r] = g(src, "rev-parse", "HEAD");
    const bare = join(d, "remotes", `${r}.git`); mkdirSync(join(bare, ".."), { recursive: true }); g(d, "clone", "-q", "--bare", src, bare);
    g(bare, "config", "uploadpack.allowFilter", "true"); g(bare, "config", "uploadpack.allowAnySHA1InWant", "true");
  }
  for (const x of ents) x.e.commit = commits[x.e.repo]!;
  const srcText = [JSON.stringify({ schema: "peaceai-ext-manifest:v1", config: "c", entries: ents.length }), ...ents.map((x) => JSON.stringify(x.e))].join("\n") + "\n";
  const live = ents.map((x) => JSON.stringify({ ...x.e, split: splitOf(x.e.repo, x.e.path) })).join("\n") + "\n";
  const nHeld = ents.filter((x) => splitOf(x.e.repo, x.e.path) === "heldout").length;
  assert.ok(nHeld >= 2, "fixture has heldout docs");
  // the source manifest lives in a fixture "PeaceG03/PeaceAI-Workspace" remote at a pinned commit
  const ws = join(d, "src", "ws"); mkdirSync(join(ws, "peaceai/model"), { recursive: true }); g(ws, "init", "-q");
  writeFileSync(join(ws, "peaceai/model/ext-manifest.jsonl"), srcText); g(ws, "add", "-A"); g(ws, "commit", "-qm", "m");
  const wsBare = join(d, "remotes", "PeaceG03/PeaceAI-Workspace.git"); mkdirSync(join(wsBare, ".."), { recursive: true }); g(d, "clone", "-q", "--bare", ws, wsBare);
  g(wsBare, "config", "uploadpack.allowFilter", "true"); g(wsBare, "config", "uploadpack.allowAnySHA1InWant", "true");
  const rc = { manifestSha256: H(live), source: { repo: "PeaceG03/PeaceAI-Workspace", commit: g(ws, "rev-parse", "HEAD"), path: "peaceai/model/ext-manifest.jsonl", sha256: H(srcText) }, salt: "peaceai-replay:v1", trainMaxBytes: 3000, valDocs: Math.min(2, nHeld), valMinBytes: 1 };
  // a scratch cwd with the scripts the replay build runs, and a config carrying the fixture pins
  const cwd = join(d, "cwd");
  for (const f of ["peaceai/bin/lm-retrain-replay.sh", "peaceai/bin/lm-retrain-mode.sh", "peaceai/model/replay_corpus.py", "peaceai/model/eval_dedup.py", "peaceai/model/replay_proof.py", "peaceai/model/replay.py"]) {
    mkdirSync(join(cwd, f, ".."), { recursive: true }); copyFileSync(join(repo, f), join(cwd, f));
  }
  chmodSync(join(cwd, "peaceai/bin/lm-retrain-replay.sh"), 0o755); chmodSync(join(cwd, "peaceai/bin/lm-retrain-mode.sh"), 0o755);
  writeFileSync(join(cwd, "peaceai/model/lm-retrain.json"), JSON.stringify({ ...CFG, replay: rc, eval: { ...CFG.eval, judgeItemsSha256: H("[{\"context\":\"q(\",\"reference\":\"1)\",\"derived\":\"2)\"}]") } }));
  writeFileSync(join(cwd, "peaceai/model/heldout-c.json"), JSON.stringify({ schema: "peaceai-heldout-c:v2", sets: { C: [{ repo: "axios/axios", sha: "b".repeat(40), contentSha256: [H("nope")] }] } }));
  const work = join(d, "work"); corpus(join(work, "setc"), [{ doc: 0, text: "unrelated set C text for the fixture only\n" }]); corpus(join(work, "ft"), [{ doc: 0, text: "ft\n", split: "train" }]);
  writeFileSync(join(d, "items.json"), "[{\"context\":\"q(\",\"reference\":\"1)\",\"derived\":\"2)\"}]");
  const env = { ...process.env, MODE: "finetune", PEACEAI_PYTHON: py, GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: `url.file://${join(d, "remotes")}/.insteadOf`, GIT_CONFIG_VALUE_0: "https://github.com/", GIT_TERMINAL_PROMPT: "0" };
  const r = spawnSync("bash", ["peaceai/bin/lm-retrain-replay.sh", work, join(d, "items.json")], { cwd, encoding: "utf8", env });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /replay proof: no overlap/);
  const man = readFileSync(join(work, "replay/manifest.jsonl"), "utf8").split("\n").filter(Boolean);
  const liveLines = new Set(live.split("\n"));
  for (const l of man) assert.ok(liveLines.has(l), "every replay manifest line is a line of the live training manifest, byte-identical");
  const m = man.map((l) => JSON.parse(l)), texts = new Map(jsonl(join(work, "replay/docs.jsonl")).map((x) => [x.doc, x.text]));
  for (const x of m) assert.equal(H(texts.get(x.doc)!), x.sha256, "fetched text matches the manifest sha");
  assert.equal(m.filter((x) => x.split === "heldout").length, rc.valDocs);
  assert.ok(m.filter((x) => x.split === "train").reduce((a, x) => a + x.bytes, 0) <= rc.trainMaxBytes);
  assert.ok(!existsSync(join(work, "replay-git")) && !existsSync(join(work, "replay-blobs")), "scratch clones deleted");
  // pins: a changed source or a manifest that does not rebuild to the pin is refused
  const plan = (cfg: object) => { writeFileSync(join(d, "c.json"), JSON.stringify({ replay: cfg })); writeFileSync(join(d, "s.jsonl"), srcText); return spawnSync(py, ["peaceai/model/replay_corpus.py", "plan", "--mode", "finetune", "--source", join(d, "s.jsonl"), "--config", join(d, "c.json"), "--plan", join(d, "p.jsonl")], { cwd: repo, encoding: "utf8" }); };
  assert.equal(plan(rc).status, 0);
  assert.match(plan({ ...rc, source: { ...rc.source, sha256: "0".repeat(64) } }).stderr, /source ext manifest sha256 differs/);
  assert.match(plan({ ...rc, manifestSha256: "0".repeat(64) }).stderr, /not the live model's training manifest/);
  // assemble refuses a blob whose text does not match the manifest
  const rows = jsonl(join(d, "p.jsonl")); mkdirSync(join(d, "blobs"));
  for (const x of rows) writeFileSync(join(d, "blobs", String(x.i)), ents[x.doc]!.text);
  assert.equal(spawnSync(py, ["peaceai/model/replay_corpus.py", "assemble", "--plan", join(d, "p.jsonl"), "--blobs", join(d, "blobs"), "--out", join(d, "o1")], { cwd: repo, encoding: "utf8" }).status, 0);
  writeFileSync(join(d, "blobs", "0"), "tampered\n");
  assert.match(spawnSync(py, ["peaceai/model/replay_corpus.py", "assemble", "--plan", join(d, "p.jsonl"), "--blobs", join(d, "blobs"), "--out", join(d, "o2")], { cwd: repo, encoding: "utf8" }).stderr, /content sha256 differs/);
}));

test("M122 replay pins: the source is the public ext manifest M37 trained on; it rebuilds to the live model's training manifest", () => {
  assert.equal(CFG.replay.source.sha256, "040eb0c40961b9ac669c97bbcc4c2c3aca30234a9de10e7562ab4cd2fc7a33af");
  assert.ok(read("peaceai/test/m9.test.ts").includes(`--manifest-sha ${CFG.replay.source.sha256}`), "the same manifest sha m9 pins for peace-lm-train.yml");
  assert.equal(CFG.replay.manifestSha256, "6fc30d39a649601067a1ad8f74c10083993420db0abdbeb1ae8e72286fa19ab1");
  assert.equal(CFG.live.version, "lm-v1-088073d41dbc");
  const live = read("peaceai/bin/lm-retrain-live.sh");
  assert.match(live, /test "\$\(sha256sum "\$L\/manifest\.jsonl" \| cut -c1-64\)" = "\$ms"/, "Results' live manifest is the pin");
  assert.match(live, /noCoreFiles "\$L\/corefree-proof\.json"\)" = PROVEN && test "\$\(jq -r \.manifestSha256 "\$L\/corefree-proof\.json"\)" = "\$ms"/, "and is proven core-free");
  const have = spawnSync("git", ["-C", repo, "cat-file", "-e", `${CFG.replay.source.commit}:${CFG.replay.source.path}`]);
  if (have.status !== 0) return; // shallow CI checkout: the workflow re-checks both shas when it fetches the source
  tmp((d) => {
    const src = execFileSync("git", ["-C", repo, "show", `${CFG.replay.source.commit}:${CFG.replay.source.path}`], { maxBuffer: 1 << 28 });
    assert.equal(H(src), CFG.replay.source.sha256);
    writeFileSync(join(d, "s.jsonl"), src);
    const r = spawnSync(py, ["peaceai/model/replay_corpus.py", "plan", "--mode", "finetune", "--source", join(d, "s.jsonl"), "--config", join(repo, "peaceai/model/lm-retrain.json"), "--plan", join(d, "p.jsonl")], { cwd: repo, encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    const rows = jsonl(join(d, "p.jsonl")), val = rows.filter((x) => JSON.parse(x.line).split === "heldout");
    assert.equal(val.length, CFG.replay.valDocs); assert.ok(new Set(val.map((x) => x.repo)).size >= 10, "val docs spread over many repos");
    const crepos = new Set(JSON.parse(read("peaceai/model/heldout-c.json")).sets.C.map((e: { repo: string }) => e.repo));
    assert.ok(!rows.some((x) => crepos.has(x.repo)), "no replay doc from a set C repo");
  });
});

test("M122 workflow: replay corpus proven before training, re-checked in every training job; config; new files protected", () => {
  const gate = WF.slice(WF.indexOf("\n  corpus-gate:"), WF.indexOf("\n  sweep-a:"));
  assert.ok(gate.indexOf("lm-retrain-replay.sh") > gate.indexOf("lm-retrain-corpus.sh"), "corpus-gate builds and proves the replay corpus");
  assert.match(gate, /replay: \$\{\{ steps\.replay\.outputs\.replay \}\}/);
  assert.ok(WF.indexOf("lm-retrain-replay.sh") < WF.indexOf("lm-retrain-train.sh"), "proof before any training");
  for (const j of ["sweep-a", "sweep-b", "finetune-eval-land"]) {
    const job = WF.slice(WF.indexOf(`\n  ${j}:`) + 1); const next = job.search(/\n  [a-z][a-z-]*:\n/);
    const body2 = next > 0 ? job.slice(0, next) : job;
    assert.ok(body2.indexOf("lm-retrain-replay-check.sh") > 0 && body2.indexOf("lm-retrain-replay-check.sh") < body2.indexOf("lm-retrain-train.sh"), `${j} re-checks the replay corpus before training`);
    assert.match(body2, /lm-retrain-train\.sh "\$RUNNER_TEMP\/w\/ft" "\$RUNNER_TEMP\/w\/dedup\.json" "\$RUNNER_TEMP\/w\/replay" "\$RUNNER_TEMP\/w\/replay-dedup\.json" /);
  }
  const rep = read("peaceai/bin/lm-retrain-replay.sh");
  assert.ok(rep.indexOf("eval_dedup.py") < rep.indexOf("replay_proof.py"));
  assert.match(rep, /--judge-sha "\$\(jq -r \.eval\.judgeItemsSha256 "\$cfg"\)"/);
  assert.match(read("peaceai/bin/lm-retrain-corpus.sh"), /ft-pairs\.ts "\$work\/ft-pairs"[\s\S]*ft_prepare\.py --in "\$work\/ft-pairs" --out "\$work\/ft-raw"[\s\S]*eval_dedup\.py --corpus "\$work\/ft-raw"/);
  assert.equal(CFG.finetune.steps, 300); assert.equal(CFG.finetune.replayFrac, 0.75); assert.ok(CFG.finetune.ftLineMinChars >= 16);
  for (const f of ["peaceai/model/replay.py", "peaceai/model/replay_corpus.py", "peaceai/model/replay_proof.py", "peaceai/model/ft_prepare.py", "peaceai/bin/lm-retrain-replay.sh",
    "peaceai/bin/lm-retrain-replay-check.sh", "peaceai/bin/lm-retrain-dryrun-guard.sh", "peaceai/bin/lm-retrain-dryrun-score.sh", "peaceai/test/m122-lm-replay.test.ts"]) assert.ok(protectedReason(f), f);
});
