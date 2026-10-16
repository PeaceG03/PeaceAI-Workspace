// Run 38905982366 regression: a core-free corpus holds no core docs, so core prompts must come from the core
// checkout; empty-prompt samples never count toward the 100 minimum; every shortfall is visible in memcheck.json.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { memcheckStatus, MIN_MEMCHECK_SAMPLES } from "../lib/lm.ts";

const repo = resolve(import.meta.dirname, "..", "..");
const tsx = join(repo, "node_modules/.bin/tsx");

function setup(coreFiles: number, publicDocs: number, dropKind = "") {
  const dir = mkdtempSync(join(tmpdir(), "m49mc-"));
  const core = join(dir, "core"); mkdirSync(join(core, "src"), { recursive: true });
  for (let i = 0; i < coreFiles; i++) writeFileSync(join(core, "src", `c${i}.ts`), Array.from({ length: 12 }, (_, j) => `export const privateCoreValue${i}_${j} = ${i * 100 + j};`).join("\n") + "\n");
  execFileSync("git", ["init", "-q"], { cwd: core }); execFileSync("git", ["add", "-A"], { cwd: core });
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "c", "--allow-empty"], { cwd: core });
  const corpus = join(dir, "pre"); mkdirSync(corpus);
  const docs = Array.from({ length: publicDocs }, (_, i) => ({ doc: i, text: Array.from({ length: 12 }, (_, j) => `export const publicThing${i}_${j} = ${j};`).join("\n") + "\n" }));
  writeFileSync(join(corpus, "docs.jsonl"), docs.map((d) => JSON.stringify(d)).join("\n") + "\n");
  writeFileSync(join(corpus, "manifest.jsonl"), docs.map((d) => JSON.stringify({ doc: d.doc, source: "honojs/hono", visibility: "public", path: `src/p${d.doc}.ts`, sha256: "0".repeat(64), bytes: 1, license: "MIT", split: "train" })).join("\n") + "\n");
  const model = join(dir, "model"); mkdirSync(model);
  writeFileSync(join(model, "config.json"), JSON.stringify({ version: "lm-v1-000000000079" }));
  writeFileSync(join(model, "tokenizer.json"), "{}"); writeFileSync(join(model, "weights.npz"), "w");
  // Fake inference: two samples (greedy, sampled) per prompt, optionally dropping one prompt kind.
  const fake = join(dir, "fake-python");
  writeFileSync(fake, `#!/usr/bin/env python3
import json, sys
a = sys.argv; req = json.load(open(a[a.index("--request") + 1]))
s = [{"id": p["id"], "kind": k, "prompt_tail": "", "text": "x"} for p in req["prompts"] for k in ("greedy", "sampled") if not ${JSON.stringify(dropKind)} or not p["id"].startswith(${JSON.stringify(dropKind)} + "-")]
json.dump({"model": "lm-v1-000000000079", "samples": s}, open(a[a.index("--response") + 1], "w"))
`);
  chmodSync(fake, 0o755);
  return (env: Record<string, string>) => {
    const r = spawnSync(tsx, [join(repo, "peaceai/bin/lm-memcheck.ts")], { cwd: repo, encoding: "utf8", env: { ...process.env, GITHUB_ACTIONS: "", PEACEAI_PYTHON: fake, PEACEAI_LM_MODEL_DIR: model, PEACEAI_LM_CORPUS: corpus, PEACEAI_CORE_DIR: core, PEACEAI_LM_THREADS: "1", ...env } });
    return { r, rep: JSON.parse(readFileSync(join(model, "memcheck.json"), "utf8")) };
  };
}

test("run 38905982366: a corpus with no core docs still gets core prompts from the core checkout (PASS at full counts)", () => {
  const { r, rep } = setup(100, 40)({});
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual(rep.prompts, { core: 96, public: 32, empty: 8 });
  assert.equal(rep.scan.samples, 272); assert.equal(rep.scan.countedSamples, 256);
  assert.deepEqual(rep.sampling.dropped, []);
  assert.equal(rep.sampling.emptyPromptSamplesNotCounted, 16);
});

test("too little core text: the core shortfall is reported by kind and reason, and it fails closed", () => {
  const { r, rep } = setup(5, 40)({});
  assert.equal(r.status, 1); assert.equal(rep.status, "FAIL");
  assert.equal(rep.prompts.core, 5); assert.equal(rep.scan.countedSamples, 74);
  assert.deepEqual(rep.sampling.dropped, [{ kind: "core", count: 182, reason: "NOT_ENOUGH_CORE_TEXT (corpus core docs + core checkout files)" }]);
});

test("empty-prompt samples never count toward the 100 minimum (98 counted + 16 empty = FAIL)", () => {
  const { r, rep } = setup(100, 40)({ PEACEAI_MEMCHECK_CORE: "40", PEACEAI_MEMCHECK_PUBLIC: "9" });
  assert.equal(rep.scan.samples, 114); assert.equal(rep.scan.countedSamples, 98);
  assert.equal(r.status, 1); assert.equal(rep.status, "FAIL");
  assert.equal(memcheckStatus({ samples: 200, countedSamples: MIN_MEMCHECK_SAMPLES - 1, coreLineHits: 0, coreShingleHits: 0, coreSubstringHits: 0, personalInfo: 0, flagged: 0 }), "FAIL");
  assert.equal(memcheckStatus({ samples: 200, coreLineHits: 0, coreShingleHits: 0, coreSubstringHits: 0, personalInfo: 0, flagged: 0 }), "FAIL", "no countedSamples: fail closed");
});

test("samples the sampler did not return are reported as NOT_RETURNED_BY_INFER", () => {
  const { rep } = setup(100, 40, "public")({});
  assert.deepEqual(rep.sampling.dropped, [{ kind: "public", count: 64, reason: "NOT_RETURNED_BY_INFER" }]);
});
