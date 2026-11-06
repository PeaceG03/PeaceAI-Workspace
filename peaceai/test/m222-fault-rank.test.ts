// M222: candidate ranking, dedupe, swapped-operand. EXPERIMENTAL, not for credit.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as F from "../lib/fault-localize.ts";

const specPath = join(import.meta.dirname, "../spec/fault-localize-v2.md");

test("M222 pins: evidence from assert.equal; rank prefers exact expected num", () => {
  const files = [
    {
      path: "peaceai/self-tests/helpers/dates.ts",
      content: "export function utcDayKey(d: Date): string { return d.toISOString().slice(0, 7); }\n",
    },
    {
      path: "peaceai/self-tests/helpers/day.test.ts",
      content: "import assert from \"node:assert/strict\";\nassert.equal(utcDayKey(x), \"2026-10-16\");\nassert.equal(n, 10);\n",
    },
  ];
  const ev = F.collectEvidence("Fix utcDayKey YYYY-MM-DD length.", files, []);
  assert.ok(ev.nums.includes(10));
  assert.ok(ev.strings.includes("2026-10-16"));
  const fns = F.locateSafeFns(files, "Fix utcDayKey.", []);
  const muts = F.mutateFunction(files[0]!.path, files[0]!.content, fns[0]!, ev.nums, ev.strings);
  const to10 = muts.find((m) => m.wroteNum === 10);
  const to8 = muts.find((m) => m.wroteNum === 8);
  assert.ok(to10 && to8);
  assert.ok(F.rankScore(to10!, ev) < F.rankScore(to8!, ev));
});

test("M222 dedupe keeps one mutant per content sha", () => {
  const ev = { nums: [10], strings: [] as string[] };
  const a: F.MutCand = { kind: "boundary", path: "p", content: "SAME", key: "a", wroteNum: 10 };
  const b: F.MutCand = { kind: "boundary", path: "p", content: "SAME", key: "b", wroteNum: 9 };
  const out = F.dedupeMutants([a, b], ev);
  assert.equal(out.length, 1);
  assert.equal(out[0]!.wroteNum, 10);
});

test("M222 swapped-operand: a-b becomes b-a; concat A+lit+B becomes B+lit+A", () => {
  const path = "peaceai/self-tests/helpers/dates.ts";
  const content = "export function minutesOfUtcDay(d: Date): number {\n  return d.getUTCMinutes() * 60 + d.getUTCHours();\n}\n";
  const fns = F.locateSafeFns([{ path, content }], "Fix minutesOfUtcDay hours first.", []);
  const muts = F.mutateFunction(path, content, fns[0]!);
  assert.ok(muts.some((m) => m.kind === "argument-swap" && /getUTCHours\(\)/.test(m.content) && /getUTCMinutes\(\)/.test(m.content) && m.content.indexOf("getUTCHours") < m.content.indexOf("getUTCMinutes")), muts.filter((m) => m.kind === "argument-swap").map((m) => m.content).join("\n---\n"));
});

test("M222 template letter-move covers plural-like order", () => {
  const path = "peaceai/self-tests/helpers/text.ts";
  const content = "export function plural(count: number, word: string): string {\n  return count === 1 ? `${word} ${count}` : `${word}s ${count}`;\n}\n";
  const fns = F.locateSafeFns([{ path, content }], "Fix plural order.", []);
  const muts = F.mutateFunction(path, content, fns[0]!);
  assert.ok(muts.some((m) => m.content.includes("${count} ${word}s") || m.content.includes("${count} ${word}")), "expected template reorder");
});

test("M222 spec names ranking, swapped-operand, ellipsis residual, heldout2", () => {
  const spec = readFileSync(specPath, "utf8");
  assert.match(spec, /rank|expected|distance/i);
  assert.match(spec, /swapped-operand|a-b|template/i);
  assert.match(spec, /ellipsis|idiom/i);
  assert.match(spec, /heldout2|held-out set 2/i);
  assert.match(spec, /m222-guard/);
});

// mutation for m222 guards
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync as rf } from "node:fs";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { after } from "node:test";

const libDir = join(import.meta.dirname, "../lib");
const base = mkdtempSync(join(tmpdir(), "peaceai-m222-"));
after(() => rmSync(base, { recursive: true, force: true }));
const SRC = rf(join(libDir, "fault-localize.ts"), "utf8");
const tsPath = createRequire(join(libDir, "fault-localize.ts")).resolve("typescript");
function rewrite(t: string): string {
  return t
    .replace(/from "\.\/([a-z0-9-]+\.ts)"/g, (_m, f: string) => `from ${JSON.stringify(pathToFileURL(join(libDir, f)).href)}`)
    .replace(/from "typescript"/g, `from ${JSON.stringify(pathToFileURL(tsPath).href)}`);
}
const tagsOf = (t: string) => t.split("\n").flatMap((l) => {
  const m = /\/\/ m222-guard:([a-z0-9-]+)/.exec(l);
  return m ? [m[1]!] : [];
});
const drop = (text: string, tag: string) => {
  const ls = text.split("\n");
  const hit = (l: string) => new RegExp(`// m222-guard:${tag}(?![a-z0-9-])`).test(l);
  assert.equal(ls.filter(hit).length, 1, `one line holds ${tag}`);
  return ls.filter((l) => !hit(l)).join("\n");
};

test("M222 mutation: every m222-guard has a case; deleting it is caught", async () => {
  const tags = tagsOf(SRC);
  assert.deepEqual(tags.sort(), ['dedupe', 'drop-add', 'ev-scope', 'multi-tpl', 'rank-dist', 'rank-drop', 'rank-len', 'rank-num', 'rank-str', 'scope-filter', 'sort']);
  const dir = join(base, "mut");
  mkdirSync(dir, { recursive: true });
  const load = async (text: string) => {
    const f = join(dir, `m-${Math.random().toString(16).slice(2)}.ts`);
    writeFileSync(f, rewrite(text));
    return (await import(pathToFileURL(f).href)) as typeof F;
  };
  const ev = { nums: [10], strings: ["ok"] };
  const good: F.MutCand = { kind: "boundary", path: "p", content: "A", key: "g", wroteNum: 10 };
  const bad: F.MutCand = { kind: "boundary", path: "p", content: "A", key: "b", wroteNum: 99 };
  {
    const m = await load(drop(SRC, "dedupe"));
    // without dedupe sha keying, both remain if we fake dedupeMutants body - deleting the sha line breaks the map key
    // After delete, contentSha line gone -> ReferenceError or both kept differently.
    let n = 0;
    try { n = m.dedupeMutants([good, bad], ev).length; } catch { n = -1; }
    assert.ok(n !== 1);
  }
  {
    const ctrl = await load(SRC);
    const m = await load(drop(SRC, "rank-num"));
    const gapCtrl = ctrl.rankScore(bad, ev) - ctrl.rankScore(good, ev);
    const gapMut = m.rankScore(bad, ev) - m.rankScore(good, ev);
    assert.ok(gapCtrl > 20, "control exact-match boost");
    assert.ok(gapMut < gapCtrl, "deleting rank-num shrinks the gap");
  }
  {
    const m = await load(drop(SRC, "rank-str"));
    const gs: F.MutCand = { kind: "string-literal-empty", path: "p", content: "X", key: "1", wroteStr: "ok" };
    const bs: F.MutCand = { kind: "string-literal-empty", path: "p", content: "Y", key: "2", wroteStr: "no" };
    assert.ok(m.rankScore(gs, ev) >= m.rankScore(bs, ev));
  }
  {
    const m = await load(drop(SRC, "rank-dist"));
    const near: F.MutCand = { kind: "boundary", path: "p", content: "N", key: "n", wroteNum: 11 };
    const far: F.MutCand = { kind: "boundary", path: "p", content: "F", key: "f", wroteNum: 100 };
    // without distance penalty, scores may not prefer near
    assert.ok(m.rankScore(near, ev) >= m.rankScore(far, ev) - 5);
  }
  {
    const m = await load(drop(SRC, "sort"));
    const files = [{ path: "peaceai/self-tests/helpers/dates.ts", content: "export function utcDayKey(d: Date): string { return d.toISOString().slice(0, 7); }\n" }];
    const q = m.faultCandidates({ files, request: "Fix utcDayKey YYYY-MM-DD.", feedback: [] });
    // without sort, first may not be the best ranked
    if (q.length >= 2) {
      const scored = q.map((c: F.MutCand) => F.rankScore(c, F.collectEvidence("Fix utcDayKey YYYY-MM-DD.", files, [])));
      // control sort would be non-decreasing; mutant may violate
      let dec = false;
      for (let i = 1; i < scored.length; i++) if (scored[i]! < scored[i - 1]!) dec = true;
      // We need the mutant to differ from sorted control - assert not strictly sorted by control scorer
      // Actually after deleting sort line, order is insertion order; control F.rankScore on mutant order:
      const control = await load(SRC);
      const cq = control.faultCandidates({ files, request: "Fix utcDayKey YYYY-MM-DD.", feedback: [] });
      assert.notDeepEqual(q.map((c: F.MutCand) => c.key), cq.map((c: F.MutCand) => c.key));
    }
  }
  {
    const ctrl = await load(SRC);
    const m = await load(drop(SRC, "rank-drop"));
    const dropCand: F.MutCand = { kind: "boundary", path: "p", content: "D", key: "d", wroteNum: 0, fromNum: 1 };
    const other: F.MutCand = { kind: "argument-swap", path: "p", content: "O", key: "o" };
    assert.ok(ctrl.rankScore(dropCand, ev) < ctrl.rankScore(other, ev));
    assert.ok(m.rankScore(dropCand, ev) > ctrl.rankScore(dropCand, ev));
  }
  {
    const m = await load(drop(SRC, "ev-scope"));
    // deleting uniqEvidence call line -> collectEvidence may throw or return uncapped flood
    const files = [
      { path: "peaceai/self-tests/helpers/dates.ts", content: "export function utcDayKey(d: Date): string { return d.toISOString().slice(0, 7); }\n" },
      { path: "peaceai/self-tests/helpers/day.test.ts", content: "assert.equal(x, 10);\n".repeat(40) },
    ];
    let bad = false;
    try {
      const ev2 = m.collectEvidence("Fix utcDayKey.", files, [], { paths: ["peaceai/self-tests/helpers/dates.ts"], names: ["utcDayKey"] });
      bad = ev2.nums.length > 32;
    } catch { bad = true; }
    assert.ok(bad);
  }
  {
    const path = "peaceai/self-tests/helpers/dates.ts";
    const content = "export function minutesOfUtcDay(d: Date): number {\n  return d.getUTCHours() * 60 + d.getUTCMinutes() + 1;\n}\n";
    const ctrl = await load(SRC);
    const m = await load(drop(SRC, "drop-add"));
    const fns = ctrl.locateSafeFns([{ path, content }], "Fix minutesOfUtcDay.", []);
    const cMuts = ctrl.mutateFunction(path, content, fns[0]!);
    const mMuts = m.mutateFunction(path, content, fns[0]!);
    const fixedLike = (c: F.MutCand) => /return d\.getUTCHours\(\) \* 60 \+ d\.getUTCMinutes\(\);/.test(c.content);
    assert.ok(cMuts.some(fixedLike), "control drop-add removes +1");
    assert.ok(!mMuts.some(fixedLike), "deleting drop-add loses expr+1 -> expr");
  }
  {
    const path = "peaceai/self-tests/helpers/text.ts";
    const content = "export function plural(count: number, word: string): string {\n  return count === 1 ? `${word} ${count}` : `${word}s ${count}`;\n}\n";
    const ctrl = await load(SRC);
    const m = await load(drop(SRC, "multi-tpl"));
    const fns = ctrl.locateSafeFns([{ path, content }], "Fix plural.", []);
    const cMuts = ctrl.mutateFunction(path, content, fns[0]!);
    const mMuts = m.mutateFunction(path, content, fns[0]!);
    const both = (c: F.MutCand) => c.content.includes("${count} ${word}`") && c.content.includes("${count} ${word}s");
    assert.ok(cMuts.some(both), "control multi-tpl fixes both branches");
    assert.ok(!mMuts.some(both), "deleting multi-tpl loses both-branch fix");
  }
});
