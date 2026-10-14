// M39 (Architect): core-free proof for the external manifest schema, the public-origin allowlist (exact pin only),
// empty/whitespace-only files ignored, and set C v2 per-byte loss on an identical byte slice.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { extManifestEntryProblem, manifestProvesNoCore, validCoreFreeProof } from "../lib/lm.ts";
import { protectedReason } from "../lib/selfchange.ts";

const repo = resolve(import.meta.dirname, "..", "..");
const py = process.env.PEACEAI_PYTHON ?? "python3";
const H = (s: string) => createHash("sha256").update(s).digest("hex");
const C40 = "0123456789abcdef0123456789abcdef01234567";
const code = (n: number) => Array.from({ length: 40 }, (_, i) => `export function helper${n}_${i}(value: number): number { return value * ${i} + ${n}; }`).join("\n");
const ext = (doc: number, text: string, over: Record<string, unknown> = {}) => ({ doc, stage: "pretrain", repo: "honojs/hono", commit: C40, license: "MIT", path: `src/f${doc}.ts`, sha256: H(text), bytes: Buffer.byteLength(text), origin: "external", split: "train", ...over });
const owner = (doc: number, text: string, repoName = "PeaceG03/PeaceSTOCKS") => ext(doc, text, { repo: repoName, license: "owner:PeaceG03", origin: "owner-public" });

test("M39 (1): manifestProvesNoCore accepts the external schema, fails closed on unknown fields, keeps the internal visibility check", () => {
  const core = new Set([H(code(1))]);
  const a = ext(0, code(2));
  assert.equal(manifestProvesNoCore([a, owner(1, code(3)), owner(2, code(4), "PeaceG03/PeaceAI-Workspace")], core), true);
  assert.equal(manifestProvesNoCore([a, { ...a, visibility: "public" }], core), false, "unknown field");
  assert.equal(manifestProvesNoCore([{ ...a, extra: 1 }], core), false, "unknown field");
  const { license: _l, ...noLicense } = a;
  assert.equal(manifestProvesNoCore([noLicense], core), false, "missing license");
  assert.equal(manifestProvesNoCore([ext(0, code(1))], core), false, "core sha");
  for (const bad of [{ license: "GPL-3.0" }, { repo: "PeaceG03/PeaceSTOCKS" }, { repo: "PeaceG03/PeaceAI" }, { origin: "private" }, { commit: "x" }, { repo: "../x" }, { repo: "a/.." }, { repo: "-o/x" }, { sha256: "z" }])
    assert.equal(manifestProvesNoCore([ext(0, code(2), bad)], core), false, JSON.stringify(bad));
  for (const r of ["PeaceG03/PeaceAI", "PeaceG03/Secret", "honojs/hono"]) assert.equal(manifestProvesNoCore([owner(0, code(2), r)], core), false, r);
  assert.equal(manifestProvesNoCore([{ ...owner(0, code(2)), license: "MIT" }], core), false, "owner license");
  assert.match(String(extManifestEntryProblem({ ...a, visibility: "public" })), /unknown field visibility/);
  // Internal schema unchanged: visibility must be public; mixed schemas fail.
  const int = { doc: 0, source: "honojs/hono", visibility: "public", path: "a.ts", sha256: H(code(2)) };
  assert.equal(manifestProvesNoCore([int], core), true);
  assert.equal(manifestProvesNoCore([{ ...int, visibility: "private" }], core), false);
  assert.equal(manifestProvesNoCore([{ ...int, source: "PeaceG03/PeaceSTOCKS", visibility: undefined }], core), false);
  assert.equal(manifestProvesNoCore([int, a], core), false, "mixed schemas");
});

function proofEnv() {
  const dir = mkdtempSync(join(tmpdir(), "m39-"));
  const coreDir = join(dir, "core");
  mkdirSync(join(coreDir, "docs"), { recursive: true });
  writeFileSync(join(coreDir, "x.ts"), code(1));
  writeFileSync(join(coreDir, "pub.ts"), code(5));
  writeFileSync(join(coreDir, "empty.js"), "\n");
  writeFileSync(join(coreDir, "docs/peaceai-public-origin.json"), JSON.stringify({ schema: "peaceai-public-origin:v1", files: [{ path: "pub.ts", sha256: H(code(5)), origin: "PeaceG03/PeaceSTOCKS@0000000:src/pub.ts" }] }));
  execFileSync("git", ["init", "-q"], { cwd: coreDir }); execFileSync("git", ["add", "-A"], { cwd: coreDir });
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "c"], { cwd: coreDir });
  const model = join(dir, "model"); mkdirSync(model);
  writeFileSync(join(model, "config.json"), JSON.stringify({ version: "lm-v1-000000000039" }));
  let k = 0;
  const run = (texts: string[], man?: Record<string, unknown>[]) => {
    const d = join(dir, `c${k++}`); mkdirSync(d);
    writeFileSync(join(d, "docs.jsonl"), texts.map((t, i) => JSON.stringify({ doc: i, text: t })).join("\n") + "\n");
    const m = man ?? texts.map((t, i) => (i === 0 ? owner(i, t) : ext(i, t)));
    const mt = m.map((x) => JSON.stringify(x)).join("\n") + "\n";
    writeFileSync(join(d, "manifest.jsonl"), mt);
    rmSync(join(model, "corefree-proof.json"), { force: true });
    const r = spawnSync(py, [join(repo, "peaceai/model/corefree_proof.py"), "--corpus", d, "--core-dir", coreDir, "--model", model], { encoding: "utf8" });
    const proof = r.status === 0 ? JSON.parse(readFileSync(join(model, "corefree-proof.json"), "utf8")) : null;
    return { r, proof, ctx: { modelId: "lm-v1-000000000039", manifest: m as { doc: number; path: string; sha256?: string }[], manifestSha256: H(mt) } };
  };
  return { dir, run };
}

test("M39 (1): corefree_proof.py reads the external schema and fails closed on unknown fields", () => {
  const { dir, run } = proofEnv();
  try {
    const ok = run([code(2), code(3)]);
    assert.equal(ok.r.status, 0, ok.r.stderr);
    assert.equal(ok.proof.noCoreFiles, "PROVEN");
    assert.equal(ok.proof.files[1].source, "honojs/hono");
    assert.deepEqual(validCoreFreeProof(ok.proof, ok.ctx), { ok: true });
    for (const bad of [{ visibility: "public" }, { license: "GPL-3.0" }, { repo: "PeaceG03/PeaceAI" }, { origin: "x" }]) {
      const b = run([code(2)], [{ ...ext(0, code(2)), ...bad }]);
      assert.notEqual(b.r.status, 0, JSON.stringify(bad));
      assert.equal(b.proof, null, "no proof written");
    }
    const mixed = run([code(2), code(3)], [ext(0, code(2)), { doc: 1, source: "honojs/hono", visibility: "public", path: "b.ts", sha256: H(code(3)) }]);
    assert.notEqual(mixed.r.status, 0);
    const lying = run([code(2)], [ext(0, code(3))]);
    assert.notEqual(lying.r.status, 0, "text must hash to the manifest sha256");
    assert.equal(run([code(1)], [ext(0, code(1))]).proof.noCoreFiles, "NOT_PROVEN", "core copy");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("M39 (2): public-origin files count as non-core only at the pinned sha; empty/whitespace-only files are ignored", () => {
  const { dir, run } = proofEnv();
  try {
    const pinned = run([code(5)]);
    assert.equal(pinned.proof.noCoreFiles, "PROVEN", "exact pinned bytes");
    assert.equal(pinned.proof.files[0].coreExact, false);
    const ws = run([code(5) + "\n\n"]);
    assert.equal(ws.proof.noCoreFiles, "NOT_PROVEN", "whitespace variant of a pinned file is not the pinned sha");
    const near = run([code(5).replace("helper5_3(", "helperQ_3(")]);
    assert.equal(near.proof.noCoreFiles, "NOT_PROVEN", "near-copy of a pinned file");
    for (const t of ["", "\n", "  \n\t\n"]) {
      const e = run([code(2), t]);
      assert.equal(e.proof.noCoreFiles, "PROVEN", JSON.stringify(t));
      assert.deepEqual([e.proof.files[1].coreExact, e.proof.files[1].coreNearMax], [false, 0]);
    }
    assert.equal(run([code(2), "x\n"]).proof.noCoreFiles, "PROVEN", "a 2-byte non-core file is just a file");
  } finally { rmSync(dir, { recursive: true, force: true }); }
  // lm-memcheck: whitespace-only core files never enter coreShas.
  const src = readFileSync(join(repo, "peaceai/bin/lm-memcheck.ts"), "utf8");
  assert.match(src, /\(tree\.raw \?\? \[\]\)\.filter\(\(t\) => t\.replace\(\/\\s\+\/g, ""\) !== ""\)\.map\(\(t\) => h\(t\)\)/);
});

test("M39 (2): a short core file is still core (no byte threshold)", () => {
  const dir = mkdtempSync(join(tmpdir(), "m39s-"));
  try {
    const coreDir = join(dir, "core"); mkdirSync(coreDir);
    writeFileSync(join(coreDir, "t.ts"), "x;\n");
    execFileSync("git", ["init", "-q"], { cwd: coreDir }); execFileSync("git", ["add", "-A"], { cwd: coreDir });
    execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "c"], { cwd: coreDir });
    const d = join(dir, "c"); mkdirSync(d);
    writeFileSync(join(d, "docs.jsonl"), JSON.stringify({ doc: 0, text: "x;\n" }) + "\n");
    writeFileSync(join(d, "manifest.jsonl"), JSON.stringify(ext(0, "x;\n")) + "\n");
    const m = join(dir, "m"); mkdirSync(m); writeFileSync(join(m, "config.json"), JSON.stringify({ version: "lm-v1-000000000039" }));
    execFileSync(py, [join(repo, "peaceai/model/corefree_proof.py"), "--corpus", d, "--core-dir", coreDir, "--model", m]);
    assert.equal(JSON.parse(readFileSync(join(m, "corefree-proof.json"), "utf8")).noCoreFiles, "NOT_PROVEN");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("M39 (3): eval_c reports per-byte loss, tokens and bytes; --max-bytes scores an identical slice for different tokenizers", () => {
  const dir = mkdtempSync(join(tmpdir(), "m39e-"));
  try {
    const texts = [code(1), "é漢字 mixed UTF-8 ✓\n" + code(2), code(3)];
    const corpus = join(dir, "setc"); mkdirSync(corpus);
    writeFileSync(join(corpus, "docs.jsonl"), texts.map((t, i) => JSON.stringify({ doc: i, text: t })).join("\n") + "\n");
    const mk = (name: string, vocab: number, d: number) => {
      const out = join(dir, name);
      execFileSync(py, ["-c", `import sys,json,os; sys.path.insert(0, ${JSON.stringify(join(repo, "peaceai/model"))}); import lm
cfg={"version":"lm-v1-${name}","ctx":32,"d_model":${d},"n_layer":1,"n_head":2,"vocab_size":${vocab}}
os.makedirs(${JSON.stringify(out)})
json.dump(cfg,open(os.path.join(${JSON.stringify(out)},"config.json"),"w"))
json.dump(lm.train_bpe(${JSON.stringify(texts)},${vocab}),open(os.path.join(${JSON.stringify(out)},"tokenizer.json"),"w"))
lm.save_weights(os.path.join(${JSON.stringify(out)},"weights.npz"),lm.init_params(cfg,1))`]);
      return out;
    };
    const a = mk("a", 300, 16), b = mk("b", 330, 8);
    const ev = (m: string, ...x: string[]) => execFileSync(py, [join(repo, "peaceai/model/eval_c.py"), "--model", m, "--corpus", corpus, "--threads", "1", ...x], { encoding: "utf8" });
    const kv = (s: string) => Object.fromEntries([...s.matchAll(/(\w+)=(\S+)/g)].map((m) => [m[1], m[2]]));
    const cut = Buffer.byteLength(texts[0]!) + 7; // lands inside the multi-byte characters of file 2
    const ra = kv(ev(a, "--max-bytes", String(cut))), rb = kv(ev(b, "--max-bytes", String(cut)));
    assert.equal(ra.mode, "bytes");
    assert.equal(ra.slice_sha256, rb.slice_sha256, "identical byte slice");
    assert.equal(ra.bytes_scored, rb.bytes_scored);
    assert.ok(Number(ra.bytes_scored) <= cut && Number(ra.bytes_scored) >= cut - 3, ra.bytes_scored);
    assert.notEqual(ra.tokens, rb.tokens, "different tokenizers, different token counts");
    assert.equal(ra.scope, "partial");
    assert.deepEqual([ra.files_scored, ra.files_fully_scored, ra.files_total], ["2", "1", "3"]);
    for (const r of [ra, rb]) {
      assert.ok(Math.abs(Number(r.bits_per_byte) - Number(r.loss_per_byte) / Math.LN2) < 1e-3);
      assert.ok(Math.abs(Number(r.loss_per_byte) - (Number(r.mean_loss) * Number(r.tokens)) / Number(r.bytes_scored)) < 0.02);
    }
    const all = kv(ev(a, "--max-bytes", "10000000"));
    assert.equal(all.scope, "full");
    assert.equal(Number(all.bytes_scored), texts.reduce((s, t) => s + Buffer.byteLength(t), 0));
    // Token mode (the workflow default) also reports bytes of exactly the scored tokens.
    const tm = kv(ev(a, "--max-tokens", "50"));
    assert.equal(tm.mode, "tokens");
    assert.equal(tm.tokens, "50");
    assert.ok(Number(tm.bytes_scored) > 0 && Number(tm.bytes_scored) <= 50 * 8);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("M39: protected", () => {
  for (const p of ["peaceai/model/corefree_proof.py", "peaceai/model/eval_c.py", "peaceai/lib/lm.ts", "peaceai/bin/lm-memcheck.ts", "peaceai/test/m39-corefree-ext.test.ts"]) assert.ok(protectedReason(p), p);
});
