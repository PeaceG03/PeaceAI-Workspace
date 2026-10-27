// Judge gate v1 (Auditor, after #550; spec peaceai/spec/lm-retrain-judge-gate-v1.md): the retrain's judge AUC is
// REPORT-ONLY (full set and non-identity subset, each with its 95% interval). peaceai/model/judge_gate.py makes it a
// hard gate only when configured "hard" AND the live model's lower 95% bound is above 0.5 on both. Made-up summaries.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { protectedReason } from "../lib/selfchange.ts";

const repo = resolve(import.meta.dirname, "..", "..");
const py = process.env.PEACEAI_PYTHON ?? "python3";
const read = (p: string) => readFileSync(join(repo, p), "utf8");
const MODEL = join(repo, "peaceai/model");
const WF = read(".github/workflows/peace-lm-retrain.yml");

type Sum = { model?: string; n?: number; auc_exact: number | null; auc_ci95: number[] | null; nonidentity?: { n: number; auc_exact: number | null; auc_ci95: number[] | null } };
const sum = (auc: number, ci: number[], niAuc: number, niCi: number[] | null): Sum =>
  ({ model: "m", n: 230, auc_exact: auc, auc_ci95: ci, nonidentity: { n: 108, auc_exact: niAuc, auc_ci95: niCi } });

function decide(mode: string, live: unknown, cand: unknown) {
  const r = spawnSync(py, ["-c", "import json,sys; sys.path.insert(0, sys.argv[1]); import judge_gate as g; a = json.load(sys.stdin); print(json.dumps(g.decide(a[0], a[1], a[2])))", MODEL],
    { input: JSON.stringify([mode, live, cand]), encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout) as { configured: string; effective: string; hardEligible: boolean; blocks: boolean; live: { full: { auc_ci95: number[] }; nonidentity: { auc_ci95: number[] } } };
}

const TODAY = sum(0.175, [0.116, 0.237], 0.434, [0.315, 0.564]);   // lm-v1-088073d41dbc on judge set v2
const STRONG = sum(0.8, [0.7, 0.9], 0.75, [0.6, 0.88]);

test("judge gate: report-only never blocks or passes, whatever the AUCs", () => {
  for (const live of [TODAY, STRONG]) for (const cand of [sum(0.01, [0, 0.05], 0.01, [0, 0.05]), sum(0.99, [0.95, 1], 0.99, [0.95, 1])]) {
    const d = decide("report-only", live, cand);
    assert.equal(d.effective, "report-only"); assert.equal(d.blocks, false);
  }
  // Today's live model is not eligible even if configured hard: the judge AUC cannot block.
  const d = decide("hard", TODAY, sum(0.01, [0, 0.05], 0.01, [0, 0.05]));
  assert.equal(d.hardEligible, false); assert.equal(d.effective, "report-only"); assert.equal(d.blocks, false);
  // Both AUCs and both intervals are reported for the live model and the candidate.
  assert.deepEqual(d.live.full.auc_ci95, [0.116, 0.237]); assert.deepEqual(d.live.nonidentity.auc_ci95, [0.315, 0.564]);
});

test("judge gate: hard only when the live model's lower 95% bound is above 0.5 on BOTH the full set and the non-identity subset", () => {
  const lower = sum(0.1, [0.05, 0.2], 0.1, [0.05, 0.2]);
  // Eligible and hard: a lower candidate is blocked, an equal or higher one is not.
  assert.equal(decide("hard", STRONG, lower).blocks, true);
  assert.equal(decide("hard", STRONG, STRONG).blocks, false);
  assert.equal(decide("hard", STRONG, sum(0.81, [0.7, 0.9], 0.1, [0.0, 0.2])).blocks, false, "the hard comparison is on the full-set AUC");
  assert.equal(decide("hard", STRONG, lower).effective, "hard");
  // Not eligible -> report-only: full bound fine but subset bound not, subset fine but full not, exactly 0.5, missing.
  for (const [name, live] of [
    ["subset lower bound below 0.5", sum(0.8, [0.7, 0.9], 0.55, [0.45, 0.65])],
    ["full lower bound below 0.5", sum(0.55, [0.45, 0.65], 0.8, [0.7, 0.9])],
    ["full lower bound exactly 0.5", sum(0.6, [0.5, 0.7], 0.8, [0.7, 0.9])],
    ["subset lower bound exactly 0.5", sum(0.8, [0.7, 0.9], 0.6, [0.5, 0.7])],
    ["subset interval missing", sum(0.8, [0.7, 0.9], 0.8, null)],
    ["no subset", { auc_exact: 0.8, auc_ci95: [0.7, 0.9] }],
    ["full interval malformed", sum(0.8, [0.7] as number[], 0.8, [0.7, 0.9])],
  ] as [string, unknown][]) {
    const d = decide("hard", live, lower);
    assert.equal(d.hardEligible, false, name); assert.equal(d.effective, "report-only", name); assert.equal(d.blocks, false, name);
  }
  // Eligibility comes from the live (reference) model only: a strong candidate cannot make the gate hard.
  assert.equal(decide("hard", TODAY, STRONG).hardEligible, false);
});

test("judge gate: bad mode or input is refused; the CLI reads judge364 --out files", () => {
  const t = mkdtempSync(join(tmpdir(), "m121-gate-"));
  try {
    writeFileSync(join(t, "live.json"), JSON.stringify({ model: "live", summary: STRONG }));
    writeFileSync(join(t, "cand.json"), JSON.stringify({ model: "cand", summary: sum(0.1, [0.05, 0.2], 0.1, [0.05, 0.2]) }));
    const run = (mode: string, cand = "cand.json") => spawnSync(py, [join(MODEL, "judge_gate.py"), "--mode", mode, "--live", join(t, "live.json"), "--candidate", join(t, cand)], { encoding: "utf8" });
    const ok = run("hard"); assert.equal(ok.status, 0, ok.stderr);
    const d = JSON.parse(ok.stdout); assert.equal(d.effective, "hard"); assert.equal(d.blocks, true);
    const ro = JSON.parse(run("report-only").stdout); assert.equal(ro.blocks, false);
    const bad = run("soft"); assert.notEqual(bad.status, 0); assert.match(bad.stderr, /judge gate: bad input \(ValueError\): refused/);
    assert.notEqual(run("hard", "missing.json").status, 0);
  } finally { rmSync(t, { recursive: true, force: true }); }
});

test("judge364: the non-identity subset excludes exactly the `return <param>;` items and reports its AUC with an interval", () => {
  const ctx = (sig: string) => `@@ -1,1 +1,3 @@\nexport function f(${sig}): string {`;
  const items = [
    { key: "a", label: "wrong", context: ctx("s: string, t: string"), derived: "  return s;\n}\n" },      // identity
    { key: "b", label: "wrong", context: ctx("s: string, t: string"), derived: "  return t;\n}\n" },      // identity
    { key: "c", label: "right", context: ctx("s: string"), derived: "  return s.trim();\n}\n" },
    { key: "d", label: "right", context: ctx("s: string"), derived: "  return u;\n}\n" },               // not a parameter
    { key: "e", label: "wrong", context: ctx("n: number"), derived: "  return n + 1;\n}\n" },
    { key: "f", label: "right", context: ctx("sx: string"), derived: "  return s;\n}\n" },              // s is not sx
  ];
  const mean: Record<string, number> = { a: 5, b: 4, c: 3, d: 2, e: 1, f: 0 };
  const agg = Object.fromEntries(items.map((i) => [`${i.key}:derived`, { mean: mean[i.key] }]));
  const r = spawnSync(py, ["-c", "import json,sys; sys.path.insert(0, sys.argv[1]); import judge364 as j; a = json.load(sys.stdin); print(json.dumps([[j.identity_program(i) for i in a[0]], j.auc_summary([i for i in a[0] if not j.identity_program(i)], a[1]), j.auc_summary(a[0], a[1]), j.auc_summary(a[0][:2], a[1])]))", MODEL],
    { input: JSON.stringify([items, agg]), encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  const [ids, ni, full, onlyWrong] = JSON.parse(r.stdout);
  assert.deepEqual(ids, [true, true, false, false, false, false]);
  assert.equal(ni.n, 4); assert.equal(ni.right, 3); assert.equal(ni.wrong, 1);
  assert.ok(Math.abs(ni.auc_exact - 2 / 3) < 1e-9); assert.equal(ni.auc_ci95.length, 2);
  assert.equal(full.n, 6); assert.ok(Math.abs(full.auc_exact - 2 / 9) < 1e-9);
  assert.deepEqual(onlyWrong, { n: 2, right: 0, wrong: 2, auc_exact: null, auc_ci95: null });
  const jp = read("peaceai/model/judge364.py");
  assert.match(jp, /"nonidentity": auc_summary\(\[i for i in items if not identity_program\(i\)\], agg\)/);
});

test("judge gate: the retrain wires judge_gate.py report-only and records both AUCs; bpb and the scorer stay hard", () => {
  const CFG = JSON.parse(read("peaceai/model/lm-retrain.json"));
  assert.equal(CFG.eval.judgeAucGate, "report-only");
  assert.match(WF, /python3 peaceai\/model\/judge_gate\.py --mode "\$\(jq -r \.eval\.judgeAucGate "\$CFG"\)"/);
  assert.match(WF, /ge "\$\(bpb live\)" "\$\(bpb model\)" \|\| \{ ok=false; why\+=\(setc_bpb\); \}/);
  assert.match(WF, /why\+=\(judge_scorer_not_reproduced\)/);
  assert.match(WF, /nonidentity: \.judge\.live\.nonidentity\.auc_exact, nonidentity95: \.judge\.live\.nonidentity\.auc_ci95/);
  assert.match(WF, /full95: \.judge\.candidate\.auc_ci95/);
  assert.match(WF, /schema: "peaceai-lm-retrain-record:v4"/);  // M122: v4 adds ftPrepare and replay (the judge fields are unchanged from v3)
  const spec = read("peaceai/spec/lm-retrain-judge-gate-v1.md");
  for (const s of ["REPORT-ONLY", "strictly above 0.5 on the full set AND on\n   the non-identity subset", "live (reference) model"]) assert.ok(spec.includes(s), s);
  for (const f of ["peaceai/model/judge_gate.py", "peaceai/spec/lm-retrain-judge-gate-v1.md", "peaceai/test/m121-judge-gate.test.ts"]) assert.ok(protectedReason(f), f);
});
