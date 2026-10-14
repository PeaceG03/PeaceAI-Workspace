// M37: training workflow on the M36 external corpus: stage gate, runner-side manifest check, memcheck record, set C v2 eval gate.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";
import { EXT_MANIFEST_SCHEMA, EXT_MEMCHECK_SCHEMA, extCorpusProblems, stageAllowed } from "../lib/extcorpus.ts";
import { protectedReason } from "../lib/selfchange.ts";

const root = resolve(import.meta.dirname, "../..");
const H = (s: string) => createHash("sha256").update(s).digest("hex");
const cfg = JSON.parse(readFileSync(join(root, "peaceai/model/ext-corpus.json"), "utf8"));
const ext = cfg.repos.find((r: { name: string }) => r.name === "d3/d3-array");
const entry = (doc: number, text: string, o: Record<string, unknown> = {}) => ({ doc, stage: "pretrain", repo: ext.name, commit: ext.commit, license: ext.spdx, path: `src/f${doc}.js`, sha256: H(text), bytes: text.length, origin: "external", ...o });
function ctx(o: { entries?: object[]; texts?: string[]; held?: string[]; cRepos?: string[]; stage?: string; memcheck?: object | null } = {}) {
  const texts = o.texts ?? ["a", "b"];
  const entries = o.entries ?? texts.map((t, i) => entry(i, t));
  const manifestText = [JSON.stringify({ schema: EXT_MANIFEST_SCHEMA, config: "x", entries: entries.length }), ...entries.map((e) => JSON.stringify(e))].join("\n") + "\n";
  const sha = H(manifestText);
  return { manifestText, cfg, manifestSha256: sha, memcheck: o.memcheck === undefined ? { schema: EXT_MEMCHECK_SCHEMA, status: "PASS", manifestSha256: sha, scannedDocs: entries.length } : o.memcheck,
    heldOut: new Set(o.held ?? []), cRepos: new Set(o.cRepos ?? []), docs: new Map(texts.map((t, i) => [i, t])), sha256: H, stage: o.stage ?? "pretrain" };
}

test("stage: pretrain only; finetune is a reserved hook and refused", () => {
  assert.ok(stageAllowed("pretrain"));
  assert.ok(!stageAllowed("finetune"));
  assert.match(extCorpusProblems(ctx({ stage: "finetune" })).join(), /stage finetune refused/);
});

test("check: clean corpus passes; fails on sha mismatch, held-out (A/B/C or set C v2) hash, set C v2 repo, provenance, memcheck", () => {
  assert.deepEqual(extCorpusProblems(ctx()), []);
  const c = ctx(); (c.docs as Map<number, string>).set(1, "SWAPPED");
  assert.match(extCorpusProblems(c).join(), /doc 1: sha256/);
  assert.match(extCorpusProblems(ctx({ held: [H("b")] })).join(), /doc 1: held-out/);
  assert.match(extCorpusProblems(ctx({ cRepos: [ext.name] })).join(), /set-c-repo/);
  assert.match(extCorpusProblems(ctx({ entries: [entry(0, "a"), entry(1, "b", { license: "GPL-3.0" })] })).join(), /doc 1: provenance/);
  assert.match(extCorpusProblems(ctx({ entries: [entry(0, "a"), entry(1, "b", { commit: "0".repeat(40) })] })).join(), /doc 1: provenance/);
  assert.match(extCorpusProblems(ctx({ memcheck: null })).join(), /no PASS memcheck/);
  assert.match(extCorpusProblems(ctx({ memcheck: { schema: EXT_MEMCHECK_SCHEMA, status: "PASS", manifestSha256: "0".repeat(64), scannedDocs: 2 } })).join(), /no PASS memcheck/);
  assert.match(extCorpusProblems(ctx({ memcheck: { schema: EXT_MEMCHECK_SCHEMA, status: "FAIL", manifestSha256: ctx().manifestSha256, scannedDocs: 2 } })).join(), /no PASS memcheck/);
  const short = ctx(); (short.docs as Map<number, string>).delete(1);
  assert.match(extCorpusProblems(short).join(), /docs 1 != manifest 2/);
});

test("committed memcheck record: PASS for the committed manifest, every doc scanned, zero hits", () => {
  const m = JSON.parse(readFileSync(join(root, "peaceai/model/ext-memcheck.json"), "utf8"));
  const man = readFileSync(join(root, "peaceai/model/ext-manifest.jsonl"));
  assert.equal(m.schema, EXT_MEMCHECK_SCHEMA);
  assert.equal(m.status, "PASS");
  assert.equal(m.manifestSha256, H(man as unknown as string));
  assert.equal(m.scannedDocs, m.entries);
  assert.equal(m.entries, man.toString().split("\n").filter(Boolean).length - 1);
  assert.equal(m.coreFileHits + m.coreLineHits + m.coreShingleHits + m.coreRunHits, 0);
});

test("workflow: stage gate, fetch, check, train with ext-train.json sizing, set C v2 eval gated, Results-only landing", () => {
  const wf = readFileSync(join(root, ".github/workflows/peace-lm-train.yml"), "utf8");
  assert.match(wf, /stage=\$\(jq -r \.stage peaceai\/model\/ext-train\.json\)\n          if \[ "\$stage" != pretrain \]; then echo "stage \$stage refused/);
  assert.match(wf, /--steps "\$\(m steps\)"/);
  assert.match(wf, /--max-seconds 14400/);
  assert.match(wf, /if \[ "\$\(jq -r \.wiredAsEval peaceai\/model\/heldout-c\.json\)" != true \]; then echo "set C v2 not wired as eval: skipped"; exit 0; fi/);
  assert.ok(!/PEACEAI_LM_PUBLIC_ONLY|lm-corpus\.ts|lm-memcheck\.ts|upload-artifact/.test(wf));
  const t = JSON.parse(readFileSync(join(root, "peaceai/model/ext-train.json"), "utf8"));
  assert.ok(t.model.steps * 13.4 <= 14400, "steps fit the hard stop even at the measured box speed");
  for (const p of ["peaceai/bin/ext-manifest-check.ts", "peaceai/bin/ext-memcheck.ts", "peaceai/model/eval_c.py", "peaceai/model/ext-memcheck.json", "peaceai/test/m37-ext-train.test.ts", ".github/workflows/peace-lm-train.yml"]) assert.ok(protectedReason(p), p);
});
