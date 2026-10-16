// One-off provenance check for memcheck run 38913032640: classification thresholds, fail-closed run matching,
// no text ever printed, nothing written, no artifact uploaded.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { indexGitTree } from "../lib/coreindex.ts";
import { emptyIndex } from "../lib/coretext.ts";
import { COREFREE_MIN_RUN, LM_JOBS, scanSamples } from "../lib/lm.ts";
import { buildMemcheckPrompts } from "../lib/memprompts.ts";
import { classify, dominated, GENERIC_CORE_FILES, PROMPT_OVERLAP_MIN, promptOverlap, promptVerdict, sameRuns, seqId, verdictOf } from "../lib/provenance.ts";
import { buildSubstringIndex } from "../lib/substr.ts";

const repo = resolve(import.meta.dirname, "..", "..");
const tsx = join(repo, "node_modules/.bin/tsx");
const SECRET = "computeTheVeryDistinctiveCoreOnlyValueForProv(alpha, beta)";

test("classify: GENERIC in any public doc or >= 5 core files; LEAK_SIGNAL unique to one core file; REVIEW 2-4 core-only (and 0, fail closed)", () => {
  assert.equal(GENERIC_CORE_FILES, 5);
  assert.equal(classify(1, 1), "GENERIC"); assert.equal(classify(5, 0), "GENERIC"); assert.equal(classify(40, 0), "GENERIC");
  assert.equal(classify(1, 0), "LEAK_SIGNAL");
  for (const n of [2, 3, 4]) assert.equal(classify(n, 0), "REVIEW");
  assert.equal(classify(0, 0), "REVIEW");
  assert.equal(dominated("                                 x"), "whitespace");
  assert.equal(dominated("}));\n}));\n}));\n}));\n}));\n})"), "punctuation");
  assert.equal(dominated("export const somethingLonger = value;"), "none");
  assert.ok(sameRuns([{ sample: "a", start: 1, length: 32 }, { sample: "b", start: 0, length: 33 }], [{ sample: "b", start: 0, length: 33 }, { sample: "a", start: 1, length: 32 }]));
  assert.ok(!sameRuns([{ sample: "a", start: 1, length: 32 }], [{ sample: "a", start: 2, length: 32 }]));
  assert.ok(!sameRuns([{ sample: "a", start: 1, length: 32 }], []));
  const row = (cls: "GENERIC" | "LEAK_SIGNAL" | "REVIEW") => ({ id: "x", length: 32, occurrences: 1, coreFiles: 1, publicDocs: 0, dominated: "none" as const, cls });
  assert.equal(verdictOf([row("GENERIC")], true), "PASS");
  assert.equal(verdictOf([row("GENERIC")], false), "BLOCK");
  assert.equal(verdictOf([row("GENERIC"), row("REVIEW")], true), "BLOCK");
  assert.equal(verdictOf([row("LEAK_SIGNAL")], true), "BLOCK");
  assert.equal(seqId(0), "s01"); assert.equal(seqId(9), "s10");
});

function env(secretInCoreFiles: number) {
  const dir = mkdtempSync(join(tmpdir(), "m49prov-"));
  const core = join(dir, "core"); mkdirSync(join(core, "src"), { recursive: true });
  for (let i = 0; i < 20; i++) writeFileSync(join(core, "src", `c${i}.ts`), Array.from({ length: 12 }, (_, j) => `export const privateCoreValue${i}_${j} = ${i * 100 + j};`).join("\n") + "\n" + (i < secretInCoreFiles ? `const v${i} = ${SECRET};\n` : ""));
  execFileSync("git", ["init", "-q"], { cwd: core }); execFileSync("git", ["add", "-A"], { cwd: core });
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "c"], { cwd: core });
  const corpus = (name: string, n: number) => {
    const d = join(dir, name); mkdirSync(d);
    const docs = Array.from({ length: n }, (_, i) => ({ doc: i, text: Array.from({ length: 12 }, (_, j) => `export const ${name}Thing${i}_${j} = ${j};`).join("\n") + "\n" }));
    writeFileSync(join(d, "docs.jsonl"), docs.map((x) => JSON.stringify(x)).join("\n") + "\n");
    writeFileSync(join(d, "manifest.jsonl"), docs.map((x) => JSON.stringify({ doc: x.doc, source: "honojs/hono", visibility: "public", path: `src/${name}${x.doc}.ts`, sha256: "0".repeat(64), bytes: 1, license: "MIT", split: "train" })).join("\n") + "\n");
    return { d, docs };
  };
  const pre = corpus("pre", 10), ft = corpus("ft", 3);
  const model = join(dir, "model"); mkdirSync(model);
  writeFileSync(join(model, "config.json"), "{}"); writeFileSync(join(model, "tokenizer.json"), "{}"); writeFileSync(join(model, "weights.npz"), "w");
  const sha = (f: string) => createHash("sha256").update(readFileSync(join(model, f))).digest("hex");
  const counts = { core: 4, public: 2, empty: 1 };
  const text = (id: string) => (id === "core-0" ? `zz(${SECRET})\n` : "x");
  const fake = join(dir, "fake-python");
  writeFileSync(fake, `#!/usr/bin/env python3
import json, sys
a = sys.argv; req = json.load(open(a[a.index("--request") + 1]))
s = [{"id": p["id"] + ":" + k, "prompt": p["id"], "kind": k, "prompt_tail": "", "text": (${JSON.stringify(`zz(${SECRET})\n`)} if p["id"] == "core-0" else "x")} for p in req["prompts"] for k in ("greedy", "sampled")]
json.dump({"model": "m", "samples": s}, open(a[a.index("--response") + 1], "w"))
`);
  chmodSync(fake, 0o755);
  // Expected runs computed exactly as lm-memcheck would.
  const { prompts } = buildMemcheckPrompts(pre.d, core, counts, "PeaceG03/PeaceAI");
  const samples = prompts.flatMap((p) => ["greedy", "sampled"].map((k) => ({ id: `${p.id}:${k}`, prompt: p.id, kind: k, prompt_tail: "", text: text(p.id) })));
  const tree = indexGitTree(core, () => true, true);
  const pub = [...pre.docs, ...ft.docs].map((x) => x.text);
  const runs = scanSamples(samples, emptyIndex(), emptyIndex(), buildSubstringIndex(tree.raw ?? []), { prompts: new Map(prompts.map((p) => [p.id, p.text])), trainingCorpus: buildSubstringIndex(pub), minRun: COREFREE_MIN_RUN }).unexplainedRuns!;
  assert.ok(runs.length > 0);
  const expected = join(dir, "expected.json");
  const writeExp = (r: unknown) => writeFileSync(expected, JSON.stringify({ model: "m", files: { "config.json": sha("config.json"), "tokenizer.json": sha("tokenizer.json"), "weights.npz": sha("weights.npz") }, prompts: counts, unexplainedRuns: r }));
  writeExp(runs);
  const run = () => {
    const before = readdirSync(dir).sort().join(",") + "|" + readdirSync(model).sort().join(",");
    const r = spawnSync(tsx, [join(repo, "peaceai/bin/lm-provenance.ts")], { cwd: repo, encoding: "utf8", env: { ...process.env, GITHUB_ACTIONS: "", PEACEAI_PYTHON: fake, PEACEAI_LM_MODEL_DIR: model, PEACEAI_LM_TRAIN_CORPUS: pre.d, PEACEAI_LM_FT_CORPUS: ft.d, PEACEAI_CORE_DIR: core, PEACEAI_PROV_EXPECTED: expected } });
    assert.equal(readdirSync(dir).sort().join(",") + "|" + readdirSync(model).sort().join(","), before, "writes nothing");
    const all = r.stdout + r.stderr;
    for (let i = 0; i + 16 <= SECRET.length; i++) assert.ok(!all.includes(SECRET.slice(i, i + 16)), "no text printed");
    // Auditor #282: no hex hash of any string, salted or not, and ids are sequential s01, s02, ...
    assert.ok(!/[0-9a-f]{8,}/i.test(all), "no hex hash in the output");
    const ids = [...all.matchAll(/provenance id=(\S+)/g)].map((m) => m[1]);
    assert.deepEqual(ids, ids.map((_, i) => seqId(i)), "sequential ids");
    return r;
  };
  return { run, writeExp, runs };
}

test("one core file: LEAK_SIGNAL, verdict BLOCK; the text is never printed and nothing is written", () => {
  const e = env(1);
  const r = e.run();
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /match=true/);
  assert.match(r.stdout, /provenance id=s01 length=\d+ occurrences=\d+ core_files=1 public_docs=0 dominated=none class=LEAK_SIGNAL/);
  assert.match(r.stdout, /verdict=BLOCK/);
});

test("3 core files: REVIEW, BLOCK; 5 core files: GENERIC, PASS", () => {
  const a = env(3).run();
  assert.equal(a.status, 1); assert.match(a.stdout, /core_files=3 public_docs=0 .*class=REVIEW/); assert.match(a.stdout, /verdict=BLOCK/);
  const b = env(5).run();
  assert.equal(b.status, 0, b.stdout + b.stderr); assert.match(b.stdout, /core_files=5 .*class=GENERIC/); assert.match(b.stdout, /leak_signal=0 review=0 generic_core_files_threshold=5 verdict=PASS/);
});

test("regenerated runs that differ from the recorded locations: BLOCK, fail closed", () => {
  const e = env(5);
  e.writeExp([...e.runs, { sample: "core-1:greedy", start: 0, length: 32 }]);
  const r = e.run();
  assert.equal(r.status, 1); assert.match(r.stdout, /match=false/); assert.match(r.stdout, /verdict=BLOCK reason=RUNS_MISMATCH/);
  e.writeExp(e.runs.map((x) => ({ ...x, start: x.start + 1 })));
  assert.match(e.run().stdout, /reason=RUNS_MISMATCH/);
});

test("m49-provenance-check.yml: dispatch-only, main-only, peaceai-core, read-only keys, no upload/artifact/cache, LM job", () => {
  const t = readFileSync(join(repo, ".github/workflows/m49-provenance-check.yml"), "utf8");
  assert.match(t, /^on:\n  workflow_dispatch:\n    inputs:\n      run_id:\n/m);
  assert.ok(!/workflow_run|pull_request|schedule:|^  push:/m.test(t));
  assert.match(t, /^permissions: \{\}$/m);
  assert.match(t, /^jobs:\n  provenance:\n/m);
  assert.ok((LM_JOBS as readonly string[]).includes("provenance"));
  assert.match(t, /environment: peaceai-core\n/);
  assert.match(t, /github\.ref == 'refs\/heads\/main'/);
  assert.match(t, /persist-credentials: false/);
  assert.ok(!/upload-artifact|actions\/cache|download-artifact|PEACEAI_RESULTS_DEPLOY_KEY|results-write\.sh|latest\.json|model\/train\.py|model\/export\.py|lm-memcheck\.ts|git push|contents: write|GITHUB_STEP_SUMMARY/.test(t));
  assert.deepEqual([...t.matchAll(/secrets\.([A-Z_]+)/g)].map((m) => m[1]).sort(), ["PEACEAI_CORE_DEPLOY_KEY", "PEACEAI_RESULTS_READ_KEY"]);
  assert.match(t, /tsx peaceai\/bin\/lm-provenance\.ts\n/);
  assert.ok(t.lastIndexOf("Delete core, the model") > t.indexOf("lm-provenance.ts"));
  const bin = readFileSync(join(repo, "peaceai/bin/lm-provenance.ts"), "utf8");
  const lib = readFileSync(join(repo, "peaceai/lib/provenance.ts"), "utf8");
  for (const src of [bin, lib]) assert.ok(!/createHash|createHmac|node:crypto|sha256|digest\(/.test(src), "no hashing of run text");
  assert.ok(!/writeFileSync|appendFileSync|createWriteStream|mkdirSync|https?:\/\//.test(bin), "the script writes nothing");
  // Only counts and hashed ids are printed: every out() line is from the fixed formats below.
  const outs = [...bin.matchAll(/out\(`([^`]*)`\)/g)].map((m) => m[1]);
  for (const o of outs) assert.ok(!/\$\{t\}|\$\{x\.text|\$\{s\.text|byId|\$\{prompt|\$\{p\.|promptText|sampleById|\.text\b|\$\{run\.sample/.test(o!), o);
});

test("the recorded runs fixture is the memcheck run 38913032640 record (40 runs, model lm-v1-1bfbea221e71)", () => {
  const f = JSON.parse(readFileSync(join(repo, "peaceai/model/m49-provenance-38913032640.json"), "utf8"));
  assert.equal(f.model, "lm-v1-1bfbea221e71"); assert.equal(f.memcheckRun, 38913032640); assert.equal(f.unexplainedRuns.length, 40);
  assert.equal(f.files["weights.npz"], "1bfbea221e7171bac7dacf229f63850b0ba9dc5a84d1f7d2ac0419733e77fb96");
  assert.ok(f.unexplainedRuns.every((r: { length: number }) => r.length >= 32 && r.length < 64));
  assert.ok(f.unexplainedRuns.every((r: { sample: string }) => /^[a-z]+-\d+:(greedy|sampled)$/.test(r.sample)), "full <prompt>:<decoding> ids");
  assert.deepEqual(f.prompts, { core: 96, public: 32, empty: 8 });
});

test("recorded runs with a bare prompt id (no :<decoding>) are ambiguous: BLOCK, fail closed", () => {
  const e = env(5);
  e.writeExp(e.runs.map((x) => ({ ...x, sample: x.sample.split(":")[0] })));
  const r = e.run();
  assert.equal(r.status, 1); assert.match(r.stdout, /verdict=BLOCK reason=RECORD_IDS_AMBIGUOUS/);
});

test("prompt overlap per run: inside / extends (tail or substring, then continues) / none; verdict PROMPT_LINKED_ALL only with no none", () => {
  const run = "export function computeSomethingUnique(a, b) {";
  assert.equal(PROMPT_OVERLAP_MIN, 8);
  assert.deepEqual(promptOverlap(run, `// ctx\n${run}\n}`), { overlap: run.length, cls: "inside" });
  const tail = promptOverlap(run, "header\nexport function compute"); // prompt tail, then the run continues
  assert.equal(tail.cls, "extends"); assert.equal(tail.overlap, "export function compute".length);
  const mid = promptOverlap(run, "xx SomethingUnique yy"); // a prompt substring inside the run
  assert.equal(mid.cls, "extends"); assert.equal(mid.overlap, "SomethingUnique".length);
  assert.deepEqual(promptOverlap(run, "nothing in common here"), { overlap: promptOverlap(run, "nothing in common here").overlap, cls: "none" });
  assert.ok(promptOverlap(run, "nothing in common here").overlap < PROMPT_OVERLAP_MIN);
  assert.equal(promptOverlap("", "abc").cls, "none");
  assert.equal(promptVerdict(["inside", "extends"]), "PROMPT_LINKED_ALL");
  assert.equal(promptVerdict(["inside", "none"]), "LEAK");
  assert.equal(promptVerdict([]), "LEAK", "no runs: fail closed");
});

test("end to end: per-run prompt overlap lines (sequential ids, counts only), per-string summary, prompt verdict; no text", () => {
  const e = env(5);
  const r = e.run(); // run() also asserts no text, no hex, nothing written
  const runs = [...r.stdout.matchAll(/^provenance run=(r\d+) string=(s\d+) length=(\d+) overlap=(\d+) prompt=(inside|extends|none)$/gm)];
  assert.equal(runs.length, e.runs.length);
  assert.deepEqual(runs.map((m) => m[1]), runs.map((_, i) => `r${String(i + 1).padStart(2, "0")}`));
  assert.ok(runs.every((m) => m[5] === "none" && Number(m[4]) < PROMPT_OVERLAP_MIN), "the core string is not in its core prompt");
  assert.match(r.stdout, /^provenance string=s01 prompt_inside=0 prompt_extends=0 prompt_none=\d+$/m);
  assert.match(r.stdout, new RegExp(`^provenance prompt_runs=${e.runs.length} inside=0 extends=0 none=${e.runs.length} overlap_min=8 prompt_verdict=LEAK$`, "m"));
});
