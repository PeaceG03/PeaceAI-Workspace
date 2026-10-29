// M119 (LM retrain on free GitHub-hosted minutes, Builder + Auditor): the reviewed commit list is pinned, the corpus is
// deduplicated against every eval item, the judge scorer matches lm.ts, the core-free proof accepts builder-log row docs
// only as exact lines, and the workflow carries the Auditor's gate (same-run scores, 0 overlap, set C bpb <= live, AUC >= live,
// heldout-split tuning, Results only, strict memcheck, no promotion).
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { diffScoreItems, ftManifestEntryProblem } from "../lib/lm.ts";
import { protectedReason } from "../lib/selfchange.ts";
import { isCoverageNone, retagTarget, type Entry } from "../../builder-log/check.ts";

const repo = resolve(import.meta.dirname, "..", "..");
const py = process.env.PEACEAI_PYTHON ?? "python3";
const read = (p: string) => readFileSync(join(repo, p), "utf8");
const H = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");
const CFG = JSON.parse(read("peaceai/model/lm-retrain.json"));
const WF = read(".github/workflows/peace-lm-retrain.yml");
const tmp = (fn: (d: string) => void) => { const d = mkdtempSync(join(tmpdir(), "m119-")); try { fn(d); } finally { rmSync(d, { recursive: true, force: true }); } };

test("M119: the commit list is pinned by sha256, well-formed, and its rows are pinned to the configured heads", () => {
  const bytes = readFileSync(join(repo, CFG.list.file));
  assert.equal(H(bytes), CFG.list.sha256);
  const lines = bytes.toString("utf8").split("\n").filter(Boolean);
  assert.equal(new Set(lines).size, lines.length, "no duplicate lines");
  const code = lines.filter((l) => /^code (PeaceG03\/PeaceAI-Workspace|PeaceG03\/PeaceSTOCKS) #\d+ head=[0-9a-f]{40} merge=[0-9a-f]{40}$/.test(l));
  const rows = lines.filter((l) => /^row PeaceG03\/PeaceAI-Workspace builder-log\/tasks\.jsonl seq=\d+ line=\d+ at=([0-9a-f]{40}) added=[0-9a-f]{40}$/.test(l));
  assert.equal(code.length + rows.length, lines.length, "every line is a code or row line");
  for (const r of rows) assert.ok(r.includes(`at=${CFG.list.repos["PeaceG03/PeaceAI-Workspace"]} `), "rows are pinned to the configured Workspace head");
  // No-credit rows (check.ts isCoverageNone: "coverage":"none" or COVERAGE_NONE_SEQS) and retags (not tasks) are never listed.
  const log = read("builder-log/tasks.jsonl").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l) as Entry);
  const listed = new Set(rows.map((r) => Number(/ seq=(\d+) /.exec(r)![1])));
  const excluded = log.filter((e) => isCoverageNone(e) || retagTarget(e) !== null);
  assert.ok(excluded.length >= 12 + 9, "the no-credit and retag rows are found");
  for (const e of excluded) assert.ok(!listed.has(e.seq), `no-credit or retag row ${e.seq} is not listed`);
  for (const s of listed) assert.ok(log.some((e) => e.seq === s), `listed row ${s} exists`);
  assert.ok(code.length > 0 && rows.length > 0);
  for (const k of Object.values(CFG.list.repos)) assert.match(String(k), /^[0-9a-f]{40}$/);
});

test("M119: judge364.py splits diffs exactly like lm.ts diffScoreItems", () => {
  const diffs = [
    "+++ b/src/a.ts\n@@ -1,2 +1,3 @@\n line1\n line2\n+added1\n+added2",
    "+++ b/x.ts\n@@ -1,1 +1,3 @@\n ctx\n+++ not a header in the source\n+y",
    "+++ b/u.ts\n@@ -1,1 +1,2 @@\n ünï\n+" + "é😀".repeat(1500),
    "+++ b/m.ts\n" + Array.from({ length: 12 }, (_, i) => `@@ -${i},1 +${i},2 @@\n c${i}\n+a${i}`).join("\n"),
    "diff --git a/q b/q\nindex 1..2\n--- a/q\n+++ b/q\n@@ -1 +1 @@\n" + Array.from({ length: 40 }, (_, i) => ` l${i}`).join("\n") + "\n+z\n-gone\n+w",
  ];
  const r = spawnSync(py, ["-c", "import json,sys; sys.path.insert(0, sys.argv[1]); import judge364 as j; print(json.dumps([j.diff_score_items(d) for d in json.load(sys.stdin)]))", join(repo, "peaceai/model")], { input: JSON.stringify(diffs), encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout), diffs.map((d) => diffScoreItems(d)));
});

test("M119: eval_dedup.py drops exact, window and whole-short overlaps (and --drop ids), keeps ids, re-checks to 0", () => tmp((d) => {
  const w = (dir: string, docs: { doc: number; text: string }[], man?: unknown[]) => {
    mkdirSync(join(d, dir), { recursive: true });
    writeFileSync(join(d, dir, "docs.jsonl"), docs.map((x) => JSON.stringify(x)).join("\n") + "\n");
    if (man) writeFileSync(join(d, dir, "manifest.jsonl"), man.map((x) => JSON.stringify(x)).join("\n") + "\n");
  };
  const long = Array.from({ length: 40 }, (_, i) => `tok${i}`).join(" + ");
  const setc = [{ doc: 0, text: "export const exactCopy = 1;\n" }, { doc: 1, text: `const v = ${long};` }, { doc: 2, text: "{}" }];
  const train = [
    { doc: 3, text: "export   const exactCopy =  1;" },         // exact after whitespace normalisation
    { doc: 5, text: `function f() { return ${long}; }` },     // shares a long token window with set C
    { doc: 7, text: "unrelated code here { } ;" },              // contains the 2-token "{}" only: kept (exact-only)
    { doc: 8, text: "a judge context line return alpha + beta * gamma - delta ; trailing" }, // contains a whole short judge item
    { doc: 10, text: "x = zeta_ref ( alpha2 , beta2 , gamma2 ) ; y" },  // contains the judge item's reference text on its own
    { doc: 9, text: "clean doc one" }, { doc: 11, text: "clean doc two" },
  ];
  w("setc", setc); w("ft", train, train.map((t) => ({ doc: t.doc, split: t.doc === 11 ? "heldout" : "train" })));
  writeFileSync(join(d, "items.json"), JSON.stringify([{ key: "k1", context: "return ", derived: "alpha + beta * gamma - delta ;", label: "wrong", reference: "zeta_ref ( alpha2 , beta2 , gamma2 ) ;" }]));
  writeFileSync(join(d, "drop.txt"), "9\n");
  const run = (extra: string[]) => spawnSync(py, [join(repo, "peaceai/model/eval_dedup.py"), "--corpus", join(d, "ft"), "--setc", join(d, "setc"), "--judge", join(d, "items.json"), "--out", join(d, "out"), "--report", join(d, "rep.json"), ...extra], { encoding: "utf8" });
  const r = run(["--drop", join(d, "drop.txt")]);
  assert.equal(r.status, 0, r.stderr);
  const rep = JSON.parse(readFileSync(join(d, "rep.json"), "utf8"));
  assert.equal(rep.overlapDocs, 4); assert.equal(rep.overlapDocsSetC, 2); assert.equal(rep.overlapDocsJudge, 2, "reference and derived texts are checked on their own too");
  assert.equal(rep.byMethod.setc_exact, 1); assert.equal(rep.byMethod.setc_window, 1); assert.equal(rep.byMethod.judge_short, 2);
  assert.equal(rep.droppedByList, 1); assert.equal(rep.recheckOverlapDocs, 0); assert.equal(rep.docsOut, 2);
  const kept = readFileSync(join(d, "out", "docs.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l).doc);
  assert.deepEqual(kept, [7, 11], "ids unchanged; overlaps and listed ids gone");
  assert.equal(rep.outManifestSha256, H(readFileSync(join(d, "out", "manifest.jsonl"))));
  assert.doesNotMatch(r.stdout, /exactCopy|alpha|tok\d/, "counts only on stdout");
  writeFileSync(join(d, "drop.txt"), "4\n");
  assert.notEqual(run(["--drop", join(d, "drop.txt")]).status, 0, "an unknown drop id is refused");
}));

test("M119: val_split.py hashes the corpus heldout split only and refuses unsafe splits", () => tmp((d) => {
  const docs = [{ doc: 1, text: "a" }, { doc: 2, text: "b" }, { doc: 4, text: "c" }];
  const put = (man: { doc: number; split: string }[], ds = docs, re = 0) => {
    writeFileSync(join(d, "docs.jsonl"), ds.map((x) => JSON.stringify(x)).join("\n") + "\n");
    writeFileSync(join(d, "manifest.jsonl"), man.map((x) => JSON.stringify(x)).join("\n") + "\n");
    writeFileSync(join(d, "dedup.json"), JSON.stringify({ recheckOverlapDocs: re }));
    return spawnSync(py, [join(repo, "peaceai/model/val_split.py"), "--corpus", d, "--dedup", join(d, "dedup.json")], { encoding: "utf8" });
  };
  const ok = put([{ doc: 1, split: "train" }, { doc: 2, split: "heldout" }, { doc: 4, split: "heldout" }]);
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  assert.deepEqual(JSON.parse(ok.stdout), { docs: 2, trainDocs: 1, sha256: H(`2\t${H("b")}\n4\t${H("c")}\n`) });
  assert.notEqual(put([{ doc: 1, split: "train" }, { doc: 2, split: "heldout" }, { doc: 4, split: "heldout" }], docs, 1).status, 0, "dedup re-check must be 0");
  assert.notEqual(put([{ doc: 1, split: "train" }, { doc: 2, split: "train" }, { doc: 4, split: "train" }]).status, 0, "empty validation split");
  assert.notEqual(put([{ doc: 1, split: "train" }, { doc: 2, split: "heldout" }]).status, 0, "docs and manifest disagree");
  assert.notEqual(put([{ doc: 1, split: "train" }, { doc: 2, split: "heldout" }], [{ doc: 1, text: "a" }, { doc: 2, text: "a" }]).status, 0, "a heldout text equal to a train text");
}));

test("M119: a builder-log row doc must be exactly line N of <sha>:<path> (corefree_proof.py), and JS accepts the same schema", () => tmp((d) => {
  const g = join(d, "src", "PeaceG03", "PeaceAI-Workspace"); mkdirSync(join(g, "builder-log"), { recursive: true });
  const rows = ['{"seq":1,"x":"a"}', '{"seq":2,"x":"b"}', '{"seq":3,"x":"c"}'];
  writeFileSync(join(g, "builder-log", "tasks.jsonl"), rows.join("\n") + "\n");
  const gi = (cwd: string, ...a: string[]) => execFileSync("git", a, { cwd, encoding: "utf8" }).trim();
  gi(g, "init", "-q"); gi(g, "remote", "add", "origin", "https://github.com/PeaceG03/PeaceAI-Workspace.git"); gi(g, "add", "-A"); gi(g, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "c");
  const sha = gi(g, "rev-parse", "HEAD");
  const core = join(d, "core"); mkdirSync(core); writeFileSync(join(core, "x.ts"), "export const coreOnly = 42;\n"); gi(core, "init", "-q"); gi(core, "add", "-A"); gi(core, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "c");
  const model = join(d, "model"); mkdirSync(model); writeFileSync(join(model, "config.json"), JSON.stringify({ version: "lm-v1-000000000119" }));
  const prove = (line: number, text: string) => {
    const c = join(d, `c${line}-${H(text).slice(0, 6)}`); mkdirSync(c);
    const m = { doc: 0, split: "train", repo: "PeaceG03/PeaceAI-Workspace", sha, path: "builder-log/tasks.jsonl", function: "builder-log seq 2", line };
    assert.equal(ftManifestEntryProblem(m), null);
    writeFileSync(join(c, "docs.jsonl"), JSON.stringify({ doc: 0, text }) + "\n"); writeFileSync(join(c, "manifest.jsonl"), JSON.stringify(m) + "\n");
    return spawnSync(py, [join(repo, "peaceai/model/corefree_proof.py"), "--corpus", c, "--core-dir", core, "--model", model, "--stage", "finetune", "--source-root", join(d, "src")], { encoding: "utf8" });
  };
  const ok = prove(2, rows[1]!); assert.equal(ok.status, 0, ok.stderr); assert.equal(JSON.parse(ok.stdout).noCoreFiles, "PROVEN");
  assert.notEqual(prove(3, rows[1]!).status, 0, "wrong line number refused");
  assert.notEqual(prove(2, rows[1]!.slice(0, 5)).status, 0, "a prefix of the line is not the line");
  for (const bad of [0, 1.5, "2"]) assert.equal(ftManifestEntryProblem({ doc: 0, split: "train", repo: "PeaceG03/PeaceAI-Workspace", sha, path: "p", function: "f", line: bad }), "bad line");
}));

test("M119: the retrain workflow carries the Auditor's gate and lands in Results only, with no promotion", () => {
  // M122: workflow_dispatch only, with a boolean dry_run input (m122-lm-replay.test.ts pins what it does); M123 adds the mode choice (m123 pins it).
  assert.match(WF, /^on:\n  workflow_dispatch:\n    inputs:\n      dry_run:\n        description: "[^"\n]+"\n        type: boolean\n        default: false\n      mode:\n        description: "[^"\n]+"\n        type: choice\n        options:\n          - finetune\n          - pretrain\n        default: finetune\n      resume_run_id:\n        description: "[^"\n]+"\n        type: string\n        default: ""\n      memcheck_only_run_id:\n        description: "[^"\n]+"\n        type: string\n        default: ""\n\npermissions: \{\}\n/m);
  assert.doesNotMatch(WF, /pull_request|workflow_run:|schedule:/);
  assert.doesNotMatch(WF, /upload-artifact|actions\/cache|download-artifact/, "no artifacts, no caches");
  assert.doesNotMatch(WF, /self-hosted/); assert.equal((WF.match(/runs-on: ubuntu-24\.04/g) ?? []).length, 7); // 6 jobs + retrain-outcome (m123 pins it)
  // Every key-using step is directly preceded by the checkout / key-script verification.
  const steps = WF.split(/\n      - /);
  steps.forEach((s, i) => { if (/secrets\./.test(s)) assert.match(steps[i - 1]!, /^name: Verify the checkout/, `step before "${s.split("\n")[0]}" verifies the checkout`); });
  // Pins identical to the M49 workflow (results) and the post-train memcheck (core).
  const m49 = read(".github/workflows/peace-lm-train-m49.yml"), mc = read(".github/workflows/m49-posttrain-memcheck.yml");
  for (const l of /LANDING_SHA256: \|-\n((?: {4}.+\n)+)/.exec(m49)![1]!.trim().split("\n")) assert.ok(WF.includes(l.trim()));
  for (const l of /LANDING_SHA256: \|-\n((?: {4}.+\n)+)/.exec(mc)![1]!.trim().split("\n")) assert.ok(WF.includes(l.trim()));
  // Gate 1 + 3: both models scored in this run on the same pinned slice and the same judge items; judge AUC recorded (report-only).
  assert.match(WF, /whos=\(live\); \[ "\$CAND" = true \] && whos\+=\(model\)\n\s+for who in "\$\{whos\[@\]\}"; do\n.*eval_c\.py --model "\$RUNNER_TEMP\/\$who"[^\n]*--max-bytes "\$mb"[\s\S]*?judge364\.py --model "\$RUNNER_TEMP\/\$who"/);
  assert.match(WF, /\[ "\$\(sl live\)" = "\$want" \] && \[ "\$\(sl model\)" = "\$want" \]/);
  assert.doesNotMatch(WF, /float\(sys\.argv\[1\]\) >= float\(sys\.argv\[2\]\)/, "M123: no float comparison: the margin gate is exact (bpb_gate.py)");
  // Judge AUC is report-only (judge gate v1): judge_gate.py decides; it can block only under the promote-to-hard rule.
  assert.doesNotMatch(WF, /ge "\$\(a model\)" "\$\(a live\)"/);
  assert.match(WF, /judge_gate\.py --mode "\$\(jq -r \.eval\.judgeAucGate "\$CFG"\)" --live "\$E\/judge-live\.json" --candidate "\$E\/judge-model\.json" > "\$E\/judge-gate\.json"/);
  assert.match(WF, /\[ "\$\(jq -r \.blocks "\$E\/judge-gate\.json"\)" = false \] \|\| \{ ok=false; why\+=\(judge_auc\); \}/);
  assert.match(WF, /aucGate: \$jg\[0\]/);
  // Set C v2 bits/byte is gating too (Auditor #533): candidate <= live; M123: by at least eval.minBpbGain.
  assert.match(WF, /python3 peaceai\/model\/bpb_gate\.py "\$\(bpb live\)" "\$\(bpb model\)" "\$\(jq -r \.eval\.minBpbGain "\$CFG"\)" \|\| \{ ok=false; why\+=\(setc_bpb\); \}/);  // M123: candidate <= live - eval.minBpbGain (m123 pins bpb_gate.py)
  // The judge scorer must reproduce the live model's recorded aggregates in the same run.
  assert.match(WF, /scores-live-recorded\.json[\s\S]*judge-live\.json[\s\S]*why\+=\(judge_scorer_not_reproduced\)/);
  // Tuning: two sweep arms select by validation loss only (M122: over the replay corpus's pretrain-heldout windows); the candidate is retrained to the selected step.
  assert.deepEqual(CFG.finetune.sweep.lrs, [0.00005, 0.000025]); assert.equal(CFG.finetune.steps, 300);  // M122: 300 (was 1200: ~25 passes over the unique content)
  assert.ok(CFG.finetune.patience > 0);
  for (const j of ["sweep-a", "sweep-b"]) {
    const job = WF.slice(WF.indexOf(`\n  ${j}:`), WF.indexOf("\n  finetune-eval-land:"));
    assert.ok(job.length > 100 && /lm-retrain-train\.sh/.test(job), `${j} exists and trains`);
    // M125: the arms save their finished summary and best-step export in Results (runs/lm-retrain/<run>/arms/<arm>/ only,
    // m125 pins the save); the core key never; the Results key only through the dry-run guard.
    assert.doesNotMatch(job, /PEACEAI_CORE_DEPLOY_KEY|PEACEAI_RESULTS_READ_KEY/, `${j} never holds the core key`);
    const end = job.slice(1).search(/\n  [a-z][\w-]*:\n/), own = end < 0 ? job : job.slice(0, end + 1);
    assert.equal((own.match(/results-write\.sh/g) ?? []).length, 1, `${j} writes once (its arm save)`);
  }
  assert.match(WF, /needs: \[corpus-gate, sweep-a, sweep-b\]/);
  assert.match(WF, /why\+=\(selected_step_not_reached\)/);
  const train = read("peaceai/bin/lm-retrain-train.sh"), vs = read("peaceai/model/val_split.py");
  assert.match(train, /val_split\.py/); const code = (t: string) => t.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");
  assert.doesNotMatch(code(train) + code(vs.replace(/^"""[\s\S]*?"""/m, "")), /setc|items\.json|judge|eval_c/i, "validation never touches set C or the judge items");
  assert.match(vs, /heldout/); assert.match(WF, /validationSplitSha256/);
  assert.equal(CFG.eval.setcMaxBytes, 1000000); assert.equal(CFG.eval.judgeItemCount, 230); assert.equal(CFG.live.version, "lm-v1-088073d41dbc");
  // Gate 2: dedup before training and 0 overlap after.
  assert.ok(WF.indexOf("lm-retrain-corpus.sh") > 0 && WF.indexOf("lm-retrain-corpus.sh") < WF.indexOf("lm-retrain-train.sh"));
  assert.match(WF, /recheckOverlapDocs "\$RUNNER_TEMP\/w\/dedup\.json"\)" = 0/);
  // Gate 4: the live model is lm-retrain.json replayBase (Fix B: pinned in the config, never latest.json) with matching
  // weights; strict memcheck rule.
  const live = read("peaceai/bin/lm-retrain-live.sh");
  assert.match(live, /live=\$\(jq -r \.replayBase\.version "\$cfg"\)/);
  assert.match(live, /test "\$\(jq -r \.live\.version "\$cfg"\)" = "\$live"/);
  assert.doesNotMatch(live.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n"), /latest\.json/, "the restore never reads latest.json");
  assert.match(live, /lm-v1-\$\(sha256sum "\$L\/weights\.npz" \| cut -c1-12\)" = "\$live"/);
  assert.match(read("peaceai/bin/lm-retrain-corpus.sh"), /lm-retrain-headcheck\.sh/, "merged content is compared with the PR head in CI");
  const mcJob = WF.slice(WF.indexOf("\n  retrain-memcheck:"), WF.indexOf("\n  record-memcheck:"));
  // finetune mode: no training corpus given, the strict 32-character rule; pretrain mode (run 40694718190, Auditor's
  // ruling): the two-corpus mode, both corpora exported only inside the pretrain branch
  const ftBranch = mcJob.slice(mcJob.indexOf('if [ "$mode" = finetune ]; then'), mcJob.indexOf("          else\n", mcJob.indexOf('if [ "$mode" = finetune ]; then')));
  assert.ok(ftBranch.length > 0); assert.doesNotMatch(ftBranch, /PEACEAI_LM_TRAIN_CORPUS|PEACEAI_LM_FT_CORPUS/, "finetune: no training corpus given");
  assert.match(ftBranch, /substringRule "\$M"\)" = strict/);
  assert.equal((mcJob.match(/PEACEAI_LM_TRAIN_CORPUS=/g) ?? []).length, 1);
  assert.doesNotMatch(WF, /trainedOn/);
  for (const f of [WF, read("peaceai/model/judge364.py"), read("peaceai/model/lm-retrain.json"), read("peaceai/model/judge_gate.py"), read("peaceai/spec/lm-retrain-judge-gate-v1.md")]) assert.doesNotMatch(f, /right from wrong|tell right|can tell|distinguish(es)? right/i, "no wording that either model tells right from wrong");
  // Gate 5: latest.json is only ever read; landings are path-checked to the run record and the model dir.
  for (const l of WF.split("\n").filter((x) => x.includes("latest.json"))) assert.doesNotMatch(l, /cp |> |mv |tee /, "latest.json is never written");
  assert.match(WF, /landing refused: path outside the run record and model dir/);
  assert.match(WF, /if \[ "\$PASS" = true \]; then d="\$RESULTS_DIR\/models\/lm\/\$v"/, "the candidate lands only on gate PASS");
});

test("M119: every new file is protected", () => {
  for (const f of [".github/workflows/peace-lm-retrain.yml", "peaceai/bin/lm-retrain-corpus.sh", "peaceai/model/lm-retrain.json", "peaceai/model/lm-retrain-commits.txt",
    "peaceai/model/retrain_list.py", "peaceai/model/eval_dedup.py", "peaceai/model/judge364.py", "peaceai/test/m119-lm-retrain.test.ts",
    "peaceai/model/val_split.py", "peaceai/model/judge_gate.py", "peaceai/spec/lm-retrain-judge-gate-v1.md", "peaceai/bin/lm-retrain-live.sh", "peaceai/bin/lm-retrain-train.sh", "peaceai/bin/lm-retrain-headcheck.sh", "peaceai/model/retrain_summary.py"]) assert.ok(protectedReason(f), f);
});

// Auditor #533 follow-ups: behaviour tests for the head check and the non-finite validation-loss refusal.
function headcheckFixture(squashDiffers: boolean, publishRef: boolean) {
  const t = mkdtempSync(join(tmpdir(), "m119-headcheck-"));
  const g = (cwd: string, ...a: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "init.defaultBranch=main", ...a], { cwd, encoding: "utf8" }).trim();
  const remote = join(t, "remote.git"), d = join(t, "src", "PeaceG03", "Demo"), cwd = join(t, "cwd");
  g(t, "init", "-q", "--bare", remote);
  mkdirSync(d, { recursive: true }); g(d, "init", "-q"); g(d, "remote", "add", "origin", remote);
  writeFileSync(join(d, "a.txt"), "base\n"); g(d, "add", "."); g(d, "commit", "-qm", "base");
  const base = g(d, "rev-parse", "HEAD");
  g(d, "checkout", "-qb", "pr"); writeFileSync(join(d, "a.txt"), "head\n"); g(d, "commit", "-qam", "pr");
  const head = g(d, "rev-parse", "HEAD");
  g(d, "checkout", "-q", "main"); writeFileSync(join(d, "a.txt"), squashDiffers ? "tampered\n" : "head\n"); g(d, "commit", "-qam", "squash");
  const merge = g(d, "rev-parse", "HEAD");
  assert.notEqual(merge, base);
  if (publishRef) g(d, "push", "-q", "origin", `${head}:refs/pull/7/head`);
  mkdirSync(join(cwd, "peaceai", "model"), { recursive: true });
  writeFileSync(join(cwd, "peaceai", "model", "lm-retrain.json"), JSON.stringify({ list: { file: "list.txt" } }));
  writeFileSync(join(cwd, "list.txt"), `code PeaceG03/Demo #7 head=${head} merge=${merge}\n`);
  const r = spawnSync("bash", [resolve("peaceai/bin/lm-retrain-headcheck.sh"), join(t, "src")], { cwd, encoding: "utf8" });
  rmSync(t, { recursive: true, force: true });
  return r;
}

test("M119 headcheck: a squash merge equal to refs/pull/N/head passes (control)", () => {
  const r = headcheckFixture(false, true);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /squash_or_rebase=1 files_compared=1 differences=0/);
});

test("M119 headcheck: a squash merge whose content differs from refs/pull/N/head fails", () => {
  const r = headcheckFixture(true, true);
  assert.notEqual(r.status, 0);
  assert.match(r.stdout, /a merged file differs from the PR head/);
  assert.match(r.stdout, /merged content is not the PR head content: refused/);
});

test("M119 headcheck: a missing refs/pull/N/head fails closed", () => {
  const r = headcheckFixture(false, false);
  assert.notEqual(r.status, 0);
  assert.match(r.stdout, /could not be fetched: refused/);
});

test("M119 headcheck: a git diff-tree error fails closed (no process substitution swallowing it)", () => {
  const s = read("peaceai/bin/lm-retrain-headcheck.sh");
  assert.doesNotMatch(s, /<\s*<\(git[^)]*diff-tree/);
  assert.match(s, /diff-tree [^\n]*> "\$changed" \\\n\s*\|\| \{[^}]*git diff-tree failed: refused"; exit 1; \}/);
});

test("M119 sweep summary: a NaN or inf validation loss is refused; finite losses summarize", () => {
  const t = mkdtempSync(join(tmpdir(), "m119-summary-"));
  try {
    const run = (vals: string[]) => {
      const p = join(t, "m.jsonl");
      writeFileSync(p, vals.map((v, i) => `{"step": ${i * 10}, "val_loss": ${v}}`).join("\n") + "\n");
      return spawnSync("python3", ["peaceai/model/retrain_summary.py", p, "0.001", "20", "0", "0", '{"sha256":"x"}'], { encoding: "utf8" });
    };
    for (const bad of [["2.0", "NaN", "1.5"], ["2.0", "Infinity"], ["-Infinity", "1.0"], ["2.0", "1.0", "NaN"]]) {
      const r = run(bad);
      assert.notEqual(r.status, 0, bad.join(","));
      assert.match(r.stderr, /non-finite validation loss at step \d+: refused/);
      assert.equal(r.stdout, "");
    }
    const ok = run(["2.0", "1.5", "1.7"]);
    assert.equal(ok.status, 0, ok.stderr);
    const s = JSON.parse(ok.stdout);
    assert.equal(s.bestVal, 1.5); assert.equal(s.bestStep, 10); assert.equal(s.stoppedStep, 20);
  } finally { rmSync(t, { recursive: true, force: true }); }
  assert.match(read("peaceai/bin/lm-retrain-train.sh"), /peaceai\/model\/retrain_summary\.py/);
});

test("M119 judge items: judge set v2 from Results main pinned by sha256 and count; v1 (JUDGE_SET=v1) by the pinned notes/lm-judge-eval commit", () => {
  // Judge gate v1 (after #550): the retrain scores judge set v2 (lm-judge-v2/ on Results main, landed by
  // peace-lm-judge-v2.yml), pinned by content so a moved branch cannot change the items; v1 stays pinned by commit for
  // the v2 builder. Items are an array of {key, label, file, context, derived, reference, ...}; scores-<v>.json has .agg.
  assert.equal(CFG.eval.judgeSet, "v2");
  assert.equal(CFG.eval.judgeItems, "lm-judge-v2/items.json");
  assert.equal(CFG.eval.judgeRef, "main");
  assert.equal(CFG.eval.judgeItemsSha256, "1deadaaea1992ad18e533595218c9c0953128615c18c9ce0d24dc58d505da2b8");
  assert.equal(CFG.eval.judgeItemCount, 230);
  assert.equal(CFG.eval.judgeAucGate, "report-only");
  assert.equal(CFG.eval.judgeCommit, undefined, "v2 is pinned by content, not by a landing commit");
  const V2 = JSON.parse(read("peaceai/model/judge-v2.json"));
  assert.equal(CFG.eval.judgeItemsSha256, V2.items.sha256); assert.equal(CFG.eval.judgeItemCount, V2.items.n);
  assert.equal(CFG.eval.judgeItems, `${V2.out}/items.json`);
  assert.deepEqual(CFG.eval.judgeV1, { items: "lm-judge/items.json", ref: "notes/lm-judge-eval", commit: "804a95675815d3d7965e95be8d9c368600863412",
    itemsSha256: "38266eb85de963155781e43644f413ed5b97eb58f055d8fe5567e92b7ddcaaa0", itemCount: 364 });
  const j = read("peaceai/bin/lm-retrain-judge.sh");
  assert.match(j, /fetch --quiet --depth 1 --filter=blob:none origin "\$want" 2>\/dev\/null \|\| \{[^}]*refused"; exit 1; \}/);
  assert.match(j, /\[ "\$\{JUDGE_SET:-v2\}" != v1 \] \|\| test "\$got" = "\$c"/);
  assert.match(j, /v1\)[^\n]*\n[^\n]*\n\s*\[ "\$items" = lm-judge\/items\.json \]/);
  assert.match(j, /v2\)[^\n]*\n[^\n]*\n\s*\[ "\$items" = lm-judge-v2\/items\.json \]/);
  assert.match(j, /test "\$\(sha256sum < "\$res\/\$items" \| cut -c1-64\)" = "\$sha"/);
  assert.match(j, /test "\$\(jq length "\$res\/\$items"\)" = "\$n"/);
  assert.match(j, /scores-\$ver\.json[\s\S]*jq -r \.model[\s\S]*scores-live-recorded\.json/);
  // judge364.py reads the same fields score.mts does.
  const jp = read("peaceai/model/judge364.py");
  for (const k of ["context", "file", "label", "key"]) assert.match(jp, new RegExp(`it\\["${k}"\\]|i\\['${k}'\\]|it\\['${k}'\\]|\\["${k}"\\]`), k);
  // No step reads a judge dir from a default-branch Results clone; only lm-retrain-judge.sh fetches judge items.
  for (const f of [WF, read("peaceai/bin/lm-retrain-live.sh")]) assert.doesNotMatch(f, /sparse-checkout set[^\n]*lm-judge/);
  assert.equal((WF.match(/lm-retrain-judge\.sh "\$RUNNER_TEMP"/g) ?? []).length, 2);
  assert.doesNotMatch(WF, /JUDGE_SET/, "the retrain always scores the configured (v2) set");
  assert.match(read("peaceai/bin/lm-retrain-live.sh"), /lm-retrain-judge\.sh "\$dest" "\$live"/);
  assert.match(read(".github/workflows/peace-lm-judge-v2.yml"), /JUDGE_SET: v1\n/);
  assert.ok(protectedReason("peaceai/bin/lm-retrain-judge.sh"));
});

/**
 * A shell script read the way bash splits words (Auditor #553 review, note b). Returns `code`: the text with comments
 * removed, where '#' starts a comment only outside quotes and at the start of a word; and `bare`: the same code with
 * every quote character and backslash escape removed, so `pu""sh`, `p'u'sh`, `"push"` and `pu\sh` all read `push`.
 * Quoted text is kept (a quoted '#' is not a comment), and a newline inside quotes stays part of the quoted word.
 */
export function shellWords(text: string): { code: string; bare: string } {
  let code = "", bare = "", q: "'" | '"' | null = null;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (q === "'") { code += c; if (c === "'") q = null; else bare += c; continue; }
    if (q === '"') {
      code += c;
      if (c === "\\" && i + 1 < text.length) { const n = text[++i]!; code += n; if (n !== "\n") bare += /[$`"\\]/.test(n) ? n : c + n; continue; }
      if (c === '"') q = null; else bare += c;
      continue;
    }
    if (c === "'" || c === '"') { code += c; q = c; continue; }
    if (c === "\\" && i + 1 < text.length) { const n = text[++i]!; code += c + n; if (n !== "\n") bare += n; continue; }
    if (c === "#" && (i === 0 || /[\s;&|()<>]/.test(text[i - 1]!))) { while (i + 1 < text.length && text[i + 1] !== "\n") i++; continue; }
    code += c; bare += c;
  }
  return { code, bare };
}

/** Problems with a Results-reading script: a push, a Results write, or shell forms the reader cannot follow. */
export function resultsReadOnlyProblems(text: string): string[] {
  const { code, bare } = shellWords(text), out: string[] = [];
  for (const [name, t] of [["code", code], ["dequoted", bare]] as const) {
    if (/\bpush\b/.test(t)) out.push(`${name}: git push`);
    if (/results-write\.sh|\bgit (-C ("[^"]*"|\S+) )?(commit|tag|update-ref|remote set-url)\b|--force|--mirror/.test(t)) out.push(`${name}: Results write`);
  }
  // Forms that build a command word the checks above cannot read are refused outright: eval, ANSI-C $'..' quoting and
  // source / '.' of another file. (A word built from variables, e.g. ${p}sh, is not caught here; the scripts are
  // protected, so review covers that.)
  if (/(^|[\s;&|(])eval\s/m.test(code)) out.push("eval");
  if (/\$'/.test(code)) out.push("ANSI-C quoting");
  if (/(^|[\s;&|(])(source|\.)\s/m.test(code)) out.push("sourced file");
  return out;
}

test("M119 restore and judge-fetch scripts only read Results: no git push, no Results write inside lm-retrain-live.sh or lm-retrain-judge.sh (Auditor follow-up)", () => {
  for (const f of ["peaceai/bin/lm-retrain-live.sh", "peaceai/bin/lm-retrain-judge.sh"]) {
    const text = read(f);
    assert.deepEqual(resultsReadOnlyProblems(text), [], f);
    assert.match(shellWords(text).code, /with-deploy-key\.sh git (clone|-C "\$res" (fetch|sparse-checkout|checkout))/, `${f}: the key is used to read`);
  }
});

test("M119 no-push check: quote splitting, escapes and a '#' inside quotes cannot hide a push or a Results write (Auditor #553 note b)", () => {
  const base = read("peaceai/bin/lm-retrain-judge.sh");
  // Each of these, appended to the real script, is a push or a write bash would run; each must be reported.
  const evasions = [
    'git -C "$res" pu""sh origin HEAD:main',
    "git -C \"$res\" pu''sh origin HEAD:main",
    'git -C "$res" "push" origin',
    "git -C \"$res\" pu\\sh origin",
    'echo "#" ; git -C "$res" push origin',
    "x='#'; git -C \"$res\" push origin",
    'echo "a\n# not a comment" && git push',
    'git -C "$res" co""mmit -qm x',
    'git -C "$res" ta\\g v1',
    './peaceai/bin/results-wr""ite.sh "x"',
    'git -C "$res" fetch --fo""rce',
    "eval \"git -C $res pu\"\"sh\"",
    "git -C \"$res\" $'\\x70ush'",
    ". ./other.sh",
  ];
  for (const e of evasions) assert.notDeepEqual(resultsReadOnlyProblems(`${base}\n${e}\n`), [], e);
  // Real comments still do not count, wherever they sit; quoted text that is only data is not a write.
  for (const ok of ["# git push origin main", "echo hi   # then git push", 'echo "refused: not pushed"', "  # pu\"\"sh"]) assert.deepEqual(resultsReadOnlyProblems(`${base}\n${ok}\n`), [], ok);
  assert.equal(shellWords('a "#b" #c\nd').code, 'a "#b" \nd');
  assert.equal(shellWords("pu\"\"sh p'u'sh pu\\sh").bare, "push push push");
});

// Auditor #536 follow-up: committed fixture test for lm-retrain-judge.sh's refusals. Made-up items and scores in a
// throwaway git repo; the real Results remote URL is redirected to it with url.insteadOf (no network, no real key).
type JudgeOpts = { set?: "v1" | "v2"; items?: number | null; scoresModel?: string | null; pin?: (good: string) => string; sha?: string; ref?: string; key?: boolean; ver?: string; judgeSet?: string };
function judgeFixture(opts: JudgeOpts) {
  const set = opts.set ?? "v2", dir = set === "v1" ? "lm-judge" : "lm-judge-v2";
  const t = mkdtempSync(join(tmpdir(), "m119-judge-"));
  try {
    const env = { ...process.env, GIT_CONFIG_GLOBAL: join(t, "gitconfig"), GIT_CONFIG_NOSYSTEM: "1", RUNNER_TEMP: t, HOME: t } as NodeJS.ProcessEnv;
    delete env.DEPLOY_KEY; delete env.JUDGE_SET;
    const g = (cwd: string, ...a: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "init.defaultBranch=main", ...a], { cwd, env, encoding: "utf8" }).trim();
    const src = join(t, "results");
    mkdirSync(join(src, dir), { recursive: true }); g(src, "init", "-q");
    g(src, "config", "uploadpack.allowAnySHA1InWant", "true"); g(src, "config", "uploadpack.allowFilter", "true");
    const ver = "lm-v1-0123456789ab";
    const itemsText = JSON.stringify(Array.from({ length: opts.items ?? (set === "v1" ? 364 : 230) }, (_, i) => ({ key: `k${i}`, label: i % 2 ? "right" : "wrong" })));
    if (opts.items !== null) writeFileSync(join(src, dir, "items.json"), itemsText);
    if (opts.scoresModel !== null) writeFileSync(join(src, dir, `scores-${ver}.json`), JSON.stringify({ model: opts.scoresModel ?? ver, agg: {} }));
    writeFileSync(join(src, "README.md"), "fixture\n");
    g(src, "add", "."); g(src, "commit", "-qm", "fixture");
    const good = g(src, "rev-parse", "HEAD");
    const sha = opts.sha ?? createHash("sha256").update(itemsText).digest("hex");
    writeFileSync(join(t, "gitconfig"), `[url "file://${src}"]\n\tinsteadOf = git@github.com:PeaceG03/PeaceAI-Results.git\n[protocol "file"]\n\tallow = always\n`);
    const cwd = join(t, "cwd"); mkdirSync(join(cwd, "peaceai", "bin"), { recursive: true }); mkdirSync(join(cwd, "peaceai", "model"), { recursive: true });
    for (const f of ["lm-retrain-judge.sh", "with-deploy-key.sh"]) writeFileSync(join(cwd, "peaceai", "bin", f), read(`peaceai/bin/${f}`), { mode: 0o755 });
    const cfg = JSON.parse(JSON.stringify(CFG));
    if (set === "v1") { cfg.eval.judgeV1.commit = opts.pin ? opts.pin(good) : good; cfg.eval.judgeV1.itemsSha256 = sha; env.JUDGE_SET = "v1"; }
    else { cfg.eval.judgeItemsSha256 = sha; if (opts.ref) cfg.eval.judgeRef = opts.ref; }
    if (opts.judgeSet !== undefined) env.JUDGE_SET = opts.judgeSet;
    writeFileSync(join(cwd, "peaceai", "model", "lm-retrain.json"), JSON.stringify(cfg));
    if (opts.key !== false) env.DEPLOY_KEY = "not-a-real-key";
    const dest = join(t, "dest");
    const r = spawnSync("bash", ["peaceai/bin/lm-retrain-judge.sh", dest, ...(opts.ver === "" ? [] : [opts.ver ?? ver])], { cwd, env, encoding: "utf8" });
    let out: string[] = []; try { out = execFileSync("ls", [dest], { encoding: "utf8" }).split("\n").filter(Boolean); } catch { /* none */ }
    let commit = ""; try { commit = readFileSync(join(dest, "judge-commit.txt"), "utf8").trim(); } catch { /* none */ }
    return { status: r.status, text: r.stdout + r.stderr, out, good, commit };
  } finally { rmSync(t, { recursive: true, force: true }); }
}

test("M119 lm-retrain-judge.sh: control fixtures (v2 from main, v1 by commit) pass and write items + recorded scores + the Results commit", () => {
  for (const set of ["v2", "v1"] as const) {
    const r = judgeFixture({ set });
    assert.equal(r.status, 0, r.text);
    assert.match(r.text, new RegExp(`judge items fetched from the pinned commit: ${set === "v1" ? 364 : 230} \\(set ${set}, Results commit [0-9a-f]{40}\\)`));
    assert.deepEqual(r.out.sort(), ["items.json", "judge-commit.txt", "scores-live-recorded.json"]);
    assert.equal(r.commit, r.good, `${set}: the Results commit read is recorded`);
    assert.doesNotMatch(r.text, /github\.com|file:\/\//, `${set}: no repo URL printed`);
  }
});

test("M119 lm-retrain-judge.sh refuses: not landed, sha or count drift, wrong model, missing scores, ref not main, unknown sha, branch pin, no key", () => {
  const cases: [string, JudgeOpts, RegExp][] = [
    ["v2 not landed yet", { items: null }, /judge items missing at the pinned commit: refused \(not landed yet\?\)/],
    ["v2 items differ from the sha256 pin", { sha: "0".repeat(64) }, /judge items sha256 differs from the pin: refused/],
    ["v2 229 items", { items: 229 }, /judge item count changed: refused/],
    ["v2 wrong model in the scores file", { scoresModel: "lm-v1-ffffffffffff" }, /recorded judge scores are for another model: refused/],
    ["v2 missing scores file", { scoresModel: null }, /recorded judge scores missing for lm-v1-0123456789ab: refused/],
    ["v2 ref is not main", { ref: "notes/lm-judge-eval" }, /judge v2 is read from Results main only: refused/],
    ["v2 bad sha pin", { sha: "abc" }, /bad judge items sha256 pin: refused/],
    ["unknown judge set", { judgeSet: "v3" }, /unknown JUDGE_SET: refused/],
    ["v2 no key", { key: false }, /no Results key: refused \(fail closed\)/],
    ["v1 wrong model in the scores file", { set: "v1", scoresModel: "lm-v1-ffffffffffff" }, /recorded judge scores are for another model: refused/],
    ["v1 missing scores file", { set: "v1", scoresModel: null }, /recorded judge scores missing for lm-v1-0123456789ab: refused/],
    ["v1 missing items file", { set: "v1", items: null }, /judge items missing at the pinned commit: refused/],
    ["v1 363 items", { set: "v1", items: 363 }, /judge item count changed: refused/],
    ["v1 items differ from the sha256 pin", { set: "v1", sha: "1".repeat(64) }, /judge items sha256 differs from the pin: refused/],
    ["v1 unknown sha", { set: "v1", pin: () => "0".repeat(40) }, /judge commit could not be fetched: refused/],
    ["v1 branch name instead of a sha", { set: "v1", pin: () => "notes/lm-judge-eval" }, /bad judge commit pin: refused/],
    ["v1 no key", { set: "v1", key: false }, /no Results key: refused \(fail closed\)/],
  ];
  for (const [name, o, msg] of cases) {
    const r = judgeFixture(o);
    assert.notEqual(r.status, 0, `${name}: must fail\n${r.text}`);
    assert.match(r.text, msg, name);
    assert.doesNotMatch(r.text, /github\.com|file:\/\//, `${name}: no repo URL printed`);
    assert.ok(!r.out.includes("scores-live-recorded.json"), `${name}: no recorded scores written`);
    if (!/missing scores file|wrong model in the scores file/.test(name)) assert.ok(!r.out.includes("items.json"), `${name}: no items written`);
  }
});
