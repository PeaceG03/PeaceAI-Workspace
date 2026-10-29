// M131 (Auditor follow-up after the promotion of lm-v1-858573767465, Results 0d86e8c): the top-level live entry of
// peaceai/model/lm-retrain.json is retired. It only repeated replayBase's version and core-free proof pin (and
// lm-retrain-live.sh refused unless the two agreed); after the promotion the name "live" was stale (Results latest.json
// names the promoted model, which lm-retrain.json promoted pins). Every former reader now reads replayBase:
//   lm-retrain-live.sh (the live == replayBase refusal becomes: refuse a config that has a live key at all),
//   lm-retrain-arm-save.sh / lm-retrain-arm-verify.sh (save.json live = replayBase.version; the training-config identity
//   hashes {version, corefreeProofSha256} of replayBase under the same key, so every saved arm's trainConfigSha256 is
//   unchanged). judge-v2.json .live (the replay base's judge pin, required by both judge-v2 workflows) is a different
//   file and stays. These tests fail if the entry is reintroduced or read again.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { protectedReason } from "../lib/selfchange.ts";

const repo = resolve(import.meta.dirname, "..", "..");
const read = (p: string) => readFileSync(join(repo, p), "utf8");
const CFG = JSON.parse(read("peaceai/model/lm-retrain.json"));
const V2 = JSON.parse(read("peaceai/model/judge-v2.json"));
const BASE = "lm-v1-088073d41dbc", PROMOTED = "lm-v1-858573767465";
const BASE_PROOF = "24ffc77c1d49cd9b441d09613d799dc64b78a838c3c352fe470e7e3dab74281a";
// --train-config-sha before the retirement (main bbb594c, computed from {model, live, replay, dedup, train})
const TC_BEFORE = { finetune: "6293010ac4cbd062cd4adfb61295a681cf1f370d2901e957f6151d7dcd38979d", pretrain: "414ba948ce616315e13722efda6289c5d69dbc615e07a1b68bbc4cbb760f2cb0" };
const code = (t: string) => t.split("\n").filter((l) => !/^\s*(#|\/\/|\*|\/\*\*)/.test(l)).join("\n");
const tmp = (fn: (d: string) => void) => { const d = mkdtempSync(join(tmpdir(), "m131-")); try { fn(d); } finally { rmSync(d, { recursive: true, force: true }); } };

test("M131 config: no live entry; replayBase is the one pin for the in-run live model; promoted is separate; judge-v2 .live stays the replay base", () => {
  assert.equal(Object.hasOwn(CFG, "live"), false, "lm-retrain.json has no top-level live entry");
  assert.doesNotMatch(read("peaceai/model/lm-retrain.json"), /^ "live":/m);
  assert.deepEqual([CFG.replayBase.version, CFG.replayBase.corefreeProofSha256, CFG.replayBase.manifestSha256], [BASE, BASE_PROOF, CFG.replay.manifestSha256]);
  assert.equal(CFG.promoted.version, PROMOTED); assert.notEqual(CFG.promoted.version, CFG.replayBase.version);
  assert.equal(V2.live.version, CFG.replayBase.version, "judge-v2.json .live is the replay base's judge pin (peace-lm-judge-v2*.yml require it)");
  assert.match(CFG.replayBase.note, /lm-retrain-live\.sh refuses a config that has a live key again/);
});

test("M131 no reader of lm-retrain.json .live in workflows, scripts, python, lib or tests", () => {
  const files: string[] = [];
  const add = (dir: string, re: RegExp) => { for (const f of readdirSync(join(repo, dir))) if (re.test(f)) files.push(`${dir}/${f}`); };
  add(".github/workflows", /\.ya?ml$/); add("peaceai/bin", /\.(sh|ts|mts|py)$/); add("peaceai/model", /\.py$/); add("peaceai/lib", /\.ts$/);
  add("peaceai/test", /^m\d+.*\.test\.ts$/);
  assert.ok(files.length > 50);
  const bad: [RegExp, string][] = [
    [/jq [^\n|]*\.live\b[^\n|"]*"\$\{?(cfg|CFG)\}?"/, "jq .live on the retrain config"],
    [/\$(cfg|CFG)\[0\]\.live\b/, "jq $cfg[0].live"],
    [/\{model, live, /, "the bare live key in the training-config identity"],
    [/\b(CFG|cfg|rc|retrainCfg)\??\.live\b/, "a TS/JS read of the config's live"],
    [/\b(cfg|config|rc)(\[["']live["']\]|\.get\(["']live["'])/, "a python read of the config's live"],
  ];
  for (const f of files) {
    if (f.endsWith("m131-lm-retrain-live-retired.test.ts")) continue;
    const c = code(read(f));
    for (const [re, why] of bad) assert.doesNotMatch(c, re, `${f}: ${why}`);
  }
  // the former readers read replayBase
  assert.match(read("peaceai/bin/lm-retrain-arm-save.sh"), /--arg live "\$\(jq -r \.replayBase\.version "\$cfg"\)"/);
  assert.match(read("peaceai/bin/lm-retrain-arm-verify.sh"), /live=\$\(jq -r \.replayBase\.version "\$cfg"\)/);
  assert.match(read("peaceai/bin/lm-retrain-arm-verify.sh"), /live: \{version: \.replayBase\.version, corefreeProofSha256: \.replayBase\.corefreeProofSha256\}/);
});

test("M131 lm-retrain-live.sh refuses a reintroduced live entry before any Results access", () => {
  const s = read("peaceai/bin/lm-retrain-live.sh");
  const refuse = s.indexOf(`jq -e 'has("live") | not' "$cfg" > /dev/null || { echo "lm-retrain.json has the retired live entry (the replay base is replayBase): refused"; exit 1; }`);
  assert.ok(refuse > 0); assert.ok(refuse < s.indexOf("git clone"), "refused before the Results clone");
  assert.doesNotMatch(code(s), /\.live\./);
  // behaviour (fixture Results) is in m127 "Fix B item 3": a live entry naming another model or the replay base refuses
  assert.match(read("peaceai/test/m127-lm-recheck-loader.test.ts"), /no\("live entry naming the replay base"/);
});

test("M131 training-config identity: unchanged by the retirement, bound to replayBase, blind to a stray live key", () => tmp((d) => {
  const run = (cwd: string, mode: string) => execFileSync("bash", ["peaceai/bin/lm-retrain-arm-verify.sh", "--train-config-sha", mode], { cwd, encoding: "utf8" }).trim();
  for (const m of ["finetune", "pretrain"] as const) assert.equal(run(repo, m), TC_BEFORE[m], `${m}: saved arms' trainConfigSha256 still verify`);
  const cwd = join(d, "c"); mkdirSync(join(cwd, "peaceai/bin"), { recursive: true }); mkdirSync(join(cwd, "peaceai/model"));
  copyFileSync(join(repo, "peaceai/bin/lm-retrain-arm-verify.sh"), join(cwd, "peaceai/bin/lm-retrain-arm-verify.sh")); chmodSync(join(cwd, "peaceai/bin/lm-retrain-arm-verify.sh"), 0o755);
  // variants made with jq from the real config (jq keeps number literals such as 1.0 as written, as the script sees them)
  const at = (filter: string, m: string) => {
    writeFileSync(join(cwd, "peaceai/model/lm-retrain.json"), execFileSync("jq", ["--arg", "p", PROMOTED, "--arg", "z", "0".repeat(64), filter, join(repo, "peaceai/model/lm-retrain.json")], { encoding: "utf8" }));
    return run(cwd, m);
  };
  for (const m of ["finetune", "pretrain"] as const) {
    assert.equal(at(".", m), TC_BEFORE[m]);
    assert.equal(at(". + {live: {version: $p, corefreeProofSha256: $z}}", m), TC_BEFORE[m], "a stray live key is not read");
    assert.notEqual(at(".replayBase.version = $p", m), TC_BEFORE[m], "the identity follows replayBase.version");
    assert.notEqual(at(".replayBase.corefreeProofSha256 = $z", m), TC_BEFORE[m], "and its proof pin");
    assert.equal(at('.replayBase.note = "x"', m), TC_BEFORE[m], "notes stay out of the identity");
  }
}));

test("M131 new test is protected", () => {
  assert.ok(protectedReason("peaceai/test/m131-lm-retrain-live-retired.test.ts"));
});
