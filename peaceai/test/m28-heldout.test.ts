// M28: held-out generation sets are fixed (committed rule + list) and excluded from every training corpus.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";
import { buildHeldOut, HELDOUT_AUTHOR, HELDOUT_HEADS, HELDOUT_RULE, isTestPath, isTwoFile, kindOf, setOf, type HeldOutEntry } from "../lib/heldout.ts";
import { heldOutHashes, heldOutPaths, isHeldOut, type HeldOutFile } from "../lib/lmcorpus.ts";
import { PROTECTED_SELF } from "../lib/selfchange.ts";

const root = resolve(import.meta.dirname, "..", "..");
const h = JSON.parse(readFileSync(join(root, "peaceai/model/heldout.json"), "utf8")) as HeldOutFile & { rule: string; author: string; heads: Record<string, string>; fixedAt: string };
const all = [...h.sets.A, ...h.sets.B] as HeldOutEntry[];

test("held-out split: committed rule, 34 commits (14 two-file / 17 expression-edit / 3 both), A 14 / B 20", () => {
  assert.equal(h.fixedAt, "2026-10-14T09:45Z");
  assert.equal(h.rule, HELDOUT_RULE, "the rule text is committed in lib/heldout.ts and recorded in the file");
  assert.equal(h.author, HELDOUT_AUTHOR);
  assert.deepEqual(h.heads, HELDOUT_HEADS);
  assert.equal(all.length, 34);
  const n = (k: string) => all.filter((e) => e.kind === k).length;
  assert.deepEqual([n("two-file"), n("expression-edit"), n("two-file+expression-edit")], [14, 17, 3]);
  assert.deepEqual([h.sets.A.length, h.sets.B.length], [14, 20]);
  assert.equal(new Set(all.map((e) => `${e.repo}@${e.sha}`)).size, 34, "disjoint, no duplicates");
  for (const e of all) {
    assert.ok(Object.keys(HELDOUT_HEADS).includes(e.repo), "public repos only");
    assert.match(e.sha, /^[0-9a-f]{40}$/);
  }
  // Rebuilding from the entries by the committed rule gives the committed file (set assignment, order, metadata).
  assert.deepEqual(JSON.parse(JSON.stringify(buildHeldOut(all, h.fixedAt))), h);
});

test("selection rule units: two-file, kinds, set assignment", () => {
  assert.ok(isTestPath("src/a.test.ts") && isTestPath("peaceai/test/m9.test.ts") && isTestPath("peaceai/test/m7-fixtures.ts") && !isTestPath("src/a.ts"));
  assert.ok(isTwoFile(["M\tsrc/a.ts", "M\tsrc/b.ts", "M\tsrc/a.test.ts", "M\tREADME.md"]));
  assert.ok(isTwoFile(["A\tsrc/a.ts", "M\tsrc/index.ts", "A\tsrc/a.test.ts"]));
  assert.ok(!isTwoFile(["M\tsrc/a.ts", "M\tsrc/b.ts", "M\tsrc/a.test.ts", "M\tsrc/b.test.ts"]), "two tests");
  assert.ok(!isTwoFile(["M\tsrc/a.ts", "M\tsrc/b.ts"]), "no test");
  assert.ok(!isTwoFile(["M\tsrc/a.ts", "M\tsrc/b.ts", "M\tsrc/c.ts", "M\tsrc/a.test.ts"]), "three sources");
  assert.ok(!isTwoFile(["M\tsrc/a.ts", "D\tsrc/b.ts", "M\tsrc/a.test.ts"]), "a deletion");
  assert.equal(kindOf(true, true), "two-file+expression-edit"); assert.equal(kindOf(false, false), null);
  for (const e of all) assert.equal(setOf(e.repo, e.sha), h.sets.A.includes(e) ? "A" : "B");
});

test("regenerates the 34 from the public clones by the committed rule (when clones and lib/minebody.ts are present)", async (t) => {
  const clones = process.env.PEACEAI_HELDOUT_CLONES ?? "/tmp/mine";
  const ready = existsSync(join(root, "peaceai/lib/minebody.ts")) && Object.keys(HELDOUT_HEADS).every((r) => existsSync(join(clones, r.split("/")[1]!, ".git")));
  if (!ready) { t.skip("needs public clones (PEACEAI_HELDOUT_CLONES) and lib/minebody.ts (#136)"); return; }
  const { selectHeldOut } = await import("../bin/heldout-select.ts");
  const again = buildHeldOut(await selectHeldOut(clones), h.fixedAt);
  assert.deepEqual(JSON.parse(JSON.stringify(again)), h, "byte-for-byte the committed list, incl. content hashes");
});

test("held-out files are excluded from every corpus source by path and by content sha256", () => {
  const paths = heldOutPaths(h), hashes = heldOutHashes(h);
  for (const e of all) {
    for (const p of e.paths) assert.ok(paths.has(`${e.repo}\0${p}`));
    assert.ok(e.contentSha256.length > 0 && e.contentSha256.every((x) => hashes.has(x)));
  }
  const x = all[0]!.contentSha256[0]!;
  assert.ok(isHeldOut("PeaceG03/PeaceAI", "anything/else.ts", x, paths, hashes), "a byte-identical copy in the private source is excluded");
  assert.ok(isHeldOut("some/permissive", "lib/x.ts", x, paths, hashes), "in any source");
  assert.ok(isHeldOut(all[0]!.repo, all[0]!.paths[0]!, "0".repeat(64), paths, hashes), "by path in its own source");
  assert.ok(!isHeldOut("PeaceG03/PeaceAI", all[0]!.paths[0]!, "0".repeat(64), paths, hashes), "path keys are per source; content covers copies");
  assert.throws(() => heldOutHashes({ ...h, sets: { A: [{ ...all[0]!, contentSha256: [] }], B: [] } }), /no content hashes/, "fail closed");
  assert.throws(() => heldOutPaths({ schema: "x" } as unknown as HeldOutFile));
  const corpus = readFileSync(join(root, "peaceai/bin/lm-corpus.ts"), "utf8");
  assert.match(corpus, /const heldOutContent = allHeldOutHashes\(heldOutFile, JSON\.parse\(readFileSync\(resolve\(import\.meta\.dirname, "\.\.\/model\/heldout-c\.json"\), "utf8"\)\)\);/);
  assert.match(corpus, /const why = isHeldOut\(name, f\.path, sha256, heldOut, heldOutContent\) \? "held-out" : fileExclusion/);
  assert.equal((corpus.match(/addSource\(/g) ?? []).length, 3, "one addSource (definition + owner + permissive): every source goes through the check");
});

test("corpus builder and held-out selection are protected", () => {
  for (const p of ["peaceai/lib/lmcorpus.ts", "peaceai/bin/lm-corpus.ts", "peaceai/lib/heldout.ts", "peaceai/bin/heldout-select.ts", "peaceai/model/heldout.json"]) assert.ok(PROTECTED_SELF.some((x) => x.pattern.test(p)), p);
});
