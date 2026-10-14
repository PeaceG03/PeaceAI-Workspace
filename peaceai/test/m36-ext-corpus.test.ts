// M36: external pretraining corpus (license-verified, provenance manifest, stage field) and set C v2 (whole held-out repos).
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";
import { EXT_MEMCHECK_SCHEMA, isSafetyToolFile, SAFETY_TOOL_FILES, BUILT_STAGES, EXT_C_PERCENT, EXT_C_RULE, EXT_MANIFEST_SCHEMA, EXT_MAX_BYTES, EXT_MIN_BYTES, EXT_REPO_CAP_BYTES, extCRepos, extFileExclusion, STAGES, validExtConfig, type ExtManifestEntry } from "../lib/extcorpus.ts";
import { ALLOWED_SPDX, allHeldOutHashes, heldOutCHashes, heldOutHashes, type HeldOutCFile } from "../lib/lmcorpus.ts";
import { protectedReason } from "../lib/selfchange.ts";

const root = resolve(import.meta.dirname, "../..");
const rd = (p: string) => readFileSync(join(root, "peaceai/model", p), "utf8");
const cfg = JSON.parse(rd("ext-corpus.json"));
const c = JSON.parse(rd("heldout-c.json")) as HeldOutCFile & { rule: string; wiredAsEval: boolean; sets: { C: { repo: string; sha: string; spdx: string; contentSha256: string[] }[] } };
const lines = rd("ext-manifest.jsonl").split("\n").filter(Boolean);
const header = JSON.parse(lines[0]!);
const man: ExtManifestEntry[] = lines.slice(1).map((l) => JSON.parse(l));

test("config: valid, every repo pinned with an allowed SPDX id and license sha256; stage pretrain only", () => {
  assert.equal(validExtConfig(cfg), null);
  assert.equal(cfg.stage, "pretrain");
  assert.deepEqual([...STAGES], ["pretrain", "finetune"]);
  assert.deepEqual([...BUILT_STAGES], ["pretrain"]);
  assert.equal(validExtConfig({ ...cfg, stage: "finetune" }), "stage", "finetune is reserved, not built");
  assert.equal(validExtConfig({ ...cfg, repos: [{ ...cfg.repos[0], spdx: "GPL-3.0" }] }), `repo ${cfg.repos[0].name}`);
  assert.equal(validExtConfig({ ...cfg, repos: [cfg.repos[0], cfg.repos[0]] }), "duplicate repo");
  for (const r of cfg.repos) assert.ok((ALLOWED_SPDX as readonly string[]).includes(r.spdx));
});

test("set C v2: rule text, deterministic whole-repo selection, not wired as eval", () => {
  assert.equal(c.schema, "peaceai-heldout-c:v2");
  assert.equal(c.rule, EXT_C_RULE);
  assert.equal(c.wiredAsEval, false);
  const names = cfg.repos.map((r: { name: string }) => r.name);
  assert.deepEqual(c.sets.C.map((e) => e.repo), extCRepos(names));
  assert.deepEqual(extCRepos([...names].reverse()), extCRepos(names), "order-independent");
  assert.equal(c.sets.C.length, Math.ceil((names.length * EXT_C_PERCENT) / 100));
  for (const e of c.sets.C) assert.equal(e.sha, cfg.repos.find((r: { name: string }) => r.name === e.repo).commit);
  assert.throws(() => heldOutCHashes({ schema: "peaceai-heldout-c:v1", sets: c.sets } as unknown as HeldOutCFile), /bad held-out C file/, "v1 Peace-commit carve refused");
});

test("manifest: provenance per file, stage pretrain, no held-out repo, no A/B/C sha, no duplicate, size band and repo cap", () => {
  assert.equal(header.schema, EXT_MANIFEST_SCHEMA);
  assert.equal(header.entries, man.length);
  assert.equal(header.config, createHash("sha256").update(readFileSync(join(root, "peaceai/model/ext-corpus.json"))).digest("hex"));
  const cRepos = new Set(c.sets.C.map((e) => e.repo));
  const held = allHeldOutHashes(JSON.parse(rd("heldout.json")), c);
  const byRepo = new Map<string, number>();
  const seen = new Set<string>();
  let bytes = 0;
  man.forEach((m, i) => {
    assert.equal(m.doc, i);
    assert.equal(m.stage, "pretrain");
    assert.ok(!cRepos.has(m.repo), `held-out repo in training: ${m.repo}`);
    assert.ok(!held.has(m.sha256), "held-out content in training");
    assert.ok(!seen.has(m.sha256), "duplicate content"); seen.add(m.sha256);
    const src = m.origin === "external" ? cfg.repos.find((r: { name: string }) => r.name === m.repo) : cfg.owner.find((o: { name: string }) => o.name === m.repo);
    assert.ok(src, `unknown source ${m.repo}`);
    assert.equal(m.commit, src.commit);
    assert.equal(m.license, m.origin === "external" ? src.spdx : "owner:PeaceG03");
    assert.match(m.sha256, /^[0-9a-f]{64}$/);
    assert.equal(extFileExclusion(m.path, "x\n", []) === "generated-path" || /\.min\.[cm]?js$/.test(m.path), false, `filtered path in manifest: ${m.path}`);
    byRepo.set(m.repo, (byRepo.get(m.repo) ?? 0) + m.bytes); bytes += m.bytes;
  });
  assert.ok(bytes >= EXT_MIN_BYTES && bytes <= EXT_MAX_BYTES, `corpus bytes ${bytes}`);
  for (const [r, b] of byRepo) assert.ok(b <= EXT_REPO_CAP_BYTES, r);
});

test("file filters: generated, snapshot, lock, minified, vendored, secrets", () => {
  assert.equal(extFileExclusion("src/__snapshots__/a.ts", "x\n", []), "generated-path");
  assert.equal(extFileExclusion("src/generated/api.ts", "x\n", []), "generated-path");
  assert.equal(extFileExclusion("dist/a.umd.js", "x\n", []), "generated-path");
  assert.equal(extFileExclusion("vendor/a.js", "x\n", []), "excluded-dir");
  assert.equal(extFileExclusion("a.min.js", "x\n", []), "minified");
  assert.equal(extFileExclusion("a.ts", "// @generated\nx\n", []), "generated");
  assert.equal(extFileExclusion("a.ts", `const k = "AKIA${"A".repeat(16)}";\n`, []), "secret");
  assert.equal(extFileExclusion("a.ts", `-----BEGIN RSA ${"PRIVATE"} KEY-----\n`, []), "secret");
  // Auditor #148 follow-up: generic hex API keys.
  const hex = "0123456789abcdef".repeat(2);
  assert.equal(extFileExclusion("a.ts", `const apiKey = "${hex}";\n`, []), "secret");
  assert.equal(extFileExclusion("a.ts", `config = { api_key: '${hex}' };\n`, []), "secret");
  assert.equal(extFileExclusion("a.ts", `headers["X-Auth-Token"] = "x"; const SECRET_TOKEN = \`${hex}ff\`;\n`, []), "secret");
  assert.equal(extFileExclusion("a.ts", `const hash = "${hex}";\n`, []), null, "a hex value under a non-key name is kept");
  assert.equal(extFileExclusion("a.ts", `const apiKey = "short";\n`, []), null);
  assert.equal(extFileExclusion("pkg/x/a.ts", "x\n", ["pkg/x"]), "nested-license");
  assert.equal(extFileExclusion("src/a.ts", "export const a = 1;\n", []), null);
});

test("allowlist disjoint from A+B+C; protected paths", () => {
  const allow = JSON.parse(rd("lm-public-allow.json"));
  const held = allHeldOutHashes(JSON.parse(rd("heldout.json")), c);
  assert.ok(allow.sha256.every((h: string) => !held.has(h)));
  assert.ok(heldOutHashes(JSON.parse(rd("heldout.json"))).size > 0);
  for (const p of ["peaceai/lib/extcorpus.ts", "peaceai/bin/ext-corpus.ts", "peaceai/bin/ext-fetch.ts", "peaceai/model/ext-corpus.json", "peaceai/model/ext-manifest.jsonl", "peaceai/model/ext-train.json", "peaceai/model/heldout-c.json", "peaceai/model/heldout-c-excluded.json", "peaceai/test/m36-ext-corpus.test.ts"]) assert.ok(protectedReason(p), p);
});

test("Architect #148: safety-scanner tool files are never in the corpus", () => {
  for (const p of ["peaceai/bin/core-scan.ts", "peaceai/bin/leak-scan.ts", "peaceai/lib/leak.ts", "peaceai/lib/trigger.ts"]) assert.ok(isSafetyToolFile("PeaceG03/PeaceAI-Workspace", p), p);
  assert.ok(!isSafetyToolFile("PeaceG03/PeaceAI-Workspace", "src/text.ts"));
  assert.ok(!isSafetyToolFile("honojs/hono", "peaceai/lib/leak.ts"), "by repo");
  assert.ok(SAFETY_TOOL_FILES.length > 0);
  for (const m of man) assert.ok(!isSafetyToolFile(m.repo, m.path), `${m.repo} ${m.path}`);
  assert.ok(!man.some((m) => m.repo === "PeaceG03/PeaceAI-Workspace" && /^peaceai\/(bin|lib)\//.test(m.path) && /leak|scan|trigger/.test(m.path)));
});

test("memcheck record (box, against core): PASS for the committed manifest, every doc scanned, zero hits", () => {
  const m = JSON.parse(rd("ext-memcheck.json"));
  const bytes = readFileSync(join(root, "peaceai/model/ext-manifest.jsonl"));
  assert.equal(m.schema, EXT_MEMCHECK_SCHEMA);
  assert.equal(m.status, "PASS");
  assert.equal(m.manifestSha256, createHash("sha256").update(bytes).digest("hex"));
  assert.equal(m.scannedDocs, man.length);
  assert.equal(m.entries, man.length);
  assert.equal(m.coreFileHits + m.coreLineHits + m.coreShingleHits + m.coreRunHits, 0);
  for (const p of ["peaceai/bin/ext-memcheck.ts", "peaceai/model/ext-memcheck.json", "peaceai/model/ext-summary.json"]) assert.ok(protectedReason(p), p);
});

test("summary: counts only, bound to the committed manifest", () => {
  const s = JSON.parse(rd("ext-summary.json"));
  assert.equal(s.manifestSha256, createHash("sha256").update(readFileSync(join(root, "peaceai/model/ext-manifest.jsonl"))).digest("hex"));
  assert.equal(s.train.files, man.length);
  assert.equal(s.memcheck.scannedDocs - s.memcheck.droppedCoreText, man.length);
  assert.ok(!/"path"|"text"/.test(rd("ext-summary.json")), "no paths or text");
});

test("sizing: fits the free public runner budget (recorded estimate)", () => {
  const t = JSON.parse(rd("ext-train.json"));
  assert.equal(t.stage, "pretrain");
  assert.deepEqual(t.model, { d_model: 320, n_layer: 6, n_head: 5, ctx: 512, vocab: 8192, params: 10166400, batch: 16, steps: 1600 });
});
