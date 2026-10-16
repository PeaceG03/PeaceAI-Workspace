// M51: split manifest (parts under 2 MB + index.json). Fail closed on missing/altered/extra parts and on mixed formats;
// the Python reader (manifest_parts.py, used by corefree_proof.py) agrees with the JS reader on every case.
import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync, appendFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PART_MAX_BYTES, readManifestBytes, splitLines, writeParts } from "../lib/manifestparts.ts";
import { protectedReason } from "../lib/selfchange.ts";

const repo = join(import.meta.dirname, "../..");
const model = join(repo, "peaceai/model");
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const body = Buffer.from(Array.from({ length: 400 }, (_, i) => JSON.stringify({ doc: i, pad: "x".repeat(i % 37) })).join("\n") + "\n");
function fixture(): string { const d = mkdtempSync(join(tmpdir(), "m51-")); writeParts(d, "manifest", body, 1000); return d; }
const js = (d: string): string => { try { return sha(readManifestBytes(d, "manifest")); } catch (e) { return "ERR"; } };
const py = (d: string): string => {
  const r = spawnSync("python3", ["-c", "import sys,hashlib; sys.path.insert(0, sys.argv[1]); import manifest_parts as m\ntry: print(hashlib.sha256(m.read_manifest_bytes(sys.argv[2], 'manifest')).hexdigest())\nexcept ValueError: print('ERR')", model, d], { encoding: "utf8" });
  return r.stdout.trim();
};
const both = (d: string) => { const a = js(d), b = py(d); assert.equal(a, b, "JS and Python readers agree"); return a; };

test("split is deterministic, line-aligned, every part under the limit, and joins to the same sha256", () => {
  const a = splitLines(body, 1000), b = splitLines(body, 1000);
  assert.deepEqual(a.map(sha), b.map(sha));
  assert.ok(a.length > 1 && a.every((p) => p.length <= 1000 && p[p.length - 1] === 10));
  assert.equal(sha(Buffer.concat(a)), sha(body));
  const d = fixture(); assert.equal(both(d), sha(body)); rmSync(d, { recursive: true });
});

const cases: [string, (d: string) => void][] = [
  ["missing part", (d) => rmSync(join(d, "manifest/part-001.jsonl"))],
  ["altered part", (d) => appendFileSync(join(d, "manifest/part-000.jsonl"), "{}\n")],
  ["extra part", (d) => writeFileSync(join(d, "manifest/part-999.jsonl"), "{}\n")],
  ["extra other file", (d) => writeFileSync(join(d, "manifest/notes.txt"), "x")],
  ["missing index", (d) => rmSync(join(d, "manifest/index.json"))],
  ["index combined sha altered", (d) => { const p = join(d, "manifest/index.json"); const ix = JSON.parse(readFileSync(p, "utf8")); ix.combinedSha256 = "0".repeat(64); writeFileSync(p, JSON.stringify(ix)); }],
  ["index drops a part", (d) => { const p = join(d, "manifest/index.json"); const ix = JSON.parse(readFileSync(p, "utf8")); ix.parts.pop(); writeFileSync(p, JSON.stringify(ix)); }],
  ["mixed formats", (d) => writeFileSync(join(d, "manifest.jsonl"), body)],
];
for (const [name, mut] of cases) test(`fail closed (JS and Python): ${name}`, () => { const d = fixture(); mut(d); assert.equal(both(d), "ERR"); rmSync(d, { recursive: true }); });

test("single-file format still reads (both readers); writeParts refuses next to a single file", () => {
  const d = mkdtempSync(join(tmpdir(), "m51-")); writeFileSync(join(d, "manifest.jsonl"), body);
  assert.equal(both(d), sha(body));
  assert.throws(() => writeParts(d, "manifest", body, 1000), /mixed/);
  rmSync(d, { recursive: true });
});

test("committed M49 manifest: split parts only, each under 2 MB, joining to 8458eac6…; memcheck and summary bound to it", () => {
  assert.throws(() => statSync(join(model, "ext-manifest.jsonl")), "no single-file manifest beside the parts");
  for (const f of readdirSync(join(model, "ext-manifest"))) assert.ok(statSync(join(model, "ext-manifest", f)).size < 2_000_000 && statSync(join(model, "ext-manifest", f)).size <= PART_MAX_BYTES + 1000, f);
  const whole = readManifestBytes(model, "ext-manifest");
  assert.equal(sha(whole), "8458eac61cc414128e98eedb6c3b3ad9c50813e62ab680f5a9ef9d909ccfc231");
  assert.equal(JSON.parse(readFileSync(join(model, "ext-memcheck.json"), "utf8")).manifestSha256, sha(whole));
  assert.equal(JSON.parse(readFileSync(join(model, "ext-summary.json"), "utf8")).manifestSha256, sha(whole));
  for (const p of ["peaceai/model/ext-manifest/index.json", "peaceai/model/ext-manifest/part-000.jsonl", "peaceai/lib/manifestparts.ts", "peaceai/model/manifest_parts.py", "peaceai/test/m51-manifest-parts.test.ts"]) assert.ok(protectedReason(p), p);
});

test("--manifest-sha pin: the M37 workflow pins the #148 manifest, so ext-fetch and ext-manifest-check refuse the M49 corpus", () => {
  const wf = readFileSync(join(repo, ".github/workflows/peace-lm-train.yml"), "utf8");
  assert.equal((wf.match(/--manifest-sha 040eb0c40961b9ac669c97bbcc4c2c3aca30234a9de10e7562ab4cd2fc7a33af\n/g) ?? []).length, 2);
  const d = mkdtempSync(join(tmpdir(), "m51-")); mkdirSync(join(d, "c")); writeFileSync(join(d, "c/docs.jsonl"), "");
  const tsx = join(repo, "node_modules/.bin/tsx");
  const f = spawnSync(tsx, [join(repo, "peaceai/bin/ext-fetch.ts"), join(d, "w"), join(d, "o"), "--manifest-sha", "040eb0c40961b9ac669c97bbcc4c2c3aca30234a9de10e7562ab4cd2fc7a33af"], { encoding: "utf8" });
  assert.equal(f.status, 1); assert.match(f.stdout, /ext-fetch refused: manifest sha256 8458eac6/);
  const m = spawnSync(tsx, [join(repo, "peaceai/bin/ext-manifest-check.ts"), join(d, "c"), "pretrain", "--manifest-sha", "040eb0c40961b9ac669c97bbcc4c2c3aca30234a9de10e7562ab4cd2fc7a33af"], { encoding: "utf8" });
  assert.equal(m.status, 1); assert.match(m.stdout, /is not the pinned 040eb0c4/);
  rmSync(d, { recursive: true });
});

test("M51 option (b): path-leak exclusions are listed with a reason (no paths), absent from the manifest, and no manifest path trips the leak scan", async () => {
  const { pathLeakKinds } = await import("../lib/extcorpus.ts");
  const model = join(import.meta.dirname, "../model");
  const ex = JSON.parse(readFileSync(join(model, "ext-path-exclusions.json"), "utf8"));
  assert.equal(ex.schema, "peaceai-ext-path-exclusions:v1");
  assert.equal(ex.count, ex.entries.length);
  assert.equal(ex.count, 77);
  const lines = readManifestBytes(model, "ext-manifest").toString("utf8").trim().split("\n").slice(1).map((l) => JSON.parse(l));
  const shas = new Set(lines.map((e: { sha256: string }) => e.sha256));
  for (const e of ex.entries) {
    assert.match(e.sha256, /^[0-9a-f]{64}$/); assert.ok(e.kinds.length > 0); assert.match(e.reason, /^path-leak: /);
    assert.equal(Object.keys(e).includes("path"), false);
    assert.equal(shas.has(e.sha256), false);
  }
  for (const e of lines) assert.deepEqual(pathLeakKinds(e.path), [], e.repo);
  const summary = JSON.parse(readFileSync(join(model, "ext-summary.json"), "utf8"));
  assert.equal(summary.excluded["path-leak"], ex.count);
});

test("M51 follow-up: --write keeps heldout-c.json fields it does not own (wiredAsEval, wiredBy, others), same key order", async () => {
  const { mergeHeldoutC } = await import("../lib/extcorpus.ts");
  const prev = { schema: "old", rule: "old", wiredAsEval: true, sets: { C: [1] }, wiredBy: "Peace", extra: { a: 1 } };
  const m = mergeHeldoutC(prev, { schema: "peaceai-heldout-c:v2", rule: "R", sets: { C: [2] } });
  assert.deepEqual(m, { schema: "peaceai-heldout-c:v2", rule: "R", wiredAsEval: true, sets: { C: [2] }, wiredBy: "Peace", extra: { a: 1 } });
  assert.deepEqual(Object.keys(m), Object.keys(prev));
  assert.equal(mergeHeldoutC({}, { schema: "s", rule: "r", sets: {} }).wiredAsEval, false);
  // The committed file round-trips byte-identically through the merge (what a --write rebuild of the same sets does).
  const path = join(import.meta.dirname, "../model/heldout-c.json");
  const cur = JSON.parse(readFileSync(path, "utf8"));
  assert.equal(JSON.stringify(mergeHeldoutC(cur, { schema: cur.schema, rule: cur.rule, sets: cur.sets }), null, 1) + "\n", readFileSync(path, "utf8"));
  const src = readFileSync(join(import.meta.dirname, "../bin/ext-corpus.ts"), "utf8");
  assert.match(src, /mergeHeldoutC\(prevC,/);
  assert.doesNotMatch(src, /wiredAsEval: false, sets:/);
});
