// M40 (Auditor #160 follow-ups): ASCII-only whitespace, license type, ASCII repo names, bools are not ints,
// Python/JS parity, doc-id set equality, exclusive eval caps, stale proofs removed.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { docIdsMatch, extManifestEntryProblem, isAsciiBlank, manifestProvesNoCore } from "../lib/lm.ts";
import { protectedReason } from "../lib/selfchange.ts";

const repo = resolve(import.meta.dirname, "..", "..");
const py = process.env.PEACEAI_PYTHON ?? "python3";
const H = (s: string) => createHash("sha256").update(s).digest("hex");
const C40 = "0123456789abcdef0123456789abcdef01234567";
const code = (n: number) => Array.from({ length: 40 }, (_, i) => `export function helper${n}_${i}(value: number): number { return value * ${i * n + 3} + ${n}; }`).join("\n");
const ext = (doc: number, text: string, over: Record<string, unknown> = {}) => ({ doc, stage: "pretrain", repo: "honojs/hono", commit: C40, license: "MIT", path: `src/f${doc}.ts`, sha256: H(text), bytes: Buffer.byteLength(text), origin: "external", split: "train", ...over });
const NBSP = "\u00a0\u00a0\n", FS = "\x1c\x1d\n";

function env(coreFiles: Record<string, string> = { "x.ts": code(1) }) {
  const dir = mkdtempSync(join(tmpdir(), "m40-"));
  const core = join(dir, "core"); mkdirSync(core);
  for (const [p, t] of Object.entries(coreFiles)) writeFileSync(join(core, p), t);
  execFileSync("git", ["init", "-q"], { cwd: core }); execFileSync("git", ["add", "-A"], { cwd: core });
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "c"], { cwd: core });
  const model = join(dir, "model"); mkdirSync(model);
  writeFileSync(join(model, "config.json"), JSON.stringify({ version: "lm-v1-000000000040" }));
  let k = 0;
  const run = (docs: { doc: unknown; text: string }[], man: unknown[]) => {
    const d = join(dir, `c${k++}`); mkdirSync(d);
    writeFileSync(join(d, "docs.jsonl"), docs.map((x) => JSON.stringify(x)).join("\n") + "\n");
    writeFileSync(join(d, "manifest.jsonl"), man.map((x) => JSON.stringify(x)).join("\n") + "\n");
    const r = spawnSync(py, [join(repo, "peaceai/model/corefree_proof.py"), "--corpus", d, "--core-dir", core, "--model", model], { encoding: "utf8" });
    const p = join(model, "corefree-proof.json");
    return { status: r.status, out: r.stdout ? JSON.parse(r.stdout) : null, proof: existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null, stderr: r.stderr };
  };
  return { dir, model, run };
}
const one = (text: string, over: Record<string, unknown> = {}) => ({ docs: [{ doc: 0, text }], man: [ext(0, text, over)] });

test("M40: ASCII-only whitespace: NBSP-only and \\x1c-only files are NOT ignored, in Python and JS", () => {
  assert.equal(isAsciiBlank(" \t\r\n\f\v"), true);
  for (const t of [NBSP, FS, "\u2003", "\u3000", "\ufeff", "\x1f"]) assert.equal(isAsciiBlank(t), false, JSON.stringify(t));
  const { dir, run } = env({ "x.ts": code(1), "nb.ts": NBSP, "fs.ts": FS });
  try {
    for (const t of [NBSP, FS]) {
      const r = run(one(t).docs, one(t).man);
      assert.equal(r.status, 0, r.stderr);
      assert.equal(r.out.ignoredEmpty, 0, "not skipped as blank");
      assert.equal(r.proof.noCoreFiles, "NOT_PROVEN", "a copy of the NBSP/\\x1c-only core file flags");
    }
    const ws = run(one(" \n").docs, one(" \n").man);
    assert.equal(ws.out.ignoredEmpty, 1);
    assert.equal(ws.proof.noCoreFiles, "PROVEN");
  } finally { rmSync(dir, { recursive: true, force: true }); }
  assert.match(readFileSync(join(repo, "peaceai/bin/lm-memcheck.ts"), "utf8"), /\.filter\(\(t\) => !isAsciiBlank\(t\)\)/);
});

// One table, both implementations: refused in Python (exit != 0, no proof) exactly when JS reports a problem.
const CASES: [string, Record<string, unknown>][] = [
  ["ok", {}], ["ok owner", { repo: "PeaceG03/PeaceSTOCKS", license: "owner:PeaceG03", origin: "owner-public" }],
  ["ok workspace", { repo: "PeaceG03/PeaceAI-Workspace", license: "owner:PeaceG03", origin: "owner-public" }],
  ["../x", { repo: "../x" }], ["a/..", { repo: "a/.." }], ["-o/x", { repo: "-o/x" }], ["a/-x", { repo: "a/-x" }],
  ["lowercase peace external", { repo: "peaceg03/PeaceSTOCKS" }], ["Peace external", { repo: "PeaceG03/PeaceSTOCKS" }],
  ["core", { repo: "PeaceG03/PeaceAI", license: "owner:PeaceG03", origin: "owner-public" }],
  ["lowercase owner", { repo: "peaceg03/PeaceSTOCKS", license: "owner:PeaceG03", origin: "owner-public" }],
  ["unicode repo", { repo: "hönojs/hono" }], ["fullwidth repo", { repo: "ｈono/x" }], ["arabic digit", { repo: "a٣/x" }],
  ["license array", { license: ["MIT"] }], ["license number", { license: 1 }], ["license null", { license: null }], ["GPL", { license: "GPL-3.0" }],
  ["doc true", { doc: true }], ["doc -1", { doc: -1 }], ["doc 1.5", { doc: 1.5 }], ["bytes true", { bytes: true }], ["bytes -1", { bytes: -1 }],
  ["unknown field", { visibility: "public" }], ["bad origin", { origin: "private" }], ["bad commit", { commit: "x" }],
];

test("M40: Python/JS parity on the external entry rules (incl. ../x, -o/x, lowercase Peace, unicode repos, bools, license type)", () => {
  const { dir, run } = env();
  try {
    for (const [name, over] of CASES) {
      const e = ext(0, code(2), over);
      const js = extManifestEntryProblem(e) === null && manifestProvesNoCore([e], new Set());
      const r = run([{ doc: e.doc, text: code(2) }], [e]);
      const pyOk = r.status === 0;
      assert.equal(pyOk, js, `${name}: python ${pyOk} (${r.stderr.trim()}) vs js ${js}`);
      if (!pyOk) assert.equal(r.proof, null, `${name}: no proof written`);
      assert.equal(name.startsWith("ok"), js, `${name}: expectation`);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("M40: docs.jsonl and manifest doc id sets must be equal (fail closed); stale proof deleted at startup", () => {
  assert.equal(docIdsMatch([0, 1], [1, 0]), true);
  for (const [m, d] of [[[0, 1], [0]], [[0], [0, 1]], [[0, 0], [0]], [[0], [0, 0]], [[0], ["0"]], [[true], [true]]] as unknown[][][]) assert.equal(docIdsMatch(m!, d!), false, JSON.stringify([m, d]));
  assert.match(readFileSync(join(repo, "peaceai/bin/lm-memcheck.ts"), "utf8"), /if \(!docIdsMatch\(tm\.map\(\(m\) => m\.doc\), docIds\)\) noCoreProof = "NOT_PROVEN";/);
  const { dir, model, run } = env();
  try {
    const t0 = code(2), t1 = code(3);
    const ok = run([{ doc: 0, text: t0 }, { doc: 1, text: t1 }], [ext(0, t0), ext(1, t1)]);
    assert.equal(ok.proof.noCoreFiles, "PROVEN");
    for (const [docs, man] of [
      [[{ doc: 0, text: t0 }, { doc: 1, text: t1 }], [ext(0, t0)]],
      [[{ doc: 0, text: t0 }], [ext(0, t0), ext(1, t1)]],
      [[{ doc: 0, text: t0 }, { doc: 0, text: t0 }], [ext(0, t0)]],
      [[{ doc: 0, text: t0 }], [ext(0, t0), ext(0, t0)]],
      [[{ doc: true, text: t0 }], [ext(0, t0)]],
    ] as [{ doc: unknown; text: string }[], unknown[]][]) {
      writeFileSync(join(model, "corefree-proof.json"), JSON.stringify({ stale: true }));
      const r = run(docs, man);
      assert.notEqual(r.status, 0, JSON.stringify(docs.map((d) => d.doc)));
      assert.equal(r.proof, null, "stale proof removed, nothing new written");
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("M40: eval_c --max-tokens and --max-bytes are mutually exclusive", () => {
  const r = spawnSync(py, [join(repo, "peaceai/model/eval_c.py"), "--model", "/nonexistent", "--corpus", "/nonexistent", "--max-tokens", "10", "--max-bytes", "10"], { encoding: "utf8" });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /not allowed with argument/);
});

test("M40: protected", () => {
  assert.ok(protectedReason("peaceai/test/m40-corefree-followups.test.ts"));
});
