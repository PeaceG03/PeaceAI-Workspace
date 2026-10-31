// M148 (limit-breaker step 1): rolling LM saves. train.py writes a full resume save (weights + Adam moments + step +
// RNG/data position) every --save-every-min minutes, atomically, with a sha256 manifest, keeping the latest two; a soft
// deadline (job start + 340 min) saves and exits with a "more to do" marker. Resume verifies the manifest sha before
// loading and refuses (never restarts from scratch) on a missing, corrupted, wrong-sha, wrong-config or wrong-data save.
// Resume equality: 4 steps + resume to 6 is bitwise the uninterrupted 6-step run. The chain decision (saves.py decide)
// has a max-length input and a hard cap of 12. Every tagged guard is mutation-checked: disabling it changes the outcome.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

const repo = resolve(import.meta.dirname, "..", "..");
const py = process.env.PEACEAI_PYTHON ?? "python3";
const MODEL = join(repo, "peaceai/model");
const TRAIN = join(MODEL, "train.py");
const CASES = join(repo, "peaceai/test/m148-saves-cases.py");
const TINY = ["--d-model", "16", "--n-layer", "1", "--n-head", "2", "--ctx", "32", "--vocab", "300", "--batch", "2", "--threads", "1", "--eval-every", "2"];
const H = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");

function tinyCorpus(dir: string, salt = "") {
  const corpus = join(dir, "corpus" + salt);
  mkdirSync(corpus, { recursive: true });
  const docs: string[] = [], man: string[] = [];
  for (let i = 0; i < 70; i += 1) {
    const text = `export function f${i}${salt}(x: number): number {\n  return x + ${i};\n}\n`;
    docs.push(JSON.stringify({ doc: i, text }));
    man.push(JSON.stringify({ doc: i, source: "PeaceG03/PeaceAI", visibility: "private", commit: "a".repeat(40), path: `src/f${i}.ts`, sha256: "0", bytes: text.length, license: "owner:PeaceG03", split: i % 10 === 3 ? "heldout" : "train" }));
  }
  writeFileSync(join(corpus, "docs.jsonl"), docs.join("\n") + "\n");
  writeFileSync(join(corpus, "manifest.jsonl"), man.join("\n") + "\n");
  return corpus;
}

const train = (args: string[]) => spawnSync(py, [TRAIN, ...TINY, ...args], { encoding: "utf8" });
const ok = (args: string[]) => { const r = train(args); assert.equal(r.status, 0, r.stderr); return r.stdout; };
const refused = (args: string[], code: string) => {
  const r = train(args);
  assert.notEqual(r.status, 0, `expected ${code}, got success`);
  assert.equal(r.stderr.trim().split("\n").pop(), code, `stderr is exactly the filtered code: ${r.stderr}`);
};
const marker = (p: string) => JSON.parse(readFileSync(p, "utf8"));
const stateHash = (work: string) => execFileSync(py, ["-c", `import numpy as np,hashlib,sys;z=np.load(sys.argv[1]);print(hashlib.sha256(b"".join(k.encode()+z[k].tobytes() for k in sorted(z.files))).hexdigest())`, join(work, "checkpoint.npz")], { encoding: "utf8" }).trim();
const metrics = (work: string) => readFileSync(join(work, "metrics.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l)).filter((r) => r.loss !== undefined).map((r) => [r.step, r.loss, r.lr, r.grad_norm]);

function withDir(fn: (dir: string) => void) {
  const dir = mkdtempSync(join(tmpdir(), "m148-"));
  try { fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
}

test("m148: save cadence, keep-2 pruning, quiet one-line logs, and no marker without a save dir", () => withDir((dir) => {
  const corpus = tinyCorpus(dir);
  const every = ok(["--corpus", corpus, "--work", join(dir, "a"), "--steps", "6", "--save-dir", join(dir, "a/saves"), "--save-every-min", "0.000001", "--marker", join(dir, "a/chain.json")]);
  assert.deepEqual(every.split("\n").filter((l) => l.startsWith("save ")), [1, 2, 3, 4, 5, 6].map((s) => `save step=${s} name=save-${String(s).padStart(9, "0")}`), "a save after every step, each logged once");
  assert.deepEqual(readdirSync(join(dir, "a/saves")).sort(), ["save-000000005", "save-000000006"], "only the latest two are kept");
  assert.equal(marker(join(dir, "a/chain.json")).more, false);
  assert.match(every, /^marker more=no stop=steps step=6$/m);
  for (const l of every.split("\n").filter((x) => /^(save|marker) /.test(x))) assert.ok(/^[ -~]{1,200}$/.test(l) && !/\/|corpus|token/.test(l), `quiet ASCII one-liner without paths: ${l}`);
  // near miss: a long interval gives exactly the final save
  const final = ok(["--corpus", corpus, "--work", join(dir, "b"), "--steps", "6", "--save-dir", join(dir, "b/saves")]);
  assert.deepEqual(final.split("\n").filter((l) => l.startsWith("save ")), ["save step=6 name=save-000000006"]);
  // the save holds weights + both Adam moments + meta (step, t, rng) and a trimmed best.npz (meta + weights only)
  const keys = execFileSync(py, ["-c", `import numpy as np,sys,json;z=np.load(sys.argv[1]+"/checkpoint.npz");b=np.load(sys.argv[1]+"/best.npz");m=json.loads(str(z["meta"]));print(json.dumps([sorted({k.split(".")[0] for k in z.files}),sorted({k.split(".")[0] for k in b.files}),m["step"],sorted(m)]))`, join(dir, "b/saves/save-000000006")], { encoding: "utf8" });
  assert.deepEqual(JSON.parse(keys), [["m", "meta", "p", "v"], ["meta", "p"], 6, ["cfg", "rng", "step", "t"]]);
  assert.ok(!readdirSync(join(dir, "b/saves")).some((n) => n.startsWith(".tmp")), "no temp dir left behind");
  refused(["--corpus", corpus, "--work", join(dir, "c"), "--steps", "2", "--marker", join(dir, "c/chain.json")], "MARKER_NEEDS_SAVE_DIR");
}));

test("m148: the soft deadline (job start + N min) saves and exits cleanly with a more-to-do marker", () => withDir((dir) => {
  const corpus = tinyCorpus(dir);
  const start = String(Math.floor(Date.now() / 1000));
  const out = ok(["--corpus", corpus, "--work", join(dir, "w"), "--steps", "100000", "--save-dir", join(dir, "w/saves"), "--job-start", start, "--soft-deadline-min", "0.03", "--marker", join(dir, "w/chain.json")]);
  const m = marker(join(dir, "w/chain.json"));
  assert.equal(m.more, true); assert.equal(m.stopReason, "deadline"); assert.ok(m.step > 0 && m.step < 100000);
  assert.equal(m.save, `save-${String(m.step).padStart(9, "0")}`, "the marker names the save made at the stop step");
  assert.match(out, new RegExp(`^marker more=yes stop=deadline step=${m.step}$`, "m"));
  assert.equal(execFileSync(py, [join(MODEL, "saves.py"), "verify", join(dir, "w/saves", m.save), m.manifestSha256], { encoding: "utf8" }).trim(), `save ok step=${m.step}`);
  // the default soft deadline is 340 min (5h40m) and the default cadence 20 min
  const src = readFileSync(TRAIN, "utf8");
  assert.match(src, /"--soft-deadline-min", type=float, default=340\.0/);
  assert.match(src, /"--save-every-min", type=float, default=20\.0/);
}));

test("m148: resume from a verified save is bitwise the uninterrupted run (params, Adam moments, step, RNG, losses)", () => withDir((dir) => {
  const corpus = tinyCorpus(dir);
  ok(["--corpus", corpus, "--work", join(dir, "full"), "--steps", "6"]);
  ok(["--corpus", corpus, "--work", join(dir, "a"), "--steps", "6", "--save-dir", join(dir, "a/saves"), "--max-steps-this-run", "4", "--marker", join(dir, "a/chain.json")]);
  const m = marker(join(dir, "a/chain.json"));
  assert.deepEqual([m.more, m.stopReason, m.step, m.save], [true, "max_steps_this_run", 4, "save-000000004"]);
  const out = ok(["--corpus", corpus, "--work", join(dir, "b"), "--steps", "6", "--save-dir", join(dir, "b/saves"), "--resume-from", join(dir, "a/saves", m.save), "--resume-manifest-sha", m.manifestSha256, "--marker", join(dir, "b/chain.json")]);
  assert.match(out, /^resumed step=4$/m);
  assert.equal(stateHash(join(dir, "b")), stateHash(join(dir, "full")), "params + m + v + meta identical");
  assert.deepEqual(metrics(join(dir, "b")), metrics(join(dir, "full")), "next-step loss / lr / grad norm identical");
  assert.equal(marker(join(dir, "b/chain.json")).more, false);
}));

test("m148: resume refuses a missing, corrupted, wrong-sha, wrong-config or wrong-data save (never a fresh start)", () => withDir((dir) => {
  const corpus = tinyCorpus(dir);
  ok(["--corpus", corpus, "--work", join(dir, "a"), "--steps", "6", "--save-dir", join(dir, "a/saves"), "--max-steps-this-run", "4", "--marker", join(dir, "a/chain.json")]);
  const m = marker(join(dir, "a/chain.json"));
  const save = join(dir, "a/saves", m.save);
  const base = (w: string, extra: string[] = []) => ["--corpus", corpus, "--work", join(dir, w), "--steps", "6", ...extra];
  const from = (s: string, sha: string) => ["--resume-from", s, "--resume-manifest-sha", sha];
  refused(base("r1", from(join(dir, "a/saves/save-000000003"), m.manifestSha256)), "SAVE_MISSING");
  refused(base("r2", from(save, "0".repeat(64))), "SAVE_MANIFEST_SHA");
  refused(base("r3", from(save, "")), "SAVE_SHA_REQUIRED");
  refused(base("r4", ["--lr", "0.002", ...from(save, m.manifestSha256)]), "SAVE_CONFIG_MISMATCH");
  refused(["--corpus", tinyCorpus(dir, "x"), "--work", join(dir, "r5"), "--steps", "6", ...from(save, m.manifestSha256)], "SAVE_DATA_MISMATCH");
  refused(base("r6", ["--init-from", join(dir, "a"), ...from(save, m.manifestSha256)]), "RESUME_WITH_INIT_FROM");
  ok(base("r7", ["--steps", "1"]));
  refused(base("r7", from(save, m.manifestSha256)), "RESUME_WORK_NOT_EMPTY");
  for (const w of ["r1", "r2", "r3", "r4", "r5", "r6"]) assert.ok(!existsSync(join(dir, w, "checkpoint.npz")), `${w}: nothing trained or left resumable after a refusal`);
  // corrupted: one flipped byte in the checkpoint
  const copy = join(dir, "bad"); cpSync(save, copy, { recursive: true });
  const ck = readFileSync(join(copy, "checkpoint.npz")); ck[ck.length >> 1] ^= 1; writeFileSync(join(copy, "checkpoint.npz"), ck);
  refused(base("r8", from(copy, m.manifestSha256)), "SAVE_FILE_SHA");
  // near miss: the untouched save with the right sha resumes
  assert.match(ok(base("r9", from(save, m.manifestSha256))), /^resumed step=4$/m);
  assert.equal(H(readFileSync(join(save, "manifest.json"))), m.manifestSha256, "the marker's sha is the manifest file's sha256");
}));

const runCase = (modelDir: string, name: string, extra: string[] = []) => execFileSync(py, [CASES, modelDir, name, ...extra], { encoding: "utf8" }).trim();

test("m148: verify / chain case table with near misses", () => {
  const table: Array<[string, string[], string]> = [
    ["ok", [], "ok"], ["ok-no-optional", [], "ok"], ["want-sha-format", [], "SAVE_SHA_REQUIRED"], ["want-sha-upper", [], "SAVE_SHA_REQUIRED"],
    ["missing", [], "SAVE_MISSING"], ["missing-manifest", [], "SAVE_MISSING"], ["manifest-sha", [], "SAVE_MANIFEST_SHA"], ["schema", [], "SAVE_SCHEMA"],
    ["cfg-self", [], "SAVE_SCHEMA"], ["file-set", [], "SAVE_FILE_SET"], ["file-set-required", [], "SAVE_FILE_SET"], ["extra-or-missing", [], "SAVE_FILE_SET"],
    ["symlink", [], "SAVE_FILE_SET"], ["file-sha", [], "SAVE_FILE_SHA"], ["file-sha-truncated", [], "SAVE_FILE_SHA"], ["checkpoint-step", [], "SAVE_CHECKPOINT"],
    ["config", [], "SAVE_CONFIG_MISMATCH"], ["data", [], "SAVE_DATA_MISMATCH"], ["work-not-empty", [], "RESUME_WORK_NOT_EMPTY"], ["work-other-file", [], "ok"], ["copy-sha", [], "SAVE_FILE_SHA clean"],
    ["keep-2", [], "kept=save-000000003,save-000000004"],
    ["chain-next", ["x", "0", "3"], "next=yes"], ["chain-next", ["x", "1", "3"], "next=yes"], ["chain-next", ["x", "2", "3"], "next=no reason=cap"],
    ["chain-next", ["x", "0", "12"], "next=yes"], ["chain-next", ["x", "0", "13"], "CHAIN_MAX_TOO_LARGE"], ["chain-next", ["x", "3", "3"], "CHAIN_BAD_ARGS"],
    ["chain-next", ["x", "x", "3"], "CHAIN_BAD_ARGS"], ["chain-next", ["x", "0", "0"], "CHAIN_BAD_ARGS"], ["chain-next", ["x", "-1", "3"], "CHAIN_BAD_ARGS"],
    ["chain-done", ["x", "0", "3"], "next=no reason=done"], ["chain-no-marker", ["x", "0", "3"], "CHAIN_NO_MARKER"], ["chain-marker-schema", ["x", "0", "3"], "CHAIN_NO_MARKER"],
    ["chain-marker-save-name", ["x", "0", "3"], "CHAIN_SAVE_BAD"], ["chain-save-missing", ["x", "0", "3"], "CHAIN_SAVE_BAD:SAVE_MISSING"],
    ["chain-save-corrupt", ["x", "0", "3"], "CHAIN_SAVE_BAD:SAVE_FILE_SHA"], ["chain-marker-step", ["x", "0", "3"], "CHAIN_SAVE_BAD:SAVE_MARKER"],
    ["chain-marker-cfg", ["x", "0", "3"], "CHAIN_SAVE_BAD:SAVE_MARKER"],
  ];
  for (const [name, extra, want] of table) assert.equal(runCase(MODEL, name, extra), want, `${name} ${extra.join(" ")}`);
});

test("m148: the decide CLI prints one line and exits 3 with a filtered code on a refusal", () => withDir((dir) => {
  const r = spawnSync(py, [join(MODEL, "saves.py"), "decide", join(dir, "none.json"), join(dir, "saves"), "0", "3"], { encoding: "utf8" });
  assert.equal(r.status, 3); assert.equal(r.stdout, "CHAIN_NO_MARKER\n"); assert.equal(r.stderr, "");
  const v = spawnSync(py, [join(MODEL, "saves.py"), "verify", join(dir, "nope"), "a".repeat(64)], { encoding: "utf8" });
  assert.equal(v.status, 3); assert.equal(v.stdout, "SAVE_MISSING\n"); assert.equal(v.stderr, "");
}));

test("m148: mutation check: disabling any tagged guard changes its case's outcome", () => withDir((dir) => {
  const src = readFileSync(join(MODEL, "saves.py"), "utf8");
  const guards = [...src.matchAll(/# guard:([a-z0-9-]+)$/gm)].map((g) => g[1]);
  const cases: Record<string, [string, string[]]> = {
    "want-sha-format": ["want-sha-format", []], missing: ["missing", []], "manifest-sha": ["manifest-sha", []], schema: ["schema", []],
    "cfg-self": ["cfg-self", []], "file-set": ["file-set", []], "extra-or-missing": ["extra-or-missing", []], symlink: ["symlink", []],
    "file-sha": ["file-sha", []], "checkpoint-step": ["checkpoint-step", []], config: ["config", []], data: ["data", []],
    "work-not-empty": ["work-not-empty", []], "copy-sha": ["copy-sha", []], "chain-args": ["chain-next", ["x", "x", "3"]], "hard-cap": ["chain-next", ["x", "0", "13"]],
    "index-in-range": ["chain-next", ["x", "3", "3"]], "marker-schema": ["chain-marker-schema", ["x", "0", "3"]], "chain-cap": ["chain-next", ["x", "2", "3"]],
    "marker-save-name": ["chain-marker-save-name", ["x", "0", "3"]], "marker-matches-save": ["chain-marker-step", ["x", "0", "3"]],
  };
  assert.deepEqual([...guards].sort(), Object.keys(cases).sort(), "every tagged guard has a mutation case and no tag is untested");
  for (const g of guards) {
    const [name, extra] = cases[g];
    const real = runCase(MODEL, name, extra);
    const mdir = join(dir, g); mkdirSync(mdir);
    const lines = src.split("\n");
    const i = lines.findIndex((l) => l.endsWith(`# guard:${g}`));
    assert.match(lines[i], /^\s+if .+:  # guard:/);
    lines[i] = lines[i].replace(/if .+:  # guard:/, "if False:  # guard:");
    writeFileSync(join(mdir, "saves.py"), lines.join("\n"));
    const mutated = runCase(mdir, name, extra);
    assert.notEqual(mutated, real, `guard ${g}: disabling it must change "${real}"`);
  }
}));

test("m148: saving is opt-in, Results / latest.json / promotion untouched, no workflow or secret change in this PR", () => {
  const t = readFileSync(TRAIN, "utf8"), s = readFileSync(join(MODEL, "saves.py"), "utf8");
  assert.match(t, /"--save-dir", default=""/, "no --save-dir, no saves: existing train/retrain behaviour is unchanged");
  for (const f of [t, s]) assert.ok(!/latest\.json|PeaceAI-Results|results-write|GITHUB_TOKEN|secrets\./.test(f), "the train / save code never names Results, latest.json, tokens or secrets");
  assert.ok(!/import (subprocess|urllib|socket|requests)|from (subprocess|urllib|socket)/.test(s), "saves.py has no network or subprocess");
  const spec = readFileSync(join(repo, "peaceai/spec/lm-saves-v1.md"), "utf8");
  assert.match(spec, /needs Auditor and Peace/);
  assert.ok(/^[\x09\x0a\x20-\x7e]*$/.test(spec), "spec is ASCII");
});
