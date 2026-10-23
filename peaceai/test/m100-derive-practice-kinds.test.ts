// M100: the practice families manifest (only family-1 graded in CI for now), the new staged forms, and the
// wrong-pick kinds (category + normalized shape; NEW = not in the derive mistakes ledger) and their ledger entries.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CATEGORIES, FAMILIES, FORMS, familyCategories, practiceTask } from "../lib/derive-practice.ts";
import { kindsOf, ledgerEntriesForNew, shapeOf } from "../lib/derive-practice-kinds.ts";

test("families: every form in exactly one family; only family-1 is active; staged forms build valid tasks", () => {
  const all = FAMILIES.flatMap((f) => f.forms);
  assert.deepEqual([...all].sort(), FORMS.map((f) => f.name).sort());
  assert.equal(new Set(all).size, all.length);
  assert.deepEqual(FAMILIES.filter((f) => f.status === "active").map((f) => f.name), ["family-1"]);
  const active = familyCategories("active");
  assert.ok(active.every((c) => FAMILIES[0]!.forms.includes(c.form.name)) && active.length < CATEGORIES.length);
  assert.throws(() => familyCategories("no-such-family"));
  const staged = familyCategories(FAMILIES.filter((f) => f.status === "staged").map((f) => f.name).join(","));
  for (let i = 0; i < staged.length * 3; i++) {
    const t = practiceTask(5, i, staged);
    assert.ok(t.examples.length >= 1 && t.examples.length <= 40, t.category);
    for (const e of t.examples) assert.deepEqual(t.truth(e.args), e.out, t.category);
  }
  // the workflow grades only the active families
  const wf = readFileSync(new URL("../../.github/workflows/derive-practice.yml", import.meta.url), "utf8");
  assert.match(wf, /--family active/);
  assert.doesNotMatch(wf, /secrets\.|environment:/);
});

test("kinds: shape normalizes names, numbers and strings; ledger shapes are KNOWN, others NEW, one smallest per kind", () => {
  assert.equal(shapeOf("(status === 429) || (500 <= status)", ["status"]), "(p0 === K) || (K <= p0)");
  assert.equal(shapeOf('a + ":" + b', ["a", "b"]), "p0 + S + p1");
  assert.equal(shapeOf("(-5) <= n ? n : (-5)", ["n"]), "K <= p0 ? p0 : K");
  const ledger = [{ id: "r2-hidden-island", params: ["n"], wrongProgram: "!(11 <= n && n <= 49)", examples: [] }];
  const e = (prog: string, n: number, category = "island/hidden_island") => ({ id: `x${n}`, params: ["x"], wrongProgram: prog, examples: Array.from({ length: n }, () => [0, true]), practice: { category } });
  const ks = kindsOf([e("!(3 <= x && x <= 9)", 9), e("!(1 <= x && x <= 2)", 4), e("x <= 4", 6, "threshold/sparse")], ledger, true);
  assert.equal(ks.length, 2);
  const isl = ks.find((k) => k.category === "island/hidden_island")!;
  assert.equal(isl.count, 2); assert.equal(isl.isNew, false); assert.equal(isl.knownAs, "r2-hidden-island"); assert.equal(isl.representative.id, "x4");
  const nw = ks.find((k) => k.isNew)!;
  const out = ledgerEntriesForNew(ks);
  assert.equal(out.length, 1);
  assert.match(String(out[0]!.id), /^m100-kind-threshold-sparse-/);
  assert.equal((out[0]!.practice as { kind: string }).kind, nw.kind);
});
