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

test("m148: saving is opt-in, Results / latest.json / promotion untouched; train / save code never names secrets", () => {
  const t = readFileSync(TRAIN, "utf8"), s = readFileSync(join(MODEL, "saves.py"), "utf8");
  assert.match(t, /"--save-dir", default=""/, "no --save-dir, no saves: existing train/retrain behaviour is unchanged");
  for (const f of [t, s]) assert.ok(!/latest\.json|PeaceAI-Results|results-write|GITHUB_TOKEN|secrets\./.test(f), "the train / save code never names Results, latest.json, tokens or secrets");
  assert.ok(!/import (subprocess|urllib|socket|requests)|from (subprocess|urllib|socket)/.test(s), "saves.py has no network or subprocess");
  const spec = readFileSync(join(repo, "peaceai/spec/lm-saves-v1.md"), "utf8");
  assert.match(spec, /R2_NOT_CONFIGURED/);
  assert.ok(/^[\x09\x0a\x20-\x7e]*$/.test(spec), "spec is ASCII");
});

// ---- M148 wiring (lb-saves/wire): peace-lm-train.yml chained through one private R2 bucket (Peace "R2 is fine";
// Auditor gates: env-scoped main-only credentials, no artifacts, sha-verified resume whose expected manifest sha
// comes from a trusted record, never from the bucket alone; fail closed when storage is not configured).

const WF = join(repo, ".github/workflows/peace-lm-train.yml");
const R2 = join(repo, "peaceai/bin/lm-saves-r2.sh");
const R2_VARS = ["LM_SAVES_R2_ACCOUNT_ID", "LM_SAVES_R2_ACCESS_KEY_ID", "LM_SAVES_R2_SECRET_ACCESS_KEY", "LM_SAVES_R2_BUCKET"];
const R2_ENV = { LM_SAVES_R2_ACCOUNT_ID: "0123456789abcdef0123456789abcdef", LM_SAVES_R2_ACCESS_KEY_ID: "AKEYID0123456789abcd", LM_SAVES_R2_SECRET_ACCESS_KEY: "sEcReT0123456789abcdef0123456789", LM_SAVES_R2_BUCKET: "peace-lm-saves-test" };
const FAKE_AWS = `#!/usr/bin/env bash
# fake aws (m148): s3://BUCKET/KEY is $FAKE_S3/BUCKET/KEY; every call is logged with the endpoint it saw
echo "argv=$* endpoint=\${AWS_ENDPOINT_URL:-} region=\${AWS_DEFAULT_REGION:-}" >> "$FAKE_S3.log"
[ -n "\${FAKE_S3_FAIL:-}" ] && [[ "$*" == *"$FAKE_S3_FAIL"* ]] && { echo "boom https://leak.example secret" >&2; exit 1; }
[ "$1" = s3 ] || exit 2
op=$2; shift 2
args=(); for a in "$@"; do case "$a" in --recursive|--only-show-errors) ;; *) args+=("$a");; esac; done
loc() { echo "$FAKE_S3/\${1#s3://}"; }
case "$op" in
  cp) src=\${args[0]} dst=\${args[1]}
    if [[ "$src" == s3://* ]]; then s=$(loc "$src"); [ -d "$s" ] || exit 1; mkdir -p "$dst"; cp -R "$s"/. "$dst"/
    else d=$(loc "$dst"); mkdir -p "$(dirname "$d")"; cp "$src" "$d"; fi ;;
  ls) d=$(loc "\${args[0]}"); [ -d "$d" ] || exit 1; for x in "$d"/*/; do [ -d "$x" ] && echo "                           PRE $(basename "$x")/"; done ;;
  rm) rm -rf "$(loc "\${args[0]}")" ;;
  *) exit 2 ;;
esac
`;
const FAKE_GH = `#!/usr/bin/env bash
echo "$*" >> "$FAKE_GH_LOG"
`;

function fakeTools(dir: string) {
  const bin = join(dir, "bin"); mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, "aws"), FAKE_AWS, { mode: 0o755 });
  writeFileSync(join(bin, "gh"), FAKE_GH, { mode: 0o755 });
  return { bin, s3: join(dir, "s3"), ghLog: join(dir, "gh.log") };
}

function r2(dir: string, args: string[], env: Record<string, string> = {}) {
  const t = fakeTools(dir);
  const r = spawnSync("bash", [R2, ...args], { encoding: "utf8", cwd: dir, env: { PATH: `${t.bin}:/usr/bin:/bin`, FAKE_S3: t.s3, ...R2_ENV, ...env } });
  return { status: r.status, out: r.stdout, err: r.stderr, s3: t.s3 };
}

function fakeSave(saves: string, step: number) {
  const d = join(saves, `save-${String(step).padStart(9, "0")}`); mkdirSync(d, { recursive: true });
  writeFileSync(join(d, "checkpoint.npz"), `ck${step}`); writeFileSync(join(d, "tokenizer.json"), "{}"); writeFileSync(join(d, "manifest.json"), `{"step":${step}}`);
  return d;
}

const quiet = (out: string) => {
  for (const v of Object.values(R2_ENV)) assert.ok(!out.includes(v), "no credential, account id or bucket name in the output");
  assert.ok(!/https?:|r2\.cloudflarestorage|s3:\/\/|boom/.test(out), `no URL and no aws text in the output: ${out}`);
};

test("m148 wire: lm-saves-r2.sh keeps the latest 2 saves per chain, uploads the manifest last, prints codes and shas only", () => withDir((dir) => {
  const saves = join(dir, "w/saves");
  const shas: string[] = [];
  for (const st of [10, 20, 30]) {
    const d = fakeSave(saves, st); shas.push(H(readFileSync(join(d, "manifest.json"))));
    const r = r2(dir, ["put", "123", saves]);
    assert.equal(r.status, 0, r.out + r.err); quiet(r.out + r.err);
    assert.match(r.out, new RegExp(`^R2_PUT save=save-0000000${st} manifest=${shas.at(-1)}$`, "m"), "the job log carries each save's manifest sha256");
  }
  const chainDir = join(dir, "s3", R2_ENV.LM_SAVES_R2_BUCKET, "lm-saves/123");
  assert.deepEqual(readdirSync(chainDir).sort(), ["save-000000020", "save-000000030"], "only the latest 2 saves stay in the bucket");
  const again = r2(dir, ["put", "123", saves]);
  assert.equal(again.status, 0); assert.equal(again.out, "", "nothing new: quiet (the training step calls put every minute)");
  // the manifest is the last object of each save; the endpoint comes from the environment, never argv
  const log = readFileSync(join(dir, "s3.log"), "utf8").trim().split("\n");
  const puts = log.filter((l) => /^argv=s3 cp \S+ s3:\/\//.test(l) && l.includes("save-000000030"));
  assert.match(puts.at(-1)!, /save-000000030\/manifest\.json /);
  for (const l of log) {
    assert.match(l, new RegExp(` endpoint=https://${R2_ENV.LM_SAVES_R2_ACCOUNT_ID}\\.r2\\.cloudflarestorage\\.com region=auto$`));
    assert.ok(!/argv=[^\n]*(https?:|--endpoint)/.test(l.replace(/ endpoint=.*$/, "")), "no URL on the aws command line");
    assert.match(l, new RegExp(`s3://${R2_ENV.LM_SAVES_R2_BUCKET}/lm-saves/123/`), "nothing outside lm-saves/<chain>/ is touched");
  }
  // get: the save comes back whole; uploaded: only saves this job uploaded count
  const g = r2(dir, ["get", "123", "save-000000030", join(dir, "prev/save-000000030")]);
  assert.equal(g.status, 0, g.out); assert.equal(g.out, "R2_GET save=save-000000030\n");
  assert.deepEqual(readdirSync(join(dir, "prev/save-000000030")).sort(), ["checkpoint.npz", "manifest.json", "tokenizer.json"]);
  assert.equal(r2(dir, ["uploaded", saves, "save-000000030"]).status, 0);
  const nu = r2(dir, ["uploaded", saves, "save-000000040"]); assert.equal(nu.status, 1); assert.equal(nu.out, "R2_SAVE_NOT_UPLOADED\n");
}));

test("m148 wire: lm-saves-r2.sh fails closed: missing config, missing tool, bad args, failed upload (no partial save marked uploaded)", () => withDir((dir) => {
  for (const v of R2_VARS) {
    const r = r2(dir, ["check"], { [v]: "" });
    assert.equal(r.status, 1, v); assert.equal(r.out, "R2_NOT_CONFIGURED\n", v);
  }
  for (const [v, bad] of [["LM_SAVES_R2_ACCOUNT_ID", "not-hex"], ["LM_SAVES_R2_BUCKET", "Bad_Bucket"], ["LM_SAVES_R2_ACCESS_KEY_ID", "a b"], ["LM_SAVES_R2_SECRET_ACCESS_KEY", "x;y"]] as const) {
    assert.equal(r2(dir, ["check"], { [v]: bad }).out, "R2_NOT_CONFIGURED\n", `${v}=${bad}`);
  }
  assert.equal(r2(dir, ["check"]).out, "R2 ok\n", "near miss: a full config passes");
  const noTool = spawnSync("bash", [R2, "check"], { encoding: "utf8", env: { PATH: "/usr/bin:/bin", ...R2_ENV } });
  if (!existsSync("/usr/bin/aws") && !existsSync("/bin/aws")) { assert.equal(noTool.status, 1); assert.equal(noTool.stdout, "R2_TOOL_MISSING\n"); }
  const saves = join(dir, "w/saves"); fakeSave(saves, 5);
  for (const args of [["put", "../x", saves], ["put", "12a", saves], ["get", "1", "save-../x", join(dir, "d1")], ["get", "1", "save-000000005", saves], ["uploaded", saves, "../x"], ["rm", "1"], []]) {
    const r = r2(dir, args); assert.equal(r.status, 1, args.join(" ")); assert.equal(r.out, "R2_BAD_ARGS\n", args.join(" "));
  }
  const f = r2(dir, ["put", "7", saves], { FAKE_S3_FAIL: "manifest.json" });
  assert.equal(f.status, 1); assert.equal(f.out, "R2_PUT_FAILED save=save-000000005\n"); quiet(f.out + f.err);
  assert.ok(!existsSync(join(dir, "s3", R2_ENV.LM_SAVES_R2_BUCKET, "lm-saves/7/save-000000005/manifest.json")), "a failed save has no manifest in the bucket (resume refuses it)");
  assert.equal(r2(dir, ["uploaded", saves, "save-000000005"]).out, "R2_SAVE_NOT_UPLOADED\n", "a failed upload never counts as uploaded");
  const g = r2(dir, ["get", "7", "save-000000005", join(dir, "d2")]);
  assert.equal(g.out, "R2_GET_FAILED\n", "a save without its manifest is not fetched");
  const ok2 = r2(dir, ["put", "7", saves]); assert.equal(ok2.status, 0); assert.match(ok2.out, /^R2_PUT save=save-000000005 manifest=[0-9a-f]{64}$/m, "near miss: the retry uploads it");
  const nm = r2(dir, ["get", "8", "save-000000005", join(dir, "d3")]); assert.equal(nm.out, "R2_GET_FAILED\n", "another chain's prefix is not this chain's");
}));

/** One step's run script from the workflow (the block under `run: |`, dedented). */
function stepRun(wf: string, namePrefix: string): string {
  const at = wf.indexOf(`      - name: ${namePrefix}`);
  assert.ok(at >= 0, `step ${namePrefix}`);
  const rest = wf.slice(at).split("\n");
  const i = rest.findIndex((l) => l === "        run: |");
  const body: string[] = [];
  for (const l of rest.slice(i + 1)) { if (l.trim() !== "" && !l.startsWith("          ")) break; body.push(l.slice(10)); }
  return body.join("\n") + "\n";
}

function jobBlock(wf: string, job: string): string {
  const at = wf.indexOf(`\n  ${job}:\n`); assert.ok(at >= 0, job);
  const next = wf.slice(at + 2).search(/\n  [a-z][a-z0-9-]*:\n/);
  return next < 0 ? wf.slice(at) : wf.slice(at, at + 2 + next);
}

test("m148 wire: workflow shape: env-scoped R2 secrets in three steps only, no artifacts, timeouts, caps, chain job least privilege", () => {
  const wf = readFileSync(WF, "utf8");
  const train = jobBlock(wf, "train"), chain = jobBlock(wf, "chain");
  assert.match(train, /\n    timeout-minutes: 355\n    environment: peaceai-results\n    permissions:\n      contents: read\n    outputs:\n/);
  assert.equal((wf.match(/^ +environment:/gm) ?? []).length, 1, "one environment: the existing peaceai-results (main only), on the train job; no new environment (Auditor, #643)");
  assert.ok(!/upload-artifact|download-artifact|actions\/cache|--max-seconds/.test(wf), "no artifact, no cache: saves go only to R2");
  assert.match(wf, /--save-dir "\$S" --save-every-min 20 --job-start "\$JOB_START" --soft-deadline-min 340 --marker "\$RUNNER_TEMP\/work\/chain\.json"/);
  assert.match(wf, /\[\[ "\$IN_INDEX" =~ \^\(0\|\[1-9\]\[0-9\]\?\)\$ && "\$IN_MAX" =~ \^\(\[1-9\]\|1\[0-2\]\)\$ \]\]/, "max chain 1-12 checked before training");
  assert.match(readFileSync(join(MODEL, "saves.py"), "utf8"), /^HARD_MAX_CHAIN = 12 /m);
  // secrets: the four R2 names, each only in the three storage steps, plus the Results key in the landing step
  assert.deepEqual([...new Set(wf.match(/secrets\.[A-Z0-9_]+/g))].sort(), [...R2_VARS.map((v) => `secrets.${v}`), "secrets.PEACEAI_RESULTS_DEPLOY_KEY"].sort());
  const holders = ["Chain inputs and storage check", "Train (ctx 512", "Copy the remaining saves to R2"];
  for (const v of R2_VARS) {
    assert.equal((wf.match(new RegExp(`\\$\\{\\{ secrets\\.${v} \\}\\}`, "g")) ?? []).length, 3, v);
    for (const h of holders) assert.match(wf.slice(wf.indexOf(`      - name: ${h}`)).split("\n      - name: ")[0], new RegExp(`${v}: \\$\\{\\{ secrets\\.${v} \\}\\}`), `${h} holds ${v}`);
  }
  assert.match(stepRun(wf, "Train (ctx 512"), /env -u LM_SAVES_R2_ACCOUNT_ID -u LM_SAVES_R2_ACCESS_KEY_ID -u LM_SAVES_R2_SECRET_ACCESS_KEY -u LM_SAVES_R2_BUCKET \\\n  "\$py" peaceai\/model\/train\.py/, "training never sees the credentials");
  // order: storage check before the corpus fetch and training; copy, decide, export, eval, land
  const order = ["Job clock", "Chain inputs and storage check", "Fetch the corpus", "Train (ctx 512", "Copy the remaining saves to R2", "Chain decision", "Export (last link only)", "Set C v2 eval", "Land the model in Results only"].map((n) => wf.indexOf(`      - name: ${n}`));
  assert.deepEqual([...order].sort((a, b) => a - b), order); assert.ok(order[0] > 0);
  for (const n of ["Export (last link only)", "Set C v2 eval", "Land the model in Results only"]) assert.match(wf.slice(wf.indexOf(`      - name: ${n}`)).split("\n").slice(0, 2).join("\n"), /\n        if: env\.FINAL_LINK == 'yes'$/, `${n}: last link only`);
  // no expression is expanded inside a script: inputs and outputs reach scripts as environment variables only
  for (const block of wf.split("        run: |").slice(1)) assert.ok(!/\$\{\{/.test(block.split(/\n {6}- (?:name|uses):|\n {2}[a-z]+:\n/)[0]!), "no ${{ }} inside a run script");
  // chain job: actions: write only, no checkout, no secret, no environment; inputs only from this run's train outputs
  assert.match(chain, /\n    needs: train\n    if: needs\.train\.outputs\.next == 'yes'\n[\s\S]*\n    timeout-minutes: 5\n    permissions:\n      actions: write # [^\n]*\n    steps:\n/);
  assert.ok(!/secrets\.|environment:|actions\/checkout|contents:|id-token|upload-artifact/.test(chain), "the chain job holds no key and no checkout");
  for (const o of ["chain_id", "index", "max_chain", "save", "sha"]) assert.match(chain, new RegExp(`: \\$\\{\\{ needs\\.train\\.outputs\\.${o} \\}\\}\\n`));
  assert.match(chain, /gh workflow run peace-lm-train\.yml --repo "\$GITHUB_REPOSITORY" --ref main -f chain_id="\$N_CHAIN" -f chain_index="\$N_INDEX" \\\n {12}-f max_chain="\$N_MAX" -f resume_save="\$N_SAVE" -f resume_manifest_sha="\$N_SHA" > \/dev\/null 2>&1/);
  assert.equal((wf.match(/^ +actions: write/gm) ?? []).length, 1, "only the chain job can dispatch");
  // trusted sha: the train job's sha output is the decide line's (from the local marker), the resume sha is the input
  assert.match(train, /\n      sha: \$\{\{ steps\.decide\.outputs\.sha \}\}\n/);
  const check = stepRun(wf, "Chain inputs and storage check");
  assert.match(check, /resume="--resume-from \$RUNNER_TEMP\/prev\/\$IN_SAVE --resume-manifest-sha \$IN_SHA"/);
  assert.ok(!/manifest\.json|sha256sum|jq/.test(check), "the expected sha is never read from the downloaded save");
  assert.match(wf, /IN_SHA: \$\{\{ inputs\.resume_manifest_sha \}\}\n/);
});

/** Run one workflow step's script locally (fake aws / gh on PATH, scratch RUNNER_TEMP, GITHUB_ENV, GITHUB_OUTPUT). */
function runStep(dir: string, name: string, env: Record<string, string>) {
  const t = fakeTools(dir);
  const rt = join(dir, "rt"); mkdirSync(rt, { recursive: true });
  const genv = join(dir, "github_env"), gout = join(dir, "github_output"); writeFileSync(genv, ""); writeFileSync(gout, "");
  const r = spawnSync("bash", ["-e", "-c", stepRun(readFileSync(WF, "utf8"), name)], { encoding: "utf8", cwd: repo,
    env: { PATH: `${t.bin}:${process.env.PATH}`, FAKE_S3: t.s3, FAKE_GH_LOG: t.ghLog, RUNNER_TEMP: rt, GITHUB_ENV: genv, GITHUB_OUTPUT: gout, GITHUB_RUN_ID: "555", GITHUB_REPOSITORY: "o/r", ...env } });
  const gh = existsSync(t.ghLog) ? readFileSync(t.ghLog, "utf8") : "";
  return { status: r.status, out: r.stdout + r.stderr, env: readFileSync(genv, "utf8"), output: readFileSync(gout, "utf8"), gh, rt, s3: t.s3 };
}

test("m148 wire: the storage-check step refuses bad chain inputs and missing storage before training; the resume sha is the input", () => withDir((dir) => {
  const IN = (o: Record<string, string>) => ({ IN_CHAIN: "", IN_INDEX: "0", IN_MAX: "4", IN_SAVE: "", IN_SHA: "", ...R2_ENV, ...o });
  const sha = "ab".repeat(32);
  const cases: Array<[Record<string, string>, string]> = [
    [{ LM_SAVES_R2_SECRET_ACCESS_KEY: "" }, "R2_NOT_CONFIGURED"], [{ LM_SAVES_R2_BUCKET: "" }, "R2_NOT_CONFIGURED"],
    [{ IN_MAX: "13" }, "CHAIN_BAD_ARGS"], [{ IN_MAX: "0" }, "CHAIN_BAD_ARGS"], [{ IN_INDEX: "4" }, "CHAIN_BAD_ARGS"], [{ IN_INDEX: "x" }, "CHAIN_BAD_ARGS"],
    [{ IN_SHA: sha }, "CHAIN_BAD_ARGS"], [{ IN_CHAIN: "9" }, "CHAIN_BAD_ARGS"],
    [{ IN_INDEX: "1", IN_CHAIN: "9", IN_SAVE: "save-000000004", IN_SHA: "" }, "RESUME_INPUTS_BAD"],
    [{ IN_INDEX: "1", IN_CHAIN: "9", IN_SAVE: "save-000000004", IN_SHA: sha.toUpperCase() }, "RESUME_INPUTS_BAD"],
    [{ IN_INDEX: "1", IN_CHAIN: "9", IN_SAVE: "../x", IN_SHA: sha }, "RESUME_INPUTS_BAD"],
    [{ IN_INDEX: "1", IN_CHAIN: "x9", IN_SAVE: "save-000000004", IN_SHA: sha }, "RESUME_INPUTS_BAD"],
    [{ IN_INDEX: "1", IN_CHAIN: "9", IN_SAVE: "save-000000004", IN_SHA: sha }, "R2_GET_FAILED"],
  ];
  for (const [o, code] of cases) {
    const d = join(dir, `c${cases.findIndex((c) => c[0] === o)}`); mkdirSync(d);
    const r = runStep(d, "Chain inputs and storage check", IN(o));
    assert.equal(r.status, 1, `${JSON.stringify(o)}: ${r.out}`); assert.equal(r.out.trim().split("\n").pop(), code, JSON.stringify(o));
    assert.ok(!/RESUME_ARGS/.test(r.env), "nothing exported on a refusal"); quiet(r.out);
  }
  const first = runStep(join(dir, "first"), "Chain inputs and storage check", IN({}));
  assert.equal(first.status, 0, first.out); assert.match(first.env, /^CHAIN_ID=555\nCHAIN_INDEX=0\nMAX_CHAIN=4\nRESUME_ARGS=\n$/);
  // a later link: the bucket holds the save; the expected sha passed to train.py is the input, not the bucket's
  const d = join(dir, "later"); mkdirSync(d);
  fakeSave(join(d, "s3", R2_ENV.LM_SAVES_R2_BUCKET, "lm-saves/9"), 4);
  const later = runStep(d, "Chain inputs and storage check", IN({ IN_INDEX: "1", IN_CHAIN: "9", IN_SAVE: "save-000000004", IN_SHA: sha }));
  assert.equal(later.status, 0, later.out); quiet(later.out);
  assert.equal(later.env, `CHAIN_ID=9\nCHAIN_INDEX=1\nMAX_CHAIN=4\nRESUME_ARGS=--resume-from ${later.rt}/prev/save-000000004 --resume-manifest-sha ${sha}\n`);
  assert.notEqual(H(readFileSync(join(later.rt, "prev/save-000000004/manifest.json"))), sha, "the bucket's manifest is not where the expected sha comes from");
}));

test("m148 wire: decide step: next link only for an uploaded, verified save; its outputs carry the local marker's sha", () => withDir((dir) => {
  const corpus = tinyCorpus(dir);
  const rtSetup = (d: string) => { mkdirSync(join(d, "rt/venv/bin"), { recursive: true }); execFileSync("ln", ["-s", execFileSync(py, ["-c", "import sys;print(sys.executable)"], { encoding: "utf8" }).trim(), join(d, "rt/venv/bin/python")]); };
  const link = (d: string, extra: string[]) => { rtSetup(d); ok(["--corpus", corpus, "--work", join(d, "rt/work"), "--steps", "6", "--save-dir", join(d, "rt/work/saves"), "--marker", join(d, "rt/work/chain.json"), ...extra]); return marker(join(d, "rt/work/chain.json")); };
  const more = join(dir, "more"); const m = link(more, ["--max-steps-this-run", "4"]);
  const pre = runStep(more, "Chain decision", { CHAIN_ID: "555", CHAIN_INDEX: "0", MAX_CHAIN: "4" });
  assert.equal(pre.status, 1); assert.equal(pre.out.trim().split("\n").pop(), "R2_SAVE_NOT_UPLOADED", "not uploaded: no next link");
  assert.equal(pre.output, "");
  writeFileSync(join(more, "rt/work/r2-uploaded.txt"), m.save + "\n");
  const yes = runStep(more, "Chain decision", { CHAIN_ID: "555", CHAIN_INDEX: "0", MAX_CHAIN: "4" });
  assert.equal(yes.status, 0, yes.out);
  assert.equal(yes.output, `next=yes\nchain_id=555\nindex=1\nmax_chain=4\nsave=${m.save}\nsha=${m.manifestSha256}\n`);
  assert.equal(yes.env, "", "not the last link: no export or landing");
  const cap = runStep(more, "Chain decision", { CHAIN_ID: "555", CHAIN_INDEX: "3", MAX_CHAIN: "4" });
  assert.equal(cap.status, 0); assert.equal(cap.output, "next=no\n"); assert.equal(cap.env, "FINAL_LINK=yes\n", "at the cap the last link lands its best");
  const ck = join(more, "rt/work/saves", m.save, "checkpoint.npz"); const b = readFileSync(ck); b[b.length >> 1] ^= 1; writeFileSync(ck, b);
  const bad = runStep(more, "Chain decision", { CHAIN_ID: "555", CHAIN_INDEX: "0", MAX_CHAIN: "4" });
  assert.equal(bad.status, 1); assert.match(bad.out, /chain refused: CHAIN_SAVE_BAD:SAVE_FILE_SHA/); assert.equal(bad.output, "");
  const done = join(dir, "done"); link(done, []);
  const fin = runStep(done, "Chain decision", { CHAIN_ID: "555", CHAIN_INDEX: "0", MAX_CHAIN: "4" });
  assert.equal(fin.status, 0, fin.out); assert.equal(fin.output, "next=no\n"); assert.equal(fin.env, "FINAL_LINK=yes\n");
}));

test("m148 wire: chain step dispatches only well-formed next-link inputs (index below the cap, save name, 64-hex sha)", () => withDir((dir) => {
  const sha = "cd".repeat(32);
  const N = (o: Record<string, string>) => ({ N_CHAIN: "555", N_INDEX: "1", N_MAX: "4", N_SAVE: "save-000000040", N_SHA: sha, GH_TOKEN: "t", ...o });
  const good = runStep(join(dir, "g"), "Dispatch the next link", N({}));
  assert.equal(good.status, 0, good.out);
  assert.equal(good.gh, `workflow run peace-lm-train.yml --repo o/r --ref main -f chain_id=555 -f chain_index=1 -f max_chain=4 -f resume_save=save-000000040 -f resume_manifest_sha=${sha}\n`);
  assert.equal(good.out, `chain dispatched index=1 save=save-000000040 sha=${sha}\n`);
  const bads: Array<Record<string, string>> = [{ N_SHA: "" }, { N_SHA: sha.slice(1) }, { N_SAVE: "save-1" }, { N_INDEX: "0" }, { N_INDEX: "4" }, { N_MAX: "13" }, { N_CHAIN: "" }, { N_CHAIN: "5 5" }];
  bads.forEach((o, i) => {
    const r = runStep(join(dir, `b${i}`), "Dispatch the next link", N(o));
    assert.equal(r.status, 1, JSON.stringify(o)); assert.equal(r.out, "CHAIN_BAD_ARGS\n", JSON.stringify(o)); assert.equal(r.gh, "", "nothing dispatched");
  });
}));
