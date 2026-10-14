// M31: the public-runner LM corpus check fails on any held-out sha256 and on anything off the public allowlist.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { heldOutHashes } from "../lib/lmcorpus.ts";
import { filterPublic, manifestProblems, validAllow, type PublicManifestEntry } from "../lib/lmpublic.ts";
import { protectedReason } from "../lib/selfchange.ts";

const root = resolve(import.meta.dirname, "../..");
const allowRaw = JSON.parse(readFileSync(join(root, "peaceai/model/lm-public-allow.json"), "utf8"));
const allow = validAllow(allowRaw)!;
const heldOut = heldOutHashes(JSON.parse(readFileSync(join(root, "peaceai/model/heldout.json"), "utf8")));
const [src, commit] = Object.entries(allow.sources)[0]!;
const entry = (sha256: string, over: Partial<PublicManifestEntry> = {}): PublicManifestEntry => ({ doc: 0, source: src, visibility: "public", commit, path: "src/x.ts", sha256, bytes: 1, license: "owner:PeaceG03", split: "train", ...over });
const ok = allow.sha256[0]!, held = [...heldOut][0]!;

test("M31: the committed allowlist is valid, Peace's public sources only, and holds no held-out sha256", () => {
  assert.ok(allow, "valid");
  assert.ok(Object.keys(allow.sources).every((s) => s === "PeaceG03/PeaceSTOCKS" || s === "PeaceG03/PeaceAI-Workspace"));
  assert.equal(allow.sha256.filter((h) => heldOut.has(h)).length, 0);
  assert.equal(heldOut.size > 0, true);
});

test("M31: manifestProblems fails on any held-out sha256 and on anything off the allowlist", () => {
  assert.deepEqual(manifestProblems([entry(ok)], heldOut, allow), []);
  assert.match(manifestProblems([entry(ok), entry(held)], heldOut, allow).join(";"), /held-out sha256 present: 1/);
  assert.match(manifestProblems([entry(ok, { visibility: "private" })], heldOut, allow).join(";"), /non-public/);
  assert.match(manifestProblems([entry(ok, { source: "PeaceG03/PeaceAI" })], heldOut, allow).join(";"), /source not in/);
  assert.match(manifestProblems([entry(ok, { commit: "0".repeat(40) })], heldOut, allow).join(";"), /commit differs/);
  assert.match(manifestProblems([entry("f".repeat(64))], heldOut, allow).join(";"), /not in the public allowlist/);
  assert.match(manifestProblems([], heldOut, allow).join(";"), /empty/);
  // even if a held-out sha were (wrongly) allowlisted, the check still fails
  assert.match(manifestProblems([entry(held)], heldOut, { ...allow, sha256: [...allow.sha256, held] }).join(";"), /held-out sha256 present/);
});

test("M31: filterPublic drops held-out, private and off-list entries; its output passes the check", () => {
  const m = [entry(ok), entry(held), entry(ok, { visibility: "private" }), entry("e".repeat(64))];
  const docs = m.map((_, i) => JSON.stringify({ doc: i, text: `t${i}` }));
  const r = filterPublic(m, docs, heldOut, allow);
  assert.equal(r.manifest.length, 1); assert.equal(r.dropped, 3); assert.equal(JSON.parse(r.docs[0]!).text, "t0");
  assert.deepEqual(manifestProblems(r.manifest, heldOut, allow), []);
});

test("M31: lm-manifest-check exits 1 on a held-out sha and 0 on a clean manifest", () => {
  const d = mkdtempSync(join(tmpdir(), "m31-"));
  const run = (rows: PublicManifestEntry[]) => { const f = join(d, "m.jsonl"); writeFileSync(f, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
    return spawnSync(join(root, "node_modules/.bin/tsx"), [join(root, "peaceai/bin/lm-manifest-check.ts"), f], { encoding: "utf8" }); };
  const bad = run([entry(ok), entry(held)]);
  assert.equal(bad.status, 1); assert.match(bad.stdout, /FAIL held-out sha256 present: 1/);
  const good = run([entry(ok)]);
  assert.equal(good.status, 0); assert.match(good.stdout, /PASS files=1 .*heldout_present=0/);
});

test("M31: the workflow trains public-only, runs the manifest check before training, and lands only in Results", () => {
  const wf = readFileSync(join(root, ".github/workflows/peace-lm-train.yml"), "utf8");
  assert.match(wf, /PEACEAI_LM_PUBLIC_ONLY: "1"/);
  assert.ok(wf.indexOf("lm-manifest-check.ts") > 0 && wf.indexOf("lm-manifest-check.ts") < wf.indexOf("peaceai/model/train.py"), "check before train");
  assert.ok(!/PeaceG03\/PeaceAI\.git|PeaceAI\.git"/.test(wf.replace("PeaceAI-Results.git", "")), "no private core clone");
  assert.ok(!/upload-artifact/.test(wf), "weights never become a public artifact");
  assert.match(wf, /results-write\.sh/);
  assert.equal((wf.match(/secrets\.PEACEAI_RESULTS_DEPLOY_KEY/g) ?? []).length, 1, "the key is given to the landing step only");
  for (const p of ["peaceai/lib/lmpublic.ts", "peaceai/bin/lm-manifest-check.ts", "peaceai/bin/lm-public-corpus.ts", "peaceai/model/lm-public-allow.json"]) assert.ok(protectedReason(p), p);
  void execFileSync;
});
