// M52 (Architect, M49 Auditor M5): the core-free proof accepts the M49 fine-tune manifest schema
// (doc, split, repo, sha, path, function), fail-closed on unknown fields, with Python/JS parity.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { ftManifestEntryProblem, manifestProvesNoCore, validCoreFreeProof } from "../lib/lm.ts";
import { protectedReason } from "../lib/selfchange.ts";

const repo = resolve(import.meta.dirname, "..", "..");
const py = process.env.PEACEAI_PYTHON ?? "python3";
const H = (s: string) => createHash("sha256").update(s).digest("hex");
const S40 = "0123456789abcdef0123456789abcdef01234567";
const body = (n: number) => `export function f${n}(a: number): number {\n  const r = a * ${n} + ${n * 7};\n  return r;\n}`;
const ft = (doc: number, over: Record<string, unknown> = {}) => ({ doc, split: doc % 5 ? "train" : "heldout", repo: "PeaceG03/PeaceSTOCKS", sha: S40, path: `src/f${doc}.ts`, function: `f${doc}`, ...over });
const CORE = Array.from({ length: 40 }, (_, i) => `export function coreOnly${i}(v: string): string { return v.repeat(${i}) + "${i}"; }`).join("\n");

function env() {
  const dir = mkdtempSync(join(tmpdir(), "m52-"));
  const core = join(dir, "core"); mkdirSync(core); writeFileSync(join(core, "x.ts"), CORE);
  execFileSync("git", ["init", "-q"], { cwd: core }); execFileSync("git", ["add", "-A"], { cwd: core });
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "c"], { cwd: core });
  const model = join(dir, "model"); mkdirSync(model);
  writeFileSync(join(model, "config.json"), JSON.stringify({ version: "lm-v1-000000000052" }));
  let k = 0;
  const run = (docs: { doc: unknown; text: string }[], man: unknown[]) => {
    const d = join(dir, `c${k++}`); mkdirSync(d);
    const manText = man.map((x) => JSON.stringify(x)).join("\n") + "\n";
    writeFileSync(join(d, "docs.jsonl"), docs.map((x) => JSON.stringify(x)).join("\n") + "\n");
    writeFileSync(join(d, "manifest.jsonl"), manText);
    const r = spawnSync(py, [join(repo, "peaceai/model/corefree_proof.py"), "--corpus", d, "--core-dir", core, "--model", model], { encoding: "utf8" });
    const p = join(model, "corefree-proof.json");
    return { status: r.status, stderr: r.stderr, out: r.stdout ? JSON.parse(r.stdout) : null, proof: existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null, manSha: H(manText) };
  };
  return { run };
}
const DOCS = [0, 1, 2, 3, 4, 5].map((i) => ({ doc: i, text: body(i + 1) }));
const MAN = DOCS.map((d) => ft(d.doc));
const docSha = new Map<unknown, string>(DOCS.map((d) => [d.doc, H(d.text)]));

test("M52: a clean fine-tune manifest is PROVEN; the proof's file hashes are the doc texts' hashes; JS accepts the same proof", () => {
  const { run } = env();
  const r = run(DOCS, MAN);
  assert.equal(r.status, 0, r.stderr); assert.equal(r.out.schema, "finetune"); assert.equal(r.proof.noCoreFiles, "PROVEN");
  for (const f of r.proof.files) assert.equal(f.sha256, docSha.get(f.doc));
  assert.equal(manifestProvesNoCore(MAN, new Set([H(CORE)]), "PeaceG03/PeaceAI", docSha), true);
  assert.deepEqual(validCoreFreeProof(r.proof, { modelId: "lm-v1-000000000052", manifest: MAN, manifestSha256: r.manSha, docSha256: docSha }), { ok: true });
  assert.equal(validCoreFreeProof(r.proof, { modelId: "lm-v1-000000000052", manifest: MAN, manifestSha256: r.manSha }).reason, "FILE_MISMATCH", "no doc hashes: fails closed");
  const wrong = new Map(docSha); wrong.set(0, H("other"));
  assert.equal(validCoreFreeProof(r.proof, { modelId: "lm-v1-000000000052", manifest: MAN, manifestSha256: r.manSha, docSha256: wrong }).reason, "FILE_MISMATCH");
  assert.equal(manifestProvesNoCore(MAN, new Set([H(CORE)])), false, "no doc hashes: not proven");
  assert.equal(manifestProvesNoCore(MAN, new Set([docSha.get(0)!]), "PeaceG03/PeaceAI", docSha), false, "a doc equal to a core file");
});

test("M52: a fine-tune doc that copies core is NOT_PROVEN", () => {
  const { run } = env();
  const r = run([...DOCS, { doc: 6, text: CORE }], [...MAN, ft(6)]);
  assert.equal(r.status, 0, r.stderr); assert.equal(r.proof.noCoreFiles, "NOT_PROVEN");
});

// Every case: Python refuses (exit 1, no proof) exactly when JS reports a problem; same first problem text.
const BAD: [string, Record<string, unknown>][] = [
  ["unknown field", ft(0, { sha256: H("x") })], ["unknown field (license)", ft(0, { license: "MIT" })], ["missing function", (({ function: _f, ...r }) => r)(ft(0))],
  ["missing sha", (({ sha: _s, ...r }) => r)(ft(0))], ["bool doc", ft(0, { doc: true })], ["negative doc", ft(0, { doc: -1 })], ["float doc", ft(0, { doc: 0.5 })],
  ["empty path", ft(0, { path: "" })], ["empty function", ft(0, { function: "" })], ["function not a string", ft(0, { function: 3 })],
  ["bad split", ft(0, { split: "test" })], ["short sha", ft(0, { sha: "abc" })], ["upper sha", ft(0, { sha: S40.toUpperCase() })],
  ["external repo", ft(0, { repo: "honojs/hono" })], ["core repo", ft(0, { repo: "PeaceG03/PeaceAI" })], ["repo not a string", ft(0, { repo: ["PeaceG03/PeaceSTOCKS"] })],
];
test("M52: Python/JS parity on every malformed fine-tune entry (fail closed, no proof written)", () => {
  const { run } = env();
  for (const [name, m] of BAD) {
    const js = ftManifestEntryProblem(m);
    assert.notEqual(js, null, `JS accepts ${name}`);
    const docs = [{ doc: typeof m.doc === "number" && Number.isInteger(m.doc) ? m.doc : 0, text: body(9) }];
    const r = run(docs, [{ ...m }]);
    assert.equal(r.status, 1, `python accepts ${name}`); assert.equal(r.proof, null, name);
    assert.ok(r.stderr.includes(js!), `${name}: python "${r.stderr.trim()}" vs JS "${js}"`);
    assert.equal(manifestProvesNoCore([m], new Set(), "PeaceG03/PeaceAI", new Map([[m.doc, H(body(9))]])), false, name);
  }
  assert.equal(ftManifestEntryProblem(ft(0)), null);
  assert.equal(ftManifestEntryProblem(ft(0, { repo: "PeaceG03/PeaceAI-Workspace", split: "heldout" })), null);
});

test("M52: mixed fine-tune and external/internal entries are refused by both sides", () => {
  const { run } = env();
  const ext = { doc: 1, stage: "pretrain", repo: "honojs/hono", commit: S40, license: "MIT", path: "src/a.ts", sha256: H(body(2)), origin: "external" };
  const r = run([{ doc: 0, text: body(1) }, { doc: 1, text: body(2) }], [ft(0), ext]);
  assert.equal(r.status, 1); assert.match(r.stderr, /mixed fine-tune/); assert.equal(r.proof, null);
  assert.equal(manifestProvesNoCore([ft(0), ext], new Set(), "PeaceG03/PeaceAI", new Map([[0, H(body(1))], [1, H(body(2))]])), false);
  const int = { doc: 1, path: "a.ts", source: "PeaceG03/PeaceSTOCKS", visibility: "public", sha256: H(body(2)) };
  assert.equal(run([{ doc: 0, text: body(1) }, { doc: 1, text: body(2) }], [ft(0), int]).status, 1);
  assert.equal(manifestProvesNoCore([ft(0), int], new Set(), "PeaceG03/PeaceAI", new Map([[0, H(body(1))], [1, H(body(2))]])), false);
});

test("M52: the strict rule is not the fallback for a valid fine-tune proof; the proof code and this test are protected", () => {
  for (const p of ["peaceai/model/corefree_proof.py", "peaceai/lib/lm.ts", "peaceai/bin/lm-memcheck.ts", "peaceai/test/m52-corefree-ft.test.ts"]) assert.ok(protectedReason(p), p);
  const mc = readFileSync(join(repo, "peaceai/bin/lm-memcheck.ts"), "utf8");
  assert.match(mc, /validCoreFreeProof\(proof, \{ modelId, manifest: tm, manifestSha256: trainManifestSha, docSha256 \}\)/);
  assert.match(mc, /manifestProvesNoCore\(tm, coreShas, CORE_SOURCE, docSha256\)/);
});
