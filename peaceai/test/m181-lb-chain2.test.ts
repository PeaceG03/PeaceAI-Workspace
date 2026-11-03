// M181 lb-chain2 v1 (spec peaceai/spec/lb-chain2-v1.md; Auditor #673 binding conditions): chain 2 is a NEW lb-daily
// chain on the lb-corpus v2 that warm-starts from chain 1's final save. Tested here, each with a killed mutant and a
// near miss that passes:
//  - build isolation: the corpus is built only in the c2-corpus job of peace-lb-chain2.yml (no environment, no secrets,
//    contents: read; lb-chain2-corpus.sh refuses to start with a secret-like variable set), and the c2-train job never
//    runs node and checks docs, manifest and fingerprint.json against the protected pins before any secret step
//    (lb_chain2.py pins; chain2Problems, itself mutation-tested);
//  - a sha mismatch anywhere fails closed (the built corpus, the warm-start save, the day-3 row, the trusted record, the
//    resume save);
//  - the warm-start pin is checked (lb_chain2.py config / trusted / restore, train.py --warm-start-from + warmstart.py:
//    every tagged ws-* guard), the new chain never reuses chain 1's id, the held-out split is the days-1-3 one (the row's
//    heldoutTokens / heldBytes equal the day-3 row's) and heldout_v2 is reported separately.
// Every tagged lb_chain2.py guard (c2-*) and warmstart.py guard (ws-*) has a case whose outcome must change when the
// guard is disabled. The stdlib-only lb_chain2.py runs with numpy blocked; train.py / export.py / eval_v2.py keep numpy.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { json, MODEL, py, repo, tinyCorpus, withDir } from "./m157-lbtrain-mut.ts";
import { noNumpyEnv } from "./nonumpy.ts";

const WF = ".github/workflows/peace-lb-chain2.yml";
const read = (p: string) => readFileSync(join(repo, p), "utf8");
const sha = (p: string) => createHash("sha256").update(readFileSync(p)).digest("hex");
const shaText = (t: string) => createHash("sha256").update(t).digest("hex");
const CFG = json(join(MODEL, "lb-train.json"));
const PLAN = json(join(MODEL, "lb-corpus2.json"));
const SHA40 = "0123456789abcdef0123456789abcdef01234567";
const D1 = "2026-11-04", D2 = "2026-11-05";
const now = () => Math.floor(Date.now() / 1000);
const pinsOf = (c: string) => ({ docs: sha(join(c, "docs.jsonl")), manifest: sha(join(c, "manifest.jsonl")), fingerprint: json(join(c, "fingerprint.json")).fingerprint });
const TINY_TRAIN: Record<string, string> = { "--d-model": "16", "--n-layer": "1", "--n-head": "2", "--ctx": "32", "--vocab": "300", "--batch": "2", "--threads": "1",
  "--eval-every": "2", "--steps": "8", "--max-steps-this-run": "4", "--patience": "5", "--optimizer": "adamw8bit", "--curriculum": "easy_to_hard", "--val-split": "disjoint" };
const trainArgs = (t: Record<string, string>) => Object.entries(t).flat();
let uniq = 0;
const u = (p: string) => `${p}-${(uniq += 1)}`;

// ---- the shared fixture: a tiny chain 1 (one finished save + its exported eval), the chain-2 corpus, the configs ----

const FIX = mkdtempSync(join(tmpdir(), "m181-fx-"));
process.on("exit", () => rmSync(FIX, { recursive: true, force: true }));
type Fx = { c1: string; w1: string; save: string; msha: string; man: any; ev: any; c2: string; pins2: Record<string, string>; fpText: string;
  warmRow: any; warmText: string; cfg: any; plan: any; H: number; B: number; warm: Record<string, string> };
let FXC: Fx | null = null;
function fx(): Fx {
  if (FXC) return FXC;
  const c1 = tinyCorpus(FIX, { bigHeld: true, name: "c1" });
  const w1 = join(FIX, "w1"), s1 = join(FIX, "s1"), m1 = join(FIX, "m1.json");
  const t1: Record<string, string> = { ...TINY_TRAIN, "--steps": "4" }; delete t1["--max-steps-this-run"];
  const r = spawnSync(py, [join(MODEL, "train.py"), ...trainArgs(t1), "--corpus", c1, "--work", w1, "--save-dir", s1, "--marker", m1], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  const e = spawnSync(py, [join(MODEL, "export.py"), "--work", w1, "--out", join(w1, "model"), "--threads", "1"], { encoding: "utf8" });
  assert.equal(e.status, 0, e.stderr);
  const ev = json(join(w1, "model/eval.json")), mk = json(m1);
  const save = join(s1, mk.save), man = json(join(save, "manifest.json"));
  // the chain-2 corpus: chain 1's docs and split + 20 new train docs + 10 heldout_v2 docs (the v2 shape)
  const c2 = join(FIX, "c2"); mkdirSync(c2);
  const docs = readFileSync(join(c1, "docs.jsonl"), "utf8").trimEnd().split("\n"), mf = readFileSync(join(c1, "manifest.jsonl"), "utf8").trimEnd().split("\n");
  for (let i = 160; i < 190; i += 1) {
    docs.push(JSON.stringify({ doc: i, text: `export const g${i} = (y: string): string => y + "${i}";\n` }));
    mf.push(JSON.stringify({ doc: i, split: i >= 180 ? "heldout_v2" : "train", difficulty: { score: 10, level: "easy" } }));
  }
  writeFileSync(join(c2, "docs.jsonl"), docs.join("\n") + "\n"); writeFileSync(join(c2, "manifest.jsonl"), mf.join("\n") + "\n");
  const fpText = JSON.stringify({ fingerprint: "d".repeat(64) }) + "\n";
  writeFileSync(join(c2, "fingerprint.json"), fpText);
  const pins2 = pinsOf(c2);
  const H = ev.heldout_tokens, B = ev.held_bytes;
  const warmRow = { schema: "peaceai-lb-daily-run:v2", runId: "901", workflowSha: SHA40, chainId: "900", today: "2026-11-03", pins: { ...CFG.dailyRun.corpus },
    status: "trained", startStep: 0, endStep: mk.step, stopReason: mk.stopReason, heldoutBpb: ev.model_bits_per_byte, baselineBpb: ev.unigram_bits_per_byte,
    wallSeconds: 10, resumedFrom: null, marker: mk, modelCe: ev.model_ce, heldoutTokens: H, heldBytes: B };
  const warmText = JSON.stringify(warmRow, null, 1) + "\n";
  const warm = { fromChain: "900", save: mk.save, manifestSha256: mk.manifestSha256 };
  const cfg = structuredClone(CFG);
  cfg.dailyRun.train = { ...TINY_TRAIN };
  cfg.clearedCorpora.push({ ...pins2 });
  Object.assign(cfg.chain2Run, { corpus: { ...pins2 }, fingerprintFileSha256: shaText(fpText), train: { ...TINY_TRAIN } });
  Object.assign(cfg.chain2Run.warmStart, { ...warm, cfgSha256: mk.cfgSha256, resultsRow: "runs/lb-daily/2026-11-03-901.json", resultsRowSha256: shaText(warmText),
    heldoutTokens: H, heldBytes: B, heldoutBpb: ev.model_bits_per_byte, baselineBpb: ev.unigram_bits_per_byte });
  const plan = structuredClone(PLAN);
  Object.assign(plan.build, { docsSha256: pins2.docs, manifestSha256: pins2.manifest, fingerprint: pins2.fingerprint });
  Object.assign(plan.chain2.warmStart, { ...warm, resultsRow: "runs/lb-daily/2026-11-03-901.json" });
  FXC = { c1, w1, save, msha: mk.manifestSha256, man, ev, c2, pins2, fpText, warmRow, warmText, cfg, plan, H, B, warm };
  return FXC;
}

/** When set, c2root / wsCopy install this mutated file (the mutation check). */
let MUTANT: { file: string; text: string } | null = null;

/** root/model (peaceai/model with the fixture's lb-train.json, lb-corpus2.json, fingerprint file, edited) + root/bin. */
function c2root(dir: string, o: { cfg?: (c: any) => void; plan?: (p: any) => void; fp?: string } = {}) {
  const f = fx(), root = join(dir, u("pkg"));
  mkdirSync(join(root, "model"), { recursive: true }); mkdirSync(join(root, "bin"));
  for (const n of readdirSync(MODEL).filter((x) => x.endsWith(".py") || x.endsWith(".json"))) copyFileSync(join(MODEL, n), join(root, "model", n));
  for (const n of ["lb-daily-cycle.sh", "lb-chain2-run.sh"]) copyFileSync(join(repo, "peaceai/bin", n), join(root, "bin", n));
  if (MUTANT) writeFileSync(join(root, "model", MUTANT.file), MUTANT.text);
  const cfg = structuredClone(f.cfg), plan = structuredClone(f.plan);
  o.cfg?.(cfg); o.plan?.(plan);
  writeFileSync(join(root, "model/lb-train.json"), JSON.stringify(cfg));
  writeFileSync(join(root, "model/lb-corpus2.json"), JSON.stringify(plan));
  writeFileSync(join(root, "model/lb-corpus2-fingerprint.json"), o.fp ?? f.fpText);
  return root;
}
const c2 = (o: (c: any) => void) => ({ cfg: (c: any) => o(c.chain2Run) });

const lc = (root: string, args: string[], env: Record<string, string> = {}) => {
  const r = spawnSync(py, [join(root, "model/lb_chain2.py"), ...args], { encoding: "utf8", env: { ...process.env, ...noNumpyEnv(), GITHUB_OUTPUT: "", ...env } });
  return { status: r.status, out: r.stdout.trim(), err: r.stderr, last: (r.stdout.trim() || r.stderr.trim()).split("\n").pop()! };
};

/** A copy of the built corpus (the artifact as download-artifact leaves it), optionally edited. */
function artifact(dir: string, edit: (d: string) => void = () => {}) {
  const d = join(dir, u("lbc2")); mkdirSync(d);
  for (const n of ["docs.jsonl", "manifest.jsonl", "fingerprint.json"]) copyFileSync(join(fx().c2, n), join(d, n));
  edit(d);
  return d;
}

const marker = (step: number, save: string, more = true, msha = "a".repeat(64)) =>
  ({ schema: "peaceai-lm-chain:v1", more, stopReason: more ? "deadline" : "patience", step, totalSteps: step, save, manifestSha256: msha, cfgSha256: "c".repeat(64) });
const ceFor = (bpb: number, tokens: number, bytes: number) => (bpb * Math.LN2 * bytes) / tokens;
const v2 = (o: Record<string, unknown> = {}) => ({ bpb: 3.2, baselineBpb: 2.9, modelCe: ceFor(3.2, 320, 700), tokens: 320, bytes: 700, windows: 10, docs: 10, ...o });
/** A valid chain-2 row (day 1: warm, startStep 0) for the fixture. */
const c2Row = (o: Record<string, unknown> = {}): Record<string, unknown> => {
  const f = fx();
  return { schema: "peaceai-lb-chain2-run:v1", runId: "555", workflowSha: SHA40, chainId: "555", today: D1, pins: { ...f.pins2 }, status: "trained", startStep: 0,
    endStep: 4, stopReason: "deadline", heldoutBpb: 3.0, baselineBpb: 2.5, wallSeconds: 100, resumedFrom: null, marker: marker(4, "save-000000004"),
    modelCe: ceFor(3.0, f.H, f.B), heldoutTokens: f.H, heldBytes: f.B, warmStart: { ...f.warm }, heldoutV2: v2(), ...o };
};
const day2Row = (o: Record<string, unknown> = {}) => c2Row({ runId: "556", today: D2, startStep: 4, endStep: 8, resumedFrom: "a".repeat(64), marker: marker(8, "save-000000008"), ...o });

/** A Results dir: the pinned day-3 row (text) + chain-2 rows (name -> row). */
function results(dir: string, rows: Record<string, unknown> = {}, warmText = fx().warmText) {
  const res = join(dir, u("res")); mkdirSync(join(res, "runs/lb-daily"), { recursive: true });
  writeFileSync(join(res, "runs/lb-daily/2026-11-03-901.json"), warmText);
  if (Object.keys(rows).length) mkdirSync(join(res, "runs/lb-chain2"));
  for (const [n, r] of Object.entries(rows)) writeFileSync(join(res, "runs/lb-chain2", n), JSON.stringify(r));
  return res;
}
const trusted = (root: string, res: string, today = D1) => lc(root, ["trusted", "--out", join(res, "..", u("trusted") + ".json"), "--today", today], { RESULTS_DIR: res });
function trustedFile(dir: string, t: Record<string, unknown>) {
  const f = join(dir, u("t") + ".json"); const body = JSON.stringify(t) + "\n"; writeFileSync(f, body);
  return { f, sha: shaText(body) };
}
const warmT = (w: Record<string, string> = fx().warm) => ({ kind: "warm", chainId: null, marker: null, row: null, warm: { ...w } });
const resumeT = (msha: string, step = 4, save = "save-000000004") => ({ kind: "resume", chainId: "555", marker: marker(step, save, true, msha), row: `${D1}-555.json`, warm: null });
/** STATE (empty, or holding saves name -> manifest text) and WARM (empty, or holding the fixture's warm save / extra names). */
function stateWith(dir: string, saves: Record<string, string> = {}, chain?: unknown) {
  const s = join(dir, u("state")); mkdirSync(join(s, "saves"), { recursive: true });
  for (const [n, m] of Object.entries(saves)) { mkdirSync(join(s, "saves", n)); writeFileSync(join(s, "saves", n, "manifest.json"), m); }
  if (chain !== undefined) writeFileSync(join(s, "chain.json"), JSON.stringify(chain));
  return s;
}
function warmWith(dir: string, o: { save?: boolean; extra?: string } = {}) {
  const w = join(dir, u("lbw")); mkdirSync(w);
  if (o.save !== false) cpSync(fx().save, join(w, fx().warm.save), { recursive: true });
  if (o.extra) mkdirSync(join(w, o.extra));
  return w;
}
const restore = (root: string, t: { f: string; sha: string }, s: string, w: string, shaArg = t.sha) =>
  lc(root, ["restore", "--trusted", t.f, "--trusted-sha", shaArg, "--state", s, "--warm", w]);
const cycleArgs = (root: string, t: { f: string; sha: string }, start: string, w = "/w") =>
  lc(root, ["cycle-args", "--trusted", t.f, "--trusted-sha", t.sha, "--job-start", start, "--warm", w]);

/** A finished day in STATE (report, chain.json, the new save, eval-v2.json) as lb-chain2-run.sh leaves it, then row. */
function rowCase(dir: string, root: string, o: { kind?: "warm" | "resume"; report?: Record<string, unknown>; tamper?: boolean; uploaded?: string; ev2?: Record<string, unknown> } = {}) {
  const f = fx(), save = "save-000000008", man = `{"step":8}`;
  const s = stateWith(dir, { [save]: man }); const msha = shaText(man);
  const kind = o.kind ?? "resume";
  writeFileSync(join(s, "chain.json"), JSON.stringify(marker(8, save, true, msha)));
  mkdirSync(join(s, "reports")); mkdirSync(join(s, "work", D2, "model"), { recursive: true });
  writeFileSync(join(s, "reports", `${D2}.json`), JSON.stringify({ status: "trained", startStep: kind === "resume" ? 4 : 0, endStep: 8, stopReason: "deadline",
    eval: { model_bits_per_byte: 3.0, unigram_bits_per_byte: 2.5, model_ce: ceFor(3.0, f.H, f.B), heldout_tokens: f.H, held_bytes: f.B }, corpus: { ...f.pins2 }, ...o.report }));
  writeFileSync(join(s, "work", D2, "model/eval-v2.json"), JSON.stringify({ docs: 10, heldout_tokens: 320, windows: 10, held_bytes: 700, model_ce: ceFor(3.2, 320, 700),
    model_bits_per_byte: 3.2, unigram_bits_per_byte: 2.9, ...o.ev2 }));
  if (o.tamper) writeFileSync(join(s, "saves", save, "manifest.json"), `{"step":9}`);
  const t = trustedFile(dir, kind === "resume" ? resumeT("b".repeat(64)) : warmT());
  const outFile = join(dir, u("row") + ".json");
  return { ...lc(root, ["row", "--trusted", t.f, "--trusted-sha", t.sha, "--state", s, "--today", D2, "--run-id", "556", "--sha", SHA40, "--job-start", String(now() - 100),
    "--uploaded", o.uploaded ?? `${save}:${msha}`, "--out", outFile]), outFile };
}
const land = (dir: string, root: string, row: unknown, o: { runId?: string; res?: string; today?: string } = {}) => {
  const f = join(dir, u("in") + ".json"); writeFileSync(f, JSON.stringify(row));
  const res = o.res ?? results(dir);
  return { ...lc(root, ["land", "--row", f, "--run-id", o.runId ?? "555", "--today", o.today ?? D1], { RESULTS_DIR: res }), res };
};
const cfgL = (root: string) => lc(root, ["config"]).last;
const pinsL = (root: string, d: string) => lc(root, ["pins", "--corpus", d]).last;
const withWarmRow = (dir: string, edit: (r: any) => void) => {
  const r = structuredClone(fx().warmRow); edit(r); const text = JSON.stringify(r, null, 1) + "\n";
  return { root: c2root(dir, c2((c) => { c.warmStart.resultsRowSha256 = shaText(text); })), res: results(dir, {}, text) };
};

/** One case per tagged lb_chain2.py guard: dir -> the outcome (last output line). */
const CASES: Record<string, (dir: string) => string> = {
  "c2-ref": (d) => lc(c2root(d), ["ref", "--ref", "refs/heads/dev"]).last,
  "c2-enabled": (d) => cfgL(c2root(d, { plan: (p) => { p.chain2.enabled = false; } })),
  "c2-config-pins": (d) => cfgL(c2root(d, c2((c) => { c.corpus.docs = "1".repeat(64); }))),
  "c2-config-fp-file": (d) => cfgL(c2root(d, c2((c) => { c.fingerprintFileSha256 = "2".repeat(64); }))),
  "c2-cleared": (d) => cfgL(c2root(d, { cfg: (c) => { c.clearedCorpora = c.clearedCorpora.filter((x: any) => x.docs !== fx().pins2.docs); } })),
  "c2-new-pins": (d) => cfgL(c2root(d, { cfg: (c) => { c.dailyRun.corpus.docs = fx().pins2.docs; } })),
  "c2-warm-plan": (d) => cfgL(c2root(d, { plan: (p) => { p.chain2.warmStart.save = "save-000000005"; } })),
  "c2-warm-values": (d) => cfgL(c2root(d, c2((c) => { c.warmStart.heldoutTokens = String(fx().H); }))),
  "c2-setting-forbidden": (d) => cfgL(c2root(d, c2((c) => { c.train["--warm-start-from"] = "x"; }))),
  "c2-setting-allowed": (d) => cfgL(c2root(d, c2((c) => { c.train["--bogus"] = "1"; }))),
  "c2-setting-values": (d) => cfgL(c2root(d, c2((c) => { c.train["--lr"] = "1;rm"; }))),
  "c2-val-split": (d) => cfgL(c2root(d, c2((c) => { delete c.train["--val-split"]; }))),
  "c2-shape": (d) => cfgL(c2root(d, c2((c) => { c.train["--d-model"] = "24"; }))),
  "c2-deadline-cap": (d) => cfgL(c2root(d, c2((c) => { c.jobTimeoutMin = 360; }))),
  "c2-folders": (d) => cfgL(c2root(d, c2((c) => { c.r2Folder = "lb-train"; }))),
  "c2-pins-files": (d) => pinsL(c2root(d), artifact(d, (a) => writeFileSync(join(a, "extra.txt"), "x"))),
  "c2-pins-regular": (d) => pinsL(c2root(d), artifact(d, (a) => { rmSync(join(a, "docs.jsonl")); symlinkSync(join(fx().c2, "docs.jsonl"), join(a, "docs.jsonl")); })),
  "c2-pins-docs": (d) => pinsL(c2root(d), artifact(d, (a) => writeFileSync(join(a, "docs.jsonl"), readFileSync(join(a, "docs.jsonl"), "utf8") + '{"doc":999,"text":"x"}\n'))),
  "c2-pins-manifest": (d) => pinsL(c2root(d), artifact(d, (a) => writeFileSync(join(a, "manifest.jsonl"), readFileSync(join(a, "manifest.jsonl"), "utf8").replace('"split":"train"', '"split":"heldout"')))),
  "c2-pins-fingerprint-file": (d) => pinsL(c2root(d), artifact(d, (a) => writeFileSync(join(a, "fingerprint.json"), JSON.stringify({ fingerprint: "d".repeat(64) }, null, 2) + "\n"))),
  "c2-pins-fingerprint": (d) => {
    const fp = JSON.stringify({ fingerprint: "7".repeat(64) }) + "\n";
    return pinsL(c2root(d, { fp, ...c2((c) => { c.fingerprintFileSha256 = shaText(fp); }) }), artifact(d, (a) => writeFileSync(join(a, "fingerprint.json"), fp)));
  },
  "c2-warm-row-symlink": (d) => {
    const res = results(d), real = join(d, u("real")); cpSync(join(res, "runs/lb-daily"), real, { recursive: true });
    rmSync(join(res, "runs/lb-daily"), { recursive: true }); symlinkSync(real, join(res, "runs/lb-daily"));
    return trusted(c2root(d), res).last;
  },
  "c2-warm-row-sha": (d) => trusted(c2root(d), results(d, {}, fx().warmText + "\n")).last,
  "c2-warm-row-marker": (d) => { const x = withWarmRow(d, (r) => { r.marker.save = "save-000000099"; }); return trusted(x.root, x.res).last; },
  "c2-warm-row-chain": (d) => { const x = withWarmRow(d, (r) => { r.marker.more = true; }); return trusted(x.root, x.res).last; },
  "c2-warm-row-split": (d) => trusted(c2root(d, c2((c) => { c.warmStart.heldBytes = fx().B + 1; })), results(d)).last,
  "c2-row-fields": (d) => land(d, c2root(d), { ...c2Row(), extra: 1 }).last,
  "c2-row-schema": (d) => land(d, c2root(d), c2Row({ schema: "peaceai-lb-chain2-run:v0" })).last,
  "c2-row-warm": (d) => land(d, c2root(d), c2Row({ warmStart: { ...fx().warm, save: "save-000000003" } })).last,
  "c2-row-new-chain": (d) => land(d, c2root(d), c2Row({ chainId: "900" })).last,
  "c2-row-same-split": (d) => land(d, c2root(d), c2Row({ heldoutTokens: fx().H + 10, modelCe: ceFor(3.0, fx().H + 10, fx().B) })).last,
  "c2-row-v2": (d) => land(d, c2root(d), c2Row({ heldoutV2: v2({ docs: 0 }) })).last,
  "c2-row-v2-bpb": (d) => land(d, c2root(d), c2Row({ heldoutV2: v2({ bpb: 3.3 }) })).last,
  "c2-record-name": (d) => trusted(c2root(d), results(d, { [`${D1}-554.json`]: c2Row() }), D2).last,
  "c2-once": (d) => trusted(c2root(d), results(d, { [`${D1}-555.json`]: c2Row() }), D1).last,
  "c2-one-chain": (d) => trusted(c2root(d), results(d, { [`${D1}-555.json`]: c2Row(), [`${D2}-556.json`]: day2Row({ chainId: "556" }) }), "2026-11-06").last,
  "c2-first-row-warm": (d) => trusted(c2root(d), results(d, { [`${D2}-556.json`]: day2Row({ chainId: "556" }) }), "2026-11-06").last,
  "c2-trusted-sha": (d) => restore(c2root(d), trustedFile(d, warmT()), stateWith(d), warmWith(d), "f".repeat(64)).last,
  "c2-restore-warm-config": (d) => restore(c2root(d), trustedFile(d, warmT({ ...fx().warm, save: "save-000000005" })), stateWith(d), warmWith(d)).last,
  "c2-warm-state-empty": (d) => restore(c2root(d), trustedFile(d, warmT()), stateWith(d, { "save-000000001": "{}" }), warmWith(d)).last,
  "c2-warm-save-set": (d) => restore(c2root(d), trustedFile(d, warmT()), stateWith(d), warmWith(d, { extra: "save-000000002" })).last,
  "c2-warm-cfg": (d) => restore(c2root(d, c2((c) => { c.warmStart.cfgSha256 = "3".repeat(64); })), trustedFile(d, warmT()), stateWith(d), warmWith(d)).last,
  "c2-resume-no-warm": (d) => { const m = `{"step":4}`; return restore(c2root(d), trustedFile(d, resumeT(shaText(m))), stateWith(d, { "save-000000004": m }), warmWith(d)).last; },
  "c2-only-trusted-save": (d) => { const m = `{"step":4}`; return restore(c2root(d), trustedFile(d, resumeT(shaText(m))), stateWith(d, { "save-000000004": m, "save-000000002": "{}" }), warmWith(d, { save: false })).last; },
  "c2-save-sha": (d) => restore(c2root(d), trustedFile(d, resumeT("b".repeat(64))), stateWith(d, { "save-000000004": `{"step":4}` }), warmWith(d, { save: false })).last,
  "c2-chain-absent": (d) => { const m = `{"step":4}`; return restore(c2root(d), trustedFile(d, resumeT(shaText(m))), stateWith(d, { "save-000000004": m }, { x: 1 }), warmWith(d, { save: false })).last; },
  "c2-job-start": (d) => cycleArgs(c2root(d), trustedFile(d, warmT()), "abc").last,
  "c2-budget": (d) => cycleArgs(c2root(d), trustedFile(d, warmT()), String(now() - 299 * 60)).last,
  "c2-report-trained": (d) => rowCase(d, c2root(d), { report: { status: "error" } }).last,
  "c2-row-save-sha": (d) => rowCase(d, c2root(d), { tamper: true, uploaded: `save-000000008:${shaText(`{"step":8}`)}` }).last,
  "c2-row-uploaded": (d) => rowCase(d, c2root(d), { uploaded: "save-000000008:" + "e".repeat(64) }).last,
  "c2-row-chain": (d) => rowCase(d, c2root(d), { kind: "warm", report: { startStep: 4 } }).last,
  "c2-land-id": (d) => land(d, c2root(d), c2Row(), { runId: "557" }).last,
  "c2-land-symlink": (d) => {
    const res = results(d), real = join(d, u("real")); mkdirSync(real); symlinkSync(real, join(res, "runs/lb-chain2"));
    return land(d, c2root(d), c2Row(), { res }).last;
  },
};
const REAL: Record<string, string | RegExp> = {
  "c2-ref": "LB_C2_REF_NOT_MAIN", "c2-enabled": "LB_C2_DISABLED", "c2-config-pins": "LB_C2_PIN_MISMATCH", "c2-config-fp-file": "LB_C2_PIN_MISMATCH",
  "c2-cleared": "LB_C2_NOT_CLEARED", "c2-new-pins": "LB_C2_PIN_MISMATCH", "c2-warm-plan": "LB_C2_WARM_CONFIG", "c2-warm-values": "LB_C2_WARM_CONFIG",
  "c2-setting-forbidden": "LB_C2_FORBIDDEN_SETTING", "c2-setting-allowed": "LB_C2_SETTING_NOT_ALLOWED", "c2-setting-values": "LB_C2_SETTING_NOT_ALLOWED",
  "c2-val-split": "LB_C2_SETTING_REQUIRED", "c2-shape": "LB_C2_SHAPE", "c2-deadline-cap": "LB_C2_BAD_DEADLINE", "c2-folders": "LB_C2_BAD_CONFIG",
  "c2-pins-files": "LB_C2_CORPUS_FILES", "c2-pins-regular": "LB_C2_CORPUS_FILES", "c2-pins-docs": "LB_C2_CORPUS_SHA_MISMATCH", "c2-pins-manifest": "LB_C2_CORPUS_SHA_MISMATCH",
  "c2-pins-fingerprint-file": "LB_C2_CORPUS_SHA_MISMATCH", "c2-pins-fingerprint": "LB_C2_CORPUS_SHA_MISMATCH",
  "c2-warm-row-symlink": "LB_C2_WARM_ROW", "c2-warm-row-sha": "LB_C2_WARM_ROW", "c2-warm-row-marker": "LB_C2_WARM_ROW", "c2-warm-row-chain": "LB_C2_WARM_ROW",
  "c2-warm-row-split": "LB_C2_WARM_ROW", "c2-row-fields": "LB_C2_ROW_FIELD", "c2-row-schema": "LB_C2_ROW_VALUE", "c2-row-warm": "LB_C2_ROW_VALUE",
  "c2-row-new-chain": "LB_C2_ROW_VALUE", "c2-row-same-split": "LB_C2_HELDOUT_SPLIT_DIFFERS", "c2-row-v2": "LB_C2_ROW_VALUE", "c2-row-v2-bpb": "LB_C2_ROW_VALUE",
  "c2-record-name": "LB_C2_RECORD_BAD", "c2-once": "LB_C2_ALREADY_RAN", "c2-one-chain": "LB_C2_RECORD_BAD", "c2-first-row-warm": "LB_C2_RECORD_BAD",
  "c2-trusted-sha": "LB_C2_UNTRUSTED", "c2-restore-warm-config": "LB_C2_UNTRUSTED", "c2-warm-state-empty": "LB_C2_STATE_NOT_EMPTY",
  "c2-warm-save-set": "LB_C2_WARM_SAVE_SET", "c2-warm-cfg": "LB_C2_WARM_SHA_MISMATCH", "c2-resume-no-warm": "LB_C2_WARM_SAVE_SET",
  "c2-only-trusted-save": "LB_C2_SAVE_SET", "c2-save-sha": "LB_C2_SAVE_SHA_MISMATCH", "c2-chain-absent": "LB_C2_STATE_NOT_EMPTY",
  "c2-job-start": "LB_C2_BAD_DEADLINE", "c2-budget": "LB_C2_BAD_DEADLINE", "c2-report-trained": "LB_C2_TRAIN_ERROR", "c2-row-save-sha": "LB_C2_SAVE_SHA_MISMATCH",
  "c2-row-uploaded": "LB_C2_NOT_UPLOADED", "c2-row-chain": "LB_C2_ROW_VALUE", "c2-land-id": "LB_C2_ROW_VALUE", "c2-land-symlink": "LB_C2_LAND_SYMLINK",
};

function killMutants(file: string, prefix: string, cases: Record<string, (dir: string) => string>, real: Record<string, string | RegExp>) {
  const src = readFileSync(join(MODEL, file), "utf8");
  const tags = [...src.matchAll(/# guard:([a-z0-9-]+)$/gm)].map((m) => m[1]!);
  assert.deepEqual([...tags].sort(), Object.keys(cases).sort(), `${file}: every tagged guard has a case and no case is untagged`);
  assert.deepEqual(Object.keys(real).sort(), Object.keys(cases).sort());
  assert.ok(tags.every((g) => g.startsWith(prefix)), `${file}: the ${prefix} prefix`);
  withDir((dir) => {
    for (const g of tags) {
      const got = cases[g]!(dir);
      const want = real[g]!;
      if (typeof want === "string") assert.equal(got, want, `real outcome of ${g}`); else assert.match(got, want, `real outcome of ${g}`);
      const lines = src.split("\n");
      const i = lines.findIndex((l) => l.endsWith(`# guard:${g}`));
      assert.match(lines[i]!, /^\s+if .+:  # guard:/, `${g} is an if-guard`);
      lines[i] = lines[i]!.replace(/if .+:  # guard:/, "if False:  # guard:");
      MUTANT = { file, text: lines.join("\n") };
      let mutated: string;
      try { mutated = cases[g]!(dir); } finally { MUTANT = null; }
      assert.notEqual(mutated, got, `guard ${g}: disabling it must change "${got}"`);
    }
  });
}

test("M181 guards: every tagged lb_chain2.py guard has a case; disabling it changes the outcome (killed mutant)", () => {
  killMutants("lb_chain2.py", "c2-", CASES, REAL);
});

test("M181 near misses: the valid neighbour of each refusal passes", () => withDir((d) => {
  const f = fx(), root = c2root(d);
  assert.equal(lc(root, ["ref", "--ref", "refs/heads/main"]).last, "ref ok");
  assert.equal(cfgL(root), "config ok");
  // the committed configs themselves (real pins, real warm start) pass
  const real = join(d, "real"); mkdirSync(real);
  for (const n of readdirSync(MODEL).filter((x) => x.endsWith(".py") || x.endsWith(".json"))) copyFileSync(join(MODEL, n), join(real, n));
  const rr = spawnSync(py, [join(real, "lb_chain2.py"), "config"], { encoding: "utf8", env: { ...process.env, ...noNumpyEnv() } });
  assert.equal(rr.stdout.trim(), "config ok", rr.stderr);
  // settings: one more allowed setting, a longer deadline within the cap, an extra cleared corpus, still pass
  assert.equal(cfgL(c2root(d, c2((c) => { c.train["--lr"] = "0.0002"; c.trainDeadlineMin = 305; }))), "config ok");
  assert.equal(cfgL(c2root(d, { cfg: (c) => { c.clearedCorpora.push({ docs: "9".repeat(64), manifest: "9".repeat(64), fingerprint: "9".repeat(64) }); } })), "config ok");
  // resultsCommit: a short prefix of the config's full commit passes; another commit does not
  assert.equal(cfgL(c2root(d, { plan: (p) => { p.chain2.warmStart.resultsCommit = CFG.chain2Run.warmStart.resultsCommit.slice(0, 12); } })), "config ok");
  assert.equal(cfgL(c2root(d, { plan: (p) => { p.chain2.warmStart.resultsCommit = "1234567"; } })), "LB_C2_WARM_CONFIG");
  // pins: the exact artifact passes and prints the pins; a missing artifact or file fails closed
  assert.equal(pinsL(root, artifact(d)), `pins ok docs=${f.pins2.docs} manifest=${f.pins2.manifest} fingerprint=${f.pins2.fingerprint}`);
  assert.equal(pinsL(root, join(d, "missing")), "LB_C2_CORPUS_FILES");
  assert.equal(pinsL(root, artifact(d, (a) => rmSync(join(a, "fingerprint.json")))), "LB_C2_CORPUS_FILES");
  // trusted: the pinned day-3 row -> warm (day 1); one chain-2 row -> resume; a finished chain -> done
  const gho = join(d, "gho"); writeFileSync(gho, "");
  const t1 = lc(root, ["trusted", "--out", join(d, "t1.json"), "--today", D1], { RESULTS_DIR: results(d), GITHUB_OUTPUT: gho });
  assert.equal(t1.last, `trusted kind=warm chain=- save=${f.warm.save} sha=${f.msha} step=0 record=-`);
  assert.equal(readFileSync(gho, "utf8"), `kind=warm\nchain=\nwarm_chain=900\nsave=${f.warm.save}\nsha=${f.msha}\ntrusted_sha=${sha(join(d, "t1.json"))}\n`);
  assert.equal(trusted(root, results(d, { [`${D1}-555.json`]: c2Row() }), D2).last, `trusted kind=resume chain=555 save=save-000000004 sha=${"a".repeat(64)} step=4 record=${D1}-555.json`);
  assert.equal(trusted(root, results(d, { [`${D1}-555.json`]: c2Row(), [`${D2}-556.json`]: day2Row({ marker: marker(8, "save-000000008", false), stopReason: "patience" }) }), "2026-11-06").last,
    `trusted kind=done chain=555 save=save-000000008 sha=${"a".repeat(64)} step=8 record=${D2}-556.json`);
  assert.equal(trusted(root, results(d, {}, "")).last, "LB_C2_WARM_ROW", "an empty day-3 row fails closed");
  const noRow = join(d, u("res")); mkdirSync(noRow);
  assert.equal(trusted(root, noRow).last, "LB_C2_WARM_ROW", "no day-3 row fails closed");
  // restore warm: the real save passes; a tampered file or a rewritten manifest fails closed (verify_save)
  assert.equal(restore(root, trustedFile(d, warmT()), stateWith(d), warmWith(d)).last, `restore warm from=900 save=${f.warm.save} sha=${f.msha} step=4`);
  const tw = warmWith(d); writeFileSync(join(tw, f.warm.save, "tokenizer.json"), readFileSync(join(tw, f.warm.save, "tokenizer.json"), "utf8") + " ");
  assert.equal(restore(root, trustedFile(d, warmT()), stateWith(d), tw).last, "LB_C2_WARM_SHA_MISMATCH");
  const tm = warmWith(d); writeFileSync(join(tm, f.warm.save, "manifest.json"), readFileSync(join(tm, f.warm.save, "manifest.json"), "utf8").replace('"step":4', '"step":5'));
  assert.equal(restore(root, trustedFile(d, warmT()), stateWith(d), tm).last, "LB_C2_WARM_SHA_MISMATCH");
  // restore resume: the one trusted save, WARM empty; a done record trains nothing
  const m = `{"step":4}`;
  assert.equal(restore(root, trustedFile(d, resumeT(shaText(m))), stateWith(d, { "save-000000004": m }), warmWith(d, { save: false })).last, `restore resume save=save-000000004 sha=${shaText(m)} step=4`);
  assert.equal(restore(root, trustedFile(d, { ...resumeT(shaText(m)), kind: "done" }), stateWith(d), warmWith(d, { save: false })).last, "LB_C2_CHAIN_DONE");
  // cycle-args: warm day -> fresh + --warm-start-from + the pin; resume day -> resume:<sha> + the pin alone
  const wa = cycleArgs(root, trustedFile(d, warmT()), String(now() - 60), "/W").out.split("\n");
  assert.deepEqual(wa.slice(0, 2), ["299", "fresh"], "the budget runs from the job start");
  assert.deepEqual(wa.slice(-4), ["--warm-start-from", `/W/${f.warm.save}`, "--warm-start-manifest-sha", f.msha]);
  assert.deepEqual(wa.slice(2, -4), Object.keys(TINY_TRAIN).sort().flatMap((k) => [k, TINY_TRAIN[k]!]));
  const ra = cycleArgs(root, trustedFile(d, resumeT("b".repeat(64))), String(now() - 60)).out.split("\n");
  assert.deepEqual([ra[1], ...ra.slice(-2)], [`resume:${"b".repeat(64)}`, "--warm-start-manifest-sha", f.msha]);
  assert.ok(!ra.includes("--warm-start-from"), "a resume day never re-reads the warm save");
  assert.equal(cycleArgs(root, trustedFile(d, warmT()), String(now() - 269 * 60)).out.split("\n")[0], "31", "a budget just above the minimum passes");
  // row: resume and warm both build; land: a valid row lands once (add-only)
  assert.match(rowCase(d, root).last, /^lb-chain2 start=4 end=8 stop=deadline more=True heldout_bpb=3 baseline_bpb=2\.5 verdict=no_gain heldout_v2_bpb=3\.2 heldout_v2_baseline_bpb=2\.9 /);
  assert.match(rowCase(d, root, { kind: "warm", report: { startStep: 0 } }).last, /^lb-chain2 start=0 end=8 /);
  assert.equal(rowCase(d, root, { ev2: { docs: 0 } }).last, "LB_C2_ROW_VALUE", "a heldout_v2 eval with no docs is refused");
  const l1 = land(d, root, c2Row());
  assert.equal(l1.last, `landed runs/lb-chain2/${D1}-555.json`);
  assert.equal(land(d, root, c2Row(), { res: l1.res }).last, "LB_C2_ROW_EXISTS", "add-only: an existing row is never rewritten");
  assert.deepEqual(readdirSync(join(l1.res, "runs")).sort(), ["lb-chain2", "lb-daily"], "nothing but the row (no latest.json)");
  assert.equal(land(d, root, c2Row({ pins: { ...CFG.dailyRun.corpus } })).last, "LB_C2_PIN_MISMATCH", "a row with the chain-1 pins is refused");
  assert.equal(land(d, root, c2Row({ heldoutBpb: 2.9 })).last, "LB_C2_ROW_VALUE", "a bpb that does not recompute is refused");
  // the disabled plan refuses every command but ref
  const off = c2root(d, { plan: (p) => { p.chain2.enabled = false; } });
  for (const c of [["config"], ["pins", "--corpus", artifact(d)], ["trusted", "--out", join(d, "x.json"), "--today", D1]]) assert.equal(lc(off, c, { RESULTS_DIR: results(d) }).last, "LB_C2_DISABLED", c[0]);
  assert.equal(lc(off, ["ref", "--ref", "refs/heads/main"]).last, "ref ok");
}));

// ---- warmstart.py: every ws-* guard, through a driver that calls the module directly (numpy for load_params) ----

const WS_DRIVER = String.raw`
import copy, json, os, shutil, sys
moddir, save, sha, case, tmp = sys.argv[1:6]
sys.path.insert(0, moddir)
import numpy as np
import saves, warmstart

def forge(edit_cfg=None, drop_param=False):
    """A VALID save (saves.write_save) whose checkpoint cfg or parameter set differs from the real one."""
    w = os.path.join(tmp, "forge-work"); os.makedirs(w)
    z = dict(np.load(os.path.join(save, "checkpoint.npz"), allow_pickle=False))
    meta = json.loads(str(z["meta"]))
    if edit_cfg: edit_cfg(meta["cfg"])
    if drop_param: del z[sorted(k for k in z if k.startswith("p."))[0]]
    z["meta"] = np.array(json.dumps(meta))
    np.savez(os.path.join(w, "checkpoint.npz"), **z)
    for f in ("tokenizer.json", "metrics.jsonl"): shutil.copyfile(os.path.join(save, f), os.path.join(w, f))
    man = json.load(open(os.path.join(save, "manifest.json")))
    name, s = saves.write_save(w, os.path.join(tmp, "forged"), meta["step"], meta["cfg"], man["dataSha256"])
    return os.path.join(tmp, "forged", name), s

def init_of(p):
    with np.load(os.path.join(p, "checkpoint.npz"), allow_pickle=False) as z:
        return {k[2:]: z[k].astype(np.float32) for k in z.files if k.startswith("p.")}

def run():
    work = os.path.join(tmp, "work"); os.makedirs(work)
    if case == "ws-sha-format": return warmstart.check_args(save, "abc", "", "", 0, False)
    if case == "ws-conflict": return warmstart.check_args(save, sha, "", "base.npz", 0, False)
    if case == "ws-with-resume": return warmstart.check_args(save, sha, "resume-save", "", 0, False)
    if case == "ws-needs-save": return warmstart.check_args("", sha, "", "", 0, False)
    if case == "ws-lora-save":
        p, s = forge(lambda c: c.__setitem__("lora", {"rank": 4, "alpha": 4.0, "targets": ["wqkv", "wo"]}))
        return warmstart.verify(p, s, work)
    if case == "ws-work-empty":
        open(os.path.join(work, "tokenizer.json"), "w").write("{}")
        return warmstart.verify(save, sha, work)
    man = warmstart.verify(save, sha, work)
    if case == "ws-tokenizer-sha":
        m = copy.deepcopy(man); m["files"]["tokenizer.json"]["sha256"] = "0" * 64
        return warmstart.copy_tokenizer(save, m, work)
    if case == "ws-shape": return warmstart.check_shape(man, dict(man["cfg"], d_model=man["cfg"]["d_model"] + 8))
    if case == "ws-checkpoint-sha":
        m = copy.deepcopy(man); m["files"]["checkpoint.npz"]["sha256"] = "0" * 64
        return warmstart.load_params(np, save, m, init_of(save))
    if case == "ws-param-shape":
        p, s = forge(drop_param=True)
        return warmstart.load_params(np, p, warmstart.verify(p, s, work), init_of(save))
    if case == "near":
        warmstart.copy_tokenizer(save, man, work); warmstart.check_shape(man, dict(man["cfg"]))
        w = warmstart.load_params(np, save, man, init_of(save))
        return {"args": warmstart.check_args(save, sha, "", "", 0, False), "resume": warmstart.check_args("", sha, "resume-save", "", 0, False),
                "off": warmstart.check_args("", "", "", "", 0, False), "params": len(w)}
    raise SystemExit("no case " + case)

try:
    r = run()
    print("ok " + json.dumps(r, sort_keys=True) if case == "near" else "ok")
except warmstart.WarmError as e:
    print(e.code)
`;
function wsCopy(dir: string) {
  const m = join(dir, u("ws")); mkdirSync(m);
  for (const n of ["warmstart.py", "saves.py"]) copyFileSync(join(MODEL, n), join(m, n));
  if (MUTANT) writeFileSync(join(m, MUTANT.file), MUTANT.text);
  return m;
}
const wsRun = (dir: string, c: string) => {
  const f = fx(), tmp = join(dir, u("wst")); mkdirSync(tmp);
  const r = spawnSync(py, ["-c", WS_DRIVER, wsCopy(dir), f.save, f.msha, c, tmp], { encoding: "utf8" });
  return (r.stdout.trim() || r.stderr.trim()).split("\n").pop()!;
};
const WS_REAL: Record<string, string> = { "ws-sha-format": "WARM_START_SHA_REQUIRED", "ws-conflict": "WARM_START_CONFLICT", "ws-with-resume": "WARM_START_WITH_RESUME",
  "ws-needs-save": "WARM_START_NEEDS_SAVE", "ws-lora-save": "WARM_START_LORA_SAVE", "ws-work-empty": "WARM_START_WORK_NOT_EMPTY", "ws-tokenizer-sha": "WARM_START_FILE_SHA",
  "ws-shape": "WARM_START_SHAPE_MISMATCH", "ws-checkpoint-sha": "WARM_START_FILE_SHA", "ws-param-shape": "WARM_START_SHAPE_MISMATCH" };
const WS_CASES: Record<string, (d: string) => string> = Object.fromEntries(Object.keys(WS_REAL).map((g) => [g, (d: string) => wsRun(d, g)]));

test("M181 warm start guards: every tagged warmstart.py guard has a case; disabling it changes the outcome; the valid neighbour passes", () => {
  killMutants("warmstart.py", "ws-", WS_CASES, WS_REAL);
  withDir((d) => {
    const near = wsRun(d, "near");
    assert.match(near, /^ok /, near);
    const n = JSON.parse(near.slice(3));
    assert.deepEqual([n.args, n.resume, n.off], [{ manifestSha256: fx().msha }, { manifestSha256: fx().msha }, null]);
    assert.ok(n.params > 0);
  });
});

// ---- train.py --warm-start-from end to end (numpy) ----

const trainRun = (corpus: string, work: string, extra: string[], t: Record<string, string> = TINY_TRAIN, saveDir?: string, mk?: string) =>
  spawnSync(py, [join(MODEL, "train.py"), ...trainArgs(t), "--corpus", corpus, "--work", work, ...(saveDir ? ["--save-dir", saveDir, "--marker", mk!] : []), ...extra],
    { encoding: "utf8" });
const codeOf = (r: { stdout: string; stderr: string }) => (r.stderr.trim() || r.stdout.trim()).split("\n").pop()!;

test("M181 train.py warm start: the chain-1 save's tokenizer and weights at step 0 (fresh optimizer), the same held-out split, pinned; tampering fails closed", () => withDir((d) => {
  const f = fx(), w = join(d, "w"), s = join(d, "s"), mk = join(d, "m.json");
  const r = trainRun(f.c2, w, ["--warm-start-from", f.save, "--warm-start-manifest-sha", f.msha], TINY_TRAIN, s, mk);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout + r.stderr, /warm start from save step=4 \(fresh optimizer, step 0\)/);
  assert.equal(sha(join(w, "tokenizer.json")), sha(join(f.save, "tokenizer.json")), "the chain-1 tokenizer, byte for byte");
  assert.equal(sha(join(w, "tokens_heldout.npy")), sha(join(f.w1, "tokens_heldout.npy")), "the days-1-3 held-out split, token for token");
  const m0 = readFileSync(join(w, "metrics.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l)).find((x) => x.step === 0 && x.val_loss !== undefined);
  assert.ok(m0, "a step-0 eval");
  assert.ok(Math.abs(m0.val_loss - json(join(f.w1, "best.json")).val) < 1e-4, `step-0 val_loss ${m0.val_loss} is chain 1's best (the weights were loaded)`);
  const m = json(mk), man = json(join(s, m.save, "manifest.json"));
  assert.equal(m.step, 4); assert.equal(m.more, true);
  assert.deepEqual(man.cfg.warmStart, { manifestSha256: f.msha }, "the chain-2 save records the warm-start pin");
  // resume: the same args + the pin resume; dropping or changing the pin is a different config
  const resumeArgs = ["--resume-from", join(s, m.save), "--resume-manifest-sha", m.manifestSha256];
  const bad1 = trainRun(f.c2, join(d, "r1"), resumeArgs);
  assert.equal(codeOf(bad1), "SAVE_CONFIG_MISMATCH", "resume without the warm-start pin");
  const bad2 = trainRun(f.c2, join(d, "r2"), [...resumeArgs, "--warm-start-manifest-sha", "e".repeat(64)]);
  assert.equal(codeOf(bad2), "SAVE_CONFIG_MISMATCH", "resume with another pin");
  assert.equal(codeOf(trainRun(f.c2, join(d, "r3"), [...resumeArgs, "--warm-start-from", f.save, "--warm-start-manifest-sha", f.msha])), "WARM_START_WITH_RESUME");
  const ok = trainRun(f.c2, join(d, "r4"), [...resumeArgs, "--warm-start-manifest-sha", f.msha], TINY_TRAIN, s, join(d, "m2.json"));
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout + ok.stderr, /resumed step=4/);
  assert.equal(json(join(d, "m2.json")).step, 8);
  // refusals before any training
  const ws = (save: string, msha: string, extra: string[] = [], t = TINY_TRAIN) => codeOf(trainRun(f.c2, join(d, u("x")), ["--warm-start-from", save, "--warm-start-manifest-sha", msha, ...extra], t));
  assert.equal(ws(f.save, "e".repeat(64)), "WARM_START_SAVE_MANIFEST_SHA");
  assert.equal(ws(f.save, ""), "WARM_START_SHA_REQUIRED");
  const tam = join(d, "tam"); cpSync(f.save, tam, { recursive: true });
  writeFileSync(join(tam, "metrics.jsonl"), readFileSync(join(tam, "metrics.jsonl"), "utf8") + "\n");
  assert.equal(ws(tam, f.msha), "WARM_START_SAVE_FILE_SHA");
  assert.equal(ws(join(d, "nope"), f.msha), "WARM_START_SAVE_MISSING");
  assert.equal(ws(f.save, f.msha, [], { ...TINY_TRAIN, "--d-model": "24" }), "WARM_START_SHAPE_MISMATCH");
  assert.equal(ws(f.save, f.msha, ["--lora-rank", "4"]), "WARM_START_CONFLICT");
  const busy = join(d, "busy"); mkdirSync(busy); writeFileSync(join(busy, "tokenizer.json"), "{}");
  assert.equal(codeOf(trainRun(f.c2, busy, ["--warm-start-from", f.save, "--warm-start-manifest-sha", f.msha])), "WARM_START_WORK_NOT_EMPTY");
}));

// ---- the chain end to end: lb_chain2.py trusted -> restore -> lb-chain2-run.sh -> row -> land, with a fake R2 bucket ----

type Day = { kind: string; row?: any; last: string; log: string; s: string };
function chainDay(d: string, root: string, res: string, bucket: string, today: string, runId: string, o: { tamperWarm?: boolean; badSha?: boolean } = {}): Day {
  const gho = join(d, u("gho")); writeFileSync(gho, "");
  const tf = join(d, u("trusted") + ".json");
  const t = lc(root, ["trusted", "--out", tf, "--today", today], { RESULTS_DIR: res, GITHUB_OUTPUT: gho });
  assert.equal(t.status, 0, t.out + t.err);
  const out = Object.fromEntries(readFileSync(gho, "utf8").trim().split("\n").map((l) => l.split("=") as [string, string]));
  if (out.kind === "done") return { kind: "done", last: t.last, log: "", s: "" };
  const s = join(d, u("lbs")), w = join(d, u("lbw")); mkdirSync(join(s, "saves"), { recursive: true }); mkdirSync(w);
  // the R2 get (fake bucket: <bucket>/<chain>/<save>)
  if (out.kind === "warm") cpSync(fx().save, join(w, out.save!), { recursive: true });
  else cpSync(join(bucket, out.chain!, out.save!), join(s, "saves", out.save!), { recursive: true });
  const r = lc(root, ["restore", "--trusted", tf, "--trusted-sha", out.trusted_sha!, "--state", s, "--warm", w]);
  assert.equal(r.status, 0, r.out + r.err);
  if (o.tamperWarm) writeFileSync(join(w, out.save!, "tokenizer.json"), readFileSync(join(w, out.save!, "tokenizer.json"), "utf8") + " ");
  const run = spawnSync("bash", [join(root, "bin/lb-chain2-run.sh"), artifact(d), s, tf, o.badSha ? "f".repeat(64) : out.trusted_sha!, w],
    { encoding: "utf8", env: { ...process.env, PY: py, LB_JOB_START: String(now() - 60), LB_TODAY: today } });
  const log = existsSync(join(s, "logs", `${today}.log`)) ? readFileSync(join(s, "logs", `${today}.log`), "utf8") + readFileSync(join(s, "logs", `${today}.err`), "utf8") : "";
  if (run.status !== 0) return { kind: out.kind!, last: (run.stdout.trim() || run.stderr.trim()).split("\n").pop()!, log, s };
  // the R2 put-one, then row and land
  const ch = json(join(s, "chain.json")), chain = out.chain || runId;
  cpSync(join(s, "saves", ch.save), join(bucket, chain, ch.save), { recursive: true });
  const rowFile = join(d, u("row") + ".json");
  const row = lc(root, ["row", "--trusted", tf, "--trusted-sha", out.trusted_sha!, "--state", s, "--today", today, "--run-id", runId, "--sha", SHA40,
    "--job-start", String(now() - 120), "--uploaded", `${ch.save}:${ch.manifestSha256}`, "--out", rowFile]);
  assert.equal(row.status, 0, row.out + row.err);
  const l = lc(root, ["land", "--row", rowFile, "--run-id", runId, "--today", today], { RESULTS_DIR: res });
  assert.equal(l.last, `landed runs/lb-chain2/${today}-${runId}.json`, l.out + l.err);
  return { kind: out.kind!, row: json(join(res, "runs/lb-chain2", `${today}-${runId}.json`)), last: l.last, log, s };
}

test("M181 chain end to end: day 1 warm-starts from the pinned save, day 2 resumes chain 2, day 3 is done; rows add-only, same split, heldout_v2 separate", () => withDir((d) => {
  const f = fx(), root = c2root(d), res = results(d), bucket = join(d, "bucket"); mkdirSync(bucket);
  const day1 = chainDay(d, root, res, bucket, D1, "555");
  assert.equal(day1.kind, "warm");
  assert.match(day1.log, /warm start from save step=4 \(fresh optimizer, step 0\)/);
  assert.equal(day1.row.chainId, "555"); assert.notEqual(day1.row.chainId, f.warmRow.chainId, "a new chain id");
  assert.deepEqual(day1.row.warmStart, f.warm);
  assert.deepEqual(day1.row.pins, f.pins2, "the new pins");
  assert.deepEqual([day1.row.startStep, day1.row.endStep, day1.row.marker.more], [0, 4, true]);
  assert.deepEqual([day1.row.heldoutTokens, day1.row.heldBytes], [f.H, f.B], "the days-1-3 held-out split");
  assert.ok(day1.row.baselineBpb > 0 && day1.row.heldoutBpb > 0, "held-out bpb reported against the unigram baseline");
  assert.equal(day1.row.heldoutV2.docs, 10, "heldout_v2 reported separately (its 10 docs)");
  const day2 = chainDay(d, root, res, bucket, D2, "556");
  assert.equal(day2.kind, "resume");
  assert.match(day2.log, /resumed step=4/);
  assert.deepEqual([day2.row.chainId, day2.row.startStep, day2.row.endStep, day2.row.marker.more], ["555", 4, 8, false]);
  assert.equal(day2.row.resumedFrom, day1.row.marker.manifestSha256);
  assert.deepEqual([day2.row.heldoutTokens, day2.row.heldBytes], [f.H, f.B]);
  const day3 = chainDay(d, root, res, bucket, "2026-11-06", "557");
  assert.equal(day3.kind, "done");
  assert.deepEqual(readdirSync(join(res, "runs/lb-chain2")).sort(), [`${D1}-555.json`, `${D2}-556.json`], "one add-only row per trained day");
  assert.deepEqual(readdirSync(join(res, "runs")).sort(), ["lb-chain2", "lb-daily"], "no latest.json");
  assert.equal(readFileSync(join(res, "runs/lb-daily/2026-11-03-901.json"), "utf8"), f.warmText, "the chain-1 row is untouched");
}));

test("M181 chain refusals: a warm save tampered after restore fails in train.py; a wrong trusted sha fails before training", () => withDir((d) => {
  const root = c2root(d), bucket = join(d, "bucket"); mkdirSync(bucket);
  const t = chainDay(d, root, results(d), bucket, D1, "555", { tamperWarm: true });
  assert.notEqual(t.last.startsWith("landed"), true);
  assert.match(t.log, /WARM_START_SAVE_FILE_SHA/);
  assert.ok(!existsSync(join(t.s, "chain.json")) || json(join(t.s, "chain.json")).step === 0, "no chain-2 save was made");
  const b = chainDay(d, root, results(d), bucket, D1, "555", { badSha: true });
  assert.equal(b.last, "LB_C2_UNTRUSTED");
  assert.equal(b.log, "", "nothing trained");
}));

// ---- build isolation, script side: lb-chain2-corpus.sh refuses to start with any secret-like variable set ----

const SECRET_NAMES = ["LM_SAVES_R2_SECRET_ACCESS_KEY", "LM_SAVES_R2_ACCESS_KEY_ID", "LM_SAVES_R2_BUCKET", "LM_SAVES_R2_ACCOUNT_ID", "DEPLOY_KEY", "PEACEAI_RESULTS_DEPLOY_KEY",
  "GITHUB_TOKEN", "GH_TOKEN", "TARGET_PR_TOKEN", "ACTIONS_ID_TOKEN_REQUEST_TOKEN", "AWS_ACCESS_KEY_ID", "R2_ACCESS_KEY", "SSH_AUTH_SOCK", "GIT_ASKPASS", "NPM_PASSWORD", "SSH_PRIVATE_KEY", "CLIENT_SECRET"];
const NEAR_NAMES = ["ACTIONS_RUNTIME_TOKEN", "GITHUB_REF", "GITHUB_SHA", "RUNNER_TEMP", "XR2_ACCESS", "AWSX", "SSH_AUTH", "LM_SAVES_DIR", "CI"];
function corpusScript(d: string, extra: Record<string, string>, text?: string) {
  const bin = join(d, u("cs"), "peaceai/bin"); mkdirSync(bin, { recursive: true });
  const p = join(bin, "lb-chain2-corpus.sh");
  writeFileSync(p, text ?? read("peaceai/bin/lb-chain2-corpus.sh"));
  const w = join(d, u("busy")); mkdirSync(w); writeFileSync(join(w, "x"), "x");  // non-empty: the run stops right after the checks (no build, no network)
  const r = spawnSync("bash", [p, w, join(d, u("out"))], { encoding: "utf8", env: { PATH: process.env.PATH!, HOME: process.env.HOME ?? "/tmp", ...extra } });
  return (r.stdout.trim() || r.stderr.trim()).split("\n").pop()!;
}

test("M181 build isolation (script): every secret-like name is refused before anything runs; the mutant without the check lets it through; near misses pass", () => withDir((d) => {
  const src = read("peaceai/bin/lb-chain2-corpus.sh");
  const g = src.split("\n").filter((l) => l.endsWith("# guard:c2-build-no-secret"));
  assert.equal(g.length, 1);
  const mutant = src.replace(/^if \[ -n "\$\(secret_names\)" \]; then/m, "if false; then");
  assert.notEqual(mutant, src);
  assert.equal(corpusScript(d, {}), "LB_C2_BUILD_DIR_NOT_EMPTY", "a clean env gets past the check");
  for (const n of SECRET_NAMES) {
    assert.equal(corpusScript(d, { [n]: "x" }), "LB_C2_BUILD_HAS_SECRET", n);
    assert.equal(corpusScript(d, { [n]: "x" }, mutant), "LB_C2_BUILD_DIR_NOT_EMPTY", `mutant lets ${n} through (killed)`);
  }
  assert.equal(corpusScript(d, Object.fromEntries(NEAR_NAMES.map((n) => [n, "x"]))), "LB_C2_BUILD_DIR_NOT_EMPTY", "near-miss names pass");
  // the refusal comes before the work dir is touched or the builder is run
  assert.ok(src.indexOf("# guard:c2-build-no-secret") < src.indexOf("LB_REBUILD_KEEP_REFS=1 \"$HERE"));
  assert.ok(src.indexOf("# guard:c2-build-no-secret") < src.indexOf("tsx peaceai/bin/lb-corpus2.ts"));
  // lb-corpus-rebuild.sh keeps refs/ only when asked (the default chain-1 rebuild still removes them)
  assert.match(read("peaceai/bin/lb-corpus-rebuild.sh"), /^if \[ "\$\{LB_REBUILD_KEEP_REFS:-\}" = 1 \]; then rm -rf trees corpus; else rm -rf trees refs corpus; fi$/m);
}));

// ---- build isolation, workflow side: the reviewed shape of peace-lb-chain2.yml (itself mutation-tested) ----

const STEP = (n: string) => `      - name: ${n}`;
const R2_SECRETS = ["LM_SAVES_R2_ACCOUNT_ID", "LM_SAVES_R2_ACCESS_KEY_ID", "LM_SAVES_R2_SECRET_ACCESS_KEY", "LM_SAVES_R2_BUCKET"];
const KEY_STEPS = ["Read the trusted record", "Record one add-only row in Results"];
const R2_STEPS = ["Restore the warm-start or resume save from R2", "Copy the new save to R2"];
const TSHA = "${{ steps.trusted.outputs.trusted_sha }}";
const GATE = "        if: steps.trusted.outputs.kind == 'warm' || steps.trusted.outputs.kind == 'resume'\n";
const VERIFY_LINES = [
  `          test "$(git rev-parse HEAD)" = "$GITHUB_SHA" || { echo "checkout is not $GITHUB_SHA"; exit 1; }\n`,
  `          git diff --exit-code --stat HEAD -- || { echo "checkout modified: key refused"; exit 1; }\n`,
  `          test -z "$(git status --porcelain --untracked-files=all)" || { echo "untracked files in checkout: key refused"; exit 1; }\n`,
  `          printf '%s' "$KEY_SCRIPTS_SHA256" | sha256sum -c --quiet - || { echo "key script hash mismatch: key refused"; exit 1; }`,
];
const jobOf = (t: string, name: string) => { const m = t.match(new RegExp(`\\n  ${name}:\\n((?:(?:    [^\\n]*)?\\n)*?)(?=  [A-Za-z0-9_-]+:\\n|$)`)); return m ? m[1]! : ""; };

/** The reviewed shape of peace-lb-chain2.yml; returns the problem classes found. */
function chain2Problems(t: string, jobTimeoutMin: number): string[] {
  const p = new Set<string>();
  if (!t.includes("\non:\n  workflow_dispatch:\n\npermissions: {}\n") || (t.match(/^on:/gm) ?? []).length !== 1
    || /^\s*(schedule|push|pull_request|pull_request_target|workflow_run|workflow_call|repository_dispatch|merge_group|issue_comment|issues|release|inputs):/m.test(t)) p.add("trigger");
  const jobs = t.slice(t.indexOf("\njobs:\n")).match(/^  [A-Za-z0-9_-]+:$/gm) ?? [];
  if (JSON.stringify(jobs) !== JSON.stringify(["  c2-ref-gate:", "  c2-corpus:", "  c2-train:"])) p.add("jobs");
  if ((t.match(/runs-on: /g) ?? []).length !== 3 || (t.match(/runs-on: ubuntu-24\.04\n/g) ?? []).length !== 3) p.add("runner");
  if (!t.includes(`\n  c2-ref-gate:\n    name: chain 2 ref gate (main only)\n    runs-on: ubuntu-24.04\n    timeout-minutes: 5\n    permissions: {}\n    steps:\n      - name: Refuse unless dispatched from main\n        run: test "$GITHUB_REF" = refs/heads/main || { echo "LB_C2_REF_NOT_MAIN"; exit 1; }\n`)) p.add("ref");
  const B = jobOf(t, "c2-corpus"), T = jobOf(t, "c2-train");
  if (!B.startsWith("    name: chain 2 corpus build (no secrets, contents read only)\n    needs: c2-ref-gate\n    if: github.ref == 'refs/heads/main'\n    runs-on: ubuntu-24.04\n    timeout-minutes: 60\n    permissions:\n      contents: read\n    steps:\n")) p.add("build-secret");
  if (!T.match(/^    name: [^\n]+\n    needs: \[c2-ref-gate, c2-corpus\]\n    if: github\.ref == 'refs\/heads\/main'\n    runs-on: ubuntu-24\.04\n    timeout-minutes: \d+\n    environment: peaceai-results\n    permissions:\n      contents: read\n    env:\n/)) p.add("ref");
  if (!T.includes(`run: python3 peaceai/model/lb_chain2.py ref --ref "$GITHUB_REF" && python3 peaceai/model/lb_chain2.py config\n`)) p.add("ref");
  // build isolation: the build job has no environment, no secret, no token, no env block, nothing written back
  if (/secrets\.|environment:|github\.token|GITHUB_TOKEN|\n    env:|\n        env:|id-token|write|persist-credentials: true/.test(B)) p.add("build-secret");
  if ((B.match(/persist-credentials: false\n/g) ?? []).length !== 1) p.add("build-secret");
  // the builder (node, the unprotected lbcorpus2.ts / lb-corpus2.ts) runs only in the build job
  if (!B.includes(`        run: ./peaceai/bin/lb-chain2-corpus.sh "$RUNNER_TEMP/c2w" "$RUNNER_TEMP/c2out"\n`)) p.add("builder");
  const nonComment = (s: string) => s.split("\n").filter((l) => !/^\s*#|^      - name: |^    name: /.test(l)).join("\n");
  if (/\bnode\b|\bnpm\b|\bnpx\b|\btsx\b|setup-node|lb-corpus2\.ts|lbcorpus2|lb-chain2-corpus\.sh|lb-corpus-rebuild\.sh|\.ts\b/.test(nonComment(T))) p.add("builder");
  // the artifact: the three corpus files only, this run, short-lived; downloaded once into the train job
  const up = `      - uses: actions/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9 # v7.0.2\n        with:\n          name: c2-corpus\n          path: \${{ runner.temp }}/c2out\n          retention-days: 1\n          if-no-files-found: error\n`;
  const down = `      - uses: actions/download-artifact@9000827ccba6bdab643e8b6fd33ac0654aef8333 # v8.0.2\n        with:\n          name: c2-corpus\n          path: \${{ runner.temp }}/lbc2\n`;
  if (!(B.trimEnd() + "\n").endsWith(up) || (t.match(/upload-artifact/g) ?? []).length !== 1 || !T.includes(down) || (t.match(/download-artifact/g) ?? []).length !== 1
    || /run-id:|github-token:|pattern:|merge-multiple/.test(t)) p.add("artifact");
  if (/actions\/cache|^\s*cache(-dependency-path)?:|gh release|\bcurl\b|\bwget\b|\bscp\b|\brsync\b|rclone|\baws\b|s3:\/\//im.test(t)) p.add("store");
  // the pins check right after the download, before any secret (fail closed)
  const pinsS = `${down}${STEP("Check the built corpus against the protected pins (before any secret; fail closed)")}\n        run: python3 peaceai/model/lb_chain2.py pins --corpus "$RUNNER_TEMP/lbc2"\n`;
  if (!T.includes(pinsS) || T.indexOf(pinsS) > T.indexOf("secrets.") || (nonComment(t).match(/lb_chain2\.py pins/g) ?? []).length !== 1) p.add("pins");
  if ((T.match(/"\$RUNNER_TEMP\/lbc2"/g) ?? []).length !== 3) p.add("pins"); // pins, the run, the cleanup: nothing else reads the artifact
  for (const m of t.matchAll(/uses: ([^\n]+)/g)) if (!/^[a-z0-9-]+\/[a-z0-9-]+@[0-9a-f]{40} # v[\d.]+$/.test(m[1]!)) p.add("pin");
  if ((t.match(/actions\/checkout@/g) ?? []).length !== 2 || (T.match(/\n        with:\n          persist-credentials: false\n/g) ?? []).length !== 1 || /persist-credentials: true/.test(t)) p.add("creds");
  const tm = T.match(/^(?:    [^\n]*\n)*?    timeout-minutes: (\d+)\n/);
  if (!tm || Number(tm[1]) !== jobTimeoutMin) p.add("timeout");
  if (/latest\.json/.test(t.replaceAll("latest.json is never written", "").replaceAll("no latest.json", ""))) p.add("latest");
  if (/set -x|set -o xtrace|xtrace|printenv|\benv\s*(\||$)|\bexport -p\b|ACTIONS_STEP_DEBUG|::add-mask::|echo [^\n]*\$\{?(LM_SAVES_R2_|DEPLOY_KEY|AWS_)/m.test(t)) p.add("leak");
  // secrets: only as env of the named steps of the train job
  const steps = T.split(/\n(?=      - )/);
  let seen = 0;
  for (const s of steps) {
    const names = [...s.matchAll(/secrets\.([A-Z0-9_]+)/g)].map((m) => m[1]!).sort();
    seen += names.length;
    if (!names.length) continue;
    const key = KEY_STEPS.some((n) => s.startsWith(STEP(n))), r2 = R2_STEPS.some((n) => s.startsWith(STEP(n)));
    const want = key ? ["PEACEAI_RESULTS_DEPLOY_KEY"] : r2 ? [...R2_SECRETS].sort() : [];
    if (JSON.stringify(names) !== JSON.stringify(want)) p.add("secret");
    const lines = (s.match(/^.*secrets\..*$/gm) ?? []);
    if (!lines.every((l) => /^          (DEPLOY_KEY|LM_SAVES_R2_[A-Z_]+): \$\{\{ secrets\.([A-Z0-9_]+) \}\}$/.test(l) && (l.includes("DEPLOY_KEY: ${{ secrets.PEACEAI_RESULTS_DEPLOY_KEY }}") || l.replace(/^ +(\S+): \$\{\{ secrets\.(\S+) \}\}$/, "$1") === l.replace(/^ +(\S+): \$\{\{ secrets\.(\S+) \}\}$/, "$2")))) p.add("secret");
  }
  if (seen !== 10 || (t.match(/secrets\./g) ?? []).length !== 10 || /TARGET_PR_TOKEN|_PAT\b/.test(t)) p.add("secret");
  // the trusted record: only Results runs/lb-chain2/ and the one pinned day-3 row
  const tr = (steps.find((s) => s.startsWith(STEP("Read the trusted record"))) ?? "") + "\n";
  if (!tr.includes(`\n        id: trusted\n`) || !tr.includes(`./peaceai/bin/with-deploy-key.sh ./peaceai/bin/results-write.sh --sparse /runs/lb-chain2/ --sparse /runs/lb-daily/2026-11-03-41572356445.json "lb chain2 trusted record read (run $GITHUB_RUN_ID; writes nothing)" \\\n            python3 peaceai/model/lb_chain2.py trusted --out "$RUNNER_TEMP/lb-trusted.json" --today "$LB_TODAY"\n`)) p.add("trusted");
  const shaLines = T.match(/^ +T_SHA: .*$/gm) ?? [];
  if (shaLines.length !== 3 || shaLines.some((l) => l.trim() !== `T_SHA: ${TSHA}`)) p.add("trusted");
  for (const v of ["T_KIND: ${{ steps.trusted.outputs.kind }}", "T_CHAIN: ${{ steps.trusted.outputs.chain }}", "T_WARM_CHAIN: ${{ steps.trusted.outputs.warm_chain }}", "T_SAVE: ${{ steps.trusted.outputs.save }}"]) if (!T.includes(`          ${v}\n`)) p.add("trusted");
  if ((T.match(/^ +T_[A-Z_]+: .*$/gm) ?? []).some((l) => !l.includes("${{ steps.trusted.outputs."))) p.add("trusted");
  const restoreS = steps.find((s) => s.startsWith(STEP("Restore the warm-start or resume save from R2"))) ?? "";
  if (!restoreS.endsWith(`          "$RUNNER_TEMP/venv/bin/python" peaceai/model/lb_chain2.py restore --trusted "$RUNNER_TEMP/lb-trusted.json" --trusted-sha "$T_SHA" --state "$RUNNER_TEMP/lbs" --warm "$RUNNER_TEMP/lbw"`)
    || !restoreS.includes(`            ./peaceai/bin/lm-saves-r2.sh --folder lb-daily get "$T_WARM_CHAIN" "$T_SAVE" "$RUNNER_TEMP/lbw/$T_SAVE"\n`)
    || !restoreS.includes(`            ./peaceai/bin/lm-saves-r2.sh --folder lb-daily get "$T_CHAIN" "$T_SAVE" "$RUNNER_TEMP/lbs/saves/$T_SAVE"\n`)) p.add("trusted");
  if (!T.includes(`        run: ./peaceai/bin/lb-chain2-run.sh "$RUNNER_TEMP/lbc2" "$RUNNER_TEMP/lbs" "$RUNNER_TEMP/lb-trusted.json" "$T_SHA" "$RUNNER_TEMP/lbw"\n`)) p.add("trusted");
  if (/resume-from|resume-manifest|warm-start-|manifestSha256[^\n]*T_SHA|inputs\./.test(t)) p.add("trusted");
  if (!T.includes(`./peaceai/bin/lm-saves-r2.sh --folder lb-daily put-one "$chain" "$RUNNER_TEMP/lbs/saves" "$save" "$sha"\n`) || !T.includes(`          chain=\${T_CHAIN:-$GITHUB_RUN_ID}\n`)) p.add("store");
  if ((t.match(/lm-saves-r2\.sh/g) ?? []).length !== 4 || (t.match(/lm-saves-r2\.sh --folder lb-daily /g) ?? []).length !== 4) p.add("store");
  for (const [verifyName, keyName] of [["Re-verify the checkout and the key scripts right before the R2 key is used again (copy)", "Copy the new save to R2"], ["Re-verify the checkout and the key scripts right before the deploy key is used again (land)", "Record one add-only row in Results"]]) {
    const k = steps.findIndex((x) => x.startsWith(STEP(keyName)));
    const v = k > 0 ? steps[k - 1]! + "\n" : "";
    if (!v.startsWith(STEP(verifyName) + "\n" + GATE + "        run: |\n          set -euo pipefail\n") || !VERIFY_LINES.every((l) => v.includes(l)) || /secrets\./.test(v)) p.add("reverify");
  }
  // order: ref/config -> download -> pins -> verify -> trusted -> restore -> run -> copy -> row -> land -> cleanup
  const order = ["lb_chain2.py config", "download-artifact", "lb_chain2.py pins", STEP("Verify the checkout and the key scripts before any key is used"), STEP("Read the trusted record"),
    STEP("Restore the warm-start or resume save from R2"), "lb-chain2-run.sh", STEP("Copy the new save to R2"), "lb_chain2.py row", STEP("Record one add-only row in Results"), STEP("Remove the corpus, state, warm save and venv")].map((s) => T.indexOf(s));
  if (order.some((x, i) => x < 0 || (i > 0 && x < order[i - 1]!))) p.add("order");
  const firstKey = T.indexOf("secrets."), verify = T.indexOf("printf '%s' \"$KEY_SCRIPTS_SHA256\" | sha256sum -c --quiet -");
  if (verify < 0 || firstKey < verify) p.add("order");
  const ti = steps.findIndex((x) => x.startsWith(STEP("Read the trusted record")));
  for (const s of steps.slice(ti + 1, -1)) if (!s.includes("\n        if: steps.trusted.outputs.kind ")) p.add("order");
  const landS = `./peaceai/bin/with-deploy-key.sh ./peaceai/bin/results-write.sh --sparse "/runs/lb-chain2/$LB_TODAY-$GITHUB_RUN_ID.json" "lb chain2 metrics ($LB_TODAY, run $GITHUB_RUN_ID)" \\\n            python3 peaceai/model/lb_chain2.py land --row "$RUNNER_TEMP/lb-chain2-row.json" --run-id "$GITHUB_RUN_ID" --today "$LB_TODAY"\n`;
  if ((t.match(/results-write\.sh/g) ?? []).length !== 3 || !T.includes(landS)) p.add("land");
  if (!/\n      - name: Remove the corpus, state, warm save and venv[^\n]*\n        if: always\(\)\n        run: rm -rf "\$RUNNER_TEMP\/lbc2" "\$RUNNER_TEMP\/lbs" "\$RUNNER_TEMP\/lbw" [^\n]*\n$/.test(t)) p.add("cleanup");
  return [...p].sort();
}

test("M181 workflow: peace-lb-chain2.yml has the reviewed shape (build job secrets-free, pins before secrets); each guard kills its mutant and a near miss passes", () => {
  const wf = read(WF), jt = CFG.chain2Run.jobTimeoutMin;
  assert.deepEqual(chain2Problems(wf, jt), []);
  const step = (body: string) => wf.replace("      - name: Remove the corpus, state, warm save and venv", `${body}      - name: Remove the corpus, state, warm save and venv`);
  const bstep = (body: string) => wf.replace("      - uses: actions/upload-artifact@", `${body}      - uses: actions/upload-artifact@`);
  const run = `        run: ./peaceai/bin/lb-chain2-run.sh "$RUNNER_TEMP/lbc2" "$RUNNER_TEMP/lbs" "$RUNNER_TEMP/lb-trusted.json" "$T_SHA" "$RUNNER_TEMP/lbw"\n`;
  const pinsLine = `        run: python3 peaceai/model/lb_chain2.py pins --corpus "$RUNNER_TEMP/lbc2"\n`;
  const cut = (a: string, b: string) => { const i = wf.indexOf(a), j = wf.indexOf(b); return wf.slice(0, i) + wf.slice(j); };
  const swap = (a: string, b: string, c: string) => { const i = wf.indexOf(a), j = wf.indexOf(b), k = wf.indexOf(c); return wf.slice(0, i) + wf.slice(j, k) + wf.slice(i, j) + wf.slice(k); };
  const mutants: [string, string, string][] = [
    ["trigger", "schedule trigger", wf.replace("on:\n  workflow_dispatch:\n", "on:\n  workflow_dispatch:\n  schedule:\n    - cron: '0 3 * * *'\n")],
    ["trigger", "push trigger", wf.replace("on:\n  workflow_dispatch:\n", "on:\n  push:\n    branches: [main]\n  workflow_dispatch:\n")],
    ["trigger", "dispatch inputs", wf.replace("on:\n  workflow_dispatch:\n", "on:\n  workflow_dispatch:\n    inputs:\n      sha:\n        default: \"\"\n")],
    ["jobs", "a fourth job", wf + "\n  extra:\n    runs-on: ubuntu-24.04\n    steps:\n      - run: true\n"],
    ["runner", "self-hosted build runner", wf.replace("    timeout-minutes: 60\n", "    timeout-minutes: 60\n").replace("    if: github.ref == 'refs/heads/main'\n    runs-on: ubuntu-24.04\n    timeout-minutes: 60", "    if: github.ref == 'refs/heads/main'\n    runs-on: self-hosted\n    timeout-minutes: 60")],
    ["ref", "gate step removed", wf.replace(`test "$GITHUB_REF" = refs/heads/main || { echo "LB_C2_REF_NOT_MAIN"; exit 1; }`, "echo gate")],
    ["ref", "train job if without the ref", wf.replace("    needs: [c2-ref-gate, c2-corpus]\n    if: github.ref == 'refs/heads/main'\n", "    needs: [c2-ref-gate, c2-corpus]\n    if: always()\n")],
    ["ref", "no in-job ref check", wf.replace(`python3 peaceai/model/lb_chain2.py ref --ref "$GITHUB_REF" && `, "")],
    ["build-secret", "build job with the environment", wf.replace("    timeout-minutes: 60\n    permissions:\n", "    timeout-minutes: 60\n    environment: peaceai-results\n    permissions:\n")],
    ["build-secret", "build job with a secret in a step", wf.replace(`        run: ./peaceai/bin/lb-chain2-corpus.sh`, `        env:\n          DEPLOY_KEY: \${{ secrets.PEACEAI_RESULTS_DEPLOY_KEY }}\n        run: ./peaceai/bin/lb-chain2-corpus.sh`)],
    ["build-secret", "build job with the job token", wf.replace(`        run: ./peaceai/bin/lb-chain2-corpus.sh`, `        env:\n          GH_TOKEN: \${{ github.token }}\n        run: ./peaceai/bin/lb-chain2-corpus.sh`)],
    ["build-secret", "build job with contents: write", wf.replace("    timeout-minutes: 60\n    permissions:\n      contents: read\n", "    timeout-minutes: 60\n    permissions:\n      contents: write\n")],
    ["build-secret", "build job inheriting the default permissions", wf.replace("    timeout-minutes: 60\n    permissions:\n      contents: read\n", "    timeout-minutes: 60\n")],
    ["build-secret", "build job with an id token", wf.replace("    timeout-minutes: 60\n    permissions:\n      contents: read\n", "    timeout-minutes: 60\n    permissions:\n      contents: read\n      id-token: write\n")],
    ["build-secret", "build checkout persisting credentials", wf.replace("          fetch-depth: 0\n          persist-credentials: false\n", "          fetch-depth: 0\n")],
    ["builder", "the builder in the train job", step(`      - name: Rebuild\n${GATE}        run: ./peaceai/bin/lb-chain2-corpus.sh "$RUNNER_TEMP/a" "$RUNNER_TEMP/b"\n`)],
    ["builder", "node in the train job", step(`      - name: Probe\n${GATE}        run: node -e 1\n`)],
    ["builder", "tsx lb-corpus2.ts in the train job", step(`      - name: Probe\n${GATE}        run: ./node_modules/.bin/tsx peaceai/bin/lb-corpus2.ts --help\n`)],
    ["builder", "the build job not running the isolated script", wf.replace(`        run: ./peaceai/bin/lb-chain2-corpus.sh "$RUNNER_TEMP/c2w" "$RUNNER_TEMP/c2out"\n`, `        run: ./node_modules/.bin/tsx peaceai/bin/lb-corpus2.ts --out "$RUNNER_TEMP/c2out"\n`)],
    ["artifact", "artifact of the whole work dir", wf.replace("          path: ${{ runner.temp }}/c2out\n", "          path: ${{ runner.temp }}\n")],
    ["artifact", "long-lived artifact", wf.replace("          retention-days: 1\n", "          retention-days: 30\n")],
    ["artifact", "artifact from another run", wf.replace("          name: c2-corpus\n          path: ${{ runner.temp }}/lbc2\n", "          name: c2-corpus\n          path: ${{ runner.temp }}/lbc2\n          run-id: 1\n          github-token: x\n")],
    ["artifact", "a second upload (saves leave as an artifact)", step(`      - uses: actions/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9 # v7.0.2\n        with:\n          name: s\n          path: \${{ runner.temp }}/lbs\n`)],
    ["pins", "no pins check", wf.replace(pinsLine, "        run: true\n")],
    ["pins", "pins after the first secret", swap(STEP("Check the built corpus against the protected pins"), STEP("Read the trusted record"), STEP("Chain finished"))],
    ["pins", "a second reader of the artifact", step(`      - name: Peek\n${GATE}        run: ls "$RUNNER_TEMP/lbc2"\n`)],
    ["store", "cache step", bstep("      - uses: actions/cache@5a3ec84eff668545956fd18022155c47e93e2684 # v4.2.3\n        with:\n          path: x\n          key: lb\n")],
    ["store", "setup-node cache", wf.replace("          node-version: 22\n", "          node-version: 22\n          cache: npm\n")],
    ["store", "direct aws copy", step('      - name: Save\n        run: aws s3 cp "$RUNNER_TEMP/lbs" s3://x --recursive\n')],
    ["store", "the M148 saves folder", wf.replace("lm-saves-r2.sh --folder lb-daily put-one", "lm-saves-r2.sh put-one")],
    ["store", "the new save into chain 1's folder", wf.replace("          chain=${T_CHAIN:-$GITHUB_RUN_ID}\n", "          chain=${T_CHAIN:-$T_WARM_CHAIN}\n")],
    ["trusted", "resume sha from chain.json", wf.replace(run, run.replace('"$T_SHA"', '"$(jq -r .manifestSha256 "$RUNNER_TEMP/lbs/chain.json")"'))],
    ["trusted", "warm save name from elsewhere", wf.replace("          T_SAVE: ${{ steps.trusted.outputs.save }}\n", "          T_SAVE: save-000006000\n")],
    ["trusted", "no sha check after the R2 get", wf.replace(`\n          "$RUNNER_TEMP/venv/bin/python" peaceai/model/lb_chain2.py restore --trusted "$RUNNER_TEMP/lb-trusted.json" --trusted-sha "$T_SHA" --state "$RUNNER_TEMP/lbs" --warm "$RUNNER_TEMP/lbw"`, "")],
    ["trusted", "trusted record read from a wider path", wf.replace("--sparse /runs/lb-chain2/ --sparse /runs/lb-daily/2026-11-03-41572356445.json ", "--sparse /runs/ ")],
    ["trusted", "a warm-start flag in the workflow", wf.replace(run, run.replace('lb-chain2-run.sh "', 'lb-chain2-run.sh --warm-start-from x "'))],
    ["order", "restore after the run", swap(STEP("Restore the warm-start or resume save from R2"), STEP("Chain 2 day"), STEP("Re-verify the checkout and the key scripts right before the R2 key"))],
    ["order", "run not gated on the trusted kind", wf.replace(`${GATE}        env:\n          PY:`, "        env:\n          PY:")],
    ["order", "no checkout verify before the key", wf.replace(/(Verify the checkout and the key scripts before any key is used[^]*?)printf '%s' "\$KEY_SCRIPTS_SHA256" \| sha256sum -c --quiet - \|\| \{ echo "key script hash mismatch: key refused"; exit 1; \}\n/, "$1true\n")],
    ["secret", "R2 secret in the run step", wf.replace("          PY: ${{ runner.temp }}/venv/bin/python\n          T_SHA", "          PY: ${{ runner.temp }}/venv/bin/python\n          LM_SAVES_R2_SECRET_ACCESS_KEY: ${{ secrets.LM_SAVES_R2_SECRET_ACCESS_KEY }}\n          T_SHA")],
    ["secret", "Results key at job level", wf.replace('      PYTHONDONTWRITEBYTECODE: "1"\n', '      PYTHONDONTWRITEBYTECODE: "1"\n      DEPLOY_KEY: ${{ secrets.PEACEAI_RESULTS_DEPLOY_KEY }}\n')],
    ["secret", "TARGET_PR_TOKEN widened here", step(`      - name: Probe\n${GATE}        env:\n          TARGET_PR_TOKEN: \${{ secrets.TARGET_PR_TOKEN }}\n        run: true\n`)],
    ["secret", "secret inlined in a run line", step(`      - name: Probe\n${GATE}        run: test -n "\${{ secrets.LM_SAVES_R2_BUCKET }}"\n`)],
    ["leak", "set -x", wf.replace("          set -euo pipefail\n          ./peaceai/bin/lm-saves-r2.sh --folder lb-daily check", "          set -x\n          ./peaceai/bin/lm-saves-r2.sh --folder lb-daily check")],
    ["leak", "secret echoed", wf.replace("          ./peaceai/bin/lm-saves-r2.sh --folder lb-daily check\n", '          echo "bucket $LM_SAVES_R2_BUCKET"\n          ./peaceai/bin/lm-saves-r2.sh --folder lb-daily check\n')],
    ["latest", "latest.json write", step('      - name: Promote\n        run: cp "$RUNNER_TEMP/lb-chain2-row.json" latest.json\n')],
    ["pin", "unpinned action", wf.replace("actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 # v7.1.0", "actions/setup-node@v4")],
    ["creds", "persisted train checkout credentials", wf.replace("      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1\n        with:\n          persist-credentials: false\n", "      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1\n        with:\n          persist-credentials: true\n")],
    ["timeout", "job cap above the config", wf.replace("    timeout-minutes: 355\n", "    timeout-minutes: 360\n")],
    ["land", "landing without --sparse", wf.replace('results-write.sh --sparse "/runs/lb-chain2/$LB_TODAY-$GITHUB_RUN_ID.json" ', "results-write.sh ")],
    ["land", "landing into the chain-1 folder", wf.replace('--sparse "/runs/lb-chain2/$LB_TODAY-$GITHUB_RUN_ID.json"', '--sparse "/runs/lb-daily/$LB_TODAY-$GITHUB_RUN_ID.json"')],
    ["reverify", "no re-verify before the copy", cut(STEP("Re-verify the checkout and the key scripts right before the R2 key"), STEP("Copy the new save to R2"))],
    ["reverify", "no re-verify before the land", cut(STEP("Re-verify the checkout and the key scripts right before the deploy key"), STEP("Record one add-only row in Results"))],
    ["cleanup", "no cleanup", wf.replace('        if: always()\n        run: rm -rf "$RUNNER_TEMP/lbc2"', '        run: rm -rf "$RUNNER_TEMP/lbc2"')],
  ];
  for (const [want, what, text] of mutants) {
    assert.notEqual(text, wf, `${what}: the mutation applies`);
    assert.ok(chain2Problems(text, jt).includes(want), `${what}: expected ${want}, got ${chain2Problems(text, jt)}`);
  }
  // near misses: a comment in the build job, a harmless build-job step, an echo of a non-secret, a longer cleanup, still pass
  assert.deepEqual(chain2Problems(bstep("      # the artifact holds the three corpus files only\n"), jt), []);
  assert.deepEqual(chain2Problems(bstep(`      - name: List the built files\n        run: ls -l "$RUNNER_TEMP/c2out"\n`), jt), []);
  assert.deepEqual(chain2Problems(wf.replace('          echo "LB_UPLOADED=$save:$sha" >> "$GITHUB_ENV"\n', '          echo "LB_UPLOADED=$save:$sha" >> "$GITHUB_ENV"\n          echo "uploaded $save"\n'), jt), []);
  assert.deepEqual(chain2Problems(wf.replace('"$RUNNER_TEMP/venv"\n', '"$RUNNER_TEMP/venv" "$RUNNER_TEMP/tmp"\n'), jt), []);
  // the key scripts are pinned to their committed bytes
  for (const f of ["peaceai/bin/with-deploy-key.sh", "peaceai/bin/results-write.sh"]) assert.ok(wf.includes(`\n        ${sha(join(repo, f))}  ${f}\n`), f);
  // the chain-1 daily workflow is untouched by chain 2 (it never warm-starts and never builds the v2 corpus)
  assert.ok(!/lb_chain2|lb-chain2|warm-start|lb-corpus2/.test(read(".github/workflows/peace-lb-daily.yml")));
});

test("M181 config: the committed chain2Run is the reviewed chain 2 (new pins, warm start from chain 1's save-000006000 pinned 1e513e50, same model shape)", () => {
  const c = CFG.chain2Run, w = c.warmStart, pw = PLAN.chain2.warmStart, b = PLAN.build;
  assert.deepEqual(c.corpus, { docs: b.docsSha256, manifest: b.manifestSha256, fingerprint: b.fingerprint }, "the lb-corpus2.json build pins");
  assert.ok(c.corpus.docs.startsWith("9a78ef05") && c.corpus.manifest.startsWith("4c950ca4") && c.corpus.fingerprint.startsWith("8ecd9cec"));
  assert.notDeepEqual(c.corpus, CFG.dailyRun.corpus, "new pins (not chain 1's)");
  assert.ok(CFG.clearedCorpora.some((x: any) => x.docs === c.corpus.docs && x.manifest === c.corpus.manifest && x.fingerprint === c.corpus.fingerprint), "cleared");
  assert.equal(c.fingerprintFileSha256, sha(join(MODEL, "lb-corpus2-fingerprint.json")));
  assert.equal(json(join(MODEL, "lb-corpus2-fingerprint.json")).fingerprint, c.corpus.fingerprint);
  assert.deepEqual([w.fromChain, w.save, w.resultsRow], ["41222155935", "save-000006000", "runs/lb-daily/2026-11-03-41572356445.json"]);
  assert.ok(w.manifestSha256.startsWith("1e513e50") && /^[0-9a-f]{64}$/.test(w.manifestSha256));
  assert.deepEqual([w.heldoutBpb, w.baselineBpb], [0.6688, 2.5156], "the day-3 held-out bpb and its unigram baseline");
  assert.deepEqual([pw.fromChain, pw.save, pw.manifestSha256, pw.resultsRow], [w.fromChain, w.save, w.manifestSha256, w.resultsRow]);
  assert.ok(w.resultsCommit.startsWith(pw.resultsCommit));
  assert.deepEqual([c.r2Folder, c.resultsDir], ["lb-daily", "lb-chain2"]);
  assert.equal(c.jobTimeoutMin, CFG.dailyRun.jobTimeoutMin);
  for (const k of ["--d-model", "--n-layer", "--n-head", "--ctx", "--vocab", "--val-split"]) assert.equal(c.train[k], CFG.dailyRun.train[k], `same ${k} (the chain-1 tokenizer and shape)`);
  for (const k of Object.keys(c.train)) assert.ok(!/^--(warm-start|resume|init-from|lora|replay)/.test(k), k);
  assert.equal(PLAN.chain2.enabled, true, "enabled for manual dispatch; the workflow has no schedule");
  assert.equal(cfgL(join(MODEL, "..")), "config ok");
});

test("M181 stdlib-only: lb_chain2.py imports no numpy and runs with numpy blocked; warmstart.py touches numpy only through its caller", () => {
  const src = readFileSync(join(MODEL, "lb_chain2.py"), "utf8");
  assert.ok(!/^\s*(import numpy|from numpy|import .*\bnumpy\b)/m.test(src));
  assert.notEqual(spawnSync(py, ["-c", "import numpy"], { env: { ...process.env, ...noNumpyEnv() } }).status, 0, "numpy is blocked");
  const r = spawnSync(py, [join(MODEL, "lb_chain2.py"), "config"], { encoding: "utf8", env: { ...process.env, ...noNumpyEnv() } });
  assert.equal(r.stdout.trim(), "config ok", r.stderr);
  const ws = readFileSync(join(MODEL, "warmstart.py"), "utf8");
  assert.ok(!/^\s*(import numpy|from numpy)/m.test(ws), "warmstart.py gets numpy as an argument (load_params(np, ...))");
});
