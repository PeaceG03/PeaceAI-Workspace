// M165 lb-train daily cycle on GitHub (Auditor ruling, R2 ready): .github/workflows/peace-lb-daily.yml runs ONE day of
// peaceai/bin/lb-daily-cycle.sh per manual dispatch from main, through peaceai/bin/lb-daily-run.sh and the guards in
// peaceai/model/lb_daily.py. Saves live in their own R2 folder (lm-saves-r2.sh --folder lb-daily); the resume save and
// its manifest sha256 come only from the newest add-only Results row runs/lb-daily/<day>-<run id>.json (the trusted
// record), the restored save must hash to it before any resume, and lb-daily-cycle.sh refuses any plan that is not the
// trusted one (LB_DAILY_EXPECT, DAILY_PLAN_UNTRUSTED). LoRA is refused until a full-model run beats the same-split
// unigram baseline 2.5156 bpb, and even then (no LoRA path is wired). Every tagged lb_daily.py guard (dr-*) has a case
// whose outcome must change when the guard is disabled (killed mutant), next to a near miss that passes; the workflow
// shape is checked by lbDailyProblems, itself mutation-tested (non-main ref, schedule / push trigger, artifact / cache
// step, untrusted sha source, restore after the cycle, LoRA, secret in a non-allowed step, secret echo, latest.json,
// unpinned action, persisted credentials, self-hosted runner, timeout, non-sparse landing).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { json, MODEL, py, repo, tinyCorpus, withDir } from "./m157-lbtrain-mut.ts";
import { NONUMPY, noNumpyEnv, pyNoNumpyFor, STDLIB_ONLY } from "./nonumpy.ts";

const PYNN = pyNoNumpyFor(py); // the stdlib-only entry points run with numpy blocked (CI has none); train.py/export.py keep it

const WF = ".github/workflows/peace-lb-daily.yml";
const read = (p: string) => readFileSync(join(repo, p), "utf8");
const sha = (p: string) => createHash("sha256").update(readFileSync(p)).digest("hex");
const shaText = (t: string) => createHash("sha256").update(t).digest("hex");
const CFG = json(join(MODEL, "lb-train.json"));
const PINS = { ...CFG.dailyRun.corpus };
const SHA40 = "0123456789abcdef0123456789abcdef01234567";
const T = "2026-10-31", PREV = "2026-10-30";
const now = () => Math.floor(Date.now() / 1000);
const pinsOf = (c: string) => ({ docs: sha(join(c, "docs.jsonl")), manifest: sha(join(c, "manifest.jsonl")), fingerprint: json(join(c, "fingerprint.json")).fingerprint });
const TINY_TRAIN: Record<string, string> = { "--d-model": "16", "--n-layer": "1", "--n-head": "2", "--ctx": "32", "--vocab": "300", "--batch": "2", "--threads": "1", "--eval-every": "2", "--steps": "8", "--max-steps-this-run": "4", "--patience": "5", "--optimizer": "adamw8bit", "--curriculum": "easy_to_hard" };
let uniq = 0;
const u = (p: string) => `${p}-${(uniq += 1)}`;

/** When set, scratch installs this mutated lb_daily.py (the mutation check). */
let MUTANT: string | null = null;

/** root/model (a copy of peaceai/model with lb-train.json edited) + root/bin (the daily scripts). */
function scratch(dir: string, edit: (cfg: any) => void = () => {}, files: Record<string, string> = {}) {
  const root = join(dir, u("pkg"));
  mkdirSync(join(root, "model"), { recursive: true }); mkdirSync(join(root, "bin"));
  for (const f of readdirSync(MODEL).filter((x) => x.endsWith(".py") || x.endsWith(".json"))) copyFileSync(join(MODEL, f), join(root, "model", f));
  for (const f of ["lb-daily-cycle.sh", "lb-daily-run.sh", "lm-saves-r2.sh"]) copyFileSync(join(repo, "peaceai/bin", f), join(root, "bin", f));
  if (MUTANT !== null) writeFileSync(join(root, "model/lb_daily.py"), MUTANT);
  for (const [f, t] of Object.entries(files)) writeFileSync(join(root, f), t);
  const cfg = json(join(root, "model/lb-train.json"));
  edit(cfg);
  writeFileSync(join(root, "model/lb-train.json"), JSON.stringify(cfg));
  return root;
}
const withTrain = (edit: (t: Record<string, string>) => void) => (cfg: any) => edit(cfg.dailyRun.train);

const ld = (root: string, args: string[], env: Record<string, string> = {}) => {
  const r = spawnSync(py, [join(root, "model/lb_daily.py"), ...args], { encoding: "utf8", env: { ...process.env, ...noNumpyEnv(), GITHUB_OUTPUT: "", ...env } });
  return { status: r.status, out: r.stdout.trim(), last: (r.stdout.trim() || r.stderr.trim()).split("\n").pop()! };
};

const marker = (step: number, save: string, more = true, msha = "a".repeat(64)) =>
  ({ schema: "peaceai-lm-chain:v1", more, stopReason: more ? "deadline" : "patience", step, totalSteps: step, save, manifestSha256: msha, cfgSha256: "c".repeat(64) });
const goodRow = (o: Record<string, unknown> = {}) => ({
  schema: "peaceai-lb-daily-run:v1", runId: "100", workflowSha: SHA40, chainId: "100", today: PREV, pins: { ...PINS }, status: "trained", startStep: 0,
  endStep: 50, stopReason: "deadline", heldoutBpb: 3.1, baselineBpb: 2.5156, wallSeconds: 1000, resumedFrom: null, marker: marker(50, "save-000000050"), ...o });

/** A Results dir with the given files (path under runs/ -> JSON). */
function results(dir: string, files: Record<string, unknown> = {}) {
  const res = join(dir, u("res")); mkdirSync(res);
  for (const [p, v] of Object.entries(files)) { mkdirSync(join(res, "runs", p, ".."), { recursive: true }); writeFileSync(join(res, "runs", p), JSON.stringify(v)); }
  return res;
}
const trusted = (root: string, res: string, today = T, dir = res) => ld(root, ["trusted", "--out", join(dir, "..", u("trusted") + ".json"), "--today", today], { RESULTS_DIR: res });

/** A trusted-record file and its sha256 (what the trusted step hands on). */
function trustedFile(dir: string, t: Record<string, unknown>) {
  const f = join(dir, u("t") + ".json"); const body = JSON.stringify(t) + "\n"; writeFileSync(f, body);
  return { f, sha: shaText(body) };
}
const FRESH = { kind: "fresh", chainId: null, marker: null, row: null };
const resumeT = (msha: string, step = 50, save = "save-000000050") => ({ kind: "resume", chainId: "100", marker: marker(step, save, true, msha), row: `${PREV}-100.json` });

/** A state dir holding one save (manifest text) -> [state, manifest sha]. */
function stateWith(dir: string, saves: Record<string, string>, chain?: unknown) {
  const s = join(dir, u("state")); mkdirSync(join(s, "saves"), { recursive: true });
  for (const [n, m] of Object.entries(saves)) { mkdirSync(join(s, "saves", n)); writeFileSync(join(s, "saves", n, "manifest.json"), m); writeFileSync(join(s, "saves", n, "checkpoint.npz"), "ck"); }
  if (chain !== undefined) writeFileSync(join(s, "chain.json"), JSON.stringify(chain));
  return s;
}
const restore = (root: string, t: { f: string; sha: string }, s: string, shaArg = t.sha) => ld(root, ["restore", "--trusted", t.f, "--trusted-sha", shaArg, "--state", s]);
const cycleArgs = (root: string, t: { f: string; sha: string }, start: number, at = now()) =>
  ld(root, ["cycle-args", "--trusted", t.f, "--trusted-sha", t.sha, "--job-start", String(start), "--now", String(at)]);

/** A finished day in STATE (report, chain.json, the new save) as lb-daily-cycle.sh leaves it, then lb_daily.py row. */
function rowCase(dir: string, root: string, o: { kind?: "fresh" | "resume"; report?: Record<string, unknown>; tamper?: boolean; uploaded?: string } = {}) {
  const save = "save-000000080", man = `{"step":80}`;
  const s = stateWith(dir, { [save]: man }); const msha = shaText(man);
  writeFileSync(join(s, "chain.json"), JSON.stringify(marker(80, save, true, msha)));
  mkdirSync(join(s, "reports"));
  const kind = o.kind ?? "resume";
  writeFileSync(join(s, "reports", `${T}.json`), JSON.stringify({ status: "trained", startStep: kind === "resume" ? 50 : 0, endStep: 80, stopReason: "deadline",
    eval: { model_bits_per_byte: 3.0, unigram_bits_per_byte: 2.5156 }, corpus: { ...PINS }, ...o.report }));
  if (o.tamper) writeFileSync(join(s, "saves", save, "manifest.json"), `{"step":81}`);
  const t = trustedFile(dir, kind === "resume" ? resumeT("b".repeat(64)) : FRESH);
  return ld(root, ["row", "--trusted", t.f, "--trusted-sha", t.sha, "--state", s, "--today", T, "--run-id", "200", "--sha", SHA40, "--job-start", String(now() - 100),
    "--uploaded", o.uploaded ?? `${save}:${msha}`, "--out", join(dir, u("row") + ".json")]);
}
const land = (dir: string, root: string, row: unknown, o: { runId?: string; res?: string } = {}) => {
  const f = join(dir, u("in") + ".json"); writeFileSync(f, JSON.stringify(row));
  const res = o.res ?? results(dir);
  return { ...ld(root, ["land", "--row", f, "--run-id", o.runId ?? "100", "--today", PREV], { RESULTS_DIR: res }), res };
};
const unlockRow = { baselineBpb: 2.5156, heldoutBpb: 2.4, runId: "7", steps: 900 };

/** One case per tagged guard: scratch dir -> the lb_daily.py outcome (last output line). */
const CASES: Record<string, (dir: string) => string> = {
  "dr-ref": (d) => ld(scratch(d), ["ref", "--ref", "refs/heads/dev"]).last,
  "dr-lora-locked": (d) => ld(scratch(d, withTrain((t) => { t["--lora-rank"] = "8"; })), ["config"]).last,
  "dr-lora-not-wired": (d) => trusted(scratch(d, withTrain((t) => { t["--lora-rank"] = "8"; })), results(d, { "lb-train/7.json": unlockRow })).last,
  "dr-setting-forbidden": (d) => ld(scratch(d, withTrain((t) => { t["--resume-from"] = "x"; })), ["config"]).last,
  "dr-setting-allowed": (d) => ld(scratch(d, withTrain((t) => { t["--foo"] = "1"; })), ["config"]).last,
  "dr-setting-values": (d) => ld(scratch(d, withTrain((t) => { t["--threads"] = "1;x"; })), ["config"]).last,
  "dr-deadline-cap": (d) => ld(scratch(d, (c) => { c.dailyRun.jobTimeoutMin = 400; }), ["config"]).last,
  "dr-r2-folder": (d) => ld(scratch(d, (c) => { c.dailyRun.r2Folder = "lm-saves"; }), ["config"]).last,
  "dr-cleared": (d) => ld(scratch(d, (c) => { c.dailyRun.corpus.docs = "0".repeat(64); }), ["config"]).last,
  "dr-marker": (d) => trusted(scratch(d), results(d, { [`lb-daily/${PREV}-100.json`]: goodRow({ marker: { ...marker(50, "save-000000050"), schema: "x" } }) })).last,
  "dr-row-fields": (d) => land(d, scratch(d), { ...goodRow(), weights: "w" }).last,
  "dr-row-pins": (d) => land(d, scratch(d), goodRow({ pins: { ...PINS, docs: "0".repeat(64) } })).last,
  "dr-row-values": (d) => land(d, scratch(d), goodRow({ heldoutBpb: -1 })).last,
  "dr-row-marker-match": (d) => land(d, scratch(d), goodRow({ endStep: 60 })).last,
  "dr-read-symlink": (d) => {
    const real = results(d, { [`lb-daily/${PREV}-100.json`]: goodRow() }), res = results(d); mkdirSync(join(res, "runs"));
    symlinkSync(join(real, "runs/lb-daily"), join(res, "runs/lb-daily"));
    return trusted(scratch(d), res).last;
  },
  "dr-record-name": (d) => trusted(scratch(d), results(d, { "lb-daily/2026-10-29-100.json": goodRow() })).last,
  "dr-once": (d) => trusted(scratch(d), results(d, { [`lb-daily/${T}-100.json`]: goodRow({ today: T }) })).last,
  "dr-one-chain": (d) => trusted(scratch(d), results(d, { [`lb-daily/${PREV}-100.json`]: goodRow(), "lb-daily/2026-10-29-90.json": goodRow({ today: "2026-10-29", runId: "90", chainId: "90" }) })).last,
  "dr-trusted-sha": (d) => restore(scratch(d), trustedFile(d, FRESH), stateWith(d, {}), "f".repeat(64)).last,
  "dr-fresh-empty": (d) => restore(scratch(d), trustedFile(d, FRESH), stateWith(d, { "save-000000010": "m" })).last,
  "dr-only-trusted-save": (d) => restore(scratch(d), trustedFile(d, resumeT(shaText("m50"))), stateWith(d, { "save-000000050": "m50", "save-000000060": "m60" })).last,
  "dr-save-sha": (d) => restore(scratch(d), trustedFile(d, resumeT(shaText("m50"))), stateWith(d, { "save-000000050": "m50 from the bucket, changed" })).last,
  "dr-chain-absent": (d) => restore(scratch(d), trustedFile(d, resumeT(shaText("m50"))), stateWith(d, { "save-000000050": "m50" }, marker(90, "save-000000090"))).last,
  "dr-job-start": (d) => cycleArgs(scratch(d), trustedFile(d, FRESH), now() + 1000).last,
  "dr-budget": (d) => cycleArgs(scratch(d), trustedFile(d, FRESH), now() - 290 * 60).last,
  "dr-report-trained": (d) => rowCase(d, scratch(d), { report: { status: "done" } }).last,
  "dr-row-save-sha": (d) => rowCase(d, scratch(d), { tamper: true }).last,
  "dr-row-uploaded": (d) => rowCase(d, scratch(d), { uploaded: "" }).last,
  "dr-row-chain": (d) => rowCase(d, scratch(d), { report: { startStep: 0 } }).last,
  "dr-land-id": (d) => land(d, scratch(d), goodRow(), { runId: "43" }).last,
  "dr-land-symlink": (d) => {
    const res = results(d), elsewhere = join(d, u("elsewhere")); mkdirSync(elsewhere); symlinkSync(elsewhere, join(res, "runs"));
    return land(d, scratch(d), goodRow(), { res }).last;
  },
};
const REAL: Record<string, string | RegExp> = {
  "dr-ref": "LB_DAILY_REF_NOT_MAIN", "dr-lora-locked": "LB_DAILY_LORA_LOCKED", "dr-lora-not-wired": "LB_DAILY_LORA_NOT_WIRED",
  "dr-setting-forbidden": "LB_DAILY_FORBIDDEN_SETTING", "dr-setting-allowed": "LB_DAILY_SETTING_NOT_ALLOWED", "dr-setting-values": "LB_DAILY_SETTING_NOT_ALLOWED",
  "dr-deadline-cap": "LB_DAILY_BAD_DEADLINE", "dr-r2-folder": "LB_DAILY_BAD_CONFIG", "dr-cleared": "LB_DAILY_NOT_CLEARED", "dr-marker": "LB_DAILY_RECORD_BAD",
  "dr-row-fields": "LB_DAILY_ROW_FIELD", "dr-row-pins": "LB_DAILY_PIN_MISMATCH", "dr-row-values": "LB_DAILY_ROW_VALUE", "dr-row-marker-match": "LB_DAILY_ROW_VALUE",
  "dr-read-symlink": "LB_DAILY_RECORD_BAD", "dr-record-name": "LB_DAILY_RECORD_BAD", "dr-once": "LB_DAILY_ALREADY_RAN", "dr-one-chain": "LB_DAILY_RECORD_BAD",
  "dr-trusted-sha": "LB_DAILY_UNTRUSTED", "dr-fresh-empty": "LB_DAILY_STATE_NOT_EMPTY", "dr-only-trusted-save": "LB_DAILY_SAVE_SET",
  "dr-save-sha": "LB_DAILY_SAVE_SHA_MISMATCH", "dr-chain-absent": "LB_DAILY_STATE_NOT_EMPTY", "dr-job-start": "LB_DAILY_BAD_DEADLINE", "dr-budget": "LB_DAILY_BAD_DEADLINE",
  "dr-report-trained": "LB_DAILY_TRAIN_ERROR", "dr-row-save-sha": "LB_DAILY_SAVE_SHA_MISMATCH", "dr-row-uploaded": "LB_DAILY_NOT_UPLOADED", "dr-row-chain": "LB_DAILY_ROW_VALUE",
  "dr-land-id": "LB_DAILY_ROW_VALUE", "dr-land-symlink": "LB_DAILY_LAND_SYMLINK",
};

test("M165 guards: every tagged lb_daily.py guard has a case; disabling it changes the outcome (killed mutant)", () => {
  const src = readFileSync(join(MODEL, "lb_daily.py"), "utf8");
  const tags = [...src.matchAll(/# guard:([a-z0-9-]+)$/gm)].map((m) => m[1]!);
  assert.deepEqual([...tags].sort(), Object.keys(CASES).sort(), "every tagged guard has a case and no case is untagged");
  assert.deepEqual(Object.keys(REAL).sort(), Object.keys(CASES).sort());
  assert.ok(tags.every((g) => g.startsWith("dr-")), "the dr- prefix (no collision with M157's daily- guards)");
  withDir((dir) => {
    for (const g of tags) {
      const real = CASES[g]!(join(dir));
      const want = REAL[g]!;
      if (typeof want === "string") assert.equal(real, want, `real outcome of ${g}`); else assert.match(real, want, `real outcome of ${g}`);
      const lines = src.split("\n");
      const i = lines.findIndex((l) => l.endsWith(`# guard:${g}`));
      assert.match(lines[i]!, /^\s+if .+:  # guard:/, `${g} is an if-guard`);
      lines[i] = lines[i]!.replace(/if .+:  # guard:/, "if False:  # guard:");
      MUTANT = lines.join("\n");
      let mutated: string;
      try { mutated = CASES[g]!(dir); } finally { MUTANT = null; }
      assert.notEqual(mutated, real, `guard ${g}: disabling it must change "${real}"`);
    }
  });
});

test("M165 near misses: the valid neighbour of each refusal passes", () => withDir((d) => {
  const root = scratch(d);
  assert.equal(ld(root, ["ref", "--ref", "refs/heads/main"]).last, "ref ok");
  assert.equal(ld(join(repo, "peaceai"), ["config"]).last, "config ok", "the committed config passes");
  assert.equal(ld(scratch(d, (c) => { c.dailyRun.jobTimeoutMin = 355; c.dailyRun.reserveMin = 55; }), ["config"]).last, "config ok", "the 355 cap itself");
  assert.equal(ld(scratch(d, withTrain((t) => { t["--threads"] = "2"; t["--lr"] = "0.0005"; })), ["config"]).last, "config ok", "allowed flags, plain values");
  // LoRA: locked with the baseline only equalled (not beaten), or beaten on another baseline; not wired once unlocked
  const lora = scratch(d, withTrain((t) => { t["--lora-rank"] = "8"; }));
  assert.equal(trusted(lora, results(d, { "lb-train/7.json": { ...unlockRow, heldoutBpb: 2.5156 } })).last, "LB_DAILY_LORA_LOCKED");
  assert.equal(trusted(lora, results(d, { "lb-train/7.json": { ...unlockRow, baselineBpb: 2.6, heldoutBpb: 2.55 } })).last, "LB_DAILY_LORA_LOCKED");
  assert.equal(trusted(lora, results(d, { "lb-train/7.json": { ...unlockRow, lora: true } })).last, "LB_DAILY_LORA_LOCKED", "a LoRA run does not unlock LoRA");
  assert.equal(trusted(lora, results(d, { "lb-train/7.json": unlockRow })).last, "LB_DAILY_LORA_NOT_WIRED");
  assert.equal(trusted(scratch(d, withTrain((t) => { t["--init-from"] = "x"; })), results(d)).last, "LB_DAILY_LORA_LOCKED", "--init-from is the LoRA path too");
  // without LoRA flags a beaten baseline changes nothing
  assert.match(trusted(root, results(d, { "lb-train/7.json": unlockRow })).last, /^trusted kind=fresh chain=- /);
  // the trusted record: fresh on an empty folder, resume from the newest row of one chain, done when the marker says so
  assert.match(trusted(root, results(d)).last, /^trusted kind=fresh /);
  const two = results(d, { [`lb-daily/${PREV}-100.json`]: goodRow({ endStep: 80, marker: marker(80, "save-000000080") }), "lb-daily/2026-10-29-90.json": goodRow({ today: "2026-10-29", runId: "90" }) });
  assert.equal(trusted(root, two).last, `trusted kind=resume chain=100 save=save-000000080 sha=${"a".repeat(64)} step=80 record=${PREV}-100.json`);
  assert.match(trusted(root, results(d, { [`lb-daily/${PREV}-100.json`]: goodRow({ stopReason: "patience", marker: marker(50, "save-000000050", false) }) })).last, /^trusted kind=done /);
  assert.match(trusted(root, results(d, { [`lb-daily/${PREV}-100.json`]: goodRow() }), T).last, /^trusted kind=resume /, "yesterday's row is not today's");
  // the outputs the workflow reads
  const out = join(d, "gho"); writeFileSync(out, "");
  const f = join(d, "tr.json");
  ld(root, ["trusted", "--out", f, "--today", T], { RESULTS_DIR: two, GITHUB_OUTPUT: out });
  assert.equal(readFileSync(out, "utf8"), `kind=resume\nchain=100\nsave=save-000000080\nsha=${"a".repeat(64)}\ntrusted_sha=${sha(f)}\n`);
  // restore: the trusted save alone, hashing to the trusted sha; chain.json comes from the record
  const t = trustedFile(d, resumeT(shaText("m50")));
  const s = stateWith(d, { "save-000000050": "m50" });
  assert.equal(restore(root, t, s).last, `restore resume save=save-000000050 sha=${shaText("m50")} step=50`);
  assert.deepEqual(json(join(s, "chain.json")), marker(50, "save-000000050", true, shaText("m50")));
  assert.equal(restore(root, trustedFile(d, FRESH), stateWith(d, {})).last, "restore fresh");
  assert.equal(restore(root, trustedFile(d, { ...FRESH, kind: "done", marker: marker(50, "save-000000050", false) }), stateWith(d, {})).last, "LB_DAILY_CHAIN_DONE");
  // cycle-args: the budget is cut to the train deadline; the expectation is the trusted sha
  const ca = cycleArgs(root, t, now() - 60);
  assert.equal(ca.status, 0);
  const lines = ca.out.split("\n");
  assert.deepEqual(lines.slice(0, 2), ["299", `resume:${shaText("m50")}`]);
  assert.deepEqual(lines.slice(2), Object.keys(CFG.dailyRun.train).sort().flatMap((k) => [k, CFG.dailyRun.train[k]]));
  assert.equal(cycleArgs(root, trustedFile(d, FRESH), now() - 60).out.split("\n")[1], "fresh");
  assert.equal(cycleArgs(root, trustedFile(d, FRESH), now() - 270 * 60).out.split("\n")[0], "30", "exactly minBudgetMin still runs");
  // row: fresh and resume
  assert.match(rowCase(d, root, { kind: "resume" }).last, /^lb-daily start=50 end=80 stop=deadline more=True heldout_bpb=3(\.0)? baseline_bpb=2\.5156 verdict=no_gain save=save-000000080 sha=[0-9a-f]{64} wall_s=\d+$/);
  assert.match(rowCase(d, root, { kind: "fresh" }).last, /^lb-daily start=0 end=80 /);
  // land: a new add-only file named <day>-<run id>.json, never latest.json; the same row twice is refused
  const l = land(d, root, goodRow());
  assert.equal(l.last, `landed runs/lb-daily/${PREV}-100.json`);
  assert.deepEqual(readdirSync(join(l.res, "runs/lb-daily")), [`${PREV}-100.json`]);
  assert.ok(!existsSync(join(l.res, "latest.json")));
  assert.equal(land(d, root, goodRow(), { res: l.res }).last, "LB_DAILY_ROW_EXISTS");
}));

// ---- the workflow ----

const STEP = (n: string) => `      - name: ${n}`;
const R2_SECRETS = ["LM_SAVES_R2_ACCOUNT_ID", "LM_SAVES_R2_ACCESS_KEY_ID", "LM_SAVES_R2_SECRET_ACCESS_KEY", "LM_SAVES_R2_BUCKET"];
const KEY_STEPS = ["Read the trusted record", "Record one add-only row in Results"];
const R2_STEPS = ["Restore the trusted save from R2", "Copy the new save to R2"];
const TSHA = "${{ steps.trusted.outputs.trusted_sha }}";
const GATE = "        if: steps.trusted.outputs.kind == 'fresh' || steps.trusted.outputs.kind == 'resume'\n";
const VERIFY_LINES = [
  `          test "$(git rev-parse HEAD)" = "$GITHUB_SHA" || { echo "checkout is not $GITHUB_SHA"; exit 1; }\n`,
  `          git diff --exit-code --stat HEAD -- || { echo "checkout modified: key refused"; exit 1; }\n`,
  `          test -z "$(git status --porcelain --untracked-files=all)" || { echo "untracked files in checkout: key refused"; exit 1; }\n`,
  `          printf '%s' "$KEY_SCRIPTS_SHA256" | sha256sum -c --quiet - || { echo "key script hash mismatch: key refused"; exit 1; }`,
];

/** The reviewed shape of peace-lb-daily.yml; returns the problem classes found. */
function lbDailyProblems(t: string, jobTimeoutMin: number): string[] {
  const p = new Set<string>();
  if (!t.includes("\non:\n  workflow_dispatch:\n\npermissions: {}\n") || (t.match(/^on:/gm) ?? []).length !== 1
    || /^\s*(schedule|push|pull_request|pull_request_target|workflow_run|workflow_call|repository_dispatch|merge_group|issue_comment|issues|release|inputs):/m.test(t)) p.add("trigger");
  if (!t.includes(`\n  lb-daily-ref-gate:\n    name: daily cycle ref gate (main only)\n    runs-on: ubuntu-24.04\n    timeout-minutes: 5\n    permissions: {}\n    steps:\n      - name: Refuse unless dispatched from main\n        run: test "$GITHUB_REF" = refs/heads/main || { echo "LB_DAILY_REF_NOT_MAIN"; exit 1; }\n`)) p.add("ref");
  const head = t.match(/\n  lb-daily:\n    name: [^\n]+\n    needs: lb-daily-ref-gate\n    if: github\.ref == 'refs\/heads\/main'\n    runs-on: ubuntu-24\.04\n    timeout-minutes: (\d+)\n    environment: peaceai-results\n    permissions:\n      contents: read\n    env:\n/);
  if (!head) p.add("ref");
  if (!t.includes(`run: python3 peaceai/model/lb_daily.py ref --ref "$GITHUB_REF" && python3 peaceai/model/lb_daily.py config\n`)) p.add("ref");
  const tm = t.match(/\n  lb-daily:\n(?:    [^\n]*\n)*?    timeout-minutes: (\d+)\n/);
  if (!tm || Number(tm[1]) !== jobTimeoutMin) p.add("timeout");
  if ((t.slice(t.indexOf("\njobs:\n")).match(/^  [A-Za-z0-9_-]+:$/gm) ?? []).length !== 2 || (t.match(/runs-on: /g) ?? []).length !== 2 || (t.match(/runs-on: ubuntu-24\.04\n/g) ?? []).length !== 2) p.add("runner");
  if (/upload-artifact|download-artifact|actions\/cache|^\s*cache(-dependency-path)?:|gh release|\bcurl\b|\bwget\b|\bscp\b|\brsync\b|rclone|\baws\b|s3:\/\//im.test(t)) p.add("store");
  for (const m of t.matchAll(/uses: ([^\n]+)/g)) if (!/^[a-z0-9-]+\/[a-z0-9-]+@[0-9a-f]{40} # v[\d.]+$/.test(m[1]!)) p.add("pin");
  if ((t.match(/actions\/checkout@/g) ?? []).length !== 1 || (t.match(/\n        with:\n          persist-credentials: false\n/g) ?? []).length !== 1 || /persist-credentials: true/.test(t)) p.add("creds");
  if (/--(lora|init-from|replay)|lora/i.test(t.split("\n").filter((l) => !/^\s*#|^      - name: /.test(l)).join("\n"))) p.add("lora");
  if (/latest\.json/.test(t.replaceAll("latest.json is never written", "").replaceAll("no latest.json", ""))) p.add("latest");
  if (/set -x|set -o xtrace|xtrace|printenv|\benv\s*(\||$)|\bexport -p\b|ACTIONS_STEP_DEBUG|::add-mask::|echo [^\n]*\$\{?(LM_SAVES_R2_|DEPLOY_KEY|AWS_)/m.test(t)) p.add("leak");
  // secrets: only as env of the named steps (the Results key in the two Results steps, the four R2 secrets in the two R2 steps)
  const steps = t.split(/\n(?=      - )/);
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
  if (seen !== 10 || (t.match(/secrets\./g) ?? []).length !== 10) p.add("secret");
  // the trusted record: read only from Results runs/lb-daily/ and runs/lb-train/; every sha the cycle uses is its output
  const tr = (steps.find((s) => s.startsWith(STEP("Read the trusted record"))) ?? "") + "\n";
  if (!tr.includes(`\n        id: trusted\n`) || !tr.includes(`./peaceai/bin/with-deploy-key.sh ./peaceai/bin/results-write.sh --sparse /runs/lb-daily/ --sparse /runs/lb-train/ "lb daily trusted record read (run $GITHUB_RUN_ID; writes nothing)" \\\n            python3 peaceai/model/lb_daily.py trusted --out "$RUNNER_TEMP/lb-trusted.json" --today "$LB_TODAY"\n`)) p.add("trusted");
  const shaLines = t.match(/^ +T_SHA: .*$/gm) ?? [];
  if (shaLines.length !== 3 || shaLines.some((l) => l.trim() !== `T_SHA: ${TSHA}`)) p.add("trusted");
  for (const v of ["T_KIND: ${{ steps.trusted.outputs.kind }}", "T_CHAIN: ${{ steps.trusted.outputs.chain }}", "T_SAVE: ${{ steps.trusted.outputs.save }}"]) if (!t.includes(`          ${v}\n`)) p.add("trusted");
  if ((t.match(/^ +T_[A-Z]+: .*$/gm) ?? []).some((l) => !l.includes("${{ steps.trusted.outputs."))) p.add("trusted");
  const restoreS = steps.find((s) => s.startsWith(STEP("Restore the trusted save from R2"))) ?? "";
  if (!restoreS.endsWith(`          "$RUNNER_TEMP/venv/bin/python" peaceai/model/lb_daily.py restore --trusted "$RUNNER_TEMP/lb-trusted.json" --trusted-sha "$T_SHA" --state "$RUNNER_TEMP/lbs"`)
    || !restoreS.includes(`./peaceai/bin/lm-saves-r2.sh --folder lb-daily get "$T_CHAIN" "$T_SAVE" "$RUNNER_TEMP/lbs/saves/$T_SAVE"\n`)) p.add("trusted");
  if (!t.includes(`        run: ./peaceai/bin/lb-daily-run.sh "$RUNNER_TEMP/lbc/out" "$RUNNER_TEMP/lbs" "$RUNNER_TEMP/lb-trusted.json" "$T_SHA"\n`)) p.add("trusted");
  if (/resume-from|resume-manifest|manifestSha256[^\n]*T_SHA|inputs\./.test(t)) p.add("trusted");
  if (!t.includes(`./peaceai/bin/lm-saves-r2.sh --folder lb-daily put-one "$chain" "$RUNNER_TEMP/lbs/saves" "$save" "$sha"\n`)) p.add("store"); // no extra arg; the bucket is add-only
  // re-verify (Auditor #657): the checkout and key scripts are verified again in the step right before each later key use
  for (const [verifyName, keyName] of [["Re-verify the checkout and the key scripts right before the R2 key is used again (copy)", "Copy the new save to R2"], ["Re-verify the checkout and the key scripts right before the deploy key is used again (land)", "Record one add-only row in Results"]]) {
    const k = steps.findIndex((x) => x.startsWith(STEP(keyName)));
    const v = k > 0 ? steps[k - 1]! + "\n" : "";
    if (!v.startsWith(STEP(verifyName) + "\n" + GATE + "        run: |\n          set -euo pipefail\n") || !VERIFY_LINES.every((l) => v.includes(l)) || /secrets\./.test(v)) p.add("reverify");
  }
  if ((t.match(/lm-saves-r2\.sh/g) ?? []).length !== 3 || (t.match(/lm-saves-r2\.sh --folder lb-daily /g) ?? []).length !== 3) p.add("store");
  // order: verify -> trusted -> corpus -> restore (sha check) -> cycle -> upload -> row -> land -> cleanup
  const order = [STEP("Verify the checkout and the key scripts before any key is used"), STEP("Read the trusted record"), "lb-corpus-rebuild.sh", STEP("Restore the trusted save from R2"),
    "lb-daily-run.sh", STEP("Copy the new save to R2"), "lb_daily.py row", STEP("Record one add-only row in Results"), STEP("Remove the corpus, state and venv")].map((s) => t.indexOf(s));
  if (order.some((x, i) => x < 0 || (i > 0 && x < order[i - 1]!))) p.add("order");
  const firstKey = t.indexOf("secrets."), verify = t.indexOf("printf '%s' \"$KEY_SCRIPTS_SHA256\" | sha256sum -c --quiet -");
  if (verify < 0 || firstKey < verify) p.add("order");
  const ti = steps.findIndex((x) => x.startsWith(STEP("Read the trusted record")));
  for (const s of steps.slice(ti + 1, -1)) if (!s.includes("\n        if: steps.trusted.outputs.kind ")) p.add("order"); // every step after the trusted read runs only on its verdict
  const landS = `./peaceai/bin/with-deploy-key.sh ./peaceai/bin/results-write.sh --sparse "/runs/lb-daily/$LB_TODAY-$GITHUB_RUN_ID.json" "lb daily cycle metrics ($LB_TODAY, run $GITHUB_RUN_ID)" \\\n            python3 peaceai/model/lb_daily.py land --row "$RUNNER_TEMP/lb-daily-row.json" --run-id "$GITHUB_RUN_ID" --today "$LB_TODAY"\n`;
  if ((t.match(/results-write\.sh/g) ?? []).length !== 4 || !t.includes(landS)) p.add("land");
  if (!/\n      - name: Remove the corpus, state and venv[^\n]*\n        if: always\(\)\n        run: rm -rf "\$RUNNER_TEMP\/lbc" "\$RUNNER_TEMP\/lbs" [^\n]*\n$/.test(t)) p.add("cleanup");
  return [...p].sort();
}

test("M165 workflow: peace-lb-daily.yml has the reviewed shape; each guard kills its mutant and a near miss passes", () => {
  const wf = read(WF);
  const jt = CFG.dailyRun.jobTimeoutMin;
  assert.deepEqual(lbDailyProblems(wf, jt), []);
  const step = (body: string) => wf.replace("      - name: Remove the corpus, state and venv", `${body}      - name: Remove the corpus, state and venv`);
  const cyc = `        run: ./peaceai/bin/lb-daily-run.sh "$RUNNER_TEMP/lbc/out" "$RUNNER_TEMP/lbs" "$RUNNER_TEMP/lb-trusted.json" "$T_SHA"\n`;
  const mutants: [string, string, string][] = [
    ["ref", "gate step removed", wf.replace(`test "$GITHUB_REF" = refs/heads/main || { echo "LB_DAILY_REF_NOT_MAIN"; exit 1; }`, "echo gate")],
    ["ref", "job if without the ref", wf.replace("    if: github.ref == 'refs/heads/main'\n", "    if: always()\n")],
    ["ref", "job not behind the gate", wf.replace("    needs: lb-daily-ref-gate\n", "")],
    ["ref", "no in-job ref check", wf.replace(`python3 peaceai/model/lb_daily.py ref --ref "$GITHUB_REF" && `, "")],
    ["trigger", "schedule trigger", wf.replace("on:\n  workflow_dispatch:\n", "on:\n  workflow_dispatch:\n  schedule:\n    - cron: '0 3 * * *'\n")],
    ["trigger", "push trigger", wf.replace("on:\n  workflow_dispatch:\n", "on:\n  push:\n    branches: [main]\n  workflow_dispatch:\n")],
    ["trigger", "dispatch inputs (a caller-chosen resume)", wf.replace("on:\n  workflow_dispatch:\n", "on:\n  workflow_dispatch:\n    inputs:\n      sha:\n        default: \"\"\n")],
    ["store", "upload-artifact step", step("      - uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02 # v4.6.2\n        with:\n          path: ${{ runner.temp }}/lbs\n")],
    ["store", "cache step", step("      - uses: actions/cache@5a3ec84eff668545956fd18022155c47e93e2684 # v4.2.3\n        with:\n          path: ${{ runner.temp }}/lbs\n          key: lb\n")],
    ["store", "setup-node cache", wf.replace("          node-version: 22\n", "          node-version: 22\n          cache: npm\n")],
    ["store", "direct aws copy", step('      - name: Save\n        run: aws s3 cp "$RUNNER_TEMP/lbs" s3://x --recursive\n')],
    ["store", "the saves folder of the M148 chain", wf.replace("lm-saves-r2.sh --folder lb-daily put-one", "lm-saves-r2.sh put-one")],
    ["trusted", "resume sha from the restored chain.json", wf.replace(cyc, `        run: ./peaceai/bin/lb-daily-run.sh "$RUNNER_TEMP/lbc/out" "$RUNNER_TEMP/lbs" "$RUNNER_TEMP/lb-trusted.json" "$(jq -r .manifestSha256 "$RUNNER_TEMP/lbs/chain.json")"\n`)],
    ["trusted", "T_SHA from the bucket-side output", wf.replace(`          T_SHA: ${TSHA}\n        run: ./peaceai`, `          T_SHA: \${{ steps.r2.outputs.sha }}\n        run: ./peaceai`)],
    ["trusted", "save name from somewhere else", wf.replace("          T_SAVE: ${{ steps.trusted.outputs.save }}\n          T_SHA", "          T_SAVE: latest\n          T_SHA")],
    ["trusted", "no sha check after the R2 get", wf.replace(`\n          "$RUNNER_TEMP/venv/bin/python" peaceai/model/lb_daily.py restore --trusted "$RUNNER_TEMP/lb-trusted.json" --trusted-sha "$T_SHA" --state "$RUNNER_TEMP/lbs"`, "")],
    ["trusted", "trusted record read from a wider path", wf.replace("--sparse /runs/lb-daily/ --sparse /runs/lb-train/ ", "--sparse /runs/ ")],
    ["order", "restore after the cycle", (() => { const a = wf.indexOf(STEP("Restore the trusted save from R2")), b = wf.indexOf(STEP("Daily cycle")), c = wf.indexOf(STEP("Copy the new save to R2")); return wf.slice(0, a) + wf.slice(b, c) + wf.slice(a, b) + wf.slice(c); })()],
    ["order", "cycle not gated on the trusted kind", wf.replace(`        if: steps.trusted.outputs.kind == 'fresh' || steps.trusted.outputs.kind == 'resume'\n        env:\n          PY:`, "        env:\n          PY:")],
    ["lora", "LoRA flag", wf.replace(cyc, cyc.replace('lb-daily-run.sh "', 'lb-daily-run.sh --lora-rank 4 "'))],
    ["secret", "R2 secret in the cycle step", wf.replace("          PY: ${{ runner.temp }}/venv/bin/python\n          T_SHA", "          PY: ${{ runner.temp }}/venv/bin/python\n          LM_SAVES_R2_SECRET_ACCESS_KEY: ${{ secrets.LM_SAVES_R2_SECRET_ACCESS_KEY }}\n          T_SHA")],
    ["secret", "Results key at job level", wf.replace('      PYTHONDONTWRITEBYTECODE: "1"\n', '      PYTHONDONTWRITEBYTECODE: "1"\n      DEPLOY_KEY: ${{ secrets.PEACEAI_RESULTS_DEPLOY_KEY }}\n')],
    ["secret", "Results key in an R2 step", wf.replace("          LM_SAVES_R2_BUCKET: ${{ secrets.LM_SAVES_R2_BUCKET }}\n          T_KIND", "          LM_SAVES_R2_BUCKET: ${{ secrets.LM_SAVES_R2_BUCKET }}\n          DEPLOY_KEY: ${{ secrets.PEACEAI_RESULTS_DEPLOY_KEY }}\n          T_KIND")],
    ["secret", "secret inlined in a run line", step('      - name: Probe\n        run: test -n "${{ secrets.LM_SAVES_R2_BUCKET }}"\n')],
    ["leak", "set -x", wf.replace("          set -euo pipefail\n          ./peaceai/bin/lm-saves-r2.sh --folder lb-daily check", "          set -euxo pipefail\n          set -x\n          ./peaceai/bin/lm-saves-r2.sh --folder lb-daily check")],
    ["leak", "secret echoed", wf.replace("          ./peaceai/bin/lm-saves-r2.sh --folder lb-daily check\n", '          echo "bucket $LM_SAVES_R2_BUCKET"\n          ./peaceai/bin/lm-saves-r2.sh --folder lb-daily check\n')],
    ["latest", "latest.json write", step('      - name: Promote\n        run: cp "$RUNNER_TEMP/lb-daily-row.json" latest.json\n')],
    ["pin", "unpinned action", wf.replace("actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 # v7.1.0", "actions/setup-node@v4")],
    ["creds", "persisted checkout credentials", wf.replace("persist-credentials: false", "persist-credentials: true")],
    ["runner", "self-hosted runner", wf.replace("    if: github.ref == 'refs/heads/main'\n    runs-on: ubuntu-24.04", "    if: github.ref == 'refs/heads/main'\n    runs-on: self-hosted")],
    ["runner", "a third job", wf + "\n  extra:\n    runs-on: ubuntu-24.04\n    steps:\n      - run: true\n"],
    ["timeout", "job cap above the config", wf.replace("    timeout-minutes: 355\n", "    timeout-minutes: 360\n")],
    ["land", "landing without --sparse", wf.replace('results-write.sh --sparse "/runs/lb-daily/$LB_TODAY-$GITHUB_RUN_ID.json" ', "results-write.sh ")],
    ["land", "landing a whole dir", wf.replace('--sparse "/runs/lb-daily/$LB_TODAY-$GITHUB_RUN_ID.json"', '--sparse "/runs/"')],
    ["order", "no checkout verify before the key", wf.replace("printf '%s' \"$KEY_SCRIPTS_SHA256\" | sha256sum -c --quiet - || { echo \"key script hash mismatch: key refused\"; exit 1; }\n", "true\n")],
    ["reverify", "no re-verify before the copy (R2 key)", (() => { const a = wf.indexOf(STEP("Re-verify the checkout and the key scripts right before the R2 key")), b = wf.indexOf(STEP("Copy the new save to R2")); return wf.slice(0, a) + wf.slice(b); })()],
    ["reverify", "no re-verify before the land (deploy key)", (() => { const a = wf.indexOf(STEP("Re-verify the checkout and the key scripts right before the deploy key")), b = wf.indexOf(STEP("Record one add-only row in Results")); return wf.slice(0, a) + wf.slice(b); })()],
    ["reverify", "re-verify before the land moved earlier (the row step in between)", (() => { const a = wf.indexOf(STEP("Build the metrics row")), b = wf.indexOf(STEP("Re-verify the checkout and the key scripts right before the deploy key")), c = wf.indexOf(STEP("Record one add-only row in Results")); return wf.slice(0, a) + wf.slice(b, c) + wf.slice(a, b) + wf.slice(c); })()],
    ["reverify", "re-verify without the key script hash check", wf.replace(/(Re-verify the checkout and the key scripts right before the R2 key[^]*?)printf '%s' "\$KEY_SCRIPTS_SHA256" \| sha256sum -c --quiet - \|\| \{ echo "key script hash mismatch: key refused"; exit 1; \}/, "$1true")],
    ["reverify", "re-verify without the untracked-files check", wf.replace(/(Re-verify the checkout and the key scripts right before the deploy key[^]*?)          test -z "\$\(git status --porcelain --untracked-files=all\)" [^\n]*\n/, "$1")],
    ["store", "put-one with an extra keep argument", wf.replace('"$save" "$sha"\n', '"$save" "$sha" "$T_CHAIN"\n')],
    ["cleanup", "no cleanup", wf.replace('        if: always()\n        run: rm -rf "$RUNNER_TEMP/lbc"', '        run: rm -rf "$RUNNER_TEMP/lbc"')],
  ];
  for (const [want, what, text] of mutants) {
    assert.notEqual(text, wf, `${what}: the mutation applies`);
    assert.ok(lbDailyProblems(text, jt).includes(want), `${what}: expected ${want}, got ${lbDailyProblems(text, jt)}`);
  }
  // near misses: a comment about caches, an echo of a non-secret, a longer cleanup, still pass
  assert.deepEqual(lbDailyProblems(step("      # the saves go to R2 only: nothing is uploaded as an artifact\n"), jt), []);
  assert.deepEqual(lbDailyProblems(wf.replace('          echo "LB_UPLOADED=$save:$sha" >> "$GITHUB_ENV"\n', '          echo "LB_UPLOADED=$save:$sha" >> "$GITHUB_ENV"\n          echo "uploaded $save"\n'), jt), []);
  assert.deepEqual(lbDailyProblems(wf.replace('"$RUNNER_TEMP/venv"\n', '"$RUNNER_TEMP/venv" "$RUNNER_TEMP/tmp"\n'), jt), []);
  // near miss: a re-verify step with one more harmless check line still passes
  assert.deepEqual(lbDailyProblems(wf.replace(/(Re-verify the checkout and the key scripts right before the deploy key[^]*?set -euo pipefail\n)/, '$1          test -d "$RUNNER_TEMP"\n'), jt), []);
  // the key scripts are pinned to their committed bytes (checked before any key is used)
  for (const f of ["peaceai/bin/with-deploy-key.sh", "peaceai/bin/results-write.sh"]) assert.ok(wf.includes(`\n        ${sha(join(repo, f))}  ${f}\n`), f);
  // one workflow runs the daily cycle, and the M148 / lb-first-run workflow does not
  assert.ok(!/lb_daily|lb-daily/.test(read(".github/workflows/peace-lm-train.yml")));
});

// ---- shell: lb-daily-cycle.sh LB_DAILY_EXPECT, lb-daily-run.sh, lm-saves-r2.sh put-one ----

/** root with a tiny cleared corpus as dailyRun.corpus and tiny train settings. */
function tinyRoot(dir: string, c: string, files: Record<string, string> = {}) {
  return scratch(dir, (cfg) => { cfg.dailyRun.corpus = pinsOf(c); cfg.clearedCorpora.push({ ...pinsOf(c) }); cfg.dailyRun.train = { ...TINY_TRAIN }; }, files);
}
const runDay = (root: string, c: string, s: string, t: { f: string; sha: string }, today: string, env: Record<string, string> = {}) => {
  const r = spawnSync("bash", [join(root, "bin/lb-daily-run.sh"), c, s, t.f, t.sha], { encoding: "utf8",
    env: { ...process.env, PY: PYNN, LB_JOB_START: String(now() - 30), LB_TODAY: today, LB_MODEL_DIR: join(root, "model"), ...env } });
  return { status: r.status, out: r.stdout.trim(), err: r.stderr };
};
const cycleSh = (root: string, c: string, s: string, today: string, expect: string) => spawnSync("bash", [join(root, "bin/lb-daily-cycle.sh"), c, s, "2", today, "--",
  ...Object.entries(TINY_TRAIN).flat()], { encoding: "utf8", env: { ...process.env, PEACEAI_PYTHON: PYNN, LB_DAILY_EXPECT: expect } });

test("M165 chain: fresh day -> R2 (fake) -> row -> land; next day resumes ONLY the trusted save after its sha check; done", () => withDir((dir) => {
  const c = tinyCorpus(dir), root = tinyRoot(dir, c), res = results(dir), bucket = join(dir, "bucket");
  const day = (today: string, runId: string) => {
    const tf = join(dir, u("trusted") + ".json"), gho = join(dir, u("gho")); writeFileSync(gho, "");
    const tr = ld(root, ["trusted", "--out", tf, "--today", today], { RESULTS_DIR: res, GITHUB_OUTPUT: gho });
    assert.equal(tr.status, 0, tr.out);
    const o = Object.fromEntries(readFileSync(gho, "utf8").trim().split("\n").map((l) => l.split("=") as [string, string]));
    const t = { f: tf, sha: o.trusted_sha! };
    if (o.kind === "done") return { kind: "done", out: tr.out };
    const s = join(dir, u("state")); mkdirSync(join(s, "saves"), { recursive: true });
    if (o.kind === "resume") cpSync(join(bucket, o.chain!, o.save!), join(s, "saves", o.save!), { recursive: true }); // what lm-saves-r2.sh get leaves
    const rs = restore(root, t, s);
    assert.equal(rs.status, 0, rs.out);
    const r = runDay(root, c, s, t, today);
    assert.equal(r.status, 0, r.out + r.err);
    const mk = json(join(s, "chain.json"));
    const chain = o.chain || runId;
    cpSync(join(s, "saves", mk.save), join(bucket, chain, mk.save), { recursive: true }); // what put-one uploads
    const rowFile = join(dir, u("row") + ".json");
    const row = ld(root, ["row", "--trusted", tf, "--trusted-sha", t.sha, "--state", s, "--today", today, "--run-id", runId, "--sha", SHA40, "--job-start", String(now() - 30),
      "--uploaded", `${mk.save}:${mk.manifestSha256}`, "--out", rowFile]);
    assert.equal(row.status, 0, row.out);
    const ln = ld(root, ["land", "--row", rowFile, "--run-id", runId, "--today", today], { RESULTS_DIR: res });
    assert.equal(ln.out, `landed runs/lb-daily/${today}-${runId}.json`);
    return { kind: o.kind, out: r.out, row: json(join(res, `runs/lb-daily/${today}-${runId}.json`)), s, t };
  };
  const d1 = day("2026-11-01", "501");
  assert.equal(d1.kind, "fresh");
  assert.match(d1.out, /^plan fresh start=0\ndaily 2026-11-01 status=trained start=0 end=4 stop=max_steps_this_run /);
  assert.deepEqual([d1.row.chainId, d1.row.startStep, d1.row.endStep, d1.row.resumedFrom, d1.row.marker.more], ["501", 0, 4, null, true]);
  assert.ok(!existsSync(join(res, "latest.json")));
  const d2 = day("2026-11-02", "502");
  assert.equal(d2.kind, "resume");
  assert.match(d2.out, new RegExp(`^plan resume start=4 save=save-000000004 sha=${d1.row.marker.manifestSha256}\\ndaily 2026-11-02 status=trained start=4 end=8 stop=steps `));
  assert.deepEqual([d2.row.chainId, d2.row.startStep, d2.row.endStep, d2.row.resumedFrom, d2.row.marker.more], ["501", 4, 8, d1.row.marker.manifestSha256, false]);
  const d3 = day("2026-11-03", "503");
  assert.equal(d3.kind, "done");
  assert.deepEqual(readdirSync(join(res, "runs/lb-daily")).sort(), ["2026-11-01-501.json", "2026-11-02-502.json"], "add-only: one new file per trained day");
}));

test("M165 save sha: a tampered bucket save is refused before any resume; the cycle refuses a plan that is not the trusted one", () => withDir((dir) => {
  const c = tinyCorpus(dir), root = tinyRoot(dir, c);
  // day 1 locally, to get a real save
  const s1 = join(dir, "s1"); mkdirSync(join(s1, "saves"), { recursive: true });
  const t0 = trustedFile(dir, FRESH);
  assert.equal(restore(root, t0, s1).last, "restore fresh");
  const r1 = runDay(root, c, s1, t0, "2026-11-01");
  assert.equal(r1.status, 0, r1.out + r1.err);
  const mk = json(join(s1, "chain.json"));
  const tRes = trustedFile(dir, { kind: "resume", chainId: "501", marker: mk, row: "2026-11-01-501.json" });
  // tampered: the bucket copy differs from the trusted manifest sha -> refused by restore, nothing trains
  const s2 = join(dir, "s2"); mkdirSync(join(s2, "saves"), { recursive: true }); cpSync(join(s1, "saves", mk.save), join(s2, "saves", mk.save), { recursive: true });
  writeFileSync(join(s2, "saves", mk.save, "manifest.json"), readFileSync(join(s2, "saves", mk.save, "manifest.json"), "utf8").replace("}", ', "x": 1}'));
  assert.equal(restore(root, tRes, s2).last, "LB_DAILY_SAVE_SHA_MISMATCH");
  assert.ok(!existsSync(join(s2, "chain.json")) && !existsSync(join(s2, "work")), "nothing written, nothing trained");
  // untrusted sha source: a state whose own chain.json points elsewhere is refused by the cycle (LB_DAILY_EXPECT)
  const s3 = join(dir, "s3"); cpSync(s1, s3, { recursive: true });
  const bad = cycleSh(root, c, s3, "2026-11-02", `resume:${"e".repeat(64)}`);
  assert.equal(bad.status, 3); assert.equal(bad.stdout.trim().split("\n").pop(), "DAILY_PLAN_UNTRUSTED");
  assert.ok(!existsSync(join(s3, "logs/2026-11-02.log")) && !existsSync(join(s3, "work/2026-11-02/stop.json")), "refused before training");
  const s3b = join(dir, "s3b"); cpSync(s1, s3b, { recursive: true });
  const fresh = cycleSh(root, c, s3b, "2026-11-02", "fresh");
  assert.equal(fresh.stdout.trim().split("\n").pop(), "DAILY_PLAN_UNTRUSTED", "a resume plan when the record says fresh");
  // near miss: the trusted sha passes
  const s3c = join(dir, "s3c"); cpSync(s1, s3c, { recursive: true });
  const good = cycleSh(root, c, s3c, "2026-11-02", `resume:${mk.manifestSha256}`);
  assert.equal(good.status, 0, good.stdout + good.stderr);
  assert.match(good.stdout, /^plan resume start=4 /);
  // killed mutant: without the LB_DAILY_EXPECT check the untrusted plan trains
  const src = readFileSync(join(repo, "peaceai/bin/lb-daily-cycle.sh"), "utf8");
  const anchor = `    [ -z "$expect" ] || [ "$expect" = "resume:\${sh#sha=}" ] || { echo "DAILY_PLAN_UNTRUSTED"; exit 3; }\n`;
  assert.equal(src.split(anchor).length, 2);
  const mroot = tinyRoot(dir, c, { "bin/lb-daily-cycle.sh": src.replace(anchor, "") });
  const s4 = join(dir, "s4"); cpSync(s1, s4, { recursive: true });
  const m = cycleSh(mroot, c, s4, "2026-11-02", `resume:${"e".repeat(64)}`);
  assert.notEqual(m.stdout.trim().split("\n").pop(), "DAILY_PLAN_UNTRUSTED", "mutant killed: the check is what refuses");
  const fanchor = `  "plan fresh start=0") [ -z "$expect" ] || [ "$expect" = fresh ] || { echo "DAILY_PLAN_UNTRUSTED"; exit 3; } ;;\n`;
  assert.equal(src.split(fanchor).length, 2);
  const froot = tinyRoot(dir, c, { "bin/lb-daily-cycle.sh": src.replace(fanchor, `  "plan fresh start=0") ;;\n`) });
  const s5 = join(dir, "s5"); mkdirSync(join(s5, "saves"), { recursive: true });
  for (const sub of ["work", "logs", "reports"]) mkdirSync(join(s5, sub));
  const s5b = join(dir, "s5b"); cpSync(s5, s5b, { recursive: true });
  assert.equal(cycleSh(root, c, s5b, "2026-11-02", `resume:${"e".repeat(64)}`).stdout.trim().split("\n").pop(), "DAILY_PLAN_UNTRUSTED", "fresh plan, resume record");
  const s6 = join(dir, "s6"); cpSync(s5, s6, { recursive: true });
  assert.notEqual(cycleSh(froot, c, s6, "2026-11-02", `resume:${"e".repeat(64)}`).stdout.trim().split("\n").pop(), "DAILY_PLAN_UNTRUSTED", "mutant killed (fresh)");
}));

const R2_ENV = { LM_SAVES_R2_ACCOUNT_ID: "0123456789abcdef0123456789abcdef", LM_SAVES_R2_ACCESS_KEY_ID: "AKEYID0123456789abcd", LM_SAVES_R2_SECRET_ACCESS_KEY: "sEcReT0123456789abcdef0123456789", LM_SAVES_R2_BUCKET: "peace-lm-saves-test" };
const FAKE_AWS = `#!/usr/bin/env bash
# fake aws (m165, as m148): s3://BUCKET/KEY is $FAKE_S3/BUCKET/KEY; every call is logged
echo "argv=$*" >> "$FAKE_S3.log"
[ "$1" = s3 ] || { echo "$1 $2" >> "$FAKE_S3.deletes"; exit 2; }  # s3api delete-object(s), etc.: never allowed
op=$2; shift 2
args=(); for a in "$@"; do case "$a" in --recursive|--only-show-errors) ;; *) args+=("$a");; esac; done
loc() { echo "$FAKE_S3/\${1#s3://}"; }
case "$op" in
  cp) src=\${args[0]} dst=\${args[1]}
    if [[ "$src" == s3://* ]]; then s=$(loc "$src"); [ -d "$s" ] || exit 1; mkdir -p "$dst"; cp -R "$s"/. "$dst"/
    else d=$(loc "$dst"); mkdir -p "$(dirname "$d")"; cp "$src" "$d"; fi ;;
  ls) d=$(loc "\${args[0]}"); [ -d "$d" ] || exit 1; for x in "$d"/*/; do [ -d "$x" ] && echo "                           PRE $(basename "$x")/"; done ;;
  *) echo "s3 $op" >> "$FAKE_S3.deletes"; exit 2 ;;  # rm, rb, mv, sync --delete: the bucket is add-only
esac
`;

function r2(dir: string, script: string, args: string[]) {
  const bin = join(dir, "fbin"); mkdirSync(bin, { recursive: true }); writeFileSync(join(bin, "aws"), FAKE_AWS); chmodSync(join(bin, "aws"), 0o755);
  const s3 = join(dir, "s3");
  const r = spawnSync("bash", [script, ...args], { encoding: "utf8", cwd: dir, env: { PATH: `${bin}:/usr/bin:/bin`, FAKE_S3: s3, ...R2_ENV } });
  const log = existsSync(`${s3}.log`) ? readFileSync(`${s3}.log`, "utf8") : "";
  const deletes = existsSync(`${s3}.deletes`) ? readFileSync(`${s3}.deletes`, "utf8") : "";
  return { status: r.status, out: r.stdout + r.stderr, s3, log, deletes };
}

test("M165 R2: put-one uploads only a save whose manifest hashes to the given sha into lb-daily/, refuses an existing name, and deletes nothing", () => withDir((dir) => {
  const R2 = join(repo, "peaceai/bin/lm-saves-r2.sh");
  const src = readFileSync(R2, "utf8");
  // Auditor #657 bar: no delete form anywhere in the script
  assert.ok(!/ rm |\brm\b|delete-object|delete-objects|\brb\b|s3api|\bmv\b|--delete/.test(src.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n")), "lm-saves-r2.sh has no bucket delete");
  const saves = join(dir, "saves");
  const mk = (n: string, m: string) => { mkdirSync(join(saves, n), { recursive: true }); writeFileSync(join(saves, n, "checkpoint.npz"), "ck"); writeFileSync(join(saves, n, "manifest.json"), m); };
  mk("save-000000008", '{"step":8}');
  const good = shaText('{"step":8}');
  const chainDir = join(dir, "s3/peace-lm-saves-test/lb-daily/501");
  // bucket already holds the trusted save and an older one
  for (const n of ["save-000000002", "save-000000004"]) { mkdirSync(join(chainDir, n), { recursive: true }); writeFileSync(join(chainDir, n, "manifest.json"), "{}"); }
  const bad = r2(dir, R2, ["--folder", "lb-daily", "put-one", "501", saves, "save-000000008", "f".repeat(64)]);
  assert.equal(bad.status, 1); assert.equal(bad.out.trim(), "R2_SHA_MISMATCH");
  assert.ok(!/argv=s3 cp/.test(bad.log), "nothing uploaded on a mismatch");
  const ok = r2(dir, R2, ["--folder", "lb-daily", "put-one", "501", saves, "save-000000008", good]);
  assert.equal(ok.status, 0, ok.out);
  assert.equal(ok.out.trim(), `R2_PUT save=save-000000008 manifest=${good}`);
  assert.equal(ok.deletes, "", "no delete call reached the bucket");
  assert.deepEqual(readdirSync(chainDir).sort(), ["save-000000002", "save-000000004", "save-000000008"], "add-only: every earlier save stays");
  const cps = ok.log.split("\n").filter((l) => l.startsWith("argv=s3 cp"));
  assert.ok(cps.at(-1)!.includes("/manifest.json"), "manifest last");
  assert.ok(cps.every((l) => l.includes("s3://peace-lm-saves-test/lb-daily/501/save-000000008/")), "only lb-daily/<chain>/<save>/");
  for (const v of Object.values(R2_ENV)) assert.ok(!ok.out.includes(v) && !bad.out.includes(v), "no credential, account id or bucket name in the output");
  // an existing name is refused before any upload (s3 cp would overwrite it silently); the bucket copy is unchanged
  const before = readFileSync(join(chainDir, "save-000000004/manifest.json"), "utf8");
  mk("save-000000004", '{"step":4,"other":1}');
  const ex = r2(dir, R2, ["--folder", "lb-daily", "put-one", "501", saves, "save-000000004", shaText('{"step":4,"other":1}')]);
  assert.equal(ex.status, 1); assert.equal(ex.out.trim(), "R2_SAVE_EXISTS");
  assert.equal(readFileSync(join(chainDir, "save-000000004/manifest.json"), "utf8"), before, "not overwritten");
  assert.equal(ex.log.split("\n").filter((l) => l.startsWith("argv=s3 cp")).length, cps.length, "no cp after the refusal");
  // near miss: the same name under another chain is new there
  const nm = r2(dir, R2, ["--folder", "lb-daily", "put-one", "502", saves, "save-000000004", shaText('{"step":4,"other":1}')]);
  assert.equal(nm.status, 0, nm.out); assert.match(nm.out, /^R2_PUT save=save-000000004 manifest=[0-9a-f]{64}$/m);
  // the old trailing keep argument is refused now (nothing is pruned)
  assert.equal(r2(dir, R2, ["--folder", "lb-daily", "put-one", "501", saves, "save-000000008", good, "save-000000004"]).out.trim(), "R2_BAD_ARGS");
  // near misses / refusals: only lm-saves or lb-daily folders; bad names
  assert.equal(r2(dir, R2, ["--folder", "other", "check"]).out.trim(), "R2_BAD_ARGS");
  assert.equal(r2(dir, R2, ["--folder", "lb-daily", "put-one", "501", saves, "../x", good]).out.trim(), "R2_BAD_ARGS");
  const fresh = (name: string) => { const md = join(dir, name); mkdirSync(md); cpSync(saves, join(md, "saves"), { recursive: true }); cpSync(join(dir, "s3"), join(md, "s3"), { recursive: true }); return md; };
  // killed mutant: without the sha check the mismatched save is uploaded
  const anchor = `  [ "$(sha256sum "$man" | cut -c1-64)" = "$want" ] || die R2_SHA_MISMATCH\n`;
  assert.equal(src.split(anchor).length, 2);
  const mut = join(dir, "mut.sh"); writeFileSync(mut, src.replace(anchor, ""));
  const md = fresh("m");
  assert.notEqual(r2(md, mut, ["--folder", "lb-daily", "put-one", "503", join(md, "saves"), "save-000000008", "f".repeat(64)]).out.trim(), "R2_SHA_MISMATCH");
  // killed mutant: without the exists check the existing save is overwritten
  const xanchor = `  exists "$chain" "$name"; case $? in 0) die R2_SAVE_EXISTS ;; 1) ;; *) exit 1 ;; esac\n`;
  assert.equal(src.split(xanchor).length, 2);
  const mut2 = join(dir, "mut2.sh"); writeFileSync(mut2, src.replace(xanchor, ""));
  const md2 = fresh("m2");
  const ow = r2(md2, mut2, ["--folder", "lb-daily", "put-one", "501", join(md2, "saves"), "save-000000004", shaText('{"step":4,"other":1}')]);
  assert.equal(ow.status, 0); assert.notEqual(readFileSync(join(md2, "s3/peace-lm-saves-test/lb-daily/501/save-000000004/manifest.json"), "utf8"), before, "mutant killed: the overwrite happens without the check");
  // killed mutant: a delete call (the removed prune) is caught by the fake bucket
  const mut3 = join(dir, "mut3.sh");
  writeFileSync(mut3, src.replace(`  echo "R2_PUT save=$name manifest=$want"\n}`, `  echo "R2_PUT save=$name manifest=$want"\n  q s3 rm "s3://$B/$F/$chain/save-000000002/" --recursive\n}`));
  assert.notEqual(readFileSync(mut3, "utf8"), src);
  const md3 = fresh("m3");
  const del = r2(md3, mut3, ["--folder", "lb-daily", "put-one", "504", join(md3, "saves"), "save-000000008", good]);
  assert.notEqual(del.deletes, "", "mutant killed: the fake bucket records the delete call");
}));

test("M165 config: the committed dailyRun block", () => {
  const dr = CFG.dailyRun;
  assert.deepEqual(dr.corpus, CFG.firstRun.corpus, "the same Auditor-cleared corpus as the first run");
  assert.equal(dr.r2Folder, "lb-daily");
  assert.equal(dr.loraUnlock.baselineBpb, 2.5156);
  assert.ok(dr.jobTimeoutMin <= 355 && dr.trainDeadlineMin + dr.reserveMin <= dr.jobTimeoutMin);
  assert.ok(!Object.keys(dr.train).some((k) => /lora|init-from|replay|resume/.test(k)));
  assert.equal(dr.train["--optimizer"], "adamw8bit"); assert.equal(dr.train["--curriculum"], "easy_to_hard"); assert.ok(dr.train["--patience"]);
  assert.equal(ld(join(repo, "peaceai"), ["config"]).last, "config ok");
});

test("#657 stdlib only: saves, lb_run, lb_daily and daily_cycle import with numpy blocked; a numpy import in any of them is caught (killed near miss)", () => withDir((dir) => {
  const env = { ...process.env, ...noNumpyEnv() };
  const blocked = spawnSync(py, ["-c", "import numpy"], { encoding: "utf8", env });
  assert.notEqual(blocked.status, 0); assert.match(blocked.stderr, /numpy blocked/, "the block itself works");
  const imp = (m: string, mod: string) => spawnSync(py, ["-c", `import sys; sys.path.insert(0, sys.argv[1]); import ${mod}; assert "numpy" not in sys.modules, "numpy loaded"`, m], { encoding: "utf8", env });
  const copy = (name: string) => {
    const m = join(dir, name); mkdirSync(m);
    for (const f of readdirSync(MODEL).filter((x) => x.endsWith(".py") || x.endsWith(".json"))) copyFileSync(join(MODEL, f), join(m, f));
    return m;
  };
  const real = copy("real");
  for (const f of STDLIB_ONLY) {
    const mod = f.replace(/\.py$/, "");
    const r = imp(real, mod); assert.equal(r.status, 0, `${f}: ${r.stderr}`);
    const mut = copy(`mut-${mod}`); const src = readFileSync(join(mut, f), "utf8");
    const at = src.indexOf("\nimport sys\n"); assert.ok(at > 0, f);
    writeFileSync(join(mut, f), src.slice(0, at) + "\nimport numpy" + src.slice(at));
    const k = imp(mut, mod); assert.notEqual(k.status, 0, `${f}: a module-level numpy import must fail with numpy blocked`); assert.match(k.stderr, /numpy blocked/, f);
  }
  // the PEACEAI_PYTHON / PY wrapper blocks numpy for exactly the stdlib-only scripts; train.py and export.py are untouched
  const w = join(dir, "w"); mkdirSync(w);
  for (const f of [...STDLIB_ONLY, "train.py", "export.py"]) writeFileSync(join(w, f), "import os, sys\nprint(os.environ.get('PYTHONPATH', '').split(os.pathsep)[0])\n");
  for (const f of STDLIB_ONLY) assert.equal(spawnSync(PYNN, [join(w, f)], { encoding: "utf8" }).stdout.trim(), NONUMPY, f);
  for (const f of ["train.py", "export.py"]) assert.notEqual(spawnSync(PYNN, [join(w, f)], { encoding: "utf8", env: { ...process.env, PYTHONPATH: "" } }).stdout.trim(), NONUMPY, f);
}));
