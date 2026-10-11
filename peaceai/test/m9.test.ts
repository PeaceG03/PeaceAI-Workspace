// M9: from-scratch model guardrails. Gradient/determinism self-test, corpus license rules and manifest,
// fail-closed memorization check, fail-closed model loading, flags off by default, template gap fill
// accepted only among Job A's own options, LM promotion rule, isolation (no outside model, no M8 rules).
import assert from "node:assert/strict";
import { buildSubstringIndex, countCoreSubstrings } from "../lib/substr.ts";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { acceptFill, applyFill, fillHole, fillKey, fillOptions, FILLS_SCHEMA, parseFillTask } from "../lib/fill.ts";
import { activeWithLm, lmJobAllowed, runInfer, diffScoreItems, lmEvaluate, lmFlags, lmShadowRanking, memcheckStatus, scanSamples, verifyModelDir } from "../lib/lm.ts";
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
  assert.equal(memcheckStatus({ samples: 100, coreLineHits: 0, coreShingleHits: 0, coreSubstringHits: 0, personalInfo: 0, flagged: 0 }), "PASS");
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
  const task = (issue: number, lmTop: string, pick: string, heldOut = true) => ({
    task: { issue, runId: "1", test: false, heldOut },
    ranking: { presentation: [{ id: "a" }, { id: "b" }], rankerTop: "a", lmShadow: { top: lmTop } },
    verdicts: [{ schema: "x", issue, runId: "1", commentId: String(issue), recordedAt: "2026-10-10T00:00:00Z", label: "A", candidateId: pick, verdict: "right" }],
  });
  const few = lmEvaluate(Array.from({ length: 3 }, (_, i) => task(i + 1, "b", "b")) as never);
  assert.equal(few.eligible, false);
  assert.match(few.reasons.join(";"), /held-out tasks with an LM score 3 < 10/);
  const tie = lmEvaluate(Array.from({ length: 12 }, (_, i) => task(i + 1, "a", "a")) as never);
  assert.equal(tie.eligible, false, "equal to the baseline is not enough");
  const beats = lmEvaluate([...Array.from({ length: 10 }, (_, i) => task(i + 1, "b", "b")), task(99, "b", "b", false)] as never);
  assert.deepEqual([beats.tasks, beats.lmAgree, beats.baselineAgree, beats.eligible], [10, 10, 0, true]);
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
    for (const i of imports) assert.ok(["argparse", "hashlib", "heapq", "json", "math", "os", "re", "shutil", "sys", "time", "numpy", "lm"].includes(i!), `${f} imports ${i}`);
    assert.ok(!/huggingface|from_pretrained|torch|tensorflow|transformers|tiktoken|sentencepiece|openai|anthropic|urllib|requests|socket|http/i.test(text), f);
  }
  for (const f of ["lib/lm.ts", "lib/fill.ts", "lib/lmcorpus.ts", "bin/lm-fill.ts", "bin/lm-memcheck.ts", "bin/lm-corpus.ts"]) {
    const text = readFileSync(join(repo, "peaceai", f), "utf8");
    assert.ok(!/learned\.ts|approved\.ts|approve-rule|https?:\/\//.test(text), f);
  }
});

test("workflows: no public workflow trains, builds the corpus or runs the memcheck; LM steps run only behind their flags", () => {
  const wfDir = join(repo, ".github/workflows");
  for (const f of readdirSync(wfDir)) {
    const text = readFileSync(join(wfDir, f), "utf8");
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
  for (const job of ["lm-fill", "generate", "record", "tests"]) assert.equal(lmJobAllowed({ GITHUB_ACTIONS: "true", GITHUB_JOB: job }), true, job);
  for (const job of ["test", "regate", "review", "finish", "select", ""]) assert.equal(lmJobAllowed({ GITHUB_ACTIONS: "true", GITHUB_JOB: job }), false, job);
  assert.equal(lmJobAllowed({ GITHUB_ACTIONS: "true", GITHUB_JOB: "generate", PEACEAI_CANDIDATE_JOB: "true" }), false);
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
    const code = (n: number) => Array.from({ length: 40 }, (_, i) => `export function helper${n}_${i}(value: number): number { return value * ${i} + ${n}; }`).join("\n");
    const docs = [
      { doc: 0, source: "PeaceG03/PeaceAI", visibility: "private", path: "src/a.ts", text: code(1) },
      { doc: 1, source: "honojs/hono", visibility: "public", path: "src/b.ts", text: code(2) },
      { doc: 2, source: "honojs/hono", visibility: "public", path: "src/b-copy.ts", text: code(2).replace(/\n/g, "\n  ") },
      { doc: 3, source: "honojs/hono", visibility: "public", path: "src/near.ts", text: code(2).replace("helper2_0(", "helperX_0(") },
      { doc: 4, source: "honojs/hono", visibility: "public", path: "dist/c.ts", text: code(3) },
      { doc: 5, source: "honojs/hono", visibility: "public", path: "test/fixtures/d.ts", text: code(4) },
      { doc: 6, source: "honojs/hono", visibility: "public", path: "src/table.ts", text: Array.from({ length: 50 }, (_, i) => `  [${i}, ${i * 2}, ${i * 3}, 0x${i.toString(16)}],`).join("\n") },
      { doc: 7, source: "sindresorhus/ky", visibility: "public", path: "source/e.ts", text: code(5) },
    ];
    writeFileSync(join(src, "docs.jsonl"), docs.map((d) => JSON.stringify({ doc: d.doc, text: d.text })).join("\n") + "\n");
    writeFileSync(join(src, "manifest.jsonl"), docs.map((d) => JSON.stringify({ doc: d.doc, source: d.source, visibility: d.visibility, path: d.path, bytes: d.text.length, license: d.visibility === "private" ? "owner:PeaceG03" : "MIT", split: "train" })).join("\n") + "\n");
    const r = spawnSync(py, [join(repo, "peaceai/model/corpus_filter.py"), "--in", src, "--out", join(dir, "out")], { encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    const kept = readFileSync(join(dir, "out/manifest.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    assert.deepEqual(kept.map((m) => m.doc), [1, 7]);
    const s = JSON.parse(readFileSync(join(dir, "out/filter.json"), "utf8"));
    assert.equal(s.private_kept, 0);
    assert.deepEqual(s.dropped, { "data-like": 1, "exact-dup": 1, "near-dup": 1, path: 2, private: 1 });
    assert.doesNotMatch(r.stdout, /helper/, "prints counts only");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("M9 retrain: train.py stops early on held-out loss and keeps the best checkpoint; export can use it", () => {
  const train = readFileSync(join(repo, "peaceai/model/train.py"), "utf8");
  assert.match(train, /--patience/);
  assert.match(train, /shutil\.copyfile\(W\("checkpoint\.npz"\), W\("best\.npz"\)\)/);
  assert.match(train, /while best\["stale"\] < \(args\.patience or 10\*\*9\)/);
  assert.match(readFileSync(join(repo, "peaceai/model/export.py"), "utf8"), /--checkpoint", default="checkpoint\.npz"/);
});
