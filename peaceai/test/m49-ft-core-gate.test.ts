// M49 BLOCKING (1) (Auditor): the fine-tune corpus is core-gated before training. The box record
// (peaceai/model/ft-corefree.json) pins the repo commits, the excluded core docs, the manifest/docs shas and the sha of
// the committed box core-free proof; the workflow builds from the pins and runs ft-gate.ts before the fine-tune.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { FT_COREFREE_SCHEMA, ftGateProblems, recordProblems, sha256Hex } from "../lib/ftgate.ts";
import { PROTECTED_SELF } from "../lib/selfchange.ts";

const root = resolve(import.meta.dirname, "../..");
const read = (p: string) => readFileSync(resolve(root, p), "utf8");
const repos = [{ repo: "PeaceG03/A", sha: "a".repeat(40) }];
const docs = ['{"doc":0,"text":"function f() {}"}', '{"doc":1,"text":"function g() {}"}'].join("\n") + "\n";
const manifest = '{"doc":0}\n{"doc":1}\n';
const texts = ["function f() {}", "function g() {}"];
const mkProof = (o: Record<string, unknown> = {}) => JSON.stringify({ schema: "peaceai-lm-corefree-proof:v1", corpus: "finetune", noCoreFiles: "PROVEN", manifestSha256: sha256Hex(manifest), coreCommit: "c".repeat(40), near: { threshold: 0.8 }, files: texts.map((t) => ({ sha256: sha256Hex(t), coreExact: false, coreNearMax: 0.1 })), ...o });
const mkRecord = (proof: string, o: Record<string, unknown> = {}) => ({ schema: FT_COREFREE_SCHEMA, repos, excludedDocSha256: ["e".repeat(64)], manifestSha256: sha256Hex(manifest), docsSha256: sha256Hex(docs), proof: { path: "peaceai/model/ft-corefree-proof.json", sha256: sha256Hex(proof), noCoreFiles: "PROVEN", coreCommit: "c".repeat(40) }, ...o });
const gate = (proof: string, record: unknown = mkRecord(proof), x: { docs?: string; manifest?: string; repos?: typeof repos } = {}) => ftGateProblems({ record, proofBytes: proof, manifestBytes: x.manifest ?? manifest, docsBytes: x.docs ?? docs, repos: x.repos ?? repos });

test("gate passes only for the exact recorded corpus and PROVEN proof", () => {
  const p = mkProof();
  assert.deepEqual(gate(p), []);
  assert.ok(gate(p, undefined, { docs: docs.replace("g()", "h()") }).length, "changed docs refused");
  assert.ok(gate(p, undefined, { manifest: manifest + '{"doc":2}\n' }).length, "changed manifest refused");
  assert.ok(gate(p, undefined, { repos: [{ repo: "PeaceG03/A", sha: "b".repeat(40) }] }).length, "unpinned commit refused");
  assert.ok(gate(p, mkRecord(mkProof({ noCoreFiles: "NOT_PROVEN" }))).length, "record pins a different proof");
  const np = mkProof({ noCoreFiles: "NOT_PROVEN" });
  assert.ok(gate(np, mkRecord(np)).includes("proof is not PROVEN"));
  const ex = mkProof({ files: texts.map((t, i) => ({ sha256: sha256Hex(t), coreExact: i === 1, coreNearMax: 0 })) });
  assert.ok(gate(ex, mkRecord(ex)).includes("proof lists a core or excluded doc"));
  const near = mkProof({ files: texts.map((t) => ({ sha256: sha256Hex(t), coreExact: false, coreNearMax: 0.8 })) });
  assert.ok(gate(near, mkRecord(near)).includes("proof lists a core or excluded doc"));
  const pre = mkProof({ corpus: "pretrain" });
  assert.ok(gate(pre, mkRecord(pre)).includes("proof is not a fine-tune core-free proof"));
  const other = mkProof({ manifestSha256: "f".repeat(64) });
  assert.ok(gate(other, mkRecord(other)).includes("proof is for a different manifest"));
  const short = mkProof({ files: [{ sha256: sha256Hex(texts[0]!), coreExact: false, coreNearMax: 0 }] });
  assert.ok(gate(short, mkRecord(short)).includes("proof does not cover exactly the built docs"));
  assert.deepEqual(recordProblems(null), ["record schema"]);
  assert.ok(recordProblems({ ...mkRecord(p), repos: [{ repo: "PeaceG03/A", sha: "main" }] }).length, "branch names are not pins");
});

test("committed box record: well formed, proof pinned by sha, PROVEN for the recorded manifest, excluded docs absent", () => {
  const rec = JSON.parse(read("peaceai/model/ft-corefree.json"));
  assert.deepEqual(recordProblems(rec), []);
  const proofText = read("peaceai/model/ft-corefree-proof.json");
  assert.equal(sha256Hex(proofText), rec.proof.sha256);
  const proof = JSON.parse(proofText);
  assert.equal(proof.corpus, "finetune"); assert.equal(proof.noCoreFiles, "PROVEN");
  assert.equal(proof.manifestSha256, rec.manifestSha256); assert.equal(proof.coreCommit, rec.proof.coreCommit);
  for (const f of proof.files) { assert.equal(f.coreExact, false); assert.ok(f.coreNearMax < proof.near.threshold); assert.ok(!rec.excludedDocSha256.includes(f.sha256)); }
  assert.deepEqual(rec.repos.map((r: { repo: string }) => r.repo), JSON.parse(read("peaceai/model/ext-train-m49.json")).finetune.repos);
});

test("workflow: fine-tune corpus from the pinned commits, ft-gate runs after ft-pairs and before the fine-tune trains", () => {
  const y = read(".github/workflows/peace-lm-train-m49.yml");
  const iPairs = y.indexOf("peaceai/bin/ft-pairs.ts"), iGate = y.indexOf("peaceai/bin/ft-gate.ts"), iTrain = y.indexOf("name: Fine-tune from the pretrain best weights");
  assert.ok(iPairs > 0 && iGate > iPairs && iTrain > iGate, "ft-pairs -> ft-gate -> train");
  assert.ok(!/rev-parse HEAD\)"\)\s*$/m.test(y.slice(iPairs - 800, iPairs)), "no HEAD-built fine-tune corpus");
  assert.match(y, /checkout --quiet --detach "\$sha"/);
  assert.match(read("peaceai/bin/ft-pairs.ts"), /excludedDocSha256/);
});

test("the gate, record, proof and these tests are protected", () => {
  for (const p of ["peaceai/lib/ftgate.ts", "peaceai/bin/ft-gate.ts", "peaceai/model/ft-corefree.json", "peaceai/model/ft-corefree-proof.json", "peaceai/test/m49-ft-core-gate.test.ts"]) assert.ok(PROTECTED_SELF.some((x) => x.pattern.test(p)), p);
});
