// M9: from-scratch model guardrails. Gradient/determinism self-test, corpus license rules and manifest,
// fail-closed memorization check, fail-closed model loading, flags off by default, template gap fill
// accepted only among Job A's own options, LM promotion rule, isolation (no outside model, no M8 rules).
import assert from "node:assert/strict";
import { buildSubstringIndex, countCoreSubstrings } from "../lib/substr.ts";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { acceptFill, applyFill, fillHole, fillKey, fillOptions, FILLS_SCHEMA, parseFillTask } from "../lib/fill.ts";
import { activeWithLm, COREFREE_MIN_RUN, lmJobAllowed, LM_JOB_WORKFLOWS, LM_JOBS, manifestProvesNoCore, validCoreFreeProof, type PublicOnlyExemption, runInfer, diffScoreItems, lmEvaluate, lmFlags, lmShadowRanking, memcheckStatus, scanSamples, verifyModelDir } from "../lib/lm.ts";
import { addText, emptyIndex } from "../lib/coretext.ts";
import { ALLOWED_SPDX, classifyLicense, fileExclusion, splitOf } from "../lib/lmcorpus.ts";

const repo = resolve(import.meta.dirname, "..", "..");
const tsx = join(repo, "node_modules/.bin/tsx");
const py = process.env.PEACEAI_PYTHON ?? "python3";
const scratch = () => mkdtempSync(join(tmpdir(), "m9-"));
const git = (cwd: string, ...a: string[]) => execFileSync("git", a, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const commitAll = (cwd: string) => { git(cwd, "add", "-A"); git(cwd, "-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-qm", "c"); };
const CORE_LINE = "const peaceaiPrivateMarker = computeTheVeryDistinctiveCoreOnlyValue(alpha, beta, gamma);";

// ---- model math

test("numpy transformer: analytic gradients match numeric, training is seeded/deterministic, BPE round-trips, M9 size is 10-50M", () => {
  const r = JSON.parse(execFileSync(py, [join(repo, "peaceai/model/selftest.py")], { encoding: "utf8" }));
  assert.ok(r.grad_checked >= 20);
  assert.ok(r.grad_rel_err < 1e-4, `grad rel err ${r.grad_rel_err}`);
  assert.equal(r.deterministic, true);
  assert.ok(r.loss_last < r.loss_first, "loss goes down on a learnable sequence");
  assert.equal(r.roundtrip, true);
  assert.equal(r.merged, true);
  assert.ok(r.params_m9 >= 10_000_000 && r.params_m9 <= 50_000_000, String(r.params_m9));
});

// ---- tiny end-to-end model (train -> export -> memcheck)

function tinyCorpus(dir: string) {
  const corpus = join(dir, "corpus");
  mkdirSync(corpus, { recursive: true });
  const docs: string[] = [], man: string[] = [];
  for (let i = 0; i < 70; i += 1) {
    const text = `export function f${i}(x: number): number {\n  return x + ${i};\n}\n`;
    const source = i < 60 ? "PeaceG03/PeaceAI" : "colinhacks/zod";
    docs.push(JSON.stringify({ doc: i, text }));
    man.push(JSON.stringify({ doc: i, source, visibility: i < 60 ? "private" : "public", commit: "a".repeat(40), path: `src/f${i}.ts`, sha256: "0", bytes: text.length, license: i < 60 ? "owner:PeaceG03" : "MIT", split: i % 10 === 3 ? "heldout" : "train" }));
  }
  writeFileSync(join(corpus, "docs.jsonl"), docs.join("\n") + "\n");
  writeFileSync(join(corpus, "manifest.jsonl"), man.join("\n") + "\n");
  return corpus;
}
const TINY = ["--d-model", "16", "--n-layer", "1", "--n-head", "2", "--ctx", "32", "--vocab", "300", "--batch", "2", "--threads", "1", "--eval-every", "2"];
const trainTiny = (corpus: string, work: string, steps: number) =>
  execFileSync(py, [join(repo, "peaceai/model/train.py"), "--corpus", corpus, "--work", work, "--steps", "4", "--max-seconds", "1e9", ...TINY, ...(steps < 4 ? ["--max-steps-this-run", String(steps)] : [])], { encoding: "utf8" });
const paramHash = (work: string) => execFileSync(py, ["-c", `import numpy as np,hashlib;z=np.load("${work}/checkpoint.npz");print(hashlib.sha256(b"".join(z[k].tobytes() for k in sorted(z.files) if k.startswith("p."))).hexdigest())`], { encoding: "utf8" }).trim();

let shared: { dir: string; corpus: string; model: string; core: string } | null = null;
function tinyModel() {
  if (shared) return shared;
  const dir = scratch();
  const corpus = tinyCorpus(dir);
  trainTiny(corpus, join(dir, "work"), 4);
  const model = join(dir, "model");
  execFileSync(py, [join(repo, "peaceai/model/export.py"), "--work", join(dir, "work"), "--out", model, "--threads", "1"], { encoding: "utf8" });
  const core = join(dir, "core");
  mkdirSync(core);
  writeFileSync(join(core, "a.ts"), `${CORE_LINE}\n`);
  git(core, "init", "-q");
  commitAll(core);
  shared = { dir, corpus, model, core };
  return shared;
}
test.after(() => { if (shared) rmSync(shared.dir, { recursive: true, force: true }); });

test("training: same seed -> identical weights; 2 steps + resume 2 steps == 4 steps straight", () => {
  const { dir, corpus } = tinyModel();
  trainTiny(corpus, join(dir, "w1"), 4);
  trainTiny(corpus, join(dir, "w2"), 4);
  assert.equal(paramHash(join(dir, "w1")), paramHash(join(dir, "w2")));
  const out1 = trainTiny(corpus, join(dir, "w3"), 2);
  assert.match(out1, /stopped step=2 of 4/);
  const out2 = trainTiny(corpus, join(dir, "w3"), 4);
  assert.match(out2, /resumed step=2/);
  assert.equal(paramHash(join(dir, "w3")), paramHash(join(dir, "w1")));
  const metrics = readFileSync(join(dir, "w1", "metrics.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.ok(metrics.some((m) => typeof m.val_loss === "number"));
});

function memcheck(model: string, corpus: string, core: string, extraEnv: Record<string, string> = {}) {
  return spawnSync(tsx, [join(repo, "peaceai/bin/lm-memcheck.ts")], { cwd: repo, encoding: "utf8", env: { ...process.env, PEACEAI_LM_MODEL_DIR: model, PEACEAI_LM_CORPUS: corpus, PEACEAI_CORE_DIR: core, PEACEAI_MEMCHECK_CORE: "50", PEACEAI_MEMCHECK_PUBLIC: "0", PEACEAI_LM_THREADS: "1", ...extraEnv } });
}

test("memcheck PASS binds the exact file hashes; scoring works only then; a changed file is refused (fail closed)", () => {
  const { dir, corpus, model, core } = tinyModel();
  assert.deepEqual(verifyModelDir(model), { ok: false, reason: "MEMCHECK_MISSING" });
  const req = join(dir, "req.json");
  writeFileSync(req, JSON.stringify({ items: [{ id: "a", context: "export function", target: " g() {}\n" }] }));
  const refused = spawnSync(py, [join(repo, "peaceai/model/infer.py"), "score", "--model", model, "--request", req, "--response", join(dir, "res.json")], { encoding: "utf8" });
  assert.equal(refused.status, 3);
  assert.match(refused.stderr, /MEMCHECK_REQUIRED/);
  const m = memcheck(model, corpus, core);
  assert.equal(m.status, 0, m.stdout + m.stderr);
  assert.match(m.stdout, /memcheck status=PASS samples=116 core_line_hits=0 core_shingle_hits=0 core_substring_hits=0 personal_info=0/);
  { // real infer.py: ids are unique <prompt>:<decoding>, every returned sample scanned
    const rep = JSON.parse(readFileSync(join(model, "memcheck.json"), "utf8"));
    assert.equal(rep.sampling.duplicateSampleIds, 0); assert.equal(rep.sampling.scannedSamples, rep.sampling.returnedTotal); assert.equal(rep.scan.scannedSamples, 116);
  }
  const v = verifyModelDir(model);
  assert.ok(v.ok);
  const ok = spawnSync(py, [join(repo, "peaceai/model/infer.py"), "score", "--model", model, "--request", req, "--response", join(dir, "res.json")], { encoding: "utf8" });
  assert.equal(ok.status, 0, ok.stderr);
  assert.ok(JSON.parse(readFileSync(join(dir, "res.json"), "utf8")).scores[0].tokens > 0);
  // Tamper: a changed tokenizer (or weights) no longer matches the PASS.
  const stale = join(dir, "stale");
  mkdirSync(stale);
  for (const f of readdirSync(model)) writeFileSync(join(stale, f), readFileSync(join(model, f)));
  appendFileSync(join(stale, "tokenizer.json"), " ");
  assert.deepEqual(verifyModelDir(stale), { ok: false, reason: "MEMCHECK_STALE" });
  assert.equal(spawnSync(py, [join(repo, "peaceai/model/infer.py"), "score", "--model", stale, "--request", req, "--response", join(dir, "r2.json")]).status, 3);
  const failed = join(dir, "failed");
  mkdirSync(failed);
  for (const f of readdirSync(model)) writeFileSync(join(failed, f), readFileSync(join(model, f)));
  const mc = JSON.parse(readFileSync(join(failed, "memcheck.json"), "utf8"));
  writeFileSync(join(failed, "memcheck.json"), JSON.stringify({ ...mc, status: "FAIL" }));
  assert.deepEqual(verifyModelDir(failed), { ok: false, reason: "MEMCHECK_FAILED" });
});

function fakePython(dir: string, samplesJson: string | null): string {
  const f = join(dir, `fake-python-${Math.random().toString(16).slice(2)}`);
  writeFileSync(f, `#!/usr/bin/env bash
out=""; prev=""
for a in "$@"; do if [ "$prev" = "--response" ]; then out="$a"; fi; prev="$a"; done
${samplesJson === null ? "exit 1" : `cat > "$out" <<'JSON'\n${samplesJson}\nJSON`}
`);
  chmodSync(f, 0o755);
  return f;
}

test("memcheck FAILS closed: core text in output, personal info in output, too few samples, inference error", () => {
  const { dir, corpus, model, core } = tinyModel();
  const copy = join(dir, "mc-copy");
  mkdirSync(copy, { recursive: true });
  for (const f of ["config.json", "tokenizer.json", "weights.npz"]) writeFileSync(join(copy, f), readFileSync(join(model, f)));
  const many = (text: string) => JSON.stringify({ model: "lm-v1-000000000000", samples: Array.from({ length: 120 }, (_, i) => ({ id: `s${i}`, kind: "greedy", prompt_tail: "", text: i === 7 ? text : "x" })) });
  const email = ["someone", "gmail.com"].join("@");
  for (const [samples, pattern] of [
    [many(`${CORE_LINE}\n`), /status=FAIL samples=120 core_line_hits=1/],
    [many(`zz(${CORE_LINE.slice(10, 50)})\n`), /status=FAIL samples=120 core_line_hits=0 core_shingle_hits=0 core_substring_hits=1 personal_info=0/],
    [many(`contact ${email}\n`), /status=FAIL samples=120 core_line_hits=0 core_shingle_hits=0 core_substring_hits=0 personal_info=1/],
    [JSON.stringify({ model: "m", samples: [{ id: "a", kind: "greedy", prompt_tail: "", text: "x" }] }), /status=FAIL samples=1 /],
    [null, /status=FAIL samples=0 .*reason=INFER_FAILED/],
  ] as const) {
    const r = memcheck(copy, corpus, core, { PEACEAI_PYTHON: fakePython(dir, samples) });
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stdout, pattern);
    assert.equal(JSON.parse(readFileSync(join(copy, "memcheck.json"), "utf8")).status, "FAIL");
    assert.equal(verifyModelDir(copy).ok, false);
  }
  // No sample text is written anywhere by the check.
  assert.ok(!readFileSync(join(copy, "memcheck.json"), "utf8").includes("someone"));
});

test("scanSamples / memcheckStatus units: a core line completed from the prompt's tail counts; public lines do not", () => {
  const core = emptyIndex(); addText(core, CORE_LINE + "\n");
  const baseline = emptyIndex();
  const pub = "export const publicallyKnownLongLineThatAlsoExistsInPublicCode = createThing(1, 2, 3);";
  addText(core, pub); addText(baseline, pub);
  const s = (prompt_tail: string, text: string) => ({ id: "a", kind: "greedy", prompt_tail, text });
  const raw = buildSubstringIndex([CORE_LINE + "\n", pub]);
  assert.equal(scanSamples([s(CORE_LINE.slice(0, 20), CORE_LINE.slice(20))], core, baseline, raw).coreLineHits, 1);
  assert.equal(scanSamples([s("", pub)], core, baseline, raw).coreLineHits, 0);
  // Prompt echo: the whole core line (or all but a few characters) came from the prompt, not the model.
  assert.equal(scanSamples([s(CORE_LINE, "")], core, baseline, raw).coreLineHits, 0);
  assert.equal(scanSamples([s(CORE_LINE, "\nx")], core, baseline, raw).coreLineHits, 0);
  assert.equal(scanSamples([s(CORE_LINE.slice(0, -8), CORE_LINE.slice(-8))], core, baseline, raw).coreLineHits, 0);
  // ...but a core line the model then writes in full is still caught, and so is a completion of 12+ non-space characters.
  assert.equal(scanSamples([s(CORE_LINE, "\n" + CORE_LINE)], core, baseline, raw).coreLineHits, 1);
  assert.equal(scanSamples([s(CORE_LINE.slice(0, -16), CORE_LINE.slice(-16))], core, baseline, raw).coreLineHits, 1);
  assert.equal(memcheckStatus(null), "FAIL");
  assert.equal(memcheckStatus({ samples: 99, coreLineHits: 0, coreShingleHits: 0, coreSubstringHits: 0, personalInfo: 0, flagged: 0 }), "FAIL");
  assert.equal(memcheckStatus({ samples: 100, countedSamples: 100, scannedSamples: 100, coreLineHits: 0, coreShingleHits: 0, coreSubstringHits: 0, personalInfo: 0, flagged: 0 }), "PASS");
  assert.equal(memcheckStatus({ samples: 100, countedSamples: 100, scannedSamples: 99, coreLineHits: 0, coreShingleHits: 0, coreSubstringHits: 0, personalInfo: 0, flagged: 0 }), "FAIL", "a returned sample not scanned");
  assert.equal(memcheckStatus({ samples: 116, countedSamples: 99, coreLineHits: 0, coreShingleHits: 0, coreSubstringHits: 0, personalInfo: 0, flagged: 0 }), "FAIL", "empty-prompt samples never count");
  assert.equal(memcheckStatus({ samples: 100, coreLineHits: 0, coreShingleHits: 0, coreSubstringHits: 1, personalInfo: 0, flagged: 0 }), "FAIL");
  assert.equal(memcheckStatus({ samples: 100, coreLineHits: 0, coreShingleHits: 0, personalInfo: 0, flagged: 0 } as never), "FAIL");
});

test("32-character core substring scan: a short memorized completion is caught where the line scan is not", () => {
  const core = emptyIndex(); addText(core, CORE_LINE + "\n");
  const baseline = emptyIndex();
  const raw = buildSubstringIndex([CORE_LINE + "\n"]);
  const s = (prompt_tail: string, text: string) => ({ id: "a", kind: "sampled", prompt_tail, text });
  // 40 copied characters inside an otherwise new line, under the 12-char echo rule's radar for line hashes.
  const copied = CORE_LINE.slice(10, 50);
  const shortCopy = scanSamples([s("const x = 1;", "\n" + "zz(" + copied + ")")], core, baseline, raw);
  assert.equal(shortCopy.coreLineHits, 0);
  assert.equal(shortCopy.coreSubstringHits, 1);
  assert.equal(memcheckStatus({ ...shortCopy, samples: 100 }), "FAIL");
  // The first line's new part counts too: the prompt ends mid-line and the model writes 32+ copied characters.
  const firstLine = scanSamples([s(CORE_LINE.slice(0, 20), CORE_LINE.slice(20, 56))], core, baseline, raw);
  assert.equal(firstLine.coreSubstringHits, 1);
  // 31 copied characters are not a hit; the prompt's own text never is.
  assert.equal(scanSamples([s(CORE_LINE, "\n" + CORE_LINE.slice(10, 41) + "!")], core, baseline, raw).coreSubstringHits, 0);
  assert.equal(scanSamples([s(CORE_LINE, "")], core, baseline, raw).coreSubstringHits, 0);
  // A hash collision cannot pass for a hit, and a missing core index fails closed.
  assert.equal(countCoreSubstrings("q".repeat(200), raw), 0);
  assert.equal(scanSamples([s("", "harmless")], core, baseline, null).coreSubstringHits, 1);
});

// ---- corpus rules

const MIT = "MIT License\n\nCopyright (c) 2020 X\n\nPermission is hereby granted, free of charge, to any person obtaining a copy of this software...\nTHE SOFTWARE IS PROVIDED \"AS IS\", WITHOUT WARRANTY";
const ISC = "ISC License\n\nPermission to use, copy, modify, and/or distribute this software for any purpose with or without fee is hereby granted, provided that the above copyright notice and this permission notice appear in all copies.";
const BSD3 = "Redistribution and use in source and binary forms, with or without modification, are permitted...\n3. Neither the name of the copyright holder nor the names";
test("license classifier: only plain MIT / ISC / Apache-2.0 / BSD; mixed or carve-out licenses are refused", () => {
  assert.equal(classifyLicense(MIT), "MIT");
  assert.equal(classifyLicense(ISC), "ISC");
  assert.equal(classifyLicense("Apache License\n Version 2.0, January 2004\n http://www.apache.org/licenses/"), "Apache-2.0");
  assert.equal(classifyLicense(BSD3), "BSD-3-Clause");
  assert.equal(classifyLicense("Redistribution and use in source and binary forms, with or without modification"), "BSD-2-Clause");
  assert.equal(classifyLicense("GNU GENERAL PUBLIC LICENSE Version 3"), null);
  assert.equal(classifyLicense("All packages under `src/` are licensed according to the terms in their respective `LICENSE` files. " + ISC), null);
  assert.equal(classifyLicense("This license applies to all parts of protobuf.js except those files either explicitly including or referencing a different license. " + BSD3), null);
  assert.equal(classifyLicense("Blue Oak Model License 1.0.0"), null);
  assert.equal(classifyLicense("Mozilla Public License Version 2.0"), null);
  assert.deepEqual([...ALLOWED_SPDX], ["MIT", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "ISC"]);
});

test("file rules: non-code, vendored, minified, generated, nested LICENSE, non-permissive headers and personal info are excluded", () => {
  const ok = "export const a = 1;\n";
  assert.equal(fileExclusion("src/a.ts", ok, [], false), null);
  assert.equal(fileExclusion("README.md", ok, [], false), "not-code");
  assert.equal(fileExclusion("node_modules/x/a.js", ok, [], false), "excluded-dir");
  assert.equal(fileExclusion("dist/a.js", ok, [], false), "excluded-dir");
  assert.equal(fileExclusion("a.min.js", ok, [], false), "minified");
  assert.equal(fileExclusion("a.js", "x".repeat(5000), [], false), "minified");
  assert.equal(fileExclusion("a.ts", "// @generated by tool\n" + ok, [], false), "generated");
  assert.equal(fileExclusion("lib/x/a.ts", ok, ["lib/x"], false), "nested-license");
  assert.equal(fileExclusion("a.ts", "// SPDX-License-Identifier: GPL-3.0-only\n" + ok, [], false), "license-header");
  assert.equal(fileExclusion("a.ts", "// SPDX-License-Identifier: MIT\n" + ok, [], false), null);
  assert.equal(fileExclusion("a.ts", "/* Licensed under the Mozilla Public License */\n" + ok, [], false), "license-header");
  assert.equal(fileExclusion("a.ts", `// by ${["someone", "gmail.com"].join("@")}\n` + ok, [], true), "personal-info");
  assert.equal(fileExclusion("a.ts", "x".repeat(150_001), [], true), "too-large");
  assert.equal(splitOf("s", "a.ts"), splitOf("s", "a.ts"));
  const held = Array.from({ length: 2000 }, (_, i) => splitOf("s", `f${i}.ts`)).filter((x) => x === "heldout").length;
  assert.ok(held > 50 && held < 160, String(held));
});

test("sources.json: owner repos plus pinned permissive repos with allowed SPDX ids only", () => {
  const s = JSON.parse(readFileSync(join(repo, "peaceai/model/sources.json"), "utf8"));
  assert.deepEqual(s.owner.map((o: { name: string }) => o.name), ["PeaceG03/PeaceAI", "PeaceG03/PeaceSTOCKS", "PeaceG03/PeaceAI-Workspace"]);
  for (const p of s.permissive) {
    assert.match(p.commit, /^[0-9a-f]{40}$/);
    assert.ok((ALLOWED_SPDX as readonly string[]).includes(p.spdx));
  }
});

test("lm-corpus.ts: manifest records source, commit, path, sha256, license and split; non-matching licenses refuse the source", () => {
  const dir = scratch();
  try {
    const mk = (name: string, files: Record<string, string>) => {
      const d = join(dir, name); mkdirSync(d, { recursive: true });
      for (const [p, t] of Object.entries(files)) { mkdirSync(join(d, p, ".."), { recursive: true }); writeFileSync(join(d, p), t); }
      git(d, "init", "-q"); commitAll(d); return { d, commit: git(d, "rev-parse", "HEAD").trim() };
    };
    const owner = mk("owner", { "src/a.ts": "export const a = 1;\n", "notes.md": "x" });
    const pub = mk("perm/acme__lib", { LICENSE: MIT, "src/b.ts": "export const b = 2;\n", "third/LICENSE": "GPL", "third/c.ts": "export const c = 3;\n" });
    const gpl = mk("perm/acme__gpl", { LICENSE: "GNU GENERAL PUBLIC LICENSE", "d.ts": "export const d = 4;\n" });
    const sourcesPath = join(repo, "peaceai/model/sources.json");
    const original = readFileSync(sourcesPath, "utf8");
    const out = join(dir, "out");
    try {
      writeFileSync(sourcesPath, JSON.stringify({ schema: "peaceai-lm-sources:v1", owner: [{ name: "PeaceG03/PeaceAI", visibility: "private", ref: "HEAD", license: "owner:PeaceG03" }], permissive: [{ name: "acme/lib", commit: pub.commit, spdx: "MIT" }, { name: "acme/gpl", commit: gpl.commit, spdx: "MIT" }] }));
      const r = spawnSync(tsx, [join(repo, "peaceai/bin/lm-corpus.ts")], { cwd: repo, encoding: "utf8", env: { ...process.env, PEACEAI_LM_OUT: out, PEACEAI_LM_PERMISSIVE_DIR: join(dir, "perm"), PEACEAI_LM_OWNER_DIRS: JSON.stringify({ "PeaceG03/PeaceAI": owner.d }) } });
      assert.equal(r.status, 0, r.stderr);
      assert.match(r.stdout, /corpus files=2 .* refused_sources=1/);
    } finally { writeFileSync(sourcesPath, original); }
    const man = readFileSync(join(out, "manifest.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    assert.deepEqual(man.map((m) => [m.source, m.path, m.license, m.commit]), [["PeaceG03/PeaceAI", "src/a.ts", "owner:PeaceG03", owner.commit], ["acme/lib", "src/b.ts", "MIT", pub.commit]]);
    for (const m of man) { assert.match(m.sha256, /^[0-9a-f]{64}$/); assert.ok(["train", "heldout"].includes(m.split)); }
    const summary = JSON.parse(readFileSync(join(out, "summary.json"), "utf8"));
    assert.deepEqual(summary.refusedSources, [{ name: "acme/gpl", expected: "MIT", found: null, pinned: true }]);
    assert.equal(summary.sources[1].excluded["nested-license"], 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ---- flags, shadow, promotion

test("flags are OFF by default (only the exact string 'true' turns one on)", () => {
  assert.deepEqual(lmFlags({}), { shadow: false, fill: false });
  assert.deepEqual(lmFlags({ PEACEAI_LM_SHADOW: "1", PEACEAI_LM_FILL: "TRUE" }), { shadow: false, fill: false });
  assert.deepEqual(lmFlags({ PEACEAI_LM_SHADOW: "true" }), { shadow: true, fill: false });
});

test("LM shadow: unverified model -> no score; diff items score added blocks with their context", () => {
  const dir = scratch();
  try {
    mkdirSync(join(dir, "m"));
    const ranking = { presentation: [{ label: "A", id: "candidate-1" }], rankerOrder: ["candidate-1"] } as never;
    assert.equal(lmShadowRanking(join(dir, "m"), ranking, () => "+x"), null);
  } finally { rmSync(dir, { recursive: true, force: true }); }
  const items = diffScoreItems("diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1,2 +1,3 @@\n const a = 1;\n-const b = 2;\n+const b = 3;\n const c = 4;\n");
  assert.deepEqual(items, [{ context: "// src/a.ts\nconst a = 1;\n", target: "const b = 3;\n" }]);
});

test("LM shadow end to end with the verified tiny model; 'lm' is active only with PEACEAI_RANKER=lm AND the promotion rule", () => {
  const { model } = tinyModel();
  if (!verifyModelDir(model).ok) return; // the PASS test above must run first in this file (it does, in order)
  const ranking = { presentation: [{ label: "A", id: "candidate-1" }, { label: "B", id: "candidate-2" }], rankerOrder: ["candidate-2", "candidate-1"] } as never;
  const d = (n: number) => `--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1,2 @@\n export function f1(x: number): number {\n+  return x + ${n};\n`;
  const s = lmShadowRanking(model, ranking, (id) => d(id === "candidate-1" ? 1 : 99999));
  assert.ok(s);
  assert.match(s!.model, /^lm-v1-[0-9a-f]{12}$/);
  assert.deepEqual([...s!.order].sort(), ["candidate-1", "candidate-2"]);
  assert.equal(activeWithLm("lm", false, "deterministic"), "deterministic");
  assert.equal(activeWithLm(undefined, true, "deterministic"), "deterministic");
  assert.equal(activeWithLm("lm", true, "deterministic"), "lm");
});

test("lmEvaluate: promotion needs 10 held-out decided tasks with an LM score and beating the baseline", () => {
  const V = "lm-v1-000000000009";
  const task = (issue: number, lmTop: string, pick: string, heldOut = true, model: string | undefined = V) => ({
    task: { issue, runId: "1", test: false, heldOut },
    ranking: { presentation: [{ id: "a" }, { id: "b" }], rankerTop: "a", lmShadow: { top: lmTop, ...(model === undefined ? {} : { model }) } },
    verdicts: [{ schema: "x", issue, runId: "1", commentId: String(issue), recordedAt: "2026-10-10T00:00:00Z", label: "A", candidateId: pick, verdict: "right" }],
  });
  const few = lmEvaluate(Array.from({ length: 3 }, (_, i) => task(i + 1, "b", "b")) as never, V);
  assert.equal(few.eligible, false);
  assert.match(few.reasons.join(";"), /held-out tasks with an LM score 3 < 10/);
  const tie = lmEvaluate(Array.from({ length: 12 }, (_, i) => task(i + 1, "a", "a")) as never, V);
  assert.equal(tie.eligible, false, "equal to the baseline is not enough");
  const beats = lmEvaluate([...Array.from({ length: 10 }, (_, i) => task(i + 1, "b", "b")), task(99, "b", "b", false)] as never, V);
  assert.deepEqual([beats.tasks, beats.lmAgree, beats.baselineAgree, beats.eligible, beats.version], [10, 10, 0, true, V]);
});

test("Fix B lmEvaluate counts only shadow scores from the model being judged; other or unversioned scores do not count", () => {
  const V = "lm-v1-000000000009", OTHER = "lm-v1-0000000000aa";
  const task = (issue: number, model: unknown) => ({
    task: { issue, runId: "1", test: false, heldOut: true },
    ranking: { presentation: [{ id: "a" }, { id: "b" }], rankerTop: "a", lmShadow: { top: "b", ...(model === undefined ? {} : { model }) } },
    verdicts: [{ schema: "x", issue, runId: "1", commentId: String(issue), recordedAt: "2026-10-10T00:00:00Z", label: "A", candidateId: "b", verdict: "right" }],
  });
  const mine = Array.from({ length: 10 }, (_, i) => task(i + 1, V));
  const others = [...Array.from({ length: 10 }, (_, i) => task(100 + i, OTHER)), task(200, undefined), task(201, null), task(202, ""), task(203, "lm-v1-bad")];
  const r = lmEvaluate([...mine, ...others] as never, V);
  assert.deepEqual([r.tasks, r.lmAgree, r.version, r.eligible], [10, 10, V, true], "only the judged model's 10 scores count");
  const o = lmEvaluate([...mine.slice(0, 9), ...others] as never, V);
  assert.deepEqual([o.tasks, o.eligible], [9, false], "another model's scores never fill the minimum");
  const other = lmEvaluate([...mine, ...others] as never, OTHER);
  assert.deepEqual([other.tasks, other.version], [10, OTHER]);
  for (const v of [null, "", "lm-v1-bad"]) {
    const n = lmEvaluate([...mine, ...others] as never, v);
    assert.deepEqual([n.tasks, n.eligible, n.version], [0, false, null], `no valid version (${v}): nothing counts`);
    assert.match(n.reasons.join(";"), /no model version to judge/);
  }
  // Every recorded score names its model: lmShadowRanking sets lmShadow.model from the verified model only.
  const src = readFileSync(join(repo, "peaceai/lib/lm.ts"), "utf8");
  assert.match(src, /return \{ model: ok\.version, order, top: order\[0\] \?\? null, scores \};/);
  assert.match(src, /if \(!r\.ok \|\| r\.response\.model !== ok\.version\) return null;/);
  // Callers judge the model they score (record-task.ts) or latest.json's (train.ts), never every score.
  assert.match(readFileSync(join(repo, "peaceai/bin/record-task.ts"), "utf8"), /lmEvaluate\(loadAll\(resultsRoot\), lmShadow\.model\)/);
  assert.match(readFileSync(join(repo, "peaceai/bin/train.ts"), "utf8"), /lmEvaluate\(stored, latestLmVersion\(root\)\)/);
});

// ---- gap fill guardrails

const CONFIG = 'export const LIMITS = { retries: 3, timeoutMs: 2500 };\nexport const MODE = "fast";\nexport const ENABLED = true;\n';
test("fill template: parses only value-less constant tasks; options are target literals of the right type", () => {
  assert.deepEqual(parseFillTask("add an exported constant MAX_RETRIES of type number to src/config.ts"), { name: "MAX_RETRIES", type: "number", path: "src/config.ts" });
  assert.deepEqual(parseFillTask("Add exported const `LABEL` to `src/config.ts`"), { name: "LABEL", type: null, path: "src/config.ts" });
  assert.equal(parseFillTask("add an exported constant MAX_RETRIES = 4 to src/config.ts"), null);
  assert.equal(parseFillTask("add an exported constant MAX_RETRIES set to 4 in src/config.ts"), null);
  assert.equal(parseFillTask("add an exported constant X to ../etc/passwd.ts"), null);
  const t = parseFillTask("add an exported constant MAX_RETRIES of type number to src/config.ts")!;
  assert.deepEqual(fillOptions(t, [{ path: "src/config.ts", content: CONFIG }, { path: "src/b.ts", content: "export const Z = 7;\n" }]), ["3", "2500", "7", "0"]);
  const s = parseFillTask("add an exported constant LABEL of type string to src/config.ts")!;
  assert.deepEqual(fillOptions(s, [{ path: "src/config.ts", content: CONFIG + 'import x from "./x";\n' }]), ['"fast"', '""']);
  assert.equal(fillHole(t, "export const MAX_RETRIES = 1;\n"), null, "never redeclares");
  assert.equal(applyFill(t, CONFIG, "3"), CONFIG + "\nexport const MAX_RETRIES = 3;\n");
});

test("acceptFill: wrong schema, wrong task key, unknown model id or a value outside Job A's options -> refused", () => {
  const t = parseFillTask("add an exported constant MAX_RETRIES of type number to src/config.ts")!;
  const opts = ["3", "2500", "0"];
  const good = { schema: FILLS_SCHEMA, key: fillKey(t), model: "lm-v1-0123456789ab", value: "3", options: 3 };
  assert.equal(acceptFill(good, t, opts), "3");
  assert.equal(acceptFill({ ...good, value: "process.exit(1)" }, t, opts), null);
  assert.equal(acceptFill({ ...good, value: "4" }, t, opts), null);
  assert.equal(acceptFill({ ...good, key: "0".repeat(16) }, t, opts), null);
  assert.equal(acceptFill({ ...good, schema: "x" }, t, opts), null);
  assert.equal(acceptFill({ ...good, model: "gpt" }, t, opts), null);
  assert.equal(acceptFill(null, t, opts), null);
});

function fakeKernel(dir: string): string {
  const file = join(dir, "fake-kernel.cjs");
  writeFileSync(file, `const crypto = require("node:crypto");
exports.NATIVE_CODE_SYNTHESIS_PROTOCOL_VERSION = "x";
exports.sourceFingerprint = (p, c) => crypto.createHash("sha256").update(p + "\\0" + c).digest("hex");
exports.PeaceAINativeCodeSynthesizer = class { synthesize() { return { status: "INSUFFICIENT" }; } };
exports.parsePlanSteps = () => null;
`);
  return file;
}

function runJobA(fill: string | undefined, fills: unknown) {
  const dir = scratch();
  try {
    const ws = join(dir, "ws");
    mkdirSync(join(ws, "src"), { recursive: true });
    writeFileSync(join(ws, "src/config.ts"), CONFIG);
    git(ws, "init", "-q"); commitAll(ws);
    const fillsPath = join(dir, "fills.json");
    if (fills) writeFileSync(fillsPath, JSON.stringify(fills));
    const rules = join(dir, "rules"); mkdirSync(rules);
    const env: Record<string, string> = { ...(process.env as Record<string, string>), PEACEAI_KERNEL_BUNDLE: fakeKernel(dir), PEACEAI_OUT_DIR: join(dir, "out"), PEACEAI_WORKSPACE_DIR: ws, PEACEAI_TARGET: "PeaceG03/PeaceAI-Workspace", ISSUE_NUMBER: "9", ISSUE_TITLE: "[test] fill", ISSUE_BODY: "add an exported constant MAX_RETRIES of type number to src/config.ts", PEACEAI_LM_FILLS: fillsPath, PEACEAI_RULES_DIR: rules };
    delete env.PEACEAI_LM_FILL;
    if (fill !== undefined) env.PEACEAI_LM_FILL = fill;
    const r = spawnSync(tsx, [join(repo, "peaceai/bin/generate.ts")], { cwd: repo, encoding: "utf8", env });
    const summary = existsSync(join(dir, "out/summary.json")) ? JSON.parse(readFileSync(join(dir, "out/summary.json"), "utf8")) : null;
    const diff = summary?.candidates[0] ? readFileSync(join(dir, "out", summary.candidates[0].file), "utf8") : "";
    return { r, summary, diff };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

test("Job A: fill candidate only with the flag on AND a fill among its own options; flag off by default", () => {
  const t = parseFillTask("add an exported constant MAX_RETRIES of type number to src/config.ts")!;
  const good = { schema: FILLS_SCHEMA, key: fillKey(t), model: "lm-v1-0123456789ab", value: "3", options: 3 };
  const off = runJobA(undefined, good);
  assert.equal(off.r.status, 0, off.r.stderr);
  assert.match(off.r.stdout, /lm fill=off/);
  assert.equal(off.summary.candidates.length, 0);
  const on = runJobA("true", good);
  assert.match(on.r.stdout, /lm fill=candidate/);
  assert.deepEqual(on.summary.candidates.map((c: { transformations: string[]; operationId: string }) => [c.transformations, c.operationId]), [[["LM_FILL_CONSTANT"], "lm-fill:lm-v1-0123456789ab"]]);
  assert.match(on.diff, /^\+export const MAX_RETRIES = 3;$/m);
  const injected = runJobA("true", { ...good, value: "require('child_process')" });
  assert.match(injected.r.stdout, /lm fill=refused/);
  assert.equal(injected.summary.candidates.length, 0);
  assert.match(runJobA("true", undefined).r.stdout, /lm fill=no-fill/);
});

// ---- isolation and workflow placement

test("isolation: model code has no network, no outside model or tokenizer, and M9 never touches M8 learned rules", () => {
  const dir = join(repo, "peaceai/model");
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".py"))) {
    const text = readFileSync(join(dir, f), "utf8");
    const imports = [...text.matchAll(/^\s*(?:import|from)\s+([A-Za-z_.]+)/gm)].map((m) => m[1]!.split(".")[0]);
    for (const i of imports) assert.ok(["argparse", "hashlib", "heapq", "json", "math", "os", "re", "shutil", "sys", "time", "numpy", "lm", "manifest_parts", "replay", "saves", "lbtrain"].includes(i!), `${f} imports ${i}`);
    assert.ok(!/huggingface|from_pretrained|torch|tensorflow|transformers|tiktoken|sentencepiece|openai|anthropic|urllib|requests|socket|http/i.test(text), f);
  }
  for (const f of ["lib/lm.ts", "lib/fill.ts", "lib/lmcorpus.ts", "bin/lm-fill.ts", "bin/lm-memcheck.ts", "bin/lm-corpus.ts"]) {
    const text = readFileSync(join(repo, "peaceai", f), "utf8");
    assert.ok(!/learned\.ts|approved\.ts|approve-rule|https?:\/\//.test(text), f);
  }
});

const LM_TRAIN_M49_WORKFLOW_SHA256 = "a756864e2a0aa1ea67f82207436abed01cf11e8284c7a92821eb603cd0db2f42"; // M128: only the RESULTS_SHA256 pin of results-write.sh changed (new --sparse mode; this workflow does not use it, its full clone is unchanged). Before (01affbb7...): M49 BLOCKING (1): fine-tune corpus from pinned commits + ft-gate before training. M49: chained pretrain + fine-tune + evals (Architect-approved plan; Auditor review)
const POSTTRAIN_MEMCHECK_WORKFLOW_SHA256 = "0aa3e9b681aeebb851f70f6f922b73fc2a79f3df0cbe64233142074317376daf"; // M49 post-train memcheck (Architect option 1)
const LM_RETRAIN_WORKFLOW_SHA256 = "cb3a0436e9585d809e950d16a51067da7574bf1d5b8cf40f23a47a66fbdff1cd"; // M129 (Auditor, after promotion of lm-v1-858573767465, Results 0d86e8c): the gate also requires candidate set C v2 <= lm-retrain.json promoted.setcBpb - eval.minBpbGain (bpb_gate.py; 1.5282 - 0.005 = 1.5232), the promoted model's score from its own pinned run record, separate from replayBase; lm-retrain-promoted.sh checks Results latest.json names promoted.version and the record hashes to promoted.recordSha256, in corpus-gate (exit before any training) and right before the gate (promoted_pin; the record still lands) (m129-lm-retrain-promoted-gate.test.ts). Before (81c63333...): M128 (Auditor follow-up on #564; was M127 on #568 before #569 took M127): every Results write (both arm saves, the candidate landing, the memcheck and memcheck-only landings) passes results-write.sh --sparse with exactly the paths it reads and writes (blobless shallow sparse clone; results-write.sh refuses anything not a new file under those paths and verifies each committed blob), and the RESULTS_SHA256 pin of results-write.sh is re-pinned (m128-results-write-sparse.test.ts); the memcheck-only recheck landing keeps the whole runs/lm-retrain/<run>/ dir (Auditor condition after #569). Before (6f82cc92...): Fix B (Auditor, after recheck run 40766362070): the live model restored, initialised from, recorded and fetched for the memcheck is lm-retrain.json replayBase (pinned in the config, separate from Results latest.json); previously M126 (Peace + Auditor ruling 2026-10-28, after run 40694718190): pretrain memcheck in the existing two-corpus mode (replay corpus + fine-tune corpus) with both proofs checked against the manifests rebuilt in the run (live proof pin lm-retrain.json live.corefreeProofSha256 + replay-live-manifest.jsonl; fine-tune proof = the record's finetuneCorefreeProofSha256), FAIL on any broken link, never strict; fetch through lm-retrain-memcheck-fetch.sh; memcheck_only_run_id input (re-verify a landed candidate, append runs/lm-retrain/<run>/memcheck-recheck-<this run>.json, promote nothing); record-memcheck outputs landed/status for the outcome message "memcheck FAIL (record landed)" (m126-lm-memcheck-chain.test.ts). Before (372b91b0...): M125 (Peace + Auditor 2026-10-28, after run 40624227227): durable sweep arms and candidate reuse: each sweep arm (now environment peaceai-results) saves its summary, losses and best-step export in Results runs/lm-retrain/<run>/arms/<arm>/ right after it finishes (lm-retrain-arm-save.sh, guarded results-write, sha256-bound save.json); finetune-eval-land fetches and verifies them (lm-retrain-arm-verify.sh), selects on them and reuses the selected arm's checkpoint (lm-retrain-arm-reuse.sh; an unsaved arm is re-trained as before); resume_run_id input skips the sweep and resumes from a run's saved arms (m125-lm-retrain-arm-reuse.test.ts). Before (f4a6e0cf...): M124 (after live run 40624227227): M124 (after live run 40624227227): the three candidate checks (valSplit, replay.val, replay.corpus) compare jq -cS (sorted keys) on both sides, so select.json (sort_keys) and the candidate summary.json (jq insertion order) no longer refuse identical values; scoring deadline JOB_START + pretrain.budget.finalJobSeconds - eval.scoringReserveSeconds: a scoring command still running is killed, scoring stops, the gate lands a no-candidate record (failed: scoring_deadline) and the job ends red (m124-lm-retrain-keyorder-scoring.test.ts). Before (95c21565...): retrain-outcome guard (Auditor design 2, after dry run 40555453905 went green with select, memcheck and record skipped): an always() last job running lm-retrain-outcome.sh; real run RED unless finetune-eval-land, retrain-memcheck and record-memcheck all succeeded; dry run RED unless both arm summaries parse and stopped on steps/patience and peaceai/model/sweep_select.py (the select rule, moved verbatim out of the select step) picks and prints a candidate (m123-lm-pretrain.test.ts). Before (c26778ba...): M123 condition 4: a sweep all deadline-cut at step 0 lands a record with "no candidate" (no candidate training, no model landed, no promotion). M123 continued-pretraining mode: mode choice input (finetune default, allowlist in lm-retrain-mode.sh), .pretrain block, full-split replay, JOB_START deadline, bpb_gate.py margin gate eval.minBpbGain, record v5, ft + replay memcheck (m123-lm-pretrain.test.ts). Before (2f952568...): M122 forgetting fix (run 40375535718): replay share from the live pretrain train split, pretrain-heldout validation, ft dedup + split by path, replay overlap proof before training, dry_run input with every Results write behind lm-retrain-dryrun-guard.sh (m122-lm-replay.test.ts). Before (ca860771...): Judge scorer-repro rule moved to peaceai/model/judge_repro.py (shared with peace-lm-judge-v2.yml, unchanged rule). Before: Judge gate v1 (after #550): judge set v2 items, judge AUC report-only via judge_gate.py (was 8e37022e...). M119: LM retrain on the reviewed commit list (Builder + Auditor gate; m119-lm-retrain.test.ts pins its shape)
const LM_TRAIN_WORKFLOW_SHA256 = "b9c826889250b089b07f03c7caa41f6dbd60a3375b5bed0d3c86966e9a5afcfc"; // lb-train v1 first run (Auditor ruling after #654): a run choice input (ext-pretrain default = the M37 job, unchanged except its if also requires inputs.run == 'ext-pretrain'; lb-first-run = a ref gate job that fails off main plus the lb-first-run job: corpus rebuilt at b149d9b and refused unless its three pins match, train.py argv from lb_run.py with easy_to_hard, adamw8bit, patience and a deadline inside the job cap, no LoRA or replay, weights kept on the runner, one metrics-only row runs/lb-train/<run id>.json via results-write.sh --sparse) (m163-lb-first-run.test.ts). Before (f104d2df...): lm-train repin (Auditor, 2026-10-30): both --manifest-sha pins re-pinned from the #148 manifest 040eb0c4 (no committed manifest matches it any more, so ext-fetch refused it and the workflow could not train) to the committed manifest 8458eac6, the same pin as peace-lm-train-m49.yml; nothing else changed. Before (93554313...): M51: pinned to the #148 manifest by sha (--manifest-sha), so M37 never trains on the M49 corpus

test("workflows: no public workflow trains, builds the corpus or runs the memcheck; LM steps run only behind their flags", () => {
  const wfDir = join(repo, ".github/workflows");
  for (const f of readdirSync(wfDir)) {
    const text = readFileSync(join(wfDir, f), "utf8");
    // M31 (Architect): the ONE exception is peace-lm-train.yml, public-only, held-out-checked, never the memcheck
    // (that still needs core and runs on the box). m31-lm-public.test.ts pins the rest of its shape.
    if (f === "peace-lm-train.yml") {
      // Auditor #140 2: the exemption is pinned to the exact reviewed file; any edit must re-pin here.
      assert.equal(createHash("sha256").update(readFileSync(join(wfDir, f))).digest("hex"), LM_TRAIN_WORKFLOW_SHA256, "peace-lm-train.yml changed: re-review and re-pin");
      // lb-train v1 first run (Auditor ruling after #654): one choice input; ext-pretrain (default) runs only the M37 job,
      // lb-first-run runs only the ref gate + lb-first-run jobs (m163-lb-first-run.test.ts pins their shape).
      assert.match(text, /^on:\n  workflow_dispatch:\n    inputs:\n      run:\n        description: "[^"\n]+"\n        type: choice\n        options:\n          - ext-pretrain\n          - lb-first-run\n        default: ext-pretrain\n\npermissions: \{\}\n/m, "workflow_dispatch only (one choice input), permissions {}");
      assert.equal((text.match(/^on:/gm) ?? []).length, 1);
      assert.match(text, /\n  train:\n    name: [^\n]+\n    if: github\.ref == 'refs\/heads\/main' && inputs\.run == 'ext-pretrain'\n/);
      assert.match(text, /\n  lb-first-run:\n    name: [^\n]+\n    needs: lb-ref-gate\n    if: inputs\.run == 'lb-first-run' && github\.ref == 'refs\/heads\/main'\n/);
      assert.equal((text.match(/\n    if: /g) ?? []).length, 3, "every job has its if");
      assert.match(text, /- uses: actions\/checkout@[0-9a-f]{40} # v[\d.]+\n        with:\n          persist-credentials: false\n/);
      assert.equal((text.match(/actions\/checkout@/g) ?? []).length, 2);
      assert.equal((text.match(/actions\/checkout@[0-9a-f]{40} # v[\d.]+\n        with:\n          persist-credentials: false\n/g) ?? []).length, 2);
      assert.equal((text.match(/secrets\./g) ?? []).length, 2, "two secret references: the two Results-writing steps");
      assert.equal((text.match(/\n          DEPLOY_KEY: \$\{\{ secrets\.PEACEAI_RESULTS_DEPLOY_KEY \}\}\n/g) ?? []).length, 2, "only as DEPLOY_KEY of a step");
      const landing = text.slice(text.indexOf("      - name: Land the model in Results only"));
      assert.match(landing, /DEPLOY_KEY: \$\{\{ secrets\.PEACEAI_RESULTS_DEPLOY_KEY \}\}/);
      assert.ok(!/      - name: /.test(landing.slice(10)), "the landing step is the last step");
      // M37: the corpus is the M36 manifest corpus (ext-fetch, sha256 per file) checked by ext-manifest-check.
      // M51: pinned to the #148 manifest by its sha256, so it can never train on the M49 corpus.
      // lm-train repin (Auditor, 2026-10-30, limit-breaker): re-pinned to the committed manifest 8458eac6 (the M49 corpus,
      // the same pin as peace-lm-train-m49.yml); the old #148 pin no longer matches any committed manifest. M37 trained the
      // live model on that old pin, --manifest-sha 040eb0c40961b9ac669c97bbcc4c2c3aca30234a9de10e7562ab4cd2fc7a33af (m122 replay source).
      assert.match(text, /peaceai\/bin\/ext-fetch\.ts "\$RUNNER_TEMP\/src" "\$RUNNER_TEMP\/corpus" --manifest-sha 8458eac61cc414128e98eedb6c3b3ad9c50813e62ab680f5a9ef9d909ccfc231\n/);
      assert.match(text, /peaceai\/bin\/ext-manifest-check\.ts "\$RUNNER_TEMP\/corpus" pretrain --manifest-sha 8458eac61cc414128e98eedb6c3b3ad9c50813e62ab680f5a9ef9d909ccfc231\n/);
      assert.ok(!/lm-memcheck\.ts|upload-artifact|download-artifact|actions\/cache|pull_request|schedule:|push:/.test(text), f);
      continue;
    }
    if (f === "peace-lm-train-m49.yml") {
      // M49: the second training exemption, pinned to the exact reviewed file; m49-lm-workflow.test.ts pins its shape.
      assert.equal(createHash("sha256").update(readFileSync(join(wfDir, f))).digest("hex"), LM_TRAIN_M49_WORKFLOW_SHA256, "peace-lm-train-m49.yml changed: re-review and re-pin");
      assert.match(text, /^on:\n  workflow_dispatch:\n\npermissions: \{\}\n/m);
      assert.equal((text.match(/^on:/gm) ?? []).length, 1);
      assert.equal((text.match(/persist-credentials: false/g) ?? []).length, (text.match(/actions\/checkout@/g) ?? []).length);
      assert.ok(!/lm-memcheck\.ts|lm-corpus\.ts|upload-artifact|actions\/cache|pull_request|schedule:|push:/.test(text), f);
      continue;
    }
    if (f === "peace-lm-retrain.yml") {
      // M119: the third training exemption (fine-tune of the live model), pinned to the exact reviewed file.
      assert.equal(createHash("sha256").update(readFileSync(join(wfDir, f))).digest("hex"), LM_RETRAIN_WORKFLOW_SHA256, "peace-lm-retrain.yml changed: re-review and re-pin");
      // M122: workflow_dispatch only, one boolean input (dry_run), permissions {}.
      assert.match(text, /^on:\n  workflow_dispatch:\n    inputs:\n      dry_run:\n        description: "[^"\n]+"\n        type: boolean\n        default: false\n      mode:\n        description: "[^"\n]+"\n        type: choice\n        options:\n          - finetune\n          - pretrain\n        default: finetune\n      resume_run_id:\n        description: "[^"\n]+"\n        type: string\n        default: ""\n      memcheck_only_run_id:\n        description: "[^"\n]+"\n        type: string\n        default: ""\n\npermissions: \{\}\n/m);
      assert.equal((text.match(/^on:/gm) ?? []).length, 1);
      assert.equal((text.match(/persist-credentials: false/g) ?? []).length, (text.match(/actions\/checkout@/g) ?? []).length);
      assert.ok(!/lm-corpus\.ts|upload-artifact|download-artifact|actions\/cache|pull_request|schedule:|push:/.test(text), f);
      continue;
    }
    if (f === "m49-posttrain-memcheck.yml") {
      // M49 (Architect option 1): the M49 post-train memcheck exemption (M119 peace-lm-retrain.yml has its own, above), pinned to the exact reviewed file; workflows.test.ts pins
      // its shape. Checks only: it never trains, builds the internal corpus, writes Results or uploads weights.
      assert.equal(createHash("sha256").update(readFileSync(join(wfDir, f))).digest("hex"), POSTTRAIN_MEMCHECK_WORKFLOW_SHA256, "m49-posttrain-memcheck.yml changed: re-review and re-pin");
      assert.ok(!/model\/train\.py|model\/export\.py|lm-corpus\.ts|results-write\.sh|PEACEAI_RESULTS_DEPLOY_KEY|latest\.json|pull_request|schedule:|push:/.test(text), f);
      continue;
    }
    assert.ok(!/model\/train\.py|model\/export\.py|lm-corpus\.ts|lm-memcheck\.ts/.test(text), `${f} must not train`);
  }
  const task = readFileSync(join(wfDir, "peace-task.yml"), "utf8");
  const fillJob = task.slice(task.indexOf("  lm-fill:"), task.indexOf("  generate:"));
  assert.match(fillJob, /if: needs\.select\.outputs\.issue != '' && vars\.PEACEAI_ENABLED == 'true' && vars\.PEACEAI_LM_FILL == 'true'/);
  assert.match(fillJob, /environment: peaceai-results/);
  assert.ok(fillJob.indexOf('rm -rf "$RUNNER_TEMP/results"') < fillJob.indexOf("upload-artifact"), "weights deleted before upload");
  assert.match(fillJob, /path: \$\{\{ runner\.temp \}\}\/lm-fills\n/);
  assert.match(task, /- name: Python runtime for the LM shadow score \(numpy only, hash-pinned\)\n {8}if: vars\.PEACEAI_LM_SHADOW == 'true'/);
  assert.match(task, /PEACEAI_LM_SHADOW: \$\{\{ vars\.PEACEAI_LM_SHADOW \}\}/);
  assert.match(task, /PEACEAI_LM_FILL: \$\{\{ vars\.PEACEAI_LM_FILL \}\}\n {10}PEACEAI_LM_FILLS:/);
  const req = readFileSync(join(repo, "peaceai/model/requirements.txt"), "utf8");
  assert.match(req, /^numpy==2\.3\.3 \\$/m);
  assert.equal((req.match(/--hash=sha256:[0-9a-f]{64}/g) ?? []).length, 2);
});

test("LM runs only in the fill job, Job A or Job C: never in Job B/B2 (workflow and code)", () => {
  // Code: the job id decides on Actions; a candidate-code job is always refused, whatever its id.
  assert.equal(lmJobAllowed({}), true);
  const W = (job: string, path: string) => ({ GITHUB_ACTIONS: "true", GITHUB_JOB: job, GITHUB_REPOSITORY: "PeaceG03/PeaceAI-Workspace", GITHUB_WORKFLOW_REF: `PeaceG03/PeaceAI-Workspace/${path}@refs/heads/main` });
  for (const [job, path] of Object.entries(LM_JOB_WORKFLOWS)) assert.equal(lmJobAllowed(W(job, path)), true, job);
  for (const job of ["lm-fill", "generate", "record", "tests", "memcheck"]) assert.equal(lmJobAllowed({ GITHUB_ACTIONS: "true", GITHUB_JOB: job }), false, `${job} without a workflow ref`);
  for (const job of ["test", "regate", "review", "finish", "select", ""]) assert.equal(lmJobAllowed({ GITHUB_ACTIONS: "true", GITHUB_JOB: job }), false, job);
  assert.equal(lmJobAllowed({ GITHUB_ACTIONS: "true", GITHUB_JOB: "generate", PEACEAI_CANDIDATE_JOB: "true" }), false);
  assert.equal(lmJobAllowed({ GITHUB_ACTIONS: "true", GITHUB_JOB: "memcheck", PEACEAI_CANDIDATE_JOB: "true" }), false);
  const saved = { ...process.env };
  try {
    Object.assign(process.env, { GITHUB_ACTIONS: "true", GITHUB_JOB: "test" });
    assert.deepEqual(runInfer("fill", "/nonexistent", {}), { ok: false, reason: "LM_JOB_REFUSED" });
    process.env.GITHUB_JOB = "regate";
    assert.deepEqual(runInfer("score", "/nonexistent", {}), { ok: false, reason: "LM_JOB_REFUSED" });
  } finally {
    for (const k of ["GITHUB_ACTIONS", "GITHUB_JOB"]) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  }
  // Workflow: Job B and B2 never fetch, name or run the model, and are marked as candidate-code jobs.
  const task = readFileSync(join(repo, ".github/workflows/peace-task.yml"), "utf8");
  // The allowed ids are not reused by a candidate-code job: peace-task has no `tests` job; ci.yml's is the unit suite.
  assert.ok(!/\n {2}tests:\n/.test(task));
  assert.match(readFileSync(join(repo, ".github/workflows/ci.yml"), "utf8"), /\n {2}tests:\n/);
  const block = (name: string) => { const a = task.indexOf(`\n  ${name}:\n`); const rest = task.slice(a + 1); const b = rest.slice(1).search(/\n {2}[a-z0-9-]+:\n/); return b < 0 ? rest : rest.slice(0, b + 1); };
  for (const job of ["test", "regate"]) {
    const b = block(job);
    assert.ok(b.length > 200, job);
    assert.match(b, /PEACEAI_CANDIDATE_JOB: "true"/, job);
    for (const banned of [/models\/lm/, /PeaceAI-Results/, /PEACEAI_RESULTS_DEPLOY_KEY/, /peaceai-results/, /lm-fill/, /infer\.py/, /PEACEAI_LM_/, /lm-venv/, /model\/requirements\.txt/, /weights/, /latest\.json/])
      assert.ok(!banned.test(b), `${job} must not reference ${banned}`);
  }
  // Only the fill job (and Job C's shadow score) may touch Results; Job A gets fills as a small JSON choice.
  for (const job of ["select", "generate", "review", "finish"]) assert.ok(!/PEACEAI_RESULTS_DEPLOY_KEY|models\/lm/.test(block(job)), job);
});

test("M9 retrain corpus filter: no private file survives; generated/vendored/fixture paths, data-like files and duplicates are dropped", () => {
  const dir = mkdtempSync(join(tmpdir(), "m9-filter-"));
  try {
    const src = join(dir, "in");
    mkdirSync(src);
    const code = (n: number) => Array.from({ length: 40 }, (_, i) => `export function helper${n}_${i}(value: number): number { return value * ${i * n + 3} + ${n}; }`).join("\n");
    const docs = [
      { doc: 0, source: "PeaceG03/PeaceAI", visibility: "private", path: "src/a.ts", text: code(1) },
      { doc: 1, source: "honojs/hono", visibility: "public", path: "src/b.ts", text: code(2) },
      { doc: 2, source: "honojs/hono", visibility: "public", path: "src/b-copy.ts", text: code(2).replace(/\n/g, "\n  ") },
      { doc: 3, source: "honojs/hono", visibility: "public", path: "src/near.ts", text: code(2).replace("helper2_0(", "helperX_0(") },
      { doc: 4, source: "honojs/hono", visibility: "public", path: "dist/c.ts", text: code(3) },
      { doc: 5, source: "honojs/hono", visibility: "public", path: "test/fixtures/d.ts", text: code(4) },
      { doc: 6, source: "honojs/hono", visibility: "public", path: "src/table.ts", text: Array.from({ length: 50 }, (_, i) => `  [${i}, ${i * 2}, ${i * 3}, 0x${i.toString(16)}],`).join("\n") },
      { doc: 7, source: "sindresorhus/ky", visibility: "public", path: "source/e.ts", text: code(5) },
      // A public repo carrying core's own file (byte-identical), a near-copy of it, and a copy of a core file that
      // is not in the corpus but is in the core checkout: all three are core files under a public name.
      { doc: 8, source: "PeaceG03/PeaceSTOCKS", visibility: "public", path: "src/a.ts", text: code(1) },
      { doc: 9, source: "PeaceG03/PeaceSTOCKS", visibility: "public", path: "src/a2.ts", text: code(1).replace("helper1_3(", "helperY_3(") },
      { doc: 10, source: "PeaceG03/PeaceSTOCKS", visibility: "public", path: "src/only-in-core.ts", text: code(6) },
    ];
    const coreDir = join(dir, "core");
    mkdirSync(coreDir);
    writeFileSync(join(coreDir, "x.ts"), code(6));
    execFileSync("git", ["init", "-q"], { cwd: coreDir });
    execFileSync("git", ["add", "-A"], { cwd: coreDir });
    writeFileSync(join(src, "docs.jsonl"), docs.map((d) => JSON.stringify({ doc: d.doc, text: d.text })).join("\n") + "\n");
    writeFileSync(join(src, "manifest.jsonl"), docs.map((d) => JSON.stringify({ doc: d.doc, source: d.source, visibility: d.visibility, path: d.path, bytes: d.text.length, license: d.visibility === "private" ? "owner:PeaceG03" : "MIT", split: "train" })).join("\n") + "\n");
    const r = spawnSync(py, [join(repo, "peaceai/model/corpus_filter.py"), "--in", src, "--out", join(dir, "out"), "--core-dir", coreDir], { encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    const kept = readFileSync(join(dir, "out/manifest.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    assert.deepEqual(kept.map((m) => m.doc), [1, 7]);
    const s = JSON.parse(readFileSync(join(dir, "out/filter.json"), "utf8"));
    assert.equal(s.private_kept, 0);
    assert.deepEqual(s.dropped, { "core-copy": 3, "data-like": 1, "exact-dup": 1, "near-dup": 1, path: 2, private: 1 });
    assert.doesNotMatch(r.stdout, /helper/, "prints counts only");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("M9 retrain: train.py stops early on held-out loss and keeps the best checkpoint; export can use it", () => {
  const train = readFileSync(join(repo, "peaceai/model/train.py"), "utf8");
  assert.match(train, /--patience/);
  assert.match(train, /shutil\.copyfile\(W\("checkpoint\.npz"\), W\("best\.npz"\)\)/);
  // LM retrain pretrain mode: the loop's stop rules moved into stop_reason() (patience first; then steps, max-steps-this-run, max-seconds, deadline).
  // M159 (lb-train): the module body sits one level inside a single top-level `try:` (it writes stop.json on every
  // exit), so the def and the loop may be indented by exactly that one level -- the same indent for both, and only
  // when that top-level try exists; patience is still the first rule and the loop is still driven by stop_reason().
  const d = train.match(/^(|    )def stop_reason\(\):\n\1    if args\.patience and best\["stale"\] >= args\.patience:\n\1        return "patience"/m);
  assert.ok(d, "stop_reason() checks patience first");
  assert.match(train, new RegExp(`\\n${d[1]}while \\(reason := stop_reason\\(\\)\\) is None:\\n`));
  if (d[1]) assert.match(train, /^try:  # M159: every exit below/m, "indented only inside the one top-level try");
  assert.match(readFileSync(join(repo, "peaceai/model/export.py"), "utf8"), /--checkpoint", default="checkpoint\.npz"/);
});

// ---- core-free-64 rule (Auditor/Architect): only with a valid core-free proof on the model's record

test("core-free-64 rule: explained hits never count; unexplained runs count only at 64+ characters", () => {
  const core = emptyIndex(); const baseline = emptyIndex();
  const long = "export function veryDistinctiveCoreOnlyHelperWithALongName(alphaValue: number, betaValue: number) { return alphaValue * betaValue + 17; }";
  const raw = buildSubstringIndex([CORE_LINE + "\n", long + "\n"]);
  const fill = (i: number) => ({ id: `f${i}`, kind: "greedy", prompt_tail: "", text: "x" });
  const fills = Array.from({ length: 110 }, (_, i) => fill(i));
  const sample = (text: string) => ({ id: "p0", kind: "greedy", prompt_tail: "", text });
  const ex = (over: Partial<PublicOnlyExemption> = {}): PublicOnlyExemption => ({ prompts: new Map(), trainingCorpus: buildSubstringIndex([]), minRun: COREFREE_MIN_RUN, ...over });
  const short = `zz(${CORE_LINE.slice(10, 50)})`; // a 40-character unexplained run
  const s40 = scanSamples([sample(short), ...fills], core, baseline, raw, ex());
  assert.deepEqual([s40.substringRule, s40.coreSubstringHits, s40.unexplainedHits, s40.countedHits, s40.longestUnexplained], ["core-free-64", 1, 1, 0, 40]);
  assert.equal(memcheckStatus(s40), "PASS");
  // The same 40-character run under the strict rule (no proof): FAIL.
  assert.equal(memcheckStatus(scanSamples([sample(short), ...fills], core, baseline, raw)), "FAIL");
  // 64+ characters unexplained: counts, FAIL.
  const s70 = scanSamples([sample(`zz(${long.slice(0, 70)})`), ...fills], core, baseline, raw, ex());
  assert.deepEqual([s70.unexplainedHits, s70.countedHits, s70.longestUnexplained], [1, 1, 70]);
  assert.equal(memcheckStatus(s70), "FAIL");
  // Exactly 64: counts. 63: does not.
  assert.equal(scanSamples([sample(`zz(${long.slice(0, 64)})`), ...fills], core, baseline, raw, ex()).countedHits, 1);
  assert.equal(scanSamples([sample(`zz(${long.slice(0, 63)})`), ...fills], core, baseline, raw, ex()).countedHits, 0);
  // A long run explained by the sample's prompt or by the training corpus does not count.
  assert.equal(scanSamples([sample(`zz(${long.slice(0, 70)})`), ...fills], core, baseline, raw, ex({ prompts: new Map([["p0", long]]) })).countedHits, 0);
  assert.equal(scanSamples([sample(`zz(${long.slice(0, 70)})`), ...fills], core, baseline, raw, ex({ trainingCorpus: buildSubstringIndex([`// ${long}`]) })).countedHits, 0);
  // Auditor (memcheck trace): a joined run counts only when its whole text is contiguous in core.
  const c40 = buildSubstringIndex([`x${"c".repeat(40)}y\n`, long + "\n"]);
  const s128 = scanSamples([sample("c".repeat(128)), ...fills], core, baseline, c40, ex());
  assert.deepEqual([s128.unexplainedHits, s128.countedHits, s128.longestUnexplained], [1, 0, 128]);
  assert.equal(memcheckStatus(s128), "PASS");
  // A real 64+ core string the sample reproduces is still counted, against the same index.
  assert.equal(scanSamples([sample(`zz(${long.slice(0, 70)})`), ...fills], core, baseline, c40, ex()).countedHits, 1);
  assert.equal(scanSamples([sample(`${"c".repeat(128)} ${long.slice(0, 70)}`), ...fills], core, baseline, c40, ex()).countedHits, 1);
  // #142 F2: a copy bridging two core places (core [A, A.slice(-31) + B], sample A + B) still counts.
  const A = Array.from({ length: 100 }, (_, i) => String.fromCharCode(65 + ((i * 7) % 26))).join("") .slice(0, 100);
  const B = Array.from({ length: 100 }, (_, i) => String.fromCharCode(97 + ((i * 11) % 26))).join("").slice(0, 100);
  const bridge = buildSubstringIndex([A, A.slice(-31) + B]);
  assert.equal(scanSamples([sample(A + B), ...fills], core, baseline, bridge, ex()).countedHits, 1);
  // No core index: fail closed. A core-free-64 scan without its counted value fails.
  assert.equal(memcheckStatus(scanSamples(fills, core, baseline, null, ex())), "FAIL");
  assert.equal(memcheckStatus({ ...s40, countedHits: undefined }), "FAIL");
});

function proofFor(model: string, manifest: { doc: number; path: string; source: string; sha256: string }[], manifestText: string, over: Record<string, unknown> = {}) {
  return { schema: "peaceai-lm-corefree-proof:v1", model, noCoreFiles: "PROVEN", manifestSha256: createHash("sha256").update(manifestText).digest("hex"), coreCommit: "c".repeat(40), near: { method: "minhash", threshold: 0.8 }, files: manifest.map((m) => ({ doc: m.doc, path: m.path, source: m.source, sha256: m.sha256, coreExact: false, coreNearMax: 0.1 })), ...over };
}

test("validCoreFreeProof: every field and every file must check out; anything else is invalid", () => {
  const manifest = [{ doc: 0, path: "src/a.ts", source: "honojs/hono", sha256: "a".repeat(64) }, { doc: 1, path: "src/b.ts", source: "honojs/hono", sha256: "b".repeat(64) }];
  const text = manifest.map((m) => JSON.stringify(m)).join("\n") + "\n";
  const ctx = { modelId: "lm-v1-000000000001", manifest, manifestSha256: createHash("sha256").update(text).digest("hex") };
  const good = proofFor(ctx.modelId, manifest, text);
  assert.deepEqual(validCoreFreeProof(good, ctx), { ok: true });
  const bad: [unknown, string][] = [
    [null, "MISSING"],
    [{ ...good, schema: "x" }, "BAD_SCHEMA"],
    [{ ...good, model: "lm-v1-other" }, "OTHER_MODEL"],
    [{ ...good, noCoreFiles: "NOT_PROVEN" }, "NOT_PROVEN"],
    [{ ...good, manifestSha256: "d".repeat(64) }, "MANIFEST_MISMATCH"],
    [{ ...good, coreCommit: "" }, "NO_CORE_COMMIT"],
    [{ ...good, near: { method: "m", threshold: 0.95 } }, "BAD_NEAR_THRESHOLD"],
    [{ ...good, files: good.files.slice(0, 1) }, "FILE_COUNT"],
    [{ ...good, files: [good.files[0], { ...good.files[1], sha256: "e".repeat(64) }] }, "FILE_MISMATCH"],
    [{ ...good, files: [good.files[0], { ...good.files[1], path: "src/c.ts" }] }, "FILE_MISMATCH"],
    [{ ...good, files: [good.files[0], { ...good.files[1], coreExact: true }] }, "CORE_EXACT"],
    [{ ...good, files: [good.files[0], { ...good.files[1], coreNearMax: 0.85 }] }, "CORE_NEAR"],
    [{ ...good, files: [good.files[0], { ...good.files[1], coreNearMax: "0.1" }] }, "CORE_NEAR"],
  ];
  for (const [p, reason] of bad) assert.deepEqual(validCoreFreeProof(p, ctx), { ok: false, reason }, reason);
  assert.equal(validCoreFreeProof(good, { ...ctx, manifest: [] }).ok, false, "empty manifest proves nothing");
});

test("public-only manifest check (still required alongside the proof)", () => {
  const coreText = CORE_LINE + "\n";
  const coreShas = new Set([createHash("sha256").update(coreText).digest("hex")]);
  const ok = { source: "honojs/hono", visibility: "public", sha256: "a".repeat(64) };
  assert.equal(manifestProvesNoCore([ok], coreShas), true);
  assert.equal(manifestProvesNoCore([], coreShas), false);
  assert.equal(manifestProvesNoCore([ok, { ...ok, visibility: "private" }], coreShas), false);
  assert.equal(manifestProvesNoCore([ok, { ...ok, source: "PeaceG03/PeaceAI" }], coreShas), false);
  assert.equal(manifestProvesNoCore([ok, { ...ok, sha256: [...coreShas][0] }], coreShas), false);
});

test("lm-memcheck end to end: core-free-64 with a valid proof; strict with no proof, an invalid proof or a core-containing manifest", () => {
  const { dir, corpus, model, core } = tinyModel();
  const copy = join(dir, "mc-64");
  mkdirSync(copy, { recursive: true });
  for (const f of ["config.json", "tokenizer.json", "weights.npz"]) writeFileSync(join(copy, f), readFileSync(join(model, f)));
  const modelId = JSON.parse(readFileSync(join(copy, "config.json"), "utf8")).version;
  // One 40-character unexplained run (in core, in no prompt, not in the training corpus).
  const samples = JSON.stringify({ model: modelId, samples: Array.from({ length: 120 }, (_, i) => ({ id: `s${i}`, kind: "greedy", prompt_tail: "", text: i === 7 ? `zz(${CORE_LINE.slice(10, 50)})\n` : "x" })) });
  const trainCorpus = (name: string, docs: { text: string; source: string; visibility: string }[]) => {
    const d = join(dir, name);
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, "docs.jsonl"), docs.map((x, i) => JSON.stringify({ doc: i, text: x.text })).join("\n") + "\n");
    const man = docs.map((x, i) => ({ doc: i, source: x.source, visibility: x.visibility, path: `src/f${i}.ts`, sha256: createHash("sha256").update(x.text).digest("hex"), bytes: x.text.length, license: "MIT", split: "train" }));
    const text = man.map((m) => JSON.stringify(m)).join("\n") + "\n";
    writeFileSync(join(d, "manifest.jsonl"), text);
    return { d, man, text };
  };
  const run = (train: string) => memcheck(copy, corpus, core, { PEACEAI_PYTHON: fakePython(dir, samples), PEACEAI_LM_TRAIN_CORPUS: train });
  const pub = trainCorpus("t64-public", [{ text: "export const other = 2;\n", source: "honojs/hono", visibility: "public" }]);
  const proofPath = join(copy, "corefree-proof.json");
  // No proof attached: strict, FAIL on the 40-character hit.
  rmSync(proofPath, { force: true });
  const none = run(pub.d);
  assert.equal(none.status, 1, none.stdout);
  assert.match(none.stdout, /status=FAIL .*core_substring_hits=1 personal_info=0 rule=strict proof=INVALID:MISSING/);
  // Valid proof: core-free-64, the 40-character run is reported but does not count; PASS.
  writeFileSync(proofPath, JSON.stringify(proofFor(modelId, pub.man, pub.text)));
  const ok = run(pub.d);
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  assert.match(ok.stdout, /status=PASS .*rule=core-free-64 unexplained_hits=1 longest_unexplained=40 counted_hits_64=0 proof=VALID/);
  const report = JSON.parse(readFileSync(join(copy, "memcheck.json"), "utf8"));
  assert.equal(report.coreFreeProof.state, "VALID");
  assert.match(report.coreFreeProof.sha256, /^[0-9a-f]{64}$/);
  // Unexplained runs are listed as locations only (sample id, offset, length), never text.
  assert.deepEqual(report.scan.unexplainedRuns, [{ sample: "s7", start: 3, length: 40 }]);
  // Invalid proof (another model / a file flagged near core): strict, FAIL.
  for (const [over, why] of [[{ model: "lm-v1-other" }, "OTHER_MODEL"], [{ files: [{ ...proofFor(modelId, pub.man, pub.text).files[0], coreNearMax: 0.9 }] }, "CORE_NEAR"]] as const) {
    writeFileSync(proofPath, JSON.stringify(proofFor(modelId, pub.man, pub.text, over as Record<string, unknown>)));
    const r = run(pub.d);
    assert.equal(r.status, 1, r.stdout);
    assert.match(r.stdout, new RegExp(`status=FAIL .*rule=strict proof=INVALID:${why}`));
  }
  // A valid-looking proof for a manifest that holds a core file (content hash = a core file): strict, FAIL.
  const bad = trainCorpus("t64-core", [{ text: CORE_LINE + "\n", source: "x/y", visibility: "public" }]);
  writeFileSync(proofPath, JSON.stringify(proofFor(modelId, bad.man, bad.text)));
  const b = run(bad.d);
  assert.equal(b.status, 1, b.stdout);
  assert.match(b.stdout, /rule=strict/);
  assert.equal(JSON.parse(readFileSync(join(copy, "memcheck.json"), "utf8")).trainingManifest.noCoreFiles, "NOT_PROVEN");
});

test("M49 regression (run 38902887991): on Actions in the `memcheck` job a valid proof is found; missing still fails closed; a refused job never reads a proof", () => {
  const { dir, corpus, model, core } = tinyModel();
  const copy = join(dir, "mc-act");
  mkdirSync(copy, { recursive: true });
  for (const f of ["config.json", "tokenizer.json", "weights.npz"]) writeFileSync(join(copy, f), readFileSync(join(model, f)));
  const modelId = JSON.parse(readFileSync(join(copy, "config.json"), "utf8")).version;
  const samples = JSON.stringify({ model: modelId, samples: Array.from({ length: 120 }, (_, i) => ({ id: `s${i}`, kind: "greedy", prompt_tail: "", text: i === 7 ? `zz(${CORE_LINE.slice(10, 50)})\n` : "x" })) });
  const d = join(dir, "act-public"); mkdirSync(d, { recursive: true });
  const text0 = "export const other = 2;\n";
  writeFileSync(join(d, "docs.jsonl"), JSON.stringify({ doc: 0, text: text0 }) + "\n");
  const man = [{ doc: 0, source: "honojs/hono", visibility: "public", path: "src/f0.ts", sha256: createHash("sha256").update(text0).digest("hex"), bytes: text0.length, license: "MIT", split: "train" }];
  const mtext = man.map((m) => JSON.stringify(m)).join("\n") + "\n";
  writeFileSync(join(d, "manifest.jsonl"), mtext);
  const run = (job: string) => memcheck(copy, corpus, core, { PEACEAI_PYTHON: fakePython(dir, samples), PEACEAI_LM_TRAIN_CORPUS: d, GITHUB_ACTIONS: "true", GITHUB_JOB: job, GITHUB_REPOSITORY: "PeaceG03/PeaceAI-Workspace", GITHUB_WORKFLOW_REF: "PeaceG03/PeaceAI-Workspace/.github/workflows/m49-posttrain-memcheck.yml@refs/heads/main", PEACEAI_CANDIDATE_JOB: "" });
  const proofPath = join(copy, "corefree-proof.json");
  writeFileSync(proofPath, JSON.stringify(proofFor(modelId, man, mtext)));
  const ok = run("memcheck");
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  assert.match(ok.stdout, /status=PASS .*proof=VALID/);
  assert.equal(JSON.parse(readFileSync(join(copy, "memcheck.json"), "utf8")).coreFreeProof.state, "VALID");
  // Missing proof in the same job: still strict, FAIL (fail closed).
  rmSync(proofPath, { force: true });
  const none = run("memcheck");
  assert.equal(none.status, 1, none.stdout);
  assert.match(none.stdout, /status=FAIL .*rule=strict proof=INVALID:MISSING/);
  // A job outside LM_JOBS is refused before sampling: FAIL, and the report says the proof was never checked.
  writeFileSync(proofPath, JSON.stringify(proofFor(modelId, man, mtext)));
  const refused = run("test");
  assert.equal(refused.status, 1, refused.stdout);
  const rep = JSON.parse(readFileSync(join(copy, "memcheck.json"), "utf8"));
  assert.equal(rep.status, "FAIL"); assert.equal(rep.reason, "LM_JOB_REFUSED"); assert.equal(rep.coreFreeProof.state, "NOT_CHECKED:LM_JOB_REFUSED"); assert.equal(rep.scan, null);
});

test("corefree_proof.py: PROVEN only when no file copies or near-copies a core file", () => {
  const dir = mkdtempSync(join(tmpdir(), "m9-proof-"));
  try {
    const code = (n: number) => Array.from({ length: 40 }, (_, i) => `export function helper${n}_${i}(value: number): number { return value * ${i * n + 3} + ${n}; }`).join("\n");
    const coreDir = join(dir, "core"); mkdirSync(coreDir);
    writeFileSync(join(coreDir, "x.ts"), code(1));
    execFileSync("git", ["init", "-q"], { cwd: coreDir }); execFileSync("git", ["add", "-A"], { cwd: coreDir });
    execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "c"], { cwd: coreDir });
    const mk = (name: string, texts: string[]) => {
      const d = join(dir, name); mkdirSync(d);
      writeFileSync(join(d, "docs.jsonl"), texts.map((t, i) => JSON.stringify({ doc: i, text: t })).join("\n") + "\n");
      writeFileSync(join(d, "manifest.jsonl"), texts.map((t, i) => JSON.stringify({ doc: i, source: "honojs/hono", visibility: "public", path: `s${i}.ts`, sha256: createHash("sha256").update(t).digest("hex") })).join("\n") + "\n");
      return d;
    };
    const model = join(dir, "model"); mkdirSync(model);
    writeFileSync(join(model, "config.json"), JSON.stringify({ version: "lm-v1-000000000002" }));
    const run = (corpusDir: string) => {
      execFileSync(py, [join(repo, "peaceai/model/corefree_proof.py"), "--corpus", corpusDir, "--core-dir", coreDir, "--model", model], { encoding: "utf8" });
      return JSON.parse(readFileSync(join(model, "corefree-proof.json"), "utf8"));
    };
    const clean = run(mk("clean", [code(2)]));
    assert.equal(clean.noCoreFiles, "PROVEN");
    assert.equal(clean.files[0].coreExact, false);
    const ctx = (d: string) => { const t = readFileSync(join(d, "manifest.jsonl"), "utf8"); return { modelId: "lm-v1-000000000002", manifest: t.split("\n").filter(Boolean).map((l) => JSON.parse(l)), manifestSha256: createHash("sha256").update(t).digest("hex") }; };
    assert.deepEqual(validCoreFreeProof(clean, ctx(join(dir, "clean"))), { ok: true });
    const exact = run(mk("exact", [code(2), code(1)]));
    assert.equal(exact.noCoreFiles, "NOT_PROVEN");
    assert.equal(exact.files[1].coreExact, true);
    const near = run(mk("near", [code(1).replace("helper1_3(", "helperY_3(")]));
    assert.equal(near.noCoreFiles, "NOT_PROVEN");
    assert.ok(near.files[0].coreNearMax >= 0.8);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("lmJobAllowed pins each LM job to its workflow path and this repository, not GITHUB_JOB alone", () => {
  const W = (job: string, ref: string, repo = "PeaceG03/PeaceAI-Workspace") => ({ GITHUB_ACTIONS: "true", GITHUB_JOB: job, GITHUB_REPOSITORY: repo, GITHUB_WORKFLOW_REF: ref });
  assert.deepEqual(Object.keys(LM_JOB_WORKFLOWS).sort(), [...LM_JOBS].sort(), "every LM job has exactly one pinned workflow");
  // Right job id, wrong workflow: refused (e.g. a `record` job in peace-verdict.yml, or `tests` in a new workflow).
  assert.equal(lmJobAllowed(W("record", "PeaceG03/PeaceAI-Workspace/.github/workflows/peace-verdict.yml@refs/heads/main")), false);
  assert.equal(lmJobAllowed(W("tests", "PeaceG03/PeaceAI-Workspace/.github/workflows/evil.yml@refs/pull/1/merge")), false);
  assert.equal(lmJobAllowed(W("generate", "PeaceG03/PeaceAI-Workspace/.github/workflows/ci.yml@refs/heads/main")), false);
  // Path-prefix tricks and other repositories: refused.
  assert.equal(lmJobAllowed(W("tests", "PeaceG03/PeaceAI-Workspace/.github/workflows/ci.yml.evil.yml@refs/heads/main")), false);
  assert.equal(lmJobAllowed(W("tests", "Other/PeaceAI-Workspace/.github/workflows/ci.yml@refs/heads/main")), false);
  assert.equal(lmJobAllowed(W("tests", "PeaceG03/PeaceAI-Workspace/.github/workflows/ci.yml@refs/heads/main", "Other/Fork")), false);
  assert.equal(lmJobAllowed(W("tests", "PeaceG03/PeaceAI-Workspace/.github/workflows/ci.yml")), false, "no @ref");
  // Pinned path on any ref of this repo (PR runs of ci.yml keep the tiny fixture model), candidate jobs never.
  assert.equal(lmJobAllowed(W("tests", "PeaceG03/PeaceAI-Workspace/.github/workflows/ci.yml@refs/pull/9/merge")), true);
  assert.equal(lmJobAllowed({ ...W("generate", "PeaceG03/PeaceAI-Workspace/.github/workflows/peace-task.yml@refs/heads/main"), PEACEAI_CANDIDATE_JOB: "true" }), false);
});

test("every pinned LM workflow file defines its job id", () => {
  for (const [job, path] of Object.entries(LM_JOB_WORKFLOWS)) {
    const y = readFileSync(path, "utf8");
    assert.match(y, new RegExp(`^  ${job.replace(/-/g, "\\-")}:\\s*$`, "m"), `${path} defines ${job}`);
  }
});
