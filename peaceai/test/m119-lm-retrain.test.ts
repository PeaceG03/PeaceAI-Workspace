// M119 (LM retrain on free GitHub-hosted minutes, Builder + Auditor): the reviewed commit list is pinned, the corpus is
// deduplicated against every eval item, the judge scorer matches lm.ts, the core-free proof accepts builder-log row docs
// only as exact lines, and the workflow carries the Auditor's gate (same-run scores, 0 overlap, AUC >= live, Results
// only, strict memcheck, no promotion).
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { diffScoreItems, ftManifestEntryProblem } from "../lib/lm.ts";
import { protectedReason } from "../lib/selfchange.ts";

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
  for (const s of [97, 99, 101]) assert.ok(!rows.some((r) => r.includes(` seq=${s} `)), `un-credited row ${s} is not listed`);
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
    { doc: 9, text: "clean doc one" }, { doc: 11, text: "clean doc two" },
  ];
  w("setc", setc); w("ft", train, train.map((t) => ({ doc: t.doc, split: t.doc === 11 ? "heldout" : "train" })));
  writeFileSync(join(d, "items.json"), JSON.stringify([{ key: "k1", context: "return ", derived: "alpha + beta * gamma - delta ;", reference: "zzz", label: "wrong" }]));
  writeFileSync(join(d, "drop.txt"), "9\n");
  const run = (extra: string[]) => spawnSync(py, [join(repo, "peaceai/model/eval_dedup.py"), "--corpus", join(d, "ft"), "--setc", join(d, "setc"), "--judge", join(d, "items.json"), "--out", join(d, "out"), "--report", join(d, "rep.json"), ...extra], { encoding: "utf8" });
  const r = run(["--drop", join(d, "drop.txt")]);
  assert.equal(r.status, 0, r.stderr);
  const rep = JSON.parse(readFileSync(join(d, "rep.json"), "utf8"));
  assert.equal(rep.overlapDocs, 3); assert.equal(rep.overlapDocsSetC, 2); assert.equal(rep.overlapDocsJudge, 1);
  assert.equal(rep.byMethod.setc_exact, 1); assert.equal(rep.byMethod.setc_window, 1); assert.equal(rep.byMethod.judge_short, 1);
  assert.equal(rep.droppedByList, 1); assert.equal(rep.recheckOverlapDocs, 0); assert.equal(rep.docsOut, 2);
  const kept = readFileSync(join(d, "out", "docs.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l).doc);
  assert.deepEqual(kept, [7, 11], "ids unchanged; overlaps and listed ids gone");
  assert.equal(rep.outManifestSha256, H(readFileSync(join(d, "out", "manifest.jsonl"))));
  assert.doesNotMatch(r.stdout, /exactCopy|alpha|tok\d/, "counts only on stdout");
  writeFileSync(join(d, "drop.txt"), "4\n");
  assert.notEqual(run(["--drop", join(d, "drop.txt")]).status, 0, "an unknown drop id is refused");
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
  assert.match(WF, /^on:\n  workflow_dispatch:\n\npermissions: \{\}\n/m);
  assert.doesNotMatch(WF, /pull_request|workflow_run:|schedule:/);
  assert.doesNotMatch(WF, /upload-artifact|actions\/cache|download-artifact/, "no artifacts, no caches");
  assert.doesNotMatch(WF, /self-hosted/); assert.equal((WF.match(/runs-on: ubuntu-24\.04/g) ?? []).length, 4);
  // Every key-using step is directly preceded by the checkout / key-script verification.
  const steps = WF.split(/\n      - /);
  steps.forEach((s, i) => { if (/secrets\./.test(s)) assert.match(steps[i - 1]!, /^name: Verify the checkout/, `step before "${s.split("\n")[0]}" verifies the checkout`); });
  // Pins identical to the M49 workflow (results) and the post-train memcheck (core).
  const m49 = read(".github/workflows/peace-lm-train-m49.yml"), mc = read(".github/workflows/m49-posttrain-memcheck.yml");
  for (const l of /LANDING_SHA256: \|-\n((?: {4}.+\n)+)/.exec(m49)![1]!.trim().split("\n")) assert.ok(WF.includes(l.trim()));
  for (const l of /LANDING_SHA256: \|-\n((?: {4}.+\n)+)/.exec(mc)![1]!.trim().split("\n")) assert.ok(WF.includes(l.trim()));
  // Gate 1 + 3: both models scored in this run on the same pinned slice and the same judge items; AUC >= live.
  assert.match(WF, /for who in live model; do\n.*eval_c\.py --model "\$RUNNER_TEMP\/\$who"[^\n]*--max-bytes "\$mb"[\s\S]*?judge364\.py --model "\$RUNNER_TEMP\/\$who"/);
  assert.match(WF, /\[ "\$\(sl live\)" = "\$want" \] && \[ "\$\(sl model\)" = "\$want" \]/);
  assert.match(WF, /float\(sys\.argv\[1\]\) >= float\(sys\.argv\[2\]\)[^\n]*"\$\(a model\)" "\$\(a live\)"/);
  assert.equal(CFG.eval.setcMaxBytes, 1000000); assert.equal(CFG.eval.judgeItemCount, 364); assert.equal(CFG.live.version, "lm-v1-088073d41dbc");
  // Gate 2: dedup before training and 0 overlap after.
  assert.ok(WF.indexOf("lm-retrain-corpus.sh") < WF.indexOf("peaceai/model/train.py"));
  assert.match(WF, /recheckOverlapDocs "\$RUNNER_TEMP\/w\/dedup\.json"\)" = 0/);
  // Gate 4: the live model is the one in latest.json with matching weights; strict memcheck rule.
  assert.match(WF, /test "\$\(jq -r \.version "\$res\/models\/lm\/latest\.json"\)" = "\$live"/);
  assert.match(WF, /lm-v1-\$\(sha256sum "\$L\/weights\.npz" \| cut -c1-12\)" = "\$live"/);
  const mcJob = WF.slice(WF.indexOf("\n  retrain-memcheck:"), WF.indexOf("\n  record-memcheck:"));
  assert.doesNotMatch(mcJob, /PEACEAI_LM_TRAIN_CORPUS|PEACEAI_LM_FT_CORPUS/, "no training corpus given: the strict 32-character rule");
  assert.match(mcJob, /substringRule "\$M"\)" = strict/);
  assert.doesNotMatch(WF, /trainedOn/);
  // Gate 5: latest.json is only ever read; landings are path-checked to the run record and the model dir.
  for (const l of WF.split("\n").filter((x) => x.includes("latest.json"))) assert.doesNotMatch(l, /cp |> |mv |tee /, "latest.json is never written");
  assert.match(WF, /landing refused: path outside the run record and model dir/);
  assert.match(WF, /if \[ "\$PASS" = true \]; then d="\$RESULTS_DIR\/models\/lm\/\$v"/, "the candidate lands only on gate PASS");
});

test("M119: every new file is protected", () => {
  for (const f of [".github/workflows/peace-lm-retrain.yml", "peaceai/bin/lm-retrain-corpus.sh", "peaceai/model/lm-retrain.json", "peaceai/model/lm-retrain-commits.txt",
    "peaceai/model/retrain_list.py", "peaceai/model/eval_dedup.py", "peaceai/model/judge364.py", "peaceai/test/m119-lm-retrain.test.ts"]) assert.ok(protectedReason(f), f);
});
