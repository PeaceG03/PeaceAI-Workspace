// M33: held-out set C (single-file source+test edits), committed rule + frozen list, excluded from training by sha256.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { agentMade, buildHeldOutC, builderLogRefs, HELDOUT_AUTHOR, HELDOUT_C_HEADS, HELDOUT_C_RULE, isSourceTest, type HeldOutCEntry } from "../lib/heldout.ts";
import { allHeldOutHashes, heldOutCHashes, heldOutHashes, type HeldOutCFile, type HeldOutFile } from "../lib/lmcorpus.ts";
import { PROTECTED_SELF } from "../lib/selfchange.ts";

const root = resolve(import.meta.dirname, "..", "..");
const c = JSON.parse(readFileSync(join(root, "peaceai/model/heldout-c.json"), "utf8")) as HeldOutCFile & { rule: string; author: string; heads: Record<string, string>; fixedAt: string; sets: { C: HeldOutCEntry[] } };
const ab = JSON.parse(readFileSync(join(root, "peaceai/model/heldout.json"), "utf8")) as HeldOutFile;
const allow = JSON.parse(readFileSync(join(root, "peaceai/model/lm-public-allow.json"), "utf8")) as { sha256: string[] };

test("set C: committed rule, frozen list of 16 (0 Workspace / 16 PeaceSTOCKS), no agent-made commit, disjoint from A and B", () => {
  assert.equal(c.fixedAt, "2026-10-14T16:50Z");
  assert.equal(c.rule, HELDOUT_C_RULE);
  assert.equal(c.author, HELDOUT_AUTHOR);
  assert.deepEqual(c.heads, HELDOUT_C_HEADS);
  const n = (r: string) => c.sets.C.filter((e) => e.repo === r).length;
  assert.deepEqual([c.sets.C.length, n("PeaceG03/PeaceAI-Workspace"), n("PeaceG03/PeaceSTOCKS")], [16, 0, 16]);
  const abKeys = new Set([...ab.sets.A, ...ab.sets.B].map((e) => `${e.repo}@${e.sha}`));
  for (const e of c.sets.C) { assert.ok(!abKeys.has(`${e.repo}@${e.sha}`)); assert.equal(e.kind, "source+test"); assert.equal(e.paths.length, 2); }
  assert.deepEqual(JSON.parse(JSON.stringify(buildHeldOutC(c.sets.C, c.fixedAt))), c, "rebuilding from the entries gives the committed file");
});

test("source+test rule units", () => {
  assert.equal(isSourceTest(["M\tsrc/a.ts", "A\tsrc/a.test.ts"]), true);
  assert.equal(isSourceTest(["M\tsrc/a.ts", "M\tpeaceai/test/x.test.ts"]), true);
  assert.equal(isSourceTest(["M\tsrc/a.ts", "M\tsrc/b.ts"]), false, "no test");
  assert.equal(isSourceTest(["M\tsrc/a.ts", "A\tsrc/a.test.ts", "M\tREADME.md"]), false, "anything else");
  assert.equal(isSourceTest(["D\tsrc/a.ts", "A\tsrc/a.test.ts"]), false, "delete");
  assert.equal(isSourceTest(["A\tsrc/a.test.ts", "A\tsrc/b.test.ts"]), false, "two tests");
});

test("F2: agent-made commits and .d.ts are refused", () => {
  assert.equal(isSourceTest(["M\tsrc/a.d.ts", "A\tsrc/a.test.ts"]), false, ".d.ts");
  const refs = builderLogRefs(['{"changed":"PeaceSTOCKS@a3d9484"}', '{"changed":"PeaceAI-Workspace#143"}', '{"changed":"none (x)"}'].join("\n"));
  const early = "2026-10-12T00:00:00Z";
  assert.equal(agentMade("PeaceG03/PeaceSTOCKS", "a3d9484d0c5cdbed67efd62356ec2324c132ac82", early, "x", refs), true, "named in the builder log");
  assert.equal(agentMade("PeaceG03/PeaceSTOCKS", "1".repeat(40), "2026-10-13T08:36:22Z", "x", refs), true, "at the cutoff");
  assert.equal(agentMade("PeaceG03/PeaceAI-Workspace", "2".repeat(40), early, "fix thing (#143)", refs), true, "a logged PR");
  assert.equal(agentMade("PeaceG03/PeaceSTOCKS", "3".repeat(40), early, "fix thing (#143)", refs), false, "PR refs are Workspace only");
  assert.equal(agentMade("PeaceG03/PeaceSTOCKS", "4".repeat(40), "2026-10-13T08:36:21Z", "x", refs), false);
  for (const e of c.sets.C) assert.ok(!["a3d9484", "c210539"].some((p) => e.sha.startsWith(p)));
});

test("regenerates set C from the public clones by the committed rule (when clones are present)", async (t) => {
  const clones = process.env.PEACEAI_HELDOUT_CLONES ?? "/tmp/mine";
  if (!Object.keys(HELDOUT_C_HEADS).every((r) => existsSync(join(clones, r.split("/")[1]!, ".git")))) { t.skip("needs public clones (PEACEAI_HELDOUT_CLONES)"); return; }
  const { selectHeldOutC } = await import("../bin/heldout-select-c.ts");
  assert.deepEqual(JSON.parse(JSON.stringify(buildHeldOutC(selectHeldOutC(clones), c.fixedAt))), c);
});

test("set C is excluded from training by content sha256: hashes, allowlist, manifest check", () => {
  const hc = heldOutCHashes(c), all = allHeldOutHashes(ab, c);
  for (const x of [...hc, ...heldOutHashes(ab)]) assert.ok(all.has(x));
  assert.equal(allow.sha256.filter((x) => all.has(x)).length, 0, "the public allowlist holds no A, B or C hash");
  assert.throws(() => heldOutCHashes({ ...c, sets: { C: [{ ...c.sets.C[0]!, contentSha256: [] }] } }), /no content hashes/);
  assert.throws(() => heldOutCHashes({ schema: "x" } as unknown as HeldOutCFile), /bad held-out C file/);
  // The manifest check FAILS on a C sha (even if someone added it to the allowlist's commit/source pairing).
  const dir = mkdtempSync(join(tmpdir(), "m33-"));
  const a = JSON.parse(readFileSync(join(root, "peaceai/model/lm-public-allow.json"), "utf8"));
  const [source, commit] = Object.entries(a.sources)[0] as [string, string];
  const held = [...hc][0]!;
  writeFileSync(join(dir, "m.jsonl"), JSON.stringify({ source, commit, path: "x.ts", visibility: "public", sha256: held }) + "\n");
  writeFileSync(join(dir, "d.jsonl"), JSON.stringify({ text: "x" }) + "\n");
  const r = spawnSync(join(root, "node_modules/.bin/tsx"), [join(root, "peaceai/bin/lm-manifest-check.ts"), join(dir, "m.jsonl"), join(dir, "d.jsonl")], { encoding: "utf8" });
  assert.notEqual(r.status, 0); assert.match(r.stdout, /held-out sha256 present: 1/);
  for (const p of ["peaceai/model/heldout-c.json", "peaceai/bin/heldout-select-c.ts", "peaceai/test/m33-heldout-c.test.ts", "peaceai/lib/heldout.ts", "peaceai/lib/lmcorpus.ts"]) assert.ok(PROTECTED_SELF.some((x) => x.pattern.test(p)), p);
});
